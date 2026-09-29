#!/usr/bin/env node
/**
 * run-gate.mjs — the npm test chain as one readable step table.
 *
 * `npm test` used to be a 38-command `&&` chain on one line of package.json:
 * adding a script meant growing that line, and a red step identified itself
 * only by its position in the log. The table below is the same chain in the
 * same order; the runner prints which step is running and what it cost, and
 * on failure names the step and exits with its code.
 *
 * Usage:
 *   npm test                       # the full gate (CI runs exactly this)
 *   npm test -- --filter cron      # static gates + every step matching `cron`
 *   node scripts/run-gate.mjs --list
 *
 * The three static gates always run first, even under --filter — they cost
 * ~2s together and see the cross-cutting breakage (type drift, artifact out
 * of sync with its sources) that a single verify script cannot. Steps run
 * strictly one at a time: several verify scripts wait on real minute
 * boundaries and process races, and interleaved output would make a red step
 * much harder to read.
 *
 * Annotation-compatible with scripts/lib/ci-failure-annotation.mjs: children
 * inherit NODE_OPTIONS, so a failing step still annotates itself; this
 * runner's banner names the step on the way out.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath

/** @type {{ name: string, desc: string, cmd: string[], static?: boolean }[]} */
const STEPS = [
  { name: 'check:types', desc: 'tsc --noEmit (checkJs) over lib/** and src/client/**', cmd: ['npm', 'run', 'check:types'], static: true },
  { name: 'check:lint', desc: 'oxlint over lib src scripts (errors only; warnings recorded)', cmd: ['npm', 'run', 'check:lint'], static: true },
  { name: 'build:client --check', desc: 'built artifacts match src/client/** — catches forgot-to-rebuild', cmd: [node, 'scripts/build-client.mjs', '--check'], static: true },
  { name: 'self-check', desc: 'load the built bundle the way the host loader does; mount every panel in jsdom + en-locale smoke', cmd: [node, 'scripts/self-check.mjs'] },
  { name: 'host-check', desc: 'apply() against a contract-shaped fake ctx; RPC manifest ↔ descriptors ↔ client call sites', cmd: [node, 'scripts/host-check.mjs'] },
  { name: 'verify-run-command', desc: 'lib/run-command.js: dual-stream drain + process-tree kill budgets', cmd: [node, 'scripts/verify-run-command.mjs'] },
  { name: 'verify-mcp-cache', desc: 'MCP connectivity-test cache in the panel (localStorage seed/restore/invalidate)', cmd: [node, 'scripts/verify-mcp-cache.mjs'] },
  { name: 'verify-update-reminders', desc: 'update-reminder badge survives settings re-open (stubbed registry)', cmd: [node, 'scripts/verify-update-reminders.mjs'] },
  { name: 'verify-subagents-host', desc: 'subagent-admin host half: rows, mounts, tool constraints, tool seed', cmd: [node, 'scripts/verify-subagents-host.mjs'] },
  { name: 'verify-subagents-client', desc: 'subagents section in jsdom via real React 18', cmd: [node, 'scripts/verify-subagents-client.mjs'] },
  { name: 'verify-command-hooks', desc: 'commands/hooks remote contract end-to-end (temp DSH_HOME)', cmd: [node, 'scripts/verify-command-hooks.mjs'] },
  { name: 'verify-project-commands', desc: 'project .agents commands: frontmatter parse + registration', cmd: [node, 'scripts/verify-project-commands.mjs'] },
  { name: 'verify-project-hooks', desc: 'project .agents hooks interception + sandbox-policy fencing', cmd: [node, 'scripts/verify-project-hooks.mjs'] },
  { name: 'verify-todo-panel', desc: 'todo dock: git porcelain/numstat parsing + panel behaviour', cmd: [node, 'scripts/verify-todo-panel.mjs'] },
  { name: 'verify-webhook-triggers', desc: 'webhook rules CRUD, delivery, idempotency, history ring', cmd: [node, 'scripts/verify-webhook-triggers.mjs'] },
  { name: 'verify-cron-admin', desc: 'cron parse/arm/fire semantics, storage envelope, early-wake + two-process races', cmd: [node, 'scripts/verify-cron-admin.mjs'] },
  { name: 'verify-cron-panel', desc: 'automation panel in jsdom: cron tab list/toggle/editor', cmd: [node, 'scripts/verify-cron-panel.mjs'] },
  { name: 'verify-overlays', desc: 'runtime overlay enable: patch-row match/insert semantics', cmd: [node, 'scripts/verify-overlays.mjs'] },
  { name: 'verify-peer-compat', desc: 'install peer-compatibility preflight: semver parse + dsh range', cmd: [node, 'scripts/verify-peer-compat.mjs'] },
  { name: 'verify-workspace-admin', desc: 'workspaceAdmin RPC: no-registry hint + CRUD round-trips', cmd: [node, 'scripts/verify-workspace-admin.mjs'] },
  { name: 'verify-skills-admin', desc: 'skills listing: three-scope merge, strict read-only', cmd: [node, 'scripts/verify-skills-admin.mjs'] },
  { name: 'verify-usage-ledger', desc: 'usage ledger: live observer, snapshot sweep, delete-before-snapshot', cmd: [node, 'scripts/verify-usage-ledger.mjs'] },
  { name: 'verify-web-search-admin', desc: 'web-search provider switch + settings.mutate path (keys never echoed)', cmd: [node, 'scripts/verify-web-search-admin.mjs'] },
  { name: 'verify-i18n', desc: 'dshT call sites ↔ dictionaries, both ways; en values hold no CJK', cmd: [node, 'scripts/verify-i18n.mjs'] },
  { name: 'verify-audit-log', desc: 'audit log: key-name + shape redaction, cap compaction, method pins', cmd: [node, 'scripts/verify-audit-log.mjs'] },
  { name: 'verify-file-lock', desc: 'cross-process file lock: stale recovery, fail-open, 0600, Windows EPERM races', cmd: [node, 'scripts/verify-file-lock.mjs'] },
  { name: 'verify-rpc-schema', desc: 'wire schemas vs manifest: strict-mode coverage, optional wires', cmd: [node, 'scripts/verify-rpc-schema.mjs'] },
  { name: 'verify-service-injects', desc: 'every ctx.<service> read in lib/** is declared in inject', cmd: [node, 'scripts/verify-service-injects.mjs'] },
  { name: 'verify-store-version', desc: 'store files: version read contract, migration chain, refuse-newer', cmd: [node, 'scripts/verify-store-version.mjs'] },
  { name: 'verify-webhook-hardening', desc: 'webhook auth: constant-time secret, rate limits, loopback default', cmd: [node, 'scripts/verify-webhook-hardening.mjs'] },
  { name: 'verify-hooks-codex-bridge', desc: 'codex sibling bridge: pnpm add + patch-row authoring', cmd: [node, 'scripts/verify-hooks-codex-bridge.mjs'] },
  { name: 'verify-workflow-engine', desc: 'workflow engine: realm escape probes, sync-prefix budget, step cache', cmd: [node, 'scripts/verify-workflow-engine.mjs'] },
  { name: 'verify-workflow-runs', desc: 'run lifecycle: journal, stop budget, resume, orphan derivation', cmd: [node, 'scripts/verify-workflow-runs.mjs'] },
  { name: 'verify-workflow-admin', desc: 'workflow_admin RPC + library scopes + trusted workspace paths', cmd: [node, 'scripts/verify-workflow-admin.mjs'] },
  { name: 'verify-workflow-tools', desc: 'the model-facing workflow_admin tool: action enum, eval, save', cmd: [node, 'scripts/verify-workflow-tools.mjs'] },
  { name: 'verify-workflow-command', desc: '/workflow slash command: create → eval → background run', cmd: [node, 'scripts/verify-workflow-command.mjs'] },
  { name: 'verify-workflow-client', desc: 'workflow panel in jsdom: create, stop, saved library, polling', cmd: [node, 'scripts/verify-workflow-client.mjs'] },
  { name: 'integration-check', desc: 'seam probes against a real dsh checkout (DSH_CHECKOUT / sibling; SKIP without one locally)', cmd: [node, 'scripts/integration-check.mjs'] },
]

function usage(problem) {
  if (problem) console.error(`run-gate: ${problem}`)
  console.error('usage: npm test [-- --filter <substring>] | node scripts/run-gate.mjs [--list|--filter <substring>]')
}

function listSteps() {
  console.log(`run-gate step table (${STEPS.length} steps; the npm test chain, in order)`)
  console.log('')
  console.log('static gates (always run, even under --filter):')
  for (const step of STEPS.filter(s => s.static)) console.log(`  ${step.name.padEnd(22)} ${step.desc}`)
  console.log('')
  console.log('steps:')
  for (const step of STEPS.filter(s => !s.static)) console.log(`  ${step.name.padEnd(22)} ${step.desc}`)
}

function fmtMs(ms) {
  const seconds = ms / 1000
  if (seconds < 90) return seconds.toFixed(1) + 's'
  return `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`
}

function runStep(step) {
  // `npm` needs a shell wrapper on Windows (npm.cmd), and spawning with an
  // args ARRAY + shell is deprecated (DEP0190) — so the npm steps pass one
  // command string. Static literals from the table: nothing to escape.
  // Plain node scripts are spawned directly, so 36 of 38 steps pay no extra
  // process hop.
  const options = { cwd: root, stdio: 'inherit', env: process.env }
  if (step.cmd[0] === 'npm') return spawnSync(step.cmd.join(' '), { ...options, shell: true })
  return spawnSync(step.cmd[0], step.cmd.slice(1), options)
}

const argv = process.argv.slice(2)
let filter = null
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--list') {
    listSteps()
    process.exit(0)
  } else if (arg === '--help' || arg === '-h') {
    usage()
    process.exit(0)
  } else if (arg === '--filter') {
    filter = argv[++i]
    if (!filter) {
      usage('missing value after --filter')
      process.exit(2)
    }
  } else {
    usage(`unknown argument: ${arg}`)
    process.exit(2)
  }
}

const needle = filter ? filter.toLowerCase() : null
const selected = []
for (const step of STEPS) {
  // no filter → everything; with a filter → static gates + matching steps.
  if (needle === null || step.static || step.name.toLowerCase().includes(needle)) selected.push(step)
}
// A filter that matches nothing is a typo, not a choice — fail loud with the
// names. Matching only a static gate (e.g. `--filter lint`) is fine: that
// selects the always-on gates and nothing else.
if (needle !== null && !STEPS.some(s => s.name.toLowerCase().includes(needle))) {
  console.error(`run-gate: no step matches --filter "${filter}". Available steps:`)
  for (const step of STEPS.filter(s => !s.static)) console.error(`  ${step.name}`)
  process.exit(2)
}

const startedAt = Date.now()
const timings = []
let index = 0
for (const step of selected) {
  index++
  console.log(`▶ [${index}/${selected.length}] ${step.name} — ${step.desc}`)
  const stepStart = Date.now()
  const result = runStep(step)
  const ms = Date.now() - stepStart
  timings.push([step.name, ms])
  if (result.status !== 0) {
    const why = result.status === null ? `signal ${result.signal ?? 'unknown'}` : `exit ${result.status}`
    console.error(`run-gate: FAILED at [${index}/${selected.length}] ${step.name} (${why})`)
    process.exit(result.status ?? 1)
  }
  console.log(`  ok (${fmtMs(ms)})`)
}

timings.sort((a, b) => b[1] - a[1])
const totalMs = Date.now() - startedAt
console.log(`run-gate OK: ${selected.length} step(s) in ${fmtMs(totalMs)} (slowest: ${timings[0][0]} ${fmtMs(timings[0][1])})`)
