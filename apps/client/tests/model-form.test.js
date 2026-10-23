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
import { modelReasonText } from '@atrium/client/model-spec'

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
  const calls = { checks: [], descriptors: [], structure: [], undo: [], selected: [], refreshed: 0, closedOther: 0, dropped: 0 }
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
      onDropResult: () => { calls.dropped += 1 },
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

// V5 (round 2) — a refused URL used to put the raw reason code (`url-scheme`,
// `url-chars`) in `#model-status`, where the owner reads it. Nothing about the
// codes is user-facing.
test('V5: a refused URL reads as plain text in the status, never as a raw code', async () => {
  const h = harness()
  h.form.open()
  const cases = [
    ['http://host/chair.glb', 'url-scheme'],
    ['javascript:alert(1)', 'url-scheme'],
    ['http://[bad/m.glb', 'url-scheme'],
    ['//host/chair.glb', 'url-scheme'],
    ['/evil\u0009.glb', 'url-chars'],
    ['https://host/a b.glb', 'url-chars'],
    ['https://host/a\\b.glb', 'url-chars'],
  ]
  for (const [bad, code] of cases) {
    h.form.onUrlInput(bad)
    await h.form.check()
    const shown = h.elements.status.textContent
    assert.equal(shown, modelReasonText(code), `${JSON.stringify(bad)} reads as its plain text`)
    assert.equal(h.elements.status.style.display, '', 'the status line is shown')
    assert.notEqual(shown, code, 'and never the raw code')
    assert.ok(!/^url-/.test(shown), `no reason code leaks into the panel: ${shown}`)
    assert.equal(h.form.canSave(), false)
  }
  assert.equal(h.calls.checks.length, 0, 'still nothing fetched')
})

test('V5: a URL over the length cap reads as plain text too', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput(`https://host/${'a'.repeat(2100)}.glb`)
  await h.form.check()
  assert.equal(h.elements.status.textContent, modelReasonText('url-length'))
  assert.equal(h.calls.checks.length, 0)
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

// ---------------------------------------------------------------------------
// S3 (round 6) — a late Check result must not land on a different URL
//
// The outside reviewer's sequence: Check `old.glb`, change the URL to
// `new.glb`, and let the old result arrive. Round 5 had no generation: the late
// result set `state.result`, so Save was enabled for a URL that had never been
// checked and the page held a template the form had already let go.
// ---------------------------------------------------------------------------

test('S3: a Check whose result arrives after the URL changed is ignored, and nothing is held', async () => {
  const pending = []
  const h = harness({ checkResult: () => new Promise((resolve) => pending.push(resolve)) })
  h.form.open()
  h.form.onUrlInput('https://host/old.glb')
  const checking = h.form.check()
  await tick()
  assert.equal(pending.length, 1, 'the old Check is in flight')
  assert.equal(h.form.state.checking, true)

  h.form.onUrlInput('https://host/new.glb')          // the reviewer's edit
  pending[0]({ ok: true, vertices: 12400, bytes: 3250586, bounds: [1, 2, 3], sha256: 'abc', kind: 'glb' })
  await checking
  await tick()

  assert.equal(h.form.canSave(), false, 'Save stays disabled: new.glb was never checked')
  assert.equal(h.form.specForSave(), null)
  assert.equal(h.elements.status.style.display, 'none', 'the late result is not shown')
  // Z5 (this round) — the stale result changes NOTHING, `onDropResult` included.
  // Both drops here are the two URL edits; the late settle adds none.
  assert.equal(h.calls.dropped, 2, 'the URL edits gave the reference back; the stale result holds nothing')
})

// ---------------------------------------------------------------------------
// Z5 (this round) — the S3 residual in the form: a result whose generation is
// no longer current changes NOTHING. Round 6 called `onDropResult` on a stale
// result and then cleared `checking` in `finally`, so a stale Check could
// release the reference a NEWER Check was still holding and re-enable the Check
// button under it.
// ---------------------------------------------------------------------------

test('Z5: the sequence — A waits, a world change, B starts, A settles, B settles', async () => {
  const pending = []
  const h = harness({ checkResult: () => new Promise((resolve) => pending.push(resolve)) })
  h.form.open()
  h.form.onUrlInput('https://host/a.glb')
  const first = h.form.check()
  await tick()
  assert.equal(pending.length, 1, 'A is in flight')

  h.form.reset()                       // the world change: the form forgets everything
  h.form.open()
  h.form.onUrlInput('https://host/b.glb')
  const second = h.form.check()
  await tick()
  assert.equal(pending.length, 2, 'B is in flight too')
  const droppedBeforeStale = h.calls.dropped

  pending[0]({ ok: true, vertices: 1, bytes: 1, bounds: [1, 1, 1], sha256: null, kind: 'glb' })
  await first

  assert.equal(h.form.state.checking, true, 'checking still belongs to B')
  assert.equal(h.elements.check.disabled, true, 'so Check is still disabled')
  assert.equal(h.form.canSave(), false, 'and A’s result is not held')
  assert.equal(h.calls.dropped, droppedBeforeStale, 'a stale result drops nothing')

  pending[1]({ ok: true, vertices: 2, bytes: 2, bounds: [2, 2, 2], sha256: null, kind: 'glb' })
  await second
  assert.equal(h.form.state.checking, false)
  assert.equal(h.form.canSave(), true, 'B’s result IS held')
  assert.equal(h.form.specForSave().url, 'https://host/b.glb')
})

test('Z5: a stale ERROR changes nothing either', async () => {
  const pending = []
  const h = harness({ checkResult: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
  h.form.open()
  h.form.onUrlInput('https://host/a.glb')
  const checking = h.form.check()
  await tick()

  h.form.onUrlInput('https://host/b.glb')
  const droppedBeforeStale = h.calls.dropped
  pending[0].reject(new Error('502 from /api/auth/me'))
  await checking
  await tick()

  assert.equal(h.form.state.problem, null, 'the stale error is not shown')
  assert.equal(h.elements.status.textContent, '', 'and nothing was rendered')
  assert.equal(h.calls.dropped, droppedBeforeStale)
})

test('Z5: the form owns `checking` again after an edit or a close', async () => {
  const pending = []
  const h = harness({ checkResult: () => new Promise((resolve) => pending.push(resolve)) })
  h.form.open()
  h.form.onUrlInput('https://host/a.glb')
  const checking = h.form.check()
  await tick()
  h.form.onUrlInput('https://host/b.glb')
  assert.equal(h.form.state.checking, false, 'the edit ended the Check in flight')
  assert.equal(h.elements.check.disabled, false, 'so Check can be pressed again')
  pending[0]({ ok: true, vertices: 1, bytes: 1, bounds: [1, 1, 1], sha256: null, kind: 'glb' })
  await checking
  assert.equal(h.form.state.checking, false, 'and the stale settle did not re-enable anything')
})

test('S3: closing the form ends a Check in flight', async () => {
  const pending = []
  const h = harness({ checkResult: () => new Promise((resolve) => pending.push(resolve)) })
  h.form.open()
  h.form.onUrlInput('https://host/old.glb')
  const checking = h.form.check()
  await tick()

  h.form.close()
  pending[0]({ ok: true, vertices: 1, bytes: 1, bounds: [1, 1, 1], sha256: null, kind: 'glb' })
  await checking
  await tick()
  assert.equal(h.form.canSave(), false)
  assert.equal(h.form.specForSave(), null)
  assert.equal(h.elements.status.style.display, 'none')
})

test('S3: a Check that is still current is not ignored', async () => {
  const pending = []
  const h = harness({ checkResult: () => new Promise((resolve) => pending.push(resolve)) })
  h.form.open()
  h.form.onUrlInput('https://host/old.glb')
  const checking = h.form.check()
  await tick()
  pending[0]({ ok: true, vertices: 12400, bytes: 3250586, bounds: [1, 2, 3], sha256: 'abc', kind: 'glb' })
  await checking
  assert.equal(h.form.canSave(), true)
  assert.equal(h.form.specForSave().url, 'https://host/old.glb')
})

// ---------------------------------------------------------------------------
// Z2 (edit-polish-3, S1) — turning Edit mode off closes the panel's forms and
// discards the Model form's draft. The gate's `closeCurrent()` is what app.js
// calls first, then `reset()`.
// ---------------------------------------------------------------------------

test('Z2: closeCurrent() calls the holder’s closer, once, and empties the gate', () => {
  const gate = createFormGate()
  const calls = []
  gate.register('model', () => calls.push('model'))
  gate.register('library', () => calls.push('library'))

  assert.equal(gate.closeCurrent(), null, 'no holder: nothing to close')
  assert.deepEqual(calls, [], 'and no closer runs')

  gate.claim('model')
  assert.equal(gate.closeCurrent(), 'model')
  assert.deepEqual(calls, ['model'], 'only the holder’s closer ran, once')
  assert.equal(gate.current, null, 'and the gate ends up EMPTY')
  assert.equal(gate.isOpen('model'), false)

  assert.equal(gate.closeCurrent(), null, 'a second call is a no-op')
  assert.deepEqual(calls, ['model'])

  // The freed gate is claimable by the next form, which closes nothing.
  gate.claim('library')
  assert.deepEqual(calls, ['model'], 'claiming an empty gate closes no one')
  assert.equal(gate.current, 'library')
})

test('Z2: a holder with no closer still leaves the gate empty', () => {
  const gate = createFormGate()
  gate.claim('library')
  assert.equal(gate.closeCurrent(), 'library')
  assert.equal(gate.current, null)
})

test('Z2: a closer that releases the gate itself leaves it empty (the real forms)', () => {
  const h = harness()
  // Exactly app.js's registration.
  h.gate.register('model', () => h.form.close())
  h.form.open()
  assert.equal(h.gate.current, 'model')
  h.gate.closeCurrent()
  assert.equal(h.form.isOpen(), false, 'the Model form closed')
  assert.equal(h.gate.current, null, 'and the gate is empty, never left on the released holder')
})

test('Z2: type and Check a URL, close, reset(), reopen — the state and the box are both empty', async () => {
  const h = harness()
  h.form.open()
  h.elements.url.value = 'https://host/chair.glb'
  h.elements.url.fire('input')
  h.elements.check.fire('click')
  await tick()
  assert.equal(h.form.canSave(), true, 'the Check held a result')

  // A close keeps the draft (only Edit off discards it — that is `reset()`).
  h.form.close()
  assert.equal(h.form.state.url, 'https://host/chair.glb', 'a close keeps the draft')
  assert.equal(h.elements.url.value, 'https://host/chair.glb')

  h.form.reset()
  assert.equal(h.form.state.url, '', 'reset() clears the URL')
  assert.equal(h.elements.url.value, '', 'and the box with it — nothing wrote it before this round')
  assert.equal(h.form.specForSave(), null)
  assert.equal(h.form.isOpen(), false)

  h.form.open()
  assert.equal(h.elements.url.value, '')
  assert.equal(h.form.canSave(), false, 'no stale result comes back with it')
})

test('Z2: a reset while saving forgets only the wait', async () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')
  await h.form.check()
  const sent = h.form.save()
  assert.equal(h.form.state.saving, true)
  assert.equal(h.form.seq, sent.seq)

  h.form.reset()
  assert.equal(h.form.state.saving, false, 'reset forgets the wait')
  assert.equal(h.form.seq, null)
  assert.equal(h.form.state.url, '', 'and the draft')
  assert.equal(h.form.onAnswer(sent.seq, 'accepted'), false, 'the answer is no longer the form’s')
  assert.deepEqual(h.calls.selected, [], 'so nothing is selected by it')
})

test('V2: reset() clears the box even while it holds focus', () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')

  // The owner is typing in the box: `render()` must leave it alone...
  h.elements.url.ownerDocument = { activeElement: h.elements.url }
  h.elements.url.value = 'https://host/ben'
  h.form.render()
  assert.equal(h.elements.url.value, 'https://host/ben', 'a render keeps the half-typed URL')

  // ...but a reset empties the state AND the box, focused or not.
  h.form.reset()
  assert.equal(h.form.state.url, '', 'reset() clears the state')
  assert.equal(h.elements.url.value, '', 'and the FOCUSED box with it (V2)')
  assert.equal(h.form.isOpen(), false)
  assert.equal(h.form.specForSave(), null)
})

test('Z2: render leaves a focused URL box alone', () => {
  const h = harness()
  h.form.open()
  h.form.onUrlInput('https://host/chair.glb')
  assert.equal(h.elements.url.value, 'https://host/chair.glb', 'an unfocused box mirrors the state')

  // The owner is typing in the box: a render must not overwrite it.
  h.elements.url.ownerDocument = { activeElement: h.elements.url }
  h.elements.url.value = 'https://host/ben'
  h.form.render()
  assert.equal(h.elements.url.value, 'https://host/ben', 'the half-typed value is left alone')

  h.elements.url.ownerDocument = null
  h.form.render()
  assert.equal(h.elements.url.value, 'https://host/chair.glb', 'and it mirrors again once blurred')
})
