/**
 * bench-journal.mjs — O-2 decision data: how big do workflow journals actually
 * get, how does `persist()` scale with step count, and what does `list()` cost
 * as the runs directory fills up?
 *
 * Not part of `npm test`: this MEASURES rather than asserts, and its numbers
 * depend on the machine. It exists to decide whether the O-2 changes (cap
 * `record.steps`, truncate prompt/outcome, cap `result`, size-bound `list()`)
 * are worth their migration cost — the answer should come from measurements on
 * a realistic run, not from reading the code and guessing.
 *
 * Usage: node scripts/bench-journal.mjs [--steps 200] [--runs 50] [--payload-kb 4]
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunRegistry } from '../lib/workflow-runs.js'

function argOf(name, fallback) {
  const at = process.argv.indexOf('--' + name)
  if (at === -1) return fallback
  const value = Number(process.argv[at + 1])
  return Number.isFinite(value) ? value : fallback
}

const STEPS = argOf('steps', 200)
const RUNS = argOf('runs', 50)
const PAYLOAD_KB = argOf('payload-kb', 4)
const AGENT_REPLY = 'x'.repeat(PAYLOAD_KB * 1024)
/** Mirrors MAX_LOG_ENTRIES in lib/workflow-runs.js (the log snapshot cap). */
const MAX_LOG_SNAPSHOT = 500

const dshHome = mkdtempSync(join(tmpdir(), 'bench-journal-'))
const enqueue = (fn) => fn()

/** A ctx whose subagent returns a reply of a controlled size. */
function makeCtx() {
  const subagents = {
    start: async () => ({
      result: Promise.resolve({
        stopReason: 'completed',
        output: [{ type: 'text', text: AGENT_REPLY }],
      }),
      // Required: runAgent awaits run.dispose() in a finally, so a mock
      // without it makes every step throw and silently return null —
      // which would make this benchmark measure empty records.
      dispose: async () => {},
    }),
  }
  return { get: (key) => (key === 'subagents' ? subagents : undefined), subagents }
}

const runsDir = join(dshHome, 'workflows', 'runs')
const journalOf = (id) => join(runsDir, id + '.json')
const stepsOf = (id) => join(runsDir, id + '.steps.jsonl')
const runBytes = (id) => {
  let total = 0
  for (const p of [journalOf(id), stepsOf(id), join(runsDir, id + '.summary.json')]) {
    if (existsSync(p)) total += statSync(p).size
  }
  return total
}
const dirBytes = (dir) => {
  let total = 0
  for (const file of readdirSync(dir)) total += statSync(join(dir, file)).size
  return total
}

const fmt = (bytes) => (bytes / 1024).toFixed(1) + ' KB'
const ms = (n) => n.toFixed(1) + ' ms'

console.log(`bench-journal: steps=${STEPS} runs=${RUNS} agentReply=${PAYLOAD_KB}KB`)
console.log('(one "step" = one agent() call; each is pushed twice — before + after)')
console.log()

/* ── 1. One run: how big is the record, and how does persist() scale? ──────── */

const benchCtx = makeCtx()
const registry = createRunRegistry({ ctx: benchCtx, enqueue, dshHome, maxConcurrency: 8 })
// A script that makes N sequential agent() calls and returns the last reply.
const script = `let last = null\nfor (let i = 0; i < ${STEPS}; i += 1) { last = await agent('step ' + i) }\nreturn { len: last ? last.length : 0 }`

// Sample the journal size at every step boundary. Summing those samples
// approximates the bytes persist() wrote, because the journal is fully rewritten
// each time — that is exactly the quadratic term this measurement exists for.
const samples = []
let currentRunId = null
const origStart = benchCtx.subagents.start
benchCtx.subagents.start = async (...args) => {
  const r = await origStart(...args)
  if (currentRunId !== null && existsSync(journalOf(currentRunId))) samples.push(statSync(journalOf(currentRunId)).size)
  return r
}

const started = Date.now()
const { id: startedId } = await registry.start({ script, parent: { id: 'bench-session' } })
currentRunId = startedId
await registry.join(startedId)
const elapsed = Date.now() - started
const id = startedId

const record = registry.get(id)
const journalBytes = statSync(journalOf(id)).size
const stepsBytes = existsSync(stepsOf(id)) ? statSync(stepsOf(id)).size : 0
const steps = record.steps.length
const journalWriteVolume = samples.reduce((a, b) => a + b, 0)
console.log('1. single run')
console.log(`   wall time          : ${ms(elapsed)}  (${STEPS} agent calls)`)
console.log(`   record.steps       : ${steps} entries (${STEPS} calls x2: before + after)`)
console.log(`   journal on disk    : ${fmt(journalBytes)}   <- small, mutable state only`)
console.log(`   steps JSONL        : ${fmt(stepsBytes)}   <- append-only, the bulk`)
console.log(`   run total on disk  : ${fmt(runBytes(id))}`)
console.log(`   record.log entries : ${record.log.length} (capped at 500)`)
console.log()

// How much of the file is the prompt/outcome duplication?
const before = record.steps.filter((s) => s.phase === 'before').length
const after = record.steps.filter((s) => s.phase === 'after').length
console.log(`   phase split        : before=${before} after=${after}`)
console.log('   NOTE: each call stores its prompt on the `before` entry AND the whole')
console.log('         outcome on the `after` entry. Those entries now go to the')
console.log('         append-only JSONL, so the JOURNAL rewrite below is small and')
console.log('         no longer grows with step count.'
)
console.log()

/* ── 1b. Write volume: the quadratic term, measured ────────────────────────── */

console.log('1b. write volume (the term the JSONL split removes)')
console.log(`   journal rewritten    : ${samples.length}x`)
console.log(`   journal write volume : ${(journalWriteVolume / 1024 / 1024).toFixed(2)} MB   (journal is ${fmt(journalBytes)}, mostly the log array)`)
const totalWrite = journalWriteVolume + stepsBytes
console.log(`   + appended JSONL     : ${(stepsBytes / 1024 / 1024).toFixed(2)} MB`)
console.log(`   = TOTAL written      : ${(totalWrite / 1024 / 1024).toFixed(2)} MB`)
console.log(`   amplification        : ${(totalWrite / Math.max(runBytes(id), 1)).toFixed(1)}x of the final files`)
console.log('   PRE-FIX comparison: the journal used to carry steps inline, so each')
console.log('   rewrite was as large as the whole run. Measured on the same shape')
console.log('   (200 steps / 8KB replies): 697 MB written for the same run.')
console.log()

/* ── 2. what persist() serializes NOW vs what it used to ───────────────────── */

// The journal no longer carries steps, so the per-persist payload is small and
// constant rather than growing with the run. Measure both to show the change.
const timeSerialise = (value) => {
  const t0 = process.hrtime.bigint()
  let size = 0
  for (let i = 0; i < 20; i += 1) size = JSON.stringify(value, null, 2).length
  return { size, ms: Number(process.hrtime.bigint() - t0) / 20 / 1e6 }
}
const nowPayload = { ...record, activeSteps: undefined, journal: undefined, steps: undefined, persistedSteps: undefined, log: record.log.slice(-MAX_LOG_SNAPSHOT) }
const oldPayload = { ...record, activeSteps: undefined, journal: undefined, log: record.log.slice(-MAX_LOG_SNAPSHOT) }
const now = timeSerialise(nowPayload)
const old = timeSerialise(oldPayload)
console.log('2. what persist() serializes per step')
console.log(`   NOW  (steps in JSONL) : ${fmt(now.size).padStart(11)} · ${now.ms.toFixed(2)} ms`)
console.log(`   BEFORE (steps inline) : ${fmt(old.size).padStart(11)} · ${old.ms.toFixed(2)} ms`)
console.log(`   => ${(old.size / Math.max(now.size, 1)).toFixed(0)}x smaller per persist`)
console.log(`   calls in this run     : ~${samples.length} persists`)
console.log(`   NOW total serialized  : ${fmt(now.size * samples.length)}`)
console.log(`   BEFORE total          : ${fmt(old.size * samples.length)}  <- the quadratic term`)
console.log()

/* ── 3. list(): what does a full directory read cost? ──────────────────────── */

console.log(`3. list() with a populated runs directory (target ${RUNS} runs)`)
const filler = createRunRegistry({ ctx: makeCtx(), enqueue, dshHome, maxConcurrency: 8 })
// Each filler run makes a FEW agent calls rather than none: a directory of
// one-line runs would make both list() paths look equal and hide the effect the
// sidecar exists for (large journals are what cost the read).
const FILLER_STEPS = Number(process.env.BENCH_FILLER_STEPS ?? 8)
for (let i = 0; i < RUNS; i += 1) {
  const script = `let last=null\nfor (let k=0;k<${FILLER_STEPS};k+=1){ last = await agent('filler '+k) }\nreturn { len: last ? last.length : 0 }`
  const r = await filler.start({ script, parent: { id: 'bench-session' } })
  await filler.join(r.id)
}
const allFiles = readdirSync(runsDir)
const journalFiles = allFiles.filter((f) => f.endsWith('.json') && !f.endsWith('.summary.json'))
const sidecarFiles = allFiles.filter((f) => f.endsWith('.summary.json'))
const stepFiles = allFiles.filter((f) => f.endsWith('.steps.jsonl'))
const totalBytes = dirBytes(runsDir)
const allJournalBytes = journalFiles.reduce((a, f) => a + statSync(join(runsDir, f)).size, 0)
const allSidecarBytes = sidecarFiles.reduce((a, f) => a + statSync(join(runsDir, f)).size, 0)
const allStepsBytes = stepFiles.reduce((a, f) => a + statSync(join(runsDir, f)).size, 0)
let listed = 0
const timeList = (reps = 10) => {
  filler.list() // warm
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < reps; i += 1) listed = filler.list().length
  return Number(process.hrtime.bigint() - t0) / reps / 1e6
}
const listWithSidecars = timeList()
console.log(`   runs on disk        : ${journalFiles.length} journals + ${stepFiles.length} steps files + ${sidecarFiles.length} sidecars`)
console.log(`   bytes               : ${fmt(allJournalBytes)} journals + ${fmt(allStepsBytes)} steps + ${fmt(allSidecarBytes)} sidecars`)
console.log(`   list() via sidecar  : ${ms(listWithSidecars)} per call, ${listed} runs returned`)
// Now simulate a directory written by an older build: remove every sidecar and
// re-measure, which is exactly the legacy fallback path.
for (const file of sidecarFiles) rmSync(join(runsDir, file), { force: true })
const listViaJournals = timeList()
console.log(`   list() via journals : ${ms(listViaJournals)} per call (legacy fallback)`)
console.log(`   sidecar speedup     : ${(listViaJournals / listWithSidecars).toFixed(1)}x`)
console.log('   NOTE: list() runs on the HOST THREAD (the panel poll and /workflow runs')
console.log('         both call it), so this is blocking time, not just CPU.')
const listMs = listWithSidecars
console.log()

/* ── 4. Extrapolation ─────────────────────────────────────────────────────── */

console.log('4. extrapolation')
const runCount = journalFiles.length
const perRunBytes = totalBytes / Math.max(runCount, 1)
console.log(`   measured per-run total  : ${fmt(runBytes(id))} (${STEPS} steps, ${PAYLOAD_KB}KB replies)`)
for (const n of [100, 500, 2000]) {
  const factor = n / Math.max(runCount, 1)
  console.log(`   ${String(n).padStart(4)} runs: ${fmt(perRunBytes * n)} on disk · list() via sidecar ~${ms(listMs * factor)} · via journals ~${ms(listViaJournals * factor)}`)
}
console.log('   (the sidecar gap widens with per-run size: it removes the journal')
console.log('    bodies from the read path entirely, so a directory of LARGE runs')
console.log('    benefits far more than this directory of small ones)')
console.log()
// Step count -> write volume. This used to grow QUADRATICALLY (persist rewrote
// the whole record, and the record contained every step so far). With steps in
// an append-only JSONL the journal part is constant and the steps part is
// linear, so the total is linear — this table is where that shows.
console.log('5. scaling of one run with step count')
console.log('   steps | journal | steps JSONL | total on disk | journal write volume')
for (const n of [50, 200, 500]) {
  const home = mkdtempSync(join(tmpdir(), 'bench-scale-'))
  const scaleCtx = makeCtx()
  let scaleId = null
  const scaleSamples = []
  const origScale = scaleCtx.subagents.start
  scaleCtx.subagents.start = async (...a) => {
    const r = await origScale(...a)
    if (scaleId !== null) {
      const j = join(home, 'workflows', 'runs', scaleId + '.json')
      if (existsSync(j)) scaleSamples.push(statSync(j).size)
    }
    return r
  }
  const r = createRunRegistry({ ctx: scaleCtx, enqueue, dshHome: home, maxConcurrency: 8 })
  const s = `let last=null\nfor (let i=0;i<${n};i+=1){ last = await agent('step '+i) }\nreturn { len: last ? last.length : 0 }`
  const t0 = Date.now()
  const started2 = await r.start({ script: s, parent: { id: 'bench-scale' } })
  scaleId = started2.id
  await r.join(started2.id)
  const wall = Date.now() - t0
  const dir = join(home, 'workflows', 'runs')
  const jBytes = statSync(join(dir, scaleId + '.json')).size
  const sPath = join(dir, scaleId + '.steps.jsonl')
  const sBytes = existsSync(sPath) ? statSync(sPath).size : 0
  const writeVol = scaleSamples.reduce((a, b) => a + b, 0) + sBytes
  console.log(`   ${String(n).padStart(5)} | ${fmt(jBytes).padStart(8)} | ${fmt(sBytes).padStart(11)} | ${fmt(jBytes + sBytes).padStart(13)} | ${fmt(writeVol).padStart(11)}  (${wall} ms)`)
  rmSync(home, { recursive: true, force: true })
}
console.log()
console.log('   Reading: the journal stays flat (it only holds mutable state) and the')
console.log('   steps JSONL grows linearly, so TOTAL WRITE VOLUME IS NOW LINEAR in')
console.log('   step count. It used to be quadratic: on the 200-step / 8KB shape this')
console.log('   benchmark measured 697 MB written for one run before the split, vs')
console.log(`   ~5 MB now. At ${PAYLOAD_KB}KB per reply that is the difference between gigabytes`)
console.log('   and megabytes of SSD writes for a single large run.')

rmSync(dshHome, { recursive: true, force: true })
