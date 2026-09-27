#!/usr/bin/env node
/**
 * Store versions (Phase F2) contract check.
 *
 * The stores always WROTE a version; this pins that they now READ it: a newer
 * file is refused loudly instead of being misread and written back, an older
 * one runs its migration chain, and an unversioned file counts as v1 (every
 * file written before versioning).
 *
 * Zero dependencies; part of npm test.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { StoreVersionError, assertStoreReadable, isStoreVersionRefusal, readStore } from '../lib/store-version.js'
import { createUsageLedger, readUsageLedger } from '../lib/usage-ledger.js'
import { applyCronAdmin } from '../lib/cron-admin.js'
import { applyWebhookAdmin } from '../lib/webhook-triggers.js'

const results = []
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

const dir = mkdtempSync(join(tmpdir(), 'dsh-admin-store-'))
// Also on exit: a failing check throws before the trailing rmSync (and this
// script mounts cron/webhook watchers, so a leak would also hold files open).
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })

await check('classification: missing version is v1, equal is ok, newer is refused', () => {
  assert.equal(readStore({ entries: [] }, { current: 1 }).status, 'ok', 'unversioned reads as v1')
  assert.equal(readStore({ version: 1, entries: [] }, { current: 1 }).status, 'ok')
  const newer = readStore({ version: 3, entries: [] }, { current: 2 })
  assert.equal(newer.status, 'newer')
  assert.equal(newer.version, 3)
  assert.equal(newer.supported, 2)
  assert.equal(readStore(null, { current: 1 }).status, 'invalid')
  assert.equal(readStore([], { current: 1 }).status, 'invalid', 'a bare array is not a store')
})

await check('an older file runs the declared migration chain and gets stamped', () => {
  const steps = [
    { from: 1, to: 2, migrate: (data) => ({ ...data, entries: (data.entries ?? []).map((e) => ({ ...e, seconds: 0 })) }) },
    { from: 2, to: 3, migrate: (data) => ({ ...data, migratedAt: true }) },
  ]
  const result = readStore({ version: 1, entries: [{ id: 'a' }] }, { current: 3, migrations: steps })
  assert.equal(result.status, 'migrated')
  assert.deepEqual(result.applied, ['1→2', '2→3'], 'steps ran in order')
  assert.equal(result.data.version, 3, 'the result is stamped with the current version')
  assert.equal(result.data.entries[0].seconds, 0, 'step 1 applied')
  assert.equal(result.data.migratedAt, true, 'step 2 applied')
  const stuck = readStore({ version: 1, entries: [] }, { current: 3, migrations: [steps[0]] })
  assert.equal(stuck.status, 'unmigratable', 'a gap in the chain is reported, not guessed')
})

await check('assertStoreReadable throws a typed error for newer and unmigratable', () => {
  assert.throws(
    () => assertStoreReadable({ status: 'newer', version: 9, supported: 2 }, '测试存储'),
    (error) => error instanceof StoreVersionError && error.code === 'STORE_VERSION_NEWER' && /测试存储/.test(error.message),
  )
  assert.doesNotThrow(() => assertStoreReadable({ status: 'ok', version: 2, supported: 2 }, 'x'))
})

await check('the usage ledger refuses a file from a newer plugin', () => {
  const ledger = join(dir, 'usage-ledger.json')
  writeFileSync(ledger, JSON.stringify({ version: 99, entries: [{ sessionId: 's', input: 1, output: 2 }] }))
  assert.throws(() => readUsageLedger(ledger), (error) => error.code === 'STORE_VERSION_NEWER')
  // …and a normal file still reads.
  writeFileSync(ledger, JSON.stringify({ version: 1, entries: [{ sessionId: 's', input: 1, output: 2, at: 1 }] }))
  assert.ok(Array.isArray(readUsageLedger(ledger)), 'a current file still reads (entry filtering is the ledger\'s own business)')
})

await check('a newer tasks file degrades the mount instead of aborting the plugin, and still refuses writes', async () => {
  const tasks = join(dir, 'cron-tasks.json')
  const warnings = []
  const makeCtx = () => {
    const ctx = {
      baseUrl: 'http://127.0.0.1:1',
      logger: { info: () => {}, warn: (message) => warnings.push(String(message)), error: () => {} },
      get: () => undefined,
      effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
      provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
    }
    return ctx
  }
  // A newer file must NOT abort applyCronAdmin. The mount is ONE step of the
  // plugin's apply(), and the typert registration that publishes every RPC
  // namespace comes after it — throwing here would take all fourteen
  // namespaces and every panel down for one store's version. The refusal
  // belongs where it protects the file: the mirror degrades to empty (misread
  // data is never served) and every mutation guard still throws (a build that
  // cannot read the file never rewrites it).
  writeFileSync(tasks, JSON.stringify({ version: 99, tasks: [] }))
  const refusedCtx = makeCtx()
  assert.doesNotThrow(
    () => applyCronAdmin(refusedCtx, { enqueue: (op) => Promise.resolve().then(op), settings: { cronTasksPath: tasks } }),
    'a newer store no longer aborts the mount',
  )
  const degraded = await refusedCtx.provided.cronAdmin.list()
  assert.deepEqual(degraded.tasks, [], 'the mirror degrades to empty instead of serving a misread store')
  assert.ok(warnings.some((message) => message.includes('文件版本')), 'the refusal is reported to the operator once')
  await assert.rejects(
    () => refusedCtx.provided.cronAdmin.upsert({ id: 'x', cron: '* * * * *', action: { mode: 'steer', sessionId: 's' } }),
    (error) => error.code === 'STORE_VERSION_NEWER',
    'a write against the newer file is still refused',
  )
  // A current file mounts, and a newer one written afterwards stops the WRITE
  // path (the file watcher keeps the previous mirror by design).
  writeFileSync(tasks, JSON.stringify({ version: 1, tasks: [] }))
  const ctx = makeCtx()
  applyCronAdmin(ctx, { enqueue: (op) => Promise.resolve().then(op), settings: { cronTasksPath: tasks } })
  assert.equal((await ctx.provided.cronAdmin.list()).ok, true, 'a current file mounts and lists')
  writeFileSync(tasks, JSON.stringify({ version: 99, tasks: [] }))
  await assert.rejects(
    () => ctx.provided.cronAdmin.upsert({ id: 'x', cron: '* * * * *', action: { mode: 'steer', sessionId: 's' } }),
    (error) => error.code === 'STORE_VERSION_NEWER',
    'a write against a newer file is refused',
  )
})

await check('the refusal classifies by code, so a duplicated module instance still downgrades', () => {
  assert.equal(isStoreVersionRefusal(new StoreVersionError('测试', 3, 1)), true, 'the typed error classifies')
  assert.equal(isStoreVersionRefusal(Object.assign(new Error('x'), { code: 'STORE_VERSION_NEWER' })), true, 'the code alone classifies')
  assert.equal(isStoreVersionRefusal(Object.assign(new Error('disk full'), { code: 'ENOSPC' })), false, 'other failures stay loud')
  assert.equal(isStoreVersionRefusal(undefined), false)
  assert.equal(isStoreVersionRefusal(null), false)
})

await check('a newer rules file degrades the webhook mount instead of aborting the plugin', async () => {
  // applyWebhookAdmin resolves the profile from ctx.baseUrl (patch-utils'
  // profileDirOf), so the fixture needs a package.json beside the anchor.
  const profileDir = join(dir, 'profile-degraded')
  mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-admin'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture', dependencies: {} }))
  const rulesPath = join(dir, 'webhook-rules-newer.json')
  const historyPath = join(dir, 'webhook-history-newer.json')
  writeFileSync(rulesPath, JSON.stringify({ version: 99, rules: [] }))
  writeFileSync(historyPath, JSON.stringify({ version: 1, history: [], seen: [] }))
  const warnings = []
  const disposers = []
  const ctx = {
    baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: (message) => warnings.push(String(message)), error: () => {} },
    get: () => undefined,
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
  }
  assert.doesNotThrow(() => applyWebhookAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op),
    runPnpm: null,
    reconcileBundles: null,
    settings: { webhookTriggersPath: rulesPath, webhookHistoryPath: historyPath },
  }), 'a newer rules file no longer aborts the mount')
  const listed = await ctx.provided.webhookAdmin.list()
  assert.deepEqual(listed.rules, [], 'no misread rule is served')
  assert.ok(warnings.some((message) => message.includes('文件版本')), 'the refusal is reported to the operator once')
  await assert.rejects(
    () => ctx.provided.webhookAdmin.saveRule({ id: 'probe', enabled: true, secret: 'topsecret-key-16chars', action: { mode: 'steer', sessionId: 's', steer: true } }),
    (error) => error.code === 'STORE_VERSION_NEWER',
    'saving over the newer file is still refused',
  )
  for (const dispose of disposers) { try { dispose() } catch { /* idempotent */ } }
})

await check('a newer history sidecar is left untouched while deliveries keep working', async () => {
  // The sidecar's `version` used to be written but never READ: a file from a
  // newer plugin was misread as an empty v1 store and then overwritten, and a
  // shape change to `seen` would have re-executed already-claimed delivery ids.
  const profileDir = join(dir, 'profile-newer-history')
  mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-admin'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture', dependencies: {} }))
  const rulesPath = join(dir, 'history-probe-rules.json')
  const historyPath = join(dir, 'history-probe-history.json')
  writeFileSync(rulesPath, JSON.stringify({ version: 1, rules: [] }))
  const newerSidecar = JSON.stringify({ version: 99, history: [{ at: 'x', ruleId: 'future' }], seen: ['kept'] }, null, 2) + '\n'
  writeFileSync(historyPath, newerSidecar)
  const warnings = []
  const disposers = []
  const steered = []
  const ctx = {
    baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: (message) => warnings.push(String(message)), error: () => {} },
    get: (key) => (key === 'agents'
      ? { get: (id) => (id === 'live' ? { steer: (msg) => steered.push(msg) } : undefined) }
      : undefined),
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
  }
  applyWebhookAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op),
    runPnpm: null,
    reconcileBundles: null,
    settings: { webhookTriggersPath: rulesPath, webhookHistoryPath: historyPath },
  })
  assert.ok(
    warnings.some((message) => message.includes('webhook-history.json')),
    'the newer sidecar is reported',
  )
  await ctx.provided.webhookAdmin.saveRule({ id: 'probe', enabled: true, secret: 'topsecret-key-16chars', action: { mode: 'steer', sessionId: 'live', steer: true } })
  // A delivery exercises the history-flush path (testRule steers directly).
  const tested = await ctx.provided.webhookAdmin.testRule('probe')
  assert.equal(tested.ok, true, 'deliveries still work with the sidecar refused')
  assert.equal(steered.length, 1, 'and the action really ran')
  assert.equal(readFileSync(historyPath, 'utf8'), newerSidecar, 'the newer sidecar is byte-identical (never rewritten)')
  for (const dispose of disposers) { try { dispose() } catch { /* idempotent */ } }
})

await check('the webhook rules save refuses a newer file (write path is guarded)', async () => {
  // applyWebhookAdmin resolves the profile from ctx.baseUrl (patch-utils'
  // profileDirOf), so the fixture needs a package.json beside the anchor.
  const profileDir = join(dir, 'profile')
  mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-admin'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture', dependencies: {} }))
  const rulesPath = join(dir, 'webhook-triggers.json')
  const historyPath = join(dir, 'webhook-history.json')
  writeFileSync(rulesPath, JSON.stringify({ version: 1, rules: [] }))
  writeFileSync(historyPath, JSON.stringify({ version: 1, history: [], seen: [] }))
  const disposers = []
  const ctx = {
    baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: () => undefined,
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
  }
  applyWebhookAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op),
    runPnpm: null,
    reconcileBundles: null,
    settings: { webhookTriggersPath: rulesPath, webhookHistoryPath: historyPath },
  })
  const rule = { id: 'probe', enabled: true, secret: 'topsecret-key-16chars', action: { mode: 'steer', sessionId: 's', steer: true } }
  const first = await ctx.provided.webhookAdmin.saveRule(rule)
  assert.equal(first.ok, true, 'a current file accepts a save')
  // A newer file appears under the running mount: the next save must refuse
  // instead of writing the mirror over a file this build cannot read.
  writeFileSync(rulesPath, JSON.stringify({ version: 99, rules: [] }))
  await assert.rejects(
    () => ctx.provided.webhookAdmin.saveRule({ ...rule, id: 'probe-2' }),
    (error) => error.code === 'STORE_VERSION_NEWER',
  )
  // Dispose the mount: its rules watcher would otherwise hold the event loop open.
  for (const dispose of disposers) { try { dispose() } catch { /* idempotent */ } }
})

await check('the usage ledger refuses to persist over a newer file', async () => {
  const ledgerPath = join(dir, 'ledger-write.json')
  writeFileSync(ledgerPath, JSON.stringify({ version: 1, entries: [] }))
  const ledger = createUsageLedger({ path: ledgerPath, now: () => 1 })
  writeFileSync(ledgerPath, JSON.stringify({ version: 99, entries: [] }))
  await assert.rejects(
    () => ledger.record([{ sessionId: 's', input: 1, output: 2 }]),
    (error) => error.code === 'STORE_VERSION_NEWER',
  )
})

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-store-version OK: ' + results.length + ' checks (classification, migration, adoption)')
// The webhook mount's fs.watch listener holds the event loop open after a
// green run — exit hard so CI never wedges (same recipe as
// verify-webhook-triggers.mjs).
process.exit(0)
