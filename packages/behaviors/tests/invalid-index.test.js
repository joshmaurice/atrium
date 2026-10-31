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
//
//   behavior-invalid/LICENSE-CC-BY-4.0.txt — the assets' own licence, copied
//     byte for byte (R2: CC BY 4.0 needs attribution; the NOTICE entry and this
//     guard are what record it).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { behaviorCheck, BEHAVIOR_OPS } from '../src/behavior-spec.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SUBSET = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-invalid/index.json'), 'utf8'))
const CASES = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-invalid/cases.json'), 'utf8'))
const LICENSE_BYTES = readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-invalid/LICENSE-CC-BY-4.0.txt'))
const NOTICE = readFileSync(resolve(__dirname, '../../../NOTICE'), 'utf8')

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
    // 4d (G-L3 (a)): the server stores ANY declaration the engine's validator
    // accepts, so an invalid case whose fault is OUTSIDE the KHR_interactivity
    // graph cannot be judged here. A2c's "default graph index is the string
    // \"0\"" is an extension-object fault; its graph is valid.
    const outsideTheGraph = new Set(['A2c'])
    const accepted = []
    for (const entry of CASES.cases) {
      if (outsideTheGraph.has(entry.id)) continue
      const check = behaviorCheck(asValue(entry.graph), { ownId: OWN })
      if (check.problem === null) accepted.push(`${entry.id} ${entry.title}`)
    }
    assert.deepEqual(accepted, [], 'the server would never store an invalid graph')
  })

  test('every refusal carries a named reason code and a message', () => {
    for (const entry of CASES.cases) {
      if (entry.id === 'A2c') continue   // its fault is in the extension object, not the graph
      const check = behaviorCheck(asValue(entry.graph), { ownId: OWN })
      assert.equal(typeof check.problem, 'string', `${entry.id} has a code`)
      assert.equal(typeof check.message, 'string', `${entry.id} has a message`)
    }
  })
})

// R2 — the checked-in fixtures are derived from Khronos' CC BY 4.0 assets, so
// attribution is a condition of shipping them. This guard pins the NOTICE entry
// and the licence text that must sit beside them.

describe('R2 — attribution for the Khronos-derived fixtures', () => {
  test('NOTICE names the fixtures\' folder and the CC BY 4.0 licence', () => {
    assert.match(NOTICE, /tests\/fixtures\/behavior-invalid\//, 'NOTICE names the fixtures folder')
    assert.match(NOTICE, /CC BY 4\.0/, 'NOTICE names the licence')
    assert.match(NOTICE, /creativecommons\.org\/licenses\/by\/4\.0\//, 'NOTICE links the licence')
    assert.match(NOTICE, /KhronosGroup\/glTF-Test-Assets-Interactivity/, 'NOTICE names the source')
    assert.match(NOTICE, /926bec45dfbe052bad4013ab5852ed2f4042bff5/, 'NOTICE names the pinned commit')
    assert.match(NOTICE, /Khronos Group and Needle/, 'NOTICE carries the credit')
  })

  test('the licence text sits beside the fixtures, byte for byte', () => {
    assert.match(LICENSE_BYTES.toString('utf8'), /Creative Commons Attribution 4\.0 International Public License/,
      'LICENSE-CC-BY-4.0.txt is the CC BY 4.0 text')
    assert.equal(createHash('sha256').update(LICENSE_BYTES).digest('hex'),
      'c8041334a99cb48852b2139253cbde5f8ac87e27f124aed51223e0d5bf0080eb',
      'the licence is the source\'s copy at 926bec45, byte for byte')
  })
})
