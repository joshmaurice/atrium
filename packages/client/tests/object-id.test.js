// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// object-id.test.js — scripting-4b-1 step 1, E1's client copy.
//
// The client's `objectIdProblem` runs the SAME shared vectors the server's test
// reads, so no copy of the rule lives in a test. `newObjectId()` is the
// injectable `crypto.randomUUID()` wrapper every client add path uses.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { objectIdProblem, objectIdReasonText, newObjectId, OBJECT_ID_REASONS } from '../src/object-id.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/object-id-vectors.json'), 'utf8'))

describe('objectIdProblem — the shared vectors (E1)', () => {
  assert.ok(VECTORS.values.length >= 25, 'the shared vectors are the adversarial set')

  for (const vector of VECTORS.values) {
    test(vector.label, () => {
      const reason = objectIdProblem(vector.value)
      assert.equal(reason, vector.ok ? null : vector.reason,
        reason ? objectIdReasonText(reason) : 'accepted')
    })
  }

  test('every refused vector names a code with plain text of its own', () => {
    for (const vector of VECTORS.values.filter((v) => !v.ok)) {
      assert.ok(OBJECT_ID_REASONS[vector.reason], `${vector.reason} must have plain text`)
      assert.notEqual(objectIdReasonText(vector.reason), 'the objectId is invalid')
    }
  })
})

describe('newObjectId (E1)', () => {
  test('100 ids all pass the rule and are distinct', () => {
    const seen = new Set()
    for (let i = 0; i < 100; i++) {
      const id = newObjectId()
      assert.equal(typeof id, 'string')
      assert.equal(objectIdProblem(id), null, `${id} must pass`)
      seen.add(id)
    }
    assert.equal(seen.size, 100, 'they are distinct')
  })

  test('the limiter can be injected', () => {
    let calls = 0
    const id = newObjectId(() => { calls += 1; return 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
    assert.equal(id, 'f47ac10b-58cc-4372-a567-0e02b2c3d479')
    assert.equal(calls, 1)
  })

  test('a supplied limiter that makes a bad value is reported by the rule', () => {
    assert.equal(objectIdProblem(newObjectId(() => 'not-a-uuid')), 'object-id-form')
  })
})
