// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// script-host.test.js — scripting-4b-1 step 3, E6: the client's role state.
//
// `client.scriptHost` is set ONLY from the server's `hello` and `script-host`
// messages; the client never decides the role itself. Losing the role is
// signalled SYNCHRONOUSLY, before anything else on the path that abandons the
// connection (review M4), and the sender's own echo of the set-once id leaf is
// applied from the broadcast (review S-A).
//
// A mock WebSocket injects the answers deterministically.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { AtriumClient, OBJECT_ID_FIELD } from '../src/AtriumClient.js'

const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

class MockWebSocket {
  constructor() {
    this.readyState = 1   // OPEN
    this.sent       = []
    this._handlers  = {}
    this.closed     = false
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data)    { this.sent.push(JSON.parse(data)) }
  close()       { this.closed = true; this.readyState = 3 }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
  simulateClose(code = 1000) { this.readyState = 3; this._fire('close', code, '') }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function makeSom() {
  const doc = new Document()
  doc.createScene('Scene').addChild(doc.createNode('Floor'))
  return new SOMDocument(doc)
}

/** A connected client with mock sockets. `mocks[0]` is the first connection. */
function makeClient({ connectTimeout = 0 } = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout,
  })
  client.connect('ws://mock')
  client._sessionId   = 'session-aabbccdd'
  client._displayName = 'User-sess'
  return { client, mocks }
}

/** A server `hello`, scriptHost false unless said otherwise. */
function hello(extra = {}) {
  return {
    type: 'hello', id: 'session-aabbccdd', seq: 1, serverTime: 1000,
    avatarNodeName: 'avatar-aaaa', displayName: 'User-sess',
    canEdit: true, scriptHost: false, ...extra,
  }
}

// ===========================================================================
// The role from `hello`
// ===========================================================================

test('E6: scriptHost comes from hello, and hello emits script-host:changed', () => {
  const { client, mocks } = makeClient()
  const events = []
  client.on('script-host:changed', (e) => events.push(e))

  mocks[0].simulateMessage(hello({ scriptHost: true, hostGen: 3 }))

  assert.deepEqual(client.scriptHost, { active: true, hostGen: 3 })
  assert.equal(client.canEdit, true, 'canEdit is set from the same hello')
  assert.deepEqual(events, [{ active: true, hostGen: 3 }], 'one event, after canEdit')
})

test('E6: a hello without the role is inactive, with no hostGen', () => {
  const { client, mocks } = makeClient()
  const events = []
  client.on('script-host:changed', (e) => events.push(e))

  mocks[0].simulateMessage(hello())

  assert.deepEqual(client.scriptHost, { active: false, hostGen: null })
  assert.deepEqual(events, [{ active: false, hostGen: null }])
})

test('E6: a malformed hello role is treated as inactive', () => {
  const cases = [
    { scriptHost: true },                       // no hostGen
    { scriptHost: true, hostGen: 0 },           // out of range
    { scriptHost: true, hostGen: 1.5 },         // not an integer
    { scriptHost: true, hostGen: '1' },         // not a number
    { scriptHost: false, hostGen: 2 },          // forbidden when false
    { scriptHost: 'yes' },                      // not a boolean
  ]
  for (const extra of cases) {
    const { client, mocks } = makeClient()
    mocks[0].simulateMessage(hello(extra))
    assert.deepEqual(client.scriptHost, { active: false, hostGen: null },
      `${JSON.stringify(extra)} must be inactive`)
  }
})

test('E6: a hello with no scriptHost at all is treated as inactive', () => {
  const { client, mocks } = makeClient()
  const msg = hello()
  delete msg.scriptHost
  mocks[0].simulateMessage(msg)
  assert.deepEqual(client.scriptHost, { active: false, hostGen: null })
})

// ===========================================================================
// script-host messages and the per-connection generations
// ===========================================================================

test('E6: a script-host message sets the role and emits', () => {
  const { client, mocks } = makeClient()
  mocks[0].simulateMessage(hello())
  const events = []
  client.on('script-host:changed', (e) => events.push(e))

  mocks[0].simulateMessage({ type: 'script-host', active: true, hostGen: 2 })

  assert.deepEqual(client.scriptHost, { active: true, hostGen: 2 })
  assert.deepEqual(events, [{ active: true, hostGen: 2 }])
})

test('E6: per connection, generations only increase', () => {
  const { client, mocks } = makeClient()
  const events = []
  client.on('script-host:changed', (e) => events.push(e))

  mocks[0].simulateMessage(hello({ scriptHost: true, hostGen: 2 }))
  assert.deepEqual(events.at(-1), { active: true, hostGen: 2 })

  // Not greater than any seen: ignored.
  mocks[0].simulateMessage({ type: 'script-host', active: true, hostGen: 2 })
  mocks[0].simulateMessage({ type: 'script-host', active: true, hostGen: 1 })
  assert.equal(events.length, 1, 'a stale assignment is ignored')
  assert.deepEqual(client.scriptHost, { active: true, hostGen: 2 })

  // Greater: accepted.
  mocks[0].simulateMessage({ type: 'script-host', active: true, hostGen: 3 })
  assert.deepEqual(client.scriptHost, { active: true, hostGen: 3 })

  // Below the current one: ignored.
  mocks[0].simulateMessage({ type: 'script-host', active: false, hostGen: 2 })
  assert.deepEqual(client.scriptHost, { active: true, hostGen: 3 }, 'the role survives a late revoke')

  // At least the current one: honoured.
  mocks[0].simulateMessage({ type: 'script-host', active: false, hostGen: 3 })
  assert.deepEqual(client.scriptHost, { active: false, hostGen: 3 })
  assert.equal(events.length, 3)

  // Malformed: ignored.
  mocks[0].simulateMessage({ type: 'script-host', active: 'yes', hostGen: 9 })
  mocks[0].simulateMessage({ type: 'script-host', active: false })
  mocks[0].simulateMessage({ type: 'script-host', active: true, hostGen: 0 })
  assert.equal(events.length, 3, 'no malformed message changed anything')
})

test('E6: the high-water mark is per connection — a new connection starts from zero', () => {
  const { client, mocks } = makeClient()
  mocks[0].simulateMessage(hello({ scriptHost: true, hostGen: 5 }))
  assert.deepEqual(client.scriptHost, { active: true, hostGen: 5 })

  client.connect('ws://mock-2')
  mocks[1].simulateMessage(hello())
  mocks[1].simulateMessage({ type: 'script-host', active: true, hostGen: 1 })
  assert.deepEqual(client.scriptHost, { active: true, hostGen: 1 },
    'generation 1 is fresh on a new connection')
})

// ===========================================================================
// E6 (M4) — losing the role, synchronously
// ===========================================================================

test('E6/M4: connect() superseding an active host signals BEFORE connecting', () => {
  const { client, mocks } = makeClient()
  mocks[0].simulateMessage(hello({ scriptHost: true, hostGen: 1 }))
  assert.equal(client.scriptHost.active, true)

  const order = []
  let canEditAtEvent = null
  client.on('script-host:changed', (e) => {
    order.push('script-host')
    canEditAtEvent = client.canEdit
    assert.deepEqual(e, { active: false, hostGen: null })
  })
  client.on('connecting', () => order.push('connecting'))

  client.connect('ws://mock-2')

  assert.deepEqual(order, ['script-host', 'connecting'], 'the signal fires first, synchronously')
  assert.equal(canEditAtEvent, false, 'canEdit is reset BEFORE the event (review N5)')
  assert.equal(client.scriptHost.active, false)
  assert.equal(client.canEdit, false)
})

test('E6/M4: disconnect() then an immediate connect() still signals, before the socket closes', () => {
  const { client, mocks } = makeClient()
  mocks[0].simulateMessage(hello({ scriptHost: true, hostGen: 1 }))

  const events = []
  let closedAtEvent = null
  client.on('script-host:changed', (e) => { events.push(e); closedAtEvent = mocks[0].closed })

  client.disconnect()
  client.connect('ws://mock-2')

  assert.deepEqual(events, [{ active: false, hostGen: null }],
    'exactly one signal — disconnect() released it, connect() found nothing to release')
  assert.equal(closedAtEvent, false, 'and it fired before the socket was closed')
})

test('E6/M4: a connect timeout signals, before the socket closes', () => {
  const { client, mocks } = makeClient({ connectTimeout: 15 })
  // A hello clears the timeout, so force the role to prove the path releases.
  client.scriptHost = { active: true, hostGen: 1 }
  client.canEdit = true

  const events = []
  let closedAtEvent = null
  client.on('script-host:changed', (e) => { events.push(e); closedAtEvent = mocks[0].closed })

  return delay(60).then(() => {
    assert.deepEqual(events, [{ active: false, hostGen: null }])
    assert.equal(closedAtEvent, false, 'released before the socket was closed')
    assert.equal(client.canEdit, false)
  })
})

test('E6/M4: the socket closing signals synchronously', () => {
  const { client, mocks } = makeClient()
  mocks[0].simulateMessage(hello({ scriptHost: true, hostGen: 4 }))
  assert.equal(client.scriptHost.active, true)

  const events = []
  client.on('script-host:changed', (e) => events.push(e))

  mocks[0].simulateClose(1006)

  assert.deepEqual(events, [{ active: false, hostGen: null }], 'a synchronous event on close')
  assert.equal(client.scriptHost.active, false)
  assert.equal(client.canEdit, false, 'canEdit is reset with it')
})

test('E6/M4: three rapid world switches signal loss each time', () => {
  const { client, mocks } = makeClient()
  const events = []
  client.on('script-host:changed', (e) => events.push(e.active))

  mocks[0].simulateMessage(hello({ scriptHost: true, hostGen: 1 }))
  client.connect('ws://mock-2')
  mocks[1].simulateMessage(hello({ scriptHost: true, hostGen: 2 }))
  client.connect('ws://mock-3')

  assert.deepEqual(events, [true, false, true, false])
})

test('E6: a delayed script-host for an old record is ignored', () => {
  const { client, mocks } = makeClient()
  client.connect('ws://mock-2')   // mocks[0] is superseded and stale

  const events = []
  client.on('script-host:changed', (e) => events.push(e))

  mocks[0].simulateMessage({ type: 'script-host', active: true, hostGen: 7 })

  assert.deepEqual(events, [], 'the stale record is dropped by dispatch’s guard')
  assert.equal(client.scriptHost.active, false)
})

test('E6: no event when the role was not active', () => {
  const { client, mocks } = makeClient()
  mocks[0].simulateMessage(hello())   // inactive
  const events = []
  client.on('script-host:changed', (e) => events.push(e))

  client.disconnect()
  client.connect('ws://mock-2')
  mocks[1].simulateMessage({ type: 'script-host', active: true, hostGen: 1 })
  assert.deepEqual(events, [{ active: true, hostGen: 1 }], 'only the new assignment was announced')
})

// ===========================================================================
// E6 (S-A) — setObjectId and the sender's own echo
// ===========================================================================

function connectedWithSom() {
  const { client, mocks } = makeClient()
  client._som        = makeSom()
  client._worldReady = true
  client._attachMutationListeners()
  return { client, mock: mocks[0] }
}

const idOf = (client) => client.som.getNodeByName('Floor').extras?.atrium?.objectId

test('E6: setObjectId sends the exact message and tracks the pending edit', () => {
  const { client, mock } = connectedWithSom()
  const seq = client.setObjectId('Floor', ID)

  assert.equal(typeof seq, 'number')
  assert.deepEqual(mock.sent.at(-1), {
    type: 'send', seq, node: 'Floor', field: OBJECT_ID_FIELD, value: ID,
  })
  assert.equal(client.lastSendSeq, seq)
  assert.deepEqual(client._connectionRecord.pendingEdits.get(seq),
    { type: 'send', node: 'Floor', field: OBJECT_ID_FIELD, value: ID })
  assert.equal(Object.hasOwn(client.som.getNodeByName('Floor').extras, 'atrium'), false,
    'nothing changes locally before the answer')
})

test('E6: the echo applies the BROADCAST value to the sender’s own SOM', () => {
  const { client, mock } = connectedWithSom()
  const seen = []
  const accepted = []
  client.on('som:set', (e) => seen.push(e))
  client.on('edit:accepted', (e) => accepted.push(e))

  const seq = client.setObjectId('Floor', ID)
  assert.equal(idOf(client), undefined, 'still nothing')

  mock.simulateMessage({
    type: 'set', seq: 900, node: 'Floor', field: OBJECT_ID_FIELD, value: ID,
    serverTime: 1001, session: client._sessionId, requestSeq: seq,
  })

  assert.equal(idOf(client), ID, 'the id reached the sender’s own SOM')
  assert.equal(seen.length, 1, 'som:set is emitted once')
  assert.equal(seen[0].nodeName, 'Floor')
  assert.equal(seen[0].path, OBJECT_ID_FIELD)
  assert.equal(seen[0].value, ID)
  assert.equal(accepted.length, 1, 'and the pending edit resolves')
  assert.equal(accepted[0].seq, seq)
})

test('E6: a rejection changes nothing', () => {
  const { client, mock } = connectedWithSom()
  const rejected = []
  client.on('edit:rejected', (e) => rejected.push(e))

  const seq = client.setObjectId('Floor', ID)
  mock.simulateMessage({ type: 'error', code: 'INVALID_VALUE', message: 'no', seq })

  assert.equal(idOf(client), undefined, 'the local SOM is untouched')
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].code, 'INVALID_VALUE')
})

test('E6: setObjectId requires a loaded world', () => {
  const { client } = connectedWithSom()
  client._worldReady = false
  assert.throws(() => client.setObjectId('Floor', ID), /World not loaded/)
})
