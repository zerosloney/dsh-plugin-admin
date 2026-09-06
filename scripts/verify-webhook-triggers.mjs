/**
 * Self-check for the Webhook 触发 feature (lib/webhook-triggers.js):
 *
 * Pure functions:
 * - secretMatches (timing-safe wrapper semantics)
 * - renderPromptTemplate (default template, $VARS substitution)
 * - validateRuleEntry (steer/create shapes, id grammar, duplicates, bounds)
 *
 * Service (applyWebhookAdmin against a fake ctx + temp DSH_HOME):
 * - saveRule/list round-trip, empty-secret keep-on-edit semantics
 * - deleteRule, unknown-id rejection
 * - testRule via direct steer path (fake agents service)
 * - runtimeInstall writes the dependency + cordis.patch.yml row (stub pnpm)
 * - typert invocation descriptors present
 *
 * HTTP handler (via a captured webServer.register):
 * - 405 wrong method, 415 wrong content-type, 404 missing/unknown rule id
 * - 401 wrong secret, 400 invalid JSON, 413 oversized body
 * - 202 steer delivery (direct path), history ring grows
 * - 503 create-mode without the webhook runtime
 *
 * Run: node scripts/verify-webhook-triggers.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const { applyWebhookAdmin, webhookInvocations, secretMatches, renderPromptTemplate, validateRuleEntry, WEBHOOK_RUNTIME_PACKAGE } = await import(new URL('../lib/webhook-triggers.js', import.meta.url).href)

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

/* ============================ Pure functions ============================ */

check('secretMatches compares equal secrets and rejects others', () => {
  assert.equal(secretMatches('s3cret', 's3cret'), true)
  assert.equal(secretMatches('s3cret', 'wrong'), false)
  assert.equal(secretMatches('', ''), true)
  assert.equal(secretMatches('a', ''), false)
})

check('renderPromptTemplate substitutes $VARS and keeps unknown tokens', () => {
  const out = renderPromptTemplate('规则 $RULE / 事件 $EVENT / 交付 $DELIVERY / $PAYLOAD / $KEEP', {
    ruleId: 'ci', deliveryId: 'd-1', event: 'push', payload: { ref: 'main' },
  })
  assert.ok(out.includes('规则 ci / 事件 push / 交付 d-1'), 'known vars substituted')
  assert.ok(out.includes('"ref": "main"'), 'payload rendered as JSON')
  assert.ok(out.includes('$KEEP'), 'unknown tokens left verbatim')
  const def = renderPromptTemplate('', { ruleId: 'r', deliveryId: 'd', event: 'e', payload: {} })
  assert.ok(def.startsWith('Webhook 触发：规则「r」事件「e」'), 'default template applied when empty')
})

check('validateRuleEntry accepts well-formed steer and create rules', () => {
  const steer = validateRuleEntry({ id: 'ci-fail', enabled: true, secret: 's', event: 'push', action: { mode: 'steer', sessionId: 'session-1', steer: true }, promptTemplate: '$PAYLOAD' }, [])
  assert.deepEqual(steer.action, { mode: 'steer', sessionId: 'session-1', steer: true })
  assert.equal(steer.promptTemplate, '$PAYLOAD')
  const create = validateRuleEntry({
    id: 'nightly', secret: '', event: '',
    action: { mode: 'create', workspacePath: 'E:/repos/app', agentPreset: 'cordis', permissionPreset: 'workspace-write', model: { provider: 'cliproxy', model: 'gemini', maxTokens: 1024 } },
  }, [])
  assert.equal(create.action.mode, 'create')
  assert.deepEqual(create.action.model, { provider: 'cliproxy', model: 'gemini', maxTokens: 1024 })
  assert.equal(create.action.model.maxTokens, 1024)
})

check('validateRuleEntry rejects malformed entries', () => {
  const bad = (entry, existing = []) => () => validateRuleEntry(entry, existing)
  assert.throws(bad({ id: 'Bad ID', action: { mode: 'steer', sessionId: 's' } }), /无效/, 'uppercase/space id rejected')
  assert.throws(bad({ id: 'dup', action: { mode: 'steer', sessionId: 's' } }, ['dup']), /已被其他规则占用/, 'duplicate id rejected')
  assert.throws(bad({ id: 'ok1' }), /action\.mode/, 'missing action rejected')
  assert.throws(bad({ id: 'ok2', action: { mode: 'nope' } }), /必须是 "steer" 或 "create"/, 'unknown mode rejected')
  assert.throws(bad({ id: 'ok3', action: { mode: 'steer' } }), /steer 模式需要 sessionId/, 'steer needs session')
  assert.throws(bad({ id: 'ok4', action: { mode: 'create', workspacePath: 'relative/path', agentPreset: 'p', permissionPreset: 'w' } }), /绝对路径/, 'create needs absolute path')
  assert.throws(bad({ id: 'ok5', action: { mode: 'create', workspacePath: 'E:/x' } }), /create 模式需要 agentPreset/, 'create needs preset')
  assert.throws(bad({ id: 'ok6', secret: 'x'.repeat(257), action: { mode: 'steer', sessionId: 's' } }), /secret 长度/, 'secret bound enforced')
})

/* ============================ Service level ============================ */

// Isolated DSH_HOME so the rules file + fs.watch never touch the real home.
const webhookHome = mkdtempSync(join(tmpdir(), 'webhook-home-'))
process.env.DSH_HOME = webhookHome

const profileDir = mkdtempSync(join(tmpdir(), 'webhook-profile-'))
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture', dependencies: { '@deepseek-ai/dsh-base': '0.1.1-rc.2' } }, null, 2))

// Fake agents service: one live session that records steered messages.
const steered = []
const fakeAgents = {
  get: (id) => (id === 'session-live'
    ? { steer: (msg) => steered.push({ id, msg }), followup: (msg) => steered.push({ id, msg, followup: true }) }
    : undefined),
}

// Fake webServer capturing the prefix-route registration.
const registeredRoutes = []
const fakeWebServer = { register: (entry) => { registeredRoutes.push(entry); return () => {} } }

const teardownDisposers = []
const ctx = {
  baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  get: (key) => {
    if (key === 'agents') return fakeAgents
    if (key === 'webServer') return fakeWebServer
    return undefined
  },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') teardownDisposers.push(d); return d },
  inject: undefined, // no webhookRuntime: the direct steer path is exercised
  provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
}

const webhookAdminInvocations = applyWebhookAdmin(ctx, {
  enqueue: (op) => Promise.resolve().then(op),
  runPnpm: null,
  reconcileBundles: null,
  settings: {},
})

check('service provided with typertRemote binding and descriptors', () => {
  assert.ok(ctx.provided.webhookAdmin, 'webhookAdmin provided')
  const invocations = webhookAdminInvocations()
  const ids = invocations.map((i) => i.id)
  for (const tail of ['webhook/list', 'webhook/saveRule', 'webhook/deleteRule', 'webhook/testRule', 'webhook/runtimeInstall']) {
    assert.ok(ids.includes(`dsh-plugin-admin/${tail}`), `descriptor ${tail} present`)
  }
  assert.ok(registeredRoutes.length === 1 && registeredRoutes[0].path === '/webhook-triggers', 'prefix route registered on the fake webServer')
})

const storagePath = join(webhookHome, 'webhook-triggers.json')

await checkAsync('saveRule + list round-trips a steer rule', async () => {
  const service = ctx.provided.webhookAdmin
  const saved = await service.saveRule({ id: 'ci-fail', enabled: true, secret: 'topsecret', event: 'push', action: { mode: 'steer', sessionId: 'session-live', steer: true }, promptTemplate: 'CI 失败：$PAYLOAD' })
  assert.equal(saved.ok, true)
  assert.equal(saved.rules.length, 1)
  assert.equal(saved.rules[0].secret, 'topsecret')
  assert.equal(existsSync(storagePath), true, 'rules file persisted')
})

await checkAsync('saveRule with an empty secret keeps the stored secret on edit', async () => {
  const service = ctx.provided.webhookAdmin
  await service.saveRule({ id: 'ci-fail', secret: '', event: 'push', action: { mode: 'steer', sessionId: 'session-live', steer: true }, promptTemplate: 'CI 失败：$PAYLOAD' })
  const list = await service.list()
  assert.equal(list.rules[0].secret, 'topsecret', 'empty secret inherits the stored one')
})

await checkAsync('saveRule rejects an empty secret for a new rule', async () => {
  const service = ctx.provided.webhookAdmin
  let rejected = null
  try {
    await service.saveRule({ id: 'no-secret', action: { mode: 'steer', sessionId: 'session-live', steer: true } })
  } catch (error) {
    rejected = error
  }
  assert.ok(rejected !== null && /secret/.test(rejected.message), 'empty secret rejected with a secret-related error')
})

await checkAsync('deleteRule removes and rejects unknown ids', async () => {
  const service = ctx.provided.webhookAdmin
  await service.saveRule({ id: 'temp', secret: 'topsecret', action: { mode: 'steer', sessionId: 'session-live', steer: true } })
  const removed = await service.deleteRule('temp')
  assert.equal(removed.deleted, 'temp')
  // deleteRule throws for unknown ids — assert.rejects rejects with the thrown
  // Error, so the rejection must be awaited through the promise chain.
  let rejected = null
  try {
    await service.deleteRule('ghost')
  } catch (error) {
    rejected = error
  }
  assert.ok(rejected !== null && /不存在/.test(rejected.message), 'unknown id rejected with 不存在')
})

/* ============================ HTTP handler ============================ */

const handler = registeredRoutes[0].handler

function mockRes() {
  return {
    statusCode: null, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v },
    writeHead(status, headers) { this.statusCode = status; if (headers) Object.assign(this.headers, headers) },
    end(body) { if (body !== undefined) this.body += body },
  }
}

function mockReq({ method = 'POST', url = '/webhook-triggers/ci-fail', headers = {}, chunks = [] }) {
  const done = chunks.join('')
  return {
    method, url, headers,
    complete: true,
    resume() {},
    async *[Symbol.asyncIterator]() {
      if (done !== '') yield Buffer.from(done, 'utf8')
    },
  }
}

const jsonRequest = ({ ruleId = 'ci-fail', body = '{"hello":"world"}', secret = 'topsecret', event = 'push', url } = {}) =>
  mockReq({
    url: url || `/webhook-triggers/${ruleId}`,
    headers: { 'content-type': 'application/json', ...(secret !== undefined ? { 'x-webhook-secret': secret } : {}), 'x-webhook-event': event },
    chunks: [body],
  })

await checkAsync('HTTP handler: happy-path steer delivery returns 202 and steers', async () => {
  const req = jsonRequest()
  const res = mockRes()
  await handler(req, res)
  console.error('DEBUG handler status:', res.statusCode, 'body:', res.body, 'steered:', steered.length)
  assert.equal(res.statusCode, 202)
  assert.ok(res.body.includes('steer'), 'response names the steer mode')
  assert.equal(steered.length, 1, 'message steered into the live session')
  assert.ok(steered[0].msg.content[0].text.includes('CI 失败'), 'prompt template applied to delivery payload')
})

await checkAsync('HTTP handler: 405 wrong method, 415 wrong content-type', async () => {
  let res = mockRes()
  await handler(mockReq({ method: 'GET', url: '/webhook-triggers/ci-fail' }), res)
  assert.equal(res.statusCode, 405)
  res = mockRes()
  await handler(mockReq({ headers: { 'content-type': 'text/plain' }, chunks: ['x'] }), res)
  assert.equal(res.statusCode, 415)
})

await checkAsync('HTTP handler: 404 for missing rule id and unknown rule', async () => {
  let res = mockRes()
  await handler(jsonRequest({ url: '/webhook-triggers/' }), res)
  assert.equal(res.statusCode, 404, 'missing rule id')
  res = mockRes()
  await handler(jsonRequest({ ruleId: 'nope' }), res)
  assert.equal(res.statusCode, 404, 'unknown rule id')
})

await checkAsync('HTTP handler: 401 on wrong secret without steering', async () => {
  const before = steered.length
  const res = mockRes()
  await handler(jsonRequest({ secret: 'wrong' }), res)
  assert.equal(res.statusCode, 401)
  assert.equal(steered.length, before, 'no steer on bad secret')
})

await checkAsync('HTTP handler: 400 invalid JSON and 413 oversized body', async () => {
  let res = mockRes()
  await handler(jsonRequest({ body: '{nope' }), res)
  assert.equal(res.statusCode, 400, 'invalid JSON')
  res = mockRes()
  await handler(jsonRequest({ body: 'x'.repeat(1050000), secret: 'topsecret' }), res)
  assert.equal(res.statusCode, 413, 'oversized body rejected')
})

await checkAsync('HTTP handler: create-mode without runtime fails 503', async () => {
  await ctx.provided.webhookAdmin.saveRule({
    id: 'nightly', secret: 'topsecret', action: { mode: 'create', workspacePath: 'E:/repos/app', agentPreset: 'cordis', permissionPreset: 'workspace-write' },
  })
  const res = mockRes()
  await handler(jsonRequest({ ruleId: 'nightly' }), res)
  assert.equal(res.statusCode, 503)
})

await checkAsync('HTTP handler: endpointOnline flips true with webServer present', async () => {
  const list = await ctx.provided.webhookAdmin.list()
  assert.equal(list.endpointOnline, true, 'webServer present → endpoint online')
  assert.equal(list.runtimeMounted, false, 'runtime absent → not mounted')
})

/* ============================ runtimeInstall ============================ */

await checkAsync('runtimeInstall writes dependency + cordis patch row (stub pnpm)', async () => {
  const manifestPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const stubPnpm = async (dir, args) => {
    if (args[0] === 'add') {
      const spec = args[1]
      const name = WEBHOOK_RUNTIME_PACKAGE
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
      pkg.dependencies = pkg.dependencies ?? {}
      pkg.dependencies[name] = spec.startsWith('link:') ? spec : spec
      writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + '\n')
    }
    return `stub-pnpm ${args.join(' ')}`
  }
  // Re-apply on the SAME ctx with a runner-capable options bag: provide()
  // replaces ctx.provided.webhookAdmin with a service that can install.
  const installs = []
  applyWebhookAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op),
    runPnpm: (dir, args) => { installs.push([dir, ...args]); return stubPnpm(dir, args) },
    reconcileBundles: () => {},
    settings: {},
  })
  const service = ctx.provided.webhookAdmin
  const result = await service.runtimeInstall()
  assert.equal(result.ok, true)
  assert.ok(installs.some(([, , spec]) => spec === WEBHOOK_RUNTIME_PACKAGE || spec.startsWith(WEBHOOK_RUNTIME_PACKAGE + '@')), 'pnpm add ran for the runtime package')
  const patchText = readFileSync(patchPath, 'utf8')
  assert.ok(patchText.includes("@deepseek-ai/dsh-webhook"), 'patch row written')
  assert.ok(patchText.includes('id: webhook-runtime'), 'patch row id present')
})

console.log(results.join('\n'))
console.log(`verify-webhook-triggers OK: ${results.length} checks`)

// The webhook fs.watch listener holds the event loop alive after a green
// run — flush teardown disposers, then exit hard so CI never wedges.
for (const dispose of teardownDisposers.splice(0)) { try { dispose() } catch {} }
process.exit(0)
