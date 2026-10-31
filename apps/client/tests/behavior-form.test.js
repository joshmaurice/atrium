// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-form.test.js — scripting-4b-2 step 6, F9. No DOM: a tiny element
// stand-in and a `createElement` dep, so the form's own decisions are tested.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createBehaviorForm, NONE_LABEL, CUSTOM_LABEL, BEHAVIOR_STATUS, matchesTemplate, targetKindFor,
  HINT_TEXT, HINT_LIGHT_ON, HINT_ONE_CLICK, HINT_CLIP_END, NO_LIGHTS, UNDO_NOTE, CHOOSE_TARGET,
  ENABLE_DECLINED,
} from '../src/behavior-form.js'
import { createFormGate } from '../src/model-form.js'
import { templateGraph, TEMPLATE_IDS } from '@atrium/behaviors/templates'
import { behaviorCheck } from '@atrium/behaviors/behavior-spec'
// 4d G4/G6 — the note texts the runner writes and the form renders.
import {
  STARTS_ON_LOAD_NOTE, SAMPLED_MOTION_NOTE, MISSING_SELECT_NOTE, THROTTLED_TEXT, PARTIAL_TEXT,
} from '@atrium/behaviors/runner'
// 4d G6 — the confirmation's text builder, so the prompt is pinned to the same
// string the importer writes.
import { enablePromptText } from '../src/graph-import.js'
// V12 — ONE strict element fake, shared by the form and panel tests.
import { el, elementsFor, isCheckable, shownEqualsHeld } from './strict-element.mjs'
import { clipsForNode } from '../src/behavior-clips.js'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

// ── a tiny element stand-in ────────────────────────────────────────────────
// `el()` and `elementsFor()` come from `strict-element.mjs`: `dataset`, `style`
// and `classList` are getter-only, `checked`/`change` exist only on a checkbox
// or radio input, and a button dispatches `click` only (V12). The old
// lenient fake is what hid §1.2's items 1, 2 and 4.

function makeNode({ name, id = null, model = null, light = null, behavior }) {
  const node = {
    name,
    light,
    extras: { atrium: { ...(id ? { objectId: id } : {}), ...(model ? { model } : {}), ...(behavior === undefined ? {} : { behavior }) } },
  }
  return node
}

function setup({ nodes = [], selected = null, status = {}, clips = {}, gate = null } = {}) {
  const elements = elementsFor()
  const calls = { setObjectId: [], sendField: [] }
  const applied = new Map()          // seq → { name, id } a setObjectId asked for
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
    status: () => status.state ? status : {},
    write: {
      setObjectId: (name, id) => { calls.setObjectId.push([name, id]); const s = ++seq; applied.set(s, { name, id }); return s },
      sendField: (name, field, value) => { calls.sendField.push([name, field, value]); return ++seq },
    },
    newObjectId: () => `9999${String(++clock).padStart(4, '0')}-9999-4999-8999-999999999999`,
    // V5 — the form's clip picker, from the same source the adapter checks.
    // X6 (round 7) — the form's dep is F4's clip status by NODE, from the
    // host's record keyed by name, exactly as 4a answers `status(name)`, so a
    // model with no `objectId` has a clip list too.
    clipStatus: (node) => clipsForNode(node, { modelAnimations: { status: clipRecord } }),
    createElement: (tag) => el(tag),
    showError: () => {},
    clearError: () => {},
    logLines: () => [],
  }
  const form = createBehaviorForm({ elements, deps, gate })
  /**
   * F9/V10 — an accepted `setObjectId` is applied to its node by the CLIENT's
   * own echo (`client.setObjectId`'s tracked send), before the form sees
   * `edit:accepted`. The real SOM carries the new id by then, and V10's check
   * compares the live id against the snapshot's, so the fake applies it too.
   */
  const accept = (s) => {
    const call = applied.get(s)
    if (call) {
      const node = nodes.find((n) => n.name === call.name)
      if (node) node.extras.atrium.objectId = call.id
    }
    return form.onAnswer('edit:accepted', { seq: s })
  }
  return {
    form, elements, calls, deps, accept,
    seq: () => seq,
    setSelected: (n) => { selected = n },
    setNodes: (n) => { nodes = n },
  }
}

// ── F9: the Save sequence (M4) ─────────────────────────────────────────────

test('F9 — Save on a node with no id sends setObjectId FIRST, then the leaf after edit:accepted', () => {
  const target = makeNode({ name: 'target', id: TGT })
  const node = makeNode({ name: 'crate', behavior: undefined })
  const { form, calls, accept } = setup({ nodes: [node, target], selected: node })
  form.open(node)
  form.onTemplateChange('select-visibility')
  form.onParamChange('target', TGT)
  const generation = form.save()
  assert.equal(typeof generation, 'number')
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'], 'stage 1: the node\'s own id')
  assert.equal(calls.sendField.length, 0, 'nothing else has gone out')

  const id = calls.setObjectId[0][1]
  accept(1)
  assert.equal(calls.sendField.length, 1, 'stage 3: the leaf, after the id was answered')
  const [name, field, value] = calls.sendField[0]
  assert.equal(name, 'crate')
  assert.equal(field, 'extras.atrium.behavior')
  assert.equal(value.nodeMap[0], id, 'the value names the id the node actually got')
  assert.equal(value.template.id, 'select-visibility')
  assert.equal(behaviorCheck(value, { ownId: id }).problem, null)
})

test('F9 — all three stages complete in order, and the final value is the template\'s', () => {
  // X4 (round 7) — the target of an animation template must be a model the
  // picker can offer: a held value that isn't among the options becomes ''.
  const target = makeNode({ name: 'target', model: { url: 'a.glb' } })
  const node = makeNode({ name: 'crate' })
  const { form, calls, accept } = setup({ nodes: [node, target], selected: node })
  form.open(node)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', `name:target`)
  form.onParamChange('clip', 'Idle')
  form.save()

  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'])
  accept(1)
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate', 'target'], 'stage 2: the target\'s own id')
  accept(2)

  assert.equal(calls.sendField.length, 1)
  const value = calls.sendField[0][2]
  assert.equal(value.template.id, 'select-animation')
  assert.equal(value.animations[0].clip, 'Idle')
  assert.equal(value.nodeMap[0], calls.setObjectId[0][1])
  assert.equal(value.template.params.target, calls.setObjectId[1][1])
})

test('F9 — a refused id stops the sequence, with the server\'s text', () => {
  const target = makeNode({ name: 'target', id: TGT })
  const node = makeNode({ name: 'crate' })
  const { form, calls } = setup({ nodes: [node, target], selected: node })
  form.open(node)
  form.onTemplateChange('select-visibility')
  form.save()
  form.onAnswer('edit:rejected', { seq: 1, message: 'give the object an id before a behaviour' })
  assert.equal(calls.sendField.length, 0, 'the leaf never went out')
  assert.match(form.state.error, /give the object an id/)
})

test('F9 — a selection change after the first acknowledgement stops the sequence (M4)', () => {
  // X4 — a model target, as the animation templates' picker requires.
  const target = makeNode({ name: 'target', model: { url: 'a.glb' } })
  const node = makeNode({ name: 'crate' })
  const other = makeNode({ name: 'other', id: OTHER })
  const { form, calls, setSelected } = setup({ nodes: [node, target, other], selected: node })
  form.open(node)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', 'name:target')
  form.onParamChange('clip', 'Idle')
  form.save()
  setSelected(other)                              // the owner selected something else
  form.open(other)                                // …and the form followed the selection
  form.onAnswer('edit:accepted', { seq: 1 })
  assert.equal(calls.sendField.length, 0, 'no further stage went out')
  assert.equal(form.state.status, BEHAVIOR_STATUS.cancelled)
})

test('F9 — Edit off (the gate) stops the sequence with no further send (M4)', () => {
  const target = makeNode({ name: 'target', id: TGT })
  const node = makeNode({ name: 'crate' })
  const { form, calls } = setup({ nodes: [node, target], selected: node })
  form.open(node)
  form.onTemplateChange('select-visibility')
  form.save()
  form.close()                                    // Edit off closes the form through the gate
  form.onAnswer('edit:accepted', { seq: 1 })
  assert.equal(calls.sendField.length, 0)
})

// ── F9: the other actions ──────────────────────────────────────────────────

test('F9 — Remove sends null', () => {
  const behavior = templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN })
  const node = makeNode({ name: 'crate', id: OWN, behavior })
  const { form, calls } = setup({ nodes: [node], selected: node })
  form.open(node)
  form.remove()
  assert.deepEqual(calls.sendField[0], ['crate', 'extras.atrium.behavior', null])
})

test('F9 — Enabled rewrites the value with the flag flipped', () => {
  const behavior = templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN })
  const node = makeNode({ name: 'crate', id: OWN, behavior })
  const { form, calls } = setup({ nodes: [node], selected: node })
  form.open(node)
  form.setEnabled(false)
  const value = calls.sendField[0][2]
  assert.equal(value.enabled, false)
  assert.deepEqual(value.nodeMap, behavior.nodeMap, 'everything else is kept')
  assert.equal(value.template.id, 'select-visibility')
})

// ── F9: Custom graph (Rev 2, S5) ──────────────────────────────────────────

test('F9 — a template-less value shows "Custom graph"', () => {
  const value = { ...templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN }) }
  delete value.template
  const node = makeNode({ name: 'crate', id: OWN, behavior: value })
  const { form, elements } = setup({ nodes: [node], selected: node })
  form.open(node)
  assert.equal(form.state.template, CUSTOM_LABEL)
  assert.equal(elements.select.value, CUSTOM_LABEL)
  assert.equal(elements.select.disabled, false)
  assert.equal(elements.save.disabled, true, 'Enabled and Remove only')
  assert.equal(elements.enabled.disabled, false, 'a Custom graph HAS Enabled (V2/S1)')
  assert.equal(elements.remove.disabled, false)
})

test('F9 — a value whose params do not regenerate its graph shows "Custom graph"', () => {
  const value = templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN })
  value.nodeMap = [OWN, TGT, OTHER]               // a hand edit
  const node = makeNode({ name: 'crate', id: OWN, behavior: value })
  const { form } = setup({ nodes: [node], selected: node })
  assert.equal(matchesTemplate(value, OWN), false)
  form.open(node)
  assert.equal(form.state.template, CUSTOM_LABEL)
})

test('F9 — every template\'s own output reopens as itself, not as Custom graph', () => {
  for (const id of TEMPLATE_IDS) {
    const params = id === 'select-light' ? { target: TGT, intensity: 2 }
      : id === 'select-visibility' ? { target: TGT, action: 'toggle' }
        : id === 'proximity-animation' ? { target: TGT, clip: 'W', loop: true, radius: 3 }
          : id === 'interval-animation' ? { target: TGT, clip: 'W', loop: true, seconds: 5 }
            : { target: TGT, clip: 'W', action: 'play', loop: true }
    const value = templateGraph(id, params, { ownId: OWN })
    const node = makeNode({ name: 'crate', id: OWN, behavior: value })
    const { form } = setup({ nodes: [node], selected: node })
    form.open(node)
    assert.equal(form.state.template, id, `${id} reopens as itself`)
  }
})

// ── F9: the status line, the picker and the light template ────────────────

test('F9 — the status texts for each runner state', () => {
  const node = makeNode({ name: 'crate', id: OWN })
  const cases = [
    ['running', BEHAVIOR_STATUS.running],
    ['idle', BEHAVIOR_STATUS.idle],
    ['other-tab', BEHAVIOR_STATUS.otherTab],
  ]
  for (const [state, expected] of cases) {
    const { form, elements } = setup({ nodes: [node], selected: node, status: { state } })
    form.open(node)
    assert.equal(elements.status.textContent, expected)
  }
  // W4 (round 6) — a disabled state whose reason is an F1 code shows that
  // code's own text. (The reason the runner reports is `invalid: <code>`; a
  // bare code is neither one of the runner's forms.)
  const { form: disabled, elements: de } = setup({ nodes: [node], selected: node, status: { state: 'disabled', reason: 'invalid: behavior-kind' } })
  disabled.open(node)
  assert.match(de.status.textContent, /^Disabled: /)
  assert.match(de.status.textContent, /kind must be "graph"/)
})

test('W4 — each disable reason has its own text', () => {
  const node = makeNode({ name: 'crate', id: OWN })
  const rows = [
    ['disabled', 'turned off'],
    ['invalid: behavior-kind', 'kind must be "graph"'],
    ['not-found', "its object can't be found"],
    ['target-not-found: 3', "target 3 can't be found"],
    ['rejected: the engine refused the graph: nope', 'the graph was refused: the engine refused the graph: nope'],
    ['over-budget', 'it did too much work in one frame'],
    ['over-send-cap', 'too many changes were waiting to be sent'],
    ['something else entirely', 'something else entirely'],
  ]
  for (const [reason, text] of rows) {
    const { form, elements } = setup({ nodes: [node], selected: node, status: { state: 'disabled', reason } })
    form.open(node)
    assert.equal(elements.status.textContent, `Disabled: ${text}`, `the text for "${reason}"`)
  }
  // Only an F1 code that maps to it gives the old generic line.
  const { form: fallback, elements: fe } = setup({ nodes: [node], selected: node, status: { state: 'disabled', reason: 'invalid: behavior-nonsense' } })
  fallback.open(node)
  assert.equal(fe.status.textContent, 'Disabled: the behaviour value is invalid')
})

test('F9 — the picker filters per template', () => {
  assert.equal(targetKindFor('select-visibility'), 'any')
  assert.equal(targetKindFor('select-animation'), 'model')
  assert.equal(targetKindFor('select-light'), 'light')

  const model = makeNode({ name: 'foz', id: TGT, model: { url: 'a.glb' } })
  const light = makeNode({ name: 'Sun', id: OTHER, light: { intensity: 3 } })
  const plain = makeNode({ name: 'crate', id: '44444444-4444-4444-8444-444444444444' })
  const node = makeNode({ name: 'me', id: OWN })
  const { form, elements } = setup({ nodes: [node, model, light, plain], selected: node })
  form.open(node)
  form.onTemplateChange('select-animation')
  form.render()
  const listed = elements.params.children.map((row) => row.children[1])
  const targetField = listed[0]
  assert.deepEqual(targetField.children.map((o) => o.textContent), ['foz'], 'models only')
})

test('F9 — the light template with no lights says so', () => {
  const plain = makeNode({ name: 'crate', id: TGT })
  const node = makeNode({ name: 'me', id: OWN })
  const { form, elements } = setup({ nodes: [node, plain], selected: node })
  form.open(node)
  form.onTemplateChange('select-light')
  assert.equal(form.state.template, 'select-light')
  const target = elements.params.children.map((row) => row.children[1])[0]
  assert.deepEqual(target.children.map((o) => o.value), [''], 'X4 — only the placeholder is offered')
  assert.equal(target.children[0].textContent, CHOOSE_TARGET)
})

// ── R1 (C2, completed): the light template's on-value and its help text ────
// The revision's R1: each case goes through Save with the form's real
// `templateGraph` and a fake client (the `setup` deps above).

const GENERIC_HINT = 'Behaviour changes are saved with the world.'
const C2_SENTENCE = 'If the light was off when you saved, \'on\' uses intensity 1.'

/** The on-branch literal: `flow/branch`'s `false` flow lands on a `pointer/set`. */
function onBranchLiteral(value) {
  const { graph } = value
  const ops = graph.declarations.map((d) => d.op)
  const branch = graph.nodes.findIndex((n) => ops[n.declaration] === 'flow/branch')
  assert.notEqual(branch, -1, 'the select-light graph has a flow/branch')
  const onIndex = graph.nodes[branch].flows.false.node
  assert.equal(ops[graph.nodes[onIndex].declaration], 'pointer/set', 'the false branch writes the light')
  return graph.nodes[onIndex].values.value.value[0]
}

/** Save `select-light` on a fresh node, targeting a light at `light`. */
function saveLightOn(light) {
  const lightNode = makeNode({ name: 'Sun', id: TGT, light })
  const node = makeNode({ name: 'crate', id: OWN })
  const { form, elements, calls } = setup({ nodes: [node, lightNode], selected: node })
  form.open(node)
  form.onTemplateChange('select-light')
  form.onParamChange('target', TGT)
  form.save()
  return { form, elements, calls }
}

test('R1 — a light at intensity 0 writes an on-branch literal of 1', () => {
  const { calls } = saveLightOn({ intensity: 0 })
  assert.equal(calls.sendField.length, 1, 'the leaf goes out (both ids already exist)')
  assert.deepEqual(calls.sendField[0].slice(0, 2), ['crate', 'extras.atrium.behavior'])
  const value = calls.sendField[0][2]
  assert.equal(value.template.id, 'select-light')
  assert.equal(onBranchLiteral(value), 1, 'the on-branch literal is 1, not 0.01')
  assert.equal(value.template.params.intensity, 1)
  assert.equal(behaviorCheck(value, { ownId: OWN }).problem, null, 'and the server would accept it')
})

test('R1 — a light whose intensity is non-finite or missing writes on = 1', () => {
  const cases = [
    ['NaN', { intensity: NaN }],
    ['Infinity', { intensity: Infinity }],
    ['-Infinity', { intensity: -Infinity }],
    // X4 (round 7) — the picker only offers a node that CARRIES a light, so the
    // old `null` case (no light object at all) is now unreachable through the
    // form; a light node whose `light` is an empty object stands in for it.
    ['a missing intensity', {}],
    ['a non-numeric intensity', { intensity: '2' }],
  ]
  for (const [what, light] of cases) {
    const { calls } = saveLightOn(light)
    const value = calls.sendField[0][2]
    assert.equal(onBranchLiteral(value), 1, `${what} → 1`)
    assert.equal(value.template.params.intensity, 1, `${what} → params.intensity 1`)
  }
})

test('R1 — a light at 0.005 floors to 0.01', () => {
  const { calls } = saveLightOn({ intensity: 0.005 })
  const value = calls.sendField[0][2]
  assert.equal(onBranchLiteral(value), 0.01, 'the floor, not 1')
  assert.equal(value.template.params.intensity, 0.01)
})

test('R1 — a light at 2.5 keeps 2.5', () => {
  const { calls } = saveLightOn({ intensity: 2.5 })
  const value = calls.sendField[0][2]
  assert.equal(onBranchLiteral(value), 2.5)
  assert.equal(value.template.params.intensity, 2.5)
})

test('R1 — the hint carries C2\'s sentence for select-light and for nothing else', () => {
  // The wording is pinned twice: by these literals and by the module's exports.
  assert.equal(GENERIC_HINT, HINT_TEXT)
  assert.equal(C2_SENTENCE, HINT_LIGHT_ON)

  const light = makeNode({ name: 'Sun', id: TGT, light: { intensity: 2 } })
  const node = makeNode({ name: 'crate', id: OWN })
  const { form, elements } = setup({ nodes: [node, light], selected: node })
  form.open(node)
  form.onTemplateChange('select-light')
  // R1 — C2's sentence comes straight after the generic sentence. Round 3 (T1)
  // appends the template's own lines after it; it does not move C2's.
  assert.ok(elements.hintText.startsWith(`${GENERIC_HINT} ${C2_SENTENCE}`), elements.hintText)
  // The same rendering path: `renderParams` writes `elements.hintText` into the hint.
  form.render()
  assert.equal(elements.hint.textContent, elements.hintText)

  for (const id of TEMPLATE_IDS) {
    if (id === 'select-light') continue
    form.onTemplateChange(id)
    assert.equal(elements.hintText.includes(C2_SENTENCE), false, `${id} shows no C2 sentence`)
  }
  form.onTemplateChange(NONE_LABEL)
  assert.equal(elements.hintText.includes(C2_SENTENCE), false, 'None shows no C2 sentence')
})

// ── T1 (r3): the hint element is written for every template, and cleared ───

test('T1 — the hint element carries each template\'s own lines, and "None" clears it', () => {
  const light = makeNode({ name: 'Sun', id: TGT, light: { intensity: 2 } })
  const node = makeNode({ name: 'crate', id: OWN })
  const { form, elements } = setup({ nodes: [node, light], selected: node })
  form.open(node)

  const expected = {
    'select-visibility':    { shows: [HINT_ONE_CLICK], hides: [HINT_LIGHT_ON, HINT_CLIP_END, NO_LIGHTS] },
    'select-light':         { shows: [HINT_LIGHT_ON, HINT_ONE_CLICK], hides: [HINT_CLIP_END, NO_LIGHTS] },
    'select-animation':     { shows: [HINT_CLIP_END], hides: [HINT_LIGHT_ON, HINT_ONE_CLICK, NO_LIGHTS] },
    'proximity-animation':  { shows: [HINT_CLIP_END], hides: [HINT_LIGHT_ON, HINT_ONE_CLICK, NO_LIGHTS] },
    'interval-animation':   { shows: [HINT_CLIP_END], hides: [HINT_LIGHT_ON, HINT_ONE_CLICK, NO_LIGHTS] },
  }

  for (const id of TEMPLATE_IDS) {
    form.onTemplateChange(id)
    const line = elements.hint.textContent
    assert.ok(line.includes(HINT_TEXT), `${id}: the generic sentence is there`)
    assert.equal(line, elements.hintText, `${id}: the hint element gets the computed line`)
    for (const s of expected[id].shows) assert.ok(line.includes(s), `${id} shows "${s}"`)
    for (const s of expected[id].hides) assert.equal(line.includes(s), false, `${id} shows no "${s}"`)
    assert.equal(elements.hint.style.display, '', `${id}: the hint is shown`)
  }

  form.onTemplateChange(CUSTOM_LABEL)
  assert.equal(elements.hint.textContent, '', 'Custom graph clears the hint')
  form.onTemplateChange(NONE_LABEL)
  assert.equal(elements.hint.textContent, '', 'None clears the hint')
  assert.equal(elements.hint.style.display, 'none', 'and hides it')
})

test('T1 — select-light with no lights to offer says so in the hint', () => {
  const plain = makeNode({ name: 'crate', id: TGT })
  const node = makeNode({ name: 'me', id: OWN })
  const { form, elements } = setup({ nodes: [node, plain], selected: node })
  form.open(node)
  form.onTemplateChange('select-light')
  assert.ok(elements.hint.textContent.includes(NO_LIGHTS), elements.hint.textContent)

  form.onTemplateChange('select-visibility')
  assert.equal(elements.hint.textContent.includes(NO_LIGHTS), false, 'only the light template')

  const withLight = makeNode({ name: 'Sun', id: OTHER, light: { intensity: 1 } })
  const { form: f2, elements: e2 } = setup({ nodes: [node, withLight], selected: node })
  f2.open(node)
  f2.onTemplateChange('select-light')
  assert.equal(e2.hint.textContent.includes(NO_LIGHTS), false, 'a light is on offer')
})

test('T1 — an empty hint is hidden, and closing the form clears it', () => {
  const node = makeNode({ name: 'crate', id: OWN })
  const { form, elements } = setup({ nodes: [node], selected: node })
  assert.equal(elements.hint.textContent, '', 'nothing before a selection')
  assert.equal(elements.hint.style.display, 'none', 'and it starts hidden')

  form.open(node)
  assert.equal(elements.hint.textContent, '', 'nothing for "None"')
  assert.equal(elements.hint.style.display, 'none')

  form.onTemplateChange('select-animation')
  assert.equal(elements.hint.style.display, '', 'shown once there is a line')
  form.close()
  assert.equal(elements.hint.textContent, '', 'closing clears it')
  assert.equal(elements.hint.style.display, 'none', 'and hides it again')
})

test('T1 — the D4 sentence is rendered once, in the note, never in the hint', () => {
  const node = makeNode({ name: 'crate', id: OWN })
  const { form, elements } = setup({ nodes: [node], selected: node })
  form.open(node)
  form.onTemplateChange('select-visibility')
  assert.equal(elements.note.textContent, UNDO_NOTE, 'D4 is in the note')
  assert.equal(elements.hint.textContent.includes(UNDO_NOTE), false, 'and not repeated in the hint')
})


// ══════════════════════════════════════════════════════════════════════════
// Round 5 — V1, V2, V10, V11, V12 and V13
// ══════════════════════════════════════════════════════════════════════════

const PARAMS_FOR = {
  'select-visibility': { target: TGT, action: 'toggle' },
  'select-animation': { target: TGT, clip: 'Idle', action: 'play', loop: true },
  'proximity-animation': { target: TGT, clip: 'Idle', loop: true, radius: 3 },
  'select-light': { target: TGT, intensity: 2 },
  'interval-animation': { target: TGT, clip: 'Idle', loop: true, seconds: 5 },
}

/** A world with a cube, a model and a light — every template has a target. */
function worldOf() {
  return [
    makeNode({ name: 'crate', id: OWN }),
    makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } }),
    makeNode({ name: 'Sun', id: OTHER, light: { intensity: 2 } }),
  ]
}

// ── V1 — the form renders in a real page ──────────────────────────────────

test('V1 — choosing each of the five templates renders its parameters and its hint', () => {
  const nodes = worldOf()
  const { form, elements } = setup({ nodes, selected: nodes[0] })
  form.open(nodes[0])
  for (const id of TEMPLATE_IDS) {
    form.onTemplateChange(id)
    assert.equal(form.state.template, id)
    assert.ok(elements.params.children.length > 0, `${id} renders its parameters`)
    assert.ok(elements.hint.textContent.length > 0, `${id} renders its hint`)
    assert.equal(elements.params.style.display, '', `${id}: the params are shown`)
  }
})

test('V1 — opening on a node that ALREADY carries each template renders without throwing', () => {
  // Round 4 threw here: `selectForEdit → refreshEditPanel → refreshBehaviorRow`
  // rendered `field.dataset = { … }` for a node with parameters to show.
  for (const id of TEMPLATE_IDS) {
    const value = templateGraph(id, PARAMS_FOR[id], { ownId: OWN })
    const nodes = worldOf()
    nodes[0] = makeNode({ name: 'crate', id: OWN, behavior: value })
    const { form, elements } = setup({ nodes, selected: nodes[0] })
    assert.doesNotThrow(() => form.open(nodes[0]), `${id} opens without throwing`)
    assert.equal(form.state.template, id, `${id} reopens as itself`)
    assert.ok(elements.params.children.length > 0, `${id} renders its parameters`)
  }
})

// ── V2 — Enabled is a button, and a Custom graph has one (M6, S1) ─────────

test('V2 — a click on Enabled rewrites the value with the flag flipped; a change event does nothing', () => {
  const behavior = templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN })
  const node = makeNode({ name: 'crate', id: OWN, behavior })
  const { form, elements, calls } = setup({ nodes: [node], selected: node })
  form.wire()
  form.open(node)

  assert.equal(elements.enabled.textContent, 'Enabled', 'the label is the state')
  elements.enabled.dispatch('change')
  assert.equal(calls.sendField.length, 0, 'a button fires no change, so nothing was written')

  elements.enabled.dispatch('click')
  assert.equal(calls.sendField.length, 1, 'click writes')
  assert.equal(calls.sendField[0][2].enabled, false)
  assert.equal(elements.enabled.textContent, 'Disabled')
  assert.equal(elements.enabled.disabled, true, 'disabled while the write is in flight')

  // W3 (round 6) — the form re-reads the STORED value when a sequence ends, so
  // the write's own echo is applied here first, exactly as `sendField` does.
  node.extras.atrium.behavior = calls.sendField[0][2]
  form.onAnswer('edit:accepted', { seq: 1 })
  assert.equal(elements.enabled.disabled, false, 'and enabled again once it is settled')
  elements.enabled.dispatch('click')
  assert.equal(calls.sendField.length, 2)
  assert.equal(calls.sendField[1][2].enabled, true)
  assert.deepEqual(calls.sendField[1][2].graph, behavior.graph, 'the graph is untouched')
})

test("V2 — a Custom graph's Enabled works, and touches nothing but `enabled`", () => {
  const stored = { ...templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN }) }
  delete stored.template
  const node = makeNode({ name: 'crate', id: OWN, behavior: stored })
  const { form, elements, calls } = setup({ nodes: [node], selected: node })
  form.open(node)
  assert.equal(form.state.template, CUSTOM_LABEL)
  assert.equal(elements.enabled.disabled, false, 'a Custom graph has Enabled (S1)')
  assert.equal(elements.save.disabled, true, 'and Enabled and Remove only')

  form.setEnabled(false)
  const written = calls.sendField[0][2]
  assert.equal(written.enabled, false)
  assert.deepEqual(written.graph, stored.graph, 'the graph is deep-equal')
  assert.deepEqual(written.nodeMap, stored.nodeMap)
  assert.deepEqual(Object.keys(written).sort(), Object.keys(stored).sort(), 'no key was added')
  assert.deepEqual(
    Object.fromEntries(Object.entries(written).filter(([k]) => k !== 'enabled')),
    Object.fromEntries(Object.entries(stored).filter(([k]) => k !== 'enabled')),
  )
})

// ── V10 — Save follows the target it recorded (M7) ────────────────────────

test('V10 — a target removed and replaced by the same name cancels the Save (M7)', () => {
  // X4 — an animation template's target must be a model on offer.
  const lamp = makeNode({ name: 'Lamp', model: { url: 'a.glb' } })   // no id at Save
  const crate = makeNode({ name: 'crate' })        // the behaviour node, no id either
  const { form, calls, accept, setNodes } = setup({ nodes: [crate, lamp], selected: crate })
  form.open(crate)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', 'name:Lamp')
  form.onParamChange('clip', 'Idle')
  form.save()
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'], 'stage 1 went out')

  // The review's scenario: Lamp is removed and a NEW node named Lamp is added.
  const replacement = makeNode({ name: 'Lamp', model: { url: 'a.glb' } })
  setNodes([crate, replacement])
  accept(1)
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'], 'no further stage went out')
  assert.equal(calls.sendField.length, 0, 'the leaf never went out')
  assert.equal(form.state.status, BEHAVIOR_STATUS.cancelled, '"Save cancelled", once')
})

test("V10 — a target whose id changes between stages cancels the Save", () => {
  const lamp = makeNode({ name: 'Lamp', model: { url: 'a.glb' } })
  const crate = makeNode({ name: 'crate' })        // no id: stage 1 gives it one
  const { form, calls, accept } = setup({ nodes: [crate, lamp], selected: crate })
  form.open(crate)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', 'name:Lamp')
  form.onParamChange('clip', 'Idle')
  form.save()
  accept(1)                                        // stage 1 answered → stage 2 asks for Lamp's id
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate', 'Lamp'])

  lamp.extras.atrium.objectId = OTHER              // changed underneath, between stages
  form.onAnswer('edit:accepted', { seq: 2 })       // the second stage's answer arrives
  assert.equal(calls.sendField.length, 0, 'the leaf never went out')
  assert.equal(form.state.status, BEHAVIOR_STATUS.cancelled)
})

// ── V11 — the default target is one the template can use (S2) ─────────────

test("V11 — select-light on a cube defaults to the world's light, and Save targets it", () => {
  const light = makeNode({ name: 'Sun', id: TGT, light: { intensity: 3 } })
  const cube = makeNode({ name: 'crate', id: OWN })
  const { form, calls } = setup({ nodes: [cube, light], selected: cube })
  form.open(cube)
  form.onTemplateChange('select-light')
  assert.equal(form.state.targetId, TGT, 'the light is the default target, not the cube')

  form.save()
  const value = calls.sendField[0][2]
  assert.equal(value.template.params.target, TGT)
  assert.equal(value.nodeMap[0], OWN)
  assert.equal(behaviorCheck(value, { ownId: OWN }).problem, null, 'and the server would accept it')
})

test('V11 — select-visibility on a cube defaults to that cube', () => {
  const model = makeNode({ name: 'fox', id: TGT, model: { url: 'a.glb' } })
  const cube = makeNode({ name: 'crate', id: OWN })
  const { form } = setup({ nodes: [cube, model], selected: cube })
  form.open(cube)
  form.onTemplateChange('select-visibility')
  assert.equal(form.state.targetId, OWN)
})

test('V11 — the light template with no lights has no target and cannot be saved', () => {
  const plain = makeNode({ name: 'crate', id: TGT })
  const node = makeNode({ name: 'me', id: OWN })
  const { form, elements, calls } = setup({ nodes: [node, plain], selected: node })
  form.open(node)
  form.onTemplateChange('select-light')
  assert.equal(form.state.targetId, '', 'X4 — nothing of the wrong kind is picked, so nothing is held')
  assert.equal(elements.save.disabled, true, 'and Save is disabled')
  assert.equal(form.save(), null, 'nothing goes out')
  assert.equal(calls.sendField.length, 0)
  assert.ok(elements.hint.textContent.includes(NO_LIGHTS))
})

// ── V12 — the strict fake itself ──────────────────────────────────────────

test("V12 — the strict fake enforces the browser's rules", () => {
  const div = el()
  assert.throws(() => { div.dataset = {} }, TypeError, 'dataset is getter-only')
  assert.throws(() => { div.style = {} }, TypeError, 'style is getter-only')
  assert.throws(() => { div.classList = [] }, TypeError, 'classList is getter-only')
  div.dataset.field = 'target'                      // a PROPERTY write is fine
  assert.equal(div.dataset.field, 'target')
  div.style.display = 'none'
  assert.equal(div.style.display, 'none')
  div.classList.add('on')
  assert.equal(div.classList.contains('on'), true)

  const button = el('button')
  assert.equal(isCheckable(button), false)
  assert.throws(() => { button.checked = true }, TypeError, 'checked is only on a checkbox or radio input')
  let fired = 0
  button.addEventListener('change', () => { fired += 1 })
  button.dispatch('change')
  assert.equal(fired, 0, 'a button fires no change')
  button.addEventListener('click', () => { fired += 1 })
  button.dispatch('click')
  assert.equal(fired, 1, 'a button fires click')
  button.disabled = true
  button.dispatch('click')
  assert.equal(fired, 1, 'a disabled control fires nothing')

  const box = el('input')
  box.type = 'checkbox'
  assert.equal(isCheckable(box), true)
  box.checked = true
  assert.equal(box.checked, true)
  let changed = 0
  box.addEventListener('change', () => { changed += 1 })
  box.dispatch('change')
  assert.equal(changed, 1, 'a checkbox fires change')
})

// ── V13 — the Behaviour section doesn't take the form gate (§1.4) ─────────

test('V13 — opening the Behaviour section never closes the gate\'s current form', () => {
  const gate = createFormGate()
  const closed = []
  gate.register('library', () => closed.push('library'))
  gate.register('model', () => closed.push('model'))
  gate.register('teleporter', () => closed.push('teleporter'))
  const node = makeNode({ name: 'crate', id: OWN })
  const { form } = setup({ nodes: [node], selected: node, gate })
  form.wire()                        // app.js wires the form, so `register` runs

  for (const owner of ['library', 'model', 'teleporter']) {
    gate.claim(owner)                  // claiming closes the PREVIOUS holder: expected
    closed.length = 0
    form.open(node)                     // a selection refreshes the Edit panel
    form.render()
    assert.equal(gate.current, owner, `${owner} still holds the gate`)
    assert.deepEqual(closed, [], `opening the Behaviour section does not close ${owner}`)
  }
})

test('V13 — Edit off closes the section and cancels a Save in flight (M4)', () => {
  const lamp = makeNode({ name: 'Lamp', model: { url: 'a.glb' } })  // no id: stage 2 is the pending one
  const crate = makeNode({ name: 'crate', id: OWN })
  const { form, calls, accept } = setup({ nodes: [crate, lamp], selected: crate })
  form.open(crate)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', 'name:Lamp')
  form.onParamChange('clip', 'Idle')
  form.save()
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['Lamp'], 'stage 2 is in flight')

  form.close()                                       // app.js's setEditMode(false)
  accept(1)                                          // the answer arrives anyway
  assert.equal(calls.sendField.length, 0, 'nothing further went out')
  assert.equal(form.state.status, BEHAVIOR_STATUS.cancelled, '"Save cancelled", once')
})

// ── V5 — the clip picker ──────────────────────────────────────────────────

test('V5 — a loaded model shows its clips as a `<select>`', () => {
  const model = makeNode({ name: 'foz', id: TGT, model: { url: 'a.glb' } })
  const cube = makeNode({ name: 'crate', id: OWN })
  const { form, elements } = setup({ nodes: [cube, model], selected: model, clips: { foz: ['Idle', 'Walk'] } })
  form.open(model)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', TGT)
  form.render()

  const fields = elements.params.children.map((row) => row.children[1])
  const clipField = fields.find((f) => f.dataset.field === 'clip')
  assert.ok(clipField, 'the clip field is rendered')
  assert.equal(clipField.tagName, 'select', 'a loaded model gives a select, not a text box')
  assert.deepEqual(clipField.children.map((o) => o.value), ['Idle', 'Walk'])
  assert.equal(clipField.children[0].selected, true, 'the first clip is the default')

  // A model whose clips the host does not know yet keeps the text box.
  const { form: f2, elements: e2 } = setup({ nodes: [cube, model], selected: model })
  f2.open(model)
  f2.onTemplateChange('select-animation')
  f2.onParamChange('target', TGT)
  f2.render()
  const clip2 = e2.params.children.map((row) => row.children[1]).find((f) => f.dataset.field === 'clip')
  assert.equal(clip2.tagName, 'input', 'no ids, no select')
})

// ── 4d G4/G6: the runner's lines, the notes, and the Enable confirmation ────

const litD = (type, value) => ({ type, value: Array.isArray(value) ? value : [value] })

/** A custom (template-less) graph that writes on `event/onStart`. */
function customLeaf({ onStart = true, onTick = false, targets = [] } = {}) {
  const declarations = [
    ...(onStart ? [{ op: 'event/onStart' }] : []),
    ...(onTick ? [{ op: 'event/onTick' }] : []),
    { op: 'pointer/set' },
  ]
  const setterIndex = declarations.length - 1
  return {
    kind: 'graph', origin: 'local', enabled: false,
    graph: {
      types: [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float' }, { signature: 'float3' }, { signature: 'ref' }],
      declarations,
      nodes: [
        ...(onStart ? [{ declaration: 0, flows: { out: { node: setterIndex, socket: 'in' } } }] : []),
        ...(onTick ? [{ declaration: onStart ? 1 : 0, flows: { out: { node: setterIndex, socket: 'in' } } }] : []),
        {
          declaration: setterIndex,
          configuration: { pointer: litD(4, '/nodes/0/translation'), type: litD(1, 3) },
          values: { value: litD(3, [0, 0, 0.8]) },
        },
      ],
    },
    nodeMap: [OWN], targets, animations: [],
  }
}

test('4d G4 — the runner\'s status lines and the notes reach the form, as text', () => {
  const node = makeNode({ name: 'crate', id: OWN })
  const { form, elements, deps } = setup({ nodes: [node], selected: node })
  deps.status = () => ({
    state: 'running',
    lines: [THROTTLED_TEXT, `${PARTIAL_TEXT}: event/onHoverIn`],
    notes: [STARTS_ON_LOAD_NOTE, MISSING_SELECT_NOTE],
  })
  form.open(node)
  form.render()

  assert.deepEqual(elements.lines.children.map((row) => row.textContent), [THROTTLED_TEXT, `${PARTIAL_TEXT}: event/onHoverIn`])
  assert.deepEqual(elements.notes.children.map((row) => row.textContent), [STARTS_ON_LOAD_NOTE, MISSING_SELECT_NOTE])
  assert.equal(elements.lines.style.display, '', 'the lines are shown when there are any')
  assert.equal(elements.notes.style.display, '')
  for (const row of [...elements.lines.children, ...elements.notes.children]) {
    assert.equal(row.children.length, 0, 'text, never markup')
  }
})

test('4d G4 — with no lines and no notes, both elements are emptied and hidden', () => {
  const node = makeNode({ name: 'crate', id: OWN })
  const { form, elements } = setup({ nodes: [node], selected: node })
  form.open(node)
  form.render()
  assert.equal(elements.lines.children.length, 0)
  assert.equal(elements.notes.children.length, 0)
  assert.equal(elements.lines.style.display, 'none')
  assert.equal(elements.notes.style.display, 'none')
})

test('4d G6/Q3 — enabling a custom graph that writes and starts on load asks first', () => {
  const leaf = customLeaf({ onStart: true, targets: [TGT] })
  const node = makeNode({ name: 'crate', id: OWN, behavior: leaf })
  const target = makeNode({ name: 'Fox', id: TGT })
  const { form, deps } = setup({ nodes: [node, target], selected: node })
  const prompts = []
  deps.confirm = (prompt) => { prompts.push(prompt); return true }
  form.open(node)
  assert.equal(form.state.custom, true, 'a template-less leaf opens as Custom graph')

  form.setEnabled(true)
  assert.deepEqual(prompts, [enablePromptText(leaf, { nameOf: null })])
  assert.match(prompts[0], /It can also change: /)
  assert.equal(form.state.enabled, true)
})

test('4d G6/Q3 — declining leaves it disabled and says so; a template never asks', () => {
  const leaf = customLeaf({ onStart: true, targets: [TGT] })
  const node = makeNode({ name: 'crate', id: OWN, behavior: leaf })
  const { form, elements, deps, calls } = setup({ nodes: [node], selected: node })
  let asked = 0
  deps.confirm = () => { asked += 1; return false }
  form.open(node)
  form.setEnabled(true)
  assert.equal(asked, 1)
  assert.equal(form.state.enabled, false, 'the graph was not enabled')
  assert.equal(elements.status.textContent, ENABLE_DECLINED)
  assert.equal(calls.sendField.length, 0, 'nothing was sent')

  // A TEMPLATE's Enable never asks (Q3: a custom graph only).
  const tNode = makeNode({ name: 'cube', id: OWN })
  const tTarget = makeNode({ name: 'Fox', id: TGT })
  const templated = setup({ nodes: [tNode, tTarget], selected: tNode })
  templated.form.open(tNode)
  templated.form.onTemplateChange('select-visibility')
  templated.form.onParamChange('target', TGT)
  templated.form.save()
  templated.accept(1)
  templated.form.setEnabled(false)
  templated.accept(templated.seq())
  let askedAgain = 0
  templated.deps.confirm = () => { askedAgain += 1; return false }
  templated.form.setEnabled(true)
  assert.equal(askedAgain, 0, 'a template does not ask')
  assert.equal(templated.form.state.enabled, true)
})

test('4d G6/Q3 — with no asker available the form declines rather than enabling silently', () => {
  const leaf = customLeaf({ onStart: true })
  const node = makeNode({ name: 'crate', id: OWN, behavior: leaf })
  const { form } = setup({ nodes: [node], selected: node })
  form.open(node)
  form.setEnabled(true)
  assert.equal(form.state.enabled, false, 'no window.confirm in this run: declined')
})
