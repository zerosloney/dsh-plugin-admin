/**
 * workflow-engine.js — ZCode 风格动态工作流引擎核心
 *
 * agent 现场写 TS 脚本 → esbuild 转译 → node:vm realm 隔离执行 → 成百上千子代理并行。
 * 执行底座是 ctx.subagents（宿主原生并行 + 可续接），不是 ctx.workflowEngine
 * （后者前台阻塞、一次性，挂不上 amend/resume）。
 *
 * 本文件只负责「把一段脚本跑完」：
 *   - compileScript()    脚本体 → 可执行的函数字符串（宿主 peer 的 esbuild），诊断直接拒绝
 *   - createRunner()     构造 facade + realm，返回 run(record) / cancel()
 *   - facade             agent / parallel / pipeline / phase / log / report / shell
 *
 * 隔离强度（别把它读成沙箱）：脚本跑在 **node:vm realm** 里，没有 process / fetch /
 * require / fs 等宿主全局，宿主返回值一律折成 JSON 文本再在 realm 内重建，所以脚本
 * 拿不到任何带宿主原型的对象；同步前缀由 V8 的 vm timeout 设预算，避免死循环冻结宿主。
 * 但它与宿主**同进程、同信任级**，脚本真正的权力来自 facade（`shell()` 会跑真实宿主
 * 命令），刻意逃逸不属于防御目标——需要硬边界就得像宿主 PTC 工作流那样放到子进程。
 *
 * 生命周期（journal / 状态机 / amend / resume）在 workflow-runs.js；本引擎只暴露
 * step cache 挂钩点，让上层决定已完成步骤是否跳过重跑。
 *
 * 零 dsh 导入，全部骑运行时 Cordis Context（与插件其余模块同风格）。
 */

import vm from 'node:vm'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { writeJsonAtomic, messageOf} from './patch-utils.js'
import { resolveShellSandboxPolicy } from './shell-policy.js'

// ─── 转译 ───────────────────────────────────────────────────────────────────

const FACADE_PARAMS = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'report', 'shell', 'ask', 'args', 'require', 'import_']

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

  return { acquire, release, runThunks, activeOf }
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
 * 刻意只列语义字段：agent() 的 provider / model / schema 决定这一步由谁、
 * 以什么形状产出；shell() 的 workdir / timeoutMs 决定命令在哪、跑多久。
 * 展示类字段（label 之类）不进键，免得改个显示名就重花一次子代理调用。
 * @param {'agent'|'shell'|string} kind
 * @param {unknown} opts
 * @returns {string} 稳定的比较材料（无语义字段时为空串）。
 */
function semanticOptsMaterial(kind, opts) {
  if (opts === null || typeof opts !== 'object') return ''
  const fields = kind === 'shell' ? ['workdir', 'timeoutMs'] : ['provider', 'model', 'schema']
  const parts = []
  for (const field of fields) {
    const value = opts[field]
    if (value === undefined || value === null) continue
    parts.push(field + '=' + canonicalJson(value))
  }
  return parts.join('\u0000')
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
 * @returns {string} `<site>:<kind>:<sha256 前 16 hex>`。
 */
export function stepFingerprint(callSite, kind, payload, opts) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const material = json + '\u0000' + semanticOptsMaterial(kind, opts)
  return `${callSite}:${kind}:${createHash('sha256').update(material).digest('hex').slice(0, 16)}`
}

// ─── facade + 沙箱 ────────────────────────────────────────────────────────────

/** Synchronous-prefix budget for one script (overridable through deps.syncTimeoutMs). */
const DEFAULT_SYNC_TIMEOUT_MS = 30_000

/**
 * realm 侧入口源码，在脚本自己的 realm 里求值。它做两件事，**两件都必须在 realm 内完成**：
 *
 *   1. facade：每个成员都是 realm 闭包。脚本对 facade 成员做 `.constructor` 逃逸探查
 *      只会拿到 realm 的 Function；若换成宿主闭包，一步就是宿主 Function。
 *   2. 桥接：所有宿主返回值都经 `host.invoke(name, args)` 取回 **JSON 文本**，再在
 *      本 realm 内 `JSON.parse` 重建。宿主对象因此一个都进不来——`args`、
 *      `agent()`/`shell()` 的返回值、`parallel()`/`pipeline()` 的数组，以及
 *      rejection 里的宿主 `Error`（它的原型链同样是逃逸通道），全部在宿主侧折成
 *      文本。
 *
 * 方向性：宿主 → realm 只递字符串 primitive；realm → 宿主递 realm 值（该方向安全——
 * realm 的 Function 求 `'return process'` 只会 ReferenceError）。`host` 本身是宿主
 * 对象，但它只在闭包里，脚本拿不到（闭包不可内省）。
 *
 * `require` / `import_` 是 realm 内的抛错桩，键名与顺序对齐 compileScript 的
 * FACADE_PARAMS。
 */
const REALM_FACADE_SOURCE = `(host) => {
  const revive = (payload) => {
    const outcome = JSON.parse(payload)
    if (outcome.ok !== true) throw new Error(String(outcome.error))
    return outcome.value
  }
  const invoke = (name, args) => host.invoke(name, args).then(revive, (failure) => {
    // host.invoke 已经把业务错误折进文本，所以走到这里的 rejection 只可能是桥自身
    // 坏了：重新抛 realm 的 Error，绝不让宿主错误对象跨进来。
    throw new Error('workflow host bridge failed: ' + String(failure))
  })
  return {
    agent: (...a) => invoke('agent', a),
    parallel: (thunks) => invoke('parallel', [thunks]),
    pipeline: (items, ...stages) => invoke('pipeline', [items, ...stages]),
    phase: (title) => invoke('phase', [title]),
    log: (message) => invoke('log', [message]),
    report: (key, value) => invoke('report', [key, value]),
    shell: (...a) => invoke('shell', a),
    ask: (question) => invoke('ask', [question]),
    args: JSON.parse(host.argsText),
    require: () => { throw new Error('require() is not available in workflow scripts') },
    import_: () => { throw new Error('import() is not available in workflow scripts') },
  }
}`

/** Whether one vm error is V8's script-execution timeout (see the invocation in run()). */
function isScriptTimeout(error) {
  return error !== null && typeof error === 'object' && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
}

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
 *                                      那里的死循环会连事件循环一起占住，只有 V8 的
 *                                      vm timeout 能打断。
 * @returns {Record<string, any>} { run(scriptCode, args) -> Promise<value>, facade }
 */
export function createRunner(deps) {
  const {
    ctx, parent, signal, semaphore, provider,
    onStep = null, onLog = null, onAsk = null,
  } = deps
  const syncTimeoutMs = typeof deps.syncTimeoutMs === 'number' && Number.isFinite(deps.syncTimeoutMs) && deps.syncTimeoutMs > 0
    ? deps.syncTimeoutMs
    : DEFAULT_SYNC_TIMEOUT_MS

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
   * The host half of the realm bridge: the ONLY host object the realm ever sees,
   * and it stays inside the realm-side closures (never exposed as a script value).
   *
   * Every reply is JSON TEXT, and business failures are folded into that text for
   * the same reason: a host `Error` crossing into the realm would hand the script
   * `error.constructor.constructor` — the host Function — straight back.
   * `args` crosses the same way (as text), so the script works on a realm copy.
   * @param {unknown} scriptArgs - the `args` value handed to the script.
   * @returns {{ argsText: string, invoke: (name: string, args: unknown[]) => Promise<string> }}
   */
  function makeHostBridge(scriptArgs) {
    let argsText
    try {
      argsText = JSON.stringify(scriptArgs === undefined ? null : scriptArgs)
    } catch (error) {
      throw new Error('workflow args must be a JSON value: ' + String(error && error.message || error))
    }
    return {
      argsText: typeof argsText === 'string' ? argsText : 'null',
      invoke: async (name, argsList) => {
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
      },
    }
  }

  /**
   * 在独立 vm realm 里跑转译后的脚本。
   *
   * realm 只递**一个**宿主对象（`host` 桥），且它只活在 realm 闭包里；脚本能摸到的
   * 每个值要么是 realm 内建、要么是 realm 闭包、要么是 `JSON.parse` 在本 realm 重建
   * 出来的副本。于是 `args.constructor.constructor('return process')()` 这条经典
   * 逃逸路径（本文件旧注释里逐字记录过）被堵住了：`args` 现在是 realm 对象，
   * `.constructor` 是 realm 的 Object、`.constructor.constructor` 是 realm 的
   * Function，求 `'return process'` 只会 ReferenceError。
   *
   * **这不是硬安全边界**：与宿主同进程、同信任级，脚本真正的权力来自 facade
   * （agent() / shell()）。realm 防的是"意外拿到宿主能力"，不是刻意逃逸。
   *
   * 超时：async 函数体在首个 await 之前同步执行，`while(true){}` 因此会占住整个
   * 事件循环——abort 与 eval 的 `Promise.race` 都靠定时器，永远排不上。唯一有效的
   * 手段是在 vm 内带 `timeout` 调用，让 V8 终止执行（实测见 verify-workflow-engine
   * 的同步死循环用例）。首个 await 之后的挂起不受此保护：那时事件循环是自由的，
   * 由调用方的 abort / 硬超时负责。
   *
   * code 是 compileScript 的产物：一个 async 函数声明。语句位置取值
   * `workflow_main`，分号 / sourcemap 尾巴都不影响。
   */
  async function run(code, args) {
    const context = vm.createContext({})
    const bindFacade = vm.runInContext(`(${REALM_FACADE_SOURCE})`, context, { filename: 'workflow-facade.js' })
    const realmFacade = bindFacade(makeHostBridge(args))
    const script = new vm.Script(`${code}\n;workflow_main;`, { filename: 'workflow-script.js' })
    /** Run one compiled script under the synchronous-prefix budget. */
    const runTimed = (compiled) => {
      try {
        return compiled.runInContext(context, { timeout: syncTimeoutMs })
      } catch (error) {
        if (isScriptTimeout(error)) {
          throw new Error(`workflow script ran ${syncTimeoutMs}ms of synchronous code without reaching an await — it would freeze the host event loop, so it was stopped (move the work behind agent()/shell() or add an await)`)
        }
        throw error
      }
    }
    // Only REALM values may be stored on the context: assigning a host array or
    // object here would hand the script the host prototype chain again.
    context.__dshWorkflowMain = runTimed(script)
    context.__dshWorkflowFacade = realmFacade
    // The invocation itself runs INSIDE the vm so the budget covers the sync
    // prefix; the arguments are read from the realm facade object, so no host
    // array crosses (a host array would expose Array.prototype.constructor).
    const invoke = new vm.Script(
      `__dshWorkflowResult = __dshWorkflowMain(${FACADE_PARAMS.map((name) => '__dshWorkflowFacade.' + name).join(', ')})`,
      { filename: 'workflow-invoke.js' },
    )
    runTimed(invoke)
    const raw = await context.__dshWorkflowResult
    // 结果值跨 realm 回宿主：JSON 安全化顺带把 realm 对象克隆成宿主 plain object
    // （直接持有 realm 对象会泄漏 realm 原型，persist 的 JSON.stringify 也会在
    // 循环引用上炸掉）。不可序列化的结果在这里就抛——上层 settle 判 errored，
    // 记录不会卡在 running（对齐宿主引擎 RESULT_UNSERIALIZABLE 的语义）。
    return jsonSafeValue(raw)
  }

  return { run, facade, _callSite: () => callSite }
}

// ─── 产出值 JSON 安全化 ────────────────────────────────────────────────────────

/**
 * 深拷贝脚本产出值为 JSON 安全结构。剥 undefined（typert 的 src-json 边界拒绝
 * undefined 值字段）与函数值属性；Date 转 ISO 字符串（对齐 JSON.stringify 的
 * 鸭子类型判定，跨 realm 也成立）。循环引用 / BigInt / symbol 值抛 TypeError，
 * 由调用方决定降级（report）还是判 errored（运行终值）。
 * @param {unknown} value 脚本产出值（可能是 vm realm 侧对象）
 * @param {WeakSet} [seen] 递归防环
 * @returns {unknown} 宿主 plain object 组成的 JSON 安全值
 */
function jsonSafeValue(value, seen = new WeakSet()) {
  if (value === undefined || value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return value
  if (type === 'bigint' || type === 'symbol') {
    throw new TypeError(`workflow value is not JSON-serializable: ${type} (return plain JSON values)`)
  }
  if (type === 'function') return null
  // object：`seen` 是**祖先栈**而不是"访问过集合"——递归返回时必须把自己摘掉，
  // 否则一个共享但无环的引用（`const x = {}; return { a: x, b: x }`）会被误判成
  // 循环引用。真正的环会再次命中仍在栈上的自己，照旧抛错。
  if (seen.has(value)) {
    throw new TypeError('workflow value is not JSON-serializable: circular reference (return plain JSON values)')
  }
  seen.add(value)
  try {
    // Compile-time cast only: the runtime typeof gate below still decides.
    const dated = /** @type {Date} */ (value)
    if (typeof dated.toISOString === 'function') return dated.toISOString()
    if (Array.isArray(value)) {
      // 不用 .map：realm 侧数组的 map 经 species 造出来的仍是 realm 数组。
      const out = []
      for (const item of value) out.push(jsonSafeValue(item, seen))
      return out
    }
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === 'function') continue
      out[key] = jsonSafeValue(item, seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
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
  }
}
