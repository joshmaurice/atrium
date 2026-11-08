// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add-hello.test.js — subtree-add T7 (devtasks/PREBRIEF-subtree-add.md
// FINAL Rev 2): `client.serverAddFields` is the server hello's
// `capabilities.addFields`, checked (an integer >= 1, else null), and reset
// wherever `client.world` is. The harness is copy-objects-hello.test.js's.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AtriumClient } from '../src/AtriumClient.js'


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


test('T7: serverAddFields is the server hello\u2019s capabilities.addFields', () => {
  const { client, mocks } = makeClient()
  assert.equal(client.serverAddFields, null, 'null before any connection')
  client.connect('ws://new')
  mocks[0].simulateMessage(hello({ capabilities: { tick: { interval: 1000, minInterval: 50 }, addFields: 3 } }))
  assert.equal(client.serverAddFields, 3, 'a new server')
  client.connect('ws://old')
  assert.equal(client.serverAddFields, null, 'reset at connect')
  mocks[1].simulateMessage(hello({ capabilities: { tick: { interval: 1000, minInterval: 50 } } }))
  assert.equal(client.serverAddFields, null, 'a 42aa56ff server sends none: null, never inherited')
})

test('T7: a malformed level from another server is null', () => {
  for (const bad of [0, -1, 2.5, '3', null, [], {}, true]) {
    const { client, mocks } = makeClient()
    client.connect('ws://evil')
    mocks[0].simulateMessage(hello({ capabilities: { addFields: bad } }))
    assert.equal(client.serverAddFields, null, JSON.stringify(bad))
  }
  const { client, mocks } = makeClient()
  client.connect('ws://later')
  mocks[0].simulateMessage(hello({ capabilities: { addFields: 4 } }))
  assert.equal(client.serverAddFields, 4, 'a later server\u2019s level is kept as sent')
})

test('T7: serverAddFields is reset when the socket closes and by disconnect()', async () => {
  const { client, mocks } = makeClient()
  client.connect('ws://a')
  mocks[0].simulateMessage(hello({ capabilities: { addFields: 3 } }))
  await settle()
  assert.equal(client.serverAddFields, 3)
  mocks[0].simulateClose(1006)
  assert.equal(client.serverAddFields, null)
  client.connect('ws://b')
  mocks[1].simulateMessage(hello({ capabilities: { addFields: 3 } }))
  await settle()
  client.disconnect()
  assert.equal(client.serverAddFields, null)
})

test('T7: a connect timeout resets serverAddFields', async () => {
  const { client, mocks } = makeClient({ connectTimeout: 20 })
  client.on('error', () => {})
  client.connect('ws://a')
  client.serverAddFields = 3
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(mocks.length, 1)
  assert.equal(client.serverAddFields, null)
})
