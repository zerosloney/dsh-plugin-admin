/**
 * Ad-hoc verification for the Storage administration section:
 *  1. `list()` returns two known backends (json bundled + sqlite opt-in),
 *     the active id matches the seeded `storage-domain.config.backend`,
 *     and `format.installedVersion` matches the hard-coded constant.
 *  2. `swap()` mutates the `storage-domain.config.backend` key in place,
 *     keeping comments and any other config lines (the row is shipped
 *     with just `backend: json`; we extend it with a sibling comment
 *     to make the assertion meaningful).
 *  3. `swap()` refuses to flip to a backend whose npm package is NOT
 *     installed (defensive guard — install must precede swap).
 *  4. `install()` runs `pnpm add` (stub) + appends the matching cordis
 *     row to the patch; `swap()` then succeeds.
 *  5. `formatVersion()` reads `installedVersion` + the auto-migrate chain.
 *  6. `install()` authors a loader-mountable `- insert:` row, and `swap()`
 *     refuses when that mount row is missing — the guard must not accept a
 *     bare top-level `- id:` row the Loader drops.
 *  7. `install` / `swap` ride the injected shared serial queue (the same one
 *     pluginAdmin/mcpAdmin use).
 *
 * Run: node scripts/verify-storage-admin.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Temp profile directory: drop a dummy package.json so `profileDirOf`
// resolves to our tmp root, and seed a `cordis.patch.yml` whose
// `storage-domain` row pins the runtime to `json`.
const tmpRoot = mkdtempSync(join(tmpdir(), 'storage-admin-'))
const patchPath = join(tmpRoot, 'cordis.patch.yml')
writeFileSync(join(tmpRoot, 'package.json'), '{"name":"tmp-profile"}', 'utf8')

const SEED_PATCH = [
  '# test patch — storage-domain ships with backend: json',
  '- id: storage-domain',
  '  name: \'@deepseek-ai/dsh-storage-domain\'',
  '  config:',
  '    backend: json',
  '',
  '- id: storage-json',
  '  name: \'@deepseek-ai/dsh-storage-json\'',
  '  config:',
  '    root: !!js dshHomePath(\'storages\')',
  '',
  '- id: tool-web',
  '  name: \'@deepseek-ai/dsh-tool-web\'',
  '  config:',
  '    fetch: true',
  '',
].join('\n')
writeFileSync(patchPath, SEED_PATCH, 'utf8')

// Injected runPnpm stub: drop a sentinel `package.json` so
// `isInstalled` returns true after `add` and `false` after `remove`.
let pnpmCalls = []
const runPnpmStub = async (profileDir, args) => {
  pnpmCalls.push({ profileDir, args })
  if (args[0] === 'add' && args[1] !== undefined) {
    const spec = args[1]
    const at = spec.lastIndexOf('/')
    const dir = at === -1 ? spec : spec.slice(at + 1)
    const nodeModulesDir = join(profileDir, 'node_modules')
    const target = at === -1
      ? join(nodeModulesDir, spec)
      : join(nodeModulesDir, spec.slice(0, at), dir)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'package.json'), '{"name":"stub","version":"0.0.0"}', 'utf8')
    return ''
  }
  if (args[0] === 'remove' && args[1] !== undefined) {
    const spec = args[1]
    const at = spec.lastIndexOf('/')
    const target = at === -1
      ? join(profileDir, 'node_modules', spec)
      : join(profileDir, 'node_modules', spec.slice(0, at), spec.slice(at + 1))
    try {
      const { rmSync: rm } = await import('node:fs')
      rm(target, { recursive: true, force: true })
    } catch { /* best-effort */ }
    return ''
  }
  return ''
}

// Host context stub — real shape: `baseUrl` is a plain context property
// the Loader assigns (NOT a service), so `ctx.get('baseUrl')` would miss.
let service = null
const wrapperCtx = {
  baseUrl: 'file://' + tmpRoot + '/',
  get() { return undefined },
  effect(cb, _label) { cb.call(wrapperCtx); return () => {} },
  provide(_key, svc) { service = svc },
}
const { applyStorageAdmin } = await import('../lib/storage-admin.js')
// A shared-queue spy: install/swap must ride the queue the host passes in
// (index.js hands over the same one pluginAdmin/mcpAdmin use).
const queuedOps = []
const enqueueSpy = (op) => { queuedOps.push(op); return op() }
applyStorageAdmin(wrapperCtx, { runPnpm: runPnpmStub, enqueue: enqueueSpy })
assert.ok(service !== null, 'storage admin service mounted')

// ---------- Scenario 1: list() reads the active backend + format ----------
const list1 = await service.list()
assert.ok(list1.active !== null, 'active is parsed from the seed patch')
assert.equal(list1.active.backend, 'json', 'active.backend reads the seeded json value')
assert.equal(list1.backends.length, 2, 'two known backends in the catalog')
const json = list1.backends.find((b) => b.id === 'json')
const sqlite = list1.backends.find((b) => b.id === 'sqlite')
assert.ok(json, 'json backend in catalog')
assert.ok(sqlite, 'sqlite backend in catalog')
assert.equal(json.bundled, true, 'json is bundled')
assert.equal(sqlite.bundled, false, 'sqlite is opt-in')
assert.equal(json.active, true, 'json is active')
assert.equal(sqlite.active, false, 'sqlite is not active')
assert.equal(sqlite.installed, false, 'sqlite not installed in fresh tmp root')
assert.equal(list1.format.installedVersion, 3, 'installed session format version is 3')
assert.deepEqual(list1.format.autoMigrateChain, ['v0', 'v1', 'v2', 'v3'], 'auto-migrate chain covers all four versions')
console.log('scenario 1 OK: list() exposes json + sqlite + format version + chain')

// ---------- Scenario 2: swap() mutates the storage-domain backend in place -
// The active backend must be installed; sqlite is NOT installed in the
// fresh tmp root, so swap(sqlite) should refuse first.
await assert.rejects(
  () => service.swap('sqlite'),
  /sqlite.*未安装|cordis patch 缺/,
  'swap refuses sqlite when neither the npm package nor the cordis row is present',
)
const after2a = readFileSync(patchPath, 'utf8')
assert.ok(/backend:\s*json/.test(after2a), 'backend is still json after the refused swap')
console.log('scenario 2 OK: swap() refuses half-installed backends before mutating the patch')

// ---------- Scenario 3: install() runs pnpm add + appends the cordis row --
pnpmCalls = []
const sqliteInstall = await service.install('sqlite')
assert.equal(sqliteInstall.installed, true, 'install returns installed:true on success')
assert.deepEqual(pnpmCalls[0].args, ['add', '@deepseek-ai/dsh-storage-sqlite'], 'pnpm args target the right spec')
const after3 = readFileSync(patchPath, 'utf8')
assert.ok(/^\s*- id: storage-sqlite\s*$/m.test(after3), 'storage-sqlite row appended')
assert.ok(/name: '\@deepseek-ai\/dsh-storage-sqlite'/.test(after3), 'cordis row carries the module name')
// Refresh the list to confirm sqlite now reads installed=true.
const list3 = await service.list()
const sqlite3 = list3.backends.find((b) => b.id === 'sqlite')
assert.equal(sqlite3.installed, true, 'sqlite reports installed=true after install')
console.log('scenario 3 OK: install() runs pnpm add + appends the storage-sqlite cordis row')

// ---------- Scenario 4: swap() now succeeds end-to-end ---------------
const swapResult = await service.swap('sqlite')
assert.equal(swapResult.backend, 'sqlite', 'swap returns the new backend id')
const after4 = readFileSync(patchPath, 'utf8')
assert.ok(/^\s*backend:\s*sqlite\s*$/m.test(after4), 'storage-domain now has backend: sqlite')
assert.ok(/name: '\@deepseek-ai\/dsh-storage-domain'/.test(after4), 'storage-domain row preserved')
assert.ok(/^- id: storage-json\s*$/m.test(after4), 'storage-json row preserved')
assert.ok(/^- id: tool-web\s*$/m.test(after4), 'tool-web row preserved (downstream neighbor)')
const list4 = await service.list()
assert.equal(list4.active.backend, 'sqlite', 'after swap, active reads sqlite')
console.log('scenario 4 OK: swap() flips storage-domain.backend in place, preserves neighbors')

// ---------- Scenario 5: formatVersion() reads the installed version ----
const f = await service.formatVersion()
assert.equal(f.installedVersion, 3, 'formatVersion returns v3')
assert.deepEqual(f.autoMigrateChain, ['v0', 'v1', 'v2', 'v3'], 'formatVersion returns the full chain')
console.log('scenario 5 OK: formatVersion() returns installedVersion + autoMigrateChain')

// ---------- Scenario 6: insert-shaped authoring + the swap mount guard -----
// A bare top-level `- id:` row is an override the Loader drops, so it must
// NOT satisfy the swap guard (installed on disk + mounted row are both
// required) and it must be upgraded by install().
writeFileSync(patchPath, [
  '# test patch',
  '- id: storage-domain',
  "  name: '@deepseek-ai/dsh-storage-domain'",
  '  config:',
  '    backend: json',
  '',
  '- id: storage-sqlite',
  "  name: '@deepseek-ai/dsh-storage-sqlite'",
  '  config:',
  "    root: !!js dshHomePath('storages')",
  '',
].join('\n'), 'utf8')
// The package sentinel from scenario 3 is still on disk, so only the mount
// row can fail the guard here.
await assert.rejects(
  () => service.swap('sqlite'),
  /未安装|cordis patch 缺/,
  'swap refuses a package whose only row is the legacy bare shape',
)
await service.install('sqlite')
const after6 = readFileSync(patchPath, 'utf8')
assert.ok(/^- insert:$/m.test(after6), 'install authors an - insert: block')
assert.equal((after6.match(/^ {4}- id: storage-sqlite$/gm) || []).length, 1, 'exactly one sqlite entry after upgrading the legacy row')
assert.ok(!/^- id: storage-sqlite$/m.test(after6), 'the legacy bare sqlite row is gone')
const swap6 = await service.swap('sqlite')
assert.equal(swap6.backend, 'sqlite', 'swap succeeds once the mounted row is insert-shaped')
console.log('scenario 6 OK: install authors an insert row; swap guard requires the mounted shape')

// ---------- Scenario 7: mutating paths ride the shared serial queue --------
const before7 = queuedOps.length
await service.install('sqlite')
assert.equal(queuedOps.length, before7 + 1, 'install rides the injected queue')
await service.swap('sqlite')
assert.equal(queuedOps.length, before7 + 2, 'swap rides the injected queue')
console.log('scenario 7 OK: install / swap ride the injected serial queue')

rmSync(tmpRoot, { recursive: true, force: true })
console.log('verify-storage-admin OK: all Storage administration scenarios passed')