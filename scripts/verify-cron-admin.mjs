/**
 * Self-check for the 定时任务 feature (lib/cron-admin.js):
 *
 * Pure functions:
 * - parseCron: wildcard, steps, ranges, lists, aliases (SUN-SAT / JAN-DEC),
 *   7→0 Sunday normalization, out-of-range and field-count rejection.
 * - nextOccurrence: minute rollover, day/month/hour/minute backfill,
 *   dom/dow POSIX OR-when-both-restricted semantics, impossible-expression
 *   null (Feb 31), leap-year Feb 29.
 *
 * Service (applyCronAdmin against a fake ctx + temp DSH_HOME):
 * - upsert/list round-trip; invalid cron and duplicate id rejected
 * - remove, unknown-id rejection
 * - toggle flips enabled and re-arms
 * - runNow fires the action immediately through the same pipeline as a
 *   scheduled fire (steer path against a fake agents service)
 * - create mode records the clear "runtime missing" failure instead of a
 *   false success
 * - storage file is valid JSON and survives reload
 *
 * Scheduler: a task armed with a one-minute cron fires and records history.
 *
 * Timer-cap clamp: a sparse schedule (> Node's ~24.8-day setTimeout ceiling)
 * wakes early via isDueForFire's guard — the action must NOT execute and the
 * task must re-arm; 「立即触发」 still fires through the same pipeline.
 *
 * Run: node scripts/verify-cron-admin.mjs
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const { applyCronAdmin, cronInvocations, parseCron, nextOccurrence, validateTaskEntry, isDueForFire } =
  await import(new URL('../lib/cron-admin.js', import.meta.url).href)

let failures = 0
let checks = 0
/** Serial chain: every check runs only after the previous one settles, so
 *  async checks cannot interleave and reorder each other's state. */
let chain = Promise.resolve()

/**
 * Run one assertion group, printing the label on failure. Async bodies are
 * awaited — in order — before teardown via the chain.
 * @param {string} label - what is being checked.
 * @param {Function} body - throws on failure; may be async.
 */
function check(label, body) {
  checks += 1
  const fail = (error) => {
    failures += 1
    console.error(`✗ ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
  // The body is AWAITED here on purpose: a rejected async body used to leave
  // `chain` rejected and its error was only picked up by the NEXT link's `fail`.
  // A check registered last therefore failed silently — `settle()` swallowed the
  // rejection and the run still reported success (found by falsifying the
  // cross-process check below: removing the store lock kept every assertion
  // failing yet the script exited 0).
  chain = chain.then(async () => {
    try {
      await body()
    } catch (error) {
      fail(error)
    }
  }, fail)
}

/** Await every queued check before tearing down shared fixtures. */
function settle() {
  return chain.then(() => {}, () => {})
}

/** A fixed local-time moment for deterministic nextOccurrence assertions. */
const FIXED_NOW = Date.parse('2026-09-21T10:00:00.000Z')
/** Same moment as a local Date string fragment for printing. */

/* ========================================================================== */
/*                              parseCron                                     */
/* ========================================================================== */

check('parseCron wildcard expands every field', () => {
  const f = parseCron('* * * * *')
  assert.equal(f.minute.size, 60)
  assert.equal(f.hour.size, 24)
  assert.equal(f.dom.size, 31)
  assert.equal(f.month.size, 12)
  assert.equal(f.dow.size, 7)          // 0..6 after 7→0 normalization
  assert.ok(f.minute.has(0) && f.minute.has(59))
  assert.ok(f.dow.has(0) && !f.dow.has(7))
})

check('parseCron step */5 picks 0,5,…,55', () => {
  const f = parseCron('*/5 * * * *')
  assert.deepEqual([...f.minute].sort((a, b) => a - b), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
})

check('parseCron range + list + alias', () => {
  const f = parseCron('0,30 9-17 * JAN-DEC MON-FRI')
  assert.deepEqual([...f.minute].sort((a, b) => a - b), [0, 30])
  assert.equal(f.hour.size, 9)
  assert.ok(f.hour.has(9) && f.hour.has(17) && !f.hour.has(8) && !f.hour.has(18))
  assert.equal(f.month.size, 12)
  assert.ok(f.dow.has(1) && f.dow.has(5) && !f.dow.has(0) && !f.dow.has(6))
})

check('parseCron normalizes Sunday as 0 or 7', () => {
  assert.deepEqual([...parseCron('* * * * 0').dow].sort((a, b) => a - b), [0])
  assert.deepEqual([...parseCron('* * * * 7').dow].sort((a, b) => a - b), [0])
  assert.deepEqual([...parseCron('* * * * SUN').dow].sort((a, b) => a - b), [0])
})

check('parseCron rejects malformed input', () => {
  for (const bad of ['', '   ', '* * * *', '* * * * * *', '60 * * * *', '* 25 * * *', '* * 32 * *', '* * * 13 *', '* * * * 8', 'a b c d e', '* * * * *x', '1-5/0 * * * *']) {
    assert.throws(() => parseCron(bad), Error, `expected rejection of ${JSON.stringify(bad)}`)
  }
})

/* ========================================================================== */
/*                            nextOccurrence                                  */
/* ========================================================================== */

check('nextOccurrence advances to the next minute boundary', () => {
  const at = nextOccurrence(parseCron('* * * * *'), FIXED_NOW)
  assert.equal(at, FIXED_NOW + 60_000)
})

check('nextOccurrence backfills minute then hour', () => {
  // 30 9 * * * from 10:00 → tomorrow 09:30
  const at = nextOccurrence(parseCron('30 9 * * *'), FIXED_NOW)
  const d = new Date(at)
  assert.equal(d.getMinutes(), 30)
  assert.equal(d.getHours(), 9)
  assert.ok(at > FIXED_NOW)
})

check('nextOccurrence handles month rollover', () => {
  // 0 0 1 * * from Sep 21 → Oct 1 00:00
  const at = nextOccurrence(parseCron('0 0 1 * *'), FIXED_NOW)
  const d = new Date(at)
  assert.equal(d.getMonth(), 9)   // October (0-based)
  assert.equal(d.getDate(), 1)
  assert.equal(d.getHours(), 0)
})

check('nextOccurrence POSIX day semantics: OR when both restricted', () => {
  // 0 0 13 * 5 — both dom and dow restricted: fires on the 13th OR any Friday,
  // whichever comes first after Sep 21 2026 (a Monday). Sep 25 is Friday.
  const at = nextOccurrence(parseCron('0 0 13 * 5'), FIXED_NOW)
  const d = new Date(at)
  assert.equal(d.getDate(), 25)
  assert.equal(d.getDay(), 5)
})

check('nextOccurrence AND semantics when only one day field restricted', () => {
  // 0 0 13 * * — dom restricted, dow wildcard: only the 13th matches.
  const at = nextOccurrence(parseCron('0 0 13 * *'), FIXED_NOW)
  assert.equal(new Date(at).getDate(), 13)
})

check('nextOccurrence returns null for impossible expressions', () => {
  // Feb 31 never exists.
  assert.equal(nextOccurrence(parseCron('0 0 31 2 *'), FIXED_NOW), null)
})

check('nextOccurrence finds Feb 29 in a leap year', () => {
  // 0 0 29 2 * — from Sep 2026 the next Feb 29 is 2028 (2027 is not leap).
  const at = nextOccurrence(parseCron('0 0 29 2 *'), FIXED_NOW)
  assert.notEqual(at, null)
  const d = new Date(at)
  assert.equal(d.getMonth(), 1)
  assert.equal(d.getDate(), 29)
  assert.equal(d.getFullYear(), 2028)
})

/* ========================================================================== */
/*                            validateTaskEntry                               */
/* ========================================================================== */

const validSteer = () => ({
  id: 'nightly-report',
  enabled: true,
  cron: '0 9 * * *',
  action: { mode: 'steer', sessionId: 'session-live' },
  promptTemplate: '定时任务「$RULE」触发：$EVENT',
})

check('validateTaskEntry accepts a minimal steer task', () => {
  const t = validateTaskEntry(validSteer(), [])
  assert.equal(t.id, 'nightly-report')
  assert.equal(t.enabled, true)
  assert.equal(t.cron, '0 9 * * *')
  assert.equal(t.action.mode, 'steer')
  assert.equal(t.action.sessionId, 'session-live')
  assert.ok(!('secret' in t), 'webhook-only secret field must not persist on tasks')
})

check('validateTaskEntry rejects bad ids, dupes, and impossible cron', () => {
  assert.throws(() => validateTaskEntry({ ...validSteer(), id: 'Bad-Id' }, []), /id/)
  assert.throws(() => validateTaskEntry(validSteer(), ['nightly-report']), /占用/)
  assert.throws(() => validateTaskEntry({ ...validSteer(), cron: '0 0 31 2 *' }, []), /cron/)
  assert.throws(() => validateTaskEntry({ ...validSteer(), cron: 'not a cron' }, []), /cron/)
  assert.throws(() => validateTaskEntry({ ...validSteer(), action: { mode: 'nope' } }, []), /mode/)
  assert.throws(() => validateTaskEntry({ ...validSteer(), action: { mode: 'steer' } }, []), /sessionId/)
})

/* ========================================================================== */
/*                          Service (fake ctx + temp home)                     */
/* ========================================================================== */

// A temp DSH_HOME so the storage file never touches the real one.
const fakeHome = mkdtempSync(join(tmpdir(), 'cron-admin-'))
const storagePath = join(fakeHome, 'cron-tasks.json')
try {
  // Fake agents service: one live session recording steered messages.
  const steered = []
  const fakeAgents = {
    get: (id) => (id === 'session-live'
      ? { steer: (m) => steered.push({ id, msg: m }), followup: (m) => steered.push({ id, msg: m, followup: true }) }
      : undefined),
    list: () => [{ id: 'session-live' }],
  }

  const teardownDisposers = []
  const ctx = {
    baseUrl: 'http://127.0.0.1:1',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (key) => (key === 'agents' ? fakeAgents : undefined),
    effect: (fn) => { const d = fn(); if (typeof d === 'function') teardownDisposers.push(d); return d },
    inject: undefined,   // no webhookRuntime: steer path + clear create-mode failure
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
  }

  const invocations = applyCronAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op),
    settings: { cronTasksPath: storagePath },
  })

  let service
  check('service provided with typertRemote binding and descriptors', () => {
    service = ctx.provided.cronAdmin
    assert.ok(service, 'cronAdmin provided')
    assert.equal(service.typertRemote.namespace, 'cronAdmin')
    const ids = invocations.map((i) => i.id)
    for (const tail of ['cron/list', 'cron/upsert', 'cron/remove', 'cron/toggle', 'cron/runNow']) {
      assert.ok(ids.includes(`dsh-plugin-admin/${tail}`), `descriptor ${tail} present`)
    }
  })

  check('list starts empty', async () => {
    const res = await service.list()
    assert.equal(res.ok, true)
    assert.equal(res.tasks.length, 0)
    assert.equal(res.schedulerActive, true)
  })

  check('upsert persists and list round-trips', async () => {
    await service.upsert(validSteer())
    const res = await service.list()
    assert.equal(res.tasks.length, 1)
    const t = res.tasks[0]
    assert.equal(t.id, 'nightly-report')
    assert.equal(t.cron, '0 9 * * *')
    assert.equal(t.targetOnline, true)     // session-live is in the fake agents
    assert.notEqual(t.nextRun, null)
    // Storage file is valid JSON with the expected envelope.
    const raw = JSON.parse(readFileSync(storagePath, 'utf8'))
    assert.equal(raw.version, 1)
    assert.equal(raw.tasks.length, 1)
  })

  check('upsert rejects an impossible cron without touching storage', async () => {
    const before = JSON.parse(readFileSync(storagePath, 'utf8')).tasks.length
    await assert.rejects(() => service.upsert({ ...validSteer(), id: 'bad', cron: '0 0 31 2 *' }), /cron/)
    const after = JSON.parse(readFileSync(storagePath, 'utf8')).tasks.length
    assert.equal(after, before)
  })

  check('toggle flips enabled', async () => {
    const off = await service.toggle('nightly-report', false)
    assert.equal(off.enabled, false)
    const on = await service.toggle('nightly-report', true)
    assert.equal(on.enabled, true)
  })

  check('runNow fires the steer action and records history', async () => {
    const res = await service.runNow('nightly-report')
    assert.equal(res.ok, true)
    assert.equal(steered.length, 1)
    const msg = steered[0].msg
    assert.equal(msg.role, 'user')
    assert.equal(msg.source.kind, 'dsh-plugin-admin-cron', 'message source kind must reflect cron, not webhook')
    assert.ok(msg.content[0].text.includes('定时任务「nightly-report」'))
    const listed = await service.list()
    assert.equal(listed.history.length, 1)
    assert.equal(listed.history[0].ok, true)
    assert.equal(listed.history[0].mode, 'steer')
  })

  check('runNow on a create task reports the missing runtime honestly', async () => {
    await service.upsert({
      id: 'daily-standup',
      cron: '0 10 * * 1-5',
      action: { mode: 'create', workspacePath: join(tmpdir(), 'repos', 'standup'), agentPreset: 'default', permissionPreset: 'workspace-write' },
      promptTemplate: '站会开始',
    })
    const res = await service.runNow('daily-standup')
    assert.equal(res.ok, true)             // the RPC itself succeeded
    const listed = await service.list()
    const entry = listed.history.find(h => h.taskId === 'daily-standup')
    assert.ok(entry, 'history entry recorded')
    assert.equal(entry.ok, false)
    assert.match(entry.error, /webhook 运行时/)
  })

  check('runNow rejects an unknown id', async () => {
    await assert.rejects(() => service.runNow('nope'), /不存在/)
  })

  check('remove deletes the task and disarms', async () => {
    const res = await service.remove('nightly-report')
    assert.equal(res.ok, true)
    const listed = await service.list()
    assert.equal(listed.tasks.filter(t => t.id === 'nightly-report').length, 0)
  })

  check('remove rejects an unknown id', async () => {
    await assert.rejects(() => service.remove('nope'), /不存在/)
  })

  check('teardown disposes every armed timer', () => {
    // The fake ctx collected disposers; running them must not throw.
    for (const dispose of teardownDisposers) {
      try { dispose() } catch { /* async disposers settle later */ }
    }
  })
} finally {
  await settle()
  rmSync(fakeHome, { recursive: true, force: true })
}

/* ========================================================================== */
/*                        Scheduler: actual timer fire                        */
/* ========================================================================== */

const fireHome = mkdtempSync(join(tmpdir(), 'cron-fire-'))
try {
  const fired = []
  const fakeAgents = {
    get: (id) => (id === 'live' ? { steer: (m) => fired.push(m), followup: (m) => fired.push(m) } : undefined),
    list: () => [{ id: 'live' }],
  }
  const ctx = {
    baseUrl: 'http://127.0.0.1:1',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (key) => (key === 'agents' ? fakeAgents : undefined),
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    inject: undefined,
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
  }

  const storagePath = join(fireHome, 'cron-tasks.json')
  applyCronAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op),
    settings: { cronTasksPath: storagePath },
  })

  check('armed task with a one-minute cron fires', async () => {
    await ctx.provided.cronAdmin.upsert({
      id: 'every-minute',
      cron: '* * * * *',
      action: { mode: 'steer', sessionId: 'live' },
      promptTemplate: 'tick $RULE',
    })
    // The timer is unref'd and armed to the next minute boundary; wait up to
    // 150s for one fire. (CI variance makes the exact minute unpredictable, and a
    // stalled 2-core runner can eat the 10s of slack a 70s budget left: this check
    // became ENFORCED when check() started awaiting async bodies, and that is how
    // the ubuntu/Node 22 leg went red on an otherwise-green commit.)
    const deadline = Date.now() + 150_000
    while (fired.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.equal(fired.length, 1, 'the scheduled fire delivered a steer message')
    const listed = await ctx.provided.cronAdmin.list()
    assert.ok(listed.history.some(h => h.taskId === 'every-minute' && h.ok === true), 'fire recorded in history')
  })

  check('runNow on an armed task leaves no orphan timer (no double fire)', async () => {
    await ctx.provided.cronAdmin.upsert({
      id: 'no-orphan',
      cron: '* * * * *',
      action: { mode: 'steer', sessionId: 'live' },
      promptTemplate: 'no-orphan tick',
    })
    // 定时器仍在途时手动触发：旧实现 fire() 只删记录不清 setTimeout，边界到点
    // 时孤儿定时器与重排的新定时器同时执行 → 本任务 fired 三次（runNow + 双发）。
    // 修复后恰好两次：runNow 一次 + 边界自然触发一次。
    await ctx.provided.cronAdmin.runNow('no-orphan')
    const countOf = () => fired.filter(m => String(m.content?.[0]?.text || m).includes('no-orphan')).length
    assert.equal(countOf(), 1, 'runNow fired exactly once')
    // Same budget reasoning as the every-minute check above.
    const deadline = Date.now() + 150_000
    while (countOf() < 2 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.equal(countOf(), 2, 'the boundary fire landed, and only one')
    // 边界双发会在同一 tick 内落地——留一小段窗口确认没有第二发。
    await new Promise(resolve => setTimeout(resolve, 3_000))
    assert.equal(countOf(), 2, 'no orphan-timer double fire at the boundary')
    const listed = await ctx.provided.cronAdmin.list()
    const entries = listed.history.filter(h => h.taskId === 'no-orphan' && h.ok === true)
    assert.equal(entries.length, 2, 'history records runNow + the single boundary fire')
  })
} finally {
  await settle()
  rmSync(fireHome, { recursive: true, force: true })
}

/* ========================================================================== */
/*        早期唤醒不得重排刚跑过的那一次（重复执行保护，1.25.2）                    */
/* ========================================================================== */

// Reproduces, deterministically and in milliseconds, the failure a Windows CI
// runner reported as `✗ runNow on an armed task leaves no orphan timer … 3 !== 2`:
// nextOccurrence(fields, at - 1) returns `at` ITSELF (measured), so a timer that
// wakes a millisecond early — the wake FIRE_SLACK_MS exists to tolerate — used to
// re-arm for the occurrence it had just served, i.e. a ~1ms timer and a second
// execution of the user's action.
const dupHome = mkdtempSync(join(tmpdir(), 'cron-dup-'))
try {
  const dupSteered = []
  const dupCtx = {
    baseUrl: 'http://127.0.0.1:1',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (key) => (key === 'agents'
      ? { get: (id) => (id === 'live' ? { steer: (message) => dupSteered.push(message) } : undefined) }
      : undefined),
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    inject: undefined,
    provide: (key, service) => { dupCtx.provided ??= {}; dupCtx.provided[key] = service },
  }
  const dupPath = join(dupHome, 'cron-tasks.json')
  const stubbed = []
  const realSetTimeout = globalThis.setTimeout
  const realNow = Date.now

  check('an early wake re-arms the NEXT occurrence and never runs one twice', async () => {
    const base = new Date()
    base.setSeconds(0, 0)
    const at = base.getTime() + 60_000     // the upcoming minute boundary
    globalThis.setTimeout = (fn, delay) => { stubbed.push({ fn, delay }); return { unref() {} } }
    Date.now = () => at - 1                // the 1ms-early wake
    try {
      applyCronAdmin(dupCtx, { enqueue: (op) => Promise.resolve().then(op), settings: { cronTasksPath: dupPath } })
      await dupCtx.provided.cronAdmin.upsert({
        id: 'dup',
        cron: '* * * * *',
        action: { mode: 'steer', sessionId: 'live', steer: true },
        promptTemplate: 'dup tick',
      })
      const armedAt = stubbed.at(-1)
      assert.equal(armedAt.delay, 1, 'fixture: armed exactly one millisecond before the boundary')

      await armedAt.fn()                   // serve that occurrence
      assert.equal(dupSteered.length, 1, 'the occurrence ran exactly once')
      const rearmed = stubbed.at(-1)
      assert.ok(
        rearmed.delay > 30_000,
        `the re-arm must target the NEXT boundary (got ${rearmed.delay}ms; ~1ms means it re-armed the occurrence it just ran)`,
      )

      // A second timer aimed at the SAME occurrence (any stale-timer path) must
      // not run the action again — one execution per scheduled occurrence.
      await armedAt.fn()
      assert.equal(dupSteered.length, 1, 'a duplicate timer for the same occurrence is suppressed')
    } finally {
      globalThis.setTimeout = realSetTimeout
      Date.now = realNow
    }
  })
} finally {
  await settle()
  rmSync(dupHome, { recursive: true, force: true })
}

/* ========================================================================== */
/*                    Timer-cap clamp (premature wake guard)                  */
/* ========================================================================== */

check('isDueForFire gates scheduled fires but not 「立即触发」', () => {
  const now = Date.now()
  assert.equal(isDueForFire(undefined), true, 'absent scheduledAt (runNow) always executes')
  assert.equal(isDueForFire(now - 1, now), true, 'at/after the scheduled moment fires')
  assert.equal(isDueForFire(now + 4_000, now), true, 'a wake within the clock slack still fires')
  assert.equal(isDueForFire(now + 60_000, now), false, 'a wake ahead of the schedule only re-arms')
})

// A sparse schedule (next occurrence > Node's ~24.8-day setTimeout ceiling)
// used to fire its clamped timer EARLY and EXECUTE — then fire AGAIN at the
// true time: one occurrence ran twice, weeks ahead of schedule. The wake
// must only re-arm; the action runs solely when the scheduled moment arrives.
const clampHome = mkdtempSync(join(tmpdir(), 'cron-clamp-'))
try {
  const steered = []
  const fakeAgents = {
    get: (id) => (id === 'live' ? { steer: (m) => steered.push(m), followup: (m) => steered.push(m) } : undefined),
    list: () => [{ id: 'live' }],
  }
  const ctx = {
    baseUrl: 'http://127.0.0.1:1',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (key) => (key === 'agents' ? fakeAgents : undefined),
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    inject: undefined,
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
  }
  const storagePath = join(clampHome, 'cron-tasks.json')
  const MAX_TIMER_DELAY_MS = 2147483647

  await check('a clamped wake executes nothing and re-arms; runNow still fires', async () => {
    // A one-shot monthly-style schedule whose next occurrence is ~40 days
    // out — safely beyond the timer cap from any test-run date.
    const target = new Date(Date.now() + 40 * 86_400_000)
    const cron = `0 0 ${target.getDate()} ${target.getMonth() + 1} *`
    const fields = parseCron(cron)
    const at = nextOccurrence(fields, Date.now())
    assert.ok(at - Date.now() > MAX_TIMER_DELAY_MS, 'fixture gap exceeds the timer cap')
    assert.ok(at - Date.now() <= 41 * 86_400_000, 'fixture gap stays near 40 days')

    const stubbed = []
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, delay) => { stubbed.push({ fn, delay }); return { unref() {} } }
    try {
      applyCronAdmin(ctx, {
        enqueue: (op) => Promise.resolve().then(op),
        settings: { cronTasksPath: storagePath },
      })
      await ctx.provided.cronAdmin.upsert({
        id: 'far-task',
        cron,
        action: { mode: 'steer', sessionId: 'live' },
        promptTemplate: 'monthly $RULE',
      })
      assert.equal(steered.length, 0, 'arming itself never executes')
      const clamped = stubbed.filter(t => t.delay === MAX_TIMER_DELAY_MS)
      assert.equal(clamped.length, 1, 'the timer was clamped to the Node ceiling')

      // Simulate the clamp wake: the timer fires weeks before the schedule.
      await clamped[0].fn()
      assert.equal(steered.length, 0, 'a premature wake must not execute the action')
      assert.equal(stubbed.filter(t => t.delay === MAX_TIMER_DELAY_MS).length, 2, 'the premature wake re-armed the task')
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    // The execution path is intact: 「立即触发」 runs the same pipeline.
    await ctx.provided.cronAdmin.runNow('far-task')
    assert.equal(steered.length, 1, 'runNow still delivers the steer message')
    const listed = await ctx.provided.cronAdmin.list()
    assert.ok(listed.history.some(h => h.taskId === 'far-task' && h.ok === true), 'the manual run is recorded')
  })
} finally {
  await settle()
  rmSync(clampHome, { recursive: true, force: true })
}

/* ========================================================================== */
/* 跨进程并发写（Phase F1/F2 扩展）：两个 dsh 实例各自 upsert，谁的编辑都不能丢      */
/* ========================================================================== */

check('two processes upserting one tasks store lose no task', async () => {
  // The guard read used to sit OUTSIDE any cross-process lock, so two instances
  // could both read revision N, both merge their own task and the second write
  // silently dropped the first. mutateTasksStore now holds the lock across
  // read → merge → write; this is the acceptance case for that fix.
  const dir = mkdtempSync(join(tmpdir(), 'cron-race-'))
  const storePath = join(dir, 'cron-tasks.json')
  const barrier = join(dir, 'go')
  const worker = join(dir, 'worker.mjs')
  // A round per write is cheap here (one small JSON file), so the loop is long
  // enough for the two writers to overlap repeatedly: a no-lock read-merge-write
  // loses ROUGHLY HALF of them (measured: 138 of 300 missing), so this stays a
  // strong detector while the budget stays far from the lock's fail-open.
  const ROUNDS = 60
  // The lock is FAIL-OPEN by design (see patch-utils: after 3s of waiting it
  // writes anyway rather than refusing the user's action), so an extreme stall on
  // a slow CI runner may legitimately lose one update. Asserting an exact count
  // made this test flaky on windows-latest/Node 22; tolerating a couple while the
  // unlocked regression loses ~half keeps it decisive.
  const TOLERANCE = 2
  writeFileSync(worker, [
    `import { applyCronAdmin } from ${JSON.stringify(new URL('../lib/cron-admin.js', import.meta.url).href)}`,
    `import { existsSync } from 'node:fs'`,
    'const [storePath, barrier, tag, rounds] = process.argv.slice(2)',
    'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
    'const ctx = {',
    "  baseUrl: 'http://127.0.0.1:1',",
    '  logger: { info() {}, warn() {}, error() {} },',
    '  get: () => undefined,',
    '  effect: (fn) => { const d = fn(); return typeof d === \'function\' ? d : () => {} },',
    '  provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },',
    '}',
    'applyCronAdmin(ctx, { enqueue: (op) => Promise.resolve().then(op), settings: { cronTasksPath: storePath } })',
    // Barrier: both children start writing at the same instant, so the no-lock
    // version really interleaves (startup skew alone would serialize them and a
    // missing lock would go unnoticed).
    'const until = Date.now() + 15000',
    'while (!existsSync(barrier) && Date.now() < until) await sleep(2)',
    'for (let i = 0; i < Number(rounds); i += 1) {',
    '  await ctx.provided.cronAdmin.upsert({',
    "    id: tag + '-' + i, cron: '* * * * *', enabled: false,",
    "    action: { mode: 'steer', sessionId: 's' },",
    '  })',
    '}',
    // The mount's fs.watch would keep the child alive; the work is done.
    'process.exit(0)',
    '',
  ].join('\n'), 'utf8')
  const run = (tag) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, storePath, barrier, tag, String(ROUNDS)], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.resume()
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(tag + ' worker exited ' + code + ': ' + stderr))))
  })
  try {
    const children = [run('a'), run('b')]
    // Let both mounts reach the barrier before releasing them.
    await new Promise((resolve) => setTimeout(resolve, 600))
    writeFileSync(barrier, 'go', 'utf8')
    await Promise.all(children)
    const stored = JSON.parse(readFileSync(storePath, 'utf8'))
    const ids = new Set(stored.tasks.map(t => t.id))
    const missing = []
    for (let i = 0; i < ROUNDS; i += 1) {
      if (!ids.has('a-' + i)) missing.push('a-' + i)
      if (!ids.has('b-' + i)) missing.push('b-' + i)
    }
    assert.ok(
      missing.length <= TOLERANCE,
      `an unlocked read-merge-write loses ~half the writes; the lock may only lose ${TOLERANCE} to its documented fail-open — lost ${missing.length}: ${missing.slice(0, 8).join(',')}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
// The chain must be drained AFTER this check too, or its pending child processes
// keep the process alive past the summary (the previous `settle()` calls all sit
// earlier in the file).
await settle()

/* ========================================================================== */

console.log(`cron-admin: ${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
// Exit hard like the sibling verify scripts (verify-webhook-triggers /
// verify-store-version / verify-overlays): the mounts above leave fs.watch
// listeners and armed timers behind, and the cross-process check's spawned
// children leave pipe handles — a green run must not depend on the event loop
// draining on its own.
process.exit(0)
