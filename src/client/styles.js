/**
 * Injected stylesheets: one CSS text block per panel family, each installed
 * once per page through its own inject*Styles() call. The blocks are plain
 * strings appended as <style data-plugin-css> tags so the loader's HMR
 * bookkeeping can claim them (client-modules claims untagged tags for the
 * materializing plugin).
 */

var CSS_TEXT = [
  '@keyframes dsh-admin-spin { to { transform: rotate(360deg); } }',
  '@keyframes dsh-admin-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.85); } }',
  // Root viewport: height-bounded AND scrollable (overflow-y:auto, not the
  // old overflow:hidden) — tall panels like the 用量仪表盘 (KPI grid + charts
  // + insights stack far past one dialog) must scroll to their tail, not clip.
  '[data-dsh-admin-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); max-height: calc(100vh - 140px); overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)) transparent; }',
  '[data-dsh-admin-section] *, [data-dsh-sa-section] *, [data-cha-section] *, [data-dsh-admin-todo] * { box-sizing: border-box; }',
  '[data-dsh-admin-section] .toolbar, [data-dsh-sa-section] .toolbar, [data-cha-section] .toolbar { display: flex; gap: 8px; align-items: center; padding: 10px 20px 10px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); }',
  // Phase B3e follow-up: the workflow fields are the official Input now, so the
// width/margin their inline style used to carry lives here (the atom's wrapper is
// inline-flex and would otherwise shrink to content).
'[data-dsh-admin-section] .wf-input { display: flex; width: 100%; margin-bottom: 8px; }',
'[data-dsh-admin-section] .toolbar .input { height: 32px; padding: 0 12px; border-radius: 8px; border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); }',
  '[data-dsh-admin-section] .search-wrap, [data-dsh-sa-section] .search-wrap { flex: 1.6; min-width: 0; position: relative; display: flex; align-items: center; height: 32px; }',
  '[data-dsh-admin-section] .search-wrap .input, [data-dsh-sa-section] .search-wrap .input { flex: 1; min-width: 0; padding-left: 30px; font-size: 13px; }',
  '[data-dsh-admin-section] .session-search { flex: 1; height: 32px; }',
  '[data-dsh-admin-section] .session-search .input { height: 32px; padding: 0 12px 0 30px; font-size: 13px; border-radius: 8px; border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); }',
  '[data-dsh-admin-section] .install-wrap { flex: 1; min-width: 0; display: flex; align-items: center; height: 32px; }',
  '[data-dsh-admin-section] .install-wrap .input { flex: 1; min-width: 0; font-size: 13px; border-radius: 8px; border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); }',
'[data-dsh-admin-section] .search-icon, [data-dsh-sa-section] .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; opacity: 0.7; pointer-events: none; z-index: 1; }',
  '[data-dsh-admin-section] .input, [data-dsh-sa-section] .input, [data-cha-section] .input { width: 100%; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); background: var(--dsw-alias-bg-base, transparent); color: inherit; font: inherit; outline: none; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; }',
  '[data-dsh-admin-section] .input:hover, [data-dsh-sa-section] .input:hover, [data-cha-section] .input:hover { border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); }',
  '[data-dsh-admin-section] .input:focus, [data-dsh-sa-section] .input:focus, [data-cha-section] .input:focus { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }',
  // Dropdowns share the .input chrome but lose the native widget: one chevron,
  // ellipsis overflow and a pointer cursor — the same face for every select
  // across the admin, sub-agent and command-hook panels.
  '[data-dsh-admin-section] select.input, [data-dsh-sa-section] select.input, [data-cha-section] select.input { appearance: none; -webkit-appearance: none; padding-right: 30px; cursor: pointer; text-overflow: ellipsis; background-image: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2710%27%20height=%276%27%20viewBox=%270%200%2010%206%27%3E%3Cpath%20d=%27M1%201l4%204%204-4%27%20stroke=%27%239aa0a6%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; }',
  // The popup list itself is native, but option colors still follow the theme.
  '[data-dsh-admin-section] select.input option, [data-dsh-sa-section] select.input option, [data-cha-section] select.input option { background: var(--dsw-alias-bg-elevated, #fff); color: var(--dsw-alias-label-primary, #222); }',
  // Horizontal inset matched to the toolbar's (left = the toolbar's 10px, so
  // the pills line up with the search box) and to the LIST's content inset on
  // the right (scrollbar gutter 10 + list padding 4 + group-header padding 6),
  // so the tail actions, the toolbar's buttons and every directory's button
  // share one right edge.
  '[data-dsh-admin-section] .filter-bar { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; padding: 0 0 0 10px; }',
  // The injected archived-sessions panel renders as ONE framed card on the
  // host page; the flex gap on .session-panel provides the vertical rhythm.
  '[data-dsh-admin-section] .session-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px 10px; border: 1px solid var(--dsh-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); }',
  // Inside that card the search row is a plain row, not a nested box.
  '[data-dsh-admin-section] .session-panel .toolbar { border: none; border-radius: 0; background: transparent; padding: 0; }',
  // The filter bar's tail actions stay one group: `margin-left: auto` pushes
  // the whole cluster right, and because it is a single flex item it never
  // splits across the wrap (the bare buttons used to strand 删除当前 alone on
  // a second line while 全部展开 sat at the far right of the first).
  '[data-dsh-admin-section] .filter-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }',
  // 选中胶囊：文字用主题自适应的 label-primary（浅 15:1 / 深 15:1），蓝色只留在
  // 底色与描边上——原来的蓝色文字只有 3.4:1，11px 下不达标。
  // 面板内的行内代码统一成一套：宿主对裸 <code> 的着色只有 3.7:1，且各面板不一致。
  '[data-dsh-admin-section] code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace); font-size: 0.94em; padding: 1px 5px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.2)); color: var(--dsw-alias-label-primary, #222); }',
  // 主按钮填充用 blue-600（白字 5.2:1）而非 blue-500（白字 3.7:1，达不到正文 AA）。
  // hover 往深走而不是往浅走：浅色 hover 会把白字压到 2.8:1。
  '[data-dsh-admin-section] .danger, [data-dsh-sa-section] .danger, [data-cha-section] .danger { color: var(--dsw-alias-state-error-primary, #dc2626); border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); }',
  // Outline-danger buttons fill softly on hover so the red stays quiet at
  // rest but the affordance is obvious before the click.
  '[data-dsh-admin-section] .danger:hover:not(:disabled), [data-dsh-sa-section] .danger:hover:not(:disabled), [data-cha-section] .danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.08); border-color: rgba(220, 38, 38, 0.45); }',
  '[data-dsh-admin-section] .danger:hover:not(:disabled), [data-dsh-sa-section] .danger:hover:not(:disabled), [data-cha-section] .danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.1)); border-color: rgba(220,38,38,0.35); color: #b91c1c; }',
  '[data-dsh-admin-section] .danger-solid, [data-dsh-sa-section] .danger-solid { background: #b91c1c; color: #fff; border-color: transparent; }',
  '[data-dsh-admin-section] .danger-solid:hover:not(:disabled) { background: #b91c1c; color: #fff; }',
  '[data-dsh-admin-section] .danger-solid:active:not(:disabled) { background: #991b1b; color: #fff; }',
  // Plugin grid (扩展插件) card buttons sit on their own row; keep them
  // compact so three buttons fit a half-width card without crowding.
  // Extra-small: the filter bar's tail actions, sized to the pill row's own
  // weight (pills are 21px tall at 11px type) so the bar reads as one line.
  '[data-dsh-admin-section] .spinner, [data-dsh-sa-section] .spinner { width: 12px; height: 12px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: dsh-admin-spin 0.7s linear infinite; display: inline-block; flex: none; }',
  '[data-dsh-admin-section] .list, [data-dsh-sa-section] .list, [data-cha-section] .list { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; max-height: 560px; overflow-y: auto; padding: 2px 4px 2px 2px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)) transparent; scrollbar-gutter: stable; }',
  '[data-dsh-admin-section] .list.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-content: start; }',
  '[data-dsh-admin-section] .list.grid2 .empty { grid-column: 1 / -1; }',
  '[data-dsh-admin-section] .list.grid2 .card { cursor: pointer; }',
  '[data-dsh-admin-section] .list.grid2 .card:hover { transform: none; border-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); box-shadow: none; }',
  '[data-dsh-admin-section] .list::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-section] .list::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); }',
  '[data-dsh-admin-section] .session-group { display: flex; flex-direction: column; gap: 6px; }',
  '[data-dsh-admin-section] .group-header { display: flex; align-items: center; gap: 8px; padding: 9px 12px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); margin-bottom: 6px; }',
  '[data-dsh-admin-section] .group-header:first-child { margin-top: 2px; }',
  '[data-dsh-admin-section] .group-title { display: inline-flex; align-items: center; gap: 6px; }',
  '[data-dsh-admin-section] .group-count { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); color: var(--dsw-alias-label-secondary, #555); font-weight: 500; }',
  '[data-dsh-admin-section] .group-header .group-action { margin-left: auto; }',
  '[data-dsh-admin-section] .group-header .group-action + .group-action { margin-left: 0; }',
  '[data-dsh-admin-section] .group-path { font-family: monospace; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; text-align: right; }',
  // Collapsible directory groups: the header toggles its session list.
  '[data-dsh-admin-section] .group-header { cursor: pointer; user-select: none; transition: background 0.12s ease, border-color 0.12s ease; }',
  '[data-dsh-admin-section] .group-header:hover { border-color: var(--dsw-alias-border-l1, rgba(160,160,180,0.6)); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.18)); }',
  '[data-dsh-admin-section] .group-caret { flex: none; width: 12px; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); transition: transform 0.15s ease; }',
  '[data-dsh-admin-section] .group-header.collapsed { margin-bottom: 8px; }',
  '[data-dsh-admin-section] .group-collapsed-note { flex: none; font-size: 10px; line-height: 1; padding: 3px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.45)); color: var(--dsw-alias-label-secondary, #61666b); font-weight: 400; }',
  // Bulk-delete confirmation bar (reuses .confirm-bar's danger recipe).
  '[data-dsh-admin-section] .bulk-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(239,68,68,0.25); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.06)); font-size: 12px; }',
  '[data-dsh-admin-section] .bulk-bar .bulk-text { color: var(--dsw-alias-state-error-primary, #ef4444); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-dsh-admin-section] .bulk-bar .bulk-actions { display: flex; gap: 5px; flex: none; }',
  '[data-dsh-admin-section] .card, [data-dsh-sa-section] .card { display: flex; flex-direction: column; gap: 7px; padding: 12px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }',
  // MCP editor: the section root is height-bounded, but the editor form must
  // not scroll the WHOLE panel — a tall form (e.g. with reconnect fields
  // expanded) would push its bottom action row, including the 保存 button,
  // out of view. The editor keeps its own scroll viewport instead.
  '[data-dsh-admin-section] .mcp-editor { flex: 1 1 auto; min-height: 0; max-height: calc(100vh - 200px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)) transparent; }',
  '[data-dsh-admin-section] .mcp-editor::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-section] .mcp-editor::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); }',
  // Keep the action row (取消 / 保存) pinned at the bottom of the editor card
  // and always within the scroll viewport, even on short windows.
  '[data-dsh-admin-section] .usage-dash { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--dsw-static-blue-500, #3b82f6); border-radius: 12px; background: var(--dsw-specific-tip, var(--dsw-alias-bg-elevated, transparent)); box-shadow: 0 0 0 2px rgba(59,130,246,0.10); }',
  '[data-dsh-admin-section] .usage-chart { display: flex; align-items: flex-end; gap: 4px; height: 88px; padding: 4px 2px 0 2px; }',
  '[data-dsh-admin-section] .usage-bar-col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; }',
  '[data-dsh-admin-section] .usage-bar-label { font-size: 9px; color: var(--dsw-alias-label-secondary, #61666b); white-space: nowrap; }',
  '[data-dsh-admin-section] .usage-projects { display: flex; flex-direction: column; gap: 4px; }',
  '[data-dsh-admin-section] .usage-project { display: flex; align-items: center; gap: 8px; font-size: 12px; }',
  '[data-dsh-admin-section] .usage-project-name { flex: none; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-primary, #222); font-weight: 500; }',
  '[data-dsh-admin-section] .usage-project-track { flex: 1 1 auto; min-width: 0; height: 8px; border-radius: 99px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.35)); overflow: hidden; }',
  '[data-dsh-admin-section] .usage-project-fill { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--dsw-static-blue-400, #60a5fa), var(--dsw-static-blue-500, #3b82f6)); }',
  '[data-dsh-admin-section] .usage-project-num { flex: none; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-section] .usage-insights { display: flex; flex-direction: column; gap: 4px; border-top: 1px dashed var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); padding-top: 8px; }',
  '[data-dsh-admin-section] .usage-insight { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-section] .usage-empty { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }',
  // 用量仪表盘 —— 工业实用方向：发丝边框、等宽数字、状态色，成组而非散装控件。
  // 与宿主 dsh 的令牌体系保持一致（`--dsw-*`），不引入自有字体/配色：这是嵌在
  // 设置弹窗里的面板，旁边的每个面板都共用同一套字栈与语义色，自带展示字只会让
  // 它显得像外来物。
  '[data-dsh-admin-section] .usage-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 8px; }',
  '[data-dsh-admin-section] .usage-group { display: flex; align-items: center; gap: 6px; min-width: 0; }',
  '[data-dsh-admin-section] .usage-group-label { flex: none; font-size: 11px; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary, #61666b); }',
  // 筛选：标签与选择框焊成同一个控件（发丝边框 + 前缀段），窄屏换行时也不会被拆开。
  // 宽度按控件该有的尺寸给：基准 200px 让它能和日期那组同排（否则会摊成一条通栏长条），
  // 有余量时向右长到 360px 以容纳长项目名，真挤不下才整组换行。
  '[data-dsh-admin-section] .usage-filter { display: flex; flex-wrap: nowrap; align-items: stretch; flex: 1 1 200px; min-width: 170px; max-width: 360px; height: 30px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-base, transparent); }',
  '[data-dsh-admin-section] .usage-filter:hover { border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); }',
  '[data-dsh-admin-section] .usage-filter:focus-within { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }',
  '[data-dsh-admin-section] .usage-filter-label { flex: none; display: inline-flex; align-items: center; padding: 0 9px; font-size: 11px; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary, #61666b); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.18)); border-right: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.45)); }',
  '[data-dsh-admin-section] .usage-filter .usage-project-select { flex: 1 1 auto; width: auto; min-width: 0; max-width: 100%; height: 100%; border: none; border-radius: 0; background-color: transparent; appearance: none; -webkit-appearance: none; padding: 0 30px 0 10px; cursor: pointer; text-overflow: ellipsis; background-image: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2710%27%20height=%276%27%20viewBox=%270%200%2010%206%27%3E%3Cpath%20d=%27M1%201l4%204%204-4%27%20stroke=%27%239aa0a6%27%20stroke-width=%271.5%27%20fill=%27none%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; }',
  '[data-dsh-admin-section] .usage-filter .usage-project-select:focus { box-shadow: none; }',
  // 一次编排好的入场：每个面板的顶层块依次升起 6px，错峰 60ms（3–5 组）。只动
  // opacity/transform，reduce 下整段关闭。用量仪表盘内部还有一层自己的编排，两层
  // 叠成「先头部、再卡片、再分块」的节奏。
  '@keyframes dsh-panel-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
  '[data-dsh-admin-section] > *, [data-dsh-sa-section] > *, [data-cha-section] > * { animation: dsh-panel-rise 320ms cubic-bezier(0.16, 1, 0.3, 1) both; }',
  '[data-dsh-admin-section] > *:nth-child(2), [data-dsh-sa-section] > *:nth-child(2), [data-cha-section] > *:nth-child(2) { animation-delay: 60ms; }',
  '[data-dsh-admin-section] > *:nth-child(3), [data-dsh-sa-section] > *:nth-child(3), [data-cha-section] > *:nth-child(3) { animation-delay: 120ms; }',
  '[data-dsh-admin-section] > *:nth-child(4), [data-dsh-sa-section] > *:nth-child(4), [data-cha-section] > *:nth-child(4) { animation-delay: 180ms; }',
  '[data-dsh-admin-section] > *:nth-child(n+5), [data-dsh-sa-section] > *:nth-child(n+5), [data-cha-section] > *:nth-child(n+5) { animation-delay: 240ms; }',
  // 仪表盘内部沿用同一套 keyframes（头部已随面板入场），不再各留一份定义。
  '[data-dsh-admin-section] .usage-dash > * { animation: dsh-panel-rise 320ms cubic-bezier(0.16, 1, 0.3, 1) both; }',
  '[data-dsh-admin-section] .usage-dash > *:nth-child(2) { animation-delay: 60ms; }',
  '[data-dsh-admin-section] .usage-dash > *:nth-child(3) { animation-delay: 120ms; }',
  '[data-dsh-admin-section] .usage-dash > *:nth-child(4) { animation-delay: 180ms; }',
  '[data-dsh-admin-section] .usage-dash > *:nth-child(n+5) { animation-delay: 240ms; }',
  '@media (prefers-reduced-motion: reduce) { [data-dsh-admin-section] > *, [data-dsh-sa-section] > *, [data-cha-section] > *, [data-dsh-admin-section] .usage-dash > * { animation: none; } }',
  // 用量仪表盘 head：标题 + 弱化副标题 + 一个状态 chip（自动快照节奏）。
  // 状态用「圆点 + 文字」而非仅颜色，色盲用户也能读；节奏直接写在 chip 上。
  '[data-dsh-admin-section] .usage-head { flex-wrap: wrap; row-gap: 6px; }',
  '[data-dsh-admin-section] .usage-head .title { font-weight: 700; }',
  '[data-dsh-admin-section] .usage-head .spacer { flex: 1 1 auto; }',
  '[data-dsh-admin-section] .usage-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-section] .usage-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; line-height: 1; padding: 4px 9px; border-radius: 99px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.45)); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.18)); color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; font-variant-numeric: tabular-nums; }',
  '[data-dsh-admin-section] .usage-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }',
  '[data-dsh-admin-section] .usage-chip .sep { opacity: 0.7; }',
  // 状态胶囊同样做成实心：`--dsw-alias-state-success-primary`(#22c55e) 当文字用只有
  // 2.3:1，且该 token 在浅/深两套主题下同值，靠 token 换色救不回来。实心填充与主题无关，
  // 白字稳定 >= 4.5:1。
  '[data-dsh-admin-section] .usage-chip.on { background: #15803d; border-color: transparent; color: #fff; }',
  '[data-dsh-admin-section] .usage-chip.off { background: #b45309; border-color: transparent; color: #fff; }',
  // 选择框本身不画边框（边框归 `.usage-filter` 那一圈），放不下时省略号收尾，
  // 完整值永远在 `title` 上——窄弹窗里 30 字的中文项目名不可能全塞下。
  '[data-dsh-admin-section] .usage-project-select { width: auto; min-width: 132px; max-width: 100%; flex: 1 1 auto; height: 30px; text-overflow: ellipsis; }',
  '[data-dsh-admin-section] .usage-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }',
  '[data-dsh-admin-section] .usage-kpi { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-bg-base, transparent); }',
  '[data-dsh-admin-section] .usage-kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }',
  '[data-dsh-admin-section] .usage-kpi-label { font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-section] .usage-kpi-delta { font-size: 10px; font-variant-numeric: tabular-nums; }',
  '[data-dsh-admin-section] .usage-kpi-delta.up { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-section] .usage-kpi-delta.down { color: var(--dsw-alias-state-error-primary, #dc2626); }',
  '[data-dsh-admin-section] .usage-kpi-value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 20px; font-weight: 700; color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-admin-section] .usage-kpi.accent .usage-kpi-value { color: var(--dsw-alias-state-business-primary, #4176e6); }',
  '[data-dsh-admin-section] .usage-dash-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }',
  '[data-dsh-admin-section] .usage-panel { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-bg-base, transparent); }',
  '[data-dsh-admin-section] .usage-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
  '[data-dsh-admin-section] .usage-panel-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-admin-section] .usage-legend { display: inline-flex; gap: 8px; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-section] .usage-legend .lg { display: inline-flex; align-items: center; gap: 3px; }',
  '[data-dsh-admin-section] .usage-legend .lg::before { content: ""; width: 8px; height: 8px; border-radius: 2px; display: inline-block; }',
  '[data-dsh-admin-section] .usage-legend .lg-out::before { background: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-section] .usage-legend .lg-in::before { background: var(--dsw-static-blue-300, #93c5fd); }',
  '[data-dsh-admin-section] .usage-legend .lg-cache::before { background: var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); }',
  '[data-dsh-admin-section] .usage-chart { display: flex; align-items: flex-end; gap: 3px; height: 110px; }',
  '[data-dsh-admin-section] .usage-bar-col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 2px; }',
  '[data-dsh-admin-section] .usage-bar-stack { display: flex; flex-direction: column; justify-content: flex-end; width: 100%; max-width: 30px; height: 100%; }',
  '[data-dsh-admin-section] .usage-bar-stack .seg { display: block; width: 100%; }',
  '[data-dsh-admin-section] .usage-bar-stack .seg-out { background: var(--dsw-static-blue-500, #3b82f6); border-radius: 2px 2px 0 0; }',
  '[data-dsh-admin-section] .usage-bar-stack .seg-in { background: var(--dsw-static-blue-300, #93c5fd); }',
  '[data-dsh-admin-section] .usage-bar-stack .seg-cache { background: var(--dsw-alias-border-l2, rgba(200,200,210,0.45)); border-radius: 0 0 2px 2px; }',
  '[data-dsh-admin-section] .usage-bar-label { font-size: 9px; color: var(--dsw-alias-label-secondary, #61666b); white-space: nowrap; }',
  '[data-dsh-admin-section] .usage-heat { display: flex; flex-direction: column; gap: 3px; }',
  '[data-dsh-admin-section] .heat-row { display: flex; align-items: center; gap: 6px; }',
  '[data-dsh-admin-section] .heat-row-label { flex: none; width: 30px; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-section] .heat-cells { display: flex; gap: 3px; flex: 1; }',
  '[data-dsh-admin-section] .heat-cell { flex: 1 1 0; aspect-ratio: 1; border-radius: 3px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.2)); }',
  '[data-dsh-admin-section] .heat-cell.lvl1 { background: rgba(59,130,246,0.15); }',
  '[data-dsh-admin-section] .heat-cell.lvl2 { background: rgba(59,130,246,0.3); }',
  '[data-dsh-admin-section] .heat-cell.lvl3 { background: rgba(59,130,246,0.5); }',
  '[data-dsh-admin-section] .heat-cell.lvl4 { background: rgba(59,130,246,0.75); }',
  '[data-dsh-admin-section] .heat-cell.lvl5 { background: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-section] .heat-hours { display: flex; justify-content: space-between; padding-left: 36px; font-size: 9px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-section] .usage-empty { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-section] .usage-strip { display: flex; gap: 12px; align-items: center; padding: 7px 12px; border: 1px dashed var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary, #555); background: var(--dsw-alias-bg-base, transparent); }',
  '[data-dsh-admin-section] .usage-strip .usage-num { font-weight: 600; color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-admin-section] .pin-active { color: var(--dsw-static-blue-500, #3b82f6); border-color: currentColor; font-weight: 600; }',
  '[data-dsh-admin-section] .mcp-playground { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 2px rgba(59,130,246,0.12); }',
  '[data-dsh-admin-section] .mcp-playground textarea.input { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; resize: vertical; }',
  '[data-dsh-admin-section] .mcp-playground-out { margin: 6px 0 0 0; padding: 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 8px; background: var(--dsw-alias-bg-base, transparent); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-admin-section] .mcp-editor .card-actions { position: sticky; bottom: 0; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff)); padding-top: 10px; margin-top: 4px; }',
  // When the editor is open alongside the list (editing an existing entry), the
  // list must not compete for the bounded section height or the editor's 保存
  // button gets pushed below the clipped region. Let the list shrink to its
  // content instead of claiming flex space.
  '[data-dsh-admin-section].mcp-editor-open .list { flex: 0 1 auto; max-height: 140px; }',
  '[data-dsh-admin-section] .card:hover, [data-dsh-sa-section] .card:hover { transform: translateY(-1px); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }',
  '[data-dsh-admin-section] .card-header, [data-dsh-sa-section] .card-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }',
  '[data-dsh-admin-section] .card-title, [data-dsh-sa-section] .card-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; flex-wrap: wrap; align-items: center; gap: 7px; min-width: 0; flex: 1; }',
  '[data-dsh-admin-section] .card-title-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }',
  '[data-dsh-admin-section] .card-summary { display: flex; align-items: flex-start; gap: 6px; padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); border-left: 2px solid var(--dsw-static-blue-500, #3b82f6); font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #555); margin-top: 1px; margin-bottom: 1px; }',
  '[data-dsh-admin-section] .summary-icon { font-size: 11px; line-height: 1.45; flex: none; opacity: 0.85; }',
  '[data-dsh-admin-section] .summary-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; }',
  '[data-dsh-admin-section] .card-sub, [data-dsh-sa-section] .card-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
  '[data-dsh-admin-section] .card-sub-item { display: inline-flex; align-items: center; gap: 3px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-dsh-admin-section] .card-actions, [data-dsh-sa-section] .card-actions { display: flex; gap: 5px; align-items: center; flex: none; }',
  '[data-dsh-admin-section] .tag, [data-dsh-sa-section] .tag, [data-cha-section] .tag { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; flex: none; display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-section] .tag.plugin { background: #15803d; color: #fff; }',
  '[data-dsh-admin-section] .tag.local { background: #1d4ed8; color: #fff; }',
  '[data-dsh-admin-section] .tag.update { background: #b45309; color: #fff; font-weight: 600; }',
  '[data-dsh-admin-section] .tag.update-error { background: #b91c1c; color: #fff; }',
  '[data-dsh-admin-section] .plugin-path { font-family: monospace; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 4px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); }',
  '[data-dsh-admin-section] .tag.version { font-family: monospace; }',
  '[data-dsh-admin-section] .tag.live, [data-dsh-sa-section] .tag.live { background: #15803d; color: #fff; font-weight: 600; }',
  '[data-dsh-admin-section] .tag.archived { background: #b45309; color: #fff; }',
  '[data-dsh-admin-section] .tag.turns { background: #1d4ed8; color: #fff; font-weight: 500; }',
  '[data-dsh-admin-section] .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary, #999); }',
  '[data-dsh-admin-section] .dot.live { background: var(--dsw-alias-state-success-primary, #10b981); box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25); animation: dsh-admin-pulse 2s infinite ease-in-out; }',
  '[data-dsh-admin-section] .dot.archived { background: var(--dsw-alias-state-warn-label, #f59e0b); }',
  '[data-dsh-admin-section] .confirm-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); border: 1px solid rgba(239,68,68,0.2); }',
  '[data-dsh-admin-section] .confirm-text { font-size: 11px; color: var(--dsw-alias-state-error-primary, #ef4444); font-weight: 500; }',
  '[data-dsh-admin-section] .confirm-actions { display: flex; gap: 5px; flex: none; }',
  '[data-dsh-admin-section] .busy-banner { display: flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 7px; background: rgba(59, 130, 246, 0.08); color: var(--dsw-static-blue-500, #3b82f6); font-size: 11px; }',
  '[data-dsh-admin-section] .update-strip { display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: 8px; font-size: 12px; font-weight: 500; line-height: 1.4; }',
  '[data-dsh-admin-section] .update-strip button { margin-left: auto; flex: none; }',
  '[data-dsh-admin-section] .update-strip.checking { background: rgba(59, 130, 246, 0.08); color: var(--dsw-alias-label-primary, #222); box-shadow: inset 3px 0 0 var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-section] .update-strip.ok { background: rgba(16, 185, 129, 0.10); color: var(--dsw-alias-label-primary, #222); box-shadow: inset 3px 0 0 #15803d; }',
  '[data-dsh-admin-section] .update-strip.has-updates { background: rgba(245, 158, 11, 0.12); color: var(--dsw-alias-label-primary, #222); box-shadow: inset 3px 0 0 #b45309; }',
  '[data-dsh-admin-section] .update-strip.has-errors { background: rgba(239, 68, 68, 0.08); color: var(--dsw-alias-label-primary, #222); box-shadow: inset 3px 0 0 #b91c1c; }',
  '[data-dsh-admin-section] .empty, [data-dsh-sa-section] .empty, [data-cha-section] .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 12px; color: var(--dsw-alias-label-secondary, #61666b); gap: 4px; font-size: 12px; text-align: center; }',
  '[data-dsh-admin-section] .error { padding: 7px 11px; border-radius: 7px; color: var(--dsw-alias-state-error-primary, #ef4444); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); font-size: 12px; white-space: pre-wrap; max-height: 100px; overflow-y: auto; }',
  '[data-dsh-admin-section] .note-ok { padding: 7px 11px; border-radius: 7px; color: #047857; background: rgba(16,185,129,0.1); font-size: 12px; white-space: pre-wrap; }',
  '[data-dsh-admin-section] .footer { display: flex; justify-content: space-between; align-items: center; padding-top: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.3)); flex: none; }',
  '[data-dsh-admin-section] .footer .path { max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-dsh-admin-section] .footer .hint { font-style: normal; }',
  '[data-dsh-admin-section] .session-id-badge { font-family: monospace; font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-section] .mcp-test-row { padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }',
  '[data-dsh-admin-section] .mcp-test { display: inline-flex; align-items: center; gap: 5px; }',
  '[data-dsh-admin-section] .mcp-test.mcp-test-list { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }',
  '[data-dsh-admin-section] .mcp-test-busy { color: var(--dsw-alias-label-secondary, #666); }',
  '[data-dsh-admin-section] .mcp-test-ok { color: #16a34a; }',
  '[data-dsh-admin-section] .mcp-test-fail { color: var(--dsw-alias-state-error-primary, #ef4444); }',
  '[data-dsh-admin-section] .mcp-test-warn { color: #d97706; opacity: 0.95; }',
  '[data-dsh-admin-section] .mcp-test-cached { font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '@media (max-width: 520px) { [data-dsh-admin-section] { gap: 10px; } [data-dsh-admin-section] .list.grid2 { grid-template-columns: 1fr; } [data-dsh-admin-section] .toolbar { align-items: stretch; flex-wrap: wrap; padding: 8px; } [data-dsh-admin-section] .toolbar .input-wrap { flex-basis: 100%; } [data-dsh-admin-section] .card-header { align-items: flex-start; } [data-dsh-admin-section] .card-actions { flex-wrap: wrap; justify-content: flex-end; } [data-dsh-admin-section] .footer { gap: 6px; align-items: flex-start; flex-direction: column; } [data-dsh-admin-section] .footer .path { max-width: 100%; } }',
  '@keyframes dsh-toast-in { 0% { opacity: 0; transform: translateY(-12px) scale(0.96); } 100% { opacity: 1; transform: translateY(0) scale(1); } }',
  '@keyframes dsh-toast-out { 0% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-8px) scale(0.96); } }',
  '.dsh-admin-toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 99999; padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; line-height: 1.4; box-shadow: 0 8px 30px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08); display: flex; align-items: center; gap: 8px; pointer-events: none; animation: dsh-toast-in 0.25s ease-out forwards; max-width: 90vw; word-break: break-word; }',
  '.dsh-admin-toast.success { background: rgba(16, 185, 129, 0.95); color: #fff; }',
  '.dsh-admin-toast.error { background: rgba(239, 68, 68, 0.95); color: #fff; }',
  '.dsh-admin-toast.info { background: rgba(22, 119, 255, 0.95); color: #fff; }',
  '.dsh-admin-toast.leaving { animation: dsh-toast-out 0.2s ease-in forwards; }',
].join('\n')

function injectStyles() {
  var tagId = 'dsh-plugin-admin/unified-section.css'
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
    var tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-plugin-admin'
    tag.dataset.pluginCss = tagId
    tag.textContent = CSS_TEXT
    document.head.appendChild(tag)
  }
}

var SA_CSS_TEXT = [
  '@keyframes dsh-sa-spin { to { transform: rotate(360deg); } }',
  '[data-dsh-sa-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); overflow: visible; }',
  '[data-dsh-sa-section] .tabs, [data-cha-section] .tabs { display: flex; padding: 3px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.2)); border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.3)); gap: 3px; }',
  '[data-dsh-sa-section] .tab, [data-cha-section] .tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 7px 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, #666); transition: all 0.15s ease; font-family: inherit; }',
  '[data-dsh-sa-section] .tab:hover:not(.active), [data-cha-section] .tab:hover:not(.active) { color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); }',
  '[data-dsh-sa-section] .tab.active, [data-cha-section] .tab.active { background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); color: var(--dsw-alias-label-primary, #333); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04); }',
  '[data-dsh-sa-section] .tab-count { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.4)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-sa-section] .tab.active .tab-count { background: var(--dsw-static-blue-500, #3b82f6); color: #fff; }',
  '[data-dsh-sa-section] .filterbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); }',
  '[data-dsh-sa-section] .filter-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); flex: none; margin-right: 2px; }',
  '[data-dsh-sa-section] textarea.input, [data-cha-section] textarea.input { resize: vertical; min-height: 80px; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.55; }',
  '[data-dsh-sa-section] select.input, [data-cha-section] select.input { height: 32px; padding: 0 8px; cursor: pointer; }',
  '[data-dsh-sa-section] .persona-box { display: flex; align-items: flex-start; gap: 6px; padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); border-left: 2px solid var(--dsw-static-blue-500, #3b82f6); font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-sa-section] .persona-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; white-space: pre-wrap; }',
  '[data-dsh-sa-section] .tag.provider { background: #6d28d9; color: #fff; }',
  '[data-dsh-sa-section] .tag.model { background: #1d4ed8; color: #fff; }',
  '[data-dsh-sa-section] .tag.warn, [data-cha-section] .tag.warn { background: #b45309; color: #fff; font-weight: 600; }',
  '[data-dsh-sa-section] .tag.dead { background: #b91c1c; color: #fff; }',
  '[data-dsh-sa-section] .chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }',
  '[data-dsh-sa-section] .chip { font-size: 10px; font-family: var(--dsw-font-mono, ui-monospace, monospace); padding: 1px 6px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-sa-section] .chip.deny { background: rgba(239, 68, 68, 0.08); border-color: rgba(220,38,38,0.25); color: #b91c1c; }',
  '[data-dsh-sa-section] .chip.allow { background: rgba(16, 185, 129, 0.08); border-color: rgba(16,185,129,0.3); color: #047857; }',
  '[data-dsh-sa-section] .form, [data-cha-section] .form { flex: 1 1 auto; min-height: 0; max-height: calc(100vh - 220px); overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--dsw-static-blue-500, #3b82f6); background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 4px 14px rgba(59,130,246,0.08); }',
  '[data-dsh-sa-section] .form-actions, [data-cha-section] .form-actions { position: sticky; bottom: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 6px; padding-top: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); }',
  '[data-dsh-sa-section] .form-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 6px; }',
  '[data-dsh-sa-section] .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
  '[data-dsh-sa-section] .form-grid .full { grid-column: 1 / -1; }',
  '[data-dsh-sa-section] .field, [data-cha-section] .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
  '[data-dsh-sa-section] .field-label { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 5px; }',
  '[data-dsh-sa-section] .field-hint { font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); line-height: 1.4; }',
  '[data-dsh-sa-section] .fieldset { border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }',
  '[data-dsh-sa-section] .fieldset-legend { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); padding: 0 4px; }',
  '[data-dsh-sa-section] .tag-input { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); background: var(--dsw-alias-bg-base, transparent); min-height: 34px; align-items: center; cursor: text; }',
  '[data-dsh-sa-section] .tag-input:focus-within { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }',
  '[data-dsh-sa-section] .tag-input input { border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 12px; flex: 1; min-width: 90px; }',
  '[data-dsh-sa-section] .tag-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-family: var(--dsw-font-mono, ui-monospace, monospace); padding: 2px 4px 2px 8px; border-radius: 5px; }',
  '[data-dsh-sa-section] .tag-chip.allow { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16,185,129,0.3); color: #047857; }',
  '[data-dsh-sa-section] .tag-chip.deny { background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(220,38,38,0.25); color: #b91c1c; }',
  '[data-dsh-sa-section] .tag-chip button { border: 0; background: transparent; cursor: pointer; color: inherit; opacity: 0.65; font-size: 11px; padding: 0 3px; line-height: 1; }',
  '[data-dsh-sa-section] .tag-chip button:hover { opacity: 1; }',
  '[data-dsh-sa-section] .checkbox-row { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--dsw-alias-label-secondary, #555); cursor: pointer; }',
  '[data-dsh-sa-section] .checkbox-row input { accent-color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-sa-section] .env-row { display: flex; gap: 6px; align-items: center; }',
  '[data-dsh-sa-section] .env-row .env-key { flex: 2; min-width: 0; }',
  '[data-dsh-sa-section] .env-row .env-value { flex: 3; min-width: 0; }',
  '[data-dsh-sa-section] .cli-toggle { border: 0; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #555); font-size: 12px; line-height: 1; padding: 3px 6px; border-radius: 6px; }',
  '[data-dsh-sa-section] .cli-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-sa-section] .cli-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); display: inline-flex; align-items: center; flex: none; white-space: nowrap; font-family: var(--dsw-font-mono, ui-monospace, monospace); cursor: pointer; }',
  '[data-dsh-sa-section] .cli-tags { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; align-items: center; }',
  '[data-dsh-sa-section] .cli-detail { display: flex; flex-direction: column; gap: 8px; }',
  '[data-dsh-sa-section] .cli-scan-list { display: flex; flex-direction: column; gap: 6px; }',
  '[data-dsh-sa-section] .cli-scan-row { display: flex; gap: 8px; align-items: center; }',
  '[data-dsh-sa-section] .cli-scan-row .input { flex: 1; min-width: 0; }',
  '[data-dsh-sa-section] .cli-scan-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #666); }',
  '[data-dsh-sa-section] .cli-scan-card { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.12)); }',
  '[data-dsh-sa-section] .cli-scan-card button { margin-left: auto; flex: none; }',
  '[data-dsh-sa-section] .error-strip { display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border-radius: 9px; border: 1px solid rgba(220,38,38,0.35); background: rgba(239,68,68,0.08); color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; line-height: 1.45; word-break: break-word; }',
  '[data-dsh-sa-section] .warn-strip { display: flex; flex-direction: column; gap: 4px; padding: 9px 12px; border-radius: 9px; border: 1px solid rgba(217,119,6,0.35); background: rgba(245,158,11,0.08); color: #b45309; font-size: 12px; line-height: 1.5; word-break: break-word; }',
  '[data-dsh-sa-section] .warn-strip div { display: flex; gap: 6px; align-items: flex-start; }',
  '[data-dsh-sa-section] .empty .big { font-size: 26px; }',
  '[data-dsh-sa-section] .toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10000; max-width: 520px; padding: 10px 16px; border-radius: 10px; font-size: 12px; line-height: 1.5; box-shadow: 0 8px 24px rgba(0,0,0,0.18); background: rgba(239,68,68,0.96); color: #fff; word-break: break-word; white-space: pre-line; }',
  '[data-dsh-sa-section] .history-row { display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); }',
  '[data-dsh-sa-section] .history-head { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }',
  '[data-dsh-sa-section] .history-time { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); margin-left: auto; }',
  '[data-dsh-sa-section] .history-detail { font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); font-family: var(--dsw-font-mono, ui-monospace, monospace); word-break: break-all; max-height: 60px; overflow: hidden; }',
  '[data-dsh-sa-section] .footer-note { font-size: 10px; color: var(--dsw-alias-label-secondary, #61666b); line-height: 1.5; padding: 0 2px; }',
  '[data-dsh-sa-section] .sa-picker { position: relative; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }',
  '[data-dsh-sa-section] .sa-picker-input { border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 12px; flex: 1; min-width: 120px; padding: 2px 4px; }',
  '[data-dsh-sa-section] .sa-picker-list { width: 100%; margin-top: 4px; max-height: 220px; overflow-y: auto; background: var(--dsh-alias-bg-elevated, #fff); border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.5)); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); padding: 3px; scrollbar-width: thin; }',
  '[data-dsh-sa-section] .sa-picker-opt { padding: 6px 9px; font-size: 12px; cursor: pointer; border-radius: 5px; color: var(--dsw-alias-label-primary, #222); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-dsh-sa-section] .sa-picker-opt.active, [data-dsh-sa-section] .sa-picker-opt:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(59,130,246,0.14)); color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-sa-section] .sa-picker-empty { padding: 6px 9px; font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); }',
]

function injectSaStyles() {
  // Same idempotency as injectStyles: a data-attribute lookup survives HMR
  // re-executing this module, where a module-level flag would reset and
  // stack duplicate <style> nodes.
  if (document.querySelector('style[data-dsh-sa-styles]') !== null) return
  var style = document.createElement('style')
  style.setAttribute('data-dsh-sa-styles', '')
  style.textContent = SA_CSS_TEXT.join('\n')
  document.head.appendChild(style)
}

var CH_CSS_TEXT = [
  '[data-cha-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); overflow: visible; }',
  // Segmented tabs — the same recipe the subagents section uses.
  '[data-cha-section] .tab:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }',
  // Toolbar card — same recipe as the unified sections.
  '[data-cha-section] .toolbar .title { font-weight: 600; color: var(--dsw-alias-label-primary); }',
  '[data-cha-section] .toolbar .count { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); color: var(--dsw-alias-label-secondary, #555); font-weight: 500; }',
  '[data-cha-section] .toolbar .spacer { flex: 1; }',
  // Buttons — same recipe as the unified sections (blue primary, red danger).
  // Status banners — the same tint recipe as update-strip / busy-banner.
  '[data-cha-section] .notice { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 11px; border-radius: 8px; font-size: 12px; line-height: 1.5; background: rgba(59,130,246,0.08); color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-cha-section] .notice.warn { background: rgba(217,119,6,0.1); color: #b45309; }',
  '[data-cha-section] .notice.ok { background: rgba(16,185,129,0.1); color: #047857; }',
  '[data-cha-section] .notice .notice-text { flex: 1 1 240px; }',
  '[data-cha-section] .notice .notice-actions { display: flex; gap: 5px; flex: none; }',
  // Rows — card elevation + hover lift like the other list cards.
  '[data-cha-section] .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }',
  '[data-cha-section] .row:hover { transform: translateY(-1px); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }',
  '[data-cha-section] .row.off { opacity: 0.55; }',
  '[data-cha-section] .row .main { flex: 1; min-width: 0; }',
  '[data-cha-section] .row .name { font-weight: 600; }',
  '[data-cha-section] .row .desc { color: var(--dsw-alias-label-secondary, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-cha-section] .row .desc.mono { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; }',
  '[data-cha-section] .row .meta { color: var(--dsw-alias-label-secondary, #61666b); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-cha-section] .name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }',
  '[data-cha-section] .actions { display: flex; gap: 5px; align-items: center; flex: none; }',
  // Tag badges — same recipe as the unified .tag family.
  '[data-cha-section] .tag.event { background: rgba(59,130,246,0.12); color: var(--dsw-static-blue-500, #3b82f6); font-family: var(--dsw-font-mono, ui-monospace, monospace); }',
  '[data-cha-section] .tag.err { background: rgba(239,68,68,0.1); color: var(--dsw-alias-state-error-primary, #ef4444); }',
  // Toggle switch — the blue accent instead of the standalone plugin's dark knob.
  '[data-cha-section] .toggle { position: relative; width: 34px; height: 20px; flex: none; appearance: none; border: none; border-radius: 99px; cursor: pointer; background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.3)); transition: background 0.15s; }',
  '[data-cha-section] .toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 99px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 0.15s; }',
  '[data-cha-section] .toggle[aria-checked="true"] { background: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-cha-section] .toggle[aria-checked="true"]::after { transform: translateX(14px); }',
  '[data-cha-section] .toggle:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }',
  '[data-cha-section] .toggle:disabled { opacity: 0.45; cursor: not-allowed; }',
  // Forms — .input recipe with the blue focus ring.
  '[data-cha-section] .field label { font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }',
  '[data-cha-section] .input.mono { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; }',
  '[data-cha-section] .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
  '[data-cha-section] .checks { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }',
  '[data-cha-section] .check { display: flex; gap: 6px; align-items: center; cursor: pointer; }',
  // Misc.
  '[data-cha-section] .hint { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
  '[data-cha-section] .path-chip { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); word-break: break-all; }',
  '[data-cha-section] .error-text { color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; }',
].join('\n')

/** Inject the command-hook section stylesheet once. */
function injectChStyles() {
  var tagId = 'dsh-plugin-admin/command-hooks.css'
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
    var tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-plugin-admin'
    tag.dataset.pluginCss = tagId
    tag.textContent = CH_CSS_TEXT
    document.head.appendChild(tag)
  }
}

var TODO_CSS_TAG = 'dsh-plugin-admin/todo-dock.css'

// Dock alignment copies the shell TodoPanel root's own recipe (composer
// side-clearance + dock inset against the card max-width) so the strip sits
// exactly as wide as the composer card it floats above. Each var() carries a
// neutral fallback (0px / 100%) so older shells without the variables simply
// fall back to full-width instead of a wrong guess.
var TODO_CSS_TEXT = [
  // Stock-strip suppression: only active while this panel is mounted with data.
  'body.dsh-admin-todo-live [data-testid="todo-panel"] { display: none !important; }',
  '[data-dsh-admin-todo] { display: flex; flex-direction: column; position: relative; width: calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px)); max-width: calc(var(--dsh-composer-card-max-width, 100%) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px)); margin: 0 auto; border: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l2, rgba(200,200,210,0.4))); border-radius: 12px; background: var(--dsw-specific-tip, var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent))); box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, var(--dsw-alias-border-l2, rgba(200,200,210,0.4))); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6))); }',
  // Slim completion bar across the panel top; turns green at 100%.
  '[data-dsh-admin-todo] .todo-progress { flex: none; width: 100%; height: 3px; background: var(--dsw-alias-border-l2, rgba(200,200,210,0.35)); }',
  '[data-dsh-admin-todo] .todo-progress-fill { height: 100%; width: 0; background: var(--dsw-static-blue-500, #3b82f6); border-radius: 0 2px 2px 0; transition: width 0.3s ease, background 0.3s ease; }',
  '[data-dsh-admin-todo] .todo-progress-fill.full { background: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-list { list-style: none; margin: 0; padding: 8px 14px 4px 14px; display: flex; flex-direction: column; gap: 2px; max-height: 224px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent; }',
  '[data-dsh-admin-todo] .todo-list::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-todo] .todo-list::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsh-scrollbar-thumb); }',
  // First visible row keeps its right-aligned content (elapsed timer / done
  // chevron) clear of the bell button floating over the panel's top-right.
  '[data-dsh-admin-todo] .todo-list > :first-child { padding-right: 26px; }',
  '[data-dsh-admin-todo] .todo-item { display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 3px 0; border-radius: 6px; }',
  '[data-dsh-admin-todo] .todo-glyph { width: 16px; height: 16px; flex: none; display: grid; place-items: center; margin-top: 2px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-glyph { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-glyph svg { animation: dsh-admin-spin 0.9s linear infinite; }',
  '[data-dsh-admin-todo] .todo-item[data-status="completed"] .todo-glyph { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-text { min-width: 0; word-break: break-word; color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-text { font-weight: 500; }',
  '[data-dsh-admin-todo] .todo-item[data-status="completed"] .todo-text { text-decoration: line-through; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-todo] .todo-item[data-status="pending"] .todo-text { color: var(--dsw-alias-label-secondary, #555); }',
  // Live elapsed counter on the active step ("visibly tick", never stuck).
  '[data-dsh-admin-todo] .todo-elapsed { flex: none; margin-left: auto; padding-left: 8px; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #61666b); font-variant-numeric: tabular-nums; white-space: nowrap; }',
  // Collapse-completed summary row.
  '[data-dsh-admin-todo] .todo-done-row { margin: 0; padding: 0 0 2px 0; }',
  '[data-dsh-admin-todo] .todo-done-row + .todo-item { border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.25)); }',
  '[data-dsh-admin-todo] .todo-done-toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 3px 0; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); text-align: left; border-radius: 6px; }',
  '[data-dsh-admin-todo] .todo-done-toggle:hover { color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-todo] .todo-done-toggle:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }',
  '[data-dsh-admin-todo] .todo-done-toggle .todo-glyph { margin-top: 0; color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-done-label { min-width: 0; flex: 1 1 auto; }',
  '[data-dsh-admin-todo] .todo-done-toggle .todo-chevron { font-size: 10px; }',
  // File-change section: compact monospace rows, git-status letter badges.
  '[data-dsh-admin-todo] .todo-files { display: flex; flex-direction: column; margin: 4px 14px 0 14px; padding: 4px 0 5px 0; border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.35)); max-height: 140px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent; }',
  '[data-dsh-admin-todo] .todo-files::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-todo] .todo-files::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsh-scrollbar-thumb); }',
  '[data-dsh-admin-todo] .todo-files-head { display: flex; align-items: center; gap: 5px; padding: 0 0 3px 0; font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace; font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-todo] .todo-files-head .branch { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-files-head .branch-name { font-weight: 600; }',
  '[data-dsh-admin-todo] .todo-copy-diff { margin-left: auto; border: 0; background: transparent; cursor: pointer; font-family: inherit; font-size: 11px; color: var(--dsw-alias-label-secondary, #61666b); padding: 0 4px; border-radius: 4px; }',
  '[data-dsh-admin-todo] .todo-copy-diff:hover { color: var(--dsw-static-blue-500, #3b82f6); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); }',
  '[data-dsh-admin-todo] .todo-copy-diff:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: -2px; }',
  // Notification bell: floats over the top edge, dim until enabled.
  '[data-dsh-admin-todo] .todo-notify { position: absolute; top: 6px; right: 8px; width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #61666b); cursor: pointer; z-index: 1; }',
  '[data-dsh-admin-todo] .todo-notify:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-todo] .todo-notify.on { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-notify:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: -2px; }',
  '[data-dsh-admin-todo] .todo-file { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; padding: 1.5px 4px; margin: 0; border: 0; border-radius: 4px; background: transparent; text-align: left; cursor: pointer; font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-todo] .todo-file:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); }',
  '[data-dsh-admin-todo] .todo-file:hover:not(:disabled) .name { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-file:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: -2px; }',
  '[data-dsh-admin-todo] .todo-file:disabled { cursor: default; }',
  '[data-dsh-admin-todo] .todo-file .st { flex: none; width: 14px; text-align: center; font-weight: 700; }',
  '[data-dsh-admin-todo] .todo-file[data-st="M"] .st { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-file[data-st="A"] .st, [data-dsh-admin-todo] .todo-file[data-st="?"] .st { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-file[data-st="D"] .st { color: var(--dsw-alias-state-error-primary, #dc2626); }',
  '[data-dsh-admin-todo] .todo-file[data-st="R"] .st, [data-dsh-admin-todo] .todo-file[data-st="C"] .st { color: var(--dsw-static-amber-500, #d97706); }',
  '[data-dsh-admin-todo] .todo-file .p { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: ltr; }',
  '[data-dsh-admin-todo] .todo-file .p .dir { color: var(--dsw-alias-label-secondary, #61666b); }',
  '[data-dsh-admin-todo] .todo-file .p .name { color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-todo] .todo-file .n { flex: none; font-variant-numeric: tabular-nums; }',
  '[data-dsh-admin-todo] .todo-file .n .a { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-file .n .d { color: var(--dsw-alias-state-error-primary, #dc2626); margin-left: 5px; }',
  '[data-dsh-admin-todo] .todo-file .n .zero { opacity: 0.45; }',
  // Footer: step counts left, change totals + collapse chevron right.
  '[data-dsh-admin-todo] .todo-footer { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 14px; border: 0; border-top: 1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.35)); background: transparent; cursor: pointer; font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); text-align: left; }',
  '[data-dsh-admin-todo] .todo-footer:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.2)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-todo] .todo-footer:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: -2px; }',
  '[data-dsh-admin-todo] .todo-footer .todo-steps { flex: 1 1 auto; min-width: 0; }',
  '[data-dsh-admin-todo] .todo-footer .todo-stats { flex: none; display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }',
  '[data-dsh-admin-todo] .todo-footer .num-add { color: var(--dsw-alias-state-success-primary, #16a34a); font-weight: 600; }',
  '[data-dsh-admin-todo] .todo-footer .num-del { color: var(--dsw-alias-state-error-primary, #dc2626); font-weight: 600; }',
  '[data-dsh-admin-todo] .todo-chevron { flex: none; font-size: 10px; opacity: 0.7; }',
].join('\n')

function injectTodoStyles() {
  if (document.querySelector('style[data-plugin-css="' + TODO_CSS_TAG + '"]') === null) {
    var tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-plugin-admin'
    tag.dataset.pluginCss = TODO_CSS_TAG
    tag.textContent = TODO_CSS_TEXT
    document.head.appendChild(tag)
  }
}

export { injectStyles, injectSaStyles, injectChStyles, injectTodoStyles }
