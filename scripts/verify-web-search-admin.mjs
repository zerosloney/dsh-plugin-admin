/**
 * Ad-hoc verification for the Web Search provider administration section:
 *  1. `list()` returns three known providers with the bundled `deepseek-official`
 *     marked `bundled: true`. The active provider id matches the panel's
 *     currently-radio'd choice.
 *  2. `active()` reads the `web` row's `config.searchProvider` from the
 *     profile patch, with no provider object round-tripping.
 *  3. `setActive()` mutates the `web` row's `searchProvider: <id>` key in
 *     place — comments, the `fetchProvider: http` line, and the rest of
 *     the patch are preserved verbatim.
 *  4. `install()` calls `pnpm add` (stub) AND appends the matching cordis
 *     row to the patch; the panel reload shows the provider as installed.
 *  5. `uninstall()` refuses the bundled default and on a non-bundled
 *     provider strips both the cordis row AND the npm dependency.
 *  6. The end-state patch keeps the `web` row + neighbors.
 *  7. `install()` authors a loader-mountable `- insert:` row (a bare
 *     top-level `- id:` row is an override the Loader drops) and upgrades
 *     a legacy bare row in place without duplicating it.
 *  8. `setActive()` authors an id-targeted `web` override row when the
 *     profile patch has none (the bundle layer owns the row), restating
 *     `searchProvider` + `fetchProvider` because a patch replaces the
 *     target's whole `config`.
 *  9. Uninstalling the ACTIVE provider repoints the `web` row at the bundled
 *     default instead of leaving a dangling id behind.
 * 10. A `config: {...}` inline row is rewritten as a block WITHOUT dropping
 *     the user's sibling keys.
 * 11. `setActive` / `install` / `uninstall` ride the injected shared serial
 *     queue (the same one pluginAdmin/mcpAdmin use).
 *
 * Run: node scripts/verify-web-search-admin.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync as rfSync } from 'node:fs'

// Use a temp profile directory so each test run starts from a clean slate.
// The plugin reads `cordis.patch.yml` from this dir; we also drop a
// dummy package.json so `profileDirOf(baseUrl)` resolves to our tmp
// root (production resolution looks for a package.json beside the
// cordis.yml anchor).
const tmpRoot = mkdtempSync(join(tmpdir(), 'web-search-admin-'))
const patchPath = join(tmpRoot, 'cordis.patch.yml')
writeFileSync(join(tmpRoot, 'package.json'), '{"name":"tmp-profile"}', 'utf8')

const SEED_PATCH = [
  '# test patch — author writes a `web` row with searchProvider: deepseek-official',
  '- id: web',
  '  name: \'@deepseek-ai/dsh-web\'',
  '  config:',
  '    searchProvider: deepseek-official',
  '    fetchProvider: http',
  '',
  '- id: web-search-deepseek',
  '  name: \'@deepseek-ai/dsh-web-search-deepseek\'',
  '  config:',
  '    apiKeyEnv: DEEPSEEK_API_KEY',
  '',
  '- id: tool-web',
  '  name: \'@deepseek-ai/dsh-tool-web\'',
  '  config:',
  '    fetch: true',
  '    searchTimeoutMs: 60000',
  '',
].join('\n')
writeFileSync(patchPath, SEED_PATCH, 'utf8')

// Set up a host context shaped like the real one: `baseUrl` is a plain
// context property the Loader assigns (NOT a service — `ctx.get('baseUrl')`
// misses in production), so the module must read `ctx.baseUrl`.
const ctx = {
  baseUrl: 'file://' + tmpRoot + '/',
  get() { return undefined },
  effect() { return () => {} },
  provide() { /* no-op */ },
}

const { applyWebSearchAdmin, webSearchInvocations } = await import('../lib/web-search-admin.js')
const invocations = applyWebSearchAdmin(ctx)
const descriptors = invocations()
assert.equal(descriptors.length, 5, 'five web-search-admin invocations registered')

// Resolve the live service by re-running apply with a wrapping context.
// The module's apply() does:
//   ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, '...')
// We need `this` inside that arrow to point at our wrapper so the
// `ctx.provide(...)` call captures the service object. The injected
// `runPnpm` stub is what keeps the install/uninstall scenarios from
// hitting the real registry (private @deepseek-ai packages would 404).
let pnpmCalls = []
const runPnpmStub = async (profileDir, args) => {
  pnpmCalls.push({ profileDir, args })
  // Simulate a successful install/uninstall: produce a short output,
  // mark the dependency as "installed" by leaving a sentinel file so
  // `isInstalled` returns true. The uninstall path drops it.
  if (args[0] === 'add' && args[1] !== undefined) {
    const spec = args[1]
    const at = spec.lastIndexOf('/')
    const dir = spec.lastIndexOf('/') === -1 ? spec : spec.slice(at + 1)
    // naive "installed" sentinel: drop a `package.json` under node_modules/<spec>
    const nodeModulesDir = join(profileDir, 'node_modules')
    const target = at === -1
      ? join(nodeModulesDir, spec)
      : join(nodeModulesDir, spec.slice(0, at), dir)
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'package.json'), '{"name":"stub","version":"0.0.0"}', 'utf8')
    } catch { /* best-effort */ }
    return ''
  }
  if (args[0] === 'remove' && args[1] !== undefined) {
    const spec = args[1]
    const at = spec.lastIndexOf('/')
    const target = at === -1
      ? join(profileDir, 'node_modules', spec)
      : join(profileDir, 'node_modules', spec.slice(0, at), spec.slice(at + 1))
    try {
      const { rmSync } = await import('node:fs')
      rmSync(target, { recursive: true, force: true })
    } catch { /* best-effort */ }
    return ''
  }
  return ''
}

let captured = null
// A shared-queue spy: every mutating path must ride the queue the host passes
// in (index.js hands over the same one pluginAdmin/mcpAdmin use), or a provider
// install could interleave with a plugin install.
const queuedOps = []
const enqueueSpy = (op) => { queuedOps.push(op); return op() }
const wrapperCtx = {
  baseUrl: ctx.baseUrl,
  get: ctx.get,
  effect(cb, _label) { cb.call(wrapperCtx); return () => {} },
  provide(_key, svc) { captured = svc },
}
applyWebSearchAdmin(wrapperCtx, { runPnpm: runPnpmStub, enqueue: enqueueSpy })
assert.ok(captured !== null, 'web-search admin service mounted')
const service = captured

// ---------- Scenario 1: list() returns three known providers --------------
const list1 = await service.list()
assert.equal(list1.active !== null && list1.active.searchProvider, 'deepseek-official',
  'active.searchProvider reads from the seeded patch')
assert.equal(list1.providers.length, 3, 'three known providers in the catalog')
const deepseek = list1.providers.find((p) => p.id === 'deepseek-official')
const exa = list1.providers.find((p) => p.id === 'exa')
const perplexity = list1.providers.find((p) => p.id === 'perplexity')
assert.ok(deepseek, 'deepseek-official in catalog')
assert.ok(exa, 'exa in catalog')
assert.ok(perplexity, 'perplexity in catalog')
assert.equal(deepseek.bundled, true, 'deepseek-official marked bundled')
assert.equal(exa.bundled, false, 'exa NOT bundled')
assert.equal(deepseek.active, true, 'deepseek-official is the active one')
assert.equal(exa.active, false, 'exa is not active')
assert.equal(exa.installed, false, 'exa not installed in fresh tmp root')
console.log('scenario 1 OK: list() exposes three providers with bundled + active + installed flags')

// ---------- Scenario 2: active() reads without re-listing -----------------
const active2 = await service.active()
assert.equal(active2.searchProvider, 'deepseek-official', 'active.searchProvider')
assert.equal(active2.fetchProvider, 'http', 'active.fetchProvider')
console.log('scenario 2 OK: active() reads the web row config directly')

// ---------- Scenario 3: setActive() mutates the web row in place ---------
// Switch to exa (which is NOT installed) so the test exercises the patch
// writer without triggering pnpm.
await service.setActive('exa')
const after3 = readFileSync(patchPath, 'utf8')
assert.ok(/searchProvider:\s*exa/.test(after3), 'web row now has searchProvider: exa')
assert.ok(/fetchProvider:\s*http/.test(after3), 'fetchProvider preserved')
// Comments and trailing whitespace preserved:
assert.ok(after3.startsWith('# test patch'), 'patch header preserved verbatim')
assert.ok(/^\s*- id: web-search-deepseek\s*$/m.test(after3), 'web-search-deepseek row preserved')
assert.ok(/^\s*- id: tool-web\s*$/m.test(after3), 'tool-web row preserved')
// Re-read active state:
const active3 = await service.active()
assert.equal(active3.searchProvider, 'exa', 'after setActive, active reads exa')
console.log('scenario 3 OK: setActive mutates the web row in place without losing neighbors')

// ---------- Scenario 4: install() appends the cordis row + pnpm add --------
pnpmCalls = []
const exaInstall = await service.install('exa')
assert.ok(exaInstall.installed, 'install returns installed:true on success')
assert.equal(exaInstall.state, 'installed', 'install returns state:installed (added via stub)')
assert.equal(pnpmCalls.length, 1, 'one pnpm invocation (add)')
assert.deepEqual(pnpmCalls[0].args, ['add', '@deepseek-ai/dsh-web-search-exa'], 'pnpm args are the right spec')
// The cordis row now lives in the patch.
const after4 = readFileSync(patchPath, 'utf8')
assert.ok(/^\s*- id: web-search-exa\s*$/m.test(after4), 'ex a row appended to the patch')
assert.ok(/name: '\@deepseek-ai\/dsh-web-search-exa'/.test(after4), 'ex a row carries the module name')
assert.ok(/apiKeyEnv: EXA_API_KEY/.test(after4), 'ex a row carries the apiKeyEnv')
// The fresh `list()` reports installed=true for exa now.
const list4 = await service.list()
const exa4 = list4.providers.find((p) => p.id === 'exa')
assert.equal(exa4.installed, true, 'exa reports installed=true after install')
console.log('scenario 4 OK: install() runs pnpm add + appends the cordis row + panel reflects installed')

// ---------- Scenario 5: uninstall() refuses bundled, strips non-bundled --
// 5a. Refuses the bundled default.
await assert.rejects(
  () => service.uninstall('deepseek-official'),
  /默认 provider.*无法从此面板卸载/,
  'uninstall refuses the bundled default'
)
// 5b. Refuses an unknown id.
await assert.rejects(
  () => service.uninstall('bogus'),
  /未知 provider id/,
  'uninstall refuses unknown provider ids'
)
// 5c. Strips the cordis row AND the npm dependency for exa.
pnpmCalls = []
const exaUninstall = await service.uninstall('exa')
assert.equal(exaUninstall.ok, true, 'uninstall returns ok:true on success')
assert.equal(pnpmCalls.length, 1, 'one pnpm invocation (remove)')
assert.deepEqual(pnpmCalls[0].args, ['remove', '@deepseek-ai/dsh-web-search-exa'], 'pnpm args are the right spec')
const after5 = readFileSync(patchPath, 'utf8')
assert.ok(!/^\s*- id: web-search-exa\s*$/m.test(after5), 'ex a row stripped from the patch')
const list5 = await service.list()
const exa5 = list5.providers.find((p) => p.id === 'exa')
assert.equal(exa5.installed, false, 'exa reports installed=false after uninstall')
console.log('scenario 5 OK: uninstall refuses bundled + unknown; strips cordis row + npm dep')

// ---------- Scenario 6: end-state patch sanity -----------------------------
const finalPatch = readFileSync(patchPath, 'utf8')
assert.ok(finalPatch.startsWith('# test patch'), 'patch header still in place')
assert.ok(/^\s*- id: web\s*$/m.test(finalPatch), 'web row still present')
assert.ok(/^\s*- id: tool-web\s*$/m.test(finalPatch), 'tool-web row still present')
console.log('scenario 6 OK: end-state patch keeps the web row + neighbors untouched')

// ---------- Scenario 7: install authors a loader-mountable insert row ------
// A bare top-level `- id:` row does NOT add a new row: the Loader treats it
// as an override of an existing entry id and drops it with
// `patch: entry not found`. The authored block must be insert-shaped, and a
// legacy bare row (an earlier build's output) must be upgraded, not doubled.
writeFileSync(patchPath, [
  '# test patch',
  '- id: web',
  "  name: '@deepseek-ai/dsh-web'",
  '  config:',
  '    searchProvider: deepseek-official',
  '    fetchProvider: http',
  '',
  '- id: web-search-exa',
  "  name: '@deepseek-ai/dsh-web-search-exa'",
  '  config:',
  '    apiKeyEnv: EXA_API_KEY',
  '',
].join('\n'), 'utf8')
await service.install('exa')
const after7 = readFileSync(patchPath, 'utf8')
assert.ok(/^- insert:$/m.test(after7), 'install authors an - insert: block')
assert.ok(/^ {4}- id: web-search-exa$/m.test(after7), 'insert block carries the exa entry at entry indent')
assert.equal((after7.match(/^ {4}- id: web-search-exa$/gm) || []).length, 1, 'exactly one exa entry after upgrading the legacy row')
assert.ok(!/^- id: web-search-exa$/m.test(after7), 'the legacy bare row is gone')
assert.ok(/^- insert:$/m.test(after7) && /- id: web$/m.test(after7), 'neighbor web row untouched')
console.log('scenario 7 OK: install authors a loader-mountable insert row + upgrades a legacy bare row')

// ---------- Scenario 8: setActive authors an override row when absent ------
// The `web` row lives in the base bundle, not in a normal profile patch:
// setActive must author an id-targeted override instead of throwing.
writeFileSync(patchPath, '# test patch\n', 'utf8')
const set8 = await service.setActive('perplexity')
assert.equal(set8.searchProvider, 'perplexity', 'setActive reports the new search provider')
assert.equal(set8.fetchProvider, 'http', 'setActive reports the restated fetch provider (not the search id)')
const after8 = readFileSync(patchPath, 'utf8')
assert.ok(/^- id: web$/m.test(after8), 'setActive authors a web override row')
assert.ok(/^ {4}searchProvider: perplexity$/m.test(after8), 'override carries searchProvider')
assert.ok(/^ {4}fetchProvider: http$/m.test(after8), 'override restates fetchProvider (config is replaced whole)')
const active8 = await service.active()
assert.equal(active8.searchProvider, 'perplexity', 'active() reads the authored override')
console.log('scenario 8 OK: setActive authors the web override row when the bundle row is not in the patch')

// ---------- Scenario 9: uninstalling the ACTIVE provider clears the id -----
// A dangling `searchProvider` makes every search fail with
// WEB_PROVIDER_CONFIGURED_MISSING after the restart, and the removed provider's
// radio is disabled — the user cannot even see what to fix.
writeFileSync(patchPath, [
  '# test patch',
  '- id: web',
  "  name: '@deepseek-ai/dsh-web'",
  '  config:',
  '    searchProvider: exa',
  '    fetchProvider: http',
  '',
].join('\n'), 'utf8')
await service.install('exa')
await service.uninstall('exa')
const after9 = readFileSync(patchPath, 'utf8')
assert.ok(/^ {4}searchProvider: deepseek-official$/m.test(after9),
  'the dangling searchProvider falls back to the bundled default')
assert.equal((await service.active()).searchProvider, 'deepseek-official',
  'active() no longer names the removed provider')
console.log('scenario 9 OK: uninstalling the active provider clears the dangling searchProvider')

// ---------- Scenario 10: inline config keeps sibling keys ------------------
// A patch replaces the target's whole `config`, so the inline→block rewrite
// must carry the user's other keys instead of emitting only the two this panel
// owns.
writeFileSync(patchPath, [
  '# test patch',
  '- id: web',
  "  name: '@deepseek-ai/dsh-web'",
  "  config: { searchProvider: 'deepseek-official', fetchProvider: 'http', timeoutMs: 30000, endpoint: 'https://api.example.com/v1' }",
  '',
].join('\n'), 'utf8')
await service.setActive('perplexity')
const after10 = readFileSync(patchPath, 'utf8')
assert.ok(/^ {4}timeoutMs: 30000$/m.test(after10), 'sibling config key survives the inline→block rewrite')
assert.ok(/^ {4}endpoint: 'https:\/\/api\.example\.com\/v1'$/m.test(after10),
  'a sibling whose value contains a colon is not dropped by the split')
assert.ok(/^ {4}fetchProvider: 'http'$/m.test(after10), 'the existing fetchProvider value survives')
assert.ok(/^ {4}searchProvider: perplexity$/m.test(after10), 'searchProvider carries the new value')
console.log('scenario 10 OK: the inline config rewrite preserves sibling keys')

// ---------- Scenario 11: mutating paths ride the shared serial queue --------
// The host passes the same queue pluginAdmin/mcpAdmin use; ignoring it would
// let a provider install interleave with a plugin install (and would skip the
// host pnpm runner's timeout/kill).
const before11 = queuedOps.length
await service.setActive('deepseek-official')
assert.equal(queuedOps.length, before11 + 1, 'setActive rides the injected queue')
await service.install('exa')
assert.equal(queuedOps.length, before11 + 2, 'install rides the injected queue')
await service.uninstall('exa')
assert.equal(queuedOps.length, before11 + 3, 'uninstall rides the injected queue')
console.log('scenario 11 OK: setActive / install / uninstall ride the injected serial queue')

// ---------- Scenario 12: an inline config row is READ, not just rewritten --
// The former parser skipped the `config: {...}` line itself (it scanned the
// FOLLOWING lines for braces), so an inline row read as "no active provider":
// list()/active() lost the id AND uninstall's dangling-id repair never fired.
writeFileSync(patchPath, [
  '# test patch',
  '- id: web',
  "  name: '@deepseek-ai/dsh-web'",
  "  config: { searchProvider: exa, fetchProvider: http }",
  '',
].join('\n'), 'utf8')
const active12 = await service.active()
assert.equal(active12.searchProvider, 'exa', 'inline config: searchProvider is read')
assert.equal(active12.fetchProvider, 'http', 'inline config: fetchProvider is read')
assert.equal((await service.list()).providers.find((p) => p.id === 'exa').active, true,
  'inline config: list() flags the active provider')
await service.install('exa')
await service.uninstall('exa')
const after12 = readFileSync(patchPath, 'utf8')
assert.ok(/searchProvider: deepseek-official/.test(after12),
  'inline config: uninstalling the active provider still repairs the dangling id')
console.log('scenario 12 OK: an inline config row is read and repaired')

rmSync(tmpRoot, { recursive: true, force: true })
console.log('verify-web-search-admin OK: all Web Search administration scenarios passed')