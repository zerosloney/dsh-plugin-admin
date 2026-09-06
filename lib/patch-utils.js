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
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/* ========================================================================== */
/*                          dsh Home Resolution                               */
/* ========================================================================== */

/**
 * Resolve the dsh home directory (same strategy as @deepseek-ai/dsh-home-paths):
 * a non-empty `$DSH_HOME` wins, otherwise `~/.dsh`.
 * @returns {string} the absolute harness home path.
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
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
 * @param {string} value - the raw scalar text.
 * @returns {string|number|boolean|null} the parsed value.
 */
export function yamlScalar(value) {
  const text = value.trim()
  try {
    return JSON.parse(text)
  } catch {
    const quoted = /^['"](.*)['"]$/.exec(text)
    return quoted ? quoted[1] : text
  }
}

/* ========================================================================== */
/*                     Profile Dependency Management                          */
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
      if (existsSync(candidate)) return 'link:' + candidate.split('\\').join('/')
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
