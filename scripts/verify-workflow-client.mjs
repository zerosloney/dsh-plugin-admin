/**
 * verify-workflow-client.mjs — P3 浏览器侧自检
 *
 * 跑法：node scripts/verify-workflow-client.mjs
 *
 * 用 jsdom 真实渲染 WorkflowSection（与 self-check.mjs 同一套装载方式），
 * mock RPC 层，验证单视图工作流面板：一键生成（startRun → 轮询 getRun →
 * 自动存库）/ 模板草稿 / 工作库编辑-保存-删除 / 降级提示。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'
import TestUtils from 'react-dom/test-utils'
import { makeClientRequire } from './lib/harness-client.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// ─── 装载 client.js（与 self-check.mjs 同一套）────────────────────────────

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
try { globalThis.navigator = dom.window.navigator } catch { /* navigator is read-only in some node versions; jsdom's own is used */ }
dom.window.React = React
dom.window.localStorage.setItem('dsh-admin-lang', 'zh')

const registrations = []
globalThis.window.__ModuleLoader__ = { load: (registration) => registrations.push(registration) }
new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)

const clientExports = registrations[0].factory(makeClientRequire({ react: React, reactDom: { createRoot } }))

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

// ─── mock RPC ──────────────────────────────────────────────────────────────

function makeCall(rpc) {
  return (method, args) => {
    const handler = rpc[method]
    if (!handler) return Promise.resolve({ ok: false, error: `unknown method ${method}` })
    return Promise.resolve(handler(args || {}))
  }
}

// ─── 渲染工具 ──────────────────────────────────────────────────────────────
// The section lives in the lazily loaded panel chunk (Phase B2): ask the entry
// for the chunk the way a slot does, then render its component.
const panels = await clientExports.loadPanels()

function renderPanel(call) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // act 包裹：React 18 的并发渲染需要 act 才能同步取到结果
  const act = TestUtils.act
  const Comp = panels.WorkflowSection
  act(() => { root.render(React.createElement(Comp, { call })) })
  return {
    container,
    root,
    unmount: () => { act(() => root.unmount()); container.remove() },
    rerender: (nextCall) => {
      act(() => { root.render(React.createElement(Comp, { call: nextCall || call })) })
    },
    text: () => container.textContent,
    queryAll: (sel) => container.querySelectorAll(sel),
  }
}

// WorkflowSection rides the chunk exports alongside the slot components; the
// dsh module loader reads only apply/inject/Config, so this is harness-only.
const WorkflowSection = panels.WorkflowSection
assert.ok(typeof WorkflowSection === 'function', 'WorkflowSection exported for the self-check')

console.log('WorkflowSection:')

await checkAsync('renders the single view: generator card, two templates, library hint — no tabs, no run console', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const text = panel.text()
  assert.ok(text.includes('一键生成工作流'), 'generator card rendered')
  assert.ok(text.includes('从模板开始'), 'template row header rendered')
  assert.ok(text.includes('总结一个主题') && text.includes('并行双角度分析'), 'both template cards rendered')
  assert.ok(!text.includes('分步润色流水线'), 'the third template is gone')
  assert.ok(text.includes('工作库'), 'library area rendered')
  assert.ok(!text.includes('运行 ('), 'no 运行 tab remains')
  assert.ok(!panel.container.querySelector('[role="tablist"]'), 'no tablist in the single view')
  assert.ok(!text.includes('新建工作流'), 'no new-workflow button remains')
  assert.ok(text.includes('工作库为空'), 'empty-library hint guides to generate/templates')
  panel.unmount()
})

await checkAsync('degrades when engine unavailable', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: false, error: 'subagents missing' }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const text = panel.text()
  assert.ok(text.includes('工作流引擎不可用'), 'degradation hint shown')
  assert.ok(text.includes('subagents missing'), 'error reason surfaced')
  panel.unmount()
})

await checkAsync('library rows render with scope pills and no run button', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [
      { name: 'audit', scope: 'global', description: '审查代码' },
      { name: 'migrate', scope: 'project' },
    ] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const text = panel.text()
  assert.ok(text.includes('audit'), 'saved entry rendered')
  assert.ok(text.includes('全局'), 'global scope pill rendered')
  assert.ok(text.includes('项目'), 'project scope pill rendered')
  const rowButtons = [...panel.queryAll('.card button')].map((b) => b.textContent)
  assert.ok(rowButtons.some((t) => t.includes('编辑')), 'edit button on rows')
  assert.ok(!rowButtons.some((t) => t.includes('🚀 运行')), 'no run button on rows')
  panel.unmount()
})

await checkAsync('clicking a template card opens a saved-entry draft', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const tplCard = [...panel.queryAll('[role="button"]')].find((el) => el.textContent === '总结一个主题')
  assert.ok(tplCard, 'the first template card is in the document')
  tplCard.click()
  await new Promise((r) => setTimeout(r, 30))
  const text = panel.text()
  assert.ok(text.includes('保存到工作库'), 'the saved-entry editor opened')
  const nameInput = panel.queryAll('input')[0]
  assert.equal(nameInput.value, 'topic-summary', 'draft name prefilled with the legal kebab-case name')
  const select = panel.container.querySelector('select')
  assert.equal(select.value, 'global', 'draft scope is global')
  assert.ok(select.disabled, 'scope select locked (panel only writes global)')
  const ta = panel.queryAll('textarea')[0]
  assert.ok(ta.value.includes('var summary = await agent('), 'the template script prefills the draft')
  panel.unmount()
})

await checkAsync('saving a template draft calls saveSaved and refreshes the library', async () => {
  const saves = []
  let listSavedCalls = 0
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => { listSavedCalls += 1; return { ok: true, value: [] } },
    'workflowAdmin/saveSaved': (args) => { saves.push(args); return { ok: true, value: { ok: true, record: { name: args.spec.name } } } },
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const tplCard = [...panel.queryAll('[role="button"]')].find((el) => el.textContent === '总结一个主题')
  tplCard.click()
  await new Promise((r) => setTimeout(r, 30))
  const saveBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('💾 保存'))
  saveBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(saves.length, 1, 'saveSaved called once')
  assert.equal(saves[0].spec.name, 'topic-summary', 'the draft name is saved')
  assert.equal(saves[0].spec.scope, 'global', 'panel saves write global scope')
  assert.ok(saves[0].spec.script.includes('var summary = await agent('), 'the template script is saved')
  assert.ok(document.body.textContent.includes('💾 已保存：topic-summary'), 'saved toast shown')
  assert.ok(listSavedCalls >= 2, 'the library list is re-read after the save')
  panel.unmount()
})

await checkAsync('saved editor validates empty name', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const tplCard = [...panel.queryAll('[role="button"]')].find((el) => el.textContent === '总结一个主题')
  tplCard.click()
  await new Promise((r) => setTimeout(r, 30))
  // 清空名称输入（React 受控 input：直接调节点上的 onChange）
  const nameInput = panel.queryAll('input')[0]
  const propsKey = Object.keys(nameInput).find((k) => k.startsWith('__reactProps'))
  nameInput[propsKey].onChange({ target: { value: '' } })
  await new Promise((r) => setTimeout(r, 30))
  const saveBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('💾 保存'))
  saveBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(panel.text().includes('名称和脚本不能为空'), 'validation error shown')
  panel.unmount()
})

await checkAsync('edit saved row opens the editor locked to its scope and saves back', async () => {
  const saves = []
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [{ name: 'audit', scope: 'global', script: 'return 1', description: '审查代码' }] }),
    'workflowAdmin/saveSaved': (args) => { saves.push(args); return { ok: true, value: { ok: true, record: { name: args.spec.name } } } },
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const editBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('编辑'))
  editBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  const nameInput = panel.queryAll('input')[0]
  assert.equal(nameInput.value, 'audit', 'editor prefilled with the entry name')
  const select = panel.container.querySelector('select')
  assert.equal(select.value, 'global', 'scope locked to the original value')
  assert.ok(select.disabled, 'scope select disabled while editing')
  const saveBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('💾 保存'))
  saveBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(saves.length, 1, 'saveSaved called once')
  assert.equal(saves[0].spec.name, 'audit', 'the edit saves back under the same name')
  panel.unmount()
})

await checkAsync('delete saved has two-step confirm', async () => {
  let deleted = null
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [{ name: 'audit', scope: 'global' }] }),
    'workflowAdmin/deleteSaved': (args) => { deleted = args; return { ok: true } },
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const delBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('🗑 删除'))
  delBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  const confirmBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('确认删除'))
  assert.ok(confirmBtn, 'confirm button appears after first click')
  confirmBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  assert.deepEqual(deleted, { spec: { name: 'audit', scope: 'global' } }, 'delete RPC called with right args')
  panel.unmount()
})

// ─── 一键生成：表单 → startRun 生成器脚本 → 轮询 getRun → 终态自动存库 ──────

/** React 受控 textarea 的填充：直接调节点上挂着的 React onChange——synthetic
 * dispatchEvent 过不了 React 的 value tracker（bench-client-render.mjs 同款坑），
 * 处理器会被静默跳过。 */
function fillTextarea(panel, index, value) {
  const ta = panel.queryAll('textarea')[index]
  const propsKey = Object.keys(ta).find((k) => k.startsWith('__reactProps'))
  if (propsKey === undefined || typeof ta[propsKey].onChange !== 'function') {
    throw new Error('verify-workflow-client: the textarea carries no React onChange')
  }
  ta[propsKey].onChange({ target: { value } })
}

async function submitGeneration(panel, description, name) {
  fillTextarea(panel, 0, description)
  if (name !== undefined) {
    // 名称输入（可选）：与 textarea 同款坑，必须直接调节点上的 React onChange。
    const nameInput = panel.queryAll('input')[0]
    const propsKey = Object.keys(nameInput).find((k) => k.startsWith('__reactProps'))
    nameInput[propsKey].onChange({ target: { value: name } })
  }
  await new Promise((r) => setTimeout(r, 30))
  const goBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('✨ 生成'))
  assert.ok(goBtn, 'generator submit button rendered')
  goBtn.click()
  await new Promise((r) => setTimeout(r, 50))
}

await checkAsync('generate submit launches the generator script via startRun and shows the busy card', async () => {
  let started = null
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    'workflowAdmin/startRun': (args) => { started = args; return { ok: true, value: { id: 'wf_gen_1', status: 'running' } } },
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  await submitGeneration(panel, '审查代码', 'review-flow')
  assert.ok(started, 'startRun called')
  assert.ok(started.spec.script.includes('await agent('), 'spec carries the generator script (subagent prompt)')
  assert.ok(started.spec.label.startsWith('✨ '), 'label carries the ✨ prefix')
  assert.equal(started.spec.args.description, '审查代码', 'args.description passes through')
  assert.equal(started.spec.args.name, 'review-flow', 'args.name passes the optional label through (the generator script reads args.name)')
  assert.ok(!('nameHint' in started.spec.args), 'the legacy nameHint field is gone from the payload')
  assert.ok(document.body.textContent.includes('已开始生成'), 'accepted toast shown')
  const goBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('生成中…'))
  assert.ok(goBtn, 'the generator card shows the generating state')
  assert.ok(goBtn.disabled, 'the submit button is disabled while generating')
  panel.unmount()
})

await checkAsync('a completed generation polls getRun and auto-saves into the library with a deduped name', async () => {
  const started = { current: null }
  const saves = []
  const getRunCalls = []
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [{ name: 'wf-dup', scope: 'global' }] }),
    'workflowAdmin/startRun': (args) => { started.current = args; return { ok: true, value: { id: 'wf_gen_2', status: 'running' } } },
    'workflowAdmin/getRun': (a) => { getRunCalls.push(a.runId); return { ok: true, value: { id: a.runId, status: 'completed', result: { name: 'wf-dup', script: 'return 1' } } } },
    'workflowAdmin/saveSaved': (args) => { saves.push(args); return { ok: true, value: { ok: true, record: { name: args.spec.name } } } },
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  await submitGeneration(panel, '审查代码')
  // 首次轮询在 2s 后；等待 getRun 落 completed → 自动存库 → toast。
  await new Promise((r) => setTimeout(r, 2400))
  assert.ok(getRunCalls.includes('wf_gen_2'), 'the panel polled workflowAdmin/getRun for the generator run')
  assert.equal(saves.length, 1, 'saveSaved called exactly once')
  assert.equal(saves[0].spec.name, 'wf-dup-2', 'name deduped against the existing global entry (-2)')
  assert.equal(saves[0].spec.scope, 'global', 'auto-save writes global scope')
  assert.equal(saves[0].spec.script, 'return 1', 'the returned script is saved')
  assert.equal(saves[0].spec.description, '审查代码', 'the one-line description is stored')
  assert.ok(document.body.textContent.includes('已保存到工作库：wf-dup-2'), 'saved toast shown')
  const goBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('✨ 生成'))
  assert.ok(goBtn && !goBtn.disabled, 'the generator card is idle again after settling')
  panel.unmount()
})

await checkAsync('an errored generation toasts failure and never calls saveSaved', async () => {
  const saves = []
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    'workflowAdmin/startRun': () => ({ ok: true, value: { id: 'wf_gen_3', status: 'running' } }),
    'workflowAdmin/getRun': () => ({ ok: true, value: { id: 'wf_gen_3', status: 'errored' } }),
    'workflowAdmin/saveSaved': (args) => { saves.push(args); return { ok: true, value: { ok: true, record: { name: args.spec.name } } } },
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  await submitGeneration(panel, '审查代码')
  await new Promise((r) => setTimeout(r, 2400))
  assert.deepEqual(saves, [], 'saveSaved never called on failure')
  assert.ok(document.body.textContent.includes('工作流生成失败'), 'failure toast shown')
  const goBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('✨ 生成'))
  assert.ok(goBtn && !goBtn.disabled, 'the generator card is idle again after settling')
  panel.unmount()
})

await checkAsync('listSaved failure fails closed: the auto-save name carries a timestamp suffix and cannot overwrite an existing entry', async () => {
  const saves = []
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: false, error: 'storage unavailable' }),
    'workflowAdmin/startRun': () => ({ ok: true, value: { id: 'wf_gen_4', status: 'running' } }),
    'workflowAdmin/getRun': () => ({ ok: true, value: { id: 'wf_gen_4', status: 'completed', result: { name: 'my-flow', script: 'return 2' } } }),
    'workflowAdmin/saveSaved': (args) => { saves.push(args); return { ok: true, value: { ok: true, record: { name: args.spec.name } } } },
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  await submitGeneration(panel, '审查代码')
  await new Promise((r) => setTimeout(r, 2400))
  assert.equal(saves.length, 1, 'saveSaved still called exactly once without the dedup list')
  assert.notEqual(saves[0].spec.name, 'my-flow', 'the bare name is never saved blind (saveSaved is an overwrite-by-name write)')
  assert.match(saves[0].spec.name, /^my-flow-[0-9a-z]+$/, 'the saved name carries a base36 timestamp suffix')
  assert.equal(saves[0].spec.script, 'return 2', 'the returned script is still auto-saved')
  assert.ok(document.body.textContent.includes('已保存到工作库：my-flow-'), 'saved toast shows the suffixed name')
  panel.unmount()
})

// ─── 轮询放弃：退避时间线共 150s 虚拟时间，用假时钟压缩 ─────────────────────
// ≥1000ms 的 setTimeout 进虚拟时钟（轮询退避 2s..30s 全部落在这半边），更短
// 的延时照走真实时钟（测试自身的节奏等待、toast 淡出等），restore 恢复原样。
function makeFakeClock() {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  let now = 0
  let seq = 0
  const virtual = new Map()
  globalThis.setTimeout = (fn, delay) => {
    delay = delay || 0
    if (delay < 1000) return realSetTimeout(fn, delay)
    const id = ++seq
    virtual.set(id, { fn, at: now + delay })
    return id
  }
  globalThis.clearTimeout = (id) => {
    if (virtual.has(id)) { virtual.delete(id); return }
    return realClearTimeout(id)
  }
  async function advance(ms) {
    const end = now + ms
    for (;;) {
      let dueId = null
      let dueAt = Infinity
      for (const [id, t] of virtual) {
        if (t.at <= end && t.at < dueAt) { dueId = id; dueAt = t.at }
      }
      if (dueId === null) break
      const t = virtual.get(dueId)
      virtual.delete(dueId)
      now = dueAt
      t.fn()
      // 每个 timer 之间让真实事件循环转一圈：promise 链与 React 更新得以落地
      await new Promise((resolve) => realSetTimeout(resolve, 0))
    }
    now = end
  }
  return {
    advance,
    restore: () => {
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    },
  }
}

await checkAsync('getRun transport failures give up after 8 attempts: busy resets, an error toast appears and polling stops', async () => {
  let getRunCalls = 0
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    'workflowAdmin/startRun': () => ({ ok: true, value: { id: 'wf_gen_fail', status: 'running' } }),
    'workflowAdmin/getRun': () => { getRunCalls += 1; return { ok: false, error: 'gateway down' } },
  }
  const clock = makeFakeClock()
  try {
    const panel = renderPanel(makeCall(rpc))
    await new Promise((r) => setTimeout(r, 30))
    await submitGeneration(panel, '审查代码')
    // 退避时间线 2s+4s+8s+16s+30s*4 = 150s：恰 8 次失败后放弃。
    await clock.advance(150000)
    assert.equal(getRunCalls, 8, 'polling stops after exactly 8 failed attempts')
    assert.ok(document.body.textContent.includes('生成状态查询失败，已停止跟踪：wf_gen_fail'), 'give-up error toast shown with the runId')
    const goBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('✨ 生成'))
    assert.ok(goBtn && !goBtn.disabled, 'the generator card is usable again after giving up')
    assert.ok(!panel.text().includes('生成中…'), 'no generating state remains on the card')
    assert.ok(!panel.text().includes('已开始生成，完成后自动存入工作库'), 'the run left the generating ledger')
    await clock.advance(60000)
    assert.equal(getRunCalls, 8, 'no further polls after giving up')
    panel.unmount()
  } finally {
    clock.restore()
  }
})

await checkAsync('a missing run record counts as a polling failure and gives up the same way', async () => {
  let getRunCalls = 0
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    'workflowAdmin/startRun': () => ({ ok: true, value: { id: 'wf_gen_gone', status: 'running' } }),
    'workflowAdmin/getRun': () => { getRunCalls += 1; return { ok: true, value: null } },
  }
  const clock = makeFakeClock()
  try {
    const panel = renderPanel(makeCall(rpc))
    await new Promise((r) => setTimeout(r, 30))
    await submitGeneration(panel, '审查代码')
    await clock.advance(150000)
    assert.equal(getRunCalls, 8, 'missing records count as failures instead of resetting the count')
    assert.ok(document.body.textContent.includes('生成状态查询失败，已停止跟踪：wf_gen_gone'), 'give-up error toast shown')
    const goBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('✨ 生成'))
    assert.ok(goBtn && !goBtn.disabled, 'the generator card is usable again after giving up')
    panel.unmount()
  } finally {
    clock.restore()
  }
})

// ─── 结果 ─────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-client checks passed')
