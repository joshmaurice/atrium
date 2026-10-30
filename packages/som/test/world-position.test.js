// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// world-position.test.js — scripting-4c AC2 (Rev 1 M2): `worldPosition` moved
// into `@atrium/som`, so the server's `activate` distance check and the page's
// own pre-check measure with ONE implementation.
//
// The 4b-2 probe `p1` case is a test here (4b-2 P7): a `Switch` at local
// [3, 1, 0] inside a `Group` at [10, 0, 0] rotated 90° about Y and scaled 2 is
// at world [10, 2, -6] — about 9.3 m from its LOCAL translation, which is why
// the distance rule never uses `world.getNodeTranslation`.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { worldPosition } from '../src/index.js'

const S = Math.SQRT1_2   // sin/cos of 45°

function close(actual, expected, msg) {
  assert.equal(actual.length, expected.length, msg)
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-9, `${msg}: [${actual}] vs [${expected}]`)
  }
}

/** A stand-in node with the SOMNode getters `worldPosition` reads. */
function node(props = {}, parent = null) {
  const n = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], children: [], parent, ...props }
  if (parent) parent.children.push(n)
  return n
}

describe('AC2/M2 — worldPosition lives in @atrium/som', () => {
  test('a root node → exactly its translation', () => {
    assert.deepEqual(worldPosition(node({ translation: [3, 0, -2] })), [3, 0, -2])
  })

  test('a node with no transform fields → the origin', () => {
    assert.deepEqual(worldPosition({ parent: null }), [0, 0, 0])
  })

  test('a child of a translated parent', () => {
    const g = node({ translation: [10, 0, 0] })
    const pad = node({ translation: [1, 0, 0] }, g)
    close(worldPosition(pad), [11, 0, 0], 'translated parent')
  })

  test('P7: a node inside a rotated, scaled, translated group', () => {
    const group = node({ translation: [10, 0, 0], rotation: [0, S, 0, S], scale: [2, 2, 2] })
    const sw = node({ translation: [3, 1, 0] }, group)
    close(worldPosition(sw), [10, 2, -6], 'the probe p1 case')
    // ...and the local translation is a different place: 9.3 m away.
    const local = sw.translation
    const d = Math.hypot(local[0] - 10, local[1] - 2, local[2] + 6)
    assert.ok(Math.abs(d - 9.2736) < 0.001, `the local translation is about 9.27 m away (got ${d})`)
  })

  test('three levels of nesting compose', () => {
    const a = node({ translation: [1, 0, 0] })
    const b = node({ translation: [2, 0, 0] }, a)
    const c = node({ translation: [3, 0, 0] }, b)
    assert.deepEqual(worldPosition(c), [6, 0, 0])
  })
})
