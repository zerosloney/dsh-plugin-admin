/** workflow — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiInput, createElement, dshT, messageOf, sectionState, showToast, useEffect, useRef } from './context.js'
import { preStyle } from './shared.js'

// getRun 轮询的放弃阈值：连续失败（应答 !ok / rejection / run 记录不存在）
// 达到该值即停止跟踪并报错退出，避免生成卡片永久 busy。
var POLL_MAX_FAILURES = 8

/* ==========================================================================
 *                        动态工作流 (dynamic workflows)                      *
 * ========================================================================== */

/**
 * The 「工作流」 settings section: a workflow library console in a single
 * view — a one-click generator card, the template row, and the saved library
 * (edit / delete per row; the saved-entry editor replaces the view wholesale,
 * the v1.36 command-hook page convention). There is deliberately no run
 * console here any more: launching workflows lives on the session side (the
 * /workflow command and the model's workflow_admin tool). The host half is
 * `workflowAdmin` (lib/workflow-admin.js → lib/workflow-runs.js +
 * lib/workflow-library.js). All RPC goes through the same `call` closure as
 * every other section.
 *
 * 一键生成 (generator): the user writes one sentence, the panel launches a
 * fixed generator script through workflowAdmin/startRun, then polls
 * workflowAdmin/getRun for THAT run until it settles (completed → take the
 * returned `{ name, script }`, sanitize/dedup the name, auto-save into the
 * library; errored/stopped → failure toast). 见 pollGeneration /
 * finishGeneration。生成中状态就展示在生成卡片上。
 *
 * Degrades to a one-line hint when the host half does not answer the
 * workflowAdmin/listRuns availability probe — same posture as
 * WorkspacesSection.
 * @param {{ call: (method: string, args: Record<string, any>) => Promise<any> }} props - the renderer-bound props; `call` is the host RPC seam whose resolved payload is service-defined JSON (a duck-typed boundary, not modelled data).
 */
export function WorkflowSection(props) {
  var call = props.call
  var h = createElement
  var kit = sectionState({
    available: true,
    error: '',
    saved: [],
    busy: false,
    savedEditor: null,
    savedBusy: false,
    savedError: '',
    confirmDelete: null,
    generator: { description: '', name: '', busy: false, error: '' },
    generating: {},
  })
  var state = kit.state
  var patch = kit.patch
  var set = kit.set
  var alive = kit.alive
  // 父会话选择 / 轮询计时器 / 生成账本都走 ref 镜像：异步回调拿到的 state
  // 是首帧旧值，写回一律走 patch / set。
  var parentSessionRef = useRef('')
  var pollTimerRef = useRef(null)
  var pollFailures = 0
  var generatingRef = useRef(/** @type {Record<string, Record<string, any>>} */ ({}))

  // 父会话：生成器的 startRun 需要一个在线会话作落点。取第一个在线会话自动
  // 选中（不出控件——运行编辑器的父会话选择器已随运行 UI 删除）；软失败
  // ——拿不到时面板照常可用，提交由宿主报错提示。
  function loadParentSessions() {
    call('sessionAdmin/list', {}).then(function (res) {
      if (!alive.current || !res || !res.ok) return
      var live = ((res.value && res.value.sessions) || []).filter(function (/** @type {Record<string, any>} */ s) { return s && s.live && s.id })
      var keep = parentSessionRef.current
      parentSessionRef.current = live.some(function (/** @type {Record<string, any>} */ s) { return s.id === keep })
        ? keep
        : (live[0] ? live[0].id : '')
    }, function () { /* 会话列表不可用不阻塞工作流面板 */ })
  }

  // mount 只装工作库 + 引擎可用性探测（listRuns 失败 = workflowAdmin 面不可
  // 达，与旧面板同一降级信号）。平时无轮询；唯一的轮询是生成进行中对 getRun
  // 的单 run 轮询（见 pollGeneration）。
  function reload() {
    patch({ busy: true, error: '' })
    loadParentSessions()
    Promise.all([
      call('workflowAdmin/listRuns', {}),
      call('workflowAdmin/listSaved', {}),
    ]).then(function (results) {
      if (!alive.current) return
      var probeRes = results[0]
      var savedRes = results[1]
      if (!probeRes.ok) {
        patch({ busy: false, available: false, error: messageOf(probeRes.error) })
        return
      }
      patch({ busy: false, available: true, saved: (savedRes.ok && savedRes.value) || [] })
    }, function (e) {
      if (!alive.current) return
      patch({ busy: false, available: false, error: messageOf(e) })
    })
  }

  kit.mount(reload)

  // 卸载停掉生成轮询。
  useEffect(function () {
    return function () { if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null } }
  }, [])

  /* ── 一键生成 ────────────────────────────────────────────────────────────
   * 表单一句话 → startRun(GENERATOR_SCRIPT, args={ description, name })，
   * 之后只轮询该 run 的 workflowAdmin/getRun 直到落终态：completed → 取返回
   * 值里的脚本 → 清洗/去重名称 → saveSaved 自动存入工作库（用户已确认自动
   * 保存语义）；errored/stopped → 失败 toast。
   * 幂等性：账本（generatingRef / state.generating）只活在本次挂载——面板重开
   * 后丢失，生成结果不再补存（运行侧详情仍看得到返回值中的脚本）。
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

  function submitGenerator() {
    var gen = state.generator
    if (gen.busy) return
    var desc = (gen.description || '').trim()
    if (!desc) { gen.error = dshT('请先描述任务'); patch({ generator: gen }); return }
    gen.busy = true
    gen.error = ''
    patch({ generator: gen })
    /** @type {Record<string, any>} */
    var spec = { script: GENERATOR_SCRIPT, label: '✨ ' + (desc.length > 40 ? desc.slice(0, 40) : desc), args: { description: desc, name: gen.name || '' } }
    if (parentSessionRef.current) spec.parentSessionId = parentSessionRef.current
    call('workflowAdmin/startRun', { spec: spec }).then(function (res) {
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.id) {
        var book = /** @type {Record<string, Record<string, any>>} */ ({})
        for (var k in generatingRef.current) book[k] = generatingRef.current[k]
        book[r.id] = { name: gen.name || '', description: desc }
        generatingRef.current = book
        patch({ generating: book })
        showToast('success', dshT('已开始生成，完成后自动存入工作库'))
        pollGeneration(r.id)
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

  // 单 run 轮询（2s 起步，失败按既有退避公式放宽到 30s 上限）：账上这个 id
  // 的 run 落入终态（completed/errored/stopped）即出账处理——先移除再处理，
  // getRun / saveSaved 是异步的，留在账上会被下一轮轮询重入。全程 alive 守卫。
  function pollGeneration(/** @type {string} */ runId) {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    var delay = Math.min(2000 * Math.pow(2, pollFailures), 30000)
    pollTimerRef.current = setTimeout(function () {
      if (!alive.current) return
      call('workflowAdmin/getRun', { runId: runId }).then(function (res) {
        if (!alive.current) return
        if (!res.ok) { afterPollFailure(runId); return }
        var rec = res.value
        if (!rec) { afterPollFailure(runId); return }
        if (rec.status !== 'completed' && rec.status !== 'errored' && rec.status !== 'stopped') {
          pollFailures = 0
          pollGeneration(runId)
          return
        }
        var book = generatingRef.current
        var entry = book[runId]
        var rest = /** @type {Record<string, Record<string, any>>} */ ({})
        for (var k in book) { if (k !== runId) rest[k] = book[k] }
        generatingRef.current = rest
        pollFailures = 0
        // busy 复位走 set 函数式更新：异步回调闭包里的 state 是旧帧值，
        // 直接 patch 会覆盖用户在生成期间对草稿的编辑。
        set(function (/** @type {any} */ cur) {
          /** @type {Record<string, any>} */
          var next = {}
          for (var sk in cur) next[sk] = cur[sk]
          next.generating = rest
          next.generator = cur.generator ? { description: cur.generator.description, name: cur.generator.name, busy: false, error: cur.generator.error } : cur.generator
          return next
        })
        if (!alive.current) return
        if (rec.status !== 'completed') {
          showToast('error', dshT('✨ 工作流生成失败：') + messageOf(rec.error || rec.status))
          return
        }
        finishGeneration(runId, entry)
      }, function () {
        if (!alive.current) return
        afterPollFailure(runId)
      })
    }, delay)
  }

  // getRun 的三类失败（应答 !ok / Promise rejection / 记录不存在）统一计数
  // 退避；连续 POLL_MAX_FAILURES 次即放弃跟踪：出账、复位 busy、报错，不再
  // 续轮——否则生成卡片会永久 busy 且没有错误出口。
  function afterPollFailure(/** @type {string} */ runId) {
    pollFailures += 1
    if (pollFailures < POLL_MAX_FAILURES) { pollGeneration(runId); return }
    var book = generatingRef.current
    var rest = /** @type {Record<string, Record<string, any>>} */ ({})
    for (var k in book) { if (k !== runId) rest[k] = book[k] }
    generatingRef.current = rest
    pollFailures = 0
    // busy 复位走 set 函数式更新：异步回调闭包里的 state 是旧帧值，
    // 直接 patch 会覆盖用户在生成期间对草稿的编辑。
    set(function (/** @type {any} */ cur) {
      /** @type {Record<string, any>} */
      var next = {}
      for (var sk in cur) next[sk] = cur[sk]
      next.generating = rest
      next.generator = cur.generator ? { description: cur.generator.description, name: cur.generator.name, busy: false, error: cur.generator.error } : cur.generator
      return next
    })
    if (!alive.current) return
    showToast('error', dshT('✨ 生成状态查询失败，已停止跟踪：') + runId)
  }

  // completed 分支：取 getRun 的 result（先解网关信封），名称清洗 + 对工作库
  // global 作用域同名去重（saveSaved 是同名覆盖写，自动保存绝不覆盖旧条目；
  // listSaved 失败时 fail-closed——时间戳后缀兜底），然后自动存库。
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
      // listSaved 失败时 fail-closed：跳过去重、直接用时间戳后缀落库。空
      // taken 会让同名 saveSaved 覆盖旧条目（saveSaved 是同名覆盖写）——
      // 名字带后缀可以接受，盲写覆盖不行。
      var saved = savedRes.ok ? (savedRes.value || []) : null
      if (saved) {
        for (var i = 0; i < saved.length; i++) {
          if (saved[i] && saved[i].scope === 'global') taken[saved[i].name] = true
        }
      }
      var candidate = saved ? name : name + '-' + Date.now().toString(36)
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

  // 工作库行上的即发即弃动作（save_saved / delete_saved）共用一把在途闸：
  // 双击不再双发 RPC，迟到的应答也不会与重试叠在一起。成功与失败分支都先
  // 放闸，再走 alive 守卫。
  var savedActionBusy = useRef(false)

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
    patch({ savedEditor: { name: rec.name, scope: rec.scope, script: rec.script || '', description: rec.description || '', locked: true }, savedError: '' })
  }

  function deleteSaved(/** @type {string} */ name, /** @type {string} */ scope) {
    if (savedActionBusy.current) return
    savedActionBusy.current = true
    call('workflowAdmin/deleteSaved', { spec: { name: name, scope: scope } }).then(function (res) {
      savedActionBusy.current = false
      if (!alive.current) return
      // 同 saveSaved：先解网关信封再读业务层 ok（删除失败/不存在时业务层 ok:false）。
      var r = res && res.ok ? res.value : null
      if (r && r.ok) { patch({ confirmDelete: null }); showToast('success', dshT('🗑 已删除：') + name); reload() }
      else showToast('error', dshT('❌ 删除失败：') + ((r && r.error) || (res && res.error ? messageOf(res.error) : '') || dshT('未知错误')))
    }, function (e) {
      savedActionBusy.current = false
      showToast('error', dshT('❌ 删除失败：') + messageOf(e))
    })
  }

  if (!state.available) {
    return h('div', { 'data-dsh-admin-section': '' },
      h('div', { className: 'card', style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
        dshT('工作流引擎不可用：未挂载 @deepseek-ai/dsh-subagent，或服务启动失败。')
        + (state.error ? dshT('（宿主返回：') + state.error + dshT('）') : '')))
  }

  // 单视图：引导行 + 生成卡片 + 模板行 + 工作库列表；工作库编辑器整页替换
  // （v1.36 钩子页约定：整页表单替换列表）。
  var elements = []

  if (state.error) {
    elements.push(h('div', { key: 'err', className: 'error' }, state.error))
  }

  if (state.savedEditor) {
    elements.push(renderSavedEditor())
  } else {
    elements.push(h('div', { key: 'guide', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', marginBottom: '8px' } },
      dshT('工作流 = 把多步任务写成小脚本，交给 dsh 自动派子智能体逐步完成')))
    elements.push(renderGenerator())
    elements.push(renderTemplateRow())
    elements.push(renderLibrary())
  }

  return h('div', { 'data-dsh-admin-section': '' }, elements)

  // 一键生成卡片：一句话需求 → dsh 子代理写脚本 → 落定后自动存入工作库。
  // 生成中状态就在这张卡片上（按钮「生成中…」禁用 + 状态行），完成/失败用
  // toast 报告。
  function renderGenerator() {
    var gen = state.generator
    var generatingRun = Object.keys(state.generating || {})[0] || ''
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
    if (generatingRun) {
      children.push(h('div', { key: 'gen-status', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)' } },
        dshT('已开始生成，完成后自动存入工作库')))
    }
    if (gen.error) {
      children.push(h('pre', { key: 'generr', style: preStyle({ color: '#c00', borderColor: '#e8b4b4' }) }, gen.error))
    }
    children.push(h('div', { key: 'gbtns', className: 'form-actions' }, [
      h('button', { key: 'go', className: 'btn primary', onClick: submitGenerator, disabled: gen.busy },
        gen.busy ? dshT('生成中…') : dshT('✨ 生成')),
    ]))
    return h('div', { key: 'generator', className: 'form', style: { marginBottom: '8px' } }, children)
  }

  // 模板快捷条：普通用户的一键入口 —— 点模板 = 打开已保存条目编辑器草稿，
  // 名称/描述/脚本全部预填，用户改完保存入库。
  function renderTemplateRow() {
    return h('div', { key: 'tpl-row', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' } }, [h('span', { key: 'tpl-head', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', flex: 'none' } },
      dshT('从模板开始（点卡片预填草稿，保存即入库）'))].concat(wfTemplates().map(function (tpl, tplIndex) {
      return h('div', {
        key: 'tpl-' + tplIndex,
        role: 'button',
        tabIndex: 0,
        className: 'btn',
        onClick: function () { openTemplate(tpl) },
        onKeyDown: function (/** @type {KeyboardEvent} */ event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTemplate(tpl) } },
      }, tpl.title)
    })))
  }

  function openTemplate(/** @type {Record<string, any>} */ tpl) {
    patch({ savedEditor: { name: tpl.name, scope: 'global', script: tpl.script, description: tpl.desc, locked: true }, savedError: '' })
  }

  function renderLibrary() {
    var children = [
      h('div', { key: 'toolbar', className: 'toolbar', style: { marginBottom: '8px' } }, [
        h('span', { key: 'head', style: { fontWeight: '600' } }, dshT('工作库')),
        h('span', { key: 'hint', style: { marginLeft: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          dshT('面板保存仅全局；项目级走 workflow_admin 工具')),
      ]),
    ]
    var saved = state.saved || []
    if (saved.length === 0) {
      children.push(h('div', { key: 'empty', className: 'empty', style: { marginTop: '8px' } },
        dshT('工作库为空。点上方「✨ 生成」一句话生成，或点模板卡片预填草稿保存。')))
    }
    var rows = []
    for (var i = 0; i < saved.length; i++) {
      rows.push(savedRow(saved[i]))
    }
    children.push(h('div', { key: 'list', className: 'list' }, rows))
    return h('div', { key: 'library' }, children)
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

export function wfTemplates() {
  return [
  {
    name: 'topic-summary',
    title: dshT('总结一个主题'),
    desc: dshT('派一个子智能体，按你给的主题输出一段总结'),
    script: [
      '// 一步工作流：一个子智能体完成一次总结',
      '// 参数 args.topic：调用时传入要总结的主题',
      'var summary = await agent(',
      '  "请用不超过 200 字总结这个主题：" + (args.topic || "")',
      ')',
      'return { summary: summary }',
    ].join('\n'),
  },
  {
    name: 'dual-angle-analysis',
    title: dshT('并行双角度分析'),
    desc: dshT('两个子智能体并行，分别从技术与体验角度分析'),
    script: [
      '// 并行工作流：两个子智能体同时跑，全部完成后合并返回',
      'var r = await parallel([',
      '  function () { return agent("从技术架构角度分析：" + (args.topic || "")) },',
      '  function () { return agent("从使用体验角度分析：" + (args.topic || "")) },',
      '])',
      'return { tech: r[0], ux: r[1] }',
    ].join('\n'),
  },
]
}
