// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add T5 and T12 (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2, §5):
// Duplicate's rules, builder, copy and restore for TREES, pure, on real
// glTF-Transform nodes from the fixtures and on trees built here. `trees`
// stands for a server at add level 3 (`client.serverAddFields >= 3`).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import {
  duplicateRuleProblem, buildDescriptor, prepareDuplicate, prepareRestore, hasSharedMaterial,
  subtreeMembers, DUPLICATE_REASONS, DUPLICATE_OFFSET_X,
} from '../src/edit-duplicate.js'
import { checkAddNode } from '../../../packages/client/src/add-spec.js'
import { behaviorCheck } from '../../../packages/behaviors/src/behavior-spec.js'
import { templateGraph } from '../../../packages/behaviors/src/templates.js'
import { matchesTemplate } from '../src/behavior-form.js'

const { NodeIO, WebIO, Document } = await import('../../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
const { SOMDocument } = await import('../../../packages/som/src/SOMDocument.js')
const fixture = (name) => fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url))

async function load(name) {
  const doc = await new NodeIO().read(fixture(name))
  return { doc, som: new SOMDocument(doc) }
}
const nodeIn = (doc, name) => doc.getRoot().listNodes().find((n) => n.getName() === name)
const topLevel = (doc) => doc.getRoot().getDefaultScene().listChildren()

/** A descriptor through the REAL ingestNode, attached to a fresh world's scene. */
function ingest(descriptor) {
  const doc = new Document()
  doc.createScene()
  const som = new SOMDocument(doc)
  som.scene.addChild(som.ingestNode(descriptor))
  return { doc, som, node: nodeIn(doc, descriptor.name) }
}
async function saveAndReload(doc) {
  const io = new WebIO()
  const { json, resources } = await io.writeJSON(doc)
  return io.readJSON({ json, resources })
}
/** Every material of a descriptor tree, as inline (object) or { ref }, in message order. */
function materialsOf(d) {
  const out = []
  const stack = [d]
  while (stack.length > 0) {
    const m = stack.pop()
    for (const p of m.mesh?.primitives ?? []) if (p.material) out.push({ member: m.name, material: p.material })
    for (let i = (m.children?.length ?? 0) - 1; i >= 0; i--) stack.push(m.children[i])
  }
  return out
}

const PASSING = {
  'atrium.gltf': ['Walls', 'Columns', 'Furniture', 'Fountain'],
  'lamp.gltf': ['Lamp'],
  'space.gltf': ['lamp-01'],
}

describe('T5: the rules on fixture groups', () => {
  for (const [file, names] of Object.entries(PASSING)) {
    for (const name of names) {
      test(`${file} ${name} passes with trees, and is refused 'children' without`, async () => {
        const { doc } = await load(file)
        const node = nodeIn(doc, name)
        assert.equal(duplicateRuleProblem(node, { trees: true }), null)
        assert.equal(duplicateRuleProblem(node)?.rule, 'children', 'an older server: as before the round')
      })
    }
  }
  test('space-cameras: NestedCameraMount is refused for its camera part, named; AnimatedCameraMount for its own animation', async () => {
    const { doc } = await load('space-cameras.gltf')
    const nested = duplicateRuleProblem(nodeIn(doc, 'NestedCameraMount'), { trees: true })
    assert.equal(nested.rule, 'attached')
    assert.match(nested.reason, /\(in “NestedCamera”\)$/)
    const animated = duplicateRuleProblem(nodeIn(doc, 'AnimatedCameraMount'), { trees: true })
    assert.equal(animated.rule, 'referenced')
    assert.doesNotMatch(animated.reason, /\(in /, 'the root’s own refusal names no part')
  })
  test('a part is still refused parent (parts are the selection round’s, SA-L7 (c))', async () => {
    const { doc } = await load('space.gltf')
    assert.equal(duplicateRuleProblem(nodeIn(doc, 'lamp-shade'), { trees: true })?.rule, 'parent')
  })
  test('the tree bounds: 257 members, a chain of 9, 1,025 primitives are refused tree; 256 and a chain of 8 pass', () => {
    const doc = new Document()
    const scene = doc.createScene()
    const wide = (n) => { const r = doc.createNode(`w${n}`); for (let i = 1; i < n; i++) r.addChild(doc.createNode(`w${n}-${i}`)); scene.addChild(r); return r }
    assert.equal(duplicateRuleProblem(wide(256), { trees: true }), null)
    assert.equal(duplicateRuleProblem(wide(257), { trees: true })?.rule, 'tree')
    const chain = (depth) => { const r = doc.createNode(`c${depth}`); let at = r; for (let g = 1; g <= depth; g++) { const k = doc.createNode(`c${depth}-${g}`); at.addChild(k); at = k } scene.addChild(r); return r }
    assert.equal(duplicateRuleProblem(chain(8), { trees: true }), null)
    assert.equal(duplicateRuleProblem(chain(9), { trees: true })?.rule, 'tree')
    const buf = doc.createBuffer()
    const prim = () => doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf))
    const dense = doc.createNode('dense')
    for (let i = 0; i < 17; i++) {
      const mesh = doc.createMesh()
      for (let j = 0; j < (i < 16 ? 64 : 1); j++) mesh.addPrimitive(prim())
      dense.addChild(doc.createNode(`d${i}`).setMesh(mesh))
    }
    scene.addChild(dense)
    assert.equal(duplicateRuleProblem(dense, { trees: true })?.rule, 'tree', '1,025 primitives')
  })
  test('two parts named alike are refused names', () => {
    const doc = new Document()
    const scene = doc.createScene()
    const g = doc.createNode('g')
    g.addChild(doc.createNode('leg')).addChild(doc.createNode('leg'))
    scene.addChild(g)
    assert.equal(duplicateRuleProblem(g, { trees: true })?.rule, 'names')
    assert.equal(DUPLICATE_REASONS.names, 'Its parts don’t all have distinct names')
  })
})

describe('T5/T12: the fixed point for trees (canonical descriptors, ChatGPT review N2)', () => {
  for (const [file, names] of Object.entries(PASSING)) {
    for (const name of names) {
      test(`${file} ${name}: prepareRestore(ingest(d)) is d, live and after a save and a reload`, async () => {
        const { doc } = await load(file)
        const d = prepareRestore(nodeIn(doc, name), { trees: true })
        assert.equal(d.ok, true, d.reason)
        assert.equal(checkAddNode(d.descriptor), null, 'the server would accept it')
        const live = ingest(d.descriptor)
        assert.deepEqual(prepareRestore(live.node, { trees: true }).descriptor, d.descriptor, 'live')
        const back = await saveAndReload(live.doc)
        assert.deepEqual(prepareRestore(nodeIn(back, name), { trees: true }).descriptor, d.descriptor, 'after a reload')
      })
    }
  }
  test('a group with a hidden part (PROD has one): Duplicate and Undo keep the part hidden', async () => {
    const { doc, som } = await load('space.gltf')
    som.getNodeByName('lamp-shade').visible = false
    const d = prepareRestore(nodeIn(doc, 'lamp-01'), { trees: true }).descriptor
    const shade = d.children.find((c) => c.name === 'lamp-shade')
    assert.equal(shade.extras.__atrium_visible, false)
    const copy = prepareDuplicate(nodeIn(doc, 'lamp-01'), { name: 'lamp-01 copy', isFree: (n) => som.checkNewName(n).ok, trees: true })
    assert.equal(copy.descriptor.children.find((c) => c.name === 'lamp-shade copy').extras.__atrium_visible, false)
    const live = ingest(d)
    assert.deepEqual(prepareRestore(live.node, { trees: true }).descriptor, d)
  })
})

describe('T5: Duplicate of a tree', () => {
  test('lamp-01 in space.gltf: lamp-01 copy with lamp-shade copy and lamp-stand copy, fresh ids, the root 1.5 along x, parts’ local TRS kept', async () => {
    const { doc, som } = await load('space.gltf')
    const lamp = nodeIn(doc, 'lamp-01')
    const r = prepareDuplicate(lamp, { name: 'lamp-01 copy', isFree: (n) => som.checkNewName(n).ok, trees: true })
    assert.equal(r.ok, true, r.reason)
    const d = r.descriptor
    assert.equal(d.name, 'lamp-01 copy')
    assert.deepEqual(d.children.map((c) => c.name).sort(), ['lamp-shade copy', 'lamp-stand copy'])
    assert.equal(d.translation[0], lamp.getTranslation()[0] + DUPLICATE_OFFSET_X)
    for (const c of d.children) {
      const original = nodeIn(doc, c.name.replace(' copy', ''))
      assert.deepEqual(c.translation, [...original.getTranslation()], `${c.name} keeps its local translation`)
    }
    const ids = [d, ...d.children].map((m) => m.extras?.atrium?.objectId)
    assert.ok(ids.every((id) => typeof id === 'string'), 'every member has an id')
    assert.equal(new Set(ids).size, ids.length, 'all distinct')
    assert.equal(checkAddNode(d), null)
  })
  test('a member whose name is free in the world keeps it (only in another world, in practice: tested through Paste too)', async () => {
    const { doc } = await load('space.gltf')
    const r = prepareDuplicate(nodeIn(doc, 'lamp-01'), { name: 'lamp-02', isFree: () => true, trees: true })
    assert.deepEqual(r.descriptor.children.map((c) => c.name).sort(), ['lamp-shade', 'lamp-stand'])
  })
  test('the behaviour map: references between members follow the copies; an id outside the tree is kept', () => {
    const doc = new Document()
    const scene = doc.createScene()
    const [g, c, dd, outside] = ['g', 'c', 'd', 'o'].map(() => crypto.randomUUID())
    const leaf = (own, target) => templateGraph('select-visibility', { target, action: 'toggle' }, { ownId: own })
    const G = doc.createNode('G').setExtras({ atrium: { objectId: g, behavior: leaf(g, c) } })
    const C = doc.createNode('C').setExtras({ atrium: { objectId: c, behavior: leaf(c, g) } })
    const D = doc.createNode('D').setExtras({ atrium: { objectId: dd, behavior: leaf(dd, outside) } })
    G.addChild(C).addChild(D)
    scene.addChild(G)
    const r = prepareDuplicate(G, { name: 'G copy', isFree: (n) => !['G', 'C', 'D'].includes(n), trees: true })
    assert.equal(r.ok, true, r.reason)
    const byName = Object.fromEntries([r.descriptor, ...r.descriptor.children].map((m) => [m.name, m]))
    const idOf = (n) => byName[n].extras.atrium.objectId
    const beh = (n) => byName[n].extras.atrium.behavior
    assert.equal(beh('G copy').template.params.target, idOf('C copy'), 'G’s target is C’s copy')
    assert.equal(beh('C copy').template.params.target, idOf('G copy'), 'C’s target is G’s copy')
    assert.equal(beh('D copy').template.params.target, outside, 'an id outside the tree is kept (a grant, F-L10)')
    for (const n of ['G copy', 'C copy', 'D copy']) {
      assert.equal(behaviorCheck(beh(n), { ownId: idOf(n) }).problem, null, `${n} passes behaviorCheck`)
      assert.equal(matchesTemplate(beh(n), idOf(n)), true, `${n} still matches its template`)
    }
  })
})

describe('T12: shared materials within a message', () => {
  test('Furniture: DarkWood and LightWood inline once each, every later use a ref; ingest gives each one Material; a recolour reaches every sharer', async () => {
    const { doc } = await load('atrium.gltf')
    const d = buildDescriptor(nodeIn(doc, 'Furniture'), 'Furniture', 0, { refs: true })
    const mats = materialsOf(d)
    const wood = mats.filter((m) => m.member.endsWith('-Top') && m.member.startsWith('Table') || m.member.endsWith('-Seat'))
    assert.equal(wood.length, 5)
    assert.equal(wood.filter((m) => !('ref' in m.material)).length, 1, 'DarkWood inline once')
    assert.equal(new Set(wood.filter((m) => 'ref' in m.material).map((m) => m.material.ref)).size, 1, 'the other four one ref')
    const bodies = mats.filter((m) => m.member.endsWith('-Body'))
    assert.equal(bodies.filter((m) => !('ref' in m.material)).length, 1, 'LightWood inline once')
    assert.equal(checkAddNode(d), null)
    const live = ingest(d)
    const seatMats = new Set(['Table-Center-Top', 'Bench-NE-Seat', 'Bench-SE-Seat', 'Bench-SW-Seat', 'Bench-NW-Seat']
      .map((n) => nodeIn(live.doc, n).getMesh().listPrimitives()[0].getMaterial()))
    assert.equal(seatMats.size, 1, 'one material for the five')
    live.som.getNodeByName('Bench-SW-Seat').mesh.primitives[0].material.baseColorFactor = [1, 0, 0, 1]
    assert.deepEqual([...nodeIn(live.doc, 'Table-Center-Top').getMesh().listPrimitives()[0].getMaterial().getBaseColorFactor()], [1, 0, 0, 1])
  })
  test('Duplicate of Columns: the eight copies share one NEW material, not the original’s', async () => {
    const { doc, som } = await load('atrium.gltf')
    const r = prepareDuplicate(nodeIn(doc, 'Columns'), { name: 'Columns copy', isFree: (n) => som.checkNewName(n).ok, trees: true })
    assert.equal(r.ok, true, r.reason)
    const live = ingest(r.descriptor)
    const copies = r.descriptor.children.map((c) => nodeIn(live.doc, c.name).getMesh().listPrimitives()[0].getMaterial())
    assert.equal(new Set(copies).size, 1, 'one material for the eight copies')
    assert.ok(copies[0] !== nodeIn(doc, 'Column-1').getMesh().listPrimitives()[0].getMaterial(), 'not the original’s') // `ok`: a failing `notEqual` would inspect the document graph
  })
  test('without refs (an older server) every material is inline', async () => {
    const { doc } = await load('atrium.gltf')
    const d = buildDescriptor(nodeIn(doc, 'Furniture'), 'Furniture', 0)
    assert.equal(materialsOf(d).some((m) => 'ref' in m.material), false)
  })
  test('the Undo note: Columns (its marble is also the fountain pillar’s) yes; a group sharing only within itself, no; without trees, yes', async () => {
    const { doc } = await load('atrium.gltf')
    assert.equal(hasSharedMaterial(nodeIn(doc, 'Columns'), { trees: true }), true)
    const inner = new Document()
    const scene = inner.createScene()
    const buf = inner.createBuffer()
    const mat = inner.createMaterial('Only')
    const part = (n) => inner.createNode(n).setMesh(inner.createMesh().addPrimitive(inner.createPrimitive()
      .setAttribute('POSITION', inner.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf)).setMaterial(mat)))
    const g = inner.createNode('g').addChild(part('a')).addChild(part('b'))
    scene.addChild(g)
    assert.equal(hasSharedMaterial(g, { trees: true }), false, 'the restore keeps it: no note')
    assert.equal(prepareRestore(g, { trees: true }).sharedMaterial, undefined)
    // S4 — below level 3 a group can't be restored at all (children); the case
    // is a single object whose own primitives share a material: with refs its
    // restore keeps the sharing (no note), without them it loses it (the note).
    const own = inner.createMaterial('Own')
    const solo = inner.createNode('solo').setMesh(inner.createMesh()
      .addPrimitive(inner.createPrimitive().setAttribute('POSITION', inner.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf)).setMaterial(own))
      .addPrimitive(inner.createPrimitive().setAttribute('POSITION', inner.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf)).setMaterial(own)))
    scene.addChild(solo)
    assert.equal(hasSharedMaterial(solo, { trees: true }), false, 'level 3: the ref keeps it')
    assert.equal(hasSharedMaterial(solo), true, 'below level 3 the restore loses it: the note (S4)')
    assert.deepEqual(prepareRestore(solo, { trees: true }).descriptor.mesh.primitives[1].material, { ref: 0 }, 'a single object carries a ref (T10\'s stated exception)')
    assert.equal('ref' in prepareRestore(solo).descriptor.mesh.primitives[1].material, false, 'and none below level 3')
  })
  test('pre-order numbering matches checkAddNode and ingestNode on a two-branch tree', () => {
    const doc = new Document()
    const scene = doc.createScene()
    const buf = doc.createBuffer()
    const mat = doc.createMaterial('Deep')
    const meshWith = (m) => doc.createMesh().addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf)).setMaterial(m))
    const R = doc.createNode('R')
    const A = doc.createNode('A').addChild(doc.createNode('A1').setMesh(meshWith(mat)))
    const B = doc.createNode('B').setMesh(meshWith(mat))
    R.addChild(A).addChild(B)
    scene.addChild(R)
    assert.deepEqual(subtreeMembers(R).map((m) => m.node.getName()), ['R', 'A', 'A1', 'B'])
    const d = buildDescriptor(R, 'R', 0, { refs: true })
    assert.equal('ref' in d.children[0].children[0].mesh.primitives[0].material, false, 'A1 gives material 0')
    assert.deepEqual(d.children[1].mesh.primitives[0].material, { ref: 0 }, 'B refers back to it')
    assert.equal(checkAddNode(d), null, 'the rule agrees')
    const live = ingest(d)
    // identity by `ok`: a failing `equal` on two glTF-Transform objects inspects the whole document graph
    assert.ok(nodeIn(live.doc, 'B').getMesh().listPrimitives()[0].getMaterial() === nodeIn(live.doc, 'A1').getMesh().listPrimitives()[0].getMaterial(), 'and the ingest')
  })
})

describe('T1/S2: the byte bounds (the fresh-agent code check’s S-1: §5’s client half)', () => {
  test('a legal two-node tree of 1,000,240 bytes or more, which the server accepts, is refused by prepareDuplicate (size), and by prepareRestore', () => {
    // the server test's tree (subtree-add.test.js, "S2: the server's bound"),
    // unindexed so each vertex count is a multiple of 3: steps of 900 numbers
    const big = (name, n) => ({ name, mesh: { primitives: [{ attributes: { POSITION: Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 0.5 : 0)) } }] } })
    let n = 3 * 30000
    let tree
    const size = () => Buffer.byteLength(JSON.stringify({ type: 'add', seq: 1, node: tree }))
    do { tree = { name: 'big-root', children: [big('big-a', n), big('big-b', n)] }; n += 900 } while (size() < 1000240)
    assert.ok(size() > 1000000 && size() < 1048576, `the server test's range: ${size()} bytes`)
    assert.equal(checkAddNode(tree), null, 'legal')
    const live = ingest(tree)
    const root = nodeIn(live.doc, 'big-root')
    const d = prepareDuplicate(root, { name: 'big-root copy', trees: true })
    assert.equal(d.ok, false)
    assert.equal(d.rule, 'size')
    assert.match(d.reason, /too large to duplicate .*the limit is 1,000,000/)
    // the restore is an add this client sends, so the same margin (N3's rules, unchanged): Delete asks first
    const r = prepareRestore(root, { trees: true })
    assert.equal(r.ok, false)
    assert.equal(r.rule, 'size')
  })
})
