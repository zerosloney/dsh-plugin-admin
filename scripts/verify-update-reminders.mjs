/**
 * Verification for the plugin update-reminder persistence (the "⬆ 有新版本"
 * badge must survive re-opening the 管理中心 until the plugin is actually
 * updated — 保存下来，更新完删除提醒):
 *  1. A previously persisted reminder renders on a fresh mount even when the
 *     re-opened check hits a network failure (reminder must not vanish).
 *  2. A fresh check that confirms the installed version is current clears the
 *     reminder and persists that deletion.
 *  3. Clicking the card's「⬆ 更新」button consumes the reminder immediately and
 *     confirms via the follow-up check that it stays cleared.
 *  4. A per-plugin query error keeps an already-known reminder.
 *
 * Run: node scripts/verify-update-reminders.mjs
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

// Proper origin so localStorage actually works.
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

const KEY = 'dsh-plugin-admin/update-reminders'
const registryPlugins = (version) => [
  { name: 'dsh-remote-tool', version, dependency: true, removable: true, localPath: null },
  { name: 'dsh-custom-tool', version: '0.2.0', dependency: true, removable: true, localPath: 'E:/local' },
  { name: 'dsh-base', version: '1.2.3', dependency: false, removable: false, localPath: null },
]

// Mutable host stubs; the panel reads them per RPC.
let checkResult = { ok: true, value: { updates: [] } }
let installCalls = []
let plugins = registryPlugins('0.5.1')

const call = (method, args) => {
  if (method === 'pluginAdmin/list') {
    return Promise.resolve({ ok: true, value: { profileDir: 'E:/dsh-profiles/web', plugins } })
  }
  if (method === 'pluginAdmin/checkUpdates') {
    return Promise.resolve(checkResult)
  }
  if (method === 'pluginAdmin/install') {
    installCalls.push(args.spec)
    plugins = registryPlugins('0.9.0')
    // Mirror the real host: after `install name@latest` the installed version
    // is current, so the follow-up refresh check reports no update.
    checkResult = updatesFor([
      { name: 'dsh-remote-tool', version: '0.9.0', latest: '0.9.0', updateAvailable: false },
    ])
    return Promise.resolve({ ok: true, value: { profileDir: 'E:/dsh-profiles/web', plugins, output: 'installed' } })
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
  injected[0].cb()
  const section = registered[0]
  const face = section.options.inject()
  const root = createRoot(container)
  root.render(React.createElement(section.component, face))
  return { root }
}

const updatesFor = (updates) => ({ ok: true, value: { updates } })
const theBadge = () => [...document.querySelectorAll('.tag.update')].map((e) => e.textContent)

// --- Scenario 1: network-failed re-open keeps the persisted reminder --------
window.localStorage.setItem(KEY, JSON.stringify({ 'dsh-remote-tool': { latest: '0.9.0', at: Date.now() } }))
checkResult = { ok: false, error: 'network down' }
let host = document.body.appendChild(document.createElement('div'))
let mount = mountPanel(host)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v0.9.0')),
  'reminder renders from localStorage on a fresh mount even when the re-check fails')
assert.equal(JSON.parse(window.localStorage.getItem(KEY))['dsh-remote-tool'].latest, '0.9.0',
  'failed re-open does not erase the persisted reminder')
mount.root.unmount()
document.body.removeChild(host)
console.log('scenario 1 OK: persisted reminder survives a network-failed re-open')
window.localStorage.removeItem(KEY)

// --- Scenario 2: confirmed-up-to-date clears and persists the deletion ------
checkResult = updatesFor([
  { name: 'dsh-remote-tool', version: '0.5.1', latest: '0.9.0', updateAvailable: true },
  { name: 'dsh-custom-tool', version: '0.2.0', latest: '0.2.0', updateAvailable: false },
  { name: 'dsh-base', version: '1.2.3', latest: '1.2.3', updateAvailable: false },
])
host = document.body.appendChild(document.createElement('div'))
mount = mountPanel(host)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v0.9.0')), 'new-detected update shows a badge')
assert.ok(JSON.parse(window.localStorage.getItem(KEY))['dsh-remote-tool'], 'detected update persisted as a reminder')

// The update "completes" (version is now current): a re-check must clear it.
checkResult = updatesFor([
  { name: 'dsh-remote-tool', version: '0.9.0', latest: '0.9.0', updateAvailable: false },
  { name: 'dsh-custom-tool', version: '0.2.0', latest: '0.2.0', updateAvailable: false },
  { name: 'dsh-base', version: '1.2.3', latest: '1.2.3', updateAvailable: false },
])
const recheck = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('🔄 重新检查'))
await act(async () => { recheck.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(!theBadge().some((t) => t.includes('⬆ 有新版本')), 'up-to-date confirmation removes the badge')
assert.ok(!('dsh-remote-tool' in JSON.parse(window.localStorage.getItem(KEY) || '{}')),
  'up-to-date confirmation persists the reminder deletion')
mount.root.unmount()
document.body.removeChild(host)
console.log('scenario 2 OK: up-to-date confirmation clears + persists the reminder deletion')
window.localStorage.removeItem(KEY)
plugins = registryPlugins('0.5.1')
installCalls.length = 0

// --- Scenario 3: the「⬆ 更新」button consumes the reminder --------------------
window.localStorage.setItem(KEY, JSON.stringify({ 'dsh-remote-tool': { latest: '0.9.0', at: Date.now() } }))
checkResult = updatesFor([
  { name: 'dsh-remote-tool', version: '0.5.1', latest: '0.9.0', updateAvailable: true },
])
host = document.body.appendChild(document.createElement('div'))
mount = mountPanel(host)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v0.9.0')), 'reminder visible before upgrading')
const upgradeBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '⬆ 更新')
assert.ok(upgradeBtn, 'upgrade button present on the registry-installed card')
await act(async () => { upgradeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
assert.deepEqual(installCalls, ['dsh-remote-tool@latest'], 'upgrade installs name@latest')
assert.ok(!theBadge().some((t) => t.includes('⬆ 有新版本')), 'upgrade consumes the reminder immediately')
assert.ok(!('dsh-remote-tool' in JSON.parse(window.localStorage.getItem(KEY) || '{}')),
  'upgrade persists the reminder deletion (更新完删除提醒)')
mount.root.unmount()
document.body.removeChild(host)
console.log('scenario 3 OK: upgrade consumes + persists the reminder deletion')
window.localStorage.removeItem(KEY)

// --- Scenario 4: a per-plugin query error keeps the known reminder -----------
window.localStorage.setItem(KEY, JSON.stringify({ 'dsh-remote-tool': { latest: '0.9.0', at: Date.now() } }))
checkResult = updatesFor([
  { name: 'dsh-remote-tool', version: '0.5.1', latest: null, updateAvailable: false, error: '无法查询远程版本（网络或 registry 不可达）' },
])
host = document.body.appendChild(document.createElement('div'))
mount = mountPanel(host)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v0.9.0')),
  'a transient per-plugin error keeps the already-known reminder')
assert.ok(JSON.parse(window.localStorage.getItem(KEY))['dsh-remote-tool'], 'error does not erase the reminder')
mount.root.unmount()
document.body.removeChild(host)
console.log('scenario 4 OK: per-plugin error keeps the known reminder')
window.localStorage.removeItem(KEY)

console.log('verify-update-reminders OK: all update-reminder persistence scenarios passed')
