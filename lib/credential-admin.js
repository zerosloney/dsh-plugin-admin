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
 *   shadowed: boolean, declared: boolean }}.
 */
export function credentialRow(info, extra = {}) {
  const i = info && typeof info === 'object' ? info : {}
  return {
    configured: i.configured === true,
    source: typeof i.source === 'string' && i.source !== '' ? i.source : null,
    writable: i.writable !== false,
    shadowed: i.shadowed === true,
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
 * Mount the credentialAdmin service onto ctx.
 * @param {object} ctx - host context.
 * @param {string[]} declaredRefs - credential refs the active composition is
 *   known to consume (the panel offers these; the model-provider catalog
 *   would be the fuller source but is provider-package specific).
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

  /** @returns {Promise<string[]>} refs in use by the running profile. */
  async function discoverRefs() {
    const svc = credentialsService()
    if (!svc) return []
    const refs = []
    // Reference half has no enumeration — seed from what the panel declares
    // plus any record keys the record half lists.
    const records = typeof svc.listRecords === 'function' ? await svc.listRecords() : []
    const set = new Set(declaredRefs)
    for (const rec of records || []) {
      const key = rec?.key ?? rec?.name ?? rec?.id
      if (typeof key === 'string' && key !== '') set.add(key)
    }
    for (const ref of set) refs.push(ref)
    return refs
  }

  const service = {
    /** List every known credential ref with presence/source (no values). */
    async list() {
      const svc = credentialsService()
      const refs = await discoverRefs()
      const rows = []
      for (const ref of refs) {
        try {
          const info = await svc.describe(ref)
          rows.push({ ref, ...credentialRow(info) })
        } catch {
          rows.push({ ref, configured: false, source: null, writable: false, shadowed: false, error: 'describe 失败' })
        }
      }
      return { available: svc !== null, refs: rows }
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
