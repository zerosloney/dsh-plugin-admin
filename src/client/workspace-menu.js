/**
 * workspace-menu.js — 「打开工作目录」 in the native Workspace row menu.
 *
 * WHY THIS IS THE PLUGIN'S ONE DOM HOOK. The Session row's "..." menu is an
 * official list slot (`sidebar.workspaces.session.menu.item`), and the delete
 * row rides it. The Workspace row's menu is not: ui-workspace hardcodes exactly
 * two rows (rename + delete, `ProjectRowItem` in
 * packages/client/ui-workspace/src/client/rows/Rows.tsx) and declares no slot
 * for it, so "below 删除工作区" cannot be reached by registration at all.
 *
 * WHAT IT KEYS ON — structure, never copy. The old menu scraper found the menu
 * by an `aria-label` selector, classified it by the literal label text
 * (`删除工作区` / `Delete workspace`), and then mapped the row back to a session
 * by fuzzy title matching; every step could pick the wrong object. This hook
 * keeps only what cannot be wrong:
 *
 *   - the trigger is a click anywhere inside `[data-row-key="workspace:<id>"]`
 *     (ui-workspace's own row attribute, `Rows.tsx`); the nearest row wins, so
 *     a Session row nested in the group can never arm it;
 *   - `<id>` IS the Workspace id (`groupByWorkspace` passes `workspace.workspaceId`
 *     as the group key), so the row identifies the workspace exactly;
 *   - the menu is whatever `[role="menu"]` portal appears within the next
 *     second — no label is read or matched, and a menu that was already open
 *     when the click landed is ignored;
 *   - the path is resolved host-side from that id (`workspaceAdmin/list`), so
 *     the client never guesses a directory; `fsAdmin/reveal` re-gates it.
 *
 * The row is a clone of a native menuitem, so it inherits the host's own
 * styling (and its hover/focus behaviour); the click handler is ours, because a
 * cloned node carries no React handler — which is also why a mis-click can
 * never fall through to the host's own delete row.
 */
import { dshT } from './i18n.js'

/** Host row attribute: `<key>` is the Workspace id for a real group. */
var ROW_PREFIX = 'workspace:'
/** Marks the injected row (and its menu) so a second mutation pass is a no-op. */
var MARK = 'data-dsh-admin-open-dir'

/**
 * Turn one cloned native row into the reveal row.
 * @param {Element} copy - cloned `button[role="menuitem"]` wrapper.
 * @param {Element|null} glyph - the row's own folder glyph (cloned in), so the
 *   menu row draws the same 16px outline icon the row does instead of one this
 *   bundle would have to carry.
 * @param {string} label
 * @param {(event: Event) => void} onSelect
 * @returns {HTMLButtonElement|null} the button, or null for a menuitem shape
 *   this hook has not seen (no icon + label pair), in which case nothing is
 *   injected rather than guessing at the row's layout.
 */
function decorate(copy, glyph, label, onSelect) {
  var button = /** @type {HTMLButtonElement|null} */ (copy.querySelector('button[role="menuitem"]'))
  if (button === null || button.children.length < 2) return null
  var drop = ['aria-current', 'aria-keyshortcuts', 'aria-haspopup', 'disabled', 'aria-disabled']
  for (var i = 0; i < drop.length; i++) button.removeAttribute(drop[i])
  // A missing glyph still reserves the icon column, so the label stays aligned
  // with 重命名/删除工作区 instead of jumping left.
  if (glyph === null) button.children[0].replaceChildren()
  else button.children[0].replaceChildren(glyph.cloneNode(true))
  button.children[1].textContent = label
  button.addEventListener('click', onSelect)
  return button
}

/**
 * Install the row. Returns a disposer (the caller mounts it through
 * `ctx.effect`, so an unmount removes the listener and the observer).
 * @param {{ call: (method: string, args: any) => Promise<any>,
 *           notify: (type: string, text: string) => void,
 *           describeError: (error: any) => string }} options
 * @returns {() => void}
 */
export function installWorkspaceMenuOpenDir(options) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return function () {}
  /** @type {Document} */
  var doc = document
  var call = options.call
  var notify = options.notify
  var describe = options.describeError
  /** Armed workspace id; empty when no menu is expected. @type {string} */
  var armed = ''
  /** The armed row's leading folder glyph, cloned into the menu row. @type {Element|null} */
  var armedGlyph = null
  /** Menus that were already open when the click landed. @type {Element[]} */
  var preexisting = []
  /** @type {MutationObserver|null} */
  var observer = null
  /** @type {any} */
  var timer = null

  /** Close the host menu the way an outside pointer does (it owns the state). */
  function closeMenu() {
    var win = /** @type {any} */ (doc.defaultView)
    var Ctor = win !== null && win !== undefined && typeof win.MouseEvent === 'function' ? win.MouseEvent : null
    if (Ctor === null) return
    try {
      doc.body.dispatchEvent(new Ctor('pointerdown', { bubbles: true }))
    } catch (ignored) { /* dismissal is best effort; the reveal already happened */ }
  }

  /**
   * Resolve the id to its canonical path host-side, then reveal it. Nothing is
   * cached: a workspace the registry has since renamed or moved must open where
   * the registry says NOW.
   * @param {string} workspaceId
   */
  function reveal(workspaceId) {
    closeMenu()
    call('workspaceAdmin/list', {}).then(function (/** @type {any} */ result) {
      var value = result !== null && result !== undefined && result.ok === true ? result.value : null
      var rows = value !== null && value !== undefined && Array.isArray(value.workspaces) ? value.workspaces : []
      var path = ''
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        if (row !== null && typeof row === 'object' && row.workspaceId === workspaceId
          && typeof row.path === 'string' && row.path !== '') {
          path = row.path
          break
        }
      }
      if (path === '') {
        notify('error', dshT('❌ 打开失败：未找到工作区路径'))
        return
      }
      return call('fsAdmin/reveal', { path: path }).then(function (/** @type {any} */ opened) {
        if (opened === null || opened === undefined || opened.ok !== true) {
          notify('error', dshT('❌ 打开失败：') + describe(opened === null || opened === undefined ? '' : opened.error))
        }
      })
    }, function (error) {
      notify('error', dshT('❌ 打开失败：') + describe(error))
    })
  }

  /**
   * Add the row to a freshly opened native menu.
   * @param {Element} menu
   * @returns {boolean} whether the row landed. A menu that is still empty when
   *   its portal first appears (React may commit the surface before its items)
   *   answers false so the watch keeps looking instead of giving up.
   */
  function inject(menu) {
    if (menu.getAttribute(MARK) !== null) return false
    var first = menu.querySelector('button[role="menuitem"]')
    var holder = first === null ? null : first.parentElement
    if (holder === null || holder.parentElement === null) return false
    // Bind the id NOW: the watch disarms as soon as the row is in, so reading
    // the armed slot later (at click time) would hand the reveal an empty id.
    var workspaceId = armed
    var copy = /** @type {Element} */ (holder.cloneNode(true))
    var button = decorate(copy, armedGlyph, dshT('打开工作目录'), function (event) {
      event.preventDefault()
      event.stopPropagation()
      reveal(workspaceId)
    })
    if (button === null) return false
    copy.setAttribute(MARK, workspaceId)
    menu.setAttribute(MARK, workspaceId)
    holder.parentElement.appendChild(copy)
    return true
  }

  function disarm() {
    armed = ''
    armedGlyph = null
    preexisting = []
    if (observer !== null) {
      observer.disconnect()
      observer = null
    }
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** Watch for the menu this click is about to open. @param {string} id */
  function arm(id, /** @type {Element|null} */ glyph) {
    disarm()
    armed = id
    armedGlyph = glyph
    var open = doc.querySelectorAll('[role="menu"]')
    for (var i = 0; i < open.length; i++) preexisting.push(open[i])
    observer = new MutationObserver(function () {
      if (armed === '') return
      var menus = doc.querySelectorAll('[role="menu"]')
      for (var j = 0; j < menus.length; j++) {
        if (preexisting.indexOf(menus[j]) !== -1) continue
        if (inject(menus[j])) disarm()
        return
      }
    })
    observer.observe(doc.body, { childList: true, subtree: true })
    // The + / chevron buttons in the same row open no menu: that click is then
    // a no-op and the watch must not leak into the next, unrelated menu.
    timer = setTimeout(disarm, 1500)
  }

  /** @param {Event} event */
  function onClick(event) {
    var target = /** @type {any} */ (event.target)
    if (target === null || typeof target !== 'object' || target.nodeType !== 1) return
    var row = /** @type {Element} */ (target).closest('[data-row-key]')
    if (row === null) return
    var key = row.getAttribute('data-row-key') || ''
    // An ungrouped bucket has an empty key -> no workspace to open.
    if (key.indexOf(ROW_PREFIX) !== 0 || key.length === ROW_PREFIX.length) return
    arm(key.slice(ROW_PREFIX.length), row.querySelector('svg'))
  }

  doc.addEventListener('click', onClick, true)
  return function () {
    doc.removeEventListener('click', onClick, true)
    disarm()
  }
}
