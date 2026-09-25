/**
 * dsh peer-compatibility preflight for marketplace installs.
 *
 * dsh 0.1.7-rc.1 enforces every plugin's `@deepseek-ai/dsh*` peerDependencies
 * against the running runtime: at boot, `loadProfileDirectory` skips a bundle
 * whose declared range excludes it, and the official installer reports typed
 * refusals with an exact-version escape hatch (`dsh plugin allow-version`).
 * The marketplace panel installs with plain `pnpm add` and post-reconciles,
 * so without this module it can happily install a package the host will then
 * silently never load — the install "succeeds", the plugin vanishes after a
 * restart, and nothing on the panel explains why.
 *
 * This module mirrors the host's admission rule
 * (packages/boot/app-boot/src/plugin-compatibility.ts):
 *
 *   - only `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peers matter;
 *   - `workspace:^` / `workspace:~` / `workspace:*` mean "this runtime";
 *   - ranges evaluate with includePrerelease semantics, so a prerelease
 *     runtime (0.1.7-rc.2) satisfies `^0.1.6` and `>=0.1.6`;
 *   - an empty or unparseable range is INCOMPATIBLE (fail closed, like the
 *     host treats an invalid range).
 *
 * The evaluator is deliberately a reduced semver — enough for the ranges real
 * plugins declare (exact, `^`, `~`, `>=/<=/>/<`, x-ranges, `||` alternatives,
 * hyphen ranges) with zero dependencies. Comparators joined by whitespace are
 * AND-ed, as in npm's range grammar.
 *
 * Zero dsh imports on purpose. The sibling-free design (node builtins only)
 * keeps it unit-testable without a host.
 *
 * @module dsh-plugin-admin/peer-compat
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const APP_BOOT_SPEC = '@deepseek-ai/dsh-app-boot/package.json'
/** Cached runtime version once resolved (null = resolution failed). */
let cachedRuntimeVersion
let cacheResolved = false

/* ============================== versions ============================== */

/**
 * Parse a semantic version (core triple + optional prerelease; build metadata
 * is accepted and ignored, matching semver precedence rules).
 * @param {unknown} value
 * @returns {{ major: number, minor: number, patch: number, pre: string[] } | null}
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? [] : match[4].split('.').filter((part) => part !== ''),
  }
}

/**
 * semver precedence comparison of two parsed versions.
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
function compareParsed(a, b) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  // A release outranks any prerelease of the same triple; shared prefixes
  // compare per identifier (numeric numerically, numeric < alphanumeric),
  // and a longer identifier list outranks its own prefix.
  if (a.pre.length !== b.pre.length && a.pre.length === 0) return 1
  if (a.pre.length !== b.pre.length && b.pre.length === 0) return -1
  const length = Math.max(a.pre.length, b.pre.length)
  for (let i = 0; i < length; i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x) ? Number(x) : null
    const ny = /^\d+$/.test(y) ? Number(y) : null
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny
    } else if (nx !== null) {
      return -1
    } else if (ny !== null) {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/* ============================== ranges ============================== */

const WORKSPACE_SATISFIED = new Set(['workspace:^', 'workspace:~', 'workspace:*'])

/**
 * Evaluate one comparator (a range alternative split on whitespace) against a
 * parsed runtime version. Returns false for anything unparseable — fail closed.
 * @param {{ major: number, minor: number, patch: number, pre: string[] }} version
 * @param {string} raw
 */
function satisfiesComparator(version, raw) {
  const comp = raw.trim()
  if (comp === '' || comp === '*' || comp === 'x' || comp === 'X') return true
  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(comp)
  if (match === null) return false
  const operator = match[1] ?? ''
  const wild = (position) => match[position] === undefined || /^[xX*]$/.test(match[position])

  // Bare wildcards: `*` matches everything; `1` / `1.x` pin the major;
  // `1.2` / `1.2.x` pin the minor.
  if (operator === '' && (wild(2) || wild(3))) {
    if (wild(2)) return true
    if (Number(match[2]) !== version.major) return false
    return wild(3) ? true : Number(match[3]) === version.minor
  }

  const major = Number(match[2])
  const minorWild = wild(3)
  const patchWild = wild(4)
  const minor = minorWild ? 0 : Number(match[3])
  const patch = patchWild ? 0 : Number(match[4])
  const pre = match[5] === undefined ? [] : match[5].split('.').filter((part) => part !== '')
  const lower = { major, minor, patch, pre }
  const order = compareParsed(version, lower)

  // includePrerelease, as the host passes to semver.satisfies: the runtime's
  // own prerelease identifiers never disqualify it — bounds compare on the
  // numeric triple and the ordering above already ranks a prerelease below
  // its same-triple release.
  if (operator === '^') {
    // ^1.2.3 = [1.2.3, 2.0.0); ^0.2.3 = [0.2.3, 0.3.0); ^0.0.3 = [0.0.3, 0.0.4)
    const ceiling = minorWild
      ? { major: major + 1, minor: 0, patch: 0, pre: [] }
      : major > 0
        ? { major: major + 1, minor: 0, patch: 0, pre: [] }
        : patchWild || minor > 0
          ? { major: 0, minor: minor + 1, patch: 0, pre: [] }
          : { major: 0, minor: 0, patch: patch + 1, pre: [] }
    return order >= 0 && compareParsed(version, ceiling) < 0
  }
  if (operator === '~') {
    // ~1.2.3 = [1.2.3, 1.3.0); ~1 pins the major only.
    if (minorWild) return order >= 0 && version.major === major
    return order >= 0 && version.major === major && version.minor === minor
  }
  if (operator === '>=') return order >= 0
  if (operator === '<=') return order <= 0
  if (operator === '>') return order > 0
  if (operator === '<') return order < 0
  // `=` / bare exact, including x-pinned exacts (`=1.x` behaves as `1`).
  if (minorWild) return version.major === major
  if (patchWild) return version.major === major && version.minor === minor
  return order === 0
}

/**
 * Whether a runtime version satisfies one dsh peer range, with the host's
 * workspace-protocol and includePrerelease rules. Unparseable input of any
 * kind answers false.
 * @param {string} version - the running dsh version.
 * @param {string} range - the manifest's peer range.
 * @returns {boolean}
 */
export function satisfiesDshRange(version, range) {
  if (typeof version !== 'string' || typeof range !== 'string') return false
  const parsed = parseVersion(version)
  if (parsed === null) return false
  const trimmed = range.trim()
  if (trimmed === '' || WORKSPACE_SATISFIED.has(trimmed)) {
    // The host treats a MISSING range as incompatible only for a declared
    // empty string; the workspace protocols name the current runtime.
    return trimmed !== ''
  }
  return trimmed.split('||').some((alternative) => {
    const parts = alternative.trim().split(/\s+/).filter((part) => part !== '')
    if (parts.length === 0) return false
    // Hyphen ranges: 1.2.3 - 2.0.0
    if (parts.length === 3 && parts[1] === '-') {
      const lower = parseVersion(parts[0])
      const upperRaw = parseVersion(parts[2])
      if (lower === null || upperRaw === null) return false
      return compareParsed(parsed, lower) >= 0 && compareParsed(parsed, upperRaw) <= 0
    }
    return parts.every((part) => satisfiesComparator(parsed, part))
  })
}

/* ============================== peers ============================== */

/**
 * Filter a manifest peerDependencies map down to the dsh peers the host
 * enforces. Any other peer (esbuild, react, …) is ignored, as at boot.
 * @param {unknown} peerDependencies
 * @returns {Record<string, string>}
 */
export function dshPeersOf(peerDependencies) {
  const peers = {}
  if (peerDependencies === null || typeof peerDependencies !== 'object' || Array.isArray(peerDependencies)) return peers
  for (const [name, range] of Object.entries(peerDependencies)) {
    if (typeof range !== 'string') continue
    if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) peers[name] = range
  }
  return peers
}

/**
 * Evaluate one package's dsh peers against a runtime version.
 * @param {Record<string, string>} peers - {@link dshPeersOf} output.
 * @param {string} runtimeVersion
 * @returns {{ ok: boolean, incompatible: Record<string, string> }}
 */
export function evaluateDshPeerCompat(peers, runtimeVersion) {
  const incompatible = {}
  for (const [name, range] of Object.entries(peers ?? {})) {
    if (!satisfiesDshRange(runtimeVersion, range)) incompatible[name] = range
  }
  return { ok: Object.keys(incompatible).length === 0, incompatible }
}

/* ============================== runtime version ============================== */

/**
 * Read `<dir>/node_modules/@deepseek-ai/dsh-app-boot/package.json`'s version.
 * @returns {string | null}
 */
function appBootVersionAt(dir) {
  const manifest = join(dir, 'node_modules', APP_BOOT_SPEC)
  if (!existsSync(manifest)) return null
  try {
    const raw = JSON.parse(readFileSync(manifest, 'utf8'))?.version
    // Reject non-semver spellings rather than passing them through unchecked.
    return parseVersion(raw) === null ? null : raw
  } catch {
    return null
  }
}

/** Candidate directories to walk upward from, deduplicated, deepest first. */
function upwardRoots(start) {
  const roots = []
  let current
  try {
    current = resolve(start)
  } catch {
    return roots
  }
  while (true) {
    roots.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return roots
}

/**
 * The running dsh runtime version, read the same way the host reads its own:
 * from the app-boot package's manifest. Resolution order:
 *
 *   1. `DSH_RUNTIME_VERSION` env override (deployments the heuristics miss;
 *      also the test hook);
 *   2. Node resolution of `@deepseek-ai/dsh-app-boot/package.json` from this
 *      plugin's own location (host and plugin under one node_modules root);
 *   3. an upward `node_modules` walk from the dsh entry script (`process.argv[1]`,
 *      realpath'd through pnpm's symlink layout);
 *   4. the same walk from the process cwd.
 *
 * The result is cached. `null` means "unknown" — callers must degrade to NOT
 * checking (a panel note) rather than guessing a version.
 * @returns {string | null}
 */
export function resolveDshRuntimeVersion() {
  if (cacheResolved) return cachedRuntimeVersion
  cacheResolved = true
  const override = process.env.DSH_RUNTIME_VERSION
  if (typeof override === 'string' && parseVersion(override) !== null) {
    cachedRuntimeVersion = override.trim()
    return cachedRuntimeVersion
  }
  try {
    const resolved = createRequire(import.meta.url).resolve(APP_BOOT_SPEC)
    const raw = JSON.parse(readFileSync(resolved, 'utf8'))?.version
    if (parseVersion(raw) !== null) {
      cachedRuntimeVersion = raw
      return cachedRuntimeVersion
    }
  } catch {
    /* fall through to the walks */
  }
  const starts = []
  try {
    if (typeof process.argv[1] === 'string' && process.argv[1] !== '') starts.push(realpathSync(process.argv[1]))
  } catch {
    /* argv[1] may be absent (packaged executable) or gone (deleted script) */
  }
  starts.push(process.cwd())
  for (const start of starts) {
    for (const dir of upwardRoots(dirname(start))) {
      const version = appBootVersionAt(dir)
      if (version !== null) {
        cachedRuntimeVersion = version
        return cachedRuntimeVersion
      }
    }
  }
  cachedRuntimeVersion = null
  return cachedRuntimeVersion
}

/**
 * Read one installed package's dsh peers (and exact version) from the
 * profile's node_modules.
 * @param {string} profileDir
 * @param {string} name
 * @returns {{ version: string | null, peers: Record<string, string> } | null}
 *   null when the manifest is unreadable (a path-installed link whose target
 *   vanished, or a non-package).
 */
export function readInstalledDshPeers(profileDir, name) {
  if (typeof name !== 'string' || name.trim() === '') return null
  const manifestPath = join(profileDir, 'node_modules', name, 'package.json')
  if (!existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return {
      version: typeof manifest?.version === 'string' ? manifest.version : null,
      peers: dshPeersOf(manifest?.peerDependencies),
    }
  } catch {
    return null
  }
}

/* ============================== tests only ============================== */

/** Reset the cached runtime version (test isolation). */
export function resetRuntimeVersionCacheForTests() {
  cacheResolved = false
  cachedRuntimeVersion = undefined
}
