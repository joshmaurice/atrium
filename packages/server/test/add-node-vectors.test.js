// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// add-node-vectors — add-check step 1 (A1). The server's `checkAddNode` against
// the SAME shared vectors the client's `add-spec.js` test reads: no copy of the
// rule lives in the test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAddNode, ADD_REASONS, addReasonText } from '../src/send-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/add-node-vectors.json'), 'utf8'))

describe('checkAddNode — the shared vectors (A1)', () => {
  assert.ok(VECTORS.nodes.length >= 40, 'the shared vectors are the adversarial set')

  for (const vector of VECTORS.nodes) {
    test(vector.label, () => {
      const decided = checkAddNode(vector.node, { avatar: !!vector.avatar })
      if (vector.ok) {
        assert.equal(decided, null, decided ? `${decided.code}: ${decided.message}` : 'accepted')
      } else {
        assert.notEqual(decided, null, 'refused')
        assert.equal(decided.code, vector.reason, 'the shared reason code')
        assert.equal(decided.message, addReasonText(vector.reason), 'the plain text for that code')
      }
    })
  }

  test('every reason code has plain text', () => {
    for (const code of Object.keys(ADD_REASONS)) {
      assert.equal(typeof ADD_REASONS[code], 'string')
      assert.ok(ADD_REASONS[code].length > 0)
    }
  })
})

describe('checkAddNode — the rules most likely to be missed', () => {
  const position = [0, 0, 0, 1, 0, 0, 0, 1, 0]

  test('"finite" means finite as a Float32: 1e39 is refused', () => {
    const node = { name: 'a', mesh: { primitives: [{ attributes: { POSITION: [0, 0, 0, 1, 0, 0, 0, 1, 1e39] } }] } }
    assert.equal(checkAddNode(node).code, 'position-value')
    // A wire `1e999` parses to Infinity, refused by the same predicate.
    const inf = { name: 'a', mesh: { primitives: [{ attributes: { POSITION: [0, 0, 0, 1, 0, 0, 0, 1, Infinity] } }] } }
    assert.equal(checkAddNode(inf).code, 'position-value')
  })

  test('lengths and key sets come before any per-element work', () => {
    // 20,000 primitives is refused from primitives.length alone — no per-element walk.
    const many = new Array(20000).fill({ attributes: { POSITION: position } })
    const start = performance.now()
    assert.equal(checkAddNode({ name: 'a', mesh: { primitives: many } }).code, 'primitives-count')
    assert.ok(performance.now() - start < 500, 'refused from the length alone')
  })

  test('an avatar has its own budget: 1 primitive, ≤1024 vertices, ≤6144 indices', () => {
    const one = { attributes: { POSITION: position } }
    assert.equal(checkAddNode({ name: 'a', mesh: { primitives: [one] } }, { avatar: true }), null)
    assert.equal(checkAddNode({ name: 'a', mesh: { primitives: [one, one] } }, { avatar: true }).code, 'avatar-primitives')
    // A 20,000-primitive avatar is refused by the avatar budget, from the length alone.
    const many = new Array(20000).fill(one)
    const start = performance.now()
    assert.equal(checkAddNode({ name: 'a', mesh: { primitives: many } }, { avatar: true }).code, 'avatar-primitives')
    assert.ok(performance.now() - start < 500, 'refused from the length alone')
  })

  test('every real avatar carries extras.atrium.ephemeral and is accepted', () => {
    const node = {
      name: 'avatar-abc',
      translation: [0, 0.7, 0],
      extras: { displayName: 'Ann', atrium: { ephemeral: true } },
      mesh: { primitives: [{ attributes: { POSITION: position }, indices: [0, 1, 2] }] },
    }
    assert.equal(checkAddNode(node, { avatar: true }), null)
  })

  test('the node-level rules run even with no mesh (A2)', () => {
    assert.equal(checkAddNode({ name: 'a', extensions: { x: {} } }).code, 'extensions')
    assert.equal(checkAddNode({ name: 'a', extras: { blob: 'a'.repeat(17000) } }).code, 'extras-size')
  })

  test('material: {} and pbrMetallicRoughness: {} pass (glTF defaults)', () => {
    for (const material of [{}, { pbrMetallicRoughness: {} }]) {
      const node = { name: 'a', mesh: { primitives: [{ attributes: { POSITION: position }, material }] } }
      assert.equal(checkAddNode(node), null)
    }
  })
})
