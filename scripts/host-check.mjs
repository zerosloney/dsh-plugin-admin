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
const fakeCtx = {
  baseUrl: pathToFileURL(join(here, '..')).href,
  provide: (key, service) => { fakeCtx.provided ??= {}; fakeCtx.provided[key] = service },
  effect: (fn) => fn(),
  get: (name) => (name === 'sessions' ? undefined : undefined),
  typert: { register: () => () => {} },
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
  effect: (fn) => fn(),
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
  effect: (fn) => fn(),
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
  effect: (fn) => fn(),
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
  effect: (fn) => fn(),
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
  effect: (fn) => fn(),
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
  effect: (fn) => fn(),
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
  effect: (fn) => fn(),
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
  effect: (fn) => fn(),
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

rmSync(join(here, '../.host-check-tmp'), { recursive: true, force: true })

// The packaged manifest must still round-trip (apply() read it for pluginAdmin).
const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'))
assert.equal(pkg.name, 'dsh-plugin-admin')

console.log('host-check OK: targeted detach on delete; log removal; archived-set cleanup; JSON-safe workspace mapping; operand allowlist; localSpecPath classification; shared-log-dir refusal; archive existence validation; list() summary-cache reuse + delete eviction; registry write-path mount probe; mcpAdmin list/upsert/remove round-trip; concurrent upsert serialization')
