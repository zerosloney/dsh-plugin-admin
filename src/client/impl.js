/**
 * Slot registrations for the admin surfaces (Phase B2: the panels themselves
 * live in the lazily loaded ./client.panels.js chunk).
 *
 * Keeping the registrations eager is what makes the panels lazy: the shell
 * needs a component reference at registration time, so each slot gets a
 * wrapper that loads the chunk on first render and paints a placeholder until
 * it arrives. Everything a panel needs from this half (locale table, shared
 * helpers, toast/clipboard utilities) is handed over through configure().
 */
import React from 'react'
import { canSwitchLanguage, currentLanguage, dshT, i18nSource, installLocaleRuntime, setAdminLang, subscribeLocale } from './i18n.js'
// Phase E: which panels the official UI has taken over (auto-yield table).
import { COVERAGE_SLOT_KEYS, resolveNativeCoverage } from './native-coverage.js'
// The row-menu entries render with the shell's own menu atom so they look and
// behave like the first-party items around them. The build keeps the specifier
// external and the loader answers it from the seed table (same as the panels
// half), so this adds no dependency.
//
// The icon is imported by NAME on purpose (not `import * as`): esbuild compiles
// a named import to a property read on the required module, so a host that
// predates the export answers `undefined` — which the feature test below turns
// into "no icon" instead of handing the row an undefined component type.
import { MenuItemButton, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { installWorkspaceMenuOpenDir } from './workspace-menu.js'

var createElement = React.createElement
var useState = React.useState
var useRef = React.useRef
var useEffect = React.useEffect

/**
 * The shell's own trash glyph for the destructive row, when this host ships it:
 * the icon set is a per-version named export, so an older shell degrades to
 * "no icon" rather than rendering an undefined component.
 */
var trashIcon = typeof IconTrashOutlineRegular === 'function'
  ? createElement(IconTrashOutlineRegular)
  : undefined

/**
 * Re-render the wrapped subtree when the shell locale changes (Phase C).
 * Panel copy is read through the module-level dshT(), so a repaint of the
 * section root is what makes a language switch visible without a reload.
 */
function useLocaleRevision() {
  var bump = useState(0)[1]
  useEffect(function () {
    return subscribeLocale(function () { bump(function (/** @type {number} */ n) { return n + 1 }) })
  }, [])
}

/** Wrap one slot component so it repaints on locale changes.
 * @param {any} Component - the wrapped slot component (host duck type).
 */
function withLocale(Component) {
  return function LocaleAwareSlot(/** @type {any} */ props) {
    useLocaleRevision()
    return createElement(Component, props)
  }
}



/** @param {string|null} path */
function baseName(path) {
  if (path === null || path === '') return dshT('（无工作目录）')
  var parts = path.replace(/\\/g, '/').split('/')
  var last = parts[parts.length - 1]
  return last === '' ? parts[parts.length - 2] || path : last
}

/** @param {number} ms */
function formatDate(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  var d = new Date(ms)
  var pad = function (/** @type {number} */ n) { return (n < 10 ? '0' : '') + String(n) }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** @param {any} error */
function messageOf(error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  if (typeof error === 'string') return error
  // A nullish failure carries nothing readable — an empty string renders
  // better than the literal "undefined" in a concatenated panel message.
  if (error === undefined || error === null) return ''
  return JSON.stringify(error) ?? ''
}

/* ========================================================================== */
/*                      Shared settings-section state kit                     */
/* ========================================================================== */

/**
 * One admin panel's reactive plumbing, collapsed from the twelve sections
 * that each used to repeat it: a useState pair, a shallow-merge `patch`,
 * and the `alive` unmount ref that guards late async answers after the
 * panel unmounts.
 *
 * Custom-hook contract: call `sectionState(initial)` unconditionally at the
 * top of a component (it calls useState + useRef in that fixed order), and
 * `kit.mount(reload)` exactly where the section's mount useEffect used to
 * sit. Sections keep their historical local names via the returned fields —
 * `kit.state` / `kit.set` (raw updater, for per-key map shapes a plain
 * merge cannot express) / `kit.alive` / `kit.patch(partial)`.
 * @param initial - the seed state; a function form passes through to
 *   useState's lazy initializer (localStorage-reading sections).
 * @returns {{ state: any, set: any, alive: any, patch: any, mount: any }}.
 */
/** @param {any} initial */
function sectionState(initial) {
  var pair = useState(initial)
  var alive = useRef(false)
  /** @param {Record<string, any>} partial */
  /** @param {Record<string, any>} partial */
  function patch(partial) {
    pair[1](function (/** @type {any} */ cur) {
      /** @type {Record<string, any>} */
      var next = {}
      for (var k in cur) next[k] = cur[k]
      for (var pk in partial) next[pk] = partial[pk]
      return next
    })
  }
  /** @param {() => void} reload */
  function mount(reload) {
    useEffect(function () {
      alive.current = true
      reload()
      return function () { alive.current = false }
    }, [])
  }
  return { state: pair[0], set: pair[1], alive: alive, patch: patch, mount: mount }
}

// Single-toast singleton: at most ONE floating toast exists at any time. A
// new showToast REPLACES the in-flight toast in place (same node, refreshed
// type/text, restarted countdown) instead of stacking another fixed-position
// node on top — rapid consecutive failures would otherwise overlap and hide
// the earlier message behind the latest. A toast mid-fade (leaving) is
// revived by a replacement rather than left to vanish.
/** One toast's DOM node + its two timers + the mid-fade flag. */
/** @typedef {{ el: HTMLElement, timer: ReturnType<typeof setTimeout>|null, removalTimer: ReturnType<typeof setTimeout>|null, leaving: boolean }} ToastState */
/** @type {ToastState|null} */
var activeToast = null

/**
 * Show a floating toast notification at the top of the viewport.
 * Auto-dismisses after `duration` ms. Supports 'success', 'error', 'info'.
 * Single-slot: a new toast replaces the current one (if any).
 * @param {string} type - the toast kind ('success' | 'error' | 'info').
 * @param {string} text - the message body.
 * @param {number} [duration] - auto-dismiss delay in ms (default 3000).
 */
function showToast(type, text, duration) {
  if (typeof document === 'undefined') return
  duration = duration || 3000

  /** @param {ToastState|null} state - the tracked toast (null-safe: the replace
   * closure fires after the guard, and a `var` binding loses that narrowing). */
  function quit(state) {
    if (state === null || state.leaving) return
    state.leaving = true
    if (state.timer !== null) clearTimeout(state.timer)
    state.el.classList.add('leaving')
    state.removalTimer = setTimeout(function () {
      if (state.el.parentNode) state.el.parentNode.removeChild(state.el)
      if (activeToast === state) activeToast = null
    }, 200)
  }

  var current = activeToast
  if (current !== null && current.el.parentNode !== null) {
    // Replace: revive a mid-fade toast, swap class/text, restart the countdown.
    if (current.timer !== null) clearTimeout(current.timer)
    if (current.removalTimer !== null) clearTimeout(current.removalTimer)
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
  /** @type {{ el: HTMLElement, timer: ReturnType<typeof setTimeout>|null, removalTimer: ReturnType<typeof setTimeout>|null, leaving: boolean }} */
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
/** @param {string} text */
function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(function () {
      showToast('success', dshT('📋 会话 ID 已复制'))
    }, function () {
      fallbackCopy(text)
    })
    return
  }
  fallbackCopy(text)
}

/** @param {string} text */
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
    showToast('error', dshT('❌ 复制失败：') + messageOf(e))
  }
}

/** Copy without the fixed 会话 ID toast — the caller owns the feedback. */
/** @param {string} text */
function copyTextSilently(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text)
  }
  try {
    fallbackCopy(text)
    return Promise.resolve()
  } catch (e) {
    return Promise.reject(e)
  }
}

/* ========================================================================== */
/*                    Destructive-action confirm dialog                       */
/* ========================================================================== */

/**
 * A modal confirmation for physically destructive actions.
 *
 * Why a DOM dialog instead of an in-menu second click: the shell may close the
 * row menu on select, which remounts the entry and wipes its React state — an
 * "armed" flag or a timeout armed in the menu therefore cannot survive the
 * click that set it, and the second click only re-arms (reads as "删除点了没
 * 反应"). A dialog living on document.body is outside that lifecycle, needs no
 * arm window, and can show WHICH session is about to go.
 *
 * The shell's own Modal atom is deliberately not used here: this plugin does
 * not depend on its prop contract (it is an external seed-table module with no
 * local declaration), and the panel stylesheet is only installed once a panel
 * mounts — a right-click delete can be the first interaction in a fresh
 * session, so the dialog brings its own styles.
 */
var CONFIRM_STYLE_ID = 'dsh-admin-confirm-style'
var CONFIRM_OVERLAY_CLASS = 'dsh-admin-confirm-overlay'
var CONFIRM_PANEL_CLASS = 'dsh-admin-confirm'

/** Insert the dialog stylesheet once. Idempotent and headless-safe. */
function ensureConfirmStyles() {
  if (typeof document === 'undefined' || document.getElementById(CONFIRM_STYLE_ID) !== null) return
  var style = document.createElement('style')
  style.id = CONFIRM_STYLE_ID
  style.textContent = [
    '.' + CONFIRM_OVERLAY_CLASS + '{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.38);animation:dsh-confirm-in .12s ease-out}',
    '.' + CONFIRM_PANEL_CLASS + '{width:min(430px,calc(100vw - 32px));box-sizing:border-box;background:var(--dsw-alias-bg-layer-default,#fff);color:var(--dsw-alias-label-primary,#222);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.22),0 4px 12px rgba(0,0,0,.10);padding:18px 18px 14px;font-size:13px;line-height:1.55}',
    '.' + CONFIRM_PANEL_CLASS + ' h3{margin:0 0 8px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px}',
    '.' + CONFIRM_PANEL_CLASS + ' p{margin:0;color:var(--dsw-alias-label-secondary,#555);white-space:pre-wrap;word-break:break-word}',
    '.' + CONFIRM_PANEL_CLASS + '-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
    '.' + CONFIRM_PANEL_CLASS + '-actions button{font:inherit;font-size:12px;padding:6px 14px;border-radius:7px;cursor:pointer;border:1px solid transparent;transition:background .12s}',
    '.' + CONFIRM_PANEL_CLASS + '-actions button.cancel{background:transparent;border-color:var(--dsw-alias-border-l2,rgba(150,150,160,.45));color:inherit}',
    '.' + CONFIRM_PANEL_CLASS + '-actions button.cancel:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(120,120,130,.10))}',
    '.' + CONFIRM_PANEL_CLASS + '-actions button.danger{background:var(--dsw-alias-state-error-primary,#ef4444);color:#fff}',
    '.' + CONFIRM_PANEL_CLASS + '-actions button.danger:hover{filter:brightness(1.06)}',
    '@keyframes dsh-confirm-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}',
  ].join('\n')
  document.head.appendChild(style)
}

/** The one open dialog. A second request replaces the first (single instance,
 * same posture as the toast singleton). */
/** @type {{ close: () => void }|null} */
var activeConfirm = null

/**
 * Show a modal confirm dialog.
 * Backdrop click, Escape, the cancel button, or a second request all close it;
 * Enter confirms. Focus defaults to cancel, so a stray Enter never destroys.
 * @param {{ title: string, message: string, confirmLabel: string, cancelLabel?: string, danger?: boolean, onConfirm: () => void }} opts
 * @returns {() => void} idempotent closer.
 */
function showConfirmDialog(opts) {
  // Headless mount: no document means no UI at all; do not fabricate a confirm.
  if (typeof document === 'undefined') return function () {}
  if (activeConfirm !== null) activeConfirm.close()
  ensureConfirmStyles()

  var previouslyFocused = document.activeElement
  var prevOverflow = document.body.style.overflow
  var closed = false

  var overlay = document.createElement('div')
  overlay.className = CONFIRM_OVERLAY_CLASS
  var panel = document.createElement('div')
  panel.className = CONFIRM_PANEL_CLASS
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')

  var heading = document.createElement('h3')
  heading.textContent = opts.title
  var body = document.createElement('p')
  body.textContent = opts.message

  var actions = document.createElement('div')
  actions.className = CONFIRM_PANEL_CLASS + '-actions'
  var cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'cancel'
  cancelBtn.textContent = opts.cancelLabel || dshT('取消')
  var confirmBtn = document.createElement('button')
  confirmBtn.type = 'button'
  confirmBtn.className = opts.danger === false ? '' : 'danger'
  confirmBtn.textContent = opts.confirmLabel

  /** @param {boolean} confirmed - whether the confirm path was taken. */
  function close(confirmed) {
    if (closed) return
    closed = true
    document.removeEventListener('keydown', onKeyDown, true)
    if (overlay.parentNode !== null) overlay.parentNode.removeChild(overlay)
    document.body.style.overflow = prevOverflow
    if (activeConfirm === handle) activeConfirm = null
    // Return focus to whatever opened the dialog, so keyboard users are not
    // dropped at the top of the document.
    try {
      if (previouslyFocused && typeof (/** @type {any} */ (previouslyFocused)).focus === 'function') {
        (/** @type {any} */ (previouslyFocused)).focus()
      }
    } catch (e) { /* focus restoration is best-effort */ }
    if (confirmed) {
      try { opts.onConfirm() } catch (err) { showToast('error', messageOf(err)) }
    }
  }

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(false); return }
    if (event.key === 'Enter') {
      // A focused cancel button handles its own Enter (native click = cancel).
      if (event.target === cancelBtn) return
      event.preventDefault()
      close(true)
    }
  }

  cancelBtn.addEventListener('click', function () { close(false) })
  confirmBtn.addEventListener('click', function () { close(true) })
  // mousedown (not click) so a drag that starts inside and ends on the backdrop
  // does not cancel.
  overlay.addEventListener('mousedown', function (event) {
    if (event.target === overlay) close(false)
  })

  actions.appendChild(cancelBtn)
  actions.appendChild(confirmBtn)
  panel.appendChild(heading)
  panel.appendChild(body)
  panel.appendChild(actions)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeyDown, true)
  try { cancelBtn.focus() } catch (e) { /* older engines */ }

  var handle = { close: function () { close(false) } }
  activeConfirm = handle
  return handle.close
}

/**
 * Resolve the row's `displayTitle` prop to a plain string.
 * The shell hands it over as a string or as a title descriptor depending on
 * version, so every unknown shape degrades to '' rather than rendering
 * "[object Object]" into a confirmation.
 * @param {unknown} value
 * @returns {string}
 */
function displayTitleText(value) {
  if (typeof value === 'string') return value.trim()
  if (value === null || typeof value !== 'object') return ''
  var rec = /** @type {Record<string, any>} */ (value)
  var keys = ['text', 'title', 'label', 'name']
  for (var i = 0; i < keys.length; i += 1) {
    var candidate = rec[keys[i]]
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return ''
}

/** Trigger a browser download for in-memory text (the session export path). */
/** @param {string} filename
 * @param {string} text */
function downloadTextFile(filename, text) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error(dshT('当前环境不支持文件下载'))
  }
  var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  var url = URL.createObjectURL(blob)
  var a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
}

/* ========================================================================== */
/*                    Settings Nav Icon Identity (设置导航图标)               */
/* ========================================================================== */

// The settings dialog's nav paints one generic gear for every section id it
// doesn't know (ui-settings-general's navIcon() hardcodes four official ids
// and falls back to IconSettingsOutline16), so this plugin's pages would all
// read as the same icon. The slot contract carries no icon field, so — same
// posture as the sidebar menu injection — we re-paint the nav row glyphs in
// the DOM: one distinct 16×16 outline icon per page, sharing the official
// stroke language (currentColor, 1.3 stroke, round caps/joins) so they sit
// naturally next to the stock icons.
//
// The nav row exposes only the label span (no section id / data attribute),
// so the label IS the key — which is why this plugin must never register a
// label the shell already uses: a shared key would repaint that official
// row's own icon too. (The preset page that motivated the rule is gone: the
// shell's own `ui-agent-preset` section already manages the preset roster,
// so a second page for it was pure duplication.)
//
// Labels carry no emoji either: the injected svg is the row's only glyph, so an
// emoji prefix in the text would paint a second, unrelated one beside it.
//
// Web 与会话 carries the search-history glyph: a magnifier whose lens is a
// clock — Web 搜索's circle-plus-handle over 历史会话's clock hands.
/** Keyed by the zh-CN label (post-i18nSource) — indexed by DOM text, so the
 * Record view is the honest model, like I18N_EN. Only these plugin-owned labels
 * are ever touched: a label outside this table is left exactly as the shell
 * painted it, which is what keeps the DOM patch below scoped to our own rows. */
/** @type {Record<string, string>} */
var SETTINGS_NAV_ICONS = {
  'MCP服务器': '<rect x="2.25" y="2.25" width="11.5" height="4.75" rx="1.2"/><rect x="2.25" y="9" width="11.5" height="4.75" rx="1.2"/><circle cx="5" cy="4.62" r="0.95" fill="currentColor" stroke="none"/><circle cx="5" cy="11.38" r="0.95" fill="currentColor" stroke="none"/>',
  '用量仪表盘': '<path d="M3.5 13V8.5"/><path d="M8 13V3"/><path d="M12.5 13V6"/>',
  '自动化': '<circle cx="8" cy="8" r="5.6"/><path d="M9.2 4.8L6.7 8.6h2.3l-2 3.3"/>',
  'Web 与会话': '<circle cx="7" cy="7" r="4.8"/><path d="M7 4.8V7l1.8 1.2"/><path d="M10.6 10.6l2.6 2.6"/>',
  '工作流': '<circle cx="4" cy="4" r="1.8"/><circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="8" r="1.8"/><path d="M5.8 4h2.4a2 2 0 0 1 2 2v.4M5.8 12h2.4a2 2 0 0 0 2-2v-.4"/>',
}

var SETTINGS_NAV_ICON_MARK = 'data-dsh-admin-nav-icon'

// Anti-stacking guards for the two body-level observers below. Their disposers
// only run through ctx.effect teardown; a host hot-reload that re-runs apply()
// without disposing the previous instance would otherwise install another
// observer per apply, so every DOM mutation triggers N repaints/injections.
// Each setup disconnects the SAME setup's previously installed observer before
// observing again (keeping the count at one), and the disposer clears the
// module ref only while it still points at its own observer.
/** @type {MutationObserver|null} */
var activeNavIconObserver = null

/** Build one 16×16 outline SVG carrying the official navIcon css class. */
/** @param {string} label - the nav row's label (the table key).
 * @param {string} template - the SVG path markup to inline. */
function buildNavIconSvg(label, template) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.3')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute(SETTINGS_NAV_ICON_MARK, label)
  svg.innerHTML = template
  return svg
}

/**
 * Re-paint this plugin's settings-nav rows with their per-page icons.
 * Runs through a MutationObserver because the settings dialog mounts late
 * (and re-renders its nav on locale/ledger bumps); matching is by the nav
 * row's label span so hash-scrambled css classes never enter the picture.
 * The stock gear svg keeps its css class — the replacement inherits it, so
 * geometry and alignment ride the shell's own stylesheet.
 *
 * WHY DOM SURGERY: upstream has no extension point for a section's nav glyph.
 * The shell's nav column calls its own closed `navIcon(id)` (ui-settings-general
 * /src/client/SettingsRoot.tsx:35-42: account/models/agent-presets/plugins/
 * archived-sessions, everything else gets the gear), and the slot that mounts
 * the rows carries no icon option — 'settings.section' is declared as
 * `{ kind: 'list'; scope: 'root'; owner: SettingsSectionOwnerProps }`
 * (ui-settings/src/client/contract/slots.ts:57) and its documented register
 * options are `id` / `order` / `label` only (same file :58-65). A third-party
 * section id therefore can never get its own glyph through the contract.
 * 上游无扩展点，只能 DOM 补画。
 * @returns a disposer that disconnects the observer.
 */
function setupSettingsNavIcons() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return function () {}
  var repaint = function () {
    var dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (dialog === null) return
    // Only the dialog's nav column: content-area buttons share label words.
    var nav = dialog.querySelector('nav')
    if (nav === null) return
    var rows = nav.querySelectorAll('button')
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r]
      var labelSpan = row.querySelector('span')
      if (labelSpan === null) continue
      var template = SETTINGS_NAV_ICONS[i18nSource(labelSpan.textContent)]
      if (template === undefined) continue
      var stock = row.querySelector('svg')
      if (stock !== null) {
        if (stock.hasAttribute(SETTINGS_NAV_ICON_MARK)) continue // already ours
        var replacement = buildNavIconSvg(labelSpan.textContent, template)
        replacement.setAttribute('class', stock.getAttribute('class') || '')
        row.replaceChild(replacement, stock)
      } else {
        // Scan our own marked svgs and compare the attribute value: the old
        // attribute-SELECTOR form interpolated host DOM text into a selector,
        // which only stayed safe because the fixed-key guard above gates this
        // path — comparing values has no such precondition.
        var ours = row.querySelectorAll('svg[' + SETTINGS_NAV_ICON_MARK + ']')
        var present = false
        for (var q = 0; q < ours.length; q++) {
          if (ours[q].getAttribute(SETTINGS_NAV_ICON_MARK) === labelSpan.textContent) { present = true; break }
        }
        if (!present) row.insertBefore(buildNavIconSvg(labelSpan.textContent, template), row.firstChild)
      }
    }
  }
  // Idempotence: drop the previous instance's observer (a re-run apply() whose
  // old disposer never fired) before installing this one — see the comment on
  // activeNavIconObserver above.
  if (activeNavIconObserver !== null) activeNavIconObserver.disconnect()
  var observer = new MutationObserver(repaint)
  observer.observe(document.body, { childList: true, subtree: true })
  activeNavIconObserver = observer
  repaint()
  return function () {
    observer.disconnect()
    if (activeNavIconObserver === observer) activeNavIconObserver = null
  }
}

/* ========================================================================== */
/*        Session row menu — official slot injection (no DOM scraping)        */
/* ========================================================================== */

/**
 * The sidebar's session-row "⋯" menu is an official extension point:
 * `sidebar.workspaces.session.menu.item` — kind `list`, scope `root`. The owner
 * renders every registered entry inside its own Menu with the row's identity
 * already resolved, so an entry knows exactly which session it was opened for.
 * Contract verified against dsh 0.2.1-rc.3:
 *
 * - `packages/client/ui-workspace/src/client/contract/slots.ts:78-105` — owner
 *   props `{ sessionId, displayTitle }`; the slot hook `menuOpenState`
 *   (`() => readonly [open, (open: boolean) => void]`) is bound into entries as
 *   the prop `useMenuOpenState`.
 * - `packages/client/ui-slots/src/renderer.ts:42` — a slot hook named
 *   `menuOpenState` reaches the entry as `useMenuOpenState`
 *   (`standardHookPropName`).
 * - `packages/client/ui-workspace/src/client/index.ts:317-322` — a first-party
 *   entry is `{ name, id, order, locale, inject }` plus its `component`.
 * - `packages/client/ui-primitives/src/Menu.tsx:87-108` — `MenuItemButton`
 *   takes `children/icon/danger/separatorBefore/onSelect` and does NOT dismiss
 *   the menu on selection; the entry closes it through the bound hook.
 *
 * This REPLACED a MutationObserver that watched `document.body` for
 * `div[role="menu"]`, guessed the clicked row from menu geometry plus the
 * menu's own button text, then mapped the row's `aria-label` title back to a
 * session (exact title, then fuzzy substring). Each step could pick the wrong
 * session, and because the items act on ids a wrong pick never failed loudly.
 */
var SESSION_MENU_SLOT = 'sidebar.workspaces.session.menu.item'
/** Menu state for a shell that omits the hook prop (version skew only).
 * @type {readonly [boolean, (open: boolean) => void]} */
var MENU_NEVER_OPEN = [false, function () {}]

/** Stand-in hook for a shell that omits the bound prop: always "closed".
 * @returns {readonly [boolean, (open: boolean) => void]} */
function readNoMenuState() {
  return MENU_NEVER_OPEN
}

/**
 * Read the entry's bound `useMenuOpenState` hook and return a closer.
 *
 * Exactly one hook function runs per render — the shell's hook, or the plain
 * stand-in above. That keeps hook order stable without a conditional hook call,
 * so a version-skewed shell cannot throw inside the menu: the item still works,
 * it just cannot dismiss the menu by itself.
 * @param {(() => readonly [boolean, (open: boolean) => void])|undefined} useMenuOpenState
 * @returns {() => void}
 */
function useMenuDismiss(useMenuOpenState) {
  var hook = typeof useMenuOpenState === 'function' ? useMenuOpenState : readNoMenuState
  var pair = hook()
  var setOpen = pair && pair[1]
  return function () {
    if (typeof setOpen === 'function') setOpen(false)
  }
}

/** "Delete session" row-menu item: the first select arms, a second one within
 *
 * `sessionAdmin/closeSession` is correct for BOTH states, which is why this
 * needs no `list()` lookup and therefore no snapshot in which an id resolved
 * from a stale list could act on the wrong session: for a live session it
 * disposes the live agent first (the captured handle, or a teardown rebuilt from
 * the live agent when this plugin mounted after that session — see
 * `recoverLiveAgentHandle`), and for an already-closed one it falls
 * through to the same artifact removal (`lib/session-admin.js:1712-1769` —
 * `wasLive` only records which path ran). The receipt carries a non-null
 * `degraded` when the cross-process fence was skipped; surface that instead of
 * a plain success toast, exactly as the panel's delete does.
 * @param {(method: string, args: any) => Promise<any>} call
 * @param {string} sessionId
 * @param {(sessionId: string) => void} forgetSession - drops the row from the
 *   shell's session list (and reconciles it) after a successful delete.
 */
function deleteSessionFromMenu(call, sessionId, forgetSession) {
  call('sessionAdmin/closeSession', { sessionId: sessionId }).then(function (/** @type {any} */ result) {
    if (result && result.ok) {
      var degraded = result.value && typeof result.value.degraded === 'string' ? result.value.degraded : ''
      if (degraded !== '') showToast('info', dshT('⚠️ 会话已删除，但跨进程护栏未生效：') + degraded)
      else showToast('success', dshT('🗑️ 会话已删除'))
      // Drop the row from the shell's own list NOW. The host detached this
      // session from its workspace as part of the delete, so a list that still
      // holds it renders it under 未分组 — the reported "deleted session moved
      // to Ungrouped" symptom.
      if (typeof forgetSession === 'function') forgetSession(sessionId)
      return
    }
    var failure = messageOf(result && result.error)
    showToast('error', dshT('❌ 删除会话失败：') + failure + deleteFailureHint(failure))
  }, function (err) {
    var failure = messageOf(err)
    showToast('error', dshT('❌ 删除会话失败：') + failure + deleteFailureHint(failure))
  })
}

/**
 * Actionable hint for a delete the operator can retry successfully.
 * The host refuses while another process holds the session's write lease
 * (typically another dsh instance sharing DSH_HOME); naming that condition is
 * more useful than echoing the raw lease error.
 * @param {string} failure - the already-stringified host error.
 * @returns {string} a hint suffix, or '' when the failure speaks for itself.
 */
function deleteFailureHint(failure) {
  if (/write lease|session\.lock|already owned|another process|is live/i.test(failure)) {
    return '\n' + dshT('该会话正被另一个 dsh 实例占用：请先在那边关闭它，或关掉那个实例后再删。')
  }
  return ''
}

/** "Delete session" row-menu item: one select opens a modal confirmation that
 * names the session about to go.
 *
 * This replaced a two-click arming flow. That flow had two traps: (1) the
 * armed flag lived in this component, so a shell that closes the row menu on
 * select remounted the entry and reset it — the "second" click only re-armed,
 * which read as "点了没反应"; (2) the 4s window silently disarmed while the
 * user read the warning, so a careful user's confirming click was treated as
 * a fresh arm. The dialog lives on document.body, survives the menu closing,
 * and has no timer.
 * @param {any} props - owner props, the bound hook prop, and this entry's inject face. */
function DeleteSessionMenuItem(props) {
  var dismiss = useMenuDismiss(props.useMenuOpenState)
  return createElement(MenuItemButton, {
    danger: true,
    // Same icon slot the shell's own rows use (置顶/重命名/分支/归档), so the
    // plugin row reads as one of them instead of a bare text row.
    icon: trashIcon,
    onSelect: function () {
      dismiss()
      var title = displayTitleText(props.displayTitle)
      var message = title !== ''
        ? dshT('将永久删除「') + title + dshT('」及其日志记录，此操作不可撤销。')
        : dshT('将永久删除该会话及其日志记录，此操作不可撤销。')
      message += '\n' + dshT('在线会话会先关停其 agent，再删除记录。')
      showConfirmDialog({
        title: dshT('删除会话'),
        message: message,
        confirmLabel: dshT('确认删除'),
        cancelLabel: dshT('取消'),
        danger: true,
        onConfirm: function () { deleteSessionFromMenu(props.call, props.sessionId, props.forgetSession) },
      })
    },
  }, dshT('删除会话'))
}

/**
 * Register the two row-menu entries.
 *
 * Ribbon slots take the same `{ name, id, order, inject }` + component shape the
 * panels use, and `inject` is what keeps a shell without the owner harmless:
 * the thunk only runs once ui-workspace declares the slot.
 * @param {any} ctx - the plugin context (its slot service).
 * @param {(method: string, args: any) => Promise<any>} call
 * @param {(sessionId?: string) => void} reconcileSessionList - drops the deleted
 *   row from the shell list when given an id, and always reconciles it.
 * @returns {() => void}
 */
function setupSessionMenuItems(ctx, call, reconcileSessionList) {
  /** @type {(() => void)[]} */
  var disposers = []
  // ONE row. The shell already registers a 'session-id' row (order 450) that
  // copies the id, so a plugin "copy session ID" entry would be a second button
  // doing the same thing (ui-workspace/src/client/contract/slots.ts:153-156).
  // `register(options, component)`: the component is the SECOND argument — the
  // slot keeps it in its own record (ui-slots/src/index.ts:1207,1266).
  disposers.push(ctx.slots.inject(SESSION_MENU_SLOT, function () {
    return ctx.slots.register({
      name: SESSION_MENU_SLOT,
      id: 'plugin-admin.delete-session',
      order: 460,
      inject: function () { return { call: call, refreshSessions: reconcileSessionList, forgetSession: reconcileSessionList } },
    }, withLocale(DeleteSessionMenuItem))
  }))
  return function () {
    for (var i = 0; i < disposers.length; i++) {
      try { disposers[i]() } catch (error) { /* the fiber owns teardown too */ }
    }
  }
}

/** Package-local chunk holding every panel implementation. */
var PANELS_CHUNK = './client.panels.js'
/** Loaded chunk module (null until it arrives). */
/** @type {Record<string, any>|null} */
var panelsModule = null
/** In-flight load, shared by every slot that renders first. */
/** The loader-shaped require: the host hands the factory a table lookup that
 * also carries `async` for package-local chunks. Typed locally because the
 * source compiles against Node's Require, which has no such member. */
/** @type {{ async?: (spec: string) => Promise<Record<string, any>> }} */
var loaderRequire = /** @type {any} */ (require)
/** @type {Promise<Record<string, any>>|null} */
var panelsLoad = null
/** Load failure, surfaced inside the placeholder instead of a blank panel. */
/** @type {string|null} */
var panelsError = null
/** Mounted LazyPanel instances waiting on the shared chunk. The chunk loads
 * single-flight, so a success anywhere must reach every instance still showing
 * the failure placeholder, not only the one whose retry won the race.
 * @type {Set<() => void>} */
var panelsWatchers = new Set()
/** Resolve every mounted LazyPanel that is waiting on the chunk. */
function notifyPanelsLoaded() {
  panelsWatchers.forEach(function (/** @type {() => void} */ watcher) { watcher() })
}
/**
 * Panel-level switch resolver (set by apply() once the policy pipeline exists;
 * null before that and in standalone test mounts). Shared-slot panels (the
 * web 搜索 tab) consult it because slot-level uninstall cannot reach them.
 * @type {((panel: string) => boolean) | null}
 */
var panelHiddenResolver = null

/**
 * Tab-level switch resolver (set by apply() beside the panel one). A coverage
 * row whose `scope` is 'tabs' retires only the named tabs, so the panel stays
 * registered and its own tab strip asks this instead. Null before apply() and
 * in standalone mounts, where nothing is hidden.
 * @type {((panel: string, tab: string) => boolean) | null}
 */
var tabHiddenResolver = null

/**
 * Load the panel chunk exactly once and hand it the shared helpers.
 * @returns {Promise<Record<string, any>>} the chunk's exports.
 */
function loadPanels() {
  if (panelsLoad === null) {
    if (typeof loaderRequire.async !== 'function') {
      panelsError = 'this host does not serve client chunks'
      return Promise.reject(new Error('plugin-admin: ' + panelsError))
    }
    panelsLoad = loaderRequire.async(PANELS_CHUNK).then(function (mod) {
      if (typeof mod.configure === 'function') {
        mod.configure({
          currentLanguage: currentLanguage,
          dshT: dshT,
          i18nSource: i18nSource,
          setAdminLang: setAdminLang,
          canSwitchLanguage: canSwitchLanguage,
          baseName: baseName,
          formatDate: formatDate,
          messageOf: messageOf,
          sectionState: sectionState,
          showToast: showToast,
          copyTextToClipboard: copyTextToClipboard,
          copyTextSilently: copyTextSilently,
          downloadTextFile: downloadTextFile,
          // Shared-slot panels resolve the three-state switch through this
          // (apply() installs the real resolver; standalone mounts stay open).
          panelHidden: function (/** @type {string} */ panel) {
            return typeof panelHiddenResolver === 'function' ? panelHiddenResolver(panel) === true : false
          },
          // Tab-level twin: a 'tabs'-scoped coverage hit retires one tab of a
          // panel that still registers (自动化's cron tab when ui-schedule is
          // mounted). Read at render time, so a late host answer re-renders.
          tabHidden: function (/** @type {string} */ panel, /** @type {string} */ tab) {
            return typeof tabHiddenResolver === 'function' ? tabHiddenResolver(panel, tab) === true : false
          },
        })
      }
      panelsModule = mod
      return mod
    }).catch(function (error) {
      panelsError = messageOf(error)
      panelsLoad = null
      throw error
    })
  }
  return panelsLoad
}

/**
 * Wrap one chunk export in a slot component that loads the chunk on first
 * render. The placeholder is deliberately small — it is visible for one
 * frame on a warm cache.
 * @param {string} exportName - the chunk export to render.
 * @returns {Function} the slot component.
 */
function lazyPanel(exportName) {
  return function LazyPanel(/** @type {any} */ props) {
    var statePair = useState(panelsModule)
    var loaded = statePair[0]
    var setModule = statePair[1]
    var errorPair = useState(panelsError)
    var failure = errorPair[0]
    var setFailure = errorPair[1]
    var attemptPair = useState(0)
    var attempt = attemptPair[0]
    var setAttempt = attemptPair[1]
    useEffect(function () {
      var alive = true
      var onLoaded = function () {
        if (alive) setModule(panelsModule)
      }
      if (loaded === null) {
        loadPanels().then(function () {
          if (alive) setModule(panelsModule)
          // The chunk loads single-flight: a success won by ANY instance (this
          // one's own mount, or another panel's retry) must reach every mounted
          // LazyPanel still showing the failure placeholder — without this,
          // only the retrying panel recovers and the others stay stuck on
          // 「面板加载失败」 until each is clicked individually.
          notifyPanelsLoaded()
        }).catch(function (error) {
          // The failure is STATE, not a module variable: the placeholder used to
          // read `panelsError` directly, but nothing re-rendered when it was set,
          // so a chunk that failed to arrive (a stale immutable cache entry after
          // an upgrade, a dev-server restart, a CSP block) left every panel on
          // "加载面板…" forever with no explanation and no way to retry.
          if (alive) setFailure(messageOf(error) || dshT('未知错误'))
        })
      }
      panelsWatchers.add(onLoaded)
      return function () {
        alive = false
        panelsWatchers.delete(onLoaded)
      }
    }, [attempt, loaded])
    var Component = loaded === null ? null : loaded[exportName]
    if (Component === undefined || Component === null) {
      return createElement('div', { className: 'card', style: { padding: '12px', opacity: failure === null ? 0.7 : 1 } },
        failure === null
          ? dshT('加载面板…')
          : [dshT('面板加载失败：') + failure,
            createElement('button', {
              key: 'retry',
              className: 'btn',
              style: { marginLeft: '8px' },
              onClick: function () {
                panelsLoad = null
                setFailure(null)
                setAttempt(attempt + 1)
              },
            }, dshT('重试'))])
    }
    return createElement(Component, props)
  }
}
/* ========================================================================== */
/*                             Plugin Entrypoint                              */
/* ========================================================================== */

/**
 * Whether two coverage verdicts are the same decision.
 *
 * Used to avoid re-planning on every declaration: the shell announces slot
 * changes for reasons that have nothing to do with official coverage (a third
 * party registering an unrelated entry on the same key). Only a change in what
 * THIS plugin does — a panel retiring, a tab hiding, a note appearing — should
 * reach the reconciler.
 * @param {Record<string, any>} a - previous verdict.
 * @param {Record<string, any>} b - new verdict.
 * @returns {boolean}
 */
function sameCoverageVerdict(a, b) {
  if (JSON.stringify(a.active) !== JSON.stringify(b.active)) return false
  if (JSON.stringify(a.hiddenTabs) !== JSON.stringify(b.hiddenTabs)) return false
  /** @param {Record<string, any>} row */
  var panelOf = function (row) { return row.panel }
  return JSON.stringify(a.yielded.map(panelOf)) === JSON.stringify(b.yielded.map(panelOf))
}

/**
 * Log one coverage verdict — including the panels that OVERLAP an official
 * surface but were deliberately kept.
 *
 * The `notes` list existed since v1.30 with a comment saying it was "for the
 * mount log", but nothing read it (v1.30.1 fixes that). It matters because the
 * alternative to a note is silence: an operator seeing both our 自动化 entry and
 * the official schedule page has no way to learn from the plugin that this is
 * deliberate.
 * @param {Record<string, any>} coverage - a resolveNativeCoverage() verdict.
 * @returns {void}
 */
function reportCoverage(coverage) {
  /** @param {Record<string, any>} row */
  var panelOf = function (row) { return row.panel }
  /** @param {Record<string, any>} row */
  var noteOf = function (row) { return row.panel + ' ← ' + row.official }
  if (coverage.yielded.length > 0) {
    logger?.info?.('plugin-admin: 官方已覆盖，让位面板：' + coverage.yielded.map(panelOf).join(', '))
  }
  var tabOwners = Object.keys(coverage.hiddenTabs)
  if (tabOwners.length > 0) {
    logger?.info?.('plugin-admin: 官方已覆盖部分页签，面板保留：' + tabOwners.map(function (panel) {
      return panel + '(' + coverage.hiddenTabs[panel].join('/') + ')'
    }).join(', '))
  }
  if (coverage.notes.length > 0) {
    logger?.info?.('plugin-admin: 官方有相近界面但不等价，面板保留：' + coverage.notes.map(noteOf).join('；'))
  }
}

/** Module-scoped logger handle, set by apply() so reportCoverage() can be a
 * plain function instead of a closure re-created on every recompute.
 * @type {{ info?: (line: string) => void }|undefined} */
let logger

/** @param {Record<string, any>} ctx - the client plugin context. */
function apply(ctx) {
  logger = ctx.logger
  // Phase E: official-first. A coverage row retires its panel, one of its tabs,
  // or nothing at all — see `scope` in src/client/native-coverage.js. Only a
  // 'panel' hit stops a slot from registering; `dsh-admin-panels` in
  // localStorage forces one back on.
  //
  // RE-DERIVED, not snapshotted (v1.30.1). The probes read the shell's slot
  // lists, and the official panels may declare AFTER this client's apply — the
  // TIMING ASSUMPTION note in native-coverage.js spells that out. Computing the
  // verdict once meant a late declaration was invisible for the whole session:
  // for `scope: 'panel'` that cost one redundant panel (tolerable), but for
  // `scope: 'tabs'` it meant the cron tab never yielded — the panel stayed
  // registered and the strip kept offering a tab the official page had taken
  // over. `recomputeCoverage()` runs on every relevant slot declaration, so the
  // verdict tracks the shell instead of the boot order.
  var coverage = resolveNativeCoverage(ctx)
  /** Re-derive the verdict from the CURRENT slot lists. @returns {boolean} whether anything changed. */
  var recomputeCoverage = function () {
    var next = resolveNativeCoverage(ctx)
    if (sameCoverageVerdict(coverage, next)) return false
    coverage = next
    reportCoverage(next)
    return true
  }
  reportCoverage(coverage)
  // Live for the whole session: `tabOwners` is read by the mount-time RPC
  // reconcile below, and must follow a verdict that changed after boot.
  var tabOwners = Object.keys(coverage.hiddenTabs)
  var refreshTabOwners = function () { tabOwners = Object.keys(coverage.hiddenTabs) }
  // Shell locale service (soft dependency): register the panel table and
  // bind dshT to the shell's active locale.
  //
  // Boot order is NOT guaranteed: the locale service is provided by another
  // client plugin (@deepseek-ai/dsh-client-locale), whose apply may run after
  // ours. Reading ctx.get('locale') once during apply was a race — when we lost
  // it, the whole page silently rendered source strings. ctx.inject() starts a
  // child fiber that runs this body only once 'locale' is available
  // (vendor/cordis/src/registry.ts:300 — inject() is plugin({inject, apply})),
  // so installation happens after the service arrives instead of before it.
  // On a headless mount with no locale plugin the body never runs and the
  // two-language fallback inside i18n.js keeps the panels readable.
  // HARNESS FALLBACK: the repo's client verify scripts hand apply() a pseudo
  // context with effect()/get()/on() but no inject(); skipping the branch there
  // would leave every panel unregistered. They get the one-shot attempt, which
  // degrades exactly like a shell without a locale plugin. (Follow-up for the
  // script owner: add inject() to those stubs so the real path is exercised.)
  if (typeof ctx.inject === 'function') {
    ctx.inject(['locale'], function () { return installLocaleRuntime(ctx) })
  } else {
    ctx.effect(function () { return installLocaleRuntime(ctx) }, 'plugin-admin: locale runtime')
  }

  /** @param {string} method
   * @param {any} args */
  var call = function (method, args) {
    return ctx.connection.rpc.call('/api', method, { args: args })
  }

  // Host pin bridge (SOFT dependency).
  //
  // Session pins are durable registry state, not a UI preference:
  // `WorkspaceRegistry.pinSession` front-inserts into `pinnedSessionIds`
  // (packages/workspace/workspace/src/index.ts:442), the official sidebar
  // renders that set, and it is persisted with the workspace registry. The
  // panel used to keep its own id list in localStorage, which meant two pin
  // sets that could disagree: pinning in the sidebar never showed in the
  // panel and vice versa, and deleting a session left a ghost entry in
  // whichever set the sidebar reads.
  //
  // `workspaces` is the browser-side Workspace Controller service
  // (`packages/api/workspace-controller/src/client/service.ts:47-102` —
  // `list` + `pinSession` + `unpinSession`). It is absent on a shell that
  // mounts no workspace surface, so this stays optional: without it the panel
  // keeps its localStorage list (and every verify script's pseudo context,
  // which has no such service, keeps exercising that path).
  /** @type {{ read: () => string[], subscribe: (fn: () => void) => () => void, pin: (id: string) => Promise<void>, unpin: (id: string) => Promise<void> }|null} */
  var pinBridge = null
  try {
    var workspacesSvc = ctx.get && ctx.get('workspaces')
    if (workspacesSvc !== null && workspacesSvc !== undefined
      && workspacesSvc.list !== null && workspacesSvc.list !== undefined
      && typeof workspacesSvc.list.getSnapshot === 'function'
      && typeof workspacesSvc.list.subscribe === 'function'
      && typeof workspacesSvc.pinSession === 'function'
      && typeof workspacesSvc.unpinSession === 'function') {
      pinBridge = {
        read: function () {
          try {
            var snapshot = workspacesSvc.list.getSnapshot()
            var ids = snapshot === null || snapshot === undefined ? null : snapshot.pinnedSessionIds
            return Array.isArray(ids) ? ids.slice() : []
          } catch (error) { return [] }
        },
        subscribe: function (listener) {
          try { return workspacesSvc.list.subscribe(listener) } catch (error) { return function () {} }
        },
        pin: function (sessionId) { return Promise.resolve(workspacesSvc.pinSession(sessionId)) },
        unpin: function (sessionId) { return Promise.resolve(workspacesSvc.unpinSession(sessionId)) },
      }
    }
  } catch (e) { pinBridge = null }

  // Sidebar session "..." menu: the delete row, registered on the shell's own
  // slot so it lands in the menu ui-workspace owns (no DOM scraping). Mounted
  // once for the page lifetime; dispose when the plugin unmounts.
  //
  // The `sessions` service is resolved AT CALL TIME, never captured here.
  // This plugin's client `inject` is ['slots', 'connection'], so `apply` can run
  // before the shell provides `sessions`; an eager capture then stayed null for
  // the whole page lifetime, no refresh ever ran, and a deleted row lingered in
  // "未分组" (the host had already detached it from its workspace) until reload.
  // Re-reading `ctx.get` at call time also survives a re-applied session
  // controller, whose replacement instance is the one the sidebar renders from.
  /**
   * Drop one deleted session from the shell's own list, then reconcile it.
   *
   * `handleSessionRemoved` is the exact client mutation the host's
   * `api-session/removed` frame drives (`dsh-api-session-controller`
   * `client/sessions/manager.ts`): it removes the row from `summaries` and marks
   * the list dirty, so the sidebar re-renders without the deleted session
   * instead of leaving it to fall into "未分组" because the host's workspace no
   * longer claims it. Called with no id it only reconciles; a host whose client
   * exposes no such mutation still gets that authoritative `refresh()`.
   * @param {string} [sessionId] - the session the host just deleted.
   */
  function reconcileSessionList(sessionId) {
    var svc = null
    try { svc = (ctx.get && ctx.get('sessions')) || null } catch (e) { svc = null }
    if (svc === null) return
    if (sessionId !== undefined && typeof svc.handleSessionRemoved === 'function') {
      try { svc.handleSessionRemoved(sessionId) } catch (e) { /* refresh below is the fallback */ }
    }
    if (typeof svc.refresh === 'function') svc.refresh().catch(function () {})
  }
  var disposeSidebar = ctx.effect(function () { return setupSessionMenuItems(ctx, call, reconcileSessionList) })

  // Settings-nav icon identity: repaint the four plugin pages' nav rows with
  // distinct per-page icons (the shell paints one generic gear for unknown
  // section ids). Observer lives for the page lifetime like the menu one.
  ctx.effect(function () { return setupSettingsNavIcons() })

  // The Workspace row menu is the ONE native menu ui-workspace hardcodes
  // (rename + delete) with no slot to register into, so「打开工作目录」rides the
  // plugin's single DOM hook. It keys on the row's `data-row-key` workspace id
  // and resolves the directory host-side — see workspace-menu.js for why this
  // is not the old label/geometry scraper. Mounted for the page lifetime.
  ctx.effect(function () {
    return installWorkspaceMenuOpenDir({ call: call, notify: showToast, describeError: messageOf })
  })

  // Phase E3: `config.panels` gives the PROFILE the final word on a panel —
  //   panels: { <id>: 'auto' | 'on' | 'off' }   (host-validated; lib/panel-ids.js)
  // 'off' wins over everything (including the localStorage force), 'on' registers
  // even when the official surface covers the panel, 'auto' is the coverage table.
  //
  // The browser half cannot read the config row, so it asks the host once per mount
  // (`pluginAdmin/panels`). Registration is EAGER with the last known answer cached
  // in localStorage, so a mount never waits on the RPC and the common case is
  // flash-free; the fresh answer then reconciles (uninstall an 'off' panel, install
  // an 'on' one). A failed ask leaves the cache (or 'auto') in charge.
  var POLICY_CACHE_KEY = 'dsh-admin-panels-policy'
  var readPolicyCache = function () {
    try {
      var raw = window.localStorage.getItem(POLICY_CACHE_KEY)
      if (typeof raw !== 'string' || raw === '') return {}
      var parsed = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) { return {} }
  }
  /** @param {Record<string, string>} states */
  var writePolicyCache = function (states) {
    try { window.localStorage.setItem(POLICY_CACHE_KEY, JSON.stringify(states)) } catch (error) { /* private mode */ }
  }
  var panelStates = readPolicyCache()
  var slotDisposed = false
  ctx.effect(function () {
    return function () {
      slotDisposed = true
      // B-6 planning leftovers: the two declaration subscriptions would
      // otherwise outlive the plugin and re-install pages after unload. (There
      // is no grace timer to clear since v1.30 — the slot choice is derived
      // from what is declared, and revised on these subscriptions.)
      for (var i = 0; i < plannerDisposers.length; i += 1) {
        try { plannerDisposers[i]() } catch (error) { /* the fiber owns teardown too */ }
      }
      if (plannerDisposers) plannerDisposers.length = 0
    }
  }, 'plugin-admin: slot lifecycle')
  /** @param {string} panel */
  var yielded = function (panel) {
    var state = panelStates[panel] || 'auto'
    if (state === 'off') return true
    if (state === 'on') return false
    return coverage.active[panel] === false
  }
  // 共享 slot 的面板（Web 搜索页签）拿不到独立 slot 的卸载语义，经这个解析器
  // 读取同一份三态决策；闭包读 panelStates，迟到的宿主答案自动生效。
  panelHiddenResolver = yielded
  /**
   * Tab-level twin of `yielded`: a panel that stays registered may still lose
   * individual tabs to an official surface. `off` on the panel hides every tab
   * (it never renders), `on` restores all of them, and 'auto' defers to the
   * coverage row's `tabs` list. The panel's own strip asks this at render time.
   * @param {string} panel
   * @param {string} tab
   * @returns {boolean}
   */
  var tabYielded = function (panel, tab) {
    var state = panelStates[panel] || 'auto'
    if (state === 'off') return true
    if (state === 'on') return false
    var hidden = coverage.hiddenTabs[panel]
    return Array.isArray(hidden) && hidden.indexOf(tab) !== -1
  }
  tabHiddenResolver = tabYielded

  // The ten surfaces as data, so a late config answer can install what it enables
  // and uninstall what it disables. Slot names and ids are the wire the shell sees.
  var SLOT_SPECS = [
  {
    panel: 'extensions',
    slot: 'settings.plugins.tab',
    options:       {
              name: 'settings.plugins.tab',
              id: 'extensions',
              order: 20,
              label: function () { return dshT('扩展插件') },
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('PluginsSection')),
  },
  {
    panel: 'mcp',
    slot: 'settings.plugins.tab',
    options:       {
              name: 'settings.plugins.tab',
              id: 'mcp-servers',
              order: 40,
              label: function () { return dshT('MCP服务器') },
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('McpSection')),
  },
  {
    panel: 'sessions',
    slot: 'settings.section',
    options:       {
              name: 'settings.section',
              id: 'web-sessions',
              order: 27,
              label: function () { return dshT('Web 与会话') },
              inject: function () { return { call: call, refreshSessions: reconcileSessionList, forgetSession: reconcileSessionList, pinBridge: pinBridge } },
          },
    component: withLocale(lazyPanel('WebSessionsSection')),
  },
  {
    panel: 'commands',
    slot: 'settings.plugins.tab',
    options:       {
              name: 'settings.plugins.tab',
              id: 'ch-commands',
              order: 60,
              label: function () { return dshT('命令') },
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('ChCommandsSection')),
  },
  {
    panel: 'hooks',
    slot: 'settings.plugins.tab',
    options:       {
              name: 'settings.plugins.tab',
              id: 'ch-hooks',
              order: 70,
              label: function () { return dshT('钩子') },
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('ChHooksSection')),
  },
  {
    panel: 'usage',
    slot: 'settings.section',
    options:       {
              name: 'settings.section',
              id: 'usage-dashboard',
              order: 28,
              label: function () { return dshT('用量仪表盘') },
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('UsageDashboardSection')),
  },
  {
    panel: 'automation',
    slot: 'settings.section',
    options:       {
              name: 'settings.section',
              id: 'automation',
              order: 29,
              label: function () { return dshT('自动化') },
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('AutomationSection')),
  },
  {
    panel: 'todo',
    slot: 'conversation.input.dock',
    options:       {
              name: 'conversation.input.dock',
              id: 'todo-admin',
              order: 5,
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('TodoAdminDock')),
  },
  ]
  // `injectDisposers` and `registerDisposers` are tracked separately, and
  // `uninstallOne` drops BOTH. Why the inject subscription is released too:
  // without it the stale thunk stays live, and because the guard below keys off
  // `injectDisposers` it is also the ONLY thing that re-registers the panel —
  // the shell's next slot event fires that leftover thunk and the panel comes
  // back. So the panel-visible behaviour happened to be right while the
  // bookkeeping was not: an "uninstalled" panel kept a live subscription it
  // should have dropped, and the two maps disagreed about what was installed.
  // Releasing the subscription makes the maps agree and leaves registration to
  // `installOne`, where it belongs.
  /** @type {Record<string, (() => void)|undefined>} */
  var injectDisposers = {}
  /** @type {Record<string, (() => void)|undefined>} */
  var registerDisposers = {}
  /** Slot each panel actually registered on (differs only on the B-6 fallback). */
  /** @type {Record<string, string|undefined>} */
  var mountedSlot = {}
  /** Panels whose slot registration threw (B-5), with the last reason. */
  /** @type {Record<string, string>} */
  var slotFailures = {}
  /** Last failure set already reported, so one visible warning per change. */
  var reportedFailureKey = ''

  // B-6: the two slots a settings page may land on. Both names are read out of
  // upstream source; neither is invented:
  //  - 'settings.plugins.tab' is declared at runtime as a CHILD of the Plugins
  //    section entry registered by @deepseek-ai/dsh-client-ui-settings-plugins
  //    (packages/client/ui-settings-plugins/src/client/index.ts:75-85, the
  //    `children` table at :83). Its contract type is in
  //    packages/client/ui-settings/src/client/contract/slots.ts:66 and the doc
  //    at :58-65 says exactly that: the feature owning the Plugins section
  //    declares it at runtime.
  //  - 'settings.section' is declared at runtime as a CHILD of the
  //    'sidebar.settings' entry registered by ui-settings-general
  //    (packages/client/ui-settings-general/src/client/index.ts:225-234;
  //    `'settings.section': { kind: 'list', scope: 'root' }` at :232), so it
  //    exists whenever the settings dialog itself exists.
  // A profile without the Plugins package therefore has a dialog with no tab
  // strip, and the six pages that live on the tab would never mount at all.
  // They mount on the top-level page instead, and are promoted into the tab the
  // moment it is declared (see the TAB_SLOT subscription below).
  var TAB_SLOT = 'settings.plugins.tab'
  var SECTION_SLOT = 'settings.section'
  /** Declaration subscriptions that re-plan the B-6 target. */
  /** @type {(() => void)[]} */
  var plannerDisposers = []

  /** Write one diagnostic line without letting a logger failure matter. */
  /** @param {string} line */
  var warnLine = function (line) {
    try {
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(line)
      else if (typeof console !== 'undefined' && console.warn) console.warn(line)
    } catch (ignored) { /* logging is diagnostics, not behaviour */ }
  }

  /**
   * Whether a slot is declared, through the shell's own public probe
   * (ui-renderer/src/client/registry.ts:452 `spec(key): SlotSpec | undefined`,
   * doc :447-451 "Look up a declared spec (register-declared or the built-in
   * 'root')").
   * @param {string} name
   * @returns {boolean|null} null when the host exposes no probe (harnesses).
   */
  var slotDeclared = function (name) {
    if (!ctx.slots || typeof ctx.slots.spec !== 'function') return null
    try { return ctx.slots.spec(name) !== undefined } catch (error) { return null }
  }

  /** @param {string} panel */
  var noteSlotFallback = function (panel) {
    warnLine('plugin-admin: ' + TAB_SLOT + ' is not declared by this shell; panel "'
      + panel + '" fell back to ' + SECTION_SLOT)
  }

  /** Record one panel failure and surface the set once, visibly. */
  /** @param {string} panel @param {string} slotName @param {any} error */
  var noteSlotFailure = function (panel, slotName, error) {
    var reason = messageOf(error)
    slotFailures[panel] = reason
    var names = Object.keys(slotFailures)
    var key = names.join('|')
    if (key === reportedFailureKey) return
    reportedFailureKey = key
    warnLine('plugin-admin: slot registration failed for ' + key + ' (' + reason + ')')
    // B-5: a missing settings page must not look like a feature this profile
    // never had. ONE line for the whole set, not one toast per panel.
    showToast('error', dshT('⚠️ 以下面板因 slot 注册失败未挂载：') + names.join(', '))
  }

  /** @param {string} panel */
  var clearSlotFailure = function (panel) {
    if (slotFailures[panel] === undefined) return
    delete slotFailures[panel]
    reportedFailureKey = ''
  }

  /**
   * Register one panel on an exact slot.
   * @param {Record<string, any>} spec
   * @param {string} slotName
   */
  var installOn = function (spec, slotName) {
    if (slotDisposed) return
    // `options.name` must equal the slot being registered into — the registry
    // reads the declared spec from it (ui-renderer/src/client/registry.ts:488-492)
    // and throws on a mismatch — so the fallback clones the options under the
    // fallback's name. id/order/label/inject stay untouched, which is why the
    // page keeps its own nav text and icon.
    var options = slotName === spec.slot
      ? spec.options
      : Object.assign({}, spec.options, { name: slotName })
    injectDisposers[spec.panel] = ctx.slots.inject(slotName, function () {
      // B-7: the inject callback's RETURN VALUE is the declaration-scoped
      // teardown effect — `(() => void) | Iterable<() => void>`
      // (ui-renderer/src/client/registry.ts:116 SlotInjectionEffect, doc
      // :195-209). A bare `return` answers `undefined` and loses that disposer,
      // so the entry outlives this plugin's unload. Every path returns one.
      if (yielded(spec.panel)) return function () {}
      try {
        var dispose = ctx.slots.register(options, spec.component)
        registerDisposers[spec.panel] = dispose
        mountedSlot[spec.panel] = slotName
        clearSlotFailure(spec.panel)
        return dispose
      } catch (error) {
        // register() throws synchronously (undeclared slot, duplicate id,
        // incompatible kind: ui-slots/src/index.ts:1207,1249). Swallowing it
        // HERE keeps it out of the declaring owner's register() call and lets
        // the sibling panels on the same slot mount.
        noteSlotFailure(spec.panel, slotName, error)
        return function () {}
      }
    })
  }

  /**
   * Where a tab-backed panel should register RIGHT NOW.
   *
   * Event-driven, no boot grace timer (v1.30, N-11). The previous version
   * registered on the tab, then waited 1200 ms before deciding the Plugins
   * section would never declare it and moving the page to `settings.section` —
   * a visible one-time jump whose timing was a guess. `ctx.slots.subscribe` is
   * documented to accept a subscription ahead of the declaration and to fire
   * when it lands (ui-slots/src/index.ts:1480-1489), so the decision can be
   * made from what is declared at this instant and revised on the event:
   *
   *   - tab declared      → the canonical home, no fallback needed;
   *   - else section declared → the fallback page (promoted later if the tab
   *     shows up, see the TAB_SLOT subscription);
   *   - else (no probe / nothing booted yet) → the tab, which `slots.inject`
   *     parks until its owner declares it.
   * @returns {string}
   */
  var preferredSettingsSlot = function () {
    if (slotDeclared(TAB_SLOT) === true) return TAB_SLOT
    if (slotDeclared(SECTION_SLOT) === true) return SECTION_SLOT
    return TAB_SLOT
  }

  /**
   * @param {Record<string, any>} spec - one SLOT_SPECS entry.
   * @param {string} [forceSlot] - register on this slot instead of deciding.
   */
  var installOne = function (spec, forceSlot) {
    if (slotDisposed || injectDisposers[spec.panel] !== undefined) return
    if (forceSlot !== undefined) { installOn(spec, forceSlot); return }
    if (spec.slot !== TAB_SLOT) { installOn(spec, spec.slot); return }
    var target = preferredSettingsSlot()
    if (target === SECTION_SLOT && slotDeclared(TAB_SLOT) === null && slotDeclared(SECTION_SLOT) === null) {
      // No probe at all (harness): the fallback is unobservable, so stay on the
      // canonical slot and let the subscription promote later.
      installOn(spec, TAB_SLOT)
      return
    }
    installOn(spec, target)
  }

  /** Re-plan the tab-backed panels after a relevant declaration change. */
  var replanTabPanels = function () {
    if (slotDisposed) return
    for (var i = 0; i < SLOT_SPECS.length; i += 1) {
      var spec = SLOT_SPECS[i]
      if (spec.slot !== TAB_SLOT || yielded(spec.panel)) continue
      var target = preferredSettingsSlot()
      if (mountedSlot[spec.panel] === target) continue
      if (injectDisposers[spec.panel] === undefined) { installOne(spec, target); continue }
      if (target === SECTION_SLOT) noteSlotFallback(spec.panel)
      uninstallOne(spec.panel)
      installOne(spec, target)
    }
  }

  if (ctx.slots && typeof ctx.slots.subscribe === 'function') {
    // `subscribe` is fed by the declaration too: ui-slots/src/index.ts:1480-1487
    // "Subscribing ahead of declaration is allowed; the declaration notifies."
    try { plannerDisposers.push(ctx.slots.subscribe(SECTION_SLOT, replanTabPanels)) } catch (error) { /* probe-only */ }
    // Promotion: a late Plugins section wins over the fallback, and a Plugins
    // section that disappears demotes the pages back to `settings.section`.
    try { plannerDisposers.push(ctx.slots.subscribe(TAB_SLOT, replanTabPanels)) } catch (error) { /* probe-only */ }

    // Coverage follow-up (v1.30.1). These four keys are exactly the slots the
    // probes read (COVERAGE_SLOT_KEYS in native-coverage.js derives them from the
    // table, so the two cannot drift). An official panel that declares AFTER our
    // apply used to be invisible for the whole session; now the verdict is
    // re-derived and, when it actually flipped, the affected panels are
    // reconciled so a hidden tab really disappears and a retired panel really
    // goes away.
    var onCoverageSignal = function () {
      if (slotDisposed) return
      refreshTabOwners()
      if (!recomputeCoverage()) return
      reconcileSlots()
    }
    for (var ck = 0; ck < COVERAGE_SLOT_KEYS.length; ck += 1) {
      try { plannerDisposers.push(ctx.slots.subscribe(COVERAGE_SLOT_KEYS[ck], onCoverageSignal)) } catch (error) { /* probe-only */ }
    }
  }

  /** @param {string} panel */
  /** @param {string} panel */
  var uninstallOne = function (panel) {
    // Drop the inject subscription too, so a later reconcile can install again.
    // Without this the slot stays injected (harmless in itself) while
    // `installOne`'s guard keeps refusing to re-register — the actual bug.
    mountedSlot[panel] = undefined
    var uninject = injectDisposers[panel]
    if (uninject !== undefined) {
      injectDisposers[panel] = undefined
      try { uninject() } catch (error) { /* the fiber owns teardown too */ }
    }
    var dispose = registerDisposers[panel]
    if (dispose === undefined) return
    registerDisposers[panel] = undefined
    try { dispose() } catch (error) { /* the fiber owns teardown too */ }
  }
  var reconcileSlots = function () {
    for (var i = 0; i < SLOT_SPECS.length; i += 1) {
      var spec = SLOT_SPECS[i]
      // B-5: per-panel isolation. Slot registration is synchronous and throws
      // (ui-slots/src/index.ts:1207 "is not declared", :1249 "already
      // declared", plus the registry's duplicate-id check), so one collision
      // used to abort this loop and every later panel vanished with no signal.
      // Each panel now pays for its own failure, and the set is reported once.
      try {
        if (yielded(spec.panel)) { uninstallOne(spec.panel); continue }
        installOne(spec)
      } catch (error) {
        noteSlotFailure(spec.panel, spec.slot, error)
      }
    }
  }

  reconcileSlots()

  // The ask. On success the answer becomes the cache and reconciliation runs again;
  // on failure nothing changes (cache, else auto-yield). A mount WITHOUT a
  // connection (a harness, a headless shell) must not throw here either.
  /** @type {Promise<any>|null} */
  var ask = null
  try { ask = call('pluginAdmin/panels', {}) } catch (error) { ask = null }
  if (ask !== null && typeof ask.then === 'function') {
    ask.then(function (result) {
      var panels = result && result.ok !== false && result.value ? result.value.panels : null
      if (panels === null || panels === undefined || typeof panels !== 'object') return
      var webSearchWasHidden = yielded('webSearch')
      // Snapshot every tab decision BEFORE adopting the answer, so the block at
      // the end of this handler can remount only the owners whose strip really
      // flipped (not every owner on every mount).
      /** @type {Record<string, boolean>} */
      var tabsWereHidden = {}
      for (var b = 0; b < tabOwners.length; b += 1) {
        tabsWereHidden[tabOwners[b]] = tabYielded(tabOwners[b], coverage.hiddenTabs[tabOwners[b]][0]) === true
      }
      panelStates = panels
      writePolicyCache(panels)
      reconcileSlots()
      // The Web 搜索 tab lives INSIDE the shared sessions slot and reads its
      // visibility at render time; a slot-level reconcile neither re-renders
      // nor notifies an already-mounted section, so a flipped decision left a
      // stale tab (or hid a wanted one) until an unrelated repaint. Remount
      // that one slot when the answer flipped it — this runs once, at mount
      // plus one RPC round trip, before the user has scrolled anywhere.
      //
      // Still needed after v1.30.1, but for ONE reason only: an explicit
      // `config.panels.webSearch: 'off'` arriving in this answer. The auto-yield
      // path can no longer flip it (that row is scope 'none'), so the guard
      // fires on the config answer and never on coverage.
      if (yielded('webSearch') !== webSearchWasHidden) {
        for (var i = 0; i < SLOT_SPECS.length; i += 1) {
          if (SLOT_SPECS[i].panel === 'sessions') {
            uninstallOne('sessions')
            installOne(SLOT_SPECS[i])
            break
          }
        }
      }
      // Same reasoning for the tab-level switch: 自动化 stays mounted while the
      // answer can hide or restore its cron tab, and the tab strip reads the
      // resolver at render time only. Remount when a tab decision flipped, so
      // the strip is not left showing a tab the profile just yielded.
      for (var t = 0; t < tabOwners.length; t += 1) {
        var ownerPanel = tabOwners[t]
        var now = tabYielded(ownerPanel, coverage.hiddenTabs[ownerPanel][0]) === true
        if (tabsWereHidden[ownerPanel] === now) continue
        for (var s = 0; s < SLOT_SPECS.length; s += 1) {
          if (SLOT_SPECS[s].panel !== ownerPanel) continue
          uninstallOne(ownerPanel)
          installOne(SLOT_SPECS[s])
          break
        }
      }
    }, function () { /* no host answer: the cache or the coverage table decides */ })
  }
}

// `loadPanels` rides the exports for the harnesses: SessionsSection /
// WorkspacesSection / WorkflowSection now live in the chunk, so a test that
// mounts one directly asks for the module first. The dsh module loader reads
// only `apply` / `inject`; the extra key is inert at runtime.

export { apply, loadPanels }
