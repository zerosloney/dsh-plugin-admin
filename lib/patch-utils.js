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
 * @module dsh-plugin-admin/patch-utils
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
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
 * Resolve the dsh home directory (same strategy as @deepseek-ai/dsh-home-paths):
 * a non-empty `$DSH_HOME` wins (tilde-expanded and resolved, matching
 * resolveDshHome), otherwise `~/.dsh`.
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
 * @param baseUrl - the loader config-tree anchor (file: URL or path string).
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
 * Shared by overlay-admin (search/schedule rows) and pluginAdmin (bundle row
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
 * leading whitespace stays literal (URLs, `name#frag`). A mismatched quote
 * pair disables stripping for the whole scalar — an unterminated quote is a
 * broken line and the raw text is the honest answer.
 * @param {string} value - the raw scalar text.
 * @returns {string|number|boolean|null} the parsed value.
 */
export function yamlScalar(value) {
  let text = value.trim()
  let quote = null
  let wellFormed = true
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote !== null) {
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
 * Persist the patch file atomically (temp + rename). `content` is either the
 * next full file text (written verbatim) or the next lines (joined with LF
 * and given exactly one trailing newline).
 * @param {string} patchPath - patch file path.
 * @param {string | string[]} content - next content or next lines.
 */
export function writePatch(patchPath, content) {
  const text = Array.isArray(content) ? content.join('\n').replace(/\n*$/, '\n') : content
  const temp = patchPath + '.dsh-admin.tmp'
  writeFileSync(temp, text, 'utf8')
  renameSync(temp, patchPath)
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
 * The `disabled:` scalar inside the entry (any indent at or below the id line
 * — the ui-schedule row is flat: `- id: x` + ` disabled: false`), or
 * undefined.
 * @param {string[]} entryLines - the entry's own lines.
 * @returns {boolean | undefined}
 */
export function entryDisabled(entryLines) {
  for (const line of entryLines.slice(1)) {
    const match = /^\s*disabled:\s*(.+?)\s*(?:#.*)?$/.exec(line)
    if (match !== null) {
      const value = yamlScalar(match[1])
      if (typeof value === 'boolean') return value
    }
  }
  return undefined
}

/**
 * One serial queue: operations run one at a time, in submission order, and a
 * rejected operation never blocks the next. The host passes its single
 * instance into every admin module's apply() via `options.enqueue`; the
 * fallback keeps modules usable stand-alone (tests).
 * @returns {(operation: () => Promise<unknown>) => Promise<unknown>}
 */
export function makeSerialQueue() {
  let tail = Promise.resolve()
  return (operation) => {
    const run = tail.then(operation, operation)
    tail = run.catch(() => {})
    return run
  }
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

/** The version of an installed package, for pinning its peers in lockstep. */
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
 * Write a pnpm override for a peer package into the profile's package.json
 * (atomic: temp file + rename).
 * @param {string} profileDir - the profile directory.
 * @param {string} peerName - the peer package name.
 * @param {string} spec - the override spec (e.g. `link:/path/to/pkg`).
 */
export function writePnpmOverride(profileDir, peerName, spec) {
  const manifestPath = join(profileDir, 'package.json')
  try {
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const overrides = pkg.pnpm?.overrides ?? {}
    if (overrides[peerName] === spec) return
    pkg.pnpm = { ...pkg.pnpm, overrides: { ...overrides, [peerName]: spec } }
    const temp = manifestPath + '.wt-tmp'
    writeFileSync(temp, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    renameSync(temp, manifestPath)
  } catch {
    // An unwritable manifest leaves the plain add fallback in charge.
  }
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
  /** One tolerant add; returns the pnpm output or throws. */
  const add = async (spec, name) => {
    try {
      return await runPnpm(profileDir, ['add', spec])
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
    // Host-copy preference: pin through overrides AND link the dep, so the
    // profile resolves the exact build the running host executes against.
    const hostSpec = hostPeerLinkSpec(peer)
    if (hostSpec !== undefined) {
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
