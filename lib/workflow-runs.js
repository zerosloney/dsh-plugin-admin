/**
 * workflow-runs.js — 运行注册表与生命周期
 *
 * P1 的引擎只会「把一段脚本跑完」。本层在它之上加 ZCode 的运行时治理：
 *
 *   - 状态机  pending → running → completed | errored | stopped
 *   - journal 每个步骤的 before/after 事件落盘（原子写 + 串行队列）
 *   - step cache  amend 时未变步骤直接命中缓存，不重花 agent 调用
 *   - amend       停旧 run → 用旧 journal 作缓存源 → 起新 run
 *   - resume      stopped 的 run 从 journal 断点续跑
 *   - ctx.jobs    桥接宿主后台任务（模型可在会话内看到完成通知）
 *
 * 持久化：$DSH_HOME/workflows/runs/<runId>.json，进程存活即有效；
 * 重启后 stopped 的 run 仍可被列出（读 journal），running 的标记为 orphaned。
 *
 * 零 dsh 导入，全部骑运行时 Cordis Context。
 */

import { join as joinPath } from 'node:path'
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRunner, compileScript, createSemaphore } from './workflow-engine.js'
import { runsDir, readJsonIfExists, atomicWriteJson } from './workflow-engine.js'
import { atomicRename, tempPathFor } from './patch-utils.js'

const STATUS = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  errored: 'errored',
  stopped: 'stopped',
}

const MAX_LOG_ENTRIES = 500

/**
 * 摘要侧车（summary sidecar）的文件后缀。
 *
 * `list()` 只需要 13 个标量字段，但旧实现把**每个 journal 整份读进来再
 * JSON.parse**——而 journal 装着每步的 prompt 与完整 outcome。实测 200 个
 * ~180KB 的运行：整读+解析 **69 ms**，只读每个文件的前 2KB 只要 **8 ms**。
 * 面板每次轮询与 `/workflow runs` 都会走 list()，且是**宿主线程上的同步读**。
 *
 * 侧车在 persist() 的**同一个串行队列槽位**里随 journal 一起原子写，因此两者
 * 不会分叉；list() 优先读侧车，缺失/损坏时回落到整读该 journal（升级兼容：
 * 旧版本留下的运行没有侧车，第一次 list() 会慢一次，之后仍无侧车——因为不再
 * 被 persist 触碰；这是可接受的，见 list() 的回落分支）。
 */
const SUMMARY_SUFFIX = '.summary.json'

/**
 * 步骤日志（append-only JSONL）的后缀。
 *
 * journal 的**载荷 96.7% 是 `steps` 数组**（实测 120 步运行：531 KB 里 513 KB），
 * 而旧 persist() 每步都把它连同整个 record 重新序列化一遍并重写全文件——写入量
 * 因此是**步骤数的平方**：500 步 / 8KB 回复的运行最终文件 4.36 MB，但为写出它
 * 一共写了 **4.36 GB**。
 *
 * 修法刻意**不改 journal 本身的格式**（那会牵连 get/amend/resume 的读取路径与
 * 版本迁移）：把只增不改的 `steps` 挪到 `<runId>.steps.jsonl`，每次 persist 只
 * **追加**新增的那几行；journal 仍是一个小 JSON 快照（含 status / result / log
 * 等就地改写的字段），因此 `loadRecord()` 的契约完全不变——它读 journal，再把
 * JSONL 拼回 `steps` 数组，调用方看不出差别。
 *
 * 代价与取舍：读一次仍要把 JSONL 全读（amend/resume 需要全量 steps），所以
 * **读没有变便宜**（那由摘要侧车解决）；这里消掉的是**写**的平方项。
 */
const STEPS_SUFFIX = '.steps.jsonl'

/**
 * One live run's control handle, as registered in the `active` map. `done`
 * starts as null and is assigned immediately after registration (see the
 * ordering note at the creation site); it is null BEFORE the assignment and a
 * settled Promise AFTER, so the field is typed as nullable even though every
 * read after creation happens after the assignment.
 * @typedef {{
 *   record: any,
 *   controller: AbortController,
 *   runner: any,
 *   code: string|null,
 *   done: Promise<any>|null,
 *   settled: boolean,
 *   answerQuestion: (text: string) => any,
 *   jobId?: string|null,
 * }} RunHandle
 */

/**
 * 创建运行注册表。
 *
 * @param {object} deps
 * @param {DshContext} deps.ctx     Cordis Context
 * @param {function} deps.enqueue    共享串行队列（写盘用，与插件其余模块同一个）
 * @param {string} deps.dshHome      $DSH_HOME
 * @param {number} [deps.maxConcurrency] 并发上限基数：注册表只建一个**跨全部 run
 *   共享**的信号量 `maxConcurrency * 2`（ZCode 的 max_concurrency 语义），不是
 *   每个 run 各一份配额
 * @param {number} [deps.stopSettleTimeoutMs] stop() 等待运行落定的预算（默认 10s；
 *   测试注入短预算用，不是对外配置面）
 */
export function createRunRegistry(deps) {
  const { ctx, enqueue, dshHome } = deps
  const maxConcurrency = deps.maxConcurrency || 8
  // stop() 等运行落定的预算：协作脚本毫秒级落定；abort 传不进的脚本（纯 JS
  // 死循环 / 永不 resolve 的 await）在预算到点后放弃等待，stop/amend 不再被
  // 卡死脚本挂住。intentional-simple: 固定预算 + 测试注入，不做逐 run 配置。
  const stopSettleTimeoutMs = Number(deps.stopSettleTimeoutMs) > 0
    ? Number(deps.stopSettleTimeoutMs)
    : 10_000
  const dir = runsDir(dshHome)

  // 运行中（进程内）的 run 句柄。持久态在磁盘，这里只放活的。
  const active = new Map()
  // 全局并发：多个 run 同时跑时的总上限（ZCode 的 max_concurrency 语义）。
  const globalSem = createSemaphore(maxConcurrency * 2)

  // ─── journal ──────────────────────────────────────────────────────────────

  // start() 铸造的 runId 形状（下方 runId 模板：wf_<毫秒>_<base36>，随机后缀
  // 可为空串）。get/amend/resume 的 runId 来自面板 RPC 与模型工具，是 runPath
  // 唯一的调用方可控输入——先在这里白名单化，`..`、路径分隔符、盘符都拼不出
  // runs 目录之外的读取路径；非法形状读作"不存在"，与缺失记录同一条路径。
  const RUN_ID_PATTERN = /^wf_\d+_[0-9a-z]*$/

  /** 合法 runId 的落盘路径；形状不合法返回 null（调用方按不存在处理）。
 * @param {string} runId - the run id.
 * @returns {string|null} */
  function runPath(runId) {
    return typeof runId === 'string' && RUN_ID_PATTERN.test(runId)
      ? joinPath(dir, `${runId}.json`)
      : null
  }

  /** @param {string} runId - the run id.
 * @returns {Record<string, any>|null} */
  function loadRecord(runId) {
    const path = runPath(runId)
    if (path === null) return null
    const record = readJsonIfExists(path)
    if (record === null) return null
    // Reassemble `steps` from the append-only JSONL. The journal no longer carries
    // them, so this is where they come back — callers (amend/resume cache, the
    // panel's get()) see the same shape as before.
    const fromJournal = Array.isArray(record.steps) ? record.steps : null
    const fromFile = readStepsFile(runId)
    if (fromFile !== null) {
      record.steps = fromFile
    } else if (fromJournal !== null) {
      // LEGACY: a run written by an older build kept steps inline in the journal.
      // Keep them working — and do not migrate here: loadRecord is a read path.
      record.steps = fromJournal
    } else {
      record.steps = []
    }
    return record
  }

  /**
   * 一个 run 的摘要侧车路径；runId 形状非法时返回 null。
   * 复用 runPath 的白名单——`..`、分隔符、盘符在这里同样拼不出去。
   * @param {string} runId - the run id.
   * @returns {string|null}
   */
  function summaryPath(runId) {
    const base = runPath(runId)
    return base === null ? null : base.slice(0, -'.json'.length) + SUMMARY_SUFFIX
  }

  /** 步骤日志路径；runId 形状非法时返回 null（与 summaryPath 同一白名单）。
   * @param {string} runId - the run id.
   * @returns {string|null}
   */
  function stepsPath(runId) {
    const base = runPath(runId)
    return base === null ? null : base.slice(0, -'.json'.length) + STEPS_SUFFIX
  }

  /**
   * 把一个 run 的步骤追加到 JSONL 尾部。
   *
   * **为什么是追加而不是重写**：`steps` 占 record 载荷的 96.7%，而它只增不改，
   * 因此每步重写整份是纯粹的平方浪费。追加后每次 persist 的写入量与该步自身
   * 大小成正比，整轮写入量从 O(N²) 降到 O(N)。
   *
   * 追加不是原子的，但**尾部半行是可容忍的**：读到解析失败的行就停止（见
   * readStepsFile），丢掉的最多是被中断的那一行，而这一行对应的步骤在它的
   * `after` 事件落盘前本就还没算完成——与旧实现"整份重写被中断"相比，损坏面
   * 反而更小（旧实现中断会丢掉整个文件）。
   *
   * 返回追加是否**落盘**：失败不抛（不能让一次 I/O 错误打断运行），但调用方
   * 也不得推进 `persistedSteps`——journal 快照已不再携带 steps（JSONL 拆分后
   * 它们只存在于这个文件），推进计数等于把没写出去的步骤永久标成已写（缓存
   * 断代、stepCount 少计、全程无声）。返回 false 让下一次 persist 重试整段
   * 未落盘的尾部。
   * @param {string} runId
   * @param {Array<object>} steps - 需要追加的步骤条目（调用方保证只传新增的）。
   * @returns {boolean}
   */
  function appendSteps(runId, steps) {
    const file = stepsPath(runId)
    if (file === null || steps.length === 0) return true
    try {
      appendFileSync(file, steps.map((step) => JSON.stringify(step)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
      return true
    } catch { return false }
  }

  /**
   * 读回一个 run 的全部步骤。尾部损坏（进程被杀在追加中途）时**停在坏行**，
   * 保留之前所有完好的步骤——与旧实现整份 JSON.parse 失败即全丢相比更稳。
   * @param {string} runId - the run id.
   * @returns {any[]|null}
   */
  function readStepsFile(runId) {
    const file = stepsPath(runId)
    if (file === null || !existsSync(file)) return null
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { return null }
    const out = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try { out.push(JSON.parse(trimmed)) } catch { break }
    }
    return out
  }

  /** @param {Record<string, any>} record - the run record to persist. */
  function persist(record) {
    // 写盘走串行队列：读-改-写不交错，与 patch-utils 的写入策略一致。
    return enqueue(() => {
      const allSteps = record.steps || []
      // 只追加**尚未落盘**的那些步骤。`persistedSteps` 是每个 record 上的计数
      // （不落盘，见下面 delete），因此重复 persist（onAsk、stop 等）不会把同一
      // 步骤写第二遍。
      const already = typeof record.persistedSteps === 'number' ? record.persistedSteps : 0
      if (allSteps.length > already) {
        if (appendSteps(record.id, allSteps.slice(already))) {
          record.persistedSteps = allSteps.length
          record.stepsAppendFailed = false
        } else if (record.stepsAppendFailed !== true) {
          // 每个失败回合只记一条：持续失败（ENOSPC）时每步 persist 都会重入
          // 这里，逐条记日志会刷爆运行日志。计数未推进，下次 persist 重试。
          record.stepsAppendFailed = true
          appendLog(record, { kind: 'steps-append-failed', message: '步骤日志（.steps.jsonl）追加失败——未落盘的步骤会在下次写入成功时一并补上' })
        }
      } else if (allSteps.length < already) {
        // steps 被截断过（本实现不会发生，但防御）：重写整个 JSONL 以保持一致。
        rewriteSteps(record.id, allSteps)
        record.persistedSteps = allSteps.length
      }
      const snapshot = {
        ...record,
        activeSteps: undefined,
        journal: undefined,
        // steps 现在住在 JSONL 里，journal 不再携带它——这正是写入量从 O(N²)
        // 降到 O(N) 的原因。读回时由 loadRecord 重新拼上。
        steps: undefined,
        persistedSteps: undefined,
        stepsAppendFailed: undefined,
        log: (record.log || []).slice(-MAX_LOG_ENTRIES),
      }
      // runPath returns null for a non-matching id; records created here
      // always carry a valid wf_ id, so this guard is defensive.
      const journalPath = runPath(record.id)
      if (journalPath !== null) atomicWriteJson(journalPath, snapshot)
      // The sidecar rides the SAME queue slot, so a reader can never see a
      // summary describing a different revision than the journal beside it. It
      // carries only what summarize() needs — never the steps or result bodies.
      const sidecar = summaryPath(record.id)
      if (sidecar !== null) {
        try { atomicWriteJson(sidecar, summarize(record)) } catch { /* a missing sidecar only costs list() one full read */ }
      }
    })
  }

  /** 重写整个步骤 JSONL（仅在 steps 被截断的防御分支里使用）。
   * @param {string} runId - the run id.
   * @param {any[]} steps - full step entries to rewrite.
   */
  function rewriteSteps(runId, steps) {
    const file = stepsPath(runId)
    if (file === null) return
    try {
      const temp = tempPathFor(file)
      writeFileSync(temp, steps.map((step) => JSON.stringify(step)).join('\n') + (steps.length > 0 ? '\n' : ''), { encoding: 'utf8', mode: 0o600 })
      atomicRename(temp, file)
    } catch { /* best effort, same posture as appendSteps */ }
  }

  /** @param {Record<string, any>} record - the run record.
   * @param {any} entry - the log entry to append. */
  function appendLog(record, entry) {
    record.log = record.log || []
    record.log.push({ ...entry, ts: Date.now() })
    if (record.log.length > MAX_LOG_ENTRIES) record.log = record.log.slice(-MAX_LOG_ENTRIES)
  }

  // ─── 启动一次运行 ──────────────────────────────────────────────────────────

  /**
   * @param {object} spec
   * @param {string} spec.script       脚本体（TS/JS 源码）
   * @param {Record<string, any>} spec.parent  Agent — 子代理的 parent（cwd/血缘/深度来源）
   * @param {Record<string, any>} [spec.args]       传给脚本的 args
   * @param {string} [spec.provider]   subagent provider
   * @param {Record<string, any>|null} [spec.cacheFrom]  amend 来源：旧 run 的 journal
   *   （{steps:[...]}）；弃用缓存时为 null（血缘由 amendedFrom 补上）。
   * @param {string|null} [spec.cacheNote]  弃用缓存的原因（进新 run 的 journal）；
   *   保留缓存时为 null。
   * @param {string} [spec.amendedFrom] 显式改建来源（cacheFrom 为空时补血缘用）
   * @param {string} [spec.resumedFrom] resume 来源 runId
   * @param {string} [spec.label]      显示名
   * @returns {Promise<{ id: string|null, status: string, diagnostics: any[], jobId?: string|null, resumedFrom?: string|null, amendedFrom?: string|null }>}  创建即返回，脚本在后台跑
   */
  async function start(spec) {
    const { script, parent } = spec
    if (!script) throw new Error('workflow start requires a script')
    if (!parent) throw new Error('workflow start requires a parent Agent')

    // 1. 编译先行：诊断直接拒绝，不创建任何记录。
    const { code, diagnostics } = await compileScript(script)
    if (diagnostics.length > 0) {
      return { id: null, status: STATUS.errored, diagnostics }
    }

    // 2. 建记录。
    const runId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const record = {
      id: runId,
      label: spec.label || 'workflow',
      status: STATUS.pending,
      script,
      args: spec.args || {},
      provider: spec.provider || null,
      // Agent.id 即共享的 agent/session id：amend/resume 据此把 parent 重新
      // 解析回原会话（面板重启后不需要再指定血缘）。
      parentSessionId: parent.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resumedFrom: spec.resumedFrom || null,
      // amend 换绑 parent 弃缓存时 cacheFrom 为空，但改建血缘仍要记在案。
      amendedFrom: spec.amendedFrom || (spec.cacheFrom ? spec.cacheFrom.id : null),
      steps: /** @type {any[]} */ ([]),
      log: /** @type {any[]} */ ([]),
      result: null,
      error: null,
      stopReason: null,
      // Set only while the run is asking the caller a question (answerQuestion).
      pendingQuestion: /** @type {Record<string, any>|null} */ (null),
    }

    // amend / resume 的缓存表：fingerprint → 缓存结果。
    const stepCache = new Map()
    if (spec.cacheFrom && Array.isArray(spec.cacheFrom.steps)) {
      for (const step of spec.cacheFrom.steps) {
        if (step && step.fingerprint && step.phase === 'after' && step.outcome !== undefined) {
          stepCache.set(step.fingerprint, step.outcome)
        }
      }
      appendLog(record, { kind: 'cache-loaded', count: stepCache.size, from: spec.cacheFrom.id })
    }
    if (spec.cacheNote) appendLog(record, { kind: 'cache-skipped', message: spec.cacheNote })

    // 3. 引擎：onStep 挂 journal + cache，onLog 挂日志。
    const controller = new AbortController()
    // ask() 的回答通道：问题挂起时 answer() resolve 它；abort 时 reject，
    // 免得停止运行还卡在一个永远没人回答的 Promise 上。
    // reject 句柄惰性创建：一个从没问过问题的 run 被 abort 时，不该留下一个
    // 无人处理的 rejection。
    /** @type {((value: any) => void)|null} */
    let questionResolve = /** @type {any} */ (null)
    /** @type {((reason?: any) => void)|null} */
    let questionReject = /** @type {any} */ (null)
    controller.signal.addEventListener('abort', () => {
      if (!questionReject) return
      questionReject(controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error('workflow aborted while asking'))
    }, { once: true })
    /** @type {(text: string) => Promise<any>} */
    const onAsk = (text) => {
      record.pendingQuestion = { text, at: Date.now() }
      appendLog(record, { kind: 'question', message: text })
      persist(record)
      if (controller.signal.aborted) return Promise.reject(new Error('workflow aborted while asking'))
      return Promise.race([
        new Promise((resolve) => { questionResolve = resolve }),
        new Promise((_, reject) => { questionReject = reject }),
      ])
    }
    // 回答一个挂起的问题；没有挂起的问题时返回 false（answer 是幂等无害的）。
    /** @param {string} text - the answer text. */
    function answerQuestion(text) {
      if (!questionResolve) return false
      record.pendingQuestion = null
      appendLog(record, { kind: 'question-answered', message: String(text) })
      persist(record)
      questionReject = null
      const resolve = questionResolve
      questionResolve = null
      resolve(String(text))
      return true
    }
    const runner = createRunner({
      ctx,
      parent,
      signal: controller.signal,
      semaphore: globalSem,
      provider: spec.provider || undefined,
      onAsk,
      onStep: (e) => {
        if (e.phase === 'before') {
          const cached = stepCache.get(e.fingerprint)
          if (cached !== undefined) {
            appendLog(record, { kind: 'cache-hit', fingerprint: e.fingerprint })
            // 命中也要作为本 run 自己的一个 after 步骤进 journal：链式
            // amend/resume 只从**上一代** journal 取缓存，不落盘的命中会让
            // 缓存传递性断代（隔代重花已付费的步骤）、stepCount 少计。
            record.steps.push({
              kind: e.kind, site: e.site, fingerprint: e.fingerprint,
              prompt: e.prompt, opts: e.opts,
              phase: 'after', outcome: cached, cached: true,
              ts: Date.now(),
            })
            return { cached: true, value: cached }
          }
          record.steps.push({ ...e, ts: Date.now() })
          return undefined
        }
        // after：记录结果，落盘。
        const entry = { ...e, ts: Date.now() }
        record.steps.push(entry)
        appendLog(record, { kind: 'step-done', fingerprint: e.fingerprint, durationMs: e.durationMs })
        persist(record)
        return undefined
      },
      onLog: (e) => {
        appendLog(record, e)
      },
    })

    record.status = STATUS.running
    // settle 只跑一次：jobs 桥接和 start() 的调用方共用同一个 promise。双重 settle
    // 会让同一份脚本跑两遍、agent 调用翻倍。
    //
    // 顺序是承重的：`settle(runId)` 一进来就 `active.get(runId)`，所以必须先把
    // handle 注册进 active，再启动这个异步 IIFE——否则 settle 看不到句柄、直接
    // 返回，done 立即 resolve 而脚本从未跑过。`done` 属性因此从 null 起步，用
    // typedef 声明成 `Promise<any>|null`，赋值后 TS 才允许在闭包里 `.then()`。
    /** @type {RunHandle} */
    const handle = { record, controller, runner, code, done: null, settled: false, answerQuestion }
    active.set(runId, handle)
    handle.done = (async () => {
      await settle(runId)
      return formatCompletion(record)
    })().catch(() => {})

    // 4. 桥接宿主 jobs：缺服务时降级为纯 promise（不挂死，与插件其余面板一致）。
    // owner 自 dsh 0.1.7 起是 SessionId（宿主按 id 校验当前注册的活跃 Agent），
    // 不再收 Agent 实例——Agent.id 即共享的 agent/session id。
    let jobId = null
    const jobs = ctx.get('jobs')
    if (jobs) {
      try {
        jobId = jobs.start({
          kind: 'workflow',
          label: record.label,
          owner: parent.id,
          run: () => ({
            cancel: (/** @type {string} */ reason) => { controller.abort(reason || 'workflow cancelled') },
            // JobHooks.done 的契约值是 JobOutcome{status:'completed'|'killed'|'failed', output?}。
            done: (handle.done ?? Promise.resolve()).then(() => ({
              status: record.status === STATUS.completed ? 'completed'
                : record.status === STATUS.stopped ? 'killed'
                : 'failed',
              output: formatCompletion(record),
            })),
          }),
        })
      } catch {
        // jobs 注册失败不阻塞运行本身。
        appendLog(record, { kind: 'jobs-unavailable' })
      }
    }
    handle.jobId = jobId

    persist(record)
    return {
      id: runId,
      status: record.status,
      diagnostics: [],
      jobId,
      resumedFrom: record.resumedFrom,
      amendedFrom: record.amendedFrom,
    }
  }

  /** @param {string} runId - the run id to settle. */
  async function settle(runId) {
    const handle = active.get(runId)
    if (!handle || handle.settled) return
    handle.settled = true
    const { record, runner, controller, code } = handle
    const startedAt = Date.now()

    try {
      record.status = STATUS.running
      record.updatedAt = Date.now()
      const value = await runner.run(code, record.args)
      if (controller.signal.aborted) {
        record.status = STATUS.stopped
        record.stopReason = 'cancelled'
      } else {
        record.status = STATUS.completed
        record.result = value
        record.stopReason = 'completed'
      }
    } catch (err) {
      if (controller.signal.aborted) {
        record.status = STATUS.stopped
        record.stopReason = 'cancelled'
      } else {
        record.status = STATUS.errored
        record.error = String(err && err.message || err)
        record.stopReason = 'error'
        appendLog(record, { kind: 'run-error', message: record.error })
      }
    } finally {
      record.updatedAt = Date.now()
      record.durationMs = Date.now() - startedAt
      active.delete(runId)
      await persist(record)
    }
  }

  // ─── 控制 ──────────────────────────────────────────────────────────────────

  // 同一 runId 的生命周期操作（stop / amend / resume）过一把进程内互斥锁：
  // 两个并发 amend、或 amend 与 stop/resume 赛跑时，双方都会通过"handle 还在 /
  // journal 已落定"的检查然后各自 start 一份新运行——双跑、子代理花费翻倍。
  // 锁只做串行化；「这个 run 已经被改建/续跑过」由 hasDerivedActiveRun 拒绝。
  /** @type {Map<string, Promise<unknown>>} */
  const runLocks = new Map()
  /**
   * @template T
   * @param {string} runId
   * @param {() => Promise<T> | T} operation
   * @returns {Promise<T>}
   */
  async function withRunLock(runId, operation) {
    const previous = runLocks.get(runId) ?? Promise.resolve()
    const gate = previous.then(() => operation(), () => operation())
    runLocks.set(runId, gate)
    try {
      return await gate
    } finally {
      // 只在自己还是队尾时清表：后续操作已把 Map 指向新的 gate。
      if (runLocks.get(runId) === gate) runLocks.delete(runId)
    }
  }

  /** 是否已有以 runId 为改建/续跑来源的**活跃**运行（防同一 journal 被双开）。
   * @param {string} runId - the source run id.
   * @returns {boolean} */
  function hasDerivedActiveRun(runId) {
    for (const handle of active.values()) {
      const derived = handle.record
      if (derived.amendedFrom === runId || derived.resumedFrom === runId) return true
    }
    return false
  }

  /** 停止运行（amend / 用户取消）。部分输出保留在 journal 里。
   * @param {string} runId - the run id to stop.
   * @param {string} reason - the stop reason. */
  function stop(runId, reason) {
    return withRunLock(runId, () => stopInner(runId, reason))
  }

  /** stop 的实现体；amendInner 在已持有锁的路径上调用，避免自锁。
   * @param {string} runId - the run id to stop.
   * @param {string} reason - the stop reason. */
  async function stopInner(runId, reason) {
    const handle = active.get(runId)
    if (!handle) return { stopped: false, reason: 'not running' }
    handle.controller.abort(reason || 'stopped')
    if (!handle.done) return { stopped: true, reason: reason || 'stopped' }
    // 等运行落定、journal 写完——但只等一个预算。abort 只能打断信号感知的
    // 操作，纯 JS 死循环等不到落定：预算到点就放弃等待（句柄留给 settle 的
    // finally 在脚本自行结束时清理），把「已请求停止」和「已确认落定」分开
    // 上报，调用方不再被卡死脚本无限挂住。
    //
    // 定时器必须在 done 抢先时清掉：不清的话每次 stop/amend 都在事件循环里
    // 留下一个仍被引用的 Timeout（最长 stopSettleTimeoutMs），裸进程里还会把
    // 事件循环多撑满一个预算。竞速赢了就没有理由继续持有它。
    /** @type {ReturnType<typeof setTimeout>|null} */
    let budgetTimer = /** @type {any} */ (null)
    const settled = await Promise.race([
      (handle.done ?? Promise.resolve()).then(() => true),
      // 不 unref：调用方正阻塞在本预算上，裸进程（测试）里 unref 会让定时器
      // 永远不触发；预算到点必须真的醒来。
      new Promise((resolve) => { budgetTimer = setTimeout(() => resolve(false), stopSettleTimeoutMs) }),
    ]).finally(() => { if (budgetTimer !== null) clearTimeout(budgetTimer) })
    // done 只在 settle() 跑完后 resolve；handle.settled 在 settle 进入时就置位，
    // 不能当「已落定」用——用终态 status 兜住竞速窗口（落定即离开 running）。
    if (settled || handle.record.status !== STATUS.running) return { stopped: true, reason: reason || 'stopped' }
    appendLog(handle.record, {
      kind: 'stop-abandoned',
      message: `abort 已送达，但运行在 ${stopSettleTimeoutMs}ms 内未落定（脚本忽略取消信号？）——已终止脚本执行线程并落定记录`,
    })
    // 脚本在 worker 线程里跑：预算到点直接 terminate，把微任务自旋这类不可
    // 抢占的脚本连 isolate 一起回收——run() 以错误落定 → settle 的 catch 把
    // 记录判 stopped 落盘。绝不会再留下"永远在跑"的僵尸句柄。
    handle.runner?.terminate?.()
    /** @type {ReturnType<typeof setTimeout>|null} */
    let reapTimer = /** @type {any} */ (null)
    await Promise.race([
      (handle.done ?? Promise.resolve()).then(() => true, () => true),
      new Promise((resolve) => { reapTimer = setTimeout(() => resolve(false), 2_000) }),
    ]).finally(() => { if (reapTimer !== null) clearTimeout(reapTimer) })
    return { stopped: true, reason: reason || 'stopped', abandoned: true }
  }

  /**
   * amend：停旧 run → 以旧 journal 为缓存源起新 run。
   * 已完成且指纹未变的步骤直接命中缓存，不重花 agent 调用。
   * @param {string} runId - the source run id.
   * @param {string} newScript - the replacement script.
   * @param {object} [opts] - amend options.
   * @param {Record<string, any>} [opts.parent] - the parent Agent (callers always pass it).
   * @param {Record<string, any>} [opts.args]
   * @param {string} [opts.provider]
   * @param {string} [opts.label]
   */
  function amend(runId, newScript, opts = {}) {
    return withRunLock(runId, () => amendInner(runId, newScript, opts))
  }

  /** @param {string} runId - the source run id.
   * @param {string} newScript - the replacement script.
   * @param {object} [opts] - amend options.
   * @param {Record<string, any>} [opts.parent] - the parent Agent (callers always pass it).
   * @param {Record<string, any>} [opts.args]
   * @param {string} [opts.provider]
   * @param {string} [opts.label] */
  async function amendInner(runId, newScript, opts = {}) {
    // 先停旧 run 并等它落定（journal 写完），再读盘取完整 journal 作缓存源。
    // 只让一个 tick 的话 abort 传播未完成，会拿到残缺 journal、新旧双跑；
    // 旧 run 在预算内等不到落定（脚本忽略取消信号）时直接拒绝——否则残缺
    // journal + 新旧双跑正是这里要防的事态。
    const handle = active.get(runId)
    if (handle) {
      const stopResult = await stopInner(runId, 'amended')
      if (stopResult.abandoned) {
        throw new Error(`workflow run ${runId} did not settle within ${stopSettleTimeoutMs}ms after abort (the script ignores cancellation?) — amend refused to avoid double-running; stop the run and resume from its journal once it ends`)
      }
    }
    // 缓存双开防线：上一个以 runId 为来源的 amend/resume 还在跑时，同一份
    // journal 不允许再开一份（互斥锁挡住的是赛跑，这里挡住的是重放）。
    if (hasDerivedActiveRun(runId)) {
      throw new Error(`workflow run ${runId} already has an active amended/resumed run — stop that run first`)
    }

    const old = loadRecord(runId)
    if (!old) throw new Error(`workflow run not found: ${runId}`)
    // The new run's parent is mandatory (start enforces it too); fail here with
    // a message naming the operation instead of the generic start error.
    const parent = opts.parent
    if (!parent) throw new Error(`workflow amend requires a parent Agent`)
    const { cacheFrom, cacheNote } = cacheSourceFor(old, opts)
    return start({
      script: newScript,
      parent,
      args: opts.args || old.args,
      provider: opts.provider || old.provider,
      label: opts.label || old.label,
      cacheFrom,
      cacheNote,
      // 弃缓存时血缘仍要落在新记录上（cacheFrom 为空会让 start 推不出来源）。
      ...(cacheFrom === null ? { amendedFrom: runId } : {}),
    })
  }

  /**
   * resume：stopped/errored 的 run 用自己的 journal 作缓存源重跑。
   * 与 amend 的区别是脚本不变，只是从断点继续。
   * @param {string} runId - the source run id.
   * @param {object} [opts] - resume options.
   * @param {Record<string, any>} [opts.parent] - the parent Agent (callers always pass it).
   * @param {Record<string, any>} [opts.args]
   * @param {string} [opts.provider]
   * @param {string} [opts.label]
   */
  function resume(runId, opts = {}) {
    return withRunLock(runId, () => resumeInner(runId, opts))
  }

  /** @param {string} runId - the source run id.
   * @param {object} [opts] - resume options.
   * @param {Record<string, any>} [opts.parent] - the parent Agent (callers always pass it).
   * @param {Record<string, any>} [opts.args]
   * @param {string} [opts.provider]
   * @param {string} [opts.label] */
  async function resumeInner(runId, opts = {}) {
    if (hasDerivedActiveRun(runId)) {
      throw new Error(`workflow run ${runId} already has an active amended/resumed run — stop that run first`)
    }
    const old = loadRecord(runId)
    if (!old) throw new Error(`workflow run not found: ${runId}`)
    if (old.status === STATUS.running) throw new Error('cannot resume a running workflow')
    const parent = opts.parent
    if (!parent) throw new Error(`workflow resume requires a parent Agent`)
    const { cacheFrom, cacheNote } = cacheSourceFor(old, opts)
    return start({
      script: old.script,
      parent,
      args: opts.args || old.args,
      provider: opts.provider || old.provider,
      label: old.label,
      cacheFrom,
      cacheNote,
      resumedFrom: runId,
    })
  }

  /**
   * amend/resume 的缓存源裁决：换绑到不同 parent 会话时**整体弃用**缓存——
   * 指纹不绑定会话，shell 的隐式 workdir、agent 的工作区血缘都来自 parent，
   * 跨会话复用会把上一个会话语境下的结果当作命中。同 parent（含 restart 后
   * 按 parentSessionId 重新解析回同一会话）照常命中。
   * @param {Record<string, any>} old - the old run record.
   * @param {{ parent?: Record<string, any> }} opts - the amend/resume options (`parent`).
   * @returns {{ cacheFrom: { id: string, steps: any[] } | null, cacheNote: string | null }}
   */
  function cacheSourceFor(old, opts) {
    const nextParent = opts.parent
    if (nextParent && old.parentSessionId && nextParent.id !== old.parentSessionId) {
      return {
        cacheFrom: null,
        cacheNote: `parent session changed (${old.parentSessionId} → ${nextParent.id}) — step cache dropped so no result from the old session's context is served`,
      }
    }
    return { cacheFrom: { id: old.id, steps: old.steps }, cacheNote: null }
  }

  // ─── 查询 ──────────────────────────────────────────────────────────────────

  /**
   * 等待一个活跃 run 落定（完成 / 失败 / 停止）。已落定或未知 id 立刻 resolve：
   * 调用方（agent 工具的 wait 选项）只想在 run 真的还在跑时多等一会。
   * @param {string} runId
   * @returns {Promise<void>}
   */
  function join(runId) {
    const handle = active.get(runId)
    return handle && handle.done ? handle.done.then(() => {}, () => {}) : Promise.resolve()
  }

  /**
   * 回答一个挂起的问题（facade.ask）。非活跃 run / 没有挂起问题时返回
   * { answered: false, error }，调用方据此判断是「回答晚了」还是「根本没问」。
   * @param {string} runId
   * @param {string} text
   */
  function answer(runId, text) {
    const handle = active.get(runId)
    if (!handle) return { answered: false, error: 'run is not active (already settled, or not started in this process)' }
    if (!handle.answerQuestion) return { answered: false, error: 'run has no question channel' }
    return handle.answerQuestion(text)
      ? { answered: true }
      : { answered: false, error: 'run is not asking anything right now' }
  }

  function list() {
    // 磁盘全量（重启后 stopped/errored 的 run 仍可列出）+ 内存活跃态覆盖
    // （更新更频繁）。落盘时还是 running 的记录已无活句柄，标记 orphaned。
    //
    // 优先读**摘要侧车**：journal 装着每步的 prompt 与完整 outcome，整读+解析
    // 200 个 ~180KB 的运行要 69 ms（实测），而侧车只有 13 个标量字段。这是宿主
    // 线程上的同步读，面板轮询会反复触发。
    const items = new Map()
    /** @type {string[]} */
    let files = []
    try { files = readdirSync(dir) } catch { /* 目录不可读时至少返回活跃态 */ }
    for (const file of files) {
      if (!file.endsWith('.json') || file.endsWith(SUMMARY_SUFFIX)) continue
      const runId = file.slice(0, -'.json'.length)
      // 1. the sidecar, when this run has one (everything written by this build).
      const sidecar = summaryPath(runId)
      const summarized = sidecar === null ? null : readJsonIfExists(sidecar)
      if (summarized !== null && typeof summarized.id === 'string') {
        if (summarized.status === STATUS.running) summarized.status = 'orphaned'
        items.set(summarized.id, summarized)
        continue
      }
      // 2. FALLBACK: a run from an older build has no sidecar. Read it whole, and
      //    do NOT write a sidecar here — list() is a read path (the panel and
      //    /workflow runs call it), and a reader must not mutate the store. The
      //    cost is one full read per legacy run per list() call, which the next
      //    persist() of that run would end; stopped runs never persist again, so
      //    accept it rather than turning a read into a write.
      const rec = readJsonIfExists(joinPath(dir, file))
      if (!rec || typeof rec.id !== 'string') continue
      if (rec.status === STATUS.running) rec.status = 'orphaned'
      // `summarize()` counts steps, and steps now live in the JSONL rather than
      // in the journal — so a journal read on its own would report stepCount 0.
      // (The parity test caught exactly this: the sidecar path said 2, the
      // fallback said 0.) Only the count is needed here, not the entries.
      if (!Array.isArray(rec.steps)) {
        const counted = readStepsFile(runId)
        rec.steps = counted === null ? [] : counted
      }
      items.set(rec.id, summarize(rec))
    }
    for (const [id, handle] of active) items.set(id, summarize(handle.record))
    return [...items.values()]
  }

  /** @param {string} runId - the run id. */
  function get(runId) {
    const handle = active.get(runId)
    if (handle) {
      const r = summarize(handle.record)
      // 活跃态补 script：面板对运行中的 run 点「改建」要回填脚本编辑器
      // （summarize 保持精简，list() 不该拖整个脚本体）。
      r.script = handle.record.script
      r.log = handle.record.log || []
      return r
    }
    const onDisk = loadRecord(runId)
    if (onDisk) {
      if (onDisk.status === STATUS.running) {
        // 进程重启后 running 记录已经没有活句柄了。
        onDisk.status = 'orphaned'
      }
      return onDisk
    }
    return null
  }

  /**
   * 卸载/停用本模块时把所有活跃 run 一并拆掉：先 abort（协作脚本走正常落定
   * 路径、journal 照常落盘），再 terminate 执行线程（忽略取消信号的脚本不能
   * 在模块生命周期之外继续烧子代理调用——registry 已随模块卸载，之后的
   * stop() 再也够不到这些句柄，不停就是僵尸直到进程重启）。
   */
  function disposeAll() {
    for (const handle of active.values()) {
      try { handle.controller.abort('plugin-admin: workflow module unloaded') } catch { /* already aborted */ }
      try { handle.runner?.terminate?.() } catch { /* already gone */ }
    }
  }

  return { start, stop, amend, resume, join, answer, list, get, disposeAll, STATUS }
}

/** @param {Record<string, any>} record - a run record (disk or live).
   * @returns {{
   *   id: any, label: any, status: any, createdAt: any, updatedAt: any,
   *   durationMs: any, stepCount: number, resumedFrom: any, amendedFrom: any,
   *   parentSessionId: any, result: any, error: any, stopReason: any,
   *   pendingQuestion: any, script?: any, log?: any[],
   * }} */
function summarize(record) {
  return {
    id: record.id,
    label: record.label,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    durationMs: record.durationMs || null,
    stepCount: (record.steps || []).length,
    resumedFrom: record.resumedFrom || null,
    amendedFrom: record.amendedFrom || null,
    parentSessionId: record.parentSessionId || null,
    result: record.result !== undefined ? record.result : null,
    error: record.error || null,
    stopReason: record.stopReason || null,
    pendingQuestion: record.pendingQuestion || null,
  }
}

/** @param {Record<string, any>} record - a run record. */
function formatCompletion(record) {
  const steps = (/** @type {any[]} */ (record.steps || [])).filter((s) => s.phase === 'after').length
  if (record.status === STATUS.completed) {
    return `workflow "${record.label}" completed in ${steps} steps`
  }
  return `workflow "${record.label}" ${record.status}${record.error ? `: ${record.error}` : ''}`
}
