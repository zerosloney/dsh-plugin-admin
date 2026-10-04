/**
 * verify-workflow-engine.mjs — P1 自检：转译 / 信号量 / realm 边界 / facade
 *
 * 跑法：node scripts/verify-workflow-engine.mjs
 * 全部断言通过打印 OK，任一失败非零退出。
 *
 * 不依赖真实 dsh 宿主：subagents / shell 用最小 mock，只校验引擎自身的调用约定
 * （参数归一化、并发上限、失败降级、sandbox 策略透传）与 **realm 边界**——后者三组
 * 断言各自对应一条曾经的缺陷：
 *   - `args` / facade 返回值 / rejection 里的宿主对象都不许进 realm（旧接线用同一个
 *     探针会打印 ESCAPED，见 CHANGELOG 的负样本记录）；
 *   - 宿主全局（process / fetch / require / import）不可达；
 *   - 首个 await 之前的**同步死循环**被 vm timeout 掐断（eval 与 run 两条入口），
 *     以及掐断之后宿主与 runner 都还能用。
 * 真实宿主集成由 integration-check.mjs 那一层覆盖。
 */

import assert from 'node:assert/strict'
import {
  compileScript,
  createSemaphore,
  stepFingerprint,
  createRunner,
  evalSnippet,
  looksLikeTs,
} from '../lib/workflow-engine.js'
import { jsonSafeValue } from '../lib/workflow-realm-shared.js'

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

// ─── 0. 跨 realm 值的安全化（jsonSafeValue）──────────────────────────────────
//
// 脚本产出的值要跨回宿主，`__proto__` 是唯一会让"赋值"变成别的事情的键：
// Object.prototype 上它是访问器，于是 `out[key] = v` 设置的是**原型**而不是
// 属性 —— 脚本写的键从结果里消失（静默丢数据），而宿主拿到的对象继承了脚本
// 放进去的东西。JSON.parse 会把 `__proto__` 建成自有属性，所以返回解析结果的
// 脚本能走到这里。
console.log('jsonSafeValue:')
check('a __proto__ key survives as ordinary data and injects no prototype', () => {
  const out = jsonSafeValue(JSON.parse('{"__proto__":{"isAdmin":true},"keep":1}'))
  assert.deepEqual(Object.keys(out).sort(), ['__proto__', 'keep'], 'the key is kept as data, not dropped')
  assert.equal(Object.prototype.hasOwnProperty.call(out, '__proto__'), true, 'it is an OWN property')
  assert.equal(Object.getPrototypeOf(out), Object.prototype, 'the result keeps its normal prototype')
  assert.equal(out.isAdmin, undefined, 'nothing the script wrote became inherited')
  assert.equal({}.isAdmin, undefined, 'Object.prototype is not polluted')
  // Round-trip as data. The expectation is built with defineProperty rather
  // than an object literal, because `{ __proto__: x }` in a literal sets the
  // PROTOTYPE — the very trap this fix is about.
  const expected = { keep: 1 }
  Object.defineProperty(expected, '__proto__', { value: { isAdmin: true }, enumerable: true, writable: true, configurable: true })
  assert.deepEqual(JSON.parse(JSON.stringify(out)), expected, 'it round-trips as data')
})
check('a null-prototype source works the same way', () => {
  const source = Object.create(null)
  source.__proto__ = { nested: true }
  source.plain = 2
  const out = jsonSafeValue(source)
  assert.deepEqual(Object.keys(out).sort(), ['__proto__', 'plain'], 'both keys preserved')
  assert.equal(Object.getPrototypeOf(out), Object.prototype, 'result is a normal object')
  assert.equal(out.nested, undefined, 'no inherited leak')
})
check('the surrounding safety contract still holds', () => {
  assert.throws(() => jsonSafeValue({ a: 1n }), /BigInt|bigint|not JSON-serializable/, 'BigInt throws')
  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(() => jsonSafeValue(cyclic), /circular/, 'a cycle throws')
  const shared = { x: 1 }
  assert.deepEqual(jsonSafeValue({ a: shared, b: shared }), { a: { x: 1 }, b: { x: 1 } }, 'a shared non-cyclic ref is not mistaken for a cycle')
  assert.equal(jsonSafeValue({ f: () => {}, u: undefined, n: 1 }).n, 1, 'functions/undefined are dropped, data kept')
})

// ─── 1. 转译 ──────────────────────────────────────────────────────────────────
console.log('compileScript:')
await checkAsync('strips TS types from valid script', async () => {
  const ts = `
    interface Out { name: string }
    const x: Out = { name: 'a' }
    return x.name
  `
  const { code, diagnostics } = await compileScript(ts)
  assert.equal(diagnostics.length, 0, 'no diagnostics')
  assert.ok(code, 'code produced')
  assert.ok(!/interface Out/.test(code), 'interface erased')
  assert.ok(/name/.test(code), 'runtime logic preserved')
})

await checkAsync('rejects broken TS with diagnostics', async () => {
  const broken = 'const x: { = 1'
  const { code, diagnostics } = await compileScript(broken)
  assert.equal(code, null, 'no code on error')
  assert.ok(diagnostics.length > 0, 'diagnostics reported')
  assert.equal(diagnostics[0].category, 'error')
})

await checkAsync('top-level return survives transpile (wrapped)', async () => {
  const { code, diagnostics } = await compileScript('return 1 + 2')
  assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics))
  assert.ok(code, 'code produced')
  assert.ok(!/export default/.test(code), 'no module wrapping')
  assert.ok(/function workflow_main/.test(code), 'named function declaration')
  // 实际执行验证返回值
  const value = await new Function(`${code}\nreturn workflow_main;`)()()
  assert.equal(value, 3)
})

// ─── 2. 信号量 ────────────────────────────────────────────────────────────────

console.log('createSemaphore:')
await checkAsync('respects concurrency limit', async () => {
  const sem = createSemaphore(2)
  let active = 0
  let peak = 0
  const thunk = async () => {
    active += 1; peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 20))
    active -= 1
  }
  await sem.runThunks(Array.from({ length: 6 }, () => thunk))
  assert.equal(peak, 2, `peak concurrency should be 2, got ${peak}`)
})

await checkAsync('parallel returns results in input order', async () => {
  const sem = createSemaphore(4)
  const results = await sem.runThunks([
    () => Promise.resolve('a'),
    () => Promise.resolve('b'),
    () => Promise.resolve('c'),
  ])
  assert.deepEqual(results, ['a', 'b', 'c'])
})

// ─── 3. 沙箱 + facade ────────────────────────────────────────────────────────

console.log('createRunner:')

function mockCtx({ agentResults = [], shellResult = null, sandboxMode = undefined, sandboxPolicy = undefined } = {}) {
  let agentCalls = 0
  let shellCalls = []
  let shellSpecs = []
  return {
    ctx: {
      get: (key) => {
        if (key === 'sandboxPolicy') return sandboxPolicy
        if (key === 'subagents') return {
          start: async (name, request) => {
            agentCalls += 1
            const result = agentResults[Math.min(agentCalls - 1, agentResults.length - 1)]
            return {
              result: Promise.resolve(result === undefined
                ? { stopReason: 'completed', output: [{ type: 'text', text: `agent#${agentCalls}` }] }
                : result),
              dispose: async () => {},
            }
          },
          _calls: () => agentCalls,
        }
        if (key === 'shell') return {
          // Undefined = a NON-confining executor (the default stub shape).
          sandboxMode,
          resolve: (request) => request,
          // The dsh ≥0.1.7 seam: execute(spec) → handle, handle.result() →
          // foreground result. The removed `run(spec)` verb is deliberately
          // absent so a regression fails here (see lib/workflow-engine.js).
          execute: async (spec) => {
            shellCalls.push(spec.command)
            shellSpecs.push(spec)
            const outcome = shellResult || {
              exitCode: 0, stdout: { text: `out:${spec.command}` }, stderr: { text: '' },
              timedOut: false, aborted: false,
            }
            return {
              result: async () => outcome,
              status: 'completed',
              kill: () => false,
              done: Promise.resolve(),
              readOutput: () => ({ delta: '', lossy: false }),
            }
          },
          _calls: () => shellCalls,
          _specs: () => shellSpecs,
        }
        return undefined
      },
    },
  }
}

await checkAsync('agent() returns text and counts steps', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const steps = []
  const { run } = createRunner({
    ctx, parent: {}, signal: controller.signal,
    semaphore: createSemaphore(2),
    onStep: (e) => { steps.push(e) },
  })
  const { code } = await compileScript(`return agent('hello')`)
  const value = await run(code, {})
  assert.equal(value, 'agent#1')
  // before + after 各一次
  assert.equal(steps.length, 2, `expected 2 step events, got ${steps.length}`)
  assert.equal(steps[0].phase, 'before')
  assert.equal(steps[1].phase, 'after')
})

await checkAsync('agent(prompt, {schema}) returns structured output', async () => {
  const { ctx } = mockCtx({
    agentResults: [{ stopReason: 'completed', structured: { name: 'x' }, output: [] }],
  })
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`return agent('get name', { schema: { type: 'object' } })`)
  const value = await run(code, {})
  assert.deepEqual(value, { name: 'x' })
})

await checkAsync('agent({prompt}) object form normalizes', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`return agent({ prompt: 'hi' })`)
  const value = await run(code, {})
  assert.equal(value, 'agent#1')
})

await checkAsync('failed agent degrades to null, run continues', async () => {
  const { ctx } = mockCtx({
    agentResults: [{ stopReason: 'error', diagnostic: 'boom', output: [] }],
  })
  const controller = new AbortController()
  const logs = []
  const { run } = createRunner({
    ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1),
    onLog: (e) => logs.push(e),
  })
  const { code } = await compileScript(`const a = await agent('will fail'); return a === null ? 'degraded' : 'no'`)
  const value = await run(code, {})
  assert.equal(value, 'degraded')
  assert.ok(logs.some((l) => l.kind === 'agent-incomplete' || l.kind === 'step-error'))
})

await checkAsync('parallel itself does NOT gate; the leaf agent() calls do (global bound, no self-wait deadlock)', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const sem = createSemaphore(2)
  // 1. Plain thunks run UNGATED in parallel: parallel() holding permits while
  //    its own leaves wait for them would be a self-deadlock, so the engine
  //    facade delegates all gating to the agent()/shell() leaves.
  let plainActive = 0; let plainPeak = 0
  const { facade } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: sem })
  const results = await facade.parallel(Array.from({ length: 5 }, (_, i) => async () => {
    plainActive += 1; plainPeak = Math.max(plainPeak, plainActive)
    await new Promise((r) => setTimeout(r, 10))
    plainActive -= 1
    return i
  }))
  assert.deepEqual(results, [0, 1, 2, 3, 4])
  assert.equal(plainPeak, 5, `parallel must not acquire the semaphore itself (peak 5, got ${plainPeak})`)
  // 2. The cross-run bound lives at the leaf: N concurrent agent() calls —
  //    here fanned out through parallel(), as a realm script would — cap at
  //    the shared semaphore. This is what makes max_concurrency real across
  //    runs (realm-side parallel has only its own per-run limiter).
  let agentActive = 0; let agentPeak = 0
  const probe = () => {
    agentActive += 1; agentPeak = Math.max(agentPeak, agentActive)
    return new Promise((r) => setTimeout(r, 10)).then(() => {
      agentActive -= 1
      return 'ok'
    })
  }
  const { facade: gatedFacade } = createRunner({
    ctx: (() => {
      const mock = mockCtx()
      // Wrap the stub's start so each in-flight agent call overlaps visibly.
      const originalGet = mock.ctx.get
      const subagents = originalGet.call(mock.ctx, 'subagents')
      mock.ctx.get = (key) => key === 'subagents'
        ? { start: async (...args) => { await probe(); return subagents.start(...args) } }
        : originalGet(key)
      return mock.ctx
    })(),
    parent: {},
    signal: controller.signal,
    semaphore: sem,
  })
  const agentResults = await gatedFacade.parallel(Array.from({ length: 5 }, () => async () => gatedFacade.agent('x')))
  assert.ok(agentResults.every((value) => typeof value === 'string' && value.startsWith('agent#')), 'every leaf call completed with its agent text')
  assert.equal(agentPeak, 2, `leaf calls must respect the shared semaphore (peak 2, got ${agentPeak})`)
})

await checkAsync('realm-side nested parallel cannot self-deadlock; the per-run limit gates the leaves (regression: permit-around-thunk hang)', async () => {
  const { ctx } = mockCtx()
  // Count the REAL overlap of the stubbed subagent starts.
  let active = 0; let leafPeak = 0
  const subagents = ctx.get('subagents')
  const originalGet = ctx.get
  ctx.get = (key) => key === 'subagents'
    ? { start: async (...args) => {
        active += 1; leafPeak = Math.max(leafPeak, active)
        try { return await subagents.start(...args) } finally { active -= 1 }
      } }
    : originalGet(key)
  const controller = new AbortController()
  const { run } = createRunner({
    ctx, parent: {}, signal: controller.signal,
    semaphore: createSemaphore(2),
    // The realm-side per-run leaf limit under test: 4 outer groups x nested
    // parallel is exactly the shape that used to hang forever when the
    // per-run permits wrapped the WHOLE thunk (the first `limit` outer thunks
    // held every permit; their nested parallel waited on them).
    semaphoreLimit: 2,
  })
  const { code } = await compileScript(`
    const groups = await parallel([
      () => parallel([() => agent('a1'), () => agent('a2')]),
      () => parallel([() => agent('b1'), () => agent('b2')]),
      () => parallel([() => agent('c1')]),
      () => parallel([() => agent('d1')]),
    ])
    return groups.flat().length
  `)
  // A budget turns the old behavior (permanent hang) into a decidable failure.
  let budget = null
  try {
    const value = await Promise.race([
      run(code, {}),
      new Promise((_, reject) => { budget = setTimeout(() => reject(new Error('nested parallel deadlocked (15s budget)')), 15_000) }),
    ])
    assert.equal(value, 6, 'every leaf step completed through the nested fan-out')
    assert.ok(leafPeak >= 1 && leafPeak <= 2, `leaf concurrency respected the per-run limit (peak ${leafPeak} <= 2)`)
  } finally {
    if (budget !== null) clearTimeout(budget)
  }
})

await checkAsync('pipeline stages chain and null short-circuits', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { facade } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(2) })
  const results = await facade.pipeline(
    ['a', 'b'],
    (x) => x + '1',
    async (x) => x + '2',
  )
  assert.deepEqual(results, ['a12', 'b12'])

  const nulled = await facade.pipeline(
    ['a'],
    () => null,
    (x) => x + '!',
  )
  assert.deepEqual(nulled, [null])
})

await checkAsync('shell() returns stdout and records command', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { facade } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const result = await facade.shell('echo hi')
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'out:echo hi')
})

await checkAsync('shell() throws on abort (propagates to script)', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { facade } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  controller.abort()
  await assert.rejects(() => facade.shell('echo hi'), /aborted/)
  await assert.rejects(() => facade.agent('x'), /aborted/)
})

await checkAsync('shell() carries the calling session sandbox policy into the spec', async () => {
  // A confining executor + ctx.sandboxPolicy: the spec must carry the policy
  // resolved from the RUN'S PARENT session. Without it the executor resolves
  // session-less and a session switched to read-only is silently ignored.
  const resolved = []
  const policy = { mode: 'read-only', workspaceRoot: '/ws' }
  const session = { header: { id: 's1', cwd: '/ws' } }
  const { ctx } = mockCtx({
    sandboxMode: 'read-only',
    sandboxPolicy: { resolve: (request) => { resolved.push(request); return policy } },
  })
  const controller = new AbortController()
  const { facade } = createRunner({ ctx, parent: { session }, signal: controller.signal, semaphore: createSemaphore(1) })
  await facade.shell('echo hi')
  assert.deepEqual(resolved, [{ session }], 'the parent session is what gets resolved')
  assert.deepEqual(ctx.get('shell')._specs().at(-1).sandboxPolicy, policy, 'the policy reaches the execution spec')
})

await checkAsync('a confining executor without ctx.sandboxPolicy refuses to run', async () => {
  const { ctx } = mockCtx({ sandboxMode: 'workspace-write' })   // no sandboxPolicy mounted
  const controller = new AbortController()
  const { facade } = createRunner({ ctx, parent: { session: { header: { cwd: '/ws' } } }, signal: controller.signal, semaphore: createSemaphore(1) })
  await assert.rejects(() => facade.shell('echo hi'), /'sandboxPolicy' service is missing/)
  assert.equal(ctx.get('shell')._calls().length, 0, 'the command never reaches the executor')
})

await checkAsync('a non-confining executor runs with no sandbox policy service', async () => {
  const { ctx } = mockCtx()   // sandboxMode undefined, no sandboxPolicy
  const controller = new AbortController()
  const { facade } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const result = await facade.shell('echo hi')
  assert.equal(result.exitCode, 0)
  assert.ok(!('sandboxPolicy' in ctx.get('shell')._specs().at(-1)), 'no policy field is fabricated for a non-confining executor')
})

await checkAsync('require / import are blocked in sandbox', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  await assert.rejects(() => compileScript(`return require('node:fs')`).then(({ code }) => run(code, {})), /require\(\) is not available/)
  await assert.rejects(() => compileScript(`return import_('node:fs')`).then(({ code }) => run(code, {})), /import\(\) is not available/)
})

await checkAsync('vm realm hides host globals (process/fetch unreachable, realm eval stays inside)', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`
    const realmEval = ({}).constructor.constructor
    // realm 内求值 return process：要么 undefined（未泄漏），要么直接抛
    // ReferenceError——唯一算失败的结果是拿到一个宿主对象。
    let escaped
    try { escaped = typeof realmEval('return process')() } catch { escaped = 'threw' }
    return {
      process: typeof process,
      fetch: typeof fetch,
      // require / import_ 是 FACADE_PARAMS 注入的 realm 内抛错桩（typeof 为
      // function 属预期）；「调用即抛」由上面的 block 用例覆盖。
      escaped,
    }
  `)
  const value = await run(code, {})
  assert.equal(value.process, 'undefined', 'process must be unreachable')
  assert.equal(value.fetch, 'undefined', 'fetch must be unreachable')
  assert.ok(value.escaped === 'undefined' || value.escaped === 'threw', `realm-Function escape probe must not reach host process (got ${value.escaped})`)
})

await checkAsync('no HOST object crosses into the realm (args / facade results / rejections)', async () => {
  // The escape this test pins (it was live until the JSON bridge landed): every
  // value the host hands the script used to keep its HOST prototype chain, so
  // `value.constructor.constructor('return process')()` returned the host
  // process in one step. Each probe below reports 'host:<pid>' if it wins.
  const { ctx } = mockCtx({ sandboxMode: undefined })
  const controller = new AbortController()
  const { run } = createRunner({
    ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1),
    onAsk: async () => 'answer',
  })
  const probe = (expr) => `
    let ${expr.id}
    try {
      const got = ${expr.value}
      ${expr.id} = (got === undefined || got === null) ? 'none' : typeof got.constructor?.constructor === 'function' ? 'HOST-PROTOTYPE' : 'ok'
      if (${expr.id} === 'HOST-PROTOTYPE') {
        try { ${expr.id} = (got.constructor.constructor('return process')() === undefined ? 'host:undefined' : 'ESCAPED') } catch { ${expr.id} = 'ok' }
      }
    } catch (error) { ${expr.id} = 'threw' }
  `
  const { code } = await compileScript([
    probe({ id: 'fromArgs', value: 'args' }),
    probe({ id: 'fromAgent', value: "await agent('x')" }),
    probe({ id: 'fromParallel', value: "await parallel([async () => 1])" }),
    probe({ id: 'fromPipeline', value: "await pipeline([1], async (x) => x)" }),
    probe({ id: 'fromShellError', value: "await shell('boom').then(() => 'no-error', (e) => e)" }),
    probe({ id: 'fromAsk', value: "await ask('q')" }),
    // The void members return nothing today; probing them keeps a future
    // member from silently starting to hand back a host object.
    probe({ id: 'fromLog', value: "await log('m')" }),
    probe({ id: 'fromPhase', value: "await phase('p')" }),
    probe({ id: 'fromReport', value: "await report('k', { a: 1 })" }),
    `return { fromArgs, fromAgent, fromParallel, fromPipeline, fromShellError, fromAsk, fromLog, fromPhase, fromReport }`,
  ].join('\n'))
  const value = await run(code, { nested: { deep: [1, 2, 3] } })
  for (const [key, got] of Object.entries(value)) {
    assert.notEqual(got, 'ESCAPED', `${key}: a HOST object reached the script and yielded the host process`)
    assert.notEqual(got, 'HOST-PROTOTYPE', `${key}: the value kept its host prototype chain`)
    assert.notEqual(got, 'threw', `${key}: the probe itself threw (the value was not usable at all)`)
  }
  // And the values are still USABLE (the bridge must not turn data into junk):
  // args keeps its shape, a structured agent() result stays a plain JSON value,
  // and a parallel() fan-out still returns its results in order.
  const { ctx: dataCtx } = mockCtx({
    agentResults: [{ stopReason: 'completed', structured: { deep: { list: [1, 2] } }, output: [] }],
  })
  const dataRunner = createRunner({ ctx: dataCtx, parent: {}, signal: new AbortController().signal, semaphore: createSemaphore(2) })
  const dataCode = await compileScript(`
    const structured = await agent('x')
    const fan = await parallel([async () => 7, async () => 'two'])
    return {
      n: args.nested.deep.length,
      deep: structured.deep.list[0],
      fan,
      proto: Object.getPrototypeOf(args) === Object.prototype,
    }
  `)
  const data = await dataRunner.run(dataCode.code, { nested: { deep: [1, 2, 3] } })
  assert.deepEqual(data, { n: 3, deep: 1, fan: [7, 'two'], proto: true }, 'args / agent() / parallel() results survive the JSON bridge as realm values')
})

await checkAsync('a synchronous infinite loop is cut off instead of freezing the host', async () => {
  // Before the timed invocation this test could not exist: `while(true){}` in
  // the sync prefix blocked the event loop, so neither the run-level abort nor
  // any setTimeout ever fired and the whole process hung.
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({
    ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1), syncTimeoutMs: 200,
  })
  const { code } = await compileScript(`const n = { value: 0 }; while (true) { n.value += 1 }`)
  const start = Date.now()
  await assert.rejects(() => run(code, {}), /synchronous code without reaching an await/)
  const elapsed = Date.now() - start
  assert.ok(elapsed < 5_000, `the budget must cut the loop near syncTimeoutMs, took ${elapsed}ms`)
  // The host is still alive and the runner still works afterwards.
  const after = await run(await compileScript(`return 'alive'`).then((c) => c.code), {})
  assert.equal(after, 'alive', 'the runner stays usable after a terminated script')
})

await checkAsync('dynamic import() does not reach host modules', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`return (await import('node:fs')).existsSync`)
  await assert.rejects(() => run(code, {}), /import/i)
})

await checkAsync('unserializable result rejects instead of poisoning persistence', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`const a = {}; a.self = a; return a`)
  await assert.rejects(() => run(code, {}), /JSON-serializable/)
})

await checkAsync('a SHARED but acyclic reference is not mistaken for a cycle', async () => {
  // The guard used to be a "visited" set instead of an ancestor stack, so any
  // DAG-shaped result (`{ p: x, q: x }`) was reported as a circular reference and
  // the run errored — a false positive on perfectly JSON-serializable data. The
  // real cycle case above must keep failing.
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`
    const shared = { a: 1 }
    const wrapper = { inner: shared, again: shared }
    return { p: wrapper, q: shared, list: [shared, shared] }
  `)
  const value = await run(code, {})
  assert.deepEqual(value, {
    p: { inner: { a: 1 }, again: { a: 1 } },
    q: { a: 1 },
    list: [{ a: 1 }, { a: 1 }],
  }, 'each occurrence is copied, and no occurrence is read as a cycle')
})

await checkAsync('result crosses the realm as a plain host object', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`return { nested: { ok: true, miss: undefined }, list: [1, 'two'] }`)
  const value = await run(code, {})
  assert.deepEqual(value, { nested: { ok: true }, list: [1, 'two'] })
  assert.equal(Object.getPrototypeOf(value), Object.prototype, 'must be a host plain object, not a realm object')
})

await checkAsync('report() degrades unserializable values but the run continues', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const logs = []
  const { run } = createRunner({
    ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1),
    onLog: (e) => logs.push(e),
  })
  const { code } = await compileScript(`const a = {}; a.self = a; report('boom', a); return 'done'`)
  const value = await run(code, {})
  assert.equal(value, 'done', 'unserializable report must not kill the run')
  const entry = logs.find((l) => l.kind === 'report' && l.key === 'boom')
  assert.ok(entry, 'report entry logged')
  assert.match(String(entry.value), /unserializable report value/)
})

await checkAsync('args are passed through', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`return args.prefix + args.name`)
  const value = await run(code, { prefix: 'hi-', name: 'there' })
  assert.equal(value, 'hi-there')
})

await checkAsync('onStep cache hook short-circuits the call', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { facade } = createRunner({
    ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1),
    onStep: (e) => {
      if (e.phase === 'before' && e.kind === 'agent') return { cached: true, value: 'cached!' }
      return undefined
    },
  })
  const value = await facade.agent('anything')
  assert.equal(value, 'cached!')
  // The engine deliberately keeps NO cache of its own: the hit is recorded by the
  // upper layer (workflow-runs), which owns the journal.
})

await checkAsync('onStep non-cache return is ignored', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { facade } = createRunner({
    ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1),
    onStep: () => undefined, // 返回 undefined 必须视为「无缓存」
  })
  const value = await facade.agent('anything')
  assert.equal(value, 'agent#1')
})

await checkAsync('TS script end-to-end through run()', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const { run } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(2) })
  const ts = `
    interface Item { name: string }
    const items: Item[] = [{ name: 'a' }, { name: 'b' }]
    const names = await parallel(items.map((i) => () => agent('name of ' + i.name)))
    return names.join(',')
  `
  const { code, diagnostics } = await compileScript(ts)
  assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics))
  const value = await run(code, {})
  assert.equal(value, 'agent#1,agent#2')
})

// ─── 4. 指纹 ─────────────────────────────────────────────────────────────────

console.log('stepFingerprint:')
check('same call site + payload => same key', () => {
  assert.equal(stepFingerprint(1, 'agent', 'p'), stepFingerprint(1, 'agent', 'p'))
})
check('different payload => different key', () => {
  assert.notEqual(stepFingerprint(1, 'agent', 'p'), stepFingerprint(1, 'agent', 'q'))
})
check('different site => different key', () => {
  assert.notEqual(stepFingerprint(1, 'agent', 'p'), stepFingerprint(2, 'agent', 'p'))
})
// The cache key covers the opts that change WHAT a step produces. Without them
// an amend that only swapped the model would replay the previous model's result
// and call it a cache hit — a wrong value, not a saved call.
check('semantic opts are part of the key (a different model must not hit the old cache)', () => {
  assert.notEqual(stepFingerprint(1, 'agent', 'p', { provider: 'a' }), stepFingerprint(1, 'agent', 'p', { provider: 'b' }))
  assert.notEqual(stepFingerprint(1, 'agent', 'p'), stepFingerprint(1, 'agent', 'p', { model: 'm' }))
  assert.notEqual(stepFingerprint(1, 'agent', 'p', { schema: { type: 'object' } }), stepFingerprint(1, 'agent', 'p'))
  assert.notEqual(stepFingerprint(1, 'shell', 'ls', { workdir: '/a' }), stepFingerprint(1, 'shell', 'ls', { workdir: '/b' }))
  assert.notEqual(stepFingerprint(1, 'shell', 'ls', { timeoutMs: 1000 }), stepFingerprint(1, 'shell', 'ls', { timeoutMs: 2000 }))
})
check('equivalent opts keep one key (order-insensitive, display fields ignored)', () => {
  // Key order must not decide a cache hit: the same schema written two ways is
  // the same call.
  assert.equal(
    stepFingerprint(1, 'agent', 'p', { provider: 'a', model: 'm', schema: { b: 1, a: [1, 2] } }),
    stepFingerprint(1, 'agent', 'p', { schema: { a: [1, 2], b: 1 }, model: 'm', provider: 'a' }),
  )
  // A label / unknown key is presentation, not semantics: renaming a step must
  // not re-spend a subagent call.
  assert.equal(stepFingerprint(1, 'agent', 'p', { label: 'x' }), stepFingerprint(1, 'agent', 'p'))
  assert.equal(stepFingerprint(1, 'agent', 'p', {}), stepFingerprint(1, 'agent', 'p'))
  // An omitted field and an explicit null are the same absence (the panel sends
  // null for "not chosen").
  assert.equal(stepFingerprint(1, 'agent', 'p', { provider: null }), stepFingerprint(1, 'agent', 'p'))
})
check('a non-object / bigint-bearing opts value still yields a key (never throws)', () => {
  assert.doesNotThrow(() => stepFingerprint(1, 'shell', 'ls', 'nonsense'))
  assert.equal(stepFingerprint(1, 'shell', 'ls', 'nonsense'), stepFingerprint(1, 'shell', 'ls'))
  assert.doesNotThrow(() => stepFingerprint(1, 'shell', 'ls', { timeoutMs: 10n }))
})
// `cwd` changes what a subagent call can see, so a script amended from one
// directory to another must not serve the first directory's cached result.
check('agent cwd is part of the key (a different working directory must not hit the old cache)', () => {
  assert.notEqual(stepFingerprint(1, 'agent', 'p', { cwd: '/a' }), stepFingerprint(1, 'agent', 'p', { cwd: '/b' }))
  assert.notEqual(stepFingerprint(1, 'agent', 'p', { cwd: '/a' }), stepFingerprint(1, 'agent', 'p'))
})
// The material used to be `payload + '\u0000' + field=value` joined into one
// string, which relies on a delimiter no component can contain. Canonicalized
// values are JSON-quoted (so a NUL becomes the six characters `\u0000`), but the
// PAYLOAD is a raw script-supplied string and can carry a real NUL — so the
// boundary was guaranteed only by the payload happening not to forge one. The
// array form makes the delimiter structural, which is a property of the code
// rather than of the inputs. These pairs must stay distinct either way.
check('the parts are structurally delimited (a payload cannot forge an opts boundary)', () => {
  assert.notEqual(
    stepFingerprint(1, 'agent', 'x\u0000provider=openai'),
    stepFingerprint(1, 'agent', 'x', { provider: 'openai' }),
  )
  assert.notEqual(
    stepFingerprint(1, 'agent', 'x', { provider: 'a', model: 'b' }),
    stepFingerprint(1, 'agent', 'x', { provider: 'a\u0000model=b' }),
  )
  // A canonicalized value can never carry a raw NUL, which is what kept the old
  // concatenation unambiguous in practice.
  assert.equal(stepFingerprint(1, 'shell', 'ls', { workdir: 'a\u0000b' }), stepFingerprint(1, 'shell', 'ls', { workdir: 'a\u0000b' }))
})
// 64 bits of SHA-256 was an unnecessary collision surface for a value that is
// never shown to a human.
check('the fingerprint carries the full 256-bit digest, not a truncation', () => {
  const hex = stepFingerprint(1, 'agent', 'p').split(':')[2]
  assert.equal(hex.length, 64, 'full sha256 hex (got ' + hex.length + ')')
  assert.match(hex, /^[0-9a-f]{64}$/)
})

// ─── 5. evalSnippet ──────────────────────────────────────────────────────────

console.log('evalSnippet:')
await checkAsync('runs a script with stubbed agents and returns its value', async () => {
  const value = await evalSnippet(`
    const a = await agent('one')
    const b = await agent('two')
    return a + '|' + b
  `)
  assert.equal(value, '[[workflow eval: agent stub]]|[[workflow eval: agent stub]]')
})

await checkAsync('honors a custom stub string', async () => {
  const value = await evalSnippet(`return await agent('x')`, { stub: 'STUB' })
  assert.equal(value, 'STUB')
})

await checkAsync('args are passed into the script', async () => {
  const value = await evalSnippet(`return args.n * 2`, { args: { n: 21 } })
  assert.equal(value, 42)
})

await checkAsync('compile failure throws with diagnostics', async () => {
  await assert.rejects(
    () => evalSnippet(`const a: = 1`),
    (err) => err.diagnostics && err.diagnostics.length > 0,
  )
})

await checkAsync('ask is unavailable in eval mode', async () => {
  await assert.rejects(
    () => evalSnippet(`await ask('nope')`),
    /ask\(\) is unavailable in this execution mode/,
  )
})

await checkAsync('a hung script is cut off by the timeout', async () => {
  const start = Date.now()
  await assert.rejects(
    () => evalSnippet(`await new Promise(() => {})`, { timeoutMs: 150 }),
  )
  const elapsed = Date.now() - start
  assert.ok(elapsed < 2000, `timeout should fire near timeoutMs, took ${elapsed}ms`)
})

await checkAsync('a SYNCHRONOUS infinite loop is cut off in eval too', async () => {
  // 脚本跑在 worker 线程里，主线程的事件循环始终自由：worker 内的 vm 预算与
  // eval 的硬超时定时器**都能**醒来（修复前主线程被同步死循环冻住，race 根本
  // 到不了——现在两者竞争，谁先到都算过，重点是快速拒绝而不是冻结宿主进程）。
  const start = Date.now()
  await assert.rejects(
    () => evalSnippet(`while (true) {}`, { timeoutMs: 150 }),
    /synchronous code without reaching an await|eval timeout after 150ms/,
  )
  const elapsed = Date.now() - start
  assert.ok(elapsed < 2000, `the budget should cut the loop near timeoutMs, took ${elapsed}ms`)
  // The process is still healthy: a normal eval runs right after.
  assert.equal(await evalSnippet(`return 1 + 1`, { timeoutMs: 1000 }), 2)
})

await checkAsync('a MICROTASK spin loop cannot freeze the host — eval timeout still lands', async () => {
  // S1 回归钉：`while (true) { await 0 }` 在首个 await 后靠微任务自续，微任务
  // 队列永不清空，共享该循环的一切定时器都会饿死。脚本现在跑在 worker 线程里，
  // 主线程的硬超时照常醒来并 terminate 掉卡死的 isolate——修复前这条用例会把
  // 整个测试进程永久挂死。
  const start = Date.now()
  await assert.rejects(
    () => evalSnippet(`while (true) { await 0 }`, { timeoutMs: 150 }),
    (err) => /eval timeout after 150ms|synchronous code/.test(String(err && err.message || err)),
  )
  const elapsed = Date.now() - start
  assert.ok(elapsed < 2000, `timeout should fire near timeoutMs, took ${elapsed}ms`)
  assert.equal(await evalSnippet(`return 'alive'`, { timeoutMs: 1000 }), 'alive')
})

await checkAsync('a MICROTASK spin loop in run() is reclaimed by terminate()', async () => {
  // 引擎级同钉：run() 的微任务自旋脚本只冻住 worker；terminate() 让 run 以
  // 错误落定，主线程全程存活、runner 可继续使用。
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const runner = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1) })
  const { code } = await compileScript(`while (true) { await 0 }`)
  const start = Date.now()
  const pending = runner.run(code, {})
  setTimeout(() => runner.terminate(), 300)
  await assert.rejects(() => pending, /exited before the script settled/)
  const elapsed = Date.now() - start
  assert.ok(elapsed < 5000, `terminate should reclaim the spinning worker quickly, took ${elapsed}ms`)
  const after = await runner.run(await compileScript(`return 'alive'`).then((c) => c.code), {})
  assert.equal(after, 'alive', 'the runner stays usable after a terminated script')
})

await checkAsync('caller abort cuts eval well before the hard timeout', async () => {
  const controller = new AbortController()
  const start = Date.now()
  setTimeout(() => controller.abort('test'), 80)
  await assert.rejects(
    () => evalSnippet(`await new Promise(() => {})`, { timeoutMs: 10_000, signal: controller.signal }),
    /eval aborted/,
  )
  const elapsed = Date.now() - start
  assert.ok(elapsed < 5000, `caller abort should cut eval promptly, took ${elapsed}ms`)
})

// The 80ms case above only passes when the abort happens to land AFTER the
// abort listener is attached. The listener is attached after
// `await compileScript(...)`, so on a loaded machine (cold esbuild, busy event
// loop) the abort can arrive DURING that window and the signal is then
// already-cancelled — the race would never fire and only the hard timeout
// settled it. That was a real gate flake (seen once: an assertion expecting
// /eval aborted/ got `eval timeout after 10000ms`). A pre-aborted signal is
// the deterministic form of that window: it must reject at once, with the
// abort reason, never with the timeout.
await checkAsync('a pre-aborted caller signal rejects immediately, never waits for the timeout', async () => {
  const controller = new AbortController()
  controller.abort('test')
  const start = Date.now()
  await assert.rejects(
    () => evalSnippet(`await new Promise(() => {})`, { timeoutMs: 3000, signal: controller.signal }),
    /eval aborted/,
  )
  const elapsed = Date.now() - start
  assert.ok(elapsed < 1500, `a pre-aborted signal must not wait for the hard timeout, took ${elapsed}ms`)
})

check('looksLikeTs gates the esbuild-missing fallback (TS refused, plain JS wrapped)', () => {
  // compileScript's catch branch cannot be reached in a process that HAS esbuild
  // installed, so the heuristic that decides "refuse vs wrap" is pinned directly:
  // a false negative would hand TypeScript to new Function() and surface a
  // syntax error with no diagnostic.
  for (const ts of [
    'interface Job { id: string }',
    'type Args = { name: string }',
    'enum Mode { A, B }',
    'class X implements Runner {}',
    'const n: number = 1',
    'return await agent<Result>("x")',
    'const rows: Row[] = []',
  ]) {
    assert.equal(looksLikeTs(ts), true, 'TypeScript-looking: ' + JSON.stringify(ts))
  }
  for (const js of [
    'return await agent("audit")',
    'const rows = await parallel(items.map((i) => () => agent("x" + i)))',
    'await shell("ls -la")',
    'phase("collect")',
    'report("done", { total: 3 })',
    'const args = { name: "x" }',
    'if (a < b && c > d) return 1',
    'const bigger = a < B > c',
  ]) {
    assert.equal(looksLikeTs(js), false, 'plain JS: ' + JSON.stringify(js))
  }
  // Known false positives of the text heuristic (it parses no comments/strings).
  // They only ever fail LOUD — and only in the degraded no-esbuild mode, where
  // the remedy is installing the peer — so the conservative direction is kept.
  for (const falsePositive of [
    '// a comment mentioning interface Foo',
    'const msg = "type Args = { a: string }"',
  ]) {
    assert.equal(looksLikeTs(falsePositive), true, 'known false positive: ' + JSON.stringify(falsePositive))
  }
})

// ─── 结果 ─────────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-engine checks passed')
