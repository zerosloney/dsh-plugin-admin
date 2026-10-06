window.__ModuleLoader__.load({ id: 'dsh-plugin-admin', chunk: 'client.panels.js', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/panels/index.js
var index_exports = {};
__export(index_exports, {
  AutomationSection: () => AutomationSection,
  ChCommandsSection: () => ChCommandsSection,
  ChHooksSection: () => ChHooksSection,
  McpSection: () => McpSection,
  PluginsSection: () => PluginsSection,
  SessionsSection: () => SessionsSection,
  SkillsSection: () => SkillsSection,
  SubagentAdminSection: () => SubagentAdminSection,
  TodoAdminDock: () => TodoAdminDock,
  UsageDashboardSection: () => UsageDashboardSection,
  WebSessionsSection: () => WebSessionsSection,
  WorkflowSection: () => WorkflowSection,
  WorkspacesSection: () => WorkspacesSection,
  configure: () => configure
});
module.exports = __toCommonJS(index_exports);

// src/client/panels/context.js
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/styles.js
var CSS_TEXT = [
  "@keyframes dsh-admin-spin { to { transform: rotate(360deg); } }",
  "@keyframes dsh-admin-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.85); } }",
  // Root viewport: height-bounded AND scrollable (overflow-y:auto, not the
  // old overflow:hidden) — tall panels like the 用量仪表盘 (KPI grid + charts
  // + insights stack far past one dialog) must scroll to their tail, not clip.
  "[data-dsh-admin-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); max-height: calc(100vh - 140px); overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)) transparent; }",
  "[data-dsh-admin-section] *, [data-dsh-sa-section] *, [data-cha-section] *, [data-dsh-admin-todo] * { box-sizing: border-box; }",
  "[data-dsh-admin-section] .toolbar, [data-dsh-sa-section] .toolbar, [data-cha-section] .toolbar { display: flex; gap: 8px; align-items: center; padding: 10px 20px 10px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); box-shadow: 0 1px 2px rgba(0,0,0,0.02); }",
  // Phase B3e follow-up: the workflow fields are the official Input now, so the
  // width/margin their inline style used to carry lives here (the atom's wrapper is
  // inline-flex and would otherwise shrink to content).
  "[data-dsh-admin-section] .wf-input { display: flex; width: 100%; margin-bottom: 8px; }",
  "[data-dsh-admin-section] .toolbar .input { height: 32px; padding: 0 12px; border-radius: 8px; border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); }",
  "[data-dsh-admin-section] .search-wrap, [data-dsh-sa-section] .search-wrap { flex: 1.6; min-width: 0; position: relative; display: flex; align-items: center; height: 32px; }",
  "[data-dsh-admin-section] .search-wrap .input, [data-dsh-sa-section] .search-wrap .input { flex: 1; min-width: 0; padding-left: 30px; font-size: 13px; }",
  "[data-dsh-admin-section] .session-search { flex: 1; height: 32px; }",
  "[data-dsh-admin-section] .session-search .input { height: 32px; padding: 0 12px 0 30px; font-size: 13px; border-radius: 8px; border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); }",
  "[data-dsh-admin-section] .install-wrap { flex: 1; min-width: 0; display: flex; align-items: center; height: 32px; }",
  "[data-dsh-admin-section] .install-wrap .input { flex: 1; min-width: 0; font-size: 13px; border-radius: 8px; border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); }",
  "[data-dsh-admin-section] .search-icon, [data-dsh-sa-section] .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; opacity: 0.7; pointer-events: none; z-index: 1; }",
  "[data-dsh-admin-section] .input, [data-dsh-sa-section] .input, [data-cha-section] .input { width: 100%; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); background: var(--dsw-alias-bg-base, transparent); color: inherit; font: inherit; outline: none; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; }",
  "[data-dsh-admin-section] .input:hover, [data-dsh-sa-section] .input:hover, [data-cha-section] .input:hover { border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); }",
  "[data-dsh-admin-section] .input:focus, [data-dsh-sa-section] .input:focus, [data-cha-section] .input:focus { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }",
  // Dropdowns share the .input chrome but lose the native widget: one chevron,
  // ellipsis overflow and a pointer cursor — the same face for every select
  // across the admin, sub-agent and command-hook panels.
  '[data-dsh-admin-section] select.input, [data-dsh-sa-section] select.input, [data-cha-section] select.input { appearance: none; -webkit-appearance: none; padding-right: 30px; cursor: pointer; text-overflow: ellipsis; background-image: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2710%27%20height=%276%27%20viewBox=%270%200%2010%206%27%3E%3Cpath%20d=%27M1%201l4%204%204-4%27%20stroke=%27%239aa0a6%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; }',
  // The popup list itself is native, but option colors still follow the theme.
  "[data-dsh-admin-section] select.input option, [data-dsh-sa-section] select.input option, [data-cha-section] select.input option { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary, #222); }",
  // Horizontal inset matched to the toolbar's (left = the toolbar's 10px, so
  // the pills line up with the search box) and to the LIST's content inset on
  // the right (scrollbar gutter 10 + list padding 4 + group-header padding 6),
  // so the tail actions, the toolbar's buttons and every directory's button
  // share one right edge.
  "[data-dsh-admin-section] .filter-bar { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; padding: 0 0 0 10px; }",
  // The injected archived-sessions panel renders as ONE framed card on the
  // host page; the flex gap on .session-panel provides the vertical rhythm.
  "[data-dsh-admin-section] .session-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }",
  // Inside that card the search row is a plain row, not a nested box.
  "[data-dsh-admin-section] .session-panel .toolbar { border: none; border-radius: 0; background: transparent; padding: 0; }",
  // The filter bar's tail actions stay one group: `margin-left: auto` pushes
  // the whole cluster right, and because it is a single flex item it never
  // splits across the wrap (the bare buttons used to strand 删除当前 alone on
  // a second line while 全部展开 sat at the far right of the first).
  "[data-dsh-admin-section] .filter-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }",
  // 选中胶囊：文字用主题自适应的 label-primary（浅 15:1 / 深 15:1），蓝色只留在
  // 底色与描边上——原来的蓝色文字只有 3.4:1，11px 下不达标。
  // 面板内的行内代码统一成一套：宿主对裸 <code> 的着色只有 3.7:1，且各面板不一致。
  "[data-dsh-admin-section] code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace); font-size: 0.94em; padding: 1px 5px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.2)); color: var(--dsw-alias-label-primary, #222); }",
  // 主按钮填充用 blue-600（白字 5.2:1）而非 blue-500（白字 3.7:1，达不到正文 AA）。
  // hover 往深走而不是往浅走：浅色 hover 会把白字压到 2.8:1。
  "[data-dsh-admin-section] .danger, [data-dsh-sa-section] .danger, [data-cha-section] .danger { color: var(--dsw-alias-state-error-primary, #dc2626); border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); }",
  // Outline-danger buttons fill softly on hover so the red stays quiet at
  // rest but the affordance is obvious before the click.
  "[data-dsh-admin-section] .danger:hover:not(:disabled), [data-dsh-sa-section] .danger:hover:not(:disabled), [data-cha-section] .danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.08); border-color: rgba(220, 38, 38, 0.45); }",
  "[data-dsh-admin-section] .danger:hover:not(:disabled), [data-dsh-sa-section] .danger:hover:not(:disabled), [data-cha-section] .danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.1)); border-color: rgba(220,38,38,0.35); color: #b91c1c; }",
  "[data-dsh-admin-section] .danger-solid, [data-dsh-sa-section] .danger-solid { background: #b91c1c; color: #fff; border-color: transparent; }",
  "[data-dsh-admin-section] .danger-solid:hover:not(:disabled) { background: #b91c1c; color: #fff; }",
  "[data-dsh-admin-section] .danger-solid:active:not(:disabled) { background: #991b1b; color: #fff; }",
  // Plugin grid (扩展插件) card buttons sit on their own row; keep them
  // compact so three buttons fit a half-width card without crowding.
  // Extra-small: the filter bar's tail actions, sized to the pill row's own
  // weight (pills are 21px tall at 11px type) so the bar reads as one line.
  "[data-dsh-admin-section] .spinner, [data-dsh-sa-section] .spinner { width: 12px; height: 12px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: dsh-admin-spin 0.7s linear infinite; display: inline-block; flex: none; }",
  "[data-dsh-admin-section] .list, [data-dsh-sa-section] .list, [data-cha-section] .list { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; max-height: 560px; overflow-y: auto; padding: 2px 4px 2px 2px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)) transparent; scrollbar-gutter: stable; }",
  "[data-dsh-admin-section] .list.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-content: start; }",
  "[data-dsh-admin-section] .list.grid2 .empty { grid-column: 1 / -1; }",
  "[data-dsh-admin-section] .list.grid2 .card { cursor: pointer; }",
  "[data-dsh-admin-section] .list.grid2 .card:hover { transform: none; border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); box-shadow: none; }",
  "[data-dsh-admin-section] .list::-webkit-scrollbar { width: 6px; }",
  "[data-dsh-admin-section] .list::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); }",
  "[data-dsh-admin-section] .session-group { display: flex; flex-direction: column; gap: 6px; }",
  "[data-dsh-admin-section] .group-header { display: flex; align-items: center; gap: 8px; padding: 9px 12px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); box-shadow: 0 1px 2px rgba(0,0,0,0.02); margin-bottom: 6px; }",
  "[data-dsh-admin-section] .group-header:first-child { margin-top: 2px; }",
  "[data-dsh-admin-section] .group-title { display: inline-flex; align-items: center; gap: 6px; }",
  "[data-dsh-admin-section] .group-count { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); color: var(--dsw-alias-label-secondary, #555); font-weight: 500; }",
  "[data-dsh-admin-section] .group-header .group-action { margin-left: auto; }",
  "[data-dsh-admin-section] .group-header .group-action + .group-action { margin-left: 0; }",
  "[data-dsh-admin-section] .group-path { font-family: monospace; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; text-align: right; }",
  // Collapsible directory groups: the header toggles its session list.
  "[data-dsh-admin-section] .group-header { cursor: pointer; user-select: none; transition: background 0.12s ease, border-color 0.12s ease; }",
  "[data-dsh-admin-section] .group-header:hover { border-color: var(--dsw-alias-border-l1, rgba(160,160,180,0.6)); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.18)); }",
  "[data-dsh-admin-section] .group-caret { flex: none; width: 12px; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); transition: transform 0.15s ease; }",
  "[data-dsh-admin-section] .group-header.collapsed { margin-bottom: 8px; }",
  "[data-dsh-admin-section] .group-collapsed-note { flex: none; font-size: 10px; line-height: 1; padding: 3px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.45)); color: var(--dsw-alias-label-secondary, #61666b); font-weight: 400; }",
  // Bulk-delete confirmation bar (reuses .confirm-bar's danger recipe).
  "[data-dsh-admin-section] .bulk-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(239,68,68,0.25); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.06)); font-size: 12px; }",
  "[data-dsh-admin-section] .bulk-bar .bulk-text { color: var(--dsw-alias-state-error-primary, #ef4444); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  "[data-dsh-admin-section] .bulk-bar .bulk-actions { display: flex; gap: 5px; flex: none; }",
  "[data-dsh-admin-section] .card, [data-dsh-sa-section] .card { display: flex; flex-direction: column; gap: 7px; padding: 12px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); background: var(--dsw-alias-bg-layer-2); box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }",
  // MCP editor: the section root is height-bounded, but the editor form must
  // not scroll the WHOLE panel — a tall form (e.g. with reconnect fields
  // expanded) would push its bottom action row, including the 保存 button,
  // out of view. The editor keeps its own scroll viewport instead.
  "[data-dsh-admin-section] .mcp-editor { flex: 1 1 auto; min-height: 0; max-height: calc(100vh - 200px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)) transparent; }",
  "[data-dsh-admin-section] .mcp-editor::-webkit-scrollbar { width: 6px; }",
  "[data-dsh-admin-section] .mcp-editor::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); }",
  // Keep the action row (取消 / 保存) pinned at the bottom of the editor card
  // and always within the scroll viewport, even on short windows.
  "[data-dsh-admin-section] .usage-dash { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--dsw-static-blue-500, #3b82f6); border-radius: 12px; background: var(--dsw-specific-tip, var(--dsw-alias-bg-layer-2)); box-shadow: 0 0 0 2px rgba(59,130,246,0.10); }",
  "[data-dsh-admin-section] .usage-chart { display: flex; align-items: flex-end; gap: 4px; height: 88px; padding: 4px 2px 0 2px; }",
  "[data-dsh-admin-section] .usage-bar-col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; }",
  "[data-dsh-admin-section] .usage-bar-label { font-size: 9px; color: var(--dsw-alias-label-secondary, #61666b); white-space: nowrap; }",
  "[data-dsh-admin-section] .usage-projects { display: flex; flex-direction: column; gap: 4px; }",
  "[data-dsh-admin-section] .usage-project { display: flex; align-items: center; gap: 8px; font-size: 12px; }",
  "[data-dsh-admin-section] .usage-project-name { flex: none; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-primary, #222); font-weight: 500; }",
  "[data-dsh-admin-section] .usage-project-track { flex: 1 1 auto; min-width: 0; height: 8px; border-radius: 99px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.35)); overflow: hidden; }",
  "[data-dsh-admin-section] .usage-project-fill { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--dsw-static-blue-400, #60a5fa), var(--dsw-static-blue-500, #3b82f6)); }",
  "[data-dsh-admin-section] .usage-project-num { flex: none; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-admin-section] .usage-insights { display: flex; flex-direction: column; gap: 4px; border-top: 1px dashed var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); padding-top: 8px; }",
  "[data-dsh-admin-section] .usage-insight { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-admin-section] .usage-empty { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }",
  // 用量仪表盘 —— 工业实用方向：发丝边框、等宽数字、状态色，成组而非散装控件。
  // 与宿主 dsh 的令牌体系保持一致（`--dsw-*`），不引入自有字体/配色：这是嵌在
  // 设置弹窗里的面板，旁边的每个面板都共用同一套字栈与语义色，自带展示字只会让
  // 它显得像外来物。
  "[data-dsh-admin-section] .usage-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 8px; }",
  "[data-dsh-admin-section] .usage-group { display: flex; align-items: center; gap: 6px; min-width: 0; }",
  "[data-dsh-admin-section] .usage-group-label { flex: none; font-size: 11px; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary, #61666b); }",
  // 筛选：标签与选择框焊成同一个控件（发丝边框 + 前缀段），窄屏换行时也不会被拆开。
  // 宽度按控件该有的尺寸给：基准 200px 让它能和日期那组同排（否则会摊成一条通栏长条），
  // 有余量时向右长到 360px 以容纳长项目名，真挤不下才整组换行。
  "[data-dsh-admin-section] .usage-filter { display: flex; flex-wrap: nowrap; align-items: stretch; flex: 1 1 200px; min-width: 170px; max-width: 360px; height: 30px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-base, transparent); }",
  "[data-dsh-admin-section] .usage-filter:hover { border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); }",
  "[data-dsh-admin-section] .usage-filter:focus-within { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }",
  "[data-dsh-admin-section] .usage-filter-label { flex: none; display: inline-flex; align-items: center; padding: 0 9px; font-size: 11px; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary, #61666b); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.18)); border-right: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.45)); }",
  '[data-dsh-admin-section] .usage-filter .usage-project-select { flex: 1 1 auto; width: auto; min-width: 0; max-width: 100%; height: 100%; border: none; border-radius: 0; background-color: transparent; appearance: none; -webkit-appearance: none; padding: 0 30px 0 10px; cursor: pointer; text-overflow: ellipsis; background-image: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2710%27%20height=%276%27%20viewBox=%270%200%2010%206%27%3E%3Cpath%20d=%27M1%201l4%204%204-4%27%20stroke=%27%239aa0a6%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; }',
  "[data-dsh-admin-section] .usage-filter .usage-project-select:focus { box-shadow: none; }",
  // 一次编排好的入场：每个面板的顶层块依次升起 6px，错峰 60ms（3–5 组）。只动
  // opacity/transform，reduce 下整段关闭。用量仪表盘内部还有一层自己的编排，两层
  // 叠成「先头部、再卡片、再分块」的节奏。
  "@keyframes dsh-panel-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }",
  "[data-dsh-admin-section] > *, [data-dsh-sa-section] > *, [data-cha-section] > * { animation: dsh-panel-rise 320ms cubic-bezier(0.16, 1, 0.3, 1) both; }",
  "[data-dsh-admin-section] > *:nth-child(2), [data-dsh-sa-section] > *:nth-child(2), [data-cha-section] > *:nth-child(2) { animation-delay: 60ms; }",
  "[data-dsh-admin-section] > *:nth-child(3), [data-dsh-sa-section] > *:nth-child(3), [data-cha-section] > *:nth-child(3) { animation-delay: 120ms; }",
  "[data-dsh-admin-section] > *:nth-child(4), [data-dsh-sa-section] > *:nth-child(4), [data-cha-section] > *:nth-child(4) { animation-delay: 180ms; }",
  "[data-dsh-admin-section] > *:nth-child(n+5), [data-dsh-sa-section] > *:nth-child(n+5), [data-cha-section] > *:nth-child(n+5) { animation-delay: 240ms; }",
  // 仪表盘内部沿用同一套 keyframes（头部已随面板入场），不再各留一份定义。
  "[data-dsh-admin-section] .usage-dash > * { animation: dsh-panel-rise 320ms cubic-bezier(0.16, 1, 0.3, 1) both; }",
  "[data-dsh-admin-section] .usage-dash > *:nth-child(2) { animation-delay: 60ms; }",
  "[data-dsh-admin-section] .usage-dash > *:nth-child(3) { animation-delay: 120ms; }",
  "[data-dsh-admin-section] .usage-dash > *:nth-child(4) { animation-delay: 180ms; }",
  "[data-dsh-admin-section] .usage-dash > *:nth-child(n+5) { animation-delay: 240ms; }",
  "@media (prefers-reduced-motion: reduce) { [data-dsh-admin-section] > *, [data-dsh-sa-section] > *, [data-cha-section] > *, [data-dsh-admin-section] .usage-dash > * { animation: none; } }",
  // 用量仪表盘 head：标题 + 弱化副标题 + 一个状态 chip（自动快照节奏）。
  // 状态用「圆点 + 文字」而非仅颜色，色盲用户也能读；节奏直接写在 chip 上。
  "[data-dsh-admin-section] .usage-head { flex-wrap: wrap; row-gap: 6px; }",
  "[data-dsh-admin-section] .usage-head .title { font-weight: 700; }",
  "[data-dsh-admin-section] .usage-head .spacer { flex: 1 1 auto; }",
  "[data-dsh-admin-section] .usage-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); }",
  "[data-dsh-admin-section] .usage-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; line-height: 1; padding: 4px 9px; border-radius: 99px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.45)); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.18)); color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; font-variant-numeric: tabular-nums; }",
  "[data-dsh-admin-section] .usage-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }",
  "[data-dsh-admin-section] .usage-chip .sep { opacity: 0.7; }",
  // 状态胶囊同样做成实心：`--dsw-alias-state-success-primary`(#22c55e) 当文字用只有
  // 2.3:1，且该 token 在浅/深两套主题下同值，靠 token 换色救不回来。实心填充与主题无关，
  // 白字稳定 >= 4.5:1。
  "[data-dsh-admin-section] .usage-chip.on { background: #15803d; border-color: transparent; color: #fff; }",
  "[data-dsh-admin-section] .usage-chip.off { background: #b45309; border-color: transparent; color: #fff; }",
  // 选择框本身不画边框（边框归 `.usage-filter` 那一圈），放不下时省略号收尾，
  // 完整值永远在 `title` 上——窄弹窗里 30 字的中文项目名不可能全塞下。
  "[data-dsh-admin-section] .usage-project-select { width: auto; min-width: 132px; max-width: 100%; flex: 1 1 auto; height: 30px; text-overflow: ellipsis; }",
  "[data-dsh-admin-section] .usage-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }",
  "[data-dsh-admin-section] .usage-kpi { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-bg-base, transparent); }",
  "[data-dsh-admin-section] .usage-kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }",
  "[data-dsh-admin-section] .usage-kpi-label { font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); }",
  "[data-dsh-admin-section] .usage-kpi-delta { font-size: 10px; font-variant-numeric: tabular-nums; }",
  "[data-dsh-admin-section] .usage-kpi-delta.up { color: var(--dsw-alias-state-success-primary, #16a34a); }",
  "[data-dsh-admin-section] .usage-kpi-delta.down { color: var(--dsw-alias-state-error-primary, #dc2626); }",
  "[data-dsh-admin-section] .usage-kpi-value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 20px; font-weight: 700; color: var(--dsw-alias-label-primary, #222); }",
  "[data-dsh-admin-section] .usage-kpi.accent .usage-kpi-value { color: var(--dsw-alias-state-business-primary, #4176e6); }",
  "[data-dsh-admin-section] .usage-dash-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }",
  "[data-dsh-admin-section] .usage-panel { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-bg-base, transparent); }",
  "[data-dsh-admin-section] .usage-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
  "[data-dsh-admin-section] .usage-panel-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); }",
  "[data-dsh-admin-section] .usage-legend { display: inline-flex; gap: 8px; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); }",
  "[data-dsh-admin-section] .usage-legend .lg { display: inline-flex; align-items: center; gap: 3px; }",
  '[data-dsh-admin-section] .usage-legend .lg::before { content: ""; width: 8px; height: 8px; border-radius: 2px; display: inline-block; }',
  "[data-dsh-admin-section] .usage-legend .lg-out::before { background: var(--dsw-static-blue-500, #3b82f6); }",
  "[data-dsh-admin-section] .usage-legend .lg-in::before { background: var(--dsw-static-blue-300, #93c5fd); }",
  "[data-dsh-admin-section] .usage-legend .lg-cache::before { background: var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); }",
  "[data-dsh-admin-section] .usage-chart { display: flex; align-items: flex-end; gap: 3px; height: 110px; }",
  "[data-dsh-admin-section] .usage-bar-col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; }",
  "[data-dsh-admin-section] .usage-bar-stack { display: flex; flex-direction: column; justify-content: flex-end; width: 100%; max-width: 30px; height: 100%; }",
  "[data-dsh-admin-section] .usage-bar-stack .seg { display: block; width: 100%; }",
  "[data-dsh-admin-section] .usage-bar-stack .seg-out { background: var(--dsw-static-blue-500, #3b82f6); border-radius: 2px 2px 0 0; }",
  "[data-dsh-admin-section] .usage-bar-stack .seg-in { background: var(--dsw-static-blue-300, #93c5fd); }",
  "[data-dsh-admin-section] .usage-bar-stack .seg-cache { background: var(--dsw-alias-border-l2, rgba(200,200,210,0.45)); border-radius: 0 0 2px 2px; }",
  "[data-dsh-admin-section] .usage-bar-label { font-size: 9px; color: var(--dsw-alias-label-secondary, #61666b); white-space: nowrap; }",
  "[data-dsh-admin-section] .usage-heat { display: flex; flex-direction: column; gap: 3px; }",
  "[data-dsh-admin-section] .heat-row { display: flex; align-items: center; gap: 6px; }",
  "[data-dsh-admin-section] .heat-row-label { flex: none; width: 30px; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); }",
  "[data-dsh-admin-section] .heat-cells { display: flex; gap: 3px; flex: 1; }",
  "[data-dsh-admin-section] .heat-cell { flex: 1 1 0; aspect-ratio: 1; border-radius: 3px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.2)); }",
  "[data-dsh-admin-section] .heat-cell.lvl1 { background: rgba(59,130,246,0.15); }",
  "[data-dsh-admin-section] .heat-cell.lvl2 { background: rgba(59,130,246,0.3); }",
  "[data-dsh-admin-section] .heat-cell.lvl3 { background: rgba(59,130,246,0.5); }",
  "[data-dsh-admin-section] .heat-cell.lvl4 { background: rgba(59,130,246,0.75); }",
  "[data-dsh-admin-section] .heat-cell.lvl5 { background: var(--dsw-static-blue-500, #3b82f6); }",
  "[data-dsh-admin-section] .heat-hours { display: flex; justify-content: space-between; padding-left: 36px; font-size: 9px; color: var(--dsw-alias-label-secondary, #61666b); }",
  "[data-dsh-admin-section] .usage-empty { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }",
  "[data-dsh-admin-section] .usage-strip { display: flex; gap: 12px; align-items: center; padding: 7px 12px; border: 1px dashed var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary, #555); background: var(--dsw-alias-bg-base, transparent); }",
  "[data-dsh-admin-section] .usage-strip .usage-num { font-weight: 600; color: var(--dsw-alias-label-primary, #222); }",
  "[data-dsh-admin-section] .pin-active { color: var(--dsw-static-blue-500, #3b82f6); border-color: currentColor; font-weight: 600; }",
  "[data-dsh-admin-section] .mcp-playground { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 2px rgba(59,130,246,0.12); }",
  "[data-dsh-admin-section] .mcp-playground textarea.input { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; resize: vertical; }",
  "[data-dsh-admin-section] .mcp-playground-out { margin: 6px 0 0 0; padding: 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 8px; background: var(--dsw-alias-bg-base, transparent); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; color: var(--dsw-alias-label-primary, #222); }",
  "[data-dsh-admin-section] .mcp-editor .card-actions { position: sticky; bottom: 0; background: var(--dsw-alias-bg-layer-2); padding-top: 10px; margin-top: 4px; }",
  // When the editor is open alongside the list (editing an existing entry), the
  // list must not compete for the bounded section height or the editor's 保存
  // button gets pushed below the clipped region. Let the list shrink to its
  // content instead of claiming flex space.
  "[data-dsh-admin-section].mcp-editor-open .list { flex: 0 1 auto; max-height: 140px; }",
  "[data-dsh-admin-section] .card:hover, [data-dsh-sa-section] .card:hover { transform: translateY(-1px); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }",
  "[data-dsh-admin-section] .card-header, [data-dsh-sa-section] .card-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }",
  "[data-dsh-admin-section] .card-title, [data-dsh-sa-section] .card-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; flex-wrap: wrap; align-items: center; gap: 7px; min-width: 0; flex: 1; }",
  "[data-dsh-admin-section] .card-title-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }",
  "[data-dsh-admin-section] .card-summary { display: flex; align-items: flex-start; gap: 6px; padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); border-left: 2px solid var(--dsw-static-blue-500, #3b82f6); font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #555); margin-top: 1px; margin-bottom: 1px; }",
  "[data-dsh-admin-section] .summary-icon { font-size: 11px; line-height: 1.45; flex: none; opacity: 0.85; }",
  "[data-dsh-admin-section] .summary-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; }",
  "[data-dsh-admin-section] .card-sub, [data-dsh-sa-section] .card-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
  "[data-dsh-admin-section] .card-sub-item { display: inline-flex; align-items: center; gap: 3px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  "[data-dsh-admin-section] .card-actions, [data-dsh-sa-section] .card-actions { display: flex; gap: 5px; align-items: center; flex: none; }",
  "[data-dsh-admin-section] .tag, [data-dsh-sa-section] .tag, [data-cha-section] .tag { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; flex: none; display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-admin-section] .tag.plugin { background: #15803d; color: #fff; }",
  "[data-dsh-admin-section] .tag.local { background: #1d4ed8; color: #fff; }",
  "[data-dsh-admin-section] .tag.update { background: #b45309; color: #fff; font-weight: 600; }",
  "[data-dsh-admin-section] .tag.update-error { background: #b91c1c; color: #fff; }",
  "[data-dsh-admin-section] .plugin-path { font-family: monospace; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 4px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); }",
  "[data-dsh-admin-section] .tag.version { font-family: monospace; }",
  "[data-dsh-admin-section] .tag.live, [data-dsh-sa-section] .tag.live { background: #15803d; color: #fff; font-weight: 600; }",
  "[data-dsh-admin-section] .tag.archived { background: #b45309; color: #fff; }",
  "[data-dsh-admin-section] .tag.turns { background: #1d4ed8; color: #fff; font-weight: 500; }",
  "[data-dsh-admin-section] .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary, #999); }",
  "[data-dsh-admin-section] .dot.live { background: var(--dsw-alias-state-success-primary, #10b981); box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25); animation: dsh-admin-pulse 2s infinite ease-in-out; }",
  "[data-dsh-admin-section] .dot.archived { background: var(--dsw-alias-state-warn-label, #f59e0b); }",
  "[data-dsh-admin-section] .confirm-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); border: 1px solid rgba(239,68,68,0.2); }",
  "[data-dsh-admin-section] .confirm-text { font-size: 11px; color: var(--dsw-alias-state-error-primary, #ef4444); font-weight: 500; }",
  "[data-dsh-admin-section] .confirm-actions { display: flex; gap: 5px; flex: none; }",
  "[data-dsh-admin-section] .busy-banner { display: flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 7px; background: rgba(59, 130, 246, 0.08); color: var(--dsw-static-blue-500, #3b82f6); font-size: 11px; }",
  "[data-dsh-admin-section] .update-strip { display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: 8px; font-size: 12px; font-weight: 500; line-height: 1.4; }",
  "[data-dsh-admin-section] .update-strip button { margin-left: auto; flex: none; }",
  "[data-dsh-admin-section] .update-strip.checking { background: rgba(59, 130, 246, 0.08); color: var(--dsw-alias-label-primary, #222); box-shadow: inset 3px 0 0 var(--dsw-static-blue-500, #3b82f6); }",
  "[data-dsh-admin-section] .update-strip.ok { background: rgba(16, 185, 129, 0.10); color: var(--dsw-alias-label-primary, #222); box-shadow: inset 3px 0 0 #15803d; }",
  "[data-dsh-admin-section] .update-strip.has-updates { background: rgba(245, 158, 11, 0.12); color: var(--dsw-alias-label-primary, #222); box-shadow: inset 3px 0 0 #b45309; }",
  "[data-dsh-admin-section] .update-strip.has-errors { background: rgba(239, 68, 68, 0.08); color: var(--dsw-alias-label-primary, #222); box-shadow: inset 3px 0 0 #b91c1c; }",
  "[data-dsh-admin-section] .empty, [data-dsh-sa-section] .empty, [data-cha-section] .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 12px; color: var(--dsw-alias-label-secondary, #61666b); gap: 4px; font-size: 12px; text-align: center; }",
  "[data-dsh-admin-section] .error { padding: 7px 11px; border-radius: 7px; color: var(--dsw-alias-state-error-primary, #ef4444); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); font-size: 12px; white-space: pre-wrap; max-height: 100px; overflow-y: auto; }",
  "[data-dsh-admin-section] .note-ok { padding: 7px 11px; border-radius: 7px; color: #047857; background: rgba(16,185,129,0.1); font-size: 12px; white-space: pre-wrap; }",
  "[data-dsh-admin-section] .footer { display: flex; justify-content: space-between; align-items: center; padding-top: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.3)); flex: none; }",
  "[data-dsh-admin-section] .footer .path { max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  "[data-dsh-admin-section] .footer .hint { font-style: normal; }",
  "[data-dsh-admin-section] .session-id-badge { font-family: monospace; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); }",
  "[data-dsh-admin-section] .mcp-test-row { padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }",
  "[data-dsh-admin-section] .mcp-test { display: inline-flex; align-items: center; gap: 5px; }",
  "[data-dsh-admin-section] .mcp-test.mcp-test-list { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }",
  "[data-dsh-admin-section] .mcp-test-busy { color: var(--dsw-alias-label-secondary, #666); }",
  "[data-dsh-admin-section] .mcp-test-ok { color: #16a34a; }",
  "[data-dsh-admin-section] .mcp-test-fail { color: var(--dsw-alias-state-error-primary, #ef4444); }",
  "[data-dsh-admin-section] .mcp-test-warn { color: #d97706; opacity: 0.95; }",
  "[data-dsh-admin-section] .mcp-test-cached { font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); }",
  "@media (max-width: 520px) { [data-dsh-admin-section] { gap: 10px; } [data-dsh-admin-section] .list.grid2 { grid-template-columns: 1fr; } [data-dsh-admin-section] .toolbar { align-items: stretch; flex-wrap: wrap; padding: 8px; } [data-dsh-admin-section] .toolbar .input-wrap { flex-basis: 100%; } [data-dsh-admin-section] .card-header { align-items: flex-start; } [data-dsh-admin-section] .card-actions { flex-wrap: wrap; justify-content: flex-end; } [data-dsh-admin-section] .footer { gap: 6px; align-items: flex-start; flex-direction: column; } [data-dsh-admin-section] .footer .path { max-width: 100%; } }",
  "@keyframes dsh-toast-in { 0% { opacity: 0; transform: translateY(-12px) scale(0.96); } 100% { opacity: 1; transform: translateY(0) scale(1); } }",
  "@keyframes dsh-toast-out { 0% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-8px) scale(0.96); } }",
  ".dsh-admin-toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 99999; padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; line-height: 1.4; box-shadow: 0 8px 30px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08); display: flex; align-items: center; gap: 8px; pointer-events: none; animation: dsh-toast-in 0.25s ease-out forwards; max-width: 90vw; word-break: break-word; }",
  ".dsh-admin-toast.success { background: rgba(16, 185, 129, 0.95); color: #fff; }",
  ".dsh-admin-toast.error { background: rgba(239, 68, 68, 0.95); color: #fff; }",
  ".dsh-admin-toast.info { background: rgba(22, 119, 255, 0.95); color: #fff; }",
  ".dsh-admin-toast.leaving { animation: dsh-toast-out 0.2s ease-in forwards; }"
].join("\n");
function injectStyles() {
  var tagId = "dsh-plugin-admin/unified-section.css";
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
    var tag = document.createElement("style");
    tag.dataset.plugin = "dsh-plugin-admin";
    tag.dataset.pluginCss = tagId;
    tag.textContent = CSS_TEXT;
    document.head.appendChild(tag);
  }
}
var SA_CSS_TEXT = [
  "@keyframes dsh-sa-spin { to { transform: rotate(360deg); } }",
  "[data-dsh-sa-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); overflow: visible; }",
  "[data-dsh-sa-section] .tabs, [data-cha-section] .tabs { display: flex; padding: 3px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.2)); border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.3)); gap: 3px; }",
  "[data-dsh-sa-section] .tab, [data-cha-section] .tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 7px 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, #666); transition: all 0.15s ease; font-family: inherit; }",
  "[data-dsh-sa-section] .tab:hover:not(.active), [data-cha-section] .tab:hover:not(.active) { color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); }",
  "[data-dsh-sa-section] .tab.active, [data-cha-section] .tab.active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary, #333); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04); }",
  "[data-dsh-sa-section] .tab-count { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.4)); color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-sa-section] .tab.active .tab-count { background: var(--dsw-static-blue-500, #3b82f6); color: #fff; }",
  "[data-dsh-sa-section] .filterbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }",
  "[data-dsh-sa-section] .filter-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); flex: none; margin-right: 2px; }",
  "[data-dsh-sa-section] textarea.input, [data-cha-section] textarea.input { resize: vertical; min-height: 80px; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.55; }",
  "[data-dsh-sa-section] select.input, [data-cha-section] select.input { height: 32px; padding: 0 8px; cursor: pointer; }",
  "[data-dsh-sa-section] .persona-box { display: flex; align-items: flex-start; gap: 6px; padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); border-left: 2px solid var(--dsw-static-blue-500, #3b82f6); font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-sa-section] .persona-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; white-space: pre-wrap; }",
  "[data-dsh-sa-section] .tag.provider { background: #6d28d9; color: #fff; }",
  "[data-dsh-sa-section] .tag.model { background: #1d4ed8; color: #fff; }",
  "[data-dsh-sa-section] .tag.warn, [data-cha-section] .tag.warn { background: #b45309; color: #fff; font-weight: 600; }",
  "[data-dsh-sa-section] .tag.dead { background: #b91c1c; color: #fff; }",
  "[data-dsh-sa-section] .chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }",
  "[data-dsh-sa-section] .chip { font-size: 10px; font-family: var(--dsw-font-mono, ui-monospace, monospace); padding: 1px 6px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-sa-section] .chip.deny { background: rgba(239, 68, 68, 0.08); border-color: rgba(220,38,38,0.25); color: #b91c1c; }",
  "[data-dsh-sa-section] .chip.allow { background: rgba(16, 185, 129, 0.08); border-color: rgba(16,185,129,0.3); color: #047857; }",
  "[data-dsh-sa-section] .form, [data-cha-section] .form { flex: 1 1 auto; min-height: 0; max-height: calc(100vh - 220px); overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--dsw-static-blue-500, #3b82f6); background: var(--dsw-alias-bg-layer-2); box-shadow: 0 4px 14px rgba(59,130,246,0.08); }",
  "[data-dsh-sa-section] .form-actions, [data-cha-section] .form-actions { position: sticky; bottom: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 6px; padding-top: 10px; background: var(--dsw-alias-bg-layer-2); border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); }",
  "[data-dsh-sa-section] .form-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 6px; }",
  "[data-dsh-sa-section] .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }",
  "[data-dsh-sa-section] .form-grid .full { grid-column: 1 / -1; }",
  "[data-dsh-sa-section] .field, [data-cha-section] .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }",
  "[data-dsh-sa-section] .field-label { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 5px; }",
  "[data-dsh-sa-section] .field-hint { font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); line-height: 1.4; }",
  "[data-dsh-sa-section] .fieldset { border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }",
  "[data-dsh-sa-section] .fieldset-legend { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); padding: 0 4px; }",
  "[data-dsh-sa-section] .tag-input { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); background: var(--dsw-alias-bg-base, transparent); min-height: 34px; align-items: center; cursor: text; }",
  "[data-dsh-sa-section] .tag-input:focus-within { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }",
  "[data-dsh-sa-section] .tag-input input { border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 12px; flex: 1; min-width: 90px; }",
  "[data-dsh-sa-section] .tag-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-family: var(--dsw-font-mono, ui-monospace, monospace); padding: 2px 4px 2px 8px; border-radius: 5px; }",
  "[data-dsh-sa-section] .tag-chip.allow { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16,185,129,0.3); color: #047857; }",
  "[data-dsh-sa-section] .tag-chip.deny { background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(220,38,38,0.25); color: #b91c1c; }",
  "[data-dsh-sa-section] .tag-chip button { border: 0; background: transparent; cursor: pointer; color: inherit; opacity: 0.65; font-size: 11px; padding: 0 3px; line-height: 1; }",
  "[data-dsh-sa-section] .tag-chip button:hover { opacity: 1; }",
  "[data-dsh-sa-section] .checkbox-row { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--dsw-alias-label-secondary, #555); cursor: pointer; }",
  "[data-dsh-sa-section] .checkbox-row input { accent-color: var(--dsw-static-blue-500, #3b82f6); }",
  "[data-dsh-sa-section] .env-row { display: flex; gap: 6px; align-items: center; }",
  "[data-dsh-sa-section] .env-row .env-key { flex: 2; min-width: 0; }",
  "[data-dsh-sa-section] .env-row .env-value { flex: 3; min-width: 0; }",
  "[data-dsh-sa-section] .cli-toggle { border: 0; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #555); font-size: 12px; line-height: 1; padding: 3px 6px; border-radius: 6px; }",
  "[data-dsh-sa-section] .cli-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); color: var(--dsw-alias-label-primary, #222); }",
  "[data-dsh-sa-section] .cli-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); display: inline-flex; align-items: center; flex: none; white-space: nowrap; font-family: var(--dsw-font-mono, ui-monospace, monospace); cursor: pointer; }",
  "[data-dsh-sa-section] .cli-tags { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; align-items: center; }",
  "[data-dsh-sa-section] .cli-detail { display: flex; flex-direction: column; gap: 8px; }",
  "[data-dsh-sa-section] .cli-scan-list { display: flex; flex-direction: column; gap: 6px; }",
  "[data-dsh-sa-section] .cli-scan-row { display: flex; gap: 8px; align-items: center; }",
  "[data-dsh-sa-section] .cli-scan-row .input { flex: 1; min-width: 0; }",
  "[data-dsh-sa-section] .cli-scan-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #666); }",
  "[data-dsh-sa-section] .cli-scan-card { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.12)); }",
  "[data-dsh-sa-section] .cli-scan-card button { margin-left: auto; flex: none; }",
  "[data-dsh-sa-section] .error-strip { display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border-radius: 9px; border: 1px solid rgba(220,38,38,0.35); background: rgba(239,68,68,0.08); color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; line-height: 1.45; word-break: break-word; }",
  "[data-dsh-sa-section] .warn-strip { display: flex; flex-direction: column; gap: 4px; padding: 9px 12px; border-radius: 9px; border: 1px solid rgba(217,119,6,0.35); background: rgba(245,158,11,0.08); color: #b45309; font-size: 12px; line-height: 1.5; word-break: break-word; }",
  "[data-dsh-sa-section] .warn-strip div { display: flex; gap: 6px; align-items: flex-start; }",
  "[data-dsh-sa-section] .empty .big { font-size: 26px; }",
  "[data-dsh-sa-section] .toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10000; max-width: 520px; padding: 10px 16px; border-radius: 10px; font-size: 12px; line-height: 1.5; box-shadow: 0 8px 24px rgba(0,0,0,0.18); background: rgba(239,68,68,0.96); color: #fff; word-break: break-word; white-space: pre-line; }",
  "[data-dsh-sa-section] .history-row { display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); background: var(--dsw-alias-bg-layer-2); }",
  "[data-dsh-sa-section] .history-head { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }",
  "[data-dsh-sa-section] .history-time { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); margin-left: auto; }",
  "[data-dsh-sa-section] .history-detail { font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); font-family: var(--dsw-font-mono, ui-monospace, monospace); word-break: break-all; max-height: 60px; overflow: hidden; }",
  "[data-dsh-sa-section] .footer-note { font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); line-height: 1.5; padding: 0 2px; }",
  "[data-dsh-sa-section] .sa-picker { position: relative; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }",
  "[data-dsh-sa-section] .sa-picker-input { border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 12px; flex: 1; min-width: 120px; padding: 2px 4px; }",
  "[data-dsh-sa-section] .sa-picker-list { width: 100%; margin-top: 4px; max-height: 220px; overflow-y: auto; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); padding: 3px; scrollbar-width: thin; }",
  "[data-dsh-sa-section] .sa-picker-opt { padding: 6px 9px; font-size: 12px; cursor: pointer; border-radius: 5px; color: var(--dsw-alias-label-primary, #222); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  "[data-dsh-sa-section] .sa-picker-opt.active, [data-dsh-sa-section] .sa-picker-opt:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(59,130,246,0.14)); color: var(--dsw-static-blue-500, #3b82f6); }",
  "[data-dsh-sa-section] .sa-picker-empty { padding: 6px 9px; font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); }"
];
function injectSaStyles() {
  if (document.querySelector("style[data-dsh-sa-styles]") !== null) return;
  var style = document.createElement("style");
  style.setAttribute("data-dsh-sa-styles", "");
  style.dataset.plugin = "dsh-plugin-admin";
  style.dataset.pluginCss = "dsh-plugin-admin/subagents.css";
  style.textContent = SA_CSS_TEXT.join("\n");
  document.head.appendChild(style);
}
var CH_CSS_TEXT = [
  "[data-cha-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); overflow: visible; }",
  // Segmented tabs — the same recipe the subagents section uses.
  "[data-cha-section] .tab:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }",
  // Toolbar card — same recipe as the unified sections.
  "[data-cha-section] .toolbar .title { font-weight: 600; color: var(--dsw-alias-label-primary); }",
  "[data-cha-section] .toolbar .count { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); color: var(--dsw-alias-label-secondary, #555); font-weight: 500; }",
  "[data-cha-section] .toolbar .spacer { flex: 1; }",
  // Buttons — same recipe as the unified sections (blue primary, red danger).
  // Status banners — the same tint recipe as update-strip / busy-banner.
  "[data-cha-section] .notice { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 11px; border-radius: 8px; font-size: 12px; line-height: 1.5; background: rgba(59,130,246,0.08); color: var(--dsw-static-blue-500, #3b82f6); }",
  "[data-cha-section] .notice.warn { background: rgba(217,119,6,0.1); color: #b45309; }",
  "[data-cha-section] .notice.ok { background: rgba(16,185,129,0.1); color: #047857; }",
  "[data-cha-section] .notice .notice-text { flex: 1 1 240px; }",
  "[data-cha-section] .notice .notice-actions { display: flex; gap: 5px; flex: none; }",
  // Rows — card elevation + hover lift like the other list cards.
  "[data-cha-section] .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }",
  "[data-cha-section] .row:hover { transform: translateY(-1px); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }",
  "[data-cha-section] .row.off { opacity: 0.55; }",
  "[data-cha-section] .row .main { flex: 1; min-width: 0; }",
  "[data-cha-section] .row .name { font-weight: 600; }",
  "[data-cha-section] .row .desc { color: var(--dsw-alias-label-secondary, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  "[data-cha-section] .row .desc.mono { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; }",
  "[data-cha-section] .row .meta { color: var(--dsw-alias-label-secondary, #61666b); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  "[data-cha-section] .name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }",
  "[data-cha-section] .actions { display: flex; gap: 5px; align-items: center; flex: none; }",
  // Tag badges — same recipe as the unified .tag family.
  "[data-cha-section] .tag.event { background: rgba(59,130,246,0.12); color: var(--dsw-static-blue-500, #3b82f6); font-family: var(--dsw-font-mono, ui-monospace, monospace); }",
  "[data-cha-section] .tag.err { background: rgba(239,68,68,0.1); color: var(--dsw-alias-state-error-primary, #ef4444); }",
  // Toggle switch — the blue accent instead of the standalone plugin's dark knob.
  "[data-cha-section] .toggle { position: relative; width: 34px; height: 20px; flex: none; appearance: none; border: none; border-radius: 99px; cursor: pointer; background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.3)); transition: background 0.15s; }",
  '[data-cha-section] .toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 99px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 0.15s; }',
  '[data-cha-section] .toggle[aria-checked="true"] { background: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-cha-section] .toggle[aria-checked="true"]::after { transform: translateX(14px); }',
  "[data-cha-section] .toggle:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }",
  "[data-cha-section] .toggle:disabled { opacity: 0.45; cursor: not-allowed; }",
  // Forms — .input recipe with the blue focus ring.
  "[data-cha-section] .field label { font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }",
  "[data-cha-section] .input.mono { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; }",
  "[data-cha-section] .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }",
  "[data-cha-section] .checks { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }",
  "[data-cha-section] .check { display: flex; gap: 6px; align-items: center; cursor: pointer; }",
  // Misc.
  "[data-cha-section] .hint { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
  "[data-cha-section] .path-chip { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); word-break: break-all; }",
  "[data-cha-section] .error-text { color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; }"
].join("\n");
function injectChStyles() {
  var tagId = "dsh-plugin-admin/command-hooks.css";
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
    var tag = document.createElement("style");
    tag.dataset.plugin = "dsh-plugin-admin";
    tag.dataset.pluginCss = tagId;
    tag.textContent = CH_CSS_TEXT;
    document.head.appendChild(tag);
  }
}
var TODO_CSS_TAG = "dsh-plugin-admin/todo-dock.css";
var TODO_CSS_TEXT = [
  // Stock-strip suppression: only active while this panel is mounted with data.
  'body.dsh-admin-todo-live [data-testid="todo-panel"] { display: none !important; }',
  "[data-dsh-admin-todo] { display: flex; flex-direction: column; position: relative; width: calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px)); max-width: calc(var(--dsh-composer-card-max-width, 100%) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px)); margin: 0 auto; border: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2, rgba(200,200,210,0.4))); border-radius: 12px; background: var(--dsw-specific-tip, var(--dsw-alias-bg-layer-2)); box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, var(--dsw-alias-border-l2, rgba(200,200,210,0.4))); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6))); }",
  // Slim completion bar across the panel top; turns green at 100%.
  "[data-dsh-admin-todo] .todo-progress { flex: none; width: 100%; height: 3px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.35)); }",
  "[data-dsh-admin-todo] .todo-progress-fill { height: 100%; width: 0; background: var(--dsw-static-blue-500, #3b82f6); border-radius: 0 2px 2px 0; transition: width 0.3s ease, background 0.3s ease; }",
  "[data-dsh-admin-todo] .todo-progress-fill.full { background: var(--dsw-alias-state-success-primary, #16a34a); }",
  "[data-dsh-admin-todo] .todo-list { list-style: none; margin: 0; padding: 8px 14px 4px 14px; display: flex; flex-direction: column; gap: 2px; max-height: 224px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent; }",
  "[data-dsh-admin-todo] .todo-list::-webkit-scrollbar { width: 6px; }",
  "[data-dsh-admin-todo] .todo-list::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsh-scrollbar-thumb); }",
  // First visible row keeps its right-aligned content (elapsed timer / done
  // chevron) clear of the bell button floating over the panel's top-right.
  "[data-dsh-admin-todo] .todo-list > :first-child { padding-right: 26px; }",
  "[data-dsh-admin-todo] .todo-item { display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 3px 0; border-radius: 6px; }",
  "[data-dsh-admin-todo] .todo-glyph { width: 16px; height: 16px; flex: none; display: grid; place-items: center; margin-top: 2px; color: var(--dsw-alias-label-secondary, #61666b); }",
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-glyph { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-glyph svg { animation: dsh-admin-spin 0.9s linear infinite; }',
  '[data-dsh-admin-todo] .todo-item[data-status="completed"] .todo-glyph { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  "[data-dsh-admin-todo] .todo-text { min-width: 0; word-break: break-word; color: var(--dsw-alias-label-primary, #222); }",
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-text { font-weight: 500; }',
  '[data-dsh-admin-todo] .todo-item[data-status="completed"] .todo-text { text-decoration: line-through; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-todo] .todo-item[data-status="pending"] .todo-text { color: var(--dsw-alias-label-secondary, #555); }',
  // Live elapsed counter on the active step ("visibly tick", never stuck).
  "[data-dsh-admin-todo] .todo-elapsed { flex: none; margin-left: auto; padding-left: 8px; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #61666b); font-variant-numeric: tabular-nums; white-space: nowrap; }",
  // Collapse-completed summary row.
  "[data-dsh-admin-todo] .todo-done-row { margin: 0; padding: 0 0 2px 0; }",
  "[data-dsh-admin-todo] .todo-done-row + .todo-item { border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.25)); }",
  "[data-dsh-admin-todo] .todo-done-toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 3px 0; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); text-align: left; border-radius: 6px; }",
  "[data-dsh-admin-todo] .todo-done-toggle:hover { color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-admin-todo] .todo-done-toggle:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }",
  "[data-dsh-admin-todo] .todo-done-toggle .todo-glyph { margin-top: 0; color: var(--dsw-alias-state-success-primary, #16a34a); }",
  "[data-dsh-admin-todo] .todo-done-label { min-width: 0; flex: 1 1 auto; }",
  "[data-dsh-admin-todo] .todo-done-toggle .todo-chevron { font-size: 10px; }",
  // File-change section: compact monospace rows, git-status letter badges.
  "[data-dsh-admin-todo] .todo-files { display: flex; flex-direction: column; margin: 4px 14px 0 14px; padding: 4px 0 5px 0; border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.35)); max-height: 140px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent; }",
  "[data-dsh-admin-todo] .todo-files::-webkit-scrollbar { width: 6px; }",
  "[data-dsh-admin-todo] .todo-files::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsh-scrollbar-thumb); }",
  '[data-dsh-admin-todo] .todo-files-head { display: flex; align-items: center; gap: 5px; padding: 0 0 3px 0; font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace; font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); }',
  "[data-dsh-admin-todo] .todo-files-head .branch { color: var(--dsw-static-blue-500, #3b82f6); }",
  "[data-dsh-admin-todo] .todo-files-head .branch-name { font-weight: 600; }",
  "[data-dsh-admin-todo] .todo-copy-diff { margin-left: auto; border: 0; background: transparent; cursor: pointer; font-family: inherit; font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); padding: 0 4px; border-radius: 4px; }",
  "[data-dsh-admin-todo] .todo-copy-diff:hover { color: var(--dsw-static-blue-500, #3b82f6); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); }",
  "[data-dsh-admin-todo] .todo-copy-diff:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: -2px; }",
  // Notification bell: floats over the top edge, dim until enabled.
  "[data-dsh-admin-todo] .todo-notify { position: absolute; top: 6px; right: 8px; width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #61666b); cursor: pointer; z-index: 1; }",
  "[data-dsh-admin-todo] .todo-notify:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-admin-todo] .todo-notify.on { color: var(--dsw-static-blue-500, #3b82f6); }",
  "[data-dsh-admin-todo] .todo-notify:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: -2px; }",
  '[data-dsh-admin-todo] .todo-file { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; padding: 1.5px 4px; margin: 0; border: 0; border-radius: 4px; background: transparent; text-align: left; cursor: pointer; font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #555); }',
  "[data-dsh-admin-todo] .todo-file:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); }",
  "[data-dsh-admin-todo] .todo-file:hover:not(:disabled) .name { color: var(--dsw-static-blue-500, #3b82f6); }",
  "[data-dsh-admin-todo] .todo-file:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: -2px; }",
  "[data-dsh-admin-todo] .todo-file:disabled { cursor: default; }",
  "[data-dsh-admin-todo] .todo-file .st { flex: none; width: 14px; text-align: center; font-weight: 700; }",
  '[data-dsh-admin-todo] .todo-file[data-st="M"] .st { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-file[data-st="A"] .st, [data-dsh-admin-todo] .todo-file[data-st="?"] .st { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-file[data-st="D"] .st { color: var(--dsw-alias-state-error-primary, #dc2626); }',
  '[data-dsh-admin-todo] .todo-file[data-st="R"] .st, [data-dsh-admin-todo] .todo-file[data-st="C"] .st { color: var(--dsw-static-amber-500, #d97706); }',
  "[data-dsh-admin-todo] .todo-file .p { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: ltr; }",
  "[data-dsh-admin-todo] .todo-file .p .dir { color: var(--dsw-alias-label-secondary, #61666b); }",
  "[data-dsh-admin-todo] .todo-file .p .name { color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-admin-todo] .todo-file .n { flex: none; font-variant-numeric: tabular-nums; }",
  "[data-dsh-admin-todo] .todo-file .n .a { color: var(--dsw-alias-state-success-primary, #16a34a); }",
  "[data-dsh-admin-todo] .todo-file .n .d { color: var(--dsw-alias-state-error-primary, #dc2626); margin-left: 5px; }",
  "[data-dsh-admin-todo] .todo-file .n .zero { opacity: 0.45; }",
  // Footer: step counts left, change totals + collapse chevron right.
  "[data-dsh-admin-todo] .todo-footer { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 14px; border: 0; border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.35)); background: transparent; cursor: pointer; font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); text-align: left; }",
  "[data-dsh-admin-todo] .todo-footer:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.2)); color: var(--dsw-alias-label-secondary, #555); }",
  "[data-dsh-admin-todo] .todo-footer:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: -2px; }",
  "[data-dsh-admin-todo] .todo-footer .todo-steps { flex: 1 1 auto; min-width: 0; }",
  "[data-dsh-admin-todo] .todo-footer .todo-stats { flex: none; display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }",
  "[data-dsh-admin-todo] .todo-footer .num-add { color: var(--dsw-alias-state-success-primary, #16a34a); font-weight: 600; }",
  "[data-dsh-admin-todo] .todo-footer .num-del { color: var(--dsw-alias-state-error-primary, #dc2626); font-weight: 600; }",
  "[data-dsh-admin-todo] .todo-chevron { flex: none; font-size: 10px; opacity: 0.7; }"
].join("\n");
function injectTodoStyles() {
  if (document.querySelector('style[data-plugin-css="' + TODO_CSS_TAG + '"]') === null) {
    var tag = document.createElement("style");
    tag.dataset.plugin = "dsh-plugin-admin";
    tag.dataset.pluginCss = TODO_CSS_TAG;
    tag.textContent = TODO_CSS_TEXT;
    document.head.appendChild(tag);
  }
}

// src/client/panels/context.js
var createElement = import_react.default.createElement;
var useState = import_react.default.useState;
var useRef = import_react.default.useRef;
var useEffect = import_react.default.useEffect;
var dshT = function(s) {
  return s;
};
var i18nSource = function(s) {
  return s;
};
var setAdminLang = function() {
};
var currentLanguage = function() {
  return "zh";
};
var baseName = function(p) {
  return p;
};
var formatDate = function() {
  return "";
};
var messageOf = function(e) {
  return String(e);
};
var sectionState = function() {
  throw new Error("panels: configure() was not called");
};
var showToast = function() {
};
var copyTextToClipboard = function() {
};
var copyTextSilently = function() {
};
var downloadTextFile = function() {
};
var panelHidden = function() {
  return false;
};
function configure(env) {
  injectStyles();
  injectSaStyles();
  injectChStyles();
  injectTodoStyles();
  if (typeof env.dshT === "function") dshT = env.dshT;
  if (typeof env.i18nSource === "function") i18nSource = env.i18nSource;
  if (typeof env.setAdminLang === "function") setAdminLang = env.setAdminLang;
  if (typeof env.currentLanguage === "function") currentLanguage = env.currentLanguage;
  if (typeof env.baseName === "function") baseName = env.baseName;
  if (typeof env.formatDate === "function") formatDate = env.formatDate;
  if (typeof env.messageOf === "function") messageOf = env.messageOf;
  if (typeof env.sectionState === "function") sectionState = env.sectionState;
  if (typeof env.showToast === "function") showToast = env.showToast;
  if (typeof env.copyTextToClipboard === "function") copyTextToClipboard = env.copyTextToClipboard;
  if (typeof env.copyTextSilently === "function") copyTextSilently = env.copyTextSilently;
  if (typeof env.downloadTextFile === "function") downloadTextFile = env.downloadTextFile;
  if (typeof env.panelHidden === "function") panelHidden = env.panelHidden;
}

// src/client/panels/subagents.js
var TOOLNAME_RE = /^[a-z][a-z0-9_]{1,47}$/;
var TOOL_REF_RE = /^[a-z][a-z0-9_]*$/;
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var RESERVED_TOOL_NAMES = ["subagent", "subagent_fork", "run_code"];
function unwrap(result) {
  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok) return result.value;
    var detail = result.error && result.error.message ? result.error.message : String(result.error);
    throw new Error(detail);
  }
  return result;
}
function emptyDraft() {
  return {
    id: "",
    toolName: "",
    provider: "spawn",
    persona: "",
    allow: [],
    deny: [],
    agentProvider: "",
    agentModel: "",
    maxTokens: "",
    maxDepthManaged: false,
    maxDepth: "3",
    backgroundMode: "one-shot",
    enableRunInBackground: true
  };
}
function draftFromEntry(entry) {
  var config = entry.config || {};
  return {
    id: entry.id,
    toolName: config.toolName || "",
    provider: config.provider || "spawn",
    persona: config.persona || "",
    allow: config.toolFilter && config.toolFilter.allow || [],
    deny: config.toolFilter && config.toolFilter.deny || [],
    agentProvider: config.agentOptions && config.agentOptions.provider || "",
    agentModel: config.agentOptions && config.agentOptions.model || "",
    maxTokens: config.agentOptions && config.agentOptions.maxTokens !== void 0 ? String(config.agentOptions.maxTokens) : "",
    maxDepthManaged: config.maxDepth === "provider-managed",
    maxDepth: typeof config.maxDepth === "number" ? String(config.maxDepth) : "3",
    backgroundMode: config.backgroundMode || "one-shot",
    enableRunInBackground: config.enableRunInBackground !== false
  };
}
function adjustDraftForProvider(draft, provider) {
  var patch = {};
  var adjusted = [];
  if (!provider) return { patch, adjusted };
  if (provider.capabilities.persona === false && draft.persona !== "") {
    patch.persona = "";
    adjusted.push(dshT("\u63D0\u793A\u8BCD"));
  }
  if (provider.capabilities.toolFilter === false && (draft.allow.length > 0 || draft.deny.length > 0)) {
    patch.allow = [];
    patch.deny = [];
    adjusted.push(dshT("\u5DE5\u5177\u7EA6\u675F"));
  }
  if (provider.capabilities.depthLimit === false && !draft.maxDepthManaged && draft.maxDepth !== "") {
    patch.maxDepthManaged = true;
    adjusted.push(dshT("\u6570\u503C\u6700\u5927\u59D4\u6258\u6DF1\u5EA6"));
  }
  if (provider.continuable !== true && draft.backgroundMode === "continuable") {
    patch.backgroundMode = "one-shot";
    adjusted.push(dshT("\u540E\u53F0\u6A21\u5F0F"));
  }
  return { patch, adjusted };
}
function validateDraft(draft, isCreate, otherToolNames, providerMeta, candidateNames) {
  if (isCreate && !ID_RE.test(draft.id)) return dshT("\u5B9E\u4F8B ID \u53EA\u80FD\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u548C\u4E2D\u5212\u7EBF\uFF08\u5B57\u6BCD\u6216\u6570\u5B57\u5F00\u5934\uFF0C\u6700\u957F 64 \u4F4D\uFF09");
  if (!TOOLNAME_RE.test(draft.toolName)) return dshT("\u5B50\u667A\u80FD\u4F53\u540D\u79F0\u5FC5\u987B\u662F 2-48 \u4F4D\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF\u4E14\u5B57\u6BCD\u5F00\u5934");
  if (RESERVED_TOOL_NAMES.indexOf(draft.toolName) !== -1) return dshT('\u5B50\u667A\u80FD\u4F53\u540D\u79F0 "') + draft.toolName + dshT('" \u662F\u4FDD\u7559\u540D\uFF08\u5185\u7F6E\u9884\u8BBE\u5DF2\u5360\u7528\uFF09');
  if (otherToolNames.indexOf(draft.toolName) !== -1) return dshT('\u5B50\u667A\u80FD\u4F53\u540D\u79F0 "') + draft.toolName + dshT('" \u5DF2\u88AB\u5176\u4ED6\u5B9E\u4F8B\u4F7F\u7528');
  var meta = providerMeta[draft.provider];
  if (!meta) return dshT('\u672A\u77E5\u7684\u6267\u884C\u540E\u7AEF "') + draft.provider + '"';
  if (draft.persona !== "" && meta.capabilities.persona === false) return dshT('\u540E\u7AEF "') + draft.provider + dshT('" \u4E0D\u652F\u6301 persona\uFF08\u63D0\u793A\u8BCD\uFF09');
  if ((draft.allow.length > 0 || draft.deny.length > 0) && meta.capabilities.toolFilter === false) return dshT('\u540E\u7AEF "') + draft.provider + dshT('" \u4E0D\u652F\u6301 toolFilter\uFF08\u5DE5\u5177\u7EA6\u675F\uFF09');
  if (!draft.maxDepthManaged) {
    if (draft.maxDepth !== "" && !/^\d+$/.test(draft.maxDepth)) return dshT("\u6700\u5927\u59D4\u6258\u6DF1\u5EA6\u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570");
    if (draft.maxDepth !== "" && meta.capabilities.depthLimit === false) {
      return dshT('\u540E\u7AEF "') + draft.provider + dshT('" \u65E0\u6CD5\u6267\u884C\u6570\u503C maxDepth\uFF1B\u8BF7\u52FE\u9009\u300C\u4EA4\u7531\u540E\u7AEF\u7BA1\u7406\u300D\u6216\u6362\u540E\u7AEF');
    }
  }
  if (draft.maxTokens !== "" && !/^\d+$/.test(draft.maxTokens)) return dshT("maxTokens \u5FC5\u987B\u662F\u6B63\u6574\u6570");
  var filterNames = (draft.allow || []).concat(draft.deny || []);
  for (var fi = 0; fi < filterNames.length; fi++) {
    var tname = filterNames[fi];
    if (RESERVED_TOOL_NAMES.indexOf(tname) !== -1) return dshT('\u5DE5\u5177 "') + tname + dshT('" \u662F\u4FDD\u7559\u540D\uFF08') + RESERVED_TOOL_NAMES.join("/") + dshT("\uFF09\uFF0C\u4E0D\u80FD\u7528\u4E8E\u5DE5\u5177\u7EA6\u675F");
    if (candidateNames && candidateNames.length > 0 && candidateNames.indexOf(tname) === -1) return dshT('\u5DE5\u5177 "') + tname + dshT('" \u4E0D\u5728\u53EF\u9009\u6E05\u5355\u4E2D\uFF08\u6765\u81EA\u8FD0\u884C\u4E2D\u5DE5\u5177\u6216\u5185\u7F6E\u540D\u5F55\uFF09\uFF0C\u4FDD\u5B58\u4F1A\u88AB\u62D2\u7EDD');
  }
  return null;
}
function draftToPayload(draft) {
  var config = { provider: draft.provider, toolName: draft.toolName };
  if (draft.persona.trim() !== "") config.persona = draft.persona;
  if (draft.allow.length > 0 || draft.deny.length > 0) {
    config.toolFilter = {};
    if (draft.allow.length > 0) config.toolFilter.allow = draft.allow.slice();
    if (draft.deny.length > 0) config.toolFilter.deny = draft.deny.slice();
  }
  var agentOptions = {};
  if (draft.agentProvider.trim() !== "") agentOptions.provider = draft.agentProvider.trim();
  if (draft.agentModel.trim() !== "") agentOptions.model = draft.agentModel.trim();
  if (draft.maxTokens.trim() !== "") agentOptions.maxTokens = Number(draft.maxTokens);
  if (Object.keys(agentOptions).length > 0) config.agentOptions = agentOptions;
  if (draft.maxDepthManaged) config.maxDepth = "provider-managed";
  else if (draft.maxDepth !== "") config.maxDepth = Number(draft.maxDepth);
  config.backgroundMode = draft.backgroundMode;
  config.enableRunInBackground = draft.enableRunInBackground === true;
  return { id: draft.id.trim(), config };
}
function SubagentsPanel(props) {
  var call = props.call;
  var viewState = useState({ loading: true, error: null, data: null });
  var view = viewState[0];
  var setView = viewState[1];
  var formState = useState(null);
  var form = formState[0];
  var setForm = formState[1];
  var needleState = useState("");
  var needle = needleState[0];
  var setNeedle = needleState[1];
  var providerFilterState = useState("");
  var providerFilter = providerFilterState[0];
  var setProviderFilter = providerFilterState[1];
  var noticeState = useState(null);
  var notice = noticeState[0];
  var setNotice = noticeState[1];
  var toastState = useState(null);
  var toast = toastState[0];
  var setToast = toastState[1];
  var reload = function() {
    setView(function(prev) {
      return Object.assign({}, prev, { loading: true, error: null });
    });
    call("subagentAdmin/list", {}).then(function(raw) {
      var result = unwrap(raw);
      setView({ loading: false, error: null, data: result });
    }).catch(function(error) {
      setView({ loading: false, error: String(error && error.message || error), data: null });
    });
  };
  useEffect(reload, []);
  useEffect(function() {
    if (!toast) return void 0;
    var timer = setTimeout(function() {
      setToast(null);
    }, 4200);
    return function() {
      clearTimeout(timer);
    };
  }, [toast]);
  var data = view.data;
  var entries = data && data.entries || [];
  var meta = data && data.meta || { tools: [], providers: [], llmProviders: [], llmModels: {} };
  var candidateNames = meta.tools.map(function(tool) {
    return tool.name;
  });
  var providerMeta = {};
  meta.providers.forEach(function(provider) {
    providerMeta[provider.name] = provider;
  });
  var llmProviders = meta.llmProviders || [];
  var llmModels = meta.llmModels || {};
  var filtered = entries.filter(function(entry) {
    var config = entry.config || {};
    if (providerFilter !== "" && config.provider !== providerFilter) return false;
    if (needle === "") return true;
    var haystack = [entry.id, config.toolName, config.provider, config.persona, config.agentOptions && config.agentOptions.model].filter(Boolean).join(" ").toLowerCase();
    return haystack.indexOf(needle.toLowerCase()) !== -1;
  });
  var openCreate = function() {
    setNotice(null);
    setForm({ draft: emptyDraft(), editing: false, saving: false, error: null, capabilityNotice: null, advanced: false });
  };
  var openEdit = function(entry) {
    setNotice(null);
    setForm({ draft: draftFromEntry(entry), editing: true, saving: false, error: null, capabilityNotice: null, advanced: false });
  };
  var closeForm = function() {
    setForm(null);
  };
  var saveForm = function() {
    if (!form || form.saving) return;
    var otherToolNames = entries.filter(function(entry) {
      return !form.editing || entry.id !== form.draft.id;
    }).map(function(entry) {
      return (entry.config || {}).toolName;
    }).filter(Boolean);
    var clientError = validateDraft(form.draft, !form.editing, otherToolNames, providerMeta, candidateNames);
    if (clientError) {
      setForm(Object.assign({}, form, { error: clientError }));
      return;
    }
    var saving = Object.assign({}, form, { saving: true, error: null });
    setForm(saving);
    var payload = draftToPayload(saving.draft);
    call("subagentAdmin/upsert", { entry: payload }).then(function(raw) {
      var result = unwrap(raw);
      setView(function(prev) {
        return Object.assign({}, prev, { data: result, loading: false });
      });
      setForm(null);
      setNotice(result.warnings && result.warnings.length > 0 ? result.warnings : null);
    }).catch(function(error) {
      var message = String(error && error.message || error);
      setForm(Object.assign({}, saving, { saving: false, error: message }));
      setToast(dshT("\u4FDD\u5B58\u5931\u8D25\uFF1A") + message);
    });
  };
  var removeInFlight = useRef({});
  var removeEntry = function(entry) {
    if (removeInFlight.current[entry.id]) return;
    removeInFlight.current[entry.id] = true;
    call("subagentAdmin/remove", { id: entry.id }).then(function(raw) {
      delete removeInFlight.current[entry.id];
      var result = unwrap(raw);
      setView(function(prev) {
        return Object.assign({}, prev, { data: result, loading: false });
      });
      setNotice(null);
    }).catch(function(error) {
      delete removeInFlight.current[entry.id];
      setToast(dshT("\u5220\u9664\u5931\u8D25\uFF1A") + String(error && error.message || error));
    });
  };
  var patchDraft = function(patch) {
    setForm(function(prev) {
      return Object.assign({}, prev, { draft: Object.assign({}, prev.draft, patch) });
    });
  };
  var patchProvider = function(providerName) {
    setForm(function(prev) {
      var adjustment = adjustDraftForProvider(prev.draft, providerMeta[providerName]);
      return Object.assign({}, prev, {
        draft: Object.assign({}, prev.draft, { provider: providerName }, adjustment.patch),
        error: null,
        capabilityNotice: adjustment.adjusted.length > 0 ? dshT("\u5DF2\u6309\u300C") + providerName + dshT("\u300D\u7684\u80FD\u529B\u6E05\u9664\u6216\u8C03\u6574\uFF1A") + adjustment.adjusted.join(dshT("\u3001")) : null
      });
    });
  };
  var toggleAdvanced = function() {
    setForm(function(prev) {
      return Object.assign({}, prev, { advanced: prev.advanced !== true });
    });
  };
  var children = [];
  children.push(createElement(
    "div",
    { className: "toolbar", key: "toolbar" },
    createElement(
      "div",
      { className: "search-wrap", key: "search" },
      createElement("span", { className: "search-icon" }, "\u{1F50D}"),
      createElement(import_dsh_client_ui_primitives.Input, {
        placeholder: dshT("\u641C\u7D22\u5B50\u667A\u80FD\u4F53\uFF08\u540D\u79F0/ID/\u540E\u7AEF/\u63D0\u793A\u8BCD/\u6A21\u578B\uFF09..."),
        value: needle,
        onChange: function(event) {
          setNeedle(event.target.value);
        }
      })
    ),
    createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", key: "create", onClick: openCreate }, dshT("\uFF0B \u65B0\u5EFA\u5B50\u667A\u80FD\u4F53")),
    createElement(
      import_dsh_client_ui_primitives.Button,
      { variant: "outline", size: "sm", key: "refresh", onClick: reload, disabled: view.loading },
      view.loading ? createElement(Spinner, { key: "spin" }) : "\u21BB",
      dshT("\u5237\u65B0")
    )
  ));
  if (meta.providers.length > 1) {
    children.push(createElement(
      "div",
      { className: "filterbar", key: "filterbar" },
      createElement("span", { className: "filter-label" }, dshT("\u6267\u884C\u540E\u7AEF")),
      createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        key: "pill-all",
        variant: "outline",
        size: "sm",
        className: providerFilter === "" ? " active" : "",
        onClick: function() {
          setProviderFilter("");
        }
      }, dshT("\u5168\u90E8")),
      meta.providers.map(function(provider) {
        return createElement(import_dsh_client_ui_primitives.Button, {
          type: "button",
          key: "pill-" + provider.name,
          variant: "outline",
          size: "sm",
          className: providerFilter === provider.name ? " active" : "",
          onClick: function() {
            setProviderFilter(providerFilter === provider.name ? "" : provider.name);
          }
        }, provider.name);
      })
    ));
  }
  if (form) {
    children.push(SubagentForm({
      form,
      meta,
      candidateNames,
      providerMeta,
      llmProviders,
      llmModels,
      entries,
      onPatch: patchDraft,
      onProviderChange: patchProvider,
      onToggleAdvanced: toggleAdvanced,
      onClose: closeForm,
      onSave: saveForm
    }));
  }
  if (notice) {
    children.push(createElement(
      "div",
      { className: "warn-strip", key: "notice" },
      notice.map(function(warning, index) {
        return createElement("div", { key: index }, "\u26A0\uFE0F ", warning);
      })
    ));
  }
  if (!form) {
    if (view.loading && entries.length === 0) {
      children.push(createElement(
        "div",
        { className: "empty", key: "loading" },
        createElement("span", { className: "big" }, "\u23F3"),
        dshT("\u6B63\u5728\u52A0\u8F7D\u5B50\u667A\u80FD\u4F53\u914D\u7F6E\u2026")
      ));
    } else if (view.error) {
      children.push(createElement("div", { className: "error-strip", key: "error" }, dshT("\u26A0\uFE0F \u52A0\u8F7D\u5931\u8D25\uFF1A"), view.error));
    } else if (filtered.length === 0) {
      children.push(createElement(
        "div",
        { className: "empty", key: "empty" },
        createElement("span", { className: "big" }, "\u{1F916}"),
        entries.length === 0 ? dshT("\u8FD8\u6CA1\u6709\u53D7\u7BA1\u5B50\u667A\u80FD\u4F53\u3002\u70B9\u51FB\u300C\uFF0B \u65B0\u5EFA\u5B50\u667A\u80FD\u4F53\u300D\u521B\u5EFA\u7B2C\u4E00\u4E2A\uFF1A\u540D\u79F0\u3001\u63D0\u793A\u8BCD\u3001\u5DE5\u5177\u7EA6\u675F\u3001\u6A21\u578B\u6307\u5B9A\u5168\u90E8\u53EF\u914D\u3002") : dshT("\u6CA1\u6709\u5339\u914D\u5F53\u524D\u641C\u7D22/\u7B5B\u9009\u7684\u5B50\u667A\u80FD\u4F53\u3002")
      ));
    } else {
      children.push(createElement("div", { className: "list", key: "cards" }, filtered.map(function(entry) {
        return SubagentCard({
          entry,
          onEdit: openEdit,
          onRemove: removeEntry
        });
      })));
    }
  }
  children.push(createElement(
    "div",
    { className: "footer-note", key: "note" },
    dshT("\u6BCF\u5F20\u5361\u7247\u5BF9\u5E94 profile cordis.patch.yml \u4E2D\u4E00\u4E2A @deepseek-ai/dsh-tool-subagent \u884C\uFF1B\u4FDD\u5B58\u5373\u5199\u5165\u8BE5\u6587\u4EF6\uFF0C\u7531 Cordis HMR \u70ED\u52A0\u8F7D\u751F\u6548\uFF08\u65E0\u9700\u91CD\u542F\uFF09\uFF0C\u91CD\u542F dsh \u540E\u540C\u6837\u81EA\u52A8\u52A0\u8F7D\u3002\u9996\u6B21\u4FEE\u6539\u524D\u539F\u6587\u4EF6\u81EA\u52A8\u5907\u4EFD\u4E3A cordis.patch.yml.bak-subagent-admin\u3002")
  ));
  return createElement(
    "div",
    null,
    toast ? createElement("div", { className: "toast" }, toast) : null,
    children
  );
}
function SubagentForm(props) {
  var form = props.form;
  var draft = form.draft;
  var meta = props.meta;
  var candidateNames = props.candidateNames;
  var providerMeta = props.providerMeta;
  var llmProviders = props.llmProviders || [];
  var llmModels = props.llmModels || {};
  var entries = props.entries;
  var onPatch = props.onPatch;
  var onProviderChange = props.onProviderChange;
  var onToggleAdvanced = props.onToggleAdvanced;
  var onClose = props.onClose;
  var onSave = props.onSave;
  var advanced = form.advanced === true;
  var providerInfo = providerMeta[draft.provider];
  var capabilityHint = providerInfo ? dshT("\u80FD\u529B\uFF1A") + [
    providerInfo.capabilities.persona ? dshT("\u2713 \u63D0\u793A\u8BCD") : dshT("\u2717 \u63D0\u793A\u8BCD"),
    providerInfo.capabilities.toolFilter ? dshT("\u2713 \u5DE5\u5177\u7EA6\u675F") : dshT("\u2717 \u5DE5\u5177\u7EA6\u675F"),
    providerInfo.capabilities.depthLimit ? dshT("\u2713 \u6DF1\u5EA6\u4E0A\u9650") : dshT("\u2717 \u6DF1\u5EA6\u4E0A\u9650"),
    providerInfo.continuable ? dshT("\u2713 \u53EF\u6301\u7EED\u4F1A\u8BDD") : dshT("\u4EC5\u4E00\u6B21\u6027")
  ].join(" / ") : "";
  var modelOptions = draft.agentProvider && llmModels[draft.agentProvider] ? llmModels[draft.agentProvider] : [].concat.apply([], Object.keys(llmModels).map(function(k) {
    return llmModels[k];
  }));
  return createElement(
    "div",
    { className: "form", key: "form" },
    createElement(
      "div",
      { className: "form-title" },
      form.editing ? dshT("\u270F\uFE0F \u7F16\u8F91\u5B50\u667A\u80FD\u4F53") : dshT("\u2728 \u65B0\u5EFA\u5B50\u667A\u80FD\u4F53"),
      createElement(
        "span",
        { style: { marginLeft: "auto", display: "flex", gap: "6px" } },
        createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: onClose, disabled: form.saving }, dshT("\u53D6\u6D88"))
      )
    ),
    form.error ? createElement("div", { className: "error-strip" }, "\u26A0\uFE0F ", form.error) : null,
    form.capabilityNotice ? createElement("div", { className: "warn-strip" }, "\u26A0\uFE0F ", form.capabilityNotice) : null,
    createElement(
      "div",
      { className: "form-grid" },
      createElement(
        "div",
        { className: "field" },
        createElement("span", { className: "field-label" }, dshT("\u5B9E\u4F8B ID")),
        createElement(import_dsh_client_ui_primitives.Input, {
          value: draft.id,
          disabled: form.editing,
          placeholder: dshT("\u5982 researcher\u3001code-reviewer"),
          onChange: function(event) {
            onPatch({ id: event.target.value });
          }
        }),
        createElement("span", { className: "field-hint" }, dshT("\u8865\u4E01\u884C\u6807\u8BC6\uFF0C\u521B\u5EFA\u540E\u4E0D\u53EF\u6539\uFF1B\u6301\u4E45\u5316\u5728 profile \u7684 cordis.patch.yml"))
      ),
      createElement(
        "div",
        { className: "field" },
        createElement("span", { className: "field-label" }, dshT("\u5B50\u667A\u80FD\u4F53\u540D\u79F0\uFF08\u6A21\u578B\u53EF\u89C1\u5DE5\u5177\u540D\uFF09")),
        createElement(import_dsh_client_ui_primitives.Input, {
          value: draft.toolName,
          placeholder: dshT("\u5982 web_researcher\uFF08\u6A21\u578B\u7528\u5B83\u53D1\u8D77\u59D4\u6258\uFF09"),
          onChange: function(event) {
            onPatch({ toolName: event.target.value });
          }
        }),
        createElement("span", { className: "field-hint" }, dshT("\u4E0D\u80FD\u7528\u4FDD\u7559\u540D subagent / subagent_fork / run_code\uFF0C\u4E14\u5404\u5B9E\u4F8B\u95F4\u552F\u4E00"))
      ),
      createElement(
        "div",
        { className: "field" },
        createElement("span", { className: "field-label" }, dshT("\u6267\u884C\u540E\u7AEF\uFF08provider\uFF09")),
        createElement(
          "select",
          {
            className: "input",
            value: draft.provider,
            disabled: form.saving,
            onChange: function(event) {
              onProviderChange(event.target.value);
            }
          },
          meta.providers.map(function(provider) {
            return createElement("option", { key: provider.name, value: provider.name }, provider.name);
          })
        ),
        createElement("span", { className: "field-hint" }, capabilityHint)
      ),
      advanced ? createElement(
        "div",
        { className: "field" },
        createElement("span", { className: "field-label" }, dshT("\u540E\u53F0\u6A21\u5F0F")),
        createElement(
          "select",
          {
            className: "input",
            value: draft.backgroundMode,
            disabled: form.saving,
            onChange: function(event) {
              onPatch({ backgroundMode: event.target.value });
            }
          },
          createElement("option", { value: "one-shot" }, dshT("one-shot\uFF08\u4E00\u6B21\u6027\u4EFB\u52A1\uFF09")),
          createElement("option", { value: "continuable", disabled: !providerInfo || providerInfo.continuable !== true }, dshT("continuable\uFF08\u53EF\u6301\u7EED\u4F1A\u8BDD\uFF09"))
        ),
        createElement(import_dsh_client_ui_primitives.Checkbox, {
          checked: draft.enableRunInBackground === true,
          disabled: form.saving,
          onChange: function(next) {
            onPatch({ enableRunInBackground: next });
          },
          label: dshT("\u66B4\u9732 run_in_background \u53C2\u6570"),
          className: "checkbox-row"
        })
      ) : null,
      createElement(
        "div",
        { className: "field full" },
        createElement("span", { className: "field-label" }, dshT("\u63D0\u793A\u8BCD\uFF08persona\uFF0C\u7559\u7A7A\u7EE7\u627F\u90E8\u7F72\u9ED8\u8BA4\uFF09")),
        createElement("textarea", {
          className: "input",
          value: draft.persona,
          rows: 4,
          disabled: form.saving || providerInfo?.capabilities.persona === false,
          placeholder: dshT("\u8BE5\u5B50\u667A\u80FD\u4F53\u7684\u4EBA\u8BBE/\u804C\u8D23\u8BF4\u660E\u2026\u652F\u6301 {{model}} \u4E0E {{cwd}} \u6A21\u677F\u53D8\u91CF"),
          onChange: function(event) {
            onPatch({ persona: event.target.value });
          }
        }),
        createElement("span", { className: "field-hint" }, providerInfo?.capabilities.persona === false ? dshT("\u5F53\u524D\u540E\u7AEF\u4E0D\u652F\u6301\u63D0\u793A\u8BCD\uFF1B\u5207\u6362\u540E\u7AEF\u65F6\u5DF2\u6709\u5185\u5BB9\u4F1A\u81EA\u52A8\u6E05\u9664") : dshT("\u4FDD\u5B58\u540E\u5F71\u5B50\u8986\u76D6\uFF08shadow\uFF09\u90E8\u7F72\u7EA7 persona\uFF0C\u4EC5\u5BF9\u8BE5\u5B50\u667A\u80FD\u4F53\u751F\u6548"))
      ),
      createElement(
        "div",
        { className: "field full" },
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          disabled: form.saving,
          onClick: onToggleAdvanced
        }, advanced ? dshT("\u6536\u8D77\u9AD8\u7EA7\u8BBE\u7F6E") : dshT("\u9AD8\u7EA7\u8BBE\u7F6E\uFF08\u5DE5\u5177\u3001\u6A21\u578B\u3001\u6DF1\u5EA6\u4E0E\u540E\u53F0\uFF09"))
      ),
      advanced ? createElement(
        "div",
        { className: "fieldset full" },
        createElement("span", { className: "fieldset-legend" }, dshT("\u5DE5\u5177\u7EA6\u675F\uFF08toolFilter\uFF0C\u7559\u7A7A\u5219\u4E0D\u9650\u5236\uFF1B\u53EF\u641C\u7D22\u548C\u624B\u52A8\u8F93\u5165\uFF0C\u4EC5\u5F53\u524D\u5019\u9009\u5DE5\u5177\u53EF\u4FDD\u5B58\uFF09")),
        createElement(
          "div",
          { className: "field" },
          createElement("span", { className: "field-label" }, dshT("\u4EC5\u5141\u8BB8\uFF08allow \u767D\u540D\u5355\uFF09")),
          createElement(Picker, {
            multi: true,
            kind: "allow",
            allowCustom: true,
            disabled: form.saving || providerInfo?.capabilities.toolFilter === false,
            values: draft.allow,
            options: candidateNames.map(function(n) {
              return { value: n, label: n };
            }),
            placeholder: dshT("\u8F93\u5165\u6216\u9009\u62E9\u5DE5\u5177\u540D\uFF0C\u5982 read / glob / grep"),
            ariaLabel: dshT("\u4EC5\u5141\u8BB8\u5DE5\u5177"),
            onChange: function(next) {
              onPatch({ allow: next });
            }
          }),
          createElement("span", { className: "field-hint" }, dshT("\u8BBE\u7F6E\u540E\u5B50\u667A\u80FD\u4F53\u53EA\u4FDD\u7559\u540D\u5355\u5185\u5DE5\u5177\uFF0C\u5176\u4F59\u4ECE\u63D0\u793A\u8BCD\u79FB\u9664\u4E14\u62D2\u7EDD\u6267\u884C"))
        ),
        createElement(
          "div",
          { className: "field" },
          createElement("span", { className: "field-label" }, dshT("\u7981\u6B62\uFF08deny \u9ED1\u540D\u5355\uFF09")),
          createElement(Picker, {
            multi: true,
            kind: "deny",
            allowCustom: true,
            disabled: form.saving || providerInfo?.capabilities.toolFilter === false,
            values: draft.deny,
            options: candidateNames.map(function(n) {
              return { value: n, label: n };
            }),
            placeholder: dshT("\u8F93\u5165\u6216\u9009\u62E9\u5DE5\u5177\u540D\uFF0C\u5982 bash / pwsh"),
            ariaLabel: dshT("\u7981\u6B62\u5DE5\u5177"),
            onChange: function(next) {
              onPatch({ deny: next });
            }
          }),
          createElement("span", { className: "field-hint" }, providerInfo?.capabilities.toolFilter === false ? dshT("\u5F53\u524D\u540E\u7AEF\u4E0D\u652F\u6301\u5DE5\u5177\u7EA6\u675F\uFF1B\u5207\u6362\u540E\u7AEF\u65F6\u5DF2\u6709\u7EA6\u675F\u4F1A\u81EA\u52A8\u6E05\u9664") : dshT("\u540D\u5355\u5185\u5DE5\u5177\u5BF9\u5B50\u667A\u80FD\u4F53\u4E0D\u53EF\u89C1\uFF1B\u624B\u52A8\u8F93\u5165\u7684\u5DE5\u5177\u4E5F\u5FC5\u987B\u5728\u5F53\u524D\u5019\u9009\u6E05\u5355\u5185\u624D\u53EF\u4FDD\u5B58"))
        )
      ) : null,
      advanced ? createElement(
        "div",
        { className: "fieldset full" },
        createElement("span", { className: "fieldset-legend" }, dshT("\u6A21\u578B\u6307\u5B9A\uFF08agentOptions\uFF0C\u7559\u7A7A\u5B57\u6BB5\u7EE7\u627F\u7236\u4EE3\u7406\u5F53\u524D\u8DEF\u7531\uFF09")),
        createElement(
          "div",
          { className: "form-grid" },
          createElement(
            "div",
            { className: "field" },
            createElement("span", { className: "field-label" }, "LLM provider"),
            createElement(Picker, {
              multi: false,
              allowCustom: true,
              values: draft.agentProvider ? [draft.agentProvider] : [],
              options: llmProviders.map(function(p) {
                return { value: p.id, label: p.name };
              }),
              placeholder: dshT("\u7559\u7A7A\u7EE7\u627F\uFF0C\u5982 optirouter / deepseek-official"),
              ariaLabel: "LLM provider",
              onChange: function(next) {
                onPatch({ agentProvider: next[0] || "" });
              }
            })
          ),
          createElement(
            "div",
            { className: "field" },
            createElement("span", { className: "field-label" }, dshT("\u6A21\u578B\u6807\u8BC6\uFF08model\uFF09")),
            createElement(Picker, {
              multi: false,
              allowCustom: true,
              values: draft.agentModel ? [draft.agentModel] : [],
              options: modelOptions.map(function(m) {
                return { value: m.id, label: m.name };
              }),
              placeholder: dshT("\u7559\u7A7A\u7EE7\u627F\uFF0C\u5982 auto"),
              ariaLabel: dshT("\u6A21\u578B\u6807\u8BC6"),
              onChange: function(next) {
                onPatch({ agentModel: next[0] || "" });
              }
            }),
            createElement("span", { className: "field-hint" }, dshT("\u4ECE\u5DF2\u914D\u7F6E\u6A21\u578B\u4E2D\u9009\u62E9\uFF0C\u6216\u624B\u586B\u6A21\u578B id\uFF08\u9700\u5728\u8BE5 provider \u8DEF\u7531\u4E0A\u6CE8\u518C\uFF09"))
          ),
          createElement(
            "div",
            { className: "field" },
            createElement("span", { className: "field-label" }, dshT("maxTokens\uFF08\u5355\u6B21\u56DE\u590D\u4E0A\u9650\uFF09")),
            createElement(import_dsh_client_ui_primitives.Input, {
              value: draft.maxTokens,
              placeholder: dshT("\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4"),
              inputMode: "numeric",
              onChange: function(event) {
                onPatch({ maxTokens: event.target.value.replace(/[^0-9]/g, "") });
              }
            })
          ),
          createElement(
            "div",
            { className: "field" },
            createElement("span", { className: "field-label" }, dshT("\u6700\u5927\u59D4\u6258\u6DF1\u5EA6\uFF08maxDepth\uFF0C0 = \u7981\u6B62\u518D\u59D4\u6258\uFF09")),
            createElement(
              "div",
              { style: { display: "flex", gap: "8px", alignItems: "center" } },
              createElement(import_dsh_client_ui_primitives.Input, {
                value: draft.maxDepth,
                disabled: form.saving || draft.maxDepthManaged || providerInfo?.capabilities.depthLimit === false,
                placeholder: dshT("3\uFF08\u9ED8\u8BA4\uFF09"),
                inputMode: "numeric",
                onChange: function(event) {
                  onPatch({ maxDepth: event.target.value.replace(/[^0-9]/g, "") });
                }
              }),
              createElement(
                "span",
                { style: { flex: "none" } },
                createElement(import_dsh_client_ui_primitives.Checkbox, {
                  checked: draft.maxDepthManaged,
                  disabled: form.saving || providerInfo?.capabilities.depthLimit === false,
                  onChange: function(next) {
                    onPatch({ maxDepthManaged: next });
                  },
                  label: dshT("\u4EA4\u7531\u540E\u7AEF\u7BA1\u7406"),
                  className: "checkbox-row"
                })
              )
            )
          )
        )
      ) : null
    ),
    createElement(
      "div",
      { className: "form-actions" },
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: onClose, disabled: form.saving }, dshT("\u53D6\u6D88")),
      createElement(
        import_dsh_client_ui_primitives.Button,
        { variant: "primary", size: "sm", onClick: onSave, disabled: form.saving },
        form.saving ? createElement(Spinner, { key: "spin" }) : null,
        dshT("\u4FDD\u5B58")
      )
    )
  );
}
function SubagentCard(props) {
  var entry = props.entry;
  var config = entry.config || {};
  var live = entry.live || {};
  var liveTag = live.providerPresent === false ? createElement("span", { className: "tag dead" }, dshT("\u274C \u540E\u7AEF\u672A\u6CE8\u518C")) : live.toolRegistered ? createElement("span", { className: "tag live" }, dshT("\u2705 \u5DF2\u6302\u8F7D")) : createElement("span", { className: "tag warn" }, dshT("\u26A0\uFE0F \u5DE5\u5177\u672A\u6302\u8F7D"));
  var hasModelRoute = config.agentOptions && (config.agentOptions.model || config.agentOptions.provider);
  var modelLabel = hasModelRoute ? (config.agentOptions.model || "") + (config.agentOptions.provider ? (config.agentOptions.model ? " @ " : "") + config.agentOptions.provider : "") : dshT("\u7EE7\u627F\u7236\u4EE3\u7406");
  var children = [
    createElement(
      "div",
      { className: "card-header", key: "head" },
      createElement("span", { className: "card-title" }, "\u{1F916} ", config.toolName || entry.id),
      createElement(
        "span",
        { className: "card-actions" },
        createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: function() {
          props.onEdit(entry);
        } }, dshT("\u7F16\u8F91")),
        createElement(ConfirmButton, {
          label: dshT("\u5220\u9664"),
          confirmLabel: dshT("\u786E\u8BA4\u5220\u9664\uFF1F"),
          onConfirm: function() {
            props.onRemove(entry);
          }
        })
      )
    ),
    createElement(
      "div",
      { className: "card-sub", key: "tags" },
      createElement("span", { className: "tag provider" }, "\u2699 " + (config.provider || "?")),
      createElement("span", { className: "tag model" }, "\u{1F9E0} " + modelLabel),
      createElement("span", { className: "tag" }, config.backgroundMode === "continuable" ? dshT("\u53EF\u6301\u7EED") : dshT("\u4E00\u6B21\u6027")),
      typeof config.maxDepth === "number" ? createElement("span", { className: "tag" }, dshT("\u6DF1\u5EA6\u2264") + config.maxDepth) : null,
      config.maxDepth === "provider-managed" ? createElement("span", { className: "tag" }, dshT("\u6DF1\u5EA6=\u540E\u7AEF\u7BA1\u7406")) : null,
      liveTag
    )
  ];
  if (config.persona) {
    children.push(createElement(
      "div",
      { className: "persona-box", key: "persona" },
      createElement("span", null, "\u{1F4DD}"),
      createElement("span", { className: "persona-text" }, config.persona)
    ));
  }
  var chips = [];
  if (config.toolFilter && config.toolFilter.allow && config.toolFilter.allow.length > 0) {
    chips.push(createElement("span", { key: "allow-label", style: { fontSize: "10px", color: "#047857", fontWeight: 600 } }, dshT("\u4EC5\u5141\u8BB8")));
    config.toolFilter.allow.forEach(function(name) {
      chips.push(createElement("span", { key: "a-" + name, className: "chip allow" }, name));
    });
  }
  if (config.toolFilter && config.toolFilter.deny && config.toolFilter.deny.length > 0) {
    chips.push(createElement("span", { key: "deny-label", style: { fontSize: "10px", color: "#b91c1c", fontWeight: 600 } }, dshT("\u7981\u6B62")));
    config.toolFilter.deny.forEach(function(name) {
      chips.push(createElement("span", { key: "d-" + name, className: "chip deny" }, name));
    });
  }
  if (chips.length > 0) {
    children.push(createElement("div", { className: "chips", key: "chips" }, chips));
  }
  children.push(createElement(
    "div",
    { className: "card-sub", key: "meta" },
    createElement("span", { className: "tag", title: entry.id }, "ID: " + entry.id),
    config.toolFilter === void 0 ? createElement("span", { className: "tag" }, dshT("\u5DE5\u5177\u4E0D\u9650\u5236")) : null
  ));
  return createElement("div", { className: "card", key: entry.id }, children);
}
function cliDraftFromConfig(config) {
  config = config || {};
  return {
    providerName: config.providerName !== void 0 ? String(config.providerName) : "",
    permissionMode: config.permissionMode !== void 0 ? String(config.permissionMode) : "",
    disposeGraceMs: config.disposeGraceMs !== void 0 ? String(config.disposeGraceMs) : "3000",
    envPairs: Object.keys(config.env || {}).map(function(key) {
      return { key, value: String(config.env[key]) };
    })
  };
}
function cliConfigFromDraft(draft) {
  var config = {
    providerName: draft.providerName.trim(),
    permissionMode: draft.permissionMode,
    disposeGraceMs: Number(draft.disposeGraceMs.trim()),
    env: {}
  };
  draft.envPairs.forEach(function(pair) {
    var key = pair.key.trim();
    if (key !== "") config.env[key] = pair.value;
  });
  return config;
}
function EnvPairsEditor(props) {
  var pairs = props.pairs || [];
  return createElement(
    "div",
    { className: "fieldset" },
    createElement("span", { className: "fieldset-legend" }, dshT("env\uFF08\u4F20\u7ED9 CLI \u5B50\u8FDB\u7A0B\u7684\u989D\u5916\u73AF\u5883\u53D8\u91CF\uFF09")),
    pairs.map(function(pair, index) {
      return createElement(
        "div",
        { className: "env-row", key: index },
        createElement(import_dsh_client_ui_primitives.Input, {
          value: pair.key,
          placeholder: dshT("\u53D8\u91CF\u540D\uFF08\u5982 OPENAI_API_KEY\uFF09"),
          onChange: function(event) {
            props.onPatchPair(index, { key: event.target.value });
          }
        }),
        createElement(import_dsh_client_ui_primitives.Input, {
          // 受控：宿主只投影掩码后的空值（write-only 契约），草稿值就是唯一
          // 真相——非受控 + key:index 的组合会在删除中间行时让 DOM 残留文本与
          // 底层草稿错位，保存写入与屏幕不符的值。
          value: pair.value,
          placeholder: dshT("\u53D8\u91CF\u503C"),
          onChange: function(event) {
            props.onPatchPair(index, { value: event.target.value });
          }
        }),
        createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: function() {
          props.onRemove(index);
        } }, "\u2715")
      );
    }),
    createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", onClick: props.onAdd }, dshT("\uFF0B \u6DFB\u52A0\u53D8\u91CF"))
  );
}
function CliBackendCard(props) {
  var backend = props.backend;
  var draft = props.draft;
  var busy = props.busy === true;
  var expanded = props.expanded === true;
  var onPatch = props.onPatch;
  var onPatchEnvPair = props.onPatchEnvPair;
  var onAddEnvPair = props.onAddEnvPair;
  var onRemoveEnvPair = props.onRemoveEnvPair;
  var onToggle = props.onToggle;
  var onSave = props.onSave;
  var onInstall = props.onInstall;
  var onUnmount = props.onUnmount;
  var packageOk = !!(backend.providerPackage && backend.providerPackage.ok);
  var runner = backend.runner || { ok: false, version: null };
  var cli = backend.cli || { ok: false, version: null };
  var missingPackages = backend.missing || [];
  var depsMissing = missingPackages.length > 0;
  var missingLabel = missingPackages.join(" + ");
  var modeValue = backend.permissionModes.indexOf(draft.permissionMode) !== -1 ? draft.permissionMode : backend.permissionModes[0];
  return createElement(
    "div",
    { className: "card", key: backend.id },
    createElement(
      "div",
      { className: "card-header" },
      createElement("button", {
        type: "button",
        className: "cli-toggle",
        "aria-expanded": expanded,
        "aria-label": expanded ? dshT("\u6536\u8D77\u660E\u7EC6") : dshT("\u5C55\u5F00\u660E\u7EC6"),
        title: expanded ? dshT("\u6536\u8D77\u660E\u7EC6") : dshT("\u5C55\u5F00\u660E\u7EC6"),
        onClick: onToggle
      }, expanded ? "\u25BE" : "\u25B8"),
      createElement("span", { className: "cli-title", onClick: onToggle }, "\u{1F50C} " + backend.label),
      createElement(
        "span",
        { className: "cli-tags" },
        createElement("span", { className: "tag " + (backend.mounted ? "live" : "") }, backend.mounted ? dshT("\u5DF2\u6302\u8F7D") : dshT("\u672A\u6302\u8F7D")),
        createElement(
          "span",
          { className: "tag " + (packageOk ? "live" : "dead") },
          packageOk ? dshT("provider \u5305") + (backend.providerPackage.version ? " v" + backend.providerPackage.version : " \u2713") : dshT("provider \u5305 \u2717")
        ),
        createElement(
          "span",
          { className: "tag " + (runner.ok ? "live" : "warn") },
          runner.ok ? dshT("CLI \u4F9D\u8D56 \u2713") : dshT("CLI \u4F9D\u8D56 \u2717")
        ),
        createElement(
          "span",
          { className: "tag " + (cli.ok ? "model" : "warn") },
          cli.ok ? "PATH " + (cli.version || dshT("\u5DF2\u5B89\u88C5")) : "PATH \u2717 " + backend.cliCommand
        )
      ),
      createElement(
        "span",
        { style: { display: "flex", gap: "5px", flex: "none" } },
        depsMissing ? createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          disabled: busy,
          title: dshT("npm install -g \u5168\u5C40\u5B89\u88C5\u7F3A\u5931\u5305\uFF1A") + missingLabel,
          onClick: onInstall
        }, busy ? createElement(Spinner, { key: "spin" }) : null, busy ? dshT("\u5B89\u88C5\u4E2D\u2026") : dshT("\u5B89\u88C5\u4F9D\u8D56\u5305")) : null,
        backend.mounted ? createElement(
          import_dsh_client_ui_primitives.Button,
          { variant: "primary", size: "sm", disabled: busy, onClick: onSave },
          busy ? createElement(Spinner, { key: "spin" }) : null,
          dshT("\u4FDD\u5B58\u914D\u7F6E")
        ) : packageOk ? createElement(
          import_dsh_client_ui_primitives.Button,
          { variant: "primary", size: "sm", disabled: busy, onClick: onSave },
          busy ? createElement(Spinner, { key: "spin" }) : null,
          dshT("\u6302\u8F7D")
        ) : null,
        backend.mounted ? createElement(ConfirmButton, { label: dshT("\u5378\u8F7D"), confirmLabel: dshT("\u786E\u8BA4\u5378\u8F7D\uFF1F"), disabled: busy, onConfirm: onUnmount }) : null
      )
    ),
    expanded ? createElement(
      "div",
      { className: "cli-detail", key: "detail" },
      createElement(
        "div",
        { className: "form-grid" },
        createElement(
          "div",
          { className: "field" },
          createElement("span", { className: "field-label" }, dshT("providerName\uFF08\u6267\u884C\u540E\u7AEF\u6CE8\u518C\u540D\uFF09")),
          createElement(import_dsh_client_ui_primitives.Input, {
            value: draft.providerName,
            placeholder: dshT("\u5982 codex / claude-code\uFF08\u5B50\u667A\u80FD\u4F53\u8868\u5355\u7684\u6267\u884C\u540E\u7AEF\u9009\u9879\uFF09"),
            onChange: function(event) {
              onPatch({ providerName: event.target.value });
            }
          })
        ),
        createElement(
          "div",
          { className: "field" },
          createElement("span", { className: "field-label" }, dshT("permissionMode\uFF08CLI \u6743\u9650\u6A21\u5F0F\uFF09")),
          createElement("select", {
            className: "input",
            value: modeValue,
            onChange: function(event) {
              onPatch({ permissionMode: event.target.value });
            }
          }, backend.permissionModes.map(function(mode) {
            return createElement("option", { key: mode, value: mode }, mode);
          })),
          createElement("span", { className: "field-hint" }, dshT("\u679A\u4E3E\u6765\u81EA\u8BE5 provider \u5305\u7684 Config schema"))
        ),
        createElement(
          "div",
          { className: "field" },
          createElement("span", { className: "field-label" }, dshT("disposeGraceMs\uFF08\u8FDB\u7A0B\u6811\u7EC8\u6B62\u5BBD\u9650\uFF0C\u6BEB\u79D2\uFF09")),
          createElement(import_dsh_client_ui_primitives.Input, {
            value: draft.disposeGraceMs,
            placeholder: "3000",
            onChange: function(event) {
              onPatch({ disposeGraceMs: event.target.value });
            }
          })
        )
      ),
      createElement(EnvPairsEditor, {
        pairs: draft.envPairs,
        onPatchPair: onPatchEnvPair,
        onAdd: onAddEnvPair,
        onRemove: onRemoveEnvPair
      })
    ) : null
  );
}
function cliDraftFromGeneric(backend) {
  backend = backend || {};
  return {
    command: backend.command !== void 0 ? String(backend.command) : "",
    argsText: Array.isArray(backend.args) ? backend.args.join(" ") : "{prompt}",
    providerName: backend.providerName !== void 0 ? String(backend.providerName) : "",
    disposeGraceMs: backend.disposeGraceMs !== void 0 ? String(backend.disposeGraceMs) : "3000",
    envPairs: Object.keys(backend.env || {}).map(function(key) {
      return { key, value: String(backend.env[key]) };
    })
  };
}
function cliConfigFromGenericDraft(draft) {
  var config = {
    command: draft.command.trim(),
    args: draft.argsText.trim().split(/\s+/).filter(Boolean),
    providerName: draft.providerName.trim(),
    disposeGraceMs: Number(draft.disposeGraceMs.trim()),
    env: {}
  };
  draft.envPairs.forEach(function(pair) {
    var key = pair.key.trim();
    if (key !== "") config.env[key] = pair.value;
  });
  return config;
}
function GenericCliCard(props) {
  var backend = props.backend;
  var draft = props.draft;
  var busy = props.busy === true;
  var expanded = props.expanded === true;
  var onToggle = props.onToggle;
  var onPatch = props.onPatch;
  var onPatchEnvPair = props.onPatchEnvPair;
  var onAddEnvPair = props.onAddEnvPair;
  var onRemoveEnvPair = props.onRemoveEnvPair;
  var onSave = props.onSave;
  var onUnmount = props.onUnmount;
  var cli = backend.cli || { ok: false, version: null };
  return createElement(
    "div",
    { className: "card", key: backend.id },
    createElement(
      "div",
      { className: "card-header" },
      createElement("button", {
        type: "button",
        className: "cli-toggle",
        "aria-expanded": expanded,
        "aria-label": expanded ? dshT("\u6536\u8D77\u660E\u7EC6") : dshT("\u5C55\u5F00\u660E\u7EC6"),
        title: expanded ? dshT("\u6536\u8D77\u660E\u7EC6") : dshT("\u5C55\u5F00\u660E\u7EC6"),
        onClick: onToggle
      }, expanded ? "\u25BE" : "\u25B8"),
      createElement("span", { className: "cli-title", onClick: onToggle }, "\u2328\uFE0F " + backend.command),
      createElement(
        "span",
        { className: "cli-tags" },
        createElement("span", { className: "tag live" }, dshT("\u5DF2\u6302\u8F7D")),
        createElement(
          "span",
          { className: "tag " + (backend.providerPresent ? "live" : "warn") },
          backend.providerPresent ? dshT("\u540E\u7AEF\u5728\u7EBF \u2713") : dshT("\u540E\u7AEF\u672A\u6CE8\u518C")
        ),
        createElement(
          "span",
          { className: "tag " + (cli.ok ? "model" : "warn") },
          cli.ok ? "PATH " + (cli.version || dshT("\u5DF2\u5B89\u88C5")) : "PATH \u2717 " + backend.command
        )
      ),
      createElement(
        "span",
        { style: { display: "flex", gap: "5px", flex: "none" } },
        createElement(
          import_dsh_client_ui_primitives.Button,
          { variant: "primary", size: "sm", disabled: busy, onClick: onSave },
          busy ? createElement(Spinner, { key: "spin" }) : null,
          dshT("\u4FDD\u5B58\u914D\u7F6E")
        ),
        createElement(ConfirmButton, { label: dshT("\u5378\u8F7D"), confirmLabel: dshT("\u786E\u8BA4\u5378\u8F7D\uFF1F"), disabled: busy, onConfirm: onUnmount })
      )
    ),
    expanded ? createElement(
      "div",
      { className: "cli-detail", key: "detail" },
      createElement(
        "div",
        { className: "form-grid" },
        createElement(
          "div",
          { className: "field" },
          createElement("span", { className: "field-label" }, dshT("command\uFF08PATH \u547D\u4EE4\u540D\u6216\u7EDD\u5BF9\u8DEF\u5F84\uFF09")),
          createElement(import_dsh_client_ui_primitives.Input, {
            value: draft.command,
            placeholder: dshT("\u5982 gemini / qwen / C:\\tools\\aider.exe"),
            onChange: function(event) {
              onPatch({ command: event.target.value });
            }
          })
        ),
        createElement(
          "div",
          { className: "field" },
          createElement("span", { className: "field-label" }, dshT("providerName\uFF08\u6267\u884C\u540E\u7AEF\u6CE8\u518C\u540D\uFF09")),
          createElement(import_dsh_client_ui_primitives.Input, {
            value: draft.providerName,
            placeholder: dshT("\u5982 cli-gemini\uFF08\u5B50\u667A\u80FD\u4F53\u8868\u5355\u7684\u6267\u884C\u540E\u7AEF\u9009\u9879\uFF09"),
            onChange: function(event) {
              onPatch({ providerName: event.target.value });
            }
          })
        ),
        createElement(
          "div",
          { className: "field full" },
          createElement("span", { className: "field-label" }, dshT("args\uFF08\u7A7A\u683C\u5206\u9694\uFF0C{prompt} \u5360\u4F4D\u63D0\u793A\u8BCD\uFF09")),
          createElement(import_dsh_client_ui_primitives.Input, {
            value: draft.argsText,
            placeholder: "-p {prompt}",
            onChange: function(event) {
              onPatch({ argsText: event.target.value });
            }
          }),
          createElement("span", { className: "field-hint" }, dshT("one-shot \u7EAF\u6587\u672C\uFF1Astdout \u5373\u59D4\u6258\u7ED3\u679C\uFF0C\u975E\u96F6\u9000\u51FA\u8BB0\u4E3A\u5931\u8D25\uFF1Bprompt \u7ECF {prompt} \u4F20\u5165"))
        ),
        createElement(
          "div",
          { className: "field" },
          createElement("span", { className: "field-label" }, dshT("disposeGraceMs\uFF08\u8FDB\u7A0B\u6811\u7EC8\u6B62\u5BBD\u9650\uFF0C\u6BEB\u79D2\uFF09")),
          createElement(import_dsh_client_ui_primitives.Input, {
            value: draft.disposeGraceMs,
            placeholder: "3000",
            onChange: function(event) {
              onPatch({ disposeGraceMs: event.target.value });
            }
          })
        )
      ),
      createElement(EnvPairsEditor, {
        pairs: draft.envPairs,
        onPatchPair: onPatchEnvPair,
        onAdd: onAddEnvPair,
        onRemove: onRemoveEnvPair
      })
    ) : null
  );
}
function CliPanel(props) {
  var call = props.call;
  var viewState = useState({ loading: true, error: null, data: null });
  var view = viewState[0];
  var setView = viewState[1];
  var draftsState = useState({});
  var drafts = draftsState[0];
  var setDrafts = draftsState[1];
  var busyState = useState({});
  var busy = busyState[0];
  var setBusy = busyState[1];
  var customCommandState = useState("");
  var customCommand = customCommandState[0];
  var setCustomCommand = customCommandState[1];
  var expandedState = useState({});
  var expanded = expandedState[0];
  var setExpanded = expandedState[1];
  var toggleExpanded = function(backendId) {
    setExpanded(function(prev) {
      var next = Object.assign({}, prev);
      next[backendId] = prev[backendId] !== true;
      return next;
    });
  };
  var markBusy = function(key) {
    setBusy(function(prev) {
      if (prev[key] === true) return prev;
      var next = Object.assign({}, prev);
      next[key] = true;
      return next;
    });
  };
  var clearBusy = function(key) {
    setBusy(function(prev) {
      if (prev[key] !== true) return prev;
      var next = Object.assign({}, prev);
      delete next[key];
      return next;
    });
  };
  var toastState = useState(null);
  var toast = toastState[0];
  var setToast = toastState[1];
  useEffect(function() {
    if (!toast) return void 0;
    var timer = setTimeout(function() {
      setToast(null);
    }, 4200);
    return function() {
      clearTimeout(timer);
    };
  }, [toast]);
  var absorb = function(result) {
    setView({ loading: false, error: null, data: result });
    var next = {};
    (result.backends || []).forEach(function(backend) {
      next[backend.id] = backend.kind === "generic" ? cliDraftFromGeneric(backend) : cliDraftFromConfig(backend.config);
    });
    setDrafts(next);
    setBusy({});
  };
  var adopt = function(result) {
    setView({ loading: false, error: null, data: result });
  };
  var reload = function() {
    setView(function(prev) {
      return Object.assign({}, prev, { loading: true, error: null });
    });
    call("subagentAdmin/cliList", {}).then(function(raw) {
      absorb(unwrap(raw));
    }).catch(function(error) {
      setView({ loading: false, error: String(error && error.message || error), data: null });
    });
  };
  useEffect(reload, []);
  var patchDraft = function(backendId, patch) {
    setDrafts(function(prev) {
      var current = prev[backendId] || cliDraftFromConfig(null);
      var next = Object.assign({}, prev);
      next[backendId] = Object.assign({}, current, patch);
      return next;
    });
  };
  var patchEnvPair = function(backendId, index, patch) {
    setDrafts(function(prev) {
      var current = prev[backendId] || cliDraftFromConfig(null);
      var pairs = (current.envPairs || []).map(function(pair, i) {
        return i === index ? Object.assign({}, pair, patch) : pair;
      });
      var next = Object.assign({}, prev);
      next[backendId] = Object.assign({}, current, { envPairs: pairs });
      return next;
    });
  };
  var addEnvPair = function(backendId) {
    setDrafts(function(prev) {
      var current = prev[backendId] || cliDraftFromConfig(null);
      var next = Object.assign({}, prev);
      next[backendId] = Object.assign({}, current, { envPairs: (current.envPairs || []).concat([{ key: "", value: "" }]) });
      return next;
    });
  };
  var removeEnvPair = function(backendId, index) {
    setDrafts(function(prev) {
      var current = prev[backendId] || cliDraftFromConfig(null);
      var next = Object.assign({}, prev);
      next[backendId] = Object.assign({}, current, { envPairs: (current.envPairs || []).filter(function(_, i) {
        return i !== index;
      }) });
      return next;
    });
  };
  var runUpsert = function(backend) {
    if (busy[backend.id]) return;
    var draft = drafts[backend.id];
    if (!draft) return;
    var payload;
    if (backend.kind === "generic") {
      if (!/^[^\s]+$/.test(draft.command.trim())) {
        setToast(dshT("command \u4E0D\u80FD\u5305\u542B\u7A7A\u683C\uFF08PATH \u547D\u4EE4\u540D\u6216\u7EDD\u5BF9\u8DEF\u5F84\uFF09"));
        return;
      }
      var args = draft.argsText.trim().split(/\s+/).filter(Boolean);
      if (args.length === 0 || args.length > 20 || !args.every(function(arg) {
        return arg.length <= 256;
      })) {
        setToast(dshT("args \u5FC5\u987B\u662F 1-20 \u4E2A\u975E\u7A7A\u7247\u6BB5\uFF08\u5355\u6761 \u2264 256 \u5B57\u7B26\uFF09\uFF0C\u7528 {prompt} \u5360\u4F4D\u63D0\u793A\u8BCD"));
        return;
      }
      if (args.indexOf("{prompt}") === -1) {
        setToast(dshT("args \u5FC5\u987B\u5305\u542B {prompt} \u5360\u4F4D\u7B26\uFF08\u63D0\u793A\u8BCD\u5C06\u66FF\u6362\u8BE5\u5360\u4F4D\u7B26\u4F20\u5165 CLI\uFF09"));
        return;
      }
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(draft.providerName.trim())) {
        setToast(dshT("providerName \u5FC5\u987B\u662F 1-48 \u4F4D\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u4E2D\u5212\u7EBF\u4E14\u5B57\u6BCD\u5F00\u5934"));
        return;
      }
      if (!/^\d+$/.test(draft.disposeGraceMs.trim())) {
        setToast(dshT("disposeGraceMs \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570\uFF08\u6BEB\u79D2\uFF09"));
        return;
      }
      payload = { kind: "generic", backendId: backend.id, config: cliConfigFromGenericDraft(draft) };
    } else {
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(draft.providerName.trim())) {
        setToast(dshT("providerName \u5FC5\u987B\u662F 1-48 \u4F4D\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u4E2D\u5212\u7EBF\u4E14\u5B57\u6BCD\u5F00\u5934"));
        return;
      }
      if (!/^\d+$/.test(draft.disposeGraceMs.trim())) {
        setToast(dshT("disposeGraceMs \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570\uFF08\u6BEB\u79D2\uFF09"));
        return;
      }
      payload = { backendId: backend.id, config: cliConfigFromDraft(draft) };
    }
    var busyKey = backend.id;
    markBusy(busyKey);
    call("subagentAdmin/cliUpsert", { payload }).then(function(raw) {
      adopt(unwrap(raw));
      clearBusy(busyKey);
    }).catch(function(error) {
      clearBusy(busyKey);
      setToast(dshT("\u4FDD\u5B58\u5931\u8D25\uFF1A") + String(error && error.message || error));
    });
  };
  var runUnmount = function(backend) {
    if (busy[backend.id]) return;
    markBusy(backend.id);
    call("subagentAdmin/cliRemove", { id: backend.id }).then(function(raw) {
      adopt(unwrap(raw));
      clearBusy(backend.id);
    }).catch(function(error) {
      clearBusy(backend.id);
      setToast(dshT("\u5378\u8F7D\u5931\u8D25\uFF1A") + String(error && error.message || error));
    });
  };
  var runInstall = function(backend) {
    if (busy[backend.id]) return;
    markBusy(backend.id);
    call("subagentAdmin/cliInstall", { backendId: backend.id }).then(function(raw) {
      var result = unwrap(raw);
      adopt(result);
      clearBusy(backend.id);
      setToast((result && result.output ? result.output : dshT("\u4F9D\u8D56\u5305\u5B89\u88C5\u5B8C\u6210")) + dshT("\uFF0C\u5DF2\u91CD\u65B0\u68C0\u6D4B"));
    }).catch(function(error) {
      var message = String(error && error.message || error);
      if (message.indexOf("404") !== -1) {
        message += dshT("\uFF08\u5BBF\u4E3B\u7AEF\u672A\u6CE8\u518C\u8BE5\u63A5\u53E3\uFF1A\u8BF7\u91CD\u542F dsh \u52A0\u8F7D\u6700\u65B0\u63D2\u4EF6\u540E\u91CD\u8BD5\uFF09");
      }
      clearBusy(backend.id);
      setToast(dshT("\u5B89\u88C5\u5931\u8D25\uFF1A") + message);
    });
  };
  var runGenericMount = function(command) {
    if (!/^[^\s]+$/.test(command)) {
      setToast(dshT("command \u4E0D\u80FD\u5305\u542B\u7A7A\u683C\uFF08PATH \u547D\u4EE4\u540D\u6216\u7EDD\u5BF9\u8DEF\u5F84\uFF09"));
      return;
    }
    markBusy("__scan__");
    call("subagentAdmin/cliUpsert", { payload: { kind: "generic", config: { command } } }).then(function(raw) {
      adopt(unwrap(raw));
      clearBusy("__scan__");
      setCustomCommand("");
    }).catch(function(error) {
      clearBusy("__scan__");
      setToast(dshT("\u6302\u8F7D\u5931\u8D25\uFF1A") + String(error && error.message || error));
    });
  };
  var children = [];
  var backends = view.data && view.data.backends || [];
  var others = view.data && view.data.others || [];
  var busyAny = Object.keys(busy).some(function(key) {
    return busy[key] === true;
  });
  var genericBackends = backends.filter(function(backend) {
    return backend.kind === "generic";
  });
  children.push(createElement(
    "div",
    { className: "card", key: "local-cli" },
    createElement(
      "div",
      { className: "card-header" },
      createElement("span", { className: "card-title" }, dshT("\u{1F6F0}\uFE0F \u672C\u673A CLI")),
      createElement("span", { className: "tag" }, dshT("\u901A\u7528\u547D\u4EE4\u884C\u540E\u7AEF \xB7 one-shot \u7EAF\u6587\u672C")),
      createElement(
        "span",
        { style: { marginLeft: "auto", display: "flex" } },
        createElement(
          import_dsh_client_ui_primitives.Button,
          { variant: "outline", size: "sm", onClick: reload, disabled: view.loading },
          view.loading ? createElement(Spinner, { key: "spin" }) : "\u27F3",
          dshT("\u91CD\u65B0\u68C0\u6D4B")
        )
      )
    ),
    createElement(
      "div",
      { className: "cli-scan-hint" },
      dshT("\u68C0\u6D4B\u5E76\u6302\u8F7D harness \u5185\u7F6E\u7684\u5916\u90E8 CLI \u540E\u7AEF\uFF08codex / claude-code\uFF09\u4E0E\u672C\u673A\u5176\u4ED6\u547D\u4EE4\u884C\u5DE5\u5177\uFF1B\u6302\u8F7D\u540E\u5373\u53EF\u5728\u300C\u5B50\u667A\u80FD\u4F53\u300D\u8868\u5355\u7684\u6267\u884C\u540E\u7AEF\u4E0B\u62C9\u4E2D\u9009\u7528\u3002")
    ),
    createElement(
      "div",
      { className: "cli-scan-list" },
      createElement(
        "div",
        { className: "cli-scan-row", key: "custom" },
        createElement(import_dsh_client_ui_primitives.Input, {
          value: customCommand,
          placeholder: dshT("\u6DFB\u52A0\u81EA\u5B9A\u4E49 CLI\uFF1A\u8F93\u5165\u547D\u4EE4\u540D\u6216\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u5982 aider\uFF08\u6302\u8F7D\u4E3A one-shot \u540E\u7AEF\uFF09"),
          onChange: function(event) {
            setCustomCommand(event.target.value);
          }
        }),
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          disabled: busyAny || customCommand.trim() === "",
          onClick: function() {
            runGenericMount(customCommand.trim());
          }
        }, dshT("\u6302\u8F7D"))
      ),
      (function() {
        var mountedCommands = new Set(genericBackends.map(function(backend) {
          return backend.command.toLowerCase();
        }));
        return others.filter(function(item) {
          return !!(item.cli && item.cli.ok);
        }).filter(function(item) {
          return !mountedCommands.has(item.name.toLowerCase());
        }).map(function(item) {
          return createElement(
            "div",
            { className: "cli-scan-card", key: item.name },
            createElement("span", { className: "cli-title" }, "\u2328\uFE0F " + item.name),
            createElement(
              "span",
              { className: "cli-tags" },
              createElement("span", { className: "tag" }, dshT("\u672A\u6302\u8F7D")),
              createElement("span", { className: "tag live" }, "PATH " + (item.cli.version || dshT("\u5DF2\u5B89\u88C5")))
            ),
            createElement(import_dsh_client_ui_primitives.Button, {
              variant: "outline",
              size: "sm",
              disabled: busyAny,
              onClick: function() {
                runGenericMount(item.name);
              }
            }, dshT("\u6302\u8F7D"))
          );
        });
      })(),
      others.length > 0 && others.every(function(item) {
        return !(item.cli && item.cli.ok);
      }) ? createElement("span", { className: "tag", key: "none" }, dshT("\u672A\u68C0\u6D4B\u5230\u5176\u4ED6 agent CLI")) : null
    )
  ));
  if (view.error) {
    children.push(createElement("div", { className: "error-strip", key: "error" }, dshT("\u26A0\uFE0F \u52A0\u8F7D\u5931\u8D25\uFF1A"), view.error));
  } else {
    genericBackends.forEach(function(backend) {
      children.push(GenericCliCard({
        backend,
        draft: drafts[backend.id] || cliDraftFromGeneric(backend),
        busy: busy[backend.id] === true,
        expanded: expanded[backend.id] === true,
        onToggle: function() {
          toggleExpanded(backend.id);
        },
        onPatch: function(patch) {
          patchDraft(backend.id, patch);
        },
        onPatchEnvPair: function(index, patch) {
          patchEnvPair(backend.id, index, patch);
        },
        onAddEnvPair: function() {
          addEnvPair(backend.id);
        },
        onRemoveEnvPair: function(index) {
          removeEnvPair(backend.id, index);
        },
        onSave: function() {
          runUpsert(backend);
        },
        onUnmount: function() {
          runUnmount(backend);
        }
      }));
    });
    backends.filter(function(backend) {
      return backend.kind !== "generic";
    }).forEach(function(backend) {
      children.push(CliBackendCard({
        backend,
        draft: drafts[backend.id] || cliDraftFromConfig(backend.config),
        busy: busy[backend.id] === true,
        expanded: expanded[backend.id] === true,
        onToggle: function() {
          toggleExpanded(backend.id);
        },
        onPatch: function(patch) {
          patchDraft(backend.id, patch);
        },
        onPatchEnvPair: function(index, patch) {
          patchEnvPair(backend.id, index, patch);
        },
        onAddEnvPair: function() {
          addEnvPair(backend.id);
        },
        onRemoveEnvPair: function(index) {
          removeEnvPair(backend.id, index);
        },
        onSave: function() {
          runUpsert(backend);
        },
        onInstall: function() {
          runInstall(backend);
        },
        onUnmount: function() {
          runUnmount(backend);
        }
      }));
    });
  }
  return createElement(
    "div",
    null,
    toast ? createElement("div", { className: "toast" }, toast) : null,
    children
  );
}
function SubagentAdminSection(props) {
  var tabState = useState("subagents");
  var activeTab = tabState[0];
  var setActiveTab = tabState[1];
  var tabs = [
    { id: "subagents", label: dshT("\u5B50\u667A\u80FD\u4F53"), component: SubagentsPanel },
    { id: "cli", label: dshT("CLI \u540E\u7AEF"), component: CliPanel }
  ];
  var selected = tabs.find(function(tab) {
    return tab.id === activeTab;
  }) || tabs[0];
  return createElement(
    "div",
    { "data-dsh-sa-section": "" },
    createElement(
      "div",
      {
        className: "tabs",
        role: "tablist",
        "aria-label": dshT("\u5B50\u667A\u80FD\u4F53\u7BA1\u7406"),
        onKeyDown: function(event) {
          tabKeyDown(event, tabs, selected.id, setActiveTab);
        }
      },
      tabs.map(function(tab) {
        return createElement("button", {
          type: "button",
          key: tab.id,
          className: "tab" + (tab.id === selected.id ? " active" : ""),
          role: "tab",
          id: "dsh-admin-tab-" + tab.id,
          "aria-controls": "dsh-admin-panel-" + tab.id,
          tabIndex: tab.id === selected.id ? 0 : -1,
          "aria-selected": tab.id === selected.id,
          onClick: function() {
            setActiveTab(tab.id);
          }
        }, tab.label);
      })
    ),
    createElement(
      "div",
      { key: selected.id, role: "tabpanel", id: "dsh-admin-panel-" + selected.id, "aria-labelledby": "dsh-admin-tab-" + selected.id },
      createElement(selected.component, { call: props.call })
    )
  );
}

// src/client/panels/shared.js
function safeLocalStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch (e) {
    return null;
  }
}
function Spinner() {
  return createElement("span", { className: "spinner" });
}
function ConfirmButton(props) {
  var armed = useState(false);
  var isArmed = armed[0];
  var setArmed = armed[1];
  var timer = useRef(null);
  useEffect(function() {
    return function() {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  var label = isArmed ? props.confirmLabel || dshT("\u786E\u8BA4\uFF1F") : props.label;
  return createElement(import_dsh_client_ui_primitives.Button, {
    type: "button",
    variant: "outline",
    size: "sm",
    className: isArmed ? "danger-solid" : "danger",
    disabled: props.disabled === true,
    onClick: function() {
      if (!isArmed) {
        setArmed(true);
        timer.current = setTimeout(function() {
          setArmed(false);
        }, 3200);
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      setArmed(false);
      props.onConfirm();
    }
  }, label);
}
function tabKeyDown(event, tabs, selectedId, select) {
  var delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  var at = -1;
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].id === selectedId) {
      at = i;
      break;
    }
  }
  if (at === -1) return false;
  var to = -1;
  if (delta !== 0) to = (at + delta + tabs.length) % tabs.length;
  else if (event.key === "Home") to = 0;
  else if (event.key === "End") to = tabs.length - 1;
  if (to === -1 || to === at) return false;
  event.preventDefault();
  select(tabs[to].id);
  var bar = (
    /** @type {Element|null} */
    event.currentTarget
  );
  var nodes = bar !== null ? bar.querySelectorAll('[role="tab"]') : [];
  var node = nodes[to];
  if (node) /** @type {HTMLElement} */
  node.focus();
  return true;
}
var pickerIdSeq = 0;
function Picker(props) {
  var multi = props.multi === true;
  var disabled = props.disabled === true;
  var values = props.values || [];
  var options = props.options || [];
  var allowCustom = props.allowCustom !== false;
  var textState = useState("");
  var text = textState[0];
  var setText = textState[1];
  var openState = useState(false);
  var open = openState[0];
  var setOpen = openState[1];
  var highlightState = useState(0);
  var highlight = highlightState[0];
  var setHighlight = highlightState[1];
  var idState = useState(function() {
    return "sa-picker-" + ++pickerIdSeq;
  });
  var listId = idState[0] + "-list";
  var selected = (
    /** @type {Record<string, boolean>} */
    {}
  );
  for (var si = 0; si < values.length; si++) selected[values[si]] = true;
  var filtered = options.filter(function(o) {
    if (multi && selected[o.value]) return false;
    var q = text.trim().toLowerCase();
    if (q === "") return true;
    var label = (o.label || o.value).toLowerCase();
    return label.indexOf(q) !== -1 || o.value.toLowerCase().indexOf(q) !== -1;
  });
  var activeDescendant = open && !disabled && filtered.length > 0 && highlight >= 0 && highlight < filtered.length ? listId + "-opt-" + highlight : void 0;
  function emit(next) {
    if (!disabled) props.onChange(next);
  }
  function pick(opt) {
    if (multi) {
      if (selected[opt.value] || !TOOL_REF_RE.test(opt.value)) return;
      emit(values.concat([opt.value]));
      setText("");
      setHighlight(0);
      setOpen(true);
    } else {
      emit([opt.value]);
      setText("");
      setOpen(false);
    }
  }
  function addTyped(v) {
    var val = (v || "").trim();
    if (val === "") return;
    if (multi && (selected[val] || !TOOL_REF_RE.test(val))) return;
    emit(multi ? values.concat([val]) : [val]);
    setText("");
    setHighlight(0);
  }
  function onInputChange(e) {
    if (disabled) return;
    var v = e.target.value;
    setText(v);
    setOpen(true);
    setHighlight(0);
    if (!multi) emit([v]);
  }
  function onKeyDown(e) {
    if (disabled) return;
    var live = (e && e.target && typeof e.target.value === "string" ? e.target.value : text).trim();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(function(h) {
        return Math.min(h + 1, filtered.length - 1);
      });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(function(h) {
        return Math.max(h - 1, 0);
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0 && highlight >= 0 && highlight < filtered.length) {
        var hl = filtered[highlight];
        if (live === "" || live === hl.value || live === (hl.label || hl.value)) {
          pick(hl);
          return;
        }
      }
      if (allowCustom && live !== "") addTyped(live);
      return;
    }
    if (e.key === "Escape") setOpen(false);
  }
  var tokens = multi ? values.map(function(v) {
    return createElement(
      "span",
      { className: "tag-chip " + (props.kind || "allow"), key: "tok-" + v },
      v,
      createElement("button", {
        type: "button",
        "aria-label": dshT("\u79FB\u9664 ") + v,
        disabled,
        onClick: function(ev) {
          ev.stopPropagation();
          emit(values.filter(function(x) {
            return x !== v;
          }));
        }
      }, "\u2715")
    );
  }) : null;
  var list = open && !disabled ? createElement(
    "div",
    { className: "sa-picker-list", role: "listbox", id: listId, "aria-label": props.ariaLabel || props.placeholder || "" },
    filtered.length === 0 ? createElement("div", { className: "sa-picker-empty" }, allowCustom && text.trim() !== "" ? dshT("\u56DE\u8F66\u6DFB\u52A0\uFF1A") + text.trim() : dshT("\u65E0\u5339\u914D")) : filtered.map(function(o, idx) {
      return createElement("div", {
        key: o.value,
        role: "option",
        id: listId + "-opt-" + idx,
        "aria-selected": multi ? selected[o.value] === true : values[0] === o.value,
        className: "sa-picker-opt" + (idx === highlight ? " active" : ""),
        onMouseDown: function(ev) {
          if (!disabled) {
            ev.preventDefault();
            pick(o);
          }
        },
        onMouseEnter: function() {
          setHighlight(idx);
        }
      }, o.label || o.value);
    })
  ) : null;
  return createElement(
    "div",
    { className: "sa-picker" + (multi ? " tag-input" : "") },
    tokens,
    // The official Input (the composite no longer needs a ref: see `live` above).
    // Combobox wiring: the input owns the expanded/collapsed state and points at
    // the highlighted option (aria-activedescendant → the listbox's option ids),
    // so a screen reader announces the highlight the arrow keys move.
    createElement(import_dsh_client_ui_primitives.Input, {
      value: multi ? text : values[0] || "",
      placeholder: props.placeholder || "",
      "aria-label": props.ariaLabel || props.placeholder || "",
      role: "combobox",
      "aria-expanded": open && !disabled ? "true" : "false",
      "aria-controls": open && !disabled ? listId : void 0,
      "aria-autocomplete": "list",
      "aria-activedescendant": activeDescendant,
      disabled,
      onChange: onInputChange,
      onKeyDown,
      onFocus: function() {
        if (!disabled) setOpen(true);
      },
      onBlur: function() {
        setOpen(false);
      }
    }),
    list
  );
}
function pillStyle(color) {
  return {
    display: "inline-block",
    padding: "1px 8px",
    borderRadius: "10px",
    fontSize: "11px",
    color: "#fff",
    background: color
  };
}
function btnStyle(bg, fg) {
  return {
    padding: "4px 12px",
    borderRadius: "6px",
    cursor: "pointer",
    border: "1px solid " + (bg || "var(--dsw-alias-border-l2, #ddd)"),
    background: bg || "transparent",
    color: fg || "inherit",
    fontSize: "12px"
  };
}
function inputStyle(over) {
  var base = (
    /** @type {Record<string, string>} */
    {
      width: "100%",
      padding: "6px 8px",
      marginBottom: "8px",
      borderRadius: "6px",
      border: "1px solid var(--dsw-alias-border-l2, #ddd)",
      boxSizing: "border-box"
    }
  );
  var src = over || {};
  for (var k in src) base[k] = src[k];
  return base;
}
function textareaStyle(over) {
  var base = (
    /** @type {Record<string, string>} */
    {
      width: "100%",
      minHeight: "140px",
      padding: "8px",
      marginBottom: "8px",
      borderRadius: "6px",
      border: "1px solid var(--dsw-alias-border-l2, #ddd)",
      fontFamily: "monospace",
      fontSize: "12px",
      boxSizing: "border-box"
    }
  );
  for (var k in over || {}) base[k] = /** @type {Record<string, any>} */
  over[k];
  return base;
}
function preStyle(over) {
  var base = (
    /** @type {Record<string, string>} */
    {
      padding: "8px",
      borderRadius: "6px",
      border: "1px solid var(--dsw-alias-border-l2, #ddd)",
      background: "var(--dsw-alias-bg-base, #f6f6f6)",
      fontSize: "12px",
      overflow: "auto",
      maxHeight: "260px",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word"
    }
  );
  for (var k in over || {}) base[k] = /** @type {Record<string, any>} */
  over[k];
  return base;
}
function safeStringify(v) {
  try {
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  } catch (e) {
    return String(v);
  }
}
function mergeObject(base, partial) {
  var next = (
    /** @type {Record<string, any>} */
    {}
  );
  for (var k in base) next[k] = base[k];
  for (var pk in partial) next[pk] = partial[pk];
  return next;
}

// src/client/panels/workflow.js
function WorkflowSection(props) {
  var call = props.call;
  var h = createElement;
  var kit = sectionState({
    available: true,
    error: "",
    tab: "runs",
    runs: [],
    saved: [],
    busy: false,
    openRunId: null,
    runDetail: null,
    editor: null,
    editorBusy: false,
    editorError: "",
    savedEditor: null,
    savedBusy: false,
    savedError: "",
    liveSessions: [],
    parentSessionId: "",
    confirmDelete: null,
    answerText: "",
    answerBusy: false
  });
  var state = kit.state;
  var patch = kit.patch;
  var alive = kit.alive;
  var runsRef = useRef([]);
  var parentSessionRef = useRef("");
  var pollTimerRef = useRef(null);
  function loadParentSessions() {
    call("sessionAdmin/list", {}).then(function(res) {
      if (!alive.current || !res || !res.ok) return;
      var live = (res.value && res.value.sessions || []).filter(function(s) {
        return s && s.live && s.id;
      });
      var keep = parentSessionRef.current;
      parentSessionRef.current = live.some(function(s) {
        return s.id === keep;
      }) ? keep : live[0] ? live[0].id : "";
      patch({ liveSessions: live, parentSessionId: parentSessionRef.current });
    }, function() {
    });
  }
  function reload() {
    patch({ busy: true, error: "" });
    loadParentSessions();
    Promise.all([
      call("workflowAdmin/listRuns", {}),
      call("workflowAdmin/listSaved", {})
    ]).then(function(results) {
      if (!alive.current) return;
      var runsRes = results[0];
      var savedRes = results[1];
      if (!runsRes.ok) {
        patch({ busy: false, available: false, error: messageOf(runsRes.error) });
        return;
      }
      var runs = runsRes.value && runsRes.value.active || [];
      runsRef.current = runs;
      patch({
        busy: false,
        available: true,
        runs,
        saved: savedRes.ok && savedRes.value || []
      });
      schedulePoll();
    }, function(e) {
      if (!alive.current) return;
      patch({ busy: false, available: false, error: messageOf(e) });
    });
  }
  kit.mount(reload);
  var pollFailures = 0;
  function schedulePoll() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    var anyRunning = (runsRef.current || []).some(function(r) {
      return r.status === "running" || r.status === "pending";
    });
    if (!anyRunning) {
      pollFailures = 0;
      return;
    }
    var delay = Math.min(2e3 * Math.pow(2, pollFailures), 3e4);
    pollTimerRef.current = setTimeout(function() {
      if (!alive.current) return;
      call("workflowAdmin/listRuns", {}).then(function(res) {
        if (!alive.current) return;
        if (res.ok) {
          pollFailures = 0;
          runsRef.current = res.value && res.value.active || [];
          patch({ runs: runsRef.current });
        } else {
          pollFailures += 1;
        }
        schedulePoll();
      }, function() {
        pollFailures += 1;
        schedulePoll();
      });
    }, delay);
  }
  useEffect(function() {
    schedulePoll();
    return function() {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [state.runs]);
  var detailSeq = useRef(0);
  function openRun(runId) {
    if (state.openRunId === runId) {
      patch({ openRunId: null, runDetail: null, answerText: "" });
      return;
    }
    var seq = ++detailSeq.current;
    patch({ openRunId: runId, runDetail: null, answerText: "" });
    call("workflowAdmin/getRun", { runId }).then(function(res) {
      if (!alive.current || seq !== detailSeq.current) return;
      if (res.ok) patch({ runDetail: res.value });
      else patch({ runDetail: { error: messageOf(res.error) } });
    }, function(error) {
      if (!alive.current || seq !== detailSeq.current) return;
      patch({ runDetail: { error: messageOf(error) } });
    });
  }
  function startFromEditor() {
    var ed = state.editor;
    if (!ed || !ed.script) {
      patch({ editorError: dshT("\u811A\u672C\u4E0D\u80FD\u4E3A\u7A7A") });
      return;
    }
    var args = null;
    if (ed.argsText && ed.argsText.trim()) {
      try {
        args = JSON.parse(ed.argsText);
      } catch (e) {
        patch({ editorError: dshT("args \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A") + messageOf(e) });
        return;
      }
    }
    patch({ editorBusy: true, editorError: "" });
    var spec = { script: ed.script, label: ed.label || dshT("\u5DE5\u4F5C\u6D41"), args: args || {} };
    if (parentSessionRef.current) spec.parentSessionId = parentSessionRef.current;
    call("workflowAdmin/startRun", { spec }).then(function(res) {
      if (!alive.current) return;
      var r = res && res.ok ? res.value : null;
      if (r && r.id) {
        patch({ editorBusy: false, editor: null, tab: "runs", openRunId: r.id });
        showToast("success", dshT("\u{1F680} \u5DE5\u4F5C\u6D41\u5DF2\u542F\u52A8"));
        reload();
      } else {
        var diags = (r && r.diagnostics || []).map(function(d) {
          return d.message;
        }).join("\n");
        patch({ editorBusy: false, editorError: diags || messageOf(res && res.error || r && r.error) });
      }
    }, function(e) {
      if (!alive.current) return;
      patch({ editorBusy: false, editorError: messageOf(e) });
    });
  }
  var runActionBusy = useRef(false);
  function stopRun(runId) {
    if (runActionBusy.current) return;
    runActionBusy.current = true;
    call("workflowAdmin/stopRun", { runId, reason: "panel" }).then(function(res) {
      runActionBusy.current = false;
      if (!alive.current) return;
      var r = res && res.ok ? res.value : null;
      if (r && r.stopped === false) showToast("error", dshT("\u8BE5\u8FD0\u884C\u5DF2\u4E0D\u5728\u8FDB\u884C\u4E2D"));
      if (r && r.abandoned) showToast("error", dshT("\u505C\u6B62\u8BF7\u6C42\u5DF2\u9001\u8FBE\uFF0C\u4F46\u8FD0\u884C\u672A\u5728\u9884\u7B97\u5185\u843D\u5B9A\uFF08\u811A\u672C\u5FFD\u7565\u53D6\u6D88\u4FE1\u53F7\uFF1F\uFF09"));
      reload();
    }, function(e) {
      runActionBusy.current = false;
      showToast("error", dshT("\u274C \u505C\u6B62\u5931\u8D25\uFF1A") + messageOf(e));
    });
  }
  function amendRun(runId) {
    var rec = state.runDetail;
    var script = rec && rec.script ? rec.script : "";
    patch({ editor: { runId, script, label: rec && rec.label ? rec.label : "", argsText: "" }, editorError: "", tab: "runs" });
  }
  function submitAmend() {
    var ed = state.editor;
    if (!ed || !ed.script) {
      patch({ editorError: dshT("\u811A\u672C\u4E0D\u80FD\u4E3A\u7A7A") });
      return;
    }
    patch({ editorBusy: true, editorError: "" });
    call("workflowAdmin/amendRun", { runId: ed.runId, script: ed.script, spec: {} }).then(function(res) {
      if (!alive.current) return;
      var r = res && res.ok ? res.value : null;
      if (r && r.id) {
        patch({ editorBusy: false, editor: null, openRunId: r.id });
        showToast("success", dshT("\u270F\uFE0F \u5DF2\u57FA\u4E8E\u65E7\u6B65\u9AA4\u7F13\u5B58\u91CD\u5EFA\u5DE5\u4F5C\u6D41"));
        reload();
      } else {
        var diags = (r && r.diagnostics || []).map(function(d) {
          return d.message;
        }).join("\n");
        patch({ editorBusy: false, editorError: diags || messageOf(res && res.error || r && r.error) });
      }
    }, function(e) {
      if (!alive.current) return;
      patch({ editorBusy: false, editorError: messageOf(e) });
    });
  }
  function submitAnswer() {
    var text = (state.answerText || "").trim();
    if (!text || !state.runDetail || !state.runDetail.pendingQuestion) return;
    patch({ answerBusy: true });
    call("workflowAdmin/answerRun", { runId: state.runDetail.id, text }).then(function(res) {
      if (!alive.current) return;
      var r = res && res.ok ? res.value : null;
      if (r && r.answered) {
        patch({ answerBusy: false, answerText: "" });
        showToast("success", dshT("\u2705 \u5DF2\u56DE\u7B54\uFF0C\u5DE5\u4F5C\u6D41\u7EE7\u7EED"));
        if (state.openRunId) openRun(state.openRunId);
      } else {
        patch({ answerBusy: false });
        showToast("error", dshT("\u56DE\u7B54\u5931\u8D25\uFF1A") + messageOf(res && res.error || r && r.error));
      }
    }, function(e) {
      if (!alive.current) return;
      patch({ answerBusy: false });
      showToast("error", dshT("\u274C \u56DE\u7B54\u5931\u8D25\uFF1A") + messageOf(e));
    });
  }
  function resumeRun(runId) {
    if (runActionBusy.current) return;
    runActionBusy.current = true;
    call("workflowAdmin/resumeRun", { runId }).then(function(res) {
      runActionBusy.current = false;
      if (!alive.current) return;
      var r = res && res.ok ? res.value : null;
      if (r && r.id) {
        patch({ openRunId: r.id });
        showToast("success", dshT("\u25B6\uFE0F \u5DF2\u4ECE\u65AD\u70B9\u7EED\u8DD1"));
        reload();
      } else showToast("error", messageOf(res && res.error || r && r.error));
    }, function(e) {
      runActionBusy.current = false;
      showToast("error", dshT("\u274C \u7EED\u8DD1\u5931\u8D25\uFF1A") + messageOf(e));
    });
  }
  function runSaved(name) {
    if (runActionBusy.current) return;
    runActionBusy.current = true;
    var payload = { spec: { name, args: {} } };
    if (parentSessionRef.current) payload.spec.parentSessionId = parentSessionRef.current;
    call("workflowAdmin/runSaved", payload).then(function(res) {
      runActionBusy.current = false;
      if (!alive.current) return;
      var r = res && res.ok ? res.value : null;
      if (r && r.id) {
        patch({ tab: "runs", openRunId: r.id });
        showToast("success", dshT("\u{1F680} \u5DF2\u542F\u52A8\uFF1A") + name);
        reload();
      } else showToast("error", messageOf(res && res.error || r && r.error));
    }, function(e) {
      runActionBusy.current = false;
      showToast("error", dshT("\u274C \u542F\u52A8\u5931\u8D25\uFF1A") + messageOf(e));
    });
  }
  function saveSavedFromEditor() {
    var ed = state.savedEditor;
    if (!ed || !ed.name || !ed.script) {
      patch({ savedError: dshT("\u540D\u79F0\u548C\u811A\u672C\u4E0D\u80FD\u4E3A\u7A7A") });
      return;
    }
    patch({ savedBusy: true, savedError: "" });
    call("workflowAdmin/saveSaved", { spec: ed }).then(function(res) {
      if (!alive.current) return;
      if (res.ok) {
        patch({ savedBusy: false, savedEditor: null });
        showToast("success", dshT("\u{1F4BE} \u5DF2\u4FDD\u5B58\uFF1A") + ed.name);
        reload();
      } else patch({ savedBusy: false, savedError: messageOf(res.error) });
    }, function(e) {
      if (!alive.current) return;
      patch({ savedBusy: false, savedError: messageOf(e) });
    });
  }
  function deleteSaved(name, scope) {
    if (runActionBusy.current) return;
    runActionBusy.current = true;
    call("workflowAdmin/deleteSaved", { spec: { name, scope } }).then(function(res) {
      runActionBusy.current = false;
      if (!alive.current) return;
      if (res.ok) {
        patch({ confirmDelete: null });
        showToast("success", dshT("\u{1F5D1} \u5DF2\u5220\u9664\uFF1A") + name);
        reload();
      } else showToast("error", messageOf(res.error));
    }, function(e) {
      runActionBusy.current = false;
      showToast("error", dshT("\u274C \u5220\u9664\u5931\u8D25\uFF1A") + messageOf(e));
    });
  }
  if (!state.available) {
    return h(
      "div",
      { "data-dsh-admin-section": "" },
      h(
        "div",
        { className: "card", style: { padding: "16px", color: "var(--dsw-alias-label-tertiary, #888)" } },
        dshT("\u5DE5\u4F5C\u6D41\u5F15\u64CE\u4E0D\u53EF\u7528\uFF1A\u672A\u6302\u8F7D @deepseek-ai/dsh-subagent\uFF0C\u6216\u670D\u52A1\u542F\u52A8\u5931\u8D25\u3002") + (state.error ? dshT("\uFF08\u5BBF\u4E3B\u8FD4\u56DE\uFF1A") + state.error + dshT("\uFF09") : "")
      )
    );
  }
  var elements = [];
  elements.push(h("div", { key: "guide", className: "card", style: { padding: "10px 12px", marginBottom: "10px", borderRadius: "10px", border: "1px solid var(--dsw-static-blue-500, #5B4CF0)", background: "var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))" } }, [
    h("div", { key: "g1", style: { fontWeight: "700", marginBottom: "4px" } }, dshT("\u5DE5\u4F5C\u6D41 = \u628A\u591A\u6B65\u4EFB\u52A1\u5199\u6210\u5C0F\u811A\u672C\uFF0C\u4EA4\u7ED9 dsh \u81EA\u52A8\u6D3E\u5B50\u667A\u80FD\u4F53\u9010\u6B65\u5B8C\u6210")),
    h(
      "div",
      { key: "g2", style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, #666)" } },
      dshT("\u4E09\u6B65\u4E0A\u624B\uFF1A\u2460 \u70B9\u300C\u4ECE\u6A21\u677F\u5F00\u59CB\u300D\u91CC\u7684\u4EFB\u610F\u5361\u7247 \u2192 \u2461 \u6309\u9700\u6539\u540D\u79F0\u548C\u53C2\u6570 \u2192 \u2462 \u70B9\u300C\u{1F680} \u542F\u52A8\u300D\uFF0C\u8FD0\u884C\u5361\u7247\u5B9E\u65F6\u663E\u793A\u6BCF\u4E00\u6B65\u8FDB\u5EA6\u4E0E\u7ED3\u679C\u3002")
    )
  ]));
  var wfTabs = [{ id: "runs" }, { id: "saved" }];
  elements.push(h("div", {
    key: "tabs",
    role: "tablist",
    "aria-label": dshT("\u5DE5\u4F5C\u6D41"),
    onKeyDown: function(event) {
      tabKeyDown(event, wfTabs, state.tab, function(next) {
        patch({ tab: next, editor: null, savedEditor: null });
      });
    },
    style: { display: "flex", gap: "8px", marginBottom: "12px" }
  }, [
    tabButton("runs", dshT("\u8FD0\u884C (") + (state.runs || []).length + ")"),
    tabButton("saved", dshT("\u5DE5\u4F5C\u5E93 (") + (state.saved || []).length + ")")
  ]));
  if (state.error) {
    elements.push(h("div", { key: "err", className: "card", style: { padding: "10px", color: "#c00", marginBottom: "10px" } }, state.error));
  }
  if (state.tab === "runs") {
    elements.push(renderRunsTab());
    if (state.editor) elements.push(renderEditor());
  } else {
    elements.push(renderSavedTab());
    if (state.savedEditor) elements.push(renderSavedEditor());
  }
  return h("div", { "data-dsh-admin-section": "" }, elements);
  function tabButton(key, label) {
    var active = state.tab === key;
    return h("button", {
      key: "tab-" + key,
      role: "tab",
      id: "dsh-admin-wf-tab-" + key,
      "aria-selected": active,
      tabIndex: active ? 0 : -1,
      onClick: function() {
        patch({ tab: key, editor: null, savedEditor: null });
      },
      style: {
        padding: "6px 14px",
        borderRadius: "8px",
        cursor: "pointer",
        border: active ? "1px solid var(--dsw-static-blue-500, #5B4CF0)" : "1px solid var(--dsw-alias-border-l2, #ddd)",
        background: active ? "var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.1))" : "transparent",
        fontWeight: active ? "600" : "400"
      }
    }, label);
  }
  function renderRunsTab() {
    var children = [];
    children.push(h("div", { key: "tpl-head", style: { fontWeight: "600", marginBottom: "6px" } }, dshT("\u4ECE\u6A21\u677F\u5F00\u59CB\uFF08\u70B9\u5361\u7247\u81EA\u52A8\u586B\u597D\uFF0C\u6539\u53C2\u6570\u5C31\u80FD\u8DD1\uFF09")));
    children.push(h(
      "div",
      { key: "tpl-row", style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" } },
      wfTemplates().map(function(tpl, tplIndex) {
        var openTpl = function() {
          patch({ editor: { runId: null, script: tpl.script, label: tpl.title, argsText: tpl.argsText }, editorError: "", tab: "runs" });
        };
        return h("div", {
          key: "tpl-" + tplIndex,
          role: "button",
          tabIndex: 0,
          onClick: openTpl,
          onKeyDown: function(event) {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openTpl();
            }
          },
          style: { flex: "1", minWidth: "170px", padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--dsw-static-blue-500, #5B4CF0)", background: "var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))", cursor: "pointer" }
        }, [
          h("div", { key: "t", style: { fontWeight: "700" } }, tpl.title),
          h("div", { key: "d", style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, #666)", marginTop: "2px" } }, tpl.desc)
        ]);
      })
    ));
    children.push(h("button", {
      key: "new-run",
      onClick: function() {
        patch({ editor: { runId: null, script: exampleScript(), label: "", argsText: "{}" }, editorError: "" });
      },
      style: btnStyle()
    }, dshT("\uFF0B \u65B0\u5EFA\u5DE5\u4F5C\u6D41\uFF08\u81EA\u5DF1\u5199\u811A\u672C\uFF09")));
    var runs = state.runs || [];
    if (runs.length === 0) {
      children.push(h(
        "div",
        { key: "empty", className: "card", style: { padding: "16px", color: "var(--dsw-alias-label-tertiary, #888)", marginTop: "10px" } },
        dshT("\u6682\u65E0\u8FD0\u884C\u3002\u4E09\u6B65\u4E0A\u624B\uFF1A\u70B9\u4E0A\u65B9\u6A21\u677F\u5361\u7247 \u2192 \u6309\u9700\u6539\u53C2\u6570 \u2192 \u70B9\u300C\u{1F680} \u542F\u52A8\u300D\u3002\u4E5F\u53EF\u4EE5\u4ECE\u300C\u5DE5\u4F5C\u5E93\u300D\u542F\u52A8\u5DF2\u4FDD\u5B58\u7684\u811A\u672C\u3002")
      ));
    }
    for (var i = 0; i < runs.length; i++) {
      children.push(runCard(runs[i]));
    }
    if (state.openRunId && state.runDetail) children.push(runDetailCard());
    return h("div", { key: "runs-tab" }, children);
  }
  function runCard(run) {
    var statusColor = run.status === "completed" ? "#2e7d32" : run.status === "errored" ? "#c00" : run.status === "stopped" ? "#b26a00" : "#5B4CF0";
    var row = [
      h("span", { key: "label", style: { fontWeight: "600" } }, run.label || run.id),
      h("span", { key: "status", style: pillStyle(statusColor) }, statusText(run.status))
    ];
    if (run.stepCount) row.push(h("span", { key: "steps", style: { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: "12px" } }, run.stepCount + dshT(" \u6B65")));
    if (run.durationMs) row.push(h("span", { key: "dur", style: { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: "12px" } }, Math.round(run.durationMs / 100) / 10 + "s"));
    var actions = h("span", { key: "actions", style: { marginLeft: "auto", display: "flex", gap: "6px" } }, [
      h("button", { key: "open", onClick: function() {
        openRun(run.id);
      }, style: btnStyle() }, dshT("\u8BE6\u60C5")),
      run.status === "running" || run.status === "pending" ? h("button", { key: "stop", onClick: function() {
        stopRun(run.id);
      }, style: btnStyle("#c00") }, dshT("\u23F9 \u505C\u6B62")) : null,
      run.status === "stopped" || run.status === "errored" ? h("button", { key: "resume", onClick: function() {
        resumeRun(run.id);
      }, style: btnStyle() }, dshT("\u25B6 \u7EED\u8DD1")) : null,
      run.status === "completed" || run.status === "stopped" || run.status === "errored" ? h("button", { key: "amend", onClick: function() {
        amendRun(run.id);
      }, style: btnStyle() }, dshT("\u270F\uFE0F \u6539\u5EFA")) : null
    ]);
    row.push(actions);
    return h("div", { key: "run-" + run.id, className: "card", style: { padding: "10px 12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginTop: "8px" } }, row);
  }
  function runDetailCard() {
    var d = state.runDetail;
    if (d.error) return h("div", { key: "detail", className: "card", style: { padding: "12px", color: "#c00", marginTop: "8px" } }, d.error);
    var children = [
      h("div", { key: "id", style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #888)" } }, d.id)
    ];
    if (d.pendingQuestion) {
      children.push(h("div", {
        key: "q",
        className: "card",
        style: { padding: "10px", marginTop: "8px", border: "1px solid #e8c84e", background: "rgba(232,200,78,.08)" }
      }, [
        h("div", { key: "q-head", style: { fontWeight: "700", marginBottom: "6px" } }, dshT("\u23F8 \u5DE5\u4F5C\u6D41\u5728\u7B49\u5F85\u56DE\u7B54")),
        h("div", { key: "q-text", style: { fontSize: "13px", marginBottom: "8px" } }, d.pendingQuestion.text || ""),
        h("div", { key: "q-row", style: { display: "flex", gap: "8px" } }, [
          h(import_dsh_client_ui_primitives.Input, {
            key: "q-input",
            className: "wf-input",
            style: { flex: "1" },
            placeholder: dshT("\u56DE\u7B54\u2026"),
            value: state.answerText || "",
            onChange: function(e) {
              patch({ answerText: e.target.value });
            },
            onKeyDown: function(e) {
              if (e.key === "Enter") submitAnswer();
            }
          }),
          h("button", {
            key: "q-btn",
            onClick: submitAnswer,
            disabled: state.answerBusy,
            style: btnStyle("#5B4CF0", "#fff")
          }, state.answerBusy ? dshT("\u53D1\u9001\u4E2D\u2026") : dshT("\u56DE\u7B54"))
        ])
      ]));
    }
    children.push(h("div", { key: "script-head", style: { fontWeight: "600", marginTop: "8px" } }, dshT("\u811A\u672C")));
    children.push(h("pre", { key: "script", style: preStyle() }, d.script || ""));
    if (d.error) children.push(h("div", { key: "err", style: { color: "#c00", marginTop: "6px" } }, d.error));
    if (d.result !== null && d.result !== void 0) {
      children.push(h("div", { key: "res-head", style: { fontWeight: "600", marginTop: "8px" } }, dshT("\u8FD4\u56DE\u503C")));
      children.push(h("pre", { key: "res", style: preStyle() }, safeStringify(d.result)));
    }
    var log = d.log || [];
    if (log.length) {
      children.push(h("div", { key: "log-head", style: { fontWeight: "600", marginTop: "8px" } }, dshT("\u65E5\u5FD7")));
      for (var i = 0; i < log.length; i++) {
        children.push(h(
          "div",
          { key: "log-" + i, style: { fontSize: "12px", fontFamily: "monospace", padding: "2px 0" } },
          "[" + (log[i].kind || "?") + "] " + (log[i].message || log[i].title || safeStringify(log[i].value) || "")
        ));
      }
    }
    return h("div", { key: "detail", className: "card", style: { padding: "12px", marginTop: "8px" } }, children);
  }
  function renderEditor() {
    var ed = state.editor;
    var isAmend = !!ed.runId;
    var children = [
      h(
        "div",
        { key: "head", style: { fontWeight: "700", marginBottom: "8px" } },
        isAmend ? dshT("\u6539\u5EFA\u5DE5\u4F5C\u6D41\uFF08\u5DF2\u5B8C\u6210\u6B65\u9AA4\u8D70\u7F13\u5B58\uFF0C\u4E0D\u91CD\u82B1\u8C03\u7528\uFF09") : dshT("\u65B0\u5EFA\u5DE5\u4F5C\u6D41")
      ),
      h(import_dsh_client_ui_primitives.Input, {
        key: "label",
        className: "wf-input",
        placeholder: dshT("\u540D\u79F0\uFF08\u53EF\u9009\uFF09"),
        value: ed.label,
        onChange: function(e) {
          ed.label = e.target.value;
          patch({ editor: ed });
        },
        readOnly: isAmend
      }),
      !isAmend && state.liveSessions.length > 1 ? h("div", { key: "parent-row", style: { display: "flex", alignItems: "center", gap: "8px" } }, [
        h("span", { key: "parent-label", style: { flex: "none", fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #888)" } }, dshT("\u7236\u4F1A\u8BDD")),
        h("select", {
          key: "parent",
          value: state.parentSessionId,
          onChange: function(e) {
            parentSessionRef.current = e.target.value;
            patch({ parentSessionId: e.target.value });
          },
          style: inputStyle({ flex: "1" })
        }, state.liveSessions.map(function(s) {
          return h("option", { key: s.id, value: s.id }, (s.title || s.id) + (s.cwd ? " \xB7 " + s.cwd : ""));
        }))
      ]) : !isAmend && state.liveSessions.length === 0 ? h(
        "div",
        { key: "parent-hint", style: { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: "12px" } },
        dshT("\u6CA1\u6709\u5728\u7EBF\u4F1A\u8BDD\u2014\u2014\u5148\u5728 dsh \u4E2D\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u518D\u542F\u52A8\u5DE5\u4F5C\u6D41\u3002")
      ) : null,
      h("textarea", {
        key: "script",
        placeholder: dshT("TypeScript / JavaScript\uFF0C\u9876\u5C42 return \u8FD4\u56DE\u7ED3\u679C"),
        value: ed.script,
        onChange: function(e) {
          ed.script = e.target.value;
          patch({ editor: ed });
        },
        style: textareaStyle()
      }),
      h("textarea", {
        key: "args",
        placeholder: dshT("args\uFF08JSON \u5BF9\u8C61\uFF09"),
        value: ed.argsText,
        onChange: function(e) {
          ed.argsText = e.target.value;
          patch({ editor: ed });
        },
        style: textareaStyle({ height: "60px" })
      })
    ];
    if (state.editorError) {
      children.push(h("pre", { key: "ederr", style: preStyle({ color: "#c00", borderColor: "#e8b4b4" }) }, state.editorError));
    }
    children.push(h(
      "div",
      { key: "args-hint", style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #888)", marginTop: "4px" } },
      dshT("\u53C2\u6570\uFF1A\u811A\u672C\u91CC args.xxx \u7684\u503C\uFF0C\u5728\u4E0A\u9762\u8FD9\u4E2A JSON \u91CC\u586B\uFF08\u6A21\u677F\u5DF2\u5E26\u9ED8\u8BA4\u503C\uFF0C\u53EF\u76F4\u63A5\u6539\uFF09\u3002")
    ));
    children.push(h("div", { key: "edbtns", style: { display: "flex", gap: "8px", marginTop: "8px" } }, [
      h("button", {
        key: "submit",
        onClick: isAmend ? submitAmend : startFromEditor,
        disabled: state.editorBusy,
        style: btnStyle("#5B4CF0", "#fff")
      }, state.editorBusy ? dshT("\u63D0\u4EA4\u4E2D\u2026") : isAmend ? dshT("\u786E\u8BA4\u6539\u5EFA") : dshT("\u{1F680} \u542F\u52A8")),
      h("button", { key: "cancel", onClick: function() {
        patch({ editor: null, editorError: "" });
      }, style: btnStyle() }, dshT("\u53D6\u6D88"))
    ]));
    return h("div", { key: "editor", className: "card", style: { padding: "14px", marginTop: "12px" } }, children);
  }
  function renderSavedTab() {
    var children = [
      h("button", {
        key: "new-saved",
        onClick: function() {
          patch({ savedEditor: { name: "", scope: "global", script: exampleScript(), description: "", argsText: "" }, savedError: "" });
        },
        style: btnStyle()
      }, dshT("\uFF0B \u4FDD\u5B58\u4E00\u4E2A\u5DE5\u4F5C\u6D41"))
    ];
    var saved = state.saved || [];
    if (saved.length === 0) {
      children.push(h(
        "div",
        { key: "empty", className: "card", style: { padding: "16px", color: "var(--dsw-alias-label-tertiary, #888)", marginTop: "10px" } },
        dshT("\u5DE5\u4F5C\u5E93\u4E3A\u7A7A\u3002\u4FDD\u5B58\u5E38\u7528\u811A\u672C\u540E\uFF0C\u53EF\u4EE5\u6309\u540D\u4E00\u952E\u542F\u52A8\u3002")
      ));
    }
    for (var i = 0; i < saved.length; i++) {
      children.push(savedCard(saved[i]));
    }
    return h("div", { key: "saved-tab" }, children);
  }
  function savedCard(rec) {
    var isConfirm = state.confirmDelete === rec.name + ":" + rec.scope;
    var row = [
      h("span", { key: "name", style: { fontWeight: "600" } }, rec.name),
      h(
        "span",
        { key: "scope", style: pillStyle(rec.scope === "project" ? "#0b7285" : "#6c757d") },
        rec.scope === "project" ? dshT("\u9879\u76EE") : dshT("\u5168\u5C40")
      )
    ];
    if (rec.description) row.push(h("span", { key: "desc", style: { color: "var(--dsw-alias-label-tertiary, #888)", fontSize: "12px" } }, rec.description));
    var actions = h("span", { key: "actions", style: { marginLeft: "auto", display: "flex", gap: "6px" } }, [
      h("button", { key: "run", onClick: function() {
        runSaved(rec.name);
      }, style: btnStyle("#5B4CF0", "#fff") }, dshT("\u{1F680} \u8FD0\u884C")),
      isConfirm ? h("button", { key: "del-yes", onClick: function() {
        deleteSaved(rec.name, rec.scope);
      }, style: btnStyle("#c00", "#fff") }, dshT("\u786E\u8BA4\u5220\u9664")) : h("button", { key: "del", onClick: function() {
        patch({ confirmDelete: rec.name + ":" + rec.scope });
      }, style: btnStyle() }, dshT("\u{1F5D1} \u5220\u9664")),
      isConfirm ? h("button", { key: "del-no", onClick: function() {
        patch({ confirmDelete: null });
      }, style: btnStyle() }, dshT("\u53D6\u6D88")) : null
    ]);
    row.push(actions);
    return h("div", { key: "saved-" + rec.name + ":" + rec.scope, className: "card", style: { padding: "10px 12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginTop: "8px" } }, row);
  }
  function renderSavedEditor() {
    var ed = state.savedEditor;
    var children = [
      h("div", { key: "head", style: { fontWeight: "700", marginBottom: "8px" } }, dshT("\u4FDD\u5B58\u5230\u5DE5\u4F5C\u5E93")),
      h(import_dsh_client_ui_primitives.Input, {
        key: "name",
        className: "wf-input",
        placeholder: dshT("\u540D\u79F0\uFF08\u5B57\u6BCD\u6570\u5B57 . _ -\uFF09"),
        value: ed.name,
        onChange: function(e) {
          ed.name = e.target.value;
          patch({ savedEditor: ed });
        }
      }),
      h("select", {
        key: "scope",
        value: ed.scope,
        onChange: function(e) {
          ed.scope = e.target.value;
          patch({ savedEditor: ed });
        },
        style: inputStyle(),
        "aria-label": dshT("\u4FDD\u5B58\u4F5C\u7528\u57DF")
      }, [
        h("option", { key: "g", value: "global" }, dshT("\u5168\u5C40")),
        // 项目作用域对面板是死路：宿主 saveSaved 对 project scope 必须拿到
        // workspacePath（<root>/.dsh/workflows 的信任闸门），而面板调用没有
        // 会话上下文可携带——真给这选项放行，保存 100% 报错。禁用并指路。
        h("option", {
          key: "p",
          value: "project",
          disabled: true,
          title: dshT("\u9762\u677F\u4FDD\u5B58\u65E0\u6CD5\u643A\u5E26\u5DE5\u4F5C\u533A\u8DEF\u5F84\u2014\u2014\u9879\u76EE\u7EA7\u5DE5\u4F5C\u6D41\u8BF7\u7ECF\u6A21\u578B\u7684 workflow_admin \u5DE5\u5177\u4FDD\u5B58\uFF08\u81EA\u52A8\u5B58\u5165\u5F53\u524D\u4F1A\u8BDD\u7684\u9879\u76EE\uFF09")
        }, dshT("\u9879\u76EE\uFF08\u968F\u5DE5\u4F5C\u533A .dsh/\uFF09"))
      ]),
      h(import_dsh_client_ui_primitives.Input, {
        key: "desc",
        className: "wf-input",
        placeholder: dshT("\u4E00\u53E5\u8BDD\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09"),
        value: ed.description,
        onChange: function(e) {
          ed.description = e.target.value;
          patch({ savedEditor: ed });
        }
      }),
      h("textarea", {
        key: "script",
        placeholder: dshT("\u811A\u672C"),
        value: ed.script,
        onChange: function(e) {
          ed.script = e.target.value;
          patch({ savedEditor: ed });
        },
        style: textareaStyle()
      })
    ];
    if (state.savedError) {
      children.push(h("pre", { key: "sverr", style: preStyle({ color: "#c00", borderColor: "#e8b4b4" }) }, state.savedError));
    }
    children.push(h("div", { key: "svbtns", style: { display: "flex", gap: "8px", marginTop: "8px" } }, [
      h("button", {
        key: "save",
        onClick: saveSavedFromEditor,
        disabled: state.savedBusy,
        style: btnStyle("#5B4CF0", "#fff")
      }, state.savedBusy ? dshT("\u4FDD\u5B58\u4E2D\u2026") : dshT("\u{1F4BE} \u4FDD\u5B58")),
      h("button", { key: "cancel", onClick: function() {
        patch({ savedEditor: null, savedError: "" });
      }, style: btnStyle() }, dshT("\u53D6\u6D88"))
    ]));
    return h("div", { key: "saved-editor", className: "card", style: { padding: "14px", marginTop: "12px" } }, children);
  }
}
function exampleScript() {
  return [
    dshT("// \u53EF\u7528\uFF1Aagent(prompt, opts?) / parallel(thunks) / pipeline(items, ...stages)"),
    dshT("//       phase(title) / log(msg) / report(key, value) / shell(cmd)"),
    dshT("// \u9876\u5C42 return \u8FD4\u56DE\u7ED3\u679C\uFF1B\u5355\u6B65\u5931\u8D25 agent() \u8FD4\u56DE null\uFF0C\u811A\u672C\u7EE7\u7EED\u3002"),
    'const files = ["a.ts", "b.ts"]',
    'const reviews = await parallel(files.map((f) => () => agent("\u5BA1\u67E5 " + f + " \u7684\u7C7B\u578B\u95EE\u9898")))',
    "return reviews.filter((r) => r !== null)"
  ].join("\n");
}
function wfTemplates() {
  return [
    {
      title: dshT("\u603B\u7ED3\u4E00\u4E2A\u4E3B\u9898"),
      desc: dshT("\u6D3E\u4E00\u4E2A\u5B50\u667A\u80FD\u4F53\uFF0C\u6309\u4F60\u7ED9\u7684\u4E3B\u9898\u8F93\u51FA\u4E00\u6BB5\u603B\u7ED3"),
      label: dshT("\u4E3B\u9898\u603B\u7ED3"),
      argsText: '{\n  "topic": "dsh \u63D2\u4EF6\u7CFB\u7EDF"\n}',
      script: [
        "// \u4E00\u6B65\u5DE5\u4F5C\u6D41\uFF1A\u4E00\u4E2A\u5B50\u667A\u80FD\u4F53\u5B8C\u6210\u4E00\u6B21\u603B\u7ED3",
        "// \u53C2\u6570 args.topic \u5728\u300C\u53C2\u6570\u300D\u6846\u91CC\u586B",
        "var summary = await agent(",
        '  "\u8BF7\u7528\u4E0D\u8D85\u8FC7 200 \u5B57\u603B\u7ED3\u8FD9\u4E2A\u4E3B\u9898\uFF1A" + (args.topic || "")',
        ")",
        "return { summary: summary }"
      ].join("\n")
    },
    {
      title: dshT("\u5E76\u884C\u53CC\u89D2\u5EA6\u5206\u6790"),
      desc: dshT("\u4E24\u4E2A\u5B50\u667A\u80FD\u4F53\u5E76\u884C\uFF0C\u5206\u522B\u4ECE\u6280\u672F\u4E0E\u4F53\u9A8C\u89D2\u5EA6\u5206\u6790"),
      label: "\u53CC\u89D2\u5EA6\u5206\u6790",
      argsText: '{\n"topic": "dsh \u81EA\u52A8\u5316\u9762\u677F"\n}',
      script: [
        "// \u5E76\u884C\u5DE5\u4F5C\u6D41\uFF1A\u4E24\u4E2A\u5B50\u667A\u80FD\u4F53\u540C\u65F6\u8DD1\uFF0C\u5168\u90E8\u5B8C\u6210\u540E\u5408\u5E76\u8FD4\u56DE",
        "var r = await parallel([",
        '  function () { return agent("\u4ECE\u6280\u672F\u67B6\u6784\u89D2\u5EA6\u5206\u6790\uFF1A" + (args.topic || "")) },',
        '  function () { return agent("\u4ECE\u4F7F\u7528\u4F53\u9A8C\u89D2\u5EA6\u5206\u6790\uFF1A" + (args.topic || "")) },',
        "])",
        "return { tech: r[0], ux: r[1] }"
      ].join("\n")
    },
    {
      title: dshT("\u5206\u6B65\u6DA6\u8272\u6D41\u6C34\u7EBF"),
      desc: dshT("\u51E0\u4E2A\u4E3B\u9898\u4F9D\u6B21\u7ECF\u8FC7\u300C\u521D\u7A3F \u2192 \u6DA6\u8272\u300D\u4E24\u9053\u5DE5\u5E8F"),
      label: "\u6DA6\u8272\u6D41\u6C34\u7EBF",
      argsText: '{\n"items": ["\u5B9A\u65F6\u4EFB\u52A1", "Webhook"]\n}',
      script: [
        "// \u6D41\u6C34\u7EBF\u5DE5\u4F5C\u6D41\uFF1A\u6BCF\u4E2A\u4E3B\u9898\u4F9D\u6B21\u8FC7\u4E24\u9053\u5DE5\u5E8F\uFF08\u4E0A\u4E00\u4E2A\u7684\u8F93\u51FA\u662F\u4E0B\u4E00\u4E2A\u7684\u8F93\u5165\uFF09",
        "var items = args.items || []",
        "var out = await pipeline(items,",
        '  function (item) { return agent("\u4E3A\u300C" + item + "\u300D\u5199\u4E00\u6BB5 50 \u5B57\u4ECB\u7ECD") },',
        '  function (draft) { return agent("\u628A\u8FD9\u6BB5\u4ECB\u7ECD\u6DA6\u8272\u5F97\u66F4\u53E3\u8BED\u5316\uFF1A" + draft) },',
        ")",
        "return out"
      ].join("\n")
    }
  ];
}
function statusText(s) {
  return s === "running" ? dshT("\u8FD0\u884C\u4E2D") : s === "completed" ? dshT("\u5DF2\u5B8C\u6210") : s === "errored" ? dshT("\u5931\u8D25") : s === "stopped" ? dshT("\u5DF2\u505C\u6B62") : s === "orphaned" ? dshT("\u5DF2\u5931\u6D3B") : s;
}

// src/client/panels/automation.js
function AutomationSection(props) {
  var tabHooks = useState("cron");
  var tab = tabHooks[0];
  var setTab = tabHooks[1];
  var tabs = [
    { id: "cron", label: dshT("\u5B9A\u65F6\u4EFB\u52A1"), component: CronSection },
    { id: "webhook", label: dshT("Webhook"), component: WebhookSection },
    { id: "workflow", label: dshT("\u5DE5\u4F5C\u6D41"), component: WorkflowSection }
  ];
  var selected = tabs.find(function(entry) {
    return entry.id === tab;
  }) || tabs[0];
  return createElement(
    "div",
    { "data-cha-section": "" },
    createElement(
      "div",
      {
        className: "tabs",
        role: "tablist",
        "aria-label": dshT("\u81EA\u52A8\u5316"),
        onKeyDown: function(event) {
          tabKeyDown(event, tabs, selected.id, setTab);
        }
      },
      tabs.map(function(entry) {
        return createElement("button", {
          type: "button",
          role: "tab",
          key: entry.id,
          id: "dsh-admin-tab-" + entry.id,
          "aria-controls": "dsh-admin-panel-" + entry.id,
          tabIndex: entry.id === selected.id ? 0 : -1,
          className: "tab" + (entry.id === selected.id ? " active" : ""),
          "aria-selected": entry.id === selected.id,
          onClick: function() {
            setTab(entry.id);
          }
        }, entry.label);
      })
    ),
    createElement(
      "div",
      { key: selected.id, role: "tabpanel", id: "dsh-admin-panel-" + selected.id, "aria-labelledby": "dsh-admin-tab-" + selected.id },
      createElement(selected.component, { call: props.call })
    )
  );
}
function cronTemplates() {
  return [
    {
      title: dshT("\u5DE5\u4F5C\u65E5\u65E9\u62A5"),
      desc: dshT("\u5DE5\u4F5C\u65E5\u65E9\u4E0A 9 \u70B9\uFF1A\u7ED9\u4F1A\u8BDD\u53D1\u4E00\u6761\u4ECA\u65E5\u7B80\u62A5\u63D0\u9192"),
      seed: {
        id: "morning-brief",
        cron: "0 9 * * 1-5",
        actionMode: "steer",
        steer: true,
        promptTemplate: "\u65E9\u5B89\u3002\u8BF7\u7ED9\u6211\u4E00\u4EFD\u4ECA\u65E5\u7B80\u62A5\uFF1A\u672A\u5B8C\u6210\u7684\u5F85\u529E\u3001\u6628\u5929\u7684\u5173\u952E\u6539\u52A8\u3001\u4ECA\u5929\u8981\u505A\u7684\u4E8B\u3002"
      }
    },
    {
      title: dshT("\u6BCF\u5468\u5468\u62A5"),
      desc: dshT("\u6BCF\u5468\u4E94 17 \u70B9\uFF1A\u56DE\u987E\u672C\u5468\u4F1A\u8BDD\u4E0E\u6539\u52A8\uFF0C\u8F93\u51FA\u7B80\u660E\u5468\u62A5"),
      seed: {
        id: "weekly-report",
        cron: "0 17 * * 5",
        actionMode: "steer",
        steer: true,
        promptTemplate: "\u672C\u5468\u5FEB\u7ED3\u675F\u4E86\u3002\u8BF7\u56DE\u987E\u672C\u5468\u7684\u4F1A\u8BDD\u8BB0\u5F55\u4E0E\u4EE3\u7801\u6539\u52A8\uFF0C\u8F93\u51FA\u4E00\u4EFD\u7B80\u660E\u5468\u62A5\uFF1A\u505A\u4E86\u4EC0\u4E48\u3001\u6539\u4E86\u54EA\u91CC\u3001\u4E0B\u5468\u5EFA\u8BAE\u3002"
      }
    },
    {
      title: dshT("\u6BCF\u5C0F\u65F6\u5DE1\u68C0"),
      desc: dshT("\u6BCF\u5C0F\u65F6\u6574\u70B9\uFF1A\u68C0\u67E5\u9879\u76EE\u72B6\u6001\uFF0C\u5F02\u5E38\u5148\u5B9A\u4F4D\u518D\u7ED9\u5EFA\u8BAE"),
      seed: {
        id: "hourly-patrol",
        cron: "0 * * * *",
        actionMode: "steer",
        steer: true,
        promptTemplate: "\u4F8B\u884C\u5DE1\u68C0\uFF1A\u68C0\u67E5\u5F53\u524D\u9879\u76EE\u7684\u670D\u52A1\u4E0E\u6D4B\u8BD5\u72B6\u6001\u3002\u6709\u5F02\u5E38\u5148\u5B9A\u4F4D\u539F\u56E0\u518D\u7ED9\u4FEE\u590D\u5EFA\u8BAE\uFF1B\u4E00\u5207\u6B63\u5E38\u5C31\u4E00\u53E5\u8BDD\u62A5\u5E73\u5B89\u3002"
      }
    }
  ];
}
function webhookTemplates() {
  return [
    {
      title: dshT("CI \u5931\u8D25\u81EA\u52A8\u5904\u7406"),
      desc: dshT("CI/CD \u5931\u8D25\u4E8B\u4EF6\u63A8\u7ED9\u4F1A\u8BDD\uFF0C\u81EA\u52A8\u5B9A\u4F4D\u5E76\u5C1D\u8BD5\u4FEE\u590D"),
      seed: {
        id: "ci-fail-fix",
        event: "",
        actionMode: "steer",
        steer: true,
        promptTemplate: "CI \u5931\u8D25\u4E86\u3002\u4E8B\u4EF6\u8BE6\u60C5\uFF1A$PAYLOAD\u3002\u8BF7\u5B9A\u4F4D\u5931\u8D25\u539F\u56E0\u5E76\u5C1D\u8BD5\u4FEE\u590D\uFF0C\u5B8C\u6210\u540E\u6C47\u62A5\u7ED3\u679C\u3002"
      }
    },
    {
      title: dshT("GitHub Issue \u5206\u8BCA"),
      desc: dshT("\u65B0 Issue \u5230\u8FBE\u65F6\u5F52\u7EB3\u8981\u70B9\u3001\u5B9A\u4F18\u5148\u7EA7\u5E76\u8D77\u8349\u56DE\u590D"),
      seed: {
        id: "github-issue",
        event: "issues",
        actionMode: "steer",
        steer: true,
        promptTemplate: "\u6536\u5230\u65B0\u7684 GitHub Issue\uFF1A$PAYLOAD\u3002\u8BF7\u5F52\u7EB3\u95EE\u9898\u8981\u70B9\u3001\u5224\u65AD\u4F18\u5148\u7EA7\u5E76\u8D77\u8349\u4E00\u6761\u56DE\u590D\u3002"
      }
    },
    {
      title: dshT("\u62A5\u8B66\u65B0\u5EFA\u4F1A\u8BDD\u5904\u7406"),
      desc: dshT("\u7EBF\u4E0A\u62A5\u8B66\u65B0\u5EFA\u4E13\u95E8\u4F1A\u8BDD\uFF0C\u5B9A\u4F4D\u95EE\u9898\u5E76\u7ED9\u5904\u7F6E\u65B9\u6848"),
      seed: {
        id: "alert-handler",
        event: "",
        actionMode: "create",
        promptTemplate: "\u751F\u4EA7\u62A5\u8B66\uFF1A$PAYLOAD\u3002\u8BF7\u5B9A\u4F4D\u95EE\u9898\u3001\u8BC4\u4F30\u5F71\u54CD\u9762\u5E76\u7ED9\u51FA\u5904\u7F6E\u65B9\u6848\u3002"
      }
    }
  ];
}
function generateWebhookSecret() {
  var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var buf = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto !== null && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buf);
  } else {
    for (var i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  var out = "";
  for (var j = 0; j < 16; j++) out += chars[buf[j] % chars.length];
  return out;
}
function WebhookSection(props) {
  var kit = sectionState({
    busy: false,
    error: "",
    rules: [],
    history: [],
    presets: [],
    permissionPresetNames: [],
    storagePath: "",
    endpointPrefix: "/webhook-triggers",
    endpointOnline: false,
    runtimeMounted: false,
    runtimePackageInstalled: false,
    editorOpen: false,
    draft: null,
    showSecret: false,
    confirmId: null,
    pickerAvailable: true
    // native directory picker capability; the first workspaceAdmin/pickDirectory call corrects it
  });
  var state = kit.state;
  var setState = kit.set;
  var alive = kit.alive;
  function patch(partial) {
    kit.patch(partial);
  }
  var callRemote = props.call;
  function reload() {
    patch({ busy: true, error: "" });
    callRemote("webhookAdmin/list", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        patch({ busy: false, rules: v.rules || [], history: v.history || [], presets: v.presets || [], permissionPresetNames: v.permissionPresetNames || [], storagePath: v.storagePath || "", runtimeMounted: v.runtimeMounted === true, runtimePackageInstalled: v.runtimePackageInstalled === true, endpointOnline: v.endpointOnline === true });
      } else {
        patch({ busy: false, error: dshT("\u52A0\u8F7D\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  kit.mount(reload);
  function openEditor(rule, seed) {
    patch({
      editorOpen: true,
      error: "",
      showSecret: false,
      draft: rule ? {
        id: rule.id,
        isNew: false,
        enabled: rule.enabled,
        secret: "",
        event: rule.event || "",
        actionMode: rule.action ? rule.action.mode : "steer",
        sessionId: rule.action && rule.action.sessionId || "",
        steer: rule.action && rule.action.steer === true,
        workspacePath: rule.action && rule.action.workspacePath || "",
        agentPreset: rule.action && rule.action.agentPreset || "cordis",
        permissionPreset: rule.action && rule.action.permissionPreset || "workspace-write",
        promptTemplate: rule.promptTemplate || ""
      } : {
        id: seed && seed.id || "",
        isNew: true,
        enabled: true,
        secret: generateWebhookSecret(),
        event: seed && seed.event || "",
        actionMode: seed && seed.actionMode || "steer",
        sessionId: seed && seed.sessionId || "",
        steer: seed ? seed.steer !== false : true,
        workspacePath: seed && seed.workspacePath || "",
        agentPreset: seed && seed.agentPreset || "cordis",
        permissionPreset: seed && seed.permissionPreset || "workspace-write",
        promptTemplate: seed && seed.promptTemplate || ""
      }
    });
  }
  function patchDraft(partial) {
    setState(function(cur) {
      var next = (
        /** @type {Record<string, any>} */
        {}
      );
      for (var k in cur) next[k] = cur[k];
      next.draft = next.draft ? mergeObject(next.draft, partial) : null;
      return next;
    });
  }
  function closeEditor() {
    patch({ editorOpen: false, draft: null, error: "" });
  }
  function toggleSecret() {
    setState(function(cur) {
      var next = (
        /** @type {Record<string, any>} */
        {}
      );
      for (var k in cur) next[k] = cur[k];
      next.showSecret = !cur.showSecret;
      return next;
    });
  }
  function saveDraft() {
    var d = state.draft;
    if (!d) return;
    patch({ busy: true, error: "" });
    var entry = (
      /** @type {Record<string, any>} */
      {
        id: d.id,
        enabled: d.enabled,
        secret: d.secret,
        event: d.event,
        action: {
          mode: d.actionMode
        },
        promptTemplate: d.promptTemplate
      }
    );
    if (d.actionMode === "steer") {
      entry.action.sessionId = d.sessionId;
      entry.action.steer = d.steer;
    } else {
      entry.action.workspacePath = d.workspacePath;
      entry.action.agentPreset = d.agentPreset;
      entry.action.permissionPreset = d.permissionPreset;
    }
    callRemote("webhookAdmin/saveRule", { entry }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        closeEditor();
        var v = result.value || {};
        patch({ busy: false, rules: v.rules || [], history: v.history || [] });
      } else {
        patch({ busy: false, error: dshT("\u4FDD\u5B58\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u4FDD\u5B58\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function deleteRule(id) {
    patch({ busy: true, error: "", confirmId: null });
    callRemote("webhookAdmin/deleteRule", { id }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        patch({ rules: v.rules || [], history: v.history || [], busy: false });
      } else {
        patch({ busy: false, error: dshT("\u5220\u9664\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u5220\u9664\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function testRule(id) {
    patch({ busy: true, error: "" });
    callRemote("webhookAdmin/testRule", { id }).then(function(result) {
      if (!alive.current) return;
      patch({ busy: false });
      var v = result.ok ? result.value || {} : {};
      if (result.ok && v.ok) {
        reload();
      } else {
        patch({ error: dshT("\u89E6\u53D1\u6D4B\u8BD5\u5931\u8D25\uFF1A") + (messageOf(v.error || result.error) || dshT("\u672A\u77E5\u9519\u8BEF")) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u89E6\u53D1\u6D4B\u8BD5\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function runtimeInstall() {
    patch({ busy: true, error: "" });
    callRemote("webhookAdmin/runtimeInstall", {}).then(function(result) {
      if (!alive.current) return;
      patch({ busy: false });
      var v = result.value || {};
      if (v.ok) {
        patch({ runtimePackageInstalled: true, error: dshT("\u5B89\u88C5\u5B8C\u6210\uFF0C\u8BF7\u91CD\u542F dsh \u540E\u751F\u6548\u3002") });
      } else {
        patch({ error: dshT("\u5B89\u88C5\u5931\u8D25\uFF1A") + messageOf(v.error || result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u5B89\u88C5\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function pickDirectory() {
    callRemote("workspaceAdmin/pickDirectory", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        patch({ pickerAvailable: v.available === true });
        if (typeof v.path === "string" && v.path !== "") patchDraft({ workspacePath: v.path });
      } else {
        patch({ error: dshT("\u76EE\u5F55\u9009\u62E9\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ error: dshT("\u76EE\u5F55\u9009\u62E9\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  var webhookActions = {
    patch,
    patchDraft,
    reload,
    openEditor,
    closeEditor,
    toggleSecret,
    saveDraft,
    deleteRule,
    testRule,
    runtimeInstall,
    pickDirectory
  };
  return createElement(
    "div",
    { "data-dsh-admin-section": "" },
    WebhookRender(state, webhookActions)
  );
}
function CronSection(props) {
  var kit = sectionState({
    busy: false,
    error: "",
    tasks: [],
    history: [],
    presets: [],
    permissionPresetNames: [],
    storagePath: "",
    editorOpen: false,
    draft: null,
    confirmId: null,
    pickerAvailable: true,
    // native directory picker capability; the first workspaceAdmin/pickDirectory call corrects it
    nowMs: Date.now()
  });
  var state = kit.state;
  var setState = kit.set;
  var alive = kit.alive;
  function patch(partial) {
    kit.patch(partial);
  }
  var callRemote = props.call;
  function reload() {
    patch({ busy: true, error: "" });
    Promise.all([
      callRemote("cronAdmin/list", {}),
      callRemote("webhookAdmin/list", {})
    ]).then(function(results) {
      if (!alive.current) return;
      var cronRes = results[0];
      var hookRes = results[1];
      if (!cronRes.ok) {
        patch({ busy: false, error: dshT("\u52A0\u8F7D\u5931\u8D25\uFF1A") + messageOf(cronRes.error) });
        return;
      }
      var v = cronRes.value || {};
      var h = hookRes && hookRes.ok && hookRes.value || {};
      patch({
        busy: false,
        tasks: v.tasks || [],
        history: v.history || [],
        storagePath: v.storagePath || "",
        presets: h.presets || [],
        permissionPresetNames: h.permissionPresetNames || []
      });
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  kit.mount(reload);
  useEffect(function() {
    if (state.tasks.length === 0) return void 0;
    var timer = setInterval(function() {
      setState(function(cur) {
        var next = (
          /** @type {Record<string, any>} */
          {}
        );
        for (var k in cur) next[k] = cur[k];
        next.nowMs = Date.now();
        return next;
      });
    }, 1e3);
    return function() {
      clearInterval(timer);
    };
  }, [state.tasks]);
  function patchSchedule(partial) {
    setState(function(cur) {
      if (!cur.draft) return cur;
      var draft = mergeObject(cur.draft, partial);
      draft.cron = composeCron(draft.schedMode, draft.schedTime, draft.schedDow);
      var next = (
        /** @type {Record<string, any>} */
        {}
      );
      for (var k in cur) next[k] = cur[k];
      next.draft = draft;
      return next;
    });
  }
  function openEditor(task, seed) {
    var sched = parseCronSchedule(task ? task.cron : seed && seed.cron || "0 9 * * *");
    patch({
      editorOpen: true,
      error: "",
      draft: task ? {
        id: task.id,
        isNew: false,
        enabled: task.enabled,
        cron: task.cron,
        schedMode: sched.schedMode,
        schedTime: sched.schedTime || "09:00",
        schedDow: sched.schedDow || "1",
        actionMode: task.action ? task.action.mode : "steer",
        sessionId: task.action && task.action.sessionId || "",
        steer: task.action && task.action.steer === true,
        workspacePath: task.action && task.action.workspacePath || "",
        agentPreset: task.action && task.action.agentPreset || "cordis",
        permissionPreset: task.action && task.action.permissionPreset || "workspace-write",
        promptTemplate: task.promptTemplate || ""
      } : {
        id: seed && seed.id || "",
        isNew: true,
        enabled: true,
        cron: seed && seed.cron || "0 9 * * *",
        schedMode: sched.schedMode,
        schedTime: sched.schedTime || "09:00",
        schedDow: sched.schedDow || "1",
        actionMode: seed && seed.actionMode || "steer",
        sessionId: seed && seed.sessionId || "",
        steer: seed ? seed.steer !== false : true,
        workspacePath: seed && seed.workspacePath || "",
        agentPreset: seed && seed.agentPreset || "cordis",
        permissionPreset: seed && seed.permissionPreset || "workspace-write",
        promptTemplate: seed && seed.promptTemplate || ""
      }
    });
  }
  function patchDraft(partial) {
    setState(function(cur) {
      var next = (
        /** @type {Record<string, any>} */
        {}
      );
      for (var k in cur) next[k] = cur[k];
      next.draft = next.draft ? mergeObject(next.draft, partial) : null;
      return next;
    });
  }
  function closeEditor() {
    patch({ editorOpen: false, draft: null, error: "" });
  }
  function saveDraft() {
    var d = state.draft;
    if (!d) return;
    patch({ busy: true, error: "" });
    var entry = (
      /** @type {Record<string, any>} */
      {
        id: d.id,
        enabled: d.enabled,
        cron: d.cron,
        action: { mode: d.actionMode },
        promptTemplate: d.promptTemplate
      }
    );
    if (d.actionMode === "steer") {
      entry.action.sessionId = d.sessionId;
      entry.action.steer = d.steer;
    } else {
      entry.action.workspacePath = d.workspacePath;
      entry.action.agentPreset = d.agentPreset;
      entry.action.permissionPreset = d.permissionPreset;
    }
    callRemote("cronAdmin/upsert", { entry }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        closeEditor();
        var v = result.value || {};
        patch({ busy: false, tasks: v.tasks || [], history: v.history || [] });
      } else {
        patch({ busy: false, error: dshT("\u4FDD\u5B58\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u4FDD\u5B58\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function deleteTask(id) {
    patch({ busy: true, error: "", confirmId: null });
    callRemote("cronAdmin/remove", { id }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        patch({ tasks: v.tasks || [], history: v.history || [], busy: false });
      } else {
        patch({ busy: false, error: dshT("\u5220\u9664\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u5220\u9664\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function toggleTask(id, enabled) {
    callRemote("cronAdmin/toggle", { id, enabled }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        patch({ tasks: v.tasks || [], history: v.history || [] });
      } else {
        patch({ error: dshT("\u5207\u6362\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ error: dshT("\u5207\u6362\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function runNow(id) {
    patch({ busy: true, error: "" });
    callRemote("cronAdmin/runNow", { id }).then(function(result) {
      if (!alive.current) return;
      patch({ busy: false });
      var v = result.ok ? result.value || {} : {};
      if (result.ok && v.ok) {
        reload();
      } else {
        patch({ error: dshT("\u7ACB\u5373\u89E6\u53D1\u5931\u8D25\uFF1A") + (messageOf(v.error || result.error) || dshT("\u672A\u77E5\u9519\u8BEF")) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u7ACB\u5373\u89E6\u53D1\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function pickDirectory() {
    callRemote("workspaceAdmin/pickDirectory", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        patch({ pickerAvailable: v.available === true });
        if (typeof v.path === "string" && v.path !== "") patchDraft({ workspacePath: v.path });
      } else {
        patch({ error: dshT("\u76EE\u5F55\u9009\u62E9\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ error: dshT("\u76EE\u5F55\u9009\u62E9\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  var cronActions = {
    patch,
    patchDraft,
    patchSchedule,
    reload,
    openEditor,
    closeEditor,
    saveDraft,
    deleteTask,
    toggleTask,
    runNow,
    pickDirectory
  };
  return createElement(
    "div",
    { "data-dsh-admin-section": "" },
    CronRender(state, cronActions)
  );
}
function WebhookRender(view, actions) {
  var elements = [];
  if (view.busy) elements.push(createElement(
    "div",
    { className: "busy-banner", key: "busy" },
    createElement("span", { className: "spinner", key: "sp" }),
    dshT("\u52A0\u8F7D\u4E2D\u2026")
  ));
  if (view.error) elements.push(createElement("div", { className: "error", key: "err" }, view.error));
  if (!view.runtimeMounted) {
    elements.push(createElement(
      "div",
      { className: "update-strip checking", key: "runtime-banner" },
      createElement("span", null, dshT("\u65B0\u5EFA\u4F1A\u8BDD\u6A21\u5F0F\u9700\u8981 "), createElement("code", null, "@deepseek-ai/dsh-webhook"), dshT(" webhook \u8FD0\u884C\u65F6")),
      view.runtimePackageInstalled ? createElement("span", null, dshT("\uFF08\u5DF2\u5B89\u88C5\uFF0C\u9700\u6302\u8F7D\u5230 cordis.patch.yml \u5E76\u91CD\u542F dsh\uFF09")) : createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", onClick: function() {
        actions.runtimeInstall();
      }, key: "btn-install-rt" }, dshT("\u26A1 \u5B89\u88C5\u5E76\u6302\u8F7D webhook \u8FD0\u884C\u65F6"))
    ));
  }
  if (view.endpointOnline) {
    var sampleId = view.rules.length > 0 ? view.rules[0].id : "my-rule";
    elements.push(createElement(
      "div",
      { className: "card", key: "endpoint-hint", style: { padding: "8px 12px", fontSize: "12px" } },
      createElement("span", { style: { fontWeight: 600 } }, "POST "),
      view.endpointPrefix,
      "/",
      createElement("code", null, sampleId),
      "  ",
      createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #61666b)" } }, "\uFF08headers: ", createElement("code", null, "x-webhook-secret"), ", ", createElement("code", null, "x-webhook-event"), ", ", createElement("code", null, "x-webhook-delivery"), dshT("\uFF09"))
    ));
  }
  elements.push(createElement("div", { className: "card", key: "guide", style: { padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--dsw-static-blue-500, #5B4CF0)", background: "var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))" } }, [
    createElement("div", { key: "g1", style: { fontWeight: "700", marginBottom: "4px" } }, dshT("Webhook = \u5916\u90E8\u4E8B\u4EF6 POST \u4E00\u4E2A HTTP \u8BF7\u6C42\uFF0C\u5C31\u81EA\u52A8\u7ED9\u4F60\u7684 dsh \u4F1A\u8BDD\u53D1\u4E00\u6761\u6D88\u606F\uFF08CI\u3001\u62A5\u8B66\u3001GitHub\u2026\u90FD\u884C\uFF09")),
    createElement("div", { key: "g2", style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, #666)" } }, dshT("\u4E09\u6B65\u4E0A\u624B\uFF1A\u2460 \u70B9\u4E0B\u65B9\u6A21\u677F\u5361\u7247\uFF08\u6216\u300C\uFF0B \u65B0\u5EFA\u89C4\u5219\u300D\uFF09 \u2192 \u2461 \u628A\u9762\u677F\u7ED9\u51FA\u7684\u7AEF\u70B9 URL \u4E0E\u5BC6\u94A5\u914D\u5230\u5916\u90E8\u670D\u52A1 \u2192 \u2462 \u4E8B\u4EF6\u5230\u8FBE\u81EA\u52A8\u89E6\u53D1\uFF0C\u4EA4\u4ED8\u5386\u53F2\u968F\u65F6\u53EF\u67E5\u3002"))
  ]));
  elements.push(createElement(
    "div",
    { className: "toolbar", key: "toolbar" },
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: function() {
      actions.openEditor(null);
    } }, dshT("+ \u65B0\u5EFA\u89C4\u5219")),
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: function() {
      actions.reload();
    } }, dshT("\u27F3 \u5237\u65B0"))
  ));
  elements.push(createElement("div", { key: "tpl-head", style: { fontWeight: "600" } }, dshT("\u4ECE\u6A21\u677F\u5F00\u59CB\uFF08\u70B9\u5361\u7247\u81EA\u52A8\u586B\u597D\uFF0C\u6539\u53C2\u6570\u5C31\u80FD\u8DD1\uFF09")));
  elements.push(createElement(
    "div",
    { key: "tpl-row", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
    webhookTemplates().map(function(tpl, tplIndex) {
      var openTpl = function() {
        actions.openEditor(null, tpl.seed);
      };
      return createElement("div", {
        key: "tpl-" + tplIndex,
        role: "button",
        tabIndex: 0,
        onClick: openTpl,
        onKeyDown: function(event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openTpl();
          }
        },
        style: { flex: "1", minWidth: "170px", padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--dsw-static-blue-500, #5B4CF0)", background: "var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))", cursor: "pointer" }
      }, [
        createElement("div", { key: "t", style: { fontWeight: "700" } }, tpl.title),
        createElement("div", { key: "d", style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, #666)", marginTop: "2px" } }, tpl.desc)
      ]);
    })
  ));
  if (view.editorOpen) {
    elements.push(renderWebhookEditor(view, actions));
  } else {
    if (view.rules.length === 0) {
      elements.push(createElement("div", { className: "empty", key: "empty" }, dshT("\u8FD8\u6CA1\u6709 Webhook \u89E6\u53D1\u89C4\u5219\u3002\u70B9\u4E0A\u65B9\u6A21\u677F\u5361\u7247\u4E00\u952E\u521B\u5EFA\uFF0C\u6216\u300C\uFF0B \u65B0\u5EFA\u89C4\u5219\u300D\u4ECE\u96F6\u5F00\u59CB\u3002")));
    }
    for (var i = 0; i < view.rules.length; i++) {
      const rule = view.rules[i];
      elements.push(createElement(
        "div",
        { className: "card", key: "rule-" + rule.id },
        createElement(
          "div",
          { className: "card-header" },
          createElement(
            "span",
            { className: "card-title" },
            createElement("span", { className: "card-title-text", title: rule.id }, rule.id),
            rule.enabled ? null : createElement("span", { className: "tag", style: { background: "rgba(239,68,68,0.1)", color: "#ef4444" } }, dshT("\u5DF2\u505C\u7528")),
            rule.event ? createElement("span", { className: "tag" }, rule.event) : null
          ),
          createElement(
            "span",
            { className: "card-actions" },
            createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: function(e) {
              e.stopPropagation();
              actions.openEditor(rule);
            } }, dshT("\u7F16\u8F91")),
            createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: function(e) {
              e.stopPropagation();
              actions.testRule(rule.id);
            }, title: dshT("\u4F1A\u771F\u5B9E\u6CE8\u5165\u6D88\u606F\u5230\u76EE\u6807\u4F1A\u8BDD") }, dshT("\u{1F9EA} \u89E6\u53D1\u6D4B\u8BD5")),
            createElement(import_dsh_client_ui_primitives.Button, {
              variant: "outline",
              size: "sm",
              className: "danger",
              onClick: function(e) {
                e.stopPropagation();
                actions.patch({ confirmId: view.confirmId === rule.id ? null : rule.id });
              }
            }, view.confirmId === rule.id ? "\u2715" : dshT("\u5220\u9664"))
          )
        ),
        view.confirmId === rule.id ? createElement(
          "div",
          { className: "confirm-bar", key: "confirm" },
          createElement("span", { className: "confirm-text" }, dshT("\u786E\u5B9A\u5220\u9664\u89C4\u5219\u300C"), rule.id, "\u300D\uFF1F"),
          createElement(
            "span",
            { className: "confirm-actions" },
            createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: function() {
              actions.patch({ confirmId: null });
            } }, dshT("\u53D6\u6D88")),
            createElement(import_dsh_client_ui_primitives.Button, {
              variant: "outline",
              size: "sm",
              className: "danger-solid",
              onClick: function() {
                actions.deleteRule(rule.id);
              }
            }, dshT("\u5220\u9664"))
          )
        ) : null,
        createElement(
          "div",
          { className: "card-sub" },
          createElement(
            "span",
            { className: "card-sub-item" },
            rule.action.mode === "steer" ? "\u{1F4E8} push \u2192 " + rule.action.sessionId + (rule.action.steer ? " (steer)" : " (followup)") : "\u{1F195} create \u2192 " + (rule.action.agentPreset || "?")
          )
        ),
        rule.promptTemplate ? createElement(
          "div",
          { className: "card-sub", style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)", maxHeight: "2.2em", overflow: "hidden" } },
          createElement("span", null, "\u2699 " + rule.promptTemplate.slice(0, 120) + (rule.promptTemplate.length > 120 ? "\u2026" : ""))
        ) : null
      ));
    }
  }
  if (view.history.length > 0) {
    elements.push(createElement(
      "div",
      { style: { marginTop: "8px", fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" }, key: "hist-head" },
      dshT("\u6700\u8FD1 ") + view.history.length + dshT(" \u6B21\u4EA4\u4ED8\uFF08\u672C\u6B21\u8FD0\u884C\u671F\u95F4\uFF09")
    ));
    for (var hi = 0; hi < view.history.length; hi++) {
      var h = view.history[hi];
      var ok = h.ok !== false;
      elements.push(createElement(
        "div",
        { className: "card", key: "hist-" + hi, style: { padding: "8px 12px", fontSize: "12px" } },
        createElement(
          "div",
          { style: { display: "flex", gap: "8px", alignItems: "center" } },
          createElement("span", { style: ok ? { color: "#16a34a" } : { color: "#ef4444" } }, ok ? "\u2713" : "\u2717"),
          createElement("span", { style: { fontWeight: 600 } }, h.ruleId || "?"),
          createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #61666b)" } }, h.event || ""),
          createElement("span", { style: { marginLeft: "auto", color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: "10px" } }, h.at || "")
        ),
        h.error ? createElement("div", { style: { color: "#ef4444", marginTop: "2px", fontSize: "11px" } }, h.error) : null,
        h.sessionId ? createElement("div", { style: { color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: "10px", marginTop: "2px" } }, h.mode + " \u2192 " + h.sessionId) : null
      ));
    }
  }
  if (view.storagePath) {
    elements.push(createElement(
      "div",
      { className: "footer", key: "footer" },
      createElement("span", { className: "path", title: view.storagePath }, "\u{1F4C1} " + view.storagePath),
      createElement("span", null, dshT("Webhook \u89E6\u53D1"))
    ));
  }
  return createElement(import_react.default.Fragment, null, elements);
}
function renderWebhookEditor(view, actions) {
  var d = view.draft;
  if (!d) return null;
  var secondary = "var(--dsw-alias-label-secondary, #61666b)";
  var groupStyle = { display: "flex", flexDirection: "column", gap: "5px" };
  var labelStyle = { fontSize: "11px", color: secondary };
  return createElement(
    "div",
    { className: "card mcp-editor", key: "editor" },
    // Header: what is being edited + the 启用 toggle on the right — same
    // identity anchor as the cron editor.
    createElement(
      "div",
      { className: "card-header", key: "h" },
      createElement(
        "span",
        { className: "card-title" },
        createElement(
          "span",
          { className: "card-title-text" },
          d.isNew ? dshT("\u65B0\u5EFA\u89C4\u5219") : dshT("\u7F16\u8F91\u89C4\u5219") + " \xB7 " + d.id
        )
      ),
      createElement(
        "span",
        { style: { display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", flex: "none", cursor: "pointer" } },
        createElement(import_dsh_client_ui_primitives.Checkbox, {
          checked: d.enabled,
          onChange: function(next) {
            actions.patchDraft({ enabled: next });
          },
          label: dshT("\u542F\u7528")
        })
      )
    ),
    // ID
    createElement(
      "div",
      { style: groupStyle, key: "f-id" },
      createElement("label", { style: labelStyle }, "ID"),
      createElement(import_dsh_client_ui_primitives.Input, {
        value: d.id,
        disabled: !d.isNew,
        "aria-label": "ID",
        onChange: function(e) {
          actions.patchDraft({ id: e.target.value });
        },
        placeholder: dshT("\u89C4\u5219\u6807\u8BC6\uFF08\u82F1\u6587\u5B57\u6BCD\u5F00\u5934\uFF0C\u65E0\u7A7A\u683C\uFF09")
      })
    ),
    // 密钥 + 事件过滤 — two labeled halves on one wrapping row; the secret
    // keeps its 显示 / 换一个 buttons beside the input.
    createElement(
      "div",
      { style: { display: "flex", gap: "10px", flexWrap: "wrap" }, key: "f-secret-event" },
      createElement(
        "div",
        { style: { flex: 1, minWidth: "260px", display: "flex", flexDirection: "column", gap: "5px" } },
        createElement("label", { style: labelStyle }, dshT("\u5171\u4EAB\u5BC6\u94A5")),
        createElement(
          "div",
          { style: { display: "flex", gap: "6px" } },
          createElement(import_dsh_client_ui_primitives.Input, {
            type: view.showSecret ? "text" : "password",
            autoComplete: "new-password",
            "aria-label": dshT("\u5171\u4EAB\u5BC6\u94A5"),
            value: d.secret,
            onChange: function(e) {
              actions.patchDraft({ secret: e.target.value });
            },
            placeholder: dshT("\u5171\u4EAB\u5BC6\u94A5\uFF08\u5FC5\u586B\uFF1B\u7F16\u8F91\u65F6\u7559\u7A7A\u8868\u793A\u4FDD\u6301\u4E0D\u53D8\uFF09")
          }),
          createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: function() {
            actions.toggleSecret();
          } }, view.showSecret ? dshT("\u9690\u85CF") : dshT("\u663E\u793A")),
          createElement(import_dsh_client_ui_primitives.Button, {
            variant: "outline",
            size: "sm",
            key: "regen",
            title: dshT("\u6362\u4E00\u4E2A 16 \u4F4D\u968F\u673A\u5BC6\u94A5"),
            onClick: function() {
              actions.patchDraft({ secret: generateWebhookSecret() });
            }
          }, dshT("\u{1F3B2} \u6362\u4E00\u4E2A"))
        )
      ),
      createElement(
        "div",
        { style: { flex: 1, minWidth: "200px", display: "flex", flexDirection: "column", gap: "5px" } },
        createElement("label", { style: labelStyle }, dshT("\u4E8B\u4EF6\u8FC7\u6EE4")),
        createElement(import_dsh_client_ui_primitives.Input, {
          value: d.event,
          "aria-label": dshT("\u4E8B\u4EF6\u8FC7\u6EE4"),
          onChange: function(e) {
            actions.patchDraft({ event: e.target.value });
          },
          placeholder: dshT("\u4E8B\u4EF6\u8FC7\u6EE4\uFF08\u7559\u7A7A = \u4EFB\u610F\u4E8B\u4EF6\uFF09")
        })
      )
    ),
    // 动作模式
    createElement(
      "div",
      { style: groupStyle, key: "f-action" },
      createElement("label", { style: labelStyle }, dshT("\u52A8\u4F5C\u6A21\u5F0F")),
      createElement(
        "div",
        { style: { display: "flex", gap: "6px" } },
        createElement(import_dsh_client_ui_primitives.Pill, { active: d.actionMode === "steer", onClick: function() {
          actions.patchDraft({ actionMode: "steer" });
        } }, dshT("\u63A8\u9001\u5230\u65E2\u6709\u4F1A\u8BDD")),
        createElement(import_dsh_client_ui_primitives.Pill, { active: d.actionMode === "create", onClick: function() {
          actions.patchDraft({ actionMode: "create" });
        } }, dshT("\u65B0\u5EFA\u4F1A\u8BDD"))
      )
    ),
    d.actionMode === "steer" ? createElement(
      "div",
      { style: groupStyle, key: "f-target" },
      createElement("label", { style: labelStyle }, dshT("\u76EE\u6807\u4F1A\u8BDD")),
      createElement(import_dsh_client_ui_primitives.Input, { value: d.sessionId, onChange: function(e) {
        actions.patchDraft({ sessionId: e.target.value });
      }, placeholder: dshT("\u76EE\u6807\u4F1A\u8BDD ID\uFF08\u5982 session-xxx\uFF09") }),
      createElement(
        "span",
        { style: { display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: secondary } },
        createElement(import_dsh_client_ui_primitives.Checkbox, {
          checked: d.steer,
          onChange: function(next) {
            actions.patchDraft({ steer: next });
          },
          label: dshT("steer\uFF08\u63D2\u5165\u5230\u4E0B\u4E00\u6B65\u4E4B\u524D\uFF0C\u52FE\u9009\u540E agent \u5F53\u524D\u6B65\u9AA4\u5B8C\u6210\u540E\u7ACB\u5373\u5904\u7406\uFF09")
        })
      )
    ) : createElement(
      "div",
      { key: "f-target", style: { display: "flex", flexDirection: "column", gap: "7px" } },
      createElement(
        "div",
        { style: groupStyle },
        createElement("label", { style: labelStyle }, dshT("\u5DE5\u4F5C\u533A\u8DEF\u5F84")),
        createElement(
          "div",
          { style: { display: "flex", gap: "6px" } },
          createElement(import_dsh_client_ui_primitives.Input, { value: d.workspacePath, onChange: function(e) {
            actions.patchDraft({ workspacePath: e.target.value });
          }, placeholder: dshT("\u5DE5\u4F5C\u533A\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u5982 E:\\projects\\my-app\uFF09") }),
          createElement(import_dsh_client_ui_primitives.Button, {
            variant: "outline",
            size: "sm",
            disabled: view.pickerAvailable === false,
            title: view.pickerAvailable === false ? dshT("\u539F\u751F\u9009\u62E9\u5668\u4E0D\u53EF\u7528\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u7EDD\u5BF9\u8DEF\u5F84") : dshT("\u6253\u5F00\u5BBF\u4E3B\u7684\u76EE\u5F55\u9009\u62E9\u5668\uFF0C\u9009\u4E2D\u540E\u81EA\u52A8\u586B\u5165"),
            onClick: function() {
              actions.pickDirectory();
            }
          }, dshT("\u{1F4C1} \u9009\u62E9\u76EE\u5F55"))
        )
      ),
      createElement(
        "div",
        { style: { display: "flex", gap: "8px" } },
        createElement(
          "div",
          { style: { flex: 1, display: "flex", flexDirection: "column", gap: "4px" } },
          createElement("label", { style: labelStyle }, dshT("Agent \u9884\u8BBE")),
          createElement(
            "select",
            { className: "input", style: { width: "100%" }, value: d.agentPreset, "aria-label": dshT("Agent \u9884\u8BBE"), onChange: function(e) {
              actions.patchDraft({ agentPreset: e.target.value });
            } },
            (view.presets.length > 0 ? view.presets : [{ id: "cordis", name: "cordis" }]).map(function(p) {
              return createElement("option", { key: p.id, value: p.id }, p.name || p.id);
            })
          )
        ),
        createElement(
          "div",
          { style: { flex: 1, display: "flex", flexDirection: "column", gap: "4px" } },
          createElement("label", { style: labelStyle }, dshT("\u6743\u9650\u9884\u8BBE")),
          createElement(
            "select",
            { className: "input", style: { width: "100%" }, value: d.permissionPreset, "aria-label": dshT("\u6743\u9650\u9884\u8BBE"), onChange: function(e) {
              actions.patchDraft({ permissionPreset: e.target.value });
            } },
            (view.permissionPresetNames.length > 0 ? view.permissionPresetNames : ["workspace-write", "danger-full-access"]).map(function(n) {
              return createElement("option", { key: n, value: n }, n);
            })
          )
        )
      )
    ),
    // Prompt 模板
    createElement(
      "div",
      { style: groupStyle, key: "f-prompt" },
      createElement("label", { style: labelStyle }, dshT("Prompt \u6A21\u677F")),
      createElement("textarea", {
        className: "input",
        value: d.promptTemplate,
        onChange: function(e) {
          actions.patchDraft({ promptTemplate: e.target.value });
        },
        placeholder: dshT("\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u6A21\u677F\u3002$RULE / $DELIVERY / $EVENT / $PAYLOAD \u4F1A\u88AB\u66FF\u6362\u3002"),
        rows: 4,
        style: { fontFamily: "monospace", fontSize: "12px", resize: "vertical" }
      })
    ),
    createElement(
      "div",
      { className: "card-actions", style: { justifyContent: "flex-end", display: "flex", gap: "6px", marginTop: "8px" } },
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: function() {
        actions.closeEditor();
      } }, dshT("\u53D6\u6D88")),
      createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", disabled: view.busy, onClick: function() {
        actions.saveDraft();
      } }, d.isNew ? dshT("\u521B\u5EFA") : dshT("\u4FDD\u5B58"))
    )
  );
}
function formatCountdown(ms) {
  if (ms === null || ms === void 0 || ms < 0) return "\u2014";
  var total = Math.floor(ms / 1e3);
  if (total < 1) return "< 1s";
  var days = Math.floor(total / 86400);
  var rem = total - days * 86400;
  var h = Math.floor(rem / 3600);
  var m = Math.floor((rem - h * 3600) / 60);
  var s = rem - h * 3600 - m * 60;
  var pad = function(n) {
    return (n < 10 ? "0" : "") + n;
  };
  if (days > 0) return days + "d " + pad(h) + ":" + pad(m) + ":" + pad(s);
  if (h > 0) return pad(h) + ":" + pad(m) + ":" + pad(s);
  if (m > 0) return pad(m) + ":" + pad(s);
  return s + "s";
}
function formatLocal(ms) {
  if (ms === null || ms === void 0) return "\u2014";
  var d = new Date(ms);
  var pad = function(n) {
    return (n < 10 ? "0" : "") + n;
  };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function CronRender(view, actions) {
  var elements = [];
  if (view.busy) elements.push(createElement(
    "div",
    { className: "busy-banner", key: "busy" },
    createElement("span", { className: "spinner", key: "sp" }),
    dshT("\u52A0\u8F7D\u4E2D\u2026")
  ));
  if (view.error) elements.push(createElement("div", { className: "error", key: "err" }, view.error));
  elements.push(createElement("div", { className: "card", key: "guide", style: { padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--dsw-static-blue-500, #5B4CF0)", background: "var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))" } }, [
    createElement("div", { key: "g1", style: { fontWeight: "700", marginBottom: "4px" } }, dshT("\u5B9A\u65F6\u4EFB\u52A1 = \u5230\u70B9\u81EA\u52A8\u7ED9 dsh \u53D1\u4E00\u53E5\u8BDD\u2014\u2014\u53EF\u4EE5\u50AC\u4FC3\u65E2\u6709\u4F1A\u8BDD\uFF08steer\uFF09\uFF0C\u4E5F\u53EF\u4EE5\u65B0\u5EFA\u4F1A\u8BDD\u4ECE\u5934\u8DD1")),
    createElement("div", { key: "g2", style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, #666)" } }, dshT("\u4E09\u6B65\u4E0A\u624B\uFF1A\u2460 \u70B9\u4E0B\u65B9\u6A21\u677F\u5361\u7247\uFF08\u6216\u300C\uFF0B \u65B0\u5EFA\u4EFB\u52A1\u300D\uFF09 \u2192 \u2461 \u6539\u9891\u7387\u548C\u63D0\u793A\u8BCD \u2192 \u2462 \u4FDD\u5B58\uFF0Cdsh \u8FD0\u884C\u671F\u95F4\u5230\u70B9\u81EA\u52A8\u89E6\u53D1\u3002"))
  ]));
  elements.push(createElement(
    "div",
    { className: "toolbar", key: "toolbar" },
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: function() {
      actions.openEditor(null);
    } }, dshT("+ \u65B0\u5EFA\u4EFB\u52A1")),
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: function() {
      actions.reload();
    } }, dshT("\u27F3 \u5237\u65B0"))
  ));
  elements.push(createElement("div", { key: "tpl-head", style: { fontWeight: "600" } }, dshT("\u4ECE\u6A21\u677F\u5F00\u59CB\uFF08\u70B9\u5361\u7247\u81EA\u52A8\u586B\u597D\uFF0C\u6539\u53C2\u6570\u5C31\u80FD\u8DD1\uFF09")));
  elements.push(createElement(
    "div",
    { key: "tpl-row", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
    cronTemplates().map(function(tpl, tplIndex) {
      var openTpl = function() {
        actions.openEditor(null, tpl.seed);
      };
      return createElement("div", {
        key: "tpl-" + tplIndex,
        role: "button",
        tabIndex: 0,
        onClick: openTpl,
        onKeyDown: function(event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openTpl();
          }
        },
        style: { flex: "1", minWidth: "170px", padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--dsw-static-blue-500, #5B4CF0)", background: "var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))", cursor: "pointer" }
      }, [
        createElement("div", { key: "t", style: { fontWeight: "700" } }, tpl.title),
        createElement("div", { key: "d", style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary, #666)", marginTop: "2px" } }, tpl.desc)
      ]);
    })
  ));
  if (view.editorOpen) {
    elements.push(renderCronEditor(view, actions));
  } else {
    if (view.tasks.length === 0) {
      elements.push(createElement(
        "div",
        { className: "empty", key: "empty" },
        dshT("\u8FD8\u6CA1\u6709\u5B9A\u65F6\u4EFB\u52A1\u3002\u70B9\u4E0A\u65B9\u6A21\u677F\u5361\u7247\u4E00\u952E\u521B\u5EFA\uFF0C\u6216\u300C\uFF0B \u65B0\u5EFA\u4EFB\u52A1\u300D\u4ECE\u96F6\u5F00\u59CB\uFF1B\u4EFB\u52A1\u5728 dsh \u8FD0\u884C\u671F\u95F4\u6309 cron \u8868\u8FBE\u5F0F\u81EA\u52A8\u89E6\u53D1\u3002")
      ));
    }
    for (var i = 0; i < view.tasks.length; i++) {
      const task = view.tasks[i];
      var nextIn = task.nextRun === null ? null : task.nextRun - view.nowMs;
      elements.push(createElement(
        "div",
        { className: "card", key: "task-" + task.id },
        createElement(
          "div",
          { className: "card-header" },
          createElement(
            "span",
            { className: "card-title" },
            createElement("span", { className: "card-title-text", title: task.id }, task.id),
            task.enabled ? null : createElement("span", { className: "tag", style: { background: "rgba(239,68,68,0.1)", color: "#ef4444" } }, dshT("\u5DF2\u505C\u7528")),
            task.nextRun === null ? createElement("span", { className: "tag", style: { background: "rgba(234,179,8,0.12)", color: "#eab308" } }, dshT("\u65E0\u53EF\u89E6\u53D1\u65F6\u523B")) : null
          ),
          createElement(
            "span",
            { className: "card-actions" },
            // The span keeps the inline layout AND the click guard: the atom has no
            // onClick/style props, and the card behind this toggle must not react.
            createElement(
              "span",
              { style: { display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", marginRight: "4px" }, title: dshT("\u542F\u7528/\u505C\u7528"), onClick: function(e) {
                e.stopPropagation();
              } },
              createElement(import_dsh_client_ui_primitives.Checkbox, {
                checked: task.enabled === true,
                onChange: function(next) {
                  actions.toggleTask(task.id, next);
                },
                label: dshT("\u542F\u7528")
              })
            ),
            createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", onClick: function(e) {
              e.stopPropagation();
              actions.openEditor(task);
            } }, dshT("\u7F16\u8F91")),
            createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", onClick: function(e) {
              e.stopPropagation();
              actions.runNow(task.id);
            }, title: dshT("\u7ACB\u5373\u89E6\u53D1\u4E00\u6B21\uFF08\u4F1A\u771F\u5B9E\u6CE8\u5165\u6D88\u606F/\u65B0\u5EFA\u4F1A\u8BDD\uFF09") }, dshT("\u25B6 \u7ACB\u5373\u89E6\u53D1")),
            createElement(import_dsh_client_ui_primitives.Button, {
              variant: "outline",
              size: "sm",
              className: "danger",
              onClick: function(e) {
                e.stopPropagation();
                actions.patch({ confirmId: view.confirmId === task.id ? null : task.id });
              }
            }, view.confirmId === task.id ? "\u2715" : dshT("\u5220\u9664"))
          )
        ),
        view.confirmId === task.id ? createElement(
          "div",
          { className: "confirm-bar", key: "confirm" },
          createElement("span", { className: "confirm-text" }, dshT("\u786E\u5B9A\u5220\u9664\u4EFB\u52A1\u300C"), task.id, "\u300D\uFF1F"),
          createElement(
            "span",
            { className: "confirm-actions" },
            createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: function() {
              actions.patch({ confirmId: null });
            } }, dshT("\u53D6\u6D88")),
            createElement(import_dsh_client_ui_primitives.Button, {
              variant: "outline",
              size: "sm",
              className: "danger-solid",
              onClick: function() {
                actions.deleteTask(task.id);
              }
            }, dshT("\u5220\u9664"))
          )
        ) : null,
        createElement(
          "div",
          { className: "card-sub" },
          createElement(
            "span",
            { className: "card-sub-item" },
            createElement("code", { style: { fontSize: "12px" } }, task.cron || "?"),
            task.action.mode === "steer" ? "  \u{1F4E8} push \u2192 " + task.action.sessionId + (task.action.steer ? " (steer)" : " (followup)") : "  \u{1F195} create \u2192 " + (task.action.agentPreset || "?")
          )
        ),
        createElement(
          "div",
          { className: "card-sub", style: { fontSize: "11px" } },
          createElement(
            "span",
            { className: "card-sub-item", style: { color: "var(--dsw-alias-label-secondary, #61666b)" } },
            dshT("\u23F1 \u4E0B\u6B21\u89E6\u53D1 "),
            createElement(
              "span",
              { style: { fontWeight: 600 }, title: task.nextRunISO ? formatLocal(task.nextRunISO) : "" },
              task.nextRun === null ? dshT("\u2014\uFF08\u8868\u8FBE\u5F0F\u5728\u53EF\u641C\u7D22\u8303\u56F4\u5185\u65E0\u5339\u914D\u65E5\u671F\uFF09") : formatCountdown(nextIn) + dshT(" \u540E (") + formatLocal(task.nextRun) + ")"
            )
          ),
          task.action.mode === "steer" && task.targetOnline === false ? createElement("span", { className: "card-sub-item", style: { color: "#eab308" }, title: dshT("\u76EE\u6807\u4F1A\u8BDD\u4E0D\u5728\u5185\u5B58\u4E2D\uFF0C\u89E6\u53D1\u65F6\u6CE8\u5165\u4F1A\u5931\u8D25") }, dshT("\u26A0 \u76EE\u6807\u4F1A\u8BDD\u79BB\u7EBF")) : null
        ),
        task.promptTemplate ? createElement(
          "div",
          { className: "card-sub", style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)", maxHeight: "2.2em", overflow: "hidden" } },
          createElement("span", null, "\u2699 " + task.promptTemplate.slice(0, 120) + (task.promptTemplate.length > 120 ? "\u2026" : ""))
        ) : null
      ));
    }
  }
  if (view.history.length > 0) {
    elements.push(createElement(
      "div",
      { style: { marginTop: "8px", fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" }, key: "hist-head" },
      dshT("\u6700\u8FD1 ") + view.history.length + dshT(" \u6B21\u89E6\u53D1\uFF08\u672C\u6B21\u8FD0\u884C\u671F\u95F4\uFF09")
    ));
    for (var hi = 0; hi < view.history.length; hi++) {
      var h = view.history[hi];
      var ok = h.ok !== false;
      elements.push(createElement(
        "div",
        { className: "card", key: "hist-" + hi, style: { padding: "8px 12px", fontSize: "12px" } },
        createElement(
          "div",
          { style: { display: "flex", gap: "8px", alignItems: "center" } },
          createElement("span", { style: ok ? { color: "#16a34a" } : { color: "#ef4444" } }, ok ? "\u2713" : "\u2717"),
          createElement("span", { style: { fontWeight: 600 } }, h.taskId || "?"),
          createElement("span", { style: { marginLeft: "auto", color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: "10px" } }, h.at || "")
        ),
        h.error ? createElement("div", { style: { color: "#ef4444", marginTop: "2px", fontSize: "11px" } }, h.error) : null,
        h.sessionId ? createElement("div", { style: { color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: "10px", marginTop: "2px" } }, h.mode + " \u2192 " + h.sessionId) : null
      ));
    }
  }
  if (view.storagePath) {
    elements.push(createElement(
      "div",
      { className: "footer", key: "footer" },
      createElement("span", { className: "path", title: view.storagePath }, "\u{1F4C1} " + view.storagePath),
      createElement("span", null, dshT("\u5B9A\u65F6\u4EFB\u52A1\uFF08\u5BBF\u4E3B\u7EA7\uFF09"))
    ));
  }
  return createElement(import_react.default.Fragment, null, elements);
}
function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
function composeCron(mode, time, dow) {
  var parts = /^(\d{1,2}):(\d{1,2})$/.exec(time || "09:00");
  var hh = parts ? Number(parts[1]) : 9;
  var mm = parts ? Number(parts[2]) : 0;
  if (mode === "hourly") return mm + " * * * *";
  if (mode === "weekly") return mm + " " + hh + " * * " + (dow || "1");
  return mm + " " + hh + " * * *";
}
function parseCronSchedule(cron) {
  var f = String(cron || "").trim().split(/\s+/);
  var num = function(s) {
    return /^\d+$/.test(s) ? Number(s) : null;
  };
  if (f.length === 5 && f[2] === "*" && f[3] === "*") {
    var m = num(f[0]);
    var h = num(f[1]);
    if (f[1] === "*" && f[4] === "*" && m !== null) return { schedMode: "hourly", schedTime: "00:" + pad2(m), schedDow: "1" };
    if (f[4] === "*" && h !== null && m !== null) return { schedMode: "daily", schedTime: pad2(h) + ":" + pad2(m), schedDow: "1" };
    var w = num(f[4]);
    if (h !== null && m !== null && w !== null && w >= 0 && w <= 6) return { schedMode: "weekly", schedTime: pad2(h) + ":" + pad2(m), schedDow: String(w) };
  }
  return { schedMode: "custom" };
}
function describeSchedule(mode, time, dow) {
  var names = (
    /** @type {Record<string, string>} */
    { "0": dshT("\u5468\u65E5"), "1": dshT("\u5468\u4E00"), "2": dshT("\u5468\u4E8C"), "3": dshT("\u5468\u4E09"), "4": dshT("\u5468\u56DB"), "5": dshT("\u5468\u4E94"), "6": dshT("\u5468\u516D") }
  );
  var parts = String(time || "09:00").split(":");
  if (mode === "hourly") return dshT("\u6BCF\u5C0F\u65F6\u7B2C ") + parts[1] + dshT(" \u5206");
  if (mode === "weekly") return dshT("\u6BCF\u5468 ") + (names[dow] || dow) + " " + time;
  return dshT("\u6BCF\u5929 ") + time;
}
function tzLabel() {
  var minutes = -(/* @__PURE__ */ new Date()).getTimezoneOffset();
  var sign = minutes < 0 ? "-" : "+";
  var abs = Math.abs(minutes);
  var hours = Math.floor(abs / 60);
  var rest = abs % 60;
  return "GMT" + sign + hours + (rest === 0 ? "" : ":" + (rest < 10 ? "0" : "") + rest);
}
function renderCronEditor(view, actions) {
  var d = view.draft;
  if (!d) return null;
  var secondary = "var(--dsw-alias-label-secondary, #61666b)";
  var schedSelectStyle = { width: "auto", height: "32px", padding: "0 30px 0 12px" };
  var groupStyle = { display: "flex", flexDirection: "column", gap: "5px" };
  var labelStyle = { fontSize: "11px", color: secondary };
  var schedPanelStyle = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", padding: "8px 10px", borderRadius: "10px", background: "var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.12))" };
  return createElement(
    "div",
    { className: "card mcp-editor", key: "editor" },
    // Header: what is being edited + the 启用 toggle on the right — the form
    // opens with an identity anchor instead of a bare unlabeled input row.
    createElement(
      "div",
      { className: "card-header", key: "h" },
      createElement(
        "span",
        { className: "card-title" },
        createElement(
          "span",
          { className: "card-title-text" },
          d.isNew ? dshT("\u65B0\u5EFA\u5B9A\u65F6\u4EFB\u52A1") : dshT("\u7F16\u8F91\u5B9A\u65F6\u4EFB\u52A1") + " \xB7 " + d.id
        )
      ),
      createElement(
        "span",
        { style: { display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", flex: "none", cursor: "pointer" } },
        createElement(import_dsh_client_ui_primitives.Checkbox, {
          checked: d.enabled,
          onChange: function(next) {
            actions.patchDraft({ enabled: next });
          },
          label: dshT("\u542F\u7528")
        })
      )
    ),
    // 任务 ID
    createElement(
      "div",
      { style: groupStyle, key: "f-id" },
      createElement("label", { style: labelStyle }, dshT("\u4EFB\u52A1 ID")),
      createElement(import_dsh_client_ui_primitives.Input, {
        value: d.id,
        onChange: function(e) {
          actions.patchDraft({ id: e.target.value });
        },
        placeholder: dshT("\u4EFB\u52A1\u6807\u8BC6\uFF08\u82F1\u6587\u5B57\u6BCD\u5F00\u5934\uFF0C\u65E0\u7A7A\u683C\uFF09"),
        "aria-label": dshT("\u4EFB\u52A1 ID")
      })
    ),
    // 调度 — mode/weekday/time controls on the inset panel, the composed
    // description (or the raw-cron syntax help in custom mode) under it.
    createElement(
      "div",
      { style: groupStyle, key: "f-sched" },
      createElement("label", { style: labelStyle }, dshT("\u8C03\u5EA6\uFF08\u672C\u5730\u65F6\u533A ") + tzLabel() + dshT("\uFF09")),
      createElement(
        "div",
        { style: schedPanelStyle },
        createElement(
          "select",
          {
            className: "input",
            style: schedSelectStyle,
            value: d.schedMode,
            "aria-label": dshT("\u8C03\u5EA6\u9891\u7387"),
            onChange: function(e) {
              actions.patchSchedule({ schedMode: e.target.value });
            }
          },
          [{ v: "hourly", t: dshT("\u6BCF\u5C0F\u65F6") }, { v: "daily", t: dshT("\u6BCF\u5929") }, { v: "weekly", t: dshT("\u6BCF\u5468") }, { v: "custom", t: dshT("\u81EA\u5B9A\u4E49") }].map(function(o) {
            return createElement("option", { key: o.v, value: o.v }, o.t);
          })
        ),
        d.schedMode === "weekly" ? createElement(
          "select",
          {
            className: "input",
            style: schedSelectStyle,
            value: d.schedDow,
            "aria-label": dshT("\u661F\u671F"),
            onChange: function(e) {
              actions.patchSchedule({ schedDow: e.target.value });
            }
          },
          [["1", dshT("\u5468\u4E00")], ["2", dshT("\u5468\u4E8C")], ["3", dshT("\u5468\u4E09")], ["4", dshT("\u5468\u56DB")], ["5", dshT("\u5468\u4E94")], ["6", dshT("\u5468\u516D")], ["0", dshT("\u5468\u65E5")]].map(function(o) {
            return createElement("option", { key: o[0], value: o[0] }, o[1]);
          })
        ) : null,
        d.schedMode !== "custom" ? createElement("span", { style: { fontSize: "12px", color: secondary } }, dshT("\u4E8E")) : null,
        d.schedMode === "hourly" ? createElement(
          "select",
          {
            className: "input",
            style: schedSelectStyle,
            value: Number(String(d.schedTime || "00:00").split(":")[1]),
            "aria-label": dshT("\u5206\u949F"),
            onChange: function(e) {
              actions.patchSchedule({ schedTime: "00:" + pad2(Number(e.target.value)) });
            }
          },
          Array.from({ length: 60 }, function(_, i) {
            return createElement("option", { key: i, value: i }, pad2(i));
          })
        ) : null,
        d.schedMode === "daily" || d.schedMode === "weekly" ? createElement(import_dsh_client_ui_primitives.Input, {
          style: { width: "auto", height: "32px", padding: "0 8px" },
          value: d.schedTime || "09:00",
          "aria-label": dshT("\u65F6\u95F4"),
          onChange: function(e) {
            actions.patchSchedule({ schedTime: e.target.value || "09:00" });
          }
        }) : null,
        d.schedMode === "custom" ? createElement(import_dsh_client_ui_primitives.Input, {
          value: d.cron,
          onChange: function(e) {
            actions.patchDraft({ cron: e.target.value });
          },
          placeholder: "*/5 * * * *",
          style: { fontFamily: "monospace", flex: 1, minWidth: "160px" },
          "aria-label": dshT("cron \u8868\u8FBE\u5F0F")
        }) : null
      ),
      createElement(
        "div",
        {
          style: { fontSize: "11px", color: secondary },
          title: d.cron
        },
        d.schedMode === "custom" ? dshT("5 \u4F4D cron\uFF08\u5206 \u65F6 \u65E5 \u6708 \u5468\uFF09\uFF1A\u652F\u6301 *, \u9017\u53F7\u5217\u8868, \u77ED\u6A2A\u8303\u56F4, \u659C\u6760\u6B65\u957F\uFF1B\u5468\u63A5\u53D7 0-7 \u4E0E SUN-SAT\u3002") : describeSchedule(d.schedMode, d.schedTime, d.schedDow) + " \xB7 " + d.cron + dshT(" \xB7 \u8FDB\u7A0B\u91CD\u542F\u671F\u95F4\u5230\u671F\u7684\u4EFB\u52A1\u4E0D\u8865\u6295\u3002")
      )
    ),
    // 动作模式
    createElement(
      "div",
      { style: groupStyle, key: "f-action" },
      createElement("label", { style: labelStyle }, dshT("\u52A8\u4F5C\u6A21\u5F0F")),
      createElement(
        "div",
        { style: { display: "flex", gap: "6px" } },
        createElement(import_dsh_client_ui_primitives.Pill, { active: d.actionMode === "steer", onClick: function() {
          actions.patchDraft({ actionMode: "steer" });
        } }, dshT("\u63A8\u9001\u5230\u65E2\u6709\u4F1A\u8BDD")),
        createElement(import_dsh_client_ui_primitives.Pill, { active: d.actionMode === "create", onClick: function() {
          actions.patchDraft({ actionMode: "create" });
        } }, dshT("\u65B0\u5EFA\u4F1A\u8BDD"))
      )
    ),
    d.actionMode === "steer" ? createElement(
      "div",
      { style: groupStyle, key: "f-target" },
      createElement("label", { style: labelStyle }, dshT("\u76EE\u6807\u4F1A\u8BDD")),
      createElement(import_dsh_client_ui_primitives.Input, { value: d.sessionId, onChange: function(e) {
        actions.patchDraft({ sessionId: e.target.value });
      }, placeholder: dshT("\u76EE\u6807\u4F1A\u8BDD ID\uFF08\u5982 session-xxx\uFF09") }),
      createElement(
        "span",
        { style: { display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: secondary } },
        createElement(import_dsh_client_ui_primitives.Checkbox, {
          checked: d.steer,
          onChange: function(next) {
            actions.patchDraft({ steer: next });
          },
          label: dshT("steer\uFF08\u63D2\u5165\u5230\u4E0B\u4E00\u6B65\u4E4B\u524D\uFF0C\u52FE\u9009\u540E agent \u5F53\u524D\u6B65\u9AA4\u5B8C\u6210\u540E\u7ACB\u5373\u5904\u7406\uFF09")
        })
      )
    ) : createElement(
      "div",
      { key: "f-target", style: { display: "flex", flexDirection: "column", gap: "7px" } },
      createElement(
        "div",
        { style: groupStyle },
        createElement("label", { style: labelStyle }, dshT("\u5DE5\u4F5C\u533A\u8DEF\u5F84")),
        createElement(
          "div",
          { style: { display: "flex", gap: "6px" } },
          createElement(import_dsh_client_ui_primitives.Input, { value: d.workspacePath, onChange: function(e) {
            actions.patchDraft({ workspacePath: e.target.value });
          }, placeholder: dshT("\u5DE5\u4F5C\u533A\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u5982 E:\\projects\\my-app\uFF09") }),
          createElement(import_dsh_client_ui_primitives.Button, {
            variant: "outline",
            size: "sm",
            disabled: view.pickerAvailable === false,
            title: view.pickerAvailable === false ? dshT("\u539F\u751F\u9009\u62E9\u5668\u4E0D\u53EF\u7528\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u7EDD\u5BF9\u8DEF\u5F84") : dshT("\u6253\u5F00\u5BBF\u4E3B\u7684\u76EE\u5F55\u9009\u62E9\u5668\uFF0C\u9009\u4E2D\u540E\u81EA\u52A8\u586B\u5165"),
            onClick: function() {
              actions.pickDirectory();
            }
          }, dshT("\u{1F4C1} \u9009\u62E9\u76EE\u5F55"))
        )
      ),
      createElement(
        "div",
        { style: { display: "flex", gap: "8px" } },
        createElement(
          "div",
          { style: { flex: 1, display: "flex", flexDirection: "column", gap: "4px" } },
          createElement("label", { style: labelStyle }, dshT("Agent \u9884\u8BBE")),
          createElement(
            "select",
            { className: "input", style: { width: "100%" }, value: d.agentPreset, "aria-label": dshT("Agent \u9884\u8BBE"), onChange: function(e) {
              actions.patchDraft({ agentPreset: e.target.value });
            } },
            (view.presets.length > 0 ? view.presets : [{ id: "cordis", name: "cordis" }]).map(function(p) {
              return createElement("option", { key: p.id, value: p.id }, p.name || p.id);
            })
          )
        ),
        createElement(
          "div",
          { style: { flex: 1, display: "flex", flexDirection: "column", gap: "4px" } },
          createElement("label", { style: labelStyle }, dshT("\u6743\u9650\u9884\u8BBE")),
          createElement(
            "select",
            { className: "input", style: { width: "100%" }, value: d.permissionPreset, "aria-label": dshT("\u6743\u9650\u9884\u8BBE"), onChange: function(e) {
              actions.patchDraft({ permissionPreset: e.target.value });
            } },
            (view.permissionPresetNames.length > 0 ? view.permissionPresetNames : ["workspace-write", "danger-full-access"]).map(function(n) {
              return createElement("option", { key: n, value: n }, n);
            })
          )
        )
      )
    ),
    // Prompt 模板
    createElement(
      "div",
      { style: groupStyle, key: "f-prompt" },
      createElement("label", { style: labelStyle }, dshT("Prompt \u6A21\u677F")),
      createElement("textarea", {
        className: "input",
        value: d.promptTemplate,
        onChange: function(e) {
          actions.patchDraft({ promptTemplate: e.target.value });
        },
        placeholder: dshT("\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u6A21\u677F\u3002$RULE / $DELIVERY / $EVENT / $PAYLOAD \u4F1A\u88AB\u66FF\u6362\u3002"),
        rows: 4,
        style: { fontFamily: "monospace", fontSize: "12px", resize: "vertical" }
      })
    ),
    createElement(
      "div",
      { className: "card-actions", style: { justifyContent: "flex-end", display: "flex", gap: "6px", marginTop: "8px" } },
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: function() {
        actions.closeEditor();
      } }, dshT("\u53D6\u6D88")),
      createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", disabled: view.busy, onClick: function() {
        actions.saveDraft();
      } }, d.isNew ? dshT("\u521B\u5EFA") : dshT("\u4FDD\u5B58"))
    )
  );
}

// src/client/panels/commands-hooks.js
var CH_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStart", "SubagentStop"];
var CH_MATCHERLESS = { UserPromptSubmit: true, Stop: true };
function chReloadNote(reload) {
  if (reload === void 0 || reload === null) return null;
  if (reload.reloaded) return dshT("\u2713 \u5DF2\u91CD\u542F hooks \u6865\uFF0C\u914D\u7F6E\u5DF2\u751F\u6548\u3002");
  if (reload.mounted) return dshT("\u26A0 hooks \u6865\u70ED\u91CD\u542F\u5931\u8D25\uFF1A") + messageOf(reload.error) + dshT("\uFF08\u914D\u7F6E\u5DF2\u5199\u5165\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548\uFF09");
  return dshT("\u5DF2\u5199\u5165 hooks.json\u3002\u5F53\u524D\u672A\u6302\u8F7D hooks \u6865\uFF08hooks-claude-code\uFF09\uFF0C\u6302\u8F7D\u540E\u751F\u6548\u3002");
}
function chNoticeClass(text) {
  if (typeof text === "string" && text.indexOf("\u2713") !== -1) return "notice ok";
  if (typeof text === "string" && text.indexOf("\u26A0") !== -1) return "notice warn";
  return "notice";
}
function chField(label, input, hint) {
  return createElement(
    "div",
    { className: "field", key: label },
    createElement("label", null, label),
    input,
    hint ? createElement("div", { className: "hint" }, hint) : null
  );
}
function chToggle(checked, onChange, label) {
  return createElement("button", {
    type: "button",
    role: "switch",
    className: "toggle",
    "aria-checked": checked ? "true" : "false",
    "aria-label": label,
    disabled: !onChange,
    onClick: onChange || void 0
  });
}
function ChCommandRow(props) {
  var c = props.command;
  var badges = [];
  if (!c.enabled) badges.push(createElement("span", { className: "tag", key: "off" }, dshT("\u5DF2\u505C\u7528")));
  if (c.conflict) badges.push(createElement("span", { className: "tag err", key: "conflict", title: c.conflict }, dshT("\u6CE8\u518C\u5931\u8D25")));
  if (c.fileError) badges.push(createElement("span", { className: "tag err", key: "file", title: c.fileError }, dshT("\u6587\u4EF6\u9519\u8BEF")));
  var actions = props.confirming ? [
    createElement(import_dsh_client_ui_primitives.Button, {
      variant: "outline",
      size: "sm",
      className: "danger",
      key: "yes",
      disabled: props.busy,
      onClick: props.onConfirmDelete
    }, dshT("\u786E\u8BA4\u5220\u9664")),
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "no", disabled: props.busy, onClick: props.onCancelDelete }, dshT("\u53D6\u6D88"))
  ] : [
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "edit", disabled: props.busy, onClick: props.onEdit }, dshT("\u7F16\u8F91")),
    createElement(import_dsh_client_ui_primitives.Button, {
      variant: "outline",
      size: "sm",
      className: "danger",
      key: "del",
      disabled: props.busy,
      "aria-label": dshT("\u5220\u9664\u547D\u4EE4 /") + c.name,
      onClick: props.onDelete
    }, dshT("\u5220\u9664"))
  ];
  return createElement(
    "div",
    { className: "row" + (c.enabled ? "" : " off") },
    createElement(
      "div",
      { className: "main" },
      createElement(
        "div",
        { className: "name-row" },
        createElement("span", { className: "name" }, "/" + c.name),
        badges
      ),
      createElement("div", { className: "desc" }, c.description || ""),
      c.inputHint ? createElement("div", { className: "meta" }, dshT("\u53C2\u6570\u63D0\u793A\uFF1A") + c.inputHint) : null
    ),
    createElement("div", { className: "actions" }, actions),
    chToggle(c.enabled, props.busy ? null : props.onToggle, (c.enabled ? dshT("\u505C\u7528") : dshT("\u542F\u7528")) + dshT("\u547D\u4EE4 /") + c.name)
  );
}
function ChCommandForm(props) {
  var initial = props.initial;
  var originalName = initial.originalName !== void 0 ? initial.originalName : null;
  var nameHooks = useState(initial.name || "");
  var name = nameHooks[0];
  var setName = nameHooks[1];
  var descHooks = useState(initial.description || "");
  var description = descHooks[0];
  var setDescription = descHooks[1];
  var hintHooks = useState(initial.inputHint || "");
  var inputHint = hintHooks[0];
  var setInputHint = hintHooks[1];
  var promptHooks = useState(initial.prompt || "");
  var prompt = promptHooks[0];
  var setPrompt = promptHooks[1];
  var imagesHooks = useState(initial.images === true);
  var images = imagesHooks[0];
  var setImages = imagesHooks[1];
  var enabledHooks = useState(initial.enabled !== false);
  var enabled = enabledHooks[0];
  var setEnabled = enabledHooks[1];
  return createElement(
    "form",
    { className: "form", onSubmit: function(e) {
      e.preventDefault();
    } },
    createElement(
      "div",
      { className: "grid2" },
      chField(dshT("\u540D\u79F0"), createElement(import_dsh_client_ui_primitives.Input, {
        type: "text",
        value: name,
        placeholder: "my-command",
        onChange: function(e) {
          setName(e.target.value);
        }
      }), dshT("\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\uFF0C\u53EF\u542B\u6570\u5B57\u3001-\u3001_\u3002\u4F1A\u8BDD\u4E2D\u8F93\u5165 /\u540D\u79F0 \u8C03\u7528\u3002")),
      chField(dshT("\u53C2\u6570\u63D0\u793A\uFF08\u53EF\u9009\uFF09"), createElement(import_dsh_client_ui_primitives.Input, {
        type: "text",
        value: inputHint,
        placeholder: dshT("\u4F8B\u5982 <file-path>"),
        onChange: function(e) {
          setInputHint(e.target.value);
        }
      }))
    ),
    chField(dshT("\u63CF\u8FF0"), createElement(import_dsh_client_ui_primitives.Input, {
      type: "text",
      value: description,
      placeholder: dshT("\u8FD9\u4E2A\u547D\u4EE4\u505A\u4EC0\u4E48"),
      onChange: function(e) {
        setDescription(e.target.value);
      }
    })),
    chField(dshT("\u63D0\u793A\u8BCD"), createElement("textarea", {
      className: "input",
      value: prompt,
      placeholder: dshT("# \u89D2\u8272\n\n\u4F60\u8981\u2026\n\n\u5F53\u524D\u8BF7\u6C42\uFF1A$ARGUMENTS"),
      onChange: function(e) {
        setPrompt(e.target.value);
      }
    }), dshT("\u53D1\u9001\u7ED9\u6A21\u578B\u7684\u63D0\u793A\u8BCD\u3002$ARGUMENTS \u4F1A\u66FF\u6362\u4E3A\u7528\u6237\u8F93\u5165\uFF1B\u672A\u4F7F\u7528\u5360\u4F4D\u7B26\u65F6\u8F93\u5165\u4F1A\u8FFD\u52A0\u5728\u672B\u5C3E\u3002")),
    createElement(
      "div",
      { className: "checks" },
      createElement(import_dsh_client_ui_primitives.Checkbox, {
        checked: enabled,
        onChange: function(next) {
          setEnabled(next);
        },
        label: dshT("\u542F\u7528"),
        className: "check"
      }),
      createElement(import_dsh_client_ui_primitives.Checkbox, {
        checked: images,
        onChange: function(next) {
          setImages(next);
        },
        label: dshT("\u63A5\u53D7\u56FE\u7247\u9644\u4EF6"),
        className: "check"
      })
    ),
    props.error ? createElement("div", { className: "error-text" }, props.error) : null,
    createElement(
      "div",
      { className: "form-actions" },
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled: props.busy, onClick: props.onCancel }, dshT("\u53D6\u6D88")),
      createElement(import_dsh_client_ui_primitives.Button, {
        variant: "primary",
        disabled: props.busy,
        onClick: function() {
          props.onSave({
            originalName,
            name,
            description,
            inputHint,
            prompt,
            images,
            enabled
          });
        }
      }, dshT("\u4FDD\u5B58"))
    )
  );
}
function ChCommandsTab(props) {
  var call = props.call;
  var listHooks = useState(null);
  var list = listHooks[0];
  var setList = listHooks[1];
  var busyHooks = useState(false);
  var busy = busyHooks[0];
  var setBusy = busyHooks[1];
  var errorHooks = useState("");
  var error = errorHooks[0];
  var setError = errorHooks[1];
  var noteHooks = useState("");
  var note = noteHooks[0];
  var setNote = noteHooks[1];
  var editingHooks = useState(null);
  var editing = editingHooks[0];
  var setEditing = editingHooks[1];
  var confirmHooks = useState(null);
  var confirming = confirmHooks[0];
  var setConfirming = confirmHooks[1];
  var aliveRef = useRef(true);
  useEffect(function() {
    return function() {
      aliveRef.current = false;
    };
  }, []);
  function load() {
    setBusy(true);
    call("commandHookAdmin/listCommands", {}).then(function(result) {
      setList(unwrap(result));
      setBusy(false);
    }).catch(function(e) {
      setError(messageOf(e));
      setBusy(false);
    });
  }
  useEffect(load, []);
  function act(promise, after) {
    setBusy(true);
    setError("");
    promise.then(function(result) {
      var value = unwrap(result);
      if (after) after(value);
      setList(value);
      setBusy(false);
    }).catch(function(e) {
      setError(messageOf(e));
      setBusy(false);
    });
  }
  var commands = list && list.commands || [];
  var commandsDir = list && list.commandsDir || "";
  var importState = useState(null);
  var importing = importState[0];
  var setImporting = importState[1];
  function exportCommands() {
    try {
      var payload = commands.map(function(c) {
        return { name: c.name, description: c.description, inputHint: c.inputHint, prompt: c.prompt, enabled: c.enabled !== false };
      });
      downloadTextFile("dsh-commands-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".json", JSON.stringify(payload, null, 2));
      setNote(dshT("\u5DF2\u5BFC\u51FA ") + payload.length + dshT(" \u6761\u547D\u4EE4"));
    } catch (e) {
      setNote(dshT("\u5BFC\u51FA\u5931\u8D25\uFF1A") + messageOf(e));
    }
  }
  function runImport(raw) {
    var entries;
    try {
      var parsed = JSON.parse(raw);
      entries = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      setNote(dshT("\u5BFC\u5165\u5931\u8D25\uFF1AJSON \u89E3\u6790\u9519\u8BEF \u2014 ") + messageOf(e));
      return;
    }
    var byName = {};
    for (var i = 0; i < commands.length; i++) byName[commands[i].name] = true;
    var saved = 0;
    var skipped = 0;
    var failed = 0;
    var queue = entries.slice();
    var next = function() {
      if (!aliveRef.current) return;
      if (queue.length === 0) {
        setBusy(false);
        setImporting(null);
        setNote(dshT("\u5BFC\u5165\u5B8C\u6210\uFF1A") + saved + dshT(" \u6761\u65B0\u589E") + (skipped > 0 ? dshT("\uFF0C") + skipped + dshT(" \u6761\u540C\u540D\u8DF3\u8FC7") : "") + (failed > 0 ? dshT("\uFF0C") + failed + dshT(" \u6761\u5931\u8D25") : ""));
        load();
        return;
      }
      var entry = queue.shift();
      var name = entry && typeof entry.name === "string" ? entry.name.trim() : "";
      if (name === "" || typeof entry.prompt !== "string" || entry.prompt === "") {
        failed++;
        next();
        return;
      }
      if (byName[name]) {
        skipped++;
        next();
        return;
      }
      byName[name] = true;
      call("commandHookAdmin/saveCommand", {
        entry: { name, description: typeof entry.description === "string" ? entry.description : "", inputHint: typeof entry.inputHint === "string" ? entry.inputHint : "", prompt: entry.prompt, images: [], enabled: entry.enabled !== false }
      }).then(function(result) {
        if (result && result.ok) saved++;
        else failed++;
        next();
      }, function() {
        failed++;
        next();
      });
    };
    setBusy(true);
    next();
  }
  return createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "10px" } },
    createElement(
      "div",
      { className: "toolbar" },
      createElement("span", { className: "title" }, dshT("\u63D0\u793A\u8BCD\u547D\u4EE4")),
      createElement("span", { className: "count" }, String(commands.length)),
      createElement("span", { className: "spacer" }),
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: busy, onClick: load, "aria-label": dshT("\u5237\u65B0\u547D\u4EE4\u5217\u8868") }, dshT("\u5237\u65B0")),
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: busy || commands.length === 0, title: dshT("\u628A\u5168\u90E8\u547D\u4EE4\u4E0B\u8F7D\u4E3A\u4E00\u4E2A JSON \u6587\u4EF6\uFF08\u53EF\u5206\u4EAB\u3001\u53EF\u518D\u5BFC\u5165\uFF09"), onClick: exportCommands }, dshT("\u2B07 \u5BFC\u51FA")),
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: busy || editing !== null, onClick: function() {
        setImporting(importing === null ? { text: "" } : null);
      } }, dshT("\u2B06 \u5BFC\u5165")),
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: busy || editing !== null, onClick: function() {
        setEditing({});
      } }, dshT("\uFF0B\u65B0\u5EFA\u547D\u4EE4"))
    ),
    createElement("div", { className: "hint" }, dshT("\u5B58\u50A8\u4E8E "), createElement("span", { className: "path-chip" }, commandsDir), dshT(" \xB7 \u4FDD\u5B58\u540E\u7ACB\u5373\u751F\u6548\uFF08\u542B\u5728\u5176\u4ED6\u7A97\u53E3\u624B\u52A8\u6539\u6587\u4EF6\uFF09")),
    importing !== null ? createElement(
      "div",
      { className: "card", key: "import-panel" },
      createElement(
        "div",
        { className: "card-header" },
        createElement("span", { className: "card-title-text" }, dshT("\u2B06 \u5BFC\u5165\u547D\u4EE4\uFF08JSON \u6570\u7EC4\u6216\u5355\u6761\uFF09")),
        createElement(
          "div",
          { className: "card-actions" },
          createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: function() {
            setImporting(null);
          } }, dshT("\u5173\u95ED"))
        )
      ),
      createElement("textarea", {
        className: "input",
        rows: 8,
        placeholder: dshT('[{ "name": "review", "description": "\u4EE3\u7801\u5BA1\u67E5", "prompt": "\u8BF7\u5BA1\u67E5 $ARGUMENTS" }]'),
        value: importing.text,
        onChange: function(e) {
          setImporting({ text: e.target.value });
        }
      }),
      createElement(
        "div",
        { style: { display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" } },
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "primary",
          disabled: busy || importing.text.trim() === "",
          onClick: function() {
            runImport(importing.text);
          }
        }, dshT("\u5BFC\u5165\uFF08\u540C\u540D\u8DF3\u8FC7\uFF09")),
        createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" } }, dshT("\u517C\u5BB9\u300C\u2B07 \u5BFC\u51FA\u300D\u7684\u6587\u4EF6\u5185\u5BB9\uFF1B\u540C\u540D\u547D\u4EE4\u4E00\u5F8B\u8DF3\u8FC7\uFF0C\u7EDD\u4E0D\u9759\u9ED8\u8986\u76D6\u672C\u5730\u4FEE\u6539\u3002"))
      )
    ) : null,
    note ? createElement("div", { className: chNoticeClass(note) }, note) : null,
    error ? createElement("div", { className: "error-text" }, error) : null,
    editing !== null ? createElement(ChCommandForm, {
      initial: editing,
      busy,
      error: "",
      onCancel: function() {
        setEditing(null);
      },
      onSave: function(entry) {
        act(call("commandHookAdmin/saveCommand", { entry }), function() {
          setEditing(null);
          setNote(dshT("\u547D\u4EE4 /") + entry.name + dshT(" \u5DF2\u4FDD\u5B58\u5E76\u6CE8\u518C\u3002"));
        });
      }
    }) : null,
    commands.length === 0 ? createElement("div", { className: "empty" }, dshT("\u8FD8\u6CA1\u6709\u547D\u4EE4\u3002\u70B9\u51FB\u300C\uFF0B\u65B0\u5EFA\u547D\u4EE4\u300D\u521B\u5EFA\u4E00\u4E2A\uFF0C\u4F1A\u8BDD\u91CC\u8F93\u5165 /\u540D\u79F0 \u5373\u53EF\u628A\u63D0\u793A\u8BCD\u53D1\u7ED9\u6A21\u578B\u3002")) : createElement("div", { className: "list" }, commands.map(function(c) {
      return createElement(ChCommandRow, {
        key: c.name,
        command: c,
        busy: busy || editing !== null,
        confirming: confirming === c.name,
        onCancelDelete: function() {
          setConfirming(null);
        },
        onConfirmDelete: function() {
          act(call("commandHookAdmin/deleteCommand", { name: c.name }), function() {
            setConfirming(null);
            setNote(dshT("\u547D\u4EE4 /") + c.name + dshT(" \u5DF2\u5220\u9664\u3002"));
          });
        },
        onDelete: function() {
          setConfirming(c.name);
        },
        onEdit: function() {
          setEditing(Object.assign({ originalName: c.name }, c));
        },
        onToggle: function() {
          act(call("commandHookAdmin/saveCommand", { entry: Object.assign({}, c, { enabled: !c.enabled }) }), function() {
            setNote(dshT("\u547D\u4EE4 /") + c.name + (c.enabled ? dshT(" \u5DF2\u505C\u7528\u3002") : dshT(" \u5DF2\u542F\u7528\u3002")));
          });
        }
      });
    }))
  );
}
function ChHookRow(props) {
  var h = props.hook;
  var actions = props.confirming ? [
    createElement(import_dsh_client_ui_primitives.Button, {
      variant: "outline",
      size: "sm",
      className: "danger",
      key: "yes",
      disabled: props.busy,
      onClick: props.onConfirmDelete
    }, dshT("\u786E\u8BA4\u5220\u9664")),
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "no", disabled: props.busy, onClick: props.onCancelDelete }, dshT("\u53D6\u6D88"))
  ] : [
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "edit", disabled: props.busy, onClick: props.onEdit }, dshT("\u7F16\u8F91")),
    createElement(import_dsh_client_ui_primitives.Button, {
      variant: "outline",
      size: "sm",
      className: "danger",
      key: "del",
      disabled: props.busy,
      "aria-label": dshT("\u5220\u9664\u94A9\u5B50 ") + h.event,
      onClick: props.onDelete
    }, dshT("\u5220\u9664"))
  ];
  return createElement(
    "div",
    { className: "row" + (h.enabled ? "" : " off") },
    createElement("span", { className: "tag event" }, h.event),
    createElement(
      "div",
      { className: "main" },
      createElement(
        "div",
        { className: "meta" },
        (h.matcher === "" ? dshT("\u5339\u914D\u5168\u90E8") : dshT("\u5339\u914D ") + h.matcher) + (h.timeoutSec !== null && h.timeoutSec !== void 0 ? dshT(" \xB7 \u8D85\u65F6 ") + h.timeoutSec + "s" : "")
      ),
      createElement("div", { className: "desc mono" }, h.command)
    ),
    createElement("div", { className: "actions" }, actions),
    chToggle(h.enabled, props.busy ? null : props.onToggle, (h.enabled ? dshT("\u505C\u7528") : dshT("\u542F\u7528")) + dshT("\u94A9\u5B50 ") + h.event)
  );
}
function ChHookForm(props) {
  var initial = props.initial;
  var id = initial.id !== void 0 ? initial.id : null;
  var eventHooks = useState(initial.event || "PreToolUse");
  var event = eventHooks[0];
  var setEvent = eventHooks[1];
  var matcherHooks = useState(initial.matcher || "");
  var matcher = matcherHooks[0];
  var setMatcher = matcherHooks[1];
  var commandHooks = useState(initial.command || "");
  var command = commandHooks[0];
  var setCommand = commandHooks[1];
  var timeoutHooks = useState(initial.timeoutSec !== null && initial.timeoutSec !== void 0 ? String(initial.timeoutSec) : "600");
  var timeoutSec = timeoutHooks[0];
  var setTimeoutSec = timeoutHooks[1];
  var enabledHooks = useState(initial.enabled !== false);
  var enabled = enabledHooks[0];
  var setEnabled = enabledHooks[1];
  return createElement(
    "form",
    { className: "form", onSubmit: function(e) {
      e.preventDefault();
    } },
    createElement(
      "div",
      { className: "grid2" },
      chField(dshT("\u4E8B\u4EF6"), createElement(
        "select",
        { className: "input", value: event, onChange: function(e) {
          setEvent(e.target.value);
        } },
        CH_HOOK_EVENTS.map(function(name) {
          return createElement("option", { key: name, value: name }, name);
        })
      )),
      chField(dshT("\u8D85\u65F6\uFF08\u79D2\uFF09"), createElement(import_dsh_client_ui_primitives.Input, {
        type: "number",
        min: 1,
        value: timeoutSec,
        onChange: function(e) {
          setTimeoutSec(e.target.value);
        }
      }), dshT("\u7559\u7A7A\u6216 600 = \u6865\u9ED8\u8BA4\uFF0810 \u5206\u949F\uFF09\u3002"))
    ),
    chField(dshT("\u5339\u914D\u5668"), createElement(import_dsh_client_ui_primitives.Input, {
      type: "text",
      value: matcher,
      placeholder: CH_MATCHERLESS[event] ? dshT("\uFF08\u6B64\u4E8B\u4EF6\u5FFD\u7565\u5339\u914D\u5668\uFF09") : dshT("write,edit \u6216\u6B63\u5219\uFF1B\u7559\u7A7A\u5339\u914D\u5168\u90E8"),
      disabled: CH_MATCHERLESS[event] === true,
      onChange: function(e) {
        setMatcher(e.target.value);
      }
    }), CH_MATCHERLESS[event] ? dshT("UserPromptSubmit / Stop \u6CA1\u6709\u5339\u914D\u5BF9\u8C61\uFF0C\u6865\u4F1A\u4E22\u5F03\u5339\u914D\u5668\u3002") : dshT("\u4EC5 PreToolUse / PostToolUse \u6709\u5339\u914D\u5BF9\u8C61\uFF08\u5DE5\u5177\u540D\uFF0C\u5C0F\u5199\uFF0C\u5982 write / edit\uFF0C\u5927\u5C0F\u5199\u654F\u611F\uFF09\u3002")),
    chField(dshT("\u547D\u4EE4"), createElement(import_dsh_client_ui_primitives.Input, {
      type: "text",
      className: "mono",
      value: command,
      placeholder: "node C:/path/to/hook.js",
      onChange: function(e) {
        setCommand(e.target.value);
      }
    }), dshT("\u94A9\u5B50\u8F7D\u8377\u4EE5 JSON \u4ECE stdin \u4F20\u5165\uFF1B\u9000\u51FA\u7801 2 \u6216\u8F93\u51FA deny \u963B\u6B62\u52A8\u4F5C\u3002")),
    createElement(import_dsh_client_ui_primitives.Checkbox, {
      checked: enabled,
      onChange: function(next) {
        setEnabled(next);
      },
      label: dshT("\u542F\u7528"),
      className: "check"
    }),
    props.error ? createElement("div", { className: "error-text" }, props.error) : null,
    createElement(
      "div",
      { className: "form-actions" },
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled: props.busy, onClick: props.onCancel }, dshT("\u53D6\u6D88")),
      createElement(import_dsh_client_ui_primitives.Button, {
        variant: "primary",
        disabled: props.busy,
        onClick: function() {
          props.onSave({
            ...id !== null ? { id } : {},
            event,
            matcher,
            command,
            timeoutSec: timeoutSec === "" ? null : timeoutSec,
            enabled
          });
        }
      }, dshT("\u4FDD\u5B58"))
    )
  );
}
function ChHooksTab(props) {
  var call = props.call;
  var dataHooks = useState(null);
  var data = dataHooks[0];
  var setData = dataHooks[1];
  var busyHooks = useState(false);
  var busy = busyHooks[0];
  var setBusy = busyHooks[1];
  var errorHooks = useState("");
  var error = errorHooks[0];
  var setError = errorHooks[1];
  var noteHooks = useState("");
  var note = noteHooks[0];
  var setNote = noteHooks[1];
  var editingHooks = useState(null);
  var editing = editingHooks[0];
  var setEditing = editingHooks[1];
  var confirmHooks = useState(null);
  var confirming = confirmHooks[0];
  var setConfirming = confirmHooks[1];
  function load() {
    setBusy(true);
    call("commandHookAdmin/listHooks", {}).then(function(result) {
      setData(unwrap(result));
      setBusy(false);
    }).catch(function(e) {
      setError(messageOf(e));
      setBusy(false);
    });
  }
  useEffect(load, []);
  function act(promise, after) {
    setBusy(true);
    setError("");
    promise.then(function(result) {
      var value = unwrap(result);
      var noteOverride = after ? after(value) : void 0;
      setData(value);
      var text = chReloadNote(value && value.reload);
      setNote(noteOverride !== void 0 && noteOverride !== null ? noteOverride : text !== null ? text : "");
      setBusy(false);
    }).catch(function(e) {
      setError(messageOf(e));
      setBusy(false);
    });
  }
  var hooks = data && data.hooks || [];
  var bridgeMounted = data !== null && data.bridgeMounted === true;
  var bridgeInstalled = data !== null && data.bridgeInstalled === true;
  var bridgeRowPresent = data !== null && data.bridgeRowPresent === true;
  var bridgePackage = data && data.bridgePackage || "@deepseek-ai/dsh-hooks-claude-code";
  var bridgeMissing = !bridgeInstalled || !bridgeRowPresent;
  var bridgeConfigPath = data !== null && typeof data.bridgeConfigPath === "string" ? data.bridgeConfigPath : null;
  var bridgePathMismatch = bridgeRowPresent && data !== null && data.configPathMatches === false;
  var bridgeText;
  if (bridgePathMismatch) {
    bridgeText = dshT("\u26A0\uFE0F \u6865\u6302\u8F7D\u884C\u7684 configPath \u6307\u5411 ") + (bridgeConfigPath === null ? dshT("\uFF08\u672A\u58F0\u660E\uFF09") : bridgeConfigPath) + dshT("\uFF0C\u4E0E\u672C\u9762\u677F\u7BA1\u7406\u7684 ") + (data && data.hooksPath || "hooks.json") + dshT(" \u4E0D\u4E00\u81F4\u2014\u2014\u5728\u6B64\u4FDD\u5B58\u7684\u94A9\u5B50\u4E0D\u4F1A\u751F\u6548\u3002\u70B9\u300C\u26A1 \u4FEE\u590D\u6865\u6307\u5411\u300D\u628A\u5B83\u6539\u5230\u672C\u9762\u677F\u6587\u4EF6\uFF0C\u6216\u624B\u5DE5\u7F16\u8F91 profile \u7684 cordis.patch.yml\u3002");
  } else if (bridgeMounted) {
    bridgeText = dshT("hooks \u6865\uFF08hooks-claude-code\uFF09\u5DF2\u6302\u8F7D\uFF1A\u4FDD\u5B58 / \u542F\u505C / \u5220\u9664\u540E\u81EA\u52A8\u91CD\u542F\u6865\u4F7F\u914D\u7F6E\u751F\u6548\uFF08\u91CD\u542F\u671F\u95F4\u94A9\u5B50\u6709\u7EA6\u4E00\u79D2\u7684\u7A7A\u7A97\uFF09\u3002");
  } else if (bridgeInstalled && bridgeRowPresent) {
    bridgeText = dshT("hooks \u6865\u5DF2\u5B89\u88C5\u5E76\u5199\u5165 profile\uFF08configPath \u6307\u5411 ") + (data && data.hooksPath || "hooks.json") + dshT("\uFF09\uFF1A\u91CD\u542F dsh \u540E\u6302\u8F7D\u751F\u6548\u3002");
  } else {
    bridgeText = dshT("\u5F53\u524D\u672A\u5B89\u88C5 hooks \u6865\uFF08") + bridgePackage + dshT("\uFF09\uFF1A\u914D\u7F6E\u4F1A\u5199\u5165 ") + (data && data.hooksPath || "hooks.json") + dshT("\uFF0C\u5B89\u88C5\u5E76\u6302\u8F7D\u540E\u624D\u4F1A\u771F\u6B63\u6267\u884C\u3002");
  }
  function runBridgeInstall() {
    act(call("commandHookAdmin/bridgeInstall", {}), function(value) {
      return value && value.bridgeMounted ? dshT("hooks \u6865\u5DF2\u5C31\u7EEA\u3002") : dshT("hooks \u6865\u5DF2\u5B89\u88C5\u5E76\u5199\u5165 profile\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548\u3002");
    });
  }
  function runBridgeRemove() {
    act(call("commandHookAdmin/bridgeRemove", {}), function() {
      return dshT("hooks \u6865\u5DF2\u5378\u8F7D\uFF1Apatch \u884C\u4E0E\u4F9D\u8D56\u5305\u5747\u5DF2\u79FB\u9664\uFF08\u91CD\u542F dsh \u540E\u5B8C\u5168\u751F\u6548\uFF09\u3002");
    });
  }
  var codexInstalled = data !== null && data.codexBridgeInstalled === true;
  var codexRowPresent = data !== null && data.codexBridgeRowPresent === true;
  var codexMounted = data !== null && data.codexBridgeMounted === true;
  var codexPackage = data && data.codexBridgePackage || "@deepseek-ai/dsh-hooks-codex";
  var codexHooksPath = data && data.codexHooksPath || "hooks.codex.json";
  var codexMissing = !codexInstalled || !codexRowPresent;
  var codexText;
  if (codexMounted) {
    codexText = dshT("Codex \u94A9\u5B50\u6865\uFF08hooks-codex\uFF09\u5DF2\u6302\u8F7D\uFF1A\u6D88\u8D39 ") + codexHooksPath + dshT(" \u91CC\u7684 Codex \u683C\u5F0F\u94A9\u5B50\uFF085 \u4E2A\u94A9\u70B9\uFF1ASessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop\uFF09\uFF0C\u4E0E\u4E0A\u9762\u7684 Claude-Code \u683C\u5F0F\u4E92\u4E0D\u5F71\u54CD\u3002\u672C\u9875\u53EA\u505A\u5B89\u88C5 / \u5378\u8F7D \u2014\u2014 \u94A9\u5B50\u5185\u5BB9\u624B\u5DE5\u7F16\u8F91\u8BE5\u6587\u4EF6\u3002");
  } else if (codexInstalled && codexRowPresent) {
    codexText = dshT("Codex \u94A9\u5B50\u6865\u5DF2\u5B89\u88C5\u5E76\u5199\u5165 profile\uFF08\u94A9\u5B50\u6587\u4EF6 ") + codexHooksPath + dshT("\uFF09\uFF1A\u91CD\u542F dsh \u540E\u6302\u8F7D\u751F\u6548\u3002");
  } else {
    codexText = dshT("\u5F53\u524D\u672A\u5B89\u88C5 Codex \u94A9\u5B50\u6865\uFF08") + codexPackage + dshT("\uFF09\uFF1ACodex \u683C\u5F0F\u94A9\u5B50\u5199\u5165 ") + codexHooksPath + dshT("\uFF0C\u5B89\u88C5\u5E76\u6302\u8F7D\u540E\u624D\u4F1A\u6267\u884C\u3002");
  }
  function runCodexBridge(verb) {
    setBusy(true);
    setError("");
    setConfirming(null);
    call("commandHookAdmin/" + verb, {}).then(function(result) {
      var value = unwrap(result);
      if (verb === "codexBridgeInstall") {
        var path = value && typeof value.codexHooksPath === "string" && value.codexHooksPath !== "" ? value.codexHooksPath : codexHooksPath;
        setNote(dshT("Codex \u94A9\u5B50\u6865\u5DF2\u5B89\u88C5\u5E76\u5199\u5165 profile\uFF08\u94A9\u5B50\u6587\u4EF6 ") + path + dshT("\uFF09\uFF0C\u91CD\u542F dsh \u540E\u6302\u8F7D\u751F\u6548\u3002"));
      } else {
        setNote(dshT("Codex \u94A9\u5B50\u6865\u5DF2\u5378\u8F7D\uFF1Apatch \u884C\u4E0E\u4F9D\u8D56\u5305\u5747\u5DF2\u79FB\u9664\uFF08\u91CD\u542F dsh \u540E\u5B8C\u5168\u751F\u6548\uFF09\u3002"));
      }
      load();
    }).catch(function(e) {
      setError((verb === "codexBridgeInstall" ? dshT("\u5B89\u88C5\u5931\u8D25\uFF1A") : dshT("\u5378\u8F7D\u5931\u8D25\uFF1A")) + messageOf(e));
      setBusy(false);
    });
  }
  return createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "10px" } },
    createElement(
      "div",
      { className: "toolbar" },
      createElement("span", { className: "title" }, dshT("\u94A9\u5B50")),
      createElement("span", { className: "count" }, String(hooks.length)),
      createElement("span", { className: "spacer" }),
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: busy, onClick: load, "aria-label": dshT("\u5237\u65B0\u94A9\u5B50\u5217\u8868") }, dshT("\u5237\u65B0")),
      createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: busy || editing !== null, onClick: function() {
        setEditing({});
      } }, dshT("\uFF0B\u65B0\u5EFA\u94A9\u5B50"))
    ),
    createElement(
      "div",
      {
        className: "notice" + (bridgeMounted && !bridgePathMismatch ? "" : " warn")
      },
      createElement("span", { className: "notice-text" }, bridgeText),
      bridgeMissing || bridgePathMismatch ? createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        disabled: busy || editing !== null,
        onClick: runBridgeInstall
      }, busy ? dshT("\u5B89\u88C5\u4E2D\u2026") : bridgePathMismatch ? dshT("\u26A1 \u4FEE\u590D\u6865\u6307\u5411") : dshT("\u26A1 \u5B89\u88C5\u5E76\u6302\u8F7D hooks \u6865")) : null,
      (bridgeInstalled || bridgeRowPresent) && confirming === "__bridge__" ? createElement("span", { className: "notice-actions", key: "confirm" }, [
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          className: "danger",
          key: "yes",
          disabled: busy,
          onClick: runBridgeRemove
        }, dshT("\u786E\u8BA4\u5378\u8F7D")),
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          key: "no",
          disabled: busy,
          onClick: function() {
            setConfirming(null);
          }
        }, dshT("\u53D6\u6D88"))
      ]) : bridgeInstalled || bridgeRowPresent ? createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        className: "danger",
        disabled: busy || editing !== null,
        "aria-label": dshT("\u5378\u8F7D hooks \u6865"),
        onClick: function() {
          setConfirming("__bridge__");
        }
      }, dshT("\u5378\u8F7D\u6865")) : null
    ),
    createElement(
      "div",
      {
        className: "notice" + (codexMounted ? "" : " warn"),
        key: "codex-bridge"
      },
      createElement("span", { className: "notice-text" }, codexText),
      codexMissing ? createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        disabled: busy || editing !== null,
        onClick: function() {
          runCodexBridge("codexBridgeInstall");
        }
      }, busy ? dshT("\u5B89\u88C5\u4E2D\u2026") : dshT("\u{1F4E5} \u5B89\u88C5 Codex \u94A9\u5B50\u6865")) : confirming === "__codex__" ? createElement("span", { className: "notice-actions", key: "codex-confirm" }, [
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          className: "danger",
          key: "yes",
          disabled: busy,
          onClick: function() {
            runCodexBridge("codexBridgeRemove");
          }
        }, dshT("\u786E\u8BA4\u5378\u8F7D")),
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          key: "no",
          disabled: busy,
          onClick: function() {
            setConfirming(null);
          }
        }, dshT("\u53D6\u6D88"))
      ]) : createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        className: "danger",
        disabled: busy || editing !== null,
        "aria-label": dshT("\u5378\u8F7D Codex \u94A9\u5B50\u6865"),
        onClick: function() {
          setConfirming("__codex__");
        }
      }, dshT("\u5378\u8F7D Codex \u6865"))
    ),
    error ? createElement("div", { className: "error-text" }, error) : null,
    note !== "" && error === "" ? createElement("div", { className: chNoticeClass(note) }, note) : null,
    data && data.fileError ? createElement("div", { className: "error-text" }, data.fileError) : null,
    editing !== null ? createElement(ChHookForm, {
      initial: editing,
      busy,
      error: "",
      onCancel: function() {
        setEditing(null);
      },
      onSave: function(entry) {
        act(call("commandHookAdmin/saveHook", { entry }), function() {
          setEditing(null);
        });
      }
    }) : null,
    hooks.length === 0 ? createElement("div", { className: "empty" }, dshT("\u8FD8\u6CA1\u6709\u94A9\u5B50\u3002\u94A9\u5B50\u4F1A\u5728\u7279\u5B9A\u4E8B\u4EF6\uFF08\u5DE5\u5177\u8C03\u7528\u524D\u540E\u3001\u63D0\u4EA4\u63D0\u793A\u8BCD\u3001\u4F1A\u8BDD\u5F00\u59CB/\u7ED3\u675F\u7B49\uFF09\u81EA\u52A8\u6267\u884C\u547D\u4EE4\u3002")) : createElement("div", { className: "list" }, hooks.map(function(h) {
      return createElement(ChHookRow, {
        key: h.id,
        hook: h,
        busy: busy || editing !== null,
        confirming: confirming === h.id,
        onCancelDelete: function() {
          setConfirming(null);
        },
        onConfirmDelete: function() {
          act(call("commandHookAdmin/deleteHook", { id: h.id }), function() {
            setConfirming(null);
          });
        },
        onDelete: function() {
          setConfirming(h.id);
        },
        onEdit: function() {
          setEditing(h);
        },
        onToggle: function() {
          act(call("commandHookAdmin/setHookEnabled", { id: h.id, enabled: !h.enabled }));
        }
      });
    }))
  );
}
function ChCommandsSection(props) {
  return createElement(
    "div",
    { "data-cha-section": "" },
    createElement(ChCommandsTab, { call: props.call, key: "commands" })
  );
}
function ChHooksSection(props) {
  return createElement(
    "div",
    { "data-cha-section": "" },
    createElement(ChHooksTab, { call: props.call, key: "hooks" })
  );
}

// src/client/panels/mcp.js
var MCP_TEST_CACHE_KEY = "dsh-plugin-admin/mcp-test-results";
function mcpTestStorage() {
  return safeLocalStorage();
}
function loadMcpTestCache() {
  var store = mcpTestStorage();
  if (store === null) return {};
  try {
    var raw = store.getItem(MCP_TEST_CACHE_KEY);
    if (raw === null) return {};
    var parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return {};
    var out = (
      /** @type {McpTestState} */
      {}
    );
    for (var id in parsed) {
      var entry = parsed[id];
      if (entry && entry.result && entry.result.ok === true) out[id] = entry;
    }
    return out;
  } catch (e) {
    return {};
  }
}
function saveMcpTestCache(state) {
  var store = mcpTestStorage();
  if (store === null) return;
  try {
    var out = (
      /** @type {McpTestState} */
      {}
    );
    for (var id in state) {
      var s = state[id];
      if (!s || s.busy || s.result === null || s.result === void 0 || s.result.ok !== true) continue;
      out[id] = { result: s.result, at: typeof s.at === "number" ? s.at : Date.now() };
    }
    store.setItem(MCP_TEST_CACHE_KEY, JSON.stringify(out));
  } catch (e) {
  }
}
function clearMcpTestCacheEntry(id) {
  var store = mcpTestStorage();
  if (store === null) return;
  try {
    var state = loadMcpTestCache();
    if (state[id] === void 0) return;
    delete state[id];
    store.setItem(MCP_TEST_CACHE_KEY, JSON.stringify(state));
  } catch (e) {
  }
}
function pruneMcpTestState(map, entries) {
  var valid = (
    /** @type {Record<string, boolean>} */
    {}
  );
  for (var i = 0; i < entries.length; i++) valid[entries[i].id] = true;
  var next = (
    /** @type {McpTestState} */
    {}
  );
  var changed = false;
  for (var id in map) {
    if (valid[id]) next[id] = map[id];
    else changed = true;
  }
  if (changed) saveMcpTestCache(next);
  return next;
}
function formatTestTime(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  var d = new Date(ms);
  var pad = function(n) {
    return (n < 10 ? "0" : "") + String(n);
  };
  var hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  var now = /* @__PURE__ */ new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hm;
  return d.getMonth() + 1 + "-" + d.getDate() + " " + hm;
}
var UPDATE_REMINDER_KEY = "dsh-plugin-admin/update-reminders";
function mergeReminder(entry, partial) {
  var next = (
    /** @type {Record<string, any>} */
    {}
  );
  for (var k in entry) next[k] = entry[k];
  for (var pk in partial) next[pk] = partial[pk];
  return next;
}
function loadUpdateReminders() {
  var store = safeLocalStorage();
  if (store === null) return {};
  try {
    var raw = store.getItem(UPDATE_REMINDER_KEY);
    if (raw === null) return {};
    var parsed = JSON.parse(raw);
    var out = (
      /** @type {Record<string, any>} */
      {}
    );
    if (parsed !== null && typeof parsed === "object") {
      for (var name in parsed) {
        var r = parsed[name];
        if (r && typeof r.latest === "string" && r.latest.length > 0) {
          out[name] = {
            latest: r.latest,
            at: typeof r.at === "number" ? r.at : 0,
            updateAvailable: true,
            error: ""
          };
        }
      }
    }
    return out;
  } catch (e) {
    return {};
  }
}
function saveUpdateReminders(map) {
  var store = safeLocalStorage();
  if (store === null) return;
  try {
    var out = (
      /** @type {Record<string, any>} */
      {}
    );
    for (var name in map) {
      var r = map[name];
      if (r && r.updateAvailable === true && typeof r.latest === "string" && r.latest.length > 0) {
        out[name] = { latest: r.latest, at: typeof r.at === "number" ? r.at : Date.now() };
      }
    }
    store.setItem(UPDATE_REMINDER_KEY, JSON.stringify(out));
  } catch (e) {
  }
}
function mergeUpdateReminders(curMap, list) {
  var liveNames = (
    /** @type {Record<string, boolean>} */
    {}
  );
  for (var a = 0; a < list.length; a++) liveNames[list[a].name] = true;
  var map = (
    /** @type {Record<string, any>} */
    {}
  );
  for (var k in curMap) {
    if (curMap[k] && liveNames[k]) map[k] = curMap[k];
  }
  for (var i = 0; i < list.length; i++) {
    var u = list[i];
    if (u.updateAvailable === true) {
      map[u.name] = { latest: u.latest, updateAvailable: true, error: "", at: Date.now() };
    } else if (u.error) {
      map[u.name] = map[u.name] ? mergeReminder(map[u.name], { error: u.error || "" }) : { latest: "", updateAvailable: false, error: u.error || "", at: Date.now() };
    } else if (u.latest !== null && u.latest !== void 0) {
      delete map[u.name];
    }
  }
  return map;
}
function updateCheckNote(map, checkedCount) {
  var updateCount = 0;
  var checkErrorCount = 0;
  for (var n in map) {
    if (map[n].updateAvailable === true) updateCount++;
    if (map[n].error) checkErrorCount++;
  }
  if (updateCount > 0) return dshT("\u53D1\u73B0 ") + updateCount + dshT(" \u4E2A\u63D2\u4EF6\u6709\u65B0\u7248\u672C");
  if (checkErrorCount > 0) {
    return dshT("\u5DF2\u68C0\u67E5 ") + checkedCount + dshT(" \u4E2A\u63D2\u4EF6\uFF08") + checkErrorCount + dshT(" \u4E2A\u67E5\u8BE2\u5931\u8D25\uFF09") + (checkedCount > checkErrorCount ? dshT("\uFF0C\u5176\u4F59\u5747\u4E3A\u6700\u65B0\u7248\u672C") : "");
  }
  return checkedCount > 0 ? dshT("\u5DF2\u68C0\u67E5 ") + checkedCount + dshT(" \u4E2A\u63D2\u4EF6\uFF0C\u5747\u4E3A\u6700\u65B0\u7248\u672C") : "";
}
function renderMcpPlayground(pg, patch, callRemote) {
  var requiredList = pg.toolRequired && Object.prototype.hasOwnProperty.call(pg.toolRequired, pg.tool) && Array.isArray(pg.toolRequired[pg.tool]) ? pg.toolRequired[pg.tool] : [];
  var resultChildren = [];
  if (pg.busy) {
    resultChildren.push(createElement(
      "div",
      { className: "mcp-test mcp-test-busy", key: "busy" },
      createElement("span", { className: "spinner" }),
      dshT(" \u6B63\u5728\u6267\u884C\u5DE5\u5177\uFF08\u6700\u957F 60 \u79D2\uFF09\u2026")
    ));
  } else if (pg.result !== null && pg.result !== void 0) {
    var tc = pg.result.toolCall;
    if (tc === null || tc === void 0) {
      resultChildren.push(createElement(
        "div",
        { className: "mcp-test mcp-test-fail" },
        "\u274C " + (pg.result.error || dshT("\u6CA1\u6709\u8FD4\u56DE\u7ED3\u679C"))
      ));
    } else {
      resultChildren.push(createElement("div", {
        className: "mcp-test " + (tc.isError ? "mcp-test-fail" : "mcp-test-ok"),
        key: "verdict"
      }, (tc.isError ? dshT("\u26A0\uFE0F \u5DE5\u5177\u62A5\u544A\u9519\u8BEF") : dshT("\u2705 \u6267\u884C\u6210\u529F")) + (tc.truncated ? dshT("\uFF08\u7ED3\u679C\u8FC7\u957F\u5DF2\u622A\u65AD\uFF09") : "")));
      resultChildren.push(createElement("pre", { className: "mcp-playground-out", key: "out" }, tc.text || dshT("\uFF08\u7A7A\u7ED3\u679C\uFF09")));
    }
  } else if (pg.error !== null && pg.error !== void 0) {
    resultChildren.push(createElement("div", { className: "mcp-test mcp-test-fail", key: "err" }, "\u274C " + pg.error));
  }
  return createElement(
    "div",
    { className: "card mcp-playground", key: "mcp-playground" },
    createElement(
      "div",
      { className: "card-header" },
      createElement("span", { className: "card-title-text" }, dshT("\u{1F9EA} \u5DE5\u5177\u8BD5\u8C03\u7528 \xB7 ") + pg.serverName),
      createElement(
        "div",
        { className: "card-actions" },
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          onClick: function() {
            patch({ mcpPlayground: null });
          }
        }, dshT("\u5173\u95ED"))
      )
    ),
    createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "6px" } },
      pg.tools.length > 0 ? createElement("select", {
        className: "input",
        value: pg.tool,
        onChange: function(e) {
          patch({ tool: e.target.value });
        }
      }, pg.tools.map(function(t) {
        return createElement("option", { key: t, value: t }, t);
      })) : createElement("div", { className: "mcp-test-warn" }, dshT("\u5148\u5BF9\u8BE5\u670D\u52A1\u5668\u8DD1\u4E00\u6B21\u300C\u{1F50C} \u6D4B\u8BD5\u300D\u4EE5\u83B7\u53D6\u5DE5\u5177\u5217\u8868\u3002")),
      createElement("textarea", {
        className: "input",
        rows: 5,
        placeholder: dshT("\u5DE5\u5177\u53C2\u6570\uFF08JSON \u5BF9\u8C61\uFF0C\u952E\u540D\u4EE5\u8BE5\u5DE5\u5177\u7684 inputSchema \u4E3A\u51C6\uFF09"),
        value: pg.argsText,
        onChange: function(e) {
          patch({ argsText: e.target.value });
        }
      }),
      requiredList.length > 0 ? createElement(
        "div",
        { className: "mcp-test-warn" },
        dshT("\u5FC5\u586B\u53C2\u6570: ") + requiredList.join(", ") + dshT(' \u2014\u2014 \u4F8B\u5982 { "') + requiredList.join('": \u2026, "') + '": \u2026 }'
      ) : null,
      createElement("div", { className: "mcp-test-warn" }, dshT("\u26A0\uFE0F \u8BD5\u8C03\u7528\u4F1A\u771F\u5B9E\u6267\u884C\u8BE5\u5DE5\u5177\uFF08\u53EF\u80FD\u5199\u6587\u4EF6\u3001\u53D1\u8BF7\u6C42\uFF09\uFF0C\u8BF7\u786E\u8BA4\u53C2\u6570\u540E\u518D\u6267\u884C\u3002")),
      createElement(
        "div",
        { style: { display: "flex", gap: "8px", alignItems: "center" } },
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "primary",
          disabled: pg.busy || pg.tool === "",
          onClick: function() {
            if (typeof callRemote !== "function") return;
            var parsed;
            try {
              parsed = JSON.parse(pg.argsText === "" ? "{ }" : pg.argsText);
            } catch (e) {
              patch({ error: dshT("\u53C2\u6570\u4E0D\u662F\u5408\u6CD5 JSON\uFF1A") + messageOf(e) });
              return;
            }
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
              patch({ error: dshT("\u53C2\u6570\u5FC5\u987B\u662F JSON \u5BF9\u8C61\uFF08\u952E\u503C\u5BF9\uFF09") });
              return;
            }
            patch({ busy: true, result: null, error: null });
            callRemote("mcpAdmin/callTool", { id: pg.entryId, tool: pg.tool, args: parsed }).then(function(result) {
              if (result.ok) patch({ busy: false, result: result.value });
              else patch({ busy: false, error: messageOf(result.error) });
            }, function(failure) {
              patch({ busy: false, error: messageOf(failure) });
            });
          }
        }, pg.busy ? dshT("\u6267\u884C\u4E2D\u2026") : dshT("\u25B6 \u6267\u884C\u5DE5\u5177")),
        resultChildren.length > 0 && !pg.busy ? createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" } }, dshT("\u7ED3\u679C\u89C1\u4E0B\u65B9")) : null
      ),
      createElement("div", null, resultChildren)
    )
  );
}
function McpSection(props) {
  var kit = sectionState({
    mcpEntries: [],
    mcpBusy: false,
    mcpError: "",
    // Save outcome line (green): hot-applied vs saved-pending-restart.
    mcpNote: "",
    mcpEditorOpen: false,
    mcpDraft: null,
    // entryId -> { busy?, result?, error?, at? }; previous successful probes
    // are restored from localStorage so statuses survive panel remounts.
    mcpTestState: loadMcpTestCache(),
    // MCP playground (MCP Inspector posture): one open invocation bench per
    // panel — { entryId, tool, argsText, busy, result, error } or null.
    mcpPlayground: null,
    // Two-step remove: the id whose 移除 button opened the confirm bar.
    // Deleting an entry removes the whole block (secret headers included)
    // from cordis.patch.yml, so it confirms like every other destructive
    // action in this file.
    mcpConfirmRemove: null
  });
  var mView = kit.state;
  var setMView = kit.set;
  var alive = kit.alive;
  useEffect(function() {
    saveMcpTestCache(mView.mcpTestState || {});
  }, [mView.mcpTestState]);
  var testSeq = useRef({});
  function patchMcp(partial) {
    kit.patch(partial);
  }
  function patchDraft(partial) {
    setMView(function(cur) {
      var next = (
        /** @type {Record<string, any>} */
        {}
      );
      for (var k in cur) next[k] = cur[k];
      next.mcpDraft = mergeDraft(cur.mcpDraft, partial);
      return next;
    });
  }
  function patchPlayground(partial) {
    setMView(function(cur) {
      var next = (
        /** @type {Record<string, any>} */
        {}
      );
      for (var k in cur) next[k] = cur[k];
      if (cur.mcpPlayground !== null) {
        var pg = (
          /** @type {Record<string, any>} */
          {}
        );
        for (var pk in cur.mcpPlayground) pg[pk] = cur.mcpPlayground[pk];
        for (var mk in partial) pg[mk] = partial[mk];
        next.mcpPlayground = pg;
      }
      return next;
    });
  }
  var callRemote = props.call;
  function openMcpPlayground(entry) {
    var probe = mView.mcpTestState && mView.mcpTestState[entry.id];
    var tools = probe && probe.result && Array.isArray(probe.result.tools) ? probe.result.tools : [];
    var result = probe && probe.result;
    var toolRequired = result && result.toolRequired !== null && typeof result.toolRequired === "object" ? result.toolRequired : {};
    patchMcp({
      mcpEditorOpen: false,
      mcpPlayground: {
        entryId: entry.id,
        serverName: entry.serverName || entry.id,
        tools,
        toolRequired,
        tool: tools.length > 0 ? tools[0] : "",
        argsText: "{ }",
        busy: false,
        result: null,
        error: tools.length === 0 ? dshT("\u8FD8\u6CA1\u6709\u5DE5\u5177\u5217\u8868 \u2014\u2014 \u5148\u70B9\u300C\u{1F50C} \u6D4B\u8BD5\u300D\u83B7\u53D6\u8BE5\u670D\u52A1\u5668\u63D0\u4F9B\u7684\u5DE5\u5177\uFF0C\u518D\u8BD5\u8C03\u7528\u3002") : null
      }
    });
  }
  function reloadMcp() {
    patchMcp({ mcpBusy: true, mcpError: "" });
    callRemote("mcpAdmin/list", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var entries = result.value && result.value.entries || [];
        setMView(function(cur) {
          var next = (
            /** @type {Record<string, any>} */
            {}
          );
          for (var k in cur) next[k] = cur[k];
          next.mcpBusy = false;
          next.mcpEntries = entries;
          next.mcpTestState = pruneMcpTestState(cur.mcpTestState, entries);
          return next;
        });
      } else {
        patchMcp({ mcpBusy: false, mcpError: dshT("\u52A0\u8F7D MCP \u914D\u7F6E\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(failure) {
      if (!alive.current) return;
      patchMcp({ mcpBusy: false, mcpError: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function openMcpEditor(entry) {
    if (entry !== null && entry !== void 0 && (entry.config === null || entry.config === void 0)) {
      patchMcp({ mcpError: dshT("\u8BE5 MCP \u914D\u7F6E\u65E0\u6CD5\u5B89\u5168\u89E3\u6790\uFF0C\u5DF2\u7981\u6B62\u5728\u6B64\u8986\u76D6\uFF1B\u8BF7\u5728 cordis.patch.yml \u4E2D\u624B\u52A8\u7F16\u8F91\u3002") });
      return;
    }
    var source = entry !== null && entry !== void 0 ? entry.config : null;
    var draft = source ? {
      id: (
        /** @type {McpListEntry} */
        entry.id
      ),
      isNew: false,
      serverName: source.serverName || /** @type {McpListEntry} */
      entry.id,
      transport: source.transport,
      command: source.command || "",
      url: source.url || "",
      args: (source.args || []).join(" "),
      argsOriginal: source.args || [],
      argsChanged: false,
      env: Object.keys(source.env || {}).map(function(key) {
        return key + "=" + source.env[key];
      }).join("\n"),
      envOriginal: source.env || {},
      envChanged: false,
      cwd: source.cwd || "",
      headers: Object.keys(source.headers || {}).map(function(k) {
        return k + "=" + source.headers[k];
      }).join("\n"),
      headersOriginal: source.headers || {},
      headersChanged: false,
      toolCallTimeoutMs: source.toolCallTimeoutMs,
      failOnStartupError: source.failOnStartupError === true,
      reconnectEnabled: source.reconnect ? source.reconnect.enabled === true : false,
      reconnectInitialDelayMs: source.reconnect ? source.reconnect.initialDelayMs : 1e3,
      reconnectMaxDelayMs: source.reconnect ? source.reconnect.maxDelayMs : 3e4,
      reconnectMaxAttempts: source.reconnect ? source.reconnect.maxAttempts : 10
    } : {
      // New server: pre-fill a collision-free id so the user does not have to
      // invent one; they can still edit it or regenerate it.
      id: generateMcpId(mView.mcpEntries),
      isNew: true,
      serverName: "",
      transport: "stdio",
      command: "",
      url: "",
      args: "",
      argsOriginal: [],
      argsChanged: false,
      env: "",
      envOriginal: {},
      envChanged: false,
      cwd: "",
      headers: "",
      headersOriginal: {},
      headersChanged: false,
      toolCallTimeoutMs: void 0,
      failOnStartupError: false,
      reconnectEnabled: false,
      reconnectInitialDelayMs: 1e3,
      reconnectMaxDelayMs: 3e4,
      reconnectMaxAttempts: 10
    };
    patchMcp({ mcpEditorOpen: true, mcpDraft: draft, mcpError: "" });
  }
  function closeMcpEditor() {
    patchMcp({ mcpEditorOpen: false, mcpDraft: null, mcpError: "" });
  }
  function saveMcpDraft() {
    var draft = mView.mcpDraft;
    if (draft === null) return;
    if (draft.isNew) {
      for (var ci = 0; ci < mView.mcpEntries.length; ci++) {
        if (mView.mcpEntries[ci].id === draft.id) {
          patchMcp({ mcpError: "ID '" + draft.id + dshT("' \u5DF2\u88AB\u5176\u4ED6 MCP \u6761\u76EE\u5360\u7528\uFF0C\u8BF7\u6362\u4E00\u4E2A\u518D\u4FDD\u5B58\u3002") });
          return;
        }
      }
    }
    var skippedPairLines = 0;
    var clearedSecretMaps = 0;
    var config;
    if (draft.transport === "streamable-http") {
      config = { transport: "streamable-http", serverName: draft.serverName, url: draft.url };
      var headersStr = Object.keys(draft.headersOriginal || {}).map(function(k) {
        return k + "=" + draft.headersOriginal[k];
      }).join("\n");
      var headers;
      if (draft.headersChanged && draft.headers !== headersStr) {
        headers = {};
        if (draft.headers !== "") {
          var headerPairs = draft.headers.split("\n").map(function(s) {
            return s.trim();
          }).filter(Boolean);
          for (var hi = 0; hi < headerPairs.length; hi++) {
            var hEq = headerPairs[hi].indexOf("=");
            if (hEq > 0) headers[headerPairs[hi].slice(0, hEq).trim()] = headerPairs[hi].slice(hEq + 1).trim();
            else skippedPairLines += 1;
          }
          if (Object.keys(headers).length === 0) headers = draft.headersOriginal;
        } else if (Object.keys(draft.headersOriginal || {}).length > 0) {
          clearedSecretMaps += 1;
        }
      } else {
        headers = draft.headersOriginal;
      }
      if (Object.keys(headers).length > 0) config.headers = headers;
    } else {
      config = { transport: "stdio", serverName: draft.serverName, command: draft.command };
      var argsStr = (draft.argsOriginal || []).join(" ");
      var args = draft.argsChanged && draft.args !== argsStr ? draft.args.split(/\s+/).filter(Boolean) : draft.argsOriginal;
      if (args.length > 0) config.args = args;
      var envStr = Object.keys(draft.envOriginal || {}).map(function(k) {
        return k + "=" + draft.envOriginal[k];
      }).join("\n");
      var env;
      if (draft.envChanged && draft.env !== envStr) {
        env = {};
        if (draft.env !== "") {
          var envPairs = draft.env.split("\n").map(function(s) {
            return s.trim();
          }).filter(Boolean);
          for (var ei = 0; ei < envPairs.length; ei++) {
            var eEq = envPairs[ei].indexOf("=");
            if (eEq > 0) env[envPairs[ei].slice(0, eEq).trim()] = envPairs[ei].slice(eEq + 1).trim();
            else skippedPairLines += 1;
          }
          if (Object.keys(env).length === 0) env = draft.envOriginal;
        } else if (Object.keys(draft.envOriginal || {}).length > 0) {
          clearedSecretMaps += 1;
        }
      } else {
        env = draft.envOriginal;
      }
      if (Object.keys(env).length > 0) config.env = env;
      if (draft.cwd !== "") config.cwd = draft.cwd;
    }
    if (draft.toolCallTimeoutMs !== void 0) config.toolCallTimeoutMs = draft.toolCallTimeoutMs;
    if (draft.failOnStartupError) config.failOnStartupError = true;
    if (draft.reconnectEnabled) {
      config.reconnect = {
        enabled: true,
        initialDelayMs: Number(draft.reconnectInitialDelayMs),
        maxDelayMs: Number(draft.reconnectMaxDelayMs),
        maxAttempts: Number(draft.reconnectMaxAttempts)
      };
    }
    patchMcp({ mcpBusy: true, mcpError: "", mcpNote: "" });
    callRemote("mcpAdmin/upsert", { entry: { id: draft.id, config } }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        clearMcpTestCacheEntry(draft.id);
        patchMcpTest(draft.id, { busy: false, result: null, error: null });
        var value = result.value || {};
        var note = value.hotApplied ? dshT("\u2705 \u5DF2\u4FDD\u5B58\u5E76\u70ED\u5E94\u7528\u81F3\u8FD0\u884C\u4E2D\u7684 server\uFF08\u65E0\u9700\u91CD\u542F\uFF09") : value.hotReason !== void 0 ? dshT("\u2705 \u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548 \u2014 ") + value.hotReason : dshT("\u2705 \u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548");
        if (skippedPairLines > 0) note += dshT("\uFF1B\u8B66\u544A\uFF1A") + skippedPairLines + dshT(" \u884C\u7F3A\u5C11\u300C=\u300D\u5DF2\u5FFD\u7565");
        if (clearedSecretMaps > 0) note += dshT("\uFF1B\u5DF2\u6E05\u7A7A\u5168\u90E8 env/header \u952E\u2014\u2014\u5B58\u50A8\u7684\u65E7\u503C\u5DF2\u968F\u672C\u6B21\u4FDD\u5B58\u5220\u9664\uFF0C\u65E0\u6CD5\u6062\u590D");
        patchMcp({ mcpBusy: false, mcpEntries: value.entries || [], mcpEditorOpen: false, mcpDraft: null, mcpNote: note });
      } else {
        patchMcp({ mcpBusy: false, mcpError: dshT("\u4FDD\u5B58 MCP \u914D\u7F6E\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(failure) {
      if (!alive.current) return;
      patchMcp({ mcpBusy: false, mcpError: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function removeMcpEntry(id) {
    patchMcp({ mcpBusy: true, mcpError: "" });
    callRemote("mcpAdmin/remove", { id }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        clearMcpTestCacheEntry(id);
        patchMcp({ mcpBusy: false, mcpEntries: result.value && result.value.entries || [] });
      } else {
        patchMcp({ mcpBusy: false, mcpError: dshT("\u79FB\u9664 MCP \u914D\u7F6E\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(failure) {
      if (!alive.current) return;
      patchMcp({ mcpBusy: false, mcpError: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function patchMcpTest(id, partial) {
    setMView(function(cur) {
      var nextTestState = mergeTestState(cur.mcpTestState, id, partial);
      var next = (
        /** @type {Record<string, any>} */
        {}
      );
      for (var k in cur) next[k] = cur[k];
      next.mcpTestState = nextTestState;
      return next;
    });
  }
  function testMcpEntry(id) {
    var seq = testSeq.current[id] = (testSeq.current[id] || 0) + 1;
    patchMcpTest(id, { busy: true, result: null, error: null });
    callRemote("mcpAdmin/test", { id }).then(function(result) {
      if (!alive.current || seq !== testSeq.current[id]) return;
      if (result.ok && result.value !== null && typeof result.value === "object") {
        patchMcpTest(id, { busy: false, result: result.value, at: Date.now() });
      } else {
        patchMcpTest(id, { busy: false, result: null, error: messageOf(result.error) });
      }
    }, function(failure) {
      if (!alive.current || seq !== testSeq.current[id]) return;
      patchMcpTest(id, { busy: false, result: null, error: messageOf(failure) });
    });
  }
  kit.mount(reloadMcp);
  return createElement(
    "div",
    { "data-dsh-admin-section": "", className: mView.mcpEditorOpen ? "mcp-editor-open" : "" },
    renderMcpSection(mView, patchMcp, patchDraft, patchPlayground, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry, openMcpPlayground, callRemote)
  );
}
function renderMcpSection(view, patchMcp, patchDraft, patchPlayground, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry, openMcpPlayground, callRemote) {
  var children = [];
  var header = createElement(
    "div",
    { className: "group-header", key: "mcp-header", style: { marginTop: 0 } },
    createElement("span", { className: "group-title", key: "t" }, dshT("\u{1F50C} MCP \u914D\u7F6E")),
    createElement("span", { className: "group-count", key: "c" }, String(view.mcpEntries.length) + dshT(" \u4E2A")),
    createElement(import_dsh_client_ui_primitives.Button, {
      type: "button",
      key: "btn-refresh-mcp",
      variant: "outline",
      disabled: view.mcpBusy,
      onClick: reloadMcp
    }, dshT("\u{1F504} \u5237\u65B0")),
    createElement(import_dsh_client_ui_primitives.Button, {
      type: "button",
      key: "btn-add-mcp",
      variant: "primary",
      disabled: view.mcpBusy,
      onClick: function() {
        openMcpEditor(null);
      }
    }, dshT("\u2795 \u6DFB\u52A0\u670D\u52A1\u5668"))
  );
  children.push(header);
  if (view.mcpError !== "") {
    children.push(createElement("div", { className: "error", key: "mcp-error" }, view.mcpError));
  }
  if (view.mcpNote !== "") {
    children.push(createElement("div", { className: "note-ok", key: "mcp-note" }, view.mcpNote));
  }
  var rows = [];
  for (var i = 0; i < view.mcpEntries.length; i++) {
    var entry = view.mcpEntries[i];
    var tag = createElement(
      "span",
      { className: "tag plugin", key: "mcp-tag-" + entry.id },
      "MCP " + String(entry.serverName || entry.id)
    );
    var testState = view.mcpTestState && view.mcpTestState[entry.id] || null;
    var testIndicator = null;
    if (testState !== null && testState.busy) {
      testIndicator = createElement(
        "span",
        { className: "mcp-test mcp-test-busy", key: "test-busy" },
        createElement("span", { className: "spinner", key: "sp" }),
        dshT(" \u68C0\u6D4B\u4E2D...")
      );
    } else if (testState !== null && testState.result !== null && testState.result !== void 0) {
      var r = testState.result;
      var ok = r.ok === true;
      var label = ok ? dshT("\u2705 \u8FDE\u901A") : dshT("\u274C \u4E0D\u901A");
      var detail = ok ? (r.serverInfo ? (r.serverInfo.name || "") + (r.serverInfo.version ? " v" + r.serverInfo.version : "") : "") + (typeof r.toolCount === "number" ? " \xB7 " + r.toolCount + dshT(" \u4E2A\u5DE5\u5177") : "") + (r.pingOk === false ? dshT(" \xB7 \u521D\u59CB\u5316\u6210\u529F\u4F46 ping \u5931\u8D25") : "") : (r.error || dshT("\u8FDE\u63A5\u5931\u8D25")) + (r.ms !== void 0 ? " (" + r.ms + "ms)" : "");
      var detailChildren = [
        createElement("span", { key: "lbl" }, label + (detail !== "" ? " " + detail : ""))
      ];
      if (ok && Array.isArray(r.tools) && r.tools.length > 0) {
        detailChildren.push(createElement(
          "span",
          { key: "tools-hint", style: { color: "var(--dsw-alias-label-secondary, #61666b)" } },
          dshT("\u5DE5\u5177\uFF1A") + r.tools.join(dshT("\u3001"))
        ));
      }
      if (r.warning) {
        detailChildren.push(createElement(
          "span",
          { key: "warn", className: "mcp-test-warn", title: r.warning },
          "\u26A0\uFE0F " + r.warning
        ));
      }
      if (typeof testState.at === "number") {
        detailChildren.push(createElement("span", {
          key: "cached-at",
          className: "mcp-test-cached",
          title: dshT("\u4E0A\u6B21\u68C0\u6D4B\u7ED3\u679C\uFF08\u672C\u5730\u7F13\u5B58\uFF09\u3002\u70B9\u51FB\u300C\u{1F50C} \u6D4B\u8BD5\u300D\u53EF\u91CD\u65B0\u68C0\u6D4B\u3002")
        }, dshT("\xB7 \u7F13\u5B58\u4E8E ") + formatTestTime(testState.at)));
      }
      testIndicator = createElement("div", {
        className: "mcp-test mcp-test-list " + (ok ? "mcp-test-ok" : "mcp-test-fail"),
        key: "test-result",
        title: detail
      }, detailChildren);
    } else if (testState !== null && testState.error !== null && testState.error !== void 0) {
      testIndicator = createElement("span", {
        className: "mcp-test mcp-test-fail",
        key: "test-error",
        title: testState.error
      }, "\u274C " + testState.error);
    }
    var rowChildren = [
      createElement(
        "div",
        { className: "card-header", key: "h" },
        createElement("span", { className: "card-title-text", key: "name" }, entry.id),
        tag,
        createElement(
          "div",
          { className: "card-actions", key: "a" },
          createElement(import_dsh_client_ui_primitives.Button, {
            type: "button",
            variant: "outline",
            size: "sm",
            disabled: view.mcpBusy || testState !== null && testState.busy || entry.config === null || entry.config === void 0,
            title: entry.config === null || entry.config === void 0 ? dshT("\u8BE5\u914D\u7F6E\u65E0\u6CD5\u5B89\u5168\u89E3\u6790\uFF0C\u8BF7\u624B\u52A8\u7F16\u8F91 cordis.patch.yml") : testState !== null && testState.busy ? dshT("\u68C0\u6D4B\u4E2D...") : testState !== null && typeof testState.at === "number" ? dshT("\u91CD\u65B0\u68C0\u6D4B\u8BE5\u670D\u52A1\u5668\u7684\u8FDE\u901A\u6027\uFF08\u5F53\u524D\u663E\u793A\u7684\u662F\u7F13\u5B58\u7ED3\u679C\uFF09") : dshT("\u6D4B\u8BD5\u8BE5\u670D\u52A1\u5668\u7684\u8FDE\u901A\u6027"),
            onClick: /* @__PURE__ */ (function(id) {
              return function() {
                testMcpEntry(id);
              };
            })(entry.id)
          }, testState !== null && testState.busy ? dshT("\u68C0\u6D4B\u4E2D") : dshT("\u{1F50C} \u6D4B\u8BD5")),
          createElement(import_dsh_client_ui_primitives.Button, {
            type: "button",
            variant: "outline",
            size: "sm",
            key: "btn-playground",
            disabled: view.mcpBusy || testState !== null && testState.busy || entry.config === null || entry.config === void 0,
            title: dshT("\u8BD5\u8C03\u7528\u8BE5\u670D\u52A1\u5668\u7684\u5DE5\u5177\uFF08\u4F1A\u771F\u5B9E\u6267\u884C\uFF0C\u5148\u300C\u{1F50C} \u6D4B\u8BD5\u300D\u83B7\u53D6\u5DE5\u5177\u5217\u8868\uFF09"),
            onClick: /* @__PURE__ */ (function(value) {
              return function() {
                openMcpPlayground(value);
              };
            })(entry)
          }, dshT("\u{1F9EA} \u8BD5\u8C03\u7528")),
          createElement(import_dsh_client_ui_primitives.Button, {
            type: "button",
            variant: "outline",
            size: "sm",
            disabled: view.mcpBusy || testState !== null && testState.busy || entry.config === null || entry.config === void 0,
            title: entry.config === null || entry.config === void 0 ? dshT("\u8BE5\u914D\u7F6E\u65E0\u6CD5\u5B89\u5168\u89E3\u6790\uFF0C\u8BF7\u624B\u52A8\u7F16\u8F91 cordis.patch.yml") : void 0,
            onClick: /* @__PURE__ */ (function(value) {
              return function() {
                openMcpEditor(value);
              };
            })(entry)
          }, dshT("\u7F16\u8F91")),
          createElement(import_dsh_client_ui_primitives.Button, {
            type: "button",
            variant: "outline",
            size: "sm",
            className: "danger",
            disabled: view.mcpBusy,
            // Opens the confirm bar below instead of deleting: 移除 drops the
            // whole block (secret-bearing headers included) from
            // cordis.patch.yml, so it takes the same second click every other
            // destructive action in this panel does.
            onClick: /* @__PURE__ */ (function(id) {
              return function() {
                patchMcp({ mcpConfirmRemove: id });
              };
            })(entry.id)
          }, dshT("\u79FB\u9664"))
        )
      )
    ];
    if (testIndicator !== null) {
      rowChildren.push(createElement("div", { className: "mcp-test-row", key: "test-row" }, testIndicator));
    }
    if (view.mcpConfirmRemove === entry.id) {
      rowChildren.push(createElement(
        "div",
        { className: "confirm-bar", key: "confirm-remove" },
        createElement(
          "span",
          { className: "confirm-text", key: "text" },
          dshT("\u26A0\uFE0F \u786E\u5B9A\u4ECE cordis.patch.yml \u79FB\u9664\u8BE5 MCP \u670D\u52A1\u5668\u914D\u7F6E\uFF1F\u6574\u5757\u914D\u7F6E\uFF08\u542B headers \u4E2D\u7684\u5BC6\u94A5\u884C\uFF09\u4F1A\u88AB\u5220\u9664\u3002")
        ),
        createElement(
          "div",
          { className: "confirm-actions", key: "actions" },
          createElement(import_dsh_client_ui_primitives.Button, {
            type: "button",
            key: "btn-confirm-remove",
            variant: "outline",
            size: "sm",
            className: "danger-solid",
            disabled: view.mcpBusy,
            onClick: /* @__PURE__ */ (function(id) {
              return function() {
                patchMcp({ mcpConfirmRemove: null });
                removeMcpEntry(id);
              };
            })(entry.id)
          }, dshT("\u786E\u8BA4\u79FB\u9664")),
          createElement(import_dsh_client_ui_primitives.Button, {
            type: "button",
            key: "btn-cancel-remove",
            variant: "outline",
            size: "sm",
            disabled: view.mcpBusy,
            onClick: function() {
              patchMcp({ mcpConfirmRemove: null });
            }
          }, dshT("\u53D6\u6D88"))
        )
      ));
    }
    rows.push(createElement("div", { className: "card", key: "mcp-" + entry.id }, rowChildren));
  }
  if (rows.length === 0 && !view.mcpEditorOpen) {
    rows.push(createElement(
      "div",
      { className: "empty", key: "mcp-empty" },
      createElement("div", null, dshT("\u{1F50C} \u6682\u65E0 MCP \u670D\u52A1\u5668\u914D\u7F6E"))
    ));
  }
  children.push(createElement("div", { className: "list", key: "mcp-list" }, rows));
  if (view.mcpEditorOpen && view.mcpDraft !== null) {
    var d = view.mcpDraft;
    var fieldStyle = { display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" };
    var labelStyle = { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #666)" };
    var secretHintStyle = { fontSize: "10px", lineHeight: "1.45", color: "var(--dsw-alias-label-tertiary, #999)" };
    var editor = createElement(
      "div",
      { className: "card mcp-editor", key: "mcp-editor" },
      createElement(
        "div",
        { className: "card-header", key: "h" },
        createElement("span", { className: "card-title-text", key: "t" }, d.isNew ? dshT("\u6DFB\u52A0 MCP \u670D\u52A1\u5668") : dshT("\u7F16\u8F91 ") + d.id)
      ),
      createElement(
        "div",
        { style: fieldStyle, key: "f-id" },
        createElement("label", { style: labelStyle }, dshT("ID\uFF08\u552F\u4E00\u6807\u8BC6\uFF0C[A-Za-z0-9_-]\uFF09")),
        createElement(
          "div",
          { style: { display: "flex", gap: "6px" } },
          createElement(import_dsh_client_ui_primitives.Input, {
            value: d.id,
            "aria-label": dshT("ID\uFF08\u552F\u4E00\u6807\u8BC6\uFF0C[A-Za-z0-9_-]\uFF09"),
            disabled: !d.isNew,
            onChange: function(e) {
              patchDraft({ id: e.target.value });
            }
          }),
          d.isNew ? createElement(import_dsh_client_ui_primitives.Button, {
            type: "button",
            variant: "outline",
            size: "sm",
            title: dshT("\u91CD\u65B0\u751F\u6210\u4E00\u4E2A\u968F\u673A ID"),
            onClick: function() {
              patchDraft({ id: generateMcpId(view.mcpEntries) });
            }
          }, "\u{1F3B2}") : null
        )
      ),
      createElement(
        "div",
        { style: fieldStyle, key: "f-server" },
        createElement("label", { style: labelStyle }, dshT("serverName\uFF08\u6A21\u578B\u547D\u540D\u7A7A\u95F4\uFF09")),
        createElement(import_dsh_client_ui_primitives.Input, {
          value: d.serverName,
          "aria-label": dshT("serverName\uFF08\u6A21\u578B\u547D\u540D\u7A7A\u95F4\uFF09"),
          onChange: function(e) {
            patchDraft({ serverName: e.target.value });
          }
        })
      ),
      createElement(
        "div",
        { style: fieldStyle, key: "f-transport" },
        createElement("label", { style: labelStyle }, dshT("\u4F20\u8F93\u65B9\u5F0F")),
        createElement(
          "select",
          {
            className: "input",
            value: d.transport,
            "aria-label": dshT("\u4F20\u8F93\u65B9\u5F0F"),
            onChange: function(e) {
              patchDraft({ transport: e.target.value });
            }
          },
          createElement("option", { value: "stdio" }, dshT("stdio\uFF08\u5B50\u8FDB\u7A0B\uFF09")),
          createElement("option", { value: "streamable-http" }, dshT("streamable-http\uFF08HTTP\uFF09"))
        )
      ),
      d.transport === "stdio" ? createElement(
        "div",
        { style: fieldStyle, key: "f-cmd" },
        createElement("label", { style: labelStyle }, dshT("command\uFF08\u542F\u52A8\u547D\u4EE4\uFF09")),
        createElement(import_dsh_client_ui_primitives.Input, {
          value: d.command,
          "aria-label": dshT("command\uFF08\u542F\u52A8\u547D\u4EE4\uFF09"),
          placeholder: "npx -y @modelcontextprotocol/server-github",
          onChange: function(e) {
            patchDraft({ command: e.target.value });
          }
        })
      ) : createElement(
        "div",
        { style: fieldStyle, key: "f-url" },
        createElement("label", { style: labelStyle }, dshT("url\uFF08MCP \u7AEF\u70B9\uFF09")),
        createElement(import_dsh_client_ui_primitives.Input, {
          value: d.url,
          "aria-label": dshT("url\uFF08MCP \u7AEF\u70B9\uFF09"),
          placeholder: "http://localhost:3000/mcp",
          onChange: function(e) {
            patchDraft({ url: e.target.value });
          }
        })
      ),
      d.transport === "streamable-http" ? createElement(
        "div",
        { style: fieldStyle, key: "f-headers" },
        createElement("label", { style: labelStyle }, dshT("headers\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u53EF\u9009\uFF09")),
        createElement("textarea", {
          className: "input",
          style: { minHeight: "48px" },
          value: d.headers,
          "aria-label": dshT("headers\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u53EF\u9009\uFF09"),
          onChange: function(e) {
            patchDraft({ headers: e.target.value, headersChanged: true });
          }
        }),
        createElement("div", { style: secretHintStyle }, dshT("\u5DF2\u5B58\u7684 header \u53EA\u56DE\u952E\u540D\uFF08\u503C\u4E0D\u56DE\u4F20\u6D4F\u89C8\u5668\uFF09\uFF1A\u7559\u7A7A\u5373\u6CBF\u7528\u5DF2\u5B58\u7684\u503C\uFF0C\u5220\u6389\u6574\u884C\u624D\u4F1A\u79FB\u9664\u8BE5\u952E\u3002"))
      ) : null,
      d.transport === "stdio" ? createElement(
        "div",
        { style: fieldStyle, key: "f-args" },
        createElement("label", { style: labelStyle }, dshT("args\uFF08\u7A7A\u683C\u5206\u9694\uFF0C\u53EF\u9009\uFF09")),
        createElement(import_dsh_client_ui_primitives.Input, {
          value: d.args,
          "aria-label": dshT("args\uFF08\u7A7A\u683C\u5206\u9694\uFF0C\u53EF\u9009\uFF09"),
          onChange: function(e) {
            patchDraft({ args: e.target.value, argsChanged: true });
          }
        })
      ) : null,
      d.transport === "stdio" ? createElement(
        "div",
        { style: fieldStyle, key: "f-env" },
        createElement("label", { style: labelStyle }, dshT("env\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u53EF\u9009\uFF09")),
        createElement("textarea", {
          className: "input",
          style: { minHeight: "48px" },
          value: d.env,
          "aria-label": dshT("env\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u53EF\u9009\uFF09"),
          onChange: function(e) {
            patchDraft({ env: e.target.value, envChanged: true });
          }
        }),
        createElement("div", { style: secretHintStyle }, dshT("\u5DF2\u5B58\u7684\u73AF\u5883\u53D8\u91CF\u53EA\u56DE\u952E\u540D\uFF08\u503C\u4E0D\u56DE\u4F20\u6D4F\u89C8\u5668\uFF09\uFF1A\u7559\u7A7A\u5373\u6CBF\u7528\u5DF2\u5B58\u7684\u503C\uFF0C\u5220\u6389\u6574\u884C\u624D\u4F1A\u79FB\u9664\u8BE5\u53D8\u91CF\u3002"))
      ) : null,
      createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", marginBottom: "4px", borderTop: "1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.3))", paddingTop: "8px" }, key: "f-reconnect-header" },
        createElement(import_dsh_client_ui_primitives.Checkbox, {
          checked: d.reconnectEnabled,
          onChange: function(next) {
            patchDraft({ reconnectEnabled: next });
          },
          label: dshT("\u542F\u7528\u81EA\u52A8\u91CD\u8FDE")
        })
      ),
      d.reconnectEnabled ? createElement(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px", paddingLeft: "4px" }, key: "f-reconnect-fields" },
        createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "2px", flex: "1 1 120px" }, key: "f-reconnect-id" },
          createElement("label", { style: { fontSize: "10px", color: "var(--dsw-alias-label-secondary, #666)" } }, "initialDelayMs"),
          createElement(import_dsh_client_ui_primitives.Input, {
            type: "number",
            min: 0,
            value: d.reconnectInitialDelayMs,
            "aria-label": "initialDelayMs",
            onChange: function(e) {
              patchDraft({ reconnectInitialDelayMs: Number(e.target.value) });
            }
          })
        ),
        createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "2px", flex: "1 1 120px" }, key: "f-reconnect-md" },
          createElement("label", { style: { fontSize: "10px", color: "var(--dsw-alias-label-secondary, #666)" } }, "maxDelayMs"),
          createElement(import_dsh_client_ui_primitives.Input, {
            type: "number",
            min: 0,
            value: d.reconnectMaxDelayMs,
            "aria-label": "maxDelayMs",
            onChange: function(e) {
              patchDraft({ reconnectMaxDelayMs: Number(e.target.value) });
            }
          })
        ),
        createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "2px", flex: "1 1 120px" }, key: "f-reconnect-ma" },
          createElement("label", { style: { fontSize: "10px", color: "var(--dsw-alias-label-secondary, #666)" } }, "maxAttempts"),
          createElement(import_dsh_client_ui_primitives.Input, {
            type: "number",
            min: 0,
            value: d.reconnectMaxAttempts,
            "aria-label": "maxAttempts",
            onChange: function(e) {
              patchDraft({ reconnectMaxAttempts: Number(e.target.value) });
            }
          })
        )
      ) : null,
      createElement(
        "div",
        { className: "card-actions", key: "f-actions", style: { justifyContent: "flex-end", gap: "6px" } },
        createElement(import_dsh_client_ui_primitives.Button, {
          type: "button",
          variant: "outline",
          disabled: view.mcpBusy,
          onClick: closeMcpEditor
        }, dshT("\u53D6\u6D88")),
        createElement(import_dsh_client_ui_primitives.Button, {
          type: "button",
          variant: "primary",
          disabled: view.mcpBusy || d.id.trim() === "" || d.serverName.trim() === "" || (d.transport === "stdio" ? d.command.trim() === "" : d.url.trim() === ""),
          onClick: saveMcpDraft
        }, view.mcpBusy ? dshT("\u4FDD\u5B58\u4E2D...") : dshT("\u4FDD\u5B58"))
      )
    );
    children.push(editor);
  }
  if (view.mcpPlayground !== null && !view.mcpEditorOpen) {
    children.push(renderMcpPlayground(view.mcpPlayground, patchPlayground, callRemote));
  }
  return createElement("div", { key: "mcp-section", style: { display: "flex", flexDirection: "column", gap: "10px" } }, children);
}
var MCP_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function generateMcpId(entries) {
  var taken = (
    /** @type {Record<string, boolean>} */
    {}
  );
  for (var i = 0; i < entries.length; i++) taken[entries[i].id] = true;
  var candidate;
  do {
    candidate = "mcp-";
    for (var j = 0; j < 8; j++) {
      candidate += MCP_ID_ALPHABET.charAt(Math.floor(Math.random() * MCP_ID_ALPHABET.length));
    }
  } while (taken[candidate]);
  return candidate;
}
function mergeDraft(draft, partial) {
  var next = (
    /** @type {Record<string, any>} */
    {}
  );
  for (var k in draft) next[k] = draft[k];
  for (var pk in partial) next[pk] = partial[pk];
  return next;
}
function mergeTestState(map, id, partial) {
  var next = (
    /** @type {Record<string, any>} */
    {}
  );
  for (var k in map) next[k] = map[k];
  next[id] = {};
  var cur = map[id] || {};
  for (var ck in cur) next[id][ck] = cur[ck];
  for (var pk in partial) next[id][pk] = partial[pk];
  return next;
}

// src/client/panels/plugins.js
function PluginsSection(props) {
  var kit = sectionState(function() {
    return {
      profileDir: "",
      plugins: [],
      busy: false,
      error: "",
      spec: "",
      confirming: null,
      note: "",
      output: "",
      filter: "all",
      needle: "",
      checkingUpdates: false,
      updateChecked: false,
      // true once a check finished (even if no updates)
      // Seed from persisted reminders so the ⬆ 有新版本 badge is visible the
      // moment the panel mounts (before the fresh host check resolves) — the
      // reminder is only dropped once a check confirms the upgrade completed.
      updates: loadUpdateReminders(),
      // name -> { latest, updateAvailable, error?, at? }
      bulkUpdate: null
      // { done, total, failed: { name, reason }[] } — batch upgrade progress
    };
  });
  var pView = kit.state;
  var setPView = kit.set;
  var alive = kit.alive;
  var checkingRef = useRef(false);
  var busyRef = useRef(false);
  var bulkNoteRef = useRef("");
  function patchPlugin(partial) {
    kit.patch(partial);
  }
  var callRemote = props.call;
  function reloadPlugins(keepFeedback) {
    if (!keepFeedback) patchPlugin({ busy: true, error: "", note: "" });
    callRemote("pluginAdmin/list", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var next = (
          /** @type {Record<string, any>} */
          {
            profileDir: result.value && result.value.profileDir || "",
            plugins: result.value && result.value.plugins || []
          }
        );
        if (!keepFeedback) next.busy = false;
        patchPlugin(next);
      } else if (!keepFeedback) {
        patchPlugin({ busy: false, error: dshT("\u52A0\u8F7D\u63D2\u4EF6\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(failure) {
      if (!alive.current) return;
      if (!keepFeedback) patchPlugin({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function checkUpdates(force) {
    if (checkingRef.current) return;
    checkingRef.current = true;
    patchPlugin({ checkingUpdates: true, note: "" });
    callRemote("pluginAdmin/checkUpdates", { force: force === true }).then(function(result) {
      checkingRef.current = false;
      if (!alive.current) return;
      if (!result.ok) {
        patchPlugin({ checkingUpdates: false, error: dshT("\u68C0\u67E5\u66F4\u65B0\u5931\u8D25\uFF1A") + messageOf(result.error) });
        return;
      }
      var list = result.value && result.value.updates || [];
      setPView(function(cur) {
        var next = (
          /** @type {Record<string, any>} */
          {}
        );
        for (var k in cur) next[k] = cur[k];
        next.checkingUpdates = false;
        next.updates = mergeUpdateReminders(cur.updates || {}, list);
        next.updateChecked = true;
        if (bulkNoteRef.current !== "") {
          next.note = bulkNoteRef.current;
          bulkNoteRef.current = "";
        } else {
          next.note = updateCheckNote(next.updates, list.length);
        }
        return next;
      });
    }, function(failure) {
      checkingRef.current = false;
      if (!alive.current) return;
      var pendingBulkNote = bulkNoteRef.current;
      bulkNoteRef.current = "";
      var failurePatch = { checkingUpdates: false, error: dshT("\u68C0\u67E5\u66F4\u65B0\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) };
      if (pendingBulkNote !== "") failurePatch.note = pendingBulkNote;
      patchPlugin(failurePatch);
    });
  }
  function upgradeAllPlugins() {
    if (busyRef.current || pView.bulkUpdate !== null) return;
    var targets = (
      /** @type {Array<PluginUpgradeTarget>} */
      []
    );
    for (var name in pView.updates) {
      var info = pView.updates[name];
      if (info && info.updateAvailable && info.latest) targets.push({ name, latest: info.latest });
    }
    if (targets.length === 0) return;
    busyRef.current = true;
    patchPlugin({ busy: true, error: "", confirming: null, note: "", bulkUpdate: { done: 0, total: targets.length, failed: [] } });
    var index = 0;
    var failedTotal = 0;
    var failures = (
      /** @type {Array<PluginFailureRow>} */
      []
    );
    var compatTotal = 0;
    var runNext = function() {
      if (!alive.current) return;
      if (index >= targets.length) {
        busyRef.current = false;
        setPView(function(cur) {
          var next = (
            /** @type {Record<string, any>} */
            {}
          );
          for (var k in cur) next[k] = cur[k];
          next.busy = false;
          next.bulkUpdate = null;
          return next;
        });
        checkUpdates(true);
        reloadPlugins(true);
        bulkNoteRef.current = dshT("\u2705 \u6279\u91CF\u66F4\u65B0\u5B8C\u6210\uFF1A") + (targets.length - failedTotal) + dshT(" \u4E2A\u5DF2\u66F4\u65B0") + (failedTotal > 0 ? dshT("\uFF0C") + failedTotal + dshT(" \u4E2A\u5931\u8D25\uFF1A") + failures.map(function(row) {
          return row.name + dshT("\uFF08") + String(row.reason).split("\n")[0].slice(0, 120) + dshT("\uFF09");
        }).join(dshT("\uFF1B")) : "") + (compatTotal > 0 ? dshT("\uFF0C") + compatTotal + dshT(" \u4E2A\u4E0E\u5F53\u524D dsh \u4E0D\u517C\u5BB9\uFF08\u91CD\u542F\u5C06\u88AB\u8DF3\u8FC7\uFF09") : "") + dshT("\u3002\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548");
        return;
      }
      var target = targets[index];
      callRemote("pluginAdmin/install", { spec: target.name + "@" + target.latest }).then(function(result) {
        if (!alive.current) return;
        index++;
        if (!result.ok) {
          failedTotal++;
          var reason = messageOf(result.error);
          failures.push({ name: target.name, reason });
        }
        var compat = result.value && result.value.compat;
        if (result.ok && compat && compat.checked === true && compat.ok === false) compatTotal++;
        setPView(function(cur) {
          var next = (
            /** @type {Record<string, any>} */
            {}
          );
          for (var k in cur) next[k] = cur[k];
          var failed = cur.bulkUpdate !== null ? cur.bulkUpdate.failed : [];
          next.bulkUpdate = { done: index, total: targets.length, failed: result.ok ? failed : failed.concat([{ name: target.name, reason }]) };
          if (result.ok) {
            next.plugins = result.value && result.value.plugins || cur.plugins;
            var remaining = (
              /** @type {PluginUpdateMap} */
              {}
            );
            for (var rk in cur.updates) {
              if (rk !== target.name) remaining[rk] = cur.updates[rk];
            }
            next.updates = remaining;
          }
          return next;
        });
        runNext();
      }, function(failure) {
        if (!alive.current) return;
        index++;
        failedTotal++;
        var reason = messageOf(failure);
        failures.push({ name: target.name, reason });
        setPView(function(cur) {
          var next = (
            /** @type {Record<string, any>} */
            {}
          );
          for (var k in cur) next[k] = cur[k];
          var failed = cur.bulkUpdate !== null ? cur.bulkUpdate.failed : [];
          next.bulkUpdate = { done: index, total: targets.length, failed: failed.concat([{ name: target.name, reason }]) };
          return next;
        });
        runNext();
      });
    };
    runNext();
  }
  function upgradePlugin(name) {
    if (busyRef.current) return;
    busyRef.current = true;
    var known = pView.updates && pView.updates[name];
    var spec = known && known.latest ? name + "@" + known.latest : name + "@latest";
    patchPlugin({ busy: true, error: "", confirming: null, note: "" });
    callRemote("pluginAdmin/install", { spec }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        busyRef.current = false;
        setPView(function(cur) {
          var next = (
            /** @type {Record<string, any>} */
            {}
          );
          for (var k in cur) next[k] = cur[k];
          next.busy = false;
          next.note = dshT("\u5DF2\u66F4\u65B0 ") + name + dshT("\u3002\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548") + compatWarningText(result.value && result.value.compat);
          next.output = result.value && result.value.output || "";
          next.profileDir = result.value && result.value.profileDir || "";
          next.plugins = result.value && result.value.plugins || [];
          var remaining = (
            /** @type {PluginUpdateMap} */
            {}
          );
          for (var rk in cur.updates) {
            if (rk !== name) remaining[rk] = cur.updates[rk];
          }
          next.updates = remaining;
          return next;
        });
        checkUpdates(true);
        return;
      }
      var failMessage = dshT("\u66F4\u65B0\u5931\u8D25\uFF1A") + messageOf(result.error);
      busyRef.current = false;
      patchPlugin({ busy: false, error: failMessage });
      showToast("error", failMessage);
      reloadPlugins(true);
    }, function(failure) {
      if (!alive.current) return;
      busyRef.current = false;
      patchPlugin({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function compatWarningText(compat) {
    if (!compat || compat.checked !== true || compat.ok !== false) return "";
    var rows = Array.isArray(compat.rows) ? compat.rows : [];
    var parts = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      parts.push((row.name || "?") + (row.version ? "@" + row.version : "") + dshT(" \u4E0E\u5F53\u524D dsh ") + compat.runtimeVersion + dshT(" \u4E0D\u517C\u5BB9\uFF1A") + JSON.stringify(row.incompatible || row.peers || {}));
    }
    if (parts.length === 0) return "";
    var allowHint = "";
    var first = rows[0];
    if (first && first.name && first.version) {
      allowHint = dshT("\u5982\u9700\u5F3A\u884C\u63A5\u53D7\uFF1A") + "dsh plugin allow-version " + first.name + "@" + first.version + " --dsh-version " + compat.runtimeVersion + " --accept-risk";
    }
    return "\n\u26A0 " + dshT("dsh \u517C\u5BB9\u6027\uFF1A") + parts.join(dshT("\uFF1B")) + "\u3002" + dshT("\u5BBF\u4E3B\u91CD\u542F\u65F6\u5C06\u8DF3\u8FC7\u52A0\u8F7D\u3002") + allowHint;
  }
  function installPlugin() {
    if (busyRef.current || pView.spec.trim() === "") return;
    busyRef.current = true;
    var spec = pView.spec.trim();
    patchPlugin({ busy: true, error: "", confirming: null, note: "" });
    callRemote("pluginAdmin/install", { spec }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        busyRef.current = false;
        patchPlugin({
          busy: false,
          note: dshT("\u5B89\u88C5\u5B8C\u6210\u3002\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548") + compatWarningText(result.value && result.value.compat),
          output: result.value && result.value.output || "",
          profileDir: result.value && result.value.profileDir || "",
          plugins: result.value && result.value.plugins || [],
          spec: ""
        });
        return;
      }
      var failMessage = dshT("\u5B89\u88C5\u5931\u8D25\uFF1A") + messageOf(result.error);
      busyRef.current = false;
      patchPlugin({ busy: false, error: failMessage });
      showToast("error", failMessage);
      reloadPlugins(true);
    }, function(failure) {
      if (!alive.current) return;
      busyRef.current = false;
      patchPlugin({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function removePlugin(name) {
    if (busyRef.current) return;
    busyRef.current = true;
    patchPlugin({ busy: true, error: "", confirming: null, note: "" });
    callRemote("pluginAdmin/remove", { name }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        busyRef.current = false;
        patchPlugin({
          busy: false,
          note: dshT("\u5378\u8F7D\u5B8C\u6210\u3002\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548"),
          output: result.value && result.value.output || "",
          profileDir: result.value && result.value.profileDir || "",
          plugins: result.value && result.value.plugins || []
        });
        return;
      }
      var failMessage = dshT("\u5378\u8F7D\u5931\u8D25\uFF1A") + messageOf(result.error);
      busyRef.current = false;
      patchPlugin({ busy: false, error: failMessage });
      showToast("error", failMessage);
      reloadPlugins(true);
    }, function(failure) {
      if (!alive.current) return;
      busyRef.current = false;
      patchPlugin({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function toggleEnabled(name, disabled) {
    patchPlugin({ busy: true, error: "", note: "" });
    callRemote("pluginAdmin/setEnabled", { name, disabled }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var value = result.value || {};
        var rows = value.rows && value.rows.length || 0;
        patchPlugin({
          busy: false,
          note: value.state === "present" ? disabled ? dshT("\u8BE5\u63D2\u4EF6\u5DF2\u5904\u4E8E\u505C\u7528\u72B6\u6001") : dshT("\u8BE5\u63D2\u4EF6\u5DF2\u5904\u4E8E\u542F\u7528\u72B6\u6001") : disabled ? dshT("\u5DF2\u5199\u5165 ") + rows + dshT(" \u884C\u505C\u7528\u6807\u8BB0 \u2014 \u91CD\u542F dsh \u540E\u8BE5\u63D2\u4EF6\u4E0D\u518D\u6302\u8F7D\uFF1B\u70B9\u300C\u542F\u7528\u300D\u53EF\u6062\u590D") : dshT("\u5DF2\u79FB\u9664\u505C\u7528\u6807\u8BB0 \u2014 \u91CD\u542F dsh \u540E\u63D2\u4EF6\u6062\u590D\u6302\u8F7D"),
          profileDir: value.profileDir || "",
          plugins: value.plugins || []
        });
        return;
      }
      var failMessage = (disabled ? dshT("\u505C\u7528") : dshT("\u542F\u7528")) + dshT("\u5931\u8D25\uFF1A") + messageOf(result.error);
      patchPlugin({ busy: false, error: failMessage });
      showToast("error", failMessage);
      reloadPlugins(true);
    }, function(failure) {
      if (!alive.current) return;
      patchPlugin({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  useEffect(function() {
    alive.current = true;
    reloadPlugins();
    checkUpdates();
    return function() {
      alive.current = false;
    };
  }, []);
  useEffect(function() {
    saveUpdateReminders(pView.updates || {});
  }, [pView.updates]);
  return createElement(
    "div",
    { "data-dsh-admin-section": "" },
    renderPluginsView(pView, patchPlugin, installPlugin, removePlugin, checkUpdates, upgradePlugin, upgradeAllPlugins, toggleEnabled)
  );
}
function renderPluginsView(view, patch, install, remove, checkUpdates, upgrade, upgradeAll, setEnabled) {
  var elements = [];
  var upgradeAllCount = 0;
  for (var uak in view.updates) {
    var uai = view.updates[uak];
    if (uai && uai.updateAvailable && uai.latest) upgradeAllCount++;
  }
  elements.push(createElement(
    "div",
    { className: "toolbar", key: "toolbar-search" },
    createElement(
      "div",
      { className: "search-wrap", key: "search-wrap" },
      createElement(import_dsh_client_ui_primitives.Input, {
        key: "search-input",
        icon: "\u{1F50D}",
        placeholder: dshT("\u641C\u7D22\u63D2\u4EF6\uFF08\u540D\u79F0/\u7248\u672C/\u8DEF\u5F84\uFF09..."),
        value: view.needle,
        onChange: function(e) {
          patch({ needle: e.target.value });
        }
      }),
      view.needle !== "" ? createElement(import_dsh_client_ui_primitives.Button, {
        key: "btn-clear-search",
        variant: "toolbar",
        size: "sm",
        title: dshT("\u6E05\u7A7A\u641C\u7D22"),
        onClick: function() {
          patch({ needle: "" });
        }
      }, "\u2715") : null
    ),
    // Language switch for ALL plugin panels (module-level state + reload).
    createElement(
      "select",
      {
        key: "lang-switch",
        className: "input",
        style: { flex: "none", width: "auto", cursor: "pointer" },
        title: dshT("\u754C\u9762\u8BED\u8A00"),
        value: currentLanguage(),
        onChange: function(e) {
          setAdminLang(e.target.value);
        }
      },
      createElement("option", { value: "zh", key: "zh" }, "\u4E2D\u6587"),
      createElement("option", { value: "en", key: "en" }, "English")
    )
  ));
  elements.push(createElement(
    "div",
    { className: "toolbar", key: "toolbar-install" },
    createElement(
      "div",
      { className: "input-wrap install-wrap", key: "install-wrap" },
      createElement(import_dsh_client_ui_primitives.Input, {
        placeholder: dshT("\u5B89\u88C5\u5305\u540D/\u8DEF\u5F84..."),
        value: view.spec,
        disabled: view.busy,
        onChange: function(e) {
          patch({ spec: e.target.value });
        },
        onKeyDown: function(e) {
          if (e.key === "Enter") install();
        }
      })
    ),
    createElement(
      import_dsh_client_ui_primitives.Button,
      {
        key: "btn-install",
        variant: "primary",
        disabled: view.busy || view.spec.trim() === "",
        onClick: install
      },
      view.busy ? createElement("span", { className: "spinner", key: "spin" }) : null,
      dshT("\u5B89\u88C5")
    ),
    createElement(
      import_dsh_client_ui_primitives.Button,
      {
        key: "btn-check-updates",
        variant: "outline",
        disabled: view.busy || view.checkingUpdates,
        title: dshT("\u5F3A\u5236\u7ED5\u8FC7 5 \u5206\u949F\u7F13\u5B58\uFF0C\u91CD\u65B0\u67E5\u8BE2 registry \u5E76\u5237\u65B0\u7F13\u5B58"),
        onClick: function() {
          checkUpdates(true);
        }
      },
      view.checkingUpdates ? createElement("span", { className: "spinner", key: "spin" }) : null,
      view.checkingUpdates ? dshT("\u68C0\u67E5\u4E2D...") : dshT("\u2B06\uFE0F \u68C0\u67E5\u66F4\u65B0")
    ),
    createElement(
      import_dsh_client_ui_primitives.Button,
      {
        key: "btn-upgrade-all",
        variant: "outline",
        disabled: view.busy || view.checkingUpdates || upgradeAllCount === 0,
        title: upgradeAllCount > 0 ? dshT("\u4E32\u884C\u5347\u7EA7\u5168\u90E8\u6709\u65B0\u7248\u672C\u7684\u63D2\u4EF6\uFF08") + upgradeAllCount + dshT(" \u4E2A\uFF09\uFF0C\u5355\u4E2A\u5931\u8D25\u4E0D\u963B\u585E\u5176\u4F59") : dshT("\u6CA1\u6709\u5F85\u66F4\u65B0\u7684\u63D2\u4EF6\uFF08\u5148\u300C\u68C0\u67E5\u66F4\u65B0\u300D\uFF09"),
        onClick: function() {
          upgradeAll();
        }
      },
      view.bulkUpdate !== null ? dshT("\u66F4\u65B0\u4E2D ") + view.bulkUpdate.done + " / " + view.bulkUpdate.total + (view.bulkUpdate.failed.length > 0 ? dshT("\uFF08") + view.bulkUpdate.failed.length + dshT(" \u5931\u8D25\uFF09") : "") : dshT("\u2B06\u2B06 \u5168\u90E8\u66F4\u65B0") + (upgradeAllCount > 0 ? " (" + upgradeAllCount + ")" : "")
    )
  ));
  var totalPlugins = view.plugins.length;
  var thirdPartyCount = 0;
  var builtinCount = 0;
  for (var i = 0; i < view.plugins.length; i++) {
    if (view.plugins[i].removable) thirdPartyCount++;
    else builtinCount++;
  }
  elements.push(createElement(
    "div",
    { className: "filter-bar", key: "filters" },
    createElement(import_dsh_client_ui_primitives.Pill, {
      key: "filter-all",
      active: view.filter === "all",
      onClick: function() {
        patch({ filter: "all" });
      }
    }, dshT("\u5168\u90E8 (") + String(totalPlugins) + ")"),
    createElement(import_dsh_client_ui_primitives.Pill, {
      key: "filter-plugin",
      active: view.filter === "plugin",
      onClick: function() {
        patch({ filter: "plugin" });
      }
    }, dshT("\u6269\u5C55\u63D2\u4EF6 (") + String(thirdPartyCount) + ")"),
    createElement(import_dsh_client_ui_primitives.Pill, {
      key: "filter-builtin",
      active: view.filter === "builtin",
      onClick: function() {
        patch({ filter: "builtin" });
      }
    }, dshT("\u7CFB\u7EDF\u5185\u7F6E (") + String(builtinCount) + ")")
  ));
  if (view.busy) {
    elements.push(createElement(
      "div",
      { className: "busy-banner", key: "busy" },
      createElement("span", { className: "spinner", key: "spin" }),
      dshT("\u6B63\u5728\u6267\u884C pnpm \u64CD\u4F5C\uFF08\u53EF\u80FD\u9700\u8981\u6570\u79D2\u81F3\u6570\u5206\u949F\uFF0C\u8BF7\u52FF\u5173\u95ED\u7A97\u53E3\uFF09...")
    ));
  }
  if (view.error !== "") {
    elements.push(createElement("div", { className: "error", key: "error" }, view.error));
  }
  if (view.checkingUpdates) {
    elements.push(createElement(
      "div",
      { className: "update-strip checking", key: "update-checking" },
      createElement("span", { className: "spinner", key: "spin" }),
      dshT("\u6B63\u5728\u68C0\u67E5\u63D2\u4EF6\u7248\u672C\u66F4\u65B0\u2026")
    ));
  } else if (view.updateChecked) {
    var upCount = 0;
    var errCount = 0;
    for (var un in view.updates) {
      if (view.updates[un].updateAvailable === true) upCount++;
      if (view.updates[un].error) errCount++;
    }
    var stripClass = upCount > 0 ? "update-strip has-updates" : errCount > 0 ? "update-strip has-errors" : "update-strip ok";
    var stripText = upCount > 0 ? dshT("\u2B06\uFE0F \u53D1\u73B0 ") + upCount + dshT(" \u4E2A\u63D2\u4EF6\u6709\u65B0\u7248\u672C\uFF0C\u53EF\u70B9\u51FB\u5361\u7247\u4E0A\u7684\u300C\u66F4\u65B0\u300D\u5347\u7EA7") : errCount > 0 ? dshT("\u26A0\uFE0F \u6709 ") + errCount + dshT(" \u4E2A\u63D2\u4EF6\u67E5\u8BE2\u7248\u672C\u5931\u8D25\uFF08\u7F51\u7EDC\u6216 registry \u4E0D\u53EF\u8FBE\uFF09") : dshT("\u2705 \u5DF2\u81EA\u52A8\u68C0\u67E5\u7248\u672C\u66F4\u65B0\uFF0C\u5168\u90E8\u4E3A\u6700\u65B0\u7248\u672C");
    elements.push(createElement(
      "div",
      { className: stripClass, key: "update-result" },
      createElement("span", { key: "t" }, stripText)
    ));
  }
  var needle = view.needle.trim().toLowerCase();
  var filtered = filterPlugins(view.plugins, view.filter, needle);
  var rows = [];
  for (var j = 0; j < filtered.length; j++) {
    var p = filtered[j];
    rows.push(renderPluginCard(p, view, remove, patch, upgrade, setEnabled));
  }
  if (rows.length === 0) {
    rows.push(createElement(
      "div",
      { className: "empty", key: "empty" },
      createElement("div", null, needle !== "" ? dshT("\u{1F50D} \u65E0\u5339\u914D\u7684\u63D2\u4EF6\uFF08\u8BD5\u8BD5\u5176\u4ED6\u5173\u952E\u8BCD\uFF09") : dshT("\u{1F4E6} \u6682\u65E0\u5339\u914D\u7684\u63D2\u4EF6\u5C42"))
    ));
  }
  elements.push(createElement("div", { className: "list grid2", key: "list" }, rows));
  var hintText = view.note !== "" ? view.note : dshT("\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548\uFF08\u5173\u95ED dsh \u8FDB\u7A0B\u540E\u91CD\u65B0\u8FD0\u884C\u5373\u53EF\uFF09");
  var hintTitle = view.output !== "" ? dshT("pnpm \u8F93\u51FA\uFF1A\n") + view.output : void 0;
  elements.push(createElement(
    "div",
    { className: "footer", key: "footer" },
    createElement("span", { className: "path", key: "profile-path", title: view.profileDir }, view.profileDir || dshT("Profile: \u9ED8\u8BA4")),
    createElement("span", { className: "hint", key: "hint", title: hintTitle }, hintText)
  ));
  return createElement("div", { key: "plugins-panel", style: { display: "flex", flexDirection: "column", gap: "10px" } }, elements);
}
function renderPluginCard(plugin, view, remove, patch, upgrade, setEnabled) {
  var isConfirming = view.confirming === plugin.name;
  var header = createElement(
    "div",
    { className: "card-header", key: "header" },
    createElement(
      "div",
      { className: "card-title", key: "title" },
      createElement("span", { className: "card-title-text", key: "name", title: plugin.name }, plugin.name)
    )
  );
  var metaChildren = [];
  if (plugin.version) {
    metaChildren.push(createElement("span", { className: "tag version", key: "version" }, "v" + plugin.version));
  }
  var isLocal = Boolean(plugin.localPath);
  metaChildren.push(createElement(
    "span",
    {
      className: plugin.removable ? isLocal ? "tag local" : "tag plugin" : "tag",
      key: "type-tag"
    },
    plugin.removable ? isLocal ? dshT("\u672C\u5730\u5B89\u88C5") : dshT("\u5305\u5B89\u88C5") : dshT("\u5185\u7F6E")
  ));
  if (plugin.disabled) {
    metaChildren.push(createElement("span", {
      className: "tag update-error",
      key: "disabled-badge",
      title: dshT("profile patch \u4E2D\u5DF2\u5199\u5165\u8BE5\u63D2\u4EF6\u7684\u505C\u7528\u884C \u2014 \u91CD\u542F dsh \u540E\u4E0D\u518D\u6302\u8F7D\uFF1B\u70B9\u300C\u542F\u7528\u300D\u6062\u590D")
    }, dshT("\u23F8 \u5DF2\u505C\u7528")));
  }
  var updateInfo = view.updates && view.updates[plugin.name];
  var updateBadge = null;
  if (updateInfo && updateInfo.updateAvailable && updateInfo.latest) {
    updateBadge = createElement("span", {
      className: "tag update",
      key: "update-badge",
      title: dshT("\u8FDC\u7A0B registry \u6709\u65B0\u7248\u672C\uFF1Av") + updateInfo.latest + dshT("\uFF08\u5F53\u524D v") + plugin.version + dshT("\uFF09") + (typeof updateInfo.at === "number" && updateInfo.at > 0 ? dshT("\uFF0C\u68C0\u6D4B\u4E8E ") + formatTestTime(updateInfo.at) + dshT("\uFF0C\u66F4\u65B0\u540E\u63D0\u9192\u81EA\u52A8\u6D88\u9664") : "")
    }, dshT("\u2B06 \u6709\u65B0\u7248\u672C v") + updateInfo.latest);
  } else if (updateInfo && updateInfo.error) {
    metaChildren.push(createElement("span", {
      className: "tag update-error",
      key: "update-error",
      title: updateInfo.error
    }, dshT("\u26A0 \u66F4\u65B0\u68C0\u67E5\u5931\u8D25")));
  }
  var cardChildren = [header];
  if (updateBadge) {
    cardChildren.push(createElement("div", { className: "card-sub", key: "update-line" }, [updateBadge]));
  }
  if (plugin.removable && !isConfirming) {
    var actionChildren = [];
    if (plugin.disablable && typeof setEnabled === "function") {
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        key: "btn-toggle-enabled",
        variant: "outline",
        size: "sm",
        disabled: view.busy,
        title: plugin.disabled ? dshT("\u79FB\u9664 profile patch \u4E2D\u7684\u505C\u7528\u884C\uFF08\u91CD\u542F dsh \u540E\u6062\u590D\u6302\u8F7D\uFF09") : dshT("\u5199\u5165\u505C\u7528\u884C\u5230 profile patch\uFF08\u4E0D\u5378\u8F7D\u3001\u4FDD\u7559\u914D\u7F6E\uFF1B\u91CD\u542F dsh \u540E\u4E0D\u518D\u6302\u8F7D\uFF09"),
        onClick: function() {
          setEnabled(plugin.name, !plugin.disabled);
        }
      }, plugin.disabled ? dshT("\u25B6 \u542F\u7528") : dshT("\u23F8 \u505C\u7528")));
    }
    if (updateInfo && updateInfo.updateAvailable && updateInfo.latest && !isLocal) {
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        key: "btn-upgrade",
        variant: "outline",
        size: "sm",
        disabled: view.busy,
        title: dshT("\u5347\u7EA7\u5230 v") + updateInfo.latest + dshT("\uFF08") + "npm install " + plugin.name + "@" + updateInfo.latest + dshT("\uFF09"),
        onClick: function() {
          upgrade(plugin.name);
        }
      }, dshT("\u2B06 \u66F4\u65B0")));
    }
    actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, {
      type: "button",
      key: "btn-remove",
      variant: "outline",
      size: "sm",
      className: "danger",
      disabled: view.busy,
      onClick: function() {
        patch({ confirming: plugin.name });
      }
    }, dshT("\u5378\u8F7D")));
    metaChildren.push(createElement("div", { className: "card-actions", key: "actions" }, actionChildren));
  }
  cardChildren.push(createElement("div", { className: "card-sub", key: "meta" }, metaChildren));
  if (plugin.localPath) {
    cardChildren.push(createElement(
      "div",
      { className: "plugin-path", key: "path", title: plugin.localPath },
      "\u{1F4C2} " + plugin.localPath
    ));
  }
  if (isConfirming) {
    cardChildren.push(createElement(
      "div",
      { className: "confirm-bar", key: "confirm" },
      createElement("span", { className: "confirm-text", key: "text" }, dshT("\u26A0\uFE0F \u786E\u5B9A\u8981\u5378\u8F7D\u8BE5\u63D2\u4EF6\u5417\uFF1F")),
      createElement(
        "div",
        { className: "confirm-actions", key: "actions" },
        createElement(import_dsh_client_ui_primitives.Button, {
          type: "button",
          key: "btn-confirm",
          variant: "outline",
          size: "sm",
          className: "danger-solid",
          disabled: view.busy,
          onClick: function() {
            remove(plugin.name);
          }
        }, dshT("\u786E\u8BA4\u5378\u8F7D")),
        createElement(import_dsh_client_ui_primitives.Button, {
          type: "button",
          key: "btn-cancel",
          variant: "outline",
          size: "sm",
          disabled: view.busy,
          onClick: function() {
            patch({ confirming: null });
          }
        }, dshT("\u53D6\u6D88"))
      )
    ));
  }
  return createElement("div", { key: plugin.name, className: "card" }, cardChildren);
}
function pluginSortRank(plugin) {
  if (!plugin.removable) return 0;
  return plugin.localPath ? 2 : 1;
}
function filterPlugins(plugins, filter, needle) {
  var result = (
    /** @type {Array<PluginListEntry>} */
    []
  );
  for (var i = 0; i < plugins.length; i++) {
    var p = plugins[i];
    if (filter === "plugin" && !p.removable) continue;
    if (filter === "builtin" && p.removable) continue;
    if (needle !== "") {
      var hay = ((p.name || "") + " " + (p.version || "") + " " + (p.localPath || "")).toLowerCase();
      if (hay.indexOf(needle) === -1) continue;
    }
    result.push(p);
  }
  return result.sort(function(a, b) {
    return pluginSortRank(a) - pluginSortRank(b);
  });
}

// src/client/panels/web-search.js
function WebSearchSection(props) {
  var call = props.call;
  var kit = sectionState({
    providers: [],
    active: null,
    busy: false,
    error: "",
    busyId: "",
    // 配置编辑器：configOpen 是展开的 provider id；draft 是暂存的字段值；
    // cleared 是待删除的键（密钥必须显式点「清除」，空输入永远不会清空有效 key）。
    configOpen: "",
    config: null,
    configBusy: false,
    configError: "",
    configNote: "",
    draft: {},
    cleared: {}
  });
  var state = kit.state;
  var setState = kit.set;
  var alive = kit.alive;
  var configRequest = useRef("");
  function patch(partial) {
    kit.patch(partial);
  }
  function reload() {
    patch({ busy: true, error: "" });
    call("webSearchAdmin/list", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        patch({
          busy: false,
          providers: Array.isArray(v.providers) ? v.providers : [],
          active: v.active === null || v.active === void 0 ? null : v.active
        });
      } else {
        patch({ busy: false, error: dshT("\u52A0\u8F7D\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  kit.mount(reload);
  var listActionBusy = useRef(false);
  function selectProvider(id) {
    if (state.active !== null && state.active.searchProvider === id) return;
    if (listActionBusy.current) return;
    listActionBusy.current = true;
    patch({ busyId: id, error: "" });
    call("webSearchAdmin/setActive", { providerId: id }).then(function(result) {
      listActionBusy.current = false;
      if (!alive.current) return;
      if (result.ok) {
        patch({ busyId: "", active: result.value || { searchProvider: id } });
      } else {
        patch({ busyId: "", error: dshT("\u5207\u6362\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      listActionBusy.current = false;
      if (!alive.current) return;
      patch({ busyId: "", error: dshT("\u5207\u6362\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function installProvider(id) {
    if (listActionBusy.current) return;
    listActionBusy.current = true;
    patch({ busyId: id, error: "" });
    call("webSearchAdmin/install", { providerId: id }).then(function(result) {
      listActionBusy.current = false;
      if (!alive.current) return;
      if (result.ok) {
        patch({ busyId: "" });
        reload();
      } else {
        patch({ busyId: "", error: dshT("\u5B89\u88C5\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      listActionBusy.current = false;
      if (!alive.current) return;
      patch({ busyId: "", error: dshT("\u5B89\u88C5\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function uninstallProvider(id) {
    if (listActionBusy.current) return;
    listActionBusy.current = true;
    patch({ busyId: id, error: "" });
    call("webSearchAdmin/uninstall", { providerId: id }).then(function(result) {
      listActionBusy.current = false;
      if (!alive.current) return;
      if (result.ok) {
        patch({ busyId: "" });
        reload();
      } else {
        patch({ busyId: "", error: dshT("\u5378\u8F7D\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      listActionBusy.current = false;
      if (!alive.current) return;
      patch({ busyId: "", error: dshT("\u5378\u8F7D\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function loadConfig(id) {
    configRequest.current = id;
    patch({ configBusy: true, configError: "" });
    call("webSearchAdmin/config", { providerId: id }).then(function(result) {
      if (!alive.current || configRequest.current !== id) return;
      if (!result.ok) {
        patch({ configBusy: false, configError: dshT("\u8BFB\u53D6\u914D\u7F6E\u5931\u8D25\uFF1A") + messageOf(result.error) });
        return;
      }
      var view = result.value || {};
      var fields = Array.isArray(view.fields) ? view.fields : [];
      var draft = {};
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        draft[field.key] = field.set === true && field.kind !== "secret" && field.value !== "" && field.value !== null ? String(field.value) : "";
      }
      patch({ configBusy: false, config: view, draft, cleared: {}, configError: "" });
    }, function(err) {
      if (!alive.current || configRequest.current !== id) return;
      patch({ configBusy: false, configError: dshT("\u8BFB\u53D6\u914D\u7F6E\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function toggleConfig(id) {
    if (state.configOpen === id) {
      configRequest.current = "";
      patch({ configOpen: "", config: null, configBusy: false, configError: "", configNote: "", draft: {}, cleared: {} });
      return;
    }
    configRequest.current = id;
    patch({ configOpen: id, config: null, configBusy: true, configError: "", configNote: "", draft: {}, cleared: {} });
    loadConfig(id);
  }
  function setDraftField(key, value) {
    var next = {};
    for (var existing in state.draft) next[existing] = state.draft[existing];
    next[key] = value;
    patch({ draft: next });
  }
  function toggleClear(key) {
    var next = {};
    for (var existing in state.cleared) next[existing] = state.cleared[existing];
    next[key] = state.cleared[key] !== true;
    patch({ cleared: next });
  }
  function saveProviderConfig(id) {
    var view = state.config;
    if (view === null) return;
    var fields = Array.isArray(view.fields) ? view.fields : [];
    var values = {};
    var unset = [];
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var staged = state.draft[field.key] === void 0 || state.draft[field.key] === null ? "" : String(state.draft[field.key]).trim();
      if (field.kind === "secret") {
        if (state.cleared[field.key] === true) unset.push(field.key);
        else if (staged !== "") values[field.key] = staged;
        continue;
      }
      if (staged !== "") values[field.key] = field.kind === "number" ? Number(staged) : staged;
      else if (field.set === true) unset.push(field.key);
    }
    patch({ configBusy: true, configError: "", configNote: "" });
    call("webSearchAdmin/saveConfig", {
      providerId: id,
      values,
      unset,
      expectedRevision: view.revision
    }).then(function(result) {
      if (!alive.current) return;
      if (!result.ok) {
        patch({ configBusy: false, configError: dshT("\u4FDD\u5B58\u5931\u8D25\uFF1A") + messageOf(result.error) });
        return;
      }
      var saved = result.value || {};
      patch({
        configBusy: false,
        configNote: saved.restartRequired === true ? dshT("\u2705 \u5DF2\u5199\u5165 ") + (saved.source === "settings" ? "settings" : "cordis.patch.yml") + dshT(" \u2014 \u91CD\u542F dsh \u540E\u751F\u6548") : dshT("\u2705 \u5DF2\u4FDD\u5B58\uFF08\u5373\u65F6\u751F\u6548\uFF09")
      });
      loadConfig(id);
    }, function(err) {
      if (!alive.current) return;
      patch({ configBusy: false, configError: dshT("\u4FDD\u5B58\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  var elements = [];
  elements.push(createElement(
    "div",
    {
      className: "hint",
      key: "restart-banner",
      style: { background: "var(--dsw-alias-bg-layer-2)", padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4))" }
    },
    dshT("\u{1F501} \u5207\u6362 provider / \u5B89\u88C5 / \u5378\u8F7D \u540E\u9700**\u91CD\u542F dsh** \u751F\u6548\uFF1B\u2699 \u914D\u7F6E\u91CC\u5E26 settings \u547D\u540D\u7A7A\u95F4\u7684 provider \u4FDD\u5B58\u540E\u5373\u65F6\u751F\u6548\uFF0C\u5199 cordis \u884C\u7684\u9700\u91CD\u542F")
  ));
  if (state.busy) {
    elements.push(createElement(
      "div",
      { className: "busy-banner", key: "busy" },
      createElement("span", { className: "spinner", key: "sp" }),
      dshT("\u52A0\u8F7D\u4E2D\u2026")
    ));
  }
  if (state.error !== "") {
    elements.push(createElement("div", { className: "error", key: "err" }, state.error));
  }
  var activeId = state.active === null ? null : state.active.searchProvider;
  for (let i = 0; i < state.providers.length; i++) {
    const p = state.providers[i];
    var isActive = activeId === p.id;
    var isInstalled = p.installed;
    var isBundled = p.bundled;
    var isBusy = state.busyId === p.id;
    var envClass = isInstalled ? "tag plugin" : "tag";
    var radioChildren = [
      createElement(
        "label",
        { key: "radio-row", style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" } },
        createElement("input", {
          type: "radio",
          name: "web-search-provider",
          value: p.id,
          checked: isActive,
          disabled: !isInstalled || isBusy,
          onChange: function() {
            selectProvider(p.id);
          },
          key: "radio"
        }),
        createElement("span", { style: { fontWeight: 600 }, key: "name" }, p.label),
        isBundled ? createElement("span", { className: "tag", key: "bundled", title: dshT("dsh \u9ED8\u8BA4 provider\uFF0C\u65E0\u6CD5\u4ECE\u6B64\u9762\u677F\u5378\u8F7D") }, dshT("\u{1F6E1} dsh \u9ED8\u8BA4")) : null,
        createElement("span", { className: envClass, key: "env", title: dshT("provider \u901A\u8FC7\u6B64\u73AF\u5883\u53D8\u91CF\u8BFB\u53D6 API key\uFF08launch env, \u4E0D\u5B58 plugin\uFF09") }, "\u{1F511} " + p.envVar)
      )
    ];
    var subChildren = [
      createElement("div", { key: "pkg", className: "card-sub", style: { fontFamily: "monospace", fontSize: "11px" } }, p.packageName),
      isInstalled ? null : createElement(
        "div",
        { key: "not-installed", className: "card-sub", style: { color: "var(--dsw-alias-label-secondary, #61666b)", borderLeft: "2px solid #b45309", paddingLeft: "6px" } },
        dshT("\u{1F4E6} \u6B64 provider \u672A\u5B89\u88C5 \u2014 \u9700\u8981\u70B9\u300C\u{1F4E5} \u5B89\u88C5\u300D\u6309\u94AE\u8C03 `pnpm add` \u628A npm \u5305\u52A0\u8FDB profile")
      )
    ];
    var actionChildren = [];
    if (!isInstalled && !isBundled) {
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, {
        variant: "primary",
        size: "sm",
        key: "install",
        disabled: isBusy,
        onClick: function() {
          installProvider(p.id);
        }
      }, isBusy ? dshT("\u5B89\u88C5\u4E2D\u2026") : dshT("\u{1F4E5} \u5B89\u88C5")));
    }
    if (isInstalled && !isBundled) {
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        className: "danger",
        key: "uninstall",
        disabled: isBusy,
        onClick: function() {
          uninstallProvider(p.id);
        }
      }, isBusy ? dshT("\u5378\u8F7D\u4E2D\u2026") : dshT("\u{1F5D1} \u5378\u8F7D")));
    }
    actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, {
      variant: "outline",
      size: "sm",
      key: "config",
      "aria-expanded": state.configOpen === p.id ? "true" : "false",
      title: dshT("\u7F16\u8F91\u8BE5 provider \u7684 Config\uFF08Endpoint / \u6A21\u578B / API Key \u2026\uFF09"),
      onClick: function() {
        toggleConfig(p.id);
      }
    }, state.configOpen === p.id ? dshT("\u2699 \u6536\u8D77\u914D\u7F6E") : dshT("\u2699 \u914D\u7F6E")));
    var cardBody = subChildren.slice();
    if (state.configOpen === p.id) {
      cardBody.push(buildProviderConfigElement(p, state, {
        setField: setDraftField,
        toggleClear,
        save: function() {
          saveProviderConfig(p.id);
        }
      }));
    }
    elements.push(createElement(
      "div",
      {
        className: "card",
        key: "ws-" + p.id,
        style: { borderColor: isActive ? "var(--dsw-alias-border-strong, rgba(120,120,200,0.6))" : void 0 }
      },
      createElement(
        "div",
        { className: "card-header", key: "h" },
        createElement("span", { className: "card-title", key: "title-row" }, radioChildren),
        actionChildren.length > 0 ? createElement("span", { className: "card-actions", key: "a" }, actionChildren) : null
      ),
      cardBody.length > 0 ? createElement("div", { key: "body" }, cardBody) : null
    ));
  }
  if (state.providers.length === 0 && !state.busy) {
    elements.push(createElement("div", { className: "empty", key: "empty" }, dshT("\u52A0\u8F7D provider \u5217\u8868\u5931\u8D25 \u2014 \u68C0\u67E5 dsh \u662F\u5426\u5728\u8FD0\u884C")));
  }
  return createElement("div", { "data-dsh-admin-section": "" }, elements);
}
function renderProviderConfig(view, ui) {
  var fields = Array.isArray(view.fields) ? view.fields : [];
  var rows = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const staged = ui.draft[field.key] === void 0 || ui.draft[field.key] === null ? "" : String(ui.draft[field.key]);
    const choices = Array.isArray(field.choices) ? field.choices : [];
    var input;
    if (field.kind === "enum") {
      var options = [createElement(
        "option",
        { key: "__inherit", value: "" },
        dshT("\u7EE7\u627F\u9ED8\u8BA4") + (field.default === null || field.default === void 0 ? "" : dshT("\uFF08") + field.default + dshT("\uFF09"))
      )];
      for (var c = 0; c < choices.length; c++) {
        options.push(createElement("option", { key: choices[c], value: choices[c] }, choices[c]));
      }
      input = createElement("select", {
        className: "input",
        key: "input",
        value: staged,
        disabled: ui.busy,
        "aria-label": field.label,
        onChange: function(e) {
          ui.setField(field.key, e.target.value);
        }
      }, options);
    } else {
      var placeholder = field.kind === "secret" ? field.set === true ? dshT("\u5DF2\u914D\u7F6E \u2014 \u7559\u7A7A\u4E0D\u4FEE\u6539") : dshT("\u672A\u914D\u7F6E \u2014 \u7559\u7A7A\u5219\u56DE\u9000\u5230\u51ED\u636E / \u73AF\u5883\u53D8\u91CF") : field.default === null || field.default === void 0 ? dshT("\u7559\u7A7A = \u7EE7\u627F provider \u9ED8\u8BA4\u503C") : dshT("\u7EE7\u627F\u9ED8\u8BA4\uFF1A") + field.default;
      input = createElement(import_dsh_client_ui_primitives.Input, {
        type: field.kind === "secret" ? "password" : field.kind === "number" ? "number" : "text",
        value: staged,
        placeholder,
        disabled: ui.busy,
        "aria-label": field.label,
        onChange: function(e) {
          ui.setField(field.key, e.target.value);
        }
      });
    }
    rows.push(createElement(
      "div",
      {
        key: "field-" + field.key,
        style: {
          display: "grid",
          gridTemplateColumns: "minmax(120px, 200px) 1fr auto auto",
          gap: "4px 10px",
          alignItems: "center"
        }
      },
      createElement("span", { style: { fontSize: "12px", fontWeight: 600, wordBreak: "break-all" } }, field.label),
      input,
      field.kind === "secret" ? createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        key: "clear",
        disabled: ui.busy || field.set !== true,
        title: field.set === true ? dshT("\u5220\u9664\u5DF2\u5B58\u7684\u5BC6\u94A5\u503C") : dshT("\u5F53\u524D\u6CA1\u6709\u53EF\u5220\u9664\u7684\u5BC6\u94A5\u503C"),
        onClick: function() {
          ui.toggleClear(field.key);
        }
      }, ui.cleared[field.key] === true ? dshT("\u21BA \u64A4\u9500") : dshT("\u6E05\u9664")) : null,
      field.set === true ? createElement("span", { className: "tag live", key: "set" }, dshT("\u5DF2\u8BBE\u7F6E")) : null,
      field.hint ? createElement("div", {
        style: { gridColumn: "2 / -1", fontSize: "11px", lineHeight: 1.4, color: "var(--dsw-alias-label-secondary, #61666b)" }
      }, field.hint) : null
    ));
  }
  return createElement(
    "div",
    {
      key: "config",
      style: { borderTop: "1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4))", marginTop: "8px", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }
    },
    createElement(
      "div",
      { className: "hint", key: "storage", style: { fontSize: "11px" } },
      (view.source === "settings" ? dshT("\u{1F5C4} \u5B58\u50A8\uFF1Adsh settings \u547D\u540D\u7A7A\u95F4 `") : dshT("\u{1F5C4} \u5B58\u50A8\uFF1Acordis.patch.yml \u884C `")) + view.namespace + "`" + (view.restartRequired === true ? dshT(" \xB7 \u4FDD\u5B58\u540E\u9700\u91CD\u542F dsh \u751F\u6548") : dshT(" \xB7 \u4FDD\u5B58\u540E\u5373\u65F6\u751F\u6548"))
    ),
    ui.configError !== "" ? createElement("div", { className: "error", key: "err" }, ui.configError) : null,
    ui.note !== "" ? createElement("div", { className: "hint", key: "ok", style: { fontSize: "11px" } }, ui.note) : null,
    view.note ? createElement("div", { className: "hint", key: "srcc", style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" } }, view.note) : null,
    rows.length > 0 ? createElement("div", { key: "rows", style: { display: "flex", flexDirection: "column", gap: "6px" } }, rows) : createElement("div", { className: "empty", key: "norows" }, dshT("\u8BE5 provider \u6CA1\u6709\u53EF\u914D\u7F6E\u5B57\u6BB5")),
    createElement(
      "div",
      { key: "acts", style: { display: "grid", gridTemplateColumns: "minmax(120px, 200px) 1fr auto auto", alignItems: "center" } },
      createElement(
        "div",
        { className: "card-actions", style: { gridColumn: "2 / -1" } },
        ui.busy ? createElement("span", { className: "spinner", key: "sp" }) : null,
        createElement(
          import_dsh_client_ui_primitives.Button,
          { variant: "primary", size: "sm", key: "save", disabled: ui.busy, onClick: ui.save },
          ui.busy ? dshT("\u4FDD\u5B58\u4E2D\u2026") : dshT("\u{1F4BE} \u4FDD\u5B58\u914D\u7F6E")
        )
      )
    )
  );
}
function buildProviderConfigElement(provider, state, handlers) {
  if (state.config === null) {
    return createElement(
      "div",
      { key: "config" },
      state.configBusy ? createElement(
        "div",
        { className: "busy-banner", key: "busy" },
        createElement("span", { className: "spinner", key: "sp" }),
        dshT("\u8BFB\u53D6 ") + provider.label + dshT(" \u914D\u7F6E\u2026")
      ) : createElement("div", { className: "error", key: "err" }, state.configError !== "" ? state.configError : dshT("\u914D\u7F6E\u4E0D\u53EF\u7528"))
    );
  }
  return renderProviderConfig(state.config, {
    draft: state.draft,
    cleared: state.cleared,
    busy: state.configBusy,
    configError: state.configError,
    note: state.configNote,
    setField: handlers.setField,
    toggleClear: handlers.toggleClear,
    save: handlers.save
  });
}

// src/client/panels/sessions.js
var SEARCH_DISABLED_MARKER = "SESSION_QUERY_SEARCH_DISABLED";
function WebSessionsSection(props) {
  var tabHooks = useState("sessions");
  var tab = tabHooks[0];
  var setTab = tabHooks[1];
  var tabs = [
    { id: "sessions", label: dshT("\u5386\u53F2\u4F1A\u8BDD"), component: SessionsSection }
  ];
  if (!panelHidden("webSearch")) {
    tabs.push({ id: "websearch", label: dshT("Web \u641C\u7D22"), component: WebSearchSection });
  }
  var selected = tabs.find(function(entry) {
    return entry.id === tab;
  }) || tabs[0];
  return createElement(
    "div",
    { "data-cha-section": "" },
    createElement(
      "div",
      {
        className: "tabs",
        role: "tablist",
        "aria-label": dshT("Web \u4E0E\u4F1A\u8BDD"),
        onKeyDown: function(event) {
          tabKeyDown(event, tabs, selected.id, setTab);
        }
      },
      tabs.map(function(entry) {
        return createElement("button", {
          type: "button",
          role: "tab",
          key: entry.id,
          id: "dsh-admin-tab-" + entry.id,
          "aria-controls": "dsh-admin-panel-" + entry.id,
          tabIndex: entry.id === selected.id ? 0 : -1,
          className: "tab" + (entry.id === selected.id ? " active" : ""),
          "aria-selected": entry.id === selected.id,
          onClick: function() {
            setTab(entry.id);
          }
        }, entry.label);
      })
    ),
    createElement(
      "div",
      { key: selected.id, role: "tabpanel", id: "dsh-admin-panel-" + selected.id, "aria-labelledby": "dsh-admin-tab-" + selected.id },
      createElement(selected.component, { call: props.call, refreshSessions: props.refreshSessions })
    )
  );
}
function SessionsSection(props) {
  var kit = sectionState({
    sessions: [],
    workspaces: [],
    busy: false,
    error: "",
    needle: "",
    confirming: null,
    filter: "all",
    fulltext: false,
    // full-text search mode across all sessions
    fullNeedle: "",
    fullHits: null,
    // null = not run yet; [] = no hits
    fullBusy: false,
    healthBySession: {},
    // sessionId -> { loading?, report?, error? }
    searchDisabled: false,
    // full-text search rejected with SESSION_QUERY_SEARCH_DISABLED
    searchEnableState: null,
    // null | 'enabling' | 'pending' (written, restart required)
    // Bulk deletion: the pending/running request ({ scope, label, plan }) and
    // its progress. Null = no bulk bar.
    bulk: null,
    bulkBusy: false,
    bulkDone: 0
  });
  var sView = kit.state;
  var setSView = kit.set;
  var pairPinned = useState(loadPinnedIds);
  var pinnedIds = pairPinned[0];
  var setPinnedIds = pairPinned[1];
  var pairCollapsed = useState(loadCollapsedGroups);
  var collapsedGroups = pairCollapsed[0];
  var setCollapsedGroups = pairCollapsed[1];
  useEffect(function() {
    savePinnedIds(pinnedIds);
  }, [pinnedIds]);
  useEffect(function() {
    saveCollapsedGroups(collapsedGroups);
  }, [collapsedGroups]);
  function toggleGroupCollapsed(key) {
    setCollapsedGroups(function(cur) {
      return cur.indexOf(key) !== -1 ? cur.filter(function(k) {
        return k !== key;
      }) : cur.concat([key]);
    });
  }
  function collapseAllGroups(keys) {
    var next = Array.isArray(keys) ? keys.slice() : [];
    setCollapsedGroups(next);
    saveCollapsedGroups(next);
  }
  function bulkTargets(scope, groupKey) {
    var needle = (sView.needle || "").trim().toLowerCase();
    var visible = filterSessions(sView.sessions, sView.filter, needle, pinnedIds);
    var sessions = visible;
    var label = "";
    if (scope === "group") {
      var groups = buildSessionGroups(visible, sView.workspaces || []);
      sessions = [];
      for (var i = 0; i < groups.length; i++) {
        var key = groups[i].workspaceId === null ? "ungrouped" : "ws-" + groups[i].workspaceId;
        if (key !== groupKey) continue;
        sessions = groups[i].sessions;
        label = groups[i].title || dshT("\u672A\u547D\u540D");
        break;
      }
    }
    var plan = [];
    for (var j = 0; j < sessions.length; j++) {
      plan.push({ id: sessions[j].id, live: sessions[j].live === true });
    }
    return { label, plan };
  }
  function requestBulkDelete(scope, groupKey) {
    if (sView.bulkBusy) return;
    var target = bulkTargets(scope, groupKey);
    if (target.plan.length === 0) return;
    patchSession({ bulk: { scope, label: target.label, plan: target.plan }, bulkDone: 0, error: "" });
  }
  function runBulkDelete() {
    var bulk = sView.bulk;
    if (bulk === null || bulk === void 0 || sView.bulkBusy) return;
    patchSession({ bulkBusy: true, bulkDone: 0, error: "" });
    var plan = bulk.plan;
    var done = 0;
    var failures = 0;
    var step = function() {
      if (!alive.current) return;
      if (done >= plan.length) {
        patchSession({ bulkBusy: false, bulk: null, bulkDone: 0 });
        if (failures > 0) {
          patchSession({ error: dshT("\u6279\u91CF\u5220\u9664\u5B8C\u6210\uFF0C") + String(failures) + dshT(" \u4E2A\u4F1A\u8BDD\u5220\u9664\u5931\u8D25\uFF08\u8BE6\u89C1\u4EA4\u4ED8\u5386\u53F2/\u5BBF\u4E3B\u65E5\u5FD7\uFF09") });
        }
        if (props.refreshSessions) props.refreshSessions();
        return reloadSessions();
      }
      var item = plan[done];
      done++;
      callRemote("sessionAdmin/" + (item.live ? "closeSession" : "deleteSession"), { sessionId: item.id }).then(function(result) {
        if (!alive.current) return;
        if (!result || result.ok !== true) failures++;
        patchSession({ bulkDone: done });
        step();
      }, function() {
        if (!alive.current) return;
        failures++;
        patchSession({ bulkDone: done });
        step();
      });
    };
    step();
  }
  function cancelBulkDelete() {
    if (sView.bulkBusy) return;
    patchSession({ bulk: null, bulkDone: 0 });
  }
  function togglePinned(id) {
    setPinnedIds(function(cur) {
      return cur.indexOf(id) !== -1 ? cur.filter(function(x) {
        return x !== id;
      }) : cur.concat([id]);
    });
  }
  var alive = kit.alive;
  var searchSeq = useRef(0);
  function patchSession(partial) {
    kit.patch(partial);
  }
  var callRemote = props.call;
  function reloadSessions() {
    patchSession({ busy: true, error: "" });
    callRemote("sessionAdmin/list", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        patchSession({
          busy: false,
          sessions: result.value && result.value.sessions || [],
          workspaces: result.value && result.value.workspaces || []
        });
      } else {
        patchSession({ busy: false, error: dshT("\u52A0\u8F7D\u4F1A\u8BDD\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(failure) {
      if (!alive.current) return;
      patchSession({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function actSession(method, sessionId) {
    patchSession({ busy: true, error: "", confirming: null });
    callRemote("sessionAdmin/" + method, { sessionId }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        if ((method === "deleteSession" || method === "closeSession") && props.refreshSessions) props.refreshSessions();
        return reloadSessions();
      }
      patchSession({ busy: false, error: dshT("\u64CD\u4F5C\u5931\u8D25\uFF1A") + messageOf(result.error) });
    }, function(failure) {
      if (!alive.current) return;
      patchSession({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(failure) });
    });
  }
  function runFulltext(q) {
    var query = q === void 0 || q === null ? sView.fullNeedle : q;
    query = (query || "").trim();
    if (query === "") {
      patchSession({ fulltext: false, fullHits: null });
      return;
    }
    var seq = ++searchSeq.current;
    patchSession({ fullBusy: true, fullHits: null });
    callRemote("sessionAdmin/searchSessions", { query }).then(function(result) {
      if (!alive.current || seq !== searchSeq.current) return;
      if (result.ok) {
        var hits = result.value && result.value.hits || [];
        patchSession({ fullBusy: false, fullHits: hits });
      } else if (messageOf(result.error).indexOf(SEARCH_DISABLED_MARKER) !== -1) {
        patchSession({ fullBusy: false, fullHits: [], error: "", searchDisabled: true });
      } else {
        patchSession({ fullBusy: false, fullHits: [], error: dshT("\u5168\u6587\u68C0\u7D22\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current || seq !== searchSeq.current) return;
      if (messageOf(err).indexOf(SEARCH_DISABLED_MARKER) !== -1) {
        patchSession({ fullBusy: false, fullHits: [], error: "", searchDisabled: true });
        return;
      }
      patchSession({ fullBusy: false, fullHits: [], error: dshT("\u5168\u6587\u68C0\u7D22\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function enableSearch() {
    if (sView.searchEnableState !== null) return;
    patchSession({ searchEnableState: "enabling" });
    callRemote("overlayAdmin/searchEnable", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        patchSession({ searchEnableState: "pending" });
      } else {
        patchSession({ searchEnableState: null, error: dshT("\u542F\u7528\u5168\u6587\u68C0\u7D22\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (alive.current) patchSession({ searchEnableState: null, error: dshT("\u542F\u7528\u5168\u6587\u68C0\u7D22\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function patchHealth(sessionId, entry) {
    setSView(function(cur) {
      var next = {};
      for (var k in cur) next[k] = cur[k];
      next.healthBySession = Object.assign({}, cur.healthBySession, { [sessionId]: entry });
      return next;
    });
  }
  function loadHealth(sessionId) {
    patchHealth(sessionId, { loading: true });
    callRemote("sessionAdmin/healthReport", { sessionId }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var value = result.value || {};
        patchHealth(sessionId, { report: value.report || {}, summary: value.summary || "" });
      } else {
        patchHealth(sessionId, { error: messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patchHealth(sessionId, { error: messageOf(err) });
    });
  }
  function exportSession(session) {
    callRemote("sessionAdmin/exportSession", { sessionId: session.id }).then(function(result) {
      if (!alive.current) return;
      if (result.ok && result.value && typeof result.value.markdown === "string") {
        try {
          downloadTextFile(result.value.filename || "dsh-session.md", result.value.markdown);
          showToast(
            result.value.truncated === true ? "info" : "success",
            result.value.truncated === true ? dshT("\u26A0\uFE0F \u5DF2\u5BFC\u51FA\uFF08\u4F1A\u8BDD\u4E8B\u4EF6\u8D85\u51FA\u4E0A\u9650\uFF0C\u6587\u4EF6\u5DF2\u622A\u65AD\uFF09") : dshT("\u2705 \u5DF2\u5BFC\u51FA ") + (result.value.messages || 0) + dshT(" \u6761\u6D88\u606F")
          );
        } catch (e) {
          showToast("error", dshT("\u274C \u5BFC\u51FA\u5931\u8D25\uFF1A") + messageOf(e));
        }
        return;
      }
      showToast("error", dshT("\u274C \u5BFC\u51FA\u5931\u8D25\uFF1A") + messageOf(result.error));
    }, function(failure) {
      if (alive.current) showToast("error", dshT("\u274C \u5BFC\u51FA\u5931\u8D25\uFF1A") + messageOf(failure));
    });
  }
  kit.mount(reloadSessions);
  var groupUi = {
    collapsed: collapsedGroups,
    toggleCollapse: toggleGroupCollapsed,
    collapseAll: collapseAllGroups,
    requestBulk: requestBulkDelete,
    confirmBulk: runBulkDelete,
    cancelBulk: cancelBulkDelete
  };
  return createElement(
    "div",
    { "data-dsh-admin-section": "" },
    renderSessionsView(sView, patchSession, reloadSessions, actSession, exportSession, pinnedIds, togglePinned, runFulltext, loadHealth, enableSearch, groupUi)
  );
}
function liveHint() {
  return dshT('\u4F1A\u8BDD\u5728\u7EBF\uFF1A\u4ECD\u6302\u8F7D\u4E8E dsh host \u5185\u5B58\uFF08\u672C\u8FDB\u7A0B\u5185\u521B\u5EFA\u6216\u6253\u5F00\u8FC7\u7684\u4F1A\u8BDD\u4FDD\u6301\u5728\u7EBF\uFF0C\u4E0D\u4EE3\u8868\u6B63\u5728\u8FD0\u884C\uFF09\uFF1B\u53EF\u76F4\u63A5"\u5173\u505C\u5E76\u5220\u9664"\uFF08\u4F1A\u4E2D\u65AD\u8BE5\u4F1A\u8BDD\u6B63\u5728\u8FDB\u884C\u7684\u5BF9\u8BDD\uFF09');
}
var SESSION_RENDER_CAP = 400;
var FULLTEXT_RENDER_CAP = 200;
function sessionStatus(s) {
  if (s.live) return "live";
  if (s.archived) return "archived";
  return "ended";
}
var PINNED_SESSIONS_KEY = "dsh-plugin-admin/pinned-sessions";
function loadPinnedIds() {
  try {
    var raw = window.localStorage.getItem(PINNED_SESSIONS_KEY);
    var parsed = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(function(id) {
      return typeof id === "string";
    }) : [];
  } catch (e) {
    return [];
  }
}
function savePinnedIds(ids) {
  try {
    window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(ids));
  } catch (e) {
  }
}
var COLLAPSED_GROUPS_KEY = "dsh-plugin-admin/collapsed-groups";
function loadCollapsedGroups() {
  try {
    var raw = window.localStorage.getItem(COLLAPSED_GROUPS_KEY);
    var parsed = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(function(k) {
      return typeof k === "string";
    }) : [];
  } catch (e) {
    return [];
  }
}
function saveCollapsedGroups(keys) {
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(keys));
  } catch (e) {
  }
}
function formatTokenCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "0";
  if (n < 1e3) return String(n);
  if (n < 999950) return Math.round(n / 100) / 10 + "k";
  return Math.round(n / 1e5) / 10 + "M";
}
function formatUsageTag(tokens) {
  if (tokens === null || tokens === void 0 || typeof tokens !== "object") return null;
  var input = typeof tokens.input === "number" ? tokens.input : 0;
  var output = typeof tokens.output === "number" ? tokens.output : 0;
  var cacheRead = typeof tokens.cacheRead === "number" ? tokens.cacheRead : 0;
  if (input === 0 && output === 0) return null;
  var text = "\u2191" + formatTokenCount(input) + " \u2193" + formatTokenCount(output);
  if (cacheRead > 0) text += dshT(" \xB7 \u7F13\u5B58") + formatTokenCount(cacheRead);
  return text;
}
function usageDayKey(ms) {
  var d = new Date(ms);
  var m = String(d.getMonth() + 1);
  if (m.length < 2) m = "0" + m;
  var dd = String(d.getDate());
  if (dd.length < 2) dd = "0" + dd;
  return d.getFullYear() + "-" + m + "-" + dd;
}
function filterSessions(sessions, filter, needle, pinnedIds) {
  var result = [];
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (filter === "pinned") {
      if (!(pinnedIds && pinnedIds.indexOf(s.id) !== -1)) continue;
    } else if (filter !== "all" && sessionStatus(s) !== filter) continue;
    if (needle !== "") {
      var hay = ((s.title || "") + " " + (s.summary || "") + " " + (s.cwd || "") + " " + (s.workspaceTitle || "") + " " + s.id).toLowerCase();
      if (hay.indexOf(needle) === -1) continue;
    }
    result.push(s);
  }
  return result;
}
function buildSessionGroups(filtered, workspaceOrder) {
  var byWs = /* @__PURE__ */ new Map();
  for (var i = 0; i < workspaceOrder.length; i++) {
    var ws = workspaceOrder[i];
    byWs.set(ws.workspaceId, {
      workspaceId: ws.workspaceId,
      title: ws.title,
      path: ws.path,
      sessions: []
    });
  }
  var ungrouped = [];
  for (var j = 0; j < filtered.length; j++) {
    var s = filtered[j];
    var g = s.workspaceId ? byWs.get(s.workspaceId) : void 0;
    if (g !== void 0) g.sessions.push(s);
    else ungrouped.push(s);
  }
  var groups = [];
  for (var k = 0; k < workspaceOrder.length; k++) {
    var bucket = byWs.get(workspaceOrder[k].workspaceId);
    if (bucket !== void 0 && bucket.sessions.length > 0) groups.push(bucket);
  }
  if (ungrouped.length > 0) {
    groups.push({ workspaceId: null, title: dshT("\u672A\u5206\u7EC4"), path: null, sessions: ungrouped });
  }
  return groups;
}
function renderFulltextPanel(view, patch, runFulltext, enableSearch) {
  var h = createElement;
  var children = [];
  if (view.searchDisabled) {
    children.push(h(
      "div",
      { key: "disabled-banner", style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px", padding: "8px 11px", borderRadius: "8px", border: "1px solid rgba(217,119,6,0.35)", background: "rgba(217,119,6,0.08)", color: "#b45309", fontSize: "12px", lineHeight: 1.5 } },
      h(
        "span",
        { key: "t", style: { flex: "1 1 220px" } },
        view.searchEnableState === "pending" ? dshT("\u2705 \u5DF2\u5199\u5165 profile \u914D\u7F6E\uFF08\u6301\u4E45\u7D22\u5F15 + \u9996\u6B21\u641C\u7D22\u65F6\u6253\u5F00\uFF09\u2014 \u91CD\u542F dsh \u540E\u5168\u6587\u68C0\u7D22\u751F\u6548\u3002") : dshT("\u5168\u6587\u68C0\u7D22\u5728\u6B64\u90E8\u7F72\u4E2D\u9ED8\u8BA4\u5173\u95ED\uFF08\u5B98\u65B9 base \u914D\u7F6E openAt: never\uFF09\u3002\u4E00\u952E\u5199\u5165 profile \u8986\u76D6\u884C\uFF1A\u7D22\u5F15\u843D\u5728 $DSH_HOME \u4E0B\u3001\u9996\u6B21\u641C\u7D22\u65F6\u624D\u6253\u5F00\uFF0C\u4E0D\u62D6\u6162\u542F\u52A8\uFF1B\u5199\u5165\u540E\u9700\u91CD\u542F dsh\u3002")
      ),
      view.searchEnableState === null ? h(import_dsh_client_ui_primitives.Button, { key: "go", variant: "primary", size: "sm", onClick: enableSearch }, dshT("\u26A1 \u4E00\u952E\u542F\u7528")) : view.searchEnableState === "enabling" ? h("span", { key: "spin", className: "spinner" }) : null
    ));
  }
  children.push(h(
    "div",
    { key: "q", style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" } },
    h(import_dsh_client_ui_primitives.Input, {
      key: "in",
      placeholder: dshT("\u68C0\u7D22\u6240\u6709\u4F1A\u8BDD\u7684\u6D88\u606F\u5185\u5BB9\u2026\uFF08\u5982\u300C\u5408\u5E76\u63D2\u4EF6\u300D\u6216\u67D0\u4E2A\u6587\u4EF6\u540D\uFF09"),
      value: view.fullNeedle,
      onKeyDown: function(e) {
        if (e.key === "Enter") runFulltext(view.fullNeedle);
      },
      onChange: function(e) {
        patch({ fullNeedle: e.target.value });
      }
    }),
    h(
      import_dsh_client_ui_primitives.Button,
      { key: "go", variant: "primary", disabled: view.fullBusy || view.fullNeedle.trim() === "", onClick: function() {
        runFulltext(view.fullNeedle);
      } },
      view.fullBusy ? h("span", { className: "spinner" }) : dshT("\u641C\u7D22")
    )
  ));
  if (view.fullBusy) {
    children.push(h("div", { key: "b", className: "busy-banner" }, h("span", { className: "spinner" }), dshT("\u641C\u7D22\u4E2D\u2026")));
  } else if (Array.isArray(view.fullHits)) {
    if (view.fullHits.length === 0) {
      children.push(h("div", { key: "empty", className: "empty" }, dshT("\u6CA1\u6709\u547D\u4E2D\u4EFB\u4F55\u4F1A\u8BDD\u3002")));
    } else {
      children.push(h("div", { key: "count", className: "hint" }, dshT("\u547D\u4E2D ") + view.fullHits.length + dshT(" \u4E2A\u4F1A\u8BDD")));
      var fullRenderCap = Math.min(view.fullHits.length, FULLTEXT_RENDER_CAP);
      for (var i = 0; i < fullRenderCap; i++) {
        (function(hit) {
          var title = hit.title || (hit.cwd ? baseName(hit.cwd) : dshT("\u672A\u547D\u540D\u4F1A\u8BDD"));
          children.push(h(
            "div",
            { key: "hit-" + i, className: "card", style: { padding: "8px 12px", fontSize: "12px" } },
            h(
              "div",
              { key: "l1", style: { display: "flex", gap: "8px", alignItems: "center" } },
              h("span", { key: "t", style: { fontWeight: 600 } }, title),
              h("span", { key: "id", style: { color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: "10px" } }, String(hit.sessionId || "").slice(0, 18))
            ),
            hit.snippet ? h("div", { key: "s", style: { opacity: 0.75, marginTop: "3px", wordBreak: "break-word" } }, hit.snippet) : null
          ));
        })(view.fullHits[i]);
      }
      if (view.fullHits.length > fullRenderCap) {
        children.push(h(
          "div",
          { key: "hit-cap", className: "hint" },
          dshT("\u5DF2\u663E\u793A\u524D ") + fullRenderCap + " / " + view.fullHits.length + dshT(" \u6761\u547D\u4E2D")
        ));
      }
    }
  }
  return h("div", { key: "fulltext", className: "card", style: { padding: "10px" } }, children);
}
function buildGroupHeader(g, groupKey, collapsed, view, groupUi) {
  var isUngrouped = g.workspaceId === null;
  return createElement(
    "div",
    {
      className: "group-header" + (collapsed ? " collapsed" : ""),
      key: "header-" + groupKey,
      title: collapsed ? dshT("\u70B9\u51FB\u5C55\u5F00\u8BE5\u76EE\u5F55\u7684\u4F1A\u8BDD") : dshT("\u70B9\u51FB\u6298\u53E0\u8BE5\u76EE\u5F55\u7684\u4F1A\u8BDD"),
      role: "button",
      tabIndex: 0,
      onClick: function() {
        groupUi.toggleCollapse(groupKey);
      },
      onKeyDown: function(event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          groupUi.toggleCollapse(groupKey);
        }
      }
    },
    createElement("span", { className: "group-caret", key: "caret" }, collapsed ? "\u25B8" : "\u25BE"),
    createElement(
      "span",
      { className: "group-title", key: "title" },
      (isUngrouped ? "\u{1F4C2} " : "\u{1F4C1} ") + (g.title || dshT("\u672A\u547D\u540D"))
    ),
    createElement("span", { className: "group-count", key: "count" }, String(g.sessions.length) + dshT(" \u4E2A")),
    collapsed ? createElement("span", { className: "group-collapsed-note", key: "note" }, dshT("\u5DF2\u6298\u53E0")) : null,
    g.path !== null ? createElement("span", { className: "group-path", key: "path", title: g.path }, g.path) : null,
    createElement(import_dsh_client_ui_primitives.Button, {
      type: "button",
      key: "btn-bulk-group",
      variant: "outline",
      size: "sm",
      className: "group-action danger",
      title: dshT("\u5220\u9664\u8BE5\u76EE\u5F55\u4E0B\u7684\u5168\u90E8 ") + String(g.sessions.length) + dshT(" \u4E2A\u4F1A\u8BDD\uFF08\u5728\u7EBF\u4F1A\u8BDD\u4F1A\u5148\u5173\u505C\uFF09"),
      disabled: view.bulkBusy,
      onClick: function(e) {
        e.stopPropagation();
        groupUi.requestBulk("group", groupKey);
      }
    }, dshT("\u{1F5D1} \u6574\u4E2A\u76EE\u5F55"))
  );
}
function renderSessionsView(view, patch, reload, act, onExport, pinnedIds, togglePinned, runFulltext, loadHealth, enableSearch, groupUi) {
  var elements = [];
  elements.push(createElement(
    "div",
    { className: "toolbar", key: "toolbar" },
    createElement(
      "div",
      { className: "search-wrap session-search", key: "wrap" },
      createElement("span", { className: "search-icon", key: "icon" }, "\u{1F50D}"),
      createElement(import_dsh_client_ui_primitives.Input, {
        placeholder: dshT("\u641C\u7D22\u6807\u9898\u3001\u5185\u5BB9\u6458\u8981\u3001\u76EE\u5F55\u6216 Session ID..."),
        // 只有 placeholder 不算可访问名称（读屏与无 placeholder 的渲染都拿不到），
        // 技能页的搜索框一直带 aria-label，这里补齐同一契约。
        "aria-label": dshT("\u641C\u7D22\u4F1A\u8BDD"),
        value: view.needle,
        onChange: function(e) {
          patch({ needle: e.target.value });
        }
      }),
      view.needle !== "" ? createElement(import_dsh_client_ui_primitives.Button, {
        key: "btn-clear-search",
        variant: "toolbar",
        size: "sm",
        title: dshT("\u6E05\u7A7A\u641C\u7D22"),
        onClick: function() {
          patch({ needle: "" });
        }
      }, "\u2715") : null
    ),
    createElement(
      import_dsh_client_ui_primitives.Button,
      {
        type: "button",
        key: "btn-refresh",
        variant: "outline",
        disabled: view.busy,
        onClick: reload
      },
      view.busy ? createElement("span", { className: "spinner", key: "spin" }) : null,
      dshT("\u{1F504} \u5237\u65B0")
    ),
    createElement(import_dsh_client_ui_primitives.Button, {
      variant: "outline",
      className: view.fulltext ? " pin-active" : "",
      title: dshT("\u8DE8\u5168\u90E8\u4F1A\u8BDD\u7684\u5168\u6587\u641C\u7D22\uFF08\u6309\u6D88\u606F\u5185\u5BB9\u68C0\u7D22\uFF09"),
      onClick: function() {
        patch({ fulltext: !view.fulltext });
        if (!view.fulltext && view.fullNeedle !== "") runFulltext(view.fullNeedle);
      }
    }, dshT("\u{1F50E} \u5168\u6587\u641C\u7D22"))
  ));
  if (view.fulltext) {
    elements.push(renderFulltextPanel(view, patch, runFulltext, enableSearch));
  }
  var needle = view.needle.trim().toLowerCase();
  var filtered = filterSessions(view.sessions, view.filter, needle, pinnedIds);
  var groups = buildSessionGroups(filtered, view.workspaces || []);
  var groupKeys = [];
  for (var gk = 0; gk < groups.length; gk++) {
    groupKeys.push(groups[gk].workspaceId === null ? "ungrouped" : "ws-" + groups[gk].workspaceId);
  }
  var allCollapsed = groupKeys.length > 0;
  for (var gc = 0; gc < groupKeys.length; gc++) {
    if (groupUi.collapsed.indexOf(groupKeys[gc]) === -1) {
      allCollapsed = false;
      break;
    }
  }
  var totalSessions = view.sessions.length;
  var liveCount = 0;
  var archivedCount = 0;
  var endedCount = 0;
  for (var i = 0; i < view.sessions.length; i++) {
    var s = view.sessions[i];
    var st = sessionStatus(s);
    if (st === "live") liveCount++;
    else if (st === "archived") archivedCount++;
    else endedCount++;
  }
  elements.push(createElement(
    "div",
    { className: "filter-bar", key: "filters" },
    createElement(import_dsh_client_ui_primitives.Pill, {
      key: "filter-all",
      active: view.filter === "all",
      onClick: function() {
        patch({ filter: "all" });
      }
    }, dshT("\u5168\u90E8(") + String(totalSessions) + ")"),
    createElement(import_dsh_client_ui_primitives.Pill, {
      key: "filter-live",
      active: view.filter === "live",
      title: liveHint(),
      onClick: function() {
        patch({ filter: "live" });
      }
    }, dshT("\u5728\u7EBF(") + String(liveCount) + ")"),
    createElement(import_dsh_client_ui_primitives.Pill, {
      key: "filter-archived",
      active: view.filter === "archived",
      onClick: function() {
        patch({ filter: "archived" });
      }
    }, dshT("\u5DF2\u5F52\u6863(") + String(archivedCount) + ")"),
    createElement(import_dsh_client_ui_primitives.Pill, {
      key: "filter-ended",
      active: view.filter === "ended",
      onClick: function() {
        patch({ filter: "ended" });
      }
    }, dshT("\u5DF2\u7ED3\u675F(") + String(endedCount) + ")"),
    createElement(import_dsh_client_ui_primitives.Pill, {
      key: "filter-pinned",
      active: view.filter === "pinned",
      title: dshT("\u53EA\u663E\u793A\u5DF2\u7F6E\u9876\u7684\u4F1A\u8BDD"),
      onClick: function() {
        patch({ filter: "pinned" });
      }
    }, dshT("\u5DF2\u7F6E\u9876(") + String(pinnedIds.length) + ")"),
    // Tail actions (a single flex item so the wrap never splits them): fold
    // every directory at once, and one-click delete of the current projection.
    groupKeys.length > 0 || filtered.length > 0 ? createElement(
      "div",
      { className: "filter-actions", key: "actions" },
      groupKeys.length > 0 ? createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        title: allCollapsed ? dshT("\u5C55\u5F00\u5168\u90E8\u76EE\u5F55") : dshT("\u6298\u53E0\u5168\u90E8\u76EE\u5F55"),
        onClick: function() {
          groupUi.collapseAll(allCollapsed ? [] : groupKeys);
        }
      }, allCollapsed ? dshT("\u25BE \u5168\u90E8\u5C55\u5F00") : dshT("\u25B4 \u5168\u90E8\u6298\u53E0")) : null,
      filtered.length > 0 ? createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        className: "danger",
        title: dshT("\u5220\u9664\u5F53\u524D\u7B5B\u9009\u4E0B\u7684\u5168\u90E8 ") + String(filtered.length) + dshT(" \u4E2A\u4F1A\u8BDD\uFF08\u5728\u7EBF\u4F1A\u8BDD\u4F1A\u5148\u5173\u505C\uFF09"),
        disabled: view.bulkBusy,
        onClick: function() {
          groupUi.requestBulk("all", null);
        }
      }, dshT("\u{1F5D1} \u5220\u9664\u5F53\u524D (") + String(filtered.length) + ")") : null
    ) : null
  ));
  if (view.bulk !== null && view.bulk !== void 0) {
    var bulk = view.bulk;
    var bulkScope = bulk.scope === "group" ? dshT("\u76EE\u5F55\u300C") + (bulk.label || dshT("\u672A\u547D\u540D")) + "\u300D" : dshT("\u5F53\u524D\u7B5B\u9009");
    elements.push(createElement(
      "div",
      { className: "bulk-bar", key: "bulk-bar" },
      createElement(
        "span",
        { className: "bulk-text", key: "t" },
        view.bulkBusy ? dshT("\u5220\u9664\u4E2D ") + String(view.bulkDone) + " / " + String(bulk.plan.length) + "\u2026" : dshT("\u786E\u8BA4\u5220\u9664 ") + bulkScope + dshT("\u7684 ") + String(bulk.plan.length) + dshT(" \u4E2A\u4F1A\u8BDD\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500")
      ),
      createElement(
        "div",
        { className: "bulk-actions", key: "a" },
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          className: "danger-solid",
          disabled: view.bulkBusy,
          onClick: groupUi.confirmBulk
        }, dshT("\u786E\u8BA4\u5220\u9664")),
        createElement(import_dsh_client_ui_primitives.Button, {
          variant: "outline",
          size: "sm",
          disabled: view.bulkBusy,
          onClick: groupUi.cancelBulk
        }, dshT("\u53D6\u6D88"))
      )
    ));
  }
  var totals = { input: 0, output: 0, cacheRead: 0, sessions: 0 };
  for (var ui = 0; ui < view.sessions.length; ui++) {
    var ut = view.sessions[ui].tokens;
    if (ut && (ut.input > 0 || ut.output > 0)) {
      totals.input += ut.input || 0;
      totals.output += ut.output || 0;
      totals.cacheRead += ut.cacheRead || 0;
      totals.sessions++;
    }
  }
  if (totals.sessions > 0) {
    elements.push(createElement(
      "div",
      { className: "usage-strip", key: "usage" },
      createElement("span", { className: "usage-num" }, "\u03A3 " + String(totals.sessions) + dshT(" \u4E2A\u4F1A\u8BDD")),
      createElement("span", null, dshT("\u8F93\u5165 ") + formatTokenCount(totals.input)),
      createElement("span", null, dshT("\u8F93\u51FA ") + formatTokenCount(totals.output)),
      totals.cacheRead > 0 ? createElement("span", null, dshT("\u7F13\u5B58\u8BFB ") + formatTokenCount(totals.cacheRead)) : null
    ));
  }
  if (view.error !== "") {
    elements.push(createElement("div", { className: "error", key: "error" }, view.error));
  }
  var rows = [];
  var renderBudget = SESSION_RENDER_CAP;
  var renderedCards = 0;
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    var groupKey = g.workspaceId === null ? "ungrouped" : "ws-" + g.workspaceId;
    var collapsed = groupUi.collapsed.indexOf(groupKey) !== -1;
    rows.push(buildGroupHeader(g, groupKey, collapsed, view, groupUi));
    if (collapsed) continue;
    for (var si = 0; si < g.sessions.length; si++) {
      if (renderBudget <= 0) break;
      renderBudget -= 1;
      renderedCards += 1;
      rows.push(renderSessionCard(g.sessions[si], view, act, patch, onExport, pinnedIds, togglePinned, loadHealth));
    }
    if (renderBudget <= 0) break;
  }
  if (renderedCards < filtered.length) {
    rows.push(createElement(
      "div",
      { className: "hint", key: "render-cap" },
      dshT("\u5DF2\u663E\u793A\u524D ") + renderedCards + " / " + filtered.length + dshT(" \u4E2A\u4F1A\u8BDD\u2014\u2014\u7528\u8FC7\u6EE4\u6761\u4EF6\u7F29\u5C0F\u8303\u56F4\u67E5\u770B\u5176\u4F59")
    ));
  }
  if (rows.length === 0) {
    rows.push(createElement(
      "div",
      { className: "empty", key: "empty" },
      createElement("div", null, needle !== "" ? dshT("\u{1F50D} \u65E0\u5339\u914D\u7684\u4F1A\u8BDD\u5185\u5BB9") : dshT("\u{1F4AC} \u6CA1\u6709\u5DF2\u6301\u4E45\u5316\u7684\u4F1A\u8BDD"))
    ));
  }
  elements.push(createElement("div", { className: "list", key: "list" }, rows));
  var summaryText = view.busy ? dshT("\u52A0\u8F7D\u4E2D...") : dshT("\u5171 ") + String(totalSessions) + dshT(" \u4E2A\u4F1A\u8BDD\uFF0C\u5F53\u524D\u5C55\u793A ") + String(filtered.length) + dshT(" \u4E2A");
  elements.push(createElement(
    "div",
    { className: "footer", key: "footer" },
    createElement("span", { key: "summary" }, summaryText),
    createElement("span", { className: "hint", key: "hint" }, dshT("\u4F1A\u8BDD\u4FEE\u6539\u5373\u65F6\u540C\u6B65\u5230\u4FA7\u8FB9\u680F"))
  ));
  return createElement("div", { key: "sessions-panel", className: "session-panel" }, elements);
}
function renderHealthReportCard(sessionId, health) {
  if (health.loading) {
    return createElement(
      "div",
      { key: "health-" + sessionId, className: "card-sub", style: { marginTop: "4px" } },
      createElement("span", { className: "spinner" }),
      dshT(" \u6B63\u5728\u751F\u6210\u4F53\u68C0\u62A5\u544A\u2026")
    );
  }
  if (health.error) {
    return createElement("div", { key: "health-" + sessionId, className: "error", style: { marginTop: "4px" } }, dshT("\u4F53\u68C0\u5931\u8D25\uFF1A") + health.error);
  }
  var r = health.report || {};
  var summary = health.summary || "";
  var rows = [];
  if (Array.isArray(r.tools) && r.tools.length > 0) {
    for (var ti = 0; ti < r.tools.length; ti++) {
      (function(tool) {
        var code = tool.errorCodes && tool.errorCodes.length > 0 ? " \xB7 " + tool.errorCodes.map(function(ec) {
          return ec.code + "\xD7" + ec.count;
        }).join(" ") : "";
        rows.push(createElement(
          "div",
          { key: "t" + tool.name, className: "card-sub-item", style: { marginRight: "10px" } },
          createElement("span", { style: { fontFamily: "monospace" } }, tool.name),
          createElement("span", { style: { color: "var(--dsw-alias-label-secondary, #61666b)" } }, " \xD7" + tool.calls + (tool.errors > 0 ? " \xB7 \u274C" + tool.errors : "")),
          tool.errors > 0 ? createElement("span", { style: { color: "#dc2626", fontSize: "11px" } }, code) : null
        ));
      })(r.tools[ti]);
    }
  }
  var extra = [];
  if (r.abortedTurns > 0) extra.push(createElement("span", { key: "ab", style: { color: "#d97706" } }, r.abortedTurns + dshT(" \u4E2D\u65AD")));
  if (r.errorTurns > 0) extra.push(createElement("span", { key: "er", style: { color: "#dc2626" } }, r.errorTurns + dshT(" \u51FA\u9519")));
  if (r.retryCount > 0) extra.push(createElement("span", { key: "rt" }, r.retryCount + dshT(" \u6B21\u91CD\u8BD5")));
  if (r.compactions > 0) extra.push(createElement("span", { key: "cp" }, r.compactions + dshT(" \u6B21\u538B\u7F29")));
  return createElement(
    "div",
    { key: "health-" + sessionId, className: "card", style: { marginTop: "4px", padding: "8px 10px" } },
    createElement(
      "div",
      { key: "head", className: "card-sub-item", style: { fontWeight: 600, marginBottom: "4px" } },
      "\u{1FA7A} " + (summary || dshT("\u4F1A\u8BDD\u4F53\u68C0")),
      extra.length > 0 ? createElement("span", { key: "ex" }, " \xB7 ", extra) : null
    ),
    rows.length > 0 ? createElement("div", { key: "tools", className: "card-sub", style: { flexDirection: "row", flexWrap: "wrap" } }, rows) : null,
    Array.isArray(r.topErrors) && r.topErrors.length > 0 ? createElement(
      "div",
      { key: "errs", className: "card-sub-item", style: { fontSize: "11px", color: "#dc2626", marginTop: "2px" } },
      dshT("\u4E3B\u8981\u9519\u8BEF\uFF1A"),
      r.topErrors.map(function(e) {
        return e.name + ":" + e.code + "\xD7" + e.count;
      }).join("  ")
    ) : null
  );
}
function renderSessionCard(session, view, act, patch, onExport, pinnedIds, togglePinned, loadHealth) {
  var health = view.healthBySession && view.healthBySession[session.id] || null;
  var isConfirming = view.confirming === session.id;
  var dotClass = "dot" + (session.live ? " live" : session.archived ? " archived" : "");
  var dotTitle = session.live ? liveHint() : session.archived ? dshT("\u5DF2\u5F52\u6863") : dshT("\u5DF2\u7ED3\u675F");
  var isPinned = pinnedIds ? pinnedIds.indexOf(session.id) !== -1 : false;
  var actions = [];
  if (!isConfirming) {
    actions.push(createElement(import_dsh_client_ui_primitives.Button, {
      type: "button",
      variant: "outline",
      size: "sm",
      className: isPinned ? " pin-active" : "",
      key: "btn-pin",
      title: isPinned ? dshT("\u53D6\u6D88\u7F6E\u9876") : dshT("\u7F6E\u9876\u8BE5\u4F1A\u8BDD\uFF08\u672C\u5730\u6536\u85CF\uFF0C\u968F\u65F6\u53EF\u5728\u300C\u{1F4CC} \u5DF2\u7F6E\u9876\u300D\u7B5B\u9009\u4E2D\u627E\u5230\uFF09"),
      onClick: function() {
        if (typeof togglePinned === "function") togglePinned(session.id);
      }
    }, isPinned ? dshT("\u{1F4CC} \u5DF2\u7F6E\u9876") : dshT("\u{1F4CC} \u7F6E\u9876")));
    actions.push(
      createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        variant: "outline",
        size: "sm",
        key: "btn-export",
        title: dshT("\u5BFC\u51FA\u4E3A Markdown \u5BF9\u8BDD\u7A3F\uFF08.md \u4E0B\u8F7D\uFF09"),
        onClick: function() {
          if (typeof onExport === "function") onExport(session);
        }
      }, dshT("\u2B07 \u5BFC\u51FA")),
      createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        variant: "outline",
        size: "sm",
        key: "btn-health",
        title: dshT("\u4F1A\u8BDD\u4F53\u68C0\uFF1A\u5DE5\u5177\u8C03\u7528/\u9519\u8BEF/\u4E2D\u65AD/\u91CD\u8BD5\u7EDF\u8BA1"),
        onClick: function() {
          if (typeof loadHealth === "function") loadHealth(session.id);
        }
      }, dshT("\u{1FA7A} \u4F53\u68C0"))
    );
    if (!session.archived && !session.live) {
      actions.push(createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        variant: "outline",
        size: "sm",
        key: "btn-archive",
        disabled: view.busy,
        onClick: function() {
          act("archive", session.id);
        }
      }, dshT("\u5F52\u6863")));
    }
    if (session.archived) {
      actions.push(createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        variant: "outline",
        size: "sm",
        key: "btn-unarchive",
        disabled: view.busy,
        onClick: function() {
          act("unarchive", session.id);
        }
      }, dshT("\u53D6\u6D88\u5F52\u6863")));
    }
    if (!session.live) {
      actions.push(createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        variant: "outline",
        size: "sm",
        className: "danger",
        key: "btn-delete",
        disabled: view.busy,
        onClick: function() {
          patch({ confirming: session.id });
        }
      }, dshT("\u5220\u9664")));
    } else {
      actions.push(createElement(import_dsh_client_ui_primitives.Button, {
        type: "button",
        variant: "outline",
        size: "sm",
        className: "danger",
        key: "btn-close",
        disabled: view.busy,
        title: dshT("\u5173\u505C\u8BE5\u5728\u7EBF\u4F1A\u8BDD\uFF08\u505C\u6B62\u5176 agent \u8FD0\u884C\uFF09\u5E76\u6C38\u4E45\u5220\u9664\u65E5\u5FD7\u8BB0\u5F55"),
        onClick: function() {
          patch({ confirming: session.id });
        }
      }, dshT("\u5173\u505C\u5E76\u5220\u9664")));
    }
  }
  var titleChildren = [
    createElement("span", { className: dotClass, title: dotTitle, key: "dot" }),
    createElement(
      "div",
      { className: "card-title", key: "title" },
      createElement(
        "span",
        { className: "card-title-text", key: "name", title: session.title || session.cwd },
        session.title || (session.cwd ? baseName(session.cwd) : dshT("\u672A\u547D\u540D\u4F1A\u8BDD"))
      ),
      session.live ? createElement("span", { className: "tag live", key: "tag-live", title: liveHint() }, dshT("\u4F1A\u8BDD\u5728\u7EBF")) : session.archived ? createElement("span", { className: "tag archived", key: "tag-archived" }, dshT("\u5DF2\u5F52\u6863")) : null,
      session.messageCount > 0 ? createElement("span", { className: "tag turns", key: "tag-turns" }, String(session.messageCount) + dshT(" \u6761\u6D88\u606F")) : null,
      createElement("span", {
        className: "tag turns",
        key: "tag-tokens",
        title: dshT("\u672C\u6B21\u4F1A\u8BDD token \u7528\u91CF\uFF08\u8F93\u5165 / \u8F93\u51FA / \u7F13\u5B58\u8BFB\uFF09\u2014\u2014\u6765\u81EA\u6A21\u578B\u9002\u914D\u5668\u4E0A\u62A5\u7684 usage \u6298\u53E0")
      }, formatUsageTag(session.tokens)),
      isPinned ? createElement("span", { className: "tag live", key: "tag-pin", title: dshT("\u5DF2\u7F6E\u9876") }, "\u{1F4CC}") : null
    )
  ];
  var headerChildren;
  if (actions.length > 0) {
    headerChildren = titleChildren.concat([createElement("div", { className: "card-actions", key: "actions" }, actions)]);
  } else {
    headerChildren = titleChildren;
  }
  var header = createElement("div", { className: "card-header", key: "header" }, headerChildren);
  var cardChildren = [header];
  if (session.summary) {
    cardChildren.push(createElement(
      "div",
      { className: "card-summary", key: "summary", title: session.summary },
      createElement("span", { className: "summary-icon", key: "icon" }, "\u{1F4AC}"),
      createElement("span", { className: "summary-text", key: "text" }, session.summary)
    ));
  } else if (session.summaryError) {
    cardChildren.push(createElement(
      "div",
      { className: "error", key: "summary-error" },
      dshT("\u6458\u8981\u8BFB\u53D6\u5931\u8D25\uFF1A") + session.summaryError
    ));
  }
  var subChildren = [
    createElement(
      "span",
      { className: "card-sub-item", title: session.cwd || dshT("\u65E0\u5DE5\u4F5C\u76EE\u5F55"), key: "path" },
      "\u{1F4C1} " + (session.cwd ? baseName(session.cwd) + " (" + session.cwd + ")" : dshT("\uFF08\u65E0\u5DE5\u4F5C\u76EE\u5F55\uFF09"))
    ),
    createElement("span", { key: "sep1" }, "\xB7"),
    createElement("span", { className: "card-sub-item", key: "time" }, "\u{1F552} " + formatDate(session.createdAt))
  ];
  if (session.id) {
    subChildren.push(createElement("span", { key: "sep2" }, "\xB7"));
    subChildren.push(createElement(
      "span",
      { className: "card-sub-item session-id-badge", key: "id", title: dshT("\u4F1A\u8BDD ID: ") + session.id },
      "\u{1F194} " + session.id.slice(0, 8)
    ));
  }
  var sub = createElement("div", { className: "card-sub", key: "sub" }, subChildren);
  cardChildren.push(sub);
  if (health !== null) {
    cardChildren.push(renderHealthReportCard(session.id, health));
  }
  if (isConfirming) {
    cardChildren.push(createElement(
      "div",
      { className: "confirm-bar", key: "confirm" },
      createElement(
        "span",
        { className: "confirm-text", key: "text" },
        session.live ? dshT("\u26A0\uFE0F \u5C06\u5173\u505C\u8BE5\u5728\u7EBF\u4F1A\u8BDD\uFF08\u6B63\u5728\u8FD0\u884C\u5219\u4F1A\u4E2D\u65AD\uFF09\u5E76\u6C38\u4E45\u5220\u9664\u8BB0\u5F55\u4E0E\u65E5\u5FD7\uFF0C\u786E\u5B9A\uFF1F") : dshT("\u26A0\uFE0F \u786E\u5B9A\u6C38\u4E45\u5220\u9664\u8BE5\u4F1A\u8BDD\u8BB0\u5F55\u53CA\u65E5\u5FD7\u6587\u4EF6\uFF1F")
      ),
      createElement(
        "div",
        { className: "confirm-actions", key: "actions" },
        createElement(import_dsh_client_ui_primitives.Button, {
          type: "button",
          key: "btn-confirm",
          variant: "outline",
          size: "sm",
          className: "danger-solid",
          disabled: view.busy,
          onClick: function() {
            act(session.live ? "closeSession" : "deleteSession", session.id);
          }
        }, dshT("\u786E\u8BA4\u5220\u9664")),
        createElement(import_dsh_client_ui_primitives.Button, {
          type: "button",
          key: "btn-cancel",
          variant: "outline",
          size: "sm",
          disabled: view.busy,
          onClick: function() {
            patch({ confirming: null });
          }
        }, dshT("\u53D6\u6D88"))
      )
    ));
  }
  return createElement("div", { key: session.id, className: "card" }, cardChildren);
}

// src/client/panels/skills.js
var SKILLS_RENDER_CAP = 400;
function SkillsSection(props) {
  var call = props.call;
  var kit = sectionState({
    available: true,
    complete: true,
    skills: [],
    scopes: [],
    sessions: [],
    warnings: [],
    busy: false,
    error: "",
    needle: "",
    copiedName: ""
  });
  var state = kit.state;
  var alive = kit.alive;
  function patch(partial) {
    kit.patch(partial);
  }
  function loadRoster() {
    var sessionIds = call("sessionAdmin/list", {}).then(function(result) {
      if (!(result && result.ok)) {
        return { ids: [], note: dshT("\u4F1A\u8BDD\u5217\u8868\u4E0D\u53EF\u7528\uFF08") + messageOf(result && result.error) + dshT("\uFF09\u2014 \u4EC5\u663E\u793A\u5168\u5C40\u6280\u80FD") };
      }
      var sessions = result.value && Array.isArray(result.value.sessions) ? result.value.sessions : [];
      var ordered = sessions.slice().sort(function(left, right) {
        return (left.archived === true ? 1 : 0) - (right.archived === true ? 1 : 0);
      });
      var ids = [];
      for (var i = 0; i < ordered.length; i++) {
        var id = ordered[i].sessionId || ordered[i].id || "";
        if (id !== "" && ids.indexOf(id) === -1) ids.push(id);
      }
      return { ids, note: "" };
    }, function(err) {
      return { ids: [], note: dshT("\u4F1A\u8BDD\u5217\u8868\u4E0D\u53EF\u7528\uFF08") + messageOf(err) + dshT("\uFF09\u2014 \u4EC5\u663E\u793A\u5168\u5C40\u6280\u80FD") };
    });
    return sessionIds.then(function(list) {
      return call("skillsAdmin/list", { sessionIds: list.ids }).then(function(skillsResult) {
        if (!(skillsResult && skillsResult.ok)) throw new Error(messageOf(skillsResult && skillsResult.error));
        var value = skillsResult.value || {};
        var warnings = Array.isArray(value.warnings) ? value.warnings.slice() : [];
        if (list.note !== "") warnings.unshift(list.note);
        return {
          available: value.available !== false,
          complete: value.complete !== false,
          skills: Array.isArray(value.skills) ? value.skills : [],
          scopes: Array.isArray(value.scopes) ? value.scopes : [],
          sessions: Array.isArray(value.sessions) ? value.sessions : [],
          warnings
        };
      });
    });
  }
  function reload() {
    patch({ busy: true, error: "" });
    loadRoster().then(function(payload) {
      if (!alive.current) return;
      patch({
        busy: false,
        error: "",
        available: payload.available,
        complete: payload.complete,
        skills: payload.skills,
        scopes: payload.scopes,
        sessions: payload.sessions,
        warnings: payload.warnings
      });
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u52A0\u8F7D\u6280\u80FD\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  kit.mount(reload);
  function copySlashName(name) {
    copyTextSilently("/" + name).then(function() {
      if (!alive.current) return;
      patch({ copiedName: name });
      setTimeout(function() {
        if (!alive.current) return;
        patch({ copiedName: "" });
      }, 1500);
    }, function(err) {
      if (!alive.current) return;
      showToast("error", dshT("\u274C \u590D\u5236\u5931\u8D25\uFF1A") + messageOf(err) + dshT("\uFF08\u53EF\u624B\u52A8\u590D\u5236 /") + name + dshT("\uFF09"));
    });
  }
  function openPath(path) {
    if (!path) return;
    call("fsAdmin/reveal", { path }).then(function(result) {
      if (!(result && result.ok)) showToast("error", dshT("\u274C \u6253\u5F00\u5931\u8D25\uFF1A") + messageOf(result && result.error));
    }, function(err) {
      showToast("error", dshT("\u274C \u6253\u5F00\u5931\u8D25\uFF1A") + messageOf(err));
    });
  }
  if (!state.available) {
    return createElement(
      "div",
      { "data-dsh-admin-section": "" },
      createElement(
        "div",
        { className: "group-header", key: "unavail" },
        createElement("span", { className: "group-title", key: "t" }, dshT("\u{1F4DA} \u6280\u80FD")),
        createElement("span", { className: "group-count", key: "c" }, dshT("\u672C\u90E8\u7F72\u672A\u6302\u8F7D @deepseek-ai/dsh-skill\uFF08\u6280\u80FD\u6CE8\u518C\u8868\u4E0D\u53EF\u7528\uFF09"))
      )
    );
  }
  var elements = [];
  if (state.busy) {
    elements.push(createElement(
      "div",
      { className: "busy-banner", key: "busy" },
      createElement("span", { className: "spinner", key: "sp" }),
      dshT("\u52A0\u8F7D\u6280\u80FD\u6E05\u5355\u2026")
    ));
  }
  if (state.error !== "") {
    elements.push(createElement("div", { className: "error", key: "err" }, state.error));
  }
  for (var wi = 0; wi < state.warnings.length; wi++) {
    elements.push(createElement("div", { className: "hint", key: "warn-" + wi, style: { fontSize: "11px" } }, "\u26A0 " + state.warnings[wi]));
  }
  var unresolvedSessions = state.sessions.filter(function(s) {
    return s.ok !== true;
  });
  for (var us = 0; us < unresolvedSessions.length; us++) {
    elements.push(createElement(
      "div",
      { className: "hint", key: "scope-fail-" + us, style: { fontSize: "11px" } },
      unresolvedSessionText(unresolvedSessions[us])
    ));
  }
  var scopeShortByLabel = {};
  for (var ssl = 0; ssl < state.scopes.length; ssl++) {
    scopeShortByLabel[state.scopes[ssl].label] = state.scopes[ssl].short !== void 0 ? state.scopes[ssl].short : state.scopes[ssl].label;
  }
  var needle = state.needle.trim().toLowerCase();
  var filtered = state.skills.filter(function(skill) {
    if (needle === "") return true;
    var haystack = [skill.name, skill.description, skill.whenToUse, skill.path, skill.url].join(" ").toLowerCase();
    return haystack.indexOf(needle) !== -1;
  });
  elements.push(createElement(
    "div",
    { className: "toolbar", key: "toolbar" },
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "refresh", disabled: state.busy, onClick: reload }, dshT("\u27F3 \u5237\u65B0")),
    createElement(
      "div",
      { className: "search-wrap", key: "search" },
      createElement("span", { className: "search-icon", key: "icon" }, "\u{1F50E}"),
      createElement(import_dsh_client_ui_primitives.Input, {
        placeholder: dshT("\u6309\u540D\u79F0 / \u63CF\u8FF0 / \u8DEF\u5F84\u8FC7\u6EE4\u2026"),
        value: state.needle,
        "aria-label": dshT("\u8FC7\u6EE4\u6280\u80FD"),
        onChange: function(e) {
          patch({ needle: e.target.value });
        }
      })
    )
  ));
  var presetScopes = state.scopes.filter(function(s) {
    return s.kind === "preset";
  });
  var sessionScopes = state.scopes.filter(function(s) {
    return s.kind !== "global" && s.kind !== "preset";
  });
  function unresolvedSessionText(session) {
    return dshT("\u26A0 \u4F1A\u8BDD ") + session.sessionId + dshT(" \u7684\u4F5C\u7528\u57DF\u672A\u80FD\u89E3\u6790\uFF1A") + session.message;
  }
  var summaryText = dshT("\u{1F4CC} \u5171 ") + state.skills.length + dshT(" \u4E2A\u6280\u80FD") + (filtered.length === state.skills.length ? "" : dshT(" \xB7 \u5F53\u524D\u5339\u914D ") + filtered.length + dshT(" \u4E2A"));
  elements.push(createElement("div", { className: "hint", key: "summary" }, summaryText));
  var cardNodes = [];
  for (let ci = 0; ci < filtered.length && ci < SKILLS_RENDER_CAP; ci++) {
    const skill = filtered[ci];
    var headerChildren = [
      createElement("span", { className: "card-title-text", key: "name", title: "/" + skill.name }, "/" + skill.name),
      skill.modelInvocable ? createElement("span", { className: "tag plugin", key: "model", title: dshT("\u6A21\u578B\u53EF\u4E3B\u52A8\u8C03\u7528\uFF08skill \u5DE5\u5177\uFF09") }, dshT("\u{1F916} \u6A21\u578B\u53EF\u8C03\u7528")) : null,
      skill.userInvocable ? createElement("span", { className: "tag", key: "user", title: dshT("\u4EBA\u7C7B\u53EF\u5728 composer \u7528 /name \u8C03\u7528") }, dshT("\u{1F464} \u4EBA\u7C7B\u53EF\u8C03\u7528")) : null,
      !skill.modelInvocable && !skill.userInvocable ? createElement("span", { className: "tag archived", key: "none", title: dshT("\u8BE5\u6280\u80FD\u5F53\u524D\u4E0D\u66B4\u9732\u7ED9\u4EFB\u4F55\u8C03\u7528\u65B9") }, dshT("\u672A\u66B4\u9732")) : null,
      createElement("span", { className: "tag", key: "src", title: "dsh-skill source\uFF1A" + (Array.isArray(skill.sources) ? skill.sources.join(" / ") : skill.source) }, skillsSourceLabel(skill.source)),
      state.copiedName === skill.name ? createElement("span", { className: "tag live", key: "copied", style: { marginLeft: "4px" } }, dshT("\u2713 \u5DF2\u590D\u5236")) : null
    ];
    var actionChildren = [
      createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        key: "btn-copy",
        title: dshT("\u590D\u5236 /") + skill.name + dshT(" \u5230\u526A\u8D34\u677F\uFF08\u5728 composer \u76F4\u63A5\u7C98\u8D34\u5373\u53EF\u8C03\u7528\uFF09"),
        onClick: function() {
          copySlashName(skill.name);
        }
      }, dshT("\u{1F4CB} \u590D\u5236 /name"))
    ];
    if (skill.path) {
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, {
        variant: "outline",
        size: "sm",
        key: "btn-open",
        title: dshT("\u5728\u7CFB\u7EDF\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u6253\u5F00 SKILL.md \u6240\u5728\u76EE\u5F55\uFF08") + skill.path + dshT("\uFF09"),
        onClick: function() {
          openPath(skill.path);
        }
      }, dshT("\u{1F4C2} \u6253\u5F00\u76EE\u5F55")));
    }
    var subChildren = [];
    if (skill.description) {
      subChildren.push(createElement("div", { key: "desc", className: "card-sub" }, skill.description));
    }
    if (skill.whenToUse) {
      subChildren.push(createElement("div", { key: "whe", className: "card-sub", style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" } }, dshT("\u4F55\u65F6\u7528\uFF1A") + skill.whenToUse));
    }
    if (skill.path) {
      subChildren.push(createElement(
        "div",
        { className: "card-sub", key: "path" },
        createElement("span", { className: "group-path", style: { fontFamily: "monospace" }, title: skill.path }, skill.path)
      ));
    }
    if (skill.url) {
      var safeUrl = /^https?:\/\//i.test(skill.url) ? skill.url : null;
      subChildren.push(createElement(
        "div",
        { className: "card-sub", key: "url" },
        safeUrl !== null ? createElement("a", { href: safeUrl, target: "_blank", rel: "noreferrer", className: "group-path" }, skill.url) : createElement("span", { className: "group-path" }, skill.url)
      ));
    }
    var seenIn = Array.isArray(skill.scopes) ? skill.scopes : [];
    subChildren.push(createElement(
      "div",
      { key: "scopes", className: "card-sub", style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" } },
      dshT("\u53EF\u89C1\u4E8E\uFF1A") + seenIn.map(function(label) {
        return scopeShortByLabel[label] || label;
      }).join(dshT("\u3001")) + (skill.provider ? " \xB7 provider: " + skill.provider : "")
    ));
    cardNodes.push(createElement(
      "div",
      { className: "card", key: "skill-" + skill.name },
      createElement(
        "div",
        { className: "card-header", key: "h" },
        createElement("span", { className: "card-title", key: "title-row" }, headerChildren),
        createElement("span", { className: "card-actions", key: "a" }, actionChildren)
      ),
      subChildren.length > 0 ? createElement("div", { key: "body" }, subChildren) : null
    ));
  }
  if (filtered.length > SKILLS_RENDER_CAP) {
    cardNodes.push(createElement(
      "div",
      { className: "hint", key: "skills-cap" },
      dshT("\u5DF2\u663E\u793A\u524D ") + SKILLS_RENDER_CAP + " / " + filtered.length + dshT(" \u4E2A\u6280\u80FD\u2014\u2014\u7528\u4E0A\u65B9\u8FC7\u6EE4\u6761\u4EF6\u67E5\u770B\u5176\u4F59")
    ));
  }
  if (filtered.length === 0 && state.skills.length > 0) {
    cardNodes.push(createElement("div", { className: "empty", key: "empty-filter" }, dshT("\u6CA1\u6709\u5339\u914D\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u7684\u6280\u80FD")));
  }
  if (cardNodes.length > 0) {
    elements.push(createElement("div", { className: "list", key: "skills" }, cardNodes));
  }
  if (state.skills.length === 0 && !state.busy && state.error === "") {
    elements.push(createElement(
      "div",
      { className: "empty", key: "empty-skills" },
      dshT("\u6CA1\u6709\u53D1\u73B0\u4EFB\u4F55\u6280\u80FD\uFF08\u5168\u5C40\u5C42\u3001\u9884\u8BBE\u4F5C\u7528\u57DF\u4E0E\u4F1A\u8BDD\u4F5C\u7528\u57DF\u90FD\u672A\u547D\u4E2D\u6280\u80FD\u6E90\uFF09")
    ));
    var emptyDiagnose = [];
    var globalScope = null;
    for (var gi = 0; gi < state.scopes.length; gi++) {
      if (state.scopes[gi].kind === "global") {
        globalScope = state.scopes[gi];
        break;
      }
    }
    if (globalScope !== null) {
      emptyDiagnose.push(dshT("\u5168\u5C40\u5C42\uFF1A") + globalScope.count + dshT(" \u4E2A\u6280\u80FD") + (globalScope.count === 0 && presetScopes.length > 0 ? dshT("\uFF08\u672C\u90E8\u7F72\u7531\u9884\u8BBE\u6302\u8F7D\u672C\u5730\u6280\u80FD\uFF0C\u5168\u5C40\u5C42\u4E3A\u7A7A\u5C5E\u6B63\u5E38\uFF09") : ""));
    }
    var failedPresetCount = 0;
    for (var ppi = 0; ppi < presetScopes.length; ppi++) {
      if (presetScopes[ppi].error) failedPresetCount++;
    }
    if (presetScopes.length > 0) {
      emptyDiagnose.push(dshT("\u9884\u8BBE\u4F5C\u7528\u57DF\uFF1A") + presetScopes.length + dshT(" \u4E2A") + (failedPresetCount > 0 ? dshT("\uFF08") + failedPresetCount + dshT(" \u4E2A\u89E3\u6790\u5931\u8D25\uFF09") : ""));
    }
    var sessionScopeCount = 0;
    var failedScopeCount = 0;
    for (var sci = 0; sci < sessionScopes.length; sci++) {
      sessionScopeCount++;
      if (sessionScopes[sci].error) failedScopeCount++;
    }
    if (sessionScopeCount > 0) {
      emptyDiagnose.push(dshT("\u4F1A\u8BDD\u4F5C\u7528\u57DF\uFF1A") + sessionScopeCount + dshT(" \u4E2A") + (failedScopeCount > 0 ? dshT("\uFF08") + failedScopeCount + dshT(" \u4E2A\u89E3\u6790\u5931\u8D25\uFF09") : ""));
    } else if (state.sessions.length === 0) {
      emptyDiagnose.push(dshT("\u4F1A\u8BDD\u4F5C\u7528\u57DF\uFF1A\u65E0\uFF08dsh \u5F53\u524D\u6CA1\u6709\u5DF2\u77E5\u4F1A\u8BDD\uFF09"));
    }
    if (state.warnings.length > 0) emptyDiagnose.push(dshT("\u8B66\u544A\uFF1A") + state.warnings.length + dshT(" \u6761"));
    if (emptyDiagnose.length > 0) {
      elements.push(createElement(
        "div",
        { className: "hint", key: "empty-diagnose", style: { fontSize: "11px" } },
        dshT("\u8BCA\u65AD\uFF1A") + emptyDiagnose.join(" \xB7 ")
      ));
    }
  }
  return createElement("div", { "data-dsh-admin-section": "" }, elements);
}
function skillsSourceLabel(source) {
  var labels = {
    "project-agents": dshT("\u9879\u76EE .agents"),
    "project-dsh": dshT("\u9879\u76EE .dsh"),
    "user-agents": dshT("\u7528\u6237 .agents"),
    "user-dsh": dshT("\u7528\u6237 dsh"),
    bundled: dshT("\u63D2\u4EF6\u5185\u7F6E"),
    runtime: dshT("\u8FD0\u884C\u65F6\u6CE8\u518C"),
    custom: dshT("\u81EA\u5B9A\u4E49\u6E90"),
    unknown: dshT("\u672A\u77E5\u6765\u6E90")
  };
  return labels[source] || String(source);
}

// src/client/panels/todo.js
function TodoAdminCompletedGlyph() {
  return createElement(
    "svg",
    { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true" },
    createElement("circle", { cx: 7, cy: 7, r: 6.4, stroke: "currentColor", strokeWidth: 1.2 }),
    createElement("path", { d: "M4.2 7.2L6.1 9.1L9.9 4.9", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" })
  );
}
function TodoAdminProgressGlyph() {
  return createElement(
    "svg",
    { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true" },
    createElement("circle", { cx: 7, cy: 7, r: 5.6, stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeDasharray: "24 12" })
  );
}
function TodoAdminPendingGlyph() {
  return createElement(
    "svg",
    { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true" },
    createElement("circle", { cx: 7, cy: 7, r: 6.4, stroke: "currentColor", strokeWidth: 1.2, strokeDasharray: "2.4 2.4" })
  );
}
function TodoAdminStatusGlyph(status) {
  if (status === "completed") return createElement(TodoAdminCompletedGlyph, { key: "g" });
  if (status === "in_progress") return createElement(TodoAdminProgressGlyph, { key: "g" });
  return createElement(TodoAdminPendingGlyph, { key: "g" });
}
function todoAdminStep(list) {
  var total = list.length;
  var completed = 0;
  var activeIndex = -1;
  for (var i = 0; i < total; i++) {
    var status = list[i] && list[i].status;
    if (status === "completed") completed++;
    else if (status === "in_progress" && activeIndex === -1) activeIndex = i;
  }
  var current = activeIndex >= 0 ? activeIndex + 1 : completed >= total ? total : completed + 1;
  return { current, total };
}
function todoAdminStatusLetter(status) {
  return status === "M" || status === "A" || status === "D" || status === "R" || status === "C" || status === "?" ? status : "M";
}
function TodoAdminFileRow(item, index, reveal) {
  var st = todoAdminStatusLetter(item.status);
  var path = typeof item.path === "string" && item.path !== "" ? item.path : dshT("\uFF08\u672A\u77E5\u8DEF\u5F84\uFF09");
  var added = typeof item.added === "number" && item.added > 0 ? item.added : 0;
  var removed = typeof item.removed === "number" && item.removed > 0 ? item.removed : 0;
  var nums = [
    createElement("span", { key: "a", className: "a" + (added === 0 ? " zero" : "") }, "+" + added),
    createElement("span", { key: "d", className: "d" + (removed === 0 ? " zero" : "") }, "-" + removed)
  ];
  var slash = path.lastIndexOf("/");
  var dir = slash > 0 ? path.slice(0, slash + 1) : null;
  var name = slash > 0 ? path.slice(slash + 1) : path;
  var target = typeof item.absPath === "string" && item.absPath !== "" ? item.absPath : typeof item.absDir === "string" && item.absDir !== "" ? item.absDir : null;
  var rowProps = {
    key: index,
    type: "button",
    className: "todo-file",
    "data-st": st,
    title: target !== null ? path + dshT("\n\u70B9\u51FB\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D") : path
  };
  if (target !== null && typeof reveal === "function") {
    rowProps.onClick = function() {
      reveal(target);
    };
  } else {
    rowProps.disabled = true;
  }
  return createElement(
    "button",
    rowProps,
    createElement("span", { className: "st", "aria-hidden": "true" }, st),
    createElement(
      "span",
      { className: "p" },
      dir ? createElement("span", { key: "dir", className: "dir" }, dir) : null,
      createElement("span", { key: "name", className: "name" }, name)
    ),
    createElement("span", { className: "n" }, nums)
  );
}
function TodoAdminDoneRow(done, expanded, toggleDone) {
  return createElement(
    "li",
    { key: "done-row", className: "todo-done-row" },
    createElement(
      "button",
      {
        type: "button",
        className: "todo-done-toggle",
        "aria-expanded": expanded ? "true" : "false",
        onClick: toggleDone
      },
      createElement("span", { className: "todo-glyph", "aria-hidden": "true" }, createElement(TodoAdminCompletedGlyph, null)),
      createElement("span", { className: "todo-done-label" }, done + dshT(" \u9879\u5DF2\u5B8C\u6210")),
      createElement("span", { className: "todo-chevron", "aria-hidden": "true" }, expanded ? "\u25BE" : "\u25B8")
    )
  );
}
function formatElapsed(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  var total = Math.floor(ms / 1e3);
  if (total < 60) return total + dshT("\u79D2");
  var minutes = Math.floor(total / 60);
  var seconds = total % 60;
  if (minutes < 60) return minutes + dshT("\u5206") + (seconds > 0 ? seconds + dshT("\u79D2") : "");
  return Math.floor(minutes / 60) + dshT("\u65F6") + minutes % 60 + dshT("\u5206") + (seconds > 0 ? seconds + dshT("\u79D2") : "");
}
function TodoAdminRender(list, stats, ui) {
  var children = [];
  var completed = 0;
  for (var c = 0; c < list.length; c++) {
    if ((list[c] || {}).status === "completed") completed++;
  }
  var total = list.length;
  var percent = total > 0 ? Math.round(completed / total * 100) : 0;
  children.push(createElement(
    "div",
    { key: "progress", className: "todo-progress", "aria-hidden": "true" },
    createElement("div", {
      className: "todo-progress-fill" + (percent >= 100 ? " full" : ""),
      style: { width: percent + "%" }
    })
  ));
  if (!ui.collapsed) {
    var items = [];
    var activeAttached = false;
    var doneShown = 0;
    for (var i = 0; i < total; i++) {
      var item = list[i] || {};
      var status = typeof item.status === "string" ? item.status : "pending";
      if (status === "completed") {
        doneShown++;
        if (ui.doneCollapsed) continue;
      }
      var liProps = { key: i, className: "todo-item", "data-status": status };
      if (status === "in_progress" && !activeAttached && ui.activeRef) {
        liProps.ref = ui.activeRef;
        activeAttached = true;
      }
      var elapsed = status === "in_progress" && typeof ui.elapsedOf === "function" ? ui.elapsedOf(item.content) : null;
      items.push(createElement(
        "li",
        liProps,
        createElement("span", { className: "todo-glyph", "aria-hidden": "true" }, TodoAdminStatusGlyph(item.status)),
        createElement("span", { className: "todo-text" }, typeof item.content === "string" ? item.content : ""),
        elapsed !== null ? createElement("span", { className: "todo-elapsed" }, formatElapsed(elapsed)) : null
      ));
    }
    if (doneShown > 0) {
      items.unshift(TodoAdminDoneRow(doneShown, !ui.doneCollapsed, ui.toggleDone));
    }
    children.push(createElement("ul", { key: "list", className: "todo-list" }, items));
    var changed = stats !== null && Array.isArray(stats.changed) ? stats.changed : [];
    if (changed.length > 0) {
      var rows = [];
      for (var f = 0; f < changed.length; f++) rows.push(TodoAdminFileRow(changed[f], f, ui.reveal));
      var headParts = [];
      if (typeof ui.branch === "string" && ui.branch !== "") {
        headParts.push(createElement("span", { key: "branch-icon", className: "branch", "aria-hidden": "true" }, "\u2387"));
        headParts.push(createElement("span", { key: "branch", className: "branch-name" }, ui.branch));
      }
      headParts.push(createElement("button", {
        type: "button",
        key: "copy-diff",
        className: "todo-copy-diff",
        title: dshT("\u590D\u5236\u5B8C\u6574 git diff\uFF08HEAD vs \u5DE5\u4F5C\u533A\uFF09"),
        onClick: ui.copyDiff
      }, ui.diffCopied ? dshT("\u2713 \u5DF2\u590D\u5236") : dshT("\u29C9 \u590D\u5236 diff")));
      children.push(createElement(
        "div",
        { key: "files", className: "todo-files" },
        createElement("div", { key: "head", className: "todo-files-head" }, headParts),
        createElement("div", { key: "rows" }, rows)
      ));
    }
  }
  var steps = todoAdminStep(list);
  var hasStats = stats !== null && stats.files > 0;
  var statsParts = [];
  if (hasStats) {
    statsParts.push(createElement("span", { key: "files" }, stats.files + dshT(" \u4E2A\u6587\u4EF6\u5DF2\u6539")));
    statsParts.push(createElement("span", { key: "add", className: "num-add" }, "+" + stats.added));
    statsParts.push(createElement("span", { key: "del", className: "num-del" }, "-" + stats.removed));
  }
  statsParts.push(createElement("span", { key: "chevron", className: "todo-chevron", "aria-hidden": "true" }, ui.collapsed ? "\u25B2" : "\u25BC"));
  children.push(createElement(
    "button",
    {
      type: "button",
      key: "footer",
      className: "todo-footer",
      "aria-expanded": ui.collapsed ? "false" : "true",
      onClick: ui.toggle
    },
    createElement("span", { key: "steps", className: "todo-steps" }, dshT("\u7B2C ") + steps.current + " / " + steps.total + dshT(" \u6B65")),
    createElement("span", { key: "stats", className: "todo-stats" }, statsParts)
  ));
  if (typeof Notification !== "undefined") {
    children.push(createElement("button", {
      type: "button",
      key: "notify",
      className: "todo-notify" + (ui.notifyEnabled ? " on" : ""),
      title: ui.notifyEnabled ? dshT("\u684C\u9762\u901A\u77E5\uFF1A\u5F00\uFF08\u9875\u9762\u5728\u540E\u53F0\u4E14\u5F85\u529E\u5168\u90E8\u5B8C\u6210\u65F6\u63D0\u9192\uFF09\u2014 \u70B9\u51FB\u5173\u95ED") : dshT("\u684C\u9762\u901A\u77E5\uFF1A\u5173 \u2014 \u70B9\u51FB\u5F00\u542F\uFF08\u9875\u9762\u5728\u540E\u53F0\u4E14\u5F85\u529E\u5168\u90E8\u5B8C\u6210\u65F6\u63D0\u9192\uFF09"),
      "aria-pressed": ui.notifyEnabled ? "true" : "false",
      onClick: ui.toggleNotify
    }, TodoAdminBellGlyph(ui.notifyEnabled)));
  }
  return createElement("section", {
    "data-dsh-admin-todo": "",
    "aria-label": dshT("\u5F85\u529E\u6E05\u5355")
  }, children);
}
function TodoAdminBellGlyph(on) {
  return createElement(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.3,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true"
    },
    createElement("path", { d: "M8 2.2a4 4 0 0 0-4 4c0 3.1-1.2 4.3-1.2 4.3h10.4S12 9.3 12 6.2a4 4 0 0 0-4-4z" }),
    createElement("path", { d: "M6.7 13.1a1.4 1.4 0 0 0 2.6 0" }),
    on ? null : createElement("path", { d: "M2.5 2.5l11 11" })
  );
}
var todoActiveSince = /* @__PURE__ */ new Map();
var TODO_DONE_KEY = "dsh-admin-todo-hide-done";
var TODO_NOTIFY_KEY = "dsh-admin-todo-notify";
function readDoneCollapsed() {
  try {
    return window.localStorage.getItem(TODO_DONE_KEY) === "1";
  } catch (e) {
    return false;
  }
}
function TodoAdminDock(props) {
  var useProjection = props.useProjection;
  var todos = typeof useProjection === "function" ? useProjection("todos") : null;
  var list = Array.isArray(todos) ? todos : [];
  var show = list.length > 0;
  var collapsedState = useState(false);
  var collapsed = collapsedState[0];
  var setCollapsed = collapsedState[1];
  var doneCollapsedState = useState(readDoneCollapsed);
  var doneCollapsed = doneCollapsedState[0];
  var setDoneCollapsed = doneCollapsedState[1];
  var statsState = useState(null);
  var stats = statsState[0];
  var setStats = statsState[1];
  var nowState = useState(null);
  var nowMs = nowState[0];
  var setNow = nowState[1];
  var sessionId = props.sessionId;
  var call = props.call;
  useEffect(function() {
    if (!show || typeof sessionId !== "string") return void 0;
    var keyPrefix = sessionId + "\0";
    var actives = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      if (item.status === "in_progress" && typeof item.content === "string") actives.push(item.content);
    }
    var now = Date.now();
    var addedNew = false;
    for (var a = 0; a < actives.length; a++) {
      var key = keyPrefix + actives[a];
      if (!todoActiveSince.has(key)) {
        todoActiveSince.set(key, now);
        addedNew = true;
      }
    }
    var stale = [];
    todoActiveSince.forEach(function(v, k) {
      if (k.indexOf(keyPrefix) === 0) {
        if (actives.indexOf(k.slice(keyPrefix.length)) === -1) stale.push(k);
      } else {
        stale.push(k);
      }
    });
    for (var s = 0; s < stale.length; s++) todoActiveSince.delete(stale[s]);
    if (addedNew || stale.length > 0) setNow(now);
    if (actives.length === 0) return void 0;
    var timer = setInterval(function() {
      setNow(Date.now());
    }, 1e3);
    return function() {
      clearInterval(timer);
    };
  }, [show, sessionId, todos]);
  var elapsedOf = function(content) {
    if (typeof nowMs !== "number" || typeof sessionId !== "string") return null;
    var start = todoActiveSince.get(sessionId + "\0" + content);
    if (typeof start !== "number") return null;
    return Math.max(0, nowMs - start);
  };
  var toggleDone = function() {
    setDoneCollapsed(function(v) {
      var next = !v;
      try {
        window.localStorage.setItem(TODO_DONE_KEY, next ? "1" : "0");
      } catch (e) {
      }
      return next;
    });
  };
  var reveal = function(path) {
    if (typeof call !== "function" || typeof path !== "string" || path === "") return;
    call("fsAdmin/reveal", { path }).then(function(result) {
      if (!(result && result.ok)) showToast("error", dshT("\u274C \u6253\u5F00\u5931\u8D25\uFF1A") + messageOf(result && result.error));
    }, function(err) {
      showToast("error", dshT("\u274C \u6253\u5F00\u5931\u8D25\uFF1A") + messageOf(err));
    });
  };
  var copyDiffState = useState(false);
  var diffCopied = copyDiffState[0];
  var setDiffCopied = copyDiffState[1];
  var copyDiffTimer = useRef(null);
  useEffect(function() {
    return function() {
      if (copyDiffTimer.current) clearTimeout(copyDiffTimer.current);
    };
  }, []);
  var copyDiff = function() {
    if (typeof call !== "function" || typeof sessionId !== "string") return;
    call("sessionAdmin/gitDiff", { sessionId }).then(function(res) {
      var value = res && res.ok && res.value && typeof res.value === "object" ? res.value : null;
      if (value === null || typeof value.diff !== "string") {
        showToast("error", dshT("\u274C \u83B7\u53D6 diff \u5931\u8D25"));
        return;
      }
      if (typeof value.error === "string" && value.error !== "") {
        showToast("error", "\u274C " + value.error);
        return;
      }
      if (value.diff === "") {
        showToast("success", dshT("\u5DE5\u4F5C\u533A\u5E72\u51C0\uFF0C\u6CA1\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8"));
        return;
      }
      copyTextSilently(value.diff).then(function() {
        setDiffCopied(true);
        if (copyDiffTimer.current) clearTimeout(copyDiffTimer.current);
        copyDiffTimer.current = setTimeout(function() {
          setDiffCopied(false);
        }, 1500);
      }, function() {
        showToast("error", dshT("\u274C \u590D\u5236\u5931\u8D25"));
      });
    }, function() {
      showToast("error", dshT("\u274C \u83B7\u53D6 diff \u5931\u8D25"));
    });
  };
  var notifyEnabledState = useState(function() {
    try {
      return typeof Notification !== "undefined" && Notification.permission === "granted" && window.localStorage.getItem(TODO_NOTIFY_KEY) === "1";
    } catch (e) {
      return false;
    }
  });
  var notifyEnabled = notifyEnabledState[0];
  var setNotifyEnabled = notifyEnabledState[1];
  var allDone = false;
  if (show) {
    allDone = true;
    for (var d = 0; d < list.length; d++) {
      if ((list[d] || {}).status !== "completed") {
        allDone = false;
        break;
      }
    }
  }
  var prevAllDoneRef = useRef(false);
  useEffect(function() {
    var entered = allDone && !prevAllDoneRef.current;
    prevAllDoneRef.current = allDone;
    if (!entered || !notifyEnabled) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (typeof document !== "undefined" && !document.hidden) return;
    try {
      var last = list[list.length - 1] || {};
      var notification = new Notification(dshT("\u2705 \u5F85\u529E\u5168\u90E8\u5B8C\u6210"), {
        body: dshT("\u5171 ") + list.length + dshT(" \u9879 \xB7 ") + (typeof last.content === "string" ? last.content : ""),
        tag: "dsh-admin-todo-done"
      });
      notification.onclick = function() {
        try {
          window.focus();
          notification.close();
        } catch (e) {
        }
      };
    } catch (e) {
    }
  }, [allDone, notifyEnabled, todos]);
  var toggleNotify = function() {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      setNotifyEnabled(function(v) {
        var next = !v;
        try {
          window.localStorage.setItem(TODO_NOTIFY_KEY, next ? "1" : "0");
        } catch (e) {
        }
        return next;
      });
      return;
    }
    if (Notification.permission === "denied") {
      showToast("error", dshT("\u901A\u77E5\u6743\u9650\u5DF2\u88AB\u6D4F\u89C8\u5668\u62D2\u7EDD\uFF0C\u8BF7\u5728\u7AD9\u70B9\u8BBE\u7F6E\u4E2D\u5141\u8BB8\u540E\u91CD\u8BD5"));
      return;
    }
    Notification.requestPermission().then(function(p) {
      if (p === "granted") {
        setNotifyEnabled(true);
        try {
          window.localStorage.setItem(TODO_NOTIFY_KEY, "1");
        } catch (e) {
        }
      }
    }).catch(function() {
    });
  };
  var activeItemRef = useRef(null);
  useEffect(function() {
    var node = activeItemRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [todos]);
  useEffect(function() {
    if (show) document.body.classList.add("dsh-admin-todo-live");
    else document.body.classList.remove("dsh-admin-todo-live");
    return function() {
      document.body.classList.remove("dsh-admin-todo-live");
    };
  }, [show]);
  useEffect(function() {
    if (!show || !sessionId || typeof call !== "function") return void 0;
    var disposed = false;
    var tick = function() {
      call("sessionAdmin/fileStats", { sessionId }).then(function(res) {
        var value = res && res.ok && res.value && typeof res.value === "object" ? res.value : null;
        if (disposed || value === null) return;
        if (typeof value.error === "string" && value.error !== "") {
          setStats(function(prev) {
            return prev === null ? prev : null;
          });
          return;
        }
        setStats(function(prev) {
          if (prev && prev.files === value.files && prev.added === value.added && prev.removed === value.removed && prev.branch === (typeof value.branch === "string" ? value.branch : null)) return prev;
          return {
            files: value.files,
            added: value.added,
            removed: value.removed,
            branch: typeof value.branch === "string" && value.branch !== "" ? value.branch : null,
            changed: Array.isArray(value.changed) ? value.changed : []
          };
        });
      }).catch(function() {
      });
    };
    tick();
    var timer = setInterval(tick, 4e3);
    return function() {
      disposed = true;
      clearInterval(timer);
    };
  }, [show, sessionId, call]);
  if (!show) return null;
  return TodoAdminRender(list, stats, {
    collapsed,
    toggle: function() {
      setCollapsed(function(v) {
        return !v;
      });
    },
    activeRef: activeItemRef,
    doneCollapsed,
    toggleDone,
    elapsedOf,
    reveal,
    branch: stats !== null ? stats.branch : null,
    copyDiff,
    diffCopied,
    notifyEnabled,
    toggleNotify
  });
}

// src/client/panels/usage.js
function UsageDashboardSection(props) {
  var call = props.call;
  var kit = sectionState({
    open: true,
    loading: true,
    rows: [],
    range: "30d",
    project: "",
    storagePath: null,
    snapshotIntervalMs: 0,
    lastSnapshotAt: null
  });
  var usage = kit.state;
  var setUsage = kit.set;
  var alive = kit.alive;
  function patchUsage(partial) {
    kit.patch(partial);
  }
  function reloadUsage() {
    patchUsage({ loading: true, error: null });
    call("sessionAdmin/usageReport", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var value = result.value || {};
        patchUsage({
          loading: false,
          rows: value.rows || [],
          storagePath: typeof value.storagePath === "string" ? value.storagePath : null,
          snapshotIntervalMs: typeof value.snapshotIntervalMs === "number" ? value.snapshotIntervalMs : 0,
          lastSnapshotAt: typeof value.lastSnapshotAt === "number" ? value.lastSnapshotAt : null
        });
      } else patchUsage({ loading: false, error: messageOf(result.error) });
    }, function(failure) {
      if (alive.current) patchUsage({ loading: false, error: messageOf(failure) });
    });
  }
  kit.mount(reloadUsage);
  var sweepMinutes = Math.round(usage.snapshotIntervalMs / 6e4);
  var sweepOn = usage.snapshotIntervalMs > 0;
  var sweepCadence = sweepMinutes >= 1 ? sweepMinutes + dshT(" \u5206\u949F") : Math.round(usage.snapshotIntervalMs / 1e3) + dshT(" \u79D2");
  var sweepHint = sweepOn ? dshT("\u6BCF ") + sweepCadence + dshT("\u81EA\u52A8\u5FEB\u7167\u4F1A\u8BDD\u7528\u91CF\u5230\u53F0\u8D26") + (usage.lastSnapshotAt !== null ? dshT("\uFF1B\u6700\u8FD1\u4E00\u6B21 ") + new Date(usage.lastSnapshotAt).toLocaleTimeString() : "") + (usage.storagePath ? dshT("\uFF08") + usage.storagePath + dshT("\uFF09") : "") : dshT("\u540E\u53F0\u81EA\u52A8\u5FEB\u7167\u5DF2\u5173\u95ED\uFF08config.usageSnapshotIntervalMs = 0\uFF09\u2014\u2014\u53EA\u6709\u6253\u5F00\u672C\u9875\u65F6\u624D\u4F1A\u8BB0\u5F55\u7528\u91CF");
  return createElement(
    "div",
    { "data-dsh-admin-section": "" },
    createElement(
      "div",
      { className: "toolbar usage-head" },
      createElement("span", { className: "title" }, dshT("\u{1F4CA} \u7528\u91CF\u4EEA\u8868\u76D8")),
      createElement("span", { className: "usage-sub" }, dshT("VibeUsage \u59FF\u6001 \xB7 \u672C\u5730\u805A\u5408")),
      // ONE state chip: the sweep cadence. The deleted-session count used to
      // ride a second chip here; the rows are still retained in the ledger,
      // they just no longer need a badge on this row.
      createElement(
        "span",
        { className: "usage-chip " + (sweepOn ? "on" : "off"), title: sweepHint },
        createElement("span", { className: "dot" }),
        dshT("\u81EA\u52A8\u5FEB\u7167"),
        createElement("span", { className: "sep" }, "\xB7"),
        sweepOn ? sweepCadence : dshT("\u5DF2\u5173\u95ED")
      ),
      createElement("span", { className: "spacer" }),
      createElement(
        import_dsh_client_ui_primitives.Button,
        { variant: "outline", disabled: usage.loading === true, onClick: reloadUsage, "aria-label": dshT("\u91CD\u65B0\u7EDF\u8BA1") },
        usage.loading === true ? createElement("span", { className: "spinner" }) : null,
        dshT("\u21BB \u91CD\u65B0\u7EDF\u8BA1")
      )
    ),
    usage.error ? createElement("div", { className: "error" }, usage.error) : null,
    renderUsageDashboard(usage, patchUsage)
  );
}
function renderUsageDashboard(usage, patch) {
  var rangeLabels = [
    ["today", dshT("\u4ECA\u5929")],
    ["24h", "24H"],
    ["7d", "7D"],
    ["30d", "30D"],
    ["90d", "90D"],
    ["all", dshT("\u5168\u90E8")]
  ];
  var range = usage.range || "30d";
  var project = usage.project || "";
  var rows = Array.isArray(usage.rows) ? usage.rows : [];
  var now = Date.now();
  var dayMs = 864e5;
  var startMs = null;
  if (range === "today") {
    var d0 = /* @__PURE__ */ new Date();
    d0.setHours(0, 0, 0, 0);
    startMs = d0.getTime();
  } else if (range !== "all") {
    var span = (
      /** @type {Record<string, number>} */
      { "24h": dayMs, "7d": 7 * dayMs, "30d": 30 * dayMs, "90d": 90 * dayMs }[range]
    );
    if (span !== void 0) startMs = now - span;
  }
  var prevStartMs = startMs === null ? null : startMs - (now - startMs);
  var cur = [];
  var prev = [];
  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    if (project !== "" && r.project !== project) continue;
    if (startMs !== null && r.createdAt >= startMs) cur.push(r);
    else if (prevStartMs !== null && r.createdAt >= prevStartMs) prev.push(r);
    else if (startMs === null) cur.push(r);
  }
  function kpiOf(list) {
    var k = (
      /** @type {UsageKpi} */
      { sessions: list.length, input: 0, output: 0, cacheRead: 0, userMsgs: 0, assistantMsgs: 0 }
    );
    var days = {};
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      k.input += x.input || 0;
      k.output += x.output || 0;
      k.cacheRead += x.cacheRead || 0;
      k.userMsgs += x.userMsgs || 0;
      k.assistantMsgs += x.assistantMsgs || 0;
      days[usageDayKey(x.createdAt)] = true;
    }
    k.tokens = k.input + k.output + k.cacheRead;
    k.activeDays = Object.keys(days).length;
    return k;
  }
  var curK = kpiOf(cur);
  var prevK = kpiOf(prev);
  function deltaPct(curV, prevV) {
    if (prevV <= 0) return null;
    return Math.round((curV - prevV) / prevV * 1e3) / 10;
  }
  var dayMap = {};
  for (var di = 0; di < cur.length; di++) {
    var dayKey = usageDayKey(cur[di].createdAt);
    var b = dayMap[dayKey];
    if (b === void 0) {
      b = { input: 0, output: 0, cacheRead: 0 };
      dayMap[dayKey] = b;
    }
    b.input += cur[di].input || 0;
    b.output += cur[di].output || 0;
    b.cacheRead += cur[di].cacheRead || 0;
  }
  var dayKeys = Object.keys(dayMap).sort();
  var chartMax = 0;
  for (var ci = 0; ci < dayKeys.length; ci++) {
    var t = dayMap[dayKeys[ci]].input + dayMap[dayKeys[ci]].output + dayMap[dayKeys[ci]].cacheRead;
    if (t > chartMax) chartMax = t;
  }
  var heat = [];
  for (var hh = 0; hh < 7; hh++) heat.push(new Array(24).fill(0));
  var heatMax = 0;
  for (var hj = 0; hj < cur.length; hj++) {
    var when = new Date(cur[hj].createdAt);
    var v = (cur[hj].input || 0) + (cur[hj].output || 0);
    heat[when.getDay()][when.getHours()] += v;
    if (heat[when.getDay()][when.getHours()] > heatMax) heatMax = heat[when.getDay()][when.getHours()];
  }
  var weekdayNames = [dshT("\u5468\u65E5"), dshT("\u5468\u4E00"), dshT("\u5468\u4E8C"), dshT("\u5468\u4E09"), dshT("\u5468\u56DB"), dshT("\u5468\u4E94"), dshT("\u5468\u516D")];
  var projMap = {};
  for (var pi = 0; pi < cur.length; pi++) {
    var pb = projMap[cur[pi].project];
    if (pb === void 0) {
      pb = { input: 0, output: 0, cacheRead: 0 };
      projMap[cur[pi].project] = pb;
    }
    pb.input += cur[pi].input || 0;
    pb.output += cur[pi].output || 0;
    pb.cacheRead += cur[pi].cacheRead || 0;
  }
  var projectNames = Object.keys(projMap).sort(function(a, b2) {
    return projMap[b2].input + projMap[b2].output - (projMap[a].input + projMap[a].output);
  });
  var insights = [];
  if (curK.cacheRead + curK.input > 0) {
    var rate = curK.cacheRead / (curK.cacheRead + curK.input);
    if (rate >= 0.5) insights.push(dshT("\u{1F4A1} \u7F13\u5B58\u547D\u4E2D\u7387 ") + Math.round(rate * 100) + dshT("% \u2014\u2014 \u957F\u4E0A\u4E0B\u6587\u590D\u7528\u826F\u597D\uFF0C\u91CD\u590D\u63D0\u793A\u6210\u672C\u88AB\u6709\u6548\u644A\u8584\u3002"));
    else if (rate < 0.15 && curK.input > 5e4) insights.push(dshT("\u{1F4A1} \u7F13\u5B58\u547D\u4E2D\u7387\u4EC5 ") + Math.round(rate * 100) + dshT("% \u2014\u2014 \u9AD8\u91CD\u590D\u957F\u4E0A\u4E0B\u6587\u5728\u6309\u5168\u4EF7\u8BA1\u8D39\uFF1B\u7A33\u5B9A\u7CFB\u7EDF\u63D0\u793A\u4E0E\u524D\u7F00\u53EF\u663E\u8457\u964D\u672C\u3002"));
  }
  if (curK.input > 0 && curK.output / curK.input > 1.2) insights.push(dshT("\u{1F4A1} \u8F93\u51FA token \u662F\u8F93\u5165\u7684 ") + (curK.output / curK.input).toFixed(1) + dshT(" \u500D \u2014\u2014 \u751F\u6210\u91CF\u504F\u5927\uFF0C\u68C0\u67E5\u91CD\u590D\u91CD\u8BD5\u6216\u8D85\u957F\u56DE\u590D\u3002"));
  if (projectNames.length > 1 && curK.tokens > 0) {
    var topSum = projMap[projectNames[0]].input + projMap[projectNames[0]].output;
    if (topSum / curK.tokens >= 0.6) insights.push("\u{1F4A1} \u300C" + projectNames[0] + dshT("\u300D\u5360\u5168\u90E8\u7528\u91CF\u7684 ") + Math.round(topSum / curK.tokens * 100) + dshT("% \u2014\u2014 \u7528\u91CF\u9AD8\u5EA6\u96C6\u4E2D\u3002"));
  }
  if (dayKeys.length >= 3) {
    var busiest = dayKeys.reduce(function(a, b2) {
      return dayMap[b2].input + dayMap[b2].output > dayMap[a].input + dayMap[a].output ? b2 : a;
    });
    insights.push(dshT("\u{1F4A1} \u7528\u91CF\u6700\u9AD8\u7684\u4E00\u5929\u662F ") + busiest + dshT("\uFF08") + dayMap[busiest].input + dshT(" \u5165 / ") + dayMap[busiest].output + dshT(" \u51FA\uFF09\u3002"));
  }
  function kpiCard(key, label, valueText, curV, prevV, accent) {
    var d = deltaPct(curV, prevV);
    var badge = d === null ? null : createElement("span", {
      key: "delta",
      className: "usage-kpi-delta" + (d >= 0 ? " up" : " down")
    }, (d >= 0 ? "+" : "") + d + "%");
    return createElement(
      "div",
      { key, className: "usage-kpi" + (accent ? " " + accent : "") },
      createElement(
        "div",
        { className: "usage-kpi-top" },
        createElement("span", { className: "usage-kpi-label" }, label),
        badge
      ),
      createElement("div", { className: "usage-kpi-value" }, valueText)
    );
  }
  var rangePills = rangeLabels.map(function(pair) {
    var active = range === pair[0];
    return createElement(import_dsh_client_ui_primitives.Pill, {
      key: pair[0],
      active,
      // State must not be colour-only: the pressed pill also carries
      // aria-pressed, so the selected window is announced, not just tinted.
      "aria-pressed": active ? "true" : "false",
      onClick: function() {
        patch({ range: pair[0] });
      }
    }, pair[1]);
  });
  var dayBars = dayKeys.map(function(dk) {
    var b2 = dayMap[dk];
    var hOut = chartMax > 0 ? Math.round(b2.output / chartMax * 100) : 0;
    var hIn = chartMax > 0 ? Math.round(b2.input / chartMax * 100) : 0;
    var hCache = chartMax > 0 ? Math.round(b2.cacheRead / chartMax * 100) : 0;
    return createElement(
      "div",
      { key: dk, className: "usage-bar-col", title: dk + dshT("\uFF1A\u8F93\u5165 ") + b2.input + dshT(" \xB7 \u8F93\u51FA ") + b2.output + dshT(" \xB7 \u7F13\u5B58 ") + b2.cacheRead },
      createElement(
        "div",
        { className: "usage-bar-stack" },
        createElement("span", { className: "seg seg-cache", style: { height: hCache + "%" } }),
        createElement("span", { className: "seg seg-in", style: { height: hIn + "%" } }),
        createElement("span", { className: "seg seg-out", style: { height: hOut + "%" } })
      ),
      createElement("div", { className: "usage-bar-label" }, dk.slice(5))
    );
  });
  var heatRows = weekdayNames.map(function(wn, wi) {
    var cells = [];
    for (var h = 0; h < 24; h++) {
      var v2 = heat[wi][h];
      var level = v2 <= 0 || heatMax <= 0 ? 0 : Math.min(5, 1 + Math.floor(v2 / heatMax * 5));
      cells.push(createElement("span", { key: h, className: "heat-cell lvl" + level, title: wn + " " + h + dshT("\u70B9\uFF1A") + v2 + " tokens" }));
    }
    return createElement(
      "div",
      { key: wn, className: "heat-row" },
      createElement("span", { className: "heat-row-label" }, wn),
      createElement("span", { className: "heat-cells" }, cells)
    );
  });
  var projectRowsUI = projectNames.slice(0, 6).map(function(pn) {
    var pb2 = projMap[pn];
    var sum = pb2.input + pb2.output;
    var width = curK.tokens > 0 ? Math.max(2, Math.round(sum / curK.tokens * 100)) : 0;
    return createElement(
      "div",
      { key: pn, className: "usage-project" },
      createElement("span", { className: "usage-project-name", title: pn }, pn),
      createElement(
        "span",
        { className: "usage-project-track" },
        createElement("span", { className: "usage-project-fill", style: { width: width + "%" } })
      ),
      createElement("span", { className: "usage-project-num" }, "\u2191" + formatTokenCount(pb2.input) + " \u2193" + formatTokenCount(pb2.output))
    );
  });
  return createElement(
    "div",
    { className: "usage-dash", key: "usage-dash" },
    createElement(
      "div",
      { className: "usage-toolbar" },
      createElement(
        "div",
        { className: "usage-group" },
        createElement("span", { className: "usage-group-label" }, dshT("\u23F1 \u65E5\u671F")),
        createElement("span", { className: "filter-bar" }, rangePills)
      ),
      // 标签与选择框同属一个控件：外层 `.usage-filter` 画边框，标签是左侧固定段，
      // 选择框吃掉剩余宽度。窄屏整组换行，标签不会再被留在上一行末尾。
      createElement(
        "div",
        { className: "usage-filter" },
        createElement("span", { className: "usage-filter-label" }, dshT("\u7B5B\u9009")),
        createElement(
          "select",
          {
            className: "input usage-project-select",
            value: project,
            // 选项只带项目名本身（左侧「筛选」段已说明维度），完整值永远在 title 上。
            title: project === "" ? dshT("\u5168\u90E8\u9879\u76EE") : project,
            "aria-label": dshT("\u6309\u9879\u76EE\u7B5B\u9009"),
            onChange: function(e) {
              patch({ project: e.target.value });
            }
          },
          createElement("option", { key: "all", value: "" }, dshT("\u5168\u90E8\u9879\u76EE")),
          projectNames.map(function(pn) {
            return createElement("option", { key: pn, value: pn }, pn);
          })
        )
      )
    ),
    createElement(
      "div",
      { className: "usage-kpi-grid" },
      kpiCard("k-token", dshT("\u603B Token"), formatTokenCount(curK.tokens) || "0", curK.tokens, prevK.tokens),
      kpiCard("k-in", dshT("\u8F93\u5165 Token"), formatTokenCount(curK.input) || "0", curK.input, prevK.input),
      kpiCard("k-out", dshT("\u8F93\u51FA Token"), formatTokenCount(curK.output) || "0", curK.output, prevK.output),
      kpiCard("k-cache", dshT("\u7F13\u5B58 Token"), formatTokenCount(curK.cacheRead) || "0", curK.cacheRead, prevK.cacheRead),
      kpiCard("k-sessions", dshT("\u4F1A\u8BDD\u6570"), String(curK.sessions), curK.sessions, prevK.sessions, "accent"),
      kpiCard("k-usermsgs", dshT("\u7528\u6237\u6D88\u606F\u6570"), String(curK.userMsgs), curK.userMsgs, prevK.userMsgs),
      kpiCard("k-aimsgs", dshT("\u52A9\u624B\u6D88\u606F\u6570"), String(curK.assistantMsgs), curK.assistantMsgs, prevK.assistantMsgs),
      kpiCard("k-days", dshT("\u6D3B\u8DC3\u5929\u6570"), String(curK.activeDays), curK.activeDays, prevK.activeDays, "accent")
    ),
    createElement(
      "div",
      { className: "usage-dash-two" },
      createElement(
        "div",
        { className: "usage-panel" },
        createElement(
          "div",
          { className: "usage-panel-head" },
          createElement("span", { className: "usage-panel-title" }, dshT("\u{1F4C8} \u6BCF\u65E5\u8D8B\u52BF")),
          createElement(
            "span",
            { className: "usage-legend" },
            createElement("span", { className: "lg lg-out" }, dshT("\u8F93\u51FA")),
            createElement("span", { className: "lg lg-in" }, dshT("\u8F93\u5165")),
            createElement("span", { className: "lg lg-cache" }, dshT("\u7F13\u5B58"))
          )
        ),
        dayKeys.length > 0 ? createElement("div", { className: "usage-chart" }, dayBars) : createElement("div", { className: "usage-empty" }, dshT("\u8BE5\u65F6\u95F4\u8303\u56F4\u5185\u6CA1\u6709\u4F1A\u8BDD"))
      ),
      createElement(
        "div",
        { className: "usage-panel" },
        createElement(
          "div",
          { className: "usage-panel-head" },
          createElement("span", { className: "usage-panel-title" }, dshT("\u{1F552} \u5206\u65F6\u6D3B\u8DC3")),
          createElement("span", { className: "usage-legend" }, dshT("\u5C11 \u2592\u2592\u2592\u2592\u2592\u2592 \u591A"))
        ),
        createElement("div", { className: "usage-heat" }, heatRows),
        createElement("div", { className: "heat-hours" }, ["00", "03", "06", "09", "12", "15", "18", "21"].map(function(h) {
          return createElement("span", { key: h }, h);
        }))
      )
    ),
    projectNames.length > 0 ? createElement("div", { className: "usage-projects" }, projectRowsUI) : null,
    insights.length > 0 ? createElement("div", { className: "usage-insights" }, insights.map(function(tip, i2) {
      return createElement("div", { key: i2, className: "usage-insight" }, tip);
    })) : null
  );
}

// src/client/panels/workspaces.js
function WorkspacesSection(props) {
  var call = props.call;
  var kit = sectionState({
    available: true,
    workspaces: [],
    archivedSessionIds: [],
    // Serial unarchive loop in flight: the toolbar gesture must not be
    // re-triggerable while it runs (and the button shows progress).
    bulkUnarchiveBusy: false,
    busy: false,
    error: "",
    // pickerAvailable defaults to true: dsh ships at least one picker
    // backend in every web-app composition (browse as a fallback when
    // the native dialog is unreachable). The first pickDirectory() call
    // will downgrade this if the host has no picker seam at all.
    pickerBackend: null,
    pickerAvailable: true,
    // Create-form draft
    createOpen: false,
    createPath: "",
    createTitle: "",
    createBusy: false,
    createError: "",
    // Per-workspace transient state
    renameId: null,
    renameDraft: "",
    renameBusy: false,
    renameError: "",
    deleteId: null,
    deleteBusy: false,
    deleteError: "",
    expanded: {}
    // workspaceId -> bool
  });
  var state = kit.state;
  var setState = kit.set;
  var alive = kit.alive;
  function patch(partial) {
    kit.patch(partial);
  }
  function reload() {
    patch({ busy: true, error: "" });
    call("workspaceAdmin/list", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        patch({
          busy: false,
          available: v.available !== false,
          workspaces: Array.isArray(v.workspaces) ? v.workspaces : [],
          archivedSessionIds: Array.isArray(v.archivedSessionIds) ? v.archivedSessionIds : []
        });
      } else {
        patch({ busy: false, error: dshT("\u52A0\u8F7D\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u8C03\u7528\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  kit.mount(reload);
  function openCreate() {
    patch({ createOpen: true, createPath: "", createTitle: "", createError: "", createBusy: false });
  }
  function closeCreate() {
    patch({ createOpen: false, createPath: "", createTitle: "", createError: "", createBusy: false });
  }
  function setCreateField(field, value) {
    setState(function(cur) {
      var next = {};
      for (var k in cur) next[k] = cur[k];
      if (field === "path") next.createPath = value;
      else if (field === "title") next.createTitle = value;
      return next;
    });
  }
  function pickDirectory() {
    call("workspaceAdmin/pickDirectory", {}).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var v = result.value || {};
        if (state.pickerBackend === null) {
          patch({ pickerBackend: v.backend || null, pickerAvailable: v.available === true });
        }
        if (typeof v.path === "string" && v.path !== "") {
          patch({ createPath: v.path });
        }
      } else {
        patch({ createError: dshT("\u76EE\u5F55\u9009\u62E9\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ createError: dshT("\u76EE\u5F55\u9009\u62E9\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function submitCreate() {
    var path = state.createPath.trim();
    var title = state.createTitle.trim();
    if (path === "") {
      patch({ createError: dshT("\u8BF7\u63D0\u4F9B\u76EE\u5F55\u8DEF\u5F84\uFF08\u539F\u751F\u9009\u62E9\u6216\u624B\u52A8\u8F93\u5165\uFF09") });
      return;
    }
    patch({ createBusy: true, createError: "" });
    var args = { path };
    if (title !== "") args.title = title;
    call("workspaceAdmin/create", args).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        closeCreate();
        reload();
      } else {
        patch({ createBusy: false, createError: dshT("\u65B0\u5EFA\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ createBusy: false, createError: dshT("\u65B0\u5EFA\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function openRename(id, currentTitle) {
    patch({ renameId: id, renameDraft: currentTitle || "", renameError: "" });
  }
  function cancelRename() {
    patch({ renameId: null, renameDraft: "", renameError: "" });
  }
  function setRenameDraft(value) {
    patch({ renameDraft: value });
  }
  function submitRename() {
    var id = state.renameId;
    var title = state.renameDraft.trim();
    if (id === null || title === "") {
      patch({ renameError: dshT("\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A") });
      return;
    }
    patch({ renameBusy: true, renameError: "" });
    call("workspaceAdmin/rename", { workspaceId: id, title }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        patch({ renameId: null, renameDraft: "", renameBusy: false, renameError: "" });
        reload();
      } else {
        patch({ renameBusy: false, renameError: dshT("\u91CD\u547D\u540D\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ renameBusy: false, renameError: dshT("\u91CD\u547D\u540D\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function moveWorkspace(id, beforeId) {
    patch({ busy: true, error: "" });
    var args = { workspaceId: id };
    if (typeof beforeId === "string" && beforeId !== "") args.beforeWorkspaceId = beforeId;
    call("workspaceAdmin/insertBefore", args).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        reload();
      } else {
        patch({ busy: false, error: dshT("\u6392\u5E8F\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ busy: false, error: dshT("\u6392\u5E8F\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function moveUp(id, index) {
    if (index <= 0) return;
    var before = state.workspaces[index - 1];
    if (!before) return;
    moveWorkspace(id, before.workspaceId);
  }
  function moveDown(id, index) {
    var next = state.workspaces[index + 1];
    if (!next) return;
    var anchor = state.workspaces[index + 2];
    moveWorkspace(id, anchor ? anchor.workspaceId : void 0);
  }
  function askDelete(id) {
    patch({ deleteId: id, deleteError: "" });
  }
  function cancelDelete() {
    patch({ deleteId: null, deleteError: "" });
  }
  function confirmDelete() {
    var id = state.deleteId;
    if (id === null) return;
    patch({ deleteBusy: true, deleteError: "" });
    call("workspaceAdmin/delete", { workspaceId: id }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        patch({ deleteId: null, deleteBusy: false, deleteError: "" });
        reload();
      } else {
        patch({ deleteBusy: false, deleteError: dshT("\u5220\u9664\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ deleteBusy: false, deleteError: dshT("\u5220\u9664\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function checkStatus(id) {
    call("workspaceAdmin/status", { workspaceId: id }).then(function(result) {
      if (!alive.current) return;
      if (result.ok) {
        var status = result.value || "ok";
        if (status === "missing-dir") {
          patch({ error: dshT("\u26A0 \u8BE5\u5DE5\u4F5C\u533A\u7684\u76EE\u5F55\u5F53\u524D\u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u4E34\u65F6\u79FB\u8D70\uFF09\uFF1Bregistry \u4E0D\u4F1A\u6539\u5199\u8BB0\u5F55") });
        } else {
          patch({ error: "" });
        }
      } else {
        patch({ error: dshT("\u72B6\u6001\u68C0\u67E5\u5931\u8D25\uFF1A") + messageOf(result.error) });
      }
    }, function(err) {
      if (!alive.current) return;
      patch({ error: dshT("\u72B6\u6001\u68C0\u67E5\u5931\u8D25\uFF1A") + messageOf(err) });
    });
  }
  function bulkUnarchive() {
    if (state.archivedSessionIds.length === 0 || state.bulkUnarchiveBusy) return;
    var ids = state.archivedSessionIds.slice();
    patch({ bulkUnarchiveBusy: true });
    var step = function(i) {
      if (i >= ids.length || !alive.current) {
        if (alive.current) {
          patch({ bulkUnarchiveBusy: false });
          reload();
        }
        return;
      }
      call("workspaceAdmin/unarchiveSession", { sessionId: ids[i] }).then(function() {
        step(i + 1);
      }, function() {
        step(i + 1);
      });
    };
    step(0);
  }
  if (!state.available) {
    return createElement(
      "div",
      { "data-dsh-admin-section": "" },
      createElement(
        "div",
        { className: "group-header", key: "unavail" },
        createElement("span", { className: "group-title", key: "t" }, dshT("\u{1F4C1} \u5DE5\u4F5C\u533A")),
        createElement("span", { className: "group-count", key: "c" }, dshT("\u672C\u90E8\u7F72\u672A\u6302\u8F7D dsh-workspace\uFF08\u4EC5 web-app \u7F16\u6210\u81EA\u5E26\uFF09"))
      )
    );
  }
  var elements = [];
  if (state.busy) {
    elements.push(createElement(
      "div",
      { className: "busy-banner", key: "busy" },
      createElement("span", { className: "spinner", key: "sp" }),
      dshT("\u52A0\u8F7D\u4E2D\u2026")
    ));
  }
  if (state.error !== "") {
    elements.push(createElement("div", { className: "error", key: "err" }, state.error));
  }
  var toolbarChildren = [
    createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", key: "btn-create", disabled: state.createBusy, onClick: openCreate }, dshT("\u2795 \u65B0\u5EFA\u5DE5\u4F5C\u533A")),
    createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "btn-refresh", disabled: state.busy, onClick: reload }, dshT("\u27F3 \u5237\u65B0"))
  ];
  if (state.archivedSessionIds.length > 0) {
    toolbarChildren.push(createElement(import_dsh_client_ui_primitives.Button, {
      variant: "outline",
      key: "btn-bulk-unarchive",
      disabled: state.busy || state.bulkUnarchiveBusy,
      title: dshT("\u4E00\u952E\u53D6\u6D88\u5F52\u6863\u5168\u90E8\u5DF2\u5F52\u6863\u4F1A\u8BDD\uFF08\u4E0D\u5220\u9664\u4F1A\u8BDD\u672C\u4F53\uFF09"),
      onClick: bulkUnarchive
    }, state.bulkUnarchiveBusy ? dshT("\u6062\u590D\u4E2D\u2026") : dshT("\u{1F4E6} \u53D6\u6D88\u5168\u90E8\u5F52\u6863 (") + state.archivedSessionIds.length + ")"));
  }
  elements.push(createElement("div", { className: "toolbar", key: "toolbar" }, toolbarChildren));
  if (state.createOpen) {
    var pickerHint = state.pickerAvailable ? state.pickerBackend ? dshT("\u539F\u751F\u9009\u62E9\u5668\u540E\u7AEF\uFF1A") + state.pickerBackend : dshT("\u539F\u751F\u9009\u62E9\u5668\u53EF\u7528") : dshT("\u539F\u751F\u9009\u62E9\u5668\u4E0D\u53EF\u7528\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u7EDD\u5BF9\u8DEF\u5F84");
    elements.push(createElement(
      "div",
      { className: "card mcp-editor", key: "create-form", style: { display: "flex", flexDirection: "column", gap: "8px" } },
      createElement(
        "div",
        { key: "hdr", style: { display: "flex", gap: "8px", alignItems: "baseline" } },
        createElement("span", { style: { fontWeight: 600 } }, dshT("\u65B0\u5EFA\u5DE5\u4F5C\u533A")),
        createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-secondary, #61666b)" } }, pickerHint)
      ),
      createElement(
        "div",
        { key: "row-path", style: { display: "flex", gap: "6px" } },
        createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "pick", disabled: !state.pickerAvailable, onClick: pickDirectory }, dshT("\u{1F4C1} \u9009\u62E9\u76EE\u5F55")),
        createElement(import_dsh_client_ui_primitives.Input, { key: "path", placeholder: dshT("\u6216\u624B\u52A8\u8F93\u5165\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84"), value: state.createPath, onChange: function(e) {
          setCreateField("path", e.target.value);
        } })
      ),
      createElement(import_dsh_client_ui_primitives.Input, { key: "title", placeholder: dshT("\u663E\u793A\u6807\u9898\uFF08\u7559\u7A7A\u5219\u7528\u76EE\u5F55\u6700\u540E\u4E00\u6BB5\uFF09"), value: state.createTitle, onChange: function(e) {
        setCreateField("title", e.target.value);
      } }),
      state.createError !== "" ? createElement("div", { className: "error", key: "create-err", style: { fontSize: "12px" } }, state.createError) : null,
      createElement(
        "div",
        { key: "actions", style: { display: "flex", gap: "6px" } },
        createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", key: "save", disabled: state.createBusy || state.createPath.trim() === "", onClick: submitCreate }, state.createBusy ? dshT("\u521B\u5EFA\u4E2D\u2026") : dshT("\u4FDD\u5B58")),
        createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "cancel", disabled: state.createBusy, onClick: closeCreate }, dshT("\u53D6\u6D88"))
      )
    ));
  }
  if (state.workspaces.length === 0 && !state.createOpen) {
    elements.push(createElement("div", { className: "empty", key: "empty" }, dshT("\u6682\u65E0\u5DE5\u4F5C\u533A \u2014 \u70B9\u300C\u2795 \u65B0\u5EFA\u5DE5\u4F5C\u533A\u300D\u9009\u5B9A\u4E00\u4E2A\u76EE\u5F55\u4F5C\u4E3A\u9879\u76EE\u6839")));
  }
  for (let i = 0; i < state.workspaces.length; i++) {
    const ws = state.workspaces[i];
    const isFirst = i === 0;
    const isLast = i === state.workspaces.length - 1;
    const isRenaming = state.renameId === ws.workspaceId;
    const isDeleting = state.deleteId === ws.workspaceId;
    var headerChildren = [
      createElement("span", { className: "card-title-text", key: "title", title: ws.workspaceId }, isRenaming ? createElement(
        "span",
        { style: { display: "inline-flex", gap: "6px" } },
        createElement(import_dsh_client_ui_primitives.Input, {
          value: state.renameDraft,
          autoFocus: true,
          onChange: function(e) {
            setRenameDraft(e.target.value);
          },
          onKeyDown: function(e) {
            if (e.key === "Enter") submitRename();
            else if (e.key === "Escape") cancelRename();
          }
        }),
        createElement(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", key: "rename-save", disabled: state.renameBusy, onClick: submitRename }, dshT("\u4FDD\u5B58")),
        createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "rename-cancel", disabled: state.renameBusy, onClick: cancelRename }, dshT("\u53D6\u6D88"))
      ) : ws.title || ws.path),
      createElement("span", { className: "group-path", key: "path", title: ws.path, style: { fontSize: "11px" } }, "\u{1F4C1} " + ws.path)
    ];
    var actionChildren = [];
    if (!isRenaming) {
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "btn-rename", onClick: function() {
        openRename(ws.workspaceId, ws.title);
      } }, dshT("\u270E \u91CD\u547D\u540D")));
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "btn-status", title: dshT("\u68C0\u67E5\u76EE\u5F55\u662F\u5426\u4ECD\u5B58\u5728\uFF08\u4E0D\u4FEE\u6539\u8BB0\u5F55\uFF09"), onClick: function() {
        checkStatus(ws.workspaceId);
      } }, dshT("\u{1F50E} \u68C0\u67E5\u72B6\u6001")));
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "btn-up", disabled: isFirst || state.busy, onClick: function() {
        moveUp(ws.workspaceId, i);
      } }, "\u2B06"));
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", key: "btn-down", disabled: isLast || state.busy, onClick: function() {
        moveDown(ws.workspaceId, i);
      } }, "\u2B07"));
      actionChildren.push(createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", className: "danger", key: "btn-del", onClick: function() {
        askDelete(ws.workspaceId);
      } }, isDeleting ? "\u2715" : dshT("\u5220\u9664")));
    }
    var cardChildren = [
      createElement(
        "div",
        { className: "card-header", key: "h" },
        createElement("span", { className: "card-title", key: "title-row" }, headerChildren),
        actionChildren.length > 0 ? createElement("span", { className: "card-actions", key: "a" }, actionChildren) : null
      ),
      state.renameError !== "" && isRenaming ? createElement("div", { className: "error", key: "rename-err", style: { fontSize: "12px" } }, state.renameError) : null,
      isDeleting ? createElement(
        "div",
        { className: "confirm-bar", key: "confirm" },
        createElement("span", { className: "confirm-text" }, dshT("\u786E\u5B9A\u5220\u9664\u5DE5\u4F5C\u533A\u300C"), ws.title || ws.path, dshT("\u300D\uFF1F\uFF08\u4EC5\u5220\u9664\u6CE8\u518C\uFF0C\u76EE\u5F55\u4E0E\u4F1A\u8BDD\u672C\u4F53\u4FDD\u7559\uFF09")),
        createElement(
          "span",
          { className: "confirm-actions" },
          createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: cancelDelete, key: "cancel" }, dshT("\u53D6\u6D88")),
          createElement(import_dsh_client_ui_primitives.Button, {
            variant: "outline",
            size: "sm",
            className: "danger-solid",
            disabled: state.deleteBusy,
            onClick: confirmDelete,
            key: "confirm-btn"
          }, state.deleteBusy ? dshT("\u5220\u9664\u4E2D\u2026") : dshT("\u5220\u9664"))
        )
      ) : null,
      createElement(
        "div",
        { className: "card-sub", key: "sub" },
        createElement("span", { className: "card-sub-item" }, "\u{1F4CA} " + (Array.isArray(ws.sessionIds) ? ws.sessionIds.length : 0) + dshT(" \u4E2A\u4F1A\u8BDD")),
        ws.createdAt ? createElement("span", { className: "card-sub-item", style: { marginLeft: "12px", color: "var(--dsw-alias-label-secondary, #61666b)" } }, dshT("\u521B\u5EFA\u4E8E ") + ws.createdAt.slice(0, 10)) : null,
        ws.updatedAt ? createElement("span", { className: "card-sub-item", style: { marginLeft: "12px", color: "var(--dsw-alias-label-secondary, #61666b)" } }, dshT("\u66F4\u65B0\u4E8E ") + ws.updatedAt.slice(0, 10)) : null
      )
    ];
    elements.push(createElement("div", { className: "card", key: "ws-" + ws.workspaceId }, cardChildren));
  }
  return createElement("div", { "data-dsh-admin-section": "" }, elements);
}
return module.exports
} });
