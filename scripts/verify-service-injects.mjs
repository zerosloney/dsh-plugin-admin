/**
 * verify-service-injects.mjs — every direct `ctx.<service>` read must be declared.
 *
 * Cordis refuses a service property read the plugin did not declare in its
 * `inject` list: "cannot get property \"workspaceRegistry\" without inject". The
 * throw reaches the panel as `gateway/internal`, so the feature just breaks on
 * every real host.
 *
 * NO fake-ctx check can see this — a stub context has no scope guard. `host-check`
 * was green while `projectAdmin/list` was broken in production; the real-host
 * smoke (`scripts/smoke-real-host.mjs`) caught it the first time it called the
 * endpoint. This scan exists because the smoke only calls what it calls: it covers
 * the write paths and rare branches no smoke run reaches, and it fails in seconds.
 *
 * Scope: `lib/*.js` except the generated `client*.js` bundles (their `ctx` is the
 * browser-side shell context, where the server inject list does not apply). It
 * matches the literal identifier `ctx.` — a module that renamed its parameter
 * would slip past, so keep the repo convention (`applyX(ctx, options)`).
 *
 * Second axis (added after the 0.1.7 shell regression slipped through every
 * gate): a declared service can still be driven through a REMOVED METHOD.
 * `ctx.shell.run(spec)` type-checked, linted, mounted and green-lit the whole
 * suite while the real seam had been `execute()` since 0.1.7 — project hooks
 * were a silent no-op and workflow `shell()` threw. The service-name scan below
 * therefore also pins the shell verb names; `integration-check.mjs` pins the
 * same contract from the dsh side.
 *
 * Run: node scripts/verify-service-injects.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
/** Non-service members of the Cordis/dsh context surface. */
const CONTEXT_API = new Set([
  // Cordis Context itself
  'effect', 'on', 'get', 'provide', 'inject', 'reflect', 'registry', 'scope', 'root', 'fiber',
  'head', 'is', 'extend', 'set', 'accessor', 'mixin', 'plugin', 'once', 'off', 'emit', 'parallel',
  'waterfall', 'bail', 'serial', 'start', 'stop', 'dispose', 'name',
  // dsh additions that are plain properties, not services
  'logger', 'baseUrl',
])

/** Strip comments so a docblock mentioning `ctx.workspaceRegistry` is not a hit. */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) } catch (error) {
    failures += 1
    console.error(`  FAIL ${name}: ${error.message}`)
  }
}

const indexSource = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const declared = [.../export const inject = \[([^\]]*)\]/.exec(indexSource)?.[1]
  .split(',')
  .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
  .filter((s) => s !== '') ?? []]

console.log(`verify-service-injects: ${declared.length} declared services (${declared.join(', ')})`)

check('the plugin declares its inject list', () => {
  assert.ok(declared.length > 0, 'lib/index.js must export a non-empty `inject` array')
})

const hostFiles = readdirSync(join(ROOT, 'lib'))
  .filter((name) => name.endsWith('.js') && !name.startsWith('client'))
  .sort()

const direct = []
for (const name of hostFiles) {
  const lines = stripComments(readFileSync(join(ROOT, 'lib', name), 'utf8')).split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    for (const match of lines[i].matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) {
      const member = match[1]
      if (CONTEXT_API.has(member)) continue
      direct.push({ member, where: `lib/${name}:${i + 1}`, line: lines[i].trim().slice(0, 100) })
    }
  }
}

check('every direct ctx.<service> read is declared in inject', () => {
  const undeclared = direct.filter((d) => !declared.includes(d.member))
  const detail = undeclared.map((d) => `${d.where} reads ctx.${d.member} — ${d.line}`).join('\n      ')
  assert.equal(
    undeclared.length,
    0,
    `undeclared service read(s): a real Cordis scope throws "cannot get property … without inject" (use ctx.get(...) or add the service to lib/index.js's inject list)\n      ${detail}`,
  )
})

check('the scan is not vacuous (it really sees service reads)', () => {
  assert.ok(direct.length >= 10, `expected a meaningful number of direct reads, saw ${direct.length}`)
  assert.ok(direct.some((d) => declared.includes(d.member)), 'no read matched a declared service — the scan is probably broken')
})

/* ------------------- shell seam: the METHOD names, not just the key -------- */

/** Every `shell.<verb>(` call site in the host half (comments already stripped). */
const shellVerbs = []
for (const name of hostFiles) {
  const lines = stripComments(readFileSync(join(ROOT, 'lib', name), 'utf8')).split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    for (const match of lines[i].matchAll(/\b(?:ctx\.)?shell\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      shellVerbs.push({ verb: match[1], where: `lib/${name}:${i + 1}`, line: lines[i].trim().slice(0, 100) })
    }
  }
}

check('no shell call site uses the removed run()/start() verbs', () => {
  const stale = shellVerbs.filter((v) => v.verb === 'run' || v.verb === 'start')
  const detail = stale.map((v) => `${v.where} calls shell.${v.verb}() — ${v.line}`).join('\n      ')
  assert.equal(
    stale.length,
    0,
    `dsh ≥0.1.7 ShellExecutor exposes resolve() + execute() only; drive it as `
    + `execute(resolve(request)) then await handle.result()\n      ${detail}`,
  )
})

check('the shell verb scan is not vacuous and uses the current seam', () => {
  assert.ok(shellVerbs.length >= 2, `expected the shell call sites to be scanned, saw ${shellVerbs.length}`)
  assert.ok(
    shellVerbs.some((v) => v.verb === 'execute'),
    'no shell.execute() call site found — the seam check is probably broken',
  )
})

console.log(`verify-service-injects: ${direct.length} direct service reads across ${hostFiles.length} host files`)
if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('service-inject scan OK')
