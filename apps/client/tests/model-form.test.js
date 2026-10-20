// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-form.test.js — models-by-url step 7 (Z7): the Model form's logic, with
// fake elements. No DOM, no browser, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createModelForm, createFormGate, buildModelDescriptor, modelNameFromUrl,
  middleTruncate, checkSummary, DEFAULT_MODEL_NAME, PRIVACY_NOTE,
} from '../src/model-form.js'

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

function harness({ checkResult = { ok: true, vertices: 12400, bytes: 3250586, bounds: [1, 2, 3], sha256: 'abc', kind: 'glb' }, gate = createFormGate(), isNameFree = () => true } = {}) {
  const elements = {
    form: fakeElement(), url: fakeElement(), privacy: fakeElement(), check: fakeElement(),
    status: fakeElement(), pinRow: fakeElement(), pin: fakeElement(), error: fakeElement(),
    save: fakeElement(), cancel: fakeElement(),
  }
  const calls = { checks: [], descriptors: [], structure: [], undo: [], selected: [], refreshed: 0, closedOther: 0 }
  const bridge = { computeBounds: null }
  const form = createModelForm({
    elements,
    gate,
    deps: {
      checkModel: async (args) => { calls.checks.push(args); return typeof checkResult === 'function' ? checkResult(args) : checkResult },
      worldBaseUrl: () => 'https://world.example/worlds/me/room',
      placement: () => ({ position: [1, 0, 2], rotation: [0, Math.PI / 4, 0] }),
      isNameFree,
      firstFreeName: (text) => text,
      addNode: (descriptor) => { calls.descriptors.push(descriptor); return 42 },
      structureBegin: (seq, pending) => calls.structure.push({ seq, pending }),
      undoRegisterAdd: (seq, entry) => calls.undo.push({ seq, entry }),
      refreshActions: () => { calls.refreshed += 1 },
      selectNode: (name) => calls.selected.push(name),
    },
  })
  form.wire()
  return { elements, calls, form, gate, bridge }
}

test('Z7: the Model form is closed at start and shows the privacy note (L12)', () => {
  const h = harness()
  assert.equal(h.form.isOpen(), false)
  assert.equal(h.elements.form.style.display, 'none')
  assert.equal(h.elements.privacy.textContent, PRIVACY_NOTE)
  assert.equal(h.elements.save.disabled, true, 'Save is off before a Check')
})

test('Z7: Check → result → Save enabled, with the summary and the bounds kept', async () => {
  const h = harness()
  h.form.open()
  h.elements.url.value = 'https://host/chair.glb'
  h.elements.url.fire('input')
  assert.equal(h.elements.save.disabled, true)

  h.elements.check.fire('click')
  await tick()
  assert.equal(h.calls.checks.length, 1)
  assert.deepEqual(h.calls.checks[0], { url: 'https://host/chair.glb', worldBaseUrl: 'https://world.example/worlds/me/room' })
  assert.equal(h.elements.status.textContent, checkSummary({ vertices: 12400, bytes: 3250586 }))
  assert.equal(h.elements.save.disabled, false, 'Save is on after a successful Check')
  assert.deepEqual(h.form.specForSave().bounds, [1, 2, 3])
})

test('Z7: editing the URL clears the result and disables Save', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')
  await h.form.check()
  assert.equal(h.form.canSave(), true)
  h.form.onUrlInput('https://host/bench.glb')
  assert.equal(h.form.canSave(), false)
  assert.equal(h.form.specForSave(), null)
  assert.equal(h.elements.status.style.display, 'none', 'the result went with it')
})

test('Z7: a refused Check shows the reason, and no Save', async () => {
  const h = harness({ checkResult: { ok: false, reason: 'too-many-vertices', message: 'the model has too many vertices' } })
  h.form.open()
  h.form.onUrlInput('https://host/big.glb')
  await h.form.check()
  assert.equal(h.form.canSave(), false)
  assert.equal(h.elements.status.textContent, 'the model has too many vertices')
})

test('Z7: the client refuses a bad URL itself, without a fetch', async () => {
  const h = harness()
  h.form.open()
  for (const bad of ['chair.glb', 'http://host/chair.glb', 'javascript:alert(1)', '//host/chair.glb', '/\u0009evil.glb', '']) {
    h.form.onUrlInput(bad)
    await h.form.check()
    assert.equal(h.form.canSave(), false, `${bad} is refused`)
  }
  assert.equal(h.calls.checks.length, 0, 'nothing was fetched')
})

test('Z7/L9: the pin box is shown only for a checked .glb, and its hash rides the descriptor', async () => {
  const glb = harness()
  glb.form.open()
  glb.form.onUrlInput('https://host/chair.glb')
  assert.equal(glb.elements.pinRow.style.display, 'none', 'hidden before a Check')
  await glb.form.check()
  assert.equal(glb.elements.pinRow.style.display, '', 'shown for a checked .glb')

  glb.elements.pin.checked = true
  glb.elements.pin.fire('change')
  glb.form.save()
  assert.equal(glb.calls.descriptors[0].extras.atrium.model.sha256, 'abc')

  const gltf = harness({ checkResult: { ok: true, vertices: 10, bytes: 100, bounds: [1, 1, 1], sha256: null, kind: 'gltf' } })
  gltf.form.open()
  gltf.form.onUrlInput('https://host/scene.gltf')
  await gltf.form.check()
  assert.equal(gltf.elements.pinRow.style.display, 'none', 'a .gltf cannot be pinned (A12)')
})

test('Z7: Save builds the palette-shaped descriptor and registers it with undo', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/models/Chair-01.glb')
  await h.form.check()
  h.form.save()

  const descriptor = h.calls.descriptors[0]
  assert.deepEqual(descriptor, {
    name: 'Chair-01',
    translation: [1, 0, 2],
    rotation: [0, Math.PI / 4, 0],
    extras: {
      atrium: {
        model: {
          url: 'https://host/models/Chair-01.glb',
          bounds: [1, 2, 3],
        },
      },
    },
  })
  assert.equal('sha256' in descriptor.extras.atrium.model, false, 'unpinned: no sha256 key (Z7)')
  assert.equal(h.calls.structure[0].pending.model, true, 'the structure tracker is told it is a model')
  assert.deepEqual(h.calls.undo[0], { seq: 42, entry: { name: 'Chair-01', duplicate: false } })
  assert.equal(h.elements.save.textContent, 'Saving...')
  assert.equal(h.elements.save.disabled, true)
})

test('Z7: an accepted answer closes the form and selects the node', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')
  await h.form.check()
  const { seq } = h.form.save()

  assert.equal(h.form.onAnswer(seq, 'accepted'), true)
  assert.equal(h.form.isOpen(), false)
  assert.deepEqual(h.calls.selected, ['chair'])
})

test('Z7: a rejection waiting on this form shows in it and keeps it open', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')
  await h.form.check()
  const { seq } = h.form.save()

  h.form.onAnswer(seq, 'rejected', 'That name is taken')
  assert.equal(h.form.isOpen(), true, 'the form stays open for the owner')
  assert.equal(h.elements.error.textContent, 'That name is taken')
  assert.equal(h.elements.save.disabled, false, 'and Save is available again')
})

test('Z7: an unknown answer says so, and another form’s answer is ignored', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')
  await h.form.check()
  const { seq } = h.form.save()

  assert.equal(h.form.onAnswer(seq + 1, 'accepted'), false, 'not this form’s request')
  assert.equal(h.form.isOpen(), true)
  h.form.onAnswer(seq, 'unknown')
  assert.equal(h.elements.error.textContent, 'The world did not answer; try again')
  assert.equal(h.form.isOpen(), true)
})

test('Z7: Cancel, Escape, Edit off and a reconnect all close the form', async () => {
  for (const how of ['cancel', 'escape', 'edit-off', 'reconnect']) {
    const h = harness()
    h.form.open()
    h.form.onUrlInput('https://host/chair.glb')
    await h.form.check()
    assert.equal(h.form.canSave(), true)

    if (how === 'cancel') h.elements.cancel.fire('click')
    else if (how === 'escape') h.form.close()
    else if (how === 'edit-off') h.form.close()
    else h.form.reset()

    assert.equal(h.form.isOpen(), false, `${how} closes the form`)
    assert.equal(h.elements.form.style.display, 'none')
  }
})

test('Z7: closing the form drops a checked result (A8’s held template ends here)', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')
  await h.form.check()
  assert.equal(h.form.specForSave().bounds !== null, true)
  h.form.close()
  assert.equal(h.form.specForSave(), null)
})

test('Z7: the Teleporter and Model forms exclude each other', () => {
  const h = harness()
  const teleporter = { open: false }
  h.gate.register('teleporter', () => { teleporter.open = false })

  h.form.close()
  h.gate.claim('teleporter')
  teleporter.open = true
  assert.equal(h.gate.isOpen('teleporter'), true)

  h.form.open()
  assert.equal(teleporter.open, false, 'opening the Model form closed the Teleporter form')
  assert.equal(h.gate.isOpen('model'), true)
  assert.equal(h.form.isOpen(), true)

  // And the other way round: the Teleporter form's own open claims the gate.
  h.gate.claim('teleporter')
  assert.equal(h.form.isOpen(), true, 'the Model form’s close is the app’s call')
})

test('Z7: a name that cannot be made free is refused in the form', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')
  await h.form.check()
  h.calls.descriptors.length = 0
  // A second form whose isNameFree always says no.
  const elements = { save: fakeElement(), error: fakeElement(), form: fakeElement(), url: fakeElement(), status: fakeElement(), pinRow: fakeElement(), pin: fakeElement(), check: fakeElement(), cancel: fakeElement(), privacy: fakeElement() }
  const strict = createModelForm({
    elements,
    deps: {
      checkModel: async () => ({ ok: true, vertices: 1, bytes: 1, bounds: [1, 1, 1], sha256: null, kind: 'glb' }),
      isNameFree: () => false,
      firstFreeName: (x) => x,
      addNode: () => { throw new Error('should not be called') },
    },
  })
  strict.open()
  strict.onUrlInput('https://host/chair.glb')
  await strict.check()
  const saved = strict.save()
  assert.equal(saved, null)
  assert.equal(elements.error.textContent, 'No free name for a new model')
  assert.equal(strict.isOpen(), true)
})

test('Z7: a thrown addNode is reported in the form, not left saving', async () => {
  const elements = { save: fakeElement(), error: fakeElement(), form: fakeElement(), url: fakeElement(), status: fakeElement(), pinRow: fakeElement(), pin: fakeElement(), check: fakeElement(), cancel: fakeElement(), privacy: fakeElement() }
  const form = createModelForm({
    elements,
    deps: {
      checkModel: async () => ({ ok: true, vertices: 1, bytes: 1, bounds: [1, 1, 1], sha256: null, kind: 'glb' }),
      addNode: () => { throw new Error('offline') },
    },
  })
  form.open()
  form.onUrlInput('https://host/chair.glb')
  await form.check()
  assert.equal(form.save(), null)
  assert.equal(elements.error.textContent, 'Failed to add model: offline')
  assert.equal(elements.save.textContent, 'Save')
})

test('Z7: the pure helpers', () => {
  assert.equal(modelNameFromUrl('https://host/models/Chair-01.glb'), 'Chair-01')
  assert.equal(modelNameFromUrl('https://host/models/Chair%2001'), 'Chair%2001')
  assert.equal(modelNameFromUrl('https://host/'), DEFAULT_MODEL_NAME)
  assert.equal(modelNameFromUrl(''), DEFAULT_MODEL_NAME)
  assert.equal(modelNameFromUrl('/models/chair.gltf?a=1'), 'chair')

  assert.equal(middleTruncate('short', 44), 'short')
  const long = `https://host/${'x'.repeat(80)}/chair.glb`
  const cut = middleTruncate(long, 44)
  assert.equal(cut.length, 44)
  assert.ok(cut.includes('…'))
  assert.ok(cut.startsWith('https://host/'))
  assert.ok(cut.endsWith('chair.glb'))

  assert.deepEqual(buildModelDescriptor({ name: 'Chair', position: [0, 0, 0], rotation: [0, 0, 0], url: '/m.glb', bounds: [1, 1, 1] }).extras.atrium.model, { url: '/m.glb', bounds: [1, 1, 1] })
})

const tick = () => new Promise((r) => setTimeout(r, 0))
