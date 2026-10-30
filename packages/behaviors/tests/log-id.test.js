// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// log-id.test.js — scripting-4c revision round 2, W3: `@atrium/behaviors`' copy
// of `logId`, the ONE way the runner puts a session id into a log line.
//
// The outside review's S1: the runner's `select from` line used
// `String(from ?? '').slice(0, 8)`, so an id carrying a `\n` or an ANSI escape
// forged a log line and repainted a terminal. `logId` drops every character
// outside [A-Za-z0-9_-] BEFORE it takes the first 8, so nothing it returns can
// contain a control character.
//
// The server has its own copy of this file (packages/server/src/log-id.js) with
// its own test (packages/server/test/log-id.test.js) running the same cases: the
// two packages do not depend on each other, so each copy is pinned here.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { logId } from '../src/log-id.js'

const UUID = 'c3b9f1d2-4a56-4e78-9f01-2b3c4d5e6f70'

test('W3/logId: a UUID gives its first 8 characters', () => {
  assert.equal(logId(UUID), UUID.slice(0, 8))
  assert.equal(logId(UUID), 'c3b9f1d2')
  assert.equal(logId('visitor-abcd1234'), 'visitor-', 'the id the round-1 test used, unchanged')
})

test('W3/logId: every character outside [A-Za-z0-9_-] is dropped BEFORE the first 8 are taken', () => {
  // The order is the point: taking 8 first would keep the ESC and the '['.
  assert.equal(logId('\n\u001b[2Jabc'), '2Jabc')
  assert.equal(logId('\u001b[31mFAKE'), '31mFAKE', 'from the runner’s own case')
  assert.equal(logId('abc.def/ghi jkl'), 'abcdefgh')
})

test('W3/logId: an id with nothing admissible left is "-", and a non-string never throws', () => {
  assert.equal(logId('\u0000'), '-')
  assert.equal(logId('\n\t\u001b'), '-')
  assert.equal(logId(''), '-')
  for (const notAString of [42, null, undefined, {}, [], true, Symbol('x'), () => {}]) {
    assert.equal(logId(notAString), '-', `${String(notAString)} is not a string`)
  }
})

test('W3/logId: the answer is never longer than 8 and never carries a control character', () => {
  const hostile = [
    'x'.repeat(250_000),
    'x\n'.repeat(1000),
    '\u001b[2J'.repeat(100),
    `${UUID}\n${UUID}`,
  ]
  for (const id of hostile) {
    const out = logId(id)
    assert.ok(out.length >= 1 && out.length <= 8, `length ${out.length}`)
    assert.match(out, /^[A-Za-z0-9_-]+$/)
  }
})