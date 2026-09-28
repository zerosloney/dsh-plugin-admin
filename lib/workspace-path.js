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
  const fold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
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

  let sessionRoot = null
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
 * The project-scope directory for one root, with the two containment guards the
 * write path needs:
 *   1. `<root>/.dsh` may ALREADY be a symlink/junction — a cloned repository can
 *      ship one — so its real target must stay inside the root, otherwise
 *      `mkdir -p` would write outside the project the user trusted;
 *   2. the same check again on the final `<root>/.dsh/workflows` after creation,
 *      which also covers a junction created between the two steps.
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
  return join(root, '.dsh', 'workflows')
}
