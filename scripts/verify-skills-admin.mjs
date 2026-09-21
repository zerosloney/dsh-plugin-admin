/**
 * Ad-hoc verification for the Skills administration section.
 *
 * Host half (lib/skills-admin.js) — the roster the panel reads:
 *  1. A deployment without `ctx.skills` answers `{ available: false }` with a
 *     reason, instead of throwing through the RPC gateway.
 *  2. The global read (no cwd, no scope) contributes user / bundled / runtime
 *     skills; rows project leaf fields only (name, description, whenToUse,
 *     source, provider, resourceBase → path|url, invocation flags), malformed
 *     rows drop, and `get()` — the body loader — is never called.
 *  3. Per-session scopes resolve through `sessionQuery.observeSession` +
 *     `agentPresets.standingKeyFor`, and the observation is disposed.
 *  4. A live session uses its Agent as the scope key AND its preset-scoped
 *     registry (`agentPresets.serviceFor(live, 'skills')`).
 *  5. Sessions sharing one (cwd, preset) collapse into a single registry read;
 *     a session with no cwd is reported as a failure without sinking the roster.
 *  6. A scope whose read throws is reported per scope; the roster survives.
 *  7. `complete: false` from the registry propagates (a partial observation must
 *     never read as a complete roster).
 *  8. The session cap is enforced with a warning.
 *  9. One skill seen from several scopes stays ONE entry: scope labels merge,
 *     missing description / path fill in, the two invocation flags OR together.
 *
 * Client half (lib/client.js 技能 page):
 * 10. Missing registry → the quiet "本部署未挂载 @deepseek-ai/dsh-skill" hint.
 * 11. The roster renders every skill with its badges, source label, path and
 *     scope list; the text / source / scope filters narrow it locally.
 * 12. An unresolved session scope is surfaced outside the collapsible panel.
 * 13. A failed host read surfaces inline; the copy gesture writes /<name>.
 *
 * Run: node scripts/verify-skills-admin.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

const harnessRoot = process.env.DSH_HARNESS_ROOT
const harnessWeb = harnessRoot === undefined ? '' : join(harnessRoot, 'packages/client/web/node_modules')
let harnessReq = null
if (harnessRoot !== undefined) {
  try {
    harnessReq = createRequire(join(harnessRoot, 'package.json'))
    harnessReq('jsdom')
  } catch {
    harnessReq = null
  }
}
const { JSDOM } = harnessReq ? harnessReq('jsdom') : req('jsdom')
const React = harnessReq ? req(`${harnessWeb}/react`) : req('react')
const { createRoot } = harnessReq ? req(`${harnessWeb}/react-dom/client`) : req('react-dom/client')
const act = React.act ?? (harnessReq ? req(`${harnessWeb}/react-dom/test-utils`).act : req('react-dom/test-utils').act)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://dsh.local/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const { applySkillsAdmin } = await import('../lib/skills-admin.js')

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

/**
 * Mount the real host module against a fake service bag and return the
 * captured skillsAdmin service.
 * @param {object} services - service key → service (or undefined).
 */
function mountHost(services) {
  let mounted = null
  const disposers = []
  const returned = applySkillsAdmin({
    get: (key) => services[key],
    effect(cb) { const d = cb(); if (typeof d === 'function') disposers.push(d); return () => {} },
    provide(key, svc) { if (key === 'skillsAdmin') mounted = svc },
  })()
  assert.ok(Array.isArray(returned) && returned.length === 1, 'one skills invocation registered')
  assert.equal(returned[0].id, 'dsh-plugin-admin/skills/list')
  assert.ok(mounted !== null, 'skillsAdmin service provided')
  return { service: mounted, disposers }
}

/** A registry stub whose snapshot() records its options. */
function registryStub(handler, calls = []) {
  return {
    calls,
    snapshot: async (options) => {
      calls.push(options)
      return handler(options)
    },
    get: async () => {
      throw new Error('get() (the body loader) must never be called by this panel')
    },
  }
}

/** One disposable session observation. */
function observationFor(cwd, preset, disposals = []) {
  return {
    header: cwd === undefined ? {} : { cwd },
    projections: { values: preset === undefined ? {} : { agentPreset: preset } },
    [Symbol.dispose]() { disposals.push(cwd) },
  }
}

/* ============================== Host half ============================== */

await checkAsync('1. a deployment without ctx.skills degrades instead of throwing', async () => {
  const { service } = mountHost({})
  assert.deepEqual(await service.list({}), {
    available: false,
    registry: false,
    complete: false,
    skills: [],
    scopes: [],
    sessions: [],
    warnings: ['本部署未挂载 @deepseek-ai/dsh-skill（技能注册表不可用）'],
  })
})

await checkAsync('2. the global read projects leaf fields, drops malformed rows, never loads bodies', async () => {
  const calls = []
  const registry = registryStub(() => ({
    complete: true,
    skills: [
      { name: 'zeta', description: 'z', source: 'user-agents', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: false }, resourceBase: { kind: 'directory', path: '/home/.agents/skills/zeta' } },
      { name: 'alpha', description: 'a', whenToUse: 'w', source: 'bundled', provider: 'runtime', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'url', url: 'https://example.test/skills/alpha' } },
      { name: 'candidate-path', path: '/cand/skills/x', description: '', source: 'custom', provider: 'p', invocation: {}, resourceBase: { kind: 'opaque', description: 'remote' } },
      null,
      42,
      { name: '   ' },
      { description: 'no name' },
    ],
  }), calls)
  const { service } = mountHost({ skills: registry })
  const view = await service.list({})
  assert.deepEqual(calls, [{}], 'the global read passes no cwd and no scope')
  assert.equal(view.available, true)
  assert.equal(view.complete, true)
  assert.deepEqual(view.skills.map((s) => s.name), ['alpha', 'candidate-path', 'zeta'], 'roster sorted by name, malformed rows dropped')
  const alpha = view.skills[0]
  assert.deepEqual(alpha, {
    name: 'alpha',
    description: 'a',
    whenToUse: 'w',
    source: 'bundled',
    sources: ['bundled'],
    provider: 'runtime',
    path: null,
    url: 'https://example.test/skills/alpha',
    resource: 'url',
    modelInvocable: true,
    userInvocable: true,
    scopes: ['全局'],
  })
  const zeta = view.skills[2]
  assert.equal(zeta.path, '/home/.agents/skills/zeta', 'a directory resourceBase becomes the path')
  assert.equal(zeta.whenToUse, null, 'an absent whenToUse is null, not undefined')
  assert.equal(zeta.userInvocable, false)
  assert.equal(view.skills[1].path, '/cand/skills/x', 'a candidate-style bare path is accepted')
  assert.equal(view.skills[1].resource, 'opaque')
  assert.deepEqual(view.scopes, [{ label: '全局', short: '全局', kind: 'global', cwd: null, preset: null, sessionIds: [], count: 3, error: null }])
  assert.deepEqual(view.sessions, [])
})

await checkAsync('3. session scopes resolve through observeSession + the preset standing key, and dispose', async () => {
  const disposals = []
  const hostCalls = []
  const presetCalls = []
  const liveAgent = { id: 'live-agent' }
  const hostRegistry = registryStub(() => ({ complete: true, skills: [
    { name: 'global-only', description: 'g', source: 'bundled', provider: 'runtime', invocation: { modelInvocable: true, userInvocable: true } },
  ] }), hostCalls)
  const presetRegistry = registryStub(() => ({ complete: true, skills: [
    { name: 'preset-only', description: 'p', source: 'custom', provider: 'preset', invocation: { modelInvocable: true, userInvocable: true } },
  ] }), presetCalls)
  const sessions = {
    'live-1': observationFor('/w/live', 'cordis', disposals),
    'cold-1': observationFor('/w/cold', 'build', disposals),
    'cold-2': observationFor('/w/cold', 'build', disposals),
    'no-cwd': observationFor(undefined, 'build', disposals),
  }
  const { service } = mountHost({
    skills: hostRegistry,
    sessionQuery: { observeSession: async (id) => sessions[id] },
    agents: { get: (id) => (id === 'live-1' ? liveAgent : undefined) },
    agentPresets: {
      standingKeyFor: async (preset) => ({ standing: preset }),
      serviceFor: (agent, key) => (agent === liveAgent && key === 'skills' ? presetRegistry : undefined),
    },
  })
  const view = await service.list({ sessionIds: ['live-1', 'cold-1', 'cold-2', 'no-cwd'] })
  assert.deepEqual(hostCalls, [
    {},
    { cwd: '/w/cold', scope: { standing: 'build' } },
    // The cwd-less session still owns a preset scope: dsh's own tool-skill
    // passes `cwd: undefined` together with `scope`, and dropping the session
    // would silently lose a whole preset layer.
    { cwd: undefined, scope: { standing: 'build' } },
  ], 'the global read + one cold scope read (shared bucket) + the cwd-less preset scope')
  assert.deepEqual(presetCalls, [{ cwd: '/w/live', scope: liveAgent }], 'a live session scopes by its Agent and reads its preset registry')
  const scopes = view.scopes.filter((s) => s.kind === 'session')
  assert.deepEqual(scopes.map((s) => s.label), ['/w/live @ cordis', '/w/cold @ build', '(无 cwd) @ build'], 'one bucket per distinct (cwd, preset)')
  assert.equal(scopes[1].sessionIds.length, 2, 'two sessions sharing a (cwd, preset) collapse into ONE scope')
  assert.equal(scopes[2].count, 1, 'the cwd-less scope read still resolves the preset layer')
  assert.equal(scopes[2].error, null, 'a cwd-less session is NOT a scope failure any more')
  assert.deepEqual(disposals.sort(), ['/w/cold', '/w/cold', '/w/live', undefined], 'every observation is disposed')
  assert.deepEqual(view.sessions.filter((s) => s.ok !== true), [], 'no session is dropped for lacking a cwd')
  assert.deepEqual(view.skills.map((s) => s.name), ['global-only', 'preset-only'], 'the roster carries the global and preset skills that did resolve')
})

await checkAsync('3b. a preset that no longer resolves is REPORTED, never silently downgraded', async () => {
  const hostCalls = []
  const registry = registryStub((options) => ({
    complete: true,
    skills: options.cwd === undefined
      ? [{ name: 'global-only', description: 'g', source: 'bundled', provider: 'r', invocation: { modelInvocable: true, userInvocable: true } }]
      : [{ name: 'project-only', description: 'p', source: 'project-agents', provider: 'f', invocation: { modelInvocable: true, userInvocable: true } }],
  }), hostCalls)
  const { service } = mountHost({
    skills: registry,
    sessionQuery: { observeSession: async () => observationFor('/w/gone', 'deleted-preset') },
    agents: { get: () => undefined },
    agentPresets: {
      standingKeyFor: async () => { throw new Error('agent-preset/not-found') },
    },
  })
  const view = await service.list({ sessionIds: ['s-gone'] })
  assert.deepEqual(hostCalls, [{}], 'the cwd-only fallback read is NOT issued for a broken preset')
  const scope = view.scopes.find((s) => s.kind === 'session')
  assert.ok(scope.error.includes('deleted-preset'), 'the broken preset is named in the scope failure')
  assert.ok(scope.error.includes('agent-preset/not-found'), 'the underlying resolution error is carried')
  assert.equal(scope.count, 0)
  assert.deepEqual(view.skills.map((s) => s.name), ['global-only'], 'the global layer still renders')
})

await checkAsync('4. a cold session scopes by the preset standing key against the host registry', async () => {
  const hostCalls = []
  const hostRegistry = registryStub((options) => ({
    complete: true,
    skills: [
      options.cwd === undefined
        ? { name: 'global-skill', description: 'g', source: 'bundled', provider: 'runtime', invocation: { modelInvocable: true, userInvocable: true } }
        : { name: 'cold-skill', description: '', source: 'project-agents', provider: 'filesystem', invocation: { modelInvocable: false, userInvocable: true }, resourceBase: { kind: 'directory', path: options.cwd + '/.agents/skills/cold/SKILL.md' } },
    ],
  }), hostCalls)
  const { service } = mountHost({
    skills: hostRegistry,
    sessionQuery: { observeSession: async () => observationFor('/w/cold', 'build') },
    agents: { get: () => undefined },
    agentPresets: { standingKeyFor: async (preset) => ({ standing: preset }) },
  })
  const view = await service.list({ sessionIds: ['cold-1'] })
  assert.deepEqual(hostCalls, [{}, { cwd: '/w/cold', scope: { standing: 'build' } }], 'the scoped read carries cwd + the standing scope key')
  assert.deepEqual(view.skills.map((s) => s.name), ['cold-skill', 'global-skill'])
  const cold = view.skills.find((s) => s.name === 'cold-skill')
  assert.deepEqual(cold.scopes, ['/w/cold @ build'])
  assert.equal(cold.path, '/w/cold/.agents/skills/cold/SKILL.md')
  assert.equal(cold.userInvocable, true)
  assert.equal(cold.modelInvocable, false)
})

await checkAsync('5. a throwing scope read is reported per scope and the roster survives', async () => {
  const registry = registryStub((options) => {
    if (options.cwd !== undefined) throw new Error('provider blew up')
    return { complete: true, skills: [{ name: 'global-skill', description: 'g', source: 'bundled', provider: 'r', invocation: { modelInvocable: true, userInvocable: true } }] }
  })
  const { service } = mountHost({
    skills: registry,
    sessionQuery: { observeSession: async () => observationFor('/w/broken', 'build') },
    agents: { get: () => undefined },
    agentPresets: { standingKeyFor: async () => ({ standing: 'build' }) },
  })
  const view = await service.list({ sessionIds: ['s-broken'] })
  assert.deepEqual(view.skills.map((s) => s.name), ['global-skill'], 'a failed scope does not sink the roster')
  const scope = view.scopes.find((s) => s.kind === 'session')
  assert.equal(scope.error, 'provider blew up')
  assert.equal(scope.count, 0)
  assert.equal(view.complete, true, 'a thrown read is a scope fault, not an incomplete observation')
})

await checkAsync('6. complete:false propagates and the session cap warns', async () => {
  const registry = registryStub(() => ({ complete: false, skills: [{ name: 'partial', description: '', source: 'user-agents', provider: 'f', invocation: { modelInvocable: true, userInvocable: true } }] }))
  const { service } = mountHost({
    skills: registry,
    sessionQuery: { observeSession: async () => observationFor('/w/all', 'build') },
    agents: { get: () => undefined },
    agentPresets: { standingKeyFor: async () => ({ standing: 'build' }) },
  })
  const many = Array.from({ length: 40 }, (_, index) => 'sess-' + String(index))
  const view = await service.list({ sessionIds: many })
  assert.equal(view.complete, false, 'an incomplete observation is surfaced, never silently completed')
  assert.ok(view.warnings.includes('仅解析前 32 个会话（共 40 个）'), 'the session cap is reported')
  assert.equal(view.sessions.length, 32, 'only the cap is resolved')
})

await checkAsync('7. one name seen from several scopes merges into ONE entry', async () => {
  const registry = registryStub((options) => {
    if (options.cwd === undefined) {
      return { complete: true, skills: [
        { name: 'shared', description: '', source: 'bundled', provider: 'runtime', invocation: { modelInvocable: true, userInvocable: false } },
      ] }
    }
    return { complete: true, skills: [
      { name: 'shared', description: 'project flavour', source: 'project-agents', provider: 'filesystem', invocation: { modelInvocable: false, userInvocable: true }, resourceBase: { kind: 'directory', path: '/w/x/.agents/skills/shared' } },
    ] }
  })
  const { service } = mountHost({
    skills: registry,
    sessionQuery: { observeSession: async () => observationFor('/w/x', 'build') },
    agents: { get: () => undefined },
    agentPresets: { standingKeyFor: async () => ({ standing: 'build' }) },
  })
  const view = await service.list({ sessionIds: ['s1'] })
  assert.equal(view.skills.length, 1, 'the same name stays one card')
  const shared = view.skills[0]
  assert.deepEqual(shared.scopes, ['全局', '/w/x @ build'])
  assert.deepEqual(shared.sources, ['bundled', 'project-agents'])
  assert.equal(shared.description, 'project flavour', 'a missing description fills in from the other scope')
  assert.equal(shared.path, '/w/x/.agents/skills/shared')
  assert.equal(shared.modelInvocable, true, 'the invocation flags OR together')
  assert.equal(shared.userInvocable, true)
})

/* ============================= Client half ============================= */

const registrations = []
globalThis.window.__ModuleLoader__ = { load: (r) => registrations.push(r) }
new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)
const bundle = registrations[0].factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`require("${spec}") missed the platform table`)
})

let rosterMode = 'roster'
let sessionListFails = false
const calls = []
const call = async (method, args) => {
  calls.push({ method, args })
  if (method === 'sessionAdmin/list') {
    if (sessionListFails === 'reject') throw new Error('注入：传输层拒绝')
    if (sessionListFails === true) return { ok: false, error: '注入：列表服务不可用' }
    return { ok: true, value: { sessions: [
      { sessionId: 's-alpha', title: 'Alpha', archived: false },
      { sessionId: 's-beta', title: 'Beta', archived: true },
    ], profileDir: '' } }
  }
  if (method === 'skillsAdmin/list') {
    if (rosterMode === 'unavailable') {
      return { ok: true, value: { available: false, registry: false, complete: false, skills: [], scopes: [], sessions: [], warnings: ['本部署未挂载 @deepseek-ai/dsh-skill（技能注册表不可用）'] } }
    }
    return { ok: true, value: {
      available: true,
      registry: true,
      complete: true,
      skills: [
        { name: 'alpha-only', description: '只在这个工作区可见', whenToUse: '改 alpha 的时候', source: 'project-agents', sources: ['project-agents'], provider: 'filesystem', path: '/proj/.agents/skills/alpha-only/SKILL.md', url: null, resource: 'directory', modelInvocable: true, userInvocable: true, scopes: ['alpha @ build', '全局'] },
        { name: 'global-skill', description: '插件内置技能', whenToUse: null, source: 'bundled', sources: ['bundled'], provider: 'runtime', path: null, url: null, resource: 'opaque', modelInvocable: true, userInvocable: false, scopes: ['全局'] },
        { name: 'human-only', description: '仅人类可调用', whenToUse: null, source: 'user-agents', sources: ['user-agents'], provider: 'filesystem', path: '/home/.agents/skills/human-only/SKILL.md', url: null, resource: 'directory', modelInvocable: false, userInvocable: true, scopes: ['alpha @ build'] },
      ],
      scopes: [
        { label: '全局', short: '全局', kind: 'global', cwd: null, preset: null, sessionIds: [], count: 2, error: null },
        { label: 'alpha @ build', short: 'alpha @ build', kind: 'session', cwd: 'E:/Demo/alpha', preset: 'build', sessionIds: ['s-alpha', 's-beta'], count: 2, error: null },
      ],
      sessions: [
        { sessionId: 's-alpha', ok: true, cwd: 'E:/Demo/alpha', preset: 'build', message: '' },
        { sessionId: 's-beta', ok: false, cwd: null, preset: null, message: '会话没有项目 cwd' },
      ],
      warnings: [],
    } }
  }
  if (method === 'fsAdmin/reveal') return { ok: true, value: { ok: true } }
  return { ok: false, error: 'unexpected ' + method }
}

async function mountPanel(container) {
  const injected = []
  const registered = []
  const ctx = {
    effect: () => () => {},
    connection: { rpc: { call: (route, method, payload) => call(method, payload.args) } },
    slots: {
      inject: (key, cb) => injected.push({ key, cb }),
      register: (options, component) => { registered.push({ options, component }); return () => {} },
    },
  }
  bundle.apply(ctx)
  injected.forEach((entry) => entry.cb())
  const section = registered.find((r) => r.options.id === 'skills-admin')
  if (section === undefined) throw new Error('skills-admin settings section not registered')
  const face = section.options.inject()
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(section.component, face)) })
  return { root, face }
}

const fiberHandler = async (node, handlerName, event) => {
  const fiberKey = Object.keys(node).find((key) => key.startsWith('__reactFiber$'))
  assert.ok(fiberKey, 'react fiber expando present on node')
  let fiber = node[fiberKey]
  while (fiber && !(fiber.memoizedProps && typeof fiber.memoizedProps[handlerName] === 'function')) {
    fiber = fiber.return
  }
  assert.ok(fiber, handlerName + ' handler present up the fiber tree')
  await act(async () => { fiber.memoizedProps[handlerName](event) })
}

await checkAsync('8. a deployment without the registry renders the quiet unavailable hint', async () => {
  rosterMode = 'unavailable'
  const host = document.body.appendChild(document.createElement('div'))
  const mounted = await mountPanel(host)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
  assert.ok(document.body.textContent.includes('本部署未挂载 @deepseek-ai/dsh-skill'), 'the unavailable hint renders')
  assert.ok(!document.body.textContent.includes('没有发现任何技能'), 'the empty-roster state does not show alongside it')
  await act(async () => { mounted.root.unmount() })
  host.remove()
  rosterMode = 'roster'
})

await checkAsync('9. the roster renders every skill, its origin, path and badges', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const mounted = await mountPanel(host)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
  const text = host.textContent
  const titles = [...host.querySelectorAll('.card-title-text')].filter((el) => el.textContent.startsWith('/')).map((el) => el.textContent)
  assert.deepEqual(titles.slice().sort(), ['/alpha-only', '/global-skill', '/human-only'], 'one card per skill')
  assert.equal((text.match(/🤖 模型可调用/g) || []).length, 2, 'two model-invocable badges')
  assert.equal((text.match(/👤 人类可调用/g) || []).length, 2, 'two user-invocable badges')
  assert.ok(text.includes('项目 .agents') && text.includes('插件内置') && text.includes('用户 .agents'), 'each source renders its friendly label')
  assert.ok(text.includes('/proj/.agents/skills/alpha-only/SKILL.md'), 'the SKILL.md path renders')
  assert.ok(text.includes('可见于：'), 'the per-skill scope list renders')
  assert.ok(text.includes('共 3 个技能（全局 + 1 个会话作用域）'), 'the roster summary counts the scopes')
  assert.ok(text.includes('会话 s-beta 的作用域未能解析：会话没有项目 cwd'), 'an unresolved session scope is surfaced outside the collapsed panel')
  const openButtons = [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('📂 打开目录'))
  assert.equal(openButtons.length, 2, 'only path-bearing skills offer the reveal action')

  // Text filter.
  const needle = [...host.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === '过滤技能')
  assert.ok(needle !== undefined, 'the filter input renders')
  await fiberHandler(needle, 'onChange', { target: { value: 'alpha' } })
  assert.ok(host.textContent.includes('/alpha-only'))
  assert.ok(!host.textContent.includes('/human-only'), 'a non-matching skill is filtered out')
  await fiberHandler(needle, 'onChange', { target: { value: '' } })

  // Source filter (a select whose aria-label is 按来源过滤).
  const sourceSelect = [...host.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === '按来源过滤')
  assert.ok(sourceSelect !== undefined, 'the source filter renders')
  await fiberHandler(sourceSelect, 'onChange', { target: { value: 'bundled' } })
  assert.ok(host.textContent.includes('/global-skill'))
  assert.ok(!host.textContent.includes('/alpha-only'), 'the source filter narrows the roster')
  await fiberHandler(sourceSelect, 'onChange', { target: { value: 'all' } })

  // Scope filter.
  const scopeSelect = [...host.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === '按作用域过滤')
  assert.ok(scopeSelect !== undefined, 'the scope filter renders')
  const scopeValues = [...scopeSelect.querySelectorAll('option')].map((o) => o.value)
  assert.ok(scopeValues.includes('全局') && scopeValues.some((v) => v.includes('@ build')), 'scope options come from the roster')
  await fiberHandler(scopeSelect, 'onChange', { target: { value: '全局' } })
  assert.ok(host.textContent.includes('/global-skill'))
  assert.ok(!host.textContent.includes('/human-only'), 'the scope filter narrows the roster')
  await fiberHandler(scopeSelect, 'onChange', { target: { value: 'all' } })

  // Scope coverage panel.
  const toggle = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('查看作用域明细'))
  assert.ok(toggle !== undefined, 'the scope toggle renders')
  await fiberHandler(toggle, 'onClick', {})
  assert.ok(host.textContent.includes('作用域覆盖') && host.textContent.includes('全局'), 'the scope panel lists coverage')
  assert.ok(host.textContent.includes('2 个会话'), 'a scope reports how many sessions it covers')

  await act(async () => { mounted.root.unmount() })
  host.remove()
})

await checkAsync('10. an unavailable session list degrades to the global layer with a note', async () => {
  sessionListFails = true
  const host = document.body.appendChild(document.createElement('div'))
  const mounted = await mountPanel(host)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
  assert.ok(host.textContent.includes('会话列表不可用'), 'the session-list failure is reported as a note')
  assert.ok(host.textContent.includes('/global-skill'), 'the global skills still render')
  await act(async () => { mounted.root.unmount() })
  host.remove()
  sessionListFails = false
})

await checkAsync('10b. a REJECTED session list also degrades instead of failing the page', async () => {
  // The session list is only an enrichment: a transport rejection must behave
  // exactly like a returned {ok:false} — global roster plus a note, never the
  // page-level error state.
  sessionListFails = 'reject'
  const host = document.body.appendChild(document.createElement('div'))
  const mounted = await mountPanel(host)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
  assert.ok(host.textContent.includes('会话列表不可用'), 'the rejection is reported as a note')
  assert.ok(host.textContent.includes('/global-skill'), 'the global skills still render')
  assert.ok(!host.textContent.includes('加载技能失败'), 'the page-level failure state is NOT used')
  await act(async () => { mounted.root.unmount() })
  host.remove()
  sessionListFails = false
})

await checkAsync('11. a failed roster read surfaces inline instead of a blank page', async () => {
  const failing = async (method, args) => {
    if (method === 'sessionAdmin/list') return { ok: true, value: { sessions: [], profileDir: '' } }
    if (method === 'skillsAdmin/list') return { ok: false, error: 'registry is absent' }
    return { ok: false, error: 'unexpected ' + method }
  }
  const injected = []
  const registered = []
  const ctx = {
    effect: () => () => {},
    connection: { rpc: { call: (route, method, payload) => failing(method, payload.args) } },
    slots: {
      inject: (key, cb) => injected.push({ key, cb }),
      register: (options, component) => { registered.push({ options, component }); return () => {} },
    },
  }
  bundle.apply(ctx)
  injected.forEach((entry) => entry.cb())
  const section = registered.find((r) => r.options.id === 'skills-admin')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(section.component, section.options.inject()))
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
  assert.ok(host.textContent.includes('加载技能失败：registry is absent'), 'the host rejection renders inline')
  assert.ok(!host.textContent.includes('没有发现任何技能'), 'an error is not misreported as an empty roster')
  await act(async () => { root.unmount() })
  host.remove()
})

await checkAsync('12. the copy gesture writes /<name> to the clipboard', async () => {
  class StubClipboard {
    constructor() { this.lastWrite = null }
    async writeText(text) { this.lastWrite = text }
    async readText() { return this.lastWrite || '' }
  }
  const stubNavigator = Object.assign(Object.create(globalThis.window.navigator), { clipboard: new StubClipboard() })
  Object.defineProperty(globalThis.window, 'navigator', { value: stubNavigator, configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: stubNavigator, configurable: true })

  const host = document.body.appendChild(document.createElement('div'))
  const mounted = await mountPanel(host)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
  const copyButton = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('📋 复制 /name'))
  assert.ok(copyButton !== undefined, 'a copy button renders')
  await act(async () => { copyButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  assert.ok(['/alpha-only', '/global-skill', '/human-only'].includes(globalThis.window.navigator.clipboard.lastWrite), 'the slash name reaches the clipboard')
  assert.ok(host.textContent.includes('✓ 已复制'), 'the transient confirmation renders')
  await act(async () => { mounted.root.unmount() })
  host.remove()
})

console.log(results.join('\n'))
console.log(`verify-skills-admin OK: ${results.length} checks`)
