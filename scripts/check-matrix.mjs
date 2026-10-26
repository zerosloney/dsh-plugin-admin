#!/usr/bin/env node
/**
 * Multi-checkout seam matrix (Phase G2).
 *
 * integration-check.mjs answers "does this dsh checkout still expose every
 * seam the plugin rides?" for ONE checkout. This runner asks it of several, so
 * "supported dsh versions" stops being a promise in a doc and becomes a loop
 * over directories with a per-checkout verdict.
 *
 * Usage:
 *   DSH_CHECKOUTS="D:/dsh/0.2.0-rc.1, D:/dsh/next" node scripts/check-matrix.mjs
 *   node scripts/check-matrix.mjs            # falls back to $DSH_CHECKOUT, then
 *                                            # the sibling deepseek-harness
 *
 * A directory with no dsh package.json is reported as SKIPPED. The skip is only
 * forgiven when the checkout list was IMPLICIT (the sibling fallback): if the
 * list came from DSH_CHECKOUTS / DSH_CHECKOUT — or we are running under CI —
 * then probing zero checkouts is a misconfiguration, and "0 probed, no drift"
 * must never read as a green gate. Any PRESENT checkout that drifts fails the
 * whole matrix: that is the point of the matrix.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const checker = join(here, 'integration-check.mjs')

// An explicit list (or CI) makes "nothing to probe" a failure; the implicit
// sibling fallback keeps a machine without a checkout green, exactly like
// integration-check does on its own.
const explicit = process.env.DSH_CHECKOUTS !== undefined || process.env.DSH_CHECKOUT !== undefined
const requireProbe = explicit || (process.env.CI !== undefined && process.env.CI !== '')
const raw = process.env.DSH_CHECKOUTS ?? process.env.DSH_CHECKOUT ?? join(here, '..', '..', 'deepseek-harness')

// EARLY-WARNING ROWS (v1.31). docs/COMPAT.md calls the `master` checkout an
// "early-warning row: routine upstream refactors are expected to pass, a
// contract change must trip here first" — but the matrix used to treat every
// drift as a hard failure, so routine churn on master turned the gate red and
// taught maintainers to ignore it. That is exactly the "a permanently red gate
// is not a gate" failure the v1.29.0 audit called out.
//
// A checkout whose path contains one of these markers is probed and REPORTED,
// but its drift does not fail the run: the baseline and the support floor still
// decide pass/fail. Annotate the master checkout with `DSH_EARLY_WARNING`
// (a comma list of path substrings) — the default matches the `.dsh-main` path
// ci.yml and seam-early-warning.yml both use, so nothing has to be passed twice.
// ONLY the checkout directory name — never a repository name. Matching
// `deepseek-harness` would also demote a local baseline checkout (the sibling
// fallback, and this repo's own dev path) to a warning, so real drift against
// the version we claim to support would stop failing the gate.
const EARLY_WARNING_MARKERS = (process.env.DSH_EARLY_WARNING ?? '.dsh-main')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '')
/** @param {string} path @returns {boolean} */
const isEarlyWarning = (path) => EARLY_WARNING_MARKERS.some((marker) => path.includes(marker))

const checkouts = raw
  .split(/[,;]/)
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '')
  .map((entry) => resolve(entry))

if (checkouts.length === 0) {
  console.error('check-matrix: no checkout to probe (set DSH_CHECKOUTS)')
  process.exit(1)
}

const results = []
let failed = 0
let warned = 0
let probed = 0
let skipped = 0
for (const checkout of checkouts) {
  const labelled = checkout + (existsSync(join(checkout, 'package.json')) ? '' : ' (no dsh checkout)')
  if (!existsSync(join(checkout, 'package.json'))) {
    skipped += 1
    results.push('➖ ' + labelled)
    continue
  }
  const run = spawnSync(process.execPath, [checker], {
    env: { ...process.env, DSH_CHECKOUT: checkout },
    encoding: 'utf8',
  })
  const output = String(run.stdout ?? '') + String(run.stderr ?? '')
  if (run.status === 0) {
    probed += 1
    const summary = /integration-check OK: (\d+) contracts/.exec(output)
    results.push('✅ ' + checkout + ' — ' + (summary === null ? 'ok' : summary[1] + ' contracts'))
    continue
  }
  probed += 1
  const earlyWarning = isEarlyWarning(checkout)
  if (earlyWarning) warned += 1
  else failed += 1
  results.push((earlyWarning ? '⚠️  ' : '❌ ') + checkout
    + (earlyWarning ? ' — upstream drifted (early-warning row, does not fail the run)' : ''))
  for (const line of output.split('\n')) {
    const trimmed = line.trimEnd()
    if (trimmed.startsWith('  ✗') || trimmed.startsWith('integration-check FAILED')) results.push('    ' + trimmed)
  }
}

console.log(results.join('\n'))
if (failed > 0) {
  console.error('check-matrix FAILED: ' + failed + ' of ' + checkouts.length + ' checkout(s) drifted')
  process.exit(1)
}
if (probed === 0) {
  const why = explicit
    ? 'the requested DSH_CHECKOUTS/DSH_CHECKOUT path(s) hold no dsh checkout (typo?)'
    : 'no dsh checkout found (set DSH_CHECKOUTS, or run where the sibling deepseek-harness exists)'
  if (requireProbe) {
    console.error('check-matrix FAILED: 0 checkout(s) probed — ' + why)
    process.exit(1)
  }
  console.log('check-matrix OK: 0 checkout(s) probed, ' + skipped + ' skipped — ' + why + ' (implicit fallback, not a failure)')
  process.exit(0)
}
if (warned > 0) {
  // Visible, but not a failure: the early-warning row is EXPECTED to drift first.
  // CI turns this into an annotation through the step summary (see the workflow).
  console.log('check-matrix: ' + warned + ' early-warning checkout(s) drifted — upstream changed; '
    + 'review the probes above and either adapt the plugin or refresh the pinned baseline')
}
console.log('check-matrix OK: ' + probed + ' checkout(s) probed, ' + skipped + ' skipped, '
  + failed + ' drifted, ' + warned + ' early-warning drift')
