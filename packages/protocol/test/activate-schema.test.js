// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// activate-schema.test.js — scripting-4c AC1: the protocol change this round
// makes.
//
//   - `activate.client.json`  { type, seq, node, event: 'select' }
//   - `activate.server.json`  the same plus `from` and `hostGen`
//   - `script-ready.client.json` { type, hostGen }, DIRECTIONAL (Rev 1.2 N1):
//     compiled `:client` only, so the server direction finds no schema
//   - `hello.capabilities.scriptRunner` is `enum: [1, 2]` (was `const: 1`)
//   - `error.code` gains `NO_SCRIPT_HOST`
//
// The direction list is hard-coded (protocol P2), so a message with both forms
// that is missing from it is refused in BOTH directions — that is proof (a).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validate, messageTypes } from '../src/index.js'

const activate = (extra = {}) => ({ type: 'activate', seq: 7, node: 'Switch', event: 'select', ...extra })
const forwarded = (extra = {}) => activate({ from: 'session-aabbccdd', hostGen: 3, ...extra })
const ready = (extra = {}) => ({ type: 'script-ready', hostGen: 3, ...extra })

// ===========================================================================
// activate — the client form
// ===========================================================================

test('AC1: a valid client activate is accepted, and the type is a known one', () => {
  assert.equal(validate('client', activate()).valid, true)
  assert.equal(messageTypes.includes('activate'), true)
  assert.equal(messageTypes.includes('script-ready'), true)
})

test('AC1: each required field of the client form is required', () => {
  for (const field of ['type', 'seq', 'node', 'event']) {
    const value = { ...activate() }
    delete value[field]
    assert.equal(validate('client', value).valid, false, `a client activate without ${field} must be refused`)
  }
})

test('AC1: an extra key on the client form is refused', () => {
  assert.equal(validate('client', activate({ hostGen: 1 })).valid, false)
  assert.equal(validate('client', activate({ from: 'x' })).valid, false)
})

test("AC1: event must be exactly 'select' — 'hover' is refused", () => {
  assert.equal(validate('client', activate({ event: 'hover' })).valid, false)
  assert.equal(validate('client', activate({ event: 'click' })).valid, false)
  assert.equal(validate('client', activate({ event: undefined })).valid, false)
})

test('AC1: node is 1 to 256 characters', () => {
  assert.equal(validate('client', activate({ node: 'a'.repeat(256) })).valid, true, '256 is allowed')
  assert.equal(validate('client', activate({ node: 'a'.repeat(257) })).valid, false, '257 is refused')
  assert.equal(validate('client', activate({ node: '' })).valid, false, 'empty is refused')
})

test('AC1: seq is an integer >= 0 (as send)', () => {
  assert.equal(validate('client', activate({ seq: 0 })).valid, true)
  assert.equal(validate('client', activate({ seq: -1 })).valid, false)
  assert.equal(validate('client', activate({ seq: 1.5 })).valid, false)
})

// ===========================================================================
// activate — the server form
// ===========================================================================

test('AC1: a valid server activate is accepted', () => {
  assert.equal(validate('server', forwarded()).valid, true)
  assert.equal(validate('server', forwarded({ from: 'x' })).valid, true, 'from is at least 1 character')
})

test('AC1: the server form needs from and hostGen, and only those beyond the client form', () => {
  for (const field of ['from', 'hostGen']) {
    const value = { ...forwarded() }
    delete value[field]
    assert.equal(validate('server', value).valid, false, `a server activate without ${field} must be refused`)
  }
  assert.equal(validate('server', forwarded({ from: '' })).valid, false, 'an empty from is refused')
})

test('AC1: hostGen is 1 .. 2^53-1, as script-host.server.json', () => {
  assert.equal(validate('server', forwarded({ hostGen: 1 })).valid, true)
  assert.equal(validate('server', forwarded({ hostGen: 9007199254740991 })).valid, true)
  assert.equal(validate('server', forwarded({ hostGen: 0 })).valid, false, 'hostGen 0 is refused')
  assert.equal(validate('server', forwarded({ hostGen: -1 })).valid, false)
  assert.equal(validate('server', forwarded({ hostGen: 9007199254740992 })).valid, false)
  assert.equal(validate('server', forwarded({ hostGen: 1.5 })).valid, false)
})

test('AC1: the two directions do not leak into each other', () => {
  // The client form has no `from`: the server form is refused in the client
  // direction because `from` and `hostGen` are extra keys there.
  assert.equal(validate('client', forwarded()).valid, false, 'the server form is refused as a client message')
  assert.equal(validate('server', activate()).valid, false, 'and the client form is refused as a server message')
})

// ===========================================================================
// script-ready — DIRECTIONAL (Rev 1.2 N1)
// ===========================================================================

test('AC1/N1: script-ready is accepted from the client and refused from the server', () => {
  assert.equal(validate('client', ready()).valid, true)
  assert.equal(validate('server', ready()).valid, false,
    'script-ready is compiled :client only, so the server direction finds no schema')
})

test('AC1: script-ready needs hostGen, and refuses an extra key', () => {
  assert.equal(validate('client', { type: 'script-ready' }).valid, false)
  assert.equal(validate('client', ready({ node: 'Switch' })).valid, false)
  assert.equal(validate('client', ready({ hostGen: 0 })).valid, false)
  assert.equal(validate('client', ready({ hostGen: '3' })).valid, false)
})

test('AC1: the server never answers script-ready — it has no server form to answer with', () => {
  assert.equal(validate('server', { type: 'script-ready', hostGen: 1 }).valid, false)
})

// ===========================================================================
// error — NO_SCRIPT_HOST
// ===========================================================================

test('AC1: NO_SCRIPT_HOST is in the error enum, with the usual error shape', () => {
  assert.equal(validate('server', {
    type: 'error', code: 'NO_SCRIPT_HOST', message: "nothing runs here while the world's owner is away", seq: 7,
  }).valid, true)
  assert.equal(validate('server', {
    type: 'error', code: 'NOT_A_CODE', message: 'x',
  }).valid, false, 'the enum is still closed')
})

test('AC1: an error still carries no extra keys', () => {
  assert.equal(validate('server', {
    type: 'error', code: 'NO_SCRIPT_HOST', message: 'x', hostGen: 1,
  }).valid, false)
})
