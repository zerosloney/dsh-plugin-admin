/** skills — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiInput, copyTextSilently, createElement, dshT, messageOf, sectionState, showToast } from './context.js'

export var SKILLS_RENDER_CAP = 400

/**
 * Skills administration settings section.
 *
 * Renders the FULL skill roster of this deployment. The host merges the
 * registry's global layer (user directories, plugin-embedded `bundled`
 * skills, runtime registrations) with ONE read per agent preset's standing
 * scope and ONE read per distinct (cwd, agent-preset) scope taken from
 * `sessionAdmin/list` — so a skill only one workspace sees still appears,
 * with its source label, its SKILL.md path, and whether the model, the
 * human, or both can invoke it.
 *
 * The preset layer is what makes a WEB deployment legible: dsh-web-app
 * disables the host-plane `skill-filesystem` row (presets own local
 * discovery), so the global layer is legitimately empty there and every
 * user-directory skill arrives through a preset scope.
 *
 * The previous revision could only ever show ONE session's
 * user-invocable subset (the session-addressed catalog drops path, source,
 * and every model-only skill), which is exactly the "看不全" this page
 * exists to fix. The text filter narrows the roster without another host
 * round-trip; the scope panel shows coverage and the sessions whose scope
 * could not be resolved.
 *
 * Strictly read-only: no SKILL.md body is ever loaded and nothing on disk
 * is written. The path action only reveals a directory in the OS file
 * manager via `fsAdmin/reveal`.
 */
export function SkillsSection(props) {
  var call = props.call
  var kit = sectionState({
    available: true,
    complete: true,
    skills: [],
    scopes: [],
    sessions: [],
    warnings: [],
    busy: false,
    error: '',
    needle: '',
    copiedName: '',
  })
  var state = kit.state
  var alive = kit.alive

  function patch(partial) {
    kit.patch(partial)
  }

  /**
   * One roster load: session ids first (they are what makes the union
   * complete), then the merged skill list. A session list that fails or is
   * empty degrades to the global layer with a note instead of failing.
   */
  function loadRoster() {
    // The session list is only an ENRICHMENT: it turns the global roster into
    // a union over every session's scope. A transport rejection must degrade
    // exactly like a returned {ok:false} — global skills plus a note — never
    // fail the whole page.
    var sessionIds = call('sessionAdmin/list', {}).then(function (result) {
      if (!(result && result.ok)) {
        return { ids: [], note: dshT('会话列表不可用（') + messageOf(result && result.error) + dshT('）— 仅显示全局技能') }
      }
      var sessions = result.value && Array.isArray(result.value.sessions) ? result.value.sessions : []
      // Non-archived sessions first: the host caps how many sessions it
      // resolves, and an archived session's scope is the least useful one.
      var ordered = sessions.slice().sort(function (left, right) {
        return (left.archived === true ? 1 : 0) - (right.archived === true ? 1 : 0)
      })
      var ids = []
      for (var i = 0; i < ordered.length; i++) {
        var id = ordered[i].sessionId || ordered[i].id || ''
        if (id !== '' && ids.indexOf(id) === -1) ids.push(id)
      }
      return { ids: ids, note: '' }
    }, function (err) {
      return { ids: [], note: dshT('会话列表不可用（') + messageOf(err) + dshT('）— 仅显示全局技能') }
    })
    return sessionIds.then(function (list) {
      return call('skillsAdmin/list', { sessionIds: list.ids }).then(function (skillsResult) {
        if (!(skillsResult && skillsResult.ok)) throw new Error(messageOf(skillsResult && skillsResult.error))
        var value = skillsResult.value || {}
        var warnings = Array.isArray(value.warnings) ? value.warnings.slice() : []
        if (list.note !== '') warnings.unshift(list.note)
        return {
          available: value.available !== false,
          complete: value.complete !== false,
          skills: Array.isArray(value.skills) ? value.skills : [],
          scopes: Array.isArray(value.scopes) ? value.scopes : [],
          sessions: Array.isArray(value.sessions) ? value.sessions : [],
          warnings: warnings,
        }
      })
    })
  }

  function reload() {
    patch({ busy: true, error: '' })
    loadRoster().then(function (payload) {
      if (!alive.current) return
      patch({
        busy: false,
        error: '',
        available: payload.available,
        complete: payload.complete,
        skills: payload.skills,
        scopes: payload.scopes,
        sessions: payload.sessions,
        warnings: payload.warnings,
      })
    }, function (err) {
      if (!alive.current) return
      patch({ busy: false, error: dshT('加载技能失败：') + messageOf(err) })
    })
  }

  kit.mount(reload)

  function copySlashName(name) {
    // copyTextSilently carries the textarea/execCommand fallback for
    // non-secure contexts and older engines.
    copyTextSilently('/' + name).then(function () {
      if (!alive.current) return
      patch({ copiedName: name })
      setTimeout(function () {
        if (!alive.current) return
        patch({ copiedName: '' })
      }, 1500)
    }, function (err) {
      if (!alive.current) return
      showToast('error', dshT('❌ 复制失败：') + messageOf(err) + dshT('（可手动复制 /') + name + dshT('）'))
    })
  }

  function openPath(path) {
    if (!path) return
    // The explorer window is its own success feedback; a failure toasts
    // instead of reading as a dead click.
    call('fsAdmin/reveal', { path: path }).then(function (result) {
      if (!(result && result.ok)) showToast('error', dshT('❌ 打开失败：') + messageOf(result && result.error))
    }, function (err) { showToast('error', dshT('❌ 打开失败：') + messageOf(err)) })
  }

  // ---------- Render ----------

  if (!state.available) {
    return createElement('div', { 'data-dsh-admin-section': '' },
      createElement('div', { className: 'group-header', key: 'unavail' },
        createElement('span', { className: 'group-title', key: 't' }, dshT('📚 技能')),
        createElement('span', { className: 'group-count', key: 'c' }, dshT('本部署未挂载 @deepseek-ai/dsh-skill（技能注册表不可用）')),
      ),
    )
  }

  var elements = []
  if (state.busy) {
    elements.push(createElement('div', { className: 'busy-banner', key: 'busy' },
      createElement('span', { className: 'spinner', key: 'sp' }), dshT('加载技能清单…')))
  }
  if (state.error !== '') {
    elements.push(createElement('div', { className: 'error', key: 'err' }, state.error))
  }
  for (var wi = 0; wi < state.warnings.length; wi++) {
    elements.push(createElement('div', { className: 'hint', key: 'warn-' + wi, style: { fontSize: '11px' } }, '⚠ ' + state.warnings[wi]))
  }
  // Unresolved session scopes stay visible above the roster: a workspace whose
  // skills could not be read must not be hidden by an otherwise healthy list.
  var unresolvedSessions = state.sessions.filter(function (s) { return s.ok !== true })
  for (var us = 0; us < unresolvedSessions.length; us++) {
    elements.push(createElement('div', { className: 'hint', key: 'scope-fail-' + us, style: { fontSize: '11px' } },
      unresolvedSessionText(unresolvedSessions[us])))
  }

  // Display shortening comes from the host (`short`), so the panel never
  // re-parses a label string to render it.
  var scopeShortByLabel = {}
  for (var ssl = 0; ssl < state.scopes.length; ssl++) {
    scopeShortByLabel[state.scopes[ssl].label] = state.scopes[ssl].short !== undefined ? state.scopes[ssl].short : state.scopes[ssl].label
  }

  var needle = state.needle.trim().toLowerCase()
  var filtered = state.skills.filter(function (skill) {
    if (needle === '') return true
    var haystack = [skill.name, skill.description, skill.whenToUse, skill.path, skill.url].join(' ').toLowerCase()
    return haystack.indexOf(needle) !== -1
  })

  // Toolbar: refresh + text filter. The roster is small enough that the text
  // filter alone is enough — the host already labels every card with its
  // source and its scopes, so a source/scope dropdown only repeated what the
  // card says.
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar' },
    createElement(UiButton, { variant: 'outline', size: 'sm', key: 'refresh', disabled: state.busy, onClick: reload }, dshT('⟳ 刷新')),
    createElement('div', { className: 'search-wrap', key: 'search' },
      createElement('span', { className: 'search-icon', key: 'icon' }, '🔎'),
      createElement(UiInput, {
      placeholder: dshT('按名称 / 描述 / 路径过滤…'),
        value: state.needle, 'aria-label': dshT('过滤技能'),
        onChange: function (e) { patch({ needle: e.target.value }) },
      }),
    ),
  ))

  // Roster summary: the section lists the skills it could actually load, so
  // the line only states how many that is — plus the filter match count when a
  // filter narrows the view. Why a layer came up short is the warnings' job.
  var presetScopes = state.scopes.filter(function (s) { return s.kind === 'preset' })
  var sessionScopes = state.scopes.filter(function (s) { return s.kind !== 'global' && s.kind !== 'preset' })
  // One label per unresolved session, shared by the top-level hint line so the
  // wording cannot drift from the roster below it.
  function unresolvedSessionText(session) {
    return dshT('⚠ 会话 ') + session.sessionId + dshT(' 的作用域未能解析：') + session.message
  }
  var summaryText = dshT('📌 共 ') + state.skills.length + dshT(' 个技能')
    + (filtered.length === state.skills.length ? '' : dshT(' · 当前匹配 ') + filtered.length + dshT(' 个'))
  elements.push(createElement('div', { className: 'hint', key: 'summary' }, summaryText))

  // Skill cards, collected so they land inside ONE scroll region (a .list
  // viewport): cards rendered straight into the height-bounded section root
  // were once clipped with no way to reach the tail.
  var cardNodes = []
  for (let ci = 0; ci < filtered.length && ci < SKILLS_RENDER_CAP; ci++) {
    // Block-scoped on purpose: a shared `var` binding would make copy / open
    // act on the LAST skill in the list.
    const skill = filtered[ci]
    var headerChildren = [
      createElement('span', { className: 'card-title-text', key: 'name', title: '/' + skill.name }, '/' + skill.name),
      skill.modelInvocable
        ? createElement('span', { className: 'tag plugin', key: 'model', title: dshT('模型可主动调用（skill 工具）') }, dshT('🤖 模型可调用'))
        : null,
      skill.userInvocable
        ? createElement('span', { className: 'tag', key: 'user', title: dshT('人类可在 composer 用 /name 调用') }, dshT('👤 人类可调用'))
        : null,
      !skill.modelInvocable && !skill.userInvocable
        ? createElement('span', { className: 'tag archived', key: 'none', title: dshT('该技能当前不暴露给任何调用方') }, dshT('未暴露'))
        : null,
      createElement('span', { className: 'tag', key: 'src', title: 'dsh-skill source：' + (Array.isArray(skill.sources) ? skill.sources.join(' / ') : skill.source) }, skillsSourceLabel(skill.source)),
      state.copiedName === skill.name
        ? createElement('span', { className: 'tag live', key: 'copied', style: { marginLeft: '4px' } }, dshT('✓ 已复制'))
        : null,
    ]
    var actionChildren = [
      createElement(UiButton, {
        variant: 'outline',
        size: 'sm', key: 'btn-copy',
        title: dshT('复制 /') + skill.name + dshT(' 到剪贴板（在 composer 直接粘贴即可调用）'),
        onClick: function () { copySlashName(skill.name) },
      }, dshT('📋 复制 /name')),
    ]
    if (skill.path) {
      actionChildren.push(createElement(UiButton, {
        variant: 'outline',
        size: 'sm', key: 'btn-open',
        title: dshT('在系统资源管理器中打开 SKILL.md 所在目录（') + skill.path + dshT('）'),
        onClick: function () { openPath(skill.path) },
      }, dshT('📂 打开目录')))
    }
    var subChildren = []
    if (skill.description) {
      subChildren.push(createElement('div', { key: 'desc', className: 'card-sub' }, skill.description))
    }
    if (skill.whenToUse) {
      subChildren.push(createElement('div', { key: 'whe', className: 'card-sub', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' } }, dshT('何时用：') + skill.whenToUse))
    }
    if (skill.path) {
      subChildren.push(createElement('div', { className: 'card-sub', key: 'path' },
        createElement('span', { className: 'group-path', style: { fontFamily: 'monospace' }, title: skill.path }, skill.path)))
    }
    if (skill.url) {
      // 只有 http(s) 渲染成链接：skill.url 来自技能 frontmatter，而技能清单含
      // 项目 `.agents` 作用域（克隆任意仓库即可携带恶意条目），React 不会拦
      // `javascript:` URL——在设置页点一下就是在 Web UI 源内执行脚本。其余
      // scheme 一律退回纯文本展示。
      var safeUrl = /^https?:\/\//i.test(skill.url) ? skill.url : null
      subChildren.push(createElement('div', { className: 'card-sub', key: 'url' },
        safeUrl !== null
          ? createElement('a', { href: safeUrl, target: '_blank', rel: 'noreferrer', className: 'group-path' }, skill.url)
          : createElement('span', { className: 'group-path' }, skill.url)))
    }
    var seenIn = Array.isArray(skill.scopes) ? skill.scopes : []
    subChildren.push(createElement('div', { key: 'scopes', className: 'card-sub', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' } },
      dshT('可见于：') + seenIn.map(function (label) { return scopeShortByLabel[label] || label }).join(dshT('、'))
      + (skill.provider ? ' · provider: ' + skill.provider : '')))
    cardNodes.push(createElement('div', { className: 'card', key: 'skill-' + skill.name },
      createElement('div', { className: 'card-header', key: 'h' },
        createElement('span', { className: 'card-title', key: 'title-row' }, headerChildren),
        createElement('span', { className: 'card-actions', key: 'a' }, actionChildren),
      ),
      subChildren.length > 0 ? createElement('div', { key: 'body' }, subChildren) : null,
    ))
  }

  if (filtered.length > SKILLS_RENDER_CAP) {
    cardNodes.push(createElement('div', { className: 'hint', key: 'skills-cap' },
      dshT('已显示前 ') + SKILLS_RENDER_CAP + ' / ' + filtered.length + dshT(' 个技能——用上方过滤条件查看其余')))
  }
  if (filtered.length === 0 && state.skills.length > 0) {
    cardNodes.push(createElement('div', { className: 'empty', key: 'empty-filter' }, dshT('没有匹配当前筛选条件的技能')))
  }
  if (cardNodes.length > 0) {
    elements.push(createElement('div', { className: 'list', key: 'skills' }, cardNodes))
  }

  if (state.skills.length === 0 && !state.busy && state.error === '') {
    elements.push(createElement('div', { className: 'empty', key: 'empty-skills' },
      dshT('没有发现任何技能（全局层、预设作用域与会话作用域都未命中技能源）')))
    // Empty roster is the ONE state that is useless without a cause: surface
    // what the host actually returned so the user can tell "global layer was
    // empty" from "every session scope failed" from "scope key could not
    // resolve". Same shape as the existing warnings; nothing to wire elsewhere.
    var emptyDiagnose = []
    var globalScope = null
    for (var gi = 0; gi < state.scopes.length; gi++) {
      if (state.scopes[gi].kind === 'global') { globalScope = state.scopes[gi]; break }
    }
    if (globalScope !== null) {
      // In a web deployment the global layer is EMPTY BY DESIGN: dsh-web-app
      // disables the host-plane skill-filesystem row and lets presets own local
      // discovery. Saying so turns a confusing "0" into a fact, but only when a
      // preset layer actually exists to carry the skills.
      emptyDiagnose.push(dshT('全局层：') + globalScope.count + dshT(' 个技能')
        + (globalScope.count === 0 && presetScopes.length > 0 ? dshT('（本部署由预设挂载本地技能，全局层为空属正常）') : ''))
    }
    var failedPresetCount = 0
    for (var ppi = 0; ppi < presetScopes.length; ppi++) {
      if (presetScopes[ppi].error) failedPresetCount++
    }
    if (presetScopes.length > 0) {
      emptyDiagnose.push(dshT('预设作用域：') + presetScopes.length + dshT(' 个') + (failedPresetCount > 0 ? dshT('（') + failedPresetCount + dshT(' 个解析失败）') : ''))
    }
    var sessionScopeCount = 0
    var failedScopeCount = 0
    for (var sci = 0; sci < sessionScopes.length; sci++) {
      sessionScopeCount++
      if (sessionScopes[sci].error) failedScopeCount++
    }
    if (sessionScopeCount > 0) {
      emptyDiagnose.push(dshT('会话作用域：') + sessionScopeCount + dshT(' 个') + (failedScopeCount > 0 ? dshT('（') + failedScopeCount + dshT(' 个解析失败）') : ''))
    } else if (state.sessions.length === 0) {
      emptyDiagnose.push(dshT('会话作用域：无（dsh 当前没有已知会话）'))
    }
    if (state.warnings.length > 0) emptyDiagnose.push(dshT('警告：') + state.warnings.length + dshT(' 条'))
    if (emptyDiagnose.length > 0) {
      elements.push(createElement('div', { className: 'hint', key: 'empty-diagnose', style: { fontSize: '11px' } },
        dshT('诊断：') + emptyDiagnose.join(' · ')))
    }
  }

  return createElement('div', { 'data-dsh-admin-section': '' }, elements)
}

/** Friendly label for one dsh-skill `source` value. */
export function skillsSourceLabel(source) {
  var labels = {
    'project-agents': dshT('项目 .agents'),
    'project-dsh': dshT('项目 .dsh'),
    'user-agents': dshT('用户 .agents'),
    'user-dsh': dshT('用户 dsh'),
    bundled: dshT('插件内置'),
    runtime: dshT('运行时注册'),
    custom: dshT('自定义源'),
    unknown: dshT('未知来源'),
  }
  return labels[source] || String(source)
}
