// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-form.test.js — scripting-4b-2 step 6, F9. No DOM: a tiny element
// stand-in and a `createElement` dep, so the form's own decisions are tested.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createBehaviorForm, NONE_LABEL, CUSTOM_LABEL, BEHAVIOR_STATUS, matchesTemplate, targetKindFor,
} from '../src/behavior-form.js'
import { templateGraph, TEMPLATE_IDS } from '@atrium/behaviors/templates'
import { behaviorCheck } from '@atrium/behaviors/behavior-spec'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

// ── a tiny element stand-in ────────────────────────────────────────────────
function el(tag = 'div') {
  const node = {
    tagName: tag, style: {}, dataset: {}, children: [], _text: '', _listeners: {},
    value: '', checked: false, disabled: false, selected: false, type: '', title: '',
    appendChild(child) { node.children.push(child); node.firstChild = node.children[0] ?? null; return child },
    removeChild(child) { node.children = node.children.filter((c) => c !== child); node.firstChild = node.children[0] ?? null; return child },
    addEventListener(type, fn) { node._listeners[type] = fn },
    dispatch(type, event) { node._listeners[type]?.(event ?? { target: node }) },
  }
  Object.defineProperty(node, 'textContent', {
    get: () => node._text,
    set: (value) => { node._text = String(value ?? '') },
  })
  return node
}
const elementsFor = () => ({
  row: el(), select: el('select'), params: el(), actions: el(),
  enabled: el('button'), save: el('button'), remove: el('button'),
  status: el(), note: el(), logLines: el(),
})

function makeNode({ name, id = null, model = null, light = null, behavior }) {
  return {
    name,
    light,
    extras: { atrium: { ...(id ? { objectId: id } : {}), ...(model ? { model } : {}), ...(behavior === undefined ? {} : { behavior }) } },
  }
}

function setup({ nodes = [], selected = null, status = {} } = {}) {
  const elements = elementsFor()
  const calls = { setObjectId: [], sendField: [] }
  let seq = 0
  let clock = 0
  const deps = {
    selected: () => selected,
    nodes: () => nodes,
    status: () => status.state ? status : {},
    write: {
      setObjectId: (name, id) => { calls.setObjectId.push([name, id]); return ++seq },
      sendField: (name, field, value) => { calls.sendField.push([name, field, value]); return ++seq },
    },
    newObjectId: () => `9999${String(++clock).padStart(4, '0')}-9999-4999-8999-999999999999`,
    createElement: (tag) => el(tag),
    showError: () => {},
    clearError: () => {},
    logLines: () => [],
  }
  const form = createBehaviorForm({ elements, deps })
  return { form, elements, calls, deps, seq: () => seq, setSelected: (n) => { selected = n } }
}

// ── F9: the Save sequence (M4) ─────────────────────────────────────────────

test('F9 — Save on a node with no id sends setObjectId FIRST, then the leaf after edit:accepted', () => {
  const target = makeNode({ name: 'target', id: TGT })
  const node = makeNode({ name: 'crate', behavior: undefined })
  const { form, calls } = setup({ nodes: [node, target], selected: node })
  form.open(node)
  form.onTemplateChange('select-visibility')
  form.onParamChange('target', TGT)
  const generation = form.save()
  assert.equal(typeof generation, 'number')
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'], 'stage 1: the node\'s own id')
  assert.equal(calls.sendField.length, 0, 'nothing else has gone out')

  const id = calls.setObjectId[0][1]
  form.onAnswer('edit:accepted', { seq: 1 })
  assert.equal(calls.sendField.length, 1, 'stage 3: the leaf, after the id was answered')
  const [name, field, value] = calls.sendField[0]
  assert.equal(name, 'crate')
  assert.equal(field, 'extras.atrium.behavior')
  assert.equal(value.nodeMap[0], id, 'the value names the id the node actually got')
  assert.equal(value.template.id, 'select-visibility')
  assert.equal(behaviorCheck(value, { ownId: id }).problem, null)
})

test('F9 — all three stages complete in order, and the final value is the template\'s', () => {
  const target = makeNode({ name: 'target' })
  const node = makeNode({ name: 'crate' })
  const { form, calls } = setup({ nodes: [node, target], selected: node })
  form.open(node)
  form.onTemplateChange('select-animation')
  form.onParamChange('target', `name:target`)
  form.onParamChange('clip', 'Idle')
  form.save()

  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate'])
  form.onAnswer('edit:accepted', { seq: 1 })
  assert.deepEqual(calls.setObjectId.map((c) => c[0]), ['crate', 'target'], 'stage 2: the target\'s own id')
  form.onAnswer('edit:accepted', { seq: 2 })

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
  const target = makeNode({ name: 'target' })
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
  assert.equal(elements.enabled.disabled, true)
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
  const { form: disabled, elements: de } = setup({ nodes: [node], selected: node, status: { state: 'disabled', reason: 'behavior-kind' } })
  disabled.open(node)
  assert.match(de.status.textContent, /^Disabled: /)
  assert.match(de.status.textContent, /kind must be "graph"/)
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
  const listed = elements.params.children.map((row) => row.children[0])
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
  assert.deepEqual(elements.params.children.map((row) => row.children[0]).map((f) => f.children.length), [0], 'no target offered')
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
    ['a missing intensity', {}],
    ['a non-numeric intensity', { intensity: '2' }],
    ['no light object at all', null],
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
  const light = makeNode({ name: 'Sun', id: TGT, light: { intensity: 2 } })
  const node = makeNode({ name: 'crate', id: OWN })
  const { form, elements } = setup({ nodes: [node, light], selected: node })
  form.open(node)
  form.onTemplateChange('select-light')
  assert.equal(elements.hintText, `${GENERIC_HINT} ${C2_SENTENCE}`)
  // The same rendering path: `renderParams` writes `elements.hintText` into the hint.
  elements.hint = el()
  form.render()
  assert.equal(elements.hint.textContent, `${GENERIC_HINT} ${C2_SENTENCE}`)

  for (const id of TEMPLATE_IDS) {
    if (id === 'select-light') continue
    form.onTemplateChange(id)
    assert.equal(elements.hintText, GENERIC_HINT, `${id} keeps the generic hint`)
    assert.equal(elements.hintText.includes(C2_SENTENCE), false, `${id} shows no C2 sentence`)
  }
  form.onTemplateChange(NONE_LABEL)
  assert.equal(elements.hintText.includes(C2_SENTENCE), false, 'None shows no C2 sentence')
})

