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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

await check('summarizeArgs redacts sensitive values by key and caps the detail', () => {
  const summary = summarizeArgs([{ id: 'ci', secret: 'super-secret-value', nested: { apiKey: 'sk-123' } }])
  assert.ok(!summary.includes('super-secret-value'), 'the webhook secret never reaches the summary')
  assert.ok(!summary.includes('sk-123'), 'the nested api key never reaches the summary')
  assert.ok(summary.includes(REDACTED), 'redaction is visible, not silent')
  const long = summarizeArgs(['x'.repeat(2000)])
  assert.ok(long.length <= 401, 'detail is capped (got ' + long.length + ')')
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

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-audit-log OK: ' + results.length + ' checks (recording, redaction, compaction)')
