/** plugins — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiInput, UiPill, createElement, currentLanguage, dshT, formatDate, messageOf, sectionState, setAdminLang, showToast, useEffect, useRef } from './context.js'
import { formatTestTime, loadUpdateReminders, mergeUpdateReminders, saveUpdateReminders, updateCheckNote } from './mcp.js'

/**
 * Types for this panel's helpers. `call` stays a duck-typed RPC boundary by
 * design (the same seam skills.js / mcp.js / web-search.js declare): its result
 * envelope is per-method, so the resolved value type is `any` — a boundary,
 * not unmodelled data.
 * @typedef {{ call: (method: string, args: Record<string, any>) => Promise<any> }} PluginsSectionProps
 */

/**
 * One persisted "⬆ 有新版本" reminder, held per bundle name in
 * PluginUpdateMap (mirrored to localStorage by mcp.js's update-reminder
 * persistence). `latest`/`at` describe the newest registry version; a
 * per-plugin check failure rides along in `error` with `updateAvailable`
 * false (see mcp.js's mergeUpdateReminders).
 * @typedef {{ latest: string, updateAvailable?: boolean, error?: string, at?: number }} PluginUpdateReminder
 */

/**
 * name -> reminder entry; seeded from the persisted reminders on mount and
 * merged from each fresh check.
 * @typedef {Record<string, PluginUpdateReminder>} PluginUpdateMap
 */

/**
 * Batch-upgrade progress while 全部更新 walks the list serially: the done
 * count, the total, and the collected per-plugin failures.
 * @typedef {{ done: number, total: number, failed: Array<PluginFailureRow> }} PluginBulkProgress
 */

/**
 * One 全部更新 target: the bundle name and the exact latest version
 * checkUpdates discovered (pinned, not `@latest` — see upgradePlugin).
 * @typedef {{ name: string, latest: string }} PluginUpgradeTarget
 */

/**
 * One collected batch failure: the bundle and the host's reason (only its
 * first line reaches the batch summary).
 * @typedef {{ name: string, reason: string }} PluginFailureRow
 */

/**
 * One plugin layer row as projected by the host's `pluginAdmin/list`. Only
 * the fields this panel reads are typed; the host may attach more (the rest
 * of the object stays duck-typed).
 * @typedef {{ name: string, version?: string, removable?: boolean, localPath?: string, disabled?: boolean, disablable?: boolean }} PluginListEntry
 */

/**
 * One entry of the Phase F3 privileged-action audit trail (host-side a
 * bounded file read); fields beyond `at`/`ok` stay host-owned.
 * @typedef {{ at: number, ok?: boolean, action?: string, detail?: string, error?: string }} PluginAuditEntry
 */

/**
 * The change event this panel's own handlers read out of a text input /
 * select (mirrors mcp.js's McpInputEvent and shared.js's InputChangeEvent,
 * which are module-local there and therefore not importable).
 * @typedef {{ target: { value: string } }} PluginsInputEvent
 */

/**
 * The 扩展插件 section state bag. The audit fields (auditBusy / auditError /
 * auditEntries / auditPath) only exist after 操作审计 loaded them, so they
 * stay optional; everything else is seeded at mount.
 * @typedef {{
 * profileDir: string,
 * plugins: Array<PluginListEntry>,
 * busy: boolean,
 * error: string,
 * spec: string,
 * confirming: string | null,
 * note: string,
 * output: string,
 * filter: string,
 * needle: string,
 * checkingUpdates: boolean,
 * updateChecked: boolean,
 * updates: PluginUpdateMap,
 * bulkUpdate: PluginBulkProgress | null,
 * auditBusy?: boolean,
 * auditError?: string | null,
 * auditEntries?: Array<PluginAuditEntry>,
 * auditPath?: string,
 * }} PluginsSectionState
 */

/**
 * 扩展插件 tab contribution: plugin management rendered inside the shell-owned
 * 插件 settings section (after 插件配置 and 插件列表).
 * @param {PluginsSectionProps} props - the renderer-bound props; `call` arrives from the slot inject face.
 */
export function PluginsSection(props) {
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

  /**
   * Merge a partial state patch into the section state.
   * @param {Record<string, any>} partial - the keys to overwrite.
   */
  function patchPlugin(partial) {
    kit.patch(partial)
  }

  // Same gateway seam the other sections use; a local alias keeps the
  // call sites (and the render-helper parameter lists) untouched.
  var callRemote = props.call

  /**
   * Reload the plugin layer list from the host.
   * @param {boolean} [keepFeedback] - when true, refresh ONLY the rows: busy/error/note
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
        var next = /** @type {Record<string, any>} */ ({
          profileDir: (result.value && result.value.profileDir) || '',
          plugins: (result.value && result.value.plugins) || [],
        })
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

  /**
   * (Re)query the host for registry updates and merge the results into the
   * reminder map; the AUTO check on panel open is cache-friendly and a
   * manual check passes force=true (the full merge semantics are documented
   * in the section doc block above loadAudit).
   * @param {boolean} [force] - true to force the host to bypass its update cache.
   */
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
      setPView(function (/** @type {Record<string, any>} */ cur) {
        var next = /** @type {Record<string, any>} */ ({})
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
      // 批量更新完成后那次刷新若走失败分支，就地消费滞留的批量总结：留着
      // 不消费会让总结丢失，且下一次成功的检查更新会把它当自己的 note 盖
      // 出来（张冠李戴）。
      var pendingBulkNote = bulkNoteRef.current
      bulkNoteRef.current = ''
      /** @type {Record<string, any>} */
      var failurePatch = { checkingUpdates: false, error: dshT('检查更新调用失败：') + messageOf(failure) }
      if (pendingBulkNote !== '') failurePatch.note = pendingBulkNote
      patchPlugin(failurePatch)
    })
  }

  // Batch upgrade (VS Code extensions posture): serially install every
  // plugin whose reminder says an update exists. Failures are collected,
  // not fatal — one bad plugin must not block the rest.
  function upgradeAllPlugins() {
    if (busyRef.current || pView.bulkUpdate !== null) return
    var targets = /** @type {Array<PluginUpgradeTarget>} */ ([])
    for (var name in pView.updates) {
      var info = pView.updates[name]
      if (info && info.updateAvailable && info.latest) targets.push({ name: name, latest: info.latest })
    }
    if (targets.length === 0) return
    busyRef.current = true
    patchPlugin({ busy: true, error: '', confirming: null, note: '', bulkUpdate: { done: 0, total: targets.length, failed: [] } })
    var index = 0
    var failedTotal = 0
    var failures = /** @type {Array<PluginFailureRow>} */ ([])
    var compatTotal = 0
    var runNext = function () {
      if (!alive.current) return
      if (index >= targets.length) {
        busyRef.current = false
        setPView(function (/** @type {Record<string, any>} */ cur) {
          var next = /** @type {Record<string, any>} */ ({})
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
        setPView(function (/** @type {Record<string, any>} */ cur) {
          var next = /** @type {Record<string, any>} */ ({})
          for (var k in cur) next[k] = cur[k]
          var failed = cur.bulkUpdate !== null ? cur.bulkUpdate.failed : []
          next.bulkUpdate = { done: index, total: targets.length, failed: result.ok ? failed : failed.concat([{ name: target.name, reason: reason }]) }
          if (result.ok) {
            next.plugins = (result.value && result.value.plugins) || cur.plugins
            var remaining = /** @type {PluginUpdateMap} */ ({})
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
        setPView(function (/** @type {Record<string, any>} */ cur) {
          var next = /** @type {Record<string, any>} */ ({})
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

  /**
   * Upgrade one plugin to its latest version (registry install by name).
   * @param {string} name - the bundle name to upgrade.
   */
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
        setPView(function (/** @type {Record<string, any>} */ cur) {
          var next = /** @type {Record<string, any>} */ ({})
          for (var k in cur) next[k] = cur[k]
          next.busy = false
          next.note = dshT('已更新 ') + name + dshT('。更改在重启 dsh 后生效') + compatWarningText(result.value && result.value.compat)
          next.output = (result.value && result.value.output) || ''
          next.profileDir = (result.value && result.value.profileDir) || ''
          next.plugins = (result.value && result.value.plugins) || []
          var remaining = /** @type {PluginUpdateMap} */ ({})
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
   * @param {Record<string, any> | null} compat - the install result's verdict, or a falsy value when the host attached none.
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

  /**
   * Uninstall one bundle (host-side pnpm remove); the fresh layer list rides
   * back in the result.
   * @param {string} name - the bundle name to remove.
   */
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
   * @param {string} name - the bundle name to toggle.
   * @param {boolean} disabled - true to write the disable rows, false to remove them.
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

/* ========================================================================== */
/*                           Render Plugins View                              */
/* ========================================================================== */

/**
 * Render the 扩展插件 panel: toolbar (search / install / check-updates /
 * upgrade-all), filter pills, the update-check strip, the plugin cards,
 * and the 操作审计 footer. Pure — every mutation goes through a callback.
 * @param {PluginsSectionState} view - the section state bag.
 * @param {(partial: Record<string, any>) => void} patch - merge into the section state.
 * @param {() => void} install - install the spec currently in the input box.
 * @param {(name: string) => void} remove - uninstall one bundle.
 * @param {(force?: boolean) => void} checkUpdates - query the registry for newer versions; force bypasses the host cache.
 * @param {(name: string) => void} upgrade - upgrade one bundle to its latest version.
 * @param {() => void} upgradeAll - serially upgrade every bundle with a pending reminder.
 * @param {(name: string, disabled: boolean) => void} setEnabled - toggle one bundle's disable rows without uninstalling.
 * @param {() => void} loadAudit - load the privileged-action audit trail.
 */
export function renderPluginsView(view, patch, install, remove, checkUpdates, upgrade, upgradeAll, setEnabled, loadAudit) {
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
        onChange: function (/** @type {PluginsInputEvent} */ e) { patch({ needle: e.target.value }) },
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
      onChange: function (/** @type {PluginsInputEvent} */ e) { setAdminLang(e.target.value) },
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
        onChange: function (/** @type {PluginsInputEvent} */ e) { patch({ spec: e.target.value }) },
        onKeyDown: function (/** @type {{ key: string }} */ e) { if (e.key === 'Enter') install() },
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

/**
 * Render one plugin card: name, version/source/status tags, the remote
 * update badge, and the per-row action buttons (停用/启用, 更新, 卸载 —
 * the last replaced by the confirm bar while confirming).
 * @param {PluginListEntry} plugin - the layer row to render.
 * @param {PluginsSectionState} view - the section state bag (badges and button gating read it).
 * @param {(name: string) => void} remove - uninstall this bundle.
 * @param {(partial: Record<string, any>) => void} patch - merge into the section state (the confirm bar uses it).
 * @param {(name: string) => void} upgrade - upgrade this bundle to its latest version.
 * @param {(name: string, disabled: boolean) => void} setEnabled - toggle this bundle's disable rows.
 */
export function renderPluginCard(plugin, view, remove, patch, upgrade, setEnabled) {
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
        title: dshT('升级到 v') + updateInfo.latest + dshT('（') + 'npm install ' + plugin.name + '@' + updateInfo.latest + dshT('）'),
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

/**
 * Display rank for the plugin list: 内置 first, then 包安装 (registry
 * install), then 本地安装 (local path). Host order is kept within a rank.
 * @param {PluginListEntry} plugin - the layer row to rank.
 */
export function pluginSortRank(plugin) {
  if (!plugin.removable) return 0
  return plugin.localPath ? 2 : 1
}

/**
 * Filter plugin layers by the type pill and a fuzzy name/version/path query,
 * then sort 内置 → 包安装 → 本地安装 (stable: equal ranks keep host order).
 * The needle matches case-insensitively against the package name, the
 * installed version, and the local source path, so "tool" finds
 * dsh-custom-tool and "0.2" finds version rows.
 * @param {Array<PluginListEntry>} plugins - the live host layer list.
 * @param {string} filter - the active type pill ('all' / 'plugin' / 'builtin').
 * @param {string} needle - the lowercased search needle ('' matches everything).
 * @returns {Array<PluginListEntry>} the matching rows in display order.
 */
export function filterPlugins(plugins, filter, needle) {
  var result = /** @type {Array<PluginListEntry>} */ ([])
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
}
