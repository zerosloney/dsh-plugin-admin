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
 * 11. `setActive` / `install` / `uninstall` / `saveConfig` ride the injected
 *     shared serial queue (the same one pluginAdmin/mcpAdmin use).
 * 12. An inline config row is READ, not just rewritten (list()/active() and
 *     the dangling-id repair all depend on parsing the `config: {...}` line
 *     itself).
 * 13. `config()` reads a provider's own Config keys, pairing the row's
 *     explicit values with the provider package's defaults, and reports what
 *     is explicitly SET (a plain save never pins an inherited default).
 * 14. `saveConfig()` writes / removes row keys in place, preserving unknown
 *     config keys and insert-block siblings; secrets are written but never
 *     read back.
 * 15. A bundled provider with no patch row gets a bare id-targeted override;
 *     an opt-in provider with no row refuses configuration loudly.
 * 16. Field validation (enum choices, numeric minimums, unknown ids) and
 *     empty-means-unchanged semantics.
 * 17. A provider that registers a dsh settings namespace is written through
 *     `settings.mutate` with the read revision — path ops only, so the
 *     redacted view is never restated and a stale revision is refused.
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
assert.equal(descriptors.length, 7, 'seven web-search-admin invocations registered (list/active/setActive/install/uninstall/config/saveConfig)')

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

// ---------- Scenario 12b: a line-end comment must not break flow configs ---
// `config: {...} # note` — the trailing comment used to make the flow-map
// regex miss: the reader saw an unset row, and the rewriter dropped every
// sibling key on the next save (both the web row and the per-provider
// config-editor row).
writeFileSync(patchPath, [
  '# test patch',
  '- id: web',
  "  name: '@deepseek-ai/dsh-web'",
  "  config: { searchProvider: exa, fetchProvider: http, timeoutMs: 30000 } # prod values",
  '',
].join('\n'), 'utf8')
const active12b = await service.active()
assert.equal(active12b.searchProvider, 'exa', 'commented flow config: searchProvider is read')
assert.equal(active12b.fetchProvider, 'http', 'commented flow config: fetchProvider is read')
await service.setActive('perplexity')
const after12b = readFileSync(patchPath, 'utf8')
assert.ok(/^ {4}timeoutMs: 30000$/m.test(after12b), 'commented flow config: sibling key survives the rewrite')
assert.ok(/^ {4}searchProvider: perplexity$/m.test(after12b), 'commented flow config: the new provider lands')
console.log('scenario 12b OK: a line-end comment does not break the web-row flow config')

writeFileSync(patchPath, [
  '# test patch',
  '- insert:',
  "    - id: web-search-perplexity",
  "      name: '@deepseek-ai/dsh-web-search-perplexity'",
  '      config: { searchRecency: month, customKept: keep-me } # tuned',
  '',
].join('\n'), 'utf8')
const cfg12b = await service.config('perplexity')
const fields12b = Object.fromEntries(cfg12b.fields.map((f) => [f.key, f]))
assert.equal(fields12b.searchRecency.value, 'month', 'commented entry config: keys are read')
const saved12b = await service.saveConfig('perplexity', { model: 'sonar-pro' }, [])
assert.deepEqual(saved12b.changed, ['model'], 'commented entry config: only the requested key changed')
const after12b2 = readFileSync(patchPath, 'utf8')
assert.ok(/^ {8}customKept: keep-me$/m.test(after12b2), 'commented entry config: sibling key survives the rewrite')
assert.ok(/^ {8}searchRecency: month$/m.test(after12b2), 'commented entry config: untouched keys keep their values')
assert.ok(/^ {8}model: "sonar-pro"$/m.test(after12b2), 'commented entry config: the new key lands')
console.log('scenario 12b OK: the config-editor path tolerates a line-end comment too')

// ---------- Scenario 13: config() reads a provider's own Config keys --------
// Exa / Perplexity register NO dsh settings section, so their `cordis.patch.yml`
// row is the only configuration surface there is. The read pairs the row's
// explicit values with the provider package's defaults, and reports which
// fields are actually SET (a plain save must never pin an inherited default).
writeFileSync(patchPath, [
  '# test patch',
  '- insert:',
  "    - id: web-search-perplexity",
  "      name: '@deepseek-ai/dsh-web-search-perplexity'",
  '      config:',
  '        customKept: keep-me',
  '        searchRecency: month',
  '',
].join('\n'), 'utf8')
const cfg13 = await service.config('perplexity')
assert.equal(cfg13.providerId, 'perplexity')
assert.equal(cfg13.namespace, 'web-search-perplexity', 'the provider namespace is reported')
assert.equal(cfg13.source, 'row', 'no settings namespace mounted → the cordis row is the source')
assert.equal(cfg13.revision, null, 'a row-backed editor has no settings revision')
assert.equal(cfg13.restartRequired, true, 'a row write needs a restart')
const fields13 = Object.fromEntries(cfg13.fields.map((f) => [f.key, f]))
assert.deepEqual(Object.keys(fields13), ['apiKey', 'baseURL', 'model', 'maxTokens', 'searchRecency'], 'the field list is the provider Config key set')
assert.equal(fields13.baseURL.default, 'https://api.perplexity.ai', 'the provider default rides the descriptor')
assert.equal(fields13.searchRecency.value, 'month', 'an explicit row value is read')
assert.equal(fields13.searchRecency.set, true)
assert.deepEqual(fields13.searchRecency.choices, ['day', 'week', 'month', 'year'], 'enum choices ride the descriptor')
assert.equal(fields13.model.value, '', 'an absent key reads empty (the package default applies)')
assert.equal(fields13.model.set, false)
assert.equal(fields13.apiKey.kind, 'secret')
assert.equal(fields13.apiKey.value, '', 'a secret value never round-trips')
console.log('scenario 13 OK: config() pairs row values with provider defaults and marks what is set')

// ---------- Scenario 14: saveConfig() writes the row in place --------------
const saved14 = await service.saveConfig('perplexity', {
  model: 'sonar-pro', maxTokens: '2048', apiKey: 'pplx-secret',
}, ['searchRecency'])
assert.deepEqual(saved14, {
  ok: true, source: 'row', changed: ['apiKey', 'model', 'maxTokens', 'searchRecency'], restartRequired: true,
}, 'saveConfig reports the row source and every key it touched')
const after14 = readFileSync(patchPath, 'utf8')
assert.ok(/^ {8}model: "sonar-pro"$/m.test(after14), 'a string value is written JSON-quoted (lossless via yamlScalar)')
assert.ok(/^ {8}maxTokens: 2048$/m.test(after14), 'a number is written bare, not quoted')
assert.ok(/^ {8}apiKey: "pplx-secret"$/m.test(after14), 'the secret is written')
assert.ok(!/searchRecency/.test(after14), 'an unset key is removed')
assert.ok(/^ {8}customKept: keep-me$/m.test(after14), 'an unknown config key survives the rewrite')
assert.ok(/^- insert:$/m.test(after14), 'the insert wrapper survives')
const reread14 = await service.config('perplexity')
const fields14 = Object.fromEntries(reread14.fields.map((f) => [f.key, f]))
assert.equal(fields14.maxTokens.value, 2048, 'the written number parses back as a number')
assert.equal(fields14.apiKey.set, true, 'the written secret reports as set')
assert.equal(fields14.apiKey.value, '', 'and still never round-trips')
console.log('scenario 14 OK: saveConfig writes/unset row keys and preserves unknown keys + siblings')

// ---------- Scenario 15: bundled override vs opt-in refusal ----------------
// The shipped DeepSeek row lives in the BUNDLE layer, so a bare id-targeted
// override is the only shape that configures it; an opt-in provider has no row
// at all until it is installed, and configuring nothing must fail loud.
writeFileSync(patchPath, '# test patch\n', 'utf8')
await assert.rejects(() => service.saveConfig('exa', { baseURL: 'https://exa.proxy' }, []), /先点「📥 安装」/, 'an uninstalled opt-in provider refuses configuration')
const saved15 = await service.saveConfig('deepseek-official', { model: 'deepseek-v4-flash', maxUses: '3' }, [])
assert.equal(saved15.source, 'row', 'the bundled provider saves through the patch')
const after15 = readFileSync(patchPath, 'utf8')
assert.ok(/^- id: web-search-deepseek$/m.test(after15), 'a bare id-targeted override block is authored')
assert.ok(/^ {4}maxUses: 3$/m.test(after15), 'the override carries the submitted value')
const fields15 = Object.fromEntries((await service.config('deepseek-official')).fields.map((f) => [f.key, f]))
assert.equal(fields15.maxUses.value, 3, 'the authored override reads back')
assert.equal(fields15.model.set, true)
console.log('scenario 15 OK: bundled config authors a bare override; uninstalled opt-in providers refuse')

// ---------- Scenario 16: validation + empty-means-unchanged -----------------
await assert.rejects(() => service.saveConfig('perplexity', { searchRecency: 'decade' }, []), /只能是 day \/ week \/ month \/ year/, 'an out-of-range enum is refused with its choices')
await assert.rejects(() => service.saveConfig('perplexity', { maxTokens: '0' }, []), /必须是 ≥ 1 的整数/, 'a non-positive number is refused')
await assert.rejects(() => service.saveConfig('bogus', {}, []), /未知 provider id/, 'an unknown provider id is refused')
const before16 = readFileSync(patchPath, 'utf8')
const saved16 = await service.saveConfig('deepseek-official', { model: '' }, [])
assert.deepEqual(saved16, { ok: true, source: 'row', changed: [], restartRequired: false }, 'an empty submission reports nothing changed')
assert.equal(readFileSync(patchPath, 'utf8'), before16, 'and writes nothing')
console.log('scenario 16 OK: field validation, unknown ids, and empty-means-unchanged')

// ---------- Scenario 17: the settings-backed path (live, revision-guarded) --
// A provider that registers a dsh settings namespace (the DeepSeek package
// does) is written through settings.mutate from the REDACTED descriptor, so no
// other field — least of all another secret — is restated by a save.
const savedOps = []
let settingsRevision = 11
const settingsStub = {
  describe: () => [{
    ns: 'web-search-deepseek',
    revision: settingsRevision,
    applies: 'live',
    value: { apiKeyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-v4-flash' },
    user: { model: 'deepseek-v4-flash' },
    secrets: [{ path: ['apiKey'], set: true }],
  }],
  mutate: async (ns, ops, expected) => {
    assert.equal(ns, 'web-search-deepseek', 'the write targets the provider namespace')
    assert.equal(expected, settingsRevision, 'the read revision is sent back')
    savedOps.push(...ops)
    settingsRevision += 1
  },
}
function mountWithSettings(settingsService) {
  let mounted = null
  applyWebSearchAdmin({
    baseUrl: ctx.baseUrl,
    get: (key) => (key === 'settings' ? settingsService : undefined),
    effect(cb) { cb(); return () => {} },
    provide(_key, svc) { mounted = svc },
  })
  assert.ok(mounted !== null, 'a settings-serving mount exposes the service')
  return mounted
}
const settingsService = mountWithSettings(settingsStub)
const cfg17 = await settingsService.config('deepseek-official')
assert.equal(cfg17.source, 'settings', 'a registered namespace makes settings the save target')
assert.equal(cfg17.revision, 11, 'the descriptor revision is reported')
assert.equal(cfg17.restartRequired, false, 'a live section needs no restart')
const fields17 = Object.fromEntries(cfg17.fields.map((f) => [f.key, f]))
assert.equal(fields17.apiKey.set, true, 'a redacted secret is reported as set')
assert.equal(fields17.apiKey.value, '', 'with no value attached')
assert.equal(fields17.model.set, true, 'a user-overridden field is marked set')
assert.equal(fields17.apiKeyEnv.set, false, 'an inherited field is not marked set')
assert.equal(fields17.apiKeyEnv.value, 'DEEPSEEK_API_KEY', 'an inherited field still shows its resolved value')
const saved17 = await settingsService.saveConfig('deepseek-official', { apiKeyEnv: 'MY_KEY' }, ['apiKey'], 11)
assert.deepEqual(saved17, { ok: true, source: 'settings', changed: ['apiKey', 'apiKeyEnv'], restartRequired: false })
assert.deepEqual(savedOps, [
  { op: 'unset', path: ['apiKey'] },
  { op: 'set', path: ['apiKeyEnv'], value: 'MY_KEY' },
], 'path ops carry only the touched keys (in provider field order) — the redacted view is never restated')
const conflicted = mountWithSettings({
  describe: settingsStub.describe,
  mutate: async () => { const error = new Error('stale'); error.code = 'SETTINGS_CONFLICT'; throw error },
})
await assert.rejects(
  () => conflicted.saveConfig('deepseek-official', { model: 'deepseek-v4-flash' }, [], 11),
  /已被其他界面/,
  'a stale revision is refused with the panel-readable conflict message',
)
console.log('scenario 17 OK: the settings-backed path writes path ops with the read revision')

// ---------- Scenario 18: a sibling entry key stays OUTSIDE the config block --
// The config block is delimited by indent: a row may carry a sibling key
// (`disabled:`) after its `config:`. New keys must be spliced INTO the block,
// never appended to the entry — appending emits a YAML document the Loader
// cannot parse, and a boot-critical patch that fails to parse stops dsh from
// starting at all. Both the bare and the insert-row shapes are covered.
writeFileSync(patchPath, [
  '# test patch',
  '- id: web-search-perplexity',
  "  name: '@deepseek-ai/dsh-web-search-perplexity'",
  '  config:',
  '    model: sonar',
  '  disabled: false',
  '',
].join('\n'), 'utf8')
await service.saveConfig('perplexity', { maxTokens: '2048' }, [])
const after18 = readFileSync(patchPath, 'utf8')
const lines18 = after18.split('\n')
const configIdx18 = lines18.findIndex((l) => l.trim() === 'config:')
const siblingIdx18 = lines18.findIndex((l) => l.trim() === 'disabled: false')
const newKeyIdx18 = lines18.findIndex((l) => l.trim().startsWith('maxTokens:'))
assert.ok(configIdx18 !== -1 && siblingIdx18 !== -1 && newKeyIdx18 !== -1, 'all three lines present')
assert.ok(newKeyIdx18 > configIdx18 && newKeyIdx18 < siblingIdx18,
  'the new key lands INSIDE the config block, before the sibling key')
assert.ok(lines18[newKeyIdx18].startsWith('    '), 'the new key keeps the config child indent')
console.log('scenario 18 OK: a sibling entry key stays outside the config block')

// ---------- Scenario 19: install() carries a legacy row's config over --------
// The panel's own config editor writes into a bare row, so install() may later
// upgrade that row to the loader-compliant insert shape. Dropping the row
// wholesale would silently discard every value written there — including a
// configured API key.
writeFileSync(patchPath, [
  '# test patch',
  '- id: web-search-exa',
  "  name: '@deepseek-ai/dsh-web-search-exa'",
  '  config:',
  '    apiKey: "exa-secret"',
  '    baseURL: "https://exa.proxy"',
  '',
].join('\n'), 'utf8')
pnpmCalls = []
await service.install('exa')
const after19 = readFileSync(patchPath, 'utf8')
assert.ok(/^- insert:$/m.test(after19), 'the legacy row became an insert block')
assert.ok(after19.includes('apiKey: "exa-secret"'), 'the configured secret survives the upgrade')
assert.ok(after19.includes('baseURL: "https://exa.proxy"'), 'the configured endpoint survives the upgrade')
assert.ok(after19.includes('apiKeyEnv: EXA_API_KEY'), 'the block still carries its own apiKeyEnv default')
assert.ok(!/^- id: web-search-exa$/m.test(after19), 'the legacy bare row is gone')
console.log('scenario 19 OK: install() carries a legacy row config into the compliant row')

rmSync(tmpRoot, { recursive: true, force: true })
console.log('verify-web-search-admin OK: all Web Search administration scenarios passed')