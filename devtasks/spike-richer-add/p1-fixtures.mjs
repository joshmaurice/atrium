// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p1 — which nodes of each fixture world Duplicate/Undo refuse today, and why.
// Run from the repo root: node devtasks/spike-richer-add/p1-fixtures.mjs tests/fixtures/*.gltf
import { createRequire } from 'node:module'
import path from 'node:path'
const req = createRequire(path.resolve('packages/som/package.json'))
const { NodeIO } = await import(req.resolve('@gltf-transform/core'))
const { ALL_EXTENSIONS } = await import(req.resolve('@gltf-transform/extensions'))
const { duplicateRuleProblem } = await import(path.resolve('apps/client/src/edit-duplicate.js'))

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const tally = new Map()
for (const file of process.argv.slice(2)) {
  let doc
  try { doc = await io.read(file) } catch (e) { console.log(`${file}: unreadable (${e.message.slice(0, 60)})`); continue }
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const roots = scene ? scene.listChildren() : []
  const lines = []
  for (const n of roots) {
    const p = duplicateRuleProblem(n)
    const why = p ? `${p.rule}: ${p.reason}` : 'OK'
    lines.push(`  ${n.getName() || '(unnamed)'} — ${why}`)
    const key = p ? p.reason : 'OK'
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  console.log(`${path.basename(file)} (${roots.length} top-level)`)
  console.log(lines.join('\n'))
}
console.log('\nTally of top-level nodes by verdict:')
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`)
