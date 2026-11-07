// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// copy-objects-schema.test.js — copy-objects K1 (CP-L3 (c)).
//
// `hello.server.json` gains `world: { id, owner?: { id, name? } }`, NOT
// required (a client may talk to another or older server),
// `additionalProperties: false` at each level, ids and the name as strings of
// `minLength` 1 (not UUIDs: tests use `user-a` and `default`).
//
// The validator is `new Ajv({ strict: false })`, which silently ignores a
// misspelled keyword, so every rule below has a case that must be REFUSED.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/index.js'

function helloServer(extra = {}) {
  return {
    type: 'hello', id: 'server-01', seq: 0, serverTime: 1000,
    scriptHost: false, signedIn: false, ...extra,
  }
}

const ok = (world) => assert.equal(validate('server', helloServer({ world })).valid, true, JSON.stringify(world))
const no = (world) => assert.equal(validate('server', helloServer({ world })).valid, false, JSON.stringify(world))

describe('hello (server) — world', () => {
  test('accepts a world with no owner (a file world)', () => ok({ id: 'default' }))
  test('accepts an owner with an id and no name (db: null, a test owner id)', () => ok({ id: 'default', owner: { id: 'user-a' } }))
  test('accepts an owner with an id and a name', () => ok({ id: '3f2a9c1e-0000-4000-8000-000000000000', owner: { id: 'u-1', name: 'commonskeeper' } }))
  test('accepts a hello with no world (an older or another server)', () => {
    assert.equal(validate('server', helloServer()).valid, true, 'world is not in required')
  })

  test('refuses a world without an id, or with an empty or non-string id', () => {
    no({}); no({ id: '' }); no({ id: 7 }); no({ owner: { id: 'u' } })
  })
  test('refuses a world that is not an object', () => { no('default'); no(null); no(['default']) })
  test('refuses an unknown key on world', () => no({ id: 'w', name: 'Garden' }))
  test('refuses an owner without an id, or with an empty id', () => {
    no({ id: 'w', owner: {} }); no({ id: 'w', owner: { id: '' } }); no({ id: 'w', owner: { name: 'alice' } })
  })
  test('refuses an empty or non-string name', () => {
    no({ id: 'w', owner: { id: 'u', name: '' } }); no({ id: 'w', owner: { id: 'u', name: 3 } })
  })
  test('refuses an unknown key on owner', () => no({ id: 'w', owner: { id: 'u', email: 'a@b' } }))
  test('refuses an owner that is not an object', () => { no({ id: 'w', owner: 'u' }); no({ id: 'w', owner: null }) })
})
