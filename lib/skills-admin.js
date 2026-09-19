/**
 * Skills administration host half.
 *
 * dsh exposes a Session-addressed skill catalog via `ctx.sessionSkillCatalog`
 * (a Typert Remote-only service backing `ctx.remote.skills`). Unlike most
 * skill surfaces in the host — which require spinning up an Agent — this
 * catalog reads `cwd` from a Session observation and the agent preset's
 * standing scope, then resolves the per-session skill registry WITHOUT
 * activating a cold Agent. The web-app bundle mounts it by default; the
 * base CLI bundle does not.
 *
 * `list({ sessionId }, signal)` returns user-invocable skill metadata:
 *   - `name`: kebab-case identifier surfaced in the composer as `/name`
 *   - `path`: optional absolute SKILL.md path (filesystem providers only)
 *   - `description`: short routing description
 *   - `whenToUse`: optional extra routing guidance
 *   - `modelInvocable`: whether the model may also invoke the skill
 *
 * Security posture: pure read-only surface. The catalog cannot create,
 * edit, or disable skills — only enumerate them. Skill authoring lives
 * on the filesystem (SKILL.md files in `.agents/skills/<name>/`) and is
 * managed out-of-band. This module renders nothing but the catalog's own
 * metadata; it never copies skill bodies, prompt text, or anything else
 * from the registry.
 *
 * Zero dsh imports on purpose: everything rides the live Cordis context
 * by service key (`sessionSkillCatalog`).
 */

const SERVICE_KEY = 'skillsAdmin'
const NAMESPACE = 'skillsAdmin'
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
export function skillsInvocations() {
  return [
    descriptor('skills/list', 'list', [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'src-json' } },
    ]),
  ]
}

/**
 * Mount the skillsAdmin service onto ctx.
 *
 * @param {object} ctx - host context.
 * @returns {() => Array} skillsInvocations().
 */
export function applySkillsAdmin(ctx) {
  /**
   * Resolve the host session skill catalog if the deployment exposes it.
   * Returns null when the service is absent (base CLI bundle does not
   * mount `dsh-api-session-controller`'s `SessionSkillCatalog` row);
   * `list()` then answers `{ available: false, skills: [] }` so the
   * panel renders the quiet "skills unavailable" hint.
   * @returns the catalog, or null when absent.
   */
  const catalog = () => {
    try {
      const svc = ctx.get('sessionSkillCatalog')
      return svc && typeof svc.list === 'function' ? svc : null
    } catch {
      return null
    }
  }

  const service = {
    /**
     * Read one point-in-time snapshot of the user-invocable skills
     * visible to one Session composition. Mirrors the host-side Remote
     * shape (`{ skills: SkillEntry[] }`) verbatim, but stripped of any
     * fields beyond `name` / `path` / `description` / `whenToUse` /
     * `modelInvocable` — the host's `SkillEntry` already restricts the
     * surface, so the JSON projection is a near-passthrough.
     *
     * Host absence and host rejections both surface as plain errors with
     * the original message attached; the panel renders the rejection
     * inline (`session/not-found`, `gateway/internal`, the catalog's own
     * `skill registry is absent` message). Never throws to the gateway.
     *
     * @param sessionId - identity of the Session whose cwd + agent
     *   preset scope select the catalog view.
     * @returns { available, skills, sessionId }
     */
    async list(sessionId) {
      const svc = catalog()
      if (svc === null) {
        return { available: false, sessionId, skills: [] }
      }
      if (typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw new Error('skills-admin: sessionId 必须是非空字符串')
      }
      const safeId = sessionId.trim()
      let snapshot = null
      try {
        snapshot = await svc.list({ sessionId: safeId }, new AbortController().signal)
      } catch (err) {
        // Re-throw with a clean panel-readable prefix. The gateway
        // envelope preserves the original; this stringifier runs only
        // on the panel boundary.
        throw new Error('skills-admin: ' + (err && err.message ? err.message : String(err)))
      }
      const skills = Array.isArray(snapshot && snapshot.skills) ? snapshot.skills : []
      return {
        available: true,
        sessionId: safeId,
        skills: skills.map(toSkillEntry).filter((row) => row !== null),
      }
    },
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, 'plugin-admin/skillsAdmin: provide')

  return skillsInvocations
}

/**
 * Project one host `SkillEntry` into JSON-safe form for the panel.
 * Anything malformed drops to null; the caller filters nulls so the
 * panel never has to defend against partial rows. The `path` and
 * `whenToUse` fields are optional on the host side — both default to
 * `undefined` here when missing.
 * @param {unknown} entry
 */
function toSkillEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  return {
    name: typeof entry.name === 'string' ? entry.name : '',
    path: typeof entry.path === 'string' && entry.path !== '' ? entry.path : null,
    description: typeof entry.description === 'string' ? entry.description : '',
    whenToUse: typeof entry.whenToUse === 'string' && entry.whenToUse !== '' ? entry.whenToUse : null,
    modelInvocable: entry.modelInvocable === true,
  }
}