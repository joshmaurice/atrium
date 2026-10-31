// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// runner-overlay.test.js — scripting-4d-1 G4/G-L6 and G5, end to end: the REAL
// `AtriumClient`, on a mock socket, driving the REAL behavior runner.
//
// `@atrium/behaviors` depends on neither the client nor `@gltf-transform/core`,
// so the one test that needs both lives here, importing the runner by path —
// exactly as 4c's `activate.test.js` does.
//
// What it proves: the overlay (G-L6) clears on the answers the CLIENT really
// emits. The own echo is matched by `requestSeq` (G5's `origin: 'own'`), a
// remote set wins over anything this host has not sent (`origin: 'remote'`), and
// a `canSend()` that is false drops the entry and lets the read fall back to the
// SOM. `canSend()` itself is the client's own step; a client that does not have
// it yet is treated as sendable, which is why the last test supplies one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { AtriumClient } from '../src/AtriumClient.js'
import { createBehaviorRunner } from '../../behaviors/src/runner.js'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const KEY = `${OWN}|node|translation`

class MockWebSocket {
  constructor() {
    this.readyState = 1
    this.sent = []
    this._handlers = {}
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
}

function setup({ canSend = null } = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock')
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('Crate').setExtras({ atrium: { objectId: OWN } }))
  scene.addChild(doc.createNode('Target').setExtras({ atrium: { objectId: TGT } }))
  client._som = new SOMDocument(doc)
  client._sessionId = 'session-aaaa'
  client._connected = true
  client._worldReady = true
  client.canEdit = true
  client.scriptHost = { active: true, hostGen: 1 }
  client._attachMutationListeners()
  if (canSend) client.canSend = canSend

  const clock = { value: 0 }
  const runner = createBehaviorRunner({
    client,
    now: () => clock.value,
    position: () => [0, 0, 0],
  })
  client.emit('world:loaded', { name: 'w' })
  client.emit('script-host:changed', { active: true, hostGen: 1 })
  return { client, runner, mock: mocks[0], clock }
}

test('G-L6: send v1, queue v2, the client\'s own echo and edit:accepted for v1 keep v2', () => {
  const { client, runner, mock } = setup()

  runner.enqueue(OWN, 'node', 'translation', [1, 0, 0])
  runner.tick()
  const seq1 = client.lastSendSeq
  assert.equal(typeof seq1, 'number', 'v1 went out through the real client')
  assert.equal(mock.sent.filter((m) => m.type === 'send').length, 1)

  runner.enqueue(OWN, 'node', 'translation', [2, 0, 0])
  assert.equal(runner.overlay.get(KEY).value[0], 2, 'v2 is the latest write')
  assert.equal(runner.overlay.get(KEY).revision, 2)

  // The client's own echo for v1, then the accepted answer for v1.
  mock.simulateMessage({
    type: 'set', seq: 900, node: 'Crate', field: 'translation', value: [1, 0, 0],
    serverTime: 1700000000000, session: client._sessionId, requestSeq: seq1,
  })
  mock.simulateMessage({ type: 'edit-accepted', seq: seq1, requestSeq: seq1 })

  assert.equal(runner.overlay.get(KEY)?.value[0], 2, 'an older seq\'s answers kept v2')
})

test('G-L6: the own echo for the key\'s LATEST revision clears it', () => {
  const { client, runner, mock } = setup()
  runner.enqueue(OWN, 'node', 'translation', [3, 0, 0])
  runner.tick()
  const seq = client.lastSendSeq
  assert.equal(runner.overlay.get(KEY).sentSeq, seq)

  mock.simulateMessage({
    type: 'set', seq: 901, node: 'Crate', field: 'translation', value: [3, 0, 0],
    serverTime: 1700000000000, session: client._sessionId, requestSeq: seq,
  })
  assert.equal(runner.overlay.has(KEY), false, 'the read falls back to the SOM')
})

test('G-L6: a remote som:set wins, and drops the queued write', () => {
  const { client, runner } = setup()
  runner.enqueue(OWN, 'node', 'translation', [1, 0, 0])
  assert.equal(runner.queue.size, 1)
  client.emit('som:set', { nodeName: 'Crate', path: 'translation', value: [9, 9, 9], origin: 'remote' })
  assert.equal(runner.overlay.has(KEY), false)
  assert.equal(runner.queue.size, 0, 'the blocked write went with it')
})

test('G4: a canSend() that is false drops the entry and falls back to the SOM', () => {
  const { client, runner } = setup({ canSend: () => false })
  runner.enqueue(OWN, 'node', 'translation', [1, 0, 0])
  assert.equal(runner.overlay.size, 1)

  assert.doesNotThrow(() => runner.tick())
  assert.equal(runner.overlay.size, 0, 'the entry was cleared in the same opportunity')
  assert.equal(runner.queue.size, 0)
  assert.equal(client.lastSendSeq ?? null, null, 'nothing was sent')
  assert.equal(runner.log.filter((l) => l.message.includes('dropped')).length, 1)
})

test('G4: a CLOSING socket stops the send, exactly as `sendField` would', () => {
  // The real conditions `canSend()` reports (G5): the world loaded AND the
  // socket open. Here the socket is closing, so a send would be dropped.
  const { client, runner, mock, clock } = setup({ canSend: () => client._worldReady === true && mock.readyState === 1 })
  runner.enqueue(OWN, 'node', 'translation', [1, 0, 0])
  runner.tick()
  assert.equal(mock.sent.filter((m) => m.type === 'send').length, 1, 'the first send went')
  assert.equal(runner.overlay.get(KEY)?.sentSeq, client.lastSendSeq, 'and its entry is in flight')

  runner.enqueue(OWN, 'node', 'translation', [2, 0, 0])
  mock.readyState = 2   // CLOSING
  clock.value += 50
  runner.tick()
  assert.equal(runner.overlay.has(KEY), false, 'the unsent value is not kept')
  assert.equal(mock.sent.filter((m) => m.type === 'send').length, 1, 'and nothing more went out')
})
