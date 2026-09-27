/**
 * smoke-real-host.mjs — the L3 check: boot a REAL dsh, install THIS plugin into a
 * throwaway profile, and exercise it end to end.
 *
 * Every other script in this repo mounts the plugin against a fake ctx
 * (host-check) or a jsdom shell (self-check), and integration-check only READS
 * dsh sources. None of them proves the plugin survives contact with a real Host.
 * This one does, and it asserts four things:
 *
 *   1. COMPOSITION  dsh's loader reads our package's `dsh.bundle.patch` and
 *                   composes our row into the profile tree (`--dump-config`).
 *   2. MOUNT        the Host boots with the plugin and the web app serves a
 *                   tokenized URL.
 *   3. CLIENT HALF  the shell's module table lists `dsh-plugin-admin/client.js`
 *                   and serving it returns OUR bundle bytes.
 *   4. RPC          a unary call over the real gateway
 *                   (`POST /api/pluginAdmin/list`) returns ok:true carrying this
 *                   plugin — which only happens if the service mounted, its
 *                   typert descriptors registered (the gateway admits claimed
 *                   endpoints only) and the strict codec accepted the params.
 *
 * Safety: it never touches $DSH_HOME. A fresh temp home is created for the run and
 * removed on exit, the profile is created from the SHIPPED web template, and the
 * booted process tree is killed in `finally`.
 *
 * Requires a `dsh` on PATH (any version in the supported range). Without one the
 * script SKIPS with exit 0 so it can sit in an opt-in pipeline.
 *
 * Run: npm run smoke:real-host      (or: node scripts/smoke-real-host.mjs)
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PLUGIN_DIR = process.cwd().replace(/\\/g, '/')
const PROFILE = 'smoke'
const BOOT_TIMEOUT_MS = 120_000
const RPC_ENVELOPE = (rpcId, method) => JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: {} } })

let checks = 0
let failures = 0
const ok = (label, detail = '') => { checks += 1; console.log(`  ok    ${label}${detail ? ' — ' + detail : ''}`) }
// `::error::` makes GitHub turn the failure into an ANNOTATION, which is readable
// from the API without admin rights — the job log is not (see
// scripts/lib/ci-failure-annotation.mjs for the same trick on the gate).
const fail = (label, detail) => {
  checks += 1
  failures += 1
  const oneLine = String(detail).replace(/\s+/g, ' ').slice(0, 300)
  console.error(`::error::smoke-real-host: ${label} — ${oneLine}`)
  console.error(`  FAIL  ${label} — ${detail}`)
}
const step = (title) => console.log(`\n${title}`)

const cli = (args, cliEnv) => spawnSync(`dsh ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`, {
  shell: true, encoding: 'utf8', env: cliEnv, timeout: 180_000,
})

/* ------------------------------- preflight -------------------------------- */
// Both tools are hard prerequisites: `dsh` is the Host under test, and `dsh plugin
// … add` shells out to pnpm for the profile install (a profile with plugin
// dependencies cannot be materialised without it). Checking here turns "one
// missing tool" into one clear message instead of four cascading check failures.
const missingTools = []
const probe = cli(['--version'], process.env)
if (probe.status !== 0 || !String(probe.stdout ?? '').includes('.')) missingTools.push('dsh (install a supported version)')
const pnpmProbe = spawnSync('pnpm --version', { shell: true, encoding: 'utf8', timeout: 60_000 })
if (pnpmProbe.status !== 0) missingTools.push('pnpm (dsh installs profile dependencies with it)')
if (missingTools.length > 0) {
  const why = `missing: ${missingTools.join(', ')}`
  if (process.env.SMOKE_REQUIRE_DSH === '1') {
    // CI installs all of these before running this, so a gap there is a broken
    // pipeline, not an opt-out: a skipped gate must not print green.
    console.error(`smoke-real-host: ${why} but SMOKE_REQUIRE_DSH=1 — install them first`)
    process.exit(1)
  }
  console.log(`smoke-real-host: SKIP — ${why}`)
  process.exit(0)
}
const dshVersion = String(probe.stdout).trim().split(/\r?\n/).pop()
console.log(`dsh ${dshVersion} | plugin ${join(PLUGIN_DIR, 'package.json')}`)
const pluginVersion = JSON.parse(readFileSync('package.json', 'utf8')).version

const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-home-'))
// Inherit the environment as-is: the profile install must use whatever registry
// the machine/CI is configured for (injecting one here only made CI behave
// differently from every local run).
const env = { ...process.env, DSH_HOME: home }
let booted = null

const teardown = () => {
  if (booted !== null && booted.pid !== undefined) {
    try {
      if (process.platform === 'win32') spawnSync(`taskkill /PID ${booted.pid} /T /F`, { shell: true, stdio: 'ignore' })
      // POSIX: the child was spawned detached, so its pid leads its own process
      // group — killing the group reaps the shell AND the dsh it launched.
      else try { process.kill(-booted.pid, 'SIGKILL') } catch { try { booted.kill('SIGKILL') } catch { /* gone */ } }
    } catch { /* already gone */ }
    booted = null
  }
  try { rmSync(home, { recursive: true, force: true }) } catch { /* best effort */ }
}
process.on('exit', teardown)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { teardown(); process.exit(1) })

try {
  /* --------------------------- 1. composition ----------------------------- */
  step('1. compose a throwaway profile from the shipped web template')
  const created = cli([PROFILE, '--from-default-profile', 'web', '--dump-config'], env)
  if (created.status !== 0) fail('profile creation', String(created.stderr || created.stdout).slice(-300))
  else ok('profile created (dump-config, no boot)', `DSH_HOME=${home}`)

  const added = cli(['plugin', '--profile', PROFILE, 'add', `link:${PLUGIN_DIR}`], env)
  if (added.status !== 0) {
    // dsh FORWARDS pnpm's own output to its stdout while it writes its summary
    // ("plugin command failed; diagnostics: …") to stderr: both must be read, or
    // the actual pnpm error is exactly the half that gets dropped.
    const forwarded = `${added.stdout ?? ''}${added.stderr ?? ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const logPath = /diagnostics: (\S+)/.exec(forwarded.join(' '))?.[1]
    let logTail = ''
    if (logPath !== undefined && existsSync(logPath)) {
      logTail = readFileSync(logPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-12).join(' | ')
    }
    const parts = []
    if (forwarded.length > 0) parts.push('output: ' + forwarded.slice(-8).join(' | ').slice(-400))
    if (logTail !== '') parts.push('log: ' + logTail.slice(-300))
    fail('plugin install', parts.join(' :: ') || `exit ${added.status}`)
  } else ok('plugin installed into the profile', `link:${PLUGIN_DIR}`)
  } else ok('plugin installed into the profile', `link:${PLUGIN_DIR}`)

  const dumped = cli([PROFILE, '--dump-config'], env)
  const tree = String(dumped.stdout ?? '')
  const rowIndex = tree.indexOf('- id: plugin-admin')
  const rowHit = rowIndex !== -1 && tree.slice(rowIndex, rowIndex + 80).includes('name: dsh-plugin-admin')
  if (rowHit) ok('loader composed our row from dsh.bundle.patch', '- id: plugin-admin / name: dsh-plugin-admin')
  else fail('loader composed our row', 'row not found in --dump-config output')

  /* ------------------------------- 2. mount ------------------------------- */
  step('2. boot the Host (port 0, no browser)')
  booted = spawn(`dsh ${PROFILE} --port 0 --no-open`, {
    shell: true,
    env,
    // POSIX: own process group so teardown can reap the shell and the Host.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  booted.stdout.on('data', (chunk) => { stdout += chunk })
  booted.stderr.on('data', (chunk) => { stdout += chunk })

  const deadline = Date.now() + BOOT_TIMEOUT_MS
  let match = null
  while (Date.now() < deadline) {
    match = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=(\S+)/.exec(stdout)
    if (match !== null) break
    if (booted.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (match === null) {
    fail('Host boot', `no tokenized URL within ${BOOT_TIMEOUT_MS / 1000}s; output tail: ${stdout.slice(-300)}`)
    throw new Error('boot failed')
  }
  const [, port, token] = match
  const base = `http://127.0.0.1:${port}`
  ok('Host booted', `${base} (dsh printed a tokenized URL)`)

  /* ---------------------------- 3. client half ---------------------------- */
  step('3. client half is discovered and served')
  const indexResponse = await fetch(`${base}/?token=${token}`, { redirect: 'manual' })
  const cookie = (indexResponse.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  if (indexResponse.status === 303 && cookie.includes('dsh-auth-')) ok('index accepted the launch token', `HTTP 303 + signed cookie`)
  else fail('index accepted the launch token', `HTTP ${indexResponse.status}, cookie=${cookie === '' ? '(none)' : cookie.slice(0, 24)}`)

  const shell = await fetch(`${base}/?token=${token}`, { redirect: 'follow', headers: { cookie } })
  const html = await shell.text()
  ok('shell HTML served', `HTTP ${shell.status}, ${html.length} bytes`)

  const entry = [...html.matchAll(/plugins\/\?\?[^"']*dsh-plugin-admin[^"']*/g)].map((m) => m[0])[0]
  if (entry !== undefined) ok('module table lists our client entry', entry.split('&amp;')[0].slice(0, 90))
  else fail('module table lists our client entry', 'no plugins/?? URL mentions dsh-plugin-admin')

  const bundleUrl = entry === undefined ? null : `${base}/${entry.replace(/&amp;/g, '&')}`
  if (bundleUrl !== null) {
    const bundle = await fetch(bundleUrl, { headers: { cookie } })
    const bytes = await bundle.text()
    const ours = bytes.includes('PluginsSection') && bytes.includes('pluginAdmin')
    if (bundle.status === 200 && ours) ok('our bundle served with our bytes', `HTTP 200, ${bytes.length} bytes, markers present`)
    else fail('our bundle served with our bytes', `HTTP ${bundle.status}, ${bytes.length} bytes, markers=${ours}`)
  }

  /* -------------------------------- 4. RPC -------------------------------- */
  step('4. unary RPC through the real gateway')
  const bad = await fetch(`${base}/api/pluginAdmin/list`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ nope: true }),
  })
  const badBody = await bad.text()
  if (badBody.includes('gateway/bad-request')) ok('the real gateway rejects a malformed envelope', 'gateway/bad-request')
  else fail('the real gateway rejects a malformed envelope', badBody.slice(0, 160))

  const answer = await fetch(`${base}/api/pluginAdmin/list`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: RPC_ENVELOPE('smoke-1', 'pluginAdmin/list'),
  })
  const raw = await answer.text()
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { /* reported below */ }
  const value = parsed?.result?.value
  const listed = Array.isArray(value?.plugins) ? value.plugins.find((p) => p.name === 'dsh-plugin-admin') : undefined
  if (parsed?.result?.ok === true && listed !== undefined) {
    ok('pluginAdmin/list answered from the mounted service', `${value.plugins.length} plugins, ours version ${listed.version} via ${listed.localPath}`)
    if (listed.version === pluginVersion) ok('the served version matches the working tree', pluginVersion)
    else fail('the served version matches the working tree', `served ${listed.version}, expected ${pluginVersion}`)
  } else {
    fail('pluginAdmin/list answered from the mounted service', raw.slice(0, 300))
  }
} catch (error) {
  if (failures === 0) fail('smoke run', error instanceof Error ? error.message : String(error))
} finally {
  teardown()
}

console.log(`\nsmoke-real-host: ${checks - failures}/${checks} checks passed against dsh ${dshVersion}`)
if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1) }
