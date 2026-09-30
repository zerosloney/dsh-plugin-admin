/**
 * verify-strict-track.mjs — the strict tracks' include lists must be honest.
 *
 * Two tsconfigs turn on `noImplicitAny` over GROWING lists of entry files —
 * one for the host half (`tsconfig.strict.json`, covering `lib/**`) and one
 * for the browser half (`tsconfig.strict-client.json`, covering
 * `src/client/**`) — and the docs quote a coverage number for each. Two
 * things can silently drift:
 *
 * 1. THE LIST CAN ROT. `tsc` follows imports, so an entry only stays clean
 * while its whole transitive closure does. Edit an imported module — add an
 * untyped callback parameter, an untyped object literal — and the track
 * fails, which is the point of the gate, but the FAILURE lands on whichever
 * run-gate step happens to run the typecheck, with no hint that the cause is
 * a module nobody touched on purpose.
 * 2. THE QUOTED NUMBER CAN LIE. The docs say how many files are covered;
 * that number is derived from the entry list plus the import graph, so adding
 * an entry without updating the prose (or the reverse) is invisible.
 *
 * This scan recomputes both coverages from the configs and the real import
 * graphs, and asserts that every listed entry is a real file that the track
 * actually checks. It deliberately does NOT re-run `tsc` (that is the
 * `check:types-strict*` steps' job) — it checks the CLAIM, cheaply, in
 * seconds.
 *
 * The two halves are independent configs on purpose: the flag only folds
 * into `tsconfig.json` once BOTH halves are fully covered, and until then
 * each track guards its own half. A track that stopped extending
 * `tsconfig.json` directly could also inherit another flag and silently
 * check less than it claims.
 *
 * Run: node scripts/verify-strict-track.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const ROOT = process.cwd()
const LIB = join(ROOT, 'lib')

/** Strip `//` comments so the config parses as JSON (it is JSONC by design). */
const readJsonc = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, ''))

let failures = 0
function check(name, fn) {
  try { fn(); console.log(` ok ${name}`) } catch (error) {
    failures += 1
    console.error(` FAIL ${name}: ${error.message}`)
  }
}

/**
 * The tracks: one config, one flag, one entry list each. `graph` picks the
 * import graph the coverage is derived from; `docPhrase` is the Chinese noun
 * CONTRIBUTING uses for that half's total. Floors only rise.
 */
const TRACKS = [
  { key: 'strict (host half)', config: 'tsconfig.strict.json', flag: 'noImplicitAny', floor: 39, graph: 'lib', docPhrase: '宿主文件' },
  { key: 'strict-client (browser half)', config: 'tsconfig.strict-client.json', flag: 'noImplicitAny', floor: 15, graph: 'client', docPhrase: '浏览器文件' },
]

for (const track of TRACKS) {
  const cfg = readJsonc(join(ROOT, track.config))
  console.log(`verify-strict-track: ${cfg.include.filter((p) => p.endsWith('.js')).length} entry file(s) under noImplicitAny (${track.key})`)
}

// Each track sets its OWN flag and extends the main config directly. The
// host track also inherits `strictNullChecks` from tsconfig.json (that flag
// is a default since the strict-null track folded after 39/39) — safe because
// every file in both halves was already cleaned under it. The guard only
// enforces the noImplicitAny claim; inherited strictNullChecks is a
// whole-repo property, not something either track adds.
check('each track sets its own flag and extends the main config directly', () => {
  for (const track of TRACKS) {
    const cfg = readJsonc(join(ROOT, track.config))
    assert.equal(cfg.compilerOptions?.[track.flag], true, `${track.config} must set ${track.flag}: true`)
    assert.equal(
      cfg.extends,
      './tsconfig.json',
      `${track.config} must extend ./tsconfig.json directly — inheriting the other track would let its flag mask this one's findings`,
    )
  }
})

check('every listed entry exists', () => {
  for (const track of TRACKS) {
    const cfg = readJsonc(join(ROOT, track.config))
    for (const entry of cfg.include.filter((p) => p.endsWith('.js'))) {
      assert.ok(existsSync(join(ROOT, entry)), `${entry} is listed in ${track.config} but does not exist`)
    }
  }
})

check('each list only ever grows (no silent removal)', () => {
  // The mechanism's contract: entries are added as modules are modelled, never
  // dropped. A shrinking list would quietly reduce coverage while the docs
  // still quote the old number. Each floor is the current size — raise it when
  // entries are added, never lower it.
  for (const track of TRACKS) {
    const cfg = readJsonc(join(ROOT, track.config))
    const count = cfg.include.filter((p) => p.endsWith('.js')).length
    assert.ok(
      count >= track.floor,
      `the ${track.key} track shrank to ${count} entries; the list only grows (raise this floor when adding entries)`,
    )
  }
})

check('noImplicitAny is actually on in both tracks', () => {
  for (const track of TRACKS) {
    const cfg = readJsonc(join(ROOT, track.config))
    assert.equal(cfg.compilerOptions?.noImplicitAny, true, `${track.config} must set noImplicitAny: true`)
  }
})

/**
 * The intra-repo import graphs, so coverage can be computed the way `tsc`
 * sees it. 'lib' is flat; 'client' walks `src/client` recursively.
 * @param {'lib'|'client'} kind
 * @returns {Map<string, Set<string>>} file -> its relative imports.
 */
function buildGraph(kind) {
  const graph = new Map()
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      // The host graph skips the BUILT client artifacts (lib/client.js and
      // lib/client.panels.js are build products of src/client now — guarded by
      // build:client --check, not typed by this track).
      if (dir === LIB && entry.name.startsWith('client')) continue
      if (!entry.name.endsWith('.js')) continue
      const src = readFileSync(full, 'utf8')
      const deps = new Set()
      for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
        deps.add(relative(ROOT, resolve(dir, m[1])).replace(/\\/g, '/'))
      }
      graph.set(relative(ROOT, full).replace(/\\/g, '/'), deps)
    }
  }
  if (kind === 'lib') walk(LIB)
  else walk(join(ROOT, 'src/client'))
  return graph
}

const graphs = { lib: buildGraph('lib'), client: buildGraph('client') }

/**
 * One entry's transitive import closure (itself included), as `tsc` would
 * load it.
 * @param {Map<string, Set<string>>} graph
 * @param {string} entry - a repo-relative path.
 * @returns {Set<string>}
 */
function closureOf(graph, entry) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length > 0) {
    const current = stack.pop()
    if (seen.has(current)) continue
    seen.add(current)
    for (const dep of graph.get(current) ?? []) stack.push(dep)
  }
  return seen
}

check('every entry resolves inside its own graph (an entry outside the graph would be unchecked)', () => {
  for (const track of TRACKS) {
    const graph = graphs[track.graph]
    const cfg = readJsonc(join(ROOT, track.config))
    for (const entry of cfg.include.filter((p) => p.endsWith('.js'))) {
      assert.ok(graph.has(entry), `${entry} (${track.config}) is not a ${track.graph === 'lib' ? 'lib' : 'src/client'}/*.js module, so its coverage cannot be derived`)
    }
  }
})

/**
 * Coverage of one track: entries plus their transitive import closures,
 * counted only over the files that half actually owns (a client entry's
 * closure can reach a lib file — it is already covered by the other track).
 * @param {(typeof TRACKS)[number]} track
 * @returns {Set<string>}
 */
const coverageOf = (track) => {
  const graph = graphs[track.graph]
  const cfg = readJsonc(join(ROOT, track.config))
  const set = new Set()
  for (const entry of cfg.include.filter((p) => p.endsWith('.js'))) {
    for (const f of closureOf(graph, entry)) if (graph.has(f)) set.add(f)
  }
  return set
}

const covered = coverageOf(TRACKS[0])
const coveredClient = coverageOf(TRACKS[1])

check('the docs quote the real coverage numbers', () => {
  const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')
  for (const track of [TRACKS[0], TRACKS[1]]) {
    const coveredSet = track === TRACKS[0] ? covered : coveredClient
    const total = graphs[track.graph].size
    // The prose is "覆盖 **<total> 个<Noun>文件中的 <covered> 个**" (total first).
    const match = new RegExp(`覆盖 \\*\\*(\\d+) 个${track.docPhrase}中的 (\\d+) 个\\*\\*`).exec(contributing)
    assert.ok(match, `CONTRIBUTING.md should state the ${track.key} coverage as "覆盖 **<total> 个${track.docPhrase}中的 <covered> 个**"`)
    assert.equal(Number(match[1]), total, `CONTRIBUTING says ${match[1]} ${track.docPhrase} exist; the graph has ${total}`)
    assert.equal(Number(match[2]), coveredSet.size, `CONTRIBUTING says ${match[2]} are covered; ${track.config} actually covers ${coveredSet.size}`)
  }
})

console.log(`verify-strict-track: noImplicitAny host half ${covered.size}/${graphs.lib.size} · browser half ${coveredClient.size}/${graphs.client.size}`)
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('strict-track scan OK')
