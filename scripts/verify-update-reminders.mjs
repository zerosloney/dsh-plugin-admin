/**
 * Verification for the plugin update-reminder persistence (the "⬆ 有新版本"
 * badge must survive re-opening the settings dialog until the plugin is actually
 * updated — 保存下来，更新完删除提醒):
 *  1. A previously persisted reminder renders on a fresh mount even when the
 *     re-opened check hits a network failure (reminder must not vanish).
 *  2. A fresh check that confirms the installed version is current clears the
 *     reminder and persists that deletion.
 *  3. Clicking the card's「⬆ 更新」button consumes the reminder immediately and
 *     confirms via the follow-up check that it stays cleared.
 *  4. A per-plugin query error keeps an already-known reminder.
 *  5. Upgrading one of two outdated plugins keeps the other's reminder across
 *     refresh.
 *  6. A first-open all-failed check surfaces per-card ⚠ tags and a failure
 *     count instead of claiming 全部为最新版本; transient failures are not
 *     persisted and clear on the next successful check.
 *  7. A reminder armed by an in-flight check survives the interleaved upgrade
 *     commit — merges read CURRENT state (functional updater), never the
 *     click-time closure snapshot.
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
let checkCalls = []
let plugins = registryPlugins('0.5.1')
// What `install name@latest` updates the named plugin to, and what latest
// each remaining registry plugin reports in the follow-up check.
let installVersion = '0.9.0'
let latestOf = () => '0.9.0'
// Deferred-RPC control: a scenario can hold check/install resolutions to
// script exact interleavings (scenario 7: an auto-check arming a reminder
// mid-flight while the upgrade's own writes are pending).
let deferChecks = false
let deferInstall = false
const pendingChecks = []
const pendingInstalls = []

/** Resolve one held checkUpdates call (payload overrides the stub default). */
function releaseNextCheck(payload) {
  const resolve = pendingChecks.shift()
  assert.ok(resolve !== undefined, 'no held checkUpdates call to release')
  resolve(payload)
}

/** Resolve one held install call. */
function releaseNextInstall() {
  const finish = pendingInstalls.shift()
  assert.ok(finish !== undefined, 'no held install call to release')
  finish()
}

const call = (method, args) => {
  if (method === 'pluginAdmin/list') {
    return Promise.resolve({ ok: true, value: { profileDir: 'E:/dsh-profiles/web', plugins } })
  }
  if (method === 'pluginAdmin/checkUpdates') {
    checkCalls.push(args)
    if (deferChecks) return new Promise((resolve) => pendingChecks.push(resolve))
    return Promise.resolve(checkResult)
  }
  if (method === 'pluginAdmin/install') {
    installCalls.push(args.spec)
    const finishInstall = () => {
      const target = String(args.spec).replace(/@latest$/, '')
      const next = plugins.map((p) => (p.name === target ? { ...p, version: installVersion } : p))
      plugins = next
      // Mirror the real host after `install name@latest`: the named plugin is
      // current, the other registry installs keep reporting their own latest.
      checkResult = updatesFor(next
        .filter((p) => p.dependency && p.localPath === null)
        .map((p) => ({
          name: p.name,
          version: p.version,
          latest: latestOf(p.name),
          updateAvailable: p.version !== latestOf(p.name),
        })))
      return { ok: true, value: { profileDir: 'E:/dsh-profiles/web', plugins: next, output: 'installed' } }
    }
    if (deferInstall) {
      return new Promise((resolve) => pendingInstalls.push(() => resolve(finishInstall())))
    }
    return Promise.resolve(finishInstall())
  }
  return Promise.resolve({ ok: false, error: `unexpected ${method}` })
}

// apply() now contributes three slot registrations; the plugin-management
// panel is the `extensions` tab inside the shell-owned 插件 section.
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
  const section = registered.find((r) => r.options.id === 'extensions')
  if (section === undefined) throw new Error('extensions plugins-tab registration not found')
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
// The only re-check entry point is the toolbar「⬆️ 检查更新」button, which
// forces a fresh host query — the strip carries no redundant recheck button.
checkResult = updatesFor([
  { name: 'dsh-remote-tool', version: '0.9.0', latest: '0.9.0', updateAvailable: false },
  { name: 'dsh-custom-tool', version: '0.2.0', latest: '0.2.0', updateAvailable: false },
  { name: 'dsh-base', version: '1.2.3', latest: '1.2.3', updateAvailable: false },
])
assert.ok(![...document.querySelectorAll('button')].some((b) => b.textContent?.includes('🔄 重新检查')),
  'no redundant 重新检查 button in the update strip')
const checkBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('⬆️ 检查更新'))
assert.ok(checkBtn, 'toolbar 检查更新 button is the single re-check entry')
await act(async () => { checkBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
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
checkCalls.length = 0
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
assert.ok(checkCalls.length >= 2, 'mount auto-check plus the post-upgrade refresh both ran')
assert.equal(checkCalls[checkCalls.length - 1].force, true,
  'post-upgrade refresh FORCES a registry re-query (bypasses the 5-minute TTL cache so a just-released newer latest cannot re-flag the upgraded plugin)')
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

// --- Scenario 5: upgrading ONE of two outdated plugins; refresh keeps the rest
plugins = [
  { name: 'dsh-remote-tool', version: '0.5.1', dependency: true, removable: true, localPath: null },
  { name: 'dsh-extra-tool', version: '1.0.0', dependency: true, removable: true, localPath: null },
]
checkResult = updatesFor([
  { name: 'dsh-remote-tool', version: '0.5.1', latest: '0.9.0', updateAvailable: true },
  { name: 'dsh-extra-tool', version: '1.0.0', latest: '1.1.0', updateAvailable: true },
])
installVersion = '0.9.0'
latestOf = (n) => (n === 'dsh-remote-tool' ? '0.9.0' : '1.1.0')
window.localStorage.setItem(KEY, JSON.stringify({
  'dsh-remote-tool': { latest: '0.9.0', at: Date.now() },
  'dsh-extra-tool': { latest: '1.1.0', at: Date.now() },
}))
host = document.body.appendChild(document.createElement('div'))
mount = mountPanel(host)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v0.9.0')), 'first badge before upgrading')
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v1.1.0')), 'second badge before upgrading')

// Upgrade only dsh-remote-tool (the first card's 更新 button).
const upgradeBtn5 = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '⬆ 更新')
await act(async () => { upgradeBtn5.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
assert.ok(!theBadge().some((t) => t.includes('v0.9.0')), 'upgraded plugin stops flagging')
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v1.1.0')), 'the still-outdated plugin keeps its badge')
const stored5 = JSON.parse(window.localStorage.getItem(KEY) || '{}')
assert.ok(!('dsh-remote-tool' in stored5) && 'dsh-extra-tool' in stored5,
  'localStorage keeps only the still-outdated reminder')
mount.root.unmount()
document.body.removeChild(host)

// Refresh (remount): the persisted reminder for the OTHER plugin comes back —
// updating one must not wipe the rest (更新其中一个刷新就没有了 的反面保证).
host = document.body.appendChild(document.createElement('div'))
mount = mountPanel(host)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(!theBadge().some((t) => t.includes('v0.9.0')), 'upgraded plugin stays flag-free after refresh')
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v1.1.0')),
  'refresh keeps the still-outdated plugin reminder (更新一个，其余提醒不丢)')
const stored5b = JSON.parse(window.localStorage.getItem(KEY) || '{}')
assert.ok(!('dsh-remote-tool' in stored5b) && 'dsh-extra-tool' in stored5b, 'refresh keeps localStorage consistent')
mount.root.unmount()
document.body.removeChild(host)
console.log('scenario 5 OK: upgrading one of two keeps the other reminder across refresh')
window.localStorage.removeItem(KEY)
installVersion = '0.9.0'
latestOf = () => '0.9.0'

// --- Scenario 6: a first-open all-failed check reads as failure, not "all ok"
plugins = [
  { name: 'dsh-remote-tool', version: '0.5.1', dependency: true, removable: true, localPath: null },
  { name: 'dsh-extra-tool', version: '1.0.0', dependency: true, removable: true, localPath: null },
]
const failOne = (name) => ({
  name,
  version: plugins.find((p) => p.name === name).version,
  latest: null,
  updateAvailable: false,
  error: '无法查询远程版本（网络或 registry 不可达）',
})
checkResult = updatesFor([failOne('dsh-remote-tool'), failOne('dsh-extra-tool')])
host = document.body.appendChild(document.createElement('div'))
mount = mountPanel(host)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
const errorTags = () => [...document.querySelectorAll('.tag.update-error')].map((e) => e.textContent)
assert.equal(errorTags().length, 2,
  'every failed plugin shows its ⚠ 更新检查失败 tag even without a prior reminder')
assert.ok(document.body.textContent.includes('2 个查询失败'),
  'the note reports the failures with a count')
assert.ok(!document.body.textContent.includes('全部为最新版本'),
  'an all-failed first check never claims 全部为最新版本')
assert.deepEqual(Object.keys(JSON.parse(window.localStorage.getItem(KEY) || '{}')), [],
  'transient failures are not persisted as reminders')

// Recovery round: a successful check clears the ephemeral error records.
checkResult = updatesFor([
  { name: 'dsh-remote-tool', version: '0.5.1', latest: '0.9.0', updateAvailable: true },
  { name: 'dsh-extra-tool', version: '1.0.0', latest: '1.0.0', updateAvailable: false },
])
const checkBtn6 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('⬆️ 检查更新'))
assert.ok(checkBtn6, 'toolbar 检查更新 button present')
await act(async () => { checkBtn6.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.equal(errorTags().length, 0, 'a successful re-check clears the transient error tags')
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v0.9.0')), 'recovered check arms real reminders again')
assert.deepEqual(Object.keys(JSON.parse(window.localStorage.getItem(KEY))), ['dsh-remote-tool'],
  'only the genuine reminder persists after recovery')

// Mixed round: one verified current, one failed — the ⚠ tag shows on the
// failed card alone and 「其余均为最新版本」 claims only about verified rows.
checkResult = updatesFor([
  { name: 'dsh-remote-tool', version: '0.9.0', latest: '0.9.0', updateAvailable: false },
  failOne('dsh-extra-tool'),
])
await act(async () => { checkBtn6.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(!theBadge().some((t) => t.includes('⬆ 有新版本')), 'confirmed-current entry drops its badge in the mixed round')
assert.equal(errorTags().length, 1, 'the mixed round flags only the actually-failed plugin')
assert.ok(document.body.textContent.includes('1 个查询失败'), 'mixed-round failure count is exact')
assert.ok(document.body.textContent.includes('其余均为最新版本'),
  'the verified remainder is still reported as current')
assert.deepEqual(Object.keys(JSON.parse(window.localStorage.getItem(KEY) || '{}')), [],
  'no durable reminder when nothing updatable was confirmed')
mount.root.unmount()
document.body.removeChild(host)
console.log('scenario 6 OK: first-open all-failed check surfaces errors instead of a false all-clear')
window.localStorage.removeItem(KEY)
plugins = registryPlugins('0.5.1')

// --- Scenario 7: a reminder armed MID-FLIGHT survives the upgrade commit ----
// Scripts the exact stale-snapshot interleaving: the auto-check is HELD, the
// user clicks ⬆ 更新 off the localStorage-seeded badge, the check resolves
// FIRST arming a different plugin (X), and only then does the install resolve.
// The upgrade's reminder-strip must read the CURRENT state (functional
// updater) — computing it from the click-time closure's snapshot would erase
// X from state AND localStorage right here.
plugins = [
  { name: 'dsh-remote-tool', version: '0.5.1', dependency: true, removable: true, localPath: null },
  { name: 'dsh-extra-tool', version: '1.0.0', dependency: true, removable: true, localPath: null },
]
installVersion = '0.9.0'
latestOf = (n) => (n === 'dsh-remote-tool' ? '0.9.0' : '1.1.0')
window.localStorage.setItem(KEY, JSON.stringify({ 'dsh-remote-tool': { latest: '0.9.0', at: Date.now() } }))
deferChecks = true
deferInstall = true
checkCalls.length = 0
host = document.body.appendChild(document.createElement('div'))
mount = mountPanel(host)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v0.9.0')), 'seeded badge for U visible immediately')
const upgradeBtn7 = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '⬆ 更新')
assert.ok(upgradeBtn7 !== undefined && !upgradeBtn7.disabled, 'upgrade button clickable while the auto-check is held')
await act(async () => { upgradeBtn7.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.equal(checkCalls.length, 1, 'only the held auto-check so far')

// Release the auto-check FIRST: it arms X (and confirms U current).
releaseNextCheck(updatesFor([
  { name: 'dsh-remote-tool', version: '0.5.1', latest: '0.9.0', updateAvailable: false },
  { name: 'dsh-extra-tool', version: '1.0.0', latest: '1.1.0', updateAvailable: true },
]))
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v1.1.0')), 'mid-flight check arms X')

// Resolve the install AFTER A has committed: this is where the stale
// snapshot used to full-replace `updates` with a map computed pre-X.
releaseNextInstall()
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.equal(checkCalls.length, 2, 'the post-upgrade refresh fired')
assert.equal(checkCalls[1].force, true, 'post-upgrade refresh stays forced')
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v1.1.0')),
  'X survives the upgrade commit (merge ran against CURRENT state)')
let stored7 = JSON.parse(window.localStorage.getItem(KEY) || '{}')
assert.ok(stored7['dsh-extra-tool'], 'X still persisted after the upgrade commit')
assert.ok(!stored7['dsh-remote-tool'], 'the upgraded plugin stays cleared')

// Drain the deferred forced re-check honestly: X genuinely still outdated.
releaseNextCheck(updatesFor([
  { name: 'dsh-extra-tool', version: '1.0.0', latest: '1.1.0', updateAvailable: true },
]))
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(theBadge().some((t) => t.includes('⬆ 有新版本 v1.1.0')), 'end state keeps X flagged')
stored7 = JSON.parse(window.localStorage.getItem(KEY) || '{}')
assert.ok(stored7['dsh-extra-tool'] && !stored7['dsh-remote-tool'], 'end-state storage consistent')
mount.root.unmount()
document.body.removeChild(host)
console.log('scenario 7 OK: mid-flight discovery survives the upgrade commit (no stale-snapshot wipe)')
deferChecks = false
deferInstall = false
window.localStorage.removeItem(KEY)
plugins = registryPlugins('0.5.1')
latestOf = () => '0.9.0'
installVersion = '0.9.0'

console.log('verify-update-reminders OK: all update-reminder persistence scenarios passed')
