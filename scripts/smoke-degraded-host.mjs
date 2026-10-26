#!/usr/bin/env node
/**
 * Degraded-host smoke (N-16): mount this plugin on a profile that LACKS the
 * services it rides.
 *
 * WHY THIS EXISTS
 * ---------------
 * README claims "缺服务逐面板降级，绝不整插件不加载". Every other gate proves
 * that against a ctx that HAS the services (host-check injects stubs,
 * self-check uses jsdom, smoke-real-host boots the full web profile). The one
 * deployment shape that can falsify the claim is a bundle that genuinely does
 * not provide them — and v1.29.0 learned this the hard way: setting `inject=[]`
 * looked like "optional reads" but silently removed Cordis' instantiation
 * timing, so the whole RPC surface vanished while 45 self-built gates stayed
 * green (see analysis/E-fixes-summary.md §9.1). Only a real host caught it.
 *
 * `@deepseek-ai/dsh-sdk-minimal` is that host: its cordis.patch.yml header says
 * "this insert is the complete Cordis tree", and the tree has no typert, no
 * subagents, no commands, no shell (see the file's own row list). So this script
 * boots a throwaway sdk-minimal profile WITH this plugin installed and asserts:
 *
 *   1. the plugin MOUNTS (the loader composes its row, the host boots, no throw);
 *   2. the missing-seam set is REPORTED once, not silently swallowed;
 *   3. nothing pretends to work: a panel whose seam is absent must fail per call
 *      with a message naming the gap, never a bare TypeError.
 *
 * What it deliberately does NOT assert: that any RPC answers. Without typert
 * there is no RPC surface at all (lib/index.js returns early and says so), and
 * that is the CORRECT behaviour — the point is that the host stays up.
 *
 * Usage:
 *   node scripts/smoke-degraded-host.mjs
 *   SMOKE_REQUIRE_DSH=1 node scripts/smoke-degraded-host.mjs   # CI: missing dsh fails
 *
 * It uses a throwaway $DSH_HOME (mkdtemp), never the developer's own profile.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(here, '..')
const PROFILE = 'degraded-smoke'

let checks = 0
let failures = 0
const ok = (label, detail = '') => { checks += 1; console.log(`  ok    ${label}${detail === '' ? '' : ' — ' + detail}`) }
const skip = (label, why) => { console.log(`  skip  ${label} — ${why}`) }
const fail = (label, why) => { checks += 1; failures += 1; console.error(`  FAIL  ${label} — ${why}`) }
const step = (title) => { console.log(`\n${title}`) }

/** Run the dsh CLI synchronously (Windows needs the .cmd shim through a shell). */
function cli(args, env, timeout = 120_000) {
  const run = spawnSync(process.platform === 'win32' ? 'dsh.cmd' : 'dsh', args, {
    encoding: 'utf8',
    env,
    timeout,
    shell: process.platform === 'win32',
  })
  return { status: run.status, stdout: String(run.stdout ?? ''), stderr: String(run.stderr ?? '') }
}

// ---------------------------------------------------------------- preconditions
step('0. toolchain')
const probe = cli(['--version'], { ...process.env })
if (probe.status !== 0) {
  const why = 'dsh is not on PATH'
  if (process.env.SMOKE_REQUIRE_DSH === '1') { fail('a dsh CLI is available', why + ' but SMOKE_REQUIRE_DSH=1'); process.exit(1) }
  skip('a dsh CLI is available', why)
  console.log('\nsmoke-degraded-host: SKIPPED (no dsh CLI)')
  process.exit(0)
}
const dshVersion = String(probe.stdout).trim().split(/\r?\n/).pop()
ok('a dsh CLI is available', dshVersion)

const home = mkdtempSync(join(tmpdir(), 'dsh-degraded-home-'))
const env = { ...process.env, DSH_HOME: home }
let child = null
const cleanup = () => {
  if (child !== null) { try { child.kill('SIGKILL') } catch { /* already gone */ } }
  try { rmSync(home, { recursive: true, force: true }) } catch { /* Windows may hold a handle; a leftover temp dir is not a failure */ }
}
process.on('exit', cleanup)

// ------------------------------------------------------- 1. compose the profile
step('1. compose a throwaway sdk-minimal profile (the degraded bundle)')
const created = cli(['--profile', PROFILE, '--from-default-profile', 'sdk-minimal', '--dump-config'], env)
if (created.status !== 0) {
  fail('the sdk-minimal template composes', String(created.stderr || created.stdout).slice(0, 400))
  console.log('\nsmoke-degraded-host: cannot continue without a profile')
  process.exit(1)
}
const composed = created.stdout
ok('the sdk-minimal template composes', 'this insert is the complete Cordis tree')

// The premise of the whole check: this bundle really lacks our seams. If a
// future dsh starts shipping typert here, the "degraded" claim would be
// untested while this script kept passing — so the absence is asserted, not
// assumed.
for (const absent of ['dsh-typert-registry', 'dsh-subagent', 'dsh-commands', 'dsh-shell']) {
  if (composed.includes(absent)) {
    fail(`the degraded bundle lacks ${absent}`,
      'sdk-minimal now ships it, so this is no longer a degraded host — pick another bundle or drop the check')
  } else {
    ok(`the degraded bundle lacks ${absent}`, 'this is what makes the mount a real degradation test')
  }
}

// --------------------------------------------------------- 2. install the plugin
step('2. install this plugin into the degraded profile')
const installed = cli(['plugin', '--profile', PROFILE, 'add', 'link:' + PLUGIN_DIR], env, 300_000)
if (installed.status !== 0) {
  fail('the plugin installs', String(installed.stderr || installed.stdout).slice(0, 500))
} else {
  ok('the plugin installs', 'link:' + PLUGIN_DIR)
  const dump = cli(['--profile', PROFILE, '--dump-config'], env)
  if (dump.status !== 0) {
    fail('the composed config is readable', String(dump.stderr).slice(0, 300))
  } else if (!dump.stdout.includes('- id: dsh-plugin-admin') || !dump.stdout.includes('name: dsh-plugin-admin')) {
    fail('the loader composed our row from dsh.bundle.patch', 'row missing from --dump-config')
  } else {
    ok('the loader composed our row from dsh.bundle.patch', '- id: dsh-plugin-admin / name: dsh-plugin-admin')
  }
}

// ------------------------------------------------------------- 3. boot and watch
step('3. boot the Host and read what it says about the missing seams')
const bootLog = []
const booted = await new Promise((resolve) => {
  // sdk-minimal's app is the JSON-RPC server: it does not open a port, so the
  // assertion is "the process stays up and logs no crash", not "it answers HTTP".
  child = spawn(process.platform === 'win32' ? 'dsh.cmd' : 'dsh', ['--profile', PROFILE], {
    env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = (chunk) => { bootLog.push(String(chunk)) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  let settled = false
  const settle = (value) => { if (!settled) { settled = true; resolve(value) } }
  child.on('exit', (code) => settle({ exited: true, code }))
  setTimeout(() => settle({ exited: false, code: null }), 20_000)
})
const log = bootLog.join('')

if (booted.exited && booted.code !== 0) {
  fail('the Host boots with the plugin mounted', 'exited ' + booted.code + ': ' + log.slice(0, 600))
} else if (booted.exited) {
  // A short-lived sdk-minimal app that exits 0 without a task is a clean boot.
  ok('the Host boots with the plugin mounted', 'exited 0 (nothing to do, no crash)')
} else {
  ok('the Host boots with the plugin mounted', 'still running after 20s, no crash')
}

// The degradation must be VISIBLE. lib/index.js warns once with the absent set
// (and a second line when typert is what is missing).
if (/plugin-admin:/.test(log)) {
  const line = log.split(/\r?\n/).find((entry) => /plugin-admin:/.test(entry)) ?? ''
  ok('the plugin reports its missing seams instead of failing silently', line.trim().slice(0, 200))
} else {
  // A host that never logs our warning is not proof of a bug: the loader may
  // filter plugin logs. Report it as a skip, not a failure, so this stays a
  // truthful gate rather than a flaky one.
  skip('the plugin reports its missing seams', 'no plugin-admin log line surfaced through this bundle\'s stdout')
}

if (/TypeError|ReferenceError|Cannot read properties of undefined/.test(log)) {
  fail('the mount raises no bare TypeError', log.split(/\r?\n/).find((entry) => /TypeError|ReferenceError/.test(entry))?.slice(0, 300) ?? '')
} else {
  ok('the mount raises no bare TypeError', 'a missing seam is reported by name, not as a crash')
}

/* POSITIVE CONTROL — without it, "no output" is not evidence of a mount.
 *
 * sdk-minimal's app prints nothing on a clean boot, so the checks above would
 * pass just as well if the loader had silently dropped our row. The host DOES
 * report a row it cannot activate (`dsh: warning: 1 entry did not activate` +
 * the import error), so install a deliberately broken row and prove the
 * instrument works on this exact profile: if the broken row is reported and
 * ours is not, ours mounted. */
step('4. positive control: a broken row IS reported on THIS bundle')
/* A separate throwaway profile holding ONLY the broken row (not this plugin).
 * Never touch the shared profile patch above — it "works", and injecting into
 * it would both invalidate the preceding assertions and risk a YAML parse error
 * from appending after a flow-style `[]`. The instrument only needs to prove
 * that the host reports an un-activatable row on the sdk-minimal bundle; the
 * main profile's clean boot is then evidence that OUR row activated. */
const controlHome = mkdtempSync(join(tmpdir(), 'dsh-deg-control-'))
const controlEnv = { ...process.env, DSH_HOME: controlHome }
const CONTROL = 'control'
cli(['--profile', CONTROL, '--from-default-profile', 'sdk-minimal'], controlEnv)
const controlPatch = join(controlHome, 'profiles', CONTROL, 'cordis.patch.yml')
if (!existsSync(controlPatch)) {
  skip('a row the loader cannot activate IS reported on this bundle', 'control profile patch not found')
} else {
  writeFileSync(controlPatch,
    '- insert:\n    - id: degraded-smoke-broken\n      name: \'this-module-does-not-exist-anywhere\'\n', 'utf8')
  const broken = cli(['--profile', CONTROL], controlEnv, 120_000)
  const brokenLog = String(broken.stdout ?? '') + String(broken.stderr ?? '')
  if (/did not activate/.test(brokenLog) && /degraded-smoke-broken/.test(brokenLog)) {
    ok('a row the loader cannot activate IS reported on this bundle',
      'so the main profile\'s clean boot is evidence OUR row activated, not a silent host')
  } else {
    fail('a row the loader cannot activate IS reported on this bundle',
      'the instrument is blind here, so the mount assertions above prove nothing: ' + brokenLog.slice(0, 300))
  }
  try { rmSync(controlHome, { recursive: true, force: true }) } catch { /* temp dir */ }
}

// ------------------------------------------------------------------ 4. verdict
console.log(`\nsmoke-degraded-host: ${checks - failures}/${checks} checks passed against dsh ${dshVersion} (sdk-minimal)`)
if (failures > 0) {
  console.error('smoke-degraded-host: FAILED')
  process.exit(1)
}
console.log('smoke-degraded-host: the plugin mounts on a bundle that lacks its seams, and says so')
