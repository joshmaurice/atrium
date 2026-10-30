// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// world-position.test.js — teleporter zones and labels use world positions, so
// moving a group moves the pads inside it (Phase 3 step 1b-1, B7 / G13).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { worldPosition, subtreeSome } from '../src/world-position.js'
import { isTeleporter } from '../src/teleporter-marker.js'

const S = Math.SQRT1_2   // sin/cos of 45°

function close(actual, expected, msg) {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-9, `${msg}: [${actual}] vs [${expected}]`)
  }
}

function node(props = {}, parent = null) {
  const n = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], children: [], parent, ...props }
  if (parent) parent.children.push(n)
  return n
}

describe('world-position: worldPosition', () => {
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

  test('a child of a translated, rotated and scaled parent', () => {
    // Parent: at (5,0,0), rotated 90° about +Y, scaled 2.
    // Child local (1,0,0) → scaled (2,0,0) → rotated about +Y by 90° → (0,0,-2) → + (5,0,0).
    const g = node({ translation: [5, 0, 0], rotation: [0, S, 0, S], scale: [2, 2, 2] })
    const pad = node({ translation: [1, 0, 0] }, g)
    close(worldPosition(pad), [5, 0, -2], 'TRS parent')
  })

  test('three levels', () => {
    const a = node({ translation: [0, 1, 0] })
    const b = node({ translation: [0, 0, 4], rotation: [0, 0, S, S] }, a)   // 90° about +Z
    const c = node({ translation: [2, 0, 0] }, b)
    // c local (2,0,0) → rotated about +Z by 90° → (0,2,0) → + b (0,0,4) → (0,2,4) → + a (0,1,0) → (0,3,4)
    close(worldPosition(c), [0, 3, 4], 'three levels')
  })

  test('a non-uniform scale on the parent', () => {
    const g = node({ scale: [1, 3, 1] })
    const pad = node({ translation: [1, 1, 1] }, g)
    close(worldPosition(pad), [1, 3, 1], 'non-uniform scale')
  })
})

describe('world-position: subtreeSome', () => {
  test('finds a teleporter below a group, and in the node itself', () => {
    const g = node()
    const inner = node({}, g)
    const pad = node({ extras: { atrium: { teleporter: { destination: '/' } } } }, inner)
    assert.equal(subtreeSome(g, isTeleporter), true)
    assert.equal(subtreeSome(pad, isTeleporter), true)
  })

  test('false when nothing below is a teleporter', () => {
    const g = node()
    node({}, g)
    assert.equal(subtreeSome(g, isTeleporter), false)
    assert.equal(subtreeSome(null, isTeleporter), false)
  })
})

// ===========================================================================
// scripting-4c AC2 (Rev 1 M2) — the math moved to @atrium/som
// ===========================================================================

describe('AC2/M2 — src/world-position.js re-exports the @atrium/som function', () => {
  test('the app module and the som module hand out the SAME function', async () => {
    const som = await import('@atrium/som')
    assert.equal(worldPosition, som.worldPosition,
      'the page and the server must measure with one implementation, not two copies')
  })

  test('the som module has it whether or not the app module is loaded', async () => {
    const som = await import('@atrium/som')
    assert.equal(typeof som.worldPosition, 'function')
    assert.deepEqual(som.worldPosition(node({ translation: [3, 0, -2] })), [3, 0, -2])
  })

  test('the app module still exports subtreeSome, which the som module does not', async () => {
    const som = await import('@atrium/som')
    assert.equal(typeof subtreeSome, 'function')
    assert.equal('subtreeSome' in som, false, 'subtreeSome stays the page’s own walk')
  })
})
