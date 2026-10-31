// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// khronos-extract — writes tests/fixtures/behavior-conformance-khronos/ (G8):
// the graph JSON of every indexed Khronos conformance asset that fits G-L2 (a)'s
// ops and G7's sizes, one file per asset, plus a manifest with each file's
// sha256 and its `p6` baseline result (run p6 first and pass its JSON).
//   KHRONOS_ASSETS=<assets>/Tests/Interactivity node devtasks/spike-4d/khronos-extract.mjs <p6-results.json>
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readConformance, KHRONOS_ASSETS_COMMIT } from '../../packages/behaviors/scripts/conformance.mjs'
import { BasicBehaveEngine, NodeEventBus } from './g.mjs'

const ROOT = process.env.KHRONOS_ASSETS
const OUT = 'tests/fixtures/behavior-conformance-khronos'
const NOT_RUN = new Set(['event/onHoverIn', 'event/onHoverOut', 'event/stopPropagation', 'animation/stopAt'])
const registry = [...new BasicBehaveEngine(60, new NodeEventBus()).registry.keys()]
const ALLOW = new Set(registry.filter((op) => !NOT_RUN.has(op) && !op.startsWith('rigid_body/') && !op.startsWith('event/rigid_body')))
const fits = (a) => a.graph.declarations.every((d) => ALLOW.has(d?.op) && (!d.extension || d.extension === 'KHR_node_selectability')) &&
  (a.graph.nodes?.length ?? 0) <= 256 && JSON.stringify(a.graph).length <= 65536
const baseline = new Map(JSON.parse(readFileSync(process.argv[2], 'utf8')).map((r) => [r.name, r.result]))
mkdirSync(join(OUT, 'graphs'), { recursive: true })
const entries = []
for (const asset of readConformance(ROOT).filter(fits)) {
  const name = `${asset.set}:${asset.name}`
  const file = `graphs/${asset.set}--${asset.name.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`
  // The graph and the asset's nodes (TRS and visibility only), which p6's fake world is seeded from.
  const nodes = asset.nodes.map((n) => ({ ...(n.name ? { name: n.name } : {}), ...(n.translation ? { translation: n.translation } : {}),
    ...(n.rotation ? { rotation: n.rotation } : {}), ...(n.scale ? { scale: n.scale } : {}), ...(n.children ? { children: n.children } : {}),
    ...(n.extensions?.KHR_node_visibility ? { visible: n.extensions.KHR_node_visibility.visible } : {}) }))
  const body = JSON.stringify({ asset: name, graph: asset.graph, nodes }) + '\n'
  writeFileSync(join(OUT, file), body)
  entries.push({ asset: name, file, sha256: createHash('sha256').update(body).digest('hex'), baseline: baseline.get(name) ?? 'missing' })
}
copyFileSync(join(ROOT, '../../LICENSES/CC-BY-4.0.txt'), join(OUT, 'LICENSE-CC-BY-4.0.txt'))
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  description: 'G8: the Khronos conformance subset that fits PREBRIEF-scripting-4d G-L2 (a) and G7, with each asset\'s p6 baseline result (today\'s adapter, only the op filter widened). The round regenerates the results with its own adapter; every change from the baseline is explained in its handoff.',
  source: `KhronosGroup/glTF-Test-Assets-Interactivity @ ${KHRONOS_ASSETS_COMMIT}`,
  surveyScripts: 'devtasks/spike-4d/survey/, p6.mjs, khronos-extract.mjs',
  license: 'CC-BY-4.0 (LICENSE-CC-BY-4.0.txt); the graphs are extracted unchanged from the assets\' glTF-Binary JSON chunks',
  count: entries.length,
  baselineCounts: entries.reduce((m, e) => ({ ...m, [e.baseline]: (m[e.baseline] ?? 0) + 1 }), {}),
  entries,
}, null, 2) + '\n')
console.log(`wrote ${entries.length} graphs; baseline`, entries.reduce((m, e) => ({ ...m, [e.baseline]: (m[e.baseline] ?? 0) + 1 }), {}))
