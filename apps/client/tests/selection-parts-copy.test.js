// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// selection-parts T11 (PREBRIEF-selection-parts.md FINAL Rev 2, §4, §5): Copy
// of a PART carries its world placement in the snapshot's root (the parent's
// world matrix passed by the app, from the SOM node); Paste puts it at the top
// level, x and z from the palette, y the part's world y. Duplicate in place
// keeps references outside the copied tree; a Paste into another world
// replaces and records them.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { localMatrix, worldMatrix, SOMDocument } from '@atrium/som'
import { copyObject, preparePaste, partCopyProblem } from '../src/copy-paste.js'
import { prepareDuplicate, duplicateRuleProblem, DUPLICATE_REASONS } from '../src/edit-duplicate.js'
import { parentFrameOffset } from '../src/part-transform.js'
import { templateGraph } from '../../../packages/behaviors/src/templates.js'

const { Document, NodeIO } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { fileURLToPath } = await import('node:url')

const SRC_WS = 'wss://a.example/worlds/alice/garden'
const WORLD_A = { id: 'world-a', owner: { id: 'user-alice', name: 'alice' } }
const DAY = '2026-11-08'
const TRI = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
const quatY = (deg) => { const h = deg * Math.PI / 360; return [0, Math.sin(h), 0, Math.cos(h)] }
const quatZ = (deg) => { const h = deg * Math.PI / 360; return [0, 0, Math.sin(h), Math.cos(h)] }
const close = (a, b, eps, what) => {
  assert.equal(a.length, b.length, what)
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps, `${what}[${i}]: ${a[i]} vs ${b[i]}`)
}

/** A lamp (as space.gltf's) whose root is moved, turned and scaled; the shade's behaviour targets the stand. */
function lamp({ rotation = quatY(90), scale = [2, 2, 2], shadeRotation = [0, 0, 0, 1] } = {}) {
  const doc = new Document()
  const buf = doc.createBuffer()
  const mesh = () => doc.createMesh().addPrimitive(doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(TRI.slice()).setBuffer(buf))
    .setMaterial(doc.createMaterial('m')))
  const ids = { shade: crypto.randomUUID(), stand: crypto.randomUUID() }
  const root = doc.createNode('lamp-01').setTranslation([3, 0, 0]).setRotation(rotation).setScale(scale)
  const stand = doc.createNode('lamp-stand').setTranslation([0, 0.75, 0]).setMesh(mesh())
    .setExtras({ atrium: { objectId: ids.stand } })
  const shade = doc.createNode('lamp-shade').setTranslation([0, 1.6, 0]).setRotation(shadeRotation).setMesh(mesh())
    .setExtras({ atrium: { objectId: ids.shade, behavior: templateGraph('select-visibility', { target: ids.stand, action: 'toggle' }, { ownId: ids.shade }) } })
  root.addChild(stand).addChild(shade)
  doc.createScene().addChild(root)
  const som = new SOMDocument(doc)
  return { doc, som, ids, shade: som.getNodeByName('lamp-shade'), root: som.getNodeByName('lamp-01') }
}

const copyPart = (w, opts = {}) => copyObject(w.shade._node, { wsUrl: SRC_WS, world: WORLD_A },
  { date: DAY, nameOf: () => 'the stand', trees: true, parentWorld: worldMatrix(w.shade.parent), ...opts })

describe('T11: Copy of a part', () => {
  test('a part of a group moved, rotated 90° about y and scaled 2: the snapshot’s root is the part’s world placement', () => {
    const w = lamp()
    const r = copyPart(w)
    assert.equal(r.ok, true, r.reason)
    const d = r.snapshot.descriptor
    close(localMatrix(d), worldMatrix(w.shade), 1e-5, 'world')
    close(d.translation, [3, 3.2, 0], 1e-9, 'the part’s world position')
  })
  test('after Paste: rotation, scale and y are the part’s world ones; x and z the palette’s', () => {
    const w = lamp()
    const snap = copyPart(w).snapshot
    const p = preparePaste(snap, { isFree: () => true, position: [10, 0, 20], destOrigin: 'https://a.example', destWorldId: 'world-a', destAddFields: 3 })
    assert.equal(p.ok, true, p.reason)
    const world = worldMatrix(w.shade)
    const pasted = localMatrix(p.descriptor)
    close([pasted[0], pasted[1], pasted[2], pasted[4], pasted[5], pasted[6], pasted[8], pasted[9], pasted[10]],
      [world[0], world[1], world[2], world[4], world[5], world[6], world[8], world[9], world[10]], 1e-5, '3×3')
    close(p.descriptor.translation, [10, world[13], 20], 1e-9, 'translation')
  })
  test('a mirrored group ([-1, 1, 1]) is carried, not refused', () => {
    const w = lamp({ rotation: [0, 0, 0, 1], scale: [-1, 1, 1] })
    const r = copyPart(w)
    assert.equal(r.ok, true, r.reason)
    close(localMatrix(r.snapshot.descriptor), worldMatrix(w.shade), 1e-5, 'world')
  })
  test('a part with a rotation below a non-uniformly scaled group is refused with the shear sentence', () => {
    const w = lamp({ rotation: [0, 0, 0, 1], scale: [2, 1, 1], shadeRotation: quatZ(45) })
    const r = copyPart(w)
    assert.equal(r.ok, false)
    assert.equal(r.rule, 'shear')
    assert.equal(r.reason, DUPLICATE_REASONS.shear)
    assert.equal(partCopyProblem(w.shade._node, worldMatrix(w.shade.parent)), DUPLICATE_REASONS.shear, 'the hint says so too')
  })
  test('a top-level node’s snapshot TRS is bit for bit its own (no decomposition)', () => {
    const w = lamp()
    const r = copyObject(w.root._node, { wsUrl: SRC_WS, world: WORLD_A }, { date: DAY, trees: true })
    assert.equal(r.ok, true, r.reason)
    assert.deepEqual(r.snapshot.descriptor.translation, [...w.root._node.getTranslation()])
    assert.deepEqual(r.snapshot.descriptor.rotation, [...w.root._node.getRotation()])
    assert.deepEqual(r.snapshot.descriptor.scale, [...w.root._node.getScale()])
    assert.equal(partCopyProblem(w.root._node, null), null)
  })
})

describe('T11: references outside the copied tree', () => {
  test('a same-world Duplicate in place keeps the shade’s reference to the stand (a grant)', () => {
    const w = lamp({ rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
    const r = prepareDuplicate(w.shade._node, { name: 'lamp-shade copy', isFree: (n) => w.som.checkNewName(n).ok, trees: true, offset: parentFrameOffset(worldMatrix(w.shade.parent)) })
    assert.equal(r.ok, true, r.reason)
    assert.equal(r.descriptor.extras.atrium.behavior.template.params.target, w.ids.stand)
    assert.notEqual(r.descriptor.extras.atrium.objectId, w.ids.shade, 'a fresh id')
    close(r.descriptor.translation, [1.5, 1.6, 0], 1e-12, 'local x + 1.5 under a unit, unturned group')
  })
  test('a Paste into another world replaces the reference and records it', () => {
    const w = lamp()
    const snap = copyPart(w).snapshot
    const p = preparePaste(snap, { isFree: () => true, position: [0, 0, 0], destOrigin: 'https://b.example', destWorldId: 'world-b', destAddFields: 3, confirm: () => true })
    assert.equal(p.ok, true, p.reason)
    const atrium = p.descriptor.extras.atrium
    assert.notEqual(atrium.behavior.template.params.target, w.ids.stand)
    assert.deepEqual(atrium.copiedFrom.refs, [{ id: atrium.behavior.template.params.target, was: w.ids.stand, name: 'the stand' }])
  })
})

describe('T11: a sub-group and the ancestors rule', () => {
  test('Duplicate of Bench-NE in atrium.gltf: a tree under Furniture, every member renamed', async () => {
    const doc = await new NodeIO().read(fileURLToPath(new URL('../../../tests/fixtures/atrium.gltf', import.meta.url)))
    const som = new SOMDocument(doc)
    const bench = som.getNodeByName('Bench-NE')
    const r = prepareDuplicate(bench._node, { name: 'Bench-NE copy', isFree: (n) => som.checkNewName(n).ok, trees: true, offset: parentFrameOffset(worldMatrix(bench.parent)) })
    assert.equal(r.ok, true, r.reason)
    assert.deepEqual(r.descriptor.children.map((c) => c.name), ['Bench-NE-Seat copy', 'Bench-NE-LegLeft copy', 'Bench-NE-LegRight copy'])
    assert.equal(bench.parent.name, 'Furniture')
  })
  test('a part of externally loaded content is refused, with external\u2019s reason', () => {
    const doc = new Document()
    const ext = doc.createNode('statue').setExtras({ atrium: { source: 'statue.gltf' } })
    const head = doc.createNode('statue/Head')
    ext.addChild(head)
    doc.createScene().addChild(ext)
    const r = duplicateRuleProblem(head, { trees: true })
    assert.equal(r?.rule, 'ancestors')
    assert.equal(r.reason, DUPLICATE_REASONS.external)
  })
  test('a part under an excluded ancestor is refused ancestors (the app passes glTF nodes)', () => {
    const doc = new Document()
    const av = doc.createNode('User-aaaa')
    const child = doc.createNode('hat')
    av.addChild(child)
    doc.createScene().addChild(av)
    const r = duplicateRuleProblem(child, { trees: true, isExcluded: (g) => g.getName() === 'User-aaaa' })
    assert.equal(r?.rule, 'ancestors')
    assert.equal(r.reason, DUPLICATE_REASONS.ancestors)
  })
})
