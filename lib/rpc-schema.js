/**
 * Boundary schemas for the RPC surface (Phase D2).
 *
 * Every JSON parameter used to ride codec { mode: 'src-json' }, which the gateway
 * passes through untouched — so a browser payload of the wrong TYPE reached the
 * service and only that service's own guards could stop it. The gateway validates
 * `codec.create().parse(value)` for mode 'strict' (packages/api/gateway/src/index.ts,
 * decode()), so this module supplies those factories.
 *
 * Two deliberate properties:
 *
 *   - ZERO dependencies. The hand-written descriptors carry no generated types,
 *     so the factory returns a tiny object exposing just `parse` — the whole
 *     surface the gateway uses. No zod runtime in a plugin that ships none.
 *   - NO stricter than the services about TYPES. Each schema validates what the
 *     service itself assumes (an id is a string, a rule is an object, a list of
 *     session ids is a string array) and never enumerates an entry's fields:
 *     services accept caller-shaped drafts, and a schema that guessed the field
 *     set would reject legitimate payloads.
 *
 * Arity is a separate axis and is NOT lenient: a wire is REQUIRED unless
 * RPC_OPTIONAL_WIRES says otherwise, so an omitted required wire fails at the
 * gateway (`gateway/arguments-invalid`) instead of reaching the service as
 * undefined. Omission used to be legal on every wire (src-json's semantics);
 * the tightening was audited call site by call site — scripts/host-check.mjs
 * proves every literal browser payload sends its required wires, and the
 * runtime payloads it cannot read key-by-key are listed in
 * RPC_DYNAMIC_CLIENT_PAYLOADS.
 */

/**
 * A failing parse. A plain Error with a readable message, so the gateway wraps it
 * into `gateway/input-invalid` with this text as the cause.
 */
export class RpcSchemaError extends Error {
  /**
   * @param {string} message - what failed, in terms a panel author can act on.
   */
  constructor(message) {
    super(message)
    this.name = 'RpcSchemaError'
  }
}

/**
 * One schema: `parse(value)` returns the value or throws, `accepts(value)` is the
 * boolean twin, and `sample()` synthesizes a valid value (used by the test that
 * proves every declared schema both accepts and rejects).
 */
class Schema {
  /**
   * @param {string} name - the schema's table name (for messages).
   * @param {(value: unknown) => boolean} test - the acceptance predicate.
   * @param {() => unknown} sample - a valid value for tests.
   */
  constructor(name, test, sample) {
    this.name = name
    this.test = test
    this.sample = sample
  }

  /**
   * @param {unknown} value - the wire value.
   * @returns {unknown} the same value when it matches.
   * @throws {RpcSchemaError} when it does not.
   */
  parse(value) {
    if (!this.test(value)) {
      throw new RpcSchemaError('参数不符合 ' + this.name + ' 契约（收到 ' + describe(value) + '）')
    }
    return value
  }

  /**
   * @param {unknown} value - the wire value.
   * @returns {boolean} whether it matches.
   */
  accepts(value) {
    return this.test(value)
  }
}

/**
 * A short, safe rendering of a rejected value for the error message.
 * @param {unknown} value - the offending value.
 * @returns {string} its type, or a short JSON form.
 */
function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array[' + value.length + ']'
  const type = typeof value
  if (type !== 'object') return type + ' ' + String(JSON.stringify(value)).slice(0, 40)
  return 'object'
}

/**
 * Plain object: what every `entry` / `payload` / `spec` parameter is.
 * @param {unknown} value - the candidate.
 * @returns {boolean}
 */
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * How deep {@link isJsonValue} walks before calling a value not-JSON-shaped.
 *
 * The walk is ITERATIVE (explicit stack), so depth alone can no longer overflow
 * the call stack — the recursive version threw a bare `RangeError: Maximum call
 * stack size exceeded` on a deeply nested payload, which is not an
 * `RpcSchemaError`, so the gateway classified a boundary-layer INPUT error as
 * internal and the validator itself became the error source. The cap remains as
 * the depth-axis work bound: real panel payloads are single-digit deep, so 512
 * is far outside legitimate shapes and far inside pathological ones.
 */
const MAX_JSON_DEPTH = 512

/**
 * Whether a value survives a JSON round trip (the gateway asserts this too; doing
 * it here names the offending parameter earlier).
 * @param {unknown} value - the value.
 * @param {Set<unknown>} seen - cycle guard.
 * @returns {boolean}
 */
function isJsonValue(value, seen) {
  // Explicit stack instead of recursion — see MAX_JSON_DEPTH for why.
  const stack = [{ item: value, depth: 0 }]
  while (stack.length > 0) {
    // The loop guard makes the pop total; the branch names that for the checker.
    const frame = stack.pop()
    if (frame === undefined) break
    const item = frame.item
    if (item === null) continue
    const type = typeof item
    if (type === 'string' || type === 'boolean') continue
    if (type === 'number') {
      if (!Number.isFinite(item)) return false
      continue
    }
    if (type !== 'object') return false
    if (seen.has(item)) return false
    if (frame.depth >= MAX_JSON_DEPTH) return false
    seen.add(item)
    if (Array.isArray(item)) {
      for (const child of item) stack.push({ item: child, depth: frame.depth + 1 })
      continue
    }
    // The narrow above leaves a bare `object`, which `Object.values` refuses
    // without `strictNullChecks` off-style looseness; the wire value is a
    // string-keyed bag, so name that.
    for (const child of Object.values(/** @type {Record<string, unknown>} */ (item))) {
      stack.push({ item: child, depth: frame.depth + 1 })
    }
  }
  return true
}

/**
 * The schema table. Names are the vocabulary the manifest speaks; the KEY appears
 * in a codec's typeSymbol, so renaming one is a wire-visible change.
 */
export const RPC_SCHEMAS = Object.freeze({
  /** An identifier / path / free text. */
  text: new Schema('text', (v) => typeof v === 'string', () => 'probe'),
  /** A JSON scalar, for values whose type the host passes through (revisions). */
  scalar: new Schema('scalar', (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean', () => 1),
  /** A finite number (limits, counts). */
  number: new Schema('number', (v) => typeof v === 'number' && Number.isFinite(v), () => 10),
  /** A boolean flag. */
  boolean: new Schema('boolean', (v) => typeof v === 'boolean', () => true),
  /** A list of strings (session ids, unset keys). */
  textList: new Schema('textList', (v) => Array.isArray(v) && v.every((item) => typeof item === 'string'), () => ['a', 'b']),
  /** An entry / draft / spec object: validated as an object, never field-by-field. */
  entry: new Schema('entry', isPlainObject, () => ({ id: 'probe' })),
  /** Any JSON value (tool arguments, whose shape the MCP server owns). */
  json: new Schema('json', (v) => isJsonValue(v, new Set()), () => ({ a: 1 })),
})

/**
 * The factory a strict codec's `create()` returns. Fresh per call: the gateway
 * calls create() per decode, and a shared instance would let one parse's state
 * leak into the next.
 * @param {string} name - a key of {@link RPC_SCHEMAS}.
 * @returns {{ name: string, parse: (value: unknown) => unknown, accepts: (value: unknown) => boolean, sample: () => unknown }}
 * @throws {Error} for an unknown schema name (a manifest typo must fail loudly).
 */
export function schemaFor(name) {
  // `RPC_SCHEMAS` is `Object.freeze`d over a fixed key set, so a `string` index
  // is not assignable; the lookup below still has to accept any string because
  // the name arrives from the manifest. Reading through a string-keyed view keeps
  // the missing-key check meaningful (undefined is a real outcome here) instead
  // of asserting the key exists.
  const table = /** @type {Record<string, Schema>} */ (RPC_SCHEMAS)
  const schema = table[name]
  if (schema === undefined) {
    throw new Error('rpc-schema: unknown schema "' + String(name) + '" (declare it in RPC_SCHEMAS first)')
  }
  return {
    name: schema.name,
    parse: (value) => schema.parse(value),
    accepts: (value) => schema.accepts(value),
    sample: () => schema.sample(),
  }
}

/** Every schema name the manifest may reference. */
export const RPC_SCHEMA_NAMES = Object.freeze(Object.keys(RPC_SCHEMAS))
