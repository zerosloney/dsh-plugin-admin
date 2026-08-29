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
// checkout (local dev, DSH_HARNESS_ROOT override) or from this repo's own
// devDependencies (CI / npm test). The harness path is the primary source
// when it exists so local runs always exercise the exact platform the dsh
// shell renders with; CI installs the same versions as devDependencies and
// falls back automatically.
const harnessRoot = process.env.DSH_HARNESS_ROOT
  || 'E:/Demo/cli-tools/deepseek-harness'
const harnessPkg = join(harnessRoot, 'package.json')
const harnessWeb = join(harnessRoot, 'packages/client/web/node_modules')
let harnessReq = null
try {
  harnessReq = createRequire(harnessPkg)
  // Prove the harness checkout actually carries jsdom before trusting it.
  harnessReq('jsdom')
} catch {
  harnessReq = null
}
const { JSDOM } = harnessReq ? harnessReq('jsdom') : req('jsdom')
const React = harnessReq ? req(`${harnessWeb}/react`) : req('react')
const { createRoot } = harnessReq ? req(`${harnessWeb}/react-dom/client`) : req('react-dom/client')
const act = React.act ?? (harnessReq ? req(`${harnessWeb}/react-dom/test-utils`).act : req('react-dom/test-utils').act)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
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

const injectedSections = []
const registeredSections = []
const ctx = {
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
          return { ok: true, value: { sessions: ctx.sessionListOverride ?? mockSessions, workspaces: mockWorkspaces } }
        }
        if (method === 'sessionAdmin/deleteSession') {
          ctx.deletes = ctx.deletes ?? []
          ctx.deletes.push(payload.args.sessionId)
          return { ok: true, value: { deleted: payload.args.sessionId } }
        }
        if (method === 'mcpAdmin/list') {
          return { ok: true, value: { entries: ctx.mcpEntries ?? mockMcpEntries } }
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
// Four slot contributions: the 扩展插件 tab inside the shell-owned 插件
// section, plus the standalone MCP服务器 / 子智能体 / 历史会话 settings sections.
assert.equal(injectedSections.length, 4, 'four slot contributions injected')
assert.deepEqual(
  injectedSections.map((i) => i.key).sort(),
  ['settings.plugins.tab', 'settings.section', 'settings.section', 'settings.section'],
  'injections wait on settings.section (×3) and settings.plugins.tab',
)
injectedSections.forEach((i) => i.callback())
assert.equal(registeredSections.length, 4, 'four registrations: extensions tab + MCP + subagents + session history')
const byId = {}
for (const entry of registeredSections) byId[entry.options.id] = entry
assert.ok(byId.extensions && byId['mcp-servers'] && byId['subagent-admin'] && byId['session-history'], 'expected registration ids present')

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

const historySection = byId['session-history']
assert.equal(historySection.options.name, 'settings.section')
assert.equal(historySection.options.order, 100, '历史会话 sorts last in the settings nav')
assert.equal(historySection.options.label, '历史会话', 'session history section label')
const historyFace = historySection.options.inject()
assert.equal(typeof historyFace.call, 'function', 'session history inject face carries the RPC call')
assert.ok('refreshSessions' in historyFace, 'session history inject face carries the sidebar refresh hook')

// 4. Style injection: the section stylesheets land in <head>.
assert.ok(
  document.querySelector('style[data-plugin-css="dsh-plugin-admin/unified-section.css"]'),
  'unified section css injected',
)
assert.ok(
  document.querySelector('style[data-dsh-sa-styles]'),
  'subagent section css injected',
)

// Mount helper: render one registered section into a fresh host div. Text
// assertions run against document.body, so exactly one panel stays mounted
// at a time; each panel is unmounted before the next one mounts.
let host = null
async function mountSection(section) {
  host = document.body.appendChild(document.createElement('div'))
  let root
  await act(async () => {
    root = createRoot(host)
    root.render(React.createElement(section.component, section.options.inject()))
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
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
assert.equal(ctx.installCalls[0], 'dsh-remote-tool@latest', 'update sends name@latest spec')
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
const sessionsRoot = await mountSection(historySection)

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
assert.ok(text.includes('全部 (3)'), 'session filter pill count')
assert.ok(text.includes('会话修改即时同步到侧边栏'), 'session hint footer')

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

// 13. Test MCP headers editing for streamable-http transport: add a new entry
// with headers, save, and verify the upsert carries the headers.
await act(async () => {
  button('添加服务器').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await new Promise((resolve) => setTimeout(resolve, 20))
assert.ok(document.body.textContent.includes('添加 MCP 服务器'), 'add server form opens')
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

console.log('self-check OK: bundle load, slot registration, unified css injection, tab switching, data render, plugin remove confirm, session delete confirm, sidebar context menus, menu-delete two-step confirm + ambiguity refusal, MCP editor save flow, headers editing, reconnect toggle, env semicolon round-trip')
