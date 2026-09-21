/**
 * Credential (API key / secret) administration host half.
 *
 * The host's `ctx.credentials` (CredentialProvider seam, backed by
 * $DSH_HOME/.credentials.yaml) already has everything a management surface
 * needs — enumeration, describe-without-value, set/unset, record CRUD — but
 * dsh ships no web UI for it (the model settings page only shows a
 * configured/absent badge per provider). This module exposes those verbs as
 * a `credentialAdmin` RPC namespace for the plugin's settings page.
 *
 * Security posture, held on every path:
 *   - The panel NEVER receives secret values. `describe` returns presence +
 *     source + writability only; writes are set/unset by reference name.
 *   - The host writes only to the credential refs the composition actually
 *     declares (discovered from the installed dsh-* settings schemas is too
 *     deep; instead we accept refs named by the panel, which itself only
 *     offers refs the model-provider catalog describes as expected).
 *
 * Zero dsh imports: everything rides the live Cordis context.
 */

/* ========================================================================== */
/*                              Pure Helpers                                  */
/* ========================================================================== */

/**
 * The POSIX-name grammar credential refs must match (used by the host's own
 * resolve path and enforced on every write so a panel can never smuggle a
 * shell-unsafe name through).
 */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Map a CredentialProvider describe() result into a JSON-safe row the panel
 * renders. Secrets never cross this boundary — only presence and provenance.
 * @param {CredentialInfo} info - host describe result.
 * @param {{ declared?: string[] }} extra - optional panel-side context.
 * @returns {{ configured: boolean, source: string|null, writable: boolean,
 *   declared: boolean }}.
 */
export function credentialRow(info, extra = {}) {
  const i = info && typeof info === 'object' ? info : {}
  return {
    configured: i.configured === true,
    source: typeof i.source === 'string' && i.source !== '' ? i.source : null,
    writable: i.writable !== false,
    declared: Array.isArray(extra.declared) ? extra.declared.includes(i.ref) : false,
  }
}

/**
 * Validate a credential reference name for write. Throws on anything that
 * could not be a POSIX shell identifier.
 * @param {unknown} ref - candidate reference name.
 * @returns {string} the trimmed ref.
 */
export function assertCredentialRef(ref) {
  if (typeof ref !== 'string') throw new Error('credential-admin: ref 必须是字符串')
  const trimmed = ref.trim()
  if (!CREDENTIAL_REF.test(trimmed)) {
    throw new Error(`credential-admin: ref "${trimmed}" 非法，须匹配 /[A-Za-z_][A-Za-z0-9_]*/`)
  }
  return trimmed
}

/* ========================================================================== */
/*                              Service Mount                                  */
/* ========================================================================== */

const SERVICE_KEY = 'credentialAdmin'
const NAMESPACE = 'credentialAdmin'
const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

const param = (name) => [{ name, wire: name, source: 'json', codec: { mode: 'src-json' } }]
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
export function credentialInvocations() {
  return [
    descriptor('credential/list', 'list', []),
    descriptor('credential/set', 'set', [{ name: 'ref', wire: 'ref', source: 'json', codec: { mode: 'src-json' } }, { name: 'value', wire: 'value', source: 'json', codec: { mode: 'src-json' } }]),
    descriptor('credential/unset', 'unset', param('ref')),
  ]
}

/**
 * Normalize the injected reference source into a ref list plus an optional scan
 * report. Two shapes are accepted:
 *   - a bare string array — the refs, with nothing to report;
 *   - `{ refs, reason, message }` — the report `credentialRefsFor` returns when
 *     the schema half of the discovery could not run at all.
 * Only a failed scan becomes a report: a completed one is the absence of news,
 * and `service-absent` is already carried by `available: false`.
 * @param {string[]|(() => (string[]|object))|object} declaredRefs - the source.
 * @returns {{ refs: string[], scan: { reason: string, message: string }|null }}.
 */
function refSourceOf(declaredRefs) {
  const raw = typeof declaredRefs === 'function' ? declaredRefs() : declaredRefs
  if (Array.isArray(raw)) return { refs: raw, scan: null }
  const refs = Array.isArray(raw?.refs) ? raw.refs : []
  if (raw?.reason !== 'scan-failed') return { refs, scan: null }
  return {
    refs,
    scan: { reason: 'scan-failed', message: typeof raw?.message === 'string' ? raw.message : '' },
  }
}

/**
 * Mount the credentialAdmin service onto ctx.
 * @param {object} ctx - host context.
 * @param {string[]|(() => (string[]|object))} declaredRefs - credential refs the
 * active composition is known to consume (the panel offers these; the
 * model-provider catalog would be the fuller source but is
 * provider-package specific). An array is a mount-time snapshot; a
 * function is resolved on every list() so refs registered by settings
 * namespaces after this mount still surface. A function may also return the
 * scanner's own report (`{ refs, reason, message }`) — that is what lets the
 * panel tell a failed scan from a composition that declares nothing.
 * @returns {() => Array} credentialInvocations().
 */
export function applyCredentialAdmin(ctx, declaredRefs = []) {
  /** @returns {object} the host credentials service, or null when absent. */
  const credentialsService = () => {
    try {
      const svc = ctx.get('credentials')
      return svc && typeof svc.describe === 'function' ? svc : null
    } catch {
      return null
    }
  }

  /**
   * @param {{ refs: string[] }} source - the normalized ref source.
   * @returns {Promise<string[]>} refs in use by the running profile.
   */
  async function discoverRefs(source) {
    const svc = credentialsService()
    if (!svc) return []
    const refs = []
    // Reference half has no enumeration — seed from what the panel declares
    // plus any record keys the record half lists.
    const set = new Set(source.refs)
    // listRecords is duck-typed and may be sync or async depending on the
    // credential source; await covers both shapes without caring which one
    // this deployment ships.
    const records = typeof svc.listRecords === 'function' ? await svc.listRecords() : []
    for (const rec of records || []) {
      const key = rec?.key ?? rec?.name ?? rec?.id
      if (typeof key !== 'string' || key === '') continue
      // Record keys are intentionally disjoint from refs (the `/` separator):
      // a record key like `client-connection/browser-session` would fail
      // `assertCredentialRef` and surface as a "describe 失败" row on the
      // panel. Filter them out — they live in the record half, managed by
      // their own plugins — while keeping the ref grammar the panel renders.
      if (key.includes('/')) continue
      set.add(key)
    }
    for (const ref of set) refs.push(ref)
    return refs
  }

  const service = {
    /** List every known credential ref with presence/source (no values). */
    async list() {
      const svc = credentialsService()
      // Resolved once per list(): the source may be a live schema scan, and the
      // rows below need the same answer the ref list was built from.
      const source = refSourceOf(declaredRefs)
      const refs = await discoverRefs(source)
      // Resolve the declared set so rows can distinguish refs the running
      // composition actually consumes from record keys surfaced by
      // listRecords (the former get `declared: true`).
      const declaredSet = new Set(source.refs)
      // describes are local reads (env / store files) — resolve them
      // concurrently and reassemble rows in ref order.
      const settled = await Promise.all(refs.map(async (ref) => {
        try {
          return { ref, row: credentialRow(await svc.describe(ref)) }
        } catch {
          return { ref, row: { configured: false, source: null, writable: false, error: 'describe 失败' } }
        }
      }))
      const rows = settled.map(({ ref, row }) => (
        // `declared` after the spread: credentialRow's extra-based path relies
        // on describe() carrying the ref back, which the host does not
        // guarantee — the map key is the authoritative ref.
        { ref, ...row, declared: declaredSet.has(ref) }
      ))
      return { available: svc !== null, refs: rows, scan: source.scan }
    },

    /** Durably store one credential value for a declared ref. */
    async set(ref, value) {
      const safeRef = assertCredentialRef(ref)
      const svc = credentialsService()
      if (!svc) throw new Error('credential-admin: credentials 服务不可用')
      if (typeof value !== 'string' || value.trim() === '') throw new Error('credential-admin: 值不能为空（删除用 unset）')
      if (typeof svc.set !== 'function') throw new Error('credential-admin: 当前凭据源只读，无法写入')
      await svc.set(safeRef, value)
      return { ok: true, ref: safeRef, ...credentialRow(await svc.describe(safeRef)) }
    },

    /** Remove one credential value. */
    async unset(ref) {
      const safeRef = assertCredentialRef(ref)
      const svc = credentialsService()
      if (!svc) throw new Error('credential-admin: credentials 服务不可用')
      if (typeof svc.unset !== 'function') throw new Error('credential-admin: 当前凭据源只读，无法删除')
      await svc.unset(safeRef)
      return { ok: true, ref: safeRef }
    },
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, 'plugin-admin/credentialAdmin: provide')

  return credentialInvocations
}
