// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-r7.test.js — scripting-4b-2 round 7: X1–X6.
//
// What DEV acceptance of round 6 found (§1.2), in the form and the Edit panel:
//   - the parameter fields ran together, so the target list read as the clip
//     list, and the labels were the raw keys (X1);
//   - a loaded model with no animations got an empty text box and Save sent
//     `''`, which the server refused with F1's "animations is malformed" (X2);
//   - the form sent values it hadn't checked, and F1's code-level message was
//     what the owner read (X3);
//   - a `<select>` whose held value wasn't among its options showed its first
//     option, so the fields showed one value while the form held another (X4);
//   - the Edit panel couldn't scroll (X5);
//   - a model with no `objectId` had no clip list, and its target slipped after
//     Save gave it an id (X6).
//
// No DOM: the shared strict element stand-in (`./strict-element.mjs`), which
// also carries X4's one invariant helper, `shownEqualsHeld`.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createBehaviorForm, FIELD_LABELS, FIELD_TEXTS, NO_ANIMATIONS, CLIP_PLACEHOLDER,
  CHOOSE_TARGET, CHOOSE_CLIP, NONE_LABEL, CUSTOM_LABEL, BEHAVIOR_STATUS,
} from '../src/behavior-form.js'
import { templateGraph, TEMPLATE_IDS, TEMPLATE_FIELDS } from '@atrium/behaviors/templates'
import { OBJECT_ID_RE } from '@atrium/behaviors/behavior-spec'
import { el, elementsFor, shownEqualsHeld } from './strict-element.mjs'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

function makeNode({ name, id = null, model = null, light = null, behavior }) {
  return {
    name,
    light,
    extras: {
      atrium: {
        ...(id ? { objectId: id } : {}),
        ...(model ? { model } : {}),
        ...(behavior === undefined ? {} : { behavior }),
      },
    },
  }
}

function setup({ nodes = [], selected = null, status = {}, clips = {} } = {}) {
  const elements = elementsFor()
  const calls = { setObjectId: [], sendField: [] }
  const applied = new Map()
  let seq = 0
  let clock = 0
  const deps = {
    selected: () => selected,
    nodes: () => nodes,
    status: () => (status.state ? status : {}),
    write: {
      setObjectId: (name, id) => { calls.setObjectId.push([name, id]); const s = ++seq; applied.set(s, { name, id }); return s },
      sendField: (name, field, value) => { calls.sendField.push([name, field, value]); return ++seq },
    },
    newObjectId: () => `9999${String(++clock).padStart(4, '0')}-9999-4999-8999-999999999999`,
    // X2 — the host's clips for a node's own id: an ARRAY is a loaded list
    // (possibly empty), `undefined` means the host hasn't answered yet.
    clipIds: (objectId) => clips[objectId],
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
  const echoLeaf = (node, value) => { node.extras.atrium.behavior = value; form.reread() }
  return {
    form, elements, calls, deps, accept, echoLeaf, clips,
    seq: () => seq,
    setSelected: (n) => { selected = n },
    setNodes: (n) => { nodes = n },
  }
}

const rowsOf = (elements) => elements.params.children
const controlsOf = (elements) => rowsOf(elements).map((row) => row.children[1] ?? null)
const controlFor = (elements, field) => controlsOf(elements).find((f) => f?.dataset?.field === field)
const rowFor = (elements, field) => rowsOf(elements).find((row) => row.children[1]?.dataset?.field === field)

/** A cube, a model and a light: every template has a target of its kind. */
function worldOf() {
  return [
    makeNode({ name: 'crate', id: OWN }),
    makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } }),
    makeNode({ name: 'Sun', id: OTHER, light: { intensity: 2 } }),
  ]
}

const targetFor = (id) => (id === 'select-light' ? OTHER : TGT)

// ══════════════════════════════════════════════════════════════════════════
// X1 — one field per row, each with its label
// ══════════════════════════════════════════════════════════════════════════

test('X1 — one `div.ep-row` per field, with a WORD label and the same `aria-label`', () => {
  for (const id of TEMPLATE_IDS) {
    const nodes = worldOf()
    const { form, elements } = setup({ nodes, selected: nodes[0], clips: { [TGT]: ['Idle', 'Walk'] } })
    form.open(nodes[0])
    form.onTemplateChange(id)
    form.onParamChange('target', targetFor(id))
    form.render()

    // `intensity` is read at save time, so it has no row (C2).
    const expected = TEMPLATE_FIELDS[id].filter((key) => key !== 'intensity')
    const rows = rowsOf(elements)
    assert.equal(rows.length, expected.length, `${id}: one row per field`)
    assert.deepEqual(rows.map((row) => row.tagName), expected.map(() => 'div'), `${id}: a div`)
    assert.deepEqual(rows.map((row) => row.classList.contains('ep-row')), expected.map(() => true),
      `${id}: the panel's own ep-row`)
    assert.deepEqual(rows.map((row) => row.children[0].tagName), expected.map(() => 'span'),
      `${id}: a span label`)
    assert.deepEqual(rows.map((row) => row.children[0].textContent), expected.map((key) => FIELD_LABELS[key]),
      `${id}: the label is a word, not the raw key`)
    assert.deepEqual(controlsOf(elements).map((f) => f.dataset.field), expected,
      `${id}: the fields keep TEMPLATE_FIELDS' order`)
    assert.deepEqual(controlsOf(elements).map((f) => f.getAttribute('aria-label')),
      expected.map((key) => FIELD_LABELS[key]), `${id}: the control's aria-label is its label`)
    assert.equal(rows.some((row) => row.tagName === 'label'), false, `${id}: no <label> wraps a control`)
    shownEqualsHeld(form, elements)
  }
})

test('X1 — the field order is TEMPLATE_FIELDS', () => {
  const nodes = worldOf()
  const { form, elements } = setup({ nodes, selected: nodes[0], clips: { [TGT]: ['Idle', 'Walk'] } })
  form.open(nodes[0])
  form.onTemplateChange('select-animation')
  form.onParamChange('target', TGT)
  form.render()
  assert.deepEqual(controlsOf(elements).map((f) => f.dataset.field), ['target', 'clip', 'action', 'loop'])
})

// ══════════════════════════════════════════════════════════════════════════
// X2 — a model with no animations says so
// ══════════════════════════════════════════════════════════════════════════

test('X2 — a loaded model with no clips says so, and Save is disabled', () => {
  const cube = makeNode({ name: 'crate', id: OWN })
  const fox = makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } })
  const { form, elements, calls } = setup({ nodes: [cube, fox], selected: cube, clips: { [TGT]: [] } })
  form.open(cube)
  form.onTemplateChange('interval-animation')
  form.onParamChange('target', TGT)
  form.render()

  const row = rowsOf(elements).find((r) => r.children[0].textContent === FIELD_LABELS.clip)
  assert.equal(row.children[1].dataset.field, undefined, 'the Clip row has no control')
  assert.equal(row.children[1].textContent, NO_ANIMATIONS, 'it has the text instead')
  assert.equal(form.state.params.clip, '', 'the held clip is empty')
  assert.equal(elements.save.disabled, true, 'Save is disabled')
  assert.equal(elements.status.textContent, NO_ANIMATIONS, 'and the status line says the same')

  assert.equal(form.save(), null, 'nothing goes out')
  assert.deepEqual(calls.setObjectId, [], 'no setObjectId')
  assert.deepEqual(calls.sendField, [], 'no leaf')
})

test('X2 — clips the host does not know yet keep the text box, with a placeholder', () => {
  const cube = makeNode({ name: 'crate', id: OWN })
  const fox = makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } })
  const { form, elements } = setup({ nodes: [cube, fox], selected: cube })   // no clip record at all
  form.open(cube)
  form.onTemplateChange('interval-animation')
  form.onParamChange('target', TGT)
  form.render()

  const clip = controlFor(elements, 'clip')
  assert.equal(clip.tagName, 'input', 'still a text box')
  assert.equal(clip.placeholder, CLIP_PLACEHOLDER)
  assert.equal(clip.value, '', 'and empty')
  assert.equal(elements.save.disabled, true, 'an empty clip name is a field problem (X3)')
  assert.equal(elements.status.textContent, FIELD_TEXTS.emptyClip)

  form.onParamChange('clip', 'Idle')
  form.render()
  assert.equal(elements.save.disabled, false, 'a name makes it saveable')
  assert.equal(elements.status.textContent, '')
  shownEqualsHeld(form, elements)
})

// ══════════════════════════════════════════════════════════════════════════
// X4 — every field shows exactly what the form will send
// ══════════════════════════════════════════════════════════════════════════

test('X4 — shownEqualsHeld holds after opening, a template change and every parameter change', () => {
  const nodes = worldOf()
  const value = templateGraph('select-animation', { target: TGT, clip: 'Idle', action: 'play', loop: true }, { ownId: OWN })
  nodes[0] = makeNode({ name: 'crate', id: OWN, behavior: value })
  const { form, elements } = setup({ nodes, selected: nodes[0], clips: { [TGT]: ['Idle', 'Walk'] } })
  form.open(nodes[0])
  shownEqualsHeld(form, elements)

  for (const id of TEMPLATE_IDS) {
    form.onTemplateChange(id)
    form.onParamChange('target', targetFor(id))
    form.render()
    assert.equal(form.state.template, id)
    shownEqualsHeld(form, elements)
  }

  form.onTemplateChange('select-animation')
  form.onParamChange('target', TGT)
  form.render()
  for (const [key, value] of [['clip', 'Walk'], ['action', 'stop'], ['loop', false]]) {
    form.onParamChange(key, value)
    form.render()
    shownEqualsHeld(form, elements)
  }
  form.onTemplateChange('proximity-animation')
  form.onParamChange('target', TGT)
  form.onParamChange('radius', 12)
  form.render()
  shownEqualsHeld(form, elements)
  form.onTemplateChange('interval-animation')
  form.onParamChange('target', TGT)
  form.onParamChange('seconds', 45)
  form.render()
  shownEqualsHeld(form, elements)
})

test('X4 — a removed target shows the placeholder, holds nothing, and disables Save', () => {
  const gone = TGT
  const value = templateGraph('select-visibility', { target: gone, action: 'hide' }, { ownId: OWN })
  const cube = makeNode({ name: 'crate', id: OWN, behavior: value })
  const { form, elements } = setup({ nodes: [cube], selected: cube })     // the target is not there
  form.open(cube)
  form.render()

  assert.equal(form.state.targetId, '', 'the held target becomes nothing')
  const target = controlFor(elements, 'target')
  assert.equal(target.children[0].value, '', 'the placeholder is the first option')
  assert.equal(target.children[0].textContent, CHOOSE_TARGET)
  assert.equal(target.children[0].selected, true, 'and it is selected')
  assert.equal(elements.save.disabled, true, 'Save is disabled')
  assert.equal(elements.status.textContent, FIELD_TEXTS.noTarget, 'and the line says why')
  shownEqualsHeld(form, elements)
})

test("X4 — a stored clip that isn't on the loaded model shows the placeholder", () => {
  const cube = makeNode({ name: 'crate', id: OWN })
  const fox = makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } })
  const value = templateGraph('interval-animation', { target: TGT, clip: 'Survey', loop: true, seconds: 5 }, { ownId: OWN })
  cube.extras.atrium.behavior = value
  const { form, elements } = setup({ nodes: [cube, fox], selected: cube, clips: { [TGT]: ['Idle', 'Walk'] } })
  form.open(cube)
  form.render()

  assert.equal(form.state.params.clip, '', 'the held clip becomes nothing')
  const clip = controlFor(elements, 'clip')
  assert.equal(clip.children[0].value, '')
  assert.equal(clip.children[0].textContent, CHOOSE_CLIP)
  assert.equal(clip.children[0].selected, true)
  assert.equal(elements.save.disabled, true)
  assert.equal(elements.status.textContent, FIELD_TEXTS.noClip)
  shownEqualsHeld(form, elements)
})

test('X4 — an empty picker holds nothing, and the select offers only the placeholder', () => {
  const cube = makeNode({ name: 'crate', id: OWN })
  const plain = makeNode({ name: 'plain', id: TGT })
  const { form, elements } = setup({ nodes: [cube, plain], selected: cube })
  form.open(cube)
  form.onTemplateChange('select-light')                // no light in this world
  form.render()
  assert.equal(form.state.targetId, '')
  const target = controlFor(elements, 'target')
  assert.deepEqual(target.children.map((o) => o.value), [''])
  assert.equal(target.children[0].textContent, CHOOSE_TARGET)
  assert.equal(elements.status.textContent, FIELD_TEXTS.noLights, "F8's text still comes first")
  shownEqualsHeld(form, elements)
})

test('X4 — a normalisation alone is not an unsaved edit', () => {
  const cube = makeNode({ name: 'crate', id: OWN, behavior: templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN }) })
  const other = makeNode({ name: 'other', id: TGT })
  const { form, elements, setNodes, echoLeaf } = setup({ nodes: [cube, other], selected: cube })
  form.open(cube)
  shownEqualsHeld(form, elements)

  // The target is removed, and the form redraws: X4 moves the held target to
  // '' with no owner input at all.
  setNodes([cube])
  form.render()
  assert.equal(form.state.targetId, '')
  assert.equal(elements.status.textContent, FIELD_TEXTS.noTarget, 'X3 says why, and says nothing else')

  // Another tab then changes the leaf: the line says so — but ONLY because the
  // stored value really changed, never because of the form's own correction.
  echoLeaf(cube, templateGraph('select-visibility', { target: TGT, action: 'toggle' }, { ownId: OWN }))
  assert.notEqual(elements.status.textContent, BEHAVIOR_STATUS.changed, 'a normalisation is not an unsaved edit')
})

test('X4 — a normalisation is undone by the next read of the stored value', () => {
  const cube = makeNode({ name: 'crate', id: OWN, behavior: templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN }) })
  const other = makeNode({ name: 'other', id: TGT })
  const { form, setNodes } = setup({ nodes: [cube, other], selected: cube })
  form.open(cube)
  setNodes([cube])
  form.render()
  assert.equal(form.state.targetId, '')
  setNodes([cube, other])                    // the target is back
  form.reread()                              // a som:set re-reads the stored leaf
  assert.equal(form.state.targetId, TGT, 'the stored target is shown again')
})

// The X4 tests below belong to the `noid` sequence and X6; they are pinned in
// the X6 section, where the id switch they exercise lives.

// A small guard on the stand-ins X3 builds (round 7, step 2): they are in the
// rule's own id form, so the pre-stage check can never be refused for them.
test('X3 — the check\'s stand-in ids are in OBJECT_ID_RE\'s form', () => {
  assert.equal(OBJECT_ID_RE.test('00000000-0000-4000-8000-000000000001'), true)
  assert.equal(OBJECT_ID_RE.test('00000000-0000-4000-8000-000000000002'), true)
})
