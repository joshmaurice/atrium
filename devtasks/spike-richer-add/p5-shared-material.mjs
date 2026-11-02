// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p5 — atrium.gltf's columns share one material. Does a colour edit on one
// (the `set` path, world.setField) change the others today? And after a
// delete + restore through `add` (what Undo does), is the restored column
// still sharing?
// Run from the repo root: node devtasks/spike-richer-add/p5-shared-material.mjs
import path from 'node:path'
const { createWorld } = await import(path.resolve('packages/server/src/world.js'))
const world = await createWorld(path.resolve('tests/fixtures/atrium.gltf'))
const col = (n) => world.som.getNodeByName(n)._node ?? world.som.getNodeByName(n)
const gltfNode = (n) => world.som._document.getRoot().listNodes().find((x) => x.getName() === n)
const mat = (n) => gltfNode(n).getMesh().listPrimitives()[0].getMaterial()
console.log(`Column-1 and Column-2 share a material: ${mat('Column-1') === mat('Column-2')} ("${mat('Column-1').getName()}", used by ${mat('Column-1').listParents().filter((p) => p.propertyType === 'Primitive').length} primitives)`)
const r = world.setField('Column-1', 'mesh.primitives[0].material.baseColorFactor', [1, 0, 0, 1])
console.log(`set Column-1 colour to red: ${JSON.stringify(r)}; Column-2 colour now ${JSON.stringify(mat('Column-2').getBaseColorFactor())}`)
