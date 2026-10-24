// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// script-host-schema.test.js — scripting-4b-1 step 2, E5: this round's ONLY
// protocol change.
//
// `hello.server.json` gains a REQUIRED `scriptHost`, plus a `hostGen` that
// `scriptHost: true` requires and `scriptHost: false` forbids (if/then/else).
// A new `script-host.server.json` carries the role changing hands.
//
// PROOF (e2) IS ESSENTIAL: the validator is `new Ajv({ strict: false })`, which
// silently ignores a misspelled keyword. A schema rule counts only if a test
// proves it REFUSES something — so every rule below has a case that must fail.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validate, validators, messageTypes } from '../src/index.js'

const MAX = 9007199254740991   // 2^53 - 1

/** A minimal valid server hello, with `scriptHost: false`. */
function helloServer(extra = {}) {
  return { type: 'hello', id: 'server-01', seq: 0, serverTime: 1000, scriptHost: false, ...extra }
}

describe('hello (server) — scriptHost and hostGen', () => {
  test('accepts scriptHost false with no hostGen', () => {
    assert.equal(validate('server', helloServer()).valid, true)
  })

  test('accepts scriptHost true with hostGen', () => {
    assert.equal(validate('server', helloServer({ scriptHost: true, hostGen: 1 })).valid, true)
    assert.equal(validate('server', helloServer({ scriptHost: true, hostGen: MAX })).valid, true,
      'hostGen at 2^53 - 1 is accepted')
  })

  test('refuses a hello with no scriptHost', () => {
    const msg = { type: 'hello', id: 'server-01', seq: 0, serverTime: 1000 }
    assert.equal(validate('server', msg).valid, false, 'scriptHost is required')
  })

  test('refuses scriptHost true without hostGen', () => {
    const msg = helloServer({ scriptHost: true })
    assert.equal(validate('server', msg).valid, false)
  })

  test('refuses hostGen with scriptHost false', () => {
    const msg = helloServer({ scriptHost: false, hostGen: 1 })
    assert.equal(validate('server', msg).valid, false)
  })

  test('refuses hostGen 0 and hostGen 2^53', () => {
    assert.equal(validate('server', helloServer({ scriptHost: true, hostGen: 0 })).valid, false)
    assert.equal(validate('server', helloServer({ scriptHost: true, hostGen: 2 ** 53 })).valid, false)
  })

  test('refuses a non-boolean scriptHost and a non-integer hostGen', () => {
    assert.equal(validate('server', helloServer({ scriptHost: 'yes' })).valid, false)
    assert.equal(validate('server', helloServer({ scriptHost: true, hostGen: 1.5 })).valid, false)
    assert.equal(validate('server', helloServer({ scriptHost: true, hostGen: '1' })).valid, false)
  })
})

describe('script-host (server)', () => {
  const valid = (extra = {}) => ({ type: 'script-host', active: true, hostGen: 1, ...extra })

  test('accepts the message, active true or false', () => {
    assert.equal(validate('server', valid()).valid, true)
    assert.equal(validate('server', valid({ active: false, hostGen: 5 })).valid, true)
    assert.equal(validate('server', valid({ hostGen: MAX })).valid, true)
  })

  test('is registered as a validators entry and a message type', () => {
    assert.ok(validators['script-host'], 'the som-dump pattern: a validators key')
    assert.ok(messageTypes.includes('script-host'))
  })

  test('refuses each missing field', () => {
    for (const field of ['type', 'active', 'hostGen']) {
      const msg = valid()
      delete msg[field]
      assert.equal(validate('server', msg).valid, false, `${field} is required`)
    }
  })

  test('refuses a wrong type on each field', () => {
    assert.equal(validate('server', valid({ active: 'yes' })).valid, false)
    assert.equal(validate('server', valid({ hostGen: '1' })).valid, false)
    assert.equal(validate('server', valid({ hostGen: 1.5 })).valid, false)
  })

  test('refuses an out-of-range hostGen', () => {
    assert.equal(validate('server', valid({ hostGen: 0 })).valid, false)
    assert.equal(validate('server', valid({ hostGen: 2 ** 53 })).valid, false)
  })

  test('refuses an extra field (additionalProperties: false)', () => {
    assert.equal(validate('server', valid({ reason: 'handover' })).valid, false)
  })

  test('refuses an unknown type value, so it routes to this validator only', () => {
    assert.equal(validate('server', { type: 'script-host', active: true }).valid, false)
    assert.equal(validate('server', { type: 'script-hosts', active: true, hostGen: 1 }).valid, false)
  })
})
