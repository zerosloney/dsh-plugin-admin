/**
 * workflow-engine.js — ZCode 风格动态工作流引擎核心
 *
 * agent 现场写 TS 脚本 → esbuild 转译 → node:vm realm 隔离执行 → 成百上千子代理并行。
 * 执行底座是 ctx.subagents（宿主原生并行 + 可续接），不是 ctx.workflowEngine
 * （后者前台阻塞、一次性，挂不上 amend/resume）。
 *
 * 本文件只负责「把一段脚本跑完」：
 *   - compileScript()    脚本体 → 可执行的函数字符串（宿主 peer 的 esbuild），诊断直接拒绝
 *   - createRunner()     构造 facade + 沙箱，返回 run(record) / cancel()
 *   - facade             agent / parallel / pipeline / phase / log / report / shell
 *
 * 生命周期（journal / 状态机 / amend / resume）在 workflow-runs.js；本引擎只暴露
 * step cache 挂钩点，让上层决定已完成步骤是否跳过重跑。
 *
 * 零 dsh 导入，全部骑运行时 Cordis Context（与插件其余模块同风格）。
 */

import vm from 'node:vm'
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// ─── 转译 ───────────────────────────────────────────────────────────────────

const FACADE_PARAMS = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'report', 'shell', 'ask', 'args', 'require', 'import_']

/**
 * 把脚本体包成 facade 调用签名，作为一整个 TS 单元转译。
 *
 * 为什么要「先包再译」：脚本的顶层 return 在 ESM 里非法，esbuild 会把它包成
 * __commonJS 模块，输出里出现 export default —— 拿到 new Function 里直接语法
 * 错误。先包进箭头函数，return 就是普通的函数返回，转译输出是干净的表达式。
 *
 * @returns {{ code: string|null, diagnostics: Array }}
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

// 纯 TS 特征启发式，只在 esbuild 缺失时用于拒绝 TS 脚本。
function looksLikeTs(script) {
  return /(?:^|[\s;])(?:interface|type|enum|implements|namespace|declare|abstract)\s+\w+/.test(script)
    || /[:<]\s*(?:string|number|boolean|any|unknown|never|void)\b/.test(script)
    || /\w+\s*:\s*[A-Za-z_$][\w$]*(?=\s*[),;=]|$)/m.test(script)
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
 * amend 时「未变步骤不重跑」的键：facade 调用点 + 参数。调用点序号在
 * createRunner 里按出现顺序分配（同一脚本内第 N 次 facade 调用），脚本一改，
 * 调用点序列就变，缓存自然失效——和 ZCode 的缓存语义一致。
 */
export function stepFingerprint(callSite, kind, payload) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return `${callSite}:${kind}:${createHash('sha256').update(json).digest('hex').slice(0, 16)}`
}

// ─── facade + 沙箱 ────────────────────────────────────────────────────────────

const ALLOWED_AGENT_OPTS = new Set(['label', 'phase', 'provider', 'model', 'schema'])

/**
 * realm 侧 facade 工厂的源码：在脚本自己的 realm 里求值，产出的转发闭包也是
 * realm 函数——脚本对它们做 `.constructor` 逃逸探查只会得到 realm 的 Function，
 * 而不是经参数混进来的宿主闭包（host 闭包的 .constructor 就是宿主 Function，
 * 一层就能 `('return process')()`）。require / import_ 是 realm 内的抛错桩，
 * 连同 args 一起对齐 compileScript 的 FACADE_PARAMS 签名。
 */
const REALM_FACADE_SOURCE = `(host) => ({
  agent: (...a) => host.agent(...a),
  parallel: (thunks) => host.parallel(thunks),
  pipeline: (items, ...stages) => host.pipeline(items, ...stages),
  phase: (title) => host.phase(title),
  log: (message) => host.log(message),
  report: (key, value) => host.report(key, value),
  shell: (...a) => host.shell(...a),
  ask: (question) => host.ask(question),
  args: host.args,
  require: () => { throw new Error('require() is not available in workflow scripts') },
  import_: () => { throw new Error('import() is not available in workflow scripts') },
})`

/**
 * 构造一次运行的执行器。
 *
 * @param {object}   deps
 * @param {object}   deps.ctx           Cordis Context（运行时）
 * @param {object}   deps.parent        Agent — 子代理的 parent（cwd/血缘/深度来源）
 * @param {AbortSignal} deps.signal     运行级取消信号
 * @param {object}   deps.semaphore     并发信号量
 * @param {string}   [deps.provider]    subagent provider（缺省用宿主默认）
 * @param {function} [deps.onStep]      每个 facade 调用前后回调（挂 journal / cache）
 * @param {function} [deps.onLog]       log()/phase() 回调
 * @param {function} [deps.onAsk]       ask(text) 的回答通道：(text) => Promise<string>；
 *                                      缺省时 ask() 抛错（eval 模式）
 * @returns {object} { run(scriptCode, args) -> Promise<value>, facade }
 */
export function createRunner(deps) {
  const {
    ctx, parent, signal, semaphore, provider,
    onStep = null, onLog = null, onAsk = null,
  } = deps

  const subagents = ctx.get('subagents')
  const shell = ctx.get('shell')

  let callSite = 0
  const stepCache = new Map()

  function makeAgentCall(kind) {
    return async (first, second) => {
      const site = ++callSite
      // agent(prompt, opts?) 与 shell 的参数形态不同，在各自入口归一化。
      const [prompt, opts] = kind === 'agent'
        ? normalizeAgentArgs(first, second)
        : [first, second || {}]

      const fingerprint = stepFingerprint(site, kind, prompt)

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
    const spec = shell.resolve({
      command: String(command),
      ...(opts && opts.workdir ? { workdir: opts.workdir } : {}),
      ...(opts && opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      signal,
    })
    const result = await shell.run(spec)
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
   * 在独立 vm realm 里跑转译后的脚本。realm 的全局只有 JS 内建（Object / Promise /
   * JSON / Math / …），没有 process / fetch / require / fs / 网络；宿主 facade 经
   * realm 内的转发闭包注入，脚本摸 `.constructor` 只会摸到 realm 自己的 Function，
   * 拿不到宿主 realm 的求值能力（否则一个 host 闭包就够逃逸）。
   *
   * realm 防的是意外访问，不是硬安全边界：与宿主同进程、同信任级别，刻意逃逸
   * 不在防御目标内；重活本就只走 agent() / shell() 这两个显式出口。
   *
   * code 是 compileScript 的产物：一个 `(async (agent, ...) => { ... })`
   * 函数表达式字符串。语句位置取值：`workflow_main` 是具名函数声明，分号 /
   * sourcemap 尾巴都不影响。
   */
  async function run(code, args) {
    const context = vm.createContext({})
    const bindFacade = vm.runInContext(`(${REALM_FACADE_SOURCE})`, context, { filename: 'workflow-facade.js' })
    const realmFacade = bindFacade({
      agent: facade.agent, parallel: facade.parallel, pipeline: facade.pipeline,
      phase: facade.phase, log: facade.log, report: facade.report,
      shell: facade.shell, ask: facade.ask, args,
    })
    const script = new vm.Script(`${code}\n;workflow_main;`, { filename: 'workflow-script.js' })
    const workflowFn = script.runInContext(context)
    const raw = await workflowFn(
      realmFacade.agent, realmFacade.parallel, realmFacade.pipeline,
      realmFacade.phase, realmFacade.log, realmFacade.report, realmFacade.shell, realmFacade.ask,
      realmFacade.args, realmFacade.require, realmFacade.import_,
    )
    // 结果值跨 realm 回宿主：JSON 安全化顺带把 realm 对象克隆成宿主 plain object
    // （直接持有 realm 对象会泄漏 realm 原型，persist 的 JSON.stringify 也会在
    // 循环引用上炸掉）。不可序列化的结果在这里就抛——上层 settle 判 errored，
    // 记录不会卡在 running（对齐宿主引擎 RESULT_UNSERIALIZABLE 的语义）。
    return jsonSafeValue(raw)
  }

  return { run, facade, stepCache, _callSite: () => callSite }
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
  // object：先查环再递归；Date 走 ISO（跨 realm 不能用 instanceof）。
  if (seen.has(value)) {
    throw new TypeError('workflow value is not JSON-serializable: circular reference (return plain JSON values)')
  }
  seen.add(value)
  if (typeof value.toISOString === 'function') return value.toISOString()
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
  const temp = path + '.tmp'
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, path)
}

// ─── 试运行（eval）────────────────────────────────────────────────────────────

/**
 * 同步跑一段脚本，不给真 agent 花调用：agent() 返回固定桩字符串，shell() 直接
 * 抛错，ask() 不可用。用途是模型在 `workflow create` 之前先验证语法和控制流——
 * ZCode 的 eval_snippet 同款定位。
 *
 * @param {string} scriptBody 脚本体
 * @param {object} [opts] { args?, stub?, timeoutMs?, signal? }
 * @returns {Promise<unknown>} 脚本的返回值
 * @throws {Error} 转译或运行失败；编译失败时 error.diagnostics 带 esbuild 诊断；
 *   opts.signal 中止时拒绝 'eval aborted'
 */
export async function evalSnippet(scriptBody, opts = {}) {
  const compiled = await compileScript(scriptBody, 'eval.ts')
  if (compiled.diagnostics.length > 0) {
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
  const runner = createRunner({
    ctx: evalCtx,
    parent: null,
    signal: controller.signal,
    semaphore: createSemaphore(4),
  })
  // 调用方的取消信号（工具 exec.signal）转发为内部 abort：用户打断会话时，
  // eval 的等待随 abort 竞速退出，而不是干等硬超时。纯 JS 死循环依旧只能靠
  // 硬超时兜底——abort 传不进不感知信号的同步代码。
  const forwardAbort = () => controller.abort('caller aborted')
  if (opts.signal) {
    if (opts.signal.aborted) forwardAbort()
    else opts.signal.addEventListener('abort', forwardAbort, { once: true })
  }

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 5_000
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
  controller.signal.addEventListener('abort', onSettleAbort, { once: true })
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
