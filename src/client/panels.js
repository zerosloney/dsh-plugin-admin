/**
 * Panel implementations, loaded as a package-local chunk (Phase B2).
 *
 * The main bundle registers the slot surfaces and shows a placeholder until
 * this chunk arrives on first render; the chunk itself is a self-contained
 * bundle (the loader resolves relative chunks as siblings of client.js and
 * refuses cross-module imports), so anything it needs from the main bundle
 * arrives through configure() below — functions the main half owns: the
 * locale table, the shared UI helpers and the toast/clipboard utilities.
 */
import React from 'react'
// Platform baseline (implicitly external for every dynamic bundle — see
// packages/client/AGENTS.md: the baseline must NOT be repeated in
// dsh.client.external): the shell shares one instance of these controls.
import { Button as UiButton, Checkbox as UiCheckbox, Input as UiInput, Pill as UiPill } from '@deepseek-ai/dsh-client-ui-primitives'
import { injectStyles, injectSaStyles, injectChStyles, injectTodoStyles } from './styles.js'

var createElement = React.createElement
var useState = React.useState
var useRef = React.useRef
var useEffect = React.useEffect

/**
 * Collaborators injected by the main bundle before the first render. Each is
 * declared with a permissive shape (the real implementation lives in the main
 * bundle) and a fallback that keeps the module importable in isolation — a
 * test that evaluates the chunk without configure() must not throw.
 */
/** @type {(s: string) => string} */
var dshT = function (s) { return s }
/** @type {(s: string) => string} */
var i18nSource = function (s) { return s }
/** @type {(lang: string) => void} */
var setAdminLang = function () {}
/** @type {() => string} */
var currentLanguage = function () { return 'zh' }
/** @type {(path: string) => string} */
var baseName = function (p) { return p }
/** @type {(ms: number) => string} */
var formatDate = function () { return '' }
/** @type {(error: unknown) => string} */
var messageOf = function (e) { return String(e) }
/** @type {(initial: any) => Record<string, any>} */
var sectionState = function () { throw new Error('panels: configure() was not called') }
/** @type {(...args: any[]) => any} */
var showToast = function () {}
/** @type {(...args: any[]) => any} */
var copyTextToClipboard = function () {}
/** @type {(...args: any[]) => any} */
var copyTextSilently = function () {}
/** @type {(...args: any[]) => any} */
var downloadTextFile = function () {}
/**
 * Adopt the main bundle's helpers. Called once, before any panel renders.
 * @param {Record<string, any>} env - the shared helper bag.
 */
export function configure(env) {
  // The stylesheets belong to the panels: they are injected the moment the
  // chunk arrives, which keeps 76 KB of CSS off the entry bundle's critical
  // path (a page that never opens an admin surface never needs them). Each
  // injector is idempotent — it checks for its own <style data-plugin-css> tag.
  injectStyles()
  injectSaStyles()
  injectChStyles()
  injectTodoStyles()
  if (typeof env.dshT === 'function') dshT = env.dshT
  if (typeof env.i18nSource === 'function') i18nSource = env.i18nSource
  if (typeof env.setAdminLang === 'function') setAdminLang = env.setAdminLang
  if (typeof env.currentLanguage === 'function') currentLanguage = env.currentLanguage
  if (typeof env.baseName === 'function') baseName = env.baseName
  if (typeof env.formatDate === 'function') formatDate = env.formatDate
  if (typeof env.messageOf === 'function') messageOf = env.messageOf
  if (typeof env.sectionState === 'function') sectionState = env.sectionState
  if (typeof env.showToast === 'function') showToast = env.showToast
  if (typeof env.copyTextToClipboard === 'function') copyTextToClipboard = env.copyTextToClipboard
  if (typeof env.copyTextSilently === 'function') copyTextSilently = env.copyTextSilently
  if (typeof env.downloadTextFile === 'function') downloadTextFile = env.downloadTextFile
}


/**
 * 扩展插件 tab contribution: plugin management rendered inside the shell-owned
 * 插件 settings section (after 插件配置 and 插件列表).
 */
function PluginsSection(props) {
  // Lazy initializer: the seed object (and its localStorage read) must be
  // built once at mount, not re-parsed on every render.
  var kit = sectionState(function () {
    return {
      profileDir: '',
      plugins: [],
      busy: false,
      error: '',
      spec: '',
      confirming: null,
      note: '',
      output: '',
      filter: 'all',
      needle: '',
      checkingUpdates: false,
      updateChecked: false, // true once a check finished (even if no updates)
      // Seed from persisted reminders so the ⬆ 有新版本 badge is visible the
      // moment the panel mounts (before the fresh host check resolves) — the
      // reminder is only dropped once a check confirms the upgrade completed.
      updates: loadUpdateReminders(), // name -> { latest, updateAvailable, error?, at? }
    bulkUpdate: null, // { done, total, failed: { name, reason }[] } — batch upgrade progress
    }
  })
  var pView = kit.state
  var setPView = kit.set

  var alive = kit.alive
  // In-flight check guard as a ref, not state: the state field drives the
  // disabled button visuals, but gating ASYNC handlers on it races — a stale
  // closure reads TRUE after an earlier check already settled and silently
  // skips a required follow-up (the post-upgrade refresh), or FALSE mid-flight
  // and lets a second one through. Refs are immune to closure staleness.
  var checkingRef = useRef(false)
  // Same single-flight contract for the mutating actions (install / upgrade /
  // upgrade-all / remove): the `busy` state field only drives the disabled
  // button visuals; the entry guards read the ref so a stale render closure
  // can never let a second mutation through.
  var busyRef = useRef(false)
  // Batch summary stamped after the refresh's own note write.
  var bulkNoteRef = useRef('')

  function patchPlugin(partial) {
    kit.patch(partial)
  }

  // Same gateway seam the other sections use; a local alias keeps the
  // call sites (and the render-helper parameter lists) untouched.
  var callRemote = props.call

  /**
   * Reload the plugin layer list from the host.
   * @param keepFeedback - when true, refresh ONLY the rows: busy/error/note
   *   stay untouched. Failure branches use this after patching the error —
   *   patch + reload in the same microtask otherwise batch into one render
   *   (React 18) and the just-set error text never paints, so a failed
   *   安装/更新/卸载 would look like "nothing happened".
   */
  function reloadPlugins(keepFeedback) {
    if (!keepFeedback) patchPlugin({ busy: true, error: '', note: '' })
    callRemote('pluginAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var next = {
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
        }
        if (!keepFeedback) next.busy = false
        patchPlugin(next)
      } else if (!keepFeedback) {
        patchPlugin({ busy: false, error: dshT('加载插件失败：') + messageOf(result.error) })
      }
      // keepFeedback: the visible error stays; a failed follow-up list just
      // leaves the rows stale.
    }, function (failure) {
      if (!alive.current) return
      if (!keepFeedback) patchPlugin({ busy: false, error: dshT('调用失败：') + messageOf(failure) })
    })
  }

  /**
   * Query the npm registry for newer versions of registry-installed bundles
   * and stash per-plugin results. The resolution MERGES the fresh authoritative
   * results onto the previously persisted reminders:
   *   - newer version confirmed      -> (re)arm & persist the reminder
   *   - confirmed up to date         -> drop the reminder (更新完删除提醒)
   *   - per-plugin check error       -> keep the known reminder (a transient
   *                                     registry failure must not erase it);
   *                                     with no known reminder the failure
   *                                     itself is recorded so cards/strip/
   *                                     note can surface it
   *   - no longer a registry install -> drop stale reminders
   * The AUTO check on panel open is cache-friendly; a manual check passes
   * force=true so the host bypasses its 5-minute TTL, re-queries the registry
   * and refreshes the cached content (检查更新 = 强制重新查，而不是回放缓存).
   * Runs concurrently with the list so the panel stays responsive; failures
   * are per-plugin, never fatal.
   * @param force - true to force the host to bypass its update cache.
   */
  // Phase F3: the privileged-action trail, fetched on demand (host-side it is
  // a bounded file read). Newest first; the host caps the slice at 100.
  function loadAudit() {
    patchPlugin({ auditBusy: true, auditError: null })
    callRemote('pluginAdmin/auditLog', {}).then(function (result) {
      if (!result || result.ok !== true) {
        patchPlugin({ auditBusy: false, auditError: messageOf(result && result.error) })
        return
      }
      var value = result.value || {}
      patchPlugin({
        auditBusy: false,
        auditError: null,
        auditEntries: Array.isArray(value.entries) ? value.entries : [],
        auditPath: typeof value.path === 'string' ? value.path : '',
      })
    }, function (error) {
      patchPlugin({ auditBusy: false, auditError: messageOf(error) })
    })
  }

  function checkUpdates(force) {
    if (checkingRef.current) return
    checkingRef.current = true
    patchPlugin({ checkingUpdates: true, note: '' })
    callRemote('pluginAdmin/checkUpdates', { force: force === true }).then(function (result) {
      checkingRef.current = false
      if (!alive.current) return
      if (!result.ok) {
        patchPlugin({ checkingUpdates: false, error: dshT('检查更新失败：') + messageOf(result.error) })
        // A failed call must not wipe previously known reminders — they stay
        // seeded from localStorage and keep rendering on the cards.
        return
      }
      var list = (result.value && result.value.updates) || []
      // Merge INSIDE the functional updater against the LATEST committed
      // state, never the render closure's snapshot: a reminder armed by an
      // in-flight check resolving alongside an upgrade commit must survive
      // (a stale-snapshot full replace erased it). The updater stays pure —
      // localStorage persistence is owned by the mirror effect below.
      setPView(function (cur) {
        var next = {}
        for (var k in cur) next[k] = cur[k]
        next.checkingUpdates = false
        next.updates = mergeUpdateReminders(cur.updates || {}, list)
        next.updateChecked = true
        if (bulkNoteRef.current !== '') {
          next.note = bulkNoteRef.current
          bulkNoteRef.current = ''
        } else {
          next.note = updateCheckNote(next.updates, list.length)
        }
        return next
      })
    }, function (failure) {
      checkingRef.current = false
      if (!alive.current) return
      patchPlugin({ checkingUpdates: false, error: dshT('检查更新调用失败：') + messageOf(failure) })
    })
  }

  // Batch upgrade (VS Code extensions posture): serially install every
  // plugin whose reminder says an update exists. Failures are collected,
  // not fatal — one bad plugin must not block the rest.
  function upgradeAllPlugins() {
    if (busyRef.current || pView.bulkUpdate !== null) return
    var targets = []
    for (var name in pView.updates) {
      var info = pView.updates[name]
      if (info && info.updateAvailable && info.latest) targets.push({ name: name, latest: info.latest })
    }
    if (targets.length === 0) return
    busyRef.current = true
    patchPlugin({ busy: true, error: '', confirming: null, note: '', bulkUpdate: { done: 0, total: targets.length, failed: [] } })
    var index = 0
    var failedTotal = 0
    var failures = []
    var compatTotal = 0
    var runNext = function () {
      if (!alive.current) return
      if (index >= targets.length) {
        busyRef.current = false
        setPView(function (cur) {
          var next = {}
          for (var k in cur) next[k] = cur[k]
          next.busy = false
          next.bulkUpdate = null
          return next
        })
        // Order matters: checkUpdates' begin-path clears `note`, so the batch
        // summary is stamped AFTER the refresh instead of being wiped by it.
        checkUpdates(true)
        reloadPlugins(true)
        // The refresh's own note write lands first; the batch summary is
        // stamped over it by checkUpdates' merge (see bulkNoteRef there).
        // Failure reasons ride the summary (bounded per entry) so a failed
        // batch is diagnosable without re-running it one by one.
        bulkNoteRef.current = dshT('✅ 批量更新完成：') + (targets.length - failedTotal) + dshT(' 个已更新') + (failedTotal > 0
          ? dshT('，') + failedTotal + dshT(' 个失败：') + failures.map(function (row) {
            return row.name + dshT('（') + String(row.reason).split('\n')[0].slice(0, 120) + dshT('）')
          }).join(dshT('；'))
          : '') + (compatTotal > 0 ? dshT('，') + compatTotal + dshT(' 个与当前 dsh 不兼容（重启将被跳过）') : '') + dshT('。更改在重启 dsh 后生效')
        return
      }
      var target = targets[index]
      callRemote('pluginAdmin/install', { spec: target.name + '@' + target.latest }).then(function (result) {
        if (!alive.current) return
        index++
        if (!result.ok) {
          failedTotal++
          var reason = messageOf(result.error)
          failures.push({ name: target.name, reason: reason })
        }
        // A peer-incompatible update still "succeeded" (installed), but dsh
        // 0.1.7+ will skip it at boot — counted separately from failures.
        var compat = result.value && result.value.compat
        if (result.ok && compat && compat.checked === true && compat.ok === false) compatTotal++
        setPView(function (cur) {
          var next = {}
          for (var k in cur) next[k] = cur[k]
          var failed = cur.bulkUpdate !== null ? cur.bulkUpdate.failed : []
          next.bulkUpdate = { done: index, total: targets.length, failed: result.ok ? failed : failed.concat([{ name: target.name, reason: reason }]) }
          if (result.ok) {
            next.plugins = (result.value && result.value.plugins) || cur.plugins
            var remaining = {}
            for (var rk in cur.updates) {
              if (rk !== target.name) remaining[rk] = cur.updates[rk]
            }
            next.updates = remaining
          }
          return next
        })
        runNext()
      }, function (failure) {
        if (!alive.current) return
        index++
        failedTotal++
        var reason = messageOf(failure)
        failures.push({ name: target.name, reason: reason })
        setPView(function (cur) {
          var next = {}
          for (var k in cur) next[k] = cur[k]
          var failed = cur.bulkUpdate !== null ? cur.bulkUpdate.failed : []
          next.bulkUpdate = { done: index, total: targets.length, failed: failed.concat([{ name: target.name, reason: reason }]) }
          return next
        })
        runNext()
      })
    }
    runNext()
  }

  /** Upgrade one plugin to its latest version (registry install by name). */
  function upgradePlugin(name) {
    if (busyRef.current) return
    busyRef.current = true
    // Prefer the exact version already discovered by checkUpdates(): passing
    // `name@latest` to pnpm is unreliable when the manifest already carries a
    // range constraint (e.g. "^0.4.2") — pnpm can resolve @latest against the
    // satisfied range and report "Already up to date" WITHOUT fetching the new
    // version (exit 0, nothing changed). Pinning the exact latest version makes
    // pnpm bump the constraint and actually download the new package. The host
    // install() also falls back to resolving @latest server-side, so a direct
    // `name@latest` still works as a second guard.
    var known = pView.updates && pView.updates[name]
    var spec = (known && known.latest) ? (name + '@' + known.latest) : (name + '@latest')
    patchPlugin({ busy: true, error: '', confirming: null, note: '' })
    callRemote('pluginAdmin/install', { spec: spec }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        // The upgrade consumed this reminder: strip it from the CURRENT state
        // inside the updater (更新完删除提醒) — never from the click-time
        // closure snapshot, which may miss reminders an in-flight check armed
        // meanwhile (erasing those was exactly scenario 7's stale-snapshot
        // bug). localStorage follows via the shared mirror effect; the forced
        // refresh below confirms the new version is current.
        busyRef.current = false
        setPView(function (cur) {
          var next = {}
          for (var k in cur) next[k] = cur[k]
          next.busy = false
          next.note = dshT('已更新 ') + name + dshT('。更改在重启 dsh 后生效') + compatWarningText(result.value && result.value.compat)
          next.output = (result.value && result.value.output) || ''
          next.profileDir = (result.value && result.value.profileDir) || ''
          next.plugins = (result.value && result.value.plugins) || []
          var remaining = {}
          for (var rk in cur.updates) {
            if (rk !== name) remaining[rk] = cur.updates[rk]
          }
          next.updates = remaining
          return next
        })
        // Refresh the update map so the upgraded entry stops flagging.
        // Force: the @latest spec installed the registry's CURRENT latest,
        // but the host TTL cache may still hold an older latest published
        // minutes ago — comparing against that would re-flag the freshly
        // upgraded plugin. Bypass the cache and resync its content instead.
        checkUpdates(true)
        return
      }
      var failMessage = dshT('更新失败：') + messageOf(result.error)
      busyRef.current = false
      patchPlugin({ busy: false, error: failMessage })
      // Floating toast for the failure in addition to the persistent panel
      // error bar (the toast demands attention, the bar keeps the detail).
      showToast('error', failMessage)
      reloadPlugins(true)
    }, function (failure) {
      if (!alive.current) return
      busyRef.current = false
      patchPlugin({ busy: false, error: dshT('调用失败：') + messageOf(failure) })
    })
  }

  /**
   * Compose the marketplace panel's peer-compatibility warning from an
   * install result's `compat` verdict (see lib/peer-compat.js). The host only
   * attaches it when it could resolve the running dsh version, and `ok` is
   * false only when a NEWLY installed package declares an unsatisfiable
   * @deepseek-ai/dsh* peer — dsh 0.1.7+ will SKIP such a bundle at boot, so
   * the panel must say so instead of celebrating an install that will
   * silently vanish after a restart.
   */
  function compatWarningText(compat) {
    if (!compat || compat.checked !== true || compat.ok !== false) return ''
    var rows = Array.isArray(compat.rows) ? compat.rows : []
    var parts = []
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {}
      parts.push((row.name || '?') + (row.version ? '@' + row.version : '') + dshT(' 与当前 dsh ') + compat.runtimeVersion + dshT(' 不兼容：') + JSON.stringify(row.incompatible || row.peers || {}))
    }
    if (parts.length === 0) return ''
    var allowHint = ''
    var first = rows[0]
    if (first && first.name && first.version) {
      allowHint = dshT('如需强行接受：') + 'dsh plugin allow-version ' + first.name + '@' + first.version + ' --dsh-version ' + compat.runtimeVersion + ' --accept-risk'
    }
    return '\n⚠ ' + dshT('dsh 兼容性：') + parts.join(dshT('；')) + '。' + dshT('宿主重启时将跳过加载。') + allowHint
  }

  function installPlugin() {
    if (busyRef.current || pView.spec.trim() === '') return
    busyRef.current = true
    var spec = pView.spec.trim()
    patchPlugin({ busy: true, error: '', confirming: null, note: '' })
    callRemote('pluginAdmin/install', { spec: spec }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        busyRef.current = false
        patchPlugin({
          busy: false,
          note: dshT('安装完成。更改在重启 dsh 后生效') + compatWarningText(result.value && result.value.compat),
          output: (result.value && result.value.output) || '',
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
          spec: '',
        })
        return
      }
      var failMessage = dshT('安装失败：') + messageOf(result.error)
      busyRef.current = false
      patchPlugin({ busy: false, error: failMessage })
      showToast('error', failMessage)
      reloadPlugins(true)
    }, function (failure) {
      if (!alive.current) return
      busyRef.current = false
      patchPlugin({ busy: false, error: dshT('调用失败：') + messageOf(failure) })
    })
  }

  function removePlugin(name) {
    if (busyRef.current) return
    busyRef.current = true
    patchPlugin({ busy: true, error: '', confirming: null, note: '' })
    callRemote('pluginAdmin/remove', { name: name }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        busyRef.current = false
        patchPlugin({
          busy: false,
          note: dshT('卸载完成。更改在重启 dsh 后生效'),
          output: (result.value && result.value.output) || '',
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
        })
        return
      }
      var failMessage = dshT('卸载失败：') + messageOf(result.error)
      busyRef.current = false
      patchPlugin({ busy: false, error: failMessage })
      showToast('error', failMessage)
      reloadPlugins(true)
    }, function (failure) {
      if (!alive.current) return
      busyRef.current = false
      patchPlugin({ busy: false, error: dshT('调用失败：') + messageOf(failure) })
    })
  }

  /**
   * Enable/disable one bundle without uninstalling: the host authors (or
   * removes) profile-layer `disabled: true` rows for the bundle's own rows.
   * Reversible and cheap — one click, no pnpm, no confirm bar; takes effect
   * on the next dsh restart. The fresh layer list rides back in the result.
   */
  function toggleEnabled(name, disabled) {
    patchPlugin({ busy: true, error: '', note: '' })
    callRemote('pluginAdmin/setEnabled', { name: name, disabled: disabled }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var value = result.value || {}
        var rows = (value.rows && value.rows.length) || 0
        patchPlugin({
          busy: false,
          note: value.state === 'present'
            ? (disabled ? dshT('该插件已处于停用状态') : dshT('该插件已处于启用状态'))
            : (disabled
              ? dshT('已写入 ') + rows + dshT(' 行停用标记 — 重启 dsh 后该插件不再挂载；点「启用」可恢复')
              : dshT('已移除停用标记 — 重启 dsh 后插件恢复挂载')),
          profileDir: value.profileDir || '',
          plugins: value.plugins || [],
        })
        return
      }
      var failMessage = (disabled ? dshT('停用') : dshT('启用')) + dshT('失败：') + messageOf(result.error)
      patchPlugin({ busy: false, error: failMessage })
      showToast('error', failMessage)
      reloadPlugins(true)
    }, function (failure) {
      if (!alive.current) return
      patchPlugin({ busy: false, error: dshT('调用失败：') + messageOf(failure) })
    })
  }

  useEffect(function () {
    alive.current = true
    reloadPlugins()
    // Auto-check for remote updates on mount (the panel loads lazily when
    // the 扩展插件 tab is opened, so this runs once per open). The auto path
    // is cache-friendly: the host serves its 5-minute cache, so re-opening
    // the tab shortly after does not re-hit the registry. The manual
    // ⬆ 检查更新 button is the force path — it bypasses the cache and
    // refreshes its content.
    checkUpdates()
    return function () { alive.current = false }
  }, [])

  // Single persistence point: localStorage always mirrors the LATEST
  // committed reminders. Moving saves out of the async handlers (and out of
  // the functional updaters, which must stay pure) removes drift by
  // construction — whatever merge won the last commit is what survives
  // dialog reopen and dsh restarts (best-effort; unavailable storage just
  // degrades to session-only badges).
  useEffect(function () {
    saveUpdateReminders(pView.updates || {})
  }, [pView.updates])

  return createElement('div', { 'data-dsh-admin-section': '' },
    renderPluginsView(pView, patchPlugin, installPlugin, removePlugin, checkUpdates, upgradePlugin, upgradeAllPlugins, toggleEnabled, loadAudit))
}
// Error code dsh raises when full-text session search is not enabled; the
// 历史会话 search box turns it into the one-click enable banner.
var SEARCH_DISABLED_MARKER = 'SESSION_QUERY_SEARCH_DISABLED'

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
 */
function WebSessionsSection(props) {
  var tabHooks = useState('sessions')
  var tab = tabHooks[0]
  var setTab = tabHooks[1]
  var tabs = [
    { id: 'sessions', label: dshT('历史会话'), component: SessionsSection },
    { id: 'websearch', label: dshT('Web 搜索'), component: WebSearchSection },
  ]
  var selected = tabs.find(function (entry) { return entry.id === tab }) || tabs[0]
  return createElement('div', { 'data-cha-section': '' },
    createElement('div', { className: 'tabs', role: 'tablist', 'aria-label': dshT('Web 与会话'),
      onKeyDown: function (event) { tabKeyDown(event, tabs, selected.id, setTab) } },
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
 */
function SessionsSection(props) {
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

  function toggleGroupCollapsed(key) {
    setCollapsedGroups(function (cur) {
      var next = cur.indexOf(key) !== -1 ? cur.filter(function (k) { return k !== key }) : cur.concat([key])
      saveCollapsedGroups(next)
      return next
    })
  }

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

  /** Raise the bulk-delete confirmation bar for one scope. */
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
  function togglePinned(id) {
    setPinnedIds(function (cur) {
      var next = cur.indexOf(id) !== -1 ? cur.filter(function (x) { return x !== id }) : cur.concat([id])
      savePinnedIds(next)
      return next
    })
  }

  var alive = kit.alive
  // Search sequence guard: a slow older search must not overwrite a newer
  // one's hits when both are in flight.
  var searchSeq = useRef(0)

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
  function patchHealth(sessionId, entry) {
    setSView(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.healthBySession = Object.assign({}, cur.healthBySession, { [sessionId]: entry })
      return next
    })
  }

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

/**
 * MCP服务器 settings section (standalone settings-nav page).
 */

/* ------------------------------------------------------------------------ */
/* MCP test-result cache                                                     */
/*                                                                          */
/* Successful connectivity probes are persisted to localStorage so the      */
/* panel shows the last known status after tab switches or reopening the    */
/* dialog instead of an empty state. Only OK results are cached (failures   */
/* are usually transient); a cached row is labelled with its probe time,    */
/* and the cache entry is invalidated when the config is saved or removed,  */
/* or pruned when the entry disappears from the host list.                  */
/* ------------------------------------------------------------------------ */

var MCP_TEST_CACHE_KEY = 'dsh-plugin-admin/mcp-test-results'

/**
 * Touch localStorage safely: on some environments (jsdom with an opaque
 * origin, hardened browsers, privacy modes) merely READING window.localStorage
 * throws a SecurityError, so the access itself has to sit inside try/catch.
 * Returns null when storage is unavailable.
 */
function safeLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch (e) {
    return null
  }
}

function mcpTestStorage() {
  return safeLocalStorage()
}

function loadMcpTestCache() {
  var store = mcpTestStorage()
  if (store === null) return {}
  try {
    var parsed = JSON.parse(store.getItem(MCP_TEST_CACHE_KEY))
    if (parsed === null || typeof parsed !== 'object') return {}
    // Purge failure records persisted by older builds: only a durable OK is
    // worth restoring on mount; a stale ❌ from a past outage must not
    // outlive the session it happened in.
    var out = {}
    for (var id in parsed) {
      var entry = parsed[id]
      if (entry && entry.result && entry.result.ok === true) out[id] = entry
    }
    return out
  } catch (e) {
    return {}
  }
}

/** Mirror settled, successful probes into localStorage (best-effort). */
function saveMcpTestCache(state) {
  var store = mcpTestStorage()
  if (store === null) return
  try {
    var out = {}
    for (var id in state) {
      var s = state[id]
      // Busy rows keep the previous cached result; failures stay ephemeral —
      // INCLUDING structured {ok:false} probes (timeout, connection refused),
      // which arrive as a truthy result object and need their own ok check.
      if (!s || s.busy || s.result === null || s.result === undefined
        || s.result.ok !== true) continue
      out[id] = { result: s.result, at: typeof s.at === 'number' ? s.at : Date.now() }
    }
    store.setItem(MCP_TEST_CACHE_KEY, JSON.stringify(out))
  } catch (e) {
    // Quota exceeded / storage blocked — the cache is optional, never fatal.
  }
}

/** Drop one entry's cached probe (config saved or entry removed). */
function clearMcpTestCacheEntry(id) {
  var store = mcpTestStorage()
  if (store === null) return
  try {
    var state = loadMcpTestCache()
    if (state[id] === undefined) return
    delete state[id]
    store.setItem(MCP_TEST_CACHE_KEY, JSON.stringify(state))
  } catch (e) { /* ignore */ }
}

/** Drop test states whose entry no longer exists in the host list. */
function pruneMcpTestState(map, entries) {
  var valid = {}
  for (var i = 0; i < entries.length; i++) valid[entries[i].id] = true
  var next = {}
  var changed = false
  for (var id in map) {
    if (valid[id]) next[id] = map[id]
    else changed = true
  }
  if (changed) saveMcpTestCache(next)
  return next
}

/** Compact timestamp for a cached probe ("14:32" today, "6-1 14:32" older). */
function formatTestTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  var d = new Date(ms)
  var pad = function (n) { return (n < 10 ? '0' : '') + String(n) }
  var hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
  var now = new Date()
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hm
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm
}

/* Update-reminder persistence                                               */
/*                                                                          */
/* A "⬆ 有新版本" reminder is a durable fact, not a transient fetch result: */
/* once a newer version is detected it is kept in localStorage until a      */
/* check confirms the installed version is current again (i.e. the update   */
/* actually completed). This is what keeps the badge visible after closing  */
/* and reopening the dialog, across dsh restarts, and even when a later     */
/* re-check hits a transient network failure — and what clears it only once */
/* the plugin is upgraded (更新完删除提醒).                                  */
/* ------------------------------------------------------------------------ */

var UPDATE_REMINDER_KEY = 'dsh-plugin-admin/update-reminders'

/** Shape-merge a reminder entry (keeps the original truthy fields). */
function mergeReminder(entry, partial) {
  var next = {}
  for (var k in entry) next[k] = entry[k]
  for (var pk in partial) next[pk] = partial[pk]
  return next
}

/**
 * Load persisted update reminders as state entries:
 * { name: { latest, at, updateAvailable, error } }. Storage-unavailable
 * environments (opaque-origin jsdom, privacy modes) just get an empty map.
 */
function loadUpdateReminders() {
  var store = safeLocalStorage()
  if (store === null) return {}
  try {
    var parsed = JSON.parse(store.getItem(UPDATE_REMINDER_KEY))
    var out = {}
    if (parsed !== null && typeof parsed === 'object') {
      for (var name in parsed) {
        var r = parsed[name]
        if (r && typeof r.latest === 'string' && r.latest.length > 0) {
          out[name] = {
            latest: r.latest,
            at: typeof r.at === 'number' ? r.at : 0,
            updateAvailable: true,
            error: '',
          }
        }
      }
    }
    return out
  } catch (e) {
    return {}
  }
}

/** Mirror the current reminder set into localStorage (best-effort). */
function saveUpdateReminders(map) {
  var store = safeLocalStorage()
  if (store === null) return
  try {
    var out = {}
    for (var name in map) {
      var r = map[name]
      if (r && r.updateAvailable === true && typeof r.latest === 'string' && r.latest.length > 0) {
        out[name] = { latest: r.latest, at: typeof r.at === 'number' ? r.at : Date.now() }
      }
    }
    store.setItem(UPDATE_REMINDER_KEY, JSON.stringify(out))
  } catch (e) {
    // Quota exceeded / storage blocked — the reminder is optional, never fatal.
  }
}

/**
 * Merge one check response into the CURRENT reminder map. Pure on purpose:
 * it runs inside the setPView updater, so it reads only its arguments and
 * must never touch localStorage or other component state. Per-entry semantics
 * (list = fresh host results, one row per live registry install):
 *   - updateAvailable  -> (re)arm the reminder
 *   - confirmed current -> drop any entry (更新完删除提醒)
 *   - query error      -> keep a prior reminder untouched (error attached);
 *                         without one, record an ephemeral failure
 *                         ({updateAvailable:false}) so cards/strip/note can
 *                         surface it — saveUpdateReminders skips those
 *   - entries absent from `list` are no longer live registry installs ->
 *     stale reminders dropped
 * @param curMap - the CURRENT updates state ({ name -> entry }).
 * @param list - per-plugin check results.
 * @returns the complete next map.
 */
function mergeUpdateReminders(curMap, list) {
  var liveNames = {}
  for (var a = 0; a < list.length; a++) liveNames[list[a].name] = true
  var map = {}
  for (var k in curMap) {
    if (curMap[k] && liveNames[k]) map[k] = curMap[k]
  }
  for (var i = 0; i < list.length; i++) {
    var u = list[i]
    if (u.updateAvailable === true) {
      map[u.name] = { latest: u.latest, updateAvailable: true, error: '', at: Date.now() }
    } else if (u.error) {
      // A prior reminder survives untouched with the transient error
      // alongside; WITHOUT one the failure itself lands in the map so an
      // all-failed first check cannot claim 全部为最新版本.
      map[u.name] = map[u.name]
        ? mergeReminder(map[u.name], { error: u.error || '' })
        : { latest: '', updateAvailable: false, error: u.error || '', at: Date.now() }
    } else if (u.latest !== null && u.latest !== undefined) {
      delete map[u.name]
    }
  }
  return map
}

/** Aggregate summary line for a finished check (pure). */
function updateCheckNote(map, checkedCount) {
  var updateCount = 0
  var checkErrorCount = 0
  for (var n in map) {
    if (map[n].updateAvailable === true) updateCount++
    if (map[n].error) checkErrorCount++
  }
  if (updateCount > 0) return dshT('发现 ') + updateCount + dshT(' 个插件有新版本')
  if (checkErrorCount > 0) {
    return dshT('已检查 ') + checkedCount + dshT(' 个插件（') + checkErrorCount + dshT(' 个查询失败）')
      + (checkedCount > checkErrorCount ? dshT('，其余均为最新版本') : '')
  }
  return checkedCount > 0 ? dshT('已检查 ') + checkedCount + dshT(' 个插件，均为最新版本') : ''
}

/**
 * The MCP tool playground: tool picker (from the last probe's list), a raw
 * JSON arguments box, an explicit it-really-runs warning, and the normalized
 * result. One bench per panel, opened from a card's 🧪 试调用 button.
 */
function renderMcpPlayground(pg, patch, callRemote) {
  // Required params of the selected tool (from the probe's inputSchema
  // extraction); empty when unknown or the tool declares none.
  var requiredList = pg.toolRequired
    && Object.prototype.hasOwnProperty.call(pg.toolRequired, pg.tool)
    && Array.isArray(pg.toolRequired[pg.tool]) ? pg.toolRequired[pg.tool] : []
  var resultChildren = []
  if (pg.busy) {
    resultChildren.push(createElement('div', { className: 'mcp-test mcp-test-busy', key: 'busy' },
      createElement('span', { className: 'spinner' }), dshT(' 正在执行工具（最长 60 秒）…')))
  } else if (pg.result !== null && pg.result !== undefined) {
    var tc = pg.result.toolCall
    if (tc === null || tc === undefined) {
      resultChildren.push(createElement('div', { className: 'mcp-test mcp-test-fail' },
        '❌ ' + (pg.result.error || dshT('没有返回结果'))))
    } else {
      resultChildren.push(createElement('div', {
        className: 'mcp-test ' + (tc.isError ? 'mcp-test-fail' : 'mcp-test-ok'),
        key: 'verdict',
      }, (tc.isError ? dshT('⚠️ 工具报告错误') : dshT('✅ 执行成功')) + (tc.truncated ? dshT('（结果过长已截断）') : '')))
      resultChildren.push(createElement('pre', { className: 'mcp-playground-out', key: 'out' }, tc.text || dshT('（空结果）')))
    }
  } else if (pg.error !== null && pg.error !== undefined) {
    resultChildren.push(createElement('div', { className: 'mcp-test mcp-test-fail', key: 'err' }, '❌ ' + pg.error))
  }

  return createElement('div', { className: 'card mcp-playground', key: 'mcp-playground' },
    createElement('div', { className: 'card-header' },
      createElement('span', { className: 'card-title-text' }, dshT('🧪 工具试调用 · ') + pg.serverName),
      createElement('div', { className: 'card-actions' },
        createElement(UiButton, {
          variant: 'outline',
          size: 'sm',
          onClick: function () { patch({ mcpPlayground: null }) },
        }, dshT('关闭')))),
    createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      pg.tools.length > 0
        ? createElement('select', {
            className: 'input',
            value: pg.tool,
            onChange: function (e) { patch({ tool: e.target.value }) },
          }, pg.tools.map(function (t) {
            return createElement('option', { key: t, value: t }, t)
          }))
        : createElement('div', { className: 'mcp-test-warn' }, dshT('先对该服务器跑一次「🔌 测试」以获取工具列表。')),
      createElement('textarea', {
        className: 'input',
        rows: 5,
        placeholder: dshT('工具参数（JSON 对象，键名以该工具的 inputSchema 为准）'),
        value: pg.argsText,
        onChange: function (e) { patch({ argsText: e.target.value }) },
      }),
      requiredList.length > 0
        ? createElement('div', { className: 'mcp-test-warn' },
            dshT('必填参数: ') + requiredList.join(', ') + dshT(' —— 例如 { "') + requiredList.join('": …, "') + '": … }')
        : null,
      createElement('div', { className: 'mcp-test-warn' }, dshT('⚠️ 试调用会真实执行该工具（可能写文件、发请求），请确认参数后再执行。')),
      createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        createElement(UiButton, {
          variant: 'primary', disabled: pg.busy || pg.tool === '',
          onClick: function () {
            if (typeof callRemote !== 'function') return
            var parsed
            try {
              parsed = JSON.parse(pg.argsText === '' ? '{ }' : pg.argsText)
            } catch (e) {
              patch({ error: dshT('参数不是合法 JSON：') + messageOf(e) })
              return
            }
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
              patch({ error: dshT('参数必须是 JSON 对象（键值对）') })
              return
            }
            patch({ busy: true, result: null, error: null })
            callRemote('mcpAdmin/callTool', { id: pg.entryId, tool: pg.tool, args: parsed }).then(function (result) {
              if (result.ok) patch({ busy: false, result: result.value })
              else patch({ busy: false, error: messageOf(result.error) })
            }, function (failure) {
              patch({ busy: false, error: messageOf(failure) })
            })
          },
        }, pg.busy ? dshT('执行中…') : dshT('▶ 执行工具')),
        resultChildren.length > 0 && !pg.busy ? createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' } }, dshT('结果见下方')) : null),
      createElement('div', null, resultChildren),
    ))
}

function McpSection(props) {
  var kit = sectionState({
    mcpEntries: [],
    mcpBusy: false,
    mcpError: '',
    // Save outcome line (green): hot-applied vs saved-pending-restart.
    mcpNote: '',
    mcpEditorOpen: false,
    mcpDraft: null,
    // entryId -> { busy?, result?, error?, at? }; previous successful probes
    // are restored from localStorage so statuses survive panel remounts.
    mcpTestState: loadMcpTestCache(),
    // MCP playground (MCP Inspector posture): one open invocation bench per
    // panel — { entryId, tool, argsText, busy, result, error } or null.
    mcpPlayground: null,
    // Two-step remove: the id whose 移除 button opened the confirm bar.
    // Deleting an entry removes the whole block (secret headers included)
    // from cordis.patch.yml, so it confirms like every other destructive
    // action in this file.
    mcpConfirmRemove: null,
  })
  var mView = kit.state
  var setMView = kit.set

  var alive = kit.alive
  // Probe sequence guard: the probe of an older click must never overwrite a
  // newer one's result when both are in flight.
  var testSeq = useRef(0)

  function patchMcp(partial) {
    kit.patch(partial)
  }

  // Merge a partial into the CURRENT mcpDraft via a functional update, so
  // rapid successive field edits (React batching) never lose earlier input.
  function patchDraft(partial) {
    setMView(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.mcpDraft = mergeDraft(cur.mcpDraft, partial)
      return next
    })
  }

  // Nested patch for the playground bench — patchMcp is a TOP-LEVEL merge and
  // would clobber the whole bench object with flat fields.
  function patchPlayground(partial) {
    setMView(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      if (cur.mcpPlayground !== null) {
        var pg = {}
        for (var pk in cur.mcpPlayground) pg[pk] = cur.mcpPlayground[pk]
        for (var mk in partial) pg[mk] = partial[mk]
        next.mcpPlayground = pg
      }
      return next
    })
  }

  // Same gateway seam the other sections use; a local alias keeps the
  // call sites (and the render-helper parameter lists) untouched.
  var callRemote = props.call

  // ---- MCP playground (tools/call bench) ----
  function openMcpPlayground(entry) {
    var probe = mView.mcpTestState && mView.mcpTestState[entry.id]
    var tools = probe && probe.result && Array.isArray(probe.result.tools) ? probe.result.tools : []
    // toolName -> required param names, from the probe's tools/list
    // inputSchema; absent for tools without required inputs or probes taken
    // before this field existed (a fresh 🔌 测试 refills it).
    var result = probe && probe.result
    var toolRequired = result && result.toolRequired !== null && typeof result.toolRequired === 'object'
      ? result.toolRequired : {}
    patchMcp({
      mcpEditorOpen: false,
      mcpPlayground: {
        entryId: entry.id,
        serverName: entry.serverName || entry.id,
        tools: tools,
        toolRequired: toolRequired,
        tool: tools.length > 0 ? tools[0] : '',
        argsText: '{ }',
        busy: false,
        result: null,
        error: tools.length === 0 ? dshT('还没有工具列表 —— 先点「🔌 测试」获取该服务器提供的工具，再试调用。') : null,
      },
    })
  }


  function reloadMcp() {
    patchMcp({ mcpBusy: true, mcpError: '' })
    callRemote('mcpAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var entries = (result.value && result.value.entries) || []
        setMView(function (cur) {
          var next = {}
          for (var k in cur) next[k] = cur[k]
          next.mcpBusy = false
          next.mcpEntries = entries
          // Drop cached probes whose entry no longer exists on the host.
          next.mcpTestState = pruneMcpTestState(cur.mcpTestState, entries)
          return next
        })
      } else {
        patchMcp({ mcpBusy: false, mcpError: dshT('加载 MCP 配置失败：') + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchMcp({ mcpBusy: false, mcpError: dshT('调用失败：') + messageOf(failure) })
    })
  }

  function openMcpEditor(entry) {
    if (entry !== null && entry !== undefined && (entry.config === null || entry.config === undefined)) {
      patchMcp({ mcpError: dshT('该 MCP 配置无法安全解析，已禁止在此覆盖；请在 cordis.patch.yml 中手动编辑。') })
      return
    }
    var source = entry !== null && entry !== undefined ? entry.config : null
    var draft = source ? {
      id: entry.id,
      isNew: false,
      serverName: source.serverName || entry.id,
      transport: source.transport,
      command: source.command || '',
      url: source.url || '',
      args: (source.args || []).join(' '),
      argsOriginal: source.args || [],
      argsChanged: false,
      env: Object.keys(source.env || {}).map(function (key) { return key + '=' + source.env[key] }).join('\n'),
      envOriginal: source.env || {},
      envChanged: false,
      cwd: source.cwd || '',
      headers: Object.keys(source.headers || {}).map(function (k) { return k + '=' + source.headers[k] }).join('\n'),
      headersOriginal: source.headers || {},
      headersChanged: false,
      toolCallTimeoutMs: source.toolCallTimeoutMs,
      failOnStartupError: source.failOnStartupError === true,
      reconnectEnabled: source.reconnect ? source.reconnect.enabled === true : false,
      reconnectInitialDelayMs: source.reconnect ? source.reconnect.initialDelayMs : 1000,
      reconnectMaxDelayMs: source.reconnect ? source.reconnect.maxDelayMs : 30000,
      reconnectMaxAttempts: source.reconnect ? source.reconnect.maxAttempts : 10,
    } : {
      // New server: pre-fill a collision-free id so the user does not have to
      // invent one; they can still edit it or regenerate it.
      id: generateMcpId(mView.mcpEntries),
      isNew: true,
      serverName: '',
      transport: 'stdio',
      command: '',
      url: '',
      args: '',
      argsOriginal: [],
      argsChanged: false,
      env: '',
      envOriginal: {},
      envChanged: false,
      cwd: '',
      headers: '',
      headersOriginal: {},
      headersChanged: false,
      toolCallTimeoutMs: undefined,
      failOnStartupError: false,
      reconnectEnabled: false,
      reconnectInitialDelayMs: 1000,
      reconnectMaxDelayMs: 30000,
      reconnectMaxAttempts: 10,
    }
    patchMcp({ mcpEditorOpen: true, mcpDraft: draft, mcpError: '' })
  }

  function closeMcpEditor() {
    patchMcp({ mcpEditorOpen: false, mcpDraft: null, mcpError: '' })
  }

  function saveMcpDraft() {
    var draft = mView.mcpDraft
    if (draft === null) return
    // A NEW entry must not collide with an existing id: the host's upsert
    // locates its target block by id and would replace that entry in place,
    // silently destroying its config. The edit form keeps its own id (the
    // field is disabled), so this guard only ever fires on the add form.
    if (draft.isNew) {
      for (var ci = 0; ci < mView.mcpEntries.length; ci++) {
        if (mView.mcpEntries[ci].id === draft.id) {
          patchMcp({ mcpError: 'ID \'' + draft.id + dshT('\' 已被其他 MCP 条目占用，请换一个再保存。') })
          return
        }
      }
    }
    // Lines without a top-level `=` cannot become pairs; they are skipped (and
    // reported in the save note) instead of silently shaping the outcome.
    var skippedPairLines = 0
    var config
    if (draft.transport === 'streamable-http') {
      config = { transport: 'streamable-http', serverName: draft.serverName, url: draft.url }
      var headersStr = Object.keys(draft.headersOriginal || {}).map(function (k) { return k + '=' + draft.headersOriginal[k] }).join('\n')
      var headers = (draft.headersChanged && draft.headers !== headersStr) ? {} : draft.headersOriginal
      if (draft.headersChanged && draft.headers !== headersStr && draft.headers !== '') {
        // Newline-only split: header values legitimately contain ';'/','
        // (Cookie, Accept), which must never become pair separators.
        var pairs = draft.headers.split('\n').map(function (s) { return s.trim() }).filter(Boolean)
        for (var i = 0; i < pairs.length; i++) {
          var eq = pairs[i].indexOf('=')
          if (eq > 0) headers[pairs[i].slice(0, eq).trim()] = pairs[i].slice(eq + 1).trim()
          else skippedPairLines += 1
        }
        // Nothing parsed out of a non-empty box: treat the field as unchanged.
        // Letting the map stay empty would drop the whole `headers` key on the
        // floor and the host would erase every stored value (including the
        // secrets); emptying the box entirely is the explicit "delete all".
        if (Object.keys(headers).length === 0) headers = draft.headersOriginal
      }
      if (Object.keys(headers).length > 0) config.headers = headers
    } else {
      config = { transport: 'stdio', serverName: draft.serverName, command: draft.command }
      var argsStr = (draft.argsOriginal || []).join(' ')
      var args = (draft.argsChanged && draft.args !== argsStr) ? draft.args.split(/\s+/).filter(Boolean) : draft.argsOriginal
      if (args.length > 0) config.args = args
      var envStr = Object.keys(draft.envOriginal || {}).map(function (k) { return k + '=' + draft.envOriginal[k] }).join('\n')
      var env = (draft.envChanged && draft.env !== envStr) ? {} : draft.envOriginal
      if (draft.envChanged && draft.env !== envStr && draft.env !== '') {
        // Newline-only split: values like PATH=C:\a;C:\b would lose their
        // tail (and Windows paths carry ';' everywhere).
        var pairs = draft.env.split('\n').map(function (s) { return s.trim() }).filter(Boolean)
        for (var i = 0; i < pairs.length; i++) {
          var eq = pairs[i].indexOf('=')
          if (eq > 0) env[pairs[i].slice(0, eq).trim()] = pairs[i].slice(eq + 1).trim()
          else skippedPairLines += 1
        }
        // Same unchanged-fallback as headers above: a box of malformed lines
        // must not silently erase the stored env map.
        if (Object.keys(env).length === 0) env = draft.envOriginal
      }
      if (Object.keys(env).length > 0) config.env = env
      if (draft.cwd !== '') config.cwd = draft.cwd
    }
    if (draft.toolCallTimeoutMs !== undefined) config.toolCallTimeoutMs = draft.toolCallTimeoutMs
    if (draft.failOnStartupError) config.failOnStartupError = true
    if (draft.reconnectEnabled) {
      config.reconnect = {
        enabled: true,
        initialDelayMs: Number(draft.reconnectInitialDelayMs),
        maxDelayMs: Number(draft.reconnectMaxDelayMs),
        maxAttempts: Number(draft.reconnectMaxAttempts),
      }
    }
    patchMcp({ mcpBusy: true, mcpError: '', mcpNote: '' })
    callRemote('mcpAdmin/upsert', { entry: { id: draft.id, config: config } }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        // The config changed, so any cached probe no longer describes this
        // server — drop it from storage and from the panel.
        clearMcpTestCacheEntry(draft.id)
        patchMcpTest(draft.id, { busy: false, result: null, error: null })
        // hotApplied=true: the host restarted the live server fiber with the
        // new config (fiber.update seam) — no restart needed. Otherwise the
        // hotReason says exactly why (new entry / not mounted / update threw).
        var value = result.value || {}
        var note = value.hotApplied
          ? dshT('✅ 已保存并热应用至运行中的 server（无需重启）')
          : (value.hotReason !== undefined ? dshT('✅ 已保存，重启 dsh 后生效 — ') + value.hotReason : dshT('✅ 已保存，重启 dsh 后生效'))
        if (skippedPairLines > 0) note += dshT('；警告：') + skippedPairLines + dshT(' 行缺少「=」已忽略')
        patchMcp({ mcpBusy: false, mcpEntries: value.entries || [], mcpEditorOpen: false, mcpDraft: null, mcpNote: note })
      } else {
        patchMcp({ mcpBusy: false, mcpError: dshT('保存 MCP 配置失败：') + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchMcp({ mcpBusy: false, mcpError: dshT('调用失败：') + messageOf(failure) })
    })
  }

  function removeMcpEntry(id) {
    patchMcp({ mcpBusy: true, mcpError: '' })
    callRemote('mcpAdmin/remove', { id: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        // The entry is gone — its cached probe must not linger in storage.
        clearMcpTestCacheEntry(id)
        patchMcp({ mcpBusy: false, mcpEntries: (result.value && result.value.entries) || [] })
      } else {
        patchMcp({ mcpBusy: false, mcpError: dshT('移除 MCP 配置失败：') + messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current) return
      patchMcp({ mcpBusy: false, mcpError: dshT('调用失败：') + messageOf(failure) })
    })
  }

  /**
   * Set one entry's connectivity-test status against the CURRENT state.
   * Settled successful probes are mirrored into localStorage so the last
   * known status survives tab switches and reopening the settings dialog.
   */
  function patchMcpTest(id, partial) {
    setMView(function (cur) {
      var nextTestState = mergeTestState(cur.mcpTestState, id, partial)
      saveMcpTestCache(nextTestState)
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.mcpTestState = nextTestState
      return next
    })
  }

  /** Run a host-side connectivity probe for one entry and stash the result. */
  function testMcpEntry(id) {
    var seq = ++testSeq.current
    patchMcpTest(id, { busy: true, result: null, error: null })
    callRemote('mcpAdmin/test', { id: id }).then(function (result) {
      if (!alive.current || seq !== testSeq.current) return
      if (result.ok && result.value !== null && typeof result.value === 'object') {
        // `at` timestamps the probe; it is what the cached label renders.
        patchMcpTest(id, { busy: false, result: result.value, at: Date.now() })
      } else {
        patchMcpTest(id, { busy: false, result: null, error: messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current || seq !== testSeq.current) return
      patchMcpTest(id, { busy: false, result: null, error: messageOf(failure) })
    })
  }

  kit.mount(reloadMcp)

  return createElement('div', { 'data-dsh-admin-section': '', className: mView.mcpEditorOpen ? 'mcp-editor-open' : '' },
    renderMcpSection(mView, patchMcp, patchDraft, patchPlayground, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry, openMcpPlayground, callRemote))
}

/* ========================================================================== */
/*                           Render Plugins View                              */
/* ========================================================================== */

function renderPluginsView(view, patch, install, remove, checkUpdates, upgrade, upgradeAll, setEnabled, loadAudit) {
  var elements = []
  // How many plugins currently flag an update — the bulk-upgrade button's count.
  var upgradeAllCount = 0
  for (var uak in view.updates) {
    var uai = view.updates[uak]
    if (uai && uai.updateAvailable && uai.latest) upgradeAllCount++
  }

  // Toolbar, two rows: search alone on the first (it gets the full width),
  // install input + actions on the second.
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar-search' },
    createElement('div', { className: 'search-wrap', key: 'search-wrap' },
      createElement(UiInput, {
        key: 'search-input',
        icon: '🔍',
        placeholder: dshT('搜索插件（名称/版本/路径）...'),
        value: view.needle,
        onChange: function (e) { patch({ needle: e.target.value }) },
      }),
      view.needle !== '' ? createElement(UiButton, {
        key: 'btn-clear-search',
        variant: 'toolbar',
        size: 'sm',
        title: dshT('清空搜索'),
        onClick: function () { patch({ needle: '' }) },
      }, '✕') : null
    ),
    // Language switch for ALL plugin panels (module-level state + reload).
    createElement('select', {
      key: 'lang-switch',
      className: 'input',
      style: { flex: 'none', width: 'auto', cursor: 'pointer' },
      title: dshT('界面语言'),
      value: currentLanguage(),
      onChange: function (e) { setAdminLang(e.target.value) },
    },
      createElement('option', { value: 'zh', key: 'zh' }, '中文'),
      createElement('option', { value: 'en', key: 'en' }, 'English')
    ),
  ))
  elements.push(createElement('div', { className: 'toolbar', key: 'toolbar-install' },
    createElement('div', { className: 'input-wrap install-wrap', key: 'install-wrap' },
      createElement(UiInput, {
        placeholder: dshT('安装包名/路径...'),
        value: view.spec,
        disabled: view.busy,
        onChange: function (e) { patch({ spec: e.target.value }) },
        onKeyDown: function (e) { if (e.key === 'Enter') install() },
      })
    ),
    createElement(UiButton, {
      key: 'btn-install',
      variant: 'primary',
      disabled: view.busy || view.spec.trim() === '',
      onClick: install,
    },
      view.busy ? createElement('span', { className: 'spinner', key: 'spin' }) : null,
      dshT('安装')
    ),
    createElement(UiButton, {
      key: 'btn-check-updates',
      variant: 'outline',
      disabled: view.busy || view.checkingUpdates,
      title: dshT('强制绕过 5 分钟缓存，重新查询 registry 并刷新缓存'),
      onClick: function () { checkUpdates(true) },
    },
      view.checkingUpdates ? createElement('span', { className: 'spinner', key: 'spin' }) : null,
      view.checkingUpdates ? dshT('检查中...') : dshT('⬆️ 检查更新')
    ),
    createElement(UiButton, {
      key: 'btn-upgrade-all',
      variant: 'outline',
      disabled: view.busy || view.checkingUpdates || upgradeAllCount === 0,
      title: upgradeAllCount > 0
        ? dshT('串行升级全部有新版本的插件（') + upgradeAllCount + dshT(' 个），单个失败不阻塞其余')
        : dshT('没有待更新的插件（先「检查更新」）'),
      onClick: function () { upgradeAll() },
    },
      view.bulkUpdate !== null
        ? dshT('更新中 ') + view.bulkUpdate.done + ' / ' + view.bulkUpdate.total + (view.bulkUpdate.failed.length > 0 ? dshT('（') + view.bulkUpdate.failed.length + dshT(' 失败）') : '')
        : dshT('⬆⬆ 全部更新') + (upgradeAllCount > 0 ? ' (' + upgradeAllCount + ')' : '')
    ),
  ))

  // Filter Pills
  var totalPlugins = view.plugins.length
  var thirdPartyCount = 0
  var builtinCount = 0
  for (var i = 0; i < view.plugins.length; i++) {
    if (view.plugins[i].removable) thirdPartyCount++
    else builtinCount++
  }

  elements.push(createElement('div', { className: 'filter-bar', key: 'filters' },
    createElement(UiPill, {
      key: 'filter-all',
      active: view.filter === 'all',
      onClick: function () { patch({ filter: 'all' }) },
    }, dshT('全部 (') + String(totalPlugins) + ')'),
    createElement(UiPill, {
      key: 'filter-plugin',
      active: view.filter === 'plugin',
      onClick: function () { patch({ filter: 'plugin' }) },
    }, dshT('扩展插件 (') + String(thirdPartyCount) + ')'),
    createElement(UiPill, {
      key: 'filter-builtin',
      active: view.filter === 'builtin',
      onClick: function () { patch({ filter: 'builtin' }) },
    }, dshT('系统内置 (') + String(builtinCount) + ')')
  ))

  // Busy banner / Error
  if (view.busy) {
    elements.push(createElement('div', { className: 'busy-banner', key: 'busy' },
      createElement('span', { className: 'spinner', key: 'spin' }),
      dshT('正在执行 pnpm 操作（可能需要数秒至数分钟，请勿关闭窗口）...')
    ))
  }
  if (view.error !== '') {
    elements.push(createElement('div', { className: 'error', key: 'error' }, view.error))
  }

  // Update-check status strip: gives the auto-check a visible outcome instead
  // of hiding it in the footer. Checking → spinner; done with updates →
  // orange; done without updates → green; per-plugin query failures surface
  // on the strip rather than vanishing. Purely informational — the single
  // re-check entry point is the toolbar「⬆️ 检查更新」button (which forces a
  // fresh registry query), so no redundant button lives in the strip.
  if (view.checkingUpdates) {
    elements.push(createElement('div', { className: 'update-strip checking', key: 'update-checking' },
      createElement('span', { className: 'spinner', key: 'spin' }),
      dshT('正在检查插件版本更新…')
    ))
  } else if (view.updateChecked) {
    var upCount = 0
    var errCount = 0
    for (var un in view.updates) {
      if (view.updates[un].updateAvailable === true) upCount++
      if (view.updates[un].error) errCount++
    }
    var stripClass = upCount > 0 ? 'update-strip has-updates'
      : (errCount > 0 ? 'update-strip has-errors' : 'update-strip ok')
    var stripText = upCount > 0
      ? dshT('⬆️ 发现 ') + upCount + dshT(' 个插件有新版本，可点击卡片上的「更新」升级')
      : (errCount > 0
        ? dshT('⚠️ 有 ') + errCount + dshT(' 个插件查询版本失败（网络或 registry 不可达）')
        : dshT('✅ 已自动检查版本更新，全部为最新版本'))
    elements.push(createElement('div', { className: stripClass, key: 'update-result' },
      createElement('span', { key: 't' }, stripText)
    ))
  }

  // Filter and render rows
  var needle = view.needle.trim().toLowerCase()
  var filtered = filterPlugins(view.plugins, view.filter, needle)
  var rows = []
  for (var j = 0; j < filtered.length; j++) {
    var p = filtered[j]
    rows.push(renderPluginCard(p, view, remove, patch, upgrade, setEnabled))
  }

  if (rows.length === 0) {
    rows.push(createElement('div', { className: 'empty', key: 'empty' },
      createElement('div', null, needle !== '' ? dshT('🔍 无匹配的插件（试试其他关键词）') : dshT('📦 暂无匹配的插件层'))
    ))
  }

  elements.push(createElement('div', { className: 'list grid2', key: 'list' }, rows))

  // Footer
  var hintText = view.note !== '' ? view.note : dshT('更改在重启 dsh 后生效（关闭 dsh 进程后重新运行即可）')
  var hintTitle = view.output !== '' ? dshT('pnpm 输出：\n') + view.output : undefined
  // Phase F3: privileged-action audit trail (install/remove, hooks writes,
  // session deletion, ...). Loaded on demand: the host reads a file.
  elements.push(createElement('div', { className: 'card', key: 'audit' },
    createElement('div', { className: 'card-header' },
      createElement('span', { className: 'card-title-text' }, dshT('操作审计')),
      createElement(UiButton, {
        variant: 'outline',
        size: 'sm',
        disabled: view.auditBusy === true,
        onClick: function () { loadAudit() },
      }, view.auditBusy === true ? dshT('加载中…') : dshT('加载审计')),
    ),
    view.auditError ? createElement('div', { className: 'error', key: 'audit-error' }, view.auditError) : null,
    Array.isArray(view.auditEntries) === false
      ? createElement('div', { className: 'empty', key: 'audit-empty' },
        dshT('尚未加载。审计记录特权动作（安装/卸载插件、写入钩子、删除会话等）。文件：') + (view.auditPath || '—'))
      : (view.auditEntries.length === 0
        ? createElement('div', { className: 'empty', key: 'audit-none' }, dshT('暂无记录。'))
        : createElement('div', { className: 'audit-list', key: 'audit-list' }, view.auditEntries.slice(0, 30).map(function (entry, index) {
          return createElement('div', { className: 'audit-row', key: index },
            createElement('span', { className: 'audit-time' }, formatDate(entry.at)),
            createElement('span', { className: 'audit-action' + (entry.ok === false ? ' bad' : '') }, String(entry.action || '')),
            createElement('span', { className: 'audit-detail' }, String(entry.detail || entry.error || '')))
        }))),
  ))
  elements.push(createElement('div', { className: 'footer', key: 'footer' },
    createElement('span', { className: 'path', key: 'profile-path', title: view.profileDir }, view.profileDir || dshT('Profile: 默认')),
    createElement('span', { className: 'hint', key: 'hint', title: hintTitle }, hintText)
  ))

  return createElement('div', { key: 'plugins-panel', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, elements)
}


function renderMcpSection(view, patchMcp, patchDraft, patchPlayground, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry, openMcpPlayground, callRemote) {
  var children = []
  var header = createElement('div', { className: 'group-header', key: 'mcp-header', style: { marginTop: 0 } },
    createElement('span', { className: 'group-title', key: 't' }, dshT('🔌 MCP 配置')),
    createElement('span', { className: 'group-count', key: 'c' }, String(view.mcpEntries.length) + dshT(' 个')),
    createElement(UiButton, {
      type: 'button',
      key: 'btn-refresh-mcp',
      variant: 'outline',
      disabled: view.mcpBusy,
      onClick: reloadMcp,
    }, dshT('🔄 刷新')),
    createElement(UiButton, {
      type: 'button',
      key: 'btn-add-mcp',
      variant: 'primary',
      disabled: view.mcpBusy,
      onClick: function () { openMcpEditor(null) },
    }, dshT('➕ 添加服务器')),
  )
  children.push(header)

  if (view.mcpError !== '') {
    children.push(createElement('div', { className: 'error', key: 'mcp-error' }, view.mcpError))
  }
  if (view.mcpNote !== '') {
    children.push(createElement('div', { className: 'note-ok', key: 'mcp-note' }, view.mcpNote))
  }

  var rows = []
  for (var i = 0; i < view.mcpEntries.length; i++) {
    var entry = view.mcpEntries[i]
    var tag = createElement('span', { className: 'tag plugin', key: 'mcp-tag-' + entry.id },
      'MCP ' + String(entry.serverName || entry.id))
    var testState = (view.mcpTestState && view.mcpTestState[entry.id]) || null
    var testIndicator = null
    if (testState !== null && testState.busy) {
      testIndicator = createElement('span', { className: 'mcp-test mcp-test-busy', key: 'test-busy' },
        createElement('span', { className: 'spinner', key: 'sp' }),
        dshT(' 检测中...'))
    } else if (testState !== null && testState.result !== null && testState.result !== undefined) {
      var r = testState.result
      var ok = r.ok === true
      var label = ok ? dshT('✅ 连通')
        : dshT('❌ 不通')
      var detail = ok
        ? (r.serverInfo ? (r.serverInfo.name || '') + (r.serverInfo.version ? ' v' + r.serverInfo.version : '') : '') +
          (typeof r.toolCount === 'number' ? ' · ' + r.toolCount + dshT(' 个工具') : '') +
          (r.pingOk === false ? dshT(' · 初始化成功但 ping 失败') : '')
        : (r.error || dshT('连接失败')) + (r.ms !== undefined ? ' (' + r.ms + 'ms)' : '')
      var detailChildren = [
        createElement('span', { key: 'lbl' }, label + (detail !== '' ? ' ' + detail : '')),
      ]
      if (ok && Array.isArray(r.tools) && r.tools.length > 0) {
        detailChildren.push(createElement('span', { key: 'tools-hint', style: { color: 'var(--dsw-alias-label-secondary, #61666b)' } },
          dshT('工具：') + r.tools.join(dshT('、'))))
      }
      if (r.warning) {
        detailChildren.push(createElement('span', { key: 'warn', className: 'mcp-test-warn', title: r.warning },
          '⚠️ ' + r.warning))
      }
      // Cached probe: label when it was taken so a restored status is never
      // mistaken for a just-run check. Clicking 🔌 测试 refreshes it.
      if (typeof testState.at === 'number') {
        detailChildren.push(createElement('span', {
          key: 'cached-at',
          className: 'mcp-test-cached',
          title: dshT('上次检测结果（本地缓存）。点击「🔌 测试」可重新检测。'),
        }, dshT('· 缓存于 ') + formatTestTime(testState.at)))
      }
      testIndicator = createElement('div', {
        className: 'mcp-test mcp-test-list ' + (ok ? 'mcp-test-ok' : 'mcp-test-fail'),
        key: 'test-result',
        title: detail,
      }, detailChildren)
    } else if (testState !== null && testState.error !== null && testState.error !== undefined) {
      testIndicator = createElement('span', {
        className: 'mcp-test mcp-test-fail',
        key: 'test-error',
        title: testState.error,
      }, '❌ ' + testState.error)
    }
    var rowChildren = [
      createElement('div', { className: 'card-header', key: 'h' },
        createElement('span', { className: 'card-title-text', key: 'name' }, entry.id),
        tag,
        createElement('div', { className: 'card-actions', key: 'a' },
          createElement(UiButton, {
            type: 'button',
            variant: 'outline',
            size: 'sm',
            disabled: view.mcpBusy || (testState !== null && testState.busy) || entry.config === null || entry.config === undefined,
            title: entry.config === null || entry.config === undefined ? dshT('该配置无法安全解析，请手动编辑 cordis.patch.yml') : (testState !== null && testState.busy ? dshT('检测中...') : (testState !== null && typeof testState.at === 'number' ? dshT('重新检测该服务器的连通性（当前显示的是缓存结果）') : dshT('测试该服务器的连通性'))),
            onClick: function (id) { return function () { testMcpEntry(id) } }(entry.id),
          }, testState !== null && testState.busy ? dshT('检测中') : dshT('🔌 测试')),
          createElement(UiButton, {
            type: 'button',
            variant: 'outline',
            size: 'sm',
            key: 'btn-playground',
            disabled: view.mcpBusy || (testState !== null && testState.busy) || entry.config === null || entry.config === undefined,
            title: dshT('试调用该服务器的工具（会真实执行，先「🔌 测试」获取工具列表）'),
            onClick: function (value) { return function () { openMcpPlayground(value) } }(entry),
          }, dshT('🧪 试调用')),
          createElement(UiButton, {
            type: 'button',
            variant: 'outline',
            size: 'sm',
            disabled: view.mcpBusy || (testState !== null && testState.busy) || entry.config === null || entry.config === undefined,
            title: entry.config === null || entry.config === undefined ? dshT('该配置无法安全解析，请手动编辑 cordis.patch.yml') : undefined,
            onClick: function (value) { return function () { openMcpEditor(value) } }(entry),
          }, dshT('编辑')),
      createElement(UiButton, {
        type: 'button',
        variant: 'outline',
        size: 'sm',
        className: 'danger',
        disabled: view.mcpBusy,
        // Opens the confirm bar below instead of deleting: 移除 drops the
        // whole block (secret-bearing headers included) from
        // cordis.patch.yml, so it takes the same second click every other
        // destructive action in this panel does.
        onClick: function (id) { return function () { patchMcp({ mcpConfirmRemove: id }) } }(entry.id),
      }, dshT('移除')),
      ),
    ),
  ]
  if (testIndicator !== null) {
    rowChildren.push(createElement('div', { className: 'mcp-test-row', key: 'test-row' }, testIndicator))
  }
  if (view.mcpConfirmRemove === entry.id) {
    rowChildren.push(createElement('div', { className: 'confirm-bar', key: 'confirm-remove' },
      createElement('span', { className: 'confirm-text', key: 'text' },
        dshT('⚠️ 确定从 cordis.patch.yml 移除该 MCP 服务器配置？整块配置（含 headers 中的密钥行）会被删除。')),
      createElement('div', { className: 'confirm-actions', key: 'actions' },
        createElement(UiButton, {
          type: 'button',
          key: 'btn-confirm-remove',
          variant: 'outline',
          size: 'sm',
          className: 'danger-solid',
          disabled: view.mcpBusy,
          onClick: function (id) { return function () { patchMcp({ mcpConfirmRemove: null }); removeMcpEntry(id) } }(entry.id),
        }, dshT('确认移除')),
        createElement(UiButton, {
          type: 'button',
          key: 'btn-cancel-remove',
          variant: 'outline',
          size: 'sm',
          disabled: view.mcpBusy,
          onClick: function () { patchMcp({ mcpConfirmRemove: null }) },
        }, dshT('取消')),
      ),
    ))
  }
  rows.push(createElement('div', { className: 'card', key: 'mcp-' + entry.id }, rowChildren))
  }
  if (rows.length === 0 && !view.mcpEditorOpen) {
    rows.push(createElement('div', { className: 'empty', key: 'mcp-empty' },
      createElement('div', null, dshT('🔌 暂无 MCP 服务器配置'))
    ))
  }
  children.push(createElement('div', { className: 'list', key: 'mcp-list' }, rows))

  // Editor form. patchDraft merges against the CURRENT draft in state so
  // typing across fields never clobbers earlier edits (stale-closure guard).
  if (view.mcpEditorOpen && view.mcpDraft !== null) {
    var d = view.mcpDraft
    var fieldStyle = { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }
    var labelStyle = { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #666)' }
    /** Write-only-field note under the env / headers textareas. */
    var secretHintStyle = { fontSize: '10px', lineHeight: '1.45', color: 'var(--dsw-alias-label-tertiary, #999)' }
    // 'mcp-editor' is the scroll-viewport class (max-height + overflow-y +
    // sticky actions in CSS): a tall add/edit form scrolls inside the bounded
    // settings dialog instead of pushing the 取消/保存 row out of reach.
    var editor = createElement('div', { className: 'card mcp-editor', key: 'mcp-editor' },
      createElement('div', { className: 'card-header', key: 'h' },
        createElement('span', { className: 'card-title-text', key: 't' }, d.isNew ? dshT('添加 MCP 服务器') : dshT('编辑 ') + d.id),
      ),
      createElement('div', { style: fieldStyle, key: 'f-id' },
        createElement('label', { style: labelStyle }, dshT('ID（唯一标识，[A-Za-z0-9_-]）')),
        createElement('div', { style: { display: 'flex', gap: '6px' } },
          createElement(UiInput, {
            value: d.id,
            disabled: !d.isNew,
            onChange: function (e) { patchDraft({ id: e.target.value }) },
          }),
          d.isNew ? createElement(UiButton, {
            type: 'button',
            variant: 'outline',
            size: 'sm',
            title: dshT('重新生成一个随机 ID'),
            onClick: function () { patchDraft({ id: generateMcpId(view.mcpEntries) }) },
          }, '🎲') : null,
        ),
      ),
      createElement('div', { style: fieldStyle, key: 'f-server' },
        createElement('label', { style: labelStyle }, dshT('serverName（模型命名空间）')),
        createElement(UiInput, {
          value: d.serverName,
          onChange: function (e) { patchDraft({ serverName: e.target.value }) },
        }),
      ),
      createElement('div', { style: fieldStyle, key: 'f-transport' },
        createElement('label', { style: labelStyle }, dshT('传输方式')),
        createElement('select', {
          className: 'input',
          value: d.transport,
          onChange: function (e) { patchDraft({ transport: e.target.value }) },
        },
          createElement('option', { value: 'stdio' }, dshT('stdio（子进程）')),
          createElement('option', { value: 'streamable-http' }, 'streamable-http（HTTP）'),
        ),
      ),
      d.transport === 'stdio' ? createElement('div', { style: fieldStyle, key: 'f-cmd' },
        createElement('label', { style: labelStyle }, dshT('command（启动命令）')),
        createElement(UiInput, {
          value: d.command,
          placeholder: 'npx -y @modelcontextprotocol/server-github',
          onChange: function (e) { patchDraft({ command: e.target.value }) },
        }),
      ) : createElement('div', { style: fieldStyle, key: 'f-url' },
        createElement('label', { style: labelStyle }, dshT('url（MCP 端点）')),
        createElement(UiInput, {
          value: d.url,
          placeholder: 'http://localhost:3000/mcp',
          onChange: function (e) { patchDraft({ url: e.target.value }) },
        }),
      ),
      d.transport === 'streamable-http' ? createElement('div', { style: fieldStyle, key: 'f-headers' },
        createElement('label', { style: labelStyle }, dshT('headers（每行 KEY=VALUE，可选）')),
        createElement('textarea', {
          className: 'input',
          style: { minHeight: '48px' },
          value: d.headers,
          onChange: function (e) { patchDraft({ headers: e.target.value, headersChanged: true }) },
        }),
        createElement('div', { style: secretHintStyle }, dshT('已存的 header 只回键名（值不回传浏览器）：留空即沿用已存的值，删掉整行才会移除该键。')),
      ) : null,
      d.transport === 'stdio' ? createElement('div', { style: fieldStyle, key: 'f-args' },
        createElement('label', { style: labelStyle }, dshT('args（空格分隔，可选）')),
        createElement(UiInput, {
          value: d.args,
          onChange: function (e) { patchDraft({ args: e.target.value, argsChanged: true }) },
        }),
      ) : null,
      d.transport === 'stdio' ? createElement('div', { style: fieldStyle, key: 'f-env' },
        createElement('label', { style: labelStyle }, dshT('env（每行 KEY=VALUE，可选）')),
        createElement('textarea', {
          className: 'input',
          style: { minHeight: '48px' },
          value: d.env,
          onChange: function (e) { patchDraft({ env: e.target.value, envChanged: true }) },
        }),
        createElement('div', { style: secretHintStyle }, dshT('已存的环境变量只回键名（值不回传浏览器）：留空即沿用已存的值，删掉整行才会移除该变量。')),
      ) : null,
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', marginBottom: '4px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.3))', paddingTop: '8px' }, key: 'f-reconnect-header' },
        createElement(UiCheckbox, {
          checked: d.reconnectEnabled,
          onChange: function (next) { patchDraft({ reconnectEnabled: next }) },
          label: dshT('启用自动重连'),
        }),
      ),
      d.reconnectEnabled ? createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px', paddingLeft: '4px' }, key: 'f-reconnect-fields' },
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 120px' }, key: 'f-reconnect-id' },
          createElement('label', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #666)' } }, 'initialDelayMs'),
          createElement(UiInput, {
            type: 'number',
            min: 0,
            value: d.reconnectInitialDelayMs,
            onChange: function (e) { patchDraft({ reconnectInitialDelayMs: Number(e.target.value) }) },
          }),
        ),
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 120px' }, key: 'f-reconnect-md' },
          createElement('label', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #666)' } }, 'maxDelayMs'),
          createElement(UiInput, {
            type: 'number',
            min: 0,
            value: d.reconnectMaxDelayMs,
            onChange: function (e) { patchDraft({ reconnectMaxDelayMs: Number(e.target.value) }) },
          }),
        ),
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 120px' }, key: 'f-reconnect-ma' },
          createElement('label', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #666)' } }, 'maxAttempts'),
          createElement(UiInput, {
            type: 'number',
            min: 0,
            value: d.reconnectMaxAttempts,
            onChange: function (e) { patchDraft({ reconnectMaxAttempts: Number(e.target.value) }) },
          }),
        ),
      ) : null,
      createElement('div', { className: 'card-actions', key: 'f-actions', style: { justifyContent: 'flex-end', gap: '6px' } },
        createElement(UiButton, {
          type: 'button',
          variant: 'outline',
          disabled: view.mcpBusy,
          onClick: closeMcpEditor,
        }, dshT('取消')),
        createElement(UiButton, {
          type: 'button',
          variant: 'primary',
          disabled: view.mcpBusy || d.id.trim() === '' || d.serverName.trim() === '' ||
            (d.transport === 'stdio' ? d.command.trim() === '' : d.url.trim() === ''),
          onClick: saveMcpDraft,
        }, view.mcpBusy ? dshT('保存中...') : dshT('保存')),
      ),
    )
    children.push(editor)
  }

  // MCP playground: pick a tool from the last probe's list, paste JSON
  // arguments, run it for real, and read the normalized result.
  if (view.mcpPlayground !== null && !view.mcpEditorOpen) {
    children.push(renderMcpPlayground(view.mcpPlayground, patchPlayground, callRemote))
  }

  return createElement('div', { key: 'mcp-section', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, children)
}

// Characters allowed in an MCP entry id: [A-Za-z0-9_-]. The random part uses
// alphanumerics only so the generated id reads cleanly and always matches the
// host-side validation regex.
var MCP_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/**
 * Generate a fresh MCP entry id that is not already used by any listed entry
 * (an id collision would silently overwrite the existing entry on upsert).
 */
function generateMcpId(entries) {
  var taken = {}
  for (var i = 0; i < entries.length; i++) taken[entries[i].id] = true
  var candidate
  do {
    candidate = 'mcp-'
    for (var j = 0; j < 8; j++) {
      candidate += MCP_ID_ALPHABET.charAt(Math.floor(Math.random() * MCP_ID_ALPHABET.length))
    }
  } while (taken[candidate])
  return candidate
}

function mergeDraft(draft, partial) {
  var next = {}
  for (var k in draft) next[k] = draft[k]
  for (var pk in partial) next[pk] = partial[pk]
  return next
}

/** Set one entry's test status inside the shared mcpTestState map. */
function mergeTestState(map, id, partial) {
  var next = {}
  for (var k in map) next[k] = map[k]
  next[id] = {}
  var cur = map[id] || {}
  for (var ck in cur) next[id][ck] = cur[ck]
  for (var pk in partial) next[id][pk] = partial[pk]
  return next
}
function renderPluginCard(plugin, view, remove, patch, upgrade, setEnabled) {
  var isConfirming = view.confirming === plugin.name

  // Row 1: the name alone, truncating with ellipsis.
  var header = createElement('div', { className: 'card-header', key: 'header' },
    createElement('div', { className: 'card-title', key: 'title' },
      createElement('span', { className: 'card-title-text', key: 'name', title: plugin.name }, plugin.name)))

  // Row 2: version + source + status badges on one wrapping meta line.
  var metaChildren = []
  if (plugin.version) {
    metaChildren.push(createElement('span', { className: 'tag version', key: 'version' }, 'v' + plugin.version))
  }
  var isLocal = Boolean(plugin.localPath)
  metaChildren.push(createElement('span', {
    className: plugin.removable ? (isLocal ? 'tag local' : 'tag plugin') : 'tag',
    key: 'type-tag',
  },
    plugin.removable ? (isLocal ? dshT('本地安装') : dshT('包安装')) : dshT('内置')
  ))
  if (plugin.disabled) {
    metaChildren.push(createElement('span', {
      className: 'tag update-error', key: 'disabled-badge',
      title: dshT('profile patch 中已写入该插件的停用行 — 重启 dsh 后不再挂载；点「启用」恢复'),
    }, dshT('⏸ 已停用')))
  }

  // Remote update badge: only for registry-installed bundles (removable and
  // not a local path) after a check ran. `updates` is keyed by plugin name.
  // It gets its own line right under the name; check failures stay on the
  // meta line.
  var updateInfo = view.updates && view.updates[plugin.name]
  var updateBadge = null
  if (updateInfo && updateInfo.updateAvailable && updateInfo.latest) {
    updateBadge = createElement('span', {
      className: 'tag update',
      key: 'update-badge',
      title: dshT('远程 registry 有新版本：v') + updateInfo.latest + dshT('（当前 v') + plugin.version + dshT('）')
        + (typeof updateInfo.at === 'number' && updateInfo.at > 0 ? dshT('，检测于 ') + formatTestTime(updateInfo.at) + dshT('，更新后提醒自动消除') : ''),
    }, dshT('⬆ 有新版本 v') + updateInfo.latest)
  } else if (updateInfo && updateInfo.error) {
    metaChildren.push(createElement('span', {
      className: 'tag update-error',
      key: 'update-error',
      title: updateInfo.error,
    }, dshT('⚠ 更新检查失败')))
  }

  var cardChildren = [header]
  if (updateBadge) {
    cardChildren.push(createElement('div', { className: 'card-sub', key: 'update-line' }, [updateBadge]))
  }

  // Meta line: version + source tags with the action buttons trailing them
  // (buttons are replaced by the confirm bar while confirming).
  if (plugin.removable && !isConfirming) {
    var actionChildren = []
    // 停用/启用 toggle — bundles whose patch composes rows only. One click,
    // reversible, no pnpm; the note explains the restart requirement.
    if (plugin.disablable && typeof setEnabled === 'function') {
      actionChildren.push(createElement(UiButton, {
        type: 'button',
        key: 'btn-toggle-enabled',
        variant: 'outline',
        size: 'sm',
        disabled: view.busy,
        title: plugin.disabled
          ? dshT('移除 profile patch 中的停用行（重启 dsh 后恢复挂载）')
          : dshT('写入停用行到 profile patch（不卸载、保留配置；重启 dsh 后不再挂载）'),
        onClick: function () { setEnabled(plugin.name, !plugin.disabled) },
      }, plugin.disabled ? dshT('▶ 启用') : dshT('⏸ 停用')))
    }
    // 更新 button — only when an update is available and the plugin is a
    // registry install (not local path).
    if (updateInfo && updateInfo.updateAvailable && updateInfo.latest && !isLocal) {
      actionChildren.push(createElement(UiButton, {
        type: 'button',
        key: 'btn-upgrade',
        variant: 'outline',
        size: 'sm',
        disabled: view.busy,
        title: dshT('升级到 v') + updateInfo.latest + '（npm install ' + plugin.name + '@' + updateInfo.latest + dshT('）'),
        onClick: function () { upgrade(plugin.name) },
      }, dshT('⬆ 更新')))
    }
    actionChildren.push(createElement(UiButton, {
      type: 'button',
      key: 'btn-remove',
      variant: 'outline',
      size: 'sm',
      className: 'danger',
      disabled: view.busy,
      onClick: function () { patch({ confirming: plugin.name }) },
    }, dshT('卸载')))
    metaChildren.push(createElement('div', { className: 'card-actions', key: 'actions' }, actionChildren))
  }
  cardChildren.push(createElement('div', { className: 'card-sub', key: 'meta' }, metaChildren))

  if (plugin.localPath) {
    cardChildren.push(createElement('div', { className: 'plugin-path', key: 'path', title: plugin.localPath },
      '📂 ' + plugin.localPath
    ))
  }

  if (isConfirming) {
    cardChildren.push(createElement('div', { className: 'confirm-bar', key: 'confirm' },
      createElement('span', { className: 'confirm-text', key: 'text' }, dshT('⚠️ 确定要卸载该插件吗？')),
      createElement('div', { className: 'confirm-actions', key: 'actions' },
        createElement(UiButton, {
          type: 'button',
          key: 'btn-confirm',
          variant: 'outline',
          size: 'sm',
          className: 'danger-solid',
          disabled: view.busy,
          onClick: function () { remove(plugin.name) },
        }, dshT('确认卸载')),
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

  return createElement('div', { key: plugin.name, className: 'card' }, cardChildren)
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
function liveHint() {
  return dshT('会话在线：仍挂载于 dsh host 内存（本进程内创建或打开过的会话保持在线，不代表正在运行）；可直接"关停并删除"（会中断该会话正在进行的对话）')
}

// Render caps: a multi-thousand-entry list must not freeze the settings page.
// Truncation is always rendered as a visible note; the filter narrows instead
// of the DOM growing.
var SESSION_RENDER_CAP = 400
var FULLTEXT_RENDER_CAP = 200
var SKILLS_RENDER_CAP = 400

/**
 * Canonical session status. Live takes precedence over archived (a session
 * that is both live and in the archived set is shown as 会话在线); otherwise
 * archived wins over ended. Used by both the filter pills and the pill
 * counts so they can never disagree about membership.
 */
function sessionStatus(s) {
  if (s.live) return 'live'
  if (s.archived) return 'archived'
  return 'ended'
}

// Pinned sessions (Claude Code #55291-style): a local, order-restoring
// whitelist of session ids the user stars in the history page. Persisted in
// localStorage — the host registry has no such concept and inventing one on
// the durable side would couple a UI preference to workspace accounting.
var PINNED_SESSIONS_KEY = 'dsh-plugin-admin/pinned-sessions'

function loadPinnedIds() {
  try {
    var raw = window.localStorage.getItem(PINNED_SESSIONS_KEY)
    var parsed = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string' }) : []
  } catch (e) { return [] }
}

function savePinnedIds(ids) {
 try { window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(ids)) } catch (e) { /* private mode */ }
}

// Collapsed directory groups in the session list: a local display preference
// (which workspace buckets the user folded shut). Persisted like the pin
// whitelist; the host has no concept of it.
var COLLAPSED_GROUPS_KEY = 'dsh-plugin-admin/collapsed-groups'

function loadCollapsedGroups() {
 try {
 var raw = window.localStorage.getItem(COLLAPSED_GROUPS_KEY)
 var parsed = raw === null ? [] : JSON.parse(raw)
 return Array.isArray(parsed) ? parsed.filter(function (k) { return typeof k === 'string' }) : []
 } catch (e) { return [] }
}

function saveCollapsedGroups(keys) {
 try { window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(keys)) } catch (e) { /* private mode */ }
}

/** Compact token count: 940 / 12.3k / 4.5M. */
function formatTokenCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return ''
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  // 999_999 must not wear a 'k': rounding to one decimal crosses the unit.
  if (n < 999_950) return (Math.round(n / 100) / 10) + 'k'
  return (Math.round(n / 100000) / 10) + 'M'
}

/** One-card usage tag: "↑1.2k ↓340 · 缓存8.9k" — empty when no usage. */
function formatUsageTag(tokens) {
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
 * 用量仪表盘 settings page (standalone settings-nav entry). Loads the row
 * data once on mount, then all range/project slicing happens client-side.
 */
function UsageDashboardSection(props) {
  var call = props.call
  var kit = sectionState({
    open: true, loading: true, rows: [], range: '30d', project: '',
    storagePath: null, snapshotIntervalMs: 0, lastSnapshotAt: null,
  })
  var usage = kit.state
  var setUsage = kit.set
  var alive = kit.alive

  function patchUsage(partial) {
    kit.patch(partial)
  }

  function reloadUsage() {
    patchUsage({ loading: true, error: null })
    call('sessionAdmin/usageReport', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var value = result.value || {}
        patchUsage({
          loading: false,
          rows: value.rows || [],
          storagePath: typeof value.storagePath === 'string' ? value.storagePath : null,
          snapshotIntervalMs: typeof value.snapshotIntervalMs === 'number' ? value.snapshotIntervalMs : 0,
          lastSnapshotAt: typeof value.lastSnapshotAt === 'number' ? value.lastSnapshotAt : null,
        })
      } else patchUsage({ loading: false, error: messageOf(result.error) })
    }, function (failure) {
      if (alive.current) patchUsage({ loading: false, error: messageOf(failure) })
    })
  }

  kit.mount(reloadUsage)

  // Minutes read better than milliseconds for an hourly bookkeeping sweep.
  var sweepMinutes = Math.round(usage.snapshotIntervalMs / 60000)
  var sweepOn = usage.snapshotIntervalMs > 0
  var sweepCadence = sweepMinutes >= 1 ? sweepMinutes + dshT(' 分钟') : Math.round(usage.snapshotIntervalMs / 1000) + dshT(' 秒')
  var sweepHint = sweepOn
    ? dshT('每 ') + sweepCadence + dshT('自动快照会话用量到台账')
      + (usage.lastSnapshotAt !== null ? dshT('；最近一次 ') + new Date(usage.lastSnapshotAt).toLocaleTimeString() : '')
      + (usage.storagePath ? dshT('（') + usage.storagePath + dshT('）') : '')
    : dshT('后台自动快照已关闭（config.usageSnapshotIntervalMs = 0）——只有打开本页时才会记录用量')

  return createElement('div', { 'data-dsh-admin-section': '' },
    createElement('div', { className: 'toolbar usage-head' },
      createElement('span', { className: 'title' }, dshT('📊 用量仪表盘')),
      createElement('span', { className: 'usage-sub' }, dshT('VibeUsage 姿态 · 本地聚合')),
      // ONE state chip: the sweep cadence. The deleted-session count used to
      // ride a second chip here; the rows are still retained in the ledger,
      // they just no longer need a badge on this row.
      createElement('span', { className: 'usage-chip ' + (sweepOn ? 'on' : 'off'), title: sweepHint },
        createElement('span', { className: 'dot' }),
        dshT('自动快照'),
        createElement('span', { className: 'sep' }, '·'),
        sweepOn ? sweepCadence : dshT('已关闭')),
      createElement('span', { className: 'spacer' }),
      createElement(UiButton, { variant: 'outline', disabled: usage.loading === true, onClick: reloadUsage, 'aria-label': dshT('重新统计') },
        usage.loading === true ? createElement('span', { className: 'spinner' }) : null, dshT('↻ 重新统计'))),
    usage.error ? createElement('div', { className: 'error' }, usage.error) : null,
    renderUsageDashboard(usage, patchUsage))
}

/**
 * The usage dashboard (VibeUsage posture): date-range pills, a project
 * filter, two rows of KPI cards with vs-previous-period deltas, a stacked
 * daily trend chart, a weekday-x-hour activity heatmap, and locally-derived
 * insights. All analytics run client-side over the host's per-session rows,
 * so range/filter changes never re-fetch.
 */
function renderUsageDashboard(usage, patch) {
  var rangeLabels = [
    ['today', dshT('今天')], ['24h', '24H'], ['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['all', dshT('全部')],
  ]
  var range = usage.range || '30d'
  var project = usage.project || ''
  var rows = Array.isArray(usage.rows) ? usage.rows : []

  // --- slice by date range + project ---
  var now = Date.now()
  var dayMs = 86400000
  var startMs = null
  if (range === 'today') {
    var d0 = new Date(); d0.setHours(0, 0, 0, 0); startMs = d0.getTime()
  } else if (range !== 'all') {
    var span = { '24h': dayMs, '7d': 7 * dayMs, '30d': 30 * dayMs, '90d': 90 * dayMs }[range]
    if (span !== undefined) startMs = now - span
  }
  var prevStartMs = startMs === null ? null : startMs - (now - startMs)
  var cur = []
  var prev = []
  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri]
    if (project !== '' && r.project !== project) continue
    if (startMs !== null && r.createdAt >= startMs) cur.push(r)
    else if (prevStartMs !== null && r.createdAt >= prevStartMs) prev.push(r)
    else if (startMs === null) cur.push(r)
  }

  // --- KPI math (current vs previous window) ---
  function kpiOf(list) {
    var k = { sessions: list.length, input: 0, output: 0, cacheRead: 0, userMsgs: 0, assistantMsgs: 0 }
    var days = {}
    for (var i = 0; i < list.length; i++) {
      var x = list[i]
      k.input += x.input || 0
      k.output += x.output || 0
      k.cacheRead += x.cacheRead || 0
      k.userMsgs += x.userMsgs || 0
      k.assistantMsgs += x.assistantMsgs || 0
      days[usageDayKey(x.createdAt)] = true
    }
    k.tokens = k.input + k.output + k.cacheRead
    k.activeDays = Object.keys(days).length
    return k
  }
  var curK = kpiOf(cur)
  var prevK = kpiOf(prev)
  function deltaPct(curV, prevV) {
    if (prevV <= 0) return null
    return Math.round(((curV - prevV) / prevV) * 1000) / 10
  }

  // --- daily stacked buckets (current range) ---
  var dayMap = {}
  for (var di = 0; di < cur.length; di++) {
    var dayKey = usageDayKey(cur[di].createdAt)
    var b = dayMap[dayKey]
    if (b === undefined) { b = { input: 0, output: 0, cacheRead: 0 }; dayMap[dayKey] = b }
    b.input += cur[di].input || 0
    b.output += cur[di].output || 0
    b.cacheRead += cur[di].cacheRead || 0
  }
  var dayKeys = Object.keys(dayMap).sort()
  var chartMax = 0
  for (var ci = 0; ci < dayKeys.length; ci++) {
    var t = dayMap[dayKeys[ci]].input + dayMap[dayKeys[ci]].output + dayMap[dayKeys[ci]].cacheRead
    if (t > chartMax) chartMax = t
  }

  // --- hour-of-week heatmap (session starts, weighted by tokens) ---
  var heat = []
  for (var hh = 0; hh < 7; hh++) heat.push(new Array(24).fill(0))
  var heatMax = 0
  for (var hj = 0; hj < cur.length; hj++) {
    var when = new Date(cur[hj].createdAt)
    var v = (cur[hj].input || 0) + (cur[hj].output || 0)
    heat[when.getDay()][when.getHours()] += v
    if (heat[when.getDay()][when.getHours()] > heatMax) heatMax = heat[when.getDay()][when.getHours()]
  }
  var weekdayNames = [dshT('周日'), dshT('周一'), dshT('周二'), dshT('周三'), dshT('周四'), dshT('周五'), dshT('周六')]

  // --- projects (current range, by volume) ---
  var projMap = {}
  for (var pi = 0; pi < cur.length; pi++) {
    var pb = projMap[cur[pi].project]
    if (pb === undefined) { pb = { input: 0, output: 0, cacheRead: 0 }; projMap[cur[pi].project] = pb }
    pb.input += cur[pi].input || 0
    pb.output += cur[pi].output || 0
    pb.cacheRead += cur[pi].cacheRead || 0
  }
  var projectNames = Object.keys(projMap).sort(function (a, b) {
    return (projMap[b].input + projMap[b].output) - (projMap[a].input + projMap[a].output)
  })

  // --- insights (conditional, local — never noise) ---
  var insights = []
  if (curK.cacheRead + curK.input > 0) {
    var rate = curK.cacheRead / (curK.cacheRead + curK.input)
    if (rate >= 0.5) insights.push(dshT('💡 缓存命中率 ') + Math.round(rate * 100) + dshT('% —— 长上下文复用良好，重复提示成本被有效摊薄。'))
    else if (rate < 0.15 && curK.input > 50000) insights.push(dshT('💡 缓存命中率仅 ') + Math.round(rate * 100) + dshT('% —— 高重复长上下文在按全价计费；稳定系统提示与前缀可显著降本。'))
  }
  if (curK.input > 0 && curK.output / curK.input > 1.2) insights.push(dshT('💡 输出 token 是输入的 ') + (curK.output / curK.input).toFixed(1) + dshT(' 倍 —— 生成量偏大，检查重复重试或超长回复。'))
  if (projectNames.length > 1 && curK.tokens > 0) {
    var topSum = projMap[projectNames[0]].input + projMap[projectNames[0]].output
    if (topSum / curK.tokens >= 0.6) insights.push('💡 「' + projectNames[0] + dshT('」占全部用量的 ') + Math.round((topSum / curK.tokens) * 100) + dshT('% —— 用量高度集中。'))
  }
  if (dayKeys.length >= 3) {
    var busiest = dayKeys.reduce(function (a, b) {
      return (dayMap[b].input + dayMap[b].output) > (dayMap[a].input + dayMap[a].output) ? b : a
    })
    insights.push(dshT('💡 用量最高的一天是 ') + busiest + dshT('（') + dayMap[busiest].input + dshT(' 入 / ') + dayMap[busiest].output + dshT(' 出）。'))
  }

  // --- KPI card builder ---
  function kpiCard(key, label, valueText, curV, prevV, accent) {
    var d = deltaPct(curV, prevV)
    var badge = d === null ? null : createElement('span', {
      key: 'delta', className: 'usage-kpi-delta' + (d >= 0 ? ' up' : ' down'),
    }, (d >= 0 ? '+' : '') + d + '%')
    return createElement('div', { key: key, className: 'usage-kpi' + (accent ? ' ' + accent : '') },
      createElement('div', { className: 'usage-kpi-top' },
        createElement('span', { className: 'usage-kpi-label' }, label),
        badge),
      createElement('div', { className: 'usage-kpi-value' }, valueText))
  }

  var rangePills = rangeLabels.map(function (pair) {
    var active = range === pair[0]
    return createElement(UiPill, {
      key: pair[0],
      active: active,
      // State must not be colour-only: the pressed pill also carries
      // aria-pressed, so the selected window is announced, not just tinted.
      'aria-pressed': active ? 'true' : 'false',
      onClick: function () { patch({ range: pair[0] }) },
    }, pair[1])
  })

  var dayBars = dayKeys.map(function (dk) {
    var b = dayMap[dk]
    var hOut = chartMax > 0 ? Math.round((b.output / chartMax) * 100) : 0
    var hIn = chartMax > 0 ? Math.round((b.input / chartMax) * 100) : 0
    var hCache = chartMax > 0 ? Math.round((b.cacheRead / chartMax) * 100) : 0
    return createElement('div', { key: dk, className: 'usage-bar-col', title: dk + dshT('：输入 ') + b.input + dshT(' · 输出 ') + b.output + dshT(' · 缓存 ') + b.cacheRead },
      createElement('div', { className: 'usage-bar-stack' },
        createElement('span', { className: 'seg seg-cache', style: { height: hCache + '%' } }),
        createElement('span', { className: 'seg seg-in', style: { height: hIn + '%' } }),
        createElement('span', { className: 'seg seg-out', style: { height: hOut + '%' } })),
      createElement('div', { className: 'usage-bar-label' }, dk.slice(5)))
  })

  var heatRows = weekdayNames.map(function (wn, wi) {
    var cells = []
    for (var h = 0; h < 24; h++) {
      var v = heat[wi][h]
      var level = v <= 0 || heatMax <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / heatMax) * 5))
      cells.push(createElement('span', { key: h, className: 'heat-cell lvl' + level, title: wn + ' ' + h + dshT('点：') + v + ' tokens' }))
    }
    return createElement('div', { key: wn, className: 'heat-row' },
      createElement('span', { className: 'heat-row-label' }, wn),
      createElement('span', { className: 'heat-cells' }, cells))
  })

  var projectRowsUI = projectNames.slice(0, 6).map(function (pn) {
    var pb = projMap[pn]
    var sum = pb.input + pb.output
    var width = curK.tokens > 0 ? Math.max(2, Math.round((sum / curK.tokens) * 100)) : 0
    return createElement('div', { key: pn, className: 'usage-project' },
      createElement('span', { className: 'usage-project-name', title: pn }, pn),
      createElement('span', { className: 'usage-project-track' },
        createElement('span', { className: 'usage-project-fill', style: { width: width + '%' } })),
      createElement('span', { className: 'usage-project-num' }, '↑' + formatTokenCount(pb.input) + ' ↓' + formatTokenCount(pb.output)))
  })

  return createElement('div', { className: 'usage-dash', key: 'usage-dash' },
    createElement('div', { className: 'usage-toolbar' },
      createElement('div', { className: 'usage-group' },
        createElement('span', { className: 'usage-group-label' }, dshT('⏱ 日期')),
        createElement('span', { className: 'filter-bar' }, rangePills)),
      // 标签与选择框同属一个控件：外层 `.usage-filter` 画边框，标签是左侧固定段，
      // 选择框吃掉剩余宽度。窄屏整组换行，标签不会再被留在上一行末尾。
      createElement('div', { className: 'usage-filter' },
        createElement('span', { className: 'usage-filter-label' }, dshT('筛选')),
        createElement('select', {
          className: 'input usage-project-select', value: project,
          // 选项只带项目名本身（左侧「筛选」段已说明维度），完整值永远在 title 上。
          title: project === '' ? dshT('全部项目') : project,
          'aria-label': dshT('按项目筛选'),
          onChange: function (e) { patch({ project: e.target.value }) },
        },
        createElement('option', { key: 'all', value: '' }, dshT('全部项目')),
        projectNames.map(function (pn) { return createElement('option', { key: pn, value: pn }, pn) })))),
    createElement('div', { className: 'usage-kpi-grid' },
      kpiCard('k-token', dshT('总 Token'), formatTokenCount(curK.tokens) || '0', curK.tokens, prevK.tokens),
      kpiCard('k-in', dshT('输入 Token'), formatTokenCount(curK.input) || '0', curK.input, prevK.input),
      kpiCard('k-out', dshT('输出 Token'), formatTokenCount(curK.output) || '0', curK.output, prevK.output),
      kpiCard('k-cache', dshT('缓存 Token'), formatTokenCount(curK.cacheRead) || '0', curK.cacheRead, prevK.cacheRead),
      kpiCard('k-sessions', dshT('会话数'), String(curK.sessions), curK.sessions, prevK.sessions, 'accent'),
      kpiCard('k-usermsgs', dshT('用户消息数'), String(curK.userMsgs), curK.userMsgs, prevK.userMsgs),
      kpiCard('k-aimsgs', dshT('助手消息数'), String(curK.assistantMsgs), curK.assistantMsgs, prevK.assistantMsgs),
      kpiCard('k-days', dshT('活跃天数'), String(curK.activeDays), curK.activeDays, prevK.activeDays, 'accent')),
    createElement('div', { className: 'usage-dash-two' },
      createElement('div', { className: 'usage-panel' },
        createElement('div', { className: 'usage-panel-head' },
          createElement('span', { className: 'usage-panel-title' }, dshT('📈 每日趋势')),
          createElement('span', { className: 'usage-legend' },
            createElement('span', { className: 'lg lg-out' }, dshT('输出')),
            createElement('span', { className: 'lg lg-in' }, dshT('输入')),
            createElement('span', { className: 'lg lg-cache' }, dshT('缓存')))),
        dayKeys.length > 0
          ? createElement('div', { className: 'usage-chart' }, dayBars)
          : createElement('div', { className: 'usage-empty' }, dshT('该时间范围内没有会话'))),
      createElement('div', { className: 'usage-panel' },
        createElement('div', { className: 'usage-panel-head' },
          createElement('span', { className: 'usage-panel-title' }, dshT('🕒 分时活跃')),
          createElement('span', { className: 'usage-legend' }, dshT('少 ▒▒▒▒▒▒ 多'))),
        createElement('div', { className: 'usage-heat' }, heatRows),
        createElement('div', { className: 'heat-hours' }, ['00', '03', '06', '09', '12', '15', '18', '21'].map(function (h) {
          return createElement('span', { key: h }, h)
        })))),
    projectNames.length > 0 ? createElement('div', { className: 'usage-projects' }, projectRowsUI) : null,
    insights.length > 0
      ? createElement('div', { className: 'usage-insights' }, insights.map(function (tip, i2) {
        return createElement('div', { key: i2, className: 'usage-insight' }, tip)
      }))
      : null)
}

/** Local YYYY-MM-DD key for a timestamp (viewer's calendar). */
function usageDayKey(ms) {
  var d = new Date(ms)
  var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m
  var dd = String(d.getDate()); if (dd.length < 2) dd = '0' + dd
  return d.getFullYear() + '-' + m + '-' + dd
}

function filterSessions(sessions, filter, needle, pinnedIds) {
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
 * Display rank for the plugin list: 内置 first, then 包安装 (registry
 * install), then 本地安装 (local path). Host order is kept within a rank.
 */
function pluginSortRank(plugin) {
  if (!plugin.removable) return 0
  return plugin.localPath ? 2 : 1
}

/**
 * Filter plugin layers by the type pill and a fuzzy name/version/path query,
 * then sort 内置 → 包安装 → 本地安装 (stable: equal ranks keep host order).
 * The needle matches case-insensitively against the package name, the
 * installed version, and the local source path, so "tool" finds
 * dsh-custom-tool and "0.2" finds version rows.
 */
function filterPlugins(plugins, filter, needle) {
  var result = []
  for (var i = 0; i < plugins.length; i++) {
    var p = plugins[i]
    if (filter === 'plugin' && !p.removable) continue
    if (filter === 'builtin' && p.removable) continue
    if (needle !== '') {
      var hay = ((p.name || '') + ' ' + (p.version || '') + ' ' + (p.localPath || '')).toLowerCase()
      if (hay.indexOf(needle) === -1) continue
    }
    result.push(p)
  }
  return result.sort(function (a, b) { return pluginSortRank(a) - pluginSortRank(b) })
}/**
 * Group sessions by their accounting workspace in registry order; sessions
 * without a workspace trail under an "未分组" bucket. Empty workspaces are
 * omitted so the user only sees groups that currently hold a session.
 */
function buildSessionGroups(filtered, workspaceOrder) {
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
function renderFulltextPanel(view, patch, runFulltext, enableSearch) {
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
      onKeyDown: function (e) { if (e.key === 'Enter') runFulltext(view.fullNeedle) },
      onChange: function (e) { patch({ fullNeedle: e.target.value }) },
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
function buildGroupHeader(g, groupKey, collapsed, view, groupUi) {
  var isUngrouped = g.workspaceId === null
  return createElement('div', {
    className: 'group-header' + (collapsed ? ' collapsed' : ''),
    key: 'header-' + groupKey,
    title: collapsed ? dshT('点击展开该目录的会话') : dshT('点击折叠该目录的会话'),
    role: 'button',
    tabIndex: 0,
    onClick: function () { groupUi.toggleCollapse(groupKey) },
    onKeyDown: function (event) {
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
      onClick: function (e) { e.stopPropagation(); groupUi.requestBulk('group', groupKey) },
    }, dshT('🗑 整个目录'))
  )
}

function renderSessionsView(view, patch, reload, act, onExport, pinnedIds, togglePinned, runFulltext, loadHealth, enableSearch, groupUi) {
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
        onChange: function (e) { patch({ needle: e.target.value }) },
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
function renderHealthReportCard(sessionId, health) {
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
          ? ' · ' + tool.errorCodes.map(function (ec) { return ec.code + '×' + ec.count }).join(' ')
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
        dshT('主要错误：'), r.topErrors.map(function (e) { return e.name + ':' + e.code + '×' + e.count }).join('  '))
      : null,
  )
}

function renderSessionCard(session, view, act, patch, onExport, pinnedIds, togglePinned, loadHealth) {
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
var TOOLNAME_RE = /^[a-z][a-z0-9_]{1,47}$/
var TOOL_REF_RE = /^[a-z][a-z0-9_]*$/
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
var RESERVED_TOOL_NAMES = ['subagent', 'subagent_fork', 'run_code']


/** The gateway wraps every remote result in an { ok, value | error } envelope. */
function unwrap(result) {
  if (result && typeof result === 'object' && 'ok' in result) {
    if (result.ok) return result.value
    var detail = result.error && result.error.message ? result.error.message : String(result.error)
    throw new Error(detail)
  }
  return result
}

/* ========================================================================== */
/*                              Small components                              */
/* ========================================================================== */

function Spinner() {
  return createElement('span', { className: 'spinner' })
}

/** Two-click inline confirm; disarms after 3.2s. */
function ConfirmButton(props) {
  var armed = useState(false)
  var isArmed = armed[0]
  var setArmed = armed[1]
  var timer = useRef(null)
  useEffect(function () {
    return function () { if (timer.current) clearTimeout(timer.current) }
  }, [])
  var label = isArmed ? (props.confirmLabel || dshT('确认？')) : props.label
  return createElement(UiButton, {
    type: 'button',
    variant: 'outline',
    size: 'sm', className: (isArmed ? 'danger-solid' : 'danger'),
    disabled: props.disabled === true,
    onClick: function () {
      if (!isArmed) {
        setArmed(true)
        timer.current = setTimeout(function () { setArmed(false) }, 3200)
        return
      }
      if (timer.current) clearTimeout(timer.current)
      setArmed(false)
      props.onConfirm()
    },
  }, label)
}

/**
 * Shared ARIA tabs keyboard wiring for the section tab bars: Left/Right move
 * the selection (wrapping), Home/End jump to the ends, and selection follows
 * focus. Attach to the `role="tablist"` element; the tab buttons carry
 * `tabIndex: selected ? 0 : -1` (roving tabindex) so Tab reaches the bar once
 * and the arrows do the rest.
 * @param {KeyboardEvent} event
 * @param {Array<{id: string}>} tabs - the tab list in DOM order.
 * @param {string} selectedId - the currently selected tab id.
 * @param {(id: string) => void} select - commit the new selection.
 * @returns {boolean} whether the key was handled.
 */
function tabKeyDown(event, tabs, selectedId, select) {
  var delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  var at = -1
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].id === selectedId) { at = i; break }
  }
  if (at === -1) return false
  var to = -1
  if (delta !== 0) to = (at + delta + tabs.length) % tabs.length
  else if (event.key === 'Home') to = 0
  else if (event.key === 'End') to = tabs.length - 1
  if (to === -1 || to === at) return false
  event.preventDefault()
  select(tabs[to].id)
  // Selection follows focus: React reuses the keyed button nodes, so a
  // synchronous focus survives the re-render that flips tabIndex/aria.
  var bar = /** @type {Element|null} */ (event.currentTarget)
  var nodes = bar !== null ? bar.querySelectorAll('[role="tab"]') : []
  if (nodes[to]) nodes[to].focus()
  return true
}

/* ========================================================================== */
/*                            Form draft handling                             */
/* ========================================================================== */

function emptyDraft() {
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

function draftFromEntry(entry) {
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
function adjustDraftForProvider(draft, provider) {
  var patch = {}
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
function validateDraft(draft, isCreate, otherToolNames, providerMeta, candidateNames) {
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

function draftToPayload(draft) {
  var config = { provider: draft.provider, toolName: draft.toolName }
  if (draft.persona.trim() !== '') config.persona = draft.persona
  if (draft.allow.length > 0 || draft.deny.length > 0) {
    config.toolFilter = {}
    if (draft.allow.length > 0) config.toolFilter.allow = draft.allow.slice()
    if (draft.deny.length > 0) config.toolFilter.deny = draft.deny.slice()
  }
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
/*                         Searchable picker (single/multi)                    */
/* ========================================================================== */

/**
 * Filterable picker used for the model/provider selects (single) and the
 * tool-constraint chips (multi). Renders a text input plus a scrollable,
 * filtered dropdown; click or Enter selects. Single mode also commits the
 * typed text (so arbitrary values still work); multi mode appends chips and
 * hides already-picked options from the list.
 */
function Picker(props) {
  var multi = props.multi === true
  var disabled = props.disabled === true
  var values = props.values || []
  var options = props.options || []
  var allowCustom = props.allowCustom !== false
  // Phase B3e-follow-up: no ref. The official Input does not forward one, and the
  var textState = useState('')
  var text = textState[0]
  var setText = textState[1]
  var openState = useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var highlightState = useState(0)
  var highlight = highlightState[0]
  var setHighlight = highlightState[1]

  var selected = {}
  for (var si = 0; si < values.length; si++) selected[values[si]] = true

  var filtered = options.filter(function (o) {
    if (multi && selected[o.value]) return false
    var q = text.trim().toLowerCase()
    if (q === '') return true
    var label = (o.label || o.value).toLowerCase()
    return label.indexOf(q) !== -1 || o.value.toLowerCase().indexOf(q) !== -1
  })

  function emit(next) { if (!disabled) props.onChange(next) }

  function pick(opt) {
    if (multi) {
      if (selected[opt.value] || !TOOL_REF_RE.test(opt.value)) return
      emit(values.concat([opt.value]))
      setText(''); setHighlight(0); setOpen(true)
    } else {
      emit([opt.value]); setText(''); setOpen(false)
    }
  }
  function addTyped(v) {
    var val = (v || '').trim()
    if (val === '') return
    if (multi && (selected[val] || !TOOL_REF_RE.test(val))) return
    emit(multi ? values.concat([val]) : [val])
    setText(''); setHighlight(0)
  }
  function onInputChange(e) {
    if (disabled) return
    var v = e.target.value
    setText(v); setOpen(true); setHighlight(0)
    if (!multi) emit([v])
  }
  function onKeyDown(e) {
    if (disabled) return
    // The live value comes from the event's own target, not a ref: the official
    // Input does not forward one. During a keydown the DOM value is authoritative
    // (a caller may have set it without React seeing a change event), and the
    // draft state is the fallback when the event carries no target.
    var live = (e && e.target && typeof e.target.value === 'string' ? e.target.value : text).trim()
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(function (h) { return Math.min(h + 1, filtered.length - 1) }); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(function (h) { return Math.max(h - 1, 0) }); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length > 0 && highlight >= 0 && highlight < filtered.length) {
        var hl = filtered[highlight]
        if (live === '' || live === hl.value || live === (hl.label || hl.value)) { pick(hl); return }
      }
      if (allowCustom && live !== '') addTyped(live)
      return
    }
    if (e.key === 'Escape') setOpen(false)
  }

  var tokens = multi ? values.map(function (v) {
    return createElement('span', { className: 'tag-chip ' + (props.kind || 'allow'), key: 'tok-' + v },
      v,
      createElement('button', {
        type: 'button', 'aria-label': dshT('移除 ') + v,
        disabled: disabled,
        onClick: function (ev) { ev.stopPropagation(); emit(values.filter(function (x) { return x !== v })) },
      }, '✕'))
  }) : null

  var list = open && !disabled
    ? createElement('div', { className: 'sa-picker-list', role: 'listbox', 'aria-label': props.ariaLabel || props.placeholder || '' },
        filtered.length === 0
          ? createElement('div', { className: 'sa-picker-empty' }, allowCustom && text.trim() !== '' ? dshT('回车添加：') + text.trim() : dshT('无匹配'))
          : filtered.map(function (o, idx) {
              return createElement('div', {
                key: o.value,
                role: 'option',
                'aria-selected': multi ? selected[o.value] === true : values[0] === o.value,
                className: 'sa-picker-opt' + (idx === highlight ? ' active' : ''),
                onMouseDown: function (ev) { if (!disabled) { ev.preventDefault(); pick(o) } },
                onMouseEnter: function () { setHighlight(idx) },
              }, o.label || o.value)
            }))
    : null

  return createElement('div', { className: 'sa-picker' + (multi ? ' tag-input' : '') },
    tokens,
    // The official Input (the composite no longer needs a ref: see `live` above).
    createElement(UiInput, {
      value: multi ? text : (values[0] || ''),
      placeholder: props.placeholder || '',
      'aria-label': props.ariaLabel || props.placeholder || '',
      disabled: disabled,
      onChange: onInputChange,
      onKeyDown: onKeyDown,
      onFocus: function () { if (!disabled) setOpen(true) },
      onBlur: function () { setOpen(false) },
    }),
    list,
  )
}

/* ========================================================================== */
/*                              Subagents panel                               */
/* ========================================================================== */

function SubagentsPanel(props) {
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
    setView(function (prev) { return Object.assign({}, prev, { loading: true, error: null }) })
    call('subagentAdmin/list', {}).then(function (raw) {
      var result = unwrap(raw)
      setView({ loading: false, error: null, data: result })
    }).catch(function (error) {
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
  var candidateNames = meta.tools.map(function (tool) { return tool.name })
  var providerMeta = {}
  meta.providers.forEach(function (provider) { providerMeta[provider.name] = provider })
  var llmProviders = meta.llmProviders || []
  var llmModels = meta.llmModels || {}

  var filtered = entries.filter(function (entry) {
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
  var openEdit = function (entry) {
    setNotice(null)
    setForm({ draft: draftFromEntry(entry), editing: true, saving: false, error: null, capabilityNotice: null, advanced: false })
  }
  var closeForm = function () { setForm(null) }

  var saveForm = function () {
    if (!form || form.saving) return
    var otherToolNames = entries
      .filter(function (entry) { return !form.editing || entry.id !== form.draft.id })
      .map(function (entry) { return (entry.config || {}).toolName })
      .filter(Boolean)
    var clientError = validateDraft(form.draft, !form.editing, otherToolNames, providerMeta, candidateNames)
    if (clientError) {
      setForm(Object.assign({}, form, { error: clientError }))
      return
    }
    var saving = Object.assign({}, form, { saving: true, error: null })
    setForm(saving)
    var payload = draftToPayload(saving.draft)
    call('subagentAdmin/upsert', { entry: payload }).then(function (raw) {
      var result = unwrap(raw)
      setView(function (prev) { return Object.assign({}, prev, { data: result, loading: false }) })
      setForm(null)
      setNotice(result.warnings && result.warnings.length > 0 ? result.warnings : null)
    }).catch(function (error) {
      var message = String((error && error.message) || error)
      setForm(Object.assign({}, saving, { saving: false, error: message }))
      setToast(dshT('保存失败：') + message)
    })
  }

  // One remove RPC per entry at a time: the confirm button re-enables after
  // 3.2s, and a double-fire would send two removes (the second reporting a
  // spurious failure).
  var removeInFlight = useRef({})
  var removeEntry = function (entry) {
    if (removeInFlight.current[entry.id]) return
    removeInFlight.current[entry.id] = true
    call('subagentAdmin/remove', { id: entry.id }).then(function (raw) {
      delete removeInFlight.current[entry.id]
      var result = unwrap(raw)
      setView(function (prev) { return Object.assign({}, prev, { data: result, loading: false }) })
      setNotice(null)
    }).catch(function (error) {
      delete removeInFlight.current[entry.id]
      setToast(dshT('删除失败：') + String((error && error.message) || error))
    })
  }

  var patchDraft = function (patch) {
    setForm(function (prev) {
      return Object.assign({}, prev, { draft: Object.assign({}, prev.draft, patch) })
    })
  }
  var patchProvider = function (providerName) {
    setForm(function (prev) {
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
    setForm(function (prev) { return Object.assign({}, prev, { advanced: prev.advanced !== true }) })
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
        onChange: function (event) { setNeedle(event.target.value) },
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
      meta.providers.map(function (provider) {
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
      notice.map(function (warning, index) {
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
      children.push(createElement('div', { className: 'list', key: 'cards' }, filtered.map(function (entry) {
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

function SubagentForm(props) {
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
          onChange: function (event) { onPatch({ id: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, dshT('补丁行标识，创建后不可改；持久化在 profile 的 cordis.patch.yml'))
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('子智能体名称（模型可见工具名）')),
        createElement(UiInput, {
          value: draft.toolName,
          placeholder: dshT('如 web_researcher（模型用它发起委托）'),
          onChange: function (event) { onPatch({ toolName: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, dshT('不能用保留名 subagent / subagent_fork / run_code，且各实例间唯一'))
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('执行后端（provider）')),
        createElement('select', {
          className: 'input', value: draft.provider, disabled: form.saving,
          onChange: function (event) { onProviderChange(event.target.value) },
        },
          meta.providers.map(function (provider) {
            return createElement('option', { key: provider.name, value: provider.name }, provider.name)
          })
        ),
        createElement('span', { className: 'field-hint' }, capabilityHint)
      ),
      advanced ? createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('后台模式')),
        createElement('select', {
          className: 'input', value: draft.backgroundMode, disabled: form.saving,
          onChange: function (event) { onPatch({ backgroundMode: event.target.value }) },
        },
          createElement('option', { value: 'one-shot' }, dshT('one-shot（一次性任务）')),
          createElement('option', { value: 'continuable', disabled: !providerInfo || providerInfo.continuable !== true }, dshT('continuable（可持续会话）'))
        ),
        createElement(UiCheckbox, {
          checked: draft.enableRunInBackground === true,
          disabled: form.saving,
          onChange: function (next) { onPatch({ enableRunInBackground: next }) },
          label: dshT('暴露 run_in_background 参数'),
          className: 'checkbox-row',
        })
      ) : null,
      createElement('div', { className: 'field full' },
        createElement('span', { className: 'field-label' }, dshT('提示词（persona，留空继承部署默认）')),
        createElement('textarea', {
          className: 'input', value: draft.persona, rows: 4, disabled: form.saving || providerInfo?.capabilities.persona === false,
          placeholder: dshT('该子智能体的人设/职责说明…支持 {{model}} 与 {{cwd}} 模板变量'),
          onChange: function (event) { onPatch({ persona: event.target.value }) },
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
            values: draft.allow, options: candidateNames.map(function (n) { return { value: n, label: n } }),
            placeholder: dshT('输入或选择工具名，如 read / glob / grep'), ariaLabel: dshT('仅允许工具'),
            onChange: function (next) { onPatch({ allow: next }) },
          }),
          createElement('span', { className: 'field-hint' }, dshT('设置后子智能体只保留名单内工具，其余从提示词移除且拒绝执行'))
        ),
        createElement('div', { className: 'field' },
          createElement('span', { className: 'field-label' }, dshT('禁止（deny 黑名单）')),
          createElement(Picker, {
            multi: true, kind: 'deny', allowCustom: true, disabled: form.saving || providerInfo?.capabilities.toolFilter === false,
            values: draft.deny, options: candidateNames.map(function (n) { return { value: n, label: n } }),
            placeholder: dshT('输入或选择工具名，如 bash / pwsh'), ariaLabel: dshT('禁止工具'),
            onChange: function (next) { onPatch({ deny: next }) },
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
              options: llmProviders.map(function (p) { return { value: p.id, label: p.name } }),
              placeholder: dshT('留空继承，如 optirouter / deepseek-official'), ariaLabel: 'LLM provider',
              onChange: function (next) { onPatch({ agentProvider: next[0] || '' }) },
            })
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, dshT('模型标识（model）')),
            createElement(Picker, {
              multi: false, allowCustom: true,
              values: draft.agentModel ? [draft.agentModel] : [],
              options: modelOptions.map(function (m) { return { value: m.id, label: m.name } }),
              placeholder: dshT('留空继承，如 auto'), ariaLabel: dshT('模型标识'),
              onChange: function (next) { onPatch({ agentModel: next[0] || '' }) },
            }),
            createElement('span', { className: 'field-hint' }, dshT('从已配置模型中选择，或手填模型 id（需在该 provider 路由上注册）'))
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, dshT('maxTokens（单次回复上限）')),
            createElement(UiInput, {
              value: draft.maxTokens,
              placeholder: dshT('留空使用默认'), inputMode: 'numeric',
              onChange: function (event) { onPatch({ maxTokens: event.target.value.replace(/[^0-9]/g, '') }) },
            })
          ),
          createElement('div', { className: 'field' },
            createElement('span', { className: 'field-label' }, dshT('最大委托深度（maxDepth，0 = 禁止再委托）')),
            createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              createElement(UiInput, {
                value: draft.maxDepth,
                disabled: form.saving || draft.maxDepthManaged || providerInfo?.capabilities.depthLimit === false,
                placeholder: dshT('3（默认）'), inputMode: 'numeric',
                onChange: function (event) { onPatch({ maxDepth: event.target.value.replace(/[^0-9]/g, '') }) },
              }),
              createElement('span', { style: { flex: 'none' } },
                createElement(UiCheckbox, {
                  checked: draft.maxDepthManaged,
                  disabled: form.saving || providerInfo?.capabilities.depthLimit === false,
                  onChange: function (next) { onPatch({ maxDepthManaged: next }) },
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

function SubagentCard(props) {
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
    config.toolFilter.allow.forEach(function (name) {
      chips.push(createElement('span', { key: 'a-' + name, className: 'chip allow' }, name))
    })
  }
  if (config.toolFilter && config.toolFilter.deny && config.toolFilter.deny.length > 0) {
    chips.push(createElement('span', { key: 'deny-label', style: { fontSize: '10px', color: '#b91c1c', fontWeight: 600 } }, dshT('禁止')))
    config.toolFilter.deny.forEach(function (name) {
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
function cliDraftFromConfig(config) {
  config = config || {}
  return {
    providerName: config.providerName !== undefined ? String(config.providerName) : '',
    permissionMode: config.permissionMode !== undefined ? String(config.permissionMode) : '',
    disposeGraceMs: config.disposeGraceMs !== undefined ? String(config.disposeGraceMs) : '3000',
    envPairs: Object.keys(config.env || {}).map(function (key) {
      return { key: key, value: String(config.env[key]) }
    }),
  }
}

/** Convert a draft back into the wire config object. */
function cliConfigFromDraft(draft) {
  var config = {
    providerName: draft.providerName.trim(),
    permissionMode: draft.permissionMode,
    disposeGraceMs: Number(draft.disposeGraceMs.trim()),
    env: {},
  }
  draft.envPairs.forEach(function (pair) {
    var key = pair.key.trim()
    if (key !== '') config.env[key] = pair.value
  })
  return config
}

/** Shared env key/value pair editor (used by every CLI backend card). */
function EnvPairsEditor(props) {
  var pairs = props.pairs || []
  return createElement('div', { className: 'fieldset' },
    createElement('span', { className: 'fieldset-legend' }, dshT('env（传给 CLI 子进程的额外环境变量）')),
    pairs.map(function (pair, index) {
      return createElement('div', { className: 'env-row', key: index },
        createElement(UiInput, {
          value: pair.key,
          placeholder: dshT('变量名（如 OPENAI_API_KEY）'),
          onChange: function (event) { props.onPatchPair(index, { key: event.target.value }) },
        }),
        createElement(UiInput, {
          placeholder: dshT('变量值'),
          onChange: function (event) { props.onPatchPair(index, { value: event.target.value }) },
        }),
        createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function () { props.onRemove(index) } }, '✕'),
      )
    }),
    createElement(UiButton, { variant: 'primary', size: 'sm', onClick: props.onAdd }, dshT('＋ 添加变量')),
  )
}

/** One CLI backend card: collapsible status header + config form + mount/save/unmount. */
function CliBackendCard(props) {
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
          onChange: function (event) { onPatch({ providerName: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('permissionMode（CLI 权限模式）')),
        createElement('select', {
          className: 'input', value: modeValue,
          onChange: function (event) { onPatch({ permissionMode: event.target.value }) },
        }, backend.permissionModes.map(function (mode) {
          return createElement('option', { key: mode, value: mode }, mode)
        })),
        createElement('span', { className: 'field-hint' }, dshT('枚举来自该 provider 包的 Config schema'))
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('disposeGraceMs（进程树终止宽限，毫秒）')),
        createElement(UiInput, {
          value: draft.disposeGraceMs,
          placeholder: '3000',
          onChange: function (event) { onPatch({ disposeGraceMs: event.target.value }) },
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
function cliDraftFromGeneric(backend) {
  backend = backend || {}
  return {
    command: backend.command !== undefined ? String(backend.command) : '',
    argsText: Array.isArray(backend.args) ? backend.args.join(' ') : '{prompt}',
    providerName: backend.providerName !== undefined ? String(backend.providerName) : '',
    disposeGraceMs: backend.disposeGraceMs !== undefined ? String(backend.disposeGraceMs) : '3000',
    envPairs: Object.keys(backend.env || {}).map(function (key) {
      return { key: key, value: String(backend.env[key]) }
    }),
  }
}

/** Convert a generic draft into the wire config object (args split on whitespace). */
function cliConfigFromGenericDraft(draft) {
  var config = {
    command: draft.command.trim(),
    args: draft.argsText.trim().split(/\s+/).filter(Boolean),
    providerName: draft.providerName.trim(),
    disposeGraceMs: Number(draft.disposeGraceMs.trim()),
    env: {},
  }
  draft.envPairs.forEach(function (pair) {
    var key = pair.key.trim()
    if (key !== '') config.env[key] = pair.value
  })
  return config
}

/** One generic external-CLI backend card (served by this plugin's command provider). */
function GenericCliCard(props) {
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
          onChange: function (event) { onPatch({ command: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('providerName（执行后端注册名）')),
        createElement(UiInput, {
          value: draft.providerName,
          placeholder: dshT('如 cli-gemini（子智能体表单的执行后端选项）'),
          onChange: function (event) { onPatch({ providerName: event.target.value }) },
        }),
      ),
      createElement('div', { className: 'field full' },
        createElement('span', { className: 'field-label' }, dshT('args（空格分隔，{prompt} 占位提示词）')),
        createElement(UiInput, {
          value: draft.argsText,
          placeholder: '-p {prompt}',
          onChange: function (event) { onPatch({ argsText: event.target.value }) },
        }),
        createElement('span', { className: 'field-hint' }, dshT('one-shot 纯文本：stdout 即委托结果，非零退出记为失败；prompt 经 {prompt} 传入')),
      ),
      createElement('div', { className: 'field' },
        createElement('span', { className: 'field-label' }, dshT('disposeGraceMs（进程树终止宽限，毫秒）')),
        createElement(UiInput, {
          value: draft.disposeGraceMs,
          placeholder: '3000',
          onChange: function (event) { onPatch({ disposeGraceMs: event.target.value }) },
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

function CliPanel(props) {
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

  var toggleExpanded = function (backendId) {
    setExpanded(function (prev) {
      var next = Object.assign({}, prev)
      next[backendId] = prev[backendId] !== true
      return next
    })
  }

  // Busy flags ride functional updates too: a closure snapshot would drop a
  // flag set by an in-flight sibling request (two cards saved back-to-back),
  // re-enabling the first button mid-request. Failure paths clear ONLY the
  // key they own — `setBusy({})` would release every in-flight marker.
  var markBusy = function (key) {
    setBusy(function (prev) {
      if (prev[key] === true) return prev
      var next = Object.assign({}, prev)
      next[key] = true
      return next
    })
  }
  var clearBusy = function (key) {
    setBusy(function (prev) {
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
  var absorb = function (result) {
    setView({ loading: false, error: null, data: result })
    var next = {}
    ;(result.backends || []).forEach(function (backend) {
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
  var adopt = function (result) {
    setView({ loading: false, error: null, data: result })
  }

  var reload = function () {
    setView(function (prev) { return Object.assign({}, prev, { loading: true, error: null }) })
    call('subagentAdmin/cliList', {}).then(function (raw) {
      absorb(unwrap(raw))
    }).catch(function (error) {
      setView({ loading: false, error: String((error && error.message) || error), data: null })
    })
  }
  useEffect(reload, [])

  var patchDraft = function (backendId, patch) {
    setDrafts(function (prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, patch)
      return next
    })
  }

  // Env-pair edits derive from the latest queued state (functional update), so
  // rapid consecutive edits can never overwrite each other via stale drafts.
  var patchEnvPair = function (backendId, index, patch) {
    setDrafts(function (prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var pairs = (current.envPairs || []).map(function (pair, i) {
        return i === index ? Object.assign({}, pair, patch) : pair
      })
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: pairs })
      return next
    })
  }
  var addEnvPair = function (backendId) {
    setDrafts(function (prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: (current.envPairs || []).concat([{ key: '', value: '' }]) })
      return next
    })
  }
  var removeEnvPair = function (backendId, index) {
    setDrafts(function (prev) {
      var current = prev[backendId] || cliDraftFromConfig(null)
      var next = Object.assign({}, prev)
      next[backendId] = Object.assign({}, current, { envPairs: (current.envPairs || []).filter(function (_, i) { return i !== index }) })
      return next
    })
  }

  var runUpsert = function (backend) {
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
      if (args.length === 0 || args.length > 20 || !args.every(function (arg) { return arg.length <= 256 })) {
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
    call('subagentAdmin/cliUpsert', { payload: payload }).then(function (raw) {
      adopt(unwrap(raw))
      clearBusy(busyKey)
    }).catch(function (error) {
      clearBusy(busyKey)
      setToast(dshT('保存失败：') + String((error && error.message) || error))
    })
  }

  var runUnmount = function (backend) {
    if (busy[backend.id]) return
    markBusy(backend.id)
    // Generic backends are recognized server-side by their "cli-" id prefix.
    call('subagentAdmin/cliRemove', { id: backend.id }).then(function (raw) {
      adopt(unwrap(raw))
      clearBusy(backend.id)
    }).catch(function (error) {
      clearBusy(backend.id)
      setToast(dshT('卸载失败：') + String((error && error.message) || error))
    })
  }

  var runInstall = function (backend) {
    if (busy[backend.id]) return
    markBusy(backend.id)
    call('subagentAdmin/cliInstall', { backendId: backend.id }).then(function (raw) {
      var result = unwrap(raw)
      adopt(result)
      clearBusy(backend.id)
      setToast((result && result.output ? result.output : dshT('依赖包安装完成')) + dshT('，已重新检测'))
    }).catch(function (error) {
      var message = String((error && error.message) || error)
      if (message.indexOf('404') !== -1) {
        message += dshT('（宿主端未注册该接口：请重启 dsh 加载最新插件后重试）')
      }
      clearBusy(backend.id)
      setToast(dshT('安装失败：') + message)
    })
  }

  var runGenericMount = function (command) {
    if (!/^[^\s]+$/.test(command)) {
      setToast(dshT('command 不能包含空格（PATH 命令名或绝对路径）'))
      return
    }
    markBusy('__scan__')
    call('subagentAdmin/cliUpsert', { payload: { kind: 'generic', config: { command: command } } }).then(function (raw) {
      adopt(unwrap(raw))
      clearBusy('__scan__')
      setCustomCommand('')
    }).catch(function (error) {
      clearBusy('__scan__')
      setToast(dshT('挂载失败：') + String((error && error.message) || error))
    })
  }

  var children = []

  // 本机 CLI card sits on top: scan list + custom command + refresh; the
  // builtin codex/claude-code cards and mounted generic cards follow below.
  var backends = (view.data && view.data.backends) || []
  var others = (view.data && view.data.others) || []
  var busyAny = Object.keys(busy).some(function (key) { return busy[key] === true })
  var genericBackends = backends.filter(function (backend) { return backend.kind === 'generic' })

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
          onChange: function (event) { setCustomCommand(event.target.value) },
        }),
        createElement(UiButton, {
          variant: 'outline',
          size: 'sm',
          disabled: busyAny || customCommand.trim() === '',
          onClick: function () { runGenericMount(customCommand.trim()) },
        }, dshT('挂载')),
      ),
      (function () {
        var mountedCommands = new Set(genericBackends.map(function (backend) {
          return backend.command.toLowerCase()
        }))
        return others
          .filter(function (item) { return !!(item.cli && item.cli.ok) })
          .filter(function (item) { return !mountedCommands.has(item.name.toLowerCase()) })
          .map(function (item) {
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
      others.length > 0 && others.every(function (item) { return !(item.cli && item.cli.ok) })
        ? createElement('span', { className: 'tag', key: 'none' }, dshT('未检测到其他 agent CLI'))
        : null,
    ),
  ))

  if (view.error) {
    children.push(createElement('div', { className: 'error-strip', key: 'error' }, dshT('⚠️ 加载失败：'), view.error))
  } else {
    genericBackends.forEach(function (backend) {
      children.push(GenericCliCard({
        backend: backend,
        draft: drafts[backend.id] || cliDraftFromGeneric(backend),
        busy: busy[backend.id] === true,
        expanded: expanded[backend.id] === true,
        onToggle: function () { toggleExpanded(backend.id) },
        onPatch: function (patch) { patchDraft(backend.id, patch) },
        onPatchEnvPair: function (index, patch) { patchEnvPair(backend.id, index, patch) },
        onAddEnvPair: function () { addEnvPair(backend.id) },
        onRemoveEnvPair: function (index) { removeEnvPair(backend.id, index) },
        onSave: function () { runUpsert(backend) },
        onUnmount: function () { runUnmount(backend) },
      }))
    })
    backends.filter(function (backend) { return backend.kind !== 'generic' }).forEach(function (backend) {
      children.push(CliBackendCard({
        backend: backend,
        draft: drafts[backend.id] || cliDraftFromConfig(backend.config),
        busy: busy[backend.id] === true,
        expanded: expanded[backend.id] === true,
        onToggle: function () { toggleExpanded(backend.id) },
        onPatch: function (patch) { patchDraft(backend.id, patch) },
        onPatchEnvPair: function (index, patch) { patchEnvPair(backend.id, index, patch) },
        onAddEnvPair: function () { addEnvPair(backend.id) },
        onRemoveEnvPair: function (index) { removeEnvPair(backend.id, index) },
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

function SubagentAdminSection(props) {
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
      onKeyDown: function (event) { tabKeyDown(event, tabs, selected.id, setActiveTab) } },
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

/* ========================================================================== */
/*          Command & Hook Admin (merged from dsh-command-hook-admin)         */
/* ========================================================================== */

/**
 * dsh-command-hook-admin browser half: the 「命令与钩子」 settings section
 * with two segmented tabs, styled with the same --dsw-* design tokens and
 * visual recipes as the other admin sections (toolbar cards, blue primary
 * buttons, tag badges, card rows).
 *
 * - 命令: file-backed slash commands (`~/.dsh/commands/*.json`), registered
 *   live by the host half — 新建 / 编辑 / 启停 / 删除 apply immediately.
 * - 钩子: the Claude-Code-format hooks file the stock bridge reads once at
 * apply. 启停 moves entries between hooks.json and a sidecar so the bridge
 * never fires disabled hooks; every write restarts the mounted bridge
 * through Fiber.update (the loader's own restart path) and reports the
 * true outcome. The stock bridge package itself can be installed/mounted
 * (or uninstalled) right from this panel — the host solidified the bridge
 * lifecycle that used to require hand-editing the profile. The Codex-format
 * sibling bridge (`@deepseek-ai/dsh-hooks-codex`, its own `hooks.codex.json`)
 * is installed/removed from the same tab instead of a settings page of its
 * own: both are one `listHooks()` payload with the same install/remove shape,
 * so a second page only duplicated the affordance.
 */


/** The events the stock Claude-Code bridge supports, with matcher notes. */
var CH_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop']
var CH_MATCHERLESS = { UserPromptSubmit: true, Stop: true }

/**
 * Describe one hook reload outcome for the status banner. The host restarts
 * the mounted bridge through Fiber.update; "已生效" is only ever claimed when
 * the restart actually completed.
 * @param reload - the host's reload report.
 * @returns display text, or null when there is nothing to say.
 */
function chReloadNote(reload) {
  if (reload === undefined || reload === null) return null
  if (reload.reloaded) return dshT('✓ 已重启 hooks 桥，配置已生效。')
  if (reload.mounted) return dshT('⚠ hooks 桥热重启失败：') + messageOf(reload.error) + dshT('（配置已写入，重启 dsh 后生效）')
  return dshT('已写入 hooks.json。当前未挂载 hooks 桥（hooks-claude-code），挂载后生效。')
}

/**
 * Notice tone for a status note: ✓ prefixes read as success (green), ⚠ as a
 * warning (amber), everything else stays informational (blue).
 * @param text - the note text.
 * @returns the notice class name.
 */
function chNoticeClass(text) {
  if (typeof text === 'string' && text.indexOf('✓') !== -1) return 'notice ok'
  if (typeof text === 'string' && text.indexOf('⚠') !== -1) return 'notice warn'
  return 'notice'
}

/**
 * One labeled form field.
 * @param label - label text.
 * @param input - the input element.
 * @param hint - optional hint line under the control.
 * @returns the field element.
 */
function chField(label, input, hint) {
  return createElement('div', { className: 'field', key: label },
    createElement('label', null, label),
    input,
    hint ? createElement('div', { className: 'hint' }, hint) : null,
  )
}

/**
 * A small switch button with the toggle role.
 * @param checked - current state.
 * @param onChange - click handler.
 * @param label - accessible name.
 * @returns the button element.
 */
function chToggle(checked, onChange, label) {
  return createElement('button', {
    type: 'button',
    role: 'switch',
    className: 'toggle',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label,
    disabled: !onChange,
    onClick: onChange || undefined,
  })
}

/**
 * One command list row: /name + description, live status, toggle, edit, delete.
 * @param props - { command, busy, onToggle, onEdit, onDelete, confirming, onConfirmDelete, onCancelDelete }.
 * @returns the row element.
 */
function ChCommandRow(props) {
  var c = props.command
  var badges = []
  if (!c.enabled) badges.push(createElement('span', { className: 'tag', key: 'off' }, dshT('已停用')))
  if (c.conflict) badges.push(createElement('span', { className: 'tag err', key: 'conflict', title: c.conflict }, dshT('注册失败')))
  if (c.fileError) badges.push(createElement('span', { className: 'tag err', key: 'file', title: c.fileError }, dshT('文件错误')))
  var actions = props.confirming
    ? [
      createElement(UiButton, { variant: 'outline', size: 'sm',
      className: 'danger', key: 'yes', disabled: props.busy, onClick: props.onConfirmDelete }, dshT('确认删除')),
      createElement(UiButton, { variant: 'outline', size: 'sm', key: 'no', disabled: props.busy, onClick: props.onCancelDelete }, dshT('取消')),
    ]
    : [
      createElement(UiButton, { variant: 'outline', size: 'sm', key: 'edit', disabled: props.busy, onClick: props.onEdit }, dshT('编辑')),
      createElement(UiButton, { variant: 'outline', size: 'sm',
      className: 'danger', key: 'del', disabled: props.busy, 'aria-label': dshT('删除命令 /') + c.name, onClick: props.onDelete }, dshT('删除')),
    ]
  return createElement('div', { className: 'row' + (c.enabled ? '' : ' off') },
    createElement('div', { className: 'main' },
      createElement('div', { className: 'name-row' },
        createElement('span', { className: 'name' }, '/' + c.name),
        badges,
      ),
      createElement('div', { className: 'desc' }, c.description || ''),
      c.inputHint ? createElement('div', { className: 'meta' }, dshT('参数提示：') + c.inputHint) : null,
    ),
    createElement('div', { className: 'actions' }, actions),
    chToggle(c.enabled, props.busy ? null : props.onToggle, (c.enabled ? dshT('停用') : dshT('启用')) + dshT('命令 /') + c.name),
  )
}

/**
 * The command create/edit form.
 * @param props - { initial, busy, error, onSave, onCancel }.
 * @returns the form element.
 */
function ChCommandForm(props) {
  var initial = props.initial
  var originalName = initial.originalName !== undefined ? initial.originalName : null
  var nameHooks = useState(initial.name || '')
  var name = nameHooks[0]
  var setName = nameHooks[1]
  var descHooks = useState(initial.description || '')
  var description = descHooks[0]
  var setDescription = descHooks[1]
  var hintHooks = useState(initial.inputHint || '')
  var inputHint = hintHooks[0]
  var setInputHint = hintHooks[1]
  var promptHooks = useState(initial.prompt || '')
  var prompt = promptHooks[0]
  var setPrompt = promptHooks[1]
  var imagesHooks = useState(initial.images === true)
  var images = imagesHooks[0]
  var setImages = imagesHooks[1]
  var enabledHooks = useState(initial.enabled !== false)
  var enabled = enabledHooks[0]
  var setEnabled = enabledHooks[1]

  return createElement('form', { className: 'form', onSubmit: function (e) { e.preventDefault() } },
    createElement('div', { className: 'grid2' },
      chField(dshT('名称'), createElement(UiInput, {
        type: 'text',  value: name, placeholder: 'my-command',
        onChange: function (e) { setName(e.target.value) },
      }), dshT('小写字母开头，可含数字、-、_。会话中输入 /名称 调用。')),
      chField(dshT('参数提示（可选）'), createElement(UiInput, {
        type: 'text',  value: inputHint, placeholder: dshT('例如 <file-path>'),
        onChange: function (e) { setInputHint(e.target.value) },
      })),
    ),
    chField(dshT('描述'), createElement(UiInput, {
      type: 'text',  value: description, placeholder: dshT('这个命令做什么'),
      onChange: function (e) { setDescription(e.target.value) },
    })),
    chField(dshT('提示词'), createElement('textarea', {
      className: 'input', value: prompt, placeholder: dshT('# 角色\n\n你要…\n\n当前请求：$ARGUMENTS'),
      onChange: function (e) { setPrompt(e.target.value) },
    }), dshT('发送给模型的提示词。$ARGUMENTS 会替换为用户输入；未使用占位符时输入会追加在末尾。')),
    createElement('div', { className: 'checks' },
      createElement(UiCheckbox, {
        checked: enabled,
        onChange: function (next) { setEnabled(next) },
        label: dshT('启用'),
        className: 'check',
      }),
      createElement(UiCheckbox, {
        checked: images,
        onChange: function (next) { setImages(next) },
        label: dshT('接受图片附件'),
        className: 'check',
      }),
    ),
    props.error ? createElement('div', { className: 'error-text' }, props.error) : null,
    createElement('div', { className: 'form-actions' },
      createElement(UiButton, { variant: 'outline', size: 'sm', disabled: props.busy, onClick: props.onCancel }, dshT('取消')),
      createElement(UiButton, {
        variant: 'primary', disabled: props.busy,
        onClick: function () {
          props.onSave({
            originalName: originalName,
            name: name,
            description: description,
            inputHint: inputHint,
            prompt: prompt,
            images: images,
            enabled: enabled,
          })
        },
      }, dshT('保存')),
    ),
  )
}

/**
 * The 命令 tab: list + create/edit form + inline delete confirm.
 * @param props - { call }.
 * @returns the tab content element.
 */
function ChCommandsTab(props) {
  var call = props.call
  var listHooks = useState(null)
  var list = listHooks[0]
  var setList = listHooks[1]
  var busyHooks = useState(false)
  var busy = busyHooks[0]
  var setBusy = busyHooks[1]
  var errorHooks = useState('')
  var error = errorHooks[0]
  var setError = errorHooks[1]
  var noteHooks = useState('')
  var note = noteHooks[0]
  var setNote = noteHooks[1]
  var editingHooks = useState(null)
  var editing = editingHooks[0]
  var setEditing = editingHooks[1]
  var confirmHooks = useState(null)
  var confirming = confirmHooks[0]
  var setConfirming = confirmHooks[1]

  function load() {
    setBusy(true)
    call('commandHookAdmin/listCommands', {})
      .then(function (result) {
        setList(unwrap(result))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }
  useEffect(load, [])

  function act(promise, after) {
    setBusy(true)
    setError('')
    promise
      .then(function (result) {
        var value = unwrap(result)
        if (after) after(value)
        setList(value)
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }

  var commands = (list && list.commands) || []
  var commandsDir = (list && list.commandsDir) || ''

  // Import/export (the awesome-claude-code sharing loop): export downloads
  // every command as one JSON file; import reads a pasted JSON (array or a
  // single command) and saves each entry — same-name commands are skipped so
  // a shared pack never silently overwrites local edits.
  var importState = useState(null) // { text } | null
  var importing = importState[0]
  var setImporting = importState[1]

  function exportCommands() {
    try {
      var payload = commands.map(function (c) {
        return { name: c.name, description: c.description, inputHint: c.inputHint, prompt: c.prompt, enabled: c.enabled !== false }
      })
      downloadTextFile('dsh-commands-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(payload, null, 2))
      setNote(dshT('已导出 ') + payload.length + dshT(' 条命令'))
    } catch (e) {
      setNote(dshT('导出失败：') + messageOf(e))
    }
  }

  function runImport(raw) {
    var entries
    try {
      var parsed = JSON.parse(raw)
      entries = Array.isArray(parsed) ? parsed : [parsed]
    } catch (e) {
      setNote(dshT('导入失败：JSON 解析错误 — ') + messageOf(e))
      return
    }
    var byName = {}
    for (var i = 0; i < commands.length; i++) byName[commands[i].name] = true
    var saved = 0
    var skipped = 0
    var failed = 0
    var queue = entries.slice()
    var next = function () {
      if (queue.length === 0) {
        setBusy(false)
        setImporting(null)
        setNote(dshT('导入完成：') + saved + dshT(' 条新增') + (skipped > 0 ? dshT('，') + skipped + dshT(' 条同名跳过') : '') + (failed > 0 ? dshT('，') + failed + dshT(' 条失败') : ''))
        load()
        return
      }
      var entry = queue.shift()
      var name = entry && typeof entry.name === 'string' ? entry.name.trim() : ''
      if (name === '' || typeof entry.prompt !== 'string' || entry.prompt === '') {
        failed++
        next()
        return
      }
      if (byName[name]) {
        skipped++
        next()
        return
      }
      byName[name] = true
      call('commandHookAdmin/saveCommand', {
        entry: { name: name, description: typeof entry.description === 'string' ? entry.description : '', inputHint: typeof entry.inputHint === 'string' ? entry.inputHint : '', prompt: entry.prompt, images: [], enabled: entry.enabled !== false },
      }).then(function (result) {
        if (result && result.ok) saved++
        else failed++
        next()
      }, function () {
        failed++
        next()
      })
    }
    setBusy(true)
    next()
  }

  // Same column rhythm as the hooks tab: toolbar / hint / panels would
  // otherwise stack with zero gap inside this bare wrapper.
  return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    createElement('div', { className: 'toolbar' },
      createElement('span', { className: 'title' }, dshT('提示词命令')),
      createElement('span', { className: 'count' }, String(commands.length)),
      createElement('span', { className: 'spacer' }),
      createElement(UiButton, { variant: 'outline', disabled: busy, onClick: load, 'aria-label': dshT('刷新命令列表') }, dshT('刷新')),
      createElement(UiButton, { variant: 'outline', disabled: busy || commands.length === 0, title: dshT('把全部命令下载为一个 JSON 文件（可分享、可再导入）'), onClick: exportCommands }, dshT('⬇ 导出')),
      createElement(UiButton, { variant: 'outline', disabled: busy || editing !== null, onClick: function () { setImporting(importing === null ? { text: '' } : null) } }, dshT('⬆ 导入')),
      createElement(UiButton, { variant: 'outline', disabled: busy || editing !== null, onClick: function () { setEditing({}) } }, dshT('＋新建命令')),
    ),
    createElement('div', { className: 'hint' }, dshT('存储于 '), createElement('span', { className: 'path-chip' }, commandsDir), dshT(' · 保存后立即生效（含在其他窗口手动改文件）')),
    importing !== null
      ? createElement('div', { className: 'card', key: 'import-panel' },
        createElement('div', { className: 'card-header' },
          createElement('span', { className: 'card-title-text' }, dshT('⬆ 导入命令（JSON 数组或单条）')),
          createElement('div', { className: 'card-actions' },
            createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function () { setImporting(null) } }, dshT('关闭')))),
        createElement('textarea', {
          className: 'input', rows: 8,
          placeholder: dshT('[{ "name": "review", "description": "代码审查", "prompt": "请审查 $ARGUMENTS" }]'),
          value: importing.text,
          onChange: function (e) { setImporting({ text: e.target.value }) },
        }),
        createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' } },
          createElement(UiButton, {
            variant: 'primary', disabled: busy || importing.text.trim() === '',
            onClick: function () { runImport(importing.text) },
          }, dshT('导入（同名跳过）')),
          createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #61666b)' } }, dshT('兼容「⬇ 导出」的文件内容；同名命令一律跳过，绝不静默覆盖本地修改。'))))
      : null,
    note ? createElement('div', { className: chNoticeClass(note) }, note) : null,
    error ? createElement('div', { className: 'error-text' }, error) : null,
    editing !== null
      ? createElement(ChCommandForm, {
        initial: editing,
        busy: busy,
        error: '',
        onCancel: function () { setEditing(null) },
        onSave: function (entry) {
          act(call('commandHookAdmin/saveCommand', { entry: entry }), function () {
            setEditing(null)
            setNote(dshT('命令 /') + entry.name + dshT(' 已保存并注册。'))
          })
        },
      })
      : null,
    commands.length === 0
      ? createElement('div', { className: 'empty' }, dshT('还没有命令。点击「＋新建命令」创建一个，会话里输入 /名称 即可把提示词发给模型。'))
      : createElement('div', { className: 'list' }, commands.map(function (c) {
        return createElement(ChCommandRow, {
          key: c.name,
          command: c,
          busy: busy || editing !== null,
          confirming: confirming === c.name,
          onCancelDelete: function () { setConfirming(null) },
          onConfirmDelete: function () {
            act(call('commandHookAdmin/deleteCommand', { name: c.name }), function () {
              setConfirming(null)
              setNote(dshT('命令 /') + c.name + dshT(' 已删除。'))
            })
          },
          onDelete: function () { setConfirming(c.name) },
          onEdit: function () { setEditing(Object.assign({ originalName: c.name }, c)) },
          onToggle: function () {
            act(call('commandHookAdmin/saveCommand', { entry: Object.assign({}, c, { enabled: !c.enabled }) }), function () {
              setNote(dshT('命令 /') + c.name + (c.enabled ? dshT(' 已停用。') : dshT(' 已启用。')))
            })
          },
        })
      })),
  )
}

/**
 * One hook list row: event + matcher + command, toggle, edit, delete.
 * @param props - { hook, busy, onToggle, onEdit, onDelete, confirming, onConfirmDelete, onCancelDelete }.
 * @returns the row element.
 */
function ChHookRow(props) {
  var h = props.hook
  var actions = props.confirming
    ? [
      createElement(UiButton, { variant: 'outline', size: 'sm',
      className: 'danger', key: 'yes', disabled: props.busy, onClick: props.onConfirmDelete }, dshT('确认删除')),
      createElement(UiButton, { variant: 'outline', size: 'sm', key: 'no', disabled: props.busy, onClick: props.onCancelDelete }, dshT('取消')),
    ]
    : [
      createElement(UiButton, { variant: 'outline', size: 'sm', key: 'edit', disabled: props.busy, onClick: props.onEdit }, dshT('编辑')),
      createElement(UiButton, { variant: 'outline', size: 'sm',
      className: 'danger', key: 'del', disabled: props.busy, 'aria-label': dshT('删除钩子 ') + h.event, onClick: props.onDelete }, dshT('删除')),
    ]
  return createElement('div', { className: 'row' + (h.enabled ? '' : ' off') },
    createElement('span', { className: 'tag event' }, h.event),
    createElement('div', { className: 'main' },
      createElement('div', { className: 'meta' },
        (h.matcher === '' ? dshT('匹配全部') : dshT('匹配 ') + h.matcher)
        + (h.timeoutSec !== null && h.timeoutSec !== undefined ? dshT(' · 超时 ') + h.timeoutSec + 's' : ''),
      ),
      createElement('div', { className: 'desc mono' }, h.command),
    ),
    createElement('div', { className: 'actions' }, actions),
    chToggle(h.enabled, props.busy ? null : props.onToggle, (h.enabled ? dshT('停用') : dshT('启用')) + dshT('钩子 ') + h.event),
  )
}

/**
 * The hook create/edit form.
 * @param props - { initial, busy, error, onSave, onCancel }.
 * @returns the form element.
 */
function ChHookForm(props) {
  var initial = props.initial
  var id = initial.id !== undefined ? initial.id : null
  var eventHooks = useState(initial.event || 'PreToolUse')
  var event = eventHooks[0]
  var setEvent = eventHooks[1]
  var matcherHooks = useState(initial.matcher || '')
  var matcher = matcherHooks[0]
  var setMatcher = matcherHooks[1]
  var commandHooks = useState(initial.command || '')
  var command = commandHooks[0]
  var setCommand = commandHooks[1]
  var timeoutHooks = useState(initial.timeoutSec !== null && initial.timeoutSec !== undefined ? String(initial.timeoutSec) : '600')
  var timeoutSec = timeoutHooks[0]
  var setTimeoutSec = timeoutHooks[1]
  var enabledHooks = useState(initial.enabled !== false)
  var enabled = enabledHooks[0]
  var setEnabled = enabledHooks[1]

  return createElement('form', { className: 'form', onSubmit: function (e) { e.preventDefault() } },
    createElement('div', { className: 'grid2' },
      chField(dshT('事件'), createElement('select', { className: 'input', value: event, onChange: function (e) { setEvent(e.target.value) } },
        CH_HOOK_EVENTS.map(function (name) {
          return createElement('option', { key: name, value: name }, name)
        }),
      )),
      chField(dshT('超时（秒）'), createElement(UiInput, {
        type: 'number', min: 1,  value: timeoutSec,
        onChange: function (e) { setTimeoutSec(e.target.value) },
      }), dshT('留空或 600 = 桥默认（10 分钟）。')),
    ),
    chField(dshT('匹配器'), createElement(UiInput, {
      type: 'text',  value: matcher, placeholder: CH_MATCHERLESS[event] ? dshT('（此事件忽略匹配器）') : dshT('write,edit 或正则；留空匹配全部'),
      disabled: CH_MATCHERLESS[event] === true,
      onChange: function (e) { setMatcher(e.target.value) },
    }), CH_MATCHERLESS[event]
      ? dshT('UserPromptSubmit / Stop 没有匹配对象，桥会丢弃匹配器。')
      : dshT('仅 PreToolUse / PostToolUse 有匹配对象（工具名，小写，如 write / edit，大小写敏感）。')),
    chField(dshT('命令'), createElement(UiInput, {
      type: 'text', className: 'mono', value: command, placeholder: 'node C:/path/to/hook.js',
      onChange: function (e) { setCommand(e.target.value) },
    }), dshT('钩子载荷以 JSON 从 stdin 传入；退出码 2 或输出 deny 阻止动作。')),
    createElement(UiCheckbox, {
      checked: enabled,
      onChange: function (next) { setEnabled(next) },
      label: dshT('启用'),
      className: 'check',
    }),
    props.error ? createElement('div', { className: 'error-text' }, props.error) : null,
    createElement('div', { className: 'form-actions' },
      createElement(UiButton, { variant: 'outline', size: 'sm', disabled: props.busy, onClick: props.onCancel }, dshT('取消')),
      createElement(UiButton, {
        variant: 'primary', disabled: props.busy,
        onClick: function () {
          props.onSave({
            ...(id !== null ? { id: id } : {}),
            event: event,
            matcher: matcher,
            command: command,
            timeoutSec: timeoutSec === '' ? null : timeoutSec,
            enabled: enabled,
          })
        },
      }, dshT('保存')),
    ),
  )
}

/**
 * The 钩子 tab: bridge status banner (with one-click bridge install/uninstall)
 * + list + create/edit form.
 * @param props - { call }.
 * @returns the tab content element.
 */
function ChHooksTab(props) {
  var call = props.call
  var dataHooks = useState(null)
  var data = dataHooks[0]
  var setData = dataHooks[1]
  var busyHooks = useState(false)
  var busy = busyHooks[0]
  var setBusy = busyHooks[1]
  var errorHooks = useState('')
  var error = errorHooks[0]
  var setError = errorHooks[1]
  var noteHooks = useState('')
  var note = noteHooks[0]
  var setNote = noteHooks[1]
  var editingHooks = useState(null)
  var editing = editingHooks[0]
  var setEditing = editingHooks[1]
  var confirmHooks = useState(null)
  var confirming = confirmHooks[0]
  var setConfirming = confirmHooks[1]

  function load() {
    setBusy(true)
    call('commandHookAdmin/listHooks', {})
      .then(function (result) {
        setData(unwrap(result))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }
  useEffect(load, [])

  function act(promise, after) {
    setBusy(true)
    setError('')
    promise
      .then(function (result) {
        var value = unwrap(result)
        // `after` may return a note override — the default note derives from
        // the reload report, which bridge install/remove payloads don't carry.
        var noteOverride = after ? after(value) : undefined
        setData(value)
        var text = chReloadNote(value && value.reload)
        setNote(noteOverride !== undefined && noteOverride !== null
          ? noteOverride
          : (text !== null ? text : ''))
        setBusy(false)
      })
      .catch(function (e) {
        setError(messageOf(e))
        setBusy(false)
      })
  }

  var hooks = (data && data.hooks) || []
  var bridgeMounted = data !== null && data.bridgeMounted === true
  var bridgeInstalled = data !== null && data.bridgeInstalled === true
  var bridgeRowPresent = data !== null && data.bridgeRowPresent === true
  var bridgePackage = (data && data.bridgePackage) || '@deepseek-ai/dsh-hooks-claude-code'
  var bridgeMissing = !bridgeInstalled || !bridgeRowPresent
  // The bridge reads ONLY the row's own configPath: a row pointing at another
  // file silently no-ops every save made here (the reload succeeds against
  // the OLD file), so the panel says so instead of claiming 已生效.
  var bridgeConfigPath = data !== null && typeof data.bridgeConfigPath === 'string' ? data.bridgeConfigPath : null
  var bridgePathMismatch = bridgeRowPresent && data !== null && data.configPathMatches === false
  var bridgeText
  if (bridgePathMismatch) {
    bridgeText = dshT('⚠️ 桥挂载行的 configPath 指向 ')
      + (bridgeConfigPath === null ? dshT('（未声明）') : bridgeConfigPath)
      + dshT('，与本面板管理的 ') + ((data && data.hooksPath) || 'hooks.json') + dshT(' 不一致——在此保存的钩子不会生效。点「⚡ 修复桥指向」把它改到本面板文件，或手工编辑 profile 的 cordis.patch.yml。')
  } else if (bridgeMounted) {
    bridgeText = dshT('hooks 桥（hooks-claude-code）已挂载：保存 / 启停 / 删除后自动重启桥使配置生效（重启期间钩子有约一秒的空窗）。')
  } else if (bridgeInstalled && bridgeRowPresent) {
    bridgeText = dshT('hooks 桥已安装并写入 profile（configPath 指向 ') + ((data && data.hooksPath) || 'hooks.json') + dshT('）：重启 dsh 后挂载生效。')
  } else {
    bridgeText = dshT('当前未安装 hooks 桥（') + bridgePackage + dshT('）：配置会写入 ') + ((data && data.hooksPath) || 'hooks.json') + dshT('，安装并挂载后才会真正执行。')
  }

  function runBridgeInstall() {
    act(call('commandHookAdmin/bridgeInstall', {}), function (value) {
      return value && value.bridgeMounted
        ? dshT('hooks 桥已就绪。')
        : dshT('hooks 桥已安装并写入 profile，重启 dsh 后生效。')
    })
  }

 function runBridgeRemove() {
 act(call('commandHookAdmin/bridgeRemove', {}), function () {
 return dshT('hooks 桥已卸载：patch 行与依赖包均已移除（重启 dsh 后完全生效）。')
 })
 }

 // The Codex-format sibling bridge is managed right here too: same payload
 // (`listHooks` reports both), same install/remove shape, distinct package
 // and hooks file. It has no standalone settings page — one tab owns every
 // hooks bridge instead of two pages owning one each.
 var codexInstalled = data !== null && data.codexBridgeInstalled === true
 var codexRowPresent = data !== null && data.codexBridgeRowPresent === true
 var codexMounted = data !== null && data.codexBridgeMounted === true
 var codexPackage = (data && data.codexBridgePackage) || '@deepseek-ai/dsh-hooks-codex'
 var codexHooksPath = (data && data.codexHooksPath) || 'hooks.codex.json'
 var codexMissing = !codexInstalled || !codexRowPresent
 var codexText
 if (codexMounted) {
 codexText = dshT('Codex 钩子桥（hooks-codex）已挂载：消费 ') + codexHooksPath + dshT(' 里的 Codex 格式钩子（5 个钩点：SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop），与上面的 Claude-Code 格式互不影响。本页只做安装 / 卸载 —— 钩子内容手工编辑该文件。')
 } else if (codexInstalled && codexRowPresent) {
 codexText = dshT('Codex 钩子桥已安装并写入 profile（钩子文件 ') + codexHooksPath + dshT('）：重启 dsh 后挂载生效。')
 } else {
 codexText = dshT('当前未安装 Codex 钩子桥（') + codexPackage + dshT('）：Codex 格式钩子写入 ') + codexHooksPath + dshT('，安装并挂载后才会执行。')
 }

 /**
 * The Codex verbs answer with a sparse payload (no `listHooks` spread), so
 * this path re-reads through load() instead of act(): setData() on the
 * sparse value would blank the hook list and both bridge banners.
 * @param verb - 'codexBridgeInstall' or 'codexBridgeRemove'.
 */
 function runCodexBridge(verb) {
 setBusy(true)
 setError('')
 setConfirming(null)
 call('commandHookAdmin/' + verb, {}).then(function (result) {
 var value = unwrap(result)
 if (verb === 'codexBridgeInstall') {
 var path = value && typeof value.codexHooksPath === 'string' && value.codexHooksPath !== ''
 ? value.codexHooksPath
 : codexHooksPath
 setNote(dshT('Codex 钩子桥已安装并写入 profile（钩子文件 ') + path + dshT('），重启 dsh 后挂载生效。'))
 } else {
 setNote(dshT('Codex 钩子桥已卸载：patch 行与依赖包均已移除（重启 dsh 后完全生效）。'))
 }
 load()
 }, function (e) {
 setError((verb === 'codexBridgeInstall' ? dshT('安装失败：') : dshT('卸载失败：')) + messageOf(e))
 setBusy(false)
 })
 }


  // Column rhythm for the tab body: toolbar, notices, notes, forms and the
  // list would otherwise stack with zero gap inside this bare wrapper.
  return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    createElement('div', { className: 'toolbar' },
      createElement('span', { className: 'title' }, dshT('钩子')),
      createElement('span', { className: 'count' }, String(hooks.length)),
      createElement('span', { className: 'spacer' }),
      createElement(UiButton, { variant: 'outline', disabled: busy, onClick: load, 'aria-label': dshT('刷新钩子列表') }, dshT('刷新')),
      createElement(UiButton, { variant: 'outline', disabled: busy || editing !== null, onClick: function () { setEditing({}) } }, dshT('＋新建钩子')),
    ),
    createElement('div', {
      className: 'notice' + (bridgeMounted && !bridgePathMismatch ? '' : ' warn'),
    },
      createElement('span', { className: 'notice-text' }, bridgeText),
      (bridgeMissing || bridgePathMismatch)
        ? createElement(UiButton, {
          variant: 'outline',
          size: 'sm', disabled: busy || editing !== null,
          onClick: runBridgeInstall,
        }, busy ? dshT('安装中…') : (bridgePathMismatch ? dshT('⚡ 修复桥指向') : dshT('⚡ 安装并挂载 hooks 桥')))
        : null,
      (bridgeInstalled || bridgeRowPresent) && confirming === '__bridge__'
        ? createElement('span', { className: 'notice-actions', key: 'confirm' }, [
          createElement(UiButton, {
            variant: 'outline',
            size: 'sm',
            className: 'danger', key: 'yes', disabled: busy,
            onClick: runBridgeRemove,
          }, dshT('确认卸载')),
          createElement(UiButton, {
            variant: 'outline',
            size: 'sm', key: 'no', disabled: busy,
            onClick: function () { setConfirming(null) },
          }, dshT('取消')),
        ])
        : ((bridgeInstalled || bridgeRowPresent)
          ? createElement(UiButton, {
            variant: 'outline',
            size: 'sm',
            className: 'danger', disabled: busy || editing !== null,
            'aria-label': dshT('卸载 hooks 桥'),
            onClick: function () { setConfirming('__bridge__') },
          }, dshT('卸载桥'))
          : null),
    ),
    createElement('div', {
      className: 'notice' + (codexMounted ? '' : ' warn'),
      key: 'codex-bridge',
    },
      createElement('span', { className: 'notice-text' }, codexText),
      codexMissing
        ? createElement(UiButton, {
          variant: 'outline',
          size: 'sm', disabled: busy || editing !== null,
          onClick: function () { runCodexBridge('codexBridgeInstall') },
        }, busy ? dshT('安装中…') : dshT('📥 安装 Codex 钩子桥'))
        : (confirming === '__codex__'
          ? createElement('span', { className: 'notice-actions', key: 'codex-confirm' }, [
            createElement(UiButton, {
              variant: 'outline',
              size: 'sm',
              className: 'danger', key: 'yes', disabled: busy,
              onClick: function () { runCodexBridge('codexBridgeRemove') },
            }, dshT('确认卸载')),
            createElement(UiButton, {
              variant: 'outline',
              size: 'sm', key: 'no', disabled: busy,
              onClick: function () { setConfirming(null) },
            }, dshT('取消')),
          ])
          : createElement(UiButton, {
            variant: 'outline',
            size: 'sm',
            className: 'danger', disabled: busy || editing !== null,
            'aria-label': dshT('卸载 Codex 钩子桥'),
            onClick: function () { setConfirming('__codex__') },
          }, dshT('卸载 Codex 桥'))),
    ),
    error ? createElement('div', { className: 'error-text' }, error) : null,
    note !== '' && error === '' ? createElement('div', { className: chNoticeClass(note) }, note) : null,
    data && data.fileError ? createElement('div', { className: 'error-text' }, data.fileError) : null,
    editing !== null
      ? createElement(ChHookForm, {
        initial: editing,
        busy: busy,
        error: '',
        onCancel: function () { setEditing(null) },
        onSave: function (entry) {
          act(call('commandHookAdmin/saveHook', { entry: entry }), function () { setEditing(null) })
        },
      })
      : null,
    hooks.length === 0
      ? createElement('div', { className: 'empty' }, dshT('还没有钩子。钩子会在特定事件（工具调用前后、提交提示词、会话开始/结束等）自动执行命令。'))
      : createElement('div', { className: 'list' }, hooks.map(function (h) {
        return createElement(ChHookRow, {
          key: h.id,
          hook: h,
          busy: busy || editing !== null,
          confirming: confirming === h.id,
          onCancelDelete: function () { setConfirming(null) },
          onConfirmDelete: function () {
            act(call('commandHookAdmin/deleteHook', { id: h.id }), function () { setConfirming(null) })
          },
          onDelete: function () { setConfirming(h.id) },
          onEdit: function () { setEditing(h) },
          onToggle: function () {
            act(call('commandHookAdmin/setHookEnabled', { id: h.id, enabled: !h.enabled }))
          },
        })
      })),
  )
}



/**
 * The two 内置插件 tabs that used to be the standalone 「命令与钩子」 settings
 * section (v1.24.0 split): 「命令」 rides ChCommandsTab and 「钩子」 rides
 * ChHooksTab — each now a plugins-page tab of its own, no segmented chrome of
 * its own. The 项目 `.agents` read-only view was retired with the split
 * (sessionAdmin/list drives the session picker it needed).
 * @param props - renderer-bound props; `call` arrives from the slot inject face.
 * @returns the section element.
 */
function ChCommandsSection(props) {
  return createElement('div', { 'data-cha-section': '' },
    createElement(ChCommandsTab, { call: props.call, key: 'commands' })
  )
}

function ChHooksSection(props) {
  return createElement('div', { 'data-cha-section': '' },
    createElement(ChHooksTab, { call: props.call, key: 'hooks' })
  )
}

/* ========================================================================== */
/*                          Todo Dock (待办清单)                              */
/* ========================================================================== */

// Live todo strip above the composer, mounted through the shell's
// 'conversation.input.dock' slot. Data comes entirely from the framework:
// every session-scope slot component receives the useProjection standard-kit
// hook, and 'todos' is the host-computed whole-list projection the agent's
// todo_write tool drives — so the panel is real-time with zero host state of
// its own. The footer's file-change segment polls sessionAdmin/fileStats,
// which folds the session log's tool/result diff metadata (same counting
// rules as the shell's diff card: old-side lines = removed, new-side =
// added, files = distinct paths).
//
// The shell (>= the version shipping ui-conversation's TodoPanel) renders its
// own collapsed todo strip in this same slot; while our expanded panel has
// data to show, a body class hides that strip to avoid two lists of the same
// todos stacked. Hooked on its data-testid, so a renamed future shell simply
// means both render — degraded, never broken.


/** Completed: filled check disc (green via the glyph cell's currentColor). */
function TodoAdminCompletedGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 6.4, stroke: 'currentColor', strokeWidth: 1.2 }),
    createElement('path', { d: 'M4.2 7.2L6.1 9.1L9.9 4.9', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

/** In-progress: gradient ring spun by the glyph cell's CSS animation. */
function TodoAdminProgressGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 5.6, stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeDasharray: '24 12' }),
  )
}

/** Pending: dashed unstarted ring. */
function TodoAdminPendingGlyph() {
  return createElement('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('circle', { cx: 7, cy: 7, r: 6.4, stroke: 'currentColor', strokeWidth: 1.2, strokeDasharray: '2.4 2.4' }),
  )
}

function TodoAdminStatusGlyph(status) {
  if (status === 'completed') return createElement(TodoAdminCompletedGlyph, { key: 'g' })
  if (status === 'in_progress') return createElement(TodoAdminProgressGlyph, { key: 'g' })
  return createElement(TodoAdminPendingGlyph, { key: 'g' })
}

/**
 * Derive the footer's 「第 X / Y 步」 from the list itself: the first
 * in_progress item's position, or the total once everything settled.
 */
function todoAdminStep(list) {
  var total = list.length
  var completed = 0
  var activeIndex = -1
  for (var i = 0; i < total; i++) {
    var status = list[i] && list[i].status
    if (status === 'completed') completed++
    else if (status === 'in_progress' && activeIndex === -1) activeIndex = i
  }
  var current = activeIndex >= 0 ? activeIndex + 1 : (completed >= total ? total : completed + 1)
  return { current: current, total: total }
}

/** The file row's status letter, sanitized to the renderable kinds (C = copy). */
function todoAdminStatusLetter(status) {
  return status === 'M' || status === 'A' || status === 'D' || status === 'R' || status === 'C' || status === '?' ? status : 'M'
}

/** One git-status file row: colored letter, dim dir prefix + filename, +/- deltas.
 * A button — clicking reveals the file (or its directory, when deleted) in the
 * system explorer via fsAdmin/reveal. */
function TodoAdminFileRow(item, index, reveal) {
  var st = todoAdminStatusLetter(item.status)
  var path = typeof item.path === 'string' && item.path !== '' ? item.path : dshT('（未知路径）')
  var added = typeof item.added === 'number' && item.added > 0 ? item.added : 0
  var removed = typeof item.removed === 'number' && item.removed > 0 ? item.removed : 0
  var nums = [
    createElement('span', { key: 'a', className: 'a' + (added === 0 ? ' zero' : '') }, '+' + added),
    createElement('span', { key: 'd', className: 'd' + (removed === 0 ? ' zero' : '') }, '-' + removed),
  ]
  var slash = path.lastIndexOf('/')
  var dir = slash > 0 ? path.slice(0, slash + 1) : null
  var name = slash > 0 ? path.slice(slash + 1) : path
  var target = typeof item.absPath === 'string' && item.absPath !== '' ? item.absPath
    : (typeof item.absDir === 'string' && item.absDir !== '' ? item.absDir : null)
  var rowProps = {
    key: index,
    type: 'button',
    className: 'todo-file',
    'data-st': st,
    title: target !== null ? path + dshT('\n点击在资源管理器中定位') : path,
  }
  if (target !== null && typeof reveal === 'function') {
    rowProps.onClick = function () { reveal(target) }
  } else {
    rowProps.disabled = true
  }
  return createElement('button', rowProps,
    createElement('span', { className: 'st', 'aria-hidden': 'true' }, st),
    createElement('span', { className: 'p' },
      dir ? createElement('span', { key: 'dir', className: 'dir' }, dir) : null,
      createElement('span', { key: 'name', className: 'name' }, name),
    ),
    createElement('span', { className: 'n' }, nums),
  )
}

/** Collapse-completed summary row: "✓ N 已完成" — click expands the struck items. */
function TodoAdminDoneRow(done, expanded, toggleDone) {
  return createElement('li', { key: 'done-row', className: 'todo-done-row' },
    createElement('button', {
      type: 'button',
      className: 'todo-done-toggle',
      'aria-expanded': expanded ? 'true' : 'false',
      onClick: toggleDone,
    },
    createElement('span', { className: 'todo-glyph', 'aria-hidden': 'true' }, createElement(TodoAdminCompletedGlyph, null)),
    createElement('span', { className: 'todo-done-label' }, done + dshT(' 项已完成')),
    createElement('span', { className: 'todo-chevron', 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
    ))
}

/** Compact elapsed text: 42秒 / 7分24秒 / 1时2分. */
function formatElapsed(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  var total = Math.floor(ms / 1000)
  if (total < 60) return total + dshT('秒')
  var minutes = Math.floor(total / 60)
  var seconds = total % 60
  if (minutes < 60) return minutes + dshT('分') + (seconds > 0 ? seconds + dshT('秒') : '')
  return Math.floor(minutes / 60) + dshT('时') + (minutes % 60) + dshT('分') + (seconds > 0 ? seconds + dshT('秒') : '')
}

/**
 * Render the todo dock: progress bar, todo rows (done section collapsible),
 * the git file-change section with branch badge, footer.
 * @param ui - { collapsed, toggle, activeRef, doneCollapsed, toggleDone,
 *   elapsedOf, reveal, branch, files, added, removed }.
 */
function TodoAdminRender(list, stats, ui) {
  var children = []
  var completed = 0
  for (var c = 0; c < list.length; c++) {
    if ((list[c] || {}).status === 'completed') completed++
  }
  var total = list.length
  // Slim progress bar across the panel top: completion ratio, green at 100%.
  var percent = total > 0 ? Math.round((completed / total) * 100) : 0
  children.push(createElement('div', { key: 'progress', className: 'todo-progress', 'aria-hidden': 'true' },
    createElement('div', {
      className: 'todo-progress-fill' + (percent >= 100 ? ' full' : ''),
      style: { width: percent + '%' },
    }),
  ))

  if (!ui.collapsed) {
    var items = []
    var activeAttached = false
    var doneShown = 0
    for (var i = 0; i < total; i++) {
      var item = list[i] || {}
      var status = typeof item.status === 'string' ? item.status : 'pending'
      if (status === 'completed') {
        doneShown++
        // The done section folds into one summary row; expanding restores
        // the struck-through entries (ai-ux: auto-dismiss, keep accessible).
        if (ui.doneCollapsed) continue
      }
      var liProps = { key: i, className: 'todo-item', 'data-status': status }
      if (status === 'in_progress' && !activeAttached && ui.activeRef) {
        liProps.ref = ui.activeRef
        activeAttached = true
      }
      var elapsed = status === 'in_progress' && typeof ui.elapsedOf === 'function' ? ui.elapsedOf(item.content) : null
      items.push(createElement('li', liProps,
      createElement('span', { className: 'todo-glyph', 'aria-hidden': 'true' }, TodoAdminStatusGlyph(item.status)),
      createElement('span', { className: 'todo-text' }, typeof item.content === 'string' ? item.content : ''),
      elapsed !== null ? createElement('span', { className: 'todo-elapsed' }, formatElapsed(elapsed)) : null,
      ))
    }
    if (doneShown > 0) {
      items.unshift(TodoAdminDoneRow(doneShown, !ui.doneCollapsed, ui.toggleDone))
    }
    children.push(createElement('ul', { key: 'list', className: 'todo-list' }, items))
    var changed = stats !== null && Array.isArray(stats.changed) ? stats.changed : []
    if (changed.length > 0) {
      var rows = []
      for (var f = 0; f < changed.length; f++) rows.push(TodoAdminFileRow(changed[f], f, ui.reveal))
      var headParts = []
      if (typeof ui.branch === 'string' && ui.branch !== '') {
        headParts.push(createElement('span', { key: 'branch-icon', className: 'branch', 'aria-hidden': 'true' }, '⎇'))
        headParts.push(createElement('span', { key: 'branch', className: 'branch-name' }, ui.branch))
      }
      headParts.push(createElement('button', {
        type: 'button',
        key: 'copy-diff',
        className: 'todo-copy-diff',
        title: dshT('复制完整 git diff（HEAD vs 工作区）'),
        onClick: ui.copyDiff,
      }, ui.diffCopied ? dshT('✓ 已复制') : dshT('⧉ 复制 diff')))
      children.push(createElement('div', { key: 'files', className: 'todo-files' },
        createElement('div', { key: 'head', className: 'todo-files-head' }, headParts),
        createElement('div', { key: 'rows' }, rows),
      ))
    }
  }

  var steps = todoAdminStep(list)
  var hasStats = stats !== null && stats.files > 0
  var statsParts = []
  if (hasStats) {
    statsParts.push(createElement('span', { key: 'files' }, stats.files + dshT(' 个文件已改')))
    statsParts.push(createElement('span', { key: 'add', className: 'num-add' }, '+' + stats.added))
    statsParts.push(createElement('span', { key: 'del', className: 'num-del' }, '-' + stats.removed))
  }
  statsParts.push(createElement('span', { key: 'chevron', className: 'todo-chevron', 'aria-hidden': 'true' }, ui.collapsed ? '▲' : '▼'))
  children.push(createElement('button', {
    type: 'button',
    key: 'footer',
    className: 'todo-footer',
    'aria-expanded': ui.collapsed ? 'false' : 'true',
    onClick: ui.toggle,
  },
  createElement('span', { key: 'steps', className: 'todo-steps' }, dshT('第 ') + steps.current + ' / ' + steps.total + dshT(' 步')),
  createElement('span', { key: 'stats', className: 'todo-stats' }, statsParts),
  ))
  // Notification bell floats over the panel's top edge, outside the click-to-
  // collapse surfaces. Absent entirely on platforms without Notifications.
  if (typeof Notification !== 'undefined') {
    children.push(createElement('button', {
      type: 'button',
      key: 'notify',
      className: 'todo-notify' + (ui.notifyEnabled ? ' on' : ''),
      title: ui.notifyEnabled
        ? dshT('桌面通知：开（页面在后台且待办全部完成时提醒）— 点击关闭')
        : dshT('桌面通知：关 — 点击开启（页面在后台且待办全部完成时提醒）'),
      'aria-pressed': ui.notifyEnabled ? 'true' : 'false',
      onClick: ui.toggleNotify,
    }, TodoAdminBellGlyph(ui.notifyEnabled)))
  }
  return createElement('section', {
    'data-dsh-admin-todo': '',
    'aria-label': dshT('待办清单'),
  }, children)
}

/** Bell outline; the off state adds a slash so the toggle reads at a glance. */
function TodoAdminBellGlyph(on) {
  return createElement('svg', {
    width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
  createElement('path', { d: 'M8 2.2a4 4 0 0 0-4 4c0 3.1-1.2 4.3-1.2 4.3h10.4S12 9.3 12 6.2a4 4 0 0 0-4-4z' }),
  createElement('path', { d: 'M6.7 13.1a1.4 1.4 0 0 0 2.6 0' }),
  on ? null : createElement('path', { d: 'M2.5 2.5l11 11' }),
  )
}

// First-seen-in-progress timestamps, keyed 'sessionId\u0000content', so the
// active step can show a live elapsed counter (Claude Code's "visibly tick"
// pattern) without inventing data — the clock starts when the dock first
// observes the item, so a page reload resets it.
var todoActiveSince = new Map()

var TODO_DONE_KEY = 'dsh-admin-todo-hide-done'

var TODO_NOTIFY_KEY = 'dsh-admin-todo-notify'

function readDoneCollapsed() {
  try { return window.localStorage.getItem(TODO_DONE_KEY) === '1' } catch (e) { return false }
}

/**
 * The dock entry component. Framework props: useProjection (session
 * standard kit) — everything else arrives via the registration's inject.
 */
function TodoAdminDock(props) {
  var useProjection = props.useProjection
  // The projection hook is part of the standard kit seat; call it
  // unconditionally at the top so hook order stays stable across renders.
  var todos = typeof useProjection === 'function' ? useProjection('todos') : null
  var list = Array.isArray(todos) ? todos : []
  var show = list.length > 0

  var collapsedState = useState(false)
  var collapsed = collapsedState[0]
  var setCollapsed = collapsedState[1]

  var doneCollapsedState = useState(readDoneCollapsed)
  var doneCollapsed = doneCollapsedState[0]
  var setDoneCollapsed = doneCollapsedState[1]

  var statsState = useState(null)
  var stats = statsState[0]
  var setStats = statsState[1]

  // Live elapsed counter for the in-progress step: maintain first-seen
  // timestamps for the session's active contents, then tick once a second
  // while any is active.
  var nowState = useState(null)
  var nowMs = nowState[0]
  var setNow = nowState[1]
  var sessionId = props.sessionId
  var call = props.call

  useEffect(function () {
    if (!show || typeof sessionId !== 'string') return undefined
    var keyPrefix = sessionId + '\u0000'
    var actives = []
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {}
      if (item.status === 'in_progress' && typeof item.content === 'string') actives.push(item.content)
    }
    var now = Date.now()
    var addedNew = false
    for (var a = 0; a < actives.length; a++) {
      var key = keyPrefix + actives[a]
      if (!todoActiveSince.has(key)) {
        todoActiveSince.set(key, now)
        addedNew = true
      }
    }
    var stale = []
    todoActiveSince.forEach(function (v, k) {
      if (k.indexOf(keyPrefix) === 0) {
        if (actives.indexOf(k.slice(keyPrefix.length)) === -1) stale.push(k)
      } else {
        // Another session's entry: it would otherwise live until the page
        // reloads (the same-session pass above cannot see it), so switching
        // sessions drops the previous session's timestamps here.
        stale.push(k)
      }
    })
    for (var s = 0; s < stale.length; s++) todoActiveSince.delete(stale[s])
    if (addedNew || stale.length > 0) setNow(now)
    if (actives.length === 0) return undefined
    var timer = setInterval(function () { setNow(Date.now()) }, 1000)
    return function () { clearInterval(timer) }
  }, [show, sessionId, todos])

  var elapsedOf = function (content) {
    if (typeof nowMs !== 'number' || typeof sessionId !== 'string') return null
    var start = todoActiveSince.get(sessionId + '\u0000' + content)
    if (typeof start !== 'number') return null
    return Math.max(0, nowMs - start)
  }

  var toggleDone = function () {
    setDoneCollapsed(function (v) {
      var next = !v
      try { window.localStorage.setItem(TODO_DONE_KEY, next ? '1' : '0') } catch (e) { /* private mode */ }
      return next
    })
  }

  var reveal = function (path) {
    if (typeof call !== 'function' || typeof path !== 'string' || path === '') return
    // Explorer opening is its own success feedback; a failure would
    // otherwise read as a dead click (the workspace menu already toasts).
    call('fsAdmin/reveal', { path: path }).then(function (result) {
      if (!(result && result.ok)) showToast('error', dshT('❌ 打开失败：') + messageOf(result && result.error))
    }, function (err) { showToast('error', dshT('❌ 打开失败：') + messageOf(err)) })
  }

  // Copy-diff: pulls the workspace's full `git diff HEAD` on demand (the
  // payload is far too big to ride the stats poll) and lands it on the
  // clipboard; the button flashes ✓ so the gesture reads as done.
  var copyDiffState = useState(false)
  var diffCopied = copyDiffState[0]
  var setDiffCopied = copyDiffState[1]
  var copyDiffTimer = useRef(null)
  useEffect(function () {
    return function () { if (copyDiffTimer.current) clearTimeout(copyDiffTimer.current) }
  }, [])
  var copyDiff = function () {
    if (typeof call !== 'function' || typeof sessionId !== 'string') return
    call('sessionAdmin/gitDiff', { sessionId: sessionId }).then(function (res) {
      var value = res && res.ok && res.value && typeof res.value === 'object' ? res.value : null
      if (value === null || typeof value.diff !== 'string') {
        showToast('error', dshT('❌ 获取 diff 失败'))
        return
      }
      if (value.diff === '') {
        showToast('success', dshT('工作区干净，没有未提交的改动'))
        return
      }
      copyTextSilently(value.diff).then(function () {
        setDiffCopied(true)
        if (copyDiffTimer.current) clearTimeout(copyDiffTimer.current)
        copyDiffTimer.current = setTimeout(function () { setDiffCopied(false) }, 1500)
      }, function () {
        showToast('error', dshT('❌ 复制失败'))
      })
    }, function () {
      showToast('error', dshT('❌ 获取 diff 失败'))
    })
  }

  // Desktop notification on the all-done transition (attention tier, from
  // the agent-status pattern library): fires only when the tab is hidden —
  // if the user is looking at the panel, a toast would be noise.
  var notifyEnabledState = useState(function () {
    try {
      return typeof Notification !== 'undefined' && Notification.permission === 'granted'
        && window.localStorage.getItem(TODO_NOTIFY_KEY) === '1'
    } catch (e) { return false }
  })
  var notifyEnabled = notifyEnabledState[0]
  var setNotifyEnabled = notifyEnabledState[1]
  var allDone = false
  if (show) {
    allDone = true
    for (var d = 0; d < list.length; d++) {
      if ((list[d] || {}).status !== 'completed') { allDone = false; break }
    }
  }
  var prevAllDoneRef = useRef(false)
  useEffect(function () {
    var entered = allDone && !prevAllDoneRef.current
    prevAllDoneRef.current = allDone
    if (!entered || !notifyEnabled) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (typeof document !== 'undefined' && !document.hidden) return
    try {
      var last = list[list.length - 1] || {}
      var notification = new Notification(dshT('✅ 待办全部完成'), {
        body: dshT('共 ') + list.length + dshT(' 项 · ') + (typeof last.content === 'string' ? last.content : ''),
        tag: 'dsh-admin-todo-done',
      })
      notification.onclick = function () {
        try { window.focus(); notification.close() } catch (e) { /* already closed */ }
      }
    } catch (e) { /* some platforms throw without an active service worker */ }
  }, [allDone, notifyEnabled, todos])
  var toggleNotify = function () {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      setNotifyEnabled(function (v) {
        var next = !v
        try { window.localStorage.setItem(TODO_NOTIFY_KEY, next ? '1' : '0') } catch (e) { /* private mode */ }
        return next
      })
      return
    }
    if (Notification.permission === 'denied') {
      showToast('error', dshT('通知权限已被浏览器拒绝，请在站点设置中允许后重试'))
      return
    }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') {
        setNotifyEnabled(true)
        try { window.localStorage.setItem(TODO_NOTIFY_KEY, '1') } catch (e) { /* private mode */ }
      }
    }).catch(function () { /* permission prompt dismissed */ })
  }

  // Keep the current step (first in-progress item) inside the clipped list's
  // view whenever the todo list changes; nearest-scroll never yanks the user
  // around inside the container. jsdom has no scrollIntoView — the guard
  // keeps the verify render a no-op there.
  var activeItemRef = useRef(null)
  useEffect(function () {
    var node = activeItemRef.current
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' })
    }
  }, [todos])

  // Hide the shell's own collapsed todo strip while we are showing the same
  // list expanded; the moment we render nothing, make sure the strip is back.
  useEffect(function () {
    if (show) document.body.classList.add('dsh-admin-todo-live')
    else document.body.classList.remove('dsh-admin-todo-live')
    return function () { document.body.classList.remove('dsh-admin-todo-live') }
  }, [show])

  // Poll the folded file-change stats at a gentle cadence while visible;
  // sessionAdmin/fileStats never throws for unknown sessions, and a failed
  // poll just keeps the previous value.
  useEffect(function () {
    if (!show || !sessionId || typeof call !== 'function') return undefined
    var disposed = false
    var tick = function () {
      call('sessionAdmin/fileStats', { sessionId: sessionId }).then(function (res) {
        var value = res && res.ok && res.value && typeof res.value === 'object' ? res.value : null
        if (disposed || value === null) return
        setStats(function (prev) {
          if (prev && prev.files === value.files && prev.added === value.added && prev.removed === value.removed
            && prev.branch === (typeof value.branch === 'string' ? value.branch : null)) return prev
          return {
            files: value.files,
            added: value.added,
            removed: value.removed,
            branch: typeof value.branch === 'string' && value.branch !== '' ? value.branch : null,
            changed: Array.isArray(value.changed) ? value.changed : [],
          }
        })
      }).catch(function () {})
    }
    tick()
    var timer = setInterval(tick, 4000)
    return function () { disposed = true; clearInterval(timer) }
  }, [show, sessionId, call])

  if (!show) return null

  return TodoAdminRender(list, stats, {
    collapsed: collapsed,
    toggle: function () { setCollapsed(function (v) { return !v }) },
    activeRef: activeItemRef,
    doneCollapsed: doneCollapsed,
    toggleDone: toggleDone,
    elapsedOf: elapsedOf,
    reveal: reveal,
    branch: stats !== null ? stats.branch : null,
    copyDiff: copyDiff,
    diffCopied: diffCopied,
    notifyEnabled: notifyEnabled,
    toggleNotify: toggleNotify,
  })
}

/* ========================================================================== */
/*                          Automation section (自动化)                        */
/* ========================================================================== */

// 定时任务 + Webhook + 工作流 merged into ONE settings nav entry (v1.24.0 —
// the first two used to be standalone sections, and the webhook tab drops the
// 触发 suffix; 工作流 joins as the third tab). The SAME panels underneath —
// every behavior is unchanged. Scoped data-cha-section: it carries the shared
// segmented-tab styles the former 命令与钩子 section used.
function AutomationSection(props) {
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
      onKeyDown: function (event) { tabKeyDown(event, tabs, selected.id, setTab) } },
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
function cronTemplates() {
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

function webhookTemplates() {
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
function generateWebhookSecret() {
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

function WebhookSection(props) {
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

  function patch(partial) {
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

  function patchDraft(partial) {
    setState(function (cur) {
      var next = {}
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
    setState(function (cur) {
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.showSecret = !cur.showSecret
      return next
    })
  }

  function saveDraft() {
    var d = state.draft
    if (!d) return
    patch({ busy: true, error: '' })
    var entry = {
      id: d.id,
      enabled: d.enabled,
      secret: d.secret,
      event: d.event,
      action: {
        mode: d.actionMode,
      },
      promptTemplate: d.promptTemplate,
    }
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
 */
function CronSection(props) {
  var kit = sectionState({
    busy: false,
    error: '',
    tasks: [],
    history: [],
    presets: [],
    permissionPresetNames: [],
    storagePath: '',
    schedulerActive: true,
    editorOpen: false,
    draft: null,
    confirmId: null,
    nowMs: Date.now(),
  })
  var state = kit.state
  var setState = kit.set
  var alive = kit.alive

  function patch(partial) {
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
        schedulerActive: v.schedulerActive === true,
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
    var timer = setInterval(function () { setState(function (cur) {
      var next = {}
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
  function patchSchedule(partial) {
    setState(function (cur) {
      if (!cur.draft) return cur
      var draft = mergeObject(cur.draft, partial)
      draft.cron = composeCron(draft.schedMode, draft.schedTime, draft.schedDow)
      var next = {}
      for (var k in cur) next[k] = cur[k]
      next.draft = draft
      return next
    })
  }

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

  function patchDraft(partial) {
    setState(function (cur) {
      var next = {}
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
    var entry = {
      id: d.id,
      enabled: d.enabled,
      cron: d.cron,
      action: { mode: d.actionMode },
      promptTemplate: d.promptTemplate,
    }
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
 */
function WorkspacesSection(props) {
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

  function patch(partial) {
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

  function setCreateField(field, value) {
    setState(function (cur) {
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

  function openRename(id, currentTitle) {
    patch({ renameId: id, renameDraft: currentTitle || '', renameError: '' })
  }
  function cancelRename() {
    patch({ renameId: null, renameDraft: '', renameError: '' })
  }
  function setRenameDraft(value) {
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

  function moveWorkspace(id, beforeId) {
    patch({ busy: true, error: '' })
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

  function moveUp(id, index) {
    if (index <= 0) return
    var before = state.workspaces[index - 1]
    if (!before) return
    moveWorkspace(id, before.workspaceId)
  }
  function moveDown(id, index) {
    var next = state.workspaces[index + 1]
    if (!next) return
    // To move "after next", insertBefore next with anchor = next.nextSibling (or undefined for tail).
    var anchor = state.workspaces[index + 2]
    moveWorkspace(id, anchor ? anchor.workspaceId : undefined)
  }

  // ---------- Delete ----------

  function askDelete(id) {
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

  function checkStatus(id) {
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
    var step = function (i) {
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
        createElement(UiInput, {  key: 'path', placeholder: dshT('或手动输入绝对目录路径'), value: state.createPath, onChange: function (e) { setCreateField('path', e.target.value) } }),
      ),
      createElement(UiInput, {  key: 'title', placeholder: dshT('显示标题（留空则用目录最后一段）'), value: state.createTitle, onChange: function (e) { setCreateField('title', e.target.value) } }),
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
              onChange: function (e) { setRenameDraft(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') submitRename(); else if (e.key === 'Escape') cancelRename() },
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
 */
function WorkflowSection(props) {
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
      var live = ((res.value && res.value.sessions) || []).filter(function (s) { return s && s.live && s.id })
      var keep = parentSessionRef.current
      parentSessionRef.current = live.some(function (s) { return s.id === keep })
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
    var anyRunning = (runsRef.current || []).some(function (r) { return r.status === 'running' || r.status === 'pending' })
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

  function openRun(runId) {
    if (state.openRunId === runId) { patch({ openRunId: null, runDetail: null, answerText: '' }); return }
    patch({ openRunId: runId, runDetail: null, answerText: '' })
    call('workflowAdmin/getRun', { runId: runId }).then(function (res) {
      if (!alive.current) return
      if (res.ok) patch({ runDetail: res.value })
      else patch({ runDetail: { error: messageOf(res.error) } })
    }, function (error) {
      // 详情卡只在 `state.runDetail` 有值时渲染：传输失败/宿主半未注册该接口时，
      // 没有这个失败分支就只是"点了没反应"，外加一个未处理的 rejection。
      if (!alive.current) return
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
        var diags = ((r && r.diagnostics) || []).map(function (d) { return d.message }).join('\n')
        patch({ editorBusy: false, editorError: diags || messageOf((res && res.error) || (r && r.error)) })
      }
    }, function (e) {
      if (!alive.current) return
      patch({ editorBusy: false, editorError: messageOf(e) })
    })
  }

  function stopRun(runId) {
    call('workflowAdmin/stopRun', { runId: runId, reason: 'panel' }).then(function (res) {
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.stopped === false) showToast('error', dshT('该运行已不在进行中'))
      if (r && r.abandoned) showToast('error', dshT('停止请求已送达，但运行未在预算内落定（脚本忽略取消信号？）'))
      reload()
    }, function (e) { showToast('error', dshT('❌ 停止失败：') + messageOf(e)) })
  }

  function amendRun(runId) {
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
        var diags = ((r && r.diagnostics) || []).map(function (d) { return d.message }).join('\n')
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

  function resumeRun(runId) {
    call('workflowAdmin/resumeRun', { runId: runId }).then(function (res) {
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.id) { patch({ openRunId: r.id }); showToast('success', dshT('▶️ 已从断点续跑')); reload() }
      else showToast('error', messageOf((res && res.error) || (r && r.error)))
    }, function (e) { showToast('error', dshT('❌ 续跑失败：') + messageOf(e)) })
  }

  function runSaved(name) {
    var payload = { spec: { name: name, args: {} } }
    if (parentSessionRef.current) payload.spec.parentSessionId = parentSessionRef.current
    call('workflowAdmin/runSaved', payload).then(function (res) {
      if (!alive.current) return
      var r = res && res.ok ? res.value : null
      if (r && r.id) { patch({ tab: 'runs', openRunId: r.id }); showToast('success', dshT('🚀 已启动：') + name); reload() }
      else showToast('error', messageOf((res && res.error) || (r && r.error)))
    }, function (e) { showToast('error', dshT('❌ 启动失败：') + messageOf(e)) })
  }

  function saveSavedFromEditor() {
    var ed = state.savedEditor
    if (!ed || !ed.name || !ed.script) { patch({ savedError: dshT('名称和脚本不能为空') }); return }
    patch({ savedBusy: true, savedError: '' })
    call('workflowAdmin/saveSaved', { spec: ed }).then(function (res) {
      if (!alive.current) return
      if (res.ok) { patch({ savedBusy: false, savedEditor: null }); showToast('success', dshT('💾 已保存：') + ed.name); reload() }
      else patch({ savedBusy: false, savedError: messageOf(res.error) })
    }, function (e) {
      if (!alive.current) return
      patch({ savedBusy: false, savedError: messageOf(e) })
    })
  }

  function deleteSaved(name, scope) {
    call('workflowAdmin/deleteSaved', { spec: { name: name, scope: scope } }).then(function (res) {
      if (!alive.current) return
      if (res.ok) { patch({ confirmDelete: null }); showToast('success', dshT('🗑 已删除：') + name); reload() }
      else showToast('error', messageOf(res.error))
    }, function (e) { showToast('error', dshT('❌ 删除失败：') + messageOf(e)) })
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
    onKeyDown: function (event) {
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

  function tabButton(key, label) {
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
          onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTpl() } },
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

  function runCard(run) {
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
            onChange: function (e) { patch({ answerText: e.target.value }) },
            onKeyDown: function (e) { if (e.key === 'Enter') submitAnswer() },
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
        onChange: function (e) { ed.label = e.target.value; patch({ editor: ed }) },
        readOnly: isAmend,
      }),
      (!isAmend && state.liveSessions.length > 1)
        ? h('div', { key: 'parent-row', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          h('span', { key: 'parent-label', style: { flex: 'none', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } }, dshT('父会话')),
          h('select', {
            key: 'parent', value: state.parentSessionId,
            onChange: function (e) { parentSessionRef.current = e.target.value; patch({ parentSessionId: e.target.value }) },
            style: inputStyle({ flex: '1' }),
          }, state.liveSessions.map(function (s) {
            return h('option', { key: s.id, value: s.id }, (s.title || s.id) + (s.cwd ? ' · ' + s.cwd : ''))
          })),
        ])
        : (!isAmend && state.liveSessions.length === 0)
          ? h('div', { key: 'parent-hint', style: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '12px' } },
            dshT('没有在线会话——先在 dsh 中打开一个会话，再启动工作流。'))
          : null,
      h('textarea', {
        key: 'script', placeholder: dshT('TypeScript / JavaScript，顶层 return 返回结果'), value: ed.script,
        onChange: function (e) { ed.script = e.target.value; patch({ editor: ed }) },
        style: textareaStyle(),
      }),
      h('textarea', {
        key: 'args', placeholder: dshT('args（JSON 对象）'), value: ed.argsText,
        onChange: function (e) { ed.argsText = e.target.value; patch({ editor: ed }) },
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

  function savedCard(rec) {
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
        ? h('button', { key: 'del-no', onClick: function () { patch({ confirmDelete: null }) }, style: btnStyle() }, '取消')
        : null,
    ])
    row.push(actions)
    return h('div', { key: 'saved-' + rec.name, className: 'card', style: { padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px' } }, row)
  }

  function renderSavedEditor() {
    var ed = state.savedEditor
    var children = [
      h('div', { key: 'head', style: { fontWeight: '700', marginBottom: '8px' } }, dshT('保存到工作库')),
      h(UiInput, {
        key: 'name', className: 'wf-input', placeholder: dshT('名称（字母数字 . _ -）'), value: ed.name,
        onChange: function (e) { ed.name = e.target.value; patch({ savedEditor: ed }) },
      }),
      h('select', {
        key: 'scope', value: ed.scope,
        onChange: function (e) { ed.scope = e.target.value; patch({ savedEditor: ed }) },
        style: inputStyle(),
      }, [
        h('option', { key: 'g', value: 'global' }, dshT('全局')),
        h('option', { key: 'p', value: 'project' }, dshT('项目（随工作区 .dsh/）')),
      ]),
      h(UiInput, {
        key: 'desc', className: 'wf-input', placeholder: dshT('一句话描述（可选）'), value: ed.description,
        onChange: function (e) { ed.description = e.target.value; patch({ savedEditor: ed }) },
      }),
      h('textarea', {
        key: 'script', placeholder: dshT('脚本'), value: ed.script,
        onChange: function (e) { ed.script = e.target.value; patch({ savedEditor: ed }) },
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
function exampleScript() {
  return [
  dshT('// 可用：agent(prompt, opts?) / parallel(thunks) / pipeline(items, ...stages)'),
  dshT('//       phase(title) / log(msg) / report(key, value) / shell(cmd)'),
  dshT('// 顶层 return 返回结果；单步失败 agent() 返回 null，脚本继续。'),
  'const files = ["a.ts", "b.ts"]',
  'const reviews = await parallel(files.map((f) => () => agent("审查 " + f + " 的类型问题")))',
  'return reviews.filter((r) => r !== null)',
].join('\n')
}

function wfTemplates() {
  return [
  {
    title: dshT('总结一个主题'),
    desc: dshT('派一个子智能体，按你给的主题输出一段总结'),
    label: '主题总结',
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

function statusText(s) {
  return s === 'running' ? dshT('运行中')
    : s === 'completed' ? dshT('已完成')
    : s === 'errored' ? dshT('失败')
    : s === 'stopped' ? dshT('已停止')
    : s === 'orphaned' ? dshT('已失活')
    : s
}

function pillStyle(color) {
  return {
    display: 'inline-block', padding: '1px 8px', borderRadius: '10px',
    fontSize: '11px', color: '#fff', background: color,
  }
}

function btnStyle(bg, fg) {
  return {
    padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
    border: '1px solid ' + (bg || 'var(--dsw-alias-border-l2, #ddd)'),
    background: bg || 'transparent', color: fg || 'inherit',
    fontSize: '12px',
  }
}

/** Build one composer-row input style; caller overrides merge on top
 * (same contract as textareaStyle / preStyle — the two call sites that pass
 * `{ flex: '1' }` used to have that override silently dropped).
 * @param {Record<string, any>} [over] - style keys to override.
 * @returns {Record<string, any>} the style object.
 */
function inputStyle(over) {
  var base = {
    width: '100%', padding: '6px 8px', marginBottom: '8px',
    borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
    boxSizing: 'border-box',
  }
  for (var k in (over || {})) base[k] = over[k]
  return base
}

function textareaStyle(over) {
  var base = {
    width: '100%', minHeight: '140px', padding: '8px', marginBottom: '8px',
    borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
    fontFamily: 'monospace', fontSize: '12px', boxSizing: 'border-box',
  }
  for (var k in (over || {})) base[k] = over[k]
  return base
}

function preStyle(over) {
  var base = {
    padding: '8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
    background: 'var(--dsw-alias-bg-base, #f6f6f6)', fontSize: '12px', overflow: 'auto',
    maxHeight: '260px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  }
  for (var k in (over || {})) base[k] = over[k]
  return base
}

function safeStringify(v) {
  try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) }
  catch (e) { return String(v) }
}


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
 */
function WebSearchSection(props) {
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

  function selectProvider(id) {
    if (state.active !== null && state.active.searchProvider === id) return
    patch({ busyId: id, error: '' })
    call('webSearchAdmin/setActive', { providerId: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patch({ busyId: '', active: result.value || { searchProvider: id } })
      } else {
        patch({ busyId: '', error: dshT('切换失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busyId: '', error: dshT('切换失败：') + messageOf(err) })
    })
  }

  function installProvider(id) {
    patch({ busyId: id, error: '' })
    call('webSearchAdmin/install', { providerId: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patch({ busyId: '' })
        reload()
      } else {
        patch({ busyId: '', error: dshT('安装失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busyId: '', error: dshT('安装失败：') + messageOf(err) })
    })
  }

  function uninstallProvider(id) {
    patch({ busyId: id, error: '' })
    call('webSearchAdmin/uninstall', { providerId: id }).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        patch({ busyId: '' })
        reload()
      } else {
        patch({ busyId: '', error: dshT('卸载失败：') + messageOf(result.error) })
      }
    }, function (err) {
      if (!alive.current) return
      patch({ busyId: '', error: dshT('卸载失败：') + messageOf(err) })
    })
  }

  // ---------- Provider configuration ----------

  /** Fetch one provider's editable configuration into the open editor. */
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

  /** Open one provider's editor (loading its config) or close the open one. */
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

  /** Stage one field edit (per-key map; a plain merge cannot express it). */
  function setDraftField(key, value) {
    var next = {}
    for (var existing in state.draft) next[existing] = state.draft[existing]
    next[key] = value
    patch({ draft: next })
  }

  /** Toggle the pending removal of one key (secrets need an explicit click). */
  function toggleClear(key) {
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
   */
  function saveProviderConfig(id) {
    var view = state.config
    if (view === null) return
    var fields = Array.isArray(view.fields) ? view.fields : []
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
    dshT('🔁 切换 provider / 安装 / 卸载 后需**重启 dsh** 生效；⚙ 配置里带 settings 命名空间的 provider 保存后即时生效，写 cordis 行的需重启'),
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
 * One provider's staged configuration form. Field descriptors come from the
 * host (`webSearchAdmin/config`), so the panel renders exactly the keys the
 * provider package's Config declares — with its enum choices, its minimums
 * and its defaults. Secret fields are write-only and can only be removed
 * through the explicit 清除 toggle.
 * @param view - { label, namespace, source, restartRequired, fields, note }.
 * @param ui - { draft, cleared, busy, configError, note, setField, toggleClear, save }.
 */
function renderProviderConfig(view, ui) {
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
        onChange: function (e) { ui.setField(field.key, e.target.value) },
      }, options)
    } else {
      var placeholder = field.kind === 'secret'
        ? (field.set === true ? dshT('已配置 — 留空不修改') : dshT('未配置 — 留空则回退到凭据 / 环境变量'))
        : (field.default === null || field.default === undefined ? dshT('留空 = 继承 provider 默认值') : dshT('继承默认：') + field.default)
      input = createElement(UiInput, {
        type: field.kind === 'secret' ? 'password' : (field.kind === 'number' ? 'number' : 'text'),
        value: staged, placeholder: placeholder, disabled: ui.busy, 'aria-label': field.label,
        onChange: function (e) { ui.setField(field.key, e.target.value) },
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
 * The editor slot for one provider card: a loading banner, the load failure,
 * or the form itself. Kept separate so the card loop stays declarative.
 * @param provider - the list() row (id + label).
 * @param state - the section state (config / configBusy / configError / draft).
 * @param handlers - { setField, toggleClear, save }.
 */
function buildProviderConfigElement(provider, state, handlers) {
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
function SkillsSection(props) {
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
      subChildren.push(createElement('div', { className: 'card-sub', key: 'url' },
        createElement('a', { href: skill.url, target: '_blank', rel: 'noreferrer', className: 'group-path' }, skill.url)))
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
function skillsSourceLabel(source) {
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


function WebhookRender(view, actions) {
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
        onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTpl() } },
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
            createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function (e) { e.stopPropagation(); actions.openEditor(rule) } }, dshT('编辑')),
            createElement(UiButton, { variant: 'outline', size: 'sm', onClick: function (e) { e.stopPropagation(); actions.testRule(rule.id) }, title: dshT('会真实注入消息到目标会话') }, dshT('🧪 触发测试')),
            createElement(UiButton, {
              variant: 'outline',
              size: 'sm',
              className: 'danger',
              onClick: function (e) { e.stopPropagation(); actions.patch({ confirmId: view.confirmId === rule.id ? null : rule.id }) },
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

function renderWebhookEditor(view, actions) {
  var d = view.draft
  if (!d) return null
  return createElement('div', { className: 'card mcp-editor', key: 'editor' },
    createElement('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline' } },
      createElement('label', { style: { fontSize: '12px', fontWeight: 600, flex: 'none' } }, 'ID'),
      createElement(UiInput, {  value: d.id, disabled: !d.isNew, onChange: function (e) { actions.patchDraft({ id: e.target.value }) }, placeholder: dshT('规则标识（英文字母开头，无空格）') }),
    ),
    createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      createElement(UiCheckbox, {
        checked: d.enabled,
        onChange: function (next) { actions.patchDraft({ enabled: next }) },
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
            onChange: function (e) { actions.patchDraft({ secret: e.target.value }) },
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
        createElement(UiInput, {  value: d.event, onChange: function (e) { actions.patchDraft({ event: e.target.value }) }, placeholder: dshT('事件过滤（留空 = 任意事件）') }),
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
        createElement(UiInput, {  value: d.sessionId, onChange: function (e) { actions.patchDraft({ sessionId: e.target.value }) }, placeholder: dshT('目标会话 ID（如 session-xxx）') }),
        createElement('span', { style: { marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' } },
          createElement(UiCheckbox, {
            checked: d.steer,
            onChange: function (next) { actions.patchDraft({ steer: next }) },
            label: dshT('steer（插入到下一步之前，勾选后 agent 当前步骤完成后立即处理）'),
          }),
        ),
      )
      : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        createElement(UiInput, {  value: d.workspacePath, onChange: function (e) { actions.patchDraft({ workspacePath: e.target.value }) }, placeholder: dshT('工作区绝对路径（如 E:\\projects\\my-app）') }),
        createElement('div', { style: { display: 'flex', gap: '8px' } },
          createElement('select', { className: 'input', value: d.agentPreset, onChange: function (e) { actions.patchDraft({ agentPreset: e.target.value }) }, style: { width: 'auto' } },
            (view.presets.length > 0 ? view.presets : [{ id: 'cordis', name: 'cordis' }]).map(function (p) {
              return createElement('option', { key: p.id, value: p.id }, p.name || p.id)
            }),
          ),
          createElement('select', { className: 'input', value: d.permissionPreset, onChange: function (e) { actions.patchDraft({ permissionPreset: e.target.value }) }, style: { width: 'auto' } },
            (view.permissionPresetNames.length > 0 ? view.permissionPresetNames : ['workspace-write', 'danger-full-access']).map(function (n) {
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
        onChange: function (e) { actions.patchDraft({ promptTemplate: e.target.value }) },
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
 */
function formatCountdown(ms) {
  if (ms === null || ms === undefined || ms < 0) return '—'
  var total = Math.floor(ms / 1000)
  if (total < 1) return '< 1s'
  var days = Math.floor(total / 86400)
  var rem = total - days * 86400
  var h = Math.floor(rem / 3600)
  var m = Math.floor((rem - h * 3600) / 60)
  var s = rem - h * 3600 - m * 60
  var pad = function (n) { return (n < 10 ? '0' : '') + n }
  if (days > 0) return days + 'd ' + pad(h) + ':' + pad(m) + ':' + pad(s)
  if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s)
  if (m > 0) return pad(m) + ':' + pad(s)
  return s + 's'
}

/** Local-time rendering of an epoch-ms value for the row tooltip. */
function formatLocal(ms) {
  if (ms === null || ms === undefined) return '—'
  var d = new Date(ms)
  var pad = function (n) { return (n < 10 ? '0' : '') + n }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

function CronRender(view, actions) {
  var elements = []

  if (view.busy) elements.push(createElement('div', { className: 'busy-banner', key: 'busy' },
    createElement('span', { className: 'spinner', key: 'sp' }), dshT('加载中…')))

  if (view.error) elements.push(createElement('div', { className: 'error', key: 'err' }, view.error))

  if (!view.schedulerActive) {
    elements.push(createElement('div', { className: 'update-strip checking', key: 'sched-banner' },
      createElement('span', null, dshT('调度器未运行（headless 部署或插件加载失败）——任务可编辑，但不会自动触发')),
    ))
  }

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
        onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTpl() } },
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
            createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', marginRight: '4px' }, title: dshT('启用/停用'), onClick: function (e) { e.stopPropagation() } },
              createElement(UiCheckbox, {
                checked: task.enabled === true,
                onChange: function (next) { actions.toggleTask(task.id, next) },
                label: dshT('启用'),
              }),
            ),
            createElement(UiButton, { variant: 'primary', size: 'sm', onClick: function (e) { e.stopPropagation(); actions.openEditor(task) } }, dshT('编辑')),
            createElement(UiButton, { variant: 'primary', size: 'sm', onClick: function (e) { e.stopPropagation(); actions.runNow(task.id) }, title: dshT('立即触发一次（会真实注入消息/新建会话）') }, dshT('▶ 立即触发')),
            createElement(UiButton, {
              variant: 'outline',
              size: 'sm',
              className: 'danger',
              onClick: function (e) { e.stopPropagation(); actions.patch({ confirmId: view.confirmId === task.id ? null : task.id }) },
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

function pad2(n) { return (n < 10 ? '0' : '') + n }

function composeCron(mode, time, dow) {
  var parts = /^(\d{1,2}):(\d{1,2})$/.exec(time || '09:00')
  var hh = parts ? Number(parts[1]) : 9
  var mm = parts ? Number(parts[2]) : 0
  if (mode === 'hourly') return mm + ' * * * *'
  if (mode === 'weekly') return mm + ' ' + hh + ' * * ' + (dow || '1')
  return mm + ' ' + hh + ' * * *'
}

function parseCronSchedule(cron) {
  var f = String(cron || '').trim().split(/\s+/)
  var num = function (s) { return /^\d+$/.test(s) ? Number(s) : null }
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

function describeSchedule(mode, time, dow) {
  var names = { '0': dshT('周日'), '1': dshT('周一'), '2': dshT('周二'), '3': dshT('周三'), '4': dshT('周四'), '5': dshT('周五'), '6': dshT('周六') }
  var parts = String(time || '09:00').split(':')
  if (mode === 'hourly') return dshT('每小时第 ') + parts[1] + dshT(' 分')
  if (mode === 'weekly') return dshT('每周 ') + (names[dow] || dow) + ' ' + time
  return dshT('每天 ') + time
}

/** Local UTC offset as a conventional label: GMT+8, GMT-5, GMT+5:30. */
function tzLabel() {
  var minutes = -new Date().getTimezoneOffset()
  var sign = minutes < 0 ? '-' : '+'
  var abs = Math.abs(minutes)
  var hours = Math.floor(abs / 60)
  var rest = abs % 60
  return 'GMT' + sign + hours + (rest === 0 ? '' : ':' + (rest < 10 ? '0' : '') + rest)
}

function renderCronEditor(view, actions) {
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
        onChange: function (e) { actions.patchDraft({ id: e.target.value }) },
        placeholder: dshT('任务标识（英文字母开头，无空格）'),
        'aria-label': dshT('任务 ID'),
        style: { flex: 1 },
      }),
      createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', flex: 'none', cursor: 'pointer' } },
        createElement(UiCheckbox, {
          checked: d.enabled,
          onChange: function (next) { actions.patchDraft({ enabled: next }) },
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
          onChange: function (e) { actions.patchSchedule({ schedMode: e.target.value }) },
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
            onChange: function (e) { actions.patchSchedule({ schedDow: e.target.value }) },
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
            onChange: function (e) { actions.patchSchedule({ schedTime: '00:' + pad2(Number(e.target.value)) }) },
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
            onChange: function (e) { actions.patchSchedule({ schedTime: e.target.value || '09:00' }) },
          })
          : null,
        d.schedMode === 'custom'
          ? createElement(UiInput, {
            value: d.cron,
            onChange: function (e) { actions.patchDraft({ cron: e.target.value }) },
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
        createElement(UiInput, {  value: d.sessionId, onChange: function (e) { actions.patchDraft({ sessionId: e.target.value }) }, placeholder: dshT('目标会话 ID（如 session-xxx）') }),
        createElement('span', { style: { marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: secondary } },
          createElement(UiCheckbox, {
            checked: d.steer,
            onChange: function (next) { actions.patchDraft({ steer: next }) },
            label: dshT('steer（插入到下一步之前，勾选后 agent 当前步骤完成后立即处理）'),
          }),
        ),
      )
      : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        createElement(UiInput, {  value: d.workspacePath, onChange: function (e) { actions.patchDraft({ workspacePath: e.target.value }) }, placeholder: dshT('工作区绝对路径（如 E:\\projects\\my-app）') }),
        createElement('div', { style: { display: 'flex', gap: '8px' } },
          createElement('select', { className: 'input', value: d.agentPreset, onChange: function (e) { actions.patchDraft({ agentPreset: e.target.value }) }, style: { width: 'auto' } },
            (view.presets.length > 0 ? view.presets : [{ id: 'cordis', name: 'cordis' }]).map(function (p) {
              return createElement('option', { key: p.id, value: p.id }, p.name || p.id)
            }),
          ),
          createElement('select', { className: 'input', value: d.permissionPreset, onChange: function (e) { actions.patchDraft({ permissionPreset: e.target.value }) }, style: { width: 'auto' } },
            (view.permissionPresetNames.length > 0 ? view.permissionPresetNames : ['workspace-write', 'danger-full-access']).map(function (n) {
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
        onChange: function (e) { actions.patchDraft({ promptTemplate: e.target.value }) },
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

function mergeObject(base, partial) {
  var next = {}
  for (var k in base) next[k] = base[k]
  for (var pk in partial) next[pk] = partial[pk]
  return next
}

// Every surface the main bundle mounts (plus the three the harnesses mount
// directly: SessionsSection / WorkspacesSection / WorkflowSection).
export {
  AutomationSection, ChCommandsSection, ChHooksSection, McpSection, PluginsSection,
  SessionsSection, SkillsSection, SubagentAdminSection, TodoAdminDock, UsageDashboardSection,
  WebSessionsSection, WorkflowSection, WorkspacesSection,
}
