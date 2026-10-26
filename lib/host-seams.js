/**
 * Optional host-seam access for a plugin that injects nothing.
 *
 * This package deliberately declares no Cordis `inject` (see lib/index.js):
 * the array form is all-required, and an all-required seam list keeps the WHOLE
 * plugin from mounting on a profile that lacks one service — which is how this
 * plugin used to vanish silently from `@deepseek-ai/dsh-sdk-minimal`, a bundle
 * that ships neither typert nor subagents nor commands nor shell.
 *
 * Every consumer therefore reads its seam through {@link hostSeamOf}:
 * `ctx.get(name)` never throws and returns `undefined` when the service is
 * absent (reflect.get in vendor/cordis/src/reflect.ts), so one absent service
 * retires one panel instead of the mount. {@link requireSeam} is the variant for
 * call sites that cannot proceed without the service — it raises a message
 * naming the deployment gap rather than a bare `TypeError` on undefined.
 *
 * Zero dsh imports; no dependency on lib/index.js (this is imported BY it), so
 * the module stays cycle-free.
 */

/**
 * The host seams this plugin rides, in the order apply() reports them.
 * Kept as data (not as `inject`) so a missing one retires its panels only.
 * @type {readonly string[]}
 */
export const HOST_SEAMS = Object.freeze(['typert', 'sessionPersistence', 'tools', 'subagents', 'commands', 'shell'])

/**
 * Read one host seam without declaring it in `inject`.
 *
 * `ctx.<name>` throws `cannot get property "<name>" without inject` when the
 * service is missing; `ctx.get(name)` returns `undefined` instead, which is
 * what lets one absent service degrade one panel rather than the whole mount.
 * @param {any} ctx - plugin context (duck-typed; may predate `get()`).
 * @param {string} name - seam name, e.g. 'sessionPersistence'.
 * @returns {any} the live service, or `undefined` when this deployment lacks it.
 */
export function hostSeamOf(ctx, name) {
  if (ctx === null || ctx === undefined) return undefined
  if (typeof ctx.get === 'function') {
    const viaGet = ctx.get(name)
    if (viaGet !== undefined) return viaGet
  }
  // `get()` is the only sanctioned reader in a live Cordis context, but two kinds
  // of ctx reach this module without answering through it: a test double whose
  // get() knows only its own registry, and a pre-`get()` host that carries the
  // service as an own property. Reading the property covers both, and cannot
  // paper over drift: a renamed or retired service is absent from BOTH routes,
  // and on a real Cordis context this read throws `cannot get property … without
  // inject`, which we answer as "not available" — the same verdict as get().
  try {
    return ctx[name]
  } catch {
    return undefined
  }
}

/**
 * Read one host seam that the caller cannot work without.
 * @param {any} ctx - plugin context.
 * @param {string} name - seam name.
 * @param {string} feature - caller label used in the error, e.g. 'session-admin'.
 * @returns {any} the live service.
 * @throws {Error} naming the deployment gap when the service is not mounted.
 */
export function requireSeam(ctx, name, feature) {
  const service = hostSeamOf(ctx, name)
  if (service === undefined || service === null) {
    throw new Error(`${feature}: dsh host service "${name}" is not mounted in this deployment — that feature is unavailable here`)
  }
  return service
}

/**
 * Read one host seam and fence it against an upstream that kept the service but
 * moved a member off it.
 *
 * This is the failure mode a service-level presence check cannot see: dsh keeps
 * `sessionPersistence` while dropping, say, `stat()`. Failing at the call site
 * with a message naming the member keeps that one namespace unusable instead of
 * turning one moved method into "the whole plugin does not load" — which is
 * exactly what assertPersistenceShape() used to do from apply().
 *
 * Present members pass through untouched. A call to a missing member throws a
 * named error carrying every missing member, so the operator sees the same
 * sentence whether the gap is hit from here or from the mount-time warning.
 * @param {any} ctx - plugin context.
 * @param {string} name - seam name.
 * @param {readonly string[]} members - members this feature needs.
 * @param {string} feature - caller label used in errors.
 * @returns {any} the live service (or a fence around it).
 */
export function requireSeamMembers(ctx, name, members, feature) {
  const service = requireSeam(ctx, name, feature)
  const missing = members.filter((member) => typeof service[member] !== 'function')
  if (missing.length === 0) return service
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value === 'function') return value
      return () => {
        throw new Error(`${feature}: dsh ${name} is missing member "${String(property)}" (this build also lacks: ${missing.join(', ')}) — dsh version changed?`)
      }
    },
  })
}
