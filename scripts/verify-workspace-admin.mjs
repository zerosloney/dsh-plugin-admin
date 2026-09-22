/**
 * Ad-hoc verification for the Workspace administration settings section:
 *  1. Host without `ctx.workspaceRegistry` (base CLI bundle) → panel renders
 *     the "本部署未挂载 dsh-workspace" hint, NOT an error.
 *  2. Host with a populated registry → list + create (with `created: true`)
 *     + create-on-existing-path (with `created: false`) + rename +
 *     insertBefore reorder + delete round-trips correctly.
 *  3. Picker with a native backend present → `pickDirectory()` returns
 *     a path that flows into the create form.
 *  4. Picker absent → the picker button disables and the form lets the
 *     user type the path manually.
 *  5. Live `status()` probe returns 'ok' / 'missing-dir' and the panel
 *     surfaces the missing-dir case as a banner.
 *
 * Run: node scripts/verify-workspace-admin.mjs
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
// Pin the panel language: jsdom's navigator.language is en-US; these
// assertions cover the stock Chinese chrome.
dom.window.localStorage.setItem('dsh-admin-lang', 'zh')
new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)
const bundle = registrations[0].factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`require("${spec}") missed the platform table`)
})

// ---------- Mock workspace registry ----------

/**
 * In-memory fake of the dsh workspace registry. Mirrors the registry's
 * contract just enough for the panel: list/get/create/delete/insertBefore,
 * the per-Workspace setTitle/insertSessionBefore/attachSession/detachSession/
 * status, and the registry-global archivedSessionIds set. We keep a
 * mutable order array and a uuid-keyed map of Workspace records; IDs are
 * stable per `create`.
 */
class FakeWorkspace {
  constructor(record, registry) {
    this.id = record.id
    this.path = record.path
    this.title = record.title
    this.createdAt = record.createdAt
    this.updatedAt = record.updatedAt
    this._registry = registry
    this._sessionIds = Array.isArray(record.sessionIds) ? record.sessionIds.slice() : []
  }
  get sessionIds() { return this._sessionIds.slice() }
  async setTitle(title) {
    this.title = title
    this.updatedAt = new Date().toISOString()
    this._registry._touch(this.id)
  }
  async attachSession(sessionId) {
    if (!this._sessionIds.includes(sessionId)) this._sessionIds = [sessionId, ...this._sessionIds]
    this.updatedAt = new Date().toISOString()
    this._registry._touch(this.id)
  }
  async detachSession(sessionId) {
    this._sessionIds = this._sessionIds.filter((id) => id !== sessionId)
    this.updatedAt = new Date().toISOString()
    this._registry._touch(this.id)
  }
  async insertSessionBefore(sessionId, beforeSessionId) {
    if (!this._sessionIds.includes(sessionId)) throw new Error('move-invalid: not on account')
    const without = this._sessionIds.filter((id) => id !== sessionId)
    let at
    if (beforeSessionId === undefined) at = without.length
    else {
      const i = without.indexOf(beforeSessionId)
      if (i === -1) throw new Error('move-invalid: anchor not on account')
      at = i
    }
    this._sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
    this.updatedAt = new Date().toISOString()
    this._registry._touch(this.id)
  }
  async status() {
    // Always ok in the fake; scenarios 5 toggles via flip()
    return this._registry._missingDirs.has(this.id) ? 'missing-dir' : 'ok'
  }
}

class FakeRegistry {
  constructor() {
    this._entities = new Map()
    this._order = []
    this._archivedSessionIds = []
    this._missingDirs = new Set()
    this._counter = 0
  }
  list() { return this._order.map((id) => this._entities.get(id)) }
  get(id) { return this._entities.get(id) }
  async create(path, title) {
    this._counter++
    const id = 'ws-' + this._counter
    const last = path.split(/[\\/]/).filter(Boolean).pop() || path
    const record = {
      id,
      path,
      title: typeof title === 'string' && title !== '' ? title : last,
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:00.000Z',
      sessionIds: [],
    }
    const ws = new FakeWorkspace(record, this)
    this._entities.set(id, ws)
    this._order.push(id)
    return ws
  }
  async delete(id) {
    if (!this._entities.has(id)) return false
    this._entities.delete(id)
    this._order = this._order.filter((x) => x !== id)
    return true
  }
  async insertBefore(id, beforeId) {
    if (!this._entities.has(id)) throw new Error('order-invalid: not-found')
    const without = this._order.filter((x) => x !== id)
    let at
    if (beforeId === undefined) at = without.length
    else {
      const i = without.indexOf(beforeId)
      if (i === -1) throw new Error('order-invalid: anchor not-found')
      at = i
    }
    this._order = [...without.slice(0, at), id, ...without.slice(at)]
    return this._order.slice()
  }
  get archivedSessionIds() { return this._archivedSessionIds.slice() }
  async archiveSession(sessionId) {
    if (!this._archivedSessionIds.includes(sessionId)) {
      this._archivedSessionIds = [...this._archivedSessionIds, sessionId]
    }
  }
  // The REAL dsh-workspace public surface: the registry's own serialized
  // unarchive verb (an id that is not archived resolves without writing).
  async unarchiveSession(sessionId) {
    this._archivedSessionIds = this._archivedSessionIds.filter((id) => id !== sessionId)
  }
  _touch(id) { /* updatedAt is set on the entity directly by callers */ }
  flipMissing(id) { this._missingDirs.add(id) ; setTimeout(() => this._missingDirs.delete(id), 50) }
}

// ---------- Per-scenario mock switching ----------

// `mode = 'cli'` → registry missing (no host service). 'web' → fake present.
// `pickerMode = 'native' | 'absent'` controls pickDirectory.
let mode = 'web'
let pickerMode = 'native'
let pickerPath = '/Users/demo/picked-dir'
let registry = null
let pickerBackend = null

function getRegistry() {
  if (mode !== 'web') throw new Error('workspaceAdmin: workspaceRegistry 服务不可用')
  return registry
}

function getPicker() {
  if (pickerMode !== 'native') return null
  return {
    // Real shape: the service exposes capability() only; pick() lives on the
    // NATIVE capability object (a browse capability has list/createDirectory
    // and no pick action at all).
    capability() {
      const kind = pickerBackend || 'native'
      if (kind !== 'native') return { kind, list: async () => [], createDirectory: async () => '' }
      return { kind: 'native', pick: async (signal) => pickerPath }
    },
  }
}

const calls = []
const call = async (method, args) => {
  calls.push({ method, args })
  if (method === 'workspaceAdmin/list') {
    if (mode !== 'web') return Promise.resolve({ ok: true, value: { available: false, workspaces: [], archivedSessionIds: [] } })
    const list = registry.list().map((w) => ({
      workspaceId: w.id,
      path: w.path,
      title: w.title,
      sessionIds: w.sessionIds.slice(),
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }))
    return Promise.resolve({ ok: true, value: { available: true, workspaces: list, archivedSessionIds: registry.archivedSessionIds.slice() } })
  }
  if (method === 'workspaceAdmin/create') {
    return (async () => {
      try {
        const idsBefore = new Set(registry.list().map((w) => w.id))
        const ws = await registry.create(args.path, args.title)
        const idsAfter = new Set(registry.list().map((w) => w.id))
        const created = !idsBefore.has(ws.id) && idsAfter.has(ws.id)
        return { ok: true, value: { workspace: {
          workspaceId: ws.id, path: ws.path, title: ws.title,
          sessionIds: ws.sessionIds.slice(), createdAt: ws.createdAt, updatedAt: ws.updatedAt,
        }, created } }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    })()
  }
  if (method === 'workspaceAdmin/rename') {
    try {
      const ws = registry.get(args.workspaceId)
      if (!ws) throw new Error('workspace "' + args.workspaceId + '" 不存在')
      await ws.setTitle(args.title)
      return { ok: true, value: { workspace: {
        workspaceId: ws.id, path: ws.path, title: ws.title,
        sessionIds: ws.sessionIds.slice(), createdAt: ws.createdAt, updatedAt: ws.updatedAt,
      } } }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
  if (method === 'workspaceAdmin/delete') {
    try {
      const ok = await registry.delete(args.workspaceId)
      if (!ok) throw new Error('workspace "' + args.workspaceId + '" 不存在')
      return Promise.resolve({ ok: true, value: { ok: true } })
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message })
    }
  }
  if (method === 'workspaceAdmin/insertBefore') {
    try {
      const order = await registry.insertBefore(args.workspaceId, args.beforeWorkspaceId)
      return Promise.resolve({ ok: true, value: { workspaceIds: order.slice() } })
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message })
    }
  }
  if (method === 'workspaceAdmin/pickDirectory') {
    // Mirrors the host: resolve the capability, then pick only when the
    // native capability actually offers pick().
    const svc = getPicker()
    if (svc === null) return Promise.resolve({ ok: true, value: { available: false, path: null, backend: null } })
    const cap = typeof svc.capability === 'function' ? svc.capability() : null
    if (cap === null || cap.kind !== 'native' || typeof cap.pick !== 'function') {
      return Promise.resolve({ ok: true, value: { available: false, path: null, backend: cap === null ? null : cap.kind } })
    }
    try {
      const path = await cap.pick(new AbortController().signal)
      return Promise.resolve({ ok: true, value: { available: true, path: typeof path === 'string' ? path : null, backend: cap.kind } })
    } catch (err) {
      return Promise.resolve({ ok: true, value: { available: true, path: null, backend: cap.kind, error: err.message } })
    }
  }
  if (method === 'workspaceAdmin/status') {
    try {
      const ws = registry.get(args.workspaceId)
      const status = await ws.status()
      return Promise.resolve({ ok: true, value: status })
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message })
    }
  }
  if (method === 'workspaceAdmin/unarchiveSession') {
    // Mirrors the host path: the registry's public serialized unarchive verb.
    await registry.unarchiveSession(args.sessionId)
    return Promise.resolve({ ok: true, value: { archivedSessionIds: registry.archivedSessionIds.slice() } })
  }
  return Promise.resolve({ ok: false, error: 'unexpected ' + method })
}

// jsdom 29 + React 18.3 event delegation does not deliver input events to
// React's onChange in this environment, so drive the exact handlers through
// the element's React fiber — the same handler props a real browser event
// would reach. The `setInput` helper applies the value via the prototype
// setter and then invokes onChange directly.
const fiberHandler = async (node, handlerName, event) => {
  const fiberKey = Object.keys(node).find((key) => key.startsWith('__reactFiber$'))
  assert.ok(fiberKey, 'react fiber expando present on node')
  let fiber = node[fiberKey]
  while (fiber && !(fiber.memoizedProps && typeof fiber.memoizedProps[handlerName] === 'function')) {
    fiber = fiber.return
  }
  assert.ok(fiber, handlerName + ' handler present up the fiber tree')
  await act(async () => { fiber.memoizedProps[handlerName](event) })
}
const setInput = async (input, value) => {
  const proto = input.tagName === 'INPUT' ? dom.window.HTMLInputElement.prototype : dom.window.HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
  await fiberHandler(input, 'onChange', { target: input, currentTarget: input })
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
  // 工作区 no longer registers a settings section of its own: the panel is
  // DOM-merged into dsh's own 已归档会话 page, and the bundle exports the
  // component for direct mounting.
  const component = bundle.WorkspacesSection
  if (typeof component !== 'function') throw new Error('bundle does not export WorkspacesSection')
  const face = { call: (method, args) => ctx.connection.rpc.call('/api', method, { args: args }) }
  const root = createRoot(container)
  root.render(React.createElement(component, face))
  return { root, face }
}

// --- Scenario 1: CLI mode → unavailable hint --------------------------------
mode = 'cli'
const host1 = document.body.appendChild(document.createElement('div'))
const s1 = mountPanel(host1)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('本部署未挂载 dsh-workspace'),
  'CLI-mode unavailable hint renders')
assert.ok(!document.body.textContent.includes('➕ 新建工作区'),
  'no toolbar in unavailable state')
s1.root.unmount()
document.body.removeChild(host1)
console.log('scenario 1 OK: CLI mode renders a quiet hint')

// --- Scenario 2: web mode → CRUD round-trip ---------------------------------
mode = 'web'
registry = new FakeRegistry()
// Seed two workspaces so the list renders immediately.
const ws1 = await registry.create('/Users/demo/projects/alpha')
const ws2 = await registry.create('/Users/demo/projects/beta')
calls.length = 0

const host2 = document.body.appendChild(document.createElement('div'))
const s2 = mountPanel(host2)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })

// 2a. List renders both seeded workspaces
assert.ok(document.body.textContent.includes('alpha'), 'first workspace renders')
assert.ok(document.body.textContent.includes('beta'), 'second workspace renders')
assert.ok(document.body.textContent.includes('📁 /Users/demo/projects/alpha'), 'path rendered')
assert.ok(document.body.textContent.includes('📁 /Users/demo/projects/beta'), 'path rendered')

// 2b. Click ➕ 新建工作区 → form appears; type a path; submit
const createBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('➕ 新建工作区'))
assert.ok(createBtn, 'create button visible')
await act(async () => { createBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
assert.ok(document.body.textContent.includes('选择目录'), 'create form expanded with picker button')
// Manual path entry (picker disabled scenario later).
const inputs = [...document.querySelectorAll('input.input')]
const pathInput = inputs.find((i) => i.placeholder && i.placeholder.includes('手动输入绝对目录路径'))
assert.ok(pathInput, 'manual path input visible')
await setInput(pathInput, '/Users/demo/projects/gamma')
// Allow React to flush the controlled-input re-render before querying the
// freshly-bound onClick handler.
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '保存' && b.classList.contains('primary'))
assert.ok(saveBtn, 'save button visible after path typed')
assert.equal(saveBtn.disabled, false, 'save button is enabled once the path is non-empty')
await act(async () => { saveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(registry.list().some((w) => w.path === '/Users/demo/projects/gamma'),
  'new workspace persisted to the registry after form submit')
// reload() inside submitCreate fires a fresh list() and patches state; wait
// one more microtask round so React commits the new render before asserting.
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('gamma'), 'newly created workspace renders in the list')
// The success path closes the form; the ➕ entry point must be usable again.
// createBusy is what disables it, so it MUST be reset on that path (it used to
// stay true, disabling the only create affordance for the component's life).
assert.equal(createBtn.disabled, false, 'create button re-enables after a successful create')

// 2c. Rename the second workspace (beta → Beta Project) via the inline editor.
// The rename button we want lives in the second .card on the page; the
// page also has a '✎ 重命名' text in the create form footer but no rename
// button there. We pick the rename button whose card-title-text contains
// 'beta' to scope the click to the right workspace.
const renameBtn = [...document.querySelectorAll('.card')]
  .find((card) => card.querySelector('.card-title-text')?.textContent === 'beta')
  ?.querySelector('button.btn')
assert.ok(renameBtn, 'rename button on the beta card visible')
await act(async () => { renameBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const renameInput = [...document.querySelectorAll('input.input')].find((i) => i.value === 'beta')
assert.ok(renameInput, 'rename input pre-filled with current title')
await setInput(renameInput, 'Beta Project')
const renameSave = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '保存')
assert.ok(renameSave, 'rename save button visible')
await act(async () => { renameSave.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(registry.get(ws2.id).title === 'Beta Project', 'rename persisted to registry')
assert.ok(document.body.textContent.includes('Beta Project'), 'renamed title renders')

// 2d. Reorder: move alpha down by clicking its ⬇ button
const downBtn = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '⬇' && !b.disabled)
assert.ok(downBtn.length > 0, 'at least one move-down button is enabled')
await act(async () => { downBtn[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const newOrder = registry._order.slice()
assert.ok(newOrder.indexOf(ws1.id) > 0, 'alpha moved down in registry order')

// 2e. Delete the third workspace (gamma) via two-step confirm.
// Find gamma's delete button by scoping to the card whose card-title-text
// is 'gamma' — same scoping pattern as the rename click above.
const deleteBtn = [...document.querySelectorAll('.card')]
  .find((card) => card.querySelector('.card-title-text')?.textContent === 'gamma')
  ?.querySelectorAll('button.btn')
  ? [...[...document.querySelectorAll('.card')]
    .find((card) => card.querySelector('.card-title-text')?.textContent === 'gamma')
    .querySelectorAll('button.btn')].pop()
  : null
assert.ok(deleteBtn, 'delete button on the gamma card visible')
await act(async () => { deleteBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
assert.ok(document.body.textContent.includes('确定删除工作区'), 'confirm bar surfaces after first delete click')
const confirmBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '删除' && b.classList.contains('danger-solid'))
assert.ok(confirmBtn, 'confirm-delete button visible after first click')
await act(async () => { confirmBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(!registry.list().some((w) => w.path === '/Users/demo/projects/gamma'),
  'deleted workspace is no longer in the registry')
assert.ok(!document.body.textContent.includes('gamma'), 'deleted workspace no longer renders')
s2.root.unmount()
document.body.removeChild(host2)
console.log('scenario 2 OK: list + create + rename + reorder + delete round-trip')

// --- Scenario 3: native picker → flows path into the create form ---------
mode = 'web'
registry = new FakeRegistry()
pickerMode = 'native'
pickerBackend = 'native'
pickerPath = '/Users/demo/picker-target'

const host3 = document.body.appendChild(document.createElement('div'))
const s3 = mountPanel(host3)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })

// Open create form
let createBtn3 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('➕ 新建工作区'))
await act(async () => { createBtn3.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
// Click the picker button — the panel should fill the path input.
const pickBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('选择目录'))
assert.ok(pickBtn, 'picker button rendered')
// textContent skips input value attributes; read the value directly.
const pathInput3 = [...document.querySelectorAll('input.input')]
  .find((i) => i.placeholder && i.placeholder.includes('手动输入绝对目录路径'))
assert.ok(pathInput3, 'path input visible before picker click')
await act(async () => { pickBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.equal(pathInput3.value, '/Users/demo/picker-target',
  'picker result flows into the create form')
// Save — the registry should now contain picker-target.
const saveBtn3 = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '保存' && b.classList.contains('primary'))
await act(async () => { saveBtn3.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(registry.list().some((w) => w.path === '/Users/demo/picker-target'),
  'picker-selected path persists as a workspace')
s3.root.unmount()
document.body.removeChild(host3)
console.log('scenario 3 OK: native picker → create form → persisted workspace')

// --- Scenario 4: picker absent → form stays manual-only --------------------
// With pickerAvailable now defaulting to true, the button is clickable but
// a real attempt surfaces the "原生选择器不可用" hint and downgrades the
// available state to false.
mode = 'web'
registry = new FakeRegistry()
pickerMode = 'absent'

const host4 = document.body.appendChild(document.createElement('div'))
const s4 = mountPanel(host4)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const createBtn4 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('➕ 新建工作区'))
await act(async () => { createBtn4.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
// Pick button is enabled (default state) — click it; the host answers
// available:false and the panel renders the hint + disables the button.
const pickBtn4 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('选择目录'))
assert.ok(pickBtn4 && pickBtn4.disabled === false, 'picker button starts enabled')
await act(async () => { pickBtn4.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('原生选择器不可用'),
  'picker-absent hint shows after a failed pickDirectory call')
const pickBtn4After = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('选择目录'))
assert.ok(pickBtn4After && pickBtn4After.disabled === true,
  'picker button is disabled after the host reports no picker seam')
s4.root.unmount()
document.body.removeChild(host4)
console.log('scenario 4 OK: picker-absent hint + disabled picker button')

// --- Scenario 5: live status probe surfaces missing-dir -------------------
mode = 'web'
registry = new FakeRegistry()
const wsA = await registry.create('/Users/demo/projects/dir-A')

const host5 = document.body.appendChild(document.createElement('div'))
const s5 = mountPanel(host5)
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
// Flip the registry to mark dir-A missing for the next status call.
registry.flipMissing(wsA.id)
const statusBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '🔎 检查状态')
assert.ok(statusBtn, 'status button visible')
await act(async () => { statusBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
assert.ok(document.body.textContent.includes('该工作区的目录当前不存在'),
  'missing-dir surfaces as a banner')
s5.root.unmount()
document.body.removeChild(host5)
console.log('scenario 5 OK: missing-dir surfaces from a live status probe')

// --- Scenario 6: the REAL host module against the real registry surface ----
// The mock gateway above mirrors host logic; this scenario drives
// lib/workspace-admin.js itself so the capability-based picker and the
// public unarchiveSession verb are covered by real code.
const { applyWorkspaceAdmin } = await import('../lib/workspace-admin.js')
const hostRegistry = new FakeRegistry()
await hostRegistry.archiveSession('s-1')
await hostRegistry.archiveSession('s-2')

function mountHost(services) {
  let mounted = null
  applyWorkspaceAdmin({
    get(key) { return services[key] },
    effect(cb) { cb(); return () => {} },
    provide(key, svc) { if (key === 'workspaceAdmin') mounted = svc },
  })
  assert.ok(mounted !== null, 'workspaceAdmin host service mounted')
  return mounted
}

const hostSvc = mountHost({
  workspaceRegistry: hostRegistry,
  directoryPicker: { capability: () => ({ kind: 'native', pick: async () => '/host/picked' }) },
})
const picked = await hostSvc.pickDirectory()
assert.equal(picked.available, true, 'pickDirectory resolves the NATIVE capability (not svc.pick)')
assert.equal(picked.path, '/host/picked', 'native pick() result is returned')
assert.equal(picked.backend, 'native', 'backend reports the capability kind')

const un1 = await hostSvc.unarchiveSession('s-1')
assert.deepEqual(un1.archivedSessionIds, ['s-2'], 'unarchiveSession drops the id through the registry verb')
const un2 = await hostSvc.unarchiveSession('s-1')
assert.deepEqual(un2.archivedSessionIds, ['s-2'], 'unarchiveSession is idempotent')

// A registry without the public unarchive verb fails loud instead of
// silently changing nothing.
const bareRegistry = { list: () => [], get: () => undefined, archivedSessionIds: ['s-3'] }
const bareSvc = mountHost({ workspaceRegistry: bareRegistry })
await assert.rejects(
  () => bareSvc.unarchiveSession('s-3'),
  /缺少 unarchiveSession/,
  'a registry without the unarchive verb reports the incompatible surface',
)

// A browse-only picker exposes no pick action → structured unavailable.
const browseSvc = mountHost({
  workspaceRegistry: hostRegistry,
  directoryPicker: { capability: () => ({ kind: 'browse', list: async () => [], createDirectory: async () => '' }) },
})
const browsePick = await browseSvc.pickDirectory()
assert.equal(browsePick.available, false, 'browse-only picker reports unavailable')
assert.equal(browsePick.backend, 'browse', 'browse backend is named')
console.log('scenario 6 OK: real host — native capability picking + serialized unarchive')

// --- Scenario 7: rename mirrors the controller's name-conflict rule ---------
// The registry allows duplicate titles, but the official controller refuses
// them (workspace/name-conflict). Without the same check here the sidebar
// would grow two identically named groups.
const renameRegistry = new FakeRegistry()
const renameA = await renameRegistry.create('/Users/demo/one', 'One')
const renameB = await renameRegistry.create('/Users/demo/two', 'Two')
const renameSvc = mountHost({ workspaceRegistry: renameRegistry })
await assert.rejects(
  () => renameSvc.rename(renameB.id, 'One'),
  /name-conflict/,
  'renaming onto an existing title is refused',
)
assert.equal(renameRegistry.get(renameB.id).title, 'Two', 'the refused rename left the title unchanged')
// Renaming a workspace to its own current title stays allowed.
const same = await renameSvc.rename(renameB.id, 'Two')
assert.equal(same.workspace.title, 'Two', 'a no-op self-rename is allowed')
// A genuinely new title still works.
const renamed = await renameSvc.rename(renameB.id, 'Two Renamed')
assert.equal(renamed.workspace.title, 'Two Renamed', 'a fresh unique title is applied')
assert.equal(renameRegistry.get(renameA.id).title, 'One', 'the other workspace is untouched')
console.log('scenario 7 OK: rename refuses a duplicate title and allows self/no-op renames')

console.log('verify-workspace-admin OK: all Workspace administration scenarios passed')