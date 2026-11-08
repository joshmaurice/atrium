// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add T3 and T12 (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2) —
// `ingestNode` keeps `children`, in message order (depth-first pre-order),
// makes ONE buffer per call, shares a `{ ref: n }` material, and is atomic: a
// ref it can't resolve throws before anything is created.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Document, WebIO } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const prim = (material) => (material === undefined ? { attributes: { POSITION: [...TRI] } } : { attributes: { POSITION: [...TRI] }, material })
const MAT = (name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } })

function fresh() {
  const doc = new Document()
  doc.createScene()
  return new SOMDocument(doc)
}
const gltfNode = (som, name) => som._document.getRoot().listNodes().find((n) => n.getName() === name)
const buffers = (som) => som._document.getRoot().listBuffers().length
const materialOf = (som, name, i = 0) => gltfNode(som, name).getMesh().listPrimitives()[i].getMaterial()
const shape = (n) => ({ name: n.getName(), children: n.listChildren().map(shape) })

describe('T3: ingestNode keeps children', () => {
  test('the tree, in order, each member under its parent, the root returned', () => {
    const som = fresh()
    const root = som.ingestNode({
      name: 'R', translation: [1, 2, 3],
      children: [
        { name: 'A', translation: [0, 1, 0], children: [{ name: 'A1', mesh: { primitives: [prim()] } }, { name: 'A2' }] },
        { name: 'B', scale: [2, 2, 2] },
      ],
    })
    assert.equal(root.name, 'R')
    assert.deepEqual(shape(root._node), {
      name: 'R', children: [{ name: 'A', children: [{ name: 'A1', children: [] }, { name: 'A2', children: [] }] }, { name: 'B', children: [] }],
    })
    assert.deepEqual([...gltfNode(som, 'A').getTranslation()], [0, 1, 0], 'local TRS kept')
    assert.deepEqual([...gltfNode(som, 'B').getScale()], [2, 2, 2])
    for (const name of ['R', 'A', 'A1', 'A2', 'B']) assert.ok(som.getNodeByName(name), `${name} is registered`)
    assert.equal(root._node.getParentNode(), null, 'the caller attaches the root; ingest doesn’t')
    assert.equal(som._document.getRoot().listScenes()[0].listChildren().length, 0, 'nor puts it in the scene')
  })

  test('ONE buffer for a tree of 64 mesh members', () => {
    const som = fresh()
    const before = buffers(som)
    som.ingestNode({ name: 'big', children: Array.from({ length: 64 }, (_, i) => ({ name: `m${i}`, mesh: { primitives: [prim()] } })) })
    assert.equal(buffers(som) - before, 1)
  })

  test('a meshless tree makes no buffer; the buffer is the first member’s accessor’s', () => {
    const som = fresh()
    som.ingestNode({ name: 'empty', children: [{ name: 'e1' }, { name: 'e2' }] })
    assert.equal(buffers(som), 0)
  })

  test('a node without children is today’s ingest (one node, one buffer, nothing else)', () => {
    const som = fresh()
    const node = som.ingestNode({ name: 'solo', mesh: { primitives: [prim(MAT('M')), prim()] } })
    assert.equal(node.children.length, 0)
    assert.equal(som._document.getRoot().listNodes().length, 1)
    assert.equal(buffers(som), 1)
    assert.equal(som._document.getRoot().listMaterials().length, 1)
  })

  test('removeSubtree of an ingested tree prunes its buffer and materials; a part removed alone keeps them', () => {
    const som = fresh()
    const root = som.ingestNode({
      name: 'G', children: [{ name: 'P', mesh: { primitives: [prim(MAT('X'))] } }, { name: 'Q', mesh: { primitives: [prim({ ref: 0 })] } }],
    })
    som.scene.addChild(root)
    som.getNodeByName('P').dispose()
    assert.equal(buffers(som), 1, 'Q still uses the buffer')
    assert.equal(som._document.getRoot().listMaterials().length, 1, 'and the shared material')
    assert.equal(som.getNodeByName('P'), null)
    som.getNodeByName('G').dispose()
    assert.equal(buffers(som), 0, 'the last user gone: pruned')
    assert.equal(som._document.getRoot().listMaterials().length, 0)
    assert.equal(som._document.getRoot().listAccessors().length, 0)
  })
})

describe('T12: shared materials within a message', () => {
  test('a ref reuses the n-th material of the call, numbered in message order', () => {
    const som = fresh()
    som.ingestNode({
      name: 'R',
      children: [
        { name: 'A', children: [{ name: 'A1', mesh: { primitives: [prim(MAT('Wood')), prim(MAT('Metal'))] } }] },
        { name: 'B', mesh: { primitives: [prim({ ref: 1 }), prim({ ref: 0 })] } },
      ],
    })
    // pre-order: R, A, A1 (Wood = 0, Metal = 1), B
    // identity, by `ok`: a failing `equal` on two glTF-Transform objects inspects the whole document graph
    assert.ok(materialOf(som, 'B', 0) === materialOf(som, 'A1', 1), `B’s ref 1 is A1’s Metal (B has ${materialOf(som, 'B', 0)?.getName()})`)
    assert.ok(materialOf(som, 'B', 1) === materialOf(som, 'A1', 0), `B’s ref 0 is A1’s Wood (B has ${materialOf(som, 'B', 1)?.getName()})`)
    assert.equal(som._document.getRoot().listMaterials().length, 2)
    const sharedSom = som.getNodeByName('B').mesh.primitives[0].material
    assert.equal(sharedSom, som.getNodeByName('A1').mesh.primitives[1].material, 'one SOMMaterial wrapper too')
  })

  test('a recolour through one sharer’s SOM material reaches every sharer', () => {
    const som = fresh()
    som.ingestNode({ name: 'cols', children: Array.from({ length: 5 }, (_, i) => ({ name: `c${i}`, mesh: { primitives: [prim(i === 0 ? MAT('Marble') : { ref: 0 })] } })) })
    som.getNodeByName('c3').mesh.primitives[0].material.baseColorFactor = [1, 0, 0, 1]
    for (let i = 0; i < 5; i++) assert.deepEqual([...materialOf(som, `c${i}`).getBaseColorFactor()], [1, 0, 0, 1])
  })

  test('a primitive with no material takes no number; material: {} takes one', () => {
    const som = fresh()
    som.ingestNode({ name: 'n', mesh: { primitives: [prim(), prim({}), prim(MAT('Two')), prim({ ref: 1 })] } })
    assert.equal(materialOf(som, 'n', 3).getName(), 'Two')
  })

  test('ATOMIC: a forward ref throws before anything is created, and every name stays free', () => {
    const som = fresh()
    const before = som._document.getRoot().listNodes().length
    assert.throws(() => som.ingestNode({
      name: 'R', children: [{ name: 'A', children: [{ name: 'A1', mesh: { primitives: [prim({ ref: 0 })] } }] }, { name: 'B', mesh: { primitives: [prim(MAT('M'))] } }],
    }), /material ref 0 names no material given earlier/)
    assert.equal(som._document.getRoot().listNodes().length, before, 'no node created')
    assert.equal(som._document.getRoot().listBuffers().length, 0, 'no buffer created')
    for (const name of ['R', 'A', 'A1', 'B']) assert.equal(som.checkNewName(name).ok, true, `${name} is still free`)
  })

  test('the reverse (a later branch referring to an earlier sibling’s subtree) is resolved: pre-order, not breadth-first', () => {
    const som = fresh()
    som.ingestNode({
      name: 'R', children: [{ name: 'A', children: [{ name: 'A1', mesh: { primitives: [prim(MAT('Deep'))] } }] }, { name: 'B', mesh: { primitives: [prim({ ref: 0 })] } }],
    })
    assert.ok(materialOf(som, 'B') === materialOf(som, 'A1'), `B shares A1’s material (B has ${materialOf(som, 'B')?.getName()})`)
  })

  test('a save keeps one shared material, and a reload gives every sharer the same one', async () => {
    const som = fresh()
    som.scene.addChild(som.ingestNode({ name: 'G', children: [{ name: 'P', mesh: { primitives: [prim(MAT('S'))] } }, { name: 'Q', mesh: { primitives: [prim({ ref: 0 })] } }] }))
    const io = new WebIO()
    const { json, resources } = await io.writeJSON(som._document)
    assert.equal(json.materials.length, 1)
    const back = await io.readJSON({ json, resources })
    const p = back.getRoot().listNodes().find((n) => n.getName() === 'P').getMesh().listPrimitives()[0].getMaterial()
    const q = back.getRoot().listNodes().find((n) => n.getName() === 'Q').getMesh().listPrimitives()[0].getMaterial()
    assert.equal(p, q)
  })
})
