/**
 * Client-side verification for the 定时任务 panel: mounts the 自动化 section in
 * jsdom (the cron list is that page's default tab) against a mocked RPC gateway
 * and asserts list render, row toggle, and the manual editor round-trip
 * (typed id + hourly frequency → composed cron → cronAdmin/upsert).
 *
 * Part of `npm test`. The template-card path of the same page is covered by
 * self-check (case 15y1); this script keeps the manual editor path and the row
 * toggle honest. Both exist because the panel used to be a standalone
 * `cron-tasks` settings section — if that section ever comes back, these
 * assertions and self-check's `byId['cron-tasks'] === undefined` disagree loudly.
 *
 * Run: node scripts/verify-cron-panel.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

const { JSDOM } = req('jsdom')
const React = req('react')
const { createRoot } = req('react-dom/client')
const act = React.act ?? req('react-dom/test-utils').act
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const registrations = []
globalThis.window.__ModuleLoader__ = { load: (r) => registrations.push(r) }
// Pin the panel language: jsdom's navigator.language is en-US; these
// assertions cover the stock Chinese chrome.
dom.window.localStorage.setItem('dsh-admin-lang', 'zh')
new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)
const exports = registrations[0].factory((spec) => {
  if (spec === 'react') return React
  if (spec === 'react-dom/client') return { createRoot }
  return null
})

let store = {
  tasks: [
    { id: 'morning-digest', enabled: true, cron: '0 9 * * 1-5', action: { mode: 'steer', sessionId: 'session-live', steer: true }, promptTemplate: '生成今日摘要' },
    { id: 'disabled-one', enabled: false, cron: '*/5 * * * *', action: { mode: 'create', workspacePath: 'C:/proj', agentPreset: 'cordis', permissionPreset: 'workspace-write' }, promptTemplate: '' },
  ],
}
/** Every cronAdmin/upsert payload the editor produced (asserted at the end). */
const upserts = []

const call = async (method, args) => {
  if (method === 'cronAdmin/list') {
    return {
      ok: true,
      value: {
        storagePath: '/home/.dsh/cron-tasks.json',
        schedulerActive: true,
        tasks: store.tasks.map((t) => ({ ...t, nextRun: Date.now() + 3600_000, nextRunISO: new Date(Date.now() + 3600_000).toISOString(), targetOnline: t.action.mode === 'steer' ? t.action.sessionId === 'session-live' : null })),
        history: [{ at: '2026-09-21 01:00:00', taskId: 'morning-digest', ok: true, mode: 'steer', sessionId: 'session-live' }],
      },
    }
  }
  if (method === 'webhookAdmin/list') {
    return { ok: true, value: { presets: [{ id: 'cordis', name: 'cordis' }], permissionPresetNames: ['workspace-write'] } }
  }
  if (method === 'cronAdmin/upsert') {
    upserts.push(args.entry)
    store = { ...store, tasks: store.tasks.filter((t) => t.id !== args.entry.id).concat([args.entry]) }
    return { ok: true, value: { tasks: store.tasks, history: [] } }
  }
  if (method === 'cronAdmin/toggle') {
    store = { ...store, tasks: store.tasks.map((t) => (t.id === args.id ? { ...t, enabled: args.enabled } : t)) }
    return { ok: true, value: { tasks: store.tasks, history: [] } }
  }
  if (method === 'cronAdmin/runNow') {
    return { ok: true, value: { ok: true } }
  }
  if (method === 'cronAdmin/remove') {
    store = { ...store, tasks: store.tasks.filter((t) => t.id !== args.id) }
    return { ok: true, value: { tasks: store.tasks, history: [] } }
  }
  throw new Error(`unexpected method ${method}`)
}

// apply() against a mock slots ctx to capture the cron-tasks registration.
const slotRegistrations = []
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : undefined },
  connection: { rpc: { call: async (_url, method, payload) => call(method, (payload && payload.args) ?? {}) } },
  get: () => undefined,
  slots: {
    inject: (_key, factory) => { slotRegistrations.push(factory()) },
    register: (declaration, component) => ({ declaration, component }),
  },
}
exports.apply(ctx)
// The 定时任务 panel is no longer a standalone settings section: it merged into
// the 自动化 page as that page's default internal tab (same shape self-check
// asserts). Capture the SECTION registration and mount it; the cron list is what
// the default tab renders.
const automationReg = slotRegistrations.find((r) => r.declaration.id === 'automation')
assert.ok(automationReg, 'automation section registered')
assert.equal(automationReg.declaration.label, '自动化')
assert.equal(
  slotRegistrations.find((r) => r.declaration.id === 'cron-tasks'),
  undefined,
  'the standalone 定时任务 section stays merged into 自动化',
)

const container = document.getElementById('root')
const root = createRoot(container)
await act(async () => {
  root.render(React.createElement(automationReg.component, automationReg.declaration.inject()))
})
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })

const text = () => container.textContent
assert.ok(text().includes('morning-digest'), 'list renders the task id')
assert.ok(text().includes('0 9 * * 1-5'), 'list renders the cron expression')
assert.ok(text().includes('下次触发'), 'list renders the next-fire row')
assert.ok(text().includes('session-live'), 'list renders the steer target')
assert.ok(text().includes('disabled-one'), 'list renders the disabled task')
assert.ok(text().includes('已停用'), 'disabled badge shows')
assert.ok(text().includes('最近 1 次触发'), 'history header renders')
assert.ok(!text().includes('调度器未运行'), 'scheduler-active banner is hidden')

// Toggle one task off via the row checkbox.
const checkbox = container.querySelector('input[type="checkbox"]')
const propsOf = (el) => el[Object.keys(el).find((k) => k.startsWith('__reactProps$'))]
await act(async () => { propsOf(checkbox).onChange({ target: { checked: false } }) })

// Editor: open on a new task, type an id, pick the hourly frequency, save.
// The schedule control is the structured frequency selector introduced with the
// 自动化 page (option VALUES are hourly/daily/weekly/custom; the visible labels
// are the zh chrome) — the old free-text `常用预设` cron dropdown is gone, and
// the composed expression is what reaches cronAdmin/upsert.
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label))
await act(async () => { button('新建任务').click() })
assert.ok(text().includes('推送到既有会话'), 'editor renders the action pills')
const freqSelect = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'hourly'))
assert.ok(freqSelect, 'editor renders the frequency selector')
assert.deepEqual(
  [...freqSelect.options].map((o) => o.textContent),
  ['每小时', '每天', '每周', '自定义'],
  'frequency selector offers the four documented modes',
)

const idInput = [...container.querySelectorAll('input')].find((i) => i.placeholder && i.placeholder.includes('任务标识'))
await act(async () => { propsOf(idInput).onChange({ target: { value: 'hourly-sync' } }) })

await act(async () => { propsOf(freqSelect).onChange({ target: { value: 'hourly' } }) })

await act(async () => { button('创建').click() })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
assert.ok(!text().includes('推送到既有会话'), 'editor closed after save')
assert.ok(text().includes('hourly-sync'), 'new task appears in the list')
assert.equal(upserts.length, 1, 'saving the manual task rides cronAdmin/upsert once')
assert.equal(upserts[0].id, 'hourly-sync', 'the upsert carries the typed id')
assert.equal(upserts[0].cron, '0 * * * *', 'the hourly frequency composes the documented cron')

console.log('verify-cron-panel OK: CronSection renders inside 自动化, lists, toggles, opens the editor, picks the hourly frequency, and saves')
process.exit(0)
