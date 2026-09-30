/** subagents — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiCheckbox, UiInput, createElement, dshT, useEffect, useRef, useState } from './context.js'
import { ConfirmButton, Picker, Spinner, tabKeyDown } from './shared.js'

/* ========================================================================== */
/*            Subagent Administration (merged from dsh-plugin-subagents)     */
/* ========================================================================== */

/**
 * dsh-plugin-subagents browser half: the 子智能体管理 settings section.
 *
 * Renders a management panel over the shell's `settings.section` slot (same
 * platform-shared React and --dsw-* design tokens as the admin plugin) and
 * drives the host's `subagentAdmin` remote over the /api RPC gateway. One
 * managed row in the profile cordis.patch.yml equals one named subagent: a
 * `@deepseek-ai/dsh-tool-subagent` instance whose config carries the agent
 * name (toolName), the persona prompt, the tool constraint lists, and the
 * model specification (agentOptions).
 */

// Same grammar as the host's TOOLNAME_PATTERN (subagent-admin.js) — the host
// rejects what this accepts, so keeping them identical avoids a preflight
// pass on a name the host then refuses.
/** One subagent form draft (emptyDraft / draftFromEntry shape). */
/** @typedef {{
 *   id: string, toolName: string, provider: string, persona: string,
 *   allow: string[], deny: string[], agentProvider: string, agentModel: string,
 *   maxTokens: string, maxDepthManaged: boolean, maxDepth: string,
 *   backgroundMode: string, enableRunInBackground: boolean,
 * }} SubagentDraft */

/** The slot props every panel receives: the RPC seam plus (untyped) extras. */
/** @typedef {{ call: (method: string, args: any) => Promise<any> }} PanelCallProps */

export var TOOLNAME_RE = /^[a-z][a-z0-9_]{1,47}$/

export var TOOL_REF_RE = /^[a-z][a-z0-9_]*$/

export var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export var RESERVED_TOOL_NAMES = ['subagent', 'subagent_fork', 'run_code']

/** The gateway wraps every remote result in an { ok, value | error } envelope. */
/** @param {any} result - the RPC envelope (duck-typed). */
export function unwrap(result) {
  if (result && typeof result === 'object' && 'ok' in result) {
    if (result.ok) return result.value
    var detail = result.error && result.error.message ? result.error.message : String(result.error)
    throw new Error(detail)
  }
  return result
}

/* ========================================================================== */
/*                            Form draft handling                             */
/* ========================================================================== */

export function emptyDraft() {
  return {
    id: '',
    toolName: '',
    provider: 'spawn',
    persona: '',
    allow: [],
    deny: [],
    agentProvider: '',
    agentModel: '',
    maxTokens: '',
    maxDepthManaged: false,
    maxDepth: '3',
    backgroundMode: 'one-shot',
    enableRunInBackground: true,
  }
}

/** @param {Record<string, any>} entry - one managed row ({ id, config }). */
export function draftFromEntry(entry) {
  var config = entry.config || {}
  return {
    id: entry.id,
    toolName: config.toolName || '',
    provider: config.provider || 'spawn',
    persona: config.persona || '',
    allow: (config.toolFilter && config.toolFilter.allow) || [],
    deny: (config.toolFilter && config.toolFilter.deny) || [],
    agentProvider: (config.agentOptions && config.agentOptions.provider) || '',
    agentModel: (config.agentOptions && config.agentOptions.model) || '',
    maxTokens: config.agentOptions && config.agentOptions.maxTokens !== undefined ? String(config.agentOptions.maxTokens) : '',
    maxDepthManaged: config.maxDepth === 'provider-managed',
    maxDepth: typeof config.maxDepth === 'number' ? String(config.maxDepth) : '3',
    backgroundMode: config.backgroundMode || 'one-shot',
    enableRunInBackground: config.enableRunInBackground !== false,
  }
}

/** Remove options the newly selected provider cannot execute. */
/** @param {SubagentDraft} draft
 * @param {Record<string, any>} provider - the provider meta (duck-typed). */
export function adjustDraftForProvider(draft, provider) {
  /** @type {Record<string, any>} */
  var patch = {}
  /** @type {string[]} */
  var adjusted = []
  if (!provider) return { patch: patch, adjusted: adjusted }
  if (provider.capabilities.persona === false && draft.persona !== '') {
    patch.persona = ''
    adjusted.push(dshT('提示词'))
  }
  if (provider.capabilities.toolFilter === false && (draft.allow.length > 0 || draft.deny.length > 0)) {
    patch.allow = []
    patch.deny = []
    adjusted.push(dshT('工具约束'))
  }
  if (provider.capabilities.depthLimit === false && !draft.maxDepthManaged && draft.maxDepth !== '') {
    patch.maxDepthManaged = true
    adjusted.push(dshT('数值最大委托深度'))
  }
  if (provider.continuable !== true && draft.backgroundMode === 'continuable') {
    patch.backgroundMode = 'one-shot'
    adjusted.push(dshT('后台模式'))
  }
  return { patch: patch, adjusted: adjusted }
}

/** Client-side validation mirroring the host rules; returns an error string or null. */
/** @param {SubagentDraft} draft
 * @param {boolean} isCreate
 * @param {string[]} otherToolNames
 * @param {Record<string, Record<string, any>>} providerMeta
 * @param {string[]} candidateNames */
export function validateDraft(draft, isCreate, otherToolNames, providerMeta, candidateNames) {
  if (isCreate && !ID_RE.test(draft.id)) return dshT('实例 ID 只能包含字母、数字、下划线和中划线（字母或数字开头，最长 64 位）')
  if (!TOOLNAME_RE.test(draft.toolName)) return dshT('子智能体名称必须是 2-48 位小写字母/数字/下划线且字母开头')
  if (RESERVED_TOOL_NAMES.indexOf(draft.toolName) !== -1) return dshT('子智能体名称 "') + draft.toolName + dshT('" 是保留名（内置预设已占用）')
  if (otherToolNames.indexOf(draft.toolName) !== -1) return dshT('子智能体名称 "') + draft.toolName + dshT('" 已被其他实例使用')
  var meta = providerMeta[draft.provider]
  if (!meta) return dshT('未知的执行后端 "') + draft.provider + '"'
  if (draft.persona !== '' && meta.capabilities.persona === false) return dshT('后端 "') + draft.provider + dshT('" 不支持 persona（提示词）')
  if ((draft.allow.length > 0 || draft.deny.length > 0) && meta.capabilities.toolFilter === false) return dshT('后端 "') + draft.provider + dshT('" 不支持 toolFilter（工具约束）')
  if (!draft.maxDepthManaged) {
    if (draft.maxDepth !== '' && !/^\d+$/.test(draft.maxDepth)) return dshT('最大委托深度必须是非负整数')
    if (draft.maxDepth !== '' && meta.capabilities.depthLimit === false) {
      return dshT('后端 "') + draft.provider + dshT('" 无法执行数值 maxDepth；请勾选「交由后端管理」或换后端')
    }
  }
  if (draft.maxTokens !== '' && !/^\d+$/.test(draft.maxTokens)) return dshT('maxTokens 必须是正整数')
  var filterNames = (draft.allow || []).concat(draft.deny || [])
  for (var fi = 0; fi < filterNames.length; fi++) {
    var tname = filterNames[fi]
    if (RESERVED_TOOL_NAMES.indexOf(tname) !== -1) return dshT('工具 "') + tname + dshT('" 是保留名（') + RESERVED_TOOL_NAMES.join('/') + dshT('），不能用于工具约束')
    if (candidateNames && candidateNames.length > 0 && candidateNames.indexOf(tname) === -1) return dshT('工具 "') + tname + dshT('" 不在可选清单中（来自运行中工具或内置名录），保存会被拒绝')
  }
  return null
}

/** @param {SubagentDraft} draft */
export function draftToPayload(draft) {
  /** @type {Record<string, any>} */
  var config = { provider: draft.provider, toolName: draft.toolName }
  if (draft.persona.trim() !== '') config.persona = draft.persona
  if (draft.allow.length > 0 || draft.deny.length > 0) {
    config.toolFilter = {}
    if (draft.allow.length > 0) config.toolFilter.allow = draft.allow.slice()
    if (draft.deny.length > 0) config.toolFilter.deny = draft.deny.slice()
  }
  /** @type {Record<string, any>} */
  var agentOptions = {}
  if (draft.agentProvider.trim() !== '') agentOptions.provider = draft.agentProvider.trim()
  if (draft.agentModel.trim() !== '') agentOptions.model = draft.agentModel.trim()
  if (draft.maxTokens.trim() !== '') agentOptions.maxTokens = Number(draft.maxTokens)
  if (Object.keys(agentOptions).length > 0) config.agentOptions = agentOptions
  if (draft.maxDepthManaged) config.maxDepth = 'provider-managed'
  else if (draft.maxDepth !== '') config.maxDepth = Number(draft.maxDepth)
  config.backgroundMode = draft.backgroundMode
  config.enableRunInBackground = draft.enableRunInBackground === true
  return { id: draft.id.trim(), config: config }
}

/* ========================================================================== */
/*                              Subagents panel                               */
/* ========================================================================== */

/** @param {PanelCallProps & Record<string, any>} props */
export function SubagentsPanel(props) {
  var call = props.call

  var viewState = useState({ loading: true, error: null, data: null })
  var view = viewState[0]
  var setView = viewState[1]

  var formState = useState(null)
  var form = formState[0]
  var setForm = formState[1]

  var needleState = useState('')
  var needle = needleState[0]
  var setNeedle = needleState[1]

  var providerFilterState = useState('')
  var providerFilter = providerFilterState[0]
  var setProviderFilter = providerFilterState[1]

  var noticeState = useState(null)
  var notice = noticeState[0]
  var setNotice = noticeState[1]

  var toastState = useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]

  var reload = function () {
    setView(function (/** @type {any} */ prev) { return Object.assign({}, prev, { loading: true, error: null }) })
    call('subagentAdmin/list', {}).then(function (/** @type {any} */ raw) {
      var result = unwrap(raw)
      setView({ loading: false, error: null, data: result })
    }).catch(function (/** @type {any} */ error) {
      setView({ loading: false, error: String((error && error.message) || error), data: null })
    })
  }
  useEffect(reload, [])

  useEffect(function () {
    if (!toast) return undefined
    var timer = setTimeout(function () { setToast(null) }, 4200)
    return function () { clearTimeout(timer) }
  }, [toast])

  var data = view.data
  var entries = (data && data.entries) || []
  var meta = (data && data.meta) || { tools: [], providers: [], llmProviders: [], llmModels: {} }
  var candidateNames = meta.tools.map(function (/** @type {Record<string, any>} */ tool) { return tool.name })
  /** @type {Record<string, Record<string, any>>} */
  var providerMeta = {}
  meta.providers.forEach(function (/** @type {Record<string, any>} */ provider) { providerMeta[provider.name] = provider })
  var llmProviders = meta.llmProviders || []
  var llmModels = meta.llmModels || {}

  var filtered = entries.filter(function (/** @type {Record<string, any>} */ entry) {
    var config = entry.config || {}
    if (providerFilter !== '' && config.provider !== providerFilter) return false
    if (needle === '') return true
    var haystack = [entry.id, config.toolName, config.provider, config.persona, config.agentOptions && config.agentOptions.model]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.indexOf(needle.toLowerCase()) !== -1
  })

  var openCreate = function () {
    setNotice(null)
    setForm({ draft: emptyDraft(), editing: false, saving: false, error: null, capabilityNotice: null, advanced: false })
  }
  var openEdit = function (/** @type {Record<string, any>} */ entry) {
    setNotice(null)
    setForm({ draft: draftFromEntry(entry), editing: true, saving: false, error: null, capabilityNotice: null, advanced: false })
  }
  var closeForm = function () { setForm(null) }

  var saveForm = function () {
    if (!form || form.saving) return
    var otherToolNames = entries
      .filter(function (/** @type {Record<string, any>} */ entry) { return !form.editing || entry.id !== form.draft.id })
      .map(function (/** @type {Record<string, any>} */ entry) { return (entry.config || {}).toolName })
      .filter(Boolean)
    var clientError = validateDraft(form.draft, !form.editing, otherToolNames, providerMeta, candidateNames)
    if (clientError) {
      setForm(Object.assign({}, form, { error: clientError }))
      return
    }
    var saving = Object.assign({}, form, { saving: true, error: null })
    setForm(saving)
    var payload = draftToPayload(saving.draft)
    call('subagentAdmin/upsert', { entry: payload }).then(function (/** @type {any} */ raw) {
      var result = unwrap(raw)
      setView(function (/** @type {any} */ prev) { return Object.assign({}, prev, { data: result, loading: false }) })
      setForm(null)
      setNotice(result.warnings && result.warnings.length > 0 ? result.warnings : null)
    }).catch(function (/** @type {any} */ error) {
      var message = String((error && error.message) || error)
      setForm(Object.assign({}, saving, { saving: false, error: message }))
      setToast(dshT('保存失败：') + message)
    })
  }

  // One remove RPC per entry at a time: the confirm button re-enables after
  // 3.2s, and a double-fire would send two removes (the second reporting a
  // spurious failure).
  var removeInFlight = useRef({})
  var removeEntry = function (/** @type {Record<string, any>} */ entry) {
    if (removeInFlight.current[entry.id]) return
    removeInFlight.current[entry.id] = true
    call('subagentAdmin/remove', { id: entry.id }).then(function (/** @type {any} */ raw) {
      delete removeInFlight.current[entry.id]
      var result = unwrap(raw)
      setView(function (/** @type {any} */ prev) { return Object.assign({}, prev, { data: result, loading: false }) })
      setNotice(null)
    }).catch(function (/** @type {any} */ error) {
      delete removeInFlight.current[entry.id]
      setToast(dshT('删除失败：') + String((error && error.message) || error))
    })
  }

  var patchDraft = function (/** @type {Record<string, any>} */ patch) {
    setForm(function (/** @type {any} */ prev) {
      return Object.assign({}, prev, { draft: Object.assign({}, prev.draft, patch) })
    })
  }
  var patchProvider = function (/** @type {string} */ providerName) {
    setForm(function (/** @type {any} */ prev) {
      var adjustment = adjustDraftForProvider(prev.draft, providerMeta[providerName])
      return Object.assign({}, prev, {
        draft: Object.assign({}, prev.draft, { provider: providerName }, adjustment.patch),
        error: null,
        capabilityNotice: adjustment.adjusted.length > 0
          ? dshT('已按「') + providerName + dshT('」的能力清除或调整：') + adjustment.adjusted.join(dshT('、'))
          : null,
      })
    })
  }
  var toggleAdvanced = function () {
    setForm(function (/** @type {any} */ prev) { return Object.assign({}, prev, { advanced: prev.advanced !== true }) })
  }

  var children = []

  // Main toolbar: search + primary actions. Provider filters live on their own
  // row below so a growing backend list never squeezes the search box.
  children.push(createElement('div', { className: 'toolbar', key: 'toolbar' },
    createElement('div', { className: 'search-wrap', key: 'search' },
      createElement('span', { className: 'search-icon' }, '🔍'),
      createElement(UiInput, {
        placeholder: dshT('搜索子智能体（名称/ID/后端/提示词/模型）...'),
        value: needle,
        onChange: function (/** @type {{ target: { value: string } }} */ event) { setNeedle(event.target.value) },
      })
    ),
    createElement(UiButton, { variant: 'primary', size: 'sm', key: 'create', onClick: openCreate }, dshT('＋ 新建子智能体')),
    createElement(UiButton, { variant: 'outline', size: 'sm', key: 'refresh', onClick: reload, disabled: view.loading },
      view.loading ? createElement(Spinner, { key: 'spin' }) : '↻', dshT('刷新'))
  ))

  if (meta.providers.length > 1) {
    children.push(createElement('div', { className: 'filterbar', key: 'filterbar' },
      createElement('span', { className: 'filter-label' }, dshT('执行后端')),
      createElement(UiButton, {
        type: 'button', key: 'pill-all',
        variant: 'outline',
        size: 'sm', className: (providerFilter === '' ? ' active' : ''),
        onClick: function () { setProviderFilter('') },
      }, dshT('全部')),
      meta.providers.map(function (/** @type {Record<string, any>} */ provider) {
        return createElement(UiButton, {
          type: 'button', key: 'pill-' + provider.name,
          variant: 'outline',
          size: 'sm', className: (providerFilter === provider.name ? ' active' : ''),
          onClick: function () { setProviderFilter(providerFilter === provider.name ? '' : provider.name) },
        }, provider.name)
      })
    ))
  }

  if (form) {
    children.push(SubagentForm({
      form: form,
      meta: meta,
      candidateNames: candidateNames,
      providerMeta: providerMeta,
      llmProviders: llmProviders,
      llmModels: llmModels,
      entries: entries,
      onPatch: patchDraft,
      onProviderChange: patchProvider,
      onToggleAdvanced: toggleAdvanced,
      onClose: closeForm,
      onSave: saveForm,
    }))
  }

  if (notice) {
    children.push(createElement('div', { className: 'warn-strip', key: 'notice' },
      notice.map(function (/** @type {string} */ warning, /** @type {number} */ index) {
        return createElement('div', { key: index }, '⚠️ ', warning)
      })
    ))
  }

  if (!form) {
    if (view.loading && entries.length === 0) {
      children.push(createElement('div', { className: 'empty', key: 'loading' },
        createElement('span', { className: 'big' }, '⏳'),
        dshT('正在加载子智能体配置…')))
    } else if (view.error) {
      children.push(createElement('div', { className: 'error-strip', key: 'error' }, dshT('⚠️ 加载失败：'), view.error))
    } else if (filtered.length === 0) {
      children.push(createElement('div', { className: 'empty', key: 'empty' },
        createElement('span', { className: 'big' }, '🤖'),
        entries.length === 0
          ? dshT('还没有受管子智能体。点击「＋ 新建子智能体」创建第一个：名称、提示词、工具约束、模型指定全部可配。')
          : dshT('没有匹配当前搜索/筛选的子智能体。')))
    } else {
      children.push(createElement('div', { className: 'list', key: 'cards' }, filtered.map(function (/** @type {Record<string, any>} */ entry) {
        return SubagentCard({
          entry: entry,
          onEdit: openEdit,
          onRemove: removeEntry,
        })
      })))
    }
  }

  children.push(createElement('div', { className: 'footer-note', key: 'note' },
    dshT('每张卡片对应 profile cordis.patch.yml 中一个 @deepseek-ai/dsh-tool-subagent 行；保存即写入该文件，由 Cordis HMR 热加载生效（无需重启），重启 dsh 后同样自动加载。首次修改前原文件自动备份为 cordis.patch.yml.bak-subagent-admin。')))

  return createElement('div', null,
    toast ? createElement('div', { className: 'toast' }, toast) : null,
    children
  )
}

/** @param {Record<string, any>} props */
export function SubagentForm(props) {
  var form = props.form
  var draft = form.draft
  var meta = props.meta
  var candidateNames = props.candidateNames
  var providerMeta = props.providerMeta
  var llmProviders = props.llmProviders || []
  var llmModels = props.llmModels || {}
  var entries = props.entries
  var onPatch = props.onPatch
  var onProviderChange = props.onProviderChange
  var onToggleAdvanced = props.onToggleAdvanced
  var onClose = props.onClose
  var onSave = props.onSave
  var advanced = form.advanced === true

  var providerInfo = providerMeta[draft.provider]
  var capabilityHint = providerInfo
    ? dshT('能力：') + [
      providerInfo.capabilities.persona ? dshT('✓ 提示词') : dshT('✗ 提示词'),
      providerInfo.capabilities.toolFilter ? dshT('✓ 工具约束') : dshT('✗ 工具约束'),
      providerInfo.capabilities.depthLimit ? dshT('✓ 深度上限') : dshT('✗ 深度上限'),
      providerInfo.continuable ? dshT('✓ 可持续会话') : dshT('仅一次性'),
    ].join(' / ')
    : ''
  // Model picker options: the selected provider's catalog, else every model.
  var modelOptions = draft.agentProvider && llmModels[draft.agentProvider]
    ? llmModels[draft.agentProvider]
    : [].concat.apply([], Object.keys(llmModels).map(function (k) { return llmModels[k] }))

  return createElement('div', { className: 'form', key: 'form' },
    createElement('div', { className: 'form-title' },
      form.editing ? dshT('✏️ 编辑子智能体') : dshT('✨ 新建子智能体'),
      createElement('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
        createElement(UiButton, { variant: 'outline', size: 'sm', onClick: onClose, disabled: form.saving }, dshT('取消'))
      )
    ),
    form.error ? createElement('div', { className: 'error-strip' }, '⚠️ ', form.error) : null,
    form.capabilityNotice ? createElement('div', { className: 'warn-strip' }, '⚠️ ', form.capabilityNotice) : null,
    createElement('div', { className: 'form-grid' },
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('实例 ID')),
        createElement(UiInput, {
          value: draft.id,
          disabled: form.editing,
          placeholder: dshT('如 researcher、code-reviewer'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ id: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, dshT('补丁行标识，创建后不可改；持久化在 profile 的 cordis.patch.yml'))
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('子智能体名称（模型可见工具名）')),
        createElement(UiInput, {
          value: draft.toolName,
          placeholder: dshT('如 web_researcher（模型用它发起委托）'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ toolName: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, dshT('不能用保留名 subagent / subagent_fork / run_code，且各实例间唯一'))
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('执行后端（provider）')),
        createElement('select', {
          className: 'input', value: draft.provider, disabled: form.saving,
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onProviderChange(event.target.value) },
        },
          meta.providers.map(function (/** @type {Record<string, any>} */ provider) {
            return createElement('option', { key: provider.name, value: provider.name }, provider.name)
          })
        ),
        createElement('span', { className: 'field-hint' }, capabilityHint)
      ),
      advanced ? createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('后台模式')),
        createElement('select', {
          className: 'input', value: draft.backgroundMode, disabled: form.saving,
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ backgroundMode: event.target.value }) },
        },
          createElement('option', { value: 'one-shot' }, dshT('one-shot（一次性任务）')),
          createElement('option', { value: 'continuable', disabled: !providerInfo || providerInfo.continuable !== true }, dshT('continuable（可持续会话）'))
        ),
        createElement(UiCheckbox, {
          checked: draft.enableRunInBackground === true,
          disabled: form.saving,
        onChange: function (/** @type {boolean} */ next) { onPatch({ enableRunInBackground: next }) },
          label: dshT('暴露 run_in_background 参数'),
          className: 'checkbox-row',
        })
      ) : null,
      createElement('div', { className: 'field full' },
        createElement('span', { className: 'field-label' }, dshT('提示词（persona，留空继承部署默认）')),
        createElement('textarea', {
          className: 'input', value: draft.persona, rows: 4, disabled: form.saving || providerInfo?.capabilities.persona === false,
          placeholder: dshT('该子智能体的人设/职责说明…支持 {{model}} 与 {{cwd}} 模板变量'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ persona: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, providerInfo?.capabilities.persona === false
          ? dshT('当前后端不支持提示词；切换后端时已有内容会自动清除')
          : dshT('保存后影子覆盖（shadow）部署级 persona，仅对该子智能体生效'))
      ),
      createElement('div', { className: 'field full' },
        createElement(UiButton, {
          variant: 'outline',
          size: 'sm', disabled: form.saving,
          onClick: onToggleAdvanced,
        }, advanced ? dshT('收起高级设置') : dshT('高级设置（工具、模型、深度与后台）'))
      ),
      advanced ? createElement('div', { className: 'fieldset full' },
        createElement('span', { className: 'fieldset-legend' }, dshT('工具约束（toolFilter，留空则不限制；可搜索和手动输入，仅当前候选工具可保存）')),
        createElement('div', { className: 'field' },
          createElement('span', { className: 'field-label' }, dshT('仅允许（allow 白名单）')),
          createElement(Picker, {
            multi: true, kind: 'allow', allowCustom: true, disabled: form.saving || providerInfo?.capabilities.toolFilter === false,
            values: draft.allow, options: candidateNames.map(function (/** @type {Record<string, any>} */ n) { return { value: n, label: n } }),
            placeholder: dshT('输入或选择工具名，如 read / glob / grep'), ariaLabel: dshT('仅允许工具'),
        onChange: function (/** @type {string[]} */ next) { onPatch({ allow: next }) },
          }),
          createElement('span', { className: 'field-hint' }, dshT('设置后子智能体只保留名单内工具，其余从提示词移除且拒绝执行'))
        ),
        createElement('div', { className: 'field' },
          createElement('span', { className: 'field-label' }, dshT('禁止（deny 黑名单）')),
          createElement(Picker, {
            multi: true, kind: 'deny', allowCustom: true, disabled: form.saving || providerInfo?.capabilities.toolFilter === false,
            values: draft.deny, options: candidateNames.map(function (/** @type {Record<string, any>} */ n) { return { value: n, label: n } }),
            placeholder: dshT('输入或选择工具名，如 bash / pwsh'), ariaLabel: dshT('禁止工具'),
        onChange: function (/** @type {string[]} */ next) { onPatch({ deny: next }) },
          }),
          createElement('span', { className: 'field-hint' }, providerInfo?.capabilities.toolFilter === false
            ? dshT('当前后端不支持工具约束；切换后端时已有约束会自动清除')
            : dshT('名单内工具对子智能体不可见；手动输入的工具也必须在当前候选清单内才可保存'))
        )
      ) : null,
      advanced ? createElement('div', { className: 'fieldset full' },
        createElement('span', { className: 'fieldset-legend' }, dshT('模型指定（agentOptions，留空字段继承父代理当前路由）')),
        createElement('div', { className: 'form-grid' },
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, 'LLM provider'),
            createElement(Picker, {
              multi: false, allowCustom: true,
              values: draft.agentProvider ? [draft.agentProvider] : [],
              options: llmProviders.map(function (/** @type {Record<string, any>} */ p) { return { value: p.id, label: p.name } }),
              placeholder: dshT('留空继承，如 optirouter / deepseek-official'), ariaLabel: 'LLM provider',
        onChange: function (/** @type {string[]} */ next) { onPatch({ agentProvider: next[0] || '' }) },
            })
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, dshT('模型标识（model）')),
            createElement(Picker, {
              multi: false, allowCustom: true,
              values: draft.agentModel ? [draft.agentModel] : [],
              options: modelOptions.map(function (/** @type {Record<string, any>} */ m) { return { value: m.id, label: m.name } }),
              placeholder: dshT('留空继承，如 auto'), ariaLabel: dshT('模型标识'),
        onChange: function (/** @type {string[]} */ next) { onPatch({ agentModel: next[0] || '' }) },
            }),
            createElement('span', { className: 'field-hint' }, dshT('从已配置模型中选择，或手填模型 id（需在该 provider 路由上注册）'))
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, dshT('maxTokens（单次回复上限）')),
            createElement(UiInput, {
              value: draft.maxTokens,
              placeholder: dshT('留空使用默认'), inputMode: 'numeric',
              onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ maxTokens: event.target.value.replace(/[^0-9]/g, '') }) },
            })
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, dshT('最大委托深度（maxDepth，0 = 禁止再委托）')),
            createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              createElement(UiInput, {
                value: draft.maxDepth,
                disabled: form.saving || draft.maxDepthManaged || providerInfo?.capabilities.depthLimit === false,
                placeholder: dshT('3（默认）'), inputMode: 'numeric',
                onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ maxDepth: event.target.value.replace(/[^0-9]/g, '') }) },
              }),
              createElement('span', { style: { flex: 'none' } },
                createElement(UiCheckbox, {
                  checked: draft.maxDepthManaged,
                  disabled: form.saving || providerInfo?.capabilities.depthLimit === false,
        onChange: function (/** @type {boolean} */ next) { onPatch({ maxDepthManaged: next }) },
                  label: dshT('交由后端管理'),
                  className: 'checkbox-row',
                })
              )
            )
          )
        )
      ) : null
    ),
    createElement('div', { className: 'form-actions' },
      createElement(UiButton, { variant: 'outline', size: 'sm', onClick: onClose, disabled: form.saving }, dshT('取消')),
      createElement(UiButton, { variant: 'primary', size: 'sm', onClick: onSave, disabled: form.saving },
        form.saving ? createElement(Spinner, { key: 'spin' }) : null,
        dshT('保存'))
    )
  )
}

/** @param {Record<string, any>} props */
export function SubagentCard(props) {
  var entry = props.entry
  var config = entry.config || {}
  var live = entry.live || {}
  var liveTag = live.providerPresent === false
    ? createElement('span', { className: 'tag dead' }, dshT('❌ 后端未注册'))
    : live.toolRegistered
      ? createElement('span', { className: 'tag live' }, dshT('✅ 已挂载'))
      : createElement('span', { className: 'tag warn' }, dshT('⚠️ 工具未挂载'))
  var hasModelRoute = config.agentOptions && (config.agentOptions.model || config.agentOptions.provider)
  var modelLabel = hasModelRoute
    ? ((config.agentOptions.model || '') + (config.agentOptions.provider ? (config.agentOptions.model ? ' @ ' : '') + config.agentOptions.provider : ''))
    : dshT('继承父代理')

  var children = [
    createElement('div', { className: 'card-header', key: 'head' },
      createElement('span', { className: 'card-title' }, '🤖 ', config.toolName || entry.id),
      createElement('span', { className: 'card-actions' },
        createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function () { props.onEdit(entry) } }, dshT('编辑')),
        createElement(ConfirmButton, {
          label: dshT('删除'), confirmLabel: dshT('确认删除？'),
          onConfirm: function () { props.onRemove(entry) },
        })
      )
    ),
    createElement('div', { className: 'card-sub', key: 'tags' },
      createElement('span', { className: 'tag provider' }, '⚙ ' + (config.provider || '?')),
      createElement('span', { className: 'tag model' }, '🧠 ' + modelLabel),
      createElement('span', { className: 'tag' }, config.backgroundMode === 'continuable' ? dshT('可持续') : dshT('一次性')),
      typeof config.maxDepth === 'number' ? createElement('span', { className: 'tag' }, dshT('深度≤') + config.maxDepth) : null,
      config.maxDepth === 'provider-managed' ? createElement('span', { className: 'tag' }, dshT('深度=后端管理')) : null,
      liveTag
    ),
  ]

  if (config.persona) {
    children.push(createElement('div', { className: 'persona-box', key: 'persona' },
      createElement('span', null, '📝'),
      createElement('span', { className: 'persona-text' }, config.persona)
    ))
  }

  var chips = []
  if (config.toolFilter && config.toolFilter.allow && config.toolFilter.allow.length > 0) {
    chips.push(createElement('span', { key: 'allow-label', style: { fontSize: '10px', color: '#047857', fontWeight: 600 } }, dshT('仅允许')))
    config.toolFilter.allow.forEach(function (/** @type {string} */ name) {
      chips.push(createElement('span', { key: 'a-' + name, className: 'chip allow' }, name))
    })
  }
  if (config.toolFilter && config.toolFilter.deny && config.toolFilter.deny.length > 0) {
    chips.push(createElement('span', { key: 'deny-label', style: { fontSize: '10px', color: '#b91c1c', fontWeight: 600 } }, dshT('禁止')))
    config.toolFilter.deny.forEach(function (/** @type {string} */ name) {
      chips.push(createElement('span', { key: 'd-' + name, className: 'chip deny' }, name))
    })
  }
  if (chips.length > 0) {
    children.push(createElement('div', { className: 'chips', key: 'chips' }, chips))
  }

  children.push(createElement('div', { className: 'card-sub', key: 'meta' },
    createElement('span', { className: 'tag', title: entry.id }, 'ID: ' + entry.id),
    config.toolFilter === undefined ? createElement('span', { className: 'tag' }, dshT('工具不限制')) : null
  ))

  return createElement('div', { className: 'card', key: entry.id }, children)
}

/* ========================================================================== */
/*                                CLI backends                                */
/* ========================================================================== */

/** Draft shape for one CLI backend's editable config. */
/** @param {Record<string, any>|null} config - the stored backend config (null-safe). */
export function cliDraftFromConfig(config) {
  config = config || {}
  return {
    providerName: config.providerName !== undefined ? String(config.providerName) : '',
    permissionMode: config.permissionMode !== undefined ? String(config.permissionMode) : '',
    disposeGraceMs: config.disposeGraceMs !== undefined ? String(config.disposeGraceMs) : '3000',
    envPairs: Object.keys(config.env || {}).map(function (/** @type {string} */ key) {
      return { key: key, value: String(config.env[key]) }
    }),
  }
}

/** Convert a draft back into the wire config object. */
/** @param {Record<string, any>} draft */
export function cliConfigFromDraft(draft) {
  /** @type {Record<string, any>} */
  var config = {
    providerName: draft.providerName.trim(),
    permissionMode: draft.permissionMode,
    disposeGraceMs: Number(draft.disposeGraceMs.trim()),
    env: {},
  }
  draft.envPairs.forEach(function (/** @type {{ key: string, value: string }} */ pair) {
    var key = pair.key.trim()
    if (key !== '') config.env[key] = pair.value
  })
  return config
}

/** Shared env key/value pair editor (used by every CLI backend card). */
/** @param {Record<string, any>} props */
export function EnvPairsEditor(props) {
  var pairs = props.pairs || []
  return createElement('div', { className: 'fieldset' },
    createElement('span', { className: 'fieldset-legend' }, dshT('env（传给 CLI 子进程的额外环境变量）')),
    pairs.map(function (/** @type {{ key: string, value: string }} */ pair, /** @type {number} */ index) {
      return createElement('div', { className: 'env-row', key: index },
        createElement(UiInput, {
          value: pair.key,
          placeholder: dshT('变量名（如 OPENAI_API_KEY）'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { props.onPatchPair(index, { key: event.target.value }) },
        }),
        createElement(UiInput, {
          // 受控：宿主只投影掩码后的空值（write-only 契约），草稿值就是唯一
          // 真相——非受控 + key:index 的组合会在删除中间行时让 DOM 残留文本与
          // 底层草稿错位，保存写入与屏幕不符的值。
          value: pair.value,
          placeholder: dshT('变量值'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { props.onPatchPair(index, { value: event.target.value }) },
        }),
        createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function () { props.onRemove(index) } }, '✕'),
      )
    }),
    createElement(UiButton, { variant: 'primary', size: 'sm', onClick: props.onAdd }, dshT('＋ 添加变量')),
  )
}

/** One CLI backend card: collapsible status header + config form + mount/save/unmount. */
/** @param {Record<string, any>} props */
export function CliBackendCard(props) {
  var backend = props.backend
  var draft = props.draft
  var busy = props.busy === true
  var expanded = props.expanded === true
  var onPatch = props.onPatch
  var onPatchEnvPair = props.onPatchEnvPair
  var onAddEnvPair = props.onAddEnvPair
  var onRemoveEnvPair = props.onRemoveEnvPair
  var onToggle = props.onToggle
  var onSave = props.onSave
  var onInstall = props.onInstall
  var onUnmount = props.onUnmount

  var packageOk = !!(backend.providerPackage && backend.providerPackage.ok)
  var runner = backend.runner || { ok: false, version: null }
  var cli = backend.cli || { ok: false, version: null }
  var missingPackages = backend.missing || []
  var depsMissing = missingPackages.length > 0
  var missingLabel = missingPackages.join(' + ')
  var modeValue = backend.permissionModes.indexOf(draft.permissionMode) !== -1
    ? draft.permissionMode
    : backend.permissionModes[0]

  return createElement('div', { className: 'card', key: backend.id },
    createElement('div', { className: 'card-header' },
      createElement('button', {
        type: 'button', className: 'cli-toggle',
        'aria-expanded': expanded,
        'aria-label': expanded ? dshT('收起明细') : dshT('展开明细'),
        title: expanded ? dshT('收起明细') : dshT('展开明细'),
        onClick: onToggle,
      }, expanded ? '▾' : '▸'),
      createElement('span', { className: 'cli-title', onClick: onToggle }, '🔌 ' + backend.label),
      createElement('span', { className: 'cli-tags' },
        createElement('span', { className: 'tag ' + (backend.mounted ? 'live' : '') }, backend.mounted ? dshT('已挂载') : dshT('未挂载')),
        createElement('span', { className: 'tag ' + (packageOk ? 'live' : 'dead') },
          packageOk
            ? dshT('provider 包') + (backend.providerPackage.version ? ' v' + backend.providerPackage.version : ' ✓')
            : dshT('provider 包 ✗')),
        createElement('span', { className: 'tag ' + (runner.ok ? 'live' : 'warn') },
          runner.ok ? dshT('CLI 依赖 ✓') : dshT('CLI 依赖 ✗')),
        createElement('span', { className: 'tag ' + (cli.ok ? 'model' : 'warn') },
          cli.ok ? 'PATH ' + (cli.version || dshT('已安装')) : 'PATH ✗ ' + backend.cliCommand),
      ),
      createElement('span', { style: { display: 'flex', gap: '5px', flex: 'none' } },
        depsMissing
          ? createElement(UiButton, {
            variant: 'outline',
            size: 'sm',
            disabled: busy,
            title: dshT('npm install -g 全局安装缺失包：') + missingLabel,
            onClick: onInstall,
          }, busy ? createElement(Spinner, { key: 'spin' }) : null, busy ? dshT('安装中…') : dshT('安装依赖包'))
          : null,
        backend.mounted
          ? createElement(UiButton, { variant: 'primary', size: 'sm', disabled: busy, onClick: onSave },
            busy ? createElement(Spinner, { key: 'spin' }) : null, dshT('保存配置'))
          : packageOk
            ? createElement(UiButton, { variant: 'primary', size: 'sm', disabled: busy, onClick: onSave },
              busy ? createElement(Spinner, { key: 'spin' }) : null, dshT('挂载'))
            : null,
        backend.mounted
          ? createElement(ConfirmButton, { label: dshT('卸载'), confirmLabel: dshT('确认卸载？'), disabled: busy, onConfirm: onUnmount })
          : null,
      )
    ),
    expanded ? createElement('div', { className: 'cli-detail', key: 'detail' },
    createElement('div', { className: 'form-grid' },
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('providerName（执行后端注册名）')),
        createElement(UiInput, {
          value: draft.providerName,
          placeholder: dshT('如 codex / claude-code（子智能体表单的执行后端选项）'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ providerName: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('permissionMode（CLI 权限模式）')),
        createElement('select', {
          className: 'input', value: modeValue,
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ permissionMode: event.target.value }) },
        }, backend.permissionModes.map(function (/** @type {string} */ mode) {
          return createElement('option', { key: mode, value: mode }, mode)
        })),
        createElement('span', { className: 'field-hint' }, dshT('枚举来自该 provider 包的 Config schema'))
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('disposeGraceMs（进程树终止宽限，毫秒）')),
        createElement(UiInput, {
          value: draft.disposeGraceMs,
          placeholder: '3000',
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ disposeGraceMs: event.target.value }) },
        }),
      ),
    ),
    createElement(EnvPairsEditor, {
      pairs: draft.envPairs,
      onPatchPair: onPatchEnvPair,
      onAdd: onAddEnvPair,
      onRemove: onRemoveEnvPair,
    }),
    ) : null,
  )
}

/** Draft shape for one generic external-CLI backend's editable config. */
/** @param {Record<string, any>} backend - the mounted generic backend (null-safe). */
export function cliDraftFromGeneric(backend) {
  backend = backend || {}
  return {
    command: backend.command !== undefined ? String(backend.command) : '',
    argsText: Array.isArray(backend.args) ? backend.args.join(' ') : '{prompt}',
    providerName: backend.providerName !== undefined ? String(backend.providerName) : '',
    disposeGraceMs: backend.disposeGraceMs !== undefined ? String(backend.disposeGraceMs) : '3000',
    envPairs: Object.keys(backend.env || {}).map(function (/** @type {string} */ key) {
      return { key: key, value: String(backend.env[key]) }
    }),
  }
}

/** Convert a generic draft into the wire config object (args split on whitespace). */
/** @param {Record<string, any>} draft */
export function cliConfigFromGenericDraft(draft) {
  /** @type {Record<string, any>} */
  var config = {
    command: draft.command.trim(),
    args: draft.argsText.trim().split(/\s+/).filter(Boolean),
    providerName: draft.providerName.trim(),
    disposeGraceMs: Number(draft.disposeGraceMs.trim()),
    env: {},
  }
  draft.envPairs.forEach(function (/** @type {{ key: string, value: string }} */ pair) {
    var key = pair.key.trim()
    if (key !== '') config.env[key] = pair.value
  })
  return config
}

/** One generic external-CLI backend card (served by this plugin's command provider). */
/** @param {Record<string, any>} props */
export function GenericCliCard(props) {
  var backend = props.backend
  var draft = props.draft
  var busy = props.busy === true
  var expanded = props.expanded === true
  var onToggle = props.onToggle
  var onPatch = props.onPatch
  var onPatchEnvPair = props.onPatchEnvPair
  var onAddEnvPair = props.onAddEnvPair
  var onRemoveEnvPair = props.onRemoveEnvPair
  var onSave = props.onSave
  var onUnmount = props.onUnmount

  var cli = backend.cli || { ok: false, version: null }

  return createElement('div', { className: 'card', key: backend.id },
    createElement('div', { className: 'card-header' },
      createElement('button', {
        type: 'button', className: 'cli-toggle',
        'aria-expanded': expanded,
        'aria-label': expanded ? dshT('收起明细') : dshT('展开明细'),
        title: expanded ? dshT('收起明细') : dshT('展开明细'),
        onClick: onToggle,
      }, expanded ? '▾' : '▸'),
      createElement('span', { className: 'cli-title', onClick: onToggle }, '⌨️ ' + backend.command),
      createElement('span', { className: 'cli-tags' },
        createElement('span', { className: 'tag live' }, dshT('已挂载')),
        createElement('span', { className: 'tag ' + (backend.providerPresent ? 'live' : 'warn') },
          backend.providerPresent ? dshT('后端在线 ✓') : dshT('后端未注册')),
        createElement('span', { className: 'tag ' + (cli.ok ? 'model' : 'warn') },
          cli.ok ? 'PATH ' + (cli.version || dshT('已安装')) : 'PATH ✗ ' + backend.command),
      ),
      createElement('span', { style: { display: 'flex', gap: '5px', flex: 'none' } },
        createElement(UiButton, { variant: 'primary', size: 'sm', disabled: busy, onClick: onSave },
          busy ? createElement(Spinner, { key: 'spin' }) : null, dshT('保存配置')),
        createElement(ConfirmButton, { label: dshT('卸载'), confirmLabel: dshT('确认卸载？'), disabled: busy, onConfirm: onUnmount }),
      )
    ),
    expanded ? createElement('div', { className: 'cli-detail', key: 'detail' },
    createElement('div', { className: 'form-grid' },
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('command（PATH 命令名或绝对路径）')),
        createElement(UiInput, {
          value: draft.command,
          placeholder: dshT('如 gemini / qwen / C:\\tools\\aider.exe'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ command: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('providerName（执行后端注册名）')),
        createElement(UiInput, {
          value: draft.providerName,
          placeholder: dshT('如 cli-gemini（子智能体表单的执行后端选项）'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ providerName: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field full' },
        createElement('span', { className: 'field-label' }, dshT('args（空格分隔，{prompt} 占位提示词）')),
        createElement(UiInput, {
          value: draft.argsText,
          placeholder: '-p {prompt}',
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ argsText: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, dshT('one-shot 纯文本：stdout 即委托结果，非零退出记为失败；prompt 经 {prompt} 传入')),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('disposeGraceMs（进程树终止宽限，毫秒）')),
        createElement(UiInput, {
          value: draft.disposeGraceMs,
          placeholder: '3000',
          onChange: function (/** @type {{ target: { value: string } }} */ event) { onPatch({ disposeGraceMs: event.target.value }) },
        }),
      ),
    ),
    createElement(EnvPairsEditor, {
      pairs: draft.envPairs,
      onPatchPair: onPatchEnvPair,
      onAdd: onAddEnvPair,
      onRemove: onRemoveEnvPair,
    }),
    ) : null,
  )
}

/** @param {PanelCallProps & Record<string, any>} props */
export function CliPanel(props) {
  var call = props.call

  var viewState = useState({ loading: true, error: null, data: null })
  var view = viewState[0]
  var setView = viewState[1]

  var draftsState = useState({})
  var drafts = draftsState[0]
  var setDrafts = draftsState[1]

  var busyState = useState({})
  var busy = busyState[0]
  var setBusy = busyState[1]

  var customCommandState = useState('')
  var customCommand = customCommandState[0]
  var setCustomCommand = customCommandState[1]

  var expandedState = useState({})
  var expanded = expandedState[0]
  var setExpanded = expandedState[1]

  var toggleExpanded = function (/** @type {string} */ backendId) {
    setExpanded(function (/** @type {any} */ prev) {
      var next = Object.assign({}, prev)
      next[backendId] = prev[backendId] !== true
      return next
    })
  }

  // Busy flags ride functional updates too: a closure snapshot would drop a
  // flag set by an in-flight sibling request (two cards saved back-to-back),
  // re-enabling the first button mid-request. Failure paths clear ONLY the
  // key they own — `setBusy({})` would release every in-flight marker.
  var markBusy = function (/** @type {string} */ key) {
    setBusy(function (/** @type {any} */ prev) {
      if (prev[key] === true) return prev
      var next = Object.assign({}, prev)
      next[key] = true
      return next
    })
  }
  var clearBusy = function (/** @type {string} */ key) {
    setBusy(function (/** @type {any} */ prev) {
      if (prev[key] !== true) return prev
      var next = Object.assign({}, prev)
      delete next[key]
      return next
    })
  }

  var toastState = useState(null)
  var toast = toastState[0]
  var setToast = toastState[1]

  useEffect(function () {
    if (!toast) return undefined
    var timer = setTimeout(function () { setToast(null) }, 4200)
    return function () { clearTimeout(timer) }
  }, [toast])

  /** Adopt a detection payload: view data + reset drafts to the served configs. */
  var absorb = function (/** @type {Record<string, any>} */ result) {
    setView({ loading: false, error: null, data: result })
    /** @type {Record<string, any>} */
    var next = {}
    ;(result.backends || []).forEach(function (/** @type {Record<string, any>} */ backend) {
      next[backend.id] = backend.kind === 'generic'
        ? cliDraftFromGeneric(backend)
        : cliDraftFromConfig(backend.config)
    })
    setDrafts(next)
    setBusy({})
  }
  /** Refresh the list only: a save/uninstall on one card must not reset the
      drafts another card is editing or release its in-flight busy marker —
      the full reset above belongs to (re)loads alone. */
  var adopt = function (/** @type {Record<string, any>} */ result) {
    setView({ loading: false, error: null, data: result })
  }

  var reload = function () {
    setView(function (/** @type {any} */ prev) { return Object.assign({}, prev, { loading: true, error: null }) })
    call('subagentAdmin/cliList', {}).then(function (/** @type {any} */ raw) {
      absorb(unwrap(raw))
    }).catch(function (/** @type {any} */ error) {
      setView({ loading: false, error: String((error && error.message) || error), data: null })
    })
  }
  useEffect(reload, [])

  var patchDraft = function (/** @type {string} */ backendId, /** @type {Record<string, any>} */ patch) {
    setDrafts(function (/** @type {any} */ prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, patch)
      return next
    })
  }

  // Env-pair edits derive from the latest queued state (functional update), so
  // rapid consecutive edits can never overwrite each other via stale drafts.
  var patchEnvPair = function (/** @type {string} */ backendId, /** @type {number} */ index, /** @type {Record<string, any>} */ patch) {
    setDrafts(function (/** @type {any} */ prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var pairs = (current.envPairs || []).map(function (/** @type {{ key: string, value: string }} */ pair, /** @type {number} */ i) {
        return i === index ? Object.assign({}, pair, patch) : pair
      })
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: pairs })
      return next
    })
  }
  var addEnvPair = function (/** @type {string} */ backendId) {
    setDrafts(function (/** @type {any} */ prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: (current.envPairs || []).concat([{ key: '', value: '' }]) })
      return next
    })
  }
  var removeEnvPair = function (/** @type {string} */ backendId, /** @type {number} */ index) {
    setDrafts(function (/** @type {any} */ prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: (current.envPairs || []).filter(function (/** @type {any} */ _, /** @type {number} */ i) { return i !== index }) })
      return next
    })
  }

  var runUpsert = function (/** @type {Record<string, any>} */ backend) {
    if (busy[backend.id]) return
    var draft = drafts[backend.id]
    if (!draft) return
    var payload
    if (backend.kind === 'generic') {
      if (!/^[^\s]+$/.test(draft.command.trim())) {
        setToast(dshT('command 不能包含空格（PATH 命令名或绝对路径）'))
        return
      }
      var args = draft.argsText.trim().split(/\s+/).filter(Boolean)
      if (args.length === 0 || args.length > 20 || !args.every(function (/** @type {string} */ arg) { return arg.length <= 256 })) {
        setToast(dshT('args 必须是 1-20 个非空片段（单条 ≤ 256 字符），用 {prompt} 占位提示词'))
        return
      }
      if (args.indexOf('{prompt}') === -1) {
        setToast(dshT('args 必须包含 {prompt} 占位符（提示词将替换该占位符传入 CLI）'))
        return
      }
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(draft.providerName.trim())) {
        setToast(dshT('providerName 必须是 1-48 位小写字母/数字/下划线/中划线且字母开头'))
        return
      }
      if (!/^\d+$/.test(draft.disposeGraceMs.trim())) {
        setToast(dshT('disposeGraceMs 必须是非负整数（毫秒）'))
        return
      }
      payload = { kind: 'generic', backendId: backend.id, config: cliConfigFromGenericDraft(draft) }
    } else {
      if (!/^[a-z][a-z0-9_-]{0,47}$/.test(draft.providerName.trim())) {
        setToast(dshT('providerName 必须是 1-48 位小写字母/数字/下划线/中划线且字母开头'))
        return
      }
      if (!/^\d+$/.test(draft.disposeGraceMs.trim())) {
        setToast(dshT('disposeGraceMs 必须是非负整数（毫秒）'))
        return
      }
      payload = { backendId: backend.id, config: cliConfigFromDraft(draft) }
    }
    var busyKey = backend.id
    markBusy(busyKey)
    call('subagentAdmin/cliUpsert', { payload: payload }).then(function (/** @type {any} */ raw) {
      adopt(unwrap(raw))
      clearBusy(busyKey)
    }).catch(function (/** @type {any} */ error) {
      clearBusy(busyKey)
      setToast(dshT('保存失败：') + String((error && error.message) || error))
    })
  }

  var runUnmount = function (/** @type {Record<string, any>} */ backend) {
    if (busy[backend.id]) return
    markBusy(backend.id)
    // Generic backends are recognized server-side by their "cli-" id prefix.
    call('subagentAdmin/cliRemove', { id: backend.id }).then(function (/** @type {any} */ raw) {
      adopt(unwrap(raw))
      clearBusy(backend.id)
    }).catch(function (/** @type {any} */ error) {
      clearBusy(backend.id)
      setToast(dshT('卸载失败：') + String((error && error.message) || error))
    })
  }

  var runInstall = function (/** @type {Record<string, any>} */ backend) {
    if (busy[backend.id]) return
    markBusy(backend.id)
    call('subagentAdmin/cliInstall', { backendId: backend.id }).then(function (/** @type {any} */ raw) {
      var result = unwrap(raw)
      adopt(result)
      clearBusy(backend.id)
      setToast((result && result.output ? result.output : dshT('依赖包安装完成')) + dshT('，已重新检测'))
    }).catch(function (/** @type {any} */ error) {
      var message = String((error && error.message) || error)
      if (message.indexOf('404') !== -1) {
        message += dshT('（宿主端未注册该接口：请重启 dsh 加载最新插件后重试）')
      }
      clearBusy(backend.id)
      setToast(dshT('安装失败：') + message)
    })
  }

  var runGenericMount = function (/** @type {string} */ command) {
    if (!/^[^\s]+$/.test(command)) {
      setToast(dshT('command 不能包含空格（PATH 命令名或绝对路径）'))
      return
    }
    markBusy('__scan__')
    call('subagentAdmin/cliUpsert', { payload: { kind: 'generic', config: { command: command } } }).then(function (/** @type {any} */ raw) {
      adopt(unwrap(raw))
      clearBusy('__scan__')
      setCustomCommand('')
    }).catch(function (/** @type {any} */ error) {
      clearBusy('__scan__')
      setToast(dshT('挂载失败：') + String((error && error.message) || error))
    })
  }

  var children = []

  // 本机 CLI card sits on top: scan list + custom command + refresh; the
  // builtin codex/claude-code cards and mounted generic cards follow below.
  var backends = (view.data && view.data.backends) || []
  var others = (view.data && view.data.others) || []
  var busyAny = Object.keys(busy).some(function (/** @type {string} */ key) { return busy[key] === true })
  var genericBackends = backends.filter(function (/** @type {Record<string, any>} */ backend) { return backend.kind === 'generic' })

  children.push(createElement('div', { className: 'card', key: 'local-cli' },
    createElement('div', { className: 'card-header' },
      createElement('span', { className: 'card-title' }, dshT('🛰️ 本机 CLI')),
      createElement('span', { className: 'tag' }, dshT('通用命令行后端 · one-shot 纯文本')),
      createElement('span', { style: { marginLeft: 'auto', display: 'flex' } },
        createElement(UiButton, { variant: 'outline', size: 'sm', onClick: reload, disabled: view.loading },
          view.loading ? createElement(Spinner, { key: 'spin' }) : '⟳', dshT('重新检测'))
      )
    ),
    createElement('div', { className: 'cli-scan-hint' },
      dshT('检测并挂载 harness 内置的外部 CLI 后端（codex / claude-code）与本机其他命令行工具；挂载后即可在「子智能体」表单的执行后端下拉中选用。')),
    createElement('div', { className: 'cli-scan-list' },
      createElement('div', { className: 'cli-scan-row', key: 'custom' },
        createElement(UiInput, {
          value: customCommand,
          placeholder: dshT('添加自定义 CLI：输入命令名或绝对路径，如 aider（挂载为 one-shot 后端）'),
          onChange: function (/** @type {{ target: { value: string } }} */ event) { setCustomCommand(event.target.value) },
        }),
        createElement(UiButton, {
          variant: 'outline',
          size: 'sm',
          disabled: busyAny || customCommand.trim() === '',
          onClick: function () { runGenericMount(customCommand.trim()) },
        }, dshT('挂载')),
      ),
      (function () {
        var mountedCommands = new Set(genericBackends.map(function (/** @type {Record<string, any>} */ backend) {
          return backend.command.toLowerCase()
        }))
        return others
          .filter(function (/** @type {Record<string, any>} */ item) { return !!(item.cli && item.cli.ok) })
          .filter(function (/** @type {Record<string, any>} */ item) { return !mountedCommands.has(item.name.toLowerCase()) })
          .map(function (/** @type {Record<string, any>} */ item) {
            return createElement('div', { className: 'cli-scan-card', key: item.name },
              createElement('span', { className: 'cli-title' }, '⌨️ ' + item.name),
              createElement('span', { className: 'cli-tags' },
                createElement('span', { className: 'tag' }, dshT('未挂载')),
                createElement('span', { className: 'tag live' }, 'PATH ' + (item.cli.version || dshT('已安装'))),
              ),
              createElement(UiButton, {
                variant: 'outline',
                size: 'sm', disabled: busyAny,
                onClick: function () { runGenericMount(item.name) },
              }, dshT('挂载')),
            )
          })
      })(),
      others.length > 0 && others.every(function (/** @type {Record<string, any>} */ item) { return !(item.cli && item.cli.ok) })
        ? createElement('span', { className: 'tag', key: 'none' }, dshT('未检测到其他 agent CLI'))
        : null,
    ),
  ))

  if (view.error) {
    children.push(createElement('div', { className: 'error-strip', key: 'error' }, dshT('⚠️ 加载失败：'), view.error))
  } else {
    genericBackends.forEach(function (/** @type {Record<string, any>} */ backend) {
      children.push(GenericCliCard({
        backend: backend,
        draft: drafts[backend.id] || cliDraftFromGeneric(backend),
        busy: busy[backend.id] === true,
        expanded: expanded[backend.id] === true,
        onToggle: function () { toggleExpanded(backend.id) },
        onPatch: function (/** @type {Record<string, any>} */ patch) { patchDraft(backend.id, patch) },
        onPatchEnvPair: function (/** @type {number} */ index, /** @type {Record<string, any>} */ patch) { patchEnvPair(backend.id, index, patch) },
        onAddEnvPair: function () { addEnvPair(backend.id) },
        onRemoveEnvPair: function (/** @type {number} */ index) { removeEnvPair(backend.id, index) },
        onSave: function () { runUpsert(backend) },
        onUnmount: function () { runUnmount(backend) },
      }))
    })
    backends.filter(function (/** @type {Record<string, any>} */ backend) { return backend.kind !== 'generic' }).forEach(function (/** @type {Record<string, any>} */ backend) {
      children.push(CliBackendCard({
        backend: backend,
        draft: drafts[backend.id] || cliDraftFromConfig(backend.config),
        busy: busy[backend.id] === true,
        expanded: expanded[backend.id] === true,
        onToggle: function () { toggleExpanded(backend.id) },
        onPatch: function (/** @type {Record<string, any>} */ patch) { patchDraft(backend.id, patch) },
        onPatchEnvPair: function (/** @type {number} */ index, /** @type {Record<string, any>} */ patch) { patchEnvPair(backend.id, index, patch) },
        onAddEnvPair: function () { addEnvPair(backend.id) },
        onRemoveEnvPair: function (/** @type {number} */ index) { removeEnvPair(backend.id, index) },
        onSave: function () { runUpsert(backend) },
        onInstall: function () { runInstall(backend) },
        onUnmount: function () { runUnmount(backend) },
      }))
    })
  }

  return createElement('div', null,
    toast ? createElement('div', { className: 'toast' }, toast) : null,
    children
  )
}

/* ========================================================================== */
/*                              Section entrypoint                            */
/* ========================================================================== */

/** @param {PanelCallProps & Record<string, any>} props */
export function SubagentAdminSection(props) {
  // Two tabs only (v1.24.0): the 运行中 live-children view is gone — dsh's own
  // subagent surfaces cover live children — and the 变更记录 journal view is
  // gone with it; what remains is the instance manager plus the CLI backends.
  var tabState = useState('subagents')
  var activeTab = tabState[0]
  var setActiveTab = tabState[1]
  var tabs = [
    { id: 'subagents', label: dshT('子智能体'), component: SubagentsPanel },
    { id: 'cli', label: dshT('CLI 后端'), component: CliPanel },
  ]
  var selected = tabs.find(function (tab) { return tab.id === activeTab }) || tabs[0]

  return createElement('div', { 'data-dsh-sa-section': '' },
    createElement('div', { className: 'tabs', role: 'tablist', 'aria-label': dshT('子智能体管理'),
      onKeyDown: function (/** @type {KeyboardEvent} */ event) { tabKeyDown(event, tabs, selected.id, setActiveTab) } },
      tabs.map(function (tab) {
        return createElement('button', {
          type: 'button', key: tab.id,
          className: 'tab' + (tab.id === selected.id ? ' active' : ''),
          role: 'tab', id: 'dsh-admin-tab-' + tab.id,
          'aria-controls': 'dsh-admin-panel-' + tab.id,
          tabIndex: tab.id === selected.id ? 0 : -1,
          'aria-selected': tab.id === selected.id,
          onClick: function () { setActiveTab(tab.id) },
        }, tab.label)
      })
    ),
    createElement('div', { key: selected.id, role: 'tabpanel', id: 'dsh-admin-panel-' + selected.id, 'aria-labelledby': 'dsh-admin-tab-' + selected.id },
      createElement(selected.component, { call: props.call })
    )
  )
}
