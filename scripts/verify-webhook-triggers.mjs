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
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// A workspace path that is absolute ON THE RUNNING PLATFORM: validateRuleEntry
// enforces isAbsolute(workspacePath), and a Windows-style 'E:/...' literal
// fails that check on POSIX runners.
//
// It must also EXIST and be a directory: a create rule's workspacePath goes
// through the shared trust gate (lib/workspace-path.js), which refuses a path
// it cannot realpath and one outside every known workspace. Created here so
// both the pure-validator checks and the mounted service can use it; the fake
// registry below is what makes it TRUSTED.
const WORKSPACE = join(tmpdir(), 'repos', 'app')
mkdirSync(WORKSPACE, { recursive: true })

// The create-rule workspace gate validates `workspacePath` against the
// deployment's workspace registry. This fake is what makes WORKSPACE trusted:
// an existing directory outside every known workspace is refused on purpose.
const fakeWorkspaceRegistry = {
  list: () => [{ path: WORKSPACE, sessionIds: [], archivedSessionIds: [] }],
  archivedSessionIds: [],
}

const { applyWebhookAdmin, webhookInvocations, secretMatches, renderPromptTemplate, validateRuleEntry, seenPathFor, unionSeenKeys, mergeHistoryRows, WEBHOOK_RUNTIME_PACKAGE, DISPATCH_KIND } = await import(new URL('../lib/webhook-triggers.js', import.meta.url).href)

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

check('seenPathFor derives the dedup sidecar beside the history file', () => {
  // Derived, NOT a config key: the documented 25-key config surface (and
  // host-check's key-set assertion) must not grow for a storage split, and a
  // deployment that relocates webhookHistoryPath gets its dedup file moved
  // with it. The two files are one feature.
  assert.equal(seenPathFor('/home/u/.dsh/webhook-history.json'), '/home/u/.dsh/webhook-history.seen.json')
  // A custom path in a test or an unusual deployment relocates just as well
  // (compared with an inline expectation: this block runs before the suite's
  // own temp home is created, so it must not reference it).
  assert.equal(seenPathFor('/tmp/dsh-admin/history-persist.json'), '/tmp/dsh-admin/history-persist.seen.json')
  // Never collide with the history file itself, whatever the input shape.
  for (const path of ['x.json', 'x.JSON', 'x', 'x.jsonl', 'C:/d/webhook-history.json']) {
    assert.notEqual(seenPathFor(path), path, path + ' is not its own dedup path')
    assert.ok(seenPathFor(path).endsWith('.seen.json'), path + ' gets a .seen.json sibling')
  }
})

check('unionSeenKeys / mergeHistoryRows merge a sibling instance\u2019s sidecar rows', () => {
  // The flushes take the sibling file lock and merge what is on disk, because
  // another dsh instance on this DSH_HOME may have flushed its own deliveries
  // between our reads. A whole-file overwrite used to drop them — and a lost
  // claim re-executes a replayed delivery after a restart.
  assert.deepEqual(
    unionSeenKeys(['old\0a', 'old\0b'], ['new\0x']),
    ['old\0a', 'old\0b', 'new\0x'],
    'disk keys and memory keys union, order preserved',
  )
  assert.deepEqual(
    unionSeenKeys(['k1', 'k2', 'k3'], []).slice(-2),
    ['k2', 'k3'],
    'the union is tail-capped: newest keys survive, oldest fall off',
  )
  const diskRows = [
    { deliveryId: 'd-1', ruleId: 'r', ok: true },
    { deliveryId: 'd-2', ruleId: 'r', ok: false, error: 'offline' },
    { at: '2026-01-01', ruleId: 'r' }, // no deliveryId: passes through
  ]
  const memoryRows = [
    { deliveryId: 'd-3', ruleId: 'r', ok: true },
    // The same delivery re-read by this process: the newer row WINS the value.
    { deliveryId: 'd-2', ruleId: 'r', ok: false, error: 'offline (retried)' },
  ]
  const merged = mergeHistoryRows(diskRows, memoryRows)
  assert.equal(merged.length, 4, 'three distinct ids plus the id-less row')
  assert.deepEqual(
    merged.find((row) => row.deliveryId === 'd-2'),
    { deliveryId: 'd-2', ruleId: 'r', ok: false, error: 'offline (retried)' },
    'the later (memory) duplicate replaces the disk row',
  )
  assert.deepEqual(mergeHistoryRows(null, null), [], 'junk input folds to empty, never throws')
})

check('secretMatches compares equal secrets and rejects others', () => {
  assert.equal(secretMatches('s3cret', 's3cret'), true)
  assert.equal(secretMatches('s3cret', 'wrong'), false)
  // `'' === ''` is NOT a match. It used to be, and that made "an empty stored
  // secret authorizes an empty guess" true — the endpoint's own
  // `rule.secret === ''` guard was the only thing standing in the way, and a
  // provider route (or a future caller) does not go through that guard.
  assert.equal(secretMatches('', ''), false)
  assert.equal(secretMatches('a', ''), false)
  // Non-strings return false instead of throwing: `createHash().update(undefined)`
  // raised a TypeError out of the comparison.
  assert.equal(secretMatches(undefined, 'x'), false)
  assert.equal(secretMatches('x', undefined), false)
  assert.equal(secretMatches(null, null), false)
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
  }, [], { registry: fakeWorkspaceRegistry })
  assert.equal(create.action.mode, 'create')
  assert.deepEqual(create.action.model, { provider: 'cliproxy', model: 'gemini', maxTokens: 1024 })
  assert.equal(create.action.model.maxTokens, 1024)
})

check('validateRuleEntry rejects malformed entries', () => {
  const bad = (entry, existing = []) => () => validateRuleEntry(entry, existing)
  // Create-mode entries carry the trust context, so these still probe the
  // FIELD checks rather than stopping at the workspace gate.
  const badCreate = (action) => () => validateRuleEntry({ id: 'okc', secret: '', event: '', action }, [], { registry: fakeWorkspaceRegistry })
  assert.throws(bad({ id: 'Bad ID', action: { mode: 'steer', sessionId: 's' } }), /无效/, 'uppercase/space id rejected')
  assert.throws(bad({ id: 'dup', action: { mode: 'steer', sessionId: 's' } }, ['dup']), /已被其他规则占用/, 'duplicate id rejected')
  assert.throws(bad({ id: 'ok1' }), /action\.mode/, 'missing action rejected')
  assert.throws(bad({ id: 'ok2', action: { mode: 'nope' } }), /必须是 "steer" 或 "create"/, 'unknown mode rejected')
  assert.throws(bad({ id: 'ok3', action: { mode: 'steer' } }), /steer 模式需要 sessionId/, 'steer needs session')
  assert.throws(badCreate({ mode: 'create', workspacePath: 'relative/path', agentPreset: 'p', permissionPreset: 'w' }), /绝对路径/, 'create needs absolute path')
  assert.throws(badCreate({ mode: 'create', workspacePath: WORKSPACE }), /create 模式需要 agentPreset/, 'create needs preset')
  assert.throws(badCreate({ mode: 'create', workspacePath: WORKSPACE, agentPreset: 'p' }), /create 模式需要 permissionPreset/, 'create needs permission preset')
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

// The create-rule workspace gate needs a REAL directory that the deployment's
// workspace registry knows (WORKSPACE + fakeWorkspaceRegistry, both defined
// with the fixtures above).
const teardownDisposers = []
const ctx = {
  baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  get: (key) => {
    if (key === 'agents') return fakeAgents
    if (key === 'webServer') return fakeWebServer
    if (key === 'workspaceRegistry') return fakeWorkspaceRegistry
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

await checkAsync('a corrupt rules file is renamed aside before the next write (no silent wipe)', async () => {
  // 手改文件的一个多余逗号曾让下一次 saveRule 把全表换成只含新规则的文件——
  // 与 usage-ledger 的 `.corrupt` 同策略：先留证再按空表继续。
  const triggersPath = join(webhookHome, 'webhook-triggers.json')
  writeFileSync(triggersPath, '{ broken', 'utf8')
  const webhookAdmin = ctx.provided.webhookAdmin
  await webhookAdmin.saveRule({ id: 'corrupt-check', enabled: true, secret: 'topsecret-key-16chars', event: '', action: { mode: 'steer', sessionId: 'session-live', steer: true }, promptTemplate: 'x' })
  const corrupt = triggersPath + '.corrupt'
  assert.equal(existsSync(corrupt), true, 'the broken content is preserved beside the store')
  assert.equal(readFileSync(corrupt, 'utf8'), '{ broken', 'the evidence is byte-identical')
  const listed = await webhookAdmin.list()
  assert.equal(listed.rules.length, 1, 'the store continues from empty with the new write')
  // 清掉自己的规则，恢复后续用例依赖的空表起点。
  await webhookAdmin.deleteRule('corrupt-check')
})

check('validateRuleEntry gates a create rule workspacePath on TRUST, not mere absoluteness', () => {
// A create rule PERSISTS workspacePath and every delivery roots a session
// there, so an absolute path is not enough — the path must resolve inside a
// workspace this instance knows (the same gate workflowAdmin and the CLI
// backend paths already use). Regression: absoluteness used to be the only
// requirement, so a rule could root sessions at a filesystem root, reachable
// from the network because this endpoint bypasses browser auth.
const create = (workspacePath) => () => validateRuleEntry({
id: 'gated', secret: '', event: '',
action: { mode: 'create', workspacePath, agentPreset: 'cordis', permissionPreset: 'workspace-write' },
}, [], { registry: fakeWorkspaceRegistry })
const root = process.platform === 'win32' ? 'C:\\' : '/'
assert.throws(create(root), /filesystem root/, 'a filesystem root is refused')
assert.throws(create(join(tmpdir(), 'definitely-not-here-webhook-gate')), /does not exist/, 'a non-existent path is refused')
assert.throws(create(webhookHome), /outside the calling session|outside every workspace/, 'an existing but unknown directory is refused')
// Omitting the trust context refuses every explicit path (the safe direction).
assert.throws(() => validateRuleEntry({
id: 'no-trust', secret: '', event: '',
action: { mode: 'create', workspacePath: WORKSPACE, agentPreset: 'cordis', permissionPreset: 'workspace-write' },
}, []), /outside the calling session|outside every workspace/, 'no trust context refuses an explicit path')
// The trusted direction still works: the known workspace, and a subdirectory of it.
const sub = join(WORKSPACE, 'packages')
mkdirSync(sub, { recursive: true })
assert.equal(validateRuleEntry({
id: 'gated-ok', secret: '', event: '',
action: { mode: 'create', workspacePath: WORKSPACE, agentPreset: 'cordis', permissionPreset: 'workspace-write' },
}, [], { registry: fakeWorkspaceRegistry }).action.workspacePath, realpathSync.native(WORKSPACE), 'a known workspace is accepted (canonicalized)')
assert.equal(validateRuleEntry({
id: 'gated-sub', secret: '', event: '',
action: { mode: 'create', workspacePath: sub, agentPreset: 'cordis', permissionPreset: 'workspace-write' },
}, [], { registry: fakeWorkspaceRegistry }).action.workspacePath, realpathSync.native(sub), 'a subdirectory of a known workspace is accepted')
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

function mockReq({ method = 'POST', url = '/webhook-triggers/ci-fail', headers = {}, chunks = [], remote = '127.0.0.1' }) {
  const done = chunks.join('')
  return {
    method, url, headers,
    complete: true,
    resume() {},
    // A real request always carries the peer address; the F4 loopback gate fails
    // CLOSED on a transport that cannot report one, so these fixtures must look
    // like the local delivery they are testing (pass `remote: null` to exercise
    // the unknown-peer refusal).
    socket: remote === null ? {} : { remoteAddress: remote },
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

await checkAsync('sidecar flushes keep a sibling instance\u2019s rows (lock + merge, not overwrite)', async () => {
  // Simulate a sibling dsh instance on this DSH_HOME that flushed its own
  // delivery right before ours lands. The behavioral half of
  // unionSeenKeys/mergeHistoryRows: after OUR flush, its history row and its
  // claimed delivery id must still be on disk — a lost claim re-executes a
  // replayed delivery after a restart.
  const historyPath = join(webhookHome, 'history-main.json')
  const dedupPath = seenPathFor(historyPath)
  writeFileSync(historyPath, JSON.stringify({
    history: [{ at: '2026-01-01 00:00:00.000', ruleId: 'sibling', deliveryId: 'sibling-d1', event: 'push', ok: true }],
  }), 'utf8')
  writeFileSync(dedupPath, JSON.stringify({ seen: ['sibling\0sibling-d1'] }), 'utf8')
  const res = mockRes()
  await handler(jsonRequest({ delivery: 'merge-check-1' }), res)
  assert.equal(res.statusCode, 202, 'our delivery executed')
  const history = JSON.parse(readFileSync(historyPath, 'utf8'))
  assert.ok(history.history.some((row) => row.deliveryId === 'sibling-d1'), 'the sibling history row survived our flush')
  assert.ok(history.history.some((row) => row.deliveryId === 'merge-check-1'), 'and our own row landed beside it')
  const seen = JSON.parse(readFileSync(dedupPath, 'utf8'))
  assert.ok(seen.seen.includes('sibling\0sibling-d1'), 'the sibling claim survived our flush')
  assert.ok(seen.seen.includes('ci-fail\0merge-check-1'), 'and our own claim is there')
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

await checkAsync('HTTP handler: a path with extra segments is 404 for EVERY rule (no enumeration)', async () => {
  // The handler used to take the first path component and silently discard the
  // rest, so `/webhook-triggers/<id>/anything` was answered like the bare path.
  // That reopened enumeration the uniform 401 exists to close: a caller with a
  // correct secret for SOME rule compared the two answers and learned whether
  // <id> exists (past-auth vs 401). Both shapes must now be refused before any
  // rule is read, so the answer carries no information about the rule set.
  const withExisting = mockRes()
  await handler(jsonRequest({ url: '/webhook-triggers/ci-fail/anything' }), withExisting)
  const withUnknown = mockRes()
  await handler(jsonRequest({ url: '/webhook-triggers/nope/anything' }), withUnknown)
  assert.equal(withExisting.statusCode, 404, 'an existing rule with a trailing segment is refused')
  assert.equal(withUnknown.statusCode, 404, 'an unknown rule with a trailing segment is refused too')
  assert.notEqual(withExisting.statusCode, 401, 'the past-auth answer is not reachable through a longer path')
  assert.notEqual(withUnknown.statusCode, 401, 'and the two are not distinguishable by status')
  // Deeper paths and a trailing slash behave the same.
  for (const path of ['/webhook-triggers/ci-fail/a/b/c', '/webhook-triggers/ci-fail/', '/webhook-triggers/nope/a/b']) {
    const res = mockRes()
    await handler(jsonRequest({ url: path }), res)
    assert.equal(res.statusCode, 404, `${path} is refused`)
  }
  // The bare path still works, so the fix did not break the real route.
  const bare = mockRes()
  await handler(jsonRequest({ url: '/webhook-triggers/ci-fail', delivery: 'after-segment-fix' }), bare)
  assert.equal(bare.statusCode, 202, 'the bare path still delivers')
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

await checkAsync('HTTP handler: a FAILED action releases its delivery id so a retry can execute', async () => {
  // The dedup claim used to be permanent even when the action threw, so the
  // sender's retry was answered `202 {duplicate:true}` and the delivery was lost
  // for good — across restarts, since the claim is persisted. Only a crash
  // mid-action should keep the claim (a crash never reaches the release call).
  await ctx.provided.webhookAdmin.saveRule({
    id: 'offline-target',
    secret: 'topsecret-key-16chars',
    event: '',
    action: { mode: 'steer', sessionId: 'session-not-live', steer: true },
  })
  const request = (delivery) => jsonRequest({ ruleId: 'offline-target', event: '', delivery })
  const failed = mockRes()
  await handler(request('retry-after-failure'), failed)
  assert.equal(failed.statusCode, 503, 'an offline target is reported as a failure, not a success')
  assert.ok(failed.body.includes('不在线'), 'the failure names the offline session')

  // The SAME delivery id must now be allowed to execute. Re-point the rule at the
  // live session, so a released id is observable as an actual steer.
  await ctx.provided.webhookAdmin.saveRule({
    id: 'offline-target',
    secret: 'topsecret-key-16chars',
    event: '',
    action: { mode: 'steer', sessionId: 'session-live', steer: true },
  })
  const before = steered.length
  const retry = mockRes()
  await handler(request('retry-after-failure'), retry)
  assert.equal(retry.statusCode, 202, 'the retry is accepted')
  assert.ok(!retry.body.includes('duplicate'), 'the retry is NOT swallowed as a duplicate')
  assert.equal(steered.length, before + 1, 'the retry actually steers')

  // And it is claimed again afterwards: a THIRD delivery of the same id is deduped.
  const third = mockRes()
  await handler(request('retry-after-failure'), third)
  assert.equal(third.statusCode, 202)
  assert.ok(third.body.includes('duplicate'), 'once it succeeds, the id is claimed again')
  assert.equal(steered.length, before + 1, 'the third delivery does not steer again')
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
      if (key === 'workspaceRegistry') return fakeWorkspaceRegistry
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

await checkAsync('the history ring and the replay dedup live in SPLIT sidecars (one bounded write each)', async () => {
  // The combined sidecar was rewritten ENTIRELY twice per delivery, so its cost
  // was history-cap + dedup-cap on every write and `webhookHistoryCap` even
  // scaled the dedup write. Split, each file is bounded by its own cap; the
  // dedup path is DERIVED from webhookHistoryPath (no new config key).
  const historyPath = join(webhookHome, 'history-split.json')
  const seenPath = join(webhookHome, 'history-split.seen.json')
  const triggersPath = join(webhookHome, 'triggers-split.json')
  const disposers = []
  const steered = []
  const ctx = makeIsolatedCtx(disposers, steered)
  applyWebhookAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op), runPnpm: null, reconcileBundles: null,
    settings: { webhookTriggersPath: triggersPath, webhookHistoryPath: historyPath },
  })
  try {
    await ctx.provided.webhookAdmin.saveRule({ id: 'split', secret: 'topsecret-key-16chars', event: '', action: { mode: 'steer', sessionId: 'session-live', steer: true } })
    const handler = registeredRoutes[registeredRoutes.length - 1].handler
    const res = mockRes()
    await handler(mockReq({
      url: '/webhook-triggers/split',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': 'topsecret-key-16chars', 'x-webhook-event': 'push', 'x-webhook-delivery': 'd-split-1' },
      chunks: ['{"ok":true}'],
    }), res)
    assert.equal(res.statusCode, 202)
    assert.equal(steered.length, 1, 'the delivery executed')
    const historyDoc = JSON.parse(readFileSync(historyPath, 'utf8'))
    assert.ok(historyDoc.history.some((h) => h.deliveryId === 'd-split-1'), 'the delivery row lands in the history sidecar')
    assert.equal(Object.prototype.hasOwnProperty.call(historyDoc, 'seen'), false, 'the history sidecar no longer carries the dedup set')
    const seenDoc = JSON.parse(readFileSync(seenPath, 'utf8'))
    assert.deepEqual(seenDoc.seen, ['split\u0000d-split-1'], 'the claimed id lands in the derived dedup sidecar')
  } finally {
    for (const d of disposers.splice(0)) { try { d() } catch {} }
  }
})

await checkAsync('a pre-split combined sidecar seeds the dedup file at mount (no claim is forgotten)', async () => {
  // Upgrade path: an older build kept `seen` inline in the history file, and
  // every write after this one drops that key. The mount must therefore write
  // the split file BEFORE any history flush can be the first to lose it.
  const historyPath = join(webhookHome, 'history-legacy.json')
  const seenPath = join(webhookHome, 'history-legacy.seen.json')
  const triggersPath = join(webhookHome, 'triggers-legacy.json')
  rmSync(seenPath, { force: true })
  writeFileSync(historyPath, JSON.stringify({
    version: 1,
    history: [{ at: 'x', ruleId: 'legacy', deliveryId: 'd-old', ok: true }],
    seen: ['legacy\u0000d-old'],
  }, null, 2) + '\n', 'utf8')
  const disposers = []
  const ctx = makeIsolatedCtx(disposers, [])
  applyWebhookAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op), runPnpm: null, reconcileBundles: null,
    settings: { webhookTriggersPath: triggersPath, webhookHistoryPath: historyPath },
  })
  try {
    assert.deepEqual(JSON.parse(readFileSync(seenPath, 'utf8')).seen, ['legacy\u0000d-old'],
      'the inline claim is migrated into the derived dedup sidecar at mount')
    const listed = await ctx.provided.webhookAdmin.list()
    assert.ok(listed.history.some((h) => h.deliveryId === 'd-old'), 'the legacy history rows still read')
  } finally {
    for (const d of disposers.splice(0)) { try { d() } catch {} }
  }
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

await checkAsync('a FAILED action releases its id ACROSS a restart too (the release is persisted)', async () => {
  // A memory-only release would be undone by the on-disk dedup sidecar at the
  // next mount, re-burning the id — so this asserts the persisted half of the fix.
  const home = mkdtempSync(join(tmpdir(), 'webhook-release-'))
  const routes = []
  const steeredLocal = []
  const mountLocal = () => {
    const disposers = []
    const c = {
      baseUrl: pathToFileURL(join(home, 'node_modules', 'dsh-plugin-admin')).href,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      get: (key) => {
        if (key === 'agents') return { get: (sid) => (sid === 'live' ? { steer: (msg) => steeredLocal.push(msg), followup: () => {} } : undefined) }
        if (key === 'webServer') return { register: (route) => { routes.push(route); return () => {} } }
        return undefined
      },
      effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
      inject: () => () => {},
      provide: (key, service) => { c.provided ??= {}; c.provided[key] = service },
    }
    mkdirSync(join(home, 'node_modules', 'dsh-plugin-admin'), { recursive: true })
    writeFileSync(join(home, 'package.json'), JSON.stringify({ name: 'release-fixture', dependencies: {} }))
    applyWebhookAdmin(c, {
      enqueue: (op) => Promise.resolve().then(op),
      runPnpm: null,
      reconcileBundles: null,
      settings: { webhookTriggersPath: join(home, 'triggers.json'), webhookHistoryPath: join(home, 'history.json') },
    })
    return { service: c.provided.webhookAdmin, handler: routes[routes.length - 1].handler, disposers }
  }
  const fire = (handler, delivery) => {
    const res = mockRes()
    return handler(mockReq({
      url: '/webhook-triggers/rel',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': 'topsecret-key-16chars', 'x-webhook-delivery': delivery },
      chunks: ['{}'],
    }), res).then(() => res)
  }

  let m = mountLocal()
  try {
    // Target not online -> the action throws -> the id is released and persisted.
    await m.service.saveRule({ id: 'rel', secret: 'topsecret-key-16chars', event: '', action: { mode: 'steer', sessionId: 'offline', steer: true } })
    const failed = await fire(m.handler, 'cross-restart-1')
    assert.equal(failed.statusCode, 503, 'first attempt fails against the offline session')
    for (const d of m.disposers.splice(0)) { try { d() } catch {} }

    // "Restart" with the same sidecars, then point the rule at the live session.
    m = mountLocal()
    await m.service.saveRule({ id: 'rel', secret: 'topsecret-key-16chars', event: '', action: { mode: 'steer', sessionId: 'live', steer: true } })
    const retry = await fire(m.handler, 'cross-restart-1')
    assert.equal(retry.statusCode, 202)
    assert.equal(JSON.parse(retry.body).duplicate, undefined, 'the released id is NOT a duplicate after the restart')
    assert.equal(steeredLocal.length, 1, 'the retry executes across the restart')
  } finally {
    for (const d of m.disposers.splice(0)) { try { d() } catch {} }
  }
})

/* ==================== 跨进程并发写（F1/F2 扩展）==================== */

await checkAsync('two processes saving rules into one store lose no rule', async () => {
  // `persist` wrote atomically, but the guarded READ ran outside any lock: two
  // dsh instances on one profile could both read revision N, both merge their own
  // rule and the second write silently dropped the first. mutateRulesStore now
  // holds the lock across read → merge → write; this is the acceptance case.
  const dir = mkdtempSync(join(tmpdir(), 'webhook-race-'))
  const profileDir = join(dir, 'profile')
  mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-admin'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture', dependencies: {} }))
  const rulesPath = join(dir, 'webhook-rules.json')
  const historyPath = join(dir, 'webhook-history.json')
  const barrier = join(dir, 'go')
  const worker = join(dir, 'worker.mjs')
  const ROUNDS = 25
  writeFileSync(worker, [
    `import { applyWebhookAdmin } from ${JSON.stringify(new URL('../lib/webhook-triggers.js', import.meta.url).href)}`,
    `import { existsSync } from 'node:fs'`,
    `import { pathToFileURL } from 'node:url'`,
    'const [profileDir, rulesPath, historyPath, barrier, tag, rounds] = process.argv.slice(2)',
    'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
    'const ctx = {',
    "  baseUrl: pathToFileURL(profileDir).href,",
    '  logger: { info() {}, warn() {}, error() {} },',
    '  get: () => undefined,',
    "  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },",
    '  inject: undefined,',
    '  provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },',
    '}',
    'applyWebhookAdmin(ctx, {',
    '  enqueue: (op) => Promise.resolve().then(op),',
    '  runPnpm: null,',
    '  reconcileBundles: null,',
    '  settings: { webhookTriggersPath: rulesPath, webhookHistoryPath: historyPath },',
    '})',
    // Barrier: both children start writing at the same instant, so the no-lock
    // version really interleaves (startup skew alone would serialize them and a
    // missing lock would go unnoticed).
    'const until = Date.now() + 15000',
    'while (!existsSync(barrier) && Date.now() < until) await sleep(2)',
    'for (let i = 0; i < Number(rounds); i += 1) {',
    '  await ctx.provided.webhookAdmin.saveRule({',
    "    id: tag + '-rule-' + i, enabled: true, secret: 'topsecret-key-16chars',",
    "    action: { mode: 'steer', sessionId: 's', steer: true },",
    '  })',
    '}',
    'process.exit(0)',
    '',
  ].join('\n'), 'utf8')
  const run = (tag) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, join(profileDir, 'node_modules', 'dsh-plugin-admin'), rulesPath, historyPath, barrier, tag, String(ROUNDS)], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.resume()
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(tag + ' worker exited ' + code + ': ' + stderr))))
  })
  try {
    const children = [run('a'), run('b')]
    // Let both mounts reach the barrier before releasing them.
    await new Promise((resolve) => setTimeout(resolve, 600))
    writeFileSync(barrier, 'go', 'utf8')
    await Promise.all(children)
    const stored = JSON.parse(readFileSync(rulesPath, 'utf8'))
    const ids = new Set(stored.rules.map(r => r.id))
    const missing = []
    for (let i = 0; i < ROUNDS; i += 1) {
      if (!ids.has('a-rule-' + i)) missing.push('a-rule-' + i)
      if (!ids.has('b-rule-' + i)) missing.push('b-rule-' + i)
    }
    // Same contract as the cron twin: the lock is fail-open after 3s by design,
    // so a stall may lose one write; an unlocked read-merge-write loses many.
    assert.ok(
      missing.length <= 1,
      `an unlocked read-merge-write drops rules; the lock may only lose 1 to its documented fail-open — lost ${missing.length}: ${missing.slice(0, 8).join(',')}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log(results.join('\n'))
console.log(`verify-webhook-triggers OK: ${results.length} checks`)

// The webhook fs.watch listener holds the event loop alive after a green
// run — flush teardown disposers, then exit hard so CI never wedges.
for (const dispose of teardownDisposers.splice(0)) { try { dispose() } catch {} }
process.exit(0)
