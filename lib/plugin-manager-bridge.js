/**
 * Delegation to the Host's own plugin manager (P1-A).
 *
 * WHY THIS EXISTS
 * ---------------
 * This plugin has always driven plugin install / remove / enable itself:
 * `runPnpm` → Corepack pin resolution → profile-patch authoring → manifest
 * reconciliation → argv allowlist → win32 `cmd.exe` escaping → cross-process
 * lock → install-script policy. That machinery is careful and well tested, but
 * it is a SECOND implementation of something dsh already ships:
 *
 *   `ctx.pluginManager` (packages/boot/plugin-manager/src/index.ts:287,
 *   `PluginManager extends TypertRemoteService`) exposes installBundle (:835),
 *   removeBundle (:999), updateBundle (:677), setBundleEnabled (:814),
 *   setPluginEnabled (:796), waitForInstall (:972), cancelInstall (:982),
 *   inspect (:566), listVersions (:626), registries (:550) — and reports
 *   progress as host events (`plugin-manager/install-state`, `install-log`,
 *   packages/api/remotes/src/remote-events.ts:48-52) with a finer outcome model
 *   than ours (`ChangeResult.application`: applied / restart-required /
 *   overridden / failed / cancelled, types.ts:154-184).
 *
 * Every risk this plugin accumulated around pnpm lives in that duplication:
 * the pinned-manager parse (C-2), the cmd.exe argument surface (C-3), the
 * install-script policy (C-8), the lock timeout (C-9). Delegating retires all
 * four for the delegation path without deleting the fallback.
 *
 * THE FALLBACK IS NOT DEAD CODE
 * -----------------------------
 * `@deepseek-ai/dsh-sdk-minimal` ships a complete Cordis tree without
 * pluginManager (see the sdk-minimal patch header), and the CLI/headless
 * profiles are thinner still. A deployment without it must keep working, so
 * every function here answers `null` for "not delegable" and the caller keeps
 * its own path. This is the same posture as lib/host-seams.js: probe, then
 * degrade — never assume.
 *
 * WHAT IS *NOT* DELEGATED (deliberately)
 * -------------------------------------
 * - `list()`: our panel renders profile-patch rows (bundle → row ids →
 *   disabled state), which is a different projection from the host's
 *   `pluginInventory/list`. Switching the list would change what the panel
 *   shows, and the two are not equivalent. The bridge only takes over the
 *   WRITE verbs.
 * - `checkUpdates()`: the host has `listVersions` per bundle, but our panel
 *   batches every bundle behind one TTL cache and one registry resolver.
 *   Rewriting it is a separate change; it is read-only either way.
 *
 * Zero dsh imports: the service is read through ctx.get() and every call is
 * shape-checked before use.
 *
 * @module dsh-plugin-admin/plugin-manager-bridge
 */

/**
 * Read the host plugin manager, or null when this deployment has none.
 * @param {any} ctx - plugin context (duck-typed).
 * @returns {Record<string, any>|null}
 */
export function pluginManagerOf(ctx) {
  if (ctx === null || ctx === undefined) return null
  let service
  try {
    service = typeof ctx.get === 'function' ? ctx.get('pluginManager') : undefined
  } catch {
    // A real Cordis context throws when the service is absent and not injected;
    // that is "not available here", the same verdict as undefined.
    return null
  }
  if (service === undefined || service === null || typeof service !== 'object') return null
  return service
}

/**
 * Whether the host manager exposes every verb this bridge needs.
 *
 * Checked as a set rather than per call so a partially-shaped service (an older
 * dsh that ships pluginManager without, say, `updateBundle`) is treated as "not
 * delegable" instead of failing mid-operation after the user already confirmed.
 * @param {Record<string, any>|null} service - from {@link pluginManagerOf}.
 * @param {readonly string[]} members - the verbs this operation needs.
 * @returns {boolean}
 */
export function pluginManagerHas(service, members) {
  if (service === null || service === undefined) return false
  return members.every((member) => typeof service[member] === 'function')
}

/** The verbs each write path needs. Kept beside the callers' use so a missing
 * one is a "do not delegate" answer, not a runtime surprise. */
export const DELEGATION_MEMBERS = Object.freeze({
  install: Object.freeze(['installBundle']),
  remove: Object.freeze(['removeBundle']),
  setBundleEnabled: Object.freeze(['setBundleEnabled']),
  setPluginEnabled: Object.freeze(['setPluginEnabled']),
})

/**
 * Normalize one host `ChangeResult` into the shape this panel's RPC already
 * returns, so delegating does not change the browser half.
 *
 * The panel's `install`/`remove` answer is `{ output, compat, plugins,
 * profileDir }` (see applyPluginAdmin). A delegated call has no pnpm text to
 * show, so `output` carries a readable summary of what the host reported —
 * including `application`, which is the host's own word for whether the change
 * took effect or needs a restart. `compat` is `null`: the host performed its
 * own compatibility gate before installing (plugin-compatibility.ts), so
 * restating it here would be a second, weaker opinion.
 * @param {Record<string, any>} result - the host's ChangeResult.
 * @param {string} verb - 'install' | 'remove' | 'enable' — used in the summary.
 * @returns {{ output: string, compat: null, delegated: true, application: string, warnings: string[], error: string|null }}
 */
export function delegatedOutcome(result, verb) {
  const application = typeof result?.application === 'string' ? result.application : 'unknown'
  const target = typeof result?.target === 'string' ? result.target : ''
  const lines = [
    `dsh plugin-manager ${verb}${target === '' ? '' : ' ' + target} — ${application}`,
  ]
  if (typeof result?.restartReason === 'string') lines.push(`restart required: ${result.restartReason}`)
  if (typeof result?.version === 'string') lines.push(`version ${result.version}`)
  if (typeof result?.bundle === 'string') lines.push(`bundle ${result.bundle}`)
  const warnings = Array.isArray(result?.warnings) ? result.warnings.map((entry) => String(entry)) : []
  for (const warning of warnings) lines.push(`warning: ${warning}`)
  const error = result?.error === undefined || result?.error === null
    ? null
    : String(result.error.message ?? result.error.code ?? result.error)
  if (error !== null) lines.push(`error: ${error}`)
  return {
    output: lines.join('\n'),
    compat: null,
    delegated: true,
    application,
    warnings,
    error,
  }
}

/**
 * Whether a host outcome counts as a failure the RPC should throw on.
 *
 * `overridden` is NOT a failure: the host applied the change but something
 * higher in the composition layer wins (another patch row), which is a fact the
 * user needs to see rather than an exception. `failed` and `cancelled` are.
 * @param {string} application - from a ChangeResult.
 * @returns {boolean}
 */
export function isFailureOutcome(application) {
  return application === 'failed' || application === 'cancelled'
}
