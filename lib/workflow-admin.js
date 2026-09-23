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

const WORKFLOW_SERVICE_KEY = 'workflowAdmin'
const WORKFLOW_NAMESPACE = 'workflowAdmin'

export function applyWorkflowAdmin(ctx, options) {
  const { enqueue } = options
  // 运行/工作库落 $DSH_HOME（env 或 ~/.dsh，与 cron/webhook/usage-ledger
  // 同一解析）；options.dshHome 供测试注入临时目录。
  const home = options.dshHome || dshHome()

  // subagents 是硬依赖：没有它工作流跑不起来。这里仍不抛——让插件其余部分
  // 正常加载，面板侧会看到降级提示。
  const subagents = ctx.get('subagents')
  const jobs = ctx.get('jobs')
  if (!subagents) {
    ctx.logger?.warn?.('dsh-plugin-admin: workflow engine disabled — ctx.subagents unavailable')
    return () => []
  }

  const registry = createRunRegistry({ ctx, enqueue, dshHome: home, maxConcurrency: 8 })
  const library = createWorkflowLibrary({ dshHome: home, enqueue })
  const admin = createWorkflowAdmin({ registry, library, ctx })

  // typert 网关 dispatch 强制校验 receiver.typertRemote（缺失或不一致 →
  // gateway/binding-invalid，面板全部 RPC 失败）。形状对齐 cron-admin 等
  // 模块：{ service: 服务对象本身, serviceKey, namespace } 冻结对象。
  const binding = Object.freeze({ service: admin, serviceKey: WORKFLOW_SERVICE_KEY, namespace: WORKFLOW_NAMESPACE })
  Object.defineProperty(admin, 'typertRemote', { value: binding, enumerable: false })

  ctx.effect(() => {
    ctx.provide(WORKFLOW_SERVICE_KEY, admin)
  }, 'plugin-admin/workflowAdmin: provide')

  // agent 侧入口：同一个 registry / library，暴露成 `workflow_admin` 工具。
  // ctx.tools 缺失（老宿主 / 无 agent 上下文的部署）时只告警，不阻塞面板。
  applyWorkflowTools(ctx, { registry, library })

  // 人侧入口：/workflow 斜杠命令（挂载即注册——安装插件即自动注入）。
  // ctx.commands 缺失或命令名被占时只告警降级，不阻塞其余部分。
  applyWorkflowCommand(ctx, { registry, library })

  return () => [
    // 参数 wire 名与 client.js 的 call() 载荷键一一对应：网关按 wire 从载荷
    // 逐名取值，多余/缺失字段直接 gateway/arguments-invalid。富对象载荷
    // （startRun / saved 库写删）沿用 pluginAdmin.install 的 `spec` 包裹惯例；
    // 标量对（stop/amend/answer）沿用 cronAdmin.toggle 的平铺惯例。
    // 运行
    desc('listRuns', []),
    desc('getRun', RUN_PARAM),
    desc('startRun', SPEC_PARAM),
    desc('stopRun', RUN_STOP_PARAMS),
    desc('amendRun', RUN_AMEND_PARAMS),
    desc('resumeRun', RUN_RESUME_PARAMS),
    desc('answerRun', RUN_ANSWER_PARAMS),
    // saved 库
    desc('listSaved', SPEC_PARAM),
    desc('getSaved', SPEC_PARAM),
    desc('saveSaved', SPEC_PARAM),
    desc('deleteSaved', SPEC_PARAM),
    desc('runSaved', SPEC_PARAM),
  ]

  function desc(method, parameters) {
    return {
      id: `dsh-plugin-admin/workflow/${method}`,
      service: WORKFLOW_SERVICE_KEY,
      namespace: WORKFLOW_NAMESPACE,
      method,
      invocation: { kind: 'direct' },
      parameters,
      result: { mode: 'src-json' },
    }
  }
}

const SPEC_PARAM = [{ name: 'spec', wire: 'spec', source: 'json', codec: { mode: 'src-json' } }]
const RUN_PARAM = [{ name: 'runId', wire: 'runId', source: 'json', codec: { mode: 'src-json' } }]
const RUN_STOP_PARAMS = [
  { name: 'runId', wire: 'runId', source: 'json', codec: { mode: 'src-json' } },
  { name: 'reason', wire: 'reason', source: 'json', codec: { mode: 'src-json' } },
]
const RUN_AMEND_PARAMS = [
  { name: 'runId', wire: 'runId', source: 'json', codec: { mode: 'src-json' } },
  { name: 'script', wire: 'script', source: 'json', codec: { mode: 'src-json' } },
  { name: 'spec', wire: 'spec', source: 'json', codec: { mode: 'src-json' } },
]
// resume 默认从 run 记录里的原会话解析 parent；spec.parentSessionId 是
// 可省略的手动 override（原会话已下线时换一个在线会话续跑）。
const RUN_RESUME_PARAMS = [
  { name: 'runId', wire: 'runId', source: 'json', codec: { mode: 'src-json' } },
  { name: 'spec', wire: 'spec', source: 'json', codec: { mode: 'src-json' } },
]
const RUN_ANSWER_PARAMS = [
  { name: 'runId', wire: 'runId', source: 'json', codec: { mode: 'src-json' } },
  { name: 'text', wire: 'text', source: 'json', codec: { mode: 'src-json' } },
]

