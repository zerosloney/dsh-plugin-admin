/**
 * mcp-admin.js — the mcpAdmin remote (profile MCP client entries).
 *
 * Extracted from lib/index.js's apply() unchanged (the delegation pattern the
 * other subsystems ride): row-level CRUD over the profile patch's
 * `@deepseek-ai/dsh-mcp-client` entries (both row shapes), real handshake
 * probing / tool invocation through lib/mcp-probe.js, and hot-apply of an
 * edited entry's config to the live mcp-client fiber. Shares the caller's
 * serial queue (patch writes) and audit trail; runPnpm / reconcileBundles
 * come from lib/plugin-admin.js so installs cannot interleave with its.
 */
import { auditService } from './audit-log.js'
import { probeMcpServer, validateMcpConfig } from './mcp-probe.js'
import { runPnpm, reconcileBundles } from './plugin-admin.js'
import { PROFILE_PATCH_FILENAME, appendTopLevelBlocks, ensureProfileDependency, harnessLockstepVersion, hotApplyFiberConfig, mutateProfilePatch, profileDirOf, readPatchLines, topLevelBlocks, yamlScalar, messageOf} from './patch-utils.js'
import { inheritSecretFields, maskSecretMap } from './secret-fields.js'

const MCP_SERVICE_KEY = 'mcpAdmin'
const MCP_NAMESPACE = 'mcpAdmin'

/**
 * A `name:` row naming the MCP client plugin, in any of the three YAML
 * spellings this plugin reads (bare, single-quoted, double-quoted). The
 * quotes must MATCH: a YAML parser rejects a mismatched pair, so accepting
 * one here would present dead rows as live MCP entries.
 */
const MCP_NAME_ROW = /^\s*name:\s*(?:'@deepseek-ai\/dsh-mcp-client'|"@deepseek-ai\/dsh-mcp-client"|@deepseek-ai\/dsh-mcp-client)\s*$/

/**
 * Mount the mcpAdmin remote service.
 * @param {Record<string, any>} ctx - plugin context.
 * @param {{ enqueue: (job: () => Promise<any>) => Promise<any>, audit: ReturnType<typeof import('./audit-log.js').createAuditLog> }} deps
 *   - enqueue: the shared serial operation queue (patch writes).
 *   - audit: the privileged-action audit trail.
 * @returns {void}
 */
export function applyMcpAdmin(ctx, { enqueue, audit }) {
  const profileDir = profileDirOf(ctx.baseUrl)

  /**
   * Whether a block is an MCP client entry: its lines contain a `name:` row
   * whose value is the MCP plugin name.
   * @param {string[]} lines - patch file lines.
   * @param {{ index: number, endIndex: number }} block - block span.
   */
  function isMcpBlock(lines, block) {
    for (let i = block.index; i < block.endIndex; i++) {
      if (MCP_NAME_ROW.test(lines[i])) return true
    }
    return false
  }

  /**
   * Every MCP entry in the patch, across BOTH row shapes, in file order.
   *
   * - insert shape (authored by this panel; the loader-compliant one): one
   *   top-level `- insert:` block whose nested item is the entry. Inserting a
   *   NEW entry requires this shape — a bare top-level `- id:` row is an
   *   id-targeted override that the loader silently drops when the base tree
   *   carries no entry with that id, so legacy bare rows (older panel
   *   versions) never composed; they are still read here and upgraded to the
   *   insert shape on their next save.
   * @param {string[]} lines - patch file lines.
   * @returns [{ span, entryLines }] — the owning top-level block span plus
   *   the entry's own lines normalized to bare-shape indentation (legacy
   *   shape as-is; insert shape with the 4-space wrapper indent stripped).
   */
  function mcpEntryViews(lines) {
    const views = []
    for (const block of topLevelBlocks(lines)) {
      if (!isMcpBlock(lines, block)) continue
      if (/^- insert:/.test(lines[block.index])) {
        const inner = lines.slice(block.index + 1, block.endIndex)
          .map(line => (line.startsWith('    ') ? line.slice(4) : line))
        // A hand-edited insert block may nest several entries; each `- id:`
        // item at the normalized indent starts one view (all sharing the
        // block span — modifications rebuild the block from every view).
        let start = 0
        for (let i = 1; i <= inner.length; i++) {
          const startsEntry = i < inner.length && /^- id:/.test(inner[i] ?? '')
          if (i === inner.length || startsEntry) {
            const entryLines = inner.slice(start, i)
            if (MCP_NAME_ROW.test(entryLines.find(l => /^\s*name:/.test(l)) ?? '')) {
              views.push({ span: block, entryLines })
            }
            start = i
          }
        }
      } else {
        views.push({ span: block, entryLines: lines.slice(block.index, block.endIndex) })
      }
    }
    return views
  }

  /**
   * Wrap bare-shape entry lines in the loader-compliant `- insert:` block.
   * @param {string[]} entryLines - bare-shape entry lines (from {@link mcpEntryLines}).
   * @returns the full top-level block lines.
   */
  function mcpInsertBlockLines(entryLines) {
    return ['- insert:', ...entryLines.map(line => (line === '' ? line : '    ' + line))]
  }

  /**
   * Extract the entry id (`- id: <id>`) and serverName from normalized entry
   * lines (bare shape; see {@link mcpEntryViews}).
   * @param {string[]} entryLines - normalized entry lines.
   * @returns {{id: any, serverName: any}} with nulls when absent.
   */
  function blockIdentity(entryLines) {
    /** @type {string|null} */
    let id = /** @type {any} */ (null)
    /** @type {string|null} */
    let serverName = /** @type {any} */ (null)
    for (const line of entryLines) {
      const idMatch = /^-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
      if (idMatch) id = idMatch[1]
      const nameMatch = /^\s*serverName:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
      if (nameMatch) serverName = nameMatch[1]
    }
    return { id, serverName }
  }

  /** Parse the supported MCP config shape without rewriting unknown blocks.
   * @param {string[]} entryLines - normalized entry lines.
   */
  function configFromBlock(entryLines) {
    // Indexed by the key being parsed (args / env / headers / reconnect) and by
    // scalar fields; a bare {} would reject every write under the null track.
    const config = /** @type {Record<string, any>} */ ({})
    /** @type {string|null} */
    let collection = /** @type {any} */ (null)
    for (const line of entryLines) {
      const field = /^    (transport|serverName|command|url|cwd|toolCallTimeoutMs|maxInstructionBytes|failOnStartupError|args|env|headers|reconnect):\s*(.*)$/.exec(line)
      if (field) {
        const key = field[1]
        const value = field[2]
        if (key === 'args') {
          config.args = []
          collection = 'args'
        } else if (key === 'env' || key === 'headers' || key === 'reconnect') {
          config[key] = {}
          collection = key
        } else {
          config[key] = yamlScalar(value)
          collection = null
        }
        continue
      }
      const item = /^      -\s*(.*)$/.exec(line)
      if (item && collection === 'args') {
        const value = yamlScalar(item[1])
        if (typeof value === 'string') config.args.push(value)
        continue
      }
      const property = /^      ([^:]+):\s*(.*)$/.exec(line)
      if (property && collection && collection !== 'args') {
        config[collection][property[1].trim()] = yamlScalar(property[2])
      }
    }
    if (config.transport === 'stdio' && typeof config.serverName === 'string' && typeof config.command === 'string') return config
    if (config.transport === 'streamable-http' && typeof config.serverName === 'string' && typeof config.url === 'string') return config
    return null
  }

  /**
   * Serialize one MCP entry into YAML lines (the exact shape the mcp-client
   * plugin consumes). The entry id is a stable local handle; serverName is the
   * model-facing namespace.
   * @param {Record<string, any>} entry - normalized MCP entry.
   * @returns YAML lines (without trailing newline).
   */
  function mcpEntryLines(entry) {
    const out = []
    out.push('- id: ' + JSON.stringify(entry.id))
    out.push("  name: '@deepseek-ai/dsh-mcp-client'")
    out.push('  config:')
    out.push('    transport: ' + entry.config.transport)
    out.push('    serverName: ' + JSON.stringify(entry.config.serverName))
    if (entry.config.transport === 'stdio') {
      out.push('    command: ' + JSON.stringify(entry.config.command))
      const args = entry.config.args ?? []
      if (args.length > 0) {
        out.push('    args:')
        for (const a of args) out.push('      - ' + JSON.stringify(a))
      }
      const env = entry.config.env ?? {}
      const envKeys = Object.keys(env)
      if (envKeys.length > 0) {
        out.push('    env:')
        for (const k of envKeys) out.push('      ' + k + ': ' + JSON.stringify(env[k]))
      }
      if (entry.config.cwd) out.push('    cwd: ' + JSON.stringify(entry.config.cwd))
    } else {
      out.push('    url: ' + JSON.stringify(entry.config.url))
      const headers = entry.config.headers ?? {}
      const headerKeys = Object.keys(headers)
      if (headerKeys.length > 0) {
        out.push('    headers:')
        for (const k of headerKeys) out.push('      ' + k + ': ' + JSON.stringify(headers[k]))
      }
    }
    if (entry.config.toolCallTimeoutMs !== undefined) {
      out.push('    toolCallTimeoutMs: ' + Number(entry.config.toolCallTimeoutMs))
    }
    // dsh's Config accepts this byte cap on BOTH transports (a positive
    // integer); emit it only in that shape so a stray non-numeric value can
    // never re-enter the YAML as something the host schema would reject.
    if (Number.isInteger(entry.config.maxInstructionBytes) && entry.config.maxInstructionBytes > 0) {
      out.push('    maxInstructionBytes: ' + entry.config.maxInstructionBytes)
    }
    if (entry.config.failOnStartupError === true) {
      out.push('    failOnStartupError: true')
    }
    if (entry.config.reconnect && typeof entry.config.reconnect === 'object') {
      out.push('    reconnect:')
      for (const key of ['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts']) {
        if (entry.config.reconnect[key] !== undefined) {
          out.push('      ' + key + ': ' + JSON.stringify(entry.config.reconnect[key]))
        }
      }
    }
    return out
  }

  /**
   * List the MCP entries currently declared in the profile patch file (both
   * row shapes; legacy bare rows are reported with `legacy: true` so the
   * panel can flag them as not actually mounted).
   * @returns {{entries: any, patchPath: any}}.
   */
  /**
   * Replace every value of a string map with `''`, keeping its keys. Used by
   * {@link listMcpEntries}: an MCP entry's `env` / `headers` are exactly where a
   * third-party API key lives, and possession of one is enough to use that
   * service — so the browser receives the KEY SET only, never a value. The same
   * contract the webhook rule editor has for its secret, and the same one
   * web-search uses for `kind: 'secret'` fields.
   * @param {Record<string, string>} map - the stored map.
   * @returns {Record<string, string>} the same keys, every value ''.
   */
  function maskStringMapValues(map) {
    return maskSecretMap(map)
  }

  /**
   * Inherit the STORED value for every `env` / `header` key the caller sent
   * empty, and for those keys only. This is the write half of
   * {@link maskStringMapValues}: because the payload never carried a stored
   * value, an empty one can only mean "leave it as it is" — without this the
   * first save from the panel would wipe every configured key. Removing a key
   * stays expressible by omitting it from the map entirely (which is what the
   * editor does when the line is deleted).
   * @param {Record<string, any>} cfg - the incoming (validated) config.
   * @param {Record<string, any>|null} storedCfg - the on-disk entry's config, when it exists.
   * @returns {Record<string, any>} the config to write.
   */
  function inheritStoredSecretValues(cfg, storedCfg) {
    return inheritSecretFields(cfg, storedCfg)
  }

  function listMcpEntries() {
    const { lines, patchPath } = readPatchLines(profileDir)
    const entries = []
    for (const view of mcpEntryViews(lines)) {
      const { id, serverName } = blockIdentity(view.entryLines)
      if (id === null) continue
      const config = configFromBlock(view.entryLines)
      if (config !== null && typeof config === 'object') {
        if (config.env !== undefined) config.env = maskStringMapValues(config.env)
        if (config.headers !== undefined) config.headers = maskStringMapValues(config.headers)
      }
      entries.push({
        id,
        serverName: config?.serverName ?? serverName ?? id,
        config,
        legacy: !/^- insert:/.test(lines[view.span.index] ?? ''),
      })
    }
    return { entries, patchPath }
  }

  /**
   * One entry's config as STORED (env/header values intact). The probe paths
   * (`test` / `callTool`) must use this, not the masked list view: the probe
   * mirrors what the real dsh-mcp-client launches at boot, and a credential-
   * backed server probed with `''` env/auth headers fails a config that is
   * actually fine. Masking stays a projection of list/read responses — the
   * raw config never crosses the RPC boundary, only the probe RESULT does.
   * @param {string} id - MCP entry id.
   * @returns {Record<string, any>|null|undefined} the stored config, or
   *   undefined when no entry carries this id.
   */
  function findStoredMcpEntryConfig(id) {
    const { lines } = readPatchLines(profileDir)
    for (const view of mcpEntryViews(lines)) {
      const { id: entryId } = blockIdentity(view.entryLines)
      if (entryId !== id) continue
      return configFromBlock(view.entryLines)
    }
    return undefined
  }

  /** The plugin package every composed MCP row imports from the profile root. */
  const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

  /**
   * Hot-apply an updated MCP entry config to the live dsh-mcp-client fiber —
   * the loader's own "validate and apply new config, then restart the plugin"
   * path, `hotApplyFiberConfig` (i.e. `fiber.update(config, noSave=true)`), the
   * same seam the hooks bridge restart rides. `noSave=true` because this
   * plugin already authored the patch row, and a host-side save could reformat
   * the file out from under it. The fiber is matched by serverName, which
   * upsert keeps unique across entries, and matched by the entry's PREVIOUS
   * serverName so a rename still finds the running server. Never throws — the
   * outcome rides back to the panel, which claims "无需重启" only when applied.
   * @param {string|null} previousServerName - serverName before this save.
   * @param {Record<string, any>} cfg - the new config (the patch row's config mapping).
   * @returns {Promise<{ applied: boolean, reason?: string }>}
   */
  async function hotApplyMcpEntry(previousServerName, cfg) {
    const fibers = []
    try {
      const registry = ctx.registry
      if (registry === undefined || typeof registry.entries !== 'function') return { applied: false, reason: '宿主 registry 不可用' }
      for (const [, runtime] of registry.entries()) {
        const name = String(runtime?.name ?? '')
        if (name !== 'dsh-mcp-client' && name !== MCP_CLIENT_PACKAGE) continue
        for (const fiber of runtime?.fibers ?? []) {
          if (fiber !== undefined && fiber !== null && typeof fiber.update === 'function') fibers.push(fiber)
        }
      }
    } catch (error) {
      return { applied: false, reason: error instanceof Error ? error.message : messageOf(error) }
    }
    if (fibers.length === 0) return { applied: false, reason: 'dsh-mcp-client 尚未挂载，需重启 dsh 后装载' }
    const fiber = fibers.find((f) => {
      const live = f?.entry?.options?.config ?? f.config
      return live !== null && typeof live === 'object' && live.serverName === previousServerName
    })
    if (fiber === undefined) {
      return { applied: false, reason: `运行中的 server 中未找到 ${previousServerName ?? cfg.serverName}（可能本次启动前尚未装载）` }
    }
    return hotApplyFiberConfig(fiber, cfg)
  }

  const mcpService = {
    async list() {
      return listMcpEntries()
    },

    /** @param {any} entry */
    async upsert(entry) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id === '') {
        throw new Error('mcp-admin: upsert requires an entry with a non-empty id')
      }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(entry.id)) {
        throw new Error('mcp-admin: entry id must match [A-Za-z0-9_-]{1,64}')
      }
      const cfg = entry.config
      if (cfg === null || typeof cfg !== 'object' || typeof cfg.transport !== 'string'
        || (cfg.transport !== 'stdio' && cfg.transport !== 'streamable-http')) {
        throw new Error('mcp-admin: config.transport must be \'stdio\' or \'streamable-http\'')
      }
      if (typeof cfg.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(cfg.serverName)) {
        throw new Error('mcp-admin: serverName must match [A-Za-z0-9_-]{1,32}')
      }
      if (cfg.transport === 'stdio' && (typeof cfg.command !== 'string' || cfg.command === '')) {
        throw new Error('mcp-admin: stdio entries require a command')
      }
      if (cfg.transport === 'streamable-http' && (typeof cfg.url !== 'string' || cfg.url === '')) {
        throw new Error('mcp-admin: streamable-http entries require a url')
      }
      // Nested fields (args/env/headers/cwd/timeouts/reconnect) are validated
      // HERE at the write boundary — the serializer writes whatever it is
      // handed, and dsh's load-time schema would only reject a bad row at the
      // next profile boot.
      validateMcpConfig(cfg)
      // Patch-file mutations ride the same serialized operation queue as
      // pluginAdmin: the body is fully synchronous today (the event loop
      // already serializes it), but the queue keeps the read-modify-write
      // atomic if an await ever lands inside — and the duplicate-serverName
      // check then sees the queue-time file state, not a stale snapshot.
      return enqueue(async () => {
        // A composed MCP row imports `@deepseek-ai/dsh-mcp-client` from the
        // profile root; without the dependency the profile fails to boot the
        // tree. Install it BEFORE authoring the row (the bridgeInstall
        // pattern): a failed install leaves the patch file untouched.
        const dep = await ensureProfileDependency(profileDir, MCP_CLIENT_PACKAGE, runPnpm, () => reconcileBundles(profileDir), harnessLockstepVersion(profileDir))
        const packageInstalled = dep.state === 'installed'
        let effectiveCfg = cfg
        // The duplicate-name check, the entry lookup and the write all judge
        // (and replace) ONE revision — see mutateProfilePatch. The previous
        // serverName rides the outcome because its `target` view does not
        // outlive the callback.
        const outcome = mutateProfilePatch(profileDir, (lines) => {
          const views = mcpEntryViews(lines)
          const duplicateServer = views.find(view => {
            const identity = blockIdentity(view.entryLines)
            return identity.id !== entry.id && identity.serverName === cfg.serverName
          })
          if (duplicateServer !== undefined) {
            throw new Error(`mcp-admin: serverName '${cfg.serverName}' is already used by another MCP entry`)
          }
          // A hand-edited block with unexpected indentation never becomes a
          // view (mcpEntryViews only recognizes the canonical shapes), so the
          // parsed-view check above cannot see its serverName — a save used to
          // land a SECOND row with the same serverName and the host refused to
          // boot the profile ("serverName ... is already in use"). Cross-check
          // the RAW text: every serverName: occurrence not accounted for by a
          // parsed view is an unparsable claim and refuses the write.
          const parsedNames = new Set(views
            .map(view => blockIdentity(view.entryLines).serverName)
            .filter((/** @type {any} */ name) => typeof name === 'string'))
          for (const line of lines) {
            const claimed = /^\s*serverName:\s*['"]?([^'"\s#]+)/.exec(line)
            if (claimed === null || claimed[1] !== cfg.serverName) continue
            if (parsedNames.has(claimed[1])) continue
            throw new Error(`mcp-admin: serverName '${cfg.serverName}' also appears in a hand-edited block this panel cannot parse (unexpected indentation or scalar form) — normalize it in ${PROFILE_PATCH_FILENAME} first, or the profile would fail to boot on the duplicate serverName`)
          }
          const target = views.find(view => blockIdentity(view.entryLines).id === entry.id)
          // The browser never received a stored env/header VALUE (see
          // listMcpEntries), so an empty one means "keep it" — merge before
          // serializing, and validate the merged result (the stored values were
          // validated when they were written, but the invariant is cheap to hold).
          // An EXISTING entry whose config does not parse (unexpected
          // indentation, folded/multi-line scalars — a hand-edited shape) must
          // STOP the write: storedCfg=null would make the merge a no-op and the
          // browser's masked empty env/header values would overwrite the real
          // stored secrets. The .bak keeps the previous revision, but the save
          // would still report success over destroyed credentials — refuse.
          let storedCfg = null
          if (target !== undefined) {
            storedCfg = configFromBlock(target.entryLines)
            if (storedCfg === null) {
              throw new Error(`mcp-admin: entry '${entry.id}' is stored in a hand-edited shape this panel cannot parse (unexpected indentation or scalar form) — the save is refused because a rewrite would erase stored env/header values it cannot read. Normalize or re-create the entry in ${PROFILE_PATCH_FILENAME} directly, then retry.`)
            }
          }
          effectiveCfg = inheritStoredSecretValues(cfg, storedCfg)
          validateMcpConfig(effectiveCfg)
          const entryLines = mcpEntryLines({ ...entry, config: effectiveCfg })
          let next
          if (target !== undefined) {
            // Replace the entry in place. Sibling entries sharing its top-level
            // block (only possible in a hand-edited multi-entry insert block)
            // are rebuilt beside it, in their original order.
            const siblings = views.filter(view => view !== target && view.span === target.span)
              .map(view => mcpInsertBlockLines(view.entryLines))
            const blockLines = siblings.length > 0
              ? [...mcpInsertBlockLines(entryLines), ...siblings.flat()]
              : mcpInsertBlockLines(entryLines)
            next = [...lines.slice(0, target.span.index), ...blockLines, ...lines.slice(target.span.endIndex)]
          } else {
            const blockLines = mcpInsertBlockLines(entryLines)
            // Append after the last entry. The file may carry a header comment
            // plus a '[]' placeholder (an empty YAML list) — a complete document
            // that must be replaced, not appended after (appending produces a
            // second document and a YAML parse error at profile boot). See
            // appendTopLevelBlocks.
            next = appendTopLevelBlocks(lines, [blockLines])
          }
          return {
            next,
            value: {
              existed: target !== undefined,
              previousServerName: target !== undefined ? blockIdentity(target.entryLines).serverName : null,
            },
          }
        }).value
        // Update of an EXISTING entry: hot-apply the new config to the live
        // server fiber so no restart is needed. A NEW entry still needs one —
        // mounting a fresh plugin fiber is the loader's boot job, not
        // something a per-fiber update can do.
        /** @type {{ applied: boolean, reason?: string }} */
        let hot = { applied: false, reason: '新增条目：需重启 dsh 挂载新 server' }
        if (outcome.existed) {
          hot = await hotApplyMcpEntry(outcome.previousServerName ?? cfg.serverName, effectiveCfg)
        }
        return {
          ok: true,
          id: entry.id,
          entries: listMcpEntries().entries,
          hotApplied: hot.applied,
          ...(hot.reason !== undefined ? { hotReason: hot.reason } : {}),
          ...(packageInstalled ? { packageInstalled: true } : {}),
        }
      })
    },

    /** @param {string} id */
    async remove(id) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: remove requires an entry id')
      }
      return enqueue(async () => {
        // Lookup and removal share one critical section, so the entry cannot
        // move between the check and the write (see mutateProfilePatch).
        mutateProfilePatch(profileDir, (lines) => {
          const views = mcpEntryViews(lines)
          const target = views.find(view => blockIdentity(view.entryLines).id === id)
          if (target === undefined) {
            throw new Error(`mcp-admin: entry '${id}' not found in ${PROFILE_PATCH_FILENAME}`)
          }
          // Sibling entries sharing the top-level block survive the removal.
          const siblings = views.filter(view => view !== target && view.span === target.span)
            .map(view => mcpInsertBlockLines(view.entryLines))
          const next = [
            ...lines.slice(0, target.span.index),
            ...siblings.flat(),
            ...lines.slice(target.span.endIndex),
          ].join('\n').trimEnd() + '\n'
          return { next, value: true }
        })
        return { ok: true, id, entries: listMcpEntries().entries }
      })
    },

    /**
     * Probe the connectivity of one configured MCP server (by entry id) from
     * the host, without requiring a dsh restart. The probe mirrors the real
     * dsh-mcp-client handshake (initialize → initialized → tools/list) over
     * the entry's configured transport, with a strict timeout so a dead
     * endpoint fails fast instead of hanging the panel.
     * @param {string} id - MCP entry id.
     * @returns a probe result (never rejects):
     *   { ok: true, serverInfo, toolCount, transport, ms, pingOk? } or
     *   { ok: false, error, transport, ms, stderr? }.
     */
    async test(id) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: test requires an entry id')
      }
      // 未掩码的存储配置：探测必须等价于真实挂载（env/headers 原值），
      // 否则凭据型 server 的「测试连接」永远失败、诊断误导。
      const stored = findStoredMcpEntryConfig(id)
      if (stored === undefined) {
        throw new Error(`mcp-admin: entry '${id}' not found in ${PROFILE_PATCH_FILENAME}`)
      }
      if (stored === null) {
        throw new Error(`mcp-admin: entry '${id}' has an unparsable config; fix ${PROFILE_PATCH_FILENAME} manually`)
      }
      return probeMcpServer(stored)
    },

    /**
     * Invoke one tool on a configured MCP server (by entry id) — the host
     * gesture behind the panel's MCP playground (tools/call after the same
     * initialize → tools/list handshake the probe performs). Rides
     * probeMcpServer's per-call budget, so a dead endpoint fails fast.
     * @param {string} id - MCP entry id.
     * @param {string} tool - tool name to invoke (must be offered by the server).
     * @param {Record<string, any>|undefined} args - tool arguments object (MCP requires an object; {} when omitted).
     * @returns never rejects: {{ ok: true, toolCall: normalized toolCall result }}
     *   or { ok: false, error } (invalid input / unknown entry still throws,
     *   matching test()). FLAT on purpose: the /api gateway already wraps the
     *   return in its own { ok, value } envelope, so a nested { ok, value }
     *   here double-wraps and the panel reads `result.toolCall` off the wrong
     *   layer — success rendered as "没有返回结果".
     */
    async callTool(id, tool, args) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: callTool requires an entry id')
      }
      if (typeof tool !== 'string' || tool === '') {
        throw new Error('mcp-admin: callTool requires a tool name')
      }
      if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
        throw new Error('mcp-admin: callTool args must be a JSON object')
      }
      const stored = findStoredMcpEntryConfig(id)
      if (stored === undefined) {
        throw new Error(`mcp-admin: entry '${id}' not found in ${PROFILE_PATCH_FILENAME}`)
      }
      if (stored === null) {
        throw new Error(`mcp-admin: entry '${id}' has an unparsable config; fix ${PROFILE_PATCH_FILENAME} manually`)
      }
      const probe = await probeMcpServer(stored, { tool, arguments: args === undefined ? {} : args })
      if (!probe.ok || probe.toolCall === undefined) {
        return { ok: false, error: probe.error !== undefined ? probe.error : 'tools/call returned no result' }
      }
      return { ok: true, toolCall: probe.toolCall }
    },
  }

  auditService(mcpService, MCP_NAMESPACE, audit)
  const mcpBinding = Object.freeze({ service: mcpService, serviceKey: MCP_SERVICE_KEY, namespace: MCP_NAMESPACE })
  Object.defineProperty(mcpService, 'typertRemote', { value: mcpBinding, enumerable: false })
  ctx.effect(() => { ctx.provide(MCP_SERVICE_KEY, mcpService) }, 'plugin-admin/mcpAdmin: provide')
}
