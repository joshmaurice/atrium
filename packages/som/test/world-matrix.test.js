// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// world-matrix.test.js — scripting-4d-1 G-L4/G3: `localMatrix` and `worldMatrix`
// live in `@atrium/som` beside `worldPosition`, so the page's read-only
// `matrix` and `globalMatrix` pointers and every other caller use ONE
// implementation.
//
// The matrices are column-major, 16 numbers, as glTF's `matrix` property and
// KHR_interactivity's `/nodes/<i>/matrix` / `/nodes/<i>/globalMatrix` use them:
// the last column (elements 12, 13, 14) is the translation.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { localMatrix, worldMatrix, worldPosition } from '../src/index.js'

const S = Math.SQRT1_2   // sin/cos of 45°

function close(actual, expected, msg) {
  assert.equal(actual.length, expected.length, msg)
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-9, `${msg}: [${actual}] vs [${expected}]`)
  }
}

/** A stand-in node with the SOMNode getters these functions read. */
function node(props = {}, parent = null) {
  const n = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], children: [], parent, ...props }
  if (parent) parent.children.push(n)
  return n
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('G-L4 — localMatrix: T × R × S, column-major', () => {
  test('a node with no transform fields is the identity', () => {
    assert.deepEqual(localMatrix(node()), IDENTITY)
  })

  test('a translation lands in the last column (column-major)', () => {
    const m = localMatrix(node({ translation: [1, 2, 3] }))
    assert.deepEqual(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1])
  })

  test('a scale multiplies the three basis vectors', () => {
    const m = localMatrix(node({ scale: [2, 3, 4] }))
    assert.deepEqual(m, [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1])
  })

  test('a 90° rotation about Y maps +X to −Z', () => {
    const m = localMatrix(node({ rotation: [0, S, 0, S] }))
    close([m[0], m[1], m[2]], [0, 0, -1], 'the X basis vector')
    close([m[8], m[9], m[10]], [1, 0, 0], 'the Z basis vector')
  })

  test('an empty node and a null-ish node are the identity, never a throw', () => {
    assert.deepEqual(localMatrix(undefined), IDENTITY)
    assert.deepEqual(localMatrix({}), IDENTITY)
  })
})

describe('G-L4 — worldMatrix: the parent chain composed, root-first; a nested node equals it', () => {
  test('a root node → exactly its local matrix', () => {
    const n = node({ translation: [3, 0, -2], scale: [2, 2, 2] })
    assert.deepEqual(worldMatrix(n), localMatrix(n))
  })

  test('an empty node → the identity', () => {
    assert.deepEqual(worldMatrix({ parent: null }), IDENTITY)
  })

  test('a child of a translated parent adds the translation', () => {
    const g = node({ translation: [10, 0, 0] })
    const pad = node({ translation: [1, 0, 0] }, g)
    close([worldMatrix(pad)[12], worldMatrix(pad)[13], worldMatrix(pad)[14]], [11, 0, 0], 'translated parent')
  })

  test('three levels of nesting compose', () => {
    const a = node({ translation: [1, 0, 0] })
    const b = node({ translation: [2, 0, 0] }, a)
    const c = node({ translation: [3, 0, 0] }, b)
    close([worldMatrix(c)[12], worldMatrix(c)[13], worldMatrix(c)[14]], [6, 0, 0], 'three levels')
  })

  test('P7: a node inside a rotated, scaled, translated group', () => {
    const group = node({ translation: [10, 0, 0], rotation: [0, S, 0, S], scale: [2, 2, 2] })
    const sw = node({ translation: [3, 1, 0] }, group)
    const m = worldMatrix(sw)
    close([m[12], m[13], m[14]], [10, 2, -6], 'the probe p1 case')
    // The last column of the world matrix IS the node's world position: the two
    // functions in this package must agree.
    close([m[12], m[13], m[14]], worldPosition(sw), 'worldMatrix agrees with worldPosition')
  })

  test('a nested node: the composed matrix is the parent\'s world matrix times the local one', () => {
    const group = node({ translation: [10, 0, 0], rotation: [0, S, 0, S], scale: [2, 2, 2] })
    const child = node({ translation: [3, 1, 0], rotation: [0, 0, S, S], scale: [0.5, 0.5, 0.5] }, group)
    const viaWorld = worldMatrix(child)
    // Composing by hand: world(parent) × local(child), column-major.
    const w = worldMatrix(group)
    const l = localMatrix(child)
    const byHand = new Array(16)
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        byHand[col * 4 + row] = w[row] * l[col * 4] + w[4 + row] * l[col * 4 + 1] +
          w[8 + row] * l[col * 4 + 2] + w[12 + row] * l[col * 4 + 3]
      }
    }
    close(viaWorld, byHand, 'the nested composition')
    assert.notDeepEqual(viaWorld, localMatrix(child), 'the world matrix is not the local one')
  })
})
