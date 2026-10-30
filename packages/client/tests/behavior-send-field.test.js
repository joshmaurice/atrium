// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-send-field.test.js — scripting-4b-2 F5 (the client half) and the
// F-L12 NIT carried from 4b-1.
//
// `sendField(name, field, value)` is the runner's send: a tracked `send` that
// applies NOTHING locally, and whose own echo applies THE BROADCAST'S value
// through `applyLocally` + `setPath`, then `som:set`, then `edit:accepted`. The
// Edit panel's apply-first path is untouched: its listeners do not set the
// `applyEcho` flag.
//
// The NIT: `_scriptHostRoleWarned` is once per CONNECTION, not once per page.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { AtriumClient } from '../src/AtriumClient.js'
import { validate } from '@atrium/protocol'

class MockWebSocket {
  constructor() {
    this.readyState = 1   // OPEN
    this.sent       = []
    this._handlers  = {}
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data)    { this.sent.push(JSON.parse(data)) }
  close()       { this.readyState = 3 }
  _fire(event, ...args) {
    for (const fn of this._handlers[event] ?? []) fn(...args)
  }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
}

const FIELD = 'extras.atrium.behavior'

function makeSOM() {
  const doc = new Document()
  doc.createScene('Scene').addChild(
    doc.createNode('Crate').setExtras({ atrium: { objectId: '11111111-1111-4111-8111-111111111111' } }))
  return new SOMDocument(doc)
}

function makeClient({ ready = true, connect = {} } = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock', connect)
  client._sessionId   = 'session-aabbccdd'
  client._displayName = 'User-sess'
  client._connected   = true
  client._worldReady  = ready
  client._som         = makeSOM()
  return { client, mock: mocks[0] }
}

const VALUE = { kind: 'graph', enabled: true, origin: 'local' }

test('F5: sendField sends the exact message and tracks the pending edit', () => {
  const { client, mock } = makeClient()
  const seq = client.sendField('Crate', FIELD, VALUE)

  assert.equal(typeof seq, 'number')
  assert.deepEqual(mock.sent.at(-1), { type: 'send', seq, node: 'Crate', field: FIELD, value: VALUE })
  assert.equal(client.lastSendSeq, seq)
  const pending = client._connectionRecord.pendingEdits.get(seq)
  assert.equal(pending.applyEcho, true, 'the edit asks for its echo to be applied')
})

test('F5: sendField applies nothing locally before the answer', () => {
  const { client } = makeClient()
  client.sendField('Crate', FIELD, VALUE)
  assert.equal(client.som.getNodeByName('Crate').extras.atrium.behavior, undefined)
})

test('F5: the echo applies the BROADCAST value, then som:set, then edit:accepted', () => {
  const { client, mock } = makeClient()
  const order = []
  client.on('som:set', (e) => order.push(['som:set', e]))
  client.on('edit:accepted', (e) => order.push(['edit:accepted', e]))

  const seq = client.sendField('Crate', FIELD, VALUE)
  assert.equal(client.som.getNodeByName('Crate').extras.atrium.behavior, undefined, 'still nothing')

  const broadcast = { ...VALUE, enabled: false }
  mock.simulateMessage({
    type: 'set', seq: 900, node: 'Crate', field: FIELD, value: broadcast,
    serverTime: 1700000123457, session: client._sessionId, requestSeq: seq,
  })

  assert.deepEqual(client.som.getNodeByName('Crate').extras.atrium.behavior, broadcast,
    'the broadcast value landed, not the sent one')
  assert.deepEqual(order.map(([kind]) => kind), ['som:set', 'edit:accepted'])
  assert.equal(order[0][1].path, FIELD)
  assert.deepEqual(order[0][1].value, broadcast)
  assert.equal(order[1][1].seq, seq)
})

test('F5: a rejection changes nothing', () => {
  const { client, mock } = makeClient()
  const seq = client.sendField('Crate', FIELD, VALUE)
  mock.simulateMessage({ type: 'error', code: 'INVALID_VALUE', message: 'nope', seq })
  assert.equal(client.som.getNodeByName('Crate').extras.atrium.behavior, undefined,
    'the refused value is not applied')
})

test('F5: the Edit panel\'s apply-first path is untouched (no applyEcho on its edits)', () => {
  const { client, mock } = makeClient()
  // The panel assigns the SOM property and the mutation listener sends it.
  client._attachMutationListeners?.()
  const node = client.som.getNodeByName('Crate')
  node.visible = false
  const sent = mock.sent.filter((m) => m.type === 'send' && m.field === 'visible')
  assert.equal(sent.length, 1, 'the panel\'s path still sends')
  const pending = client._connectionRecord.pendingEdits.get(sent[0].seq)
  assert.equal(pending.applyEcho, undefined, 'and does not ask for its echo to be applied')
})

test('F5: sendField refuses before the world is loaded, exactly as the leaf methods do', () => {
  const { client } = makeClient({ ready: false })
  assert.throws(() => client.sendField('Crate', FIELD, VALUE), /World not loaded/)
})

test('F5/AC4: the hello declares scriptRunner only when the connect option asks, and then it is 2', () => {
  // scripting-4c S2/AC4 — 4b-2 hard-coded `scriptRunner: 1` into every hello.
  // 4c makes it an OPTION (default off), because a hello field older servers do
  // not know must only ride a same-origin connection (Rev 1.2 M1, P23): the
  // page sets it in the one place every connect goes through (`connectNow`).
  const asked = makeClient({ connect: { scriptRunner: true } })
  asked.mock._fire('open')
  const helloWith = asked.mock.sent.find((m) => m.type === 'hello')
  assert.equal(helloWith.capabilities.scriptRunner, 2)
  assert.equal(validate('client', helloWith).valid, true)

  const plain = makeClient()
  plain.mock._fire('open')
  const helloWithout = plain.mock.sent.find((m) => m.type === 'hello')
  assert.equal('scriptRunner' in helloWithout.capabilities, false, 'absent, not 0 and not 1')
  assert.equal(validate('client', helloWithout).valid, true)
})

test('F-L12 NIT: _scriptHostRoleWarned resets on a second connection', () => {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock')
  client._scriptHostRoleWarned = true
  client.connect('ws://mock-2')
  assert.equal(client._scriptHostRoleWarned, false, 'a new connection starts unwarned')
})
