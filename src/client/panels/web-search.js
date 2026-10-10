/** web-search — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiInput, createElement, dshT, messageOf, sectionState, useRef } from './context.js'

/**
 * The renderer-bound props every admin section receives. `call` is the
 * panel's ONLY RPC boundary (injected by the slot's inject face — see
 * src/client/impl.js) and its result envelope is duck-typed per method
 * (`{ ok: true, value }` / `{ ok: false, error }`), so the resolved type
 * stays `any` by design: a boundary, not unmodelled data.
 * @typedef {{ call: (method: string, args: Record<string, any>) => Promise<any> }} PanelSectionProps
 */

/**
 * Web search provider administration settings section.
 *
 * Surfaces dsh's three web-search providers (DeepSeek native / Exa /
 * Perplexity) as a radio-card picker. The active selection lives in the
 * profile-layer `cordis.patch.yml` under the `web` row's
 * `config.searchProvider` — the panel mutates that single key in place,
 * then can `📦 安装 exa` / `📦 安装 perplexity` to append the matching
 * cordis row + npm dependency. Installed state is probed against the
 * profile's `node_modules`. The shipped default (`deepseek-official`) is
 * marked bundled and refuses uninstall.
 *
 * Every card also carries a `⚙ 配置` editor over the provider package's own
 * Config keys. dsh's 插件配置 page only renders cards for plugins that
 * register a settings namespace — DeepSeek does, Exa and Perplexity do NOT —
 * so without this editor an installed provider could never be configured
 * from the browser at all. The host decides where a save lands: the
 * provider's settings section when it has one (live), otherwise its
 * `cordis.patch.yml` row (restart required). Secret fields are write-only and
 * can only be cleared through the explicit 清除 toggle.
 *
 * Restart dsh after a pick / install / uninstall; a settings-backed config
 * change applies immediately.
 * @param {PanelSectionProps} props - the renderer-bound props; `call` arrives from the slot inject face.
 */
export function WebSearchSection(props) {
  var call = props.call
  var kit = sectionState({
    providers: [],
    active: null,
    busy: false,
    error: '',
    busyId: '',
    // 配置编辑器：configOpen 是展开的 provider id；draft 是暂存的字段值；
    // cleared 是待删除的键（密钥必须显式点「清除」，空输入永远不会清空有效 key）。
    configOpen: '',
    config: null,
    configBusy: false,
    configError: '',
    configNote: '',
    draft: {},
    cleared: {},
  })
  var state = kit.state
  var setState = kit.set
  var alive = kit.alive
  // Identity of the newest config() request: a late answer for a provider the
  // user already collapsed must not populate the editor.
  var configRequest = useRef('')

  /**
   * Merge a partial state patch into the section state.
   * @param {Record<string, any>} partial - the keys to overwrite.
   */
  function patch(partial) {
    kit.patch(partial)
  }

  function reload() {
    patch({ busy: true, error: '' })
    call('webSearchAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var v = result.value || {}
        patch({
          busy: false,
          providers: Array.isArray(v.providers) ? v.providers : [],
          active: v.active === null || v.active === undefined ? null : v.active,
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

  // 一次只允许一个列表变更（select / install / uninstall）在途：动作未决时忽略
  // 新的点击。这样迟到的应答不可能清掉新动作的 busy 态、也不可能把 `active`
  // 盖回旧快照—— 与 sessions/mcp 面板的序列号守卫等价（这里入口统一被挡住，
  // 乱序根本没有入口）。
  var listActionBusy = useRef(false)

  /**
   * Point the profile's `web` row at one provider (applied on restart).
   * @param {string} id - the provider id from the list() row.
   */
  function selectProvider(id) {
    if (state.active !== null && state.active.searchProvider === id) return
    if (listActionBusy.current) return
    listActionBusy.current = true
    patch({ busyId: id, error: '' })
    call('webSearchAdmin/setActive', { providerId: id }).then(function (result) {
      listActionBusy.current = false
      if (!alive.current) return
      if (result.ok) {
        patch({ busyId: '', active: result.value || { searchProvider: id } })
      } else {
        patch({ busyId: '', error: dshT('切换失败：') + messageOf(result.error) })
      }
    }, function (err) {
      listActionBusy.current = false
      if (!alive.current) return
      patch({ busyId: '', error: dshT('切换失败：') + messageOf(err) })
    })
  }

  /**
   * Install one provider: appends its cordis row + npm dependency.
   * @param {string} id - the provider id from the list() row.
   */
  function installProvider(id) {
    if (listActionBusy.current) return
    listActionBusy.current = true
    patch({ busyId: id, error: '' })
    call('webSearchAdmin/install', { providerId: id }).then(function (result) {
      listActionBusy.current = false
      if (!alive.current) return
      if (result.ok) {
        patch({ busyId: '' })
        reload()
      } else {
        patch({ busyId: '', error: dshT('安装失败：') + messageOf(result.error) })
      }
    }, function (err) {
      listActionBusy.current = false
      if (!alive.current) return
      patch({ busyId: '', error: dshT('安装失败：') + messageOf(err) })
    })
  }

  /**
   * Uninstall one provider: removes its cordis row + npm dependency.
   * @param {string} id - the provider id from the list() row.
   */
  function uninstallProvider(id) {
    if (listActionBusy.current) return
    listActionBusy.current = true
    patch({ busyId: id, error: '' })
    call('webSearchAdmin/uninstall', { providerId: id }).then(function (result) {
      listActionBusy.current = false
      if (!alive.current) return
      if (result.ok) {
        patch({ busyId: '' })
        reload()
      } else {
        patch({ busyId: '', error: dshT('卸载失败：') + messageOf(result.error) })
      }
    }, function (err) {
      listActionBusy.current = false
      if (!alive.current) return
      patch({ busyId: '', error: dshT('卸载失败：') + messageOf(err) })
    })
  }

  // ---------- Provider configuration ----------

  /** Fetch one provider's editable configuration into the open editor.
   * @param {string} id - the provider id whose config to read. */
  function loadConfig(id) {
    configRequest.current = id
    // Note: the save-confirmation note is NOT cleared here — a save reloads the
    // editor through this path, and wiping it would eat its own success message.
    patch({ configBusy: true, configError: '' })
    call('webSearchAdmin/config', { providerId: id }).then(function (result) {
      if (!alive.current || configRequest.current !== id) return
      if (!result.ok) {
        patch({ configBusy: false, configError: dshT('读取配置失败：') + messageOf(result.error) })
        return
      }
      var view = result.value || {}
      var fields = Array.isArray(view.fields) ? view.fields : []
      /** @type {Record<string, string>} */
      var draft = {}
      for (var i = 0; i < fields.length; i++) {
        // Only EXPLICITLY set values are staged. An inherited default stays
        // in the placeholder, so a plain save never pins a default the user
        // never touched (and never restates a secret the browser never saw).
        var field = fields[i]
        draft[field.key] = field.set === true && field.kind !== 'secret' && field.value !== '' && field.value !== null
          ? String(field.value)
          : ''
      }
      patch({ configBusy: false, config: view, draft: draft, cleared: {}, configError: '' })
    }, function (err) {
      if (!alive.current || configRequest.current !== id) return
      patch({ configBusy: false, configError: dshT('读取配置失败：') + messageOf(err) })
    })
  }

  /** Open one provider's editor (loading its config) or close the open one.
   * @param {string} id - the provider id whose editor to open / close. */
  function toggleConfig(id) {
    if (state.configOpen === id) {
      configRequest.current = ''
      patch({ configOpen: '', config: null, configBusy: false, configError: '', configNote: '', draft: {}, cleared: {} })
      return
    }
    configRequest.current = id
    patch({ configOpen: id, config: null, configBusy: true, configError: '', configNote: '', draft: {}, cleared: {} })
    loadConfig(id)
  }

  /** Stage one field edit (per-key map; a plain merge cannot express it).
   * @param {string} key - the config field key.
   * @param {string} value - the staged input value ('' when cleared). */
  function setDraftField(key, value) {
    /** @type {Record<string, string>} */
    var next = {}
    for (var existing in state.draft) next[existing] = state.draft[existing]
    next[key] = value
    patch({ draft: next })
  }

  /** Toggle the pending removal of one key (secrets need an explicit click).
   * @param {string} key - the config field key to toggle. */
  function toggleClear(key) {
    /** @type {Record<string, boolean>} */
    var next = {}
    for (var existing in state.cleared) next[existing] = state.cleared[existing]
    next[key] = state.cleared[key] !== true
    patch({ cleared: next })
  }

  /**
   * Save the open editor. Non-secret fields left empty that were previously
   * set are removed; secret fields are only ever written when filled in, and
   * only ever removed through the explicit 清除 toggle — so an untouched key
   * field can never wipe a working API key.
   * @param {string} id - the provider id whose editor is open.
   */
  function saveProviderConfig(id) {
    var view = state.config
    if (view === null) return
    var fields = Array.isArray(view.fields) ? view.fields : []
    /** @type {Record<string, string|number>} */
    var values = {}
    var unset = []
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i]
      var staged = state.draft[field.key] === undefined || state.draft[field.key] === null ? '' : String(state.draft[field.key]).trim()
      if (field.kind === 'secret') {
        if (state.cleared[field.key] === true) unset.push(field.key)
        else if (staged !== '') values[field.key] = staged
        continue
      }
      if (staged !== '') values[field.key] = field.kind === 'number' ? Number(staged) : staged
      else if (field.set === true) unset.push(field.key)
    }
    patch({ configBusy: true, configError: '', configNote: '' })
    call('webSearchAdmin/saveConfig', {
      providerId: id, values: values, unset: unset, expectedRevision: view.revision,
    }).then(function (result) {
      if (!alive.current) return
      if (!result.ok) {
        patch({ configBusy: false, configError: dshT('保存失败：') + messageOf(result.error) })
        return
      }
      var saved = result.value || {}
      patch({
        configBusy: false,
        configNote: saved.restartRequired === true
          ? dshT('✅ 已写入 ') + (saved.source === 'settings' ? 'settings' : 'cordis.patch.yml') + dshT(' — 重启 dsh 后生效')
          : dshT('✅ 已保存（即时生效）'),
      })
      loadConfig(id)
    }, function (err) {
      if (!alive.current) return
      patch({ configBusy: false, configError: dshT('保存失败：') + messageOf(err) })
    })
  }

  // ---------- Render ----------
  var elements = []
  elements.push(createElement('div', { className: 'hint', key: 'restart-banner',
    style: { background: 'var(--dsw-alias-bg-layer-2)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4))' } },
    // 纯文本渲染（本面板无 markdown 层）：不写 ** 标记，星号会以字面出现。
    dshT('🔁 切换 provider / 安装 / 卸载 后需重启 dsh 生效；⚙ 配置里带 settings 命名空间的 provider 保存后即时生效，写 cordis 行的需重启'),
  ))
  if (state.busy) {
    elements.push(createElement('div', { className: 'busy-banner', key: 'busy' },
      createElement('span', { className: 'spinner', key: 'sp' }), dshT('加载中…')))
  }
  if (state.error !== '') {
    elements.push(createElement('div', { className: 'error', key: 'err' }, state.error))
  }

  var activeId = state.active === null ? null : state.active.searchProvider
  for (let i = 0; i < state.providers.length; i++) {
    // Block-scoped on purpose: a shared `var` binding made every install /
    // uninstall / radio handler act on the LAST provider.
    const p = state.providers[i]
    // Live selection, not the list() snapshot: a setActive answer already
    // carries the new pair, and re-listing would briefly disagree with it.
    var isActive = activeId === p.id
    var isInstalled = p.installed
    var isBundled = p.bundled
    var isBusy = state.busyId === p.id
    var envClass = isInstalled ? 'tag plugin' : 'tag'

    var radioChildren = [
      createElement('label', { key: 'radio-row', style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } },
        createElement('input', {
          type: 'radio',
          name: 'web-search-provider',
          value: p.id,
          checked: isActive,
          disabled: !isInstalled || isBusy,
          onChange: function () { selectProvider(p.id) },
          key: 'radio',
        }),
        createElement('span', { style: { fontWeight: 600 }, key: 'name' }, p.label),
        isBundled
          ? createElement('span', { className: 'tag', key: 'bundled', title: dshT('dsh 默认 provider，无法从此面板卸载') }, dshT('🛡 dsh 默认'))
          : null,
        createElement('span', { className: envClass, key: 'env', title: dshT('provider 通过此环境变量读取 API key（launch env, 不存 plugin）') }, '🔑 ' + p.envVar),
      ),
    ]
    var subChildren = [
      createElement('div', { key: 'pkg', className: 'card-sub', style: { fontFamily: 'monospace', fontSize: '11px' } }, p.packageName),
      isInstalled
        ? null
        : createElement('div', { key: 'not-installed', className: 'card-sub', style: { color: 'var(--dsw-alias-label-secondary, #61666b)', borderLeft: '2px solid #b45309', paddingLeft: '6px' } },
          dshT('📦 此 provider 未安装 — 需要点「📥 安装」按钮调 `pnpm add` 把 npm 包加进 profile')),
    ]

    var actionChildren = []
    if (!isInstalled && !isBundled) {
      actionChildren.push(createElement(UiButton, {
        variant: 'primary',
        size: 'sm', key: 'install',
        disabled: isBusy, onClick: function () { installProvider(p.id) },
      }, isBusy ? dshT('安装中…') : dshT('📥 安装')))
    }
    if (isInstalled && !isBundled) {
      actionChildren.push(createElement(UiButton, {
        variant: 'outline',
        size: 'sm',
        className: 'danger', key: 'uninstall',
        disabled: isBusy, onClick: function () { uninstallProvider(p.id) },
      }, isBusy ? dshT('卸载中…') : dshT('🗑 卸载')))
    }

    // Every provider — bundled, installed or not — exposes its own Config
    // keys here: install/uninstall only moves the mount row, while this is
    // what makes an installed provider actually usable.
    actionChildren.push(createElement(UiButton, {
      variant: 'outline',
      size: 'sm', key: 'config',
      'aria-expanded': state.configOpen === p.id ? 'true' : 'false',
      title: dshT('编辑该 provider 的 Config（Endpoint / 模型 / API Key …）'),
      onClick: function () { toggleConfig(p.id) },
    }, state.configOpen === p.id ? dshT('⚙ 收起配置') : dshT('⚙ 配置')))
    // The staged configuration editor rides the card body when open; it is
    // built from the webSearchAdmin/config payload (field descriptors +
    // storage note) so the panel never guesses at a provider's keys.
    var cardBody = subChildren.slice()
    if (state.configOpen === p.id) {
      cardBody.push(buildProviderConfigElement(p, state, {
        setField: setDraftField,
        toggleClear: toggleClear,
        save: function () { saveProviderConfig(p.id) },
      }))
    }

    elements.push(createElement('div', {
      className: 'card',
      key: 'ws-' + p.id,
      style: { borderColor: isActive ? 'var(--dsw-alias-border-strong, rgba(120,120,200,0.6))' : undefined },
    },
      createElement('div', { className: 'card-header', key: 'h' },
        createElement('span', { className: 'card-title', key: 'title-row' }, radioChildren),
        actionChildren.length > 0 ? createElement('span', { className: 'card-actions', key: 'a' }, actionChildren) : null,
      ),
      cardBody.length > 0 ? createElement('div', { key: 'body' }, cardBody) : null,
    ))
  }

  if (state.providers.length === 0 && !state.busy) {
    elements.push(createElement('div', { className: 'empty', key: 'empty' }, dshT('加载 provider 列表失败 — 检查 dsh 是否在运行')))
  }

  return createElement('div', { 'data-dsh-admin-section': '' }, elements)
}

/**
 * One editable Config key of a provider, as projected by the host
 * (`webSearchAdmin/config` → projectConfigFields): the panel renders
 * exactly the keys the provider package declares. Secret fields project
 * an empty `value` — the stored secret never crosses the RPC boundary —
 * with `set` carrying the only signal.
 * @typedef {{
 * key: string,
 * label: string,
 * kind: string,
 * value: any,
 * set: boolean,
 * default?: any,
 * choices?: string[],
 * hint?: string,
 * }} ConfigField
 */
/**
 * One provider's configuration read (`webSearchAdmin/config`): where a
 * save lands (`source`: 'settings' = the provider's settings namespace,
 * anything else = its cordis.patch.yml row), the revision guard the save
 * must carry, and the projected field descriptors.
 * @typedef {{
 * namespace: string,
 * source: string,
 * revision: number|null,
 * restartRequired: boolean,
 * fields: ConfigField[],
 * note: string,
 * }} ProviderConfigView
 */
/**
 * The staged-editor surface `renderProviderConfig` drives: the per-key
 * draft / cleared maps, the busy / error / note flags, and the three
 * handlers the card loop threads in.
 * @typedef {{
 * draft: Record<string, string>,
 * cleared: Record<string, boolean>,
 * busy: boolean,
 * configError: string,
 * note: string,
 * setField: (key: string, value: string) => void,
 * toggleClear: (key: string) => void,
 * save: () => void,
 * }} ConfigEditorUi
 */

/**
 * One provider's staged configuration form. Field descriptors come from the
 * host (`webSearchAdmin/config`), so the panel renders exactly the keys the
 * provider package's Config declares — with its enum choices, its minimums
 * and its defaults. Secret fields are write-only and can only be removed
 * through the explicit 清除 toggle.
 * @param {ProviderConfigView} view - the config read: { namespace, source, revision, restartRequired, fields, note }.
 * @param {ConfigEditorUi} ui - the editor surface: { draft, cleared, busy, configError, note, setField, toggleClear, save }.
 */
export function renderProviderConfig(view, ui) {
  var fields = Array.isArray(view.fields) ? view.fields : []
  var rows = []
  for (let i = 0; i < fields.length; i++) {
    // Block-scoped on purpose: a shared `var` binding would make every
    // onChange act on the LAST field in the form.
    const field = fields[i]
    const staged = ui.draft[field.key] === undefined || ui.draft[field.key] === null ? '' : String(ui.draft[field.key])
    const choices = Array.isArray(field.choices) ? field.choices : []
    var input
    if (field.kind === 'enum') {
      var options = [createElement('option', { key: '__inherit', value: '' },
        dshT('继承默认') + (field.default === null || field.default === undefined ? '' : dshT('（') + field.default + dshT('）')))]
      for (var c = 0; c < choices.length; c++) {
        options.push(createElement('option', { key: choices[c], value: choices[c] }, choices[c]))
      }
      input = createElement('select', {
        className: 'input', key: 'input', value: staged, disabled: ui.busy,
        'aria-label': field.label,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ui.setField(field.key, e.target.value) },
      }, options)
    } else {
      var placeholder = field.kind === 'secret'
        ? (field.set === true ? dshT('已配置 — 留空不修改') : dshT('未配置 — 留空则回退到凭据 / 环境变量'))
        : (field.default === null || field.default === undefined ? dshT('留空 = 继承 provider 默认值') : dshT('继承默认：') + field.default)
      input = createElement(UiInput, {
        type: field.kind === 'secret' ? 'password' : (field.kind === 'number' ? 'number' : 'text'),
        value: staged, placeholder: placeholder, disabled: ui.busy, 'aria-label': field.label,
        onChange: function (/** @type {{ target: { value: string } }} */ e) { ui.setField(field.key, e.target.value) },
      })
    }
    rows.push(createElement('div', {
      key: 'field-' + field.key,
      style: {
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 200px) 1fr auto auto',
        gap: '4px 10px',
        alignItems: 'center',
      },
    },
      createElement('span', { style: { fontSize: '12px', fontWeight: 600, wordBreak: 'break-all' } }, field.label),
      input,
      field.kind === 'secret'
        ? createElement(UiButton, {
          variant: 'outline',
          size: 'sm', key: 'clear',
          disabled: ui.busy || field.set !== true,
          title: field.set === true ? dshT('删除已存的密钥值') : dshT('当前没有可删除的密钥值'),
          onClick: function () { ui.toggleClear(field.key) },
        }, ui.cleared[field.key] === true ? dshT('↺ 撤销') : dshT('清除'))
        : null,
      field.set === true ? createElement('span', { className: 'tag live', key: 'set' }, dshT('已设置')) : null,
      field.hint ? createElement('div', {
        style: { gridColumn: '2 / -1', fontSize: '11px', lineHeight: 1.4, color: 'var(--dsw-alias-label-secondary, #61666b)' },
      }, field.hint) : null,
    ))
  }
  return createElement('div', {
    key: 'config',
    style: { borderTop: '1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.4))', marginTop: '8px', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' },
  },
    createElement('div', { className: 'hint', key: 'storage', style: { fontSize: '11px' } },
      (view.source === 'settings' ? dshT('🗄 存储：dsh settings 命名空间 `') : dshT('🗄 存储：cordis.patch.yml 行 `')) + view.namespace + '`'
      + (view.restartRequired === true ? dshT(' · 保存后需重启 dsh 生效') : dshT(' · 保存后即时生效'))),
    ui.configError !== '' ? createElement('div', { className: 'error', key: 'err' }, ui.configError) : null,
    ui.note !== '' ? createElement('div', { className: 'hint', key: 'ok', style: { fontSize: '11px' } }, ui.note) : null,
    view.note ? createElement('div', { className: 'hint', key: 'srcc', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' } }, view.note) : null,
    rows.length > 0
      ? createElement('div', { key: 'rows', style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, rows)
      : createElement('div', { className: 'empty', key: 'norows' }, dshT('该 provider 没有可配置字段')),
    createElement('div', { key: 'acts', style: { display: 'grid', gridTemplateColumns: 'minmax(120px, 200px) 1fr auto auto', alignItems: 'center' } },
      createElement('div', { className: 'card-actions', style: { gridColumn: '2 / -1' } },
        ui.busy ? createElement('span', { className: 'spinner', key: 'sp' }) : null,
        createElement(UiButton, { variant: 'primary', size: 'sm', key: 'save', disabled: ui.busy, onClick: ui.save },
          ui.busy ? dshT('保存中…') : dshT('💾 保存配置')),
      ),
    ),
  )
}

/**
 * One `webSearchAdmin/list` provider row, as the config-editor slot needs
 * it: the card loop reads the rest (packageName / envVar / installed /
 * bundled).
 * @typedef {{ id: string, label: string }} ProviderRow
 */
/**
 * The section state `buildProviderConfigElement` reads: the open
 * editor's config read (null while loading / closed) plus the staged
 * draft and cleared maps and their flags.
 * @typedef {{
 * config: ProviderConfigView|null,
 * configBusy: boolean,
 * configError: string,
 * configNote: string,
 * draft: Record<string, string>,
 * cleared: Record<string, boolean>,
 * }} WebSearchSectionState
 */
/**
 * The three editor handlers the card loop threads into the editor slot.
 * @typedef {{
 * setField: (key: string, value: string) => void,
 * toggleClear: (key: string) => void,
 * save: () => void,
 * }} ConfigEditorHandlers
 */

/**
 * The editor slot for one provider card: a loading banner, the load failure,
 * or the form itself. Kept separate so the card loop stays declarative.
 * @param {ProviderRow} provider - the list() row (id + label).
 * @param {WebSearchSectionState} state - the section state (config / configBusy / configError / configNote / draft / cleared).
 * @param {ConfigEditorHandlers} handlers - { setField, toggleClear, save }.
 */
export function buildProviderConfigElement(provider, state, handlers) {
  if (state.config === null) {
    return createElement('div', { key: 'config' },
      state.configBusy
        ? createElement('div', { className: 'busy-banner', key: 'busy' },
          createElement('span', { className: 'spinner', key: 'sp' }), dshT('读取 ') + provider.label + dshT(' 配置…'))
        : createElement('div', { className: 'error', key: 'err' }, state.configError !== '' ? state.configError : dshT('配置不可用')))
  }
  return renderProviderConfig(state.config, {
    draft: state.draft,
    cleared: state.cleared,
    busy: state.configBusy,
    configError: state.configError,
    note: state.configNote,
    setField: handlers.setField,
    toggleClear: handlers.toggleClear,
    save: handlers.save,
  })
}
