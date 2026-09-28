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
 *      The tree walk is now a spawn, and a FAILED taskkill still falls back to
 *      the direct SIGKILL.
 *
 * Zero dependencies; runs real child processes; part of npm test.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

const { runCommandCaptured, DEFAULT_STDERR_TAIL_CHARS } = await import(new URL('../lib/run-command.js', import.meta.url).href)
const { killProcessTree } = await import(new URL('../lib/mcp-probe.js', import.meta.url).href)

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

await check('a timeout and a missing binary both resolve instead of throwing', async () => {
  const timedOut = await runCommandCaptured(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 300 })
  assert.equal(timedOut.code, null, 'a killed-by-timeout child resolves with a null code')
  const missing = await runCommandCaptured('definitely-not-a-real-binary-xyz', [])
  assert.equal(missing.failed, true, 'a spawn failure is reported as failed')
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

await check('a FAILED taskkill falls back to the direct SIGKILL', () => {
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
    spawned[0].emit('exit', 1)
    assert.deepEqual(kills, [{ pid: 777, signal: 'SIGKILL' }], 'a non-zero taskkill triggers the fallback')
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

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nverify-run-command OK: stream draining + non-blocking tree kill')
