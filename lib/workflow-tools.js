/**
 * workflow-tools.js — 工作流的 agent 侧入口
 *
 * 面板（client.js）是给人用的；这一层把同一套 registry / library 暴露成
 * 一个 `workflow_admin` 工具，让模型自己写脚本、起后台运行、改脚本、续跑、
 * 存库。ZCode 的 dynamic workflows 就是这个形态：工具是编排入口，真正的
 * 并行/流水线/缓存逻辑在 lib/workflow-engine.js 里。
 *
 * 单工具 + action 枚举，沿用宿主 plugin_manager 的惯例（一个工具覆盖一族
 * 相关操作，模型只记一个名字）。输出是 JSON 字符串，render 成 text 块。
 *
 * 零 dsh 导入：ToolDefinition 是普通对象，ctx.tools.register 只校验
 * output 形状，parameters 直接用 JSON Schema（分发前由 LLM 层按投影出的
 * schema 校验参数，与 defineTool 的运行时校验等价）。
 */

import { evalSnippet } from './workflow-engine.js'

const READ_ACTIONS = new Set(['list', 'get', 'list_saved', 'eval'])

/**
 * 挂载 workflow 工具。
 * @param {object} ctx - 插件上下文（需 ctx.tools）
 * @param {object} deps - { registry, library }，来自 applyWorkflowAdmin
 * @returns {() => void} 卸载函数（未挂载时为 no-op）
 */
export function applyWorkflowTools(ctx, deps) {
  const { registry, library } = deps
  const tools = ctx.get('tools')
  if (!tools || typeof tools.register !== 'function') {
    ctx.logger?.warn?.('dsh-plugin-admin: workflow tool not registered — ctx.tools unavailable')
    return () => {}
  }

  const dispose = tools.register({
    // 名字必须避开宿主内置 tool-workflow 的默认工具名 `workflow`：插件 ctx
    // 无 scope，注册落在全局工具层，同名会直接抛错并让整个插件挂载失败。
    name: 'workflow_admin',
    description: [
      'Dynamic workflows: write one TypeScript/JavaScript script that orchestrates many subagents in parallel, run it in the background, and manage its lifecycle.',
      '',
      'The script receives a facade: agent(prompt, opts?) delegates one subagent call (returns null on failure so the rest continues), parallel(thunks) runs subagent thunks concurrently behind a semaphore, pipeline(items, ...stages) streams items through stages, phase(title) / log(msg) / report(key, value) record progress, ask(question) blocks the run until the user or you answer it (use it for judgment calls a subagent should not make alone), shell(cmd) runs one host shell command (throws on failure). Top-level return value becomes the run result and must be a JSON value (circular refs / BigInt mark the run errored). Scripts run in an isolated Node vm realm: require/import/fs/network/process globals are unreachable — orchestration only, heavy work goes through agent() and shell(). The realm blocks accidental host access; it is not a hard security boundary.',
      '',
      'Runs are durable: a stopped or errored run can be resumed from its own journal (finished steps are served from cache and cost no subagent calls), and amend() rewrites the script while reusing every cached step it still matches. Runs survive in $DSH_HOME/workflows/runs/ and show in the 工作流 settings panel.',
      '',
      'Actions: create (start a new background run), amend (swap the script, keep cached steps), resume (continue a stopped/errored run), stop (cancel), list (runs), get (one run: script / result / log), answer (reply to a run blocked in ask()), save (store a script in the library — scope auto-detects to the calling session\'s project .dsh; when there is no cwd the tool asks you to relay the choice to the user), run_saved (start a library workflow by name), list_saved, delete_saved (auto-detects project-first, then global), eval (transpile and dry-run a snippet synchronously — agent() is stubbed, so it costs no subagent calls and only checks syntax and control flow).',
      '',
      'Set wait: true on create / amend / resume / run_saved to block this call until the run settles (default: return immediately with the run id).',
    ].join('\n'),
    // 裸注册不经 defineTool 编译，parameters 必须自带完整 JSON Schema：
    // 核心把它原样投影给模型，字段级 map 会让模型侧 schema 残缺。
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'amend', 'resume', 'stop', 'list', 'get', 'answer', 'eval', 'save', 'run_saved', 'list_saved', 'delete_saved'],
          description: 'Workflow operation. create/amend/resume/run_saved start or restart a run; list/get read state; answer replies to a run blocked in ask(); eval dry-runs a snippet; save/list_saved/delete_saved manage the script library.',
        },
        runId: { type: 'string', description: 'Target run id (amend / resume / stop / get / answer).' },
        script: { type: 'string', description: 'The workflow script body (create / amend / save / eval). Top-level return gives the run result.' },
        text: { type: 'string', description: 'The answer text for a run blocked in ask() (answer).' },
        label: { type: 'string', description: 'Human-readable run name (create / amend). Defaults to "workflow".' },
        args: { type: 'object', additionalProperties: true, description: 'JSON object passed to the script as `args` (create / amend / resume / run_saved / eval).' },
        wait: { type: 'boolean', description: 'Block until the run settles instead of returning the run id immediately (create / amend / resume / run_saved).' },
        timeoutMs: { type: 'number', description: 'Eval timeout in milliseconds; defaults to 5000 (eval).' },
        name: { type: 'string', description: 'Library entry name, [A-Za-z0-9._-] only (save / run_saved / delete_saved).' },
        scope: { type: 'string', enum: ['global', 'project'], description: 'Library scope: global ($DSH_HOME) or project (<cwd>/.dsh/workflows, travels with the repo). Omit on save to auto-detect: a calling session with a cwd saves to the project; when undetectable the tool asks you to relay the choice to the user. delete_saved auto-detects project-first, then global.' },
        description: { type: 'string', description: 'One-line description of the library entry (save).' },
        workspacePath: { type: 'string', description: 'Project root for project-scope library ops; defaults to the calling session cwd.' },
        limit: { type: 'number', description: 'Max runs or library entries returned (list / list_saved). Default 25.' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const action = args.action
      const parent = exec?.agent
      const signal = exec?.signal
      const workspacePath = typeof args.workspacePath === 'string' && args.workspacePath.trim() !== ''
        ? args.workspacePath
        : sessionCwd(parent)
      const limit = clampLimit(args.limit)

      switch (action) {
        case 'create': {
          if (typeof args.script !== 'string' || args.script.trim() === '') return json(errorBody('create requires a script'))
          if (!isAgent(parent)) return json(errorBody('no calling agent on this execution context — workflow.create needs a live session as the subagent parent'))
          const started = await registry.start({
            script: args.script,
            parent,
            args: args.args || {},
            label: typeof args.label === 'string' && args.label !== '' ? args.label : 'workflow',
          })
          if (started.diagnostics && started.diagnostics.length) return json({ id: null, status: 'errored', diagnostics: started.diagnostics })
          if (args.wait) { await raceWithSignal(registry.join(started.id), signal); return json(runSummary(registry.get(started.id))) }
          return json(started)
        }
        case 'amend': {
          if (!args.runId) return json(errorBody('amend requires runId'))
          if (typeof args.script !== 'string' || args.script.trim() === '') return json(errorBody('amend requires a script'))
          if (!isAgent(parent)) return json(errorBody('no calling agent on this execution context — workflow.amend needs a live session as the subagent parent'))
          const started = await registry.amend(args.runId, args.script, { parent })
          if (started.diagnostics && started.diagnostics.length) return json({ id: null, status: 'errored', diagnostics: started.diagnostics })
          if (args.wait) { await raceWithSignal(registry.join(started.id), signal); return json(runSummary(registry.get(started.id))) }
          return json(started)
        }
        case 'resume': {
          if (!args.runId) return json(errorBody('resume requires runId'))
          if (!isAgent(parent)) return json(errorBody('no calling agent on this execution context — workflow.resume needs a live session as the subagent parent'))
          const started = await registry.resume(args.runId, { parent, args: args.args })
          if (args.wait) { await raceWithSignal(registry.join(started.id), signal); return json(runSummary(registry.get(started.id))) }
          return json(started)
        }
        case 'stop': {
          if (!args.runId) return json(errorBody('stop requires runId'))
          return json(await registry.stop(args.runId, 'agent tool'))
        }
        case 'list': {
          const runs = registry.list()
          // 最新在前，便于模型先看到活跃态。
          const sorted = runs.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          return json({ runs: sorted.slice(0, limit), total: sorted.length })
        }
        case 'get': {
          if (!args.runId) return json(errorBody('get requires runId'))
          const run = registry.get(args.runId)
          return json(run || errorBody(`run not found: ${args.runId}`))
        }
        case 'answer': {
          if (!args.runId) return json(errorBody('answer requires runId'))
          if (typeof args.text !== 'string' || args.text.trim() === '') return json(errorBody('answer requires a non-empty text'))
          return json(await registry.answer(args.runId, args.text))
        }
        case 'eval': {
          if (typeof args.script !== 'string' || args.script.trim() === '') return json(errorBody('eval requires a script'))
          try {
            const value = await evalSnippet(args.script, { args: args.args || {}, timeoutMs: args.timeoutMs, signal })
            return json({ ok: true, value })
          } catch (err) {
            return json({
              ok: false,
              error: messageOf(err),
              ...(Array.isArray(err.diagnostics) && err.diagnostics.length ? { diagnostics: err.diagnostics } : {}),
            })
          }
        }
        case 'save': {
          if (!args.name) return json(errorBody('save requires a name'))
          if (typeof args.script !== 'string' || args.script.trim() === '') return json(errorBody('save requires a script'))
          // 作用域自动识别（对齐 ZCode SaveWorkflow）：显式 scope 优先；未指定
          // 时调用会话有 cwd → 存项目 .dsh；识别不了（无会话 / 无 cwd）→ 不瞎猜，
          // 回 needsScopeChoice 让模型转问用户，带用户的选择重调。
          const scope = args.scope === 'project' || args.scope === 'global'
            ? args.scope
            : (workspacePath ? 'project' : null)
          if (!scope) {
            return json({
              needsScopeChoice: true,
              error: "cannot detect where to save this workflow (no calling session cwd) — ask the user whether to save it to this project's .dsh/ (project) or the user directory ~/.dsh/ (global), then call save again with scope set to their choice",
            })
          }
          try {
            const record = await library.saveSaved({
              name: args.name, scope, script: args.script,
              description: typeof args.description === 'string' ? args.description : '',
              workspacePath: scope === 'project' ? workspacePath : undefined,
            })
            return json({ ok: true, record })
          } catch (err) {
            return json({ ok: false, error: messageOf(err) })
          }
        }
        case 'run_saved': {
          if (!args.name) return json(errorBody('run_saved requires a name'))
          const record = library.getSaved(args.name, workspacePath)
          if (!record) return json(errorBody(`workflow "${args.name}" not found in the library`))
          if (!isAgent(parent)) return json(errorBody('no calling agent on this execution context — run_saved needs a live session as the subagent parent'))
          const started = await registry.start({
            script: record.script,
            parent,
            args: args.args || {},
            label: record.name,
          })
          if (started.diagnostics && started.diagnostics.length) return json({ id: null, status: 'errored', diagnostics: started.diagnostics })
          if (args.wait) { await raceWithSignal(registry.join(started.id), signal); return json(runSummary(registry.get(started.id))) }
          return json(started)
        }
        case 'list_saved': {
          const saved = library.listSaved(workspacePath)
          return json({ saved: saved.slice(0, limit), total: saved.length })
        }
        case 'delete_saved': {
          if (!args.name) return json(errorBody('delete_saved requires a name'))
          try {
            // 与读取同序的对称识别：显式 scope 只删那一级；未指定时项目优先、
            // 退回全局，并回报实际删掉的一级。
            if (args.scope === 'project' || args.scope === 'global') {
              const ok = library.deleteSaved(args.name, args.scope, args.scope === 'project' ? workspacePath : undefined)
              return json(ok
                ? { ok: true, scope: args.scope }
                : { ok: false, error: `workflow "${args.name}" not found in ${args.scope}` })
            }
            if (workspacePath && library.deleteSaved(args.name, 'project', workspacePath)) {
              return json({ ok: true, scope: 'project' })
            }
            if (library.deleteSaved(args.name, 'global', undefined)) {
              return json({ ok: true, scope: 'global' })
            }
            return json({ ok: false, error: `workflow "${args.name}" not found` })
          } catch (err) {
            return json({ ok: false, error: messageOf(err) })
          }
        }
        default:
          return json(errorBody(`unknown action: ${String(action)}`))
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Workflow: ${String(args.action)}`,
      kind: READ_ACTIONS.has(args.action) ? 'read' : 'other',
      rawInput: args,
    }),
  })

  return () => { try { dispose() } catch { /* hot-unload race: already gone */ } }
}

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function isAgent(parent) {
  return parent !== null && parent !== undefined && typeof parent === 'object'
    && typeof parent.id === 'string'
}

/** 从调用方 Agent 的 session 上取 cwd（项目作用域库的落点）。cwd 在 session.header 上。 */
function sessionCwd(parent) {
  try {
    const cwd = parent?.session?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch { return undefined }
}

function clampLimit(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 25
  return Math.min(Math.max(Math.trunc(n), 1), 100)
}

/** wait: true 时把 run 落定和工具取消信号绑在一起——用户打断会话时不再干等。 */
function raceWithSignal(promise, signal) {
  if (!signal || typeof signal.addEventListener !== 'function') return promise
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    promise.then(finish, finish)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function errorBody(message) {
  return { error: message }
}

function runSummary(run) {
  if (!run) return errorBody('run vanished before it settled')
  return {
    id: run.id,
    label: run.label,
    status: run.status,
    durationMs: run.durationMs,
    stepCount: Array.isArray(run.steps) ? run.steps.length : 0,
    error: run.error || undefined,
    result: run.result,
    resumedFrom: run.resumedFrom || undefined,
    amendedFrom: run.amendedFrom || undefined,
  }
}

function messageOf(err) {
  if (err !== null && typeof err === 'object' && typeof err.message === 'string') return err.message
  if (typeof err === 'string') return err
  return String(err)
}

function json(value) {
  return JSON.stringify(value, null, 2)
}
