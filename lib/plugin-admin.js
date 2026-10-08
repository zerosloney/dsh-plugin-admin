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
import { appendTopLevelBlocks, assertPnpmOperand, entryDisabled, entryEndAt, entryOwnKeyIndents, matchRowIdLine, messageOf, mutateProfilePatch, profileDirOf, readPatchLines, topLevelBlocks, withFileLock, writeJsonAtomic } from './patch-utils.js'
import { findRowEntry } from './overlay-admin.js'

/* The pnpm operand whitelist and its assertion live in patch-utils.js beside
 * ensureProfileDependency (which builds operands from installed manifests the
 * RPC call sites never see). Re-exported so host-check / lib/index.js keep
 * importing this module's historical surface. */
export { assertPnpmOperand } from './patch-utils.js'

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
 * Read and parse the profile's package.json — the one door every manifest
 * reader/writer on an RPC or write path goes through, so a corrupt or missing
 * file surfaces with a `plugin-admin:` diagnosis naming the path instead of a
 * bare SyntaxError/ENOENT from deep inside an RPC (the panel would otherwise
 * show an unattributed parse error, breaking the plugin-wide error-prefix
 * contract). The tolerant reader (`profileDependencyNames`) keeps its own
 * catch — degrading to an empty set there is deliberate.
 * @param {string} profileDir - the profile directory.
 * @returns {Record<string, any>} the parsed manifest.
 */
function readProfileManifest(profileDir) {
  const manifestPath = join(profileDir, 'package.json')
  let text
  try {
    text = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    throw new Error(`plugin-admin: cannot read the profile manifest ${manifestPath}: ${messageOf(error)}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`plugin-admin: the profile manifest ${manifestPath} is not valid JSON (${messageOf(error)}) — fix or restore the file before running plugin operations`)
  }
}

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
 * Snapshot of every direct dependency's INSTALLED version, for the compat
 * precheck's before/after comparison. A dependency absent from node_modules
 * maps to `undefined`.
 * @param {string} profileDir
 * @returns {Map<string, string|undefined>}
 */
function profileDependencyVersions(profileDir) {
  const versions = new Map()
  for (const name of profileDependencyNames(profileDir)) {
    const info = readInstalledDshPeers(profileDir, name)
    versions.set(name, info !== null ? info.version : undefined)
  }
  return versions
}

/**
 * dsh peer-compatibility verdict for the packages an install just ADDED or
 * UPDATED. dsh 0.1.7 enforces `@deepseek-ai/dsh*` peers at boot and skips
 * incompatible bundles, so a successful `pnpm add` can still yield a plugin
 * that will never load. Every dependency that is NEW or whose INSTALLED
 * VERSION changed (an update is `pnpm add pkg@2.0` over an existing
 * dependency — the name set does not move, only the version does) with
 * declared dsh peers is checked against the running runtime; the structured
 * verdict rides the install result for the panel to render. Never throws — an
 * unresolvable runtime version degrades to `{ checked: false }` and the panel
 * stays quiet.
 * @param {string} profileDir
 * @param {Map<string, string|undefined>|Set<string>} before - dependency
 *   snapshot BEFORE the install: name → installed version (a version that
 *   still matches `before` is unchanged and skipped), or — legacy callers — a
 *   plain name Set, where membership means "unchanged".
 * @returns {{ checked: boolean, runtimeVersion?: string, ok: boolean,
 *   rows: Array<{ name: string, version: string|null, peers: Record<string, string>, incompatible: Record<string, string> }> }}
 */
export function assessInstalledCompat(profileDir, before) {
  const runtimeVersion = resolveDshRuntimeVersion()
  if (runtimeVersion === null) return { checked: false, ok: true, rows: [] }
  const rows = []
  for (const name of profileDependencyNames(profileDir)) {
    const info = readInstalledDshPeers(profileDir, name)
    if (info === null) continue
    if (before instanceof Map) {
      // 同名同版本（原地重装）才跳过；新增，或更新落到了不同版本，都过预检。
      if (before.has(name) && before.get(name) === info.version) continue
    } else if (before instanceof Set && before.has(name)) {
      continue
    }
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
 * @param {string} a
 * @param {string} b
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
  const preOf = (/** @type {RegExpExecArray} */ match, /** @type {string} */ whole) => {
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

/** Run bounded-concurrency async work over a list, preserving order.
 * @param {any[]} items
 * @param {number} limit
 * @param {(item: any, index: number) => Promise<any>} worker
 */
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

/** @param {string} profileDir */
function requireOf(profileDir) {
  return createRequire(join(profileDir, 'package.json'))
}

/**
 * @param {any} require - profile-anchored require.
 * @param {string} name - dependency package name.
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
 * @param {any} require - profile-anchored require.
 * @param {string} name - dependency package name.
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
 * @param {any} spec - the raw dependency range from the profile manifest.
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
  /** @type {string[]} */
  const ids = []
  const lines = String(patchText ?? '').split(/\r?\n/)
  for (const block of topLevelBlocks(lines)) {
    for (let i = block.index; i < block.endIndex; i++) {
      const match = matchRowIdLine(lines[i])
      if (match === null) continue
      const end = entryEndAt(lines, i, block.endIndex, match.indent)
      // `name:` counts only at the ENTRY's own key indent (id-line indent + 2,
      // tolerating +4 like entryDisabled): a deeper `name:` belongs to a nested
      // config payload, and counting one made a pure id-override row (no own
      // name) read as a composing row the enable/disable toggle may rewrite.
      const ownIndents = [match.indent + '  ', match.indent + '    ']
      const hasName = lines.slice(i + 1, end).some((line) => {
        const keyMatch = /^(\s*)name:\s*\S/.exec(line)
        return keyMatch !== null && ownIndents.includes(keyMatch[1])
      })
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
 * @param {any} require - profile-anchored require.
 * @param {string} name - the bundle (package) name.
 * @param {any} manifest - the parsed bundle manifest.
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
 *
 * Reaches NESTED entries too: `upsertDisableRows` disables any shape
 * `findRowEntry` finds — including a `- id:` child inside an `- insert:`
 * block (the shape real bundle patches compose) — so the enable direction
 * must scan block bodies as well, or the toggle is a one-way switch for
 * insert-composed bundles (`changed: false` while `disabled: true` stays
 * on disk). Only the entry's OWN `disabled:` line (at the same indents
 * `entryDisabled` reads — id-line indent +2, +4 in hand-edited files) is
 * stripped; a `disabled:` key deeper inside a nested config payload is user
 * data and is never touched.
 * @param {string[]} lines - profile patch lines.
 * @param {string[]} rowIds - the bundle's composing row ids.
 * @returns {{ lines: string[], changed: boolean }}
 */
export function removeDisableRows(lines, rowIds) {
  let next = lines
  let changed = false
  for (const rowId of rowIds) {
    // One removal per pass, then rescan: a pass consumes exactly one disabled
    // line or one bare block, so duplicate ids (hand-copied rows) all clear
    // and the loop cannot run past the file's line count.
    for (;;) {
      const blocks = topLevelBlocks(next)
      let acted = false
      for (let b = blocks.length - 1; b >= 0 && !acted; b--) {
        const block = blocks[b]
        for (let i = block.endIndex - 1; i >= block.index; i--) {
          const match = matchRowIdLine(next[i] ?? '')
          if (match === null || match.id !== rowId) continue
          const entryEnd = entryEndAt(next, i, block.endIndex, match.indent)
          const entryLines = next.slice(i, entryEnd)
          // A bare disable-only TOP-LEVEL row is the toggle's own artifact:
          // remove it whole. Entries inside another block (insert children,
          // hand-merged spans) lose only the disabled line — deleting a span
          // out of a shared block would drop sibling rows with it.
          if (match.indent === '' && isBareDisableBlock(entryLines, rowId)) {
            next = [...next.slice(0, block.index), ...next.slice(block.endIndex)]
            acted = true
            break
          }
          // Only the entry's OWN `disabled:` line is the toggle's flag — the
          // same indents entryDisabled() reads. A `disabled: true` deeper
          // inside the entry's config payload is user data and survives the
          // enable (and every rescan pass of the loop above).
          const ownIndents = entryOwnKeyIndents(entryLines)
          let stripped = false
          const cleaned = entryLines.filter((line) => {
            if (stripped) return true
            const keyMatch = /^(\s*)disabled:\s*true\s*(?:#.*)?$/.exec(line)
            if (keyMatch === null || !ownIndents.includes(keyMatch[1])) return true
            stripped = true
            return false
          })
          if (stripped) {
            next = [...next.slice(0, i), ...cleaned, ...next.slice(entryEnd)]
            acted = true
            break
          }
        }
      }
      if (!acted) break
      changed = true
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
 * @param {string} profileDir - profile directory (checked for a local .npmrc).
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
 * @param {string} profileDir - profile directory (used to locate a local .npmrc).
 * @param {string} name - package name without any version/range suffix.
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
 * @param {string} registry - registry base URL.
 * @param {string} name - package name (scoped names are URL-encoded).
 * @returns the latest version string, or null when unknown/unreachable.
 */
export async function fetchLatestVersion(registry, name) {
  // 预算罩住整次检查（响应头 + body）：timer 只护到 fetch 的响应头曾让
  // `updateCheckTimeoutMs` 的文档语义落空——慢镜像/大 body 下 json() 只剩
  // undici 默认 bodyTimeout 兜底，单条检查可远超预算。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS)
  try {
    const url = `${registry}/${name.split('/').map(encodeURIComponent).join('/')}/latest`
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const data = await response.json()
    if (data && typeof data.version === 'string') return data.version
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Remote update check for one plugin entry: only registry-installed bundles
 * (dependency-managed and not a local path) are queried. The result never
 * throws — network failures surface as `error` on the entry.
 * @param {string} registry - registry base URL.
 * @param {Record<string, any>} plugin - plugin list entry ({ name, version, dependency, localPath }).
 * @param {string|null} [installSpec] - the raw dependency spec when the caller
 *   knows it. A non-registry spec (git/tarball/URL) skips the query QUIETLY:
 *   the registry either does not know the package (per-refresh error noise)
 *   or answers with an unrelated same-named public package's 'latest'.
 *   Undefined keeps the pre-spec behavior (legacy callers).
 * @returns {Promise<{ name: any; version: any; latest: any; updateAvailable: any; error?: any; }>}
 */
export async function checkPluginUpdate(registry, plugin, installSpec) {
  if (!plugin.dependency || plugin.localPath !== null) {
    return { name: plugin.name, version: plugin.version, latest: null, updateAvailable: false }
  }
  if (installSpec !== undefined && installSpec !== null && !isRegistryInstallSpec('probe@' + installSpec)) {
    // `isRegistryInstallSpec` speaks INSTALL OPERANDS (`pkg@^1.2.3`); a manifest
    // dependency is the bare RANGE (`^0.5.0`, `github:user/repo`). Synthesizing
    // the name prefix feeds the range through the same classifier unchanged —
    // it cannot be confused for a name because the classifier splits on the
    // LAST `@`, and remote references in the range (`github:…`) still refuse.
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
 * @param {string} profileDir - the profile directory.
 * @param {Record<string, any>} pkg - the complete next manifest object.
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
 * @param {string} profileDir - the profile directory.
 * @param {(pkg: Record<string, any>) => boolean} mutate - synchronous (pkg) => boolean; true persists the mutation.
 * @returns whether the manifest changed.
 */
function updateManifest(profileDir, mutate) {
  const manifestPath = join(profileDir, 'package.json')
  // Same cross-process lock the pnpm-override writers hold (writePnpmOverride
  // / pruneStalePnpmOverride): two dsh instances on one profile would both
  // read the manifest, both edit and both rename — the atomic temp+rename
  // keeps the file whole but the second rename discards the first edit.
  return withFileLock(manifestPath, () => {
    const pkg = readProfileManifest(profileDir)
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
 * @param {string} profileDir - the profile directory.
 * @param {string|null} [dropBundle] - one bundle name to remove (post-`pnpm remove`
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
 * cmd.exe (the .cmd shim), which treats `^` as its escape character before pnpm
 * ever sees the token — `name@^1.2.3` silently arrives as `name@1.2.3`, an
 * exact pin where the caller asked for a range. That corruption is silent and
 * permanent: the profile records `1.2.3` and the package never upgrades.
 *
 * Two escapes were measured against the real pnpm shim on Windows:
 * - doubling (`^` -> `^^`) does NOT work. cmd.exe accepts a caret only in
 *   groups of four, so 1, 2 and 3 carets all arrive as zero and `^^1.2.3`
 *   still lands as `1.2.3`. This is what the previous implementation did.
 * - QUOTING the operand works: inside `"..."` cmd.exe does not treat `^` as an
 *   escape, and the shim receives `pkg@^1.2.3` intact (measured end to end:
 *   the manifest records `^1.2.3`).
 *
 * Quoting is also the smaller claim to maintain — it does not depend on how
 * many caret layers the pnpm shim re-expands. The operands reaching here are
 * already restricted by {@link assertPnpmOperand} to a character set with no
 * `"`, whitespace, or shell metacharacter, so the quoting cannot be broken out
 * of; it is a transport fix, not a sanitizer.
 * @param {string[]} args - pnpm arguments.
 * @param {string} platform - process platform.
 * @returns {string[]} spawn-ready arguments.
 */
export function pnpmSpawnArgs(args, platform = process.platform) {
  if (platform !== 'win32') return args
  // Only operands that actually carry a caret need quoting; every other
  // argument (flags, plain names, `~`/`*` ranges) is passed through byte
  // identical, so this cannot change the meaning of anything it does not
  // have to touch.
  return args.map((arg) => (arg.includes('^') ? `"${arg}"` : arg))
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
 *
 * A FOURTH state was added because neither older setting could express the case
 * operators actually asked for: "let registry packages build (a native module
 * needs its prepare script), but do not fetch and build an arbitrary remote
 * repository". `allow` permitted both; `local-only` denied scripts to both, which
 * cost native modules their build. `registry-only` closes that gap — see
 * {@link assertInstallSpecAllowed}.
 */
/**
 * Whether one pnpm operand names a REGISTRY package: a bare or scoped name,
 * optionally with a version range (`is-number`, `@scope/pkg`,
 * `is-number@^7.0.0`, `@scope/pkg@~1.2`). Everything else is a remote reference
 * (a git URL, a `github:` / `npm:` shorthand, a tarball URL) or a local path.
 *
 * The distinction matters because the `installScripts: 'registry-only'` policy
 * has to tell "fetch a package published on the registry" — which routinely
 * NEEDS its prepare script, e.g. a native module — apart from "clone an
 * arbitrary repository and run whatever build it declares", which from a browser
 * payload is a way to fetch and execute untrusted code. `allow` (the default,
 * matching `dsh plugin add`) permits both; `local-only` denies scripts to BOTH
 * the registry and git, which costs native modules their build. This predicate
 * is what makes the middle case expressible.
 * @param {string} spec - one install operand.
 * @returns {boolean}
 */
export function isRegistryInstallSpec(spec) {
  if (typeof spec !== 'string') return false
  const text = spec.trim()
  if (text === '') return false
  // A scheme prefix is always a remote reference: `git+https:`, `https:`,
  // `git:`, `github:`, `npm:`, `file:`, `link:`. A Windows drive letter
  // (`E:/pkg`) matches the same shape and is a LOCAL path; it is excluded here
  // and re-admitted by isLocalInstallSpec, which the caller checks first.
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return false
  if (/^[\\/.]/.test(text)) return false
  // Split off the version range: the LAST '@' that is not itself the first
  // character starts it (`@scope/pkg` has no range; `@scope/pkg@^1` does).
  const at = text.lastIndexOf('@')
  const name = at > 0 ? text.slice(0, at) : text
  const range = at > 0 ? text.slice(at + 1) : null
  if (range !== null && range === '') return false // a bare trailing `@`
  // An ALIAS can carry the remote reference in its RANGE, where the leading
  // scheme check above never looks: `foo@git+https://host/repo.git`,
  // `foo@github:user/repo`, `git@github.com:host/repo.git` (scp-ish) — pnpm
  // fetches exactly that spec and runs its prepare. A semver range or a
  // dist-tag never contains `:` or `/`, and every remote reference does, so
  // one character class closes the bypass without narrowing real ranges.
  if (range !== null && /[:/]/.test(range)) return false
  const segments = name.split('/')
  if (segments.length > 2) return false
  if (segments.some((segment) => segment === '')) return false
  if (segments.length === 2 && !/^@[A-Za-z0-9._-]+$/.test(segments[0])) return false
  return /^[A-Za-z0-9._-]+$/.test(segments[segments.length - 1])
}

/**
 * Refuse an install operand that the mounted policy does not permit.
 *
 * Only `registry-only` refuses outright. `allow` keeps the documented CLI
 * behaviour (both registry and remote references may build); `local-only` and
 * `deny` leave the spec alone and use `--ignore-scripts` instead — the install
 * still fetches, it just does not execute the fetched build, which is the weaker
 * but non-breaking outcome.
 *
 * This is a WRITE-BOUNDARY check, so it runs before the package manager is
 * spawned: refusing afterwards would already have cloned and built the
 * repository.
 * @param {string} spec - the validated operand.
 * @param {string} [policy] - the mounted policy.
 * @throws {Error} when a remote reference is requested under `registry-only`.
 */
export function assertInstallSpecAllowed(spec, policy = INSTALL_SCRIPTS_POLICY) {
  if (policy !== 'registry-only') return
  if (isLocalInstallSpec(spec) || isRegistryInstallSpec(spec)) return
  throw new Error(
    'plugin-admin: install spec ' + JSON.stringify(String(spec).slice(0, 120))
    + " is a remote repository/protocol reference, which the configured installScripts: 'registry-only' refuses "
    + '(only registry packages and local paths may be installed). Use installScripts: \'allow\' to permit it, '
    + 'or install this plugin through the dsh plugin CLI.'
  )
}

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
  // UNC（`\\server\share\pkg` 与其 POSIX 写法 `//server/share/pkg`）是远程来源，
  // 不是"本机路径"：它会让宿主向调用方指定的主机发起 SMB 认证并构建远端声明的
  // prepare 脚本——同仓 fsAdmin/reveal 拒绝 UNC 的正是这一形状。归为非本地后，
  // registry-only 在 pnpm 启动前拒绝它、local-only 对它加 --ignore-scripts，
  // 与 git/tarball 同类。
  if (/^[\\/]{2}/.test(spec)) return false
  if (/^[\\/]/.test(spec)) return true                                           // POSIX absolute
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
  /** @type {Record<string, string>} */
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
 * @param {string} profileDir - working directory for pnpm.
 * @param {string[]} args - pnpm arguments.
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
    const record = (/** @type {any} */ chunk) => {
      output += chunk
      if (output.length > 16_384) output = output.slice(-8_192)
    }
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    const timer = setTimeout(() => {
      if (child.pid !== undefined) killProcessTree(child.pid)
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
    const pkg = readProfileManifest(profileDir)
    const dependencies = new Map(Object.entries(pkg.dependencies ?? {}))
    const bundles = /** @type {string[]} */ (pkg.dsh?.profile?.bundles ?? [])
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
        // The raw dependency spec (`^1.2.3`, `github:user/repo`, `file:…`) so
        // the update checker can tell a registry-resolvable dependency from a
        // git/tarball one — querying the registry for a git-installed bundle
        // either 404s (per-refresh "无法查询远程版本" noise) or, worse, finds a
        // same-named PUBLIC package and shows its 'latest' as an update.
        installSpec: dependencies.get(name) ?? null,
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
     * @param {any} force - true to bypass the TTL cache and refresh cached content.
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
        const result = await checkPluginUpdate(registry, plugin, plugin.installSpec)
        if (result.latest !== null) {
          updateCache.set(plugin.name, { at: now, latest: result.latest })
        }
        return result
      })
      const updates = [...cached, ...fresh]
      return { updates, checkedAt: now }
    },

    /** @param {string} spec */
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
      // Policy refusal BEFORE the package manager runs: under
      // `installScripts: 'registry-only'` a remote repository/protocol reference
      // is not permitted at all, and the only moment that means anything is
      // before pnpm has cloned and built it.
      assertInstallSpecAllowed(operand)
      return enqueue(async () => {
        // 版本快照（不只是名字集合）：更新是 `pnpm add pkg@2.0` 落在既有依赖
        // 上——名字集合不动、只有版本动。只记名字会让更新路径完全绕过 peer
        // 兼容预检，装出「成功、重启后被宿主跳过」的插件（ARCHITECTURE §3
        // 承诺安装与更新都预检）。
        const before = profileDependencyVersions(profileDir)
        let output
        try {
          output = await runPnpm(profileDir, ['add', operand])
        } catch (error) {
          // pnpm v11 exits non-zero when a run newly installs native packages
          // whose build scripts are not approved (ERR_PNPM_IGNORED_BUILDS)
          // even though the add itself completed and mutated the manifest —
          // the same tolerance ensureProfileDependency applies to its own
          // adds. Report failure only when the dependency set did NOT grow;
          // otherwise the panel would show "install failed" over a manifest
          // that DID change, with reconcile/compat skipped until the next
          // successful operation healed the drift.
          if (!String(error).includes('ERR_PNPM_IGNORED_BUILDS')) throw error
          const after = profileDependencyNames(profileDir)
          const landed = [...after].filter((name) => !before.has(name))
          if (landed.length === 0) throw error
          output = String(error) + `\n(dependencies landed in package.json: ${landed.join(', ')} — native build scripts were not approved; run \`pnpm approve-builds\` in the profile if they are needed)`
        }
        reconcileBundles(profileDir)
        const compat = assessInstalledCompat(profileDir, before)
        return { output, compat, ...listLayers() }
      })
    },

    /** @param {string} name */
  async remove(name) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('plugin-admin: remove requires a package name')
      }
      const operand = assertPnpmOperand('package name', name)
      const dependencies = new Set(Object.keys(readProfileManifest(profileDir).dependencies ?? {}))
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
     * @param {string} name - the bundle (package) name.
     * @param {any} disabled - true to disable, false to re-enable.
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
      return enqueue(async () => {
        // In-box bundles (the base / web-app layers) are not profile
        // dependencies and are not the user's to switch off: disabling every
        // composing row of a core bundle would strip the profile's own
        // services. The panel only renders the toggle for dependency-managed
        // plugins (removable); this is the host-side half of the same rule.
        //
        // The dependency check AND the rowIds resolution live INSIDE the
        // queue slot (remove() runs its pnpm + patch cleanup there too): run
        // outside, a concurrent remove could delete the dependency and clear
        // its disable rows between this call's checks and its queued write,
        // and upsertDisableRows would then re-author bare `- id:` +
        // `disabled: true` rows for a bundle that no longer exists — orphan
        // overrides that silently disable the plugin if it is ever
        // reinstalled under the same row ids.
        const dependencies = new Set(Object.keys(readProfileManifest(profileDir).dependencies ?? {}))
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
