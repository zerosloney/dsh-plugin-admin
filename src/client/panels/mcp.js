/** mcp — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiCheckbox, UiInput, createElement, dshT, messageOf, sectionState, useRef } from './context.js'
import { safeLocalStorage } from './shared.js'

/**
 * Types for this panel's helpers. `call` stays a duck-typed RPC boundary by
 * design (the same seam skills.js / web-search.js declare): its result
 * envelope is per-method, so the resolved value type is `any` — a boundary,
 * not unmodelled data.
 * @typedef {{ call: (method: string, args: Record<string, any>) => Promise<any> }} PanelSectionProps
 */

/**
 * One MCP entry row as projected by the host's `mcpAdmin/list`. `config` is
 * the parsed cordis.patch.yml block and is null / undefined when the row
 * could not be parsed safely (such rows are read-only in this panel); the
 * rest of the object is host-owned, so it stays `any`.
 * @typedef {{ id: string, serverName?: string, config?: any }} McpListEntry
 */

/**
 * One connectivity-probe record, held per entry id in `mcpTestState` and
 * mirrored to localStorage (where only durable `ok` results are persisted).
 * `result` is the host's `mcpAdmin/test` payload — duck-typed by design.
 * @typedef {{ busy?: boolean, result?: any, error?: string | null, at?: number }} McpTestEntry
 */

/**
 * The per-entry test-status map, keyed by MCP entry id.
 * @typedef {Record<string, McpTestEntry>} McpTestState
 */

/**
 * The one open tool-invocation bench: the picked tool, the raw JSON
 * arguments box, the in-flight flag, and the normalized host result.
 * @typedef {{ entryId: string, serverName: string, tools: Array<string>, toolRequired: Record<string, Array<string>>, tool: string, argsText: string, busy: boolean, result: any, error: string | null }} McpPlayground
 */

/**
 * The change event this panel's own handlers read out of a text input /
 * select / textarea (mirrors shared.js's InputChangeEvent, which is
 * module-local there and therefore not importable).
 * @typedef {{ target: { value: string } }} McpInputEvent
 */

/**
 * The section state `renderMcpSection` reads. `mcpDraft` is the locally
 * staged editor bag (host config values merged with the panel's own field
 * strings), so it stays `any`; everything else is this panel's own shape.
 * @typedef {{
 * mcpEntries: Array<McpListEntry>,
 * mcpBusy: boolean,
 * mcpError: string,
 * mcpNote: string,
 * mcpEditorOpen: boolean,
 * mcpDraft: any,
 * mcpTestState: McpTestState,
 * mcpPlayground: McpPlayground | null,
 * mcpConfirmRemove: string | null,
 * }} McpSectionState
 */

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

export var MCP_TEST_CACHE_KEY = 'dsh-plugin-admin/mcp-test-results'

export function mcpTestStorage() {
  return safeLocalStorage()
}

/**
 * Read the persisted MCP test-result cache. A missing, unparseable, or
 * storage-unavailable backend yields an empty map.
 * @returns {McpTestState} entryId -> cached probe record.
 */
export function loadMcpTestCache() {
  var store = mcpTestStorage()
  if (store === null) return {}
  try {
    var raw = store.getItem(MCP_TEST_CACHE_KEY)
    if (raw === null) return {}
    var parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return {}
    // Purge failure records persisted by older builds: only a durable OK is
    // worth restoring on mount; a stale ❌ from a past outage must not
    // outlive the session it happened in.
    var out = /** @type {McpTestState} */ ({})
    for (var id in parsed) {
      var entry = parsed[id]
      if (entry && entry.result && entry.result.ok === true) out[id] = entry
    }
    return out
  } catch (e) {
    return {}
  }
}

/** Mirror settled, successful probes into localStorage (best-effort).
 * @param {McpTestState} state - entryId -> the current probe record. */
export function saveMcpTestCache(state) {
  var store = mcpTestStorage()
  if (store === null) return
  try {
    var out = /** @type {McpTestState} */ ({})
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

/** Drop one entry's cached probe (config saved or entry removed).
 * @param {string} id - the entry whose cached probe is dropped. */
export function clearMcpTestCacheEntry(id) {
  var store = mcpTestStorage()
  if (store === null) return
  try {
    var state = loadMcpTestCache()
    if (state[id] === undefined) return
    delete state[id]
    store.setItem(MCP_TEST_CACHE_KEY, JSON.stringify(state))
  } catch (e) { /* ignore */ }
}

/** Drop test states whose entry no longer exists in the host list.
 * @param {McpTestState} map - the current test-state map.
 * @param {Array<McpListEntry>} entries - the live host entry list.
 * @returns {McpTestState} the pruned map. */
export function pruneMcpTestState(map, entries) {
  var valid = /** @type {Record<string, boolean>} */ ({})
  for (var i = 0; i < entries.length; i++) valid[entries[i].id] = true
  var next = /** @type {McpTestState} */ ({})
  var changed = false
  for (var id in map) {
    if (valid[id]) next[id] = map[id]
    else changed = true
  }
  if (changed) saveMcpTestCache(next)
  return next
}

/** Compact timestamp for a cached probe ("14:32" today, "6-1 14:32" older).
 * @param {number} ms - epoch milliseconds. */
export function formatTestTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  var d = new Date(ms)
  var pad = function (/** @type {number} */ n) { return (n < 10 ? '0' : '') + String(n) }
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

export var UPDATE_REMINDER_KEY = 'dsh-plugin-admin/update-reminders'

/** Shape-merge a reminder entry (keeps the original truthy fields).
 * @param {Record<string, any>} entry - the current reminder fields.
 * @param {Record<string, any>} partial - the fields to overwrite.
 * @returns {Record<string, any>} the merged copy. */
export function mergeReminder(entry, partial) {
  var next = /** @type {Record<string, any>} */ ({})
  for (var k in entry) next[k] = entry[k]
  for (var pk in partial) next[pk] = partial[pk]
  return next
}

/**
 * Load persisted update reminders as state entries:
 * { name: { latest, at, updateAvailable, error } }. Storage-unavailable
 * environments (opaque-origin jsdom, privacy modes) just get an empty map.
 */
export function loadUpdateReminders() {
  var store = safeLocalStorage()
  if (store === null) return {}
  try {
    var raw = store.getItem(UPDATE_REMINDER_KEY)
    if (raw === null) return {}
    var parsed = JSON.parse(raw)
    var out = /** @type {Record<string, any>} */ ({})
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

/** Mirror the current reminder set into localStorage (best-effort).
 * @param {Record<string, any>} map - name -> reminder entry. */
export function saveUpdateReminders(map) {
  var store = safeLocalStorage()
  if (store === null) return
  try {
    var out = /** @type {Record<string, any>} */ ({})
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
 * @param {Record<string, any>} curMap - the CURRENT updates state ({ name -> entry }).
 * @param {Array<Record<string, any>>} list - per-plugin check results.
 * @returns the complete next map.
 */
export function mergeUpdateReminders(curMap, list) {
  var liveNames = /** @type {Record<string, boolean>} */ ({})
  for (var a = 0; a < list.length; a++) liveNames[list[a].name] = true
  var map = /** @type {Record<string, any>} */ ({})
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

/** Aggregate summary line for a finished check (pure).
 * @param {Record<string, any>} map - name -> reminder entry.
 * @param {number} checkedCount - how many plugins were checked. */
export function updateCheckNote(map, checkedCount) {
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
 * @param {McpPlayground} pg - the open bench: { entryId, serverName, tools, toolRequired, tool, argsText, busy, result, error }.
 * @param {(partial: Record<string, any>) => void} patch - merge into the bench.
 * @param {(method: string, args: Record<string, any>) => Promise<any>} callRemote - the RPC seam.
 */
export function renderMcpPlayground(pg, patch, callRemote) {
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
            onChange: function (/** @type {McpInputEvent} */ e) { patch({ tool: e.target.value }) },
          }, pg.tools.map(function (t) {
            return createElement('option', { key: t, value: t }, t)
          }))
        : createElement('div', { className: 'mcp-test-warn' }, dshT('先对该服务器跑一次「🔌 测试」以获取工具列表。')),
      createElement('textarea', {
        className: 'input',
        rows: 5,
        placeholder: dshT('工具参数（JSON 对象，键名以该工具的 inputSchema 为准）'),
        value: pg.argsText,
        onChange: function (/** @type {McpInputEvent} */ e) { patch({ argsText: e.target.value }) },
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

/**
 * MCP servers settings section: list / add / edit / remove the
 * cordis.patch.yml MCP rows, run host connectivity probes (cached in
 * localStorage so a restored status is never mistaken for a fresh one),
 * and open one tool-invocation playground bench per panel.
 * @param {PanelSectionProps} props - the renderer-bound props; `call` arrives from the slot inject face.
 */
export function McpSection(props) {
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
  // newer one's result when both are in flight. Keyed PER ENTRY — a single
  // counter let "probe A, then probe B" drop A's (perfectly current) response
  // and leave its row stuck on 「检测中…」 forever.
  var testSeq = useRef({})

  /**
   * Merge a partial state patch into the section state.
   * @param {Record<string, any>} partial - the keys to overwrite.
   */
  function patchMcp(partial) {
    kit.patch(partial)
  }

  // Merge a partial into the CURRENT mcpDraft via a functional update, so
  // rapid successive field edits (React batching) never lose earlier input.
  /**
   * Merge a partial into the CURRENT mcpDraft via a functional update, so
   * rapid successive field edits (React batching) never lose earlier input.
   * @param {Record<string, any>} partial - the draft keys to overwrite.
   */
  function patchDraft(partial) {
    setMView(function (/** @type {Record<string, any>} */ cur) {
      var next = /** @type {Record<string, any>} */ ({})
      for (var k in cur) next[k] = cur[k]
      next.mcpDraft = mergeDraft(cur.mcpDraft, partial)
      return next
    })
  }

  // Nested patch for the playground bench — patchMcp is a TOP-LEVEL merge and
  // would clobber the whole bench object with flat fields.
  /**
   * Nested patch for the playground bench — patchMcp is a TOP-LEVEL merge and
   * would clobber the whole bench object with flat fields.
   * @param {Record<string, any>} partial - the bench keys to overwrite.
   */
  function patchPlayground(partial) {
    setMView(function (/** @type {Record<string, any>} */ cur) {
      var next = /** @type {Record<string, any>} */ ({})
      for (var k in cur) next[k] = cur[k]
      if (cur.mcpPlayground !== null) {
        var pg = /** @type {Record<string, any>} */ ({})
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
  /**
   * Open the tool-invocation bench for one entry, seeded with the tool list
   * (and per-tool required params) of that entry's last successful probe.
   * @param {McpListEntry} entry - the row whose tools are called.
   */
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

  /**
   * One list load: replaces the entry roster and prunes cached probes whose
   * entry no longer exists on the host.
   */
  function reloadMcp() {
    patchMcp({ mcpBusy: true, mcpError: '' })
    callRemote('mcpAdmin/list', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var entries = (result.value && result.value.entries) || []
        setMView(function (/** @type {Record<string, any>} */ cur) {
          var next = /** @type {Record<string, any>} */ ({})
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

  /**
   * Open the editor for one entry, or the add form when `entry` is null.
   * @param {McpListEntry | null} entry - the row to edit, or null to add a server.
   */
  function openMcpEditor(entry) {
    if (entry !== null && entry !== undefined && (entry.config === null || entry.config === undefined)) {
      patchMcp({ mcpError: dshT('该 MCP 配置无法安全解析，已禁止在此覆盖；请在 cordis.patch.yml 中手动编辑。') })
      return
    }
    var source = entry !== null && entry !== undefined ? entry.config : null
    var draft = source ? {
      id: /** @type {McpListEntry} */ (entry).id,
      isNew: false,
      serverName: source.serverName || /** @type {McpListEntry} */ (entry).id,
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
    /** @type {Record<string, any>} */
    var config
    if (draft.transport === 'streamable-http') {
      config = { transport: 'streamable-http', serverName: draft.serverName, url: draft.url }
      var headersStr = Object.keys(draft.headersOriginal || {}).map(function (k) { return k + '=' + draft.headersOriginal[k] }).join('\n')
      var headers = (draft.headersChanged && draft.headers !== headersStr) ? {} : draft.headersOriginal
      if (draft.headersChanged && draft.headers !== headersStr && draft.headers !== '') {
        // Newline-only split: header values legitimately contain ';'/','
        // (Cookie, Accept), which must never become pair separators.
        var pairs = draft.headers.split('\n').map(function (/** @type {string} */ s) { return s.trim() }).filter(Boolean)
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
        var pairs = draft.env.split('\n').map(function (/** @type {string} */ s) { return s.trim() }).filter(Boolean)
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

  /**
   * Remove one entry from cordis.patch.yml and drop its cached probe.
   * @param {string} id - the entry id to remove.
   */
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
   * @param {string} id - the entry whose status is set.
   * @param {Record<string, any>} partial - the test-state keys to overwrite.
   */
  function patchMcpTest(id, partial) {
    setMView(function (/** @type {Record<string, any>} */ cur) {
      var nextTestState = mergeTestState(cur.mcpTestState, id, partial)
      saveMcpTestCache(nextTestState)
      var next = /** @type {Record<string, any>} */ ({})
      for (var k in cur) next[k] = cur[k]
      next.mcpTestState = nextTestState
      return next
    })
  }

  /** Run a host-side connectivity probe for one entry and stash the result.
   * @param {string} id - the entry to probe. */
  function testMcpEntry(id) {
    var seq = testSeq.current[id] = (testSeq.current[id] || 0) + 1
    patchMcpTest(id, { busy: true, result: null, error: null })
    callRemote('mcpAdmin/test', { id: id }).then(function (result) {
      if (!alive.current || seq !== testSeq.current[id]) return
      if (result.ok && result.value !== null && typeof result.value === 'object') {
        // `at` timestamps the probe; it is what the cached label renders.
        patchMcpTest(id, { busy: false, result: result.value, at: Date.now() })
      } else {
        patchMcpTest(id, { busy: false, result: null, error: messageOf(result.error) })
      }
    }, function (failure) {
      if (!alive.current || seq !== testSeq.current[id]) return
      patchMcpTest(id, { busy: false, result: null, error: messageOf(failure) })
    })
  }

  kit.mount(reloadMcp)

  return createElement('div', { 'data-dsh-admin-section': '', className: mView.mcpEditorOpen ? 'mcp-editor-open' : '' },
    renderMcpSection(mView, patchMcp, patchDraft, patchPlayground, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry, openMcpPlayground, callRemote))
}

/**
 * The whole MCP settings surface: the header actions, one card per entry
 * with its connectivity status and 测试 / 试调用 / 编辑 / 移除 buttons (移除
 * takes a second click in a confirm bar), the add / editor form, and the
 * tool-invocation playground when one is open.
 * @param {McpSectionState} view - the section state bag.
 * @param {(partial: Record<string, any>) => void} patchMcp - merge into the section state.
 * @param {(partial: Record<string, any>) => void} patchDraft - merge into the current draft.
 * @param {(partial: Record<string, any>) => void} patchPlayground - merge into the open playground.
 * @param {() => void} reloadMcp - re-read the entry list from the host.
 * @param {(entry: McpListEntry | null) => void} openMcpEditor - open the editor for a row, or the add form for null.
 * @param {() => void} closeMcpEditor - close the editor.
 * @param {() => void} saveMcpDraft - persist the current draft.
 * @param {(id: string) => void} removeMcpEntry - delete one entry.
 * @param {(id: string) => void} testMcpEntry - run one connectivity probe.
 * @param {(entry: McpListEntry) => void} openMcpPlayground - open the invocation bench for a row.
 * @param {(method: string, args: Record<string, any>) => Promise<any>} callRemote - the RPC seam.
 */
export function renderMcpSection(view, patchMcp, patchDraft, patchPlayground, reloadMcp, openMcpEditor, closeMcpEditor, saveMcpDraft, removeMcpEntry, testMcpEntry, openMcpPlayground, callRemote) {
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
            onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ id: e.target.value }) },
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
          onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ serverName: e.target.value }) },
        }),
      ),
      createElement('div', { style: fieldStyle, key: 'f-transport' },
        createElement('label', { style: labelStyle }, dshT('传输方式')),
        createElement('select', {
          className: 'input',
          value: d.transport,
          onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ transport: e.target.value }) },
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
          onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ command: e.target.value }) },
        }),
      ) : createElement('div', { style: fieldStyle, key: 'f-url' },
        createElement('label', { style: labelStyle }, dshT('url（MCP 端点）')),
        createElement(UiInput, {
          value: d.url,
          placeholder: 'http://localhost:3000/mcp',
          onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ url: e.target.value }) },
        }),
      ),
      d.transport === 'streamable-http' ? createElement('div', { style: fieldStyle, key: 'f-headers' },
        createElement('label', { style: labelStyle }, dshT('headers（每行 KEY=VALUE，可选）')),
        createElement('textarea', {
          className: 'input',
          style: { minHeight: '48px' },
          value: d.headers,
          onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ headers: e.target.value, headersChanged: true }) },
        }),
        createElement('div', { style: secretHintStyle }, dshT('已存的 header 只回键名（值不回传浏览器）：留空即沿用已存的值，删掉整行才会移除该键。')),
      ) : null,
      d.transport === 'stdio' ? createElement('div', { style: fieldStyle, key: 'f-args' },
        createElement('label', { style: labelStyle }, dshT('args（空格分隔，可选）')),
        createElement(UiInput, {
          value: d.args,
          onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ args: e.target.value, argsChanged: true }) },
        }),
      ) : null,
      d.transport === 'stdio' ? createElement('div', { style: fieldStyle, key: 'f-env' },
        createElement('label', { style: labelStyle }, dshT('env（每行 KEY=VALUE，可选）')),
        createElement('textarea', {
          className: 'input',
          style: { minHeight: '48px' },
          value: d.env,
          onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ env: e.target.value, envChanged: true }) },
        }),
        createElement('div', { style: secretHintStyle }, dshT('已存的环境变量只回键名（值不回传浏览器）：留空即沿用已存的值，删掉整行才会移除该变量。')),
      ) : null,
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', marginBottom: '4px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(200,200,210,0.3))', paddingTop: '8px' }, key: 'f-reconnect-header' },
        createElement(UiCheckbox, {
          checked: d.reconnectEnabled,
          onChange: function (/** @type {boolean} */ next) { patchDraft({ reconnectEnabled: next }) },
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
            onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ reconnectInitialDelayMs: Number(e.target.value) }) },
          }),
        ),
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 120px' }, key: 'f-reconnect-md' },
          createElement('label', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #666)' } }, 'maxDelayMs'),
          createElement(UiInput, {
            type: 'number',
            min: 0,
            value: d.reconnectMaxDelayMs,
            onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ reconnectMaxDelayMs: Number(e.target.value) }) },
          }),
        ),
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 120px' }, key: 'f-reconnect-ma' },
          createElement('label', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #666)' } }, 'maxAttempts'),
          createElement(UiInput, {
            type: 'number',
            min: 0,
            value: d.reconnectMaxAttempts,
            onChange: function (/** @type {McpInputEvent} */ e) { patchDraft({ reconnectMaxAttempts: Number(e.target.value) }) },
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
export var MCP_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/**
 * Generate a fresh MCP entry id that is not already used by any listed entry
 * (an id collision would silently overwrite the existing entry on upsert).
 * @param {Array<McpListEntry>} entries - the currently listed entries.
 */
export function generateMcpId(entries) {
  var taken = /** @type {Record<string, boolean>} */ ({})
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

/**
 * Shallow-merge a partial draft onto a copy of the current draft (partial
 * wins); never mutates its arguments.
 * @param {Record<string, any>} draft - the current draft values.
 * @param {Record<string, any>} partial - the keys to overwrite.
 * @returns {Record<string, any>} the merged copy.
 */
export function mergeDraft(draft, partial) {
  var next = /** @type {Record<string, any>} */ ({})
  for (var k in draft) next[k] = draft[k]
  for (var pk in partial) next[pk] = partial[pk]
  return next
}

/** Set one entry's test status inside the shared mcpTestState map.
 * @param {Record<string, any>} map - the current test-state map.
 * @param {string} id - the entry id to patch.
 * @param {Record<string, any>} partial - the test-state keys to overwrite.
 * @returns {Record<string, any>} the next map. */
export function mergeTestState(map, id, partial) {
  var next = /** @type {Record<string, any>} */ ({})
  for (var k in map) next[k] = map[k]
  next[id] = {}
  var cur = map[id] || {}
  for (var ck in cur) next[id][ck] = cur[ck]
  for (var pk in partial) next[id][pk] = partial[pk]
  return next
}
