// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// invalid-index.test.js — scripting-4b-2 step 3, F3 (always runs).
//
// The spike's `t4` rejected 187 of 187 Khronos invalid graphs. 4b-2's server
// gate is F1 plus `validateInteractivityGraph`, so what this round can pin is
// that the server would never store any of them. Two checked-in files:
//
//   behavior-invalid/index.json — the declared 4b-2 subset (cases whose
//     declarations are all in F-L4's list). EMPTY: every invalid case uses at
//     least one op this round refuses. Its cases, if any, must be refused too.
//   behavior-invalid/cases.json — every invalid case with a readable graph, so
//     the 100%-refused claim is not vacuous.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { behaviorCheck, BEHAVIOR_OPS } from '../src/behavior-spec.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SUBSET = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-invalid/index.json'), 'utf8'))
const CASES = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-invalid/cases.json'), 'utf8'))

const OWN = '11111111-1111-4111-8111-111111111111'
const asValue = (graph) => ({
  kind: 'graph', graph, nodeMap: [OWN], targets: [], animations: [], enabled: true, origin: 'local',
})

describe('F3 — the Khronos invalid-graph index', () => {
  test('the declared 4b-2 subset is recorded, and every case in it is refused', () => {
    assert.ok(Array.isArray(SUBSET.cases), 'the subset file has a case list')
    assert.equal(SUBSET.source.includes('926bec45'), true, 'the pinned assets commit is recorded')
    for (const entry of SUBSET.cases) {
      for (const op of entry.ops) assert.ok(BEHAVIOR_OPS.includes(op), `${entry.id}: ${op} is in F-L4's list`)
      assert.equal(SUBSET.cases.length, 0, 'the subset is empty in practice — see the recorded skip histogram')
    }
    assert.equal(typeof SUBSET.skipped.opOutsideAllowlist, 'number', 'the skip histogram is recorded')
  })

  test('100% of the invalid index\'s readable graphs are REFUSED by the server\'s rule', () => {
    assert.ok(CASES.cases.length >= 150, `the checked-in set is the whole index (${CASES.cases.length})`)
    const accepted = []
    for (const entry of CASES.cases) {
      const check = behaviorCheck(asValue(entry.graph), { ownId: OWN })
      if (check.problem === null) accepted.push(`${entry.id} ${entry.title}`)
    }
    assert.deepEqual(accepted, [], 'the server would never store an invalid graph')
  })

  test('every refusal carries a named reason code and a message', () => {
    for (const entry of CASES.cases) {
      const check = behaviorCheck(asValue(entry.graph), { ownId: OWN })
      assert.equal(typeof check.problem, 'string', `${entry.id} has a code`)
      assert.equal(typeof check.message, 'string', `${entry.id} has a message`)
    }
  })
})
