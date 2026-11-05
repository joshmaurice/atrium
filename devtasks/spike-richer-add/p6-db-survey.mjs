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
// better-sqlite3 as on the host; Node's built-in node:sqlite when its native
// binding isn't built (an install with --ignore-scripts).
async function openReadonly(file) {
  try {
    const Database = (await import(req.resolve('better-sqlite3'))).default
    const d = new Database(file, { readonly: true, fileMustExist: true })
    return { rows: (sql) => d.prepare(sql).iterate() }
  } catch {
    const { DatabaseSync } = await import('node:sqlite')
    const d = new DatabaseSync(file, { readOnly: true })
    return { rows: (sql) => d.prepare(sql).all() }
  }
}
const somReq = createRequire(path.resolve('packages/som/package.json'))
const { NodeIO } = await import(somReq.resolve('@gltf-transform/core'))
const { ALL_EXTENSIONS } = await import(somReq.resolve('@gltf-transform/extensions'))
const { duplicateRuleProblem } = await import(path.resolve('apps/client/src/edit-duplicate.js'))

const db = await openReadonly(process.argv[2])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const verdicts = new Map(); const inner = new Map(); const checks = new Map()
let worlds = 0, unreadable = 0, roots = 0
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
for (const row of db.rows('SELECT document FROM worlds')) {
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
  // Rev 0.2 (outside reviews M1/M3/S1/N1/N4): what `add-check` and the [0, 1]
  // ranges on `send` would newly refuse in saved content. These objects keep
  // working where they are; Duplicate and Undo would refuse them.
  for (const n of doc.getRoot().listNodes()) {
    if (n.listExtensions().length) bump(checks, 'node has extensions')
    if (JSON.stringify(n.getExtras() ?? {}).length > 16384) bump(checks, 'node extras over 16 KiB')
    if (n.getTranslation().some((v) => !Number.isFinite(v))) bump(checks, 'translation not finite')
    const mesh = n.getMesh(); if (!mesh) continue
    if (mesh.listPrimitives().length > 64) bump(checks, 'mesh over 64 primitives')
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos || pos.getCount() < 3) bump(checks, 'POSITION under 3 vertices')
      if (pos && pos.getCount() > 65535 && prim.getIndices()) bump(checks, 'indexed, over 65,535 vertices')
      for (const s of prim.listSemantics()) {
        const arr = prim.getAttribute(s).getArray()
        if (arr && Array.from(arr).some((v) => !Number.isFinite(v))) bump(checks, `${s} not finite`)
      }
      const ind = prim.getIndices()
      if (ind && (ind.getCount() < 3 || ind.getCount() % 3)) bump(checks, 'indices not a positive multiple of 3')
      const m = prim.getMaterial(); if (!m) continue
      const in01 = (v) => Number.isFinite(v) && v >= 0 && v <= 1
      if (!m.getBaseColorFactor().every(in01)) bump(checks, 'baseColorFactor outside [0, 1]')
      if (!in01(m.getMetallicFactor()) || !in01(m.getRoughnessFactor())) bump(checks, 'metallic/roughness outside [0, 1]')
      if (!m.getEmissiveFactor().every(in01)) bump(checks, 'emissiveFactor outside [0, 1]')
      if (!(m.getAlphaCutoff() >= 0)) bump(checks, 'alphaCutoff below 0')
    }
  }
}
console.log(`worlds ${worlds} (unreadable ${unreadable}); top-level objects ${roots}`)
console.log('Top-level objects by Duplicate verdict today:')
for (const [k, v] of [...verdicts].sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`)
console.log('Primitives, at any depth, by property today\'s add drops:')
for (const [k, v] of [...inner].sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`)
console.log('Saved content add-check or send\'s new ranges would refuse (nodes or primitives; none means nothing):')
for (const [k, v] of [...checks].sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`)
if (unreadable) console.log(`NOTE: ${unreadable} world(s) can't be read back (review M1): such a world fails to load. Tell Claude; don't delete anything.`)
