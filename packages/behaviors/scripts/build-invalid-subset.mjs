// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// build-invalid-subset.mjs — scripting-4b-2 step 3, F3's invalid-graph data.
//
// The Khronos invalid-graph index (glTF-Test-Assets-Interactivity at 926bec45)
// has 187 cases. Two checked-in files come out of it:
//
//   tests/fixtures/behavior-invalid/index.json — **the 4b-2 subset**: the cases
//     whose declarations are ALL in F-L4's op allowlist. In practice this is
//     EMPTY (0 of 187): every invalid case uses at least one op this round
//     refuses, which is why the file records the skip histogram.
//   tests/fixtures/behavior-invalid/cases.json — every case that carries a
//     readable graph, checked in so an always-on test can pin that the
//     server's rule (F1) refuses 100% of them, which is what 4b-2 can judge
//     about the invalid index. This is the honest replacement for a subset
//     test that would otherwise be vacuous.
//
// Plain files only: the deploy's tree-check refuses symlinks anywhere.
//
//   KHRONOS_ASSETS=/path/to/assets/Tests/Interactivity node scripts/build-invalid-subset.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BEHAVIOR_OPS } from '../src/behavior-spec.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../../../tests/fixtures/behavior-invalid')
const SOURCE = 'glTF-Test-Assets-Interactivity @ 926bec45dfbe052bad4013ab5852ed2f4042bff5'

/** Read the index and split it into the 4b-2 subset and the full readable set. */
export function buildInvalidData(assetsRoot) {
  const index = JSON.parse(readFileSync(join(assetsRoot, 'invalid/invalid-index.json'), 'utf8'))
  const subset = []
  const cases = []
  const skipped = { opOutsideAllowlist: 0, notJson: 0, noGraph: 0 }
  for (const entry of index) {
    const variant = entry.variants?.glTF ?? entry.variants?.['glTF-Binary']
    let json
    try { json = JSON.parse(readFileSync(join(assetsRoot, entry.name, variant), 'utf8')) } catch { skipped.notJson++; continue }
    const extension = json.extensions?.KHR_interactivity
    const graph = extension?.graphs?.[extension.graph ?? 0]
    if (!graph || !Array.isArray(graph.declarations)) { skipped.noGraph++; continue }
    const ops = graph.declarations.map((d) => d?.op)
    cases.push({ id: entry.id, title: entry.title, expectedOutcome: entry.expectedOutcome, graph })
    if (!ops.every((op) => BEHAVIOR_OPS.includes(op))) { skipped.opOutsideAllowlist++; continue }
    subset.push({ id: entry.id, title: entry.title, name: entry.name, variant, ops, expectedOutcome: entry.expectedOutcome })
  }
  return { subset, cases, total: index.length, skipped }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.KHRONOS_ASSETS
  if (!root) { console.log('KHRONOS_ASSETS is not set — nothing to build'); process.exit(0) }
  const { subset, cases, total, skipped } = buildInvalidData(root)
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify({
    description:
      'The 4b-2 subset of the Khronos invalid-graph index: every case whose declarations are ALL ' +
      'in F-L4\'s op allowlist. Empty in practice — every invalid case uses at least one op this ' +
      'round refuses; see `skipped`. The full readable set is in cases.json.',
    source: SOURCE,
    total,
    skipped,
    cases: subset,
  }, null, 2)}\n`)
  writeFileSync(join(OUT, 'cases.json'), `${JSON.stringify({
    description:
      'Every invalid-graph case whose glTF carries a readable KHR_interactivity graph, kept so an ' +
      'always-on test can pin that the server\'s rule (F1 + the engine validator) refuses 100% of ' +
      'the Khronos invalid index — the part of the spike\'s 187/187 result that 4b-2 can judge.',
    source: SOURCE,
    total,
    cases,
  }, null, 2)}\n`)
  console.log(`subset ${subset.length} of ${total}; cases ${cases.length}; skipped ${JSON.stringify(skipped)}`)
}
