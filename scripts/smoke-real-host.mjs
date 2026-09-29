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
 * Package mode — set SMOKE_PACKAGE_SPEC to install from a REGISTRY spec
 * (e.g. SMOKE_PACKAGE_SPEC=dsh-plugin-admin@1.26.1) instead of linking this
 * checkout. This is the post-publish leg of release.yml: it exercises the
 * artifact npm users actually receive, and asserts the files whitelist ships
 * what the docs point at (the v1.26.x regression where docs/ left the
 * tarball was invisible to every path-based check). Browser section runs
 * only when a browser is present, as usual.
 *
 * Run: npm run smoke:real-host      (or: node scripts/smoke-real-host.mjs)
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { relative } from 'node:path'
import { join } from 'node:path'

const PLUGIN_DIR = process.cwd().replace(/\\/g, '/')
const PACKAGE_SPEC = typeof process.env.SMOKE_PACKAGE_SPEC === 'string' && process.env.SMOKE_PACKAGE_SPEC.trim() !== ''
  ? process.env.SMOKE_PACKAGE_SPEC.trim()
  : null
const PROFILE = 'smoke'
const BOOT_TIMEOUT_MS = 120_000

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

// A Chromium for step 7. Optional by design: the browser half is proven to boot
// and render there, but a machine without one still gets steps 1-6 (and CI can
// demand it with SMOKE_REQUIRE_BROWSER=1).
const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter((candidate) => typeof candidate === 'string' && existsSync(candidate))
const browserPath = BROWSER_CANDIDATES[0] ?? null

const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-home-'))
// Inherit the environment as-is EXCEPT NODE_OPTIONS: CI sets it to preload the
// failure annotator for this script, and env inheritance would run that preload
// inside every `dsh`/`pnpm` process too — polluting the very output this script
// reports and perturbing the tools under test.
const env = { ...process.env, DSH_HOME: home }
delete env.NODE_OPTIONS
let booted = null
let browser = null
let browserProfile = null

const teardown = () => {
  if (browser !== null) {
    try { browser.kill('SIGKILL') } catch { /* already gone */ }
    browser = null
  }
  if (browserProfile !== null) {
    try { rmSync(browserProfile, { recursive: true, force: true }) } catch { /* best effort */ }
    browserProfile = null
  }
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

  // Package mode installs the published artifact from the registry; default
  // mode links this checkout (the development path, unchanged).
  const installSpec = PACKAGE_SPEC ?? `link:${PLUGIN_DIR}`
  const added = cli(['plugin', '--profile', PROFILE, 'add', installSpec], env)
  if (added.status !== 0) {
    // dsh FORWARDS pnpm's own output to its stdout while it writes its summary
    // ("plugin command failed; diagnostics: …") to stderr: both must be read, or
    // the actual pnpm error is exactly the half that gets dropped.
    const forwarded = `${added.stdout ?? ''}${added.stderr ?? ''}`
      .split(/\r?\n/)
      .map((l) => l.trim())
      // Drop workflow-command noise (`::error::…` from a preload or a child) so the
      // tool's own error survives the truncation below.
      .filter((l) => l !== '' && !l.startsWith('::'))
    const logPath = /diagnostics: (\S+)/.exec(forwarded.join(' '))?.[1]
    let logTail = ''
    if (logPath !== undefined && existsSync(logPath)) {
      logTail = readFileSync(logPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-12).join(' | ')
    }
    const parts = []
    if (forwarded.length > 0) parts.push('output: ' + forwarded.slice(-12).join(' | ').slice(-500))
    if (logTail !== '') parts.push('log: ' + logTail.slice(-300))
    fail('plugin install', parts.join(' :: ') || `exit ${added.status}`)
  } else ok('plugin installed into the profile', installSpec)

  // Package mode: the artifact users receive must ship what the docs point at.
  // A files-whitelist gap ("docs/ left the tarball", v1.26.x) is invisible to
  // every path-based check because the checkout always has the files — only a
  // REGISTRY install can catch it.
  if (PACKAGE_SPEC !== null) {
    // dsh's profile layout: $DSH_HOME/profiles/<name>/node_modules/…
    const installedDir = join(home, 'profiles', PROFILE, 'node_modules', 'dsh-plugin-admin')
    for (const rel of ['package.json', 'cordis.patch.yml', 'docs/ARCHITECTURE.md', 'docs/COMPAT.md', 'README.md', 'README.en.md']) {
      if (existsSync(join(installedDir, ...rel.split('/')))) ok(`published package ships ${rel}`, relative(process.cwd(), join(installedDir, rel.split('/')[0])))
      else fail(`published package ships ${rel}`, `missing in the registry install at ${installedDir} — check package.json "files"`)
    }
  }

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

  /**
   * One unary call through the real gateway: `POST /api/<namespace>/<method>` with
   * the `client-request` envelope the gateway's own validator demands.
   * @param {string} endpoint - `<namespace>/<method>`.
   * @param {Record<string, unknown>} args - wire-named arguments.
   * @returns {Promise<{ ok: boolean, value: any, message: string, text: string, status: number }>}
   */
  const rpc = async (endpoint, args) => {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: endpoint.replace('/', '-'), method: endpoint, payload: { args } }),
    })
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* reported by the caller */ }
    return { ok: body?.result?.ok === true, value: body?.result?.value, message: String(body?.result?.error?.message ?? ''), text, status: response.status }
  }

  /* -------------------------------- 4. RPC -------------------------------- */
  step('4. unary RPC through the real gateway')
  const bad = await fetch(`${base}/api/pluginAdmin/list`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ nope: true }),
  })
  const badBody = await bad.text()
  if (badBody.includes('gateway/bad-request')) ok('the real gateway rejects a malformed envelope', 'gateway/bad-request')
  else fail('the real gateway rejects a malformed envelope', badBody.slice(0, 160))

  const answer = await rpc('pluginAdmin/list', {})
  const listed = Array.isArray(answer.value?.plugins) ? answer.value.plugins.find((p) => p.name === 'dsh-plugin-admin') : undefined
  if (answer.ok && listed !== undefined) {
    ok('pluginAdmin/list answered from the mounted service', `${answer.value.plugins.length} plugins, ours version ${listed.version} via ${listed.localPath}`)
    if (listed.version === pluginVersion) ok('the served version matches the working tree', pluginVersion)
    else fail('the served version matches the working tree', `served ${listed.version}, expected ${pluginVersion}`)
  } else {
    fail('pluginAdmin/list answered from the mounted service', answer.text.slice(0, 300))
  }

  /* --------------------- 5. one read call per namespace -------------------- */
  step('5. every admin namespace answers through the gateway (read-only)')
  const profileDir = join(home, 'profiles', PROFILE)
  // One read-only endpoint per namespace: mounting a service is not the same as
  // its descriptors reaching the gateway, and this is the layer that would break
  // silently (a namespace whose row fails to mount simply 404s here).
  // `fsAdmin` is the single omission — its only method (`reveal`) opens a file
  // manager on the HOST, which a smoke run must not do; host-check still asserts
  // that namespace's mount surface.
  // `expect: 'refusal'` marks a call whose read needs host state a throwaway
  // profile does not have (no workspace is registered, so projectAdmin's
  // fail-closed cwd check refuses). The point of those entries is that OUR code
  // answers — a `gateway/*` error is a failure for every entry, which is exactly
  // how this sweep caught `gateway/internal: cannot get property
  // "workspaceRegistry" without inject`.
  const SKIPPED_NAMESPACES = ['fsAdmin']
  const SWEEP = [
    ['pluginAdmin', 'list', {}],
    ['pluginAdmin', 'panels', {}],
    ['pluginAdmin', 'auditLog', {}],
    ['sessionAdmin', 'list', {}],
    ['sessionAdmin', 'usageReport', {}],
    ['mcpAdmin', 'list', {}],
    ['subagentAdmin', 'list', {}],
    ['subagentAdmin', 'runtimeList', {}],
    ['subagentAdmin', 'cliList', {}],
    ['commandHookAdmin', 'listCommands', {}],
    ['commandHookAdmin', 'listHooks', {}],
    ['projectAdmin', 'list', { cwd: profileDir }, { expect: 'refusal', refusalText: '工作区' }],
    ['webhookAdmin', 'list', {}],
    ['cronAdmin', 'list', {}],
    ['overlayAdmin', 'status', {}],
    ['workspaceAdmin', 'list', {}],
    ['skillsAdmin', 'list', { sessionIds: [] }],
    ['webSearchAdmin', 'list', {}],
    ['webSearchAdmin', 'active', {}],
    ['workflowAdmin', 'listRuns', {}],
    ['workflowAdmin', 'listSaved', {}],
  ]
  const reached = new Set()
  let answered = 0
  let injectGuards = 0
  for (const [namespace, method, args, options = {}] of SWEEP) {
    const call = await rpc(`${namespace}/${method}`, args)
    // A Cordis scope guard ("cannot get property … without inject") means the
    // plugin read a service it never declared in its `inject` list. Real dsh
    // refuses that; a fake ctx does not — so it is a failure for EVERY entry,
    // which is how this sweep first caught it on projectAdmin/list.
    const injectGuard = /without inject/.test(call.text)
    if (injectGuard) injectGuards += 1
    const passed = !injectGuard && (
      call.ok
      // A documented refusal still proves the namespace dispatched to OUR code:
      // the gateway wraps a thrown method as `gateway/internal`, so the message
      // (not the code) is what identifies whose error it is.
      || (options.expect === 'refusal' && call.message.includes(options.refusalText))
    )
    if (passed) { answered += 1; reached.add(namespace) }
    else fail(`${namespace}/${method}`, `${injectGuard ? 'Cordis inject guard: ' : ''}${call.text.slice(0, 220)}`)
  }
  if (injectGuards === 0) ok('no endpoint hit a Cordis inject guard', `${SWEEP.length} calls`)
  else fail('no endpoint hit a Cordis inject guard', `${injectGuards} call(s) read an undeclared service`)
  // 14 is the manifest's namespace count (host-check asserts the manifest itself);
  // this checks that the SWEEP did not quietly lose a namespace.
  const sweepNamespaces = new Set(SWEEP.map(([ns]) => ns))
  if (sweepNamespaces.size + SKIPPED_NAMESPACES.length === 14) {
    ok('the sweep covers every admin namespace', `${sweepNamespaces.size} called + ${SKIPPED_NAMESPACES.length} skipped (${SKIPPED_NAMESPACES.join(', ')})`)
  } else {
    fail('the sweep covers every admin namespace', `${sweepNamespaces.size} called + ${SKIPPED_NAMESPACES.length} skipped, expected 14`)
  }
  if (answered === SWEEP.length) ok('every read-only endpoint answered ok:true', `${answered}/${SWEEP.length} calls over ${reached.size} namespaces`)
  else fail('every read-only endpoint answered ok:true', `${answered}/${SWEEP.length} answered; reached ${[...reached].sort().join(', ')}`)

  /* ----------------------------- 6. write paths ---------------------------- */
  step('6. write paths on the real Host (JSON store + profile patch + audit)')
  const auditFile = join(home, 'admin-audit.jsonl')
  const cronFile = join(home, 'cron-tasks.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const auditText = () => (existsSync(auditFile) ? readFileSync(auditFile, 'utf8') : '')
  const readIfPresent = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '')

  // 6a. JSON store: the F1 cross-process lock, the atomic rename and the audit
  // trail on a real Host (every one of those was only ever exercised against a
  // fake DSH_HOME).
  const upsert = await rpc('cronAdmin/upsert', {
    entry: { id: 'smoke-task', cron: '0 3 * * *', enabled: false, action: { mode: 'steer', sessionId: 'smoke' }, promptTemplate: 'smoke tick' },
  })
  if (upsert.ok && readIfPresent(cronFile).includes('smoke-task')) {
    ok('cronAdmin/upsert wrote the store on disk', relative(home, cronFile).replace(/\\/g, '/'))
  } else {
    fail('cronAdmin/upsert wrote the store on disk', `${upsert.text.slice(0, 200)} | store=${readIfPresent(cronFile).slice(0, 120)}`)
  }
  const remove = await rpc('cronAdmin/remove', { id: 'smoke-task' })
  if (remove.ok && !readIfPresent(cronFile).includes('smoke-task')) ok('cronAdmin/remove took it back out', readIfPresent(cronFile).trim().slice(0, 80))
  else fail('cronAdmin/remove took it back out', `${remove.text.slice(0, 200)} | store=${readIfPresent(cronFile).slice(0, 120)}`)
  const auditAfterStore = auditText()
  if (auditAfterStore.includes('cronAdmin/upsert') && auditAfterStore.includes('cronAdmin/remove')) {
    ok('the audit trail recorded both store writes', `${auditAfterStore.split('\n').filter(Boolean).length} entries in admin-audit.jsonl`)
  } else {
    fail('the audit trail recorded both store writes', auditAfterStore.slice(-200) || '(no audit file)')
  }

  // 6b. Profile patch: `pluginAdmin/setEnabled` on a HERMETIC no-op plugin the
  // smoke authors itself. Toggling our own row would be a fine test of hot-apply
  // but unloads the very service serving the call, so the target is a throwaway
  // package whose only job is to occupy a loader row.
  const targetDir = join(home, 'toggle-target')
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: 'smoke-toggle-target', version: '1.0.0', private: true, main: 'index.js',
    // `./package.json` MUST be exported: setEnabled resolves the manifest through
    // `require.resolve('<name>/package.json')`, and an `exports` map without that
    // subpath hides it (ERR_PACKAGE_PATH_NOT_EXPORTED → "未声明 bundle patch").
    // Our own manifest exports it for exactly this reason.
    exports: { '.': './index.js', './package.json': './package.json' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  writeFileSync(join(targetDir, 'cordis.patch.yml'), '- insert:\n    - id: smoke-toggle-target\n      name: smoke-toggle-target\n')
  writeFileSync(join(targetDir, 'index.js'), "export const name = 'smoke-toggle-target'\nexport function apply() {}\n")
  const targetSpec = `link:${targetDir.replace(/\\/g, '/')}`
  const targetAdd = cli(['plugin', '--profile', PROFILE, 'add', targetSpec], env)
  if (targetAdd.status === 0) ok('hermetic toggle target installed', targetSpec.replace(home, '<temp>'))
  else fail('hermetic toggle target installed', `${targetAdd.stdout ?? ''}${targetAdd.stderr ?? ''}`.slice(-200))

  const disabled = await rpc('pluginAdmin/setEnabled', { name: 'smoke-toggle-target', disabled: true })
  const patchDisabled = readIfPresent(patchPath)
  if (disabled.ok && patchDisabled.includes('disabled: true')) {
    ok('setEnabled wrote a disabled row into the profile patch', 'cordis.patch.yml now carries `disabled: true`')
  } else {
    fail('setEnabled wrote a disabled row into the profile patch', `${disabled.text.slice(0, 200)} | patch tail=${patchDisabled.slice(-160)}`)
  }
  // Ask the product's OWN read path whether the toggle took effect: parsing
  // --dump-config would test the loader's text layout, not our feature, and the
  // tree prints the row without the flag (other rows ship disabled, so a bare
  // regex would have passed vacuously).
  const listWhileDisabled = await rpc('pluginAdmin/list', {})
  const targetRow = Array.isArray(listWhileDisabled.value?.plugins)
    ? listWhileDisabled.value.plugins.find((p) => p.name === 'smoke-toggle-target')
    : undefined
  if (targetRow?.disabled === true) ok('pluginAdmin/list reports the target as disabled', `removable=${targetRow.removable === true}`)
  else fail('pluginAdmin/list reports the target as disabled', `${listWhileDisabled.text.slice(0, 220)}`)

  const reEnabled = await rpc('pluginAdmin/setEnabled', { name: 'smoke-toggle-target', disabled: false })
  const patchEnabled = readIfPresent(patchPath)
  const listWhileEnabled = await rpc('pluginAdmin/list', {})
  const targetAfter = Array.isArray(listWhileEnabled.value?.plugins)
    ? listWhileEnabled.value.plugins.find((p) => p.name === 'smoke-toggle-target')
    : undefined
  if (reEnabled.ok && !patchEnabled.includes('smoke-toggle-target') && targetAfter?.disabled === false) {
    ok('the toggle round-trips (patch row removed, list reports enabled)', 'disabled: false')
  } else {
    fail('the toggle round-trips (patch row removed, list reports enabled)', `${reEnabled.text.slice(0, 160)} | disabled=${String(targetAfter?.disabled)} | patch mentions=${patchEnabled.includes('smoke-toggle-target')}`)
  }
  const auditAfterPatch = auditText()
  if (auditAfterPatch.includes('pluginAdmin/setEnabled')) {
    ok('the audit trail recorded the patch write', `${auditAfterPatch.split('\n').filter(Boolean).length} entries total`)
  } else {
    fail('the audit trail recorded the patch write', auditAfterPatch.slice(-200))
  }

  /* --------------------------- 7. real browser ---------------------------- */
  step('7. the panel renders in a real browser')
  if (browserPath === null) {
    if (process.env.SMOKE_REQUIRE_BROWSER === '1') fail('a Chromium is available', 'SMOKE_REQUIRE_BROWSER=1 but no browser was found')
    else console.log('  skip  no Chromium on this machine (set SMOKE_BROWSER to point at one)')
  } else {
    ok('a Chromium is available', browserPath)
    browserProfile = mkdtempSync(join(tmpdir(), 'dsh-smoke-browser-'))
    let cdpPort = null
    browser = spawn(browserPath, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${browserProfile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900',
      `${base}/?token=${token}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let browserLog = ''
    browser.stderr.on('data', (chunk) => {
      browserLog += chunk
      const found = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(browserLog)
      if (found !== null && cdpPort === null) cdpPort = Number(found[1])
    })
    // Not every Chromium build announces the port on stderr: Edge (and newer
    // headless launches) print NOTHING there and only drop the chosen port into
    // `<user-data-dir>/DevToolsActivePort` as its first line. Observed on the
    // windows-latest Edge: empty stderr, file present — the stderr-only probe
    // failed step 7 on a perfectly healthy browser. The file is read on every
    // poll (not latched) so a half-written line cannot pin a wrong port for the
    // rest of the deadline; the stderr value, once seen, still wins.
    const devtoolsPortFile = join(browserProfile, 'DevToolsActivePort')
    const portFromFile = () => {
      try {
        const first = readFileSync(devtoolsPortFile, 'utf8').split(/\r?\n/, 1)[0].trim()
        const port = Number(first)
        return Number.isInteger(port) && port > 0 ? port : null
      } catch {
        return null   // not written yet
      }
    }
    const browserDeadline = Date.now() + 30_000
    let pageTarget = null
    while (Date.now() < browserDeadline && pageTarget === null) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      const port = cdpPort ?? portFromFile()
      if (port === null) continue
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const target = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string') ?? null
        pageTarget = target
        // Latch only on a successful target fetch, so a stale/partial port is
        // re-resolved from the file on the next poll.
        if (target !== null) cdpPort = port
      } catch { /* still starting */ }
    }
    if (pageTarget === null) {
      fail('the browser exposed a CDP page target', browserLog.slice(-200) || '(no DevTools line on stderr and no DevToolsActivePort in the profile)')
    } else {
      ok('the browser opened the shell', `CDP on 127.0.0.1:${cdpPort}`)
      // Raw CDP over Node's built-in WebSocket: no dependency, and the assertions
      // run in the page exactly as a user's browser would.
      const socket = new WebSocket(pageTarget.webSocketDebuggerUrl)
      const exceptions = []
      let rpcId = 0
      const pendingCalls = new Map()
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data))
        if (message.id !== undefined && pendingCalls.has(message.id)) { pendingCalls.get(message.id)(message); pendingCalls.delete(message.id) }
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params?.exceptionDetails?.text ?? 'exception')
      })
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve)
        socket.addEventListener('error', () => reject(new Error('CDP socket failed')))
      })
      const command = (method, params = {}) => new Promise((resolve) => {
        rpcId += 1
        pendingCalls.set(rpcId, resolve)
        socket.send(JSON.stringify({ id: rpcId, method, params }))
      })
      const evaluate = async (expression) => {
        const reply = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
        return reply.result?.result?.value
      }
      await command('Runtime.enable')

      // The shell labels its icon buttons through aria-label/title (a first cut
      // matched textContent only and found nothing), and connecting to CDP right
      // after launch can beat React's first render — so wait for the trigger
      // itself instead of a text-length heuristic (the empty-session shell paints
      // under 120 chars).
      const settingsLabels = ['设置', 'Settings']
      const labelHelper = "const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()"
      const wantedJson = JSON.stringify(settingsLabels)
      let triggerPresent = false
      const readyDeadline = Date.now() + 30_000
      while (Date.now() < readyDeadline && !triggerPresent) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        triggerPresent = (await evaluate(`(() => { ${labelHelper}
          const wanted = ${wantedJson}
          return Array.from(document.querySelectorAll('button,[role=button],[aria-label],[title]'))
            .some((el) => wanted.includes(label(el)))
        })()`)) === true
      }
      if (triggerPresent) ok('the shell painted its settings trigger', `${settingsLabels.join('/')} is present and clickable`)
      else fail('the shell painted its settings trigger', String(await evaluate('document.body.innerText')).slice(0, 160).replace(/\n/g, ' '))

      // Reach OUR OWN panel. The sidebar's 插件/会话 entries belong to the SHELL's
      // plugin manager and session list — clicking those would prove nothing about
      // this plugin (a first cut of this step did exactly that). What is
      // unambiguously ours: the sections this plugin registers into the shell's
      // Settings dialog (`settings.section`: 用量仪表盘 / 自动化, plus the hooks tab
      // in the plugins page), whose copy exists only in OUR i18n table.
      const opened = await evaluate(`(() => { ${labelHelper}
        const wanted = ${wantedJson}
        const hit = Array.from(document.querySelectorAll('button,[role=button],[aria-label],[title]'))
          .find((el) => wanted.includes(label(el)))
        if (hit === undefined) return false
        hit.click()
        return true
      })()`)
      if (opened === true) ok('opened the shell settings dialog', 'clicked 设置/Settings')
      else fail('opened the shell settings dialog', 'no settings trigger found')

      const ourLabels = ['用量仪表盘', 'Usage Dashboard', '自动化', 'Automation']
      let panelText = ''
      // The shell's first-run announcement ("内测声明 … 继续") covers the window and
      // EATS clicks, and a click can also land while React is still hydrating: so
      // dismiss the notice, then retry the settings click while polling for OUR
      // labels instead of trusting a single click (this flaked exactly that way).
      for (let attempt = 0; attempt < 4 && !ourLabels.some((t) => panelText.includes(t)); attempt += 1) {
        await evaluate(`(() => { ${labelHelper}
          const dismiss = ['继续', 'Continue', '知道了', 'Got it']
          const hit = Array.from(document.querySelectorAll('button,[role=button]'))
            .find((el) => dismiss.includes(label(el)))
          if (hit !== undefined) hit.click()
          return true
        })()`)
        if (attempt > 0) {
          await evaluate(`(() => { ${labelHelper}
            const wanted = ${wantedJson}
            const hit = Array.from(document.querySelectorAll('button,[role=button],[aria-label],[title]'))
              .find((el) => wanted.includes(label(el)))
            if (hit !== undefined) hit.click()
            return true
          })()`)
        }
        const attemptDeadline = Date.now() + 8_000
        while (Date.now() < attemptDeadline && !ourLabels.some((t) => panelText.includes(t))) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          panelText = String(await evaluate('document.body.innerText'))
        }
      }
      const hitLabels = ourLabels.filter((t) => panelText.includes(t))
      if (hitLabels.length > 0) {
        ok('our own sections rendered in the real shell', `our labels on screen: ${[...new Set(hitLabels)].join(', ')}`)
      } else {
        fail('our own sections rendered in the real shell', panelText.slice(0, 200).replace(/\n/g, ' '))
      }
      if (exceptions.length === 0) ok('no uncaught exception in the page', 'Runtime.exceptionThrown was silent')
      else fail('no uncaught exception in the page', exceptions.slice(0, 3).join(' | '))
      try { socket.close() } catch { /* already closed */ }
    }
  }
} catch (error) {
  if (failures === 0) fail('smoke run', error instanceof Error ? error.message : String(error))
} finally {
  teardown()
}

console.log(`\nsmoke-real-host: ${checks - failures}/${checks} checks passed against dsh ${dshVersion}`)
if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1) }
