// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// conformance-4d.test.js — scripting-4d-1 step 6 (G8).
//
// The operator's 21 fixtures (`tests/fixtures/behavior-conformance-4d/`,
// written by Claude before the kickoff) through the REAL adapter, under that
// folder's README harness rules: the fake world, the injected clock and the
// injected timers, authority that never refuses, G4's value check at the
// boundary, and one verdict per tick. Every write log, refusal log,
// disposition and unsupported list must match the fixture exactly.
//
// The fixtures are the operator's, not the implementer's: this file READS them
// and may never write them. A fixture the code cannot pass is a finding for the
// handoff — never an edit — so the failure message says so.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONFORMANCE_4D_DIR, check4dFixtures, read4dFixtures } from '../scripts/conformance.mjs'

const FIXTURE_COUNT = 21

/** Every fixture file's sha256, as the run finds them on disk. */
function fixtureHashes() {
  return read4dFixtures().map(({ file }) => ({
    file,
    sha256: createHash('sha256').update(readFileSync(join(CONFORMANCE_4D_DIR, file))).digest('hex'),
  }))
}

describe("G8 — the operator's 4d conformance fixtures", () => {
  test('the folder holds the fixtures the README lists, and nothing else', () => {
    const fixtures = read4dFixtures()
    assert.equal(fixtures.length, FIXTURE_COUNT, 'the README lists 21 fixtures')
    for (const [index, { file, fixture }] of fixtures.entries()) {
      const expected = String(index + 1).padStart(2, '0')
      assert.ok(file.startsWith(`${expected}-`), `${file} must be fixture ${expected}`)
      assert.equal(typeof fixture.id, 'string')
      assert.equal(typeof fixture.ticks, 'number')
      assert.ok(Array.isArray(fixture.nodeMap) && fixture.nodeMap.length >= 1, `${file} needs a nodeMap`)
      assert.ok(fixture.expect && Array.isArray(fixture.expect.writes), `${file} needs an expected write log`)
    }
  })

  test('every fixture runs through the real adapter, and every write log matches exactly', () => {
    const verdicts = check4dFixtures()
    const failed = verdicts.filter((v) => !v.ok)
    assert.deepEqual(
      failed.map((f) => f.id),
      [],
      'every fixture must match; a fixture the code cannot pass is a FINDING for the handoff, never a fixture to change',
    )
    assert.equal(verdicts.length, FIXTURE_COUNT)
    for (const v of verdicts) assert.equal(v.ok, true, `${v.id}: ${v.reason ?? ''}`)
  })

  test('the run reads the fixtures and never writes them', () => {
    const before = fixtureHashes()
    check4dFixtures()
    assert.deepEqual(fixtureHashes(), before, 'the round may not edit tests/fixtures/behavior-conformance-4d/')
  })
})
