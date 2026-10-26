/**
 * verify-service-injects.mjs — the plugin must ride optional seams, never a required inject.
 *
 * HISTORY, because this file's job inverted. It used to assert that every
 * direct `ctx.<service>` read appeared in lib/index.js's `inject` array —
 * because Cordis refuses a service property read the plugin did not declare
 * ("cannot get property \"workspaceRegistry\" without inject"), and no fake-ctx
 * check can see that. `projectAdmin/list` really was broken in production while
 * host-check was green.
 *
 * But the array form of `inject` is ALL-REQUIRED: a fiber never activates while
 * one entry is missing (Inject.resolve in vendor/cordis/src/registry.ts). So
 * declaring six services there meant the WHOLE plugin silently refused to mount
 * on any profile lacking one — `@deepseek-ai/dsh-sdk-minimal` ships neither
 * typert nor subagents nor commands nor shell, and the plugin simply
 * disappeared. That is the bug this file now prevents:
 *
 *   1. lib/index.js must export an EMPTY `inject` array (nothing may gate the
 *      mount). The optional seams are listed as data in HOST_SEAMS instead.
 *   2. No host module may read `ctx.<service>` directly. Every seam read must go
 *      through lib/host-seams.js (`hostSeamOf` / `requireSeam`), which returns
 *      undefined instead of throwing, so one absent service retires one panel.
 *   3. Every name in HOST_SEAMS must really be read through that helper — an
 *      entry nobody reads means the list (and its mount warning) is lying.
 *
 * Scope: `lib/*.js` except the generated `client*.js` bundles (their `ctx` is the
 * browser-side shell context, where the host inject list does not apply). It
 * matches the literal identifier `ctx.` — a module that renamed its parameter
 * would slip past, so keep the repo convention (`applyX(ctx, options)`).
 *
 * Second axis (added after the 0.1.7 shell regression slipped through every
 * gate): a service can also be driven through a REMOVED METHOD. `ctx.shell.run()`
 * type-checked, linted, mounted and green-lit the whole suite while the real
 * seam had been `execute()` since 0.1.7 — project hooks were a silent no-op and
 * workflow `shell()` threw. The verb scan below pins those names;
 * `integration-check.mjs` pins the same contract from the dsh side.
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

/**
 * Strip single- and double-quoted string literals so a WARNING TEXT that names a
 * service (`'… ctx.typert unavailable'`) is not mistaken for a property read.
 * Template literals are intentionally left alone: their `${…}` interpolations
 * are live code.
 */
const stripStrings = (text) => text
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) } catch (error) {
    failures += 1
    console.error(`  FAIL ${name}: ${error.message}`)
  }
}

const indexSource = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const declared = [...(/export const inject = \[([^\]]*)\]/.exec(indexSource)?.[1] ?? '')
  .split(',')
  .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
  .filter((s) => s !== '')]

const seamsSource = readFileSync(join(ROOT, 'lib', 'host-seams.js'), 'utf8')
const seamNames = [...(/export const HOST_SEAMS = Object\.freeze\(\[([^\]]*)\]\)/.exec(seamsSource)?.[1] ?? '')
  .split(',')
  .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
  .filter((s) => s !== '')]

console.log(`verify-service-injects: ${declared.length} injected service(s); ${seamNames.length} optional seam(s) (${seamNames.join(', ')})`)

check('lib/index.js injects nothing (so no absent service can block the mount)', () => {
  assert.equal(
    declared.length,
    0,
    `lib/index.js must export an empty \`inject\` array; the array form is all-required and keeps the whole plugin from mounting when one service is absent. Read optional seams through lib/host-seams.js instead. Declared: ${declared.join(', ')}`,
  )
})

check('lib/host-seams.js declares the optional seam list and the readers', () => {
  assert.ok(seamNames.length >= 5, `HOST_SEAMS should list the seams this plugin rides, saw ${seamNames.length}`)
  for (const name of ['hostSeamOf', 'requireSeam']) {
    assert.match(seamsSource, new RegExp(`export function ${name}\\(`), `lib/host-seams.js must export ${name}()`)
  }
})

const hostFiles = readdirSync(join(ROOT, 'lib'))
  .filter((name) => name.endsWith('.js') && !name.startsWith('client'))
  .sort()

const direct = []
const seamReads = []
for (const name of hostFiles) {
  if (name === 'host-seams.js') continue
  const raw = readFileSync(join(ROOT, 'lib', name), 'utf8')
  // Seam reads keep their quotes (the service name is a string literal).
  const noComments = stripComments(raw)
  // Direct-read detection additionally drops string literals, so a warning text
  // that NAMES a service is not mistaken for a property read.
  const code = stripStrings(noComments)
  const lines = code.split(/\r?\n/)
  const seamLines = noComments.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    for (const match of lines[i].matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) {
      const member = match[1]
      if (CONTEXT_API.has(member)) continue
      direct.push({ member, where: `lib/${name}:${i + 1}`, line: lines[i].trim().slice(0, 100) })
    }
    for (const match of seamLines[i].matchAll(/\bctx\.get\(\s*'([A-Za-z_$][\w$]*)'\s*\)/g)) {
      seamReads.push({ member: match[1], where: `lib/${name}:${i + 1}` })
    }
    for (const match of seamLines[i].matchAll(/\b(?:hostSeamOf|requireSeam)\(\s*ctx\s*,\s*'([A-Za-z_$][\w$]*)'/g)) {
      seamReads.push({ member: match[1], where: `lib/${name}:${i + 1}` })
    }
  }
}

check('no host module reads ctx.<service> directly', () => {
  const detail = direct.map((d) => `${d.where} reads ctx.${d.member} — ${d.line}`).join('\n      ')
  assert.equal(
    direct.length,
    0,
    `a real Cordis scope throws "cannot get property … without inject" for an undeclared service, and this plugin declares none — read it with hostSeamOf(ctx, '<name>') / requireSeam(ctx, '<name>', '<feature>')\n      ${detail}`,
  )
})

check('the seam scan is not vacuous (it really sees the optional reads)', () => {
  assert.ok(hostFiles.length >= 30, `expected the host half to be scanned, saw ${hostFiles.length} files`)
  assert.ok(seamReads.length >= 20, `expected the ctx.get()/hostSeamOf() seam reads, saw ${seamReads.length}`)
  for (const name of seamNames) {
    assert.ok(
      seamReads.some((read) => read.member === name),
      `HOST_SEAMS lists "${name}" but no module reads it through ctx.get()/hostSeamOf() — the list (and its mount warning) would be lying`,
    )
  }
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

console.log(`verify-service-injects: ${seamReads.length} optional seam reads across ${hostFiles.length} host files`)
if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('service-inject scan OK')
