window.__ModuleLoader__.load({ id: 'dsh-plugin-admin', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/**
 * dsh-plugin-admin browser half: administration surfaces parked where the
 * settings shell already renders their domain.
 *
 * Five slot contributions (all assembled with the platform-shared React,
 * module-table seed word, same instance the shell renders with):
 * - 扩展插件: a tab inside the shell-owned 插件 section (`settings.plugins.tab`),
 *   after 插件配置 and 插件列表;
 * - MCP服务器 / 子智能体 / 命令与钩子 / 历史会话: standalone `settings.section`
 *   pages in the settings nav. Panels talk to the host over the /api RPC gateway.
 */

var React = require('react')
var createElement = React.createElement
var useState = React.useState
var useRef = React.useRef
var useEffect = React.useEffect

var CSS_TEXT = [
  '@keyframes dsh-admin-spin { to { transform: rotate(360deg); } }',
  '@keyframes dsh-admin-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.85); } }',
  '[data-dsh-admin-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); max-height: calc(100vh - 140px); overflow: hidden; }',
  '[data-dsh-admin-section] * { box-sizing: border-box; }',
  '[data-dsh-admin-section] .toolbar { display: flex; gap: 8px; align-items: center; padding: 10px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); }',
  '[data-dsh-admin-section] .toolbar .input { height: 32px; padding: 0 12px; border-radius: 8px; border-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); }',
  '[data-dsh-admin-section] .search-wrap { flex: 1.6; min-width: 0; position: relative; display: flex; align-items: center; height: 32px; }',
  '[data-dsh-admin-section] .search-wrap .input { flex: 1; min-width: 0; padding-left: 30px; font-size: 13px; }',
  '[data-dsh-admin-section] .session-search { flex: 1; height: 32px; }',
  '[data-dsh-admin-section] .session-search .input { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 8px; border-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); }',
  '[data-dsh-admin-section] .install-wrap { flex: 1; min-width: 0; display: flex; align-items: center; height: 32px; }',
  '[data-dsh-admin-section] .install-wrap .input { flex: 1; min-width: 0; font-size: 13px; border-radius: 8px; border-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); }',
  '[data-dsh-admin-section] .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; opacity: 0.7; pointer-events: none; z-index: 1; }',
  '[data-dsh-admin-section] .input { width: 100%; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); background: var(--dsw-alias-bg-base, transparent); color: inherit; font: inherit; outline: none; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; }',
  '[data-dsh-admin-section] .input:hover { border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); }',
  '[data-dsh-admin-section] .input:focus { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }',
  '[data-dsh-admin-section] .filter-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }',
  '[data-dsh-admin-section] .pill { font-size: 11px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.45)); background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #555); transition: all 0.12s; font-family: inherit; }',
  '[data-dsh-admin-section] .pill:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); }',
  '[data-dsh-admin-section] .pill.active { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.4)); color: var(--dsw-static-blue-500, #3b82f6); font-weight: 600; border-color: currentColor; }',
  '[data-dsh-admin-section] .btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 32px; padding: 0 14px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); background: var(--dsw-alias-interactive-bg-hover, rgba(240,240,245,0.6)); color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; flex: none; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }',
  '[data-dsh-admin-section] .btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(220,220,230,0.7)); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.65)); color: var(--dsw-alias-label-primary, #222); box-shadow: 0 2px 4px rgba(0,0,0,0.06); }',
  '[data-dsh-admin-section] .search-wrap .btn.sm { background: transparent; border: none; box-shadow: none; padding: 2px 6px; color: var(--dsw-alias-label-tertiary, #888); }',
  '[data-dsh-admin-section] .search-wrap .btn.sm:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.4)); color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-admin-section] .btn:active:not(:disabled) { transform: translateY(1px); }',
  '[data-dsh-admin-section] .btn:focus-visible, [data-dsh-admin-section] .pill:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }',
  '[data-dsh-admin-section] .btn:disabled { opacity: 0.45; cursor: not-allowed; }',
  '[data-dsh-admin-section] .btn.primary { background: var(--dsw-static-blue-500, #3b82f6); color: #fff; border-color: transparent; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }',
  '[data-dsh-admin-section] .btn.primary:hover:not(:disabled) { background: var(--dsw-static-blue-400, #60a5fa); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.14); }',
  '[data-dsh-admin-section] .btn.primary:active:not(:disabled) { background: var(--dsw-static-blue-600, #2563eb); color: #fff; }',
  '[data-dsh-admin-section] .btn.danger { color: var(--dsw-alias-state-error-primary, #dc2626); border-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); }',
  '[data-dsh-admin-section] .btn.danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.1)); border-color: rgba(220,38,38,0.35); color: #b91c1c; }',
  '[data-dsh-admin-section] .btn.danger-solid { background: var(--dsw-alias-state-error-primary, #dc2626); color: #fff; border-color: transparent; }',
  '[data-dsh-admin-section] .btn.danger-solid:hover:not(:disabled) { background: #b91c1c; color: #fff; }',
  '[data-dsh-admin-section] .btn.danger-solid:active:not(:disabled) { background: #991b1b; color: #fff; }',
  '[data-dsh-admin-section] .btn.sm { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 6px; }',
  '[data-dsh-admin-section] .spinner { width: 12px; height: 12px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: dsh-admin-spin 0.7s linear infinite; display: inline-block; flex: none; }',
  '[data-dsh-admin-section] .list { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; max-height: 560px; overflow-y: auto; padding: 2px 4px 2px 2px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)) transparent; }',
  '[data-dsh-admin-section] .list.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-content: start; }',
  '[data-dsh-admin-section] .list.grid2 .empty { grid-column: 1 / -1; }',
  '[data-dsh-admin-section] .list.grid2 .card { cursor: pointer; }',
  '[data-dsh-admin-section] .list.grid2 .card:hover { transform: none; border-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); box-shadow: none; }',
  '[data-dsh-admin-section] .list::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-section] .list::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); }',
  '[data-dsh-admin-section] .session-group { display: flex; flex-direction: column; gap: 6px; }',
  '[data-dsh-admin-section] .group-header { display: flex; align-items: center; gap: 10px; padding: 10px 12px 8px 12px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); margin-bottom: 4px; }',
  '[data-dsh-admin-section] .group-header:first-child { margin-top: 2px; }',
  '[data-dsh-admin-section] .group-title { display: inline-flex; align-items: center; gap: 6px; }',
  '[data-dsh-admin-section] .group-count { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); color: var(--dsw-alias-label-secondary, #555); font-weight: 500; }',
  '[data-dsh-admin-section] .group-header .btn.sm { margin-left: auto; }',
  '[data-dsh-admin-section] .group-header .btn.sm + .btn.sm { margin-left: 0; }',
  '[data-dsh-admin-section] .group-path { font-family: monospace; font-size: 10px; color: var(--dsw-alias-label-tertiary, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; text-align: right; }',
  '[data-dsh-admin-section] .card { display: flex; flex-direction: column; gap: 7px; padding: 12px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }',
  // MCP editor: the whole section is `overflow:hidden` with a bounded height, so
  // a tall editor form (e.g. with reconnect fields expanded) would get its
  // bottom action row — including the 保存 button — clipped out of reach.
  // Give the editor its own scroll viewport so the buttons stay visible/clickable.
  '[data-dsh-admin-section] .mcp-editor { flex: 1 1 auto; min-height: 0; max-height: calc(100vh - 200px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)) transparent; }',
  '[data-dsh-admin-section] .mcp-editor::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-section] .mcp-editor::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); }',
  // Keep the action row (取消 / 保存) pinned at the bottom of the editor card
  // and always within the scroll viewport, even on short windows.
  '[data-dsh-admin-section] .mcp-editor .card-actions { position: sticky; bottom: 0; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff)); padding-top: 10px; margin-top: 4px; }',
  // When the editor is open alongside the list (editing an existing entry), the
  // list must not compete for the bounded section height or the editor's 保存
  // button gets pushed below the clipped region. Let the list shrink to its
  // content instead of claiming flex space.
  '[data-dsh-admin-section].mcp-editor-open .list { flex: 0 1 auto; max-height: 140px; }',
  '[data-dsh-admin-section] .card:hover { transform: translateY(-1px); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }',
  '[data-dsh-admin-section] .card-header { display: flex; align-items: center; gap: 8px; min-width: 0; }',
  '[data-dsh-admin-section] .card-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; }',
  '[data-dsh-admin-section] .card-title-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }',
  '[data-dsh-admin-section] .card-summary { display: flex; align-items: flex-start; gap: 6px; padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); border-left: 2px solid var(--dsw-static-blue-500, #3b82f6); font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #555); margin-top: 1px; margin-bottom: 1px; }',
  '[data-dsh-admin-section] .summary-icon { font-size: 11px; line-height: 1.45; flex: none; opacity: 0.85; }',
  '[data-dsh-admin-section] .summary-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; }',
  '[data-dsh-admin-section] .card-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
  '[data-dsh-admin-section] .card-sub-item { display: inline-flex; align-items: center; gap: 3px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-dsh-admin-section] .card-actions { display: flex; gap: 5px; align-items: center; flex: none; }',
  '[data-dsh-admin-section] .tag { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; flex: none; display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-section] .tag.plugin { background: rgba(16, 185, 129, 0.12); color: var(--dsw-alias-state-success-primary, #10b981); }',
  '[data-dsh-admin-section] .tag.local { background: rgba(59, 130, 246, 0.12); color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-section] .tag.update { background: rgba(245, 158, 11, 0.14); color: #d97706; font-weight: 600; border: 1px solid rgba(217, 119, 6, 0.25); }',
  '[data-dsh-admin-section] .tag.update-error { background: rgba(239, 68, 68, 0.1); color: var(--dsw-alias-state-error-primary, #ef4444); }',
  '[data-dsh-admin-section] .plugin-path { font-family: monospace; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 4px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); }',
  '[data-dsh-admin-section] .tag.version { font-family: monospace; }',
  '[data-dsh-admin-section] .tag.live { background: rgba(16, 185, 129, 0.12); color: var(--dsw-alias-state-success-primary, #10b981); font-weight: 600; }',
  '[data-dsh-admin-section] .tag.archived { background: rgba(245, 158, 11, 0.12); color: var(--dsw-alias-state-warn-label, #f59e0b); }',
  '[data-dsh-admin-section] .tag.turns { background: rgba(59, 130, 246, 0.12); color: var(--dsw-static-blue-500, #3b82f6); font-weight: 500; }',
  '[data-dsh-admin-section] .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary, #999); }',
  '[data-dsh-admin-section] .dot.live { background: var(--dsw-alias-state-success-primary, #10b981); box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25); animation: dsh-admin-pulse 2s infinite ease-in-out; }',
  '[data-dsh-admin-section] .dot.archived { background: var(--dsw-alias-state-warn-label, #f59e0b); }',
  '[data-dsh-admin-section] .confirm-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); border: 1px solid rgba(239,68,68,0.2); }',
  '[data-dsh-admin-section] .confirm-text { font-size: 11px; color: var(--dsw-alias-state-error-primary, #ef4444); font-weight: 500; }',
  '[data-dsh-admin-section] .confirm-actions { display: flex; gap: 5px; flex: none; }',
  '[data-dsh-admin-section] .busy-banner { display: flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 7px; background: rgba(59, 130, 246, 0.08); color: var(--dsw-static-blue-500, #3b82f6); font-size: 11px; }',
  '[data-dsh-admin-section] .update-strip { display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: 8px; font-size: 12px; font-weight: 500; line-height: 1.4; }',
  '[data-dsh-admin-section] .update-strip .btn.sm { margin-left: auto; flex: none; }',
  '[data-dsh-admin-section] .update-strip.checking { background: rgba(59, 130, 246, 0.08); color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-section] .update-strip.ok { background: rgba(16, 185, 129, 0.1); color: var(--dsw-alias-state-success-primary, #10b981); }',
  '[data-dsh-admin-section] .update-strip.has-updates { background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(217, 119, 6, 0.25); }',
  '[data-dsh-admin-section] .update-strip.has-errors { background: rgba(239, 68, 68, 0.08); color: var(--dsw-alias-state-error-primary, #ef4444); }',
  '[data-dsh-admin-section] .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 12px; color: var(--dsw-alias-label-tertiary, #999); gap: 4px; font-size: 12px; text-align: center; }',
  '[data-dsh-admin-section] .error { padding: 7px 11px; border-radius: 7px; color: var(--dsw-alias-state-error-primary, #ef4444); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); font-size: 12px; white-space: pre-wrap; max-height: 100px; overflow-y: auto; }',
  '[data-dsh-admin-section] .footer { display: flex; justify-content: space-between; align-items: center; padding-top: 4px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #888); border-top: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.3)); flex: none; }',
  '[data-dsh-admin-section] .footer .path { max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-dsh-admin-section] .footer .hint { font-style: normal; }',
  '[data-dsh-admin-section] .session-id-badge { font-family: monospace; font-size: 10px; opacity: 0.75; }',
  '[data-dsh-admin-section] .mcp-test-row { padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }',
  '[data-dsh-admin-section] .mcp-test { display: inline-flex; align-items: center; gap: 5px; }',
  '[data-dsh-admin-section] .mcp-test.mcp-test-list { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }',
  '[data-dsh-admin-section] .mcp-test-busy { color: var(--dsw-alias-label-secondary, #666); }',
  '[data-dsh-admin-section] .mcp-test-ok { color: #16a34a; }',
  '[data-dsh-admin-section] .mcp-test-fail { color: var(--dsw-alias-state-error-primary, #ef4444); }',
  '[data-dsh-admin-section] .mcp-test-warn { color: #d97706; opacity: 0.95; }',
  '[data-dsh-admin-section] .mcp-test-cached { font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); }',
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

function baseName(path) {
  if (path === null || path === '') return '（无工作目录）'
  var parts = path.replace(/\\/g, '/').split('/')
  var last = parts[parts.length - 1]
  return last === '' ? parts[parts.length - 2] || path : last
}

function formatDate(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  var d = new Date(ms)
  var pad = function (n) { return (n < 10 ? '0' : '') + String(n) }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function messageOf(error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  if (typeof error === 'string') return error
  return JSON.stringify(error)
}

// Single-toast singleton: at most ONE floating toast exists at any time. A
// new showToast REPLACES the in-flight toast in place (same node, refreshed
// type/text, restarted countdown) instead of stacking another fixed-position
// node on top — rapid consecutive failures would otherwise overlap and hide
// the earlier message behind the latest. A toast mid-fade (leaving) is
// revived by a replacement rather than left to vanish.
var activeToast = null

/**
 * Show a floating toast notification at the top of the viewport.
 * Auto-dismisses after `duration` ms. Supports 'success', 'error', 'info'.
 * Single-slot: a new toast replaces the current one (if any).
 */
function showToast(type, text, duration) {
  if (typeof document === 'undefined') return
  duration = duration || 3000

  function quit(state) {
    if (state.leaving) return
    state.leaving = true
    clearTimeout(state.timer)
    state.el.classList.add('leaving')
    state.removalTimer = setTimeout(function () {
      if (state.el.parentNode) state.el.parentNode.removeChild(state.el)
      if (activeToast === state) activeToast = null
    }, 200)
  }

  var current = activeToast
  if (current !== null && current.el.parentNode !== null) {
    // Replace: revive a mid-fade toast, swap class/text, restart the countdown.
    clearTimeout(current.timer)
    clearTimeout(current.removalTimer)
    current.leaving = false
    current.el.className = 'dsh-admin-toast ' + type
    current.el.textContent = text
    current.timer = setTimeout(function () { quit(current) }, duration)
    return
  }

  var toast = document.createElement('div')
  toast.className = 'dsh-admin-toast ' + type
  toast.textContent = text
  document.body.appendChild(toast)
  var state = { el: toast, timer: null, removalTimer: null, leaving: false }
  activeToast = state
  toast.addEventListener('click', function () { quit(state) })
  state.timer = setTimeout(function () { quit(state) }, duration)
}

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available;
 * falls back to a hidden textarea + execCommand for older browsers or
 * non-secure contexts.
 */
function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(function () {
      showToast('success', '📋 会话 ID 已复制')
    }, function () {
      fallbackCopy(text)
    })
    return
  }
  fallbackCopy(text)
}

function fallbackCopy(text) {
  try {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch (e) {
    showToast('error', '❌ 复制失败：' + messageOf(e))
  }
}

/* ========================================================================== */
/*                     Menu Popup Injection (Sessions & Workspaces)          */
/* ========================================================================== */

/**
 * Inject plugin items into the existing three-dot menu popup. The workspace
 * bundle renders a Menu component (@deepseek-ai/dsh-client-ui-primitives)
 * with portal:true, so the popup lives as a div[role="menu"] inside
 * document.body with position:fixed. A MutationObserver detects when this
 * popup appears, identifies it as a session or workspace menu by checking
 * the existing button labels, and injects additional items.
 */
function setupMenuInjection(call, refreshSessions) {
  if (typeof document === 'undefined') return function () {}

  /**
   * Extract the session title from the row's aria-label. The anchor button
   * aria-label is: 会话"<title>"的操作 (zh) / Session "<title>" actions (en).
   * Extracting from the DOM keeps the injection synchronous — no RPC needed
   * just to show the button, so the menu can't close before it appears.
   */
  function sessionTitleFromRow(row) {
    var btn = row.querySelector('button[aria-label*="会话" i][aria-label*="操作" i], button[aria-label*="session" i][aria-label*="actions" i]')
    if (btn === null) return null
    var label = btn.getAttribute('aria-label') || ''
    // zh: 会话"xxx"的操作 → strip 会话"/"的操作
    var zh = /会话["“]([^"”]+)["”]/.exec(label)
    if (zh) return zh[1].trim()
    // en: Session "xxx" actions
    var en = /session\s*["“]([^"”]+)["”]/i.exec(label)
    if (en) return en[1].trim()
    // fallback: whole label minus known prefixes/suffixes
    return label.replace(/^会话/, '').replace(/^session/i, '').replace(/["“”]|的操作|actions$/gi, '').trim() || null
  }

  /** Find the treeitem row for the anchor button nearest the menu. */
  function rowForMenu(menuEl) {
    var menuRect = menuEl ? menuEl.getBoundingClientRect() : null
    var allRows = document.querySelectorAll('[role="treeitem"]')
    if (allRows.length === 0) return null
    var rows = []
    for (var i = 0; i < allRows.length; i++) {
      var r = allRows[i]
      // Only rows that contain a session/workspace action button
      if (r.querySelector('button[aria-label*="会话" i][aria-label*="操作" i], button[aria-label*="工作区" i][aria-label*="操作" i], button[aria-label*="session" i][aria-label*="actions" i], button[aria-label*="workspace" i][aria-label*="actions" i]')) {
        rows.push(r)
      }
    }
    if (rows.length === 0) return null

    // The Menu component renders with side="bottom": menu top sits just
    // below the anchor button (button.bottom + 4). Match the row whose
    // center is closest to the MENU TOP, not the menu center — the menu
    // can be tall (several items), so its center drifts far from the
    // clicked row.
    if (menuRect === null || menuRect.height === 0) {
      // No reliable menu rect. With a single candidate row the choice is
      // unambiguous, so return it (jsdom/test environments have zero rects);
      // with several rows refuse to guess rather than act on the wrong
      // session.
      if (rows.length === 1) return rows[0]
      return null
    }
    var closest = rows[0]
    var closestDist = Infinity
    for (var j = 0; j < rows.length; j++) {
      var rect = rows[j].getBoundingClientRect()
      if (rect.height === 0) continue
      var rowCenter = rect.top + rect.height / 2
      var dist = Math.abs(rowCenter - menuRect.top)
      if (dist < closestDist) {
        closestDist = dist
        closest = rows[j]
      }
    }
    return closest
  }

  function injectItems(menuEl) {
    if (menuEl.querySelector('[data-dsh-admin-injected]')) return

    var text = menuEl.textContent || ''
    var isSession = text.indexOf('归档会话') !== -1 || text.indexOf('Archive session') !== -1
    var isWorkspace = !isSession && (text.indexOf('删除') !== -1 || text.indexOf('Delete workspace') !== -1)
    if (!isSession && !isWorkspace) return

    var viewport = menuEl.querySelector('[role="presentation"]')
    if (viewport === null) return

    var row = rowForMenu(menuEl)
    if (row === null) return

    if (isSession) {
      var title = sessionTitleFromRow(row)
      if (title === null) return
      // Resolve sessions by title lazily at click time (fresh RPC) so the
      // match is always current. Copy-id keeps the fuzzy matcher (a wrong
      // match only mis-copies an id); delete must never guess, so it
      // resolves by exact title only and refuses duplicate titles — the
      // panel's rows act on ids and can disambiguate.
      function fetchSessions(done) {
        call('sessionAdmin/list', {}).then(function (listResult) {
          done((listResult && listResult.ok && listResult.value && listResult.value.sessions) || [])
        }, function () { showToast('error', '❌ 无法加载会话列表') })
      }
      // Normalize a title for comparison: trim, collapse spaces, drop
      // trailing ellipsis and truncation artifacts.
      function norm(v) {
        return (v || '').replace(/\s+/g, ' ').replace(/\.{3,}\s*$/, '').trim().toLowerCase()
      }

      function resolveSessionFuzzy(cb) {
        fetchSessions(function (sessions) {
          var match = null
          var nt = norm(title)
          for (var i = 0; i < sessions.length; i++) {
            var s = sessions[i]
            var st = norm(s.title)
            if (st === nt) { match = s; break }
            // substring both ways (skip too-short needles)
            if (nt.length > 3 && st.indexOf(nt) !== -1) { match = s; break }
            if (st.length > 3 && nt.indexOf(st) !== -1) { match = s; break }
            // fall back to cwd basename match
            var cwdBase = s.cwd ? s.cwd.replace(/\\/g, '/').split('/').pop() : ''
            if (cwdBase && (cwdBase === nt || nt.indexOf(cwdBase) !== -1 || cwdBase.indexOf(nt) !== -1)) { match = s; break }
          }
          if (match === null) { showToast('error', '❌ 未找到匹配的会话'); return }
          cb(match)
        })
      }

      function resolveSessionExact(cb) {
        fetchSessions(function (sessions) {
          var nt = norm(title)
          var exact = []
          for (var i = 0; i < sessions.length; i++) {
            if (norm(sessions[i].title) === nt) exact.push(sessions[i])
          }
          if (exact.length === 0) { showToast('error', '❌ 未找到匹配的会话'); return }
          if (exact.length > 1) {
            showToast('error', '❌ 存在 ' + String(exact.length) + ' 个同名会话，无法确定要删除的目标；请在 设置 → 历史会话 中按会话 ID 删除')
            return
          }
          cb(exact[0])
        })
      }

      // Copy the session id to the clipboard.
      appendMenuItem(viewport, '复制会话 ID', 'normal', function () {
        resolveSessionFuzzy(function (session) {
          copyTextToClipboard(session.id)
        })
      })

      // Delete the session. Online sessions are now closable through the
      // captured AgentHandle (closeSession disposes the live agent/session
      // first, so removing the log cannot resurrect it) — this stops a
      // running conversation in that session. The item arms on the first
      // click and only fires on a second click within 4s (confirmText below)
      // — deletion is physical, so one misclick must never be enough.
      appendMenuItem(viewport, '删除会话', 'danger', function () {
        resolveSessionExact(function (match) {
          var method = match.live ? 'sessionAdmin/closeSession' : 'sessionAdmin/deleteSession'
          call(method, { sessionId: match.id }).then(function (result) {
            if (result && result.ok) {
              showToast('success', '🗑️ 会话已删除')
              // Nudge the sidebar so the removed session vanishes now
              // instead of lingering in 未分组 until reload.
              if (refreshSessions) refreshSessions()
            } else {
              showToast('error', '❌ 删除会话失败：' + messageOf(result && result.error))
            }
          }, function (err) { showToast('error', '❌ 删除会话失败：' + messageOf(err)) })
        })
      }, '⚠️ 再点一次确认删除（在线会话将先关停）')
    } else {
      // Workspace: reveal in file manager. Path is resolved lazily at click.
      var wsTitle = (row.querySelector('[class*="_title"]') || {}).textContent || ''
      wsTitle = wsTitle.trim()
      if (wsTitle === '') return
      appendMenuItem(viewport, '在资源管理器打开', 'normal', function () {
        call('sessionAdmin/list', {}).then(function (listResult) {
          var workspaces = (listResult && listResult.ok && listResult.value && listResult.value.workspaces) || []
          var wsPath = null
          for (var i = 0; i < workspaces.length; i++) {
            var w = workspaces[i]
            var wTitle = (w && w.title) || ''
            if (wTitle === wsTitle || (wsTitle !== '' && wTitle !== '' && (wsTitle.indexOf(wTitle) !== -1 || wTitle.indexOf(wsTitle) !== -1))) { wsPath = w && w.path; break }
          }
          if (wsPath === null) { showToast('error', '❌ 打开失败：未找到工作区路径'); return }
          call('fsAdmin/reveal', { path: wsPath }).then(function (result) {
            // Success needs no toast — the Explorer window opening is the
            // feedback itself. Only failures get a hint.
            if (!(result && result.ok)) showToast('error', '❌ 打开失败：' + messageOf(result && result.error))
          }, function (err) { showToast('error', '❌ 打开失败：' + messageOf(err)) })
        }, function () { showToast('error', '❌ 打开失败：无法加载工作区列表') })
      })
    }
  }

  function appendMenuItem(viewport, label, kind, onClick, confirmText) {
    // Separator (only if there are already items — always, to visually group)
    var sep = document.createElement('div')
    sep.setAttribute('role', 'separator')
    sep.setAttribute('data-dsh-admin-injected', '')
    sep.style.cssText = 'margin:3px 0;border-top:1px solid var(--dsw-alias-border-subtle,rgba(200,200,210,0.3))'
    viewport.appendChild(sep)

    var btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('role', 'menuitem')
    btn.setAttribute('data-dsh-admin-injected', '')
    btn.textContent = label
    var color = kind === 'danger' ? '#ef4444' : 'inherit'
    var hoverBg = kind === 'danger' ? 'rgba(239,68,68,0.12)' : 'rgba(200,200,210,0.3)'
    btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;background:transparent;cursor:pointer;font:inherit;font-size:12px;color:' + color + ';border-radius:5px;text-align:left'
    btn.addEventListener('mouseenter', function () { btn.style.background = hoverBg })
    btn.addEventListener('mouseleave', function () { btn.style.background = 'transparent' })
    // Optional two-step confirm (confirmText): the first click arms the
    // item and relabels it; only a second click within 4s runs onClick —
    // destructive items must never fire on a single misclick.
    var armed = false
    var disarmTimer = null
    btn.addEventListener('click', function (e) {
      e.stopPropagation()
      if (confirmText === undefined) { onClick(); return }
      if (!armed) {
        armed = true
        btn.textContent = confirmText
        disarmTimer = setTimeout(function () {
          armed = false
          btn.textContent = label
        }, 4000)
        return
      }
      clearTimeout(disarmTimer)
      armed = false
      btn.textContent = label
      onClick()
    })
    viewport.appendChild(btn)
  }

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes
      if (!added || added.length === 0) continue
      for (var j = 0; j < added.length; j++) {
        var node = added[j]
        if (node.nodeType !== 1) continue
        var el = node
        if (el.getAttribute && el.getAttribute('role') === 'menu') {
          injectItems(el)
        } else {
          var menu = el.querySelector && el.querySelector('[role="menu"]')
          if (menu) injectItems(menu)
        }
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  return function () {
    observer.disconnect()
  }
}

/**
 * 扩展插件 tab contribution: plugin management rendered inside the shell-owned
 * 插件 settings section (after 插件配置 and 插件列表).
 */
function PluginsSection(props) {
  // Lazy initializer: the seed object (and its localStorage read) must be
  // built once at mount, not re-parsed on every render.
  var pairPlugins = useState(function () {
    return {
      profileDir: '',
      plugins: [],
      busy: false,
      error: '',
      spec: '',
      confirming: null,
      note: '',
      output: '',
      filter: 'all',
      needle: '',
      checkingUpdates: false,
      updateChecked: false, // true once a check finished (even if no updates)
      // Seed from persisted reminders so the ⬆ 有新版本 badge is visible the
      // moment the panel mounts (before the fresh host check resolves) — the
      // reminder is only dropped once a check confirms the upgrade completed.
      updates: loadUpdateReminders(), // name -> { latest, updateAvailable, error?, at? }
    }
  })
  var pView = pairPlugins[0]
  var setPView = pairPlugins[1]

  var alive = useRef(false)
  // In-flight check guard as a ref, not state: the state field drives the
  // disabled button visuals, but gating ASYNC handlers on it races — a stale
  // closure reads TRUE after an earlier check already settled and silently
  // skips a required follow-up (the post-upgrade refresh), or FALSE mid-flight
  // and lets a second one through. Refs are immune to closure staleness.
  var checkingRef = useRef(false)

  function patchPlugin(partial) {
    setPView(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      for (var pk in partial) next[pk] = partial[pk]
      return next
    })
  }

  function callRemote(method, args) {
    return props.call(method, args)
  }

  /**
   * Reload the plugin layer list from the host.
   * @param keepFeedback - when true, refresh ONLY the rows: busy/error/note
   *   stay untouched. Failure branches use this after patching the error —
   *   patch + reload in the same microtask otherwise batch into one render
   *   (React 18) and the just-set error text never paints, so a failed
   *   安装/更新/卸载 would look like "nothing happened".
   */
  function reloadPlugins(keepFeedback) {
    if (!keepFeedback) patchPlugin({ busy: true, error: '', note: '' })
    callRemote('pluginAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var next = {
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
        }
        if (!keepFeedback) next.busy = false
        patchPlugin(next)
      } else if (!keepFeedback) {
        patchPlugin({ busy: false, error: '加载插件失败：' + messageOf(result.error) })
      }
      // keepFeedback: the visible error stays; a failed follow-up list just
      // leaves the rows stale.
    }, function (failure) {
      if (!alive.current) return
      if (!keepFeedback) patchPlugin({ busy: false, error: '调用失败：' + messageOf(failure) })
    })
  }

  /**
   * Query the npm registry for newer versions of registry-installed bundles
   * and stash per-plugin results. The resolution MERGES the fresh authoritative
   * results onto the previously persisted reminders:
   *   - newer version confirmed      -> (re)arm & persist the reminder
   *   - confirmed up to date         -> drop the reminder (更新完删除提醒)
   *   - per-plugin check error       -> keep the known reminder (a transient
   *                                     registry failure must not erase it);
   *                                     with no known reminder the failure
   *                                     itself is recorded so cards/strip/
   *                                     note can surface it
   *   - no longer a registry install -> drop stale reminders
   * The AUTO check on panel open is cache-friendly; a manual check passes
   * force=true so the host bypasses its 5-minute TTL, re-queries the registry
   * and refreshes the cached content (检查更新 = 强制重新查，而不是回放缓存).
   * Runs concurrently with the list so the panel stays responsive; failures
   * are per-plugin, never fatal.
   * @param force - true to force the host to bypass its update cache.
   */
  function checkUpdates(force) {
    if (checkingRef.current) return
    checkingRef.current = true
    patchPlugin({ checkingUpdates: true, note: '' })
    callRemote('pluginAdmin/checkUpdates', { force: force === true }).then(function (result) {
      checkingRef.current = false
      if (!alive.current) return
      if (!result.ok) {
        patchPlugin({ checkingUpdates: false, error: '检查更新失败：' + messageOf(result.error) })
        // A failed call must not wipe previously known reminders — they stay
        // seeded from localStorage and keep rendering on the cards.
        return
      }
      var list = (result.value && result.value.updates) || []
      // Merge INSIDE the functional updater against the LATEST committed
      // state, never the render closure's snapshot: a reminder armed by an
      // in-flight check resolving alongside an upgrade commit must survive
      // (a stale-snapshot full replace erased it). The updater stays pure —
      // localStorage persistence is owned by the mirror effect below.
      setPView(function (cur) {
        var next = {}
        for (var k in cur) next[k] = cur[k]
        next.checkingUpdates = false
        next.updates = mergeUpdateReminders(cur.updates || {}, list)
        next.updateChecked = true
        next.note = updateCheckNote(next.updates, list.length)
        return next
      })
    }, function (failure) {
      checkingRef.current = false
      if (!alive.current) return
      patchPlugin({ checkingUpdates: false, error: '检查更新调用失败：' + messageOf(failure) })
    })
  }

  /** Upgrade one plugin to its latest version (registry install by name). */
  function upgradePlugin(name) {
    if (pView.busy) return
    // Prefer the exact version already discovered by checkUpdates(): passing
    // `name@latest` to pnpm is unreliable when the manifest already carries a
    // range constraint (e.g. "^0.4.2") — pnpm can resolve @latest against the
    // satisfied range and report "Already up to date" WITHOUT fetching the new
    // version (exit 0, nothing changed). Pinning the exact latest version makes
    // pnpm bump the constraint and actually download the new package. The host
    // install() also falls back to resolving @latest server-side, so a direct
    // `name@latest` still works as a second guard.
    var known = pView.updates && pView.updates[name]
    var spec = (known && known.latest) ? (name + '@' + known.latest) : (name + '@latest')
    patchPlugin({ busy: true, error: '', confirming: null, note: '' })
    callRemote('pluginAdmin/install', { spec: spec }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        // The upgrade consumed this reminder: strip it from the CURRENT state
        // inside the updater (更新完删除提醒) — never from the click-time
        // closure snapshot, which may miss reminders an in-flight check armed
        // meanwhile (erasing those was exactly scenario 7's stale-snapshot
        // bug). localStorage follows via the shared mirror effect; the forced
        // refresh below confirms the new version is current.
        setPView(function (cur) {
          var next = {}
          for (var k in cur) next[k] = cur[k]
          next.busy = false
          next.note = '已更新 ' + name + '。更改在重启 dsh 后生效'
          next.output = (result.value && result.value.output) || ''
          next.profileDir = (result.value && result.value.profileDir) || ''
          next.plugins = (result.value && result.value.plugins) || []
          var remaining = {}
          for (var rk in cur.updates) {
            if (rk !== name) remaining[rk] = cur.updates[rk]
          }
          next.updates = remaining
          return next
        })
        // Refresh the update map so the upgraded entry stops flagging.
        // Force: the @latest spec installed the registry's CURRENT latest,
        // but the host TTL cache may still hold an older latest published
        // minutes ago — comparing against that would re-flag the freshly
        // upgraded plugin. Bypass the cache and resync its content instead.
        checkUpdates(true)
        return
      }
      var failMessage = '更新失败：' + messageOf(result.error)
      patchPlugin({ busy: false, error: failMessage })
      // Floating toast for the failure in addition to the persistent panel
      // error bar (the toast demands attention, the bar keeps the detail).
      showToast('error', failMessage)
      reloadPlugins(true)
    }, function (failure) {
      if (!alive.current) return
      patchPlugin({ busy: false, error: '调用失败：' + messageOf(failure) })
    })
  }

  function installPlugin() {
    if (pView.busy || pView.spec.trim() === '') return
    var spec = pView.spec.trim()
    patchPlugin({ busy: true, error: '', confirming: null, note: '' })
    callRemote('pluginAdmin/install', { spec: spec }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patchPlugin({
          busy: false,
          note: '安装完成。更改在重启 dsh 后生效',
          output: (result.value && result.value.output) || '',
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
          spec: '',
        })
        return
      }
      var failMessage = '安装失败：' + messageOf(result.error)
      patchPlugin({ busy: false, error: failMessage })
      showToast('error', failMessage)
      reloadPlugins(true)
    }, function (failure) {
      if (!alive.current) return
      patchPlugin({ busy: false, error: '调用失败：' + messageOf(failure) })
    })
  }

  function removePlugin(name) {
    patchPlugin({ busy: true, error: '', confirming: null, note: '' })
    callRemote('pluginAdmin/remove', { name: name }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patchPlugin({
          busy: false,
          note: '卸载完成。更改在重启 dsh 后生效',
          output: (result.value && result.value.output) || '',
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
        })
        return
      }
      var failMessage = '卸载失败：' + messageOf(result.error)
      patchPlugin({ busy: false, error: failMessage })
      showToast('error', failMessage)
      reloadPlugins(true)
    }, function (failure) {
      if (!alive.current) return
      patchPlugin({ busy: false, error: '调用失败：' + messageOf(failure) })
    })
  }

  useEffect(function () {
    alive.current = true
    reloadPlugins()
    // Auto-check for remote updates on mount (the panel loads lazily when
    // the 扩展插件 tab is opened, so this runs once per open). The auto path
    // is cache-friendly: the host serves its 5-minute cache, so re-opening
    // the tab shortly after does not re-hit the registry. The manual
    // ⬆ 检查更新 button is the force path — it bypasses the cache and
    // refreshes its content.
    checkUpdates()
    return function () { alive.current = false }
  }, [])

  // Single persistence point: localStorage always mirrors the LATEST
  // committed reminders. Moving saves out of the async handlers (and out of
  // the functional updaters, which must stay pure) removes drift by
  // construction — whatever merge won the last commit is what survives
  // dialog reopen and dsh restarts (best-effort; unavailable storage just
  // degrades to session-only badges).
  useEffect(function () {
    saveUpdateReminders(pView.updates || {})
  }, [pView.updates])

  return createElement('div', { 'data-dsh-admin-section': '' },
    renderPluginsView(pView, patchPlugin, installPlugin, removePlugin, checkUpdates, upgradePlugin))
}

/**
 * 历史会话 settings section (standalone settings-nav page).
 */
function SessionsSection(props) {
  var pairSessions = useState({
    sessions: [],
    workspaces: [],
    busy: false,
    error: '',
    needle: '',
    confirming: null,
    filter: 'all',
  })
  var sView = pairSessions[0]
  var setSView = pairSessions[1]

  var alive = useRef(false)

  function patchSession(partial) {
    setSView(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      for (var pk in partial) next[pk] = partial[pk]
      return next
    })
  }

  function callRemote(method, args) {
    return props.call(method, args)
  }

  function reloadSessions() {
    patchSession({ busy: true, error: '' })
    callRemote('sessionAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patchSession({
          busy: false,
          sessions: (result.value && result.value.sessions) || [],
          workspaces: (result.value && result.value.workspaces) || [],
        })
      } else {
        patchSession({ busy: false, error: '加载会话失败：' + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchSession({ busy: false, error: '调用失败：' + messageOf(failure) })
    })
  }

  function actSession(method, sessionId) {
    patchSession({ busy: true, error: '', confirming: null })
    callRemote('sessionAdmin/' + method, { sessionId: sessionId }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        // Refresh this panel's own list, and nudge the sidebar (via the
        // sessions service) so a deleted session disappears immediately
        // instead of lingering until reload.
        if ((method === 'deleteSession' || method === 'closeSession') && props.refreshSessions) props.refreshSessions()
        return reloadSessions()
      }
      patchSession({ busy: false, error: '操作失败：' + messageOf(result.error) })
    }, function (failure) {
      if (!alive.current) return
      patchSession({ busy: false, error: '调用失败：' + messageOf(failure) })
    })
  }

  useEffect(function () {
    alive.current = true
    reloadSessions()
    return function () { alive.current = false }
  }, [])

  return createElement('div', { 'data-dsh-admin-section': '' },
    renderSessionsView(sView, patchSession, reloadSessions, actSession))
}

/**
 * MCP服务器 settings section (standalone settings-nav page).
 */

/* ------------------------------------------------------------------------ */
/* MCP test-result cache                                                     */
/*                                                                          */
/* Successful connectivity probes are persisted to localStorage so the      */
/* panel shows the last known status after tab switches or reopening the    */
/* dialog instead of an empty state. Only OK results are cached (failures   */
/* are usually transient); a cached row is labelled with its probe time,    */
/* and the cache entry is invalidated when the config is saved or removed,  */
/* or pruned when the entry disappears from the host list.                  */
/* ------------------------------------------------------------------------ */

var MCP_TEST_CACHE_KEY = 'dsh-plugin-admin/mcp-test-results'

/**
 * Touch localStorage safely: on some environments (jsdom with an opaque
 * origin, hardened browsers, privacy modes) merely READING window.localStorage
 * throws a SecurityError, so the access itself has to sit inside try/catch.
 * Returns null when storage is unavailable.
 */
function safeLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch (e) {
    return null
  }
}

function mcpTestStorage() {
  return safeLocalStorage()
}

function loadMcpTestCache() {
  var store = mcpTestStorage()
  if (store === null) return {}
  try {
    var parsed = JSON.parse(store.getItem(MCP_TEST_CACHE_KEY))
    if (parsed === null || typeof parsed !== 'object') return {}
    // Purge failure records persisted by older builds: only a durable OK is
    // worth restoring on mount; a stale ❌ from a past outage must not
    // outlive the session it happened in.
    var out = {}
    for (var id in parsed) {
      var entry = parsed[id]
      if (entry && entry.result && entry.result.ok === true) out[id] = entry
    }
    return out
  } catch (e) {
    return {}
  }
}

/** Mirror settled, successful probes into localStorage (best-effort). */
function saveMcpTestCache(state) {
  var store = mcpTestStorage()
  if (store === null) return
  try {
    var out = {}
    for (var id in state) {
      var s = state[id]
      // Busy rows keep the previous cached result; failures stay ephemeral —
      // INCLUDING structured {ok:false} probes (timeout, connection refused),
      // which arrive as a truthy result object and need their own ok check.
      if (!s || s.busy || s.result === null || s.result === undefined
        || s.result.ok !== true) continue
      out[id] = { result: s.result, at: typeof s.at === 'number' ? s.at : Date.now() }
    }
    store.setItem(MCP_TEST_CACHE_KEY, JSON.stringify(out))
  } catch (e) {
    // Quota exceeded / storage blocked — the cache is optional, never fatal.
  }
}

/** Drop one entry's cached probe (config saved or entry removed). */
function clearMcpTestCacheEntry(id) {
  var store = mcpTestStorage()
  if (store === null) return
  try {
    var state = loadMcpTestCache()
    if (state[id] === undefined) return
    delete state[id]
    store.setItem(MCP_TEST_CACHE_KEY, JSON.stringify(state))
  } catch (e) { /* ignore */ }
}

/** Drop test states whose entry no longer exists in the host list. */
function pruneMcpTestState(map, entries) {
  var valid = {}
  for (var i = 0; i < entries.length; i++) valid[entries[i].id] = true
  var next = {}
  var changed = false
  for (var id in map) {
    if (valid[id]) next[id] = map[id]
    else changed = true
  }
  if (changed) saveMcpTestCache(next)
  return next
}

/** Compact timestamp for a cached probe ("14:32" today, "6-1 14:32" older). */
function formatTestTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  var d = new Date(ms)
  var pad = function (n) { return (n < 10 ? '0' : '') + String(n) }
  var hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
  var now = new Date()
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hm
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm
}

/* Update-reminder persistence                                               */
/*                                                                          */
/* A "⬆ 有新版本" reminder is a durable fact, not a transient fetch result: */
/* once a newer version is detected it is kept in localStorage until a      */
/* check confirms the installed version is current again (i.e. the update   */
/* actually completed). This is what keeps the badge visible after closing  */
/* and reopening the dialog, across dsh restarts, and even when a later     */
/* re-check hits a transient network failure — and what clears it only once */
/* the plugin is upgraded (更新完删除提醒).                                  */
/* ------------------------------------------------------------------------ */

var UPDATE_REMINDER_KEY = 'dsh-plugin-admin/update-reminders'

/** Shape-merge a reminder entry (keeps the original truthy fields). */
function mergeReminder(entry, partial) {
  var next = {}
  for (var k in entry) next[k] = entry[k]
  for (var pk in partial) next[pk] = partial[pk]
  return next
}

/**
 * Load persisted update reminders as state entries:
 * { name: { latest, at, updateAvailable, error } }. Storage-unavailable
 * environments (opaque-origin jsdom, privacy modes) just get an empty map.
 */
function loadUpdateReminders() {
  var store = safeLocalStorage()
  if (store === null) return {}
  try {
    var parsed = JSON.parse(store.getItem(UPDATE_REMINDER_KEY))
    var out = {}
    if (parsed !== null && typeof parsed === 'object') {
      for (var name in parsed) {
        var r = parsed[name]
        if (r && typeof r.latest === 'string' && r.latest.length > 0) {
          out[name] = {
            latest: r.latest,
            at: typeof r.at === 'number' ? r.at : 0,
            updateAvailable: true,
            error: '',
          }
        }
      }
    }
    return out
  } catch (e) {
    return {}
  }
}

/** Mirror the current reminder set into localStorage (best-effort). */
function saveUpdateReminders(map) {
  var store = safeLocalStorage()
  if (store === null) return
  try {
    var out = {}
    for (var name in map) {
      var r = map[name]
      if (r && r.updateAvailable === true && typeof r.latest === 'string' && r.latest.length > 0) {
        out[name] = { latest: r.latest, at: typeof r.at === 'number' ? r.at : Date.now() }
      }
    }
    store.setItem(UPDATE_REMINDER_KEY, JSON.stringify(out))
  } catch (e) {
    // Quota exceeded / storage blocked — the reminder is optional, never fatal.
  }
}

/**
 * Merge one check response into the CURRENT reminder map. Pure on purpose:
 * it runs inside the setPView updater, so it reads only its arguments and
 * must never touch localStorage or other component state. Per-entry semantics
 * (list = fresh host results, one row per live registry install):
 *   - updateAvailable  -> (re)arm the reminder
 *   - confirmed current -> drop any entry (更新完删除提醒)
 *   - query error      -> keep a prior reminder untouched (error attached);
 *                         without one, record an ephemeral failure
 *                         ({updateAvailable:false}) so cards/strip/note can
 *                         surface it — saveUpdateReminders skips those
 *   - entries absent from `list` are no longer live registry installs ->
 *     stale reminders dropped
 * @param curMap - the CURRENT updates state ({ name -> entry }).
 * @param list - per-plugin check results.
 * @returns the complete next map.
 */
function mergeUpdateReminders(curMap, list) {
  var liveNames = {}
  for (var a = 0; a < list.length; a++) liveNames[list[a].name] = true
  var map = {}
  for (var k in curMap) {
    if (curMap[k] && liveNames[k]) map[k] = curMap[k]
  }
  for (var i = 0; i < list.length; i++) {
    var u = list[i]
    if (u.updateAvailable === true) {
      map[u.name] = { latest: u.latest, updateAvailable: true, error: '', at: Date.now() }
    } else if (u.error) {
      // A prior reminder survives untouched with the transient error
      // alongside; WITHOUT one the failure itself lands in the map so an
      // all-failed first check cannot claim 全部为最新版本.
      map[u.name] = map[u.name]
        ? mergeReminder(map[u.name], { error: u.error || '' })
        : { latest: '', updateAvailable: false, error: u.error || '', at: Date.now() }
    } else if (u.latest !== null && u.latest !== undefined) {
      delete map[u.name]
    }
  }
  return map
}

/** Aggregate summary line for a finished check (pure). */
function updateCheckNote(map, checkedCount) {
  var updateCount = 0
  var checkErrorCount = 0
  for (var n in map) {
    if (map[n].updateAvailable === true) updateCount++
    if (map[n].error) checkErrorCount++
  }
  if (updateCount > 0) return '发现 ' + updateCount + ' 个插件有新版本'
  if (checkErrorCount > 0) {
    return '已检查 ' + checkedCount + ' 个插件（' + checkErrorCount + ' 个查询失败）'
      + (checkedCount > checkErrorCount ? '，其余均为最新版本' : '')
  }
  return checkedCount > 0 ? '已检查 ' + checkedCount + ' 个插件，均为最新版本' : ''
}

function McpSection(props) {
  var pairMcp = useState({
    mcpEntries: [],
    mcpBusy: false,
    mcpError: '',
    mcpEditorOpen: false,
    mcpDraft: null,
    // entryId -> { busy?, result?, error?, at? }; previous successful probes
    // are restored from localStorage so statuses survive panel remounts.
    mcpTestState: loadMcpTestCache(),
  })
  var mView = pairMcp[0]
  var setMView = pairMcp[1]

  var alive = useRef(false)

  function patchMcp(partial) {
    setMView(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      for (var pk in partial) next[pk] = partial[pk]
      return next
    })
  }

  // Merge a partial into the CURRENT mcpDraft via a functional update, so
  // rapid successive field edits (React batching) never lose earlier input.
  function patchDraft(partial) {
    setMView(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.mcpDraft = mergeDraft(cur.mcpDraft, partial)
      return next
    })
  }

  function callRemote(method, args) {
    return props.call(method, args)
  }

  function reloadMcp() {
    patchMcp({ mcpBusy: true, mcpError: '' })
    callRemote('mcpAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var entries = (result.value && result.value.entries) || []
        setMView(function (cur) {
          var next = {}
          for (var k in cur) next[k] = cur[k]
          next.mcpBusy = false
          next.mcpEntries = entries
          // Drop cached probes whose entry no longer exists on the host.
          next.mcpTestState = pruneMcpTestState(cur.mcpTestState, entries)
          return next
        })
      } else {
        patchMcp({ mcpBusy: false, mcpError: '加载 MCP 配置失败：' + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchMcp({ mcpBusy: false, mcpError: '调用失败：' + messageOf(failure) })
    })
  }

  function openMcpEditor(entry) {
    if (entry !== null && entry !== undefined && (entry.config === null || entry.config === undefined)) {
      patchMcp({ mcpError: '该 MCP 配置无法安全解析，已禁止在此覆盖；请在 cordis.patch.yml 中手动编辑。' })
      return
    }
    var source = entry !== null && entry !== undefined ? entry.config : null
    var draft = source ? {
      id: entry.id,
      isNew: false,
      serverName: source.serverName || entry.id,
      transport: source.transport,
      command: source.command || '',
      url: source.url || '',
      args: (source.args || []).join(' '),
      argsOriginal: source.args || [],
      argsChanged: false,
      env: Object.keys(source.env || {}).map(function (key) { return key + '=' + source.env[key] }).join('\n'),
      envOriginal: source.env || {},
      envChanged: false,
      cwd: source.cwd || '',
      headers: Object.keys(source.headers || {}).map(function (k) { return k + '=' + source.headers[k] }).join('\n'),
      headersOriginal: source.headers || {},
      headersChanged: false,
      toolCallTimeoutMs: source.toolCallTimeoutMs,
      failOnStartupError: source.failOnStartupError === true,
      reconnectEnabled: source.reconnect ? source.reconnect.enabled === true : false,
      reconnectInitialDelayMs: source.reconnect ? source.reconnect.initialDelayMs : 1000,
      reconnectMaxDelayMs: source.reconnect ? source.reconnect.maxDelayMs : 30000,
      reconnectMaxAttempts: source.reconnect ? source.reconnect.maxAttempts : 10,
    } : {
      // New server: pre-fill a collision-free id so the user does not have to
      // invent one; they can still edit it or regenerate it.
      id: generateMcpId(mView.mcpEntries),
      isNew: true,
      serverName: '',
      transport: 'stdio',
      command: '',
      url: '',
      args: '',
      argsOriginal: [],
      argsChanged: false,
      env: '',
      envOriginal: {},
      envChanged: false,
      cwd: '',
      headers: '',
      headersOriginal: {},
      headersChanged: false,
      toolCallTimeoutMs: undefined,
      failOnStartupError: false,
      reconnectEnabled: false,
      reconnectInitialDelayMs: 1000,
      reconnectMaxDelayMs: 30000,
      reconnectMaxAttempts: 10,
    }
    patchMcp({ mcpEditorOpen: true, mcpDraft: draft, mcpError: '' })
  }

  function closeMcpEditor() {
    patchMcp({ mcpEditorOpen: false, mcpDraft: null, mcpError: '' })
  }

  function saveMcpDraft() {
    var draft = mView.mcpDraft
    if (draft === null) return
    // A NEW entry must not collide with an existing id: the host's upsert
    // locates its target block by id and would replace that entry in place,
    // silently destroying its config. The edit form keeps its own id (the
    // field is disabled), so this guard only ever fires on the add form.
    if (draft.isNew) {
      for (var ci = 0; ci < mView.mcpEntries.length; ci++) {
        if (mView.mcpEntries[ci].id === draft.id) {
          patchMcp({ mcpError: 'ID \'' + draft.id + '\' 已被其他 MCP 条目占用，请换一个再保存。' })
          return
        }
      }
    }
    var config
    if (draft.transport === 'streamable-http') {
      config = { transport: 'streamable-http', serverName: draft.serverName, url: draft.url }
      var headersStr = Object.keys(draft.headersOriginal || {}).map(function (k) { return k + '=' + draft.headersOriginal[k] }).join('\n')
      var headers = (draft.headersChanged && draft.headers !== headersStr) ? {} : draft.headersOriginal
      if (draft.headersChanged && draft.headers !== headersStr && draft.headers !== '') {
        // Newline-only split: header values legitimately contain ';'/','
        // (Cookie, Accept), which must never become pair separators.
        var pairs = draft.headers.split('\n').map(function (s) { return s.trim() }).filter(Boolean)
        for (var i = 0; i < pairs.length; i++) {
          var eq = pairs[i].indexOf('=')
          if (eq > 0) headers[pairs[i].slice(0, eq).trim()] = pairs[i].slice(eq + 1).trim()
        }
      }
      if (Object.keys(headers).length > 0) config.headers = headers
    } else {
      config = { transport: 'stdio', serverName: draft.serverName, command: draft.command }
      var argsStr = (draft.argsOriginal || []).join(' ')
      var args = (draft.argsChanged && draft.args !== argsStr) ? draft.args.split(/\s+/).filter(Boolean) : draft.argsOriginal
      if (args.length > 0) config.args = args
      var envStr = Object.keys(draft.envOriginal || {}).map(function (k) { return k + '=' + draft.envOriginal[k] }).join('\n')
      var env = (draft.envChanged && draft.env !== envStr) ? {} : draft.envOriginal
      if (draft.envChanged && draft.env !== envStr && draft.env !== '') {
        // Newline-only split: values like PATH=C:\a;C:\b would lose their
        // tail (and Windows paths carry ';' everywhere).
        var pairs = draft.env.split('\n').map(function (s) { return s.trim() }).filter(Boolean)
        for (var i = 0; i < pairs.length; i++) {
          var eq = pairs[i].indexOf('=')
          if (eq > 0) env[pairs[i].slice(0, eq).trim()] = pairs[i].slice(eq + 1).trim()
        }
      }
      if (Object.keys(env).length > 0) config.env = env
      if (draft.cwd !== '') config.cwd = draft.cwd
    }
    if (draft.toolCallTimeoutMs !== undefined) config.toolCallTimeoutMs = draft.toolCallTimeoutMs
    if (draft.failOnStartupError) config.failOnStartupError = true
    if (draft.reconnectEnabled) {
      config.reconnect = {
        enabled: true,
        initialDelayMs: Number(draft.reconnectInitialDelayMs),
        maxDelayMs: Number(draft.reconnectMaxDelayMs),
        maxAttempts: Number(draft.reconnectMaxAttempts),
      }
    }
    patchMcp({ mcpBusy: true, mcpError: '' })
    callRemote('mcpAdmin/upsert', { entry: { id: draft.id, config: config } }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        // The config changed, so any cached probe no longer describes this
        // server — drop it from storage and from the panel.
        clearMcpTestCacheEntry(draft.id)
        patchMcpTest(draft.id, { busy: false, result: null, error: null })
        patchMcp({ mcpBusy: false, mcpEntries: (result.value && result.value.entries) || [], mcpEditorOpen: false, mcpDraft: null })
      } else {
        patchMcp({ mcpBusy: false, mcpError: '保存 MCP 配置失败：' + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchMcp({ mcpBusy: false, mcpError: '调用失败：' + messageOf(failure) })
    })
  }

  function removeMcpEntry(id) {
    patchMcp({ mcpBusy: true, mcpError: '' })
    callRemote('mcpAdmin/remove', { id: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        // The entry is gone — its cached probe must not linger in storage.
        clearMcpTestCacheEntry(id)
        patchMcp({ mcpBusy: false, mcpEntries: (result.value && result.value.entries) || [] })
      } else {
        patchMcp({ mcpBusy: false, mcpError: '移除 MCP 配置失败：' + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchMcp({ mcpBusy: false, mcpError: '调用失败：' + messageOf(failure) })
    })
  }

  /**
   * Set one entry's connectivity-test status against the CURRENT state.
   * Settled successful probes are mirrored into localStorage so the last
   * known status survives tab switches and reopening the settings dialog.
   */
  function patchMcpTest(id, partial) {
    setMView(function (cur) {
      var nextTestState = mergeTestState(cur.mcpTestState, id, partial)
      saveMcpTestCache(nextTestState)
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.mcpTestState = nextTestState
      return next
    })
  }

  /** Run a host-side connectivity probe for one entry and stash the result. */
  function testMcpEntry(id) {
    patchMcpTest(id, { busy: true, result: null, error: null })
    callRemote('mcpAdmin/test', { id: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok && result.value !== null && typeof result.value === 'object') {
        // `at` timestamps the probe; it is what the cached label renders.
        patchMcpTest(id, { busy: false, result: result.value, at: Date.now() })
      } else {
        patchMcpTest(id, { busy: false, result: null, error: messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchMcpTest(id, { busy: false, result: null, error: messageOf(failure) })
    })
  }

  useEffect(function () {
    alive.current = true
    reloadMcp()
    return function () { alive.current = false }
  }, [])

  return createElement('div', { 'data-dsh-admin-section': '', className: mView.mcpEditorOpen ? 'mcp-editor-open' : '' },
    renderMcpSection(mView, patchDraft, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry))
}

/* ========================================================================== */
/*                           Render Plugins View                              */
/* ========================================================================== */

function renderPluginsView(view, patch, install, remove, checkUpdates, upgrade) {
  var elements = []

  // Toolbar, two rows: search alone on the first (it gets the full width),
  // install input + actions on the second.
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar-search' },
    createElement('div', { className: 'search-wrap', key: 'search-wrap' },
      createElement('span', { className: 'search-icon', key: 'icon' }, '🔍'),
      createElement('input', {
        className: 'input',
        key: 'search-input',
        placeholder: '搜索插件（名称/版本/路径）...',
        value: view.needle,
        onChange: function (e) { patch({ needle: e.target.value }) },
      }),
      view.needle !== '' ? createElement('button', {
        type: 'button',
        key: 'btn-clear-search',
        className: 'btn sm',
        title: '清空搜索',
        onClick: function () { patch({ needle: '' }) },
      }, '✕') : null
    ),
  ))
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar-install' },
    createElement('div', { className: 'input-wrap install-wrap', key: 'install-wrap' },
      createElement('input', {
        className: 'input',
        placeholder: '安装包名/路径...',
        value: view.spec,
        disabled: view.busy,
        onChange: function (e) { patch({ spec: e.target.value }) },
        onKeyDown: function (e) { if (e.key === 'Enter') install() },
      })
    ),
    createElement('button', {
      type: 'button',
      key: 'btn-install',
      className: 'btn primary',
      disabled: view.busy || view.spec.trim() === '',
      onClick: install,
    },
      view.busy ? createElement('span', { className: 'spinner', key: 'spin' }) : null,
      '安装'
    ),
    createElement('button', {
      type: 'button',
      key: 'btn-check-updates',
      className: 'btn',
      disabled: view.busy || view.checkingUpdates,
      title: '强制绕过 5 分钟缓存，重新查询 registry 并刷新缓存',
      onClick: function () { checkUpdates(true) },
    },
      view.checkingUpdates ? createElement('span', { className: 'spinner', key: 'spin' }) : null,
      view.checkingUpdates ? '检查中...' : '⬆️ 检查更新'
    ),
  ))

  // Filter Pills
  var totalPlugins = view.plugins.length
  var thirdPartyCount = 0
  var builtinCount = 0
  for (var i = 0; i < view.plugins.length; i++) {
    if (view.plugins[i].removable) thirdPartyCount++
    else builtinCount++
  }

  elements.push(createElement('div', { className: 'filter-bar', key: 'filters' },
    createElement('button', {
      type: 'button',
      key: 'filter-all',
      className: 'pill' + (view.filter === 'all' ? ' active' : ''),
      onClick: function () { patch({ filter: 'all' }) },
    }, '全部 (' + String(totalPlugins) + ')'),
    createElement('button', {
      type: 'button',
      key: 'filter-plugin',
      className: 'pill' + (view.filter === 'plugin' ? ' active' : ''),
      onClick: function () { patch({ filter: 'plugin' }) },
    }, '扩展插件 (' + String(thirdPartyCount) + ')'),
    createElement('button', {
      type: 'button',
      key: 'filter-builtin',
      className: 'pill' + (view.filter === 'builtin' ? ' active' : ''),
      onClick: function () { patch({ filter: 'builtin' }) },
    }, '系统内置 (' + String(builtinCount) + ')')
  ))

  // Busy banner / Error
  if (view.busy) {
    elements.push(createElement('div', { className: 'busy-banner', key: 'busy' },
      createElement('span', { className: 'spinner', key: 'spin' }),
      '正在执行 pnpm 操作（可能需要数秒至数分钟，请勿关闭窗口）...'
    ))
  }
  if (view.error !== '') {
    elements.push(createElement('div', { className: 'error', key: 'error' }, view.error))
  }

  // Update-check status strip: gives the auto-check a visible outcome instead
  // of hiding it in the footer. Checking → spinner; done with updates →
  // orange; done without updates → green; per-plugin query failures surface
  // on the strip rather than vanishing. Purely informational — the single
  // re-check entry point is the toolbar「⬆️ 检查更新」button (which forces a
  // fresh registry query), so no redundant button lives in the strip.
  if (view.checkingUpdates) {
    elements.push(createElement('div', { className: 'update-strip checking', key: 'update-checking' },
      createElement('span', { className: 'spinner', key: 'spin' }),
      '正在检查插件版本更新…'
    ))
  } else if (view.updateChecked) {
    var upCount = 0
    var errCount = 0
    for (var un in view.updates) {
      if (view.updates[un].updateAvailable === true) upCount++
      if (view.updates[un].error) errCount++
    }
    var stripClass = upCount > 0 ? 'update-strip has-updates'
      : (errCount > 0 ? 'update-strip has-errors' : 'update-strip ok')
    var stripText = upCount > 0
      ? '⬆️ 发现 ' + upCount + ' 个插件有新版本，可点击卡片上的「更新」升级'
      : (errCount > 0
        ? '⚠️ 有 ' + errCount + ' 个插件查询版本失败（网络或 registry 不可达）'
        : '✅ 已自动检查版本更新，全部为最新版本')
    elements.push(createElement('div', { className: stripClass, key: 'update-result' },
      createElement('span', { key: 't' }, stripText)
    ))
  }

  // Filter and render rows
  var needle = view.needle.trim().toLowerCase()
  var filtered = filterPlugins(view.plugins, view.filter, needle)
  var rows = []
  for (var j = 0; j < filtered.length; j++) {
    var p = filtered[j]
    rows.push(renderPluginCard(p, view, remove, patch, upgrade))
  }

  if (rows.length === 0) {
    rows.push(createElement('div', { className: 'empty', key: 'empty' },
      createElement('div', null, needle !== '' ? '🔍 无匹配的插件（试试其他关键词）' : '📦 暂无匹配的插件层')
    ))
  }

  elements.push(createElement('div', { className: 'list grid2', key: 'list' }, rows))

  // Footer
  var hintText = view.note !== '' ? view.note : '更改在重启 dsh 后生效（关闭 dsh 进程后重新运行即可）'
  var hintTitle = view.output !== '' ? 'pnpm 输出：\n' + view.output : undefined
  elements.push(createElement('div', { className: 'footer', key: 'footer' },
    createElement('span', { className: 'path', key: 'profile-path', title: view.profileDir }, view.profileDir || 'Profile: 默认'),
    createElement('span', { className: 'hint', key: 'hint', title: hintTitle }, hintText)
  ))

  return createElement('div', { key: 'plugins-panel', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, elements)
}


function renderMcpSection(view, patchDraft, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry) {
  var children = []
  var header = createElement('div', { className: 'group-header', key: 'mcp-header', style: { marginTop: 0 } },
    createElement('span', { className: 'group-title', key: 't' }, '🔌 MCP 配置'),
    createElement('span', { className: 'group-count', key: 'c' }, String(view.mcpEntries.length) + ' 个'),
    createElement('button', {
      type: 'button',
      key: 'btn-refresh-mcp',
      className: 'btn',
      disabled: view.mcpBusy,
      onClick: reloadMcp,
    }, '🔄 刷新'),
    createElement('button', {
      type: 'button',
      key: 'btn-add-mcp',
      className: 'btn primary',
      disabled: view.mcpBusy,
      onClick: function () { openMcpEditor(null) },
    }, '➕ 添加服务器'),
  )
  children.push(header)

  if (view.mcpError !== '') {
    children.push(createElement('div', { className: 'error', key: 'mcp-error' }, view.mcpError))
  }

  var rows = []
  for (var i = 0; i < view.mcpEntries.length; i++) {
    var entry = view.mcpEntries[i]
    var tag = createElement('span', { className: 'tag plugin', key: 'mcp-tag-' + entry.id },
      'MCP ' + String(entry.serverName || entry.id))
    var testState = (view.mcpTestState && view.mcpTestState[entry.id]) || null
    var testIndicator = null
    if (testState !== null && testState.busy) {
      testIndicator = createElement('span', { className: 'mcp-test mcp-test-busy', key: 'test-busy' },
        createElement('span', { className: 'spinner', key: 'sp' }),
        ' 检测中...')
    } else if (testState !== null && testState.result !== null && testState.result !== undefined) {
      var r = testState.result
      var ok = r.ok === true
      var label = ok ? '✅ 连通'
        : '❌ 不通'
      var detail = ok
        ? (r.serverInfo ? (r.serverInfo.name || '') + (r.serverInfo.version ? ' v' + r.serverInfo.version : '') : '') +
          (typeof r.toolCount === 'number' ? ' · ' + r.toolCount + ' 个工具' : '') +
          (r.pingOk === false ? ' · 初始化成功但 ping 失败' : '')
        : (r.error || '连接失败') + (r.ms !== undefined ? ' (' + r.ms + 'ms)' : '')
      var detailChildren = [
        createElement('span', { key: 'lbl' }, label + (detail !== '' ? ' ' + detail : '')),
      ]
      if (ok && Array.isArray(r.tools) && r.tools.length > 0) {
        detailChildren.push(createElement('span', { key: 'tools-hint', style: { opacity: 0.75 } },
          '工具：' + r.tools.join('、')))
      }
      if (r.warning) {
        detailChildren.push(createElement('span', { key: 'warn', className: 'mcp-test-warn', title: r.warning },
          '⚠️ ' + r.warning))
      }
      // Cached probe: label when it was taken so a restored status is never
      // mistaken for a just-run check. Clicking 🔌 测试 refreshes it.
      if (typeof testState.at === 'number') {
        detailChildren.push(createElement('span', {
          key: 'cached-at',
          className: 'mcp-test-cached',
          title: '上次检测结果（本地缓存）。点击「🔌 测试」可重新检测。',
        }, '· 缓存于 ' + formatTestTime(testState.at)))
      }
      testIndicator = createElement('div', {
        className: 'mcp-test mcp-test-list ' + (ok ? 'mcp-test-ok' : 'mcp-test-fail'),
        key: 'test-result',
        title: detail,
      }, detailChildren)
    } else if (testState !== null && testState.error !== null && testState.error !== undefined) {
      testIndicator = createElement('span', {
        className: 'mcp-test mcp-test-fail',
        key: 'test-error',
        title: testState.error,
      }, '❌ ' + testState.error)
    }
    var rowChildren = [
      createElement('div', { className: 'card-header', key: 'h' },
        createElement('span', { className: 'card-title-text', key: 'name' }, entry.id),
        tag,
        createElement('div', { className: 'card-actions', key: 'a' },
          createElement('button', {
            type: 'button',
            className: 'btn sm',
            disabled: view.mcpBusy || (testState !== null && testState.busy) || entry.config === null || entry.config === undefined,
            title: entry.config === null || entry.config === undefined ? '该配置无法安全解析，请手动编辑 cordis.patch.yml' : (testState !== null && testState.busy ? '检测中...' : (testState !== null && typeof testState.at === 'number' ? '重新检测该服务器的连通性（当前显示的是缓存结果）' : '测试该服务器的连通性')),
            onClick: function (id) { return function () { testMcpEntry(id) } }(entry.id),
          }, testState !== null && testState.busy ? '检测中' : '🔌 测试'),
          createElement('button', {
            type: 'button',
            className: 'btn sm',
            disabled: view.mcpBusy || (testState !== null && testState.busy) || entry.config === null || entry.config === undefined,
            title: entry.config === null || entry.config === undefined ? '该配置无法安全解析，请手动编辑 cordis.patch.yml' : undefined,
            onClick: function (value) { return function () { openMcpEditor(value) } }(entry),
          }, '编辑'),
          createElement('button', {
            type: 'button',
            className: 'btn danger sm',
            disabled: view.mcpBusy,
            onClick: function (id) { return function () { removeMcpEntry(id) } }(entry.id),
          }, '移除'),
        ),
      ),
    ]
    if (testIndicator !== null) {
      rowChildren.push(createElement('div', { className: 'mcp-test-row', key: 'test-row' }, testIndicator))
    }
    rows.push(createElement('div', { className: 'card', key: 'mcp-' + entry.id }, rowChildren))
  }
  if (rows.length === 0 && !view.mcpEditorOpen) {
    rows.push(createElement('div', { className: 'empty', key: 'mcp-empty' },
      createElement('div', null, '🔌 暂无 MCP 服务器配置')
    ))
  }
  children.push(createElement('div', { className: 'list', key: 'mcp-list' }, rows))

  // Editor form. patchDraft merges against the CURRENT draft in state so
  // typing across fields never clobbers earlier edits (stale-closure guard).
  if (view.mcpEditorOpen && view.mcpDraft !== null) {
    var d = view.mcpDraft
    var fieldStyle = { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }
    var labelStyle = { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #666)' }
    // 'mcp-editor' is the scroll-viewport class (max-height + overflow-y +
    // sticky actions in CSS): a tall add/edit form scrolls inside the bounded
    // settings dialog instead of pushing the 取消/保存 row out of reach.
    var editor = createElement('div', { className: 'card mcp-editor', key: 'mcp-editor' },
      createElement('div', { className: 'card-header', key: 'h' },
        createElement('span', { className: 'card-title-text', key: 't' }, d.isNew ? '添加 MCP 服务器' : '编辑 ' + d.id),
      ),
      createElement('div', { style: fieldStyle, key: 'f-id' },
        createElement('label', { style: labelStyle }, 'ID（唯一标识，[A-Za-z0-9_-]）'),
        createElement('div', { style: { display: 'flex', gap: '6px' } },
          createElement('input', {
            className: 'input',
            value: d.id,
            disabled: !d.isNew,
            onChange: function (e) { patchDraft({ id: e.target.value }) },
          }),
          d.isNew ? createElement('button', {
            type: 'button',
            className: 'btn sm',
            title: '重新生成一个随机 ID',
            onClick: function () { patchDraft({ id: generateMcpId(view.mcpEntries) }) },
          }, '🎲') : null,
        ),
      ),
      createElement('div', { style: fieldStyle, key: 'f-server' },
        createElement('label', { style: labelStyle }, 'serverName（模型命名空间）'),
        createElement('input', {
          className: 'input',
          value: d.serverName,
          onChange: function (e) { patchDraft({ serverName: e.target.value }) },
        }),
      ),
      createElement('div', { style: fieldStyle, key: 'f-transport' },
        createElement('label', { style: labelStyle }, '传输方式'),
        createElement('select', {
          className: 'input',
          value: d.transport,
          onChange: function (e) { patchDraft({ transport: e.target.value }) },
        },
          createElement('option', { value: 'stdio' }, 'stdio（子进程）'),
          createElement('option', { value: 'streamable-http' }, 'streamable-http（HTTP）'),
        ),
      ),
      d.transport === 'stdio' ? createElement('div', { style: fieldStyle, key: 'f-cmd' },
        createElement('label', { style: labelStyle }, 'command（启动命令）'),
        createElement('input', {
          className: 'input',
          value: d.command,
          placeholder: 'npx -y @modelcontextprotocol/server-github',
          onChange: function (e) { patchDraft({ command: e.target.value }) },
        }),
      ) : createElement('div', { style: fieldStyle, key: 'f-url' },
        createElement('label', { style: labelStyle }, 'url（MCP 端点）'),
        createElement('input', {
          className: 'input',
          value: d.url,
          placeholder: 'http://localhost:3000/mcp',
          onChange: function (e) { patchDraft({ url: e.target.value }) },
        }),
      ),
      d.transport === 'streamable-http' ? createElement('div', { style: fieldStyle, key: 'f-headers' },
        createElement('label', { style: labelStyle }, 'headers（每行 KEY=VALUE，可选）'),
        createElement('textarea', {
          className: 'input',
          style: { minHeight: '48px' },
          value: d.headers,
          onChange: function (e) { patchDraft({ headers: e.target.value, headersChanged: true }) },
        }),
      ) : null,
      d.transport === 'stdio' ? createElement('div', { style: fieldStyle, key: 'f-args' },
        createElement('label', { style: labelStyle }, 'args（空格分隔，可选）'),
        createElement('input', {
          className: 'input',
          value: d.args,
          onChange: function (e) { patchDraft({ args: e.target.value, argsChanged: true }) },
        }),
      ) : null,
      d.transport === 'stdio' ? createElement('div', { style: fieldStyle, key: 'f-env' },
        createElement('label', { style: labelStyle }, 'env（每行 KEY=VALUE，可选）'),
        createElement('textarea', {
          className: 'input',
          style: { minHeight: '48px' },
          value: d.env,
          onChange: function (e) { patchDraft({ env: e.target.value, envChanged: true }) },
        }),
      ) : null,
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', marginBottom: '4px', borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.3))', paddingTop: '8px' }, key: 'f-reconnect-header' },
        createElement('input', {
          type: 'checkbox',
          id: 'reconnect-toggle',
          checked: d.reconnectEnabled,
          onChange: function (e) { patchDraft({ reconnectEnabled: e.target.checked }) },
          style: { margin: '0' },
        }),
        createElement('label', { htmlFor: 'reconnect-toggle', style: { fontSize: '12px', fontWeight: 500, cursor: 'pointer', color: 'var(--dsw-alias-label-primary, #333)' } }, '启用自动重连'),
      ),
      d.reconnectEnabled ? createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px', paddingLeft: '4px' }, key: 'f-reconnect-fields' },
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 120px' }, key: 'f-reconnect-id' },
          createElement('label', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #666)' } }, 'initialDelayMs'),
          createElement('input', {
            className: 'input',
            type: 'number',
            min: 0,
            value: d.reconnectInitialDelayMs,
            onChange: function (e) { patchDraft({ reconnectInitialDelayMs: Number(e.target.value) }) },
          }),
        ),
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 120px' }, key: 'f-reconnect-md' },
          createElement('label', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #666)' } }, 'maxDelayMs'),
          createElement('input', {
            className: 'input',
            type: 'number',
            min: 0,
            value: d.reconnectMaxDelayMs,
            onChange: function (e) { patchDraft({ reconnectMaxDelayMs: Number(e.target.value) }) },
          }),
        ),
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 120px' }, key: 'f-reconnect-ma' },
          createElement('label', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #666)' } }, 'maxAttempts'),
          createElement('input', {
            className: 'input',
            type: 'number',
            min: 0,
            value: d.reconnectMaxAttempts,
            onChange: function (e) { patchDraft({ reconnectMaxAttempts: Number(e.target.value) }) },
          }),
        ),
      ) : null,
      createElement('div', { className: 'card-actions', key: 'f-actions', style: { justifyContent: 'flex-end', gap: '6px' } },
        createElement('button', {
          type: 'button',
          className: 'btn',
          disabled: view.mcpBusy,
          onClick: closeMcpEditor,
        }, '取消'),
        createElement('button', {
          type: 'button',
          className: 'btn primary',
          disabled: view.mcpBusy || d.id.trim() === '' || d.serverName.trim() === '' ||
            (d.transport === 'stdio' ? d.command.trim() === '' : d.url.trim() === ''),
          onClick: saveMcpDraft,
        }, view.mcpBusy ? '保存中...' : '保存'),
      ),
    )
    children.push(editor)
  }

  return createElement('div', { key: 'mcp-section', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, children)
}

// Characters allowed in an MCP entry id: [A-Za-z0-9_-]. The random part uses
// alphanumerics only so the generated id reads cleanly and always matches the
// host-side validation regex.
var MCP_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/**
 * Generate a fresh MCP entry id that is not already used by any listed entry
 * (an id collision would silently overwrite the existing entry on upsert).
 */
function generateMcpId(entries) {
  var taken = {}
  for (var i = 0; i < entries.length; i++) taken[entries[i].id] = true
  var candidate
  do {
    candidate = 'mcp-'
    for (var j = 0; j < 8; j++) {
      candidate += MCP_ID_ALPHABET.charAt(Math.floor(Math.random() * MCP_ID_ALPHABET.length))
    }
  } while (taken[candidate])
  return candidate
}

function mergeDraft(draft, partial) {
  var next = {}
  for (var k in draft) next[k] = draft[k]
  for (var pk in partial) next[pk] = partial[pk]
  return next
}

/** Set one entry's test status inside the shared mcpTestState map. */
function mergeTestState(map, id, partial) {
  var next = {}
  for (var k in map) next[k] = map[k]
  next[id] = {}
  var cur = map[id] || {}
  for (var ck in cur) next[id][ck] = cur[ck]
  for (var pk in partial) next[id][pk] = partial[pk]
  return next
}
function renderPluginCard(plugin, view, remove, patch, upgrade) {
  var isConfirming = view.confirming === plugin.name

  var titleChildren = [
    createElement('span', { className: 'card-title-text', key: 'name', title: plugin.name }, plugin.name),
  ]
  if (plugin.version) {
    titleChildren.push(createElement('span', { className: 'tag version', key: 'version' }, 'v' + plugin.version))
  }
  var isLocal = Boolean(plugin.localPath)
  titleChildren.push(createElement('span', {
    className: plugin.removable ? (isLocal ? 'tag local' : 'tag plugin') : 'tag',
    key: 'type-tag',
  },
    plugin.removable ? (isLocal ? '本地安装' : '包安装') : '内置'
  ))

  // Remote update badge: only for registry-installed bundles (removable and
  // not a local path) after a check ran. `updates` is keyed by plugin name.
  var updateInfo = view.updates && view.updates[plugin.name]
  if (updateInfo && updateInfo.updateAvailable && updateInfo.latest) {
    titleChildren.push(createElement('span', {
      className: 'tag update',
      key: 'update-badge',
      title: '远程 registry 有新版本：v' + updateInfo.latest + '（当前 v' + plugin.version + '）'
        + (typeof updateInfo.at === 'number' && updateInfo.at > 0 ? '，检测于 ' + formatTestTime(updateInfo.at) + '，更新后提醒自动消除' : ''),
    }, '⬆ 有新版本 v' + updateInfo.latest))
  } else if (updateInfo && updateInfo.error) {
    titleChildren.push(createElement('span', {
      className: 'tag update-error',
      key: 'update-error',
      title: updateInfo.error,
    }, '⚠ 更新检查失败'))
  }

  var headerChildren = [
    createElement('div', { className: 'card-title', key: 'title' }, titleChildren),
  ]

  if (plugin.removable && !isConfirming) {
    var actionChildren = []
    // 更新 button — only when an update is available and the plugin is a
    // registry install (not local path).
    if (updateInfo && updateInfo.updateAvailable && updateInfo.latest && !isLocal) {
      actionChildren.push(createElement('button', {
        type: 'button',
        key: 'btn-upgrade',
        className: 'btn sm',
        disabled: view.busy,
        title: '升级到 v' + updateInfo.latest + '（npm install ' + plugin.name + '@' + updateInfo.latest + '）',
        onClick: function () { upgrade(plugin.name) },
      }, '⬆ 更新'))
    }
    actionChildren.push(createElement('button', {
      type: 'button',
      key: 'btn-remove',
      className: 'btn danger sm',
      disabled: view.busy,
      onClick: function () { patch({ confirming: plugin.name }) },
    }, '卸载'))
    headerChildren.push(createElement('div', { className: 'card-actions', key: 'actions' }, actionChildren))
  }

  var header = createElement('div', { className: 'card-header', key: 'header' }, headerChildren)
  var cardChildren = [header]

  if (plugin.localPath) {
    cardChildren.push(createElement('div', { className: 'plugin-path', key: 'path', title: plugin.localPath },
      '📂 ' + plugin.localPath
    ))
  }

  if (isConfirming) {
    cardChildren.push(createElement('div', { className: 'confirm-bar', key: 'confirm' },
      createElement('span', { className: 'confirm-text', key: 'text' }, '⚠️ 确定要卸载该插件吗？'),
      createElement('div', { className: 'confirm-actions', key: 'actions' },
        createElement('button', {
          type: 'button',
          key: 'btn-confirm',
          className: 'btn danger-solid sm',
          disabled: view.busy,
          onClick: function () { remove(plugin.name) },
        }, '确认卸载'),
        createElement('button', {
          type: 'button',
          key: 'btn-cancel',
          className: 'btn sm',
          disabled: view.busy,
          onClick: function () { patch({ confirming: null }) },
        }, '取消')
      )
    ))
  }

  return createElement('div', { key: plugin.name, className: 'card' }, cardChildren)
}

/* ========================================================================== */
/*                           Render Sessions View                             */
/* ========================================================================== */

/**
 * Live-session display hint. "Online" means the session is still mounted in
 * the dsh host's in-memory SessionStore (created or opened at least once in
 * this process) — NOT that a turn is running. Online sessions can now be
 * closed directly: the admin panel's "关停并删除" disposes the captured agent
 * handle (stopping any running turn), removes the session from the store,
 * and then deletes the log — no restart needed.
 */
var LIVE_HINT = '会话在线：仍挂载于 dsh host 内存（本进程内创建或打开过的会话保持在线，不代表正在运行）；可直接"关停并删除"（会中断该会话正在进行的对话）'

/**
 * Canonical session status. Live takes precedence over archived (a session
 * that is both live and in the archived set is shown as 会话在线); otherwise
 * archived wins over ended. Used by both the filter pills and the pill
 * counts so they can never disagree about membership.
 */
function sessionStatus(s) {
  if (s.live) return 'live'
  if (s.archived) return 'archived'
  return 'ended'
}

function filterSessions(sessions, filter, needle) {
  var result = []
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i]
    if (filter !== 'all' && sessionStatus(s) !== filter) continue
    if (needle !== '') {
      var hay = ((s.title || '') + ' ' + (s.summary || '') + ' ' + (s.cwd || '') + ' '
        + (s.workspaceTitle || '') + ' ' + s.id).toLowerCase()
      if (hay.indexOf(needle) === -1) continue
    }
    result.push(s)
  }
  return result
}

/**
 * Display rank for the plugin list: 内置 first, then 包安装 (registry
 * install), then 本地安装 (local path). Host order is kept within a rank.
 */
function pluginSortRank(plugin) {
  if (!plugin.removable) return 0
  return plugin.localPath ? 2 : 1
}

/**
 * Filter plugin layers by the type pill and a fuzzy name/version/path query,
 * then sort 内置 → 包安装 → 本地安装 (stable: equal ranks keep host order).
 * The needle matches case-insensitively against the package name, the
 * installed version, and the local source path, so "tool" finds
 * dsh-custom-tool and "0.2" finds version rows.
 */
function filterPlugins(plugins, filter, needle) {
  var result = []
  for (var i = 0; i < plugins.length; i++) {
    var p = plugins[i]
    if (filter === 'plugin' && !p.removable) continue
    if (filter === 'builtin' && p.removable) continue
    if (needle !== '') {
      var hay = ((p.name || '') + ' ' + (p.version || '') + ' ' + (p.localPath || '')).toLowerCase()
      if (hay.indexOf(needle) === -1) continue
    }
    result.push(p)
  }
  return result.sort(function (a, b) { return pluginSortRank(a) - pluginSortRank(b) })
}/**
 * Group sessions by their accounting workspace in registry order; sessions
 * without a workspace trail under an "未分组" bucket. Empty workspaces are
 * omitted so the user only sees groups that currently hold a session.
 */
function buildSessionGroups(filtered, workspaceOrder) {
  var byWs = new Map()
  for (var i = 0; i < workspaceOrder.length; i++) {
    var ws = workspaceOrder[i]
    byWs.set(ws.workspaceId, {
      workspaceId: ws.workspaceId, title: ws.title, path: ws.path, sessions: [],
    })
  }
  var ungrouped = []
  for (var j = 0; j < filtered.length; j++) {
    var s = filtered[j]
    var g = s.workspaceId ? byWs.get(s.workspaceId) : undefined
    if (g !== undefined) g.sessions.push(s)
    else ungrouped.push(s)
  }
  var groups = []
  for (var k = 0; k < workspaceOrder.length; k++) {
    var bucket = byWs.get(workspaceOrder[k].workspaceId)
    if (bucket !== undefined && bucket.sessions.length > 0) groups.push(bucket)
  }
  if (ungrouped.length > 0) {
    groups.push({ workspaceId: null, title: '未分组', path: null, sessions: ungrouped })
  }
  return groups
}

function renderSessionsView(view, patch, reload, act) {
  var elements = []

  // Toolbar: full-width search with inline icon; the refresh action sits at
  // the row's end so the search field gets the whole width.
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar' },
    createElement('div', { className: 'search-wrap session-search', key: 'wrap' },
      createElement('span', { className: 'search-icon', key: 'icon' }, '🔍'),
      createElement('input', {
        className: 'input',
        placeholder: '搜索标题、内容摘要、目录或 Session ID...',
        value: view.needle,
        onChange: function (e) { patch({ needle: e.target.value }) },
      }),
      view.needle !== '' ? createElement('button', {
        type: 'button',
        key: 'btn-clear-search',
        className: 'btn sm',
        title: '清空搜索',
        onClick: function () { patch({ needle: '' }) },
      }, '✕') : null
    ),
    createElement('button', {
      type: 'button',
      key: 'btn-refresh',
      className: 'btn',
      disabled: view.busy,
      onClick: reload,
    },
      view.busy ? createElement('span', { className: 'spinner', key: 'spin' }) : null,
      '🔄 刷新'
    )
  ))

  // Filter Pills
  var totalSessions = view.sessions.length
  var liveCount = 0
  var archivedCount = 0
  var endedCount = 0
  for (var i = 0; i < view.sessions.length; i++) {
    var s = view.sessions[i]
    var st = sessionStatus(s)
    if (st === 'live') liveCount++
    else if (st === 'archived') archivedCount++
    else endedCount++
  }

  elements.push(createElement('div', { className: 'filter-bar', key: 'filters' },
    createElement('button', {
      type: 'button',
      key: 'filter-all',
      className: 'pill' + (view.filter === 'all' ? ' active' : ''),
      onClick: function () { patch({ filter: 'all' }) },
    }, '全部 (' + String(totalSessions) + ')'),
    createElement('button', {
      type: 'button',
      key: 'filter-live',
      className: 'pill' + (view.filter === 'live' ? ' active' : ''),
      title: LIVE_HINT,
      onClick: function () { patch({ filter: 'live' }) },
    }, '在线 (' + String(liveCount) + ')'),
    createElement('button', {
      type: 'button',
      key: 'filter-archived',
      className: 'pill' + (view.filter === 'archived' ? ' active' : ''),
      onClick: function () { patch({ filter: 'archived' }) },
    }, '已归档 (' + String(archivedCount) + ')'),
    createElement('button', {
      type: 'button',
      key: 'filter-ended',
      className: 'pill' + (view.filter === 'ended' ? ' active' : ''),
      onClick: function () { patch({ filter: 'ended' }) },
    }, '已结束 (' + String(endedCount) + ')')
  ))

  if (view.error !== '') {
    elements.push(createElement('div', { className: 'error', key: 'error' }, view.error))
  }

  // Filter then group by workspace (registry order); sessions without an
  // accounting workspace trail under "未分组", matching the sidebar model.
  var needle = view.needle.trim().toLowerCase()
  var filtered = filterSessions(view.sessions, view.filter, needle)
  var groups = buildSessionGroups(filtered, view.workspaces || [])
  var rows = []
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi]
    var groupKey = g.workspaceId === null ? 'ungrouped' : 'ws-' + g.workspaceId
    rows.push(createElement('div', { className: 'group-header', key: 'header-' + groupKey },
      createElement('span', { className: 'group-title', key: 'title' },
        (g.workspaceId === null ? '📂 ' : '📁 ') + (g.title || '未命名')
      ),
      createElement('span', { className: 'group-count', key: 'count' }, String(g.sessions.length) + ' 个'),
      g.path !== null
        ? createElement('span', { className: 'group-path', key: 'path', title: g.path }, g.path)
        : null
    ))
    for (var si = 0; si < g.sessions.length; si++) {
      rows.push(renderSessionCard(g.sessions[si], view, act, patch))
    }
  }

  if (rows.length === 0) {
    rows.push(createElement('div', { className: 'empty', key: 'empty' },
      createElement('div', null, needle !== '' ? '🔍 无匹配的会话内容' : '💬 没有已持久化的会话')
    ))
  }

  elements.push(createElement('div', { className: 'list', key: 'list' }, rows))

  // Footer
  var summaryText = view.busy ? '加载中...'
    : '共 ' + String(totalSessions) + ' 个会话，当前展示 ' + String(filtered.length) + ' 个'

  elements.push(createElement('div', { className: 'footer', key: 'footer' },
    createElement('span', { key: 'summary' }, summaryText),
    createElement('span', { className: 'hint', key: 'hint' }, '会话修改即时同步到侧边栏')
  ))

  return createElement('div', { key: 'sessions-panel', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, elements)
}

function renderSessionCard(session, view, act, patch) {
  var isConfirming = view.confirming === session.id
  var dotClass = 'dot' + (session.live ? ' live' : session.archived ? ' archived' : '')
  var dotTitle = session.live ? LIVE_HINT : session.archived ? '已归档' : '已结束'

  var actions = []
  if (!isConfirming) {
    if (!session.archived && !session.live) {
      actions.push(createElement('button', {
        type: 'button',
        className: 'btn sm',
        key: 'btn-archive',
        disabled: view.busy,
        onClick: function () { act('archive', session.id) },
      }, '归档'))
    }
    if (session.archived) {
      actions.push(createElement('button', {
        type: 'button',
        className: 'btn sm',
        key: 'btn-unarchive',
        disabled: view.busy,
        onClick: function () { act('unarchive', session.id) },
      }, '取消归档'))
    }
    if (!session.live) {
      actions.push(createElement('button', {
        type: 'button',
        className: 'btn danger sm',
        key: 'btn-delete',
        disabled: view.busy,
        onClick: function () { patch({ confirming: session.id }) },
      }, '删除'))
    } else {
      // Online sessions can now be closed through the captured AgentHandle
      // (closeSession disposes the live agent/session first, so the log can
      // be removed without resurrection). This stops a running conversation,
      // so it is a destructive action with its own confirm flow.
      actions.push(createElement('button', {
        type: 'button',
        className: 'btn danger sm',
        key: 'btn-close',
        disabled: view.busy,
        title: '关停该在线会话（停止其 agent 运行）并永久删除日志记录',
        onClick: function () { patch({ confirming: session.id }) },
      }, '关停并删除'))
    }
  }

  var titleChildren = [
    createElement('span', { className: dotClass, title: dotTitle, key: 'dot' }),
    createElement('div', { className: 'card-title', key: 'title' },
      createElement('span', { className: 'card-title-text', key: 'name', title: session.title || session.cwd },
        session.title || (session.cwd ? baseName(session.cwd) : '未命名会话')
      ),
      session.live ? createElement('span', { className: 'tag live', key: 'tag-live', title: LIVE_HINT }, '会话在线')
        : session.archived ? createElement('span', { className: 'tag archived', key: 'tag-archived' }, '已归档')
        : null,
      session.messageCount > 0 ? createElement('span', { className: 'tag turns', key: 'tag-turns' }, String(session.messageCount) + ' 条消息') : null
    ),
  ]
  var headerChildren
  if (actions.length > 0) {
    headerChildren = titleChildren.concat([createElement('div', { className: 'card-actions', key: 'actions' }, actions)])
  } else {
    headerChildren = titleChildren
  }

  var header = createElement('div', { className: 'card-header', key: 'header' }, headerChildren)
  var cardChildren = [header]

  // Content summary block
  if (session.summary) {
    cardChildren.push(createElement('div', { className: 'card-summary', key: 'summary', title: session.summary },
      createElement('span', { className: 'summary-icon', key: 'icon' }, '💬'),
      createElement('span', { className: 'summary-text', key: 'text' }, session.summary)
    ))
  } else if (session.summaryError) {
    cardChildren.push(createElement('div', { className: 'error', key: 'summary-error' },
      '摘要读取失败：' + session.summaryError
    ))
  }

  // Sub metadata line
  var subChildren = [
    createElement('span', { className: 'card-sub-item', title: session.cwd || '无工作目录', key: 'path' },
      '📁 ' + (session.cwd ? baseName(session.cwd) + ' (' + session.cwd + ')' : '（无工作目录）')
    ),
    createElement('span', { key: 'sep1' }, '·'),
    createElement('span', { className: 'card-sub-item', key: 'time' }, '🕒 ' + formatDate(session.createdAt)),
  ]
  if (session.id) {
    subChildren.push(createElement('span', { key: 'sep2' }, '·'))
    subChildren.push(createElement('span', { className: 'card-sub-item session-id-badge', key: 'id', title: '会话 ID: ' + session.id },
      '🆔 ' + session.id.slice(0, 8)
    ))
  }

  var sub = createElement('div', { className: 'card-sub', key: 'sub' }, subChildren)
  cardChildren.push(sub)

  if (isConfirming) {
    cardChildren.push(createElement('div', { className: 'confirm-bar', key: 'confirm' },
      createElement('span', { className: 'confirm-text', key: 'text' },
        session.live
          ? '⚠️ 将关停该在线会话（正在运行则会中断）并永久删除记录与日志，确定？'
          : '⚠️ 确定永久删除该会话记录及日志文件？'),
      createElement('div', { className: 'confirm-actions', key: 'actions' },
        createElement('button', {
          type: 'button',
          key: 'btn-confirm',
          className: 'btn danger-solid sm',
          disabled: view.busy,
          onClick: function () { act(session.live ? 'closeSession' : 'deleteSession', session.id) },
        }, '确认删除'),
        createElement('button', {
          type: 'button',
          key: 'btn-cancel',
          className: 'btn sm',
          disabled: view.busy,
          onClick: function () { patch({ confirming: null }) },
        }, '取消')
      )
    ))
  }

  return createElement('div', { key: session.id, className: 'card' }, cardChildren)
}

/* ========================================================================== */
/*            Subagent Administration (merged from dsh-plugin-subagents)     */
/* ========================================================================== */

/**
 * dsh-plugin-subagents browser half: the 子智能体管理 settings section.
 *
 * Renders a management panel over the shell's `settings.section` slot (same
 * platform-shared React and --dsw-* design tokens as the admin plugin) and
 * drives the host's `subagentAdmin` remote over the /api RPC gateway. One
 * managed row in the profile cordis.patch.yml equals one named subagent: a
 * `@deepseek-ai/dsh-tool-subagent` instance whose config carries the agent
 * name (toolName), the persona prompt, the tool constraint lists, and the
 * model specification (agentOptions).
 */

var TOOLNAME_RE = /^[a-z][a-z0-9_]{1,48}$/
var TOOL_REF_RE = /^[a-z][a-z0-9_]*$/
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
var RESERVED_TOOL_NAMES = ['subagent', 'subagent_fork', 'run_code']

var SA_CSS_TEXT = [
  '@keyframes dsh-sa-spin { to { transform: rotate(360deg); } }',
  '[data-dsh-sa-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); overflow: visible; }',
  '[data-dsh-sa-section] * { box-sizing: border-box; }',
  '[data-dsh-sa-section] .tabs { display: flex; padding: 3px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.2)); border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.3)); gap: 3px; }',
  '[data-dsh-sa-section] .tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 7px 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, #666); transition: all 0.15s ease; font-family: inherit; }',
  '[data-dsh-sa-section] .tab:hover:not(.active) { color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); }',
  '[data-dsh-sa-section] .tab.active { background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); color: var(--dsw-alias-label-primary, #333); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04); }',
  '[data-dsh-sa-section] .tab-count { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.4)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-sa-section] .tab.active .tab-count { background: var(--dsw-static-blue-500, #3b82f6); color: #fff; }',
  '[data-dsh-sa-section] .toolbar { display: flex; gap: 8px; align-items: center; padding: 10px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); flex-wrap: wrap; }',
  '[data-dsh-sa-section] .filterbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); }',
  '[data-dsh-sa-section] .filter-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); flex: none; margin-right: 2px; }',
  '[data-dsh-sa-section] .search-wrap { flex: 1; min-width: 150px; position: relative; display: flex; align-items: center; height: 32px; }',
  '[data-dsh-sa-section] .search-wrap .input { flex: 1; min-width: 0; padding-left: 30px; font-size: 13px; height: 32px; }',
  '[data-dsh-sa-section] .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; opacity: 0.7; pointer-events: none; z-index: 1; }',
  '[data-dsh-sa-section] .input { width: 100%; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); background: var(--dsw-alias-bg-base, transparent); color: inherit; font: inherit; outline: none; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; }',
  '[data-dsh-sa-section] .input:hover { border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); }',
  '[data-dsh-sa-section] .input:focus { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }',
  '[data-dsh-sa-section] textarea.input { resize: vertical; min-height: 80px; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.55; }',
  '[data-dsh-sa-section] select.input { height: 32px; padding: 0 8px; cursor: pointer; }',
  '[data-dsh-sa-section] .btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 32px; padding: 0 14px; border-radius: 9px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; transition: all 0.15s ease; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); background: var(--dsw-alias-interactive-bg-hover, rgba(240,240,245,0.6)); color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; flex: none; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }',
  '[data-dsh-sa-section] .btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(220,220,230,0.7)); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.65)); color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-sa-section] .btn:active:not(:disabled) { transform: translateY(1px); }',
  '[data-dsh-sa-section] .btn:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }',
  '[data-dsh-sa-section] .btn:disabled { opacity: 0.45; cursor: not-allowed; }',
  '[data-dsh-sa-section] .btn.primary { background: var(--dsw-static-blue-500, #3b82f6); color: #fff; border-color: transparent; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }',
  '[data-dsh-sa-section] .btn.primary:hover:not(:disabled) { background: var(--dsw-static-blue-400, #60a5fa); color: #fff; }',
  '[data-dsh-sa-section] .btn.danger { color: var(--dsw-alias-state-error-primary, #dc2626); border-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); }',
  '[data-dsh-sa-section] .btn.danger:hover:not(:disabled) { background: rgba(239,68,68,0.1); border-color: rgba(220,38,38,0.35); color: #b91c1c; }',
  '[data-dsh-sa-section] .btn.danger-solid { background: var(--dsw-alias-state-error-primary, #dc2626); color: #fff; border-color: transparent; }',
  '[data-dsh-sa-section] .btn.sm { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 6px; }',
  '[data-dsh-sa-section] .btn.sm.active { background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.4)); color: var(--dsw-static-blue-500, #3b82f6); font-weight: 600; border-color: currentColor; }',
  '[data-dsh-sa-section] .spinner { width: 12px; height: 12px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: dsh-sa-spin 0.7s linear infinite; display: inline-block; flex: none; }',
  '[data-dsh-sa-section] .list { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; max-height: 560px; overflow-y: auto; padding: 2px 4px 2px 2px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)) transparent; }',
  '[data-dsh-sa-section] .card { display: flex; flex-direction: column; gap: 7px; padding: 12px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: all 0.15s ease; }',
  '[data-dsh-sa-section] .card:hover { transform: translateY(-1px); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }',
  '[data-dsh-sa-section] .card-header { display: flex; align-items: center; gap: 8px; min-width: 0; }',
  '[data-dsh-sa-section] .card-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; font-family: var(--dsw-font-mono, ui-monospace, monospace); }',
  '[data-dsh-sa-section] .card-actions { display: flex; gap: 5px; align-items: center; flex: none; }',
  '[data-dsh-sa-section] .persona-box { display: flex; align-items: flex-start; gap: 6px; padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); border-left: 2px solid var(--dsw-static-blue-500, #3b82f6); font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-sa-section] .persona-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; white-space: pre-wrap; }',
  '[data-dsh-sa-section] .card-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
  '[data-dsh-sa-section] .tag { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; flex: none; display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-sa-section] .tag.provider { background: rgba(139, 92, 246, 0.12); color: #7c3aed; }',
  '[data-dsh-sa-section] .tag.model { background: rgba(59, 130, 246, 0.12); color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-sa-section] .tag.live { background: rgba(16, 185, 129, 0.12); color: var(--dsw-alias-state-success-primary, #10b981); }',
  '[data-dsh-sa-section] .tag.warn { background: rgba(245, 158, 11, 0.14); color: #d97706; font-weight: 600; }',
  '[data-dsh-sa-section] .tag.dead { background: rgba(239, 68, 68, 0.12); color: var(--dsw-alias-state-error-primary, #dc2626); }',
  '[data-dsh-sa-section] .chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }',
  '[data-dsh-sa-section] .chip { font-size: 10px; font-family: var(--dsw-font-mono, ui-monospace, monospace); padding: 1px 6px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-sa-section] .chip.deny { background: rgba(239, 68, 68, 0.08); border-color: rgba(220,38,38,0.25); color: #b91c1c; }',
  '[data-dsh-sa-section] .chip.allow { background: rgba(16, 185, 129, 0.08); border-color: rgba(16,185,129,0.3); color: #047857; }',
  '[data-dsh-sa-section] .form { flex: 1 1 auto; min-height: 0; max-height: calc(100vh - 220px); overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--dsw-static-blue-500, #3b82f6); background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 4px 14px rgba(59,130,246,0.08); }',
  '[data-dsh-sa-section] .form-actions { position: sticky; bottom: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 6px; padding-top: 10px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); border-top: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); }',
  '[data-dsh-sa-section] .form-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 6px; }',
  '[data-dsh-sa-section] .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
  '[data-dsh-sa-section] .form-grid .full { grid-column: 1 / -1; }',
  '[data-dsh-sa-section] .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
  '[data-dsh-sa-section] .field-label { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 5px; }',
  '[data-dsh-sa-section] .field-hint { font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); line-height: 1.4; }',
  '[data-dsh-sa-section] .fieldset { border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }',
  '[data-dsh-sa-section] .fieldset-legend { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); padding: 0 4px; }',
  '[data-dsh-sa-section] .tag-input { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); background: var(--dsw-alias-bg-base, transparent); min-height: 34px; align-items: center; cursor: text; }',
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
  '[data-dsh-sa-section] .cli-scan-card { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.12)); }',
  '[data-dsh-sa-section] .cli-scan-card .btn { margin-left: auto; flex: none; }',
  '[data-dsh-sa-section] .error-strip { display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border-radius: 9px; border: 1px solid rgba(220,38,38,0.35); background: rgba(239,68,68,0.08); color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; line-height: 1.45; word-break: break-word; }',
  '[data-dsh-sa-section] .warn-strip { display: flex; flex-direction: column; gap: 4px; padding: 9px 12px; border-radius: 9px; border: 1px solid rgba(217,119,6,0.35); background: rgba(245,158,11,0.08); color: #b45309; font-size: 12px; line-height: 1.5; word-break: break-word; }',
  '[data-dsh-sa-section] .warn-strip div { display: flex; gap: 6px; align-items: flex-start; }',
  '[data-dsh-sa-section] .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 34px 12px; border: 1px dashed var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); border-radius: 12px; color: var(--dsw-alias-label-tertiary, #999); font-size: 12px; text-align: center; }',
  '[data-dsh-sa-section] .empty .big { font-size: 26px; }',
  '[data-dsh-sa-section] .toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10000; max-width: 520px; padding: 10px 16px; border-radius: 10px; font-size: 12px; line-height: 1.5; box-shadow: 0 8px 24px rgba(0,0,0,0.18); background: rgba(239,68,68,0.96); color: #fff; word-break: break-word; white-space: pre-line; }',
  '[data-dsh-sa-section] .history-row { display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); }',
  '[data-dsh-sa-section] .history-head { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }',
  '[data-dsh-sa-section] .history-time { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); margin-left: auto; }',
  '[data-dsh-sa-section] .history-detail { font-size: 11px; color: var(--dsw-alias-label-tertiary, #888); font-family: var(--dsw-font-mono, ui-monospace, monospace); word-break: break-all; max-height: 60px; overflow: hidden; }',
  '[data-dsh-sa-section] .footer-note { font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); line-height: 1.5; padding: 0 2px; }',
  '[data-dsh-sa-section] .sa-picker { position: relative; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }',
  '[data-dsh-sa-section] .sa-picker-input { border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 12px; flex: 1; min-width: 120px; padding: 2px 4px; }',
  '[data-dsh-sa-section] .sa-picker-list { width: 100%; margin-top: 4px; max-height: 220px; overflow-y: auto; background: var(--dsh-alias-bg-elevated, #fff); border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); padding: 3px; scrollbar-width: thin; }',
  '[data-dsh-sa-section] .sa-picker-opt { padding: 6px 9px; font-size: 12px; cursor: pointer; border-radius: 5px; color: var(--dsw-alias-label-primary, #222); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-dsh-sa-section] .sa-picker-opt.active, [data-dsh-sa-section] .sa-picker-opt:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(59,130,246,0.14)); color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-sa-section] .sa-picker-empty { padding: 6px 9px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #999); }',
]

var SA_STYLE_SEEN = false
function injectSaStyles() {
  if (SA_STYLE_SEEN) return
  var style = document.createElement('style')
  style.setAttribute('data-dsh-sa-styles', '')
  style.textContent = SA_CSS_TEXT.join('\n')
  document.head.appendChild(style)
  SA_STYLE_SEEN = true
}

/** The gateway wraps every remote result in an { ok, value | error } envelope. */
function unwrap(result) {
  if (result && typeof result === 'object' && 'ok' in result) {
    if (result.ok) return result.value
    var detail = result.error && result.error.message ? result.error.message : String(result.error)
    throw new Error(detail)
  }
  return result
}

/* ========================================================================== */
/*                              Small components                              */
/* ========================================================================== */

function Spinner() {
  return createElement('span', { className: 'spinner' })
}

/** Two-click inline confirm; disarms after 3.2s. */
function ConfirmButton(props) {
  var armed = useState(false)
  var isArmed = armed[0]
  var setArmed = armed[1]
  var timer = useRef(null)
  useEffect(function () {
    return function () { if (timer.current) clearTimeout(timer.current) }
  }, [])
  var label = isArmed ? (props.confirmLabel || '确认？') : props.label
  return createElement('button', {
    type: 'button',
    className: 'btn sm ' + (isArmed ? 'danger-solid' : 'danger'),
    disabled: props.disabled === true,
    onClick: function () {
      if (!isArmed) {
        setArmed(true)
        timer.current = setTimeout(function () { setArmed(false) }, 3200)
        return
      }
      if (timer.current) clearTimeout(timer.current)
      setArmed(false)
      props.onConfirm()
    },
  }, label)
}

/* ========================================================================== */
/*                            Form draft handling                             */
/* ========================================================================== */

function emptyDraft() {
  return {
    id: '',
    toolName: '',
    provider: 'spawn',
    persona: '',
    allow: [],
    deny: [],
    agentProvider: '',
    agentModel: '',
    maxTokens: '',
    maxDepthManaged: false,
    maxDepth: '3',
    backgroundMode: 'one-shot',
    enableRunInBackground: true,
  }
}

function draftFromEntry(entry) {
  var config = entry.config || {}
  return {
    id: entry.id,
    toolName: config.toolName || '',
    provider: config.provider || 'spawn',
    persona: config.persona || '',
    allow: (config.toolFilter && config.toolFilter.allow) || [],
    deny: (config.toolFilter && config.toolFilter.deny) || [],
    agentProvider: (config.agentOptions && config.agentOptions.provider) || '',
    agentModel: (config.agentOptions && config.agentOptions.model) || '',
    maxTokens: config.agentOptions && config.agentOptions.maxTokens !== undefined ? String(config.agentOptions.maxTokens) : '',
    maxDepthManaged: config.maxDepth === 'provider-managed',
    maxDepth: typeof config.maxDepth === 'number' ? String(config.maxDepth) : '3',
    backgroundMode: config.backgroundMode || 'one-shot',
    enableRunInBackground: config.enableRunInBackground !== false,
  }
}

/** Remove options the newly selected provider cannot execute. */
function adjustDraftForProvider(draft, provider) {
  var patch = {}
  var adjusted = []
  if (!provider) return { patch: patch, adjusted: adjusted }
  if (provider.capabilities.persona === false && draft.persona !== '') {
    patch.persona = ''
    adjusted.push('提示词')
  }
  if (provider.capabilities.toolFilter === false && (draft.allow.length > 0 || draft.deny.length > 0)) {
    patch.allow = []
    patch.deny = []
    adjusted.push('工具约束')
  }
  if (provider.capabilities.depthLimit === false && !draft.maxDepthManaged && draft.maxDepth !== '') {
    patch.maxDepthManaged = true
    adjusted.push('数值最大委托深度')
  }
  if (provider.continuable !== true && draft.backgroundMode === 'continuable') {
    patch.backgroundMode = 'one-shot'
    adjusted.push('后台模式')
  }
  return { patch: patch, adjusted: adjusted }
}

/** Client-side validation mirroring the host rules; returns an error string or null. */
function validateDraft(draft, isCreate, otherToolNames, providerMeta, candidateNames) {
  if (isCreate && !ID_RE.test(draft.id)) return '实例 ID 只能包含字母、数字、下划线和中划线（字母或数字开头，最长 64 位）'
  if (!TOOLNAME_RE.test(draft.toolName)) return '子智能体名称必须是 2-48 位小写字母/数字/下划线且字母开头'
  if (RESERVED_TOOL_NAMES.indexOf(draft.toolName) !== -1) return '子智能体名称 "' + draft.toolName + '" 是保留名（内置预设已占用）'
  if (otherToolNames.indexOf(draft.toolName) !== -1) return '子智能体名称 "' + draft.toolName + '" 已被其他实例使用'
  var meta = providerMeta[draft.provider]
  if (!meta) return '未知的执行后端 "' + draft.provider + '"'
  if (draft.persona !== '' && meta.capabilities.persona === false) return '后端 "' + draft.provider + '" 不支持 persona（提示词）'
  if ((draft.allow.length > 0 || draft.deny.length > 0) && meta.capabilities.toolFilter === false) return '后端 "' + draft.provider + '" 不支持 toolFilter（工具约束）'
  if (!draft.maxDepthManaged) {
    if (draft.maxDepth !== '' && !/^\d+$/.test(draft.maxDepth)) return '最大委托深度必须是非负整数'
    if (draft.maxDepth !== '' && meta.capabilities.depthLimit === false) {
      return '后端 "' + draft.provider + '" 无法执行数值 maxDepth；请勾选「交由后端管理」或换后端'
    }
  }
  if (draft.maxTokens !== '' && !/^\d+$/.test(draft.maxTokens)) return 'maxTokens 必须是正整数'
  var filterNames = (draft.allow || []).concat(draft.deny || [])
  for (var fi = 0; fi < filterNames.length; fi++) {
    var tname = filterNames[fi]
    if (RESERVED_TOOL_NAMES.indexOf(tname) !== -1) return '工具 "' + tname + '" 是保留名（' + RESERVED_TOOL_NAMES.join('/') + '），不能用于工具约束'
    if (candidateNames && candidateNames.length > 0 && candidateNames.indexOf(tname) === -1) return '工具 "' + tname + '" 不在可选清单中（来自运行中工具或内置名录），保存会被拒绝'
  }
  return null
}

function draftToPayload(draft) {
  var config = { provider: draft.provider, toolName: draft.toolName }
  if (draft.persona.trim() !== '') config.persona = draft.persona
  if (draft.allow.length > 0 || draft.deny.length > 0) {
    config.toolFilter = {}
    if (draft.allow.length > 0) config.toolFilter.allow = draft.allow.slice()
    if (draft.deny.length > 0) config.toolFilter.deny = draft.deny.slice()
  }
  var agentOptions = {}
  if (draft.agentProvider.trim() !== '') agentOptions.provider = draft.agentProvider.trim()
  if (draft.agentModel.trim() !== '') agentOptions.model = draft.agentModel.trim()
  if (draft.maxTokens.trim() !== '') agentOptions.maxTokens = Number(draft.maxTokens)
  if (Object.keys(agentOptions).length > 0) config.agentOptions = agentOptions
  if (draft.maxDepthManaged) config.maxDepth = 'provider-managed'
  else if (draft.maxDepth !== '') config.maxDepth = Number(draft.maxDepth)
  config.backgroundMode = draft.backgroundMode
  config.enableRunInBackground = draft.enableRunInBackground === true
  return { id: draft.id.trim(), config: config }
}

/* ========================================================================== */
/*                         Searchable picker (single/multi)                    */
/* ========================================================================== */

/**
 * Filterable picker used for the model/provider selects (single) and the
 * tool-constraint chips (multi). Renders a text input plus a scrollable,
 * filtered dropdown; click or Enter selects. Single mode also commits the
 * typed text (so arbitrary values still work); multi mode appends chips and
 * hides already-picked options from the list.
 */
function Picker(props) {
  var multi = props.multi === true
  var disabled = props.disabled === true
  var values = props.values || []
  var options = props.options || []
  var allowCustom = props.allowCustom !== false
  var inputRef = useRef(null)
  var textState = useState('')
  var text = textState[0]
  var setText = textState[1]
  var openState = useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var highlightState = useState(0)
  var highlight = highlightState[0]
  var setHighlight = highlightState[1]

  var selected = {}
  for (var si = 0; si < values.length; si++) selected[values[si]] = true

  var filtered = options.filter(function (o) {
    if (multi && selected[o.value]) return false
    var q = text.trim().toLowerCase()
    if (q === '') return true
    var label = (o.label || o.value).toLowerCase()
    return label.indexOf(q) !== -1 || o.value.toLowerCase().indexOf(q) !== -1
  })

  function emit(next) { if (!disabled) props.onChange(next) }

  function pick(opt) {
    if (multi) {
      if (selected[opt.value] || !TOOL_REF_RE.test(opt.value)) return
      emit(values.concat([opt.value]))
      setText(''); setHighlight(0); setOpen(true)
    } else {
      emit([opt.value]); setText(''); setOpen(false)
    }
  }
  function addTyped(v) {
    var val = (v || '').trim()
    if (val === '') return
    if (multi && (selected[val] || !TOOL_REF_RE.test(val))) return
    emit(multi ? values.concat([val]) : [val])
    setText(''); setHighlight(0)
  }
  function onInputChange(e) {
    if (disabled) return
    var v = e.target.value
    setText(v); setOpen(true); setHighlight(0)
    if (!multi) emit([v])
  }
  function onKeyDown(e) {
    if (disabled) return
    var live = (inputRef.current ? inputRef.current.value : text).trim()
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(function (h) { return Math.min(h + 1, filtered.length - 1) }); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(function (h) { return Math.max(h - 1, 0) }); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length > 0 && highlight >= 0 && highlight < filtered.length) {
        var hl = filtered[highlight]
        if (live === '' || live === hl.value || live === (hl.label || hl.value)) { pick(hl); return }
      }
      if (allowCustom && live !== '') addTyped(live)
      return
    }
    if (e.key === 'Escape') setOpen(false)
  }

  var tokens = multi ? values.map(function (v) {
    return createElement('span', { className: 'tag-chip ' + (props.kind || 'allow'), key: 'tok-' + v },
      v,
      createElement('button', {
        type: 'button', 'aria-label': '移除 ' + v,
        disabled: disabled,
        onClick: function (ev) { ev.stopPropagation(); emit(values.filter(function (x) { return x !== v })) },
      }, '✕'))
  }) : null

  var list = open && !disabled
    ? createElement('div', { className: 'sa-picker-list' },
        filtered.length === 0
          ? createElement('div', { className: 'sa-picker-empty' }, allowCustom && text.trim() !== '' ? '回车添加：' + text.trim() : '无匹配')
          : filtered.map(function (o, idx) {
              return createElement('div', {
                key: o.value,
                className: 'sa-picker-opt' + (idx === highlight ? ' active' : ''),
                onMouseDown: function (ev) { if (!disabled) { ev.preventDefault(); pick(o) } },
                onMouseEnter: function () { setHighlight(idx) },
              }, o.label || o.value)
            }))
    : null

  return createElement('div', { className: 'sa-picker' + (multi ? ' tag-input' : '') },
    tokens,
    createElement('input', {
      ref: inputRef,
      className: 'sa-picker-input',
      value: multi ? text : (values[0] || ''),
      placeholder: props.placeholder || '',
      'aria-label': props.ariaLabel || props.placeholder || '',
      disabled: disabled,
      onChange: onInputChange,
      onKeyDown: onKeyDown,
      onFocus: function () { if (!disabled) setOpen(true) },
      onBlur: function () { setOpen(false) },
    }),
    list,
  )
}

/* ========================================================================== */
/*                              Subagents panel                               */
/* ========================================================================== */

function RuntimeSubagentsPanel(props) {
  var call = props.call
  var viewState = useState({ loading: true, error: null, agents: [] })
  var view = viewState[0]
  var setView = viewState[1]
  var busyState = useState(null)
  var busyId = busyState[0]
  var setBusyId = busyState[1]
  var toastState = useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]

  var reload = function () {
    setView(function (prev) { return Object.assign({}, prev, { loading: true, error: null }) })
    call('subagentAdmin/runtimeList', {}).then(function (raw) {
      var result = unwrap(raw)
      setView({ loading: false, error: null, agents: (result && result.agents) || [] })
    }).catch(function (error) {
      setView({ loading: false, error: String((error && error.message) || error), agents: [] })
    })
  }
  useEffect(reload, [])

  useEffect(function () {
    if (!toast) return undefined
    var timer = setTimeout(function () { setToast(null) }, 4200)
    return function () { clearTimeout(timer) }
  }, [toast])

  var interrupt = function (agent) {
    if (busyId) return
    setBusyId(agent.id)
    call('subagentAdmin/runtimeInterrupt', { childId: agent.id, parentSessionId: agent.parentSessionId }).then(function () {
      setToast('已请求中断子智能体')
      reload()
    }).catch(function (error) {
      setToast('中断失败：' + String((error && error.message) || error))
    }).finally(function () { setBusyId(null) })
  }

  var children = [
    createElement('div', { className: 'toolbar', key: 'toolbar' },
      createElement('div', { className: 'cli-scan-hint', key: 'hint' }, '仅显示当前 dsh 进程中正在执行的子智能体。'),
      createElement('button', { type: 'button', className: 'btn sm', key: 'refresh', onClick: reload, disabled: view.loading },
        view.loading ? createElement(Spinner, { key: 'spin' }) : '↻', '刷新')),
  ]

  if (view.loading && view.agents.length === 0) {
    children.push(createElement('div', { className: 'empty', key: 'loading' }, createElement('span', { className: 'big' }, '⏳'), '正在读取运行中的子智能体…'))
  } else if (view.error) {
    children.push(createElement('div', { className: 'error-strip', key: 'error' }, '⚠️ 加载失败：', view.error))
  } else if (view.agents.length === 0) {
    children.push(createElement('div', { className: 'empty', key: 'empty' }, createElement('span', { className: 'big' }, '🤖'), '当前没有运行中的子智能体。'))
  } else {
    children.push(createElement('div', { className: 'list', key: 'cards' }, view.agents.map(function (agent) {
      var title = agent.label || agent.id
      return createElement('div', { className: 'card', key: agent.id },
        createElement('div', { className: 'card-header' },
          createElement('div', { className: 'card-title', title: agent.id }, title),
          createElement('div', { className: 'card-actions' },
            agent.mode === 'continuable'
              ? createElement(ConfirmButton, {
                label: '中断', confirmLabel: '确认中断？', disabled: busyId === agent.id,
                onConfirm: function () { interrupt(agent) },
              })
              : createElement('span', { className: 'tag warn' }, '不可中断'))
        ),
        createElement('div', { className: 'card-sub' },
          createElement('span', { className: 'tag live' }, '● 运行中'),
          agent.provider ? createElement('span', { className: 'tag provider' }, agent.provider) : null,
          agent.mode ? createElement('span', { className: 'tag model' }, agent.mode) : null,
          agent.depth !== null ? createElement('span', { className: 'tag' }, '深度 ' + agent.depth) : null
        ),
        createElement('div', { className: 'card-sub' },
          createElement('span', { className: 'card-sub-item', title: agent.id }, '子会话：' + agent.id),
          createElement('span', { className: 'card-sub-item', title: agent.parentSessionId }, '父会话：' + agent.parentSessionId)
        )
      )
    })))
  }

  return createElement('div', null,
    toast ? createElement('div', { className: 'toast' }, toast) : null,
    children
  )
}

function SubagentsPanel(props) {
  var call = props.call

  var viewState = useState({ loading: true, error: null, data: null })
  var view = viewState[0]
  var setView = viewState[1]

  var formState = useState(null)
  var form = formState[0]
  var setForm = formState[1]

  var needleState = useState('')
  var needle = needleState[0]
  var setNeedle = needleState[1]

  var providerFilterState = useState('全部')
  var providerFilter = providerFilterState[0]
  var setProviderFilter = providerFilterState[1]

  var noticeState = useState(null)
  var notice = noticeState[0]
  var setNotice = noticeState[1]

  var toastState = useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]

  var reload = function () {
    setView(function (prev) { return Object.assign({}, prev, { loading: true, error: null }) })
    call('subagentAdmin/list', {}).then(function (raw) {
      var result = unwrap(raw)
      setView({ loading: false, error: null, data: result })
    }).catch(function (error) {
      setView({ loading: false, error: String((error && error.message) || error), data: null })
    })
  }
  useEffect(reload, [])

  useEffect(function () {
    if (!toast) return undefined
    var timer = setTimeout(function () { setToast(null) }, 4200)
    return function () { clearTimeout(timer) }
  }, [toast])

  var data = view.data
  var entries = (data && data.entries) || []
  var meta = (data && data.meta) || { tools: [], providers: [], llmProviders: [], llmModels: {} }
  var candidateNames = meta.tools.map(function (tool) { return tool.name })
  var providerMeta = {}
  meta.providers.forEach(function (provider) { providerMeta[provider.name] = provider })
  var llmProviders = meta.llmProviders || []
  var llmModels = meta.llmModels || {}

  var filtered = entries.filter(function (entry) {
    var config = entry.config || {}
    if (providerFilter !== '全部' && config.provider !== providerFilter) return false
    if (needle === '') return true
    var haystack = [entry.id, config.toolName, config.provider, config.persona, config.agentOptions && config.agentOptions.model]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.indexOf(needle.toLowerCase()) !== -1
  })

  var openCreate = function () {
    setNotice(null)
    setForm({ draft: emptyDraft(), editing: false, saving: false, error: null, capabilityNotice: null, advanced: false })
  }
  var openEdit = function (entry) {
    setNotice(null)
    setForm({ draft: draftFromEntry(entry), editing: true, saving: false, error: null, capabilityNotice: null, advanced: false })
  }
  var closeForm = function () { setForm(null) }

  var saveForm = function () {
    if (!form || form.saving) return
    var otherToolNames = entries
      .filter(function (entry) { return !form.editing || entry.id !== form.draft.id })
      .map(function (entry) { return (entry.config || {}).toolName })
      .filter(Boolean)
    var clientError = validateDraft(form.draft, !form.editing, otherToolNames, providerMeta, candidateNames)
    if (clientError) {
      setForm(Object.assign({}, form, { error: clientError }))
      return
    }
    var saving = Object.assign({}, form, { saving: true, error: null })
    setForm(saving)
    var payload = draftToPayload(saving.draft)
    call('subagentAdmin/upsert', { entry: payload }).then(function (raw) {
      var result = unwrap(raw)
      setView(function (prev) { return Object.assign({}, prev, { data: result, loading: false }) })
      setForm(null)
      setNotice(result.warnings && result.warnings.length > 0 ? result.warnings : null)
    }).catch(function (error) {
      var message = String((error && error.message) || error)
      setForm(Object.assign({}, saving, { saving: false, error: message }))
      setToast('保存失败：' + message)
    })
  }

  var removeEntry = function (entry) {
    call('subagentAdmin/remove', { id: entry.id }).then(function (raw) {
      var result = unwrap(raw)
      setView(function (prev) { return Object.assign({}, prev, { data: result, loading: false }) })
      setNotice(null)
    }).catch(function (error) {
      setToast('删除失败：' + String((error && error.message) || error))
    })
  }

  var patchDraft = function (patch) {
    setForm(function (prev) {
      return Object.assign({}, prev, { draft: Object.assign({}, prev.draft, patch) })
    })
  }
  var patchProvider = function (providerName) {
    setForm(function (prev) {
      var adjustment = adjustDraftForProvider(prev.draft, providerMeta[providerName])
      return Object.assign({}, prev, {
        draft: Object.assign({}, prev.draft, { provider: providerName }, adjustment.patch),
        error: null,
        capabilityNotice: adjustment.adjusted.length > 0
          ? '已按「' + providerName + '」的能力清除或调整：' + adjustment.adjusted.join('、')
          : null,
      })
    })
  }
  var toggleAdvanced = function () {
    setForm(function (prev) { return Object.assign({}, prev, { advanced: prev.advanced !== true }) })
  }

  var children = []

  // Main toolbar: search + primary actions. Provider filters live on their own
  // row below so a growing backend list never squeezes the search box.
  children.push(createElement('div', { className: 'toolbar', key: 'toolbar' },
    createElement('div', { className: 'search-wrap', key: 'search' },
      createElement('span', { className: 'search-icon' }, '🔍'),
      createElement('input', {
        className: 'input',
        placeholder: '搜索子智能体（名称/ID/后端/提示词/模型）...',
        value: needle,
        onChange: function (event) { setNeedle(event.target.value) },
      })
    ),
    createElement('button', { type: 'button', className: 'btn sm primary', key: 'create', onClick: openCreate }, '＋ 新建子智能体'),
    createElement('button', { type: 'button', className: 'btn sm', key: 'refresh', onClick: reload, disabled: view.loading },
      view.loading ? createElement(Spinner, { key: 'spin' }) : '↻', '刷新')
  ))

  if (meta.providers.length > 1) {
    children.push(createElement('div', { className: 'filterbar', key: 'filterbar' },
      createElement('span', { className: 'filter-label' }, '执行后端'),
      createElement('button', {
        type: 'button', key: 'pill-all',
        className: 'btn sm' + (providerFilter === '全部' ? ' active' : ''),
        onClick: function () { setProviderFilter('全部') },
      }, '全部'),
      meta.providers.map(function (provider) {
        return createElement('button', {
          type: 'button', key: 'pill-' + provider.name,
          className: 'btn sm' + (providerFilter === provider.name ? ' active' : ''),
          onClick: function () { setProviderFilter(providerFilter === provider.name ? '全部' : provider.name) },
        }, provider.name)
      })
    ))
  }

  if (form) {
    children.push(SubagentForm({
      form: form,
      meta: meta,
      candidateNames: candidateNames,
      providerMeta: providerMeta,
      llmProviders: llmProviders,
      llmModels: llmModels,
      entries: entries,
      onPatch: patchDraft,
      onProviderChange: patchProvider,
      onToggleAdvanced: toggleAdvanced,
      onClose: closeForm,
      onSave: saveForm,
    }))
  }

  if (notice) {
    children.push(createElement('div', { className: 'warn-strip', key: 'notice' },
      notice.map(function (warning, index) {
        return createElement('div', { key: index }, '⚠️ ', warning)
      })
    ))
  }

  if (!form) {
    if (view.loading && entries.length === 0) {
      children.push(createElement('div', { className: 'empty', key: 'loading' },
        createElement('span', { className: 'big' }, '⏳'),
        '正在加载子智能体配置…'))
    } else if (view.error) {
      children.push(createElement('div', { className: 'error-strip', key: 'error' }, '⚠️ 加载失败：', view.error))
    } else if (filtered.length === 0) {
      children.push(createElement('div', { className: 'empty', key: 'empty' },
        createElement('span', { className: 'big' }, '🤖'),
        entries.length === 0
          ? '还没有受管子智能体。点击「＋ 新建子智能体」创建第一个：名称、提示词、工具约束、模型指定全部可配。'
          : '没有匹配当前搜索/筛选的子智能体。'))
    } else {
      children.push(createElement('div', { className: 'list', key: 'cards' }, filtered.map(function (entry) {
        return SubagentCard({
          entry: entry,
          onEdit: openEdit,
          onRemove: removeEntry,
        })
      })))
    }
  }

  children.push(createElement('div', { className: 'footer-note', key: 'note' },
    '每张卡片对应 profile cordis.patch.yml 中一个 @deepseek-ai/dsh-tool-subagent 行；保存即写入该文件，由 Cordis HMR 热加载生效（无需重启），重启 dsh 后同样自动加载。首次修改前原文件自动备份为 cordis.patch.yml.bak-subagent-admin。'))

  return createElement('div', null,
    toast ? createElement('div', { className: 'toast' }, toast) : null,
    children
  )
}

function SubagentForm(props) {
  var form = props.form
  var draft = form.draft
  var meta = props.meta
  var candidateNames = props.candidateNames
  var providerMeta = props.providerMeta
  var llmProviders = props.llmProviders || []
  var llmModels = props.llmModels || {}
  var entries = props.entries
  var onPatch = props.onPatch
  var onProviderChange = props.onProviderChange
  var onToggleAdvanced = props.onToggleAdvanced
  var onClose = props.onClose
  var onSave = props.onSave
  var advanced = form.advanced === true

  var providerInfo = providerMeta[draft.provider]
  var capabilityHint = providerInfo
    ? '能力：' + [
      providerInfo.capabilities.persona ? '✓ 提示词' : '✗ 提示词',
      providerInfo.capabilities.toolFilter ? '✓ 工具约束' : '✗ 工具约束',
      providerInfo.capabilities.depthLimit ? '✓ 深度上限' : '✗ 深度上限',
      providerInfo.continuable ? '✓ 可持续会话' : '仅一次性',
    ].join(' / ')
    : ''
  // Model picker options: the selected provider's catalog, else every model.
  var modelOptions = draft.agentProvider && llmModels[draft.agentProvider]
    ? llmModels[draft.agentProvider]
    : [].concat.apply([], Object.keys(llmModels).map(function (k) { return llmModels[k] }))

  return createElement('div', { className: 'form', key: 'form' },
    createElement('div', { className: 'form-title' },
      form.editing ? '✏️ 编辑子智能体' : '✨ 新建子智能体',
      createElement('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
        createElement('button', { type: 'button', className: 'btn sm', onClick: onClose, disabled: form.saving }, '取消')
      )
    ),
    form.error ? createElement('div', { className: 'error-strip' }, '⚠️ ', form.error) : null,
    form.capabilityNotice ? createElement('div', { className: 'warn-strip' }, '⚠️ ', form.capabilityNotice) : null,
    createElement('div', { className: 'form-grid' },
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, '实例 ID'),
        createElement('input', {
          className: 'input', value: draft.id, disabled: form.editing || form.saving,
          placeholder: '如 researcher、code-reviewer',
          onChange: function (event) { onPatch({ id: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, '补丁行标识，创建后不可改；持久化在 profile 的 cordis.patch.yml')
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, '子智能体名称（模型可见工具名）'),
        createElement('input', {
          className: 'input', value: draft.toolName, disabled: form.saving,
          placeholder: '如 web_researcher（模型用它发起委托）',
          onChange: function (event) { onPatch({ toolName: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, '不能用保留名 subagent / subagent_fork / run_code，且各实例间唯一')
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, '执行后端（provider）'),
        createElement('select', {
          className: 'input', value: draft.provider, disabled: form.saving,
          onChange: function (event) { onProviderChange(event.target.value) },
        },
          meta.providers.map(function (provider) {
            return createElement('option', { key: provider.name, value: provider.name }, provider.name)
          })
        ),
        createElement('span', { className: 'field-hint' }, capabilityHint)
      ),
      advanced ? createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, '后台模式'),
        createElement('select', {
          className: 'input', value: draft.backgroundMode, disabled: form.saving,
          onChange: function (event) { onPatch({ backgroundMode: event.target.value }) },
        },
          createElement('option', { value: 'one-shot' }, 'one-shot（一次性任务）'),
          createElement('option', { value: 'continuable', disabled: !providerInfo || providerInfo.continuable !== true }, 'continuable（可持续会话）')
        ),
        createElement('label', { className: 'checkbox-row' },
          createElement('input', {
            type: 'checkbox', checked: draft.enableRunInBackground === true, disabled: form.saving,
            onChange: function (event) { onPatch({ enableRunInBackground: event.target.checked }) },
          }),
          '暴露 run_in_background 参数'
        )
      ) : null,
      createElement('div', { className: 'field full' },
        createElement('span', { className: 'field-label' }, '提示词（persona，留空继承部署默认）'),
        createElement('textarea', {
          className: 'input', value: draft.persona, rows: 4, disabled: form.saving || providerInfo?.capabilities.persona === false,
          placeholder: '该子智能体的人设/职责说明…支持 {{model}} 与 {{cwd}} 模板变量',
          onChange: function (event) { onPatch({ persona: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, providerInfo?.capabilities.persona === false
          ? '当前后端不支持提示词；切换后端时已有内容会自动清除'
          : '保存后影子覆盖（shadow）部署级 persona，仅对该子智能体生效')
      ),
      createElement('div', { className: 'field full' },
        createElement('button', {
          type: 'button', className: 'btn sm', disabled: form.saving,
          onClick: onToggleAdvanced,
        }, advanced ? '收起高级设置' : '高级设置（工具、模型、深度与后台）')
      ),
      advanced ? createElement('div', { className: 'fieldset full' },
        createElement('span', { className: 'fieldset-legend' }, '工具约束（toolFilter，留空则不限制；可搜索和手动输入，仅当前候选工具可保存）'),
        createElement('div', { className: 'field' },
          createElement('span', { className: 'field-label' }, '仅允许（allow 白名单）'),
          createElement(Picker, {
            multi: true, kind: 'allow', allowCustom: true, disabled: form.saving || providerInfo?.capabilities.toolFilter === false,
            values: draft.allow, options: candidateNames.map(function (n) { return { value: n, label: n } }),
            placeholder: '输入或选择工具名，如 read / glob / grep', ariaLabel: '仅允许工具',
            onChange: function (next) { onPatch({ allow: next }) },
          }),
          createElement('span', { className: 'field-hint' }, '设置后子智能体只保留名单内工具，其余从提示词移除且拒绝执行')
        ),
        createElement('div', { className: 'field' },
          createElement('span', { className: 'field-label' }, '禁止（deny 黑名单）'),
          createElement(Picker, {
            multi: true, kind: 'deny', allowCustom: true, disabled: form.saving || providerInfo?.capabilities.toolFilter === false,
            values: draft.deny, options: candidateNames.map(function (n) { return { value: n, label: n } }),
            placeholder: '输入或选择工具名，如 bash / pwsh', ariaLabel: '禁止工具',
            onChange: function (next) { onPatch({ deny: next }) },
          }),
          createElement('span', { className: 'field-hint' }, providerInfo?.capabilities.toolFilter === false
            ? '当前后端不支持工具约束；切换后端时已有约束会自动清除'
            : '名单内工具对子智能体不可见；手动输入的工具也必须在当前候选清单内才可保存')
        )
      ) : null,
      advanced ? createElement('div', { className: 'fieldset full' },
        createElement('span', { className: 'fieldset-legend' }, '模型指定（agentOptions，留空字段继承父代理当前路由）'),
        createElement('div', { className: 'form-grid' },
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, 'LLM provider'),
            createElement(Picker, {
              multi: false, allowCustom: true,
              values: draft.agentProvider ? [draft.agentProvider] : [],
              options: llmProviders.map(function (p) { return { value: p.id, label: p.name } }),
              placeholder: '留空继承，如 optirouter / deepseek-official', ariaLabel: 'LLM provider',
              onChange: function (next) { onPatch({ agentProvider: next[0] || '' }) },
            })
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, '模型标识（model）'),
            createElement(Picker, {
              multi: false, allowCustom: true,
              values: draft.agentModel ? [draft.agentModel] : [],
              options: modelOptions.map(function (m) { return { value: m.id, label: m.name } }),
              placeholder: '留空继承，如 auto', ariaLabel: '模型标识',
              onChange: function (next) { onPatch({ agentModel: next[0] || '' }) },
            }),
            createElement('span', { className: 'field-hint' }, '从已配置模型中选择，或手填模型 id（需在该 provider 路由上注册）')
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, 'maxTokens（单次回复上限）'),
            createElement('input', {
              className: 'input', value: draft.maxTokens, disabled: form.saving,
              placeholder: '留空使用默认', inputMode: 'numeric',
              onChange: function (event) { onPatch({ maxTokens: event.target.value.replace(/[^0-9]/g, '') }) },
            })
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, '最大委托深度（maxDepth，0 = 禁止再委托）'),
            createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              createElement('input', {
                className: 'input', value: draft.maxDepthManaged ? '' : draft.maxDepth,
                disabled: form.saving || draft.maxDepthManaged || providerInfo?.capabilities.depthLimit === false,
                placeholder: '3（默认）', inputMode: 'numeric',
                onChange: function (event) { onPatch({ maxDepth: event.target.value.replace(/[^0-9]/g, '') }) },
              }),
              createElement('label', { className: 'checkbox-row', style: { flex: 'none' } },
                createElement('input', {
                  type: 'checkbox', checked: draft.maxDepthManaged, disabled: form.saving || providerInfo?.capabilities.depthLimit === false,
                  onChange: function (event) { onPatch({ maxDepthManaged: event.target.checked }) },
                }),
                '交由后端管理'
              )
            )
          )
        )
      ) : null
    ),
    createElement('div', { className: 'form-actions' },
      createElement('button', { type: 'button', className: 'btn sm', onClick: onClose, disabled: form.saving }, '取消'),
      createElement('button', { type: 'button', className: 'btn sm primary', onClick: onSave, disabled: form.saving },
        form.saving ? createElement(Spinner, { key: 'spin' }) : null,
        '保存')
    )
  )
}

function SubagentCard(props) {
  var entry = props.entry
  var config = entry.config || {}
  var live = entry.live || {}
  var liveTag = live.providerPresent === false
    ? createElement('span', { className: 'tag dead' }, '❌ 后端未注册')
    : live.toolRegistered
      ? createElement('span', { className: 'tag live' }, '✅ 已挂载')
      : createElement('span', { className: 'tag warn' }, '⚠️ 工具未挂载')
  var hasModelRoute = config.agentOptions && (config.agentOptions.model || config.agentOptions.provider)
  var modelLabel = hasModelRoute
    ? ((config.agentOptions.model || '') + (config.agentOptions.provider ? (config.agentOptions.model ? ' @ ' : '') + config.agentOptions.provider : ''))
    : '继承父代理'

  var children = [
    createElement('div', { className: 'card-header', key: 'head' },
      createElement('span', { className: 'card-title' }, '🤖 ', config.toolName || entry.id),
      createElement('span', { className: 'card-actions' },
        createElement('button', { type: 'button', className: 'btn sm', onClick: function () { props.onEdit(entry) } }, '编辑'),
        createElement(ConfirmButton, {
          label: '删除', confirmLabel: '确认删除？',
          onConfirm: function () { props.onRemove(entry) },
        })
      )
    ),
    createElement('div', { className: 'card-sub', key: 'tags' },
      createElement('span', { className: 'tag provider' }, '⚙ ' + (config.provider || '?')),
      createElement('span', { className: 'tag model' }, '🧠 ' + modelLabel),
      createElement('span', { className: 'tag' }, config.backgroundMode === 'continuable' ? '可持续' : '一次性'),
      typeof config.maxDepth === 'number' ? createElement('span', { className: 'tag' }, '深度≤' + config.maxDepth) : null,
      config.maxDepth === 'provider-managed' ? createElement('span', { className: 'tag' }, '深度=后端管理') : null,
      liveTag
    ),
  ]

  if (config.persona) {
    children.push(createElement('div', { className: 'persona-box', key: 'persona' },
      createElement('span', null, '📝'),
      createElement('span', { className: 'persona-text' }, config.persona)
    ))
  }

  var chips = []
  if (config.toolFilter && config.toolFilter.allow && config.toolFilter.allow.length > 0) {
    chips.push(createElement('span', { key: 'allow-label', style: { fontSize: '10px', color: '#047857', fontWeight: 600 } }, '仅允许'))
    config.toolFilter.allow.forEach(function (name) {
      chips.push(createElement('span', { key: 'a-' + name, className: 'chip allow' }, name))
    })
  }
  if (config.toolFilter && config.toolFilter.deny && config.toolFilter.deny.length > 0) {
    chips.push(createElement('span', { key: 'deny-label', style: { fontSize: '10px', color: '#b91c1c', fontWeight: 600 } }, '禁止'))
    config.toolFilter.deny.forEach(function (name) {
      chips.push(createElement('span', { key: 'd-' + name, className: 'chip deny' }, name))
    })
  }
  if (chips.length > 0) {
    children.push(createElement('div', { className: 'chips', key: 'chips' }, chips))
  }

  children.push(createElement('div', { className: 'card-sub', key: 'meta' },
    createElement('span', { className: 'tag', title: entry.id }, 'ID: ' + entry.id),
    config.toolFilter === undefined ? createElement('span', { className: 'tag' }, '工具不限制') : null
  ))

  return createElement('div', { className: 'card', key: entry.id }, children)
}

/* ========================================================================== */
/*                               History panel                                */
/* ========================================================================== */

function HistoryPanel(props) {
  var call = props.call
  var state = useState({ loading: true, error: null, data: null })
  var view = state[0]
  var setView = state[1]

  var reload = function () {
    setView(function (prev) { return Object.assign({}, prev, { loading: true, error: null }) })
    call('subagentAdmin/history', { limit: 200 }).then(function (raw) {
      setView({ loading: false, error: null, data: unwrap(raw) })
    }).catch(function (error) {
      setView({ loading: false, error: String((error && error.message) || error), data: null })
    })
  }
  useEffect(reload, [])

  var actionLabels = { create: '新建', update: '更新', delete: '删除', corrupt: '损坏记录', mount: '挂载', unmount: '卸载', 'cli-update': 'CLI 配置' }
  var children = [
    createElement('div', { className: 'toolbar', key: 'bar' },
      createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', flex: 1 } },
        '配置台账：每次新建/更新/删除都追加一条记录（JSONL），文件路径见下方。'),
      createElement('button', { type: 'button', className: 'btn sm', onClick: reload, disabled: view.loading },
        view.loading ? createElement(Spinner, { key: 'spin' }) : '↻', '刷新')
    ),
  ]

  if (view.error) {
    children.push(createElement('div', { className: 'error-strip', key: 'err' }, '⚠️ 加载失败：', view.error))
  } else if (view.data && view.data.records && view.data.records.length > 0) {
    children.push(createElement('div', { className: 'footer-note', key: 'path' }, '台账文件：' + view.data.path))
    children.push(createElement('div', { className: 'list', key: 'rows' }, view.data.records.map(function (record, index) {
      return createElement('div', { className: 'history-row', key: index },
        createElement('div', { className: 'history-head' },
          createElement('span', {
            className: 'tag ' + (record.action === 'delete' || record.action === 'unmount' ? 'dead'
              : record.action === 'create' || record.action === 'mount' ? 'live' : 'warn'),
          }, actionLabels[record.action] || record.action),
          createElement('span', { style: { fontWeight: 600 } }, record.id || '—'),
          record.toolName ? createElement('span', { className: 'tag' }, record.toolName) : null,
          createElement('span', { className: 'history-time' }, record.at || '')
        ),
        record.entry ? createElement('div', { className: 'history-detail' }, JSON.stringify(record.entry.config || record.entry)) : null
      )
    })))
  } else if (!view.loading) {
    children.push(createElement('div', { className: 'empty', key: 'empty' },
      createElement('span', { className: 'big' }, '📜'),
      '还没有变更记录。每次新建、编辑或删除子智能体后都会在这里留痕。'))
  }

  return createElement('div', null, children)
}

/* ========================================================================== */
/*                                CLI backends                                */
/* ========================================================================== */

/** Draft shape for one CLI backend's editable config. */
function cliDraftFromConfig(config) {
  config = config || {}
  return {
    providerName: config.providerName !== undefined ? String(config.providerName) : '',
    permissionMode: config.permissionMode !== undefined ? String(config.permissionMode) : '',
    disposeGraceMs: config.disposeGraceMs !== undefined ? String(config.disposeGraceMs) : '3000',
    envPairs: Object.keys(config.env || {}).map(function (key) {
      return { key: key, value: String(config.env[key]) }
    }),
  }
}

/** Convert a draft back into the wire config object. */
function cliConfigFromDraft(draft) {
  var config = {
    providerName: draft.providerName.trim(),
    permissionMode: draft.permissionMode,
    disposeGraceMs: Number(draft.disposeGraceMs.trim()),
    env: {},
  }
  draft.envPairs.forEach(function (pair) {
    var key = pair.key.trim()
    if (key !== '') config.env[key] = pair.value
  })
  return config
}

/** Shared env key/value pair editor (used by every CLI backend card). */
function EnvPairsEditor(props) {
  var pairs = props.pairs || []
  return createElement('div', { className: 'fieldset' },
    createElement('span', { className: 'fieldset-legend' }, 'env（传给 CLI 子进程的额外环境变量）'),
    pairs.map(function (pair, index) {
      return createElement('div', { className: 'env-row', key: index },
        createElement('input', {
          className: 'input env-key', value: pair.key,
          placeholder: '变量名（如 OPENAI_API_KEY）',
          onChange: function (event) { props.onPatchPair(index, { key: event.target.value }) },
        }),
        createElement('input', {
          className: 'input env-value', value: pair.value,
          placeholder: '变量值',
          onChange: function (event) { props.onPatchPair(index, { value: event.target.value }) },
        }),
        createElement('button', { type: 'button', className: 'btn sm', onClick: function () { props.onRemove(index) } }, '✕'),
      )
    }),
    createElement('button', { type: 'button', className: 'btn sm', onClick: props.onAdd }, '＋ 添加变量'),
  )
}

/** One CLI backend card: collapsible status header + config form + mount/save/unmount. */
function CliBackendCard(props) {
  var backend = props.backend
  var draft = props.draft
  var busy = props.busy === true
  var expanded = props.expanded === true
  var onPatch = props.onPatch
  var onPatchEnvPair = props.onPatchEnvPair
  var onAddEnvPair = props.onAddEnvPair
  var onRemoveEnvPair = props.onRemoveEnvPair
  var onToggle = props.onToggle
  var onSave = props.onSave
  var onUnmount = props.onUnmount

  var packageOk = !!(backend.providerPackage && backend.providerPackage.ok)
  var runner = backend.runner || { ok: false, version: null }
  var cli = backend.cli || { ok: false, version: null }
  var modeValue = backend.permissionModes.indexOf(draft.permissionMode) !== -1
    ? draft.permissionMode
    : backend.permissionModes[0]

  var onToggle = props.onToggle
  var onSave = props.onSave
  var onInstall = props.onInstall
  var onUnmount = props.onUnmount

  var packageOk = !!(backend.providerPackage && backend.providerPackage.ok)
  var runner = backend.runner || { ok: false, version: null }
  var cli = backend.cli || { ok: false, version: null }
  var missingPackages = backend.missing || []
  var depsMissing = missingPackages.length > 0
  var missingLabel = missingPackages.join(' + ')
  var modeValue = backend.permissionModes.indexOf(draft.permissionMode) !== -1
    ? draft.permissionMode
    : backend.permissionModes[0]

  return createElement('div', { className: 'card', key: backend.id },
    createElement('div', { className: 'card-header' },
      createElement('button', {
        type: 'button', className: 'cli-toggle',
        'aria-expanded': expanded,
        'aria-label': expanded ? '收起明细' : '展开明细',
        title: expanded ? '收起明细' : '展开明细',
        onClick: onToggle,
      }, expanded ? '▾' : '▸'),
      createElement('span', { className: 'cli-title', onClick: onToggle }, '🔌 ' + backend.label),
      createElement('span', { className: 'cli-tags' },
        createElement('span', { className: 'tag ' + (backend.mounted ? 'live' : '') }, backend.mounted ? '已挂载' : '未挂载'),
        createElement('span', { className: 'tag ' + (packageOk ? 'live' : 'dead') },
          packageOk
            ? 'provider 包' + (backend.providerPackage.version ? ' v' + backend.providerPackage.version : ' ✓')
            : 'provider 包 ✗'),
        createElement('span', { className: 'tag ' + (runner.ok ? 'live' : 'warn') },
          runner.ok ? 'CLI 依赖 ✓' : 'CLI 依赖 ✗'),
        createElement('span', { className: 'tag ' + (cli.ok ? 'model' : 'warn') },
          cli.ok ? 'PATH ' + (cli.version || '已安装') : 'PATH ✗ ' + backend.cliCommand),
      ),
      createElement('span', { style: { display: 'flex', gap: '5px', flex: 'none' } },
        depsMissing
          ? createElement('button', {
            type: 'button', className: 'btn sm',
            disabled: busy,
            title: 'npm install -g 全局安装缺失包：' + missingLabel,
            onClick: onInstall,
          }, busy ? createElement(Spinner, { key: 'spin' }) : null, busy ? '安装中…' : '安装依赖包')
          : null,
        backend.mounted
          ? createElement('button', { type: 'button', className: 'btn sm primary', disabled: busy, onClick: onSave },
            busy ? createElement(Spinner, { key: 'spin' }) : null, '保存配置')
          : packageOk
            ? createElement('button', { type: 'button', className: 'btn sm primary', disabled: busy, onClick: onSave },
              busy ? createElement(Spinner, { key: 'spin' }) : null, '挂载')
            : null,
        backend.mounted
          ? createElement(ConfirmButton, { label: '卸载', confirmLabel: '确认卸载？', disabled: busy, onConfirm: onUnmount })
          : null,
      )
    ),
    expanded ? createElement('div', { className: 'cli-detail', key: 'detail' },
    createElement('div', { className: 'form-grid' },
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, 'providerName（执行后端注册名）'),
        createElement('input', {
          className: 'input', value: draft.providerName,
          placeholder: '如 codex / claude-code（子智能体表单的执行后端选项）',
          onChange: function (event) { onPatch({ providerName: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, 'permissionMode（CLI 权限模式）'),
        createElement('select', {
          className: 'input', value: modeValue,
          onChange: function (event) { onPatch({ permissionMode: event.target.value }) },
        }, backend.permissionModes.map(function (mode) {
          return createElement('option', { key: mode, value: mode }, mode)
        })),
        createElement('span', { className: 'field-hint' }, '枚举来自该 provider 包的 Config schema')
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, 'disposeGraceMs（进程树终止宽限，毫秒）'),
        createElement('input', {
          className: 'input', value: draft.disposeGraceMs,
          placeholder: '3000',
          onChange: function (event) { onPatch({ disposeGraceMs: event.target.value }) },
        }),
      ),
    ),
    createElement(EnvPairsEditor, {
      pairs: draft.envPairs,
      onPatchPair: onPatchEnvPair,
      onAdd: onAddEnvPair,
      onRemove: onRemoveEnvPair,
    }),
    ) : null,
  )
}

/** Draft shape for one generic external-CLI backend's editable config. */
function cliDraftFromGeneric(backend) {
  backend = backend || {}
  return {
    command: backend.command !== undefined ? String(backend.command) : '',
    argsText: Array.isArray(backend.args) ? backend.args.join(' ') : '{prompt}',
    providerName: backend.providerName !== undefined ? String(backend.providerName) : '',
    disposeGraceMs: backend.disposeGraceMs !== undefined ? String(backend.disposeGraceMs) : '3000',
    envPairs: Object.keys(backend.env || {}).map(function (key) {
      return { key: key, value: String(backend.env[key]) }
    }),
  }
}

/** Convert a generic draft into the wire config object (args split on whitespace). */
function cliConfigFromGenericDraft(draft) {
  var config = {
    command: draft.command.trim(),
    args: draft.argsText.trim().split(/\s+/).filter(Boolean),
    providerName: draft.providerName.trim(),
    disposeGraceMs: Number(draft.disposeGraceMs.trim()),
    env: {},
  }
  draft.envPairs.forEach(function (pair) {
    var key = pair.key.trim()
    if (key !== '') config.env[key] = pair.value
  })
  return config
}

/** One generic external-CLI backend card (served by this plugin's command provider). */
function GenericCliCard(props) {
  var backend = props.backend
  var draft = props.draft
  var busy = props.busy === true
  var expanded = props.expanded === true
  var onToggle = props.onToggle
  var onPatch = props.onPatch
  var onPatchEnvPair = props.onPatchEnvPair
  var onAddEnvPair = props.onAddEnvPair
  var onRemoveEnvPair = props.onRemoveEnvPair
  var onSave = props.onSave
  var onUnmount = props.onUnmount

  var cli = backend.cli || { ok: false, version: null }

  return createElement('div', { className: 'card', key: backend.id },
    createElement('div', { className: 'card-header' },
      createElement('button', {
        type: 'button', className: 'cli-toggle',
        'aria-expanded': expanded,
        'aria-label': expanded ? '收起明细' : '展开明细',
        title: expanded ? '收起明细' : '展开明细',
        onClick: onToggle,
      }, expanded ? '▾' : '▸'),
      createElement('span', { className: 'cli-title', onClick: onToggle }, '⌨️ ' + backend.command),
      createElement('span', { className: 'cli-tags' },
        createElement('span', { className: 'tag live' }, '已挂载'),
        createElement('span', { className: 'tag ' + (backend.providerPresent ? 'live' : 'warn') },
          backend.providerPresent ? '后端在线 ✓' : '后端未注册'),
        createElement('span', { className: 'tag ' + (cli.ok ? 'model' : 'warn') },
          cli.ok ? 'PATH ' + (cli.version || '已安装') : 'PATH ✗ ' + backend.command),
      ),
      createElement('span', { style: { display: 'flex', gap: '5px', flex: 'none' } },
        createElement('button', { type: 'button', className: 'btn sm primary', disabled: busy, onClick: onSave },
          busy ? createElement(Spinner, { key: 'spin' }) : null, '保存配置'),
        createElement(ConfirmButton, { label: '卸载', confirmLabel: '确认卸载？', disabled: busy, onConfirm: onUnmount }),
      )
    ),
    expanded ? createElement('div', { className: 'cli-detail', key: 'detail' },
    createElement('div', { className: 'form-grid' },
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, 'command（PATH 命令名或绝对路径）'),
        createElement('input', {
          className: 'input', value: draft.command,
          placeholder: '如 gemini / qwen / C:\\tools\\aider.exe',
          onChange: function (event) { onPatch({ command: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, 'providerName（执行后端注册名）'),
        createElement('input', {
          className: 'input', value: draft.providerName,
          placeholder: '如 cli-gemini（子智能体表单的执行后端选项）',
          onChange: function (event) { onPatch({ providerName: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field full' },
        createElement('span', { className: 'field-label' }, 'args（空格分隔，{prompt} 占位提示词）'),
        createElement('input', {
          className: 'input', value: draft.argsText,
          placeholder: '-p {prompt}',
          onChange: function (event) { onPatch({ argsText: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, 'one-shot 纯文本：stdout 即委托结果，非零退出记为失败；prompt 经 {prompt} 传入'),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, 'disposeGraceMs（进程树终止宽限，毫秒）'),
        createElement('input', {
          className: 'input', value: draft.disposeGraceMs,
          placeholder: '3000',
          onChange: function (event) { onPatch({ disposeGraceMs: event.target.value }) },
        }),
      ),
    ),
    createElement(EnvPairsEditor, {
      pairs: draft.envPairs,
      onPatchPair: onPatchEnvPair,
      onAdd: onAddEnvPair,
      onRemove: onRemoveEnvPair,
    }),
    ) : null,
  )
}

function CliPanel(props) {
  var call = props.call

  var viewState = useState({ loading: true, error: null, data: null })
  var view = viewState[0]
  var setView = viewState[1]

  var draftsState = useState({})
  var drafts = draftsState[0]
  var setDrafts = draftsState[1]

  var busyState = useState({})
  var busy = busyState[0]
  var setBusy = busyState[1]

  var customCommandState = useState('')
  var customCommand = customCommandState[0]
  var setCustomCommand = customCommandState[1]

  var expandedState = useState({})
  var expanded = expandedState[0]
  var setExpanded = expandedState[1]

  var toggleExpanded = function (backendId) {
    setExpanded(function (prev) {
      var next = Object.assign({}, prev)
      next[backendId] = prev[backendId] !== true
      return next
    })
  }

  var toastState = useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]

  useEffect(function () {
    if (!toast) return undefined
    var timer = setTimeout(function () { setToast(null) }, 4200)
    return function () { clearTimeout(timer) }
  }, [toast])

  /** Adopt a detection payload: view data + reset drafts to the served configs. */
  var absorb = function (result) {
    setView({ loading: false, error: null, data: result })
    var next = {}
    ;(result.backends || []).forEach(function (backend) {
      next[backend.id] = backend.kind === 'generic'
        ? cliDraftFromGeneric(backend)
        : cliDraftFromConfig(backend.config)
    })
    setDrafts(next)
    setBusy({})
  }

  var reload = function () {
    setView(function (prev) { return Object.assign({}, prev, { loading: true, error: null }) })
    call('subagentAdmin/cliList', {}).then(function (raw) {
      absorb(unwrap(raw))
    }).catch(function (error) {
      setView({ loading: false, error: String((error && error.message) || error), data: null })
    })
  }
  useEffect(reload, [])

  var patchDraft = function (backendId, patch) {
    setDrafts(function (prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, patch)
      return next
    })
  }

  // Env-pair edits derive from the latest queued state (functional update), so
  // rapid consecutive edits can never overwrite each other via stale drafts.
  var patchEnvPair = function (backendId, index, patch) {
    setDrafts(function (prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var pairs = (current.envPairs || []).map(function (pair, i) {
        return i === index ? Object.assign({}, pair, patch) : pair
      })
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: pairs })
      return next
    })
  }
  var addEnvPair = function (backendId) {
    setDrafts(function (prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: (current.envPairs || []).concat([{ key: '', value: '' }]) })
      return next
    })
  }
  var removeEnvPair = function (backendId, index) {
    setDrafts(function (prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: (current.envPairs || []).filter(function (_, i) { return i !== index }) })
      return next
    })
  }

  var runUpsert = function (backend) {
    if (busy[backend.id]) return
    var draft = drafts[backend.id]
    if (!draft) return
    var payload
    if (backend.kind === 'generic') {
      if (!/^[^\s]+$/.test(draft.command.trim())) {
        setToast('command 不能包含空格（PATH 命令名或绝对路径）')
        return
      }
      var args = draft.argsText.trim().split(/\s+/).filter(Boolean)
      if (args.length === 0 || args.length > 20 || !args.every(function (arg) { return arg.length <= 256 })) {
        setToast('args 必须是 1-20 个非空片段（单条 ≤ 256 字符），用 {prompt} 占位提示词')
        return
      }
      if (args.indexOf('{prompt}') === -1) {
        setToast('args 必须包含 {prompt} 占位符（提示词将替换该占位符传入 CLI）')
        return
      }
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(draft.providerName.trim())) {
        setToast('providerName 必须是 1-48 位小写字母/数字/下划线/中划线且字母开头')
        return
      }
      if (!/^\d+$/.test(draft.disposeGraceMs.trim())) {
        setToast('disposeGraceMs 必须是非负整数（毫秒）')
        return
      }
      payload = { kind: 'generic', backendId: backend.id, config: cliConfigFromGenericDraft(draft) }
    } else {
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(draft.providerName.trim())) {
        setToast('providerName 必须是 1-48 位小写字母/数字/下划线/中划线且字母开头')
        return
      }
      if (!/^\d+$/.test(draft.disposeGraceMs.trim())) {
        setToast('disposeGraceMs 必须是非负整数（毫秒）')
        return
      }
      payload = { backendId: backend.id, config: cliConfigFromDraft(draft) }
    }
    var busyPatch = {}
    busyPatch[backend.id] = true
    setBusy(Object.assign({}, busy, busyPatch))
    call('subagentAdmin/cliUpsert', { payload: payload }).then(function (raw) {
      absorb(unwrap(raw))
    }).catch(function (error) {
      setBusy({})
      setToast('保存失败：' + String((error && error.message) || error))
    })
  }

  var runUnmount = function (backend) {
    if (busy[backend.id]) return
    var busyPatch = {}
    busyPatch[backend.id] = true
    setBusy(Object.assign({}, busy, busyPatch))
    // Generic backends are recognized server-side by their "cli-" id prefix.
    call('subagentAdmin/cliRemove', { id: backend.id }).then(function (raw) {
      absorb(unwrap(raw))
    }).catch(function (error) {
      setBusy({})
      setToast('卸载失败：' + String((error && error.message) || error))
    })
  }

  var runInstall = function (backend) {
    if (busy[backend.id]) return
    var busyPatch = {}
    busyPatch[backend.id] = true
    setBusy(Object.assign({}, busy, busyPatch))
    call('subagentAdmin/cliInstall', { backendId: backend.id }).then(function (raw) {
      var result = unwrap(raw)
      absorb(result)
      setToast((result && result.output ? result.output : '依赖包安装完成') + '，已重新检测')
    }).catch(function (error) {
      var message = String((error && error.message) || error)
      if (message.indexOf('404') !== -1) {
        message += '（宿主端未注册该接口：请重启 dsh 加载最新插件后重试）'
      }
      setBusy({})
      setToast('安装失败：' + message)
    })
  }

  var runGenericMount = function (command) {
    if (!/^[^\s]+$/.test(command)) {
      setToast('command 不能包含空格（PATH 命令名或绝对路径）')
      return
    }
    var busyPatch = { __scan__: true }
    setBusy(Object.assign({}, busy, busyPatch))
    call('subagentAdmin/cliUpsert', { payload: { kind: 'generic', config: { command: command } } }).then(function (raw) {
      absorb(unwrap(raw))
      setCustomCommand('')
    }).catch(function (error) {
      setBusy({})
      setToast('挂载失败：' + String((error && error.message) || error))
    })
  }

  var children = []

  // 本机 CLI card sits on top: scan list + custom command + refresh; the
  // builtin codex/claude-code cards and mounted generic cards follow below.
  var backends = (view.data && view.data.backends) || []
  var others = (view.data && view.data.others) || []
  var busyAny = Object.keys(busy).some(function (key) { return busy[key] === true })
  var genericBackends = backends.filter(function (backend) { return backend.kind === 'generic' })

  children.push(createElement('div', { className: 'card', key: 'local-cli' },
    createElement('div', { className: 'card-header' },
      createElement('span', { className: 'card-title' }, '🛰️ 本机 CLI'),
      createElement('span', { className: 'tag' }, '通用命令行后端 · one-shot 纯文本'),
      createElement('span', { style: { marginLeft: 'auto', display: 'flex' } },
        createElement('button', { type: 'button', className: 'btn sm', onClick: reload, disabled: view.loading },
          view.loading ? createElement(Spinner, { key: 'spin' }) : '⟳', '重新检测')
      )
    ),
    createElement('div', { className: 'cli-scan-hint' },
      '检测并挂载 harness 内置的外部 CLI 后端（codex / claude-code）与本机其他命令行工具；挂载后即可在「子智能体」表单的执行后端下拉中选用。'),
    createElement('div', { className: 'cli-scan-list' },
      createElement('div', { className: 'cli-scan-row', key: 'custom' },
        createElement('input', {
          className: 'input', value: customCommand,
          placeholder: '添加自定义 CLI：输入命令名或绝对路径，如 aider（挂载为 one-shot 后端）',
          onChange: function (event) { setCustomCommand(event.target.value) },
        }),
        createElement('button', {
          type: 'button', className: 'btn sm',
          disabled: busyAny || customCommand.trim() === '',
          onClick: function () { runGenericMount(customCommand.trim()) },
        }, '挂载'),
      ),
      (function () {
        var mountedCommands = new Set(genericBackends.map(function (backend) {
          return backend.command.toLowerCase()
        }))
        return others
          .filter(function (item) { return !!(item.cli && item.cli.ok) })
          .filter(function (item) { return !mountedCommands.has(item.name.toLowerCase()) })
          .map(function (item) {
            return createElement('div', { className: 'cli-scan-card', key: item.name },
              createElement('span', { className: 'cli-title' }, '⌨️ ' + item.name),
              createElement('span', { className: 'cli-tags' },
                createElement('span', { className: 'tag' }, '未挂载'),
                createElement('span', { className: 'tag live' }, 'PATH ' + (item.cli.version || '已安装')),
              ),
              createElement('button', {
                type: 'button', className: 'btn sm', disabled: busyAny,
                onClick: function () { runGenericMount(item.name) },
              }, '挂载'),
            )
          })
      })(),
      others.length > 0 && others.every(function (item) { return !(item.cli && item.cli.ok) })
        ? createElement('span', { className: 'tag', key: 'none' }, '未检测到其他 agent CLI')
        : null,
    ),
  ))

  if (view.error) {
    children.push(createElement('div', { className: 'error-strip', key: 'error' }, '⚠️ 加载失败：', view.error))
  } else {
    genericBackends.forEach(function (backend) {
      children.push(GenericCliCard({
        backend: backend,
        draft: drafts[backend.id] || cliDraftFromGeneric(backend),
        busy: busy[backend.id] === true,
        expanded: expanded[backend.id] === true,
        onToggle: function () { toggleExpanded(backend.id) },
        onPatch: function (patch) { patchDraft(backend.id, patch) },
        onPatchEnvPair: function (index, patch) { patchEnvPair(backend.id, index, patch) },
        onAddEnvPair: function () { addEnvPair(backend.id) },
        onRemoveEnvPair: function (index) { removeEnvPair(backend.id, index) },
        onSave: function () { runUpsert(backend) },
        onUnmount: function () { runUnmount(backend) },
      }))
    })
    backends.filter(function (backend) { return backend.kind !== 'generic' }).forEach(function (backend) {
      children.push(CliBackendCard({
        backend: backend,
        draft: drafts[backend.id] || cliDraftFromConfig(backend.config),
        busy: busy[backend.id] === true,
        expanded: expanded[backend.id] === true,
        onToggle: function () { toggleExpanded(backend.id) },
        onPatch: function (patch) { patchDraft(backend.id, patch) },
        onPatchEnvPair: function (index, patch) { patchEnvPair(backend.id, index, patch) },
        onAddEnvPair: function () { addEnvPair(backend.id) },
        onRemoveEnvPair: function (index) { removeEnvPair(backend.id, index) },
        onSave: function () { runUpsert(backend) },
        onInstall: function () { runInstall(backend) },
        onUnmount: function () { runUnmount(backend) },
      }))
    })
  }

  return createElement('div', null,
    toast ? createElement('div', { className: 'toast' }, toast) : null,
    children
  )
}

/* ========================================================================== */
/*                              Section entrypoint                            */
/* ========================================================================== */

function SubagentAdminSection(props) {
  var tabState = useState('runtime')
  var activeTab = tabState[0]
  var setActiveTab = tabState[1]
  var tabs = [
    { id: 'runtime', label: '运行中', component: RuntimeSubagentsPanel },
    { id: 'subagents', label: '子智能体', component: SubagentsPanel },
    { id: 'cli', label: 'CLI 后端', component: CliPanel },
    { id: 'history', label: '变更记录', component: HistoryPanel },
  ]
  var selected = tabs.find(function (tab) { return tab.id === activeTab }) || tabs[0]

  return createElement('div', { 'data-dsh-sa-section': '' },
    createElement('div', { className: 'tabs', role: 'tablist', 'aria-label': '子智能体管理' },
      tabs.map(function (tab) {
        return createElement('button', {
          type: 'button', key: tab.id,
          className: 'tab' + (tab.id === selected.id ? ' active' : ''),
          role: 'tab', 'aria-selected': tab.id === selected.id,
          onClick: function () { setActiveTab(tab.id) },
        }, tab.label)
      })
    ),
    createElement(selected.component, { key: selected.id, call: props.call })
  )
}

/* ========================================================================== */
/*          Command & Hook Admin (merged from dsh-command-hook-admin)         */
/* ========================================================================== */

/**
 * dsh-command-hook-admin browser half: the 「命令与钩子」 settings section
 * with two segmented tabs, styled with the same --dsw-* design tokens and
 * visual recipes as the other admin sections (toolbar cards, blue primary
 * buttons, tag badges, card rows).
 *
 * - 命令: file-backed slash commands (`~/.dsh/commands/*.json`), registered
 *   live by the host half — 新建 / 编辑 / 启停 / 删除 apply immediately.
 * - 钩子: the Claude-Code-format hooks file the stock bridge reads once at
 *   apply. 启停 moves entries between hooks.json and a sidecar so the bridge
 *   never fires disabled hooks; every write restarts the mounted bridge
 *   through Fiber.update (the loader's own restart path) and reports the
 *   true outcome. The stock bridge package itself can be installed/mounted
 *   (or uninstalled) right from this panel — the host solidified the bridge
 *   lifecycle that used to require hand-editing the profile.
 */

var CH_CSS_TEXT = [
  '[data-cha-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); overflow: visible; }',
  '[data-cha-section] * { box-sizing: border-box; }',
  // Segmented tabs — the same recipe the subagents section uses.
  '[data-cha-section] .tabs { display: flex; padding: 3px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.2)); border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.3)); gap: 3px; }',
  '[data-cha-section] .tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 7px 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, #666); transition: all 0.15s ease; font-family: inherit; }',
  '[data-cha-section] .tab:hover:not(.active) { color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); }',
  '[data-cha-section] .tab.active { background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); color: var(--dsw-alias-label-primary, #333); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04); }',
  '[data-cha-section] .tab:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }',
  // Toolbar card — same recipe as the unified sections.
  '[data-cha-section] .toolbar { display: flex; gap: 8px; align-items: center; padding: 10px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); flex-wrap: wrap; }',
  '[data-cha-section] .toolbar .title { font-weight: 600; color: var(--dsw-alias-label-primary); }',
  '[data-cha-section] .toolbar .count { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.3)); color: var(--dsw-alias-label-secondary, #555); font-weight: 500; }',
  '[data-cha-section] .toolbar .spacer { flex: 1; }',
  // Buttons — same recipe as the unified sections (blue primary, red danger).
  '[data-cha-section] .btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 32px; padding: 0 14px; border-radius: 9px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; transition: all 0.15s ease; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); background: var(--dsw-alias-interactive-bg-hover, rgba(240,240,245,0.6)); color: var(--dsw-alias-label-secondary, #555); white-space: nowrap; flex: none; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }',
  '[data-cha-section] .btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(220,220,230,0.7)); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.65)); color: var(--dsw-alias-label-primary, #222); }',
  '[data-cha-section] .btn:active:not(:disabled) { transform: translateY(1px); }',
  '[data-cha-section] .btn:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }',
  '[data-cha-section] .btn:disabled { opacity: 0.45; cursor: not-allowed; }',
  '[data-cha-section] .btn.primary { background: var(--dsw-static-blue-500, #3b82f6); color: #fff; border-color: transparent; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }',
  '[data-cha-section] .btn.primary:hover:not(:disabled) { background: var(--dsw-static-blue-400, #60a5fa); color: #fff; }',
  '[data-cha-section] .btn.danger { color: var(--dsw-alias-state-error-primary, #dc2626); border-color: var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); }',
  '[data-cha-section] .btn.danger:hover:not(:disabled) { background: rgba(239,68,68,0.1); border-color: rgba(220,38,38,0.35); color: #b91c1c; }',
  '[data-cha-section] .btn.sm { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 6px; }',
  // Status banners — the same tint recipe as update-strip / busy-banner.
  '[data-cha-section] .notice { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 11px; border-radius: 8px; font-size: 12px; line-height: 1.5; background: rgba(59,130,246,0.08); color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-cha-section] .notice.warn { background: rgba(217,119,6,0.1); color: #b45309; }',
  '[data-cha-section] .notice.ok { background: rgba(16,185,129,0.1); color: #047857; }',
  '[data-cha-section] .notice .notice-text { flex: 1 1 240px; }',
  '[data-cha-section] .notice .notice-actions { display: flex; gap: 5px; flex: none; }',
  // Rows — card elevation + hover lift like the other list cards.
  '[data-cha-section] .list { display: flex; flex-direction: column; gap: 10px; }',
  '[data-cha-section] .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }',
  '[data-cha-section] .row:hover { transform: translateY(-1px); border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }',
  '[data-cha-section] .row.off { opacity: 0.55; }',
  '[data-cha-section] .row .main { flex: 1; min-width: 0; }',
  '[data-cha-section] .row .name { font-weight: 600; }',
  '[data-cha-section] .row .desc { color: var(--dsw-alias-label-secondary, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-cha-section] .row .desc.mono { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; }',
  '[data-cha-section] .row .meta { color: var(--dsw-alias-label-tertiary, #999); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '[data-cha-section] .name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }',
  '[data-cha-section] .actions { display: flex; gap: 5px; align-items: center; flex: none; }',
  // Tag badges — same recipe as the unified .tag family.
  '[data-cha-section] .tag { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; flex: none; display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-cha-section] .tag.event { background: rgba(59,130,246,0.12); color: var(--dsw-static-blue-500, #3b82f6); font-family: var(--dsw-font-mono, ui-monospace, monospace); }',
  '[data-cha-section] .tag.warn { background: rgba(217,119,6,0.12); color: #b45309; }',
  '[data-cha-section] .tag.err { background: rgba(239,68,68,0.1); color: var(--dsw-alias-state-error-primary, #ef4444); }',
  // Toggle switch — the blue accent instead of the standalone plugin's dark knob.
  '[data-cha-section] .toggle { position: relative; width: 34px; height: 20px; flex: none; appearance: none; border: none; border-radius: 99px; cursor: pointer; background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.3)); transition: background 0.15s; }',
  '[data-cha-section] .toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 99px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 0.15s; }',
  '[data-cha-section] .toggle[aria-checked="true"] { background: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-cha-section] .toggle[aria-checked="true"]::after { transform: translateX(14px); }',
  '[data-cha-section] .toggle:focus-visible { outline: 2px solid var(--dsw-static-blue-500, #3b82f6); outline-offset: 2px; }',
  '[data-cha-section] .toggle:disabled { opacity: 0.45; cursor: not-allowed; }',
  // Forms — .input recipe with the blue focus ring.
  '[data-cha-section] .form { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 12px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent)); box-shadow: 0 1px 2px rgba(0,0,0,0.02); }',
  '[data-cha-section] .field { display: flex; flex-direction: column; gap: 4px; }',
  '[data-cha-section] .field label { font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }',
  '[data-cha-section] .input { width: 100%; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.5)); background: var(--dsw-alias-bg-base, transparent); color: inherit; font: inherit; outline: none; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; }',
  '[data-cha-section] .input:hover { border-color: var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6)); }',
  '[data-cha-section] .input:focus { border-color: var(--dsw-static-blue-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59,130,246,0.16); }',
  '[data-cha-section] select.input { height: 32px; padding: 0 8px; cursor: pointer; }',
  '[data-cha-section] textarea.input { resize: vertical; min-height: 120px; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.55; }',
  '[data-cha-section] .input.mono { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; }',
  '[data-cha-section] .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
  '[data-cha-section] .checks { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }',
  '[data-cha-section] .check { display: flex; gap: 6px; align-items: center; cursor: pointer; }',
  '[data-cha-section] .form-actions { display: flex; gap: 8px; justify-content: flex-end; }',
  // Misc.
  '[data-cha-section] .hint { font-size: 12px; color: var(--dsw-alias-label-tertiary, #999); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
  '[data-cha-section] .path-chip { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(200,200,210,0.25)); color: var(--dsw-alias-label-secondary, #555); word-break: break-all; }',
  '[data-cha-section] .error-text { color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; }',
  '[data-cha-section] .empty { padding: 20px; text-align: center; color: var(--dsw-alias-label-tertiary, #999); border: 1px dashed var(--dsw-alias-border-subtle, rgba(200,200,210,0.4)); border-radius: 12px; }',
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

/** The events the stock Claude-Code bridge supports, with matcher notes. */
var CH_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop']
var CH_MATCHERLESS = { UserPromptSubmit: true, Stop: true }

/**
 * Describe one hook reload outcome for the status banner. The host restarts
 * the mounted bridge through Fiber.update; "已生效" is only ever claimed when
 * the restart actually completed.
 * @param reload - the host's reload report.
 * @returns display text, or null when there is nothing to say.
 */
function chReloadNote(reload) {
  if (reload === undefined || reload === null) return null
  if (reload.reloaded) return '✓ 已重启 hooks 桥，配置已生效。'
  if (reload.mounted) return '⚠ hooks 桥热重启失败：' + messageOf(reload.error) + '（配置已写入，重启 dsh 后生效）'
  return '已写入 hooks.json。当前未挂载 hooks 桥（hooks-claude-code），挂载后生效。'
}

/**
 * Notice tone for a status note: ✓ prefixes read as success (green), ⚠ as a
 * warning (amber), everything else stays informational (blue).
 * @param text - the note text.
 * @returns the notice class name.
 */
function chNoticeClass(text) {
  if (typeof text === 'string' && text.indexOf('✓') !== -1) return 'notice ok'
  if (typeof text === 'string' && text.indexOf('⚠') !== -1) return 'notice warn'
  return 'notice'
}

/**
 * One labeled form field.
 * @param label - label text.
 * @param input - the input element.
 * @param hint - optional hint line under the control.
 * @returns the field element.
 */
function chField(label, input, hint) {
  return createElement('div', { className: 'field', key: label },
    createElement('label', null, label),
    input,
    hint ? createElement('div', { className: 'hint' }, hint) : null,
  )
}

/**
 * A small switch button with the toggle role.
 * @param checked - current state.
 * @param onChange - click handler.
 * @param label - accessible name.
 * @returns the button element.
 */
function chToggle(checked, onChange, label) {
  return createElement('button', {
    type: 'button',
    role: 'switch',
    className: 'toggle',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label,
    disabled: !onChange,
    onClick: onChange || undefined,
  })
}

/**
 * One command list row: /name + description, live status, toggle, edit, delete.
 * @param props - { command, busy, onToggle, onEdit, onDelete, confirming, onConfirmDelete, onCancelDelete }.
 * @returns the row element.
 */
function ChCommandRow(props) {
  var c = props.command
  var badges = []
  if (!c.enabled) badges.push(createElement('span', { className: 'tag', key: 'off' }, '已停用'))
  if (c.conflict) badges.push(createElement('span', { className: 'tag err', key: 'conflict', title: c.conflict }, '注册失败'))
  if (c.fileError) badges.push(createElement('span', { className: 'tag err', key: 'file', title: c.fileError }, '文件错误'))
  var actions = props.confirming
    ? [
      createElement('button', { className: 'btn sm danger', key: 'yes', disabled: props.busy, onClick: props.onConfirmDelete }, '确认删除'),
      createElement('button', { className: 'btn sm', key: 'no', disabled: props.busy, onClick: props.onCancelDelete }, '取消'),
    ]
    : [
      createElement('button', { className: 'btn sm', key: 'edit', disabled: props.busy, onClick: props.onEdit }, '编辑'),
      createElement('button', { className: 'btn sm danger', key: 'del', disabled: props.busy, 'aria-label': '删除命令 /' + c.name, onClick: props.onDelete }, '删除'),
    ]
  return createElement('div', { className: 'row' + (c.enabled ? '' : ' off') },
    createElement('div', { className: 'main' },
      createElement('div', { className: 'name-row' },
        createElement('span', { className: 'name' }, '/' + c.name),
        badges,
      ),
      createElement('div', { className: 'desc' }, c.description || ''),
      c.inputHint ? createElement('div', { className: 'meta' }, '参数提示：' + c.inputHint) : null,
    ),
    createElement('div', { className: 'actions' }, actions),
    chToggle(c.enabled, props.busy ? null : props.onToggle, (c.enabled ? '停用' : '启用') + '命令 /' + c.name),
  )
}

/**
 * The command create/edit form.
 * @param props - { initial, busy, error, onSave, onCancel }.
 * @returns the form element.
 */
function ChCommandForm(props) {
  var initial = props.initial
  var originalName = initial.originalName !== undefined ? initial.originalName : null
  var nameHooks = useState(initial.name || '')
  var name = nameHooks[0]
  var setName = nameHooks[1]
  var descHooks = useState(initial.description || '')
  var description = descHooks[0]
  var setDescription = descHooks[1]
  var hintHooks = useState(initial.inputHint || '')
  var inputHint = hintHooks[0]
  var setInputHint = hintHooks[1]
  var promptHooks = useState(initial.prompt || '')
  var prompt = promptHooks[0]
  var setPrompt = promptHooks[1]
  var imagesHooks = useState(initial.images === true)
  var images = imagesHooks[0]
  var setImages = imagesHooks[1]
  var enabledHooks = useState(initial.enabled !== false)
  var enabled = enabledHooks[0]
  var setEnabled = enabledHooks[1]

  return createElement('form', { className: 'form', onSubmit: function (e) { e.preventDefault() } },
    createElement('div', { className: 'grid2' },
      chField('名称', createElement('input', {
        type: 'text', className: 'input', value: name, placeholder: 'my-command',
        onChange: function (e) { setName(e.target.value) },
      }), '小写字母开头，可含数字、-、_。会话中输入 /名称 调用。'),
      chField('参数提示（可选）', createElement('input', {
        type: 'text', className: 'input', value: inputHint, placeholder: '例如 <file-path>',
        onChange: function (e) { setInputHint(e.target.value) },
      })),
    ),
    chField('描述', createElement('input', {
      type: 'text', className: 'input', value: description, placeholder: '这个命令做什么',
      onChange: function (e) { setDescription(e.target.value) },
    })),
    chField('提示词', createElement('textarea', {
      className: 'input', value: prompt, placeholder: '# 角色\n\n你要…\n\n当前请求：$ARGUMENTS',
      onChange: function (e) { setPrompt(e.target.value) },
    }), '发送给模型的提示词。$ARGUMENTS 会替换为用户输入；未使用占位符时输入会追加在末尾。'),
    createElement('div', { className: 'checks' },
      createElement('label', { className: 'check' },
        createElement('input', { type: 'checkbox', checked: enabled, onChange: function (e) { setEnabled(e.target.checked) } }),
        '启用',
      ),
      createElement('label', { className: 'check' },
        createElement('input', { type: 'checkbox', checked: images, onChange: function (e) { setImages(e.target.checked) } }),
        '接受图片附件',
      ),
    ),
    props.error ? createElement('div', { className: 'error-text' }, props.error) : null,
    createElement('div', { className: 'form-actions' },
      createElement('button', { type: 'button', className: 'btn', disabled: props.busy, onClick: props.onCancel }, '取消'),
      createElement('button', {
        type: 'button', className: 'btn primary', disabled: props.busy,
        onClick: function () {
          props.onSave({
            originalName: originalName,
            name: name,
            description: description,
            inputHint: inputHint,
            prompt: prompt,
            images: images,
            enabled: enabled,
          })
        },
      }, '保存'),
    ),
  )
}

/**
 * The 命令 tab: list + create/edit form + inline delete confirm.
 * @param props - { call }.
 * @returns the tab content element.
 */
function ChCommandsTab(props) {
  var call = props.call
  var listHooks = useState(null)
  var list = listHooks[0]
  var setList = listHooks[1]
  var busyHooks = useState(false)
  var busy = busyHooks[0]
  var setBusy = busyHooks[1]
  var errorHooks = useState('')
  var error = errorHooks[0]
  var setError = errorHooks[1]
  var noteHooks = useState('')
  var note = noteHooks[0]
  var setNote = noteHooks[1]
  var editingHooks = useState(null)
  var editing = editingHooks[0]
  var setEditing = editingHooks[1]
  var confirmHooks = useState(null)
  var confirming = confirmHooks[0]
  var setConfirming = confirmHooks[1]

  function load() {
    setBusy(true)
    call('commandHookAdmin/listCommands', {})
      .then(function (result) {
        setList(unwrap(result))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }
  useEffect(load, [])

  function act(promise, after) {
    setBusy(true)
    setError('')
    promise
      .then(function (result) {
        var value = unwrap(result)
        if (after) after(value)
        setList(value)
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }

  var commands = (list && list.commands) || []
  var commandsDir = (list && list.commandsDir) || ''

  return createElement('div', null,
    createElement('div', { className: 'toolbar' },
      createElement('span', { className: 'title' }, '提示词命令'),
      createElement('span', { className: 'count' }, String(commands.length)),
      createElement('span', { className: 'spacer' }),
      createElement('button', { className: 'btn', disabled: busy, onClick: load, 'aria-label': '刷新命令列表' }, '刷新'),
      createElement('button', { className: 'btn primary', disabled: busy || editing !== null, onClick: function () { setEditing({}) } }, '＋新建命令'),
    ),
    createElement('div', { className: 'hint' }, '存储于 ', createElement('span', { className: 'path-chip' }, commandsDir), ' · 保存后立即生效（含在其他窗口手动改文件）'),
    note ? createElement('div', { className: chNoticeClass(note) }, note) : null,
    error ? createElement('div', { className: 'error-text' }, error) : null,
    editing !== null
      ? createElement(ChCommandForm, {
        initial: editing,
        busy: busy,
        error: '',
        onCancel: function () { setEditing(null) },
        onSave: function (entry) {
          act(call('commandHookAdmin/saveCommand', { entry: entry }), function () {
            setEditing(null)
            setNote('命令 /' + entry.name + ' 已保存并注册。')
          })
        },
      })
      : null,
    commands.length === 0
      ? createElement('div', { className: 'empty' }, '还没有命令。点击「＋新建命令」创建一个，会话里输入 /名称 即可把提示词发给模型。')
      : createElement('div', { className: 'list' }, commands.map(function (c) {
        return createElement(ChCommandRow, {
          key: c.name,
          command: c,
          busy: busy || editing !== null,
          confirming: confirming === c.name,
          onCancelDelete: function () { setConfirming(null) },
          onConfirmDelete: function () {
            act(call('commandHookAdmin/deleteCommand', { name: c.name }), function () {
              setConfirming(null)
              setNote('命令 /' + c.name + ' 已删除。')
            })
          },
          onDelete: function () { setConfirming(c.name) },
          onEdit: function () { setEditing(Object.assign({ originalName: c.name }, c)) },
          onToggle: function () {
            act(call('commandHookAdmin/saveCommand', { entry: Object.assign({}, c, { enabled: !c.enabled }) }), function () {
              setNote('命令 /' + c.name + ' 已' + (c.enabled ? '停用' : '启用') + '。')
            })
          },
        })
      })),
  )
}

/**
 * One hook list row: event + matcher + command, toggle, edit, delete.
 * @param props - { hook, busy, onToggle, onEdit, onDelete, confirming, onConfirmDelete, onCancelDelete }.
 * @returns the row element.
 */
function ChHookRow(props) {
  var h = props.hook
  var actions = props.confirming
    ? [
      createElement('button', { className: 'btn sm danger', key: 'yes', disabled: props.busy, onClick: props.onConfirmDelete }, '确认删除'),
      createElement('button', { className: 'btn sm', key: 'no', disabled: props.busy, onClick: props.onCancelDelete }, '取消'),
    ]
    : [
      createElement('button', { className: 'btn sm', key: 'edit', disabled: props.busy, onClick: props.onEdit }, '编辑'),
      createElement('button', { className: 'btn sm danger', key: 'del', disabled: props.busy, 'aria-label': '删除钩子 ' + h.event, onClick: props.onDelete }, '删除'),
    ]
  return createElement('div', { className: 'row' + (h.enabled ? '' : ' off') },
    createElement('span', { className: 'tag event' }, h.event),
    createElement('div', { className: 'main' },
      createElement('div', { className: 'meta' },
        (h.matcher === '' ? '匹配全部' : '匹配 ' + h.matcher)
        + (h.timeoutSec !== null && h.timeoutSec !== undefined ? ' · 超时 ' + h.timeoutSec + 's' : ''),
      ),
      createElement('div', { className: 'desc mono' }, h.command),
    ),
    createElement('div', { className: 'actions' }, actions),
    chToggle(h.enabled, props.busy ? null : props.onToggle, (h.enabled ? '停用' : '启用') + '钩子 ' + h.event),
  )
}

/**
 * The hook create/edit form.
 * @param props - { initial, busy, error, onSave, onCancel }.
 * @returns the form element.
 */
function ChHookForm(props) {
  var initial = props.initial
  var id = initial.id !== undefined ? initial.id : null
  var eventHooks = useState(initial.event || 'PreToolUse')
  var event = eventHooks[0]
  var setEvent = eventHooks[1]
  var matcherHooks = useState(initial.matcher || '')
  var matcher = matcherHooks[0]
  var setMatcher = matcherHooks[1]
  var commandHooks = useState(initial.command || '')
  var command = commandHooks[0]
  var setCommand = commandHooks[1]
  var timeoutHooks = useState(initial.timeoutSec !== null && initial.timeoutSec !== undefined ? String(initial.timeoutSec) : '600')
  var timeoutSec = timeoutHooks[0]
  var setTimeoutSec = timeoutHooks[1]
  var enabledHooks = useState(initial.enabled !== false)
  var enabled = enabledHooks[0]
  var setEnabled = enabledHooks[1]

  return createElement('form', { className: 'form', onSubmit: function (e) { e.preventDefault() } },
    createElement('div', { className: 'grid2' },
      chField('事件', createElement('select', { className: 'input', value: event, onChange: function (e) { setEvent(e.target.value) } },
        CH_HOOK_EVENTS.map(function (name) {
          return createElement('option', { key: name, value: name }, name)
        }),
      )),
      chField('超时（秒）', createElement('input', {
        type: 'number', min: 1, className: 'input', value: timeoutSec,
        onChange: function (e) { setTimeoutSec(e.target.value) },
      }), '留空或 600 = 桥默认（10 分钟）。'),
    ),
    chField('匹配器', createElement('input', {
      type: 'text', className: 'input', value: matcher, placeholder: CH_MATCHERLESS[event] ? '（此事件忽略匹配器）' : 'write,edit 或正则；留空匹配全部',
      disabled: CH_MATCHERLESS[event] === true,
      onChange: function (e) { setMatcher(e.target.value) },
    }), CH_MATCHERLESS[event]
      ? 'UserPromptSubmit / Stop 没有匹配对象，桥会丢弃匹配器。'
      : '仅 PreToolUse / PostToolUse 有匹配对象（工具名，小写，如 write / edit，大小写敏感）。'),
    chField('命令', createElement('input', {
      type: 'text', className: 'input mono', value: command, placeholder: 'node C:/path/to/hook.js',
      onChange: function (e) { setCommand(e.target.value) },
    }), '钩子载荷以 JSON 从 stdin 传入；退出码 2 或输出 deny 阻止动作。'),
    createElement('label', { className: 'check' },
      createElement('input', { type: 'checkbox', checked: enabled, onChange: function (e) { setEnabled(e.target.checked) } }),
      '启用',
    ),
    props.error ? createElement('div', { className: 'error-text' }, props.error) : null,
    createElement('div', { className: 'form-actions' },
      createElement('button', { type: 'button', className: 'btn', disabled: props.busy, onClick: props.onCancel }, '取消'),
      createElement('button', {
        type: 'button', className: 'btn primary', disabled: props.busy,
        onClick: function () {
          props.onSave({
            ...(id !== null ? { id: id } : {}),
            event: event,
            matcher: matcher,
            command: command,
            timeoutSec: timeoutSec === '' ? null : timeoutSec,
            enabled: enabled,
          })
        },
      }, '保存'),
    ),
  )
}

/**
 * The 钩子 tab: bridge status banner (with one-click bridge install/uninstall)
 * + list + create/edit form.
 * @param props - { call }.
 * @returns the tab content element.
 */
function ChHooksTab(props) {
  var call = props.call
  var dataHooks = useState(null)
  var data = dataHooks[0]
  var setData = dataHooks[1]
  var busyHooks = useState(false)
  var busy = busyHooks[0]
  var setBusy = busyHooks[1]
  var errorHooks = useState('')
  var error = errorHooks[0]
  var setError = errorHooks[1]
  var noteHooks = useState('')
  var note = noteHooks[0]
  var setNote = noteHooks[1]
  var editingHooks = useState(null)
  var editing = editingHooks[0]
  var setEditing = editingHooks[1]
  var confirmHooks = useState(null)
  var confirming = confirmHooks[0]
  var setConfirming = confirmHooks[1]

  function load() {
    setBusy(true)
    call('commandHookAdmin/listHooks', {})
      .then(function (result) {
        setData(unwrap(result))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }
  useEffect(load, [])

  function act(promise, after) {
    setBusy(true)
    setError('')
    promise
      .then(function (result) {
        var value = unwrap(result)
        // `after` may return a note override — the default note derives from
        // the reload report, which bridge install/remove payloads don't carry.
        var noteOverride = after ? after(value) : undefined
        setData(value)
        var text = chReloadNote(value && value.reload)
        setNote(noteOverride !== undefined && noteOverride !== null
          ? noteOverride
          : (text !== null ? text : ''))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }

  var hooks = (data && data.hooks) || []
  var bridgeMounted = data !== null && data.bridgeMounted === true
  var bridgeInstalled = data !== null && data.bridgeInstalled === true
  var bridgeRowPresent = data !== null && data.bridgeRowPresent === true
  var bridgePackage = (data && data.bridgePackage) || '@deepseek-ai/dsh-hooks-claude-code'
  var bridgeMissing = !bridgeInstalled || !bridgeRowPresent
  var bridgeText
  if (bridgeMounted) {
    bridgeText = 'hooks 桥（hooks-claude-code）已挂载：保存 / 启停 / 删除后自动重启桥使配置生效（重启期间钩子有约一秒的空窗）。'
  } else if (bridgeInstalled && bridgeRowPresent) {
    bridgeText = 'hooks 桥已安装并写入 profile（configPath 指向 ' + ((data && data.hooksPath) || 'hooks.json') + '）：重启 dsh 后挂载生效。'
  } else {
    bridgeText = '当前未安装 hooks 桥（' + bridgePackage + '）：配置会写入 ' + ((data && data.hooksPath) || 'hooks.json') + '，安装并挂载后才会真正执行。'
  }

  function runBridgeInstall() {
    act(call('commandHookAdmin/bridgeInstall', {}), function (value) {
      return value && value.bridgeMounted
        ? 'hooks 桥已就绪。'
        : 'hooks 桥已安装并写入 profile，重启 dsh 后生效。'
    })
  }

  function runBridgeRemove() {
    act(call('commandHookAdmin/bridgeRemove', {}), function () {
      return 'hooks 桥已卸载：patch 行与依赖包均已移除（重启 dsh 后完全生效）。'
    })
  }

  return createElement('div', null,
    createElement('div', { className: 'toolbar' },
      createElement('span', { className: 'title' }, '钩子'),
      createElement('span', { className: 'count' }, String(hooks.length)),
      createElement('span', { className: 'spacer' }),
      createElement('button', { className: 'btn', disabled: busy, onClick: load, 'aria-label': '刷新钩子列表' }, '刷新'),
      createElement('button', { className: 'btn primary', disabled: busy || editing !== null, onClick: function () { setEditing({}) } }, '＋新建钩子'),
    ),
    createElement('div', {
      className: 'notice' + (bridgeMounted ? '' : ' warn'),
    },
      createElement('span', { className: 'notice-text' }, bridgeText),
      bridgeMissing
        ? createElement('button', {
          className: 'btn sm', disabled: busy || editing !== null,
          onClick: runBridgeInstall,
        }, busy ? '安装中…' : '⚡ 安装并挂载 hooks 桥')
        : null,
      (bridgeInstalled || bridgeRowPresent) && confirming === '__bridge__'
        ? createElement('span', { className: 'notice-actions', key: 'confirm' }, [
          createElement('button', {
            className: 'btn sm danger', key: 'yes', disabled: busy,
            onClick: runBridgeRemove,
          }, '确认卸载'),
          createElement('button', {
            className: 'btn sm', key: 'no', disabled: busy,
            onClick: function () { setConfirming(null) },
          }, '取消'),
        ])
        : ((bridgeInstalled || bridgeRowPresent)
          ? createElement('button', {
            className: 'btn sm danger', disabled: busy || editing !== null,
            'aria-label': '卸载 hooks 桥',
            onClick: function () { setConfirming('__bridge__') },
          }, '卸载桥')
          : null),
    ),
    error ? createElement('div', { className: 'error-text' }, error) : null,
    note !== '' && error === '' ? createElement('div', { className: chNoticeClass(note) }, note) : null,
    editing !== null
      ? createElement(ChHookForm, {
        initial: editing,
        busy: busy,
        error: '',
        onCancel: function () { setEditing(null) },
        onSave: function (entry) {
          act(call('commandHookAdmin/saveHook', { entry: entry }), function () { setEditing(null) })
        },
      })
      : null,
    hooks.length === 0
      ? createElement('div', { className: 'empty' }, '还没有钩子。钩子会在特定事件（工具调用前后、提交提示词、会话开始/结束等）自动执行命令。')
      : createElement('div', { className: 'list' }, hooks.map(function (h) {
        return createElement(ChHookRow, {
          key: h.id,
          hook: h,
          busy: busy || editing !== null,
          confirming: confirming === h.id,
          onCancelDelete: function () { setConfirming(null) },
          onConfirmDelete: function () {
            act(call('commandHookAdmin/deleteHook', { id: h.id }), function () { setConfirming(null) })
          },
          onDelete: function () { setConfirming(h.id) },
          onEdit: function () { setEditing(h) },
          onToggle: function () {
            act(call('commandHookAdmin/setHookEnabled', { id: h.id, enabled: !h.enabled }))
          },
        })
      })),
  )
}

/**
 * One read-only row in the project view.
 * @param props - { left, right, error } — label, value, optional load error.
 * @returns the row element.
 */
function ChProjectRow(props) {
  return createElement('div', { className: 'row', style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
    createElement('span', { style: { fontWeight: 600, whiteSpace: 'nowrap' } }, props.left),
    createElement('span', { className: 'path-chip', style: { whiteSpace: 'normal', wordBreak: 'break-all' } }, props.right),
    props.error ? createElement('span', { className: 'error-text' }, props.error) : null,
  )
}

/**
 * The 项目 tab: read-only view of one project's `.agents` directory — the
 * commands the scoped registry mounts, the hooks the project bridge runs,
 * and the skills native discovery already finds — selected by session or by
 * path, with per-file load errors surfaced.
 * @param props - { call }.
 * @returns the tab content element.
 */
function ChProjectTab(props) {
  var call = props.call
  var sessionsHooks = useState([])
  var sessions = sessionsHooks[0]
  var setSessions = sessionsHooks[1]
  var cwdHooks = useState('')
  var cwd = cwdHooks[0]
  var setCwd = cwdHooks[1]
  var viewHooks = useState(null)
  var view = viewHooks[0]
  var setView = viewHooks[1]
  var busyHooks = useState(false)
  var busy = busyHooks[0]
  var setBusy = busyHooks[1]
  var errorHooks = useState('')
  var error = errorHooks[0]
  var setError = errorHooks[1]

  useEffect(function () {
    call('sessionAdmin/list', {})
      .then(function (result) {
        var value = unwrap(result)
        setSessions((value && value.sessions) || [])
      })
      .catch(function () {})
  }, [])

  function load(path) {
    var target = typeof path === 'string' && path.trim() !== '' ? path : cwd
    if (target.trim() === '') return
    setBusy(true)
    setError('')
    call('projectAdmin/list', { cwd: target })
      .then(function (result) {
        setView(unwrap(result))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }

  var commands = (view && view.commands) || []
  var hooks = (view && view.hooks) || []
  var skills = (view && view.skills) || []
  var projectRoot = (view && view.projectRoot) || ''

  return createElement('div', null,
    createElement('div', { className: 'toolbar' },
      createElement('span', { className: 'title' }, '项目 (.agents)'),
      createElement('span', { className: 'spacer' }),
      createElement('button', {
        className: 'btn', disabled: busy || cwd.trim() === '', 'aria-label': '查看项目',
        onClick: function () { load(cwd) },
      }, '查看'),
    ),
    createElement('div', { className: 'hint' },
      '按会话或路径查看该项目 ', createElement('span', { className: 'path-chip' }, '.agents'), ' 的识别情况（只读）。'),
    createElement('div', { className: 'toolbar' },
      createElement('select', {
        'aria-label': '选择会话',
        style: { flex: '1', minWidth: '240px' },
        value: '',
        onChange: function (event) {
          var id = event.target.value
          var hit = sessions.find(function (s) { return s.id === id })
          if (hit && hit.cwd) {
            setCwd(hit.cwd)
            load(hit.cwd)
          }
        },
      },
      createElement('option', { value: '' }, '从历史会话选择…'),
      sessions.filter(function (s) { return s.cwd }).map(function (s) {
        return createElement('option', { key: s.id, value: s.id }, (s.title || '未命名会话') + ' · ' + s.cwd)
      })),
      createElement('input', {
        'aria-label': '项目路径',
        placeholder: '或直接粘贴项目内路径',
        value: cwd,
        onChange: function (event) { setCwd(event.target.value) },
        onKeyDown: function (event) { if (event.key === 'Enter') load(cwd) },
        style: { flex: '1', minWidth: '240px' },
      }),
    ),
    error ? createElement('div', { className: 'error-text' }, error) : null,
    view === null
      ? createElement('div', { className: 'empty' }, '选择会话或输入路径后查看。')
      : createElement('div', { className: 'list' },
        createElement('div', { className: 'hint' }, '项目根 ', createElement('span', { className: 'path-chip' }, projectRoot)),
        createElement('div', { className: 'title', style: { marginTop: '10px' } }, '命令（' + commands.length + '）'),
        commands.length === 0
          ? createElement('div', { className: 'empty' }, '没有 .agents/commands/*.md。')
          : commands.map(function (c) {
            return createElement(ChProjectRow, {
              key: 'cmd-' + c.name,
              left: '/' + c.name,
              right: c.description || '(未提供描述)',
              error: c.fileError || null,
            })
          }),
        createElement('div', { className: 'title', style: { marginTop: '10px' } },
          '钩子（' + hooks.length + '）',
          view.hooksSource ? createElement('span', { className: 'hint' }, ' · 来源 ' + view.hooksSource) : null),
        hooks.length === 0
          ? createElement('div', { className: 'empty' }, '没有 .agents/hooks.json，也没有 .agents/settings.json 的 hooks 键。')
          : hooks.map(function (h, index) {
            return createElement(ChProjectRow, {
              key: 'hook-' + index,
              left: h.event || '(配置错误)',
              right: [h.matcher, h.command, h.timeoutSec !== null && h.timeoutSec !== undefined ? h.timeoutSec + 's' : null]
                .filter(Boolean).join(' · '),
              error: h.error || null,
            })
          }),
        createElement('div', { className: 'title', style: { marginTop: '10px' } }, '技能（' + skills.length + '）'),
        skills.length === 0
          ? createElement('div', { className: 'empty' }, '没有 .agents/skills。')
          : createElement('div', { className: 'hint' },
            skills.map(function (s) { return s.name }).join('、'),
            ' — 技能由 dsh 原生发现，模型经 skill 工具调用。'),
      ),
  )
}

/**
 * The 「命令与钩子」 settings section: three tabs over the two stores plus the
 * project `.agents` read-only view.
 * @param props - renderer-bound props; `call` arrives from the slot inject face.
 * @returns the section element.
 */
function CommandHookSection(props) {
  var call = props.call
  var tabHooks = useState('commands')
  var tab = tabHooks[0]
  var setTab = tabHooks[1]
  return createElement('div', { 'data-cha-section': '' },
    createElement('div', { className: 'tabs', role: 'tablist', 'aria-label': '命令与钩子' },
      createElement('button', {
        type: 'button', role: 'tab', key: 'commands',
        className: 'tab' + (tab === 'commands' ? ' active' : ''),
        'aria-selected': tab === 'commands' ? 'true' : 'false',
        onClick: function () { setTab('commands') },
      }, '命令'),
      createElement('button', {
        type: 'button', role: 'tab', key: 'hooks',
        className: 'tab' + (tab === 'hooks' ? ' active' : ''),
        'aria-selected': tab === 'hooks' ? 'true' : 'false',
        onClick: function () { setTab('hooks') },
      }, '钩子'),
      createElement('button', {
        type: 'button', role: 'tab', key: 'project',
        className: 'tab' + (tab === 'project' ? ' active' : ''),
        'aria-selected': tab === 'project' ? 'true' : 'false',
        onClick: function () { setTab('project') },
      }, '项目'),
    ),
    tab === 'commands' ? createElement(ChCommandsTab, { call: call, key: 'commands' }) : null,
    tab === 'hooks' ? createElement(ChHooksTab, { call: call, key: 'hooks' }) : null,
    tab === 'project' ? createElement(ChProjectTab, { call: call, key: 'project' }) : null,
  )
}

/* ========================================================================== */
/*                          Todo Dock (待办清单)                              */
/* ========================================================================== */

// Live todo strip above the composer, mounted through the shell's
// 'conversation.input.dock' slot. Data comes entirely from the framework:
// every session-scope slot component receives the useProjection standard-kit
// hook, and 'todos' is the host-computed whole-list projection the agent's
// todo_write tool drives — so the panel is real-time with zero host state of
// its own. The footer's file-change segment polls sessionAdmin/fileStats,
// which folds the session log's tool/result diff metadata (same counting
// rules as the shell's diff card: old-side lines = removed, new-side =
// added, files = distinct paths).
//
// The shell (>= the version shipping ui-conversation's TodoPanel) renders its
// own collapsed todo strip in this same slot; while our expanded panel has
// data to show, a body class hides that strip to avoid two lists of the same
// todos stacked. Hooked on its data-testid, so a renamed future shell simply
// means both render — degraded, never broken.

var TODO_CSS_TAG = 'dsh-plugin-admin/todo-dock.css'

// Dock alignment copies the shell TodoPanel root's own recipe (composer
// side-clearance + dock inset against the card max-width) so the strip sits
// exactly as wide as the composer card it floats above. Each var() carries a
// neutral fallback (0px / 100%) so older shells without the variables simply
// fall back to full-width instead of a wrong guess.
var TODO_CSS_TEXT = [
  // Stock-strip suppression: only active while this panel is mounted with data.
  'body.dsh-admin-todo-live [data-testid="todo-panel"] { display: none !important; }',
  '[data-dsh-admin-todo] { display: flex; flex-direction: column; width: calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px)); max-width: calc(var(--dsh-composer-card-max-width, 100%) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px)); margin: 0 auto; border: 1px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-subtle, rgba(200,200,210,0.4))); border-radius: 12px; background: var(--dsw-specific-tip, var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, transparent))); box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #222); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, var(--dsw-alias-border-subtle, rgba(200,200,210,0.4))); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, var(--dsw-alias-label-tertiary, rgba(180,180,195,0.6))); }',
  '[data-dsh-admin-todo] * { box-sizing: border-box; }',
  '[data-dsh-admin-todo] .todo-list { list-style: none; margin: 0; padding: 8px 14px 4px 14px; display: flex; flex-direction: column; gap: 2px; max-height: 224px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent; }',
  '[data-dsh-admin-todo] .todo-list::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-todo] .todo-list::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsh-scrollbar-thumb); }',
  '[data-dsh-admin-todo] .todo-item { display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 3px 0; border-radius: 6px; }',
  '[data-dsh-admin-todo] .todo-glyph { width: 16px; height: 16px; flex: none; display: grid; place-items: center; margin-top: 2px; color: var(--dsw-alias-label-tertiary, #888); }',
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-glyph { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-glyph svg { animation: dsh-admin-spin 0.9s linear infinite; }',
  '[data-dsh-admin-todo] .todo-item[data-status="completed"] .todo-glyph { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-text { min-width: 0; word-break: break-word; color: var(--dsw-alias-label-primary, #222); }',
  '[data-dsh-admin-todo] .todo-item[data-status="in_progress"] .todo-text { font-weight: 500; }',
  '[data-dsh-admin-todo] .todo-item[data-status="completed"] .todo-text { text-decoration: line-through; color: var(--dsw-alias-label-tertiary, #888); }',
  '[data-dsh-admin-todo] .todo-item[data-status="pending"] .todo-text { color: var(--dsw-alias-label-secondary, #555); }',
  // File-change section: compact monospace rows, git-status letter badges.
  '[data-dsh-admin-todo] .todo-files { display: flex; flex-direction: column; margin: 4px 14px 0 14px; padding: 4px 0 5px 0; border-top: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.35)); max-height: 140px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent; }',
  '[data-dsh-admin-todo] .todo-files::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-todo] .todo-files::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsh-scrollbar-thumb); }',
  '[data-dsh-admin-todo] .todo-file { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 1.5px 0; font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-todo] .todo-file .st { flex: none; width: 14px; text-align: center; font-weight: 700; }',
  '[data-dsh-admin-todo] .todo-file[data-st="M"] .st { color: var(--dsw-static-blue-500, #3b82f6); }',
  '[data-dsh-admin-todo] .todo-file[data-st="A"] .st, [data-dsh-admin-todo] .todo-file[data-st="?"] .st { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-file[data-st="D"] .st { color: var(--dsw-alias-state-error-primary, #dc2626); }',
  '[data-dsh-admin-todo] .todo-file[data-st="R"] .st { color: var(--dsw-static-amber-500, #d97706); }',
  '[data-dsh-admin-todo] .todo-file .p { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: ltr; }',
  '[data-dsh-admin-todo] .todo-file .p:hover { white-space: normal; word-break: break-all; }',
  '[data-dsh-admin-todo] .todo-file .n { flex: none; font-variant-numeric: tabular-nums; }',
  '[data-dsh-admin-todo] .todo-file .n .a { color: var(--dsw-alias-state-success-primary, #16a34a); }',
  '[data-dsh-admin-todo] .todo-file .n .d { color: var(--dsw-alias-state-error-primary, #dc2626); margin-left: 5px; }',
  '[data-dsh-admin-todo] .todo-file .n .zero { opacity: 0.45; }',
  // Footer: step counts left, change totals + collapse chevron right.
  '[data-dsh-admin-todo] .todo-footer { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 14px; border: 0; border-top: 1px solid var(--dsw-alias-border-subtle, rgba(200,200,210,0.35)); background: transparent; cursor: pointer; font: inherit; font-size: 12px; color: var(--dsw-alias-label-tertiary, #888); text-align: left; }',
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

/** Completed: filled check disc (green via the glyph cell's currentColor). */
function TodoAdminCompletedGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 6.4, stroke: 'currentColor', strokeWidth: 1.2 }),
    createElement('path', { d: 'M4.2 7.2L6.1 9.1L9.9 4.9', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

/** In-progress: gradient ring spun by the glyph cell's CSS animation. */
function TodoAdminProgressGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 5.6, stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeDasharray: '24 12' }),
  )
}

/** Pending: dashed unstarted ring. */
function TodoAdminPendingGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 6.4, stroke: 'currentColor', strokeWidth: 1.2, strokeDasharray: '2.4 2.4' }),
  )
}

function TodoAdminStatusGlyph(status) {
  if (status === 'completed') return createElement(TodoAdminCompletedGlyph, { key: 'g' })
  if (status === 'in_progress') return createElement(TodoAdminProgressGlyph, { key: 'g' })
  return createElement(TodoAdminPendingGlyph, { key: 'g' })
}

/**
 * Derive the footer's 「第 X / Y 步」 from the list itself: the first
 * in_progress item's position, or the total once everything settled.
 */
function todoAdminStep(list) {
  var total = list.length
  var completed = 0
  var activeIndex = -1
  for (var i = 0; i < total; i++) {
    var status = list[i] && list[i].status
    if (status === 'completed') completed++
    else if (status === 'in_progress' && activeIndex === -1) activeIndex = i
  }
  var current = activeIndex >= 0 ? activeIndex + 1 : (completed >= total ? total : completed + 1)
  return { current: current, total: total }
}

/** The file row's status letter, sanitized to the five renderable kinds. */
function todoAdminStatusLetter(status) {
  return status === 'M' || status === 'A' || status === 'D' || status === 'R' || status === '?' ? status : 'M'
}

/** One git-status file row: colored letter, ellipsized path, +/- deltas. */
function TodoAdminFileRow(item, index) {
  var st = todoAdminStatusLetter(item.status)
  var path = typeof item.path === 'string' && item.path !== '' ? item.path : '（未知路径）'
  var added = typeof item.added === 'number' && item.added > 0 ? item.added : 0
  var removed = typeof item.removed === 'number' && item.removed > 0 ? item.removed : 0
  var nums = [
    createElement('span', { key: 'a', className: 'a' + (added === 0 ? ' zero' : '') }, '+' + added),
    createElement('span', { key: 'd', className: 'd' + (removed === 0 ? ' zero' : '') }, '-' + removed),
  ]
  return createElement('div', { key: index, className: 'todo-file', 'data-st': st, title: path },
    createElement('span', { className: 'st', 'aria-hidden': 'true' }, st === '?' ? '?' : st),
    createElement('span', { className: 'p' }, path),
    createElement('span', { className: 'n' }, nums),
  )
}

/** Render the todo dock: todo rows, the git file-change section, footer. */
function TodoAdminRender(list, stats, collapsed, toggle) {
  var children = []
  if (!collapsed) {
    var items = []
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {}
      items.push(createElement('li', {
        key: i,
        className: 'todo-item',
        'data-status': typeof item.status === 'string' ? item.status : 'pending',
      },
      createElement('span', { className: 'todo-glyph', 'aria-hidden': 'true' }, TodoAdminStatusGlyph(item.status)),
      createElement('span', { className: 'todo-text' }, typeof item.content === 'string' ? item.content : ''),
      ))
    }
    children.push(createElement('ul', { key: 'list', className: 'todo-list' }, items))
    var changed = stats !== null && Array.isArray(stats.changed) ? stats.changed : []
    if (changed.length > 0) {
      var rows = []
      for (var f = 0; f < changed.length; f++) rows.push(TodoAdminFileRow(changed[f], f))
      children.push(createElement('div', { key: 'files', className: 'todo-files' }, rows))
    }
  }

  var steps = todoAdminStep(list)
  var hasStats = stats !== null && stats.files > 0
  var statsParts = []
  if (hasStats) {
    statsParts.push(createElement('span', { key: 'files' }, stats.files + ' 个文件已改'))
    statsParts.push(createElement('span', { key: 'add', className: 'num-add' }, '+' + stats.added))
    statsParts.push(createElement('span', { key: 'del', className: 'num-del' }, '-' + stats.removed))
  }
  statsParts.push(createElement('span', { key: 'chevron', className: 'todo-chevron', 'aria-hidden': 'true' }, collapsed ? '▲' : '▼'))
  children.push(createElement('button', {
    type: 'button',
    key: 'footer',
    className: 'todo-footer',
    'aria-expanded': collapsed ? 'false' : 'true',
    onClick: toggle,
  },
  createElement('span', { key: 'steps', className: 'todo-steps' }, '第 ' + steps.current + ' / ' + steps.total + ' 步'),
  createElement('span', { key: 'stats', className: 'todo-stats' }, statsParts),
  ))
  return createElement('section', {
    'data-dsh-admin-todo': '',
    'aria-label': '待办清单',
  }, children)
}

/**
 * The dock entry component. Framework props: useProjection (session
 * standard kit) — everything else arrives via the registration's inject.
 */
function TodoAdminDock(props) {
  var useProjection = props.useProjection
  // The projection hook is part of the standard kit seat; call it
  // unconditionally at the top so hook order stays stable across renders.
  var todos = typeof useProjection === 'function' ? useProjection('todos') : null
  var list = Array.isArray(todos) ? todos : []
  var show = list.length > 0

  var collapsedState = useState(false)
  var collapsed = collapsedState[0]
  var setCollapsed = collapsedState[1]

  var statsState = useState(null)
  var stats = statsState[0]
  var setStats = statsState[1]

  // Hide the shell's own collapsed todo strip while we are showing the same
  // list expanded; the moment we render nothing, make sure the strip is back.
  useEffect(function () {
    if (show) document.body.classList.add('dsh-admin-todo-live')
    else document.body.classList.remove('dsh-admin-todo-live')
    return function () { document.body.classList.remove('dsh-admin-todo-live') }
  }, [show])

  // Poll the folded file-change stats at a gentle cadence while visible;
  // sessionAdmin/fileStats never throws for unknown sessions, and a failed
  // poll just keeps the previous value.
  var sessionId = props.sessionId
  var call = props.call
  useEffect(function () {
    if (!show || !sessionId || typeof call !== 'function') return undefined
    var disposed = false
    var tick = function () {
      call('sessionAdmin/fileStats', { sessionId: sessionId }).then(function (res) {
        var value = res && res.ok && res.value && typeof res.value === 'object' ? res.value : null
        if (disposed || value === null) return
        setStats(function (prev) {
          if (prev && prev.files === value.files && prev.added === value.added && prev.removed === value.removed) return prev
          return {
            files: value.files,
            added: value.added,
            removed: value.removed,
            changed: Array.isArray(value.changed) ? value.changed : [],
          }
        })
      }).catch(function () {})
    }
    tick()
    var timer = setInterval(tick, 4000)
    return function () { disposed = true; clearInterval(timer) }
  }, [show, sessionId, call])

  if (!show) return null

  return TodoAdminRender(list, stats, collapsed, function () {
    setCollapsed(function (v) { return !v })
  })
}

/* ========================================================================== */
/*                             Plugin Entrypoint                              */
/* ========================================================================== */

function apply(ctx) {
  injectStyles()
  injectSaStyles()
  injectChStyles()
  injectTodoStyles()

  var call = function (method, args) {
    return ctx.connection.rpc.call('/api', method, { args: args })
  }

  // Sidebar right-click menus: delete session (after archive) on session
  // rows, reveal in explorer on workspace rows. Mounted once for the page
  // lifetime; dispose when the plugin unmounts.
  // The sessions service lets us nudge the sidebar list after a delete so
  // the removed session disappears immediately instead of lingering in
  // "未分组" until the next reload.
  var refreshSessions = null
  try {
    var sessionsSvc = ctx.get && ctx.get('sessions')
    if (sessionsSvc && typeof sessionsSvc.refresh === 'function') {
      refreshSessions = function () { sessionsSvc.refresh().catch(function () {}) }
    }
  } catch (e) { refreshSessions = null }
  var disposeSidebar = ctx.effect(function () { return setupMenuInjection(call, refreshSessions) })

  // Five surfaces, each parked where the shell already renders its domain.
  // 插件管理 joins the shell-owned 插件 section as its third tab (插件配置 0,
  // 插件列表 10, 扩展插件 20); MCP / 子智能体 / 命令与钩子 / 历史会话 become
  // standalone settings pages (MCP服务器 takes the 25 slot right after Agent
  // 预设, 子智能体 follows at 26, 命令与钩子 at 27, 历史会话 sorts last).
  // inject() waits on each slot's declaration, so registration order never
  // matters.
  ctx.slots.inject('settings.plugins.tab', function () {
    return ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'extensions',
      order: 20,
      label: '扩展插件',
      inject: function () { return { call: call } },
    }, PluginsSection)
  })
  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register({
      name: 'settings.section',
      id: 'mcp-servers',
      order: 25,
      label: 'MCP服务器',
      inject: function () { return { call: call } },
    }, McpSection)
  })
  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register({
      name: 'settings.section',
      id: 'session-history',
      order: 100,
      label: '历史会话',
      inject: function () { return { call: call, refreshSessions: refreshSessions } },
    }, SessionsSection)
  })
  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register({
      name: 'settings.section',
      id: 'subagent-admin',
      order: 26,
      label: '子智能体',
      inject: function () { return { call: call } },
    }, SubagentAdminSection)
  })
  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register({
      name: 'settings.section',
      id: 'command-hook-admin',
      order: 27,
      label: '命令与钩子',
      inject: function () { return { call: call } },
    }, CommandHookSection)
  })

  // 待办清单: live todo strip above the composer. The framework hands every
  // session-scope slot entry the useProjection standard-kit hook, so the
  // component reads the host-computed 'todos' projection directly — no
  // polling for the list itself (the footer's file stats do poll). order 5
  // sits just after the shell's own todo strip (order 0), which this panel
  // hides while it has data; inject() is a no-op if this slot key is absent
  // in older shells.
  ctx.slots.inject('conversation.input.dock', function () {
    return ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'todo-admin',
      order: 5,
      inject: function () { return { call: call } },
    }, TodoAdminDock)
  })
}

module.exports = { apply: apply, inject: ['slots', 'connection'] }
return module.exports
} });

