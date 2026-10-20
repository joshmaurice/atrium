// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-modes.test.js — teleport-trigger activity is derived from the editing
// modes, in whatever order they're entered and left (Phase 3 step 1b-1, B1/E6),
// and pointer lock stays off while editing.
//
// Edit is the only editing mode (edit-polish-2, L6): the teleporter placement
// mode went with the toolbar's Place Teleporter, so `triggerActive` is `!edit`.
//
// `trigger` is the real createTeleportTrigger's setActive surface, recorded:
// the last value set is what the app's trigger would hold.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createEditModes } from '../src/edit-modes.js'

function setup({ pointerLock = false } = {}) {
  const calls = []
  const modes = createEditModes({ setTriggerActive: (a) => calls.push(a), pointerLock })
  return { modes, calls, active: () => calls.at(-1) }
}

describe('edit-modes: teleport triggers', () => {
  test('entering Edit mode from plain navigation → inactive', () => {
    const { modes, active } = setup()
    modes.setEdit(true)
    assert.equal(active(), false)
    assert.equal(modes.triggerActive, false)
  })

  test('leaving Edit mode with no other mode → active', () => {
    const { modes, active } = setup()
    modes.setEdit(true)
    modes.setEdit(false)
    assert.equal(active(), true)
    assert.equal(modes.triggerActive, true)
  })

  test('triggerActive is !edit through on, off and reset', () => {
    const { modes, calls } = setup()
    assert.equal(modes.triggerActive, true, 'a fresh object has triggers active')
    assert.deepEqual(calls, [], 'and has not touched the trigger yet')

    modes.setEdit(true)
    assert.equal(modes.triggerActive, false)
    modes.setEdit(false)
    assert.equal(modes.triggerActive, true)
    modes.setEdit(true)
    assert.equal(modes.triggerActive, false)
    modes.reset()
    assert.equal(modes.triggerActive, true, 'reset leaves every mode off')
    assert.deepEqual(calls, [false, true, false, true])
  })

  test('setEdit syncs every time, even when the value does not change', () => {
    const { modes, calls } = setup()
    modes.setEdit(true)
    modes.setEdit(true)
    assert.deepEqual(calls, [false, false])
    assert.equal(modes.triggerActive, false)
  })

  test('the reset while Edit mode is on → still inactive', () => {
    // The connection-lifecycle path: reset() runs while the Edit panel is up.
    const { modes, active } = setup()
    modes.setEdit(true)
    modes.reset()
    assert.equal(active(), true, 'reset turns every mode off, so triggers resume')
    assert.equal(modes.edit, false)
    assert.equal(modes.triggerActive, true)
  })

  test('the teleporter-mode API is gone (L6)', () => {
    const { modes } = setup()
    assert.equal(typeof modes.setTeleporterMode, 'undefined', 'setTeleporterMode is not a function any more')
    assert.equal('setTeleporterMode' in modes, false)
    assert.equal('placement' in modes, false, 'the placement getter is gone')
    assert.equal(Reflect.get(modes, 'placement'), undefined)
  })

  test('the delete getter is gone', () => {
    const { modes } = setup()
    assert.equal('delete' in modes, false, 'the mode is not readable any more')
    assert.equal(Reflect.get(modes, 'delete'), undefined)
  })

  test('the object exposes only Edit mode and pointer lock', () => {
    const { modes } = setup()
    assert.deepEqual(Object.keys(modes).sort(),
      ['edit', 'reset', 'setEdit', 'togglePointerLock', 'triggerActive', 'usePointerLock'])
  })
})

describe('edit-modes: pointer lock', () => {
  test('entering Edit mode with the lock preference on turns the lock off', () => {
    const { modes } = setup({ pointerLock: true })
    assert.equal(modes.usePointerLock, true)
    modes.setEdit(true)
    assert.equal(modes.usePointerLock, false)
  })

  test('M during Edit mode changes nothing', () => {
    const { modes } = setup({ pointerLock: false })
    modes.setEdit(true)
    assert.equal(modes.togglePointerLock(), false)
    assert.equal(modes.usePointerLock, false)
    modes.setEdit(false)
    assert.equal(modes.usePointerLock, false, 'the ignored M did not flip the preference')
  })

  test('leaving Edit mode restores the preference', () => {
    const { modes } = setup({ pointerLock: true })
    modes.setEdit(true)
    modes.setEdit(false)
    assert.equal(modes.usePointerLock, true)
  })

  test('M outside Edit mode toggles as before', () => {
    const { modes } = setup()
    assert.equal(modes.togglePointerLock(), true)
    assert.equal(modes.usePointerLock, true)
  })
})