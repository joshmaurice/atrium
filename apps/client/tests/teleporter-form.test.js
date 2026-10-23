// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// teleporter-form.test.js — edit-polish-3 Z3 (L2a): the destination form's logic,
// with fake elements. No DOM, no browser, no network.
//
// The form used to live inside app.js, where five mutations of it passed every
// test (the edit-polish-2 review's should-fix). This file pins the whole state
// machine: the four listeners, the fresh-open order, the world list's ownership,
// the validation messages, the send, the three answers and the gate.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTeleporterForm } from '../src/teleporter-form.js'
import { createFormGate } from '../src/model-form.js'

/** A stand-in for the DOM element the page hands in. */
function fakeElement() {
  const listeners = new Map()
  return {
    value: '',
    textContent: '',
    title: '',
    disabled: false,
    checked: false,
    style: { display: 'none' },
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    fire(type) {
      for (const fn of listeners.get(type) ?? []) fn()
    },
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

const WORLD = { value: '/worlds/me/room', label: 'Room' }
const OTHER_WORLD = { value: '/worlds/me/garden', label: 'Garden' }

function harness({
  listWorlds,
  gate = createFormGate(),
  dispatchAllowed = () => true,
  nearSpawn = () => false,
  teleporterName = () => 'Teleporter',
  isValidDestination = () => true,
  resolveDestination = (dest) => `wss://host${dest}`,
  addNode,
} = {}) {
  const elements = {
    form: fakeElement(), worldSelect: fakeElement(), destInput: fakeElement(),
    spawnWarn: fakeElement(), error: fakeElement(), save: fakeElement(), cancel: fakeElement(),
  }
  const calls = {
    lists: 0, fills: [], descriptors: [], structure: [], undo: [],
    selected: [], refreshed: 0, cleared: 0, descriptorArgs: null,
  }
  const form = createTeleporterForm({
    elements,
    gate,
    deps: {
      listWorlds: listWorlds ?? (() => { calls.lists += 1; return Promise.resolve([WORLD]) }),
      fillWorlds: (options, opts = {}) => calls.fills.push({ options, ...opts }),
      isValidDestination,
      resolveDestination,
      teleporterName,
      buildDescriptor: (args) => {
        calls.descriptorArgs = args
        return { name: args.name, translation: args.position, extras: { atrium: { teleporter: { destination: args.destination } } } }
      },
      addNode: (descriptor) => {
        if (addNode) return addNode(descriptor)
        calls.descriptors.push(descriptor)
        return 77 + calls.descriptors.length - 1
      },
      structureBegin: (seq, pending) => calls.structure.push({ seq, pending }),
      undoRegisterAdd: (seq, entry) => calls.undo.push({ seq, entry }),
      refreshActions: () => { calls.refreshed += 1 },
      dispatchAllowed,
      nearSpawn,
      clearEditError: () => { calls.cleared += 1 },
      selectNode: (name) => calls.selected.push(name),
    },
  })
  form.wire()
  return { elements, calls, form, gate }
}

/** Open the form, choose a destination and Save: the state the answers arrive in. */
function openAndSave(h, position = [1, 0, 2], dest = '/worlds/me/room') {
  h.form.open(position)
  h.elements.destInput.value = dest
  h.elements.destInput.fire('input')
  return h.form.save()
}

// ===========================================================================
// wire() — the module owns all four listeners (review 4)
// ===========================================================================

test('Z3: choosing a listed world enables Save, and typing a destination does too', () => {
  const h = harness()
  h.form.open([1, 0, 2])
  assert.equal(h.elements.save.disabled, true, 'a fresh open leaves Save off')

  h.elements.worldSelect.value = WORLD.value
  h.elements.worldSelect.fire('change')
  assert.equal(h.elements.save.disabled, false, 'a chosen world enables Save')
  assert.equal(h.elements.save.textContent, 'Save')
})

test('Z3: Save follows the destination box exactly — non-blank on, blank off', () => {
  const h = harness()
  h.form.open([1, 0, 2])

  h.elements.destInput.value = '   '
  h.elements.destInput.fire('input')
  assert.equal(h.elements.save.disabled, true, 'whitespace is blank')

  h.elements.destInput.value = '/worlds/me/room'
  h.elements.destInput.fire('input')
  assert.equal(h.elements.save.disabled, false)

  h.elements.destInput.value = ''
  h.elements.destInput.fire('input')
  assert.equal(h.elements.save.disabled, true, 'and blank disables it again')
})

test('Z3: both fields hide the last error, and Save is refused while one is up', () => {
  const h = harness()
  h.form.open([1, 0, 2])
  h.form.save()
  assert.equal(h.elements.error.style.display, '', 'the empty-destination message shows')

  h.elements.worldSelect.value = WORLD.value
  h.elements.worldSelect.fire('change')
  assert.equal(h.elements.error.style.display, 'none', 'the world change hides it')

  const g = harness()
  g.form.open([1, 0, 2])
  g.form.save()
  g.elements.destInput.value = '/x'
  g.elements.destInput.fire('input')
  assert.equal(g.elements.error.style.display, 'none', 'typing hides it too')
})

test('Z3: the module reads its own elements — app.js adds no listeners', () => {
  // Every rule above ran through `wire()`; a second wire() would double them.
  const h = harness()
  h.form.open([1, 0, 2])
  h.elements.destInput.value = '/worlds/me/room'
  h.elements.destInput.fire('input')
  assert.equal(h.elements.save.disabled, false)
  h.elements.save.fire('click')
  assert.equal(h.form.waitSeq, 77, 'the Save button is the module’s listener')
  h.elements.cancel.fire('click')
  assert.equal(h.form.isOpen(), false, 'and so is Cancel’s')
})

// ===========================================================================
// open() — the fresh open, and the world list's ownership
// ===========================================================================

test('Z3: a fresh open empties the fields and the list BEFORE the worlds answer', async () => {
  const pending = deferred()
  const h = harness({ listWorlds: () => pending.promise })

  h.form.open([1, 0, 2])

  // Synchronously — the answer has not landed.
  assert.equal(h.elements.destInput.value, '')
  assert.equal(h.elements.worldSelect.value, '')
  assert.deepEqual(h.calls.fills, [{ options: [], loading: true }], 'the list is in its loading state')
  assert.equal(h.elements.save.disabled, true)
  assert.equal(h.elements.error.style.display, 'none')

  pending.resolve([WORLD, OTHER_WORLD])
  await tick()
  assert.equal(h.calls.fills.length, 2, 'and the answer fills it once')
  assert.deepEqual(h.calls.fills[1].options, [WORLD, OTHER_WORLD])
})

test('Z3: a world on another server is manual entry only (and asks for no list)', () => {
  const h = harness({ listWorlds: () => null })
  h.form.open([1, 0, 2])
  assert.deepEqual(h.calls.fills, [{ options: [], manualOnly: true }])
  assert.equal(h.calls.lists, 0, 'the adapter answered null without asking')
})

test('Z3: an opening while already open keeps what was typed and the list', async () => {
  const h = harness()
  h.form.open([1, 0, 2])
  await tick()
  assert.equal(h.calls.fills.length, 2)

  h.elements.worldSelect.value = WORLD.value
  h.elements.worldSelect.fire('change')
  h.elements.destInput.value = '/worlds/me/garden'
  h.elements.destInput.fire('input')

  h.form.open([5, 0, 5])                       // the Teleporter button again
  assert.equal(h.elements.worldSelect.value, WORLD.value, 'the typed choice stays')
  assert.equal(h.elements.destInput.value, '/worlds/me/garden')
  assert.equal(h.calls.fills.length, 2, 'and the list was not rebuilt')
  assert.deepEqual(h.form.position, [5, 0, 5], 'the new position is taken')
})

test('Z3: the spawn warning is recomputed on every opening', () => {
  let near = true
  const h = harness({ nearSpawn: () => near })
  h.form.open([0, 0, 0])
  assert.equal(h.elements.spawnWarn.style.display, '', 'near the spawn: the note shows')
  near = false
  h.form.open([20, 0, 20])
  assert.equal(h.elements.spawnWarn.style.display, 'none', 'and it hides away from it')
})

test('Z3: an opening is refused while the form waits on its own Save', () => {
  const h = harness()
  const sent = openAndSave(h)
  assert.equal(h.form.waitSeq, sent.seq)
  assert.equal(h.form.open([9, 0, 9]), false, 'the button does nothing while saving')
  assert.equal(h.elements.save.textContent, 'Saving...')
})

test('Z3: a late world list after a close is dropped', async () => {
  const pending = deferred()
  const h = harness({ listWorlds: () => pending.promise })
  h.form.open([1, 0, 2])
  assert.equal(h.calls.fills.length, 1)

  h.form.close()
  pending.resolve([WORLD])
  await tick()
  assert.equal(h.calls.fills.length, 1, 'the closed form’s answer changes nothing')
})

test('Z3: a late world list after a NEWER opening is dropped (P3’s duplicate bug)', async () => {
  const first = deferred()
  const second = deferred()
  const answers = [first, second]
  const h = harness({ listWorlds: () => answers.shift().promise })

  h.form.open([1, 0, 2])          // opening 1 asks
  h.form.close()
  h.form.open([1, 0, 2])          // opening 2 asks
  assert.equal(h.calls.fills.length, 2, 'both fresh opens set the loading state')

  // The FIRST answer arrives after the second opening: it must not fill the list.
  first.resolve([WORLD])
  await tick()
  assert.equal(h.calls.fills.length, 2, 'the stale answer added nothing')

  second.resolve([OTHER_WORLD])
  await tick()
  assert.equal(h.calls.fills.length, 3)
  assert.deepEqual(h.calls.fills[2].options, [OTHER_WORLD], 'only the current opening’s worlds arrive')
})

test('Z3: a rejected world list changes nothing', async () => {
  const pending = deferred()
  const h = harness({ listWorlds: () => pending.promise })
  h.form.open([1, 0, 2])
  pending.reject(new Error('offline'))
  await tick()
  assert.equal(h.calls.fills.length, 1, 'no second fill, and no throw')
})

// ===========================================================================
// save() — the validation, the send, and the hidden error
// ===========================================================================

test('Z3: the three validation messages, in today’s order', () => {
  const h = harness()
  h.form.open([1, 0, 2])

  h.form.save()
  assert.equal(h.elements.error.textContent, 'Select a world or enter a destination')
  assert.equal(h.calls.descriptors.length, 0)

  const bad = harness({ isValidDestination: () => false })
  bad.form.open([1, 0, 2])
  bad.elements.destInput.value = '/worlds/me/room'
  bad.elements.destInput.fire('input')
  bad.form.save()
  assert.equal(bad.elements.error.textContent, 'Invalid destination — enter a path (e.g. /worlds/user/slug) or ws(s) URL')

  const unresolved = harness({ resolveDestination: () => null })
  unresolved.form.open([1, 0, 2])
  unresolved.elements.destInput.value = '/worlds/me/room'
  unresolved.elements.destInput.fire('input')
  unresolved.form.save()
  assert.equal(unresolved.elements.error.textContent, 'Invalid destination — enter a path (e.g. /worlds/user/slug) or ws(s) URL')

  const unnamed = harness({ teleporterName: () => null })
  unnamed.form.open([1, 0, 2])
  unnamed.elements.destInput.value = '/worlds/me/room'
  unnamed.elements.destInput.fire('input')
  unnamed.form.save()
  assert.equal(unnamed.elements.error.textContent, 'No free name for a new teleporter')
  assert.equal(unnamed.calls.descriptors.length, 0)
})

test('Z3: Save is refused while Edit mode is off or something blocks', () => {
  const h = harness({ dispatchAllowed: () => false })
  h.form.open([1, 0, 2])
  h.elements.destInput.value = '/worlds/me/room'
  h.elements.destInput.fire('input')
  assert.equal(h.form.save(), null)
  assert.equal(h.calls.descriptors.length, 0, 'nothing is sent')
})

test('Z3: a Save sends once, with teleporter: true, and registers the undo entry', () => {
  const h = harness()
  const sent = openAndSave(h, [1, 0, 2])

  assert.equal(sent.seq, 77)
  assert.equal(sent.name, 'Teleporter')
  assert.equal(h.calls.descriptors.length, 1)
  assert.deepEqual(h.calls.descriptorArgs, { name: 'Teleporter', position: [1, 0, 2], destination: '/worlds/me/room' })
  assert.equal(h.calls.structure.length, 1)
  assert.equal(h.calls.structure[0].seq, 77)
  assert.equal(h.calls.structure[0].pending.teleporter, true, 'the request is marked as a pad’s')
  assert.equal(h.calls.structure[0].pending.name, 'Teleporter')
  assert.deepEqual(h.calls.undo, [{ seq: 77, entry: { name: 'Teleporter', duplicate: false } }])
  assert.equal(h.calls.cleared, 1, 'the panel’s error line is cleared')
  assert.equal(h.form.waitSeq, 77)
  assert.equal(h.elements.save.textContent, 'Saving...')
  assert.equal(h.elements.save.disabled, true)
  assert.equal(h.elements.cancel.disabled, true)
})

test('Z3: a double Save sends ONE request', () => {
  const h = harness()
  const sent = openAndSave(h)
  assert.equal(h.form.save(), null, 'the second click is refused while the first waits')
  h.elements.save.fire('click')                    // and so is a second DOM click
  assert.equal(h.calls.descriptors.length, 1)
  assert.equal(h.calls.structure.length, 1)
  assert.equal(h.calls.undo.length, 1)
  assert.equal(h.form.waitSeq, sent.seq)
})

test('Z3: the OLD error goes when the next Save dispatches (P3’s first bug)', () => {
  const h = harness()
  const sent = openAndSave(h)
  h.form.onAnswer(sent.seq, 'rejected', 'that destination is taken')
  assert.equal(h.elements.error.textContent, 'that destination is taken')
  assert.equal(h.elements.error.style.display, '')
  assert.equal(h.elements.save.disabled, false, 'and Save is offered again')
  assert.equal(h.elements.save.textContent, 'Save')

  const again = h.form.save()
  assert.equal(again.seq, 78, 'the retry sends')
  assert.equal(h.elements.error.textContent, '', 'the old error is gone as it dispatches')
  assert.equal(h.elements.error.style.display, 'none')
  assert.equal(h.elements.save.textContent, 'Saving...')
})

test('Z3: an unchanged error is not resurrected by validation', () => {
  // The order matters: the error is hidden when the write dispatches, and the
  // dispatch only happens after every rule passed.
  const h = harness()
  h.form.open([1, 0, 2])
  h.form.save()
  assert.equal(h.elements.error.textContent, 'Select a world or enter a destination')
  h.elements.destInput.value = '/worlds/me/room'
  h.elements.destInput.fire('input')
  assert.equal(h.elements.error.style.display, 'none', 'typing hid it (the field’s own rule)')
  const sent = h.form.save()
  assert.ok(sent)
})

test('Z3: a throw from addNode shows its message and re-enables Save', () => {
  const h = harness({ addNode: () => { throw new Error('no room at the origin') } })
  const result = openAndSave(h)
  assert.equal(result, null)
  assert.equal(h.elements.error.textContent, 'Failed to place teleporter: no room at the origin')
  assert.equal(h.elements.save.disabled, false)
  assert.equal(h.form.waitSeq, null, 'nothing is waited on')
  assert.equal(h.calls.structure.length, 0)
  assert.equal(h.calls.undo.length, 0)
})

// ===========================================================================
// onAnswer() — the three answers, and an answer that is not ours
// ===========================================================================

test('Z3: an accepted answer closes the form and selects the new pad', () => {
  const h = harness()
  const sent = openAndSave(h)
  assert.equal(h.form.onAnswer(sent.seq, 'accepted'), true)
  assert.equal(h.form.isOpen(), false)
  assert.equal(h.elements.form.style.display, 'none')
  assert.deepEqual(h.calls.selected, ['Teleporter'])
  assert.equal(h.form.waitSeq, null)
  assert.equal(h.gate.current, null, 'and the gate is free')
})

test('Z3: a rejection shows its message, keeps what was typed and re-enables Save', () => {
  const h = harness()
  const sent = openAndSave(h)
  assert.equal(h.form.onAnswer(sent.seq, 'rejected', 'that destination is taken'), true)
  assert.equal(h.form.isOpen(), true, 'the form stays open')
  assert.equal(h.elements.error.textContent, 'that destination is taken')
  assert.equal(h.elements.save.disabled, false)
  assert.equal(h.elements.cancel.disabled, false)
  assert.equal(h.elements.destInput.value, '/worlds/me/room', 'what was typed is kept')
  assert.equal(h.form.waitSeq, null)
  assert.deepEqual(h.calls.selected, [], 'nothing is selected by a rejection')
})

test('Z3: a rejection with no message still says something', () => {
  const h = harness()
  const sent = openAndSave(h)
  h.form.onAnswer(sent.seq, 'rejected')
  assert.equal(h.elements.error.textContent, 'Failed to place teleporter')
})

test('Z3: an unknown answer says so and re-enables Save', () => {
  const h = harness()
  const sent = openAndSave(h)
  assert.equal(h.form.onAnswer(sent.seq, 'unknown'), true)
  assert.equal(h.elements.error.textContent, 'The world did not answer; try again')
  assert.equal(h.elements.save.disabled, false)
  assert.equal(h.form.isOpen(), true)
})

test('Z3: an answer for another seq returns false and changes nothing', () => {
  const h = harness()
  const sent = openAndSave(h)
  const before = { open: h.form.isOpen(), error: h.elements.error.textContent, save: h.elements.save.disabled }
  for (const status of ['accepted', 'rejected', 'unknown']) {
    assert.equal(h.form.onAnswer(sent.seq + 1, status, 'x'), false, status)
  }
  assert.equal(h.form.isOpen(), before.open)
  assert.equal(h.elements.error.textContent, before.error)
  assert.equal(h.elements.save.disabled, before.save)
  assert.equal(h.form.waitSeq, sent.seq, 'the form still waits on its own request')
  assert.deepEqual(h.calls.selected, [])
})

test('Z3: Z2 — an accepted answer for a CLOSED form selects nothing', () => {
  // Edit off closes the form; the answer arrives afterwards. Through the
  // module’s `false` return, app.js’s branch then selects nothing (the app-wiring
  // test pins that half).
  const h = harness()
  const sent = openAndSave(h)
  h.form.close()                                   // Edit off
  assert.equal(h.form.onAnswer(sent.seq, 'accepted'), false)
  assert.deepEqual(h.calls.selected, [], 'nothing is selected')
  assert.equal(h.form.isOpen(), false)

  // Edit back on, another node selected, and the answer arrives.
  h.form.open([1, 0, 2])
  h.elements.destInput.value = '/worlds/me/room'
  h.elements.destInput.fire('input')
  assert.equal(h.form.onAnswer(sent.seq, 'accepted'), false)
  assert.deepEqual(h.calls.selected, [], 'still nothing: the form owns no wait')
})

// ===========================================================================
// close(), reset() and the gate
// ===========================================================================

test('Z3: closing while saving forgets the wait only — the undo entry stays', () => {
  const h = harness()
  const sent = openAndSave(h)
  h.form.close()
  assert.equal(h.form.waitSeq, null)
  assert.equal(h.form.isOpen(), false)
  assert.equal(h.elements.form.style.display, 'none')
  assert.equal(h.elements.error.style.display, 'none')
  assert.equal(h.elements.save.textContent, 'Save')
  assert.equal(h.elements.save.disabled, true)
  assert.equal(h.calls.undo.length, 1, 'the add is still undoable (Y7)')
  assert.equal(h.form.onAnswer(sent.seq, 'accepted'), false, 'and its answer is not the form’s')
  assert.deepEqual(h.calls.selected, [])
})

test('Z3: reset() closes the form and forgets the wait', () => {
  const h = harness()
  openAndSave(h)
  h.form.reset()
  assert.equal(h.form.isOpen(), false)
  assert.equal(h.form.waitSeq, null)
  assert.equal(h.elements.form.style.display, 'none')
  assert.equal(h.elements.save.disabled, true)
  assert.equal(h.gate.current, null)
})

test('Z3: opening claims the gate, and another form’s open closes this one', () => {
  const h = harness()
  // Exactly app.js's registration: the gate closes this form.
  h.gate.register('teleporter', () => h.form.close())
  h.gate.register('model', () => {})
  h.form.open([1, 0, 2])
  assert.equal(h.gate.current, 'teleporter')
  assert.equal(h.gate.isOpen('teleporter'), true)

  h.gate.claim('model')                            // the Model button
  assert.equal(h.form.isOpen(), false, 'the destination form closed through the gate')
  assert.equal(h.gate.current, 'model')
})

test('Z3: close() releases only its own claim', () => {
  const h = harness()
  h.gate.register('model', () => {})
  h.gate.claim('model')
  h.form.close()                                   // a form that is not open at all
  assert.equal(h.gate.current, 'model', 'the Model form’s claim survives')
})

test('Z3: a form built without the gate still works', () => {
  const elements = {
    form: fakeElement(), worldSelect: fakeElement(), destInput: fakeElement(),
    spawnWarn: fakeElement(), error: fakeElement(), save: fakeElement(), cancel: fakeElement(),
  }
  const form = createTeleporterForm({ elements, deps: { fillWorlds: () => {} } })
  form.open([0, 0, 0])
  assert.equal(form.isOpen(), true)
  form.close()
  assert.equal(form.isOpen(), false)
})
