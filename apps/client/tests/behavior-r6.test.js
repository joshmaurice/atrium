// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-r6.test.js — scripting-4b-2 round 6: W2, W3 and W8's form items.
//
// The round-5 findings these pin (§1.2 items 2 and 3):
//   - the Behaviour section stayed closed after Edit off → Edit on with the
//     same object selected (W2);
//   - the form redrew its own stale copy instead of re-reading the stored leaf
//     (Remove's picker still showed the removed template, a behaviour written
//     under an already-selected object opened as "None", another tab's change
//     was invisible) (W3);
//   - Save's stage 3 looked the target up again, and the parameter fields
//     stayed editable while saving (W8);
//   - the strict fake delivered `change` only to checkable inputs, so the
//     picker's and the parameter container's real listeners were never driven
//     (W8).
//
// No DOM: the shared strict element stand-in (`./strict-element.mjs`).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createBehaviorForm, behaviorRowAction, NONE_LABEL, CUSTOM_LABEL, BEHAVIOR_STATUS,
} from '../src/behavior-form.js'
import { templateGraph } from '@atrium/behaviors/templates'
import { el, elementsFor, firesChange, shownEqualsHeld } from './strict-element.mjs'
import { clipsForNode } from '../src/behavior-clips.js'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const LIGHT = '55555555-5555-4555-8555-555555555555'

function makeNode({ name, id = null, model = null, light = null, behavior }) {
  return {
    name,
    light,
    extras: { atrium: { ...(id ? { objectId: id } : {}), ...(model ? { model } : {}), ...(behavior === undefined ? {} : { behavior }) } },
  }
}

function setup({ nodes = [], selected = null, status = {}, clips = {} } = {}) {
  const elements = elementsFor()
  const calls = { setObjectId: [], sendField: [] }
  const applied = new Map()
  let seq = 0
  let clock = 0
  /**
   * The host's record for a name, exactly as 4a's `modelAnimations.status`
   * answers: an ARRAY in `clips` is a loaded list (rendered as `state:
   * 'stopped'`), an object is used as it is so a test can drive `loading`, and
   * an absent name is no record yet.
   */
  const clipRecord = (name) => {
    const entry = clips[name]
    if (entry === undefined) return undefined
    return Array.isArray(entry) ? { clips: entry, state: 'stopped' } : entry
  }

  const deps = {
    selected: () => selected,
    nodes: () => nodes,
    status: () => (status.state ? status : {}),
    write: {
      setObjectId: (name, id) => { calls.setObjectId.push([name, id]); const s = ++seq; applied.set(s, { name, id }); return s },
      sendField: (name, field, value) => { calls.sendField.push([name, field, value]); return ++seq },
    },
    newObjectId: () => `9999${String(++clock).padStart(4, '0')}-9999-4999-8999-999999999999`,
    // X6 (round 7) — the form's dep is F4's clip status by NODE, from the
    // host's record keyed by name, exactly as 4a answers `status(name)`, so a
    // model with no `objectId` has a clip list too.
    clipStatus: (node) => clipsForNode(node, { modelAnimations: { status: clipRecord } }),
    createElement: (tag) => el(tag),
    showError: () => {},
    clearError: () => {},
    logLines: () => [],
  }
  const form = createBehaviorForm({ elements, deps })
  /** The client's own echo of an accepted setObjectId, applied before the answer. */
  const accept = (s) => {
    const call = applied.get(s)
    if (call) {
      const node = nodes.find((n) => n.name === call.name)
      if (node) node.extras.atrium.objectId = call.id
    }
    return form.onAnswer('edit:accepted', { seq: s })
  }
  /**
   * A `som:set` of the selected node's leaf, exactly as app.js routes it: the
   * value is already in the SOM (the echo or another tab applied it) and the
   * row's reread arrives after it.
   */
  const echoLeaf = (node, value) => {
    node.extras.atrium.behavior = value
    form.reread()
  }
  return { form, elements, calls, accept, echoLeaf, seq: () => seq }
}

const visibilityValue = (action = 'hide') => templateGraph('select-visibility', { target: TGT, action }, { ownId: OWN })

// ── W2 — reselecting after Edit off opens the section ──────────────────────

test('W2 — the row re-opens when the form is closed, and re-reads only on a som:set', () => {
  const X = makeNode({ name: 'crate', id: OWN })
  const other = makeNode({ name: 'other', id: TGT })

  // Edit off closes the form AND clears `lastBehaviorNode` (both pinned in
  // app.js by behavior-wiring.test.js), so the next refresh sees `open: false`.
  assert.equal(behaviorRowAction({ open: false, lastNode: X, selected: X }), 'open',
    'a closed form re-opens even with the same object still selected')
  assert.equal(behaviorRowAction({ open: false, lastNode: null, selected: X }), 'open')
  assert.equal(behaviorRowAction({ open: true, lastNode: X, selected: X }), 'render',
    'selecting X twice in a row with the form open calls render only')
  assert.equal(behaviorRowAction({ open: true, lastNode: X, selected: X, reread: true }), 'reread',
    'a som:set of the leaf re-reads the stored value')
  assert.equal(behaviorRowAction({ open: true, lastNode: X, selected: other }), 'open',
    'a different selection opens and re-reads')
})

test('W2 — Edit off, Edit on, the same object selected again: open() reads X\'s leaf', () => {
  const X = makeNode({ name: 'crate', id: OWN, behavior: visibilityValue() })
  const { form, elements } = setup({ nodes: [X], selected: X })

  form.open(X)
  assert.equal(form.openState, true)
  form.close()                                  // Edit off
  assert.equal(form.openState, false)
  assert.equal(elements.row.style.display, 'none', 'the section is hidden')

  // Edit on, the same object still selected: the decision is `open`, so the
  // stored leaf is read again and the section comes back.
  const action = behaviorRowAction({ open: form.openState, lastNode: X, selected: X })
  assert.equal(action, 'open')
  form.open(X)
  assert.equal(form.openState, true)
  assert.equal(elements.row.style.display, '', 'the section is back')
  assert.equal(form.state.template, 'select-visibility', 'and it read the stored template')
})

// ── W3 — the form shows the stored value ───────────────────────────────────

test('W3 (a) — after Remove, the picker shows None', () => {
  const X = makeNode({ name: 'crate', id: OWN, behavior: visibilityValue() })
  const { form, elements, echoLeaf } = setup({ nodes: [X], selected: X })
  form.open(X)
  assert.equal(elements.select.value, 'select-visibility')

  const seq = form.remove()
  // The write's own echo: the leaf is null in the SOM, then the form is told.
  echoLeaf(X, null)
  form.onAnswer('edit:accepted', { seq })
  assert.equal(elements.select.value, NONE_LABEL, 'the picker shows None')
  assert.equal(form.state.saved, null)
  assert.equal(elements.save.disabled, true, 'and there is nothing to save')
})

test('W3 (b) — a behaviour written under an already-selected object is shown', () => {
  const X = makeNode({ name: 'crate', id: OWN, behavior: undefined })
  const cube = makeNode({ name: 'cube', id: TGT })
  const { form, elements, echoLeaf } = setup({ nodes: [X, cube], selected: X })
  form.open(X)
  assert.equal(elements.select.value, NONE_LABEL, 'it starts as None')
  assert.equal(elements.enabled.disabled, true)
  assert.equal(elements.remove.disabled, true)

  // Something writes the leaf while X is already selected (adding a cube
  // selects it and its behaviour is written): a `som:set` of the leaf.
  echoLeaf(X, visibilityValue())
  assert.equal(elements.select.value, 'select-visibility', 'the picker shows the stored template')
  assert.equal(form.state.targetId, TGT, 'with its target')
  assert.equal(elements.enabled.disabled, false, 'Enabled is available')
  assert.equal(elements.remove.disabled, false, 'and so is Remove')
})

test('W3 (c) — the same with a Custom graph', () => {
  const X = makeNode({ name: 'crate', id: OWN, behavior: undefined })
  const { form, elements, echoLeaf } = setup({ nodes: [X], selected: X })
  form.open(X)
  const custom = { ...visibilityValue() }
  delete custom.template                                  // 4d's imports, or a hand-edit
  echoLeaf(X, custom)
  assert.equal(elements.select.value, CUSTOM_LABEL, 'a template-less value is a Custom graph')
  assert.equal(form.state.custom, true)
  assert.equal(elements.enabled.disabled, false, 'Enabled and Remove only')
  assert.equal(elements.remove.disabled, false)
})

test('W3 (d) — a Save in flight: its own three stages\' echoes cannot cancel it', () => {
  const light = makeNode({ name: 'Sun', id: LIGHT, light: { intensity: 3 } })
  const X = makeNode({ name: 'crate', behavior: undefined })
  const { form, calls, accept, echoLeaf } = setup({ nodes: [X, light], selected: X })
  form.open(X)
  form.onTemplateChange('select-light')
  form.onParamChange('target', LIGHT)
  const generation = form.save()
  const id = calls.setObjectId[0][1]

  // Each stage's own echo arrives while the sequence is in flight.
  accept(1)                                               // stage 1: X's id
  assert.equal(form.state.generation, generation, 'the echo of stage 1 did not bump it')
  echoLeaf(X, { enabled: true })                          // a stray leaf echo
  assert.equal(form.state.saving, true, 'and the Save is still in flight')
  assert.notEqual(form.state.status, BEHAVIOR_STATUS.cancelled, 'no "Save cancelled"')

  accept(2)                                               // stage 2: the light's id
  assert.equal(calls.sendField.length, 1, 'stage 3 went out')
  assert.equal(form.state.generation, generation)
  assert.equal(form.state.status, null)

  const sent = calls.sendField[0][2]
  assert.equal(sent.template.id, 'select-light', 'the final value is the template\'s')
  accept(3)
  assert.notEqual(form.state.status, BEHAVIOR_STATUS.cancelled)
})

test('W3 (e) — another tab changes the leaf under an unsaved edit', () => {
  const X = makeNode({ name: 'crate', id: OWN, behavior: visibilityValue('hide') })
  // X4 (round 7) — the world carries the node the other tab's value targets,
  // so the stored value has no field problem of its own to report.
  const Y = makeNode({ name: 'other', id: TGT })
  const { form, elements, echoLeaf } = setup({ nodes: [X, Y], selected: X })
  form.open(X)
  form.onTemplateChange('select-visibility')              // an UNSAVED picker change
  form.onParamChange('action', 'show')
  assert.equal(form.state.params.action, 'show')
  assert.equal(elements.status.textContent, '', 'nothing said yet')

  // Another tab writes a DIFFERENT stored value.
  echoLeaf(X, templateGraph('select-visibility', { target: TGT, action: 'toggle' }, { ownId: OWN }))
  assert.equal(form.state.template, 'select-visibility', 'the stored value is shown, not the unsaved edit')
  assert.equal(elements.status.textContent, BEHAVIOR_STATUS.changed, 'and the line says so')
})

// ── W8 — the form's small items ────────────────────────────────────────────

test('W8 — stage 3\'s light value comes from the snapshot\'s own target', () => {
  // The target has NO id yet, so the form names it `name:Sun`. Stage 2 gives it
  // one; it is then RENAMED before stage 3. A lookup of the old `name:Sun` would
  // find nothing and fall back to intensity 1; the snapshot's object still
  // holds the light the sequence was bound to.
  const light = makeNode({ name: 'Sun', light: { intensity: 3 } })
  const X = makeNode({ name: 'crate', behavior: undefined })
  const { form, calls, accept } = setup({ nodes: [X, light], selected: X })
  form.open(X)
  form.onTemplateChange('select-light')
  form.onParamChange('target', 'name:Sun')
  form.save()
  accept(1)                                               // stage 1: X's own id
  accept(2)                                               // stage 2: the light's id
  light.name = 'Sunset'                                   // renamed between stages
  assert.equal(calls.sendField.length, 1, 'stage 3 went out')
  assert.equal(calls.sendField[0][2].template.params.intensity, 3,
    'the light the sequence was bound to')
})

test('W8 — the picker and every parameter field are disabled while a Save is in flight', () => {
  const model = makeNode({ name: 'foz', id: TGT, model: { url: 'a.glb' } })
  const X = makeNode({ name: 'crate', id: OWN, behavior: undefined })
  const { form, elements } = setup({ nodes: [X, model], selected: X, clips: { foz: ['Idle'] } })
  form.open(X)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', TGT)
  form.render()
  const fields = () => elements.params.children.map((row) => row.children[1])
  assert.ok(fields().length >= 2, 'the parameter fields are rendered')
  assert.equal(fields().every((f) => f.disabled === false), true, 'editable before the Save')

  form.save()                                             // stage 1 goes out; saving is true
  assert.equal(form.state.saving, true)
  form.render()
  assert.equal(elements.select.disabled, true, 'the picker is disabled')
  assert.equal(fields().every((f) => f.disabled === true), true, 'and every parameter field')
  // X4 — and every field still shows what the form will send.
  shownEqualsHeld(form, elements)
})

test('W8 — the strict fake drives the REAL picker and parameter listeners', () => {
  const model = makeNode({ name: 'foz', id: TGT, model: { url: 'a.glb' } })
  const X = makeNode({ name: 'crate', id: OWN, behavior: undefined })
  const { form, elements } = setup({ nodes: [X, model], selected: X, clips: { foz: ['Idle', 'Walk'] } })
  form.wire()
  form.open(X)

  // The template picker: a real `<select>` fires `change`.
  assert.equal(firesChange(elements.select), true)
  elements.select.value = 'select-animation'
  elements.select.dispatch('change')
  assert.equal(form.state.template, 'select-animation', 'the picker\'s own listener ran')

  form.render()
  const fields = elements.params.children.map((row) => row.children[1])
  const byField = (name) => fields.find((f) => f.dataset.field === name)

  // The parameter container's DELEGATED `change` (its listener is on the
  // container): dispatching on the FIELD itself reaches it, as a real bubbling
  // `change` does. One field of each kind — a `<select>` (the clip), a number
  // `<input>` and a checkbox.
  const clip = byField('clip')
  assert.equal(clip.tagName, 'select')
  clip.value = 'Walk'
  clip.dispatch('change')
  assert.equal(form.state.params.clip, 'Walk', 'the clip reached onParamChange')

  form.render()
  const loop = elements.params.children.map((row) => row.children[1]).find((f) => f.dataset.field === 'loop')
  assert.equal(loop.type, 'checkbox')
  loop.checked = false
  loop.dispatch('change')
  assert.equal(form.state.params.loop, false, 'the checkbox reached onParamChange')

  // The interval template's `seconds` is a number input — a second template, so
  // the number kind is driven too.
  form.onTemplateChange('interval-animation')
  form.onParamChange('target', model)
  form.render()
  const seconds = elements.params.children.map((row) => row.children[1]).find((f) => f.dataset.field === 'seconds')
  assert.ok(seconds, 'the number field is rendered')
  assert.equal(seconds.type, 'number')
  seconds.value = '7'
  seconds.dispatch('change')
  assert.equal(form.state.params.seconds, 7, 'the number input reached onParamChange')

  // And Enabled, a real `<button>`, is driven by `click`.
  form.open(X)
  form.onTemplateChange('select-visibility')
  form.onParamChange('target', TGT)
  form.save()
  assert.equal(form.state.saving, true)
  assert.equal(elements.enabled.disabled, true, 'a Save in flight disables it')
})
