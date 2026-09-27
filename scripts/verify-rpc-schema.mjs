#!/usr/bin/env node
/**
 * RPC boundary schemas (Phase D2) contract check.
 *
 * The gateway validates every inbound JSON parameter with `codec.create().parse(value)`
 * (packages/api/gateway/src/index.ts, decode()). What this pins:
 *   - every declared schema accepts its own sample and rejects the wrong TYPE;
 *   - every manifest wire resolves to a schema, and every schema row is faithful
 *     (same wires, same order) so a new method cannot ship unvalidated;
 *   - omission stays legal (acceptsUndefined), i.e. src-json's semantics survive.
 *
 * Zero dependencies; part of npm test.
 */
import assert from 'node:assert/strict'
import { RPC_MANIFEST, RPC_PARAM_SCHEMAS, paramSchema } from '../lib/rpc-manifest.js'
import { RPC_SCHEMA_NAMES, RpcSchemaError, schemaFor } from '../lib/rpc-schema.js'

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

console.log(results.join('\n'))
console.log('verify-rpc-schema OK: ' + results.length + ' checks (' + RPC_SCHEMA_NAMES.length + ' schemas, ' + Object.keys(RPC_PARAM_SCHEMAS).length + ' methods)')
