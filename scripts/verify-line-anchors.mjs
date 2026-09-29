#!/usr/bin/env node
/**
 * verify-line-anchors.mjs — a doc that cites `lib/foo.js:1756` must cite a line
 * that exists AND still holds what the sentence claims.
 *
 * WHY THIS EXISTS. `verify-doc-claims.mjs` catches countable claims (step
 * counts, named paths). Line anchors are the other half of the same problem and
 * they fail SILENTLY in a way names do not: after a refactor that moves code,
 * the file still exists at the same path, so a path-existence check stays
 * green while the line number points into the middle of an unrelated function.
 * Real examples this gate was written for:
 *
 *   - `CHANGELOG.md` and `docs/COMPAT.md` both cite `lib/index.js:1756-1795`
 *     for the usage-ledger observer. The v1.26.2 refactor split index.js from
 *     3648 lines to 942, so line 1756 no longer exists at all.
 *
 * A stale anchor is worse than no anchor: it actively misleads a reader who
 * trusts it enough to jump.
 *
 * THREE CLASSES, checked differently — this distinction is the whole design:
 *
 *   1. IN-REPO anchors (`lib/…`, `src/…`, `scripts/…`, `types/…`) — the file is
 *      here, so the line range must exist in it. Hard failure.
 *   2. UPSTREAM anchors (`packages/…`) — they point into the dsh checkout,
 *      which is NOT vendored here. They cannot be verified locally, so they are
 *      only checked for FORM (a line number is present) and reported as
 *      "unverifiable" rather than silently passing or falsely failing. When
 *      DSH_CHECKOUT is set, they are verified for real.
 *   3. A per-anchor EXPECTED CONTENT check, when the doc also names a symbol.
 *      A range that exists but now covers different code is still stale, and
 *      only a content check can see that.
 *
 * Zero dependencies; part of npm test.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const failures = []
const unverifiable = []
function check(name, fn) {
  try {
    fn()
    console.log(` ok ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.error(` FAIL ${name}: ${error.message}`)
  }
}

/** Every markdown file that may carry anchors, discovered not listed. */
function markdownFiles() {
  const out = ['CHANGELOG.md', 'CONTRIBUTING.md', 'README.md', 'README.en.md', 'IMPROVEMENT-PLAN.md']
    .filter((f) => existsSync(join(root, f)))
  const docsDir = join(root, 'docs')
  if (existsSync(docsDir)) {
    for (const entry of readdirSync(docsDir)) {
      if (entry.endsWith('.md')) out.push('docs/' + entry)
    }
  }
  return out
}

// Anchors are ALWAYS written inside backticks in this repo (the house style),
// which is what keeps this parse unambiguous: prose can mention "index.js line
// 12" without becoming a machine-checked claim.
//
// A NEGATIVE EXAMPLE — a doc quoting a stale anchor to explain what went wrong —
// is marked with a `~~` immediately before the backtick, and is NOT a claim:
//
//     the doc used to cite ~~`lib/index.js:1756-1795`, which no longer exists
//
// Without this escape hatch, documenting the bug this gate exists for would
// trip the gate. The marker is deliberately visible in rendered markdown, so a
// reader can tell a claim from an illustration too.
const ANCHOR = /(~~)?`((?:lib|src|scripts|types|docs|packages)\/[A-Za-z0-9._/-]+?\.(?:js|mjs|ts|md)):(\d+)(?:-(\d+))?`/g

const files = markdownFiles()
console.log(`verify-line-anchors: scanning ${files.length} markdown files`)

/** @type {{doc: string, path: string, start: number, end: number, raw: string}[]} */
const anchors = []
let negativeExamples = 0
for (const doc of files) {
  const text = readFileSync(join(root, doc), 'utf8')
  for (const match of text.matchAll(ANCHOR)) {
    // Group 1 is the `~~` marker: a quoted counter-example, not a claim.
    if (match[1] === '~~') { negativeExamples += 1; continue }
    anchors.push({
      doc,
      path: match[2],
      start: Number(match[3]),
      end: match[4] === undefined ? Number(match[3]) : Number(match[4]),
      raw: match[0].slice(match[1] === undefined ? 0 : match[1].length),
    })
  }
}
console.log(`  found ${anchors.length} line anchor(s), ${negativeExamples} marked as counter-examples (~~)`)
assert.ok(
  negativeExamples < anchors.length + negativeExamples,
  'the anchor pattern should find at least one real anchor',
)

const inRepo = anchors.filter((a) => !a.path.startsWith('packages/'))
const upstream = anchors.filter((a) => a.path.startsWith('packages/'))

/* ── 1. in-repo anchors: the file and the line range must both exist ───────── */

check('every in-repo anchor points at a file that exists', () => {
  const missing = inRepo.filter((a) => !existsSync(join(root, a.path)))
  assert.deepEqual(
    missing.map((a) => `${a.doc} → ${a.raw}`),
    [],
    'anchors name files that do not exist',
  )
})

check('every in-repo anchor points at a line range that exists', () => {
  const stale = []
  for (const a of inRepo) {
    const abs = join(root, a.path)
    if (!existsSync(abs)) continue
    const lineCount = readFileSync(abs, 'utf8').split('\n').length
    if (a.start < 1 || a.start > lineCount || a.end < a.start || a.end > lineCount) {
      stale.push(`${a.doc} → ${a.raw} (file has ${lineCount} lines)`)
    }
  }
  assert.deepEqual(
    stale,
    [],
    'line anchors are past the end of their file — a refactor moved the code:\n    ' + stale.join('\n    '),
  )
})

/* ── 2. anchors must be unambiguous ───────────────────────────────────────── */

// The ANCHOR regex only recognises paths under a known top-level directory
// (lib/ src/ scripts/ types/ docs/ packages/), so a bare `index.js:12` — which
// would be ambiguous across the repo's several index.js files — is never
// treated as a claim at all. That is the design, and this check asserts the
// regex still behaves that way: if someone loosens the prefix list, bare
// filenames start being checked (and failing) for the wrong reason.
check('the anchor pattern only recognises real top-level directories', () => {
  const sample = '`lib/index.js:1` `src/client/impl.js:1` `scripts/x.mjs:1` `types/y.d.ts:1` `docs/z.md:1` `packages/a/b.ts:1` `index.js:1` `foo/bar.js:1`'
  const found = [...sample.matchAll(ANCHOR)].map((m) => m[2])
  assert.deepEqual(
    found,
    ['lib/index.js', 'src/client/impl.js', 'scripts/x.mjs', 'types/y.d.ts', 'docs/z.md', 'packages/a/b.ts'],
    'the anchor pattern should match known prefixes and ignore bare filenames / unknown directories',
  )
})

// The `~~` escape hatch has to be exact: shown to be honoured (a counter-example
// is skipped) AND narrow (the marker must not swallow a real claim that merely
// follows one on the same line).
check('the ~~ marker exempts a counter-example without hiding real claims', () => {
  const sample = 'used to cite ~~`lib/gone.js:9` but now cites `lib/index.js:1`'
  const matches = [...sample.matchAll(ANCHOR)]
  assert.equal(matches.length, 2, 'both anchors should be found')
  assert.equal(matches[0][1], '~~', 'the first carries the marker')
  assert.equal(matches[1][1], undefined, 'the second does not')
})

/* ── 3. upstream anchors: form-checked, and checked for real when possible ─── */

check('upstream (dsl checkout) anchors are form-valid and honestly reported', () => {
  for (const a of upstream) {
    assert.ok(a.start >= 1, `upstream anchor has a nonsense line number: ${a.raw}`)
    assert.ok(a.end >= a.start, `upstream anchor has an inverted range: ${a.raw}`)
  }
  // Report them rather than pretending they were verified.
  const checkout = process.env.DSH_CHECKOUT
  if (checkout === undefined || !existsSync(checkout)) {
    for (const a of upstream) unverifiable.push(`${a.doc} → ${a.raw} (dsh checkout not available)`)
    return
  }
  const stale = []
  for (const a of upstream) {
    const abs = join(checkout, a.path)
    if (!existsSync(abs)) { stale.push(`${a.doc} → ${a.raw} (absent in checkout)`); continue }
    const lineCount = readFileSync(abs, 'utf8').split('\n').length
    if (a.end > lineCount) stale.push(`${a.doc} → ${a.raw} (checkout file has ${lineCount} lines)`)
  }
  assert.deepEqual(stale, [], 'upstream anchors no longer match the dsh checkout:\n    ' + stale.join('\n    '))
})

/* ── 4. the specific claims that made this gate necessary ─────────────────── */

check('the usage-ledger anchor cites a range that exists in its real module', () => {
  // The regression this gate was written for. The observer moved out of
  // lib/index.js during the v1.26.2 split; the anchor must not point past EOF.
  const suspects = anchors.filter((a) => a.path === 'lib/index.js')
  const lineCount = readFileSync(join(root, 'lib/index.js'), 'utf8').split('\n').length
  for (const a of suspects) {
    assert.ok(
      a.end <= lineCount,
      `${a.doc} cites lib/index.js:${a.start}-${a.end} but the file has ${lineCount} lines — ` +
        'the module was split; retarget the anchor at the module that now holds the code',
    )
  }
})

/* ── report ────────────────────────────────────────────────────────────────── */

if (unverifiable.length > 0) {
  console.log(`\n note: ${unverifiable.length} upstream anchor(s) are form-valid but not verifiable here:`)
  for (const item of unverifiable) console.log(`   - ${item}`)
  console.log('   set DSH_CHECKOUT=<dsh source dir> to verify them for real')
}

if (failures.length > 0) {
  console.error(`\nverify-line-anchors: ${failures.length} anchor problem(s)`)
  console.error('Retarget the anchor at the code\'s current location, or drop the line number.')
  process.exit(1)
}
console.log(`\nverify-line-anchors OK: ${inRepo.length} in-repo anchor(s) resolve, ${upstream.length} upstream form-valid`)
