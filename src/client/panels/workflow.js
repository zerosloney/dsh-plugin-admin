/** workflow — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiInput, createElement, dshT, messageOf, sectionState, showToast, useEffect, useRef } from './context.js'
import { preStyle, safeStringify, tabKeyDown } from './shared.js'

/* ==========================================================================
 *                        动态工作流 (dynamic workflows)                      *
 * ========================================================================== */

/**
 * The 「工作流」 settings section: a ZCode-style dynamic-workflow console.
 *
 * Two tabs: 运行 (live + persisted runs with live polling, stop / amend /
 * resume actions) and 工作库 (saved scripts, save / run / delete). Both lists
 * render as `.row` lines inside a `.list`, and the editor / run detail /
 * one-click generator replace the list wholesale (the v1.36 command-hook page
 * convention). The host half is `workflowAdmin` (lib/workflow-admin.js →
 * lib/workflow-runs.js + lib/workflow-library.js). All RPC goes through the
 * same `call` closure as every other section.
 *
 * 一键生成 (generator): the user writes one sentence, the panel launches a
 * fixed generator script through workflowAdmin/startRun; the script asks a
 * subagent to write the workflow, returns `{ name, script }`, and the panel
 * auto-saves that into the library when the run settles (completed →
 * getRun → saveSaved; errored/stopped → failure toast). 见 settleGenerating。
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
    generator: null,
    generating: {},
  })
  var state = kit.state
  var patch = kit.patch
  var alive = kit.alive
  // reload 挂在 mount-effect 的首帧闭包上，直接读 state.* 永远是首帧旧值；
  // 轮询判定 / 父会话选择 / 计时器句柄 / 生成账本都走 ref 镜像。
  var runsRef = useRef([])
  var parentSessionRef = useRef('')
  var pollTimerRef = useRef(null)
  var generatingRef = useRef(/** @type {Record<string, Record<string, any>>} */ ({}))

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
      settleGenerating(runs)
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
          settleGenerating(runsRef.current)
          // 打开着的详情随轮询刷新（运行中的 run 每一步都在变）。seq 裁决与
          // openRun 相同：慢响应不得覆盖新打开的详情。
          if (state.openRunId && state.runDetail && !state.runDetail.error) {
            var seq = ++detailSeq.current
            call('workflowAdmin/getRun', { runId: state.openRunId }).then(function (fresh) {
              if (!alive.current || seq !== detailSeq.current) return
              if (fresh.ok) patch({ runDetail: fresh.value })
            }, function () { /* 刷新失败静默——下一轮轮询再试 */ })
          }
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

  // 详情页的请求序号，按"最后一次点击的 run"裁决慢响应：点 A 再快点 B 时，
  // A 的慢回复不得覆盖 B 的详情——否则详情页显示错 run，回答还会提交给显示
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
      // 详情页只在 `state.runDetail` 有值时渲染：传输失败/宿主半未注册该接口时，
      // 没有这个失败分支就只是"点了没反应"，外加一个未处理的 rejection。
      if (!alive.current || seq !== detailSeq.current) return
      patch({ runDetail: { error: messageOf(error) } })
    })
  }

  function closeDetail() {
    patch({ openRunId: null, runDetail: null, answerText: '' })
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
        patch({ editorBusy: false, editor: null, tab: 'runs', openRunId: r.id, runDetail: null, answerText: '' })
        // A detail request for the PREVIOUS run may still be in flight; its
        // answer must not land under the new openRunId's card.
        detailSeq.current++
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

  /* ── 一键生成 ────────────────────────────────────────────────────────────
   * 表单一句话 → startRun(GENERATOR_SCRIPT, args={ description, nameHint })。
   * run 落终态后由 settleGenerating 出账：completed → 取返回值里的脚本 →
   * 清洗/去重名称 → saveSaved 自动存入工作库（用户已确认自动保存语义）。
   * 幂等性：账本（generatingRef / state.generating）只活在本次挂载——面板重开
   * 后丢失，对应的生成 run 退化为一条普通 run（详情里看得到返回值中的脚本），
   * 不会自动补存。
   */

  // 生成器脚本：在 worker realm 里执行，把 args.description 交给子代理写成
  // 工作流脚本，原样带回给面板（顶层 return { name, script }）。注意：dshT
  // 不适用于脚本体（这是发给孩子进程的代码，不是 UI 文案），字符串一律用
  // 双引号——verify-i18n 的裸 CJK 扫描按单引号字面量配对。
  var GENERATOR_SCRIPT = [
    '// 一键生成：把 args.description 交给子代理写成工作流脚本，原样带回给面板。',
    'var desc = String(args.description || "")',
    "if (!desc) throw new Error(\"缺少需求描述（args.description）\")",
    'var PROMPT = [',
    "  \"你是 dsh 工作流脚本生成器。根据用户需求写一个可执行的工作流脚本。\",",
    "  \"脚本约束：纯 JavaScript（不要 TS 语法与类型标注）；顶层可用 await；顶层必须 return 一个 JSON 值。\",",
    "  \"可用 API（仅这些，没有 require/fetch/process/fs）：\",",
    "  \"- agent(prompt, opts?) 派一个子代理，返回其回复文本；单步失败返回 null 不抛错\",",
    "  \"- parallel([thunks]) 并行执行，返回结果数组；pipeline(items, ...stages) 逐项流水线\",",
    "  \"- phase(title) / log(msg) / report(key, value) 记录进度\",",
    "  \"- ask(question) 阻塞等用户在面板回答\",",
    "  \"- shell(cmd, opts?) 跑宿主命令，返回 { exitCode, stdout, stderr, timedOut }（非零退出码是数据不是异常）\",",
    "  \"- 脚本入参在全局 args 对象上\",",
    "  \"输出格式（严格遵守）：第一行是注释 // name: <kebab-case-english-short-name>；其余全部是脚本代码；不要 markdown 围栏；不要任何解释文字。\",",
    '].join("\\n")',
    "var reply = await agent(PROMPT + \"\\n\\n用户需求：\" + desc)",
    'var text = String(reply || "").trim()',
    '  .replace(/^```[a-zA-Z]*\\s*/, "")',
    '  .replace(/```\\s*$/, "")',
    '  .trim()',
    'var m = text.match(/^\\/\\/\\s*name:[ \\t]*([A-Za-z0-9._-]+)[ \\t]*\\r?\\n/)',
    'var name = m ? m[1] : String(args.name || "").replace(/[^A-Za-z0-9._-]/g, "")',
    'var script = m ? text.slice(m[0].length).trim() : text',
    "if (!script) throw new Error(\"子代理没有返回脚本内容\")",
    'return { name: name, script: script }',
  ].join('\n')

  function openGenerator() {
    patch({ generator: { description: '', name: '', busy: false, error: '' }, editor: null, editorError: '', openRunId: null, runDetail: null, answerText: '' })
  }

  function submitGenerator() {
    var gen = state.generator
    var desc = ((gen && gen.description) || '').trim()
    if (!desc) { gen.error = dshT('请先描述任务'); patch({ generator: gen }); return }
    gen.busy = true
    gen.error = ''
    patch({ generator: gen })
    /** @type {Record<string, any>} */
    var spec = { script: GENERATOR_SCRIPT, label: '✨ ' + (desc.length > 40 ? desc.slice(0, 40) : desc), args: { description: desc, nameHint: gen.name || '' } }
    if (parentSessionRef.current) spec.parentSessionId = parentSessionRef.current
    call('workflowAdmin/startRun', { spec: spec }).then(function (res) {
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.id) {
        var book = /** @type {Record<string, Record<string, any>>} */ ({})
        for (var k in generatingRef.current) book[k] = generatingRef.current[k]
        book[r.id] = { name: gen.name || '', description: desc }
        generatingRef.current = book
        patch({ generator: null, generating: book })
        showToast('success', dshT('已开始生成，完成后自动存入工作库'))
        reload()
      } else {
        var diags = ((r && r.diagnostics) || []).map(function (/** @type {Record<string, any>} */ d) { return d.message }).join('\n')
        gen.busy = false
        gen.error = diags || messageOf((res && res.error) || (r && r.error))
        patch({ generator: gen })
      }
    }, function (e) {
      if (!alive.current) return
      gen.busy = false
      gen.error = messageOf(e)
      patch({ generator: gen })
    })
  }

  // 完成检测：reload 与轮询的 listRuns 响应都会路过这里。账上 id 的 run 落入
  // 终态（completed/errored/stopped）即出账处理——先移除再处理，getRun /
  // saveSaved 是异步的，留在账上会被下一轮轮询重入。全程 alive 守卫。
  function settleGenerating(/** @type {Array<Record<string, any>>} */ runs) {
    var book = generatingRef.current
    var ids = Object.keys(book)
    if (ids.length === 0) return
    for (var i = 0; i < ids.length; i++) {
      var runId = ids[i]
      var rec = null
      for (var j = 0; j < runs.length; j++) {
        if (runs[j] && runs[j].id === runId) { rec = runs[j]; break }
      }
      if (!rec || (rec.status !== 'completed' && rec.status !== 'errored' && rec.status !== 'stopped')) continue
      var entry = book[runId]
      var rest = /** @type {Record<string, Record<string, any>>} */ ({})
      for (var k in book) { if (k !== runId) rest[k] = book[k] }
      generatingRef.current = rest
      patch({ generating: rest })
      if (!alive.current) return
      if (rec.status !== 'completed') {
        showToast('error', dshT('✨ 工作流生成失败：') + messageOf(rec.error || rec.status))
        continue
      }
      finishGeneration(runId, entry)
    }
  }

  // completed 分支：取 getRun 的 result（先解网关信封），名称清洗 + 对工作库
  // global 作用域同名去重（saveSaved 是同名覆盖写，自动保存绝不覆盖旧条目），
  // 然后自动存库。
  function finishGeneration(/** @type {string} */ runId, /** @type {Record<string, any>} */ entry) {
    if (!alive.current) return
    Promise.all([
      call('workflowAdmin/getRun', { runId: runId }),
      call('workflowAdmin/listSaved', {}),
    ]).then(function (results) {
      if (!alive.current) return
      var runRes = results[0]
      var savedRes = results[1]
      if (!runRes.ok || !runRes.value) { showToast('error', dshT('✨ 生成结果读取失败，未存入工作库')); return }
      var result = runRes.value.result
      var script = result && typeof result === 'object' && typeof result.script === 'string' ? result.script : ''
      if (!script) { showToast('error', dshT('生成结果里没有脚本，未存入工作库')); return }
      var rawName = result && result.name ? String(result.name) : String((entry && entry.name) || '')
      var name = rawName.replace(/[^A-Za-z0-9._-]/g, '') || 'wf-' + Date.now().toString(36)
      var taken = /** @type {Record<string, boolean>} */ ({})
      var saved = (savedRes.ok && savedRes.value) || []
      for (var i = 0; i < saved.length; i++) {
        if (saved[i] && saved[i].scope === 'global') taken[saved[i].name] = true
      }
      var candidate = name
      var bump = 2
      while (taken[candidate]) { candidate = name + '-' + bump; bump += 1 }
      call('workflowAdmin/saveSaved', { spec: { name: candidate, scope: 'global', script: script, description: (entry && entry.description) || '' } }).then(function (res) {
        if (!alive.current) return
        var r = res && res.ok ? res.value : null
        if (r && r.ok) {
          showToast('success', dshT('已保存到工作库：') + candidate)
          reload()
        } else {
          showToast('error', dshT('✨ 自动存库失败：') + ((r && r.error) || (res && res.error ? messageOf(res.error) : '') || dshT('未知错误')))
        }
      }, function (e) {
        if (!alive.current) return
        showToast('error', dshT('✨ 自动存库失败：') + messageOf(e))
      })
    }, function () {
      if (!alive.current) return
      showToast('error', dshT('✨ 生成结果读取失败，未存入工作库'))
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
    patch({ editor: { runId: runId, script: script, label: rec && rec.label ? rec.label : '', argsText: '' }, editorError: '', generator: null, tab: 'runs' })
  }

  function submitAmend() {
    var ed = state.editor
    if (!ed || !ed.script) { patch({ editorError: dshT('脚本不能为空') }); return }
    patch({ editorBusy: true, editorError: '' })
    call('workflowAdmin/amendRun', { runId: ed.runId, script: ed.script, spec: {} }).then(function (res) {
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.id) {
        patch({ editorBusy: false, editor: null, openRunId: r.id, runDetail: null, answerText: '' })
        detailSeq.current++
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
      if (r && r.id) { patch({ openRunId: r.id, runDetail: null, answerText: '' }); detailSeq.current++; showToast('success', dshT('▶️ 已从断点续跑')); reload() }
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
      if (r && r.id) { patch({ tab: 'runs', openRunId: r.id, runDetail: null, answerText: '' }); detailSeq.current++; showToast('success', dshT('🚀 已启动：') + name); reload() }
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

  // 工作库行的「编辑」：预填 name/scope/script/description；scope 锁定为原值
  // （saveSaved 同名覆盖写已核实安全，改作用域等于把条目挪库，不做）。
  function editSaved(/** @type {Record<string, any>} */ rec) {
    patch({ savedEditor: { name: rec.name, scope: rec.scope, script: rec.script || '', description: rec.description || '', argsText: '', locked: true }, savedError: '' })
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

  var elements = []

  // 运行/工作库两个内部页签与外层 section 页签同一套 ARIA tabs 契约
  // （tablist/tab/roving tabindex/方向键），样式走共享配方 .tabs/.tab
  // （发丝底线 + 活动页签 2px 底部强调线）。面板内容不是单个可寻址节点，
  // 所以这里不做 aria-controls/tabpanel 关联。
  var wfTabs = [{ id: 'runs' }, { id: 'saved' }]
  elements.push(h('div', { key: 'tabs', className: 'tabs', role: 'tablist', 'aria-label': dshT('工作流'),
    onKeyDown: function (/** @type {KeyboardEvent} */ event) {
      tabKeyDown(event, wfTabs, state.tab, function (next) { patch({ tab: next, editor: null, savedEditor: null, generator: null }) })
    } }, [
    tabButton('runs', dshT('运行 (') + (state.runs || []).length + ')'),
    tabButton('saved', dshT('工作库 (') + (state.saved || []).length + ')'),
  ]))

  if (state.error) {
    elements.push(h('div', { key: 'err', className: 'error' }, state.error))
  }

  if (state.tab === 'runs') {
    elements.push(runsView())
  } else {
    elements.push(savedView())
  }

  return h('div', { 'data-dsh-admin-section': '' }, elements)

  function tabButton(/** @type {string} */ key, /** @type {string} */ label) {
    var active = state.tab === key
    return h('button', {
      key: 'tab-' + key,
      role: 'tab',
      id: 'dsh-admin-wf-tab-' + key,
      className: active ? 'tab active' : 'tab',
      'aria-selected': active,
      tabIndex: active ? 0 : -1,
      onClick: function () { patch({ tab: key, editor: null, savedEditor: null, generator: null }) },
    }, label)
  }

  // 运行页签：整页四态——生成表单 / 编辑器 / 详情页 / 列表，逐一替换而非堆叠
  // （v1.36 钩子页约定：整页表单替换列表）。
  function runsView() {
    if (state.generator) return renderGenerator()
    if (state.editor) return renderEditor()
    if (state.openRunId && state.runDetail) return renderRunDetail()
    return renderRunsList()
  }

  function savedView() {
    if (state.savedEditor) return renderSavedEditor()
    return renderSavedList()
  }

  function renderRunsList() {
    var children = []
    // 扁平命令条：左命令 + 右侧一行静默提示（原蓝色引导大卡收成的这一行）。
    children.push(h('div', { key: 'toolbar', className: 'toolbar', style: { marginBottom: '8px' } }, [
      h('button', { key: 'gen', className: 'btn primary', onClick: openGenerator }, dshT('✨ 一键生成')),
      h('button', {
        key: 'new-run', className: 'btn',
        onClick: function () { patch({ editor: { runId: null, script: exampleScript(), label: '', argsText: '{}' }, editorError: '', generator: null, openRunId: null, runDetail: null, answerText: '' }) },
      }, dshT('＋ 新建工作流')),
      h('span', { key: 'hint', style: { marginLeft: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        dshT('工作流 = 把多步任务写成小脚本，交给 dsh 自动派子智能体逐步完成')),
    ]))
    // 模板快捷条：普通用户的一键入口 —— 点模板 = 脚本/名称/参数全部填好。
    children.push(h('div', { key: 'tpl-row', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' } }, [h('span', { key: 'tpl-head', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', flex: 'none' } },
      dshT('从模板开始（点卡片自动填好，改参数就能跑）'))].concat(wfTemplates().map(function (tpl, tplIndex) {
      return h('div', {
        key: 'tpl-' + tplIndex,
        role: 'button',
        tabIndex: 0,
        className: 'btn',
        onClick: function () { openTemplate(tpl) },
        onKeyDown: function (/** @type {KeyboardEvent} */ event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTemplate(tpl) } },
      }, tpl.title)
    }))))
    var runs = state.runs || []
    if (runs.length === 0) {
      children.push(h('div', { key: 'empty', className: 'empty', style: { marginTop: '8px' } },
        dshT('暂无运行。三步上手：点上方模板卡片 → 按需改参数 → 点「🚀 启动」。也可以从「工作库」启动已保存的脚本。')))
    }
    var rows = []
    for (var i = 0; i < runs.length; i++) {
      rows.push(runRow(runs[i]))
    }
    children.push(h('div', { key: 'list', className: 'list' }, rows))
    return h('div', { key: 'runs-tab' }, children)
  }

  function openTemplate(/** @type {Record<string, any>} */ tpl) {
    patch({ editor: { runId: null, script: tpl.script, label: tpl.title, argsText: tpl.argsText }, editorError: '', generator: null, openRunId: null, runDetail: null, answerText: '' })
  }

  // 状态 → 软色 .tag 变体：completed=绿 / running|pending=蓝 / errored=红 /
  // stopped|orphaned=琥珀（配方见 styles.js）。
  function statusTagClass(/** @type {string} */ s) {
    return s === 'completed' ? 'tag ok'
      : s === 'errored' ? 'tag err'
      : (s === 'running' || s === 'pending') ? 'tag run'
      : (s === 'stopped' || s === 'orphaned') ? 'tag warn'
      : 'tag'
  }

  // 运行行：名称 + 行 id 居左，右侧步数/时长 + 状态 tag + 动作按钮组。整行
  // 可点开详情（键盘同款），行内按钮 stopPropagation 避免误触整行。
  // className 里的 .card 是既有门禁的选择器锚（verify-workflow-client 以
  // .card 寻找运行行），.row 的规则在后覆盖其纵向布局。
  function runRow(/** @type {Record<string, any>} */ run) {
    var metaBits = []
    if (run.stepCount) metaBits.push(String(run.stepCount) + dshT(' 步'))
    if (run.durationMs) metaBits.push(Math.round(run.durationMs / 100) / 10 + 's')
    return h('div', {
      key: 'run-' + run.id,
      className: 'card row',
      role: 'button',
      tabIndex: 0,
      onClick: function () { openRun(run.id) },
      onKeyDown: function (/** @type {KeyboardEvent} */ event) {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRun(run.id) }
      },
    }, [
      h('div', { key: 'main', className: 'main', style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } }, [
        h('span', { key: 'label', className: 'name', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, run.label || run.id),
        h('span', { key: 'id', className: 'meta mono', style: { flex: 'none' } }, run.id),
      ]),
      metaBits.length
        ? h('span', { key: 'meta', className: 'meta mono', style: { flex: 'none', fontVariantNumeric: 'tabular-nums' } }, metaBits.join(' · '))
        : null,
      h('span', { key: 'status', className: statusTagClass(run.status), style: { flex: 'none' } }, statusText(run.status)),
      h('span', { key: 'actions', className: 'card-actions' }, [
        h('button', { key: 'open', className: 'btn', onClick: function (/** @type {{ stopPropagation: () => void }} */ e) { e.stopPropagation(); openRun(run.id) } }, dshT('详情')),
        run.status === 'running' || run.status === 'pending'
          ? h('button', { key: 'stop', className: 'btn danger', onClick: function (/** @type {{ stopPropagation: () => void }} */ e) { e.stopPropagation(); stopRun(run.id) } }, dshT('⏹ 停止'))
          : null,
        run.status === 'stopped' || run.status === 'errored'
          ? h('button', { key: 'resume', className: 'btn', onClick: function (/** @type {{ stopPropagation: () => void }} */ e) { e.stopPropagation(); resumeRun(run.id) } }, dshT('▶ 续跑'))
          : null,
        run.status === 'completed' || run.status === 'stopped' || run.status === 'errored'
          ? h('button', { key: 'amend', className: 'btn', onClick: function (/** @type {{ stopPropagation: () => void }} */ e) { e.stopPropagation(); amendRun(run.id) } }, dshT('✏️ 改建'))
          : null,
      ]),
    ])
  }

  // 详情整页（替换列表）：返回 + label + 状态、mono 元数据行、挂起问题块、
  // 脚本/返回值/日志。运行中的详情由轮询刷新（见 schedulePoll 的 seq 裁决）。
  function renderRunDetail() {
    var d = state.runDetail
    if (d.error) return h('div', { key: 'detail', className: 'error' }, d.error)
    var children = [
      h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
        h('button', { key: 'back', className: 'btn', onClick: closeDetail }, dshT('← 返回')),
        h('span', { key: 'label', style: { fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.label || d.id),
        h('span', { key: 'status', className: statusTagClass(d.status), style: { flex: 'none' } }, statusText(d.status)),
      ]),
      h('div', { key: 'meta', className: 'mono', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #61666b)', fontVariantNumeric: 'tabular-nums' } },
        [d.id, d.stepCount ? d.stepCount + dshT(' 步') : '', d.durationMs ? Math.round(d.durationMs / 100) / 10 + 's' : ''].filter(Boolean).join(' · ')),
    ]
    // 挂起的问题：脚本卡在 ask()，等一个回答才继续。给一行输入框直接回。
    if (d.pendingQuestion) {
      children.push(h('div', {
        key: 'q',
        className: 'card',
        style: { padding: '10px', border: '1px solid #e8c84e', background: 'rgba(232,200,78,.08)' },
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
            key: 'q-btn', className: 'btn primary', onClick: submitAnswer, disabled: state.answerBusy,
          }, state.answerBusy ? dshT('发送中…') : dshT('回答')),
        ]),
      ]))
    }
    children.push(h('div', { key: 'script-head', style: { fontWeight: '600' } }, dshT('脚本')))
    children.push(h('pre', { key: 'script', style: preStyle() }, d.script || ''))
    // d.error 的渲染在函数入口 early-return 了——这里不再有可达的 error 分支。
    if (d.result !== null && d.result !== undefined) {
      children.push(h('div', { key: 'res-head', style: { fontWeight: '600' } }, dshT('返回值')))
      children.push(h('pre', { key: 'res', style: preStyle() }, safeStringify(d.result)))
    }
    var log = d.log || []
    if (log.length) {
      children.push(h('div', { key: 'log-head', style: { fontWeight: '600' } }, dshT('日志')))
      for (var i = 0; i < log.length; i++) {
        children.push(h('div', { key: 'log-' + i, className: 'mono', style: { fontSize: '12px', padding: '2px 0', color: 'var(--dsw-alias-label-secondary, #555)' } },
          '[' + (log[i].kind || '?') + '] ' + (log[i].message || log[i].title || safeStringify(log[i].value) || '')))
      }
    }
    return h('div', { key: 'detail', className: 'form' }, children)
  }

  // 新建/改建编辑器整页（替换列表）。
  function renderEditor() {
    var ed = state.editor
    var isAmend = !!ed.runId
    var children = [
      h('div', { key: 'head', style: { fontWeight: '700' } },
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
            key: 'parent', className: 'input', value: state.parentSessionId,
            onChange: function (/** @type {{ target: { value: string } }} */ e) { parentSessionRef.current = e.target.value; patch({ parentSessionId: e.target.value }) },
            style: { flex: '1 1 auto', width: 'auto', minWidth: 0 },
          }, state.liveSessions.map(function (/** @type {Record<string, any>} */ s) {
            return h('option', { key: s.id, value: s.id }, (s.title || s.id) + (s.cwd ? ' · ' + s.cwd : ''))
          })),
        ])
        : (!isAmend && state.liveSessions.length === 0)
          ? h('div', { key: 'parent-hint', style: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px' } },
            dshT('没有在线会话——先在 dsh 中打开一个会话，再启动工作流。'))
          : null,
    ]
    // 模板快捷条：静默小按钮，点击把 name/script/args 全部填好。
    if (!isAmend) {
      children.push(h('div', { key: 'tpl-quick', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [h('span', { key: 'tpl-head', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', flex: 'none' } },
        dshT('从模板开始（点卡片自动填好，改参数就能跑）'))].concat(wfTemplates().map(function (tpl, tplIndex) {
        return h('button', {
          key: 'tpl-' + tplIndex, className: 'btn',
          onClick: function () { patch({ editor: { runId: null, script: tpl.script, label: tpl.title, argsText: tpl.argsText }, editorError: '' }) },
        }, tpl.title)
      }))))
    }
    children.push(h('textarea', {
      key: 'script', className: 'input mono', placeholder: dshT('TypeScript / JavaScript，顶层 return 返回结果'), value: ed.script,
      onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.script = e.target.value; patch({ editor: ed }) },
      style: { minHeight: '160px' },
    }))
    children.push(h('textarea', {
      key: 'args', className: 'input mono', placeholder: dshT('args（JSON 对象）'), value: ed.argsText,
      onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.argsText = e.target.value; patch({ editor: ed }) },
      style: { minHeight: '60px' },
    }))
    if (state.editorError) {
      children.push(h('pre', { key: 'ederr', style: preStyle({ color: '#c00', borderColor: '#e8b4b4' }) }, state.editorError))
    }
    children.push(h('div', { key: 'args-hint', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
      dshT('参数：脚本里 args.xxx 的值，在上面这个 JSON 里填（模板已带默认值，可直接改）。')))
    children.push(h('div', { key: 'edbtns', className: 'form-actions' }, [
      h('button', {
        key: 'submit', className: 'btn primary', onClick: isAmend ? submitAmend : startFromEditor, disabled: state.editorBusy,
      }, state.editorBusy ? dshT('提交中…') : (isAmend ? dshT('确认改建') : dshT('🚀 启动'))),
      h('button', { key: 'cancel', className: 'btn', onClick: function () { patch({ editor: null, editorError: '' }) } }, dshT('取消')),
    ]))
    return h('div', { key: 'editor', className: 'form' }, children)
  }

  // 一键生成整页表单：一句话需求 → dsh 子代理写脚本 → 自动存入工作库。
  function renderGenerator() {
    var gen = state.generator
    var children = [
      h('div', { key: 'head', style: { fontWeight: '700' } }, dshT('一键生成工作流')),
      h('textarea', {
        key: 'desc', className: 'input mono', 'aria-label': dshT('需求描述'),
        placeholder: dshT('描述任务…（例：审查 src 下所有 TS 文件的类型问题，汇总成清单）'), value: gen.description,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { gen.description = e.target.value; patch({ generator: gen }) },
        style: { minHeight: '120px' },
      }),
      h(UiInput, {
        key: 'name', className: 'wf-input', placeholder: dshT('名称（可选）'), value: gen.name,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { gen.name = e.target.value; patch({ generator: gen }) },
      }),
      h('div', { key: 'hint', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
        dshT('生成需一次子代理调用；完成后脚本自动存入工作库')),
    ]
    if (gen.error) {
      children.push(h('pre', { key: 'generr', style: preStyle({ color: '#c00', borderColor: '#e8b4b4' }) }, gen.error))
    }
    children.push(h('div', { key: 'gbtns', className: 'form-actions' }, [
      h('button', { key: 'go', className: 'btn primary', onClick: submitGenerator, disabled: gen.busy },
        gen.busy ? dshT('生成中…') : dshT('✨ 生成')),
      h('button', { key: 'cancel', className: 'btn', onClick: function () { patch({ generator: null }) } }, dshT('取消')),
    ]))
    return h('div', { key: 'generator', className: 'form' }, children)
  }

  function renderSavedList() {
    var children = [
      h('div', { key: 'toolbar', className: 'toolbar', style: { marginBottom: '8px' } }, [
        h('button', {
          key: 'new-saved', className: 'btn',
          onClick: function () { patch({ savedEditor: { name: '', scope: 'global', script: exampleScript(), description: '', argsText: '' }, savedError: '' }) },
        }, dshT('＋ 保存一个工作流')),
        h('span', { key: 'hint', style: { marginLeft: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          dshT('工作库分全局与项目两种作用域；面板保存只写全局，项目级请经模型的 workflow_admin 工具保存')),
      ]),
    ]
    var saved = state.saved || []
    if (saved.length === 0) {
      children.push(h('div', { key: 'empty', className: 'empty', style: { marginTop: '8px' } },
        dshT('工作库为空。保存常用脚本后，可以按名一键启动。')))
    }
    var rows = []
    for (var i = 0; i < saved.length; i++) {
      rows.push(savedRow(saved[i]))
    }
    children.push(h('div', { key: 'list', className: 'list' }, rows))
    return h('div', { key: 'saved-tab' }, children)
  }

  function savedRow(/** @type {Record<string, any>} */ rec) {
    var isConfirm = state.confirmDelete === rec.name + ':' + rec.scope
    // key 必须含 scope：项目/全局两个作用域允许同名，纯 name 的 key 会让
    // React 在两行之间错误复用节点。
    return h('div', { key: 'saved-' + rec.name + ':' + rec.scope, className: 'card row' }, [
      h('span', { key: 'name', className: 'name mono', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, rec.name),
      h('span', { key: 'scope', className: rec.scope === 'project' ? 'tag run' : 'tag', style: { flex: 'none' } },
        rec.scope === 'project' ? dshT('项目') : dshT('全局')),
      rec.description ? h('span', { key: 'desc', className: 'desc' }, rec.description) : null,
      h('span', { key: 'actions', className: 'card-actions' }, [
        h('button', { key: 'run', className: 'btn primary', onClick: function () { runSaved(rec.name) } }, dshT('🚀 运行')),
        h('button', { key: 'edit', className: 'btn', onClick: function () { editSaved(rec) } }, dshT('编辑')),
        isConfirm
          ? h('button', { key: 'del-yes', className: 'btn danger-solid', onClick: function () { deleteSaved(rec.name, rec.scope) } }, dshT('确认删除'))
          : h('button', { key: 'del', className: 'btn danger', onClick: function () { patch({ confirmDelete: rec.name + ':' + rec.scope }) } }, dshT('🗑 删除')),
        isConfirm
          ? h('button', { key: 'del-no', className: 'btn', onClick: function () { patch({ confirmDelete: null }) } }, dshT('取消'))
          : null,
      ]),
    ])
  }

  function renderSavedEditor() {
    var ed = state.savedEditor
    var children = [
      h('div', { key: 'head', style: { fontWeight: '700' } }, dshT('保存到工作库')),
      h(UiInput, {
        key: 'name', className: 'wf-input', placeholder: dshT('名称（字母数字 . _ -）'), value: ed.name,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.name = e.target.value; patch({ savedEditor: ed }) },
      }),
      h('select', {
        key: 'scope', className: 'input', value: ed.scope, disabled: !!ed.locked,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.scope = e.target.value; patch({ savedEditor: ed }) },
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
        key: 'script', className: 'input mono', placeholder: dshT('脚本'), value: ed.script,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ed.script = e.target.value; patch({ savedEditor: ed }) },
        style: { minHeight: '160px' },
      }),
    ]
    if (state.savedError) {
      children.push(h('pre', { key: 'sverr', style: preStyle({ color: '#c00', borderColor: '#e8b4b4' }) }, state.savedError))
    }
    children.push(h('div', { key: 'svbtns', className: 'form-actions' }, [
      h('button', {
        key: 'save', className: 'btn primary', onClick: saveSavedFromEditor, disabled: state.savedBusy,
      }, state.savedBusy ? dshT('保存中…') : dshT('💾 保存')),
      h('button', { key: 'cancel', className: 'btn', onClick: function () { patch({ savedEditor: null, savedError: '' }) } }, dshT('取消')),
    ]))
    return h('div', { key: 'saved-editor', className: 'form' }, children)
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
