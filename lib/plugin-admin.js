/**
 * plugin-admin.js — the pluginAdmin remote + the profile package machinery.
 *
 * Extracted from lib/index.js (the apply() split, step 2/4): this module owns
 * everything that turns `pnpm add/remove` into a composed profile layer — the
 * pnpm runner (budget, lifecycle-script policy, process-tree kill), the
 * manifest reconciler, the disable-row upserter/remover, the registry update
 * checker — plus the pluginAdmin service that rides them. command-hook /
 * webhook / web-search import runPnpm + reconcileBundles from here through
 * index.js's deps, unchanged. The RPC surface stays pinned by
 * lib/rpc-manifest.js + host-check's manifest gates.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

import { auditService } from './audit-log.js'
import { killProcessTree } from './mcp-probe.js'
import { evaluateDshPeerCompat, readInstalledDshPeers, resolveDshRuntimeVersion } from './peer-compat.js'
import { appendTopLevelBlocks, entryDisabled, entryEndAt, matchRowIdLine, mutateProfilePatch, profileDirOf, readPatchLines, topLevelBlocks, withFileLock, writeJsonAtomic } from './patch-utils.js'
import { findRowEntry } from './overlay-admin.js'

const PLUGIN_SERVICE_KEY = 'pluginAdmin'
const PLUGIN_NAMESPACE = 'pluginAdmin'

// Remote update check knobs: query the npm registry (the same registry npm
// uses — env override, .npmrc, or the official default) for the `latest`
// dist-tag of each registry-installed bundle and compare with the local
// version. Bounded concurrency, strict timeout, and a short-lived cache so
// the panel never hammers the registry on every refresh.
//
// These budgets are module-level `let` because their consumers live at
// module scope (runPnpm / fetchLatestVersion); applyPluginAdmin retunes them
// from the plugin config row (pnpmTimeoutMs / updateCheckTimeoutMs) at mount.
let PNPM_TIMEOUT_MS = 5 * 60_000
let UPDATE_CHECK_TIMEOUT_MS = 8_000
const NPM_REGISTRY_DEFAULT = 'https://registry.npmjs.org'

/**
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
export function assessInstalledCompat(profileDir, before) {
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
export function compareSemver(a, b) {
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

/** Run bounded-concurrency async work over a list, preserving order. */
export async function mapConcurrent(items, limit, worker) {
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
export function localSpecPath(spec) {
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
export function resolveNpmRegistry(profileDir) {
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
export async function fetchLatestVersion(registry, name) {
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
 * @returns {Promise<{ name: any; version: any; latest: any; updateAvailable: any; error?: any; }>}.
 */
export async function checkPluginUpdate(registry, plugin) {
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

/**
 * Atomically replace the profile manifest: write the next content to a
 * sibling temp file and rename over the original. A crash mid-write then
 * leaves either the old or the new package.json — never a truncated JSON
 * that would take the whole profile down at next dsh start.
 * @param profileDir - the profile directory.
 * @param pkg - the complete next manifest object.
 */
function writeManifest(profileDir, pkg) {
  // Unique-per-write temp + rename via writeJsonAtomic (see patch-utils).
  // The mode tightens to 0600 with the shared recipe — package.json is not
  // credential-bearing, but owner-only never hurts a profile manifest.
  writeJsonAtomic(join(profileDir, 'package.json'), pkg)
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
  // Same cross-process lock the pnpm-override writers hold (writePnpmOverride
  // / pruneStalePnpmOverride): two dsh instances on one profile would both
  // read the manifest, both edit and both rename — the atomic temp+rename
  // keeps the file whole but the second rename discards the first edit.
  return withFileLock(manifestPath, () => {
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (mutate(pkg) !== true) return false
    writeManifest(profileDir, pkg)
    return true
  })
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
export function reconcileBundles(profileDir, dropBundle = null) {
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
 * The install-time lifecycle-script policy (`config.installScripts`), as a
 * module-level value because `runPnpm` sits at module scope — the same pattern
 * the pnpm/update/git budgets use.
 *
 * Why a knob rather than a hard `--ignore-scripts`: a dependency's own prepare /
 * postinstall script is sometimes REQUIRED (a native binary, a build step), and
 * `dsh plugin add` — the documented CLI path — runs them. Denying by default
 * would install packages that then fail to load, a far more confusing failure
 * than the one it prevents. The finding is about the operator having no control;
 * `deny` is that control, `local-only` (scripts only for a local `file:`/`link:`/
 * path spec, which is the developer's own package) is the middle setting, and
 * `allow` stays the default so nothing changes underneath an existing profile.
 */
let INSTALL_SCRIPTS_POLICY = 'allow'

/**
 * Whether one pnpm operand names the operator's OWN package (a path or an
 * explicit `file:` / `link:` specifier) rather than something fetched from a
 * registry or a remote repository. Deliberately its own predicate instead of
 * `localSpecPath`: that one classifies operands for path RESOLUTION (it returns
 * null for `../pkg`, which is a perfectly local install), while this one is
 * about provenance — where the code that will run a prepare script comes from.
 * @param {string} spec - one operand.
 * @returns {boolean}
 */
function isLocalInstallSpec(spec) {
  if (typeof spec !== 'string' || spec === '') return false
  if (/^(?:link|file):/i.test(spec)) return true
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(spec)) return false                        // https://, git+ssh://, …
  if (/^[A-Za-z]:[\\/]/.test(spec)) return true                                  // Windows drive path
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) return false                            // git+…, github:…, npm:…
  if (/^[\\/]/.test(spec)) return true                                           // POSIX absolute / UNC
  if (/^\.{1,2}[\\/]/.test(spec)) return true                                    // ./pkg, ../pkg
  return false                                                                   // registry name, range, tarball
}

/**
 * Whether one `pnpm add` should skip lifecycle scripts.
 * @param {string} spec - the operand(s) being installed (whitespace-joined).
 * @param {string} [policy] - the resolved policy (defaults to the mounted one).
 * @returns {boolean}
 */
export function shouldIgnoreScripts(spec, policy = INSTALL_SCRIPTS_POLICY) {
  if (policy === 'deny') return true
  if (policy !== 'local-only') return false
  const specs = String(spec).split(/\s+/).filter((one) => one !== '')
  if (specs.length === 0) return false
  // ANY remote operand denies the whole install: `pnpm add ./mine git+https://…`
  // would otherwise build both, and the remote one is the untrusted half.
  return specs.some((one) => !isLocalInstallSpec(one))
}

/**
 * Insert `--ignore-scripts` into a `pnpm add` call when the policy asks for it.
 * Only `add` runs lifecycle scripts we care about; every other verb passes
 * through untouched.
 * @param {readonly string[]} args - pnpm arguments.
 * @param {string} [policy] - the resolved policy (defaults to the mounted one).
 * @returns {string[]} the arguments to spawn.
 */
export function withInstallScriptsPolicy(args, policy = INSTALL_SCRIPTS_POLICY) {
  if (args[0] !== 'add') return args.slice()
  const packages = args.slice(1).filter((arg) => !arg.startsWith('-'))
  if (!shouldIgnoreScripts(packages.join(' '), policy)) return args.slice()
  return ['add', '--ignore-scripts', ...args.slice(1)]
}

/**
 * The environment pnpm runs with: everything the operator has, minus the
 * harness's own `DSH_*` namespace. Deliberately NOT a credential scrub — pnpm
 * legitimately needs registry credentials from the environment (a private
 * registry may authenticate with NPM_TOKEN), and dropping those would turn a
 * working install into a 401 that looks like a network problem.
 * @param {NodeJS.ProcessEnv} env - the host environment.
 * @returns {NodeJS.ProcessEnv}
 */
export function scrubbedPnpmEnv(env) {
  const out = {}
  for (const [key, value] of Object.entries(env)) {
    // Case-INSENSITIVE prefix: Windows environment variables are matched
    // case-insensitively by the child, so a `dsh_foo` spelling would survive
    // an exact-prefix check and still be readable as DSH_FOO inside the
    // spawned process (the MCP probe env scrub already folds case).
    if (key.toUpperCase().startsWith('DSH_') || value === undefined) continue
    out[key] = value
  }
  return out
}

/**
 * Run one pnpm invocation in the profile directory (async; never blocks host loop).
 * @param profileDir - working directory for pnpm.
 * @param args - pnpm arguments.
 * @returns the command's combined output tail on success.
 * @throws {Error} carrying the output tail when pnpm exits non-zero.
 */
export function runPnpm(profileDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', pnpmSpawnArgs(withInstallScriptsPolicy(args)), {
      cwd: profileDir,
      shell: process.platform === 'win32',
      windowsHide: true,
      // The harness's own state is not pnpm's business: `dsh plugin add` inherits
      // the operator's environment (a private registry may need NPM_TOKEN), but
      // DSH_* carries harness internals (sandbox tokens, ACL identities) that no
      // dependency's prepare script has any use for.
      env: scrubbedPnpmEnv(process.env),
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
      reject(/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
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
const PNPM_OPERAND_ALLOWED = /^[A-Za-z0-9@/_.:\\^~*=+#-]+$/

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

/**
 * Mount the pluginAdmin remote service.
 * @param {Record<string, any>} ctx - plugin context.
 * @param {{ enqueue: (job: () => Promise<any>) => Promise<any>, audit: ReturnType<typeof import('./audit-log.js').createAuditLog>, cfg: Record<string, any>, panelStates: Record<string, string> }} deps
 *   - enqueue: the shared serial operation queue (patch/JSON writes).
 *   - audit: the privileged-action audit trail.
 *   - cfg: the resolved plugin config row (pnpm / update-check budgets).
 *   - panelStates: the per-panel switch map (config.panels).
 * @returns {void}
 */
export function applyPluginAdmin(ctx, { enqueue, audit, cfg, panelStates }) {
  const profileDir = profileDirOf(ctx.baseUrl)
  // Retune the module-level budgets the module-scope consumers (runPnpm /
  // fetchLatestVersion) read — the same contract index.js's apply() had.
  PNPM_TIMEOUT_MS = cfg.pnpmTimeoutMs
  INSTALL_SCRIPTS_POLICY = cfg.installScripts ?? 'allow'
  UPDATE_CHECK_TIMEOUT_MS = cfg.updateCheckTimeoutMs
  const UPDATE_CHECK_CONCURRENCY = cfg.updateCheckConcurrency
  const UPDATE_CHECK_CACHE_TTL_MS = cfg.updateCheckCacheTtlMs

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
     * The audit trail (Phase F3): newest-first privileged actions, the file it
     * lives in and how many entries it holds. Read-only — the trail is append
     * only from the action side.
     * @returns {Promise<{ entries: Array<Record<string, any>>, path: string, count: number }>} the trail.
     */
    async auditLog() {
      return { entries: audit.read(100), path: audit.path, count: audit.size() }
    },

    /**
     * The per-panel switch this deployment configured (Phase E3): panel id →
     * 'auto' | 'on' | 'off'. The browser half cannot read the profile config, so
     * it asks once at mount and registers accordingly.
     * @returns {Promise<{ panels: Record<string, string> }>} the switch map.
     */
    async panels() {
      return { panels: panelStates }
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
     * @returns {Promise<{ updates: any; checkedAt: any; }>} where updates is per-plugin status.
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
      // any caller that still passes `@latest`. The resolved operand goes
      // through the SAME whitelist as the raw one: the version comes off the
      // registry response (`data.version`, a plain string check away from the
      // wire), and runPnpm spawns through cmd.exe on win32 — an unchecked
      // version containing a shell metacharacter would splice the command
      // line the whitelist exists to keep whole.
      const operand = rawOperand.endsWith('@latest')
        ? assertPnpmOperand('install spec', await resolveLatestSpec(profileDir, rawOperand.slice(0, -'@latest'.length)))
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
          // Read-modify-write in one critical section (see mutateProfilePatch).
          mutateProfilePatch(profileDir, (lines) => {
            const stripped = removeDisableRows(lines, rowIds)
            return stripped.changed ? { next: stripped.lines, value: true } : { value: false }
          })
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
     * @returns {Promise<{ [key: string]: any; ok: any; state: any; rows: any; }>} where state is 'applied' or
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
        // Decide against the locked revision: 'present' means the file already
        // says what this call wants, and the write then lands on the same lines
        // the decision saw (see mutateProfilePatch).
        const changed = mutateProfilePatch(profileDir, (lines) => {
          const result = disabled
            ? upsertDisableRows(lines, rowIds)
            : removeDisableRows(lines, rowIds)
          return result.changed ? { next: result.lines, value: true } : { value: false }
        }).value
        if (!changed) {
          return { ok: true, state: 'present', disabled, rows: rowIds, ...listLayers() }
        }
        return { ok: true, state: 'applied', disabled, rows: rowIds, restartRequired: true, ...listLayers() }
      })
    },
  }

  auditService(pluginService, PLUGIN_NAMESPACE, audit)
  const pluginBinding = Object.freeze({ service: pluginService, serviceKey: PLUGIN_SERVICE_KEY, namespace: PLUGIN_NAMESPACE })
  Object.defineProperty(pluginService, 'typertRemote', { value: pluginBinding, enumerable: false })
  ctx.effect(() => { ctx.provide(PLUGIN_SERVICE_KEY, pluginService) }, 'plugin-admin/pluginAdmin: provide')
}
