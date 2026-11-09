// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// selection-parts §2.6 (subtree-add §9.5 M2) on today's code: a part re-added under its group comes back LAST
// (addChild appends), and buildDescriptor numbers refs in child order, so the
// group's capture differs although nothing about the group changed.
import { Document } from '../../packages/som/node_modules/@gltf-transform/core/dist/index.modern.js'
import { buildDescriptor } from '../../apps/client/src/edit-duplicate.js'
const doc = new Document()
const buf = doc.createBuffer()
const scene = doc.createScene()
const pos = () => doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0, 1,0,0, 0,1,0])).setBuffer(buf)
const red = doc.createMaterial('red').setBaseColorFactor([1,0,0,1])
const blue = doc.createMaterial('blue').setBaseColorFactor([0,0,1,1])
const part = (name, mat) => doc.createNode(name).setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos()).setMaterial(mat)))
const g = doc.createNode('G')
const a = part('a', red), b = part('b', blue), c = part('c', red)
g.addChild(a).addChild(b).addChild(c)
scene.addChild(g)
const before = buildDescriptor(g, 'G', 0, { refs: true })
const show = (d) => d.children.map((m) => `${m.name}:${JSON.stringify(m.mesh.primitives[0].material.ref ?? 'inline')}`).join(' ')
console.log('before          ', show(before))
// delete and restore `a` (what T11's part Undo does): remove, then append under G
g.removeChild(a); g.addChild(a)
const after = buildDescriptor(g, 'G', 0, { refs: true })
console.log('after a restored', show(after))
console.log('same JSON?', JSON.stringify(before) === JSON.stringify(after))
