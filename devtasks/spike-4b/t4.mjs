// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// Criterion 4: the invalid-graph assets must be rejected.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeEngine, validateInteractivityExtension } from './host.mjs'
const R = process.argv[2]
const index = JSON.parse(readFileSync(join(R, 'invalid/invalid-index.json'), 'utf8'))
const tally = {}; const misses = []
for (const t of index) {
  const file = join(R, t.name, t.variants.glTF ?? t.variants['glTF-Binary'])
  let json
  try { json = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { tally['unreadable'] = (tally['unreadable'] ?? 0) + 1; continue }
  const ext = json.extensions?.KHR_interactivity
  let stage = 'accepted'
  try {
    validateInteractivityExtension(ext)
    const g = ext.graphs?.[ext.graph ?? 0]
    const nodes = (json.nodes ?? []).map((n) => ({ translation: n.translation ?? [0,0,0], rotation: n.rotation ?? [0,0,0,1], scale: n.scale ?? [1,1,1], visible: true }))
    const { engine } = makeEngine({ world: { nodes } })
    engine.loadBehaveGraph(g, false)
  } catch (e) { stage = e.constructor.name === 'GraphRejectedError' ? 'rejected at load' : `rejected by validate (${e.constructor.name})` }
  const key = `${t.expectedOutcome} -> ${stage.startsWith('rejected') ? 'rejected' : 'ACCEPTED'}`
  tally[key] = (tally[key] ?? 0) + 1
  if (!stage.startsWith('rejected')) misses.push(`${t.id} ${t.title}`)
}
console.log(index.length, 'cases'); console.log(tally); console.log('accepted (should have been rejected):', misses.length); console.log(misses.slice(0, 20).join('\n'))
