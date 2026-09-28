/**
 * verify-workflow-admin.mjs — P3 自检：saved 库 CRUD / 双作用域 / RPC 服务接线
 *
 * 跑法：node scripts/verify-workflow-admin.mjs
 *
 * 验证 workflow-library.js 的持久化语义和 workflowAdmin 的形状，
 * 不跑真实工作流（那由 verify-workflow-runs 覆盖）。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { createWorkflowLibrary, createWorkflowAdmin } from '../lib/workflow-library.js'
import { applyWorkflowAdmin, workflowAuditOk } from '../lib/workflow-admin.js'
import { assertTrustedWorkspacePath, canonicalWorkspacePath } from '../lib/workspace-path.js'

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
  // The library refuses to INVENT a project root (a `mkdir -p` at an arbitrary
  // path was exactly the S2 write primitive), so the workspace exists first —
  // which is the real-world case: a project root is a directory the user has.
  mkdirSync(ws, { recursive: true })
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
  mkdirSync(ws, { recursive: true })
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
  mkdirSync(ws, { recursive: true })
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
  mkdirSync(ws, { recursive: true })
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

// ─── 审计（Phase F3 覆盖 workflowAdmin）────────────────────────────────────────

await check('workflowAuditOk reads each verb result by its own fields', () => {
  // 成功形态
  assert.equal(workflowAuditOk({ id: 'run-1', status: 'running', diagnostics: [] }), true)
  assert.equal(workflowAuditOk({ ok: true, record: { name: 'x' } }), true)
  assert.equal(workflowAuditOk({ stopped: true, reason: 'stopped' }), true)
  assert.equal(workflowAuditOk({ answered: true }), true)
  assert.equal(workflowAuditOk(undefined), true)
  // 失败形态：全都没有 `ok` 字段，通用规则会把它们记成"成功"
  assert.equal(workflowAuditOk({ id: null, error: 'parent session not found or not running' }), false, '启动失败（无在线父会话）')
  assert.equal(workflowAuditOk({ id: null, status: 'errored', diagnostics: [{ message: 'TS 语法错误' }] }), false, '脚本编译失败')
  assert.equal(workflowAuditOk({ stopped: false, reason: 'not running' }), false, 'stop 无事可做')
  assert.equal(workflowAuditOk({ answered: false, error: 'no pending question' }), false, '回答迟了')
  assert.equal(workflowAuditOk({ ok: false, error: 'invalid workflow name' }), false, 'saved 库拒绝')
})

await check('an audited workflow service lands failures as ok:false and skips reads', async () => {
  const home = join(tmpBase, 'audit-ok')
  const ctx = {
    baseUrl: home,
    get: (key) => (key === 'subagents' ? {} : undefined),
    effect: (fn) => fn(),
    provide: () => {},
    logger: { warn() {} },
  }
  const holder = {}
  ctx.provide = (key, s) => { holder[key] = s }
  const entries = []
  applyWorkflowAdmin(ctx, { enqueue, dshHome: home, audit: { record: async (entry) => { entries.push(entry) } } })

  // 没有在线父会话 → 启动必然失败，trail 必须记 ok:false。
  await holder.workflowAdmin.startRun({ script: 'return 1' })
  const start = entries.find((e) => e.action === 'workflowAdmin/startRun')
  assert.ok(start, 'startRun 进了 trail')
  assert.equal(start.ok, false, '失败以 ok:false 落账，而不是被通用规则记成成功')
  // 读路径不进 trail。
  holder.workflowAdmin.listRuns()
  holder.workflowAdmin.getRun('nope')
  assert.equal(entries.filter((e) => String(e.action).startsWith('workflowAdmin/list')).length, 0, 'listRuns 是读路径')
  assert.equal(entries.filter((e) => String(e.action).endsWith('/getRun')).length, 0, 'getRun 是读路径')
  // saved 库写成功 → ok:true
  await holder.workflowAdmin.saveSaved({ name: 'audited-save', scope: 'global', script: 'return 1' })
  const save = entries.find((e) => e.action === 'workflowAdmin/saveSaved')
  assert.equal(save.ok, true, '成功的 saved 写入记 ok:true')
})

// ─── 项目作用域路径闸门（S2）─────────────────────────────────────────────────
//
// `workspacePath` 在两个入口是**不可信输入**：模型传给 `workflow_admin` 的参数，
// 以及浏览器 RPC 载荷。此前 `join(workspacePath, '.dsh', 'workflows')` +
// `mkdirSync(recursive)` 让它们可以在任意目录建树写文件、`delete_saved` 可以在任意
// 路径 unlink。这一节把形状检查与信任检查都钉住。

console.log('project-scope workspace path gate:')

await check('shape: relative / missing / non-directory / filesystem root are refused', async () => {
  const home = join(tmpBase, 'gate-a')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  const outside = join(tmpBase, 'gate-a-outside')
  mkdirSync(outside, { recursive: true })
  const filePath = join(outside, 'a-file.txt')
  writeFileSync(filePath, 'not a directory')

  await assert.rejects(
    () => lib.saveSaved({ name: 'rel', scope: 'project', script: 'return 1', workspacePath: 'relative/dir' }),
    /must be an absolute path/,
  )
  await assert.rejects(
    () => lib.saveSaved({ name: 'missing', scope: 'project', script: 'return 1', workspacePath: join(outside, 'nope') }),
    /does not exist/,
  )
  await assert.rejects(
    () => lib.saveSaved({ name: 'afile', scope: 'project', script: 'return 1', workspacePath: filePath }),
    /must be a directory/,
  )
  await assert.rejects(
    () => lib.saveSaved({ name: 'root', scope: 'project', script: 'return 1', workspacePath: parse(resolve(outside)).root }),
    /filesystem root/,
  )
  // Reads and deletes go through the same choke point.
  assert.throws(() => lib.listSaved('relative/dir'), /must be an absolute path/)
  assert.throws(() => lib.getSaved('x', join(outside, 'nope')), /does not exist/)
  assert.throws(() => lib.deleteSaved('x', 'project', parse(resolve(outside)).root), /filesystem root/)
  // No side effects: the library never invented a tree anywhere.
  assert.equal(existsSync(join(outside, '.dsh')), false, 'no .dsh tree was created beside the file')
  assert.equal(existsSync(join(outside, 'nope')), false, 'the missing path was not created')
})

await check('a `.dsh` junction inside a project cannot redirect the write outside it', async () => {
  const home = join(tmpBase, 'gate-j')
  const ws = join(tmpBase, 'gate-j-ws')
  const target = join(tmpBase, 'gate-j-target')
  mkdirSync(ws, { recursive: true })
  mkdirSync(target, { recursive: true })
  // A cloned repository can ship `.dsh` as a link; the write must not follow it.
  symlinkSync(target, join(ws, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir')
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  await assert.rejects(
    () => lib.saveSaved({ name: 'esc', scope: 'project', script: 'return 1', workspacePath: ws }),
    /outside the project root/,
  )
  assert.equal(existsSync(join(target, 'workflows', 'esc.json')), false, 'nothing was written through the junction')
  assert.equal(existsSync(join(ws, '.dsh', 'workflows')), false, 'nothing was created through the junction either')
})

await check('trust: an explicit path must be inside the session tree or a known workspace', () => {
  const sessionRoot = canonicalWorkspacePath(mkdtempSync(join(tmpdir(), 'wf-session-')))
  const inside = join(sessionRoot, 'nested')
  mkdirSync(inside, { recursive: true })
  const outside = canonicalWorkspacePath(mkdtempSync(join(tmpdir(), 'wf-outside-')))

  assert.equal(assertTrustedWorkspacePath(inside, { sessionCwd: sessionRoot }), canonicalWorkspacePath(inside), 'a path inside the session tree is accepted')
  assert.equal(assertTrustedWorkspacePath(inside, { sessionCwd: sessionRoot }).length > 0, true)
  assert.throws(
    () => assertTrustedWorkspacePath(outside, { sessionCwd: sessionRoot }),
    /outside the calling session and outside every workspace/,
  )
  // The registry branch is what lets a panel act on a user-registered workspace.
  assert.equal(
    assertTrustedWorkspacePath(outside, { registry: { list: () => [{ path: outside }] } }),
    outside,
    'a registered workspace is accepted without a session',
  )
  assert.throws(
    () => assertTrustedWorkspacePath(join(outside, 'sub') === '' ? outside : outside, { registry: { list: () => [] } }),
    /outside the calling session/,
  )
  rmSync(sessionRoot, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

await check('RPC refuses a forged project root that is not a registered workspace', async () => {
  const home = join(tmpBase, 'gate-rpc')
  const ws = join(tmpBase, 'gate-rpc-ws')
  const outside = join(tmpBase, 'gate-rpc-outside')
  mkdirSync(ws, { recursive: true })
  mkdirSync(outside, { recursive: true })
  const lib = createWorkflowLibrary({ dshHome: home, enqueue })
  const ctx = {
    get: (key) => (key === 'workspaceRegistry' ? { list: () => [{ path: ws }] } : undefined),
  }
  const admin = createWorkflowAdmin({
    registry: { list: () => [], STATUS: {}, get: () => null, stop: async () => ({}) },
    library: lib,
    ctx,
  })

  const forgedSave = await admin.saveSaved({ name: 'evil', scope: 'project', script: 'return 1', workspacePath: outside })
  assert.equal(forgedSave.ok, false, 'the forged save is refused')
  assert.match(forgedSave.error, /outside the calling session and outside every workspace/)
  assert.equal(existsSync(join(outside, '.dsh')), false, 'no tree was created at the forged path')
  assert.match(admin.listSaved({ workspacePath: outside }).error, /outside the calling session/, 'listSaved refuses too')
  assert.equal(admin.getSaved({ name: 'x', workspacePath: outside }).error !== undefined, true, 'getSaved refuses too')
  const forgedDelete = admin.deleteSaved({ name: 'x', scope: 'project', workspacePath: outside })
  assert.equal(forgedDelete.ok, false, 'deleteSaved refuses too')
  assert.match(forgedDelete.error, /outside the calling session/)
  const forgedRun = await admin.runSaved({ name: 'x', workspacePath: outside })
  assert.match(forgedRun.error, /outside the calling session/, 'runSaved refuses too')

  // The same call against a REGISTERED workspace is the feature, not the attack.
  const legit = await admin.saveSaved({ name: 'legit', scope: 'project', script: 'return 1', workspacePath: ws })
  assert.equal(legit.ok, true, 'a registered workspace is accepted')
  assert.ok(existsSync(join(ws, '.dsh', 'workflows', 'legit.json')), 'written under the registered workspace')
  assert.equal(admin.listSaved({ workspacePath: ws }).length, 1, 'and readable back')
  // No path at all keeps the previous behaviour (global scope).
  const glob = await admin.saveSaved({ name: 'glob', scope: 'global', script: 'return 1' })
  assert.equal(glob.ok, true, 'a pathless global save still works')
})

// ─── 清理 ─────────────────────────────────────────────────────────────────────

rmSync(tmpBase, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-admin checks passed')
