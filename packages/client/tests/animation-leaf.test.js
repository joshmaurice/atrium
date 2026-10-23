// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// animation-leaf — scripting-4a step 2, Z2a: sending the leaf from the client.
//
// `setModelAnimation` follows the rename pattern (P11): it sends an explicit
// `send` with the field and tracks the pending edit; NOTHING changes locally
// until the answer. The own echo is matched by `requestSeq` — never by value —
// and is the ONE case besides a rename that re-applies a value locally, because
// the server stamps a Play's `startedAt` (L5 (b)) and the broadcast's value is
// therefore not the one the client sent.
//
// Real SOMDocuments; a mock WebSocket injects the answers deterministically.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { AtriumClient, MODEL_ANIMATION_FIELD } from '../src/AtriumClient.js'

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

const MODEL_URL = 'https://cdn.example.com/walker.glb'
const SENT = { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 }
const STAMPED = { ...SENT, startedAt: 1700000123456 }

/** A SOMDocument with one model node. */
function makeModelSOM() {
  const doc = new Document()
  doc.createScene('Scene').addChild(
    doc.createNode('Model').setExtras({ atrium: { model: { url: MODEL_URL } } }))
  return new SOMDocument(doc)
}

/** A connected client with a mock socket and a pre-built SOM. */
function makeClient({ world = null, ready = true } = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock')
  client._sessionId   = 'session-aabbccdd'
  client._displayName = 'User-sess'
  client._connected   = true
  client._worldReady  = ready
  client._som         = world ?? makeModelSOM()
  client._attachMutationListeners()
  return { client, mock: mocks[0] }
}

const animationOf = (client, name) => client.som.getNodeByName(name).extras.atrium.animation

// ===========================================================================
// Z2a — the send
// ===========================================================================

test('Z2a: setModelAnimation sends the exact message and tracks the pending edit', () => {
  const { client, mock } = makeClient()
  const seq = client.setModelAnimation('Model', SENT)

  assert.equal(typeof seq, 'number')
  assert.deepEqual(mock.sent.at(-1), {
    type: 'send', seq, node: 'Model', field: MODEL_ANIMATION_FIELD, value: SENT,
  }, 'the message is the rename pattern’s, with the leaf as the field')
  assert.equal(client.lastSendSeq, seq, 'lastSendSeq records it')

  const pending = client._connectionRecord.pendingEdits.get(seq)
  assert.deepEqual(pending, { type: 'send', node: 'Model', field: MODEL_ANIMATION_FIELD, value: SENT })
})

test('Z2a: nothing changes locally until the answer', () => {
  const { client } = makeClient()
  client.setModelAnimation('Model', SENT)
  assert.equal(animationOf(client, 'Model'), undefined, 'the SOM is untouched while the answer is out')
})

test('Z2a: the echo applies the BROADCAST value, not the sent one (a stamped startedAt)', () => {
  const { client, mock } = makeClient()
  const seen = []
  client.on('som:set', (e) => seen.push(e))
  const accepted = []
  client.on('edit:accepted', (e) => accepted.push(e))

  const seq = client.setModelAnimation('Model', SENT)
  assert.equal(animationOf(client, 'Model'), undefined, 'still nothing')

  mock.simulateMessage({
    type: 'set', seq: 900, node: 'Model', field: MODEL_ANIMATION_FIELD, value: STAMPED,
    serverTime: 1700000123457, session: client._sessionId, requestSeq: seq,
  })

  assert.deepEqual(animationOf(client, 'Model'), STAMPED,
    'the broadcast value landed — a value comparison against the sent one would never have matched')
  assert.equal(animationOf(client, 'Model').startedAt, STAMPED.startedAt, 'the stamp survived')
  assert.equal(seen.length, 1, 'som:set is emitted once')
  assert.equal(seen[0].nodeName, 'Model')
  assert.equal(seen[0].path, MODEL_ANIMATION_FIELD)
  assert.deepEqual(seen[0].value, STAMPED, 'with the broadcast value')
  assert.equal(accepted.length, 1, 'and the pending edit resolves')
  assert.equal(accepted[0].seq, seq)
})

test('Z2a: another field’s own echo is still NOT re-applied', () => {
  const { client, mock } = makeClient()
  client.som.getNodeByName('Model').translation = [0, 0, 0]
  const seq = mock.sent.at(-1).seq
  // The server would send the value it stored; the client keeps its own (A3).
  mock.simulateMessage({
    type: 'set', seq: 901, node: 'Model', field: 'translation', value: [9, 9, 9],
    serverTime: 1, session: client._sessionId, requestSeq: seq,
  })
  assert.deepEqual([...client.som.getNodeByName('Model').translation], [0, 0, 0],
    'a translation’s own echo does not touch the SOM')
})

test('Z2a: a rejection changes nothing', () => {
  const { client, mock } = makeClient()
  const rejected = []
  client.on('edit:rejected', (e) => rejected.push(e))

  const seq = client.setModelAnimation('Model', { ...SENT, speed: 0 })
  mock.simulateMessage({ type: 'error', seq, code: 'INVALID_VALUE', message: 'speed must be a number from 0.1 to 10' })

  assert.equal(rejected.length, 1, 'the pending edit resolves as rejected')
  assert.equal(rejected[0].code, 'INVALID_VALUE')
  assert.equal(animationOf(client, 'Model'), undefined, 'nothing was applied')
})

test('Z2a: an unknown answer changes nothing', () => {
  const { client } = makeClient()
  const unknown = []
  client.on('edit:unknown', (e) => unknown.push(e))
  client.setModelAnimation('Model', SENT)
  client.disconnect()
  assert.equal(unknown.length, 1, 'a disconnect resolves the pending edit as unknown')
  assert.equal(animationOf(client, 'Model'), undefined, 'nothing was applied')
})

test('Z2a: another session’s set of the leaf is applied through setPath', () => {
  const { client, mock } = makeClient()
  const seen = []
  client.on('som:set', (e) => seen.push(e))

  mock.simulateMessage({
    type: 'set', seq: 902, node: 'Model', field: MODEL_ANIMATION_FIELD, value: STAMPED,
    serverTime: 1, session: 'session-someone-else', requestSeq: undefined,
  })

  assert.deepEqual(animationOf(client, 'Model'), STAMPED, 'a peer’s play reaches this viewer')
  assert.equal(seen.at(-1).path, MODEL_ANIMATION_FIELD)
})

test('Z2a: setModelAnimation throws “World not loaded” before a world is ready', () => {
  const { client } = makeClient({ ready: false })
  assert.throws(() => client.setModelAnimation('Model', SENT), /World not loaded/)
})
