/** todo — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { copyTextSilently, createElement, dshT, messageOf, showToast, useEffect, useRef, useState } from './context.js'

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

/** Completed: filled check disc (green via the glyph cell's currentColor). */
export function TodoAdminCompletedGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 6.4, stroke: 'currentColor', strokeWidth: 1.2 }),
    createElement('path', { d: 'M4.2 7.2L6.1 9.1L9.9 4.9', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

/** In-progress: gradient ring spun by the glyph cell's CSS animation. */
export function TodoAdminProgressGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 5.6, stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeDasharray: '24 12' }),
  )
}

/** Pending: dashed unstarted ring. */
export function TodoAdminPendingGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 6.4, stroke: 'currentColor', strokeWidth: 1.2, strokeDasharray: '2.4 2.4' }),
  )
}

export function TodoAdminStatusGlyph(status) {
  if (status === 'completed') return createElement(TodoAdminCompletedGlyph, { key: 'g' })
  if (status === 'in_progress') return createElement(TodoAdminProgressGlyph, { key: 'g' })
  return createElement(TodoAdminPendingGlyph, { key: 'g' })
}

/**
 * Derive the footer's 「第 X / Y 步」 from the list itself: the first
 * in_progress item's position, or the total once everything settled.
 */
export function todoAdminStep(list) {
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

/** The file row's status letter, sanitized to the renderable kinds (C = copy). */
export function todoAdminStatusLetter(status) {
  return status === 'M' || status === 'A' || status === 'D' || status === 'R' || status === 'C' || status === '?' ? status : 'M'
}

/** One git-status file row: colored letter, dim dir prefix + filename, +/- deltas.
 * A button — clicking reveals the file (or its directory, when deleted) in the
 * system explorer via fsAdmin/reveal. */
export function TodoAdminFileRow(item, index, reveal) {
  var st = todoAdminStatusLetter(item.status)
  var path = typeof item.path === 'string' && item.path !== '' ? item.path : dshT('（未知路径）')
  var added = typeof item.added === 'number' && item.added > 0 ? item.added : 0
  var removed = typeof item.removed === 'number' && item.removed > 0 ? item.removed : 0
  var nums = [
    createElement('span', { key: 'a', className: 'a' + (added === 0 ? ' zero' : '') }, '+' + added),
    createElement('span', { key: 'd', className: 'd' + (removed === 0 ? ' zero' : '') }, '-' + removed),
  ]
  var slash = path.lastIndexOf('/')
  var dir = slash > 0 ? path.slice(0, slash + 1) : null
  var name = slash > 0 ? path.slice(slash + 1) : path
  var target = typeof item.absPath === 'string' && item.absPath !== '' ? item.absPath
    : (typeof item.absDir === 'string' && item.absDir !== '' ? item.absDir : null)
  var rowProps = {
    key: index,
    type: 'button',
    className: 'todo-file',
    'data-st': st,
    title: target !== null ? path + dshT('\n点击在资源管理器中定位') : path,
  }
  if (target !== null && typeof reveal === 'function') {
    rowProps.onClick = function () { reveal(target) }
  } else {
    rowProps.disabled = true
  }
  return createElement('button', rowProps,
    createElement('span', { className: 'st', 'aria-hidden': 'true' }, st),
    createElement('span', { className: 'p' },
      dir ? createElement('span', { key: 'dir', className: 'dir' }, dir) : null,
      createElement('span', { key: 'name', className: 'name' }, name),
    ),
    createElement('span', { className: 'n' }, nums),
  )
}

/** Collapse-completed summary row: "✓ N 已完成" — click expands the struck items. */
export function TodoAdminDoneRow(done, expanded, toggleDone) {
  return createElement('li', { key: 'done-row', className: 'todo-done-row' },
    createElement('button', {
      type: 'button',
      className: 'todo-done-toggle',
      'aria-expanded': expanded ? 'true' : 'false',
      onClick: toggleDone,
    },
    createElement('span', { className: 'todo-glyph', 'aria-hidden': 'true' }, createElement(TodoAdminCompletedGlyph, null)),
    createElement('span', { className: 'todo-done-label' }, done + dshT(' 项已完成')),
    createElement('span', { className: 'todo-chevron', 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
    ))
}

/** Compact elapsed text: 42秒 / 7分24秒 / 1时2分. */
export function formatElapsed(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  var total = Math.floor(ms / 1000)
  if (total < 60) return total + dshT('秒')
  var minutes = Math.floor(total / 60)
  var seconds = total % 60
  if (minutes < 60) return minutes + dshT('分') + (seconds > 0 ? seconds + dshT('秒') : '')
  return Math.floor(minutes / 60) + dshT('时') + (minutes % 60) + dshT('分') + (seconds > 0 ? seconds + dshT('秒') : '')
}

/**
 * Render the todo dock: progress bar, todo rows (done section collapsible),
 * the git file-change section with branch badge, footer.
 * @param ui - { collapsed, toggle, activeRef, doneCollapsed, toggleDone,
 *   elapsedOf, reveal, branch, files, added, removed }.
 */
export function TodoAdminRender(list, stats, ui) {
  var children = []
  var completed = 0
  for (var c = 0; c < list.length; c++) {
    if ((list[c] || {}).status === 'completed') completed++
  }
  var total = list.length
  // Slim progress bar across the panel top: completion ratio, green at 100%.
  var percent = total > 0 ? Math.round((completed / total) * 100) : 0
  children.push(createElement('div', { key: 'progress', className: 'todo-progress', 'aria-hidden': 'true' },
    createElement('div', {
      className: 'todo-progress-fill' + (percent >= 100 ? ' full' : ''),
      style: { width: percent + '%' },
    }),
  ))

  if (!ui.collapsed) {
    var items = []
    var activeAttached = false
    var doneShown = 0
    for (var i = 0; i < total; i++) {
      var item = list[i] || {}
      var status = typeof item.status === 'string' ? item.status : 'pending'
      if (status === 'completed') {
        doneShown++
        // The done section folds into one summary row; expanding restores
        // the struck-through entries (ai-ux: auto-dismiss, keep accessible).
        if (ui.doneCollapsed) continue
      }
      var liProps = { key: i, className: 'todo-item', 'data-status': status }
      if (status === 'in_progress' && !activeAttached && ui.activeRef) {
        liProps.ref = ui.activeRef
        activeAttached = true
      }
      var elapsed = status === 'in_progress' && typeof ui.elapsedOf === 'function' ? ui.elapsedOf(item.content) : null
      items.push(createElement('li', liProps,
      createElement('span', { className: 'todo-glyph', 'aria-hidden': 'true' }, TodoAdminStatusGlyph(item.status)),
      createElement('span', { className: 'todo-text' }, typeof item.content === 'string' ? item.content : ''),
      elapsed !== null ? createElement('span', { className: 'todo-elapsed' }, formatElapsed(elapsed)) : null,
      ))
    }
    if (doneShown > 0) {
      items.unshift(TodoAdminDoneRow(doneShown, !ui.doneCollapsed, ui.toggleDone))
    }
    children.push(createElement('ul', { key: 'list', className: 'todo-list' }, items))
    var changed = stats !== null && Array.isArray(stats.changed) ? stats.changed : []
    if (changed.length > 0) {
      var rows = []
      for (var f = 0; f < changed.length; f++) rows.push(TodoAdminFileRow(changed[f], f, ui.reveal))
      var headParts = []
      if (typeof ui.branch === 'string' && ui.branch !== '') {
        headParts.push(createElement('span', { key: 'branch-icon', className: 'branch', 'aria-hidden': 'true' }, '⎇'))
        headParts.push(createElement('span', { key: 'branch', className: 'branch-name' }, ui.branch))
      }
      headParts.push(createElement('button', {
        type: 'button',
        key: 'copy-diff',
        className: 'todo-copy-diff',
        title: dshT('复制完整 git diff（HEAD vs 工作区）'),
        onClick: ui.copyDiff,
      }, ui.diffCopied ? dshT('✓ 已复制') : dshT('⧉ 复制 diff')))
      children.push(createElement('div', { key: 'files', className: 'todo-files' },
        createElement('div', { key: 'head', className: 'todo-files-head' }, headParts),
        createElement('div', { key: 'rows' }, rows),
      ))
    }
  }

  var steps = todoAdminStep(list)
  var hasStats = stats !== null && stats.files > 0
  var statsParts = []
  if (hasStats) {
    statsParts.push(createElement('span', { key: 'files' }, stats.files + dshT(' 个文件已改')))
    statsParts.push(createElement('span', { key: 'add', className: 'num-add' }, '+' + stats.added))
    statsParts.push(createElement('span', { key: 'del', className: 'num-del' }, '-' + stats.removed))
  }
  statsParts.push(createElement('span', { key: 'chevron', className: 'todo-chevron', 'aria-hidden': 'true' }, ui.collapsed ? '▲' : '▼'))
  children.push(createElement('button', {
    type: 'button',
    key: 'footer',
    className: 'todo-footer',
    'aria-expanded': ui.collapsed ? 'false' : 'true',
    onClick: ui.toggle,
  },
  createElement('span', { key: 'steps', className: 'todo-steps' }, dshT('第 ') + steps.current + ' / ' + steps.total + dshT(' 步')),
  createElement('span', { key: 'stats', className: 'todo-stats' }, statsParts),
  ))
  // Notification bell floats over the panel's top edge, outside the click-to-
  // collapse surfaces. Absent entirely on platforms without Notifications.
  if (typeof Notification !== 'undefined') {
    children.push(createElement('button', {
      type: 'button',
      key: 'notify',
      className: 'todo-notify' + (ui.notifyEnabled ? ' on' : ''),
      title: ui.notifyEnabled
        ? dshT('桌面通知：开（页面在后台且待办全部完成时提醒）— 点击关闭')
        : dshT('桌面通知：关 — 点击开启（页面在后台且待办全部完成时提醒）'),
      'aria-pressed': ui.notifyEnabled ? 'true' : 'false',
      onClick: ui.toggleNotify,
    }, TodoAdminBellGlyph(ui.notifyEnabled)))
  }
  return createElement('section', {
    'data-dsh-admin-todo': '',
    'aria-label': dshT('待办清单'),
  }, children)
}

/** Bell outline; the off state adds a slash so the toggle reads at a glance. */
export function TodoAdminBellGlyph(on) {
  return createElement('svg', {
    width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
  createElement('path', { d: 'M8 2.2a4 4 0 0 0-4 4c0 3.1-1.2 4.3-1.2 4.3h10.4S12 9.3 12 6.2a4 4 0 0 0-4-4z' }),
  createElement('path', { d: 'M6.7 13.1a1.4 1.4 0 0 0 2.6 0' }),
  on ? null : createElement('path', { d: 'M2.5 2.5l11 11' }),
  )
}

// First-seen-in-progress timestamps, keyed 'sessionId\u0000content', so the
// active step can show a live elapsed counter (Claude Code's "visibly tick"
// pattern) without inventing data — the clock starts when the dock first
// observes the item, so a page reload resets it.
export var todoActiveSince = new Map()

export var TODO_DONE_KEY = 'dsh-admin-todo-hide-done'

export var TODO_NOTIFY_KEY = 'dsh-admin-todo-notify'

export function readDoneCollapsed() {
  try { return window.localStorage.getItem(TODO_DONE_KEY) === '1' } catch (e) { return false }
}

/**
 * The dock entry component. Framework props: useProjection (session
 * standard kit) — everything else arrives via the registration's inject.
 */
export function TodoAdminDock(props) {
  var useProjection = props.useProjection
  // The projection hook is part of the standard kit seat; call it
  // unconditionally at the top so hook order stays stable across renders.
  var todos = typeof useProjection === 'function' ? useProjection('todos') : null
  var list = Array.isArray(todos) ? todos : []
  var show = list.length > 0

  var collapsedState = useState(false)
  var collapsed = collapsedState[0]
  var setCollapsed = collapsedState[1]

  var doneCollapsedState = useState(readDoneCollapsed)
  var doneCollapsed = doneCollapsedState[0]
  var setDoneCollapsed = doneCollapsedState[1]

  var statsState = useState(null)
  var stats = statsState[0]
  var setStats = statsState[1]

  // Live elapsed counter for the in-progress step: maintain first-seen
  // timestamps for the session's active contents, then tick once a second
  // while any is active.
  var nowState = useState(null)
  var nowMs = nowState[0]
  var setNow = nowState[1]
  var sessionId = props.sessionId
  var call = props.call

  useEffect(function () {
    if (!show || typeof sessionId !== 'string') return undefined
    var keyPrefix = sessionId + '\u0000'
    var actives = []
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {}
      if (item.status === 'in_progress' && typeof item.content === 'string') actives.push(item.content)
    }
    var now = Date.now()
    var addedNew = false
    for (var a = 0; a < actives.length; a++) {
      var key = keyPrefix + actives[a]
      if (!todoActiveSince.has(key)) {
        todoActiveSince.set(key, now)
        addedNew = true
      }
    }
    var stale = []
    todoActiveSince.forEach(function (v, k) {
      if (k.indexOf(keyPrefix) === 0) {
        if (actives.indexOf(k.slice(keyPrefix.length)) === -1) stale.push(k)
      } else {
        // Another session's entry: it would otherwise live until the page
        // reloads (the same-session pass above cannot see it), so switching
        // sessions drops the previous session's timestamps here.
        stale.push(k)
      }
    })
    for (var s = 0; s < stale.length; s++) todoActiveSince.delete(stale[s])
    if (addedNew || stale.length > 0) setNow(now)
    if (actives.length === 0) return undefined
    var timer = setInterval(function () { setNow(Date.now()) }, 1000)
    return function () { clearInterval(timer) }
  }, [show, sessionId, todos])

  var elapsedOf = function (content) {
    if (typeof nowMs !== 'number' || typeof sessionId !== 'string') return null
    var start = todoActiveSince.get(sessionId + '\u0000' + content)
    if (typeof start !== 'number') return null
    return Math.max(0, nowMs - start)
  }

  var toggleDone = function () {
    setDoneCollapsed(function (v) {
      var next = !v
      try { window.localStorage.setItem(TODO_DONE_KEY, next ? '1' : '0') } catch (e) { /* private mode */ }
      return next
    })
  }

  var reveal = function (path) {
    if (typeof call !== 'function' || typeof path !== 'string' || path === '') return
    // Explorer opening is its own success feedback; a failure would
    // otherwise read as a dead click (the workspace menu already toasts).
    call('fsAdmin/reveal', { path: path }).then(function (result) {
      if (!(result && result.ok)) showToast('error', dshT('❌ 打开失败：') + messageOf(result && result.error))
    }, function (err) { showToast('error', dshT('❌ 打开失败：') + messageOf(err)) })
  }

  // Copy-diff: pulls the workspace's full `git diff HEAD` on demand (the
  // payload is far too big to ride the stats poll) and lands it on the
  // clipboard; the button flashes ✓ so the gesture reads as done.
  var copyDiffState = useState(false)
  var diffCopied = copyDiffState[0]
  var setDiffCopied = copyDiffState[1]
  var copyDiffTimer = useRef(null)
  useEffect(function () {
    return function () { if (copyDiffTimer.current) clearTimeout(copyDiffTimer.current) }
  }, [])
  var copyDiff = function () {
    if (typeof call !== 'function' || typeof sessionId !== 'string') return
    call('sessionAdmin/gitDiff', { sessionId: sessionId }).then(function (res) {
      var value = res && res.ok && res.value && typeof res.value === 'object' ? res.value : null
      if (value === null || typeof value.diff !== 'string') {
        showToast('error', dshT('❌ 获取 diff 失败'))
        return
      }
      // A git failure is NOT a clean tree. Reporting "工作区干净" here copied an
      // empty string and told the user the opposite of what was true, which is
      // what a timeout on a large repo used to look like.
      if (typeof value.error === 'string' && value.error !== '') {
        showToast('error', '❌ ' + value.error)
        return
      }
      if (value.diff === '') {
        showToast('success', dshT('工作区干净，没有未提交的改动'))
        return
      }
      copyTextSilently(value.diff).then(function () {
        setDiffCopied(true)
        if (copyDiffTimer.current) clearTimeout(copyDiffTimer.current)
        copyDiffTimer.current = setTimeout(function () { setDiffCopied(false) }, 1500)
      }, function () {
        showToast('error', dshT('❌ 复制失败'))
      })
    }, function () {
      showToast('error', dshT('❌ 获取 diff 失败'))
    })
  }

  // Desktop notification on the all-done transition (attention tier, from
  // the agent-status pattern library): fires only when the tab is hidden —
  // if the user is looking at the panel, a toast would be noise.
  var notifyEnabledState = useState(function () {
    try {
      return typeof Notification !== 'undefined' && Notification.permission === 'granted'
        && window.localStorage.getItem(TODO_NOTIFY_KEY) === '1'
    } catch (e) { return false }
  })
  var notifyEnabled = notifyEnabledState[0]
  var setNotifyEnabled = notifyEnabledState[1]
  var allDone = false
  if (show) {
    allDone = true
    for (var d = 0; d < list.length; d++) {
      if ((list[d] || {}).status !== 'completed') { allDone = false; break }
    }
  }
  var prevAllDoneRef = useRef(false)
  useEffect(function () {
    var entered = allDone && !prevAllDoneRef.current
    prevAllDoneRef.current = allDone
    if (!entered || !notifyEnabled) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (typeof document !== 'undefined' && !document.hidden) return
    try {
      var last = list[list.length - 1] || {}
      var notification = new Notification(dshT('✅ 待办全部完成'), {
        body: dshT('共 ') + list.length + dshT(' 项 · ') + (typeof last.content === 'string' ? last.content : ''),
        tag: 'dsh-admin-todo-done',
      })
      notification.onclick = function () {
        try { window.focus(); notification.close() } catch (e) { /* already closed */ }
      }
    } catch (e) { /* some platforms throw without an active service worker */ }
  }, [allDone, notifyEnabled, todos])
  var toggleNotify = function () {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      setNotifyEnabled(function (v) {
        var next = !v
        try { window.localStorage.setItem(TODO_NOTIFY_KEY, next ? '1' : '0') } catch (e) { /* private mode */ }
        return next
      })
      return
    }
    if (Notification.permission === 'denied') {
      showToast('error', dshT('通知权限已被浏览器拒绝，请在站点设置中允许后重试'))
      return
    }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') {
        setNotifyEnabled(true)
        try { window.localStorage.setItem(TODO_NOTIFY_KEY, '1') } catch (e) { /* private mode */ }
      }
    }).catch(function () { /* permission prompt dismissed */ })
  }

  // Keep the current step (first in-progress item) inside the clipped list's
  // view whenever the todo list changes; nearest-scroll never yanks the user
  // around inside the container. jsdom has no scrollIntoView — the guard
  // keeps the verify render a no-op there.
  var activeItemRef = useRef(null)
  useEffect(function () {
    var node = activeItemRef.current
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' })
    }
  }, [todos])

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
  useEffect(function () {
    if (!show || !sessionId || typeof call !== 'function') return undefined
    var disposed = false
    var tick = function () {
      call('sessionAdmin/fileStats', { sessionId: sessionId }).then(function (res) {
        var value = res && res.ok && res.value && typeof res.value === 'object' ? res.value : null
        if (disposed || value === null) return
        // git could not be read (failed or timed out): hide the segment by
        // clearing the stats rather than rendering all-zeroes, which would
        // assert "no changes" from a reading that never happened.
        if (typeof value.error === 'string' && value.error !== '') {
          setStats(function (prev) { return prev === null ? prev : null })
          return
        }
        setStats(function (prev) {
          if (prev && prev.files === value.files && prev.added === value.added && prev.removed === value.removed
            && prev.branch === (typeof value.branch === 'string' ? value.branch : null)) return prev
          return {
            files: value.files,
            added: value.added,
            removed: value.removed,
            branch: typeof value.branch === 'string' && value.branch !== '' ? value.branch : null,
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

  return TodoAdminRender(list, stats, {
    collapsed: collapsed,
    toggle: function () { setCollapsed(function (v) { return !v }) },
    activeRef: activeItemRef,
    doneCollapsed: doneCollapsed,
    toggleDone: toggleDone,
    elapsedOf: elapsedOf,
    reveal: reveal,
    branch: stats !== null ? stats.branch : null,
    copyDiff: copyDiff,
    diffCopied: diffCopied,
    notifyEnabled: notifyEnabled,
    toggleNotify: toggleNotify,
  })
}
