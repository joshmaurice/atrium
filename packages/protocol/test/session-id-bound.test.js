// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// session-id-bound.test.js — scripting-4c revision round 2, W1 and W2 (the
// outside review's M1 and S1). The protocol half of the bound:
//
//   - W1: `hello.client.json`'s `id` is 1–64 characters of [A-Za-z0-9_-].
//   - W2: `activate.server.json`'s `from` carries the SAME bound, because it is
//     the sender's `hello` id copied into the forward.
//
// The bound is what keeps a visitor's id out of every log line, out of the
// forwarded frame and out of the avatar node's name. It is a character-set rule
// as well as a length rule: the schema refuses every control character, space,
// quote and escape, so nothing can be smuggled into a line that is logged.
//
// `from` is for the log line only (the operator's pin 1) — it is never identity
// or authority.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validate } from '../src/index.js'

const hello = (id) => ({ type: 'hello', id })
const forwarded = (from) => ({ type: 'activate', seq: 7, node: 'Switch', event: 'select', from, hostGen: 3 })

// ===========================================================================
// W1 — the hello id
// ===========================================================================

test('W1: the bound is 1–64 characters of [A-Za-z0-9_-]', () => {
  assert.equal(validate('client', hello('a')).valid, true, 'one character is enough')
  assert.equal(validate('client', hello('a'.repeat(64))).valid, true, '64 is allowed')
  assert.equal(validate('client', hello('a'.repeat(65))).valid, false, '65 is refused')

  // Every character class the bound admits, and a real 36-character UUID (what
  // every client in the repository and at PROD actually sends).
  assert.equal(validate('client', hello('AZaz09_-')).valid, true)
  assert.equal(validate('client', hello('a-36-character-uuid-like-id_01')).valid, true)
  assert.equal(validate('client', hello('11111111-1111-4111-8111-111111111111')).valid, true)
})

test('W1: an id over the bound, or with a character outside it, is refused', () => {
  for (const bad of [
    'a'.repeat(65),
    'x\u001b\u001by',
    'x\n\u001b[31m',
    'has a space',
    'a"b',
    'a/b',
    'a\\b',
    'a.b',
    'a\u007fb',
    'a\u0000b',
  ]) {
    assert.equal(validate('client', hello(bad)).valid, false,
      `${JSON.stringify(bad)} must be refused`)
  }
})

test('W1: the empty id is still refused (the bound keeps minLength 1)', () => {
  assert.equal(validate('client', hello('')).valid, false)
})

test('W1: nothing else about hello changed — the other fields are untouched', () => {
  assert.equal(validate('client', hello('h1')).valid, true)
  assert.equal(validate('client', { type: 'hello', id: 'h1', ticket: 't' }).valid, true)
  assert.equal(validate('client', { type: 'hello', id: 'h1', displayName: 'n' }).valid, true)
  assert.equal(validate('client', {
    type: 'hello', id: 'h1', capabilities: { tick: { interval: 5000 }, scriptRunner: 2 },
  }).valid, true)
  assert.equal(validate('client', { type: 'hello' }).valid, false, 'id is still required')
  assert.equal(validate('client', { type: 'hello', id: 'h1', extra: 1 }).valid, false,
    'the shape is still closed')
})

// ===========================================================================
// W2 — the forwarded `from`
// ===========================================================================

test('W2: from carries the same bound as the hello id', () => {
  assert.equal(validate('server', forwarded('a')).valid, true)
  assert.equal(validate('server', forwarded('a'.repeat(64))).valid, true, '64 is allowed')
  assert.equal(validate('server', forwarded('a'.repeat(65))).valid, false, '65 is refused')
  assert.equal(validate('server', forwarded('visitor-abcd1234')).valid, true)
  assert.equal(validate('server', forwarded('11111111-1111-4111-8111-111111111111')).valid, true)
})

test('W2: from with a control character, a space, a quote, an escape or a slash is refused', () => {
  for (const bad of [
    'a\nb',
    'x\u001b[31mFAKE',
    'has a space',
    'a"b',
    'a\\b',
    'a/b',
    'a.b',
  ]) {
    assert.equal(validate('server', forwarded(bad)).valid, false,
      `${JSON.stringify(bad)} must be refused`)
  }
  assert.equal(validate('server', forwarded('')).valid, false, 'the empty from is still refused')
})

test('W2: the rest of the server activate is unchanged', () => {
  assert.equal(validate('server', forwarded('visitor-1')).valid, true)
  assert.equal(validate('server', { type: 'activate', seq: 1, node: 'S', event: 'select', from: 'v', hostGen: 1 }).valid, true)
  assert.equal(validate('server', { type: 'activate', seq: 1, node: 'S', event: 'select', hostGen: 1 }).valid, false,
    'from is still required')
})
