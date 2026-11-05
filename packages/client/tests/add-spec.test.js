// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// add-spec.test.js — add-check step 1 (A1, client half). The client's
// `checkAddNode` against the SAME shared vectors the server's test reads.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAddNode, ADD_REASONS, addReasonText, isFloat32, isUnitRange, isUnitRangeVec4, isNonNegativeFinite } from '../src/add-spec.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/add-node-vectors.json'), 'utf8'))

describe('checkAddNode — the shared vectors (A1, client)', () => {
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
})

describe('add-spec — the range predicates (A9)', () => {
  test('isUnitRange is [0, 1] and finite', () => {
    assert.equal(isUnitRange(0), true)
    assert.equal(isUnitRange(1), true)
    assert.equal(isUnitRange(0.5), true)
    assert.equal(isUnitRange(-0.1), false)
    assert.equal(isUnitRange(1.1), false)
    assert.equal(isUnitRange(NaN), false)
    assert.equal(isUnitRange(Infinity), false)
    assert.equal(isUnitRange('0.5'), false)
  })

  test('isUnitRangeVec4 is four of them', () => {
    assert.equal(isUnitRangeVec4([0, 0.5, 1, 1]), true)
    assert.equal(isUnitRangeVec4([0, 0.5, 1]), false)
    assert.equal(isUnitRangeVec4([0, 0.5, 1, 1.1]), false)
  })

  test('isNonNegativeFinite is zero or more', () => {
    assert.equal(isNonNegativeFinite(0), true)
    assert.equal(isNonNegativeFinite(1e6), true)
    assert.equal(isNonNegativeFinite(-1), false)
    assert.equal(isNonNegativeFinite(NaN), false)
  })

  test('isFloat32 refuses 1e39 and accepts 3.4e38', () => {
    assert.equal(isFloat32(1e39), false)
    assert.equal(isFloat32(-1e39), false)
    assert.equal(isFloat32(3.4e38), true)
    assert.equal(isFloat32(Infinity), false)
  })
})

describe('add-spec — the codes', () => {
  test('every reason code has plain text', () => {
    for (const code of Object.keys(ADD_REASONS)) {
      assert.equal(typeof ADD_REASONS[code], 'string')
      assert.ok(ADD_REASONS[code].length > 0)
    }
  })
})
