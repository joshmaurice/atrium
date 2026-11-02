// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p2 — EVERY property of each mesh node (top level and inside groups) that
// today's `add` would lose, not just the first one Duplicate reports. Shows
// what a richer `add` would have to carry for these files to copy.
// Run from the repo root: node devtasks/spike-richer-add/p2-losses.mjs <files…>
import { createRequire } from 'node:module'
import path from 'node:path'
const req = createRequire(path.resolve('packages/som/package.json'))
const { NodeIO } = await import(req.resolve('@gltf-transform/core'))
const { ALL_EXTENSIONS } = await import(req.resolve('@gltf-transform/extensions'))
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const empty = (o) => o == null || Object.keys(o).length === 0

function losses(node) {
  const out = new Set()
  if (node.getCamera()) out.add('camera')
  if (node.getSkin()) out.add('skin')
  for (const e of node.listExtensions()) out.add(`node ext ${e.extensionName}`)
  if ((node.getWeights() ?? []).length) out.add('node weights')
  const mesh = node.getMesh()
  if (!mesh) return out
  if (mesh.getName()) {} // carried today
  if (!empty(mesh.getExtras())) out.add('mesh extras')
  if (mesh.getWeights().length) out.add('morph weights')
  const mats = new Set()
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) out.add(`mode ${prim.getMode()}`)
    if (!empty(prim.getExtras())) out.add('primitive extras')
    if (prim.listTargets().length) out.add('morph targets')
    for (const s of prim.listSemantics()) if (s !== 'POSITION' && s !== 'NORMAL') out.add(`attr ${s}`)
    for (const s of prim.listSemantics()) {
      const a = prim.getAttribute(s)
      if (a.getName()) out.add('accessor name')
      if (a.getComponentType() !== 5126) out.add(`${s} componentType ${a.getComponentType()}`)
      if (a.getNormalized()) out.add(`${s} normalized`)
    }
    const idx = prim.getIndices()
    if (idx) {
      if (idx.getName()) out.add('accessor name')
      if (Math.max(...idx.getArray()) > 65535) out.add('index > 65535')
    }
    for (const a of [...prim.listAttributes(), idx].filter(Boolean)) {
      const b = a.getBuffer(); if (b && b.getName()) out.add('buffer name')
    }
    const m = prim.getMaterial()
    if (!m) continue
    mats.add(m)
    if (m.getName()) out.add('material name')
    if (!empty(m.getExtras())) out.add('material extras')
    for (const e of m.listExtensions()) out.add(`material ext ${e.extensionName}`)
    if (m.getBaseColorTexture() || m.getMetallicRoughnessTexture() || m.getNormalTexture() ||
        m.getOcclusionTexture() || m.getEmissiveTexture()) out.add('textures')
    if (m.getEmissiveFactor().some((v) => v !== 0)) out.add('emissive')
    if (m.getAlphaMode() !== 'OPAQUE') out.add(`alphaMode ${m.getAlphaMode()}`)
    if (m.getAlphaCutoff() !== 0.5) out.add('alphaCutoff')
    if (m.getDoubleSided()) out.add('doubleSided')
  }
  if (mats.size < mesh.listPrimitives().filter((p) => p.getMaterial()).length) out.add('material shared between primitives')
  // shared with other nodes' meshes?
  const users = m => m.listParents().filter((p) => p.propertyType === 'Primitive').length
  for (const m of mats) if (users(m) > 1) { out.add('material shared'); break }
  if (mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1) out.add('mesh instanced by several nodes')
  return out
}

const tally = new Map()
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file)
  const rows = []
  const walk = (n, depth) => {
    const l = losses(n)
    if (n.getMesh() || l.size) rows.push(`  ${'  '.repeat(depth)}${n.getName() || '(unnamed)'}: ${l.size ? [...l].join(', ') : 'nothing lost'}`)
    for (const k of l) tally.set(k, (tally.get(k) ?? 0) + 1)
    if (n.getMesh() && !l.size) tally.set('nothing lost', (tally.get('nothing lost') ?? 0) + 1)
    for (const c of n.listChildren()) walk(c, depth + 1)
  }
  for (const n of (doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]).listChildren()) walk(n, 0)
  console.log(path.basename(file)); console.log(rows.join('\n'))
}
console.log('\nTally (nodes with each loss):')
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`)
