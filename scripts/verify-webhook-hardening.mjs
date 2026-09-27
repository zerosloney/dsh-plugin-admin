#!/usr/bin/env node
/**
 * Webhook inbound hardening (Phase F4) contract check.
 *
 * The endpoint is a local-integration feature that speaks HTTP to whoever can
 * reach the port. What this pins:
 *   - only this machine may deliver unless the config explicitly opts in;
 *   - a reachable port is not a free brute-force oracle (failure lockout) and
 *     not a free DoS target (request budget), both answered 429 + retry-after;
 *   - the secret comparison stays timing-safe and length-agnostic.
 *
 * Zero dependencies; part of npm test.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  applyWebhookAdmin,
  createRateLimiter,
  isLoopbackAddress,
  remoteAddressOf,
  secretMatches,
} from '../lib/webhook-triggers.js'

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

const dir = mkdtempSync(join(tmpdir(), 'dsh-admin-webhook-hardening-'))
// Also on exit: a failing check throws before the trailing rmSync, and the
// mounts below start fs.watch listeners over this directory.
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })
process.env.DSH_HOME = join(dir, 'home')
mkdirSync(process.env.DSH_HOME, { recursive: true })
const profileDir = join(dir, 'profile')
mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-admin'), { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture', dependencies: {} }))

const SECRET = 'topsecret-key-16chars'
const steered = []

/**
 * Mount the webhook runtime over a fresh store and return its handler.
 * @param {Record<string, any>} settings - plugin config overrides.
 * @param {string[]} [logs] - collects `logger.warn` lines (observability checks).
 * @returns {{ handler: Function, dispose: () => void, service: any }}
 */
function mount(settings, logs = []) {
  const routes = []
  const disposers = []
  const ctx = {
    baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: (line) => logs.push(String(line)), error: () => {} },
    get: (key) => {
      if (key === 'webServer') return { register: (entry) => { routes.push(entry); return () => {} } }
      if (key === 'agents') {
        return { get: (id) => (id === 'session-live' ? { steer: (msg) => steered.push({ id, msg }) } : undefined) }
      }
      return undefined
    },
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
    inject: undefined,
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
  }
  applyWebhookAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op),
    runPnpm: null,
    reconcileBundles: null,
    settings,
  })
  return {
    handler: routes[0].handler,
    service: ctx.provided.webhookAdmin,
    dispose: () => { for (const d of disposers.splice(0)) { try { d() } catch { /* idempotent */ } } },
  }
}

const mockRes = () => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
  writeHead(status, headers) {
    this.statusCode = status
    if (headers && typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) this.headers[String(key).toLowerCase()] = value
    }
    return this
  },
  end(text) { this.body = String(text ?? ''); return this },
  write(text) { this.body += String(text ?? ''); return this },
})

const jsonReq = ({ ruleId = 'rule-a', secret = SECRET, remote = '127.0.0.1', body = '{"hello":"world"}' } = {}) => ({
  method: 'POST',
  url: '/webhook-triggers/' + ruleId,
  headers: { 'content-type': 'application/json', ...(secret === undefined ? {} : { 'x-webhook-secret': secret }) },
  complete: true,
  resume() {},
  socket: remote === null ? {} : { remoteAddress: remote },
  async *[Symbol.asyncIterator]() { yield Buffer.from(body, 'utf8') },
})

const RULE = { id: 'rule-a', enabled: true, secret: SECRET, action: { mode: 'steer', sessionId: 'session-live', steer: true } }

await check('address helpers: loopback, IPv4-mapped loopback, and transport fallbacks', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('127.9.9.9'), true, 'the whole 127/8 block is this machine')
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true, 'IPv4-mapped loopback')
  assert.equal(isLoopbackAddress('203.0.113.9'), false)
  assert.equal(isLoopbackAddress(null), false)
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '10.0.0.2' } }), '10.0.0.2')
  assert.equal(remoteAddressOf({ socket: {} }), null, 'a hidden transport reports null, not a fake address')
})

await check('the secret comparison is timing-safe and length-agnostic', () => {
  assert.equal(secretMatches(SECRET, SECRET), true)
  assert.equal(secretMatches(SECRET, SECRET.slice(0, -1)), false)
  assert.equal(secretMatches(SECRET, SECRET + 'x'), false, 'a longer guess fails without throwing')
  assert.equal(secretMatches(SECRET, ''), false)
})

await check('the limiter budgets requests and locks out failed authentications', () => {
  let clock = 1_000
  const rate = createRateLimiter({ max: 3, windowMs: 1_000, authFailMax: 2, now: () => clock })
  assert.equal(rate.allow('a'), true)
  assert.equal(rate.allow('a'), true)
  assert.equal(rate.allow('a'), true)
  assert.equal(rate.allow('a'), false, 'the fourth request in the window is refused')
  assert.equal(rate.allow('b'), true, 'another caller has its own budget')
  clock += 1_001
  assert.equal(rate.allow('a'), true, 'the window slides')
  const lock = createRateLimiter({ authFailMax: 2, now: () => clock })
  assert.equal(lock.lockedOut('a'), false)
  lock.noteAuthFailure('a')
  lock.noteAuthFailure('a')
  assert.equal(lock.lockedOut('a'), true, 'two failures lock the caller out')
  assert.equal(lock.lockedOut('b'), false, 'the lockout is per caller')
  assert.ok(lock.retryAfterSeconds('a') >= 1, 'retry-after is at least a second')
})

await check('retry-after reports the longer of the two budgets, not the earlier one', () => {
  let clock = 0
  const rate = createRateLimiter({ max: 100, windowMs: 60_000, authFailMax: 2, now: () => clock })
  assert.equal(rate.allow('a'), true, 'a request at t=0')
  clock = 55_000
  rate.noteAuthFailure('a')
  rate.noteAuthFailure('a')
  assert.equal(rate.lockedOut('a'), true, 'two failures at t=55s lock the caller out')
  // The lock ends when the FAILURES leave the window (t=115s) — 60s away. The
  // stale hit at t=0 drains 5s from now, and the first cut reported that earlier
  // bucket, so a client honouring the header retried every second into a wall of
  // 429s for a minute.
  assert.equal(rate.retryAfterSeconds('a'), 60, 'the wait is measured from the blocking bucket')
  clock = 60_000
  assert.equal(rate.retryAfterSeconds('a'), 55, 'and keeps counting from the failures')
  clock = 115_000
  assert.equal(rate.lockedOut('a'), false, 'the window that blocked it has drained')
})

await check('the limiter reclaims drained callers instead of growing forever', () => {
  let clock = 1_000
  const rate = createRateLimiter({ max: 2, windowMs: 1_000, authFailMax: 2, now: () => clock })
  rate.allow('a')
  rate.noteAuthFailure('a')
  assert.deepEqual(rate.trackedCallers(), { hits: 1, fails: 1 }, 'a live caller is tracked in both buckets')
  clock += 1_001
  assert.equal(rate.lockedOut('a'), false, 'the failure window drained')
  assert.deepEqual(rate.trackedCallers(), { hits: 1, fails: 0 }, 'the drained failure bucket is dropped, not parked empty')
  assert.equal(rate.allow('a'), true)
  assert.deepEqual(rate.trackedCallers(), { hits: 1, fails: 0 }, 'the drained request bucket is dropped too')
  // A burst of one-shot callers used to leave two permanent entries each.
  for (let i = 0; i < 600; i += 1) rate.allow('burst-' + i)
  assert.ok(rate.trackedCallers().hits >= 600, 'the live burst is tracked')
  clock += 1_001
  rate.allow('after-sweep')
  assert.ok(rate.trackedCallers().hits <= 2, 'the sweep reclaimed the drained burst (got ' + rate.trackedCallers().hits + ')')
})

await check('a non-loopback caller is refused unless the config opts in', async () => {
  const local = mount({ webhookTriggersPath: join(dir, 'a-rules.json'), webhookHistoryPath: join(dir, 'a-history.json') })
  await local.service.saveRule(RULE)
  const remote = mockRes()
  await local.handler(jsonReq({ remote: '203.0.113.9' }), remote)
  assert.equal(remote.statusCode, 403, 'remote delivery refused by default')
  assert.match(remote.body, /本机/, 'the refusal explains the loopback rule')
  const loop = mockRes()
  await local.handler(jsonReq({ remote: '::ffff:127.0.0.1' }), loop)
  assert.equal(loop.statusCode, 202, 'loopback delivery still works')
  local.dispose()

  const open = mount({
    webhookTriggersPath: join(dir, 'b-rules.json'),
    webhookHistoryPath: join(dir, 'b-history.json'),
    webhookAllowRemote: true,
  })
  await open.service.saveRule(RULE)
  const allowed = mockRes()
  await open.handler(jsonReq({ remote: '203.0.113.9' }), allowed)
  assert.equal(allowed.statusCode, 202, 'webhookAllowRemote: true admits a remote caller')
  open.dispose()
})

await check('repeated authentication failures are throttled (429 + retry-after)', async () => {
  const m = mount({ webhookTriggersPath: join(dir, 'c-rules.json'), webhookHistoryPath: join(dir, 'c-history.json'), webhookRateLimit: 100 })
  await m.service.saveRule(RULE)
  for (let i = 0; i < 10; i += 1) {
    const res = mockRes()
    await m.handler(jsonReq({ secret: 'wrong-secret-16chars' }), res)
    assert.equal(res.statusCode, 401, 'attempt ' + (i + 1) + ' is a 401')
  }
  const throttled = mockRes()
  await m.handler(jsonReq({ secret: 'wrong-secret-16chars' }), throttled)
  assert.equal(throttled.statusCode, 429, 'the lockout answers 429')
  assert.ok(Number(throttled.headers['retry-after']) >= 1, 'retry-after is set')
  const good = mockRes()
  await m.handler(jsonReq(), good)
  assert.equal(good.statusCode, 429, 'a locked-out caller cannot retry with the right secret either')
  m.dispose()
})

await check('the request budget caps a flood (429)', async () => {
  const m = mount({ webhookTriggersPath: join(dir, 'd-rules.json'), webhookHistoryPath: join(dir, 'd-history.json'), webhookRateLimit: 3 })
  await m.service.saveRule(RULE)
  for (let i = 0; i < 3; i += 1) {
    const res = mockRes()
    await m.handler(jsonReq(), res)
    assert.equal(res.statusCode, 202, 'delivery ' + (i + 1) + ' accepted')
  }
  const over = mockRes()
  await m.handler(jsonReq(), over)
  assert.equal(over.statusCode, 429, 'the fourth request in the window is refused')
  m.dispose()
})

await check('a peer the transport cannot report is refused (fail closed)', async () => {
  const local = mount({ webhookTriggersPath: join(dir, 'e-rules.json'), webhookHistoryPath: join(dir, 'e-history.json') })
  await local.service.saveRule(RULE)
  const hidden = mockRes()
  await local.handler(jsonReq({ remote: null }), hidden)
  assert.equal(hidden.statusCode, 403, 'an unknown peer address is not proof of locality')
  assert.match(hidden.body, /webhookAllowRemote/, 'and the refusal names the opt-in')
  const remote = mockRes()
  await local.handler(jsonReq({ remote: '203.0.113.9' }), remote)
  assert.equal(remote.statusCode, 403, 'a known remote peer is refused the same way')
  // The gate runs before the method/content-type checks: a remote scanner gets
  // one uniform answer instead of a route-existence oracle.
  const probe = mockRes()
  await local.handler({ ...jsonReq({ remote: '203.0.113.9' }), method: 'GET' }, probe)
  assert.equal(probe.statusCode, 403, 'a remote GET is 403, not 405')
  local.dispose()

  const open = mount({
    webhookTriggersPath: join(dir, 'f-rules.json'),
    webhookHistoryPath: join(dir, 'f-history.json'),
    webhookAllowRemote: true,
  })
  await open.service.saveRule(RULE)
  const admitted = mockRes()
  await open.handler(jsonReq({ remote: null }), admitted)
  assert.equal(admitted.statusCode, 202, 'webhookAllowRemote: true is the documented escape hatch for a silent transport')
  open.dispose()
})

await check('authentication failures and lockouts leave a trace for the operator', async () => {
  const logs = []
  const m = mount({
    webhookTriggersPath: join(dir, 'g-rules.json'),
    webhookHistoryPath: join(dir, 'g-history.json'),
    webhookRateLimit: 100,
  }, logs)
  await m.service.saveRule(RULE)
  for (let i = 0; i < 12; i += 1) {
    const res = mockRes()
    await m.handler(jsonReq({ secret: 'wrong-secret-16chars' }), res)
  }
  const authLogs = logs.filter((line) => line.includes('401'))
  assert.equal(authLogs.length, 1, 'a 401 storm produces ONE log line, not one per request (got ' + authLogs.length + ')')
  const lockLogs = logs.filter((line) => line.includes('被封锁'))
  assert.equal(lockLogs.length, 1, 'the lockout is reported once (got ' + lockLogs.length + ')')
  // The panel renders `list().history`, so the attack must be visible there too.
  const view = await m.service.list()
  const failures = view.history.filter((entry) => entry.ok === false)
  assert.ok(failures.some((entry) => String(entry.error).includes('认证失败')), 'the 401 is in the delivery history')
  assert.ok(failures.some((entry) => String(entry.error).includes('被封锁')), 'the lockout is in the delivery history')
  m.dispose()
})

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-webhook-hardening OK: ' + results.length + ' checks (loopback, rate limit, lockout, secret compare, observability)')
// The rules fs.watch listener holds the event loop open after a green run.
process.exit(0)
