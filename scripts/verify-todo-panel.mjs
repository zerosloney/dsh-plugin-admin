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

const { apply, parseGitStatusZ, parseGitNumstat, parseGitBranch, gitFileStats, normalizeMcpToolResult } = await import(new URL('../lib/index.js', import.meta.url).href)
const { renderSessionMarkdown, exportFilename } = await import(new URL('../lib/session-export.js', import.meta.url).href)
const { foldHealthReport, healthSummaryLine } = await import(new URL('../lib/health-report.js', import.meta.url).href)

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

check('parseGitBranch reads the -b header across tracking/ahead/detached forms', () => {
  assert.equal(parseGitBranch('## main...origin/main [ahead 1, behind 2]\0 M a\0'), 'main')
  assert.equal(parseGitBranch('## dev\0'), 'dev')
  assert.equal(parseGitBranch('## HEAD (no branch)\0 M a\0'), null, 'detached HEAD reads null')
  assert.equal(parseGitBranch(' M a.txt\0'), null, 'no -b header, no branch')
  assert.equal(parseGitBranch(null), null)
})

check('gitFileStats attaches reveal anchors and branch when asked', () => {
  const payload = gitFileStats(
    '## main\0 M a.txt\0 D gone.txt\0',
    '1\t2\ta.txt\n0\t1\tgone.txt\n',
    null,
    (p) => (p === 'gone.txt' ? { absDir: '/repo' } : { absPath: '/repo/' + p, absDir: '/repo' }),
  )
  assert.equal(payload.branch, 'main')
  const byPath = new Map(payload.changed.map((c) => [c.path, c]))
  assert.deepEqual(byPath.get('a.txt'), { path: 'a.txt', status: 'M', added: 1, removed: 2, absPath: '/repo/a.txt', absDir: '/repo' })
  assert.deepEqual(byPath.get('gone.txt'), { path: 'gone.txt', status: 'D', added: 0, removed: 1, absDir: '/repo' }, 'deleted file anchors to its directory')
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
    // Real handle-based contract: list() → { header, revision } snapshots,
    // stat() → one snapshot or undefined, open(id,'read') → read handle.
    list: async () => [
      { header: { id: 'git-session', cwd: repoDir, createdAt: 1 }, revision: 'r1' },
      { header: { id: 'git-session-2', cwd: repoDir, createdAt: 2 }, revision: 'r2' },
      { header: { id: 'plain-session', cwd: here, createdAt: 3 }, revision: 'r3' },
    ],
    stat: async (id) => {
      const cwd = id === 'git-session' || id === 'git-session-2' ? repoDir : id === 'plain-session' ? here : undefined
      return cwd === undefined ? undefined : { header: { id, cwd, createdAt: 1 }, revision: 'r', sizeBytes: null }
    },
    open: async () => ({ read: async () => [], close: async () => {} }),
  },
}
await apply(fileCtx)
const sessionAdmin = fileCtx.provided.sessionAdmin

await checkAsync('fileStats folds the real git working tree into per-file stats', async () => {
  const stats = await sessionAdmin.fileStats('git-session')
  assert.equal(stats.files, 3)
  assert.equal(stats.added, 4, '2 modified lines + 2 untracked lines')
  assert.equal(stats.removed, 2)
  assert.equal(stats.branch, execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf8' }).trim(), 'branch from git status -b')
  const byPath = new Map(stats.changed.map((c) => [c.path, c]))
  assert.equal(byPath.get('a.txt').status, 'M')
  assert.equal(byPath.get('a.txt').added, 2)
  assert.equal(byPath.get('a.txt').removed, 1)
  assert.equal(byPath.get('a.txt').absPath, join(repoDir, 'a.txt'), 'existing file anchors to itself')
  assert.equal(byPath.get('a.txt').absDir, repoDir)
  assert.equal(byPath.get('b.txt').status, 'D')
  assert.equal(byPath.get('b.txt').removed, 1)
  assert.equal(byPath.get('b.txt').absPath, undefined, 'deleted file has no file anchor')
  assert.equal(byPath.get('b.txt').absDir, repoDir, 'deleted file anchors to its directory')
  assert.equal(byPath.get('c.txt').status, '?')
  assert.equal(byPath.get('c.txt').added, 2, 'untracked lines counted directly')
  assert.equal(byPath.get('c.txt').absPath, join(repoDir, 'c.txt'))
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
  assert.deepEqual(none, { files: 0, added: 0, removed: 0, branch: null, changed: [] })
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

/* ---- Markdown transcript rendering (pure) ---- */

const EXPORT_EVENTS = [
  { type: 'session/title', data: { title: '修复登录' } },
  { type: 'user/message', data: { content: [{ type: 'text', text: '登录页 500 了' }] } },
  { type: 'assistant/message', data: { message: { role: 'assistant', content: [
    { type: 'text', text: '我先看一下日志。' },
    { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"file_path":"/a.py"}' },
  ] } } },
  { type: 'turn/start', data: {} },
  { type: 'user/message', data: { content: [{ type: 'image', attachment: {} }] } },
]

check('renderSessionMarkdown produces readable sections in log order', () => {
  const r = renderSessionMarkdown(
    { id: 'session-abcdef12-3344', title: '修复登录', cwd: 'E:/repo', createdAt: Date.parse('2026-09-04T10:00:00Z') },
    EXPORT_EVENTS,
  )
  assert.ok(r.markdown.startsWith('# 修复登录'), 'title heading first')
  assert.ok(r.markdown.includes('`session-abcdef12-3344`'), 'session id in the meta block')
  assert.ok(r.markdown.includes('## 👤 用户\n\n登录页 500 了'), 'user prose section')
  assert.ok(r.markdown.includes('## 🤖 助手\n\n我先看一下日志。'), 'assistant prose section')
  assert.ok(r.markdown.includes('> 🔧 `read` — {"file_path":"/a.py"}'), 'tool call quoted as a one-liner')
  assert.ok(r.markdown.includes('[图片]'), 'image-only message still exports')
  assert.equal(r.messages, 3)
  assert.equal(r.toolCalls, 1)
  assert.ok(!r.markdown.includes('turn/start'), 'non-message events stay out of the transcript')
})

check('renderSessionMarkdown tolerates empty and malformed logs', () => {
  const empty = renderSessionMarkdown({ id: 's1' }, [])
  assert.ok(empty.markdown.includes('没有可导出的消息'), 'empty transcript marker')
  const noise = renderSessionMarkdown(null, [null, { type: 'turn/start' }, 42])
  assert.ok(noise.messages === 0 && noise.toolCalls === 0)
})

check('exportFilename slugs the title and anchors the short id + date', () => {
  const name = exportFilename({ id: 'session-abcdef12-3344', title: '修复 登录/权限?', createdAt: Date.parse('2026-09-04T10:00:00Z') })
  assert.equal(name, 'dsh-session-修复-登录-权限-f12-3344-2026-09-04.md')
})

/* ---- host RPCs: exportSession + gitDiff against the real temp repo ---- */

const exportCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provide: (key, service) => { exportCtx.provided ??= {}; exportCtx.provided[key] = service },
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
    list: async () => [{ header: { id: 'exp-session', cwd: repoDir, createdAt: Date.parse('2026-09-04T10:00:00Z') }, revision: 'r' }],
    stat: async (id) => (id === 'exp-session'
      ? { header: { id: 'exp-session', title: '修复登录', cwd: repoDir, createdAt: Date.parse('2026-09-04T10:00:00Z') }, revision: 'r', sizeBytes: null }
      : undefined),
    open: async (id) => ({
      read: async () => (id === 'exp-session' ? EXPORT_EVENTS : []),
      close: async () => {},
    }),
  },
}
await apply(exportCtx)
const exportAdmin = exportCtx.provided.sessionAdmin

await checkAsync('exportSession renders the persisted log into markdown + filename', async () => {
  const out = await exportAdmin.exportSession('exp-session')
  assert.ok(out.markdown.startsWith('# 修复登录'))
  assert.ok(out.markdown.includes('## 🤖 助手'), 'assistant section present')
  assert.equal(out.messages, 3)
  assert.ok(out.filename.startsWith('dsh-session-'), 'download filename shaped')
  await assert.rejects(() => exportAdmin.exportSession('ghost'), /does not exist/, 'unknown session fails loud')
})

await checkAsync('gitDiff returns the workspace diff and flags nothing when small', async () => {
  const out = await exportAdmin.gitDiff('exp-session')
  assert.ok(out.diff.includes('a.txt'), 'diff names the modified file')
  assert.ok(out.diff.includes('TWO'), 'diff carries the change body')
  assert.equal(out.truncated, false)
  const none = await exportAdmin.gitDiff('ghost')
  assert.deepEqual(none, { diff: '', truncated: false }, 'unknown session → empty, not error')
})

check('typert descriptor wires the two new session invocations', () => {
  const src = readFileSync(join(here, '../lib/index.js'), 'utf8')
  assert.ok(src.includes('${PACKAGE}/session/exportSession'), 'export invocation present')
  assert.ok(src.includes("method: 'exportSession'"), 'export method wired')
  assert.ok(src.includes('${PACKAGE}/session/gitDiff'), 'gitDiff invocation present')
})

check('normalizeMcpToolResult concatenates text, flags errors, bounds size', () => {
  const plain = normalizeMcpToolResult({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })
  assert.equal(plain.isError, false)
  assert.equal(plain.text, 'a' + String.fromCharCode(10) + 'b')
  assert.equal(plain.truncated, false)
  const err = normalizeMcpToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] })
  assert.equal(err.isError, true)
  assert.equal(err.text, 'boom')
  const nonText = normalizeMcpToolResult({ content: [{ type: 'resource', uri: 'file:///x' }] })
  assert.ok(nonText.text.includes('resource'), 'non-text blocks render as tagged JSON lines')
  const huge = normalizeMcpToolResult({ content: [{ type: 'text', text: 'x'.repeat(20000) }] })
  assert.equal(huge.truncated, true)
  assert.ok(huge.text.endsWith('…[截断]'))
  assert.deepEqual(normalizeMcpToolResult(null), { isError: false, text: '', truncated: false, content: [] })
})

check('foldHealthReport folds tools/turn-ends/retries', () => {
  const events = [
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { cause: 'user' } } } },
    { type: 'tool/call', data: { callId: 'c1', name: 'read', arguments: '{}' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1' }] }, error: { name: 'FsError', code: 'FS_NOT_FOUND' } } },
    { type: 'assistant/attempt', data: { stream: [] } },
    { type: 'tool/call', data: { callId: 'c2', name: 'edit', arguments: '{}' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'c2' }] } } },
  ]
  const r = foldHealthReport(events)
  assert.equal(r.turns, 2)
  assert.equal(r.completedTurns, 1)
  assert.equal(r.abortedTurns, 1)
  assert.equal(r.retryCount, 1)
  const byName = new Map(r.tools.map((t) => [t.name, t]))
  assert.equal(byName.get('read').calls, 1)
  assert.equal(byName.get('read').errors, 1, 'tool error attributed via callId pairing')
  assert.equal(byName.get('edit').errors, 0)
  assert.equal(r.topErrors[0].code, 'FS_NOT_FOUND')
  assert.ok(healthSummaryLine(r).includes('2 个 turn'))
  assert.ok(healthSummaryLine(r).includes('1 次重试'))
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

// url: without an origin jsdom has no localStorage, and the dock's
// collapse-completed preference genuinely exercises it.
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
  branch: 'feature/dock',
  changed: [
    { path: 'lib/client.js', status: 'M', added: 10, removed: 3, absPath: 'E:/repo/lib/client.js', absDir: 'E:/repo/lib' },
    { path: 'lib/index.js', status: 'A', added: 2, removed: 0, absPath: 'E:/repo/lib/index.js', absDir: 'E:/repo/lib' },
    { path: 'README.md', status: 'D', added: 0, removed: 1, absDir: 'E:/repo' },
  ],
}

let rpcCalls = []
const mockCall = async (method, args) => {
  rpcCalls.push({ method, args })
  if (method === 'sessionAdmin/gitDiff') {
    return { ok: true, value: { diff: 'diff --git a/lib/client.js\n+const x = 1', truncated: false } }
  }
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
  const fill = document.querySelector('.todo-progress-fill')
  assert.ok(fill, 'progress bar mounted')
  assert.equal(fill.style.width, '50%', 'progress reflects 2/4 completed')
  assert.ok(!fill.className.includes('full'), 'partial progress stays blue')
  const items = [...document.querySelectorAll('.todo-item')]
  assert.equal(items.length, 4, 'four todo rows')
  assert.equal(items[0].dataset.status, 'completed')
  assert.equal(items[2].dataset.status, 'in_progress')
  assert.equal(items[3].dataset.status, 'pending')

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  const elapsed = document.querySelector('.todo-elapsed')
  assert.ok(elapsed, 'live elapsed counter rendered on the active step')
  assert.ok(elapsed.textContent.includes('秒') || elapsed.textContent.includes('分'), `elapsed shows a duration, got: ${elapsed.textContent}`)

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
  assert.ok(!fileRows[2].disabled, 'deleted file stays clickable (anchors to its directory)')

  const branchHead = document.querySelector('.todo-files-head .branch-name')
  assert.ok(branchHead, 'branch badge head rendered')
  assert.equal(branchHead.textContent, 'feature/dock')

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

  // Bell stays hidden on platforms without the Notification API (jsdom).
  assert.equal(document.querySelector('.todo-notify'), null, 'no bell without Notification support')

  // Copy-diff: the button pulls the session's diff payload on demand.
  rpcCalls = []
  const copyBtn = document.querySelector('.todo-copy-diff')
  assert.ok(copyBtn, 'copy-diff button rendered in the files head')
  await act(async () => {
    copyBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.ok(rpcCalls.some((c) => c.method === 'sessionAdmin/gitDiff' && c.args.sessionId === 'live-session'), 'copy-diff pulls gitDiff for the session')

  // Click the deleted file's row → fsAdmin/reveal with its directory anchor.
  rpcCalls = []
  await act(async () => {
    fileRows[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const revealCall = rpcCalls.find((c) => c.method === 'fsAdmin/reveal')
  assert.ok(revealCall, 'clicking a file row triggers fsAdmin/reveal')
  assert.equal(revealCall.args.path, 'E:/repo', 'deleted file reveals its directory')
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

await checkAsync('done section folds to a summary row and persists the preference', async () => {
  try { window.localStorage.removeItem('dsh-admin-todo-hide-done') } catch (e) {}
  await mount({
    useProjection: (key) => (key === 'todos' ? TODO_LIST : undefined),
    sessionId: 'live-session',
    call: mockCall,
  })
  const doneToggle = document.querySelector('.todo-done-toggle')
  assert.ok(doneToggle, 'done summary row rendered when completed items exist')
  assert.ok(doneToggle.textContent.includes('2 项已完成'), 'summary counts the completed items')
  assert.equal(doneToggle.getAttribute('aria-expanded'), 'true', 'expanded by default')
  assert.equal(document.querySelectorAll('.todo-item[data-status="completed"]').length, 2, 'struck items visible')

  await act(async () => {
    doneToggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.equal(document.querySelectorAll('.todo-item[data-status="completed"]').length, 0, 'completed rows folded away')
  assert.equal(document.querySelectorAll('.todo-item:not([data-status="completed"])').length, 2, 'active + pending stay visible')
  assert.equal(window.localStorage.getItem('dsh-admin-todo-hide-done'), '1', 'preference persisted')

  await act(async () => {
    document.querySelector('.todo-done-toggle').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.equal(document.querySelectorAll('.todo-item[data-status="completed"]').length, 2, 'expanding restores the struck items')
  await unmount()
})

await checkAsync('progress bar turns green (full) when every item is completed', async () => {
  await mount({
    useProjection: (key) => (key === 'todos' ? [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
    ] : undefined),
    sessionId: 'live-session',
    call: mockCall,
  })
  const fill = document.querySelector('.todo-progress-fill')
  assert.equal(fill.style.width, '100%')
  assert.ok(fill.className.includes('full'), '100% completion switches the fill to success green')
  assert.ok(document.querySelector('.todo-done-toggle').textContent.includes('2 项已完成'))
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
