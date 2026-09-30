/** sessions — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiInput, UiPill, baseName, createElement, downloadTextFile, dshT, formatDate, messageOf, panelHidden, sectionState, showToast, useRef, useState } from './context.js'
import { tabKeyDown } from './shared.js'
import { WebSearchSection } from './web-search.js'

/**
 * The renderer-bound props the Web 与会话 entry receives: the RPC seam (its
 * result envelope is duck-typed per method — `{ ok: true, value }` /
 * `{ ok: false, error }` — so the resolved type stays `any` by design: a
 * boundary, not unmodelled data), plus the sidebar nudge the entry threads
 * down to 历史会话.
 * @typedef {{ call: (method: string, args: Record<string, any>) => Promise<any>, refreshSessions: (() => void) | null }} WebSessionsSectionProps
 */

// Error code dsh raises when full-text session search is not enabled; the
// 历史会话 search box turns it into the one-click enable banner.
export var SEARCH_DISABLED_MARKER = 'SESSION_QUERY_SEARCH_DISABLED'

/* ========================================================================== */
/*          Web 与会话 Section (历史会话 + Web 搜索, one nav entry)            */
/* ========================================================================== */

/**
 * ONE settings-nav entry for the two web/session panels: 历史会话 (default
 * tab — the former standalone section, and before that the DOM merge into
 * dsh's official 已归档会话 page) and Web 搜索 (the former standalone
 * section, order 31). The segmented tab bar reuses the shared
 * `data-cha-section` chrome — the same recipe the 自动化 page uses.
 * `refreshSessions` flows through so a deleted session leaves the sidebar
 * list immediately.
 * @param {WebSessionsSectionProps} props - the renderer-bound props; `call` arrives from the slot inject face, `refreshSessions` is the sidebar nudge.
 */
export function WebSessionsSection(props) {
  var tabHooks = useState('sessions')
  var tab = tabHooks[0]
  var setTab = tabHooks[1]
  // webSearch 没有独立 slot（与历史会话共用这一条 nav 入口），config.panels 的
  // off/on/auto 三态在这里落地：off（含自动让位）直接摘掉页签——旋钮不在就只是
  // 惰性摆设（挂载期还通过校验，承诺了"off 不注册，优先级最高"）。
  var tabs = [
    { id: 'sessions', label: dshT('历史会话'), component: SessionsSection },
  ]
  if (!panelHidden('webSearch')) {
    tabs.push({ id: 'websearch', label: dshT('Web 搜索'), component: WebSearchSection })
  }
  var selected = tabs.find(function (entry) { return entry.id === tab }) || tabs[0]
  return createElement('div', { 'data-cha-section': '' },
    createElement('div', { className: 'tabs', role: 'tablist', 'aria-label': dshT('Web 与会话'),
      onKeyDown: function (/** @type {KeyboardEvent} */ event) { tabKeyDown(event, tabs, selected.id, setTab) } },
      tabs.map(function (entry) {
        return createElement('button', {
          type: 'button', role: 'tab', key: entry.id,
          id: 'dsh-admin-tab-' + entry.id,
          'aria-controls': 'dsh-admin-panel-' + entry.id,
          tabIndex: entry.id === selected.id ? 0 : -1,
          className: 'tab' + (entry.id === selected.id ? ' active' : ''),
          'aria-selected': entry.id === selected.id,
          onClick: function () { setTab(entry.id) },
        }, entry.label)
      })
    ),
    createElement('div', { key: selected.id, role: 'tabpanel', id: 'dsh-admin-panel-' + selected.id, 'aria-labelledby': 'dsh-admin-tab-' + selected.id },
      createElement(selected.component, { call: props.call, refreshSessions: props.refreshSessions })
    )
  )
}

/**
 * 历史会话 panel — the default tab of the Web 与会话 section.
 * @param {WebSessionsSectionProps} props - the renderer-bound props; `call` arrives from the slot inject face, `refreshSessions` is the sidebar nudge.
 */
export function SessionsSection(props) {
  var kit = sectionState({
    sessions: [],
    workspaces: [],
    busy: false,
    error: '',
    needle: '',
    confirming: null,
    filter: 'all',
    fulltext: false,   // full-text search mode across all sessions
    fullNeedle: '',
    fullHits: null,    // null = not run yet; [] = no hits
    fullBusy: false,
    healthBySession: {}, // sessionId -> { loading?, report?, error? }
    searchDisabled: false,   // full-text search rejected with SESSION_QUERY_SEARCH_DISABLED
    searchEnableState: null, // null | 'enabling' | 'pending' (written, restart required)
    // Bulk deletion: the pending/running request ({ scope, label, plan }) and
    // its progress. Null = no bulk bar.
    bulk: null,
    bulkBusy: false,
    bulkDone: 0,
  })
  var sView = kit.state
  var setSView = kit.set

  // Pinned session ids (localStorage-backed; the host stays UI-preference-free).
  var pairPinned = useState(loadPinnedIds)
  var pinnedIds = pairPinned[0]
  var setPinnedIds = pairPinned[1]

  // Collapsed directory groups (localStorage-backed, same posture as pins).
  var pairCollapsed = useState(loadCollapsedGroups)
  var collapsedGroups = pairCollapsed[0]
  var setCollapsedGroups = pairCollapsed[1]

  /**
   * Toggle one directory group's folded state (persisted with the pins).
   * @param {string} key - the group key ('ungrouped' or 'ws-<workspaceId>').
   */
  function toggleGroupCollapsed(key) {
    setCollapsedGroups(function (/** @type {string[]} */ cur) {
      var next = cur.indexOf(key) !== -1 ? cur.filter(function (/** @type {string} */ k) { return k !== key }) : cur.concat([key])
      saveCollapsedGroups(next)
      return next
    })
  }

  /**
   * Fold or unfold every directory group at once.
   * @param {string[]} keys - the group keys to store (an empty list unfolds all).
   */
  function collapseAllGroups(keys) {
    var next = Array.isArray(keys) ? keys.slice() : []
    setCollapsedGroups(next)
    saveCollapsedGroups(next)
  }

  /**
   * The sessions a bulk request would delete: every session the current
   * filter + search show, or one directory group's sessions.
   * @param {string} scope - 'all' (current projection) or 'group'.
   * @param {string|null} groupKey - the group key for scope 'group'.
   * @returns {{ label: string, plan: Array<{ id: string, live: boolean }> }}.
   */
  function bulkTargets(scope, groupKey) {
    var needle = (sView.needle || '').trim().toLowerCase()
    var visible = filterSessions(sView.sessions, sView.filter, needle, pinnedIds)
    var sessions = visible
    var label = ''
    if (scope === 'group') {
      var groups = buildSessionGroups(visible, sView.workspaces || [])
      sessions = []
      for (var i = 0; i < groups.length; i++) {
        var key = groups[i].workspaceId === null ? 'ungrouped' : 'ws-' + groups[i].workspaceId
        if (key !== groupKey) continue
        sessions = groups[i].sessions
        label = groups[i].title || dshT('未命名')
        break
      }
    }
    var plan = []
    for (var j = 0; j < sessions.length; j++) {
      plan.push({ id: sessions[j].id, live: sessions[j].live === true })
    }
    return { label: label, plan: plan }
  }

  /**
   * Raise the bulk-delete confirmation bar for one scope.
   * @param {string} scope - 'all' (current projection) or 'group'.
   * @param {string|null} groupKey - the group key for scope 'group'.
   */
  function requestBulkDelete(scope, groupKey) {
    if (sView.bulkBusy) return
    var target = bulkTargets(scope, groupKey)
    if (target.plan.length === 0) return
    patchSession({ bulk: { scope: scope, label: target.label, plan: target.plan }, bulkDone: 0, error: '' })
  }

  /** Run the confirmed bulk deletion: one RPC per session, serially. */
  function runBulkDelete() {
    var bulk = sView.bulk
    if (bulk === null || bulk === undefined || sView.bulkBusy) return
    patchSession({ bulkBusy: true, bulkDone: 0, error: '' })
    var plan = bulk.plan
    var done = 0
    var failures = 0
    var step = function () {
      if (!alive.current) return
      if (done >= plan.length) {
        patchSession({ bulkBusy: false, bulk: null, bulkDone: 0 })
        if (failures > 0) {
          patchSession({ error: dshT('批量删除完成，') + String(failures) + dshT(' 个会话删除失败（详见交付历史/宿主日志）') })
        }
        if (props.refreshSessions) props.refreshSessions()
        return reloadSessions()
      }
      var item = plan[done]
      done++
      // Online sessions must be torn down through closeSession (the official
      // dispose chain) before their log can go; ended/archived ones delete
      // directly — the same routing the per-card buttons use.
      callRemote('sessionAdmin/' + (item.live ? 'closeSession' : 'deleteSession'), { sessionId: item.id }).then(function (result) {
        if (!alive.current) return
        if (!result || result.ok !== true) failures++
        patchSession({ bulkDone: done })
        step()
      }, function () {
        if (!alive.current) return
        failures++
        patchSession({ bulkDone: done })
        step()
      })
    }
    step()
  }

  function cancelBulkDelete() {
    if (sView.bulkBusy) return
    patchSession({ bulk: null, bulkDone: 0 })
  }

  // Usage dashboard (VibeUsage posture): lazily fetched aggregates over all
  // sessions — toggled from the toolbar, folded host-side from the same
  // revision-cached rows list() uses.

  /**
   * Toggle one session id in the persisted pin whitelist.
   * @param {string} id - the session id to star/unstar.
   */
  function togglePinned(id) {
    setPinnedIds(function (/** @type {string[]} */ cur) {
      var next = cur.indexOf(id) !== -1 ? cur.filter(function (/** @type {string} */ x) { return x !== id }) : cur.concat([id])
      savePinnedIds(next)
      return next
    })
  }

  var alive = kit.alive
  // Search sequence guard: a slow older search must not overwrite a newer
  // one's hits when both are in flight.
  var searchSeq = useRef(0)

  /**
   * Merge a partial state patch into the section state.
   * @param {Record<string, any>} partial - the keys to overwrite.
   */
  function patchSession(partial) {
    kit.patch(partial)
  }

  // Same gateway seam the other sections use; a local alias keeps the
  // call sites (and the render-helper parameter lists) untouched.
  var callRemote = props.call

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
        patchSession({ busy: false, error: dshT('加载会话失败：') + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchSession({ busy: false, error: dshT('调用失败：') + messageOf(failure) })
    })
  }

  /**
   * Run one sessionAdmin mutation over a single session, then reload.
   * @param {string} method - the RPC verb ('archive' / 'unarchive' / 'deleteSession' / 'closeSession').
   * @param {string} sessionId - the session to act on.
   */
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
      patchSession({ busy: false, error: dshT('操作失败：') + messageOf(result.error) })
    }, function (failure) {
      if (!alive.current) return
      patchSession({ busy: false, error: dshT('调用失败：') + messageOf(failure) })
    })
  }

  // Markdown transcript download: renders from the session log host-side and
  // saves through the browser's ordinary download flow. A read-only gesture —
  // no list refresh, busy flag, or confirm needed.

  /**
   * Run (or re-run) the full-text search across every session.
   * @param {string} [q] - the query; defaults to the search box's current text.
   */
  function runFulltext(q) {
    var query = (q === undefined || q === null) ? sView.fullNeedle : q
    query = (query || '').trim()
    if (query === '') { patchSession({ fulltext: false, fullHits: null }); return }
    var seq = ++searchSeq.current
    patchSession({ fullBusy: true, fullHits: null })
    callRemote('sessionAdmin/searchSessions', { query: query }).then(function (result) {
      if (!alive.current || seq !== searchSeq.current) return
      if (result.ok) {
        var hits = (result.value && result.value.hits) || []
        patchSession({ fullBusy: false, fullHits: hits })
      } else if (messageOf(result.error).indexOf(SEARCH_DISABLED_MARKER) !== -1) {
        // Typed disablement: swap the raw failure for the enablement banner.
        patchSession({ fullBusy: false, fullHits: [], error: '', searchDisabled: true })
      } else {
        patchSession({ fullBusy: false, fullHits: [], error: dshT('全文检索失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current || seq !== searchSeq.current) return
      if (messageOf(err).indexOf(SEARCH_DISABLED_MARKER) !== -1) {
        patchSession({ fullBusy: false, fullHits: [], error: '', searchDisabled: true })
        return
      }
      patchSession({ fullBusy: false, fullHits: [], error: dshT('全文检索失败：') + messageOf(err) })
    })
  }

  // One-click enablement for the disabled-by-default session-query index:
  // writes the id-targeted override row (durable index path + openAt
  // first-search) into the profile patch via overlayAdmin/searchEnable.
  // A successful write keeps the banner in its 'pending' state — the index
  // only exists after a dsh restart.
  function enableSearch() {
    if (sView.searchEnableState !== null) return
    patchSession({ searchEnableState: 'enabling' })
    callRemote('overlayAdmin/searchEnable', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patchSession({ searchEnableState: 'pending' })
      } else {
        patchSession({ searchEnableState: null, error: dshT('启用全文检索失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (alive.current) patchSession({ searchEnableState: null, error: dshT('启用全文检索失败：') + messageOf(err) })
    })
  }

  // Health entries merge functionally inside the updater — two concurrent
  // 体检 loads (different sessions clicked in quick succession) must each
  // land their entry instead of the later-resolving write clobbering the
  // other's with a stale snapshot.

  /**
   * Merge one session's health entry into the state, functionally.
   * @param {string} sessionId - the session the entry belongs to.
   * @param {Record<string, any>} entry - the health entry to merge.
   */
  function patchHealth(sessionId, entry) {
    setSView(function (/** @type {Record<string, any>} */ cur) {
      /** @type {Record<string, any>} */
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.healthBySession = Object.assign({}, cur.healthBySession, { [sessionId]: entry })
      return next
    })
  }

  /**
   * Fetch one session's health report and merge it into the state.
   * @param {string} sessionId - the session to inspect.
   */
  function loadHealth(sessionId) {
    patchHealth(sessionId, { loading: true })
    callRemote('sessionAdmin/healthReport', { sessionId: sessionId }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var value = result.value || {}
        patchHealth(sessionId, { report: value.report || {}, summary: value.summary || '' })
      } else {
        patchHealth(sessionId, { error: messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patchHealth(sessionId, { error: messageOf(err) })
    })
  }

  /**
   * Export one session's transcript as a Markdown download.
   * @param {Record<string, any>} session - the session row to export.
   */
  function exportSession(session) {
    callRemote('sessionAdmin/exportSession', { sessionId: session.id }).then(function (result) {
      if (!alive.current) return
      if (result.ok && result.value && typeof result.value.markdown === 'string') {
        try {
          downloadTextFile(result.value.filename || 'dsh-session.md', result.value.markdown)
          showToast(
            result.value.truncated === true ? 'info' : 'success',
            result.value.truncated === true
              ? dshT('⚠️ 已导出（会话事件超出上限，文件已截断）')
              : dshT('✅ 已导出 ') + (result.value.messages || 0) + dshT(' 条消息'),
          )
        } catch (e) {
          showToast('error', dshT('❌ 导出失败：') + messageOf(e))
        }
        return
      }
      showToast('error', dshT('❌ 导出失败：') + messageOf(result.error))
    }, function (failure) {
      if (alive.current) showToast('error', dshT('❌ 导出失败：') + messageOf(failure))
    })
  }

  kit.mount(reloadSessions)

  var groupUi = {
    collapsed: collapsedGroups,
    toggleCollapse: toggleGroupCollapsed,
    collapseAll: collapseAllGroups,
    requestBulk: requestBulkDelete,
    confirmBulk: runBulkDelete,
    cancelBulk: cancelBulkDelete,
  }

  return createElement('div', { 'data-dsh-admin-section': '' },
    renderSessionsView(sView, patchSession, reloadSessions, actSession, exportSession, pinnedIds, togglePinned, runFulltext, loadHealth, enableSearch, groupUi))
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
// Evaluated at RENDER time, not module load: a locale switch retranslates it
// on the next repaint (the shell's locale service triggers one) instead of
// serving the language that was current when this chunk first loaded.
export function liveHint() {
  return dshT('会话在线：仍挂载于 dsh host 内存（本进程内创建或打开过的会话保持在线，不代表正在运行）；可直接"关停并删除"（会中断该会话正在进行的对话）')
}

// Render caps: a multi-thousand-entry list must not freeze the settings page.
// Truncation is always rendered as a visible note; the filter narrows instead
// of the DOM growing.
export var SESSION_RENDER_CAP = 400

export var FULLTEXT_RENDER_CAP = 200

/**
 * Canonical session status. Live takes precedence over archived (a session
 * that is both live and in the archived set is shown as 会话在线); otherwise
 * archived wins over ended. Used by both the filter pills and the pill
 * counts so they can never disagree about membership.
 * @param {Record<string, any>} s - the session row.
 * @returns {'live'|'archived'|'ended'} the canonical status.
 */
export function sessionStatus(s) {
  if (s.live) return 'live'
  if (s.archived) return 'archived'
  return 'ended'
}

// Pinned sessions (Claude Code #55291-style): a local, order-restoring
// whitelist of session ids the user stars in the history page. Persisted in
// localStorage — the host registry has no such concept and inventing one on
// the durable side would couple a UI preference to workspace accounting.
export var PINNED_SESSIONS_KEY = 'dsh-plugin-admin/pinned-sessions'

export function loadPinnedIds() {
  try {
    var raw = window.localStorage.getItem(PINNED_SESSIONS_KEY)
    var parsed = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string' }) : []
  } catch (e) { return [] }
}

/**
 * Persist the pin whitelist to localStorage (silently ignored in private mode).
 * @param {Array<string>} ids - the complete next pinned id list.
 */
export function savePinnedIds(ids) {
 try { window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(ids)) } catch (e) { /* private mode */ }
}

// Collapsed directory groups in the session list: a local display preference
// (which workspace buckets the user folded shut). Persisted like the pin
// whitelist; the host has no concept of it.
export var COLLAPSED_GROUPS_KEY = 'dsh-plugin-admin/collapsed-groups'

export function loadCollapsedGroups() {
 try {
 var raw = window.localStorage.getItem(COLLAPSED_GROUPS_KEY)
 var parsed = raw === null ? [] : JSON.parse(raw)
 return Array.isArray(parsed) ? parsed.filter(function (k) { return typeof k === 'string' }) : []
 } catch (e) { return [] }
}

/**
 * Persist the collapsed-group list to localStorage (silently ignored in private mode).
 * @param {Array<string>} keys - the complete next collapsed group key list.
 */
export function saveCollapsedGroups(keys) {
 try { window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(keys)) } catch (e) { /* private mode */ }
}

/**
 * Compact token count: 940 / 12.3k / 4.5M.
 * @param {number} n - the token count.
 * @returns {string} the compacted count ('' for a non-count).
 */
export function formatTokenCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return ''
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  // 999_999 must not wear a 'k': rounding to one decimal crosses the unit.
  if (n < 999_950) return (Math.round(n / 100) / 10) + 'k'
  return (Math.round(n / 100000) / 10) + 'M'
}

/**
 * One-card usage tag: "↑1.2k ↓340 · 缓存8.9k" — empty when no usage.
 * @param {{ input?: number, output?: number, cacheRead?: number }|null|undefined} tokens - the row's usage fold.
 * @returns {string|null} the tag text, or null when there is no usage.
 */
export function formatUsageTag(tokens) {
  if (tokens === null || tokens === undefined || typeof tokens !== 'object') return null
  var input = typeof tokens.input === 'number' ? tokens.input : 0
  var output = typeof tokens.output === 'number' ? tokens.output : 0
  var cacheRead = typeof tokens.cacheRead === 'number' ? tokens.cacheRead : 0
  if (input === 0 && output === 0) return null
  var text = '↑' + formatTokenCount(input) + ' ↓' + formatTokenCount(output)
  if (cacheRead > 0) text += dshT(' · 缓存') + formatTokenCount(cacheRead)
  return text
}

/**
 * Local YYYY-MM-DD key for a timestamp (viewer's calendar).
 * @param {number} ms - the epoch milliseconds.
 * @returns {string} the local calendar day.
 */
export function usageDayKey(ms) {
  var d = new Date(ms)
  var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m
  var dd = String(d.getDate()); if (dd.length < 2) dd = '0' + dd
  return d.getFullYear() + '-' + m + '-' + dd
}

/**
 * Project the session rows through the active filter pill and search box.
 * @param {Array<Record<string, any>>} sessions - every listed session row.
 * @param {string} filter - the active filter pill ('all' / 'live' / 'archived' / 'ended' / 'pinned').
 * @param {string} needle - the lowercase search text ('' shows all).
 * @param {Array<string>} pinnedIds - the pinned id whitelist (the 'pinned' pill).
 * @returns {Array<Record<string, any>>} the visible rows.
 */
export function filterSessions(sessions, filter, needle, pinnedIds) {
  var result = []
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i]
    if (filter === 'pinned') {
      if (!(pinnedIds && pinnedIds.indexOf(s.id) !== -1)) continue
    } else if (filter !== 'all' && sessionStatus(s) !== filter) continue
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
 * Group sessions by their accounting workspace in registry order; sessions
 * without a workspace trail under an "未分组" bucket. Empty workspaces are
 * omitted so the user only sees groups that currently hold a session.
 * @param {Array<Record<string, any>>} filtered - the projected (filtered) session rows.
 * @param {Array<Record<string, any>>} workspaceOrder - the workspace rows in registry order.
 * @returns {Array<Record<string, any>>} the group buckets, "未分组" last.
 */
export function buildSessionGroups(filtered, workspaceOrder) {
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
    groups.push({ workspaceId: null, title: dshT('未分组'), path: null, sessions: ungrouped })
  }
  return groups
}

/** Full-text search panel: query box + hit rows (session title, snippet). */
/**
 * Full-text search panel: query box + hit rows (session title, snippet).
 * @param {Record<string, any>} view - the panel state.
 * @param {(partial: Record<string, any>) => void} patch - the state patch merge.
 * @param {(q?: string) => void} runFulltext - run (or re-run) the search.
 * @param {() => void} enableSearch - one-click index enablement.
 * @returns the full-text panel element.
 */
export function renderFulltextPanel(view, patch, runFulltext, enableSearch) {
  var h = createElement
  var children = []
  // Disablement banner: the base bundle ships the index with openAt: never.
  // Offer the one-click enablement instead of replaying the raw failure.
  // Inline styles: the sessions section has no .notice classes of its own.
  if (view.searchDisabled) {
    children.push(h('div', { key: 'disabled-banner', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px', padding: '8px 11px', borderRadius: '8px', border: '1px solid rgba(217,119,6,0.35)', background: 'rgba(217,119,6,0.08)', color: '#b45309', fontSize: '12px', lineHeight: 1.5 } },
      h('span', { key: 't', style: { flex: '1 1 220px' } },
        view.searchEnableState === 'pending'
          ? dshT('✅ 已写入 profile 配置（持久索引 + 首次搜索时打开）— 重启 dsh 后全文检索生效。')
          : dshT('全文检索在此部署中默认关闭（官方 base 配置 openAt: never）。一键写入 profile 覆盖行：索引落在 $DSH_HOME 下、首次搜索时才打开，不拖慢启动；写入后需重启 dsh。')),
      view.searchEnableState === null
        ? h(UiButton, { key: 'go', variant: 'primary', size: 'sm', onClick: enableSearch }, dshT('⚡ 一键启用'))
        : (view.searchEnableState === 'enabling' ? h('span', { key: 'spin', className: 'spinner' }) : null),
    ))
  }
  children.push(h('div', { key: 'q', style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } },
    h(UiInput, {
      key: 'in',  placeholder: dshT('检索所有会话的消息内容…（如「合并插件」或某个文件名）'),
      value: view.fullNeedle,
      onKeyDown: function (/** @type {{ key: string }} */ e) { if (e.key === 'Enter') runFulltext(view.fullNeedle) },
      onChange: function (/** @type {{ target: { value: string } }} */ e) { patch({ fullNeedle: e.target.value }) },
    }),
    h(UiButton, { key: 'go', variant: 'primary', disabled: view.fullBusy || view.fullNeedle.trim() === '', onClick: function () { runFulltext(view.fullNeedle) } },
      view.fullBusy ? h('span', { className: 'spinner' }) : dshT('搜索')),
  ))
  if (view.fullBusy) {
    children.push(h('div', { key: 'b', className: 'busy-banner' }, h('span', { className: 'spinner' }), dshT('搜索中…')))
  } else if (Array.isArray(view.fullHits)) {
    if (view.fullHits.length === 0) {
      children.push(h('div', { key: 'empty', className: 'empty' }, dshT('没有命中任何会话。')))
    } else {
      children.push(h('div', { key: 'count', className: 'hint' }, dshT('命中 ') + view.fullHits.length + dshT(' 个会话')))
      var fullRenderCap = Math.min(view.fullHits.length, FULLTEXT_RENDER_CAP)
      for (var i = 0; i < fullRenderCap; i++) {
        (function (hit) {
          var title = hit.title || (hit.cwd ? baseName(hit.cwd) : dshT('未命名会话'))
          children.push(h('div', { key: 'hit-' + i, className: 'card', style: { padding: '8px 12px', fontSize: '12px' } },
            h('div', { key: 'l1', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              h('span', { key: 't', style: { fontWeight: 600 } }, title),
              h('span', { key: 'id', style: { color: 'var(--dsw-alias-label-secondary, #61666b)', fontSize: '10px' } }, String(hit.sessionId || '').slice(0, 18)),
            ),
            hit.snippet ? h('div', { key: 's', style: { opacity: 0.75, marginTop: '3px', wordBreak: 'break-word' } }, hit.snippet) : null,
          ))
        })(view.fullHits[i])
      }
      if (view.fullHits.length > fullRenderCap) {
        children.push(h('div', { key: 'hit-cap', className: 'hint' },
          dshT('已显示前 ') + fullRenderCap + ' / ' + view.fullHits.length + dshT(' 条命中')))
      }
    }
  }
  return h('div', { key: 'fulltext', className: 'card', style: { padding: '10px' } }, children)
}

/**
 * One directory group's header: the whole row toggles the group's session
 * list (the caret shows the state), and a one-click "delete this whole
 * directory" action sits at the row's end. The button stops propagation so
 * it never doubles as a collapse toggle.
 * @param {Record<string, any>} g - the group bucket (workspaceId/title/path/sessions).
 * @param {string} groupKey - the stable group key ('ungrouped' or 'ws-<id>').
 * @param {boolean} collapsed - whether the group's sessions are hidden.
 * @param {Record<string, any>} view - the panel state (bulkBusy disables the action).
 * @param {Record<string, any>} groupUi - the section's group/bulk controls.
 * @returns the header element.
 */
export function buildGroupHeader(g, groupKey, collapsed, view, groupUi) {
  var isUngrouped = g.workspaceId === null
  return createElement('div', {
    className: 'group-header' + (collapsed ? ' collapsed' : ''),
    key: 'header-' + groupKey,
    title: collapsed ? dshT('点击展开该目录的会话') : dshT('点击折叠该目录的会话'),
    role: 'button',
    tabIndex: 0,
    onClick: function () { groupUi.toggleCollapse(groupKey) },
    onKeyDown: function (/** @type {{ key: string, preventDefault: () => void }} */ event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); groupUi.toggleCollapse(groupKey) }
    },
  },
    createElement('span', { className: 'group-caret', key: 'caret' }, collapsed ? '▸' : '▾'),
    createElement('span', { className: 'group-title', key: 'title' },
      (isUngrouped ? '📂 ' : '📁 ') + (g.title || dshT('未命名'))
    ),
    createElement('span', { className: 'group-count', key: 'count' }, String(g.sessions.length) + dshT(' 个')),
    collapsed ? createElement('span', { className: 'group-collapsed-note', key: 'note' }, dshT('已折叠')) : null,
    g.path !== null
      ? createElement('span', { className: 'group-path', key: 'path', title: g.path }, g.path)
      : null,
    createElement(UiButton, {
      type: 'button',
      key: 'btn-bulk-group',
      variant: 'outline',
      size: 'sm',
      className: 'group-action danger',
      title: dshT('删除该目录下的全部 ') + String(g.sessions.length) + dshT(' 个会话（在线会话会先关停）'),
      disabled: view.bulkBusy,
      onClick: function (/** @type {{ stopPropagation: () => void }} */ e) { e.stopPropagation(); groupUi.requestBulk('group', groupKey) },
    }, dshT('🗑 整个目录'))
  )
}

/**
 * Render the 历史会话 panel: toolbar, filter pills, directory groups and
 * the footer in one framed card.
 * @param {Record<string, any>} view - the panel state.
 * @param {(partial: Record<string, any>) => void} patch - the state patch merge.
 * @param {() => void} reload - re-fetch the session list.
 * @param {(method: string, sessionId: string) => void} act - run one sessionAdmin mutation.
 * @param {(session: Record<string, any>) => void} onExport - download one session's transcript.
 * @param {Array<string>} pinnedIds - the pinned id whitelist.
 * @param {(id: string) => void} togglePinned - star/unstar one session.
 * @param {(q?: string) => void} runFulltext - run (or re-run) the full-text search.
 * @param {(sessionId: string) => void} loadHealth - fetch one session's health report.
 * @param {() => void} enableSearch - one-click full-text index enablement.
 * @param {Record<string, any>} groupUi - the section's group/bulk controls.
 * @returns the framed panel element.
 */
export function renderSessionsView(view, patch, reload, act, onExport, pinnedIds, togglePinned, runFulltext, loadHealth, enableSearch, groupUi) {
  var elements = []

  // Toolbar: full-width search with inline icon; the refresh action sits at
  // the row's end so the search field gets the whole width.
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar' },
    createElement('div', { className: 'search-wrap session-search', key: 'wrap' },
      createElement('span', { className: 'search-icon', key: 'icon' }, '🔍'),
      createElement(UiInput, {
        placeholder: dshT('搜索标题、内容摘要、目录或 Session ID...'),
        // 只有 placeholder 不算可访问名称（读屏与无 placeholder 的渲染都拿不到），
        // 技能页的搜索框一直带 aria-label，这里补齐同一契约。
        'aria-label': dshT('搜索会话'),
        value: view.needle,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { patch({ needle: e.target.value }) },
      }),
      view.needle !== '' ? createElement(UiButton, {
        key: 'btn-clear-search',
        variant: 'toolbar',
        size: 'sm',
        title: dshT('清空搜索'),
        onClick: function () { patch({ needle: '' }) },
      }, '✕') : null
    ),
    createElement(UiButton, {
      type: 'button',
      key: 'btn-refresh',
      variant: 'outline',
      disabled: view.busy,
      onClick: reload,
    },
      view.busy ? createElement('span', { className: 'spinner', key: 'spin' }) : null,
      dshT('🔄 刷新')
    ),
    createElement(UiButton, {
      variant: 'outline', className: (view.fulltext ? ' pin-active' : ''),
      title: dshT('跨全部会话的全文搜索（按消息内容检索）'),
      onClick: function () { patch({ fulltext: !view.fulltext }); if (!view.fulltext && view.fullNeedle !== '') runFulltext(view.fullNeedle) },
    }, dshT('🔎 全文搜索'))
  ))

  if (view.fulltext) {
    elements.push(renderFulltextPanel(view, patch, runFulltext, enableSearch))
  }

  // Filter then group by workspace (registry order); sessions without an
  // accounting workspace trail under "未分组", matching the sidebar model.
  // Computed BEFORE the filter bar: its collapse-all / bulk-delete actions
  // need the same projection the list below renders.
  var needle = view.needle.trim().toLowerCase()
  var filtered = filterSessions(view.sessions, view.filter, needle, pinnedIds)
  var groups = buildSessionGroups(filtered, view.workspaces || [])
  /** @type {string[]} */
  var groupKeys = []
  for (var gk = 0; gk < groups.length; gk++) {
    groupKeys.push(groups[gk].workspaceId === null ? 'ungrouped' : 'ws-' + groups[gk].workspaceId)
  }
  var allCollapsed = groupKeys.length > 0
  for (var gc = 0; gc < groupKeys.length; gc++) {
    if (groupUi.collapsed.indexOf(groupKeys[gc]) === -1) { allCollapsed = false; break }
  }

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
    createElement(UiPill, {
      key: 'filter-all',
      active: view.filter === 'all',
      onClick: function () { patch({ filter: 'all' }) },
    }, dshT('全部(') + String(totalSessions) + ')'),
    createElement(UiPill, {
      key: 'filter-live',
      active: view.filter === 'live',
      title: liveHint(),
      onClick: function () { patch({ filter: 'live' }) },
    }, dshT('在线(') + String(liveCount) + ')'),
    createElement(UiPill, {
      key: 'filter-archived',
      active: view.filter === 'archived',
      onClick: function () { patch({ filter: 'archived' }) },
    }, dshT('已归档(') + String(archivedCount) + ')'),
    createElement(UiPill, {
      key: 'filter-ended',
      active: view.filter === 'ended',
      onClick: function () { patch({ filter: 'ended' }) },
    }, dshT('已结束(') + String(endedCount) + ')'),
    createElement(UiPill, {
      key: 'filter-pinned',
      active: view.filter === 'pinned',
      title: dshT('只显示已置顶的会话'),
      onClick: function () { patch({ filter: 'pinned' }) },
    }, dshT('已置顶(') + String(pinnedIds.length) + ')'),
    // Tail actions (a single flex item so the wrap never splits them): fold
    // every directory at once, and one-click delete of the current projection.
    (groupKeys.length > 0 || filtered.length > 0) ? createElement('div', { className: 'filter-actions', key: 'actions' },
      groupKeys.length > 0 ? createElement(UiButton, {
        variant: 'outline',
        size: 'sm',
        title: allCollapsed ? dshT('展开全部目录') : dshT('折叠全部目录'),
        onClick: function () { groupUi.collapseAll(allCollapsed ? [] : groupKeys) },
      }, allCollapsed ? dshT('▾ 全部展开') : dshT('▴ 全部折叠')) : null,
      filtered.length > 0 ? createElement(UiButton, {
        variant: 'outline',
        size: 'sm',
        className: 'danger',
        title: dshT('删除当前筛选下的全部 ') + String(filtered.length) + dshT(' 个会话（在线会话会先关停）'),
        disabled: view.bulkBusy,
        onClick: function () { groupUi.requestBulk('all', null) },
      }, dshT('🗑 删除当前 (') + String(filtered.length) + ')') : null
    ) : null
  ))

  // Bulk-delete confirmation / progress bar: rendered while a bulk request is
  // pending or running, right under the filter bar that raised it.
  if (view.bulk !== null && view.bulk !== undefined) {
    var bulk = view.bulk
    var bulkScope = bulk.scope === 'group'
      ? dshT('目录「') + (bulk.label || dshT('未命名')) + '」'
      : dshT('当前筛选')
    elements.push(createElement('div', { className: 'bulk-bar', key: 'bulk-bar' },
      createElement('span', { className: 'bulk-text', key: 't' },
        view.bulkBusy
          ? dshT('删除中 ') + String(view.bulkDone) + ' / ' + String(bulk.plan.length) + '…'
          : dshT('确认删除 ') + bulkScope + dshT('的 ') + String(bulk.plan.length) + dshT(' 个会话？此操作不可撤销')
      ),
      createElement('div', { className: 'bulk-actions', key: 'a' },
        createElement(UiButton, {
          variant: 'outline',
          size: 'sm',
          className: 'danger-solid',
          disabled: view.bulkBusy,
          onClick: groupUi.confirmBulk,
        }, dshT('确认删除')),
        createElement(UiButton, {
          variant: 'outline',
          size: 'sm',
          disabled: view.bulkBusy,
          onClick: groupUi.cancelBulk,
        }, dshT('取消'))
      )
    ))
  }

  // ccusage-style totals strip: whole-page token rollup over every listed
  // session (not the filtered subset — totals answer "how much overall").
  var totals = { input: 0, output: 0, cacheRead: 0, sessions: 0 }
  for (var ui = 0; ui < view.sessions.length; ui++) {
    var ut = view.sessions[ui].tokens
    if (ut && (ut.input > 0 || ut.output > 0)) {
      totals.input += ut.input || 0
      totals.output += ut.output || 0
      totals.cacheRead += ut.cacheRead || 0
      totals.sessions++
    }
  }
  if (totals.sessions > 0) {
    elements.push(createElement('div', { className: 'usage-strip', key: 'usage' },
      createElement('span', { className: 'usage-num' }, 'Σ ' + String(totals.sessions) + dshT(' 个会话')),
      createElement('span', null, dshT('输入 ') + formatTokenCount(totals.input)),
      createElement('span', null, dshT('输出 ') + formatTokenCount(totals.output)),
      totals.cacheRead > 0 ? createElement('span', null, dshT('缓存读 ') + formatTokenCount(totals.cacheRead)) : null,
    ))
  }

  if (view.error !== '') {
    elements.push(createElement('div', { className: 'error', key: 'error' }, view.error))
  }

  var rows = []
  var renderBudget = SESSION_RENDER_CAP
  var renderedCards = 0
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi]
    var groupKey = g.workspaceId === null ? 'ungrouped' : 'ws-' + g.workspaceId
    var collapsed = groupUi.collapsed.indexOf(groupKey) !== -1
    rows.push(buildGroupHeader(g, groupKey, collapsed, view, groupUi))
    if (collapsed) continue
    for (var si = 0; si < g.sessions.length; si++) {
      if (renderBudget <= 0) break
      renderBudget -= 1
      renderedCards += 1
      rows.push(renderSessionCard(g.sessions[si], view, act, patch, onExport, pinnedIds, togglePinned, loadHealth))
    }
    if (renderBudget <= 0) break
  }
  if (renderedCards < filtered.length) {
    // Truncation is visible, never silent: the filter above is the way to the tail.
    rows.push(createElement('div', { className: 'hint', key: 'render-cap' },
      dshT('已显示前 ') + renderedCards + ' / ' + filtered.length + dshT(' 个会话——用过滤条件缩小范围查看其余')))
  }

  if (rows.length === 0) {
    rows.push(createElement('div', { className: 'empty', key: 'empty' },
      createElement('div', null, needle !== '' ? dshT('🔍 无匹配的会话内容') : dshT('💬 没有已持久化的会话'))
    ))
  }

  elements.push(createElement('div', { className: 'list', key: 'list' }, rows))

  // Footer
  var summaryText = view.busy ? dshT('加载中...')
    : dshT('共 ') + String(totalSessions) + dshT(' 个会话，当前展示 ') + String(filtered.length) + dshT(' 个')

  elements.push(createElement('div', { className: 'footer', key: 'footer' },
    createElement('span', { key: 'summary' }, summaryText),
    createElement('span', { className: 'hint', key: 'hint' }, dshT('会话修改即时同步到侧边栏'))
  ))

  // One framed card: toolbar, filter pills, directory groups and the footer
  // all belong to this injected panel, so they share a single bordered
  // container instead of floating as unrelated boxes on the host page.
  return createElement('div', { key: 'sessions-panel', className: 'session-panel' }, elements)
}

/** Health-check report card shown inside a session row once 🩺 is clicked. */
/**
 * Health-check report card shown inside a session row once 🩺 is clicked.
 * @param {string} sessionId - the session id (the element key prefix).
 * @param {Record<string, any>} health - the merged health entry ({ loading?, report?, summary?, error? }).
 * @returns the health card element.
 */
export function renderHealthReportCard(sessionId, health) {
  if (health.loading) {
    return createElement('div', { key: 'health-' + sessionId, className: 'card-sub', style: { marginTop: '4px' } },
      createElement('span', { className: 'spinner' }), dshT(' 正在生成体检报告…'))
  }
  if (health.error) {
    return createElement('div', { key: 'health-' + sessionId, className: 'error', style: { marginTop: '4px' } }, dshT('体检失败：') + health.error)
  }
  var r = health.report || {}
  var summary = health.summary || ''
  var rows = []

  // Tool stats table
  if (Array.isArray(r.tools) && r.tools.length > 0) {
    for (var ti = 0; ti < r.tools.length; ti++) {
      (function (tool) {
        var code = tool.errorCodes && tool.errorCodes.length > 0
          ? ' · ' + tool.errorCodes.map(function (/** @type {{ code: string, count: number }} */ ec) { return ec.code + '×' + ec.count }).join(' ')
          : ''
        rows.push(createElement('div', { key: 't' + tool.name, className: 'card-sub-item', style: { marginRight: '10px' } },
          createElement('span', { style: { fontFamily: 'monospace' } }, tool.name),
          createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #61666b)' } }, ' ×' + tool.calls + (tool.errors > 0 ? ' · ❌' + tool.errors : '')),
          tool.errors > 0 ? createElement('span', { style: { color: '#dc2626', fontSize: '11px' } }, code) : null,
        ))
      })(r.tools[ti])
    }
  }
  var extra = []
  if (r.abortedTurns > 0) extra.push(createElement('span', { key: 'ab', style: { color: '#d97706' } }, r.abortedTurns + dshT(' 中断')))
  if (r.errorTurns > 0) extra.push(createElement('span', { key: 'er', style: { color: '#dc2626' } }, r.errorTurns + dshT(' 出错')))
  if (r.retryCount > 0) extra.push(createElement('span', { key: 'rt' }, r.retryCount + dshT(' 次重试')))
  if (r.compactions > 0) extra.push(createElement('span', { key: 'cp' }, r.compactions + dshT(' 次压缩')))

  return createElement('div', { key: 'health-' + sessionId, className: 'card', style: { marginTop: '4px', padding: '8px 10px' } },
    createElement('div', { key: 'head', className: 'card-sub-item', style: { fontWeight: 600, marginBottom: '4px' } },
      '🩺 ' + (summary || dshT('会话体检')), extra.length > 0 ? createElement('span', { key: 'ex' }, ' · ', extra) : null),
    rows.length > 0 ? createElement('div', { key: 'tools', className: 'card-sub', style: { flexDirection: 'row', flexWrap: 'wrap' } }, rows) : null,
    (Array.isArray(r.topErrors) && r.topErrors.length > 0)
      ? createElement('div', { key: 'errs', className: 'card-sub-item', style: { fontSize: '11px', color: '#dc2626', marginTop: '2px' } },
        dshT('主要错误：'), r.topErrors.map(function (/** @type {{ name: string, code: string, count: number }} */ e) { return e.name + ':' + e.code + '×' + e.count }).join('  '))
      : null,
  )
}

/**
 * One session card: title row, action buttons, summary, metadata, and the
 * confirm / health sub-cards when active.
 * @param {Record<string, any>} session - the session row.
 * @param {Record<string, any>} view - the panel state.
 * @param {(method: string, sessionId: string) => void} act - run one sessionAdmin mutation.
 * @param {(partial: Record<string, any>) => void} patch - the state patch merge.
 * @param {(session: Record<string, any>) => void} onExport - download one session's transcript.
 * @param {Array<string>} pinnedIds - the pinned id whitelist.
 * @param {(id: string) => void} togglePinned - star/unstar one session.
 * @param {(sessionId: string) => void} loadHealth - fetch one session's health report.
 * @returns the session card element.
 */
export function renderSessionCard(session, view, act, patch, onExport, pinnedIds, togglePinned, loadHealth) {
  var health = (view.healthBySession && view.healthBySession[session.id]) || null
  var isConfirming = view.confirming === session.id
  var dotClass = 'dot' + (session.live ? ' live' : session.archived ? ' archived' : '')
  var dotTitle = session.live ? liveHint() : session.archived ? dshT('已归档') : dshT('已结束')

  var isPinned = pinnedIds ? pinnedIds.indexOf(session.id) !== -1 : false
  var actions = []
  if (!isConfirming) {
    actions.push(createElement(UiButton, {
      type: 'button',
      variant: 'outline',
      size: 'sm', className: (isPinned ? ' pin-active' : ''),
      key: 'btn-pin',
      title: isPinned ? dshT('取消置顶') : dshT('置顶该会话（本地收藏，随时可在「📌 已置顶」筛选中找到）'),
      onClick: function () { if (typeof togglePinned === 'function') togglePinned(session.id) },
    }, isPinned ? dshT('📌 已置顶') : dshT('📌 置顶')))
    actions.push(createElement(UiButton, {
      type: 'button',
      variant: 'outline',
      size: 'sm',
      key: 'btn-export',
      title: dshT('导出为 Markdown 对话稿（.md 下载）'),
      onClick: function () { if (typeof onExport === 'function') onExport(session) },
    }, dshT('⬇ 导出')),
    createElement(UiButton, {
      type: 'button',
      variant: 'outline',
      size: 'sm',
      key: 'btn-health',
      title: dshT('会话体检：工具调用/错误/中断/重试统计'),
      onClick: function () { if (typeof loadHealth === 'function') loadHealth(session.id) },
    }, dshT('🩺 体检')))
    if (!session.archived && !session.live) {
      actions.push(createElement(UiButton, {
        type: 'button',
        variant: 'outline',
        size: 'sm',
        key: 'btn-archive',
        disabled: view.busy,
        onClick: function () { act('archive', session.id) },
      }, dshT('归档')))
    }
    if (session.archived) {
      actions.push(createElement(UiButton, {
        type: 'button',
        variant: 'outline',
        size: 'sm',
        key: 'btn-unarchive',
        disabled: view.busy,
        onClick: function () { act('unarchive', session.id) },
      }, dshT('取消归档')))
    }
    if (!session.live) {
      actions.push(createElement(UiButton, {
        type: 'button',
        variant: 'outline',
        size: 'sm',
        className: 'danger',
        key: 'btn-delete',
        disabled: view.busy,
        onClick: function () { patch({ confirming: session.id }) },
      }, dshT('删除')))
    } else {
      // Online sessions can now be closed through the captured AgentHandle
      // (closeSession disposes the live agent/session first, so the log can
      // be removed without resurrection). This stops a running conversation,
      // so it is a destructive action with its own confirm flow.
      actions.push(createElement(UiButton, {
        type: 'button',
        variant: 'outline',
        size: 'sm',
        className: 'danger',
        key: 'btn-close',
        disabled: view.busy,
        title: dshT('关停该在线会话（停止其 agent 运行）并永久删除日志记录'),
        onClick: function () { patch({ confirming: session.id }) },
      }, dshT('关停并删除')))
    }
  }

  var titleChildren = [
    createElement('span', { className: dotClass, title: dotTitle, key: 'dot' }),
    createElement('div', { className: 'card-title', key: 'title' },
      createElement('span', { className: 'card-title-text', key: 'name', title: session.title || session.cwd },
        session.title || (session.cwd ? baseName(session.cwd) : dshT('未命名会话'))
      ),
      session.live ? createElement('span', { className: 'tag live', key: 'tag-live', title: liveHint() }, dshT('会话在线'))
        : session.archived ? createElement('span', { className: 'tag archived', key: 'tag-archived' }, dshT('已归档'))
        : null,
      session.messageCount > 0 ? createElement('span', { className: 'tag turns', key: 'tag-turns' }, String(session.messageCount) + dshT(' 条消息')) : null,
      createElement('span', {
        className: 'tag turns', key: 'tag-tokens',
        title: dshT('本次会话 token 用量（输入 / 输出 / 缓存读）——来自模型适配器上报的 usage 折叠'),
      }, formatUsageTag(session.tokens)),
      isPinned ? createElement('span', { className: 'tag live', key: 'tag-pin', title: dshT('已置顶') }, '📌') : null
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
      dshT('摘要读取失败：') + session.summaryError
    ))
  }

  // Sub metadata line
  var subChildren = [
    createElement('span', { className: 'card-sub-item', title: session.cwd || dshT('无工作目录'), key: 'path' },
      '📁 ' + (session.cwd ? baseName(session.cwd) + ' (' + session.cwd + ')' : dshT('（无工作目录）'))
    ),
    createElement('span', { key: 'sep1' }, '·'),
    createElement('span', { className: 'card-sub-item', key: 'time' }, '🕒 ' + formatDate(session.createdAt)),
  ]
  if (session.id) {
    subChildren.push(createElement('span', { key: 'sep2' }, '·'))
    subChildren.push(createElement('span', { className: 'card-sub-item session-id-badge', key: 'id', title: dshT('会话 ID: ') + session.id },
      '🆔 ' + session.id.slice(0, 8)
    ))
  }

  var sub = createElement('div', { className: 'card-sub', key: 'sub' }, subChildren)
  cardChildren.push(sub)

  if (health !== null) {
    cardChildren.push(renderHealthReportCard(session.id, health))
  }

  if (isConfirming) {
    cardChildren.push(createElement('div', { className: 'confirm-bar', key: 'confirm' },
      createElement('span', { className: 'confirm-text', key: 'text' },
        session.live
          ? dshT('⚠️ 将关停该在线会话（正在运行则会中断）并永久删除记录与日志，确定？')
          : dshT('⚠️ 确定永久删除该会话记录及日志文件？')),
      createElement('div', { className: 'confirm-actions', key: 'actions' },
        createElement(UiButton, {
          type: 'button',
          key: 'btn-confirm',
          variant: 'outline',
          size: 'sm',
          className: 'danger-solid',
          disabled: view.busy,
          onClick: function () { act(session.live ? 'closeSession' : 'deleteSession', session.id) },
        }, dshT('确认删除')),
        createElement(UiButton, {
          type: 'button',
          key: 'btn-cancel',
          variant: 'outline',
          size: 'sm',
          disabled: view.busy,
          onClick: function () { patch({ confirming: null }) },
        }, dshT('取消'))
      )
    ))
  }

  return createElement('div', { key: session.id, className: 'card' }, cardChildren)
}
