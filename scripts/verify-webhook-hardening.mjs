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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// The predicate used to end in a bare `addr.startsWith('127.')`, so any TEXT
// beginning with `127.` was accepted as this machine. The stock http transport
// always reports a kernel-derived literal, but this function is exported and is
// the only gate on an unauthenticated steer, and the module already supports
// transports that supply an address it did not derive from a socket.
await check('loopback is PARSED, not prefix-matched (hostname/port spoofing is not this machine)', () => {
  assert.equal(isLoopbackAddress('127.evil.com'), false, 'a hostname starting with 127. is not the loopback IP')
  assert.equal(isLoopbackAddress('127.0.0.1.evil.com'), false, 'a suffix after the literal is not loopback')
  assert.equal(isLoopbackAddress('127.0.0.1:8080'), false, 'a port suffix is not a bare address')
  assert.equal(isLoopbackAddress('127.0.0.1\tx'), false)
  assert.equal(isLoopbackAddress('localhost'), false, 'a hostname is not proof of locality')
  assert.equal(isLoopbackAddress('127.0.0.1 '), false, 'trailing whitespace is not trimmed into trust')
  assert.equal(isLoopbackAddress('1270.0.0.1'), false)
  assert.equal(isLoopbackAddress('127.0.0.256'), false, 'an out-of-range octet is not an address')
  assert.equal(isLoopbackAddress('127.1'), false, 'shorthand forms are refused, not silently accepted')
  assert.equal(isLoopbackAddress('127.0.0.1'), true, 'the real literal still passes')
})

// A peer address is only meaningful if it was OBSERVED. The pre-F4 reader took
// any duck-typed `remoteAddress` string, so `'127.evil.com'` / `'127.0.0.1:8080'`
// / a hostname all parsed as this machine. The provenance that replaced it is
// the VALUE SHAPE (a net.isIP literal) plus family corroboration — the middle
// cut's "own data property" requirement rejected every REAL socket, because
// node defines remoteAddress as a Socket.prototype accessor (see the real-HTTP
// check below), which 403'd all loopback deliveries by default.
await check('remoteAddressOf accepts only an IP literal, with a corroborating family', () => {
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '203.0.113.9' } }), '203.0.113.9', 'a plain socket reads normally')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '::1', remoteFamily: 'IPv6' } }), '::1', 'IPv6 with a matching family')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '127.0.0.1', remoteFamily: 'IPv4' } }), '127.0.0.1', 'explicit IPv4 family')
  // Transports have been seen reporting EITHER family for an IPv4-mapped peer
  // (`IPv6` on win32/Node 24, `IPv4` in older releases); both spellings are
  // coherent for a mapped literal, and only for a mapped literal.
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '::ffff:127.0.0.1', remoteFamily: 'IPv6' } }), '::ffff:127.0.0.1', 'a mapped literal with the IPv6 family')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '::ffff:127.0.0.1', remoteFamily: 'IPv4' } }), '::ffff:127.0.0.1', 'a mapped literal with the logical IPv4 family')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '::1', remoteFamily: 'IPv4' } }), null, 'the mapped allowance does not extend to a non-mapped literal')

  // Container shapes node never produces.
  assert.equal(remoteAddressOf({ socket: Object.assign([], { remoteAddress: '127.0.0.1' }) }), null, 'an array socket is refused')
  assert.equal(remoteAddressOf(Object.assign([], { socket: { remoteAddress: '127.0.0.1' } })), null, 'an array request is refused')

  // Value shape: an address, not text that merely looks like one. This is where
  // '127.evil.com' and friends die — before the loopback predicate ever runs.
  assert.equal(remoteAddressOf({ socket: { remoteAddress: 'localhost' } }), null, 'a hostname is not an address')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '127.0.0.1:8080' } }), null, 'an address with a port is not an address')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '127.evil.com' } }), null, 'arbitrary text is not an address')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '' } }), null, 'an empty string is no address')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: 42 } }), null, 'a non-string is not an address')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '127.0.0.1\n203.0.113.9' } }), null, 'embedded whitespace is not an address')

  // Corroboration: a family that contradicts the (non-mapped) literal is still
  // refused — both come from one kernel call, so a mismatch means assembled.
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '127.0.0.1', remoteFamily: 'IPv6' } }), null, 'a contradicting family is refused')
  assert.equal(remoteAddressOf({ socket: { remoteAddress: '::1', remoteFamily: 'IPv4' } }), null, 'the mismatch is checked both ways')

  // Still fail-closed on a hidden peer.
  assert.equal(remoteAddressOf({}), null, 'no socket reports null')
  assert.equal(remoteAddressOf({ socket: {} }), null, 'an addressless socket reports null')
})

// The regression that matters: the own-data-property cut returned null for
// EVERY real request — node's socket carries remoteAddress as a PROTOTYPE
// accessor — so the default-config endpoint 403'd the loopback callers it
// exists for. Only a live http round trip can catch that class of bug; mock
// sockets with own-data properties (every check above) cannot.
await check('a REAL http request passes the locality gate and a real delivery is admitted', async () => {
  const { createServer } = await import('node:http')
  const local = mount({ webhookTriggersPath: join(dir, 'k-rules.json'), webhookHistoryPath: join(dir, 'k-history.json') })
  await local.service.saveRule(RULE)
  let seen = 'no-request'
  const probeServer = createServer((req, res) => {
    seen = remoteAddressOf(req)
    res.end('ok')
  })
  await new Promise((resolve) => probeServer.listen(0, '127.0.0.1', resolve))
  try {
    const probe = await fetch(`http://127.0.0.1:${probeServer.address().port}/probe`)
    await probe.text()
  } finally {
    probeServer.close()
  }
  assert.notEqual(seen, 'no-request', 'the probe arrived')
  assert.ok(seen !== null, `remoteAddressOf reads a REAL socket (prototype accessor), got ${seen}`)
  assert.equal(isLoopbackAddress(seen), true, `the real address parses as loopback (got ${seen})`)

  const deliveryServer = createServer((req, res) => {
    void local.handler(req, res).catch(() => {
      try { res.writeHead(500) } catch { /* already sent */ }
      res.end()
    })
  })
  await new Promise((resolve) => deliveryServer.listen(0, '127.0.0.1', resolve))
  let status = 0
  let body = ''
  try {
    const delivered = await fetch(`http://127.0.0.1:${deliveryServer.address().port}/webhook-triggers/rule-a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: '{"hello":"world"}',
    })
    status = delivered.status
    body = await delivered.text()
  } finally {
    deliveryServer.close()
  }
  assert.equal(status, 202, `a real loopback delivery is admitted, not the own-data cut's 403 (got ${status}: ${body})`)
  local.dispose()
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
  // A burst of one-shot callers used to leave two permanent entries each. It is
  // now additionally HARD-BOUNDED (see the rotation check below), so a 600-entry
  // burst is capped rather than all retained — the point here is that the
  // survivors are reclaimed once their window drains, not that all 600 persist.
  for (let i = 0; i < 600; i += 1) rate.allow('burst-' + i)
  assert.ok(rate.trackedCallers().hits > 0, 'the live burst is tracked')
  assert.ok(rate.trackedCallers().hits <= 600, 'and never exceeds the burst size (the cap is a ceiling)')
  clock += 1_001
  rate.allow('after-sweep')
  assert.ok(rate.trackedCallers().hits <= 2, 'the sweep reclaimed the drained burst (got ' + rate.trackedCallers().hits + ')')
})

// The check above only covers the case where the whole window DRAINS, which is
// the case a size-guarded sweep can already handle. An address-rotating attacker
// never lets a window drain, so the sweep used to be disarmed exactly when it
// mattered: it returned early while `size <= 512`, and by the time the 513th
// caller arrived there was nothing drained to reclaim. Measured before the fix:
// 5000 distinct callers left 5000 entries in EACH map on the same event loop
// that serves the UI. The cap has to be a HARD bound, not a sweep trigger.
await check('the limiter stays BOUNDED under address rotation (no drained window to reclaim)', () => {
  const rate = createRateLimiter({ max: 60, windowMs: 60_000, authFailMax: 10 })
  for (let i = 0; i < 5_000; i += 1) {
    const caller = `198.51.100.${i % 256}:${i}`
    rate.allow(caller)
    rate.noteAuthFailure(caller)
  }
  const tracked = rate.trackedCallers()
  assert.ok(tracked.hits <= 600, `5000 rotating callers must not leave 5000 request buckets (got ${tracked.hits})`)
  assert.ok(tracked.fails <= 600, `nor 5000 failure buckets (got ${tracked.fails})`)
  // Keep going: the bound must not ratchet upward as rotation continues.
  for (let i = 5_000; i < 50_000; i += 1) {
    const caller = `198.51.100.${i % 256}:${i}`
    rate.allow(caller)
    rate.noteAuthFailure(caller)
  }
  const later = rate.trackedCallers()
  assert.ok(later.hits <= 600, `the bound holds after 50k rotations (got ${later.hits})`)
  assert.ok(later.fails <= 600, `and for the failure map too (got ${later.fails})`)
})

// Eviction has to be LEAST-recently-used, not first-in-first-out: a long-lived
// integration is inserted once and touched forever, so under FIFO it would be
// the first casualty of a rotation flood while the attacker's freshest keys
// survived. That is why `prune` re-inserts on touch (delete-then-set moves the
// key to the end; a plain set keeps its original position — measured).
await check('eviction is LRU: an actively-touched caller survives a rotation flood, an idle one does not', () => {
  const rate = createRateLimiter({ max: 1_000_000, windowMs: 60_000, authFailMax: 10 })
  rate.allow('veteran') // inserted FIRST — the worst case for a FIFO policy
  for (let i = 0; i < 2_000; i += 1) {
    rate.allow('veteran') // keeps being touched, as a real integration would
    rate.allow(`rot-${i}`)
    rate.noteAuthFailure(`rot-${i}`)
  }
  assert.ok(rate.retryAfterSeconds('veteran') > 0, 'the touched caller keeps its bucket despite being the oldest insertion')

  const idle = createRateLimiter({ max: 1_000_000, windowMs: 60_000, authFailMax: 10 })
  idle.allow('idle')
  idle.noteAuthFailure('idle')
  for (let i = 0; i < 2_000; i += 1) {
    idle.allow(`rot-${i}`)
    idle.noteAuthFailure(`rot-${i}`)
  }
  assert.equal(idle.retryAfterSeconds('idle'), 0, 'the coldest key is the one evicted')
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
  assert.equal(throttled.statusCode, 429, 'the lockout answers a wrong secret with 429')
  assert.ok(Number(throttled.headers['retry-after']) >= 1, 'retry-after is set')
  // …but a CORRECT secret ends the lockout. The brake exists to stop guessing,
  // and an attacker reaching this branch must already hold the secret; refusing
  // it only locked the operator's own integrations out for the whole window
  // (the shared-bucket variant of that turned one caller into everyone's outage).
  const good = mockRes()
  await m.handler(jsonReq(), good)
  assert.equal(good.statusCode, 202, 'a correct secret is admitted even while the bucket is locked out')
  // The lockout is genuinely cleared, not bypassed once: a wrong secret right
  // after is a plain 401 again, not a permanent 429.
  const afterwards = mockRes()
  await m.handler(jsonReq({ secret: 'wrong-secret-16chars' }), afterwards)
  assert.equal(afterwards.statusCode, 401, 'the failure counter was reset by the successful authentication')
  m.dispose()
})

await check('an address-less transport keeps per-CALLER request budgets', async () => {
  // The transport reports no peer address, so each request carries its own
  // socket object (this mock does; a real keep-alive connection reuses one).
  // Budgeting them as a single shared 'unknown' caller meant one flood starved
  // every other delivery; per-connection keys keep them apart.
  const m = mount({
    webhookTriggersPath: join(dir, 'h-rules.json'),
    webhookHistoryPath: join(dir, 'h-history.json'),
    webhookAllowRemote: true,
    webhookRateLimit: 3,
  })
  await m.service.saveRule(RULE)
  const socketA = { remoteAddress: undefined }
  const socketB = { remoteAddress: undefined }
  const deliver = (socket) => {
    const res = mockRes()
    const req = jsonReq({ remote: null })
    req.socket = socket
    return m.handler(req, res).then(() => res)
  }
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await deliver(socketA)).statusCode, 202, 'caller A delivery ' + (i + 1) + ' accepted')
  }
  assert.equal((await deliver(socketA)).statusCode, 429, 'caller A exhausts ITS request budget')
  assert.equal((await deliver(socketB)).statusCode, 202, 'caller B has its own budget and is not starved')
  m.dispose()
})

await check('an address-less transport still brakes brute force, and a real delivery releases it', async () => {
  // The mirror image of the case above: per-connection FAILURE budgets alone
  // would be no brake at all (a fresh connection per guess = a fresh allowance),
  // so address-less callers share one failure key. The operator's own delivery
  // proves the transport works and clears it, so an attacker cannot hold it.
  const m = mount({
    webhookTriggersPath: join(dir, 'i-rules.json'),
    webhookHistoryPath: join(dir, 'i-history.json'),
    webhookAllowRemote: true,
    webhookRateLimit: 500,
  })
  await m.service.saveRule(RULE)
  const guess = () => {
    const res = mockRes()
    const req = jsonReq({ remote: null, secret: 'wrong-secret-16chars' })
    req.socket = { remoteAddress: undefined }   // a NEW connection per guess
    return m.handler(req, res).then(() => res)
  }
  for (let i = 0; i < 10; i += 1) assert.equal((await guess()).statusCode, 401, 'guess ' + (i + 1) + ' is a 401')
  assert.equal((await guess()).statusCode, 429, 'the 11th guess on a new connection is still braked')
  // A genuine delivery (correct secret) is admitted and clears the shared brake.
  const genuine = mockRes()
  const genuineReq = jsonReq({ remote: null })
  genuineReq.socket = { remoteAddress: undefined }
  await m.handler(genuineReq, genuine)
  assert.equal(genuine.statusCode, 202, 'a correct secret is admitted while the shared brake is on')
  assert.equal((await guess()).statusCode, 401, 'and the brake was released, not merely bypassed once')
  m.dispose()
})

await check('rejected-traffic history rows AND log lines are capped per window (address rotation included)', async () => {
  const logs = []
  const m = mount({
    webhookTriggersPath: join(dir, 'j-rules.json'),
    webhookHistoryPath: join(dir, 'j-history.json'),
    webhookAllowRemote: true,
    webhookRateLimit: 500,
  }, logs)
  await m.service.saveRule(RULE)
  // 30 DISTINCT callers, each getting one 401: every one used to push a history
  // row AND leave a warn line — and per-bucket dedup cannot help here, because
  // address rotation makes every request a NEW bucket. Both are now bounded by
  // per-window budgets: rows rewrite the whole history sidecar each, and the
  // warn flood was the other unbounded surface of the same attack.
  for (let i = 0; i < 30; i += 1) {
    const res = mockRes()
    await m.handler(jsonReq({ remote: `198.51.100.${i + 1}`, secret: 'wrong-secret-16chars' }), res)
    assert.equal(res.statusCode, 401, 'caller ' + (i + 1) + ' still answers a plain 401 — only observability is budgeted')
  }
  const view = await m.service.list()
  const rows = view.history.filter((entry) => entry.ok === false)
  assert.ok(rows.length > 0, 'the attack is still visible in the history')
  assert.ok(rows.length <= 10, `at most 10 rejection rows per window (got ${rows.length})`)
  const warns = logs.filter((line) => line.includes('401'))
  assert.ok(warns.length > 0, 'the attack is still visible in the log')
  assert.ok(warns.length <= 10, `at most 10 auth-failure warn lines per window (got ${warns.length})`)
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

await check('the lockout does not exempt its holder from the request budget (source pin)', async () => {
  // The behavioral window here is wall-clock (60s), so pin the FIX itself.
  // The first cut's `!wasLockedOut && !rate.allow(bucket)` handed a lock's own
  // trigger state an UNLIMITED request rate — each request still paying a
  // synchronous rules read + SHA-256 on the event loop, and every failure
  // re-arming the lock that opened the hole. The budget must apply to every
  // caller; a correct secret still ends the lockout once it gets through.
  const src = readFileSync(new URL('../lib/webhook-triggers.js', import.meta.url), 'utf8')
  assert.ok(!src.includes('!wasLockedOut && !rate.allow'), 'the lockout-budget exemption is gone')
  assert.ok(src.includes('if (!rate.allow(bucket)) {'), 'the per-caller request budget is unconditional')
})

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-webhook-hardening OK: ' + results.length + ' checks (loopback, rate limit, lockout, secret compare, observability)')
// The rules fs.watch listener holds the event loop open after a green run.
process.exit(0)
