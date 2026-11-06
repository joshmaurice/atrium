// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p8 — facts the richer-add contract rests on, at cdfe88a8 (PREBRIEF-richer-add.md §2).
// Run from the repo root: node devtasks/spike-richer-add/p8-richer-add-facts.mjs
//  (a) accessor and buffer labels (names, extras) in the fixture worlds (RA-L2);
//  (b) what glTF-Transform's writer keeps of a material's fields (canonical form);
//  (c) what today's ingestNode keeps of the richer fields (nothing);
//  (d) the hello schema refuses an unknown capability (version skew);
//  (e) buffers per ingestNode call today (one per primitive);
//  (f), (g) an unnamed shared material and a shared mesh through today's Duplicate and Undo;
//  (h) the writer's 1e-5 tolerance on vector factors.
import { createRequire } from 'node:module'
import path from 'node:path'
const req = createRequire(path.resolve('packages/som/package.json'))
const { NodeIO, Document, WebIO } = await import(req.resolve('@gltf-transform/core'))
const { ALL_EXTENSIONS, KHRONOS_EXTENSIONS } = await import(req.resolve('@gltf-transform/extensions'))
const { SOMDocument } = await import(path.resolve('packages/som/src/SOMDocument.js'))
const { validate } = await import(path.resolve('packages/protocol/src/index.js'))
const empty = (o) => o == null || Object.keys(o).length === 0

// (a)
const files = ['atrium', 'crate', 'lamp', 'space', 'space-lights', 'space-cameras', 'space-anim', 'space-ext']
  .map((f) => `tests/fixtures/${f}.gltf`)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const labels = new Map(); const bump = (k) => labels.set(k, (labels.get(k) ?? 0) + 1)
let accessors = 0, buffers = 0
for (const f of files) {
  let doc; try { doc = await io.read(f) } catch (e) { console.log(`(a) ${f}: not read (${e.message})`); continue }
  for (const a of doc.getRoot().listAccessors()) {
    accessors++
    if (a.getName()) bump('accessor name'); if (!empty(a.getExtras())) bump('accessor extras')
    if (a.getNormalized()) bump('accessor normalized'); if (a.getSparse?.()) bump('accessor sparse')
  }
  for (const b of doc.getRoot().listBuffers()) { buffers++; if (b.getName()) bump('buffer name'); if (!empty(b.getExtras())) bump('buffer extras') }
  for (const m of doc.getRoot().listMeshes()) {
    if (!empty(m.getExtras())) bump('mesh extras')
    for (const p of m.listPrimitives()) if (!empty(p.getExtras())) bump('primitive extras')
  }
  for (const m of doc.getRoot().listMaterials()) if (!empty(m.getExtras())) bump('material extras')
}
console.log(`(a) ${files.length} fixture files, ${accessors} accessors, ${buffers} buffers; labels:`,
  labels.size ? Object.fromEntries(labels) : 'none')

// (b) the writer: which material fields survive a write + read
const doc = new Document(); doc.createBuffer()
const mk = (name, f) => { const m = doc.createMaterial(name); f(m); return m }
const cases = {
  'OPAQUE, alphaCutoff 0.3': mk('a', (m) => m.setAlphaCutoff(0.3)),
  'MASK, alphaCutoff 0.3': mk('b', (m) => m.setAlphaMode('MASK').setAlphaCutoff(0.3)),
  'MASK, alphaCutoff 0.5 (default)': mk('c', (m) => m.setAlphaMode('MASK')),
  'BLEND, alphaCutoff 0.3': mk('d', (m) => m.setAlphaMode('BLEND').setAlphaCutoff(0.3)),
  'emissive [0,0,0] (default)': mk('e', () => {}),
  'doubleSided false (default)': mk('f', (m) => m.setDoubleSided(false)),
}
const wio = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
const { json } = await wio.writeJSON(doc)
const back = await wio.readJSON({ json, resources: {} })
const byName = new Map(back.getRoot().listMaterials().map((m) => [m.getName(), m]))
console.log('(b) the writer keeps:')
for (const [label, m] of Object.entries(cases)) {
  const def = json.materials.find((d) => d.name === m.getName())
  const r = byName.get(m.getName())
  console.log(`  ${label}: written ${JSON.stringify({ alphaMode: def.alphaMode, alphaCutoff: def.alphaCutoff, emissiveFactor: def.emissiveFactor, doubleSided: def.doubleSided })}; read back alphaCutoff ${r.getAlphaCutoff()}`)
}

// (c) ingestNode today, with the richer fields on the wire
const som = new SOMDocument(new Document())
const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]
som.ingestNode({ name: 'rich', mesh: { name: 'm', extras: { k: 1 }, primitives: [{
  attributes: { POSITION: tri, TEXCOORD_0: [0, 0, 1, 0, 0, 1], COLOR_0: [1, 0, 0, 1, 0, 0, 1, 0, 0] }, extras: { p: 1 },
  material: { name: 'Marble', extras: { q: 1 }, emissiveFactor: [1, 0, 0], alphaMode: 'BLEND', alphaCutoff: 0.2, doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } } }] } })
const n = som._document.getRoot().listNodes().find((x) => x.getName() === 'rich')
const p = n.getMesh().listPrimitives()[0]; const m = p.getMaterial()
console.log(`(c) ingestNode keeps: semantics ${p.listSemantics()}, mesh extras ${JSON.stringify(n.getMesh().getExtras())}, primitive extras ${JSON.stringify(p.getExtras())}, material name "${m.getName()}", extras ${JSON.stringify(m.getExtras())}, emissive ${m.getEmissiveFactor()}, alphaMode ${m.getAlphaMode()}, cutoff ${m.getAlphaCutoff()}, doubleSided ${m.getDoubleSided()}`)

// (d) the hello schema and an unknown capability
const hello = (caps) => validate('client', { type: 'hello', id: 'abcd-1234', capabilities: caps })
console.log(`(d) hello with { scriptRunner: 3 }: ${hello({ scriptRunner: 3 }).valid}; with { addFields: 2 }: ${hello({ addFields: 2 }).valid}`)

// (e) buffers per ingestNode call
const som2 = new SOMDocument(new Document())
const before = som2._document.getRoot().listBuffers().length
som2.ingestNode({ name: 'three', mesh: { primitives: [0, 1, 2].map(() => ({ attributes: { POSITION: tri } })) } })
console.log(`(e) one ingestNode of 3 primitives adds ${som2._document.getRoot().listBuffers().length - before} buffers`)

// (f) today's Duplicate rule and an UNNAMED material shared by two nodes

const { duplicateRuleProblem, prepareRestore } = await import(path.resolve('apps/client/src/edit-duplicate.js'))
const d3 = new Document(); const b3 = d3.createBuffer(); const scene = d3.createScene()
const shared = d3.createMaterial().setBaseColorFactor([0.5, 0.5, 0.5, 1])
for (const name of ['A', 'B']) {
  const pos = d3.createAccessor().setType('VEC3').setArray(new Float32Array(tri)).setBuffer(b3)
  const prim = d3.createPrimitive().setAttribute('POSITION', pos).setMaterial(shared)
  scene.addChild(d3.createNode(name).setMesh(d3.createMesh().addPrimitive(prim)))
}
const nodeA = d3.getRoot().listNodes()[0]
console.log(`(f) unnamed material shared by A and B: duplicateRuleProblem(A) = ${JSON.stringify(duplicateRuleProblem(nodeA))}; prepareRestore(A).ok = ${prepareRestore(nodeA).ok}`)

// (g) today's Duplicate rule and a MESH shared by two nodes (fresh-agent check, Rev 1.2)
const d4 = new Document(); const b4 = d4.createBuffer(); const s4 = d4.createScene()
const pos4 = d4.createAccessor().setType('VEC3').setArray(new Float32Array(tri)).setBuffer(b4)
const mesh4 = d4.createMesh().addPrimitive(d4.createPrimitive().setAttribute('POSITION', pos4).setMaterial(d4.createMaterial()))
s4.addChild(d4.createNode('A').setMesh(mesh4)); s4.addChild(d4.createNode('B').setMesh(mesh4))
const nodeA4 = d4.getRoot().listNodes()[0]
console.log(`(g) one mesh used by A and B: duplicateRuleProblem(A) = ${JSON.stringify(duplicateRuleProblem(nodeA4))}; prepareRestore(A).ok = ${prepareRestore(nodeA4).ok}`)

// (h) the writer's tolerance: a factor within 1e-5 of its default isn't written
const d5 = new Document(); d5.createBuffer()
d5.createMaterial('near').setEmissiveFactor([5e-6, 0, 0]).setBaseColorFactor([1, 1, 1, 0.999995])
const w5 = (await wio.writeJSON(d5)).json.materials[0]
console.log(`(h) emissive [5e-6,0,0] and baseColor [1,1,1,0.999995] are written as ${JSON.stringify(w5)}`)
