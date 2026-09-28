#!/usr/bin/env node
/**
 * Audit trail (Phase F3) contract check.
 *
 * Pins the three promises the trail makes: privileged actions are recorded
 * (and read paths are not), sensitive argument VALUES never reach the file,
 * and the log stays bounded by compacting at its cap. Runs against a temp
 * file — no $DSH_HOME is touched.
 *
 * Zero dependencies; part of npm test.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { AUDITED_METHODS, REDACTED, auditService, createAuditLog, summarizeArgs } = await import(new URL('../lib/audit-log.js', import.meta.url).href)

const results = []
// Async-aware: a sync check() would let the async ones race the summary (and
// the cleanup), which is exactly the flake this script must not have.
const check = async (name, fn) => {
  try {
    await fn()
    results.push('✅ ' + name)
  } catch (error) {
    results.push('❌ ' + name)
    console.error(results.join('\n'))
    throw error
  }
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-admin-audit-'))
const file = join(dir, 'admin-audit.jsonl')
// Registered on exit as well as at the end: an assertion throws before the
// trailing rmSync runs, and a temp directory leaked per failing run adds up.
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })

await check('summarizeArgs redacts sensitive values by key and caps the detail', () => {
  const summary = summarizeArgs([{ id: 'ci', secret: 'super-secret-value', nested: { apiKey: 'sk-123' } }])
  assert.ok(!summary.includes('super-secret-value'), 'the webhook secret never reaches the summary')
  assert.ok(!summary.includes('sk-123'), 'the nested api key never reaches the summary')
  assert.ok(summary.includes(REDACTED), 'redaction is visible, not silent')
  const long = summarizeArgs(['x'.repeat(2000)])
  assert.ok(long.length <= 401, 'detail is capped (got ' + long.length + ')')
})

await check('redaction covers hyphenated keys AND secret-looking VALUES under benign keys', () => {
  // Key-name matching alone let two real leaks through:
  //  1. `x-api-key` — the spelling MCP headers actually use (and the header
  //     DeepSeek's own web-search provider sends);
  //  2. a secret pasted into a free-text field, where the KEY is `command` /
  //     `args` / `promptTemplate` and only the VALUE looks like a credential.
  const byKey = summarizeArgs([{ headers: { 'x-api-key': 'live-header-value' } }])
  assert.ok(!byKey.includes('live-header-value'), 'x-api-key (hyphenated) is redacted: ' + byKey)
  const byValue = summarizeArgs([{ command: 'curl -H "Authorization: Bearer sk-live-abcdefghijklmnop" https://example.test' }])
  assert.ok(!byValue.includes('sk-live-abcdefghijklmnop'), 'a bearer token inside a command is redacted: ' + byValue)
  assert.match(byValue, /Bearer \[redacted\]/, 'the scheme survives so the trail still says what happened')
  const named = summarizeArgs([{ env: { GITHUB_PAT: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' } }])
  assert.ok(!named.includes('ghp_'), 'a non-matching KEY still loses its token-shaped value: ' + named)
  const urlUserinfo = summarizeArgs([{ url: 'https://alice:hunter2@example.test/mcp' }])
  assert.ok(!urlUserinfo.includes('hunter2'), 'URL userinfo is redacted: ' + urlUserinfo)
  assert.ok(urlUserinfo.includes('https://'), 'the scheme/host stay readable')
})

await check('the audit file is created private (0600) where the filesystem has modes', async () => {
  const privateFile = join(dir, 'private-audit.jsonl')
  const log = createAuditLog({ path: privateFile, now: () => 1 })
  await log.record({ action: 'pluginAdmin/install', ok: true })
  const mode = statSync(privateFile).mode & 0o777
  if (process.platform === 'win32') {
    assert.ok(mode !== undefined, 'Windows reports a synthesized mode; nothing to assert beyond existence')
  } else {
    assert.equal(mode, 0o600, 'the trail holds privileged arguments and must not be world-readable (got ' + mode.toString(8) + ')')
  }
  // An existing 0644 file is tightened on first use rather than left as-is
  // (`mode` in writeFileSync only applies at creation).
  if (process.platform !== 'win32') {
    writeFileSync(privateFile, '', { mode: 0o644 })
    chmodSync(privateFile, 0o644)
    const reopened = createAuditLog({ path: privateFile, now: () => 2 })
    await reopened.record({ action: 'pluginAdmin/remove', ok: true })
    assert.equal(statSync(privateFile).mode & 0o777, 0o600, 'a pre-existing loose file is tightened')
  }
})

await check('auditService records mutating calls and leaves read paths alone', async () => {
  const log = createAuditLog({ path: file, cap: 10, now: () => 1000 })
  const service = {
    list: async () => ({ ok: true, value: [] }),
    upsert: async (entry) => ({ ok: true, entry }),
    remove: async () => { throw new Error('nope') },
  }
  auditService(service, 'cronAdmin', log)
  assert.deepEqual(await service.list(), { ok: true, value: [] }, 'read path still works')
  assert.equal(log.size(), 0, 'a read path is not audited')
  await service.upsert({ id: 'daily-standup' })
  assert.equal(log.size(), 1, 'the mutating call landed in the trail')
  await assert.rejects(() => service.remove('x'), /nope/)
  const entries = log.read(10)
  assert.equal(entries.length, 2, 'the failed call is recorded too')
  assert.equal(entries[0].action, 'cronAdmin/remove', 'newest first')
  assert.equal(entries[0].ok, false, 'a thrown call is marked not-ok')
  assert.match(entries[0].error, /nope/)
  assert.equal(entries[1].action, 'cronAdmin/upsert')
  assert.equal(entries[1].ok, true)
  assert.equal(entries[1].at, 1000, 'the injected clock is used')
})

await check('the trail is JSONL on disk and never logs unlisted methods', async () => {
  const log = createAuditLog({ path: file, cap: 10 })
  const service = { list: async () => ({}), upsert: async () => ({}) }
  auditService(service, 'cronAdmin', log)
  await service.list()
  assert.ok(existsSync(file), 'the file exists after the first write')
  const lines = readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2, 'one line per recorded call')
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line), 'every line parses as JSON')
  assert.ok(AUDITED_METHODS.cronAdmin.includes('upsert'), 'the method table lists upsert')
  assert.ok(!AUDITED_METHODS.cronAdmin.includes('list'), 'the method table excludes list')
})

await check('the log compacts at its cap instead of growing without bound', async () => {
  const small = join(dir, 'capped.jsonl')
  const log = createAuditLog({ path: small, cap: 4 })
  for (let i = 0; i < 10; i += 1) await log.record({ action: 'cronAdmin/upsert', detail: String(i) })
  const entries = log.read(100)
  assert.ok(entries.length <= 4, 'compaction keeps the trail bounded (got ' + entries.length + ')')
  assert.equal(entries[0].detail, '9', 'the newest entry survives compaction')
  assert.equal(log.size(), entries.length, 'the cached count matches the file')
})

await check('a service without a recorder keeps its plain methods', async () => {
  const service = { upsert: async () => ({ ok: true }) }
  const returned = auditService(service, 'cronAdmin', undefined)
  assert.equal(returned, service, 'the same object comes back')
  assert.deepEqual(await service.upsert(), { ok: true }, 'no wrapping without a recorder')
})

await check('a failing trail write never changes the action it records', async () => {
  // A recorder that always rejects stands in for a full disk, a read-only path
  // or a directory that cannot be created. The privileged action has ALREADY
  // happened by then, so its result must survive — rejecting would report e.g.
  // cronAdmin/runNow as failed although the task fired, and the user would
  // click again and run it twice.
  const failing = { record: async () => { throw new Error('ENOSPC: no space left on device') } }
  const service = {
    upsert: async (entry) => ({ ok: true, entry }),
    remove: async () => { throw new Error('the action itself failed') },
  }
  auditService(service, 'cronAdmin', failing)
  assert.deepEqual(
    await service.upsert({ id: 'x' }),
    { ok: true, entry: { id: 'x' } },
    'a successful action still resolves when the trail cannot be written',
  )
  await assert.rejects(
    () => service.remove('x'),
    /the action itself failed/,
    'the action\'s own error survives — it is not replaced by the audit error',
  )
})

await check('the recorder creates a missing parent directory instead of failing every action', async () => {
  const nested = join(dir, 'nested', 'deeper', 'audit.jsonl')
  const log = createAuditLog({ path: nested })
  await log.record({ action: 'pluginAdmin/install', ok: true })
  assert.ok(existsSync(nested), 'the configured auditLogPath directory is created on demand')
  assert.equal(log.read(1)[0].action, 'pluginAdmin/install', 'and the entry landed')
})

await check('the wired namespaces and the AUDITED_METHODS rows are the same set', () => {
  // Both directions of the gap this check exists for: a namespace that hands
  // auditService a recorder but has no row used to be a silent no-op
  // (webSearchAdmin shipped unaudited that way), and a row with no wiring is
  // dead config promising coverage that cannot happen (workspaceAdmin /
  // subagentAdmin did exactly that).
  const libDir = join(here, '..', 'lib')
  const wired = new Set()
  const unresolved = []
  for (const name of readdirSync(libDir).filter((entry) => entry.endsWith('.js'))) {
    const text = readFileSync(join(libDir, name), 'utf8')
    // `(?<!function )` skips the declaration itself; only call sites count.
    for (const match of text.matchAll(/(?<!function )auditService\([^,]+,\s*([A-Za-z_$][\w$]*|'[^']+')\s*,/g)) {
      const arg = match[1]
      if (arg.startsWith("'")) { wired.add(arg.slice(1, -1)); continue }
      const declaration = new RegExp('const\\s+' + arg + "\\s*=\\s*'([^']+)'").exec(text)
      if (declaration === null) unresolved.push(name + ': ' + arg)
      else wired.add(declaration[1])
    }
  }
  assert.deepEqual(unresolved, [], 'every auditService call site resolves to a namespace literal')
  assert.deepEqual(
    [...wired].sort(),
    Object.keys(AUDITED_METHODS).sort(),
    'the wired namespaces match the AUDITED_METHODS rows',
  )
})

await check('a namespace without a table row fails loud instead of wrapping nothing', async () => {
  const log = createAuditLog({ path: join(dir, 'unlisted.jsonl') })
  const service = { doThing: async () => ({ ok: true }) }
  assert.throws(
    () => auditService(service, 'notInTheTable', log),
    /no AUDITED_METHODS row/,
    'a privileged namespace cannot ship unaudited',
  )
  assert.deepEqual(await service.doThing(), { ok: true }, 'and the service is left untouched by the refusal')
})

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-audit-log OK: ' + results.length + ' checks (recording, redaction, compaction, resilience, coverage)')
