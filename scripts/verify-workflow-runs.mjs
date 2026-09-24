/**
 * verify-workflow-runs.mjs — P2 自检：状态机 / journal / step cache / amend / resume
 *
 * 跑法：node scripts/verify-workflow-runs.mjs
 *
 * 用最小 mock ctx（subagents + jobs + 可选 shell），真实写盘到临时目录。
 * 不依赖真实 dsh 宿主；宿主集成由 integration-check.mjs 覆盖。
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
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

await check('stop gives up waiting on an abort-ignoring script (abandoned, not hung); amend refuses', async () => {
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
  await assert.rejects(
    () => r.amend(id, 'return 1'),
    /did not settle/,
    'amend refuses a run that never settled (double-run guard)',
  )
})

// ─── P4b：ask / answer 提问链路 ───────────────────────────────────────────────

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
