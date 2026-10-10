/**
 * workflow-engine.js — ZCode 风格动态工作流引擎核心
 *
 * agent 现场写 TS 脚本 → esbuild 转译 → 独立线程里的 node:vm realm 执行 → 成百上千子代理并行。
 * 执行底座是 ctx.subagents（宿主原生并行 + 可续接），不是 ctx.workflowEngine
 * （后者前台阻塞、一次性，挂不上 amend/resume）。
 *
 * 本文件只负责「把一段脚本跑完」：
 *   - compileScript()    脚本体 → 可执行的函数字符串（宿主 peer 的 esbuild），诊断直接拒绝
 *   - createRunner()     构造 facade + worker 线程桥，返回 run(record) / terminate()
 *   - facade             agent / parallel / pipeline / phase / log / report / shell
 *
 * 隔离强度（别把它读成沙箱）：脚本跑在 **worker 线程内的 node:vm realm** 里，没有
 * process / fetch / require / fs 等宿主全局，所有跨桥值一律折成 JSON 文本，所以脚本
 * 拿不到任何带宿主原型的对象；同步前缀由 V8 的 vm timeout 设预算。**线程边界才是
 * 可抢占性的来源**：微任务自旋循环（`while(true){ await 0 }`）在任何单线程事件循环
 * 上都不可抢占，主线程上的所有用户态兜底（定时器）都会被它饿死——放在 worker 里它只
 * 冻住自己，stop()/eval 预算到点 `terminate()` 即可回收。但它与宿主**同用户、同信任
 * 级**，脚本真正的权力来自 facade（`shell()` 会跑真实宿主命令），刻意逃逸不属于防御
 * 目标——realm 防"意外拿到宿主能力"，线程防"失控拖垮宿主"。
 *
 * 生命周期（journal / 状态机 / amend / resume）在 workflow-runs.js；本引擎只暴露
 * step cache 挂钩点，让上层决定已完成步骤是否跳过重跑。
 *
 * 零 dsh 导入，全部骑运行时 Cordis Context（与插件其余模块同风格）。
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { writeJsonAtomic, messageOf} from './patch-utils.js'
import { resolveShellSandboxPolicy } from './shell-policy.js'
import { FACADE_PARAMS, WORKFLOW_BRIDGE_MAX_CHARS, jsonSafeValue } from './workflow-realm-shared.js'

/**
 * 脚本终值的字符预算。worker 的 1GiB 堆帽只护脚本 isolate；终值跨回宿主后要
 * 全文进 journal、全文走 get() 与 jobs 完成通知，无帽时聚合型返回会让宿主
 * 进程瞬时多份驻留。4M 字符（JSON.parse 后通常 2-5 倍内存）远超任何合理的
 * 编排产出，又给"返回全部步骤原文"的滥用留不出 OOM 空间；超帽按脚本错误
 * 落定，与 list 侧车的 240 字符投影帽是两条不同通道的各自护栏。
 */
const WORKFLOW_RESULT_MAX_CHARS = 4_000_000

// ─── 转译 ───────────────────────────────────────────────────────────────────

/**
 * 把脚本体包成 facade 调用签名，作为一整个 TS 单元转译。
 *
 * 为什么要「先包再译」：脚本的顶层 return 在 ESM 里非法，esbuild 会把它包成
 * __commonJS 模块，输出里出现 export default —— 拿到 new Function 里直接语法
 * 错误。先包进箭头函数，return 就是普通的函数返回，转译输出是干净的表达式。
 * @param {string} scriptBody - the script body authored by the agent.
 * @param {string} [label] - filename for diagnostics (defaults to workflow.ts).
 * @returns {Promise<{ code: string|null; diagnostics: Array<Record<string, unknown>>; }>}
 */
export async function compileScript(scriptBody, label) {
  let esbuild
  try {
    esbuild = await import('esbuild')
  } catch {
    // peer 缺失时的降级：只做保守的 TS 特征检测，有特征就拒绝（没法转译）。
    if (looksLikeTs(scriptBody)) {
      return {
        code: null,
        diagnostics: [{
          category: 'error',
          message: 'esbuild unavailable in host (peer dependency missing); cannot transpile TypeScript workflow scripts',
        }],
      }
    }
    return { code: wrapScript(scriptBody), diagnostics: [] }
  }

  try {
    const result = await esbuild.transform(wrapScript(scriptBody), {
      loader: 'ts',
      // 不设 format：脚本体已被包成函数表达式，不需要任何模块包装。
      target: 'node20.19',
      sourcemap: 'inline',
      sourcesContent: false,
    })
    return { code: result.code, diagnostics: [] }
  } catch (err) {
    const esbuildErrors = /** @type {Array<Record<string, any>>} */ ((/** @type {any} */ (err)).errors || [])
    /** @type {Array<{ category: string, message: unknown, location?: string }>} */
    const diagnostics = esbuildErrors.map((e) => ({
      category: 'error',
      message: e.text,
      ...(e.location ? { location: `${label || 'workflow.ts'}:${e.location.line - 1}:${e.location.column}` } : {}),
    }))
    if (diagnostics.length === 0) diagnostics.push({ category: 'error', message: String(err && err.message || err) })
    return { code: null, diagnostics }
  }
}

/**
 * Wrap the script body in the facade signature the engine invokes.
 * @param {string} body - the script body.
 * @returns {string} the wrapped TypeScript source unit.
 */
function wrapScript(body) {
  // 命名函数声明而非箭头表达式：链接侧用语句位置 `return workflow_main`，
  // 对转译产物尾部的分号 + sourcemap 注释完全免疫。
  return `async function workflow_main(${FACADE_PARAMS.join(', ')}) {\n${body}\n}`
}

/**
 * Pure TS-feature heuristic, used ONLY when esbuild is unavailable: with no
 * transpiler, a script carrying TypeScript syntax must be refused explicitly
 * rather than handed to `new Function` (where it fails as a syntax error with no
 * useful message). Exported so the fallback branch has a test — esbuild's
 * absence is otherwise untestable in-process.
 * @param {string} script - the workflow script body.
 * @returns {boolean} whether it looks like TypeScript.
 */
export function looksLikeTs(script) {
  return /(?:^|[\s;])(?:interface|type|enum|implements|namespace|declare|abstract)\s+\w+/.test(script)
    || /[:<]\s*(?:string|number|boolean|any|unknown|never|void)\b/.test(script)
    // `name: Type` / `name: Type[]` annotations: the token after the colon starts
    // with a TYPE name (capitalized, or an array of an identifier), which a JS
    // object literal or a label does not do (`{ name: "x" }` stays JS).
    || /\w+\s*:\s*(?:[A-Z][\w$]*|[A-Za-z_$][\w$]*(?=\s*\[\]))/.test(script)
    // Generic CALL syntax (`agent<Result>(…)`). A bare `x: Foo<Bar>` is covered
    // above; requiring the type argument to be capitalized AND followed by a call
    // keeps `a < B > c` (a comparison) from being read as a type argument list.
    //
    // Two gaps were found by pinning this function (see
    // scripts/verify-workflow-engine.mjs): `agent<Result>("x")` and
    // `const rows: Row[] = []` both used to slip through and reach
    // `new Function()`, where they surfaced as a bare syntax error instead of the
    // "esbuild unavailable" diagnostic. The remaining cost of this pattern is the
    // rare false positive (`{ View: MyClass }`), which only ever fails LOUD in the
    // no-esbuild mode — never silently.
    || /[A-Za-z_$][\w$]*\s*<\s*[A-Z][\w$]*(\s*,\s*[A-Z][\w$]*)*\s*>\s*\(/.test(script)
}

// ─── 并发信号量 ──────────────────────────────────────────────────────────────

/**
 * 简单计数信号量：ctx.subagents 本身没有并发上限，ZCode 的 max_concurrency 是
 * 核心控制点，这里补上。
 *
 * intentional-simple: FIFO 队列 + 计数器。不做优先级、不做公平性保证。
 * 单引擎实例内生效；多个并行 run 之间的总上限由 runs 层再套一层。
 * @typedef {{
 *   acquire: () => Promise<void>,
 *   release: () => void,
 *   runThunks: (thunks: any) => Promise<any[]>,
 *   activeOf: () => number,
 *   limitOf: () => number,
 * }} Semaphore
 */
/**
 * @param {number} limit - 同时活跃的最大 thunk 数。
 * @returns {Semaphore}
 */
export function createSemaphore(limit) {
  let active = 0
  /** @type {Array<() => void>} */
  const waiters = []
  const activeOf = () => active
  // worker 桥需要把上限数值带进 realm（realm 侧 parallel/pipeline 用自己的
  // 信号量逐行对齐这套语义）；缺这个访问器时引擎回落 DEFAULT_PARALLEL_LIMIT。
  const limitOf = () => limit

  function acquire() {
    if (active < limit) { active += 1; return Promise.resolve() }
    return new Promise((/** @type {(value?: unknown) => void} */ resolve) => { waiters.push(() => resolve()) })
  }

  function release() {
    active -= 1
    const next = waiters.shift()
    if (next !== undefined) { active += 1; next() }
  }

  /**
   * Run every thunk through the limiter, preserving input order.
   * A thunk that throws yields `null` in its slot (the facade's documented
   * "one failed step does not kill the run" semantics).
   * @param {any} thunks - the work items.
   * @returns {Promise<any[]>} one result per thunk, in order.
   */
  async function runThunks(thunks) {
    const results = await Promise.all(thunks.map(async (/** @type {any} */ thunk) => {
      try { await acquire() } catch { return null }
      try { return await thunk() } finally { release() }
    }))
    return results
  }

  return /** @type {Semaphore} */ ({ acquire, release, runThunks, activeOf, limitOf })
}

// ─── 步骤指纹（step cache 键）──────────────────────────────────────────────

/**
 * 确定性 JSON：对象键排序，循环引用降级为占位符。指纹要对"语义相同的 opts"
 * 产出同一个键，所以不能直接用 `JSON.stringify`（键序不同就不同键）。
 * @param {unknown} value
 * @param {Set<unknown>} [seen] - 循环引用检测集。
 * @returns {string}
 */
function canonicalJson(value, seen = new Set()) {
  // BigInt would make JSON.stringify THROW (it is not JSON-representable), and a
  // fingerprint must never turn a script's own bigint into a crash.
  if (typeof value === 'bigint') return value.toString() + 'n'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (seen.has(value)) return '"[circular]"'
  // Ancestor-stack discipline (add before recursing, remove after): `seen`
  // must hold the CURRENT chain only. Keeping entries forever marked a shared
  // (non-cyclic) reference — the same opts object appearing twice — as
  // "[circular]" on its second visit, degrading the fingerprint material
  // (two different values whose difference lands in the degraded slot still
  // hash apart, but the slot's content silently leaves the key).
  seen.add(value)
  try {
    if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item, seen)).join(',') + ']'
    const bag = /** @type {Record<string, unknown>} */ (value)
    return '{' + Object.keys(bag).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(bag[key], seen)).join(',') + '}'
  } finally {
    seen.delete(value)
  }
}

/**
 * 一步调用里"决定产出什么"的 opts 字段。
 *
 * 只列语义字段：agent() 的 provider / model / schema 决定这一步由谁、以什么
 * 形状产出；shell() 的 workdir / timeoutMs 决定命令在哪、跑多久。展示类字段
 * （label）不进键，免得改个显示名就重花一次子代理调用。
 *
 * 材料是**规范 JSON 数组**而不是拼接字符串：旧实现把 payload 与各字段用
 * `\u0000` 串起来，于是 `agent('x\u0000provider=openai')` 与
 * `agent('x', { provider: 'openai' })` 撞成同一个键（分隔符歧义）。数组形态让
 * 边界由结构而非字符保证。
 * @param {'agent'|'shell'|string} kind
 * @param {unknown} opts
 * @param {string} [defaultProvider] - amend/resume 的 run 级默认 provider（仅
 *   agent 步骤会传入）。掩蔽规则在这里裁决：调用点自带 provider 时不进键——
 *   选路由调用点说了算，run 级默认根本不参与。
 * @returns {unknown[]} 稳定的比较材料（无语义字段时为空数组）。
 */
function semanticOptsMaterial(kind, opts, defaultProvider) {
  const bag = opts !== null && typeof opts === 'object' ? /** @type {Record<string, unknown>} */ (opts) : null
  const runProvider = defaultProvider !== undefined && !(bag && bag.provider)
    ? defaultProvider
    : undefined
  if (bag === null) {
    // opts 缺席时 run 级默认 provider 仍然参与选路，不能跟着一起丢。
    return runProvider !== undefined ? ['defaultProvider', canonicalJson(runProvider)] : []
  }
  // `cwd` belongs to the AGENT list, not just the shell's: a subagent call that
  // runs in a different working directory can produce a different answer, so a
  // script amended from `{ cwd: '/a' }` to `{ cwd: '/b' }` must re-run that step
  // rather than serve the first directory's result.
  const fields = kind === 'shell'
    ? ['workdir', 'timeoutMs']
    : ['provider', 'model', 'schema', 'cwd']
  /** @type {unknown[]} */
  const parts = []
  for (const field of fields) {
    const value = bag[field]
    if (value === undefined || value === null) continue
    parts.push(field, canonicalJson(value))
  }
  if (runProvider !== undefined) parts.push('defaultProvider', canonicalJson(runProvider))
  return parts
}

/**
 * amend 时「未变步骤不重跑」的键：facade 调用点 + 参数 + **改变调用语义的 opts**。
 * 调用点序号由 realm 侧在发起调用的瞬间按出现顺序分配、随 invoke 过桥（并行
 * 饱和时按宿主抵达顺序计数会漂移——那是票释放顺序，不是脚本顺序）；同进程
 * 直调回落按抵达计数。脚本一改，调用点序列就变，缓存自然失效——和 ZCode 的
 * 缓存语义一致。
 *
 * 为什么 opts 必须进键：只改 provider / model 而脚本不变时，旧实现（键只有
 * `站点:kind:sha256(prompt)`）在 amend 后仍命中缓存，返回的是**上一个模型**的
 * 结果——那不是省一次调用，而是报了一个与脚本要求不符的值。`args` 则刻意不进
 * 键：args 是脚本级输入，脚本用它拼出的 prompt 变了会自然改哈希，prompt 没变
 * 说明这一步的产出与 args 无关。
 *
 * run 级默认 provider（amend/resume 覆盖、调用点未给 provider 的步骤实际用它
 * 选路）同样进键：它影响产出却不落在调用点 opts 里。只在它真的参与选路时进，
 * 因此无 run 级 provider 的普通 run 键形不变，旧缓存不作废。
 *
 * 升级说明：旧 journal 里的指纹不带 opts 材料，因此升级后第一次 amend 从旧
 * journal 取缓存会**全部落空**（步骤重跑），不会复用错值——方向是"多花调用"
 * 而不是"给错结果"。`opts` 省略时材料为空串，函数对同一个 (site, kind, payload)
 * 仍然稳定。
 *
 * @param {number} callSite - 脚本内第 N 次 facade 调用。
 * @param {'agent'|'shell'} kind - facade 名称。
 * @param {unknown} payload - agent 的 prompt / shell 的 command。
 * @param {Record<string, any>} [opts] - 调用选项（只取语义字段）。
 * @param {string} [defaultProvider] - run 级默认 provider（agent 步骤传入即计，
 *   调用点 provider 的掩蔽在函数内裁决）。
 * @returns {string} `<site>:<kind>:<sha256 全 64 hex>`。
 */
export function stepFingerprint(callSite, kind, payload, opts, defaultProvider) {
  // BigInt / 循环引用的 payload 会让 JSON.stringify 直接抛（canonicalJson
  // 就是为这两种形状写的，见 :206 的不变量）。本函数在 makeAgentCall 里于
  // try **之外**被调用（:450，try 从 :463 才开始），抛出会让 agent() 违反
  // 「失败返回 null」的 facade 契约，整个脚本跟着挂。结构化降级：键仍唯一，
  // 只是落进降级槽。
  let json
  try {
    json = typeof payload === 'string' ? payload : JSON.stringify(payload)
  } catch {
    json = canonicalJson(payload)
  }
  // 结构定界 + 全宽哈希：数组材料让 payload 与各字段的边界由结构保证（旧实现用
  // `\u0000` 拼接，存在分隔符歧义），全宽哈希去掉 64 位截断带来的碰撞面。
  const material = canonicalJson([json === undefined ? null : json, ...semanticOptsMaterial(kind, opts, defaultProvider)])
  return `${callSite}:${kind}:${createHash('sha256').update(material).digest('hex')}`
}

// ─── facade + 执行线程 ────────────────────────────────────────────────────────

/** Synchronous-prefix budget for one script (overridable through deps.syncTimeoutMs). */
const DEFAULT_SYNC_TIMEOUT_MS = 30_000

/** Hard upper bound for evalSnippet's timeout (schema documents the cap). */
const EVAL_TIMEOUT_MAX_MS = 60_000

/** realm 侧 parallel/pipeline 的并发上限在 deps.semaphore 不携带 limitOf 时的回落值。 */
const DEFAULT_PARALLEL_LIMIT = 4

/** The facade members the realm bridge may invoke — invokeFacade dispatches
 * through this whitelist instead of a prototype-chain property lookup, so a
 * script asking for `constructor`/`valueOf`/… gets "unknown member" rather
 * than whatever happens to live on the object. */
const FACADE_MEMBERS = ['agent', 'shell', 'parallel', 'pipeline', 'phase', 'log', 'report', 'ask']

/** 脚本执行线程入口（与 lib/ 其余文件同目录随包发布，无需构建）。 */
const REALM_WORKER_URL = new URL('./workflow-realm-worker.js', import.meta.url)

/**
 * One `onStep` journal/cache event, fired before and after each facade call.
 * @typedef {{
 *   kind: 'agent'|'shell', site: number, fingerprint: string,
 *   prompt: unknown, opts: Record<string, unknown>, phase: 'before'|'after',
 *   outcome?: unknown, durationMs?: number, cached?: boolean, ts?: number,
 * }} StepEvent
 */
/**
 * One `onLog` progress event (phase / log / report / cache / step lines).
 * @typedef {Record<string, unknown>} LogEvent
 */
/**
 * What createRunner needs from its caller (workflow-runs.js owns the lifecycle).
 * @typedef {{
 *   ctx: Record<string, any>,
 *   parent: Record<string, any>,
 *   signal: AbortSignal,
 *   semaphore: Record<string, any>,
 *   provider?: string,
 *   onStep?: ((event: StepEvent) => any)|null,
 *   onLog?: ((event: LogEvent) => void)|null,
 *   onAsk?: ((text: string) => Promise<string>)|null,
 *   syncTimeoutMs?: number,
 *   semaphoreLimit?: number,
 * }} RunnerDeps
 */
/**
 * The executor handle returned by createRunner.
 * @typedef {{
 *   run: (scriptCode: string, args: unknown) => Promise<unknown>,
 *   facade: Record<string, any>,
 *   terminate: () => void,
 *   idle: () => { busy: boolean, lastActivityAt: number },
 * }} Runner
 */

/**
 * 构造一次运行的执行器。
 *
 * @param {RunnerDeps} deps - the run's collaborators.
 * @returns {Runner} { run(scriptCode, args) -> Promise<value>, facade, terminate(), idle() -> { busy, lastActivityAt } }
 */
export function createRunner(deps) {
  const {
    ctx, parent, signal, semaphore, provider,
    onStep = null, onLog = null, onAsk = null,
  } = deps
  const syncTimeoutMs = typeof deps.syncTimeoutMs === 'number' && Number.isFinite(deps.syncTimeoutMs) && deps.syncTimeoutMs > 0
    ? deps.syncTimeoutMs
    : DEFAULT_SYNC_TIMEOUT_MS
  // realm 侧 agent()/shell() 叶子调用的 per-run 并发上限：优先显式注入，其次读
  // 信号量自报的 limitOf()，都没有（测试自备的桩信号量）回落默认值。realm 侧的
  // 票同样收在叶子上（见 workflow-realm-shared.js），两边语义逐行对齐。
  const semaphoreLimit = typeof deps.semaphoreLimit === 'number' && deps.semaphoreLimit > 0
    ? deps.semaphoreLimit
    : (semaphore && typeof semaphore.limitOf === 'function' ? semaphore.limitOf() : DEFAULT_PARALLEL_LIMIT)
  // 当前 run 的 worker；terminate() 只对"还在跑"的那个生效（一个 runner 顺序
  // 跑多个脚本时，前一个已在 finish() 里清空指针）。
  /** @type {import('node:worker_threads').Worker|null} */
  let currentWorker = null
  const terminate = () => {
    const worker = currentWorker
    if (worker !== null) {
      try { worker.terminate() } catch { /* already gone */ }
    }
  }

  const subagents = ctx.get('subagents')
  const shell = ctx.get('shell')

  let callSite = 0

  // 空闲看门狗的活动信号（runs 侧消费，见 workflow-runs.js 的 watchdog）：
  // 任一 facade 成员被调用、或一个 agent()/shell() 叶子进入 gated，都刷新
  // lastActivityAt；leafInFlight 统计在飞叶子——等全局票也算在飞，否则信号量
  // 饱和时看门狗会把「等容量的 run」误判成挂死。
  let leafInFlight = 0
  let lastActivityAt = Date.now()

  /**
   * 跨 run 全局并发的收口点：真正消耗子代理 / 宿主命令的 agent()/shell()
   * 叶子调用在这里过全局信号量（跨全部 run 共享）。realm 侧 parallel/pipeline
   * 只有自己的 per-run 信号量做编排节流、不过桥——不收在叶子的话，N 个并发
   * run × 各自上限就是无上限，全局信号量形同虚设。收在叶子（而不是
   * parallel/pipeline）也避免了「parallel 持票、它的叶子再等票」的自等死锁。
   * @param {() => Promise<any>} thunk - one leaf step.
   * @returns {Promise<any>}
   */
  async function gated(thunk) {
    lastActivityAt = Date.now()
    leafInFlight++
    try {
      if (!semaphore || typeof semaphore.acquire !== 'function') return await thunk()
      await semaphore.acquire()
      try {
        return await thunk()
      } finally {
        semaphore.release()
      }
    } finally {
      leafInFlight--
    }
  }

  /**
   * Build the facade entry for one facade member (`agent` / `shell`).
   * @param {'agent'|'shell'} kind - which facade call this wraps.
   * @returns {(first: unknown, second?: unknown, bridgeSite?: unknown) => Promise<any>}
   */
  function makeAgentCall(kind) {
    return async (first, second, bridgeSite) => {
      // 空闲看门狗的活动信号：缓存命中路径不过 gated，这里补一次刷新。
      lastActivityAt = Date.now()
      // 站点序号：realm 桥在发起调用的瞬间（脚本出现顺序）带上序号——并行饱和
      // 时 invoke 抵达宿主的顺序是「票释放顺序」，按抵达计数会让同一脚本两次
      // 运行的序号漂移，amend/resume 的步骤指纹整体失配。同进程直调（eval /
      // 测试桩）没有序号，回落按抵达计数——顺序执行下两者等价。桥只可能递来
      // 我们自己的 realm facade 产生的正整数，但序号决定指纹，仍按形状校验。
      const site = typeof bridgeSite === 'number' && Number.isInteger(bridgeSite) && bridgeSite > 0
        ? bridgeSite
        : ++callSite
      // agent(prompt, opts?) 与 shell 的参数形态不同，在各自入口归一化。
      const pair = kind === 'agent'
        ? normalizeAgentArgs(first, second)
        : [first, second && typeof second === 'object' ? second : {}]
      const prompt = pair[0]
      /** @type {Record<string, unknown>} */
      const opts = /** @type {Record<string, unknown>} */ (pair[1])

      // amend/resume 的 run 级默认 provider 参与选路（runAgent 的
      // `(opts.provider) || provider || 'spawn'`），却不在调用点 opts 里——
      // 不进键的话，换 provider 的 amend/resume 会命中旧 provider 的缓存，把
      // 上一个模型的产出当本次结果上报。掩蔽（调用点自带 provider 时不进键）
      // 在 stepFingerprint 里裁决；无 run 级 provider 的普通 run 键形不变。
      const runProvider = kind === 'agent' && typeof provider === 'string' && provider !== '' ? provider : undefined
      const fingerprint = stepFingerprint(site, kind, prompt, opts, runProvider)

      // 上层（runs）可通过 onStep 返回 { cached: true, value } 跳过实际调用。
      if (onStep) {
        const probe = onStep({ kind, site, fingerprint, prompt, opts, phase: 'before' })
        if (probe && probe.cached === true) {
          if (onLog) onLog({ kind: 'cache-hit', site, fingerprint })
          return probe.value
        }
      }

      const started = Date.now()
      let outcome
      try {
        outcome = kind === 'agent'
          ? await gated(() => runAgent(prompt, opts))
          : await gated(() => runShell(prompt, opts))
      } catch (err) {
        if (signal.aborted) throw err
        // 单步骤失败不杀整个脚本：agent() 返回 null（对齐宿主 workflow 工具语义），
        // shell() 抛出由脚本自己 try/catch。
        if (kind === 'agent') {
          if (onLog) onLog({ kind: 'step-error', site, fingerprint, error: String(err && err.message || err) })
          outcome = null
        } else {
          throw err
        }
      }

      if (onStep) onStep({ kind, site, fingerprint, prompt, opts, phase: 'after', outcome, durationMs: Date.now() - started })
      return outcome
    }
  }

  /**
   * Start one subagent call.
   * The request shape mirrors dsh's `SubagentStartRequest`: `provider` rides the
   * `start(name, …)` first argument, NOT a request field, and `cwd` is a
   * semantic PLACEHOLDER (today's in-process provider takes the workspace from
   * the parent session) kept so the step fingerprint re-runs when a script
   * changes it. Both facts used to live only in these comments.
   * @param {unknown} prompt - the prompt text.
   * @param {Record<string, any>} opts - normalized call options.
   * @returns {Promise<unknown>} the step outcome (null when incomplete).
   */
  async function runAgent(prompt, opts) {
    if (signal.aborted) throw new Error('workflow aborted')
    /** @type {{ prompt: Array<{type: string, text: string}>, parent: Record<string, any>, signal: AbortSignal, outputSchema?: unknown, cwd?: string, agentOptions?: Record<string, unknown> }} */
    const request = {
      // `String(prompt)` used to be the whole normalization: an object-shaped
      // prompt (`agent({ prompt: { deep: 'obj' } })`) became the literal text
      // "[object Object]" — a subagent call burned on a prompt that said
      // nothing. JSON round-trip preserves the shape the script meant to send;
      // the stringify failure path (cycles) falls back to String, and the step
      // fingerprint already hashes object payloads the same way.
      prompt: [{ type: 'text', text: promptTextOf(prompt) }],
      parent,
      signal,
    }
    if (opts && opts.schema) request.outputSchema = opts.schema
    // `cwd` 进指纹是刻意的：指纹把 cwd 当"改变调用语义"的字段，脚本改动它就重跑。
    // 注意当前 dsh 的 SubagentStartRequest 没有 cwd 字段、in-process provider 从
    // parent 会话取工作区——这个选项今天是**语义占位**（改它只会重跑，不会改变
    // 子代理的工作目录）；保留进键是为了宿主将来支持时不产生陈旧缓存。
    if (opts && typeof opts.cwd === 'string' && opts.cwd !== '') request.cwd = opts.cwd
    if (opts && (opts.provider || opts.model)) {
      request.agentOptions = {
        ...(opts.provider ? { provider: opts.provider } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      }
    }
    const name = (opts && opts.provider) || provider || 'spawn'
    const run = await subagents.start(name, request)
    try {
      const result = await run.result
      if (result.stopReason !== 'completed') {
        // 非完成态（aborted/error/max-tokens/refusal）统一返回 null，
        // 诊断信息走 onLog，不污染脚本的返回值。
        if (onLog) {
          onLog({ kind: 'agent-incomplete', stopReason: result.stopReason, diagnostic: result.diagnostic })
        }
        return null
      }
      // outputSchema 命中时给结构化值；否则拼纯文本。
      if (result.structured !== undefined) return result.structured
      return blocksToText(result.output)
    } finally {
      await run.dispose()
    }
  }

  /**
   * Run one host shell command under the calling session's sandbox policy.
   * @param {unknown} command - the command line.
   * @param {Record<string, any>} opts - `{ workdir?, timeoutMs? }`.
   * @returns {Promise<{ exitCode: unknown, stdout: string, stderr: string, timedOut: boolean }>}
   */
  async function runShell(command, opts) {
    if (signal.aborted) throw new Error('workflow aborted')
    if (!shell) throw new Error('ctx.shell unavailable; shell() disabled in this deployment')
    // dsh 0.1.7 converged ShellExecutor on `resolve()` + `execute()`: the old
    // `run(spec)` / `start(spec)` pair is gone (it last existed in 0.1.5), and
    // `execute()` hands back the live ShellProcess whose FOREGROUND outcome is
    // awaited through `result()`. Pin the seam here so an incompatible (or
    // older) build fails with a named reason instead of "shell.run is not a
    // function" from inside the script.
    if (typeof shell.resolve !== 'function' || typeof shell.execute !== 'function') {
      throw new Error('ctx.shell has no resolve()/execute() — this dsh build predates the 0.1.7 executor convergence; shell() is disabled')
    }
    // The command runs under the CALLING SESSION's standing sandbox policy, like
    // the same command through the model's bash tool. Without it a confining
    // executor falls back to the deployment default and a session switched to
    // `read-only` is silently ignored. A confining executor that cannot resolve
    // a policy (no ctx.sandboxPolicy) throws HERE, which shell() surfaces to the
    // script as an ordinary step error — running unconfined is never the answer.
    const sandboxPolicy = resolveShellSandboxPolicy(ctx, shell, parent)
    const spec = shell.resolve({
      command: String(command),
      ...(opts && opts.workdir ? { workdir: opts.workdir } : {}),
      ...(opts && opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      signal,
      ...(sandboxPolicy !== undefined ? { sandboxPolicy } : {}),
    })
    const handle = await shell.execute(spec)
    const result = await handle.result()
    if (result.aborted) throw new Error(`shell command aborted: ${command}`)
    const stdoutOut = outputOf(result.stdout)
    const stderrOut = outputOf(result.stderr)
    return {
      exitCode: result.exitCode,
      stdout: stdoutOut.text,
      stderr: stderrOut.text,
      timedOut: !!result.timedOut,
      // 执行器截断了流（stdout 保留尾段、丢头部）时如实上报：此前
      // CollectedOutput.truncated 被丢弃，脚本把尾段当全量做判断。
      ...(stdoutOut.truncated || stderrOut.truncated ? { truncated: true } : {}),
    }
  }

  const facade = {
    agent: makeAgentCall('agent'),
    shell: makeAgentCall('shell'),

    /**
     * 并行 thunks，全部完成后 barrier 返回结果数组（顺序与输入一致）。
     * 并发上限由 semaphore 控制。
     * @param {unknown} thunks - the thunk array (validated here).
     * @returns {Promise<unknown[]>} one result per thunk, in input order.
     */
    parallel: (thunks) => {
      if (!Array.isArray(thunks)) throw new Error('parallel() expects an array of thunks')
      // 节流不在这里：叶子 agent()/shell() 已过跨 run 全局信号量（见 gated），
      // 这里再 acquire 会变成「parallel 持票、它的叶子再等票」的自等死锁。
      // realm 侧 parallel 同款：per-run 信号量也收在叶子上。
      return Promise.all(thunks.map(async (/** @type {any} */ thunk) => thunk()))
    },

    /**
     * 逐 item 流水线，无 barrier——和宿主 workflow 工具的 pipeline 语义一致：
     * 每个 item 依次跑完各 stage，任一 stage 抛出则该 item 结果为 null。
     * @param {unknown} items - the input items (validated here).
     * @param {...((value: any) => Promise<any>)} stages - one or more stages.
     * @returns {Promise<unknown[]>} one result per item, in input order.
     */
    pipeline: async (items, ...stages) => {
      if (!Array.isArray(items)) throw new Error('pipeline() expects an array of items')
      if (stages.length === 0) throw new Error('pipeline() expects at least one stage')
      // 与 parallel 同理：节流收口在叶子的全局信号量，这里只做编排。
      return Promise.all(items.map(async (/** @type {any} */ item) => {
        let value = item
        for (const stage of stages) {
          try {
            value = await stage(value)
          } catch (err) {
            if (signal.aborted) throw err
            return null
          }
          if (value === null || value === undefined) return null
        }
        return value
      }))
    },

    /** @param {unknown} title - the phase label. */
    phase: (title) => { if (onLog) onLog({ kind: 'phase', title: String(title) }) },
    /** @param {unknown} message - the log line. */
    log: (message) => { if (onLog) onLog({ kind: 'log', message: String(message) }) },
    /**
     * Record one progress datum (not a contract output).
     * @param {unknown} key - the report key.
     * @param {unknown} value - the value; unserializable ones degrade to a placeholder.
     */
    report: (key, value) => {
      if (!onLog) return
      // report 是进度日志，不是契约输出：不可序列化的值降级为占位符，运行继续
      // （终值不序列化的 fail-loud 在 run() 的返回值出口上）。
      let safe
      try { safe = jsonSafeValue(value) } catch (err) {
        safe = `<unserializable report value: ${String(err && err.message || err)}>`
      }
      onLog({ kind: 'report', key: String(key), value: safe })
    },

    /**
     * 阻塞当前脚本，等外部回答后继续。ZCode 的 ResolveWorkflowQuestion 链路：
     * subagent 不好自作主张时（口径 / 破坏性操作 / 需要人的判断），ask() 把
     * 问题抛回会话，answer 之前这一步一直挂着。
     * @param {unknown} text - the question; must be a non-empty string.
     * @returns {Promise<string>} the answer.
     */
    ask: (text) => {
      if (typeof text !== 'string' || text.trim() === '') {
        throw new Error('ask() requires a non-empty question string')
      }
      if (!onAsk) throw new Error('ask() is unavailable in this execution mode')
      return onAsk(String(text))
    },
  }

  /**
   * 桥的宿主半：把 worker 发来的 invoke 请求分发到 facade，回复文本与同进程
   * 旧桥完全同构（`{ ok, value | error }` envelope）。业务错误折进文本的理由
   * 不变：跨桥的宿主 `Error` 会让脚本拿到宿主 Function。
   * @param {string} name - facade 成员名。
   * @param {string} argsText - 已 JSON 文本化的参数数组。
   * @returns {Promise<string>} envelope 文本。
   */
    /**
     * @param {unknown} name - the facade member the script asked for.
     * @param {unknown} argsText - the JSON argument array as text.
     * @param {unknown} [bridgeSite] - the realm-assigned appearance-order site
     *   number (agent/shell only); see makeAgentCall.
     * @returns {Promise<string>} the reply envelope text.
     */
    async function invokeFacade(name, argsText, bridgeSite) {
      // 空闲看门狗的活动信号：log/phase/report/ask 等非叶子成员只有这里能刷。
      lastActivityAt = Date.now()
      // 入向桥帽（WORKFLOW_BRIDGE_MAX_CHARS）：数 MB 的 argsText 经 JSON.parse
      // + 结构化克隆在宿主瞬时双份驻留，无帽时一个巨型 agent(prompt) 就能把
      // 宿主推近 OOM。超帽按该次调用失败折回脚本（与终值帽同一 fail-loud 取
      // 舍），不终止 run。
      if (typeof argsText === 'string' && argsText.length > WORKFLOW_BRIDGE_MAX_CHARS) {
        return JSON.stringify({ ok: false, error: `facade call arguments exceed the ${Math.floor(WORKFLOW_BRIDGE_MAX_CHARS / 1_000_000)}M-char bridge budget (${argsText.length} chars) — pass a summary or a reference instead of the full payload` })
      }
      /** @type {unknown} */
      let argsList
      try {
        argsList = JSON.parse(String(argsText))
      } catch {
        argsList = []
      }
      // 白名单分发，不做原型链查找：`facadeTable['constructor']` 这类键本来
      // 也都是无害函数（值再经 JSON 折叠），但脚本只该够到 facade 的八个成员，
      // 别的名字一律 unknown——比"恰好无害"更稳。
      const facadeTable = /** @type {Record<string, any>} */ (facade)
      const method = typeof name === 'string' && FACADE_MEMBERS.includes(name) ? facadeTable[name] : undefined
    if (typeof method !== 'function') {
      return JSON.stringify({ ok: false, error: 'unknown workflow facade member: ' + String(name) })
    }
    try {
      const value = await method(...(Array.isArray(argsList) ? argsList : []), bridgeSite)
      // `undefined` drops the key (a void facade call), `null` survives as
      // null (agent() reports a failed step that way) — same as before.
      const payloadText = JSON.stringify({ ok: true, value })
      // 出向桥帽：facade 返回值（agent 的子代理输出无上界）跨 structured
      // clone 回 worker 前先卡预算——超帽按该次调用失败折回脚本， run 不终
      // 止（终值方向的同款预算见 run() 的 done 分支）。
      if (payloadText.length > WORKFLOW_BRIDGE_MAX_CHARS) {
        return JSON.stringify({ ok: false, error: `facade result exceeds the ${Math.floor(WORKFLOW_BRIDGE_MAX_CHARS / 1_000_000)}M-char bridge budget — aggregate a summary in the script instead of returning every step's full output` })
      }
      return payloadText
    } catch (error) {
      return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : messageOf(error) })
    }
  }

  /**
   * 在独立线程的 vm realm 里跑转译后的脚本。
   *
   * realm 只递**一个**宿主对象（worker 侧的 `host` 桥），且它只活在 realm 闭包里；
   * 脚本能摸到的每个值要么是 realm 内建、要么是 realm 闭包、要么是 `JSON.parse`
   * 在本 realm 重建出来的副本。于是 `args.constructor.constructor('return process')()`
   * 这条经典逃逸路径（本文件旧注释里逐字记录过）被堵住了：`args` 是 realm 对象，
   * `.constructor` 是 realm 的 Object、`.constructor.constructor` 是 realm 的
   * Function，求 `'return process'` 只会 ReferenceError。
   *
   * **为什么是 worker 线程**：realm 防的是"意外拿到宿主能力"，线程防的是"失控
   * 拖垮宿主"。同步死循环由 V8 的 vm timeout 掐（实测见 verify-workflow-engine
   * 的同步用例）；而**首个 await 之后的微任务自旋**（`while(true){ await 0 }`）
   * 在任何单线程事件循环上都不可抢占——主线程上定时器全被饿死，abort、stop 预算、
   * eval 硬超时全都失效。脚本冻住的只是 worker 自己，主线程的预算照常醒来，
   * `terminate()` 把整个 isolate 连脚本一起回收（stop 的 abandoned 路径与 eval
   * 超时都靠它兜底）。
   *
   * **这不是硬安全边界**：worker 与宿主同用户、同信任级，脚本真正的权力来自
   * facade（agent() / shell() 都在主线程落地）。
   *
   * code 是 compileScript 的产物：一个 async 函数声明。语句位置取值
   * `workflow_main`，分号 / sourcemap 尾巴都不影响。
   * @param {string} code - 编译后的脚本体。
   * @param {Record<string, any>} args - 传给脚本的 `args`（JSON 值）。
   * @returns {Promise<unknown>} 脚本顶层 return 的 JSON 安全值。
   */
  function run(code, args) {
    let argsText
    try {
      argsText = JSON.stringify(args === undefined ? null : args)
    } catch (error) {
      return Promise.reject(new Error('workflow args must be a JSON value: ' + String(error && error.message || error)))
    }
    return new Promise((resolve, reject) => {
      /** @type {import('node:worker_threads').Worker | null} */
      let worker = null
      let finished = false
      /**
       * Settle the run exactly once and release the worker.
       * @param {(value: any) => void} settle - `resolve` or `reject`.
       * @param {unknown} value - the settlement value.
       */
      const finish = (settle, value) => {
        if (finished) return
        finished = true
        currentWorker = null
        try { worker?.terminate() } catch { /* already gone */ }
        signal.removeEventListener('abort', forwardAbort)
        settle(value)
      }
      const forwardAbort = () => {
        try { worker?.postMessage({ type: 'abort', reason: signal.reason }) } catch { /* worker gone */ }
      }
      try {
        worker = new Worker(REALM_WORKER_URL, {
          workerData: { code, argsText, syncTimeoutMs, semaphoreLimit },
          // 线程边界防 CPU 失控，不防内存——补一个堆上限，让失控的脚本分配
          // 在自己的 isolate 里 OOM（worker 带着错误退出，运行记 errored），
          // 而不是把整个 dsh 宿主进程拖进 swap。1GiB 对编排脚本足够宽裕；
          // 它是 V8 堆帽，不是预占内存。
          resourceLimits: { maxOldGenerationSizeMb: 1024 },
        })
      } catch (error) {
        reject(new Error('workflow worker could not be started: ' + String(error && error.message || error)))
        return
      }
      currentWorker = worker
      worker.on('message', (msg) => {
        if (msg === null || typeof msg !== 'object') return
        if (msg.type === 'done') {
          // 终值预算：worker 堆帽（1GiB）只护脚本 isolate，`valueText` 经
          // structured clone 进宿主后还要全文进 journal、全文走 get() 与
          // 完成通知——无帽的聚合型返回（汇总全部子代理输出）会让宿主进程
          // 瞬时多份驻留、最坏 OOM。超帽按脚本错误落定（fail-loud，journal
          // 与步骤缓存不受影响），让脚本改返回摘要，而不是宿主替它扛。
          if (typeof msg.valueText === 'string' && msg.valueText.length > WORKFLOW_RESULT_MAX_CHARS) {
            finish(reject, new Error(`workflow terminal value exceeds the ${Math.floor(WORKFLOW_RESULT_MAX_CHARS / 1_000_000)}M-char budget (${msg.valueText.length} chars) — aggregate a summary instead of returning every step's full output`))
            return
          }
          let value
          try {
            value = JSON.parse(msg.valueText)
          } catch (error) {
            finish(reject, new Error('workflow result was not valid JSON text: ' + String(error && error.message || error)))
            return
          }
          finish(resolve, value)
          return
        }
        if (msg.type === 'error') {
          finish(reject, new Error(String(msg.message || 'workflow script failed')))
          return
        }
        if (msg.type === 'invoke') {
          invokeFacade(msg.name, msg.argsText, msg.site).then(
            (payloadText) => { try { worker?.postMessage({ type: 'reply', id: msg.id, payloadText }) } catch { /* worker gone */ } },
            (error) => {
              try { worker?.postMessage({ type: 'reply', id: msg.id, payloadText: JSON.stringify({ ok: false, error: messageOf(error) }) }) } catch { /* worker gone */ }
            },
          )
        }
      })
      worker.on('error', (error) => {
        finish(reject, new Error('workflow worker crashed: ' + messageOf(error)))
      })
      worker.on('exit', (exitCode) => {
        // 正常收尾先走 done/error 并 terminate；走到这里的 exit 一定是提前死亡
        // （崩溃 / 被 terminate）——按未落定脚本报错，settle 侧按 abort 判 stopped。
        finish(reject, new Error(`workflow worker exited before the script settled (exit code ${exitCode})`))
      })
      if (signal.aborted) forwardAbort()
      else signal.addEventListener('abort', forwardAbort)
    })
  }

  return /** @type {Runner} */ ({ run, facade, terminate, idle: () => ({ busy: leafInFlight > 0, lastActivityAt }), _callSite: () => callSite })
}

/**
 * Render one facade prompt as the text a subagent actually receives. Strings
 * pass through; anything else is JSON-encoded (an object prompt carries its
 * data instead of decaying to "[object Object]"), with a String fallback for
 * values JSON.stringify refuses.
 * @param {unknown} prompt - the prompt from the facade call.
 * @returns {string}
 */
function promptTextOf(prompt) {
  if (typeof prompt === 'string') return prompt
  try { return JSON.stringify(prompt) ?? String(prompt) } catch { return String(prompt) }
}

/**
 * Normalize the two call shapes agent() accepts: `(prompt)`, `(prompt, opts)`,
 * and the single-object form `({ prompt, ...opts })`.
 * @param {unknown} first - the prompt, or the options object carrying one.
 * @param {unknown} second - the options, when the prompt was positional.
 * @returns {[unknown, Record<string, any>]} the prompt and its options.
 */
function normalizeAgentArgs(first, second) {
  // agent(prompt) / agent(prompt, opts)
  if (typeof first === 'string') return [first, second || {}]
  // agent({ prompt, ...opts }) 单对象形态
  if (first && typeof first === 'object') {
    const bag = /** @type {Record<string, unknown>} */ (first)
    const { prompt, ...opts } = bag
    const extra = second && typeof second === 'object' ? /** @type {Record<string, unknown>} */ (second) : {}
    return [prompt, { ...opts, ...extra }]
  }
  throw new Error('agent() expects a prompt string or { prompt, ...options }')
}

/**
 * Flatten an assistant message's content blocks into plain text.
 * @param {unknown} blocks - the content-block array (other shapes stringify).
 * @returns {string|null} the joined text, or null when absent.
 */
function blocksToText(blocks) {
  if (!Array.isArray(blocks)) return blocks === undefined || blocks === null ? null : String(blocks)
  /** @type {string[]} */
  const parts = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const viewed = /** @type {{ type?: unknown, text?: unknown }} */ (block)
    if (viewed.type === 'text' && typeof viewed.text === 'string') parts.push(viewed.text)
  }
  return parts.join('\n')
}

/**
 * Coerce one shell stream value (the host's `CollectedOutput` or a plain
 * string) to text AND carry its truncation flag: the executor keeps only the
 * TAIL past its byte cap, so a script that reads `stdout` as the full stream
 * would otherwise reason on silently missing output.
 * @param {unknown} output - the stream value.
 * @returns {{ text: string, truncated: boolean }}
 */
function outputOf(output) {
  if (output === undefined || output === null) return { text: '', truncated: false }
  const viewed = /** @type {{ text?: unknown, truncated?: unknown }} */ (output)
  if (typeof viewed.text === 'string') return { text: viewed.text, truncated: viewed.truncated === true }
  if (typeof output.toString === 'function') return { text: String(output), truncated: false }
  return { text: '', truncated: false }
}

// ─── 运行目录工具 ─────────────────────────────────────────────────────────────

/**
 * The workflows root beneath the harness home (created on demand).
 * @param {string} dshHome - the harness home directory.
 * @returns {string} `<dshHome>/workflows`.
 */
export function workflowsDir(dshHome) {
  const dir = join(dshHome, 'workflows')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * The journal root (created on demand).
 * @param {string} dshHome - the harness home directory.
 * @returns {string} `<dshHome>/workflows/runs`.
 */
export function runsDir(dshHome) {
  const dir = join(workflowsDir(dshHome), 'runs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * The saved-library root (created on demand).
 * @param {string} dshHome - the harness home directory.
 * @returns {string} `<dshHome>/workflows/saved`.
 */
export function savedDir(dshHome) {
  const dir = join(workflowsDir(dshHome), 'saved')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Read and parse a JSON file, or null when it is absent or unparseable.
 * @param {string} path - the file to read.
 * @returns {any} the parsed value, or null.
 */
export function readJsonIfExists(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/**
 * Write JSON atomically (temp + rename).
 * @param {string} path - the destination.
 * @param {unknown} value - the JSON value to write.
 * @returns {void}
 */
export function atomicWriteJson(path, value) {
  writeJsonAtomic(path, value)
}

// ─── 试运行（eval）────────────────────────────────────────────────────────────

/**
 * 同步跑一段脚本，不给真 agent 花调用：agent() 返回固定桩字符串，shell() 直接
 * 抛错，ask() 不可用。用途是模型在 `workflow create` 之前先验证语法和控制流——
 * ZCode 的 eval_snippet 同款定位。
 *
 * @param {string} scriptBody 脚本体
 * @param {Record<string, any>} [opts] { args?, stub?, timeoutMs?, signal? }
 * @returns {Promise<unknown>} 脚本的返回值
 * @throws {Error} 转译或运行失败；编译失败时 error.diagnostics 带 esbuild 诊断；
 *   opts.signal 中止时拒绝 'eval aborted'
 */
export async function evalSnippet(scriptBody, opts = {}) {
  const compiled = await compileScript(scriptBody, 'eval.ts')
  if (compiled.diagnostics.length > 0) {
    /** @type {Error & { diagnostics?: unknown }} */
    const err = new Error('eval compile failed')
    err.diagnostics = compiled.diagnostics
    throw err
  }

  const stubText = typeof opts.stub === 'string' && opts.stub !== ''
    ? opts.stub
    : '[[workflow eval: agent stub]]'
  // 只桩 agent：shell() 拿不到 ctx.shell 会抛一个明确的错误，而不是静默返假值。
  const evalCtx = {
    /** @param {string} key - the service key the runner asks for. */
    get: (key) => key === 'subagents'
      ? {
        start: async () => ({
          result: Promise.resolve({
            stopReason: 'completed',
            output: [{ type: 'text', text: stubText }],
          }),
          dispose: async () => {},
        }),
      }
      : undefined,
  }
  const controller = new AbortController()
  // 上界钳制：该值同时是 vm 同步前缀预算与硬超时 race 的时长——模型传 1e12
  // 就把这次工具调用挂到天荒地老。60s 远超 dry-run 的合理预算（需要长等待请
  // 用 run_saved / create 的 wait:true，那条路有独立的停止预算）。
  const requestedMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 5_000
  const timeoutMs = Math.min(requestedMs, EVAL_TIMEOUT_MAX_MS)
  const runner = createRunner({
    ctx: evalCtx,
    // A dry run delegates nothing, so it has no parent Agent to inherit a cwd
    // or bloodline from. Only resolveShellSandboxPolicy reads this, and it
    // treats an absent subject as "deployment default".
    parent: /** @type {any} */ (null),
    signal: controller.signal,
    semaphore: createSemaphore(4),
    // The same budget fences the SYNCHRONOUS prefix inside the vm: a dry run that
    // never reaches an await is stopped there instead of freezing the host (the
    // Promise.race below cannot: its timer needs a turn of the event loop).
    syncTimeoutMs: timeoutMs,
  })
  // 调用方的取消信号（工具 exec.signal）转发为内部 abort：用户打断会话时，
  // eval 的等待随 abort 竞速退出，而不是干等硬超时。await 之后的挂起只能靠
  // race 兜底——abort 传不进不感知信号的代码，而同步段已由 vm timeout 负责。
  const forwardAbort = () => controller.abort('caller aborted')
  if (opts.signal) {
    if (opts.signal.aborted) forwardAbort()
    else opts.signal.addEventListener('abort', forwardAbort, { once: true })
  }

  // abort 只能打断信号感知的操作（agent 调用）；一个挂在纯 JS promise 上的脚本
  // 不会因此落定，所以再用一个硬超时 race 兜底。
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`eval timeout after ${timeoutMs}ms`)), timeoutMs)
  })
  // abort 竞速：内部 abort（调用方取消 / finally 收尾）到达即拒绝。
  //
  // The initializer goes through a cast instead of being written as a bare
  // `null`: with `strictNullChecks` on, `let x = null` takes the type `null`,
  // the executor's later assignment becomes an error, and every read then
  // narrows to `never` ("has no call signatures"). Reproduced in isolation —
  // both with and without a JSDoc union annotation — so the cast is what
  // actually pins the type.
  /** @type {((reason?: unknown) => void)|null} */
  let abortReject = /** @type {any} */ (null)
  const abortedPromise = new Promise((/** @type {(reason?: unknown) => void} */ _resolve, /** @type {(reason?: unknown) => void} */ reject) => { abortReject = reject })
  /** Reject the race when the caller's signal aborts. */
  const onSettleAbort = () => { if (abortReject !== null) abortReject(new Error('eval aborted')) }
  // 调用方信号可能在进入本函数前、或在 `await compileScript(...)` 的编译窗口内
  // 就已取消（测试里 setTimeout(abort, 80) 与一次冷启动 esbuild 编译就是这种
  // 竞态）。那时 controller 早已 abort，下面再挂监听就永远收不到事件——竞速
  // 形同虚设，只剩硬超时兜底（实测表现为「预取消的 signal 干等满 timeout」）。
  // 所以先判预取消状态，再决定挂监听还是直接拒绝。
  //
  // The call goes through a plain `if (abortReject !== null)` guard on the
  // variable itself. Aliasing it into a `const` first does NOT work: the alias of
  // a `let` that is only assigned inside a Promise executor narrows to `never`
  // (reproduced in isolation — `Type 'never' has no call signatures`), because
  // control flow cannot see the closure's assignment.
  if (controller.signal.aborted) {
    if (abortReject !== null) abortReject(new Error('eval aborted'))
  } else {
    controller.signal.addEventListener('abort', onSettleAbort, { once: true })
  }
  try {
    // compileScript returns EITHER a code or diagnostics, and the diagnostics
    // branch returned above — so the code is present on this path.
    const code = /** @type {string} */ (compiled.code)
    const value = await Promise.race([runner.run(code, opts.args || {}), timeout, abortedPromise])
    controller.signal.removeEventListener('abort', onSettleAbort)
    return value
  } finally {
    if (timer !== null) clearTimeout(timer)
    controller.signal.removeEventListener('abort', onSettleAbort)
    // 竞速结束后收尾 abort 触发的 rejection 已无人等待——挂上 no-op 防
    // unhandled rejection。
    abortedPromise.catch(() => {})
    if (opts.signal) opts.signal.removeEventListener('abort', forwardAbort)
    controller.abort('eval done')
    // eval 是一次性干跑：无论结果如何都回收执行线程。硬超时（或调用方 abort）
    // 竞速赢在主线程上——脚本若在 worker 里微任务自旋，主线程定时器照常醒来，
    // 这里的 terminate 就是把卡死 isolate 连同脚本一起回收的兜底。
    runner.terminate()
  }
}
