#!/usr/bin/env node
/**
 * verify-run-command.mjs — the two process-management seams the review found:
 *
 *   1. `runCommandCaptured` (lib/run-command.js) drains BOTH streams. A child
 *      that writes more than the stderr pipe buffer while nobody reads it blocks
 *      in write(); `runGit` read stdout only, so a talkative git process waited
 *      out its whole timeout and the file-change dock showed nothing. The
 *      negative control below proves the trap is real (an unread stderr pipe
 *      leaves the child pending), so the drain is not ceremonial.
 *   2. `killProcessTree` (lib/mcp-probe.js) no longer blocks the host: it used
 *      `spawnSync('taskkill', …, { timeout: 5_000 })`, freezing the event loop
 *      for up to 5s exactly when a wedged process tree made the kill necessary.
 *      The tree walk is now a spawn, and only a taskkill that could not RUN
 *      at all falls back to the direct SIGKILL (a non-zero exit means the
 *      pid is already gone — the bare-kill fallback there was a recycled-pid
 *      stray-kill window).
 *
 * Zero dependencies; runs real child processes; part of npm test.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

const { runCommandCaptured, DEFAULT_STDERR_TAIL_CHARS } = await import(new URL('../lib/run-command.js', import.meta.url).href)
const { killProcessTree, killTreeAndAwaitDeath } = await import(new URL('../lib/mcp-probe.js', import.meta.url).href)

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

/** Wrap a promise so a hang FAILS this suite instead of blocking it forever. */
const withBudget = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms)),
])

/** A node one-liner that writes `bytes` to stderr, then `stdoutText` to stdout. */
const noisyChild = (bytes, stdoutText) => [
  '-e',
  `process.stderr.write('e'.repeat(${bytes})); process.stdout.write(${JSON.stringify(stdoutText)})`,
]

console.log('runCommandCaptured:')

await check('a child that floods stderr still completes (the pipe is drained)', async () => {
  // 300 KB is far past any pipe buffer: without a stderr reader this child
  // blocks in write() and the promise never settles.
  const outcome = await withBudget(
    runCommandCaptured(process.execPath, noisyChild(300_000, 'done'), { timeoutMs: 20_000 }),
    15_000,
    'the flooded child',
  )
  assert.equal(outcome.code, 0, 'clean exit')
  assert.equal(outcome.stdout, 'done', 'stdout survived intact')
  assert.ok(outcome.stderrTail.length > 0, 'the stderr tail is kept for diagnostics')
  assert.ok(
    outcome.stderrTail.length <= DEFAULT_STDERR_TAIL_CHARS,
    `the tail is bounded (got ${outcome.stderrTail.length})`,
  )
})

await check('negative control: an UNREAD stderr pipe really does stall the child', async () => {
  // The trap, reproduced with a raw spawn: stdout only, stderr piped and never
  // read. The child must still be running when the budget expires — if this ever
  // stops being true, the drain above is no longer load-bearing and this test
  // should be deleted rather than kept as folklore.
  const child = spawn(process.execPath, noisyChild(300_000, 'done'), { stdio: ['ignore', 'pipe', 'pipe'] })
  let closed = false
  child.on('close', () => { closed = true })
  child.stdout.on('data', () => {})
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  assert.equal(closed, false, 'the unread-stderr child is still blocked (pipe backpressure)')
  child.stderr.resume()   // unblock and clean up
  await withBudget(new Promise((resolve) => child.on('close', resolve)), 10_000, 'the unblocked child')
})

await check('stdout is capped, the exit code and the stderr tail are reported', async () => {
  const capped = await runCommandCaptured(process.execPath, ['-e', "process.stdout.write('x'.repeat(5000))"], { maxStdoutChars: 100 })
  assert.equal(capped.stdout.length, 100, 'stdout is bounded to the caller cap')
  const failing = await runCommandCaptured(process.execPath, ['-e', "process.stderr.write('boom: bad thing'); process.exit(3)"])
  assert.equal(failing.code, 3, 'a non-zero exit is reported, not thrown')
  assert.equal(failing.failed, false, 'a non-zero exit is a result, not a spawn failure')
  assert.match(failing.stderrTail, /boom: bad thing/, 'the reason is preserved for the caller')
})

await check('a multi-byte UTF-8 sequence split across stdout chunks survives intact', async () => {
  // '测' is E6 B5 8B. The child writes the FIRST TWO bytes, yields so the pipe
  // delivers them as their own chunk, then the tail: per-chunk toString() (the
  // old `text += chunk`) decoded the orphan partial sequence into U+FFFD
  // mojibake; StringDecoder holds it until the continuation arrives.
  const script = [
    "const out = process.stdout;",
    "out.write(Buffer.from([0xE6, 0xB5]));",
    "setTimeout(() => { out.write(Buffer.from([0x8B])); out.end('!'); }, 50);",
  ].join('\n')
  const outcome = await withBudget(
    runCommandCaptured(process.execPath, ['-e', script], { timeoutMs: 10_000 }),
    8_000,
    'the split-sequence child',
  )
  assert.equal(outcome.code, 0, 'clean exit')
  assert.equal(outcome.stdout, '测!', 'the split CJK sequence decodes as one character')
})

await check('a timeout and a missing binary both resolve instead of throwing', async () => {
  const timedOut = await runCommandCaptured(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 300 })
  assert.equal(timedOut.code, null, 'a killed-by-timeout child resolves with a null code')
  assert.equal(timedOut.timedOut, true, 'the kill is attributed: timedOut is true (used to resolve as failed:false)')
  const clean = await runCommandCaptured(process.execPath, ['-e', 'process.exit(0)'])
  assert.equal(clean.timedOut, false, 'a clean close reports timedOut: false')
  const missing = await runCommandCaptured('definitely-not-a-real-binary-xyz', [])
  assert.equal(missing.failed, true, 'a spawn failure is reported as failed')
  assert.equal(missing.timedOut, false, 'a spawn failure is not a timeout')
  assert.equal(missing.code, null)
})

console.log('killProcessTree:')

await check('the tree kill is non-blocking and never throws', () => {
  const calls = []
  const fakeSpawn = (command, argv, options) => {
    calls.push({ command, argv, options })
    const emitter = new EventEmitter()
    emitter.unref = () => {}
    return emitter
  }
  const kills = []
  const started = Date.now()
  killProcessTree(4242, { spawnFn: fakeSpawn, killFn: (pid, signal) => kills.push({ pid, signal }) })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 100, `the call returns immediately (took ${elapsed}ms)`)
  if (process.platform === 'win32') {
    assert.equal(calls.length, 1, 'taskkill was spawned')
    assert.equal(calls[0].command, 'taskkill')
    assert.deepEqual(calls[0].argv, ['/pid', '4242', '/T', '/F'], 'walks the whole tree, forced')
    assert.deepEqual(calls[0].options, { windowsHide: true, stdio: 'ignore' }, 'no stdio pipes to wedge on')
    assert.deepEqual(kills, [], 'a successful taskkill needs no fallback yet')
    calls[0].emitter?.emit?.('exit', 0)
  } else {
    assert.deepEqual(calls, [], 'no taskkill outside Windows')
    assert.deepEqual(kills, [{ pid: 4242, signal: 'SIGKILL' }], 'the direct kill is the POSIX path')
  }
})

await check('a taskkill that cannot RUN falls back to the direct SIGKILL; a non-zero exit does not', () => {
  const spawned = []
  const kills = []
  const fakeSpawn = () => {
    const emitter = new EventEmitter()
    emitter.unref = () => {}
    spawned.push(emitter)
    return emitter
  }
  killProcessTree(777, { spawnFn: fakeSpawn, killFn: (pid, signal) => kills.push({ pid, signal }) })
  if (process.platform === 'win32') {
    assert.deepEqual(kills, [], 'nothing direct until taskkill reports back')
    // taskkill RAN and exited non-zero = the pid is already gone (or belongs to
    // someone else): bare-killing here is the recycled-pid stray kill this path
    // must never produce, so the non-zero fallback is gone.
    spawned[0].emit('exit', 1)
    assert.deepEqual(kills, [], 'a non-zero taskkill means the tree is already gone — no bare kill')
    // taskkill could not RUN at all (spawn 'error', e.g. ENOENT): the bare kill
    // is the only lever left.
    spawned[0].emit('error', new Error('taskkill ENOENT'))
    assert.deepEqual(kills, [{ pid: 777, signal: 'SIGKILL' }], 'an unspawnable taskkill still falls back')
  } else {
    assert.deepEqual(kills, [{ pid: 777, signal: 'SIGKILL' }])
  }
})

await check('an invalid pid is a no-op (never a stray kill)', () => {
  const kills = []
  for (const bad of [0, -1, NaN, Infinity, '1234', null, undefined]) {
    killProcessTree(bad, { spawnFn: () => { throw new Error('must not spawn') }, killFn: (pid, signal) => kills.push({ pid, signal }) })
  }
  assert.deepEqual(kills, [], 'no kill was attempted for any invalid pid')
})

console.log('killTreeAndAwaitDeath:')

// runPnpm 的超时路径在清单还原 / 释放跨进程锁之前必须等进程树死透：垂死 pnpm
// 的网络解析若落在还原之后，快照还原被整体作废。这里用 killFn 接缝模拟三种
// 死亡时序（立即死 / 探测报活到预算放行 / 真 pid 死亡），预算封顶是上限而非
// 正确性依赖。
await check('resolves as soon as the death probe answers ESRCH (kill-then-await)', async () => {
  const calls = []
  /** 第一次是 kill 本身（SIGKILL），之后每次探测都报 ESRCH——已死。 */
  const killFn = (/** @type {number} */ pid, /** @type {number|string} */ signal) => {
    calls.push(signal)
    if (signal === 0) { const e = new Error('esrch'); e.code = 'ESRCH'; throw e }
  }
  const spawned = []
  const fakeSpawn = () => {
    const emitter = new EventEmitter()
    emitter.unref = () => {}
    spawned.push(emitter)
    return emitter
  }
  const started = Date.now()
  await withBudget(killTreeAndAwaitDeath(4242, { spawnFn: fakeSpawn, killFn, budgetMs: 5_000, pollMs: 5 }), 3_000, 'death await')
  assert.ok(Date.now() - started < 2_000, 'the await settles promptly on a confirmed death')
  if (process.platform === 'win32') {
    assert.equal(spawned.length, 1, 'taskkill was spawned before the probes')
    assert.ok(calls.includes(0), 'the death probes ran through the killFn seam')
  } else {
    assert.equal(calls[0], 'SIGKILL', 'the kill itself ran first on the POSIX path')
  }
})

await check('an alive-reading probe is bounded by the budget, then resolves anyway', async () => {
  const probes = []
  const killFn = (/** @type {number} */ pid, /** @type {number|string} */ signal) => {
    if (signal === 0) {
      probes.push(signal)
      // EPERM = 活着只是无权发信号——绝不能读成死亡。
      const e = new Error('eperm'); e.code = 'EPERM'; throw e
    }
  }
  const started = Date.now()
  await withBudget(killTreeAndAwaitDeath(4242, { spawnFn: () => { throw new Error('must not spawn on POSIX shape') }, killFn, budgetMs: 120, pollMs: 20 }), 3_000, 'budget ceiling')
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 100 && elapsed < 2_000, `the budget is a ceiling that actually bounds (took ${elapsed}ms, ${probes.length} probes)`)
})

await check('a real short-lived child is confirmed dead (or the budget releases the caller)', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  await withBudget(killTreeAndAwaitDeath(child.pid, { budgetMs: 2_000, pollMs: 10 }), 5_000, 'real child death')
})

await check('an invalid pid resolves immediately without killing', async () => {
  const started = Date.now()
  await killTreeAndAwaitDeath(undefined, { spawnFn: () => { throw new Error('must not spawn') } })
  assert.ok(Date.now() - started < 100, 'an invalid pid is a fast no-op')
})

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-run-command OK: stream draining + non-blocking tree kill')
