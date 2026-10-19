// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-modes.test.js — teleport-trigger activity is derived from the editing
// modes, in whatever order they're entered and left (Phase 3 step 1b-1, B1/E6),
// and pointer lock stays off while editing.
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

  test('Edit mode on while place mode was open: place mode closes, triggers stay inactive', () => {
    const { modes, active } = setup()
    modes.setTeleporterMode('placement')
    assert.equal(active(), false)
    modes.setEdit(true)
    assert.equal(modes.placement, false)
    // The exitTeleporterMode() path then runs and leaves its mode:
    modes.setTeleporterMode(null)
    assert.equal(active(), false, 'leaving a teleporter mode does not re-enable triggers mid-edit')
  })

  test('the resetTeleporterUi path while Edit mode is on → still inactive', () => {
    const { modes, active } = setup()
    modes.setEdit(true)
    modes.setTeleporterMode(null)        // resetTeleporterUi() leaves any mode
    assert.equal(active(), false)
  })

  test('a teleporter mode cannot be entered while Edit mode is on', () => {
    const { modes } = setup()
    modes.setEdit(true)
    assert.equal(modes.setTeleporterMode('placement'), false)
    assert.equal(modes.placement, false)
  })

  test('leaving Edit mode with no other mode → active', () => {
    const { modes, active } = setup()
    modes.setEdit(true)
    modes.setEdit(false)
    assert.equal(active(), true)
  })

  test('place mode on its own still switches triggers off and on', () => {
    const { modes, active } = setup()
    modes.setTeleporterMode('placement')
    assert.equal(active(), false)
    modes.setTeleporterMode(null)
    assert.equal(active(), true)
  })

  test("the retired 'delete' mode is refused and changes nothing (K4, Z6)", () => {
    const { modes, calls, active } = setup()
    assert.equal(modes.setTeleporterMode('delete'), false, 'refused')
    assert.equal(modes.placement, false)
    assert.equal(modes.triggerActive, true, 'triggers stay active')
    assert.deepEqual(calls, [], 'no mode change, so no trigger sync')
    assert.equal(active(), undefined, 'the trigger was never switched')
  })

  test('the delete getter is gone', () => {
    const { modes } = setup()
    assert.equal('delete' in modes, false)
    assert.equal(modes.delete, undefined)
  })

  test("'delete' is refused before and after a placement, without touching it", () => {
    const { modes, active } = setup()
    assert.equal(modes.setTeleporterMode('delete'), false)
    assert.equal(modes.setTeleporterMode('placement'), true)
    assert.equal(active(), false)
    assert.equal(modes.setTeleporterMode('delete'), false, 'refused while placing')
    assert.equal(modes.placement, true, 'placement is untouched')
    assert.equal(active(), false, 'still placing, triggers still off')
  })

  test('placement needs Edit mode off, exactly as before', () => {
    const { modes, active } = setup()
    modes.setEdit(true)
    assert.equal(modes.setTeleporterMode('placement'), false)
    modes.setEdit(false)
    assert.equal(modes.setTeleporterMode('placement'), true)
    assert.equal(active(), false)
  })

  test('disconnect while editing → every mode off, triggers active again', () => {
    const { modes, active } = setup()
    modes.setEdit(true)
    modes.reset()
    assert.equal(modes.edit, false)
    assert.equal(modes.placement, false)
    assert.equal(active(), true)
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
