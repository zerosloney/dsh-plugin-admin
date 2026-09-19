/**
 * Agent Preset administration host half.
 *
 * dsh's `@deepseek-ai/dsh-agent-presets` package sources presets from
 * two roots:
 *
 *   - **shipped**: the four fixed presets bundled in the harness
 *     (`cordis`, `minimal`, `ptc`, `standard`). These live inside the
 *     package and cannot be edited or removed.
 *   - **user**: `<dshHome>/.agent-presets/` — opt-in user-authored
 *     presets, one directory per preset id.
 *
 * The shipped root cannot be modified (it lives in the harness tree,
 * not under user control), so the editor targets the user root ONLY.
 * Each preset directory carries two files:
 *
 *   - `agent.cordis.yml` — the composition (a YAML list of plugin rows,
 *     each carrying at minimum a `name:` scalar — the same shape dsh's
 *     `entryListProblem` validates against).
 *   - `preset.yml` — a 3-line display record (`name`, `description`,
 *     `order`). Optional; the editor synthesizes a default when missing.
 *
 * Default selection is SETTINGS-FIRST: dsh's `AgentPresets` resolves
 * `settings.default ?? config.default`, and the profile patch's
 * `agent-presets` row `config.default` is the fallback. The editor writes the
 * settings namespace when the service is mounted (preserving every other
 * key), and mutates just that single key on the patch row otherwise — the
 * patch form is invisible wherever the settings layer already holds a value.
 *
 * The plugin works in CLI / headless deployments too — `ctx.agentPresets`
 * is mounted only by the web-app bundle, but the editor targets the
 * filesystem directly, not via the service.
 *
 * Security posture:
 *   - preset id is locked to `^[a-z0-9][a-z0-9-]*$` (upstream's regex);
 *     POSIX-safe, no fs traversal possible.
 *   - shipped presets are immutable: the editor filters them out of the
 *     editable cohort, no destructive code path exists.
 *   - default-selection mutates a single key; the rest of the row
 *     (sibling keys + comments) is preserved verbatim.
 *   - composition editor accepts raw text from the user; the save path
 *     re-validates shape (entry list, every entry has a `name:`) before
 *     persisting.
 *   - no secrets, no destructive metadata edits, no network calls.
 *
 * Zero dsh imports on purpose: pure filesystem + cordis patch.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  appendTopLevelBlocks,
  dshHome,
  findRowSpan,
  inlineMapEntries,
  profileDirOf,
  readPatchLines,
  writePatch,
  yamlScalar,
} from './patch-utils.js'

const SERVICE_KEY = 'agentPresetsAdmin'
const NAMESPACE = 'agentPresetsAdmin'
const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

/** Upstream's `PRESET_ID` regex — kebab-case ascii id. */
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Filesystem layout under `<dshHome>/.agent-presets/<id>/`. */
const USER_PRESET_DIR_NAME = '.agent-presets'
const COMPOSITION_FILENAME = 'agent.cordis.yml'
const METADATA_FILENAME = 'preset.yml'

/** Cordis row id whose `config.default` selects the active preset. */
const CORDIS_AGENT_PRESETS_ROW_ID = 'agent-presets'

/**
 * Settings namespace `dsh-agent-presets` registers its user-writable slice
 * under (`AgentPresetSettingsSchema` = `{ default: string }`). The live
 * `defaultId` resolves settings-first, so this is the layer a working
 * "set default" gesture must write.
 */
const SETTINGS_NAMESPACE = 'agent-presets'

/**
 * Built-in SHIPPED preset ids the panel refuses to author or delete.
 * Hard-coded because the plugin has no in-process link against
 * `@deepseek-ai/dsh-agent-presets`; if the upstream roster changes,
 * update this single set.
 */
const SHIPPED_PRESET_IDS = Object.freeze(new Set([
  'cordis',
  'minimal',
  'ptc',
  'standard',
]))

const descriptor = (id, method, parameters) => ({
  id: `${DESCRIPTOR_PACKAGE}/${id}`,
  service: SERVICE_KEY,
  namespace: NAMESPACE,
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: { mode: 'src-json' },
})

/** @returns {Array} typert invocation descriptors. */
export function agentPresetsInvocations() {
  const idParam = [{ name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } }]
  return [
    descriptor('agentPresets/list', 'list', []),
    descriptor('agentPresets/getDocument', 'getDocument', idParam),
    descriptor('agentPresets/upsert', 'upsert', [
      { name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } },
      { name: 'payload', wire: 'payload', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('agentPresets/delete', 'delete', idParam),
    descriptor('agentPresets/setDefault', 'setDefault', idParam),
  ]
}

/**
 * Mount the agentPresetsAdmin service onto ctx.
 *
 * @param {object} ctx - host context (read-only — used for `ctx.baseUrl`
 *   to resolve the active profile + `get('agentPresets')` to read live
 *   default value).
 * @param {object} [options] - reserved for future test stubs.
 * @returns {() => Array} agentPresetsInvocations().
 */
export function applyAgentPresetsAdmin(ctx, _options = {}) {
  /**
   * Resolve the profile directory for the active launch. Null when no
   * launch anchor exists — `writeDefault` surfaces the "no active
   * profile" error instead of silently writing a patch file dsh never
   * reads (`<dshHome>/cordis.patch.yml` is NOT a profile layer; the
   * user-preset root below still works without a launch).
   * @returns {string|null}
   */
  const profileDir = () => {
    try {
      // `ctx.baseUrl` is the Loader's plain context property; `ctx.get()`
      // only resolves services and would always miss here.
      const baseUrl = ctx.baseUrl
      if (typeof baseUrl === 'string' && baseUrl !== '') {
        const resolved = profileDirOf(baseUrl)
        if (typeof resolved === 'string' && resolved !== '') return resolved
      }
    } catch { /* absent — fall through */ }
    return null
  }

  /** Absolute path to the user preset root. */
  const userPresetRoot = () => join(dshHome(), USER_PRESET_DIR_NAME)

  /** Absolute path to one preset's directory. */
  const presetDir = (id) => join(userPresetRoot(), id)

  /**
   * Validate a preset id. Rejects empty, malformed, or shipped ids.
   * @param {string} id
   * @returns {string} the same id, on success.
   */
  function ensureValidId(id) {
    if (typeof id !== 'string' || id === '') {
      throw new Error('agentPresetsAdmin: id 必填')
    }
    if (!PRESET_ID_PATTERN.test(id)) {
      throw new Error(`agentPresetsAdmin: id "${id}" 不符合 kebab-case 命名规则（${PRESET_ID_PATTERN}）`)
    }
    if (SHIPPED_PRESET_IDS.has(id)) {
      throw new Error(`agentPresetsAdmin: "${id}" 是 dsh 默认预设，无法从面板编辑或删除`)
    }
    return id
  }

  /**
   * Read `preset.yml` for one user preset. Absent / malformed → empty
   * defaults (`name = id`, others empty).
   * @param {string} id
   */
  function readMetadata(id) {
    const metaPath = join(presetDir(id), METADATA_FILENAME)
    if (!existsSync(metaPath)) return { name: id, description: '', order: 0 }
    const text = readFileSync(metaPath, 'utf8')
    const lines = text.split(/\r?\n/)
    let name = id
    let description = ''
    let order = 0
    for (const line of lines) {
      const n = /^name:\s*(.+?)\s*$/.exec(line)
      if (n !== null) {
        const v = yamlScalar(n[1])
        if (typeof v === 'string') name = v
        continue
      }
      const d = /^description:\s*(.+?)\s*$/.exec(line)
      if (d !== null) {
        const v = yamlScalar(d[1])
        if (typeof v === 'string') description = v
        continue
      }
      const o = /^order:\s*(.+?)\s*$/.exec(line)
      if (o !== null) {
        const v = yamlScalar(o[1])
        if (typeof v === 'number') order = v
      }
    }
    return { name, description, order }
  }

  /**
   * Serialize a 3-line `preset.yml` for one user preset. The shape is
   * stable — three scalars, one each — so a hand-written editor stays
   * round-trippable.
   *
   * Every string is emitted as a double-quoted scalar (JSON escaping is a
   * subset of YAML's double-quoted style). Raw interpolation wrote
   * `description: note: fast` — an ordinary thing to type — as a nested
   * mapping, which made the whole file unparsable so dsh silently dropped the
   * name/description/order. The write is temp+rename like the composition
   * write: a hand-edited preset.yml must never be seen half-written.
   * @param {string} id
   * @param {{ name?: string, description?: string, order?: number }=} metadata
   */
  function writeMetadata(id, metadata) {
    const name = typeof metadata?.name === 'string' && metadata.name.trim() !== '' ? metadata.name : id
    const description = typeof metadata?.description === 'string' ? metadata.description : ''
    const order = typeof metadata?.order === 'number' && Number.isFinite(metadata.order) ? metadata.order : 0
    const out = [
      `name: ${JSON.stringify(name)}`,
      `description: ${JSON.stringify(description)}`,
      `order: ${order}`,
      '',
    ].join('\n')
    const metaPath = join(presetDir(id), METADATA_FILENAME)
    const temp = metaPath + '.dsh-admin.tmp'
    writeFileSync(temp, out, 'utf8')
    renameSync(temp, metaPath)
  }

  /**
   * Read the raw composition for one user preset. Empty string when
   * absent (a fresh preset). Preserves `!!js` expressions verbatim.
   * @param {string} id
   */
  function readComposition(id) {
    const compPath = join(presetDir(id), COMPOSITION_FILENAME)
    if (!existsSync(compPath)) return ''
    return readFileSync(compPath, 'utf8')
  }

  /**
   * Validate user-supplied composition text. The shape is the same one
   * dsh's `entryListProblem` enforces: a top-level list whose every row is a
   * map carrying its OWN `name:` string (the plugin name). Groups recurse via
   * their `config` list; nothing else counts as a row name.
   *
   * The scan is key-level aware, so `config: { name: ... }` (a nested key dsh
   * does not accept as the row name) no longer passes while every legal
   * spelling still does: `- name: x`, the dash-only form with keys on the
   * following lines, and a flow map (`- { name: x, id: y }`).
   * @param {string} text
   */
  function validateComposition(text) {
    if (typeof text !== 'string') {
      throw new Error('agentPresetsAdmin: compositionText 必须是字符串')
    }
    const lines = text.split(/\r?\n/)
    let sawEntry = false
    let entryIndent = -1
    let currentHasName = false
    let pendingEntry = false
    const flush = () => {
      if (sawEntry && !currentHasName) {
        throw new Error('agentPresetsAdmin: 每条 plugin 行必须包含 `name:` 字段')
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim() === '' || line.trim().startsWith('#')) continue
      const dash = /^-(\s*)(.*)$/.exec(line)
      if (dash !== null) {
        // Top-level list item (column 0). Nested sequences stay inside an entry.
        flush()
        sawEntry = true
        currentHasName = false
        const rest = dash[2].trim()
        if (rest === '') {
          pendingEntry = true
          entryIndent = -1
        } else {
          pendingEntry = false
          entryIndent = 1 + dash[1].length
          currentHasName = rest.startsWith('{')
            ? flowMapHasName(rest)
            : /^name:\s*\S/.test(rest)
        }
        continue
      }
      if (!sawEntry) continue
      const indent = (/^\s*/.exec(line) ?? [''])[0].length
      if (pendingEntry) {
        entryIndent = indent
        pendingEntry = false
      }
      if (indent === entryIndent && /^name:\s*\S/.test(line.trim())) currentHasName = true
    }
    flush()
    if (!sawEntry) {
      throw new Error('agentPresetsAdmin: 至少需要一条 plugin 行（以 `- name: ...` 起首）')
    }
  }

  /**
   * Real display metadata for the SHIPPED presets, read through the live
   * `agentPresets` service (`ctx.agentPresets.list()` carries each preset's
   * own `name` / `description` from its preset.yml). The filesystem copy
   * under the harness tree is not addressed by the plugin, so without the
   * service the roster falls back to the static id + fixed copy.
   * @returns {Map<string, { name: string|null, description: string|null }>}
   */
  async function shippedMetaOf() {
    const map = new Map()
    try {
      const presets = ctx.get('agentPresets')
      if (presets !== null && presets !== undefined && typeof presets.list === 'function') {
        const raw = await presets.list()
        if (Array.isArray(raw)) {
          for (const entry of raw) {
            if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
            if (!SHIPPED_PRESET_IDS.has(entry.id)) continue
            map.set(entry.id, {
              name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : null,
              description: typeof entry.description === 'string' && entry.description !== '' ? entry.description : null,
            })
          }
        }
      }
    } catch { /* absent service or shape drift — the static copy stands in */ }
    return map
  }

  /**
   * List every preset id that should appear on the roster — shipped
   * presets (read-only) + user presets under `.agent-presets/`. The set
   * is the union: shipped ids come first, then user ids, sorted.
   */
  function listPresetIds() {
    const userIds = existsSync(userPresetRoot())
      ? readdirSync(userPresetRoot(), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((name) => PRESET_ID_PATTERN.test(name))
      : []
    const allIds = new Set([...SHIPPED_PRESET_IDS, ...userIds])
    return [...allIds]
  }

  /**
   * Read the active default id. Order of preference:
   *   1. `ctx.agentPresets.defaultId` if the agent-presets service is
   *      mounted (live value, post-settings-service writes).
   *   2. The `agent-presets` row's `config.default` in the profile
   *      patch. Tolerates both block-scalar and inline `{...}` config
   *      shapes.
   *   3. Empty string when neither tells us.
   */
  function readDefault() {
    try {
      const presets = ctx.get('agentPresets')
      if (presets !== null && presets !== undefined && typeof presets.defaultId === 'string') {
        return presets.defaultId
      }
    } catch { /* absent service — fall through */ }
    const dir = profileDir()
    if (dir === null) return ''
    const { lines } = readPatchLines(dir)
    const span = findRowSpan(lines, CORDIS_AGENT_PRESETS_ROW_ID)
    if (span === null) return ''
    const block = lines.slice(span.start, span.end)
    let inConfig = false
    let configInlineOpen = false
    for (let i = 0; i < block.length; i++) {
      const line = block[i]
      if (/^\s*config:\s*/.test(line)) {
        const inline = line.replace(/^\s*config:\s*/, '').trim()
        configInlineOpen = inline.startsWith('{')
        inConfig = true
        // Inline shape: parse and bail out in one pass.
        if (configInlineOpen) {
          const m = /^\s*config:\s*\{(.*)\}\s*$/.exec(line)
          if (m !== null) {
            for (const part of m[1].split(',')) {
              const kv = part.split(':')
              if (kv.length === 2) {
                const k = kv[0].trim().replace(/^['"]|['"]$/g, '')
                const v = kv[1].trim().replace(/^['"]|['"]$/g, '')
                if (k === 'default') return v
              }
            }
            inConfig = false
          }
        }
        continue
      }
      if (!inConfig) continue
      const m = /^\s*default:\s*(\S.*?)\s*$/.exec(line)
      if (m !== null) {
        const v = yamlScalar(m[1])
        if (typeof v === 'string') return v
      }
    }
    return ''
  }

  /**
   * Write `config.default: <value>` to the profile's `agent-presets`
   * row. If the row doesn't yet exist in the user profile patch, a
   * minimal row (id + config.default) is appended — the user layer
   * composes with whatever bundle layer authored the base config.
   * @param {string} value
   */
  function writeDefault(value) {
    const dir = profileDir()
    if (dir === null) {
      throw new Error('agentPresetsAdmin: 当前没有活跃的 profile（dsh 未启动？）')
    }
    const { lines, patchPath } = readPatchLines(dir)
    const span = findRowSpan(lines, CORDIS_AGENT_PRESETS_ROW_ID)
    const scalarValue = value === '' ? "''" : value
    if (span === null) {
      const block = [
        `- id: ${CORDIS_AGENT_PRESETS_ROW_ID}`,
        `  config:`,
        `    default: ${scalarValue}`,
        '',
      ]
      const next = appendTopLevelBlocks(lines, [block])
      writePatch(patchPath, next)
      return
    }
    const next = mutateDefaultKey(lines, span, scalarValue)
    writePatch(patchPath, next)
  }

  /**
   * Single-key mutation: replace the `default:` line in the
   * `agent-presets` row's config block; insert one if absent. Preserves
   * sibling keys + comments.
   * @param {string[]} lines
   * @param {{ start: number, end: number }} span
   * @param {string} scalarValue - pre-formatted scalar (quoted when empty).
   */
  function mutateDefaultKey(lines, span, scalarValue) {
    const block = lines.slice(span.start, span.end)
    const next = block.slice()
    let configIndex = -1
    let configInline = false
    for (let i = 0; i < next.length; i++) {
      if (/^\s*config:\s*/.test(next[i])) {
        configIndex = i
        const inline = next[i].replace(/^\s*config:\s*/, '').trim()
        configInline = inline.startsWith('{')
        break
      }
    }
    if (configIndex === -1) {
      const insertAt = span.start + 1
      return [
        ...lines.slice(0, insertAt),
        '  config:',
        `    default: ${scalarValue}`,
        ...lines.slice(insertAt),
      ]
    }
    if (configInline) {
      // Inline `config: {...}` — re-emit every sibling key: a patch replaces
      // the target's whole `config`, so dropping them here would silently
      // delete user settings on the next radio click.
      const head = (next[configIndex].match(/^\s*/) ?? ['  '])[0]
      const inlineMatch = /^\s*config:\s*\{(.*)\}\s*$/.exec(next[configIndex])
      const kept = []
      if (inlineMatch !== null) {
        for (const [key, value] of inlineMapEntries(inlineMatch[1])) {
          if (key === 'default') continue
          kept.push(`${head}  ${key}: ${value}`)
        }
      }
      const splice = [
        `${head}config:`,
        `${head}  default: ${scalarValue}`,
        ...kept,
      ]
      const result = next.slice(0, configIndex).concat(splice, next.slice(configIndex + 1))
      return [...lines.slice(0, span.start), ...result, ...lines.slice(span.end)]
    }
    let replaced = false
    for (let i = configIndex + 1; i < next.length; i++) {
      const m = /^\s*default:\s*(\S.*?)\s*$/.exec(next[i])
      if (m !== null) {
        next[i] = next[i].replace(/(\s*default:\s*).*/, `$1${scalarValue}`)
        replaced = true
        break
      }
    }
    if (!replaced) {
      next.splice(configIndex + 1, 0, `    default: ${scalarValue}`)
    }
    return [...lines.slice(0, span.start), ...next, ...lines.slice(span.end)]
  }

  /**
   * The plugin's Typert service. All cross-RPC state lives on the
   * enclosing apply() closure — no module-level mutation.
   */
  const service = {
    /**
     * Snapshot the preset roster + the current default id. Each entry
     * carries `trust: 'user' | 'shipped'`, `editable: boolean`, the
     * display metadata (`name`, `description`, `order`), `isDefault` +
     * `broken` flags.
     *
     * User presets come first, then shipped — `order` then `id`
     * ascending within each trust. The panel uses this for the
     * "🛡 dsh 默认预设" vs editable list split.
     */
    async list() {
      const ids = listPresetIds()
      const defaultId = readDefault()
      const userRoot = userPresetRoot()
      const shippedMeta = await shippedMetaOf()
      const presets = ids.map((id) => {
        const isShipped = SHIPPED_PRESET_IDS.has(id)
        const dirExists = isShipped || existsSync(join(userRoot, id))
        if (!dirExists) {
          return {
            id,
            trust: isShipped ? 'shipped' : 'user',
            editable: false,
            editableReason: '目录不存在',
            name: id,
            description: '',
            order: 0,
            isDefault: defaultId === id,
            broken: true,
          }
        }
        const meta = isShipped
          ? {
              // Real shipped metadata when the live service exposes it; the
              // static id + fixed copy stands in for CLI / headless mounts.
              name: shippedMeta.get(id)?.name ?? id,
              description: shippedMeta.get(id)?.description ?? 'dsh 默认预设（shipped，不可编辑）',
              order: -1,
            }
          : readMetadata(id)
        return {
          id,
          trust: isShipped ? 'shipped' : 'user',
          editable: !isShipped,
          editableReason: isShipped ? 'dsh 默认预设' : '',
          name: meta.name,
          description: meta.description,
          order: meta.order,
          isDefault: defaultId === id,
          broken: false,
        }
      })
      presets.sort((a, b) => {
        if (a.trust !== b.trust) return a.trust === 'user' ? -1 : 1
        if (a.order !== b.order) return a.order - b.order
        return a.id.localeCompare(b.id)
      })
      return { presets, defaultId }
    },

    /**
     * Read one preset's metadata + raw composition text. Throws for
     * shipped presets (caller must check trust first; the panel does).
     * For an unsaved preset id the composition is empty + metadata
     * defaults to `{ name: id, description: '', order: 0 }`.
     */
    async getDocument(id) {
      const safeId = ensureValidId(id)
      const dir = presetDir(safeId)
      return {
        id: safeId,
        metadata: existsSync(dir) ? readMetadata(safeId) : { name: safeId, description: '', order: 0 },
        composition: { raw: readComposition(safeId) },
      }
    },

    /**
     * Idempotent save: writes `preset.yml` + `agent.cordis.yml` for
     * one user preset. Composition is re-validated by shape; metadata
     * overwrites all three keys. Rejects shipped ids.
     */
    async upsert(id, payload) {
      const safeId = ensureValidId(id)
      if (payload === null || typeof payload !== 'object') {
        throw new Error('agentPresetsAdmin: payload 必须是对象')
      }
      const compositionText = typeof payload.compositionText === 'string'
        ? payload.compositionText
        : ''
      validateComposition(compositionText)
      const dir = presetDir(safeId)
      mkdirSync(dir, { recursive: true })
      const compositionPath = join(dir, COMPOSITION_FILENAME)
      const tempComp = compositionPath + '.dsh-admin.tmp'
      const text = compositionText.endsWith('\n') ? compositionText : compositionText + '\n'
      writeFileSync(tempComp, text, 'utf8')
      renameSync(tempComp, compositionPath)
      writeMetadata(safeId, payload.metadata)
      return { id: safeId, ok: true }
    },

    /**
     * Remove one user preset directory. Throws for shipped ids.
     * @returns {{ id: string, removed: boolean }}
     */
    async delete(id) {
      const safeId = ensureValidId(id)
      const dir = presetDir(safeId)
      if (!existsSync(dir)) return { id: safeId, removed: false }
      rmSync(dir, { recursive: true, force: true })
      return { id: safeId, removed: true }
    },

    /**
     * Set the default preset id ('' clears it).
     *
     * The live default is SETTINGS-FIRST — dsh-agent-presets resolves
     * `this.settings?.get().default ?? this.config.default` — so a patch-only
     * write is invisible on any deployment where the user (or the official
     * preset picker) has ever written the settings layer: the panel's choice
     * bounced straight back on the next reload. Write the settings namespace
     * when the service is mounted, and keep the single-key patch mutation as
     * the fallback for profiles without it.
     * @param {string} id
     * @returns { defaultId, layer } where layer is 'settings' | 'patch'.
     */
    async setDefault(id) {
      if (typeof id !== 'string') {
        throw new Error('agentPresetsAdmin: id 必填')
      }
      const value = id.trim()
      if (value !== '' && !PRESET_ID_PATTERN.test(value)) {
        throw new Error(`agentPresetsAdmin: id "${value}" 不符合 kebab-case 命名规则（${PRESET_ID_PATTERN}）`)
      }
      const settings = ctx.get('settings')
      if (settings !== null && settings !== undefined && typeof settings.mutate === 'function') {
        try {
          const ops = value === ''
            ? [{ op: 'unset', path: ['default'] }]
            : [{ op: 'set', path: ['default'], value }]
          await settings.mutate(SETTINGS_NAMESPACE, ops)
          return { defaultId: value, layer: 'settings' }
        } catch {
          // No settings provider / namespace for this deployment: the patch
          // layer is the only writable home for the choice.
        }
      }
      if (value === '') {
        // An empty string is not a preset id: writing it into the patch would
        // resolve to `agent-preset/not-found` for every session that relies on
        // the default. Refuse instead of poisoning the row.
        throw new Error('agentPresetsAdmin: 清空默认预设需要 settings 服务（当前部署未挂载）')
      }
      writeDefault(value)
      return { defaultId: value, layer: 'patch' }
    },
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, 'plugin-admin/agentPresetsAdmin: provide')

  return agentPresetsInvocations
}

/**
 * Whether a YAML flow-map row (`{ name: x, id: y }`) carries its own `name:`
 * key. Only the top level of the braces is inspected — a nested `config: {…}`
 * value must not satisfy the row-name requirement.
 * @param {string} text - the row text after the `- ` indicator.
 * @returns {boolean}
 */
function flowMapHasName(text) {
  const inner = text.replace(/^\{/, '').replace(/\}\s*$/, '')
  let depth = 0
  let quote = null
  let entry = ''
  const entries = []
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      entry += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      entry += ch
      continue
    }
    if (ch === '{' || ch === '[') depth++
    if (ch === '}' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      entries.push(entry)
      entry = ''
      continue
    }
    entry += ch
  }
  entries.push(entry)
  return entries.some((part) => /^\s*name\s*:\s*\S/.test(part))
}
