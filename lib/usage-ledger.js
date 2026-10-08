/**
 * Durable usage ledger for the 用量仪表盘 (VibeUsage posture).
 *
 * dsh's own accounting is per-session and lives in the session log, so
 * deleting a session deletes its tokens with it: the dashboard's 「全部」
 * range shrank every time somebody cleaned up their history, and a
 * delete-then-look sequence lost the record entirely. This module keeps a
 * local aggregate — ONE row per session ever SEEN, keyed by session id — in
 * `$DSH_HOME/usage-ledger.json`, so a deleted session's last known totals
 * stay in the dashboard (flagged `deleted: true`) instead of vanishing.
 *
 * What it can and cannot see: the ledger learns a session from the
 * `sessionAdmin.list()` read behind the dashboard, and from this plugin's own
 * delete paths, which snapshot the row BEFORE the log is removed. A session
 * deleted through dsh's own sidebar that the dashboard never read is not
 * recoverable — its numbers only ever existed in the log that was removed.
 *
 * Storage is one JSON file, atomically replaced (temp + rename, the same
 * recipe as the webhook/cron stores) inside the caller's serial queue AND the
 * cross-process lock (see patch-utils' withFileLock), and pruned to the newest
 * {@link USAGE_LEDGER_CAP} entries. The lock is what makes the merge base "the
 * file on disk unioned with this process's mirror" rather than "whatever this
 * process happened to remember": two dsh instances sharing one home then add
 * rows instead of overwriting each other (see unionUsageEntries). Pure
 * functions do the merging so the dashboard's contract is testable without a
 * filesystem.
 */

import { readFileSync, renameSync } from 'node:fs'
import { readStore, assertStoreReadable } from './store-version.js'
import { withFileLock, writeJsonAtomic } from './patch-utils.js'

/** On-disk schema version (bump when an entry field changes meaning). */
export const USAGE_LEDGER_VERSION = 1
/** Entries kept by default; the oldest `lastSeenAt` loses. Live rows are
 * always newest. Overridable per profile via the plugin config row
 * `usageLedgerCap` (see resolveLedgerCap). */
export const USAGE_LEDGER_CAP = 2000
/** Upper bound for a configured `usageLedgerCap` — the file is rewritten on
 * every change, so a multi-gigabyte cap would wedge the serial queue. */
export const USAGE_LEDGER_CAP_MAX = 100_000
/** Lower bound of the accepted `usageLedgerCap` range — the same floor
 * `resolveLedgerCap` enforces, exported so the config-row validator in
 * lib/index.js fails loud on the SAME range instead of accepting a value the
 * resolver would silently swap for the default. */
export const USAGE_LEDGER_CAP_MIN = 100

/**
 * Resolve the effective ledger cap from a raw plugin config value: a safe
 * integer in [100, USAGE_LEDGER_CAP_MAX] wins, anything else falls back to the
 * default. Kept strict on purpose — a typo'd config must not shrink the
 * ledger to, say, 0 (which would evict every row on the next merge).
 * @param {unknown} raw - plugin config row value (`usageLedgerCap`).
 * @returns {number}
 */
export function resolveLedgerCap(raw) {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= USAGE_LEDGER_CAP_MIN && raw <= USAGE_LEDGER_CAP_MAX
    ? raw
    : USAGE_LEDGER_CAP
}

/**
 * Project label for one session: the accounting workspace's title when it has
 * a real one, else the cwd's last segment, else the ungrouped bucket. Same
 * chain the dashboard has always used, kept here so the ledger and the live
 * read can never disagree about a project name.
 * @param {{ workspaceTitle?: string|null, cwd?: string|null }} session
 * @returns {string}
 */
function projectOf(session) {
  const title = typeof session.workspaceTitle === 'string' ? session.workspaceTitle : ''
  if (title !== '' && title !== '未命名') return title
  const cwd = typeof session.cwd === 'string' ? session.cwd : ''
  if (cwd === '') return '未分组'
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : '未分组'
}

/**
 * Project one `sessionAdmin.list()` row into the dashboard row the ledger
 * stores. Only the fields the dashboard aggregates (plus id/title so a
 * retained row can be named) cross this boundary.
 * @param {unknown} session - one list() row (validated here, not by callers:
 *   the ledger must survive a malformed row rather than trusting its shape).
 * @returns {Record<string, any>|null} the ledger row, or null for a row without an id.
 */
export function usageRowOf(session) {
  if (session === null || typeof session !== 'object') return null
  // The guard leaves a bare `object`; every read below is a defensive
  // `typeof`/`Number()` test on an arbitrary row shape, so name the bag once.
  const row = /** @type {Record<string, any>} */ (session)
  const id = typeof row.id === 'string' && row.id !== '' ? row.id : null
  if (id === null) return null
  const tokens = row.tokens !== null && typeof row.tokens === 'object' ? row.tokens : {}
  /** @param {unknown} value */
  const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  return {
    id,
    title: typeof row.title === 'string' ? row.title : '',
    createdAt: count(row.createdAt),
    project: projectOf(row),
    input: count(tokens.input),
    output: count(tokens.output),
    cacheRead: count(tokens.cacheRead),
    cacheWrite: count(tokens.cacheWrite),
    userMsgs: count(row.messageCount),
    assistantMsgs: count(row.assistantCount),
  }
}

/**
 * Normalize one STORED entry (the flat on-disk shape — numbers live at the
 * top level, not under a `tokens` bag). Anything unreadable drops to null so a
 * hand-edited file can never break the dashboard.
 * @param {unknown} raw
 * @returns {Record<string, any>|null}
 */
function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object') return null
  /** @type {Record<string, any>} */
  const entry = raw
  const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : null
  if (id === null) return null
  /** @param {unknown} value */
  const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  const project = typeof entry.project === 'string' && entry.project !== '' ? entry.project : '未分组'
  return {
    id,
    title: typeof entry.title === 'string' ? entry.title : '',
    createdAt: count(entry.createdAt),
    project,
    input: count(entry.input),
    output: count(entry.output),
    cacheRead: count(entry.cacheRead),
    cacheWrite: count(entry.cacheWrite),
    userMsgs: count(entry.userMsgs),
    assistantMsgs: count(entry.assistantMsgs),
    lastSeenAt: count(entry.lastSeenAt),
    deleted: entry.deleted === true,
  }
}

/**
 * The reason a live row's numbers are NOT a measurement: `sessionAdmin.list()`
 * flags a log it could not read (Windows write-lock window, permissions, a
 * newer session format) with a non-empty `summaryError`, the row itself
 * carrying zeroed counts. Null everywhere else — including a real zero-token
 * session, which is a valid measurement the ledger must store.
 * @param {unknown} row - one list() row.
 * @returns {string|null}
 */
function summaryErrorOf(row) {
  if (row === null || typeof row !== 'object') return null
  const value = /** @type {Record<string, any>} */ (row).summaryError
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Merge one live read into the ledger.
 *
 * Every live row is upserted with `lastSeenAt = now` and `deleted: false`; an
 * entry whose session is absent from the live read keeps its last known
 * numbers and flips to `deleted: true` — that retention IS the feature (a
 * deleted session must not silently shrink the totals). Pruning drops the
 * oldest `lastSeenAt` first, so a live row is never evicted by a retained one.
 *
 * @param {unknown[]} previous - stored entries (may be malformed).
 * @param {unknown[]} rows - live rows from `sessionAdmin.list()`.
 * @param {number} now - epoch ms stamped on every live row.
 * @param {Record<string, any>} [options] - `{ markAbsent, protect }`. `markAbsent: false`
 * is the PARTIAL upsert (the pre-delete snapshot, which knows one session and
 * must not read the other sessions' absence as deletion). `protect` is a Set
 * of session ids whose NUMBERS this read must not touch — the live event
 * observer owns them (its accumulator holds an absolute the log may lag
 * behind); their presence is still honoured, so a protected id missing from
 * the live rows is retained/deleted exactly like any other. A row flagged
 * `summaryError` (unreadable log) gets the same treatment: it counts as live
 * but its zeroed numbers never overwrite the stored totals.
 * @returns {{ entries: Record<string, any>[], changed: boolean, retained: number }}
 * `changed` is false when nothing was added, updated, retained or pruned —
 * the caller then skips the disk write entirely.
 */
export function mergeUsageLedger(previous, rows, now, options = {}) {
  const markAbsent = options.markAbsent !== false
  const protect = options.protect instanceof Set ? options.protect : null
  const cap = resolveLedgerCap(options.cap)
  const byId = new Map()
  for (const raw of Array.isArray(previous) ? previous : []) {
    const entry = normalizeEntry(raw)
    if (entry !== null) byId.set(entry.id, entry)
  }
  const live = new Set()
  // NOT `before !== byId.size`: nothing can change `byId` between those lines, so
  // that expression was a constant false dressed up as a drift check. The flag is
  // set by the live rows, the markAbsent sweep and the cap eviction below.
  let changed = false
  for (const raw of rows) {
    const row = usageRowOf(raw)
    if (row === null) continue
    live.add(row.id)
    if (protect !== null && protect.has(row.id)) continue
    // A log the persistence layer could not READ arrives as an all-zero row
    // flagged `summaryError` (a real zero-token session carries no flag).
    // Writing it would permanently zero the session's accumulated totals —
    // the delete path guards the same thing (recordUsageBeforeRemoval skips
    // summaryError rows); a read must not clobber what it failed to measure.
    // The session still counts as live so it is not flagged deleted.
    if (summaryErrorOf(raw) !== null) continue
    const entry = { ...row, lastSeenAt: now, deleted: false }
    const existing = byId.get(row.id)
    if (existing === undefined || !sameUsage(existing, entry)) changed = true
    byId.set(row.id, entry)
  }
  if (markAbsent) {
    for (const [id, entry] of byId) {
      if (live.has(id) || entry.deleted === true) continue
      byId.set(id, { ...entry, deleted: true })
      changed = true
    }
  }

  let entries = [...byId.values()]
  if (entries.length > cap) {
    entries = entries
      .slice()
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, cap)
    changed = true
  }
  return { entries, changed, retained: entries.filter((entry) => entry.deleted === true).length }
}

/**
 * Whether two entries carry the same numbers (timestamps excluded on
 * purpose: re-stamping an unchanged row must not force a disk write).
 * @param {Record<string, any>} left
 * @param {Record<string, any>} right
 */
function sameUsage(left, right) {
  return left.deleted === right.deleted
    && left.createdAt === right.createdAt
    && left.project === right.project
    && left.title === right.title
    && left.input === right.input
    && left.output === right.output
    && left.cacheRead === right.cacheRead
    && left.cacheWrite === right.cacheWrite
    && left.userMsgs === right.userMsgs
    && left.assistantMsgs === right.assistantMsgs
}

/**
 * Read the ledger file. A missing, unreadable or hand-broken file reads as an
 * empty ledger — the dashboard must still render from live sessions. A file
 * that EXISTS but does not parse is preserved first: the next merge would
 * atomically overwrite it with a fresh ledger, destroying the only evidence
 * of why it broke (a bad disk block reads differently from a hand edit), so
 * it is renamed aside as `<path>.corrupt` before the empty read is returned.
 * @param {string} path
 * @returns {Record<string, any>[]} normalized entries.
 */
export function readUsageLedger(path) {
  let raw
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []   // missing / unreadable: nothing to preserve
  }
  try {
    raw = JSON.parse(text)
  } catch {
    // 存在但解析失败：先留证再按空表继续——下一次合并的原子覆写会抹掉损坏
    // 现场，坏块与手改就再也区分不出来。改名失败（权限/平台）不阻断读取。
    try { renameSync(path, path + '.corrupt') } catch { /* keep reading empty */ }
    return []
  }
  // Phase F2: a file from a NEWER plugin is refused, not misinterpreted —
  // reading it as the current shape and writing it back is silent data loss.
  const classified = readStore(raw, { current: USAGE_LEDGER_VERSION, label: '用量台账 (usage-ledger.json)' })
  assertStoreReadable(classified, '用量台账 (usage-ledger.json)')
  if (classified.data === undefined || !Array.isArray(classified.data.entries)) return []
  raw = classified.data
  const entries = []
  for (const entry of raw.entries) {
    const normalized = normalizeEntry(entry)
    if (normalized !== null) entries.push(normalized)
  }
  return entries
}

/**
 * Atomically replace the ledger file (temp + rename, same recipe as the
 * webhook and cron stores).
 * @param {string} path
 * @param {Record<string, any>[]} entries
 */
export function writeUsageLedger(path, entries) {
  // tempPathFor's unique-per-write temp name (see writeJsonAtomic) is what
  // keeps a second process from renaming our payload away.
  writeJsonAtomic(path, { version: USAGE_LEDGER_VERSION, entries })
}

/**
 * Union two entry lists with MIRROR priority — the in-process mirror is derived
 * from this file plus in-process reads, so on a conflict its row is the fresher
 * one (the live event observer's absolute, or a row this process just learned);
 * every row only the file knows about is kept.
 *
 * This exists because the cross-process lock made the FILE the merge base: a
 * second dsh instance's rows must be merged rather than overwritten, while a
 * row this process already holds (which may not be on disk yet — the mirror is
 * updated before the queued write runs) must not be lost on the way back in.
 * @param {Record<string, any>[]} disk - entries read from the file.
 * @param {Record<string, any>[]} mirror - the in-process mirror (may be empty).
 * @returns {Record<string, any>[]} the union, mirror rows winning by id.
 */
export function unionUsageEntries(disk, mirror) {
  const byId = new Map()
  for (const entry of Array.isArray(disk) ? disk : []) byId.set(entry.id, entry)
  for (const entry of Array.isArray(mirror) ? mirror : []) byId.set(entry.id, entry)
  return [...byId.values()]
}

/**
 * Mount a ledger over one file: an in-memory mirror (loaded lazily on the
 * first read) plus write-through persistence on the caller's serial queue AND
 * under the cross-process lock, so neither concurrent dashboard opens in one
 * process nor a second dsh instance on the same home can interleave — or lose —
 * a read-modify-write of the file.
 * @param {Record<string, any>} [options] - `{ path, enqueue, now, cap }` (`cap` overrides
 *   {@link USAGE_LEDGER_CAP}; see {@link resolveLedgerCap}).
 * @returns {{ record(rows: unknown[], options?: Record<string, any>): Promise<Record<string, any>[]>, upsert(rows: unknown[]): Promise<Record<string, any>[]>, entries(): Record<string, any>[], storagePath: string|null }}
 */
export function createUsageLedger(options = {}) {
  const path = typeof options.path === 'string' && options.path !== '' ? options.path : null
  const enqueue = typeof options.enqueue === 'function' ? options.enqueue : (async (/** @type {() => Promise<any>} */ fn) => fn())
  const now = typeof options.now === 'function' ? options.now : Date.now
  const cap = resolveLedgerCap(options.cap)
  /** @type {Record<string, any>[]|null} loaded mirror; null until the first read. */
  let entries = null

  const ensure = () => {
    if (entries === null) entries = path === null ? [] : readUsageLedger(path)
    return entries
  }

  /**
   * Adopt one merge result and write it through the caller's serial queue,
   * under the cross-process lock (Phase F1 follow-up).
   *
   * The serial queue only orders THIS process; two dsh instances on one profile
   * used to both merge from their own mirror and then both replace the file, so
   * the second writer silently dropped the first one's rows. Now the write is a
   * locked READ-merge-REPLACE: the file is re-read inside the critical section
   * and unioned with the mirror (see {@link unionUsageEntries}), so another
   * instance's rows survive and this instance's in-process rows are not lost.
   *
   * The lock is synchronous by contract (it sleeps with Atomics.wait), so the
   * read, the merge and the write all live inside one synchronous callback —
   * which is exactly why the merge base is the FILE plus the mirror rather than
   * an awaited live read.
   *
   * An unchanged tentative merge still skips the disk entirely: the caller's
   * `enqueue` is not even entered (a dashboard refresh that learned nothing new
   * must not rewrite a 2000-entry file).
   * @param {(base: Record<string, any>[]) => { entries: Record<string, any>[], changed: boolean }} merge
   *   synchronous merge of one base entry list.
   * @returns {Promise<Record<string, any>[]>}
   */
  async function persist(merge) {
    const mirror = entries === null ? [] : entries
    // Cheap pre-check against the mirror: today's semantics, and the reason a
    // no-op refresh costs zero I/O (and zero queue slots).
    const tentative = entries === null ? null : merge(mirror)
    if (tentative !== null && !tentative.changed) return tentative.entries
    if (path === null) {
      entries = (tentative ?? merge(mirror)).entries
      return entries
    }
    return await enqueue(() => {
      const merged = withFileLock(path, () => {
        // Reads the file we are about to replace AND uses it as the base: a
        // newer-version file throws here (before anything is written), and a
        // second instance's rows are merged instead of overwritten.
        //
        // 队列槽内读**当前**内存镜像，而不是 persist() 入场捕获的快照：两个并
        // 发 persist 的入场镜像同源，先写者的结果落盘后，后写者若仍拿入场快照
        // 当 merge base，mirror 优先会把先写者刚落盘的新行用旧值盖回去（删前
        // 快照的最终用量被后台扫描的陈旧数字静默回退，且已删会话再无来源刷新）。
        // 串行队列保证槽内的 `entries` 就是最近一次已提交的内存状态。
        const base = unionUsageEntries(readUsageLedger(path), entries ?? mirror)
        const outcome = merge(base)
        if (outcome.changed) writeUsageLedger(path, outcome.entries)
        return outcome
      })
      entries = merged.entries
      return merged.entries
    })
  }

  return {
    /**
     * Merge one live read into the ledger and return the FULL row set the
     * dashboard aggregates (live sessions plus retained deleted ones).
     * @param {unknown[]} rows - live `sessionAdmin.list()` rows.
     * @param {Record<string, any>} [options] - `{ protect }`: ids whose numbers the live
     * event observer owns (see {@link mergeUsageLedger}).
     * @returns {Promise<Record<string, any>[]>}
     */
    async record(rows, options = {}) {
      return await persist((base) => mergeUsageLedger(base, rows, now(), { markAbsent: true, protect: options.protect, cap }))
    },
    /**
     * Merge a PARTIAL read — one session's row, taken just before its log is
     * removed. Absence from a partial read says nothing about the other
     * sessions, so nothing is retained on this path.
     * @param {unknown[]} rows
     * @param {Record<string, any>} [options] - `{ protect }`: ids whose numbers the
     *   live event observer owns — a log-derived fold can lag the observer
     *   (unflushed tail, scan-cap truncation), so it must not overwrite one.
     * @returns {Promise<Record<string, any>[]>}
     */
    async upsert(rows, options = {}) {
      return await persist((base) => mergeUsageLedger(base, rows, now(), { markAbsent: false, protect: options.protect, cap }))
    },
    /** Current mirror (loaded from disk on first call). */
    entries() {
      return ensure().slice()
    },
    storagePath: path,
  }
}
