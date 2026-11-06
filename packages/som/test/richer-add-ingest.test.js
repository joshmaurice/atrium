// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// richer-add R4 (devtasks/PREBRIEF-richer-add.md) — `ingestNode` keeps every
// field the widened `add` rule accepts, and makes one buffer per call.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '../src/SOMDocument.js'

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const UV = [0, 0, 1, 0, 0, 1]

function fresh() {
  const doc = new Document()
  doc.createScene()
  return new SOMDocument(doc)
}
const gltfNode = (som, name) => som._document.getRoot().listNodes().find((n) => n.getName() === name)
const buffers = (som) => som._document.getRoot().listBuffers().length

describe('richer-add R4: ingestNode keeps the new fields', () => {
  test('mesh and primitive extras, UVs, COLOR_0 and every material field', () => {
    const som = fresh()
    som.ingestNode({
      name: 'rich',
      mesh: {
        name: 'm', extras: { lod: 0 },
        primitives: [{
          attributes: { POSITION: TRI, NORMAL: [0, 0, 1, 0, 0, 1, 0, 0, 1], TEXCOORD_0: UV, TEXCOORD_1: [1, 1, 0, 1, 1, 0], COLOR_0: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
          indices: [0, 1, 2],
          extras: { tag: 'p' },
          material: {
            name: 'Marble', extras: { note: 'x' },
            pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1], metallicFactor: 0, roughnessFactor: 0.8 },
            emissiveFactor: [1, 0.5, 0], alphaMode: 'MASK', alphaCutoff: 0.3, doubleSided: true,
          },
        }],
      },
    })
    const mesh = gltfNode(som, 'rich').getMesh()
    assert.deepEqual(mesh.getExtras(), { lod: 0 })
    const prim = mesh.listPrimitives()[0]
    assert.deepEqual(prim.getExtras(), { tag: 'p' })
    assert.deepEqual(prim.listSemantics().slice().sort(), ['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0', 'TEXCOORD_1'])
    for (const [semantic, type, values] of [['TEXCOORD_0', 'VEC2', UV], ['TEXCOORD_1', 'VEC2', [1, 1, 0, 1, 1, 0]], ['COLOR_0', 'VEC3', [1, 0, 0, 0, 1, 0, 0, 0, 1]]]) {
      const acc = prim.getAttribute(semantic)
      assert.equal(acc.getType(), type, semantic)
      assert.equal(acc.getComponentType(), 5126, `${semantic} is FLOAT`)
      assert.equal(acc.getNormalized(), false)
      assert.deepEqual([...acc.getArray()], values)
    }
    const mat = prim.getMaterial()
    assert.equal(mat.getName(), 'Marble')
    assert.deepEqual(mat.getExtras(), { note: 'x' })
    assert.deepEqual(mat.getEmissiveFactor(), [1, 0.5, 0])
    assert.equal(mat.getAlphaMode(), 'MASK')
    assert.equal(mat.getAlphaCutoff(), 0.3)
    assert.equal(mat.getDoubleSided(), true)
    assert.equal(mat.getRoughnessFactor(), 0.8)
  })

  test('COLOR_0 of 4 values per vertex is VEC4', () => {
    const som = fresh()
    som.ingestNode({ name: 'c4', mesh: { primitives: [{ attributes: { POSITION: TRI, COLOR_0: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.5] } }] } })
    const acc = gltfNode(som, 'c4').getMesh().listPrimitives()[0].getAttribute('COLOR_0')
    assert.equal(acc.getType(), 'VEC4')
    assert.equal(acc.getCount(), 3)
  })

  test('an absent field keeps glTF-Transform’s default, as before', () => {
    const som = fresh()
    som.ingestNode({ name: 'plain', mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } } }] } })
    const prim = gltfNode(som, 'plain').getMesh().listPrimitives()[0]
    const mat = prim.getMaterial()
    assert.equal(mat.getName(), '')
    assert.deepEqual(mat.getExtras(), {})
    assert.deepEqual(mat.getEmissiveFactor(), [0, 0, 0])
    assert.equal(mat.getAlphaMode(), 'OPAQUE')
    assert.equal(mat.getAlphaCutoff(), 0.5)
    assert.equal(mat.getDoubleSided(), false)
    assert.deepEqual(prim.getExtras(), {})
    assert.deepEqual(gltfNode(som, 'plain').getMesh().getExtras(), {})
  })
})

describe('richer-add R4: one buffer per ingestNode call (CR-M2)', () => {
  test('a 64-primitive call adds exactly one buffer, shared by every accessor', () => {
    const som = fresh()
    const before = buffers(som)
    const primitives = Array.from({ length: 64 }, () => ({ attributes: { POSITION: TRI, NORMAL: TRI }, indices: [0, 1, 2] }))
    som.ingestNode({ name: 'many', mesh: { primitives } })
    assert.equal(buffers(som) - before, 1)
    const accs = gltfNode(som, 'many').getMesh().listPrimitives().flatMap((p) => [...p.listAttributes(), p.getIndices()])
    assert.equal(new Set(accs.map((a) => a.getBuffer())).size, 1)
  })

  test('two calls make two buffers', () => {
    const som = fresh()
    const before = buffers(som)
    som.ingestNode({ name: 'a', mesh: { primitives: [{ attributes: { POSITION: TRI } }] } })
    som.ingestNode({ name: 'b', mesh: { primitives: [{ attributes: { POSITION: TRI } }] } })
    assert.equal(buffers(som) - before, 2)
  })

  test('a node with no mesh creates no buffer', () => {
    const som = fresh()
    const before = buffers(som)
    som.ingestNode({ name: 'empty' })
    assert.equal(buffers(som), before)
  })

  test('removing the node prunes its buffer', () => {
    const som = fresh()
    const before = buffers(som)
    const node = som.ingestNode({ name: 'gone', mesh: { primitives: [{ attributes: { POSITION: TRI } }, { attributes: { POSITION: TRI } }] } })
    assert.equal(buffers(som) - before, 1)
    som.removeSubtree(node)
    assert.equal(buffers(som), before)
  })
})
