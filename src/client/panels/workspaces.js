/** workspaces — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiInput, createElement, dshT, messageOf, sectionState } from './context.js'

/**
 * Workspace administration settings section.
 *
 * Wraps the host's `ctx.workspaceRegistry` (`@deepseek-ai/dsh-workspace`)
 * with a settings page that can list / create / rename / delete /
 * reorder workspaces. The web-app bundle mounts the registry by default;
 * CLI / headless deployments fall back to a one-line "workspace
 * unavailable" hint, NOT an error.
 *
 * Out of scope for v1: per-workspace session account editing
 * (attach/detach/insertSessionBefore) — those are exposed via the
 * workspaceAdmin RPC but the panel only surfaces the count summary.
 * The session archive set (global, not per-workspace) is also
 * surfaced via a top-level "已归档" badge + bulk restore gesture.
 * @param {{ call: (method: string, args: any) => Promise<any> }} props - the
 * registration face. `call` is the host RPC seam: the resolved payload is
 * service-defined JSON, which is what the `.then` bodies below read.
 */
export function WorkspacesSection(props) {
  var call = props.call
  var kit = sectionState({
    available: true,
    workspaces: [],
    archivedSessionIds: [],
    // Serial unarchive loop in flight: the toolbar gesture must not be
    // re-triggerable while it runs (and the button shows progress).
    bulkUnarchiveBusy: false,
    busy: false,
    error: '',
    // pickerAvailable defaults to true: dsh ships at least one picker
    // backend in every web-app composition (browse as a fallback when
    // the native dialog is unreachable). The first pickDirectory() call
    // will downgrade this if the host has no picker seam at all.
    pickerBackend: null,
    pickerAvailable: true,
    // Create-form draft
    createOpen: false,
    createPath: '',
    createTitle: '',
    createBusy: false,
    createError: '',
    // Per-workspace transient state
    renameId: null,
    renameDraft: '',
    renameBusy: false,
    renameError: '',
    deleteId: null,
    deleteBusy: false,
    deleteError: '',
    expanded: {}, // workspaceId -> bool
  })
  var state = kit.state
  var setState = kit.set
  var alive = kit.alive

  function patch(/** @type {Record<string, any>} */ partial) {
    kit.patch(partial)
  }

  function reload() {
    patch({ busy: true, error: '' })
    call('workspaceAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var v = result.value || {}
        patch({
          busy: false,
          available: v.available !== false,
          workspaces: Array.isArray(v.workspaces) ? v.workspaces : [],
          archivedSessionIds: Array.isArray(v.archivedSessionIds) ? v.archivedSessionIds : [],
        })
      } else {
        patch({ busy: false, error: dshT('加载失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('调用失败：') + messageOf(err) })
    })
  }

  kit.mount(reload)

  // ---------- Create ----------

  function openCreate() {
    patch({ createOpen: true, createPath: '', createTitle: '', createError: '', createBusy: false })
  }

  function closeCreate() {
    // createBusy MUST be cleared here: the success path closes the form and
    // reloads, and the toolbar's 「➕ 新建工作区」 button is disabled by it —
    // leaving it set disabled the only create entry point for the rest of the
    // component's lifetime.
    patch({ createOpen: false, createPath: '', createTitle: '', createError: '', createBusy: false })
  }

  function setCreateField(/** @type {'path' | 'title'} */ field, /** @type {string} */ value) {
    setState(function (/** @type {Record<string, any>} */ cur) {
      /** @type {Record<string, any>} */
      var next = {}
      for (var k in cur) next[k] = cur[k]
      if (field === 'path') next.createPath = value
      else if (field === 'title') next.createTitle = value
      return next
    })
  }

  function pickDirectory() {
    call('workspaceAdmin/pickDirectory', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var v = result.value || {}
        // Save the capability snapshot for the picker hint — first call only.
        if (state.pickerBackend === null) {
          patch({ pickerBackend: v.backend || null, pickerAvailable: v.available === true })
        }
        if (typeof v.path === 'string' && v.path !== '') {
          patch({ createPath: v.path })
        }
      } else {
        patch({ createError: dshT('目录选择失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ createError: dshT('目录选择失败：') + messageOf(err) })
    })
  }

  function submitCreate() {
    var path = state.createPath.trim()
    var title = state.createTitle.trim()
    if (path === '') {
      patch({ createError: dshT('请提供目录路径（原生选择或手动输入）') })
      return
    }
    patch({ createBusy: true, createError: '' })
    /** @type {Record<string, any>} */
    var args = { path: path }
    if (title !== '') args.title = title
    call('workspaceAdmin/create', args).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        closeCreate()
        reload()
      } else {
        patch({ createBusy: false, createError: dshT('新建失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ createBusy: false, createError: dshT('新建失败：') + messageOf(err) })
    })
  }

  // ---------- Rename ----------

  function openRename(/** @type {string} */ id, /** @type {string} */ currentTitle) {
    patch({ renameId: id, renameDraft: currentTitle || '', renameError: '' })
  }
  function cancelRename() {
    patch({ renameId: null, renameDraft: '', renameError: '' })
  }
  function setRenameDraft(/** @type {string} */ value) {
    patch({ renameDraft: value })
  }
  function submitRename() {
    var id = state.renameId
    var title = state.renameDraft.trim()
    if (id === null || title === '') {
      patch({ renameError: dshT('标题不能为空') })
      return
    }
    patch({ renameBusy: true, renameError: '' })
    call('workspaceAdmin/rename', { workspaceId: id, title: title }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patch({ renameId: null, renameDraft: '', renameBusy: false, renameError: '' })
        reload()
      } else {
        patch({ renameBusy: false, renameError: dshT('重命名失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ renameBusy: false, renameError: dshT('重命名失败：') + messageOf(err) })
    })
  }

  // ---------- Reorder ----------

  function moveWorkspace(/** @type {string} */ id, /** @type {string | undefined} */ beforeId) {
    patch({ busy: true, error: '' })
    /** @type {Record<string, any>} */
    var args = { workspaceId: id }
    if (typeof beforeId === 'string' && beforeId !== '') args.beforeWorkspaceId = beforeId
    call('workspaceAdmin/insertBefore', args).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        reload()
      } else {
        patch({ busy: false, error: dshT('排序失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('排序失败：') + messageOf(err) })
    })
  }

  function moveUp(/** @type {string} */ id, /** @type {number} */ index) {
    if (index <= 0) return
    var before = state.workspaces[index - 1]
    if (!before) return
    moveWorkspace(id, before.workspaceId)
  }
  function moveDown(/** @type {string} */ id, /** @type {number} */ index) {
    var next = state.workspaces[index + 1]
    if (!next) return
    // To move "after next", insertBefore next with anchor = next.nextSibling (or undefined for tail).
    var anchor = state.workspaces[index + 2]
    moveWorkspace(id, anchor ? anchor.workspaceId : undefined)
  }

  // ---------- Delete ----------

  function askDelete(/** @type {string} */ id) {
    patch({ deleteId: id, deleteError: '' })
  }
  function cancelDelete() {
    patch({ deleteId: null, deleteError: '' })
  }
  function confirmDelete() {
    var id = state.deleteId
    if (id === null) return
    patch({ deleteBusy: true, deleteError: '' })
    call('workspaceAdmin/delete', { workspaceId: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patch({ deleteId: null, deleteBusy: false, deleteError: '' })
        reload()
      } else {
        patch({ deleteBusy: false, deleteError: dshT('删除失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ deleteBusy: false, deleteError: dshT('删除失败：') + messageOf(err) })
    })
  }

  // ---------- Live status probe ----------

  function checkStatus(/** @type {string} */ id) {
    call('workspaceAdmin/status', { workspaceId: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var status = result.value || 'ok'
        if (status === 'missing-dir') {
          patch({ error: dshT('⚠ 该工作区的目录当前不存在（可能临时移走）；registry 不会改写记录') })
        } else {
          patch({ error: '' })
        }
      } else {
        patch({ error: dshT('状态检查失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ error: dshT('状态检查失败：') + messageOf(err) })
    })
  }

  // ---------- Bulk archive ----------

  function bulkUnarchive() {
    if (state.archivedSessionIds.length === 0 || state.bulkUnarchiveBusy) return
    var ids = state.archivedSessionIds.slice()
    patch({ bulkUnarchiveBusy: true })
    var step = function (/** @type {number} */ i) {
      if (i >= ids.length || !alive.current) {
        if (alive.current) {
          patch({ bulkUnarchiveBusy: false })
          reload()
        }
        return
      }
      call('workspaceAdmin/unarchiveSession', { sessionId: ids[i] }).then(function () {
        step(i + 1)
      }, function () { step(i + 1) })
    }
    step(0)
  }

  // ---------- Render ----------

  if (!state.available) {
    return createElement('div', { 'data-dsh-admin-section': '' },
      createElement('div', { className: 'group-header', key: 'unavail' },
        createElement('span', { className: 'group-title', key: 't' }, dshT('📁 工作区')),
        createElement('span', { className: 'group-count', key: 'c' }, dshT('本部署未挂载 dsh-workspace（仅 web-app 编成自带）')),
      ),
    )
  }

  var elements = []
  if (state.busy) {
    elements.push(createElement('div', { className: 'busy-banner', key: 'busy' },
      createElement('span', { className: 'spinner', key: 'sp' }), dshT('加载中…')))
  }
  if (state.error !== '') {
    elements.push(createElement('div', { className: 'error', key: 'err' }, state.error))
  }

  // Toolbar
  var toolbarChildren = [
    createElement(UiButton, { variant: 'primary', key: 'btn-create', disabled: state.createBusy, onClick: openCreate }, dshT('➕ 新建工作区')),
    createElement(UiButton, { variant: 'outline', size: 'sm', key: 'btn-refresh', disabled: state.busy, onClick: reload }, dshT('⟳ 刷新')),
  ]
  if (state.archivedSessionIds.length > 0) {
    toolbarChildren.push(createElement(UiButton, {
      variant: 'outline', key: 'btn-bulk-unarchive',
      disabled: state.busy || state.bulkUnarchiveBusy,
      title: dshT('一键取消归档全部已归档会话（不删除会话本体）'),
      onClick: bulkUnarchive,
    }, state.bulkUnarchiveBusy
      ? dshT('恢复中…')
      : dshT('📦 取消全部归档 (') + state.archivedSessionIds.length + ')'))
  }
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar' }, toolbarChildren))

  // Create form (collapsible)
  if (state.createOpen) {
    var pickerHint = state.pickerAvailable
      ? (state.pickerBackend ? dshT('原生选择器后端：') + state.pickerBackend : dshT('原生选择器可用'))
      : dshT('原生选择器不可用，请手动输入绝对路径')
    elements.push(createElement('div', { className: 'card mcp-editor', key: 'create-form', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      createElement('div', { key: 'hdr', style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
        createElement('span', { style: { fontWeight: 600 } }, dshT('新建工作区')),
        createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' } }, pickerHint),
      ),
      createElement('div', { key: 'row-path', style: { display: 'flex', gap: '6px' } },
        createElement(UiButton, { variant: 'outline', size: 'sm', key: 'pick', disabled: !state.pickerAvailable, onClick: pickDirectory }, dshT('📁 选择目录')),
        createElement(UiInput, {  key: 'path', placeholder: dshT('或手动输入绝对目录路径'), value: state.createPath, onChange: function (/** @type {{ target: { value: string } }} */ e) { setCreateField('path', e.target.value) } }),
      ),
      createElement(UiInput, {  key: 'title', placeholder: dshT('显示标题（留空则用目录最后一段）'), value: state.createTitle, onChange: function (/** @type {{ target: { value: string } }} */ e) { setCreateField('title', e.target.value) } }),
      state.createError !== ''
        ? createElement('div', { className: 'error', key: 'create-err', style: { fontSize: '12px' } }, state.createError)
        : null,
      createElement('div', { key: 'actions', style: { display: 'flex', gap: '6px' } },
        createElement(UiButton, { variant: 'primary', size: 'sm', key: 'save', disabled: state.createBusy || state.createPath.trim() === '', onClick: submitCreate }, state.createBusy ? dshT('创建中…') : dshT('保存')),
        createElement(UiButton, { variant: 'outline', size: 'sm', key: 'cancel', disabled: state.createBusy, onClick: closeCreate }, dshT('取消')),
      ),
    ))
  }

  // Workspaces list
  if (state.workspaces.length === 0 && !state.createOpen) {
    elements.push(createElement('div', { className: 'empty', key: 'empty' }, dshT('暂无工作区 — 点「➕ 新建工作区」选定一个目录作为项目根')))
  }
  for (let i = 0; i < state.workspaces.length; i++) {
    // Per-iteration binding: both `ws` and `i` are captured by the row's
    // onClick handlers. Plain `var` would hoist `i` (and `ws`) so every
    // handler would see the last iteration's values when invoked.
    const ws = state.workspaces[i]
    const isFirst = i === 0
    const isLast = i === state.workspaces.length - 1
    const isRenaming = state.renameId === ws.workspaceId
    const isDeleting = state.deleteId === ws.workspaceId

    var headerChildren = [
      createElement('span', { className: 'card-title-text', key: 'title', title: ws.workspaceId }, isRenaming
        ? createElement('span', { style: { display: 'inline-flex', gap: '6px' } },
            createElement(UiInput, {
              value: state.renameDraft, autoFocus: true,
              onChange: function (/** @type {{ target: { value: string } }} */ e) { setRenameDraft(e.target.value) },
              onKeyDown: function (/** @type {{ key: string }} */ e) { if (e.key === 'Enter') submitRename(); else if (e.key === 'Escape') cancelRename() },
            }),
            createElement(UiButton, { variant: 'primary', size: 'sm', key: 'rename-save', disabled: state.renameBusy, onClick: submitRename }, dshT('保存')),
            createElement(UiButton, { variant: 'outline', size: 'sm', key: 'rename-cancel', disabled: state.renameBusy, onClick: cancelRename }, dshT('取消')),
          )
        : ws.title || ws.path),
      createElement('span', { className: 'group-path', key: 'path', title: ws.path, style: { fontSize: '11px' } }, '📁 ' + ws.path),
    ]

    var actionChildren = []
    if (!isRenaming) {
      actionChildren.push(createElement(UiButton, { variant: 'outline', size: 'sm', key: 'btn-rename', onClick: function () { openRename(ws.workspaceId, ws.title) } }, dshT('✎ 重命名')))
      actionChildren.push(createElement(UiButton, { variant: 'outline', size: 'sm', key: 'btn-status', title: dshT('检查目录是否仍存在（不修改记录）'), onClick: function () { checkStatus(ws.workspaceId) } }, dshT('🔎 检查状态')))
      actionChildren.push(createElement(UiButton, { variant: 'outline', size: 'sm', key: 'btn-up', disabled: isFirst || state.busy, onClick: function () { moveUp(ws.workspaceId, i) } }, '⬆'))
      actionChildren.push(createElement(UiButton, { variant: 'outline', size: 'sm', key: 'btn-down', disabled: isLast || state.busy, onClick: function () { moveDown(ws.workspaceId, i) } }, '⬇'))
      actionChildren.push(createElement(UiButton, { variant: 'outline', size: 'sm', className: 'danger', key: 'btn-del', onClick: function () { askDelete(ws.workspaceId) } }, isDeleting ? '✕' : dshT('删除')))
    }

    var cardChildren = [
      createElement('div', { className: 'card-header', key: 'h' },
        createElement('span', { className: 'card-title', key: 'title-row' }, headerChildren),
        actionChildren.length > 0 ? createElement('span', { className: 'card-actions', key: 'a' }, actionChildren) : null,
      ),
      state.renameError !== '' && isRenaming
        ? createElement('div', { className: 'error', key: 'rename-err', style: { fontSize: '12px' } }, state.renameError)
        : null,
      isDeleting
        ? createElement('div', { className: 'confirm-bar', key: 'confirm' },
            createElement('span', { className: 'confirm-text' }, dshT('确定删除工作区「'), ws.title || ws.path, dshT('」？（仅删除注册，目录与会话本体保留）')),
            createElement('span', { className: 'confirm-actions' },
              createElement(UiButton, { variant: 'outline', size: 'sm', onClick: cancelDelete, key: 'cancel' }, dshT('取消')),
              createElement(UiButton, { variant: 'outline', size: 'sm',
              className: 'danger-solid', disabled: state.deleteBusy, onClick: confirmDelete, key: 'confirm-btn' }, state.deleteBusy ? dshT('删除中…') : dshT('删除')),
            ))
        : null,
      createElement('div', { className: 'card-sub', key: 'sub' },
        createElement('span', { className: 'card-sub-item' }, '📊 ' + (Array.isArray(ws.sessionIds) ? ws.sessionIds.length : 0) + dshT(' 个会话')),
        ws.createdAt ? createElement('span', { className: 'card-sub-item', style: { marginLeft: '12px', color: 'var(--dsw-alias-label-secondary, #61666b)' } }, dshT('创建于 ') + ws.createdAt.slice(0, 10)) : null,
        ws.updatedAt ? createElement('span', { className: 'card-sub-item', style: { marginLeft: '12px', color: 'var(--dsw-alias-label-secondary, #61666b)' } }, dshT('更新于 ') + ws.updatedAt.slice(0, 10)) : null,
      ),
    ]
    elements.push(createElement('div', { className: 'card', key: 'ws-' + ws.workspaceId }, cardChildren))
  }

  return createElement('div', { 'data-dsh-admin-section': '' }, elements)
}
