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
import { readdirSync } from 'node:fs'
import { createRunner, compileScript, createSemaphore, stepFingerprint } from './workflow-engine.js'
import { runsDir, readJsonIfExists, atomicWriteJson } from './workflow-engine.js'

const STATUS = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  errored: 'errored',
  stopped: 'stopped',
}

const MAX_LOG_ENTRIES = 500

/**
 * 创建运行注册表。
 *
 * @param {object} deps
 * @param {object} deps.ctx          Cordis Context
 * @param {function} deps.enqueue    共享串行队列（写盘用，与插件其余模块同一个）
 * @param {string} deps.dshHome      $DSH_HOME
 * @param {number} [deps.maxConcurrency] 单个 run 内的并发上限
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

  /** 合法 runId 的落盘路径；形状不合法返回 null（调用方按不存在处理）。 */
  function runPath(runId) {
    return typeof runId === 'string' && RUN_ID_PATTERN.test(runId)
      ? joinPath(dir, `${runId}.json`)
      : null
  }

  function loadRecord(runId) {
    const path = runPath(runId)
    return path !== null ? readJsonIfExists(path) : null
  }

  function persist(record) {
    // 写盘走串行队列：读-改-写不交错，与 patch-utils 的写入策略一致。
    return enqueue(() => {
      const snapshot = {
        ...record,
        activeSteps: undefined,
        journal: undefined,
      }
      snapshot.steps = record.steps || []
      snapshot.log = (record.log || []).slice(-MAX_LOG_ENTRIES)
      atomicWriteJson(runPath(record.id), snapshot)
    })
  }

  function appendLog(record, entry) {
    record.log = record.log || []
    record.log.push({ ...entry, ts: Date.now() })
    if (record.log.length > MAX_LOG_ENTRIES) record.log = record.log.slice(-MAX_LOG_ENTRIES)
  }

  // ─── 启动一次运行 ──────────────────────────────────────────────────────────

  /**
   * @param {object} spec
   * @param {string} spec.script       脚本体（TS/JS 源码）
   * @param {object} spec.parent       Agent — 子代理的 parent
   * @param {object} [spec.args]       传给脚本的 args
   * @param {string} [spec.provider]   subagent provider
   * @param {object} [spec.cacheFrom]  amend 来源：旧 run 的 journal（{steps:[...]})
   * @param {string} [spec.resumedFrom] resume 来源 runId
   * @param {string} [spec.label]      显示名
   * @returns {Promise<{ id, status, diagnostics }>}  创建即返回，脚本在后台跑
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
      amendedFrom: spec.cacheFrom ? spec.cacheFrom.id : null,
      steps: [],
      log: [],
      result: null,
      error: null,
      stopReason: null,
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

    // 3. 引擎：onStep 挂 journal + cache，onLog 挂日志。
    const controller = new AbortController()
    // ask() 的回答通道：问题挂起时 answer() resolve 它；abort 时 reject，
    // 免得停止运行还卡在一个永远没人回答的 Promise 上。
    // reject 句柄惰性创建：一个从没问过问题的 run 被 abort 时，不该留下一个
    // 无人处理的 rejection。
    let questionResolve = null
    let questionReject = null
    controller.signal.addEventListener('abort', () => {
      if (!questionReject) return
      questionReject(controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error('workflow aborted while asking'))
    }, { once: true })
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
    const handle = { record, controller, runner, code, done: null, settled: false, answerQuestion }
    active.set(runId, handle)

    // settle 只跑一次：jobs 桥接和 start() 的调用方共用同一个 promise。
    // 双重 settle 会让同一份脚本跑两遍、agent 调用翻倍。
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
            cancel: (reason) => { controller.abort(reason || 'workflow cancelled') },
            // JobHooks.done 的契约值是 JobOutcome{status:'completed'|'killed'|'failed', output?}。
            done: handle.done.then(() => ({
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

  /** 停止运行（amend / 用户取消）。部分输出保留在 journal 里。 */
  async function stop(runId, reason) {
    const handle = active.get(runId)
    if (!handle) return { stopped: false, reason: 'not running' }
    handle.controller.abort(reason || 'stopped')
    if (!handle.done) return { stopped: true, reason: reason || 'stopped' }
    // 等运行落定、journal 写完——但只等一个预算。abort 只能打断信号感知的
    // 操作，纯 JS 死循环等不到落定：预算到点就放弃等待（句柄留给 settle 的
    // finally 在脚本自行结束时清理），把「已请求停止」和「已确认落定」分开
    // 上报，调用方不再被卡死脚本无限挂住。
    const settled = await Promise.race([
      handle.done.then(() => true),
      // 不 unref：调用方正阻塞在本预算上，裸进程（测试）里 unref 会让定时器
      // 永远不触发；预算到点必须真的醒来。
      new Promise((resolve) => { setTimeout(() => resolve(false), stopSettleTimeoutMs) }),
    ])
    // done 只在 settle() 跑完后 resolve；handle.settled 在 settle 进入时就置位，
    // 不能当「已落定」用——用终态 status 兜住竞速窗口（落定即离开 running）。
    if (settled || handle.record.status !== STATUS.running) return { stopped: true, reason: reason || 'stopped' }
    appendLog(handle.record, {
      kind: 'stop-abandoned',
      message: `abort 已送达，但运行在 ${stopSettleTimeoutMs}ms 内未落定（脚本忽略取消信号？）——stop/amend 已停止等待，脚本可能仍在执行`,
    })
    await persist(handle.record).catch(() => {})
    return { stopped: true, reason: reason || 'stopped', abandoned: true }
  }

  /**
   * amend：停旧 run → 以旧 journal 为缓存源起新 run。
   * 已完成且指纹未变的步骤直接命中缓存，不重花 agent 调用。
   */
  async function amend(runId, newScript, opts = {}) {
    // 先停旧 run 并等它落定（journal 写完），再读盘取完整 journal 作缓存源。
    // 只让一个 tick 的话 abort 传播未完成，会拿到残缺 journal、新旧双跑；
    // 旧 run 在预算内等不到落定（脚本忽略取消信号）时直接拒绝——否则残缺
    // journal + 新旧双跑正是这里要防的事态。
    const handle = active.get(runId)
    if (handle) {
      const stopResult = await stop(runId, 'amended')
      if (stopResult.abandoned) {
        throw new Error(`workflow run ${runId} did not settle within ${stopSettleTimeoutMs}ms after abort (the script ignores cancellation?) — amend refused to avoid double-running; stop the run and resume from its journal once it ends`)
      }
    }

    const old = loadRecord(runId)
    if (!old) throw new Error(`workflow run not found: ${runId}`)

    return start({
      script: newScript,
      parent: opts.parent,
      args: opts.args || old.args,
      provider: opts.provider || old.provider,
      label: opts.label || old.label,
      cacheFrom: { id: runId, steps: old.steps },
    })
  }

  /**
   * resume：stopped/errored 的 run 用自己的 journal 作缓存源重跑。
   * 与 amend 的区别是脚本不变，只是从断点继续。
   */
  async function resume(runId, opts = {}) {
    const old = loadRecord(runId)
    if (!old) throw new Error(`workflow run not found: ${runId}`)
    if (old.status === STATUS.running) throw new Error('cannot resume a running workflow')

    return start({
      script: old.script,
      parent: opts.parent,
      args: opts.args || old.args,
      provider: opts.provider || old.provider,
      label: old.label,
      cacheFrom: { id: runId, steps: old.steps },
      resumedFrom: runId,
    })
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
    const items = new Map()
    let files = []
    try { files = readdirSync(dir) } catch { /* 目录不可读时至少返回活跃态 */ }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const rec = readJsonIfExists(joinPath(dir, file))
      if (!rec || typeof rec.id !== 'string') continue
      if (rec.status === STATUS.running) rec.status = 'orphaned'
      items.set(rec.id, summarize(rec))
    }
    for (const [id, handle] of active) items.set(id, summarize(handle.record))
    return [...items.values()]
  }

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

  return { start, stop, amend, resume, join, answer, list, get, STATUS }
}

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

function formatCompletion(record) {
  const steps = (record.steps || []).filter((s) => s.phase === 'after').length
  if (record.status === STATUS.completed) {
    return `workflow "${record.label}" completed in ${steps} steps`
  }
  return `workflow "${record.label}" ${record.status}${record.error ? `: ${record.error}` : ''}`
}
