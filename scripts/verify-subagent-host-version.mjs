#!/usr/bin/env node
/**
 * verify-subagent-host-version.mjs — the persona/toolFilter host-version gate.
 *
 * dsh 0.2.1's tool-subagent `apply()` throws when a config still carries
 * `persona` or `toolFilter` (both moved into Agent Presets). A panel save that
 * writes either key therefore breaks the NEXT BOOT for that composition — the
 * worst receipt there is. The gate has to be version-aware, and the version is
 * read once per process, so each host shape gets its own child process here
 * (DRH_RUNTIME_VERSION is the documented override reader).
 *
 * Run: node scripts/verify-subagent-host-version.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const child = process.env.DSH_SUBAGENT_HOST_PROBE
if (child === '1') {
  // ---- inner half: one host version, one verdict ----
  const { validateEntryInput } = await import(new URL('../lib/subagent-admin.js', import.meta.url).href)
  const spawn = {
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    prepareContinuable: async () => ({}),
    inheritsParentContext: false,
  }
  const env = {
    providers: new Map([['spawn', spawn]]),
    existing: new Map(),
    allIds: new Set(),
    knownTools: new Set(['bash', 'read', 'write']),
  }
  const entry = (config) => ({ id: 'probe', config: { provider: 'spawn', toolName: 'probe_tool', ...config } })
  const host = process.env.DSH_RUNTIME_VERSION
  const is021 = /^0\.[2-9]\.|^[1-9]\./.test(host)
  if (is021) {
    assert.throws(() => validateEntryInput(entry({ persona: 'you research' }), env), /persona[\s\S]*Agent Preset/)
    assert.throws(() => validateEntryInput(entry({ toolFilter: { deny: ['bash'] } }), env), /toolFilter[\s\S]*Agent Preset/)
    // Everything else still saves on a 0.2.1 host.
    assert.doesNotThrow(() => validateEntryInput(entry({ maxDepth: 2 }), env))
  } else {
    assert.doesNotThrow(() => validateEntryInput(entry({ persona: 'you research' }), env),
      'a 0.2.0 host still accepts persona')
    assert.doesNotThrow(() => validateEntryInput(entry({ toolFilter: { deny: ['bash'] } }), env),
      'a 0.2.0 host still accepts toolFilter')
  }
  console.log(`OK host ${host}`)
  process.exit(0)
}

const run = (version) => {
  const result = spawnSync(process.execPath, [self], {
    env: { ...process.env, DSH_SUBAGENT_HOST_PROBE: '1', DSH_RUNTIME_VERSION: version },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${version}: ${result.stderr || result.stdout}`)
}

run('0.2.0-rc.1')
run('0.2.1-rc.2')
console.log('verify-subagent-host-version OK: persona/toolFilter are refused only where the host rejects them')
