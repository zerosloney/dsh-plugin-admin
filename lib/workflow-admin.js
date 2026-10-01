/**
 * workflow-admin.js — 工作流模块的宿主侧挂载
 *
 * 把 workflow-runs（运行注册表）+ workflow-library（saved 库 + RPC 服务）
 * 挂到 Cordis Context 上，并产出 typert 描述符，沿用插件其余模块的接线惯例。
 *
 * 依赖全部是可选的：subagents / jobs / agents 任一缺失时降级提示，
 * 绝不阻止插件其余面板加载（与 webhook/cron 等模块同策略）。
 *
 * 零 dsh 导入，全部骑运行时 Cordis Context。
 */

import { createRunRegistry } from './workflow-runs.js'
import { createWorkflowLibrary, createWorkflowAdmin } from './workflow-library.js'
import { applyWorkflowTools } from './workflow-tools.js'
import { applyWorkflowCommand } from './workflow-command.js'
import { dshHome } from './patch-utils.js'
import { invocationsFor } from './rpc-manifest.js'
import { auditService } from './audit-log.js'

const WORKFLOW_SERVICE_KEY = 'workflowAdmin'
const WORKFLOW_NAMESPACE = 'workflowAdmin'

/**
 * How the trail reads a workflow verb's result.
 *
 * These verbs report failure through verb-specific fields and never through an
 * `ok` flag (only the saved-library pair uses one): a launch with no live parent
 * is `{ id: null, error }`, a script that failed to compile is
 * `{ id: null, status, diagnostics: [...] }`, an answer that arrived too late is
 * `{ answered: false }`, a stop that had nothing to stop is `{ stopped: false }`.
 * The generic "anything but `ok: false` is success" rule would have logged a
 * failed launch as a successful one, which is worse than not auditing at all.
 * @param {any} result - the wrapped method's return value.
 * @returns {boolean}
 */
export function workflowAuditOk(result) {
  if (result === null || result === undefined) return true
  if (typeof result !== 'object') return true
  if (result.ok === false) return false
  if (typeof result.error === 'string' && result.error !== '') return false
  if (Array.isArray(result.diagnostics) && result.diagnostics.length > 0) return false
  if (Object.prototype.hasOwnProperty.call(result, 'id') && result.id === null) return false
  if (result.answered === false) return false
  if (result.stopped === false) return false
  return true
}

/** @param {DshContext} ctx - plugin context.
 * @param {Object} options - host plumbing: `{ enqueue, dshHome?, audit? }`.
 * @param {function} options.enqueue - shared serial write queue.
 * @param {string} [options.dshHome] - override for `$DSH_HOME` (tests inject a temp dir).
 * @param {any} [options.audit] - audit service sink. */
export function applyWorkflowAdmin(ctx, options) {
  const { enqueue } = options
  // 运行/工作库落 $DSH_HOME（env 或 ~/.dsh，与 cron/webhook/usage-ledger
  // 同一解析）；options.dshHome 供测试注入临时目录。
  const home = options.dshHome || dshHome()

  // subagents 是硬依赖：没有它工作流跑不起来。这里仍不抛——让插件其余部分
  // 正常加载，面板侧会看到降级提示。
  const subagents = ctx.get('subagents')
  if (!subagents) {
    ctx.logger?.warn?.('dsh-plugin-admin: workflow engine disabled — ctx.subagents unavailable')
    return () => []
  }

  const registry = createRunRegistry({ ctx, enqueue, dshHome: home, maxConcurrency: 8 })
  const library = createWorkflowLibrary({ dshHome: home, enqueue })
  const admin = createWorkflowAdmin({ registry, library, ctx })

  // Phase F3: the execution verbs and the saved-library writes ride the trail
  // (the workflow facade can run shell steps, so "who started this" belongs in
  // the audit log). Agent-side entries — the `workflow_admin` tool and the
  // `/workflow` command — talk to registry/library directly and are recorded in
  // the run journal instead; the trail covers the panel/RPC surface.
  auditService(admin, WORKFLOW_NAMESPACE, options.audit, { okOf: workflowAuditOk })

  // typert 网关 dispatch 强制校验 receiver.typertRemote（缺失或不一致 →
  // gateway/binding-invalid，面板全部 RPC 失败）。形状对齐 cron-admin 等
  // 模块：{ service: 服务对象本身, serviceKey, namespace } 冻结对象。
  const binding = Object.freeze({ service: admin, serviceKey: WORKFLOW_SERVICE_KEY, namespace: WORKFLOW_NAMESPACE })
  Object.defineProperty(admin, 'typertRemote', { value: binding, enumerable: false })

  ctx.effect(() => {
    ctx.provide(WORKFLOW_SERVICE_KEY, admin)
  }, 'plugin-admin/workflowAdmin: provide')

  // Unload / HMR teardown: active runs must not outlive the module that owns
  // them. Without this a disabled row keeps running subagent calls with no
  // reachable stop() — the replacement instance's registry does not know these
  // handles, so the run spins as a zombie until the process restarts. Abort
  // first (a cooperative script settles through the normal journal path), then
  // terminate the worker so a cancellation-ignoring script cannot keep burning
  // calls past the teardown.
  ctx.effect(() => () => { registry.disposeAll() }, 'plugin-admin/workflowAdmin: teardown (abort + terminate active runs)')

  // agent 侧入口：同一个 registry / library，暴露成 `workflow_admin` 工具。
  // ctx.tools 缺失（老宿主 / 无 agent 上下文的部署）时只告警，不阻塞面板。
  // 人侧入口：/workflow 斜杠命令（挂载即注册——安装插件即自动注入）。
  // ctx.commands 缺失或命令名被占时只告警降级，不阻塞其余部分。
  //
  // 两个 disposer 都必须保留并接进本模块的卸载级联：register 返回的是**调用
  // 方持有的**精确 disposer（command-hook-admin 同惯例），丢弃它意味着卸载
  // 后工具/命令仍在（闭包指向已 disposeAll 的旧 registry），且重挂载时
  // tools.register 同名抛错——整个插件挂载失败。
  const disposeTools = applyWorkflowTools(ctx, { registry, library })
  const disposeCommand = applyWorkflowCommand(ctx, { registry, library })
  ctx.effect(() => () => {
    disposeTools()
    disposeCommand()
  }, 'plugin-admin/workflowAdmin: teardown (agent tool + slash command)')

  return () => invocationsFor(WORKFLOW_NAMESPACE)
}

