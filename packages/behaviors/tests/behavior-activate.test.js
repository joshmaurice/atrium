// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-activate.test.js — scripting-4c AC2, the PAGE's copy of the shared
// click rule.
//
//  - `listensForSelect` and `withinActivateDistance` run the SHARED vectors
//    (tests/fixtures/behavior-vectors.json), which the server's own test
//    (packages/server/test/behavior-leaf.test.js) runs through its copy: the two
//    cannot drift.
//  - `selectTargetFor` is the ONE rule every tab uses to turn a hit into the
//    node a click selects. Its stand-in tree is not a real SOMDocument: the rule
//    reads only `extras.atrium.behavior`, `extras.atrium.ephemeral` and
//    `parent`, so an object literal is the exact value production passes.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { templateGraph } from '../src/templates.js'
import {
  listensForSelect, withinActivateDistance, selectTargetFor,
  ACTIVATE_MAX_DISTANCE,
} from '../src/behavior-spec.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-vectors.json'), 'utf8'))

const OWN = VECTORS.ownId
const TGT = VECTORS.targetId

/** A stand-in SOM node: the three fields `selectTargetFor` reads. */
function somNode(overrides = {}, parent = null) {
  const node = { name: 'n', extras: {}, parent, ...overrides }
  return node
}

/** A node carrying a stored behaviour leaf for one of the templates. */
function withBehaviour(id, params, overrides = {}) {
  return somNode({
    extras: { atrium: { behavior: templateGraph(id, params, { ownId: OWN }) } },
    ...overrides,
  })
}

const selectVis = () => withBehaviour('select-visibility', { target: TGT, action: 'toggle' })
const proximity = () => withBehaviour('proximity-animation', { target: TGT, clip: 'Walk', loop: true, radius: 3 })

describe('AC2 — listensForSelect through the shared vectors (page copy)', () => {
  test('the fixture carries the vectors and they are the ones the server reads too', () => {
    assert.ok(Array.isArray(VECTORS.listensForSelect) && VECTORS.listensForSelect.length >= 12)
    assert.ok(Array.isArray(VECTORS.withinActivateDistance) && VECTORS.withinActivateDistance.length >= 10)
  })

  test('every listensForSelect vector answers exactly its expected value', () => {
    for (const vector of VECTORS.listensForSelect) {
      assert.equal(listensForSelect(vector.value), vector.expected,
        `${vector.name}: expected ${vector.expected}`)
    }
  })

  test('it is TOTAL: a hostile value never throws', () => {
    const hostile = [
      undefined, null, 42, 'x', [], () => {}, Symbol('x'),
      { enabled: true }, { enabled: true, graph: null }, { enabled: true, graph: 'x' },
      { enabled: true, graph: { nodes: [1, null, 'x'] } },
      { enabled: true, graph: { nodes: [{ declaration: 99 }], declarations: [] } },
    ]
    for (const value of hostile) {
      assert.doesNotThrow(() => listensForSelect(value), `listensForSelect(${String(value)}) threw`)
      assert.equal(listensForSelect(value), false)
    }
  })

  test('the three select templates listen, and the other two do not', () => {
    assert.equal(listensForSelect(templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN })), true)
    assert.equal(listensForSelect(templateGraph('select-animation', { target: TGT, clip: 'Idle', action: 'play', loop: true }, { ownId: OWN })), true)
    assert.equal(listensForSelect(templateGraph('select-light', { target: TGT, intensity: 2 }, { ownId: OWN })), true)
    assert.equal(listensForSelect(templateGraph('proximity-animation', { target: TGT, clip: 'W', loop: true, radius: 3 }, { ownId: OWN })), false)
    assert.equal(listensForSelect(templateGraph('interval-animation', { target: TGT, clip: 'W', loop: true, seconds: 5 }, { ownId: OWN })), false)
  })
})

describe('AC2 — withinActivateDistance through the shared vectors (page copy)', () => {
  test('every distance vector answers exactly its expected value', () => {
    for (const vector of VECTORS.withinActivateDistance) {
      assert.equal(withinActivateDistance(vector.a, vector.b), vector.expected, vector.name)
    }
  })

  test('the max is 10 m and the comparison is INCLUSIVE', () => {
    assert.equal(ACTIVATE_MAX_DISTANCE, 10)
    assert.equal(withinActivateDistance([0, 0, 0], [10, 0, 0]), true, 'exactly 10 m passes')
    assert.equal(withinActivateDistance([0, 0, 0], [10.000001, 0, 0]), false)
  })

  test('a wider max is the third argument, and it is not a security boundary', () => {
    // The number it measures is a claim, not a proof — the rule makes activation
    // local and stops ordinary far-away clicks, nothing more (AC-L2, 4b-2 P8).
    assert.equal(withinActivateDistance([0, 0, 0], [50, 0, 0]), false)
    assert.equal(withinActivateDistance([0, 0, 0], [50, 0, 0], 100), true)
  })
})

describe('AC2 — selectTargetFor: the ONE rule every tab uses', () => {
  test('a hit on the behaviour node itself selects it', () => {
    const n = selectVis()
    assert.equal(selectTargetFor(n), n)
  })

  test('a model inner node reaches its host node', () => {
    const host = selectVis()
    const inner = somNode({ name: 'Fox_mesh' }, host)   // a model's own inner node
    assert.equal(selectTargetFor(inner), host)
  })

  test('an enabled NON-select behaviour stops the walk, and the answer is null', () => {
    const grandparent = selectVis()
    const parent = proximity()
    parent.parent = grandparent
    const child = somNode({ name: 'crate' }, parent)
    assert.equal(selectTargetFor(child), null,
      'the rule takes the FIRST enabled node; when it does not listen for select the walk does not continue past it')
  })

  test('a DISABLED behaviour on the parent is skipped, and the grandparent answers', () => {
    const grandparent = selectVis()
    const parent = proximity()
    parent.parent = grandparent
    parent.extras.atrium.behavior = { ...parent.extras.atrium.behavior, enabled: false }
    const child = somNode({ name: 'crate' }, parent)
    assert.equal(selectTargetFor(child), grandparent)
  })

  test('an avatar is skipped', () => {
    const host = selectVis()
    const avatar = somNode({ name: 'avatar-1', extras: { atrium: { ephemeral: true } } }, host)
    assert.equal(selectTargetFor(avatar), host)
  })

  test('no enabled behaviour anywhere → null', () => {
    const top = somNode({ name: 'top' })
    const mid = somNode({ name: 'mid' }, top)
    const hit = somNode({ name: 'scenery' }, mid)
    assert.equal(selectTargetFor(hit), null)
  })

  test('a null / undefined hit → null, and nothing throws', () => {
    assert.equal(selectTargetFor(null), null)
    assert.equal(selectTargetFor(undefined), null)
    assert.equal(selectTargetFor(somNode({ name: 'x', extras: { atrium: { behavior: 'nonsense' } } })), null)
  })

  test('the stored leaf may be a template the SERVER stored, and it still answers', () => {
    const node = selectVis()
    // The same value the server's `behaviorCheck` accepts is the one the rule
    // reads — no second, page-only field decides.
    assert.equal(selectTargetFor(node), node)
  })
})
