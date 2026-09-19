/**
 * Ad-hoc verification for the Codex hooks bridge (v1.16.0):
 *  1. `codexBridgeInstall()` pnpm-adds `@deepseek-ai/dsh-hooks-codex`
 *     (idempotent when already listed) and authors the
 *     `- insert: <hooks-codex>` row whose `config.configPath` points at
 *     `<dshHome>/hooks.codex.json`. The `[]` placeholder is replaced
 *     instead of producing a second YAML document.
 *  2. Legacy bare `- id: hooks-codex` rows (the loader drops them
 *     because no base bundle defines the id) are upgraded by
 *     `codexBridgeInstall()` to the compliant insert-wrapper shape,
 *     and a second install on the compliant row is a no-op.
 *  3. The Claude-Code bridge lifecycle is untouched by codex install
 *     (and vice-versa) — distinct row ids, distinct package
 *     dependencies, distinct `pnpm`/manifest mutations.
 *  4. `codexBridgeRemove()` drops the insert-shaped row + `pnpm
 *     remove`s the package when present, but is also safe on an
 *     empty/missing file (no pnpm, no rows removed).
 *  5. `listHooks()` carries the codex lifecycle fields the panel branches
 *     on (`codexBridgeInstalled` / `codexBridgeRowPresent` /
 *     `codexBridgeMounted` / `codexHooksPath`).
 *
 * Run: node scripts/verify-hooks-codex-bridge.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* ── isolated DSH_HOME + profile ─────────────────────────────────────────── */
const dshHomeDir = mkdtempSync(join(tmpdir(), 'codex-bridge-home-'))
const previousDshHome = process.env.DSH_HOME
process.env.DSH_HOME = dshHomeDir

const tempRoot = mkdtempSync(join(tmpdir(), 'codex-bridge-profile-'))
const profileDir = join(tempRoot, 'profile')
mkdirSync(profileDir, { recursive: true })
const patchPath = join(profileDir, 'cordis.patch.yml')
const hooksPath = join(dshHomeDir, 'hooks.json')
const codexHooksPath = join(dshHomeDir, 'hooks.codex.json')

const CLAUDE_BRIDGE_PACKAGE = '@deepseek-ai/dsh-hooks-claude-code'
const CODEX_BRIDGE_PACKAGE = '@deepseek-ai/dsh-hooks-codex'

try {
  /* One minimal stub pnpm — records calls AND mutates the profile
   * manifest so ensureProfileDependency's idempotency check ("already a
   * dependency") flips correctly between scenarios. */
  const pnpmCalls = []
  const runPnpmStub = async (dir, args) => {
    pnpmCalls.push([dir, ...args])
    const manifestPath = join(profileDir, 'package.json')
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
    pkg.dependencies = pkg.dependencies ?? {}
    if (args[0] === 'add') {
      pkg.dependencies[args[1]] = args[1].startsWith('link:') ? args[1] : '^1.0.0'
    } else if (args[0] === 'remove') {
      delete pkg.dependencies[args[1]]
    }
    writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    return `stub-pnpm ${args.join(' ')}`
  }

  /* The host context stub the plugin expects — minimum surface
   * (commands registry + provide / effect) plus a recorded effects
   * array so we can drive teardown cleanly between scenarios. */
  const provided = new Map()
  const effects = []
  const stubCtx = {
    baseUrl: profileDir,
    commands: { register(definition) { return () => {} } },
    registry: { entries: () => [] },
    get(key) { return provided.get(key) },
    provide(key, service) { provided.set(key, service) },
    effect(fn, label) { effects.push({ fn, label }); const d = fn(); return d },
  }
  let enqueueCalls = 0
  const enqueue = async (op) => { enqueueCalls++; return await op() }

  /* Seed profile manifest with no bridge deps, and an empty patch that
   * carries the `[]` empty-list placeholder the existing tests cover. */
  writeFileSync(join(profileDir, 'package.json'),
    JSON.stringify({ name: 'profile', dependencies: {} }, null, 2) + '\n', 'utf8')

  // ---------- Scenario 1: codex install pnpm-adds + authors the insert row
  writeFileSync(patchPath, '# codex-bridge test — empty patch\n\n[]\n', 'utf8')
  const { applyCommandHookAdmin } = await import('../lib/command-hook-admin.js')
  applyCommandHookAdmin(stubCtx, { runPnpm: runPnpmStub, enqueue })
  const service = provided.get('commandHookAdmin')
  assert.ok(service !== null && service !== undefined, 'commandHookAdmin service mounted')

  const result1 = await service.codexBridgeInstall()
  assert.equal(enqueueCalls, 1, 'install rode the shared serial queue')
  assert.deepEqual(pnpmCalls[0], [profileDir, 'add', CODEX_BRIDGE_PACKAGE], 'pnpm add @deepseek-ai/dsh-hooks-codex')
  assert.equal(result1.action, 'installed', 'first install is a fresh add')
  assert.equal(result1.row, 'inserted', 'row inserted via - insert: wrapper')
  assert.equal(result1.codexHooksPath, codexHooksPath, 'codexHooksPath reflects the default path')
  const after1 = readFileSync(patchPath, 'utf8')
  assert.ok(!after1.includes('[]'), 'empty-list placeholder replaced')
  assert.ok(after1.includes(`name: '${CODEX_BRIDGE_PACKAGE}'`), 'codex row present')
  assert.ok(after1.includes('- insert:'), 'loader-compliant insert wrapper')
  assert.ok(after1.includes('    - id: hooks-codex'), 'stable row id nested under the wrapper')
  assert.ok(after1.includes(JSON.stringify(codexHooksPath)), 'configPath points at <dshHome>/hooks.codex.json')
  console.log('scenario 1 OK: codexBridgeInstall() pnpm-adds + authors the insert wrapper')

  // The panel drives its ✅/📦/⚪ state machine and its uninstall affordance
  // off listHooks. Those fields used to be missing, so a successful install
  // reloaded straight back to "未安装" with no way to uninstall.
  const listed1 = service.listHooks()
  assert.equal(listed1.codexBridgePackage, CODEX_BRIDGE_PACKAGE, 'listHooks surfaces the codex package name')
  assert.equal(listed1.codexBridgeInstalled, true, 'listHooks reports the codex package installed')
  assert.equal(listed1.codexBridgeRowPresent, true, 'listHooks reports the compliant codex mount row')
  assert.equal(listed1.codexBridgeMounted, false, 'listHooks reports codex as not mounted before a restart')
  assert.equal(listed1.codexHooksPath, codexHooksPath, 'listHooks surfaces the codex hooks path')
  assert.equal(listed1.bridgeInstalled, false, 'the Claude bridge status stays independent')
  console.log('scenario 1b OK: listHooks carries the codex lifecycle fields the panel branches on')

  // ---------- Scenario 2: legacy bare row gets upgraded, second install is a no-op
  writeFileSync(patchPath,
    `- id: hooks-codex\n` +
    `  name: '${CODEX_BRIDGE_PACKAGE}'\n` +
    `  config:\n` +
    `    configPath: "${codexHooksPath.replaceAll('\\', '\\\\')}"\n`,
    'utf8')
  pnpmCalls.length = 0
  enqueueCalls = 0
  const result2 = await service.codexBridgeInstall()
  assert.deepEqual(pnpmCalls, [], 'legacy upgrade does not re-install the dep')
  assert.equal(result2.action, 'already-installed', 'dependency already present')
  assert.equal(result2.row, 'upgraded', 'legacy bare row upgraded to insert shape')
  const after2 = readFileSync(patchPath, 'utf8')
  assert.ok(after2.includes('- insert:'), 'compliant wrapper authored on upgrade')
  assert.equal(after2.split(`name: '${CODEX_BRIDGE_PACKAGE}'`).length - 1, 1, 'exactly one codex row after upgrade')
  assert.ok(!/^- id: hooks-codex/m.test(after2), 'legacy bare row gone')
  // Second install on the compliant row is a no-op.
  pnpmCalls.length = 0
  const result2b = await service.codexBridgeInstall()
  assert.deepEqual(pnpmCalls, [], 'compliant install: zero pnpm calls')
  assert.equal(result2b.row, 'present', 'compliant row is already present')
  console.log('scenario 2 OK: codexBridgeInstall() upgrades legacy bare rows + idempotent on compliant rows')

  // ---------- Scenario 3: claude-code bridge lifecycle is independent of codex
  // Author a compliant Claude-Code bridge row via the existing Claude
  // helper, then verify a codex remove does not touch it and a claude
  // remove does not touch codex either.
  writeFileSync(patchPath,
    `- insert:\n` +
    `    - id: hooks-claude-code\n` +
    `      name: '${CLAUDE_BRIDGE_PACKAGE}'\n` +
    '      config:\n' +
    `        configPath: "${hooksPath.replaceAll('\\', '\\\\')}"\n` +
    `- insert:\n` +
    `    - id: hooks-codex\n` +
    `      name: '${CODEX_BRIDGE_PACKAGE}'\n` +
    '      config:\n' +
    `        configPath: "${codexHooksPath.replaceAll('\\', '\\\\')}"\n`,
    'utf8')
  // Drop the dep manifest to a known starting state — both packages
  // listed as installed (matching the on-patch state).
  writeFileSync(join(profileDir, 'package.json'),
    JSON.stringify({
      name: 'profile',
      dependencies: {
        [CLAUDE_BRIDGE_PACKAGE]: '^1.0.0',
        [CODEX_BRIDGE_PACKAGE]: '^1.0.0',
      },
    }, null, 2) + '\n',
    'utf8')
  pnpmCalls.length = 0
  // Remove codex only.
  const codexOnly = await service.codexBridgeRemove()
  assert.deepEqual(pnpmCalls, [[profileDir, 'remove', CODEX_BRIDGE_PACKAGE]],
    'codex remove runs pnpm remove on the codex package only')
  assert.equal(codexOnly.action, 'uninstalled', 'action reports uninstalled when dep was present')
  assert.equal(codexOnly.rowsRemoved, 1, 'one codex row removed')
  let manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.ok(!(CODEX_BRIDGE_PACKAGE in (manifest.dependencies ?? {})),
    'codex package dropped from manifest dependencies')
  assert.ok(CLAUDE_BRIDGE_PACKAGE in (manifest.dependencies ?? {}),
    'claude-code package left untouched in manifest')
  const midState = readFileSync(patchPath, 'utf8')
  assert.ok(midState.includes(`name: '${CLAUDE_BRIDGE_PACKAGE}'`),
    'claude-code bridge row preserved across codex remove')
  assert.ok(!midState.includes(`name: '${CODEX_BRIDGE_PACKAGE}'`),
    'codex bridge row gone after codexBridgeRemove')

  // Remove claude-code now to verify the symmetric independence.
  pnpmCalls.length = 0
  const claudeOnly = await service.bridgeRemove()
  assert.deepEqual(pnpmCalls, [[profileDir, 'remove', CLAUDE_BRIDGE_PACKAGE]],
    'claude remove runs pnpm remove on the claude-code package only')
  assert.equal(claudeOnly.rowsRemoved, 1, 'one claude-code row removed')
  manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.ok(!(CLAUDE_BRIDGE_PACKAGE in (manifest.dependencies ?? {})),
    'claude-code package dropped')
  assert.ok(!(CODEX_BRIDGE_PACKAGE in (manifest.dependencies ?? {})),
    'codex package was already gone; still absent')
  const finalState = readFileSync(patchPath, 'utf8')
  assert.ok(!finalState.includes(`name: '${CLAUDE_BRIDGE_PACKAGE}'`),
    'claude-code bridge row gone after bridgeRemove')
  assert.ok(!finalState.includes(`name: '${CODEX_BRIDGE_PACKAGE}'`),
    'codex bridge row stayed gone')
  console.log('scenario 3 OK: claude-code and codex bridge lifecycles are independent')

  // ---------- Scenario 4: codex remove is safe on empty / partial state -
  // No rows present, no codex dep — remove is a clean `row-removed` no-op
  // (zero pnpm calls because the dep manifest has no codex entry).
  writeFileSync(patchPath, '# clean patch\n', 'utf8')
  writeFileSync(join(profileDir, 'package.json'),
    JSON.stringify({ name: 'profile', dependencies: { [CLAUDE_BRIDGE_PACKAGE]: '^1.0.0' } }, null, 2) + '\n',
    'utf8')
  pnpmCalls.length = 0
  const result4 = await service.codexBridgeRemove()
  assert.deepEqual(pnpmCalls, [], 'no pnpm when the codex dep is absent')
  assert.equal(result4.action, 'row-removed', 'action is row-removed when no row existed')
  assert.equal(result4.rowsRemoved, 0, 'zero rows removed on empty patch')
  // claude-code row and dep survive the no-op codex remove.
  manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.ok(CLAUDE_BRIDGE_PACKAGE in manifest.dependencies,
    'claude-code dep still present in manifest after a no-op codex remove')
  console.log('scenario 4 OK: codexBridgeRemove() is safe on empty / partial state')
} finally {
  /* Best-effort cleanup — we are outside the host, so no effects need
   * firing; the temporary trees are gone either way. */
  rmSync(tempRoot, { recursive: true, force: true })
  rmSync(dshHomeDir, { recursive: true, force: true })
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
}

console.log('verify-hooks-codex-bridge OK: all Codex hooks bridge scenarios passed')
