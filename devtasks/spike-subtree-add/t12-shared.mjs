// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// T5/T12: hasSharedMaterial narrowed to sharing a restore loses
import path from 'node:path'
import { createRequire } from 'node:module'
// Ported 2026-11-07 from the pre-brief's fresh-agent check (/tmp/t11t12/probes):
// its sketch (`sketch`) printed beside the real `hasSharedMaterial` (`real`), on
// the code checked out here. Run from the repo root:
//   node devtasks/spike-subtree-add/t12-shared.mjs
const R = process.cwd()
const { hasSharedMaterial } = await import(path.join(R, 'apps/client/src/edit-duplicate.js'))
const req = createRequire(path.join(R, 'packages/som/package.json'))
const { NodeIO, Document } = await import(req.resolve('@gltf-transform/core'))
const nodeUsers = (m) => (m.listParents?.() ?? []).filter((p) => p.propertyType === 'Node')
function sketchLosesSharing(root) {
  const members = new Set(); const w = (n) => { members.add(n); n.listChildren().forEach(w) }; w(root)
  for (const n of members) {
    const mesh = n.getMesh(); if (!mesh) continue
    if (nodeUsers(mesh).length > 1) return `mesh of ${n.getName()}`
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial(); if (!mat) continue
      for (const p of mat.listParents()) {
        if (p.propertyType !== 'Primitive' || p === prim) continue
        for (const m of p.listParents().filter((x) => x.propertyType === 'Mesh')) {
          const users = nodeUsers(m)
          if (users.length > 0 && users.some((u) => !members.has(u))) return `${n.getName()}'s ${mat.getName()} also on ${users.find((u) => !members.has(u)).getName()}`
        }
      }
    }
  }
  return false
}
const treeLosesSharing = (n) => `sketch ${String(sketchLosesSharing(n)).padEnd(46)} real ${hasSharedMaterial(n, { trees: true })}`
const doc = await new NodeIO().read(path.join(R, 'tests/fixtures/atrium.gltf'))
const by = (n) => doc.getRoot().listNodes().find((x) => x.getName() === n)
for (const n of ['Columns', 'Furniture', 'Walls', 'Fountain', 'FloorAccent', 'Floor', 'Bench-NE', 'Column-1', 'Table-Center']) console.log(n.padEnd(12), treeLosesSharing(by(n)))
// a group sharing only internally
const d2 = new Document(); const b = d2.createBuffer(); const sc = d2.createScene()
const acc = () => d2.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0,1,0,0,0,1,0])).setBuffer(b)
const m = d2.createMaterial('Shared')
const G = d2.createNode('G'); sc.addChild(G)
for (const k of ['A', 'B']) G.addChild(d2.createNode(k).setMesh(d2.createMesh().addPrimitive(d2.createPrimitive().setAttribute('POSITION', acc()).setMaterial(m))))
console.log('internal-only G'.padEnd(12), treeLosesSharing(G), '| part A alone', treeLosesSharing(d2.getRoot().listNodes().find(n=>n.getName()==='A')))
// a detached (out-of-scene) node holding a mesh that uses the material: counts as "outside"?
const orphanNode = d2.createNode('Detached').setMesh(d2.createMesh().addPrimitive(d2.createPrimitive().setAttribute('POSITION', acc()).setMaterial(m)))
console.log('G with a detached node using its material', treeLosesSharing(G), '(Detached is in no scene:', orphanNode.listParents().map(p=>p.propertyType).join(','), ')')
