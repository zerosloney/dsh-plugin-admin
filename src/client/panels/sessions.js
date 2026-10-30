/**
 * sessions — the Web 与会话 entry: 历史会话 (archived sessions) + Web 搜索.
 *
 * 历史会话 answers exactly one question — **which sessions did I archive, and
 * how do I get rid of them**. It lists archived sessions grouped by the
 * workspace that owned them, with one delete action per row: no filter bar, no
 * bulk selection, no export, no health report, no full-text search. dsh's own
 * sidebar already owns live and recent sessions, so a second management surface
 * there was only a place to look twice.
 */
import { UiButton, baseName, createElement, dshT, formatDate, messageOf, panelHidden, sectionState, showToast } from './context.js'
import { tabKeyDown, unwrap } from './shared.js'
import { WebSearchSection } from './web-search.js'

/**
 * The renderer-bound props the Web 与会话 entry receives: the RPC seam (its
 * result envelope is duck-typed per method — `{ ok: true, value }` /
 * `{ ok: false, error }` — so the resolved type stays `any` by design: a
 * boundary, not unmodelled data), plus the sidebar nudge the entry threads down
 * to 历史会话.
 * @typedef {{ call: (method: string, args: Record<string, any>) => Promise<any>, refreshSessions: (() => void) | null, forgetSession?: ((sessionId: string) => void) | null }} WebSessionsSectionProps
 */

/* ========================================================================== */
/*          Web 与会话 Section (历史会话 + Web 搜索, one nav entry)            */
/* ========================================================================== */

/**
 * ONE settings-nav entry for the two web/session panels: 历史会话 (default tab)
 * and Web 搜索. The tab strip reuses the shared `data-cha-section` chrome — the
 * same recipe the 自动化 page uses. `refreshSessions` flows through so a deleted
 * session leaves the sidebar list too.
 * @param {WebSessionsSectionProps} props - the renderer-bound props.
 * @returns {any} the section element.
 */
export function WebSessionsSection(props) {
  var tabHooks = sectionState({ tab: 'sessions' })
  var tab = tabHooks.state.tab
  // webSearch 没有独立 slot（与历史会话共用这一条 nav 入口），config.panels 的
  // off/on/auto 三态在这里落地：off 直接摘掉页签——旋钮不在就只是惰性摆设。
  // 'auto' 不会摘掉它：native-coverage 的 webSearch 行是 scope 'none'，官方面板
  // 只配官方 provider，不装卸 exa / perplexity。
  var tabs = [
    { id: 'sessions', label: dshT('历史会话'), component: SessionsSection },
  ]
  if (!panelHidden('webSearch')) {
    tabs.push({ id: 'websearch', label: dshT('Web 搜索'), component: WebSearchSection })
  }
  var selected = tabs.find(function (entry) { return entry.id === tab }) || tabs[0]
  return createElement('div', { 'data-cha-section': '' },
    createElement('div', { className: 'tabs', role: 'tablist', 'aria-label': dshT('Web 与会话'),
      onKeyDown: function (/** @type {KeyboardEvent} */ event) { tabKeyDown(event, tabs, selected.id, function (next) { tabHooks.patch({ tab: next }) }) } },
      tabs.map(function (entry) {
        return createElement('button', {
          type: 'button', role: 'tab', key: entry.id,
          id: 'dsh-admin-tab-' + entry.id,
          'aria-controls': 'dsh-admin-panel-' + entry.id,
          tabIndex: entry.id === selected.id ? 0 : -1,
          className: 'tab' + (entry.id === selected.id ? ' active' : ''),
          'aria-selected': entry.id === selected.id,
          onClick: function () { tabHooks.patch({ tab: entry.id }) },
        }, entry.label)
      })
    ),
    createElement('div', { key: selected.id, role: 'tabpanel', id: 'dsh-admin-panel-' + selected.id, 'aria-labelledby': 'dsh-admin-tab-' + selected.id },
      createElement(selected.component, { call: props.call, refreshSessions: props.refreshSessions, forgetSession: props.forgetSession })
    )
  )
}

/* ========================================================================== */
/*                      历史会话 — archived sessions only                     */
/* ========================================================================== */

/**
 * Bucket archived rows by the workspace that owned them, in registry order, with
 * the ungrouped bucket last. A row whose `workspaceId` names no registry member
 * (the workspace was deleted, or the host has no registry at all) falls into the
 * ungrouped bucket rather than disappearing.
 * @param {Array<Record<string, any>>} rows - archived session rows from `sessionAdmin/list`.
 * @param {Array<Record<string, any>>} workspaces - the registry projection from the same call.
 * @returns {Array<{ key: string, title: string, path: string, rows: Array<Record<string, any>> }>}
 */
export function buildArchivedGroups(rows, workspaces) {
  /** @type {Record<string, any>} */
  var byWorkspace = {}
  var ordered = []
  for (var i = 0; i < workspaces.length; i++) {
    var workspace = workspaces[i]
    if (workspace === null || typeof workspace !== 'object') continue
    if (typeof workspace.workspaceId !== 'string' || workspace.workspaceId === '') continue
    /** @type {{ key: string, title: string, path: string, rows: Array<Record<string, any>> }} */
    var group = {
      key: 'ws-' + workspace.workspaceId,
      title: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : dshT('未命名'),
      path: typeof workspace.path === 'string' ? workspace.path : '',
      rows: [],
    }
    byWorkspace[workspace.workspaceId] = group
    ordered.push(group)
  }
  /** @type {{ key: string, title: string, path: string, rows: Array<Record<string, any>> }} */
  var ungrouped = { key: 'ungrouped', title: dshT('未分组'), path: '', rows: [] }
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j]
    if (row === null || typeof row !== 'object') continue
    var owner = typeof row.workspaceId === 'string' ? byWorkspace[row.workspaceId] : undefined
    if (owner === undefined) ungrouped.rows.push(row)
    else owner.rows.push(row)
  }
  var groups = ordered.filter(function (candidate) { return candidate.rows.length > 0 })
  if (ungrouped.rows.length > 0) groups.push(ungrouped)
  return groups
}

/**
 * 历史会话: archived sessions, grouped by workspace, deletable one row at a time.
 * Delete is two-step in place (删除 → 确认删除 / 取消) because the row itself is
 * the only context an operator has for what is about to be removed.
 * @param {WebSessionsSectionProps} props - the renderer-bound props.
 * @returns {any} the section element.
 */
export function SessionsSection(props) {
  var kit = sectionState({ rows: [], workspaces: [], busy: false, error: '', confirming: '', pending: '' })
  var view = kit.state
  var patch = kit.patch

  function reload() {
    patch({ busy: true, error: '' })
    return props.call('sessionAdmin/list', {}).then(unwrap).then(function (/** @type {any} */ value) {
      if (!kit.alive.current) return
      var listed = value !== null && value !== undefined && Array.isArray(value.sessions) ? value.sessions : []
      patch({
        busy: false,
        error: '',
        rows: listed.filter(function (/** @type {any} */ row) {
          return row !== null && typeof row === 'object' && row.archived === true
        }),
        workspaces: value !== null && value !== undefined && Array.isArray(value.workspaces) ? value.workspaces : [],
      })
    }, function (/** @type {any} */ error) {
      if (!kit.alive.current) return
      patch({ busy: false, error: dshT('读取会话失败：') + messageOf(error) })
    })
  }
  kit.mount(reload)

  /** @param {Record<string, any>} row */
  function remove(row) {
    if (view.pending !== '') return
    patch({ pending: row.id })
    // An archived session can still be live: closeSession tears the live
    // agent/session down first and then deletes, deleteSession is the直接 path.
    var method = row.live === true ? 'sessionAdmin/closeSession' : 'sessionAdmin/deleteSession'
    props.call(method, { sessionId: row.id }).then(unwrap).then(function () {
      if (!kit.alive.current) return
      // The sidebar keeps its own projection of the list: forget the row there
      // first, then re-read this page.
      if (props.forgetSession) props.forgetSession(row.id)
      else if (props.refreshSessions) props.refreshSessions()
      patch({ pending: '', confirming: '' })
      return reload()
    }, function (/** @type {any} */ error) {
      if (!kit.alive.current) return
      patch({ pending: '', confirming: '' })
      showToast('error', dshT('删除失败：') + messageOf(error))
    })
  }

  /** @param {{ key: string, title: string, path: string, rows: Array<Record<string, any>> }} group */
  function renderGroup(group) {
    return createElement('div', { key: group.key },
      createElement('div', { className: 'group-header' },
        createElement('span', null, group.title),
        createElement('span', { className: 'group-count' }, String(group.rows.length)),
        group.path === '' ? null : createElement('span', { className: 'group-path', title: group.path }, baseName(group.path))
      ),
      group.rows.map(renderRow)
    )
  }

  /** @param {Record<string, any>} row */
  function renderRow(row) {
    var confirming = view.confirming === row.id
    var pending = view.pending === row.id
    var when = formatDate(row.updatedAt || row.createdAt)
    return createElement('div', { key: row.id, className: 'row' },
      createElement('div', { className: 'main' },
        createElement('div', { className: 'name-row' },
          createElement('span', { className: 'name' }, row.title || dshT('未命名会话')),
          row.live === true ? createElement('span', { className: 'tag event' }, dshT('在线')) : null
        ),
        createElement('div', { className: 'desc mono' },
          typeof row.id === 'string' && row.id !== '' ? createElement('span', null, row.id) : null,
          when === '' ? null : createElement('span', null, ' · ' + when)
        )
      ),
      createElement('div', { className: 'actions' },
        confirming
          ? [
            createElement(UiButton, { key: 'yes', className: 'danger', disabled: pending, onClick: function () { remove(row) } },
              pending ? dshT('删除中…') : dshT('确认删除')),
            createElement(UiButton, { key: 'no', disabled: pending, onClick: function () { patch({ confirming: '' }) } }, dshT('取消')),
          ]
          : createElement(UiButton, { key: 'del', className: 'danger', onClick: function () { patch({ confirming: row.id }) } }, dshT('删除'))
      )
    )
  }

  var groups = buildArchivedGroups(view.rows, view.workspaces)
  var empty = view.rows.length === 0
  return createElement('div', null,
    createElement('div', { className: 'toolbar' },
      createElement('span', { className: 'title' }, dshT('历史会话')),
      createElement('span', { className: 'count' }, String(view.rows.length)),
      createElement('span', { className: 'spacer' }),
      createElement(UiButton, { onClick: function () { reload() }, disabled: view.busy === true },
        view.busy ? dshT('加载中…') : dshT('刷新'))
    ),
    view.error === '' ? null : createElement('div', { className: 'notice warn', role: 'alert' },
      createElement('span', { className: 'notice-text' }, view.error),
      createElement('span', { className: 'notice-actions' },
        createElement(UiButton, { onClick: function () { reload() } }, dshT('重试')))
    ),
    empty
      ? createElement('div', { className: 'empty' }, view.busy ? dshT('加载中…') : dshT('还没有归档会话。'))
      : createElement('div', { className: 'list' }, groups.map(renderGroup))
  )
}

/* ========================================================================== */
/*                    Shared formatters (the 用量仪表盘 reads these)          */
/* ========================================================================== */

/**
 * Compact token count: 999 → "999", 1234 → "1.2k", 1234567 → "1.2M".
 * @param {number} n - the token count.
 * @returns {string} the compact text, or '' for a non-count.
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
