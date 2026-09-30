/**
 * The admin panels this plugin can register, and the three states a deployment
 * may assign each of them (Phase E3).
 *
 * ONE list, imported by both halves: the host validates `config.panels` against it
 * (an unknown id must fail the mount, not sit inert) and the browser half asserts
 * its coverage table covers exactly these ids. The client bundle inlines this file,
 * so it stays free of Node imports.
 */

/** The panel ids, in the order the docs list them. */
export const PANEL_IDS = Object.freeze([
  'extensions',   // 插件管理（官方已覆盖时自动让位）
  'mcp',          // MCP 服务器
  'skills',       // 技能
  'subagents',    // 子智能体
  'commands',     // 命令
  'hooks',        // 钩子
  'sessions',     // Web 与会话
  'webSearch',    // Web 搜索
  'usage',        // 用量仪表盘
  'automation',   // 自动化（定时任务 / Webhook / 工作流）
  'todo',         // 待办清单
])

/**
 * The accepted per-panel states:
 *   - 'auto' (default) — let the official-coverage table decide (auto-yield);
 *   - 'on'   — register even when the official surface covers the panel;
 *   - 'off'  — never register (wins over every other signal, including the
 *              browser-side localStorage force).
 */
export const PANEL_STATES = Object.freeze(['auto', 'on', 'off'])

/**
 * Validate the `panels` config row.
 * @param {unknown} value - the raw `config.panels` value.
 * @returns {Record<string, string>} panel id → state (only explicit entries).
 * @throws {Error} for a non-object value, an unknown panel id, or an unknown state.
 */
export function resolvePanelStates(value) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('plugin-admin: config.panels must be a mapping of panel id → ' +
      PANEL_STATES.map((state) => JSON.stringify(state)).join(' / ') +
      ' (got ' + JSON.stringify(value) + ')')
  }
  // The shape checks above narrow `value` to the non-array object type, which is
  // not indexable; the JSON-decoded config row is a string-keyed bag, so name
  // that explicitly rather than casting per read.
  const row = /** @type {Record<string, unknown>} */ (value)
  /** @type {Record<string, string>} */
  const states = {}
  for (const key of Object.keys(row)) {
    if (!PANEL_IDS.includes(key)) {
      throw new Error('plugin-admin: config.panels.' + key + ' is not a panel id (known: ' + PANEL_IDS.join(', ') + ')')
    }
    const state = row[key]
    if (typeof state !== 'string' || !PANEL_STATES.includes(state)) {
      throw new Error('plugin-admin: config.panels.' + key + ' must be one of ' +
        PANEL_STATES.map((item) => JSON.stringify(item)).join(' / ') + ' (got ' + JSON.stringify(state) + ')')
    }
    states[key] = state
  }
  return states
}
