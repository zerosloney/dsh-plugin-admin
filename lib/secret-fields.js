/**
 * Write-only field semantics for secret-bearing string maps (`env`, `headers`).
 *
 * The rule this module encodes, in one place, because it is a CONTRACT between
 * the two halves of every editor that has one:
 *
 *   - the host sends the KEY SET with empty values — a stored API key never
 *     crosses the RPC boundary (possession of one is enough to use the service
 *     it belongs to, and the browser is where same-origin scripts live);
 *   - the host therefore cannot tell "unchanged" from "cleared" by value, so an
 *     incoming EMPTY value means "keep the stored one", and removing a key is
 *     expressed by omitting it from the map altogether (which is what the
 *     editors do when the line is deleted).
 *
 * Two namespaces already worked this way before this module existed — the
 * webhook rule editor (`secret`: empty = keep) and web-search provider config
 * (`kind: 'secret'` fields project an empty value). The MCP entry editor and the
 * generic CLI-backend editor round-tripped their `env` / `headers` values, which
 * leaked third-party keys into the browser and — for the CLI backend, whose
 * panel never sends `env` at all — silently wiped every stored variable on save.
 *
 * Both halves must be used together; using only {@link maskSecretMap} erases the
 * values on the next save, and using only {@link inheritSecretMap} leaks them.
 */

/**
 * Replace every value of a string map with `''`, keeping its keys.
 * @param {unknown} map - the stored map (values may be secrets).
 * @returns {any} the same keys, every value `''`; a non-map input is returned
 *   untouched so a caller can apply this blindly.
 */
export function maskSecretMap(map) {
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return map
  // The guard narrows `map` to the non-array object type, which has no string
  // index signature; the value is a JSON-decoded key/value bag, so name that.
  const source = /** @type {Record<string, unknown>} */ (map)
  /** @type {Record<string, string>} */
  const masked = {}
  for (const key of Object.keys(source)) masked[key] = ''
  return masked
}

/**
 * Inherit stored VALUES for the keys a caller sent empty, and only those.
 * @param {unknown} incoming - the map as the caller sent it.
 * @param {unknown} stored - the map as it is on disk.
 * @returns {any} the map to write (a non-map, or a call with no stored map,
 *   returns `incoming` unchanged).
 */
export function inheritSecretMap(incoming, stored) {
  if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return incoming
  const incomingMap = /** @type {Record<string, unknown>} */ (incoming)
  const storedMap = /** @type {Record<string, unknown>} */ (stored)
  /** @type {Record<string, unknown>} */
  const merged = {}
  for (const [key, value] of Object.entries(incomingMap)) {
    // Only an EMPTY incoming value inherits: a new key set to '' (no stored
    // value to inherit) stays empty, and a real value always wins.
    const storedValue = storedMap[key]
    merged[key] = value === '' && typeof storedValue === 'string' ? storedValue : value
  }
  return merged
}

/**
 * Apply {@link inheritSecretMap} to the named fields of one config object.
 * @param {Record<string, any>} config - the incoming config.
 * @param {Record<string, any>|null} storedConfig - the on-disk config, when there is one.
 * @param {readonly string[]} [fields] - the map-valued secret fields (default env/headers).
 * @returns {Record<string, any>} a copy of `config` with those fields merged.
 */
export function inheritSecretFields(config, storedConfig, fields = ['env', 'headers']) {
  if (config === null || typeof config !== 'object') return config
  if (storedConfig === null || typeof storedConfig !== 'object') return config
  const next = { ...config }
  for (const field of fields) {
    if (config[field] === undefined) continue   // "field absent" is a different action (see the module note)
    next[field] = inheritSecretMap(config[field], storedConfig[field])
  }
  return next
}

/**
 * Apply {@link maskSecretMap} to the named fields of one config object.
 * @param {Record<string, any>} config - the config about to leave the host.
 * @param {readonly string[]} [fields] - the map-valued secret fields (default env/headers).
 * @returns {any} the same object with those fields masked in place.
 */
export function maskSecretFields(config, fields = ['env', 'headers']) {
  if (config === null || typeof config !== 'object') return config
  for (const field of fields) {
    if (config[field] !== undefined) config[field] = maskSecretMap(config[field])
  }
  return config
}
