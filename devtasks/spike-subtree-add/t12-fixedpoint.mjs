// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// T12: refs in message order; Furniture fixed point live and after save+reload; order shift vs set-keyed compare
import path from 'node:path'
import { createRequire } from 'node:module'
// Ported 2026-11-07 from the pre-brief's fresh-agent check (/tmp/t11t12/probes):
// the real builder now, on the code checked out here. Run from the repo root:
//   node devtasks/spike-subtree-add/t12-fixedpoint.mjs
const R = process.cwd()
const req = createRequire(path.join(R, 'packages/som/package.json'))
const { NodeIO } = await import(req.resolve('@gltf-transform/core'))
const { buildDescriptor } = await import(path.join(R, 'apps/client/src/edit-duplicate.js'))
// the probe's stand-in's form: refs on by default
const buildTreeDescriptor = (node, name, offsetX, { refs = true } = {}) => buildDescriptor(node, name, offsetX, { refs })
const { createWorld, createWorldFromDocument } = await import(path.join(R, 'packages/server/src/world.js'))
function sameDescriptor(a, b, setChildren = false) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) { if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!sameDescriptor(a[i], b[i], setChildren)) return false; return true }
  const ka = Object.keys(a), kb = Object.keys(b); if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false
    if (setChildren && k === 'children') {
      const byName = new Map(b.children.map((c) => [c.name, c]))
      if (a.children.length !== b.children.length) return false
      for (const c of a.children) if (!byName.has(c.name) || !sameDescriptor(c, byName.get(c.name), true)) return false
      continue
    }
    if (!sameDescriptor(a[k], b[k], setChildren)) return false
  }
  return true
}
const diffs = (a, b, p = '', out = []) => { if (sameDescriptor(a, b)) return out; if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) { out.push(`${p}: ${JSON.stringify(a)?.slice(0, 60)} -> ${JSON.stringify(b)?.slice(0, 60)}`); return out }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[k], b[k], p + '.' + k, out); return out }
const io = new NodeIO()
const doc = await io.read(path.join(R, 'tests/fixtures/atrium.gltf'))
const src = doc.getRoot().listNodes().find((n) => n.getName() === 'Furniture')
const d = buildTreeDescriptor(src, 'Furniture', 0)
const inline = [], refs = []
const walk = (n, p) => { for (const [i, pr] of (n.mesh?.primitives ?? []).entries()) (pr.material && 'ref' in pr.material ? refs : inline).push(`${n.name}:${pr.material?.name ?? JSON.stringify(pr.material)}`); for (const c of n.children ?? []) walk(c) }
walk(d)
console.log('inline materials (numbered in order):', inline.length, inline.join(', '))
console.log('refs:', refs.length)
const json = JSON.stringify(d)
console.log('bytes with refs', json.length, 'without', JSON.stringify(buildTreeDescriptor(src, 'Furniture', 0, { refs: false })).length)

const world = await createWorld(path.join(R, 'tests/fixtures/space.gltf'))
const r = world.addNode(structuredClone(d), null)
console.log('addNode', r.ok)
const g = () => world.som.getNodeByName('Furniture')._node
const mats = (root) => { const s = new Set(); const w = (n) => { for (const p of n.getMesh()?.listPrimitives() ?? []) s.add(p.getMaterial()); n.listChildren().forEach(w) }; w(root); return s }
console.log('live distinct materials in Furniture:', mats(g()).size, '(source:', mats(src).size + ')')
console.log('live fixed point:', sameDescriptor(d, buildTreeDescriptor(g(), 'Furniture', 0)))
const buffersBefore = world.som._document.getRoot().listBuffers().length
const ser = await world.serialize()
const w2 = await createWorldFromDocument(ser)
const g2 = w2.som.getNodeByName('Furniture')._node
console.log('reloaded distinct materials:', mats(g2).size, 'reload fixed point:', sameDescriptor(d, buildTreeDescriptor(g2, 'Furniture', 0)))

// recolour one seat via the SOM path the server uses for `send`
const set = world.setField('Bench-NE-Seat', 'mesh.primitives[0].material.baseColorFactor', [1, 0, 0, 1])
const seat = (n) => world.som.getNodeByName(n)._node.getMesh().listPrimitives()[0].getMaterial().getBaseColorFactor()
console.log('send to Bench-NE-Seat', JSON.stringify(set), '-> Table-Center-Top colour', JSON.stringify(seat('Table-Center-Top')))
world.setField('Bench-NE-Seat', 'mesh.primitives[0].material.baseColorFactor', d.children[0].children[0].mesh.primitives[0].material.pbrMetallicRoughness.baseColorFactor)

// T11 × T12: delete Table-Center (a part) and restore it under Furniture, appended last
const before = buildTreeDescriptor(g(), 'Furniture', 0)
const partD = buildTreeDescriptor(world.som.getNodeByName('Table-Center')._node, 'Table-Center', 0)
world.removeNode('Table-Center')
const r2 = world.addNode(structuredClone(partD), 'Furniture')
const after = buildTreeDescriptor(g(), 'Furniture', 0)
console.log('restore part', r2.ok, '; order now', g().listChildren().map((c) => c.getName()).slice(-2).join(','))
console.log('Furniture compare after part restore: in order', sameDescriptor(before, after), '| children as set by name', sameDescriptor(before, after, true))
console.log('  first diffs (set-keyed would still see these):', diffs(before.children.find(c=>c.name==='Credenza-North'), after.children.find(c=>c.name==='Credenza-North')).slice(0,3))

// pure order case: G [P(X), A(Y), B(ref Y)] ; restore P -> [A, B, P]
const tri = { attributes: { POSITION: [0,0,0,1,0,0,0,1,0] } }
const mat = (c) => ({ name: c, pbrMetallicRoughness: { baseColorFactor: [c === 'X' ? 1 : 0, 0, 0, 1], metallicFactor: 1, roughnessFactor: 1 } })
const G = { name: 'G', translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], children: [
  { name: 'P', translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], mesh: { primitives: [{ ...tri, material: mat('X') }] } },
  { name: 'A', translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], mesh: { primitives: [{ ...tri, material: mat('Y') }] } },
  { name: 'B', translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], mesh: { primitives: [{ ...tri, material: { ref: 1 } }] } } ] }
console.log('G addNode', world.addNode(structuredClone(G), null).ok)
const gG = () => world.som.getNodeByName('G')._node
const g0 = buildTreeDescriptor(gG(), 'G', 0)
console.log('G live fixed point', sameDescriptor(G, g0))
const pD = buildTreeDescriptor(world.som.getNodeByName('P')._node, 'P', 0)
world.removeNode('P'); world.addNode(structuredClone(pD), 'G')
const g1 = buildTreeDescriptor(gG(), 'G', 0)
console.log('G after P deleted+restored: children-as-set compare', sameDescriptor(g0, g1, true), diffs(g0.children.find(c=>c.name==='B'), g1.children.find(c=>c.name==='B')))
