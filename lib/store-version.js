/**
 * On-disk store versions (Phase F2).
 *
 * Every store this plugin owns already WRITES a `version` field. What they did
 * not do is READ it. Without that, a profile written by a newer plugin (a
 * field that changed meaning, a list that became an object) is happily read as
 * if it were the current shape — and the next save writes the misinterpreted
 * data back. That is silent data loss, the one failure mode a local admin tool
 * must not have.
 *
 * The contract here:
 *   - a missing version means version 1 (every file written before versioning);
 *   - an OLDER file runs the declared migration chain, in order;
 *   - a NEWER file is refused loudly (StoreVersionError) — never read-and-
 *     rewritten, never silently emptied;
 *   - an unparseable/foreign file reports `invalid` so the caller keeps its
 *     own best-effort policy (history is best-effort by design; rules are not).
 */

/** Raised when a store was written by a newer plugin than this one. */
export class StoreVersionError extends Error {
  /**
   * @param {string} label - human name of the store.
   * @param {number} found - the version on disk.
   * @param {number} supported - the version this build understands.
   */
  constructor(label, found, supported) {
    super(
      label + '：文件版本 ' + found + ' 高于本插件支持的 ' + supported +
      '（由更新版本的 dsh-plugin-admin 写入）。请升级插件，或把该文件移开后再试。',
    )
    this.name = 'StoreVersionError'
    this.code = 'STORE_VERSION_NEWER'
    this.found = found
    this.supported = supported
  }
}

/**
 * Classify and migrate one parsed store object.
 * @param {any} raw - the parsed JSON (may be junk: callers read hand-edited files).
 * @param {{ current?: number, migrations?: Array<{ from: number, to: number, migrate: (data: any) => any }>, label?: string }} [options]
 *   `current` is what this build writes; `migrations` are ordered steps.
 * @returns {{ status: 'ok'|'migrated'|'newer'|'unmigratable'|'invalid', version: number, supported: number, data?: any, applied: string[], reason?: string }}
 *   `status` is the only thing callers must branch on.
 */
export function readStore(raw, options = {}) {
  const current = typeof options.current === 'number' && options.current > 0 ? options.current : 1
  const migrations = Array.isArray(options.migrations) ? options.migrations : []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'invalid', version: 0, supported: current, applied: [], reason: 'not-an-object' }
  }
  const found = Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1
  if (found > current) return { status: 'newer', version: found, supported: current, applied: [] }
  if (found === current) return { status: 'ok', version: found, supported: current, data: raw, applied: [] }
  let data = raw
  let version = found
  const applied = []
  for (const step of migrations) {
    if (step.from !== version) continue
    const next = step.migrate(data)
    if (next !== undefined && next !== null) data = next
    applied.push(step.from + '→' + step.to)
    version = step.to
    if (version >= current) break
  }
  if (version < current) return { status: 'unmigratable', version, supported: current, data: raw, applied }
  return { status: 'migrated', version: current, supported: current, data: { ...data, version: current }, applied }
}

/**
 * Turn a classification into the loud failure the callers must not skip.
 * @param {{ status: string, version: number, supported: number }} result - from readStore.
 * @param {string} label - human name of the store (used in the message).
 * @returns {void}
 * @throws {StoreVersionError} when the file is newer, or older with no path forward.
 */
export function assertStoreReadable(result, label) {
  if (result.status === 'newer' || result.status === 'unmigratable') {
    throw new StoreVersionError(label, result.version, result.supported)
  }
}

/**
 * Whether a caught error IS that refusal. MUTATION paths must let it propagate
 * (it is what stops this build from overwriting a file it cannot read), but a
 * mount-time or watcher read must degrade instead of taking the whole plugin
 * down — and it branches on this rather than on `instanceof` alone, so a
 * duplicate module instance still classifies correctly.
 * @param {unknown} error - the caught error.
 * @returns {boolean}
 */
export function isStoreVersionRefusal(error) {
  if (error instanceof StoreVersionError) return true
  return error !== null && typeof error === 'object'
    && /** @type {Record<string, any>} */ (error).code === 'STORE_VERSION_NEWER'
}
