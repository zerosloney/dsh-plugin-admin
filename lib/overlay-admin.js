/**
 * Runtime overlay admin — one-click enablement of the full-text session search
 * capability the shipped web composition mounts OFF by default: a pure
 * profile-patch composition with no dependency installs of its own.
 *
 * 全文会话检索 (searchEnable): the base bundle mounts
 *     `@deepseek-ai/dsh-session-query-sqlite` with `path: ':memory:'` and
 *     `openAt: never` — searchSessions fails with SESSION_QUERY_SEARCH_DISABLED
 *     and the official sidebar search matches titles/workspace names only.
 *     Enabling writes an id-targeted config override row into the profile
 *     cordis.patch.yml: a durable index path under $DSH_HOME and
 *     `openAt: first-search` (defers the node:sqlite import and index build to
 *     the first search, per the base row's own guidance). The session-query
 *     package is a base-layer row, so the override needs no install.
 *
 * The write rides the apply()'s shared serial queue (the same
 * cordis.patch.yml as pluginAdmin / mcpAdmin / subagentAdmin /
 * commandHookAdmin) and lands as an atomic temp+rename write. Row edits
 * preserve sibling entries and unknown config keys — only the documented
 * keys (path/openAt) are touched.
 *
 * @module dsh-plugin-admin/overlay-admin
 */

import { join } from 'node:path'
import { PROFILE_PATCH_FILENAME, appendTopLevelBlocks, dshHome, entryEndAt, makeSerialQueue, matchRowIdLine, profileDirOf, readPatchLines, topLevelBlocks, writePatch, yamlScalar } from './patch-utils.js'

// Re-exported for `verify-overlays.mjs`, which drives the row-grammar helpers
// through this module (the overlay editor is their only production consumer
// left now that the schedule-overlay writer is gone).
export { entryDisabled, matchRowIdLine } from './patch-utils.js'

export const OVERLAY_NAMESPACE = 'overlayAdmin'
export const SEARCH_ROW_ID = 'session-query-sqlite'
export const SEARCH_INDEX_FILENAME = 'sessions-search-index.sqlite'
/** openAt values that mean "search enabled" when found in an override row. */
export const SEARCH_OPEN_AT_ENABLED = ['first-search', 'startup']

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
 * Rebuild one search-row entry in place, preserving its shape (bare or
 * nested) and every unknown config key, while normalizing `path` and
 * `openAt` to the canonical enabled values. Only flat `path:`/`openAt:` lines
 * at the entry's own key indent are rewritten; nested structures under other
 * keys are copied verbatim.
 *
 * A flow-style one-line `config: {...}` is refused with a clear error instead
 * of being silently mangled into invalid YAML — hand-normalize the row first.
 *
 * The config block is delimited by INDENT: it ends at the first following line
 * at or below the entry's own key indent (a sibling key such as `disabled:`).
 * The canonical keys are therefore spliced into the block rather than appended
 * to the entry — appending after such a sibling key emits a YAML document the
 * Loader cannot parse, and a boot-critical patch that fails to parse stops dsh
 * from starting.
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
  // The block runs to the first non-blank line indented at or below `config:`.
  let blockEnd = entryLines.length
  for (let i = configLineIndex + 1; i < entryLines.length; i++) {
    const line = entryLines[i]
    if (line.trim() === '') continue
    const indent = line.slice(0, line.length - line.trimStart().length)
    if (indent.length <= configIndent.length) {
      blockEnd = i
      break
    }
  }
  const removeKeyLine = (key) => (line) => !new RegExp(`^${keyIndent}(?:(['"])?${key}\\1):`).test(line)
  const kept = entryLines
    .slice(configLineIndex + 1, blockEnd)
    .filter(removeKeyLine('path'))
    .filter(removeKeyLine('openAt'))
  // Blank separators that sat at the end of the block belong after the new keys.
  let trailingBlanks = 0
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
    kept.pop()
    trailingBlanks++
  }
  return [
    ...entryLines.slice(0, configLineIndex + 1),
    ...kept,
    `${keyIndent}path: ${JSON.stringify(indexPath.split('\\').join('/'))}`,
    `${keyIndent}openAt: first-search`,
    ...Array.from({ length: trailingBlanks }, () => ''),
    ...entryLines.slice(blockEnd),
  ]
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

  const overlayService = {
    /**
     * Read-only diagnostic: what the profile patch currently says about the
     * search overlay (NOT the mounted ground truth — a --patch overlay or the
     * base bundle may differ; the client detects the capability live via the
     * typed error).
     * @returns diagnostic shape for tests and future UI.
     */
    async status() {
    const { lines } = readPatchLines(profileDir)
    const search = findRowEntry(lines, SEARCH_ROW_ID)
      return {
        profilePatchPath: join(profileDir, PROFILE_PATCH_FILENAME),
        indexPath: join(dshHome(), SEARCH_INDEX_FILENAME),
        search: {
          rowPresent: search !== null,
          openAt: search !== null ? entryOpenAt(lines.slice(search.entryStart, search.entryEnd)) ?? null : null,
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
  ]
}
