/**
 * Append-only audit trail for privileged admin actions (Phase F3).
 *
 * Everything this plugin can do through the browser is local-machine
 * administration: install and remove npm packages, rewrite hooks.json (which
 * the host executes), delete session logs, change webhook rules. Panels make
 * those gestures one click; nothing recorded who made them. This module writes
 * one JSON line per privileged RPC so the trail survives the panel.
 *
 * Design choices worth keeping:
 *   - JSONL append, never rewrite (a crash loses at most the line in flight);
 *   - sensitive argument values are redacted by KEY NAME before they are
 *     written, so a webhook secret or an API key never reaches the file;
 *   - the file compacts to half its cap when it grows past it, under the same
 *     serial queue the other stores use;
 *   - auditService() wraps only the mutating methods listed in
 *     AUDITED_METHODS: read paths stay unlogged, so the trail is signal.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicRename, dshHome, makeSerialQueue, messageOf, tempPathFor } from './patch-utils.js'

/** File name under $DSH_HOME. */
export const AUDIT_FILENAME = 'admin-audit.jsonl'
/** Entries kept before the log compacts to half. */
export const AUDIT_CAP = 2000
/** Longest detail string written per entry. */
const DETAIL_MAX = 400
/** Argument keys whose values never reach the file. */
const SENSITIVE_KEY = /secret|token|apikey|api_key|password|credential|authorization/i
/** What a redacted value turns into (visible on purpose: absence is data too). */
export const REDACTED = '[redacted]'

/**
 * Summarize one argument list for the trail: sensitive values are replaced by
 * REDACTED, the whole thing is capped and it never throws.
 * @param {unknown[]} args - the RPC arguments.
 * @returns {string} a one-line summary.
 */
export function summarizeArgs(args) {
  try {
    var seen = new WeakSet()
    var redact = function (value, key) {
      if (typeof key === 'string' && SENSITIVE_KEY.test(key)) return REDACTED
      if (value === null || typeof value !== 'object') return value
      if (seen.has(value)) return '[circular]'
      seen.add(value)
      if (Array.isArray(value)) return value.map(function (item) { return redact(item, undefined) })
      var out = {}
      var keys = Object.keys(value)
      for (var i = 0; i < keys.length; i += 1) out[keys[i]] = redact(value[keys[i]], keys[i])
      return out
    }
    var summary = JSON.stringify(redact(args, undefined))
    if (typeof summary !== 'string') return ''
    return summary.length > DETAIL_MAX ? summary.slice(0, DETAIL_MAX) + '…' : summary
  } catch (error) {
    return '[unserializable]'
  }
}

/**
 * Mutating methods per namespace. Read paths are deliberately absent: a trail
 * that logs every list() is noise nobody reads.
 *
 * Every namespace that hands a recorder to auditService MUST have a row here —
 * a missing row used to make the wrapper a silent no-op, which is how
 * `webSearchAdmin` (pnpm add/remove + API-key writes) shipped unaudited while
 * the changelog claimed otherwise. `auditService` now throws instead, and
 * verify-audit-log scans the call sites in both directions.
 */
export const AUDITED_METHODS = Object.freeze({
  pluginAdmin: Object.freeze(['install', 'remove', 'setEnabled']),
  mcpAdmin: Object.freeze(['upsert', 'remove']),
  commandHookAdmin: Object.freeze([
    'saveCommand', 'deleteCommand', 'saveHook', 'deleteHook', 'setHookEnabled',
    'bridgeInstall', 'bridgeRemove', 'codexBridgeInstall', 'codexBridgeRemove',
  ]),
  webhookAdmin: Object.freeze(['saveRule', 'deleteRule', 'testRule', 'runtimeInstall']),
  cronAdmin: Object.freeze(['upsert', 'remove', 'toggle', 'runNow']),
  sessionAdmin: Object.freeze(['deleteSession', 'closeSession', 'archive', 'unarchive']),
  workspaceAdmin: Object.freeze(['create', 'rename', 'delete', 'insertBefore', 'attachSession', 'detachSession', 'insertSessionBefore', 'archiveSession', 'unarchiveSession']),
  subagentAdmin: Object.freeze(['upsert', 'remove', 'cliUpsert', 'cliRemove', 'cliInstall', 'runtimeInterrupt', 'runtimePrompt']),
  webSearchAdmin: Object.freeze(['install', 'uninstall', 'setActive', 'saveConfig']),
  overlayAdmin: Object.freeze(['searchEnable']),
  // The workflow engine's EXECUTION verbs (the panel's start/amend/resume/
  // runSaved launch agent scripts, and the workflow facade exposes a `shell`
  // step) plus the saved-library writes. The engine's own journal records the
  // steps; the trail records who started it and from where.
  // `listRuns` / `getRun` / `listSaved` / `getSaved` are reads and stay out.
  workflowAdmin: Object.freeze(['startRun', 'stopRun', 'amendRun', 'resumeRun', 'answerRun', 'saveSaved', 'deleteSaved', 'runSaved']),
})

/**
 * The generic success reading: anything that is not an explicit `ok: false`
 * counts as done. Namespaces whose verbs signal failure with other fields pass
 * their own `okOf` to {@link auditService} (workflowAdmin does).
 * @param {any} result - the wrapped method's return value.
 * @returns {boolean}
 */
function defaultOkOf(result) {
  return result === undefined || result === null || result.ok !== false
}

/**
 * Wrap one namespace service so its mutating methods land in the trail.
 * Wraps IN PLACE and is a no-op without a recorder, so a module mounted
 * directly by a test keeps its plain behaviour.
 * @param {Record<string, any>} service - the service about to be provided.
 * @param {string} namespace - its typert namespace (the trail's action prefix).
 * @param {{ record?: (entry: Record<string, any>) => void }|null|undefined} audit - the recorder.
 * @param {{ okOf?: (result: any) => boolean }} [options] - `okOf` overrides how a
 *   result is read as success/failure for this namespace.
 * @returns {Record<string, any>} the same service.
 */
export function auditService(service, namespace, audit, options = {}) {
  if (audit === null || audit === undefined || typeof audit.record !== 'function') return service
  var okOf = typeof options.okOf === 'function' ? options.okOf : defaultOkOf
  var methods = AUDITED_METHODS[namespace]
  if (methods === undefined) {
    // Reaching here WITH a recorder means this namespace is privileged but the
    // table forgot it: the old `return service` wrapped nothing at all, so the
    // action ran unlogged and nothing ever complained. Fail loud instead.
    throw new Error('audit-log: namespace "' + String(namespace) +
      '" has no AUDITED_METHODS row — add one (or stop passing the recorder) so a privileged surface cannot ship unaudited')
  }
  for (var i = 0; i < methods.length; i += 1) {
    var method = methods[i]
    var original = service[method]
    // A row naming a method the service does not have would silently audit
    // nothing: verify-audit-log pins the table against the mounted services.
    if (typeof original !== 'function') continue
    service[method] = (function (name, fn) {
      return function () {
        var args = Array.prototype.slice.call(arguments)
        var started = Date.now()
        var detail = summarizeArgs(args)
        return Promise.resolve()
          .then(function () { return fn.apply(service, args) })
          // AWAITED on purpose: the action is not finished until the trail has
          // it, so a caller that reads the log right after an action (the panel,
          // host-check) never races the write. Fire-and-forget here was a bug:
          // the RPC resolved while record() still sat in the queue.
          //
          // But a FAILED trail write must not change the action's outcome. The
          // mutation already landed by the time we get here: rejecting would
          // report e.g. cronAdmin/runNow as failed although the task fired (the
          // user then clicks again and it runs twice), and the catch below would
          // replace the real error with the audit error. The recorder is
          // best-effort by contract; its own direct callers still see rejections.
          .then(async function (result) {
            try {
              await audit.record({
                action: namespace + '/' + name,
                ok: okOf(result),
                target: summarizeArgs(args.slice(0, 1)),
                detail: detail,
                ms: Date.now() - started,
              })
            } catch {
              /* the privileged action's result is what the caller asked for */
            }
            return result
          })
          .catch(async function (error) {
            try {
              await audit.record({
                action: namespace + '/' + name,
                ok: false,
                target: summarizeArgs(args.slice(0, 1)),
                detail: detail,
                error: messageOf(error),
                ms: Date.now() - started,
              })
            } catch {
              /* never mask the action's own error with a trail failure */
            }
            throw error
          })
      }
    })(method, original)
  }
  return service
}

/**
 * One audit log over one file. Writes append and serialize through the caller's
 * queue; reads return newest first.
 * @param {{ path?: string, cap?: number, enqueue?: (op: () => Promise<any>) => Promise<any>, now?: () => number }} [options]
 * @returns {{ record: (entry: Record<string, any>) => Promise<void>, read: (limit?: number) => Array<Record<string, any>>, path: string, size: () => number }}
 */
export function createAuditLog(options = {}) {
  var file = typeof options.path === 'string' && options.path !== '' ? options.path : join(dshHome(), AUDIT_FILENAME)
  var cap = typeof options.cap === 'number' && options.cap > 0 ? options.cap : AUDIT_CAP
  var enqueue = typeof options.enqueue === 'function' ? options.enqueue : makeSerialQueue()
  var now = typeof options.now === 'function' ? options.now : Date.now
  var count = null

  function readEntries() {
    if (!existsSync(file)) return []
    var entries = []
    var lines = readFileSync(file, 'utf8').split('\n')
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim()
      if (line === '') continue
      try { entries.push(JSON.parse(line)) } catch (error) { /* a torn line is skipped, not fatal */ }
    }
    return entries
  }

  function append(entry) {
    if (count === null) count = readEntries().length
    // A configured auditLogPath may name a directory that does not exist yet
    // (the config row validates only "non-empty string"): create it here rather
    // than failing every privileged action on ENOENT.
    mkdirSync(dirname(file), { recursive: true })
    if (count >= cap) {
      var kept = readEntries().slice(-Math.floor(cap / 2))
      var temp = tempPathFor(file)
      writeFileSync(temp, kept.map(function (item) { return JSON.stringify(item) }).join('\n') + '\n')
      atomicRename(temp, file)
      count = kept.length
    }
    appendFileSync(file, JSON.stringify(entry) + '\n')
    count += 1
  }

  return {
    /**
     * Append one entry (the recorder handed to auditService).
     * @param {Record<string, any>} entry - the action summary.
     * @returns {Promise<void>}
     */
    async record(entry) {
      var record = { at: now(), pid: process.pid }
      var keys = Object.keys(entry)
      for (var i = 0; i < keys.length; i += 1) if (entry[keys[i]] !== undefined) record[keys[i]] = entry[keys[i]]
      await enqueue(async function () { append(record) })
    },
    /**
     * Newest-first slice of the trail.
     * @param {number} [limit] - how many entries (default 50).
     * @returns {Array<Record<string, any>>} the entries.
     */
    read(limit) {
      var size = typeof limit === 'number' && limit > 0 ? limit : 50
      return readEntries().slice(-size).reverse()
    },
    /** The log file this instance writes. */
    path: file,
    /** Current entry count (recounts on the first call). */
    size() { if (count === null) count = readEntries().length; return count },
  }
}
