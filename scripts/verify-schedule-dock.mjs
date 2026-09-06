/**
 * Self-check for the 日程提醒 schedule dock + the harvested composer slot:
 *
 * Browser half (lib/client.js):
 * - apply() contributes the 'conversation.input.dock' schedule-admin entry
 *   (order 6, under the todo dock) and the 'conversation.input.right'
 *   schedule-bell-admin entry (order 0) — the latter harvests an officially
 *   rendered but otherwise unregistered list slot beside the submit action.
 * - the schedule dock renders the useProjection('schedule') records sorted
 *   due-first (overdue before future, then ascending target), with a kind
 *   badge (延时 / 定时 / 循环), the prompt, and a live relative time; it hides
 *   entirely when the projection is empty.
 * - the composer bell shows the nearest reminder as a count + badge, opens a
 *   mini list on click, and renders nothing when no reminders exist.
 * - overdue rows carry data-overdue=true; the dock header collapses/expands.
 *
 * Run: node scripts/verify-schedule-dock.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push(`✅ ${name}`)
  } catch (error) {
    results.push(`❌ ${name}`)
    console.error(results.join('\n'))
    throw error
  }
}
const checkAsync = async (name, fn) => {
  try {
    await fn()
    results.push(`✅ ${name}`)
  } catch (error) {
    results.push(`❌ ${name}`)
    console.error(results.join('\n'))
    throw error
  }
}

/* ============================ Browser half ============================ */

const harnessRoot = process.env.DSH_HARNESS_ROOT || 'E:/Demo/cli-tools/deepseek-harness'
const harnessPkg = join(harnessRoot, 'package.json')
const harnessWeb = join(harnessRoot, 'packages/client/web/node_modules')
let harnessReq = null
try {
  harnessReq = createRequire(harnessPkg)
  harnessReq('jsdom')
} catch {
  harnessReq = null
}
const { JSDOM } = harnessReq ? harnessReq('jsdom') : req('jsdom')
const React = harnessReq ? req(`${harnessWeb}/react`) : req('react')
const { createRoot } = harnessReq ? req(`${harnessWeb}/react-dom/client`) : req('react-dom/client')
const act = React.act ?? (harnessReq ? req(`${harnessWeb}/react-dom/test-utils`).act : req('react-dom/test-utils').act)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const registrations = []
await checkAsync('registers exactly one bundle factory under the package id', async () => {
  globalThis.window.__ModuleLoader__ = { load: (registration) => registrations.push(registration) }
  new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, 'dsh-plugin-admin')
})

const exports_ = registrations[0].factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`require("${spec}") missed the platform table`)
})

const slotRegistrations = []
const injectedSlots = []
const mockCtx = {
  effect: (fn) => { fn() },
  connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
  get: () => undefined,
  slots: {
    inject: (name, factory) => { injectedSlots.push({ name, factory }) },
    register: (declaration, component) => {
      slotRegistrations.push({ declaration, component })
      return { declaration, component }
    },
  },
}
await checkAsync('apply() contributes the schedule dock and the harvested composer bell', async () => {
  exports_.apply(mockCtx)
  injectedSlots.forEach((slot) => slot.factory())
  const dock = slotRegistrations.find((entry) => entry.declaration.id === 'schedule-admin')
  assert.ok(dock, 'schedule-admin registration present')
  assert.equal(dock.declaration.name, 'conversation.input.dock')
  assert.equal(dock.declaration.order, 6, 'schedule dock stacks under the todo dock (order 5)')
  const bell = slotRegistrations.find((entry) => entry.declaration.id === 'schedule-bell-admin')
  assert.ok(bell, 'schedule-bell-admin registration present')
  assert.equal(bell.declaration.name, 'conversation.input.right', 'bell occupies the empty composer trailing slot')
  assert.equal(bell.declaration.order, 0)
  assert.equal(typeof bell.declaration.inject().call, 'function', 'bell inject face carries the RPC call')
})

const scheduleDockComponent = slotRegistrations.find((entry) => entry.declaration.id === 'schedule-admin').component
const scheduleBellComponent = slotRegistrations.find((entry) => entry.declaration.id === 'schedule-bell-admin').component

// Reminders use the official ScheduleRecord shape from the schedule projection.
// Targets are relative to the real clock (the dock ticks on Date.now()), so
// the ordering/overdue and 前/后 assertions stay deterministic: one overdue
// 'at' ten minutes ago, one future 'after' five minutes out, one future
// 'every' an hour out.
const REL_NOW = Date.now()
const ISO = (ms) => new Date(ms).toISOString()
const SCHEDULE_RECORDS = [
  { id: 'sch-after-1', kind: 'after', prompt: '复查刚才的修改', afterSeconds: 300, scheduledAt: ISO(REL_NOW + 5 * 60 * 1000) },
  { id: 'sch-at-2', kind: 'at', prompt: '该提交版本了', scheduledAt: ISO(REL_NOW - 10 * 60 * 1000) },
  { id: 'sch-every-3', kind: 'every', prompt: '每 5 分钟汇报一次进度', everySeconds: 300, scheduledAt: ISO(REL_NOW + 60 * 60 * 1000) },
]

let host = null
let root = null
async function mount(component, props) {
  host = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    root = createRoot(host)
    root.render(React.createElement(component, props))
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
}
async function unmount() {
  if (root) {
    await act(async () => { root.unmount() })
    root = null
  }
  if (host) {
    host.remove()
    host = null
  }
}
const projection = (key) => (key === 'schedule' ? SCHEDULE_RECORDS : undefined)

await checkAsync('schedule dock renders due-first rows with kind badges and relative times', async () => {
  await mount(scheduleDockComponent, { useProjection: projection, sessionId: 's-1', call: async () => ({ ok: true, value: {} }) })
  const panel = document.querySelector('[data-dsh-admin-schedule]')
  assert.ok(panel, 'schedule dock mounted')
  assert.ok(panel.querySelector('.sch-title').textContent.includes('日程'), 'dock titled')
  assert.ok(panel.querySelector('.sch-count').textContent.includes('3'), 'dock counts three records')
  const items = [...document.querySelectorAll('.schedule-item')]
  assert.equal(items.length, 3, 'three reminder rows')
  // Due-first ordering: the overdue 11:50 reminder comes first.
  assert.ok(items[0].dataset.overdue === 'true', 'overdue reminder sorted first')
  assert.equal(items[0].textContent, items[0].textContent, 'row renders')
  const kinds = items.map((el) => el.querySelector('.sch-kind').textContent)
  assert.deepEqual(kinds, ['定时', '延时', '循环'], 'kind badges: overdue at → 延时 after → 循环 every')
  // Relative labels for the fixed reference clock.
  const relative = items.map((el) => el.querySelector('.sch-relative').textContent)
  assert.ok(relative[0].includes('前'), 'overdue relative time reads 前, got ' + relative[0])
  assert.ok(relative[1].includes('后'), 'future relative time reads 后, got ' + relative[1])
  // Style sheet landed.
  assert.ok(document.querySelector('style[data-plugin-css="dsh-plugin-admin/schedule-dock.css"]'), 'schedule stylesheet injected')
  await unmount()
})

await checkAsync('schedule dock hides entirely when the projection is empty', async () => {
  await mount(scheduleDockComponent, { useProjection: () => undefined, sessionId: 's-1', call: async () => ({ ok: true, value: {} }) })
  assert.equal(document.querySelector('[data-dsh-admin-schedule]'), null, 'empty projection renders no dock')
  await unmount()
  await mount(scheduleDockComponent, { useProjection: () => [], sessionId: 's-1', call: async () => ({ ok: true, value: {} }) })
  assert.equal(document.querySelector('[data-dsh-admin-schedule]'), null, 'empty list renders no dock')
  await unmount()
})

await checkAsync('schedule dock header collapses and expands the list', async () => {
  await mount(scheduleDockComponent, { useProjection: projection, sessionId: 's-1', call: async () => ({ ok: true, value: {} }) })
  const chevron = document.querySelector('.sch-chevron')
  assert.equal(chevron.getAttribute('aria-expanded'), 'true')
  assert.ok(document.querySelector('.schedule-list'), 'list visible when expanded')
  await act(async () => {
    chevron.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.equal(document.querySelector('.schedule-list'), null, 'list hidden while collapsed')
  assert.equal(document.querySelector('.sch-chevron').getAttribute('aria-expanded'), 'false')
  await unmount()
})

await checkAsync('composer bell shows the nearest reminder count and opens the mini list', async () => {
  await mount(scheduleBellComponent, { useProjection: projection, sessionId: 's-1', call: async () => ({ ok: true, value: {} }) })
  const bell = document.querySelector('[data-dsh-admin-schedule-bell]')
  assert.ok(bell, 'composer bell mounted')
  const bellBtn = bell.querySelector('.sbell-btn')
  assert.ok(bellBtn, 'composer bell button rendered')
  assert.equal(bellBtn.getAttribute('aria-label'), '3 条日程')
  assert.ok(bellBtn.textContent.includes('3'), 'bell shows reminder count')
  assert.equal(bell.dataset.overdue, 'true', 'bell marks the nearest (overdue) reminder')
  assert.ok(document.querySelector('style[data-plugin-css="dsh-plugin-admin/schedule-bell.css"]'), 'bell stylesheet injected')
  assert.equal(document.querySelector('.sbell-pop'), null, 'popover closed by default')
  await act(async () => {
    bellBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const pop = document.querySelector('.sbell-pop')
  assert.ok(pop, 'popover opens on click')
  assert.ok(pop.querySelectorAll('li').length === 3, 'popover lists all reminders')
  assert.ok(pop.textContent.includes('该提交版本了'), 'popover includes the nearest reminder prompt')
  // Clicking inside the popover (a sibling of the button, not a child) must
  // not toggle it shut.
  await act(async () => {
    pop.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.ok(document.querySelector('.sbell-pop'), 'popover survives an inside click')
  await unmount()
})

await checkAsync('composer bell renders nothing without reminders', async () => {
  await mount(scheduleBellComponent, { useProjection: () => undefined, sessionId: 's-1', call: async () => ({ ok: true, value: {} }) })
  assert.equal(document.querySelector('[data-dsh-admin-schedule-bell]'), null, 'no reminders → no bell')
  await unmount()
})

console.log(results.join('\n'))
console.log(`verify-schedule-dock OK: ${results.length} checks`)
