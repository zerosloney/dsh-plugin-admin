/**
 * Unit verification for the marketplace install peer-compatibility preflight
 * (lib/peer-compat.js).
 *
 *  1. parseVersion accepts semver cores, prereleases, build metadata and a
 *     `v` prefix; rejects prose, loose versions and non-strings.
 *  2. satisfiesDshRange mirrors the host's admission rule
 *     (packages/boot/app-boot/src/plugin-compatibility.ts): includePrerelease
 *     semantics, workspace protocols satisfied, empty/invalid fail closed —
 *     covering caret/tilde/x/comparator/alternation/hyphen forms including
 *     the 0.x caret corners (^0.0.3 = [0.0.3, 0.0.4)).
 *  3. dshPeersOf keeps only @deepseek-ai/dsh / @deepseek-ai/dsh-* peers.
 *  4. evaluateDshPeerCompat reports each incompatible peer by name.
 *  5. resolveDshRuntimeVersion honors the DSH_RUNTIME_VERSION override and
 *     caches; readInstalledDshPeers reads the profile's node_modules manifest
 *     and returns null for a missing one.
 *
 * Run: node scripts/verify-peer-compat.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { parseVersion, satisfiesDshRange, dshPeersOf, evaluateDshPeerCompat, resolveDshRuntimeVersion, readInstalledDshPeers, resetRuntimeVersionCacheForTests } = await import('../lib/peer-compat.js')

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push(`✅ ${name}`)
  } catch (error) {
    results.push(`❌ ${name}`)
    console.error(results.join('\n'))
    throw error
  }
}
const checkAsync = async (name, fn) => {
  try {
    await fn()
    results.push(`✅ ${name}`)
  } catch (error) {
    results.push(`❌ ${name}`)
    console.error(results.join('\n'))
    throw error
  }
}

check('1. parseVersion accepts semver spellings and rejects everything else', () => {
  assert.deepEqual(parseVersion('0.1.7-rc.2'), { major: 0, minor: 1, patch: 7, pre: ['rc', '2'] })
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] })
  assert.deepEqual(parseVersion('v2.0.1+build.7'), { major: 2, minor: 0, patch: 1, pre: [] })
  assert.equal(parseVersion('^0.1.6'), null)
  assert.equal(parseVersion('1.2'), null)
  assert.equal(parseVersion('latest'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion(42), null)
  assert.equal(parseVersion(null), null)
})

const SATISFIED = [
  // The exact production shape: a prerelease runtime inside a release range.
  ['0.1.7-rc.2', '^0.1.6'],
  ['0.1.7-rc.2', '>=0.1.5'],
  ['0.1.7-rc.2', '*'],
  ['0.1.7-rc.2', 'workspace:*'],
  ['0.1.7-rc.2', 'workspace:^'],
  ['0.1.7-rc.2', 'workspace:~'],
  ['0.1.7-rc.2', '^0.1.6 || ^0.2.0'],
  ['0.1.7-rc.2', '>=0.1.0 <0.2.0'],
  ['0.1.7-rc.2', '0.1.x'],
  ['0.1.7-rc.2', '0.1.7-rc.2'],
  ['0.1.7-rc.2', '~0.1.6'],
  ['1.2.3', '^1.2.3'],
  ['1.9.9', '^1.2.3'],
  ['2.0.0', '^2.0.0'],
  ['0.0.3', '^0.0.3'],
  ['1.2.9', '1.2.x'],
  ['1.2.9', '1.2.x || 3.0.0'],
  ['1.2.9', '1.2.3 - 1.4.0'],
  ['0.1.10-rc.1', '^0.1.9'],
  ['0.2.0-rc.1', '^0.1.6'],
]
const REFUSED = [
  ['0.1.7-rc.2', '^0.1.8'],
  ['0.1.7-rc.2', '>=0.2.0'],
  ['0.1.7-rc.2', ''],
  ['0.1.7-rc.2', '   '],
  ['0.1.7-rc.2', 'latest'],
  ['0.1.7-rc.2', 'workspace:1.2.3'],
  ['0.1.7-rc.2', '^0.1.6 !garbage'],
  ['0.2.0', '^0.1.6'],
  ['0.1.5', '^0.1.6'],
  ['2.0.0', '^1.2.3'],
  ['0.0.4', '^0.0.3'],
  ['0.0.2', '^0.0.3'],
  ['1.3.0', '~1.2.3'],
  ['1.3.0', '1.2.x'],
  ['1.4.1', '1.2.3 - 1.4.0'],
  ['0.1.9', '^0.1.10'],
]

check('2. satisfiesDshRange mirrors the host admission rule (includePrerelease, workspace, fail closed)', () => {
  for (const [version, range] of SATISFIED) {
    assert.equal(satisfiesDshRange(version, range), true, `${version} SHOULD satisfy ${JSON.stringify(range)}`)
  }
  for (const [version, range] of REFUSED) {
    assert.equal(satisfiesDshRange(version, range), false, `${version} should NOT satisfy ${JSON.stringify(range)}`)
  }
  assert.equal(satisfiesDshRange('not-a-version', '*'), false, 'an unparseable runtime fails closed')
})

check('3. dshPeersOf keeps only the dsh peers the host enforces', () => {
  assert.deepEqual(dshPeersOf({
    '@deepseek-ai/dsh': '^0.1.6',
    '@deepseek-ai/dsh-webhook': 'workspace:*',
    esbuild: '>=0.17.0',
    react: '^18.0.0',
  }), { '@deepseek-ai/dsh': '^0.1.6', '@deepseek-ai/dsh-webhook': 'workspace:*' })
  assert.deepEqual(dshPeersOf(null), {})
  assert.deepEqual(dshPeersOf('nonsense'), {})
  assert.deepEqual(dshPeersOf({ '@deepseek-ai/dsh': 42 }), {}, 'a non-string range is dropped, not crashed on')
})

check('4. evaluateDshPeerCompat names each incompatible peer', () => {
  const peers = { '@deepseek-ai/dsh': '^0.1.6', '@deepseek-ai/dsh-skill': 'workspace:*' }
  assert.deepEqual(evaluateDshPeerCompat(peers, '0.1.7-rc.2'), { ok: true, incompatible: {} })
  assert.deepEqual(evaluateDshPeerCompat(peers, '0.2.0'), {
    ok: false,
    incompatible: { '@deepseek-ai/dsh': '^0.1.6' },
  }, 'only the genuinely unsatisfied peer is reported')
})

await checkAsync('5. runtime version override + installed manifest reads round-trip', async () => {
  process.env.DSH_RUNTIME_VERSION = '9.9.9-rc.1'
  resetRuntimeVersionCacheForTests()
  try {
    assert.equal(resolveDshRuntimeVersion(), '9.9.9-rc.1', 'the env override wins and is cached')
  } finally {
    delete process.env.DSH_RUNTIME_VERSION
    resetRuntimeVersionCacheForTests()
  }

  const profile = mkdtempSync(join(tmpdir(), 'dsh-peer-compat-'))
  try {
    const pkgDir = join(profile, 'node_modules', '@deepseek-ai', 'dsh-fake-plugin')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-fake-plugin',
      version: '1.4.2',
      peerDependencies: { '@deepseek-ai/dsh': '^0.1.6', esbuild: '>=0.17.0' },
    }))
    const info = readInstalledDshPeers(profile, '@deepseek-ai/dsh-fake-plugin')
    assert.deepEqual(info, {
      version: '1.4.2',
      peers: { '@deepseek-ai/dsh': '^0.1.6' },
    }, 'the manifest read filters to dsh peers and carries the exact version')
    assert.equal(readInstalledDshPeers(profile, '@deepseek-ai/dsh-absent'), null, 'a missing manifest is null, not a throw')
    assert.equal(readInstalledDshPeers(profile, ''), null)

    const verdict = evaluateDshPeerCompat(info.peers, '0.1.7-rc.2')
    assert.deepEqual(verdict, { ok: true, incompatible: {} }, 'the real production range evaluates compatible')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

console.log(results.join('\n'))
console.log(`verify-peer-compat OK: ${results.length} checks`)
