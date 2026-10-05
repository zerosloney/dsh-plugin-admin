/**
 * verify-automation-client.mjs — 自动化页签浏览器侧自检
 *
 * 跑法：node scripts/verify-automation-client.mjs
 *
 * 用 jsdom 真实渲染 AutomationSection（与 verify-workflow-client.mjs 同一套
 * 装载方式），mock RPC 层，验证定时任务 / Webhook 两个编辑器的布局契约：
 * card-header 标题行（新建/编辑 + 启用开关）、小标签字段组、调度内嵌面板、
 * 动作模式两个分支（推送既有会话 / 新建会话）的带标签字段、密钥预填。
 * 这批断言钉住的是 v1.27.7 编辑器重排的结构——字段绑定另有门禁（i18n 双向
 * 校验、tsc、self-check），这里只看「该出现的结构真的出现」。
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

// ─── 装载 client.js（与 verify-workflow-client.mjs 同一套）──────────────────

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
const panels = await clientExports.loadPanels()
assert.ok(typeof panels.AutomationSection === 'function', 'AutomationSection exported for the self-check')

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

// ─── mock RPC ───────────────────────────────────────────────────────────────

function makeCall(rpc) {
  return (method, args) => {
    const handler = rpc[method]
    if (!handler) return Promise.resolve({ ok: false, error: `unknown method ${method}` })
    return Promise.resolve(handler(args || {}))
  }
}

// ─── 渲染工具 ────────────────────────────────────────────────────────────────

const rpc = {
  'cronAdmin/list': () => ({ ok: true, value: { tasks: [], history: [], storagePath: 'E:\\tmp\\cron.json' } }),
  'webhookAdmin/list': () => ({ ok: true, value: { rules: [], history: [], presets: [{ id: 'cordis', name: 'cordis' }], permissionPresetNames: ['workspace-write'], storagePath: 'E:\\tmp\\hook.json', runtimeMounted: true, runtimePackageInstalled: true, endpointOnline: false } }),
}
const act = TestUtils.act
const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)
act(() => { root.render(React.createElement(panels.AutomationSection, { call: makeCall(rpc) })) })

const settle = () => new Promise((r) => setTimeout(r, 30))
const text = () => container.textContent
const propsOf = (el) => el[Object.keys(el).find((k) => k.startsWith('__reactProps$'))]
function clickButton(needle) {
  const btn = [...container.querySelectorAll('button')].find((b) => (b.textContent || '').includes(needle))
  assert.ok(btn !== undefined, `button not found: ${needle}`)
  act(() => { propsOf(btn).onClick({}) })
}
/** The editor card scope for structural queries. */
function editor() {
  const el = container.querySelector('.mcp-editor')
  assert.ok(el !== null, 'editor card rendered')
  return el
}

console.log('AutomationSection (定时任务 / Webhook 编辑器布局契约):')

await checkAsync('cron tab mounts with guide bar and template cards', async () => {
  await settle()
  assert.ok(text().includes('定时任务 = 到点自动给 dsh 发一句话'), 'guide bar shown')
  assert.ok(text().includes('从模板开始'), 'template row shown')
})

await checkAsync('cron editor opens: header title + enabled toggle (no bare first row)', async () => {
  clickButton('+ 新建任务')
  await settle()
  const header = editor().querySelector('.card-header')
  assert.ok(header !== null, 'card-header present')
  assert.ok(header.textContent.includes('新建定时任务'), 'header title 新建定时任务')
  assert.ok(header.textContent.includes('启用'), '启用 toggle lives in the header')
})

await checkAsync('cron editor field groups carry their labels', async () => {
  for (const label of ['任务 ID', '调度（本地时区 GMT', '动作模式', '目标会话', 'Prompt 模板']) {
    assert.ok(editor().textContent.includes(label), `label "${label}" present`)
  }
})

await checkAsync('cron schedule controls compose on the inset panel', async () => {
  assert.ok(editor().querySelector('select[aria-label="调度频率"]') !== null, 'frequency select present')
  assert.ok(editor().querySelector('input[aria-label="时间"]') !== null, 'time input present (daily default)')
  const mode = editor().querySelector('select[aria-label="调度频率"]')
  act(() => { propsOf(mode).onChange({ target: { value: 'hourly' } }) })
  await settle()
  assert.ok(editor().querySelector('select[aria-label="分钟"]') !== null, 'minute select appears in hourly mode')
})

await checkAsync('cron custom mode swaps the structured fields for the raw cron input', async () => {
  const mode = editor().querySelector('select[aria-label="调度频率"]')
  act(() => { propsOf(mode).onChange({ target: { value: 'custom' } }) })
  await settle()
  assert.ok(editor().querySelector('input[aria-label="cron 表达式"]') !== null, 'raw cron input present')
  assert.ok(editor().textContent.includes('5 位 cron（分 时 日 月 周）'), 'custom-mode syntax hint shown')
})

await checkAsync('cron create mode: labeled workspace + preset fields', async () => {
  clickButton('新建会话')
  await settle()
  for (const label of ['工作区路径', 'Agent 预设', '权限预设']) {
    assert.ok(editor().textContent.includes(label), `label "${label}" present`)
  }
  const preset = editor().querySelector('select[aria-label="Agent 预设"]')
  assert.ok(preset !== null, 'agent preset select present')
  assert.ok(preset.options.length >= 1, 'agent preset has options')
})

await checkAsync('webhook tab mounts and its editor opens with header title', async () => {
  clickButton('Webhook')
  await settle()
  clickButton('+ 新建规则')
  await settle()
  const header = editor().querySelector('.card-header')
  assert.ok(header !== null, 'card-header present')
  assert.ok(header.textContent.includes('新建规则'), 'header title 新建规则')
  assert.ok(header.textContent.includes('启用'), '启用 toggle lives in the header')
})

await checkAsync('webhook editor field groups carry their labels', async () => {
  for (const label of ['共享密钥', '事件过滤', '动作模式', '目标会话', 'Prompt 模板']) {
    assert.ok(editor().textContent.includes(label), `label "${label}" present`)
  }
})

await checkAsync('webhook fresh draft seeds a 16-char secret', async () => {
  const secret = [...editor().querySelectorAll('input')].find((i) => (i.value || '').length === 16)
  assert.ok(secret !== undefined, '16-char secret input present')
})

await checkAsync('webhook create mode: labeled workspace + preset fields', async () => {
  clickButton('新建会话')
  await settle()
  for (const label of ['工作区路径', 'Agent 预设', '权限预设']) {
    assert.ok(editor().textContent.includes(label), `label "${label}" present`)
  }
})

act(() => { root.unmount() })
container.remove()

if (failures > 0) {
  console.error(`verify-automation-client: ${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('verify-automation-client: 10 checks OK (cron/webhook editor layout contract)')
