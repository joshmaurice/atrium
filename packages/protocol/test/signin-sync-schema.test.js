// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// signin-sync-schema.test.js — signin-sync step 1 (brief §6.1).
//
// `hello.server.json` gains `signedIn` (boolean, NOT required — a client may
// talk to another or older server) and `userId` (string), present exactly when
// `signedIn` is true, enforced with the if/then/else pairing on a second
// `allOf` branch next to the existing scriptHost/hostGen branch.
//
// `error.json` gains `SIGNED_OUT`.
//
// The validator is `new Ajv({ strict: false })`, which silently ignores a
// misspelled keyword, so every rule below has a case that must be REFUSED.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.js'

/** A minimal valid server hello: signed-out, no script host. */
function helloServer(extra = {}) {
  return {
    type: 'hello', id: 'server-01', seq: 0, serverTime: 1000,
    scriptHost: false, signedIn: false, ...extra,
  }
}

describe('hello (server) — signedIn and userId', () => {
  test('accepts signedIn false with no userId', () => {
    assert.equal(validate('server', helloServer()).valid, true)
  })

  test('accepts signedIn true with a userId', () => {
    assert.equal(validate('server', helloServer({ signedIn: true, userId: 'user-1' })).valid, true)
  })

  test('accepts a hello with neither field (an older or another server)', () => {
    const msg = { type: 'hello', id: 'server-01', seq: 0, serverTime: 1000, scriptHost: false }
    assert.equal(validate('server', msg).valid, true, 'signedIn is not in required')
  })

  test('refuses signedIn true without a userId', () => {
    const msg = helloServer({ signedIn: true })
    assert.equal(validate('server', msg).valid, false)
  })

  test('refuses signedIn false with a userId', () => {
    const msg = helloServer({ signedIn: false, userId: 'user-1' })
    assert.equal(validate('server', msg).valid, false)
  })

  test('refuses a non-boolean signedIn and a non-string userId', () => {
    assert.equal(validate('server', helloServer({ signedIn: 'yes' })).valid, false)
    assert.equal(validate('server', helloServer({ signedIn: true, userId: 42 })).valid, false)
    assert.equal(validate('server', helloServer({ signedIn: true, userId: '' })).valid, false,
      'userId must be a non-empty string')
  })

  test('keeps the scriptHost/hostGen pairing working alongside the new branch', () => {
    assert.equal(
      validate('server', helloServer({ scriptHost: true, hostGen: 3, signedIn: true, userId: 'u' })).valid,
      true,
    )
    assert.equal(
      validate('server', helloServer({ scriptHost: true, signedIn: true, userId: 'u' })).valid,
      false, 'scriptHost true still requires hostGen',
    )
    assert.equal(
      validate('server', helloServer({ hostGen: 3 })).valid,
      false, 'hostGen with scriptHost false is still refused',
    )
  })
})

describe('error — SIGNED_OUT', () => {
  test('accepts SIGNED_OUT', () => {
    assert.equal(
      validate('server', { type: 'error', code: 'SIGNED_OUT', message: 'You signed out' }).valid,
      true,
    )
  })

  test('still refuses an unknown code', () => {
    assert.equal(
      validate('server', { type: 'error', code: 'NOT_A_CODE', message: 'x' }).valid,
      false,
    )
  })
})
