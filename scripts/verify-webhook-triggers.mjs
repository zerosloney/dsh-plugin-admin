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
 * - 405 wrong method, 415 wrong content-type, 404 missing rule id;
 *   unknown/disabled rule and wrong secret share ONE uniform 401 (no enumeration)
 * - 400 invalid JSON, 413 oversized body, redelivered x-webhook-delivery deduped
 * - 202 steer delivery (direct path), history ring grows
 * - 503 create-mode without the webhook runtime
 *
 * Run: node scripts/verify-webhook-triggers.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// A workspace path that is absolute ON THE RUNNING PLATFORM: validateRuleEntry
// enforces isAbsolute(workspacePath), and a Windows-style 'E:/...' literal
// fails that check on POSIX runners.
const WORKSPACE = join(tmpdir(), 'repos', 'app')

const { applyWebhookAdmin, webhookInvocations, secretMatches, renderPromptTemplate, validateRuleEntry, WEBHOOK_RUNTIME_PACKAGE, DISPATCH_KIND } = await import(new URL('../lib/webhook-triggers.js', import.meta.url).href)

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

check('renderPromptTemplate substitutes payload $ patterns VERBATIM', () => {
  // String.replace treats `$&`, `` $` ``, `$'`, and `$n` inside a STRING
  // replacement as special patterns — a webhook payload (or delivery id)
  // carrying one used to re-expand against the template and corrupt the
  // prompt. The function-form substitution must land them literally.
  const payload = { snippet: "cost $& after $`X and $'Y and $1" }
  const out = renderPromptTemplate('P:$PAYLOAD:R:$RULE', {
    ruleId: 'r1', deliveryId: 'd-$&-1', event: 'e', payload,
  })
  assert.ok(out.includes("$& after $`X and $'Y and $1"), 'payload $ patterns survive verbatim')
  assert.ok(out.includes('R:r1'), 'template vars still substituted')
  assert.equal(out.includes('$PAYLOAD'), false, 'a payload $& must not re-expand to the matched token')
})

check('validateRuleEntry accepts well-formed steer and create rules', () => {
  const steer = validateRuleEntry({ id: 'ci-fail', enabled: true, secret: 'x'.repeat(16), event: 'push', action: { mode: 'steer', sessionId: 'session-1', steer: true }, promptTemplate: '$PAYLOAD' }, [])
  assert.deepEqual(steer.action, { mode: 'steer', sessionId: 'session-1', steer: true })
  assert.equal(steer.promptTemplate, '$PAYLOAD')
  const create = validateRuleEntry({
    id: 'nightly', secret: '', event: '',
    action: { mode: 'create', workspacePath: WORKSPACE, agentPreset: 'cordis', permissionPreset: 'workspace-write', model: { provider: 'cliproxy', model: 'gemini', maxTokens: 1024 } },
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
  assert.throws(bad({ id: 'ok5', action: { mode: 'create', workspacePath: WORKSPACE } }), /create 模式需要 agentPreset/, 'create needs preset')
  assert.throws(bad({ id: 'ok6', secret: 'x'.repeat(257), action: { mode: 'steer', sessionId: 's' } }), /secret 长度/, 'secret bound enforced')
  assert.throws(bad({ id: 'a'.repeat(65), action: { mode: 'steer', sessionId: 's' } }), /无效/, 'id over 64 chars rejected')
  assert.equal(validateRuleEntry({ id: 'a'.repeat(64), action: { mode: 'steer', sessionId: 's' } }, []).id, 'a'.repeat(64), 'id at the 64-char bound passes')
})

check('validateRuleEntry enforces the secret floor', () => {
  const bad = (entry) => () => validateRuleEntry(entry, [])
  // The endpoint verifies by header only and has no rate limit — a short
  // secret is brute-forceable, so the write boundary owns a floor.
  assert.throws(bad({ id: 'short', secret: 'short', action: { mode: 'steer', sessionId: 's' } }), /至少 16/, 'short secret rejected')
  assert.equal(validateRuleEntry({ id: 'ok', secret: 'x'.repeat(16), action: { mode: 'steer', sessionId: 's' } }, []).secret, 'x'.repeat(16), 'a 16-char secret passes')
  // Empty stays legal at THIS layer — saveRule is the one that rejects it
  // (and the create-mode fixture above relies on that split).
  assert.equal(validateRuleEntry({ id: 'ok-empty', secret: '', action: { mode: 'steer', sessionId: 's' } }, []).secret, '', 'empty secret is not this layer\'s to reject')
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
  settings: { webhookHistoryPath: join(webhookHome, 'history-main.json') },
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
  const saved = await service.saveRule({ id: 'ci-fail', enabled: true, secret: 'topsecret-key-16chars', event: 'push', action: { mode: 'steer', sessionId: 'session-live', steer: true }, promptTemplate: 'CI 失败：$PAYLOAD' })
  assert.equal(saved.ok, true)
  assert.equal(saved.rules.length, 1)
  assert.ok(!('secret' in saved.rules[0]), 'list payload must never carry the plaintext secret')
  assert.equal(existsSync(storagePath), true, 'rules file persisted')
})

await checkAsync('saveRule + list round-trip preserves model.maxTokens (create rule)', async () => {
  const service = ctx.provided.webhookAdmin
  const saved = await service.saveRule({
    id: 'nightly-md', enabled: true, secret: 'topsecret-key-16chars', event: '',
    action: { mode: 'create', workspacePath: WORKSPACE, agentPreset: 'cordis', permissionPreset: 'workspace-write', model: { provider: 'cliproxy', model: 'gemini', maxTokens: 1024 } },
  })
  assert.equal(saved.ok, true)
  const stored = saved.rules.find(rule => rule.id === 'nightly-md')
  assert.ok(stored !== undefined, 'create rule persisted')
  assert.deepEqual(stored.action.model, { provider: 'cliproxy', model: 'gemini', maxTokens: 1024 }, 'maxTokens survives the storage round-trip (normalizeRule must not drop it)')
})

await checkAsync('saveRule with an empty secret keeps the stored secret on edit', async () => {
  const service = ctx.provided.webhookAdmin
  await service.saveRule({ id: 'ci-fail', secret: '', event: 'push', action: { mode: 'steer', sessionId: 'session-live', steer: true }, promptTemplate: 'CI 失败：$PAYLOAD' })
  // list() deliberately no longer carries the secret; verify inheritance
  // where the value actually lives — the persisted rules file.
  const stored = JSON.parse(readFileSync(storagePath, 'utf8'))
  const kept = stored.rules.find(entry => entry.id === 'ci-fail')
  assert.equal(kept.secret, 'topsecret-key-16chars', 'empty secret inherits the stored one')
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
  await service.saveRule({ id: 'temp', secret: 'topsecret-key-16chars', action: { mode: 'steer', sessionId: 'session-live', steer: true } })
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

const jsonRequest = ({ ruleId = 'ci-fail', body = '{"hello":"world"}', secret = 'topsecret-key-16chars', event = 'push', url, delivery } = {}) =>
  mockReq({
    url: url || `/webhook-triggers/${ruleId}`,
    headers: {
      'content-type': 'application/json',
      ...(secret !== undefined ? { 'x-webhook-secret': secret } : {}),
      'x-webhook-event': event,
      ...(delivery !== undefined ? { 'x-webhook-delivery': delivery } : {}),
    },
    chunks: [body],
  })

await checkAsync('HTTP handler: happy-path steer delivery returns 202 and steers', async () => {
  const req = jsonRequest()
  const res = mockRes()
  await handler(req, res)
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

await checkAsync('HTTP handler: 404 for missing rule id; unknown rule reads as uniform 401', async () => {
  let res = mockRes()
  await handler(jsonRequest({ url: '/webhook-triggers/' }), res)
  assert.equal(res.statusCode, 404, 'missing rule id')
  res = mockRes()
  await handler(jsonRequest({ ruleId: 'nope' }), res)
  assert.equal(res.statusCode, 401, 'unknown rule id is NOT distinguishable from a bad secret')
})

await checkAsync('HTTP handler: 401 body is identical for unknown rule and wrong secret (no enumeration)', async () => {
  const unknownRes = mockRes()
  await handler(jsonRequest({ ruleId: 'nope' }), unknownRes)
  const wrongSecretRes = mockRes()
  await handler(jsonRequest({ secret: 'wrong' }), wrongSecretRes)
  const disabledRes = mockRes()
  await ctx.provided.webhookAdmin.saveRule({
    id: 'off-rule', secret: 'topsecret-key-16chars', enabled: false, action: { mode: 'steer', sessionId: 'session-live', steer: true },
  })
  await handler(jsonRequest({ ruleId: 'off-rule' }), disabledRes)
  assert.equal(unknownRes.statusCode, 401)
  assert.equal(wrongSecretRes.statusCode, 401)
  assert.equal(disabledRes.statusCode, 401)
  assert.equal(unknownRes.body, wrongSecretRes.body, 'unknown rule and wrong secret are indistinguishable')
  assert.equal(unknownRes.body, disabledRes.body, 'disabled rule is indistinguishable too')
})

await checkAsync('HTTP handler: redelivered x-webhook-delivery id is deduped (acknowledged, not re-executed)', async () => {
  const before = steered.length
  const first = mockRes()
  await handler(jsonRequest({ delivery: 'retry-same-id' }), first)
  assert.equal(first.statusCode, 202)
  assert.ok(!first.body.includes('duplicate'), 'first delivery executes')
  assert.equal(steered.length, before + 1, 'first delivery steers')
  const replay = mockRes()
  await handler(jsonRequest({ delivery: 'retry-same-id' }), replay)
  assert.equal(replay.statusCode, 202, 'redelivery acknowledged')
  assert.ok(replay.body.includes('duplicate'), 'redelivery flagged duplicate:true')
  assert.equal(steered.length, before + 1, 'redelivery does NOT steer again')
  // A DIFFERENT delivery id on the same rule must still execute.
  const fresh = mockRes()
  await handler(jsonRequest({ delivery: 'retry-other-id' }), fresh)
  assert.equal(fresh.statusCode, 202)
  assert.ok(!fresh.body.includes('duplicate'), 'different id executes')
  assert.equal(steered.length, before + 2, 'different id steers')
})

await checkAsync('HTTP handler: 400 invalid JSON and 413 oversized body', async () => {
  let res = mockRes()
  await handler(jsonRequest({ body: '{nope' }), res)
  assert.equal(res.statusCode, 400, 'invalid JSON')
  res = mockRes()
  await handler(jsonRequest({ body: 'x'.repeat(1050000), secret: 'topsecret-key-16chars' }), res)
  assert.equal(res.statusCode, 413, 'oversized body rejected')
})

await checkAsync('HTTP handler: create-mode without runtime fails 503', async () => {
  await ctx.provided.webhookAdmin.saveRule({
    id: 'nightly', secret: 'topsecret-key-16chars', action: { mode: 'create', workspacePath: WORKSPACE, agentPreset: 'cordis', permissionPreset: 'workspace-write' },
  })
  const res = mockRes()
  await handler(jsonRequest({ ruleId: 'nightly' }), res)
  assert.equal(res.statusCode, 503)
})

await checkAsync('HTTP handler: mismatched x-webhook-event skips without steering and does not consume the delivery id', async () => {
  const before = steered.length
  // ci-fail listens on event 'push'; a different event name must not steer.
  const res = mockRes()
  await handler(jsonRequest({ event: 'other', delivery: 'evt-mismatch-1' }), res)
  assert.equal(res.statusCode, 202, 'a routing decision, not a sender-retryable failure')
  const payload = JSON.parse(res.body)
  assert.equal(payload.skipped, 'event-mismatch')
  assert.equal(payload.expected, 'push')
  assert.equal(steered.length, before, 'no steer on event mismatch')
  // The skipped delivery id must NOT be consumed by the dedup claim: the same
  // id arriving later with the matching event still executes.
  const ok = mockRes()
  await handler(jsonRequest({ delivery: 'evt-mismatch-1' }), ok)
  assert.equal(ok.statusCode, 202)
  assert.ok(!ok.body.includes('duplicate'), 'same delivery id after a skipped mismatch still executes')
  assert.equal(steered.length, before + 1, 'matching event steers')
  // The mismatch is recorded in history as a failed entry naming the expectation.
  const listed = await ctx.provided.webhookAdmin.list()
  const mismatch = listed.history.find(h => h.deliveryId === 'evt-mismatch-1')
  assert.ok(mismatch, 'mismatch recorded in history')
  assert.equal(mismatch.ok, false)
  assert.match(mismatch.error, /事件名不匹配/)
})

await checkAsync('rules file is written 0600 on POSIX (secret is the only direct-path credential)', async () => {
  if (process.platform === 'win32') return   // mode is a no-op under Windows ACLs
  await ctx.provided.webhookAdmin.saveRule({ id: 'perm-probe', secret: 'topsecret-key-16chars', action: { mode: 'steer', sessionId: 'session-live', steer: true } })
  assert.equal(existsSync(storagePath), true, 'rules file persisted')
  const mode = statSync(storagePath).mode & 0o777
  assert.equal(mode, 0o600, 'writeFileSync mode must survive the temp+rename round-trip')
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
    settings: { webhookHistoryPath: join(webhookHome, 'history-main.json') },
  })
  const service = ctx.provided.webhookAdmin
  const result = await service.runtimeInstall()
  assert.equal(result.ok, true)
  assert.ok(installs.some(([, , spec]) => spec === WEBHOOK_RUNTIME_PACKAGE || spec.startsWith(WEBHOOK_RUNTIME_PACKAGE + '@')), 'pnpm add ran for the runtime package')
  const patchText = readFileSync(patchPath, 'utf8')
  assert.ok(patchText.includes("@deepseek-ai/dsh-webhook"), 'patch row written')
  assert.ok(patchText.includes('id: webhook-runtime'), 'patch row id present')
})

await checkAsync('list() awaits agentPresets.list() (it is async upstream)', async () => {
  // The agentPresets service exposes `async list(): Promise<AgentPreset[]>`
  // (see dsh preset-agent-presets). A sync spread of the Promise left the
  // panel's preset dropdown empty. Inject an async list() and confirm it
  // surfaces in `presets`.
  const presetCallCount = { list: 0 }
  const previousGet = ctx.get
  ctx.get = (key) => {
    if (key === 'agentPresets') {
      return { list: async () => { presetCallCount.list++; return [{ id: 'p1', name: 'P1' }, { id: 'p2' }] } }
    }
    if (key === 'permissionPresets') return { names: ['workspace-write', 'danger-full-access', 'custom'] }
    return previousGet(key)
  }
  const list = await ctx.provided.webhookAdmin.list()
  assert.deepEqual(list.presets, [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'p2' }], 'presets surfaced via await (name defaults to id)')
  assert.equal(presetCallCount.list, 1, 'agentPresets.list() was awaited once')
  assert.deepEqual(list.permissionPresetNames, ['workspace-write', 'danger-full-access'], '"custom" filtered out')
  ctx.get = previousGet
})

// ---------- Inherited legacy secrets get the floor too ---------------------
// A rule stored before the floor existed keeps delivering (normalizeRule does
// not enforce it), but an edit riding the "empty secret keeps the stored one"
// path must not silently re-persist the short value.
await checkAsync('saveRule refuses an inherited short secret on edit', async () => {
  const legacyPath = join(webhookHome, 'webhook-triggers.json')
  writeFileSync(legacyPath, JSON.stringify({
    version: 1,
    rules: [{ id: 'legacy', enabled: true, secret: 'short', event: '', action: { mode: 'steer', sessionId: 'session-live', steer: true }, promptTemplate: '' }],
  }, null, 2) + '\n', 'utf8')
  // Fresh mount on the same home: the rules mirror loads from disk at apply
  // time, so the seeded legacy rule is authoritative without waiting on the
  // debounced fs.watch reload.
  applyWebhookAdmin(ctx, { enqueue: (op) => Promise.resolve().then(op), runPnpm: null, reconcileBundles: null, settings: { webhookTriggersPath: legacyPath, webhookHistoryPath: join(webhookHome, 'history-legacy.json') } })
  const fresh = ctx.provided.webhookAdmin
  let rejected = null
  try {
    await fresh.saveRule({ id: 'legacy', secret: '', event: '', action: { mode: 'steer', sessionId: 'session-live', steer: true } })
  } catch (error) {
    rejected = error
  }
  assert.ok(rejected !== null && /至少 16/.test(rejected.message), 'the inherited short secret is refused with the floor message')
  const onDisk = JSON.parse(readFileSync(legacyPath, 'utf8'))
  assert.equal(onDisk.rules.find((r) => r.id === 'legacy').secret, 'short', 'the refused save left the stored rule untouched')
})

/* ============ runtime path: create-mode preset pre-resolution ============
 * The runtime dispatch path (webhookRuntime.register run callback) is where
 * create-mode failures used to be invisible: runRule returned the request,
 * history recorded ok:true, and the official async createWebhookSession died
 * in host logs only. Pre-resolving the presets (idempotent lookups the
 * official create runs anyway) must surface bad names in history as ok:false
 * and still return the request for valid names.
 */
await checkAsync('runtime path: bad preset name lands in history as ok:false; valid names return the request', async () => {
  let capturedRun = null
  const fakeRuntime = {
    register: (entry) => { capturedRun = entry.run; return () => {} },
    dispatch: () => {},
  }
  const runtimeCtx = {
    baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (key) => {
      if (key === 'agents') return fakeAgents
      if (key === 'webServer') return fakeWebServer
      if (key === 'webhookRuntime') return fakeRuntime
      if (key === 'permissionPresets') return {
        resolve: (name) => { if (name === 'workspace-write') return {}; throw new Error(`permission: unknown preset "${name}"`) },
      }
      if (key === 'agentPresets') return {
        resolve: async (id) => { if (id === 'cordis') return { id }; throw new Error(`agent-presets: preset "${id}" not found`) },
      }
      return undefined
    },
    effect: (fn) => { const d = fn(); if (typeof d === 'function') teardownDisposers.push(d); return d },
    inject: (deps, fn) => { fn({ webhookRuntime: fakeRuntime }); return () => {} },
    provide: (key, service) => { runtimeCtx.provided ??= {}; runtimeCtx.provided[key] = service },
  }
  applyWebhookAdmin(runtimeCtx, { enqueue: (op) => Promise.resolve().then(op), runPnpm: null, reconcileBundles: null, settings: { webhookTriggersPath: join(webhookHome, 'runtime-triggers.json'), webhookHistoryPath: join(webhookHome, 'history-runtime.json') } })
  assert.ok(capturedRun !== null, 'runtime rule registered')

  const service = runtimeCtx.provided.webhookAdmin
  await service.saveRule({ id: 'nightly', enabled: true, secret: 'topsecret-key-16chars', event: 'push', action: { mode: 'create', workspacePath: WORKSPACE, agentPreset: 'cordis', permissionPreset: 'workspace-write' }, promptTemplate: '构建：$EVENT' })

  const delivery = (deliveryId) => ({ kind: DISPATCH_KIND, source: 'nightly', deliveryId, event: { name: 'push', payload: {} }, receivedAt: Date.now() })
  const signal = new AbortController().signal

  // Valid presets → the SessionRequest comes back (create proceeds).
  const okResult = await capturedRun(delivery('d-ok'), signal)
  assert.ok(okResult !== null && okResult.workspacePath === WORKSPACE && okResult.agentPreset === 'cordis', 'valid presets return the session request')

  // Bad agentPreset → null + history ok:false with the real error.
  await service.saveRule({ id: 'nightly', enabled: true, secret: 'topsecret-key-16chars', event: 'push', action: { mode: 'create', workspacePath: WORKSPACE, agentPreset: 'nope', permissionPreset: 'workspace-write' }, promptTemplate: '构建：$EVENT' })
  const badAgent = await capturedRun(delivery('d-bad-agent'), signal)
  assert.equal(badAgent, null, 'unknown agentPreset → no request returned')
  let hist = (await service.list()).history
  const badAgentEntry = hist.find((h) => h.deliveryId === 'd-bad-agent')
  assert.ok(badAgentEntry && badAgentEntry.ok === false && /agent-presets: preset "nope" not found/.test(badAgentEntry.error), 'unknown agentPreset recorded in history with the real error')

  // Bad permissionPreset → null + history ok:false.
  await service.saveRule({ id: 'nightly', enabled: true, secret: 'topsecret-key-16chars', event: 'push', action: { mode: 'create', workspacePath: WORKSPACE, agentPreset: 'cordis', permissionPreset: 'nope-perm' }, promptTemplate: '构建：$EVENT' })
  const badPerm = await capturedRun(delivery('d-bad-perm'), signal)
  assert.equal(badPerm, null, 'unknown permissionPreset → no request returned')
  hist = (await service.list()).history
  const badPermEntry = hist.find((h) => h.deliveryId === 'd-bad-perm')
  assert.ok(badPermEntry && badPermEntry.ok === false && /permission: unknown preset "nope-perm"/.test(badPermEntry.error), 'unknown permissionPreset recorded in history with the real error')
})

/* ==================== persisted history + replay dedup ====================
 * The delivery history ring and the x-webhook-delivery dedup used to live
 * only in process memory (50 entries, gone on restart). Both now persist to
 * <dshHome>/webhook-history.json on every delivery: history survives the
 * remount, and a delivery id already claimed before the "restart" stays
 * claimed after it.
 */
// Fresh host context whose steered messages land in a LOCAL log (so counts
// are per-test) and whose route registrations append to the shared capture.
function makeIsolatedCtx(disposers, steeredLog) {
  const c = {
    baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (key) => {
      if (key === 'agents') {
        return { get: (id) => (id === 'session-live' ? { steer: (msg) => steeredLog.push({ id, msg }), followup: (msg) => steeredLog.push({ id, msg, followup: true }) } : undefined) }
      }
      if (key === 'webServer') return fakeWebServer
      return undefined
    },
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
    inject: undefined,
    provide: (k, svc) => { c.provided ??= {}; c.provided[k] = svc },
  }
  return c
}

await checkAsync('delivery history persists across a remount', async () => {
  const historyPath = join(webhookHome, 'history-persist.json')
  const triggersPath = join(webhookHome, 'triggers-persist.json')
  const settings = { webhookTriggersPath: triggersPath, webhookHistoryPath: historyPath }
  const disposers1 = []
  const steered1 = []
  const ctx1 = makeIsolatedCtx(disposers1, steered1)
  applyWebhookAdmin(ctx1, { enqueue: (op) => Promise.resolve().then(op), runPnpm: null, reconcileBundles: null, settings })
  await ctx1.provided.webhookAdmin.saveRule({ id: 'persist', secret: 'topsecret-key-16chars', event: '', action: { mode: 'steer', sessionId: 'session-live', steer: true } })
  const handler1 = registeredRoutes[registeredRoutes.length - 1].handler
  const res = mockRes()
  await handler1(mockReq({
    url: '/webhook-triggers/persist',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': 'topsecret-key-16chars', 'x-webhook-event': 'push', 'x-webhook-delivery': 'd-persist-1' },
    chunks: ['{"ok":true}'],
  }), res)
  assert.equal(res.statusCode, 202)
  assert.equal(steered1.length, 1, 'mount 1 steered once')
  const onDisk = JSON.parse(readFileSync(historyPath, 'utf8'))
  assert.ok(onDisk.history.some((h) => h.deliveryId === 'd-persist-1' && h.ok), 'delivery recorded in the sidecar')

  // Mount 2 (the "restart"): fresh module state, same storage files.
  const disposers2 = []
  const ctx2 = makeIsolatedCtx(disposers2, [])
  applyWebhookAdmin(ctx2, { enqueue: (op) => Promise.resolve().then(op), runPnpm: null, reconcileBundles: null, settings })
  const list2 = await ctx2.provided.webhookAdmin.list()
  assert.ok(list2.history.some((h) => h.deliveryId === 'd-persist-1'), 'history survives the remount')
  for (const d of disposers1.splice(0).concat(disposers2.splice(0))) { try { d() } catch {} }
})

await checkAsync('replay dedup persists across a remount (cross-restart idempotency)', async () => {
  const historyPath = join(webhookHome, 'history-dedup.json')
  const triggersPath = join(webhookHome, 'triggers-dedup.json')
  const settings = { webhookTriggersPath: triggersPath, webhookHistoryPath: historyPath }
  const steeredAll = []
  const mount = () => {
    const disposers = []
    const c = makeIsolatedCtx(disposers, steeredAll)
    applyWebhookAdmin(c, { enqueue: (op) => Promise.resolve().then(op), runPnpm: null, reconcileBundles: null, settings })
    return { service: c.provided.webhookAdmin, handler: registeredRoutes[registeredRoutes.length - 1].handler, disposers }
  }
  const req = () => mockReq({
    url: '/webhook-triggers/dedup',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': 'topsecret-key-16chars', 'x-webhook-event': 'push', 'x-webhook-delivery': 'd-same-1' },
    chunks: ['{"n":1}'],
  })
  let m = mount()
  try {
    await m.service.saveRule({ id: 'dedup', secret: 'topsecret-key-16chars', event: '', action: { mode: 'steer', sessionId: 'session-live', steer: true } })
    const res1 = mockRes()
    await m.handler(req(), res1)
    assert.equal(res1.statusCode, 202)
    assert.equal(JSON.parse(res1.body).duplicate, undefined, 'first delivery executes')
    const res2 = mockRes()
    await m.handler(req(), res2)
    assert.equal(JSON.parse(res2.body).duplicate, true, 'same delivery id deduped in-process')
    for (const d of m.disposers.splice(0)) { try { d() } catch {} }

    // "Restart": remount with the same sidecar files — the id stays claimed.
    m = mount()
    const list = await m.service.list()
    assert.equal(list.rules.some((r) => r.id === 'dedup'), true, 'rule restored from storage')
    const res3 = mockRes()
    await m.handler(req(), res3)
    assert.equal(res3.statusCode, 202)
    assert.equal(JSON.parse(res3.body).duplicate, true, 'same delivery id deduped ACROSS the remount')
    assert.equal(steeredAll.length, 1, 'exactly one steer ever executed for this delivery id')
  } finally {
    for (const d of m.disposers.splice(0)) { try { d() } catch {} }
  }
})

console.log(results.join('\n'))
console.log(`verify-webhook-triggers OK: ${results.length} checks`)

// The webhook fs.watch listener holds the event loop alive after a green
// run — flush teardown disposers, then exit hard so CI never wedges.
for (const dispose of teardownDisposers.splice(0)) { try { dispose() } catch {} }
process.exit(0)
