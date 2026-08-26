window.__ModuleLoader__.load({ id: 'dsh-plugin-admin', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/**
 * dsh-plugin-admin browser half: unified "管理中心" (插件管理 & 会话管理)
 * page inside the settings panel.
 *
 * The page rides the shell's `settings.section` slot (the shell owns
 * the dialog chrome, navigation, and close); its component is assembled with
 * the platform-shared React (module-table seed word, same instance the shell
 * renders with), providing a tabbed modern UI to manage both profile plugin
 * layers and session lifecycles over the /api RPC gateway.
 */

var React = require('react')
var createElement = React.createElement
var useState = React.useState
var useRef = React.useRef
var useEffect = React.useEffect

var CSS_TEXT = [
  '@keyframes dsh-admin-spin { to { transform: rotate(360deg); } }',
  '@keyframes dsh-admin-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.85); } }',
  '[data-dsh-admin-section] { display: flex; flex-direction: column; width: 100%; gap: 14px; padding: 2px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, #0f1115); max-height: calc(100vh - 140px); overflow: hidden; }',
  '[data-dsh-admin-section] * { box-sizing: border-box; }',
  '[data-dsh-admin-section] .tabs { display: flex; padding: 3px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.08)); gap: 3px; }',
  '[data-dsh-admin-section] .tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 7px 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, #666); transition: all 0.15s ease; font-family: inherit; }',
  '[data-dsh-admin-section] .tab:hover:not(.active) { color: var(--dsw-alias-label-primary, #111); background: rgba(0,0,0,0.02); }',
  '[data-dsh-admin-section] .tab.active { background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #111); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04); }',
  '[data-dsh-admin-section] .tab-count { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, #e5e7eb); color: var(--dsw-alias-label-secondary, #555); }',
  '[data-dsh-admin-section] .tab.active .tab-count { background: var(--dsw-alias-button-primary-fill, #1677ff); color: var(--dsw-alias-label-primary-foreground, #fff); }',
  '[data-dsh-admin-section] .toolbar { display: flex; gap: 8px; align-items: center; padding: 10px; border: 1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.08)); border-radius: 12px; background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 1px 2px rgba(0,0,0,0.02); }',
  '[data-dsh-admin-section] .search-wrap { flex: 1.6; min-width: 0; position: relative; display: flex; align-items: center; }',
  '[data-dsh-admin-section] .search-wrap .input { flex: 1; min-width: 0; padding-left: 30px; }',
  '[data-dsh-admin-section] .session-search { flex: 1; }',
  '[data-dsh-admin-section] .install-wrap { flex: 1; min-width: 0; display: flex; align-items: center; }',
  '[data-dsh-admin-section] .install-wrap .input { flex: 1; min-width: 0; }',
  '[data-dsh-admin-section] .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; opacity: 0.7; pointer-events: none; z-index: 1; }',
  '[data-dsh-admin-section] .input { width: 100%; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.12)); background: var(--dsw-alias-bg-base, #fff); color: inherit; font: inherit; outline: none; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; }',
  '[data-dsh-admin-section] .input:hover { border-color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.28)); }',
  '[data-dsh-admin-section] .input:focus { border-color: var(--dsw-alias-button-primary-fill, #1677ff); box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.14); }',
  '[data-dsh-admin-section] .filter-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }',
  '[data-dsh-admin-section] .pill { font-size: 11px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.1)); background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #666); transition: all 0.12s; font-family: inherit; }',
  '[data-dsh-admin-section] .pill:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }',
  '[data-dsh-admin-section] .pill.active { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); color: var(--dsw-alias-button-primary-fill, #1677ff); font-weight: 600; border-color: currentColor; }',
  '[data-dsh-admin-section] .btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease; border: 1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.1)); background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-secondary, #4b5563); white-space: nowrap; flex: none; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }',
  '[data-dsh-admin-section] .btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)); border-color: var(--dsw-alias-label-tertiary, rgba(0,0,0,0.22)); color: var(--dsw-alias-label-primary, #111827); box-shadow: 0 2px 4px rgba(0,0,0,0.06); }',
  '[data-dsh-admin-section] .search-wrap .btn.sm { background: transparent; border: none; box-shadow: none; padding: 2px 6px; color: var(--dsw-alias-label-tertiary, #888); }',
  '[data-dsh-admin-section] .search-wrap .btn.sm:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); color: var(--dsw-alias-label-primary, #111); }',
  '[data-dsh-admin-section] .btn:active:not(:disabled) { transform: translateY(1px); }',
  '[data-dsh-admin-section] .btn:focus-visible, [data-dsh-admin-section] .pill:focus-visible { outline: 2px solid var(--dsw-alias-button-primary-fill, #1677ff); outline-offset: 2px; }',
  '[data-dsh-admin-section] .btn:disabled { opacity: 0.45; cursor: not-allowed; }',
  '[data-dsh-admin-section] .btn.primary { background: var(--dsw-alias-button-primary-fill, #1677ff); color: var(--dsw-alias-label-primary-foreground, #fff); border-color: transparent; font-weight: 600; }',
  '[data-dsh-admin-section] .btn.primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, #4096ff); }',
  '[data-dsh-admin-section] .btn.danger { color: var(--dsw-alias-state-error-primary, #ef4444); border-color: var(--dsw-alias-border-subtle, rgba(0,0,0,0.12)); }',
  '[data-dsh-admin-section] .btn.danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.1)); }',
  '[data-dsh-admin-section] .btn.danger-solid { background: var(--dsw-alias-state-error-primary, #ef4444); color: #fff; border-color: transparent; }',
  '[data-dsh-admin-section] .btn.danger-solid:hover:not(:disabled) { opacity: 0.9; }',
  '[data-dsh-admin-section] .btn.sm { padding: 3px 8px; font-size: 11px; border-radius: 6px; }',
  '[data-dsh-admin-section] .spinner { width: 12px; height: 12px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: dsh-admin-spin 0.7s linear infinite; display: inline-block; flex: none; }',
  '[data-dsh-admin-section] .list { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; max-height: 560px; overflow-y: auto; padding: 2px 4px 2px 2px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-subtle, rgba(0,0,0,0.2)) transparent; }',
  '[data-dsh-admin-section] .list::-webkit-scrollbar { width: 6px; }',
  '[data-dsh-admin-section] .list::-webkit-scrollbar-thumb { border-radius: 99px; background: var(--dsw-alias-border-subtle, rgba(0,0,0,0.2)); }',
  '[data-dsh-admin-section] .session-group { display: flex; flex-direction: column; gap: 6px; }',
  '[data-dsh-admin-section] .group-header { display: flex; align-items: center; gap: 8px; padding: 10px 4px 4px 4px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); border-bottom: 1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.08)); }',
  '[data-dsh-admin-section] .group-header:first-child { padding-top: 4px; }',
  '[data-dsh-admin-section] .group-title { display: inline-flex; align-items: center; gap: 6px; }',
  '[data-dsh-admin-section] .group-count { font-size: 10px; padding: 1px 7px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)); color: var(--dsw-alias-label-secondary, #555); font-weight: 500; }',
  '[data-dsh-admin-section] .group-path { font-family: monospace; font-size: 10px; color: var(--dsw-alias-label-tertiary, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; text-align: right; }',
  '[data-dsh-admin-section] .card { display: flex; flex-direction: column; gap: 7px; padding: 12px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.08)); background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }',
  '[data-dsh-admin-section] .card:hover { transform: translateY(-1px); border-color: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.3)); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }',
  '[data-dsh-admin-section] .card-header { display: flex; align-items: center; gap: 8px; min-width: 0; }',
  '[data-dsh-admin-section] .card-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; }',
  '[data-dsh-admin-section] .card-title-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }',
  '[data-dsh-admin-section] .card-summary { display: flex; align-items: flex-start; gap: 6px; padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.025)); border-left: 2px solid var(--dsw-alias-button-primary-fill, #1677ff); font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary, #555); margin-top: 1px; margin-bottom: 1px; }',
  '[data-dsh-admin-section] .summary-icon { font-size: 11px; line-height: 1.45; flex: none; opacity: 0.85; }',
  '[data-dsh-admin-section] .summary-text { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; }',
  '[data-dsh-admin-section] .card-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #666); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
  '[data-dsh-admin-section] .card-sub-item { display: inline-flex; align-items: center; gap: 3px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-dsh-admin-section] .card-actions { display: flex; gap: 5px; align-items: center; flex: none; }',
  '[data-dsh-admin-section] .tag { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; flex: none; display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); color: var(--dsw-alias-label-secondary, #666); }',
  '[data-dsh-admin-section] .tag.plugin { background: rgba(16, 185, 129, 0.12); color: var(--dsw-alias-state-success-primary, #10b981); }',
  '[data-dsh-admin-section] .tag.local { background: rgba(59, 130, 246, 0.1); color: var(--dsw-alias-button-primary-fill, #1677ff); }',
  '[data-dsh-admin-section] .tag.update { background: rgba(245, 158, 11, 0.14); color: #d97706; font-weight: 600; border: 1px solid rgba(217, 119, 6, 0.25); }',
  '[data-dsh-admin-section] .tag.update-error { background: rgba(239, 68, 68, 0.1); color: var(--dsw-alias-state-error-primary, #ef4444); }',
  '[data-dsh-admin-section] .plugin-path { font-family: monospace; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #666); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 4px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.025)); }',
  '[data-dsh-admin-section] .tag.version { font-family: monospace; }',
  '[data-dsh-admin-section] .tag.live { background: rgba(16, 185, 129, 0.12); color: var(--dsw-alias-state-success-primary, #10b981); font-weight: 600; }',
  '[data-dsh-admin-section] .tag.archived { background: rgba(245, 158, 11, 0.12); color: var(--dsw-alias-state-warn-label, #f59e0b); }',
  '[data-dsh-admin-section] .tag.turns { background: rgba(59, 130, 246, 0.1); color: var(--dsw-alias-button-primary-fill, #1677ff); font-weight: 500; }',
  '[data-dsh-admin-section] .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary, #999); }',
  '[data-dsh-admin-section] .dot.live { background: var(--dsw-alias-state-success-primary, #10b981); box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.25); animation: dsh-admin-pulse 2s infinite ease-in-out; }',
  '[data-dsh-admin-section] .dot.archived { background: var(--dsw-alias-state-warn-label, #f59e0b); }',
  '[data-dsh-admin-section] .confirm-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); border: 1px solid rgba(239,68,68,0.2); }',
  '[data-dsh-admin-section] .confirm-text { font-size: 11px; color: var(--dsw-alias-state-error-primary, #ef4444); font-weight: 500; }',
  '[data-dsh-admin-section] .confirm-actions { display: flex; gap: 5px; flex: none; }',
  '[data-dsh-admin-section] .busy-banner { display: flex; align-items: center; gap: 8px; padding: 7px 11px; border-radius: 7px; background: rgba(22, 119, 255, 0.08); color: var(--dsw-alias-button-primary-fill, #1677ff); font-size: 11px; }',
  '[data-dsh-admin-section] .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 12px; color: var(--dsw-alias-label-tertiary, #999); gap: 4px; font-size: 12px; text-align: center; }',
  '[data-dsh-admin-section] .error { padding: 7px 11px; border-radius: 7px; color: var(--dsw-alias-state-error-primary, #ef4444); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239,68,68,0.08)); font-size: 12px; white-space: pre-wrap; max-height: 100px; overflow-y: auto; }',
  '[data-dsh-admin-section] .footer { display: flex; justify-content: space-between; align-items: center; padding-top: 4px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #888); border-top: 1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.06)); flex: none; }',
  '[data-dsh-admin-section] .footer .path { max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '[data-dsh-admin-section] .footer .hint { font-style: normal; }',
  '[data-dsh-admin-section] .session-id-badge { font-family: monospace; font-size: 10px; opacity: 0.75; }',
  '[data-dsh-admin-section] .mcp-test-row { padding: 6px 9px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.025)); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }',
  '[data-dsh-admin-section] .mcp-test { display: inline-flex; align-items: center; gap: 5px; }',
  '[data-dsh-admin-section] .mcp-test.mcp-test-list { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }',
  '[data-dsh-admin-section] .mcp-test-busy { color: var(--dsw-alias-label-secondary, #666); }',
  '[data-dsh-admin-section] .mcp-test-ok { color: #16a34a; }',
  '[data-dsh-admin-section] .mcp-test-fail { color: var(--dsw-alias-state-error-primary, #ef4444); }',
  '[data-dsh-admin-section] .mcp-test-warn { color: #d97706; opacity: 0.95; }',
  '@media (max-width: 520px) { [data-dsh-admin-section] { gap: 10px; } [data-dsh-admin-section] .toolbar { align-items: stretch; flex-wrap: wrap; padding: 8px; } [data-dsh-admin-section] .toolbar .input-wrap { flex-basis: 100%; } [data-dsh-admin-section] .card-header { align-items: flex-start; } [data-dsh-admin-section] .card-actions { flex-wrap: wrap; justify-content: flex-end; } [data-dsh-admin-section] .footer { gap: 6px; align-items: flex-start; flex-direction: column; } [data-dsh-admin-section] .footer .path { max-width: 100%; } }',
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

/**
 * Show a floating toast notification at the top of the viewport.
 * Auto-dismisses after `duration` ms. Supports 'success', 'error', 'info'.
 */
function showToast(type, text, duration) {
  if (typeof document === 'undefined') return
  duration = duration || 3000
  var toast = document.createElement('div')
  toast.className = 'dsh-admin-toast ' + type
  toast.textContent = text
  document.body.appendChild(toast)

  var timer = setTimeout(function () {
    toast.classList.add('leaving')
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast)
    }, 200)
  }, duration)

  toast.addEventListener('click', function () {
    clearTimeout(timer)
    if (!toast.classList.contains('leaving')) {
      toast.classList.add('leaving')
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast)
      }, 200)
    }
  })
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
            showToast('error', '❌ 存在 ' + String(exact.length) + ' 个同名会话，无法确定要删除的目标；请在 设置 → 管理中心 → 会话管理 中按会话 ID 删除')
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
    sep.style.cssText = 'margin:3px 0;border-top:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,0.08))'
    viewport.appendChild(sep)

    var btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('role', 'menuitem')
    btn.setAttribute('data-dsh-admin-injected', '')
    btn.textContent = label
    var color = kind === 'danger' ? '#ef4444' : 'inherit'
    var hoverBg = kind === 'danger' ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.06)'
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
 * Plugins management settings section (standalone, no internal tabs).
 */
function PluginsSection(props) {
  var pairPlugins = useState({
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
    updates: {}, // name -> { latest, updateAvailable, error? }
  })
  var pView = pairPlugins[0]
  var setPView = pairPlugins[1]

  var alive = useRef(false)

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

  function reloadPlugins() {
    patchPlugin({ busy: true, error: '', note: '' })
    callRemote('pluginAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patchPlugin({
          busy: false,
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
        })
      } else {
        patchPlugin({ busy: false, error: '加载插件失败：' + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchPlugin({ busy: false, error: '调用失败：' + messageOf(failure) })
    })
  }

  /**
   * Query the npm registry for newer versions of registry-installed bundles
   * and stash per-plugin results. Runs concurrently with the list so the
   * panel stays responsive; failures are per-plugin, never fatal.
   */
  function checkUpdates() {
    if (pView.checkingUpdates) return
    patchPlugin({ checkingUpdates: true, note: '' })
    callRemote('pluginAdmin/checkUpdates', {}).then(function (result) {
      if (!alive.current) return
      patchPlugin({ checkingUpdates: false })
      if (!result.ok) {
        patchPlugin({ error: '检查更新失败：' + messageOf(result.error) })
        return
      }
      var list = (result.value && result.value.updates) || []
      var map = {}
      var updateCount = 0
      for (var i = 0; i < list.length; i++) {
        var u = list[i]
        map[u.name] = { latest: u.latest, updateAvailable: u.updateAvailable === true, error: u.error || '' }
        if (u.updateAvailable === true) updateCount++
      }
      var updated = map
      patchPlugin({
        updates: updated,
        note: updateCount > 0
          ? '发现 ' + updateCount + ' 个插件有新版本'
          : (list.length > 0 ? '已检查 ' + list.length + ' 个插件，均为最新版本' : ''),
      })
    }, function (failure) {
      if (!alive.current) return
      patchPlugin({ checkingUpdates: false, error: '检查更新调用失败：' + messageOf(failure) })
    })
  }

  /** Upgrade one plugin to its latest version (registry install by name). */
  function upgradePlugin(name) {
    if (pView.busy) return
    var spec = name + '@latest'
    patchPlugin({ busy: true, error: '', confirming: null, note: '' })
    callRemote('pluginAdmin/install', { spec: spec }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patchPlugin({
          busy: false,
          note: '已更新 ' + name + '。更改在重启 dsh 后生效',
          output: (result.value && result.value.output) || '',
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
        })
        // Refresh the update map so the upgraded entry stops flagging.
        checkUpdates()
        return
      }
      patchPlugin({ busy: false, error: '更新失败：' + messageOf(result.error) })
      reloadPlugins()
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
      patchPlugin({ busy: false, error: '安装失败：' + messageOf(result.error) })
      reloadPlugins()
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
      patchPlugin({ busy: false, error: '卸载失败：' + messageOf(result.error) })
      reloadPlugins()
    }, function (failure) {
      if (!alive.current) return
      patchPlugin({ busy: false, error: '调用失败：' + messageOf(failure) })
    })
  }

  useEffect(function () {
    alive.current = true
    reloadPlugins()
    // Auto-check for remote updates on mount (the panel loads lazily when
    // the 插件管理 tab is opened, so this runs once per open). The host
    // caches registry answers for 5 minutes, so re-opening the tab shortly
    // after does not re-hit the registry. The manual ⬆ 检查更新 button stays
    // for forcing a fresh check.
    checkUpdates()
    return function () { alive.current = false }
  }, [])

  return createElement('div', { 'data-dsh-admin-section': '' },
    renderPluginsView(pView, patchPlugin, installPlugin, removePlugin, checkUpdates, upgradePlugin))
}

/**
 * Sessions management settings section (standalone, no internal tabs).
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
 * MCP configuration settings section (standalone, no internal tabs).
 */
function McpSection(props) {
  var pairMcp = useState({
    mcpEntries: [],
    mcpBusy: false,
    mcpError: '',
    mcpEditorOpen: false,
    mcpDraft: null,
    mcpTestState: {}, // entryId -> { busy, result }
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
        patchMcp({ mcpBusy: false, mcpEntries: (result.value && result.value.entries) || [] })
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
        patchMcp({ mcpBusy: false, mcpEntries: (result.value && result.value.entries) || [] })
      } else {
        patchMcp({ mcpBusy: false, mcpError: '移除 MCP 配置失败：' + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchMcp({ mcpBusy: false, mcpError: '调用失败：' + messageOf(failure) })
    })
  }

  /** Set one entry's connectivity-test status against the CURRENT state. */
  function patchMcpTest(id, partial) {
    setMView(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.mcpTestState = mergeTestState(cur.mcpTestState, id, partial)
      return next
    })
  }

  /** Run a host-side connectivity probe for one entry and stash the result. */
  function testMcpEntry(id) {
    patchMcpTest(id, { busy: true, result: null, error: null })
    callRemote('mcpAdmin/test', { id: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok && result.value !== null && typeof result.value === 'object') {
        patchMcpTest(id, { busy: false, result: result.value })
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

  return createElement('div', { 'data-dsh-admin-section': '' },
    renderMcpSection(mView, patchDraft, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry))
}

/** Unified settings page; only the selected panel mounts and loads. */
function AdminCenterSection(props) {
  var pairTab = useState('plugins')
  var activeTab = pairTab[0]
  var setActiveTab = pairTab[1]
  var tabs = [
    { id: 'plugins', label: '插件管理', component: PluginsSection },
    { id: 'sessions', label: '会话管理', component: SessionsSection },
    { id: 'mcp', label: 'MCP 配置', component: McpSection },
  ]
  var selected = tabs.find(function (tab) { return tab.id === activeTab }) || tabs[0]

  return createElement('div', { 'data-dsh-admin-section': '' },
    createElement('div', { className: 'tabs', role: 'tablist', 'aria-label': '管理中心功能' },
      tabs.map(function (tab) {
        return createElement('button', {
          type: 'button',
          key: tab.id,
          className: 'tab' + (tab.id === selected.id ? ' active' : ''),
          role: 'tab',
          'aria-selected': tab.id === selected.id,
          onClick: function () { setActiveTab(tab.id) },
        }, tab.label)
      })
    ),
    createElement(selected.component, { key: selected.id, call: props.call, refreshSessions: props.refreshSessions })
  )
}

/* ========================================================================== */
/*                           Render Plugins View                              */
/* ========================================================================== */

function renderPluginsView(view, patch, install, remove, checkUpdates, upgrade) {
  var elements = []

  // Toolbar: search (primary, wide) + install input + actions in one row.
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar' },
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
      onClick: checkUpdates,
    },
      view.checkingUpdates ? createElement('span', { className: 'spinner', key: 'spin' }) : null,
      view.checkingUpdates ? '检查中...' : '⬆ 检查更新'
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

  elements.push(createElement('div', { className: 'list', key: 'list' }, rows))

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
  var header = createElement('div', { className: 'group-header', key: 'mcp-header' },
    createElement('span', { className: 'group-title', key: 't' }, '🔌 MCP 配置'),
    createElement('span', { className: 'group-count', key: 'c' }, String(view.mcpEntries.length) + ' 个'),
    createElement('button', {
      type: 'button',
      key: 'btn-refresh-mcp',
      className: 'btn sm',
      disabled: view.mcpBusy,
      onClick: reloadMcp,
    }, '刷新'),
    createElement('button', {
      type: 'button',
      key: 'btn-add-mcp',
      className: 'btn primary sm',
      disabled: view.mcpBusy,
      onClick: function () { openMcpEditor(null) },
    }, '添加服务器'),
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
            title: entry.config === null || entry.config === undefined ? '该配置无法安全解析，请手动编辑 cordis.patch.yml' : (testState !== null && testState.busy ? '检测中...' : '测试该服务器的连通性'),
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
  if (rows.length === 0) {
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
    var editor = createElement('div', { className: 'card', key: 'mcp-editor' },
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
          }, '🔄') : null,
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
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', marginBottom: '4px', borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.06))', paddingTop: '8px' }, key: 'f-reconnect-header' },
        createElement('input', {
          type: 'checkbox',
          id: 'reconnect-toggle',
          checked: d.reconnectEnabled,
          onChange: function (e) { patchDraft({ reconnectEnabled: e.target.checked }) },
          style: { margin: '0' },
        }),
        createElement('label', { htmlFor: 'reconnect-toggle', style: { fontSize: '12px', fontWeight: 500, cursor: 'pointer', color: 'var(--dsw-alias-label-primary, #111)' } }, '启用自动重连'),
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

  return createElement('div', { key: 'mcp-section', style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.08))', paddingTop: '8px' } }, children)
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
    createElement('span', { className: 'card-title-text', key: 'name' }, plugin.name),
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
      title: '远程 registry 有新版本：v' + updateInfo.latest + '（当前 v' + plugin.version + '）',
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
        title: '升级到 v' + updateInfo.latest + '（npm install ' + plugin.name + '@latest）',
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
 * Filter plugin layers by the type pill and a fuzzy name/version/path query.
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
  return result
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
      '刷新'
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
/*                             Plugin Entrypoint                              */
/* ========================================================================== */

function apply(ctx) {
  injectStyles()

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

  // One management-center entry keeps related local administration together;
  // its tab container mounts only the selected panel.
  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register({
      name: 'settings.section',
      id: 'plugin-admin',
      order: 25,
      label: '管理中心',
      inject: function () { return { call: call, refreshSessions: refreshSessions } },
    }, AdminCenterSection)
  })
}

module.exports = { apply: apply, inject: ['slots', 'connection'] }
return module.exports
} });
