/**
 * Skills administration host half.
 *
 * The panel answers "which skills can this deployment see at all?", which the
 * Session-addressed catalog alone cannot answer: `ctx.sessionSkillCatalog`
 * projects ONE Session's composition, filters to user-invocable entries only,
 * and drops every origin field (no path, no source label, no model-only
 * skill).
 *
 * This module reads the skill registry itself
 * (`ctx.skills`, `@deepseek-ai/dsh-skill`) and merges, by name, every skill
 * visible from:
 *
 * - **the global layer** — user directories, plugin-embedded (`bundled`)
 *   skills and runtime registrations, read once WITHOUT a cwd or scope;
 * - **each agent preset's standing scope** — read once per preset through
 *   `ctx.agentPresets.standingKeyFor`, which ensures the preset's standing
 *   mount without starting an agent, a session, or a turn. This is the layer
 *   that matters in a WEB deployment: `@deepseek-ai/dsh-web-app` disables the
 *   host-plane `skill-filesystem` row (presets own local discovery), so the
 *   global read alone legitimately reports ZERO skills while the user
 *   directories live in a preset layer;
 * - **each requested Session's (cwd, agent-preset) scope** — resolved through
 *   `ctx.sessionQuery.observeSession` plus the preset's standing scope key, so
 *   no cold Agent is ever activated. Sessions sharing one (cwd, preset) pair
 *   collapse into a single registry read.
 *
 * Per skill the panel receives name / description / whenToUse / source /
 * provider / resource location (directory path or url) / model- vs
 * user-invocable flags / the scope labels it was seen in. Scope coverage,
 * `complete` flags and per-session failures ride along so an incomplete roster
 * can never be mistaken for a complete one.
 *
 * Security posture: strictly read-only. Only `snapshot()` / `list()` (summaries)
 * are called — `get()` (the body loader) never is, so no SKILL.md content ever
 * crosses this boundary, and nothing is written anywhere. Skill authoring stays
 * on the filesystem. Preset scopes are resolved through
 * `agentPresets.standingKeyFor`, which composes a preset's standing mount
 * without starting an agent, a session, or a turn; it is the supported route
 * for a host reader that has to see a preset layer at all.
 *
 * Zero dsh imports on purpose: everything rides the live Cordis context by
 * service key (`skills`, `sessionQuery`, `agents`, `agentPresets`). The only
 * sibling import is the shared `messageOf` helper.
 */

import { messageOf } from './patch-utils.js'

const SERVICE_KEY = 'skillsAdmin'
const NAMESPACE = 'skillsAdmin'
const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

/** Sessions resolved per `list()` call (the panel sends every known session). */
const MAX_SESSIONS = 32
/** Distinct (cwd, preset) scopes read per `list()` call. */
const MAX_SCOPES = 24
/** Preset standing scopes read per `list()` call. */
const MAX_PRESETS = 8
/** Label of the cwd-less global read (user dirs / bundled / runtime skills). */
const GLOBAL_LABEL = '全局'
/** Label prefix of one agent preset's standing scope. */
const PRESET_LABEL = '预设'

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
      { name: 'sessionIds', wire: 'sessionIds', source: 'json', codec: { mode: 'src-json' } },
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
   * Resolve one optional host service by key and required method. Returns null
   * when the service or the method is absent, so every caller can degrade
   * explicitly instead of throwing through the RPC gateway.
   * @param {string} key - service key.
   * @param {string} method - method that must exist.
   */
  const serviceOf = (key, method) => {
    try {
      const svc = ctx.get(key)
      return svc !== undefined && svc !== null && typeof svc[method] === 'function' ? svc : null
    } catch {
      return null
    }
  }

  /** The skill registry, preferring `snapshot()` (it reports completeness). */
  const registry = () => serviceOf('skills', 'snapshot') ?? serviceOf('skills', 'list')

  /**
   * Read one registry catalog. `snapshot()` is preferred because its
   * `complete` flag distinguishes a partial observation (a provider failed
   * discovery) from a genuinely short roster; `list()` is the fallback for
   * registry revisions without it.
   * @param registrySvc - the registry (or a preset-scoped one).
   * @param options - SkillViewOptions.
   * @returns {{ skills: unknown[], complete: boolean }}
   */
  const readRegistry = async (registrySvc, options) => {
    if (typeof registrySvc.snapshot === 'function') {
      const snapshot = await registrySvc.snapshot(options)
      const skills = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.skills) ? snapshot.skills : []
      return { skills, complete: !(snapshot !== null && typeof snapshot === 'object' && snapshot.complete === false) }
    }
    const skills = await registrySvc.list(options)
    return { skills: Array.isArray(skills) ? skills : [], complete: true }
  }

  /**
   * Resolve one Session's cwd and recorded agent preset without activating a
   * cold Agent. The observation is a disposable resource; it is released here.
   * @param {string} sessionId
   * @returns {{ ok: true, cwd: string|null, preset: string|null } | { ok: false, message: string }}
   */
  const scopeInfoFor = async (sessionId) => {
    const query = serviceOf('sessionQuery', 'observeSession')
    if (query === null) return { ok: false, message: 'sessionQuery 服务不可用（无法解析会话的 cwd / preset）' }
    const observation = await query.observeSession(sessionId)
    try {
      const header = observation !== null && typeof observation === 'object' && observation.header !== null && typeof observation.header === 'object'
        ? observation.header
        : {}
      const cwd = typeof header.cwd === 'string' && header.cwd !== '' ? header.cwd : null
      const values = observation !== null && typeof observation === 'object'
        && observation.projections !== null && typeof observation.projections === 'object'
        && observation.projections.values !== null && typeof observation.projections.values === 'object'
        ? observation.projections.values
        : {}
      const preset = typeof values.agentPreset === 'string' && values.agentPreset !== '' ? values.agentPreset : null
      return { ok: true, cwd, preset }
    } finally {
      try {
        if (typeof Symbol.dispose === 'symbol' && observation !== null && typeof observation === 'object' && typeof observation[Symbol.dispose] === 'function') {
          observation[Symbol.dispose]()
        }
      } catch {
        /* A failed release must not fail the read. */
      }
    }
  }

  /**
   * The preset-scoped skill registry for a live session, when the deployment
   * has one (`agentPresets.serviceFor(live, 'skills')`). Null falls back to the
   * host registry.
   * @param {string} sessionId
   */
  const scopedRegistryFor = (sessionId) => {
    const agents = serviceOf('agents', 'get')
    const presets = serviceOf('agentPresets', 'serviceFor')
    if (agents === null || presets === null) return null
    let live
    try {
      live = agents.get(sessionId)
    } catch {
      return null
    }
    if (live === undefined || live === null) return null
    try {
      return presets.serviceFor(live, 'skills') ?? null
    } catch {
      return null
    }
  }

  /**
   * The viewing scope key for one Session: the live Agent when the session is
   * running, otherwise the recorded preset's standing key. A preset that no
   * longer resolves is REPORTED (`ok: false`) rather than silently degrading
   * to a shallower layer — the caller surfaces it as a scope failure.
   * @param {string} sessionId
   * @param {string|null} preset
   * @returns {{ ok: true, scope: unknown } | { ok: false, message: string }}
   */
  const scopeKeyFor = async (sessionId, preset) => {
    const agents = serviceOf('agents', 'get')
    if (agents !== null) {
      try {
        const live = agents.get(sessionId)
        if (live !== undefined && live !== null) return { ok: true, scope: live }
      } catch {
        /* fall through to the preset key */
      }
    }
    if (preset === null) return { ok: true, scope: undefined }
    const standing = serviceOf('agentPresets', 'standingKeyFor')
    if (standing === null) return { ok: true, scope: undefined }
    try {
      return { ok: true, scope: await standing.standingKeyFor(preset) }
    } catch (error) {
      // A recorded preset that no longer resolves (deleted / renamed file) is
      // a reported failure, not a silent fallback to the cwd-only layer.
      return { ok: false, message: `预设 "${preset}" 无法解析：${messageOf(error)}` }
    }
  }

  /**
   * The agent-preset roster, default first.
   *
   * A deployment whose local discovery is preset-owned (any web profile — see
   * the module header) carries NO skill in its global layer, so the roster is
   * the only way the panel can see the user directories without a live
   * session. Discovery scans the preset roots; the mount happens later, per
   * preset, through `standingKeyFor`. A deployment without the preset plane
   * (a CLI bundle) is reported as `available: false`, which is expected rather
   * than a fault — only a roster that FAILS to read raises a warning.
   * @returns {{ available: boolean, rows: object[], message: string }}
   */
  const readPresetRoster = async () => {
    const presets = serviceOf('agentPresets', 'list')
    if (presets === null) return { available: false, rows: [], message: '' }
    let discovered
    try {
      discovered = await presets.list()
    } catch (error) {
      return { available: false, rows: [], message: '预设清单读取失败：' + messageOf(error) }
    }
    const policy = typeof presets.selectionPolicy === 'function' ? presets.selectionPolicy() : null
    const defaultId = policy !== null && typeof policy === 'object' && typeof policy.defaultId === 'string' ? policy.defaultId : null
    const rows = []
    for (const row of Array.isArray(discovered) ? discovered : []) {
      if (row === null || typeof row !== 'object') continue
      const id = typeof row.id === 'string' && row.id !== '' ? row.id : null
      if (id === null) continue
      rows.push({
        id,
        name: typeof row.name === 'string' && row.name !== '' ? row.name : id,
        broken: typeof row.broken === 'string' && row.broken !== '' ? row.broken : null,
        isDefault: id === defaultId,
      })
    }
    // The default preset is the layer a fresh session joins, so it is the one
    // a reader wants first when the cap bites.
    rows.sort((left, right) => (left.isDefault === right.isDefault ? 0 : left.isDefault ? -1 : 1))
    return { available: true, rows, message: '' }
  }

  /**
   * A preset's standing scope key. Ensures the preset's standing mount (the
   * composition is composed; no agent, session, or turn starts) and returns
   * the key a registry read passes as `scope`.
   * @param {string} id - preset id.
   */
  const standingScopeFor = async (id) => {
    const presets = serviceOf('agentPresets', 'standingKeyFor')
    if (presets === null) throw new Error('agentPresets 服务不可用（无法解析预设作用域）')
    return await presets.standingKeyFor(id)
  }

  /**
   * Read one preset's standing scope into the roster and record its coverage
   * row. A broken or unresolvable preset is REPORTED per scope: dropping it
   * would quietly hide a whole layer while the panel still claimed coverage.
   * @param registrySvc - the host registry.
   * @param map - the by-name roster.
   * @param scopes - the coverage rows.
   * @param preset - one {@link readPresetRoster} row.
   * @returns {boolean} whether the scope's read was complete.
   */
  const readPresetScope = async (registrySvc, map, scopes, preset) => {
    const label = PRESET_LABEL + ' ' + preset.name + (preset.isDefault ? '（默认）' : '')
    const coverage = { label, short: label, kind: 'preset', cwd: null, preset: preset.id, sessionIds: [], count: 0, error: null }
    scopes.push(coverage)
    if (preset.broken !== null) {
      coverage.error = `预设 "${preset.id}" 的组合不可用：${preset.broken}`
      return true
    }
    try {
      const scope = await standingScopeFor(preset.id)
      const result = await readRegistry(registrySvc, { scope })
      coverage.count = mergeCatalog(map, result.skills, label)
      return result.complete
    } catch (error) {
      coverage.error = messageOf(error)
      return true
    }
  }

  /**
   * Merge one catalog into the by-name roster. Later scopes only add what the
   * first occurrence lacked (scope label, missing description/path, the other
   * invocation flag) so one skill seen from several scopes stays ONE card.
   * @param {Map<string, object>} map - name → projected entry.
   * @param {unknown[]} summaries - registry summaries.
   * @param {string} label - scope label the summaries were read under.
   * @returns {number} how many of the catalog's rows were well-formed (the
   * number the scope panel reports — a scope's own count, not a global total).
   */
  const mergeCatalog = (map, summaries, label) => {
    let projected = 0
    for (const summary of Array.isArray(summaries) ? summaries : []) {
      const entry = projectSummary(summary, label)
      if (entry === null) continue
      projected++
      const existing = map.get(entry.name)
      if (existing === undefined) {
        map.set(entry.name, entry)
        continue
      }
      if (!existing.scopes.includes(label)) existing.scopes.push(label)
      if (!existing.sources.includes(entry.source)) existing.sources.push(entry.source)
      if (existing.description === '' && entry.description !== '') existing.description = entry.description
      if (existing.whenToUse === null && entry.whenToUse !== null) existing.whenToUse = entry.whenToUse
      if (existing.provider === null && entry.provider !== null) existing.provider = entry.provider
      if (existing.path === null && entry.path !== null) existing.path = entry.path
      if (existing.url === null && entry.url !== null) existing.url = entry.url
      if (existing.resource === null && entry.resource !== null) existing.resource = entry.resource
      existing.modelInvocable = existing.modelInvocable || entry.modelInvocable
      existing.userInvocable = existing.userInvocable || entry.userInvocable
    }
    return projected
  }

  const service = {
    /**
     * Read the merged roster: every skill the deployment can see, with its
     * origin, location and invocation policy.
     *
     * @param sessionIds - the sessions whose (cwd, preset) scopes enrich the
     * union; the panel sends every session it knows. Omitted / empty still
     * reads the global layer AND every agent preset's standing scope, which is
     * where a web deployment keeps the user directories.
     * @returns {{
     *   available: boolean, registry: boolean, complete: boolean,
     *   skills: object[], scopes: object[], sessions: object[], warnings: string[]
     * }}
     */
    async list(sessionIds) {
      const ids = []
      for (const value of Array.isArray(sessionIds) ? sessionIds : []) {
        if (typeof value !== 'string') continue
        const id = value.trim()
        if (id === '' || ids.includes(id)) continue
        ids.push(id)
      }
      const registrySvc = registry()
      if (registrySvc === null) {
        return {
          available: false,
          registry: false,
          complete: false,
          skills: [],
          scopes: [],
          sessions: [],
          warnings: ['本部署未挂载 @deepseek-ai/dsh-skill（技能注册表不可用）'],
        }
      }

      const map = new Map()
      const scopes = []
      const sessions = []
      const warnings = []
      let complete = true

      // 1. The global layer: user directories, bundled plugin skills, runtime
      // registrations. Read without cwd/scope so it never depends on a session.
      try {
        const result = await readRegistry(registrySvc, {})
        if (!result.complete) complete = false
        const projected = mergeCatalog(map, result.skills, GLOBAL_LABEL)
        scopes.push({ label: GLOBAL_LABEL, short: GLOBAL_LABEL, kind: 'global', cwd: null, preset: null, sessionIds: [], count: projected, error: null })
      } catch (error) {
        warnings.push('全局技能读取失败：' + messageOf(error))
      }

      // 2. Every agent preset's standing scope. This is the layer a WEB
      // deployment keeps its local discovery in — dsh-web-app disables the
      // host-plane `skill-filesystem` row so that presets own local discovery —
      // which makes the global read above legitimately empty while the user
      // directories are live. Reading the roster needs no session, so a
      // deployment with zero sessions still answers with a full catalog.
      const roster = await readPresetRoster()
      if (roster.message !== '') warnings.push(roster.message)
      const presetRows = roster.rows.slice(0, MAX_PRESETS)
      if (roster.rows.length > presetRows.length) warnings.push(`仅读取前 ${MAX_PRESETS} 个预设（共 ${roster.rows.length} 个）`)
      for (const preset of presetRows) {
        if (!(await readPresetScope(registrySvc, map, scopes, preset))) complete = false
      }

      // 3. Group the requested sessions by (cwd, preset) so N sessions sharing
      // one workspace cost ONE registry read. A session scope adds the project
      // directories a preset scope (cwd-less) cannot see.
      const capped = ids.slice(0, MAX_SESSIONS)
      const buckets = new Map()
      for (const sessionId of capped) {
        let info
        try {
          info = await scopeInfoFor(sessionId)
        } catch (error) {
          info = { ok: false, message: messageOf(error) }
        }
        if (!info.ok) {
          sessions.push({ sessionId, ok: false, cwd: null, preset: null, message: info.message })
          continue
        }
        // A session with a preset but no cwd still owns a preset scope: dsh's
        // own tool-skill passes `cwd: undefined` together with `scope`, so the
        // bucket key keeps an explicit empty marker instead of dropping it.
        const key = (info.cwd ?? '') + '\u0000' + (info.preset ?? '')
        let bucket = buckets.get(key)
        if (bucket === undefined) {
          bucket = { cwd: info.cwd, preset: info.preset, sessionIds: [] }
          buckets.set(key, bucket)
        }
        bucket.sessionIds.push(sessionId)
        sessions.push({ sessionId, ok: true, cwd: info.cwd, preset: info.preset, message: '' })
      }

      const bucketList = [...buckets.values()].slice(0, MAX_SCOPES)
      for (const bucket of bucketList) {
        const where = bucket.cwd === null ? '(无 cwd)' : bucket.cwd
        const label = bucket.preset === null ? where : where + ' @ ' + bucket.preset
        // `short` is the display form (last path segment + preset). The host
        // composes it from the (cwd, preset) pair it already holds, so no
        // consumer has to re-parse the label string to shorten a path.
        const short = bucket.preset === null ? baseNameOf(where) : baseNameOf(where) + ' @ ' + bucket.preset
        try {
          // A preset that no longer resolves (deleted / renamed preset file)
          // must NOT silently degrade to a cwd-only read: that would drop a
          // whole preset layer while the panel still reported full coverage.
          const resolved = await scopeKeyFor(bucket.sessionIds[0], bucket.preset)
          if (!resolved.ok) {
            scopes.push({ label, short, kind: 'session', cwd: bucket.cwd, preset: bucket.preset, sessionIds: bucket.sessionIds.slice(), count: 0, error: resolved.message })
            continue
          }
          const scopedSvc = scopedRegistryFor(bucket.sessionIds[0]) ?? registrySvc
          // `cwd: undefined` is legal (dsh's own tool-skill does the same):
          // the scope still selects the preset layer; only the project
          // directories of a cwd are skipped.
          const cwdOption = bucket.cwd === null ? undefined : bucket.cwd
          const options = resolved.scope === undefined ? { cwd: cwdOption } : { cwd: cwdOption, scope: resolved.scope }
          const result = await readRegistry(scopedSvc, options)
          if (!result.complete) complete = false
          const projected = mergeCatalog(map, result.skills, label)
          scopes.push({ label, short, kind: 'session', cwd: bucket.cwd, preset: bucket.preset, sessionIds: bucket.sessionIds.slice(), count: projected, error: null })
        } catch (error) {
          // One unusable scope must not sink the roster: it is reported, and
          // the panel renders it beside the skills that did resolve.
          scopes.push({ label, short, kind: 'session', cwd: bucket.cwd, preset: bucket.preset, sessionIds: bucket.sessionIds.slice(), count: 0, error: messageOf(error) })
        }
      }

      if (ids.length > capped.length) warnings.push(`仅解析前 ${MAX_SESSIONS} 个会话（共 ${ids.length} 个）`)
      if (buckets.size > bucketList.length) warnings.push(`仅读取前 ${MAX_SCOPES} 个 (cwd, preset) 作用域`)

      const skills = [...map.values()].sort((left, right) => left.name.localeCompare(right.name))
      return { available: true, registry: true, complete, skills, scopes, sessions, warnings }
    },
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, 'plugin-admin/skillsAdmin: provide')

  return skillsInvocations
}

/**
 * Project one registry summary into the JSON-safe leaf shape the panel reads.
 * Anything malformed drops to null; the caller filters nulls so the panel never
 * has to defend against partial rows. Only leaf fields are copied — the
 * summary object (and any provider-owned locator it carries) never crosses the
 * RPC boundary.
 * @param {unknown} summary
 * @param {string} label - scope label this summary was read under.
 * @returns {object|null}
 */
function projectSummary(summary, label) {
  if (summary === null || typeof summary !== 'object') return null
  const name = typeof summary.name === 'string' ? summary.name.trim() : ''
  if (name === '') return null
  const invocation = summary.invocation !== null && typeof summary.invocation === 'object' ? summary.invocation : {}
  const base = summary.resourceBase !== null && typeof summary.resourceBase === 'object' ? summary.resourceBase : null
  const kind = base !== null && typeof base.kind === 'string' ? base.kind : null
  const directoryPath = base !== null && kind === 'directory' && typeof base.path === 'string' && base.path !== '' ? base.path : null
  const url = base !== null && kind === 'url' && typeof base.url === 'string' && base.url !== '' ? base.url : null
  // `SkillCandidate` (what a provider returns) also carries a bare `path`;
  // `SkillSummary` prefers resourceBase. Accept either.
  const candidatePath = typeof summary.path === 'string' && summary.path !== '' ? summary.path : null
  const source = typeof summary.source === 'string' && summary.source !== '' ? summary.source : 'unknown'
  return {
    name,
    description: typeof summary.description === 'string' ? summary.description : '',
    whenToUse: typeof summary.whenToUse === 'string' && summary.whenToUse !== '' ? summary.whenToUse : null,
    source,
    sources: [source],
    provider: typeof summary.provider === 'string' && summary.provider !== '' ? summary.provider : null,
    path: directoryPath ?? candidatePath,
    url,
    resource: kind,
    modelInvocable: invocation.modelInvocable === true,
    userInvocable: invocation.userInvocable === true,
    scopes: [label],
  }
}

/**
 * Last path segment of a workspace path. Display-only shortening, composed
 * host-side so the panel never parses a label to render it.
 * @param {string} dir
 * @returns {string}
 */
function baseNameOf(dir) {
  const parts = String(dir).split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : String(dir)
}
