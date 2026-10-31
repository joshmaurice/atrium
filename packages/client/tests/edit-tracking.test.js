// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Phase 3 step 1a — A3 (client edit tracking), A7 (add.parent) and A8 (rename
// sync) at the AtriumClient level. Real SOMDocuments; a mock WebSocket stands
// in for the socket so inbound messages can be injected deterministically.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Document, NodeIO } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { AtriumClient } from '../src/AtriumClient.js'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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

// ===========================================================================
// A3/D7 — one counter for every outgoing message
// ===========================================================================

test('A3/D7: send, add, remove and view share one counter', () => {
  const { client, mock } = makeClient()

  client.som.getNodeByName('Crate').translation = [1, 0, 0]     // send
  const addSeq    = client.addNode({ name: 'Box' })             // add
  const removeSeq = client.removeNode('Box')                    // remove
  client.setView({ position: [0, 0, 0] })                       // view

  const seqs = mock.sent.map(m => m.seq)
  assert.deepEqual(seqs, [1, 2, 3, 4], 'one counter, no collisions')
  assert.equal(addSeq, 2)
  assert.equal(removeSeq, 3)
  assert.equal(client.lastSendSeq, 1, 'lastSendSeq records the send seq')
})

test('A3: a view message is numbered by the same counter', async () => {
  const { client, mock } = makeClient()
  client.addNode({ name: 'Box' })
  client.setView({ position: [1, 2, 3] })

  const views = sentOfType(mock, 'view')
  assert.equal(views.length, 1)
  assert.equal(views[0].seq, 2, 'the view follows the add in one sequence')

  // The view rate limiter defers the next one; after the interval it flushes.
  await new Promise(r => setTimeout(r, 80))
  client.setView({ position: [4, 5, 6] })
  assert.equal(sentOfType(mock, 'view').at(-1).seq, 3)
})

// ===========================================================================
// A3 — edit:accepted / edit:rejected / edit:unknown
// ===========================================================================

test('A3: an own set echo resolves edit:accepted', () => {
  const { client, mock } = makeClient()
  const accepted = []
  client.on('edit:accepted', e => accepted.push(e))

  client.som.getNodeByName('Crate').translation = [1, 2, 3]
  const seq = mock.sent.at(-1).seq

  mock.simulateMessage({
    type: 'set', seq: 99, node: 'Crate', field: 'translation', value: [1, 2, 3],
    serverTime: Date.now(), session: client._sessionId, requestSeq: seq,
  })

  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].seq, seq)
  assert.equal(accepted[0].type, 'send')
  assert.equal(accepted[0].node, 'Crate')
  assert.equal(accepted[0].field, 'translation')
})

test('A3: an error with a matching seq resolves edit:rejected', () => {
  const { client, mock } = makeClient()
  const rejected = []
  client.on('edit:rejected', e => rejected.push(e))

  client.som.getNodeByName('Crate').translation = [1, 2, 3]
  const seq = mock.sent.at(-1).seq

  mock.simulateMessage({ type: 'error', code: 'PERMISSION_DENIED', message: 'nope', seq })

  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].seq, seq)
  assert.equal(rejected[0].code, 'PERMISSION_DENIED')
  assert.equal(rejected[0].message, 'nope')
})

test('A3: an error for an untracked seq resolves nothing', () => {
  const { client, mock } = makeClient()
  const rejected = []
  client.on('edit:rejected', e => rejected.push(e))
  mock.simulateMessage({ type: 'error', code: 'PERMISSION_DENIED', message: 'nope', seq: 4242 })
  assert.equal(rejected.length, 0)
})

test('A3: disconnect() resolves every pending edit as edit:unknown at once', () => {
  const { client, mock } = makeClient()
  const unknown = []
  client.on('edit:unknown', e => unknown.push(e))

  client.som.getNodeByName('Crate').translation = [1, 0, 0]
  const sendSeq = mock.sent.at(-1).seq
  const addSeq = client.addNode({ name: 'Box' })

  client.disconnect()

  assert.equal(unknown.length, 2)
  assert.deepEqual(unknown.map(u => u.seq).sort((a, b) => a - b), [sendSeq, addSeq].sort((a, b) => a - b))
  assert.equal(client._connectionRecord, null)
})

test('A3: a socket close resolves every pending edit as edit:unknown', () => {
  const { client, mock } = makeClient()
  const unknown = []
  client.on('edit:unknown', e => unknown.push(e))

  client.addNode({ name: 'Box' })
  mock._fire('close', 1000, '')

  assert.equal(unknown.length, 1)
  assert.equal(unknown[0].type, 'add')
})

test('A3: connect() replacing a connection resolves pending edits immediately', () => {
  const { client, mock } = makeClient()
  const unknown = []
  const accepted = []
  client.on('edit:unknown', e => unknown.push(e))
  client.on('edit:accepted', e => accepted.push(e))

  client.som.getNodeByName('Crate').translation = [1, 0, 0]
  const seq = mock.sent.at(-1).seq

  client.connect('ws://mock-2')

  assert.equal(unknown.length, 1, 'the pending edit resolves at once, not on disconnected')
  assert.equal(unknown[0].seq, seq)

  // A late answer from the superseded connection resolves nothing.
  mock.simulateMessage({
    type: 'set', seq: 7, node: 'Crate', field: 'translation', value: [9, 9, 9],
    serverTime: 1, session: client._sessionId, requestSeq: seq,
  })
  mock.simulateMessage({ type: 'error', code: 'PERMISSION_DENIED', message: 'late', seq })
  assert.equal(accepted.length, 0, 'a superseded connection answers nothing')
})

test('A3: the avatar announcement never enters the pending map', async () => {
  const { client, mock } = makeClient({ avatar: { name: 'avatar-x', translation: [0, 0, 0] } })
  const rejected = []
  client.on('edit:rejected', e => rejected.push(e))

  // Build a minimal som-dump payload.
  const doc = new Document()
  doc.createScene('Scene')
  const { json } = await new NodeIO().writeJSON(doc)

  client._onSomDump({ type: 'som-dump', seq: 1, gltf: json }, client._connectionRecord)
  await new Promise(r => setTimeout(r, 10))

  const avatarAdd = sentOfType(mock, 'add').find(m => m.id === client._sessionId)
  assert.ok(avatarAdd, 'the avatar add was sent')
  assert.equal(client._connectionRecord.pendingEdits.has(avatarAdd.seq), false,
    'the avatar add is not tracked')

  // An error for that seq resolves nothing.
  mock.simulateMessage({ type: 'error', code: 'PERMISSION_DENIED', message: 'x', seq: avatarAdd.seq })
  assert.equal(rejected.length, 0)
})

test('A3: an own add broadcast resolves edit:accepted', () => {
  const { client, mock } = makeClient()
  const accepted = []
  client.on('edit:accepted', e => accepted.push(e))

  const seq = client.addNode({ name: 'Box' })
  mock.simulateMessage({
    type: 'add', seq: 50, node: { name: 'Box' }, requestSeq: seq, session: client._sessionId,
  })

  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].type, 'add')
  assert.equal(accepted[0].node, 'Box')
  assert.ok(client.som.getNodeByName('Box'))
})

test('A3: an own remove broadcast resolves edit:accepted', () => {
  const { client, mock } = makeClient()
  const accepted = []
  client.on('edit:accepted', e => accepted.push(e))

  const seq = client.removeNode('Crate')
  mock.simulateMessage({
    type: 'remove', seq: 51, node: 'Crate', requestSeq: seq, session: client._sessionId,
  })

  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].type, 'remove')
  assert.equal(client.som.getNodeByName('Crate'), null)
})

// ===========================================================================
// A7 — add.parent
// ===========================================================================

test('A7: an add with no parent goes to the scene root', () => {
  const { client, mock } = makeClient()
  mock.simulateMessage({ type: 'add', seq: 1, node: { name: 'Box' } })
  assert.ok(client.som.scene.children.some(n => n.name === 'Box'))
})

test('A7: an add with a found parent goes under it', () => {
  const { client, mock } = makeClient()
  mock.simulateMessage({ type: 'add', seq: 1, parent: 'Crate', node: { name: 'Hat' } })
  assert.equal(client.som.getNodeByName('Crate').children.some(n => n.name === 'Hat'), true)
  assert.equal(client.som.scene.children.some(n => n.name === 'Hat'), false)
})

test('A7: an add with a missing parent is not inserted and emits som:desync', () => {
  const { client, mock } = makeClient()
  const desync = []
  client.on('som:desync', e => desync.push(e))

  mock.simulateMessage({ type: 'add', seq: 1, parent: 'Ghost', node: { name: 'Hat' } })

  assert.equal(client.som.getNodeByName('Hat'), null, 'nothing is inserted anywhere')
  assert.equal(client.som.scene.children.some(n => n.name === 'Hat'), false)
  assert.equal(desync.length, 1)
  assert.deepEqual(desync[0], { reason: 'parent-not-found', node: 'Hat', parent: 'Ghost' })
})

// ===========================================================================
// A6 — a remote subtree remove drops the subtree
// ===========================================================================

test('A6: a remote remove of a parent drops the whole subtree client-side', () => {
  const { client, mock } = makeClient()
  const world = client.som
  const parent = world.createNode({ name: 'P' })
  world.scene.addChild(parent)
  parent.addChild(world.createNode({ name: 'C' }))
  parent.children[0].addChild(world.createNode({ name: 'G' }))

  mock.simulateMessage({ type: 'remove', seq: 1, node: 'P' })

  for (const name of ['P', 'C', 'G']) {
    assert.equal(world.getNodeByName(name), null, `"${name}" must be gone`)
  }
})

// ===========================================================================
// A8 — rename
// ===========================================================================

test('A8 case 1: renameNode sends the request and changes nothing locally', () => {
  const { client, mock } = makeClient()
  const seq = client.renameNode('Crate', 'Box')

  const sent = mock.sent.at(-1)
  assert.deepEqual(sent, { type: 'send', seq, node: 'Crate', field: 'name', value: 'Box' })
  assert.ok(client.som.getNodeByName('Crate'), 'the old name still resolves')
  assert.equal(client.som.getNodeByName('Box'), null, 'the new name does not resolve yet')
  assert.equal(client.lastSendSeq, seq)
})

test('A8 case 2: an accepted rename applies locally and emits som:rename', () => {
  const { client, mock } = makeClient()
  const renamed = []
  const accepted = []
  client.on('som:rename', e => renamed.push(e))
  client.on('edit:accepted', e => accepted.push(e))

  const seq = client.renameNode('Crate', 'Box')
  mock.simulateMessage({
    type: 'set', seq: 60, node: 'Crate', field: 'name', value: 'Box',
    serverTime: Date.now(), session: client._sessionId, requestSeq: seq,
  })

  assert.deepEqual(renamed, [{ from: 'Crate', to: 'Box' }])
  assert.equal(accepted.length, 1)
  assert.ok(client.som.getNodeByName('Box'), 'the new name resolves')
  assert.equal(client.som.getNodeByName('Crate'), null, 'the old name is gone')
})

test('A8 case 3: a rejected rename leaves local names and maps unchanged', () => {
  const { client, mock } = makeClient()
  const renamed = []
  client.on('som:rename', e => renamed.push(e))

  const seq = client.renameNode('Crate', 'Box')
  mock.simulateMessage({ type: 'error', code: 'INVALID_VALUE', message: 'name "Box" is already in use', seq })

  assert.equal(renamed.length, 0, 'no rename was applied')
  assert.ok(client.som.getNodeByName('Crate'), 'the old name still resolves')
  assert.equal(client.som.getNodeByName('Box'), null)
})

test('A8 case 4: after an accepted rename, the next edit goes out under the new name', () => {
  const { client, mock } = makeClient()
  const seq = client.renameNode('Crate', 'Box')
  mock.simulateMessage({
    type: 'set', seq: 61, node: 'Crate', field: 'name', value: 'Box',
    serverTime: Date.now(), session: client._sessionId, requestSeq: seq,
  })

  client.som.getNodeByName('Box').translation = [1, 2, 3]

  const sent = mock.sent.at(-1)
  assert.equal(sent.type, 'send')
  assert.equal(sent.node, 'Box', 'the listener reads the current name')
  assert.equal(sent.field, 'translation')
})

test('A8 case 5: a direct node.name assignment sends nothing', () => {
  const { client, mock } = makeClient()
  const before = mock.sent.length
  client.som.getNodeByName('Crate').name = 'Box'
  assert.equal(mock.sent.length, before, 'the generic node listener never sends `name`')
  assert.ok(client.som.getNodeByName('Box'))
})

test('A8 case 6: a remote rename is applied and emits som:rename plus som:set', () => {
  const { client, mock } = makeClient()
  const renamed = []
  const sets = []
  client.on('som:rename', e => renamed.push(e))
  client.on('som:set', e => sets.push(e))

  mock.simulateMessage({
    type: 'set', seq: 62, node: 'Crate', field: 'name', value: 'Box',
    serverTime: Date.now(), session: 'peer-session',
  })

  assert.deepEqual(renamed, [{ from: 'Crate', to: 'Box' }])
  // scripting-4d-1 G5 — the remote site says where it came from.
  assert.deepEqual(sets, [{ nodeName: 'Crate', path: 'name', value: 'Box', origin: 'remote' }])
  assert.ok(client.som.getNodeByName('Box'), 'the renamed node is found under its new name')
  assert.equal(client.som.getNodeByName('Crate'), null)
})

test('A8: a remote rename that the SOM refuses changes nothing and logs', () => {
  const { client, mock } = makeClient()
  const world = client.som
  world.createNode({ name: 'Taken' })
  const renamed = []
  client.on('som:rename', e => renamed.push(e))

  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.join(' ')) }
  try {
    mock.simulateMessage({
      type: 'set', seq: 63, node: 'Crate', field: 'name', value: 'Taken',
      serverTime: Date.now(), session: 'peer-session',
    })
  } finally {
    console.warn = origWarn
  }

  assert.equal(renamed.length, 0)
  assert.equal(world.getNodeByName('Crate').name, 'Crate', 'the node keeps its name')
  assert.ok(warnings.some(w => w.includes('remote rename')), 'the failure is logged')
})

// ===========================================================================
// A1 / A10 — canEdit and the rename consumers' data
// ===========================================================================

test('A1: hello.canEdit is exposed as client.canEdit', () => {
  const { client, mock } = makeClient()
  mock.simulateMessage({
    type: 'hello', id: client._sessionId, seq: 1, serverTime: Date.now(),
    canEdit: true, canPlaceTeleporters: true,
    capabilities: { tick: { interval: 1000, minInterval: 50 } },
  })
  assert.equal(client.canEdit, true)
  assert.equal(client.canPlaceTeleporters, true)
})

test('A10 case 6: after som:rename a teleporter node is found under its new name', () => {
  const { client, mock } = makeClient()
  // A teleporter pad, keyed by name.
  const pad = client.som.createNode({ name: 'pad-1' })
  pad.extras = { atrium: { teleporter: { destination: 'world-2' } } }
  client.som.scene.addChild(pad)

  const renamed = []
  client.on('som:rename', e => renamed.push(e))
  mock.simulateMessage({
    type: 'set', seq: 64, node: 'pad-1', field: 'name', value: 'pad-2',
    serverTime: Date.now(), session: 'peer-session',
  })

  assert.deepEqual(renamed, [{ from: 'pad-1', to: 'pad-2' }])
  const moved = client.som.getNodeByName('pad-2')
  assert.ok(moved, 'the pad resolves under its new name — the data rebuildPads reads')
  assert.equal(moved.extras.atrium.teleporter.destination, 'world-2', 'its extras moved with it')
})
