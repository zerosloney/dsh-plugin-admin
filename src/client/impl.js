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
import { currentLanguage, dshT, i18nSource, installLocaleRuntime, setAdminLang, subscribeLocale } from './i18n.js'
// Phase E: which panels the official UI has taken over (auto-yield table).
import { resolveNativeCoverage } from './native-coverage.js'

var createElement = React.createElement
var useState = React.useState
var useRef = React.useRef
var useEffect = React.useEffect

/**
 * Re-render the wrapped subtree when the shell locale changes (Phase C).
 * Panel copy is read through the module-level dshT(), so a repaint of the
 * section root is what makes a language switch visible without a reload.
 */
function useLocaleRevision() {
  var bump = useState(0)[1]
  useEffect(function () {
    return subscribeLocale(function () { bump(function (n) { return n + 1 }) })
  }, [])
}

/** Wrap one slot component so it repaints on locale changes. */
function withLocale(Component) {
  return function LocaleAwareSlot(props) {
    useLocaleRevision()
    return createElement(Component, props)
  }
}



function baseName(path) {
  if (path === null || path === '') return dshT('（无工作目录）')
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
function sectionState(initial) {
  var pair = useState(initial)
  var alive = useRef(false)
  function patch(partial) {
    pair[1](function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      for (var pk in partial) next[pk] = partial[pk]
      return next
    })
  }
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
      showToast('success', dshT('📋 会话 ID 已复制'))
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
    showToast('error', dshT('❌ 复制失败：') + messageOf(e))
  }
}

/** Copy without the fixed 会话 ID toast — the caller owns the feedback. */
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

/** Trigger a browser download for in-memory text (the session export path). */
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
var SETTINGS_NAV_ICONS = {
  '技能': '<path d="M8 4.6C6.9 3.6 5.3 3.2 3 3.3v8.4c2.3-.1 3.9.3 5 1.3 1.1-1 2.7-1.4 5-1.3V3.3c-2.3-.1-3.9.3-5 1.3z"/><path d="M8 4.6v8.4"/>',
  'MCP服务器': '<rect x="2.25" y="2.25" width="11.5" height="4.75" rx="1.2"/><rect x="2.25" y="9" width="11.5" height="4.75" rx="1.2"/><circle cx="5" cy="4.62" r="0.95" fill="currentColor" stroke="none"/><circle cx="5" cy="11.38" r="0.95" fill="currentColor" stroke="none"/>',
  '子智能体': '<rect x="2.2" y="2.6" width="6" height="4.2" rx="1.2"/><rect x="7.8" y="9.2" width="6" height="4.2" rx="1.2"/><path d="M5.2 6.8v3a1.6 1.6 0 0 0 1.6 1.6h1"/>',
  '用量仪表盘': '<path d="M3.5 13V8.5"/><path d="M8 13V3"/><path d="M12.5 13V6"/>',
  '自动化': '<circle cx="8" cy="8" r="5.6"/><path d="M9.2 4.8L6.7 8.6h2.3l-2 3.3"/>',
  'Web 与会话': '<circle cx="7" cy="7" r="4.8"/><path d="M7 4.8V7l1.8 1.2"/><path d="M10.6 10.6l2.6 2.6"/>',
  '工作流': '<circle cx="4" cy="4" r="1.8"/><circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="8" r="1.8"/><path d="M5.8 4h2.4a2 2 0 0 1 2 2v.4M5.8 12h2.4a2 2 0 0 0 2-2v-.4"/>',
}

var SETTINGS_NAV_ICON_MARK = 'data-dsh-admin-nav-icon'

/** Build one 16×16 outline SVG carrying the official navIcon css class. */
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
  var observer = new MutationObserver(repaint)
  observer.observe(document.body, { childList: true, subtree: true })
  repaint()
  return function () { observer.disconnect() }
}

/* ========================================================================== */
/* Menu Popup Injection (Sessions & Workspaces) */
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
    var btn = row.querySelector(dshT('button[aria-label*="会话" i][aria-label*="操作" i], button[aria-label*="session" i][aria-label*="actions" i]'))
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
      if (r.querySelector(dshT('button[aria-label*="会话" i][aria-label*="操作" i], button[aria-label*="工作区" i][aria-label*="操作" i], button[aria-label*="session" i][aria-label*="actions" i], button[aria-label*="workspace" i][aria-label*="actions" i]'))) {
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
        }, function () { showToast('error', dshT('❌ 无法加载会话列表')) })
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
          if (match === null) { showToast('error', dshT('❌ 未找到匹配的会话')); return }
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
          if (exact.length === 0) { showToast('error', dshT('❌ 未找到匹配的会话')); return }
          if (exact.length > 1) {
            showToast('error', dshT('❌ 存在 ') + String(exact.length) + dshT(' 个同名会话，无法确定要删除的目标；请在 设置 → 历史会话 中按会话 ID 删除'))
            return
          }
          cb(exact[0])
        })
      }

      // Copy the session id to the clipboard.
      appendMenuItem(viewport, dshT('复制会话 ID'), 'normal', function () {
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
      appendMenuItem(viewport, dshT('删除会话'), 'danger', function () {
        resolveSessionExact(function (match) {
          var method = match.live ? 'sessionAdmin/closeSession' : 'sessionAdmin/deleteSession'
          call(method, { sessionId: match.id }).then(function (result) {
            if (result && result.ok) {
              showToast('success', dshT('🗑️ 会话已删除'))
              // Nudge the sidebar so the removed session vanishes now
              // instead of lingering in 未分组 until reload.
              if (refreshSessions) refreshSessions()
            } else {
              showToast('error', dshT('❌ 删除会话失败：') + messageOf(result && result.error))
            }
          }, function (err) { showToast('error', dshT('❌ 删除会话失败：') + messageOf(err)) })
        })
      }, dshT('⚠️ 再点一次确认删除（在线会话将先关停）'))
    } else {
      // Workspace: reveal in file manager. Path is resolved lazily at click.
      var wsTitle = (row.querySelector('[class*="_title"]') || {}).textContent || ''
      wsTitle = wsTitle.trim()
      if (wsTitle === '') return
      appendMenuItem(viewport, dshT('在资源管理器打开'), 'normal', function () {
        call('sessionAdmin/list', {}).then(function (listResult) {
          var workspaces = (listResult && listResult.ok && listResult.value && listResult.value.workspaces) || []
          var wsPath = null
          for (var i = 0; i < workspaces.length; i++) {
            var w = workspaces[i]
            var wTitle = (w && w.title) || ''
            if (wTitle === wsTitle || (wsTitle !== '' && wTitle !== '' && (wsTitle.indexOf(wTitle) !== -1 || wTitle.indexOf(wsTitle) !== -1))) { wsPath = w && w.path; break }
          }
          if (wsPath === null) { showToast('error', dshT('❌ 打开失败：未找到工作区路径')); return }
          call('fsAdmin/reveal', { path: wsPath }).then(function (result) {
            // Success needs no toast — the Explorer window opening is the
            // feedback itself. Only failures get a hint.
            if (!(result && result.ok)) showToast('error', dshT('❌ 打开失败：') + messageOf(result && result.error))
          }, function (err) { showToast('error', dshT('❌ 打开失败：') + messageOf(err)) })
        }, function () { showToast('error', dshT('❌ 打开失败：无法加载工作区列表')) })
      })
    }
  }

  function appendMenuItem(viewport, label, kind, onClick, confirmText) {
    // Separator (only if there are already items — always, to visually group)
    var sep = document.createElement('div')
    sep.setAttribute('role', 'separator')
    sep.setAttribute('data-dsh-admin-injected', '')
    sep.style.cssText = 'margin:3px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(200,200,210,0.3))'
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
        var el = /** @type {Element} */ (node)
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

/** Package-local chunk holding every panel implementation. */
var PANELS_CHUNK = './client.panels.js'
/** Loaded chunk module (null until it arrives). */
var panelsModule = null
/** In-flight load, shared by every slot that renders first. */
/** The loader-shaped require: the host hands the factory a table lookup that
 * also carries `async` for package-local chunks. Typed locally because the
 * source compiles against Node's Require, which has no such member. */
/** @type {{ async?: (spec: string) => Promise<Record<string, any>> }} */
var loaderRequire = /** @type {any} */ (require)
var panelsLoad = null
/** Load failure, surfaced inside the placeholder instead of a blank panel. */
var panelsError = null

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
          baseName: baseName,
          formatDate: formatDate,
          messageOf: messageOf,
          sectionState: sectionState,
          showToast: showToast,
          copyTextToClipboard: copyTextToClipboard,
          copyTextSilently: copyTextSilently,
          downloadTextFile: downloadTextFile,
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
  return function LazyPanel(props) {
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
      if (loaded === null) {
        loadPanels().then(function () {
          if (alive) setModule(panelsModule)
        }).catch(function (error) {
          // The failure is STATE, not a module variable: the placeholder used to
          // read `panelsError` directly, but nothing re-rendered when it was set,
          // so a chunk that failed to arrive (a stale immutable cache entry after
          // an upgrade, a dev-server restart, a CSP block) left every panel on
          // "加载面板…" forever with no explanation and no way to retry.
          if (alive) setFailure(messageOf(error) || dshT('未知错误'))
        })
      }
      return function () { alive = false }
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

function apply(ctx) {
  // Phase E: official-first. Panels whose official counterpart is mounted do
  // not register at all (auto-yield); `dsh-admin-panels` in localStorage
  // forces one back on. See src/client/native-coverage.js for the table.
  var coverage = resolveNativeCoverage(ctx)
  if (coverage.yielded.length > 0) {
    ctx.logger?.info?.('plugin-admin: 官方已覆盖，让位面板：' + coverage.yielded.map(function (row) { return row.panel }).join(', '))
  }
  // Shell locale service (soft dependency): register the panel table and
  // bind dshT to the shell's active locale. Absent on headless mounts — the
  // two-language fallback inside i18n.js keeps working either way.
  ctx.effect(function () { return installLocaleRuntime(ctx) }, 'plugin-admin: locale runtime')

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

  // Settings-nav icon identity: repaint the four plugin pages' nav rows with
  // distinct per-page icons (the shell paints one generic gear for unknown
  // section ids). Observer lives for the page lifetime like the menu one.
  ctx.effect(function () { return setupSettingsNavIcons() })

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
  var writePolicyCache = function (states) {
    try { window.localStorage.setItem(POLICY_CACHE_KEY, JSON.stringify(states)) } catch (error) { /* private mode */ }
  }
  var panelStates = readPolicyCache()
  var slotDisposed = false
  ctx.effect(function () { return function () { slotDisposed = true } }, 'plugin-admin: slot lifecycle')
  var yielded = function (panel) {
    var state = panelStates[panel] || 'auto'
    if (state === 'off') return true
    if (state === 'on') return false
    return coverage.active[panel] === false
  }

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
    panel: 'skills',
    slot: 'settings.plugins.tab',
    options:       {
              name: 'settings.plugins.tab',
              id: 'skills',
              order: 30,
              label: function () { return dshT('技能') },
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('SkillsSection')),
  },
  {
    panel: 'sessions',
    slot: 'settings.section',
    options:       {
              name: 'settings.section',
              id: 'web-sessions',
              order: 27,
              label: function () { return dshT('Web 与会话') },
              inject: function () { return { call: call, refreshSessions: refreshSessions } },
          },
    component: withLocale(lazyPanel('WebSessionsSection')),
  },
  {
    panel: 'subagents',
    slot: 'settings.plugins.tab',
    options:       {
              name: 'settings.plugins.tab',
              id: 'subagent-admin',
              order: 50,
              label: function () { return dshT('子智能体') },
              inject: function () { return { call: call } },
          },
    component: withLocale(lazyPanel('SubagentAdminSection')),
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
  var injectDisposers = {}
  var registerDisposers = {}
  var installOne = function (spec) {
    if (slotDisposed || injectDisposers[spec.panel] !== undefined) return
    injectDisposers[spec.panel] = ctx.slots.inject(spec.slot, function () {
      if (yielded(spec.panel)) return undefined
      var dispose = ctx.slots.register(spec.options, spec.component)
      registerDisposers[spec.panel] = dispose
      return dispose
    })
  }
  var uninstallOne = function (panel) {
    // Drop the inject subscription too, so a later reconcile can install again.
    // Without this the slot stays injected (harmless in itself) while
    // `installOne`'s guard keeps refusing to re-register — the actual bug.
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
      if (yielded(spec.panel)) { uninstallOne(spec.panel); continue }
      installOne(spec)
    }
  }

  reconcileSlots()

  // The ask. On success the answer becomes the cache and reconciliation runs again;
  // on failure nothing changes (cache, else auto-yield). A mount WITHOUT a
  // connection (a harness, a headless shell) must not throw here either.
  var ask = null
  try { ask = call('pluginAdmin/panels', {}) } catch (error) { ask = null }
  if (ask !== null && typeof ask.then === 'function') {
    ask.then(function (result) {
      var panels = result && result.ok !== false && result.value ? result.value.panels : null
      if (panels === null || panels === undefined || typeof panels !== 'object') return
      panelStates = panels
      writePolicyCache(panels)
      reconcileSlots()
    }, function () { /* no host answer: the cache or the coverage table decides */ })
  }
}

// `loadPanels` rides the exports for the harnesses: SessionsSection /
// WorkspacesSection / WorkflowSection now live in the chunk, so a test that
// mounts one directly asks for the module first. The dsh module loader reads
// only `apply` / `inject`; the extra key is inert at runtime.

export { apply, loadPanels }
