/**
 * verify-workflow-engine.mjs — P1 自检：转译 / 信号量 / 沙箱 / facade
 *
 * 跑法：node scripts/verify-workflow-engine.mjs
 * 全部断言通过打印 OK，任一失败非零退出。
 *
 * 不依赖真实 dsh 宿主：subagents / shell 用最小 mock，只校验引擎自身的
 * 调用约定（参数归一化、并发上限、失败降级、沙箱隔离），真实宿主集成
 * 由 integration-check.mjs 那一层覆盖。
 */

import assert from 'node:assert/strict'
import {
  compileScript,
  createSemaphore,
  stepFingerprint,
  createRunner,
  evalSnippet,
} from '../lib/workflow-engine.js'

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

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

function mockCtx({ agentResults = [], shellResult = null } = {}) {
  let agentCalls = 0
  let shellCalls = []
  return {
    ctx: {
      get: (key) => {
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
          resolve: (request) => request,
          run: async (spec) => {
            shellCalls.push(spec.command)
            return shellResult || {
              exitCode: 0, stdout: { text: `out:${spec.command}` }, stderr: { text: '' },
              timedOut: false, aborted: false,
            }
          },
          _calls: () => shellCalls,
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

await checkAsync('parallel fan-out respects semaphore', async () => {
  const { ctx } = mockCtx()
  const controller = new AbortController()
  const sem = createSemaphore(3)
  let active = 0; let peak = 0
  const { facade } = createRunner({ ctx, parent: {}, signal: controller.signal, semaphore: sem })
  const results = await facade.parallel(Array.from({ length: 5 }, (_, i) => async () => {
    active += 1; peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 10))
    active -= 1
    return i
  }))
  assert.deepEqual(results, [0, 1, 2, 3, 4])
  assert.equal(peak, 3, `peak should be 3, got ${peak}`)
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
  const { facade, stepCache } = createRunner({
    ctx, parent: {}, signal: controller.signal, semaphore: createSemaphore(1),
    onStep: (e) => {
      if (e.phase === 'before' && e.kind === 'agent') return { cached: true, value: 'cached!' }
      return undefined
    },
  })
  const value = await facade.agent('anything')
  assert.equal(value, 'cached!')
  assert.equal(stepCache.size, 0) // 引擎自己不记缓存，命中记录在上层 runs
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

// ─── 结果 ─────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-engine checks passed')
