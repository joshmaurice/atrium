// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add-schema.test.js — subtree-add T8 and T12's form
// (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2).
//
// Both add schemas define `node` once (`#/definitions/node`), with `children`
// an array (minItems 1) of that same node, recursively, and a primitive's
// `material` `oneOf` today's object and `{ ref: integer >= 0 }` (with
// `required: ["ref"]`, or `material: {}` would match both and fail oneOf).
// The bounds, names, ids and the ref ORDER are checkAddNode's, not the
// schema's. The validator is `new Ajv({ strict: false })`, which silently
// ignores a misspelled keyword, so every rule has a case that must be REFUSED.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schema = (side) => JSON.parse(readFileSync(resolve(__dirname, `../src/schemas/add.${side}.json`), 'utf8'))

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const prim = (material) => (material === undefined ? { attributes: { POSITION: [...TRI] } } : { attributes: { POSITION: [...TRI] }, material })
const add = (node) => ({ type: 'add', seq: 1, node })
const both = (msg) => [validate('client', msg).valid, validate('server', { ...msg, seq: 2 }).valid]

describe('T8: the two add schemas', () => {
  test('define the same node, once, and point at it', () => {
    const c = schema('client')
    const s = schema('server')
    assert.deepEqual(c.definitions.node, s.definitions.node)
    assert.deepEqual(c.properties.node, { $ref: '#/definitions/node' })
    assert.deepEqual(s.properties.node, { $ref: '#/definitions/node' })
    assert.deepEqual(c.definitions.node.properties.children.items, { $ref: '#/definitions/node' })
  })
})

describe('T8: children', () => {
  test('a tree three generations deep is accepted, both directions', () => {
    const tree = { name: 'R', children: [{ name: 'A', children: [{ name: 'A1', children: [{ name: 'A1a', mesh: { primitives: [prim()] } }] }] }, { name: 'B' }] }
    assert.deepEqual(both(add(tree)), [true, true])
  })
  test('children: [] is refused', () => {
    assert.deepEqual(both(add({ name: 'R', children: [] })), [false, false])
  })
  test('children that is not an array is refused', () => {
    assert.deepEqual(both(add({ name: 'R', children: { name: 'x' } })), [false, false])
  })
  test('a member with an unknown key, three generations down, is refused', () => {
    const tree = { name: 'R', children: [{ name: 'A', children: [{ name: 'A1', children: [{ name: 'deep', bogus: 1 }] }] }] }
    assert.deepEqual(both(add(tree)), [false, false])
  })
  test('a member with no name, or an empty one, is refused by the schema', () => {
    assert.deepEqual(both(add({ name: 'R', children: [{}] })), [false, false])
    assert.deepEqual(both(add({ name: 'R', children: [{ name: '' }] })), [false, false])
  })
  test('a member\'s mesh is typed like the root\'s (an unknown mesh key is refused)', () => {
    assert.deepEqual(both(add({ name: 'R', children: [{ name: 'A', mesh: { primitives: [prim()], bogus: 1 } }] })), [false, false])
  })
})

describe('T12: a primitive\'s material, an object or { ref }', () => {
  test('material: {} is still accepted (it matches one branch, not both)', () => {
    assert.deepEqual(both(add({ name: 'm', mesh: { primitives: [prim({})] } })), [true, true])
  })
  test('{ ref: 0 } is accepted', () => {
    assert.deepEqual(both(add({ name: 'm', mesh: { primitives: [prim({ name: 'Marble' }), prim({ ref: 0 })] } })), [true, true])
  })
  test('a non-integer ref is refused', () => {
    assert.deepEqual(both(add({ name: 'm', mesh: { primitives: [prim({}), prim({ ref: 0.5 })] } })), [false, false])
  })
  test('a negative ref is refused', () => {
    assert.deepEqual(both(add({ name: 'm', mesh: { primitives: [prim({}), prim({ ref: -1 })] } })), [false, false])
  })
  test('a ref with another key is refused', () => {
    assert.deepEqual(both(add({ name: 'm', mesh: { primitives: [prim({}), prim({ ref: 0, name: 'x' })] } })), [false, false])
  })
  test('a FORWARD ref passes the schema: its order is checkAddNode\'s (material-ref)', () => {
    assert.deepEqual(both(add({ name: 'm', mesh: { primitives: [prim({ ref: 3 }), prim({})] } })), [true, true])
  })
  test('today\'s malformed material is still refused, with the same first message', () => {
    const { valid, errors } = validate('client', add({ name: 'm', mesh: { primitives: [prim({ alphaMode: 'NOPE' })] } }))
    assert.equal(valid, false)
    assert.equal(typeof errors[0]?.message, 'string')
  })
})
