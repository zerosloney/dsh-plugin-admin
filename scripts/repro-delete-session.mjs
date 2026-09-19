/**
 * Reproduction harness for the "会话不能删除" reports: mounts the REAL
 * sessionAdmin service (lib/index.js apply()) against realistic fake dsh
 * services and drives every guard on the delete paths, printing the exact
 * error a user would see in the panel for each failure mode.
 *
 * Not wired into `npm test` — this is a diagnostic tool. Run:
 *   node scripts/repro-delete-session.mjs
 *
 * ✅ = the scenario reproduces that failure mode on the real code
 *      (or, for the two baseline scenarios, that normal deletion works).
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const home = join(here, '../.host-check-tmp/repro-delete-home')
mkdirSync(join(home, 'commands'), { recursive: true })
process.env.DSH_HOME = home

const { apply, sessionLogDirFor } = await import(new URL('../lib/index.js', import.meta.url).href)

const BASE_HEADER = { id: 'sess-x', cwd: 'E:/repro/project', createdAt: 1 }

/** The agents service of the most recent mount (the plugin wraps it in place,
 * so a resume() call through THIS object exercises the capture wrapper). */
let lastAgents = undefined

/** Build one mount with the knobs each case needs. */
function mount({ header = BASE_HEADER, sizeBytes = 3, sessionsGet = () => undefined, agents = undefined, onStat = undefined }) {
  const effects = []
  lastAgents = agents
  const ctx = {
    baseUrl: pathToFileURL(join(here, '..')).href,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    provide: (key, service) => { ctx.provided[key] = service },
    provided: {},
    effect: (fn, name) => { const d = fn(); if (typeof d === 'function') effects.push({ name, d }) },
    // 'agents' must resolve to the same object lastAgents refers to: the
    // plugin wraps the service IN PLACE via ctx.get('agents'), and in-process
    // consumers (the web session controller) call the wrapped methods through
    // the very same instance.
    get: (name) => (name === 'sessions'
      ? { get: sessionsGet }
      : name === 'agents'
        ? agents
        : name === 'workspaceRegistry'
          ? ctx.workspaceRegistry
          : undefined),
    on: () => () => {},
    commands: { register: () => () => {} },
    typert: { register: () => () => {} },
    workspaceRegistry: {
      list: () => [{
        id: 'w1', title: 'proj', path: 'E:/repro/project', sessionIds: [header.id],
        detachSession: async () => {},
      }],
      archivedSessionIds: [],
      requireState: () => ({ archivedSessionIds: [] }),
      setState: async () => {},
      enqueueOperation: (op) => op(),
    },
    sessionPersistence: {
      list: async () => [{ header, revision: 'r1' }],
      stat: async () => {
        if (onStat !== undefined) onStat()
        return { header, revision: 'r1', sizeBytes }
      },
      open: async () => ({ read: async () => [], close: async () => {} }),
    },
    ...(agents !== undefined ? { agents } : {}),
  }
  apply(ctx)
  return ctx.provided.sessionAdmin
}

function materialize(header, file = 'session.jsonl.zstd') {
  const dir = sessionLogDirFor(header)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), '{}\n')
  return dir
}

let reproduced = 0
const TOTAL = 6
async function scenario(title, run) {
  try {
    await run()
    reproduced++
    console.log(`✅ ${title}`)
  } catch (error) {
    console.log(`❌ ${title}\n   ${String(error.message).split('\n')[0]}`)
  }
}

/* Case 1 — BASELINE: an ENDED session whose log sits at the standard JSONL
 * layout deletes cleanly. If THIS fails, deletion is broken outright. */
await scenario('基线：非在线会话（日志目录在标准布局）→ deleteSession 成功', async () => {
  const header = { ...BASE_HEADER, id: 'sess-ok' }
  const dir = materialize(header)
  const admin = mount({ header })
  await admin.deleteSession(header.id)
  assert.ok(!existsSync(dir), 'log dir removed')
})

/* Case 2 — the session is LIVE (mounted in dsh's in-memory store) but its
 * AgentHandle was never captured (opened before the plugin mounted, or the
 * plugin was hot-swapped after the session opened). deleteSession refuses;
 * closeSession fails loud with the restart guidance. */
await scenario('在线会话 + handle 未捕获（插件挂载前已打开）→ closeSession 明确报错，删除被拒', async () => {
  const header = { ...BASE_HEADER, id: 'sess-uncaptured' }
  materialize(header)
  const admin = mount({ header, sessionsGet: (id) => (id === header.id ? { id } : undefined), agents: {} })
  await assert.rejects(() => admin.deleteSession(header.id), /is live — close it before deleting/)
  await assert.rejects(() => admin.closeSession(header.id), /agent handle was not captured[\s\S]*restart dsh/)
})

/* Case 3 — a live session opened THROUGH the wrapped agents.resume (the web
 * controller path) has its handle captured → closeSession disposes once and
 * deletes without a restart. */
await scenario('在线会话 + handle 已捕获（经 ctx.agents.resume 打开）→ closeSession 免重启删除成功', async () => {
  const header = { ...BASE_HEADER, id: 'sess-captured' }
  const dir = materialize(header)
  const disposeCalls = []
  const admin = mount({
    header,
    sessionsGet: (id) => (id === header.id ? { id } : undefined),
    agents: { resume: async () => ({ agent: { id: header.id }, dispose: async () => { disposeCalls.push(header.id) } }) },
  })
  // Simulate the web controller opening the session: the call rides the
  // plugin's transparent wrapper, so the handle is captured as a side effect.
  await lastAgents.resume({ resumeSessionId: header.id })
  await admin.closeSession(header.id)
  assert.deepEqual(disposeCalls, [header.id], 'disposed exactly once')
  assert.ok(!existsSync(dir), 'log dir removed after dispose')
})

/* Case 4 — the persistence seam reports durable bytes but the standard JSONL
 * layout holds no directory (SQLite/custom backend, moved DSH_HOME, layout
 * drift). The plugin fails loud instead of silently leaving orphans — and as
 * a side effect the session can NEVER be deleted through the panel. */
await scenario('stat 报告有持久化字节但标准布局无目录（SQLite/自定义后端）→ 永久性删除失败（fail loud）', async () => {
  const header = { ...BASE_HEADER, id: 'sess-sqlite-ish' }
  const admin = mount({ header, sizeBytes: 4096 })
  await assert.rejects(() => admin.deleteSession(header.id), /durable bytes but no log directory exists at the standard layout/)
})

/* Case 5 — a header WITHOUT a usable cwd (session created with no workspace):
 * the log directory cannot be derived; materialized bytes still fail loud. */
await scenario('header 无 cwd + 有持久化字节 → 无法推导日志目录，删除失败（fail loud）', async () => {
  const header = { id: 'sess-nocwd', createdAt: 2 }
  const admin = mount({ header, sizeBytes: 64 })
  await assert.rejects(() => admin.deleteSession(header.id), /durable bytes but no log directory exists/)
})

/* Case 6 — the delete/live race: the session was ended when listed but a
 * concurrent resume lands while the delete is in flight (flipped inside the
 * fake stat(), i.e. between the outer guard and the inner guard). */
await scenario('删除瞬间会话刚好被恢复（并发 resume 竞态）→ "became live" 守卫拒绝', async () => {
  const header = { ...BASE_HEADER, id: 'sess-race' }
  materialize(header)
  let live = false
  const admin = mount({
    header,
    sessionsGet: () => (live ? { id: header.id } : undefined),
    onStat: () => { live = true },
  })
  await assert.rejects(() => admin.deleteSession(header.id), /became live — close it before deleting/)
})

console.log(`\n${reproduced}/${TOTAL} 个场景复现成功`)
console.log('判定指南（把面板/菜单里看到的报错对号入座）：')
console.log('  · "is live — close it before deleting"        → 会话在线，用「关停并删除」（closeSession）而非直接删除')
console.log('  · "agent handle was not captured … restart"   → 会话在插件挂载前已打开（或插件中途热替换过），重启 dsh 后再删')
console.log('  · "became live — close it before deleting"    → 删除瞬间被并发恢复，刷新后重试即可')
console.log('  · "durable bytes but no log directory …"      → 非标准持久化布局（SQLite 后端/自定义根/DSH_HOME 迁移）：')
console.log('                                                   插件按 jsonl 物理布局推导日志目录失败时拒绝删除以防误删，')
console.log('                                                   该会话在面板里永远删不掉，需按报错路径手工清理')
