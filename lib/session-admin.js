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
import { dirname, join } from 'node:path'

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
// entry is deleted as soon as a later read succeeds.
const sessionReadErrors = new Map()

/** Evict the oldest entry when the cache exceeds its cap. */
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
 * @param result - the awaited read() result.
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
// their module-scope readers (runGit's defaults) would keep seeing the old
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
 * Run one git command in `cwd`, returning stdout on success or null on any
 * failure (not a repo, no git binary, timeout) — the dock degrades to an empty
 * stats segment instead of surfacing errors. Asynchronous (never spawnSync) so
 * the host event loop stays responsive, and both streams are drained: reading
 * stdout alone let a git process that writes warnings to stderr block on a full
 * pipe until the timeout, which read as "the dock has no data".
 */
function runGit(cwd, args, timeoutMs, maxBytes) {
  return runCommandCaptured('git', args, {
    cwd,
    timeoutMs: timeoutMs ?? GIT_TIMEOUT_MS,
    maxStdoutChars: maxBytes ?? GIT_DIFF_MAX_CHARS,
  }).then((outcome) => (outcome.code === 0 ? outcome.stdout : null))
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
 * signal lives in runGit's null return upstream.
 * @param out - raw git stdout (utf8) or null.
 * @returns {{ path: string, status: string }[]} in git order.
 */
export function parseGitStatusZ(out) {
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
 * @param out - raw git stdout (utf8) or null.
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
 * @param p - the raw path column (may contain tabs if a filename does).
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
 * @param out - raw git stdout (utf8) or null.
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
 * @param statusOut - `git status -b --porcelain=v1 -z` stdout, or null.
 * @param numstatOut - `git diff --numstat HEAD` stdout, or null.
 * @param countLines - optional (path) => positive line count | null for
 *   untracked entries.
 * @param resolvePath - optional (relPath) => absolute anchor: { absPath,
 *   absDir } for the click-to-reveal affordance.
 * @returns {{ files: number, added: number, removed: number, branch: string|null,
 *   changed: Array }}.
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
  return { files: changed.length, added, removed, branch: parseGitBranch(statusOut), changed }
}

/**
 * Line-count one untracked file the way the diff card counts text lines:
 * cap the size, treat NUL bytes as binary (no count), and apply the same
 * trailing-newline terminator rule.
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
 * @param raw - the raw segment (a session id).
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
 * @param cwd - the session header's cwd.
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
 * @param header - the stored session header ({ id, cwd? }).
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
 * @param ctx - plugin context.
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
 * @param ctx - plugin context carrying workspaceRegistry.
 * @param sessionId - session to unarchive.
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
 * @param {Record<string, any>} ctx - plugin context.
 * @param sessionId - candidate id.
 * @returns whether the session is live (an attached agent session).
 */
function sessionIsLive(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  return sessions !== undefined && typeof sessions.get === 'function'
    && sessions.get(sessionId) !== undefined
}

/**
 * Whether a message source marks a compaction checkpoint (not a user turn).
 * dsh 0.1.7 gave compaction the producer-owned `compact-checkpoint` kind
 * (its `isCompactCheckpointSource`); logs written by older hosts carry the
 * retired generic wrapper {kind:'plugin', plugin:'compact'}. The usage
 * accumulator and the derive-session-summary fold must exclude BOTH.
 * @param source - the message's `source` value (any shape).
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
 * @returns the mounted session service (index.js's usage sweep calls .list()).
 */
export function applySessionAdmin(ctx, { audit, handleCapture, usageLedger, usage, cfg }) {
  // The git budgets' module-scope readers (runGit's defaults) would keep the
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
   * @param events - session events (live or persisted).
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
   * @param header - the stored session header.
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
   * @param sessionId - the session to read.
   * @param cap - maximum events to return.
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
      sessionReadErrors.set(sessionId, error instanceof Error && error.message ? error.message : String(error))
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
   * The live-guard is a concurrency safety net for the deleteSession path: a
   * session must not lose its log while it is (or just became) live, because
   * the in-memory session would resurrect the file on the next flush.
   * closeSession passes skipLiveGuard=true — it has already torn the live
   * session down through the official dispose chain, so the guard would only
   * see the session's (now stale) live marker and wrongly refuse.
   * @param sessionId - the session to remove.
   * @param skipLiveGuard - whether to skip the "session became live" check.
   */
  async function removeSessionArtifacts(sessionId, skipLiveGuard = false) {
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
      : accountingRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId))
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
    try {
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      if (snapshot !== undefined && snapshot !== null) {
        header = snapshot.header ?? null
        materializedBytes = typeof snapshot.sizeBytes === 'number' ? snapshot.sizeBytes : null
      }
    } catch {
      // stat failure → header stays null; the removal degrades to a no-op and
      // the accounting detach below still runs.
    }
    if (header !== null) {
      const targetDir = sessionLogDirFor(header)
      if (targetDir !== undefined && existsSync(targetDir)) {
        // Guard against a concurrent resume racing the rm: deleting the log
        // of a session that just became live again would resurrect on flush.
        // Skipped on the closeSession path, which has already torn the live
        // session down through the official dispose chain.
        if (!skipLiveGuard && sessionIsLive(ctx, sessionId)) {
          throw new Error(`session '${sessionId}' became live — close it before deleting`)
        }
        assertRemovableSessionDir(targetDir)
        await rm(targetDir, { recursive: true, force: true })
      } else if (materializedBytes !== null && materializedBytes > 0) {
        throw new Error(`session-admin: session '${sessionId}' reports ${String(materializedBytes)} durable bytes but no log directory exists at the standard layout${targetDir !== undefined ? ` ('${targetDir}')` : ''}; remove it manually (custom persistence root or layout drift?)`)
      }
    }
    // 2. Detach workspace accounting — targeted, never a batch sweep
    if (accounting !== undefined) {
      await accounting.detachSession(sessionId)
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
    // 4. Clear archived-set entry
    await removeFromArchivedSet(ctx, sessionId)
    // 5. Evict the derived-summary cache entry so the map never grows
    // with deleted sessions (and a reused id never serves stale data).
    sessionSummaryCache.delete(sessionId)
    gitStatsCache.delete(sessionId)
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
    let derived = null
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
      const registry = workspaceRegistryOf(ctx)
      const workspace = registry === null
        ? undefined
        : registry.list().find(ws => ws.sessionIds.includes(sessionId))
      await usageLedger.upsert([{
        id: header.id,
        title: projectionTitleOf(header) || derived.title || (header.cwd ? sessionBaseName(header.cwd) : '未命名会话'),
        createdAt: header.createdAt,
        cwd: header.cwd ?? null,
        workspaceTitle: workspace?.title ?? null,
        tokens: derived.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        messageCount: derived.messageCount,
        assistantCount: derived.assistantCount ?? 0,
      }])
    } catch {
      /* retention is best-effort; the delete proceeds regardless */
    }
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
        workspaces: workspaces.map(ws => ({
          workspaceId: ws.id ?? null,
          title: ws.title ?? null,
          path: ws.path ?? null,
        })),
      }
    },

    async archive(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: archive requires a sessionId string')
      }
      const registry = workspaceRegistryOf(ctx)
      if (registry === null) {
        throw new Error('session-admin: 本部署未挂载 dsh-workspace，无法归档会话')
      }
      const snapshots = await ctx.sessionPersistence.list()
      if (!snapshots.some(snapshot => snapshot?.header?.id === sessionId)) {
        throw new Error(`session-admin: session '${sessionId}' does not exist`)
      }
      await registry.archiveSession(sessionId)
      return { archived: sessionId }
    },

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
     * @param sessionId - the session to delete.
     */
    async deleteSession(sessionId) {
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
     * @param sessionId - the session to close and delete.
     * @returns {Promise<{ deleted: string }>} the deleted session id.
     */
    async closeSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: closeSession requires a sessionId string')
      }
      if (sessionIsLive(ctx, sessionId)) {
        const handle = handleCapture.get(sessionId)
        if (handle === undefined) {
          throw new Error(`session '${sessionId}' is live but its agent handle was not captured (created before this plugin mounted?) — restart dsh, then delete`)
        }
        // Snapshot BEFORE the dispose: tearing the live agent down is what
        // releases the log, and the ledger's job is to outlive it.
        await recordUsageBeforeRemoval(sessionId)
        await handle.dispose()
        handleCapture.delete(sessionId)
      } else {
        await recordUsageBeforeRemoval(sessionId)
      }
      await removeSessionArtifacts(sessionId, true)
      return { deleted: sessionId }
    },

    /**
     * File-change stats for the todo dock footer, folded from the session
     * workspace's LIVE git state: `git status --porcelain=v1 -z` (the file
     * list, untracked included) plus `git diff --numstat HEAD` (the +/- line
     * totals). Untracked text files get their added-line count from a direct
     * line read. A 3s TTL cache collapses the dock's poll cadence; failures
     * (not a repo, no git binary, timeout) return zeroes rather than errors
     * so the footer just hides the segment.
     * @param sessionId - the session whose workspace cwd is examined.
     * @returns {Promise<{ files: number; added: number; removed: number; branch: string; changed: { path: string; status: string; added: number; removed: number; absPath?: string; absDir?: string; }[]; }>}.
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

    async computeFileStats(sessionId) {
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      const header = snapshot?.header
      const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
      if (cwd === '' || !existsSync(cwd)) {
        return { files: 0, added: 0, removed: 0, branch: null, changed: [] }
      }
      const statusOut = await runGit(cwd, ['status', '-b', '--porcelain=v1', '-z', '--untracked-files=all'], GIT_TIMEOUT_MS)
      if (statusOut === null) return { files: 0, added: 0, removed: 0, branch: null, changed: [] }
      // `-c core.quotePath=false` disables git's quoting of non-ASCII bytes
      // for THIS invocation: `status -z` is already raw, but `diff --numstat`
      // would otherwise emit `"src/中文.md"`-style quoted paths that no longer
      // match status's raw form, breaking per-file joined ±0 for CJK paths.
      // The scope is one git call, so no global config mutation.
      const numstatOut = await runGit(cwd, ['-c', 'core.quotePath=false', 'diff', '--numstat', 'HEAD'], GIT_TIMEOUT_MS)
      return gitFileStats(
        statusOut,
        numstatOut,
        (path) => countUntrackedLines(cwd, path),
        // Click-to-reveal anchor: select the file while it exists, otherwise
        // (deletes, some renames) select its containing directory.
        (path) => {
          const absPath = join(cwd, path)
          if (existsSync(absPath)) return { absPath, absDir: dirname(absPath) }
          return { absDir: dirname(absPath) }
        },
      )
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
     * @param sessionId - the session to render.
     * @returns {Promise<{ markdown: string; filename: string; messages: number; toolCalls: number; truncated: boolean; }>}.
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
        markdown: truncated
          ? rendered.markdown + `\n\n> …[会话事件超出导出上限 ${SESSION_EXPORT_EVENT_CAP} 条，内容已截断]`
          : rendered.markdown,
        messages: rendered.messages,
        toolCalls: rendered.toolCalls,
        filename: exportFilename(titled),
        truncated,
      }
    },

    /**
     * The workspace's full uncommitted diff (`git diff HEAD`), the copy-diff
     * button's payload. Bounded so a mega-repo cannot flood the browser;
     * truncation is flagged, never silent.
     * @param sessionId - the session whose workspace cwd is diffed.
     * @returns {Promise<{ diff: string; truncated: boolean; }>}.
     */
    async gitDiff(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: gitDiff requires a sessionId string')
      }
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      const header = snapshot?.header
      const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
      if (cwd === '' || !existsSync(cwd)) return { diff: '', truncated: false }
      let diff = (await runGit(cwd, ['diff', 'HEAD'], GIT_TIMEOUT_MS, GIT_DIFF_MAX_CHARS + 1024)) ?? ''
      let truncated = false
      if (diff.length > GIT_DIFF_MAX_CHARS) {
        diff = diff.slice(0, GIT_DIFF_MAX_CHARS) + `\n…[截断：diff 超出 ${GIT_DIFF_MAX_CHARS} 字符上限]`
        truncated = true
      }
      return { diff, truncated }
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
        retained: rows.filter(row => row.deleted === true).length,
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
     * @param query - free-text query (may include metadata filters).
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
      const hits = (Array.isArray(page?.items) ? page.items : []).map((hit) => {
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
     * @param sessionId - the session to examine.
     * @returns {Promise<{ report: any; summary: any; }>} where report = foldHealthReport output.
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
      const summary = events.length >= SESSION_EXPORT_EVENT_CAP
        ? healthSummaryLine(report) + ' · 已截断'
        : healthSummaryLine(report)
      return jsonSafe({ report, summary })
    },
  }

  const sessionBinding = Object.freeze({ service: sessionService, serviceKey: SESSION_SERVICE_KEY, namespace: SESSION_NAMESPACE })
  Object.defineProperty(sessionService, 'typertRemote', { value: sessionBinding, enumerable: false })
  auditService(sessionService, SESSION_NAMESPACE, audit)
  ctx.effect(() => { ctx.provide(SESSION_SERVICE_KEY, sessionService) }, 'plugin-admin/sessionAdmin: provide')
  return sessionService
}
