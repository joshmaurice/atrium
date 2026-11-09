// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// scopedSelection.test.js — selection-parts T13 (PREBRIEF-selection-parts.md
// §4, SA-L6 (d), SP-L1 (a), SP-L2 (b)): a click selects the top-level object,
// a drill (a double-click) goes one level deeper toward the hit, a click
// stays at the level of the current selection, Alt goes to the leaf.
//
// Stand-ins carry only what the policy reads: `name`, `parent`, `mesh`. The
// tree is atrium.gltf's `Furniture` (names as in the fixture), space.gltf's
// lamp, a crate, and a group whose root has a mesh.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  topLevelAncestor,
  childToward,
  resolveScopedSelection,
} from '../src/selectionModel.js'
import * as index from '../src/index.js'

function n(name, parent = null, mesh = null) {
  return { name, parent, mesh }
}

const furniture = n('Furniture')
const benchNE = n('Bench-NE', furniture)
const seat = n('Bench-NE-Seat', benchNE, {})
const legLeft = n('Bench-NE-LegLeft', benchNE, {})
const table = n('Table-Center', furniture)
const tableTop = n('Table-Center-Top', table, {})
const lamp = n('lamp-01')
const shade = n('lamp-shade', lamp, {})
const stand = n('lamp-stand', lamp, {})
const crate = n('crate-01', null, {})
const building = n('building', null, {})       // a root WITH a mesh
const sign = n('sign', building, {})

const pick = (leaf, opts = {}) => resolveScopedSelection(leaf, opts)

describe('T13: topLevelAncestor and childToward', () => {
  it('topLevelAncestor is the node whose parent is null', () => {
    assert.equal(topLevelAncestor(seat), furniture)
    assert.equal(topLevelAncestor(furniture), furniture)
    assert.equal(topLevelAncestor(crate), crate)
  })
  it('childToward is the child of the ancestor on the path to the leaf', () => {
    assert.equal(childToward(furniture, seat), benchNE)
    assert.equal(childToward(benchNE, seat), seat)
    assert.equal(childToward(lamp, shade), shade)
  })
  it('childToward is null for the ancestor itself and for a leaf outside it', () => {
    assert.equal(childToward(furniture, furniture), null)
    assert.equal(childToward(benchNE, tableTop), null)
    assert.equal(childToward(lamp, seat), null)
  })
  it('the package index exports them', () => {
    assert.equal(index.resolveScopedSelection, resolveScopedSelection)
    assert.equal(index.topLevelAncestor, topLevelAncestor)
    assert.equal(index.childToward, childToward)
  })
})

describe('T13: resolveScopedSelection, nothing selected', () => {
  it('a click selects the top-level object', () => {
    assert.equal(pick(seat), furniture)
    assert.equal(pick(shade), lamp)
    assert.equal(pick(crate), crate)
  })
  it('a drill with nothing selected is still the top-level object', () => {
    assert.equal(pick(seat, { drill: true }), furniture)
  })
  it('a group whose root has a mesh: a click on its part selects the root (stated change)', () => {
    assert.equal(pick(sign), building)
  })
})

describe('T13: resolveScopedSelection, drilling (SP-L1 (a))', () => {
  it('a single click inside the current selection keeps it', () => {
    assert.equal(pick(seat, { current: furniture }), furniture)
    assert.equal(pick(shade, { current: lamp }), lamp)
  })
  it('a drill goes one level deeper toward the hit', () => {
    assert.equal(pick(seat, { current: furniture, drill: true }), benchNE)
    assert.equal(pick(seat, { current: benchNE, drill: true }), seat)
    assert.equal(pick(shade, { current: lamp, drill: true }), shade)
  })
  it('a drill on the leaf itself stays on the leaf', () => {
    assert.equal(pick(seat, { current: seat, drill: true }), seat)
  })
})

describe('T13: resolveScopedSelection, working inside a group (SP-L2 (b))', () => {
  it('a click on a sibling selects the sibling', () => {
    assert.equal(pick(legLeft, { current: seat }), legLeft)
    assert.equal(pick(stand, { current: shade }), stand)
  })
  it('a click on another branch selects at the level under the shared ancestor', () => {
    assert.equal(pick(tableTop, { current: seat }), table)
    assert.equal(pick(tableTop, { current: benchNE }), table)
  })
  it('a click outside the selection\'s top-level object selects the top-level object hit', () => {
    assert.equal(pick(shade, { current: seat }), lamp)
    assert.equal(pick(crate, { current: shade }), crate)
  })
})

describe('T13: resolveScopedSelection, Alt (descend)', () => {
  it('descend returns the leaf whatever current and drill', () => {
    assert.equal(pick(seat, { descend: true }), seat)
    assert.equal(pick(seat, { descend: true, current: furniture }), seat)
    assert.equal(pick(seat, { descend: true, current: shade, drill: true }), seat)
  })
})
