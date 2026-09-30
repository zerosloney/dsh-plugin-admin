/**
 * verify-workflow-runs.mjs — P2 自检：状态机 / journal / step cache / amend / resume
 *
 * 跑法：node scripts/verify-workflow-runs.mjs
 *
 * 用最小 mock ctx（subagents + jobs + 可选 shell），真实写盘到临时目录。
 * 不依赖真实 dsh 宿主；宿主集成由 integration-check.mjs 覆盖。
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunRegistry } from '../lib/workflow-runs.js'

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

// ─── 测试夹具 ──────────────────────────────────────────────────────────────────

function makeCtx({ slow = false } = {}) {
  let agentCalls = 0
  const started = []
  const jobsHooks = []
  const jobSpecs = []
  return {
    ctx: {
      get: (key) => {
        if (key === 'subagents') return {
          start: async (name, request) => {
            agentCalls += 1
            const promptText = String(request.prompt[0]?.text || '')
            started.push(promptText)
            // 慢 agent 让 cancel 有窗口介入
            const work = slow
              ? new Promise((r) => setTimeout(r, 60))
              : Promise.resolve()
            return {
              result: work.then(() => ({
                stopReason: 'completed',
                output: [{ type: 'text', text: `result:${promptText}` }],
              })),
              dispose: async () => {},
            }
          },
        }
        if (key === 'jobs') return {
          start: (spec) => {
            const id = `job_${Math.random().toString(36).slice(2, 6)}`
            jobSpecs.push(spec)
            // 立即跑 run()，拿 hooks
            const hooks = spec.run()
            jobsHooks.push(hooks)
            // 异步等完成，不阻塞测试
            hooks.done.catch(() => {})
            return id
          },
        }
        return undefined
      },
    },
    agentCalls: () => agentCalls,
    started: () => started,
    jobsHooks: () => jobsHooks,
    jobSpecs: () => jobSpecs,
  }
}

function makeRegistry(ctx, dshHome, opts = {}) {
  let seq = 0
  const queue = []
  let tail = Promise.resolve()
  const enqueue = (op) => {
    const run = tail.then(op, op)
    tail = run.catch(() => {})
    return run
  }
  return createRunRegistry({ ctx, enqueue, dshHome, maxConcurrency: 4, ...opts })
}

// ─── 运行 ─────────────────────────────────────────────────────────────────────

const tmpBase = mkdtempSync(join(tmpdir(), 'wf-runs-'))
let reg
let ctxBundle

async function runToDone(startResult, registry) {
  // start() 返回后脚本在后台跑；轮询到终态。
  const id = startResult.id
  if (!id) throw new Error(`start rejected: ${JSON.stringify(startResult.diagnostics)}`)
  for (let i = 0; i < 200; i++) {
    const rec = registry.get(id)
    if (rec && (rec.status === 'completed' || rec.status === 'errored' || rec.status === 'stopped')) return rec
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`run ${id} did not settle`)
}

console.log('createRunRegistry:')

await check('simple run completes with results', async () => {
  ctxBundle = makeCtx()
  const home = join(tmpBase, 'a')
  reg = makeRegistry(ctxBundle.ctx, home)
  const { id, diagnostics } = await reg.start({
    script: `
      const a = await agent('task one')
      const b = await agent('task two')
      return a + '|' + b
    `,
    parent: { id: 'sess-parent' },
    args: {},
  })
  assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics))
  const rec = await runToDone({ id }, reg)
  assert.equal(rec.status, 'completed')
  assert.equal(rec.result, 'result:task one|result:task two')
  assert.equal(ctxBundle.agentCalls(), 2)
  // ctx.jobs 桥接的 done 必须是 JobOutcome（status/output），宿主任务通知靠它渲染。
  const hooks = ctxBundle.jobsHooks()[0]
  assert.ok(hooks, 'job bridged to ctx.jobs')
  const outcome = await hooks.done
  assert.equal(outcome.status, 'completed')
  assert.match(outcome.output, /completed in 2 steps/)
  // dsh 0.1.7 起 owner 是 SessionId（字符串），不再是 Agent 实例。
  const jobSpec = ctxBundle.jobSpecs()[0]
  assert.equal(jobSpec.owner, 'sess-parent', 'owner passes the session id, not the Agent object')
})

await check('record persists to disk', async () => {
  const home = join(tmpBase, 'b')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id } = await r.start({
    script: `return await agent('persisted')`,
    parent: { id: 'sess-p' },
  })
  const rec = await runToDone({ id }, r)
  const files = readdirSync(join(home, 'workflows', 'runs'))
  assert.ok(files.some((f) => f.startsWith('wf_') && f.endsWith('.json')), 'run file written')
  const rec2 = r.get(id)
  assert.equal(rec2.status, 'completed')
  assert.equal(rec2.result, 'result:persisted')
  assert.equal(rec2.parentSessionId, 'sess-p', 'records the parent session for resume/amend affinity')
})

await check('parallel fan-out spawns all agents', async () => {
  const home = join(tmpBase, 'c')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id } = await r.start({
    script: `
      const items = ['x', 'y', 'z']
      const results = await parallel(items.map((i) => () => agent('do ' + i)))
      return results.join(',')
    `,
    parent: { id: 'sess-par' },
  })
  const rec = await runToDone({ id }, r)
  assert.equal(rec.status, 'completed')
  assert.equal(rec.result, 'result:do x,result:do y,result:do z')
})

await check('TS script compiles and runs', async () => {
  const home = join(tmpBase, 'd')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id, diagnostics } = await r.start({
    script: `
      interface W { name: string }
      const w: W = { name: 'ts' }
      return await agent('hello ' + w.name)
    `,
    parent: { id: 'sess-ts' },
  })
  assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics))
  const rec = await runToDone({ id }, r)
  assert.equal(rec.status, 'completed')
  assert.equal(rec.result, 'result:hello ts')
})

await check('broken script rejected at start with diagnostics', async () => {
  const home = join(tmpBase, 'e')
  const r = makeRegistry(ctxBundle.ctx, home)
  const res = await r.start({
    script: `const x: { = 1`,
    parent: { id: 'sess-bad' },
  })
  assert.equal(res.id, null)
  assert.ok(res.diagnostics.length > 0, 'diagnostics reported')
  assert.equal(res.status, 'errored')
})

await check('runtime error marks run errored', async () => {
  const home = join(tmpBase, 'f')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id } = await r.start({
    script: `throw new Error('boom')`,
    parent: { id: 'sess-err' },
  })
  const rec = await runToDone({ id }, r)
  assert.equal(rec.status, 'errored')
  assert.match(rec.error, /boom/)
})

await check('stop cancels a running workflow', async () => {
  const slow = makeCtx({ slow: true })
  const home = join(tmpBase, 'g')
  const r = makeRegistry(slow.ctx, home)
  const { id } = await r.start({
    script: `
      await agent('slow one')
      await agent('slow two')
      return 'done'
    `,
    parent: { id: 'sess-stop' },
  })
  // 给它一点时间起跑
  await new Promise((res) => setTimeout(res, 10))
  const outcome = await r.stop(id, 'user cancelled')
  assert.equal(outcome.stopped, true)
  const rec = await runToDone({ id }, r)
  assert.equal(rec.status, 'stopped')
  assert.equal(rec.stopReason, 'cancelled')
  // 第二个 agent 不该被起
  const started = slow.started()
  assert.ok(started.length <= 1, `expected at most 1 agent started, got ${started.length}`)
})

await check('amend reuses finished steps from cache', async () => {
  const bundle = makeCtx()
  const home = join(tmpBase, 'h')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({
    script: `
      const a = await agent('first')
      const b = await agent('second')
      return a + '|' + b
    `,
    parent: { id: 'sess-amend' },
    label: 'original',
  })
  const rec = await runToDone({ id }, r)
  assert.equal(rec.status, 'completed')
  const callsBefore = bundle.agentCalls()

  // amend：第一个步骤不变，第二个改了 prompt
  const res2 = await r.amend(id, `
    const a = await agent('first')
    const b = await agent('second CHANGED')
    return a + '|' + b
  `, { parent: { id: 'sess-amend' } })
  const rec2 = await runToDone(res2, r)
  assert.equal(rec2.status, 'completed')
  assert.equal(rec2.result, 'result:first|result:second CHANGED')
  const callsAfter = bundle.agentCalls()
  // 只重跑了变化的那个步骤（+1），命中的没重花
  assert.equal(callsAfter - callsBefore, 1, `expected 1 new agent call, got ${callsAfter - callsBefore}`)
  assert.ok(rec2.amendedFrom === id, 'amendedFrom set')
})

await check('amend stops the active run first and preserves its journal', async () => {
  const bundle = makeCtx({ slow: true })
  const home = join(tmpBase, 'amend-live')
  const r = makeRegistry(bundle.ctx, home)
  const script = `
    const a = await agent('slow one')
    const b = await agent('slow two')
    return a + '|' + b
  `
  const { id } = await r.start({ script, parent: { id: 'sess-amend-live' } })
  await new Promise((res) => setTimeout(res, 10))
  // 对正在跑的 run amend：必须先停旧、等 journal 写完，再以它为缓存起新 run。
  const res2 = await r.amend(id, script, { parent: { id: 'sess-amend-live' } })
  const oldRec = await runToDone({ id }, r)
  assert.equal(oldRec.status, 'stopped', 'old run settled before the new one started')
  const newRec = await runToDone(res2, r)
  assert.equal(newRec.status, 'completed')
  assert.equal(newRec.amendedFrom, id)
})

await check('list includes persisted runs after restart', async () => {
  const bundle = makeCtx()
  const home = join(tmpBase, 'restart')
  const r1 = makeRegistry(bundle.ctx, home)
  const { id } = await r1.start({
    script: `return await agent('once')`,
    parent: { id: 'sess-restart' },
  })
  await runToDone({ id }, r1)
  // 新 registry 实例 = 模拟进程重启：磁盘上的 run 仍要能列出。
  const r2 = makeRegistry(bundle.ctx, home)
  const found = r2.list().find((x) => x.id === id)
  assert.ok(found, 'persisted run listed after restart')
  assert.equal(found.status, 'completed')
})

/* ---- O-2：list() 的摘要侧车 ---- */
// list() 曾经把每个 journal 整份读进来再 JSON.parse，而 journal 装着每步的
// prompt 与完整 outcome——宿主线程上的同步读，面板轮询反复触发。侧车让 list()
// 只读 13 个标量字段。这组用例锁住三件事：侧车真的写了、它的内容与整读等价、
// 以及缺侧车的旧目录仍能正确列出（升级兼容）。
await check('persist() writes a summary sidecar beside the journal', async () => {
  const bundle = makeCtx()
  const home = join(tmpBase, 'sidecar-write')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({ script: `return await agent('x')`, parent: { id: 'sess-sidecar' } })
  await runToDone({ id }, r)
  const dir = join(home, 'workflows', 'runs')
  const files = readdirSync(dir)
  assert.ok(files.includes(id + '.json'), 'the journal exists')
  assert.ok(files.includes(id + '.summary.json'), 'the sidecar exists beside it')
  const sidecar = JSON.parse(readFileSync(join(dir, id + '.summary.json'), 'utf8'))
  // The sidecar must NOT carry the heavy fields — that is its entire point.
  assert.equal(sidecar.steps, undefined, 'the sidecar carries no steps array')
  assert.equal(sidecar.log, undefined, 'the sidecar carries no log array')
  assert.equal(sidecar.script, undefined, 'the sidecar carries no script body')
  assert.equal(sidecar.id, id, 'but it does identify the run')
})

await check('list() from sidecars equals list() from full journals (legacy fallback parity)', async () => {
  const bundle = makeCtx()
  const home = join(tmpBase, 'sidecar-parity')
  const r = makeRegistry(bundle.ctx, home)
  const ids = []
  for (const prompt of ['a', 'b', 'c']) {
    const { id } = await r.start({ script: `return await agent(${JSON.stringify(prompt)})`, parent: { id: 'sess-parity' } })
    await runToDone({ id }, r)
    ids.push(id)
  }
  const dir = join(home, 'workflows', 'runs')
  const withSidecars = r.list().sort((x, y) => String(x.id).localeCompare(String(y.id)))
  // Remove every sidecar: this is exactly what a directory written by an older
  // build looks like, and it must still list correctly.
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.summary.json')) rmSync(join(dir, file), { force: true })
  }
  const withoutSidecars = makeRegistry(bundle.ctx, home).list().sort((x, y) => String(x.id).localeCompare(String(y.id)))
  assert.equal(withoutSidecars.length, withSidecars.length, 'same number of runs either way')
  assert.deepEqual(withoutSidecars, withSidecars, 'the sidecar path and the fallback path agree field for field')
  assert.equal(withSidecars.length, ids.length, 'every seeded run is listed')
})

await check('a stale sidecar cannot outlive the status change it describes', async () => {
  // The sidecar is written in the SAME queue slot as the journal, so the two can
  // never describe different revisions. Lock that in: after a run is stopped, the
  // sidecar must report the stopped status, not the running one it was written
  // with while the run was live.
  const bundle = makeCtx({ slow: true })
  const home = join(tmpBase, 'sidecar-stale')
  const r = makeRegistry(bundle.ctx, home, { stopSettleTimeoutMs: 2000 })
  const { id } = await r.start({ script: `await agent('slow'); return 1`, parent: { id: 'sess-stale' } })
  await new Promise((resolve) => setTimeout(resolve, 20))
  await r.stop(id, 'test')
  const sidecar = JSON.parse(readFileSync(join(home, 'workflows', 'runs', id + '.summary.json'), 'utf8'))
  assert.notEqual(sidecar.status, 'running', 'the sidecar does not still claim the run is running')
  const listed = makeRegistry(bundle.ctx, home).list().find((x) => x.id === id)
  assert.ok(listed, 'the run is listed from its sidecar after a restart')
  assert.equal(listed.status, sidecar.status, 'the restart listing agrees with the sidecar on disk')
})

await check('a run whose sidecar is corrupt still lists (falls back to the journal)', async () => {
  const bundle = makeCtx()
  const home = join(tmpBase, 'sidecar-corrupt')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({ script: `return await agent('c')`, parent: { id: 'sess-corrupt' } })
  await runToDone({ id }, r)
  const dir = join(home, 'workflows', 'runs')
  writeFileSync(join(dir, id + '.summary.json'), '{ this is not json')
  const listed = makeRegistry(bundle.ctx, home).list().find((x) => x.id === id)
  assert.ok(listed, 'a corrupt sidecar does not hide the run')
  assert.equal(listed.status, 'completed', 'the fallback read recovered the real status')
})

/* ---- O-2 写入侧：steps 走 append-only JSONL ---- */
// journal 的载荷 96.7% 是 steps 数组，而旧 persist() 每步把整个 record 重新
// 序列化并重写全文件——写入量是步骤数的平方（实测 200 步：697 MB 写入换来
// 1.7 MB 文件）。steps 挪到 <runId>.steps.jsonl 后按追加写，写入量降到 O(N)。
// 这组用例锁住格式契约与兼容性，因为改的是**磁盘格式**。
await check('steps live in an append-only JSONL, not in the journal', async () => {
  const bundle = makeCtx()
  const home = join(tmpBase, 'steps-jsonl')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({ script: `const a = await agent('one')\nconst b = await agent('two')\nreturn a + b`, parent: { id: 'sess-jsonl' } })
  await runToDone({ id }, r)
  const dir = join(home, 'workflows', 'runs')
  const journal = JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8'))
  assert.equal(journal.steps, undefined, 'the journal no longer carries the steps array')
  const jsonl = readFileSync(join(dir, id + '.steps.jsonl'), 'utf8')
  const lines = jsonl.trim().split('\n').filter(Boolean)
  assert.ok(lines.length > 0, 'the steps JSONL has entries')
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line), 'every JSONL line parses')
  // The two agent() calls each produce a before + after entry.
  const steps = lines.map((l) => JSON.parse(l))
  assert.ok(steps.length >= 4, `expected at least 2 calls x 2 phases, got ${steps.length}`)
  assert.ok(steps.some((s) => s.phase === 'before') && steps.some((s) => s.phase === 'after'), 'both phases are recorded')
})

await check('loadRecord reassembles steps so get()/amend see the same shape as before', async () => {
  const bundle = makeCtx()
  const home = join(tmpBase, 'steps-assemble')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({ script: `const a = await agent('x')\nreturn a`, parent: { id: 'sess-asm' } })
  await runToDone({ id }, r)
  // A fresh registry = a restart; it must read the steps back from the JSONL.
  const r2 = makeRegistry(bundle.ctx, home)
  const viaGet = r2.get(id)
  assert.ok(Array.isArray(viaGet.steps), 'get() returns a steps array')
  assert.ok(viaGet.steps.length >= 2, `get() sees the reassembled steps (got ${viaGet.steps.length})`)
  // And stepCount, which the panel shows, agrees with the array length.
  const listed = r2.list().find((x) => x.id === id)
  assert.equal(listed.stepCount, viaGet.steps.length, 'list().stepCount matches the reassembled array')
  // amend must be able to use those steps as a cache source.
  const amended = await r2.amend(id, `const a = await agent('x')\nreturn a`, { parent: { id: 'sess-asm' } })
  await r2.join(amended.id)
  assert.ok(amended.id, 'amend from a JSONL-backed journal succeeds')
})

await check('a truncated final JSONL line keeps every complete step before it', async () => {
  // Appending is not atomic, so a process killed mid-append leaves a partial last
  // line. That must cost AT MOST that one line — the old format lost the whole
  // file when a full rewrite was interrupted.
  const bundle = makeCtx()
  const home = join(tmpBase, 'steps-torn')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({ script: `await agent('a')\nawait agent('b')\nreturn 1`, parent: { id: 'sess-torn' } })
  await runToDone({ id }, r)
  const file = join(home, 'workflows', 'runs', id + '.steps.jsonl')
  const original = readFileSync(file, 'utf8')
  const lineCount = original.trim().split('\n').length
  // Chop the last line in half, simulating a kill during append.
  writeFileSync(file, original.slice(0, original.length - 12))
  const r2 = makeRegistry(bundle.ctx, home)
  const rec = r2.get(id)
  assert.ok(Array.isArray(rec.steps), 'the run still reads')
  assert.equal(rec.steps.length, lineCount - 1, `every complete line survives (expected ${lineCount - 1}, got ${rec.steps.length})`)
  assert.ok(rec.steps.length > 0, 'and the earlier steps are intact')
})

await check('a legacy journal with inline steps still loads (no migration on read)', async () => {
  // Runs written by an older build keep steps INLINE in the journal and have no
  // JSONL. They must keep working, and reading must not rewrite anything.
  const bundle = makeCtx()
  const home = join(tmpBase, 'steps-legacy')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({ script: `await agent('legacy')\nreturn 1`, parent: { id: 'sess-legacy' } })
  await runToDone({ id }, r)
  const dir = join(home, 'workflows', 'runs')
  // Reconstruct an old-style journal: inline the steps, drop the JSONL.
  const journal = JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8'))
  const steps = readFileSync(join(dir, id + '.steps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  journal.steps = steps
  writeFileSync(join(dir, id + '.json'), JSON.stringify(journal))
  rmSync(join(dir, id + '.steps.jsonl'), { force: true })
  rmSync(join(dir, id + '.summary.json'), { force: true })

  const r2 = makeRegistry(bundle.ctx, home)
  const rec = r2.get(id)
  assert.equal(rec.steps.length, steps.length, 'the inline steps are still read')
  // The read path must NOT have created a JSONL (list()/get() are read paths).
  assert.equal(existsSync(join(dir, id + '.steps.jsonl')), false, 'reading a legacy run does not migrate it')
  const listed = r2.list().find((x) => x.id === id)
  assert.equal(listed.stepCount, steps.length, 'list() counts the inline steps of a legacy run')
})

await check('resume continues a stopped run from cache', async () => {
  const bundle = makeCtx({ slow: true })
  const home = join(tmpBase, 'i')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({
    script: `
      const a = await agent('step-a')
      const b = await agent('step-b')
      return a + '|' + b
    `,
    parent: { id: 'sess-resume' },
  })
  await new Promise((res) => setTimeout(res, 10))
  await r.stop(id, 'halt')
  const stopped = await runToDone({ id }, r)
  assert.equal(stopped.status, 'stopped')
  const callsBefore = bundle.agentCalls()

  const res2 = await r.resume(id, { parent: { id: 'sess-resume' } })
  const rec2 = await runToDone(res2, r)
  assert.equal(rec2.status, 'completed')
  // 已完成的步骤命中缓存，只补跑剩下的
  const callsAfter = bundle.agentCalls()
  assert.ok(callsAfter - callsBefore <= 2, `expected at most 2 new calls, got ${callsAfter - callsBefore}`)
  assert.ok(res2.resumedFrom === id, 'resumedFrom set')
})

await check('list reports active runs', async () => {
  const bundle = makeCtx({ slow: true })
  const home = join(tmpBase, 'j')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({
    script: `await agent('long one'); return 1`,
    parent: { id: 'sess-list' },
  })
  await new Promise((res) => setTimeout(res, 5))
  const active = r.list()
  assert.ok(active.length >= 1, 'should list at least one active run')
  assert.ok(active.some((a) => a.id === id), 'the run we started should be listed')
  await runToDone({ id }, r)
})

await check('get returns journal log for live run', async () => {
  const home = join(tmpBase, 'k')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id } = await r.start({
    script: `
      log('starting')
      const a = await agent('logged')
      log('done')
      return a
    `,
    parent: { id: 'sess-log' },
  })
  const rec = await runToDone({ id }, r)
  assert.ok(Array.isArray(rec.log), 'log present')
  assert.ok(rec.log.some((l) => l.message === 'starting'), 'log has start entry')
  assert.ok(rec.log.some((l) => l.message === 'done'), 'log has done entry')
})

await check('traversal-shaped runIds read as absent, not as arbitrary files', async () => {
  const home = join(tmpBase, 'trav')
  // 在 runs 目录外放一个诱饵：无守卫时 `../../secret` 恰好读到它。
  mkdirSync(join(home, 'workflows', 'runs'), { recursive: true })
  writeFileSync(join(home, 'workflows', 'secret.json'), JSON.stringify({ id: 'stolen', script: 'stolen' }), 'utf8')
  const r = makeRegistry(ctxBundle.ctx, home)
  assert.equal(r.get('../../secret'), null, 'relative traversal must read as absent')
  assert.equal(r.get('..\\..\\secret'), null, 'backslash traversal must read as absent')
  assert.equal(r.get('C:\\tmp\\secret'), null, 'absolute path reset must read as absent')
  assert.equal(r.get('wf_1_abc/../../secret'), null, 'suffixed escape must read as absent')
  assert.equal(r.get(['proto', 'array']), null, 'non-string runId must read as absent')
  await assert.rejects(() => r.amend('../../secret', 'return 1'), /not found/, 'amend refuses traversal id')
  await assert.rejects(() => r.resume('..\\..\\secret'), /not found/, 'resume refuses traversal id')
})

await check('stop reaps an abort-ignoring script at the budget (abandoned, not hung); amend proceeds safely', async () => {
  const home = join(tmpBase, 'stop-hang')
  const r = makeRegistry(ctxBundle.ctx, home, { stopSettleTimeoutMs: 150 })
  const { id } = await r.start({
    // 永不观察取消信号：abort 传不进这个 await。
    script: `await new Promise(() => {})`,
    parent: { id: 'sess-hang' },
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const started = Date.now()
  const result = await r.stop(id, 'test')
  const elapsed = Date.now() - started
  assert.equal(result.stopped, true)
  assert.equal(result.abandoned, true, 'non-interruptible run reports abandoned instead of hanging stop')
  assert.ok(elapsed < 5000, `stop should return at the budget, took ${elapsed}ms`)
  // worker 时代：预算到点 terminate() 把不可抢占的脚本连 isolate 一起回收，
  // 僵尸句柄不复存在——记录落定为 stopped、journal 落盘。旧契约"amend 拒绝
  // 从未落定的 run"防的是"脚本可能仍在执行"；线程回收消灭了这个前提，改建
  // 现在可以安全继续（双跑防线移交给 hasDerivedActiveRun，见下面两例）。
  await new Promise((resolve) => setTimeout(resolve, 100))
  const rec = r.get(id)
  assert.equal(rec.status, 'stopped', `the reaped run settles as stopped, got ${rec.status}`)
  const res2 = await r.amend(id, 'return 1', { parent: { id: 'sess-hang' } })
  assert.ok(res2.id, 'amend proceeds once the abandoned run has been reaped')
  await r.join(res2.id)
})

await check('a second amend of the same journal is refused while the derived run is active', async () => {
  const home = join(tmpBase, 'amend-double-open')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id } = await r.start({
    script: `const a = await agent('one')\nconst b = await agent('two')\nreturn a + b`,
    parent: { id: 'sess-double' },
  })
  const res2 = await r.amend(id, `const a = await agent('one')\nconst b = await agent('changed')\nreturn a + b`, { parent: { id: 'sess-double' } })
  assert.ok(res2.id, 'first amend starts a derived run')
  await assert.rejects(
    () => r.amend(id, 'return 0', { parent: { id: 'sess-double' } }),
    /already has an active amended\/resumed run/,
    'the same journal cannot be amended again while a derived run is live',
  )
  await assert.rejects(
    () => r.resume(id),
    /already has an active amended\/resumed run/,
    'resume hits the same double-open guard',
  )
  await r.stop(res2.id, 'cleanup')
})

await check('two concurrent amends start exactly one derived run', async () => {
  const home = join(tmpBase, 'amend-race')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id } = await r.start({
    script: `const a = await agent('one')\nconst b = await agent('two')\nreturn a + b`,
    parent: { id: 'sess-race' },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  // 并发改键（不 await 第一份就发第二份）：互斥锁串行化后，第二份必须被
  // hasDerivedActiveRun 拒绝，而不是各起一份新运行。
  const results = await Promise.allSettled([
    r.amend(id, `const a = await agent('one')\nreturn a`, { parent: { id: 'sess-race' } }),
    r.amend(id, `const b = await agent('two')\nreturn b`, { parent: { id: 'sess-race' } }),
  ])
  const fulfilled = results.filter((entry) => entry.status === 'fulfilled' && entry.value.id)
  const rejected = results.filter((entry) => entry.status === 'rejected')
  assert.equal(fulfilled.length, 1, `exactly one amend starts a run, got ${fulfilled.length}`)
  assert.equal(rejected.length, 1, `the other amend is refused, got ${rejected.length}`)
  const derived = fulfilled[0].value.id
  await r.stop(derived, 'cleanup')
})

// ─── P4b：ask / answer 提问链路 ───────────────────────────────────────────────

// The settle-budget timer must be CLEARED when `handle.done` wins the race.
// Pre-fix every stop()/amend() of an instantly-settling run left a live Timeout
// referenced by the event loop for the whole budget: measured 12 leaked handles
// after 12 stop() calls, and a bare process kept its loop alive accordingly.
await check('stop() does not leak its settle-budget timer when the run settles first', async () => {
  const home = join(tmpBase, 'stop-timer')
  // A budget long enough that a leaked timer is unmistakably still pending.
  const r = makeRegistry(ctxBundle.ctx, home, { stopSettleTimeoutMs: 30_000 })
  const countTimers = () => process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length
  // Warm up so module-level timers are already accounted for.
  const warm = await r.start({ script: 'return 0', parent: { id: 'sess-timer' } })
  await r.stop(warm.id, 'warmup')
  const before = countTimers()
  for (let i = 0; i < 10; i += 1) {
    const { id } = await r.start({ script: 'return ' + i, parent: { id: 'sess-timer' } })
    await r.stop(id, 'test')
  }
  const after = countTimers()
  assert.ok(
    after - before <= 1,
    `stop() must not accumulate budget timers (was ${before}, now ${after} after 10 instant stops)`,
  )
})

// 挂起的问题不会自己出现：轮询到 pendingQuestion 落下来。
async function waitForQuestion(id, registry) {
  for (let i = 0; i < 200; i++) {
    const rec = registry.get(id)
    if (rec && rec.pendingQuestion) return rec
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`run ${id} never asked anything`)
}

await check('ask blocks until answered, answer is woven into the result', async () => {
  const bundle = makeCtx()
  const home = join(tmpBase, 'l')
  const r = makeRegistry(bundle.ctx, home)
  const { id } = await r.start({
    script: `
      const ans = await ask('what is 2+2')
      log('got: ' + ans)
      return 'answer was ' + ans
    `,
    parent: { id: 'sess-ask' },
  })
  const asking = await waitForQuestion(id, r)
  assert.equal(asking.pendingQuestion.text, 'what is 2+2')
  assert.ok(asking.log.some((l) => l.kind === 'question'), 'log records the question')

  const out = await r.answer(id, '4')
  assert.deepEqual(out, { answered: true })

  const rec = await runToDone({ id }, r)
  assert.equal(rec.status, 'completed')
  assert.equal(rec.result, 'answer was 4')
  assert.ok(rec.log.some((l) => l.kind === 'question-answered' && l.message === '4'), 'log records the answer')
  assert.equal(rec.pendingQuestion, null, 'question cleared after answering')
})

await check('answer on a run that is not asking is a harmless no-op', async () => {
  const home = join(tmpBase, 'm')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id } = await r.start({
    script: `return 'no questions here'`,
    parent: { id: 'sess-noask' },
  })
  const rec = await runToDone({ id }, r)
  assert.equal(rec.status, 'completed')
  // 已落定的 run 没有活句柄
  assert.deepEqual(r.answer(id, 'late'), { answered: false, error: 'run is not active (already settled, or not started in this process)' })
  // 未知的 id 也不该炸
  assert.deepEqual(r.answer('wf_nope', 'x'), { answered: false, error: 'run is not active (already settled, or not started in this process)' })
})

await check('stop while asking rejects the question and settles as stopped', async () => {
  const home = join(tmpBase, 'n')
  const r = makeRegistry(ctxBundle.ctx, home)
  const { id } = await r.start({
    script: `
      await ask('hangs forever')
      return 'unreachable'
    `,
    parent: { id: 'sess-ask-stop' },
  })
  await waitForQuestion(id, r)
  const outcome = await r.stop(id, 'cancelled')
  assert.equal(outcome.stopped, true)
  const rec = await runToDone({ id }, r)
  assert.equal(rec.status, 'stopped')
  assert.equal(rec.stopReason, 'cancelled')
  assert.notEqual(rec.result, 'unreachable')
})

// ─── 清理 ─────────────────────────────────────────────────────────────────────

rmSync(tmpBase, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-runs checks passed')
