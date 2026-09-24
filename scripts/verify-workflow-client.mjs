/**
 * verify-workflow-client.mjs — P3 浏览器侧自检
 *
 * 跑法：node scripts/verify-workflow-client.mjs
 *
 * 用 jsdom 真实渲染 WorkflowSection（与 self-check.mjs 同一套装载方式），
 * mock RPC 层，验证：面板装载 / 标签切换 / 运行卡片渲染 / 启动诊断回显 /
 * 工作库保存-列表-删除 / 降级提示。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'
import TestUtils from 'react-dom/test-utils'

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

const clientExports = registrations[0].factory((spec) => {
  if (spec === 'react') return React
  if (spec === 'react-dom/client') return { createRoot }
  throw new Error(`require("${spec}") missed the platform table`)
})

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

function renderPanel(call) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // act 包裹：React 18 的并发渲染需要 act 才能同步取到结果
  const act = TestUtils.act
  const Comp = clientExports.WorkflowSection
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

// WorkflowSection rides module.exports alongside SessionsSection/WorkspacesSection
// (the dsh module loader reads only apply/inject/Config, so the extra key is
// inert at runtime — it exists purely for this self-check).
const WorkflowSection = clientExports.WorkflowSection
assert.ok(typeof WorkflowSection === 'function', 'WorkflowSection exported for the self-check')

console.log('WorkflowSection:')

await checkAsync('renders empty runs tab + new-run button', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(panel.text().includes('暂无运行'), 'empty hint shown')
  assert.ok(panel.container.querySelector('button'), 'has buttons')
  panel.unmount()
})

await checkAsync('renders run cards with status pills', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({
      ok: true,
      value: { active: [
        { id: 'wf_1', label: 'audit', status: 'running', stepCount: 3 },
        { id: 'wf_2', label: 'migrate', status: 'completed', stepCount: 10, durationMs: 12340 },
      ] },
    }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const text = panel.text()
  assert.ok(text.includes('audit'), 'run label rendered')
  assert.ok(text.includes('运行中'), 'running pill rendered')
  assert.ok(text.includes('已完成'), 'completed pill rendered')
  assert.ok(text.includes('migrate'), 'second run rendered')
  panel.unmount()
})

await checkAsync('stop button only on running runs', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({
      ok: true,
      value: { active: [
        { id: 'wf_1', label: 'a', status: 'running' },
        { id: 'wf_2', label: 'b', status: 'errored' },
      ] },
    }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  // 每个 .card 是一条运行；停止只在 running 卡片上，续跑只在 errored 卡片上
  const cards = [...panel.queryAll('.card')].map((c) => ({
    text: c.textContent,
    buttons: [...c.querySelectorAll('button')].map((b) => b.textContent),
  }))
  const runningCard = cards.find((c) => c.text.includes('a'))
  const failedCard = cards.find((c) => c.text.includes('b'))
  assert.ok(runningCard && failedCard, 'both run cards rendered')
  assert.ok(runningCard.buttons.some((t) => t.includes('⏹ 停止')), 'stop button on running card')
  assert.ok(!runningCard.buttons.some((t) => t.includes('▶ 续跑')), 'resume absent on running card')
  assert.ok(!failedCard.buttons.some((t) => t.includes('⏹ 停止')), 'stop absent on errored card')
  assert.ok(failedCard.buttons.some((t) => t.includes('▶ 续跑')), 'resume on errored card')
  panel.unmount()
})

await checkAsync('tabs switch to saved library', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [
      { name: 'audit', scope: 'global', description: '审查代码' },
      { name: 'migrate', scope: 'project' },
    ] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const savedTab = [...panel.queryAll('button')].find((b) => b.textContent.includes('工作库'))
  assert.ok(savedTab, 'saved tab button exists')
  savedTab.click()
  await new Promise((r) => setTimeout(r, 30))
  const text = panel.text()
  assert.ok(text.includes('audit'), 'saved entry rendered')
  assert.ok(text.includes('全局'), 'global scope pill rendered')
  assert.ok(text.includes('项目'), 'project scope pill rendered')
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

await checkAsync('editor opens with example script', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const newBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('新建工作流'))
  assert.ok(newBtn, 'new-run button exists')
  newBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  const text = panel.text()
  assert.ok(text.includes('parallel('), 'example script prefilled')
  assert.ok(text.includes('🚀 启动'), 'submit button rendered')
  panel.unmount()
})

await checkAsync('run editor offers a parent-session picker when several sessions are live', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    // 未 mock sessionAdmin/list 时 makeCall 返回 {ok:false}，面板必须软失败不受阻塞。
    'sessionAdmin/list': () => ({
      ok: true,
      value: { sessions: [
        { id: 'sess-a', live: true, title: 'Alpha', cwd: '/a' },
        { id: 'sess-b', live: true, title: 'Beta', cwd: '/b' },
      ] },
    }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const newBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('新建工作流'))
  newBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  const select = panel.container.querySelector('select')
  assert.ok(select, 'parent session picker rendered')
  assert.equal(select.value, 'sess-a', 'auto-selects the first live session')
  assert.ok(panel.text().includes('Alpha · /a'), 'picker lists live sessions with title + cwd')
  panel.unmount()
})

await checkAsync('compile diagnostics surface in editor', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    // 网关形状：宿主载荷包在 { ok, value } 里（真实 rpc.call 的返回即此形状）。
    'workflowAdmin/startRun': (spec) => ({
      ok: true,
      value: { id: null, status: 'errored', diagnostics: [{ category: 'error', message: 'Unexpected token' }] },
    }),
  }
  const call = makeCall(rpc)
  const panel = renderPanel(call)
  await new Promise((r) => setTimeout(r, 30))
  const newBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('新建工作流'))
  newBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  const submit = [...panel.queryAll('button')].find((b) => b.textContent.includes('🚀 启动'))
  submit.click()
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(panel.text().includes('Unexpected token'), 'diagnostic shown in editor')
  panel.unmount()
})

await checkAsync('successful start switches to runs tab via the gateway envelope', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [{ id: 'wf_1_abc', label: 'w', status: 'running' }] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    'workflowAdmin/startRun': () => ({ ok: true, value: { id: 'wf_9_xyz', status: 'running', diagnostics: [] } }),
  }
  const call = makeCall(rpc)
  const panel = renderPanel(call)
  await new Promise((r) => setTimeout(r, 30))
  const newBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('新建工作流'))
  newBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  const submit = [...panel.queryAll('button')].find((b) => b.textContent.includes('🚀 启动'))
  submit.click()
  await new Promise((r) => setTimeout(r, 50))
  // toast 渲染在 document.body 单例上，不在面板容器内。
  assert.ok(document.body.textContent.includes('🚀 工作流已启动'), 'success toast shown')
  assert.ok(panel.text().includes('w'), 'switched to the runs tab (run row visible)')
  panel.unmount()
})

await checkAsync('stop surfaces the abandoned warning from the envelope', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [{ id: 'wf_1_abc', label: 'w', status: 'running' }] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    'workflowAdmin/stopRun': () => ({ ok: true, value: { stopped: true, reason: 'panel', abandoned: true } }),
  }
  const call = makeCall(rpc)
  const panel = renderPanel(call)
  await new Promise((r) => setTimeout(r, 30))
  const stopBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('⏹'))
  assert.ok(stopBtn, 'stop button rendered for the active run')
  stopBtn.click()
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(document.body.textContent.includes('未在预算内落定'), 'abandoned warning shown')
  panel.unmount()
})

await checkAsync('saved editor validates empty name', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({ ok: true, value: { active: [] } }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    'workflowAdmin/saveSaved': () => ({ ok: true, record: { name: 'x' } }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const savedTab = [...panel.queryAll('button')].find((b) => b.textContent.includes('工作库'))
  savedTab.click()
  await new Promise((r) => setTimeout(r, 30))
  const newSaved = [...panel.queryAll('button')].find((b) => b.textContent.includes('保存一个工作流'))
  newSaved.click()
  await new Promise((r) => setTimeout(r, 30))
  const saveBtn = [...panel.queryAll('button')].find((b) => b.textContent.includes('💾 保存'))
  saveBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(panel.text().includes('名称和脚本不能为空'), 'validation error shown')
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
  const savedTab = [...panel.queryAll('button')].find((b) => b.textContent.includes('工作库'))
  savedTab.click()
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

await checkAsync('run detail loads and shows script', async () => {
  const rpc = {
    'workflowAdmin/listRuns': () => ({
      ok: true,
      value: { active: [{ id: 'wf_1', label: 'audit', status: 'completed', stepCount: 2 }] },
    }),
    'workflowAdmin/listSaved': () => ({ ok: true, value: [] }),
    'workflowAdmin/getRun': (args) => ({
      ok: true,
      value: { id: args.runId, label: 'audit', status: 'completed', script: 'return 42', result: 42, log: [{ kind: 'log', message: 'hi' }] },
    }),
  }
  const panel = renderPanel(makeCall(rpc))
  await new Promise((r) => setTimeout(r, 30))
  const detailBtn = [...panel.queryAll('button')].find((b) => b.textContent === '详情')
  detailBtn.click()
  await new Promise((r) => setTimeout(r, 30))
  const text = panel.text()
  assert.ok(text.includes('return 42'), 'script shown in detail')
  assert.ok(text.includes('42'), 'result shown')
  assert.ok(text.includes('[log] hi'), 'log entry rendered')
  panel.unmount()
})

// ─── 结果 ─────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-client checks passed')
