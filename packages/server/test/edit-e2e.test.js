// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-e2e — Phase 3 step 1a, end to end: a real WebSocket server and two real
// AtriumClient instances. A renames, moves and deletes; B sees each; A gets
// edit:accepted for each. A refused edit gives A edit:rejected with the right
// seq, and B sees nothing.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WS from 'ws'
import { createWorld } from '../src/world.js'
import { createSessionServer } from '../src/session.js'
import { AtriumClient } from '../../client/src/AtriumClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const closers = []
after(async () => {
  for (const close of closers.reverse()) {
    try { await close() } catch { /* best effort */ }
  }
})

const delay = (ms) => new Promise(r => setTimeout(r, ms))

function listen(http) {
  return new Promise((res, rej) => {
    http.once('error', rej)
    http.listen(0, '127.0.0.1', () => res(http.address().port))
  })
}

async function startOpenWorld(gltfPath) {
  const world = await createWorld(gltfPath)
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

function once(emitter, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs)
    emitter.once(event, (data) => { clearTimeout(timer); resolve(data) })
  })
}

async function waitUntil(pred, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await delay(20)
  }
  return false
}

function record(client, names) {
  const events = []
  for (const name of names) client.on(name, (data) => events.push({ name, data }))
  return events
}

/** Connect a real AtriumClient to the real server and wait for world:loaded. */
async function connectClient(port, avatarName) {
  const client = new AtriumClient({ WebSocket: WS, connectTimeout: 5000 })
  const loaded = once(client, 'world:loaded')
  client.connect(`ws://127.0.0.1:${port}`, {
    avatar: { name: avatarName, translation: [0, 0, 0] },
  })
  await loaded
  return client
}

// ===========================================================================
// e2e
// ===========================================================================

test('e2e: A renames, B sees it, A gets edit:accepted, and the server persisted it', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const a = await connectClient(port, 'avatar-a')
  const b = await connectClient(port, 'avatar-b')
  try {
    const aAccepted = record(a, ['edit:accepted'])
    const bRenames = record(b, ['som:rename'])

    const seq = a.renameNode('crate-01', 'Box')
    assert.ok(await waitUntil(() => a.som.getNodeByName('Box')), 'A applies the rename on acceptance')
    assert.ok(await waitUntil(() => b.som.getNodeByName('Box')), 'B sees the rename')

    assert.equal(a.som.getNodeByName('crate-01'), null, 'A drops the old name')
    assert.equal(b.som.getNodeByName('crate-01'), null, 'B drops the old name')
    assert.deepEqual(bRenames.map(e => e.data), [{ from: 'crate-01', to: 'Box' }])
    assert.equal(world.getNode('Box').name, 'Box', 'the server renamed the node')

    assert.equal(aAccepted.length, 1, 'A got exactly one edit:accepted')
    assert.equal(aAccepted[0].data.seq, seq)
    assert.equal(aAccepted[0].data.field, 'name')
  } finally {
    a.disconnect(); b.disconnect()
    await delay(50)
  }
})

test('e2e: A moves a node, B sees the set, A gets edit:accepted', async () => {
  const { port } = await startOpenWorld(SPACE)
  const a = await connectClient(port, 'avatar-a')
  const b = await connectClient(port, 'avatar-b')
  try {
    const aAccepted = record(a, ['edit:accepted'])
    const bSets = record(b, ['som:set'])

    a.som.getNodeByName('crate-01').translation = [4, 0, 2]
    const seq = a.lastSendSeq

    assert.ok(await waitUntil(() => {
      const n = b.som.getNodeByName('crate-01')
      return n && n.translation[0] === 4 && n.translation[2] === 2
    }), 'B applies the translation')

    assert.ok(await waitUntil(() => aAccepted.length === 1), 'A got edit:accepted')
    assert.equal(aAccepted[0].data.seq, seq)
    assert.equal(aAccepted[0].data.field, 'translation')
    assert.ok(bSets.some(e => e.data.path === 'translation' && e.data.value[0] === 4))
  } finally {
    a.disconnect(); b.disconnect()
    await delay(50)
  }
})

test('e2e: A adds a parent and a child, then deletes the parent; B drops the subtree', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const a = await connectClient(port, 'avatar-a')
  const b = await connectClient(port, 'avatar-b')
  try {
    const aAccepted = record(a, ['edit:accepted'])

    a.addNode({ name: 'P' })
    assert.ok(await waitUntil(() => a.som.getNodeByName('P') && b.som.getNodeByName('P')))

    a.addNode({ name: 'C' })
    // Parent the child under P on the server side by sending an add with a parent.
    a._wsSend({ type: 'add', seq: ++a._sendSeq, parent: 'P', node: { name: 'C2' } })
    assert.ok(await waitUntil(() => b.som.getNodeByName('C2')), 'B sees the child add')

    const removed = b.som.getNodeByName('P')
    a.removeNode('P')
    assert.ok(await waitUntil(() => a.som.getNodeByName('P') === null), 'A drops the parent')
    assert.ok(await waitUntil(() => b.som.getNodeByName('P') === null), 'B drops the parent')
    assert.equal(b.som.getNodeByName('C2'), null, 'B drops the child with it')
    assert.equal(world.som.getNodeByName('C2'), null, 'the server dropped the child with it')

    assert.ok(aAccepted.length >= 3, 'A got edit:accepted for the add, the child add and the remove')
  } finally {
    a.disconnect(); b.disconnect()
    await delay(50)
  }
})

test('e2e: a refused edit gives A edit:rejected with the right seq, and B sees nothing', async () => {
  const { port } = await startOpenWorld(SPACE)
  const a = await connectClient(port, 'avatar-a')
  const b = await connectClient(port, 'avatar-b')
  try {
    const aRejected = record(a, ['edit:rejected'])
    const bSets = record(b, ['som:set'])
    const bRenames = record(b, ['som:rename'])
    const bEventsBefore = bSets.length + bRenames.length

    // Rename onto an existing name — the server refuses with INVALID_VALUE.
    const seq = a.renameNode('crate-01', 'lamp-01')
    assert.ok(await waitUntil(() => aRejected.length === 1), 'A got edit:rejected')
    assert.equal(aRejected[0].data.seq, seq)
    assert.equal(aRejected[0].data.code, 'INVALID_VALUE')

    assert.equal(a.som.getNodeByName('crate-01').name, 'crate-01', 'A keeps its local name')
    assert.equal(a.som.getNodeByName('lamp-01').name, 'lamp-01', 'the other node is untouched')

    await delay(120)
    assert.equal(bSets.length + bRenames.length, bEventsBefore, 'B sees nothing')
  } finally {
    a.disconnect(); b.disconnect()
    await delay(50)
  }
})

test('e2e: the avatar announcement is never tracked; a later edit still resolves', async () => {
  const { port } = await startOpenWorld(SPACE)
  const a = await connectClient(port, 'avatar-a')
  try {
    const aUnknown = record(a, ['edit:unknown'])
    const aAccepted = record(a, ['edit:accepted'])

    // The avatar add has a seq but must not be pending.
    const pending = [...a._connectionRecord.pendingEdits.values()]
    assert.equal(pending.some(e => e.type === 'add' && e.node === a._avatarNodeName), false,
      'the avatar announcement is not tracked')

    a.som.getNodeByName('crate-01').visible = false
    assert.ok(await waitUntil(() => aAccepted.length === 1), 'a real edit resolves')
    assert.equal(aUnknown.length, 0, 'nothing went unknown')
  } finally {
    a.disconnect()
    await delay(50)
  }
})

// ---------------------------------------------------------------------------
// R1 revision — a parented add must not make the receiving client send
// ---------------------------------------------------------------------------

/**
 * Record every frame a connected client puts on its socket (the real wire, not
 * a mock). `ws.send` is a prototype method; the spy shadows it per instance.
 */
function spySends(client) {
  const sent = []
  const ws  = client._ws
  const realSend = ws.send.bind(ws)
  ws.send = (data) => {
    sent.push(JSON.parse(data))
    realSend(data)
  }
  return sent
}

test('R1: a client receiving a parented add sends nothing and emits no edit:*', async () => {
  const { port } = await startOpenWorld(SPACE)
  const a = await connectClient(port, 'avatar-a')
  const b = await connectClient(port, 'avatar-b')
  try {
    const bSent  = spySends(b)
    const bEdits = record(b, ['edit:accepted', 'edit:rejected', 'edit:unknown'])

    // A adds a parent, then a child under it, over the real wire. B receives
    // both adds; the second is parented, so the server names the parent in it.
    a.addNode({ name: 'R1-parent' })
    assert.ok(await waitUntil(() => b.som.getNodeByName('R1-parent')), 'B has the parent')

    a._wsSend({ type: 'add', seq: ++a._sendSeq, parent: 'R1-parent', node: { name: 'R1-child' } })
    assert.ok(await waitUntil(() => b.som.getNodeByName('R1-child')), 'B applies the parented add')
    assert.equal(
      b.som.getNodeByName('R1-parent').children.some(c => c.name === 'R1-child'),
      true,
      'the child landed under its parent'
    )

    await delay(150)

    const sends = bSent.filter(m => m.type === 'send')
    assert.deepEqual(sends, [], `B must send nothing, but sent ${JSON.stringify(sends)}`)
    assert.deepEqual(bEdits, [], 'B must emit no edit:* event')

    // Second half of R1 — the generic node listener must ignore property-less
    // mutations, which needs its own trigger: a childList change raised OUTSIDE
    // applyLocally (app-layer code attaching a node locally). `send` requires a
    // field, so forwarding this would put the same malformed frame on the wire.
    const localParent = b.som.getNodeByName('R1-parent')
    const localChild  = b.som.ingestNode({ name: 'R1-local' })
    localParent.addChild(localChild)
    await delay(150)

    const sends2 = bSent.filter(m => m.type === 'send')
    assert.deepEqual(sends2, [], `B must still send nothing, but sent ${JSON.stringify(sends2)}`)
    assert.deepEqual(bEdits, [], 'B must still emit no edit:* event')
  } finally {
    a.disconnect()
    b.disconnect()
    await delay(50)
  }
})
