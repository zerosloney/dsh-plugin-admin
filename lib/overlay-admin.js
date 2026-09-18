/**
 * Runtime overlay admin — one-click enablement of two dsh capabilities the
 * shipped web composition mounts OFF by default. Both are pure profile-patch
 * compositions: no dependency installs, no host services of their own.
 *
 * 1. 全文会话检索 (searchEnable): the base bundle mounts
 *    `@deepseek-ai/dsh-session-query-sqlite` with `path: ':memory:'` and
 *    `openAt: never` — searchSessions fails with SESSION_QUERY_SEARCH_DISABLED
 *    and the official sidebar search matches titles/workspace names only.
 *    Enabling writes an id-targeted config override row into the profile
 *    cordis.patch.yml: a durable index path under $DSH_HOME and
 *    `openAt: first-search` (defers the node:sqlite import and index build to
 *    the first search, per the base row's own guidance). The session-query
 *    package is a base-layer row, so the override needs no install.
 *
 * 2. 日程提醒 (scheduleEnable): the web-app roster mounts ui-schedule with
 *    `disabled: true` and the host schedule services exist only in the
 *    opt-in official overlay (apps/cli/config/examples/schedule/cordis.yml:
 *    `time-context` + `schedule` rows plus the ui-schedule re-enable). This
 *    writes exactly that composition into the profile patch, so the plugin's
 *    schedule dock/bell and the official read-only catalog stay aligned with
 *    the documented opt-in semantics.
 *
 * Resolution guard: the dsh launcher mounts its full built-in package tree at
 * `<home>/profiles/node_modules`, which every profile's module resolution
 * chain reaches, so both schedule packages normally resolve without any
 * profile install. scheduleEnable probes resolution BEFORE writing and fails
 * loud with an actionable message rather than authoring rows that would break
 * the profile's next boot.
 *
 * Both writes ride the apply()'s shared serial queue (the same
 * cordis.patch.yml as pluginAdmin / mcpAdmin / subagentAdmin /
 * commandHookAdmin) and land as atomic temp+rename writes. Row edits preserve
 * sibling entries and unknown config keys — only the documented keys
 * (path/openAt, disabled) are touched.
 *
 * @module dsh-plugin-admin/overlay-admin
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { PROFILE_PATCH_FILENAME, appendTopLevelBlocks, dshHome, entryDisabled, entryEndAt, makeSerialQueue, matchRowIdLine, profileDirOf, readPatchLines, topLevelBlocks, writePatch, yamlScalar } from './patch-utils.js'

export { entryDisabled, matchRowIdLine } from './patch-utils.js'

export const OVERLAY_NAMESPACE = 'overlayAdmin'
export const SEARCH_ROW_ID = 'session-query-sqlite'
export const SEARCH_INDEX_FILENAME = 'sessions-search-index.sqlite'
/** openAt values that mean "search enabled" when found in an override row. */
export const SEARCH_OPEN_AT_ENABLED = ['first-search', 'startup']
export const SCHEDULE_ROW_IDS = ['time-context', 'schedule']
/** The npm packages the schedule rows import (resolution-probed before writes). */
export const SCHEDULE_PACKAGES = ['@deepseek-ai/dsh-time-context', '@deepseek-ai/dsh-schedule']
export const UI_SCHEDULE_ROW_ID = 'ui-schedule'

/* ========================================================================== */
/*                       Row line grammar (pure helpers)                      */
/* ========================================================================== */

/**
 * Locate the LAST top-level block carrying a row with the exact id (later
 * layers win per the loader's patch semantics). The entry span runs from its
 * `- id:` line to the next sibling list item at the same indent, or the block
 * end — whichever comes first.
 * @param {string[]} lines - patch file lines.
 * @param {string} rowId - exact row id to find.
 * @returns {{ blockIndex: number, blockEndIndex: number, entryStart: number, entryEnd: number, indent: string } | null}
 */
export function findRowEntry(lines, rowId) {
  const blocks = topLevelBlocks(lines)
  for (let b = blocks.length - 1; b >= 0; b--) {
    const block = blocks[b]
    for (let i = block.index; i < block.endIndex; i++) {
      const match = matchRowIdLine(lines[i])
      if (match === null || match.id !== rowId) continue
      const end = entryEndAt(lines, i, block.endIndex, match.indent)
      return { blockIndex: block.index, blockEndIndex: block.endIndex, entryStart: i, entryEnd: end, indent: match.indent }
    }
  }
  return null
}

/** The key indent for one entry: id indent + 4 (`- id:` → `    key:`). */
function keyIndentOf(entryLines) {
  const indentMatch = /^(\s*)- id:/.exec(entryLines[0] ?? '')
  return (indentMatch !== null ? indentMatch[1] : '') + '    '
}

/**
 * The first `openAt:` scalar at the entry's own key indent, parsed with the
 * shared scalar rules (JSON first, then quote stripping).
 * @param {string[]} entryLines - the entry's own lines (first is the `- id:` line).
 * @returns {string | undefined}
 */
export function entryOpenAt(entryLines) {
  const keyIndent = keyIndentOf(entryLines)
  for (const line of entryLines.slice(1)) {
    if (!line.startsWith(keyIndent)) continue
    const match = /^\s*openAt:\s*(.+?)\s*(?:#.*)?$/.exec(line)
    if (match !== null) {
      const value = yamlScalar(match[1])
      return typeof value === 'string' ? value : String(value)
    }
  }
  return undefined
}

/**
 * Canonical bare id-override block for the search row: a durable index path
 * plus `openAt: first-search`. Forward slashes keep the YAML clean on Windows
 * and are accepted by node:sqlite on every platform.
 * @param {string} indexPath - absolute durable index file path.
 * @returns {string[]}
 */
export function buildSearchOverrideBlockLines(indexPath) {
  return [
    `- id: ${SEARCH_ROW_ID}`,
    '  config:',
    `    path: ${JSON.stringify(indexPath.split('\\').join('/'))}`,
    '    openAt: first-search',
  ]
}

/**
 * The official Schedule overlay's insert block, filtered to the rows still
 * missing from the patch. Row order mirrors the official example
 * (time-context first, schedule second).
 * @param {string[]} missingIds - subset of SCHEDULE_ROW_IDS to author.
 * @returns {string[]}
 */
export function buildScheduleInsertBlockLines(missingIds) {
  const names = { 'time-context': '@deepseek-ai/dsh-time-context', schedule: '@deepseek-ai/dsh-schedule' }
  const lines = ['- insert:']
  for (const id of missingIds) lines.push(`    - id: ${id}`, `      name: '${names[id]}'`)
  return lines
}

/**
 * The ui-schedule re-enable block (same shape the official overlay writes).
 * @returns {string[]}
 */
export function buildUiScheduleEnableBlockLines() {
  return [`- id: ${UI_SCHEDULE_ROW_ID}`, '  disabled: false']
}

/**
 * Rebuild one search-row entry in place, preserving its shape (bare or
 * nested) and every unknown config key, while normalizing `path` and
 * `openAt` to the canonical enabled values. Only flat `path:`/`openAt:` lines
 * at the entry's own key indent are rewritten; nested structures under other
 * keys are copied verbatim.
 *
 * A flow-style one-line `config: {...}` is refused with a clear error instead
 * of being silently mangled into invalid YAML — hand-normalize the row first.
 * @param {string[]} entryLines - the entry's own lines (first is the `- id:` line).
 * @param {string} indexPath - absolute durable index file path.
 * @returns {string[]} the rebuilt entry lines.
 */
export function rebuildSearchEntry(entryLines, indexPath) {
  const indentMatch = /^(\s*)- id:/.exec(entryLines[0] ?? '')
  const idIndent = indentMatch !== null ? indentMatch[1] : ''
  const configIndent = idIndent + '  '
  const keyIndent = idIndent + '    '
  const configLineIndex = entryLines.findIndex((line, index) => index > 0 && line.startsWith(configIndent + 'config:'))
  if (configLineIndex === -1) {
    // A row without a config block: author one from scratch, keeping the shape.
    return [
      ...entryLines,
      configIndent + 'config:',
      `${keyIndent}path: ${JSON.stringify(indexPath.split('\\').join('/'))}`,
      `${keyIndent}openAt: first-search`,
    ]
  }
  const configInline = entryLines[configLineIndex].slice((configIndent + 'config:').length).trim()
  if (configInline !== '') {
    throw new Error(`overlay-admin: ${SEARCH_ROW_ID} 行的 config 是流式单行写法，无法安全就地改写 — 请先把 ${PROFILE_PATCH_FILENAME} 中该行整理为块状 config 后重试`)
  }
  const removeKeyLine = (key) => (line) => !new RegExp(`^${keyIndent}(?:(['"])?${key}\\1):`).test(line)
  const kept = entryLines
    .slice(configLineIndex + 1)
    .filter(removeKeyLine('path'))
    .filter(removeKeyLine('openAt'))
  return [
    ...entryLines.slice(0, configLineIndex + 1),
    ...kept,
    `${keyIndent}path: ${JSON.stringify(indexPath.split('\\').join('/'))}`,
    `${keyIndent}openAt: first-search`,
  ]
}

/**
 * Flip an entry's `disabled:` scalar to `false`, preserving every other line
 * verbatim. When the entry carries no disabled line the input returns as-is.
 * @param {string[]} entryLines - the entry's own lines.
 * @returns {string[]}
 */
export function flipDisabledToFalse(entryLines) {
  return entryLines.map((line) => {
    const match = /^(\s*disabled:\s*)(.+?)\s*$/.exec(line)
    if (match === null) return line
    const value = yamlScalar(match[2])
    return typeof value === 'boolean' ? `${match[1]}false` : line
  })
}

/* ========================================================================== */
/*                          Apply (service + RPC)                             */
/* ========================================================================== */

/**
 * Mount the overlayAdmin remote on the host context.
 * @param ctx - host context (only ctx.baseUrl / ctx.provide / ctx.effect used).
 * @param {object} [options] - `{ enqueue }`; absent enqueue falls back to a
 *   local serial queue (tests).
 * @returns {Array} the overlayAdmin invocation descriptors for the unified
 *   typert registration.
 */
export function applyOverlayAdmin(ctx, options = {}) {
  const profileDir = profileDirOf(ctx.baseUrl)
  const enqueue = typeof options.enqueue === 'function' ? options.enqueue : makeSerialQueue()

  /**
   * Probe whether the schedule packages resolve from the profile root (the
   * launcher's shared profiles/node_modules tree normally provides them).
   * @returns {string[]} the package names that failed to resolve.
   */
  function unresolvableSchedulePackages() {
    const failed = []
    const requireFromProfile = createRequire(join(profileDir, PROFILE_PATCH_FILENAME))
    for (const pkg of SCHEDULE_PACKAGES) {
      try {
        requireFromProfile.resolve(pkg)
      } catch {
        failed.push(pkg)
      }
    }
    return failed
  }

  const overlayService = {
    /**
     * Read-only diagnostic: what the profile patch currently says about both
     * overlays (NOT the mounted ground truth — a --patch overlay or the base
     * bundle may differ; the client detects the schedule capability live via
     * the projection and search via the typed error).
     * @returns diagnostic shape for tests and future UI.
     */
    async status() {
    const { lines } = readPatchLines(profileDir)
    const search = findRowEntry(lines, SEARCH_ROW_ID)
      const ui = findRowEntry(lines, UI_SCHEDULE_ROW_ID)
      return {
        profilePatchPath: join(profileDir, PROFILE_PATCH_FILENAME),
        indexPath: join(dshHome(), SEARCH_INDEX_FILENAME),
        search: {
          rowPresent: search !== null,
          openAt: search !== null ? entryOpenAt(lines.slice(search.entryStart, search.entryEnd)) ?? null : null,
        },
        schedule: {
          timeContextRowPresent: findRowEntry(lines, 'time-context') !== null,
          scheduleRowPresent: findRowEntry(lines, 'schedule') !== null,
          uiScheduleRowPresent: ui !== null,
          uiScheduleDisabled: ui !== null ? entryDisabled(lines.slice(ui.entryStart, ui.entryEnd)) ?? false : null,
        },
      }
    },

    /**
     * Enable full-text session search by authoring (or normalizing) the
     * id-targeted override row for the session-query-sqlite base row.
     * Idempotent: a row already enabling search (openAt first-search/startup)
     * is left untouched — the user's custom index path or journalMode
     * survives.
     * @returns { state: 'present' | 'enabled', path?, openAt?, restartRequired? }
     */
    async searchEnable() {
      return enqueue(async () => {
        const indexPath = join(dshHome(), SEARCH_INDEX_FILENAME)
      const { lines, patchPath } = readPatchLines(profileDir)
      const entry = findRowEntry(lines, SEARCH_ROW_ID)
        if (entry !== null) {
          const entryLines = lines.slice(entry.entryStart, entry.entryEnd)
          const openAt = entryOpenAt(entryLines)
          if (SEARCH_OPEN_AT_ENABLED.includes(openAt)) {
            return { state: 'present', openAt: openAt ?? null }
          }
          const rebuilt = rebuildSearchEntry(entryLines, indexPath)
          const next = [...lines.slice(0, entry.entryStart), ...rebuilt, ...lines.slice(entry.entryEnd)]
          writePatch(patchPath, next)
          return { state: 'enabled', path: indexPath, openAt: 'first-search', restartRequired: true }
        }
        const next = appendTopLevelBlocks(lines, [buildSearchOverrideBlockLines(indexPath)])
        writePatch(patchPath, next)
        return { state: 'enabled', path: indexPath, openAt: 'first-search', restartRequired: true }
      })
    },

    /**
     * Enable the schedule runtime with the official overlay's exact
     * composition: missing host rows go into one insert block, and a
     * `disabled: true` ui-schedule row flips to false. Fails loud when the
     * schedule packages are not resolvable from the profile — authoring the
     * rows anyway would break the profile's next boot.
     * @returns { state: 'present' | 'enabled', rows?, restartRequired? }
     */
    async scheduleEnable() {
      return enqueue(async () => {
        const unresolved = unresolvableSchedulePackages()
        if (unresolved.length > 0) {
          throw new Error(`overlay-admin: 日程包不可解析（${unresolved.join(', ')}）— 当前 dsh 安装未携带 schedule 运行时（需 dsh ≥ 0.1.5-rc.2 官方发行版），未写入任何配置`)
        }
      const { lines, patchPath } = readPatchLines(profileDir)
      const missing = []
        if (findRowEntry(lines, 'time-context') === null) missing.push('time-context')
        if (findRowEntry(lines, 'schedule') === null) missing.push('schedule')

        let next = lines
        const rows = []
        if (missing.length > 0) {
          next = appendTopLevelBlocks(next, [buildScheduleInsertBlockLines(missing)])
          rows.push(...missing)
        }
        const ui = findRowEntry(next, UI_SCHEDULE_ROW_ID)
        if (ui === null) {
          next = appendTopLevelBlocks(next, [buildUiScheduleEnableBlockLines()])
          rows.push(UI_SCHEDULE_ROW_ID)
        } else if (entryDisabled(next.slice(ui.entryStart, ui.entryEnd)) === true) {
          const flipped = flipDisabledToFalse(next.slice(ui.entryStart, ui.entryEnd))
          next = [...next.slice(0, ui.entryStart), ...flipped, ...next.slice(ui.entryEnd)]
          rows.push(UI_SCHEDULE_ROW_ID)
        }
        if (rows.length === 0) return { state: 'present' }
        writePatch(patchPath, next)
        return { state: 'enabled', rows, restartRequired: true }
      })
    },
  }

  const binding = Object.freeze({ service: overlayService, serviceKey: OVERLAY_NAMESPACE, namespace: OVERLAY_NAMESPACE })
  Object.defineProperty(overlayService, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(OVERLAY_NAMESPACE, overlayService) }, 'plugin-admin/overlayAdmin: provide')

  return overlayInvocations()
}

/**
 * The overlayAdmin invocation descriptors for the unified typert descriptor
 * (the registry allows ONE registration per package name).
 * @returns {Array}
 */
export function overlayInvocations() {
  return [
    {
      id: 'dsh-plugin-admin/overlay/status',
      service: OVERLAY_NAMESPACE,
      namespace: OVERLAY_NAMESPACE,
      method: 'status',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    },
    {
      id: 'dsh-plugin-admin/overlay/searchEnable',
      service: OVERLAY_NAMESPACE,
      namespace: OVERLAY_NAMESPACE,
      method: 'searchEnable',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    },
    {
      id: 'dsh-plugin-admin/overlay/scheduleEnable',
      service: OVERLAY_NAMESPACE,
      namespace: OVERLAY_NAMESPACE,
      method: 'scheduleEnable',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    },
  ]
}
