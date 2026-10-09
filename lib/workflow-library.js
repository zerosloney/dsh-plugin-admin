/**
 * workflow-library.js — saved 工作流库 + workflowAdmin RPC 服务
 *
 * 两件事：
 *   1. saved 库 CRUD —— 脚本 + 参数声明 + 元数据，双作用域（项目级 / 全局）
 *   2. workflowAdmin —— typert RPC 服务，供浏览器面板调用：
 *      runs 列表 / 详情 / 启动 / 停止 / amend / resume / saved 库读写
 *
 * 作用域（对齐 ZCode 的 .zcode/workflows，以及插件现有 patch 的作用域约定）：
 *   - 项目级 <workspace>/.dsh/workflows/*.json   随仓库走
 *   - 全局   $DSH_HOME/workflows/saved/*.json
 *
 * 零 dsh 导入，全部骑运行时 Cordis Context。
 */

import { join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { savedDir, readJsonIfExists, atomicWriteJson } from './workflow-engine.js'
import { canonicalWorkspacePath, isInsidePath, projectWorkflowsDir, assertTrustedWorkspacePath } from './workspace-path.js'

// 库条目名即文件名：三个入口（save/get/delete）共用同一守卫，
// 否则 get/delete 的裸 join 会成为路径穿越（save 之前是唯一有校验的）。
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/

/** @param {string} name */
function assertValidName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`invalid workflow name: ${name}`)
  }
}

/** @param {object} deps - `{ dshHome, enqueue }`.
 * @param {string} deps.dshHome - $DSH_HOME.
 * @param {function} deps.enqueue - shared serial write queue. */
export function createWorkflowLibrary(deps) {
  const { dshHome, enqueue } = deps

  function globalDir() { return savedDir(dshHome) }

  /**
   * The project scope for one caller-supplied root: its canonical root and the
   * `<root>/.dsh/workflows` directory. This is the single choke point every
   * project-scope read/write/delete goes through, so the structural fence lives
   * HERE as well as at the untrusted entry points: even a caller that forgets
   * the trust check cannot hand `join()` a relative path, a filesystem root, a
   * non-directory, or a `.dsh` junction that escapes the project (see
   * lib/workspace-path.js).
   * @param {unknown} workspacePath - the caller-supplied project root.
   * @returns {{ root: string, dir: string }|null} null when no path was given.
   */
  function projectScope(workspacePath) {
    if (workspacePath === undefined || workspacePath === null || workspacePath === '') return null
    const root = canonicalWorkspacePath(workspacePath)
    return { root, dir: projectWorkflowsDir(root) }
  }

  /**
   * Require the directory's REAL path to stay inside the project root. The
   * structural fence (projectWorkflowsDir) refuses links that exist at check
   * time; this re-verifies at the moment of use, because a junction can be
   * swapped in between any check and the fs access that follows it.
   * @param {string} dir - the directory about to be read or written.
   * @param {string} root - the project root it must stay inside.
   */
  function assertDirInsideRoot(dir, root) {
    const real = realpathSync(dir)
    if (!isInsidePath(real, root)) {
      throw new Error(`refusing to use ${dir}: it resolves to ${real}, outside the project root ${root}`)
    }
  }

  /**
   * Create the directory when missing, then re-verify containment on the REAL
   * path: `<root>/.dsh` may have been a junction all along, or one may have
   * appeared between the two checks.
   * @param {string|null} dir - directory to ensure.
   * @param {string|null} [root] - the project root the directory must stay inside.
   * @returns {string|null}
   */
  function ensureDir(dir, root = null) {
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (dir && root !== null) assertDirInsideRoot(dir, root)
    return dir
  }

  // ─── 读取 ────────────────────────────────────────────────────────────────

  /** @param {string|undefined} workspacePath */
  function listSaved(workspacePath) {
    const items = []
    const gdir = globalDir()
    if (existsSync(gdir)) {
      for (const file of readdirSync(gdir)) {
        if (!file.endsWith('.json')) continue
        const rec = readJsonIfExists(join(gdir, file))
        if (rec) items.push(withScope(rec, 'global'))
      }
    }
    const scope = projectScope(workspacePath)
    if (scope !== null && existsSync(scope.dir)) {
      // 与写/删路径同款的相邻 realpath 复验：projectWorkflowsDir 只拒绝检查
      // 时刻已存在的链，检查与 readdir 之间换进来的 junction 必须在这里被
      // 拒绝，否则项目级读取变成项目外的目录列举与 <name>.json 读取。
      assertDirInsideRoot(scope.dir, scope.root)
      for (const file of readdirSync(scope.dir)) {
        if (!file.endsWith('.json')) continue
        const rec = readJsonIfExists(join(scope.dir, file))
        if (rec) items.push(withScope(rec, 'project'))
      }
    }
    // 项目级优先于全局同名（项目覆盖全局）
    const byName = new Map()
    for (const item of items) byName.set(item.name, item)
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** @param {string} name
   * @param {string|undefined} workspacePath */
  function getSaved(name, workspacePath) {
    assertValidName(name)
    // 项目级先找（含与写/删路径同款的相邻复验，理由见 listSaved）
    const scope = projectScope(workspacePath)
    if (scope !== null && existsSync(scope.dir)) {
      assertDirInsideRoot(scope.dir, scope.root)
      const rec = readJsonIfExists(join(scope.dir, `${name}.json`))
      if (rec) return withScope(rec, 'project')
    }
    const rec = readJsonIfExists(join(globalDir(), `${name}.json`))
    return rec ? withScope(rec, 'global') : null
  }

  // ─── 写入 ────────────────────────────────────────────────────────────────

  /** @param {any} spec */
  async function saveSaved(spec) {
    const { name, scope: saveScope, script, argsSchema, description, workspacePath } = spec
    if (!name) throw new Error('saved workflow requires a name')
    assertValidName(name)
    if (!script) throw new Error('saved workflow requires a script')

    const scope = saveScope === 'project' ? projectScope(workspacePath) : null
    const dir = saveScope === 'project'
      ? ensureDir(scope === null ? null : scope.dir, scope === null ? null : scope.root)
      : ensureDir(globalDir())
    if (!dir) throw new Error('project scope requires a workspacePath')
    // The early recheck ran before this closure was queued; the queue may hold
    // minutes of pnpm/npm work, and a junction swapped in during that wait
    // would land the write outside the project the user trusted. Re-verify
    // ADJACENT to the write, inside the slot that performs it.
    const root = saveScope === 'project' && scope !== null ? scope.root : null

    const record = {
      name,
      script,
      argsSchema: argsSchema || null,
      description: description || '',
      scope: saveScope,
      updatedAt: Date.now(),
    }
    // 原子写走串行队列，与插件其余写盘一致。
    return enqueue(() => {
      if (root !== null) assertDirInsideRoot(dir, root)
      atomicWriteJson(join(dir, `${name}.json`), record)
      return record
    })
  }

  /** @param {string} name
   * @param {string} scope
   * @param {string|undefined} workspacePath
   * @returns {Promise<boolean>} whether a file was removed. */
  function deleteSaved(name, scope, workspacePath) {
    // Name/scope validation stays SYNCHRONOUS (a caller bug should throw at
    // the call site, not surface as a rejected promise), while the destructive
    // IO rides the queue with the same adjacent re-verification as saveSaved.
    assertValidName(name)
    const project = projectScope(workspacePath)
    const dir = scope === 'project' ? (project === null ? null : project.dir) : globalDir()
    if (!dir) throw new Error('project scope requires a workspacePath')
    const path = join(dir, `${name}.json`)
    const root = scope === 'project' && project !== null ? project.root : null
    // The serial queue may hold minutes of queued work, so the containment
    // re-verification runs ADJACENT to the unlink inside the slot (a junction
    // swapped in during the wait must not turn a project delete into an
    // arbitrary-file delete), and the delete cannot reorder around a queued
    // save.
    return enqueue(() => {
      if (root !== null) assertDirInsideRoot(dir, root)
      if (!existsSync(path)) return false
      unlinkSync(path)
      return true
    })
  }

  return { listSaved, getSaved, saveSaved, deleteSaved }
}

/** @param {any} rec
 * @param {string} scope
 * @returns {Record<string, any>} */
function withScope(rec, scope) {
  return { ...rec, scope: rec.scope || scope }
}

// ─── workflowAdmin RPC 服务 ──────────────────────────────────────────────────

/**
 * 挂到 ctx.provide('workflowAdmin', ...)，供浏览器面板经 typert RPC 调用。
 * 方法签名与 client.js 的面板调用一一对应。
 */
/** @param {object} deps - `{ registry, library, ctx }`.
 * @param {any} deps.registry - the run registry.
 * @param {any} deps.library - the saved-workflow library.
 * @param {Record<string, any>} deps.ctx - the plugin context. */
export function createWorkflowAdmin(deps) {
  const { registry, library, ctx } = deps

  /**
   * Validate one browser-supplied project root before any project-scope use.
   * @param {unknown} workspacePath - `spec.workspacePath` as it arrived over RPC.
   * @returns {{ path: string|undefined, error?: string }} the canonical path (or
   *   undefined when the caller sent none) and, when refused, the reason.
   */
  function workspaceGate(workspacePath) {
    if (typeof workspacePath !== 'string' || workspacePath.trim() === '') return { path: undefined }
    try {
      return { path: assertTrustedWorkspacePath(workspacePath, { registry: ctx.get('workspaceRegistry') }) }
    } catch (err) {
      return { path: undefined, error: String(err && err.message || err) }
    }
  }

  return {
    /** 列出所有运行（活的 + 磁盘上的） */
    listRuns() {
      const active = registry.list()
      return { active, statuses: registry.STATUS }
    },

    getRun(/** @type {string} */ runId) {
      return registry.get(runId)
    },

    /**
     * 启动一个工作流。面板侧的「新建运行」。
     * parent 必须由宿主侧解析（浏览器拿不到 Agent 对象）：
     * spec.parentSessionId 指向一个在线会话（面板的父会话选择器）。
     */
    async startRun(/** @type {any} */ spec) {
      const parent = resolveParent(ctx, spec.parentSessionId)
      if (!parent) {
        return { id: null, error: 'parent session not found or not running — open a session in dsh, or pass spec.parentSessionId of a live session' }
      }
      return registry.start({
        script: spec.script,
        parent,
        args: spec.args || {},
        provider: spec.provider || undefined,
        label: spec.label || 'workflow',
      })
    },

    async stopRun(/** @type {string} */ runId, /** @type {string} */ reason) {
      return registry.stop(runId, reason)
    },

    async amendRun(/** @type {string} */ runId, /** @type {string} */ script, /** @type {any} */ spec) {
      const onDisk = registry.get(runId)
      if (!onDisk) return { id: null, error: 'run not found' }
      const parent = resolveRunParent(ctx, spec && spec.parentSessionId, onDisk.parentSessionId)
      if (!parent) return { id: null, error: parentUnavailableError(onDisk.parentSessionId) }
      return registry.amend(runId, script, { parent })
    },

    async resumeRun(/** @type {string} */ runId, /** @type {any} */ spec) {
      const onDisk = registry.get(runId)
      if (!onDisk) return { id: null, error: 'run not found' }
      const parent = resolveRunParent(ctx, spec && spec.parentSessionId, onDisk.parentSessionId)
      if (!parent) return { id: null, error: parentUnavailableError(onDisk.parentSessionId) }
      return registry.resume(runId, { parent })
    },

    /** 回答一个 ask() 挂起的问题 */
    async answerRun(/** @type {string} */ runId, /** @type {string} */ text) {
      return registry.answer(runId, text)
    },

    // ── saved 库 ────────────────────────────────────────────────────────────
    //
    // `spec.workspacePath` is browser-supplied, so every project-scope method
    // gates it first: it must resolve to an existing directory inside a
    // workspace this dsh instance knows. The shipped panel never sends one (its
    // ops are global-scope), so this only ever refuses a FORGED path — the
    // attack it closes is a same-origin script asking workflowAdmin to drop an
    // arbitrary JSON file anywhere on disk (or unlink one).

    listSaved(/** @type {any} */ spec) {
      const gate = workspaceGate(spec && spec.workspacePath)
      if (gate.error !== undefined) return { error: gate.error }
      return library.listSaved(gate.path)
    },

    getSaved(/** @type {any} */ spec) {
      const gate = workspaceGate(spec && spec.workspacePath)
      if (gate.error !== undefined) return { error: gate.error }
      return library.getSaved(spec.name, gate.path)
    },

    async saveSaved(/** @type {any} */ spec) {
      const gate = workspaceGate(spec && spec.workspacePath)
      if (gate.error !== undefined) return { ok: false, error: gate.error }
      try {
        const record = await library.saveSaved({ ...spec, workspacePath: gate.path })
        return { ok: true, record }
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) }
      }
    },

    async deleteSaved(/** @type {any} */ spec) {
      const gate = workspaceGate(spec && spec.workspacePath)
      if (gate.error !== undefined) return { ok: false, error: gate.error }
      try {
        return { ok: await library.deleteSaved(spec.name, spec.scope, gate.path) }
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) }
      }
    },

    /** 面板「跑一个已保存的工作流」：读库 → 启动 */
    async runSaved(/** @type {any} */ spec) {
      const gate = workspaceGate(spec && spec.workspacePath)
      if (gate.error !== undefined) return { id: null, error: gate.error }
      const record = library.getSaved(spec.name, gate.path)
      if (!record) return { id: null, error: `workflow "${spec.name}" not found` }
      const parent = resolveParent(ctx, spec.parentSessionId)
      if (!parent) {
        return { id: null, error: 'parent session not found or not running — open a session in dsh, or pass spec.parentSessionId of a live session' }
      }
      // 与 run_saved 工具 / /workflow run 斜杠命令同一道 argsSchema 合约：
      // 面板的 🚀 按钮恒发空 args（src/client/panels/workflow.js），一份声明了
      // required 的保存库从这里启动时，唯一的现象会是脚本内部一个含义不明的
      // 失败——在边界上挡下并点名工作流。
      const providedArgs = spec.args || {}
      const schemaProblem = describeArgsProblem(record.argsSchema, providedArgs)
      if (schemaProblem !== null) {
        return { id: null, error: `args do not satisfy this workflow's argsSchema: ${schemaProblem}` }
      }
      return registry.start({
        script: record.script,
        parent,
        args: providedArgs,
        provider: spec.provider || undefined,
        label: record.name,
      })
    },
  }
}

/**
 * amend/resume 的 parent 解析：显式 override（spec.parentSessionId）优先，
 * 退回 run 记录里的原会话——重启或换面板后血缘不变，cwd/项目作用域一致。
 */
/** @param {Record<string, any>} ctx
 * @param {string|undefined} preferredSessionId
 * @param {string|undefined} fallbackSessionId */
function resolveRunParent(ctx, preferredSessionId, fallbackSessionId) {
  return resolveParent(ctx, preferredSessionId) || resolveParent(ctx, fallbackSessionId)
}

/** @param {string|undefined} sessionId */
function parentUnavailableError(sessionId) {
  return `original parent session is not live (${sessionId || 'unknown'}) — open that session in dsh, or pass spec.parentSessionId pointing at a live session`
}

/**
 * 从会话 id 解析出当前 Agent 作为 parent。
 * 浏览器侧只传 sessionId（字符串），Agent 对象必须宿主侧取。
 */
/** @param {Record<string, any>} ctx
 * @param {string|undefined} sessionId */
function resolveParent(ctx, sessionId) {
  const agents = ctx.get('agents')
  if (!agents || !sessionId) return null
  const agent = agents.get(sessionId)
  if (!agent) return null
  return agent
}

/**
 * Check `args` against a saved workflow's declared argsSchema, returning a
 * one-line problem description or null when it passes.
 *
 * Deliberately a SMALL subset of JSON Schema — the keywords a workflow author
 * actually declares for a script's `args`: type / required / properties /
 * enum / items. Anything unrecognised is ignored rather than rejected, so a
 * richer schema saved by a future build degrades to "no opinion" instead of
 * blocking every run. The point is to catch the obvious contract violation
 * (a missing required key, a string where a number belongs) at the boundary,
 * where the message can name the workflow, rather than deep inside a script.
 *
 * Exported because ALL THREE run entry points enforce it: the `run_saved`
 * tool (lib/workflow-tools.js), the `/workflow run` slash command
 * (lib/workflow-command.js) and the panel's runSaved RPC (below) — one saved
 * record must carry the same contract through every door.
 * @param {any} schema - the stored argsSchema (may be null/absent).
 * @param {any} value - the caller-supplied args object.
 * @returns {string|null} the problem, or null when acceptable.
 */
export function describeArgsProblem(schema, value) {
  if (schema === null || schema === undefined || typeof schema !== 'object' || Array.isArray(schema)) return null
  const typeOf = (/** @type {any} */ v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
  const matches = (/** @type {string} */ expected, /** @type {any} */ v) => {
    if (expected === 'integer') return Number.isInteger(v)
    if (expected === 'number') return typeof v === 'number' && Number.isFinite(v)
    if (expected === 'array') return Array.isArray(v)
    if (expected === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v)
    return typeOf(v) === expected
  }
  // An `object` root schema constrains the args object itself.
  if (typeof schema.type === 'string' && !matches(schema.type, value)) {
    return `args must be a ${schema.type} (got ${typeOf(value)})`
  }
  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (typeof key !== 'string') continue
    if (value === null || typeof value !== 'object' || value[key] === undefined) return `missing required key "${key}"`
  }
  const properties = schema.properties !== null && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties : {}
  for (const [key, sub] of Object.entries(properties)) {
    if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) continue
    if (value === null || typeof value !== 'object' || value[key] === undefined) continue
    const actual = value[key]
    if (typeof sub.type === 'string' && !matches(sub.type, actual)) {
      return `"${key}" must be a ${sub.type} (got ${typeOf(actual)})`
    }
    if (Array.isArray(sub.enum) && !sub.enum.includes(actual)) {
      return `"${key}" must be one of ${JSON.stringify(sub.enum)} (got ${JSON.stringify(actual)})`
    }
    if (sub.type === 'array' && sub.items !== null && typeof sub.items === 'object' && !Array.isArray(sub.items)
      && typeof sub.items.type === 'string' && Array.isArray(actual)) {
      const bad = actual.findIndex((item) => !matches(sub.items.type, item))
      if (bad !== -1) return `"${key}[${bad}]" must be a ${sub.items.type} (got ${typeOf(actual[bad])})`
    }
  }
  return null
}
