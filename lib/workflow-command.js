/**
 * workflow-command.js — /workflow 斜杠命令（插件挂载即自动注册，无需配置）
 *
 * ZCode 的 /workflow 形态：人直接跑保存的工作流，不必绕道模型。语法
 * （rawInput 是 /workflow 之后的原文）：
 *
 *   /workflow                          列出工作库（项目 .dsh 优先，其次全局）+ 活跃运行
 *   /workflow run <名称> [argsJSON]    启动一个已保存的工作流（parent = 当前会话）
 *   /workflow runs                     列出运行（最新在前）
 *   /workflow stop <runId>             停止一个运行
 *
 * 命令名与内置 / 其他插件冲突时只降级告警，绝不挂掉插件挂载（与
 * command-hook-admin 的逐条容错同策略）。
 *
 * 零 dsh 导入，全部骑运行时 Cordis Context。
 */

const USAGE = [
  '用法：',
  '  /workflow                          列出工作库与活跃运行',
  '  /workflow run <名称> [argsJSON]    启动一个已保存的工作流',
  '  /workflow runs                     列出运行（最新在前）',
  '  /workflow stop <runId>             停止一个运行',
].join('\n')

const STATUS_TEXT = {
  pending: '排队',
  running: '运行中',
  completed: '已完成',
  errored: '出错',
  stopped: '已停止',
  orphaned: '孤儿（宿主重启前启动）',
}

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
      description: '运行 / 管理保存的工作流：run <名称> [argsJSON] 在当前会话启动；list / runs / stop 管理',
      input: { hint: '[list | run <名称> [argsJSON] | runs | stop <runId>]' },
      handler: (invocation) => handle(invocation, registry, library),
    })
  } catch (err) {
    ctx.logger?.warn?.(`dsh-plugin-admin: /workflow command unavailable: ${err && err.message || err}`)
    return () => {}
  }
  return () => { try { dispose() } catch { /* hot-unload race: already gone */ } }
}

async function handle(invocation, registry, library) {
  const agent = invocation && invocation.agent
  const raw = String((invocation && invocation.rawInput) || '').trim()
  const parts = raw === '' ? [] : raw.split(/\s+/)
  const head = parts[0] || 'list'
  const cwd = sessionCwdOf(agent)

  if (head === 'list' || head === 'ls') return formatList(registry, library, cwd)

  if (head === 'runs') {
    const runs = registry.list()
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 20)
    if (runs.length === 0) return { kind: 'success', text: '没有运行记录。' }
    return {
      kind: 'success',
      text: runs.map((r) => `- ${r.id}「${r.label || r.id}」[${STATUS_TEXT[r.status] || r.status}]${r.error ? ' — ' + r.error : ''}`).join('\n'),
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

  if (head === 'run') {
    const name = parts[1]
    if (!name) return { kind: 'error', text: USAGE }
    let args = {}
    if (parts[2] !== undefined) {
      try { args = JSON.parse(parts.slice(2).join(' ')) } catch {
        return { kind: 'error', text: 'args 不是合法 JSON。' }
      }
    }
    const record = library.getSaved(name, cwd)
    if (!record) {
      const names = library.listSaved(cwd).map((r) => `${r.name} [${r.scope === 'project' ? '项目' : '全局'}]`).join('、')
      return { kind: 'error', text: `工作库中没有「${name}」。可用：${names || '（空）'}` }
    }
    if (!isAgent(agent)) {
      return { kind: 'error', text: '/workflow run 需要在会话中使用（子代理要挂在一个活的会话下）。' }
    }
    const started = await registry.start({ script: record.script, parent: agent, args, label: record.name })
    if (started.diagnostics && started.diagnostics.length) {
      return { kind: 'error', text: `脚本编译失败：\n${started.diagnostics.map((d) => d.message).join('\n')}` }
    }
    const scopeText = record.scope === 'project' ? '项目' : '全局'
    return { kind: 'success', text: `🚀 已启动 ${started.id}「${record.name}」（${scopeText}）——后台运行中，/workflow runs 查看进度。` }
  }

  return { kind: 'error', text: `未知子命令「${head}」。\n${USAGE}` }
}

function formatList(registry, library, cwd) {
  const saved = library.listSaved(cwd)
  const savedLines = saved.length
    ? saved.map((r) => `- ${r.name} [${r.scope === 'project' ? '项目' : '全局'}]${r.description ? ' — ' + r.description : ''}`).join('\n')
    : '（空）'
  const runs = registry.list()
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 10)
  const runLines = runs.length
    ? '\n\n运行：\n' + runs.map((r) => `- ${r.id}「${r.label || r.id}」[${STATUS_TEXT[r.status] || r.status}]`).join('\n')
    : ''
  return { kind: 'success', text: `工作库：\n${savedLines}${runLines}` }
}

function isAgent(agent) {
  return agent !== null && agent !== undefined && typeof agent === 'object' && typeof agent.id === 'string'
}

/** 会话 cwd（项目作用域库的识别点）；cwd 在 session.header 上。 */
function sessionCwdOf(agent) {
  try {
    const cwd = agent?.session?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch { return undefined }
}
