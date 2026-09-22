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
 * recipe as the webhook/cron stores) through the caller's serial queue, and
 * pruned to the newest {@link USAGE_LEDGER_CAP} entries. Pure functions do
 * the merging so the dashboard's contract is testable without a filesystem.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'

/** On-disk schema version (bump when an entry field changes meaning). */
export const USAGE_LEDGER_VERSION = 1
/** Entries kept; the oldest `lastSeenAt` loses. Live rows are always newest. */
export const USAGE_LEDGER_CAP = 2000
/** Temp suffix for the atomic replace — distinct per store, same directory. */
const TEMP_SUFFIX = '.ul-tmp'

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
 * @param {object} session - one list() row.
 * @returns {object|null} the ledger row, or null for a row without an id.
 */
export function usageRowOf(session) {
  if (session === null || typeof session !== 'object') return null
  const id = typeof session.id === 'string' && session.id !== '' ? session.id : null
  if (id === null) return null
  const tokens = session.tokens !== null && typeof session.tokens === 'object' ? session.tokens : {}
  const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  return {
    id,
    title: typeof session.title === 'string' ? session.title : '',
    createdAt: count(session.createdAt),
    project: projectOf(session),
    input: count(tokens.input),
    output: count(tokens.output),
    cacheRead: count(tokens.cacheRead),
    cacheWrite: count(tokens.cacheWrite),
    userMsgs: count(session.messageCount),
    assistantMsgs: count(session.assistantCount),
  }
}

/**
 * Normalize one STORED entry (the flat on-disk shape — numbers live at the
 * top level, not under a `tokens` bag). Anything unreadable drops to null so a
 * hand-edited file can never break the dashboard.
 * @param {unknown} raw
 * @returns {object|null}
 */
function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : null
  if (id === null) return null
  const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  const project = typeof raw.project === 'string' && raw.project !== '' ? raw.project : '未分组'
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    createdAt: count(raw.createdAt),
    project,
    input: count(raw.input),
    output: count(raw.output),
    cacheRead: count(raw.cacheRead),
    cacheWrite: count(raw.cacheWrite),
    userMsgs: count(raw.userMsgs),
    assistantMsgs: count(raw.assistantMsgs),
    lastSeenAt: count(raw.lastSeenAt),
    deleted: raw.deleted === true,
  }
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
 * @param {object} [options] - `{ markAbsent, protect }`. `markAbsent: false`
 * is the PARTIAL upsert (the pre-delete snapshot, which knows one session and
 * must not read the other sessions' absence as deletion). `protect` is a Set
 * of session ids whose NUMBERS this read must not touch — the live event
 * observer owns them (its accumulator holds an absolute the log may lag
 * behind); their presence is still honoured, so a protected id missing from
 * the live rows is retained/deleted exactly like any other.
 * @returns {{ entries: object[], changed: boolean, retained: number }}
 * `changed` is false when nothing was added, updated, retained or pruned —
 * the caller then skips the disk write entirely.
 */
export function mergeUsageLedger(previous, rows, now, options = {}) {
  const markAbsent = options.markAbsent !== false
  const protect = options.protect instanceof Set ? options.protect : null
  const byId = new Map()
  for (const raw of Array.isArray(previous) ? previous : []) {
    const entry = normalizeEntry(raw)
    if (entry !== null) byId.set(entry.id, entry)
  }
  const before = byId.size

  const live = new Set()
  let changed = before !== byId.size
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = usageRowOf(raw)
    if (row === null) continue
    live.add(row.id)
    if (protect !== null && protect.has(row.id)) continue
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
  if (entries.length > USAGE_LEDGER_CAP) {
    entries = entries
      .slice()
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, USAGE_LEDGER_CAP)
    changed = true
  }
  return { entries, changed, retained: entries.filter((entry) => entry.deleted === true).length }
}

/**
 * Whether two entries carry the same numbers (timestamps excluded on
 * purpose: re-stamping an unchanged row must not force a disk write).
 * @param {object} left
 * @param {object} right
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
 * empty ledger — the dashboard must still render from live sessions.
 * @param {string} path
 * @returns {object[]} normalized entries.
 */
export function readUsageLedger(path) {
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.entries)) return []
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
 * @param {object[]} entries
 */
export function writeUsageLedger(path, entries) {
  const temp = path + TEMP_SUFFIX
  writeFileSync(temp, JSON.stringify({ version: USAGE_LEDGER_VERSION, entries }, null, 2) + '\n', 'utf8')
  renameSync(temp, path)
}

/**
 * Mount a ledger over one file: an in-memory mirror (loaded lazily on the
 * first read) plus write-through persistence on the caller's serial queue, so
 * concurrent dashboard opens cannot interleave file writes.
 * @param {object} [options] - `{ path, enqueue, now }`.
 * @returns {{ record(rows: unknown[]): Promise<object[]>, entries(): object[], storagePath: string|null }}
 */
export function createUsageLedger(options = {}) {
  const path = typeof options.path === 'string' && options.path !== '' ? options.path : null
  const enqueue = typeof options.enqueue === 'function' ? options.enqueue : (async (fn) => fn())
  const now = typeof options.now === 'function' ? options.now : Date.now
  /** @type {object[]|null} loaded mirror; null until the first read. */
  let entries = null

  const ensure = () => {
    if (entries === null) entries = path === null ? [] : readUsageLedger(path)
    return entries
  }

  /**
   * Adopt one merge result and write it through the caller's serial queue.
   * An unchanged merge skips the disk entirely — a dashboard refresh that
   * learned nothing new must not rewrite a 2000-entry file.
   * @param {{ entries: object[], changed: boolean }} merged
   * @returns {Promise<object[]>}
   */
  async function persist(merged) {
    entries = merged.entries
    if (merged.changed && path !== null) {
      await enqueue(() => writeUsageLedger(path, merged.entries))
    }
    return merged.entries
  }

  return {
    /**
     * Merge one live read into the ledger and return the FULL row set the
     * dashboard aggregates (live sessions plus retained deleted ones).
     * @param {unknown[]} rows - live `sessionAdmin.list()` rows.
     * @param {object} [options] - `{ protect }`: ids whose numbers the live
     * event observer owns (see {@link mergeUsageLedger}).
     * @returns {Promise<object[]>}
     */
    async record(rows, options = {}) {
      return await persist(mergeUsageLedger(ensure(), rows, now(), { markAbsent: true, protect: options.protect }))
    },
    /**
     * Merge a PARTIAL read — one session's row, taken just before its log is
     * removed. Absence from a partial read says nothing about the other
     * sessions, so nothing is retained on this path.
     * @param {unknown[]} rows
     * @returns {Promise<object[]>}
     */
    async upsert(rows) {
      return await persist(mergeUsageLedger(ensure(), rows, now(), { markAbsent: false }))
    },
    /** Current mirror (loaded from disk on first call). */
    entries() {
      return ensure().slice()
    },
    storagePath: path,
  }
}
