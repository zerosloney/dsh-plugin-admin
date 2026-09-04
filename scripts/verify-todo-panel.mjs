/**
 * Self-check for the 待办清单 todo dock (above the composer):
 *
 * Host half (lib/index.js):
 * - parseGitStatusZ: porcelain -z records, untracked/added/deleted/renamed
 *   status letters, rename old-path skipping
 * - parseGitNumstat: +/- totals, binary rows as zero, brace and arrow rename
 *   path normalization
 * - gitFileStats: joined payload, untracked line-count callback, totals
 * - sessionAdmin.fileStats against a REAL temp git repo: modified / deleted /
 *   untracked files, per-file deltas, 3s TTL cache, unknown session → zeroes
 *
 * Browser half (lib/client.js):
 * - apply() contributes the 'conversation.input.dock' registration (todo-admin)
 * - the dock renders the todos projection list (completed strikethrough,
 *   in_progress spinner, pending), the git file-change rows (status letter,
 *   path, +/-), and the 「第 X / Y 步 · N 个文件已改 +A -B」 footer
 * - while data shows, body.dsh-admin-todo-live hides the shell's own collapsed
 *   todo strip (data-testid=todo-panel); it is removed when the list empties
 * - the footer collapses/expands the list + file section
 *
 * Run: node scripts/verify-todo-panel.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

/* ============================ Host half ============================ */

const { apply, parseGitStatusZ, parseGitNumstat, gitFileStats } = await import(new URL('../lib/index.js', import.meta.url).href)

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

check('parseGitStatusZ reads porcelain -z records and skips rename old paths', () => {
  const out = ' M a.txt\0?? c.txt\0A  added.js\0R  new\0old\0 D gone.txt\0'
  assert.deepEqual(parseGitStatusZ(out), [
    { path: 'a.txt', status: 'M' },
    { path: 'c.txt', status: '?' },
    { path: 'added.js', status: 'A' },
    { path: 'new', status: 'R' },
    { path: 'gone.txt', status: 'D' },
  ])
})

check('parseGitStatusZ tolerates null/empty/malformed input', () => {
  assert.deepEqual(parseGitStatusZ(null), [])
  assert.deepEqual(parseGitStatusZ(''), [])
  assert.deepEqual(parseGitStatusZ('\0\0x'), [])
})

check('parseGitNumstat sums per path and normalizes rename spellings', () => {
  const map = parseGitNumstat('1\t2\ta.txt\n-\t-\tbin.png\n3\t0\t{old => new}/f.js\n4\t1\ttop.js => top2.js\n')
  assert.equal(map.get('a.txt').added, 1)
  assert.equal(map.get('a.txt').removed, 2)
  assert.deepEqual(map.get('bin.png'), { added: 0, removed: 0 }, 'binary rows count zero')
  assert.ok(map.has('new/f.js'), 'brace rename normalizes to the new path')
  assert.ok(map.has('top2.js'), 'arrow rename normalizes to the new path')
  assert.deepEqual(parseGitNumstat(null), new Map())
})

check('gitFileStats joins status rows with numstat and fills untracked lines', () => {
  const statusOut = ' M a.txt\0?? c.txt\0'
  const numstatOut = '1\t2\ta.txt\n'
  const payload = gitFileStats(statusOut, numstatOut, (path) => (path === 'c.txt' ? 5 : null))
  assert.equal(payload.files, 2)
  assert.equal(payload.added, 6, '1 diff-added + 5 untracked lines')
  assert.equal(payload.removed, 2)
  assert.deepEqual(
    payload.changed,
    [
      { path: 'a.txt', status: 'M', added: 1, removed: 2 },
      { path: 'c.txt', status: '?', added: 5, removed: 0 },
    ],
  )
})

/* ---- sessionAdmin.fileStats against a real temp git repo ---- */

const repoDir = join(here, '../.host-check-tmp/todo-verify-repo')
mkdirSync(repoDir, { recursive: true })
const git = (args) => execSync('git ' + args, { cwd: repoDir, stdio: 'ignore' })
if (!existsSync(join(repoDir, '.git'))) {
  git('init')
  git('config user.email t@example.com')
  git('config user.name t')
  writeFileSync(join(repoDir, 'a.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(repoDir, 'b.txt'), 'x\n')
  git('add -A')
  git('commit -m init')
} else {
  // A previous run left the repo behind (Windows cannot rm the read-only
  // .git objects) — restore the clean baseline instead of deleting it.
  git('reset --hard')
  git('clean -fd')
}
// Working tree: modify a.txt (+2/-1), delete b.txt (-1), add untracked c.txt (+2).
writeFileSync(join(repoDir, 'a.txt'), 'one\nTWO\nthree\nfour\n')
rmSync(join(repoDir, 'b.txt'), { force: true })
writeFileSync(join(repoDir, 'c.txt'), 'new line\nanother\n')

// Isolate the command-hook store: apply() mounts a fs.watch on $DSH_HOME.
const chaHome = join(here, '../.host-check-tmp/todo-verify-home')
rmSync(chaHome, { recursive: true, force: true })
mkdirSync(join(chaHome, 'commands'), { recursive: true })
process.env.DSH_HOME = chaHome

const fileCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provide: (key, service) => { fileCtx.provided ??= {}; fileCtx.provided[key] = service },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : undefined },
  get: () => undefined,
  on: () => () => {},
  logger: { info: () => {}, warn: () => {} },
  commands: { register: () => () => {} },
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [],
    archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [
      { id: 'git-session', cwd: repoDir },
      { id: 'git-session-2', cwd: repoDir },
      { id: 'plain-session', cwd: here },
    ],
  },
}
await apply(fileCtx)
const sessionAdmin = fileCtx.provided.sessionAdmin

await checkAsync('fileStats folds the real git working tree into per-file stats', async () => {
  const stats = await sessionAdmin.fileStats('git-session')
  assert.equal(stats.files, 3)
  assert.equal(stats.added, 4, '2 modified lines + 2 untracked lines')
  assert.equal(stats.removed, 2)
  const byPath = new Map(stats.changed.map((c) => [c.path, c]))
  assert.deepEqual(byPath.get('a.txt'), { path: 'a.txt', status: 'M', added: 2, removed: 1 })
  assert.deepEqual(byPath.get('b.txt'), { path: 'b.txt', status: 'D', added: 0, removed: 1 })
  assert.equal(byPath.get('c.txt').status, '?')
  assert.equal(byPath.get('c.txt').added, 2, 'untracked lines counted directly')
})

await checkAsync('fileStats caches per session within the TTL window', async () => {
  // Mutate the repo again; the cached session must keep serving the old fold,
  // a fresh session id folds the new state immediately.
  writeFileSync(join(repoDir, 'd.txt'), 'fresh\n')
  const cached = await sessionAdmin.fileStats('git-session')
  assert.equal(cached.files, 3, 'still the 3s-cached fold')
  const fresh = await sessionAdmin.fileStats('git-session-2')
  assert.equal(fresh.files, 4, 'new session id sees the new file')
})

await checkAsync('fileStats returns zeroes for sessions without a git workspace', async () => {
  const none = await sessionAdmin.fileStats('nope')
  assert.deepEqual(none, { files: 0, added: 0, removed: 0, changed: [] })
})

await checkAsync('fileStats rejects non-string session ids', async () => {
  await assert.rejects(() => sessionAdmin.fileStats(''), /requires a sessionId string/)
  await assert.rejects(() => sessionAdmin.fileStats(42), /requires a sessionId string/)
})

check('typert descriptor carries the fileStats invocation', () => {
  const src = readFileSync(join(here, '../lib/index.js'), 'utf8')
  assert.ok(src.includes('${PACKAGE}/session/fileStats'), 'invocation id present')
  assert.ok(src.includes("method: 'fileStats'"), 'method wired')
})

/* ============================ Browser half ============================ */

// Resolve the browser platform (React 18, jsdom) from the harness checkout
// (primary) or from devDependencies — same resolution as the other verifies.
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

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
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

/* apply() against a mock context, then resolve the todo dock registration. */
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
await checkAsync('apply() contributes the conversation.input.dock todo entry', async () => {
  exports_.apply(mockCtx)
  injectedSlots.forEach((slot) => slot.factory())
  const todo = slotRegistrations.find((entry) => entry.declaration.id === 'todo-admin')
  assert.ok(todo, 'todo-admin registration present')
  assert.equal(todo.declaration.name, 'conversation.input.dock')
  assert.equal(todo.declaration.order, 5)
  assert.equal(typeof todo.declaration.inject().call, 'function', 'inject face carries the RPC call')
})

const todoComponent = slotRegistrations.find((entry) => entry.declaration.id === 'todo-admin').component

const TODO_LIST = [
  { content: '读取既有命令和工作流说明', status: 'completed' },
  { content: '更新 AGENTS.md', status: 'completed' },
  { content: '扩展 check-loop 门禁并验证', status: 'in_progress' },
  { content: '收尾回归', status: 'pending' },
]

const GIT_STATS = {
  files: 3,
  added: 12,
  removed: 4,
  changed: [
    { path: 'lib/client.js', status: 'M', added: 10, removed: 3 },
    { path: 'lib/index.js', status: 'A', added: 2, removed: 0 },
    { path: 'README.md', status: 'D', added: 0, removed: 1 },
  ],
}

let rpcCalls = []
const mockCall = async (method, args) => {
  rpcCalls.push({ method, args })
  return { ok: true, value: GIT_STATS }
}

let host = null
let root = null
async function mount(props) {
  host = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    root = createRoot(host)
    root.render(React.createElement(todoComponent, props))
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

await checkAsync('renders the list, per-file git rows, and the footer totals', async () => {
  rpcCalls = []
  document.body.classList.remove('dsh-admin-todo-live')
  await mount({
    useProjection: (key) => (key === 'todos' ? TODO_LIST : undefined),
    sessionId: 'live-session',
    call: mockCall,
  })
  const panel = document.querySelector('[data-dsh-admin-todo]')
  assert.ok(panel, 'todo panel mounted')
  const items = [...document.querySelectorAll('.todo-item')]
  assert.equal(items.length, 4, 'four todo rows')
  assert.equal(items[0].dataset.status, 'completed')
  assert.equal(items[2].dataset.status, 'in_progress')
  assert.equal(items[3].dataset.status, 'pending')

  const fileRows = [...document.querySelectorAll('.todo-file')]
  assert.equal(fileRows.length, 3, 'three git file rows')
  assert.equal(fileRows[0].dataset.st, 'M')
  assert.equal(fileRows[1].dataset.st, 'A')
  assert.equal(fileRows[2].dataset.st, 'D')
  assert.ok(fileRows[0].textContent.includes('lib/client.js'), 'file path rendered')
  assert.equal(fileRows[0].querySelector('.dir')?.textContent, 'lib/', 'directory prefix rendered as its own dim span')
  assert.equal(fileRows[0].querySelector('.name')?.textContent, 'client.js', 'filename rendered as its own span')
  assert.equal(fileRows[2].querySelector('.dir'), null, 'top-level file has no dir prefix span')
  assert.ok(fileRows[0].textContent.includes('+10') && fileRows[0].textContent.includes('-3'), 'per-file +/- rendered')

  const footer = document.querySelector('.todo-footer')
  assert.ok(footer.textContent.includes('第 3 / 4 步'), `footer derives 第 3 / 4 步, got: ${footer.textContent}`)
  assert.ok(footer.textContent.includes('3 个文件已改'), 'footer carries file count')
  assert.ok(footer.textContent.includes('+12') && footer.textContent.includes('-4'), 'footer carries +/- totals')
  assert.ok(document.body.classList.contains('dsh-admin-todo-live'), 'stock-strip body class active while shown')
  assert.ok(document.querySelector('style[data-plugin-css="dsh-plugin-admin/todo-dock.css"]'), 'todo stylesheet injected')

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  assert.ok(rpcCalls.some((c) => c.method === 'sessionAdmin/fileStats' && c.args.sessionId === 'live-session'), 'fileStats polled for the current session')
  await unmount()
  assert.ok(!document.body.classList.contains('dsh-admin-todo-live'), 'body class removed on unmount')
})

await checkAsync('renders nothing (and releases the body class) while the todo list is empty', async () => {
  document.body.classList.add('dsh-admin-todo-live')
  await mount({
    useProjection: (key) => (key === 'todos' ? [] : undefined),
    sessionId: 'live-session',
    call: mockCall,
  })
  assert.equal(document.querySelector('[data-dsh-admin-todo]'), null, 'no panel without todos')
  assert.ok(!document.body.classList.contains('dsh-admin-todo-live'), 'stock strip restored when empty')
  await unmount()
})

await checkAsync('footer click collapses the list, file section, and toggles aria-expanded', async () => {
  await mount({
    useProjection: (key) => (key === 'todos' ? TODO_LIST : undefined),
    sessionId: 'live-session',
    call: mockCall,
  })
  const footer = document.querySelector('.todo-footer')
  assert.equal(footer.getAttribute('aria-expanded'), 'true')
  await act(async () => {
    footer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.equal(document.querySelector('.todo-list'), null, 'todo list hidden while collapsed')
  assert.equal(document.querySelector('.todo-files'), null, 'file section hidden while collapsed')
  assert.equal(document.querySelector('.todo-footer').getAttribute('aria-expanded'), 'false')
  assert.ok(document.querySelector('.todo-footer').textContent.includes('第 3 / 4 步'), 'collapsed footer keeps the step counts')
  await unmount()
})

console.log(results.join('\n'))
console.log(`verify-todo-panel OK: ${results.length} checks`)
