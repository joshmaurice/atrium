// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// copy-objects-hello.test.js — copy-objects K1, the client's half.
//
// `AtriumClient` keeps `hello.world` as `client.world`, checked FIELD BY FIELD
// against the credit's forms (another server can send anything): a bad
// `world.id` makes `client.world` null; a bad `owner.id` drops `owner`; a bad
// `owner.name` drops `name` alone. It resets `client.world` wherever
// `signedIn` is reset (connect, close, connect timeout, disconnect).
//
// The forms are the SHARED file's (tests/fixtures/credit-vectors.json).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AtriumClient, worldFromHello, worldIdFormOk, worldNameFormOk } from '../src/AtriumClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/credit-vectors.json'), 'utf8'))

class MockWebSocket {
  constructor() { this.readyState = 1; this.sent = []; this._handlers = {}; this.closed = false }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data)    { this.sent.push(JSON.parse(data)) }
  close()       { this.closed = true; this.readyState = 3 }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
  simulateClose(code = 1000) { this.readyState = 3; this._fire('close', code, '') }
}

function makeClient(opts = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0, ...opts,
  })
  return { client, mocks }
}

function hello(extra = {}) {
  return {
    type: 'hello', id: 'session-aabbccdd', seq: 1, serverTime: 1000,
    avatarNodeName: 'avatar-aaaa', displayName: 'User-sess',
    canEdit: false, scriptHost: false, signedIn: false, ...extra,
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

test('the shared forms: id and name', () => {
  const forms = VECTORS.forms.filter((f) => f.form === 'id' || f.form === 'name')
  assert.ok(forms.length >= 20)
  for (const f of forms) {
    const check = f.form === 'id' ? worldIdFormOk : worldNameFormOk
    assert.equal(check(f.value), f.ok, `${f.form} ${f.label}`)
  }
})

test('worldFromHello, field by field', () => {
  assert.deepEqual(worldFromHello({ id: 'w-1', owner: { id: 'u-1', name: 'commonskeeper' } }),
    { id: 'w-1', owner: { id: 'u-1', name: 'commonskeeper' } })
  assert.deepEqual(worldFromHello({ id: 'default' }), { id: 'default' }, 'a file world: no owner')
  assert.deepEqual(worldFromHello({ id: 'w-1', owner: { id: 'user-a' } }), { id: 'w-1', owner: { id: 'user-a' } },
    'an owner with no name')
  // a bad name drops the name alone
  assert.deepEqual(worldFromHello({ id: 'w-1', owner: { id: 'u-1', name: 'ali‮ce' } }), { id: 'w-1', owner: { id: 'u-1' } })
  assert.deepEqual(worldFromHello({ id: 'w-1', owner: { id: 'u-1', name: 'n'.repeat(65) } }), { id: 'w-1', owner: { id: 'u-1' } })
  assert.deepEqual(worldFromHello({ id: 'w-1', owner: { id: 'u-1', name: 7 } }), { id: 'w-1', owner: { id: 'u-1' } })
  // a bad owner id drops the owner
  assert.deepEqual(worldFromHello({ id: 'w-1', owner: { id: 'u 1', name: 'alice' } }), { id: 'w-1' })
  assert.deepEqual(worldFromHello({ id: 'w-1', owner: 'u-1' }), { id: 'w-1' })
  assert.deepEqual(worldFromHello({ id: 'w-1', owner: null }), { id: 'w-1' })
  // a bad world id: null
  for (const v of [undefined, null, 'w-1', [], {}, { id: '' }, { id: 'w'.repeat(129) }, { id: 'a\nb' }, { id: 3 }]) {
    assert.equal(worldFromHello(v), null, JSON.stringify(v))
  }
  // only the known fields are kept
  const w = worldFromHello({ id: 'w-1', extra: 'x', owner: { id: 'u-1', name: 'a', email: 'e' } })
  assert.deepEqual(w, { id: 'w-1', owner: { id: 'u-1', name: 'a' } })
})

test('a hello with world sets client.world; one without leaves it null', () => {
  const { client, mocks } = makeClient()
  assert.equal(client.world, null, 'null before any connection')
  client.connect('ws://a')
  mocks[0].simulateMessage(hello({ world: { id: 'w-a', owner: { id: 'u-a', name: 'alice' } } }))
  assert.deepEqual(client.world, { id: 'w-a', owner: { id: 'u-a', name: 'alice' } })

  client.connect('ws://b')
  assert.equal(client.world, null, 'reset at connect')
  mocks[1].simulateMessage(hello())
  assert.equal(client.world, null, 'an older or another server: null, never inherited')
})

test('a bad world.id from another server gives client.world === null', () => {
  const { client, mocks } = makeClient()
  client.connect('ws://evil')
  mocks[0].simulateMessage(hello({ world: { id: '<script>', owner: { id: 'u', name: 'x' } } }))
  // '<script>' is in the id form (no character below U+0021); a space isn't.
  assert.deepEqual(client.world, { id: '<script>', owner: { id: 'u', name: 'x' } })
  client.connect('ws://evil')
  mocks[1].simulateMessage(hello({ world: { id: 'a b' } }))
  assert.equal(client.world, null)
})

test('client.world is reset when the socket closes', async () => {
  const { client, mocks } = makeClient()
  client.connect('ws://a')
  mocks[0].simulateMessage(hello({ world: { id: 'w-a' } }))
  await settle()
  assert.deepEqual(client.world, { id: 'w-a' })
  mocks[0].simulateClose(1006)
  assert.equal(client.world, null)
})

test('client.world is reset by disconnect()', async () => {
  const { client, mocks } = makeClient()
  client.connect('ws://a')
  mocks[0].simulateMessage(hello({ world: { id: 'w-a' } }))
  await settle()
  assert.deepEqual(client.world, { id: 'w-a' })
  client.disconnect()
  assert.equal(client.world, null)
})

test('client.world is reset by a connect timeout', async () => {
  const { client, mocks } = makeClient({ connectTimeout: 20 })
  client.on('error', () => {})
  client.connect('ws://a')
  // A hello sets the world, but the timer only stops once the world is ready;
  // force the timeout path by never sending world-done.
  client.world = { id: 'stale' }
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(mocks.length, 1)
  assert.equal(client.world, null)
})
