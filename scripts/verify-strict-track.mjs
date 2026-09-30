/**
 * verify-strict-track.mjs — the strict track's include list must be honest.
 *
 * `tsconfig.strict.json` turns on `noImplicitAny` over a GROWING list of entry
 * files, and the docs quote a coverage number. Two things can silently drift:
 *
 * 1. THE LIST CAN ROT. `tsc` follows imports, so an entry only stays clean while
 *    its whole transitive closure does. Edit an imported module — add an untyped
 *    callback parameter, an untyped object literal — and the track fails, which
 *    is the point of the gate, but the FAILURE lands on whichever run-gate step
 *    happens to run `check:types-strict`, with no hint that the cause is a module
 *    nobody touched on purpose.
 * 2. THE QUOTED NUMBER CAN LIE. The docs say how many host files are covered;
 *    that number is derived from the entry list plus the import graph, so adding
 *    an entry without updating the prose (or the reverse) is invisible.
 *
 * This scan recomputes the coverage from the config and the real import graph,
 * and asserts that every listed entry is a real file that the track actually
 * checks. It deliberately does NOT re-run `tsc` (that is `check:types-strict`'s
 * job, and it is a run-gate step) — it checks the CLAIM, cheaply, in seconds.
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

/** The tracks: one config, one flag, one entry list each. Both are checked. */
const TRACKS = [
  { key: 'strict', config: 'tsconfig.strict.json', flag: 'noImplicitAny', floor: 21 },
  { key: 'strict-null', config: 'tsconfig.strict-null.json', flag: 'strictNullChecks', floor: 39 },
]

const strict = readJsonc(join(ROOT, 'tsconfig.strict.json'))
const entries = strict.include.filter((p) => p.endsWith('.js'))

console.log(`verify-strict-track: ${entries.length} entry file(s) under noImplicitAny`)

// Every track must set its OWN flag. The null track must NOT inherit the any
// track: `noImplicitAny` widens `let x = null` to a union, which SILENCES the
// very findings the null track exists to catch (measured: 3 errors in
// patch-utils.js under strictNullChecks alone, 0 when the two are stacked).
// Each track therefore extends tsconfig.json directly, and membership in one
// says nothing about the other.
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

check('every listed entry exists (both tracks)', () => {
  for (const track of TRACKS) {
    const cfg = readJsonc(join(ROOT, track.config))
    for (const entry of cfg.include.filter((p) => p.endsWith('.js'))) {
      assert.ok(existsSync(join(ROOT, entry)), `${entry} is listed in ${track.config} but does not exist`)
    }
  }
})

check('each list only ever grows (no silent removal)', () => {
  // The mechanism's contract: entries are added as modules are modelled, never
  // dropped. A shrinking list would quietly reduce coverage while the docs still
  // quote the old number. Each floor is the current size — raise it when entries
  // are added, never lower it.
  for (const track of TRACKS) {
    const cfg = readJsonc(join(ROOT, track.config))
    const count = cfg.include.filter((p) => p.endsWith('.js')).length
    assert.ok(
      count >= track.floor,
      `the ${track.key} track shrank to ${count} entries; the list only grows (raise this floor when adding entries)`,
    )
  }
})

check('noImplicitAny is actually on', () => {
  assert.equal(strict.compilerOptions?.noImplicitAny, true, 'tsconfig.strict.json must set noImplicitAny: true')
})

/**
 * The intra-repo import graph, so coverage can be computed the way `tsc` sees it.
 * @returns {Map<string, Set<string>>} file -> its relative imports.
 */
function buildGraph() {
  const files = readdirSync(LIB).filter((f) => f.endsWith('.js') && !f.startsWith('client'))
  const graph = new Map()
  for (const f of files) {
    const src = readFileSync(join(LIB, f), 'utf8')
    const deps = new Set()
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      deps.add(relative(ROOT, resolve(LIB, m[1])).replace(/\\/g, '/'))
    }
    graph.set('lib/' + f, deps)
  }
  return graph
}

const graph = buildGraph()

/**
 * One entry's transitive import closure (itself included), as `tsc` would load it.
 * @param {string} entry - a repo-relative path.
 * @returns {Set<string>}
 */
function closureOf(entry) {
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

check('every entry resolves inside lib/ (an entry outside the graph would be unchecked)', () => {
  for (const track of TRACKS) {
    const cfg = readJsonc(join(ROOT, track.config))
    for (const entry of cfg.include.filter((p) => p.endsWith('.js'))) {
      assert.ok(graph.has(entry), `${entry} (${track.config}) is not a lib/*.js module, so its coverage cannot be derived`)
    }
  }
})

/** Coverage of one track: entries plus their transitive import closures. */
const coverageOf = (track) => {
  const cfg = readJsonc(join(ROOT, track.config))
  const set = new Set()
  for (const entry of cfg.include.filter((p) => p.endsWith('.js'))) {
    for (const f of closureOf(entry)) set.add(f)
  }
  return set
}

const covered = coverageOf(TRACKS[0])
const coveredNull = coverageOf(TRACKS[1])

check('the docs quote the real coverage number', () => {
  const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')
  const total = graph.size
  // The prose is "覆盖 **<total> 个宿主文件中的 <covered> 个**" (total first).
  const match = /覆盖 \*\*(\d+) 个宿主文件中的 (\d+) 个\*\*/.exec(contributing)
  assert.ok(match, 'CONTRIBUTING.md should state the strict-track coverage as "覆盖 **<total> 个宿主文件中的 <covered> 个**"')
  assert.equal(Number(match[1]), total, `CONTRIBUTING says ${match[1]} host files exist; the graph has ${total}`)
  assert.equal(Number(match[2]), covered.size, `CONTRIBUTING says ${match[2]} are covered; the config actually covers ${covered.size}`)
})

check('the docs quote the strict-null coverage number', () => {
  const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')
  // "strict-null 轨道当前覆盖 **<n> 个**"
  const match = /strict-null 轨道当前覆盖 \*\*(\d+) 个\*\*/.exec(contributing)
  assert.ok(match, 'CONTRIBUTING.md should state the strict-null coverage as "strict-null 轨道当前覆盖 **<n> 个**"')
  assert.equal(
    Number(match[1]),
    coveredNull.size,
    `CONTRIBUTING says the strict-null track covers ${match[1]}; the config actually covers ${coveredNull.size}`,
  )
})

check('the two tracks are independent (neither may subsume the other by flag)', () => {
  // A track that inherited the other's flag would silently check less than it
  // claims. Guard the specific hazard: the null track must not set
  // noImplicitAny (it would mask the findings), and the any track must not set
  // strictNullChecks (it would then fail on files that were never assessed).
  const anyTrack = readJsonc(join(ROOT, 'tsconfig.strict.json'))
  const nullTrack = readJsonc(join(ROOT, 'tsconfig.strict-null.json'))
  assert.notEqual(nullTrack.compilerOptions?.noImplicitAny, true, 'strict-null must NOT enable noImplicitAny — it masks the null findings')
  assert.notEqual(anyTrack.compilerOptions?.strictNullChecks, true, 'the any track must not silently enable strictNullChecks; that is the other track')
})

console.log(`verify-strict-track: noImplicitAny ${covered.size}/${graph.size} host files · strictNullChecks ${coveredNull.size}/${graph.size}`)
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('strict-track scan OK')
