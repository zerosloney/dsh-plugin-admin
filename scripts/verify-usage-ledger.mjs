/**
 * Ad-hoc verification for the durable usage ledger (lib/usage-ledger.js) and
 * the `sessionAdmin.usageReport` contract that feeds the 用量仪表盘.
 *
 * Pure half:
 * 1. `usageRowOf` projects one list() row: id required, project chain
 *    (workspace title → cwd basename → 未分组), numbers coerced, `未命名`
 *    never used as a project name.
 * 2. `mergeUsageLedger` upserts live rows, RETENTION: an entry missing from
 *    the live read keeps its numbers and flips to `deleted: true`.
 * 3. `changed` is false for a merge that learned nothing (a dashboard refresh
 *    must not rewrite the file), while the timestamps still advance.
 * 4. `markAbsent: false` is the PARTIAL upsert (the pre-delete snapshot):
 *    absence of the other sessions says nothing, so nothing is retained.
 * 5. Malformed stored entries are dropped; the entry cap prunes the oldest
 *    `lastSeenAt` first.
 * 6. `protect` keeps a read from overwriting observer-owned numbers (the live
 *    event observer's absolute), while a vanished protected id is still
 *    retained with its numbers intact.
 * 7. read/write round-trips through the atomic replace; a broken or missing
 *    file reads as an empty ledger.
 * 8. `createUsageLedger` loads lazily, writes through the caller's serial
 *    queue, skips the write when nothing changed, and returns the FULL row set
 *    (live + retained) from `record()`.
 *
 * Run: node scripts/verify-usage-ledger.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const {
  USAGE_LEDGER_CAP,
  USAGE_LEDGER_VERSION,
  createUsageLedger,
  mergeUsageLedger,
  readUsageLedger,
  usageRowOf,
  writeUsageLedger,
} = await import(new URL('../lib/usage-ledger.js', import.meta.url).href)

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

const tmp = join(here, '../.usage-ledger-tmp')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

/** One sessionAdmin.list() row. */
const session = (overrides = {}) => ({
  id: 's-1',
  title: '标题',
  createdAt: 1000,
  cwd: 'E:/Demo/alpha-project',
  workspaceTitle: null,
  messageCount: 3,
  assistantCount: 4,
  tokens: { input: 100, output: 20, cacheRead: 300, cacheWrite: 5 },
  ...overrides,
})

check('1. usageRowOf projects the dashboard row and refuses a row without an id', () => {
  assert.equal(usageRowOf(null), null)
  assert.equal(usageRowOf({ title: 'x' }), null, 'no id → no row')
  assert.equal(usageRowOf({ id: '' }), null, 'empty id → no row')
  const row = usageRowOf(session({ workspaceTitle: 'alpha-project' }))
  assert.deepEqual(row, {
    id: 's-1',
    title: '标题',
    createdAt: 1000,
    project: 'alpha-project',
    input: 100,
    output: 20,
    cacheRead: 300,
    cacheWrite: 5,
    userMsgs: 3,
    assistantMsgs: 4,
  })
  assert.equal(usageRowOf(session({ workspaceTitle: '未命名' })).project, 'alpha-project', 'a placeholder workspace title falls back to the cwd basename')
  assert.equal(usageRowOf(session({ workspaceTitle: null, cwd: null })).project, '未分组', 'no workspace and no cwd → ungrouped')
  assert.equal(usageRowOf(session({ cwd: 'E:\\Git\\Shipyard.Material' })).project, 'Shipyard.Material', 'windows cwd shortens to its last segment')
  const empty = usageRowOf({ id: 's-x' })
  assert.equal(empty.input, 0, 'a missing tokens bag reads as zero, never NaN')
  assert.equal(empty.userMsgs, 0)
  assert.equal(usageRowOf(session({ tokens: { input: '42' } })).input, 42, 'numeric strings coerce')
})

check('2. a session missing from the live read is RETAINED with its numbers', () => {
  const first = mergeUsageLedger([], [session()], 5000)
  assert.equal(first.changed, true)
  assert.equal(first.retained, 0)
  assert.equal(first.entries[0].deleted, false)
  assert.equal(first.entries[0].lastSeenAt, 5000)

  const second = mergeUsageLedger(first.entries, [], 9000)
  assert.equal(second.entries.length, 1, 'the deleted session stays in the ledger')
  assert.equal(second.entries[0].deleted, true, 'and is flagged deleted')
  assert.equal(second.entries[0].input, 100, 'its last known tokens survive')
  assert.equal(second.retained, 1)
  assert.equal(second.changed, true, 'the retention flip is a change worth writing')

  // A session that comes back (same id, new numbers) is live again.
  const third = mergeUsageLedger(second.entries, [session({ tokens: { input: 999 } })], 10_000)
  assert.equal(third.entries[0].deleted, false)
  assert.equal(third.entries[0].input, 999)
})

check('3. an unchanged refresh reports changed:false but still advances lastSeenAt', () => {
  const first = mergeUsageLedger([], [session()], 1000)
  const again = mergeUsageLedger(first.entries, [session()], 2000)
  assert.equal(again.changed, false, 'nothing new → no disk write')
  assert.equal(again.entries[0].lastSeenAt, 2000, 'the touch still lands in memory')

  const grown = mergeUsageLedger(first.entries, [session({ tokens: { input: 101 } })], 3000)
  assert.equal(grown.changed, true, 'a token delta is a change')
})

check('4. markAbsent:false keeps a PARTIAL upsert from retaining the others', () => {
  const base = mergeUsageLedger([], [session(), session({ id: 's-2', cwd: 'E:/Demo/beta' })], 1000).entries
  const partial = mergeUsageLedger(base, [session({ tokens: { input: 777 } })], 2000, { markAbsent: false })
  assert.equal(partial.entries.length, 2)
  assert.equal(partial.entries.find(e => e.id === 's-1').input, 777, 'the partial row is upserted')
  assert.equal(partial.entries.find(e => e.id === 's-2').deleted, false, 'the untouched session is NOT marked deleted')
})

check('5. malformed entries drop and the cap prunes the oldest lastSeenAt', () => {
  const dirty = mergeUsageLedger([null, 42, { noId: true }, { id: 's-keep', input: 5, lastSeenAt: 1 }], [], 100)
  assert.deepEqual(dirty.entries.map(e => e.id), ['s-keep'], 'unreadable stored entries vanish')

  // Cap: pre-fill with distinctly-aged entries, then add one live row. The
  // oldest retained entries lose; the live row must never be the casualty.
  const aged = Array.from({ length: USAGE_LEDGER_CAP }, (_, index) => ({
    id: 'old-' + String(index), project: 'p', input: index, lastSeenAt: index + 1,
  }))
  const merged = mergeUsageLedger(aged, [session({ id: 'live-1' })], 10_000_000)
  assert.equal(merged.entries.length, USAGE_LEDGER_CAP, 'the ledger is bounded')
  assert.ok(merged.entries.some(e => e.id === 'live-1'), 'a live row is never evicted by retained ones')
  assert.ok(!merged.entries.some(e => e.id === 'old-0'), 'the oldest retained entry is the one dropped')
})

check('6. protect keeps a read from overwriting observer-owned numbers', () => {
  // The live event observer owns a session's absolute totals; a read whose
  // log fold lags behind (or is cap-truncated) must not clobber them. The id
  // is still honoured for presence, so a vanished session is still retained.
  const owned = [{ id: 's-owned', project: 'p', title: '', createdAt: 1, input: 1500, output: 10, cacheRead: 0, cacheWrite: 0, userMsgs: 1, assistantMsgs: 1, lastSeenAt: 5, deleted: false }]
  const stale = [{ id: 's-owned', tokens: { input: 0, output: 0 }, cwd: 'E:/Demo/x' }, session({ id: 's-other' })]
  const protectedMerge = mergeUsageLedger(owned, stale, 200, { protect: new Set(['s-owned']) })
  const kept = protectedMerge.entries.find(e => e.id === 's-owned')
  assert.equal(kept.input, 1500, 'the observer-owned number survives the read')
  assert.equal(kept.deleted, false, 'a live protected session stays live')
  assert.equal(protectedMerge.entries.find(e => e.id === 's-other').input, 100, 'unprotected rows still merge')

  // Present in the ledger but ABSENT from the read → retained, numbers intact.
  const gone = mergeUsageLedger(owned, [], 300, { protect: new Set(['s-owned']) })
  assert.equal(gone.entries[0].deleted, true, 'a vanished protected session is still retained')
  assert.equal(gone.entries[0].input, 1500, 'and keeps its numbers')
  assert.equal(gone.retained, 1)
})

check('7. the file round-trips through the atomic replace, and a broken file reads empty', () => {
  const path = join(tmp, 'ledger.json')
  const entries = mergeUsageLedger([], [session()], 1000).entries
  writeUsageLedger(path, entries)
  assert.ok(!existsSync(path + '.ul-tmp'), 'the temp file is renamed away, never left behind')
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, USAGE_LEDGER_VERSION, 'the schema version is stamped')
  assert.deepEqual(readUsageLedger(path), entries, 'read returns what write stored')
  writeFileSync(path, '{ not json')
  assert.deepEqual(readUsageLedger(path), [], 'a hand-broken file degrades to an empty ledger')
  assert.deepEqual(readUsageLedger(join(tmp, 'missing.json')), [], 'a missing file is an empty ledger')
})

await checkAsync('8. createUsageLedger loads lazily, writes through the queue, and skips no-op writes', async () => {
  const path = join(tmp, 'service.json')
  writeUsageLedger(path, mergeUsageLedger([], [session({ id: 's-old', cwd: 'E:/Demo/gone' })], 10).entries)
  const writes = []
  const ledger = createUsageLedger({
    path,
    enqueue: async (fn) => { writes.push(1); return await fn() },
    now: () => 5000,
  })
  assert.equal(ledger.storagePath, path)

  const rows = await ledger.record([session()])
  assert.equal(writes.length, 1, 'the first record writes through the serial queue')
  assert.deepEqual(rows.map(r => r.id).sort(), ['s-1', 's-old'], 'record returns live AND retained rows')
  assert.equal(rows.find(r => r.id === 's-old').deleted, true, 'the pre-existing session was not in the live read → retained')

  await ledger.record([session()])
  assert.equal(writes.length, 1, 'a refresh that learned nothing does not rewrite the file')

  await ledger.upsert([session({ id: 's-2', cwd: 'E:/Demo/beta' })])
  assert.equal(writes.length, 2, 'the partial upsert persists')
  const stored = readUsageLedger(path)
  assert.equal(stored.find(e => e.id === 's-old').deleted, true, 'the retained row survives on disk')
  assert.equal(stored.find(e => e.id === 's-2').deleted, false)
  assert.equal(ledger.entries().length, 3, 'entries() exposes the mirror')

  const memoryOnly = createUsageLedger({})
  assert.equal(memoryOnly.storagePath, null)
  const memoryRows = await memoryOnly.record([session()])
  assert.equal(memoryRows.length, 1, 'a ledger without a path still answers in memory')
})

rmSync(tmp, { recursive: true, force: true })
console.log(results.join('\n'))
console.log(`verify-usage-ledger OK: ${results.length} checks`)
