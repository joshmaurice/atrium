// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// signin-sync.test.js — the client package's half of the signin-sync round
// (brief §6.3, including Rev 1's S3: one client, two servers).
//
// `AtriumClient` keeps `signedIn` and `userId` from `hello`, resets both on
// EVERY new connection, and adds them to `session:ready`'s payload.
//
// A `hello` without them means UNKNOWN (`undefined`), never `false`, and it is
// never inherited from an earlier connection.
//
// A mock WebSocket injects the answers deterministically.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AtriumClient } from '../src/AtriumClient.js'

class MockWebSocket {
  constructor() {
    this.readyState = 1   // OPEN
    this.sent       = []
    this._handlers  = {}
    this.closed     = false
    // Resolve the pre-open promise the client may keep.
    this._opened    = null
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data)    { this.sent.push(JSON.parse(data)) }
  close()       { this.closed = true; this.readyState = 3 }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
  simulateClose(code = 1000) { this.readyState = 3; this._fire('close', code, '') }
}

/** A client whose sockets are mock instances, in connection order. */
function makeClient() {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  return { client, mocks }
}

/** A server hello. `signedIn`/`userId` are up to the caller. */
function hello(extra = {}) {
  return {
    type: 'hello', id: 'session-aabbccdd', seq: 1, serverTime: 1000,
    avatarNodeName: 'avatar-aaaa', displayName: 'User-sess',
    canEdit: false, scriptHost: false, ...extra,
  }
}

/** An older/another server: no `signedIn` and no `userId` at all. */
function helloWithoutAuthFields(extra = {}) {
  const msg = hello(extra)
  delete msg.signedIn
  delete msg.userId
  return msg
}

function captureSessionReady(client) {
  const events = []
  client.on('session:ready', (e) => events.push(e))
  return events
}

test('§6.3 a hello with signedIn and userId is readable and reaches session:ready', () => {
  const { client, mocks } = makeClient()
  const events = captureSessionReady(client)
  client.connect('ws://mock')

  mocks[0].simulateMessage(hello({ signedIn: true, userId: 'user-alice' }))

  assert.equal(client.signedIn, true)
  assert.equal(client.userId, 'user-alice')
  assert.equal(events.length, 1, 'one session:ready')
  assert.equal(events[0].signedIn, true)
  assert.equal(events[0].userId, 'user-alice')
})

test('§6.3 signedIn false is reported as false, with no userId', () => {
  const { client, mocks } = makeClient()
  const events = captureSessionReady(client)
  client.connect('ws://mock')

  mocks[0].simulateMessage(hello({ signedIn: false }))

  assert.equal(client.signedIn, false, 'false is a real answer, not unknown')
  assert.equal(client.userId, undefined)
  assert.equal(events[0].signedIn, false)
  assert.equal(events[0].userId, undefined)
})

test('§6.3 a hello without them is unknown (undefined), never false', () => {
  const { client, mocks } = makeClient()
  const events = captureSessionReady(client)
  client.connect('ws://mock')

  mocks[0].simulateMessage(helloWithoutAuthFields())

  assert.equal(client.signedIn, undefined, 'unknown, not false')
  assert.notEqual(client.signedIn, false)
  assert.equal(client.userId, undefined)
  assert.equal(events[0].signedIn, undefined)
  assert.notEqual(events[0].signedIn, false)
  assert.equal(events[0].userId, undefined)
})

test('§6.3 (S3) one client, two servers: the second connection never keeps the first identity', () => {
  const { client, mocks } = makeClient()
  const events = captureSessionReady(client)

  client.connect('ws://server-a')
  mocks[0].simulateMessage(hello({ signedIn: true, userId: 'user-alice' }))
  assert.equal(client.userId, 'user-alice')

  client.connect('ws://server-b')
  mocks[1].simulateMessage(helloWithoutAuthFields())

  assert.equal(events.length, 2)
  assert.equal(client.signedIn, undefined, 'the first connection’s true is not kept')
  assert.equal(client.userId, undefined, 'the first connection’s userId is not kept')
  assert.equal(events[1].signedIn, undefined)
  assert.equal(events[1].userId, undefined)
})

test('§6.3 (S3) and the other way round: older server first, signed-in server second', () => {
  const { client, mocks } = makeClient()
  const events = captureSessionReady(client)

  client.connect('ws://server-b')
  mocks[0].simulateMessage(helloWithoutAuthFields())
  assert.equal(client.signedIn, undefined)

  client.connect('ws://server-a')
  mocks[1].simulateMessage(hello({ signedIn: true, userId: 'user-bob' }))

  assert.equal(events.length, 2)
  assert.equal(client.signedIn, true)
  assert.equal(client.userId, 'user-bob')
  assert.equal(events[1].signedIn, true)
  assert.equal(events[1].userId, 'user-bob')
})

test('§6.3 (S3) signedIn false followed by an older server still reports unknown', () => {
  const { client, mocks } = makeClient()
  const events = captureSessionReady(client)

  client.connect('ws://server-a')
  mocks[0].simulateMessage(hello({ signedIn: false }))
  assert.equal(client.signedIn, false)

  client.connect('ws://server-b')
  mocks[1].simulateMessage(helloWithoutAuthFields())

  assert.equal(client.signedIn, undefined, 'unknown after the older server, not the earlier false')
  assert.notEqual(client.signedIn, false)
  assert.equal(events[1].signedIn, undefined)
  assert.notEqual(events[1].signedIn, false)
})
