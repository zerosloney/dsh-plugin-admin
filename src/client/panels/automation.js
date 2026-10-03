/** automation — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { React, UiButton, UiCheckbox, UiInput, UiPill, createElement, dshT, messageOf, sectionState, useEffect, useState } from './context.js'
import { mergeObject, tabKeyDown } from './shared.js'
import { WorkflowSection } from './workflow.js'

/**
 * Types for this panel's helpers. The render / editor helpers below take
 * the section state and the actions bag as duck-typed pairs (the same seam
 * sessions.js and shared.js declare); the event shapes describe exactly
 * what each handler's own body reads, because the React seam
 * (types/react.d.ts) types createElement's props as `any` (mirrors the
 * module-local typedefs in shared.js / mcp.js, which are not importable).
 * @typedef {{ call: (method: string, args: Record<string, any>) => Promise<any> }} PanelSectionProps - the renderer-bound props; `call` is the host RPC seam whose resolved payload is service-defined JSON.
 * @typedef {{ target: { value: string } }} InputChangeEvent - the change event the Input / select / textarea handlers read.
 * @typedef {{ key: string, preventDefault: () => void }} KeyEventLike - the key event the card-row Enter / Space handlers read.
 * @typedef {{ stopPropagation: () => void }} ClickEventLike - the click event the propagation-stopping row handlers read.
 */

/* ========================================================================== */
/*                          Automation section (自动化)                        */
/* ========================================================================== */

// 定时任务 + Webhook + 工作流 merged into ONE settings nav entry (v1.24.0 —
// the first two used to be standalone sections, and the webhook tab drops the
// 触发 suffix; 工作流 joins as the third tab). The SAME panels underneath —
// every behavior is unchanged. Scoped data-cha-section: it carries the shared
// segmented-tab styles the former 命令与钩子 section used.
/**
 * The automation (自动化) settings entry: one nav surface hosting the
 * scheduled-task (定时任务) / Webhook / workflow (工作流) tabs — the same
 * panels underneath, merged into ONE settings nav entry (v1.24.0: the first
 * two used to be standalone sections, the webhook tab drops the 触发
 * suffix, and 工作流 joins as the third tab).
 * @param {PanelSectionProps} props - the renderer-bound props; `call` is threaded to the selected tab's section.
 */
export function AutomationSection(props) {
  var tabHooks = useState('cron')
  var tab = tabHooks[0]
  var setTab = tabHooks[1]
  var tabs = [
    { id: 'cron', label: dshT('定时任务'), component: CronSection },
    { id: 'webhook', label: dshT('Webhook'), component: WebhookSection },
    { id: 'workflow', label: dshT('工作流'), component: WorkflowSection },
  ]
  var selected = tabs.find(function (entry) { return entry.id === tab }) || tabs[0]
  return createElement('div', { 'data-cha-section': '' },
    createElement('div', { className: 'tabs', role: 'tablist', 'aria-label': dshT('自动化'),
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
      createElement(selected.component, { call: props.call })
    )
  )
}

/* ========================================================================== */
/* Webhook 触发 Section */
/* ========================================================================== */

/* 定时任务 / Webhook 预设模板：普通用户的一键入口 —— 点卡片 = 编辑器全部填好。
   与工作流的 wfTemplates() 同一版式：title/desc 走 dshT（双语），seed 是
   openEditor(null, seed) 的预填字段（id / cron / promptTemplate / 动作…）。
   三组模板都是函数：每次渲染重新求值，语言切换后卡片文案跟随更新。 */

export function cronTemplates() {
  return [
  {
    title: dshT('工作日早报'),
    desc: dshT('工作日早上 9 点：给会话发一条今日简报提醒'),
    seed: {
      id: 'morning-brief',
      cron: '0 9 * * 1-5',
      actionMode: 'steer',
      steer: true,
      promptTemplate: '早安。请给我一份今日简报：未完成的待办、昨天的关键改动、今天要做的事。',
    },
  },
  {
    title: dshT('每周周报'),
    desc: dshT('每周五 17 点：回顾本周会话与改动，输出简明周报'),
    seed: {
      id: 'weekly-report',
      cron: '0 17 * * 5',
      actionMode: 'steer',
      steer: true,
      promptTemplate: '本周快结束了。请回顾本周的会话记录与代码改动，输出一份简明周报：做了什么、改了哪里、下周建议。',
    },
  },
  {
    title: dshT('每小时巡检'),
    desc: dshT('每小时整点：检查项目状态，异常先定位再给建议'),
    seed: {
      id: 'hourly-patrol',
      cron: '0 * * * *',
      actionMode: 'steer',
      steer: true,
      promptTemplate: '例行巡检：检查当前项目的服务与测试状态。有异常先定位原因再给修复建议；一切正常就一句话报平安。',
    },
  },
]
}

export function webhookTemplates() {
  return [
  {
    title: dshT('CI 失败自动处理'),
    desc: dshT('CI/CD 失败事件推给会话，自动定位并尝试修复'),
    seed: {
      id: 'ci-fail-fix',
      event: '',
      actionMode: 'steer',
      steer: true,
      promptTemplate: 'CI 失败了。事件详情：$PAYLOAD。请定位失败原因并尝试修复，完成后汇报结果。',
    },
  },
  {
    title: dshT('GitHub Issue 分诊'),
    desc: dshT('新 Issue 到达时归纳要点、定优先级并起草回复'),
    seed: {
      id: 'github-issue',
      event: 'issues',
      actionMode: 'steer',
      steer: true,
      promptTemplate: '收到新的 GitHub Issue：$PAYLOAD。请归纳问题要点、判断优先级并起草一条回复。',
    },
  },
  {
    title: dshT('报警新建会话处理'),
    desc: dshT('线上报警新建专门会话，定位问题并给处置方案'),
    seed: {
      id: 'alert-handler',
      event: '',
      actionMode: 'create',
      promptTemplate: '生产报警：$PAYLOAD。请定位问题、评估影响面并给出处置方案。',
    },
  },
]
}

/**
 * One fresh 16-char alphanumeric webhook secret (crypto.randomBytes-backed
 * when the runtime offers it). The host requires >= 16 chars; every new-rule
 * open draws its own value, so rules never share a secret by default.
 */
export function generateWebhookSecret() {
  var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  var buf = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto !== null && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf)
  } else {
    for (var i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  var out = ''
  for (var j = 0; j < 16; j++) out += chars[buf[j] % chars.length]
  return out
}

/**
 * Webhook trigger (Webhook 触发) settings section: rule list / editor /
 * delivery history, plus the one-click runtime-install banner shown when
 * the webhook runtime package is not mounted.
 * @param {PanelSectionProps} props - the renderer-bound props; `call` is the host RPC seam for the webhookAdmin methods below.
 */
export function WebhookSection(props) {
  var kit = sectionState({
    busy: false,
    error: '',
    rules: [],
    history: [],
    presets: [],
    permissionPresetNames: [],
    storagePath: '',
    endpointPrefix: '/webhook-triggers',
    endpointOnline: false,
    runtimeMounted: false,
    runtimePackageInstalled: false,
    editorOpen: false,
    draft: null,
    showSecret: false,
    confirmId: null,
  })
  var state = kit.state
  var setState = kit.set
  var alive = kit.alive

  function patch(/** @type {Record<string, any>} */ partial) {
    kit.patch(partial)
  }

  // Same gateway seam the other sections use; a local alias keeps the
  // call sites (and the render-helper parameter lists) untouched.
  var callRemote = props.call

  function reload() {
    patch({ busy: true, error: '' })
    callRemote('webhookAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var v = result.value || {}
        patch({ busy: false, rules: v.rules || [], history: v.history || [], presets: v.presets || [], permissionPresetNames: v.permissionPresetNames || [], storagePath: v.storagePath || '', runtimeMounted: v.runtimeMounted === true, runtimePackageInstalled: v.runtimePackageInstalled === true, endpointOnline: v.endpointOnline === true })
      } else {
        patch({ busy: false, error: dshT('加载失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('调用失败：') + messageOf(err) })
    })
  }

  kit.mount(reload)

  /* ---- Editor ---- */

  /**
   * Open the rule editor: `rule` edits an existing rule; `seed` prefills
   * a fresh draft from a template card (id / event / 动作…).
   * @param {Record<string, any> | null} rule - the rule to edit, or null for a new rule.
   * @param {Record<string, any>} [seed] - optional template seed for the prefill.
   */
  function openEditor(rule, seed) {
    patch({
      editorOpen: true,
      error: '',
      showSecret: false,
      draft: rule ? {
        id: rule.id,
        isNew: false,
        enabled: rule.enabled,
        secret: '',
        event: rule.event || '',
        actionMode: rule.action ? rule.action.mode : 'steer',
        sessionId: rule.action && rule.action.sessionId || '',
        steer: rule.action && rule.action.steer === true,
        workspacePath: rule.action && rule.action.workspacePath || '',
        agentPreset: rule.action && rule.action.agentPreset || 'cordis',
        permissionPreset: rule.action && rule.action.permissionPreset || 'workspace-write',
        promptTemplate: rule.promptTemplate || '',
      } : {
        id: seed && seed.id || '',
        isNew: true,
        enabled: true,
        secret: generateWebhookSecret(),
        event: seed && seed.event || '',
        actionMode: seed && seed.actionMode || 'steer',
        sessionId: seed && seed.sessionId || '',
        steer: seed ? seed.steer !== false : true,
        workspacePath: seed && seed.workspacePath || '',
        agentPreset: seed && seed.agentPreset || 'cordis',
        permissionPreset: seed && seed.permissionPreset || 'workspace-write',
        promptTemplate: seed && seed.promptTemplate || '',
      }
    })
  }

  function patchDraft(/** @type {Record<string, any>} */ partial) {
    setState(function (/** @type {Record<string, any>} */ cur) {
      var next = /** @type {Record<string, any>} */ ({})
      for (var k in cur) next[k] = cur[k]
      next.draft = next.draft ? mergeObject(next.draft, partial) : null
      return next
    })
  }

  function closeEditor() {
    patch({ editorOpen: false, draft: null, error: '' })
  }

  /** Reveal/hide the secret input (masked by default, reset per openEditor). */
  function toggleSecret() {
    setState(function (/** @type {Record<string, any>} */ cur) {
      var next = /** @type {Record<string, any>} */ ({})
      for (var k in cur) next[k] = cur[k]
      next.showSecret = !cur.showSecret
      return next
    })
  }

  function saveDraft() {
    var d = state.draft
    if (!d) return
    patch({ busy: true, error: '' })
    var entry = /** @type {Record<string, any>} */ ({
      id: d.id,
      enabled: d.enabled,
      secret: d.secret,
      event: d.event,
      action: {
        mode: d.actionMode,
      },
      promptTemplate: d.promptTemplate,
    })
    if (d.actionMode === 'steer') {
      entry.action.sessionId = d.sessionId
      entry.action.steer = d.steer
    } else {
      entry.action.workspacePath = d.workspacePath
      entry.action.agentPreset = d.agentPreset
      entry.action.permissionPreset = d.permissionPreset
    }
    callRemote('webhookAdmin/saveRule', { entry: entry }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        closeEditor()
        var v = result.value || {}
        // busy must drop together with the editor closing — the save round
        // trip is over; leaving it set sticks the 「加载中…」 banner and the
        // disabled buttons until some other action happens to reset it.
        patch({ busy: false, rules: v.rules || [], history: v.history || [] })
      } else {
        patch({ busy: false, error: dshT('保存失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('保存失败：') + messageOf(err) })
    })
  }

  /**
   * Delete one webhook rule; the delivery history refreshes with the list.
   * @param {string} id - the rule id.
   */
  function deleteRule(id) {
    patch({ busy: true, error: '', confirmId: null })
    callRemote('webhookAdmin/deleteRule', { id: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var v = result.value || {}
        patch({ rules: v.rules || [], history: v.history || [], busy: false })
      } else {
        patch({ busy: false, error: dshT('删除失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('删除失败：') + messageOf(err) })
    })
  }

  /**
   * Fire one rule at its target session now; refreshes the history on success.
   * @param {string} id - the rule id.
   */
  function testRule(id) {
    patch({ busy: true, error: '' })
    callRemote('webhookAdmin/testRule', { id: id }).then(function (result) {
      if (!alive.current) return
      patch({ busy: false })
      var v = result.ok ? (result.value || {}) : {}
      if (result.ok && v.ok) {
        reload()  // history updated
      } else {
        // A gateway-envelope failure (host threw) carries the reason on
        // result.error; a service-level failure carries it on v.error.
        patch({ error: dshT('触发测试失败：') + (messageOf(v.error || result.error) || dshT('未知错误')) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('触发测试失败：') + messageOf(err) })
    })
  }

  function runtimeInstall() {
    patch({ busy: true, error: '' })
    callRemote('webhookAdmin/runtimeInstall', {}).then(function (result) {
      if (!alive.current) return
      patch({ busy: false })
      var v = result.value || {}
      if (v.ok) {
        patch({ runtimePackageInstalled: true, error: dshT('安装完成，请重启 dsh 后生效。') })
      } else {
        patch({ error: dshT('安装失败：') + messageOf(v.error || result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('安装失败：') + messageOf(err) })
    })
  }

  // WebhookRender is a plain tree-builder (returns a keyed fragment), not a
  // React component — call it directly and hand it the actions object.
  var webhookActions = {
    patch: patch,
    patchDraft: patchDraft,
    reload: reload,
    openEditor: openEditor,
    closeEditor: closeEditor,
    toggleSecret: toggleSecret,
    saveDraft: saveDraft,
    deleteRule: deleteRule,
    testRule: testRule,
    runtimeInstall: runtimeInstall,
  }
  return createElement('div', { 'data-dsh-admin-section': '' },
    WebhookRender(state, webhookActions))
}

/**
 * Scheduled-task (cron) settings section.
 *
 * Host-level cron scheduling: each task fires while the dsh process is alive
 * (unlike dsh-schedule, which is session-local), and reuses the Webhook
 * panel's steer/create action vocabulary. The service lives in
 * `cronAdmin` (lib/cron-admin.js); this panel only renders and edits.
 * @param {PanelSectionProps} props - the renderer-bound props; `call` is the host RPC seam for the cronAdmin methods below.
 */
export function CronSection(props) {
  var kit = sectionState({
    busy: false,
    error: '',
    tasks: [],
    history: [],
    presets: [],
    permissionPresetNames: [],
    storagePath: '',
    editorOpen: false,
    draft: null,
    confirmId: null,
    nowMs: Date.now(),
  })
  var state = kit.state
  var setState = kit.set
  var alive = kit.alive

  function patch(/** @type {Record<string, any>} */ partial) {
    kit.patch(partial)
  }

  var callRemote = props.call

  function reload() {
    patch({ busy: true, error: '' })
    // The preset catalog (agent + permission presets for create mode) comes
    // from the webhook service, which already resolves them from the host —
    // no reason for cron to resolve the same services a second time.
    Promise.all([
      callRemote('cronAdmin/list', {}),
      callRemote('webhookAdmin/list', {}),
    ]).then(function (results) {
      if (!alive.current) return
      var cronRes = results[0]
      var hookRes = results[1]
      if (!cronRes.ok) {
        patch({ busy: false, error: dshT('加载失败：') + messageOf(cronRes.error) })
        return
      }
      var v = cronRes.value || {}
      var h = (hookRes && hookRes.ok && hookRes.value) || {}
      patch({
        busy: false,
        tasks: v.tasks || [],
        history: v.history || [],
        storagePath: v.storagePath || '',
        presets: h.presets || [],
        permissionPresetNames: h.permissionPresetNames || [],
      })
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('调用失败：') + messageOf(err) })
    })
  }

  kit.mount(reload)

  // Tick once a second while the panel shows at least one task, so every
  // row's countdown visibly moves. The list itself is not polled — the
  // service recomputes nextRun on every reload.
  useEffect(function () {
    if (state.tasks.length === 0) return undefined
    var timer = setInterval(function () { setState(function (/** @type {Record<string, any>} */ cur) {
      var next = /** @type {Record<string, any>} */ ({})
      for (var k in cur) next[k] = cur[k]
      next.nowMs = Date.now()
      return next
    }) }, 1000)
    return function () { clearInterval(timer) }
  }, [state.tasks])

  /* ---- Editor ---- */

  /* ---- Schedule editor state: the editor edits 每小时/每天/每周 fields and
     composes the 5-field cron from them (pure helpers live next to
     renderCronEditor); anything else falls back to the raw-expression
     自定义 mode. `cron` stays the single stored value. ---- */

  // Like patchDraft, but the stored cron is always recomposed from the
  // structured schedule fields so the two can never drift apart.
  function patchSchedule(/** @type {Record<string, any>} */ partial) {
    setState(function (/** @type {Record<string, any>} */ cur) {
      if (!cur.draft) return cur
      var draft = mergeObject(cur.draft, partial)
      draft.cron = composeCron(draft.schedMode, draft.schedTime, draft.schedDow)
      var next = /** @type {Record<string, any>} */ ({})
      for (var k in cur) next[k] = cur[k]
      next.draft = draft
      return next
    })
  }

  /**
   * Open the task editor: `task` edits an existing task; `seed` prefills
   * a fresh draft from a template card. The structured schedule fields
   * (schedMode/schedTime/schedDow) are parsed out of the cron expression
   * either one carries.
   * @param {Record<string, any> | null} task - the task to edit, or null for a new task.
   * @param {Record<string, any>} [seed] - optional template seed for the prefill.
   */
  function openEditor(task, seed) {
    var sched = parseCronSchedule(task ? task.cron : (seed && seed.cron) || '0 9 * * *')
    patch({
      editorOpen: true,
      error: '',
      draft: task ? {
        id: task.id,
        isNew: false,
        enabled: task.enabled,
        cron: task.cron,
        schedMode: sched.schedMode,
        schedTime: sched.schedTime || '09:00',
        schedDow: sched.schedDow || '1',
        actionMode: task.action ? task.action.mode : 'steer',
        sessionId: task.action && task.action.sessionId || '',
        steer: task.action && task.action.steer === true,
        workspacePath: task.action && task.action.workspacePath || '',
        agentPreset: task.action && task.action.agentPreset || 'cordis',
        permissionPreset: task.action && task.action.permissionPreset || 'workspace-write',
        promptTemplate: task.promptTemplate || '',
      } : {
        id: seed && seed.id || '',
        isNew: true,
        enabled: true,
        cron: seed && seed.cron || '0 9 * * *',
        schedMode: sched.schedMode,
        schedTime: sched.schedTime || '09:00',
        schedDow: sched.schedDow || '1',
        actionMode: seed && seed.actionMode || 'steer',
        sessionId: seed && seed.sessionId || '',
        steer: seed ? seed.steer !== false : true,
        workspacePath: seed && seed.workspacePath || '',
        agentPreset: seed && seed.agentPreset || 'cordis',
        permissionPreset: seed && seed.permissionPreset || 'workspace-write',
        promptTemplate: seed && seed.promptTemplate || '',
      },
    })
  }

  function patchDraft(/** @type {Record<string, any>} */ partial) {
    setState(function (/** @type {Record<string, any>} */ cur) {
      var next = /** @type {Record<string, any>} */ ({})
      for (var k in cur) next[k] = cur[k]
      next.draft = next.draft ? mergeObject(next.draft, partial) : null
      return next
    })
  }

  function closeEditor() {
    patch({ editorOpen: false, draft: null, error: '' })
  }

  function saveDraft() {
    var d = state.draft
    if (!d) return
    patch({ busy: true, error: '' })
    var entry = /** @type {Record<string, any>} */ ({
      id: d.id,
      enabled: d.enabled,
      cron: d.cron,
      action: { mode: d.actionMode },
      promptTemplate: d.promptTemplate,
    })
    if (d.actionMode === 'steer') {
      entry.action.sessionId = d.sessionId
      entry.action.steer = d.steer
    } else {
      entry.action.workspacePath = d.workspacePath
      entry.action.agentPreset = d.agentPreset
      entry.action.permissionPreset = d.permissionPreset
    }
    callRemote('cronAdmin/upsert', { entry: entry }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        closeEditor()
        var v = result.value || {}
        // busy must drop together with the editor closing (see WebhookSection).
        patch({ busy: false, tasks: v.tasks || [], history: v.history || [] })
      } else {
        patch({ busy: false, error: dshT('保存失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('保存失败：') + messageOf(err) })
    })
  }

  /**
   * Delete one cron task; the delivery history refreshes with the list.
   * @param {string} id - the task id.
   */
  function deleteTask(id) {
    patch({ busy: true, error: '', confirmId: null })
    callRemote('cronAdmin/remove', { id: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var v = result.value || {}
        patch({ tasks: v.tasks || [], history: v.history || [], busy: false })
      } else {
        patch({ busy: false, error: dshT('删除失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('删除失败：') + messageOf(err) })
    })
  }

  /**
   * Flip one task's enabled flag; only the task list refreshes (no busy
   * banner — the row checkbox itself shows the in-flight state).
   * @param {string} id - the task id.
   * @param {boolean} enabled - the next enabled value.
   */
  function toggleTask(id, enabled) {
    callRemote('cronAdmin/toggle', { id: id, enabled: enabled }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var v = result.value || {}
        patch({ tasks: v.tasks || [], history: v.history || [] })
      } else {
        patch({ error: dshT('切换失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ error: dshT('切换失败：') + messageOf(err) })
    })
  }

  /**
   * Trigger one task immediately; refreshes the history on success.
   * @param {string} id - the task id.
   */
  function runNow(id) {
    patch({ busy: true, error: '' })
    callRemote('cronAdmin/runNow', { id: id }).then(function (result) {
      if (!alive.current) return
      patch({ busy: false })
      var v = result.ok ? (result.value || {}) : {}
      if (result.ok && v.ok) {
        reload()  // history updated
      } else {
        patch({ error: dshT('立即触发失败：') + (messageOf(v.error || result.error) || dshT('未知错误')) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('立即触发失败：') + messageOf(err) })
    })
  }

  var cronActions = {
    patch: patch,
    patchDraft: patchDraft,
    patchSchedule: patchSchedule,
    reload: reload,
    openEditor: openEditor,
    closeEditor: closeEditor,
    saveDraft: saveDraft,
    deleteTask: deleteTask,
    toggleTask: toggleTask,
    runNow: runNow,
  }
  return createElement('div', { 'data-dsh-admin-section': '' },
    CronRender(state, cronActions))
}

/**
 * The Webhook 触发 tree-builder (a plain keyed fragment builder, not a
 * React component — call it directly and hand it the actions object).
 * @param {Record<string, any>} view - the WebhookSection state bag.
 * @param {Record<string, any>} actions - the section's actions bag.
 */
export function WebhookRender(view, actions) {
  var elements = []

  // Busy banner
  if (view.busy) elements.push(createElement('div', { className: 'busy-banner', key: 'busy' },
    createElement('span', { className: 'spinner', key: 'sp' }), dshT('加载中…')))

  // Error
  if (view.error) elements.push(createElement('div', { className: 'error', key: 'err' }, view.error))

  // Runtime mount banner
  if (!view.runtimeMounted) {
    elements.push(createElement('div', { className: 'update-strip checking', key: 'runtime-banner' },
      createElement('span', null, dshT('新建会话模式需要 '), createElement('code', null, '@deepseek-ai/dsh-webhook'), dshT(' webhook 运行时')),
      view.runtimePackageInstalled
        ? createElement('span', null, dshT('（已安装，需挂载到 cordis.patch.yml 并重启 dsh）'))
        : createElement(UiButton, { variant: 'primary', size: 'sm', onClick: function () { actions.runtimeInstall() }, key: 'btn-install-rt' }, dshT('⚡ 安装并挂载 webhook 运行时')),
    ))
  }

  // Endpoint hint
  if (view.endpointOnline) {
    var sampleId = (view.rules.length > 0 ? view.rules[0].id : 'my-rule')
    elements.push(createElement('div', { className: 'card', key: 'endpoint-hint', style: { padding: '8px 12px', fontSize: '12px' } },
      createElement('span', { style: { fontWeight: 600 } }, 'POST '), view.endpointPrefix, '/', createElement('code', null, sampleId),
      '  ', createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #61666b)' } }, '（headers: ', createElement('code', null, 'x-webhook-secret'), ', ', createElement('code', null, 'x-webhook-event'), ', ', createElement('code', null, 'x-webhook-delivery'), dshT('）')),
    ))
  }

  // 新手引导条（与定时任务/工作流页签同版式）。
  elements.push(createElement('div', { className: 'card', key: 'guide', style: { padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-static-blue-500, #5B4CF0)', background: 'var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))' } }, [
    createElement('div', { key: 'g1', style: { fontWeight: '700', marginBottom: '4px' } }, dshT('Webhook = 外部事件 POST 一个 HTTP 请求，就自动给你的 dsh 会话发一条消息（CI、报警、GitHub…都行）')),
    createElement('div', { key: 'g2', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)' } }, dshT('三步上手：① 点下方模板卡片（或「＋ 新建规则」） → ② 把面板给出的端点 URL 与密钥配到外部服务 → ③ 事件到达自动触发，交付历史随时可查。')),
  ]))

  // Toolbar
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar' },
    createElement(UiButton, { variant: 'outline', onClick: function () { actions.openEditor(null) } }, dshT('+ 新建规则')),
    createElement(UiButton, { variant: 'outline', onClick: function () { actions.reload() } }, dshT('⟳ 刷新')),
  ))

  // 模板卡片：点卡片 = 编辑器全部填好（同工作流「从模板开始」）。
  elements.push(createElement('div', { key: 'tpl-head', style: { fontWeight: '600' } }, dshT('从模板开始（点卡片自动填好，改参数就能跑）')))
  elements.push(createElement('div', { key: 'tpl-row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    webhookTemplates().map(function (tpl, tplIndex) {
      var openTpl = function () { actions.openEditor(null, tpl.seed) }
      return createElement('div', {
        key: 'tpl-' + tplIndex,
        role: 'button',
        tabIndex: 0,
        onClick: openTpl,
        onKeyDown: function (/** @type {KeyEventLike} */ event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTpl() } },
        style: { flex: '1', minWidth: '170px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-static-blue-500, #5B4CF0)', background: 'var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))', cursor: 'pointer' },
      }, [
        createElement('div', { key: 't', style: { fontWeight: '700' } }, tpl.title),
        createElement('div', { key: 'd', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', marginTop: '2px' } }, tpl.desc),
      ])
    })
  ))

  // Rules list or editor
  if (view.editorOpen) {
    elements.push(renderWebhookEditor(view, actions))
  } else {
    if (view.rules.length === 0) {
      elements.push(createElement('div', { className: 'empty', key: 'empty' }, dshT('还没有 Webhook 触发规则。点上方模板卡片一键创建，或「＋ 新建规则」从零开始。')))
    }
    for (var i = 0; i < view.rules.length; i++) {
      const rule = view.rules[i] // per-iteration binding: the row handlers below close over THIS rule, not the loop-shared var
      elements.push(createElement('div', { className: 'card', key: 'rule-' + rule.id },
        createElement('div', { className: 'card-header' },
          createElement('span', { className: 'card-title' },
            createElement('span', { className: 'card-title-text', title: rule.id }, rule.id),
            rule.enabled ? null : createElement('span', { className: 'tag', style: { background: 'rgba(239,68,68,0.1)', color: '#ef4444' } }, dshT('已停用')),
            rule.event ? createElement('span', { className: 'tag' }, rule.event) : null,
          ),
          createElement('span', { className: 'card-actions' },
            createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function (/** @type {ClickEventLike} */ e) { e.stopPropagation(); actions.openEditor(rule) } }, dshT('编辑')),
            createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function (/** @type {ClickEventLike} */ e) { e.stopPropagation(); actions.testRule(rule.id) }, title: dshT('会真实注入消息到目标会话') }, dshT('🧪 触发测试')),
            createElement(UiButton, {
              variant: 'outline',
              size: 'sm',
              className: 'danger',
              onClick: function (/** @type {ClickEventLike} */ e) { e.stopPropagation(); actions.patch({ confirmId: view.confirmId === rule.id ? null : rule.id }) },
            }, view.confirmId === rule.id ? '✕' : dshT('删除')),
          ),
        ),
        view.confirmId === rule.id
          ? createElement('div', { className: 'confirm-bar', key: 'confirm' },
            createElement('span', { className: 'confirm-text' }, dshT('确定删除规则「'), rule.id, '」？'),
            createElement('span', { className: 'confirm-actions' },
              createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function () { actions.patch({ confirmId: null }) } }, dshT('取消')),
              createElement(UiButton, { variant: 'outline', size: 'sm',
              className: 'danger-solid', onClick: function () { actions.deleteRule(rule.id) } }, dshT('删除')),
            ))
          : null,
        createElement('div', { className: 'card-sub' },
          createElement('span', { className: 'card-sub-item' },
            rule.action.mode === 'steer' ? '📨 push → ' + rule.action.sessionId + (rule.action.steer ? ' (steer)' : ' (followup)')
              : '🆕 create → ' + (rule.action.agentPreset || '?'),
          ),
        ),
        rule.promptTemplate ? createElement('div', { className: 'card-sub', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)', maxHeight: '2.2em', overflow: 'hidden' } },
          createElement('span', null, '⚙ ' + rule.promptTemplate.slice(0, 120) + (rule.promptTemplate.length > 120 ? '…' : ''))
        ) : null,
      ))
    }
  }

  // History
  if (view.history.length > 0) {
    elements.push(createElement('div', { style: { marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' }, key: 'hist-head' },
      dshT('最近 ') + view.history.length + dshT(' 次交付（本次运行期间）')))
    for (var hi = 0; hi < view.history.length; hi++) {
      var h = view.history[hi]
      var ok = h.ok !== false
      elements.push(createElement('div', { className: 'card', key: 'hist-' + hi, style: { padding: '8px 12px', fontSize: '12px' } },
        createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          createElement('span', { style: ok ? { color: '#16a34a' } : { color: '#ef4444' } }, ok ? '✓' : '✗'),
          createElement('span', { style: { fontWeight: 600 } }, h.ruleId || '?'),
          createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #61666b)' } }, h.event || ''),
          createElement('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary, #61666b)', fontSize: '10px' } }, h.at || ''),
        ),
        h.error ? createElement('div', { style: { color: '#ef4444', marginTop: '2px', fontSize: '11px' } }, h.error) : null,
        h.sessionId ? createElement('div', { style: { color: 'var(--dsw-alias-label-secondary, #61666b)', fontSize: '10px', marginTop: '2px' } }, h.mode + ' → ' + h.sessionId) : null,
      ))
    }
  }

  // Footer
  if (view.storagePath) {
  elements.push(createElement('div', { className: 'footer', key: 'footer' },
      createElement('span', { className: 'path', title: view.storagePath }, '📁 ' + view.storagePath),
      createElement('span', null, dshT('Webhook 触发')),
    ))
  }

  return createElement(React.Fragment, null, elements)
}

/**
 * The webhook rule editor card; reads `view.draft` (null = nothing open).
 * @param {Record<string, any>} view - the WebhookSection state bag.
 * @param {Record<string, any>} actions - the section's actions bag.
 */
export function renderWebhookEditor(view, actions) {
  var d = view.draft
  if (!d) return null
  return createElement('div', { className: 'card mcp-editor', key: 'editor' },
    createElement('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline' } },
      createElement('label', { style: { fontSize: '12px', fontWeight: 600, flex: 'none' } }, 'ID'),
      createElement(UiInput, {  value: d.id, disabled: !d.isNew, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ id: e.target.value }) }, placeholder: dshT('规则标识（英文字母开头，无空格）') }),
    ),
    createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      createElement(UiCheckbox, {
        checked: d.enabled,
        onChange: function (/** @type {boolean} */ next) { actions.patchDraft({ enabled: next }) },
        label: dshT('启用'),
      }),
    ),
    createElement('div', { style: { display: 'flex', gap: '10px' } },
      createElement('div', { style: { flex: 1 } },
        createElement('div', { style: { display: 'flex', gap: '6px' } },
          createElement(UiInput, {
            type: view.showSecret ? 'text' : 'password',
            autoComplete: 'new-password',
            value: d.secret,
            onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ secret: e.target.value }) },
            placeholder: dshT('共享密钥（必填；编辑时留空表示保持不变）'),
          }),
          createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function () { actions.toggleSecret() } }, view.showSecret ? dshT('隐藏') : dshT('显示')),
          createElement(UiButton, {
            variant: 'outline',
            size: 'sm', key: 'regen',
            title: dshT('换一个 16 位随机密钥'),
            onClick: function () { actions.patchDraft({ secret: generateWebhookSecret() }) },
          }, dshT('🎲 换一个')),
        ),
      ),
      createElement('div', { style: { flex: 1 } },
        createElement(UiInput, {  value: d.event, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ event: e.target.value }) }, placeholder: dshT('事件过滤（留空 = 任意事件）') }),
      ),
    ),
    createElement('div', null,
      createElement('label', { style: { fontSize: '12px', fontWeight: 600, flex: 'none' } }, dshT('动作模式')),
      createElement('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
        createElement(UiPill, { active: d.actionMode === 'steer', onClick: function () { actions.patchDraft({ actionMode: 'steer' }) } }, dshT('推送到既有会话')),
        createElement(UiPill, { active: d.actionMode === 'create', onClick: function () { actions.patchDraft({ actionMode: 'create' }) } }, dshT('新建会话')),
      ),
    ),
    d.actionMode === 'steer'
      ? createElement('div', null,
        createElement(UiInput, {  value: d.sessionId, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ sessionId: e.target.value }) }, placeholder: dshT('目标会话 ID（如 session-xxx）') }),
        createElement('span', { style: { marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' } },
          createElement(UiCheckbox, {
            checked: d.steer,
            onChange: function (/** @type {boolean} */ next) { actions.patchDraft({ steer: next }) },
            label: dshT('steer（插入到下一步之前，勾选后 agent 当前步骤完成后立即处理）'),
          }),
        ),
      )
      : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        createElement(UiInput, {  value: d.workspacePath, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ workspacePath: e.target.value }) }, placeholder: dshT('工作区绝对路径（如 E:\\projects\\my-app）') }),
        createElement('div', { style: { display: 'flex', gap: '8px' } },
          createElement('select', { className: 'input', value: d.agentPreset, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ agentPreset: e.target.value }) }, style: { width: 'auto' } },
            (view.presets.length > 0 ? view.presets : [{ id: 'cordis', name: 'cordis' }]).map(function (/** @type {Record<string, any>} */ p) {
              return createElement('option', { key: p.id, value: p.id }, p.name || p.id)
            }),
          ),
          createElement('select', { className: 'input', value: d.permissionPreset, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ permissionPreset: e.target.value }) }, style: { width: 'auto' } },
            (view.permissionPresetNames.length > 0 ? view.permissionPresetNames : ['workspace-write', 'danger-full-access']).map(function (/** @type {string} */ n) {
              return createElement('option', { key: n, value: n }, n)
            }),
          ),
        ),
      ),
    createElement('div', null,
      createElement('label', { style: { fontSize: '12px', fontWeight: 600 } }, dshT('Prompt 模板')),
      createElement('textarea', {
        className: 'input',
        value: d.promptTemplate,
        onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ promptTemplate: e.target.value }) },
        placeholder: dshT('留空使用默认模板。$RULE / $DELIVERY / $EVENT / $PAYLOAD 会被替换。'),
        rows: 4,
        style: { fontFamily: 'monospace', fontSize: '12px', resize: 'vertical', marginTop: '4px' },
      }),
    ),
    createElement('div', { className: 'card-actions', style: { justifyContent: 'flex-end', display: 'flex', gap: '6px', marginTop: '8px' } },
      createElement(UiButton, { variant: 'outline', onClick: function () { actions.closeEditor() } }, dshT('取消')),
      createElement(UiButton, { variant: 'primary', disabled: view.busy, onClick: function () { actions.saveDraft() } }, d.isNew ? dshT('创建') : dshT('保存')),
    ),
  )
}

/**
 * Relative-time formatting for the countdown: "3d 02:11:05" / "02:11:05" /
 * "59s" / "< 1s". Pure, so it can run every second without re-rendering
 * anything that does not display a countdown.
 * @param {number | null} ms - the milliseconds until the next run (null when the task has no next run).
 * @returns {string} the relative-time text.
 */
export function formatCountdown(ms) {
  if (ms === null || ms === undefined || ms < 0) return '—'
  var total = Math.floor(ms / 1000)
  if (total < 1) return '< 1s'
  var days = Math.floor(total / 86400)
  var rem = total - days * 86400
  var h = Math.floor(rem / 3600)
  var m = Math.floor((rem - h * 3600) / 60)
  var s = rem - h * 3600 - m * 60
  var pad = function (/** @type {number} */ n) { return (n < 10 ? '0' : '') + n }
  if (days > 0) return days + 'd ' + pad(h) + ':' + pad(m) + ':' + pad(s)
  if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s)
  if (m > 0) return pad(m) + ':' + pad(s)
  return s + 's'
}

/**
 * Local-time rendering of an epoch-ms value for the row tooltip.
 * @param {number | null} ms - the epoch milliseconds.
 * @returns {string} the local 'YYYY-MM-DD HH:MM:SS' text.
 */
export function formatLocal(ms) {
  if (ms === null || ms === undefined) return '—'
  var d = new Date(ms)
  var pad = function (/** @type {number} */ n) { return (n < 10 ? '0' : '') + n }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

/**
 * The 定时任务 tree-builder (a plain keyed fragment builder, not a React
 * component — call it directly and hand it the actions object).
 * @param {Record<string, any>} view - the CronSection state bag.
 * @param {Record<string, any>} actions - the section's actions bag.
 */
export function CronRender(view, actions) {
  var elements = []

  if (view.busy) elements.push(createElement('div', { className: 'busy-banner', key: 'busy' },
    createElement('span', { className: 'spinner', key: 'sp' }), dshT('加载中…')))

  if (view.error) elements.push(createElement('div', { className: 'error', key: 'err' }, view.error))

  // 「调度器未运行」横幅已删除：cronAdmin/list 恒报 schedulerActive:true（服务
  // 在即调度器在），服务不挂载时 RPC 本身就失败走 error 分支——该横幅是永假
  // 条件下的不可达死 UI。

  // 新手引导条：一句话说清定时任务是什么 + 三步操作（与工作流页签同版式）。
  elements.push(createElement('div', { className: 'card', key: 'guide', style: { padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-static-blue-500, #5B4CF0)', background: 'var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))' } }, [
    createElement('div', { key: 'g1', style: { fontWeight: '700', marginBottom: '4px' } }, dshT('定时任务 = 到点自动给 dsh 发一句话——可以催促既有会话（steer），也可以新建会话从头跑')),
    createElement('div', { key: 'g2', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)' } }, dshT('三步上手：① 点下方模板卡片（或「＋ 新建任务」） → ② 改频率和提示词 → ③ 保存，dsh 运行期间到点自动触发。')),
  ]))

  // Toolbar
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar' },
    createElement(UiButton, { variant: 'outline', onClick: function () { actions.openEditor(null) } }, dshT('+ 新建任务')),
    createElement(UiButton, { variant: 'outline', onClick: function () { actions.reload() } }, dshT('⟳ 刷新')),
  ))

  // 模板卡片：点卡片 = 编辑器全部填好（同工作流「从模板开始」）。
  elements.push(createElement('div', { key: 'tpl-head', style: { fontWeight: '600' } }, dshT('从模板开始（点卡片自动填好，改参数就能跑）')))
  elements.push(createElement('div', { key: 'tpl-row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    cronTemplates().map(function (tpl, tplIndex) {
      var openTpl = function () { actions.openEditor(null, tpl.seed) }
      return createElement('div', {
        key: 'tpl-' + tplIndex,
        role: 'button',
        tabIndex: 0,
        onClick: openTpl,
        onKeyDown: function (/** @type {KeyEventLike} */ event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTpl() } },
        style: { flex: '1', minWidth: '170px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-static-blue-500, #5B4CF0)', background: 'var(--dsw-alias-interactive-bg-hover, rgba(91,76,240,.06))', cursor: 'pointer' },
      }, [
        createElement('div', { key: 't', style: { fontWeight: '700' } }, tpl.title),
        createElement('div', { key: 'd', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', marginTop: '2px' } }, tpl.desc),
      ])
    })
  ))

  if (view.editorOpen) {
    elements.push(renderCronEditor(view, actions))
  } else {
    if (view.tasks.length === 0) {
      elements.push(createElement('div', { className: 'empty', key: 'empty' },
        dshT('还没有定时任务。点上方模板卡片一键创建，或「＋ 新建任务」从零开始；任务在 dsh 运行期间按 cron 表达式自动触发。')))
    }
    for (var i = 0; i < view.tasks.length; i++) {
      const task = view.tasks[i] // per-iteration binding: row handlers close over THIS task
      var nextIn = task.nextRun === null ? null : task.nextRun - view.nowMs
      elements.push(createElement('div', { className: 'card', key: 'task-' + task.id },
        createElement('div', { className: 'card-header' },
          createElement('span', { className: 'card-title' },
            createElement('span', { className: 'card-title-text', title: task.id }, task.id),
            task.enabled ? null : createElement('span', { className: 'tag', style: { background: 'rgba(239,68,68,0.1)', color: '#ef4444' } }, dshT('已停用')),
            task.nextRun === null
              ? createElement('span', { className: 'tag', style: { background: 'rgba(234,179,8,0.12)', color: '#eab308' } }, dshT('无可触发时刻'))
              : null,
          ),
          createElement('span', { className: 'card-actions' },
            // The span keeps the inline layout AND the click guard: the atom has no
            // onClick/style props, and the card behind this toggle must not react.
            createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', marginRight: '4px' }, title: dshT('启用/停用'), onClick: function (/** @type {ClickEventLike} */ e) { e.stopPropagation() } },
              createElement(UiCheckbox, {
                checked: task.enabled === true,
                onChange: function (/** @type {boolean} */ next) { actions.toggleTask(task.id, next) },
                label: dshT('启用'),
              }),
            ),
            createElement(UiButton, { variant: 'primary', size: 'sm', onClick: function (/** @type {ClickEventLike} */ e) { e.stopPropagation(); actions.openEditor(task) } }, dshT('编辑')),
            createElement(UiButton, { variant: 'primary', size: 'sm', onClick: function (/** @type {ClickEventLike} */ e) { e.stopPropagation(); actions.runNow(task.id) }, title: dshT('立即触发一次（会真实注入消息/新建会话）') }, dshT('▶ 立即触发')),
            createElement(UiButton, {
              variant: 'outline',
              size: 'sm',
              className: 'danger',
              onClick: function (/** @type {ClickEventLike} */ e) { e.stopPropagation(); actions.patch({ confirmId: view.confirmId === task.id ? null : task.id }) },
            }, view.confirmId === task.id ? '✕' : dshT('删除')),
          ),
        ),
        view.confirmId === task.id
          ? createElement('div', { className: 'confirm-bar', key: 'confirm' },
            createElement('span', { className: 'confirm-text' }, dshT('确定删除任务「'), task.id, '」？'),
            createElement('span', { className: 'confirm-actions' },
              createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function () { actions.patch({ confirmId: null }) } }, dshT('取消')),
              createElement(UiButton, { variant: 'outline', size: 'sm',
              className: 'danger-solid', onClick: function () { actions.deleteTask(task.id) } }, dshT('删除')),
            ))
          : null,
        createElement('div', { className: 'card-sub' },
          createElement('span', { className: 'card-sub-item' },
            createElement('code', { style: { fontSize: '12px' } }, task.cron || '?'),
            task.action.mode === 'steer'
              ? '  📨 push → ' + task.action.sessionId + (task.action.steer ? ' (steer)' : ' (followup)')
              : '  🆕 create → ' + (task.action.agentPreset || '?'),
          ),
        ),
        createElement('div', { className: 'card-sub', style: { fontSize: '11px' } },
          createElement('span', { className: 'card-sub-item', style: { color: 'var(--dsw-alias-label-secondary, #61666b)' } },
            dshT('⏱ 下次触发 '),
            createElement('span', { style: { fontWeight: 600 }, title: task.nextRunISO ? formatLocal(task.nextRunISO) : '' },
              task.nextRun === null ? dshT('—（表达式在可搜索范围内无匹配日期）')
                : formatCountdown(nextIn) + dshT(' 后 (') + formatLocal(task.nextRun) + ')'),
          ),
          task.action.mode === 'steer' && task.targetOnline === false
            ? createElement('span', { className: 'card-sub-item', style: { color: '#eab308' }, title: dshT('目标会话不在内存中，触发时注入会失败') }, dshT('⚠ 目标会话离线'))
            : null,
        ),
        task.promptTemplate ? createElement('div', { className: 'card-sub', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)', maxHeight: '2.2em', overflow: 'hidden' } },
          createElement('span', null, '⚙ ' + task.promptTemplate.slice(0, 120) + (task.promptTemplate.length > 120 ? '…' : ''))
        ) : null,
      ))
    }
  }

  // History
  if (view.history.length > 0) {
    elements.push(createElement('div', { style: { marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' }, key: 'hist-head' },
      dshT('最近 ') + view.history.length + dshT(' 次触发（本次运行期间）')))
    for (var hi = 0; hi < view.history.length; hi++) {
      var h = view.history[hi]
      var ok = h.ok !== false
      elements.push(createElement('div', { className: 'card', key: 'hist-' + hi, style: { padding: '8px 12px', fontSize: '12px' } },
        createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          createElement('span', { style: ok ? { color: '#16a34a' } : { color: '#ef4444' } }, ok ? '✓' : '✗'),
          createElement('span', { style: { fontWeight: 600 } }, h.taskId || '?'),
          createElement('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary, #61666b)', fontSize: '10px' } }, h.at || ''),
        ),
        h.error ? createElement('div', { style: { color: '#ef4444', marginTop: '2px', fontSize: '11px' } }, h.error) : null,
        h.sessionId ? createElement('div', { style: { color: 'var(--dsw-alias-label-secondary, #61666b)', fontSize: '10px', marginTop: '2px' } }, h.mode + ' → ' + h.sessionId) : null,
      ))
    }
  }

  if (view.storagePath) {
  elements.push(createElement('div', { className: 'footer', key: 'footer' },
      createElement('span', { className: 'path', title: view.storagePath }, '📁 ' + view.storagePath),
      createElement('span', null, dshT('定时任务（宿主级）')),
    ))
  }

  return createElement(React.Fragment, null, elements)
}

/* Structured schedule editing: 每小时/每天/每周 fields compose the 5-field
   cron; any expression outside those shapes falls back to 自定义 mode where
   the raw cron is edited directly. `cron` remains the single stored value. */

export function pad2(/** @type {number} */ n) { return (n < 10 ? '0' : '') + n }

/**
 * Compose the 5-field cron from the structured schedule fields; the raw
 * expression remains the single stored value (see patchSchedule).
 * @param {string} mode - 'hourly' / 'weekly' (anything else composes the daily shape).
 * @param {string} time - the 'HH:MM' time of day.
 * @param {string} dow - the weekday number for weekly mode ('0'-'7').
 * @returns {string} the composed cron expression.
 */
export function composeCron(mode, time, dow) {
  var parts = /^(\d{1,2}):(\d{1,2})$/.exec(time || '09:00')
  var hh = parts ? Number(parts[1]) : 9
  var mm = parts ? Number(parts[2]) : 0
  if (mode === 'hourly') return mm + ' * * * *'
  if (mode === 'weekly') return mm + ' ' + hh + ' * * ' + (dow || '1')
  return mm + ' ' + hh + ' * * *'
}

/**
 * Parse a stored cron expression back into the structured schedule fields;
 * any expression outside the hourly/daily/weekly shapes reads as 'custom',
 * where the raw cron is edited directly.
 * @param {string} cron - the stored 5-field cron expression.
 * @returns {{ schedMode: string, schedTime?: string, schedDow?: string }} the parsed schedule fields.
 */
export function parseCronSchedule(cron) {
  var f = String(cron || '').trim().split(/\s+/)
  var num = function (/** @type {string} */ s) { return /^\d+$/.test(s) ? Number(s) : null }
  if (f.length === 5 && f[2] === '*' && f[3] === '*') {
    var m = num(f[0])
    var h = num(f[1])
    if (f[1] === '*' && f[4] === '*' && m !== null) return { schedMode: 'hourly', schedTime: '00:' + pad2(m), schedDow: '1' }
    if (f[4] === '*' && h !== null && m !== null) return { schedMode: 'daily', schedTime: pad2(h) + ':' + pad2(m), schedDow: '1' }
    var w = num(f[4])
    if (h !== null && m !== null && w !== null && w >= 0 && w <= 6) return { schedMode: 'weekly', schedTime: pad2(h) + ':' + pad2(m), schedDow: String(w) }
  }
  return { schedMode: 'custom' }
}

/**
 * One-line human description of the structured schedule fields (weekly
 * names the weekday through dshT).
 * @param {string} mode - 'hourly' / 'weekly' (anything else reads as daily).
 * @param {string} time - the 'HH:MM' time of day.
 * @param {string} dow - the weekday number for weekly mode.
 * @returns {string} the localized description.
 */
export function describeSchedule(mode, time, dow) {
  var names = /** @type {Record<string, string>} */ ({ '0': dshT('周日'), '1': dshT('周一'), '2': dshT('周二'), '3': dshT('周三'), '4': dshT('周四'), '5': dshT('周五'), '6': dshT('周六') })
  var parts = String(time || '09:00').split(':')
  if (mode === 'hourly') return dshT('每小时第 ') + parts[1] + dshT(' 分')
  if (mode === 'weekly') return dshT('每周 ') + (names[dow] || dow) + ' ' + time
  return dshT('每天 ') + time
}

/** Local UTC offset as a conventional label: GMT+8, GMT-5, GMT+5:30. */
export function tzLabel() {
  var minutes = -new Date().getTimezoneOffset()
  var sign = minutes < 0 ? '-' : '+'
  var abs = Math.abs(minutes)
  var hours = Math.floor(abs / 60)
  var rest = abs % 60
  return 'GMT' + sign + hours + (rest === 0 ? '' : ':' + (rest < 10 ? '0' : '') + rest)
}

/**
 * The cron task editor card; reads `view.draft` (null = nothing open).
 * @param {Record<string, any>} view - the CronSection state bag.
 * @param {Record<string, any>} actions - the section's actions bag.
 */
export function renderCronEditor(view, actions) {
  var d = view.draft
  if (!d) return null
  var secondary = 'var(--dsw-alias-label-secondary, #61666b)'
  // Uniform control height for the schedule row — selects and the time input
  // otherwise render at slightly different natural heights.
  var schedSelectStyle = { width: 'auto', height: '32px', padding: '0 30px 0 12px' }
  return createElement('div', { className: 'card mcp-editor', key: 'editor' },
    // Row 1: identity — the ID field with the 启用 toggle riding beside it.
    createElement('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } },
      createElement(UiInput, {
        value: d.id,
        onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ id: e.target.value }) },
        placeholder: dshT('任务标识（英文字母开头，无空格）'),
        'aria-label': dshT('任务 ID'),
        style: { flex: 1 },
      }),
      createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', flex: 'none', cursor: 'pointer' } },
        createElement(UiCheckbox, {
          checked: d.enabled,
          onChange: function (/** @type {boolean} */ next) { actions.patchDraft({ enabled: next }) },
          label: dshT('启用'),
        }),
      ),
    ),
    createElement('div', null,
      createElement('label', { style: { fontSize: '12px', fontWeight: 600 } }, dshT('调度（本地时区 ') + tzLabel() + dshT('）')),
      createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' } },
        createElement('select', {
          className: 'input', style: schedSelectStyle,
          value: d.schedMode,
          'aria-label': dshT('调度频率'),
          onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchSchedule({ schedMode: e.target.value }) },
        },
          [{ v: 'hourly', t: dshT('每小时') }, { v: 'daily', t: dshT('每天') }, { v: 'weekly', t: dshT('每周') }, { v: 'custom', t: dshT('自定义') }].map(function (o) {
            return createElement('option', { key: o.v, value: o.v }, o.t)
          }),
        ),
        d.schedMode === 'weekly'
          ? createElement('select', {
            className: 'input', style: schedSelectStyle,
            value: d.schedDow,
            'aria-label': dshT('星期'),
            onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchSchedule({ schedDow: e.target.value }) },
          },
            [['1', dshT('周一')], ['2', dshT('周二')], ['3', dshT('周三')], ['4', dshT('周四')], ['5', dshT('周五')], ['6', dshT('周六')], ['0', dshT('周日')]].map(function (o) {
              return createElement('option', { key: o[0], value: o[0] }, o[1])
            }),
          )
          : null,
        d.schedMode !== 'custom'
          ? createElement('span', { style: { fontSize: '12px', color: secondary } }, dshT('于'))
          : null,
        d.schedMode === 'hourly'
          ? createElement('select', {
            className: 'input', style: schedSelectStyle,
            value: Number(String(d.schedTime || '00:00').split(':')[1]),
            'aria-label': dshT('分钟'),
            onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchSchedule({ schedTime: '00:' + pad2(Number(e.target.value)) }) },
          },
            Array.from({ length: 60 }, function (_, i) {
              return createElement('option', { key: i, value: i }, pad2(i))
            }),
          )
          : null,
        d.schedMode === 'daily' || d.schedMode === 'weekly'
          ? createElement(UiInput, {
            style: { width: 'auto', height: '32px', padding: '0 8px' },
            value: d.schedTime || '09:00',
            'aria-label': dshT('时间'),
            onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchSchedule({ schedTime: e.target.value || '09:00' }) },
          })
          : null,
        d.schedMode === 'custom'
          ? createElement(UiInput, {
            value: d.cron,
            onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ cron: e.target.value }) },
            placeholder: '*/5 * * * *',
            style: { fontFamily: 'monospace', flex: 1, minWidth: '160px' },
            'aria-label': dshT('cron 表达式'),
          })
          : null,
      ),
      createElement('div', {
        style: { fontSize: '11px', color: secondary, marginTop: '2px' },
        title: d.cron,
      },
        d.schedMode === 'custom'
          ? dshT('5 位 cron（分 时 日 月 周）：支持 *, 逗号列表, 短横范围, 斜杠步长；周接受 0-7 与 SUN-SAT。')
          : describeSchedule(d.schedMode, d.schedTime, d.schedDow) + ' · ' + d.cron + dshT(' · 进程重启期间到期的任务不补投。')),
    ),
    createElement('div', null,
      createElement('label', { style: { fontSize: '12px', fontWeight: 600 } }, dshT('动作模式')),
      createElement('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
        createElement(UiPill, { active: d.actionMode === 'steer', onClick: function () { actions.patchDraft({ actionMode: 'steer' }) } }, dshT('推送到既有会话')),
        createElement(UiPill, { active: d.actionMode === 'create', onClick: function () { actions.patchDraft({ actionMode: 'create' }) } }, dshT('新建会话')),
      ),
    ),
    d.actionMode === 'steer'
      ? createElement('div', null,
        createElement(UiInput, {  value: d.sessionId, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ sessionId: e.target.value }) }, placeholder: dshT('目标会话 ID（如 session-xxx）') }),
        createElement('span', { style: { marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: secondary } },
          createElement(UiCheckbox, {
            checked: d.steer,
            onChange: function (/** @type {boolean} */ next) { actions.patchDraft({ steer: next }) },
            label: dshT('steer（插入到下一步之前，勾选后 agent 当前步骤完成后立即处理）'),
          }),
        ),
      )
      : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        createElement(UiInput, {  value: d.workspacePath, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ workspacePath: e.target.value }) }, placeholder: dshT('工作区绝对路径（如 E:\\projects\\my-app）') }),
        createElement('div', { style: { display: 'flex', gap: '8px' } },
          createElement('select', { className: 'input', value: d.agentPreset, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ agentPreset: e.target.value }) }, style: { width: 'auto' } },
            (view.presets.length > 0 ? view.presets : [{ id: 'cordis', name: 'cordis' }]).map(function (/** @type {Record<string, any>} */ p) {
              return createElement('option', { key: p.id, value: p.id }, p.name || p.id)
            }),
          ),
          createElement('select', { className: 'input', value: d.permissionPreset, onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ permissionPreset: e.target.value }) }, style: { width: 'auto' } },
            (view.permissionPresetNames.length > 0 ? view.permissionPresetNames : ['workspace-write', 'danger-full-access']).map(function (/** @type {string} */ n) {
              return createElement('option', { key: n, value: n }, n)
            }),
          ),
        ),
      ),
    createElement('div', null,
      createElement('label', { style: { fontSize: '12px', fontWeight: 600 } }, dshT('Prompt 模板')),
      createElement('textarea', {
        className: 'input',
        value: d.promptTemplate,
        onChange: function (/** @type {InputChangeEvent} */ e) { actions.patchDraft({ promptTemplate: e.target.value }) },
        placeholder: dshT('留空使用默认模板。$RULE / $DELIVERY / $EVENT / $PAYLOAD 会被替换。'),
        rows: 4,
        style: { fontFamily: 'monospace', fontSize: '12px', resize: 'vertical', marginTop: '4px' },
      }),
    ),
    createElement('div', { className: 'card-actions', style: { justifyContent: 'flex-end', display: 'flex', gap: '6px', marginTop: '8px' } },
      createElement(UiButton, { variant: 'outline', onClick: function () { actions.closeEditor() } }, dshT('取消')),
      createElement(UiButton, { variant: 'primary', disabled: view.busy, onClick: function () { actions.saveDraft() } }, d.isNew ? dshT('创建') : dshT('保存')),
    ),
  )
}
