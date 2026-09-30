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
import { FACADE_PARAMS, jsonSafeValue } from './workflow-realm-shared.js'

// ─── 转译 ───────────────────────────────────────────────────────────────────

/**
 * 把脚本体包成 facade 调用签名，作为一整个 TS 单元转译。
 *
 * 为什么要「先包再译」：脚本的顶层 return 在 ESM 里非法，esbuild 会把它包成
 * __commonJS 模块，输出里出现 export default —— 拿到 new Function 里直接语法
 * 错误。先包进箭头函数，return 就是普通的函数返回，转译输出是干净的表达式。
 *
 * @returns {Promise<{ code: string; diagnostics: any[]; }>}
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
    const diagnostics = (err.errors || []).map((e) => ({
      category: 'error',
      message: e.text,
      location: e.location ? `${label || 'workflow.ts'}:${e.location.line - 1}:${e.location.column}` : undefined,
    }))
    if (diagnostics.length === 0) diagnostics.push({ category: 'error', message: String(err && err.message || err) })
    return { code: null, diagnostics }
  }
}

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
 */
export function createSemaphore(limit) {
  let active = 0
  const waiters = []
  const activeOf = () => active
  // worker 桥需要把上限数值带进 realm（realm 侧 parallel/pipeline 用自己的
  // 信号量逐行对齐这套语义）；缺这个访问器时引擎回落 DEFAULT_PARALLEL_LIMIT。
  const limitOf = () => limit

  function acquire() {
    if (active < limit) { active += 1; return Promise.resolve() }
    return new Promise((resolve) => { waiters.push(resolve) })
  }

  function release() {
    active -= 1
    const next = waiters.shift()
    if (next !== undefined) { active += 1; next() }
  }

  async function runThunks(thunks) {
    const results = await Promise.all(thunks.map(async (thunk) => {
      try { await acquire() } catch { return null }
      try { return await thunk() } finally { release() }
    }))
    return results
  }

  return { acquire, release, runThunks, activeOf, limitOf }
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
  seen.add(value)
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item, seen)).join(',') + ']'
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key], seen)).join(',') + '}'
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
 * @returns {unknown[]} 稳定的比较材料（无语义字段时为空数组）。
 */
function semanticOptsMaterial(kind, opts) {
  if (opts === null || typeof opts !== 'object') return []
  // `cwd` belongs to the AGENT list, not just the shell's: a subagent call that
  // runs in a different working directory can produce a different answer, so a
  // script amended from `{ cwd: '/a' }` to `{ cwd: '/b' }` must re-run that step
  // rather than serve the first directory's result.
  const fields = kind === 'shell'
    ? ['workdir', 'timeoutMs']
    : ['provider', 'model', 'schema', 'cwd']
  const parts = []
  for (const field of fields) {
    const value = opts[field]
    if (value === undefined || value === null) continue
    parts.push(field, canonicalJson(value))
  }
  return parts
}

/**
 * amend 时「未变步骤不重跑」的键：facade 调用点 + 参数 + **改变调用语义的 opts**。
 * 调用点序号在 createRunner 里按出现顺序分配（同一脚本内第 N 次 facade 调用），
 * 脚本一改，调用点序列就变，缓存自然失效——和 ZCode 的缓存语义一致。
 *
 * 为什么 opts 必须进键：只改 provider / model 而脚本不变时，旧实现（键只有
 * `站点:kind:sha256(prompt)`）在 amend 后仍命中缓存，返回的是**上一个模型**的
 * 结果——那不是省一次调用，而是报了一个与脚本要求不符的值。`args` 则刻意不进
 * 键：args 是脚本级输入，脚本用它拼出的 prompt 变了会自然改哈希，prompt 没变
 * 说明这一步的产出与 args 无关。
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
 * @returns {string} `<site>:<kind>:<sha256 全 64 hex>`。
 */
export function stepFingerprint(callSite, kind, payload, opts) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload)
  // 结构定界 + 全宽哈希：数组材料让 payload 与各字段的边界由结构保证（旧实现用
  // `\u0000` 拼接，存在分隔符歧义），全宽哈希去掉 64 位截断带来的碰撞面。
  const material = canonicalJson([json === undefined ? null : json, ...semanticOptsMaterial(kind, opts)])
  return `${callSite}:${kind}:${createHash('sha256').update(material).digest('hex')}`
}

// ─── facade + 执行线程 ────────────────────────────────────────────────────────

/** Synchronous-prefix budget for one script (overridable through deps.syncTimeoutMs). */
const DEFAULT_SYNC_TIMEOUT_MS = 30_000

/** realm 侧 parallel/pipeline 的并发上限在 deps.semaphore 不携带 limitOf 时的回落值。 */
const DEFAULT_PARALLEL_LIMIT = 4

/** 脚本执行线程入口（与 lib/ 其余文件同目录随包发布，无需构建）。 */
const REALM_WORKER_URL = new URL('./workflow-realm-worker.js', import.meta.url)

/**
 * 构造一次运行的执行器。
 *
 * @param {object}   deps
 * @param {Record<string, any>}   deps.ctx           Cordis Context（运行时）
 * @param {Record<string, any>}   deps.parent        Agent — 子代理的 parent（cwd/血缘/深度来源）
 * @param {AbortSignal} deps.signal     运行级取消信号
 * @param {Record<string, any>}   deps.semaphore     并发信号量
 * @param {string}   [deps.provider]    subagent provider（缺省用宿主默认）
 * @param {function} [deps.onStep]      每个 facade 调用前后回调（挂 journal / cache）
 * @param {function} [deps.onLog]       log()/phase() 回调
 * @param {function} [deps.onAsk]       ask(text) 的回答通道：(text) => Promise<string>；
 *                                      缺省时 ask() 抛错（eval 模式）
 * @param {number}   [deps.syncTimeoutMs] 脚本**同步前缀**的预算（ms，缺省 30s）：
 *                                      async 函数体在首个 await 之前是同步跑的，
 *                                      那里的死循环由 V8 的 vm timeout 打断。
 * @param {number}   [deps.semaphoreLimit] realm 侧 parallel/pipeline 的并发上限；
 *                                      缺省读 deps.semaphore.limitOf()，再缺省 4。
 * @returns {Record<string, any>} { run(scriptCode, args) -> Promise<value>, facade, terminate() }
 */
export function createRunner(deps) {
  const {
    ctx, parent, signal, semaphore, provider,
    onStep = null, onLog = null, onAsk = null,
  } = deps
  const syncTimeoutMs = typeof deps.syncTimeoutMs === 'number' && Number.isFinite(deps.syncTimeoutMs) && deps.syncTimeoutMs > 0
    ? deps.syncTimeoutMs
    : DEFAULT_SYNC_TIMEOUT_MS
  // realm 侧 parallel/pipeline 的并发上限：优先显式注入，其次读信号量自报的
  // limitOf()，都没有（测试自备的桩信号量）回落默认值。
  const semaphoreLimit = typeof deps.semaphoreLimit === 'number' && deps.semaphoreLimit > 0
    ? deps.semaphoreLimit
    : (semaphore && typeof semaphore.limitOf === 'function' ? semaphore.limitOf() : DEFAULT_PARALLEL_LIMIT)
  // 当前 run 的 worker；terminate() 只对"还在跑"的那个生效（一个 runner 顺序
  // 跑多个脚本时，前一个已在 finish() 里清空指针）。
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

  function makeAgentCall(kind) {
    return async (first, second) => {
      const site = ++callSite
      // agent(prompt, opts?) 与 shell 的参数形态不同，在各自入口归一化。
      const [prompt, opts] = kind === 'agent'
        ? normalizeAgentArgs(first, second)
        : [first, second || {}]

      const fingerprint = stepFingerprint(site, kind, prompt, opts)

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
          ? await runAgent(prompt, opts)
          : await runShell(prompt, opts)
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

  async function runAgent(prompt, opts) {
    if (signal.aborted) throw new Error('workflow aborted')
    // provider 只经 start(name, request) 的第一参传递——SubagentStartRequest
    // 没有 provider 字段（那属于 workflow 的 WorkflowStartRequest，别混）。
    const request = {
      prompt: [{ type: 'text', text: String(prompt) }],
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
    return {
      exitCode: result.exitCode,
      stdout: textOf(result.stdout),
      stderr: textOf(result.stderr),
      timedOut: !!result.timedOut,
    }
  }

  const facade = {
    agent: makeAgentCall('agent'),
    shell: makeAgentCall('shell'),

    /**
     * 并行 thunks，全部完成后 barrier 返回结果数组（顺序与输入一致）。
     * 并发上限由 semaphore 控制。
     */
    parallel: (thunks) => {
      if (!Array.isArray(thunks)) throw new Error('parallel() expects an array of thunks')
      return semaphore.runThunks(thunks)
    },

    /**
     * 逐 item 流水线，无 barrier——和宿主 workflow 工具的 pipeline 语义一致：
     * 每个 item 依次跑完各 stage，任一 stage 抛出则该 item 结果为 null。
     */
    pipeline: async (items, ...stages) => {
      if (!Array.isArray(items)) throw new Error('pipeline() expects an array of items')
      if (stages.length === 0) throw new Error('pipeline() expects at least one stage')
      return semaphore.runThunks(items.map((item) => async () => {
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

    phase: (title) => { if (onLog) onLog({ kind: 'phase', title: String(title) }) },
    log: (message) => { if (onLog) onLog({ kind: 'log', message: String(message) }) },
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
  async function invokeFacade(name, argsText) {
    let argsList
    try {
      argsList = JSON.parse(argsText)
    } catch {
      argsList = []
    }
    const method = typeof name === 'string' ? facade[name] : undefined
    if (typeof method !== 'function') {
      return JSON.stringify({ ok: false, error: 'unknown workflow facade member: ' + String(name) })
    }
    try {
      const value = await method(...(Array.isArray(argsList) ? argsList : []))
      // `undefined` drops the key (a void facade call), `null` survives as
      // null (agent() reports a failed step that way) — same as before.
      return JSON.stringify({ ok: true, value })
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
        worker = new Worker(REALM_WORKER_URL, { workerData: { code, argsText, syncTimeoutMs, semaphoreLimit } })
      } catch (error) {
        reject(new Error('workflow worker could not be started: ' + String(error && error.message || error)))
        return
      }
      currentWorker = worker
      worker.on('message', (msg) => {
        if (msg === null || typeof msg !== 'object') return
        if (msg.type === 'done') {
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
          invokeFacade(msg.name, msg.argsText).then(
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

  return { run, facade, terminate, _callSite: () => callSite }
}

function normalizeAgentArgs(first, second) {
  // agent(prompt) / agent(prompt, opts)
  if (typeof first === 'string') return [first, second || {}]
  // agent({ prompt, ...opts }) 单对象形态
  if (first && typeof first === 'object') {
    const { prompt, ...opts } = first
    return [prompt, { ...opts, ...(second || {}) }]
  }
  throw new Error('agent() expects a prompt string or { prompt, ...options }')
}

function blocksToText(blocks) {
  if (!Array.isArray(blocks)) return blocks === undefined || blocks === null ? null : String(blocks)
  const parts = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function textOf(output) {
  if (output === undefined || output === null) return ''
  if (typeof output === 'string') return output
  if (typeof output.text === 'string') return output.text
  if (typeof output.toString === 'function') return String(output)
  return ''
}

// ─── 运行目录工具 ─────────────────────────────────────────────────────────────

export function workflowsDir(dshHome) {
  const dir = join(dshHome, 'workflows')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function runsDir(dshHome) {
  const dir = join(workflowsDir(dshHome), 'runs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function savedDir(dshHome) {
  const dir = join(workflowsDir(dshHome), 'saved')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function readJsonIfExists(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

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
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 5_000
  const runner = createRunner({
    ctx: evalCtx,
    parent: null,
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
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`eval timeout after ${timeoutMs}ms`)), timeoutMs)
  })
  // abort 竞速：内部 abort（调用方取消 / finally 收尾）到达即拒绝。
  let abortReject = null
  const abortedPromise = new Promise((_, reject) => { abortReject = reject })
  const onSettleAbort = () => abortReject(new Error('eval aborted'))
  // 调用方信号可能在进入本函数前、或在 `await compileScript(...)` 的编译窗口内
  // 就已取消（测试里 setTimeout(abort, 80) 与一次冷启动 esbuild 编译就是这种
  // 竞态）。那时 controller 早已 abort，下面再挂监听就永远收不到事件——竞速
  // 形同虚设，只剩硬超时兜底（实测表现为「预取消的 signal 干等满 timeout」）。
  // 所以先判预取消状态，再决定挂监听还是直接拒绝。
  if (controller.signal.aborted) abortReject(new Error('eval aborted'))
  else controller.signal.addEventListener('abort', onSettleAbort, { once: true })
  try {
    const value = await Promise.race([runner.run(compiled.code, opts.args || {}), timeout, abortedPromise])
    controller.signal.removeEventListener('abort', onSettleAbort)
    return value
  } finally {
    clearTimeout(timer)
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
