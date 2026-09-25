/**
 * Plugin runtime inventory host half.
 *
 * dsh exposes a Loader-runtime inventory through `ctx.pluginInventory` —
 * a Typert Remote-only service that reports each loaded plugin entry's
 * identifier, module specifier, effective enablement, and live Fiber
 * phase (pending / loading / active / failed / unloading / null when
 * no live root Fiber exists). When an agent-preset roster is composed
 * in the deployment, the snapshot also flattens each preset's plugin
 * composition (entry id, module specifier, enablement, fiberPhase per
 * row, plus `broken` when a preset file failed to parse).
 *
 * The web-app bundle mounts `@deepseek-ai/dsh-host-plugin-inventory`
 * by default; the base CLI bundle does not. In deployments without
 * the service the panel must gracefully render an "inventory
 * unavailable" hint instead of failing the whole panel mount.
 *
 * Security posture:
 *   - Read-only by construction. The inventory cannot mutate plugins
 *     (no enable/disable/add/remove); the plugin's existing
 *     pluginAdmin/setEnabled keeps authoring profile-layer disable
 *     rows as before.
 *   - The `condition` field of preset rows carries raw `!!js`
 *     expressions; we drop it at this boundary and render the boolean
 *     outcome only — surfacing the raw expression would let a viewer
 *     copy it into a context where it is never meant to be evaluated.
 *
 * Zero dsh imports on purpose: everything rides the live Cordis
 * context by service key.
 */

const SERVICE_KEY = 'pluginInventoryAdmin'
const NAMESPACE = 'pluginInventoryAdmin'
const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

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
export function pluginInventoryInvocations() {
  return [
    descriptor('pluginInventory/list', 'list', []),
  ]
}

/**
 * Mount the pluginInventoryAdmin service onto ctx.
 *
 * @param {object} ctx - host context.
 * @returns {() => Array} pluginInventoryInvocations().
 */
export function applyPluginInventoryAdmin(ctx) {
  /**
   * Resolve the host inventory service if the deployment exposes it.
   * The base CLI bundle does not mount `dsh-host-plugin-inventory`; the
   * web-app bundle does. Either way, the call must not throw — the
   * panel treats absence as a structured "unavailable" answer.
   * @returns the host service object, or null when absent.
   */
  const inventoryService = () => {
    try {
      const svc = ctx.get('pluginInventory')
      return svc && typeof svc.list === 'function' ? svc : null
    } catch {
      return null
    }
  }

  const service = {
    /**
     * Read one point-in-time snapshot of the Loader's current plugin
     * composition. Never throws. Three outcomes are distinguished so the panel
     * can tell a deployment without the service (base CLI bundle — expected,
     * not an error) from a live service that failed to answer (a real fault):
     *
     *   - `{ available: true, entries, agentPresets }` — snapshot read;
     *   - `{ available: false, reason: 'service-absent' }` — no service here;
     *   - `{ available: false, reason: 'call-failed', error }` — it threw.
     * @returns { available, reason?, error?, entries, agentPresets }
     */
    async list() {
      const svc = inventoryService()
      if (svc === null) {
        return { available: false, reason: 'service-absent', entries: [], agentPresets: [] }
      }
      let snapshot = null
      try {
        snapshot = await svc.list()
      } catch (error) {
        return {
          available: false,
          reason: 'call-failed',
          error: error instanceof Error ? error.message : String(error),
          entries: [],
          agentPresets: [],
        }
      }
      if (snapshot === null || typeof snapshot !== 'object') {
        return {
          available: false,
          reason: 'call-failed',
          error: 'pluginInventory.list() returned no snapshot',
          entries: [],
          agentPresets: [],
        }
      }
      return {
        available: true,
        entries: Array.isArray(snapshot.entries)
          ? snapshot.entries.map(toEntry).filter((row) => row !== null)
          : [],
        agentPresets: Array.isArray(snapshot.agentPresets)
          ? snapshot.agentPresets.map(toPreset).filter((row) => row !== null)
          : [],
      }
    },
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, 'plugin-admin/pluginInventoryAdmin: provide')

  return pluginInventoryInvocations
}

/**
 * Map one snapshot entry to JSON-safe form. Anything malformed drops
 * to null; the caller filters nulls so the panel never has to defend
 * against partial rows.
 * @param {unknown} entry
 */
function toEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  return {
    entryId: typeof entry.entryId === 'string' ? entry.entryId : null,
    moduleName: typeof entry.moduleName === 'string' ? entry.moduleName : '',
    enabled: entry.enabled === true,
    fiberPhase: normalizePhase(entry.fiberPhase),
  }
}

/**
 * Map one snapshot preset group. The `condition` field of preset rows
 * is intentionally NOT propagated — see the module header for why.
 *
 * `trust` is passed through only when the host actually reports it:
 * dsh 0.1.7 dropped the `trust` field from `AgentPresetPluginGroup`, so
 * on that revision and later it projects as null and the panel omits
 * the badge instead of mislabeling every preset as system-owned.
 * @param {unknown} preset
 */
function toPreset(preset) {
  if (!preset || typeof preset !== 'object') return null
  return {
    id: typeof preset.id === 'string' ? preset.id : '',
    trust: preset.trust === 'user' || preset.trust === 'system' ? preset.trust : null,
    name: typeof preset.name === 'string' && preset.name !== '' ? preset.name : '',
    isDefault: preset.isDefault === true,
    broken: typeof preset.broken === 'string' ? preset.broken : null,
    rows: Array.isArray(preset.rows)
      ? preset.rows.map(toRow).filter((row) => row !== null)
      : [],
  }
}

function toRow(row) {
  if (!row || typeof row !== 'object') return null
  return {
    entryId: typeof row.entryId === 'string' ? row.entryId : null,
    moduleName: typeof row.moduleName === 'string' ? row.moduleName : '',
    enabled: row.enabled === true
      ? true
      : (row.enabled === 'conditional' ? 'conditional' : false),
    fiberPhase: normalizePhase(row.fiberPhase),
  }
}

function normalizePhase(phase) {
  switch (phase) {
    case 'pending':
    case 'loading':
    case 'active':
    case 'failed':
    case 'unloading':
      return phase
    default:
      return null
  }
}