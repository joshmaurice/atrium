// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p6 — the operator's host survey: for every saved world in a COPY of the
// database, which top-level objects Duplicate/Undo refuse today and why, and
// how many mesh nodes would still lose something under a richer `add`.
// Prints counts only: no world names, slugs, user ids or node names.
// Usage (from the repo root of a checkout with `pnpm install` done):
//   node devtasks/spike-richer-add/p6-db-survey.mjs <copy of atrium.db>
import path from 'node:path'
import { createRequire } from 'node:module'
const req = createRequire(path.resolve('packages/server/package.json'))
const Database = (await import(req.resolve('better-sqlite3'))).default
const somReq = createRequire(path.resolve('packages/som/package.json'))
const { NodeIO } = await import(somReq.resolve('@gltf-transform/core'))
const { ALL_EXTENSIONS } = await import(somReq.resolve('@gltf-transform/extensions'))
const { duplicateRuleProblem } = await import(path.resolve('apps/client/src/edit-duplicate.js'))

const db = new Database(process.argv[2], { readonly: true, fileMustExist: true })
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const verdicts = new Map(); const inner = new Map()
let worlds = 0, unreadable = 0, roots = 0
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
for (const row of db.prepare('SELECT document FROM worlds').iterate()) {
  worlds++
  let doc
  try { doc = await io.readJSON({ json: JSON.parse(row.document), resources: {} }) } catch { unreadable++; continue }
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  for (const n of scene ? scene.listChildren() : []) {
    roots++
    const p = duplicateRuleProblem(n)
    bump(verdicts, p ? p.reason : 'OK (copies today)')
  }
  // Every mesh node, at any depth: what a richer `add` would still have to carry.
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue
    for (const prim of mesh.listPrimitives()) {
      for (const s of prim.listSemantics()) if (s !== 'POSITION' && s !== 'NORMAL') bump(inner, `attribute ${s}`)
      const m = prim.getMaterial(); if (!m) continue
      if (m.getName()) bump(inner, 'material name')
      if (m.getEmissiveFactor().some((v) => v !== 0)) bump(inner, 'emissive')
      if (m.getAlphaMode() !== 'OPAQUE') bump(inner, `alphaMode ${m.getAlphaMode()}`)
      if (m.getDoubleSided()) bump(inner, 'double-sided')
      if (m.getBaseColorTexture() || m.getNormalTexture() || m.getEmissiveTexture() ||
          m.getMetallicRoughnessTexture() || m.getOcclusionTexture()) bump(inner, 'textures')
      if (m.listExtensions().length) bump(inner, 'material extensions')
      if (m.listParents().filter((x) => x.propertyType === 'Primitive').length > 1) bump(inner, 'material shared')
    }
  }
}
console.log(`worlds ${worlds} (unreadable ${unreadable}); top-level objects ${roots}`)
console.log('Top-level objects by Duplicate verdict today:')
for (const [k, v] of [...verdicts].sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`)
console.log('Primitives, at any depth, by property today\'s add drops:')
for (const [k, v] of [...inner].sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`)
