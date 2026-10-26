/**
 * Official-first coverage (Phase E1/E2, granularity revisited in v1.30).
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
 * GRANULARITY (why `scope` exists). The first cut of this table treated a hit
 * as "the whole panel is covered", which is only true when the official page
 * IS the equivalent management page. It is false wherever upstream shipped a
 * NARROWER surface than ours:
 *
 *   - `ui-schedule` is a task page; our 自动化 entry is three tabs (定时任务 /
 *     Webhook / 工作流). Yielding the entry took Webhook and 工作流 away — two
 *     surfaces upstream has NO page for at all.
 *   - `ui-settings-subagent` configures depth / capacity / model; our 子智能体
 *     entry authors named delegation instances, personas, tool fences and CLI
 *     backends. Different job, same neighbourhood.
 *   - `ui-settings-web-search` configures the official provider; our Web 搜索
 *     tab installs and switches providers (exa / perplexity).
 *
 * A hit on those therefore must not retire the panel. `scope` makes the
 * consequence explicit and reviewable, and docs/COMPAT.md renders the same
 * three values.
 *
 * Policy (chosen in IMPROVEMENT-PLAN.md): AUTO-YIELD, never a hard failure, and
 * never wider than the evidence. `dsh-admin-panels` in localStorage
 * (comma-separated panel ids) forces a panel back on for a user who prefers
 * ours.
 */

/**
 * What one coverage hit retires.
 *   - 'panel' — the official surface IS an equivalent management page: the
 *     whole panel stops registering.
 *   - 'tabs'  — the official surface covers the tabs named in `tabs` only; the
 *     panel still registers and its remaining tabs stay. `tabs` must list at
 *     least one id and must not list every tab (that would be 'panel').
 *   - 'none'  — the official surface exists but is not equivalent (or is not
 *     visible from the client at all): keep everything. The row still records
 *     the overlap so the next reader sees it was considered, not missed.
 */

/**
 * One coverage row. `detect` receives the plugin context and returns true when
 * the official surface is present. Rows whose probe is not implemented return
 * false (the panel stays) — that is deliberate: a panelled surface we cannot
 * see must never be treated as covered.
 *
 * Probes are slot-entry lookups against ids read from the upstream source in
 * the 0.2.1-rc.3 tree, never guessed. Five rows are probed today (extensions,
 * subagents, webSearch, automation, todo); the six remaining `return false`
 * rows have no client-side surface of their own to look for, and
 * docs/COMPAT.md explains why at each row.
 */
// One list for both halves (Phase E3): the host validates config.panels against it,
// the table below must cover exactly it. The bundle inlines the file.
import { PANEL_IDS as CONFIGURED_PANEL_IDS } from '../../lib/panel-ids.js'

export const NATIVE_COVERAGE = Object.freeze([
  Object.freeze({
    panel: 'extensions',
    label: '扩展插件',
    scope: 'panel',
    official: '插件侧边栏页 (ui-plugin-manager) + 插件列表页签 (ui-settings-plugin-inventory)',
    since: '0.1.7',
    // Two verified signals: ui-plugin-manager/src/client/index.ts:83 PANEL_ID =
    // 'plugins' registered on 'sidebar.panellist' (:167-173), and
    // ui-settings-plugin-inventory/src/client/index.ts:56-58 'settings.plugins.tab'
    // with id 'all'. Either proves the official plugin surface is mounted.
    // 'panel' because the official page installs / removes / enables / disables
    // bundles — the same four verbs this panel offers.
    signals: Object.freeze([['sidebar.panellist', 'plugins'], ['settings.plugins.tab', 'all']]),
    detect: function (/** @type {any} */ ctx) {
      return hasSlotEntry(ctx, 'sidebar.panellist', 'plugins') || hasSlotEntry(ctx, 'settings.plugins.tab', 'all')
    },
  }),
  Object.freeze({
    panel: 'mcp',
    label: 'MCP 服务器',
    scope: 'none',
    official: '无（仅宿主 mcp-client）',
    since: null,
    // No client surface to probe: the MCP client is a HOST-side plugin; upstream
    // ships no browser slot for its connections (packages/mcp has no src/client
    // half at all). Stays false.
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'skills',
    label: '技能',
    scope: 'none',
    official: 'ui-skill（/ 触发与调用卡片）；全量清单仍无官方页',
    since: null,
    // ui-skill contributes conversation-side trigger cards, not a settings or
    // sidebar entry; probing it would claim "covered" for a list page that does
    // not exist upstream. Stays false.
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'subagents',
    label: '子智能体',
    scope: 'none',
    official: 'ui-settings-subagent（深度/容量/模型）；编写侧仍无官方页',
    since: null,
    // Slot entry: ui-settings-subagent/src/client/index.ts:85-87 injects
    // 'plugins.item' and registers id 'subagent'. The registration is wrapped in
    // ctx.configForms.whileServed([...]) — it appears when the config form is
    // served, which may be after our apply.
    //
    // 'none', NOT 'panel': the official card edits recursion depth / concurrency
    // / model. This panel authors named delegation instances, personas, tool
    // fences and external CLI backends — upstream has no page for any of that,
    // so retiring the panel on the card's presence would delete the feature.
    signals: Object.freeze([['plugins.item', 'subagent']]),
    detect: function (/** @type {any} */ ctx) {
      return hasSlotEntry(ctx, 'plugins.item', 'subagent')
    },
  }),
  Object.freeze({
    panel: 'commands',
    label: '命令',
    scope: 'none',
    official: 'ui-commands（客户端命令 API，非文件化管理）',
    since: null,
    // ui-commands is a client API package (a service), not a panel: nothing to
    // find in a slot list. Stays false.
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'hooks',
    label: '钩子',
    scope: 'none',
    official: '无（宿主 hook 协议 + 两个桥包，均无 UI）',
    since: null,
    // Host protocol + bridge packages only, no browser UI (packages/hooks ships
    // lib/ only, no src/client). Stays false.
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'sessions',
    label: 'Web 与会话',
    scope: 'none',
    official: 'ui-workspace（浏览/归档/重命名/分叉）；批删/导出/体检仍无官方页',
    since: null,
    // ui-workspace's session actions are the row menu we now add entries to
    // (sidebar.workspaces.session.menu.item), not a competing list page — so
    // "covered" would be a false claim about bulk delete/export/inspection,
    // which have no official page. Stays false.
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'webSearch',
    label: 'Web 搜索',
    scope: 'none',
    official: 'ui-settings-web-search（官方 provider 的配置页）；provider 切换仍无官方页',
    since: null,
    // Slot entry: ui-settings-web-search/src/client/index.ts:64-65 registers
    // 'plugins.item' with id 'web-search' (same whileServed caveat as subagent).
    //
    // 'none', NOT 'panel': the official card edits the official provider's API
    // key / endpoint / per-search budget. This tab installs and switches between
    // exa / perplexity — no official page does that, so the tab stays.
    signals: Object.freeze([['plugins.item', 'web-search']]),
    detect: function (/** @type {any} */ ctx) {
      return hasSlotEntry(ctx, 'plugins.item', 'web-search')
    },
  }),
  Object.freeze({
    panel: 'usage',
    label: '用量仪表盘',
    scope: 'none',
    official: '无（dsh 的 token 记账只存在于会话日志）',
    since: null,
    // No upstream usage page in the baseline tree; nothing to probe. Stays false.
    detect: function () { return false },
  }),
  Object.freeze({
    panel: 'automation',
    label: '自动化',
    scope: 'tabs',
    // Only the cron tab. Webhook inbound rules and the workflow journal have no
    // official page anywhere in packages/client/** — retiring the whole entry
    // (the first cut did) silently deleted both.
    tabs: Object.freeze(['cron']),
    official: 'ui-schedule（宿主级任务页 + cron 编辑）；Webhook 入站与工作流仍无官方页',
    since: null,
    // Slot entry: ui-schedule/src/client/index.ts:67 PANEL_ID = 'schedules',
    // registered on 'sidebar.panellist' at :210-216 (plus a right-pane tab and a
    // 'main' entry). Detecting the sidebar entry is the stable signal.
    //
    // Why the cron tab is still a fair yield even though our cron accepts tasks
    // with no session binding and upstream's create() takes a sessionId: the
    // official catalog is HOST-level (schedule/src/index.ts:306-319 "Read all
    // active and inactive Host reminders") and ships a cron editor, so the two
    // overlap on the common case. Two schedulers firing the same task is worse
    // than one fewer tab, and `dsh-admin-panels` restores ours.
    signals: Object.freeze([['sidebar.panellist', 'schedules']]),
    detect: function (/** @type {any} */ ctx) {
      return hasSlotEntry(ctx, 'sidebar.panellist', 'schedules')
    },
  }),
  Object.freeze({
    panel: 'todo',
    label: '待办清单',
    scope: 'panel',
    official: 'ui-conversation TodoPanel（conversation.input.dock 的 todo 条）',
    since: '0.1.7',
    // 'panel': both are the same dock slot showing the same todo list; two of
    // them in one composer is the duplicate, not a missing feature.
    signals: Object.freeze([['conversation.input.dock', 'todo']]),
    detect: function (/** @type {any} */ ctx) {
      return hasSlotEntry(ctx, 'conversation.input.dock', 'todo')
    },
  }),
])

/** The panel ids a caller can name in `dsh-admin-panels` or `config.panels`.
 * @type {readonly string[]} */
export const PANEL_IDS = CONFIGURED_PANEL_IDS

// Fail loud at import when the table and the configurable set drift apart: the
// auto-yield table is what decides a panel's fate, so a missing row would silently
// turn an 'auto' panel into an always-registered one.
if (NATIVE_COVERAGE.map(function (row) { return row.panel }).join(',') !== PANEL_IDS.join(',')) {
  throw new Error('native-coverage: the coverage table must list exactly the configurable panels (' +
    PANEL_IDS.join(', ') + '), in that order')
}

// Fail loud on a malformed `scope`: a typo would otherwise fall through every
// branch of resolveNativeCoverage() and quietly keep a panel the table meant to
// retire (or retire one it meant to keep). A 'tabs' row must name at least one
// tab, and must not claim every tab — that is what 'panel' means.
//
// Typed as a widened row rather than the frozen literal tuple TS infers from
// Object.freeze: on the literal type every `scope` is already one of the three
// strings, so the guard below narrows to `never` and the reads fail to compile.
/** @type {ReadonlyArray<{
 *   panel: string,
 *   scope: string,
 *   tabs?: readonly string[],
 *   signals?: readonly (readonly string[])[],
 *   detect: (ctx: any) => boolean,
 * }>} */
const COVERAGE_ROWS = NATIVE_COVERAGE
for (const row of COVERAGE_ROWS) {
  if (row.scope !== 'panel' && row.scope !== 'tabs' && row.scope !== 'none') {
    throw new Error('native-coverage: row "' + row.panel + '" has an unknown scope ' + JSON.stringify(row.scope)
      + " (expected 'panel' | 'tabs' | 'none')")
  }
  if (row.scope !== 'tabs') continue
  if (!Array.isArray(row.tabs) || row.tabs.length === 0) {
    throw new Error('native-coverage: row "' + row.panel + '" is scope \'tabs\' but names no tabs')
  }
}

// `signals` is what makes the coverage verdict RE-DERIVABLE: impl.js subscribes
// to exactly these slot keys and recomputes when one is declared. A row whose
// probe reads a slot it does not name would be frozen at apply() time again —
// the very bug v1.30.1 fixes — so a mismatch fails loud here instead of
// degrading silently. Rows that probe nothing (`return false`) need no signals.
for (const row of COVERAGE_ROWS) {
  const named = row.signals
  const probesNothing = row.detect.toString().includes('return false')
  if (probesNothing) {
    if (named !== undefined && named.length > 0) {
      throw new Error('native-coverage: row "' + row.panel + '" probes nothing but names signals — the subscription would fire for no reason')
    }
    continue
  }
  if (!Array.isArray(named) || named.length === 0) {
    throw new Error('native-coverage: row "' + row.panel + '" has a real probe but names no signals, '
      + 'so a late official declaration could never be observed (see the TIMING ASSUMPTION note)')
  }
  for (const entry of named) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error('native-coverage: row "' + row.panel + '" has a malformed signal ' + JSON.stringify(entry))
    }
    if (!row.detect.toString().includes(entry[0])) {
      throw new Error('native-coverage: row "' + row.panel + '" names slot "' + entry[0] + '" but its detect() never reads it')
    }
  }
}

/**
 * The slot keys whose declaration can change a coverage verdict.
 *
 * impl.js subscribes to these and re-runs {@link resolveNativeCoverage} when one
 * arrives, which is what turns the old apply()-time snapshot into a live
 * decision. Sorted and de-duplicated so the subscription set is stable.
 * @type {readonly string[]}
 */
export const COVERAGE_SLOT_KEYS = Object.freeze([...new Set(
  COVERAGE_ROWS.flatMap((row) => (Array.isArray(row.signals) ? row.signals.map((entry) => entry[0]) : [])),
)].sort())

/**
 * Whether one slot list already carries an entry with this id. Tolerates a
 * host without `slots.entries` (older shells, the test harness): an unreadable
 * list reports "not covered", which keeps the panel — never the reverse.
 *
 * TIMING: this probe reads whatever the slot list holds RIGHT NOW, so a single
 * call is a snapshot — an official panel that declares after this client's
 * apply is invisible to it. That is why a snapshot must never be the final
 * verdict (v1.30.1): impl.js subscribes to {@link COVERAGE_SLOT_KEYS} and calls
 * {@link resolveNativeCoverage} again on every relevant declaration, so a late
 * official panel is observed in the same session instead of after a reload.
 * Each row's `signals` field is what makes that subscription complete — the
 * import-time guard above rejects a row whose probe reads a slot it does not
 * name, because such a row would silently be frozen at apply() time.
 * Operators can force any panel via localStorage `dsh-admin-panels`.
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
  /** @type {Record<string, boolean>} */
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
 * Resolve which panels (and which tabs inside them) to keep for this mount.
 * @param {Record<string, any>} ctx - the client plugin context.
 * @returns {{
 *   active: Record<string, boolean>,
 *   yielded: Array<Record<string, any>>,
 *   hiddenTabs: Record<string, string[]>,
 *   notes: Array<Record<string, any>>,
 * }}
 *   `active` is keyed by panel id (absent = active);
 *   `yielded` lists panels the official surfaces replaced outright;
 *   `hiddenTabs` is panel id → tab ids the official surface took over (the
 *   panel itself stays registered);
 *   `notes` lists the overlapping-but-kept panels, for the mount log — the
 *   panel is still there, the reader just learns why it might look duplicated.
 */
export function resolveNativeCoverage(ctx) {
  var forced = forcedPanels()
  /** @type {Record<string, boolean>} */
  var active = {}
  /** @type {Array<Record<string, any>>} */
  var yielded = []
  /** @type {Record<string, string[]>} */
  var hiddenTabs = {}
  /** @type {Array<Record<string, any>>} */
  var notes = []
  for (var i = 0; i < NATIVE_COVERAGE.length; i += 1) {
    var row = NATIVE_COVERAGE[i]
    active[row.panel] = true
    var covered = false
    try { covered = row.detect(ctx) === true } catch (error) { covered = false }
    if (!covered) continue
    // The force switch is per panel and wins over every scope: a user who wants
    // our cron tab back gets it, tab granularity or not.
    if (forced[row.panel] === true) { notes.push(row); continue }
    if (row.scope === 'panel') {
      active[row.panel] = false
      yielded.push(row)
      continue
    }
    if (row.scope === 'tabs') {
      hiddenTabs[row.panel] = row.tabs.slice()
      notes.push(row)
      continue
    }
    // scope 'none': the official surface is not equivalent, so nothing retires.
    notes.push(row)
  }
  return { active: active, yielded: yielded, hiddenTabs: hiddenTabs, notes: notes }
}
