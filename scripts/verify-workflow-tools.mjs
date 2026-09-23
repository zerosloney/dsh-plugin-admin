/**
 * verify-workflow-tools.mjs — P4a 自检：agent 侧 `workflow` 工具
 *
 * 跑法：node scripts/verify-workflow-tools.mjs
 *
 * 用假 registry / library 驱动工具的每个 action，验证：注册形状 /
 * create 的 parent 与 wait 语义 / amend/resume/stop 透传 / list 排序与
 * limit / get / save 的作用域解析 / run_saved 取库 / 降级。
 * 不跑真实引擎（那是 verify-workflow-runs 的职责）。
 */

import assert from 'node:assert/strict'
import { applyWorkflowTools } from '../lib/workflow-tools.js'

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

/** 假 registry：记录调用，start 立刻“落定”供 wait 分支观察。 */
function fakeRegistry(overrides = {}) {
  const calls = []
  let seq = 0
  let lastRecord = null
  return {
    calls,
    STATUS: { running: 'running', completed: 'completed', errored: 'errored', stopped: 'stopped' },
    async start(spec) {
      calls.push({ op: 'start', spec })
      const id = `wf_${++seq}`
      lastRecord = {
        id, label: spec.label, status: 'completed', updatedAt: Date.now(),
        steps: [{ kind: 'agent' }], result: { ok: true }, durationMs: 12,
      }
      overrides.onStart?.(lastRecord)
      return { id, status: 'running', diagnostics: [], jobId: null, ...overrides.startResult }
    },
    async stop(runId, reason) { calls.push({ op: 'stop', runId, reason }); return { stopped: true, runId } },
    async answer(runId, text) { calls.push({ op: 'answer', runId, text }); return overrides.answerResult ?? { answered: true } },
    async amend(runId, script, opts) {
      calls.push({ op: 'amend', runId, script, opts })
      const id = `wf_${++seq}`
      lastRecord = { id, label: 'amended', status: 'completed', updatedAt: Date.now(), steps: [], result: null, amendedFrom: runId }
      return { id, status: 'running', diagnostics: [], amendedFrom: runId, ...overrides.amendResult }
    },
    async resume(runId, opts) {
      calls.push({ op: 'resume', runId, opts })
      const id = `wf_${++seq}`
      lastRecord = { id, label: 'resumed', status: 'running', updatedAt: Date.now(), steps: [], resumedFrom: runId }
      return { id, status: 'running', diagnostics: [], resumedFrom: runId }
    },
    join(runId) { calls.push({ op: 'join', runId }); return Promise.resolve() },
    list() {
      return [
        { id: 'wf_old', label: 'old', status: 'completed', updatedAt: 100 },
        { id: 'wf_new', label: 'new', status: 'running', updatedAt: 500 },
      ]
    },
    get(runId) {
      if (runId === 'wf_x') return { id: 'wf_x', label: 'x', status: 'completed', steps: [], result: 42, log: [{ kind: 'log', message: 'hi' }] }
      // wait 分支用 start/amend/resume 刚返回的 id 回查
      if (lastRecord && lastRecord.id === runId) return lastRecord
      return null
    },
  }
}

function fakeLibrary() {
  const calls = []
  // scope-aware：项目 / 全局是两个命名空间（与真实库一致），getSaved 项目优先。
  const store = new Map()
  const keyOf = (scope, name) => `${scope === 'project' ? 'project' : 'global'}:${name}`
  return {
    calls,
    listSaved(ws) { calls.push({ op: 'listSaved', ws }); return [...store.values()].map((r) => ({ ...r, scope: ws ? r.scope : 'global' })) },
    getSaved(name, ws) {
      calls.push({ op: 'getSaved', name, ws })
      if (ws) { const p = store.get(keyOf('project', name)); if (p) return { ...p, scope: 'project' } }
      const g = store.get(keyOf('global', name))
      return g ? { ...g, scope: 'global' } : null
    },
    async saveSaved(spec) { calls.push({ op: 'saveSaved', spec }); const rec = { ...spec, updatedAt: 1 }; store.set(keyOf(spec.scope, spec.name), rec); return { ...rec } },
    deleteSaved(name, scope, ws) { calls.push({ op: 'deleteSaved', name, scope, ws }); return store.delete(keyOf(scope, name)) },
  }
}

/** 挂工具，返回 { tool, dispose, registered }。 */
function mount(registry, library, toolsImpl) {
  const registered = []
  const ctx = {
    get: (key) => (key === 'tools' ? (toolsImpl === undefined ? {
      register: (def) => { registered.push(def); return () => { registered.splice(registered.indexOf(def), 1) } },
    } : toolsImpl) : undefined),
    logger: { warn() {}, info() {} },
  }
  const dispose = applyWorkflowTools(ctx, { registry, library })
  return { ctx, tool: registered[0], dispose, registered }
}

const exec = { agent: { id: 'sess-1', session: { header: { cwd: '/proj' } } }, signal: undefined, callId: 'c1' }

console.log('applyWorkflowTools:')

await check('registers one `workflow_admin` tool with a string output', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  assert.ok(tool, 'tool registered')
  // 不能叫 `workflow`：宿主内置 tool-workflow 的默认工具名就是它，全局层同名注册会抛错。
  assert.equal(tool.name, 'workflow_admin')
  assert.equal(tool.output.schema.type, 'string')
  // 裸注册不经 defineTool 编译：parameters 必须自带完整 JSON Schema，
  // 否则核心原样投影给模型的就是残缺 schema。
  assert.equal(tool.parameters.type, 'object')
  assert.ok(tool.parameters.properties && tool.parameters.properties.action, 'action field projected')
  assert.deepEqual(tool.parameters.required, ['action'])
  const blocks = tool.output.render({}, 'hello')
  assert.deepEqual(blocks, [{ type: 'text', text: 'hello' }], 'render produces one text block')
})

await check('degrades without ctx.tools', async () => {
  const logs = []
  const ctx = { get: () => undefined, logger: { warn: (m) => logs.push(m) } }
  const dispose = applyWorkflowTools(ctx, { registry: fakeRegistry(), library: fakeLibrary() })
  assert.equal(typeof dispose, 'function', 'still returns a disposer')
  assert.ok(logs.some((m) => /workflow tool not registered/.test(m)), 'warns')
  dispose()
})

await check('create requires a script', async () => {
  const registry = fakeRegistry()
  const { tool } = mount(registry, fakeLibrary())
  const out = JSON.parse(await tool.execute({ action: 'create' }, exec))
  assert.match(out.error, /create requires a script/)
  assert.equal(registry.calls.length, 0, 'nothing started')
})

await check('create rejects a context without a live agent', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  const out = JSON.parse(await tool.execute({ action: 'create', script: 'return 1' }, {}))
  assert.match(out.error, /no calling agent/)
})

await check('amend and resume reject a context without a live agent', async () => {
  const registry = fakeRegistry()
  const { tool } = mount(registry, fakeLibrary())
  // 无 agent 时必须回 error body，而不是让 registry.start 的裸异常穿透到 RPC。
  const amended = JSON.parse(await tool.execute({ action: 'amend', runId: 'wf_1', script: 'return 2' }, {}))
  assert.match(amended.error, /no calling agent/)
  const resumed = JSON.parse(await tool.execute({ action: 'resume', runId: 'wf_1' }, {}))
  assert.match(resumed.error, /no calling agent/)
  assert.equal(registry.calls.length, 0, 'nothing dispatched')
})

await check('create starts a run with the session agent as parent', async () => {
  const registry = fakeRegistry()
  const { tool } = mount(registry, fakeLibrary())
  const out = JSON.parse(await tool.execute({
    action: 'create', script: 'return await agent("hi")', label: 'audit', args: { x: 1 },
  }, exec))
  assert.equal(out.status, 'running')
  assert.ok(out.id, 'run id returned')
  const started = registry.calls.find((c) => c.op === 'start')
  assert.equal(started.spec.parent, exec.agent, 'parent is the calling agent')
  assert.equal(started.spec.label, 'audit')
  assert.deepEqual(started.spec.args, { x: 1 })
})

await check('create with wait:true joins and returns the settled summary', async () => {
  const registry = fakeRegistry()
  const { tool } = mount(registry, fakeLibrary())
  const out = JSON.parse(await tool.execute({
    action: 'create', script: 'return 1', wait: true,
  }, exec))
  assert.equal(out.status, 'completed')
  assert.equal(out.stepCount, 1)
  assert.deepEqual(out.result, { ok: true })
  assert.ok(registry.calls.some((c) => c.op === 'join'), 'registry.join awaited')
})

await check('compile diagnostics surface instead of a run', async () => {
  const { tool } = mount(fakeRegistry({ startResult: { id: null, status: 'errored', diagnostics: [{ message: 'Unexpected token' }] } }), fakeLibrary())
  const out = JSON.parse(await tool.execute({ action: 'create', script: 'bad (' }, exec))
  assert.equal(out.id, null)
  assert.equal(out.diagnostics[0].message, 'Unexpected token')
})

await check('amend forwards script and parent', async () => {
  const registry = fakeRegistry()
  const { tool } = mount(registry, fakeLibrary())
  const out = JSON.parse(await tool.execute({ action: 'amend', runId: 'wf_1', script: 'return 2', wait: true }, exec))
  assert.equal(out.amendedFrom, 'wf_1')
  const call = registry.calls.find((c) => c.op === 'amend')
  assert.equal(call.runId, 'wf_1')
  assert.equal(call.script, 'return 2')
  assert.equal(call.opts.parent, exec.agent)
})

await check('resume and stop dispatch correctly', async () => {
  const registry = fakeRegistry()
  const { tool } = mount(registry, fakeLibrary())
  const resumed = JSON.parse(await tool.execute({ action: 'resume', runId: 'wf_1' }, exec))
  assert.equal(resumed.resumedFrom, 'wf_1')
  assert.equal(registry.calls.find((c) => c.op === 'resume').opts.parent, exec.agent)

  const stopped = JSON.parse(await tool.execute({ action: 'stop', runId: 'wf_1' }, exec))
  assert.equal(stopped.stopped, true)
  assert.match(registry.calls.find((c) => c.op === 'stop').reason, /agent tool/)
})

await check('list sorts newest first and clamps limit', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  const out = JSON.parse(await tool.execute({ action: 'list', limit: 1 }, exec))
  assert.equal(out.total, 2)
  assert.deepEqual(out.runs.map((r) => r.id), ['wf_new'], 'newest first, limited to 1')
})

await check('get returns the run or an error', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  const hit = JSON.parse(await tool.execute({ action: 'get', runId: 'wf_x' }, exec))
  assert.equal(hit.id, 'wf_x')
  assert.equal(hit.result, 42)

  const miss = JSON.parse(await tool.execute({ action: 'get', runId: 'nope' }, exec))
  assert.match(miss.error, /run not found/)
})

await check('save honours explicit scope; project takes the session cwd', async () => {
  const library = fakeLibrary()
  const { tool } = mount(fakeRegistry(), library)
  const g = JSON.parse(await tool.execute({ action: 'save', name: 'g1', script: 'return 1', scope: 'global' }, exec))
  assert.equal(g.ok, true)
  assert.equal(g.record.scope, 'global')
  assert.equal(library.calls.find((c) => c.op === 'saveSaved' && c.spec.name === 'g1').spec.workspacePath, undefined, 'global needs no workspace')

  const p = JSON.parse(await tool.execute({ action: 'save', name: 'p1', script: 'return 1', scope: 'project' }, exec))
  assert.equal(p.record.scope, 'project')
  assert.equal(library.calls.find((c) => c.op === 'saveSaved' && c.spec.name === 'p1').spec.workspacePath, '/proj', 'cwd taken from the session')

  const explicit = JSON.parse(await tool.execute({ action: 'save', name: 'p2', script: 'return 1', scope: 'project', workspacePath: '/elsewhere' }, exec))
  assert.equal(explicit.record.workspacePath, '/elsewhere', 'explicit workspacePath wins')

  const bad = JSON.parse(await tool.execute({ action: 'save', name: 'no script' }, exec))
  assert.match(bad.error, /requires a script/)
})

await check('save auto-detects project scope from the session cwd', async () => {
  const library = fakeLibrary()
  const { tool } = mount(fakeRegistry(), library)
  // 未指定 scope + 会话有 cwd → 项目 .dsh（对齐 ZCode SaveWorkflow 的识别语义）。
  const out = JSON.parse(await tool.execute({ action: 'save', name: 'auto', script: 'return 1' }, exec))
  assert.equal(out.ok, true)
  const call = library.calls.find((c) => c.op === 'saveSaved' && c.spec.name === 'auto')
  assert.equal(call.spec.scope, 'project', 'cwd present → project scope')
  assert.equal(call.spec.workspacePath, '/proj')
})

await check('save without a detectable cwd asks the user to choose', async () => {
  const library = fakeLibrary()
  const { tool } = mount(fakeRegistry(), library)
  // 识别不了（无调用会话 / 会话无 cwd）→ 不瞎猜，回 needsScopeChoice 让模型转问用户。
  const out = JSON.parse(await tool.execute({ action: 'save', name: 'g1', script: 'return 1' }, { agent: { id: 's1' } }))
  assert.equal(out.needsScopeChoice, true)
  assert.match(out.error, /ask the user/)
  assert.equal(library.calls.length, 0, 'nothing saved')
})

await check('run_saved resolves from the library and starts', async () => {
  const registry = fakeRegistry()
  const library = fakeLibrary()
  const { tool } = mount(registry, library)
  await library.saveSaved({ name: 'audit', scope: 'global', script: 'return await agent("a")' })

  const out = JSON.parse(await tool.execute({ action: 'run_saved', name: 'audit', args: { k: 1 } }, exec))
  assert.ok(out.id, 'run started from the saved script')
  const started = registry.calls.find((c) => c.op === 'start')
  assert.equal(started.spec.label, 'audit')
  assert.deepEqual(started.spec.args, { k: 1 })

  const miss = JSON.parse(await tool.execute({ action: 'run_saved', name: 'missing' }, exec))
  assert.match(miss.error, /not found in the library/)
})

await check('list_saved and delete_saved ride the library', async () => {
  const library = fakeLibrary()
  const { tool } = mount(fakeRegistry(), library)
  await library.saveSaved({ name: 's1', scope: 'global', script: 'x' })
  const listed = JSON.parse(await tool.execute({ action: 'list_saved' }, exec))
  assert.deepEqual(listed.saved.map((r) => r.name), ['s1'])

  // 无 scope 的删除与读取同序：项目优先、回退全局，并回报实际删掉的一级。
  const del = JSON.parse(await tool.execute({ action: 'delete_saved', name: 's1' }, exec))
  assert.equal(del.ok, true)
  assert.equal(del.scope, 'global', 'project missed → global fallback reports the deleted scope')
  assert.deepEqual(
    library.calls.filter((c) => c.op === 'deleteSaved').map((c) => c.scope),
    ['project', 'global'],
    'project-first detection order',
  )

  // 显式 scope 只删那一级。
  await library.saveSaved({ name: 's2', scope: 'global', script: 'x' })
  const del2 = JSON.parse(await tool.execute({ action: 'delete_saved', name: 's2', scope: 'global' }, exec))
  assert.deepEqual(del2, { ok: true, scope: 'global' })
  assert.equal(library.calls.filter((c) => c.op === 'deleteSaved' && c.name === 's2').length, 1, 'explicit scope deletes only that scope')
})

await check('answer action forwards to registry.answer', async () => {
  const reg = fakeRegistry()
  const { tool } = mount(reg, fakeLibrary())
  const out = JSON.parse(await tool.execute({ action: 'answer', runId: 'wf_q', text: '42' }, exec))
  assert.deepEqual(out, { answered: true })
  assert.deepEqual(reg.calls.find((c) => c.op === 'answer'), { op: 'answer', runId: 'wf_q', text: '42' })
})

await check('answer action validates its arguments', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  assert.match(JSON.parse(await tool.execute({ action: 'answer', text: '42' }, exec)).error, /answer requires runId/)
  assert.match(JSON.parse(await tool.execute({ action: 'answer', runId: 'wf_q' }, exec)).error, /requires a non-empty text/)
  assert.match(JSON.parse(await tool.execute({ action: 'answer', runId: 'wf_q', text: '  ' }, exec)).error, /requires a non-empty text/)
})

await check('eval action compiles and returns the script value', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  const out = JSON.parse(await tool.execute({
    action: 'eval',
    script: `const a = await agent('x')\nreturn a.length`,
  }, exec))
  assert.equal(out.ok, true)
  assert.equal(typeof out.value, 'number')
})

await check('eval action reports compile diagnostics without throwing', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  const out = JSON.parse(await tool.execute({ action: 'eval', script: `const a: = 1` }, exec))
  assert.equal(out.ok, false)
  assert.match(out.error, /compile failed/)
  assert.ok(Array.isArray(out.diagnostics) && out.diagnostics.length > 0, 'diagnostics surfaced')
})

await check('unknown action fails closed', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  const out = JSON.parse(await tool.execute({ action: 'nope' }, exec))
  assert.match(out.error, /unknown action/)
})

await check('presentCall marks read actions read', async () => {
  const { tool } = mount(fakeRegistry(), fakeLibrary())
  assert.equal(tool.presentCall({ action: 'list' }).kind, 'read')
  assert.equal(tool.presentCall({ action: 'create', script: 'x' }).kind, 'other')
  assert.equal(tool.presentCall({ action: 'create', script: 'x' }).title, 'Workflow: create')
})

await check('dispose unregisters the tool', async () => {
  const { registered, dispose } = mount(fakeRegistry(), fakeLibrary())
  assert.equal(registered.length, 1)
  dispose()
  assert.equal(registered.length, 0, 'disposer removes the registration')
})

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-tools checks passed')
