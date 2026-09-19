/**
 * Ad-hoc verification for the Skills administration settings section:
 *  1. Host without `ctx.sessionSkillCatalog` (base CLI bundle) → panel
 *     renders the "本部署未挂载 dsh-session-skill-catalog" hint, NOT an
 *     error.
 *  2. Host with a populated catalog → panel renders one card per skill
 *     with the model-vs-human badge and the slash-name copy gesture.
 *  3. Model-invocable skills get the 🤖 badge; user-only skills get the
 *     👤 badge — the distinction is the host's `modelInvocable` flag.
 *  4. Host-side rejection (`session/not-found`) surfaces inline as a
 *     banner with the host's message — the panel never throws.
 *  5. Switching the session dropdown re-fetches skills against the new
 *     sessionId; the panel re-renders the cards without stale rows.
 *  6. A late answer for a session the user already left is dropped (the
 *     current list must survive an out-of-order host read).
 *  7. The REAL host module: a missing catalog answers `{ available: false }`,
 *     the projection keeps only JSON-safe leaf fields (never the skill body),
 *     and host rejections carry the `skills-admin:` prefix.
 *
 * Run: node scripts/verify-skills-admin.mjs
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

// jsdom 29 + React 18.3 event delegation does not deliver input events to
// React's onChange in this environment, so drive the exact handlers through
// the element's React fiber — the same handler props a real browser event
// would reach.
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

// ---------- Per-scenario mock switching ----------

// `mode = 'cli'` → sessionSkillCatalog missing (no host service). 'web' → fake present.
let mode = 'web'
let catalog = null

function getCatalog() {
  if (mode !== 'web') return null
  return catalog
}

// Track sessions so the sessionAdmin/list mock has data to return.
let sessions = []
const calls = []
const call = async (method, args) => {
  calls.push({ method, args })
  if (method === 'sessionAdmin/list') {
    return { ok: true, value: { sessions: sessions.slice(), profileDir: '' } }
  }
  if (method === 'skillsAdmin/list') {
    const svc = getCatalog()
    if (svc === null) {
      return { ok: true, value: { available: false, sessionId: args && args.sessionId, skills: [] } }
    }
    return await svc(args.sessionId)
  }
  if (method === 'fsAdmin/reveal') {
    return { ok: true, value: { ok: true } }
  }
  return { ok: false, error: 'unexpected ' + method }
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
  const section = registered.find((r) => r.options.id === 'skills-admin')
  if (section === undefined) throw new Error('skills-admin settings section not registered')
  const face = section.options.inject()
  const root = createRoot(container)
  root.render(React.createElement(section.component, face))
  return { root, face }
}

// --- Scenario 1: CLI mode → unavailable hint --------------------------------
// The catalog absence only surfaces AFTER the panel picks a session and
// calls skillsAdmin/list (the only path the panel uses to set
// `state.available`). Pre-seed at least one session so the picker has a
// selection to read against.
mode = 'cli'
sessions = [{ sessionId: 'session-cli', title: 'CLI-mode session', archived: false }]
catalog = null
const host1 = document.body.appendChild(document.createElement('div'))
const s1 = mountPanel(host1)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(document.body.textContent.includes('本部署未挂载 dsh-session-skill-catalog'),
  'CLI-mode unavailable hint renders')
assert.ok(!document.body.textContent.includes('该会话暂无可用技能'),
  'empty-state message does not show alongside the unavailable hint')
s1.root.unmount()
document.body.removeChild(host1)
console.log('scenario 1 OK: CLI mode renders a quiet hint')

// --- Scenario 2: web mode → sessions + skills render -------------------------
mode = 'web'
sessions = [
  { sessionId: 'session-a', title: 'Session A', archived: false },
  { sessionId: 'session-b', title: 'Session B (archived)', archived: true },
]
catalog = async (sessionId) => {
  if (sessionId === 'session-a') {
    return { ok: true, value: { available: true, sessionId, skills: [
      { name: 'commit', description: '撰写符合规范的提交消息', whenToUse: '用户说 commit / 提交 / 改完的时候', path: '/Users/demo/.agents/skills/commit/SKILL.md', modelInvocable: true },
      { name: 'review', description: '为当前 diff 生成代码审查', path: '/Users/demo/.agents/skills/review/SKILL.md', modelInvocable: false },
      { name: 'no-path', description: '没有 SKILL.md 文件系统来源的技能', modelInvocable: true },
    ] } }
  }
  return { ok: true, value: { available: true, sessionId, skills: [] } }
}
const host2 = document.body.appendChild(document.createElement('div'))
const s2 = mountPanel(host2)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })

// 2a. Session picker populated and the first non-archived session auto-selected
const select = document.querySelector('select')
assert.ok(select, 'session picker rendered')
assert.equal(select.value, 'session-a', 'first non-archived session auto-selected')
// (session-b is in the list but not selected; archived marker in the label,
// and the option is disabled so it cannot be picked.)
assert.ok(select.textContent.includes('已归档'), 'archived session labels with marker')
const archivedOption = [...select.querySelectorAll('option')].find((o) => o.textContent.includes('已归档'))
assert.ok(archivedOption, 'archived option present')
assert.equal(archivedOption.disabled, true, 'archived session is not selectable')

// 2b. Three skill cards rendered
var cards = [...document.querySelectorAll('.card-title-text')]
  .filter((el) => el.textContent.startsWith('/'))
  .map((el) => el.textContent)
assert.deepEqual(cards.slice().sort(), ['/commit', '/no-path', '/review'],
  'three skill cards rendered for session-a')

// 2c. Model-invocable vs user-only badges
assert.ok(document.body.textContent.includes('🤖 模型可调用'),
  'model-invocable skill surfaces the 🤖 badge')
assert.ok(document.body.textContent.includes('👤 仅人类'),
  'user-only skill surfaces the 👤 badge')
// commit and no-path are modelInvocable: 2 badges; review is user-only: 1.
const modelBadgeCount = (document.body.textContent.match(/🤖 模型可调用/g) || []).length
const humanBadgeCount = (document.body.textContent.match(/👤 仅人类/g) || []).length
assert.equal(modelBadgeCount, 2, 'two model-invocable badges')
assert.equal(humanBadgeCount, 1, 'one human-only badge')

// 2d. Per-skill actions: copy /<name> + open path (when present)
const copyBtns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('📋 复制 /name'))
assert.equal(copyBtns.length, 3, 'three copy-slash-name buttons')
const openBtns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('📂 打开目录'))
assert.equal(openBtns.length, 2, 'two open-directory buttons (only skills with a path)')

// 2e. Path appears in the card-sub for skills that have one
assert.ok(document.body.textContent.includes('/Users/demo/.agents/skills/commit/SKILL.md'),
  'commit SKILL.md path rendered in card-sub')
assert.ok(document.body.textContent.includes('/Users/demo/.agents/skills/review/SKILL.md'),
  'review SKILL.md path rendered in card-sub')
// The 'no-path' skill name appears as '/no-path' in the card title (which
// is fine — that's the skill's identifier); what we want to assert is
// that there is NO opening-directory button on its card (no path → no
// open action).
var noPathCard = [...document.querySelectorAll('.card')].find((card) =>
  card.querySelector('.card-title-text')?.textContent === '/no-path'
)
assert.ok(noPathCard, 'no-path card found')
var noPathOpenBtns = [...noPathCard.querySelectorAll('button')].filter((b) => b.textContent?.includes('📂 打开目录'))
assert.equal(noPathOpenBtns.length, 0, 'no open-directory button on the path-less skill')

s2.root.unmount()
document.body.removeChild(host2)
console.log('scenario 2 OK: session picker + three skill cards + model-vs-human badges + path actions')

// --- Scenario 3: copy-slash-name click → /<name> in clipboard ---------------
// jsdom's navigator.clipboard is null by default; we mount a stub for this
// scenario and verify the panel renders the ✓ 已复制 transient badge.
class StubClipboard {
  constructor() { this.lastWrite = null }
  async writeText(text) { this.lastWrite = text }
  async readText() { return this.lastWrite || '' }
}
const stubNavigator = Object.assign(Object.create(globalThis.window.navigator), {
  clipboard: new StubClipboard(),
})
Object.defineProperty(globalThis.window, 'navigator', { value: stubNavigator, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: stubNavigator, configurable: true })

mode = 'web'
sessions = [{ sessionId: 'session-a', title: 'Session A', archived: false }]
catalog = async (sessionId) => ({ ok: true, value: { available: true, sessionId, skills: [
  { name: 'commit', description: 'd', modelInvocable: true },
] } })
const host3 = document.body.appendChild(document.createElement('div'))
const s3 = mountPanel(host3)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
const copyBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('📋 复制 /name'))
assert.ok(copyBtn, 'copy button visible')
await act(async () => { copyBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
assert.equal(globalThis.window.navigator.clipboard.lastWrite, '/commit',
  'clipboard.writeText receives the slash-prefixed name')
assert.ok(document.body.textContent.includes('✓ 已复制'),
  'panel surfaces a transient ✓ 已复制 confirmation')
s3.root.unmount()
document.body.removeChild(host3)
console.log('scenario 3 OK: copy-slash-name writes /<name> to clipboard + transient confirmation')

// --- Scenario 4: host-side rejection surfaces inline ------------------------
// The host answers `{ ok: false, error: 'session "x" not found' }` — the
// panel must NOT throw and must render the rejection message inline.
mode = 'web'
sessions = [{ sessionId: 'session-x', title: 'Session X', archived: false }]
catalog = async (sessionId) => ({ ok: false, error: 'session "' + sessionId + '" not found' })
const host4 = document.body.appendChild(document.createElement('div'))
const s4 = mountPanel(host4)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(document.body.textContent.includes('session "session-x" not found'),
  'host rejection surfaces inline as a banner')
assert.ok(!document.body.textContent.includes('该会话暂无可用技能'),
  'empty-state message does not show alongside an error')
s4.root.unmount()
document.body.removeChild(host4)
console.log('scenario 4 OK: host rejection surfaces inline, no throw')

// --- Scenario 5: switching sessions re-fetches skills -----------------------
// Confirm the dropdown change calls skillsAdmin/list again with the new
// sessionId and replaces the rendered card set.
mode = 'web'
sessions = [
  { sessionId: 'session-p', title: 'Session P', archived: false },
  { sessionId: 'session-q', title: 'Session Q', archived: false },
]
let catalogCalls = []
catalog = async (sessionId) => {
  catalogCalls.push(sessionId)
  if (sessionId === 'session-p') {
    return { ok: true, value: { available: true, sessionId, skills: [
      { name: 'only-in-p', description: 'p-only', modelInvocable: true },
    ] } }
  }
  return { ok: true, value: { available: true, sessionId, skills: [
    { name: 'only-in-q', description: 'q-only', modelInvocable: false },
    { name: 'also-in-q', description: 'q-shared', modelInvocable: true },
  ] } }
}
const host5 = document.body.appendChild(document.createElement('div'))
const s5 = mountPanel(host5)
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(document.body.textContent.includes('/only-in-p'),
  'session-p skill renders on mount')
// Switch to session-q. The select is a controlled component; flipping
// its DOM value alone does not propagate to React — we drive the React
// `onChange` directly with a synthetic event whose `target.value` mirrors
// what a real browser would set after the user picks session-q.
const selectQ = document.querySelector('select')
await fiberHandler(selectQ, 'onChange', { target: { value: 'session-q' }, currentTarget: { value: 'session-q' }, preventDefault() {} })
await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
// After React commits the new selectedSessionId, the skills refresh effect
// fires and reloadSkills() resolves; allow the RPC + render to settle.
assert.ok(document.body.textContent.includes('/only-in-q'),
  'session-q skills replace session-p skills on dropdown change')
assert.ok(!document.body.textContent.includes('/only-in-p'),
  'session-p skill is no longer rendered after switching to session-q')
s5.root.unmount()
document.body.removeChild(host5)
console.log('scenario 5 OK: dropdown switch re-fetches + replaces rendered card set')

// --- Scenario 6: a late answer for a left session never clobbers ------------
// The host can answer out of order: a slow read for the session the user just
// left must be dropped, or the dropdown would name one session while the
// cards showed another's skills.
mode = 'web'
sessions = [
  { sessionId: 'session-slow', title: 'Slow', archived: false },
  { sessionId: 'session-fast', title: 'Fast', archived: false },
]
let releaseSlow = null
catalog = async (sessionId) => {
  if (sessionId === 'session-slow') {
    await new Promise((resolve) => { releaseSlow = resolve })
    return { ok: true, value: { available: true, sessionId, skills: [
      { name: 'slow-skill', description: 's', modelInvocable: true },
    ] } }
  }
  return { ok: true, value: { available: true, sessionId, skills: [
    { name: 'fast-skill', description: 'f', modelInvocable: true },
  ] } }
}
const host6 = document.body.appendChild(document.createElement('div'))
const s6 = mountPanel(host6)
// The mount selects session-slow, whose answer never lands until we release it.
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(releaseSlow !== null, 'the slow request is in flight')
const select6 = document.querySelector('select')
await fiberHandler(select6, 'onChange', { target: { value: 'session-fast' }, currentTarget: { value: 'session-fast' }, preventDefault() {} })
await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
assert.ok(document.body.textContent.includes('/fast-skill'), 'the current session renders while the stale read is pending')
await act(async () => { releaseSlow(); await new Promise((r) => setTimeout(r, 60)) })
assert.ok(!document.body.textContent.includes('/slow-skill'), 'the late answer for the left session is dropped')
assert.ok(document.body.textContent.includes('/fast-skill'), 'the current list survives the late answer')
s6.root.unmount()
document.body.removeChild(host6)
console.log('scenario 6 OK: a late answer for a left session never clobbers the current list')

// --- Scenario 7: the REAL host module's projection --------------------------
// The panel scenarios above answer through a fabricated value; this drives
// lib/skills-admin.js itself so the { available: false } contract, the field
// projection and the error prefixing are covered by real code.
const { applySkillsAdmin } = await import('../lib/skills-admin.js')

function mountHost(getService) {
  let mounted = null
  applySkillsAdmin({
    get: getService,
    effect(cb) { cb(); return () => {} },
    provide(key, svc) { if (key === 'skillsAdmin') mounted = svc },
  })
  assert.ok(mounted !== null, 'skillsAdmin host service mounted')
  return mounted
}

// 7a. No catalog service (base CLI bundle) → structured unavailable.
const cliSvc = mountHost(() => undefined)
assert.deepEqual(await cliSvc.list('session-a'),
  { available: false, sessionId: 'session-a', skills: [] },
  'missing ctx.sessionSkillCatalog answers { available: false }')

// 7b. Projection keeps only the JSON-safe leaf fields and drops malformed rows.
const seenRequests = []
const rawSvc = mountHost(() => ({
  list: async (request) => {
    seenRequests.push(request)
    return { skills: [
      { name: 'commit', path: '/p/SKILL.md', description: 'd', whenToUse: 'w', modelInvocable: true, body: 'SECRET BODY' },
      { name: 'plain', description: 'no path' },
      null,
      42,
    ] }
  },
}))
const projected = await rawSvc.list('session-x')
assert.equal(projected.available, true, 'populated catalog reports available')
assert.deepEqual(projected.skills, [
  { name: 'commit', path: '/p/SKILL.md', description: 'd', whenToUse: 'w', modelInvocable: true },
  { name: 'plain', path: null, description: 'no path', whenToUse: null, modelInvocable: false },
], 'skills project leaf fields only; malformed rows drop')
assert.equal(projected.skills[0].body, undefined, 'the skill body never crosses the boundary')
assert.deepEqual(seenRequests, [{ sessionId: 'session-x' }], 'the catalog is addressed by sessionId')
assert.equal(projected.sessionId, 'session-x', 'the answer echoes the trimmed session id')

// 7c. A host rejection is re-thrown with the panel-readable prefix.
const errSvc = mountHost(() => ({ list: async () => { throw new Error('session/not-found') } }))
await assert.rejects(() => errSvc.list('ghost'), /skills-admin: session\/not-found/,
  'host rejections carry the skills-admin prefix')

// 7d. A blank sessionId is refused when the catalog IS mounted.
await assert.rejects(() => rawSvc.list('  '), /sessionId 必须是非空字符串/,
  'a blank sessionId is rejected')
console.log('scenario 7 OK: host projection — unavailable contract, leaf-only fields, prefixed errors')

console.log('verify-skills-admin OK: all Skills administration scenarios passed')