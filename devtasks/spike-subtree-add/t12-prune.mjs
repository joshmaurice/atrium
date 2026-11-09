// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// T12 × T3: removing sharers one at a time; material and buffer lifetime; SOM wrapper maps
import path from 'node:path'
import { createRequire } from 'node:module'
// Ported 2026-11-07 from the pre-brief's fresh-agent check (/tmp/t11t12/probes):
// the real builder now, on the code checked out here. Run from the repo root:
//   node devtasks/spike-subtree-add/t12-prune.mjs
const R = process.cwd()
const req = createRequire(path.join(R, 'packages/som/package.json'))
const { NodeIO } = await import(req.resolve('@gltf-transform/core'))
const { buildDescriptor } = await import(path.join(R, 'apps/client/src/edit-duplicate.js'))
// the probe's stand-in's form: refs on by default
const buildTreeDescriptor = (node, name, offsetX, { refs = true } = {}) => buildDescriptor(node, name, offsetX, { refs })
const { createWorld, createWorldFromDocument } = await import(path.join(R, 'packages/server/src/world.js'))
const doc = await new NodeIO().read(path.join(R, 'tests/fixtures/atrium.gltf'))
const d = buildTreeDescriptor(doc.getRoot().listNodes().find((n) => n.getName() === 'Furniture'), 'Furniture', 0)
const world = await createWorld(path.join(R, 'tests/fixtures/space.gltf'))
const root = world.som._document.getRoot()
const counts = () => ({ buffers: root.listBuffers().length, materials: root.listMaterials().length, accessors: root.listAccessors().length, matMap: world.som._materialMap.size })
const before = counts()
world.addNode(structuredClone(d), null)
const dark = () => world.som.getNodeByName('Bench-SE-Seat')?._node.getMesh().listPrimitives()[0].getMaterial()
const darkMat = dark()
console.log('before', before, '\nafter add', counts())
for (const n of ['Bench-NE', 'Table-Center', 'Bench-SE', 'Bench-SW']) {
  world.removeNode(n)
  console.log(`removed ${n.padEnd(13)}`, counts(), 'DarkWood disposed?', darkMat.isDisposed(), 'users', darkMat.isDisposed() ? 0 : darkMat.listParents().filter((p) => p.propertyType === 'Primitive').length)
}
const w2 = await createWorldFromDocument(await world.serialize())
const nw = w2.som.getNodeByName('Bench-NW-Seat')._node.getMesh().listPrimitives()[0].getMaterial()
console.log('save+reload with one sharer left: Bench-NW-Seat material', nw.getName(), JSON.stringify(nw.getBaseColorFactor()))
world.removeNode('Bench-NW')
console.log('removed Bench-NW (last DarkWood user)', counts(), 'DarkWood disposed?', darkMat.isDisposed())
world.removeNode('Furniture')
console.log('removed Furniture', counts(), 'back to before?', JSON.stringify(counts()) === JSON.stringify(before))
