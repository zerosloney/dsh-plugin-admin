/**
 * session-admin.js — the sessionAdmin remote + its module machinery.
 *
 * Extracted from lib/index.js (the apply() split, step 4/4): the derived-
 * summary / git-stats caches, the git porcelain/numstat parsers (the todo
 * dock's file-change fold), the JSONL backend layout encoders, the optional
 * workspace-registry helpers, and the session service itself (listing with
 * revision-cached summaries, archive/delete/close with agent-handle teardown,
 * export/health folds, usage-report projection). The usage-ledger wiring
 * stays in index.js; this module reaches it through deps (drain/observe/mark)
 * so the delete-before-snapshot and dashboard-read semantics are unchanged.
 */
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

import { auditService } from './audit-log.js'
import { foldHealthReport, healthSummaryLine } from './health-report.js'
import { jsonSafe } from './mcp-probe.js'
import { mapConcurrent } from './plugin-admin.js'
import { dshHome, messageOf } from './patch-utils.js'
import { renderSessionMarkdown, exportFilename } from './session-export.js'
import { runCommandCaptured } from './run-command.js'
import { isInsidePath, realpathIfExists } from './workspace-path.js'

const SESSION_SERVICE_KEY = 'sessionAdmin'
const SESSION_NAMESPACE = 'sessionAdmin'

/**
 * A promise-chain mutex: operations run one at a time, in submission order,
 * and a rejection never blocks the next. Distinct from `makeSerialQueue` only
 * in INTENT — this one is deliberately module-local so a destructive session
 * operation cannot re-enter the shared patch/JSON queue that its own body
 * enqueues onto (see the note in applySessionAdmin).
 * @returns {<T>(operation: () => Promise<T>) => Promise<T>}
 */
function makeOperationMutex() {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve()
  return (operation) => {
    const run = tail.then(operation, operation)
    tail = run.catch(() => {})
    return run
  }
}

// sessionId -> { revision, title, summary, messageCount, at }. Keyed by the
// persistence revision token so unchanged sessions skip re-reading their
// whole event log on every panel refresh. Bounded by LRU eviction so sessions
// deleted through other paths (CLI, manual file removal) don't leak entries.
// The summary cache's TTL, the list concurrency, and the per-session event
// scan cap are tuned inside applySessionAdmin() from the plugin config row.
const SESSION_CACHE_CAP = 500
const sessionSummaryCache = new Map()
// sessionId -> last read-handle error message. Consumed by list() to mark a
// session's summary row as errored (the old inspect() shape carried it); the
// entry is deleted as soon as a later read succeeds, or the session is removed.
const SESSION_READ_ERRORS_CAP = 500
const sessionReadErrors = new Map()

/** Evict the oldest entry when the cache exceeds its cap.
 * @param {Map<string, any>|Set<string>} cache
 * @param {number} cap */
function enforceCacheCap(cache, cap) {
  while (cache.size >= cap) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * Unwrap one SessionHandle.read() result into the plain event array. Current
 * dsh returns a `SessionHandleReadResult` ({ eventState, events }) since the
 * seed-aliasing change; older builds returned the bare array. Any other shape
 * is a contract drift and throws loud — the callers record it as a per-session
 * read error instead of silently folding an empty log.
 * @param {any} result - the awaited read() result.
 * @returns the event array.
 */
function readEventsOf(result) {
  if (Array.isArray(result)) return result
  if (result !== null && typeof result === 'object' && Array.isArray(result.events)) return result.events
  throw new Error('sessionPersistence.read returned an unrecognized shape (expected an event array or { eventState, events }) — dsh version changed?')
}

/* ========================================================================== */
/*                          File-Change Stats (git)                           */
/* ========================================================================== */

// The todo dock footer's file-change segment is folded from the session
// workspace's LIVE git state (what the repo looks like right now), not from
// the session log — `git status --porcelain=v1 -z` for the file list and
// `git diff --numstat HEAD` for the +/- line totals. Bounded so a huge or
// wedged repo can never hang the polling dock.
// Both budgets ride the same module-level `let` pattern as the pnpm runner:
// their module-scope readers (runGitOutcome's defaults) would keep seeing the old
// value if applySessionAdmin() shadowed them with closure consts, silently
// disabling the config row — the apply assigns instead.
let GIT_TIMEOUT_MS = 5_000
// The git-stats cache TTL is tuned inside applySessionAdmin() from the plugin
// config row (its only reader is the fileStats closure there).
// Untracked files have no diff; their added-line count is taken from a direct
// line count, capped at this size (anything bigger/binary reads as null).
const GIT_UNTRACKED_MAX_BYTES = 512 * 1024
// Copy-diff payload bound: past this the diff ships truncated with a marker,
// because a multi-megabyte paste helps no reviewer.
let GIT_DIFF_MAX_CHARS = 512 * 1024

// sessionId -> { at, value }. Same shape and lifetime rationale as the
// derived-summary cache above. Bounded by the same LRU eviction.
const GIT_STATS_CACHE_CAP = 100
const gitStatsCache = new Map()

/**
 * Run one git command in `cwd` and report its OUTCOME, not just its output.
 *
 * The previous form returned stdout-or-null, which made three different
 * situations indistinguishable: a clean tree (empty stdout, code 0), a timeout,
 * and a git failure (not a repo, no binary). Callers that only need "output or
 * nothing" can keep using {@link runGitText}; callers whose meaning changes with
 * the reason — `gitDiff` reporting an empty diff, `fileStats` reporting all-zero
 * change counts — need the distinction, because "we could not read the state"
 * must not be presented as "there is nothing to read".
 *
 * Asynchronous (never spawnSync) so the host event loop stays responsive, and
 * both streams are drained: reading stdout alone let a git process that writes
 * warnings to stderr block on a full pipe until the timeout.
 * @param {string} cwd - working directory.
 * @param {readonly string[]} args - git arguments.
 * @param {number} [timeoutMs] - budget for this command.
 * @param {number} [maxBytes] - stdout cap.
 * @returns {Promise<{ ok: boolean, stdout: string, truncated: boolean, timedOut: boolean, code: number|null, stderrTail: string }>}
 */
function runGitOutcome(cwd, args, timeoutMs, maxBytes) {
  const budget = timeoutMs ?? GIT_TIMEOUT_MS
  // `timeout` is passed to the spawn AND used to mark the outcome: the child's
  // `code` is null both for a timeout and for a spawn failure, so the budget hit
  // is detected by the elapsed time rather than guessed from a null code.
  const started = Date.now()
  return runCommandCaptured('git', args, {
    cwd,
    timeoutMs: budget,
    maxStdoutChars: maxBytes ?? GIT_DIFF_MAX_CHARS,
  }).then((outcome) => {
    const timedOut = outcome.code === null && !outcome.failed && Date.now() - started >= budget
    return {
      ok: outcome.code === 0,
      stdout: outcome.stdout,
      truncated: outcome.truncated === true,
      timedOut,
      code: outcome.code,
      stderrTail: outcome.stderrTail,
    }
  })
}

/**
 * The most useful stderr line for a human, skipping git's usage noise.
 *
 * A failed `git` invocation frequently answers with its whole option summary
 * (dozens of lines of `--break-rewrites`, `--find-renames`, …) while the line
 * that actually explains the failure is short and comes first — and, because
 * the drain keeps only a TAIL, the explanation may already have scrolled out of
 * the buffer. So this prefers a line naming a cause when one survived, and
 * otherwise returns '' rather than quoting git's help text at the user: an
 * error message that recites unrelated flags is worse than one that only
 * carries the exit code.
 * @param {string} stderrTail - the drained stderr tail.
 * @returns {string} one short line, or '' when nothing diagnostic survived.
 */
function firstDiagnosticLine(stderrTail) {
  if (typeof stderrTail !== 'string' || stderrTail.trim() === '') return ''
  const lines = stderrTail
    .split('\n')
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter((line) => line !== '')
  const diagnostic = lines.find((line) => /not a git repository|no such file or directory|permission denied|unable to |cannot |fatal:|^error:/i.test(line))
  return diagnostic === undefined ? '' : diagnostic.slice(0, 200)
}

/**
 * Parse `git status -b --porcelain=v1 -z` output into change entries. The -z
 * format is NUL-separated `XY <path>` records (a leading `## <branch>` header
 * record when -b is on); renames carry the ORIGINAL path as an extra NUL
 * field after the new one. The status letter is the most user-meaningful of
 * the two index/worktree columns: untracked (`??`) wins, then A (added),
 * D (deleted), R (renamed), default M (modified).
 *
 * An empty string (clean repo) and null (git absent / not a repo / timeout)
 * both yield an empty list — this fold does not distinguish the two; that
 * signal lives in runGitOutcome's `ok: false` upstream.
 * @param {string|null} out - raw git stdout (utf8) or null.
 * @returns {{ path: string, status: string }[]} in git order.
 */
export function parseGitStatusZ(out) {
  /** @type {Array<{ path: string, status: string }>} */
  const changed = []
  if (typeof out !== 'string' || out === '') return changed
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry === '' || entry.startsWith('##')) continue
    if (entry.length < 4) continue
    const x = entry[0]
    const y = entry[1]
    let status = 'M'
    if (x === '?' || y === '?') status = '?'
    else if (x === 'A' || y === 'A') status = 'A'
    else if (x === 'D' || y === 'D') status = 'D'
    else if (x === 'R' || y === 'R') status = 'R'
    else if (x === 'C' || y === 'C') status = 'C'
    changed.push({ path: entry.slice(3), status })
    // Both renames (R) and copies (C) carry the ORIGINAL path as an extra
    // NUL field after the new one — skip it to stay in sync with the stream.
    if (status === 'R' || status === 'C') i++
  }
  return changed
}


/**
 * Extract the current branch from `git status -b` porcelain output (the
 * first `## <branch>[...tracking]` record). Detached HEAD reads as null.
 * @param {string|null} out - raw git stdout (utf8) or null.
 * @returns {string|null} the branch name, or null when detached/unknown.
 */
export function parseGitBranch(out) {
  if (typeof out !== 'string') return null
  for (const record of out.split('\0')) {
    if (!record.startsWith('## ')) continue
    const head = record.slice(3)
    if (head.startsWith('HEAD (no branch')) return null
    const branch = head.split('...')[0].trim()
    return branch === '' ? null : branch
  }
  return null
}

/**
 * Normalize one `git diff --numstat` path column. Renames render either as
 * `old => new` (top level) or `dir/{old => new}/rest` (brace form); every
 * other form passes through untouched.
 * @param {string} p - the raw path column (may contain tabs if a filename does).
 * @returns the post-rename path.
 */
function normalizeNumstatPath(p) {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(p)
  if (brace) return brace[1] + brace[3] + brace[4]
  const arrow = /^(.*) => (.*)$/.exec(p)
  if (arrow) return arrow[2]
  return p
}

/**
 * Parse `git diff --numstat` output into a per-path added/removed map.
 * Binary rows (`-\t-\t...`) count zero, matching git's own "no line delta".
 * @param {string|null} out - raw git stdout (utf8) or null.
 * @returns {Map<string, { added: number, removed: number }>}.
 */
export function parseGitNumstat(out) {
  const map = new Map()
  if (typeof out !== 'string' || out === '') return map
  for (const line of out.split('\n')) {
    if (line === '') continue
    const tabs = line.split('\t')
    if (tabs.length < 3) continue
    const added = parseInt(tabs[0], 10) || 0
    const removed = parseInt(tabs[1], 10) || 0
    const path = normalizeNumstatPath(tabs.slice(2).join('\t'))
    const prev = map.get(path) || { added: 0, removed: 0 }
    map.set(path, { added: prev.added + added, removed: prev.removed + removed })
  }
  return map
}

/**
 * Combine the status list and numstat map into the dock's file-change
 * payload. Totals come from numstat (exact, includes rename halves); the
 * per-file rows join on the normalized path, and every entry not in the diff
 * (untracked, staged-only adds) reports zero lines unless `countLines` fills
 * one in — the host passes a real line counter for untracked text files.
 * Each row also carries a reveal target for the dock's click-to-locate: the
 * absolute file path when it exists on disk, else its containing directory
 * (deleted files), so the explorer always has something to select.
 * @param {string|null} statusOut - `git status -b --porcelain=v1 -z` stdout, or null.
 * @param {string|null} numstatOut - `git diff --numstat HEAD` stdout, or null.
 * @param {(path: string) => number|null|undefined} [countLines] - optional (path) => positive line count | null for
 *   untracked entries.
 * @param {(relPath: string) => { absPath?: string, absDir?: string }} [resolvePath] - optional (relPath) => absolute anchor: { absPath,
 *   absDir } for the click-to-reveal affordance.
 * @returns {{ files: number, added: number, removed: number, branch: string|null,
 *   changed: Array<{ path: string, status: string, added?: number, removed?: number, absPath?: string, absDir?: string }>, error: string|null }} — `error` is null on this path, which
 *   only runs when git produced output.
 */
export function gitFileStats(statusOut, numstatOut, countLines, resolvePath) {
  /** @type {Array<{ path: string, status: string, added?: number, removed?: number, absPath?: string, absDir?: string }>} */
  const changed = parseGitStatusZ(statusOut)
  const numstat = parseGitNumstat(numstatOut)
  let added = 0
  let removed = 0
  for (const entry of numstat.values()) {
    added += entry.added
    removed += entry.removed
  }
  for (const item of changed) {
    const n = numstat.get(item.path)
    if (n !== undefined) {
      item.added = n.added
      item.removed = n.removed
    } else if (item.status === '?' && typeof countLines === 'function') {
      const lines = countLines(item.path)
      const counted = typeof lines === 'number' && lines > 0 ? lines : 0
      item.added = counted
      item.removed = 0
      added += counted
    } else {
      item.added = 0
      item.removed = 0
    }
    if (typeof resolvePath === 'function') {
      const anchor = resolvePath(item.path)
      if (anchor !== undefined && anchor !== null) {
        if (typeof anchor.absPath === 'string') item.absPath = anchor.absPath
        if (typeof anchor.absDir === 'string') item.absDir = anchor.absDir
      }
    }
  }
  // `error: null` on the success path keeps the payload's shape uniform, so a
  // consumer can test one field instead of "is this the failure variant?".
  return { files: changed.length, added, removed, branch: parseGitBranch(statusOut), changed, error: null }
}

/**
 * Line-count one untracked file the way the diff card counts text lines:
 * cap the size, treat NUL bytes as binary (no count), and apply the same
 * trailing-newline terminator rule.
 * @param {string} cwd - workspace root.
 * @param {string} relPath - path relative to the workspace root.
 */
function countUntrackedLines(cwd, relPath) {
  try {
    const full = join(cwd, relPath)
    const st = statSync(full)
    if (!st.isFile() || st.size > GIT_UNTRACKED_MAX_BYTES) return null
    const text = readFileSync(full, 'utf8')
    if (text.includes('\u0000')) return null
    const body = text.endsWith('\n') ? text.slice(0, -1) : text
    return body === '' ? 0 : body.split('\n').length
  } catch (error) {
    return null
  }
}

/* ========================================================================== */
/*                            Session Admin Logic                             */
/* ========================================================================== */

/**
 * Encode one path segment the way @deepseek-ai/dsh-session-persistence-jsonl
 * does (format.ts encodeSegment): safe characters `[A-Za-z0-9._-]` pass
 * verbatim, `.`/`..` and every other UTF-16 code unit become `~XXXX` (uppercase
 * 4-hex). Pure and injective — safe to mirror here so the plugin can derive a
 * session's physical log directory without importing backend internals.
 * @param {any} raw - the raw segment (a session id).
 * @returns the encoded filesystem-safe segment.
 */
export function encodeSegmentOf(raw) {
  if (typeof raw !== 'string' || raw === '') throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + raw.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/**
 * Encode one project cwd the way the JSONL backend's projectKey does:
 * separator runs (`/`, `\`, `:`) collapse to one `-`, safe characters pass,
 * other code units become `~XXXX` escapes; leading dashes strip, an empty
 * slug reads as 'root', and the whole slug is bounded and wrapped `--…--`.
 * @param {any} cwd - the session header's cwd.
 * @returns the project directory name under the sessions root.
 */
export function projectKeyOf(cwd) {
  if (typeof cwd !== 'string' || cwd === '') throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const ch = cwd[i]
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + cwd.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * Derive the physical session-log directory for one stored header, following
 * the JSONL backend's layout: `<root>/sessions/<projectKey(cwd)>/<encodeSegment(id)>`,
 * with a cwd-less header landing under the backend's `_no-cwd` project
 * directory (`format.ts` projectDir: `cwd === undefined` → `_no-cwd`),
 * root = $DSH_HOME or ~/.dsh — the stock composition wires
 * `root: dshHomePath('sessions')`. dsh's persistence seam has no public
 * delete or path API, so the log-dir removal derives the layout; the caller
 * fail-louds when the derivation misses a backend that reports durable bytes.
 * @param {any} header - the stored session header ({ id, cwd? }).
 * @returns the absolute session directory, or undefined when the header
 *   carries no usable id.
 */
export function sessionLogDirFor(header) {
  if (header === null || typeof header !== 'object') return undefined
  if (typeof header.id !== 'string' || header.id === '') return undefined
  try {
    const project = typeof header.cwd === 'string' && header.cwd !== ''
      ? projectKeyOf(header.cwd)
      : '_no-cwd'
    return join(dshHome(), 'sessions', project, encodeSegmentOf(header.id))
  } catch {
    return undefined
  }
}

/**
 * Read the optional workspace registry. `@deepseek-ai/dsh-workspace` is a
 * web-app-only row, so CLI / headless / sdk profiles legitimately have no
 * registry; this plugin still mounts there (project `.agents` commands and
 * hooks, plugin/MCP/session administration) and the registry-backed surfaces
 * report "unavailable" instead of failing the mount.
 * @param {Record<string, any>} ctx - plugin context.
 * @returns the live registry, or null when this deployment has none.
 */
export function workspaceRegistryOf(ctx) {
  try {
    const registry = ctx.get('workspaceRegistry')
    return registry !== null && registry !== undefined && typeof registry.list === 'function'
      ? registry
      : null
  } catch {
    return null
  }
}

/**
 * Remove one session id from the registry's archived set through the
 * registry's own serialized write chain (`WorkspaceRegistry.unarchiveSession`
 * — the public verb; an id that is not archived resolves without writing, so
 * no pre-check is needed here).
 * @param {Record<string, any>} ctx - plugin context carrying workspaceRegistry.
 * @param {string} sessionId - session to unarchive.
 */
async function removeFromArchivedSet(ctx, sessionId) {
 const registry = workspaceRegistryOf(ctx)
 if (registry === null) return
 // Older dsh releases (e.g. 0.1.5-rc.2) ship WorkspaceRegistry without the
 // public unarchive verb. The archived-set entry then cannot be cleared
 // through the registry's own write chain — and must not be poked through
 // the TypeScript-private requireState/setState. Skip the cleanup: the
 // stale id is invisible (list() only surfaces persisted sessions) and the
 // delete itself must not fail over a registry flag.
 if (typeof registry.unarchiveSession !== 'function') return
 await registry.unarchiveSession(sessionId)
}

/**
 * Whether a session id still occupies a live registry.
 *
 * BOTH registries must be consulted, because dsh itself does:
 * `agent-loop/src/index.ts` gates its drain wait on
 * `agents.get(id) === undefined && sessions.get(id) === undefined`. Checking
 * `sessions` alone is not a liveness test: `resume()` takes the write lease
 * (`persistence.open(id,'write')`) and prepares BEFORE `setupAndPublish`
 * inserts into the session store, so there is a real window where a session
 * holds a write handle and the in-directory `session.lock` lease while
 * `sessions.get(id)` is still undefined. Deleting in that window removes a
 * live writer's log directory — which also destroys the lease file (POSIX
 * flock is per-inode, so exclusion is forfeited and a second writer can
 * acquire a fresh lock over the same path) and the lease's `mkdir` then
 * recreates the directory empty, i.e. exactly the resurrect-on-flush
 * corruption the removal guard exists to prevent.
 * @param {Record<string, any>} ctx - plugin context.
 * @param {string} sessionId - candidate id.
 * @returns whether the session is live (an agent, a session, or both).
 */
function sessionIsLive(ctx, sessionId) {
  for (const serviceKey of ['agents', 'sessions']) {
    const registry = ctx.get(serviceKey)
    if (registry !== undefined && typeof registry.get === 'function' && registry.get(sessionId) !== undefined) {
      return true
    }
  }
  return false
}

/**
 * Whether a persistence write-open failure means another writer holds the
 * session's write lease. dsh signals this with `SessionAlreadyOwnedError`;
 * the plugin rides the live host without importing it, so the class is
 * detected duck-typed (name, with the message as the older-host fallback).
 * @param {any} error - the failure from `sessionPersistence.open(id, 'write')`.
 * @returns whether the failure is a lease-contention refusal.
 */
function isSessionLeaseContention(error) {
  if (error === null || typeof error !== 'object') return false
  if (error.name === 'SessionAlreadyOwnedError') return true
  return typeof error.message === 'string' && error.message.includes('is already owned')
}

/**
 * Whether a persistence write-open failure means the stored log is gone
 * (`SessionPersistenceNotFoundError`): the artifact vanished between the
 * `stat` above and the lease open — another deleter (possibly another dsh
 * instance) won the race, and the rm below then no-ops on the absent
 * directory.
 * @param {any} error - the failure from `sessionPersistence.open(id, 'write')`.
 * @returns whether the failure is "no stored log for this id".
 */
function isSessionLogGone(error) {
  if (error === null || typeof error !== 'object') return false
  if (error.name === 'SessionPersistenceNotFoundError') return true
  return typeof error.message === 'string' && /not found|does not exist/i.test(error.message)
}

/** Delay between write-lease retries on the just-disposed path. */
const SESSION_LEASE_RETRY_DELAY_MS = 100
/** Retry budget on the just-disposed path (~1s of lease-handoff slack). */
const SESSION_LEASE_RETRY_ATTEMPTS = 10

/**
 * Take the session's cross-process write lease through the persistence seam's
 * own `open(id, 'write')` — the same kernel arbiter dsh's `resume()` uses
 * (a POSIX flock on `<dir>/session.lock`, a Win32 named semaphore). The lease
 * FILE is never removed by dsh and on Windows does not exist at all, so its
 * presence proves nothing; contending for the lock is the only portable
 * liveness probe.
 *
 * Holding the lease makes the delete safe against the one window the
 * in-process registries cannot see: a `resume()` in THIS process that holds
 * the lease but has not yet published into `sessions`, and any writer in a
 * SECOND dsh instance sharing this `$DSH_HOME` (the registries are
 * per-process; the kernel lock is the only shared arbiter). While this call
 * holds the lease, every other writer's open fails — the rm cannot race an
 * append, and the resurrect-on-flush corruption the removal guard exists to
 * prevent cannot start from another process either.
 *
 * Contention refuses the delete, naming the likely owner. The closeSession→
 * delete path retries briefly first: dsh's own teardown releases the disposed
 * session's writer fire-and-forget (`session/disposed` → `writer.close()`),
 * so a JUST-disposed session can still hold the lease for a few turns without
 * being live. A log-not-found open proceeds WITHOUT the lease (see
 * {@link isSessionLogGone}); any other open failure warns and proceeds
 * unguarded, preserving the pre-lease behavior for shapes this guard does not
 * model.
 * @param {Record<string, any>} ctx - plugin context carrying sessionPersistence.
 * @param {string} sessionId - the session about to be deleted.
 * @param {boolean} disposedLive - whether THIS call just disposed a live session.
 * @returns {Promise<any>} the open write handle to close after the rm, or
 *   `null` when the caller proceeds without the cross-process guard.
 * @throws {Error} when a writer still holds the lease after the retry budget.
 */
async function acquireDeleteWriteLease(ctx, sessionId, disposedLive) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ctx.sessionPersistence.open(sessionId, 'write')
    } catch (error) {
      if (isSessionLeaseContention(error)) {
        if (!disposedLive) {
          throw new Error(`session-admin: refusing to delete session '${sessionId}' — a writer still holds its write lease (possibly another dsh instance sharing this DSH_HOME); close it there first, then retry the delete`)
        }
        if (attempt < SESSION_LEASE_RETRY_ATTEMPTS - 1) {
          await new Promise((resolve) => { setTimeout(resolve, SESSION_LEASE_RETRY_DELAY_MS) })
          continue
        }
        throw new Error(`session-admin: refusing to delete session '${sessionId}' — its write lease outlived this call's own dispose by ${String(SESSION_LEASE_RETRY_ATTEMPTS * SESSION_LEASE_RETRY_DELAY_MS)}ms of retries; retry the delete`)
      }
      if (isSessionLogGone(error)) return null
      ctx.logger?.warn?.(`session-admin: could not take the write lease for session '${sessionId}' before deleting it (${messageOf(error)}) — proceeding without the cross-process guard`)
      return null
    }
  }
}

/**
 * Whether a message source marks a compaction checkpoint (not a user turn).
 * dsh 0.1.7 gave compaction the producer-owned `compact-checkpoint` kind
 * (its `isCompactCheckpointSource`); logs written by older hosts carry the
 * retired generic wrapper {kind:'plugin', plugin:'compact'}. The usage
 * accumulator and the derive-session-summary fold must exclude BOTH.
 * @param {any} source - the message's `source` value (any shape).
 * @returns whether the message is a compaction checkpoint.
 */
export function isCompactionCheckpointSource(source) {
  if (source === null || typeof source !== 'object') return false
  if (source.kind === 'compact-checkpoint') return true
  return source.kind === 'plugin' && source.plugin === 'compact'
}

/**
 * Refuse to `rm -rf` anything that is not a real directory inside the sessions
 * root.
 *
 * The session log directory is DERIVED (the persistence seam has no delete or
 * path API), so the one thing this module must not do is hand a recursive delete
 * a path it did not verify. Two failure shapes, both reachable on a hand-edited
 * or hostile deployment: the derived path — or a component of it, such as
 * `$DSH_HOME/sessions` itself or the project-key directory — is a symlink or
 * junction pointing elsewhere, and a recursive delete follows or unlinks through
 * it; or the derivation lands outside the root entirely. So: `lstat` the
 * directory itself (the platform rule is link-shaped paths get lstat + unlink,
 * recursive rm only for known real directories), and confirm the REAL path still
 * lives under the sessions root.
 * @param {string} targetDir - the derived session directory about to be removed.
 * @throws {Error} when the directory is a link, is not a directory, or resolves
 *   outside the sessions root.
 */
function assertRemovableSessionDir(targetDir) {
  let info
  try {
    info = lstatSync(targetDir)
  } catch (error) {
    throw new Error(`session-admin: cannot inspect ${targetDir} before deleting it: ${messageOf(error)}`)
  }
  if (info.isSymbolicLink()) {
    throw new Error(`session-admin: refusing to delete ${targetDir} — it is a symlink/junction, and a recursive delete would act on its target`)
  }
  if (!info.isDirectory()) {
    throw new Error(`session-admin: refusing to delete ${targetDir} — it is not a directory`)
  }
  const root = join(dshHome(), 'sessions')
  const realRoot = realpathIfExists(root)
  const realTarget = realpathIfExists(targetDir)
  if (realRoot === null || realTarget === null) {
    throw new Error(`session-admin: cannot resolve ${targetDir} (or the sessions root) before deleting it`)
  }
  if (!isInsidePath(realTarget, realRoot)) {
    throw new Error(`session-admin: refusing to delete ${realTarget} — it resolves outside the sessions root ${realRoot}`)
  }
  // The leaf check above is not sufficient: `sessions/<projectKey>` (or the
  // sessions root itself) being a link makes the recursion descend through it,
  // so the LEAF can resolve inside the root while pointing at a DIFFERENT
  // session's directory. Re-walk every component between the root and the leaf
  // and require each to be a real directory, not a link.
  assertNoLinkComponents(root, targetDir)
}

/**
 * Require every path component strictly below `root` and up to and including
 * `leaf` to be a real directory rather than a symlink/junction.
 *
 * A junction at the project-key level is what makes a leaf-only realpath check
 * unsound: `sessions/<key>` could point at a sibling project directory, so the
 * leaf realpaths inside the root while the recursive delete acts on another
 * session's log. Walking the components is what makes the containment claim
 * hold for every component the delete will actually traverse.
 * @param {string} root - the sessions root (not inspected; it is the boundary).
 * @param {string} leaf - the derived session directory (already lstat'ed).
 * @throws {Error} when a component below the root is missing or link-shaped.
 */
function assertNoLinkComponents(root, leaf) {
  const relative = relativeTo(root, leaf)
  if (relative === null || relative === '') return
  const parts = relative.split(/[/\\]+/).filter((part) => part !== '')
  let current = root
  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i])
    let component
    try {
      component = lstatSync(current)
    } catch (error) {
      throw new Error(`session-admin: cannot inspect ${current} on the way to ${leaf}: ${messageOf(error)}`)
    }
    if (component.isSymbolicLink()) {
      throw new Error(`session-admin: refusing to delete ${leaf} — the path component ${current} is a symlink/junction, so a recursive delete would act on its target`)
    }
    if (i < parts.length - 1 && !component.isDirectory()) {
      throw new Error(`session-admin: refusing to delete ${leaf} — the path component ${current} is not a directory`)
    }
  }
}

/**
 * `leaf` relative to `root` when it is inside it, else null. String-level on
 * purpose: the caller has already compared realpaths, and this only needs the
 * component list to re-walk.
 * @param {string} root - the ancestor directory.
 * @param {string} leaf - the descendant path.
 * @returns {string|null}
 */
function relativeTo(root, leaf) {
  const fold = (/** @type {string} */ value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  const outer = fold(root)
  const inner = fold(leaf)
  if (inner === outer) return ''
  const prefix = outer.endsWith(sep) ? outer : outer + sep
  if (!inner.startsWith(prefix)) return null
  return leaf.slice(prefix.length)
}

/**
 * Mount the sessionAdmin remote service.
 * @param {Record<string, any>} ctx - plugin context.
 * @param {{ audit: ReturnType<typeof import('./audit-log.js').createAuditLog>, handleCapture: { get(id: string): any, delete(id: string): void }, usageLedger: any, usage: { drainObservedUsage: () => Promise<void>, observedIds: () => Set<string>, snapshotIntervalMs: number }, cfg: Record<string, any> }} deps
 *   - audit: the privileged-action audit trail.
 *   - handleCapture: the AgentHandle capture map (online-session teardown).
 *   - usageLedger: the durable usage ledger (delete-before-snapshot + dashboard read-through).
 *   - usage: the live-event observer hooks owned by index.js's apply().
 *   - cfg: the resolved plugin config row (session/git budgets).
 *
 * This module deliberately does NOT take the shared serial queue: the ledger
 * writes inside a delete already enqueue on it, so serializing the delete with
 * that same queue would deadlock (see {@link makeOperationMutex}).
 * @returns the mounted session service (index.js's usage sweep calls .list()).
 */
export function applySessionAdmin(ctx, { audit, handleCapture, usageLedger, usage, cfg }) {
  // Destructive session operations (delete/close) are serialized against EACH
  // OTHER by a dedicated mutex, NOT by the shared patch/JSON queue.
  //
  // They must not ride `enqueue`: the sequence inside one of them calls
  // `usageLedger.upsert()`, which enqueues on that very queue, and a queue
  // re-entered from inside its own slot never runs — the outer operation would
  // wait forever on work that can only start after it finishes (verified: a
  // nested `serial()` deadlocks by construction).
  //
  // A separate mutex gives the property that actually matters here — two
  // concurrent deletes, or a delete racing a close, run one at a time with
  // their liveness/containment checks adjacent to the delete — while leaving
  // the ledger's own writes on the shared queue where they belong.
  const serial = makeOperationMutex()

  /**
   * Log directories THIS process has already removed, keyed by the derived
   * path. Deleting an already-deleted session is idempotent — the desired end
   * state is reached — but the same "no directory at the derived path" reading
   * also describes genuine layout drift (a SQLite backend, a moved DSH_HOME),
   * which must stay a loud failure. Recording what we removed is what tells the
   * two apart instead of guessing from the filesystem.
   * @type {Set<string>}
   */
  const removedLogDirs = new Set()

  /**
   * Whether an earlier call in this process removed this derived directory.
   * Bounded by the same LRU discipline as the other caches: a long-lived host
   * should not accumulate one entry per session ever deleted.
   * @param {string} targetDir - the derived session log directory.
   * @returns {boolean}
   */
  function directoryWasRemovedByUs(targetDir) {
    return removedLogDirs.has(targetDir)
  }
  // The git budgets' module-scope readers (runGitOutcome's defaults) would keep the
  // old value if shadowed with closure consts — assign, the same contract
  // index.js's apply() had.
  GIT_TIMEOUT_MS = cfg.gitTimeoutMs
  GIT_DIFF_MAX_CHARS = cfg.gitDiffMaxChars
  const SESSION_SUMMARY_CACHE_TTL_MS = cfg.sessionSummaryCacheTtlMs
  const SESSION_LIST_CONCURRENCY = cfg.sessionListConcurrency
  const SESSION_EVENT_SCAN_CAP = cfg.sessionEventScanCap
  const SESSION_SEARCH_LIMIT = cfg.sessionSearchLimit
  // Whole-log reads (export / health fold) stop at this many events so a
  // pathological session cannot balloon host memory; the payload flags the
  // truncation instead of hiding it.
  const SESSION_EXPORT_EVENT_CAP = cfg.sessionExportEventCap
  const GIT_STATS_CACHE_TTL_MS = cfg.gitStatsCacheTtlMs
  const USAGE_SNAPSHOT_INTERVAL_MS = usage.snapshotIntervalMs
  const drainObservedUsage = usage.drainObservedUsage
  const observedIds = usage.observedIds

  /** @param {string} path */
  function sessionBaseName(path) {
    if (!path) return ''
    const parts = path.replace(/\\/g, '/').split('/')
    const last = parts[parts.length - 1]
    return last === '' ? (parts[parts.length - 2] || path) : last
  }

  /**
   * Extract { title, summary, messageCount } from a session's events. The
   * scan is capped at SESSION_EVENT_SCAN_CAP events so a pathological log
   * cannot monopolize the host loop; the message count may undercount past
   * the cap, which is an acceptable trade for the panel.
   * @param {any[]} events - session events (live or persisted).
   * @returns derived title, summary, and message count.
   */
  function deriveSessionSummary(events) {
    let title = ''
    let summary = ''
    let messageCount = 0
    let assistantCount = 0
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    if (!events || events.length === 0) return { title, summary, messageCount, assistantCount, tokens }
    const cap = Math.min(events.length, SESSION_EVENT_SCAN_CAP)
    for (let i = 0; i < cap; i++) {
      const ev = events[i]
      if (ev.type === 'session/title' && ev.data && typeof ev.data.title === 'string' && ev.data.title.trim()) {
        title = ev.data.title.trim()
      }
      if (ev.type === 'user/message') {
        // Skip compaction checkpoints: a checkpoint REPLACES shadowed history
        // instead of adding a user turn, so counting it inflates messageCount
        // for compacted sessions. dsh 0.1.7 writes the producer-owned
        // `compact-checkpoint` kind; older hosts wrote the retired generic
        // wrapper {kind:'plugin', plugin:'compact'} — exclude both.
        const source = ev.data?.source
        if (isCompactionCheckpointSource(source)) continue
        messageCount++
        if (!summary) {
          const content = ev.data?.content
          if (Array.isArray(content)) {
            summary = content
              .filter(b => b && b.type === 'text' && typeof b.text === 'string')
              .map(b => b.text.trim())
              .filter(Boolean)
              .join(' ')
          } else if (typeof ev.data?.text === 'string') {
            summary = ev.data.text.trim()
          }
        }
      }
      if (ev.type === 'assistant/message') {
        assistantCount++
        // ccusage-style token accounting: every assistant message carries
        // the adapter-reported usage, so folding the log yields totals.
        const usage = ev.data?.usage
        if (usage && typeof usage === 'object') {
          tokens.input += Number(usage.inputTokens) || 0
          tokens.output += Number(usage.outputTokens) || 0
          tokens.cacheRead += Number(usage.cacheReadTokens) || 0
          tokens.cacheWrite += Number(usage.cacheWriteTokens) || 0
        }
      }
    }
    // Derive a fallback title from the first line of the summary when no
    // explicit session/title event exists.
    if (!title && summary) {
      const firstLine = summary.split('\n')[0].trim()
      title = firstLine.length > 45 ? firstLine.slice(0, 45) + '...' : firstLine
    }
    return { title, summary, messageCount, assistantCount, tokens }
  }

  /**
   * The projection-cache checkpoint title for a stored header, or null when
   * the cache cannot serve one. Shared by every display-title consumer
   * (list, searchSessions, exportSession). Core signature is
   * cachedSnapshot(meta, keys?) since dsh 0.1.7 — the earlier
   * inheritedEventCount cut parameter was REMOVED (passing `0` today would
   * bind to the keys filter and misbehave), and a persisted listing wants the
   * whole block, so the call passes no second argument at all.
   * @param {any} header - the stored session header.
   * @returns the cached display title, or null.
   */
  function projectionTitleOf(header) {
    try {
      const projCache = ctx.get ? ctx.get('sessionProjectionCache') : undefined
      if (projCache === undefined || typeof projCache.cachedSnapshot !== 'function') return null
      const snap = projCache.cachedSnapshot(header)
      return snap && snap.values && typeof snap.values.title === 'string' && snap.values.title !== ''
        ? snap.values.title
        : null
    } catch {
      // A projection-cache miss or shape drift degrades to the callers'
      // fallback chains (cwd basename / log title), never a thrown RPC.
      return null
    }
  }

  /**
   * Read a bounded event prefix through the official read seam (`open(id,
   * 'read')` handle + `read(0, cap)` + close) — the only whole-log reader.
   * Session exposes no public event property (its synchronous readers are
   * deprecated — dsh note 2026-09-09), so the former live-memory fast path
   * never fired and is gone; the trade is that an online session's unflushed
   * tail appears in exports and health reports only after the backend flushes.
   * Every consumer passes a cap (summary scan, export, health fold) so a
   * pathological log cannot balloon host memory.
   * @param {string} sessionId - the session to read.
   * @param {number} cap - maximum events to return.
   * @returns the event array (possibly empty).
   */
  async function sessionEventsBoundedFor(sessionId, cap) {
    let handle
    try {
      handle = await ctx.sessionPersistence.open(sessionId, 'read')
      const events = readEventsOf(await handle.read(0, cap))
      // A successful read clears any stale failure entry — a transient error
      // (log locked mid-flush) must not outlive the recovery.
      sessionReadErrors.delete(sessionId)
      return events
    } catch (error) {
      sessionReadErrors.set(sessionId, error instanceof Error && error.message ? error.message : messageOf(error))
      // Bounded like the neighbouring caches: entries only clear on a later
      // successful read (or the session's deletion), so a session whose log
      // stays broken must not hold the map open forever.
      if (sessionReadErrors.size > SESSION_READ_ERRORS_CAP) {
        const oldest = sessionReadErrors.keys().next()
        if (!oldest.done) sessionReadErrors.delete(oldest.value)
      }
      return []
    } finally {
      if (handle !== undefined) {
        try { await handle.close() } catch { /* already closed */ }
      }
    }
  }

  /**
   * Remove a session's durable artifacts: log directory, workspace
   * accounting, projection-cache record, archived-set entry, and the
   * derived-summary cache. Shared by deleteSession (non-live sessions) and
   * closeSession (after an online session has been torn down).
   *
   * The live-guard is re-evaluated immediately before the rm rather than once
   * at entry: a session must not lose its log while it is (or just became)
   * live, because the in-memory session would resurrect the file on the next
   * flush — and the `stat` that precedes this is an await point, so a resume
   * during it would not be seen by an earlier check.
   *
   * `disposedLive` is the ONE exemption, and it is provenance, not a bypass:
   * closeSession disposed the session itself through dsh's official teardown,
   * which is what removes it from both registries. A deployment whose store
   * still reports it (or whose dispose left the marker) must not turn a
   * successful close into a refusal — and the exemption cannot be reached by
   * deleteSession, which never disposes anything.
   * @param {string} sessionId - the session to remove.
   * @param {boolean} disposedLive - whether THIS call disposed a live session.
   */
  async function removeSessionArtifacts(sessionId, disposedLive = false) {
    // Resolve the accounting workspace BEFORE removing the log: the entity
    // getter projects against the registry's live header index, so after the
    // rm (or any concurrent re-index) the id may stop resolving. detachSession
    // prunes every record member missing from that index, so it must never be
    // fired at unrelated workspaces — one stale index entry would strip their
    // whole durable session list (sessions then fall into ungrouped). A
    // deployment without the registry has no accounting to detach.
    const accountingRegistry = workspaceRegistryOf(ctx)
    const accounting = accountingRegistry === null
      ? undefined
      : accountingRegistry.list().find((/** @type {any} */ workspace) => workspace.sessionIds.includes(sessionId))
    // 1. Remove durable log artifacts. The persistence seam has no public
    // delete or path API, so the log directory is derived from the stored
    // header via the JSONL backend's physical layout, with a stat cross-check
    // that fail-louds when a materialized session is not where the standard
    // layout says (custom backend root or layout drift) instead of silently
    // leaving orphaned logs on disk. A session whose log never materialized
    // (created but nothing appended/flushed) has no filesystem footprint by
    // design — an absent directory is not an error.
    let header = null
    let materializedBytes = null
    /** @type {string|null} */
    let statError = /** @type {any} */ (null)
    try {
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      if (snapshot !== undefined && snapshot !== null) {
        header = snapshot.header ?? null
        materializedBytes = typeof snapshot.sizeBytes === 'number' ? snapshot.sizeBytes : null
      }
    } catch (error) {
      // A THROWN stat is not the same as an empty one. Resolved-undefined means
      // "the persistence backend holds no such session", which is a legitimate
      // no-op; a thrown error means the backend could not answer, so whether the
      // log exists is UNKNOWN. Swallowing it used to skip the whole removal and
      // then let steps 2-5 run, leaving the caller with `{deleted: id}` while
      // the bytes stayed on disk and the registry entry was already gone — a
      // success reported for an operation that did not happen. Refuse instead:
      // nothing has been touched yet, so the user can retry.
      statError = messageOf(error)
    }
    if (statError !== null) {
      throw new Error(`session-admin: cannot verify session '${sessionId}' before deleting it (persistence stat failed: ${statError}) — nothing was removed; retry, and if the session is broken remove its log directory manually`)
    }
    // Liveness re-check #1, BEFORE the branch: the detach / projection-cache /
    // archive cleanup below runs on EVERY path, not only the rm path — a
    // session that became live during the awaits above and whose log directory
    // is not yet on disk would otherwise skip the late recheck (it sits inside
    // the existsSync branch) and still lose its accounting. The late recheck
    // inside the rm branch stays: it is the one adjacent to the delete (no
    // await between check and rm).
    if (header !== null && !disposedLive && sessionIsLive(ctx, sessionId)) {
      throw new Error(`session '${sessionId}' became live — close it before deleting`)
    }
    // A snapshot WITHOUT a header but WITH durable bytes is the same
    // "bytes somewhere the standard layout cannot name" situation as the
    // layout-drift branch below — the derivation needs the header's cwd, so
    // the loud failure must fire here too, not silently report a delete that
    // left the bytes on disk. (The whole loud-fail branch used to live inside
    // `if (header !== null)`, unreachable for exactly the drifted snapshots
    // that could not produce one.)
    if (header === null && materializedBytes !== null && materializedBytes > 0) {
      throw new Error(`session-admin: session '${sessionId}' reports ${String(materializedBytes)} durable bytes but its snapshot carries no header, so the log directory cannot be located — remove it manually (custom persistence backend?)`)
    }
    if (header !== null) {
      const targetDir = sessionLogDirFor(header)
      if (targetDir !== undefined && existsSync(targetDir)) {
        // Re-take the liveness verdict HERE, immediately before the delete: the
        // `stat` above (and, on the closeSession path, the multi-second usage
        // snapshot that preceded it) is an await point, so a resume or create
        // that started during it would not be seen by an earlier check.
        // `disposedLive` is this call's own dispose, not a bypass — see the
        // JSDoc; deleteSession never sets it.
        if (!disposedLive && sessionIsLive(ctx, sessionId)) {
          throw new Error(`session '${sessionId}' became live — close it before deleting`)
        }
        // Cross-process guard: hold the persistence seam's own write lease
        // across the rm, so a writer this process cannot see — a resume holding
        // the lease before it publishes into `sessions`, or a second dsh
        // instance sharing this DSH_HOME — either blocks this delete or is
        // blocked by it (see acquireDeleteWriteLease). Taken before the
        // containment assert; the assert-to-rm adjacency below is unchanged.
        const leaseHandle = await acquireDeleteWriteLease(ctx, sessionId, disposedLive)
        try {
          // Containment is asserted with NO await between this call and the rm
          // below, so the checked state is the state the delete acts on. Both
          // steps are synchronous, which is what makes the pair atomic from the
          // event loop's point of view: nothing else can run in between to swap a
          // component for a junction.
          assertRemovableSessionDir(targetDir)
          // Idempotence: a second delete of the same id (a double-clicked row, a
          // panel retry, or the loser of the serialized pair) finds the directory
          // already gone. That is the DESIRED end state, not a failure — and it
          // must not be confused with the layout-drift case below, which is a
          // session whose bytes are somewhere the derived path never named.
          await rm(targetDir, { recursive: true, force: true })
        } finally {
          if (leaseHandle !== null) {
            try { await leaseHandle.close() } catch { /* nothing was appended (a non-live session cannot route events to this handle), and the kernel drops the lock with the descriptor even if close() reports a drain failure */ }
          }
        }
        removedLogDirs.delete(targetDir)
        enforceCacheCap(removedLogDirs, SESSION_CACHE_CAP)
        removedLogDirs.add(targetDir)
      } else if (targetDir !== undefined && directoryWasRemovedByUs(targetDir)) {
        // Already removed by an earlier call in this process: nothing to do.
      } else if (materializedBytes !== null && materializedBytes > 0) {
        throw new Error(`session-admin: session '${sessionId}' reports ${String(materializedBytes)} durable bytes but no log directory exists at the standard layout${targetDir !== undefined ? ` ('${targetDir}')` : ''}; remove it manually (custom persistence root or layout drift?)`)
      }
    }
    // 2. Detach workspace accounting — targeted, never a batch sweep. The log
    // is already gone at this point, so a registry hiccup here must not
    // retell the story: the delete SUCCEEDED, and reporting it as an RPC
    // error made the first response a lie (a retry would self-heal through
    // the idempotent path, but the operator had no reason to retry). Warn
    // with the recovery path instead of failing.
    if (accounting !== undefined) {
      try {
        await accounting.detachSession(sessionId)
      } catch (error) {
        ctx.logger?.warn?.(`session-admin: session '${sessionId}' was deleted, but workspace accounting detach failed (${messageOf(error)}) — the sidebar refresh usually settles it; if the session lingers, retry the delete once`)
      }
    }
    // 3. Drop the session's projection-cache record so client-side session
    // projections (sidebar tree) stop showing the deleted session right
    // away instead of lingering in "未分组" until the next reload. The
    // storage domain is already open by dsh-session-projection-cache.
    try {
      const projDomain = ctx.get ? ctx.get('storageDomain')?.get('session_projcache') : undefined
      if (projDomain !== undefined && typeof projDomain.table === 'function') {
        const sessionsTable = projDomain.table('sessions')
        if (sessionsTable !== undefined && typeof sessionsTable.delete === 'function') {
          await sessionsTable.delete(sessionId)
        }
      }
    } catch (error) {
      // Non-fatal: worst case the sidebar refreshes it away on reload.
    }
    // 4. Clear archived-set entry — same post-completion contract as the
    // detach above: a registry failure here must not report the finished
    // delete as failed.
    try {
      await removeFromArchivedSet(ctx, sessionId)
    } catch (error) {
      ctx.logger?.warn?.(`session-admin: session '${sessionId}' was deleted, but clearing its archived-set entry failed (${messageOf(error)}) — a stale id is invisible to list() and harmless`)
    }
    // 5. Evict the derived-summary cache entry so the map never grows
    // with deleted sessions (and a reused id never serves stale data).
    sessionSummaryCache.delete(sessionId)
    gitStatsCache.delete(sessionId)
    sessionReadErrors.delete(sessionId)
  }

  /**
   * One session's derived summary (message counts, token totals, summary
   * text), cache-aware: a warm entry whose revision has not moved is reused,
   * otherwise the bounded persistence replay folds the log. Shared by list()
   * (every session) and the usage ledger's pre-delete snapshot (one session),
   * so both paths agree on the numbers and share one cache.
   * @param {Record<string, any>} header - the stored session header.
   * @param {string|undefined} revision - the persistence revision token.
   */
  async function derivedSummaryOf(header, revision) {
    const cached = sessionSummaryCache.get(header.id)
    const now = Date.now()
    if (cached !== undefined && !cached.summaryError
      && (revision !== undefined ? cached.revision === revision : now - cached.at <= SESSION_SUMMARY_CACHE_TTL_MS)) {
      return cached
    }
    // Summary rides the persistence replay — Session has no public event
    // property (deprecated readers, dsh note 2026-09-09), so there is no
    // live-memory fast path; an online session's unflushed tail shows up on
    // the refresh after its flush.
    let events = []
    let summaryError = null
    if (ctx.sessionPersistence !== undefined) {
      events = await sessionEventsBoundedFor(header.id, SESSION_EVENT_SCAN_CAP)
      // The bounded read records its failure (missing permission, unreadable
      // log, vanished session) in sessionReadErrors and clears the entry
      // itself when a later read succeeds — a null here always means "the
      // latest read succeeded".
      summaryError = sessionReadErrors.get(header.id) ?? null
    }
    /**
     * The derived summary: either the empty error-shape (unreadable session)
     * or the folded summary from the events. Both shapes share the first five
     * fields; `summaryError` only exists on the error path, and `revision`/`at`
     * are stamped below. Declaring the union is what makes the post-null
     * writes type-check.
     * @type {{
     *   title: string, summary: string, messageCount: number, assistantCount: number,
     *   tokens: { input: number, output: number, cacheRead: number, cacheWrite: number },
     *   summaryError?: string|null, revision?: unknown, at?: number,
     * } | null}
     */
    let derived = /** @type {any} */ (null)
    if (events.length === 0 && summaryError !== null) {
      derived = {
        title: '', summary: '', messageCount: 0, assistantCount: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        summaryError,
      }
    }
    if (derived === null) derived = deriveSessionSummary(events)
    derived.revision = revision ?? null
    derived.at = now
    // Delete-before-set keeps Map insertion order tracking recency, so the
    // cap below evicts the least-recently-used entry (not merely the oldest
    // insertion).
    sessionSummaryCache.delete(header.id)
    enforceCacheCap(sessionSummaryCache, SESSION_CACHE_CAP)
    sessionSummaryCache.set(header.id, derived)
    return derived
  }

  /**
   * Snapshot one session's usage into the ledger BEFORE its log is removed.
   *
   * The dashboard's read is opportunistic (it only learns the sessions it has
   * seen), so a session deleted without the dashboard ever being opened would
   * otherwise lose its numbers with the log. This path folds the same
   * summary the panel shows into the ledger first, which is what makes
   * 「删了会话，用量还在」 hold for every delete this plugin performs.
   *
   * Best-effort by design: a ledger failure must never block the user's
   * delete, so every failure is swallowed — the delete is the intent, the
   * retention is the courtesy.
   * @param {string} sessionId
   */
  async function recordUsageBeforeRemoval(sessionId) {
    try {
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      const header = snapshot?.header
      if (header === null || typeof header !== 'object' || typeof header.id !== 'string') return
      const derived = await derivedSummaryOf(header, snapshot?.revision)
      // 读取失败 = 后端没答上来：derived 是 tokens/messageCount 全 0 的错误
      // 形状。把它写进台账会用零**永久覆盖**既有真实数字（快照之后日志即被
      // 删，再无恢复来源），所以整条快照跳过——删除照常进行，台账保留它已
      // 有的数字（背景快照/实时观察者早先写下的那份）。
      if (derived.summaryError) return
      const registry = workspaceRegistryOf(ctx)
      const workspace = registry === null
        ? undefined
        : registry.list().find((/** @type {any} */ ws) => ws.sessionIds.includes(sessionId))
      await usageLedger.upsert([{
        id: header.id,
        title: projectionTitleOf(header) || derived.title || (header.cwd ? sessionBaseName(header.cwd) : '未命名会话'),
        createdAt: header.createdAt,
        cwd: header.cwd ?? null,
        workspaceTitle: workspace?.title ?? null,
        tokens: derived.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        messageCount: derived.messageCount,
        assistantCount: derived.assistantCount ?? 0,
      }], { protect: observedIds() })
    } catch {
      /* retention is best-effort; the delete proceeds regardless */
    }
  }

  /**
   * The unserialized body of deleteSession. Runs inside one queue slot via the
   * service method's wrapper, so its check → snapshot → rm sequence is atomic
   * with respect to the other destructive operations.
   * @param {unknown} sessionId - the session to delete.
   */
  async function deleteSessionInner(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new Error('session-admin: deleteSession requires a sessionId string')
    }
    if (sessionIsLive(ctx, sessionId)) {
      throw new Error(`session '${sessionId}' is live — close it before deleting`)
    }
    // The ledger snapshot must happen while the log still exists.
    await recordUsageBeforeRemoval(sessionId)
    await removeSessionArtifacts(sessionId)
    return { deleted: sessionId }
  }

  /**
   * The unserialized body of closeSession: dispose the captured live agent,
   * then remove the artifacts. Serialized as a whole, so a concurrent delete
   * cannot slip in between the dispose and the rm.
   * @param {unknown} sessionId - the session to close and delete.
   */
  async function closeSessionInner(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new Error('session-admin: closeSession requires a sessionId string')
    }
    let wasLive = false
    if (sessionIsLive(ctx, sessionId)) {
      const handle = handleCapture.get(sessionId)
      if (handle === undefined) {
        throw new Error(`session '${sessionId}' is live but its agent handle was not captured (created before this plugin mounted?) — restart dsh, then delete`)
      }
      // Snapshot BEFORE the dispose: tearing the live agent down is what
      // releases the log, and the ledger's job is to outlive it.
      await recordUsageBeforeRemoval(sessionId)
      try {
        await handle.dispose()
      } finally {
        // Drop the captured handle even when dispose throws: a stale entry
        // would otherwise be disposed a second time by a retry, and the
        // failure below still lets the caller see what happened.
        handleCapture.delete(sessionId)
      }
      wasLive = true
    } else {
      await recordUsageBeforeRemoval(sessionId)
    }
    // `wasLive` records that THIS call disposed a live session, which is the
    // only thing that may exempt the re-checked live-guard: the dispose above
    // is dsh's official teardown, so the store releasing the id is a
    // consequence of this call rather than a race against it.
    try {
      await removeSessionArtifacts(sessionId, wasLive)
    } catch (error) {
      if (!wasLive) throw error
      // The dispose is IRREVERSIBLE and already done — the failure below (e.g.
      // the pre-delete stat could not re-verify the session) only means the log
      // directory is still there. Say so: the old message implied nothing had
      // happened, and an operator reading "nothing was removed" would not know
      // the live session is already gone and only a retry of the cleanup is
      // pending (retrying the RPC is safe — the dispose path is skipped once
      // the session is no longer live).
      throw new Error(`session-admin: session '${sessionId}' was CLOSED (live teardown done, irreversible) but its log cleanup failed: ${error instanceof Error ? error.message : messageOf(error)} — retry the delete to finish removing the log directory`)
    }
    return { deleted: sessionId, ...(wasLive ? { closed: true } : {}) }
  }

  const sessionService = {
    async list() {
      // A deployment without the workspace registry (CLI / headless) has no
      // sidebar grouping: every session simply lands in the ungrouped bucket.
      const registry = workspaceRegistryOf(ctx)
      const archivedIds = registry === null ? [] : registry.archivedSessionIds
      const workspaces = registry === null ? [] : registry.list()
      // Mirror the sidebar's grouping: every session's accounting workspace
      // comes from the registry's filtered sessionIds projection, so the
      // admin view and the sidebar never disagree about membership. The host
      // Workspace entity exposes its id as `id` (WorkspaceView's
      // `workspaceId` is the wire-side rename done by apiproxy) — map it
      // explicitly to keep the boundary JSON-safe (undefined values trip
      // typert's assertJsonValue).
      const sessionToWorkspace = new Map()
      for (const ws of workspaces) {
        for (const sid of ws.sessionIds) {
          sessionToWorkspace.set(sid, { workspaceId: ws.id ?? null, title: ws.title ?? null })
        }
      }

      // persistence.list() already returns revision-token snapshots
      // ({ header, revision }) — the same tokens listSnapshots was invented
      // for, so one call feeds both the header list and the revision map.
      const snapshots = await ctx.sessionPersistence.list()
      const headers = []
      const revisionBySession = new Map()
      for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
        const header = snapshot?.header
        if (header === null || typeof header !== 'object' || typeof header.id !== 'string') continue
        headers.push(header)
        if (snapshot?.revision !== undefined) revisionBySession.set(header.id, snapshot.revision)
      }

      const sessions = await mapConcurrent(headers, SESSION_LIST_CONCURRENCY, async (header) => {
        const live = sessionIsLive(ctx, header.id)
        const derived = await derivedSummaryOf(header, revisionBySession.get(header.id))

        // Prefer the projection-cache title (the same displayTitle the
        // sidebar shows) so deleting by title from the sidebar menu matches
        // the same session on the host side. cachedSnapshot works from the
        // stored header — no live session needed — so ended sessions get
        // their real title too instead of a cwd-basename fallback.
        const projTitle = projectionTitleOf(header)

        const ws = sessionToWorkspace.get(header.id)
        return {
          id: header.id,
          cwd: header.cwd ?? null,
          createdAt: header.createdAt,
          parentSession: header.parentSession ?? null,
          archived: archivedIds.includes(header.id),
          live,
          title: projTitle || derived.title || (header.cwd ? sessionBaseName(header.cwd) : '未命名会话'),
          summary: derived.summary ? (derived.summary.length > 180 ? derived.summary.slice(0, 180) + '...' : derived.summary) : '',
          summaryError: derived.summaryError || null,
          messageCount: derived.messageCount,
          assistantCount: derived.assistantCount ?? 0,
          tokens: derived.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          workspaceId: ws?.workspaceId ?? null,
          workspaceTitle: ws?.title ?? null,
        }
      })

      sessions.sort((left, right) => right.createdAt - left.createdAt)
      return {
        sessions,
        workspaces: workspaces.map((/** @type {any} */ ws) => ({
          workspaceId: ws.id ?? null,
          title: ws.title ?? null,
          path: ws.path ?? null,
        })),
      }
    },

    /** @param {unknown} sessionId */
    async archive(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: archive requires a sessionId string')
      }
      const registry = workspaceRegistryOf(ctx)
      if (registry === null) {
        throw new Error('session-admin: 本部署未挂载 dsh-workspace，无法归档会话')
      }
      const snapshots = await ctx.sessionPersistence.list()
      if (!snapshots.some((/** @type {any} */ snapshot) => snapshot?.header?.id === sessionId)) {
        throw new Error(`session-admin: session '${sessionId}' does not exist`)
      }
      await registry.archiveSession(sessionId)
      return { archived: sessionId }
    },

  /** @param {unknown} sessionId */
 async unarchive(sessionId) {
 if (typeof sessionId !== 'string' || sessionId === '') {
 throw new Error('session-admin: unarchive requires a sessionId string')
 }
 // Older dsh releases lack the registry's public unarchive verb; report a
 // clear error instead of silently no-oping (the delete path skips the
 // cleanup, but an explicit 取消归档 gesture must not pretend success).
 const registry = workspaceRegistryOf(ctx)
 if (registry !== null && typeof registry.unarchiveSession !== 'function') {
 throw new Error('session-admin: workspaceRegistry 缺少 unarchiveSession() — 当前 dsh 版本无法取消归档')
 }
 await removeFromArchivedSet(ctx, sessionId)
 return { unarchived: sessionId }
 },

    /**
     * Delete a non-live (ended) session's durable artifacts. Online sessions
     * must use closeSession instead — disposing the live agent first so the
     * log cannot resurrect.
     *
     * Serialized on the shared queue: the liveness check, the usage snapshot
     * and the rm must not interleave with another delete/close for the same id
     * (a double-clicked delete would otherwise have both calls pass every check
     * and both act), nor with a close whose dispose is mid-flight.
     * @param {unknown} sessionId - the session to delete.
     */
    deleteSession(sessionId) {
      return serial(() => deleteSessionInner(sessionId))
    },

    /**
     * Delete an ONLINE session without restarting dsh. If the session is
     * live in the in-memory store, its captured AgentHandle is disposed first
     * — dsh's official teardown chain stops the agent loop, waits for
     * quiescence, unregisters the agent, removes the session from the store
     * (emitting `session/disposed`), and lets the persistence backend flush
     * buffered events and release its write path — so removing the log file
     * afterwards cannot resurrect it. Non-live sessions simply skip the
     * dispose step.
     *
     * The dispose is a real agent shutdown: a running conversation in that
     * session is stopped. Callers must surface this before invoking.
     *
     * @param {unknown} sessionId - the session to close and delete.
     * @returns {Promise<{ deleted: string, closed?: boolean }>} the deleted session id.
     */
    closeSession(sessionId) {
      return serial(() => closeSessionInner(sessionId))
    },

    /**
     * File-change stats for the todo dock footer, folded from the session
     * workspace's LIVE git state: `git status --porcelain=v1 -z` (the file
     * list, untracked included) plus `git diff --numstat HEAD` (the +/- line
     * totals). Untracked text files get their added-line count from a direct
     * line read. A 3s TTL cache collapses the dock's poll cadence.
     *
     * A git failure (not a repo, no git binary, timeout) carries a non-empty
     * `error` with zeroed counts, so the dock hides the segment instead of
     * rendering all-zeroes as a real "nothing changed" reading. A workspace
     * with no cwd returns the same zeroes with `error: null` — there is simply
     * nothing to examine. `missing: true` marks a session the persistence
     * layer no longer knows (deleted mid-poll) — also not a "clean tree".
     * `truncated: true` marks a status/numstat stream that hit the stdout cap:
     * the torn tail record was dropped, so counts may under-report.
     * @param {unknown} sessionId - the session whose workspace cwd is examined.
     * @returns {Promise<{ files: number; added: number; removed: number; branch: string|null; changed: { path: string; status: string; added?: number; removed?: number; absPath?: string; absDir?: string; }[]; error: string|null; missing?: boolean; truncated?: boolean; }>}.
     */
    async fileStats(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: fileStats requires a sessionId string')
      }
      const cached = gitStatsCache.get(sessionId)
      if (cached !== undefined && Date.now() - cached.at <= GIT_STATS_CACHE_TTL_MS) return cached.value
      const value = await this.computeFileStats(sessionId)
      // Delete-before-set refreshes recency, matching the summary cache's
      // LRU-eviction semantics.
      gitStatsCache.delete(sessionId)
      enforceCacheCap(gitStatsCache, GIT_STATS_CACHE_CAP)
      gitStatsCache.set(sessionId, { at: Date.now(), value })
      return value
    },

    /** @param {string} sessionId */
    async computeFileStats(sessionId) {
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      const header = snapshot?.header
      const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
      // The dock polls this for a LIVE session; landing here means the session
      // was deleted (or never existed) mid-poll. Report it as `missing` instead
      // of silent zeros — a poll that cannot see the session must not read as
      // "clean tree" (same honesty rule as the git-failure branch below).
      if (snapshot === undefined || snapshot === null || cwd === '') {
        return { files: 0, added: 0, removed: 0, branch: null, changed: [], error: null, missing: true }
      }
      if (!existsSync(cwd)) {
        return { files: 0, added: 0, removed: 0, branch: null, changed: [], error: null, missing: false }
      }
      const statusOutcome = await runGitOutcome(cwd, ['status', '-b', '--porcelain=v1', '-z', '--untracked-files=all'], GIT_TIMEOUT_MS)
      // "No cwd" and "git could not run" both used to fold to all-zero stats,
      // which reads as "nothing changed". Report the failure separately so the
      // dock can hide the segment instead of asserting a clean tree.
      if (!statusOutcome.ok) return { files: 0, added: 0, removed: 0, branch: null, changed: [], error: 'git status 失败或超时——无法确认工作区状态', missing: false }
      // A stdout cap hit on the -z stream cuts the record list mid-record: the
      // tail NUL field is torn data, and parseGitStatusZ would ingest it as a
      // real path (silently wrong file list AND counts). Drop the final (only
      // possibly-torn) record and flag the payload, like gitDiff's marker.
      const statusText = statusOutcome.truncated
        ? statusOutcome.stdout.slice(0, statusOutcome.stdout.lastIndexOf('\0'))
        : statusOutcome.stdout
      // `-c core.quotePath=false` disables git's quoting of non-ASCII bytes
      // for THIS invocation: `status -z` is already raw, but `diff --numstat`
      // would otherwise emit `"src/中文.md"`-style quoted paths that no longer
      // match status's raw form, breaking per-file joined ±0 for CJK paths.
      // The scope is one git call, so no global config mutation.
      const numstatOutcome = await runGitOutcome(cwd, ['-c', 'core.quotePath=false', 'diff', '--numstat', 'HEAD'], GIT_TIMEOUT_MS)
      // 失败按 runGitOutcome 的 ok:false 折为 null（gitFileStats 按缺数处理）；截断时同样
      // 丢弃最后一行可能被切半的记录。
      const numstatText = !numstatOutcome.ok
        ? null
        : numstatOutcome.truncated
          ? numstatOutcome.stdout.slice(0, numstatOutcome.stdout.lastIndexOf('\n'))
          : numstatOutcome.stdout
      const stats = gitFileStats(
        statusText,
        numstatText,
        (path) => countUntrackedLines(cwd, path),
        // Click-to-reveal anchor: select the file while it exists, otherwise
        // (deletes, some renames) select its containing directory.
        (path) => {
          const absPath = join(cwd, path)
          if (existsSync(absPath)) return { absPath, absDir: dirname(absPath) }
          return { absDir: dirname(absPath) }
        },
      )
      return { ...stats, missing: false, truncated: statusOutcome.truncated || numstatOutcome.truncated }
    },

    /**
     * Readable Markdown transcript for one session. Sessions replay the
     * persistence log (an online session's unflushed tail appears after its
     * flush); the payload carries everything the browser needs to name and
     * save the file. Throws for unknown sessions (the export button is an
     * explicit gesture, unlike the stats poll — a silent empty file would
     * read as data loss). The log replay is capped at
     * SESSION_EXPORT_EVENT_CAP events; hitting the cap marks the payload
     * `truncated` and stamps the file itself, so a partial export never
     * masquerades as complete.
     * @param {unknown} sessionId - the session to render.
     * @returns {Promise<{ markdown: string; filename: string; messages: number; toolCalls: number; truncated: boolean; readError: string|null; }>}.
     */
    async exportSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: exportSession requires a sessionId string')
      }
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      const header = snapshot?.header
      if (header === undefined || header === null) {
        throw new Error(`session-admin: session '${sessionId}' does not exist`)
      }
      const events = await sessionEventsBoundedFor(sessionId, SESSION_EXPORT_EVENT_CAP)
      const truncated = events.length >= SESSION_EXPORT_EVENT_CAP
      // A failed log read must not masquerade as "no messages": the bounded
      // reader records the failure in sessionReadErrors and returned [], which
      // below would render as an empty transcript otherwise. Surface it in
      // BOTH the markdown and a dedicated field, like the truncation marker.
      const readError = sessionReadErrors.get(sessionId) ?? null
      // SessionHeader carries no title — resolve the display title the same
      // way list() does (projection-cache checkpoint first), then fall back
      // to the log's own latest session/title event so the export names the
      // conversation instead of reading 未命名会话.
      let title = projectionTitleOf(header)
      if (title === null) {
        for (const ev of events) {
          if (ev?.type === 'session/title' && typeof ev.data?.title === 'string' && ev.data.title.trim() !== '') {
            title = ev.data.title.trim()
          }
        }
      }
      const titled = title === null ? header : { ...header, title }
      const rendered = renderSessionMarkdown(titled, events)
      return {
        markdown: (truncated
          ? rendered.markdown + `\n\n> …[会话事件超出导出上限 ${SESSION_EXPORT_EVENT_CAP} 条，内容已截断]`
          : rendered.markdown)
          + (readError !== null ? `\n\n> ⚠️ [会话日志读取失败，本导出可能不完整：${readError}]` : ''),
        messages: rendered.messages,
        toolCalls: rendered.toolCalls,
        filename: exportFilename(titled),
        truncated,
        readError,
      }
    },

    /**
     * The workspace's full uncommitted diff (`git diff HEAD`), the copy-diff
     * button's payload. Bounded so a mega-repo cannot flood the browser;
     * truncation is flagged, never silent.
     *
     * A git failure is reported as a failure, NOT as an empty diff. Collapsing
     * the two made a timeout on a large repo (or a missing git binary) render as
     * "the working tree is clean", and the copy button then copied an empty
     * string — a wrong answer presented with full confidence. `error` is null
     * when git ran, so an empty diff with `error: null` really does mean clean.
     * @param {unknown} sessionId - the session whose workspace cwd is diffed.
     * @returns {Promise<{ diff: string; truncated: boolean; error: string|null; missing?: boolean }>}.
     *   `missing: true` marks a session the persistence layer no longer knows —
     *   a poll that cannot see the session must not read as "clean diff".
     */
    async gitDiff(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: gitDiff requires a sessionId string')
      }
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      const header = snapshot?.header
      const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
      // No workspace to diff is a legitimate empty answer, not a failure; the
      // `missing` flag keeps "session gone" from reading as "clean diff".
      if (snapshot === undefined || snapshot === null || cwd === '') return { diff: '', truncated: false, error: null, missing: true }
      if (!existsSync(cwd)) return { diff: '', truncated: false, error: null, missing: false }
      const outcome = await runGitOutcome(cwd, ['diff', 'HEAD'], GIT_TIMEOUT_MS, GIT_DIFF_MAX_CHARS + 1024)
      if (!outcome.ok) {
        // A timeout and a real git failure read very differently to the user, so
        // they get different messages; the exit code alone cannot tell them
        // apart (both can report a null code), which is why runGitOutcome also
        // carries `timedOut`.
        const detail = firstDiagnosticLine(outcome.stderrTail)
        const reason = outcome.timedOut
          ? `git diff 超时（${GIT_TIMEOUT_MS}ms 预算已用尽）——工作区可能过大，这不代表「无改动」`
          : `git diff 失败（退出码 ${outcome.code === null ? '未知' : outcome.code}）${detail !== '' ? '：' + detail : ''}——无法确认工作区状态`
        return { diff: '', truncated: false, error: reason }
      }
      let diff = outcome.stdout
      let truncated = false
      if (diff.length > GIT_DIFF_MAX_CHARS) {
        diff = diff.slice(0, GIT_DIFF_MAX_CHARS) + `\n…[截断：diff 超出 ${GIT_DIFF_MAX_CHARS} 字符上限]`
        truncated = true
      }
      return { diff, truncated, error: null }
    },

    /**
     * VibeUsage/ccusage style usage dashboard data: ONE usage row per session
     * (the dashboard does its own range slicing, project filtering, daily and
     * hour-of-week aggregation, so filter changes never re-fetch). Folds the
     * SAME rows list() already computes (revision-cached), so opening the
     * dashboard costs no extra log reads.
     *
     * Every read is also written through the durable ledger, and rows whose
     * session no longer exists come back from it flagged `deleted: true` — so
     * deleting a session (through this panel, or anywhere else after the
     * dashboard has seen it) no longer erases its tokens from the totals.
     *
     * @returns {Promise<{ rows: any[]; generatedAt: number; retained: number; storagePath: string; snapshotIntervalMs: number; lastSnapshotAt: number; }>}.
     */
    async usageReport() {
      // Drain the observer first, so the panel never shows numbers older than
      // the events this process already folded.
      await drainObservedUsage()
      const listResult = await this.list()
      const rows = await usageLedger.record(listResult.sessions, { protect: observedIds() })
      // A dashboard read IS a sweep: it stamps the same clock the background
      // timer does, so the panel's "last snapshot" never under-reports.
      const sweptAt = Date.now()
      return jsonSafe({
        rows,
        generatedAt: Date.now(),
        retained: rows.filter((/** @type {any} */ row) => row.deleted === true).length,
        storagePath: usageLedger.storagePath,
        snapshotIntervalMs: USAGE_SNAPSHOT_INTERVAL_MS,
        lastSnapshotAt: sweptAt,
      })
    },

    /**
     * Full-text search across the session corpus via the host's sessionQuery
     * service (searchSessions). Returned hits are reshaped into the same
     * header fields the history panel already renders, so results drop
     * straight into the existing rows.
     * @param {unknown} query - free-text query (may include metadata filters).
     * @returns {Promise<{ hits: any[] }>} each { sessionId, title, cwd,
     *   workspaceTitle, snippet, createdAt }.
     */
    async searchSessions(query) {
      if (typeof query !== 'string' || query.trim() === '') {
        throw new Error('session-admin: searchSessions requires a query string')
      }
      const sq = ctx.get('sessionQuery')
      if (!sq || typeof sq.searchSessions !== 'function') {
        throw new Error('session-admin: sessionQuery 服务不可用（需 dsh 内置 session-query）')
      }
      // Core contract (session-query types.ts SessionSearchRequest /
      // SessionSearchPage / SessionSearchHit): request is { query, limit },
      // the page carries `items`, and each hit is { header, live, persisted,
      // bestMatch: { snippet } } — the header has no title, so the display
      // title reuses list()'s chain: projection-cache checkpoint first, then
      // the cwd basename.
      let page
      try {
        page = await sq.searchSessions({ query: query.trim(), limit: SESSION_SEARCH_LIMIT })
      } catch (error) {
        // The base bundle mounts session-query-sqlite with openAt: never
        // (full-text search is opt-in). Translate the typed code into a
        // machine-matchable message prefix so the panel can offer the
        // one-click overlayAdmin/searchEnable enablement instead of a bare
        // failure — see the 全文搜索 banner in client.js.
        if (error !== null && typeof error === 'object' && error.code === 'SESSION_QUERY_SEARCH_DISABLED') {
          throw new Error('SESSION_QUERY_SEARCH_DISABLED: 全文检索在此部署中默认关闭 — 点「一键启用」写入 profile 配置（持久索引，首次搜索时打开），重启 dsh 后生效')
        }
        throw error
      }
      const searchRegistry = workspaceRegistryOf(ctx)
      const workspaces = searchRegistry === null ? [] : searchRegistry.list()
      const sessionToWorkspace = new Map()
      for (const ws of workspaces) {
        for (const sid of ws.sessionIds) {
          sessionToWorkspace.set(sid, { workspaceId: ws.id ?? null, title: ws.title ?? null })
        }
      }
      const hits = (Array.isArray(page?.items) ? page.items : []).map((/** @type {any} */ hit) => {
        const header = hit?.header ?? {}
        const title = projectionTitleOf(header)
        const ws = sessionToWorkspace.get(header.id)
        return jsonSafe({
          sessionId: header.id,
          title: title ?? (header.cwd ? sessionBaseName(header.cwd) : null),
          cwd: header.cwd ?? null,
          workspaceTitle: ws?.title ?? null,
          createdAt: header.createdAt ?? null,
          snippet: hit.bestMatch?.snippet ?? '',
        })
      })
      return { hits }
    },

    /**
     * Per-session health check: fold tool stats, turn-end reasons, retries and
     * compactions from the event log. The fold rides the same bounded replay
     * as exportSession — diagnostics tolerate a truncated prefix, and the
     * summary says so instead of implying full coverage.
     * @param {unknown} sessionId - the session to examine.
     * @returns {Promise<{ report: any; summary: any; readError: string|null; }>} where report = foldHealthReport output.
     */
    async healthReport(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: healthReport requires a sessionId string')
      }
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      if (snapshot?.header === undefined || snapshot?.header === null) {
        throw new Error(`session-admin: session '${sessionId}' does not exist`)
      }
      const events = await sessionEventsBoundedFor(sessionId, SESSION_EXPORT_EVENT_CAP)
      const report = foldHealthReport(events)
      const readError = sessionReadErrors.get(sessionId) ?? null
      // "暂无事件" from a failed read is a diagnosis, not a report: the summary
      // says so, and the field carries the reason for the panel to show.
      const summary = (readError !== null
        ? healthSummaryLine(report) + ' · 日志读取失败，报告可能不完整'
        : events.length >= SESSION_EXPORT_EVENT_CAP
          ? healthSummaryLine(report) + ' · 已截断'
          : healthSummaryLine(report))
      return jsonSafe({ report, summary, readError })
    },
  }

  const sessionBinding = Object.freeze({ service: sessionService, serviceKey: SESSION_SERVICE_KEY, namespace: SESSION_NAMESPACE })
  Object.defineProperty(sessionService, 'typertRemote', { value: sessionBinding, enumerable: false })
  auditService(sessionService, SESSION_NAMESPACE, audit)
  ctx.effect(() => { ctx.provide(SESSION_SERVICE_KEY, sessionService) }, 'plugin-admin/sessionAdmin: provide')
  return sessionService
}
