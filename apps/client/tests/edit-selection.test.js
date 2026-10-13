// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-selection.test.js — what an Edit-mode click selects (Phase 3 step 1b-1,
// B2). Stand-in nodes carry only what the module reads: parent, mesh, extras.
// The selection policy is the real one from @atrium/interaction.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveEditSelection, pickEditSelection, isSelectClick } from '../src/edit-selection.js'
import { resolveSelectionRoot } from '../../../packages/interaction/src/selectionModel.js'

function n(name, { parent = null, mesh = null, extras = {} } = {}) {
  return { name, parent, mesh, extras }
}

// A small world: a mesh-less group with two mesh parts, a root mesh, the local
// avatar with its camera child, a peer avatar, and an external container.
const group     = n('lamp')
const shade     = n('lamp-shade', { parent: group, mesh: {} })
const base      = n('lamp-base',  { parent: group, mesh: {} })
const crate     = n('crate', { mesh: {} })
const me        = n('User-aaaa', { mesh: {} })
const meCam     = n('__local_camera-child', { parent: me })
const peer      = n('User-bbbb', { mesh: {} })
const ext       = n('statue', { extras: { atrium: { source: 'statue.gltf' } } })
const extInner  = n('statue/Body', { parent: ext })
const extPart   = n('statue/Body/Head', { parent: extInner, mesh: {} })

const isExcluded = (node) => node === me || node.name === 'User-bbbb'
const opts = (descend = false) => ({ isExcluded, resolveRoot: resolveSelectionRoot, descend })

describe('edit-selection: resolveEditSelection', () => {
  test('own avatar, its camera child and a peer avatar select nothing', () => {
    assert.equal(resolveEditSelection(me, opts()), null)
    assert.equal(resolveEditSelection(meCam, opts()), null)
    assert.equal(resolveEditSelection(peer, opts()), null)
  })

  test('a part of an external container selects the outermost container', () => {
    assert.equal(resolveEditSelection(extPart, opts()), ext)
    assert.equal(resolveEditSelection(extPart, opts(true)), ext, 'Alt does not descend into external content')
  })

  test('default policy picks the nearest mesh-less ancestor', () => {
    assert.equal(resolveEditSelection(shade, opts()), group)
    assert.equal(resolveEditSelection(base, opts()), group)
  })

  test('Alt returns the hit node', () => {
    assert.equal(resolveEditSelection(shade, opts(true)), shade)
  })

  test('a root mesh selects itself', () => {
    assert.equal(resolveEditSelection(crate, opts()), crate)
  })

  test('no hit selects nothing', () => {
    assert.equal(resolveEditSelection(null, opts()), null)
  })
})

describe('edit-selection: pickEditSelection', () => {
  const seeThrough = (node) => node === me
  const pick = (hits, descend = false) => pickEditSelection(hits, { ...opts(descend), isSeeThrough: seeThrough })

  test('the local avatar in front is skipped: the crate behind it is selected', () => {
    assert.equal(pick([me, crate]), crate)
    assert.equal(pick([meCam, shade]), group)
  })

  test('a peer avatar in front still selects nothing', () => {
    assert.equal(pick([peer, crate]), null)
  })

  test('only the local avatar under the pointer selects nothing', () => {
    assert.equal(pick([me]), null)
    assert.equal(pick([]), null)
  })

  test('the nearest hit decides', () => {
    assert.equal(pick([crate, shade]), crate)
    assert.equal(pick([shade, crate], true), shade)
  })
})

describe('edit-selection: isSelectClick', () => {
  test('a press and release in place is a click', () => {
    assert.equal(isSelectClick({ x: 100, y: 100 }, { x: 102, y: 101 }), true)
  })

  test('moving 4 px or more is a look-drag, not a click', () => {
    assert.equal(isSelectClick({ x: 100, y: 100 }, { x: 104, y: 100 }), false)
    assert.equal(isSelectClick({ x: 100, y: 100 }, { x: 140, y: 120 }), false)
  })

  test('the click that ends a handle gesture never selects', () => {
    assert.equal(isSelectClick({ x: 100, y: 100 }, { x: 100, y: 100 }, { gestureEnded: true }), false)
  })

  test('a click with no recorded press does not select', () => {
    assert.equal(isSelectClick(null, { x: 1, y: 1 }), false)
  })
})
