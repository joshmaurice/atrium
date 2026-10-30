// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// gen-vectors.test.js — scripting-4c revision round 2, W5: the generator refuses
// to write a distance vector whose points do not survive JSON.
//
// The outside review's S3: `gen-vectors.mjs` built a `NaN` vector and an
// `Infinity` vector, and `JSON.stringify` wrote both as `null`, so the fixture
// proved nothing about either. W5 removes those two vectors from the fixture
// (the direct tests in behavior-activate.test.js and behavior-leaf.test.js cover
// the rule instead) and adds the guard this file pins.
//
// Two halves:
//   1. `checkJsonRoundTrip` at unit level;
//   2. the REAL generator, run as a process with one `NaN` vector injected, must
//      exit 1 and write nothing. Proof (w5b) removes the guard and re-runs it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import { checkJsonRoundTrip, distanceVectors } from '../scripts/gen-vectors.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(__dirname, '..')
const NAN_RUN = resolve(PACKAGE, 'scripts/gen-vectors-nan-vector.mjs')
const FIXTURE = resolve(PACKAGE, '../../tests/fixtures/behavior-vectors.json')

// ===========================================================================
// 1. checkJsonRoundTrip, at unit level
// ===========================================================================

test('W5: the real fixture’s own vectors all survive JSON', () => {
  assert.equal(checkJsonRoundTrip(distanceVectors), null,
    'every vector the generator builds today survives the round trip')
})

test('W5: a NaN, an Infinity or a -Infinity point is named', () => {
  const good = { name: 'fine', a: [0, 0, 0], b: [1, 0, 0] }
  assert.equal(checkJsonRoundTrip([good]), null)
  for (const [name, bad] of [
    ['a NaN', [NaN, 0, 0]],
    ['an Infinity', [Infinity, 0, 0]],
    ['a -Infinity', [-Infinity, 0, 0]],
  ]) {
    assert.equal(checkJsonRoundTrip([good, { name, a: [0, 0, 0], b: bad }]), name,
      `${name} must be named`)
    assert.equal(checkJsonRoundTrip([{ name, a: bad, b: [0, 0, 0] }]), name,
      `${name} in the FIRST point must be named too`)
  }
})

test('W5: a missing point is not an offender — it survives the round trip', () => {
  // `undefined` stringifies to `undefined`, not to a string, and parses back to
  // `undefined`: the two missing-point vectors stay in the fixture.
  assert.equal(checkJsonRoundTrip([{ name: 'missing', a: undefined, b: [0, 0, 0] }]), null)
  assert.equal(checkJsonRoundTrip([{ name: 'null', a: null, b: [0, 0, 0] }]), null)
})

// ===========================================================================
// 2. the generator as a process, with a NaN vector injected
// ===========================================================================

test('W5: the generator run on a fixture with a NaN vector added exits 1 and writes nothing', () => {
  const out = join(tmpdir(), `behavior-vectors-nan-${randomUUID()}.json`)
  try {
    const run = spawnSync(process.execPath, [NAN_RUN, out], {
      cwd: PACKAGE, encoding: 'utf8', timeout: 60_000,
    })
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    assert.equal(run.status, 1, `the generator REFUSES (got status ${run.status}): ${output}`)
    assert.match(output, /a NaN \(the vector W5 removed\)/, 'and it names the vector it refused')
    assert.match(output, /does not survive JSON/)
    assert.equal(existsSync(out), false, 'and nothing was written')
  } finally {
    if (existsSync(out)) {
      throw new Error(`the injected run wrote ${out}: the guard did not stop it`)
    }
  }
})

test('W5: the checked-in fixture carries no NaN or Infinity distance vector', () => {
  const text = readFileSync(FIXTURE, 'utf8')
  assert.equal(text.includes('"a NaN"'), false, 'the NaN vector left the fixture (W5)')
  assert.equal(text.includes('"an Infinity"'), false, 'so did the Infinity vector')
  const fixture = JSON.parse(text)
  for (const vector of fixture.withinActivateDistance) {
    for (const key of ['a', 'b']) {
      const point = vector[key]
      if (!Array.isArray(point)) continue
      assert.equal(point.every((n) => typeof n !== 'number' || Number.isFinite(n)), true,
        `${vector.name}.${key} carries a non-finite number (it would have been written as null)`)
    }
  }
})
