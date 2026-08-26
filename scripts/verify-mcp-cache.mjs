/**
 * Ad-hoc verification for the MCP connectivity-test cache:
 *  1. Simulates a fresh panel mount with a pre-seeded localStorage cache and
 *     asserts the cached probe renders (✅ 连通 + "缓存于" label).
 *  2. Simulates a fresh probe completing and asserts the result is persisted
 *     to localStorage, then that a remount restores it from storage.
 *  3. Verifies a saved config invalidates the cached probe for that entry.
 *
 * Run: node scripts/verify-mcp-cache.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

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

// Proper origin so localStorage actually works (unlike the self-check's
// opaque-origin jsdom, which is exactly what the try/catch guards absorb).
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

const CACHE_KEY = 'dsh-plugin-admin/mcp-test-results'
const baseEntries = [
  { id: 'mcp-demo', serverName: 'demo-mcp', config: { transport: 'stdio', serverName: 'demo-mcp', command: 'demo' } },
  { id: 'mcp-other', serverName: 'other-mcp', config: { transport: 'stdio', serverName: 'other-mcp', command: 'other' } },
]

// Host state shared across mounts, so list()/upsert() behave like the real
// host while the RPC calls are recorded.
const hostState = { entries: JSON.parse(JSON.stringify(baseEntries)), probes: [], upserts: [] }
const call = (method, args) => {
  if (method === 'mcpAdmin/list') return Promise.resolve({ ok: true, value: { entries: hostState.entries } })
  if (method === 'mcpAdmin/test') {
    hostState.probes.push(args.id)
    return Promise.resolve({
      ok: true,
      value: {
        ok: true,
        serverInfo: { name: 'demo-mcp', version: 'v1.0' },
        toolCount: 3,
        tools: ['fetch_url', 'fetch_urls', 'browser_install'],
      },
    })
  }
  if (method === 'mcpAdmin/upsert') {
    hostState.upserts.push(args.entry)
    const idx = hostState.entries.findIndex((e) => e.id === args.entry.id)
    const saved = { id: args.entry.id, serverName: args.entry.config.serverName, config: args.entry.config }
    if (idx !== -1) hostState.entries[idx] = saved
    else hostState.entries.push(saved)
    return Promise.resolve({ ok: true, value: { entries: hostState.entries } })
  }
  if (method === 'mcpAdmin/remove') {
    hostState.entries = hostState.entries.filter((e) => e.id !== args.id)
    return Promise.resolve({ ok: true, value: { entries: hostState.entries } })
  }
  return Promise.resolve({ ok: false, error: `unexpected ${method}` })
}

// Mirror the self-check's apply + inject face.
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
  injected[0].cb()
  const section = registered[0]
  const face = section.options.inject()
  const root = createRoot(container)
  root.render(React.createElement(section.component, face))
  return { root, face }
}

// --- Scenario 1: pre-seeded cache renders on first mount --------------------
window.localStorage.setItem(CACHE_KEY, JSON.stringify({
  'mcp-demo': {
    result: { ok: true, serverInfo: { name: 'demo-mcp', version: 'v1.0' }, toolCount: 3, tools: ['fetch_url', 'fetch_urls', 'browser_install'] },
    at: Date.now(),
  },
}))
const host1 = document.body.appendChild(document.createElement('div'))
const s1 = mountPanel(host1)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
// Switch to the MCP tab.
const mcpTab = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('MCP 配置'))
await act(async () => { mcpTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('✅ 连通'), 'cached result renders 连通')
assert.ok(document.body.textContent.includes('缓存于'), 'cached result is labelled 缓存于')
assert.ok(document.body.textContent.includes('3 个工具'), 'cached tool count renders')
assert.equal(hostState.probes.length, 0, 'no probe RPC fired for a cached status')
s1.root.unmount()
document.body.removeChild(host1)
console.log('scenario 1 OK: cached probe restored from localStorage without re-probing')

// --- Scenario 2: fresh probe persists, remount restores ----------------------
window.localStorage.removeItem(CACHE_KEY)
const host2 = document.body.appendChild(document.createElement('div'))
const s2 = mountPanel(host2)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const mcpTab2 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('MCP 配置'))
await act(async () => { mcpTab2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(!document.body.textContent.includes('✅ 连通'), 'no result before testing')
const testBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('🔌 测试'))
assert.ok(testBtn, 'test button exists')
await act(async () => { testBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(hostState.probes.includes('mcp-demo'), 'probe RPC fired')
assert.ok(document.body.textContent.includes('✅ 连通'), 'fresh result renders')
assert.ok(document.body.textContent.includes('缓存于'), 'fresh result labelled with probe time')
const persisted = JSON.parse(window.localStorage.getItem(CACHE_KEY))
assert.ok(persisted['mcp-demo'], 'probe persisted to localStorage')
assert.equal(typeof persisted['mcp-demo'].at, 'number', 'probe time persisted')
s2.root.unmount()
document.body.removeChild(host2)

// Remount: the persisted probe comes back without any new probe RPC.
const host3 = document.body.appendChild(document.createElement('div'))
const before = hostState.probes.length
const s3 = mountPanel(host3)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const mcpTab3 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('MCP 配置'))
await act(async () => { mcpTab3.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.equal(hostState.probes.length, before, 'no probe RPC fired on remount')
assert.ok(document.body.textContent.includes('✅ 连通'), 'remount restores cached result')
assert.ok(document.body.textContent.includes('缓存于'), 'remount keeps the cache label')
s3.root.unmount()
document.body.removeChild(host3)
console.log('scenario 2 OK: fresh probe persisted; remount restored it without re-probing')

// --- Scenario 3: saving the config invalidates the cached probe --------------
window.localStorage.removeItem(CACHE_KEY)
window.localStorage.setItem(CACHE_KEY, JSON.stringify({
  'mcp-demo': { result: { ok: true, serverInfo: { name: 'demo-mcp' } }, at: Date.now() },
}))
const host4 = document.body.appendChild(document.createElement('div'))
const s4 = mountPanel(host4)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const mcpTab4 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('MCP 配置'))
await act(async () => { mcpTab4.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('✅ 连通'), 'cached result visible before edit')
// Open the editor for the first entry and save without touching anything.
const editBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('编辑'))
await act(async () => { editBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存'))
await act(async () => { saveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const afterSave = JSON.parse(window.localStorage.getItem(CACHE_KEY) || '{}')
assert.ok(!afterSave['mcp-demo'], 'cached probe invalidated after config save')
assert.ok(!document.body.textContent.includes('✅ 连通'), 'stale indicator removed after config save')
s4.root.unmount()
document.body.removeChild(host4)
console.log('scenario 3 OK: config save invalidates the cached probe')

console.log('verify-mcp-cache OK: all MCP test-cache scenarios passed')
