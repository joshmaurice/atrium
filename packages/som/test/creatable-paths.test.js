// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// creatable-paths.test.js — scripting-4a Z2, the SOM half.
//
// `setPath` used to refuse a final key that does not exist yet (P10: the first
// Play threw `Unknown property "animation" on Object`). Z2 narrows that: exactly
// `extras.atrium.animation` (CREATABLE_PATHS) may create its missing final key,
// and only when every earlier segment is a plain object, and "missing" means NOT
// AN OWN PROPERTY. Every other missing key, a non-canonical spelling of the
// listed one, a missing intermediate and an inherited name such as `toString`
// are still refused.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument, CREATABLE_PATHS } from '../src/SOMDocument.js'

const MODEL = { url: 'https://cdn.example.com/chair.glb' }

/** A world with one model node and one plain node. */
function makeSom() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Model').setExtras({ atrium: { model: { ...MODEL } } }))
  scene.addChild(doc.createNode('Plain'))
  return new SOMDocument(doc)
}

const ANIMATION = { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 }

test('Z2: CREATABLE_PATHS is the listed set', () => {
  assert.deepEqual([...CREATABLE_PATHS], ['extras.atrium.animation', 'extras.atrium.objectId'])
})

test('Z2: setPath creates extras.atrium.animation when it is missing', () => {
  const som = makeSom()
  const node = som.getNodeByName('Model')

  assert.equal(Object.hasOwn(node.extras.atrium, 'animation'), false, 'the leaf starts missing')
  som.setPath(node, 'extras.atrium.animation', ANIMATION)

  assert.equal(Object.hasOwn(node.extras.atrium, 'animation'), true, 'the leaf is an OWN property now')
  assert.deepEqual(node.extras.atrium.animation, ANIMATION, 'the value is set whole')
  assert.deepEqual(node.extras.atrium.model, MODEL, 'the sibling model leaf is untouched')
})

test('Z2: an existing leaf behaves as before — a plain overwrite', () => {
  const som = makeSom()
  const node = som.getNodeByName('Model')
  som.setPath(node, 'extras.atrium.animation', ANIMATION)
  som.setPath(node, 'extras.atrium.animation', null)
  assert.equal(node.extras.atrium.animation, null, 'null (Stop) is stored as it is')
  som.setPath(node, 'extras.atrium.animation', { ...ANIMATION, clip: 'Run' })
  assert.equal(node.extras.atrium.animation.clip, 'Run', 'and it is replaced again')
})

test('Z2: every other missing final key under extras is still refused', () => {
  const som = makeSom()
  const node = som.getNodeByName('Model')
  for (const path of [
    'extras.atrium.other',
    'extras.atrium.playback',
    'extras.other',
    'extras.atrium.animation.clip',
  ]) {
    assert.throws(() => som.setPath(node, path, ANIMATION), /Unknown property|resolved to null/,
      `${path} must stay refused`)
  }
  assert.equal(Object.hasOwn(node.extras.atrium, 'other'), false, 'nothing was created')
})

test('Z2: a non-canonical spelling of the listed path is refused', () => {
  const som = makeSom()
  const node = som.getNodeByName('Model')
  for (const path of [
    'extras..atrium.animation',
    'extras.atrium.animation.',
    '.extras.atrium.animation',
    'extras.atrium.animation[0]',
  ]) {
    assert.throws(() => som.setPath(node, path, ANIMATION), /Unknown property|Empty path|resolved to null/,
      `${path} must stay refused`)
  }
  assert.equal(Object.hasOwn(node.extras.atrium, 'animation'), false, 'nothing was created')
})

test('Z2: a missing intermediate object is still refused', () => {
  const som = makeSom()
  const plain = som.getNodeByName('Plain')
  assert.throws(() => som.setPath(plain, 'extras.atrium.animation', ANIMATION), /resolved to null/,
    'a node with no extras.atrium cannot grow one')
  assert.equal(plain.extras?.atrium, undefined, 'no intermediate was created')
})

test('Z2: an inherited name is never created and never treated as present', () => {
  const som = makeSom()
  const node = som.getNodeByName('Model')
  assert.throws(() => som.setPath(node, 'extras.atrium.toString', 'x'), /Unknown property/,
    'toString is not a field of the document')
  assert.equal(Object.hasOwn(node.extras.atrium, 'toString'), false, 'nothing was created')
  assert.throws(() => som.setPath(node, 'extras.atrium.constructor', 'x'), /Unknown property/,
    'constructor is not a field of the document either')
  assert.equal(Object.hasOwn(node.extras.atrium, 'constructor'), false, 'nothing was created')
})

test('Z2: the wrapper accessors still work — the present rule is unchanged for them', () => {
  const som = makeSom()
  const node = som.getNodeByName('Model')
  // `translation` lives on SOMNode.prototype, not on the instance: it must stay
  // settable (this is why the present test is not a bare Object.hasOwn).
  som.setPath(node, 'translation', [1, 2, 3])
  assert.deepEqual([...node.translation], [1, 2, 3], 'a prototype accessor is still present')
  som.setPath(node, 'extras.atrium.animation', ANIMATION)
  assert.deepEqual(node.extras.atrium.animation, ANIMATION)
})
