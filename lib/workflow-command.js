/**
 * workflow-command.js — /workflow 斜杠命令（插件挂载即自动注册，无需配置）
 *
 * ZCode 的 /workflow 形态：人直接跑保存的工作流，不必绕道模型；新建则交给
 * 当前会话的模型按描述生成脚本。语法（rawInput 是 /workflow 之后的原文）：
 *
 *   /workflow                          列出工作库（项目 .dsh 优先，其次全局）+ 活跃运行
 *   /workflow run <名称> [argsJSON]    启动一个已保存的工作流（parent = 当前会话）
 *   /workflow create <任务描述>        把任务交给当前会话的模型：生成脚本 → eval 干跑
 *                                      → create 后台启动（值得复用再 save）
 *   /workflow runs                     列出运行（最新在前）
 *   /workflow stop <runId>             停止一个运行
 *
 * 命令名与内置 / 其他插件冲突时只降级告警，绝不挂掉插件挂载（与
 * command-hook-admin 的逐条容错同策略）。
 *
 * 零 dsh 导入，全部骑运行时 Cordis Context。
 */

import { randomUUID } from 'node:crypto'
import { describeArgsProblem } from './workflow-library.js'

const USAGE = [
  '用法：',
  '  /workflow                          列出工作库与活跃运行',
  '  /workflow run <名称> [argsJSON]    启动一个已保存的工作流',
  '  /workflow create <任务描述>        按描述生成脚本并启动（交给当前会话的模型）',
  '  /workflow runs                     列出运行（最新在前）',
  '  /workflow stop <runId>             停止一个运行',
].join('\n')

// create 的模型指令：模型经 workflow_admin 工具链完成「按描述生成脚本 →
// 干跑验证 → 后台启动 → 按需入库」，任务本身绝不亲手做。
const CREATE_PROMPT = [
  '请用动态工作流完成以下任务——调用 workflow_admin 工具，不要自己逐步执行任务本身：',
  '',
  '<task>',
  '$TASK',
  '</task>',
  '',
  '步骤：',
  '1. 把任务拆成可并行的子步骤，写出工作流脚本体（TypeScript / JavaScript，顶层 return 是运行结果）。facade：agent(prompt, opts?) 委派一个子代理（失败返回 null，不拖垮整体）、parallel(thunks) 并行扇出、pipeline(items, ...stages) 流水线、phase/log/report 记进度、ask(question) 需要人判断时提问。沙箱里没有 require/import/fs/network——脚本只做编排，重活全部通过 agent() 委派给子代理。',
  '2. 先用 workflow_admin 的 action=eval 干跑验证语法与控制流（零成本），按 diagnostics 修正后再继续。',
  '3. 通过后用 action=create 后台启动（label 起个短名），把 run id 报告给用户，并用 /workflow runs 提示查进度；不要 wait:true 阻塞。任务明确值得复用时，再用 action=save 入库（不指定 scope，工具会自动识别项目/全局）。',
].join('\n')

const STATUS_TEXT = {
  pending: '排队',
  running: '运行中',
  completed: '已完成',
  errored: '出错',
  stopped: '已停止',
  orphaned: '孤儿（宿主重启前启动）',
}

/**
 * One saved-library row (the `scope` decides which layer it came from).
 * @typedef {{ name: string, script: string, scope: string, description?: string }} SavedRow
 */
/**
 * One run summary from the registry.
 * @typedef {{ id: string, label?: string, status: string, updatedAt?: number, error?: string }} RunRow
 */
/**
 * The host context slice this module uses.
 * @typedef {{ get: (key: string) => any, logger?: { warn?: (message: string) => void } }} CommandCtx
 */
/**
 * What the slash-command framework hands the handler.
 * @typedef {{ agent?: unknown, rawInput?: string }} Invocation
 */
/**
 * The live agent a `/workflow` invocation runs under. Only the members this
 * module touches are named: identity, the steering channel `create` uses, and
 * the session whose cwd selects the project-scope library.
 * @typedef {{ id: string, steer?: (message: any) => void, session?: { header?: { cwd?: string } } }} CommandAgent
 */
/**
 * The registry/library seam, passed in by index.js.
 * @typedef {{
 *   registry: {
 *     list: () => RunRow[],
 *     start: (spec: any) => Promise<any>,
 *     stop: (runId: string, reason?: string) => Promise<{ stopped?: boolean }|null|undefined>,
 *   },
 *   library: {
 *     listSaved: (cwd: string|undefined) => Record<string, any>[],
 *     getSaved: (name: string, cwd: string|undefined) => Record<string, any>|undefined|null,
 *   },
 * }} CommandDeps
 */

/**
 * Register the `/workflow` slash command against the host command service.
 * @param {CommandCtx} ctx - host context.
 * @param {CommandDeps} deps - the run registry and saved library.
 * @returns {() => void} disposer (also returned when registration is unavailable).
 */
export function applyWorkflowCommand(ctx, deps) {
  const { registry, library } = deps
  const commands = ctx.get('commands')
  if (!commands || typeof commands.register !== 'function') {
    ctx.logger?.warn?.('dsh-plugin-admin: /workflow command not registered — ctx.commands unavailable')
    return () => {}
  }

  let dispose = () => {}
  try {
    dispose = commands.register({
      name: 'workflow',
      description: '工作流：create <任务描述> 让模型生成脚本并启动；run <名称> [argsJSON] 跑已保存的；list / runs / stop 管理',
      input: { hint: '[list | run <名称> [argsJSON] | create <任务描述> | runs | stop <runId>]' },
      /** @param {Invocation} invocation - the framework's invocation record. */
      handler: (invocation) => handle(invocation, registry, library),
    })
  } catch (err) {
    ctx.logger?.warn?.(`dsh-plugin-admin: /workflow command unavailable: ${err && err.message || err}`)
    return () => {}
  }
  return () => { try { dispose() } catch { /* hot-unload race: already gone */ } }
}

/**
 * Dispatch one `/workflow` invocation.
 * @param {Invocation} invocation - agent + raw input.
 * @param {CommandDeps['registry']} registry - the run registry.
 * @param {CommandDeps['library']} library - the saved library.
 * @returns {Promise<{ kind: string, text: string }>}
 */
async function handle(invocation, registry, library) {
  const agent = invocation && invocation.agent
  const raw = String((invocation && invocation.rawInput) || '').trim()
  const parts = raw === '' ? [] : raw.split(/\s+/)
  const head = (parts[0] || 'list').toLowerCase()
  const cwd = sessionCwdOf(agent)

  if (head === 'list' || head === 'ls') return formatList(registry, library, cwd)

  if (head === 'runs') {
    const runs = registry.list()
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 20)
    if (runs.length === 0) return { kind: 'success', text: '没有运行记录。' }
    const statusText = /** @type {Record<string, string>} */ (STATUS_TEXT)
    return {
      kind: 'success',
      text: runs.map((r) => `- ${r.id}「${r.label || r.id}」[${statusText[r.status] || r.status}]${r.error ? ' — ' + r.error : ''}`).join('\n'),
    }
  }

  if (head === 'stop') {
    const runId = parts[1]
    if (!runId) return { kind: 'error', text: '用法：/workflow stop <runId>' }
    const outcome = await registry.stop(runId, 'slash command')
    return outcome && outcome.stopped
      ? { kind: 'success', text: `⏹ 已停止 ${runId}` }
      : { kind: 'error', text: `${runId} 不在运行中（可能已结束，或不属于本进程）。` }
  }

  if (head === 'create') {
    const task = raw.slice(head.length).trim()
    if (!task) return { kind: 'error', text: '用法：/workflow create <任务描述>' }
    if (!isAgent(agent) || typeof agent.steer !== 'function') {
      return { kind: 'error', text: '/workflow create 需要在会话中使用（要把任务交给当前会话的模型）。' }
    }
    agent.steer({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: CREATE_PROMPT.replace('$TASK', task) }],
      source: { kind: 'user' },
    })
    return { kind: 'success', text: '🧵 任务已交给当前会话——模型将生成工作流脚本、eval 干跑后 create 后台启动并回报 run id（/workflow runs 查进度）。' }
  }

  if (head === 'run') {
    const name = parts[1]
    if (!name) return { kind: 'error', text: USAGE }
    let args = {}
    if (parts[2] !== undefined) {
      try { args = JSON.parse(parts.slice(2).join(' ')) } catch {
        return { kind: 'error', text: 'args 不是合法 JSON。' }
      }
    }
    // cwd 可能在会话中途被删（canonicalWorkspacePath 对死路径抛错）：库读取
    // 降级到全局作用域，而不是让整条命令异常。写路径保持 fail-loud。
    const record = readSavedTolerant(() => library.getSaved(name, cwd), () => library.getSaved(name, undefined))
    if (!record) {
      const names = readSavedTolerant(() => library.listSaved(cwd), () => library.listSaved(undefined))
        .map((r) => `${r.name} [${r.scope === 'project' ? '项目' : '全局'}]`).join('、')
      return { kind: 'error', text: `工作库中没有「${name}」。可用：${names || '（空）'}` }
    }
    if (!isAgent(agent)) {
      return { kind: 'error', text: '/workflow run 需要在会话中使用（子代理要挂在一个活的会话下）。' }
    }
    // 与 run_saved 工具同一道 argsSchema 合约（lib/workflow-library.js 的
    // describeArgsProblem）：同一份保存库从两个入口跑，合约强度必须一致——
    // 此前斜杠命令绕过校验，缺参/错型要到脚本内部才炸。
    const schemaProblem = describeArgsProblem(record.argsSchema, args)
    if (schemaProblem !== null) {
      return { kind: 'error', text: `args 不满足「${name}」声明的 argsSchema：${schemaProblem}` }
    }
    const started = await registry.start({ script: record.script, parent: agent, args, label: record.name })
    if (started.diagnostics && started.diagnostics.length) {
      /** @param {{ message?: unknown }} d - one compiler diagnostic. */
      const messageOfDiagnostic = (d) => String(d.message ?? '')
      return { kind: 'error', text: `脚本编译失败：\n${started.diagnostics.map(messageOfDiagnostic).join('\n')}` }
    }
    const scopeText = record.scope === 'project' ? '项目' : '全局'
    return { kind: 'success', text: `🚀 已启动 ${started.id}「${record.name}」（${scopeText}）——后台运行中，/workflow runs 查看进度。` }
  }

  return { kind: 'error', text: `未知子命令「${head}」。\n${USAGE}` }
}

/**
 * Render the saved library and recent runs for `/workflow list`.
 * @param {CommandDeps['registry']} registry - the run registry.
 * @param {CommandDeps['library']} library - the saved library.
 * @param {string|undefined} cwd - the session cwd (selects the project scope).
 * @returns {{ kind: string, text: string }}
 */
function formatList(registry, library, cwd) {
  const saved = readSavedTolerant(() => library.listSaved(cwd), () => library.listSaved(undefined))
  const savedLines = saved.length
    ? saved.map((r) => `- ${r.name} [${r.scope === 'project' ? '项目' : '全局'}]${r.description ? ' — ' + r.description : ''}`).join('\n')
    : '（空）'
  const runs = registry.list()
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 10)
  const statusText = /** @type {Record<string, string>} */ (STATUS_TEXT)
  const runLines = runs.length
    ? '\n\n运行：\n' + runs.map((r) => `- ${r.id}「${r.label || r.id}」[${statusText[r.status] || r.status}]`).join('\n')
    : ''
  return { kind: 'success', text: `工作库：\n${savedLines}${runLines}` }
}

/**
 * Whether the invocation carries a live Agent (the delegate needs one).
 * Declared as a type predicate so the callers reach `steer` / `session` on the
 * narrowed type instead of casting at each use.
 * @param {unknown} agent - the invocation's agent.
 * @returns {agent is CommandAgent}
 */
function isAgent(agent) {
  return agent !== null && agent !== undefined && typeof agent === 'object'
    && typeof (/** @type {{ id?: unknown }} */ (agent).id) === 'string'
}

/**
 * 会话 cwd（项目作用域库的识别点）；cwd 在 session.header 上。
 * @param {unknown} agent - the invocation's agent.
 * @returns {string|undefined} the cwd, or undefined when it cannot be resolved.
 */
function sessionCwdOf(agent) {
  try {
    // `isAgent` narrows elsewhere, but this helper is also called with a looser
    // value, so read the path through an explicit view of the shape.
    const viewed = /** @type {CommandAgent} */ (agent)
    const cwd = viewed?.session?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch { return undefined }
}

/**
 * A session cwd that vanished mid-session (canonicalWorkspacePath throws on a
 * dead path) must not fail a library READ: retry without the project scope.
 * Writes keep failing loud — only reads take this door.
 * @template T
 * @param {() => T} read - the project-scope-aware read.
 * @param {() => T} fallback - the same read against the global scope.
 * @returns {T}
 */
function readSavedTolerant(read, fallback) {
  try { return read() } catch { return fallback() }
}
