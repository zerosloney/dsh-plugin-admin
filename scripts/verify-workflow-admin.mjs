/**
 * verify-workflow-admin.mjs — P3 自检：saved 库 CRUD / 双作用域 / RPC 服务接线
 *
 * 跑法：node scripts/verify-workflow-admin.mjs
 *
 * 验证 workflow-library.js 的持久化语义和 workflowAdmin 的形状，
 * 不跑真实工作流（那由 verify-workflow-runs 覆盖）。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkflowLibrary, createWorkflowAdmin } from '../lib/workflow-library.js'
import { applyWorkflowAdmin } from '../lib/workflow-admin.js'

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

const tmpBase = mkdtempSync(join(tmpdir(), 'wf-admin-'))

// 串行队列（与 index.js 同一个实现）
let tail = Promise.resolve()
const enqueue = (op) => { const run = tail.then(op, op); tail = run.catch(() => {}); return run }

console.log('createWorkflowLibrary:')

await check('save + read global scope', async () => {
  const home = join(tmpBase, 'a')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  await lib.saveSaved({
    name: 'audit',
    scope: 'global',
    script: 'return await agent("audit")',
    argsSchema: [{ name: 'target', type: 'string' }],
    description: 'codebase audit',
  })
  const rec = lib.getSaved('audit')
  assert.ok(rec, 'saved record readable')
  assert.equal(rec.scope, 'global')
  assert.equal(rec.script, 'return await agent("audit")')
  assert.ok(existsSync(join(home, 'workflows', 'saved', 'audit.json')), 'file on disk')
})

await check('save + read project scope', async () => {
  const home = join(tmpBase, 'b')
  const ws = join(tmpBase, 'ws-b')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  await lib.saveSaved({
    name: 'migrate',
    scope: 'project',
    script: 'return await agent("migrate")',
    workspacePath: ws,
  })
  const rec = lib.getSaved('migrate', ws)
  assert.ok(rec, 'project-scope record readable')
  assert.equal(rec.scope, 'project')
  assert.ok(existsSync(join(ws, '.dsh', 'workflows', 'migrate.json')), 'project file on disk')
})

await check('project scope overrides global on list', async () => {
  const home = join(tmpBase, 'c')
  const ws = join(tmpBase, 'ws-c')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  await lib.saveSaved({ name: 'dup', scope: 'global', script: 'global-version' })
  await lib.saveSaved({ name: 'dup', scope: 'project', script: 'project-version', workspacePath: ws })
  const rec = lib.getSaved('dup', ws)
  assert.equal(rec.script, 'project-version', 'project wins')
  const listed = lib.listSaved(ws)
  const entry = listed.find((r) => r.name === 'dup')
  assert.equal(entry.scope, 'project')
  assert.equal(listed.filter((r) => r.name === 'dup').length, 1, 'no duplicate in list')
})

await check('listSaved merges both scopes', async () => {
  const home = join(tmpBase, 'd')
  const ws = join(tmpBase, 'ws-d')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  await lib.saveSaved({ name: 'alpha', scope: 'global', script: 'a' })
  await lib.saveSaved({ name: 'beta', scope: 'project', script: 'b', workspacePath: ws })
  const listed = lib.listSaved(ws)
  const names = listed.map((r) => r.name).sort()
  assert.deepEqual(names, ['alpha', 'beta'])
})

await check('delete removes the right scope', async () => {
  const home = join(tmpBase, 'e')
  const ws = join(tmpBase, 'ws-e')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  await lib.saveSaved({ name: 'gone', scope: 'global', script: 'x' })
  await lib.saveSaved({ name: 'gone', scope: 'project', script: 'y', workspacePath: ws })
  assert.ok(lib.deleteSaved('gone', 'project', ws))
  assert.ok(!existsSync(join(ws, '.dsh', 'workflows', 'gone.json')), 'project file deleted')
  assert.ok(existsSync(join(home, 'workflows', 'saved', 'gone.json')), 'global file intact')
  assert.equal(lib.getSaved('gone', ws).scope, 'global')
})

await check('invalid name rejected', async () => {
  const home = join(tmpBase, 'f')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  await assert.rejects(
    () => lib.saveSaved({ name: '../escape', scope: 'global', script: 'x' }),
    /invalid workflow name/,
  )
  await assert.rejects(
    () => lib.saveSaved({ name: '', scope: 'global', script: 'x' }),
    /requires a name/,
  )
  await assert.rejects(
    () => lib.saveSaved({ name: 'ok', scope: 'global' }),
    /requires a script/,
  )
  // 读/删同享守卫：裸 join 的 get/delete 否则会成为路径穿越。
  assert.throws(() => lib.deleteSaved('../escape', 'global'), /invalid workflow name/)
  assert.throws(() => lib.getSaved('../escape', undefined), /invalid workflow name/)
})

await check('delete missing returns false', async () => {
  const home = join(tmpBase, 'g')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  assert.equal(lib.deleteSaved('nope', 'global'), false)
})

console.log('applyWorkflowAdmin:')

await check('mounts workflowAdmin service with full method set', async () => {
  const home = join(tmpBase, 'h')
  const provided = []
  const ctx = {
    baseUrl: home,
    get: (key) => (key === 'subagents' ? {} : undefined),
    effect: (fn) => { provided.push(fn); fn() },
    provide: (key, svc) => { provided.push({ key, svc }) },
    logger: { warn() {} },
  }
  const invocations = applyWorkflowAdmin(ctx, { enqueue, dshHome: home })
  const list = invocations()
  const methods = list.map((d) => d.method).sort()
  assert.deepEqual(methods, [
    'amendRun', 'answerRun', 'deleteSaved', 'getRun', 'getSaved', 'listRuns', 'listSaved',
    'resumeRun', 'runSaved', 'saveSaved', 'startRun', 'stopRun',
  ])
  const svc = provided.find((p) => p.key === 'workflowAdmin')
  assert.ok(svc, 'workflowAdmin provided on ctx')
  assert.equal(typeof svc.svc.startRun, 'function')
  assert.equal(typeof svc.svc.runSaved, 'function')
  // 回归守卫：网关 dispatch 强校验 receiver.typertRemote（缺失 → 每次调用
  // gateway/binding-invalid），且绑定必须指向服务对象本身。
  const binding = svc.svc.typertRemote
  assert.ok(binding, 'typertRemote binding present')
  assert.equal(binding.service, svc.svc, 'binding.service is the service object')
  assert.equal(binding.serviceKey, 'workflowAdmin')
  assert.equal(binding.namespace, 'workflowAdmin')
  // 回归守卫：descriptor 参数 wire 名必须与 client.js 的 call() 载荷键一致，
  // 否则网关 assertExactArguments 以 gateway/arguments-invalid 拒绝调用。
  const paramsOf = (m) => list.find((d) => d.method === m).parameters.map((p) => p.wire)
  assert.deepEqual(paramsOf('getRun'), ['runId'])
  assert.deepEqual(paramsOf('stopRun'), ['runId', 'reason'])
  assert.deepEqual(paramsOf('amendRun'), ['runId', 'script', 'spec'])
  assert.deepEqual(paramsOf('answerRun'), ['runId', 'text'])
  for (const m of ['startRun', 'listSaved', 'getSaved', 'saveSaved', 'deleteSaved', 'runSaved']) {
    assert.deepEqual(paramsOf(m), ['spec'], `${m} carries the spec wrapper`)
  }
  assert.deepEqual(paramsOf('listRuns'), [])
  assert.deepEqual(paramsOf('resumeRun'), ['runId', 'spec'])
})

await check('degrades gracefully without subagents', async () => {
  const home = join(tmpBase, 'i')
  const logs = []
  const ctx = {
    baseUrl: home,
    get: () => undefined,
    effect: () => {},
    provide: () => {},
    logger: { warn: (m) => logs.push(m) },
  }
  const invocations = applyWorkflowAdmin(ctx, { enqueue, dshHome: home })
  assert.deepEqual(invocations(), [], 'no descriptors when degraded')
  assert.ok(logs.some((m) => /workflow engine disabled/.test(m)), 'warns about degradation')
})

await check('startRun resolves parent from agents registry', async () => {
  const home = join(tmpBase, 'j')
  const fakeAgent = { id: 'sess-1' }
  const ctx = {
    baseUrl: home,
    get: (key) => {
      if (key === 'subagents') return {
        start: async () => ({
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }),
          dispose: async () => {},
        }),
      }
      if (key === 'agents') return { get: (id) => (id === 'sess-1' ? fakeAgent : undefined) }
      if (key === 'jobs') return { start: (spec) => { spec.run().done.catch(() => {}); return 'job-1' } }
      return undefined
    },
    effect: (fn) => fn(),
    provide: () => {},
    logger: { warn() {} },
  }
  const invocations = applyWorkflowAdmin(ctx, { enqueue, dshHome: home })
  const svc = { start: null }
  // 拿到 provide 的服务
  const realProvide = ctx.provide
  ctx.provide = (key, s) => { if (key === 'workflowAdmin') svc.start = s }
  applyWorkflowAdmin(ctx, { enqueue, dshHome: home })
  ctx.provide = realProvide

  const res = await svc.start.startRun({ script: 'return await agent("hi")', parentSessionId: 'sess-1' })
  assert.ok(res.id, 'run started')
  assert.equal(res.diagnostics.length, 0)

  const res2 = await svc.start.startRun({ script: 'return await agent("hi")', parentSessionId: 'nope' })
  assert.equal(res2.id, null)
  assert.match(res2.error, /parent session not found/)
})

await check('resume and amend re-resolve the recorded parent session', async () => {
  const home = join(tmpBase, 'j2')
  const live = new Map([['sess-1', { id: 'sess-1' }]])
  const ctx = {
    baseUrl: home,
    get: (key) => {
      if (key === 'subagents') return {
        start: async () => ({
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }),
          dispose: async () => {},
        }),
      }
      if (key === 'agents') return { get: (id) => live.get(id) }
      if (key === 'jobs') return { start: (spec) => { spec.run().done.catch(() => {}); return 'job-1' } }
      return undefined
    },
    effect: (fn) => fn(),
    provide: () => {},
    logger: { warn() {} },
  }
  const svc = { start: null }
  ctx.provide = (key, s) => { if (key === 'workflowAdmin') svc.start = s }
  applyWorkflowAdmin(ctx, { enqueue, dshHome: home })

  async function settled(id) {
    for (let i = 0; i < 200; i++) {
      const rec = svc.start.getRun(id)
      if (rec && rec.status !== 'running' && rec.status !== 'pending') return rec
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error(`run ${id} did not settle`)
  }

  const started = await svc.start.startRun({ script: 'return await agent("hi")', parentSessionId: 'sess-1' })
  assert.ok(started.id, 'run started')
  await settled(started.id)

  // 原会话仍在线：resume / amend 不带 spec，parent 从 run 记录的原会话解析。
  const resumed = await svc.start.resumeRun(started.id)
  assert.ok(resumed.id, 'resumed with the recorded parent')
  await settled(resumed.id)
  const amended = await svc.start.amendRun(started.id, 'return await agent("amended")')
  assert.ok(amended.id, 'amended with the recorded parent')
  await settled(amended.id)

  // 原会话下线：明确报错；显式 override 指到另一个在线会话即可续跑。
  live.delete('sess-1')
  const dead = await svc.start.resumeRun(resumed.id)
  assert.equal(dead.id, null)
  assert.match(dead.error, /not live/)
  live.set('sess-2', { id: 'sess-2' })
  const overridden = await svc.start.resumeRun(resumed.id, { parentSessionId: 'sess-2' })
  assert.ok(overridden.id, 'override parentSessionId points at a live session')
  await settled(overridden.id)
})

await check('saveSaved via RPC validates and persists', async () => {
  const home = join(tmpBase, 'k')
  const ctx = {
    baseUrl: home,
    get: (key) => (key === 'subagents' ? {} : undefined),
    effect: (fn) => fn(),
    provide: () => {},
    logger: { warn() {} },
  }
  const holder = {}
  ctx.provide = (key, s) => { holder[key] = s }
  applyWorkflowAdmin(ctx, { enqueue, dshHome: home })

  const res = await holder.workflowAdmin.saveSaved({
    name: 'via-rpc', scope: 'global', script: 'return 1',
  })
  assert.equal(res.ok, true)
  assert.equal(res.record.name, 'via-rpc')

  const bad = await holder.workflowAdmin.saveSaved({ name: 'bad/name', scope: 'global', script: 'x' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /invalid workflow name/)

  const listed = holder.workflowAdmin.listSaved({})
  assert.ok(listed.some((r) => r.name === 'via-rpc'))
})

// ─── 清理 ─────────────────────────────────────────────────────────────────────

rmSync(tmpBase, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-admin checks passed')
