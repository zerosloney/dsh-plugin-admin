/**
 * Subagent administration host half, merged from the former standalone
 * dsh-plugin-subagents plugin. Zero dsh imports on purpose: everything rides
 * the live Cordis Context (services by key) and plain-data typert
 * registration, the same pattern the rest of dsh-plugin-admin uses.
 *
 * The module manages ONE artifact: the profile `cordis.patch.yml` rows whose
 * `name` is `@deepseek-ai/dsh-tool-subagent`. Each row is one named subagent —
 * a delegation tool instance with its own toolName (子智能体名称), persona (提示词),
 * toolFilter (工具约束) and agentOptions (模型指定). Writing the file is the
 * whole persistence story: the profile patch layer is hot-reloaded by the
 * launcher's watch-only Cordis HMR on every long-lived surface, so saved rows
 * mount/dispose live AND survive restarts, because boot composes the same file.
 *
 * Remote surface served by the /api RPC gateway — namespace `subagentAdmin`:
 *
 * 1. list() → managed entries with live mount status, plus the picker meta
 *    (registered providers with capabilities, candidate tool names).
 * 2. upsert(entry) → validate, then replace the entry's block by id or append
 *    a new one; atomic write; journal append.
 * 3. remove(id) → validate existence, delete the block; atomic write; journal.
 * 4. history(limit) → the change journal (配置台账), newest first.
 * 5. cliList/cliUpsert/cliRemove/cliInstall → external CLI backend management
 *    (harness provider packages via patch rows, generic commands via a
 *    plugin-owned JSON config + live-registered command providers).
 *
 * The managed-block marker comments are a byte-stable deployment contract:
 * profiles managed by the former standalone plugin keep working unchanged.
 */

import { exec, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_SEED, RESERVED_TOOL_NAMES } from './tool-seed.js'

const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'
const SERVICE_KEY = 'subagentAdmin'
const NAMESPACE = 'subagentAdmin'
const PLUGIN_NAME = '@deepseek-ai/dsh-tool-subagent'
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'
const HISTORY_FILENAME = 'subagent-admin.history.jsonl'
const BACKUP_SUFFIX = '.bak-subagent-admin'
const TMP_SUFFIX = '.tmp-subagent-admin'

/** Marker comment above the managed `- insert:` block this plugin owns. */
export const MANAGED_BLOCK_MARKER = '# >>> dsh-plugin-subagents managed rows (auto-managed, do not edit by hand) <<<'

/** Marker comment above the managed `- insert:` block holding CLI backend rows. */
export const CLI_BLOCK_MARKER = '# >>> dsh-plugin-subagents cli backends (auto-managed, do not edit by hand) <<<'

/**
 * External CLI subagent providers shipped by the harness that this panel can
 * mount and configure. `runnerPackage` + `cliCommand` power availability
 * detection; `permissionModes` mirrors each provider package's Config schema.
 */
export const CLI_BACKENDS = [
  {
    id: 'subagent-codex',
    label: 'Codex',
    packageName: '@deepseek-ai/dsh-subagent-codex',
    runnerPackage: '@openai/codex',
    cliCommand: 'codex',
    permissionModes: ['never', 'approve-for-me', 'dangerously-bypass-approvals-and-sandbox'],
    defaultConfig: { providerName: 'codex', permissionMode: 'never', disposeGraceMs: 3000, env: {} },
  },
  {
    id: 'subagent-claude-code',
    label: 'Claude',
    packageName: '@deepseek-ai/dsh-subagent-claude-code',
    runnerPackage: '@anthropic-ai/claude-agent-sdk',
    cliPackage: '@anthropic-ai/claude-code',
    cliCommand: 'claude',
    permissionModes: ['dontAsk', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'],
    defaultConfig: { providerName: 'claude-code', permissionMode: 'dontAsk', disposeGraceMs: 3000, env: {} },
  },
]

/** Well-known agent CLIs scanned for display only — the harness has no provider for them. */
export const CLI_SCAN_ONLY = ['gemini', 'qwen', 'opencode']

const CLI_CONFIG_KEYS = ['providerName', 'permissionMode', 'disposeGraceMs', 'env']
const CLI_PROVIDER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/
const CLI_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Generic external-CLI backends persist to this plugin-owned file (NOT the patch: those rows would be instantiated as bundles). */
const CLI_GENERIC_CONFIG_FILENAME = 'subagent-admin.cli.json'
const CLI_GENERIC_ID_PREFIX = 'cli-'
/** Non-interactive invocation presets for well-known agent CLIs; unknown commands default to a bare {prompt}. */
const CLI_GENERIC_PRESET_ARGS = {
  codex: ['exec', '{prompt}'],
  claude: ['-p', '{prompt}'],
  gemini: ['-p', '{prompt}'],
  qwen: ['-p', '{prompt}'],
  opencode: ['run', '{prompt}'],
}
const CLI_GENERIC_RESERVED_PROVIDER_NAMES = new Set(['spawn', 'fork', 'subagent', 'subagent_fork', 'run_code', 'codex', 'claude-code'])
const CLI_GENERIC_MAX_ARGS = 20
const CLI_ARG_MAX_CHARS = 256
const CLI_DIAGNOSTIC_MAX_CHARS = 2000

/** Rewrite the journal once it grows past this many bytes (keep the tail). */
const JOURNAL_ROTATE_BYTES = 512 * 1024
/** Journal lines kept after a rotation. */
const JOURNAL_KEEP_LINES = 400

const PERSONA_MAX_CHARS = 32768
const MODEL_MAX_CHARS = 200
const MAX_TOKENS_MAX = 2_000_000
const TOOLNAME_PATTERN = /^[a-z][a-z0-9_]{1,47}$/
const TOOL_REF_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const CONFIG_KEYS = ['provider', 'toolName', 'enableRunInBackground', 'backgroundMode', 'agentOptions', 'persona', 'toolFilter', 'maxDepth']

/* ========================================================================== */
/*                        Patch-file line-block editor                        */
/* ========================================================================== */

/**
 * Read the profile patch file and locate the top-level entry blocks. A block
 * starts at a line matching /^- / and runs to the next top-level item or EOF.
 * @param profileDir - the profile directory holding cordis.patch.yml.
 * @returns { patchPath, text, lines, blocks } where blocks are { index, endIndex } spans.
 */
function readPatch(profileDir) {
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
  const text = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const lines = text.split(/\r?\n/)
  const blocks = []
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^- /.test(lines[i])) {
      if (start !== -1) blocks.push({ index: start, endIndex: i })
      start = i
    }
  }
  if (start !== -1) blocks.push({ index: start, endIndex: lines.length })
  return { patchPath, text, lines, blocks }
}

/** Whether a block is a managed tool-subagent entry (its `name:` row matches). */
function isSubagentBlock(lines, block) {
  for (let i = block.index; i < block.endIndex; i++) {
    if (/^\s*name:\s*['"]?@deepseek-ai\/dsh-tool-subagent['"]?\s*$/.test(lines[i])) return true
  }
  return false
}

/** The block's top-level `- id:` value, or null. */
function blockId(lines, block) {
  for (let i = block.index; i < block.endIndex; i++) {
    const match = /^-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(lines[i])
    if (match) return match[1]
  }
  return null
}

/** Unquote one YAML scalar the way the plugin (and the admin plugin) writes them. */
function yamlScalar(value) {
  const text = value.trim()
  try {
    return JSON.parse(text)
  } catch {
    const quoted = /^['"](.*)['"]$/.exec(text)
    return quoted ? quoted[1] : text
  }
}

/**
 * Parse one nested mapping block (the `config:` body) with indent-aware
 * recursion. Handles exactly the shapes this plugin serializes: scalars,
 * string lists (`- item`), and one nested mapping level.
 * @param lines - patch file lines.
 * @param startIndex - first line index INSIDE the mapping (after `config:`).
 * @param endIndex - exclusive end of the enclosing entry block.
 * @param indent - the mapping's own indent (spaces).
 * @returns the parsed plain object.
 */
function parseMapping(lines, startIndex, endIndex, indent) {
  const out = {}
  const fieldAt = new RegExp(`^ {${indent}}([A-Za-z][A-Za-z0-9_]*):\\s?(.*)$`)
  let i = startIndex
  while (i < endIndex) {
    const line = lines[i]
    if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue }
    const currentIndent = line.length - line.trimStart().length
    if (currentIndent < indent) break
    const field = fieldAt.exec(line)
    if (!field) { i++; continue }
    const key = field[1]
    const value = field[2]
    if (value !== '') {
      out[key] = yamlScalar(value)
      i++
      continue
    }
    // Empty value: a nested mapping or a list follows at a deeper indent.
    let j = i + 1
    while (j < endIndex && (lines[j].trim() === '' || lines[j].trim().startsWith('#'))) j++
    if (j >= endIndex) { out[key] = undefined; i++; continue }
    const nextIndent = lines[j].length - lines[j].trimStart().length
    if (nextIndent <= indent) { out[key] = undefined; i++; continue }
    if (/^\s*-\s/.test(lines[j])) {
      out[key] = parseList(lines, j, endIndex, nextIndent)
      i = j + listLength(lines, j, endIndex)
      continue
    }
    out[key] = parseMapping(lines, j, endIndex, nextIndent)
    i = advancePastMapping(lines, j, endIndex, nextIndent)
  }
  return out
}

/** Parse an indented `- item` string list. */
function parseList(lines, startIndex, endIndex, indent) {
  const out = []
  let i = startIndex
  while (i < endIndex) {
    const line = lines[i]
    const currentIndent = line.length - line.trimStart().length
    if (line.trim() === '' ) { i++; continue }
    if (currentIndent < indent || !/^\s*-\s/.test(line)) break
    const item = /^-\s+(.*)$/.exec(line.slice(indent))
    if (item) out.push(yamlScalar(item[1]))
    i++
  }
  return out
}

/** Count consecutive list item lines (plus blanks) from a list start. */
function listLength(lines, startIndex, endIndex) {
  let count = 0
  let i = startIndex
  while (i < endIndex) {
    const line = lines[i]
    if (line.trim() === '') { count++; i++; continue }
    if (!/^\s*-\s/.test(line)) break
    count++
    i++
  }
  return count
}

/** Advance past a nested mapping: return the first line index at or above `indent`. */
function advancePastMapping(lines, startIndex, endIndex, indent) {
  let i = startIndex
  while (i < endIndex) {
    const line = lines[i]
    if (line.trim() === '') { i++; continue }
    const currentIndent = line.length - line.trimStart().length
    if (currentIndent < indent) break
    i++
  }
  return i
}

/**
 * Parse the entry config from a block: the `config:` body of a managed row.
 * @returns the parsed config object (possibly partial), or null when the block has no config body.
 */
function configFromBlock(lines, block) {
  for (let i = block.index; i < block.endIndex; i++) {
    if (/^\s{2}config:\s*$/.test(lines[i])) {
      let bodyStart = i + 1
      while (bodyStart < block.endIndex && lines[bodyStart].trim() === '') bodyStart++
      if (bodyStart >= block.endIndex) return {}
      const bodyIndent = lines[bodyStart].length - lines[bodyStart].trimStart().length
      return parseMapping(lines, bodyStart, block.endIndex, bodyIndent)
    }
  }
  return null
}

/**
 * Serialize one managed entry into canonical YAML lines. The entry rides a
 * `- insert:` list as a top-level row, indented 4 spaces under the insert key.
 * Multi-line persona text rides a double-quoted YAML scalar with \n escapes,
 * which round-trips through the loader's YAML parser.
 * @param entry - { id, config } with the validated config shape.
 * @param indent - leading spaces before the entry's own `- ` (default 4: inside `- insert:`).
 * @returns YAML lines (no trailing newline).
 */
export function serializeEntryLines(entry, indent = 4) {
  const pad = ' '.repeat(indent)
  const config = entry.config
  const out = []
  out.push(`${pad}- id: ${JSON.stringify(entry.id)}`)
  out.push(`${pad}  name: '${PLUGIN_NAME}'`)
  out.push(`${pad}  config:`)
  out.push(`${pad}    provider: ${JSON.stringify(config.provider)}`)
  out.push(`${pad}    toolName: ${JSON.stringify(config.toolName)}`)
  if (config.persona !== undefined) {
    out.push(`${pad}    persona: ${JSON.stringify(config.persona)}`)
  }
  if (config.toolFilter !== undefined) {
    out.push(`${pad}    toolFilter:`)
    const allow = config.toolFilter.allow ?? []
    const deny = config.toolFilter.deny ?? []
    if (allow.length > 0) {
      out.push(`${pad}      allow:`)
      for (const name of allow) out.push(`${pad}        - ${JSON.stringify(name)}`)
    }
    if (deny.length > 0) {
      out.push(`${pad}      deny:`)
      for (const name of deny) out.push(`${pad}        - ${JSON.stringify(name)}`)
    }
  }
  if (config.agentOptions !== undefined) {
    out.push(`${pad}    agentOptions:`)
    if (config.agentOptions.provider !== undefined) out.push(`${pad}      provider: ${JSON.stringify(config.agentOptions.provider)}`)
    if (config.agentOptions.model !== undefined) out.push(`${pad}      model: ${JSON.stringify(config.agentOptions.model)}`)
    if (config.agentOptions.maxTokens !== undefined) out.push(`${pad}      maxTokens: ${Number(config.agentOptions.maxTokens)}`)
  }
  if (config.maxDepth !== undefined) {
    out.push(`${pad}    maxDepth: ${config.maxDepth === 'provider-managed' ? "'provider-managed'" : Number(config.maxDepth)}`)
  }
  if (config.backgroundMode !== undefined) {
    out.push(`${pad}    backgroundMode: ${config.backgroundMode}`)
  }
  if (config.enableRunInBackground !== undefined) {
    out.push(`${pad}    enableRunInBackground: ${config.enableRunInBackground === true}`)
  }
  return out
}

/**
 * Insert or replace one managed entry inside this plugin's `- insert:` block
 * (creating block + marker at EOF when absent). A legacy top-level row with
 * the same id is removed (migrated into the managed block). Non-managed rows
 * keep their lines byte-for-byte.
 * @param lines - patch file lines.
 * @param entry - { id, config } validated entry.
 * @returns new lines array.
 */
export function upsertIntoLines(lines, entry) {
  let next = removeLegacyRow(lines, entry.id)
  const managed = locateManagedBlock(next)
  const fresh = serializeEntryLines(entry)

  if (managed === null) {
    const block = [MANAGED_BLOCK_MARKER, '- insert:', ...fresh]
    const trimmed = [...next]
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop()
    return [...trimmed, '', ...block]
  }

  if (managed.blockIndex === -1) {
    // Marker survived without its insert block: rebuild the block after it.
    return [...next.slice(0, managed.markerIndex + 1), '- insert:', ...fresh, ...next.slice(managed.markerIndex + 1)]
  }

  // Find the inner sub-entry carrying the same id and replace it in place.
  const inner = next.slice(managed.blockIndex + 1, managed.blockEndIndex)
  for (let i = 0; i < inner.length; i++) {
    if (!/^ {4}- /.test(inner[i])) continue
    if (/^ {4}-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(inner[i])?.[1] === entry.id) {
      const innerEnd = (() => {
        for (let j = i + 1; j < inner.length; j++) if (/^ {4}- /.test(inner[j])) return j
        return inner.length
      })()
      return [
        ...next.slice(0, managed.blockIndex + 1),
        ...inner.slice(0, i),
        ...fresh,
        ...inner.slice(innerEnd),
        ...next.slice(managed.blockEndIndex),
      ]
    }
  }
  return [...next.slice(0, managed.blockEndIndex), ...fresh, ...next.slice(managed.blockEndIndex)]
}

/** Remove one legacy top-level tool-subagent row by id. @returns new lines. */
function removeLegacyRow(lines, id) {
  for (const block of topLevelBlocks(lines)) {
    if (!isSubagentBlock(lines, block)) continue
    if (blockId(lines, block) === id) {
      return [...lines.slice(0, block.index), ...lines.slice(block.endIndex)]
    }
  }
  return lines
}

/**
 * Remove one managed entry by id: from the managed insert block (and any
 * legacy top-level row with the same id). An emptied managed block is removed
 * together with its marker.
 * @param lines - patch file lines.
 * @param id - managed entry id.
 * @returns { lines, removed } where removed reports whether any row was deleted.
 */
export function removeFromLines(lines, id) {
  let removed = false
  let next = lines
  const legacy = removeLegacyRow(next, id)
  if (legacy !== next) { removed = true; next = legacy }

  const managed = locateManagedBlock(next)
  if (managed && managed.blockIndex !== -1) {
    const inner = next.slice(managed.blockIndex + 1, managed.blockEndIndex)
    let kept = []
    let current = null
    const flush = () => {
      if (current === null) return
      const idMatch = /^ {4}-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(current[0])
      if (idMatch && idMatch[1] === id) { removed = true } else { kept = [...kept, ...current] }
      current = null
    }
    for (const line of inner) {
      if (/^ {4}- /.test(line)) { flush(); current = [line] }
      else if (current !== null) current = [...current, line]
    }
    flush()
    if (removed) {
      if (kept.length === 0) {
        next = [...next.slice(0, managed.markerIndex), ...next.slice(managed.blockEndIndex)]
        if (next[managed.markerIndex] !== undefined && next[managed.markerIndex].trim() === ''
          && managed.markerIndex > 0 && next[managed.markerIndex - 1].trim() === '') {
          next = [...next.slice(0, managed.markerIndex), ...next.slice(managed.markerIndex + 1)]
        }
      } else {
        next = [...next.slice(0, managed.blockIndex + 1), ...kept, ...next.slice(managed.blockEndIndex)]
      }
    }
  }
  return { lines: next, removed }
}

/** Every top-level patch block as { index, endIndex } spans. */
function topLevelBlocks(lines) {
  const blocks = []
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^- /.test(lines[i])) {
      if (start !== -1) blocks.push({ index: start, endIndex: i })
      start = i
    }
  }
  if (start !== -1) blocks.push({ index: start, endIndex: lines.length })
  return blocks
}

/**
 * Locate this plugin's managed `- insert:` block (identified by the marker
 * comment line immediately above it).
 * @returns { markerIndex, blockIndex, blockEndIndex } or null when absent.
 */
function locateManagedBlock(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== MANAGED_BLOCK_MARKER) continue
    let j = i + 1
    while (j < lines.length && (lines[j].trim() === '' || lines[j].startsWith('#'))) j++
    if (j < lines.length && /^- insert:\s*$/.test(lines[j])) {
      let end = j + 1
      while (end < lines.length && !/^- /.test(lines[end])) end++
      return { markerIndex: i, blockIndex: j, blockEndIndex: end }
    }
    return { markerIndex: i, blockIndex: -1, blockEndIndex: -1 }
  }
  return null
}

/**
 * Parse every managed entry from patch text: the rows inside this plugin's
 * managed `- insert:` block, plus legacy top-level `@deepseek-ai/dsh-tool-subagent`
 * rows (upsert migrates those into the managed block).
 * @param text - the patch file text.
 * @returns array of { id, config, raw, legacy }.
 */
export function parseManagedEntries(text) {
  const lines = text.split(/\r?\n/)
  const entries = []

  const managed = locateManagedBlock(lines)
  if (managed && managed.blockIndex !== -1) {
    const inner = lines.slice(managed.blockIndex + 1, managed.blockEndIndex)
    let start = -1
    for (let i = 0; i < inner.length; i++) {
      if (/^ {4}- /.test(inner[i])) {
        if (start !== -1) pushInner(entries, inner, start, i)
        start = i
      }
    }
    if (start !== -1) pushInner(entries, inner, start, inner.length)
  }

  for (const block of topLevelBlocks(lines)) {
    if (!isSubagentBlock(lines, block)) continue
    const id = blockId(lines, block)
    if (id === null) continue
    entries.push({
      id,
      config: configFromBlock(lines, block),
      raw: lines.slice(block.index, block.endIndex).join('\n'),
      legacy: true,
    })
  }
  return entries
}

/** Parse one sub-entry inside the managed insert block. */
function pushInner(entries, inner, start, end) {
  const raw = inner.slice(start, end)
  const idMatch = /^ {4}-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(raw[0])
  if (!idMatch) return
  const isOurs = raw.some(line => /^ {6}name:\s*['"]?@deepseek-ai\/dsh-tool-subagent['"]?\s*$/.test(line))
  if (!isOurs) return
  let configStart = -1
  for (let i = 0; i < raw.length; i++) {
    if (/^ {6}config:\s*$/.test(raw[i])) { configStart = i + 1; break }
  }
  const config = configStart === -1 ? {} : parseMapping(raw, configStart, raw.length, 8)
  entries.push({ id: idMatch[1], config, raw: raw.join('\n'), legacy: false })
}

/** Every top-level block id in the patch file, whatever plugin it names. */
function allBlockIds(lines) {
  return topLevelBlocks(lines)
    .map(block => blockId(lines, block))
    .filter(id => id !== null)
}

/* ========================================================================== */
/*                     CLI backend block editor + detection                   */
/* ========================================================================== */

/**
 * Locate the CLI backend managed `- insert:` block (identified by the CLI
 * marker comment line immediately above it). Same shape as locateManagedBlock.
 * @returns { markerIndex, blockIndex, blockEndIndex } or null when absent.
 */
function locateCliBlock(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== CLI_BLOCK_MARKER) continue
    let j = i + 1
    while (j < lines.length && (lines[j].trim() === '' || lines[j].startsWith('#'))) j++
    if (j < lines.length && /^- insert:\s*$/.test(lines[j])) {
      let end = j + 1
      while (end < lines.length && !/^- /.test(lines[end])) end++
      return { markerIndex: i, blockIndex: j, blockEndIndex: end }
    }
    return { markerIndex: i, blockIndex: -1, blockEndIndex: -1 }
  }
  return null
}

/**
 * Parse the CLI backend rows from patch text: rows inside the CLI block whose
 * `name:` names one of the known CLI provider packages.
 * @param text - the patch file text.
 * @returns array of { backendId, packageName, config }.
 */
export function parseCliBackends(text) {
  const lines = text.split(/\r?\n/)
  const known = new Map(CLI_BACKENDS.map(item => [item.packageName, item]))
  const block = locateCliBlock(lines)
  if (!block || block.blockIndex === -1) return []
  const inner = lines.slice(block.blockIndex + 1, block.blockEndIndex)
  const spans = []
  let start = -1
  for (let i = 0; i < inner.length; i++) {
    if (/^ {4}- /.test(inner[i])) {
      if (start !== -1) spans.push([start, i])
      start = i
    }
  }
  if (start !== -1) spans.push([start, inner.length])
  const rows = []
  for (const [from, to] of spans) {
    const raw = inner.slice(from, to)
    const idMatch = /^ {4}-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(raw[0])
    if (!idMatch) continue
    const nameLine = raw.find(line => /^ {6}name:\s/.test(line))
    if (nameLine === undefined) continue
    const packageName = yamlScalar(nameLine.replace(/^ {6}name:\s*/, ''))
    if (!known.has(packageName)) continue
    let configStart = -1
    for (let i = 0; i < raw.length; i++) {
      if (/^ {6}config:\s*$/.test(raw[i])) { configStart = i + 1; break }
    }
    const config = configStart === -1 ? {} : parseMapping(raw, configStart, raw.length, 8)
    rows.push({ backendId: idMatch[1], packageName, config })
  }
  return rows
}

/**
 * Serialize one CLI backend row (indent 4 inside `- insert:`). An empty env is
 * omitted entirely — the provider packages' Config schema defaults it to {}.
 * @param backend - CLI_BACKENDS entry.
 * @param config - validated config (providerName/permissionMode/disposeGraceMs/env).
 * @returns YAML lines (no trailing newline).
 */
export function serializeCliRow(backend, config, indent = 4) {
  const pad = ' '.repeat(indent)
  const out = []
  out.push(`${pad}- id: ${JSON.stringify(backend.id)}`)
  out.push(`${pad}  name: '${backend.packageName}'`)
  out.push(`${pad}  config:`)
  out.push(`${pad}    providerName: ${JSON.stringify(config.providerName)}`)
  out.push(`${pad}    permissionMode: ${JSON.stringify(config.permissionMode)}`)
  out.push(`${pad}    disposeGraceMs: ${Number(config.disposeGraceMs)}`)
  const envKeys = Object.keys(config.env || {})
  if (envKeys.length > 0) {
    out.push(`${pad}    env:`)
    for (const key of envKeys) out.push(`${pad}      ${key}: ${JSON.stringify(String(config.env[key]))}`)
  }
  return out
}

/**
 * Insert or replace one CLI backend row inside the CLI `- insert:` block
 * (creating block + marker at EOF when absent).
 * @returns new lines array.
 */
export function upsertCliIntoLines(lines, backend, config) {
  const fresh = serializeCliRow(backend, config)
  const block = locateCliBlock(lines)
  if (block === null) {
    const trimmed = [...lines]
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop()
    return [...trimmed, '', CLI_BLOCK_MARKER, '- insert:', ...fresh]
  }
  if (block.blockIndex === -1) {
    return [...lines.slice(0, block.markerIndex + 1), '- insert:', ...fresh, ...lines.slice(block.markerIndex + 1)]
  }
  const inner = lines.slice(block.blockIndex + 1, block.blockEndIndex)
  for (let i = 0; i < inner.length; i++) {
    if (!/^ {4}- /.test(inner[i])) continue
    const idMatch = /^ {4}-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(inner[i])
    if (idMatch && idMatch[1] === backend.id) {
      let innerEnd = inner.length
      for (let j = i + 1; j < inner.length; j++) {
        if (/^ {4}- /.test(inner[j])) { innerEnd = j; break }
      }
      return [
        ...lines.slice(0, block.blockIndex + 1),
        ...inner.slice(0, i),
        ...fresh,
        ...inner.slice(innerEnd),
        ...lines.slice(block.blockEndIndex),
      ]
    }
  }
  return [...lines.slice(0, block.blockEndIndex), ...fresh, ...lines.slice(block.blockEndIndex)]
}

/**
 * Remove one CLI backend row by id; an emptied CLI block is removed together
 * with its marker.
 * @returns { lines, removed } where removed reports whether a row was deleted.
 */
export function removeCliFromLines(lines, backendId) {
  const block = locateCliBlock(lines)
  if (!block || block.blockIndex === -1) return { lines, removed: false }
  const inner = lines.slice(block.blockIndex + 1, block.blockEndIndex)
  let kept = []
  let removed = false
  let current = null
  const flush = () => {
    if (current === null) return
    const idMatch = /^ {4}-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(current[0])
    if (idMatch && idMatch[1] === backendId) removed = true
    else kept = [...kept, ...current]
    current = null
  }
  for (const line of inner) {
    if (/^ {4}- /.test(line)) { flush(); current = [line] }
    else if (current !== null) current = [...current, line]
  }
  flush()
  if (!removed) return { lines, removed }
  let next
  if (kept.length === 0) {
    next = [...lines.slice(0, block.markerIndex), ...lines.slice(block.blockEndIndex)]
    if (next[block.markerIndex] !== undefined && next[block.markerIndex].trim() === ''
      && block.markerIndex > 0 && next[block.markerIndex - 1].trim() === '') {
      next = [...next.slice(0, block.markerIndex), ...next.slice(block.markerIndex + 1)]
    }
  } else {
    next = [...lines.slice(0, block.blockIndex + 1), ...kept, ...lines.slice(block.blockEndIndex)]
  }
  return { lines: next, removed: true }
}

/**
 * Validate one cliUpsert config against the backend's schema. Throws a
 * user-facing Error on the first violated rule.
 * @param backend - CLI_BACKENDS entry.
 * @param config - untrusted config object.
 */
export function validateCliConfig(backend, config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('config 必须是对象')
  }
  const unknownKeys = Object.keys(config).filter(key => !CLI_CONFIG_KEYS.includes(key))
  if (unknownKeys.length > 0) {
    throw new Error(`config 含未知字段：${unknownKeys.join(', ')}（允许：${CLI_CONFIG_KEYS.join(', ')}）`)
  }
  if (config.providerName !== undefined
    && (typeof config.providerName !== 'string' || !CLI_PROVIDER_NAME_PATTERN.test(config.providerName))) {
    throw new Error(`providerName 必须是 1-48 位小写字母/数字/下划线/中划线且字母开头：${JSON.stringify(config.providerName ?? null)}`)
  }
  if (config.permissionMode !== undefined && !backend.permissionModes.includes(config.permissionMode)) {
    throw new Error(`permissionMode 只能是：${backend.permissionModes.join(' / ')}（当前：${JSON.stringify(config.permissionMode)}）`)
  }
  if (config.disposeGraceMs !== undefined
    && (typeof config.disposeGraceMs !== 'number' || !Number.isFinite(config.disposeGraceMs) || config.disposeGraceMs < 0)) {
    throw new Error(`disposeGraceMs 必须是非负数字（毫秒；当前：${JSON.stringify(config.disposeGraceMs)}）`)
  }
  if (config.env !== undefined) {
    if (config.env === null || typeof config.env !== 'object' || Array.isArray(config.env)) {
      throw new Error('env 必须是字符串键值对对象')
    }
    for (const [key, value] of Object.entries(config.env)) {
      if (!CLI_ENV_KEY_PATTERN.test(key)) {
        throw new Error(`env 键名只能是字母/数字/下划线且字母或下划线开头：${JSON.stringify(key)}`)
      }
      if (typeof value !== 'string') {
        throw new Error(`env["${key}"] 必须是字符串`)
      }
    }
  }
}

/**
 * Cached npm global root (probed once per process, asynchronously — never a
 * sync spawn on the host thread): lets the resolver see -g installed packages.
 * `undefined` = not probed yet, `null` = probed and absent.
 */
let npmGlobalRootCache
let npmGlobalRootProbe

function probeNpmGlobalRoot() {
  if (npmGlobalRootCache !== undefined) return Promise.resolve(npmGlobalRootCache)
  npmGlobalRootProbe ??= new Promise((resolve) => {
    try {
      // exec with a constant command string (never execFile+shell: the args
      // array would be concatenated unescaped — DEP0190). `npm` resolves to
      // npm.cmd on Windows via the shell, as intended.
      exec('npm root -g', { timeout: 15000, windowsHide: true }, (error, stdout) => {
        const root = error ? '' : String(stdout || '').trim()
        npmGlobalRootCache = root !== '' && existsSync(root) ? root : null
        resolve(npmGlobalRootCache)
      })
    } catch {
      npmGlobalRootCache = null
      resolve(null)
    }
  })
  return npmGlobalRootProbe
}

/**
 * Build a package resolver for the profile environment: the profile anchor
 * first (walks up into the in-box symlink farm), then this plugin's own module
 * anchor, then the npm global root (so -g installed packages are recognized).
 * The factory is async because warming the global-root anchor spawns npm; the
 * returned resolver itself is fully synchronous. When the npm global root is
 * unavailable the third anchor is simply absent — no fallback to an unrelated
 * cwd that could resolve packages by accident.
 * Returns { ok, version } per package — ok:false when unresolvable.
 */
async function packageResolverFor(profileDir) {
  const globalRoot = await probeNpmGlobalRoot()
  const anchors = [
    () => createRequire(join(profileDir, 'package.json')),
    () => createRequire(import.meta.url),
    ...(globalRoot !== null ? [() => createRequire(join(globalRoot, 'package.json'))] : []),
  ]
  return (packageName) => {
    for (const make of anchors) {
      try {
        const manifestPath = resolveManifestPath(make, packageName)
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        return { ok: true, version: typeof manifest.version === 'string' ? manifest.version : null }
      } catch {
        // try the next anchor
      }
    }
    return { ok: false, version: null }
  }
}

/** Probe one manifest: packages with strict "exports" may hide ./package.json,
 * so fall back to resolving the main entry and walking up (bounded by
 * node_modules) to locate the manifest file. */
function resolveManifestPath(make, packageName) {
  try {
    return make().resolve(`${packageName}/package.json`)
  } catch {
    const entry = make().resolve(packageName)
    let dir = dirname(entry)
    while (dir.includes('node_modules')) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) return candidate
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    throw new Error(`manifest not found for ${packageName}`)
  }
}

/* ========================================================================== */
/*                              PATH CLI probing                              */
/* ========================================================================== */

const PROBE_TIMEOUT_MS = 5000
/** Cache window so a burst of cliList/cliUpsert detections doesn't re-spawn
 * every probe back-to-back; a manual 重新检测 stays effectively live because
 * CLI versions rarely change within this window. */
const PROBE_CACHE_TTL_MS = 10_000
const probeCache = new Map()

/** Extensions Node can actually spawn on Windows without extra interpreters
 * (default PATHEXT order; entries like .JS are excluded on purpose). */
const WINDOWS_EXEC_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd']

/**
 * Resolve a Windows command to the real executable file: absolute paths check
 * their own directory (PATHEXT-appended when extension-less), bare names scan
 * PATH × PATHEXT. Returns an fs-verified absolute path or null when nothing
 * matches — the caller only ever spawns paths this function confirmed to
 * exist, so shell metacharacters in a configured command can never be
 * interpreted by a shell here.
 */
function locateWindowsCommandFile(command) {
  const exts = String(process.env.PATHEXT || '')
    .split(';')
    .map(entry => {
      const trimmed = entry.trim().toLowerCase()
      return trimmed === '' ? trimmed : (trimmed.startsWith('.') ? trimmed : `.${trimmed}`)
    })
    .filter(entry => WINDOWS_EXEC_EXTENSIONS.includes(entry))
  const extensions = exts.length > 0 ? exts : WINDOWS_EXEC_EXTENSIONS
  const inDir = (dir, base) => {
    if (/\.(com|exe|bat|cmd)$/i.test(base)) {
      const candidate = join(dir, base)
      return existsSync(candidate) ? candidate : null
    }
    for (const ext of extensions) {
      const candidate = join(dir, `${base}${ext}`)
      if (existsSync(candidate)) return candidate
    }
    return null
  }
  if (command.includes('\\') || command.includes('/')) {
    return inDir(dirname(command), command.split(/[\\/]/).pop())
  }
  const dirs = String(process.env.PATH ?? '')
    .split(';')
    .map(entry => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(entry => entry !== '')
  for (const dir of dirs) {
    const found = inDir(dir, command)
    if (found !== null) return found
  }
  return null
}

/** First non-empty line of a probe's stdout, trimmed — the version display. */
function firstNonEmptyLine(text) {
  const line = String(text ?? '').split(/\r?\n/).find(part => part.trim() !== '')
  return line !== undefined ? line.trim() : null
}

/** Run `--version` on a direct executable (argv-style, NO shell — nothing is
 * ever shell-interpreted). `ran:false` with code ENOENT means absent. */
function execVersionProbe(target) {
  return new Promise((resolve) => {
    try {
      execFile(target, ['--version'], { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        resolve({ ran: error === null || error.code !== 'ENOENT', code: error === null ? null : error.code, stdout: String(stdout || '') })
      })
    } catch (error) {
      resolve({ ran: false, code: error && error.code, stdout: '' })
    }
  })
}

/** .bat/.cmd shims can only run through cmd.exe (Node refuses to spawn them
 * directly). The target is an fs-verified absolute path from
 * {@link locateWindowsCommandFile} — double-quoting keeps it a single token;
 * no user-controlled string reaches this shell line. */
function execWindowsBatchProbe(target) {
  return new Promise((resolve) => {
    try {
      exec(`"${target}" --version`, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        resolve({ stdout: String(stdout || '') })
      })
    } catch {
      resolve({ stdout: '' })
    }
  })
}

/**
 * Probe one CLI: presence + best-effort `--version`. `ok` means "the command
 * exists and could be launched" — a quiet or failing `--version` still
 * reports ok:true with version:null, so an installed CLI is never mistaken
 * for an absent one (the version is cosmetic; mountability is what matters).
 * Only ever called with fixed command names or validated persisted commands.
 * Results are cached for {@link PROBE_CACHE_TTL_MS}.
 * @returns Promise<{ ok, version }>
 */
export function probePathCommand(command) {
  const cached = probeCache.get(command)
  if (cached !== undefined && Date.now() - cached.at < PROBE_CACHE_TTL_MS) {
    return Promise.resolve(cached.result)
  }
  return probePathCommandUncached(command).then((result) => {
    probeCache.set(command, { at: Date.now(), result })
    return result
  })
}

async function probePathCommandUncached(command) {
  if (process.platform === 'win32') {
    const target = locateWindowsCommandFile(command)
    if (target === null) return { ok: false, version: null }
    const stdout = /\.(bat|cmd)$/i.test(target)
      ? (await execWindowsBatchProbe(target)).stdout
      : (await execVersionProbe(target)).stdout
    return { ok: true, version: firstNonEmptyLine(stdout) }
  }
  // POSIX: execFile does the PATH lookup itself; only a spawn-level ENOENT
  // means absent — a non-zero exit or probe timeout still proves the CLI is
  // installed.
  const probe = await execVersionProbe(command)
  if (!probe.ran) return { ok: false, version: null }
  return { ok: true, version: firstNonEmptyLine(probe.stdout) }
}

/**
 * Detect CLI backend availability for the panel: provider/runner package
 * resolvability, PATH CLI presence + version, current mount state and config,
 * plus a display-only scan of other well-known agent CLIs.
 * @param profileDir - profile directory (patch anchor + package resolution).
 * @param probes - test seam: { resolvePackageRelease, probePathCommand }.
 * @returns { backends, others } for the CLI tab.
 */
export async function detectCliBackends(profileDir, probes) {
  const resolvePackage = (probes && probes.resolvePackageRelease) || await packageResolverFor(profileDir)
  const probeCommand = (probes && probes.probePathCommand) || probePathCommand
  const { lines } = readPatch(profileDir)
  const mounted = new Map(parseCliBackends(lines.join('\n')).map(row => [row.backendId, row.config]))
  const backends = await Promise.all(CLI_BACKENDS.map(async (backend) => {
    const [providerPackage, runner, cli] = await Promise.all([
      resolvePackage(backend.packageName),
      resolvePackage(backend.runnerPackage),
      probeCommand(backend.cliCommand),
    ])
    const config = mounted.get(backend.id)
    return {
      id: backend.id,
      label: backend.label,
      packageName: backend.packageName,
      runnerPackage: backend.runnerPackage,
      cliPackage: backend.cliPackage || null,
      cliCommand: backend.cliCommand,
      permissionModes: backend.permissionModes,
      missing: missingPackagesFor(backend, resolvePackage),
      providerPackage,
      runner,
      cli,
      mounted: config !== undefined,
      config: config !== undefined ? config : backend.defaultConfig,
    }
  }))
  const others = await Promise.all(CLI_SCAN_ONLY.map(async (name) => ({ name, cli: await probeCommand(name) })))
  return { backends, others }
}

/* ========================================================================== */
/*                     Generic external-CLI command provider                  */
/* ========================================================================== */

/** Derive the generic backend id base ('gemini' → 'gemini', 'C:\x\Aider.exe' → 'aider'). */
function genericIdBase(command) {
  const base = String(command ?? '')
    .replace(/^[A-Za-z]:[\\/]/, '')
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base !== '' ? base : 'custom'
}

/** Preset non-interactive args for well-known agent CLIs; bare {prompt} otherwise. */
function genericPresetArgs(command) {
  return CLI_GENERIC_PRESET_ARGS[String(command ?? '').toLowerCase()] || ['{prompt}']
}

/** Simple command names resolve from PATH; absolute paths are allowed; anything else is rejected. */
function isValidCliCommandValue(command) {
  if (typeof command !== 'string' || command === '' || /\s/.test(command)) return false
  if (/^[A-Za-z]:[\\/]/.test(command) || command.startsWith('/')) return true
  return /^[A-Za-z][A-Za-z0-9._-]*$/.test(command)
}

/**
 * Validate one generic external-CLI backend entry (the shape persisted to
 * subagent-admin.cli.json). Throws a user-facing Error on the first violated
 * rule.
 * @param backend - { id, command, args, providerName, disposeGraceMs, env, cwd? }.
 * @param taken - { takenProviderNames?: Set<string> } names claimed by others.
 */
export function validateGenericCliBackend(backend, taken) {
  if (backend === null || typeof backend !== 'object' || Array.isArray(backend)) {
    throw new Error('后端配置必须是对象')
  }
  if (typeof backend.id !== 'string' || !new RegExp(`^${CLI_GENERIC_ID_PREFIX}[a-z0-9][a-z0-9_-]{0,47}$`).test(backend.id)) {
    throw new Error(`后端 ID 必须是 "${CLI_GENERIC_ID_PREFIX}" 开头的小写字母/数字/下划线/中划线：${JSON.stringify(backend.id ?? null)}`)
  }
  if (!isValidCliCommandValue(backend.command)) {
    throw new Error(`command 只能是 PATH 上的命令名或绝对路径，且不含空格：${JSON.stringify(backend.command ?? null)}`)
  }
  if (!Array.isArray(backend.args) || backend.args.length === 0 || backend.args.length > CLI_GENERIC_MAX_ARGS
    || !backend.args.every(arg => typeof arg === 'string' && arg.length > 0 && arg.length <= CLI_ARG_MAX_CHARS)) {
    throw new Error(`args 必须是 1-${CLI_GENERIC_MAX_ARGS} 个非空字符串（单条 ≤ ${CLI_ARG_MAX_CHARS} 字符），用 {prompt} 占位提示词`)
  }
  if (!backend.args.includes('{prompt}')) {
    throw new Error('args 必须包含 {prompt} 占位符（提示词将替换该占位符传入 CLI）')
  }
  if (typeof backend.providerName !== 'string' || !CLI_PROVIDER_NAME_PATTERN.test(backend.providerName)) {
    throw new Error(`providerName 必须是 1-48 位小写字母/数字/下划线/中划线且字母开头：${JSON.stringify(backend.providerName ?? null)}`)
  }
  if (CLI_GENERIC_RESERVED_PROVIDER_NAMES.has(backend.providerName)) {
    throw new Error(`providerName "${backend.providerName}" 是保留名（内置后端已占用）`)
  }
  if ((taken && taken.takenProviderNames && taken.takenProviderNames.has(backend.providerName))) {
    throw new Error(`providerName "${backend.providerName}" 已被其他后端占用`)
  }
  if (backend.disposeGraceMs !== undefined
    && (typeof backend.disposeGraceMs !== 'number' || !Number.isFinite(backend.disposeGraceMs) || backend.disposeGraceMs < 0)) {
    throw new Error(`disposeGraceMs 必须是非负数字（毫秒；当前：${JSON.stringify(backend.disposeGraceMs)}）`)
  }
  if (backend.cwd !== undefined && (typeof backend.cwd !== 'string' || backend.cwd === '')) {
    throw new Error('cwd 必须是非空字符串（绝对路径）')
  }
  if (backend.env !== undefined) {
    if (backend.env === null || typeof backend.env !== 'object' || Array.isArray(backend.env)) {
      throw new Error('env 必须是字符串键值对对象')
    }
    for (const [key, value] of Object.entries(backend.env)) {
      if (!CLI_ENV_KEY_PATTERN.test(key)) {
        throw new Error(`env 键名只能是字母/数字/下划线且字母或下划线开头：${JSON.stringify(key)}`)
      }
      if (typeof value !== 'string') {
        throw new Error(`env["${key}"] 必须是字符串`)
      }
    }
  }
}

/** Collect the text of one 'collect'-mode stdout/stderr output collector. */
function readCollectText(collector) {
  if (!collector || typeof collector.readFrom !== 'function') return ''
  try {
    const chunk = collector.readFrom(0)
    return typeof chunk?.text === 'string' ? chunk.text : ''
  } catch {
    return ''
  }
}

function textBlocksFrom(text) {
  const trimmed = String(text ?? '').trim()
  return trimmed === '' ? [] : [{ type: 'text', text: trimmed }]
}

function limitCliDiagnostic(text) {
  return String(text ?? '').trim().slice(0, CLI_DIAGNOSTIC_MAX_CHARS)
}

/**
 * Build a one-shot external-CLI subagent provider: prompt text replaces the
 * {prompt} placeholder in the argv template, stdout becomes the delegation
 * result, a non-zero exit (or spawn failure) maps to stopReason 'error' with a
 * stderr-tail diagnostic. All start capabilities are off — one-shot, plain
 * text in/out, no persona/toolFilter/depth/outputSchema support.
 * @param subprocess - the subprocess service (ctx.subprocess).
 * @param spec - { providerName, command, args, disposeGraceMs, env?, cwd? }.
 */
export function createCliCommandProvider(subprocess, spec) {
  const argvTemplate = [spec.command, ...spec.args]
  const graceMs = typeof spec.disposeGraceMs === 'number' && Number.isFinite(spec.disposeGraceMs) && spec.disposeGraceMs >= 0
    ? spec.disposeGraceMs
    : 3000
  const extraEnv = spec.env && Object.keys(spec.env).length > 0 ? spec.env : undefined
  return {
    name: spec.providerName,
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start(request) {
      const promptText = (request.prompt || [])
        .filter(block => block && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
      const argv = argvTemplate.map(part => (part === '{prompt}' ? promptText : part))
      let handle = null
      const result = new Promise((resolve) => {
        try {
          handle = subprocess.spawn({
            argv,
            cwd: typeof spec.cwd === 'string' && spec.cwd !== '' ? spec.cwd : process.cwd(),
            stdio: { stdin: 'ignore', stdout: 'collect', stderr: 'collect' },
            graceMs,
            signal: request.signal,
            ...(extraEnv !== undefined ? { env: extraEnv } : {}),
          })
        } catch (error) {
          resolve({
            output: [],
            diagnostic: limitCliDiagnostic(`CLI 启动失败：${String((error && error.message) || error)}`),
            stopReason: 'error',
          })
          return
        }
        handle.done.then((outcome) => {
          if (request.signal.aborted) {
            resolve({ output: textBlocksFrom(readCollectText(handle.collected?.stdout)), stopReason: 'aborted' })
            return
          }
          const stdoutText = readCollectText(handle.collected?.stdout)
          const stderrText = readCollectText(handle.collected?.stderr)
          const exitCode = outcome && typeof outcome.exitCode === 'number' ? outcome.exitCode : null
          if (exitCode === 0) {
            resolve({ output: textBlocksFrom(stdoutText), stopReason: 'completed' })
            return
          }
          const reason = exitCode === null
            ? `进程被信号终止（${String(outcome && outcome.signal)}）`
            : `退出码 ${exitCode}`
          resolve({
            output: textBlocksFrom(stdoutText),
            diagnostic: limitCliDiagnostic(stderrText !== '' ? stderrText : reason),
            stopReason: 'error',
          })
        }).catch((error) => {
          resolve({ output: [], diagnostic: limitCliDiagnostic(String((error && error.message) || error)), stopReason: 'error' })
        })
      })
      return Promise.resolve({
        id: `${CLI_GENERIC_ID_PREFIX}${randomUUID()}`,
        localAgent: undefined,
        result,
        dispose: async () => {
          if (handle) {
            try { await handle.terminate() } catch { /* process already exiting */ }
          }
        },
      })
    },
  }
}

/** Packages of one builtin CLI backend that are not resolvable in this deployment. */
export function missingPackagesFor(backend, resolvePackage) {
  return [backend.packageName, backend.runnerPackage, backend.cliPackage]
    .filter(name => name !== undefined)
    .filter(name => !resolvePackage(name).ok)
}

/**
 * Build an installer that runs `npm install -g <packages>` (global root, so
 * the CLI binaries land on PATH and the packages stay off the profile's
 * package.json). Long-running: 5 min timeout, output tail kept.
 */
function createNpmInstaller() {
  return (packages) => new Promise((resolve) => {
    // --allow-scripts=<pkg> per package: npm 11 blocks global install scripts
    // by default, and claude-code's postinstall places its native binary.
    const allowFlags = packages.map(pkg => `--allow-scripts=${pkg}`)
    // exec with one constant command string (never execFile+shell: that
    // concatenates args unescaped — DEP0190). The package names are the fixed
    // CLI_BACKENDS constants, never user input.
    exec(`npm install --global --legacy-peer-deps --no-audit --no-fund ${[...allowFlags, ...packages].join(' ')}`, {
      timeout: 300000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, output: ('npm install -g 失败：' + String(stderr || stdout || (error && error.message) || error)).slice(-2000) })
        return
      }
      resolve({ ok: true, output: 'npm install -g ' + packages.join(' ') + ' 完成' })
    })
  })
}

/* ========================================================================== */
/*                              Input validation                              */
/* ========================================================================== */

/**
 * Validate one upsert payload against the entry shape, the live provider
 * registry, and the candidate tool names. Throws a user-facing Error on the
 * first violated rule; returns the warnings that do not block a save.
 * @param entry - { id, config } RPC payload (untrusted).
 * @param env - { providers: Map<string, provider>, knownTools: Set<string>, runtimeTools: Set<string>, seedTools: Set<string>, existing: Map<id, config>, allIds: Set<string> }.
 * @returns string[] of non-blocking warnings (rendered by the panel).
 */
export function validateEntryInput(entry, env) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('条目必须是对象')
  }
  const { id, config } = entry
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`实例 ID 只能包含字母、数字、下划线和中划线（字母或数字开头，最长 64 位）：${JSON.stringify(id ?? null)}`)
  }
  if (!env.existing.has(id) && env.allIds.has(id)) {
    throw new Error(`行 id "${id}" 已被补丁文件中其他插件实例占用；每个补丁行的 id 必须唯一，请换一个 ID`)
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('config 必须是对象')
  }
  const unknownKeys = Object.keys(config).filter(key => !CONFIG_KEYS.includes(key))
  if (unknownKeys.length > 0) {
    throw new Error(`config 含未知字段：${unknownKeys.join(', ')}（允许：${CONFIG_KEYS.join(', ')}）`)
  }

  const providerName = config.provider
  if (typeof providerName !== 'string' || providerName.trim() === '') {
    throw new Error('provider（执行后端）必填，例如 "spawn"')
  }
  const provider = env.providers.get(providerName)
  if (provider === undefined) {
    throw new Error(`未知的执行后端 "${providerName}"；当前已注册：${[...env.providers.keys()].join(', ') || '（无）'}`)
  }

  const toolName = config.toolName
  if (typeof toolName !== 'string' || !TOOLNAME_PATTERN.test(toolName)) {
    throw new Error(`子智能体名称（模型可见的工具名）必须是 2-48 位小写字母/数字/下划线且字母开头：${JSON.stringify(toolName ?? null)}`)
  }
  if (RESERVED_TOOL_NAMES.includes(toolName)) {
    throw new Error(`子智能体名称 "${toolName}" 是保留名（内置预设已占用），请换一个名字`)
  }
  for (const [otherId, otherConfig] of env.existing) {
    if (otherId !== id && otherConfig?.toolName === toolName) {
      throw new Error(`子智能体名称 "${toolName}" 已被实例 "${otherId}" 使用；每个实例的名称必须唯一`)
    }
  }

  if (config.persona !== undefined) {
    if (typeof config.persona !== 'string') throw new Error('persona（提示词）必须是字符串')
    if (config.persona.length > PERSONA_MAX_CHARS) {
      throw new Error(`persona（提示词）超过 ${PERSONA_MAX_CHARS} 字符上限（当前 ${config.persona.length}）`)
    }
    if (provider.capabilities.persona === false) {
      throw new Error(`执行后端 "${providerName}" 不支持 persona（提示词）；请改用 spawn 等支持该能力的后端`)
    }
  }

  if (config.toolFilter !== undefined) {
    if (config.toolFilter === null || typeof config.toolFilter !== 'object' || Array.isArray(config.toolFilter)) {
      throw new Error('toolFilter 必须是 { allow?, deny? } 对象')
    }
    const unknownFilterKeys = Object.keys(config.toolFilter).filter(key => key !== 'allow' && key !== 'deny')
    if (unknownFilterKeys.length > 0) {
      throw new Error(`toolFilter 含未知字段：${unknownFilterKeys.join(', ')}（允许：allow, deny）`)
    }
    const allow = config.toolFilter.allow
    const deny = config.toolFilter.deny
    if (allow === undefined && deny === undefined) {
      throw new Error('toolFilter 不能为空对象：填写 allow 和/或 deny，或直接去掉工具约束')
    }
    for (const listName of ['allow', 'deny']) {
      const list = config.toolFilter[listName]
      if (list === undefined) continue
      if (!Array.isArray(list) || list.some(name => typeof name !== 'string')) {
        throw new Error(`toolFilter.${listName} 必须是字符串数组`)
      }
      for (const name of list) {
        if (!TOOL_REF_PATTERN.test(name)) {
          throw new Error(`toolFilter.${listName} 中的 "${name}" 不是合法工具名（小写字母/数字/下划线）`)
        }
        if (name === 'run_code') {
          throw new Error('toolFilter 不能约束保留的 Code Mode 传输工具 "run_code"')
        }
        if (!env.knownTools.has(name)) {
          throw new Error(`未知工具 "${name}"（toolFilter.${listName}）；可选项来自 harness 已注册工具与内置工具名录：${[...env.knownTools].slice(0, 12).join(', ')}…`)
        }
      }
    }
    const overlap = (allow ?? []).filter(name => (deny ?? []).includes(name))
    if (overlap.length > 0) {
      throw new Error(`工具 ${overlap.map(name => `"${name}"`).join(', ')} 同时出现在 allow 与 deny 中；一个名字只能属于一边`)
    }
    if (provider.capabilities.toolFilter === false) {
      throw new Error(`执行后端 "${providerName}" 不支持 toolFilter（工具约束）；请改用 spawn 等支持该能力的后端`)
    }
  }

  if (config.agentOptions !== undefined) {
    const options = config.agentOptions
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('agentOptions 必须是 { provider?, model?, maxTokens? } 对象')
    }
    const unknownOptionKeys = Object.keys(options).filter(key => key !== 'provider' && key !== 'model' && key !== 'maxTokens')
    if (unknownOptionKeys.length > 0) {
      throw new Error(`agentOptions 含未知字段：${unknownOptionKeys.join(', ')}（允许：provider, model, maxTokens）`)
    }
    if (options.provider !== undefined && (typeof options.provider !== 'string' || options.provider.trim() === '')) {
      throw new Error('agentOptions.provider 留空表示继承父代理，填写时必须是非空字符串')
    }
    if (options.model !== undefined && (typeof options.model !== 'string' || options.model.trim() === '' || options.model.length > MODEL_MAX_CHARS)) {
      throw new Error(`agentOptions.model 留空表示继承父代理，填写时必须是 1-${MODEL_MAX_CHARS} 字符的模型标识`)
    }
    if (options.maxTokens !== undefined
      && (!Number.isInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > MAX_TOKENS_MAX)) {
      throw new Error(`agentOptions.maxTokens 必须是 1-${MAX_TOKENS_MAX} 的整数`)
    }
  }

  if (config.maxDepth !== undefined) {
    if (config.maxDepth === 'provider-managed') {
      // Any provider may own its own recursion budget.
    } else if (!Number.isInteger(config.maxDepth) || config.maxDepth < 0 || config.maxDepth > Number.MAX_SAFE_INTEGER) {
      throw new Error('maxDepth 必须是非负整数或字符串 "provider-managed"')
    } else if (provider.capabilities.depthLimit === false) {
      throw new Error(`执行后端 "${providerName}" 无法执行数值 maxDepth（缺 depthLimit 能力）；请改用 "provider-managed" 或换后端`)
    }
  }

  if (config.backgroundMode !== undefined) {
    if (config.backgroundMode !== 'one-shot' && config.backgroundMode !== 'continuable') {
      throw new Error(`backgroundMode 只能是 "one-shot" 或 "continuable"（当前：${JSON.stringify(config.backgroundMode)}）`)
    }
    if (config.backgroundMode === 'continuable' && provider.continuable !== true && typeof provider.prepareContinuable !== 'function') {
      throw new Error(`执行后端 "${providerName}" 不支持后台可持续会话（缺 prepareContinuable 能力）；请改用 one-shot 或换后端`)
    }
  }

  if (config.enableRunInBackground !== undefined && typeof config.enableRunInBackground !== 'boolean') {
    throw new Error('enableRunInBackground 必须是布尔值')
  }

  const warnings = []
  for (const name of [...(config.toolFilter?.allow ?? []), ...(config.toolFilter?.deny ?? [])]) {
    if (!env.runtimeTools.has(name) && env.seedTools.has(name)) {
      warnings.push(`工具 "${name}" 来自内置工具名录但当前进程未注册（通常由预设按会话挂载，子智能体运行时经祖先链可见）`)
    }
  }
  return warnings
}

/* ========================================================================== */
/*                                 Plugin apply                               */
/* ========================================================================== */

/** Build a serial read-modify-write queue (same semantics as the host half). */
function makeSerialQueue() {
  let tail = Promise.resolve()
  return (operation) => {
    const run = tail.then(operation, operation)
    tail = run.catch(() => { })
    return run
  }
}

/**
 * Resolve the profile directory from the config-tree anchor (same rule as the
 * admin plugin): the loader's baseUrl anchors the profile's package.json.
 */
function profileDirOf(baseUrl) {
  const anchor = typeof baseUrl === 'string' && baseUrl.startsWith('file:')
    ? fileURLToPath(baseUrl)
    : String(baseUrl)
  if (existsSync(join(anchor, 'package.json'))) return anchor
  const parent = dirname(anchor)
  if (existsSync(join(parent, 'package.json'))) return parent
  throw new Error(`plugin-admin/subagents: no profile package.json beside config anchor ${String(baseUrl)}`)
}

/**
 * Mount the `subagentAdmin` remote: provide the service, reconcile generic
 * CLI providers, and return the invocation descriptors for the caller to
 * register (the typert registry allows ONE registration per package name, so
 * the unified dsh-plugin-admin descriptor must carry these).
 * @param ctx - plugin context carrying typert, tools, subagents.
 * @param enqueueShared - the host admin's serial queue for patch writes.
 * @returns the `subagentAdmin` invocation descriptor array.
 */
export function applySubagentAdmin(ctx, enqueueShared) {
  const profileDir = profileDirOf(ctx.baseUrl)
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
  const historyPath = join(profileDir, HISTORY_FILENAME)
  const backupPath = patchPath + BACKUP_SUFFIX

  // Serial queue for read-modify-write cycles. The admin host passes its own
  // queue: mcpAdmin and subagentAdmin both edit the profile cordis.patch.yml,
  // so patch writes across the two remotes must serialize against each other.
  const enqueue = enqueueShared ?? makeSerialQueue()

  /** Atomic write: temp file + rename, so a crash never truncates the patch. */
  const atomicWrite = (path, text) => {
    const tmp = path + TMP_SUFFIX
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  }

  /** One-time original backup so the first automated edit is reversible. */
  const ensureBackup = () => {
    if (existsSync(patchPath) && !existsSync(backupPath)) {
      copyFileSync(patchPath, backupPath)
    }
  }

  /** Append one journal record; rotate the file when it grows past budget. */
  const appendJournal = (record) => {
    try {
      if (existsSync(historyPath)) {
        const size = statSync(historyPath).size
        if (size > JOURNAL_ROTATE_BYTES) {
          const lines = readFileSync(historyPath, 'utf8').split(/\r?\n/).filter(line => line.trim() !== '')
          const keep = lines.slice(-JOURNAL_KEEP_LINES)
          atomicWrite(historyPath, `${keep.join('\n')}\n`)
        }
      }
      appendFileSync(historyPath, `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      // The journal is an audit convenience; a failed append must never fail
      // the mutation it records. Surface it in the panel via the returned
      // warning channel instead.
      ctx.logger.warn?.(`plugin-admin/subagents: journal append failed: ${String(error)}`)
    }
  }

  /** Candidate tool names: live global registry ∪ shipped seed. */
  const collectKnownTools = () => {
    const runtimeTools = new Set()
    try {
      for (const schema of ctx.tools.schemas()) {
        if (schema && typeof schema.name === 'string') runtimeTools.add(schema.name)
      }
    } catch (error) {
      ctx.logger.warn?.(`plugin-admin/subagents: tools.schemas() unavailable: ${String(error)}`)
    }
    const seedTools = new Set(Object.keys(TOOL_SEED))
    const knownTools = new Set([...runtimeTools, ...seedTools])
    return { runtimeTools, seedTools, knownTools }
  }

  /** Live provider table with capability detail for the panel. */
  const collectProviders = () => {
    const providers = new Map()
    let names = []
    try {
      names = ctx.subagents.list()
    } catch (error) {
      ctx.logger.warn?.(`plugin-admin/subagents: subagents.list() unavailable: ${String(error)}`)
      return providers
    }
    for (const name of names) {
      try {
        const provider = ctx.subagents.getProvider(name)
        if (provider === undefined) continue
        providers.set(name, {
          name,
          capabilities: {
            outputSchema: provider.capabilities?.outputSchema === true,
            depthLimit: provider.capabilities?.depthLimit === true,
            toolFilter: provider.capabilities?.toolFilter === true,
            persona: provider.capabilities?.persona === true,
          },
          continuable: typeof provider.prepareContinuable === 'function',
          inheritsParentContext: provider.inheritsParentContext === true,
        })
      } catch {
        // A provider half torn down mid-listing: skip it this round.
      }
    }
    return providers
  }

  /** Package resolver, warmed once per mount (the npm global-root probe is
   * async); await this at each use site instead of spawning npm on the
   * host thread. */
  let resolverPromise
  const resolvePackageAsync = () => {
    resolverPromise ??= packageResolverFor(profileDir)
    return resolverPromise
  }

  /** Installs missing provider/runner packages globally (npm install -g). */
  const npmInstall = createNpmInstaller()

  /* ── Generic external-CLI backends: plugin-owned JSON config + live registration.
   * These intentionally do NOT ride cordis.patch.yml rows: patch rows are
   * instantiated as bundles, and this plugin is already mounted exactly once. */
  const cliConfigPath = join(profileDir, CLI_GENERIC_CONFIG_FILENAME)
  const genericUnregisterMap = new Map()
  const readGenericCliBackends = () => {
    if (!existsSync(cliConfigPath)) return []
    try {
      const parsed = JSON.parse(readFileSync(cliConfigPath, 'utf8'))
      if (!parsed || !Array.isArray(parsed.backends)) return []
      return parsed.backends.filter(item => item !== null && typeof item === 'object' && typeof item.id === 'string')
    } catch (error) {
      ctx.logger.warn?.(`plugin-admin/subagents: unreadable ${CLI_GENERIC_CONFIG_FILENAME}: ${String(error)}`)
      return []
    }
  }
  const writeGenericCliBackends = (backends) => {
    atomicWrite(cliConfigPath, `${JSON.stringify({ backends }, null, 2)}\n`)
  }
  const subprocessService = typeof ctx.get === 'function' ? ctx.get('subprocess') : ctx.subprocess
  const subprocessReady = !!subprocessService && typeof subprocessService.spawn === 'function'
  const ensureGenericProvider = (backend, { throwWhenUnavailable = false } = {}) => {
    if (genericUnregisterMap.has(backend.id)) return true
    if (!subprocessReady) {
      const message = 'subprocess 服务不可用，无法挂载通用 CLI 后端'
      if (throwWhenUnavailable) throw new Error(message)
      ctx.logger.warn?.(`plugin-admin/subagents: ${message}; skipped "${backend.id}"`)
      return false
    }
    const provider = createCliCommandProvider(subprocessService, backend)
    genericUnregisterMap.set(backend.id, ctx.subagents.registerProvider(provider))
    return true
  }
  const dropGenericProvider = (id) => {
    const unregister = genericUnregisterMap.get(id)
    if (unregister === undefined) return
    try { unregister() } catch { /* provider already gone */ }
    genericUnregisterMap.delete(id)
  }
  const reconcileGenericProviders = () => {
    const wanted = readGenericCliBackends()
    for (const id of [...genericUnregisterMap.keys()]) {
      if (!wanted.some(item => item.id === id)) dropGenericProvider(id)
    }
    for (const backend of wanted) ensureGenericProvider(backend)
  }

  const cliListInner = async () => {
    const detected = await detectCliBackends(profileDir)
    let registeredNames = new Set()
    try { registeredNames = new Set(ctx.subagents.list()) } catch { /* leave empty */ }
    const generic = await Promise.all(readGenericCliBackends().map(async (backend) => ({
      kind: 'generic',
      id: backend.id,
      command: backend.command,
      args: backend.args,
      providerName: backend.providerName,
      disposeGraceMs: backend.disposeGraceMs,
      env: backend.env || {},
      mounted: true,
      providerPresent: registeredNames.has(backend.providerName),
      cli: await probePathCommand(backend.command),
    })))
    return { backends: [...detected.backends, ...generic], others: detected.others }
  }

  const cliUpsertGeneric = async (body) => {
    const rawConfig = body.config !== null && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : {}
    if (typeof rawConfig.command !== 'string' || rawConfig.command.trim() === '') {
      throw new Error('command 必填（PATH 上的命令名或绝对路径）')
    }
    const command = rawConfig.command.trim()
    const providedId = typeof body.backendId === 'string' && body.backendId.trim() !== '' ? body.backendId.trim() : undefined
    const id = providedId !== undefined ? providedId : CLI_GENERIC_ID_PREFIX + genericIdBase(command)
    const existing = readGenericCliBackends()
    const previous = existing.find(item => item.id === id)
    const effective = {
      id,
      command,
      args: Array.isArray(rawConfig.args) && rawConfig.args.length > 0 ? rawConfig.args : genericPresetArgs(command),
      providerName: typeof rawConfig.providerName === 'string' && rawConfig.providerName.trim() !== ''
        ? rawConfig.providerName.trim()
        : CLI_GENERIC_ID_PREFIX + genericIdBase(command),
      disposeGraceMs: rawConfig.disposeGraceMs !== undefined ? rawConfig.disposeGraceMs : 3000,
      env: rawConfig.env !== undefined ? rawConfig.env : {},
    }
    if (rawConfig.cwd !== undefined) effective.cwd = rawConfig.cwd
    const taken = new Set(existing.filter(item => item.id !== id).map(item => item.providerName))
    validateGenericCliBackend(effective, { takenProviderNames: taken })
    let liveNames = []
    try { liveNames = ctx.subagents.list() } catch { /* leave empty */ }
    const claimedByThisMount = previous !== undefined && previous.providerName === effective.providerName
      && genericUnregisterMap.has(id)
    if (!claimedByThisMount && liveNames.includes(effective.providerName)) {
      throw new Error(`providerName "${effective.providerName}" 已在运行中注册，请换一个名字`)
    }
    if (previous !== undefined && previous.providerName !== effective.providerName) {
      const referencing = parseManagedEntries(readPatch(profileDir).lines.join('\n'))
        .filter(item => item.config && item.config.provider === previous.providerName)
        .map(item => item.id)
      if (referencing.length > 0) {
        throw new Error(`providerName "${previous.providerName}" 仍被子智能体实例引用（${referencing.join(', ')}）；请先改这些实例的执行后端再改名`)
      }
    }
    await enqueue(() => {
      const current = readGenericCliBackends()
      const at = current.findIndex(item => item.id === id)
      if (at === -1) current.push(effective)
      else current[at] = effective
      writeGenericCliBackends(current)
      appendJournal({
        at: new Date().toISOString(),
        action: at === -1 ? 'mount' : 'cli-update',
        id,
        entry: { kind: 'generic', backend: effective },
      })
    })
    ensureGenericProvider(effective, { throwWhenUnavailable: true })
    return { ok: true, ...(await cliListInner()) }
  }

  const cliRemoveGeneric = async (backendId) => {
    await enqueue(() => {
      const current = readGenericCliBackends()
      const previous = current.find(item => item.id === backendId)
      if (previous === undefined) {
        throw new Error(`通用 CLI 后端 "${String(backendId)}" 未挂载`)
      }
      const referencing = parseManagedEntries(readPatch(profileDir).lines.join('\n'))
        .filter(item => item.config && item.config.provider === previous.providerName)
        .map(item => item.id)
      if (referencing.length > 0) {
        throw new Error(`仍有子智能体实例在使用后端 "${previous.providerName}"（${referencing.join(', ')}）；请先删除或改配这些实例再卸载`)
      }
      writeGenericCliBackends(current.filter(item => item.id !== backendId))
      appendJournal({ at: new Date().toISOString(), action: 'unmount', id: backendId, entry: { kind: 'generic' } })
    })
    dropGenericProvider(backendId)
    return { ok: true, ...(await cliListInner()) }
  }

  const listEntries = async () => {
    const { lines } = readPatch(profileDir)
    const providers = collectProviders()
    const { runtimeTools, seedTools } = collectKnownTools()
    const entries = parseManagedEntries(lines.join('\n')).map((entry) => {
      let registered = false
      try {
        registered = entry.config?.toolName !== undefined
          && ctx.tools.get(entry.config.toolName) !== undefined
      } catch {
        registered = false
      }
      const providerName = entry.config?.provider
      return {
        id: entry.id,
        config: entry.config,
        raw: entry.raw,
        live: {
          toolRegistered: registered,
          providerPresent: providerName !== undefined && providers.has(providerName),
        },
      }
    })
    const tools = [...new Set([...runtimeTools, ...seedTools])]
      .sort()
      .map((name) => ({
        name,
        source: runtimeTools.has(name) && seedTools.has(name) ? 'runtime+seed' : runtimeTools.has(name) ? 'runtime' : 'seed',
      }))

    // Configured LLM catalog (best-effort): powers the model/provider
    // dropdowns in the panel. Degrades to empty lists when the `llm` service
    // is absent, so the free-text fallback still works.
    const llmProviders = []
    const llmModels = {}
    const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
    if (llm && typeof llm.listProviders === 'function') {
      try {
        const providerInfos = llm.listProviders() || []
        for (const p of providerInfos) {
          const id = p.id || p.provider
          if (!id) continue
          llmProviders.push({ id, name: p.name || id })
          try {
            const models = (await llm.listModels(id)) || []
            llmModels[id] = models.map((m) => ({ id: m.id, name: m.name || m.id }))
          } catch {
            llmModels[id] = []
          }
        }
      } catch {
        // leave catalogs empty
      }
    }

    return { profileDir, patchPath, entries, meta: { tools, providers: [...providers.values()], llmProviders, llmModels } }
  }

  const service = {
    /** Panel bootstrap payload: entries + live status + picker meta. */
    async list() {
      return listEntries()
    },

    /** Running subagents currently resident in this dsh process. */
    async runtimeList() {
      let agents
      try {
        agents = ctx.get?.('agents') ?? ctx.agents
      } catch (error) {
        ctx.logger.warn?.(`plugin-admin/subagents: agents registry unavailable: ${String(error)}`)
        return { agents: [] }
      }
      if (!agents || typeof agents.list !== 'function') return { agents: [] }
      const running = []
      for (const agent of agents.list()) {
        const header = agent?.session?.header
        if (agent?.status !== 'running' || header?.origin !== 'subagent' || typeof header.parentSession !== 'string') continue
        const events = Array.isArray(agent.session?.events) ? agent.session.events : []
        const descriptor = [...events].reverse().find(event => event?.type === 'subagent/descriptor')?.data
        running.push({
          id: String(agent.id),
          parentSessionId: header.parentSession,
          provider: typeof descriptor?.provider === 'string' ? descriptor.provider : null,
          mode: descriptor?.mode === 'continuable' || descriptor?.mode === 'one-shot' ? descriptor.mode : null,
          label: typeof descriptor?.label === 'string' ? descriptor.label : null,
          depth: Number.isSafeInteger(header.delegationDepth) ? header.delegationDepth : null,
        })
      }
      return { agents: running }
    },

    /** Interrupt one running child after verifying its live session ownership. */
    async runtimeInterrupt(childId, parentSessionId) {
      const body = childId !== null && typeof childId === 'object' && !Array.isArray(childId)
        ? childId
        : { childId, parentSessionId }
      if (typeof body.childId !== 'string' || body.childId === '' || typeof body.parentSessionId !== 'string' || body.parentSessionId === '') {
        throw new Error('缺少运行中子智能体的会话标识')
      }
      const agents = ctx.get?.('agents') ?? ctx.agents
      const agent = agents?.get?.(body.childId)
      const header = agent?.session?.header
      if (agent?.status !== 'running' || header?.origin !== 'subagent' || header.parentSession !== body.parentSessionId) {
        throw new Error('该子智能体已结束，或不属于指定父会话；请刷新列表')
      }
      const descriptor = [...(Array.isArray(agent.session?.events) ? agent.session.events : [])]
        .reverse().find(event => event?.type === 'subagent/descriptor')?.data
      if (descriptor?.mode !== 'continuable') {
        throw new Error('该一次性子智能体不支持运行中中断')
      }
      ctx.subagents.interrupt(body.childId, { kind: 'user', parentSessionId: body.parentSessionId })
      return { ok: true }
    },

    /**
     * Validate and persist one subagent entry: replace the row with the same
     * id or append a new row in the profile patch file. The Cordis user-layer
     * watcher hot-reloads the change into the live tree.
     * @param entry - { id, config } untrusted RPC payload.
     * @returns { ok, warnings, entries } with the fresh list.
     */
    async upsert(entry) {
      const payload = entry !== null && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.entry === 'object'
        ? entry.entry
        : entry
      const warnings = enqueue(() => {
        const { lines } = readPatch(profileDir)
        const existing = new Map(parseManagedEntries(lines.join('\n')).map(item => [item.id, item.config]))
        const allIds = new Set(allBlockIds(lines))
        const { runtimeTools, seedTools, knownTools } = collectKnownTools()
        const validationWarnings = validateEntryInput(payload, {
          providers: collectProviders(),
          knownTools,
          runtimeTools,
          seedTools,
          existing,
          allIds,
        })
        const next = upsertIntoLines(lines, { id: payload.id, config: payload.config })
        ensureBackup()
        atomicWrite(patchPath, `${next.join('\n').replace(/\n*$/, '\n')}`)
        appendJournal({ at: new Date().toISOString(), action: existing.has(payload.id) ? 'update' : 'create', id: payload.id, toolName: payload.config?.toolName, entry: payload })
        return validationWarnings
      })
      return { ok: true, warnings: await warnings, ...await listEntries() }
    },

    /**
     * Delete one managed subagent row by id.
     * @param id - the managed entry id.
     * @returns { ok, entries } with the fresh list.
     */
    async remove(id) {
      const targetId = id !== null && typeof id === 'object' && !Array.isArray(id) ? id.id : id
      await enqueue(() => {
        const { lines } = readPatch(profileDir)
        const result = removeFromLines(lines, targetId)
        if (!result.removed) {
          const known = parseManagedEntries(lines.join('\n')).map(item => item.id)
          throw new Error(`实例 "${String(targetId)}" 不存在；当前受管实例：${known.join(', ') || '（无）'}`)
        }
        ensureBackup()
        atomicWrite(patchPath, `${result.lines.join('\n').replace(/\n+$/, '\n')}`)
        appendJournal({ at: new Date().toISOString(), action: 'delete', id: targetId })
      })
      return { ok: true, ...await listEntries() }
    },

    /**
     * The change journal (配置台账), newest first.
     * @param limit - max records (default 100, capped 500).
     */
    async history(limit) {
      const requested = limit !== null && typeof limit === 'object' && !Array.isArray(limit) ? limit.limit : limit
      const max = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 100
      if (!existsSync(historyPath)) return { path: historyPath, records: [] }
      const lines = readFileSync(historyPath, 'utf8').split(/\r?\n/).filter(line => line.trim() !== '')
      const records = []
      for (const line of lines) {
        try {
          records.push(JSON.parse(line))
        } catch {
          records.push({ at: null, action: 'corrupt', id: line.slice(0, 80) })
        }
      }
      return { path: historyPath, records: records.slice(-max).reverse() }
    },

    /** CLI backend tab payload: detection matrix (builtin + generic) + mounted rows + configs. */
    async cliList() {
      return cliListInner()
    },

    /**
     * Mount or update one CLI backend. kind 'builtin' (default) manages the
     * harness provider packages via CLI patch rows; kind 'generic' mounts any
     * external CLI command via this plugin's generic command provider.
     * @param payload - { kind?, backendId, config } untrusted RPC payload.
     * @returns { ok, backends, others } with fresh detection.
     */
    async cliUpsert(payload) {
      const body = payload !== null && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.payload === 'object'
        ? payload.payload
        : payload
      if (body !== null && typeof body === 'object' && body.kind === 'generic') {
        return cliUpsertGeneric(body)
      }
      const backendId = body !== null && typeof body === 'object' ? body.backendId : undefined
      const backend = CLI_BACKENDS.find(item => item.id === backendId)
      if (backend === undefined) {
        throw new Error(`未知的 CLI 后端 "${String(backendId)}"；支持：${CLI_BACKENDS.map(item => item.id).join(', ')}`)
      }
      const rawConfig = body !== null && typeof body === 'object' && body.config !== undefined ? body.config : {}
      validateCliConfig(backend, rawConfig)
      const effective = { ...backend.defaultConfig, ...rawConfig }
      await enqueue(async () => {
        const resolvePackage = await resolvePackageAsync()
        const { lines } = readPatch(profileDir)
        const mountedRows = new Map(parseCliBackends(lines.join('\n')).map(row => [row.backendId, row.config]))
        const previous = mountedRows.get(backend.id)
        if (previous === undefined && !resolvePackage(backend.packageName).ok) {
          throw new Error(`provider 包 "${backend.packageName}" 在当前部署中不可解析，无法挂载；请先安装该包后重新检测`)
        }
        if (previous !== undefined && previous.providerName !== undefined && previous.providerName !== effective.providerName) {
          const referencing = parseManagedEntries(lines.join('\n'))
            .filter(item => item.config && item.config.provider === previous.providerName)
            .map(item => item.id)
          if (referencing.length > 0) {
            throw new Error(`providerName "${previous.providerName}" 仍被子智能体实例引用（${referencing.join(', ')}）；请先改这些实例的执行后端再改名`)
          }
        }
        const next = upsertCliIntoLines(lines, backend, effective)
        ensureBackup()
        atomicWrite(patchPath, `${next.join('\n').replace(/\n*$/, '\n')}`)
        appendJournal({
          at: new Date().toISOString(),
          action: previous !== undefined ? 'cli-update' : 'mount',
          id: backend.id,
          entry: { backendId: backend.id, config: effective },
        })
      })
      return { ok: true, ...(await detectCliBackends(profileDir)) }
    },

    /**
     * Unmount one CLI backend by id. Generic backends (id prefixed "cli-")
     * drop the live-registered command provider; builtin ids delete the CLI
     * patch row. Both refuse while any managed subagent instance still
     * references the backend's provider name.
     * @param id - backendId, bare or wrapped ({ id }).
     * @returns { ok, backends, others } with fresh detection.
     */
    async cliRemove(id) {
      const body = id !== null && typeof id === 'object' && !Array.isArray(id) ? id : { id }
      const backendId = body.id
      if (typeof backendId === 'string' && backendId.startsWith(CLI_GENERIC_ID_PREFIX)) {
        return cliRemoveGeneric(backendId)
      }
      await enqueue(() => {
        const backend = CLI_BACKENDS.find(item => item.id === backendId)
        if (backend === undefined) {
          throw new Error(`未知的 CLI 后端 "${String(backendId)}"；支持：${CLI_BACKENDS.map(item => item.id).join(', ')}`)
        }
        const { lines } = readPatch(profileDir)
        const row = parseCliBackends(lines.join('\n')).find(item => item.backendId === backend.id)
        if (row === undefined) {
          throw new Error(`CLI 后端 "${backend.label}"（${backend.id}）未挂载`)
        }
        const providerName = row.config.providerName !== undefined ? row.config.providerName : backend.defaultConfig.providerName
        const referencing = parseManagedEntries(lines.join('\n'))
          .filter(item => item.config && item.config.provider === providerName)
          .map(item => item.id)
        if (referencing.length > 0) {
          throw new Error(`仍有子智能体实例在使用后端 "${providerName}"（${referencing.join(', ')}）；请先删除或改配这些实例再卸载`)
        }
        const result = removeCliFromLines(lines, backend.id)
        if (!result.removed) {
          throw new Error(`CLI 后端 "${backend.label}"（${backend.id}）未挂载`)
        }
        ensureBackup()
        atomicWrite(patchPath, `${result.lines.join('\n').replace(/\n+$/, '\n')}`)
        appendJournal({ at: new Date().toISOString(), action: 'unmount', id: backend.id })
      })
      return { ok: true, ...(await cliListInner()) }
    },

    /**
     * Install the missing provider/runner packages of one builtin CLI backend
     * globally (npm install -g). A no-op when everything already resolves.
     * Detection is re-run afterwards so the card flips to mountable.
     * @param backendId - builtin backend id, bare or wrapped ({ backendId }).
     * @returns { ok, output, backends, others }.
     */
    async cliInstall(backendId) {
      const body = backendId !== null && typeof backendId === 'object' && !Array.isArray(backendId) ? backendId : { backendId }
      const id = body.backendId
      const backend = CLI_BACKENDS.find(item => item.id === id)
      if (backend === undefined) {
        throw new Error(`未知的 CLI 后端 "${String(id)}"；支持：${CLI_BACKENDS.map(item => item.id).join(', ')}`)
      }
      const resolvePackage = await resolvePackageAsync()
      const missing = missingPackagesFor(backend, resolvePackage)
      if (missing.length === 0) {
        return { ok: true, output: '依赖已齐，无需安装', ...(await cliListInner()) }
      }
      // Install separately: the runner (e.g. @openai/codex) is public and
      // fixes 'CLI 依赖'; the provider package may carry unpublished internal
      // deps (@deepseek-ai/dsh-tasks etc.) that make a registry install
      // impossible — report that instead of failing the whole step.
      const outputs = []
      const ordered = [backend.runnerPackage, backend.cliPackage, backend.packageName]
        .filter(name => name !== undefined && missing.includes(name))
      for (const name of ordered) {
        const step = await npmInstall([name])
        outputs.push(step.output)
      }
      const stillMissing = missingPackagesFor(backend, resolvePackage)
      const output = outputs.filter(Boolean).join('\n')
        + (stillMissing.length > 0
          ? '\n仍有包安装后未解析到：' + stillMissing.join('、') + '；请点「重新检测」，若仍为 ✗ 则该包在所用 registry 上可能不可用（可尝试 --registry=https://registry.npmjs.org）'
          : '')
      return { ok: true, output, ...(await cliListInner()) }
    },
  }

  // Generic CLI providers: reconcile at boot; drop the live registrations when
  // this plugin instance is torn down (HMR / plugin removal).
  ctx.effect(() => {
    try { reconcileGenericProviders() } catch (error) {
      ctx.logger.warn?.(`plugin-admin/subagents: generic CLI provider reconcile failed: ${String(error)}`)
    }
    return () => {
      for (const id of [...genericUnregisterMap.keys()]) dropGenericProvider(id)
    }
  }, 'plugin-admin/subagents: generic cli providers')

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.provide(SERVICE_KEY, service)

  return subagentInvocations()
}

/**
 * The `subagentAdmin` invocation descriptors. The typert registry allows ONE
 * registration per package name, so these are returned to the host half
 * (dsh-plugin-admin registers a single unified descriptor for all its
 * namespaces) instead of being registered here.
 * @returns the invocation descriptor array for the unified registration.
 */
export function subagentInvocations() {
  return [
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/list`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'list',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/runtimeList`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'runtimeList',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/runtimeInterrupt`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'runtimeInterrupt',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'childId', wire: 'childId', source: 'json', codec: { mode: 'src-json' } },
        { name: 'parentSessionId', wire: 'parentSessionId', source: 'json', codec: { mode: 'src-json' } },
      ],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/upsert`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'upsert',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'entry', wire: 'entry', source: 'json', codec: { mode: 'src-json' } }],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/remove`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'remove',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } }],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/history`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'history',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'limit', wire: 'limit', source: 'json', codec: { mode: 'src-json' } }],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/cliList`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'cliList',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/cliUpsert`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'cliUpsert',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'payload', wire: 'payload', source: 'json', codec: { mode: 'src-json' } }],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/cliRemove`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'cliRemove',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } }],
      result: { mode: 'src-json' },
    },
    {
      id: `${DESCRIPTOR_PACKAGE}/subagent/cliInstall`,
      service: SERVICE_KEY,
      namespace: NAMESPACE,
      method: 'cliInstall',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'backendId', wire: 'backendId', source: 'json', codec: { mode: 'src-json' } }],
      result: { mode: 'src-json' },
    },
  ]
}
