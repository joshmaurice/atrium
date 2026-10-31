// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// conformance.test.js — scripting-4b-2 step 3 (F11); scripting-4d-1 step 6 (G8).
//
// G8: the Khronos subset is CHECKED IN (`tests/fixtures/behavior-conformance-khronos/`),
// so this run happens on every build host. The 4b-2 `KHRONOS_ASSETS` skip is
// gone: with the graphs in the tree there is nothing left to skip for, and the
// env var stays only as the way to regenerate (`conformance.mjs --from-assets`).
//
// The expected results are the ROUND's own — `expected-4d.json`, regenerated
// with this adapter against the manifest's `p6` baseline. A fail that became a
// pass and a pass that no longer reproduces both appear in `changes`, each with
// its reason; a change without a reason fails the third test below.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  KHRONOS_ASSETS_COMMIT, KHRONOS_SUBSET_DIR, baselineChanges, khronosManifest,
  manifestHashProblems, readExpected4d, readKhronosSubset, runKhronosSubset,
} from '../scripts/conformance.mjs'

const SUBSET_COUNT = 143

describe('G8 — the Khronos conformance subset, on the build host', () => {
  test('the manifest lists the subset, and every file is the file it hashes', () => {
    const problems = manifestHashProblems(KHRONOS_SUBSET_DIR)
    assert.deepEqual(problems, [], "the manifest's sha256 must match every checked-in graph")
    const manifest = khronosManifest(KHRONOS_SUBSET_DIR)
    assert.equal(manifest.source.includes(KHRONOS_ASSETS_COMMIT), true, 'the assets commit is pinned')
    assert.equal(manifest.entries.length, SUBSET_COUNT, 'every asset that fits G-L2 (a) and G7 is checked in')
    assert.equal(manifest.count, manifest.entries.length, "the manifest's own count must match its entries")
    const entries = readKhronosSubset(KHRONOS_SUBSET_DIR)
    assert.equal(entries.length, SUBSET_COUNT)
    for (const entry of entries) {
      assert.equal(entry.sha256, entry.manifestSha256, `${entry.file} must hash to the manifest's value`)
      assert.ok(Array.isArray(entry.graph?.declarations), `${entry.file} must carry a graph`)
    }
  })

  test('every asset runs through the real adapter, and the results are the regenerated list exactly', () => {
    const entries = readKhronosSubset(KHRONOS_SUBSET_DIR)
    const results = runKhronosSubset(entries)
    const expected = readExpected4d()
    assert.ok(expected, 'expected-4d.json must be checked in; regenerate it with `conformance.mjs --write`')
    assert.equal(expected.source.includes(KHRONOS_ASSETS_COMMIT), true, 'the expected list pins the assets commit')
    const have = results.map((r) => ({ asset: r.asset, result: r.result }))
    const want = expected.results.map(({ asset, result }) => ({ asset, result }))
    assert.equal(have.length, SUBSET_COUNT, 'the run covers every checked-in asset')
    assert.deepEqual(have, want, 'the subset must reproduce the regenerated list exactly; a change means the list needs regenerating (and every change explaining)')
    const counts = {}
    for (const r of results) counts[r.result] = (counts[r.result] ?? 0) + 1
    assert.deepEqual(counts, expected.counts, 'the recorded counts must be the run\'s own')
  })

  test('every change against the p6 baseline is named, and carries its reason', () => {
    const entries = readKhronosSubset(KHRONOS_SUBSET_DIR)
    const results = runKhronosSubset(entries)
    const changes = baselineChanges(entries, results)
    assert.deepEqual(
      changes.map((c) => ({ asset: c.asset, baseline: c.baseline, result: c.result })),
      (readExpected4d()?.changes ?? []).map(({ asset, baseline, result }) => ({ asset, baseline, result })),
      'the recorded changes must be the run\'s own',
    )
    for (const c of readExpected4d().changes) {
      assert.ok(typeof c.note === 'string' && c.note.length > 0,
        `${c.asset} moved from ${c.baseline} to ${c.result} and must say why (G8: every change explained)`)
    }
    // A change that is a REGRESSION is a finding for the operator, never a
    // silent edit of the list: name it here so a green run still says so.
    const regressions = changes.filter((c) => c.baseline === 'pass' && c.result !== 'pass')
    for (const r of regressions) {
      const note = readExpected4d().changes.find((c) => c.asset === r.asset)?.note ?? ''
      assert.match(note, /FINDING/, `${r.asset} was a pass and is no longer: its note must say FINDING`)
    }
  })
})
