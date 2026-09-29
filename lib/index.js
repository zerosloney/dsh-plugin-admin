/**
 * dsh-plugin-admin host half. Zero dsh imports on purpose: everything rides
 * the live Cordis Context (services by key) and plain-data typert registration.
 *
 * Remote surfaces served by the /api RPC gateway. FOURTEEN namespaces are
 * published in the single `ctx.typert.register()` call near the bottom of this
 * file:
 *
 *   pluginAdmin · sessionAdmin · fsAdmin · mcpAdmin · subagentAdmin ·
 *   commandHookAdmin · projectAdmin · webhookAdmin · cronAdmin ·
 *   overlayAdmin · workspaceAdmin · skillsAdmin · webSearchAdmin · workflowAdmin
 *
 * The numbered notes below describe the load-bearing namespaces and their
 * intent; the per-namespace action lists are illustrative, not exhaustive
 * (pluginAdmin alone also carries checkUpdates/setEnabled, sessionAdmin
 * carries the whole listing/pinning/export surface, …). Grep
 * `<namespace>/<action>` for the full invocation table.
 *
 * 1. Namespace `pluginAdmin`:
 *    - list() → the profile's bundle layers with version/source/removable
 *    - install(spec) → `pnpm add <spec>` in the profile directory, then
 *      reconcile the package.json `dsh.profile.bundles` layer list
 *    - remove(name) → `pnpm remove <name>` + the same reconcile
 *
 * 2. Namespace `sessionAdmin`:
 *    - list() → all persisted sessions with archived/live flags
 *    - archive(sessionId) → mark session as archived in workspace registry
 *    - unarchive(sessionId) → remove from the registry's archived set
 *    - deleteSession(sessionId) → rm the session log directory, detach workspace
 *      accounting, and clear any archived-set entry
 *    - fileStats(sessionId) → the session workspace's live git file-change
 *      stats (files/added/removed + per-file明细), the todo dock footer's
 *      「N 个文件已改 +A -B」 data source
 *
 * 3. Namespace `subagentAdmin` (merged from the former dsh-plugin-subagents
 *    plugin — see lib/subagent-admin.js): named delegation-tool instances and
 *    their external CLI backends, managed as profile cordis.patch.yml rows.
 *
 * 4. Namespace `commandHookAdmin` (merged from the former standalone
 *    dsh-command-hook-admin plugin — see lib/command-hook-admin.js): file-backed
 *    slash commands (live-registered into ctx.commands) and Claude-Code-format
 *    hooks (hooks.json + disable sidecar, bridge hot-restart), plus one-click
 *    install/uninstall of the stock `@deepseek-ai/dsh-hooks-claude-code` bridge
 *    package and its profile patch row.
 *
 * 5. Namespace `webhookAdmin` (see lib/webhook-triggers.js): manage webhook
 *    inbound trigger rules (steer a live session / delegate creation to
 *    @deepseek-ai/dsh-webhook), register an HTTP prefix route
 *    `/webhook-triggers/<ruleId>` for POST delivery, verify per-rule secrets
 *    via `x-webhook-secret` header, and provide one-click install of the
 *    webhook runtime package.
 *
 * 6. Namespace `workspaceAdmin` (see lib/workspace-admin.js): workspace
 *    CRUD over `ctx.workspaceRegistry` — list / create / rename / delete /
 *    insertBefore (registry order) plus per-workspace session attach /
 *    detach / insertSessionBefore and the global archiveSession /
 *    unarchiveSession set. Best-effort native directory picker through the
 *    `directoryPicker` service's CAPABILITY object — the service itself only
 *    declares `capability()`, and `pick()` lives on the native capability
 *    (`browse` capability has none), so duck-typing a `pick` member on the
 *    service silently left picking unavailable everywhere.
 *    Pure registry + picker reads/writes; the web-app bundle mounts both
 *    services by default, the base CLI bundle does not, in which case the
 *    panel gracefully renders "workspace unavailable" instead of failing.
 *
 * 7. Namespace `skillsAdmin` (see lib/skills-admin.js): the merged, read-only
 *    skill roster of this deployment — the registry's global layer (user
 *    directories, bundled plugin skills, runtime registrations) unioned, by
 *    name, with one read per distinct (cwd, agent-preset) scope resolved from
 *    the requested sessions (`ctx.agentPresets.acquireScope` on dsh 0.1.7+ —
 *    a revision lease held only across the read, then disposed — with
 *    `agentPresets.standingKeyFor` as the older-host fallback; either route
 *    composes the preset's standing mount without activating a cold Agent).
 *    Each entry carries name / description / whenToUse / source / provider /
 *    resource location (directory path or url) / the model- and user-invocable
 *    flags / the scope labels it was seen in. Only `snapshot()` / `list()`
 *    (summaries) are called — the body loader `get()` never is — and nothing
 *    is written. Coverage, per-scope failures and the registry's `complete`
 *    flag ride along, so a partial roster can never read as a complete one.
 *
 * 8. Namespace `webSearchAdmin` (see lib/web-search-admin.js): selector +
 *    install/uninstall for the three web-search providers dsh ships in
 *    monorepo (`@deepseek-ai/dsh-web-search-deepseek` / `-exa` /
 *    `-perplexity`). `list()` enumerates known providers with on-disk
 *    installation + active-pair state; `active()` reads the current
 *    `web.config.searchProvider` from `cordis.patch.yml`; `setActive()`
 *    mutates the `web` row's `searchProvider` key in place (preserving
 *    comments + `fetchProvider`); `install()` / `uninstall()` add or
 *    drop both the cordis row AND the npm dependency via the same
 *    `ensureProfileDependency` path used by pluginAdmin / mcpAdmin. The
 *    shipped `deepseek-official` provider is bundled and cannot be
 *    uninstalled by the panel; the picker surfaces a hint, not a
 *    destructive button. `config()` reads one provider's editable Config keys
 *    (paired with the package's own defaults, each marked set / not-set) and
 *    `saveConfig()` writes them: through `settings.mutate` path ops when the
 *    provider registers a dsh settings namespace (live, revision-guarded, so
 *    the redacted view is never restated), otherwise into its
 *    `cordis.patch.yml` row (restart required). Secret fields stay write-only
 *    — a stored API key never crosses back to the browser.
 *
 * 9. Namespace `commandHookAdmin.codexBridgeInstall` /
 *    `commandHookAdmin.codexBridgeRemove` (see lib/command-hook-admin.js):
 *    one-click install/uninstall of the second stock hooks bridge
 *    `@deepseek-ai/dsh-hooks-codex` (Codex-format hooks), a parallel
 *    to the Claude Code-format `hooks/bridgeInstall` pair. Same
 *    `- insert:` shape in `cordis.patch.yml`, same serial queue, same
 *    `pnpm add` / `pnpm remove` flow; the underlying
 *    `hooks.codex.json` file lives next to `<dshHome>/hooks.json` and
 *    is hand-edited (the panel doesn't yet ship a Codex-format editor
 *    surface — that's a follow-up). v1 scope is bridge install/
 *    remove only.
 */

import { join } from 'node:path'
import { applySubagentAdmin } from './subagent-admin.js'
import { applyFsAdmin } from './fs-admin.js'
import { applyMcpAdmin } from './mcp-admin.js'
import { applyPluginAdmin, reconcileBundles, runPnpm } from './plugin-admin.js'
import { applySessionAdmin, isCompactionCheckpointSource, workspaceRegistryOf } from './session-admin.js'
import { createAuditLog } from './audit-log.js'
import { resolvePanelStates } from './panel-ids.js'
import { applyCommandHookAdmin } from './command-hook-admin.js'
import { dshHome, makeSerialQueue, messageOf, profileDirOf } from './patch-utils.js'
import { applyProjectAgents } from './project-agents.js'
import { applyProjectHooks, applyProjectAdmin } from './project-hooks.js'
import { WEBHOOK_HISTORY_CAP_MAX, WEBHOOK_HISTORY_CAP_MIN, applyWebhookAdmin } from './webhook-triggers.js'
import { invocationsFor } from './rpc-manifest.js'
import { applyCronAdmin } from './cron-admin.js'
import { applyOverlayAdmin } from './overlay-admin.js'
import { applyWorkspaceAdmin } from './workspace-admin.js'
import { applySkillsAdmin } from './skills-admin.js'
import { applyWebSearchAdmin } from './web-search-admin.js'
import { applyWorkflowAdmin } from './workflow-admin.js'
import { createUsageLedger, resolveLedgerCap, USAGE_LEDGER_CAP, USAGE_LEDGER_CAP_MAX } from './usage-ledger.js'

/** Services required before this plugin mounts. */
// `workspaceRegistry` is deliberately NOT injected: `@deepseek-ai/dsh-workspace`
// is mounted by the web-app bundle only, so a hard dependency would keep this
// whole plugin (including the project `.agents` command/hook bridges, which do
// not need it) from mounting in CLI / headless / sdk profiles. The registry is
// read optionally through `ctx.get('workspaceRegistry')` and every consumer
// degrades explicitly — see workspaceRegistryOf().
export const inject = ['typert', 'sessionPersistence', 'tools', 'subagents', 'commands', 'shell']

const PACKAGE = 'dsh-plugin-admin'


/* Re-exported from plugin-admin.js (moved there with the pnpm/manifest
 * machinery in the apply() split) so host-check keeps importing the same
 * pure-function surface from lib/index.js. */
export { localSpecPath, assertPnpmOperand, resolveNpmRegistry, fetchLatestVersion, checkPluginUpdate, compareSemver, bundleComposingRowIds, upsertDisableRows, removeDisableRows, pnpmSpawnArgs, shouldIgnoreScripts, withInstallScriptsPolicy, scrubbedPnpmEnv } from './plugin-admin.js'

/* Re-exported from session-admin.js (moved there in the apply() split) so
 * host-check / verify-todo-panel / repro-delete-session keep importing the
 * same layout encoders and git-stat parsers from lib/index.js. */
export { sessionLogDirFor, encodeSegmentOf, projectKeyOf, parseGitStatusZ, parseGitBranch, parseGitNumstat, gitFileStats } from './session-admin.js'

/* Re-exported from mcp-probe.js for the self-check: the MCP tool-result
 * normalizer, the scrubbed probe environment, and the Windows cmd.exe
 * argument escaper are pure functions the host-check drives directly. */
export { normalizeMcpToolResult, scrubbedProbeEnv, escapeCmdArg } from './mcp-probe.js'

/* ========================================================================== */
/*                            Session Admin Logic                             */
/* ========================================================================== */

/**
 * Check the session persistence seam's public members (list / stat / open).
 * These are dsh internals this plugin rides rather than a public API — the
 * check exists so a dsh version change fails loudly at mount instead of
 * silently breaking every session-admin call later. Called from apply().
 * @param persistence - live sessionPersistence service.
 * @throws {Error} naming the exact missing members when incompatible.
 */
function assertPersistenceShape(persistence) {
  const missing = []
  if (typeof persistence?.list !== 'function') missing.push('list')
  if (typeof persistence?.stat !== 'function') missing.push('stat')
  if (typeof persistence?.open !== 'function') missing.push('open')
  if (missing.length > 0) {
    throw new Error(`session-admin: session persistence missing members [${missing.join(', ')}] — dsh version changed?`)
  }
}

/** Maximum live agent handles tracked before LRU eviction kicks in. */
const HANDLE_MAP_CAP = 200

function installAgentHandleCapture(ctx) {
  const handles = new Map()
  const agents = ctx.get('agents')
  if (agents === undefined || typeof agents !== 'object' || agents === null) {
    // The same member shape as the wrapped path: closeSession calls delete() on
    // this object, so a downgraded host must degrade ("restart dsh, then delete")
    // instead of throwing a TypeError out of an unrelated branch.
    return {
      get: () => undefined,
      delete: () => {},
      size: () => 0,
      wrapped: false,
    }
  }

  const originals = []
  const wrap = (service, methodName) => {
    const original = service[methodName]
    if (typeof original !== 'function') return
    const wrapped = function (...args) {
      const result = original.apply(this, args)
      const capture = (handle) => {
        if (handle !== null && typeof handle === 'object'
          && typeof handle.dispose === 'function'
          && typeof handle.agent?.id === 'string') {
          // LRU eviction: a re-capture first drops its old position so Map
          // insertion order tracks recency, then the oldest entry goes when
          // the cap is reached — a long-running host cannot leak handles for
          // sessions that ended through the normal loop dispose path.
          handles.delete(handle.agent.id)
          if (handles.size >= HANDLE_MAP_CAP) {
            const oldest = handles.keys().next().value
            if (oldest !== undefined) handles.delete(oldest)
          }
          handles.set(handle.agent.id, handle)
        }
        return handle
      }
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        return result.then(capture)
      }
      capture(result)
      return result
    }
    try {
      service[methodName] = wrapped
    } catch (error) {
      // A frozen or getter-only service member cannot host the transparent
      // wrapper. Degrade to the restart-required online-delete path with a
      // loud log instead of failing the whole plugin mount — everything else
      // the plugin serves does not depend on the capture.
      ctx.logger?.warn?.(`plugin-admin: cannot wrap agents.${methodName} (${error instanceof Error ? error.message : messageOf(error)}) — online-session close will require a dsh restart`)
      return
    }
    originals.push({ service, methodName, original })
  }

  // create() / resume() are the two public factories that produce AgentHandle
  // values. The loop's config-driven agents call resume() through the same
  // service, so those are captured too.
  wrap(agents, 'create')
  wrap(agents, 'resume')

  // Restore original methods on plugin disposal so the agents service is
  // not left pointing at wrapper closures from an unloaded plugin (HMR /
  // hot-unload safety).
  ctx.effect(() => () => {
    for (const { service, methodName, original } of originals) {
      try { service[methodName] = original } catch {}
    }
    handles.clear()
  }, 'plugin-admin/agent-handle-capture: teardown')

  return {
    wrapped: true,
    get: (sessionId) => handles.get(sessionId),
    delete: (sessionId) => handles.delete(sessionId),
    size: () => handles.size,
  }
}

/* ========================================================================== */
/*                                Config Schema                               */
/* ========================================================================== */

/**
 * The 16 validated keys, in docs/ARCHITECTURE.md 可调配置键 order. Kept beside
 * {@link PASSTHROUGH_CONFIG_KEYS} so the unknown-key report cannot drift from
 * what the resolver actually fills in (host-check asserts they agree).
 */
export const VALIDATED_CONFIG_KEYS = Object.freeze([
  'pnpmTimeoutMs',
  'updateCheckTimeoutMs',
  'updateCheckConcurrency',
  'updateCheckCacheTtlMs',
  'gitTimeoutMs',
  'gitStatsCacheTtlMs',
  'gitDiffMaxChars',
  'sessionSummaryCacheTtlMs',
  'sessionListConcurrency',
  'sessionEventScanCap',
  'sessionSearchLimit',
  'sessionExportEventCap',
  'usageSnapshotIntervalMs',
  'usageLedgerCap',
  // Phase E3: the per-panel switch map (validated by lib/panel-ids.js).
  'panels',
  // Install-time lifecycle scripts: allow (default, parity with `dsh plugin
  // add`) / local-only (scripts only for the operator's own path spec) / deny.
  'installScripts',
])

/**
 * The 14 documented passthrough overrides. They keep their raw values in the
 * resolved config (an absent key stays undefined so each submodule keeps its
 * own historical default) but are type-checked on the same fail-loud contract
 * as the tunables above — a mistyped override must not be silently inert.
 */
export const PASSTHROUGH_CONFIG_KEYS = Object.freeze([
  'commandsDir',
  'hooksPath',
  'disabledPath',
  'codexHooksPath',
  'cronTasksPath',
  'webhookTriggersPath',
  'webhookHistoryPath',
  'auditLogPath',
  'webhookAllowRemote',
  'webhookRateLimit',
  'webhookHistoryCap',
  'projectCommands',
  'projectHooks',
  'projectHooksTrust',
])

/** Union of the two lists: everything a config row may legitimately carry. */
const KNOWN_CONFIG_KEYS = new Set([...VALIDATED_CONFIG_KEYS, ...PASSTHROUGH_CONFIG_KEYS])

/** Unknown keys already reported (one warn per key per process, HMR-safe). */
const REPORTED_UNKNOWN_CONFIG_KEYS = new Set()

/**
 * Resolve the deployment-varying knobs from one config row: every provided
 * value — tunable or documented passthrough override — is validated FAIL-LOUD
 * (a mistyped row must not silently degrade the budget, path or flag it tunes)
 * and absent ones fall back to the historical defaults. Keys outside
 * {@link KNOWN_CONFIG_KEYS} ride through untouched (the Loader hands one row to
 * several readers) and are reported once by {@link warnUnknownConfigKeys}.
 * @param {unknown} raw - the raw config row (absent for a bare patch row).
 * @returns {Record<string, any>} the resolved config with every known tunable filled in.
 * @throws {Error} when a provided value is outside its documented type/range.
 */
export function resolvePluginConfig(raw) {
  /** @type {Record<string, any>} */
  const cfg = raw === undefined || raw === null ? {} : raw
  if (typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error(`plugin-admin: config must be a mapping (got ${JSON.stringify(raw)})`)
  }
  const nonEmptyString = (label, value) => {
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`plugin-admin: config.${label} must be a non-empty string (got ${JSON.stringify(value)})`)
    }
    return value
  }
  const booleanFlag = (label, value) => {
    if (value === undefined) return undefined
    if (typeof value !== 'boolean') {
      throw new Error(`plugin-admin: config.${label} must be a boolean (got ${JSON.stringify(value)})`)
    }
    return value
  }
  const oneOf = (label, value, allowed) => {
    if (value === undefined) return undefined
    if (!allowed.includes(value)) {
      throw new Error(`plugin-admin: config.${label} must be one of ${allowed.map((item) => JSON.stringify(item)).join(' / ')} (got ${JSON.stringify(value)})`)
    }
    return value
  }
  const positiveNumber = (label, value, fallback) => {
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`plugin-admin: config.${label} must be a positive finite number (got ${JSON.stringify(value)})`)
    }
    return value
  }
  const positiveInteger = (label, value, fallback) => {
    const resolved = positiveNumber(label, value, fallback)
    if (!Number.isInteger(resolved)) {
      throw new Error(`plugin-admin: config.${label} must be an integer (got ${JSON.stringify(value)})`)
    }
    return resolved
  }
  // Zero is a MEANINGFUL value for the sweep interval (it disables the
  // background sweep), so it needs its own validator instead of the
  // positive-only one.
  const nonNegativeNumber = (label, value, fallback) => {
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`plugin-admin: config.${label} must be a non-negative finite number (0 disables it) (got ${JSON.stringify(value)})`)
    }
    return value
  }
  // Documented passthrough overrides: same fail-loud contract as the tunables
  // above. The spread below carries their raw values into the result, so an
  // absent key stays undefined (each reader keeps its own historical default)
  // while a mistyped one fails the mount instead of silently doing nothing.
  nonEmptyString('commandsDir', cfg.commandsDir)
  nonEmptyString('hooksPath', cfg.hooksPath)
  nonEmptyString('disabledPath', cfg.disabledPath)
  nonEmptyString('codexHooksPath', cfg.codexHooksPath)
  nonEmptyString('cronTasksPath', cfg.cronTasksPath)
  nonEmptyString('webhookTriggersPath', cfg.webhookTriggersPath)
  nonEmptyString('webhookHistoryPath', cfg.webhookHistoryPath)
  nonEmptyString('auditLogPath', cfg.auditLogPath)
  booleanFlag('webhookAllowRemote', cfg.webhookAllowRemote)
  // Absent stays undefined (the reader keeps its own default); a mistyped value
  // fails the mount, same contract as the other passthrough overrides.
  if (cfg.webhookRateLimit !== undefined) positiveInteger('webhookRateLimit', cfg.webhookRateLimit, 1)
  if (cfg.webhookHistoryCap !== undefined) {
    const cap = positiveInteger('webhookHistoryCap', cfg.webhookHistoryCap, WEBHOOK_HISTORY_CAP_MIN)
    if (cap < WEBHOOK_HISTORY_CAP_MIN || cap > WEBHOOK_HISTORY_CAP_MAX) {
      throw new Error(`plugin-admin: config.webhookHistoryCap must be between ${WEBHOOK_HISTORY_CAP_MIN} and ${WEBHOOK_HISTORY_CAP_MAX} (got ${JSON.stringify(cfg.webhookHistoryCap)})`)
    }
  }
  booleanFlag('projectCommands', cfg.projectCommands)
  booleanFlag('projectHooks', cfg.projectHooks)
  // Phase E3: fail-loud panel switches (unknown id or state stops the mount).
  const panelStates = resolvePanelStates(cfg.panels)
  oneOf('projectHooksTrust', cfg.projectHooksTrust, ['confirm', 'allow-all'])
  const installScripts = oneOf('installScripts', cfg.installScripts, ['allow', 'local-only', 'deny']) ?? 'allow'

  return {
    ...cfg,
    panels: panelStates,
    installScripts,
    pnpmTimeoutMs: positiveNumber('pnpmTimeoutMs', cfg.pnpmTimeoutMs, 5 * 60_000),
    updateCheckTimeoutMs: positiveNumber('updateCheckTimeoutMs', cfg.updateCheckTimeoutMs, 8_000),
    updateCheckConcurrency: positiveInteger('updateCheckConcurrency', cfg.updateCheckConcurrency, 4),
    updateCheckCacheTtlMs: positiveNumber('updateCheckCacheTtlMs', cfg.updateCheckCacheTtlMs, 5 * 60_000),
    gitTimeoutMs: positiveNumber('gitTimeoutMs', cfg.gitTimeoutMs, 5_000),
    gitStatsCacheTtlMs: positiveNumber('gitStatsCacheTtlMs', cfg.gitStatsCacheTtlMs, 3_000),
    gitDiffMaxChars: positiveNumber('gitDiffMaxChars', cfg.gitDiffMaxChars, 512 * 1024),
    sessionSummaryCacheTtlMs: positiveNumber('sessionSummaryCacheTtlMs', cfg.sessionSummaryCacheTtlMs, 60_000),
    sessionListConcurrency: positiveInteger('sessionListConcurrency', cfg.sessionListConcurrency, 4),
    sessionEventScanCap: positiveInteger('sessionEventScanCap', cfg.sessionEventScanCap, 20_000),
    sessionSearchLimit: positiveInteger('sessionSearchLimit', cfg.sessionSearchLimit, 30),
    sessionExportEventCap: positiveInteger('sessionExportEventCap', cfg.sessionExportEventCap, 200_000),
    // Background usage-ledger sweep interval: the dashboard's read is
    // opportunistic, so a session deleted before anyone opened the dashboard
    // would still lose its tokens. The sweep folds the whole session table
    // into the ledger on a timer instead. 0 disables it.
    usageSnapshotIntervalMs: nonNegativeNumber('usageSnapshotIntervalMs', cfg.usageSnapshotIntervalMs, 60 * 60_000),
    // Ledger retention: how many per-session rows survive eviction (oldest
    // lastSeenAt loses). Bounded above so one typo can't wedge the serial
    // queue with a multi-hundred-MB rewrite on every merge.
    usageLedgerCap: (() => {
      const resolved = positiveInteger('usageLedgerCap', cfg.usageLedgerCap, USAGE_LEDGER_CAP)
      if (resolved > USAGE_LEDGER_CAP_MAX) {
        throw new Error(`plugin-admin: config.usageLedgerCap must be <= ${USAGE_LEDGER_CAP_MAX} (got ${resolved})`)
      }
      return resolved
    })(),
  }
}

/**
 * Config keys the row carries that this plugin does not document. A typo is
 * otherwise permanently invisible (a misspelled `commandsDir` simply does
 * nothing), so every unknown key is reported once per process. Reporting is a
 * warning, never a failure: the same row also carries keys other readers own.
 * @param {unknown} raw - the raw config row handed to apply().
 * @param {{ warn?: (message: string) => void }} [logger] - ctx.logger, when present.
 * @returns {string[]} the unknown keys, sorted, for callers that assert on them.
 */
export function warnUnknownConfigKeys(raw, logger) {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
  const unknown = Object.keys(raw).filter((key) => !KNOWN_CONFIG_KEYS.has(key)).sort()
  const fresh = unknown.filter((key) => !REPORTED_UNKNOWN_CONFIG_KEYS.has(key))
  if (fresh.length > 0) {
    for (const key of fresh) REPORTED_UNKNOWN_CONFIG_KEYS.add(key)
    logger?.warn?.(`plugin-admin: unknown config key(s) ignored: ${fresh.join(', ')} — see docs/ARCHITECTURE.md 可调配置键`)
  }
  return unknown
}

/**
 * Config schema in the Standard Schema shape the Loader resolves through
 * (`resolveConfig` in vendor/cordis): an absent row yields the defaults, a
 * mistyped value yields issues that the Loader raises as a ValidationError
 * before the plugin mounts. Hand-written rather than schemastery —
 * `~standard.validate` is the only surface the Loader touches, and staying
 * dependency-free is this package's stance (see patch-utils.js).
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-plugin-admin',
    validate(config) {
      try {
        return { value: resolvePluginConfig(config) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : messageOf(error) }] }
      }
    },
  },
}

/* ========================================================================== */
/*                             Plugin Main Apply                              */
/* ========================================================================== */

/**
 * Mount the unified plugin & session admin remote services and their typert descriptors.
 * @param ctx - plugin context carrying typert, workspaceRegistry, sessionPersistence, commands.
 * @param config - optional plugin config row (the Loader resolves it through
 *   {@link Config} first; a direct caller gets the same resolution here).
 *   Unknown keys pass through — the command-hook admin module honors
 *   `{ commandsDir?, hooksPath?, disabledPath? }` overrides off the same row.
 */
export function apply(ctx, config) {
  const profileDir = profileDirOf(ctx.baseUrl)

  // Config overrides: deployment-varying tunables are validated Config fields
  // changeable from cordis.yml. The Loader resolves them through the exported
  // {@link Config} schema before this runs; resolvePluginConfig() repeats that
  // resolution here so a direct caller (tests, hand-mounted contexts) that
  // bypasses the Loader gets the identical fail-loud contract. The pnpm /
  // update-check budgets live in lib/plugin-admin.js and the session/git
  // budgets in lib/session-admin.js — each applyXxx retunes its own module
  // from this cfg. The remaining knobs (usage ledger, panel states) are read
  // inside this apply() closure.
  warnUnknownConfigKeys(config, ctx.logger)
  const cfg = resolvePluginConfig(config)

  // Older dsh releases (e.g. 0.1.5-rc.2) ship WorkspaceRegistry without the
  // public unarchive verb. That must NOT take the whole plugin down: the
  // delete path skips the archived-set cleanup and the unarchive RPC reports
  // a clear error (see removeFromArchivedSet / sessionAdmin.unarchive). Log a
  // mount-time warning so operators notice the degraded surface. A deployment
  // without the registry at all (CLI / headless — see workspaceRegistryOf)
  // is not a version change: skip the warning entirely.
  const mountRegistry = workspaceRegistryOf(ctx)
  if (mountRegistry !== null && typeof mountRegistry.unarchiveSession !== 'function') {
  ctx.logger?.warn?.('plugin-admin: workspace registry lacks unarchiveSession() — 取消归档与删除时的归档清理将不可用（dsh 版本过旧）')
  }
  // Same loud-fail probe for the persistence seam (list/stat/open).
  assertPersistenceShape(ctx.sessionPersistence)
  // Capture the AgentHandles dsh produces for live agents (see
  // installAgentHandleCapture) so online sessions can be torn down through
  // dsh's official dispose chain before their logs are removed.
  const handleCapture = installAgentHandleCapture(ctx)
  const enqueue = makeSerialQueue()
  // Phase F3: one append-only trail for privileged actions. Every writer below
  // shares this instance, so the file is written through the same serial queue
  // as the patch/JSON stores (no interleaved lines).
  const audit = createAuditLog({ path: cfg.auditLogPath, enqueue })
  // Phase E3: what the browser half asks for at mount (it cannot read this row).
  const panelStates = cfg.panels ?? {}
  // Durable usage ledger for the 用量仪表盘: dsh's own token accounting dies
  // with the session log, so the dashboard kept shrinking whenever history was
  // cleaned up. The ledger keeps one row per session ever seen (see
  // lib/usage-ledger.js) so a deleted session's totals stay in the dashboard.
  const usageLedger = createUsageLedger({
    path: join(dshHome(), 'usage-ledger.json'),
    enqueue,
    // Plugin config row key `usageLedgerCap` (default 2000, clamped to
    // [100, 100000] by resolveLedgerCap) raises how many per-session rows the
    // ledger retains before the oldest `lastSeenAt` is evicted.
    cap: resolveLedgerCap(cfg.usageLedgerCap),
  })

  /* ---------------------- Usage ledger background sweep --------------------- */
  // The dashboard's own read is opportunistic: it only records the sessions
  // that existed while somebody had the panel open, so a session deleted
  // before that still lost its tokens. This sweep folds the WHOLE session
  // table into the ledger on a timer instead, which is what makes retention
  // hold for ordinary cleanup (delete from the sidebar, from the CLI, or from
  // a session that was never opened in the dashboard).
  //
  // Cost is bounded: list() is revision-cached per session, so an idle sweep
  // re-reads nothing and the ledger merge reports `changed: false` (no disk
  // write). Only the very first sweep pays the full read.
  const USAGE_SNAPSHOT_INTERVAL_MS = cfg.usageSnapshotIntervalMs
  /** Grace period before the boot sweep, so it never competes with boot I/O. */
  const USAGE_SNAPSHOT_KICKOFF_MS = 30_000
  /** Re-entrancy guard: a slow sweep must not stack behind its own timer. */
  let usageSweepRunning = false

  /**
   * One sweep: fold every session's usage into the ledger. Never throws (a
   * failed sweep must not take down a timer callback) — the failure is logged
   * and the next tick retries.
   * @returns {Promise<void>}
   */
  async function sweepUsageLedger() {
    if (usageSweepRunning) return
    usageSweepRunning = true
    try {
      const listResult = await sessionService.list()
      await usageLedger.record(listResult.sessions, { protect: observedIds() })
    } catch (error) {
      ctx.logger?.warn?.('plugin-admin: 用量台账后台快照失败：' + messageOf(error))
    } finally {
      usageSweepRunning = false
    }
  }

  if (USAGE_SNAPSHOT_INTERVAL_MS > 0) {
    // unref on both timers: bookkeeping must never keep the dsh host process
    // alive, and the disposers stop them when the row is disabled or unloaded.
    const intervalTimer = setInterval(() => { void sweepUsageLedger() }, USAGE_SNAPSHOT_INTERVAL_MS)
    intervalTimer.unref?.()
    ctx.effect(() => () => { clearInterval(intervalTimer) }, 'plugin-admin: usage ledger sweep')
    const kickoffTimer = setTimeout(
      () => { void sweepUsageLedger() },
      Math.min(USAGE_SNAPSHOT_INTERVAL_MS, USAGE_SNAPSHOT_KICKOFF_MS),
    )
    kickoffTimer.unref?.()
    ctx.effect(() => () => { clearTimeout(kickoffTimer) }, 'plugin-admin: usage ledger kickoff')
  }

  /* ------------------ Usage ledger live event observer ---------------------
   * The sweep bounds the loss window to one interval; this closes it. A
   * session created, used, and deleted inside that window would otherwise be
   * gone before any read touched it.
   *
   * The harness exposes the per-append firehose (`session/event`), which beats
   * watching $DSH_HOME/sessions outright: it fires AT APPEND TIME (no
   * debounce-vs-delete race, no re-deriving the log path, no parsing a
   * compressed log), and it carries the event payload directly.
   *
   * Ownership rule: only a session whose WHOLE log this process observed is
   * accumulated — `session.firstLiveSeq === 0` at announce time means the log
   * had no seed, so the accumulator IS the session's absolute total. A resumed
   * session carries history we never saw and stays read-owned (the sweep and
   * the dashboard read cover it). Because both writers store ABSOLUTE numbers,
   * no interleaving of read and firehose can double count.
   */
  /** sessionId → the session's absolute usage row, for sessions seen from seq 0. */
  const observedUsage = new Map()
  /** Debounce before an accumulated row reaches the ledger (and the disk). */
  const USAGE_EVENT_FLUSH_MS = 2_000
  /** Observed sessions kept per process; the oldest is dropped past this. */
  const USAGE_OBSERVED_CAP = 500
  /** @type {Record<string, any>|null} */
  let usageEventTimer = null

  /** Queue one debounced flush (a burst of events costs ONE ledger write). */
  function scheduleUsageFlush() {
    if (usageEventTimer !== null) return
    usageEventTimer = setTimeout(() => {
      usageEventTimer = null
      void flushObservedUsage()
    }, USAGE_EVENT_FLUSH_MS)
    usageEventTimer.unref?.()
  }

  /**
   * Write every DIRTY observed session's absolute usage row through the
   * ledger. Partial upsert semantics (`markAbsent: false`): the firehose says
   * nothing about sessions it did not see, so it must never retain them.
   *
   * Only rows that changed since the last successful flush are written, which
   * is what keeps a later flush from resurrecting a session the read path has
   * already flagged `deleted: true` (and keeps an idle process from rewriting
   * the file on every turn boundary).
   * @returns {Promise<void>}
   */
  async function flushObservedUsage() {
    const dirty = []
    for (const row of observedUsage.values()) if (row.dirty === true) dirty.push(row)
    if (dirty.length === 0) return
    try {
      await usageLedger.upsert(dirty)
      for (const row of dirty) row.dirty = false
    } catch (error) {
      // Best-effort: the session log still holds the numbers, so the next
      // sweep (or dashboard read) recovers them. `dirty` stays set, so the
      // next flush retries.
      ctx.logger?.warn?.('plugin-admin: 用量台账事件写入失败：' + messageOf(error))
    }
  }

  /**
   * Ids the live event observer owns. A read must not overwrite their numbers
   * with the log's (possibly older, and cap-truncated) fold — see the
   * ownership rule above.
   * @returns {Set<string>}
   */
  function observedIds() {
    return new Set(observedUsage.keys())
  }

  /**
   * Fold one appended event into its session's accumulator. Unknown sessions
   * are ignored on purpose — they are read-owned (see the ownership rule).
   * @param {Record<string, any>} session - the emitting Session.
   * @param {Record<string, any>} event - the appended SessionEvent ({ type, seq, time, data }).
   */
  function foldUsageEvent(session, event) {
    const row = observedUsage.get(session.id)
    if (row === undefined) return
    if (event.type === 'assistant/message') {
      row.assistantCount += 1
      const usage = event.data?.usage
      if (usage !== null && typeof usage === 'object') {
        row.tokens.input += Number(usage.inputTokens) || 0
        row.tokens.output += Number(usage.outputTokens) || 0
        row.tokens.cacheRead += Number(usage.cacheReadTokens) || 0
        row.tokens.cacheWrite += Number(usage.cacheWriteTokens) || 0
      }
    } else if (event.type === 'user/message') {
      // Same compaction-checkpoint exclusion as deriveSessionSummary: a
      // checkpoint replaces shadowed history instead of adding a turn. dsh
      // 0.1.7 gave compaction its OWN source kind (`compact-checkpoint`);
      // logs written by older hosts carry the retired generic wrapper
      // {kind:'plugin', plugin:'compact'} — exclude both.
      const source = event.data?.source
      if (isCompactionCheckpointSource(source)) return
      row.messageCount += 1
    } else if (event.type === 'session/title') {
      const title = event.data?.title
      if (typeof title !== 'string' || title.trim() === '') return
      row.title = title.trim()
    } else {
      return
    }
    row.dirty = true
    scheduleUsageFlush()
  }

  if (typeof ctx.on === 'function') {
    // A throwing observer must never break session creation, appending, or
    // teardown — every callback contains its own failure.
    ctx.on('session/created', (session) => {
      try {
        if (session === null || typeof session !== 'object' || typeof session.id !== 'string') return
        if (observedUsage.has(session.id)) return
        // firstLiveSeq 0 ⇒ the log started empty in this process, so the
        // accumulator will have seen every event the session ever had.
        if (session.firstLiveSeq !== 0) return
        const header = session.header !== null && typeof session.header === 'object' ? session.header : {}
        observedUsage.set(session.id, {
          id: session.id,
          title: '',
          createdAt: Number(header.createdAt) || Date.now(),
          cwd: typeof header.cwd === 'string' ? header.cwd : null,
          workspaceTitle: null,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          messageCount: 0,
          assistantCount: 0,
          dirty: true,
        })
        if (observedUsage.size > USAGE_OBSERVED_CAP) {
          const oldest = observedUsage.keys().next()
          if (!oldest.done) observedUsage.delete(oldest.value)
        }
      } catch {
        /* observation is best-effort; the sweep still covers this session */
      }
    })
    ctx.on('session/event', (session, event) => {
      try {
        if (session === null || typeof session !== 'object' || event === null || typeof event !== 'object') return
        foldUsageEvent(session, event)
      } catch {
        /* a malformed event must not break the append path */
      }
    })
    // Teardown and turn boundaries are the natural drain points: flush BEFORE
    // the log can be removed, so a session deleted right after its last turn
    // is already in the ledger.
    ctx.on('session/disposed', () => { void flushObservedUsage() })
    ctx.on('session/flush', () => { void flushObservedUsage() })
  }

  /* ---------------------- Plugin Admin Remote Service ---------------------- */
  // The pluginAdmin remote + the pnpm/manifest machinery it rides live in
  // lib/plugin-admin.js: applyPluginAdmin retunes that module's budgets from
  // the same cfg and shares this apply's serial queue and audit trail, so its
  // patch writes cannot interleave with the other patch/JSON writers.
  applyPluginAdmin(ctx, { enqueue, audit, cfg, panelStates })

  /* --------------------- Session Admin Remote Service --------------------- */
  // The sessionAdmin remote (revision-cached listing, archive/delete/close
  // teardown, export/health folds, usage projection) lives in
  // lib/session-admin.js. The usage-ledger wiring stays HERE: the live-event
  // observer hooks and the shared sweep clock cross the boundary via deps,
  // and the background sweep below calls the returned service's list().
  const sessionService = applySessionAdmin(ctx, {
    audit,
    handleCapture,
    usageLedger,
    usage: {
      drainObservedUsage: flushObservedUsage,
      observedIds,
      snapshotIntervalMs: USAGE_SNAPSHOT_INTERVAL_MS,
    },
    cfg,
  })

  /* ----------------------- FS Admin Remote Service ------------------------ */
  applyFsAdmin(ctx)



  /* ----------------------- MCP Admin Remote Service ----------------------- */
  // Row-level CRUD over the profile's dsh-mcp-client entries, real handshake
  // probing / tool invocation, and hot-apply of an edited entry's config to
  // the live fiber (lib/mcp-admin.js). Shares this apply's serial queue and
  // audit trail so its patch writes cannot interleave with the other writers.
  applyMcpAdmin(ctx, { enqueue, audit })

  /* ---------------------- Subagent Admin (merged) -------------------------- */
  // Mount the subagentAdmin remote (formerly the standalone dsh-plugin-subagents
  // plugin). It shares this apply's serial queue: mcpAdmin and subagentAdmin
  // both read-modify-write the profile's cordis.patch.yml. The typert registry
  // allows ONE registration per package name, so the subagent invocations ride
  // the unified descriptor below instead of registering their own.
  const subagentInvocations = applySubagentAdmin(ctx, enqueue, { audit })

  /* -------------------- Command & Hook Admin (merged) --------------------- */
  // Mount the commandHookAdmin remote (formerly the standalone
  // dsh-command-hook-admin plugin): live slash commands + hooks.json
  // management, plus one-click install/uninstall of the stock hooks bridge
  // package. Bridge install/remove touches package.json and cordis.patch.yml,
  // so it rides the same serial queue and pnpm runner as pluginAdmin above.
  const commandHookInvocations = applyCommandHookAdmin(ctx, {
    enqueue,
    audit,
    runPnpm,
    reconcileBundles: () => reconcileBundles(profileDir),
    settings: config,
  })

  /* ---------------------- Project .agents Commands ------------------------ */
  // Scoped per-agent registration of <projectRoot>/.agents/commands/*.md
  // (Claude-Code-format markdown commands). No remote surface of its own in
  // M1 — project/list arrives with the panel work.
  applyProjectAgents(ctx, { settings: config })

  /* ------------------------ Project .agents Hooks ------------------------- */
  // Per-session project-level Claude-Code command hooks (.agents/hooks.json,
  // or the hooks key of .agents/settings.json) on the interception points.
  // Requires the shell service for hook execution. applyProjectAdmin mounts
  // the read-only projectAdmin remote the panel's 项目 tab calls.
  applyProjectHooks(ctx, { settings: config })
  const projectInvocations = applyProjectAdmin(ctx)

  /* ---------------------- Webhook Inbound Triggers ------------------------- */
  // HTTP endpoint for POST deliveries, per-rule secret verification, steer
  // existing sessions / delegate creation to dsh-webhook when present.
  const webhookAdminInvocations = applyWebhookAdmin(ctx, {
    enqueue,
    audit,
    runPnpm,
    reconcileBundles: () => reconcileBundles(profileDir),
    settings: config,
  })

  /* ---------------------------- Cron Admin ------------------------------- */
  // Host-level 5-field cron scheduler over the same dsh-home JSON storage
  // model as webhookAdmin. Actions reuse the webhook pipeline (steer a live
  // session, or a SessionRequest the webhook runtime turns into a new
  // session). Fires only while the dsh process is alive; missed fires are
  // not backfilled. Rides the same serial queue so task writes cannot
  // interleave with other patch/JSON writes.
  const cronAdminInvocations = applyCronAdmin(ctx, { enqueue, audit, settings: config })


  /* ---------------------- Runtime Overlay Admin --------------------------- */
  // One-click enablement of full-text session search, which the shipped web
  // composition mounts OFF (base row `openAt: never`). Pure profile-patch
  // writes on the same serial queue.
  const overlayInvocations = applyOverlayAdmin(ctx, { enqueue, audit })

  /* --------------------------- Workspace Admin ---------------------------- */
  // Workspace CRUD + per-workspace session bookkeeping + the global archive
  // set, over the dsh host's `ctx.workspaceRegistry` (`@deepseek-ai/dsh-workspace`).
  // The directory picker rides `ctx.directoryPicker` when one is mounted;
  // CLI / headless deployments fall back to manual path entry on the panel.
  const workspaceInvocations = applyWorkspaceAdmin(ctx, { audit })

  /* ---------------------------- Skills Admin ------------------------------- */
  // The merged, read-only skill roster of this deployment: the registry's
  // global layer unioned, by name, with one read per distinct (cwd,
  // agent-preset) scope resolved from the requested sessions. Mounted by
  // every bundle that mounts `@deepseek-ai/dsh-skill`.
  const skillsInvocations = applySkillsAdmin(ctx)

  /* -------------------------- Web Search Admin ---------------------------- */
  // Selector + install/uninstall for the three dsh web-search providers.
  // Provider activation lives in `cordis.patch.yml`'s `web.config.searchProvider`
  // — the panel mutates that single key in place, then appends/removes the
  // cordis row + npm dependency for opt-in providers. Rides the same serial
  // queue and pnpm runner as pluginAdmin / mcpAdmin so its patch writes and
  // `pnpm add` cannot interleave with theirs.
  const webSearchInvocations = applyWebSearchAdmin(ctx, { enqueue, audit, runPnpm, reconcileBundles: () => reconcileBundles(profileDir) })

  /* ---------------------------- Workflow Engine ---------------------------- */
  // ZCode 风格动态工作流：agent 现场写 TS 脚本 → esbuild 转译 → node:vm realm 执行
  // （JSON 桥 + 同步前缀 vm timeout；与宿主同进程同信任级，不是硬隔离）
  // → 子代理并行 + ctx.jobs 后台运行 + amend/resume + saved 库。subagents 是
  // 硬依赖，缺失时本模块降级（不阻止其余面板）。状态持久化到
  // $DSH_HOME/workflows/runs/，写盘走同一个串行队列。
  const workflowInvocations = applyWorkflowAdmin(ctx, { enqueue, audit })


  /* ---------------------- Typert Descriptors Register ---------------------- */

  ctx.effect(() => ctx.typert.register({
    package: PACKAGE,
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      // pluginAdmin / sessionAdmin / fsAdmin / mcpAdmin: the four namespaces
      // this module owns mount straight from the manifest (Phase D1b) — the
      // descriptor table is the only place their methods are listed.
      ...invocationsFor('pluginAdmin'),
      ...invocationsFor('sessionAdmin'),
      ...invocationsFor('fsAdmin'),
      ...invocationsFor('mcpAdmin'),
      // subagentAdmin (merged from dsh-plugin-subagents)
      ...subagentInvocations,
      // commandHookAdmin (merged from dsh-command-hook-admin)
      ...commandHookInvocations,
      // projectAdmin (project .agents read-only view)
      ...projectInvocations,
      // webhookAdmin (webhook inbound trigger rules)
      ...webhookAdminInvocations(),
      // cronAdmin (host-level cron task scheduler)
      ...cronAdminInvocations,
      // overlayAdmin (one-click full-text search enablement)
      ...overlayInvocations,
      // workspaceAdmin (workspace CRUD + per-session archive/unarchive)
      ...workspaceInvocations(),
      // skillsAdmin (session-addressed skill catalog list)
      ...skillsInvocations(),
      // webSearchAdmin (provider selector + install/uninstall for 3 dsh web-search providers)
      ...webSearchInvocations(),
      // workflowAdmin (dynamic workflow engine: runs lifecycle + saved library)
      ...workflowInvocations(),
    ],
    }), 'plugin-admin: typert descriptors (plugins, sessions, fs, mcp, subagents, commands+hooks, webhooks, overlays, inventory, workspaces, skills, web-search, workflows)')
}

