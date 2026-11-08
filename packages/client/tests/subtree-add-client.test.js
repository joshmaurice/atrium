// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add T4 (devtasks/PREBRIEF-subtree-add.md FINAL Rev 2): the client's
// `_onAdd` ingests a tree as one message, attaches the mutation listeners to
// EVERY member, emits one `som:add` per member (the root first, each naming
// the root) before `edit:accepted`; `som:remove` carries `removed`, every
// member's name. The harness is edit-tracking.test.js's.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { AtriumClient } from '../src/AtriumClient.js'

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

/** A SOMDocument with a plain node 'Crate' (no mesh needed for these tests). */
function makeSOMDocument() {
  const doc = new Document()
  doc.createScene('Scene').addChild(doc.createNode('Crate'))
  return new SOMDocument(doc)
}

/**
 * Wire a client with a mock WebSocket and a pre-built SOM, bypassing the server
 * handshake. Every connect() gets a fresh mock, so connection-replacement tests
 * can drive the old and new sockets separately.
 */
function makeClient({ world = null, avatar = null } = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock', avatar ? { avatar } : {})
  client._sessionId   = 'session-aabbccdd'
  client._displayName = 'User-sess'
  client._connected   = true
  client._worldReady  = true
  client._som         = world ?? makeSOMDocument()
  client._attachMutationListeners()
  return { client, mocks, mock: mocks[0] }
}

const sentOfType = (mock, type) => mock.sent.filter(m => m.type === type)

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const TREE = {
  name: 'lamp',
  children: [
    { name: 'body', children: [{ name: 'shade', mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { name: 'Brass' } }] } }] },
    { name: 'stand', mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { ref: 0 } }] } },
  ],
}

test('T4: a tree arrives as one add: every member in the SOM, under its parent', () => {
  const { client, mock } = makeClient()
  mock.simulateMessage({ type: 'add', seq: 1, node: TREE })
  const lamp = client.som.getNodeByName('lamp')
  assert.ok(client.som.scene.children.includes(lamp))
  assert.deepEqual(lamp.children.map((n) => n.name), ['body', 'stand'])
  assert.deepEqual(client.som.getNodeByName('body').children.map((n) => n.name), ['shade'])
  const mat = (n) => client.som.getNodeByName(n)._node.getMesh().listPrimitives()[0].getMaterial()
  assert.ok(mat('shade') === mat('stand'), 'T12: one shared material') // `ok`: a failing `equal` would inspect the document graph
})

test('T4: one som:add per member, the root first, each naming the root, then edit:accepted', () => {
  const { client, mock } = makeClient()
  const events = []
  client.on('som:add', (e) => events.push(['som:add', e.nodeName, e.root, !!client.som.getNodeByName('stand')]))
  client.on('edit:accepted', (e) => events.push(['edit:accepted', e.seq]))
  const seq = client.addNode(TREE)
  mock.simulateMessage({ type: 'add', seq: 50, node: TREE, requestSeq: seq, session: client._sessionId })
  assert.deepEqual(events, [
    ['som:add', 'lamp', 'lamp', true],
    ['som:add', 'body', 'lamp', true],
    ['som:add', 'shade', 'lamp', true],
    ['som:add', 'stand', 'lamp', true],
    ['edit:accepted', seq],
  ], 'every member is in the SOM at the first event; message order; accepted last')
})

test('T4: a single node\u2019s som:add names itself as its root', () => {
  const { client, mock } = makeClient()
  const events = []
  client.on('som:add', (e) => events.push(e))
  mock.simulateMessage({ type: 'add', seq: 1, node: { name: 'Box' } })
  assert.deepEqual(events, [{ nodeName: 'Box', root: 'Box' }])
})

test('T4: listeners on every member: a part\u2019s edit sends', () => {
  const { client, mock } = makeClient()
  mock.simulateMessage({ type: 'add', seq: 1, node: TREE })
  client.som.getNodeByName('shade').translation = [0, 2, 0]
  const sends = sentOfType(mock, 'send')
  assert.equal(sends.length, 1)
  assert.equal(sends[0].node, 'shade')
  assert.equal(sends[0].field, 'translation')
})

test('T4 (the ChatGPT review N1): som:remove carries every removed member\u2019s name', () => {
  const { client, mock } = makeClient()
  mock.simulateMessage({ type: 'add', seq: 1, node: TREE })
  const events = []
  client.on('som:remove', (e) => events.push(e))
  mock.simulateMessage({ type: 'remove', seq: 2, node: 'lamp' })
  assert.equal(events.length, 1, 'one event, for the root')
  assert.equal(events[0].nodeName, 'lamp')
  assert.deepEqual(events[0].removed, ['lamp', 'body', 'shade', 'stand'])
  assert.equal(client.som.getNodeByName('shade'), null)
})

test('T3: a message the client can\u2019t ingest (a forward ref, from another server) changes nothing and emits som:desync', () => {
  const { client, mock } = makeClient()
  const desync = []
  client.on('som:desync', (e) => desync.push(e))
  mock.simulateMessage({ type: 'add', seq: 1, node: { name: 'bad', children: [{ name: 'bad-a', mesh: { primitives: [{ attributes: { POSITION: TRI }, material: { ref: 0 } }] } }] } })
  assert.equal(client.som.getNodeByName('bad'), null)
  assert.equal(client.som.checkNewName('bad-a').ok, true, 'no name left registered')
  assert.deepEqual(desync, [{ reason: 'add-not-ingested', node: 'bad' }])
})
