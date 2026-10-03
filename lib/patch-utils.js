/**
 * Shared utilities for cordis.patch.yml manipulation and profile resolution.
 *
 * Extracted from index.js, subagent-admin.js, command-hook-admin.js, and
 * webhook-triggers.js to eliminate the four divergent copies of
 * topLevelBlocks / yamlScalar / profileDirOf / dshHome and the cross-module
 * coupling of ensureProfileDependency / harnessLockstepVersion (formerly
 * defined in command-hook-admin.js but imported by webhook-triggers.js and
 * index.js for unrelated purposes).
 *
 * Zero dsh imports on purpose: everything rides the live Cordis Context.
 *
 * Hot-apply helper (G1): `hotApplyFiberConfig()` centralizes the loader-owned
 * `fiber.update(config, noSave=true)` seam used by MCP + hooks-bridge restarts.
 * The seam stays internal until dsh publishes a config-patch hot-apply API;
 * the helper only adds capability probing + restart-hint fallback so callers
 * cannot claim success when the seam is gone.
 *
 * @module dsh-plugin-admin/patch-utils
 */

import { chmodSync, closeSync, copyFileSync, existsSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync, writeSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/* ========================================================================== */
/*                          dsh Home Resolution                               */
/* ========================================================================== */

/**
 * Expand a leading `~` the way @deepseek-ai/dsh-home-paths does: `~` alone is
 * the OS home; `~/` / `~\` prefixes resolve the remainder against it.
 * @param {string} value - a path that may start with `~`.
 * @returns {string} the expanded path.
 */
function expandHomePath(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * One-line message for a thrown value, for surfaces that show it verbatim.
 * Host modules used to carry byte-identical private copies of this; it lives
 * here with the other shared helpers so the wording can only drift once.
 * @param {unknown} error
 * @returns {string}
 */
export function messageOf(error) {
  /** @type {Record<string, any>|null} */
  const boxed = error !== null && typeof error === 'object' ? /** @type {Record<string, any>} */ (error) : null
  return boxed !== null && typeof boxed.message === 'string' ? boxed.message : String(error)
}

/**
 * Resolve the dsh home directory: a non-empty `$DSH_HOME` wins (tilde-expanded
 * and resolved, matching resolveDshHome), otherwise `~/.dsh`.
 *
 * Boundary note: the host's `resolveDshHome(configured?, env)` has ONE channel
 * this reader cannot see — an explicit `configured` override passed in by
 * several host service rows (`config.dshHome`). A deployment using those
 * overrides roots SOME host services elsewhere while this plugin's own stores
 * (usage-ledger / cron / webhook / audit / workflows) still follow the env-or-
 * default root resolved here. Session-log paths diverge fail-loud (the delete
 * containment refuses), but the plugin's own files land beside the env root.
 * @returns {string} the absolute harness home path.
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(expandHomePath(fromEnv))
  return join(homedir(), '.dsh')
}

/* ========================================================================== */
/*                        Profile Directory Resolution                        */
/* ========================================================================== */

/**
 * Resolve the profile directory from the loader's config-tree anchor.
 *
 * The loader's baseUrl is the cordis.yml anchor; the profile's package.json
 * sits beside it (or the anchor already is the directory). This is the
 * canonical implementation — the former divergent copies in webhook-triggers
 * (node_modules index search) and the three identical copies in index.js,
 * subagent-admin.js, and command-hook-admin.js have been consolidated here.
 *
 * @param {string} baseUrl - the loader config-tree anchor (file: URL or path string).
 * @returns the profile directory holding package.json.
 * @throws {Error} when package.json cannot be located beside the anchor.
 */
export function profileDirOf(baseUrl) {
  const anchor = typeof baseUrl === 'string' && baseUrl.startsWith('file:')
    ? fileURLToPath(baseUrl)
    : String(baseUrl)
  // Direct hit: the anchor itself holds a package.json.
  if (existsSync(join(anchor, 'package.json'))) return anchor
  // When the anchor is inside node_modules (e.g. the plugin's own module
  // path), walk up to the directory that contains the node_modules tree —
  // that is the profile root.
  const nmIdx = anchor.indexOf('node_modules')
  if (nmIdx !== -1) {
    const profileRoot = anchor.slice(0, nmIdx).replace(/[/\\]+$/, '')
    if (profileRoot !== '' && existsSync(join(profileRoot, 'package.json'))) return profileRoot
  }
  // Standard fallback: the parent of the cordis.yml anchor.
  const parent = dirname(anchor)
  if (existsSync(join(parent, 'package.json'))) return parent
  throw new Error(`plugin-admin: no profile package.json beside config anchor ${String(baseUrl)}`)
}

/* ========================================================================== */
/*                       cordis.patch.yml Line Helpers                        */
/* ========================================================================== */

/**
 * Match one list-item id line: `- id: value` (bare top-level row when indent
 * is empty, nested insert entry otherwise). Deeper mapping keys (`id:` without
 * the dash) never match, so config payloads cannot false-positive. The value
 * must run to end of line (optionally quoted, optionally trailing comment).
 * Shared by overlay-admin (the search-override row) and pluginAdmin (bundle row
 * discovery for the disable toggle).
 * @param {string} line - one patch file line.
 * @returns {{ indent: string, id: string } | null} parsed identity or null.
 */
export function matchRowIdLine(line) {
  const match = /^(\s*)- id:\s*(?:(['"])([^'"]+)\2|([^\s'#]+))\s*(?:#.*)?$/.exec(line)
  if (match === null) return null
  return { indent: match[1], id: match[3] ?? match[4] ?? '' }
}

/**
 * Every top-level patch block as { index, endIndex } spans. A top-level block
 * is a line starting with `- ` (a list item at column 0); the span runs to the
 * next top-level item or the file end.
 * @param {string[]} lines - patch file lines.
 * @returns {{ index: number, endIndex: number }[]} block spans.
 */
export function topLevelBlocks(lines) {
  const blocks = []
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^- /.test(lines[i])) {
      if (start !== -1) blocks.push({ index: start, endIndex: i })
      start = i
    }
  }
  if (start !== -1) blocks.push({ index: start, endIndex: lines.length })
  return blocks
}

/**
 * Unquote one YAML scalar the way the plugin writes them: try JSON.parse first
 * (handles numbers, booleans, null, and double-quoted strings), then fall back
 * to stripping single/double quotes, then return the raw text.
 *
 * A trailing YAML comment is stripped first: `#` preceded by whitespace and
 * not inside a quoted run starts a comment (`value # note` → `value`), so a
 * hand-edited line's annotation never pollutes the parsed value. `#` without
 * leading whitespace stays literal (URLs, `name#frag`). Inside a
 * double-quoted run a backslash escapes the next character (`\"` does not
 * close the run) — the plugin writes strings via JSON.stringify, so escaped
 * quotes are the common shape and misjudging them used to truncate the value.
 * A mismatched quote pair disables stripping for the whole scalar — an
 * unterminated quote is a broken line and the raw text is the honest answer.
 * @param {string} value - the raw scalar text.
 * @returns {string|number|boolean|null} the parsed value.
 */
export function yamlScalar(value) {
  let text = value.trim()
  /** @type {'"'|"'"|null} */
  let quote = null
  let wellFormed = true
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote !== null) {
      // YAML double-quote escaping: `\"` is a literal quote inside a
      // double-quoted run. Without this skip a `\"` pair closes the run
      // early, the next `"` reopens it, and a ` #` landing between the two
      // misjudged boundaries is stripped as a comment — truncating the
      // value on read-back while the on-disk YAML (js-yaml) reads it whole.
      if (quote === '"' && ch === '\\') { i++; continue }
      if (ch === quote) {
        // YAML single-quote escaping: '' inside '...' is a literal quote.
        if (quote === "'" && text[i + 1] === "'") i++
        else quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#' && i > 0 && /\s/.test(text[i - 1])) {
      text = text.slice(0, i).trim()
      break
    }
  }
  if (quote !== null) wellFormed = false
  if (wellFormed) {
    try {
      return JSON.parse(text)
    } catch {
      const quoted = /^['"](.*)['"]$/.exec(text)
      return quoted ? quoted[1] : text
    }
  }
  return text
}

/**
 * Split the inside of an inline mapping (`config: { a: 1, b: 'x:y' }`) into
 * `[key, valueText]` pairs. Commas split only at the top level — one inside a
 * quoted run or a nested `{}`/`[]` stays in the value — and each pair is cut
 * at its FIRST top-level colon, so a value that itself contains one (a URL,
 * a `!!js` ternary, a time) survives instead of being dropped. Keys come back
 * unquoted; a part with no top-level colon is skipped.
 *
 * This is the shared rewrite rule for the panels that convert an inline
 * `config: {...}` into block form: a patch replaces the target's whole
 * `config`, so every sibling key has to be re-emitted verbatim.
 * @param {string} body - the text between the braces.
 * @returns {Array<[string, string]>} key/value pairs in source order.
 */
export function inlineMapEntries(body) {
  const parts = []
  let start = 0
  /** @type {'"'|"'"|null} */
  let quote = null
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  const entries = []
  for (const part of parts) {
    const cut = topLevelColonAt(part)
    if (cut === -1) continue
    const key = part.slice(0, cut).trim().replace(/^['"]|['"]$/g, '')
    if (key === '') continue
    entries.push(/** @type {[string, string]} */ ([key, part.slice(cut + 1).trim()]))
  }
  return entries
}

/**
 * Index of the first `:` in `text` that sits outside quotes and nesting, or
 * -1. Split out of {@link inlineMapEntries} so both scans read alike.
 * @param {string} text - one comma-separated mapping part.
 * @returns {number}
 */
function topLevelColonAt(text) {
  /** @type {'"'|"'"|null} */
  let quote = null
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
    else if (ch === ':' && depth === 0) return i
  }
  return -1
}

/* ========================================================================== */
/* Patch File I/O & Entry Grammar */
/* ========================================================================== */

/** The profile-layer patch file every admin module read-modify-writes. */
export const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/**
 * Read the profile patch file: the raw text, its lines, and its path. A
 * missing file reads as an empty patch (the callers author the first row).
 * @param {string} profileDir - the profile directory.
 * @returns {{ text: string, lines: string[], patchPath: string }}
 */
export function readPatchLines(profileDir) {
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
  const text = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  return { text, lines: text.split(/\r?\n/), patchPath }
}

/**
 * The `[start, end)` span of one TOP-LEVEL patch row keyed by `- id: <id>`,
 * or null when absent. The span is the row's whole top-level block (up to the
 * next top-level list item), so a following `- insert:` block never leaks
 * into it. The id compares after unquoting and trailing-comment stripping
 * (matchRowIdLine rules), so `- id: 'web'` and `- id: web # note` match too.
 * Shared by the owner-namespace patch writers (webSearchAdmin today; formerly
 * storageAdmin and webSearchAdmin, and before them three divergent local
 * copies — the third belonged to the since-removed agent-preset namespace —
 * whose span overran into subsequent `- insert:` blocks and whose raw-text
 * id match missed quoted/commented rows).
 * @param {string[]} lines - patch file lines.
 * @param {string} id - the row id to find.
 * @returns {{ start: number, end: number }|null}
 */
export function findRowSpan(lines, id) {
  for (const block of topLevelBlocks(lines)) {
    const match = matchRowIdLine(lines[block.index] ?? '')
    if (match !== null && match.indent === '' && match.id === id) {
      return { start: block.index, end: block.endIndex }
    }
  }
  return null
}

/** Suffix of the rolling previous-revision copy kept beside the patch file. */
export const PATCH_BACKUP_SUFFIX = '.dsh-admin.bak'

/** How long a lock may stay before another process may reclaim it. */
const LOCK_STALE_MS = 30_000
/** How long a writer waits for a live lock before running anyway (fail-open). */
const LOCK_WAIT_MS = 3_000
/** Poll interval while waiting. */
const LOCK_POLL_MS = 25
/** Backoff after stealing a lock (plus up to LOCK_POLL_MS of jitter). */
const LOCK_STEAL_BACKOFF_MS = 5
/** A lock younger than this is never stolen while its owner is unreadable. */
const LOCK_GRACE_MS = 250

/** Monotonic per-process counter behind {@link tempPathFor}. */
let tempWriteCounter = 0

/**
 * Atomic full-file write with tightened permissions: unique temp sibling +
 * rename (see tempPathFor / atomicRename), created 0o600. Every store riding
 * this recipe may hold credentials (webhook secrets, MCP env/headers, audit
 * payloads, workflow scripts), so the file aligns with the host's own
 * credential storage (dsh-credentials-local: 0o600 files, 0o700 dirs).
 * Windows ignores the mode (ACLs take over); on Unix it keeps same-machine
 * other users out. One helper = one place this rationale lives.
 * @param {string} path - target file path.
 * @param {string} text - the complete next content.
 */
export function writeTextAtomic(path, text) {
  const temp = tempPathFor(path)
  writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 })
  atomicRename(temp, path)
}

/**
 * Serialize (2-space indent + trailing newline) and write atomically — the
 * canonical shape of every JSON store this plugin owns.
 * @param {string} path - target file path.
 * @param {*} value - JSON-safe value.
 */
export function writeJsonAtomic(path, value) {
  writeTextAtomic(path, JSON.stringify(value, null, 2) + '\n')
}

/**
 * Best-effort tighten to owner-only. `mode` in `writeFileSync` applies only at
 * CREATION, so a file that already existed (an older build, a copied template,
 * a hand-made config) keeps its old permissions — callers pass this after
 * writing or copying something that can hold a credential. On Windows the call
 * is a no-op that may throw, hence the swallow.
 * @param {string} path - the file to tighten.
 */
export function chmodPrivate(path) {
  try { chmodSync(path, 0o600) } catch { /* Windows, or a filesystem without modes */ }
}

/**
 * The sibling temp path ONE write uses. It must be unique per write: a fixed
 * `<target>.dsh-admin.tmp` let instance B overwrite the payload instance A was
 * about to rename into place — A then installed B's content, and B's own rename
 * threw ENOENT out of the caller's RPC. pid + a per-process counter cannot
 * collide (two live processes never share a pid). Exported because every store
 * in this plugin uses the same temp+rename recipe and had the same flaw.
 * @param {string} targetPath - the file being replaced.
 * @returns {string} the temp path to write and rename from.
 */
export function tempPathFor(targetPath) {
  tempWriteCounter += 1
  return targetPath + '.' + process.pid + '.' + tempWriteCounter + '.dsh-admin.tmp'
}

/**
 * Lock paths this process currently HOLDS. The reentrancy guard, not a cache:
 * membership is added only by a section that won the lock file and removed on
 * its way out, so `has()` answers "is an enclosing section of mine holding this
 * right now" — which is the whole basis on which a nested call may skip
 * acquiring (see {@link withFileLock}).
 */
const heldLockPaths = new Set()

/**
 * Cross-process advisory lock around a read-modify-write of one file
 * (Phase F1). The panel's own serial queue only orders THIS process; two dsh
 * instances on one profile would otherwise both read the patch, both edit and
 * both rename — last writer wins, the other edit silently gone.
 *
 * Deliberate properties:
 *   - fail-open: after LOCK_WAIT_MS the operation runs anyway. The atomic
 *     temp+rename still prevents a torn file; the lock only prevents lost
 *     updates, and refusing to write would be worse than a lost update
 *     (the user asked for the change now).
 *   - stale-safe: a lock older than LOCK_STALE_MS, or whose pid is gone, is
 *     reclaimed, so a crashed instance cannot wedge the profile.
 *   - synchronous: every writer here is synchronous, and Atomics.wait gives a
 *     real sleep without spinning the CPU.
 *
 * It only prevents lost updates when the critical section ALSO covers the read:
 * wrapping the rename alone (as `writePatch` did in the first cut of F1) leaves
 * both instances free to read the same revision first. Read-modify-write callers
 * use {@link mutatePatch} / {@link mutateProfilePatch}, which hold this lock
 * across read → transform → write.
 *
 * **Reentrant within this process.** A nested call on the SAME file from inside
 * a live section runs `fn` directly: the enclosing section already holds the
 * lock, so exclusion is already guaranteed — the nested one neither burns the
 * LOCK_WAIT_MS budget failing open (it would silently run CONCURRENTLY with the
 * section that owns the lock, which is the bug this replaces) nor releases the
 * lock file on its way out (the outer section still needs it).
 *
 * That is a different property from the fail-open above, and the two do not
 * overlap: fail-open answers "ANOTHER PROCESS holds it", reentrancy answers "WE
 * already do". A nested call on a DIFFERENT file is ordinary contention and
 * takes the normal path.
 *
 * Reentrancy is granted only to a section that actually won the lock file. A
 * section that failed OPEN owns nothing, so it is not registered as a holder and
 * a nested call inside it falls back to fail-open rather than inheriting an
 * exclusion it does not have.
 *
 * The guard is a module-level Set, which is sound only because the critical
 * section is synchronous by contract (see {@link mutatePatch}). An async `fn`
 * unregisters and releases as soon as it returns its promise — exactly when the
 * lock file was released before this guard existed, so that contract violation
 * degrades no further than it already did.
 * @param {string} targetPath - the file being guarded (the lock is its sibling).
 * @param {() => any} fn - the critical section.
 * @returns {any} whatever fn returned.
 */
export function withFileLock(targetPath, fn) {
  const lockPath = targetPath + '.dsh-admin.lock'
  // Reentrant fast path: an enclosing section of OURS already holds this lock,
  // so there is nothing to acquire and nothing to release. Taking the normal
  // path here instead would burn the whole wait budget and then fail open —
  // running this section concurrently with the very section that owns the lock.
  if (heldLockPaths.has(lockPath)) return fn()
  const deadline = Date.now() + LOCK_WAIT_MS
  /** @type {number|null} */
  let handle = null
  for (;;) {
    try {
      handle = openSync(lockPath, 'wx')
      writeSync(handle, JSON.stringify({ pid: process.pid, at: Date.now() }))
      break
    } catch (error) {
      // We may have created the file and then failed to write the pid: remove
      // our own half-lock rather than making the next caller wait out the stale
      // window for it. (If open() itself threw, handle is still null and the
      // file belongs to someone else.)
      if (handle !== null) {
        try { closeSync(handle) } catch { /* already closed */ }
        try { unlinkSync(lockPath) } catch { /* another instance reclaimed it */ }
        handle = null
      }
      if (!isLockContention(error)) throw error
    }
    // Fail-open check FIRST, so a reclaim storm (two contenders stealing each
    // other's lock) still honours the budget instead of looping on steals.
    if (Date.now() >= deadline) break   // fail-open: see the doc comment
    // Stealing retries with a small jittered backoff: retrying instantly let two
    // processes ping-pong the same lock file at full CPU.
    if (reclaimStaleLock(lockPath)) {
      sleepSync(LOCK_STEAL_BACKOFF_MS + Math.floor(Math.random() * LOCK_POLL_MS))
      continue
    }
    sleepSync(LOCK_POLL_MS)
  }
  // Register ONLY a section that actually won the lock file. A fail-open
  // section (handle === null) owns nothing, so a nested call inside it must not
  // inherit an exclusion it does not have — it falls back to fail-open.
  if (handle !== null) heldLockPaths.add(lockPath)
  try {
    return fn()
  } finally {
    if (handle !== null) {
      heldLockPaths.delete(lockPath)
      try { closeSync(handle) } catch { /* already closed */ }
      try { unlinkSync(lockPath) } catch { /* another instance reclaimed it */ }
    }
  }
}

/**
 * Drop a lock nobody can still be holding: older than the stale window, or
 * owned by a pid that no longer exists.
 * @param {string} lockPath - the lock file.
 * @returns {boolean} whether the lock was reclaimed (the caller retries once).
 */
function reclaimStaleLock(lockPath) {
  try {
    const info = statSync(lockPath)
    const age = Date.now() - info.mtimeMs
    if (age < LOCK_STALE_MS) {
      // Fresh: only a DEAD owner justifies stealing it.
      let owner = 0
      try { owner = Number(JSON.parse(readFileSync(lockPath, 'utf8')).pid) } catch { owner = 0 }
      if (owner === process.pid) return false
      if (owner > 0) {
        try {
          process.kill(owner, 0)
          return false
        } catch (error) {
          if (!ownerProbeProvesDeath(error)) return false
          // ESRCH: the owner is gone, fall through and reclaim.
        }
      } else if (age < LOCK_GRACE_MS) {
        // No readable owner yet. A lock file looks exactly like this between
        // `open(…, 'wx')` and the pid write, so stealing one this young would
        // put two writers inside at once — wait it out instead.
        return false
      }
    }
    unlinkSync(lockPath)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a FAILED owner-liveness probe (`process.kill(owner, 0)`) actually
 * proves the owner is dead. Only such a failure may let a fresh lock be stolen.
 *
 * **EPERM is the reason this function exists.** It means the process EXISTS and
 * this process may not signal it — the exact opposite of death. On Windows every
 * probe of a process owned by another user or by SYSTEM reports EPERM: measured
 * on a windows-latest box, `System` (pid 4), `csrss.exe`, `wininit.exe` and
 * `services.exe` all throw EPERM, while a genuinely dead pid throws ESRCH. POSIX
 * behaves the same way for another user's pid (pid 1 as non-root).
 *
 * The old bare catch (which swallowed every errno as "dead owner") read EPERM
 * as death and therefore stole a LIVE lock from a LIVE writer — the one outcome this function must never
 * produce, and the one that turns the lock into a source of lost updates rather
 * than a cure for them. Reachable whenever two dsh instances share one profile
 * and one of them runs elevated.
 *
 * An unidentifiable failure counts as ALIVE: refusing to steal a live lock costs
 * at most the 3s fail-open wait, whereas stealing one costs a lost update, and a
 * truly wedged lock is still reaped by the LOCK_STALE_MS window (a crashed owner
 * ages out on mtime alone, no probe involved).
 *
 * Exported so the mapping is pinned by a test rather than by this comment.
 * @param {unknown} error - the value caught from `process.kill(owner, 0)`.
 * @returns {boolean} true only when the failure identifies a dead owner.
 */
export function ownerProbeProvesDeath(error) {
  const code = error === null || typeof error !== 'object' ? undefined : /** @type {any} */ (error).code
  return code === 'ESRCH'
}

/**
 * Whether a failed `open(lockPath, 'wx')` means "another writer holds it" (wait)
 * rather than "this lock is broken" (throw).
 *
 * EEXIST is the documented answer, but WINDOWS does not stop there: while another
 * process is creating or deleting the lock file, the same open() reports EPERM,
 * EACCES or EBUSY. Treating only EEXIST as contention let those escape as an
 * uncaught exception out of `withFileLock` — observed as
 * `scripts/verify-cron-admin.mjs exited 1` with `path: '…cron-tasks.json.dsh-admin.lock'`
 * on the windows-latest / Node 22 CI leg, i.e. a real defect in the lock that the
 * cross-process test surfaced rather than a flaky assertion.
 *
 * Everything else (ENOSPC, EISDIR, EROFS, …) is a real failure and still throws.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isLockContention(error) {
  const code = error === null || typeof error !== 'object' ? undefined : /** @type {any} */ (error).code
  return code === 'EEXIST' || code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

/**
 * Synchronous sleep, so the lock can guard synchronous writers.
 * @param {number} ms - milliseconds to block.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Transient rename refusals: another handle (indexer, AV scanner, watcher)… */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
/** Attempts before a refusal is treated as real. */
const RENAME_ATTEMPTS = 5

/**
 * `renameSync` with a bounded retry for the transient Windows sharing
 * violation. Windows refuses a rename while any other handle still holds the
 * freshly written file — a virus scanner, the search indexer, an editor's
 * watcher — and the same rename succeeds microseconds later. Observed in this
 * repo's own gate as `EPERM: operation not permitted, rename
 * '<patch>.3388.7.dsh-admin.tmp' -> '<patch>'` under host-check (one failure,
 * then three clean runs of the same code).
 *
 * Retrying is safe: a failed rename leaves the source file untouched, so the
 * retry sees exactly the state a fresh attempt would. Every other errno (a
 * missing temp file, a read-only directory) is rethrown immediately.
 * @param {string} from - the temp file to consume.
 * @param {string} to - the file to replace.
 */
export function atomicRename(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      const code = error !== null && typeof error === 'object' ? String(/** @type {any} */ (error).code ?? '') : ''
      if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) throw error
      sleepSync(10 * attempt)
    }
  }
}

/**
 * Restart one live loader fiber with a new config without rewriting the
 * profile patch file (G1 hot-apply helper).
 *
 * Both MCP entry edits and hooks-bridge reloads ride the loader's own
 * "validate and apply new config, then restart the plugin" path
 * (`fiber.update(config, noSave)` — the same callback the loader installs for
 * `internal/update`; see vendor loader `_patchContext`). `noSave=true` because
 * this plugin already authored the patch row and a host-side save could
 * reformat the file out from under it.
 *
 * The helper never throws: a missing seam reports `applied:false` with a
 * restart hint so the panel can fall back honestly instead of claiming
 * "无需重启/已生效".
 * @param {Record<string, any>|null|undefined} fiber - live fiber (or null).
 * @param {Record<string, any>} config - the new config mapping.
 * @returns {Promise<{ applied: boolean, reason?: string }>} hot-apply outcome.
 */
export async function hotApplyFiberConfig(fiber, config) {
  if (fiber === null || fiber === undefined) {
    return { applied: false, reason: '运行中的 fiber 不存在，需重启 dsh 后装载' }
  }
  if (typeof fiber.update !== 'function') {
    return { applied: false, reason: '宿主 fiber.update 不可用，需重启 dsh 生效' }
  }
  try {
    await fiber.update(config, true)
    return { applied: true }
  } catch (error) {
    return { applied: false, reason: `热应用失败：${messageOf(error)}` }
  }
}

/**
 * Write the next revision with the caller ALREADY holding the lock: both the
 * temp write and the rename live inside the critical section, so a concurrent
 * writer can neither steal our temp payload nor observe a half-written file.
 * @param {string} patchPath - patch file path.
 * @param {string | string[]} content - next content or next lines.
 */
function writePatchHoldingLock(patchPath, content) {
  const text = Array.isArray(content) ? content.join('\n').replace(/\n*$/, '\n') : content
  const temp = tempPathFor(patchPath)
  // 0600, like the audit trail and the webhook rule store: this file holds
  // whatever an operator wrote into a plugin row — web-search provider API keys,
  // MCP `env` / `headers`, hook commands — and a rename carries the TEMP's mode
  // onto the destination, so this is what the profile patch ends up with.
  writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 })
  try {
    // After the temp write (a failed one rotates nothing) and before the rename
    // (so the copy is still the replaced revision).
    if (existsSync(patchPath)) {
      try {
        copyFileSync(patchPath, patchPath + PATCH_BACKUP_SUFFIX)
        // copyFileSync mirrors the SOURCE's mode, and the file being replaced may
        // predate this rule (or have been created by hand): tighten the backup
        // explicitly rather than inherit a world-readable revision.
        chmodPrivate(patchPath + PATCH_BACKUP_SUFFIX)
      } catch {
        // Best-effort: a missing backup must not block the write it guards.
      }
    }
    atomicRename(temp, patchPath)
  } catch (error) {
    // A failed rename must not leave this write's temp payload behind.
    try { unlinkSync(temp) } catch { /* already renamed, or nothing to remove */ }
    throw error
  }
}

/**
 * Persist the patch file atomically (temp + rename), keeping the revision the
 * write replaces at `patchPath + PATCH_BACKUP_SUFFIX`. The profile patch is
 * boot-critical (a parse error there stops the host) and the line editors
 * above operate on hand-editable text, so a misjudged rewrite must stay
 * recoverable — every writer inherits that here, not per call site.
 *
 * This form receives content that was ALREADY computed, so it cannot protect
 * the read that produced it. Prefer {@link mutatePatch} for anything derived
 * from this file; use this only when the content comes from somewhere else.
 * @param {string} patchPath - patch file path.
 * @param {string | string[]} content - next content or next lines.
 */
export function writePatch(patchPath, content) {
  return withFileLock(patchPath, () => writePatchHoldingLock(patchPath, content))
}

/**
 * The profile patch path of one profile directory.
 * @param {string} profileDir - the profile directory.
 * @returns {string} the profile's cordis.patch.yml path.
 */
export function profilePatchPath(profileDir) {
  return join(profileDir, PROFILE_PATCH_FILENAME)
}

/**
 * Locked read-modify-write over one patch file (Phase F1, corrected). Taking
 * the lock only around the rename was not enough: the caller's read happened
 * outside it, so two instances still read the same revision, both edited it and
 * the second rename discarded the first edit. The lock has to span the whole
 * read → transform → write.
 *
 * `mutate` is SYNCHRONOUS by contract: the critical section holds a cross-process
 * lock (and sleeps with Atomics.wait while waiting for it), so awaiting inside
 * would stall every other writer for as long as the await took. It receives the
 * current lines and returns `{ next, value }`:
 *   - `next` — the content to persist (lines, or the joined text a few call
 *     sites already build); null/undefined writes nothing (the callback decided
 *     there is nothing to change);
 *   - `value` — whatever the caller wants back, returned as `result.value`.
 * A missing file reads as `['']`, exactly like {@link readPatchLines}.
 * @param {string} patchPath - the patch file to mutate.
 * @param {(lines: string[]) => { next?: string[]|string|null, value?: any }|null|undefined} mutate - the synchronous mutation.
 * @returns {{ changed: boolean, value: any, lines: string[]|string }}
 */
export function mutatePatch(patchPath, mutate) {
  return withFileLock(patchPath, () => {
    const lines = existsSync(patchPath) ? readFileSync(patchPath, 'utf8').split(/\r?\n/) : ['']
    const outcome = mutate(lines)
    if (outcome === null || outcome === undefined) return { changed: false, value: undefined, lines }
    const next = outcome.next
    if (next === null || next === undefined) return { changed: false, value: outcome.value, lines }
    writePatchHoldingLock(patchPath, next)
    return { changed: true, value: outcome.value, lines: next }
  })
}

/**
 * {@link mutatePatch} over one profile's own patch file.
 * @param {string} profileDir - the profile directory.
 * @param {(lines: string[]) => { next?: string[]|string|null, value?: any }|null|undefined} mutate - the synchronous mutation.
 * @returns {{ changed: boolean, value: any, lines: string[]|string }}
 */
export function mutateProfilePatch(profileDir, mutate) {
  return mutatePatch(profilePatchPath(profileDir), mutate)
}

/**
 * Append canonical top-level blocks, tolerating the `[]` empty-list
 * placeholder (same hazard the MCP panel documents: appending below a bare
 * `[]` produces a second YAML document and a boot parse error).
 * @param {string[]} lines - current patch lines.
 * @param {string[][]} blocks - canonical top-level blocks to append.
 * @returns {string[]} next patch lines.
 */
export function appendTopLevelBlocks(lines, blocks) {
  const flat = blocks.flat()
  let placeholder = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '[]') { placeholder = i; break }
  }
  if (placeholder !== -1) {
    return [...lines.slice(0, placeholder), ...flat, ...lines.slice(placeholder + 1)]
  }
  const trimmed = lines.join('\n').trimEnd()
  const base = trimmed === '' ? [] : trimmed.split('\n')
  return [...base, ...flat]
}

/**
 * The exclusive end of one list entry: the next sibling list item at the same
 * indent, or the enclosing block's end when none.
 * @param {string[]} lines - patch file lines.
 * @param {number} start - the entry's own `- id:` line index.
 * @param {number} limit - the enclosing block's exclusive end index.
 * @param {string} indent - the entry's id-line indent.
 * @returns {number} the entry's exclusive end index.
 */
export function entryEndAt(lines, start, limit, indent) {
  for (let i = start + 1; i < limit; i++) {
    const sibling = /^(\s*)- /.exec(lines[i])
    if (sibling !== null && sibling[1] === indent) return i
  }
  return limit
}

/**
 * The `disabled:` scalar inside the entry (at the entry's OWN key indent —
 * id-line indent + 2 canonically, +4 in some hand-edited files — with the
 * +2 shape always accepted so the toggle's canonical insert reads back), or
 * undefined. Anything DEEPER is nested payload (e.g. a `disabled:` key
 * inside a config block) and must never read as the entry's own flag: the
 * enable/disable toggle would misjudge the whole row.
 * @param {string[]} entryLines - the entry's own lines.
 * @returns {boolean | undefined}
 */
export function entryDisabled(entryLines) {
  const idMatch = /^(\s*)- id:/.exec(entryLines[0] ?? '')
  const idIndent = idMatch !== null ? idMatch[1] : ''
  // The first mapping key at one of the two own-key indents fixes the
  // entry's key indent; keys deeper than that belong to nested payloads.
  /** @type {string|null} */
  let keyIndent = null
  for (const line of entryLines.slice(1)) {
    const keyMatch = /^(\s*)([^\s#][^:]*):/.exec(line)
    if (keyMatch === null) continue
    if (keyMatch[1] === idIndent + '  ' || keyMatch[1] === idIndent + '    ') {
      keyIndent = keyMatch[1]
      break
    }
  }
  const ownIndents = [idIndent + '  ', ...(keyIndent !== null && keyIndent !== idIndent + '  ' ? [keyIndent] : [])]
  for (const line of entryLines.slice(1)) {
    const keyMatch = /^(\s*)([^\s#][^:]*):(.*)$/.exec(line)
    if (keyMatch === null || !ownIndents.includes(keyMatch[1])) continue
    if (keyMatch[2] !== 'disabled') continue
    const value = yamlScalar(keyMatch[3])
    if (typeof value === 'boolean') return value
  }
  return undefined
}

/**
 * Canonicalize a directory path before handing it to `fs.watch`. On Windows
 * libuv aborts the process (`!_wcsnicmp(filename, dir, dirlen)` in
 * src/win/fs-event.c) when the watched path's text form differs from the one
 * the kernel reports in fs events — watching through an 8.3 short name
 * (`C:\Users\RUNNER~1\...`) while events carry the long form is the common
 * case (env-derived paths like TEMP/DSH_HOME can carry either). Resolving to
 * the real path first makes the two spellings identical. Falls back to the
 * input when resolution fails — a missing directory then surfaces on
 * `watch()` itself, as before.
 * @param {string} dir - the directory that will be watched.
 * @returns {string} the canonical path to pass to fs.watch.
 */
export function canonicalWatchPath(dir) {
  try {
    return realpathSync.native(dir)
  } catch {
    return dir
  }
}

/**
 * One serial queue: operations run one at a time, in submission order, and a
 * rejected operation never blocks the next. The host passes its single
 * instance into every admin module's apply() via `options.enqueue`; the
 * fallback keeps modules usable stand-alone (tests).
 * @returns {<T>(operation: () => Promise<T>) => Promise<T>}
 */
export function makeSerialQueue() {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve()
  return (operation) => {
    const run = tail.then(operation, operation)
    tail = run.catch(() => {})
    return run
  }
}

/* ========================================================================== */
/* pnpm operand whitelist (moved here from plugin-admin.js)                    */
/* ========================================================================== */

/**
 * Characters permitted in a pnpm install/remove operand. Single-token
 * operands only: package names, scoped names (@scope/name), version
 * suffixes (^1.2.3, ~1.2.3, name@*), git URLs (git+https://...#ref), and
 * drive-letter/UNC/POSIX paths. Every cmd.exe separator, redirect, and
 * expansion character is excluded by construction — including <, >, =, |,
 * &, %, !, quotes, backticks, parens, braces, commas, and whitespace (the
 * >/< semver range forms like >=1.0.0 are multi-token and would already be
 * split by the shell, so dropping them loses nothing real). On Windows
 * runPnpm (lib/plugin-admin.js) spawns through shell:true (pnpm ships as a
 * .cmd shim), so the operand is one token of the joined command line —
 * metacharacters here would be the difference between pnpm and a second
 * command. `^` is admitted because `^1.2.3`-style ranges are legitimate
 * operand content; pnpmSpawnArgs doubles it on win32 so cmd.exe unescapes
 * it back before pnpm sees the token.
 *
 * LIVES HERE, not beside the RPC call sites: `ensureProfileDependency`
 * assembles operands from an INSTALLED package's own manifest (its
 * peerDependencies keys and version field), which is attacker-shaped when
 * that package is hostile — and the RPC call sites' assertions never see
 * those strings. One allowlist beside the one runner both paths share.
 */
const PNPM_OPERAND_ALLOWED = /^[A-Za-z0-9@/_.:\\^~*=+#-]+$/

/**
 * Validate one pnpm operand and return it trimmed. Refuses leading dashes
 * (an operand must never masquerade as a pnpm flag) and any character
 * outside the allowlist (a whole class of shell metacharacters is rejected
 * at once instead of a hand-maintained blocklist of separators).
 * @param {string} field - human label for the error message (e.g. 'install spec').
 * @param {string} value - raw operand from the RPC boundary.
 * @returns the trimmed, validated operand.
 * @throws {Error} when the operand is a flag or carries shell metacharacters.
 */
export function assertPnpmOperand(field, value) {
  const operand = value.trim()
  if (/^-/.test(operand)) {
    throw new Error('plugin-admin: ' + field + ' \'' + operand.slice(0, 48) + '\' looks like a CLI flag')
  }
  if (!PNPM_OPERAND_ALLOWED.test(operand)) {
    throw new Error('plugin-admin: ' + field + ' carries shell metacharacters — only package specs, version ranges, and local paths are accepted')
  }
  return operand
}

/* ========================================================================== */
/* Profile Dependency Management */
/* ========================================================================== */

/**
 * Whether a package is listed as a direct dependency in the profile manifest.
 * @param {string} profileDir - the profile directory.
 * @param {string} packageName - the package name to check.
 * @returns {boolean}
 */
export function profileDependencyInstalled(profileDir, packageName) {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    return packageName in (pkg.dependencies ?? {})
  } catch {
    return false
  }
}

/**
 * The spec string for a direct dependency, or undefined when not listed.
 * @param {string} profileDir - the profile directory.
 * @param {string} packageName - the package name to look up.
 * @returns {string|undefined}
 */
export function manifestDependencySpec(profileDir, packageName) {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    return pkg.dependencies?.[packageName]
  } catch {
    return undefined
  }
}

/**
 * The `@deepseek-ai/dsh-*` peerDependencies an INSTALLED package declares.
 * dsh profiles pin `autoInstallPeers: false`, so a dsh plugin's peers
 * resolve only when the profile lists them as direct dependencies.
 * @param {string} profileDir - the profile directory.
 * @param {string} packageName - the installed package whose peers to complete.
 * @returns {string[]} peer package names.
 */
function dshPeerNames(profileDir, packageName) {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'node_modules', packageName, 'package.json'), 'utf8'))
    return Object.keys(pkg.peerDependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/dsh-'))
  } catch {
    return []
  }
}

/**
 * The version of an installed package, for pinning its peers in lockstep.
 * @param {string} profileDir
 * @param {string} packageName
 * @returns {string|undefined}
 */
function installedVersion(profileDir, packageName) {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'node_modules', packageName, 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

/**
 * The host's own node_modules link spec for a dsh peer, when the host checkout
 * is reachable from the launcher binary path.
 * @param {string} peerName - the `@deepseek-ai/dsh-*` peer to resolve.
 * @returns {string|undefined} a `link:` spec, or undefined when not found.
 */
export function hostPeerLinkSpec(peerName) {
  try {
    const bin = process.argv[1]
    if (typeof bin !== 'string' || bin === '') return undefined
    let dir = dirname(bin)
    for (let depth = 0; depth < 6; depth++) {
      const candidate = join(dir, 'node_modules', peerName)
      // A path with whitespace would be split into multiple tokens by the
      // win32 shell:true pnpm spawn (the operand is never quoted) — skip the
      // host-link preference instead of writing an override pnpm cannot act
      // on; the plain registry install below still runs.
      if (existsSync(candidate) && !/\s/.test(candidate)) return 'link:' + candidate.split('\\').join('/')
      dir = dirname(dir)
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Write a pnpm override for a peer package into the profile's package.json.
 * The read-modify-write holds the same cross-process file lock as the patch
 * writers (Phase F1): without it, two dsh instances installing peers
 * concurrently could each rewrite the whole manifest and lose the other's
 * edit (package.json is whole-file JSON, unlike the line-surgery patch).
 * @param {string} profileDir - the profile directory.
 * @param {string} peerName - the peer package name.
 * @param {string} spec - the override spec (e.g. `link:/path/to/pkg`).
 */
export function writePnpmOverride(profileDir, peerName, spec) {
  const manifestPath = join(profileDir, 'package.json')
  withFileLock(manifestPath, () => {
    try {
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const overrides = pkg.pnpm?.overrides ?? {}
      if (overrides[peerName] === spec) return
      pkg.pnpm = { ...pkg.pnpm, overrides: { ...overrides, [peerName]: spec } }
      const temp = tempPathFor(manifestPath)
      writeFileSync(temp, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
      atomicRename(temp, manifestPath)
    } catch {
      // An unwritable manifest leaves the plain add fallback in charge.
    }
  })
}

/**
 * Drop a `pnpm.overrides` entry that pins a peer to a `link:` path which no
 * longer exists. ensureProfileDependency writes host-checkout link overrides
 * so the profile resolves the exact build the running host executes against;
 * when that checkout later moves or is deleted, the stale override keeps
 * failing the profile's own `pnpm install`. Pruning before the registry
 * fallback makes the fallback path self-healing instead of waiting for the
 * next host-copy pass to rewrite the override.
 * @param {string} profileDir - the profile directory.
 * @param {string} peerName - the peer whose override to prune.
 * @returns {boolean} whether a stale override was removed.
 */
export function pruneStalePnpmOverride(profileDir, peerName) {
  const manifestPath = join(profileDir, 'package.json')
  let removed = false
  withFileLock(manifestPath, () => {
    try {
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const spec = pkg.pnpm?.overrides?.[peerName]
      if (typeof spec !== 'string' || !spec.startsWith('link:')) return
      if (existsSync(spec.slice('link:'.length))) return
      const overrides = { ...pkg.pnpm.overrides }
      delete overrides[peerName]
      if (Object.keys(overrides).length === 0) {
        const pnpm = { ...pkg.pnpm }
        delete pnpm.overrides
        if (Object.keys(pnpm).length === 0) delete pkg.pnpm
        else pkg.pnpm = pnpm
      } else {
        pkg.pnpm = { ...pkg.pnpm, overrides }
      }
      const temp = tempPathFor(manifestPath)
      writeFileSync(temp, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
      atomicRename(temp, manifestPath)
      removed = true
    } catch {
      // An unreadable/unwritable manifest surfaces through the caller's own
      // add step; pruning stays best-effort.
    }
  })
  return removed
}

/**
 * Resolve the exact harness lockstep version from the profile's existing
 * `@deepseek-ai/dsh-*` dependency spec.
 * @param {string} profileDir - the profile directory.
 * @returns {string|undefined} the exact version string, or undefined.
 */
export function harnessLockstepVersion(profileDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const dependencies = pkg.dependencies ?? {}
    for (const [name, spec] of Object.entries(dependencies)) {
      if (!name.startsWith('@deepseek-ai/dsh-') || typeof spec !== 'string') continue
      const exact = /^(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(spec.trim())
      if (exact !== null) return exact[1]
    }
  } catch {
    // An unreadable manifest has no version to derive — the caller falls back.
  }
  return undefined
}

/**
 * Ensure a package is a direct dependency of the profile, installing it via
 * the host pnpm runner when missing (the bridgeInstall pattern). Installing
 * BEFORE authoring the patch row keeps the invariant "no row whose package
 * cannot import": a failed install leaves the profile untouched. After any
 * install, the package's `@deepseek-ai/dsh-*` peers are completed at the
 * same version; peers complete on the present path too, healing profiles
 * broken by older bare installs.
 * @param {string} profileDir - the profile directory.
 * @param {string} packageName - the npm package name.
 * @param {(dir: string, args: string[]) => Promise<string>} runPnpm - runner.
 * @param {(() => void) | null} reconcileBundles - optional bundle-list sync.
 * @param {string | undefined} version - exact version to pin.
 * @returns {Promise<{ state: 'present' | 'installed', output: string }>}
 */
export async function ensureProfileDependency(profileDir, packageName, runPnpm, reconcileBundles = null, version = undefined) {
  /**
   * One tolerant add. Every operand this function ever builds — the caller's
   * package spec and, below, the `${peer}@${peerVersion}` pairs assembled from
   * an installed manifest — funnels through here, so the whitelist holds on
   * this internal path exactly as it does at the RPC call sites.
   * @param {string} spec
   * @param {string} name
   */
  const add = async (spec, name) => {
    const operand = assertPnpmOperand('pnpm operand', spec)
    try {
      return await runPnpm(profileDir, ['add', operand])
    } catch (error) {
      // pnpm v11 exits non-zero when a run newly installs native packages
      // whose build scripts are not approved (ERR_PNPM_IGNORED_BUILDS) even
      // though the add itself completed and mutated the manifest. Treat it
      // as success ONLY when the dependency actually landed; a genuine
      // failure (or a tolerated-looking one without the dep) still throws.
      const text = String(error)
      if (!text.includes('ERR_PNPM_IGNORED_BUILDS') || !profileDependencyInstalled(profileDir, name)) throw error
      return text
    }
  }
  const outputs = []
  let installed = false
  if (!profileDependencyInstalled(profileDir, packageName)) {
    outputs.push(await add(version === undefined ? packageName : `${packageName}@${version}`, packageName))
    installed = true
  }
  // Best-effort per peer: a peer the runtime closure never imports can fail
  // without breaking the plugin; one that IS imported surfaces in dsh's boot
  // error by name, and a retry completes it (each pass is idempotent).
  const peerVersion = version ?? installedVersion(profileDir, packageName)
  for (const peer of dshPeerNames(profileDir, packageName)) {
    // A hostile manifest can carry metacharacters in a peerDependencies KEY.
    // Skip it before it reaches an override row or the command line — a peer
    // name is never worth an operand the whitelist would reject.
    if (!PNPM_OPERAND_ALLOWED.test(peer)) continue
    // Host-copy preference: pin through overrides AND link the dep, so the
    // profile resolves the exact build the running host executes against.
    const hostSpec = hostPeerLinkSpec(peer)
    // The link target is a filesystem path the whitelist must also accept
    // (an `&` inside a directory name is a legal path but a second command
    // on the cmd.exe line): an unusable host spec skips the whole branch,
    // override included, rather than writing one no pnpm can act on.
    if (hostSpec !== undefined && PNPM_OPERAND_ALLOWED.test(hostSpec)) {
      writePnpmOverride(profileDir, peer, hostSpec)
      if (manifestDependencySpec(profileDir, peer) === hostSpec) continue
      try {
        outputs.push(await add(hostSpec, peer))
        installed = true
      } catch {
        // Fall through to the registry path below; a failed host link is
        // no worse than the plain install it replaces.
      }
      if (manifestDependencySpec(profileDir, peer) === hostSpec) continue
    }
    // A stale link override (host checkout moved/deleted since an earlier
    // pass) would fail the registry add below — prune it first.
    pruneStalePnpmOverride(profileDir, peer)
    if (profileDependencyInstalled(profileDir, peer)) continue
    try {
      outputs.push(await add(peerVersion === undefined ? peer : `${peer}@${peerVersion}`, peer))
      installed = true
    } catch {
      // Swallowed deliberately: see the comment above.
    }
  }
  if (!installed) return { state: 'present', output: '' }
  if (reconcileBundles !== null) reconcileBundles()
  return { state: 'installed', output: outputs.join('\n') }
}
