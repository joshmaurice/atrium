// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// object-id.test.js — scripting-4b-1 step 1, E2: identity in the SOM.
//
// Two scans with two different jobs (B5 (a)):
//   - `objectIdInUse` — UNIQUENESS: every SAVED node counts, shadowed
//     duplicate-name nodes included, external nodes excluded BY IDENTITY;
//   - `resolveObjectId` — the RESOLVER: one saved node must hold the id AND its
//     name must address it in both name maps (`getNodeByName` and
//     `getObjectByName`, the map `send` resolves through), or the reason is
//     `not-found`, `ambiguous` or `unaddressable`.
//
// And ONE narrow intermediate creation in `setPath` (review M1): exactly
// `extras.atrium.objectId`, on a node with no own `atrium`, creates
// `extras.atrium` first. Generic path creation is NOT widened.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

const A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const B = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const C = '123e4567-e89b-42d3-a456-426614174000'

const withId = (id, extra = {}) => ({ atrium: { objectId: id, ...extra } })

// ===========================================================================
// External nodes — by IDENTITY, never by name
// ===========================================================================

test('E2: an external node carrying an id is ignored by both scans', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Container'))

  const ext = new Document()
  ext.createScene('Ext').addChild(ext.createNode('Crate').setExtras(withId(A)))

  const som = new SOMDocument(doc)
  const created = som.ingestExternalScene('Container', ext)
  const crate = created[0]

  assert.equal(crate.name, 'Container/Crate')
  assert.equal(som.isExternalNode(crate), true, 'recorded by identity in copyNode')
  assert.equal(som.isExternalNode(som.getNodeByName('Container')), false, 'a saved node is not external')

  assert.equal(som.objectIdInUse(A), false, 'an external node’s id is not "in use"')
  assert.deepEqual(som.resolveObjectId(A), { problem: 'not-found' }, 'and it does not resolve')
})

test('E2: an external node’s id does not block a new node taking it', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Container'))

  const ext = new Document()
  ext.createScene('Ext').addChild(ext.createNode('Crate').setExtras(withId(A)))

  const som = new SOMDocument(doc)
  som.ingestExternalScene('Container', ext)
  assert.equal(som.objectIdInUse(A), false, 'nothing saved holds the id yet')

  // A saved node takes the same id: only saved nodes matter.
  const saved = som.createNode({ name: 'Saved', extras: withId(A) })
  assert.equal(som.objectIdInUse(A), true, 'the saved node owns the id')
  assert.equal(som.resolveObjectId(A).node, saved)
})

test('E2: a SAVED node whose name contains a slash is never treated as external', () => {
  // Names a client cannot make (checkNewName refuses "/"), but a document can
  // hold one. A name-prefix test would skip it; identity does not.
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Crate/Crate').setExtras(withId(A)))
  const som = new SOMDocument(doc)

  const node = som.getNodeByName('Crate/Crate')
  assert.ok(node)
  assert.equal(som.isExternalNode(node), false, 'not external — nothing ingested it')
  assert.equal(som.objectIdInUse(A), true, 'its id IS in use')
  assert.equal(som.resolveObjectId(A).node, node)
})

// ===========================================================================
// Shadowed duplicate names
// ===========================================================================

test('E2: a shadowed duplicate-name node’s id IS in use, but resolves unaddressable', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const first = doc.createNode('Dup')
  const shadowed = doc.createNode('Dup').setExtras(withId(A))
  scene.addChild(first)
  scene.addChild(shadowed)
  const som = new SOMDocument(doc)

  const shadowedSom = som.allNodes.find((n) => n.name === 'Dup' && n !== som.getNodeByName('Dup'))
  assert.ok(shadowedSom, 'the second node is in allNodes')
  assert.equal(shadowedSom.name, 'Dup')

  assert.equal(som.objectIdInUse(A), true, 'the shadowed node is saved, so its id counts')
  assert.equal(som.resolveObjectId(A).problem, 'unaddressable',
    'its name addresses the first node, so a send by that name would reach another object')
})

test('E2: after its predecessor is removed, the same id resolves to the survivor', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const first = doc.createNode('Dup')
  const shadowed = doc.createNode('Dup').setExtras(withId(A))
  scene.addChild(first)
  scene.addChild(shadowed)
  const som = new SOMDocument(doc)

  assert.deepEqual(som.resolveObjectId(A), { problem: 'unaddressable' })

  som.removeSubtree(som.getNodeByName('Dup'))
  assert.equal(som.resolveObjectId(A).node?.name, 'Dup', 'the freed name passes to the survivor')
})

test('E2: after its predecessor is renamed, the same id resolves to the survivor', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const first = doc.createNode('Dup')
  const shadowed = doc.createNode('Dup').setExtras(withId(A))
  scene.addChild(first)
  scene.addChild(shadowed)
  const som = new SOMDocument(doc)

  const result = som.renameNode('Dup', 'First')
  assert.equal(result.ok, true)
  assert.equal(som.resolveObjectId(A).node?.name, 'Dup', 'the survivor takes the name over')
})

// ===========================================================================
// The two name maps can disagree (S-D)
// ===========================================================================

test('E2: a node whose name a non-node owns FOR SEND resolves unaddressable', () => {
  // `getNodeByName` reads `_nodesByName`; `getObjectByName` (and so
  // `resolveSendTarget`) reads `_objectsByName`. They can disagree: an
  // animation already holds the name in the object map, so a node created
  // afterwards under that name lands only in the node map. A `send` addressed
  // by the name reaches the animation, not the node.
  const doc = new Document()
  doc.createScene('Scene')
  doc.createAnimation('Spin')
  const som = new SOMDocument(doc)

  const somNode = som.createNode({ name: 'Spin', extras: withId(A) })
  assert.ok(somNode)
  assert.notEqual(som.getObjectByName('Spin'), somNode,
    'the object map gives something else — that is the disagreement')
  assert.equal(som.getNodeByName('Spin'), somNode, 'the node map gives the node')

  assert.equal(som.objectIdInUse(A), true, 'the node is saved')
  assert.equal(som.resolveObjectId(A).problem, 'unaddressable',
    'getObjectByName would send the write to another object')
})

// ===========================================================================
// The scans: not-found, ambiguous, found
// ===========================================================================

test('E2: resolveObjectId finds the one saved node, and reports not-found otherwise', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Alpha').setExtras(withId(A)))
  const som = new SOMDocument(doc)

  assert.equal(som.resolveObjectId(A).node?.name, 'Alpha')
  assert.deepEqual(som.resolveObjectId(B), { problem: 'not-found' })
  assert.equal(som.objectIdInUse(A), true)
  assert.equal(som.objectIdInUse(B), false)
})

test('E2: two saved nodes with one id resolve ambiguous (a document loaded without healing)', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('One').setExtras(withId(A)))
  scene.addChild(doc.createNode('Two').setExtras(withId(A)))
  const som = new SOMDocument(doc)

  assert.equal(som.objectIdInUse(A), true)
  assert.deepEqual(som.resolveObjectId(A), { problem: 'ambiguous' })
})

test('E2: an INHERITED objectId is never a node’s id (own property only)', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Plain').setExtras({ atrium: {} }))
  const som = new SOMDocument(doc)
  const node = som.getNodeByName('Plain')

  Object.defineProperty(Object.prototype, 'objectId', {
    value: A, configurable: true, enumerable: false, writable: true,
  })
  try {
    assert.equal('objectId' in node.extras.atrium, true, 'the inherited name is visible to `in`')
    assert.equal(Object.hasOwn(node.extras.atrium, 'objectId'), false, 'but it is not an own property')
    assert.equal(som.objectIdInUse(A), false, 'so the node has no id')
    assert.deepEqual(som.resolveObjectId(A), { problem: 'not-found' })
  } finally {
    delete Object.prototype.objectId
  }
})

test('E2: a non-plain extras or atrium gives no id (plain-object checks only)', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const arrayAtrium = doc.createNode('ArrayAtrium').setExtras({ atrium: [A] })
  const inheritedAtrium = doc.createNode('InheritedAtrium')
  inheritedAtrium.setExtras({ atrium: Object.create({ objectId: A }) })
  scene.addChild(arrayAtrium)
  scene.addChild(inheritedAtrium)
  const som = new SOMDocument(doc)

  assert.equal(som.objectIdInUse(A), false, 'neither shape yields an id')
  assert.deepEqual(som.resolveObjectId(A), { problem: 'not-found' })
})

test('E2: a null-prototype atrium is a plain object and its own id counts', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const atrium = Object.create(null)
  atrium.objectId = A
  scene.addChild(doc.createNode('NullProto').setExtras({ atrium }))
  const som = new SOMDocument(doc)

  assert.equal(som.objectIdInUse(A), true)
  assert.equal(som.resolveObjectId(A).node?.name, 'NullProto')
})

// ===========================================================================
// setPath (M1) — the one narrow intermediate creation
// ===========================================================================

test('E2/M1: setPath creates extras.atrium.objectId on a node with no atrium, keeping other keys', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Floor').setExtras({ displayName: 'floor', atrium: undefined }))
  const node = scene.listChildren()[0]
  node.setExtras({ displayName: 'floor' })
  const som = new SOMDocument(doc)

  const somNode = som.getNodeByName('Floor')
  assert.equal(Object.hasOwn(somNode.extras, 'atrium'), false, 'the node starts with no own atrium')

  som.setPath(somNode, 'extras.atrium.objectId', A)

  assert.equal(Object.hasOwn(somNode.extras, 'atrium'), true, 'extras.atrium was created')
  assert.deepEqual(somNode.extras.atrium, { objectId: A })
  assert.equal(somNode.extras.displayName, 'floor', 'every other extras key is kept')
})

test('E2/M1: setPath creates the leaf on an empty atrium, and on one with existing data', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Empty').setExtras({ atrium: {} }))
  scene.addChild(doc.createNode('Full').setExtras({ atrium: { model: { url: 'https://x.example/m.glb' } } }))
  const som = new SOMDocument(doc)

  som.setPath(som.getNodeByName('Empty'), 'extras.atrium.objectId', A)
  assert.deepEqual(som.getNodeByName('Empty').extras.atrium, { objectId: A })

  som.setPath(som.getNodeByName('Full'), 'extras.atrium.objectId', B)
  assert.deepEqual(som.getNodeByName('Full').extras.atrium, {
    model: { url: 'https://x.example/m.glb' }, objectId: B,
  }, 'the sibling model leaf survives')
})

test('E2/M1: a non-plain atrium is refused, and null counts as EXISTING', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Array').setExtras({ atrium: [] }))
  scene.addChild(doc.createNode('Null').setExtras({ atrium: null }))
  scene.addChild(doc.createNode('Text').setExtras({ atrium: 'x' }))
  const som = new SOMDocument(doc)

  for (const name of ['Array', 'Null', 'Text']) {
    const node = som.getNodeByName(name)
    const before = JSON.stringify(node.extras)
    assert.throws(() => som.setPath(node, 'extras.atrium.objectId', A), Error,
      `${name}: an existing non-plain atrium is refused`)
    assert.equal(JSON.stringify(node.extras), before, `${name}: nothing was created`)
  }
  assert.deepEqual(som.getNodeByName('Null').extras.atrium, null, 'null was not "fixed" into {}')
})

test('E2/M1: generic path creation is NOT widened', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Floor'))
  const som = new SOMDocument(doc)
  const node = som.getNodeByName('Floor')

  for (const path of [
    'extras.atrium.other',
    'extras.atrium.animation',
    'extras.atrium.animation.clip',
  ]) {
    assert.throws(() => som.setPath(node, path, {}), /Unknown property|resolved to null/,
      `${path} must stay refused on a node with no atrium`)
  }
  assert.equal(Object.hasOwn(node.extras, 'atrium'), false, 'no intermediate was created')
})

test('E2/M1: a non-canonical spelling of the leaf is still refused', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Floor'))
  const som = new SOMDocument(doc)
  const node = som.getNodeByName('Floor')

  for (const path of [
    'extras..atrium.objectId',
    '.extras.atrium.objectId',
    'extras.atrium.objectId.',
    'extras.atrium.objectId[0]',
  ]) {
    assert.throws(() => som.setPath(node, path, A), /Unknown property|Empty path|resolved to null/,
      `${path} is not the listed path`)
  }
})
