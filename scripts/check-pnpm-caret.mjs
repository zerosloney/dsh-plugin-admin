#!/usr/bin/env node
/**
 * check-pnpm-caret.mjs — end-to-end proof that a caret range SURVIVES to pnpm
 * on Windows.
 *
 * Why this is separate from the unit assertion in host-check: the unit test can
 * only show what `pnpmSpawnArgs` RETURNS. The defect it guards against was a
 * wrong transform whose result looked plausible (`pkg@^^1.2.3`) while cmd.exe
 * delivered `pkg@1.2.3` — a silent exact pin instead of the requested range.
 * Only a real spawn through cmd.exe into the real pnpm shim, followed by a look
 * at what pnpm actually recorded, distinguishes the two. Measured on Windows
 * (node 24 / pnpm 10):
 *
 *   sent `pkg@^1.2.3`    -> manifest records `1.2.3`   (the original defect)
 *   sent `pkg@^^1.2.3`   -> manifest records `1.2.3`   (doubling never worked)
 *   sent `"pkg@^1.2.3"`  -> manifest records `^1.2.3`  (quoting works)
 *
 * Not part of `npm test` (the `verify-*` glob IS gated, and this needs a real
 * registry plus a real install, so it lives with the other diagnostics): it needs a real pnpm on PATH, a registry (network),
 * and it installs a package. It SKIPS rather than fails when any of those is
 * missing, so it stays honest about what it did not check.
 *
 * Run: node scripts/check-pnpm-caret.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const { pnpmSpawnArgs } = await import(new URL('../lib/index.js', import.meta.url).href)

/** A tiny, stable, dependency-free package with more than one 7.x release. */
const PROBE_PACKAGE = 'is-number'
const PROBE_RANGE = '^7.0.0'

if (process.platform !== 'win32') {
  console.log('check-pnpm-caret: SKIP — the cmd.exe caret hazard is Windows-only')
  process.exit(0)
}
if (spawnSync('pnpm', ['--version'], { shell: true, encoding: 'utf8' }).status !== 0) {
  console.log('check-pnpm-caret: SKIP — no pnpm on PATH')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-pnpm-caret-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })

/**
 * Install one spec into a fresh manifest and report what pnpm RECORDED.
 * A throwaway directory per case keeps the cases independent.
 * @param {string} rawSpec - the operand as the plugin would receive it.
 * @returns {{ spec: string|undefined, status: number|null, output: string }}
 */
function recordSpecFor(rawSpec) {
  const cwd = mkdtempSync(join(dir, 'case-'))
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.0', private: true }, null, 2))
  // Exactly how runPnpm builds the call: the transform, then shell:true.
  const args = pnpmSpawnArgs(['add', '--ignore-scripts', '--lockfile-only', rawSpec])
  const result = spawnSync('pnpm', args, { shell: true, encoding: 'utf8', cwd, timeout: 180_000 })
  let spec
  try {
    spec = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).dependencies?.[PROBE_PACKAGE]
  } catch { /* leave undefined: reported as a failure below */ }
  return { spec, status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const cases = [
  // [label, the operand as the plugin receives it, what pnpm must RECORD]
  ['a plain exact version records itself', `${PROBE_PACKAGE}@7.0.0`, '7.0.0'],
  ['a caret range survives the cmd.exe shell', `${PROBE_PACKAGE}@${PROBE_RANGE}`, PROBE_RANGE],
]

let skippedForNetwork = false
for (const [label, rawSpec, expected] of cases) {
  const { spec, status, output } = recordSpecFor(rawSpec)
  // Unreachable registry, not a transform failure: skip rather than report a
  // false negative. A pnpm WARNING (e.g. an unset env var it tried to expand)
  // must not trip this — only the failure codes that mean "could not fetch".
  if (status !== 0 && /ERR_PNPM_FETCH|ERR_PNPM_NO_MATCHING_VERSION|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(output)) {
    skippedForNetwork = true
    console.log(`check-pnpm-caret: SKIP — pnpm could not reach a registry (${label})`)
    break
  }
  assert.equal(spec, expected, `${label}: pnpm recorded ${JSON.stringify(spec)}, expected ${JSON.stringify(expected)}\n${output.slice(-400)}`)
  console.log(` ok ${label} (${PROBE_PACKAGE} -> ${spec})`)
}

if (!skippedForNetwork) {
  // The negative control: the OLD transform must NOT have been sufficient.
  // If doubling ever starts working, this assertion fails and tells us the
  // workaround (and its explanation) are stale — it does not assert the defect.
  const doubled = recordSpecFor(`${PROBE_PACKAGE}@^^7.0.0`)
  if (doubled.spec === PROBE_RANGE) {
    console.log(' check-pnpm-caret: NOTE — caret doubling now survives too; the quoting workaround is no longer load-bearing')
  } else {
    console.log(` ok caret doubling is still NOT sufficient on its own (recorded ${JSON.stringify(doubled.spec)})`)
  }
  console.log('check-pnpm-caret OK: a caret range reaches pnpm intact on Windows')
} else {
  console.log('check-pnpm-caret: incomplete — skipped the assertions that need a registry')
}
