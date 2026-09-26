/**
 * dsh-plugin-admin host half. Zero dsh imports on purpose: everything rides
 * the live Cordis Context (services by key) and plain-data typert registration.
 *
 * Remote surfaces served by the /api RPC gateway. FOURTEEN namespaces are
 * published in the single `ctx.typert.register()` call near the bottom of this
 * file:
 *
 *   pluginAdmin · sessionAdmin · fsAdmin · mcpAdmin · subagentAdmin ·
 *   commandHookAdmin · projectAdmin · webhookAdmin · cronAdmin ·
 *   overlayAdmin · workspaceAdmin · skillsAdmin · webSearchAdmin · workflowAdmin
 *
 * The numbered notes below describe the load-bearing namespaces and their
 * intent; the per-namespace action lists are illustrative, not exhaustive
 * (pluginAdmin alone also carries checkUpdates/update/setEnabled, sessionAdmin
 * carries the whole listing/pinning/export surface, …). Grep
 * `<namespace>/<action>` for the full invocation table.
 *
 * 1. Namespace `pluginAdmin`:
 *    - list() → the profile's bundle layers with version/source/removable
 *    - install(spec) → `pnpm add <spec>` in the profile directory, then
 *      reconcile the package.json `dsh.profile.bundles` layer list
 *    - remove(name) → `pnpm remove <name>` + the same reconcile
 *
 * 2. Namespace `sessionAdmin`:
 *    - list() → all persisted sessions with archived/live flags
 *    - archive(sessionId) → mark session as archived in workspace registry
 *    - unarchive(sessionId) → remove from the registry's archived set
 *    - deleteSession(sessionId) → rm the session log directory, detach workspace
 *      accounting, and clear any archived-set entry
 *    - fileStats(sessionId) → the session workspace's live git file-change
 *      stats (files/added/removed + per-file明细), the todo dock footer's
 *      「N 个文件已改 +A -B」 data source
 *
 * 3. Namespace `subagentAdmin` (merged from the former dsh-plugin-subagents
 *    plugin — see lib/subagent-admin.js): named delegation-tool instances and
 *    their external CLI backends, managed as profile cordis.patch.yml rows.
 *
 * 4. Namespace `commandHookAdmin` (merged from the former standalone
 *    dsh-command-hook-admin plugin — see lib/command-hook-admin.js): file-backed
 *    slash commands (live-registered into ctx.commands) and Claude-Code-format
 *    hooks (hooks.json + disable sidecar, bridge hot-restart), plus one-click
 *    install/uninstall of the stock `@deepseek-ai/dsh-hooks-claude-code` bridge
 *    package and its profile patch row.
 *
 * 5. Namespace `webhookAdmin` (see lib/webhook-triggers.js): manage webhook
 *    inbound trigger rules (steer a live session / delegate creation to
 *    @deepseek-ai/dsh-webhook), register an HTTP prefix route
 *    `/webhook-triggers/<ruleId>` for POST delivery, verify per-rule secrets
 *    via `x-webhook-secret` header, and provide one-click install of the
 *    webhook runtime package.
 *
 * 6. Namespace `workspaceAdmin` (see lib/workspace-admin.js): workspace
 *    CRUD over `ctx.workspaceRegistry` — list / create / rename / delete /
 *    insertBefore (registry order) plus per-workspace session attach /
 *    detach / insertSessionBefore and the global archiveSession /
 *    unarchiveSession set. Best-effort native directory picker through the
 *    `directoryPicker` service's CAPABILITY object — the service itself only
 *    declares `capability()`, and `pick()` lives on the native capability
 *    (`browse` capability has none), so duck-typing a `pick` member on the
 *    service silently left picking unavailable everywhere.
 *    Pure registry + picker reads/writes; the web-app bundle mounts both
 *    services by default, the base CLI bundle does not, in which case the
 *    panel gracefully renders "workspace unavailable" instead of failing.
 *
 * 7. Namespace `skillsAdmin` (see lib/skills-admin.js): the merged, read-only
 *    skill roster of this deployment — the registry's global layer (user
 *    directories, bundled plugin skills, runtime registrations) unioned, by
 *    name, with one read per distinct (cwd, agent-preset) scope resolved from
 *    the requested sessions (`ctx.agentPresets.acquireScope` on dsh 0.1.7+ —
 *    a revision lease held only across the read, then disposed — with
 *    `agentPresets.standingKeyFor` as the older-host fallback; either route
 *    composes the preset's standing mount without activating a cold Agent).
 *    Each entry carries name / description / whenToUse / source / provider /
 *    resource location (directory path or url) / the model- and user-invocable
 *    flags / the scope labels it was seen in. Only `snapshot()` / `list()`
 *    (summaries) are called — the body loader `get()` never is — and nothing
 *    is written. Coverage, per-scope failures and the registry's `complete`
 *    flag ride along, so a partial roster can never read as a complete one.
 *
 * 8. Namespace `webSearchAdmin` (see lib/web-search-admin.js): selector +
 *    install/uninstall for the three web-search providers dsh ships in
 *    monorepo (`@deepseek-ai/dsh-web-search-deepseek` / `-exa` /
 *    `-perplexity`). `list()` enumerates known providers with on-disk
 *    installation + active-pair state; `active()` reads the current
 *    `web.config.searchProvider` from `cordis.patch.yml`; `setActive()`
 *    mutates the `web` row's `searchProvider` key in place (preserving
 *    comments + `fetchProvider`); `install()` / `uninstall()` add or
 *    drop both the cordis row AND the npm dependency via the same
 *    `ensureProfileDependency` path used by pluginAdmin / mcpAdmin. The
 *    shipped `deepseek-official` provider is bundled and cannot be
 *    uninstalled by the panel; the picker surfaces a hint, not a
 *    destructive button. `config()` reads one provider's editable Config keys
 *    (paired with the package's own defaults, each marked set / not-set) and
 *    `saveConfig()` writes them: through `settings.mutate` path ops when the
 *    provider registers a dsh settings namespace (live, revision-guarded, so
 *    the redacted view is never restated), otherwise into its
 *    `cordis.patch.yml` row (restart required). Secret fields stay write-only
 *    — a stored API key never crosses back to the browser.
 *
 * 9. Namespace `commandHookAdmin.codexBridgeInstall` /
 *    `commandHookAdmin.codexBridgeRemove` (see lib/command-hook-admin.js):
 *    one-click install/uninstall of the second stock hooks bridge
 *    `@deepseek-ai/dsh-hooks-codex` (Codex-format hooks), a parallel
 *    to the Claude Code-format `hooks/bridgeInstall` pair. Same
 *    `- insert:` shape in `cordis.patch.yml`, same serial queue, same
 *    `pnpm add` / `pnpm remove` flow; the underlying
 *    `hooks.codex.json` file lives next to `<dshHome>/hooks.json` and
 *    is hand-edited (the panel doesn't yet ship a Codex-format editor
 *    surface — that's a follow-up). v1 scope is bridge install/
 *    remove only.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { applySubagentAdmin } from './subagent-admin.js'
import { jsonSafe, killProcessTree, probeMcpServer, validateMcpConfig } from './mcp-probe.js'
import { evaluateDshPeerCompat, readInstalledDshPeers, resolveDshRuntimeVersion } from './peer-compat.js'
import { applyCommandHookAdmin } from './command-hook-admin.js'
import { PROFILE_PATCH_FILENAME, appendTopLevelBlocks, dshHome, ensureProfileDependency, entryDisabled, entryEndAt, harnessLockstepVersion, makeSerialQueue, matchRowIdLine, profileDirOf, readPatchLines, topLevelBlocks, writePatch, yamlScalar } from './patch-utils.js'
import { applyProjectAgents } from './project-agents.js'
import { applyProjectHooks, applyProjectAdmin } from './project-hooks.js'
import { applyWebhookAdmin, webhookInvocations } from './webhook-triggers.js'
import { applyCronAdmin, cronInvocations } from './cron-admin.js'
import { applyOverlayAdmin, findRowEntry } from './overlay-admin.js'
import { applyWorkspaceAdmin } from './workspace-admin.js'
import { applySkillsAdmin } from './skills-admin.js'
import { applyWebSearchAdmin } from './web-search-admin.js'
import { applyWorkflowAdmin } from './workflow-admin.js'
import { foldHealthReport, healthSummaryLine } from './health-report.js'
import { renderSessionMarkdown, exportFilename } from './session-export.js'
import { createUsageLedger, resolveLedgerCap, USAGE_LEDGER_CAP, USAGE_LEDGER_CAP_MAX } from './usage-ledger.js'

/** Services required before this plugin mounts. */
// `workspaceRegistry` is deliberately NOT injected: `@deepseek-ai/dsh-workspace`
// is mounted by the web-app bundle only, so a hard dependency would keep this
// whole plugin (including the project `.agents` command/hook bridges, which do
// not need it) from mounting in CLI / headless / sdk profiles. The registry is
// read optionally through `ctx.get('workspaceRegistry')` and every consumer
// degrades explicitly — see workspaceRegistryOf().
export const inject = ['typert', 'sessionPersistence', 'tools', 'subagents', 'commands', 'shell']

const PLUGIN_SERVICE_KEY = 'pluginAdmin'
const PLUGIN_NAMESPACE = 'pluginAdmin'
const SESSION_SERVICE_KEY = 'sessionAdmin'
const SESSION_NAMESPACE = 'sessionAdmin'
const FS_SERVICE_KEY = 'fsAdmin'
const FS_NAMESPACE = 'fsAdmin'
const MCP_SERVICE_KEY = 'mcpAdmin'
const MCP_NAMESPACE = 'mcpAdmin'
const PACKAGE = 'dsh-plugin-admin'
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

// Remote update check knobs: query the npm registry (the same registry npm
// uses — env override, .npmrc, or the official default) for the `latest`
// dist-tag of each registry-installed bundle and compare with the local
// version. Bounded concurrency, strict timeout, and a short-lived cache so
// the panel never hammers the registry on every refresh.
//
// These two budgets are module-level `let` because their consumers live at
// module scope (runPnpm / fetchLatestVersion); apply() retunes them from the
// plugin config row (pnpmTimeoutMs / updateCheckTimeoutMs) at mount.
let PNPM_TIMEOUT_MS = 5 * 60_000
let UPDATE_CHECK_TIMEOUT_MS = 8_000
// The update check's concurrency and cache TTL are tuned inside apply() from
// the plugin config row (they are only read there).
const NPM_REGISTRY_DEFAULT = 'https://registry.npmjs.org'

/**
 * Names of the profile manifest's declared dependencies. An unreadable
 * manifest (no install has happened yet) yields an empty set.
 * @param {string} profileDir
 * @returns {Set<string>}
 */
function profileDependencyNames(profileDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    return new Set(Object.keys(manifest.dependencies ?? {}))
  } catch {
    return new Set()
  }
}

/**
 * dsh peer-compatibility verdict for the packages an install just ADDED.
 * dsh 0.1.7 enforces `@deepseek-ai/dsh*` peers at boot and skips incompatible
 * bundles, so a successful `pnpm add` can still yield a plugin that will
 * never load. Every NEW dependency (usually one) with declared dsh peers is
 * checked against the running runtime; the structured verdict rides the
 * install result for the panel to render. Never throws — an unresolvable
 * runtime version degrades to `{ checked: false }` and the panel stays quiet.
 * @param {string} profileDir
 * @param {Set<string>} before - dependency names present BEFORE the install.
 * @returns {{ checked: boolean, runtimeVersion?: string, ok: boolean,
 *   rows: Array<{ name, version, peers, incompatible }> }}
 */
function assessInstalledCompat(profileDir, before) {
  const runtimeVersion = resolveDshRuntimeVersion()
  if (runtimeVersion === null) return { checked: false, ok: true, rows: [] }
  const rows = []
  for (const name of profileDependencyNames(profileDir)) {
    if (before.has(name)) continue
    const info = readInstalledDshPeers(profileDir, name)
    if (info === null) continue
    const verdict = evaluateDshPeerCompat(info.peers, runtimeVersion)
    if (!verdict.ok) {
      rows.push({ name, version: info.version, peers: info.peers, incompatible: verdict.incompatible })
    }
  }
  return { checked: true, runtimeVersion, ok: rows.length === 0, rows }
}

/**
 * Compare two version strings using semver semantics (major.minor.patch),
 * ignoring build metadata (+sha) so `1.0.0+sha` == `1.0.0`. A prerelease
 * (e.g. `1.0.0-rc.1`) sorts below its release (`1.0.0`), so publishing the
 * final of an installed rc correctly flags an update. Prerelease identifiers
 * split on `.` and compare per segment: numeric segments compare numerically
 * and sort below alphanumeric ones, so `rc.10` > `rc.9`.
 * @returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareSemver(a, b) {
  const pa = /^(\d+)\.(\d+)\.(\d+)/.exec(String(a ?? ''))
  const pb = /^(\d+)\.(\d+)\.(\d+)/.exec(String(b ?? ''))
  if (!pa || !pb) return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  for (let i = 1; i <= 3; i++) {
    const na = parseInt(pa[i], 10)
    const nb = parseInt(pb[i], 10)
    if (na !== nb) return na - nb
  }
  // Prerelease = the text between `-` and `+` after the core triple.
  const preOf = (match, whole) => {
    const rest = whole.slice(match[0].length)
    return rest.startsWith('-') ? rest.slice(1).split('+')[0] : ''
  }
  const preA = preOf(pa, String(a ?? ''))
  const preB = preOf(pb, String(b ?? ''))
  if (preA === preB) return 0
  // A release outranks any prerelease of the same triple.
  if (preA === '') return 1
  if (preB === '') return -1
  const idsA = preA.split('.')
  const idsB = preB.split('.')
  for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
    const x = idsA[i]
    const y = idsB[i]
    // Fewer identifiers sort below a longer list with the same prefix.
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x) ? parseInt(x, 10) : null
    const ny = /^\d+$/.test(y) ? parseInt(y, 10) : null
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny
    } else if (nx !== null) {
      return -1 // numeric identifiers sort below alphanumeric ones
    } else if (ny !== null) {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/**
 * A `name:` row naming the MCP client plugin, in any of the three YAML
 * spellings this plugin reads (bare, single-quoted, double-quoted). The
 * quotes must MATCH: a YAML parser rejects a mismatched pair, so accepting
 * one here would present dead rows as live MCP entries.
 */
const MCP_NAME_ROW = /^\s*name:\s*(?:'@deepseek-ai\/dsh-mcp-client'|"@deepseek-ai\/dsh-mcp-client"|@deepseek-ai\/dsh-mcp-client)\s*$/

// sessionId -> { revision, title, summary, messageCount, at }. Keyed by the
// persistence revision token so unchanged sessions skip re-reading their
// whole event log on every panel refresh. Bounded by LRU eviction so sessions
// deleted through other paths (CLI, manual file removal) don't leak entries.
// The summary cache's TTL, the list concurrency, and the per-session event
// scan cap are tuned inside apply() from the plugin config row.
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
// Both budgets ride the same module-level `let` pattern as PNPM_TIMEOUT_MS:
// their module-scope readers (runGit's defaults) would keep seeing the old
// value if apply() shadowed them with closure consts, silently disabling the
// config row — apply() assigns instead.
let GIT_TIMEOUT_MS = 5_000
// The git-stats cache TTL is tuned inside apply() from the plugin config row
// (its only reader is the fileStats closure there).
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
 * Run one git command in `cwd` asynchronously, returning stdout on success
 * or null on any failure (not a repo, no git binary, timeout) — the dock
 * degrades to an empty stats segment instead of surfacing errors. Uses spawn
 * (not spawnSync) so the host event loop stays responsive during git I/O.
 */
function runGit(cwd, args, timeoutMs, maxBytes) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, timeout: timeoutMs ?? GIT_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' })
    let stdout = ''
    const cap = maxBytes ?? GIT_DIFF_MAX_CHARS
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > cap) stdout = stdout.slice(0, cap)
    })
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code === 0 ? stdout : null))
  })
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
/*                             Plugin Admin Logic                            */
/* ========================================================================== */

/**
 * @param profileDir - the profile directory.
 * @returns a require anchored at the profile's package.json.
 */
function requireOf(profileDir) {
  return createRequire(join(profileDir, 'package.json'))
}

/**
 * @param require - profile-anchored require.
 * @param name - dependency package name.
 * @returns the parsed manifest, or undefined when unresolvable.
 */
function readManifest(require, name) {
  try {
    return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Whether a package declares a bundle patch (i.e. is a profile layer).
 * @param require - profile-anchored require.
 * @param name - dependency package name.
 */
function declaresBundle(require, name) {
  const manifest = readManifest(require, name)
  return manifest !== undefined
    && typeof manifest.dsh === 'object' && manifest.dsh !== null
    && manifest.dsh.bundle !== undefined
    && manifest.dsh.bundle.patch !== undefined
}

/**
 * The local source path a dependency spec installs from, when it is a local
 * install (`link:<dir>` / `file:<dir|tarball>` or a bare absolute path).
 * Registry ranges, dist-tags, and remote URLs resolve to null.
 *
 * The absolute-path branch is anchored so only drive-letter (C:\...), UNC
 * (\\\\host\\share), and rooted POSIX (/) paths count as local; a plain
 * `//` inside a URL (https://...) is deliberately not matched — remote git
 * and tarball dependencies are installs, not local sources.
 * @param spec - the raw dependency range from the profile manifest.
 * @returns the local path string, or null for registry/remote installs.
 */
function localSpecPath(spec) {
  if (typeof spec !== 'string') return null
  const linked = /^(?:link|file):(.+)$/.exec(spec)
  if (linked !== null) return linked[1]
  if (/(?:^[a-zA-Z]:[\\/])|(?:^[\\/]{2})|(?:^\/)/.test(spec)) return spec
  return null
}

/**
 * The row ids one bundle's own cordis.patch.yml COMPOSES — entries that carry
 * both `id:` and `name:` (new rows), across insert blocks and bare shapes.
 * Id-override rows without a `name:` are not the bundle's to disable (they
 * retarget other layers' rows). These are the ids a profile-layer
 * `disabled: true` row can turn off for the whole plugin.
 * @param {string} patchText - the bundle's own patch file content.
 * @returns {string[]} composing row ids in file order (deduplicated).
 */
export function bundleComposingRowIds(patchText) {
  const ids = []
  const lines = String(patchText ?? '').split(/\r?\n/)
  for (const block of topLevelBlocks(lines)) {
    for (let i = block.index; i < block.endIndex; i++) {
      const match = matchRowIdLine(lines[i])
      if (match === null) continue
      const end = entryEndAt(lines, i, block.endIndex, match.indent)
      const hasName = lines.slice(i + 1, end).some((line) => /^\s*name:\s*\S/.test(line))
      if (hasName && !ids.includes(match.id)) ids.push(match.id)
    }
  }
  return ids
}

/**
 * Resolve the composing row ids a bundle's own patch declares. Callers that
 * tolerate a missing/unreadable patch read `rowIds` ([] either way); callers
 * that fail loud distinguish the causes via `declared` (false = the bundle
 * declares no patch) and `error` (the resolve/read failure).
 * @param require - profile-anchored require.
 * @param name - the bundle (package) name.
 * @param manifest - the parsed bundle manifest.
 * @returns {{ rowIds: string[], declared: boolean, error: unknown }}
 */
function resolveBundleRowIds(require, name, manifest) {
  const patchRelative = manifest?.dsh?.bundle?.patch
  if (typeof patchRelative !== 'string' || patchRelative === '') {
    return { rowIds: [], declared: false, error: null }
  }
  try {
    const bundlePatchPath = join(dirname(require.resolve(`${name}/package.json`)), patchRelative)
    return { rowIds: bundleComposingRowIds(existsSync(bundlePatchPath) ? readFileSync(bundlePatchPath, 'utf8') : ''), declared: true, error: null }
  } catch (error) {
    return { rowIds: [], declared: true, error }
  }
}

/**
 * Whether one top-level block is a bare disable-only row the toggle authored:
 * exactly `- id: <id>` + `  disabled: true` (comments/blanks tolerated, no
 * other keys). Only such blocks are REMOVED wholesale on enable — user
 * overrides with real config lose just their `disabled` line instead.
 * @param {string[]} blockLines - the block's own lines.
 * @param {string} rowId - the row id the block must carry.
 * @returns {boolean}
 */
function isBareDisableBlock(blockLines, rowId) {
  const content = blockLines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  if (content.length !== 2) return false
  const match = matchRowIdLine(content[0])
  if (match === null || match.id !== rowId || match.indent !== '') return false
  return /^\s*disabled:\s*true\s*$/.test(content[1])
}

/**
 * Upsert profile-layer `disabled: true` rows for the given bundle row ids
 * (pure): missing rows are appended as canonical bare blocks; present rows
 * gain a `disabled: true` line right under their id line (any shape — bare
 * override or insert-nested entry) unless already disabled. Everything else
 * in the file is preserved byte-for-byte.
 * @param {string[]} lines - profile patch lines.
 * @param {string[]} rowIds - the bundle's composing row ids.
 * @returns {{ lines: string[], changed: boolean, skipped: string[] }} next
 *   lines, whether anything was written, and ids that were already disabled.
 */
export function upsertDisableRows(lines, rowIds) {
  let next = lines
  let changed = false
  const skipped = []
  for (const rowId of rowIds) {
    const entry = findRowEntry(next, rowId)
    if (entry === null) {
      // Same `[]` placeholder hazard the MCP panel documents (see
      // appendTopLevelBlocks): appending below a bare empty-list line
      // produces a second YAML document and a boot parse error.
      const block = [`- id: ${rowId}`, '  disabled: true']
      next = appendTopLevelBlocks(next, [block])
      changed = true
      continue
    }
    const entryLines = next.slice(entry.entryStart, entry.entryEnd)
    if (entryDisabled(entryLines) === true) {
      skipped.push(rowId)
      continue
    }
    const disabledLine = `${entry.indent}  disabled: true`
    next = [...next.slice(0, entry.entryStart + 1), disabledLine, ...next.slice(entry.entryStart + 1)]
    changed = true
  }
  return { lines: next, changed, skipped }
}

/**
 * Remove the toggle's disable rows for the given bundle row ids (pure): bare
 * disable-only blocks are deleted whole; any other entry carrying our
 * `disabled: true` line loses just that line. Absent/already-enabled rows
 * are no-ops. User config lines are never touched.
 * @param {string[]} lines - profile patch lines.
 * @param {string[]} rowIds - the bundle's composing row ids.
 * @returns {{ lines: string[], changed: boolean }}
 */
export function removeDisableRows(lines, rowIds) {
  let next = lines
  let changed = false
  for (const rowId of rowIds) {
    const blocks = topLevelBlocks(next)
    for (let b = blocks.length - 1; b >= 0; b--) {
      const block = blocks[b]
      const blockLines = next.slice(block.index, block.endIndex)
      const idMatch = matchRowIdLine(blockLines[0] ?? '')
      if (idMatch === null || idMatch.id !== rowId) continue
      if (isBareDisableBlock(blockLines, rowId)) {
        next = [...next.slice(0, block.index), ...next.slice(block.endIndex)]
        changed = true
        continue
      }
      // A richer block (user override or insert-nested row): strip only the
      // disabled line we or the user added, keep every other line.
      let stripped = false
      const cleaned = blockLines.filter((line) => {
        if (!stripped && /^\s*disabled:\s*true\s*(?:#.*)?$/.test(line)) { stripped = true; return false }
        return true
      })
      if (stripped) {
        next = [...next.slice(0, block.index), ...cleaned, ...next.slice(block.endIndex)]
        changed = true
      }
    }
  }
  return { lines: next, changed }
}

/**
 * Resolve the npm registry the user actually installs from: the npm_config
 * env override first, then a `registry=` line in the nearest .npmrc (user or
 * profile), falling back to the official registry. Mirrors npm's own
 * resolution well enough for update checks; a mismatch only means the check
 * queries a different mirror, which is acceptable.
 * @param profileDir - profile directory (checked for a local .npmrc).
 * @returns the registry base URL (no trailing slash).
 */
function resolveNpmRegistry(profileDir) {
  if (typeof process.env.npm_config_registry === 'string' && process.env.npm_config_registry.trim() !== '') {
    return process.env.npm_config_registry.trim().replace(/\/+$/, '')
  }
  const candidates = [
    join(profileDir, '.npmrc'),
    join(homedir(), '.npmrc'),
  ]
  for (const file of candidates) {
    try {
      const text = readFileSync(file, 'utf8')
      const match = /^\s*registry\s*=\s*(\S+)\s*$/m.exec(text)
      if (match) return match[1].replace(/\/+$/, '')
    } catch {
      // file absent — try the next candidate
    }
  }
  return NPM_REGISTRY_DEFAULT
}

/**
 * Resolve a `name@latest` install spec into a pinned `name@<version>` spec by
 * querying the registry for the current `latest` dist-tag. Returns the original
 * `name@latest` unchanged when the registry is unreachable, so an offline
 * upgrade attempt still fails loudly (pnpm will error on the unknown tag)
 * rather than silently no-op'ing. Scoped names (`@scope/name`) are supported.
 * @param profileDir - profile directory (used to locate a local .npmrc).
 * @param name - package name without any version/range suffix.
 * @returns the pinned spec string (e.g. "dsh-plugin-admin@0.5.0").
 */
async function resolveLatestSpec(profileDir, name) {
  const registry = resolveNpmRegistry(profileDir)
  const latest = await fetchLatestVersion(registry, name)
  if (latest === null) {
    // Registry unreachable: keep the literal @latest so pnpm surfaces the
    // failure (no silent "up to date").
    return name + '@latest'
  }
  return name + '@' + latest
}

/**
 * Query the npm registry for the `latest` dist-tag version of one package.
 * Strict timeout; returns null on any failure so a dead registry never
 * breaks the panel.
 * @param registry - registry base URL.
 * @param name - package name (scoped names are URL-encoded).
 * @returns the latest version string, or null when unknown/unreachable.
 */
async function fetchLatestVersion(registry, name) {
  try {
    const url = `${registry}/${name.split('/').map(encodeURIComponent).join('/')}/latest`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS)
    let response
    try {
      response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) return null
    const data = await response.json()
    if (data && typeof data.version === 'string') return data.version
    return null
  } catch {
    return null
  }
}

/**
 * Remote update check for one plugin entry: only registry-installed bundles
 * (dependency-managed and not a local path) are queried. The result never
 * throws — network failures surface as `error` on the entry.
 * @param registry - registry base URL.
 * @param plugin - plugin list entry ({ name, version, dependency, localPath }).
 * @returns { name, version, latest, updateAvailable, error? }.
 */
async function checkPluginUpdate(registry, plugin) {
  if (!plugin.dependency || plugin.localPath !== null) {
    return { name: plugin.name, version: plugin.version, latest: null, updateAvailable: false }
  }
  const latest = await fetchLatestVersion(registry, plugin.name)
  if (latest === null) {
    return { name: plugin.name, version: plugin.version, latest: null, updateAvailable: false, error: '无法查询远程版本（网络或 registry 不可达）' }
  }
  return {
    name: plugin.name,
    version: plugin.version,
    latest,
    updateAvailable: compareSemver(plugin.version, latest) < 0,
  }
}

/** Run bounded-concurrency async work over a list, preserving order. */
async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Atomically replace the profile manifest: write the next content to a
 * sibling temp file and rename over the original. A crash mid-write then
 * leaves either the old or the new package.json — never a truncated JSON
 * that would take the whole profile down at next dsh start.
 * @param profileDir - the profile directory.
 * @param pkg - the complete next manifest object.
 */
function writeManifest(profileDir, pkg) {
  const manifestPath = join(profileDir, 'package.json')
  const tempPath = manifestPath + '.dsh-admin.tmp'
  writeFileSync(tempPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  renameSync(tempPath, manifestPath)
}

/**
 * Read-modify-write the profile manifest in ONE synchronous window: the
 * mutation always sees the freshest on-disk state (pnpm may have rewritten
 * the file earlier in the same enqueued operation) and at most one write
 * lands per call — the former writeBundles→reconcileBundles pair re-read
 * what it had just written and held a second read-modify-write window open.
 * @param profileDir - the profile directory.
 * @param mutate - synchronous (pkg) => boolean; true persists the mutation.
 * @returns whether the manifest changed.
 */
function updateManifest(profileDir, mutate) {
  const manifestPath = join(profileDir, 'package.json')
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (mutate(pkg) !== true) return false
  writeManifest(profileDir, pkg)
  return true
}

/**
 * Synchronize `dsh.profile.bundles` with the dependency state, optionally
 * dropping one bundle name in the same window: bundle-declaring
 * dependencies join (dependency order), dependency-managed entries that
 * stopped being bundles leave, in-box entries stay.
 * @param profileDir - the profile directory.
 * @param dropBundle - one bundle name to remove (post-`pnpm remove`
 *   cleanup); null leaves the existing list untouched by this step.
 * @returns whether the manifest changed.
 */
function reconcileBundles(profileDir, dropBundle = null) {
  const require = requireOf(profileDir)
  return updateManifest(profileDir, (pkg) => {
    const dependencies = Object.keys(pkg.dependencies ?? {})
    const bundles = pkg.dsh?.profile?.bundles ?? []
    let changed = false
    if (dropBundle !== null) {
      const at = bundles.indexOf(dropBundle)
      if (at !== -1) {
        bundles.splice(at, 1)
        changed = true
      }
    }
    for (const name of dependencies) {
      if (declaresBundle(require, name) && !bundles.includes(name)) {
        bundles.push(name)
        changed = true
      }
    }
    for (const name of [...bundles]) {
      if (dependencies.includes(name) && !declaresBundle(require, name)) {
        bundles.splice(bundles.indexOf(name), 1)
        changed = true
      }
    }
    if (changed) {
      pkg.dsh = { ...pkg.dsh, profile: { ...pkg.dsh?.profile, bundles } }
    }
    return changed
  })
}

/**
 * Args for spawn under runPnpm's shell policy. On Windows pnpm runs through
 * cmd.exe (the .cmd shim), which consumes `^` as its escape character before
 * pnpm ever sees the token — `name@^1.2.3` would silently arrive as
 * `name@1.2.3` (exact pin instead of a range). Doubling the caret survives
 * cmd's unescaping; other platforms pass args through untouched.
 * @param {string[]} args - pnpm arguments.
 * @param {string} platform - process platform.
 * @returns {string[]} spawn-ready arguments.
 */
export function pnpmSpawnArgs(args, platform = process.platform) {
  return platform === 'win32' ? args.map((arg) => arg.replace(/\^/g, '^^')) : args
}

/**
 * Run one pnpm invocation in the profile directory (async; never blocks host loop).
 * @param profileDir - working directory for pnpm.
 * @param args - pnpm arguments.
 * @returns the command's combined output tail on success.
 * @throws {Error} carrying the output tail when pnpm exits non-zero.
 */
function runPnpm(profileDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', pnpmSpawnArgs(args), {
      cwd: profileDir,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: process.env,
    })
    let output = ''
    const record = (chunk) => {
      output += chunk
      if (output.length > 16_384) output = output.slice(-8_192)
    }
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    const timer = setTimeout(() => {
      killProcessTree(child.pid)
      reject(new Error(`pnpm timed out after ${String(PNPM_TIMEOUT_MS / 1000)}s: ${output}`))
    }, PNPM_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error.code === 'ENOENT'
        ? new Error('pnpm not found on PATH — install pnpm to manage profile plugins')
        : error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output.trim())
      else reject(new Error(`pnpm ${args.join(' ')} exited with code ${String(code)}:\n${output.trim()}`))
    })
  })
}


/**
 * Characters permitted in a pnpm install/remove operand. Single-token
 * operands only: package names, scoped names (@scope/name), version
 * suffixes (^1.2.3, ~1.2.3, name@*), git URLs (git+https://...#ref), and
 * drive-letter/UNC/POSIX paths. Every cmd.exe separator, redirect, and
 * expansion character is excluded by construction — including <, >, =, |,
 * &, %, !, quotes, backticks, parens, braces, commas, and whitespace (the
 * >/< semver range forms like >=1.0.0 are multi-token and would already be
 * split by the shell, so dropping them loses nothing real). On Windows the
 * spawn below uses shell:true (pnpm ships as a .cmd shim), so the operand
 * is one token of the joined command line — metacharacters here would be
 * the difference between pnpm and a second command. `^` is admitted because
 * `^1.2.3`-style ranges are legitimate operand content; pnpmSpawnArgs doubles
 * it on win32 so cmd.exe unescapes it back before pnpm sees the token.
 */
const PNPM_OPERAND_ALLOWED = /^[A-Za-z0-9@\/_.:\\^~*=+#-]+$/

/**
 * Validate one pnpm operand and return it trimmed. Refuses leading dashes
 * (an operand must never masquerade as a pnpm flag) and any character
 * outside the allowlist (a whole class of shell metacharacters is rejected
 * at once instead of a hand-maintained blocklist of separators).
 * @param field - human label for the error message (e.g. 'install spec').
 * @param value - raw operand from the RPC boundary.
 * @returns the trimmed, validated operand.
 * @throws {Error} when the operand is a flag or carries shell metacharacters.
 */
function assertPnpmOperand(field, value) {
  const operand = value.trim()
  if (/^-/.test(operand)) {
    throw new Error('plugin-admin: ' + field + ' \'' + operand.slice(0, 48) + '\' looks like a CLI flag')
  }
  if (!PNPM_OPERAND_ALLOWED.test(operand)) {
    throw new Error('plugin-admin: ' + field + ' carries shell metacharacters — only package specs, version ranges, and local paths are accepted')
  }
  return operand
}

/* Exported for host-check.mjs: the shell-allowlist validator, the local
 * source-path classifier, and the version comparator are pure functions, so
 * the self-check drives them directly without touching pnpm or the real
 * profile manifest. The update checker is exported too — its registry fetch
 * is injected, so the host-check can drive it against a local HTTP stub
 * without touching the real npm. */
export { localSpecPath, assertPnpmOperand, resolveNpmRegistry, fetchLatestVersion, checkPluginUpdate, compareSemver }

/* Re-exported from mcp-probe.js for the self-check: the MCP tool-result
 * normalizer, the scrubbed probe environment, and the Windows cmd.exe
 * argument escaper are pure functions the host-check drives directly. */
export { normalizeMcpToolResult, scrubbedProbeEnv, escapeCmdArg } from './mcp-probe.js'

/* ========================================================================== */
/*                            Session Admin Logic                             */
/* ========================================================================== */

/**
 * Check the session persistence seam's public members (list / stat / open).
 * These are dsh internals this plugin rides rather than a public API — the
 * check exists so a dsh version change fails loudly at mount instead of
 * silently breaking every session-admin call later. Called from apply().
 * @param persistence - live sessionPersistence service.
 * @throws {Error} naming the exact missing members when incompatible.
 */
function assertPersistenceShape(persistence) {
  const missing = []
  if (typeof persistence?.list !== 'function') missing.push('list')
  if (typeof persistence?.stat !== 'function') missing.push('stat')
  if (typeof persistence?.open !== 'function') missing.push('open')
  if (missing.length > 0) {
    throw new Error(`session-admin: session persistence missing members [${missing.join(', ')}] — dsh version changed?`)
  }
}

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
function workspaceRegistryOf(ctx) {
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
 * @param ctx - plugin context.
 * @param sessionId - candidate id.
 * @returns whether the session is live (an attached agent session).
 */
function sessionIsLive(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  return sessions !== undefined && typeof sessions.get === 'function'
    && sessions.get(sessionId) !== undefined
}

/**
 * Capture the AgentHandle dsh's agent factory returns when it creates or
 * resumes a live agent. The handle's `dispose()` is dsh's ONLY complete
 * teardown path for a live agent+session: it stops the loop, waits for
 * quiescence, unregisters the agent, removes the session from the in-memory
 * SessionStore (emitting `session/disposed`), which lets the persistence
 * backend flush buffered events and release its write path — so the session's
 * log can then be removed WITHOUT being resurrected by a later flush.
 *
 * dsh deliberately hands the handle only to the creator ("CAPABILITY: among
 * consumers, only the holder can tear this agent down"), so the Web host
 * (dsh-host-apiproxy) discards it after resume. This plugin wraps the PUBLIC
 * `ctx.agents` service methods transparently — calling through to the originals
 * and returning their exact results — and keeps a private id -> handle map so
 * the admin panel can later dispose an online session by id.
 *
 * The wrapper is best-effort by design: if the agents service is absent, the
 * factory shape changes, or a session was created before this plugin mounted,
 * online-session close simply degrades to the existing "restart to delete"
 * behavior — never a crash.
 *
 * @param ctx - plugin context.
 * @returns an object with `get(sessionId)` (the captured handle, or undefined)
 *   and `wrapped` (whether the agents service is present to wrap).
 */
/** Maximum live agent handles tracked before LRU eviction kicks in. */
const HANDLE_MAP_CAP = 200

function installAgentHandleCapture(ctx) {
  const handles = new Map()
  const agents = ctx.get('agents')
  if (agents === undefined || typeof agents !== 'object' || agents === null) {
    return { get: () => undefined, wrapped: false }
  }

  const originals = []
  const wrap = (service, methodName) => {
    const original = service[methodName]
    if (typeof original !== 'function') return
    const wrapped = function (...args) {
      const result = original.apply(this, args)
      const capture = (handle) => {
        if (handle !== null && typeof handle === 'object'
          && typeof handle.dispose === 'function'
          && typeof handle.agent?.id === 'string') {
          // LRU eviction: a re-capture first drops its old position so Map
          // insertion order tracks recency, then the oldest entry goes when
          // the cap is reached — a long-running host cannot leak handles for
          // sessions that ended through the normal loop dispose path.
          handles.delete(handle.agent.id)
          if (handles.size >= HANDLE_MAP_CAP) {
            const oldest = handles.keys().next().value
            if (oldest !== undefined) handles.delete(oldest)
          }
          handles.set(handle.agent.id, handle)
        }
        return handle
      }
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        return result.then(capture)
      }
      capture(result)
      return result
    }
    try {
      service[methodName] = wrapped
    } catch (error) {
      // A frozen or getter-only service member cannot host the transparent
      // wrapper. Degrade to the restart-required online-delete path with a
      // loud log instead of failing the whole plugin mount — everything else
      // the plugin serves does not depend on the capture.
      ctx.logger?.warn?.(`plugin-admin: cannot wrap agents.${methodName} (${error instanceof Error ? error.message : String(error)}) — online-session close will require a dsh restart`)
      return
    }
    originals.push({ service, methodName, original })
  }

  // create() / resume() are the two public factories that produce AgentHandle
  // values. The loop's config-driven agents call resume() through the same
  // service, so those are captured too.
  wrap(agents, 'create')
  wrap(agents, 'resume')

  // Restore original methods on plugin disposal so the agents service is
  // not left pointing at wrapper closures from an unloaded plugin (HMR /
  // hot-unload safety).
  ctx.effect(() => () => {
    for (const { service, methodName, original } of originals) {
      try { service[methodName] = original } catch {}
    }
    handles.clear()
  }, 'plugin-admin/agent-handle-capture: teardown')

  return {
    wrapped: true,
    get: (sessionId) => handles.get(sessionId),
    delete: (sessionId) => handles.delete(sessionId),
    size: () => handles.size,
  }
}

/* ========================================================================== */
/*                                Config Schema                               */
/* ========================================================================== */

/**
 * Resolve the deployment-varying knobs from one config row: every provided
 * value is validated FAIL-LOUD (a mistyped row must not silently degrade the
 * budget it tunes) and absent ones fall back to the historical defaults.
 * Unknown keys pass through untouched — the command-hook admin reads its
 * `commandsDir` / `hooksPath` / `disabledPath` overrides off the same row.
 * @param {unknown} raw - the raw config row (absent for a bare patch row).
 * @returns {object} the resolved config with every known knob filled in.
 * @throws {Error} when a provided value is not a positive (integer) number.
 */
export function resolvePluginConfig(raw) {
  const cfg = raw === undefined || raw === null ? {} : raw
  if (typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error(`plugin-admin: config must be a mapping (got ${JSON.stringify(raw)})`)
  }
  const positiveNumber = (label, value, fallback) => {
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`plugin-admin: config.${label} must be a positive finite number (got ${JSON.stringify(value)})`)
    }
    return value
  }
  const positiveInteger = (label, value, fallback) => {
    const resolved = positiveNumber(label, value, fallback)
    if (!Number.isInteger(resolved)) {
      throw new Error(`plugin-admin: config.${label} must be an integer (got ${JSON.stringify(value)})`)
    }
    return resolved
  }
  // Zero is a MEANINGFUL value for the sweep interval (it disables the
  // background sweep), so it needs its own validator instead of the
  // positive-only one.
  const nonNegativeNumber = (label, value, fallback) => {
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`plugin-admin: config.${label} must be a non-negative finite number (0 disables it) (got ${JSON.stringify(value)})`)
    }
    return value
  }
  return {
    ...cfg,
    pnpmTimeoutMs: positiveNumber('pnpmTimeoutMs', cfg.pnpmTimeoutMs, 5 * 60_000),
    updateCheckTimeoutMs: positiveNumber('updateCheckTimeoutMs', cfg.updateCheckTimeoutMs, 8_000),
    updateCheckConcurrency: positiveInteger('updateCheckConcurrency', cfg.updateCheckConcurrency, 4),
    updateCheckCacheTtlMs: positiveNumber('updateCheckCacheTtlMs', cfg.updateCheckCacheTtlMs, 5 * 60_000),
    gitTimeoutMs: positiveNumber('gitTimeoutMs', cfg.gitTimeoutMs, 5_000),
    gitStatsCacheTtlMs: positiveNumber('gitStatsCacheTtlMs', cfg.gitStatsCacheTtlMs, 3_000),
    gitDiffMaxChars: positiveNumber('gitDiffMaxChars', cfg.gitDiffMaxChars, 512 * 1024),
    sessionSummaryCacheTtlMs: positiveNumber('sessionSummaryCacheTtlMs', cfg.sessionSummaryCacheTtlMs, 60_000),
    sessionListConcurrency: positiveInteger('sessionListConcurrency', cfg.sessionListConcurrency, 4),
    sessionEventScanCap: positiveInteger('sessionEventScanCap', cfg.sessionEventScanCap, 20_000),
    sessionSearchLimit: positiveInteger('sessionSearchLimit', cfg.sessionSearchLimit, 30),
    sessionExportEventCap: positiveInteger('sessionExportEventCap', cfg.sessionExportEventCap, 200_000),
    // Background usage-ledger sweep interval: the dashboard's read is
    // opportunistic, so a session deleted before anyone opened the dashboard
    // would still lose its tokens. The sweep folds the whole session table
    // into the ledger on a timer instead. 0 disables it.
    usageSnapshotIntervalMs: nonNegativeNumber('usageSnapshotIntervalMs', cfg.usageSnapshotIntervalMs, 60 * 60_000),
    // Ledger retention: how many per-session rows survive eviction (oldest
    // lastSeenAt loses). Bounded above so one typo can't wedge the serial
    // queue with a multi-hundred-MB rewrite on every merge.
    usageLedgerCap: (() => {
      const resolved = positiveInteger('usageLedgerCap', cfg.usageLedgerCap, USAGE_LEDGER_CAP)
      if (resolved > USAGE_LEDGER_CAP_MAX) {
        throw new Error(`plugin-admin: config.usageLedgerCap must be <= ${USAGE_LEDGER_CAP_MAX} (got ${resolved})`)
      }
      return resolved
    })(),
  }
}

/**
 * Config schema in the Standard Schema shape the Loader resolves through
 * (`resolveConfig` in vendor/cordis): an absent row yields the defaults, a
 * mistyped value yields issues that the Loader raises as a ValidationError
 * before the plugin mounts. Hand-written rather than schemastery —
 * `~standard.validate` is the only surface the Loader touches, and staying
 * dependency-free is this package's stance (see patch-utils.js).
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-plugin-admin',
    validate(config) {
      try {
        return { value: resolvePluginConfig(config) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  },
}

/* ========================================================================== */
/*                             Plugin Main Apply                              */
/* ========================================================================== */

/**
 * Mount the unified plugin & session admin remote services and their typert descriptors.
 * @param ctx - plugin context carrying typert, workspaceRegistry, sessionPersistence, commands.
 * @param config - optional plugin config row (the Loader resolves it through
 *   {@link Config} first; a direct caller gets the same resolution here).
 *   Unknown keys pass through — the command-hook admin module honors
 *   `{ commandsDir?, hooksPath?, disabledPath? }` overrides off the same row.
 */
export function apply(ctx, config) {
  const profileDir = profileDirOf(ctx.baseUrl)

  // Config overrides: deployment-varying tunables are validated Config fields
  // changeable from cordis.yml. The Loader resolves them through the exported
  // {@link Config} schema before this runs; resolvePluginConfig() repeats that
  // resolution here so a direct caller (tests, hand-mounted contexts) that
  // bypasses the Loader gets the identical fail-loud contract. The pnpm /
  // update-check / git budgets are consumed at module scope (runPnpm /
  // fetchLatestVersion / runGit), so they are assigned to the module-level
  // `let`s instead of shadowed — a shadow would silently disable them for
  // those readers. The remaining knobs are read inside this apply() closure.
  const cfg = resolvePluginConfig(config)
  PNPM_TIMEOUT_MS = cfg.pnpmTimeoutMs
  UPDATE_CHECK_TIMEOUT_MS = cfg.updateCheckTimeoutMs
  const UPDATE_CHECK_CONCURRENCY = cfg.updateCheckConcurrency
  const UPDATE_CHECK_CACHE_TTL_MS = cfg.updateCheckCacheTtlMs
  GIT_TIMEOUT_MS = cfg.gitTimeoutMs
  const GIT_STATS_CACHE_TTL_MS = cfg.gitStatsCacheTtlMs
  GIT_DIFF_MAX_CHARS = cfg.gitDiffMaxChars
  const SESSION_SUMMARY_CACHE_TTL_MS = cfg.sessionSummaryCacheTtlMs
  const SESSION_LIST_CONCURRENCY = cfg.sessionListConcurrency
  const SESSION_EVENT_SCAN_CAP = cfg.sessionEventScanCap
  const SESSION_SEARCH_LIMIT = cfg.sessionSearchLimit
  // Whole-log reads (export / health fold) stop at this many events so a
  // pathological session cannot balloon host memory; the payload flags the
  // truncation instead of hiding it.
  const SESSION_EXPORT_EVENT_CAP = cfg.sessionExportEventCap

 // Older dsh releases (e.g. 0.1.5-rc.2) ship WorkspaceRegistry without the
 // public unarchive verb. That must NOT take the whole plugin down: the
 // delete path skips the archived-set cleanup and the unarchive RPC reports
 // a clear error (see removeFromArchivedSet / sessionAdmin.unarchive). Log a
 // mount-time warning so operators notice the degraded surface. A deployment
 // without the registry at all (CLI / headless — see workspaceRegistryOf)
 // is not a version change: skip the warning entirely.
 const mountRegistry = workspaceRegistryOf(ctx)
 if (mountRegistry !== null && typeof mountRegistry.unarchiveSession !== 'function') {
 ctx.logger?.warn?.('plugin-admin: workspace registry lacks unarchiveSession() — 取消归档与删除时的归档清理将不可用（dsh 版本过旧）')
 }
  // Same loud-fail probe for the persistence seam (list/stat/open).
  assertPersistenceShape(ctx.sessionPersistence)
  // Capture the AgentHandles dsh produces for live agents (see
  // installAgentHandleCapture) so online sessions can be torn down through
  // dsh's official dispose chain before their logs are removed.
  const handleCapture = installAgentHandleCapture(ctx)
  const enqueue = makeSerialQueue()
  // Durable usage ledger for the 用量仪表盘: dsh's own token accounting dies
  // with the session log, so the dashboard kept shrinking whenever history was
  // cleaned up. The ledger keeps one row per session ever seen (see
  // lib/usage-ledger.js) so a deleted session's totals stay in the dashboard.
  const usageLedger = createUsageLedger({
    path: join(dshHome(), 'usage-ledger.json'),
    enqueue,
    // Plugin config row key `usageLedgerCap` (default 2000, clamped to
    // [100, 100000] by resolveLedgerCap) raises how many per-session rows the
    // ledger retains before the oldest `lastSeenAt` is evicted.
    cap: resolveLedgerCap(cfg.usageLedgerCap),
  })

  /* ---------------------- Usage ledger background sweep --------------------- */
  // The dashboard's own read is opportunistic: it only records the sessions
  // that existed while somebody had the panel open, so a session deleted
  // before that still lost its tokens. This sweep folds the WHOLE session
  // table into the ledger on a timer instead, which is what makes retention
  // hold for ordinary cleanup (delete from the sidebar, from the CLI, or from
  // a session that was never opened in the dashboard).
  //
  // Cost is bounded: list() is revision-cached per session, so an idle sweep
  // re-reads nothing and the ledger merge reports `changed: false` (no disk
  // write). Only the very first sweep pays the full read.
  const USAGE_SNAPSHOT_INTERVAL_MS = cfg.usageSnapshotIntervalMs
  /** Grace period before the boot sweep, so it never competes with boot I/O. */
  const USAGE_SNAPSHOT_KICKOFF_MS = 30_000
  /** Last successful sweep (epoch ms); null until one lands. */
  let usageSweepAt = null
  /** Re-entrancy guard: a slow sweep must not stack behind its own timer. */
  let usageSweepRunning = false

  /**
   * One sweep: fold every session's usage into the ledger. Never throws (a
   * failed sweep must not take down a timer callback) — the failure is logged
   * and the next tick retries.
   * @returns {Promise<void>}
   */
  async function sweepUsageLedger() {
    if (usageSweepRunning) return
    usageSweepRunning = true
    try {
      const listResult = await sessionService.list()
      await usageLedger.record(listResult.sessions, { protect: observedIds() })
      usageSweepAt = Date.now()
    } catch (error) {
      ctx.logger?.warn?.('plugin-admin: 用量台账后台快照失败：' + messageOf(error))
    } finally {
      usageSweepRunning = false
    }
  }

  if (USAGE_SNAPSHOT_INTERVAL_MS > 0) {
    // unref on both timers: bookkeeping must never keep the dsh host process
    // alive, and the disposers stop them when the row is disabled or unloaded.
    const intervalTimer = setInterval(() => { void sweepUsageLedger() }, USAGE_SNAPSHOT_INTERVAL_MS)
    intervalTimer.unref?.()
    ctx.effect(() => () => { clearInterval(intervalTimer) }, 'plugin-admin: usage ledger sweep')
    const kickoffTimer = setTimeout(
      () => { void sweepUsageLedger() },
      Math.min(USAGE_SNAPSHOT_INTERVAL_MS, USAGE_SNAPSHOT_KICKOFF_MS),
    )
    kickoffTimer.unref?.()
    ctx.effect(() => () => { clearTimeout(kickoffTimer) }, 'plugin-admin: usage ledger kickoff')
  }

  /* ------------------ Usage ledger live event observer ---------------------
   * The sweep bounds the loss window to one interval; this closes it. A
   * session created, used, and deleted inside that window would otherwise be
   * gone before any read touched it.
   *
   * The harness exposes the per-append firehose (`session/event`), which beats
   * watching $DSH_HOME/sessions outright: it fires AT APPEND TIME (no
   * debounce-vs-delete race, no re-deriving the log path, no parsing a
   * compressed log), and it carries the event payload directly.
   *
   * Ownership rule: only a session whose WHOLE log this process observed is
   * accumulated — `session.firstLiveSeq === 0` at announce time means the log
   * had no seed, so the accumulator IS the session's absolute total. A resumed
   * session carries history we never saw and stays read-owned (the sweep and
   * the dashboard read cover it). Because both writers store ABSOLUTE numbers,
   * no interleaving of read and firehose can double count.
   */
  /** sessionId → the session's absolute usage row, for sessions seen from seq 0. */
  const observedUsage = new Map()
  /** Debounce before an accumulated row reaches the ledger (and the disk). */
  const USAGE_EVENT_FLUSH_MS = 2_000
  /** Observed sessions kept per process; the oldest is dropped past this. */
  const USAGE_OBSERVED_CAP = 500
  /** @type {object|null} */
  let usageEventTimer = null

  /** Queue one debounced flush (a burst of events costs ONE ledger write). */
  function scheduleUsageFlush() {
    if (usageEventTimer !== null) return
    usageEventTimer = setTimeout(() => {
      usageEventTimer = null
      void flushObservedUsage()
    }, USAGE_EVENT_FLUSH_MS)
    usageEventTimer.unref?.()
  }

  /**
   * Write every DIRTY observed session's absolute usage row through the
   * ledger. Partial upsert semantics (`markAbsent: false`): the firehose says
   * nothing about sessions it did not see, so it must never retain them.
   *
   * Only rows that changed since the last successful flush are written, which
   * is what keeps a later flush from resurrecting a session the read path has
   * already flagged `deleted: true` (and keeps an idle process from rewriting
   * the file on every turn boundary).
   * @returns {Promise<void>}
   */
  async function flushObservedUsage() {
    const dirty = []
    for (const row of observedUsage.values()) if (row.dirty === true) dirty.push(row)
    if (dirty.length === 0) return
    try {
      await usageLedger.upsert(dirty)
      for (const row of dirty) row.dirty = false
      usageSweepAt = Date.now()
    } catch (error) {
      // Best-effort: the session log still holds the numbers, so the next
      // sweep (or dashboard read) recovers them. `dirty` stays set, so the
      // next flush retries.
      ctx.logger?.warn?.('plugin-admin: 用量台账事件写入失败：' + messageOf(error))
    }
  }

  /**
   * Ids the live event observer owns. A read must not overwrite their numbers
   * with the log's (possibly older, and cap-truncated) fold — see the
   * ownership rule above.
   * @returns {Set<string>}
   */
  function observedIds() {
    return new Set(observedUsage.keys())
  }

  /**
   * Fold one appended event into its session's accumulator. Unknown sessions
   * are ignored on purpose — they are read-owned (see the ownership rule).
   * @param {object} session - the emitting Session.
   * @param {object} event - the appended SessionEvent ({ type, seq, time, data }).
   */
  function foldUsageEvent(session, event) {
    const row = observedUsage.get(session.id)
    if (row === undefined) return
    if (event.type === 'assistant/message') {
      row.assistantCount += 1
      const usage = event.data?.usage
      if (usage !== null && typeof usage === 'object') {
        row.tokens.input += Number(usage.inputTokens) || 0
        row.tokens.output += Number(usage.outputTokens) || 0
        row.tokens.cacheRead += Number(usage.cacheReadTokens) || 0
        row.tokens.cacheWrite += Number(usage.cacheWriteTokens) || 0
      }
    } else if (event.type === 'user/message') {
      // Same compaction-checkpoint exclusion as deriveSessionSummary: a
      // checkpoint replaces shadowed history instead of adding a turn. dsh
      // 0.1.7 gave compaction its OWN source kind (`compact-checkpoint`);
      // logs written by older hosts carry the retired generic wrapper
      // {kind:'plugin', plugin:'compact'} — exclude both.
      const source = event.data?.source
      if (isCompactionCheckpointSource(source)) return
      row.messageCount += 1
    } else if (event.type === 'session/title') {
      const title = event.data?.title
      if (typeof title !== 'string' || title.trim() === '') return
      row.title = title.trim()
    } else {
      return
    }
    row.dirty = true
    scheduleUsageFlush()
  }

  if (typeof ctx.on === 'function') {
    // A throwing observer must never break session creation, appending, or
    // teardown — every callback contains its own failure.
    ctx.on('session/created', (session) => {
      try {
        if (session === null || typeof session !== 'object' || typeof session.id !== 'string') return
        if (observedUsage.has(session.id)) return
        // firstLiveSeq 0 ⇒ the log started empty in this process, so the
        // accumulator will have seen every event the session ever had.
        if (session.firstLiveSeq !== 0) return
        const header = session.header !== null && typeof session.header === 'object' ? session.header : {}
        observedUsage.set(session.id, {
          id: session.id,
          title: '',
          createdAt: Number(header.createdAt) || Date.now(),
          cwd: typeof header.cwd === 'string' ? header.cwd : null,
          workspaceTitle: null,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          messageCount: 0,
          assistantCount: 0,
          dirty: true,
        })
        if (observedUsage.size > USAGE_OBSERVED_CAP) {
          const oldest = observedUsage.keys().next()
          if (!oldest.done) observedUsage.delete(oldest.value)
        }
      } catch {
        /* observation is best-effort; the sweep still covers this session */
      }
    })
    ctx.on('session/event', (session, event) => {
      try {
        if (session === null || typeof session !== 'object' || event === null || typeof event !== 'object') return
        foldUsageEvent(session, event)
      } catch {
        /* a malformed event must not break the append path */
      }
    })
    // Teardown and turn boundaries are the natural drain points: flush BEFORE
    // the log can be removed, so a session deleted right after its last turn
    // is already in the ledger.
    ctx.on('session/disposed', () => { void flushObservedUsage() })
    ctx.on('session/flush', () => { void flushObservedUsage() })
  }

  function listLayers() {
    const require = requireOf(profileDir)
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const dependencies = new Map(Object.entries(pkg.dependencies ?? {}))
    const bundles = pkg.dsh?.profile?.bundles ?? []
    // Disable-toggle state per plugin: which rows the bundle composes and
    // whether the profile patch disables them all. Read once per listing —
    // the toggle itself re-reads inside the serial queue.
    const { lines: profileLines } = readPatchLines(profileDir)
    const plugins = bundles.map((name) => {
      const manifest = readManifest(require, name)
      const { rowIds } = resolveBundleRowIds(require, name, manifest)
      const disabledRows = rowIds.filter((rowId) => {
        const entry = findRowEntry(profileLines, rowId)
        return entry !== null && entryDisabled(profileLines.slice(entry.entryStart, entry.entryEnd)) === true
      })
      return {
        name,
        version: manifest?.version ?? null,
        dependency: dependencies.has(name),
        removable: dependencies.has(name),
        localPath: localSpecPath(dependencies.get(name)),
        disablable: rowIds.length > 0,
        disabled: rowIds.length > 0 && disabledRows.length === rowIds.length,
      }
    })
    return { profileDir, plugins }
  }

  /* ---------------------- Plugin Admin Remote Service ---------------------- */
  // Remote-update cache: name -> { at, latest } so repeated panel refreshes
  // within the TTL do not re-hit the registry. Only 'latest' is stored; the
  // 'updateAvailable' flag is recomputed on every read against the CURRENT
  // installed version (see checkUpdates) — a still-outdated plugin keeps
  // flagging on each re-open, while one upgraded in between stops flagging.
  // A manual check (force) bypasses this cache and refreshes its content.
  const updateCache = new Map()

  const pluginService = {
    async list() {
      return listLayers()
    },

    /**
     * Check every registry-installed bundle for a newer version on the npm
     * registry (same registry npm/pnpm use). In-box bundles and local-path
     * installs are skipped. Never throws: each entry reports its own
     * `updateAvailable`/`latest`/`error`. Results are cached briefly; a cache
     * hit still recomputes `updateAvailable` against the current installed
     * version so the reminder survives repeated panel opens and clears only
     * once the plugin is actually upgraded.
     * When `force` is true the TTL cache is bypassed and every plugin is
     * re-queried against the registry, refreshing the cached `latest` values —
     * the toolbar 「⬆ 检查更新」button always forces, so a manual check really
     * checks instead of replaying a cached answer.
     * @param force - true to bypass the TTL cache and refresh cached content.
     * @returns { updates, checkedAt } where updates is per-plugin status.
     */
    async checkUpdates(force) {
      // Tolerate the RPC gateway passing the bound boolean or the raw args
      // object ({ force: true }) whichever way it arrives.
      const forceRefresh = force === true
        || (force !== null && typeof force === 'object' && force.force === true)
      const now = Date.now()
      const { plugins } = listLayers()
      const registry = resolveNpmRegistry(profileDir)
      const cached = []
      const todo = []
      for (const plugin of plugins) {
        if (!plugin.dependency || plugin.localPath !== null || plugin.disabled) continue
        // Disabled plugins are skipped on purpose: an update reminder for a
        // row the user turned off is noise, and a stale reminder would survive
        // restarts while the plugin stays disabled.
        const hit = updateCache.get(plugin.name)
        const cacheWarm = !forceRefresh && hit !== undefined && hit.latest !== null
          && now - hit.at < UPDATE_CHECK_CACHE_TTL_MS
        if (cacheWarm) {
          // Serve the cached 'latest' but recompute the flag against the
          // CURRENT installed version with the same semver rule the fresh
          // path uses — a strict inequality here would flag an update for an
          // installed version NEWER than latest (dev/preview builds) or one
          // differing only in build metadata. The cached entry must carry
          // updateAvailable — a bare { name, latest } is read by the client
          // as "up to date", which is why the ⬆ 有新版本 reminder used to
          // vanish on the second open of the panel within the TTL.
          cached.push({
            name: plugin.name,
            version: plugin.version,
            latest: hit.latest,
            updateAvailable: compareSemver(plugin.version, hit.latest) < 0,
          })
        } else {
          todo.push(plugin)
        }
      }
      const fresh = await mapConcurrent(todo, UPDATE_CHECK_CONCURRENCY, async (plugin) => {
        const result = await checkPluginUpdate(registry, plugin)
        if (result.latest !== null) {
          updateCache.set(plugin.name, { at: now, latest: result.latest })
        }
        return result
      })
      const updates = [...cached, ...fresh]
      return { updates, checkedAt: now }
    },

    async install(spec) {
      if (typeof spec !== 'string' || spec.trim() === '') {
        throw new Error('plugin-admin: install requires a spec string')
      }
      const rawOperand = assertPnpmOperand('install spec', spec)
      // A bare `@latest` dist-tag is ambiguous for pnpm when the manifest
      // already pins a satisified range (e.g. "^0.4.2"): pnpm resolves
      // @latest against the range, concludes "Already up to date", and exits
      // 0 WITHOUT fetching the newer published version — the upgrade silently
      // no-ops. Resolve the real latest version from the registry first and
      // pin it exactly so pnpm is forced to bump the constraint and download.
      // The client already sends an exact `name@<version>` when it knows the
      // latest (from checkUpdates); this is the server-side safety net for
      // any caller that still passes `@latest`.
      const operand = rawOperand.endsWith('@latest')
        ? await resolveLatestSpec(profileDir, rawOperand.slice(0, -'@latest'.length))
        : rawOperand
      return enqueue(async () => {
        const before = profileDependencyNames(profileDir)
        const output = await runPnpm(profileDir, ['add', operand])
        reconcileBundles(profileDir)
        const compat = assessInstalledCompat(profileDir, before)
        return { output, compat, ...listLayers() }
      })
    },

    async remove(name) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('plugin-admin: remove requires a package name')
      }
      const operand = assertPnpmOperand('package name', name)
      const dependencies = new Set(Object.keys(
        JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies ?? {},
      ))
      if (!dependencies.has(operand)) {
        throw new Error(`plugin-admin: '${operand}' is not a dependency-managed plugin (in-box bundles are not removable here)`)
      }
      return enqueue(async () => {
        // Capture the bundle's composing rows BEFORE the package leaves
        // node_modules — after pnpm remove its patch is unreadable, and the
        // disable rows this toggle may have authored would linger as garbage.
        const require = requireOf(profileDir)
        const manifest = readManifest(require, operand)
        const { rowIds } = resolveBundleRowIds(require, operand, manifest)
        const output = await runPnpm(profileDir, ['remove', operand])
        // Drop the validated operand (trimmed — the raw RPC `name` with
        // surrounding whitespace would miss the entry and leave behind a
        // phantom bundle the prune step cannot heal: it only removes
        // entries that are still dependencies) and reconcile in one
        // read-modify-write window.
        reconcileBundles(profileDir, operand)
        // Clean up any disable rows the toggle authored for this bundle.
        if (rowIds.length > 0) {
          const { lines, patchPath } = readPatchLines(profileDir)
          const stripped = removeDisableRows(lines, rowIds)
          if (stripped.changed) writePatch(patchPath, stripped.lines)
        }
        return { output, ...listLayers() }
      })
    },

    /**
     * Enable or disable one bundle without uninstalling it: the toggle
     * authors (or removes) profile-layer `disabled: true` rows for every row
     * the bundle's own patch composes. Pure profile-patch write on the shared
     * serial queue — no pnpm, no dependency churn. Takes effect on the next
     * dsh restart (row mounting is a boot-time composition).
     * @param name - the bundle (package) name.
     * @param disabled - true to disable, false to re-enable.
     * @returns { ok, state, rows, ...layers } where state is 'applied' or
     *   'present' (nothing to change).
     */
    async setEnabled(name, disabled) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('plugin-admin: setEnabled requires a package name')
      }
      const operand = assertPnpmOperand('package name', name)
      if (typeof disabled !== 'boolean') {
        throw new Error('plugin-admin: setEnabled requires a boolean disabled flag')
      }
      // In-box bundles (the base / web-app layers) are not profile
      // dependencies and are not the user's to switch off: disabling every
      // composing row of a core bundle would strip the profile's own
      // services. The panel only renders the toggle for dependency-managed
      // plugins (removable); this is the host-side half of the same rule.
      const dependencies = new Set(Object.keys(
        JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies ?? {},
      ))
      if (!dependencies.has(operand)) {
        throw new Error(`plugin-admin: '${operand}' 是内置组合层（非 profile 依赖），不可在此停用/启用`)
      }
      const require = requireOf(profileDir)
      const manifest = readManifest(require, operand)
      const resolved = resolveBundleRowIds(require, operand, manifest)
      if (!resolved.declared) {
        throw new Error(`plugin-admin: '${operand}' 未声明 bundle patch（内置组合层不可在此停用）`)
      }
      if (resolved.error !== null) {
        throw new Error(`plugin-admin: 无法读取 '${operand}' 的 bundle patch：${String(resolved.error)}`)
      }
      const rowIds = resolved.rowIds
      if (rowIds.length === 0) {
        throw new Error(`plugin-admin: '${operand}' 的 bundle patch 没有可停用的组合行`)
      }
      return enqueue(async () => {
        const { lines, patchPath } = readPatchLines(profileDir)
        const result = disabled
          ? upsertDisableRows(lines, rowIds)
          : removeDisableRows(lines, rowIds)
        if (!result.changed) {
          return { ok: true, state: 'present', disabled, rows: rowIds, ...listLayers() }
        }
        writePatch(patchPath, result.lines)
        return { ok: true, state: 'applied', disabled, rows: rowIds, restartRequired: true, ...listLayers() }
      })
    },
  }

  const pluginBinding = Object.freeze({ service: pluginService, serviceKey: PLUGIN_SERVICE_KEY, namespace: PLUGIN_NAMESPACE })
  Object.defineProperty(pluginService, 'typertRemote', { value: pluginBinding, enumerable: false })
  ctx.effect(() => { ctx.provide(PLUGIN_SERVICE_KEY, pluginService) }, 'plugin-admin/pluginAdmin: provide')

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
 * Whether a message source marks a compaction checkpoint (not a user turn).
 * dsh 0.1.7 gave compaction the producer-owned `compact-checkpoint` kind
 * (its `isCompactCheckpointSource`); logs written by older hosts carry the
 * retired generic wrapper {kind:'plugin', plugin:'compact'}. The usage
 * accumulator and the derive-session-summary fold must exclude BOTH.
 * @param source - the message's `source` value (any shape).
 * @returns whether the message is a compaction checkpoint.
 */
function isCompactionCheckpointSource(source) {
  if (source === null || typeof source !== 'object') return false
  if (source.kind === 'compact-checkpoint') return true
  return source.kind === 'plugin' && source.plugin === 'compact'
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

  /* --------------------- Session Admin Remote Service --------------------- */
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
   * @param {object} header - the stored session header.
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
     * @returns { deleted: sessionId }.
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
     * @returns {{ files: number, added: number, removed: number,
     *   branch: string|null, changed: Array<{ path: string, status: string,
     *   added: number, removed: number, absPath?: string, absDir?: string }> }}.
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
     * @returns {{ markdown: string, filename: string, messages: number,
     *   toolCalls: number, truncated: boolean }}.
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
     * @returns {{ diff: string, truncated: boolean }}.
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
     * @returns {{ rows: Array<{ id, title, createdAt, project, input, output,
     *   cacheRead, userMsgs, assistantMsgs, deleted }>, generatedAt: number,
     *   retained: number, storagePath: string|null,
     *   snapshotIntervalMs: number, lastSnapshotAt: number|null }}.
     */
    async usageReport() {
      // Drain the observer first, so the panel never shows numbers older than
      // the events this process already folded.
      await flushObservedUsage()
      const listResult = await this.list()
      const rows = await usageLedger.record(listResult.sessions, { protect: observedIds() })
      // A dashboard read IS a sweep: it stamps the same clock the background
      // timer does, so the panel's "last snapshot" never under-reports.
      usageSweepAt = Date.now()
      return jsonSafe({
        rows,
        generatedAt: Date.now(),
        retained: rows.filter(row => row.deleted === true).length,
        storagePath: usageLedger.storagePath,
        snapshotIntervalMs: USAGE_SNAPSHOT_INTERVAL_MS,
        lastSnapshotAt: usageSweepAt,
      })
    },

    /**
     * Full-text search across the session corpus via the host's sessionQuery
     * service (searchSessions). Returned hits are reshaped into the same
     * header fields the history panel already renders, so results drop
     * straight into the existing rows.
     * @param query - free-text query (may include metadata filters).
     * @returns { ok: true, hits: Array } each { sessionId, title, cwd,
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
     * @returns {{ report, summary }} where report = foldHealthReport output.
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
  ctx.effect(() => { ctx.provide(SESSION_SERVICE_KEY, sessionService) }, 'plugin-admin/sessionAdmin: provide')

  /* ----------------------- FS Admin Remote Service ------------------------ */
  /**
   * Bring the Explorer window showing `path` to the foreground.
   * explorer.exe spawned from a background service has no foreground rights
   * (Windows foreground-lock), so the new window opens behind the active one.
   * This helper runs a PowerShell script that polls for the window and raises
   * it with the classic ALT-key + SetForegroundWindow trick: a simulated ALT
   * keypress makes the system treat the caller as having user input, which
   * grants SetForegroundWindow permission. Fail-soft and never blocks the
   * host loop.
   * @param path - the directory (or file) the Explorer window shows.
   */
  function bringExplorerWindowToFront(path) {
    try {
      // PowerShell's `-File` argv parsing is cruder than CreateProcess
      // quoting: a path token carrying a double quote or control character
      // could break out of its argument boundary before the script's
      // -LiteralPath handling ever sees it. Windows filenames cannot contain
      // those characters, so a path that does was not produced by the
      // filesystem — refuse it instead of spawning.
      if (typeof path !== 'string' || /["\u0000-\u001f]/.test(path)) return
      const helperPath = join(MODULE_DIR, 'bring-explorer.ps1')
      // Windows caveats: the helper must spawn WITHOUT detached and with
      // real stdout/stderr pipes — detached or 'ignore' stdio leaves the
      // child with invalid handles and PowerShell silently fails to start
      // in a non-interactive context. unref() still lets dsh exit freely.
      const child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', helperPath, '-Path', path,
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      child.stdout?.resume()
      child.stderr?.resume()
      child.on('error', () => { /* non-fatal */ })
      child.unref()
    } catch {
      /* non-fatal */
    }
  }


  /**
   * Reveal a filesystem path in the platform file manager.
   * @param path - absolute path to reveal (workspace directory or file).
   * @returns the revealed path.
   */
  const fsService = {
    async reveal(path) {
      if (typeof path !== 'string' || path.trim() === '') {
        throw new Error('fs-admin: reveal requires a path string')
      }
      const trimmed = path.trim()
      // Best-effort: spawn a reveal command without blocking the host loop.
      // Windows: a directory opens its own Explorer window; a file gets
      // /select to reveal it inside its parent folder. macOS: open -R;
      // Linux: xdg-open (no portable 'select' verb).
      let args
      if (process.platform === 'win32') {
        let isDir = false
        try { isDir = statSync(trimmed).isDirectory() } catch { isDir = false }
        args = isDir ? [trimmed] : ['/select,' + trimmed]
      } else if (process.platform === 'darwin') {
        args = ['-R', trimmed]
      } else {
        // Linux: xdg-open on a directory opens it in the file manager; a
        // file has no portable 'select' verb, so its parent is opened.
        let isDir = false
        try { isDir = statSync(trimmed).isDirectory() } catch { isDir = false }
        args = [isDir ? trimmed : dirname(trimmed)]
      }
      const cmd = process.platform === 'win32'
        ? spawn('explorer.exe', args, { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', args, { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', args, { detached: true, stdio: 'ignore' })
      cmd.on('error', () => { /* non-fatal: the user can open the path manually */ })
      cmd.unref()

      // Windows: bring the newly opened Explorer window to the foreground.
      // explorer.exe spawns from a background service have no foreground
      // rights, so the window opens behind the current one. A PowerShell
      // helper polls for the window and uses the classic ALT-key +
      // SetForegroundWindow trick (simulated user input) to raise it.
      if (process.platform === 'win32') {
        try { bringExplorerWindowToFront(trimmed) } catch { /* best-effort */ }
      }
      return { path: trimmed }
    },
  }

  const fsBinding = Object.freeze({ service: fsService, serviceKey: FS_SERVICE_KEY, namespace: FS_NAMESPACE })
  Object.defineProperty(fsService, 'typertRemote', { value: fsBinding, enumerable: false })
  ctx.effect(() => { ctx.provide(FS_SERVICE_KEY, fsService) }, 'plugin-admin/fsAdmin: provide')

  /* ----------------------- MCP Admin Remote Service ----------------------- */
/**
 * Whether a block is an MCP client entry: its lines contain a `name:` row
   * whose value is the MCP plugin name.
   * @param lines - patch file lines.
   * @param block - block span.
   */
  function isMcpBlock(lines, block) {
    for (let i = block.index; i < block.endIndex; i++) {
      if (MCP_NAME_ROW.test(lines[i])) return true
    }
    return false
  }

  /**
   * Every MCP entry in the patch, across BOTH row shapes, in file order.
   *
   * - insert shape (authored by this panel; the loader-compliant one): one
   *   top-level `- insert:` block whose nested item is the entry. Inserting a
   *   NEW entry requires this shape — a bare top-level `- id:` row is an
   *   id-targeted override that the loader silently drops when the base tree
   *   carries no entry with that id, so legacy bare rows (older panel
   *   versions) never composed; they are still read here and upgraded to the
   *   insert shape on their next save.
   * @param lines - patch file lines.
   * @returns [{ span, entryLines }] — the owning top-level block span plus
   *   the entry's own lines normalized to bare-shape indentation (legacy
   *   shape as-is; insert shape with the 4-space wrapper indent stripped).
   */
  function mcpEntryViews(lines) {
    const views = []
    for (const block of topLevelBlocks(lines)) {
      if (!isMcpBlock(lines, block)) continue
      if (/^- insert:/.test(lines[block.index])) {
        const inner = lines.slice(block.index + 1, block.endIndex)
          .map(line => (line.startsWith('    ') ? line.slice(4) : line))
        // A hand-edited insert block may nest several entries; each `- id:`
        // item at the normalized indent starts one view (all sharing the
        // block span — modifications rebuild the block from every view).
        let start = 0
        for (let i = 1; i <= inner.length; i++) {
          const startsEntry = i < inner.length && /^- id:/.test(inner[i] ?? '')
          if (i === inner.length || startsEntry) {
            const entryLines = inner.slice(start, i)
            if (MCP_NAME_ROW.test(entryLines.find(l => /^\s*name:/.test(l)) ?? '')) {
              views.push({ span: block, entryLines })
            }
            start = i
          }
        }
      } else {
        views.push({ span: block, entryLines: lines.slice(block.index, block.endIndex) })
      }
    }
    return views
  }

  /**
   * Wrap bare-shape entry lines in the loader-compliant `- insert:` block.
   * @param entryLines - bare-shape entry lines (from {@link mcpEntryLines}).
   * @returns the full top-level block lines.
   */
  function mcpInsertBlockLines(entryLines) {
    return ['- insert:', ...entryLines.map(line => (line === '' ? line : '    ' + line))]
  }

  /**
   * Extract the entry id (`- id: <id>`) and serverName from normalized entry
   * lines (bare shape; see {@link mcpEntryViews}).
   * @param entryLines - normalized entry lines.
   * @returns { id, serverName } with nulls when absent.
   */
  function blockIdentity(entryLines) {
    let id = null
    let serverName = null
    for (const line of entryLines) {
      const idMatch = /^-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
      if (idMatch) id = idMatch[1]
      const nameMatch = /^\s*serverName:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
      if (nameMatch) serverName = nameMatch[1]
    }
    return { id, serverName }
  }

  // yamlScalar is imported from patch-utils.js

  /** Parse the supported MCP config shape without rewriting unknown blocks. */
  function configFromBlock(entryLines) {
    const config = {}
    let collection = null
    for (const line of entryLines) {
      const field = /^    (transport|serverName|command|url|cwd|toolCallTimeoutMs|failOnStartupError|args|env|headers|reconnect):\s*(.*)$/.exec(line)
      if (field) {
        const key = field[1]
        const value = field[2]
        if (key === 'args') {
          config.args = []
          collection = 'args'
        } else if (key === 'env' || key === 'headers' || key === 'reconnect') {
          config[key] = {}
          collection = key
        } else {
          config[key] = yamlScalar(value)
          collection = null
        }
        continue
      }
      const item = /^      -\s*(.*)$/.exec(line)
      if (item && collection === 'args') {
        const value = yamlScalar(item[1])
        if (typeof value === 'string') config.args.push(value)
        continue
      }
      const property = /^      ([^:]+):\s*(.*)$/.exec(line)
      if (property && collection && collection !== 'args') {
        config[collection][property[1].trim()] = yamlScalar(property[2])
      }
    }
    if (config.transport === 'stdio' && typeof config.serverName === 'string' && typeof config.command === 'string') return config
    if (config.transport === 'streamable-http' && typeof config.serverName === 'string' && typeof config.url === 'string') return config
    return null
  }

  /**
   * Serialize one MCP entry into YAML lines (the exact shape the mcp-client
   * plugin consumes). The entry id is a stable local handle; serverName is the
   * model-facing namespace.
   * @param entry - normalized MCP entry.
   * @returns YAML lines (without trailing newline).
   */
  function mcpEntryLines(entry) {
    const out = []
    out.push('- id: ' + JSON.stringify(entry.id))
    out.push("  name: '@deepseek-ai/dsh-mcp-client'")
    out.push('  config:')
    out.push('    transport: ' + entry.config.transport)
    out.push('    serverName: ' + JSON.stringify(entry.config.serverName))
    if (entry.config.transport === 'stdio') {
      out.push('    command: ' + JSON.stringify(entry.config.command))
      const args = entry.config.args ?? []
      if (args.length > 0) {
        out.push('    args:')
        for (const a of args) out.push('      - ' + JSON.stringify(a))
      }
      const env = entry.config.env ?? {}
      const envKeys = Object.keys(env)
      if (envKeys.length > 0) {
        out.push('    env:')
        for (const k of envKeys) out.push('      ' + k + ': ' + JSON.stringify(env[k]))
      }
      if (entry.config.cwd) out.push('    cwd: ' + JSON.stringify(entry.config.cwd))
    } else {
      out.push('    url: ' + JSON.stringify(entry.config.url))
      const headers = entry.config.headers ?? {}
      const headerKeys = Object.keys(headers)
      if (headerKeys.length > 0) {
        out.push('    headers:')
        for (const k of headerKeys) out.push('      ' + k + ': ' + JSON.stringify(headers[k]))
      }
    }
    if (entry.config.toolCallTimeoutMs !== undefined) {
      out.push('    toolCallTimeoutMs: ' + Number(entry.config.toolCallTimeoutMs))
    }
    if (entry.config.failOnStartupError === true) {
      out.push('    failOnStartupError: true')
    }
    if (entry.config.reconnect && typeof entry.config.reconnect === 'object') {
      out.push('    reconnect:')
      for (const key of ['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts']) {
        if (entry.config.reconnect[key] !== undefined) {
          out.push('      ' + key + ': ' + JSON.stringify(entry.config.reconnect[key]))
        }
      }
    }
    return out
  }

  /**
   * List the MCP entries currently declared in the profile patch file (both
   * row shapes; legacy bare rows are reported with `legacy: true` so the
   * panel can flag them as not actually mounted).
   * @returns { entries, patchPath }.
   */
  function listMcpEntries() {
    const { lines, patchPath } = readPatchLines(profileDir)
    const entries = []
    for (const view of mcpEntryViews(lines)) {
      const { id, serverName } = blockIdentity(view.entryLines)
      if (id === null) continue
      const config = configFromBlock(view.entryLines)
      entries.push({
        id,
        serverName: config?.serverName ?? serverName ?? id,
        config,
        legacy: !/^- insert:/.test(lines[view.span.index] ?? ''),
        raw: lines.slice(view.span.index, view.span.endIndex).join('\n'),
      })
    }
    return { entries, patchPath }
  }

  /** The plugin package every composed MCP row imports from the profile root. */
  const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

  /**
   * Hot-apply an updated MCP entry config to the live dsh-mcp-client fiber —
   * the loader's own "validate and apply new config, then restart the plugin"
   * path (`fiber.update(config, noSave=true)`), the same seam the hooks
   * bridge restart rides. noSave=true: this plugin already authored the patch
   * row, and a host-side save could reformat the file out from under it. The
   * fiber is matched by serverName, which upsert keeps unique across entries,
   * and matched by the entry's PREVIOUS serverName so a rename still finds
   * the running server. Never throws — the outcome rides back to the panel,
   * which claims "无需重启" only when applied is true.
   * @param {string|null} previousServerName - serverName before this save.
   * @param {object} cfg - the new config (the patch row's config mapping).
   * @returns {Promise<{ applied: boolean, reason?: string }>}
   */
  async function hotApplyMcpEntry(previousServerName, cfg) {
    const fibers = []
    try {
      const registry = ctx.registry
      if (registry === undefined || typeof registry.entries !== 'function') return { applied: false, reason: '宿主 registry 不可用' }
      for (const [, runtime] of registry.entries()) {
        const name = String(runtime?.name ?? '')
        if (name !== 'dsh-mcp-client' && name !== MCP_CLIENT_PACKAGE) continue
        for (const fiber of runtime?.fibers ?? []) {
          if (fiber !== undefined && fiber !== null && typeof fiber.update === 'function') fibers.push(fiber)
        }
      }
    } catch (error) {
      return { applied: false, reason: error instanceof Error ? error.message : String(error) }
    }
    if (fibers.length === 0) return { applied: false, reason: 'dsh-mcp-client 尚未挂载，需重启 dsh 后装载' }
    const fiber = fibers.find((f) => {
      const live = f?.entry?.options?.config ?? f.config
      return live !== null && typeof live === 'object' && live.serverName === previousServerName
    })
    if (fiber === undefined) {
      return { applied: false, reason: `运行中的 server 中未找到 ${previousServerName ?? cfg.serverName}（可能本次启动前尚未装载）` }
    }
    try {
      await fiber.update(cfg, true)
      return { applied: true }
    } catch (error) {
      return { applied: false, reason: `热应用失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const mcpService = {
    async list() {
      return listMcpEntries()
    },

    async upsert(entry) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id === '') {
        throw new Error('mcp-admin: upsert requires an entry with a non-empty id')
      }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(entry.id)) {
        throw new Error('mcp-admin: entry id must match [A-Za-z0-9_-]{1,64}')
      }
      const cfg = entry.config
      if (cfg === null || typeof cfg !== 'object' || typeof cfg.transport !== 'string'
        || (cfg.transport !== 'stdio' && cfg.transport !== 'streamable-http')) {
        throw new Error('mcp-admin: config.transport must be \'stdio\' or \'streamable-http\'')
      }
      if (typeof cfg.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(cfg.serverName)) {
        throw new Error('mcp-admin: serverName must match [A-Za-z0-9_-]{1,32}')
      }
      if (cfg.transport === 'stdio' && (typeof cfg.command !== 'string' || cfg.command === '')) {
        throw new Error('mcp-admin: stdio entries require a command')
      }
      if (cfg.transport === 'streamable-http' && (typeof cfg.url !== 'string' || cfg.url === '')) {
        throw new Error('mcp-admin: streamable-http entries require a url')
      }
      // Nested fields (args/env/headers/cwd/timeouts/reconnect) are validated
      // HERE at the write boundary — the serializer writes whatever it is
      // handed, and dsh's load-time schema would only reject a bad row at the
      // next profile boot.
      validateMcpConfig(cfg)
      // Patch-file mutations ride the same serialized operation queue as
      // pluginAdmin: the body is fully synchronous today (the event loop
      // already serializes it), but the queue keeps the read-modify-write
      // atomic if an await ever lands inside — and the duplicate-serverName
      // check then sees the queue-time file state, not a stale snapshot.
      return enqueue(async () => {
        // A composed MCP row imports `@deepseek-ai/dsh-mcp-client` from the
        // profile root; without the dependency the profile fails to boot the
        // tree. Install it BEFORE authoring the row (the bridgeInstall
        // pattern): a failed install leaves the patch file untouched.
        const dep = await ensureProfileDependency(profileDir, MCP_CLIENT_PACKAGE, runPnpm, () => reconcileBundles(profileDir), harnessLockstepVersion(profileDir))
        const packageInstalled = dep.state === 'installed'
        const { lines, patchPath } = readPatchLines(profileDir)
        const views = mcpEntryViews(lines)
        const duplicateServer = views.find(view => {
          const identity = blockIdentity(view.entryLines)
          return identity.id !== entry.id && identity.serverName === cfg.serverName
        })
        if (duplicateServer !== undefined) {
          throw new Error(`mcp-admin: serverName '${cfg.serverName}' is already used by another MCP entry`)
        }
        const target = views.find(view => blockIdentity(view.entryLines).id === entry.id)
        const entryLines = mcpEntryLines(entry)
        let next
        if (target !== undefined) {
          // Replace the entry in place. Sibling entries sharing its top-level
          // block (only possible in a hand-edited multi-entry insert block)
          // are rebuilt beside it, in their original order.
          const siblings = views.filter(view => view !== target && view.span === target.span)
            .map(view => mcpInsertBlockLines(view.entryLines))
          const blockLines = siblings.length > 0
            ? [...mcpInsertBlockLines(entryLines), ...siblings.flat()]
            : mcpInsertBlockLines(entryLines)
          next = [...lines.slice(0, target.span.index), ...blockLines, ...lines.slice(target.span.endIndex)]
        } else {
          const blockLines = mcpInsertBlockLines(entryLines)
          // Append after the last entry. The file may carry a header comment
          // plus a '[]' placeholder (an empty YAML list) — a complete document
          // that must be replaced, not appended after (appending produces a
          // second document and a YAML parse error at profile boot). See
          // appendTopLevelBlocks.
          next = appendTopLevelBlocks(lines, [blockLines])
        }
        writePatch(patchPath, next)
        // Update of an EXISTING entry: hot-apply the new config to the live
        // server fiber so no restart is needed. A NEW entry still needs one —
        // mounting a fresh plugin fiber is the loader's boot job, not
        // something a per-fiber update can do.
        let hot = { applied: false, reason: '新增条目：需重启 dsh 挂载新 server' }
        if (target !== undefined) {
          const previous = blockIdentity(target.entryLines)
          hot = await hotApplyMcpEntry(previous.serverName ?? cfg.serverName, cfg)
        }
        return {
          ok: true,
          id: entry.id,
          entries: listMcpEntries().entries,
          hotApplied: hot.applied,
          ...(hot.reason !== undefined ? { hotReason: hot.reason } : {}),
          ...(packageInstalled ? { packageInstalled: true } : {}),
        }
      })
    },

    async remove(id) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: remove requires an entry id')
      }
      return enqueue(async () => {
        const { lines, patchPath } = readPatchLines(profileDir)
        const views = mcpEntryViews(lines)
        const target = views.find(view => blockIdentity(view.entryLines).id === id)
        if (target === undefined) {
          throw new Error(`mcp-admin: entry '${id}' not found in ${PROFILE_PATCH_FILENAME}`)
        }
        // Sibling entries sharing the top-level block survive the removal.
        const siblings = views.filter(view => view !== target && view.span === target.span)
          .map(view => mcpInsertBlockLines(view.entryLines))
        const next = [
          ...lines.slice(0, target.span.index),
          ...siblings.flat(),
          ...lines.slice(target.span.endIndex),
        ].join('\n').trimEnd() + '\n'
        writePatch(patchPath, next)
        return { ok: true, id, entries: listMcpEntries().entries }
      })
    },

    /**
     * Probe the connectivity of one configured MCP server (by entry id) from
     * the host, without requiring a dsh restart. The probe mirrors the real
     * dsh-mcp-client handshake (initialize → initialized → tools/list) over
     * the entry's configured transport, with a strict timeout so a dead
     * endpoint fails fast instead of hanging the panel.
     * @param id - MCP entry id.
     * @returns a probe result (never rejects):
     *   { ok: true, serverInfo, toolCount, transport, ms, pingOk? } or
     *   { ok: false, error, transport, ms, stderr? }.
     */
    async test(id) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: test requires an entry id')
      }
      const entry = listMcpEntries().entries.find(entry => entry.id === id)
      if (entry === undefined) {
        throw new Error(`mcp-admin: entry '${id}' not found in ${PROFILE_PATCH_FILENAME}`)
      }
      if (entry.config === null || entry.config === undefined) {
        throw new Error(`mcp-admin: entry '${id}' has an unparsable config; fix ${PROFILE_PATCH_FILENAME} manually`)
      }
      return probeMcpServer(entry.config)
    },

    /**
     * Invoke one tool on a configured MCP server (by entry id) — the host
     * gesture behind the panel's MCP playground (tools/call after the same
     * initialize → tools/list handshake the probe performs). Rides
     * probeMcpServer's per-call budget, so a dead endpoint fails fast.
     * @param id - MCP entry id.
     * @param tool - tool name to invoke (must be offered by the server).
     * @param args - tool arguments object (MCP requires an object; {} when omitted).
     * @returns never rejects: { ok: true, value: normalized toolCall result }
     *   or { ok: false, error } (invalid input / unknown entry still throws,
     *   matching test()).
     */
    async callTool(id, tool, args) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: callTool requires an entry id')
      }
      if (typeof tool !== 'string' || tool === '') {
        throw new Error('mcp-admin: callTool requires a tool name')
      }
      if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
        throw new Error('mcp-admin: callTool args must be a JSON object')
      }
      const entry = listMcpEntries().entries.find(entry => entry.id === id)
      if (entry === undefined) {
        throw new Error(`mcp-admin: entry '${id}' not found in ${PROFILE_PATCH_FILENAME}`)
      }
      if (entry.config === null || entry.config === undefined) {
        throw new Error(`mcp-admin: entry '${id}' has an unparsable config; fix ${PROFILE_PATCH_FILENAME} manually`)
      }
      const probe = await probeMcpServer(entry.config, { tool, arguments: args === undefined ? {} : args })
      if (!probe.ok || probe.toolCall === undefined) {
        return { ok: false, error: probe.error !== undefined ? probe.error : 'tools/call returned no result' }
      }
      return { ok: true, value: probe.toolCall }
    },
  }

  const mcpBinding = Object.freeze({ service: mcpService, serviceKey: MCP_SERVICE_KEY, namespace: MCP_NAMESPACE })
  Object.defineProperty(mcpService, 'typertRemote', { value: mcpBinding, enumerable: false })
  ctx.effect(() => { ctx.provide(MCP_SERVICE_KEY, mcpService) }, 'plugin-admin/mcpAdmin: provide')

  /* ---------------------- Subagent Admin (merged) -------------------------- */
  // Mount the subagentAdmin remote (formerly the standalone dsh-plugin-subagents
  // plugin). It shares this apply's serial queue: mcpAdmin and subagentAdmin
  // both read-modify-write the profile's cordis.patch.yml. The typert registry
  // allows ONE registration per package name, so the subagent invocations ride
  // the unified descriptor below instead of registering their own.
  const subagentInvocations = applySubagentAdmin(ctx, enqueue)

  /* -------------------- Command & Hook Admin (merged) --------------------- */
  // Mount the commandHookAdmin remote (formerly the standalone
  // dsh-command-hook-admin plugin): live slash commands + hooks.json
  // management, plus one-click install/uninstall of the stock hooks bridge
  // package. Bridge install/remove touches package.json and cordis.patch.yml,
  // so it rides the same serial queue and pnpm runner as pluginAdmin above.
  const commandHookInvocations = applyCommandHookAdmin(ctx, {
    enqueue,
    runPnpm,
    reconcileBundles: () => reconcileBundles(profileDir),
    settings: config,
  })

  /* ---------------------- Project .agents Commands ------------------------ */
  // Scoped per-agent registration of <projectRoot>/.agents/commands/*.md
  // (Claude-Code-format markdown commands). No remote surface of its own in
  // M1 — project/list arrives with the panel work.
  applyProjectAgents(ctx, { settings: config })

  /* ------------------------ Project .agents Hooks ------------------------- */
  // Per-session project-level Claude-Code command hooks (.agents/hooks.json,
  // or the hooks key of .agents/settings.json) on the interception points.
  // Requires the shell service for hook execution. applyProjectAdmin mounts
  // the read-only projectAdmin remote the panel's 项目 tab calls.
  applyProjectHooks(ctx, { settings: config })
  const projectInvocations = applyProjectAdmin(ctx)

  /* ---------------------- Webhook Inbound Triggers ------------------------- */
  // HTTP endpoint for POST deliveries, per-rule secret verification, steer
  // existing sessions / delegate creation to dsh-webhook when present.
  const webhookAdminInvocations = applyWebhookAdmin(ctx, {
    enqueue,
    runPnpm,
    reconcileBundles: () => reconcileBundles(profileDir),
    settings: config,
  })

  /* ---------------------------- Cron Admin ------------------------------- */
  // Host-level 5-field cron scheduler over the same dsh-home JSON storage
  // model as webhookAdmin. Actions reuse the webhook pipeline (steer a live
  // session, or a SessionRequest the webhook runtime turns into a new
  // session). Fires only while the dsh process is alive; missed fires are
  // not backfilled. Rides the same serial queue so task writes cannot
  // interleave with other patch/JSON writes.
  const cronAdminInvocations = applyCronAdmin(ctx, { enqueue, settings: config })


  /* ---------------------- Runtime Overlay Admin --------------------------- */
  // One-click enablement of full-text session search, which the shipped web
  // composition mounts OFF (base row `openAt: never`). Pure profile-patch
  // writes on the same serial queue.
  const overlayInvocations = applyOverlayAdmin(ctx, { enqueue })

  /* --------------------------- Workspace Admin ---------------------------- */
  // Workspace CRUD + per-workspace session bookkeeping + the global archive
  // set, over the dsh host's `ctx.workspaceRegistry` (`@deepseek-ai/dsh-workspace`).
  // The directory picker rides `ctx.directoryPicker` when one is mounted;
  // CLI / headless deployments fall back to manual path entry on the panel.
  const workspaceInvocations = applyWorkspaceAdmin(ctx)

  /* ---------------------------- Skills Admin ------------------------------- */
  // The merged, read-only skill roster of this deployment: the registry's
  // global layer unioned, by name, with one read per distinct (cwd,
  // agent-preset) scope resolved from the requested sessions. Mounted by
  // every bundle that mounts `@deepseek-ai/dsh-skill`.
  const skillsInvocations = applySkillsAdmin(ctx)

  /* -------------------------- Web Search Admin ---------------------------- */
  // Selector + install/uninstall for the three dsh web-search providers.
  // Provider activation lives in `cordis.patch.yml`'s `web.config.searchProvider`
  // — the panel mutates that single key in place, then appends/removes the
  // cordis row + npm dependency for opt-in providers. Rides the same serial
  // queue and pnpm runner as pluginAdmin / mcpAdmin so its patch writes and
  // `pnpm add` cannot interleave with theirs.
  const webSearchInvocations = applyWebSearchAdmin(ctx, { enqueue, runPnpm, reconcileBundles: () => reconcileBundles(profileDir) })

  /* ---------------------------- Workflow Engine ---------------------------- */
  // ZCode 风格动态工作流：agent 现场写 TS 脚本 → esbuild 转译 → 受限沙箱执行
  // → 子代理并行 + ctx.jobs 后台运行 + amend/resume + saved 库。subagents 是
  // 硬依赖，缺失时本模块降级（不阻止其余面板）。状态持久化到
  // $DSH_HOME/workflows/runs/，写盘走同一个串行队列。
  const workflowInvocations = applyWorkflowAdmin(ctx, { enqueue })


  /* ---------------------- Typert Descriptors Register ---------------------- */
  const specParam = [{ name: 'spec', wire: 'spec', source: 'json', codec: { mode: 'src-json' } }]
  const nameParam = [{ name: 'name', wire: 'name', source: 'json', codec: { mode: 'src-json' } }]
  const forceParam = [{ name: 'force', wire: 'force', source: 'json', codec: { mode: 'src-json' } }]
  const sessionParam = [{ name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'src-json' } }]

  ctx.effect(() => ctx.typert.register({
    package: PACKAGE,
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      // pluginAdmin
      {
        id: `${PACKAGE}/list`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'list',
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/install`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'install',
        invocation: { kind: 'direct' },
        parameters: specParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/remove`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'remove',
        invocation: { kind: 'direct' },
        parameters: nameParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/checkUpdates`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'checkUpdates',
        invocation: { kind: 'direct' },
        parameters: forceParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/setEnabled`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'setEnabled',
        invocation: { kind: 'direct' },
        parameters: [
          { name: 'name', wire: 'name', source: 'json', codec: { mode: 'src-json' } },
          { name: 'disabled', wire: 'disabled', source: 'json', codec: { mode: 'src-json' } },
        ],
        result: { mode: 'src-json' },
      },
      // sessionAdmin
      {
        id: `${PACKAGE}/session/list`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'list',
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/session/archive`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'archive',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/session/unarchive`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'unarchive',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/session/deleteSession`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'deleteSession',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/session/closeSession`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'closeSession',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      // sessionAdmin.fileStats — the todo dock footer's file-change stats
      {
        id: `${PACKAGE}/session/fileStats`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'fileStats',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      // sessionAdmin.exportSession — readable Markdown transcript download
      {
        id: `${PACKAGE}/session/exportSession`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'exportSession',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      // sessionAdmin.gitDiff — the todo dock copy-diff button's payload
      {
        id: `${PACKAGE}/session/gitDiff`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'gitDiff',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      // sessionAdmin.usageReport — the VibeUsage-style dashboard payload
      {
        id: `${PACKAGE}/session/usageReport`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'usageReport',
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'src-json' },
      },
      // sessionAdmin.searchSessions — full-text session search
      {
        id: `${PACKAGE}/session/searchSessions`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'searchSessions',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'query', wire: 'query', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
      // sessionAdmin.healthReport — per-session diagnostic fold
      {
        id: `${PACKAGE}/session/healthReport`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'healthReport',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      // fsAdmin
      {
        id: `${PACKAGE}/fs/reveal`,
        service: FS_SERVICE_KEY,
        namespace: FS_NAMESPACE,
        method: 'reveal',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'path', wire: 'path', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
      // mcpAdmin
      {
        id: `${PACKAGE}/mcp/list`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'list',
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/mcp/upsert`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'upsert',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'entry', wire: 'entry', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/mcp/remove`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'remove',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/mcp/test`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'test',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
      // mcpAdmin.callTool — the MCP playground's invoke gesture
      {
        id: `${PACKAGE}/mcp/callTool`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'callTool',
        invocation: { kind: 'direct' },
        parameters: [
          { name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } },
          { name: 'tool', wire: 'tool', source: 'json', codec: { mode: 'src-json' } },
          { name: 'args', wire: 'args', source: 'json', codec: { mode: 'src-json' } },
        ],
        result: { mode: 'src-json' },
      },
      // subagentAdmin (merged from dsh-plugin-subagents)
      ...subagentInvocations,
      // commandHookAdmin (merged from dsh-command-hook-admin)
      ...commandHookInvocations,
      // projectAdmin (project .agents read-only view)
      ...projectInvocations,
      // webhookAdmin (webhook inbound trigger rules)
      ...webhookAdminInvocations(),
      // cronAdmin (host-level cron task scheduler)
      ...cronAdminInvocations,
      // overlayAdmin (one-click full-text search enablement)
      ...overlayInvocations,
      // workspaceAdmin (workspace CRUD + per-session archive/unarchive)
      ...workspaceInvocations(),
      // skillsAdmin (session-addressed skill catalog list)
      ...skillsInvocations(),
      // webSearchAdmin (provider selector + install/uninstall for 3 dsh web-search providers)
      ...webSearchInvocations(),
      // workflowAdmin (dynamic workflow engine: runs lifecycle + saved library)
      ...workflowInvocations(),
    ],
    }), 'plugin-admin: typert descriptors (plugins, sessions, fs, mcp, subagents, commands+hooks, webhooks, overlays, inventory, workspaces, skills, web-search, workflows)')
}

