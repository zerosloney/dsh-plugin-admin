/**
 * verify-workflow-command.mjs — /workflow 斜杠命令自检
 *
 * 跑法：node scripts/verify-workflow-command.mjs
 *
 * 用最小 mock ctx（commands + registry + library），不依赖真实 dsh 宿主。
 */

import assert from 'node:assert/strict'
import { applyWorkflowCommand } from '../lib/workflow-command.js'

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

// ─── 测试夹具 ──────────────────────────────────────────────────────────────────

function makeCtx({ commands: commandsSvc, logger } = {}) {
  return {
    ctx: {
      get: (key) => (key === 'commands' ? commandsSvc : undefined),
      logger: logger || { warn() {} },
    },
  }
}

function makeCommands() {
  const registered = []
  return {
    registered,
    register(def) {
      registered.push(def)
      return () => { const i = registered.indexOf(def); if (i !== -1) registered.splice(i, 1) }
    },
  }
}

function fakeRegistry({ startResult } = {}) {
  const calls = []
  return {
    calls,
    list: () => [
      { id: 'wf_old', label: 'old', status: 'completed', updatedAt: 1 },
      { id: 'wf_new', label: 'new', status: 'running', updatedAt: 2 },
    ],
    start: async (spec) => {
      calls.push({ op: 'start', spec })
      return startResult || { id: 'wf_x', status: 'running', diagnostics: [] }
    },
    stop: async (runId, reason) => {
      calls.push({ op: 'stop', runId, reason })
      return runId === 'wf_run' ? { stopped: true, reason } : { stopped: false, reason: 'not running' }
    },
  }
}

function fakeLibrary() {
  const calls = []
  return {
    calls,
    listSaved: (cwd) => [
      { name: 'deploy', scope: cwd ? 'project' : 'global', description: 'ship it' },
      { name: 'nightly', scope: 'global', description: '' },
    ],
    getSaved: (name, cwd) => {
      calls.push({ op: 'getSaved', name, cwd })
      if (name === 'deploy') return { name: 'deploy', scope: cwd ? 'project' : 'global', script: 'return await agent("go")' }
      if (name === 'nightly') return { name: 'nightly', scope: 'global', script: 'return 1' }
      return null
    },
  }
}

const AGENT = { id: 'sess-1', session: { header: { cwd: '/proj' } } }
const inv = (rawInput, agent = AGENT) => ({ commandId: 'c1', agent, rawInput, attachments: [], signal: undefined })

console.log('applyWorkflowCommand:')

await check('registers /workflow on mount and unregisters on dispose', async () => {
  const commands = makeCommands()
  const { ctx } = makeCtx({ commands })
  const dispose = applyWorkflowCommand(ctx, { registry: fakeRegistry(), library: fakeLibrary() })
  assert.equal(commands.registered.length, 1)
  assert.equal(commands.registered[0].name, 'workflow')
  assert.equal(typeof commands.registered[0].handler, 'function')
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(commands.registered.length, 0, 'unregistered on dispose')
})

await check('degrades without ctx.commands', async () => {
  const logs = []
  const { ctx } = makeCtx({ logger: { warn: (m) => logs.push(m) } })
  const dispose = applyWorkflowCommand(ctx, { registry: fakeRegistry(), library: fakeLibrary() })
  assert.equal(typeof dispose, 'function')
  assert.ok(logs.some((m) => /\/workflow command not registered/.test(m)), 'warns')
  dispose()
})

await check('degrades with a warning when the command name is taken', async () => {
  const logs = []
  const commands = { register() { throw new Error('command "workflow" is already registered') } }
  const { ctx } = makeCtx({ commands, logger: { warn: (m) => logs.push(m) } })
  const dispose = applyWorkflowCommand(ctx, { registry: fakeRegistry(), library: fakeLibrary() })
  assert.equal(typeof dispose, 'function', 'still returns a no-op disposer')
  assert.ok(logs.some((m) => /\/workflow command unavailable/.test(m)), 'warns with the cause')
})

await check('list shows saved scopes (project preferred) and active runs', async () => {
  const commands = makeCommands()
  const { ctx } = makeCtx({ commands })
  applyWorkflowCommand(ctx, { registry: fakeRegistry(), library: fakeLibrary() })
  const out = await commands.registered[0].handler(inv(''))
  assert.equal(out.kind, 'success')
  assert.match(out.text, /deploy \[项目\]/, 'session cwd resolves the project scope')
  assert.match(out.text, /nightly \[全局\]/)
  assert.match(out.text, /wf_new「new」\[运行中\]/, 'active runs listed')
})

await check('run prefers the project library and parents to the session', async () => {
  const commands = makeCommands()
  const registry = fakeRegistry()
  const { ctx } = makeCtx({ commands })
  applyWorkflowCommand(ctx, { registry, library: fakeLibrary() })
  const out = await commands.registered[0].handler(inv('run deploy {"x":1}'))
  assert.equal(out.kind, 'success')
  assert.match(out.text, /wf_x/)
  const call = registry.calls.find((c) => c.op === 'start')
  assert.equal(call.spec.parent, AGENT, 'parent is the invoking session agent')
  assert.equal(call.spec.label, 'deploy')
  assert.deepEqual(call.spec.args, { x: 1 })
})

await check('run falls back to global and rejects unknown names with availability', async () => {
  const commands = makeCommands()
  const { ctx } = makeCtx({ commands })
  applyWorkflowCommand(ctx, { registry: fakeRegistry(), library: fakeLibrary() })
  const ok = await commands.registered[0].handler(inv('run nightly'))
  assert.equal(ok.kind, 'success')
  assert.match(ok.text, /（全局）/)

  const miss = await commands.registered[0].handler(inv('run nope'))
  assert.equal(miss.kind, 'error')
  assert.match(miss.error ?? miss.text, /工作库中没有「nope」/)
  assert.match(miss.text, /deploy \[项目\]/, 'available names listed')
})

await check('run rejects invalid args JSON and agent-less contexts', async () => {
  const commands = makeCommands()
  const { ctx } = makeCtx({ commands })
  applyWorkflowCommand(ctx, { registry: fakeRegistry(), library: fakeLibrary() })
  const bad = await commands.registered[0].handler(inv('run deploy {x}'))
  assert.equal(bad.kind, 'error')
  assert.match(bad.text, /JSON/)
  // 显式无 agent（不能走 inv 的默认参数）：识别不到会话时 run 必须报错而不是启动。
  const noAgent = await commands.registered[0].handler({ commandId: 'c1', agent: undefined, rawInput: 'run deploy', attachments: [], signal: undefined })
  assert.equal(noAgent.kind, 'error')
  assert.match(noAgent.text, /需要在会话中使用/)
})

await check('runs lists newest first; stop validates and reports', async () => {
  const commands = makeCommands()
  const registry = fakeRegistry()
  const { ctx } = makeCtx({ commands })
  applyWorkflowCommand(ctx, { registry, library: fakeLibrary() })
  const runs = await commands.registered[0].handler(inv('runs'))
  assert.match(runs.text, /wf_new「new」/)

  const noId = await commands.registered[0].handler(inv('stop'))
  assert.equal(noId.kind, 'error')
  assert.match(noId.text, /stop <runId>/)

  const ok = await commands.registered[0].handler(inv('stop wf_run'))
  assert.equal(ok.kind, 'success')
  assert.equal(registry.calls.find((c) => c.op === 'stop').reason, 'slash command')

  const dead = await commands.registered[0].handler(inv('stop wf_gone'))
  assert.equal(dead.kind, 'error')
  assert.match(dead.text, /不在运行中/)
})

await check('unknown subcommand returns usage', async () => {
  const commands = makeCommands()
  const { ctx } = makeCtx({ commands })
  applyWorkflowCommand(ctx, { registry: fakeRegistry(), library: fakeLibrary() })
  const out = await commands.registered[0].handler(inv('bogus'))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /未知子命令「bogus」/)
  assert.match(out.text, /\/workflow run/)
})

// ─── 结果 ─────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall workflow-command checks passed')
