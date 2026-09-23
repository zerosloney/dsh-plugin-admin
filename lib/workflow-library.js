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
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { savedDir, readJsonIfExists, atomicWriteJson } from './workflow-engine.js'

const PROJECT_DIRNAME = '.dsh'
const WORKFLOWS_SUBDIR = 'workflows'
// 库条目名即文件名：三个入口（save/get/delete）共用同一守卫，
// 否则 get/delete 的裸 join 会成为路径穿越（save 之前是唯一有校验的）。
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/

function assertValidName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(`invalid workflow name: ${name}`)
  }
}

export function createWorkflowLibrary(deps) {
  const { dshHome, enqueue } = deps

  function globalDir() { return savedDir(dshHome) }

  function projectDir(workspacePath) {
    if (!workspacePath) return null
    const dir = join(workspacePath, PROJECT_DIRNAME, WORKFLOWS_SUBDIR)
    return dir
  }

  function ensureDir(dir) {
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  // ─── 读取 ────────────────────────────────────────────────────────────────

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
    const pdir = projectDir(workspacePath)
    if (pdir && existsSync(pdir)) {
      for (const file of readdirSync(pdir)) {
        if (!file.endsWith('.json')) continue
        const rec = readJsonIfExists(join(pdir, file))
        if (rec) items.push(withScope(rec, 'project'))
      }
    }
    // 项目级优先于全局同名（项目覆盖全局）
    const byName = new Map()
    for (const item of items) byName.set(item.name, item)
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  function getSaved(name, workspacePath) {
    assertValidName(name)
    // 项目级先找
    const pdir = projectDir(workspacePath)
    if (pdir) {
      const rec = readJsonIfExists(join(pdir, `${name}.json`))
      if (rec) return withScope(rec, 'project')
    }
    const rec = readJsonIfExists(join(globalDir(), `${name}.json`))
    return rec ? withScope(rec, 'global') : null
  }

  // ─── 写入 ────────────────────────────────────────────────────────────────

  async function saveSaved(spec) {
    const { name, scope, script, argsSchema, description, workspacePath } = spec
    if (!name) throw new Error('saved workflow requires a name')
    assertValidName(name)
    if (!script) throw new Error('saved workflow requires a script')

    const dir = scope === 'project'
      ? ensureDir(projectDir(workspacePath))
      : ensureDir(globalDir())
    if (!dir) throw new Error('project scope requires a workspacePath')

    const record = {
      name,
      script,
      argsSchema: argsSchema || null,
      description: description || '',
      scope,
      updatedAt: Date.now(),
    }
    // 原子写走串行队列，与插件其余写盘一致。
    return enqueue(() => { atomicWriteJson(join(dir, `${name}.json`), record); return record })
  }

  function deleteSaved(name, scope, workspacePath) {
    assertValidName(name)
    const dir = scope === 'project' ? projectDir(workspacePath) : globalDir()
    if (!dir) throw new Error('project scope requires a workspacePath')
    const path = join(dir, `${name}.json`)
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  }

  return { listSaved, getSaved, saveSaved, deleteSaved }
}

function withScope(rec, scope) {
  return { ...rec, scope: rec.scope || scope }
}

// ─── workflowAdmin RPC 服务 ──────────────────────────────────────────────────

/**
 * 挂到 ctx.provide('workflowAdmin', ...)，供浏览器面板经 typert RPC 调用。
 * 方法签名与 client.js 的面板调用一一对应。
 */
export function createWorkflowAdmin(deps) {
  const { registry, library, ctx } = deps

  return {
    /** 列出所有运行（活的 + 磁盘上的） */
    listRuns() {
      const active = registry.list()
      return { active, statuses: registry.STATUS }
    },

    getRun(runId) {
      return registry.get(runId)
    },

    /**
     * 启动一个工作流。面板侧的「新建运行」。
     * parent 必须由宿主侧解析（浏览器拿不到 Agent 对象）：
     * spec.parentSessionId 指向一个在线会话（面板的父会话选择器）。
     */
    async startRun(spec) {
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

    async stopRun(runId, reason) {
      return registry.stop(runId, reason)
    },

    async amendRun(runId, script, spec) {
      const onDisk = registry.get(runId)
      if (!onDisk) return { id: null, error: 'run not found' }
      const parent = resolveRunParent(ctx, spec && spec.parentSessionId, onDisk.parentSessionId)
      if (!parent) return { id: null, error: parentUnavailableError(onDisk.parentSessionId) }
      return registry.amend(runId, script, { parent })
    },

    async resumeRun(runId, spec) {
      const onDisk = registry.get(runId)
      if (!onDisk) return { id: null, error: 'run not found' }
      const parent = resolveRunParent(ctx, spec && spec.parentSessionId, onDisk.parentSessionId)
      if (!parent) return { id: null, error: parentUnavailableError(onDisk.parentSessionId) }
      return registry.resume(runId, { parent })
    },

    /** 回答一个 ask() 挂起的问题 */
    async answerRun(runId, text) {
      return registry.answer(runId, text)
    },

    // ── saved 库 ────────────────────────────────────────────────────────────

    listSaved(spec) {
      return library.listSaved(spec && spec.workspacePath)
    },

    getSaved(spec) {
      return library.getSaved(spec.name, spec && spec.workspacePath)
    },

    async saveSaved(spec) {
      try {
        const record = await library.saveSaved(spec)
        return { ok: true, record }
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) }
      }
    },

    deleteSaved(spec) {
      try {
        return { ok: library.deleteSaved(spec.name, spec.scope, spec.workspacePath) }
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) }
      }
    },

    /** 面板「跑一个已保存的工作流」：读库 → 启动 */
    async runSaved(spec) {
      const record = library.getSaved(spec.name, spec.workspacePath)
      if (!record) return { id: null, error: `workflow "${spec.name}" not found` }
      const parent = resolveParent(ctx, spec.parentSessionId)
      if (!parent) {
        return { id: null, error: 'parent session not found or not running — open a session in dsh, or pass spec.parentSessionId of a live session' }
      }
      return registry.start({
        script: record.script,
        parent,
        args: spec.args || {},
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
function resolveRunParent(ctx, preferredSessionId, fallbackSessionId) {
  return resolveParent(ctx, preferredSessionId) || resolveParent(ctx, fallbackSessionId)
}

function parentUnavailableError(sessionId) {
  return `original parent session is not live (${sessionId || 'unknown'}) — open that session in dsh, or pass spec.parentSessionId pointing at a live session`
}

/**
 * 从会话 id 解析出当前 Agent 作为 parent。
 * 浏览器侧只传 sessionId（字符串），Agent 对象必须宿主侧取。
 */
function resolveParent(ctx, sessionId) {
  const agents = ctx.get('agents')
  if (!agents || !sessionId) return null
  const agent = agents.get(sessionId)
  if (!agent) return null
  return agent
}
