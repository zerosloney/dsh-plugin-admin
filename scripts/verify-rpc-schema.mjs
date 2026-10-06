#!/usr/bin/env node
/**
 * RPC boundary schemas (Phase D2) contract check.
 *
 * The gateway validates every inbound JSON parameter with `codec.create().parse(value)`
 * (packages/api/gateway/src/index.ts, decode()). What this pins:
 *   - every declared schema accepts its own sample and rejects the wrong TYPE;
 *   - every manifest wire resolves to a schema, and every schema row is faithful
 *     (same wires, same order) so a new method cannot ship unvalidated;
 *   - the required/optional split is the SHIPPED contract, asserted against the
 *     literal list below rather than re-reading the table the descriptors are
 *     derived from (that self-comparison could never fail).
 *
 * Zero dependencies; part of npm test.
 */
import assert from 'node:assert/strict'
import { RPC_MANIFEST, RPC_OPTIONAL_WIRES, RPC_PARAM_SCHEMAS, invocationsFor, paramSchema } from '../lib/rpc-manifest.js'
import { RPC_SCHEMA_NAMES, RpcSchemaError, schemaFor } from '../lib/rpc-schema.js'

/**
 * The wires the browser half legitimately omits, spelled out INDEPENDENTLY of
 * `RPC_OPTIONAL_WIRES`. Every entry needs a reason in the manifest; widening the
 * table without widening this list (or vice versa) is a wire silently changing
 * from required to optional — the one D2 regression that must not pass.
 */
const EXPECTED_OPTIONAL = Object.freeze({
  'workflowAdmin/amendRun': Object.freeze(['spec']),
  'workflowAdmin/resumeRun': Object.freeze(['spec']),
  'workflowAdmin/listSaved': Object.freeze(['spec']),
  'workspaceAdmin/create': Object.freeze(['title']),
  'workspaceAdmin/insertBefore': Object.freeze(['beforeWorkspaceId']),
  'webSearchAdmin/saveConfig': Object.freeze(['expectedRevision']),
})
/** Wires the gateway must reject when omitted: 87 declared − 6 optional. */
const EXPECTED_REQUIRED = 81
/** The optional wire count is the contract too (6). */
const EXPECTED_OPTIONAL_COUNT = 6

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push('✅ ' + name)
  } catch (error) {
    results.push('❌ ' + name)
    console.error(results.join('\n'))
    throw error
  }
}

/** Values that must never pass a schema of the given name. */
const WRONG = {
  text: [1, true, null, {}, ['a']],
  scalar: [{}, ['a']],
  number: ['1', true, null, Number.NaN, Number.POSITIVE_INFINITY],
  boolean: ['true', 1, null],
  textList: ['a', [1], [null], {}],
  entry: ['a', 1, null, ['a']],
  json: [Number.NaN, Number.POSITIVE_INFINITY, { a: undefined }, () => {}],
}

check('every declared schema accepts its sample and rejects wrong types', () => {
  assert.deepEqual([...RPC_SCHEMA_NAMES].sort(), Object.keys(WRONG).sort(), 'the wrong-value table covers every schema')
  for (const name of RPC_SCHEMA_NAMES) {
    const factory = schemaFor(name)
    assert.doesNotThrow(() => factory.parse(factory.sample()), name + ' accepts its own sample')
    for (const bad of WRONG[name]) {
      assert.throws(() => factory.parse(bad), RpcSchemaError, name + ' rejects ' + String(bad))
      assert.equal(factory.accepts(bad), false, name + '.accepts agrees for ' + String(bad))
    }
    assert.equal(factory.accepts(factory.sample()), true, name + '.accepts agrees for its sample')
  }
})

check('a factory is fresh per call (the gateway calls create() per decode)', () => {
  const a = schemaFor('entry')
  const b = schemaFor('entry')
  assert.notEqual(a, b, 'create() hands out a new object each time')
  assert.doesNotThrow(() => a.parse({ id: 'x' }))
  assert.doesNotThrow(() => b.parse({ id: 'y' }))
})

check('the required/optional split is the shipped contract, not a re-read of the table', () => {
  // Two independent facts are asserted against each other here:
  //   a) the DESCRIPTORS the gateway enforces (derived from RPC_OPTIONAL_WIRES);
  //   b) EXPECTED_OPTIONAL — the literal list above.
  // Comparing (a) to the table it is derived from (the previous version of this
  // check) could never fail, so a wire silently turning optional passed.
  assert.deepEqual(
    Object.keys(RPC_OPTIONAL_WIRES).sort(),
    Object.keys(EXPECTED_OPTIONAL).sort(),
    'RPC_OPTIONAL_WIRES declares exactly the expected optional targets',
  )
  let required = 0
  let optional = 0
  for (const [namespace, entry] of Object.entries(RPC_MANIFEST)) {
    for (const descriptor of invocationsFor(namespace)) {
      const target = namespace + '/' + descriptor.method
      const expectedOptional = EXPECTED_OPTIONAL[target] ?? []
      assert.deepEqual(
        RPC_OPTIONAL_WIRES[target] ?? [],
        expectedOptional,
        `${target} optional wires match the shipped contract`,
      )
      for (const parameter of descriptor.parameters) {
        const shouldBeOptional = expectedOptional.includes(parameter.wire)
        assert.equal(
          parameter.acceptsUndefined,
          shouldBeOptional,
          `${target} ${parameter.wire} omission matches the shipped contract`,
        )
        if (shouldBeOptional) optional += 1; else required += 1
      }
      for (const wire of expectedOptional) {
        assert.ok(entry.methods[descriptor.method].params.includes(wire),
          `${target} optional wire ${wire} is a declared wire`)
      }
    }
  }
  // The counts are the contract: a new method adds required wires unless it
  // deliberately declares one optional (and then says why, next to the table).
  assert.equal(required, EXPECTED_REQUIRED, 'required wire count (' + required + ')')
  assert.equal(optional, EXPECTED_OPTIONAL_COUNT, 'optional wire count (' + optional + ')')
})
check('every manifest wire resolves to a schema and rides a strict codec', () => {
  let wires = 0
  const used = new Set()
  for (const [namespace, entry] of Object.entries(RPC_MANIFEST)) {
    for (const [method, spec] of Object.entries(entry.methods)) {
      for (const wire of spec.params) {
        const name = paramSchema(namespace, method, wire)
        assert.ok(RPC_SCHEMA_NAMES.includes(name), `${namespace}/${method} ${wire} names a declared schema`)
        used.add(name)
        wires += 1
      }
    }
  }
  assert.ok(wires > 80, 'the surface really is this wide (' + wires + ' wires)')
  assert.deepEqual([...used].sort(), [...RPC_SCHEMA_NAMES].sort(), 'every schema in the table is actually used')
})

check('the schema table is faithful: same keys, same wires, same order', () => {
  const errors = []
  for (const [key, row] of Object.entries(RPC_PARAM_SCHEMAS)) {
    const [namespace, method] = key.split('/')
    const spec = RPC_MANIFEST[namespace]?.methods?.[method]
    if (spec === undefined) { errors.push(key + ' has no manifest method'); continue }
    const declared = Object.keys(row)
    if (declared.join(',') !== spec.params.join(',')) {
      errors.push(`${key} declares ${declared.join(',')} but the method takes ${spec.params.join(',') || '(nothing)'}`)
    }
    for (const name of declared) {
      if (!RPC_SCHEMA_NAMES.includes(row[name])) errors.push(key + ' ' + name + ' names unknown schema ' + row[name])
    }
  }
  for (const [namespace, entry] of Object.entries(RPC_MANIFEST)) {
    for (const [method, spec] of Object.entries(entry.methods)) {
      if (spec.params.length > 0 && RPC_PARAM_SCHEMAS[namespace + '/' + method] === undefined) {
        errors.push(`${namespace}/${method} has parameters but no schema row`)
      }
    }
  }
  assert.deepEqual(errors, [], 'schema table drift:\n  ' + errors.join('\n  '))
})

check('a missing schema row fails loudly instead of shipping unvalidated', () => {
  assert.throws(() => paramSchema('cronAdmin', 'upsert', 'nope'), /no schema/)
  assert.throws(() => schemaFor('nope'), /unknown schema/)
})

check('deeply nested json is refused as an RpcSchemaError, not a RangeError', () => {
  // The recursive validator used to throw a bare `RangeError: Maximum call
  // stack size exceeded` on a deeply nested payload — not an RpcSchemaError,
  // so the gateway classified a boundary INPUT error as internal. The
  // iterative walker refuses it cleanly (past MAX_JSON_DEPTH) with the normal
  // parameter-contract error.
  let deep = []
  let cursor = deep
  for (let i = 0; i < 100_000; i += 1) {
    const next = []
    cursor.push(next)
    cursor = next
  }
  const factory = schemaFor('json')
  assert.throws(() => factory.parse(deep), RpcSchemaError, 'deep nesting is an input-invalid refusal')
  assert.equal(factory.accepts(deep), false)
  // Legitimate depth is nowhere near the cap.
  assert.equal(factory.accepts({ a: { b: { c: [1, { d: 'e' }] } } }), true, 'shallow payloads still pass')
})

console.log(results.join('\n'))
console.log('verify-rpc-schema OK: ' + results.length + ' checks (' + RPC_SCHEMA_NAMES.length + ' schemas, ' + Object.keys(RPC_PARAM_SCHEMAS).length + ' methods)')
