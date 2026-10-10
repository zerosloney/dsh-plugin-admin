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
/**
 * A parsed semantic version: the core triple plus its prerelease identifiers
 * (build metadata is accepted and ignored, matching semver precedence).
 * @typedef {{ major: number, minor: number, patch: number, pre: string[] }} ParsedVersion
 */
/** Cached runtime version once resolved (null = resolution failed). */
/** @type {string|null|undefined} */
let cachedRuntimeVersion
let cacheResolved = false

/* ============================== versions ============================== */

/**
 * Parse a semantic version (core triple + optional prerelease; build metadata
 * is accepted and ignored, matching semver precedence rules).
 * @param {unknown} value
 * @returns {ParsedVersion | null}
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
 * @param {ParsedVersion} a - left version.
 * @param {ParsedVersion} b - right version.
 * @returns {number} negative when a < b, 0 when equal, positive when a > b.
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
  /** @param {number} position - the regex capture group to test. */
  const wild = (position) => match[position] === undefined || /^[xX*]$/.test(match[position])

  // Bare wildcards: `*` matches everything; `1` / `1.x` pin the major;
  // `1.2` / `1.2.x` pin the minor.
  if (operator === '' && (wild(2) || wild(3))) {
    if (wild(2)) return true
    if (Number(match[2]) !== version.major) return false
    return wild(3) ? true : Number(match[3]) === version.minor
  }
  // With a wildcard major the host's desugar goes all-or-nothing
  // (replaceXRange): `^x` / `~x` / `>=x` / `<=x` / `=x` become `*` (match
  // all), `>x` / `<x` become `<0.0.0-0` (match nothing). A prerelease on
  // the wildcard (`^x-beta`) is unparseable there and fails the whole
  // satisfies — refuse it instead of falling into the all-or-nothing arm.
  if (wild(2)) return match[5] === undefined && operator !== '>' && operator !== '<'

  const major = Number(match[2])
  const minorWild = wild(3)
  const patchWild = wild(4)
  const minor = minorWild ? 0 : Number(match[3])
  const patch = patchWild ? 0 : Number(match[4])
  const pre = match[5] === undefined ? [] : match[5].split('.').filter((part) => part !== '')
  // The host's strict grammar attaches a prerelease only to a full triple,
  // so a partial-with-prerelease (`>=1.2-beta`) is unparseable there — fail
  // closed likewise rather than guess a bound for it.
  const partial = minorWild || patchWild
  if (partial && pre.length > 0) return false
  const lower = { major, minor, patch, pre }
  const order = compareParsed(version, lower)

  // The host never compares against these raw strings: node-semver's
  // desugar (classes/range.js) rewrites every comparator first, and with
  // includePrerelease every band edge it synthesizes is fenced at `-0`, the
  // triple's lowest prerelease. A fence admits the edge triple's own
  // prereleases (1.3.0-rc.1 on `>1.2` = `>=1.3.0-0`) while excluding the
  // release itself and anything above (1.3.0 there; 2.0.0-rc.1 on `^1.2.3`
  // = `>=1.2.3 <2.0.0-0`). A FULL lower bound stays verbatim (`^0.1.6` =
  // `>=0.1.6`), so a prerelease of that very triple (0.1.6-rc.1) still
  // falls below it. Branch comments name the desugar each one mirrors.
  const fencedOrder = partial ? compareParsed(version, { major, minor, patch, pre: ['0'] }) : order
  if (operator === '^') {
    // ^1.2.3 = >=1.2.3 <2.0.0-0; ^0.2.3 = >=0.2.3 <0.3.0-0; ^0.0.3 =
    // >=0.0.3 <0.0.4-0 (replaceCaret). The ceiling is always `-0`-fenced;
    // `^0.x` is the same shape with an always-true zero floor.
    /** @type {ParsedVersion} */
    const ceiling = minorWild
      ? { major: major + 1, minor: 0, patch: 0, pre: [] }
      : major > 0
        ? { major: major + 1, minor: 0, patch: 0, pre: [] }
        : patchWild || minor > 0
          ? { major: 0, minor: minor + 1, patch: 0, pre: [] }
          : { major: 0, minor: 0, patch: patch + 1, pre: [] }
    return fencedOrder >= 0 && compareParsed(version, { ...ceiling, pre: ['0'] }) < 0
  }
  if (operator === '~') {
    // ~1.2.3 = >=1.2.3 <1.3.0-0 (replaceTilde); the partial ~1.2 / ~1.2.x
    // FENCES its floor (`>=1.2.0-0` — measured on the host's own semver
    // 7.8.4..7.8.5: `~1.2` desugars to `>=1.2.0-0 <1.3.0-0`, so 1.2.0-rc.1
    // is admitted), unlike the FULL lower bound which stays literal.
    // ~1 pins the major only.
    if (minorWild) return fencedOrder >= 0 && version.major === major
    return fencedOrder >= 0 && version.major === major && version.minor === minor
  }
  // A partial `>=` floors at the zero-filled triple's `-0` fence
  // (`>=1.2` = `>=1.2.0-0`, `>=1.x` = `>=1.0.0-0`); a full one keeps its
  // literal bound (`>=1.2.3`, prerelease verbatim).
  if (operator === '>=') return fencedOrder >= 0
  if (operator === '<=') {
    // <=1.2 / <=1.2.x = <1.3.0-0 — the 1.2.* band INCLUDED, but the 1.3.0
    // edge and its prereleases excluded; <=1 / <=1.x = <2.0.0-0.
    if (minorWild) return version.major < major + 1
    if (patchWild) return compareParsed(version, { major, minor: minor + 1, patch: 0, pre: ['0'] }) < 0
    return order <= 0
  }
  if (operator === '>') {
    // >1.2 / >1.2.x = >=1.3.0-0 — the 1.2.* band EXCLUDED, its -0 edge
    // included (1.3.0-rc.1); >1 / >1.x = >=2.0.0-0. The old zero-padded
    // literal reading diverged from the host in both directions: it
    // admitted 1.2.5 here (precheck passes, host skips the bundle) and
    // warned on 1.2.5 for `<=1.2` where the host runs it fine.
    if (minorWild) return version.major > major
    if (patchWild) return compareParsed(version, { major, minor: minor + 1, patch: 0, pre: ['0'] }) >= 0
    return order > 0
  }
  if (operator === '<') {
    // <1.2.x = <1.2.0-0, <1.x = <1.0.0-0 (replaceXRange floors the band at
    // the fence — no release or later prerelease reaches it from above).
    if (minorWild) return compareParsed(version, { major, minor: 0, patch: 0, pre: ['0'] }) < 0
    if (patchWild) return compareParsed(version, { major, minor, patch: 0, pre: ['0'] }) < 0
    return order < 0
  }
  // `=` / bare exact, including x-pinned exacts (`=1.x` behaves as `1`).
  if (minorWild) return version.major === major
  if (patchWild) return version.major === major && version.minor === minor
  return order === 0
}

/**
 * A hyphen-range endpoint: a bare (operator-free), possibly partial version.
 */
const HYPHEN_ENDPOINT_RE = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Parse one hyphen-range endpoint. Prerelease identifiers ride full triples
 * only — the host's strict grammar cannot parse a partial-with-prerelease
 * (`1.2-rc.1`) either, so that fails closed here too.
 * @param {string} raw
 * @returns {{ major: number, minor: number, patch: number, majorWild: boolean, minorWild: boolean, patchWild: boolean, pre: string } | null}
 */
function parseHyphenEndpoint(raw) {
  const match = HYPHEN_ENDPOINT_RE.exec(raw.trim())
  if (match === null) return null
  const majorWild = /^[xX*]$/.test(match[1])
  const minorWild = match[2] === undefined || /^[xX*]$/.test(match[2])
  const patchWild = match[3] === undefined || /^[xX*]$/.test(match[3])
  const pre = match[4] === undefined ? '' : `-${match[4]}`
  if ((minorWild || patchWild) && pre !== '') return null
  return {
    majorWild,
    minorWild,
    patchWild,
    major: majorWild ? 0 : Number(match[1]),
    minor: minorWild ? 0 : Number(match[2]),
    patch: patchWild ? 0 : Number(match[3]),
    pre,
  }
}

/**
 * A hyphen range's lower bound, per the host's hyphenReplace with
 * includePrerelease: partial endpoints floor their band at `-0` (`1.2` ->
 * `>=1.2.0-0`), a full endpoint gains `-0` (`1.2.3` -> `>=1.2.3-0`, so its
 * own prereleases are admitted), one with a prerelease keeps it verbatim,
 * and a wildcard major drops the bound entirely.
 * @param {string} raw
 * @returns {string | null} the `>=` comparator, null when unparseable.
 */
function hyphenLowerBound(raw) {
  const endpoint = parseHyphenEndpoint(raw)
  if (endpoint === null) return null
  if (endpoint.majorWild) return '>=0.0.0-0'
  return `>=${endpoint.major}.${endpoint.minor}.${endpoint.patch}${endpoint.pre === '' ? '-0' : endpoint.pre}`
}

/**
 * The matching upper bound: partial endpoints cap the next band
 * (`1.2` -> `<1.3.0-0`), a full endpoint becomes its NEXT patch fenced
 * (`1.4.0` -> `<1.4.1-0` — 1.4.0-rc.1 stays inside, 1.4.1-rc.1 does not),
 * one with a prerelease caps at itself verbatim (`<=1.4.0-rc.1`), and a
 * wildcard major drops the bound entirely.
 * @param {string} raw
 * @returns {string | null} the `<`/`<=` comparator (or `*`), null when unparseable.
 */
function hyphenUpperBound(raw) {
  const endpoint = parseHyphenEndpoint(raw)
  if (endpoint === null) return null
  if (endpoint.majorWild) return '*'
  if (endpoint.pre !== '') return `<=${endpoint.major}.${endpoint.minor}.${endpoint.patch}${endpoint.pre}`
  if (endpoint.minorWild) return `<${endpoint.major + 1}.0.0-0`
  if (endpoint.patchWild) return `<${endpoint.major}.${endpoint.minor + 1}.0-0`
  return `<${endpoint.major}.${endpoint.minor}.${endpoint.patch + 1}-0`
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
    // An operator separated from its version (`>= 1.2`) is one comparator:
    // the host's comparator trim glues the pair back together, and so does
    // this tokenization — a lone trailing operator stays unglued and then
    // fails closed in satisfiesComparator.
    const parts = []
    for (const token of alternative.split(/\s+/)) {
      if (token === '') continue
      if (parts.length > 0 && /^(?:>=|<=|>|<|=|\^|~)$/.test(parts[parts.length - 1])) {
        parts[parts.length - 1] += token
      } else {
        parts.push(token)
      }
    }
    if (parts.length === 0) return false
    // Hyphen ranges: 1.2.3 - 2.0.0. Both endpoints desugar to `-0`-fenced
    // comparators (hyphenLowerBound / hyphenUpperBound) evaluated by the
    // same grammar as any other comparator.
    if (parts.length === 3 && parts[1] === '-') {
      const lowerBound = hyphenLowerBound(parts[0])
      const upperBound = hyphenUpperBound(parts[2])
      if (lowerBound === null || upperBound === null) return false
      return satisfiesComparator(parsed, lowerBound) && satisfiesComparator(parsed, upperBound)
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
  /** @type {Record<string, string>} */
  const peers = {}
  if (peerDependencies === null || typeof peerDependencies !== 'object' || Array.isArray(peerDependencies)) return peers
  const source = /** @type {Record<string, unknown>} */ (peerDependencies)
  for (const [name, range] of Object.entries(source)) {
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
  /** @type {Record<string, string>} */
  const incompatible = {}
  for (const [name, range] of Object.entries(peers ?? {})) {
    if (!satisfiesDshRange(runtimeVersion, range)) incompatible[name] = range
  }
  return { ok: Object.keys(incompatible).length === 0, incompatible }
}

/* ============================== runtime version ============================== */

/**
 * Read `<dir>/node_modules/@deepseek-ai/dsh-app-boot/package.json`'s version.
 * @param {string} dir - the directory whose node_modules to inspect.
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

/**
 * Candidate directories to walk upward from, deduplicated, deepest first.
 * @param {string} start - the directory to start from.
 * @returns {string[]}
 */
function upwardRoots(start) {
  /** @type {string[]} */
  const roots = []
  /** @type {string} */
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
 * The result is cached — but only a POSITIVE one. `null` means "unknown": callers
 * must degrade to NOT checking (a panel note) rather than guessing a version, and
 * caching the unknown pinned it for the whole process after one transient failure
 * (a checkout that had not been built yet, a manifest momentarily unreadable),
 * which switched the post-install peer-compat safety net off for good.
 * @returns {string | null}
 */
export function resolveDshRuntimeVersion() {
  if (cacheResolved) return cachedRuntimeVersion ?? null
  /**
   * Cache a POSITIVE resolution only (see the note above) and return it.
   * @param {string|null} version - the resolved version, or null when unknown.
   * @returns {string|null}
   */
  const cacheAndReturn = (version) => {
    if (version === null) return null
    cachedRuntimeVersion = version
    cacheResolved = true
    return cachedRuntimeVersion
  }
  const override = process.env.DSH_RUNTIME_VERSION
  if (typeof override === 'string' && parseVersion(override) !== null) {
    return cacheAndReturn(override.trim())
  }
  try {
    const resolved = createRequire(import.meta.url).resolve(APP_BOOT_SPEC)
    const raw = JSON.parse(readFileSync(resolved, 'utf8'))?.version
    if (parseVersion(raw) !== null) return cacheAndReturn(raw)
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
      if (version !== null) return cacheAndReturn(version)
    }
  }
  return cacheAndReturn(null)
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
