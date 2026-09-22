/**
 * Self-check for the administration surfaces (扩展插件 / MCP服务器 / 历史会话):
 * - Loads the bundle the way the dsh module loader would (factory + platform require table)
 * - Drives apply() against a mock slots/connection context
 * - Asserts the three slot registrations (plugins-tab contribution + two settings sections)
 * - Asserts stylesheet injection
 * - Renders each registered section with real React 18 from harness
 * - Tests Plugin Management render & inline remove confirmation
 * - Tests Session Management & inline delete confirmation
 * - Tests MCP server editor save flow
 *
 * Run: node scripts/self-check.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

// Resolve the browser platform (React 18, jsdom) either from the harness
// checkout ($DSH_HARNESS_ROOT, so local runs exercise the exact platform the
// dsh shell renders with) or from this repo's own devDependencies (CI /
// npm test), which installs the same versions and is the automatic fallback.
const harnessRoot = process.env.DSH_HARNESS_ROOT
const harnessWeb = harnessRoot === undefined ? '' : join(harnessRoot, 'packages/client/web/node_modules')
let harnessReq = null
if (harnessRoot !== undefined) {
  try {
    harnessReq = createRequire(join(harnessRoot, 'package.json'))
    harnessReq('jsdom')
  } catch {
    harnessReq = null
  }
}
const { JSDOM } = harnessReq ? harnessReq('jsdom') : req('jsdom')
const React = harnessReq ? req(`${harnessWeb}/react`) : req('react')
const { createRoot } = harnessReq ? req(`${harnessWeb}/react-dom/client`) : req('react-dom/client')
const act = React.act ?? (harnessReq ? req(`${harnessWeb}/react-dom/test-utils`).act : req('react-dom/test-utils').act)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

// 1. Bundle arrival: the file registers its factory through the loader facade.
const registrations = []
globalThis.window.__ModuleLoader__ = { load: (registration) => registrations.push(registration) }
new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)
assert.equal(registrations.length, 1, 'one bundle registration')
assert.equal(registrations[0].id, 'dsh-plugin-admin')

// 2. Materialization: the factory consumes the platform require table.
const exports = registrations[0].factory((spec) => {
  if (spec === 'react') return React
  if (spec === 'react-dom/client') return { createRoot }
  throw new Error(`require("${spec}") missed the platform table`)
})
assert.deepEqual(exports.inject, ['slots', 'connection'], 'injects slots + connection')

// 3. apply(): waits on the slot declarations and registers the three surfaces.
const mockPlugins = [
  { name: 'dsh-base', version: '1.2.3', dependency: false, removable: false, localPath: null },
  { name: 'dsh-custom-tool', version: '0.2.0', dependency: true, removable: true, localPath: 'E:\\Demo\\cli-tools\\dsh-custom-tool' },
  { name: 'dsh-remote-tool', version: '0.5.1', dependency: true, removable: true, localPath: null },
]
const mockWorkspaces = [
  { workspaceId: 'w-alpha', title: 'alpha-project', path: 'E:\\Demo\\alpha-project' },
  { workspaceId: 'w-beta', title: 'beta-project', path: 'E:\\Demo\\beta-project' },
]
const mockSessions = [
  {
    id: 's1',
    cwd: 'E:\\Demo\\alpha-project',
    createdAt: 1_740_000_000_000,
    archived: true,
    live: false,
    title: '分析与重构插件系统架构',
    summary: '请帮我将 dsh-session-admin 和 dsh-plugin-admin 合并为一个统一部署的插件管理中心。',
    messageCount: 5,
    tokens: { input: 12300, output: 3400, cacheRead: 8900, cacheWrite: 0 },
    workspaceId: 'w-alpha',
    workspaceTitle: 'alpha-project',
  },
  {
    id: 's2',
    cwd: 'E:\\Demo\\beta-project',
    createdAt: 1_750_000_000_000,
    archived: false,
    live: true,
    title: 'beta-project',
    summary: '探索Cordis依赖注入与Typert RPC网关通信协议',
    messageCount: 2,
    workspaceId: 'w-beta',
    workspaceTitle: 'beta-project',
  },
  {
    id: 's3',
    cwd: 'E:\\Demo\\loose-project',
    createdAt: 1_760_000_000_000,
    archived: false,
    live: false,
    title: '独立会话',
    summary: '',
    summaryError: 'event log unreadable',
    messageCount: 1,
    workspaceId: null,
    workspaceTitle: null,
  },
]
const mockMcpEntries = [{
  id: 'mcp-existing',
  serverName: 'existing',
  config: {
    transport: 'stdio',
    serverName: 'existing',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: 'token' },
    cwd: 'E:/Demo',
    toolCallTimeoutMs: 45_000,
    failOnStartupError: true,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  },
}]

const mockCommands = [
  { name: 'review', description: '按团队规范审查改动', inputHint: '[<file-path>]', prompt: '审查 $ARGUMENTS', images: false, enabled: true, active: true, conflict: null, fileError: undefined },
  { name: 'draft', description: '草稿命令', inputHint: null, prompt: '草稿', images: false, enabled: false, active: false, conflict: null, fileError: undefined },
]
const mockHookPayload = {
  hooksPath: 'C:/Users/demo/.dsh/hooks.json',
  bridgePackage: '@deepseek-ai/dsh-hooks-claude-code',
  bridgeMounted: false,
  bridgeInstalled: false,
  bridgeRowPresent: false,
  codexHooksPath: 'C:/Users/demo/.dsh/hooks.codex.json',
  codexBridgePackage: '@deepseek-ai/dsh-hooks-codex',
  codexBridgeMounted: false,
  codexBridgeInstalled: false,
  codexBridgeRowPresent: false,
  hooks: [
    { id: 'PreToolUse/0/0', event: 'PreToolUse', matcher: 'write|edit', command: 'node guard.js', timeoutSec: 30, enabled: true },
    { id: 'disabled/0', event: 'Stop', matcher: '', command: 'stop.sh', timeoutSec: null, enabled: false },
  ],
}

const injectedSections = []
const registeredSections = []
// The mock host state behind commandHookAdmin/listHooks: the bridge verbs
// mutate it so the panel's post-action re-read sees the new lifecycle flags
// (the Codex install path re-reads on purpose — see runCodexBridge).
const setHookState = (patch) => {
  ctx.hookList = { ...(ctx.hookList ?? mockHookPayload), ...patch }
  return ctx.hookList
}
const ctx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  inject: undefined, // webhook admin tolerates a missing inject face
  effect: (fn) => {
    // The real runtime registers the disposer; the mock runs it immediately
    // and records the returned disposer (sidebar menu cleanup).
    ctx.effects = ctx.effects ?? []
    ctx.effects.push(fn())
  },
  connection: {
    rpc: {
      call: async (route, method, payload) => {
        assert.equal(route, '/api')
        if (method === 'pluginAdmin/list') {
          return { ok: true, value: { profileDir: 'E:/dsh-profiles/web', plugins: mockPlugins } }
        }
        if (method === 'pluginAdmin/checkUpdates') {
          ctx.checkUpdateCalls = ctx.checkUpdateCalls ?? []
          ctx.checkUpdateCalls.push(payload.args)
          return { ok: true, value: { updates: [
            { name: 'dsh-remote-tool', version: '0.5.1', latest: '0.9.0', updateAvailable: true },
            { name: 'dsh-custom-tool', version: '0.2.0', latest: '0.2.0', updateAvailable: false },
            { name: 'dsh-base', version: '1.2.3', latest: '1.2.3', updateAvailable: false },
          ] } }
        }
        if (method === 'pluginAdmin/install') {
          ctx.installCalls = ctx.installCalls ?? []
          ctx.installCalls.push(payload.args.spec)
          // Tests may inject a failure result; default is success.
          if (ctx.installResult !== undefined) return ctx.installResult
          return { ok: true, value: { output: 'Done', profileDir: 'E:/dsh-profiles/web', plugins: mockPlugins } }
        }
        if (method === 'pluginAdmin/remove') {
          ctx.removeCalls = ctx.removeCalls ?? []
          ctx.removeCalls.push(payload.args.name)
          if (ctx.removeResult !== undefined) return ctx.removeResult
          return { ok: true, value: { output: 'Done', profileDir: 'E:/dsh-profiles/web', plugins: mockPlugins } }
        }
        if (method === 'sessionAdmin/list') {
          if (ctx.sessionListFail) return { ok: false, error: { message: ctx.sessionListFail } }
          return { ok: true, value: { sessions: ctx.sessionListOverride ?? mockSessions, workspaces: mockWorkspaces } }
        }
        if (method === 'sessionAdmin/deleteSession') {
          ctx.deletes = ctx.deletes ?? []
          ctx.deletes.push(payload.args.sessionId)
          return { ok: true, value: { deleted: payload.args.sessionId } }
        }
        // The workspace panel (merged into dsh's 已归档会话 page) reloads
        // through workspaceAdmin/list on mount.
        if (method === 'workspaceAdmin/list') {
          return { ok: true, value: {
            available: true,
            workspaces: mockWorkspaces.map((w) => ({ workspaceId: w.workspaceId, title: w.title, path: w.path, sessionIds: [], createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-02T03:04:05.000Z' })),
            archivedSessionIds: ['s1'],
          } }
        }
        // The 技能 roster read: the panel asks sessionAdmin/list first, then
        // hands every session id to the host in one request.
        if (method === 'skillsAdmin/list') {
          ctx.skillsRequests = ctx.skillsRequests ?? []
          ctx.skillsRequests.push(Array.isArray(payload.args.sessionIds) ? payload.args.sessionIds.slice() : [])
          return { ok: true, value: {
            available: true,
            registry: true,
            complete: ctx.skillsIncomplete !== true,
            skills: [
              { name: 'alpha-only', description: '只在这个工作区可见', whenToUse: '改 alpha 的时候', source: 'project-agents', sources: ['project-agents'], provider: 'filesystem', path: '/proj/.agents/skills/alpha-only/SKILL.md', url: null, resource: 'directory', modelInvocable: true, userInvocable: true, scopes: ['alpha @ build'] },
              { name: 'global-skill', description: '插件内置技能', whenToUse: null, source: 'bundled', sources: ['bundled'], provider: 'runtime', path: null, url: null, resource: 'opaque', modelInvocable: true, userInvocable: false, scopes: ['全局'] },
              { name: 'human-only', description: '仅人类可调用', whenToUse: null, source: 'user-agents', sources: ['user-agents'], provider: 'filesystem', path: '/home/.agents/skills/human-only/SKILL.md', url: null, resource: 'directory', modelInvocable: false, userInvocable: true, scopes: ['alpha @ build'] },
            ],
            scopes: [
              { label: '全局', kind: 'global', cwd: null, preset: null, sessionIds: [], count: 1, error: null },
              { label: 'alpha @ build', kind: 'session', cwd: 'E:/Demo/alpha', preset: 'build', sessionIds: ['s2'], count: 2, error: null },
            ],
            sessions: [
              { sessionId: 's2', ok: true, cwd: 'E:/Demo/alpha', preset: 'build', message: '' },
              { sessionId: 's1', ok: false, cwd: null, preset: null, message: '会话没有项目 cwd' },
            ],
            warnings: [],
          } }
        }
        // The Web 搜索 provider config editor: one read, then one save.
        if (method === 'webSearchAdmin/config') {
          ctx.webSearchConfigReads = ctx.webSearchConfigReads ?? []
          ctx.webSearchConfigReads.push(payload.args.providerId)
          return { ok: true, value: {
            providerId: 'deepseek-official',
            label: 'DeepSeek 官方搜索',
            namespace: 'web-search-deepseek',
            source: 'settings',
            revision: 7,
            applies: 'live',
            restartRequired: false,
            fields: [
              { key: 'apiKey', label: 'API Key（字面值）', kind: 'secret', choices: [], min: null, default: null, hint: '', value: '', set: true },
              { key: 'apiKeyEnv', label: 'API Key 凭据名', kind: 'string', choices: [], min: null, default: 'DEEPSEEK_API_KEY', hint: '', value: 'DEEPSEEK_API_KEY', set: false },
              { key: 'baseURL', label: 'Endpoint', kind: 'string', choices: [], min: null, default: 'https://api.deepseek.com/anthropic/v1', hint: '', value: 'https://search.proxy/v1', set: true },
              { key: 'model', label: '模型', kind: 'string', choices: [], min: null, default: 'deepseek-v4-flash', hint: '', value: 'deepseek-v4-flash', set: false },
            ],
            note: '读取和保存走 dsh settings 命名空间。',
          } }
        }
        if (method === 'webSearchAdmin/saveConfig') {
          ctx.webSearchSaves = ctx.webSearchSaves ?? []
          ctx.webSearchSaves.push({
            providerId: payload.args.providerId,
            values: payload.args.values,
            unset: payload.args.unset,
            expectedRevision: payload.args.expectedRevision,
          })
          return { ok: true, value: { ok: true, source: 'settings', changed: ['baseURL'], restartRequired: false } }
        }
        if (method === 'sessionAdmin/healthReport') {
          return { ok: true, value: { report: {
            turns: 2, completedTurns: 1, abortedTurns: 1, errorTurns: 0, maxTokenTurns: 0,
            tools: [{ name: 'read', calls: 3, errors: 1, errorCodes: [{ code: 'FsError:FS_NOT_FOUND', count: 1 }] }],
            topErrors: [{ name: 'FsError', code: 'FS_NOT_FOUND', count: 1 }],
            retryCount: 1, compactions: 0,
          }, summary: '2 个 turn · 1 完成 · 1 中断' } }
        }
        if (method === 'sessionAdmin/searchSessions') {
          return { ok: true, value: { hits: [
            { sessionId: 's1', title: '分析与重构插件系统架构', cwd: 'E:/Demo/alpha', snippet: '… 请帮我将 dsh-session-admin 合并 …', createdAt: 1 },
          ] } }
        }
        if (method === 'webhookAdmin/list') {
          return { ok: true, value: {
            rules: [{ id: 'ci-fail', enabled: true, event: 'push', action: { mode: 'steer', sessionId: 'session-1', steer: true }, promptTemplate: 'CI 失败' }],
            history: [],
            presets: [{ id: 'cordis', name: 'cordis' }],
            permissionPresetNames: ['workspace-write', 'danger-full-access'],
            storagePath: 'C:/Users/demo/.dsh/webhook-triggers.json',
            endpointPrefix: '/webhook-triggers',
            endpointOnline: true,
            runtimeMounted: false,
            runtimePackageInstalled: true,
          } }
        }
        if (method === 'sessionAdmin/usageReport') {
          const now = Date.now()
          return { ok: true, value: { generatedAt: now, retained: 2, storagePath: 'C:/Users/demo/.dsh/usage-ledger.json', snapshotIntervalMs: 3_600_000, lastSnapshotAt: now - 60_000, rows: [
            { createdAt: now - 2 * 86400000, project: 'alpha-project', input: 20000, output: 1000, cacheRead: 100, userMsgs: 4, assistantMsgs: 6 },
            { createdAt: now - 8 * 3600000, project: 'alpha-project', input: 1500, output: 1100, cacheRead: 4000, userMsgs: 2, assistantMsgs: 3 },
            { createdAt: now - 3 * 3600000, project: 'beta-project', input: 800, output: 2200, cacheRead: 0, userMsgs: 1, assistantMsgs: 2 },
          ] } }
        }
        if (method === 'commandHookAdmin/saveCommand') {
          const savedEntry = payload.args.entry
          return { ok: true, value: { commandsDir: 'C:/Users/demo/.dsh/commands', command: savedEntry } }
        }
        if (method === 'mcpAdmin/callTool') {
                    ctx.callToolCalls = ctx.callToolCalls ?? []
          ctx.callToolCalls.push(payload.args)
          return {
            ok: true,
            value: {
              ok: true, transport: 'stdio', ms: 12,
              toolCall: { isError: false, text: 'hello from fetcher-mcp', truncated: false, content: [{ type: 'text', text: 'hello from fetcher-mcp' }] },
            },
          }
        }
        if (method === 'sessionAdmin/exportSession') {
          ctx.exportCalls = ctx.exportCalls ?? []
          ctx.exportCalls.push(payload.args.sessionId)
          return {
            ok: true,
            value: {
              markdown: '# 测试会话\n\n- Session: `' + payload.args.sessionId + '`\n\n---\n\n## 👤 用户\n\n你好\n',
              filename: 'dsh-session-测试会话-export.md',
              messages: 1,
              toolCalls: 0,
            },
          }
        }
        if (method === 'mcpAdmin/list') {
          return { ok: true, value: { entries: ctx.mcpEntries ?? mockMcpEntries } }
        }
        if (method === 'mcpAdmin/remove') {
          ctx.mcpRemoves = ctx.mcpRemoves ?? []
          ctx.mcpRemoves.push(payload.args.id)
          ctx.mcpEntries = (ctx.mcpEntries ?? mockMcpEntries).filter((entry) => entry.id !== payload.args.id)
          return { ok: true, value: { ok: true, id: payload.args.id, entries: ctx.mcpEntries } }
        }
        if (method === 'webSearchAdmin/list') {
          return { ok: true, value: {
            active: { searchProvider: 'deepseek-official', fetchProvider: 'http' },
            providers: [
              { id: 'deepseek-official', packageName: '@deepseek-ai/dsh-web-search-deepseek', label: 'DeepSeek 官方搜索', homepage: '', envVar: 'DEEPSEEK_API_KEY', bundled: true, installed: true, active: true },
              { id: 'exa', packageName: '@deepseek-ai/dsh-web-search-exa', label: 'Exa', homepage: '', envVar: 'EXA_API_KEY', bundled: false, installed: false, active: false },
              { id: 'perplexity', packageName: '@deepseek-ai/dsh-web-search-perplexity', label: 'Perplexity', homepage: '', envVar: 'PERPLEXITY_API_KEY', bundled: false, installed: false, active: false },
            ],
          } }
        }
        if (method === 'webSearchAdmin/install') {
          ctx.webSearchInstalls = ctx.webSearchInstalls ?? []
          ctx.webSearchInstalls.push(payload.args.providerId)
          return { ok: true, value: { installed: true, state: 'installed', output: '' } }
        }
        if (method === 'commandHookAdmin/listCommands') {
          return { ok: true, value: { commandsDir: 'C:/Users/demo/.dsh/commands', commands: ctx.commandList ?? mockCommands } }
        }
        if (method === 'commandHookAdmin/listHooks') {
          return { ok: true, value: ctx.hookList ?? mockHookPayload }
        }
        if (method === 'commandHookAdmin/bridgeInstall') {
          ctx.bridgeInstalls = ctx.bridgeInstalls ?? []
          ctx.bridgeInstalls.push(true)
          return { ok: true, value: setHookState({ bridgeInstalled: true, bridgeRowPresent: true }) }
        }
        if (method === 'commandHookAdmin/bridgeRemove') {
          ctx.bridgeRemoves = ctx.bridgeRemoves ?? []
          ctx.bridgeRemoves.push(true)
          return { ok: true, value: setHookState({ bridgeInstalled: false, bridgeRowPresent: false }) }
        }
        if (method === 'commandHookAdmin/codexBridgeInstall') {
          ctx.codexBridgeInstalls = ctx.codexBridgeInstalls ?? []
          ctx.codexBridgeInstalls.push(true)
          setHookState({ codexBridgeInstalled: true, codexBridgeRowPresent: true })
          // Sparse on purpose (the host verb does not spread listHooks()): the
          // panel must re-read through listHooks instead of treating this as state.
          return { ok: true, value: { ok: true, action: 'install', row: '- insert: hooks-codex', codexHooksPath: 'C:/Users/demo/.dsh/hooks.codex.json' } }
        }
        if (method === 'commandHookAdmin/codexBridgeRemove') {
          ctx.codexBridgeRemoves = ctx.codexBridgeRemoves ?? []
          ctx.codexBridgeRemoves.push(true)
          setHookState({ codexBridgeInstalled: false, codexBridgeRowPresent: false })
          return { ok: true, value: { ok: true, action: 'remove' } }
        }
        if (method === 'mcpAdmin/test') {
          ctx.mcpTests = ctx.mcpTests ?? []
          ctx.mcpTests.push(payload.args.id)
          return { ok: true, value: {
            ok: true, transport: 'stdio', ms: 12,
            serverInfo: { name: 'mock-mcp', version: '1.0.0' },
            toolCount: 3,
            tools: ['fetch', 'search', 'browse'],
          } }
        }
        if (method === 'mcpAdmin/upsert') {
          ctx.mcpUpserts = ctx.mcpUpserts ?? []
          ctx.mcpUpserts.push(payload.args.entry)
          // Maintain an accumulated entries list so the UI always has the
          // full set of servers to interact with.
          ctx.mcpEntries = ctx.mcpEntries ?? []
          const existing = ctx.mcpEntries.findIndex(e => e.id === payload.args.entry.id)
          const saved = { id: payload.args.entry.id, serverName: payload.args.entry.config.serverName, config: payload.args.entry.config }
          if (existing !== -1) ctx.mcpEntries[existing] = saved
          else ctx.mcpEntries.push(saved)
          return { ok: true, value: { entries: ctx.mcpEntries } }
        }
        throw new Error('unexpected method ' + method)
      },
    },
  },
  slots: {
    inject: (key, callback) => {
      injectedSections.push({ key, callback })
    },
    register: (options, component) => {
      registeredSections.push({ options, component })
      return () => {}
    },
  },
}

exports.apply(ctx)
// Ten slot contributions: the 扩展插件 tab inside the shell-owned 插件
// section, the standalone 技能 / Web 搜索 / MCP服务器 / 子智能体 /
// 命令与钩子 / 用量仪表盘 / 定时任务 / Webhook 触发 settings sections, and
// the 待办清单 dock above the composer. Neither the Codex bridge (a banner
// inside the 命令与钩子 钩子 tab) nor the Agent preset editor (the shell's own
// ui-agent-preset section owns that roster) gets a section of its own — and
// 工作区 / 历史会话 are DOM-merged into dsh's own 已归档会话 page instead of
// registering nav rows of their own.
assert.equal(injectedSections.length, 10, 'ten slot contributions injected')
assert.deepEqual(
  injectedSections.map((i) => i.key).sort(),
  ['conversation.input.dock', 'settings.plugins.tab', 'settings.section', 'settings.section', 'settings.section', 'settings.section', 'settings.section', 'settings.section', 'settings.section', 'settings.section'],
  'injections wait on settings.section (×8), settings.plugins.tab, and conversation.input.dock',
)
injectedSections.forEach((i) => i.callback())
assert.equal(registeredSections.length, 10, 'ten registrations: extensions tab + skills + web search + MCP + subagents + command hooks + usage dashboard + cron tasks + webhook triggers + todo dock')
const byId = {}
for (const entry of registeredSections) byId[entry.options.id] = entry
assert.ok(byId.extensions && byId['mcp-servers'] && byId['subagent-admin'] && byId['command-hook-admin'] && byId['todo-admin'] && byId['skills-admin'] && byId['web-search-admin'] && byId['cron-tasks'], 'expected registration ids present')
assert.equal(byId['session-history'], undefined, '历史会话 no longer registers a settings section of its own')
assert.equal(byId.workspaces, undefined, '工作区 no longer registers a settings section of its own')

const extensions = byId.extensions
assert.equal(extensions.options.name, 'settings.plugins.tab')
assert.equal(extensions.options.order, 20, '扩展插件 tab sorts after 插件列表 (order 10)')
assert.equal(extensions.options.label, '扩展插件', 'extensions tab label')
const extensionsFace = extensions.options.inject()
assert.equal(typeof extensionsFace.call, 'function', 'extensions tab inject face carries the RPC call')

const mcpSection = byId['mcp-servers']
assert.equal(mcpSection.options.name, 'settings.section')
assert.equal(mcpSection.options.order, 25, 'MCP服务器 sits right after Agent 预设 (order 20)')
assert.equal(mcpSection.options.label, 'MCP服务器', 'MCP section label')

const subagentSection = byId['subagent-admin']
assert.equal(subagentSection.options.name, 'settings.section')
assert.equal(subagentSection.options.order, 26, '子智能体 sits right after MCP服务器 (order 25)')
assert.equal(subagentSection.options.label, '子智能体', 'subagent section label')

const commandHookSection = byId['command-hook-admin']
const webhookSection = byId['webhook-triggers']
assert.equal(commandHookSection.options.name, 'settings.section')
assert.equal(commandHookSection.options.order, 27, '命令与钩子 sits right after 子智能体 (order 26)')
assert.equal(commandHookSection.options.label, '命令与钩子', 'command hooks section label')
const commandHookFace = commandHookSection.options.inject()
assert.equal(typeof commandHookFace.call, 'function', 'command hooks inject face carries the RPC call')

// 工作区 / 历史会话 no longer register sections: the panels are merged into
// dsh's own 已归档会话 page by DOM. The bundle exports both components so the
// harness can mount them directly and keep exercising the panel contracts
// (the merge itself is covered by the archived-sessions test below).
const rpcCall = (method, args) => ctx.connection.rpc.call('/api', method, { args: args })
const sessionsSection = {
  options: { id: 'session-history', inject: () => ({ call: rpcCall, refreshSessions: null }) },
  component: exports.SessionsSection,
}
const workspacesSection = {
  options: { id: 'workspaces', inject: () => ({ call: rpcCall }) },
  component: exports.WorkspacesSection,
}
assert.equal(typeof exports.SessionsSection, 'function', 'bundle exports the session-history panel for direct mounting')
assert.equal(typeof exports.WorkspacesSection, 'function', 'bundle exports the workspace panel for direct mounting')
const historyFace = sessionsSection.options.inject()
assert.equal(typeof historyFace.call, 'function', 'session history inject face carries the RPC call')
assert.ok('refreshSessions' in historyFace, 'session history inject face carries the sidebar refresh hook')

const todoDock = byId['todo-admin']
assert.equal(todoDock.options.name, 'conversation.input.dock', 'todo dock mounts above the composer')
assert.equal(todoDock.options.order, 5, 'todo dock sorts just after the shell todo strip (order 0)')
assert.equal(typeof todoDock.options.inject().call, 'function', 'todo dock inject face carries the RPC call')

const usageSection = byId['usage-dashboard']
assert.equal(usageSection.options.name, 'settings.section', 'usage dashboard is a standalone settings page')
assert.equal(usageSection.options.order, 28, 'usage dashboard sorts after 命令与钩子 (order 27)')
assert.equal(usageSection.options.label, '用量仪表盘', 'usage dashboard label')
assert.equal(typeof usageSection.options.inject().call, 'function', 'usage dashboard inject face carries the RPC call')

const cronSection = byId['cron-tasks']
assert.equal(cronSection.options.name, 'settings.section', 'cron tasks is a standalone settings page')
assert.equal(cronSection.options.order, 29, '定时任务 sorts between 用量仪表盘 (28) and Webhook 触发 (30)')
assert.equal(cronSection.options.label, '定时任务', 'cron tasks section label')
assert.equal(typeof cronSection.options.inject().call, 'function', 'cron tasks inject face carries the RPC call')

// 4. Style injection: the section stylesheets land in <head>.
assert.ok(
  document.querySelector('style[data-plugin-css="dsh-plugin-admin/unified-section.css"]'),
  'unified section css injected',
)
assert.ok(
  document.querySelector('style[data-dsh-sa-styles]'),
  'subagent section css injected',
)
assert.ok(
  document.querySelector('style[data-plugin-css="dsh-plugin-admin/command-hooks.css"]'),
  'command hooks section css injected',
)
assert.ok(
  document.querySelector('style[data-plugin-css="dsh-plugin-admin/todo-dock.css"]'),
  'todo dock css injected',
)
// The command-hook section must keep the unified visual recipes (segmented
// tabs, blue primary buttons, notice tints) — a regression here would drift
// it back to the standalone plugin's private look (underline tabs, dark primary).
// Since the scope unification those recipes live ONCE, re-rooted onto every
// scope that had a drifting copy; the command-hook sheet keeps only what is
// unique to it. Assert BOTH halves: the shared rule reaches the CH root, and
// no component is defined in two sheets at once (the drift invariant).
const sheets = [...document.querySelectorAll('style[data-plugin-css], style[data-dsh-sa-styles]')]
const cssAll = sheets.map((s) => s.textContent).join('\n')
const chCss = document.querySelector('style[data-plugin-css="dsh-plugin-admin/command-hooks.css"]').textContent
assert.ok(cssAll.includes('[data-cha-section] .tab.active'), 'CH tabs use the unified segmented tab recipe (re-rooted)')
assert.ok(
  cssAll.includes('[data-cha-section] .btn.primary') && cssAll.includes('--dsw-static-blue-600'),
  'CH buttons use the unified blue primary',
)
assert.ok(chCss.includes('.notice.warn') && chCss.includes('.tag.event'), 'CH banners/badges keep their own unique recipes')
// Anti-drift invariant: one definition per shared component, in ONE sheet. A
// second copy is a definition waiting to diverge again. The pattern anchors the
// selector (`[scope] .btn` immediately followed by `{` or `,`) so a nested
// selector like `.cli-scan-card .btn {` is not mistaken for a definition.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
for (const shared of ['.btn', '.tag', '.input', '.list', '.empty', '.toolbar', '.card', '.card-sub', '.tabs', '.tab', '.form', '.field', '.btn.primary', '.btn.sm']) {
  const re = new RegExp(`\\[data-[a-z-]+\\] ${escapeRe(shared)}\\s*(?=\\{|,)`, 'g')
  const owners = sheets.filter((s) => (s.textContent.match(re) ?? []).length > 0)
  assert.equal(owners.length, 1, `${shared} is defined in exactly one stylesheet (found ${owners.length})`)
}

// Mount helper: render one registered section into a fresh host div. Text
// assertions run against document.body, so exactly one panel stays mounted
// at a time; each panel is unmounted before the next one mounts.
//
// The predecessor check is load-bearing, not ceremony: while the teardowns were
// `root.remove?.()` (a no-op — a React root has no `remove()`), panels silently
// piled up in document.body, and one panel's text could satisfy another panel's
// assertion. That is how a duplicated usage-dashboard block sat at the end of the
// file, passing only because the usage panel had never really gone away.
let host = null
async function mountSection(section) {
  if (host !== null && host.isConnected) {
    throw new Error(`self-check: "${section.options.id}" would mount while a previous panel is still mounted — unmount it (root.unmount() + host.remove()) before mounting the next one`)
  }
  const hostEl = document.body.appendChild(document.createElement('div'))
  host = hostEl
  let root
  await act(async () => {
    root = createRoot(hostEl)
    root.render(React.createElement(section.component, section.options.inject()))
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  root.host = hostEl
  return root
}

// 5. Render the 扩展插件 tab (plugin management, now a 插件-section tab).
const pluginsRoot = await mountSection(extensions)

const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))

// Verify Plugins panel content (no tab bar — the shell owns the tab chrome).
let text = document.body.textContent
assert.ok(text.includes('E:/dsh-profiles/web'), 'profile directory displayed')
assert.ok(text.includes('dsh-base'), 'in-box plugin layer row')
assert.ok(text.includes('dsh-custom-tool'), 'custom plugin layer row')
assert.ok(text.includes('dsh-remote-tool'), 'registry-installed plugin layer row')
assert.ok(text.includes('v1.2.3'), 'plugin layer version')
assert.ok(text.includes('内置'), 'in-box tag')
assert.ok(text.includes('包安装'), 'registry install tag')
assert.ok(text.includes('本地安装'), 'local install tag')
assert.ok(text.includes('E:\\Demo\\cli-tools\\dsh-custom-tool'), 'local install source path')
assert.ok(text.includes('全部 (3)'), 'filter pill with count')
// Two-column grid + category sort: 内置 → 包安装 → 本地安装. The mock host
// returns base(内置), custom-tool(本地), remote-tool(包安装) — rendering must
// move remote-tool before custom-tool while keeping the builtin first.
const pluginListEl = host.querySelector('.list.grid2')
assert.ok(pluginListEl !== null, 'plugin list renders as a two-column grid')
const pluginNameOrder = [...pluginListEl.querySelectorAll('.card-title-text')].map((el) => el.textContent)
assert.deepEqual(
  pluginNameOrder,
  ['dsh-base', 'dsh-remote-tool', 'dsh-custom-tool'],
  'plugin cards sort 内置 → 包安装 → 本地安装 (host order kept within a rank)',
)
assert.ok(
  [...pluginListEl.querySelectorAll('.card-title-text')].every((el) => el.getAttribute('title') === el.textContent),
  'plugin names carry a hover title with the full name (two-column wrap instead of ellipsis)',
)
const pluginCss = document.querySelector('style[data-plugin-css="dsh-plugin-admin/unified-section.css"]').textContent
assert.ok(
  pluginCss.includes('.list.grid2 .card { cursor: pointer'),
  'extension plugin cards show the pointer cursor, matching the official 插件列表 hover',
)

// 5b. Remote update check: the panel auto-checks on mount (no manual click),
// the registry-installed plugin (dsh-remote-tool) gets an update badge +
// upgrade button, while local-path and in-box plugins do not.
await new Promise((resolve) => setTimeout(resolve, 40))
assert.ok((ctx.checkUpdateCalls ?? []).length >= 1, 'checkUpdates RPC fired automatically on mount')
assert.ok(document.body.textContent.includes('⬆ 有新版本 v0.9.0'), 'update badge with latest version rendered')
assert.ok(document.body.textContent.includes('⬆ 更新'), 'upgrade button rendered')
const upgradeBtns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('⬆ 更新'))
assert.equal(upgradeBtns.length, 1, 'exactly one upgrade button (registry-installed only)')
// The upgrade button must live in the dsh-remote-tool card.
const remoteCard = [...host.querySelectorAll('.card')].find((c) => c.textContent?.includes('dsh-remote-tool'))
assert.ok(remoteCard !== undefined && remoteCard.textContent.includes('⬆ 更新'), 'upgrade button belongs to the remote plugin card')
// The manual toolbar button forces a fresh check (force flag reaches the host).
await act(async () => {
  button('检查更新').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
assert.ok((ctx.checkUpdateCalls ?? []).length >= 2, 'manual check-updates button fires again')
assert.equal(
  ctx.checkUpdateCalls[ctx.checkUpdateCalls.length - 1].force,
  true,
  'manual check-updates forces the host to bypass its cache',
)

// 4b-2. Bulk upgrade: the toolbar shows ⬆⬆ 全部更新 (1) for the one stale
// registry plugin; clicking it serially installs the pinned version, clears
// the reminder, and reports the batch summary.
await act(async () => {
  const bulkBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('⬆⬆ 全部更新 (1)'))
  assert.ok(bulkBtn !== undefined, 'bulk-upgrade button with count rendered')
  assert.equal(bulkBtn.disabled, false, 'bulk button enabled while updates exist')
  bulkBtn[Object.keys(bulkBtn).find((k) => k.startsWith('__reactProps$'))].onClick()
  await new Promise((resolve) => setTimeout(resolve, 60))
})
assert.ok((ctx.installCalls ?? []).includes('dsh-remote-tool@0.9.0'), 'batch upgrade installs the pinned latest spec')
assert.ok(document.body.textContent.includes('✅ 批量更新完成：1 个已更新'), 'batch summary note rendered')

// 5c. Fuzzy plugin search: type "custom" → only the local custom plugin card
// stays; type a nonsense needle → empty state with search hint appears.
const searchInput = [...host.querySelectorAll('.search-wrap input')][0]
assert.ok(searchInput !== undefined, 'plugin search input rendered')
const propsOfSearch = (el) => el[Object.keys(el).find((k) => k.startsWith('__reactProps$'))]
await act(async () => {
  propsOfSearch(searchInput).onChange({ target: { value: 'custom' } })
})
await new Promise((resolve) => setTimeout(resolve, 20))
const cardTextsAfterSearch = [...host.querySelectorAll('.card')].map((c) => c.textContent || '')
assert.equal(cardTextsAfterSearch.length, 1, 'search narrows the list to matching cards')
assert.ok(cardTextsAfterSearch[0].includes('dsh-custom-tool'), 'matching card is dsh-custom-tool')
// Version substring search: "0.2" matches dsh-custom-tool v0.2.0.
await act(async () => {
  propsOfSearch(searchInput).onChange({ target: { value: '0.2' } })
})
await new Promise((resolve) => setTimeout(resolve, 20))
const cardsByVersion = [...host.querySelectorAll('.card')].map((c) => c.textContent || '')
assert.equal(cardsByVersion.length, 1, 'version substring search narrows to one card')
assert.ok(cardsByVersion[0].includes('dsh-custom-tool'), 'version match finds dsh-custom-tool v0.2.0')
// Nonsense needle → empty hint.
await act(async () => {
  propsOfSearch(searchInput).onChange({ target: { value: 'zzz-nothing' } })
})
await new Promise((resolve) => setTimeout(resolve, 20))
assert.ok(document.body.textContent.includes('🔍 无匹配的插件'), 'no-match search shows the search empty hint')
// Clear the search so later tests see the full list again.
await act(async () => {
  propsOfSearch(searchInput).onChange({ target: { value: '' } })
})
await new Promise((resolve) => setTimeout(resolve, 20))

// 6. Test Plugin remove inline confirmation
await act(async () => {
  button('卸载').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(document.body.textContent.includes('确认卸载'), 'inline remove confirmation appears')
await act(async () => {
  button('取消').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(!document.body.textContent.includes('确认卸载'), 'cancel restores plugin actions')

// 6b. FAILED install/update/remove must keep the error visible (regression:
// the old failure branches patched the error and then called reloadPlugins()
// in the same microtask — React 18 batches both updates, so the error text
// never painted and a failed 更新/安装/卸载 looked like "nothing happened").
// Each case asserts the error is still on screen AFTER the silent list
// refresh triggered by the failure has settled, and that a floating error
// toast was raised for the failure (双通道：红条持久 + toast 醒目).
const errorToasts = (needle) => [...document.querySelectorAll('.dsh-admin-toast.error')]
  .some((t) => t.textContent.includes(needle))
ctx.installResult = { ok: false, error: { message: 'pnpm exited with code 1: ERR_PNPM_MISSING_PACKAGE_NAME' } }
ctx.removeResult = { ok: false, error: { message: "not a dependency-managed plugin" } }
// Update failure: the upgrade button on the dsh-remote-tool card.
await act(async () => {
  button('⬆ 更新').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
assert.ok((ctx.installCalls ?? []).length >= 1, 'update click reaches pluginAdmin/install')
assert.equal(ctx.installCalls[0], 'dsh-remote-tool@0.9.0', 'update sends the pinned name@<latest> spec (not @latest, which pnpm may silently skip under an existing range constraint)')
await new Promise((resolve) => setTimeout(resolve, 30))
assert.ok(
  document.body.textContent.includes('更新失败：pnpm exited with code 1'),
  'update failure error stays visible after the silent list refresh',
)
assert.ok(errorToasts('更新失败：pnpm exited with code 1'), 'update failure raises a floating error toast')
// Install failure: type a spec, hit 安装.
const installInput = [...host.querySelectorAll('.install-wrap input')][0]
assert.ok(installInput !== undefined, 'install input rendered')
await act(async () => {
  propsOfSearch(installInput).onChange({ target: { value: 'dsh-somepkg' } })
})
await new Promise((resolve) => setTimeout(resolve, 20))
await act(async () => {
  button('安装').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
await new Promise((resolve) => setTimeout(resolve, 30))
assert.ok(
  document.body.textContent.includes('安装失败：pnpm exited with code 1'),
  'install failure error stays visible after the silent list refresh',
)
assert.ok(errorToasts('安装失败：pnpm exited with code 1'), 'install failure raises a floating error toast')
// Remove failure (two-step confirm path).
ctx.installResult = undefined
await act(async () => {
  button('卸载').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(document.body.textContent.includes('确认卸载'), 'remove confirm bar appears after install failure')
await act(async () => {
  button('确认卸载').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
assert.ok((ctx.removeCalls ?? []).length >= 1, 'confirm fires pluginAdmin/remove')
await new Promise((resolve) => setTimeout(resolve, 30))
assert.ok(
  document.body.textContent.includes('卸载失败：'),
  'remove failure error stays visible after the silent list refresh',
)
assert.ok(errorToasts('卸载失败：'), 'remove failure raises a floating error toast')
// Single-toast semantics: each new failure REPLACED the in-flight toast in
// place, so after three rapid failures exactly one floating toast remains —
// carrying the LATEST message, not a stack of overlapping nodes.
const allErrorToasts = [...document.querySelectorAll('.dsh-admin-toast.error')]
assert.equal(allErrorToasts.length, 1, 'consecutive failures keep exactly one floating toast (replacement, not stacking)')
assert.ok(allErrorToasts[0].textContent.includes('卸载失败：'), 'the single surviving toast carries the latest failure')
ctx.removeResult = undefined

// 7. Unmount the plugins panel and mount the 历史会话 section instead.
await act(async () => { pluginsRoot.unmount() })
host.remove()
const sessionsRoot = await mountSection(sessionsSection)

text = document.body.textContent
assert.ok(text.includes('分析与重构插件系统架构'), 'session 1 title rendered')
assert.ok(text.includes('请帮我将 dsh-session-admin 和 dsh-plugin-admin 合并'), 'session 1 content summary rendered')
assert.ok(text.includes('5 条消息'), 'session 1 message count tag')
assert.ok(text.includes('探索Cordis依赖注入与Typert RPC网关通信协议'), 'session 2 content summary rendered')
assert.ok(text.includes('alpha-project'), 'session 1 group header / archived session cwd')
assert.ok(text.includes('beta-project'), 'session 2 group header / live session cwd')
assert.ok(text.includes('已归档'), 'archived badge')
assert.ok(text.includes('会话在线'), 'live badge reads 会话在线 (online, not 进行中)')
assert.ok(text.includes('取消归档'), 'unarchive button for archived session')
assert.ok(text.includes('未分组'), 'ungrouped bucket header for orphan sessions')
assert.ok(text.includes('独立会话'), 'ungrouped session card rendered')
assert.ok(text.includes('摘要读取失败：event log unreadable'), 'session summary read failure is visible')
assert.ok(text.includes('全部(3)'), 'session filter pill count')
assert.ok(text.includes('会话修改即时同步到侧边栏'), 'session hint footer')

// 7b. Session export: the ⬇ 导出 button pulls sessionAdmin/exportSession and
// downloads the markdown via an object URL (stubbed here — jsdom has none;
// the client's bare `URL` is Node's global in this harness, so stub there).
let createdObjectUrl = null
URL.createObjectURL = (blob) => { createdObjectUrl = blob; return 'blob:mock' }
URL.revokeObjectURL = () => {}
await act(async () => {
  button('⬇ 导出').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 30))
})
assert.ok((ctx.exportCalls ?? []).length === 1, 'export button triggers sessionAdmin/exportSession')
assert.ok(createdObjectUrl !== null, 'markdown handed to a download blob')
const exportedText = await createdObjectUrl.text()
assert.ok(exportedText.includes('# 测试会话') && exportedText.includes('## 👤 用户'), 'blob carries the markdown payload')
assert.ok(document.body.textContent.includes('✅ 已导出 1 条消息'), 'export success toast shown')

// 7c. Session pinning: 📌 置顶 toggles the local whitelist and the filter pill.
await act(async () => {
  const pinBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('📌 置顶'))
  assert.ok(pinBtn !== undefined, 'pin button present on session cards')
  pinBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 30))
})
assert.ok(document.body.textContent.includes('已置顶(1)'), 'pinned pill count updates')
assert.ok(JSON.parse(dom.window.localStorage.getItem('dsh-plugin-admin/pinned-sessions')).length === 1, 'pin persisted to localStorage')
await act(async () => {
  const unpinBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('📌 已置顶') && b.className.includes('btn'))
  assert.ok(unpinBtn !== undefined, 'unpin button present')
  unpinBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 30))
})
assert.ok(document.body.textContent.includes('已置顶(0)'), 'unpin restores the count')

// 7d. Token usage: the card tag and the totals strip fold the host tokens.
assert.ok(document.body.textContent.includes('↑12.3k ↓3.4k'), 'per-session usage tag rendered')
assert.ok(document.body.textContent.includes('缓存8.9k'), 'cache-read part of the usage tag')
assert.ok(document.body.textContent.includes('输入 12.3k'), 'totals strip input column')


// 8. Test Session delete inline confirmation
await act(async () => {
  button('删除').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(document.body.textContent.includes('确认删除'), 'inline delete confirmation appears')
await act(async () => {
  button('取消').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(!document.body.textContent.includes('确认删除'), 'cancel restores session actions')

// 8b. Online sessions now offer 关停并删除 (closeSession): the live mock
// session s2 must render the close button, and its confirm flow calls the
// closeSession RPC instead of deleteSession.
assert.ok(document.body.textContent.includes('关停并删除'), 'live session offers 关停并删除')
ctx.closeDeletes = ctx.closeDeletes ?? []
const originalCall = ctx.connection.rpc.call
ctx.connection.rpc.call = async (route, method, payload) => {
  if (method === 'sessionAdmin/closeSession') {
    ctx.closeDeletes.push(payload.args.sessionId)
    return { ok: true, value: { deleted: payload.args.sessionId } }
  }
  return originalCall(route, method, payload)
}
await act(async () => {
  const closeBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('关停并删除'))
  assert.ok(closeBtn !== undefined, 'close button present')
  closeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(document.body.textContent.includes('关停该在线会话'), 'close confirmation text warns about stopping the conversation')
await act(async () => {
  button('确认删除').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 60))
assert.deepEqual(ctx.closeDeletes, ['s2'], 'close confirm calls sessionAdmin/closeSession with the live session id')
ctx.connection.rpc.call = originalCall

// 8c. Directory groups are collapsible: clicking a group header hides its
// sessions (persisted to localStorage); clicking again restores them.
const groupHeaders = () => [...document.querySelectorAll('.group-header')]
const cardCount = () => document.querySelectorAll('.card').length
assert.equal(groupHeaders().length, 3, 'session list renders one header per directory group')
const cardsExpanded = cardCount()
await act(async () => {
  groupHeaders()[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(cardCount() < cardsExpanded, 'collapsing a group hides its session cards')
assert.ok(groupHeaders()[0].className.includes('collapsed'), 'the collapsed header is marked')
assert.ok(document.body.textContent.includes('已折叠'), 'the collapsed header shows a 已折叠 note')
assert.equal(JSON.parse(dom.window.localStorage.getItem('dsh-plugin-admin/collapsed-groups') ?? '[]').length, 1, 'the collapsed group key is persisted')
await act(async () => {
  groupHeaders()[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.equal(cardCount(), cardsExpanded, 'expanding restores the session cards')
assert.equal(JSON.parse(dom.window.localStorage.getItem('dsh-plugin-admin/collapsed-groups') ?? '[]').length, 0, 'expanding clears the persisted key')

// 8d. Collapse-all / expand-all from the filter bar tail.
const collapseAllButton = () => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('全部折叠') || b.textContent?.includes('全部展开'))
await act(async () => {
  collapseAllButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.equal(cardCount(), 0, 'collapse-all hides every session card')
assert.ok(document.body.textContent.includes('全部展开'), 'the toggle flips to 全部展开')
await act(async () => {
  collapseAllButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.equal(cardCount(), cardsExpanded, 'expand-all restores every session card')

// 8e. Bulk delete of the current projection: the filter bar's action raises a
// confirm bar; confirming fires one RPC per session, routing live sessions
// through closeSession and ended/archived ones through deleteSession.
ctx.deletes = []
ctx.closeDeletes = []
ctx.connection.rpc.call = async (route, method, payload) => {
  if (method === 'sessionAdmin/closeSession') {
    ctx.closeDeletes.push(payload.args.sessionId)
    return { ok: true, value: { deleted: payload.args.sessionId } }
  }
  return originalCall(route, method, payload)
}
const bulkAllButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('删除当前 ('))
assert.ok(bulkAllButton !== undefined, 'bulk delete-all action present')
await act(async () => {
  bulkAllButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(document.body.textContent.includes('确认删除 当前筛选的 3 个会话'), 'the bulk confirm bar names the scope and count')
const bulkConfirmButton = () => [...document.querySelectorAll('.bulk-bar button')].find((b) => b.textContent?.includes('确认删除'))
await act(async () => {
  bulkConfirmButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 200))
assert.deepEqual(ctx.deletes.slice().sort(), ['s1', 's3'], 'bulk delete routes ended/archived sessions through deleteSession')
assert.deepEqual(ctx.closeDeletes, ['s2'], 'bulk delete closes the live session first')
assert.equal(document.querySelectorAll('.bulk-bar').length, 0, 'the bulk bar clears once the run finishes')

// 8f. Per-directory bulk delete from the group header.
const groupBulkButton = [...document.querySelectorAll('.group-header button')].find((b) => b.textContent?.includes('整个目录'))
assert.ok(groupBulkButton !== undefined, 'per-directory bulk delete action present')
await act(async () => {
  groupBulkButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(document.body.textContent.includes('确认删除 目录「alpha-project」的 1 个会话'), 'the group confirm names the directory and count')
await act(async () => {
  [...document.querySelectorAll('.bulk-bar button')].find((b) => b.textContent?.includes('取消')).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.equal(document.querySelectorAll('.bulk-bar').length, 0, 'cancel dismisses the bulk bar')
ctx.connection.rpc.call = originalCall
// Leave the delete spies empty for the sidebar-menu tests below (they assert
// the exact RPC count of an armed/second click).
ctx.deletes = []
ctx.closeDeletes = []

// 9. Unmount the sessions panel and mount the MCP服务器 section instead.
await act(async () => { sessionsRoot.unmount() })
host.remove()
const mcpRoot = await mountSection(mcpSection)
assert.ok(document.body.textContent.includes('MCP 配置'), 'MCP section renders')

// 10. Menu popup injection: when a div[role="menu"] with session items
// appears in document.body, the MutationObserver injects "删除会话".
// The mock data has a non-live, archived session 's1' titled '分析与重构插件系统架构'.
// Build a fake session menu popup matching the Menu component's DOM structure.
const sessionMenu = document.createElement('div')
sessionMenu.setAttribute('role', 'menu')
sessionMenu.style.position = 'fixed'
sessionMenu.style.left = '100px'
sessionMenu.style.top = '100px'
const viewport = document.createElement('div')
viewport.setAttribute('role', 'presentation')
// Add existing session menu items (as the workspace bundle would render them)
const renameBtn = document.createElement('button')
renameBtn.setAttribute('role', 'menuitem')
renameBtn.textContent = '重命名'
viewport.appendChild(renameBtn)
const forkBtn = document.createElement('button')
forkBtn.setAttribute('role', 'menuitem')
forkBtn.textContent = '分支'
viewport.appendChild(forkBtn)
const archiveBtn = document.createElement('button')
archiveBtn.setAttribute('role', 'menuitem')
archiveBtn.textContent = '归档会话'
viewport.appendChild(archiveBtn)
sessionMenu.appendChild(viewport)
// Create a fake treeitem row for the session (needed by findSessionRow->matchSessionByRow)
const sessionTree = document.createElement('div')
sessionTree.setAttribute('role', 'tree')
const sessionGroup = document.createElement('div')
const fakeSessionRow = document.createElement('div')
fakeSessionRow.setAttribute('role', 'treeitem')
fakeSessionRow.setAttribute('aria-selected', 'true')
const fakeSessionTitle = document.createElement('span')
fakeSessionTitle.className = 'YDXeBa_title'
fakeSessionTitle.textContent = '分析与重构插件系统架构'
fakeSessionRow.appendChild(fakeSessionTitle)
const anchorBtn = document.createElement('button')
anchorBtn.setAttribute('aria-label', '会话"分析与重构插件系统架构"的操作')
anchorBtn.setAttribute('type', 'button')
fakeSessionRow.appendChild(anchorBtn)
sessionGroup.appendChild(fakeSessionRow)
sessionTree.appendChild(sessionGroup)
document.body.appendChild(sessionTree)

// Give the observer a chance to process and the cache to populate
await new Promise((resolve) => setTimeout(resolve, 60))

// Now add the menu popup to trigger injection
document.body.appendChild(sessionMenu)
await new Promise((resolve) => setTimeout(resolve, 60))

assert.ok(document.body.textContent.includes('删除会话'), 'menu popup injection: 删除会话 appears in the session menu')
assert.ok(sessionMenu.querySelector('[data-dsh-admin-injected]'), 'injected item has the data-dsh-admin-injected marker')
// Verify the separator was added
assert.ok(sessionMenu.querySelector('[role="separator"][data-dsh-admin-injected]'), 'separator injected before the delete item')

// Two-step confirm on the injected delete item: the first click arms it
// (relabel), and only the second click fires the RPC — against the single
// session whose title matches the clicked row exactly.
const deleteItem = [...sessionMenu.querySelectorAll('button')]
  .find((b) => b.textContent?.includes('删除会话'))
assert.ok(deleteItem !== undefined, 'delete menu item present')
deleteItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
assert.ok(deleteItem.textContent.includes('再点一次'), 'first click arms the delete item')
assert.equal((ctx.deletes ?? []).length, 0, 'armed click fires no RPC')
deleteItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 40))
assert.deepEqual(ctx.deletes, ['s1'], 'second click deletes the exact-title session')
assert.ok(document.body.textContent.includes('会话已删除'), 'delete success toast shown')

// Cleanup
document.body.removeChild(sessionMenu)

document.body.removeChild(sessionTree)

// 10b. Ambiguity refusal: two same-title sessions behind the RPC must
// never pick a victim — both clicks stay RPC-free and the error toast
// points at the management panel instead.
ctx.deletes.length = 0
ctx.sessionListOverride = [
  { id: 'dup-a', cwd: 'E:\\Demo\\dup-a', createdAt: 1_000, archived: false, live: false, title: '重名会话', summary: '', summaryError: null, messageCount: 1, workspaceId: null, workspaceTitle: null },
  { id: 'dup-b', cwd: 'E:\\Demo\\dup-b', createdAt: 2_000, archived: false, live: false, title: '重名会话', summary: '', summaryError: null, messageCount: 1, workspaceId: null, workspaceTitle: null },
]
const dupTree = document.createElement('div')
dupTree.setAttribute('role', 'tree')
const dupRow = document.createElement('div')
dupRow.setAttribute('role', 'treeitem')
const dupTitle = document.createElement('span')
dupTitle.textContent = '重名会话'
dupRow.appendChild(dupTitle)
const dupAnchor = document.createElement('button')
dupAnchor.setAttribute('aria-label', '会话"重名会话"的操作')
dupAnchor.setAttribute('type', 'button')
dupRow.appendChild(dupAnchor)
dupTree.appendChild(dupRow)
document.body.appendChild(dupTree)
const dupMenu = document.createElement('div')
dupMenu.setAttribute('role', 'menu')
const dupViewport = document.createElement('div')
dupViewport.setAttribute('role', 'presentation')
const dupArchiveBtn = document.createElement('button')
dupArchiveBtn.setAttribute('role', 'menuitem')
dupArchiveBtn.textContent = '归档会话'
dupViewport.appendChild(dupArchiveBtn)
dupMenu.appendChild(dupViewport)
await new Promise((resolve) => setTimeout(resolve, 40))
document.body.appendChild(dupMenu)
await new Promise((resolve) => setTimeout(resolve, 60))
const dupDeleteItem = [...dupMenu.querySelectorAll('button')]
  .find((b) => b.textContent?.includes('删除会话'))
assert.ok(dupDeleteItem !== undefined, 'duplicate-title menu still gets the delete item')
dupDeleteItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
dupDeleteItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await new Promise((resolve) => setTimeout(resolve, 40))
assert.equal(ctx.deletes.length, 0, 'ambiguous title never deletes')
assert.ok(document.body.textContent.includes('同名会话'), 'ambiguity error toast shown')
delete ctx.sessionListOverride
document.body.removeChild(dupMenu)
document.body.removeChild(dupTree)

// 11. Workspace menu injection: a div[role="menu"] with workspace items
// triggers "在资源管理器打开" injection.
const wsMenu = document.createElement('div')
wsMenu.setAttribute('role', 'menu')
wsMenu.style.position = 'fixed'
const wsViewport = document.createElement('div')
wsViewport.setAttribute('role', 'presentation')
const wsRenameBtn = document.createElement('button')
wsRenameBtn.setAttribute('role', 'menuitem')
wsRenameBtn.textContent = '重命名'
wsViewport.appendChild(wsRenameBtn)
const wsDeleteBtn = document.createElement('button')
wsDeleteBtn.setAttribute('role', 'menuitem')
wsDeleteBtn.textContent = '删除工作区'
wsViewport.appendChild(wsDeleteBtn)
wsMenu.appendChild(wsViewport)
// Workspace treeitem row with anchor button inside
const wsTree = document.createElement('div')
wsTree.setAttribute('role', 'tree')
const wsGroup = document.createElement('div')
const fakeWsRow = document.createElement('div')
fakeWsRow.setAttribute('role', 'treeitem')
fakeWsRow.setAttribute('aria-expanded', 'true')
const fakeWsTitle = document.createElement('span')
fakeWsTitle.className = 'YDXeBa_title'
fakeWsTitle.textContent = 'alpha-project'
fakeWsRow.appendChild(fakeWsTitle)
const wsAnchorBtn = document.createElement('button')
wsAnchorBtn.setAttribute('aria-label', '工作区“alpha-project”的操作')
wsAnchorBtn.setAttribute('type', 'button')
fakeWsRow.appendChild(wsAnchorBtn)
wsGroup.appendChild(fakeWsRow)
wsTree.appendChild(wsGroup)
document.body.appendChild(wsTree)

await new Promise((resolve) => setTimeout(resolve, 40))
document.body.appendChild(wsMenu)
await new Promise((resolve) => setTimeout(resolve, 60))

assert.ok(document.body.textContent.includes('在资源管理器打开'), 'workspace menu injection: 在资源管理器打开 appears')

// Cleanup
document.body.removeChild(wsMenu)
document.body.removeChild(wsTree)
document.body.querySelector('[data-dsh-admin-context]')?.remove()

// 11.5 Settings-nav icon identity: the settings dialog's nav paints one
// generic gear for every unknown section id, so the plugin repaints its four
// pages' rows with distinct per-page icons (matched by nav label, marked with
// data-dsh-admin-nav-icon, official rows untouched, replacement idempotent).
const settingsDialog = document.createElement('div')
settingsDialog.setAttribute('role', 'dialog')
settingsDialog.setAttribute('aria-modal', 'true')
const settingsNav = document.createElement('nav')
const mkNavRow = (label) => {
  const row = document.createElement('button')
  const gear = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  gear.setAttribute('class', 'stock-gear')
  row.appendChild(gear)
  const text = document.createElement('span')
  text.textContent = label
  row.appendChild(text)
  settingsNav.appendChild(row)
  return row
}
const mcpNavRow = mkNavRow('MCP服务器')
// Every plugin settings.section gets a nav row (the fixture derives the labels
// from the registrations above, so a new page without an icon fails here), plus
// the shell's own rows — including 'Agent 预设', the label this plugin must NOT
// reuse (the official ui-agent-preset page owns it, and the icon injector can
// only key off the label text). '已归档会话' is dsh's OWN page that the plugin
// merges its panels into, so it gets the clock icon too.
const pluginSectionLabels = registeredSections
 .filter((entry) => entry.options.name === 'settings.section')
 .map((entry) => entry.options.label)
for (const label of pluginSectionLabels) if (label !== 'MCP服务器') mkNavRow(label)
const officialRows = ['Agent 预设', '模型', '内置插件'].map((label) => mkNavRow(label))
const archivedNavRow = mkNavRow('已归档会话')
settingsDialog.appendChild(settingsNav)
document.body.appendChild(settingsDialog)
await new Promise((resolve) => setTimeout(resolve, 60))

const repainted = settingsDialog.querySelectorAll('svg[data-dsh-admin-nav-icon]')
assert.equal(repainted.length, pluginSectionLabels.length + 1, 'every plugin settings section plus the official 已归档会话 row got its nav icon repainted')
assert.ok(pluginSectionLabels.length === 8, `eight settings.section pages carry an icon (got ${pluginSectionLabels.length})`)
assert.equal(mcpNavRow.querySelector('svg').getAttribute('data-dsh-admin-nav-icon'), 'MCP服务器')
assert.equal(mcpNavRow.querySelector('svg').getAttribute('class'), 'stock-gear', 'replacement inherits the stock icon css class')
assert.equal(archivedNavRow.querySelector('svg').getAttribute('data-dsh-admin-nav-icon'), '已归档会话', 'the official archived-sessions row carries the clock icon')
for (const row of officialRows) {
 assert.equal(row.querySelector('svg[data-dsh-admin-nav-icon]'), null, 'official nav rows keep their own icon')
}
await new Promise((resolve) => setTimeout(resolve, 60))
assert.equal(settingsDialog.querySelectorAll('svg[data-dsh-admin-nav-icon]').length, pluginSectionLabels.length + 1, 'repaint is idempotent across observer fires')
settingsDialog.remove()

// 11.6 Archived-sessions merge: while dsh's OWN 已归档会话 section is the
// active settings page, the plugin's session-history + workspace panels are
// DOM-mounted into that section's scroll container (the content column's last
// unmarked child) instead of registering nav rows of their own; switching
// away, closing the dialog, or the shell re-rendering the container away all
// unmount them.
const mergeDialog = document.createElement('div')
mergeDialog.setAttribute('role', 'dialog')
mergeDialog.setAttribute('aria-modal', 'true')
const mergeNav = document.createElement('nav')
const mkMergeRow = (label, active) => {
  const row = document.createElement('button')
  if (active) row.setAttribute('aria-current', 'true')
  const text = document.createElement('span')
  text.textContent = label
  row.appendChild(text)
  mergeNav.appendChild(row)
  return row
}
mkMergeRow('Agent 预设', false)
const archivedRow = mkMergeRow('已归档会话', true)
const mergeContent = document.createElement('div')
mergeContent.appendChild(document.createElement('div')) // shell header
const mergeOptions = document.createElement('div') // shell scroll container
mergeContent.appendChild(mergeOptions)
mergeDialog.appendChild(mergeNav)
mergeDialog.appendChild(mergeContent)
document.body.appendChild(mergeDialog)
await new Promise((resolve) => setTimeout(resolve, 120))

const mergeContainer = mergeOptions.querySelector('[data-dsh-admin-archived-merge]')
assert.ok(mergeContainer !== null, 'merge container injected into the official section scroll container')
assert.ok(mergeContainer.textContent.includes('分析与重构插件系统架构'), 'session-history panel mounted inside the official page')
assert.equal(mergeContainer.querySelectorAll('[data-dsh-admin-section]').length, 1, 'only the session-history panel merges (the workspace manager is not merged)')
assert.ok(!mergeContainer.textContent.includes('新建工作区'), 'the workspace manager is absent from the merged page')

// Switching to another section unmounts the merged panels.
archivedRow.removeAttribute('aria-current')
mkMergeRow('模型', true)
await new Promise((resolve) => setTimeout(resolve, 120))
assert.equal(mergeOptions.querySelector('[data-dsh-admin-archived-merge]'), null, 'switching away unmounts the merged panels')

// Re-activating the official page re-injects them.
archivedRow.setAttribute('aria-current', 'true')
await new Promise((resolve) => setTimeout(resolve, 120))
assert.ok(mergeOptions.querySelector('[data-dsh-admin-archived-merge]') !== null, 're-activating the official page re-injects the panels')

// Closing the dialog unmounts them.
document.body.removeChild(mergeDialog)
await new Promise((resolve) => setTimeout(resolve, 120))
assert.equal(document.querySelector('[data-dsh-admin-archived-merge]'), null, 'closing the dialog unmounts the merged panels')

// 11.7 Fallback: a deployment WITHOUT dsh's own 已归档会话 page (0.1.5-rc.2 and
// earlier ship no dsh-client-ui-settings-unarchive-sessions) has no host for
// the merged panels — the injector registers the two sections the plugin used
// to own, once, so the panels stay reachable.
const fallbackDialog = document.createElement('div')
fallbackDialog.setAttribute('role', 'dialog')
fallbackDialog.setAttribute('aria-modal', 'true')
const fallbackNav = document.createElement('nav')
const fallbackRow = document.createElement('button')
fallbackRow.setAttribute('aria-current', 'true')
const fallbackLabel = document.createElement('span')
fallbackLabel.textContent = '模型'
fallbackRow.appendChild(fallbackLabel)
fallbackNav.appendChild(fallbackRow)
fallbackDialog.appendChild(fallbackNav)
fallbackDialog.appendChild(document.createElement('div'))
document.body.appendChild(fallbackDialog)
await new Promise((resolve) => setTimeout(resolve, 120))

assert.equal(injectedSections.length, 12, 'the fallback injects the two retired sections')
const fallbackInjections = injectedSections.slice(10)
assert.deepEqual(fallbackInjections.map((i) => i.key), ['settings.section', 'settings.section'], 'fallback waits on settings.section')
fallbackInjections.forEach((i) => i.callback())
const fallbackIds = registeredSections.slice(10).map((e) => e.options.id).sort()
assert.deepEqual(fallbackIds, ['session-history', 'workspaces'], 'fallback registers 历史会话 + 工作区')
assert.ok(registeredSections.some((e) => e.options.id === 'session-history' && e.options.order === 100), 'fallback 历史会话 keeps order 100')
assert.ok(registeredSections.some((e) => e.options.id === 'workspaces' && e.options.order === 22), 'fallback 工作区 keeps order 22')
// One-shot: further dialog churn never re-registers the same ids.
await new Promise((resolve) => setTimeout(resolve, 80))
assert.equal(injectedSections.length, 12, 'the fallback fires once')
document.body.removeChild(fallbackDialog)

// 12. MCP editor: edit an existing server, fill it via the React onChange
// props (jsdom synthetic input events do not reach React 18's controlled
// onChange reliably), and save — unedited fields must survive the round-trip.
await act(async () => {
  button('编辑').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
assert.ok(document.body.textContent.includes('编辑 mcp-existing'), 'MCP editor form opens')
// MCP panel inputs: [0]=id, [1]=serverName, [2]=command, [3]=args.
const mcpInputs = [...host.querySelectorAll('input')]
const propsOf = (el) => el[Object.keys(el).find((k) => k.startsWith('__reactProps$'))]
await act(async () => {
  propsOf(mcpInputs[1]).onChange({ target: { value: 'existing-renamed' } })
})
const mcpSave = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存'))
assert.ok(mcpSave !== undefined && !mcpSave.disabled, 'save enabled once the form is complete')
await act(async () => {
  mcpSave.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
assert.equal((ctx.mcpUpserts ?? []).length, 1, 'upsert called once')
assert.equal(ctx.mcpUpserts[0].id, 'mcp-existing', 'upsert carries the entry id')
assert.equal(ctx.mcpUpserts[0].config.serverName, 'existing-renamed', 'upsert carries serverName')
assert.equal(ctx.mcpUpserts[0].config.command, 'npx', 'upsert carries the stdio command')
assert.deepEqual(ctx.mcpUpserts[0].config.args, ['-y', '@modelcontextprotocol/server-github'], 'unchanged args survive editing')
assert.deepEqual(ctx.mcpUpserts[0].config.env, { GITHUB_TOKEN: 'token' }, 'unchanged env survives editing')
assert.equal(ctx.mcpUpserts[0].config.cwd, 'E:/Demo', 'unchanged cwd survives editing')
assert.equal(ctx.mcpUpserts[0].config.toolCallTimeoutMs, 45_000, 'unchanged timeout survives editing')
assert.equal(ctx.mcpUpserts[0].config.failOnStartupError, true, 'unchanged startup policy survives editing')
assert.deepEqual(ctx.mcpUpserts[0].config.reconnect, { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }, 'unchanged reconnect policy survives editing')
assert.ok(document.body.textContent.includes('mcp-existing'), 'saved server listed')

// 12b. MCP connectivity test: click the test button on the existing entry and
// verify the RPC fires and the success indicator renders with server info.
const testBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('🔌 测试'))
assert.ok(testBtn !== undefined, 'connectivity test button exists')
await act(async () => {
  testBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
assert.ok((ctx.mcpTests ?? []).includes('mcp-existing'), 'connectivity test RPC fired for the entry id')
assert.ok(document.body.textContent.includes('✅ 连通'), 'success indicator rendered')
assert.ok(document.body.textContent.includes('mock-mcp'), 'server name from probe rendered')
assert.ok(document.body.textContent.includes('3 个工具'), 'tool count from probe rendered')
assert.ok(document.body.textContent.includes('fetch') && document.body.textContent.includes('search') && document.body.textContent.includes('browse'), 'tool names from probe rendered')

// 12c. MCP removal is two-step: 移除 opens a confirm bar and only its 确认移除
// fires the RPC — a single misclick used to drop the whole server block
// (secret-bearing headers included) from cordis.patch.yml.
const mcpRemoveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '移除')
assert.ok(mcpRemoveBtn !== undefined, 'MCP 移除 button exists')
await act(async () => {
  mcpRemoveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
assert.equal((ctx.mcpRemoves ?? []).length, 0, 'the first click deletes nothing')
assert.ok(document.body.textContent.includes('确定从 cordis.patch.yml 移除该 MCP 服务器配置'), 'the confirm bar renders')
const confirmBar = document.querySelector('.confirm-bar')
assert.ok(confirmBar !== null, 'confirm bar element present')
const mcpCancelBtn = [...confirmBar.querySelectorAll('button')].find((b) => b.textContent === '取消')
assert.ok(mcpCancelBtn !== undefined, 'cancel button rendered inside the bar')
await act(async () => {
  mcpCancelBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
assert.equal((ctx.mcpRemoves ?? []).length, 0, 'cancel leaves the entry alone')

// 13. Test MCP headers editing for streamable-http transport: add a new entry
// with headers, save, and verify the upsert carries the headers.
await act(async () => {
  button('添加服务器').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
assert.ok(document.body.textContent.includes('添加 MCP 服务器'), 'add server form opens')
// The editor card must carry the mcp-editor scroll-viewport class — the CSS
// gives it max-height + overflow-y:auto + sticky action row so a tall form
// scrolls inside the bounded settings dialog instead of clipping 保存.
// Regression guard: this class once existed only as a React key (dead CSS).
const editorCard = host.querySelector('.card.mcp-editor')
assert.ok(editorCard !== null, 'MCP editor card carries the mcp-editor scroll-viewport class')
assert.ok(editorCard.querySelector('.card-actions') !== null, 'MCP editor action row lives inside the scroll viewport')
// The empty-state hint must be hidden while the add form is open — otherwise it
// crowds the form and (under the section's bounded/overflow-hidden height) can
// push the 保存 button out of reach. Regression guard for the empty-state fix.
assert.ok(!document.body.textContent.includes('暂无 MCP 服务器配置'), 'empty-state hint hidden while the add form is open')
// All inputs: [0]=id, [1]=serverName, [2]=url, [3]=headers, [4]=reconnectInitialDelayMs, [5]=reconnectMaxDelayMs, [6]=reconnectMaxAttempts
const addInputs = [...host.querySelectorAll('input')]
const addTextareas = [...host.querySelectorAll('textarea')]
const addSelects = [...host.querySelectorAll('select')]
assert.ok(addSelects.length >= 1, 'transport select exists')
const propsOfEl = (el) => el[Object.keys(el).find((k) => k.startsWith('__reactProps$'))]
// The id field is auto-filled with a generated id for new servers
const autoId = addInputs[0].value
assert.ok(/^mcp-[A-Za-z0-9]{8}$/.test(autoId), 'id auto-generated for a new server: ' + autoId)
assert.ok(!addInputs[0].disabled, 'generated id field stays editable')
// The regenerate button swaps in a fresh id
const regenBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('🎲'))
assert.ok(regenBtn !== undefined, 'regenerate id button exists')
await act(async () => {
  regenBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
const regenId = [...host.querySelectorAll('input')][0].value
assert.ok(regenId !== autoId && /^mcp-[A-Za-z0-9]{8}$/.test(regenId), 'regenerate produces a fresh valid id')
// Override the generated id with a deterministic one (the field is editable).
await act(async () => {
  propsOfEl(addInputs[0]).onChange({ target: { value: 'mcp-http-test' } })
})
// Switch to streamable-http transport
await act(async () => {
  propsOfEl(addSelects[0]).onChange({ target: { value: 'streamable-http' } })
})
await new Promise((resolve) => setTimeout(resolve, 20))
// Fill serverName
await act(async () => {
  propsOfEl(addInputs[1]).onChange({ target: { value: 'http-test' } })
})
// Re-query inputs after transport switch: the form re-renders with url input
// instead of command input. Inputs now: [0]=id, [1]=serverName, [2]=url,
// [3]=reconnectInitialDelayMs, [4]=reconnectMaxDelayMs, [5]=reconnectMaxAttempts
const httpInputs = [...host.querySelectorAll('input')]
// Fill url
await act(async () => {
  propsOfEl(httpInputs[2]).onChange({ target: { value: 'http://localhost:8080/mcp' } })
})
// Fill headers (textarea)
const httpTextareas = [...host.querySelectorAll('textarea')]
if (httpTextareas.length > 0) {
  await act(async () => {
    propsOfEl(httpTextareas[0]).onChange({ target: { value: 'Authorization=Bearer tok123\nX-Custom=val' } })
  })
}
const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存'))
assert.ok(saveBtn !== undefined && !saveBtn.disabled, 'save enabled for http entry')
await act(async () => {
  saveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
assert.equal((ctx.mcpUpserts ?? []).length, 2, 'second upsert called')
const httpUpsert = ctx.mcpUpserts[1]
assert.equal(httpUpsert.id, 'mcp-http-test', 'http upsert carries the entry id')
assert.equal(httpUpsert.config.transport, 'streamable-http', 'http upsert carries transport')
assert.equal(httpUpsert.config.url, 'http://localhost:8080/mcp', 'http upsert carries url')
assert.deepEqual(httpUpsert.config.headers, { Authorization: 'Bearer tok123', 'X-Custom': 'val' }, 'http upsert carries headers')

// 13b. A NEW entry reusing an EXISTING id must be rejected client-side:
// host upsert locates its block by id and would silently overwrite that
// entry's whole config. Rejection happens before any RPC — form stays open.
await act(async () => {
  button('添加服务器').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
const collInputs = [...host.querySelectorAll('input')]
await act(async () => {
  propsOfEl(collInputs[0]).onChange({ target: { value: 'mcp-existing' } })
})
await act(async () => {
  propsOfEl(collInputs[1]).onChange({ target: { value: 'hijack' } })
})
// stdio defaults need a command before the save button enables.
await act(async () => {
  propsOfEl(collInputs[2]).onChange({ target: { value: 'demo' } })
})
const collSave = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存'))
await act(async () => {
  collSave.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
assert.equal((ctx.mcpUpserts ?? []).length, 2, 'colliding new entry never reaches the host RPC')
assert.ok(document.body.textContent.includes('已被其他 MCP 条目占用'), 'id collision error surfaced to the user')
assert.ok(document.body.textContent.includes('添加 MCP 服务器'), 'add form stays open after the rejection')
// Cancel restores a neutral state for the following sections.
const collCancel = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '取消').pop()
await act(async () => {
  collCancel.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
assert.ok(!document.body.textContent.includes('添加 MCP 服务器'), 'editor closes cleanly after canceling the collision attempt')

// 13c. MCP tool playground: 🔌 测试 populates the tool list, 🧪 试调用 opens
// the bench, ▶ 执行工具 fires mcpAdmin/callTool and renders the result.
await act(async () => {
  const testBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('🔌 测试'))
  assert.ok(testBtn !== undefined, '🔌 测试 button present')
  testBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 40))
})
await act(async () => {
  const pgBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('🧪 试调用'))
  assert.ok(pgBtn !== undefined, '🧪 试调用 button present')
  pgBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 30))
})
assert.ok(document.body.textContent.includes('🧪 工具试调用'), 'playground bench opened')
const toolSelect = host.querySelector('select')
assert.ok(toolSelect !== undefined, 'tool picker rendered from the probe tool list')
await act(async () => {
  const runBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('▶ 执行工具'))
  assert.ok(runBtn !== undefined, '▶ 执行工具 button present')
  runBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 40))
})
assert.equal((ctx.callToolCalls ?? []).length, 1, 'callTool fired once')
assert.equal(ctx.callToolCalls[0].tool, 'fetch', 'default tool is the first offered')
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30))
})
assert.ok(document.body.textContent.includes('hello from fetcher-mcp'), 'tool result rendered: ' + (document.querySelector('.mcp-playground-out')?.textContent ?? '(no out node)'))
assert.ok(document.body.textContent.includes('✅ 执行成功'), 'success verdict rendered')
await act(async () => {
  const closeBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '关闭')
  if (closeBtn !== undefined) closeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 20))
})

// 14. Test reconnect toggle: open the existing stdio entry, disable reconnect,
// save, and verify the upsert carries no reconnect config.
ctx.mcpUpserts.length = 0
await act(async () => {
  button('编辑').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
// Find the reconnect checkbox and uncheck it
const reconnectCheckbox = [...host.querySelectorAll('input[type="checkbox"]')].find((cb) => cb.id === 'reconnect-toggle')
assert.ok(reconnectCheckbox !== undefined, 'reconnect checkbox exists')
await act(async () => {
  propsOfEl(reconnectCheckbox).onChange({ target: { checked: false } })
})
const saveBtn2 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存'))
await act(async () => {
  saveBtn2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
const reconnectDisabledUpsert = ctx.mcpUpserts[0]
assert.equal(reconnectDisabledUpsert.id, 'mcp-existing', 'reconnect-disabled upsert carries the entry id')
assert.equal(reconnectDisabledUpsert.config.reconnect, undefined, 'reconnect config omitted when disabled')

// 14b. env values containing ';' survive editing: pairs split on newlines
// only, so PATH-style values round-trip whole instead of being truncated
// at the first separator (Windows paths carry ';' everywhere).
ctx.mcpUpserts.length = 0
await act(async () => {
  button('编辑').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
const envArea = [...host.querySelectorAll('textarea')][0]
await act(async () => {
  propsOfEl(envArea).onChange({ target: { value: 'PATH=C:\\a;C:\\b' } })
})
const saveBtn3 = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存'))
await act(async () => {
  saveBtn3.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 40))
assert.deepEqual(ctx.mcpUpserts[0].config.env, { PATH: 'C:\\a;C:\\b' }, 'env value with ; survives the newline-only split')

// 15. The 命令与钩子 section (merged from dsh-command-hook-admin): two tabs over
// the two stores, plus the bridge install/uninstall affordance. Its assertions
// live further down (15a-15f), so it is mounted there rather than here — a panel
// held open across the other mounts would let one panel's text satisfy another's
// assertion, which is exactly how a duplicated usage block hid in this file.
await act(async () => { mcpRoot.unmount() })
host.remove()

// 15p. The standalone 用量仪表盘 page: mounts, auto-loads rows, renders the
// VibeUsage form (range pills, KPI cards, heatmap).
const usageRoot = await mountSection(usageSection)
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
text = host.textContent
assert.ok(text.includes('📊 用量仪表盘') && text.includes('📈 每日趋势'), 'usage dashboard page renders')
assert.ok(text.includes('⏱ 日期'), 'range pills row rendered')
for (const pill of ['今天', '24H', '7D', '30D', '90D', '全部']) {
  assert.ok([...host.querySelectorAll('.usage-toolbar .pill')].some((b) => b.textContent === pill), 'range pill ' + pill + ' rendered')
}
assert.ok(text.includes('总 Token') && text.includes('输入 Token'), 'KPI token cards rendered')
assert.ok(text.includes('会话数') && text.includes('活跃天数'), 'KPI session cards rendered')
assert.ok(text.includes('🕒 分时活跃'), 'hour-of-week heatmap panel rendered')
assert.ok(text.includes('alpha-project'), 'project filter carries project names')
assert.ok(host.querySelectorAll('.heat-row').length === 7, 'seven weekday rows in the heatmap')
// ONE state chip (the sweep cadence). The deleted-session badge was removed
// from this row on request — the rows are still retained in the ledger, they
// just no longer need a badge here.
const usageHead = host.querySelector('.usage-head')
assert.ok(usageHead !== null, 'the dashboard head renders as a chip row')
assert.equal(usageHead.querySelectorAll('.usage-chip').length, 1, 'exactly one state chip remains')
assert.ok(!host.textContent.includes('已删除会话'), 'the deleted-session badge is gone from the head')
const sweepChip = usageHead.querySelector('.usage-chip.on')
assert.ok(sweepChip !== null, 'the sweep chip renders in its ON state when the host reports an interval')
assert.ok(sweepChip.textContent.includes('60 分钟'), 'the chip carries the cadence instead of hiding it in a tooltip')
assert.equal(usageHead.querySelectorAll('.usage-chip.off').length, 0, 'the OFF state does not render alongside it')
// The filter label and its box are ONE control: the label is a prefix segment
// inside the same bordered wrapper, so a narrow dialog can never orphan it.
const filter = host.querySelector('.usage-filter')
assert.ok(filter !== null, 'the filter renders as a grouped control')
assert.ok(filter.querySelector('.usage-filter-label') !== null, 'the label is inside the filter group')
assert.equal(filter.querySelector('.usage-filter-label').textContent, '筛选', 'the label reads 筛选')
assert.equal(filter.querySelectorAll('select').length, 1, 'the select lives inside the same group')
assert.equal(filter.querySelector('select').options[0].text, '全部项目', 'the placeholder names the dimension once, not on every option')
assert.ok([...filter.querySelectorAll('option')].every((o) => !o.text.includes('：')), 'no option repeats the dimension prefix')
assert.equal(filter.querySelector('select').getAttribute('title'), '全部项目', 'the select title carries the full current value')
assert.equal(filter.querySelector('select').getAttribute('aria-label'), '按项目筛选', 'the select is labelled for assistive tech')
// Range state is not colour-only.
const pressed = [...host.querySelectorAll('.usage-toolbar .pill')].filter((b) => b.getAttribute('aria-pressed') === 'true')
assert.equal(pressed.length, 1, 'exactly one range pill is pressed')
assert.equal(pressed[0].textContent, '30D', 'the pressed pill is the default 30D window')
await act(async () => {
  const pill7d = [...host.querySelectorAll('.usage-toolbar .pill')].find((b) => b.textContent === '7D')
  pill7d.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 30))
})
assert.ok([...host.querySelectorAll('.usage-toolbar .pill')].find((b) => b.textContent === '7D').className.includes('active'), '7D pill becomes active')
await act(async () => { usageRoot.unmount() })
host.remove()

// 15y. The Webhook 触发 page: mounts, renders rules from webhookAdmin/list.
const webhookRoot = await mountSection(webhookSection)
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
text = document.body.textContent
assert.ok(text.includes('ci-fail'), 'webhook rule card rendered from webhookAdmin/list')
assert.ok(text.includes('POST'), 'endpoint hint rendered')
assert.ok(text.includes('已安装，需挂载'), 'runtime-not-mounted banner rendered')
await act(async () => { webhookRoot.unmount() })
host.remove()


// 15z-websearch-loop. Same closure hazard in the provider list: click the FIRST
// opt-in provider's install button and assert ITS id travels over the RPC.
const webSearchRoot = await mountSection(byId['web-search-admin'])
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
const wsInstallBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('📥 安装'))
assert.ok(wsInstallBtn !== undefined, 'an opt-in provider install button renders')
await act(async () => {
  propsOf(wsInstallBtn).onClick()
  await new Promise((resolve) => setTimeout(resolve, 20))
})
assert.deepEqual(ctx.webSearchInstalls ?? [], ['exa'], 'the FIRST install button installs the provider it belongs to')

// 15z-websearch-config. The ⚙ 配置 editor is what makes an installed provider
// usable at all (Exa / Perplexity register no dsh settings card), so the panel
// must read the provider's field descriptors and write back only what the user
// staged. Inherited defaults stay in the placeholder; a save carries the value
// plus the revision the panel read.
const wsConfigBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('⚙ 配置'))
assert.ok(wsConfigBtn !== undefined, 'a provider config button renders')
await act(async () => {
  propsOf(wsConfigBtn).onClick()
  await new Promise((resolve) => setTimeout(resolve, 40))
})
assert.deepEqual(ctx.webSearchConfigReads ?? [], ['deepseek-official'], 'the FIRST config button reads the provider it belongs to')
assert.ok(host.textContent.includes('dsh settings 命名空间'), 'a settings-backed provider renders its live-storage note')
const wsInput = [...host.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === 'Endpoint')
assert.ok(wsInput !== undefined, 'the Endpoint field renders from the host descriptors')
assert.equal(wsInput.value, 'https://search.proxy/v1', 'an explicitly set field is staged into its input')
const wsModel = [...host.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === '模型')
assert.equal(wsModel.value, '', 'a field still at the provider default stages EMPTY')
assert.ok(wsModel.placeholder.includes('deepseek-v4-flash'), 'the inherited default rides the placeholder')
const wsSecret = [...host.querySelectorAll('input')].find((i) => i.type === 'password')
assert.equal(wsSecret.value, '', 'a secret field never carries a value')
assert.ok(wsSecret.placeholder.includes('已配置'), 'a set secret is reported as configured')
await act(async () => {
  propsOf(wsInput).onChange({ target: { value: 'https://other.proxy/v1' } })
  await new Promise((resolve) => setTimeout(resolve, 20))
})
const wsSave = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('💾 保存配置'))
assert.ok(wsSave !== undefined, 'save button renders')
await act(async () => {
  propsOf(wsSave).onClick()
  await new Promise((resolve) => setTimeout(resolve, 40))
})
assert.deepEqual(ctx.webSearchSaves, [{
  providerId: 'deepseek-official',
  values: { baseURL: 'https://other.proxy/v1' },
  unset: [],
  expectedRevision: 7,
}], 'save sends only the staged field plus the revision the panel read')
assert.ok(host.textContent.includes('已保存'), 'a successful save reports back inside the editor')
await act(async () => { webSearchRoot.unmount() })
host.remove()

// 15z-skills-roster. The 技能 page renders the WHOLE roster from
// skillsAdmin/list (the host merges the global layer with one read per agent
// preset standing scope and one per session scope) and filters it locally —
// the previous revision could only ever show ONE session's user-invocable
// subset.
const skillsRoot = await mountSection(byId['skills-admin'])
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
text = host.textContent
assert.equal(ctx.skillsRequests.length, 1, 'the panel asks the host once for the whole roster')
assert.deepEqual(ctx.skillsRequests[0], ['s2', 's3', 's1'], 'every session id travels, non-archived first')
assert.ok(text.includes('/alpha-only'), 'a project-scoped skill renders')
assert.ok(text.includes('/global-skill'), 'a global (bundled) skill renders')
assert.ok(text.includes('🤖 模型可调用'), 'the model-invocable badge renders')
assert.ok(text.includes('👤 人类可调用'), 'the user-invocable badge renders')
assert.ok(text.includes('插件内置'), 'a bundled skill carries its source label')
assert.ok(text.includes('/proj/.agents/skills/alpha-only/SKILL.md'), 'the SKILL.md path renders')
assert.ok(text.includes('可见于：'), 'the per-skill scope list renders')
assert.ok(text.includes('会话 s1 的作用域未能解析'), 'an unresolved session scope is surfaced')
// Text filter: a needle matching one skill must hide the others.
const skillsNeedle = [...host.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === '过滤技能')
assert.ok(skillsNeedle !== undefined, 'the roster filter input renders')
await act(async () => {
  propsOf(skillsNeedle).onChange({ target: { value: 'alpha' } })
  await new Promise((resolve) => setTimeout(resolve, 20))
})
assert.ok(host.textContent.includes('/alpha-only'), 'the matching skill survives the filter')
assert.ok(!host.textContent.includes('/global-skill'), 'a non-matching skill is filtered out')
// An incomplete host read must never read as a complete roster.
await act(async () => {
  propsOf(skillsNeedle).onChange({ target: { value: '' } })
  await new Promise((resolve) => setTimeout(resolve, 20))
})
ctx.skillsIncomplete = true
await act(async () => {
  const skillsRefresh = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('⟳ 刷新'))
  propsOf(skillsRefresh).onClick()
  await new Promise((resolve) => setTimeout(resolve, 40))
})
assert.ok(host.textContent.includes('complete=false'), 'an incomplete skill read is surfaced, not silently shown')
ctx.skillsIncomplete = undefined
await act(async () => { skillsRoot.unmount() })
host.remove()

// 15z-search. Full-text search: toggle opens the panel, Enter returns hits.
// Section 7's sessionsRoot was unmounted at line 705 — mount a fresh one.
const searchSessionRoot = await mountSection(sessionsSection)
await act(async () => {
  const ftBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('🔎 全文搜索'))
  assert.ok(ftBtn !== undefined, 'fulltext toggle present in the sessions host')
  ftBtn[Object.keys(ftBtn).find((k) => k.startsWith('__reactProps$'))].onClick()
  await new Promise((resolve) => setTimeout(resolve, 60))
})
assert.ok(host.textContent.includes('检索所有会话的消息内容') || host.querySelector('input[placeholder*="检索所有会话"]') !== null, 'fulltext query box rendered in the sessions host')
await act(async () => {
  const box = [...host.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('检索所有会话'))
  assert.ok(box !== undefined, 'fulltext input in the sessions host')
  propsOf(box).onChange({ target: { value: '合并' } })
  await new Promise((resolve) => setTimeout(resolve, 20))
})
await act(async () => {
  const go = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === '搜索')
  go.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 40))
})
assert.ok(host.textContent.includes('命中 1 个会话'), 'fulltext hit summary rendered')
assert.ok(host.textContent.includes('分析与重构插件系统架构'), 'fulltext hit card rendered')
await act(async () => { searchSessionRoot.unmount() })
host.remove()

// 15z-health. Session health check: 🩺 button loads the per-session report.
const healthRoot = await mountSection(sessionsSection)
await act(async () => {
  const healthBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('🩺 体检'))
  assert.ok(healthBtn !== undefined, 'health button present on a session card')
  healthBtn[Object.keys(healthBtn).find((k) => k.startsWith('__reactProps$'))].onClick()
  await new Promise((resolve) => setTimeout(resolve, 60))
})
assert.ok(host.textContent.includes('🩺'), 'health report card rendered')
assert.ok(host.textContent.includes('read') && host.textContent.includes('×3'), 'tool stat row rendered')
await act(async () => { healthRoot.unmount() })
host.remove()

URL.createObjectURL = () => { throw new Error("stubbed out after the export test") }
URL.revokeObjectURL = () => {}

// 15. The 命令与钩子 section, mounted here so its assertions below run against
// their own panel (15a-15f).
const commandHookRoot = await mountSection(commandHookSection)

text = host.textContent
assert.ok(text.includes('提示词命令'), 'commands tab renders')
assert.ok(text.includes('/review'), 'live command row rendered')
assert.ok(text.includes('已停用'), 'disabled command badge rendered')
assert.ok(text.includes('C:/Users/demo/.dsh/commands'), 'commands storage path shown')

// 15a-2. Command sharing loop: export downloads a JSON blob of all commands;
// import reads pasted JSON and saves NEW names while skipping same-name ones.
URL.createObjectURL = (blob) => exportedCommandsBlob = blob
URL.revokeObjectURL = () => {}
let exportedCommandsBlob = null
assert.ok(button('⬆ 导入') !== undefined, '⬆ 导入 button present (import panel covered by renderer surface)')

// 15b. The 钩子 tab: rows + bridge banner with the install affordance while
// the stock bridge is neither installed nor mounted.
await act(async () => {
  button('钩子').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 60))
text = document.body.textContent
assert.ok(text.includes('node guard.js'), 'hook command row rendered')
assert.ok(text.includes('stop.sh'), 'disabled hook row rendered (sidecar)')
assert.ok(text.includes('当前未安装 hooks 桥'), 'bridge-missing banner rendered')
const installBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('安装并挂载 hooks 桥'))
assert.ok(installBtn, 'one-click bridge install button rendered while missing')

await act(async () => {
  installBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 60))
assert.equal((ctx.bridgeInstalls ?? []).length, 1, 'bridgeInstall RPC fired')
assert.ok(document.body.textContent.includes('hooks 桥已安装并写入 profile，重启 dsh 后生效'), 'install note rendered (not silently wiped)')
assert.ok(document.body.textContent.includes('重启 dsh 后挂载生效'), 'banner flipped to the installed-but-not-mounted state')
const uninstallBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('卸载桥'))
assert.ok(uninstallBtn, 'uninstall affordance rendered once installed')

// 15c. Uninstall is a two-click confirm.
await act(async () => {
  uninstallBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
assert.equal((ctx.bridgeRemoves ?? []).length, 0, 'first click only arms the confirm')
const confirmRemove = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('确认卸载'))
assert.ok(confirmRemove, 'confirm button rendered after the first click')
await act(async () => {
  confirmRemove.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 60))
assert.equal((ctx.bridgeRemoves ?? []).length, 1, 'second click fires bridgeRemove')
assert.ok(document.body.textContent.includes('hooks 桥已卸载'), 'remove note rendered')

// 15d. The Codex bridge rides the same tab (no settings page of its own): its
// banner reads the same listHooks payload, and its install path must re-read
// through listHooks — the verb answers with a sparse payload that would blank
// the hook list and both banners if it were rendered as the whole state.
assert.ok(document.body.textContent.includes('当前未安装 Codex 钩子桥'), 'codex bridge banner rendered inside the 钩子 tab')
const codexInstallBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('安装 Codex 钩子桥'))
assert.ok(codexInstallBtn, 'codex bridge install affordance rendered while missing')
await act(async () => {
  codexInstallBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 80))
assert.equal((ctx.codexBridgeInstalls ?? []).length, 1, 'codexBridgeInstall RPC fired')
assert.ok(document.body.textContent.includes('Codex 钩子桥已安装并写入 profile（钩子文件'), 'codex install note rendered')
assert.ok(document.body.textContent.includes('node guard.js'), 'hook rows survived the sparse-payload re-read')
const codexUninstallBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('卸载 Codex 桥'))
assert.ok(codexUninstallBtn, 'codex uninstall affordance rendered once installed')

// 15e. Codex uninstall is a two-click confirm too, with its own sentinel
// (the hook rows share the same `confirming` state).
await act(async () => {
  codexUninstallBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
assert.equal((ctx.codexBridgeRemoves ?? []).length, 0, 'first click only arms the codex confirm')
const codexConfirm = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('确认卸载'))
assert.ok(codexConfirm, 'codex confirm button rendered after the first click')
await act(async () => {
  codexConfirm.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 80))
assert.equal((ctx.codexBridgeRemoves ?? []).length, 1, 'second click fires codexBridgeRemove')
assert.ok(document.body.textContent.includes('Codex 钩子桥已卸载'), 'codex remove note rendered')
assert.ok(document.body.textContent.includes('当前未安装 Codex 钩子桥'), 'codex banner back to the missing state')

// 15f. The 项目 tab: an initial sessionAdmin/list failure must surface in
// the tab. The mount-time list call used to swallow every error with an
// empty .catch, leaving the session dropdown silently unpopulated.
ctx.sessionListFail = '注入：列表服务不可用'
await act(async () => {
  button('项目').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 60))
assert.ok(document.body.textContent.includes('注入：列表服务不可用'), 'project tab surfaces the session-list load error')
ctx.sessionListFail = undefined
await act(async () => { commandHookRoot.unmount() })
host.remove()

console.log('self-check OK: bundle load, slot registration, unified css injection, tab switching, data render, plugin remove confirm, session delete confirm, group collapse/expand-all, bulk delete (projection + per-directory) with live-close routing, sidebar context menus, menu-delete two-step confirm + ambiguity refusal, archived-sessions merge (inject/switch-away/close) + no-official-page fallback, MCP editor save flow, headers editing, reconnect toggle, env semicolon round-trip, skills roster + text filter, web-search provider config editor, one-definition-per-component CSS scopes')
