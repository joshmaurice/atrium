// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add T6 (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2, §5): Copy and
// Paste of a TREE, pure, on real glTF-Transform nodes. Every Paste step
// applies to every member: names, one fresh id per member through one map, the
// extras rule, the behaviour rule, the URL rule, the credit; the hidden marker
// goes from the root only; a server below level 3 takes no group, and a
// level-3 snapshot's refs are turned back into materials for it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  copyObject, preparePaste, renamePaste, treeMembers, partsSummary, partsLines, partsText, descriptorPartsSummary,
  PASTE_TEXT, NOTE_TEXT,
} from '../src/copy-paste.js'
import { DUPLICATE_REASONS } from '../src/edit-duplicate.js'
import { checkAddNode } from '../../../packages/client/src/add-spec.js'
import { behaviorCheck } from '../../../packages/behaviors/src/behavior-spec.js'
import { templateGraph } from '../../../packages/behaviors/src/templates.js'

const { Document } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')

const SRC_WS = 'wss://a.example/worlds/alice/garden'
const WORLD_A = { id: 'world-a', owner: { id: 'user-alice', name: 'alice' } }
const DEST = 'https://b.example'
const DAY = '2026-11-07'
const TRI = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
const uuid = () => crypto.randomUUID()

/**
 * A lamp: a meshless root with an id; a shade (mesh, a material shared with
 * the stand, a behaviour aimed at the root and one at an object outside); a
 * stand (the shared material, hidden); a model part with a root-path URL; a
 * pad part with a path destination; an unknown extras.atrium key on the stand.
 */
function lampWorld({ sharedMaterial = true } = {}) {
  const doc = new Document()
  const scene = doc.createScene()
  const buf = doc.createBuffer()
  const mat = doc.createMaterial('Brass').setBaseColorFactor([1, 0.8, 0.2, 1])
  const mesh = (m) => doc.createMesh().addPrimitive(doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(TRI.slice()).setBuffer(buf)).setMaterial(m))
  const ids = { lamp: uuid(), shade: uuid(), stand: uuid(), outside: uuid() }
  const leaf = (own, target) => templateGraph('select-visibility', { target, action: 'toggle' }, { ownId: own })
  const lamp = doc.createNode('lamp').setTranslation([10, 0.5, -4]).setExtras({ atrium: { objectId: ids.lamp, behavior: leaf(ids.lamp, ids.outside) } })
  const shade = doc.createNode('shade').setTranslation([0, 1.6, 0]).setMesh(mesh(mat))
    .setExtras({ atrium: { objectId: ids.shade, behavior: { ...leaf(ids.shade, ids.lamp), enabled: true } } })
  const stand = doc.createNode('stand').setMesh(mesh(sharedMaterial ? mat : doc.createMaterial('Iron')))
    .setExtras({ __atrium_visible: false, atrium: { objectId: ids.stand, planted: 'x' } })
  const model = doc.createNode('model').setExtras({ atrium: { model: { url: '/assets/library/lamp.glb' } } })
  const pad = doc.createNode('pad').setMesh(mesh(doc.createMaterial('Pad')))
    .setExtras({ atrium: { teleporter: { destination: '/worlds/alice/home' } } })
  lamp.addChild(shade).addChild(stand).addChild(model).addChild(pad)
  scene.addChild(lamp)
  return { doc, lamp, ids }
}

const nameOf = (ids) => (id) => (id === ids.outside ? 'Front door' : null)
function copy(world, { trees = true } = {}) {
  const r = copyObject(world.lamp, { wsUrl: SRC_WS, world: WORLD_A }, { date: DAY, nameOf: nameOf(world.ids), trees })
  assert.equal(r.ok, true, r.reason)
  return r.snapshot
}
const paste = (snapshot, o = {}) => preparePaste(snapshot, {
  isFree: () => true, position: [5, 0, 7], destOrigin: DEST, destWorldId: 'world-b', destAddFields: 3, confirm: () => true, ...o,
})
const byName = (d) => Object.fromEntries(treeMembers(d).map((m) => [m.name, m]))

describe('T6: Copy of a group', () => {
  test('without trees (an older source server) a group is refused children, as before', () => {
    const r = copyObject(lampWorld().lamp, { wsUrl: SRC_WS, world: WORLD_A }, { date: DAY, trees: false })
    assert.equal(r.ok, false)
    assert.equal(r.reason, DUPLICATE_REASONS.children)
  })
  test('the snapshot holds the tree with its material ref, and the names of ids referred to outside it only', () => {
    const w = lampWorld()
    const s = copy(w)
    assert.deepEqual(treeMembers(s.descriptor).map((d) => d.name), ['lamp', 'shade', 'stand', 'model', 'pad'])
    assert.deepEqual(byName(s.descriptor).stand.mesh.primitives[0].material, { ref: 0 })
    assert.deepEqual(s.names, { [w.ids.outside]: 'Front door' }, 'the shade’s reference to the lamp isn’t foreign')
  })
  test('a group over the cap can’t be copied', () => {
    const doc = new Document()
    const scene = doc.createScene()
    const buf = doc.createBuffer()
    const big = doc.createNode('big')
    for (let i = 0; i < 3; i++) {
      const arr = new Float32Array(3 * 60000)
      big.addChild(doc.createNode(`p${i}`).setMesh(doc.createMesh().addPrimitive(doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(arr).setBuffer(buf)))))
    }
    scene.addChild(big)
    const r = copyObject(big, { wsUrl: SRC_WS, world: WORLD_A }, { date: DAY, trees: true })
    assert.equal(r.ok, false)
    assert.equal(r.rule, 'size')
  })
  test('the Inspect panel: "4 parts" (the members below the root) and one hidden', () => {
    const summary = partsSummary(lampWorld().lamp)
    assert.deepEqual(summary, { parts: 4, hidden: 1 })
    assert.deepEqual(partsLines(summary), ['4 parts', 'includes 1 hidden part'], 'T6\u2019s words')
    assert.deepEqual(partsLines({ parts: 0, hidden: 0 }), [], 'a single object: nothing')
    assert.deepEqual(partsLines({ parts: 2, hidden: 0 }), ['2 parts'], 'the lamp of §5’s DEV step 4')
    assert.equal(partsText(summary), ' (4 parts; includes 1 hidden part)', 'after the name')
    assert.equal(partsText({ parts: 1, hidden: 0 }), ' (1 part)')
    assert.equal(partsText({ parts: 0, hidden: 0 }), '', 'a single object: nothing after its name')
  })
  test('the Copy and Paste notes\u2019 summary (the fresh-agent code check\u2019s S-2): the snapshot\u2019s and the prepared paste\u2019s agree with the live node\u2019s', () => {
    const w = lampWorld()
    const s = copy(w)
    assert.deepEqual(descriptorPartsSummary(s.descriptor), partsSummary(w.lamp))
    w.lamp.setExtras({ ...w.lamp.getExtras(), __atrium_visible: false })
    const r = paste(copy(w))
    assert.deepEqual(r.parts, { parts: 4, hidden: 1 }, 'the root\u2019s marker is gone and isn\u2019t a part; the stand is still hidden')
    const one = lampWorld().lamp
    for (const child of one.listChildren()) one.removeChild(child)
    const solo = paste(copy({ ...w, lamp: one }))
    assert.deepEqual(solo.parts, { parts: 0, hidden: 0 })
  })
})

describe('T6: Paste of a group into another world', () => {
  test('every member a fresh id; member references follow the copies; a foreign one replaced and recorded on THAT member; every behaviour disabled', () => {
    const w = lampWorld()
    const r = paste(copy(w))
    assert.equal(r.ok, true, r.reason)
    assert.equal(checkAddNode(r.descriptor), null)
    const m = byName(r.descriptor)
    const id = (n) => m[n].extras.atrium.objectId
    const ids = ['lamp', 'shade', 'stand', 'model', 'pad'].map(id)
    assert.equal(new Set(ids).size, 5)
    assert.ok(!ids.includes(w.ids.lamp) && !ids.includes(w.ids.shade), 'no original id')
    const shadeB = m.shade.extras.atrium.behavior
    assert.equal(shadeB.template.params.target, id('lamp'), 'the shade still aims at the lamp: its copy')
    assert.equal(shadeB.enabled, false)
    assert.equal(m.shade.extras.atrium.copiedFrom.refs, undefined, 'nothing foreign on the shade')
    const lampB = m.lamp.extras.atrium.behavior
    assert.notEqual(lampB.template.params.target, w.ids.outside, 'the foreign id replaced')
    assert.deepEqual(m.lamp.extras.atrium.copiedFrom.refs, [{ id: lampB.template.params.target, was: w.ids.outside, name: 'Front door' }])
    for (const n of ['lamp', 'shade']) assert.equal(behaviorCheck(m[n].extras.atrium.behavior, { ownId: id(n) }).problem, null, n)
    assert.ok(r.notes.includes(NOTE_TEXT.disabled), 'the shade was enabled: said once')
  })

  test('the credit on every member; the hidden marker gone from the root only; Atrium keys whitelisted per member, named', () => {
    const w = lampWorld()
    w.lamp.setExtras({ ...w.lamp.getExtras(), __atrium_visible: false })
    const r = paste(copy(w))
    const m = byName(r.descriptor)
    for (const n of ['lamp', 'shade', 'stand', 'model', 'pad']) {
      assert.equal(m[n].extras.atrium.copiedFrom.server, 'https://a.example', `${n}: copiedFrom`)
      assert.equal(m[n].extras.atrium.copiedFrom.at, DAY)
      assert.ok(m[n].extras.atrium.origin, `${n}: origin`)
    }
    assert.equal(m.lamp.extras.atrium.origin.creatorName, 'alice')
    assert.equal(m.lamp.extras.__atrium_visible, undefined, 'the root is visible')
    assert.equal(m.stand.extras.__atrium_visible, false, 'the hidden part stays hidden')
    assert.equal(Object.hasOwn(m.stand.extras.atrium, 'planted'), false)
    assert.ok(r.notes.some((n) => n.includes('its part “stand”’s Atrium data “planted”')), r.notes.join(' | '))
  })

  test('URLs per member: the model part’s root path and the pad part’s path are resolved against the source; one question for its host', () => {
    const w = lampWorld()
    let asked = 0
    const r = paste(copy(w), { confirm: (q) => { asked += 1; assert.match(q, /a\.example/); return true } })
    assert.equal(r.ok, true, r.reason)
    const m = byName(r.descriptor)
    assert.equal(m.model.extras.atrium.model.url, 'https://a.example/assets/library/lamp.glb')
    assert.match(m.pad.extras.atrium.teleporter.destination, /^wss:\/\/a\.example\/worlds\/alice\/home/)
    assert.equal(asked, 1)
  })

  test('two model members on one host ask once; declined, nothing is prepared', () => {
    const w = lampWorld()
    const second = w.doc.createNode('model2').setExtras({ atrium: { model: { url: '/assets/library/shade.glb' } } })
    w.lamp.addChild(second)
    let asked = 0
    const r = paste(copy(w), { confirm: () => { asked += 1; return false } })
    assert.equal(asked, 1)
    assert.equal(r.ok, false)
    assert.equal(r.declined, true)
  })

  test('names: a member’s free name is kept; a taken one gets the next copy name', () => {
    const w = lampWorld()
    const taken = new Set(['shade'])
    const r = paste(copy(w), { isFree: (n) => !taken.has(n) })
    const names = treeMembers(r.descriptor).map((d) => d.name)
    assert.deepEqual(names, ['lamp', 'shade copy', 'stand', 'model', 'pad'])
  })

  test('the retry re-chooses the NAMES only: the position, the ids and the K8 answers stay', () => {
    const w = lampWorld()
    const s = copy(w)
    let asked = 0
    const first = paste(s, { confirm: () => { asked += 1; return true } })
    const originals = treeMembers(s.descriptor).map((d) => d.name)
    const taken = new Set(['lamp', 'stand'])
    const again = renamePaste(first.descriptor, { rootName: 'lamp copy', originals, isFree: (n) => !taken.has(n) })
    assert.deepEqual(treeMembers(again).map((d) => d.name), ['lamp copy', 'shade', 'stand copy', 'model', 'pad'])
    assert.deepEqual(again.translation, first.descriptor.translation)
    assert.deepEqual(treeMembers(again).map((d) => d.extras.atrium.objectId), treeMembers(first.descriptor).map((d) => d.extras.atrium.objectId))
    assert.equal(asked, 1, 'the question isn’t asked again')
    assert.equal(first.descriptor.name, 'lamp', 'the prepared descriptor is untouched')
  })

  test('a failed paste leaves the clipboard as it was', () => {
    const s = copy(lampWorld())
    const before = structuredClone(s)
    paste(s, { confirm: () => false })
    paste(s)
    assert.deepEqual(s, before)
  })
})

describe('T6: Paste of a group into the same world', () => {
  test('a Duplicate: the member map and nothing else, grants and enabled state kept, no credit changed', () => {
    const w = lampWorld()
    const s = copy(w)
    const r = paste(s, { destOrigin: 'https://a.example', destWorldId: WORLD_A.id, isFree: (n) => n.endsWith(' copy') })
    assert.equal(r.ok, true, r.reason)
    assert.equal(r.sameWorld, true)
    const m = byName(r.descriptor)
    assert.equal(m['shade copy'].extras.atrium.behavior.enabled, true, 'enabled kept')
    assert.equal(m['shade copy'].extras.atrium.behavior.template.params.target, m['lamp copy'].extras.atrium.objectId)
    assert.equal(m['lamp copy'].extras.atrium.behavior.template.params.target, w.ids.outside, 'a grant kept (F-L10)')
    assert.equal(m['lamp copy'].extras.atrium.copiedFrom, undefined)
  })
})

describe('T6/T7/T12: a destination below level 3', () => {
  test('takes no group', () => {
    const r = paste(copy(lampWorld()), { destAddFields: null })
    assert.equal(r.ok, false)
    assert.equal(r.reason, PASTE_TEXT.noTrees)
  })
  test('a single object with its own shared material, copied at level 3, arrives with every material inline and the note (S5)', () => {
    const doc = new Document()
    const scene = doc.createScene()
    const buf = doc.createBuffer()
    const mat = doc.createMaterial('Two')
    const prim = () => doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(TRI.slice()).setBuffer(buf)).setMaterial(mat)
    const solo = doc.createNode('solo').setMesh(doc.createMesh().addPrimitive(prim()).addPrimitive(prim()))
    scene.addChild(solo)
    const r0 = copyObject(solo, { wsUrl: SRC_WS, world: WORLD_A }, { date: DAY, trees: true })
    assert.deepEqual(r0.snapshot.descriptor.mesh.primitives[1].material, { ref: 0 })
    const old = paste(r0.snapshot, { destAddFields: null })
    assert.equal(old.ok, true, old.reason)
    assert.equal(old.descriptor.mesh.primitives[1].material.name, 'Two', 'the ref turned back into the material')
    assert.ok(old.notes.includes(NOTE_TEXT.ownMaterials))
    const cur = paste(r0.snapshot)
    assert.deepEqual(cur.descriptor.mesh.primitives[1].material, { ref: 0 }, 'a level-3 server keeps the ref')
  })
})
