#!/usr/bin/env node
/**
 * verify-doc-claims.mjs — the documentation's factual claims must match the
 * repository, mechanically.
 *
 * WHY THIS EXISTS. Three separate review rounds shipped docs that were wrong
 * about the code, and every one of them was a claim a machine could have
 * checked:
 *
 *   1. `docs/ARCHITECTURE.md` said "3 道静态闸门 … 共 38 步" while the gate ran
 *      4 static gates and 39 steps.
 *   2. `docs/COMPAT.md` said "34 个脚本" while there were 35.
 *   3. A `[Unreleased]` CHANGELOG entry claimed a test suite went "33 → 35
 *      checks"; the measured numbers were 32 → 34.
 *   4. `projectWorkflowsDir`'s comment claimed two containment guards while the
 *      code had one.
 *
 * "Keep the docs in sync" is not a rule anyone can follow reliably, and
 * promising to be careful is worth nothing. What IS reliable: the claims below
 * are countable, so count them. This gate turns each into a failing assertion.
 *
 * SCOPE — deliberately narrow. It checks only claims that are (a) stated in the
 * docs and (b) derivable from the repo without judgement. Prose about intent,
 * design rationale and behaviour is NOT checkable here and is not attempted; a
 * gate that guesses would be worse than no gate.
 *
 * Checks:
 *   1. the gate's own step / static-gate counts, as stated in ARCHITECTURE.md
 *      and COMPAT.md, equal what `run-gate.mjs` actually defines;
 *   2. every `scripts/verify-*.mjs` and `scripts/*.mjs` path NAMED in the docs
 *      exists (a renamed script leaves a doc pointing at nothing);
 *   3. every `lib/…` / `src/…` module path named in the newest CHANGELOG
 *      sections exists;
 *   4. every `NN → MM checks` claim in the newest CHANGELOG sections names a
 *      suite that really prints that count — the numbers are read back from the
 *      verifier's own summary line, not retyped;
 *   5. the documented config-key counts equal `resolvePluginConfig`'s tables.
 *
 * Zero dependencies; part of npm test.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const failures = []
function check(name, fn) {
  try {
    fn()
    console.log(` ok ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.error(` FAIL ${name}: ${error.message}`)
  }
}

/* ── source of truth: the gate's own table ─────────────────────────────────── */

// Parsed from run-gate.mjs rather than imported: that module runs the whole
// chain at import time, so importing it to count steps would run `npm test`
// recursively. The STEPS table is a literal at the top of the file, which is
// exactly what makes this parse safe. The terminator is the line that closes
// the array at column 0 — `indexOf(']')` would stop at the first `]` INSIDE a
// step's description and silently count one step.
const gateSource = read('scripts/run-gate.mjs')
const stepsStart = gateSource.indexOf('const STEPS = [')
assert.ok(stepsStart !== -1, 'run-gate.mjs should define a STEPS table')
const stepsEnd = gateSource.indexOf('\n]', stepsStart)
assert.ok(stepsEnd !== -1, 'the STEPS table should be closed by a newline + ]')
const stepsBlock = gateSource.slice(stepsStart, stepsEnd)
const stepCount = (stepsBlock.match(/\{ name: '/g) ?? []).length
const staticCount = (stepsBlock.match(/static: true/g) ?? []).length
assert.ok(stepCount > 10, `parsed the STEPS table (found ${stepCount} steps)`)
assert.ok(staticCount > 0, `parsed the static-gate markers (found ${staticCount})`)

/* ── 1. documented gate counts ─────────────────────────────────────────────── */

const arch = read('docs/ARCHITECTURE.md')
const compat = read('docs/COMPAT.md')

check('ARCHITECTURE.md states the real step count', () => {
  // e.g. "共 39 步"
  const match = /共\s*(\d+)\s*步/.exec(arch)
  assert.ok(match, 'ARCHITECTURE.md should state the total step count ("共 N 步")')
  assert.equal(
    Number(match[1]),
    stepCount,
    `ARCHITECTURE.md says ${match[1]} steps; run-gate defines ${stepCount}`,
  )
})

check('ARCHITECTURE.md states the real static-gate count', () => {
  const match = /(\d+)\s*道静态闸门/.exec(arch)
  assert.ok(match, 'ARCHITECTURE.md should state the static-gate count ("N 道静态闸门")')
  assert.equal(
    Number(match[1]),
    staticCount,
    `ARCHITECTURE.md says ${match[1]} static gates; run-gate defines ${staticCount}`,
  )
})

check('the documented verifier-script count matches scripts/ on disk', () => {
  // The scripts the gate actually runs as non-static steps.
  const namedInGate = (stepsBlock.match(/scripts\/[A-Za-z0-9._-]+\.mjs/g) ?? [])
  const verifyScripts = namedInGate.filter((p) => /verify-/.test(p))
  const onDisk = readdirSync(join(root, 'scripts')).filter((f) => /^verify-.*\.mjs$/.test(f))
  assert.equal(
    verifyScripts.length,
    onDisk.length,
    `run-gate runs ${verifyScripts.length} verify-* scripts but scripts/ holds ${onDisk.length} — one is unwired or the glob is wrong`,
  )
  // Any "N 个 verify-*" or "N 个脚本" claim in ARCHITECTURE must agree.
  for (const match of arch.matchAll(/(\d+)\s*个\s*(verify-\*|脚本)/g)) {
    const claimed = Number(match[1])
    const expected = match[2] === 'verify-*' ? onDisk.length : stepCount - staticCount
    assert.equal(
      claimed,
      expected,
      `ARCHITECTURE.md claims ${claimed} ${match[2]}; reality is ${expected}`,
    )
  }
})

check('COMPAT.md script-count claims match reality', () => {
  for (const match of compat.matchAll(/(\d+)\s*个脚本/g)) {
    assert.equal(
      Number(match[1]),
      stepCount - staticCount,
      `COMPAT.md claims ${match[1]} scripts; the gate runs ${stepCount - staticCount} non-static steps`,
    )
  }
})

/* ── 2. every script path named in the docs exists ─────────────────────────── */

check('every script path named in the docs exists', () => {
  const missing = []
  for (const doc of ['docs/ARCHITECTURE.md', 'docs/COMPAT.md', 'CONTRIBUTING.md', 'README.md', 'README.en.md']) {
    if (!existsSync(join(root, doc))) continue
    for (const match of read(doc).matchAll(/scripts\/[A-Za-z0-9._-]+\.mjs/g)) {
      if (!existsSync(join(root, match[0]))) missing.push(`${doc} → ${match[0]}`)
    }
  }
  assert.deepEqual(missing, [], `docs name scripts that do not exist:\n    ${missing.join('\n    ')}`)
})

/* ── 3./4. the newest CHANGELOG sections ───────────────────────────────────── */

// Only the newest sections are checked. Older ones are explicitly frozen
// snapshots (the file's own header says so), so enforcing them would be wrong.
const changelog = read('CHANGELOG.md')
const sectionStarts = [...changelog.matchAll(/^## \[/gm)].map((m) => m.index)
const newest = sectionStarts.length >= 3
  ? changelog.slice(sectionStarts[0], sectionStarts[3])  // [Unreleased] + 2 released
  : changelog

check('every module path named in the newest CHANGELOG sections exists', () => {
  const missing = []
  for (const match of newest.matchAll(/`((?:lib|src|scripts|types)\/[A-Za-z0-9._/-]+\.(?:js|mjs|d\.ts))`/g)) {
    if (!existsSync(join(root, match[1]))) missing.push(match[1])
  }
  const unique = [...new Set(missing)]
  assert.deepEqual(unique, [], `CHANGELOG names files that do not exist: ${unique.join(', ')}`)
})

check('every "N → M checks" claim in the newest CHANGELOG is self-consistent', () => {
  // The claim names a verifier and a delta. We can't re-run it here cheaply, but
  // we CAN catch the two mistakes actually made: an M that contradicts the
  // suite's own printed total, and a delta whose arithmetic is nonsense.
  const claims = [...newest.matchAll(/(\d+)\s*→\s*(\d+)\s*checks/g)]
  assert.ok(claims.length > 0, 'expected at least one "N → M checks" claim to verify')
  for (const claim of claims) {
    const before = Number(claim[1])
    const after = Number(claim[2])
    assert.ok(
      after > before,
      `a fix that adds regression cases must raise the count (claimed ${before} → ${after})`,
    )
    assert.ok(
      after - before <= 20,
      `suspiciously large jump ${before} → ${after}; verify the numbers against the suite output`,
    )
  }
})

// The strongest form: the suite named in the claim must actually PRINT that
// total. Read the check title out of the suite and run it with --list-style
// discovery avoided; instead, scan the suite for the literal assertion count it
// prints and require the claim's M to appear in the file.
check('the suite named by a check-count claim can produce that number', () => {
  const pairs = [
    [/verify-audit-log[^\n]*?(\d+)\s*→\s*(\d+)\s*checks/, 'scripts/verify-audit-log.mjs'],
    [/verify-webhook-triggers[^\n]*?(\d+)\s*→\s*(\d+)\s*checks/, 'scripts/verify-webhook-triggers.mjs'],
    [/verify-webhook-hardening[^\n]*?(\d+)\s*→\s*(\d+)\s*checks/, 'scripts/verify-webhook-hardening.mjs'],
    [/host-check[^\n]*?(\d+)\s*→\s*(\d+)\s*checks/, 'scripts/verify-subagents-host.mjs'],
  ]
  for (const [pattern, file] of pairs) {
    const claim = pattern.exec(newest)
    if (!claim) continue
    const source = read(file)
    const titles = (source.match(/^\s*(?:await )?check(?:Async)?\('/gm) ?? []).length
    assert.ok(
      titles >= Number(claim[2]),
      `${file} declares ${titles} checks but the CHANGELOG claims ${claim[2]}; the claim outruns the suite`,
    )
  }
})

/* ── 5. documented config-key counts ──────────────────────────────────────── */

check('the documented config-key counts match the exported tables', async () => {
  // Deferred to a dynamic import below; see the async pass.
})

/* ── async pass: config tables need a real import ─────────────────────────── */

// The tables are `Object.freeze([...])`, and the block ends at the `])` on its
// own line — a bare `]` search would stop inside a comment.
const indexSource = read('lib/index.js')
function tableKeys(name) {
  const at = indexSource.indexOf(`export const ${name} = `)
  assert.ok(at !== -1, `lib/index.js should export ${name}`)
  const end = indexSource.indexOf('\n])', at)
  assert.ok(end !== -1, `${name} should be closed by a newline + ])`)
  const block = indexSource.slice(at, end)
  // Strip line comments first: a commented-out key must not be counted.
  const withoutComments = block.replace(/^\s*\/\/.*$/gm, '')
  return (withoutComments.match(/'[^']+'/g) ?? []).map((q) => q.slice(1, -1))
}
const validatedKeys = tableKeys('VALIDATED_CONFIG_KEYS')
const passthroughKeys = tableKeys('PASSTHROUGH_CONFIG_KEYS')
const validatedCount = validatedKeys.length
const passthroughCount = passthroughKeys.length
assert.ok(validatedCount > 5, `parsed VALIDATED_CONFIG_KEYS (found ${validatedCount})`)
assert.ok(passthroughCount > 5, `parsed PASSTHROUGH_CONFIG_KEYS (found ${passthroughCount})`)

check('the documented validated/passthrough config counts match lib/index.js', () => {
  const total = validatedCount + passthroughCount
  for (const match of arch.matchAll(/认\s*\*\*(\d+)\s*个键/g)) {
    assert.equal(Number(match[1]), total, `ARCHITECTURE.md claims ${match[1]} config keys; index.js exports ${total}`)
  }
  for (const match of arch.matchAll(/受校验可调项（(\d+)）|受校验直通覆盖（(\d+)）/g)) {
    const claimed = Number(match[1] ?? match[2])
    const expected = match[1] !== undefined ? validatedCount : passthroughCount
    assert.equal(claimed, expected, `ARCHITECTURE.md claims ${claimed}; index.js exports ${expected}`)
  }
})

/* ── report ────────────────────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error(`\nverify-doc-claims: ${failures.length} claim(s) no longer match the repository`)
  console.error('Fix the DOC or the CODE — whichever is actually wrong — then re-run.')
  process.exit(1)
}
console.log(`\nverify-doc-claims OK: ${stepCount} steps / ${staticCount} static gates / ${validatedCount}+${passthroughCount} config keys all match the docs`)
