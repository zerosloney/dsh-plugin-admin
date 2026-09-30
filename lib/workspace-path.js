/**
 * Project-scope workspace paths: the one place that decides whether a path a
 * caller supplied may be used as a project root.
 *
 * Why this is a separate module: `workflowAdmin`'s saved library writes, reads
 * and DELETES under `<workspacePath>/.dsh/workflows`, and `workspacePath` is
 * caller-controlled on two untrusted entry points — the model-facing
 * `workflow_admin` tool argument and the browser RPC payload. Before this gate,
 * `join(workspacePath, '.dsh', 'workflows')` with `mkdirSync(recursive)` meant
 * a prompt-injected model (or a same-origin script) could create a directory
 * tree and drop an arbitrary JSON file anywhere on disk — and `delete_saved`
 * could unlink `anywhere/.dsh/workflows/<name>.json`. The rest of this plugin
 * already had the right fence (`cwdInKnownWorkspaces`, used by the project
 * `.agents` inspector); this module is that fence, shared.
 *
 * Two layers, deliberately:
 *   - SHAPE (`canonicalWorkspacePath`): absolute, exists, directory, not a
 *     filesystem root, returned as a realpath (so a symlinked/junctioned root
 *     cannot be smuggled past a string comparison).
 *   - TRUST (`assertTrustedWorkspacePath`): the path must be the calling
 *     session's own tree, or a workspace the registry knows. The session branch
 *     is what keeps CLI / headless deployments working (no registry there) while
 *     a bare "just pass any path" stays refused.
 *
 * Zero dsh imports (the registry arrives as a plain object by key).
 */

import { isAbsolute, join, parse, resolve, sep } from 'node:path'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { cwdInKnownWorkspaces } from './project-hooks.js'

/**
 * Whether `child` is `parent` itself or lives under it. Case-insensitive on
 * Windows, where the same file has several spellings.
 * @param {string} child - canonical absolute path.
 * @param {string} parent - canonical absolute path.
 * @returns {boolean}
 */
export function isInsidePath(child, parent) {
  const fold = (/** @type {string} */ value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  const inner = fold(child)
  const outer = fold(parent)
  return inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep)
}

/**
 * Canonicalize one project root, refusing anything we must not treat as a
 * project: a relative path (it would resolve against the host's cwd, not the
 * caller's intent), a path that does not exist (we do not invent trees), a file,
 * or a filesystem root (a recursive sweep under `C:\` is never a project).
 * @param {unknown} candidate - the caller-supplied path.
 * @param {string} label - diagnostic prefix naming the caller.
 * @returns {string} the absolute realpath.
 * @throws {Error} when the path fails any of the checks.
 */
export function canonicalWorkspacePath(candidate, label = 'workspacePath') {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  if (!isAbsolute(candidate)) {
    throw new Error(`${label} must be an absolute path (got ${JSON.stringify(candidate)}) — a relative path would resolve against the host's cwd, not the project you meant`)
  }
  const absolute = resolve(candidate)
  if (absolute === parse(absolute).root) {
    throw new Error(`${label} must not be a filesystem root (got ${candidate})`)
  }
  let real
  try {
    real = realpathSync(absolute)
  } catch {
    throw new Error(`${label} does not exist: ${candidate} — create the project directory first (the library will not invent one)`)
  }
  let info
  try {
    info = statSync(real)
  } catch {
    throw new Error(`${label} is not readable: ${candidate}`)
  }
  if (!info.isDirectory()) {
    throw new Error(`${label} must be a directory (got ${candidate})`)
  }
  return real
}

/**
 * Canonicalize an EXPLICITLY supplied project root and require it to be
 * trustworthy: inside the calling session's own tree, or a workspace the
 * registry knows. Callers that pass a path they derived themselves (the
 * session's cwd) do not need this — provenance is what makes a path trusted,
 * and only the explicit argument can be attacker-chosen.
 * @param {unknown} candidate - the caller-supplied path.
 * @param {{ sessionCwd?: unknown, registry?: unknown, label?: string }} [options]
 *   `sessionCwd` widens trust to that session's tree (CLI / headless included);
 *   `registry` is `ctx.get('workspaceRegistry')` when the deployment has one.
 * @returns {string} the absolute realpath of a trusted project root.
 * @throws {Error} when the path fails the shape checks or is outside every
 *   trusted root.
 */
export function assertTrustedWorkspacePath(candidate, options = {}) {
  const label = typeof options.label === 'string' && options.label !== '' ? options.label : 'workspacePath'
  const real = canonicalWorkspacePath(candidate, label)

  // `null` means "no usable session cwd, so the session grants nothing"; the
  // cast is what pins the union, since a bare `null` initializer would take the
  // literal type `null` and reject the assignment below.
  /** @type {string|null} */
  let sessionRoot = /** @type {any} */ (null)
  if (typeof options.sessionCwd === 'string' && options.sessionCwd.trim() !== '') {
    try {
      sessionRoot = canonicalWorkspacePath(options.sessionCwd, 'session cwd')
    } catch {
      sessionRoot = null   // a session whose cwd is unusable simply grants nothing
    }
  }
  if (sessionRoot !== null && isInsidePath(real, sessionRoot)) return real
  if (cwdInKnownWorkspaces(options.registry, real)) return real

  throw new Error(`${label} ${JSON.stringify(real)} is outside the calling session and outside every workspace this dsh instance knows — project-scope workflow files live in <workspace>/.dsh/workflows, so pass the session's own project root or a registered workspace`)
}

/**
 * `realpathSync` when the path exists, `null` otherwise (no throw).
 * @param {string} path - candidate path.
 * @returns {string|null}
 */
export function realpathIfExists(path) {
  if (!existsSync(path)) return null
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * The project-scope directory for one root, guarded against a link that would
 * redirect the write outside the project the user trusted:
 *
 * `<root>/.dsh` — and, when it already exists, `<root>/.dsh/workflows` — may be
 * a symlink/junction (a cloned repository can ship one, and a previous run can
 * leave one). Either one resolving outside the root would make the caller's
 * `mkdir -p` write somewhere else, so both existing links are refused here.
 *
 * This function NEVER creates anything; the caller's `mkdirSync` does. The
 * remaining window — a junction appearing between this call and that `mkdir` —
 * is closed by the caller's own post-creation containment re-check (see
 * `ensureDir` in lib/workflow-library.js, which realpaths the directory after
 * creating it and re-asserts it is inside the root). Both halves are needed:
 * this one refuses a link that is already there, that one refuses a link that
 * arrives in between.
 * @param {string} root - a canonical project root (see canonicalWorkspacePath).
 * @returns {string} `<root>/.dsh/workflows` (not necessarily created yet).
 * @throws {Error} when the `.dsh` chain resolves outside the root.
 */
export function projectWorkflowsDir(root) {
  const dotDsh = join(root, '.dsh')
  const realDotDsh = realpathIfExists(dotDsh)
  if (realDotDsh !== null && !isInsidePath(realDotDsh, root)) {
    throw new Error(`refusing to write into ${dotDsh}: it resolves to ${realDotDsh}, outside the project root ${root}`)
  }
  // `.dsh` resolving inside the root says nothing about where its child points,
  // so an existing `.dsh/workflows` link is checked on its own realpath.
  const workflows = join(root, '.dsh', 'workflows')
  const realWorkflows = realpathIfExists(workflows)
  if (realWorkflows !== null && !isInsidePath(realWorkflows, root)) {
    throw new Error(`refusing to write into ${workflows}: it resolves to ${realWorkflows}, outside the project root ${root}`)
  }
  return workflows
}

/**
 * Whether a path is a UNC (network share) reference, in either spelling.
 *
 * This is the one shape a "reveal this local path" gesture must refuse: opening
 * `\\server\share\...` makes Windows perform an outbound SMB authentication, so
 * a caller-supplied path becomes a way to point the operator's own credentials
 * at a host of the caller's choosing. POSIX writes it as `//server/share`, which
 * `resolve` normalises the same way, so both forms are checked.
 * @param {string} candidate - the trimmed path.
 * @returns {boolean}
 */
function isUncPath(candidate) {
  return candidate.startsWith('\\\\') || candidate.startsWith('//')
}

/**
 * Whether a path uses a Win32 namespace prefix that bypasses normal path
 * handling: `\\?\` (the file namespace) and `\\.\` (the device namespace). Such
 * a path is not subject to the same resolution rules, so it must not be handed
 * to a command that acts on the literal string.
 * @param {string} candidate - the trimmed path.
 * @returns {boolean}
 */
function isNamespacePath(candidate) {
  return /^\\\\[?.]/.test(candidate) || candidate.startsWith('/./') || candidate.startsWith('/?/')
}

/**
 * Gate one browser-supplied path for the `fsAdmin/reveal` affordance.
 *
 * `reveal` was the one RPC in this plugin with no gate at all: whatever string
 * the browser sent was handed verbatim to explorer.exe / open / xdg-open. These
 * checks are what verbatim OS use needs:
 *
 * - NOTHING but a non-empty string, ABSOLUTE. A relative path resolves against
 *   the HOST's working directory, not the caller's project, so it could name a
 *   directory the caller never meant.
 * - EXISTING. A nonexistent path only earns an Explorer error dialog, and the
 *   `dirname()` fallback for a nonexistent file names a directory that may not
 *   exist either.
 * - NOT UNC. `\\server\share` (or `//server/share`) makes the machine
 *   authenticate OUTBOUND to a host of the caller's choosing — the one shape
 *   here that leaks credentials rather than merely opening a window.
 * - NOT a namespace prefix. `\\?\C:\...` sidesteps normal path resolution and
 *   `\\.\PhysicalDrive0` surfaces devices.
 * - NO control character and no double quote. The Windows foreground helper
 *   spawns PowerShell with `-File` + argv, whose quoting is cruder than
 *   CreateProcess's, so a breakout here turns a path into an argument to a
 *   script.
 *
 * Deliberately NOT here: workspace containment. `assertTrustedWorkspacePath` is
 * the gate for paths the plugin WRITES at, and `assertTrustedCliPaths` for paths
 * that decide which executable runs — in both, the path is the privilege.
 * `reveal` only opens a read-only file-manager window at a location the
 * operator can navigate to with the same gesture, so containment would be
 * theatre at a real cost: the RPC carries no session context, so a registry-less
 * deployment (the base CLI bundle) whose sessions live outside the operator's
 * home would have every reveal refused. The trust face for this gesture is
 * loopback, same as the rest of the panel.
 * @param {unknown} candidate - the path from the RPC payload.
 * @param {string} [label] - diagnostic prefix naming the caller.
 * @returns {string} the trimmed absolute path to reveal.
 * @throws {Error} when the path fails any check.
 */
export function assertRevealablePath(candidate, label = 'path') {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  const trimmed = candidate.trim()
  if (!isAbsolute(trimmed)) {
    throw new Error(`${label} must be an absolute path (got ${JSON.stringify(candidate)}) — a relative one would resolve against the host's working directory, not the project you meant`)
  }
  // eslint-disable-next-line no-control-regex -- the control characters ARE the check
  if (/["\u0000-\u001f]/.test(trimmed)) {
    throw new Error(`${label} carries a control character or a double quote, which no real filename can (and which could break out of the PowerShell helper's argument boundary)`)
  }
  // Order matters for the message: a namespace path also starts with `\\`, so
  // checking it FIRST reports the reason it was refused rather than calling
  // `\\?\C:\...` a network share.
  if (isNamespacePath(trimmed)) {
    throw new Error(`${label} ${JSON.stringify(trimmed)} uses a Win32 namespace prefix (\\\\.\\? or \\\\.\\), which bypasses normal path resolution and is not accepted`)
  }
  if (isUncPath(trimmed)) {
    throw new Error(`${label} ${JSON.stringify(trimmed)} is a network share — revealing it would make this machine authenticate to that host, so it is refused`)
  }
  let real
  try {
    real = realpathSync(trimmed)
  } catch {
    throw new Error(`${label} does not exist: ${trimmed}`)
  }
  if (!existsSync(real)) {
    throw new Error(`${label} is not readable: ${trimmed}`)
  }
  return real
}
