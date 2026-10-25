// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-duplicate-behavior.test.js — scripting-4b-2 step 6, F10.
//
// The copy's SELF-references are remapped (nodeMap, targets, animations[].object
// and template.params.target) and its grants to other objects are kept (F-L10).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { prepareDuplicate, prepareRestore, remapBehaviorTargets, duplicateRuleProblem } from '../src/edit-duplicate.js'
import { templateGraph } from '@atrium/behaviors/templates'
import { createBehaviorForm } from '../src/behavior-form.js'
import { el, elementsFor } from './strict-element.mjs'

const OWN = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const GRANT = '33333333-3333-4333-8333-333333333333'

function node(o = {}) {
  const n = {
    name: 'Cube', translation: [1, 0.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1], extras: {},
    mesh: null, children: [], parents: ['Root', 'Scene'], camera: null, skin: null, light: null,
    extensions: 0, ...o,
  }
  return {
    getName: () => n.name,
    getTranslation: () => n.translation, getRotation: () => n.rotation, getScale: () => n.scale,
    getExtras: () => n.extras, getMesh: () => n.mesh, listChildren: () => n.children,
    listParents: () => n.parents.map((t) => ({ propertyType: t })),
    getCamera: () => n.camera, getSkin: () => n.skin, getWeights: () => n.weights ?? [],
    getExtension: (e) => (e === 'lights_punctual' || e === 'KHR_lights_punctual' ? n.light : null),
    listExtensions: () => [],
    _n: n,
  }
}

test('F10 — remapBehaviorTargets rewrites every SELF-reference', () => {
  const value = templateGraph('select-visibility', { target: OWN, action: 'hide' }, { ownId: OWN })
  const remapped = remapBehaviorTargets(value, OWN, OTHER)
  assert.deepEqual(remapped.nodeMap, [OTHER])
  assert.deepEqual(remapped.targets, [])
  assert.deepEqual(value.nodeMap, [OWN], 'the input is never mutated')
})

test('F10 — a grant to ANOTHER object is kept, and only the self-reference moves', () => {
  const value = templateGraph('select-visibility', { target: GRANT, action: 'hide' }, { ownId: OWN })
  const remapped = remapBehaviorTargets(value, OWN, OTHER)
  assert.deepEqual(remapped.nodeMap, [OTHER, GRANT])
  assert.deepEqual(remapped.targets, [GRANT], 'the grant is the owner\'s, and it survives the copy')
  assert.equal(remapped.template.params.target, GRANT)
})

test('F10 — animations[].object and template.params.target are remapped too (Rev 2, M3)', () => {
  const value = templateGraph('select-animation', { target: OWN, clip: 'Idle', action: 'play', loop: true }, { ownId: OWN })
  const remapped = remapBehaviorTargets(value, OWN, OTHER)
  assert.deepEqual(remapped.nodeMap, [OTHER])
  assert.equal(remapped.animations[0].object, OTHER)
  assert.equal(remapped.template.params.target, OTHER)
})

test('F10 — a value with no behaviour passes through untouched', () => {
  assert.equal(remapBehaviorTargets(null, OWN, OTHER), null)
  assert.equal(remapBehaviorTargets('nope', OWN, OTHER), 'nope')
  assert.deepEqual(remapBehaviorTargets({ a: 1 }, OWN, OWN), { a: 1 })
})

test('F10 — a copy reopens with the COPY as its own target (nodeMap[0] === its own id)', () => {
  const original = node({ extras: { atrium: { objectId: OWN, behavior: templateGraph('select-visibility', { target: OWN, action: 'hide' }, { ownId: OWN }) } } })
  const result = prepareDuplicate(original, { name: 'Cube copy' })
  assert.equal(result.ok, true)
  const atrium = result.descriptor.extras.atrium
  assert.equal(atrium.behavior.nodeMap[0], atrium.objectId)
  assert.equal(atrium.behavior.template.params.target, atrium.objectId)
  assert.notEqual(atrium.objectId, OWN, 'the copy never carries the original\'s id')
})

test('F10 — prepareRestore keeps the value exactly as it is (E-L2)', () => {
  const behavior = templateGraph('select-visibility', { target: OTHER, action: 'hide' }, { ownId: OWN })
  const original = node({ extras: { atrium: { objectId: OWN, behavior } } })
  const result = prepareRestore(original, { name: 'Cube' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.descriptor.extras.atrium.behavior, behavior)
  assert.equal(result.descriptor.extras.atrium.objectId, OWN)
})

test('F10 — a malformed behaviour refuses with the new text', () => {
  const broken = { kind: 'js', graph: {}, nodeMap: [OWN], targets: [], animations: [], enabled: true, origin: 'local' }
  const original = node({ extras: { atrium: { objectId: OWN, behavior: broken } } })
  const problem = duplicateRuleProblem(original)
  assert.equal(problem.ok, false)
  assert.equal(problem.rule, 'atrium')
  assert.match(problem.reason, /its behaviour is malformed/)
})

test('F10 — a null behaviour is the "no behaviour" value and is not a problem', () => {
  const original = node({ extras: { atrium: { objectId: OWN, behavior: null } } })
  assert.equal(duplicateRuleProblem(original), null)
})

// ── V1 (round 5) — the copy reopens, and the section stays open ───────────

test('V1 — a duplicated node with a behaviour reopens in the form without throwing', () => {
  // Round 4 threw here too: opening the form on a node that ALREADY has a
  // behaviour went through `selectForEdit → refreshEditPanel →
  // refreshBehaviorRow`, and the render assigned `field.dataset` (which a real
  // page refuses). Duplicate left the section open on the copy; now it renders.
  const original = node({ extras: { atrium: { objectId: OWN, behavior: templateGraph('select-visibility', { target: OWN, action: 'hide' }, { ownId: OWN }) } } })
  const result = prepareDuplicate(original, { name: 'Cube copy' })
  assert.equal(result.ok, true)

  const copy = { name: 'Cube copy', extras: result.descriptor.extras }
  const elements = elementsFor()
  const form = createBehaviorForm({
    elements,
    deps: {
      selected: () => copy,
      nodes: () => [copy],
      status: () => ({}),
      write: { setObjectId: () => 1, sendField: () => 2 },
      createElement: (tag) => el(tag),
      logLines: () => [],
    },
  })
  assert.doesNotThrow(() => form.open(copy))
  assert.equal(form.state.template, 'select-visibility', 'the copy reopens as its template')
  assert.equal(form.state.targetId, copy.extras.atrium.objectId, 'targeting the copy')
  assert.equal(elements.save.disabled, false, 'and it can be saved unchanged')
  assert.ok(elements.params.children.length > 0, 'with its parameters rendered')
})
