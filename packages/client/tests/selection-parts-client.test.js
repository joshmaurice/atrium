// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// selection-parts T11 (PREBRIEF-selection-parts.md §4): `addNode` takes the
// parent a Duplicate in place and a part's re-add send. `parent` already
// travels on `add` both ways; the client API didn't expose it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { AtriumClient } from '../src/AtriumClient.js'

class MockWebSocket {
  constructor() { this.readyState = 1; this.sent = []; this._handlers = {} }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  simulateMessage(msg) { for (const fn of this._handlers.message ?? []) fn(JSON.stringify(msg)) }
}

function makeClient() {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock', {})
  const doc = new Document()
  const lamp = doc.createNode('lamp-01')
  lamp.addChild(doc.createNode('lamp-shade'))
  doc.createScene('Scene').addChild(lamp)
  Object.assign(client, { _sessionId: 'session-aabbccdd', _displayName: 'User-sess', _connected: true, _worldReady: true, _som: new SOMDocument(doc) })
  client._attachMutationListeners()
  return { client, mock: mocks[0] }
}
const adds = (mock) => mock.sent.filter((m) => m.type === 'add')

test('T11: addNode(d, { parent }) puts parent on the wire', () => {
  const { client, mock } = makeClient()
  const seq = client.addNode({ name: 'lamp-shade copy' }, { parent: 'lamp-01' })
  assert.deepEqual(adds(mock).at(-1), { type: 'add', seq, node: { name: 'lamp-shade copy' }, parent: 'lamp-01' })
})

test('T11: without parent, or with an empty or non-string one, the message is today’s', () => {
  const { client, mock } = makeClient()
  for (const opts of [undefined, {}, { parent: '' }, { parent: null }, { parent: 7 }]) {
    const seq = opts === undefined ? client.addNode({ name: 'x' }) : client.addNode({ name: 'x' }, opts)
    assert.deepEqual(adds(mock).at(-1), { type: 'add', seq, node: { name: 'x' } })
  }
})

test('T11: the echo of an add with parent lands under the parent, and resolves the pending add', () => {
  const { client, mock } = makeClient()
  const accepted = []
  client.on('edit:accepted', (e) => accepted.push(e.seq))
  const seq = client.addNode({ name: 'lamp-shade copy', translation: [1.5, 1.6, 0] }, { parent: 'lamp-01' })
  mock.simulateMessage({ type: 'add', seq: 900, session: 'session-aabbccdd', requestSeq: seq, node: { name: 'lamp-shade copy', translation: [1.5, 1.6, 0] }, parent: 'lamp-01' })
  assert.equal(client.som.getNodeByName('lamp-shade copy').parent, client.som.getNodeByName('lamp-01'))
  assert.deepEqual(accepted, [seq])
})
