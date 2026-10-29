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
import { clipsForNode } from '../src/behavior-clips.js'

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
    // X2 — the host's clips for a node's own id: an ARRAY is a loaded list
    // (possibly empty), `undefined` means the host hasn't answered yet.
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
    const { form, elements } = setup({ nodes, selected: nodes[0], clips: { fox: ['Idle', 'Walk'] } })
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
  const { form, elements } = setup({ nodes, selected: nodes[0], clips: { fox: ['Idle', 'Walk'] } })
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
  const { form, elements, calls } = setup({ nodes: [cube, fox], selected: cube, clips: { fox: [] } })
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
  const { form, elements } = setup({ nodes, selected: nodes[0], clips: { fox: ['Idle', 'Walk'] } })
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
  const { form, elements } = setup({ nodes: [cube, fox], selected: cube, clips: { fox: ['Idle', 'Walk'] } })
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

// ══════════════════════════════════════════════════════════════════════════
// X2 (continued) — the re-render filter
// ══════════════════════════════════════════════════════════════════════════

test('X2 — a clip status change re-renders the open form; a play or stop alone does not', () => {
  const clips = {}                                   // mutable: the host's record, by name
  const cube = makeNode({ name: 'crate', id: OWN })
  const fox = makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } })
  const { form, elements } = setup({ nodes: [cube, fox], selected: cube, clips })
  form.open(cube)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', TGT)
  form.render()
  assert.equal(controlFor(elements, 'clip').tagName, 'input', 'no record yet: a text box')

  // A load that has STARTED changes nothing the form draws.
  clips.fox = { clips: ['A', 'B'], state: 'loading' }
  assert.equal(form.onClipStatusChange('fox'), false, 'loading draws the same text box')
  assert.equal(controlFor(elements, 'clip').tagName, 'input')

  // The list arrives: the row becomes a select, with the first clip chosen.
  clips.fox = { clips: ['A', 'B'], state: 'stopped' }
  assert.equal(form.onClipStatusChange('fox'), true, 'loaded re-renders')
  const clip = controlFor(elements, 'clip')
  assert.equal(clip.tagName, 'select')
  assert.deepEqual(clip.children.map((o) => o.value), ['A', 'B'])
  assert.equal(clip.children[0].selected, true)
  shownEqualsHeld(form, elements)

  // A clip starting or stopping alone is not a change: the fields are left
  // exactly as they were, so typing in one isn't interrupted.
  const row = rowFor(elements, 'clip')
  clips.fox = { clips: ['A', 'B'], state: 'playing' }
  assert.equal(form.onClipStatusChange('fox'), false, 'a play alone does not re-render')
  assert.equal(rowFor(elements, 'clip'), row, 'the row is the very same element')
  clips.fox = { clips: ['A', 'B'], state: 'ended' }
  assert.equal(form.onClipStatusChange('fox'), false, 'nor a stop')

  // A DIFFERENT list is a change.
  clips.fox = { clips: ['A', 'B', 'C'], state: 'ended' }
  assert.equal(form.onClipStatusChange('fox'), true, 'a different list re-renders')
  assert.deepEqual(controlFor(elements, 'clip').children.map((o) => o.value), ['A', 'B', 'C'])

  // And a status change for anything that isn't the form's own target is not
  // the form's business.
  assert.equal(form.onClipStatusChange('crate'), false)
  assert.equal(form.onClipStatusChange('nobody'), false)
})

// ══════════════════════════════════════════════════════════════════════════
// X6 — models without an `objectId`
// ══════════════════════════════════════════════════════════════════════════

test('X6 — an id-less model as the target shows its clips as a `<select>`', () => {
  const cube = makeNode({ name: 'crate', id: OWN })
  const fox = makeNode({ name: 'Fox', model: { url: 'a.glb' } })          // no objectId
  const clips = { Fox: ['Survey', 'Walk', 'Run'] }
  const { form, elements } = setup({ nodes: [cube, fox], selected: cube, clips })
  form.open(cube)
  form.onTemplateChange('select-animation')
  form.render()

  assert.equal(form.state.targetId, 'name:Fox', 'the id-less node is held by name')
  const target = controlFor(elements, 'target')
  assert.deepEqual(target.children.map((o) => o.value), ['name:Fox'])
  assert.deepEqual(target.children.map((o) => o.textContent), ['Fox'])

  const clip = controlFor(elements, 'clip')
  assert.equal(clip.tagName, 'select', 'the clip list is found (§1.2 item 6)')
  assert.deepEqual(clip.children.map((o) => o.value), ['Survey', 'Walk', 'Run'])
  assert.equal(clip.children[0].selected, true)
  shownEqualsHeld(form, elements)
})

test('X6 — when stage 2 is accepted, the held target is the id the node got', () => {
  const cube = makeNode({ name: 'crate', id: OWN })
  const fox = makeNode({ name: 'Fox', model: { url: 'a.glb' } })
  const { form, elements, calls, accept } = setup({ nodes: [cube, fox], selected: cube, clips: { Fox: ['Survey'] } })
  form.open(cube)
  form.onTemplateChange('select-animation')
  form.onParamChange('clip', 'Survey')
  assert.equal(form.state.targetId, 'name:Fox')
  form.save()

  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['Fox'], 'stage 2 asks for the target\'s id')
  accept(1)
  const id = calls.setObjectId[0][1]
  assert.equal(form.state.targetId, id, 'the held target is the id the stage gave')
  assert.equal(form.state.params.target, id)
  assert.equal(calls.sendField.length, 1, 'and stage 3 followed')

  const target = controlFor(elements, 'target')
  assert.deepEqual(target.children.map((o) => o.value), [id], 'the picker offers the new id')
  assert.deepEqual(target.children.map((o) => o.textContent), ['Fox'])
  assert.equal(target.children[0].selected, true, 'and it is the selected option')
  shownEqualsHeld(form, elements)
})

test('X6 — when stage 1 is accepted with the target the behaviour node itself, likewise', () => {
  const cube = makeNode({ name: 'crate' })                               // no id either
  const { form, elements, calls, accept } = setup({ nodes: [cube], selected: cube })
  form.open(cube)
  form.onTemplateChange('select-visibility')
  assert.equal(form.state.targetId, 'name:crate', 'the default target IS the cube')
  form.save()

  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'], 'stage 1 only (M4: no second id)')
  accept(1)
  const id = calls.setObjectId[0][1]
  assert.equal(form.state.targetId, id)
  assert.equal(form.state.params.target, id)
  assert.equal(calls.sendField.length, 1, 'stage 3 went out')
  assert.equal(calls.sendField[0][2].template.params.target, id)
  assert.equal(calls.sendField[0][2].nodeMap[0], id, 'the target IS the behaviour node')

  const target = controlFor(elements, 'target')
  assert.deepEqual(target.children.map((o) => o.value), [id])
  assert.equal(target.children[0].selected, true)
  shownEqualsHeld(form, elements)
})

test('X6 — a held `name:X` whose node gains an id elsewhere becomes that id', () => {
  const cube = makeNode({ name: 'crate', id: OWN })
  const fox = makeNode({ name: 'Fox', model: { url: 'a.glb' } })
  const { form, elements } = setup({ nodes: [cube, fox], selected: cube, clips: { Fox: ['Survey'] } })
  form.open(cube)
  form.onTemplateChange('select-animation')
  assert.equal(form.state.targetId, 'name:Fox')

  fox.extras.atrium.objectId = TGT                    // another tab's setObjectId
  form.render()
  assert.equal(form.state.targetId, TGT, 'the held value follows the id')
  assert.equal(form.state.params.target, TGT)
  const target = controlFor(elements, 'target')
  assert.deepEqual(target.children.map((o) => o.value), [TGT])
  assert.equal(target.children[0].selected, true, 'the picker still shows Fox')
  assert.equal(target.children[0].textContent, 'Fox')
  shownEqualsHeld(form, elements)
})

test("X6 — `noid`'s sequence: stages 1 and 2 accepted, stage 3 refused, the target keeps its place", () => {
  // §1.2 item 6's world: crate and Fox have no `objectId`, and the owner picks
  // Fox. Its clips are not known yet, so the clip is the text box.
  const cube = makeNode({ name: 'crate' })
  const fox = makeNode({ name: 'Fox', model: { url: 'a.glb' } })
  const { form, elements, calls, accept } = setup({ nodes: [cube, fox], selected: cube })
  form.open(cube)
  form.onTemplateChange('select-animation')
  form.onParamChange('clip', 'Survey')
  form.save()

  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'], 'stage 1: the behaviour node')
  accept(1)
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate', 'Fox'], 'stage 2: the target')
  accept(2)

  assert.equal(calls.sendField.length, 1, 'stage 3 went out')
  form.onAnswer('edit:rejected', { seq: 3, message: 'animations is malformed' })
  assert.match(form.state.error, /animations is malformed/)

  // Afterwards: the target shows Fox by its NEW id, and the clip shows what the
  // form holds — never CesiumMan-by-first-option.
  const foxId = calls.setObjectId[1][1]
  assert.equal(form.state.targetId, foxId, 'the ids stages 1 and 2 gave stay (M4)')
  const target = controlFor(elements, 'target')
  assert.deepEqual(target.children.map((o) => o.value), [foxId])
  assert.equal(target.children[0].textContent, 'Fox')
  assert.equal(target.children[0].selected, true)
  assert.equal(controlFor(elements, 'clip').value, 'Survey', 'the clip shows what is held')
  shownEqualsHeld(form, elements)

  // And the next Save sends exactly what is shown: no id stage is left to run.
  calls.sendField.length = 0
  form.save()
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate', 'Fox'], 'no further id stage')
  assert.equal(calls.sendField.length, 1)
  const sent = calls.sendField[0][2]
  assert.equal(sent.template.params.target, target.children[0].value, 'the shown target')
  assert.equal(sent.animations[0].clip, controlFor(elements, 'clip').value, 'the shown clip')
})

// ══════════════════════════════════════════════════════════════════════════
// X3 — the form checks before it sends, in plain words
// ══════════════════════════════════════════════════════════════════════════

const statusOf = (elements) => elements.status.textContent

/** A cube, a model with clips, and a light: every field has a good value. */
function x3World() {
  return [
    makeNode({ name: 'crate', id: OWN }),
    makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } }),
    makeNode({ name: 'Sun', id: OTHER, light: { intensity: 2 } }),
  ]
}

test('X3 — select-light with no light to offer says so', () => {
  const nodes = [makeNode({ name: 'crate', id: OWN }), makeNode({ name: 'plain', id: TGT })]
  const { form, elements, calls } = setup({ nodes, selected: nodes[0] })
  form.open(nodes[0])
  form.onTemplateChange('select-light')
  form.render()
  assert.equal(statusOf(elements), FIELD_TEXTS.noLights)
  assert.equal(elements.save.disabled, true)
  assert.equal(form.save(), null)
  assert.deepEqual(calls.setObjectId, [])
  assert.deepEqual(calls.sendField, [])
})

test('X3 — no target held says "Choose a target"', () => {
  const cube = makeNode({ name: 'crate', id: OWN, behavior: templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN }) })
  const { form, elements, calls } = setup({ nodes: [cube], selected: cube })   // the target is gone
  form.open(cube)
  form.render()
  assert.equal(statusOf(elements), FIELD_TEXTS.noTarget)
  assert.equal(elements.save.disabled, true)
  assert.equal(form.save(), null, 'Save cannot be forced past the check')
  assert.deepEqual(calls.setObjectId, [])
  assert.deepEqual(calls.sendField, [])
})

test('X3 — a loaded model with no clips says "This model has no animations"', () => {
  const nodes = x3World()
  const { form, elements, calls } = setup({ nodes, selected: nodes[0], clips: { fox: [] } })
  form.open(nodes[0])
  form.onTemplateChange('select-animation')
  form.onParamChange('target', TGT)
  form.render()
  assert.equal(statusOf(elements), FIELD_TEXTS.noAnimations)
  assert.equal(elements.save.disabled, true)
  assert.equal(form.save(), null)
  assert.deepEqual(calls.sendField, [])
})

test('X3 — a clip select with nothing held says "Choose a clip"', () => {
  const nodes = x3World()
  nodes[0] = makeNode({
    name: 'crate', id: OWN,
    behavior: templateGraph('interval-animation', { target: TGT, clip: 'Survey', loop: true, seconds: 5 }, { ownId: OWN }),
  })
  const { form, elements, calls } = setup({ nodes, selected: nodes[0], clips: { fox: ['Idle', 'Walk'] } })
  form.open(nodes[0])
  form.render()
  assert.equal(statusOf(elements), FIELD_TEXTS.noClip)
  assert.equal(elements.save.disabled, true)
  assert.equal(form.save(), null)
  assert.deepEqual(calls.sendField, [])
})

test('X3 — an empty clip text box says "Type a clip name"', () => {
  const nodes = x3World()
  const { form, elements, calls } = setup({ nodes, selected: nodes[0] })   // clips unknown: a text box
  form.open(nodes[0])
  form.onTemplateChange('select-animation')
  form.onParamChange('target', TGT)
  form.render()
  assert.equal(statusOf(elements), FIELD_TEXTS.emptyClip)
  assert.equal(elements.save.disabled, true)
  assert.equal(form.save(), null)
  assert.deepEqual(calls.sendField, [])
})

test('X3 — a radius outside 0.5 to 50 m, or not a number, says so', () => {
  for (const radius of [0.4, 50.5, 0, -1, NaN, Number('')]) {
    const nodes = x3World()
    const { form, elements, calls } = setup({ nodes, selected: nodes[0], clips: { fox: ['Idle'] } })
    form.open(nodes[0])
    form.onTemplateChange('proximity-animation')
    form.onParamChange('target', TGT)
    form.onParamChange('radius', radius)
    form.render()
    assert.equal(statusOf(elements), FIELD_TEXTS.radius, `radius ${radius}`)
    assert.equal(elements.save.disabled, true, `radius ${radius}: Save is disabled`)
    assert.equal(form.save(), null, `radius ${radius}: nothing goes out`)
    assert.deepEqual(calls.sendField, [])
    // X4 — a held value that isn't a number leaves the box empty.
    const box = controlFor(elements, 'radius')
    assert.equal(box.value, Number.isFinite(radius) ? String(radius) : '')
  }
  // The bounds themselves pass, through the imported limits.
  for (const radius of [0.5, 50]) {
    const nodes = x3World()
    const { form, elements } = setup({ nodes, selected: nodes[0], clips: { fox: ['Idle'] } })
    form.open(nodes[0])
    form.onTemplateChange('proximity-animation')
    form.onParamChange('target', TGT)
    form.onParamChange('radius', radius)
    form.render()
    assert.equal(statusOf(elements), '', `radius ${radius} is inside the bounds`)
    assert.equal(elements.save.disabled, false)
  }
})

test('X3 — an interval outside 1 to 3600 seconds, or not a whole number, says so', () => {
  for (const seconds of [0, 3601, 1.5, NaN, Number('')]) {
    const nodes = x3World()
    const { form, elements, calls } = setup({ nodes, selected: nodes[0], clips: { fox: ['Idle'] } })
    form.open(nodes[0])
    form.onTemplateChange('interval-animation')
    form.onParamChange('target', TGT)
    form.onParamChange('seconds', seconds)
    form.render()
    assert.equal(statusOf(elements), FIELD_TEXTS.seconds, `seconds ${seconds}`)
    assert.equal(elements.save.disabled, true)
    assert.equal(form.save(), null)
    assert.deepEqual(calls.sendField, [])
  }
  for (const seconds of [1, 3600]) {
    const nodes = x3World()
    const { form, elements } = setup({ nodes, selected: nodes[0], clips: { fox: ['Idle'] } })
    form.open(nodes[0])
    form.onTemplateChange('interval-animation')
    form.onParamChange('target', TGT)
    form.onParamChange('seconds', seconds)
    form.render()
    assert.equal(statusOf(elements), '', `seconds ${seconds} is inside the bounds`)
  }
})

test('X3 — a value that passes the fields but fails behaviorCheck says "Can\'t save: …"', () => {
  const nodes = x3World()
  const { form, elements, calls } = setup({ nodes, selected: nodes[0] })   // clips unknown: a text box
  form.open(nodes[0])
  form.onTemplateChange('select-animation')
  form.onParamChange('target', TGT)
  // 400 characters: the field check only asks for a name, F1 caps the clip at
  // 300 (BEHAVIOR_CLIP_MAX), so the whole-value check is what refuses it.
  form.onParamChange('clip', 'x'.repeat(400))
  form.render()
  assert.equal(elements.save.disabled, false, 'the fields alone are happy')

  assert.equal(form.save(), null)
  assert.equal(statusOf(elements), "Can't save: animations is malformed")
  assert.deepEqual(calls.setObjectId, [], 'no setObjectId')
  assert.deepEqual(calls.sendField, [], 'no leaf')
})

test('X3 — a valid value still saves in its usual stages, and no stand-in reaches a send', () => {
  const crate = makeNode({ name: 'crate' })               // no id: stage 1 gives it one
  const fox = makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } })
  const { form, calls, accept } = setup({ nodes: [crate, fox], selected: crate, clips: { fox: ['Idle'] } })
  form.open(crate)
  form.onTemplateChange('interval-animation')
  form.onParamChange('target', TGT)
  form.onParamChange('clip', 'Idle')
  const generation = form.save()
  assert.equal(typeof generation, 'number')

  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'], 'stage 1')
  assert.equal(calls.sendField.length, 0)
  accept(1)

  assert.equal(calls.sendField.length, 1, 'stage 3')
  const value = calls.sendField[0][2]
  assert.equal(value.template.id, 'interval-animation')
  assert.equal(value.nodeMap[0], calls.setObjectId[0][1], 'the real id, never a stand-in')
  const serialized = JSON.stringify(calls.sendField)
  assert.equal(serialized.includes('00000000-0000-4000-8000-'), false, 'no stand-in was ever sent')
})

// A small guard on the stand-ins X3 builds (round 7, step 2): they are in the
// rule's own id form, so the pre-stage check can never be refused for them.
test('X3 — the check\'s stand-in ids are in OBJECT_ID_RE\'s form', () => {
  assert.equal(OBJECT_ID_RE.test('00000000-0000-4000-8000-000000000001'), true)
  assert.equal(OBJECT_ID_RE.test('00000000-0000-4000-8000-000000000002'), true)
})
