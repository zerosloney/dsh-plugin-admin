/**
 * Official-first coverage (Phase E1/E2).
 *
 * The plugin's opening thesis was "fill what dsh lacks". Upstream keeps
 * filling: 0.1.7 ships a plugin manager page, a plugin inventory, a schedule
 * panel, subagent settings, a workflow-run node. A panel that duplicates one
 * of those is not a feature any more — it is a second place to look.
 *
 * This module is the table that decides which of our panels still has a job.
 * Each row names the official surface that would cover the panel and the
 * CLIENT-SIDE signal that proves it is mounted (the browser half has no access
 * to the host's config row, so detection is limited to what the shell exposes
 * on the client Context: slot entries and services).
 *
 * Policy (chosen in IMPROVEMENT-PLAN.md): AUTO-YIELD, never a hard failure. A
 * covered panel simply does not register its slot; `dsh-admin-panels` in
 * localStorage (comma-separated panel ids) forces panels back on for a user
 * who prefers ours, and docs/COMPAT.md renders this same table.
 */

/**
 * One coverage row. `detect` receives the plugin context and returns true when
 * the official surface is present. Rows whose probe is not implemented yet
 * return false (the panel stays) — that is deliberate: a panelled surface we
 * cannot see must never be treated as covered.
 */
export const NATIVE_COVERAGE = Object.freeze([
  Object.freeze({
    panel: 'extensions',
    label: '扩展插件',
    official: '插件侧边栏页 (ui-plugin-manager) + 插件列表页签 (ui-settings-plugin-inventory)',
    since: '0.1.7',
    detect: function (ctx) {
      return hasSlotEntry(ctx, 'sidebar.panellist', 'plugins') || hasSlotEntry(ctx, 'settings.plugins.tab', 'all')
    },
  }),
  Object.freeze({
    panel: 'mcp',
    label: 'MCP 服务器',
    official: '无（仅宿主 mcp-client）',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'skills',
    label: '技能',
    official: 'ui-skill（/ 触发与调用卡片）；全量清单仍无官方页',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'subagents',
    label: '子智能体',
    official: 'ui-settings-subagent（深度/容量/模型）；编写侧仍无官方页',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'commands',
    label: '命令',
    official: 'ui-commands（客户端命令 API，非文件化管理）',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'hooks',
    label: '钩子',
    official: '无（宿主 hook 协议 + 两个桥包，均无 UI）',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'sessions',
    label: 'Web 与会话',
    official: 'ui-workspace（浏览/归档/重命名/分叉）；批删/导出/体检仍无官方页',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'webSearch',
    label: 'Web 搜索',
    official: 'ui-settings-web-search（官方 provider 的配置页）；provider 切换仍无官方页',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'usage',
    label: '用量仪表盘',
    official: '无（dsh 的 token 记账只存在于会话日志）',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'automation',
    label: '自动化',
    official: 'ui-schedule（会话级任务）；宿主级 cron 与 Webhook 入站仍无官方页',
    since: null,
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'todo',
    label: '待办清单',
    official: 'ui-conversation TodoPanel（conversation.input.dock 的 todo 条）',
    since: '0.1.7',
    detect: function () { return false },   // overlay, not a duplicate: ours replaces the strip while it has data
  }),
])

/** The panel ids a caller can name in `dsh-admin-panels`.
 * @type {readonly string[]} */
export const PANEL_IDS = Object.freeze(NATIVE_COVERAGE.map(function (row) { return row.panel }))

/**
 * Whether one slot list already carries an entry with this id. Tolerates a
 * host without `slots.entries` (older shells, the test harness): an unreadable
 * list reports "not covered", which keeps the panel — never the reverse.
 * @param {Record<string, any>} ctx - the client plugin context.
 * @param {string} name - the slot name.
 * @param {string} id - the entry id to look for.
 * @returns {boolean}
 */
function hasSlotEntry(ctx, name, id) {
  try {
    if (ctx.slots === undefined || ctx.slots === null || typeof ctx.slots.entries !== 'function') return false
    var entries = ctx.slots.entries(name)
    if (!Array.isArray(entries)) return false
    for (var i = 0; i < entries.length; i += 1) {
      var options = entries[i] && entries[i].options
      if (options !== undefined && options !== null && options.id === id) return true
    }
    return false
  } catch (error) {
    return false
  }
}

/**
 * Panels the user forced ON, overriding the auto-yield (localStorage
 * `dsh-admin-panels`, comma-separated). Unknown names are ignored.
 * @returns {Record<string, boolean>} panel id → forced.
 */
export function forcedPanels() {
  var forced = {}
  try {
    var raw = window.localStorage.getItem('dsh-admin-panels')
    if (typeof raw !== 'string' || raw.trim() === '') return forced
    var names = raw.split(',')
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i].trim()
      if (PANEL_IDS.indexOf(name) !== -1) forced[name] = true
    }
  } catch (error) { /* private-mode storage: nothing is forced */ }
  return forced
}

/**
 * Resolve which panels to keep for this mount.
 * @param {Record<string, any>} ctx - the client plugin context.
 * @returns {{ active: Record<string, boolean>, yielded: Array<Record<string, any>> }}
 *   `active` is keyed by panel id (absent = active), `yielded` lists what the
 *   official surfaces took over (for the mount log and the harness).
 */
export function resolveNativeCoverage(ctx) {
  var forced = forcedPanels()
  var active = {}
  var yielded = []
  for (var i = 0; i < NATIVE_COVERAGE.length; i += 1) {
    var row = NATIVE_COVERAGE[i]
    active[row.panel] = true
    if (forced[row.panel] === true) continue
    var covered = false
    try { covered = row.detect(ctx) === true } catch (error) { covered = false }
    if (covered) { active[row.panel] = false; yielded.push(row) }
  }
  return { active: active, yielded: yielded }
}
