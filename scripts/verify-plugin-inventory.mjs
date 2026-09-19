/**
 * Ad-hoc verification for the Loader-runtime inventory sub-panel:
 *  1. Host without `ctx.pluginInventory` (base CLI bundle) → panel renders
 *     the "本部署未挂载 dsh-host-plugin-inventory" hint, NOT an error.
 *  2. Host with a populated snapshot → panel renders compact summary
 *     (counts by fiber phase + agent-preset count) and clicking the
 *     header expands a stable-sorted table.
 *  3. Failed fetch → panel renders the error hint with a retry button
 *     instead of a broken layout.
 *  4. Snapshot with agent-preset roster → expanded panel renders one
 *     sub-section per preset with each preset's rows and a `conditional`
 *     enabled badge when the preset carries a raw `!!js` expression.
 *  5. The collapsed header always renders the six documented phase badges
 *     (zero counts included).
 *  6. The REAL host module: missing/throwing `ctx.pluginInventory` answers
 *     `{ available: false }`, and the projection forwards only JSON-safe leaf
 *     fields (dropping malformed rows and never leaking a raw `!!js`
 *     `condition`).
 *  7. The header's entry count equals the number of rows the table renders
 *     (an entry with an empty moduleName still counts).
 *
 * Run: node scripts/verify-plugin-inventory.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

const harnessRoot = process.env.DSH_HARNESS_ROOT
const harnessWeb = harnessRoot === undefined ? '' : join(harnessRoot, 'packages/client/web/node_modules')
let harnessReq = null
if (harnessRoot !== undefined) {
  try {
    harnessReq = createRequire(join(harnessRoot, 'package.json'))
    harnessReq('jsdom')
  } catch {
    harnessReq = null
  }
}
const { JSDOM } = harnessReq ? harnessReq('jsdom') : req('jsdom')
const React = harnessReq ? req(`${harnessWeb}/react`) : req('react')
const { createRoot } = harnessReq ? req(`${harnessWeb}/react-dom/client`) : req('react-dom/client')
const act = React.act ?? (harnessReq ? req(`${harnessWeb}/react-dom/test-utils`).act : req('react-dom/test-utils').act)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://dsh.local/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const registrations = []
globalThis.window.__ModuleLoader__ = { load: (r) => registrations.push(r) }
new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)
const bundle = registrations[0].factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`require("${spec}") missed the platform table`)
})

// The host answers from this fixture table. Switch by reassigning
// inventoryAnswer between scenarios. The setEnabled RPC is a no-op here;
// the inventory panel is read-only.
const inventoryCalls = []
let inventoryAnswer = null
let inventoryThrow = false
const call = (method, args) => {
  if (method === 'pluginInventoryAdmin/list') {
    inventoryCalls.push(args)
    if (inventoryThrow) return Promise.reject(new Error('host unreachable'))
    return Promise.resolve({ ok: true, value: inventoryAnswer })
  }
  if (method === 'pluginAdmin/list') {
    return Promise.resolve({ ok: true, value: { profileDir: '', plugins: [] } })
  }
  return Promise.resolve({ ok: false, error: `unexpected ${method}` })
}

function mountPanel(container) {
  const injected = []
  const registered = []
  const ctx = {
    effect: () => () => {},
    connection: { rpc: { call: (route, method, payload) => call(method, payload.args) } },
    slots: {
      inject: (key, cb) => injected.push({ key, cb }),
      register: (options, component) => { registered.push({ options, component }); return () => {} },
    },
  }
  bundle.apply(ctx)
  injected.forEach((entry) => entry.cb())
  // 扩展插件 tab is the `extensions` settings.plugins.tab entry; mount its
  // component with the inject face (call()) so the panel can fire RPC.
  const extensions = registered.find((r) => r.options.id === 'extensions')
  if (extensions === undefined) throw new Error('extensions settings.plugins.tab not registered')
  const face = extensions.options.inject()
  const root = createRoot(container)
  root.render(React.createElement(extensions.component, face))
  return { root, face }
}

// --- Scenario 1: host does not expose ctx.pluginInventory (CLI mode) -------
// The base CLI bundle omits `dsh-host-plugin-inventory`; the host's list()
// answer carries `reason: 'service-absent'` and the panel renders a one-line
// hint, not an error.
inventoryAnswer = { available: false, reason: 'service-absent', entries: [], agentPresets: [] }
const host1 = document.body.appendChild(document.createElement('div'))
const s1 = mountPanel(host1)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('本部署未挂载 dsh-host-plugin-inventory'),
  'CLI-mode unavailable hint renders')
assert.ok(!document.body.textContent.includes('⚠ 失败'),
  'no failed chip when inventory is unavailable')
s1.root.unmount()
document.body.removeChild(host1)
console.log('scenario 1 OK: unavailable-inventory state renders a quiet hint')

// --- Scenario 1b: a MOUNTED service that failed is NOT reported as absent ---
// The distinction matters: "本部署没装" must never mask a broken host.
inventoryAnswer = {
  available: false,
  reason: 'call-failed',
  error: 'pluginInventory.list() exploded',
  entries: [],
  agentPresets: [],
}
const host1b = document.body.appendChild(document.createElement('div'))
const s1b = mountPanel(host1b)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('读取 Loader 快照失败'),
  'a failed host call renders the error wording')
assert.ok(document.body.textContent.includes('pluginInventory.list() exploded'),
  'the host error reason is surfaced')
assert.ok(!document.body.textContent.includes('本部署未挂载 dsh-host-plugin-inventory'),
  'a failed call is not misreported as "not mounted"')
s1b.root.unmount()
document.body.removeChild(host1b)
console.log('scenario 1b OK: a failed host call is distinguished from an absent service')

// --- Scenario 2: populated snapshot → summary + expand → stable-sorted table
inventoryAnswer = {
  available: true,
  entries: [
    { entryId: 'alpha', moduleName: '@scope/alpha', enabled: true, fiberPhase: 'active' },
    { entryId: 'beta', moduleName: '@scope/beta', enabled: true, fiberPhase: 'failed' },
    { entryId: 'gamma', moduleName: '@scope/gamma', enabled: false, fiberPhase: null },
    { entryId: 'delta', moduleName: '@scope/delta', enabled: true, fiberPhase: 'loading' },
    { entryId: 'epsilon', moduleName: '@scope/epsilon', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'zeta', moduleName: '@scope/zeta', enabled: true, fiberPhase: 'pending' },
  ],
  agentPresets: [
    {
      id: 'preset-default',
      name: '默认 Agent',
      trust: 'system',
      isDefault: true,
      rows: [
        { entryId: 'alpha', moduleName: '@scope/alpha', enabled: true, fiberPhase: 'active' },
        { entryId: 'gamma', moduleName: '@scope/gamma', enabled: false, fiberPhase: null },
        { entryId: 'conditional', moduleName: '@scope/conditional', enabled: 'conditional', fiberPhase: null },
      ],
    },
    {
      id: 'preset-user',
      name: '用户预设',
      trust: 'user',
      isDefault: false,
      broken: 'parse failed at line 3',
      rows: [],
    },
  ],
}
inventoryCalls.length = 0
const host2 = document.body.appendChild(document.createElement('div'))
const s2 = mountPanel(host2)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
// Summary chips:
assert.ok(document.body.textContent.includes('🟢 1 已激活'), 'active count rendered in summary')
assert.ok(document.body.textContent.includes('⚪ 1 未挂载'), 'unmounted count rendered in summary')
assert.ok(document.body.textContent.includes('⏳ 1 加载中'), 'loading count rendered in summary')
assert.ok(document.body.textContent.includes('⏳ 1 等待挂载'), 'pending count rendered in summary')
assert.ok(document.body.textContent.includes('🟡 1 卸载中'), 'unloading count rendered in summary')
assert.ok(document.body.textContent.includes('⚠ 失败 1'), 'failed chip rendered')
assert.ok(document.body.textContent.includes('· 2 个 Agent 预设'), 'preset count rendered')
// Table not yet rendered — collapsed by default.
assert.ok(!document.body.textContent.includes('@scope/beta'),
  'collapsed view hides the entries table')
// Click the header to expand.
const header = [...document.querySelectorAll('div')].find((el) =>
  el.className === 'group-header' && el.textContent.includes('Loader 运行时'))
assert.ok(header, 'inventory header is present')
await act(async () => {
  header.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
// Sorted order: failed → unloading → loading → active → (unmounted null) → none
const renderedOrder = []
const moduleSpans = [...document.querySelectorAll('span')]
  .filter((s) => /@scope\/(alpha|beta|gamma|delta|epsilon|zeta)/.test(s.textContent || ''))
for (const span of moduleSpans) {
  const m = /@scope\/(\w+)/.exec(span.textContent || '')
  if (m !== null && !renderedOrder.includes(m[1])) renderedOrder.push(m[1])
}
assert.deepEqual(renderedOrder.slice(0, 6),
  ['beta', 'epsilon', 'delta', 'zeta', 'alpha', 'gamma'],
  'entries table renders in stable sort (failed → unloading → loading → pending → active → null)')
// Preset sub-section: the broken preset must show its reason and zero rows.
assert.ok(document.body.textContent.includes('用户预设'), 'user preset renders')
assert.ok(document.body.textContent.includes('系统预设'), 'system preset renders')
assert.ok(document.body.textContent.includes('默认'), 'isDefault marker renders')
assert.ok(document.body.textContent.includes('⚠ 预设文件解析失败：parse failed at line 3'),
  'broken preset reason surfaces')
// The conditional enabled badge must NOT leak the raw expression.
assert.ok(document.body.textContent.includes('conditional'),
  'conditional preset row renders the boolean outcome')
assert.ok(!document.body.textContent.includes('!!js'),
  'raw !!js expressions are not surfaced to the panel')
s2.root.unmount()
document.body.removeChild(host2)
console.log('scenario 2 OK: summary + expand + stable-sorted table + preset rows')

// --- Scenario 3: failed fetch → retry hint --------------------------------
// The gateway rejects the call: the panel must show the error message and
// a retry button instead of leaving the layout in a loading state forever.
inventoryThrow = true
inventoryCalls.length = 0
const host3 = document.body.appendChild(document.createElement('div'))
const s3 = mountPanel(host3)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('调用失败：'),
  'inventory fetch failure surfaces to the panel')
assert.ok([...document.querySelectorAll('button')].some((b) => b.textContent?.includes('🔄 重试')),
  'retry button is offered after a failed fetch')
s3.root.unmount()
document.body.removeChild(host3)
console.log('scenario 3 OK: failed fetch renders retry hint, not a stuck loading state')

// --- Scenario 4: silent remount after a successful fetch keeps the snapshot
// A stale snapshot from a previous mount must NOT leak into a fresh mount
// (per-mount re-init wipes inventory back to null until the new fetch
// resolves). The fixture mounts twice with the same successful answer.
inventoryThrow = false
inventoryAnswer = {
  available: true,
  entries: [
    { entryId: 'alpha', moduleName: '@scope/alpha', enabled: true, fiberPhase: 'active' },
  ],
  agentPresets: [],
}
const host4 = document.body.appendChild(document.createElement('div'))
const s4 = mountPanel(host4)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('🟢 1 已激活'), 'first mount shows fresh snapshot')
s4.root.unmount()
document.body.removeChild(host4)

// Now temporarily simulate a fetch failure on the second mount and assert
// the panel does NOT show the stale snapshot from the previous mount.
inventoryThrow = true
const host5 = document.body.appendChild(document.createElement('div'))
const s5 = mountPanel(host5)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(!document.body.textContent.includes('🟢 1 已激活'),
  'fresh mount does not show the previous mount snapshot')
assert.ok(document.body.textContent.includes('调用失败：'),
  'second mount failure renders cleanly')
s5.root.unmount()
document.body.removeChild(host5)
console.log('scenario 4 OK: per-mount re-init isolates stale snapshots')

// --- Scenario 5: the header always carries the documented six badges -------
// Zero counts render too (README documents a fixed six-badge header): "0 失败"
// is information, and the header no longer jumps between snapshots.
inventoryThrow = false
inventoryAnswer = {
  available: true,
  entries: [
    { entryId: 'alpha', moduleName: '@scope/alpha', enabled: true, fiberPhase: 'active' },
  ],
  agentPresets: [],
}
const host6 = document.body.appendChild(document.createElement('div'))
const s6 = mountPanel(host6)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const text6 = document.body.textContent
for (const badge of ['🟢 1 已激活', '⚪ 0 未挂载', '⏳ 0 加载中', '⏳ 0 等待挂载', '🟡 0 卸载中', '⚠ 失败 0']) {
  assert.ok(text6.includes(badge), `six-badge header renders "${badge}"`)
}
s6.root.unmount()
document.body.removeChild(host6)
console.log('scenario 5 OK: the header always renders the six documented phase badges')

// --- Scenario 6: the REAL host module's projection -------------------------
// The panel scenarios above answer through a fabricated value; this drives
// lib/plugin-inventory-admin.js itself so the { available:false } contract,
// the field projection and the malformed-input filtering are covered.
const { applyPluginInventoryAdmin } = await import('../lib/plugin-inventory-admin.js')

function mountHost(getService) {
  let mounted = null
  applyPluginInventoryAdmin({
    get: getService,
    effect(cb) { cb(); return () => {} },
    provide(key, svc) { if (key === 'pluginInventoryAdmin') mounted = svc },
  })
  assert.ok(mounted !== null, 'pluginInventoryAdmin host service mounted')
  return mounted
}

// 6a. No host service (base CLI bundle) → the structured "absent" answer.
const cliSvc = mountHost(() => undefined)
assert.deepEqual(await cliSvc.list(), { available: false, reason: 'service-absent', entries: [], agentPresets: [] },
  'missing ctx.pluginInventory answers { available: false, reason: service-absent }')

// 6b. A mounted service whose snapshot throws is reported as a CALL FAILURE,
// not as an absent service — the panel must not say "本部署没装" here.
const throwSvc = mountHost(() => ({ list: async () => { throw new Error('boom') } }))
const throwAnswer = await throwSvc.list()
assert.equal(throwAnswer.available, false, 'a thrown snapshot stays unavailable')
assert.equal(throwAnswer.reason, 'call-failed', 'the reason distinguishes a broken host')
assert.equal(throwAnswer.error, 'boom', 'the host error message is forwarded')
// A non-object snapshot is the same class of failure.
const nullSvc = mountHost(() => ({ list: async () => null }))
assert.equal((await nullSvc.list()).reason, 'call-failed', 'a null snapshot is a call failure')

// 6c. Projection: only JSON-safe leaf fields, `condition` never leaks, and
// malformed rows are dropped rather than crashing the panel.
const rawSvc = mountHost(() => ({
  list: async () => ({
    entries: [
      { entryId: 'alpha', moduleName: '@scope/alpha', enabled: true, fiberPhase: 'active', extra: { secret: 1 } },
      { entryId: 'beta', moduleName: '@scope/beta', enabled: false, fiberPhase: 'weird-phase' },
      null,
      'not-an-entry',
    ],
    agentPresets: [
      { id: 'p1', trust: 'user', name: 'P1', isDefault: true, broken: 'parse failed', rows: [
        { entryId: 'r1', moduleName: '@scope/r1', enabled: 'conditional', fiberPhase: 'pending', condition: '!!js secrets()' },
        { entryId: 'r2', moduleName: '@scope/r2', enabled: true, fiberPhase: 'active' },
        null,
      ] },
      { id: 'p2', trust: 'system', rows: [] },
      null,
    ],
  }),
}))
const projected = await rawSvc.list()
assert.equal(projected.available, true, 'host snapshot reports available')
assert.deepEqual(projected.entries, [
  { entryId: 'alpha', moduleName: '@scope/alpha', enabled: true, fiberPhase: 'active' },
  { entryId: 'beta', moduleName: '@scope/beta', enabled: false, fiberPhase: null },
], 'entries project leaf fields only; unknown phase collapses to null; malformed rows drop')
assert.equal(projected.entries[0].extra, undefined, 'unknown host fields are not forwarded')
assert.equal(projected.agentPresets.length, 2, 'malformed presets drop, valid ones survive')
assert.equal(projected.agentPresets[0].broken, 'parse failed', 'broken reason is forwarded')
assert.equal(projected.agentPresets[0].trust, 'user', 'user trust is preserved')
assert.equal(projected.agentPresets[1].trust, 'system', 'non-user trust normalizes to system')
assert.equal(projected.agentPresets[0].rows.length, 2, 'malformed preset rows drop')
assert.equal(projected.agentPresets[0].rows[0].enabled, 'conditional', 'conditional enablement is preserved')
assert.equal(JSON.stringify(projected).includes('!!js'), false, 'raw !!js condition never crosses the boundary')
assert.equal(JSON.stringify(projected).includes('secrets()'), false, 'the expression text never crosses the boundary')
console.log('scenario 6 OK: host projection — unavailable contract, leaf-only fields, malformed rows dropped')

// --- Scenario 7: the header count equals the rendered row count -------------
// A Loader entry whose moduleName is empty is still rendered as a row, so the
// header's "(N 项)" must count it too (the count used to require a non-empty
// moduleName and disagreed with the table).
inventoryThrow = false
inventoryAnswer = {
  available: true,
  entries: [
    { entryId: 'named', moduleName: '@scope/named', enabled: true, fiberPhase: 'active' },
    { entryId: 'unnamed', moduleName: '', enabled: true, fiberPhase: 'pending' },
  ],
  agentPresets: [],
}
const host7 = document.body.appendChild(document.createElement('div'))
const s7 = mountPanel(host7)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const header7 = [...document.querySelectorAll('div')].find((el) =>
  el.className === 'group-header' && el.textContent.includes('Loader 运行时'))
assert.ok(header7.textContent.includes('2 项'), 'header counts both entries, including the unnamed one')
await act(async () => { header7.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
// Every rendered entry row is a grid row; count them directly instead of
// guessing a selector for the table container.
const gridRows7 = [...document.querySelectorAll('div')].filter((el) =>
  el.getAttribute('style')?.includes('grid-template-columns'))
assert.equal(gridRows7.length, 2, 'the expanded table renders exactly the two counted rows')
s7.root.unmount()
document.body.removeChild(host7)
console.log('scenario 7 OK: the header entry count matches the rendered rows')

console.log('verify-plugin-inventory OK: all Loader-runtime inventory scenarios passed')