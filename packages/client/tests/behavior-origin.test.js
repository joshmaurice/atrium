// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-origin.test.js — scripting-4d-1 G5: `som:set` says where it CAME
// FROM (Rev 1, M2; P20).
//
// Every emit site of `som:set` carries `origin`: `'remote'` for another
// session's write, `'own'` with the `requestSeq` it answers for this tab's own
// echo. Without it a listener cannot tell the host's own write coming back from
// another session's write, and the runner's overlay (G-L6) cannot clear on the
// right answer. This is a LOCAL event change, not a wire change: existing
// listeners ignore the new keys.
//
// Six sites, driven through the REAL `AtriumClient` (a mock socket injects the
// messages deterministically):
//   1. a remote rename      (`_onSet`, field 'name')
//   2. a remote field set   (`_onSet`)
//   3. an own rename echo   (`_resolveOwnSetEcho`, field 'name')
//   4. an own animation echo (`_resolveOwnSetEcho`, the 4a leaf)
//   5. an own object-id echo (`_resolveOwnSetEcho`, the 4b-1 leaf)
//   6. an own generic echo  (`_resolveOwnSetEcho`, `applyEcho` — the runner's)
//
// The card's "the tests use the real `AtriumClient`'s events" is exactly this:
// no fake emits, every event is produced by the client from a real socket
// message.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Document } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { AtriumClient, MODEL_ANIMATION_FIELD } from '../src/AtriumClient.js'

const OBJECT_ID_FIELD = 'extras.atrium.objectId'

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
const SENT_ANIMATION = { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 }
const STAMPED_ANIMATION = { ...SENT_ANIMATION, startedAt: 1700000123456 }

function makeSOM() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(
    doc.createNode('Crate').setExtras({ atrium: { objectId: '11111111-1111-4111-8111-111111111111' } }))
  scene.addChild(
    doc.createNode('Model').setExtras({ atrium: { model: { url: MODEL_URL } } }))
  return new SOMDocument(doc)
}

function makeClient({ ready = true } = {}) {
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
  client._som         = makeSOM()
  client._attachMutationListeners()
  return { client, mock: mocks[0] }
}

/** Collect every `som:set` the client emits. */
function collecting(client) {
  const seen = []
  client.on('som:set', (event) => seen.push(event))
  return seen
}

// ===========================================================================
// The six sites
// ===========================================================================

test('G5: a REMOTE rename emits origin: "remote" and no requestSeq', () => {
  const { client, mock } = makeClient()
  const seen = collecting(client)
  mock.simulateMessage({ type: 'set', node: 'Crate', field: 'name', value: 'Crate-2', session: 'session-other' })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { nodeName: 'Crate', path: 'name', value: 'Crate-2', origin: 'remote' })
  assert.equal('requestSeq' in seen[0], false, 'a remote write answers nothing')
})

test('G5: a REMOTE field set emits origin: "remote"', () => {
  const { client, mock } = makeClient()
  const seen = collecting(client)
  mock.simulateMessage({ type: 'set', node: 'Crate', field: 'visible', value: false, session: 'session-other' })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { nodeName: 'Crate', path: 'visible', value: false, origin: 'remote' })
})

test('G5: an OWN rename echo emits origin: "own" with its requestSeq', () => {
  const { client, mock } = makeClient()
  const seen = collecting(client)
  const seq = client.renameNode('Crate', 'Crate-2')
  mock.simulateMessage({
    type: 'set', seq: 900, node: 'Crate', field: 'name', value: 'Crate-2',
    serverTime: 1700000123457, session: client._sessionId, requestSeq: seq,
  })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { nodeName: 'Crate', path: 'name', value: 'Crate-2', origin: 'own', requestSeq: seq })
})

test('G5: an OWN animation echo emits origin: "own" with its requestSeq', () => {
  const { client, mock } = makeClient()
  const seen = collecting(client)
  const seq = client.setModelAnimation('Model', SENT_ANIMATION)
  mock.simulateMessage({
    type: 'set', seq: 901, node: 'Model', field: MODEL_ANIMATION_FIELD, value: STAMPED_ANIMATION,
    serverTime: 1700000123457, session: client._sessionId, requestSeq: seq,
  })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], {
    nodeName: 'Model', path: MODEL_ANIMATION_FIELD, value: STAMPED_ANIMATION,
    origin: 'own', requestSeq: seq,
  })
})

test('G5: an OWN object-id echo emits origin: "own" with its requestSeq', () => {
  const { client, mock } = makeClient()
  const seen = collecting(client)
  const id = '22222222-2222-4222-8222-222222222222'
  const seq = client.setObjectId('Crate', id)
  mock.simulateMessage({
    type: 'set', seq: 902, node: 'Crate', field: OBJECT_ID_FIELD, value: id,
    serverTime: 1700000123457, session: client._sessionId, requestSeq: seq,
  })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { nodeName: 'Crate', path: OBJECT_ID_FIELD, value: id, origin: 'own', requestSeq: seq })
})

test('G5: an OWN generic echo (sendField, the runner\'s path) emits origin: "own" with its requestSeq', () => {
  const { client, mock } = makeClient()
  const seen = collecting(client)
  const seq = client.sendField('Crate', 'translation', [1, 2, 3])
  mock.simulateMessage({
    type: 'set', seq: 903, node: 'Crate', field: 'translation', value: [1, 2, 3],
    serverTime: 1700000123457, session: client._sessionId, requestSeq: seq,
  })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], { nodeName: 'Crate', path: 'translation', value: [1, 2, 3], origin: 'own', requestSeq: seq })
})

// ===========================================================================
// The sites are exhaustive: no plain `som:set` emit remains
// ===========================================================================

test('G5: every `som:set` emit in AtriumClient carries an origin', () => {
  // A source-level check, because the six tests above can only drive the sites
  // that exist: a seventh site added without `origin` would pass them all.
  const source = readFileSync(new URL('../src/AtriumClient.js', import.meta.url), 'utf8')
  const emits = source.match(/emit\('som:set', \{[^}]*\}/g) ?? []
  assert.equal(emits.length, 6, `expected six som:set emit sites, saw ${emits.length}`)
  for (const emit of emits) {
    assert.match(emit, /origin: '(own|remote)'/, `no origin in ${emit}`)
  }
  const own = emits.filter((emit) => emit.includes("origin: 'own'")).length
  const remote = emits.filter((emit) => emit.includes("origin: 'remote'")).length
  assert.equal(own, 4, 'four own echoes (name, animation, objectId, applyEcho)')
  assert.equal(remote, 2, 'two remote sites (rename and field set)')
})
