/**
 * Host-half self-check for the admin remotes (lib/index.js):
 * - Mounts apply() against a fake typert/workspaceRegistry/sessionPersistence context
 * - Drives sessionAdmin.deleteSession and asserts the targeted-detach contract:
 *   exactly ONE detachSession call, on the workspace that accounts the deleted
 *   session, and never on unrelated workspaces (a batch detach lets the
 *   registry's mutate-time membership prune strip whole workspace records —
 *   the bug that emptied workspace accounting and dumped sessions into
 *   ungrouped)
 * - Asserts log-dir removal and archived-set cleanup
 *
 * Run: node scripts/host-check.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Every apply() call in this script mounts a command-hook fs.watch; collect
// each mount's effect disposers so the final cleanup can release them all —
// a live watcher on a since-deleted temp dir wedges the drain on Windows.
const globalEffectDisposers = []

const { apply, localSpecPath, assertPnpmOperand } = await import(new URL('../lib/index.js', import.meta.url).href)

// The log artifact deleteSession is expected to remove from disk.
const logDir = join(here, '../.host-check-tmp/session-to-delete')
rmSync(logDir, { recursive: true, force: true })
mkdirSync(logDir, { recursive: true })
writeFileSync(join(logDir, 'session.jsonl.zstd'), '{}\n')

const TARGET = 'session-target'
const detachCalls = []
const workspaceOf = (name, sessionIds) => ({
  sessionIds,
  detachSession: async (id) => { detachCalls.push({ name, id }) },
})
// A accounts the target plus others; B is an unrelated workspace.
const workspaceA = workspaceOf('A', [TARGET, 'session-other-a'])
const workspaceB = workspaceOf('B', ['session-other-b'])

let nextState = null
// Isolate the command-hook store: applyCommandHookAdmin reads $DSH_HOME at
// mount (and creates + watches the commands dir), so point it at a temp home
// instead of the developer's real ~/.dsh.
const chaHome = join(here, '../.host-check-tmp/dsh-home')
mkdirSync(join(chaHome, 'commands'), { recursive: true })
process.env.DSH_HOME = chaHome
// Typert registry emulation: the real registry (harness packages/typert/
// registry service.ts) allows ONE registration per package name and rejects
// duplicate invocation ids / endpoints — rules the permissive stub below used
// to hide (the merged plugin briefly registered two descriptors under the
// same package, which only explodes against the real registry).
const typertRegistrations = []
const typertRegister = (descriptor) => {
  if (typertRegistrations.some((d) => d.package === descriptor.package)) {
    throw new Error(`typert: Remote package "${descriptor.package}" is already registered`)
  }
  const seen = new Set()
  for (const invocation of descriptor.invocations) {
    const endpoint = `${invocation.namespace}/${invocation.method}`
    if (seen.has(endpoint)) throw new Error(`typert: endpoint "${endpoint}" is already registered`)
    if (typertRegistrations.some((d) => d.invocations.some((i) => i.id === invocation.id))) {
      throw new Error(`typert: invocation id "${invocation.id}" is already registered`)
    }
    seen.add(endpoint)
  }
  typertRegistrations.push(descriptor)
  return () => {}
}
const fakeCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provide: (key, service) => { fakeCtx.provided ??= {}; fakeCtx.provided[key] = service },
  // Collect (not run) the disposers so the final cleanup can release the
  // command-hook fs.watch — a live watcher on a deleted temp dir wedges the
  // drain on Windows.
  effect: (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') globalEffectDisposers.push(dispose)
  },
  get: (name) => (name === 'sessions' ? undefined : undefined),
  commands: {
    // The merged command-hook admin live-registers file-backed slash
    // commands; the host-check only needs the mount to be observable.
    register: (definition) => () => {},
  },
  typert: { register: typertRegister },
  workspaceRegistry: {
    list: () => [workspaceA, workspaceB],
    archivedSessionIds: [TARGET, 'session-stays'],
    requireState: () => ({ archivedSessionIds: [TARGET, 'session-stays'] }),
    setState: async (state) => { nextState = state },
    enqueueOperation: (operation) => operation(),
  },
  sessionPersistence: {
    list: async () => [{ id: TARGET, cwd: 'E:/nowhere', createdAt: 1 }],
    inspect: async () => ({ events: [] }),
    locate: () => ({ kind: 'jsonl', path: join(logDir, 'session.jsonl.zstd') }),
  },
}

apply(fakeCtx)
assert.ok(fakeCtx.provided?.sessionAdmin, 'sessionAdmin service provided')
assert.ok(fakeCtx.provided?.pluginAdmin, 'pluginAdmin service provided')
assert.ok(fakeCtx.provided?.fsAdmin, 'fsAdmin service provided')
assert.ok(fakeCtx.provided?.mcpAdmin, 'mcpAdmin service provided')
assert.ok(fakeCtx.provided?.subagentAdmin, 'subagentAdmin service provided (merged)')
assert.ok(fakeCtx.provided?.commandHookAdmin, 'commandHookAdmin service provided (merged)')
// One unified descriptor per package: all six namespaces ride a single
// registration (a second `typert.register` under 'dsh-plugin-admin' would
// have thrown in the emulated registry above).
assert.equal(typertRegistrations.length, 1, 'exactly one typert registration')
assert.equal(typertRegistrations[0].package, 'dsh-plugin-admin')
assert.deepEqual(
  [...new Set(typertRegistrations[0].invocations.map((i) => i.namespace))].sort(),
  ['commandHookAdmin', 'fsAdmin', 'mcpAdmin', 'pluginAdmin', 'sessionAdmin', 'subagentAdmin'],
  'unified descriptor carries all six namespaces',
)
// The merged command-hook invocations must all be present (commands + hooks
// + the solidified bridge lifecycle).
const chaIds = typertRegistrations[0].invocations.map((i) => i.id)
for (const tail of ['commands/listCommands', 'commands/saveCommand', 'commands/deleteCommand', 'hooks/listHooks', 'hooks/saveHook', 'hooks/deleteHook', 'hooks/setHookEnabled', 'hooks/bridgeInstall', 'hooks/bridgeRemove']) {
  assert.ok(chaIds.includes(`dsh-plugin-admin/${tail}`), `unified descriptor carries ${tail}`)
}


// fsAdmin.reveal validates its input without spawning anything.
await assert.rejects(() => fakeCtx.provided.fsAdmin.reveal(''), /requires a path string/, 'reveal rejects empty path')
await assert.rejects(() => fakeCtx.provided.fsAdmin.reveal(42), /requires a path string/, 'reveal rejects non-string')

await fakeCtx.provided.sessionAdmin.deleteSession(TARGET)

assert.deepEqual(detachCalls, [{ name: 'A', id: TARGET }],
  'detach exactly once, on the accounting workspace only')
assert.ok(!existsSync(logDir), 'session log directory removed')
assert.deepEqual(nextState?.archivedSessionIds, ['session-stays'],
  'target cleared from the archived set, others kept')

// Boundary safety for sessionAdmin.list(): typert gateway rejects results
// with undefined values via assertJsonValue. The host Workspace entity
// exposes its id as `id` (WorkspaceView's `workspaceId` is the wire-side
// rename done by apiproxy) — getting the field name wrong here leaks
// undefined into the response and trips the gateway.
const workspaces = [
  { id: 'w-alpha', title: 'alpha-project', path: 'E:/Demo/alpha-project', sessionIds: ['session-alpha-1'] },
  { id: 'w-beta', title: 'beta-project', path: 'E:/Demo/beta-project', sessionIds: [] },
]
const orphanId = 'session-orphan'
detachCalls.length = 0
const listCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: (name) => (name === 'sessions' ? undefined : undefined),
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => workspaces,
    archivedSessionIds: [orphanId],
    requireState: () => ({ archivedSessionIds: [orphanId] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [
      { id: 'session-alpha-1', cwd: 'E:/Demo/alpha-project', createdAt: 100 },
      { id: orphanId, cwd: 'E:/Demo/loose-project', createdAt: 200 },
    ],
    inspect: async () => ({ events: [] }),
    locate: () => undefined,
  },
}
apply(listCtx)
const listed = await listCtx.provided.sessionAdmin.list()
assert.deepEqual(Object.keys(listed).sort(), ['sessions', 'workspaces'], 'list returns both keys')
for (const w of listed.workspaces) {
  assert.ok(w.workspaceId === null || typeof w.workspaceId === 'string',
    `workspaceId is string|null, got ${String(w.workspaceId)} (undefined would trip typert boundary)`)
  assert.ok(typeof w.title === 'string' && w.title.length > 0, 'workspace title is a non-empty string')
  assert.ok(typeof w.path === 'string' && w.path.length > 0, 'workspace path is a non-empty string')
}
const accounted = listed.sessions.find(s => s.id === 'session-alpha-1')
const orphan = listed.sessions.find(s => s.id === orphanId)
assert.equal(accounted.workspaceId, 'w-alpha', 'accounted session carries its workspaceId')
assert.equal(accounted.workspaceTitle, 'alpha-project', 'accounted session carries the workspace title')
assert.equal(orphan.workspaceId, null, 'orphan session has null workspaceId')
assert.equal(orphan.workspaceTitle, null, 'orphan session has null workspaceTitle')
// Confirm the full payload round-trips through JSON without losing keys (the
// round-trip silently drops undefined values; presence-after-round-trip is a
// direct check that nothing was undefined).
const roundtripped = JSON.parse(JSON.stringify(listed))
assert.equal(roundtripped.sessions.length, listed.sessions.length, 'no fields lost in JSON round-trip')
assert.equal(roundtripped.workspaces.length, 2, 'all workspaces survive the round-trip')

/* ---------------- install/remove operand allowlist ----------------
 * pnpm is spawned with shell:true on Windows, so every operand crossing
 * the RPC boundary must be one shell-inert token. The allowlist must
 * accept real package specs and local paths, and reject the metacharacter
 * family wholesale — before pnpm is ever spawned (validation precedes
 * enqueue, so these never touch the network or disk).
 */
const pluginAdminSvc = fakeCtx.provided.pluginAdmin
for (const bad of ['foo&calc', 'a;b', 'x|y', '>out.txt', '%PATH%', 'a\nrm -rf', '--legacy-peer-deps', '-P', 'pkg < x', 'a b']) {
  await assert.rejects(() => pluginAdminSvc.install(bad), /shell metacharacters|CLI flag/, `install rejects ${JSON.stringify(bad)}`)
  await assert.rejects(() => pluginAdminSvc.remove(bad), /shell metacharacters|CLI flag/, `remove rejects ${JSON.stringify(bad)}`)
}
for (const good of ['dsh-plugin-admin', '@scope/pkg', '@scope/pkg@^1.2.3',
  'E:/Demo/cli-tools/dsh-plugin-admin', 'link:../dsh-x', 'file:./pkg.tgz',
  '//nas/share/pkg', '/opt/plugins/x', 'github:user/repo', 'user/repo', '1.2.3', '^0.5.0']) {
  assert.equal(assertPnpmOperand('t', good), good, `allowlist accepts ${good}`)
}

/* ------------------ localSpecPath classification ------------------
 * Remote git/tarball URLs must never surface as local installs (the old
 * `//`-inside-URL branch mislabeled them); drive/UNC/POSIX paths and
 * link:/file: specs must keep resolving to their local source path.
 */
assert.equal(localSpecPath('https://github.com/user/repo.git'), null, 'https git URL is not local')
assert.equal(localSpecPath('git+ssh://git@host/user/repo.git'), null, 'ssh git URL is not local')
assert.equal(localSpecPath('github:user/repo'), null, 'github shorthand is not local')
assert.equal(localSpecPath('E:/Demo/cli-tools/dsh-plugin-admin'), 'E:/Demo/cli-tools/dsh-plugin-admin', 'drive path stays local')
assert.equal(localSpecPath('//nas/share/pkg'), '//nas/share/pkg', 'UNC stays local')
assert.equal(localSpecPath('/opt/plugins/x'), '/opt/plugins/x', 'POSIX absolute stays local')
assert.equal(localSpecPath('link:../dsh-x'), '../dsh-x', 'link: resolves to its path')
assert.equal(localSpecPath('file:./pkg.tgz'), './pkg.tgz', 'file: resolves to its path')
assert.equal(localSpecPath('^1.2.3'), null, 'semver range is not local')
assert.equal(localSpecPath('1.2.3'), null, 'plain version is not local')

/* ------------ deleteSession fails closed on shared log dirs ------------
 * The recursive rm owns the whole artifact directory. If another session
 * resolves into the same directory, deletion must refuse instead of
 * wiping the neighbor's log with it.
 */
const sharedRoot = join(here, '../.host-check-tmp/co-tenant')
mkdirSync(join(sharedRoot, 'inside'), { recursive: true })
writeFileSync(join(sharedRoot, 'inside', 'session-shared.jsonl.zstd'), '{}\n')
const sharedCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
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
      { id: 'session-shared', cwd: 'E:/nowhere-a', createdAt: 1 },
      { id: 'session-neighbor', cwd: 'E:/nowhere-b', createdAt: 2 },
    ],
    inspect: async () => ({ events: [] }),
    locate: (h) => ({ kind: 'jsonl', path: join(sharedRoot, 'inside', h.id + '.jsonl.zstd') }),
  },
}
apply(sharedCtx)
await assert.rejects(
  () => sharedCtx.provided.sessionAdmin.deleteSession('session-shared'),
  /same directory/,
  'co-located neighbor blocks the recursive rm',
)
assert.ok(existsSync(join(sharedRoot, 'inside')), 'shared directory untouched after refusal')

/* --------------- archive() validates session existence ---------------
 * Archiving an unknown id would pollute the archived set with garbage
 * entries that can never be listed or cleared from the UI.
 */
const archiveCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [],
    archivedSessionIds: [],
    archiveSession: async () => { throw new Error('should not be reached') },
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [{ id: 'session-real', cwd: 'E:/nowhere', createdAt: 1 }],
    inspect: async () => ({ events: [] }),
    locate: () => undefined,
  },
}
apply(archiveCtx)
await assert.rejects(
  () => archiveCtx.provided.sessionAdmin.archive('session-ghost'),
  /does not exist/,
  'archiving an unknown session is refused',
)

/* ----------- apply() probes the registry write path at mount -----------
 * A dsh version that drops requireState/setState/enqueueOperation must
 * fail the plugin mount loudly, not break archive state on first use.
 */
const brokenCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [],
    archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    // setState deliberately missing
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [],
    inspect: async () => ({ events: [] }),
    locate: () => undefined,
  },
}
assert.throws(() => apply(brokenCtx), /missing archived-set write path members \[setState\]/, 'mount fails loudly on a partial registry API')


/* ------------ list() reuses the summary cache across calls ------------
 * With a stable revision the second list() must not re-read events; the
 * inspect counter stays at the first-call count. Without revision tokens
 * (mocks) the TTL path still works but is not asserted here.
 */
let inspectCalls = 0
const cacheCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [],
    archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [{ id: 'session-cached', cwd: 'E:/nowhere', createdAt: 1 }],
    listSnapshots: async () => [{ header: { id: 'session-cached' }, revision: 'rev-1' }],
    inspect: async () => {
      inspectCalls++
      return {
        events: [{ type: 'session/title', data: { title: '缓存标题' } }],
        revision: 'rev-1',
      }
    },
    locate: () => undefined,
  },
}
apply(cacheCtx)
const first = await cacheCtx.provided.sessionAdmin.list()
const second = await cacheCtx.provided.sessionAdmin.list()
assert.equal(inspectCalls, 1, 'second list() reuses the cached summary (revision unchanged)')
assert.equal(first.sessions[0].title, '缓存标题', 'first list derives the title from events')
assert.equal(second.sessions[0].title, '缓存标题', 'second list serves the cached title')
// deleteSession must evict the cache entry: the next list() re-reads the
// (mock) events instead of serving a summary for a session that no longer
// exists — and the cache never accumulates dead sessions.
await cacheCtx.provided.sessionAdmin.deleteSession('session-cached')
const third = await cacheCtx.provided.sessionAdmin.list()
assert.equal(inspectCalls, 2, 'deleteSession evicts the cached summary (next list re-reads)')

/* ---------- list() keeps per-session summary read failures visible ----------
 * A broken event log must not masquerade as an empty, healthy session; failed
 * reads also bypass the revision cache so a later refresh can recover.
 */
let failedInspectCalls = 0
const summaryFailureCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [], archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {}, enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [{ id: 'session-unreadable', cwd: 'E:/nowhere', createdAt: 1 }],
    listSnapshots: async () => [{ header: { id: 'session-unreadable' }, revision: 'rev-broken' }],
    inspect: async () => { failedInspectCalls++; throw new Error('event log unreadable') },
    locate: () => undefined,
  },
}
apply(summaryFailureCtx)
const failedFirst = await summaryFailureCtx.provided.sessionAdmin.list()
const failedSecond = await summaryFailureCtx.provided.sessionAdmin.list()
assert.equal(failedFirst.sessions[0].summaryError, 'event log unreadable', 'list exposes the per-session summary error')
assert.equal(failedInspectCalls, 2, 'summary failures are retried instead of cached by revision')
assert.equal(failedSecond.sessions[0].summaryError, 'event log unreadable', 'retry failure remains visible')

/* -------- deleteSession re-checks that a session did not become live --------
 * The initial check happens before awaiting persistence.list(). If the session
 * opens during that await, the final guard must preserve its log directory.
 */
const becomingLiveDir = join(here, '../.host-check-tmp/session-became-live')
rmSync(becomingLiveDir, { recursive: true, force: true })
mkdirSync(becomingLiveDir, { recursive: true })
writeFileSync(join(becomingLiveDir, 'session.jsonl.zstd'), '{}\n')
const liveAfterList = new Map()
const becomingLiveCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: (name) => name === 'sessions' ? { get: (id) => liveAfterList.get(id) } : undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [], archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {}, enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => {
      liveAfterList.set('session-became-live', { id: 'session-became-live' })
      return [{ id: 'session-became-live', cwd: 'E:/nowhere', createdAt: 1 }]
    },
    inspect: async () => ({ events: [] }),
    locate: () => ({ kind: 'jsonl', path: join(becomingLiveDir, 'session.jsonl.zstd') }),
  },
}
apply(becomingLiveCtx)
await assert.rejects(
  () => becomingLiveCtx.provided.sessionAdmin.deleteSession('session-became-live'),
  /became live/,
  'deletion refuses a session that becomes live after the initial check',
)
assert.ok(existsSync(becomingLiveDir), 'live session log directory remains intact')
rmSync(becomingLiveDir, { recursive: true, force: true })

/* ------------------- mcpAdmin manages cordis.patch.yml -------------------
 * list/upsert/remove must round-trip real YAML entries against a temp
 * profile: upsert adds a stdio + http entry, list reads them back, remove
 * deletes one, and the final file stays valid YAML.
 */
const mcpProfile = join(here, '../.host-check-tmp/mcp-profile')
mkdirSync(mcpProfile, { recursive: true })
writeFileSync(join(mcpProfile, 'package.json'), JSON.stringify({ name: 'mcp-test-profile' }))
writeFileSync(join(mcpProfile, 'cordis.patch.yml'), '[]\n')
const mcpCtx = {
  baseUrl: pathToFileURL(mcpProfile).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [],
    archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [],
    inspect: async () => ({ events: [] }),
    locate: () => undefined,
  },
}
apply(mcpCtx)
const mcp = mcpCtx.provided.mcpAdmin
assert.ok(mcp, 'mcpAdmin service provided')
assert.equal((await mcp.list()).entries.length, 0, 'fresh profile has no MCP entries')
await mcp.upsert({
  id: 'mcp-github',
  config: {
    transport: 'stdio', serverName: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'tok' },
    cwd: 'E:/Demo', toolCallTimeoutMs: 45_000, failOnStartupError: true,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  },
})
await mcp.upsert({
  id: 'mcp-web',
  config: { transport: 'streamable-http', serverName: 'web', url: 'http://localhost:3000/mcp' },
})
const afterUpsert = (await mcp.list()).entries
assert.equal(afterUpsert.length, 2, 'two MCP entries after upserts')
assert.equal(afterUpsert[0].id, 'mcp-github', 'first entry id preserved')
assert.equal(afterUpsert[0].serverName, 'github', 'serverName preserved')
assert.deepEqual(afterUpsert[0].config, {
  transport: 'stdio', serverName: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'tok' },
  cwd: 'E:/Demo', toolCallTimeoutMs: 45_000, failOnStartupError: true,
  reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
}, 'list returns complete editable stdio config')
assert.equal(afterUpsert[1].serverName, 'web', 'http serverName preserved')
// Update in place.
await mcp.upsert({
  id: 'mcp-github',
  config: { transport: 'stdio', serverName: 'github2', command: 'npx', args: ['-y', 'other'] },
})
const afterUpdate = (await mcp.list()).entries
assert.equal(afterUpdate.length, 2, 'upsert replaces in place')
assert.equal(afterUpdate.find(e => e.id === 'mcp-github').serverName, 'github2', 'updated serverName applied')
// Remove one.
await mcp.remove('mcp-web')
const afterRemove = (await mcp.list()).entries
assert.equal(afterRemove.length, 1, 'remove deletes one entry')
assert.equal(afterRemove[0].id, 'mcp-github', 'remaining entry is the right one')
// Concurrent upserts must both persist: patch-file mutations ride the same
// serialized operation queue as pluginAdmin, so two queued writes can never
// interleave a read-modify-write even if an await lands in the body later.
await Promise.all([
  mcp.upsert({ id: 'mcp-race-a', config: { transport: 'stdio', serverName: 'race-a', command: 'npx' } }),
  mcp.upsert({ id: 'mcp-race-b', config: { transport: 'stdio', serverName: 'race-b', command: 'npx' } }),
])
const racedEntries = (await mcp.list()).entries
assert.equal(racedEntries.filter(e => e.id === 'mcp-race-a' || e.id === 'mcp-race-b').length, 2,
  'concurrent upserts both persist through the operation queue')
// Reject malformed input.
await assert.rejects(() => mcp.upsert({ id: 'bad id!', config: { transport: 'stdio', serverName: 'x', command: 'y' } }), /entry id must match/, 'invalid id rejected')
await assert.rejects(() => mcp.upsert({ id: 'ok', config: { transport: 'http', serverName: 'x' } }), /transport must be/, 'invalid transport rejected')
await assert.rejects(() => mcp.upsert({ id: 'ok', config: { transport: 'stdio', serverName: 'x' } }), /require a command/, 'stdio without command rejected')
await assert.rejects(() => mcp.upsert({ id: 'mcp-duplicate', config: { transport: 'stdio', serverName: 'github2', command: 'npx' } }), /already used/, 'duplicate serverName rejected')
// The final patch file stays a valid YAML list.
const patchText = readFileSync(join(mcpProfile, 'cordis.patch.yml'), 'utf8')
assert.ok(patchText.includes('mcp-github'), 'patch file retains the entry id')
assert.ok(patchText.includes('github2'), 'patch file carries the updated serverName')
assert.ok(patchText.includes('@deepseek-ai/dsh-mcp-client'), 'patch file names the MCP client plugin')

/* --- upsert must REPLACE the '[]' placeholder, not append below it ---
 * A fresh profile's cordis.patch.yml is '[]' — a complete YAML document. If
 * upsert appended '- id: ...' after it, the file would contain two documents
 * and dsh would fail at boot with "end of the stream or a document separator
 * is expected". The placeholder line must be replaced by the first entry.
 */
const placeholderProfile = join(here, '../.host-check-tmp/mcp-placeholder-profile')
mkdirSync(placeholderProfile, { recursive: true })
writeFileSync(join(placeholderProfile, 'package.json'), JSON.stringify({ name: 'placeholder-test' }))
// Mirror the real file: a header comment block + the '[]' placeholder.
writeFileSync(join(placeholderProfile, 'cordis.patch.yml'),
  '# Your patch layer for this dsh profile\n# applied after every bundle layer\n[]\n')
const placeholderCtx = {
  baseUrl: pathToFileURL(placeholderProfile).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [],
    archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: { list: async () => [], inspect: async () => ({ events: [] }), locate: () => undefined },
}
apply(placeholderCtx)
await placeholderCtx.provided.mcpAdmin.upsert({
  id: 'mcp-first',
  config: { transport: 'stdio', serverName: 'first', command: 'npx' },
})
const placeholderText = readFileSync(join(placeholderProfile, 'cordis.patch.yml'), 'utf8')
assert.ok(!/\[\]/.test(placeholderText), "'[]' placeholder replaced by the first entry, not left in place")
assert.ok(placeholderText.includes('- id: "mcp-first"'), 'first entry block present')
// The result must still parse as ONE YAML list document (no trailing garbage).
// js-yaml is not a direct dep here; the exact symptom we guard against is a
// line that starts at column 0 with '- ' AFTER a line containing only '[]'
// (a complete document), which js-yaml rejects with "end of the stream or a
// document separator is expected". Assert the file has no '[]' document and
// its first non-comment line starts a list item.
const placeholderLines = placeholderText.split(/\r?\n/).map((l) => l.trim())
assert.ok(!placeholderLines.includes('[]'), 'no standalone [] document remains')
assert.ok(placeholderLines.some((l) => l.startsWith('- id:')), 'a list item block starts the document')
rmSync(placeholderProfile, { recursive: true, force: true })

/* ------------------- mcpAdmin.test: real connectivity probes -------------------
 * The probe must speak real MCP over both transports: a stdio server process
 * that answers newline-delimited JSON-RPC, and a streamable-http server that
 * answers initialize over HTTP. Success cases report serverInfo + toolCount;
 * a dead endpoint fails fast instead of hanging.
 */
import { createServer } from 'node:http'

// --- stdio fixture server: a tiny newline-delimited JSON-RPC MCP server ---
const stdioFixture = join(here, '../.host-check-tmp/mcp-stdio-server.mjs')
mkdirSync(dirname(stdioFixture), { recursive: true })
writeFileSync(stdioFixture, `import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin, terminal: false })
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
rl.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { return }
  if (req.method === 'initialize') {
    send({ jsonrpc: '2.0', id: req.id, result: {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture-stdio', version: '2.3.4' },
    } })
    return
  }
  if (req.method === 'notifications/initialized') return
  if (req.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } })
  }
})
`)
await mcp.upsert({
  id: 'mcp-probe-stdio',
  config: { transport: 'stdio', serverName: 'probe-stdio', command: process.execPath, args: [stdioFixture] },
})
const stdioProbe = await mcp.test('mcp-probe-stdio')
assert.equal(stdioProbe.ok, true, 'stdio probe succeeds against a live server')
assert.equal(stdioProbe.transport, 'stdio', 'probe reports stdio transport')
assert.equal(stdioProbe.serverInfo?.name, 'fixture-stdio', 'stdio probe reads serverInfo.name')
assert.equal(stdioProbe.serverInfo?.version, '2.3.4', 'stdio probe reads serverInfo.version')
assert.equal(stdioProbe.toolCount, 3, 'stdio probe counts tools from tools/list')
assert.deepEqual(stdioProbe.tools, ['a', 'b', 'c'], 'stdio probe returns tool names from tools/list')
// The result must be JSON-safe (no undefined-valued fields) so it survives
// the typert gateway boundary ("business result failed boundary validation").
assert.equal(JSON.stringify(stdioProbe).includes('undefined'), false, 'probe result is JSON-safe (no undefined literals)')

// Inline command splitting: a single command string with no args must be
// split into executable + args, probe successfully, and carry a warning that
// dsh expects command/args separated. Quote the exe path (it may contain
// spaces, e.g. "C:\Program Files\...") so the split is well-defined.
const inlineFixture = join(here, '../.host-check-tmp2/mcp-stdio-server.mjs')
mkdirSync(dirname(inlineFixture), { recursive: true })
writeFileSync(inlineFixture, readFileSync(stdioFixture))
await mcp.upsert({
  id: 'mcp-probe-inline',
  config: { transport: 'stdio', serverName: 'probe-inline', command: '"' + process.execPath + '" ' + inlineFixture },
})
const inlineProbe = await mcp.test('mcp-probe-inline')
assert.equal(inlineProbe.ok, true, 'inline command split probes successfully')
assert.deepEqual(inlineProbe.tools, ['a', 'b', 'c'], 'inline command split returns tool names')
assert.ok(inlineProbe.warning, 'inline command probe carries a config warning')
rmSync(dirname(inlineFixture), { recursive: true, force: true })

// A command that does not exist must fail with a diagnosable message. On
// Windows a bare name (no extension) is wrapped in cmd.exe — the same as
// cross-spawn does for the real plugin — so the failure surfaces as a
// cmd.exe "not recognized" exit rather than a Node ENOENT; both carry the
// command name in the message.
await mcp.upsert({
  id: 'mcp-probe-missing',
  config: { transport: 'stdio', serverName: 'probe-missing', command: 'definitely-not-a-real-command-xyz' },
})
const missingProbe = await mcp.test('mcp-probe-missing')
assert.equal(missingProbe.ok, false, 'missing command probe fails')
const missingText = (missingProbe.error || '') + ' ' + (missingProbe.stderr || '')
assert.ok(/definitely-not-a-real-command-xyz/.test(missingText), 'missing command error names the command: ' + missingText)

// A command that spawns but never speaks MCP must fail fast (timeout).
const silentFixture = join(here, '../.host-check-tmp/mcp-silent-server.mjs')
writeFileSync(silentFixture, `setInterval(() => {}, 1 << 30)\n`)
await mcp.upsert({
  id: 'mcp-probe-silent',
  config: { transport: 'stdio', serverName: 'probe-silent', command: process.execPath, args: [silentFixture] },
})
const silentProbe = await mcp.test('mcp-probe-silent')
assert.equal(silentProbe.ok, false, 'silent stdio server probe fails')
assert.ok(/timed out/.test(silentProbe.error || ''), 'silent probe reports timeout: ' + silentProbe.error)

// --- streamable-http fixture server: answers initialize over HTTP ---
const httpServer = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let message
    try { message = JSON.parse(body) } catch { res.writeHead(400); res.end(); return }
    if (message.method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: message.id, result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture-http', version: '9.9.9' },
        },
      }))
      return
    }
    if (message.method === 'ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }))
      return
    }
    if (message.method === 'tools/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'http-fetch' }, { name: 'http-search' }] } }))
      return
    }
    res.writeHead(404); res.end()
  })
})
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
const httpPort = httpServer.address().port
await mcp.upsert({
  id: 'mcp-probe-http',
  config: { transport: 'streamable-http', serverName: 'probe-http', url: 'http://127.0.0.1:' + httpPort + '/mcp' },
})
const httpProbe = await mcp.test('mcp-probe-http')
assert.equal(httpProbe.ok, true, 'http probe succeeds against a live server')
assert.equal(httpProbe.transport, 'streamable-http', 'probe reports http transport')
assert.equal(httpProbe.serverInfo?.name, 'fixture-http', 'http probe reads serverInfo.name')
assert.equal(httpProbe.toolCount, 2, 'http probe counts tools from tools/list')
assert.deepEqual(httpProbe.tools, ['http-fetch', 'http-search'], 'http probe returns tool names from tools/list')
assert.equal(httpProbe.pingOk, true, 'http probe ping succeeds')
assert.equal(JSON.stringify(httpProbe).includes('undefined'), false, 'http probe result is JSON-safe')

// A dead HTTP endpoint must fail fast with a clear error.
await mcp.upsert({
  id: 'mcp-probe-http-dead',
  config: { transport: 'streamable-http', serverName: 'probe-http-dead', url: 'http://127.0.0.1:1/mcp' },
})
const deadHttpProbe = await mcp.test('mcp-probe-http-dead')
assert.equal(deadHttpProbe.ok, false, 'dead http endpoint probe fails')
assert.ok(/failed|timed out|refused|ECONNREFUSED/.test(deadHttpProbe.error || ''), 'dead http probe error is diagnosable: ' + deadHttpProbe.error)

// test() rejects for an unknown entry id and for an unparsable config.
await assert.rejects(() => mcp.test('mcp-does-not-exist'), /not found/, 'test on unknown id rejected')
httpServer.close()

rmSync(join(here, '../.host-check-tmp'), { recursive: true, force: true })

/* --------------- closeSession: dispose captured handle then delete ---------------
 * Online sessions are torn down through the captured AgentHandle (the handle
 * the wrapped ctx.agents.create/resume returned) BEFORE their artifacts are
 * removed. The test drives a fake agents service whose resume returns a fake
 * handle, asserts the wrapper captures it, and that closeSession calls
 * dispose() exactly once before the log directory is removed. A live session
 * whose handle was never captured must fail closed with a clear message.
 */
const closeLogDir = join(here, '../.host-check-tmp/session-close')
rmSync(closeLogDir, { recursive: true, force: true })
mkdirSync(closeLogDir, { recursive: true })
writeFileSync(join(closeLogDir, 'session.jsonl.zstd'), '{}\n')

const liveSessions = new Map()
const disposeCalls = []
const fakeHandle = {
  agent: { id: 'session-online' },
  dispose: async () => { disposeCalls.push('session-online') },
}
const fakeAgents = {
  resume: async () => { liveSessions.set('session-online', { id: 'session-online' }); return fakeHandle },
  create: async () => { throw new Error('not used') },
}
let closeDetachCalls = []
const closeCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: (name) => (name === 'sessions' ? { get: (id) => liveSessions.get(id) } : name === 'agents' ? fakeAgents : undefined),
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [{ id: 'w-close', sessionIds: ['session-online'], detachSession: async (id) => { closeDetachCalls.push(id) } }],
    archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [{ id: 'session-online', cwd: 'E:/nowhere', createdAt: 1 }],
    inspect: async () => ({ events: [] }),
    locate: () => ({ kind: 'jsonl', path: join(closeLogDir, 'session.jsonl.zstd') }),
  },
}
apply(closeCtx)
// Capture: calling resume through the wrapped service must record the handle.
const captured = await fakeAgents.resume({ resumeSessionId: 'session-online' })
assert.equal(captured, fakeHandle, 'wrapped resume returns the original handle untouched')
// closeSession on a live session disposes the handle then removes artifacts.
await closeCtx.provided.sessionAdmin.closeSession('session-online')
assert.deepEqual(disposeCalls, ['session-online'], 'closeSession disposes the captured handle exactly once')
assert.ok(!existsSync(closeLogDir), 'closeSession removes the log directory')
assert.deepEqual(closeDetachCalls, ['session-online'], 'closeSession detaches the accounting workspace')

// A live session without a captured handle fails closed (nothing deleted).
const noHandleDir = join(here, '../.host-check-tmp/session-no-handle')
rmSync(noHandleDir, { recursive: true, force: true })
mkdirSync(noHandleDir, { recursive: true })
writeFileSync(join(noHandleDir, 'session.jsonl.zstd'), '{}\n')
const liveNoHandle = new Map([['session-no-handle', { id: 'session-no-handle' }]])
const noHandleCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: (name) => (name === 'sessions' ? { get: (id) => liveNoHandle.get(id) } : name === 'agents' ? fakeAgents : undefined),
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [],
    archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [{ id: 'session-no-handle', cwd: 'E:/nowhere', createdAt: 1 }],
    inspect: async () => ({ events: [] }),
    locate: () => ({ kind: 'jsonl', path: join(noHandleDir, 'session.jsonl.zstd') }),
  },
}
apply(noHandleCtx)
await assert.rejects(
  () => noHandleCtx.provided.sessionAdmin.closeSession('session-no-handle'),
  /not captured/,
  'live session without a captured handle refuses close with a clear error',
)
assert.ok(existsSync(noHandleDir), 'no-handle failure leaves the log directory intact')

// closeSession on a non-live session behaves exactly like deleteSession.
const closeNonLiveDir = join(here, '../.host-check-tmp/session-close-nonlive')
rmSync(closeNonLiveDir, { recursive: true, force: true })
mkdirSync(closeNonLiveDir, { recursive: true })
writeFileSync(join(closeNonLiveDir, 'session.jsonl.zstd'), '{}\n')
const closeNonLiveCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    list: () => [],
    archivedSessionIds: [],
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [{ id: 'session-close-nonlive', cwd: 'E:/nowhere', createdAt: 1 }],
    inspect: async () => ({ events: [] }),
    locate: () => ({ kind: 'jsonl', path: join(closeNonLiveDir, 'session.jsonl.zstd') }),
  },
}
apply(closeNonLiveCtx)
await closeNonLiveCtx.provided.sessionAdmin.closeSession('session-close-nonlive')
assert.ok(!existsSync(closeNonLiveDir), 'closeSession on a non-live session removes its artifacts')

/* ------------------- pluginAdmin.checkUpdates -------------------
 * The registry fetch is injected (fetchLatestVersion takes the registry base
 * URL), so drive it against a local HTTP stub: dsh-remote-tool has a newer
 * version, dsh-custom-tool (local path) and dsh-base (in-box) are skipped.
 */
const { fetchLatestVersion: fetchLatest, checkPluginUpdate: checkUpdate, resolveNpmRegistry: resolveRegistry } =
  await import(new URL('../lib/index.js', import.meta.url).href)

// The stub's answer is mutable (for the force-refresh test) and each served
// request is counted (to prove a forced check really hits the registry).
let stubLatestVersion = '0.9.0'
let stubHits = 0
const registryServer = createServer((req, res) => {
  stubHits++
  res.writeHead(200, { 'Content-Type': 'application/json' })
  if (req.url === '/dsh-remote-tool/latest') {
    res.end(JSON.stringify({ name: 'dsh-remote-tool', version: stubLatestVersion }))
  } else {
    res.end(JSON.stringify({ name: 'unknown', version: '0.0.0' }))
  }
})
await new Promise((resolve) => registryServer.listen(0, '127.0.0.1', resolve))
const registryUrl = 'http://127.0.0.1:' + registryServer.address().port

// fetchLatestVersion against the stub.
assert.equal(await fetchLatest(registryUrl, 'dsh-remote-tool'), '0.9.0', 'fetchLatestVersion reads the latest dist-tag')
assert.equal(await fetchLatest(registryUrl, 'scoped/pkg'), '0.0.0', 'scoped names URL-encode to the stub')
assert.equal(await fetchLatest('http://127.0.0.1:1', 'dsh-remote-tool'), null, 'unreachable registry returns null (never throws)')

// checkPluginUpdate: registry install flags update; local path and in-box skip.
const remoteUpdate = await checkUpdate(registryUrl, { name: 'dsh-remote-tool', version: '0.5.1', dependency: true, localPath: null })
assert.equal(remoteUpdate.updateAvailable, true, 'registry install reports updateAvailable')
assert.equal(remoteUpdate.latest, '0.9.0', 'registry install reports latest version')
const upToDate = await checkUpdate(registryUrl, { name: 'dsh-remote-tool', version: '0.9.0', dependency: true, localPath: null })
assert.equal(upToDate.updateAvailable, false, 'up-to-date registry install reports no update')
const localSkip = await checkUpdate(registryUrl, { name: 'dsh-custom-tool', version: '0.2.0', dependency: true, localPath: 'E:/local' })
assert.equal(localSkip.updateAvailable, false, 'local-path install is skipped')
const inBoxSkip = await checkUpdate(registryUrl, { name: 'dsh-base', version: '1.2.3', dependency: false, localPath: null })
assert.equal(inBoxSkip.updateAvailable, false, 'in-box bundle is skipped')
const deadRegistry = await checkUpdate('http://127.0.0.1:1', { name: 'dsh-remote-tool', version: '0.5.1', dependency: true, localPath: null })
assert.equal(deadRegistry.updateAvailable, false, 'dead registry reports no update')
assert.ok(deadRegistry.error, 'dead registry surfaces an error, not a throw')

// Cache-hit regression: the 5-minute in-memory cache used to store only
// { name, latest }, so a panel re-open inside the TTL read the cached entry as
// "up to date" and the ⬆ 有新版本 reminder vanished on the second open. A cache
// hit must now recompute `updateAvailable` against the CURRENT installed
// version: still-outdated -> reminder kept; upgraded in between -> cleared.
const updateProfile = join(here, '../.host-check-tmp/updates/profile')
const updatePkg = join(updateProfile, 'node_modules/dsh-remote-tool')
rmSync(updateProfile, { recursive: true, force: true })
mkdirSync(updatePkg, { recursive: true })
writeFileSync(join(updateProfile, 'package.json'), JSON.stringify({
  dependencies: { 'dsh-remote-tool': '^0.5.0' },
  dsh: { profile: { bundles: ['dsh-remote-tool'] } },
}, null, 2), 'utf8')
writeFileSync(join(updatePkg, 'package.json'), JSON.stringify({
  name: 'dsh-remote-tool', version: '0.5.1',
  dsh: { bundle: { patch: 'cordis.patch.yml' } },
}, null, 2), 'utf8')
// Pin this profile's registry to the stub — a profile-local .npmrc wins over
// the user-level one, so the test never hits a real mirror. npm test injects
// npm_config_registry into the child env, which resolveNpmRegistry prefers over
// any .npmrc, so neutralise it for this block.
delete process.env.npm_config_registry
writeFileSync(join(updateProfile, '.npmrc'), 'registry=' + registryUrl + '\n', 'utf8')
const updateCtx = {
  baseUrl: pathToFileURL(updateProfile).href,
  provided: {},
  provide: function (key, service) { this.provided[key] = service },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') globalEffectDisposers.push(d) },
  get: () => undefined,
  typert: { register: () => () => {} },
  workspaceRegistry: {
    requireState: () => ({ archivedSessionIds: [] }),
    setState: async () => {},
    enqueueOperation: (op) => op(),
  },
  sessionPersistence: {
    list: async () => [],
    inspect: async () => ({ events: [] }),
    locate: () => undefined,
  },
}
apply(updateCtx)
const ua = updateCtx.provided.pluginAdmin

const firstCheck = await ua.checkUpdates()
const firstHit = firstCheck.updates.find((u) => u.name === 'dsh-remote-tool')
assert.equal(firstHit.updateAvailable, true, 'first (fresh) check reports an update')
assert.equal(firstHit.latest, '0.9.0', 'first check reports the stub latest')

// Second call lands inside the 5-minute TTL and is served from the cache WITH
// the reminder still flagged — this is the regression that used to lose it.
const secondCheck = await ua.checkUpdates()
const secondHit = secondCheck.updates.find((u) => u.name === 'dsh-remote-tool')
assert.equal(secondHit.updateAvailable, true,
  'cache hit within TTL keeps the updateAvailable reminder (re-opening must not lose it)')
assert.equal(secondHit.latest, '0.9.0', 'cache hit serves the cached latest')
assert.equal(secondHit.version, '0.5.1', 'cache hit carries the current installed version')

// Simulate the upgrade completing: bump the installed version, then re-check.
// The cache hit recomputes against the new version and clears the reminder.
writeFileSync(join(updatePkg, 'package.json'), JSON.stringify({
  name: 'dsh-remote-tool', version: '0.9.0',
  dsh: { bundle: { patch: 'cordis.patch.yml' } },
}, null, 2), 'utf8')
const thirdCheck = await ua.checkUpdates()
const thirdHit = thirdCheck.updates.find((u) => u.name === 'dsh-remote-tool')
assert.equal(thirdHit.updateAvailable, false,
  'after the upgrade the reminder clears (更新完删除提醒), even on a cache hit')
assert.equal(thirdHit.latest, '0.9.0', 'post-upgrade cache hit keeps reporting the known latest')

// Forced check (the toolbar 「⬆ 检查更新」button): must bypass the TTL cache,
// re-query the registry and REFRESH the cached content. Bump the stub, force
// once, and verify both the fresh answer and that the next (non-forced) call
// inside the TTL now serves the refreshed value instead of the stale one.
stubLatestVersion = '0.9.1'
const hitsBeforeForce = stubHits
const forcedCheck = await ua.checkUpdates(true)
const forcedHit = forcedCheck.updates.find((u) => u.name === 'dsh-remote-tool')
assert.ok(stubHits > hitsBeforeForce, 'forced check re-queries the registry (bypasses the TTL cache)')
assert.equal(forcedHit.latest, '0.9.1', 'forced check returns the freshly fetched latest')
assert.equal(forcedHit.updateAvailable, true, 'forced check still flags the outdated plugin')
const afterForce = await ua.checkUpdates()
const afterForceHit = afterForce.updates.find((u) => u.name === 'dsh-remote-tool')
assert.equal(afterForceHit.latest, '0.9.1', 'force refreshed the cache content (检查更新强制更新缓存内容)')
assert.equal(afterForceHit.updateAvailable, true, 'refreshed cache keeps flagging')
// Upgrading to the refreshed latest then clears the reminder on a cache hit.
writeFileSync(join(updatePkg, 'package.json'), JSON.stringify({
  name: 'dsh-remote-tool', version: '0.9.1',
  dsh: { bundle: { patch: 'cordis.patch.yml' } },
}, null, 2), 'utf8')
const settledCheck = await ua.checkUpdates()
const settledHit = settledCheck.updates.find((u) => u.name === 'dsh-remote-tool')
assert.equal(settledHit.updateAvailable, false, 'upgrade to the refreshed latest clears the reminder')

rmSync(join(here, '../.host-check-tmp/updates'), { recursive: true, force: true })
registryServer.close()

// resolveNpmRegistry honors the env override.
process.env.npm_config_registry = 'https://registry.example.com'
assert.equal(resolveRegistry(join(here, '..')), 'https://registry.example.com', 'npm_config_registry env override wins')
delete process.env.npm_config_registry
// A profile-local .npmrc registry wins over the user-level one.
const npmrcProfile = join(here, '../.host-check-tmp/npmrc-profile')
mkdirSync(npmrcProfile, { recursive: true })
writeFileSync(join(npmrcProfile, '.npmrc'), 'registry=https://registry.profile-local.example\n', 'utf8')
assert.equal(resolveRegistry(npmrcProfile), 'https://registry.profile-local.example', 'profile-local .npmrc registry is honored')
rmSync(npmrcProfile, { recursive: true, force: true })
// The official default only applies when neither env nor any .npmrc set it;
// the host-check machine configures a mirror, so assert the function returns
// *something* (env- or .npmrc-derived) rather than a hardcoded official URL.
const defaultRegistry = resolveRegistry(join(here, '..'))
assert.ok(typeof defaultRegistry === 'string' && defaultRegistry.startsWith('https://'), 'registry resolution returns a usable URL: ' + defaultRegistry)

// Release every mounted command-hook fs.watch before removing the temp
// home, and restore the developer's real DSH_HOME.
for (const dispose of globalEffectDisposers) {
  try { dispose() } catch { /* teardown is idempotent per contract */ }
}
delete process.env.DSH_HOME
rmSync(join(here, '../.host-check-tmp'), { recursive: true, force: true })

// The packaged manifest must still round-trip (apply() read it for pluginAdmin).
const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'))
assert.equal(pkg.name, 'dsh-plugin-admin')

console.log('host-check OK: targeted detach on delete; log removal; archived-set cleanup; JSON-safe workspace mapping; operand allowlist; localSpecPath classification; shared-log-dir refusal; archive existence validation; list() summary-cache reuse + delete eviction; registry write-path mount probe; mcpAdmin list/upsert/remove round-trip; concurrent upsert serialization; closeSession handle-capture dispose; no-handle fail-closed; non-live close = delete; pluginAdmin.checkUpdates registry stub + skip rules + registry resolution; commandHookAdmin unified descriptor (9 invocations) + service provided')
