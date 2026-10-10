/** workflow — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiInput, createElement, dshT, messageOf, sectionState, showToast, useEffect, useRef } from './context.js'
import { btnStyle, inputStyle, pillStyle, preStyle, safeStringify, tabKeyDown, textareaStyle } from './shared.js'

/* ==========================================================================
 *                        动态工作流 (dynamic workflows)                      *
 * ========================================================================== */

/**
 * The 「工作流」 settings section: a ZCode-style dynamic-workflow console.
 *
 * Two tabs: 运行 (live + persisted runs with live polling, stop / amend /
 * resume actions) and 工作库 (saved scripts, save / run / delete). The host
 * half is `workflowAdmin` (lib/workflow-admin.js → lib/workflow-runs.js +
 * lib/workflow-library.js). All RPC goes through the same `call` closure as
 * every other section.
 *
 * Degrades to a one-line hint when the host half reports the engine off
 * (ctx.subagents missing) — same posture as WorkspacesSection.
 * @param {{ call: (method: string, args: Record<string, any>) => Promise<any> }} props - the renderer-bound props; `call` is the host RPC seam whose resolved payload is service-defined JSON (a duck-typed boundary, not modelled data).
 */
export function WorkflowSection(props) {
  var call = props.call
  var h = createElement
  var kit = sectionState({
    available: true,
    error: '',
    tab: 'runs',
    runs: [],
    saved: [],
    busy: false,
    openRunId: null,
    runDetail: null,
    editor: null,
    editorBusy: false,
    editorError: '',
    savedEditor: null,
    savedBusy: false,
    savedError: '',
    liveSessions: [],
    parentSessionId: '',
    confirmDelete: null,
    answerText: '',
    answerBusy: false,
  })
  var state = kit.state
  var patch = kit.patch
  var alive = kit.alive
  // reload 挂在 mount-effect 的首帧闭包上，直接读 state.* 永远是首帧旧值；
  // 轮询判定 / 父会话选择 / 计时器句柄都走 ref 镜像。
  var runsRef = useRef([])
  var parentSessionRef = useRef('')
  var pollTimerRef = useRef(null)

  // 父会话：settings 域没有「当前会话」上下文，从 sessionAdmin/list 取在线
  // 会话作为工作流的启动落点。恰一个在线会话时自动选中（不出控件）；软失败
  // ——拿不到时面板照常可用，提交由宿主报错提示。
  function loadParentSessions() {
    call('sessionAdmin/list', {}).then(function (res) {
      if (!alive.current || !res || !res.ok) return
      var live = ((res.value && res.value.sessions) || []).filter(function (/** @type {Record<string, any>} */ s) { return s && s.live && s.id })
      var keep = parentSessionRef.current
      parentSessionRef.current = live.some(function (/** @type {Record<string, any>} */ s) { return s.id === keep })
        ? keep
        : (live[0] ? live[0].id : '')
      patch({ liveSessions: live, parentSessionId: parentSessionRef.current })
    }, function () { /* 会话列表不可用不阻塞工作流面板 */ })
  }

  function reload() {
    patch({ busy: true, error: '' })
    loadParentSessions()
    Promise.all([
      call('workflowAdmin/listRuns', {}),
      call('workflowAdmin/listSaved', {}),
    ]).then(function (results) {
      if (!alive.current) return
      var runsRes = results[0]
      var savedRes = results[1]
      if (!runsRes.ok) {
        patch({ busy: false, available: false, error: messageOf(runsRes.error) })
        return
      }
      var runs = (runsRes.value && runsRes.value.active) || []
      runsRef.current = runs
      patch({
        busy: false,
        available: true,
        runs: runs,
        saved: (savedRes.ok && savedRes.value) || [],
      })
      schedulePoll()
    }, function (e) {
      if (!alive.current) return
      patch({ busy: false, available: false, error: messageOf(e) })
    })
  }

  kit.mount(reload)

  // 有运行中的任务时轮询（2s 起），否则停轮询省电。
  var pollFailures = 0
  function schedulePoll() {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    var anyRunning = (runsRef.current || []).some(function (/** @type {Record<string, any>} */ r) { return r.status === 'running' || r.status === 'pending' })
    if (!anyRunning) { pollFailures = 0; return }
    // 失败也要退避：原先成功与失败都按固定 2s 重排，于是"宿主半没有该接口 /
    // 传输一直失败"会变成每秒半次的永久重试，日志和控制台被刷满。
    var delay = Math.min(2000 * Math.pow(2, pollFailures), 30000)
    pollTimerRef.current = setTimeout(function () {
      if (!alive.current) return
      call('workflowAdmin/listRuns', {}).then(function (res) {
        if (!alive.current) return
        if (res.ok) {
          pollFailures = 0
          runsRef.current = (res.value && res.value.active) || []
          patch({ runs: runsRef.current })
        } else {
          pollFailures += 1
        }
        schedulePoll()
      }, function () {
        pollFailures += 1
        schedulePoll()
      })
    }, delay)
  }
  // Re-arm on runs changes only (mount + every poll result), not on every
  // render: a render-body call reset the timer on each keystroke and could
  // indefinitely defer the next listRuns refresh.
  useEffect(function () {
    schedulePoll()
    return function () { if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null } }
  }, [state.runs])

  // 详情卡的请求序号，按"最后一次点击的 run"裁决慢响应：点 A 再快点 B 时，
  // A 的慢回复不得覆盖 B 的详情——否则详情卡显示错 run，回答还会提交给显示
  // 中的错误运行。
  var detailSeq = useRef(0)

  function openRun(/** @type {string} */ runId) {
    if (state.openRunId === runId) { patch({ openRunId: null, runDetail: null, answerText: '' }); return }
    var seq = ++detailSeq.current
    patch({ openRunId: runId, runDetail: null, answerText: '' })
    call('workflowAdmin/getRun', { runId: runId }).then(function (res) {
      if (!alive.current || seq !== detailSeq.current) return
      if (res.ok) patch({ runDetail: res.value })
      else patch({ runDetail: { error: messageOf(res.error) } })
    }, function (error) {
      // 详情卡只在 `state.runDetail` 有值时渲染：传输失败/宿主半未注册该接口时，
      // 没有这个失败分支就只是"点了没反应"，外加一个未处理的 rejection。
      if (!alive.current || seq !== detailSeq.current) return
      patch({ runDetail: { error: messageOf(error) } })
    })
  }

  function startFromEditor() {
    var ed = state.editor
    if (!ed || !ed.script) { patch({ editorError: dshT('脚本不能为空') }); return }
    var args = null
    if (ed.argsText && ed.argsText.trim()) {
      try { args = JSON.parse(ed.argsText) }
      catch (e) { patch({ editorError: dshT('args 不是合法 JSON：') + messageOf(e) }); return }
    }
    patch({ editorBusy: true, editorError: '' })
    /** @type {Record<string, any>} */
    var spec = { script: ed.script, label: ed.label || dshT('工作流'), args: args || {} }
    if (parentSessionRef.current) spec.parentSessionId = parentSessionRef.current
    call('workflowAdmin/startRun', { spec: spec }).then(function (res) {
      if (!alive.current) return
      // 网关把宿主返回包在 { ok, value | error } 里；写路径一律先解包再读业务字段。
      var r = res && res.ok ? res.value : null
      if (r && r.id) {
        patch({ editorBusy: false, editor: null, tab: 'runs', openRunId: r.id })
        showToast('success', dshT('🚀 工作流已启动'))
        reload()
      } else {
        var diags = ((r && r.diagnostics) || []).map(function (/** @type {Record<string, any>} */ d) { return d.message }).join('\n')
        patch({ editorBusy: false, editorError: diags || messageOf((res && res.error) || (r && r.error)) })
      }
    }, function (e) {
      if (!alive.current) return
      patch({ editorBusy: false, editorError: messageOf(e) })
    })
  }

  // 列表/详情上的即发即弃动作（stop / resume / run_saved / delete_saved）共用
  // 一把在途闸：双击不再双发 RPC，迟到的应答也不会与重试叠在一起。成功与失败
  // 分支都先放闸，再走 alive 守卫。
  var runActionBusy = useRef(false)

  function stopRun(/** @type {string} */ runId) {
    if (runActionBusy.current) return
    runActionBusy.current = true
    call('workflowAdmin/stopRun', { runId: runId, reason: 'panel' }).then(function (res) {
      runActionBusy.current = false
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.stopped === false) showToast('error', dshT('该运行已不在进行中'))
      if (r && r.abandoned) showToast('error', dshT('停止请求已送达，但运行未在预算内落定（脚本忽略取消信号？）'))
      reload()
    }, function (e) {
      runActionBusy.current = false
      showToast('error', dshT('❌ 停止失败：') + messageOf(e))
    })
  }

  function amendRun(/** @type {string} */ runId) {
    var rec = state.runDetail
    var script = rec && rec.script ? rec.script : ''
    patch({ editor: { runId: runId, script: script, label: rec && rec.label ? rec.label : '', argsText: '' }, editorError: '', tab: 'runs' })
  }

  function submitAmend() {
    var ed = state.editor
    if (!ed || !ed.script) { patch({ editorError: dshT('脚本不能为空') }); return }
    patch({ editorBusy: true, editorError: '' })
    call('workflowAdmin/amendRun', { runId: ed.runId, script: ed.script, spec: {} }).then(function (res) {
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.id) {
        patch({ editorBusy: false, editor: null, openRunId: r.id })
        showToast('success', dshT('✏️ 已基于旧步骤缓存重建工作流'))
        reload()
      } else {
        var diags = ((r && r.diagnostics) || []).map(function (/** @type {Record<string, any>} */ d) { return d.message }).join('\n')
        patch({ editorBusy: false, editorError: diags || messageOf((res && res.error) || (r && r.error)) })
      }
    }, function (e) {
      if (!alive.current) return
      patch({ editorBusy: false, editorError: messageOf(e) })
    })
  }

  function submitAnswer() {
    var text = (state.answerText || '').trim()
    if (!text || !state.runDetail || !state.runDetail.pendingQuestion) return
    patch({ answerBusy: true })
    call('workflowAdmin/answerRun', { runId: state.runDetail.id, text: text }).then(function (res) {
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.answered) {
        patch({ answerBusy: false, answerText: '' })
        showToast('success', dshT('✅ 已回答，工作流继续'))
        if (state.openRunId) openRun(state.openRunId)
      } else {
        patch({ answerBusy: false })
        showToast('error', dshT('回答失败：') + messageOf((res && res.error) || (r && r.error)))
      }
    }, function (e) {
      if (!alive.current) return
      patch({ answerBusy: false })
      showToast('error', dshT('❌ 回答失败：') + messageOf(e))
    })
  }

  function resumeRun(/** @type {string} */ runId) {
    if (runActionBusy.current) return
    runActionBusy.current = true
    call('workflowAdmin/resumeRun', { runId: runId }).then(function (res) {
      runActionBusy.current = false
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.id) { patch({ openRunId: r.id }); showToast('success', dshT('▶️ 已从断点续跑')); reload() }
      else showToast('error', messageOf((res && res.error) || (r && r.error)))
    }, function (e) {
      runActionBusy.current = false
      showToast('error', dshT('❌ 续跑失败：') + messageOf(e))
    })
  }

  function runSaved(/** @type {string} */ name) {
    if (runActionBusy.current) return
    runActionBusy.current = true
    /** @type {Record<string, any>} */
    var payload = { spec: { name: name, args: {} } }
    if (parentSessionRef.current) payload.spec.parentSessionId = parentSessionRef.current
    call('workflowAdmin/runSaved', payload).then(function (res) {
      runActionBusy.current = false
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.id) { patch({ tab: 'runs', openRunId: r.id }); showToast('success', dshT('🚀 已启动：') + name); reload() }
      else showToast('error', messageOf((res && res.error) || (r && r.error)))
    }, function (e) {
      runActionBusy.current = false
      showToast('error', dshT('❌ 启动失败：') + messageOf(e))
    })
  }

  function saveSavedFromEditor() {
    var ed = state.savedEditor
    if (!ed || !ed.name || !ed.script) { patch({ savedError: dshT('名称和脚本不能为空') }); return }
    patch({ savedBusy: true, savedError: '' })
    call('workflowAdmin/saveSaved', { spec: ed }).then(function (res) {
      if (!alive.current) return
      // 网关把宿主返回包在 { ok, value | error } 里；写路径一律先解包再读业务字段
      // （服务端 saveSaved 的 { ok: false, error } 是业务层失败，传输层恒 ok:true）。
      var r = res && res.ok ? res.value : null
      if (r && r.ok) { patch({ savedBusy: false, savedEditor: null }); showToast('success', dshT('💾 已保存：') + ed.name); reload() }
      else patch({ savedBusy: false, savedError: (r && r.error) || (res && res.error ? messageOf(res.error) : '') || dshT('未知错误') })
    }, function (e) {
      if (!alive.current) return
      patch({ savedBusy: false, savedError: messageOf(e) })
    })
  }

  function deleteSaved(/** @type {string} */ name, /** @type {string} */ scope) {
    if (runActionBusy.current) return
    runActionBusy.current = true
    call('workflowAdmin/deleteSaved', { spec: { name: name, scope: scope } }).then(function (res) {
      runActionBusy.current = false
      if (!alive.current) return
      // 同 saveSaved：先解网关信封再读业务层 ok（删除失败/不存在时业务层 ok:false）。
      var r = res && res.ok ? res.value : null
      if (r && r.ok) { patch({ confirmDelete: null }); showToast('success', dshT('🗑 已删除：') + name); reload() }
      else showToast('error', dshT('❌ 删除失败：') + ((r && r.error) || (res && res.error ? messageOf(res.error) : '') || dshT('未知错误')))
    }, function (e) {
      runActionBusy.current = false
      showToast('error', dshT('❌ 删除失败：') + messageOf(e))
    })
  }

  if (!state.available) {
    return h('div', { 'data-dsh-admin-section': '' },
      h('div', { className: 'card', style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
        dshT('工作流引擎不可用：未挂载 @deepseek-ai/dsh-subagent，或服务启动失败。')
        + (state.error ? dshT('（宿主返回：') + state.error + dshT('）') : '')))
  }

  // 新手引导条：一句话说清工作流是什么 + 三步操作。对老用户无干扰（一行高度）。
  var elements = []
  elements.push(h('div', { key: 'guide', className: 'card', style: { padding: '10px 12px', marginBottom: '10px', borderRadius: '10px', border: '1px solid var(--dsw-static-blue-500, #5B4CF0)', background: 'var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))' } }, [
    h('div', { key: 'g1', style: { fontWeight: '700', marginBottom: '4px' } }, dshT('工作流 = 把多步任务写成小脚本，交给 dsh 自动派子智能体逐步完成')),
    h('div', { key: 'g2', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)' } },
      dshT('三步上手：① 点「从模板开始」里的任意卡片 → ② 按需改名称和参数 → ③ 点「🚀 启动」，运行卡片实时显示每一步进度与结果。')),
  ]))

  // 运行/工作库两个内部页签与外层 section 页签同一套 ARIA tabs 契约
  // （tablist/tab/roving tabindex/方向键）。面板内容不是单个可寻址节点，
  // 所以这里不做 aria-controls/tabpanel 关联。
  var wfTabs = [{ id: 'runs' }, { id: 'saved' }]
  elements.push(h('div', { key: 'tabs', role: 'tablist', 'aria-label': dshT('工作流'),
    onKeyDown: function (/** @type {KeyboardEvent} */ event) {
      tabKeyDown(event, wfTabs, state.tab, function (next) { patch({ tab: next, editor: null, savedEditor: null }) })
    },
    style: { display: 'flex', gap: '8px', marginBottom: '12px' } }, [
    tabButton('runs', dshT('运行 (') + (state.runs || []).length + ')'),
    tabButton('saved', dshT('工作库 (') + (state.saved || []).length + ')'),
  ]))

  if (state.error) {
    elements.push(h('div', { key: 'err', className: 'card', style: { padding: '10px', color: '#c00', marginBottom: '10px' } }, state.error))
  }

  if (state.tab === 'runs') {
    elements.push(renderRunsTab())
    if (state.editor) elements.push(renderEditor())
  } else {
    elements.push(renderSavedTab())
    if (state.savedEditor) elements.push(renderSavedEditor())
  }

  return h('div', { 'data-dsh-admin-section': '' }, elements)

  function tabButton(/** @type {string} */ key, /** @type {string} */ label) {
    var active = state.tab === key
    return h('button', {
      key: 'tab-' + key,
      role: 'tab',
      id: 'dsh-admin-wf-tab-' + key,
      'aria-selected': active,
      tabIndex: active ? 0 : -1,
      onClick: function () { patch({ tab: key, editor: null, savedEditor: null }) },
      style: {
        padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
        border: active ? '1px solid var(--dsw-static-blue-500, #5B4CF0)' : '1px solid var(--dsw-alias-border-l2, #ddd)',
        background: active ? 'var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.1))' : 'transparent',
        fontWeight: active ? '600' : '400',
      },
    }, label)
  }

  function renderRunsTab() {
    var children = []
    // 模板卡片：普通用户的一键入口 —— 点卡片 = 脚本/名称/参数全部填好。
    children.push(h('div', { key: 'tpl-head', style: { fontWeight: '600', marginBottom: '6px' } }, dshT('从模板开始（点卡片自动填好，改参数就能跑）')))
    children.push(h('div', { key: 'tpl-row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } },
      wfTemplates().map(function (tpl, tplIndex) {
        var openTpl = function () { patch({ editor: { runId: null, script: tpl.script, label: tpl.title, argsText: tpl.argsText }, editorError: '', tab: 'runs' }) }
        return h('div', {
          key: 'tpl-' + tplIndex,
          role: 'button',
          tabIndex: 0,
          onClick: openTpl,
          onKeyDown: function (/** @type {KeyboardEvent} */ event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTpl() } },
          style: { flex: '1', minWidth: '170px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-static-blue-500, #5B4CF0)', background: 'var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))', cursor: 'pointer' },
        }, [
          h('div', { key: 't', style: { fontWeight: '700' } }, tpl.title),
          h('div', { key: 'd', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', marginTop: '2px' } }, tpl.desc),
        ])
      })
    ))
    children.push(h('button', {
      key: 'new-run',
      onClick: function () { patch({ editor: { runId: null, script: exampleScript(), label: '', argsText: '{}' }, editorError: '' }) },
      style: btnStyle(),
    }, dshT('＋ 新建工作流（自己写脚本）')))

    var runs = state.runs || []
    if (runs.length === 0) {
      children.push(h('div', { key: 'empty', className: 'card', style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: '10px' } },
        dshT('暂无运行。三步上手：点上方模板卡片 → 按需改参数 → 点「🚀 启动」。也可以从「工作库」启动已保存的脚本。')))
    }
    for (var i = 0; i < runs.length; i++) {
      children.push(runCard(runs[i]))
    }
    if (state.openRunId && state.runDetail) children.push(runDetailCard())
    return h('div', { key: 'runs-tab' }, children)
  }

  function runCard(/** @type {Record<string, any>} */ run) {
    var statusColor = run.status === 'completed' ? '#2e7d32'
      : run.status === 'errored' ? '#c00'
      : run.status === 'stopped' ? '#b26a00'
      : '#5B4CF0'
    var row = [
      h('span', { key: 'label', style: { fontWeight: '600' } }, run.label || run.id),
      h('span', { key: 'status', style: pillStyle(statusColor) }, statusText(run.status)),
    ]
    if (run.stepCount) row.push(h('span', { key: 'steps', style: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px' } }, run.stepCount + dshT(' 步')))
    if (run.durationMs) row.push(h('span', { key: 'dur', style: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px' } }, Math.round(run.durationMs / 100) / 10 + 's'))
    var actions = h('span', { key: 'actions', style: { marginLeft: 'auto', display: 'flex', gap: '6px' } }, [
      h('button', { key: 'open', onClick: function () { openRun(run.id) }, style: btnStyle() }, dshT('详情')),
      run.status === 'running' || run.status === 'pending'
        ? h('button', { key: 'stop', onClick: function () { stopRun(run.id) }, style: btnStyle('#c00') }, dshT('⏹ 停止'))
        : null,
      run.status === 'stopped' || run.status === 'errored'
        ? h('button', { key: 'resume', onClick: function () { resumeRun(run.id) }, style: btnStyle() }, dshT('▶ 续跑'))
        : null,
      run.status === 'completed' || run.status === 'stopped' || run.status === 'errored'
        ? h('button', { key: 'amend', onClick: function () { amendRun(run.id) }, style: btnStyle() }, dshT('✏️ 改建'))
        : null,
    ])
    row.push(actions)
    return h('div', { key: 'run-' + run.id, className: 'card', style: { padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px' } }, row)
  }

  function runDetailCard() {
    var d = state.runDetail
    if (d.error) return h('div', { key: 'detail', className: 'card', style: { padding: '12px', color: '#c00', marginTop: '8px' } }, d.error)
    var children = [
      h('div', { key: 'id', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } }, d.id),
    ]
    // 挂起的问题：脚本卡在 ask()，等一个回答才继续。给一行输入框直接回。
    if (d.pendingQuestion) {
      children.push(h('div', {
        key: 'q',
        className: 'card',
        style: { padding: '10px', marginTop: '8px', border: '1px solid #e8c84e', background: 'rgba(232,200,78,.08)' },
      }, [
        h('div', { key: 'q-head', style: { fontWeight: '700', marginBottom: '6px' }, }, dshT('⏸ 工作流在等待回答')),
        h('div', { key: 'q-text', style: { fontSize: '13px', marginBottom: '8px' } }, d.pendingQuestion.text || ''),
        h('div', { key: 'q-row', style: { display: 'flex', gap: '8px' } }, [
          h(UiInput, {
            key: 'q-input', className: 'wf-input', style: { flex: '1' }, placeholder: dshT('回答…'), value: state.answerText || '',
            onChange: function (/** @type {{ target: { value: string } }} */ e) { patch({ answerText: e.target.value }) },
            onKeyDown: function (/** @type {{ key: string }} */ e) { if (e.key === 'Enter') submitAnswer() },
          }),
          h('button', {
            key: 'q-btn', onClick: submitAnswer, disabled: state.answerBusy,
            style: btnStyle('#5B4CF0', '#fff'),
          }, state.answerBusy ? dshT('发送中…') : dshT('回答')),
        ]),
      ]))
    }
    children.push(h('div', { key: 'script-head', style: { fontWeight: '600', marginTop: '8px' } }, dshT('脚本')))
    children.push(h('pre', { key: 'script', style: preStyle() }, d.script || ''))
    if (d.error) children.push(h('div', { key: 'err', style: { color: '#c00', marginTop: '6px' } }, d.error))
    if (d.result !== null && d.result !== undefined) {
      children.push(h('div', { key: 'res-head', style: { fontWeight: '600', marginTop: '8px' } }, dshT('返回值')))
      children.push(h('pre', { key: 'res', style: preStyle() }, safeStringify(d.result)))
    }
    var log = d.log || []
    if (log.length) {
      children.push(h('div', { key: 'log-head', style: { fontWeight: '600', marginTop: '8px' } }, dshT('日志')))
      for (var i = 0; i < log.length; i++) {
        children.push(h('div', { key: 'log-' + i, style: { fontSize: '12px', fontFamily: 'monospace', padding: '2px 0' } },
          '[' + (log[i].kind || '?') + '] ' + (log[i].message || log[i].title || safeStringify(log[i].value) || '')))
      }
    }
    return h('div', { key: 'detail', className: 'card', style: { padding: '12px', marginTop: '8px' } }, children)
  }

  function renderEditor() {
    var ed = state.editor
    var isAmend = !!ed.runId
    var children = [
      h('div', { key: 'head', style: { fontWeight: '700', marginBottom: '8px' } },
        isAmend ? dshT('改建工作流（已完成步骤走缓存，不重花调用）') : dshT('新建工作流')),
      h(UiInput, {
        key: 'label', className: 'wf-input', placeholder: dshT('名称（可选）'), value: ed.label,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.label = e.target.value; patch({ editor: ed }) },
        readOnly: isAmend,
      }),
      (!isAmend && state.liveSessions.length > 1)
        ? h('div', { key: 'parent-row', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          h('span', { key: 'parent-label', style: { flex: 'none', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } }, dshT('父会话')),
          h('select', {
            key: 'parent', value: state.parentSessionId,
            onChange: function (/** @type {{ target: { value: string } }} */ e) { parentSessionRef.current = e.target.value; patch({ parentSessionId: e.target.value }) },
            style: inputStyle({ flex: '1' }),
          }, state.liveSessions.map(function (/** @type {Record<string, any>} */ s) {
            return h('option', { key: s.id, value: s.id }, (s.title || s.id) + (s.cwd ? ' · ' + s.cwd : ''))
          })),
        ])
        : (!isAmend && state.liveSessions.length === 0)
          ? h('div', { key: 'parent-hint', style: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px' } },
            dshT('没有在线会话——先在 dsh 中打开一个会话，再启动工作流。'))
          : null,
      h('textarea', {
        key: 'script', placeholder: dshT('TypeScript / JavaScript，顶层 return 返回结果'), value: ed.script,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.script = e.target.value; patch({ editor: ed }) },
        style: textareaStyle(),
      }),
      h('textarea', {
        key: 'args', placeholder: dshT('args（JSON 对象）'), value: ed.argsText,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.argsText = e.target.value; patch({ editor: ed }) },
        style: textareaStyle({ height: '60px' }),
      }),
    ]
    if (state.editorError) {
      children.push(h('pre', { key: 'ederr', style: preStyle({ color: '#c00', borderColor: '#e8b4b4' }) }, state.editorError))
    }
    children.push(h('div', { key: 'args-hint', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: '4px' } },
      dshT('参数：脚本里 args.xxx 的值，在上面这个 JSON 里填（模板已带默认值，可直接改）。')))
    children.push(h('div', { key: 'edbtns', style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
      h('button', {
        key: 'submit', onClick: isAmend ? submitAmend : startFromEditor, disabled: state.editorBusy,
        style: btnStyle('#5B4CF0', '#fff'),
      }, state.editorBusy ? dshT('提交中…') : (isAmend ? dshT('确认改建') : dshT('🚀 启动'))),
      h('button', { key: 'cancel', onClick: function () { patch({ editor: null, editorError: '' }) }, style: btnStyle() }, dshT('取消')),
    ]))
    return h('div', { key: 'editor', className: 'card', style: { padding: '14px', marginTop: '12px' } }, children)
  }

  function renderSavedTab() {
    var children = [
      h('button', {
        key: 'new-saved',
        onClick: function () { patch({ savedEditor: { name: '', scope: 'global', script: exampleScript(), description: '', argsText: '' }, savedError: '' }) },
        style: btnStyle(),
      }, dshT('＋ 保存一个工作流')),
    ]
    var saved = state.saved || []
    if (saved.length === 0) {
      children.push(h('div', { key: 'empty', className: 'card', style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: '10px' } },
        dshT('工作库为空。保存常用脚本后，可以按名一键启动。')))
    }
    for (var i = 0; i < saved.length; i++) {
      children.push(savedCard(saved[i]))
    }
    return h('div', { key: 'saved-tab' }, children)
  }

  function savedCard(/** @type {Record<string, any>} */ rec) {
    var isConfirm = state.confirmDelete === rec.name + ':' + rec.scope
    var row = [
      h('span', { key: 'name', style: { fontWeight: '600' } }, rec.name),
      h('span', { key: 'scope', style: pillStyle(rec.scope === 'project' ? '#0b7285' : '#6c757d') },
        rec.scope === 'project' ? dshT('项目') : dshT('全局')),
    ]
    if (rec.description) row.push(h('span', { key: 'desc', style: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px' } }, rec.description))
    var actions = h('span', { key: 'actions', style: { marginLeft: 'auto', display: 'flex', gap: '6px' } }, [
      h('button', { key: 'run', onClick: function () { runSaved(rec.name) }, style: btnStyle('#5B4CF0', '#fff') }, dshT('🚀 运行')),
      isConfirm
        ? h('button', { key: 'del-yes', onClick: function () { deleteSaved(rec.name, rec.scope) }, style: btnStyle('#c00', '#fff') }, dshT('确认删除'))
        : h('button', { key: 'del', onClick: function () { patch({ confirmDelete: rec.name + ':' + rec.scope }) }, style: btnStyle() }, dshT('🗑 删除')),
      isConfirm
        ? h('button', { key: 'del-no', onClick: function () { patch({ confirmDelete: null }) }, style: btnStyle() }, dshT('取消'))
        : null,
    ])
    row.push(actions)
    // key 必须含 scope：项目/全局两个作用域允许同名，纯 name 的 key 会让
    // React 在两卡片间错误复用节点。
    return h('div', { key: 'saved-' + rec.name + ':' + rec.scope, className: 'card', style: { padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px' } }, row)
  }

  function renderSavedEditor() {
    var ed = state.savedEditor
    var children = [
      h('div', { key: 'head', style: { fontWeight: '700', marginBottom: '8px' } }, dshT('保存到工作库')),
      h(UiInput, {
        key: 'name', className: 'wf-input', placeholder: dshT('名称（字母数字 . _ -）'), value: ed.name,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.name = e.target.value; patch({ savedEditor: ed }) },
      }),
      h('select', {
        key: 'scope', value: ed.scope,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.scope = e.target.value; patch({ savedEditor: ed }) },
        style: inputStyle(),
        'aria-label': dshT('保存作用域'),
      }, [
        h('option', { key: 'g', value: 'global' }, dshT('全局')),
        // 项目作用域对面板是死路：宿主 saveSaved 对 project scope 必须拿到
        // workspacePath（<root>/.dsh/workflows 的信任闸门），而面板调用没有
        // 会话上下文可携带——真给这选项放行，保存 100% 报错。禁用并指路。
        h('option', {
          key: 'p', value: 'project', disabled: true,
          title: dshT('面板保存无法携带工作区路径——项目级工作流请经模型的 workflow_admin 工具保存（自动存入当前会话的项目）'),
        }, dshT('项目（随工作区 .dsh/）')),
      ]),
      h(UiInput, {
        key: 'desc', className: 'wf-input', placeholder: dshT('一句话描述（可选）'), value: ed.description,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.description = e.target.value; patch({ savedEditor: ed }) },
      }),
      h('textarea', {
        key: 'script', placeholder: dshT('脚本'), value: ed.script,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.script = e.target.value; patch({ savedEditor: ed }) },
        style: textareaStyle(),
      }),
    ]
    if (state.savedError) {
      children.push(h('pre', { key: 'sverr', style: preStyle({ color: '#c00', borderColor: '#e8b4b4' }) }, state.savedError))
    }
    children.push(h('div', { key: 'svbtns', style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
      h('button', {
        key: 'save', onClick: saveSavedFromEditor, disabled: state.savedBusy,
        style: btnStyle('#5B4CF0', '#fff'),
      }, state.savedBusy ? dshT('保存中…') : dshT('💾 保存')),
      h('button', { key: 'cancel', onClick: function () { patch({ savedEditor: null, savedError: '' }) }, style: btnStyle() }, dshT('取消')),
    ]))
    return h('div', { key: 'saved-editor', className: 'card', style: { padding: '14px', marginTop: '12px' } }, children)
  }
}

// Evaluated per call (click handlers / initial editor content) so a locale
// switch retranslates the comment header.
export function exampleScript() {
  return [
  dshT('// 可用：agent(prompt, opts?) / parallel(thunks) / pipeline(items, ...stages)'),
  dshT('//       phase(title) / log(msg) / report(key, value) / shell(cmd)'),
  dshT('// 顶层 return 返回结果；单步失败 agent() 返回 null，脚本继续。'),
  'const files = ["a.ts", "b.ts"]',
  'const reviews = await parallel(files.map((f) => () => agent("审查 " + f + " 的类型问题")))',
  'return reviews.filter((r) => r !== null)',
].join('\n')
}

export function wfTemplates() {
  return [
  {
    title: dshT('总结一个主题'),
    desc: dshT('派一个子智能体，按你给的主题输出一段总结'),
    label: dshT('主题总结'),
    argsText: '{\n  "topic": "dsh 插件系统"\n}',
      script: [
      '// 一步工作流：一个子智能体完成一次总结',
      '// 参数 args.topic 在「参数」框里填',
      'var summary = await agent(',
      '  "请用不超过 200 字总结这个主题：" + (args.topic || "")',
      ')',
      'return { summary: summary }',
    ].join('\n'),
  },
  {
    title: dshT('并行双角度分析'),
    desc: dshT('两个子智能体并行，分别从技术与体验角度分析'),
    label: '双角度分析',
    argsText: '{\n"topic": "dsh 自动化面板"\n}',
    script: [
      '// 并行工作流：两个子智能体同时跑，全部完成后合并返回',
      'var r = await parallel([',
      '  function () { return agent("从技术架构角度分析：" + (args.topic || "")) },',
      '  function () { return agent("从使用体验角度分析：" + (args.topic || "")) },',
      '])',
      'return { tech: r[0], ux: r[1] }',
    ].join('\n'),
  },
  {
    title: dshT('分步润色流水线'),
    desc: dshT('几个主题依次经过「初稿 → 润色」两道工序'),
    label: '润色流水线',
    argsText: '{\n"items": ["定时任务", "Webhook"]\n}',
    script: [
      '// 流水线工作流：每个主题依次过两道工序（上一个的输出是下一个的输入）',
      'var items = args.items || []',
      'var out = await pipeline(items,',
      '  function (item) { return agent("为「" + item + "」写一段 50 字介绍") },',
      '  function (draft) { return agent("把这段介绍润色得更口语化：" + draft) },',
      ')',
      'return out',
    ].join('\n'),
  },
]
}

export function statusText(/** @type {string} */ s) {
  return s === 'running' ? dshT('运行中')
    : s === 'completed' ? dshT('已完成')
    : s === 'errored' ? dshT('失败')
    : s === 'stopped' ? dshT('已停止')
    : s === 'orphaned' ? dshT('已失活')
    : s
}
