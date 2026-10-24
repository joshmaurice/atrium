// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// object-id.test.js — scripting-4b-1 step 1, E1 and E3.
//
// E1: the server's `objectIdProblem` runs the SAME shared vectors the client's
// test reads, so no copy of the rule lives in a test.
// E3: the `add` path's form and uniqueness checks, the set-once `send` leaf,
// and load healing (`healDocumentObjectIds`), over real WebSocket servers that
// bind port 0 and are closed in after(); every socket is closed in finally.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { Document } from '@gltf-transform/core'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld, createWorldFromDocument, healDocumentObjectIds } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import { objectIdProblem, objectIdReasonText, OBJECT_ID_TAKEN } from '../src/send-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/object-id-vectors.json'), 'utf8'))

const ID_A = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const ID_B = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const ID_C = '123e4567-e89b-42d3-a456-426614174000'

// ===========================================================================
// E1 — the shared vectors
// ===========================================================================

test('E1: objectIdProblem agrees with the shared vectors', () => {
  assert.ok(VECTORS.values.length >= 25, 'the shared vectors are the adversarial set')
  for (const vector of VECTORS.values) {
    const reason = objectIdProblem(vector.value)
    assert.equal(reason, vector.ok ? null : vector.reason,
      `${vector.label}: expected ${vector.ok ? 'accepted' : vector.reason}, got ${reason}`)
  }
})

test('E1: every refused vector names a code with plain text of its own', () => {
  for (const vector of VECTORS.values.filter((v) => !v.ok)) {
    assert.notEqual(objectIdReasonText(vector.reason), 'the objectId is invalid',
      `${vector.reason} must have its own text`)
  }
})

test('E1: the named adversarial cases are present and refused for the right reason', () => {
  const byLabel = new Map(VECTORS.values.map((v) => [v.label, v]))
  const required = [
    'uppercase UUID is refused (lowercase only)',
    'a version-1 UUID is refused',
    'the empty string is refused',
    'a 37-character string is refused (one character too many)',
    'a valid id with a trailing newline is refused',
  ]
  for (const label of required) {
    const vector = [...byLabel.entries()].find(([l]) => l === label)?.[1]
    assert.ok(vector, `${label} must be in the vectors file`)
    assert.equal(vector.ok, false)
    assert.equal(vector.reason, 'object-id-form')
  }
})

test('E1: 100 freshly generated UUIDs all pass the server’s rule', () => {
  const seen = new Set()
  for (let i = 0; i < 100; i++) {
    const id = crypto.randomUUID()
    assert.equal(objectIdProblem(id), null, `${id} must pass`)
    seen.add(id)
  }
  assert.equal(seen.size, 100, 'they are distinct')
})

// ===========================================================================
// A real owner world, as add-extras.test.js builds one
// ===========================================================================

const closers = []
after(async () => {
  for (const close of closers.reverse()) {
    try { await close() } catch { /* best effort */ }
  }
})

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function listen(http) {
  return new Promise((res, rej) => {
    http.once('error', rej)
    http.listen(0, '127.0.0.1', () => res(http.address().port))
  })
}

function waitForOpen(ws) {
  return new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) return res()
    ws.once('open', res)
    ws.once('error', rej)
  })
}

function waitForClose(ws) {
  return new Promise((res) => {
    if (ws.readyState === WebSocket.CLOSED) return res()
    ws.once('close', res)
  })
}

function collect(ws) {
  const messages = []
  ws.on('message', (raw) => {
    try { messages.push(JSON.parse(raw)) } catch { /* ignore */ }
  })
  return messages
}

async function waitFor(messages, pred, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = messages.find(pred)
    if (found) return found
    await delay(10)
  }
  return null
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  return { ws, messages }
}

async function hello(ws, messages, id) {
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
  const reply = await waitFor(messages, (m) => m.type === 'hello')
  assert.ok(reply, 'hello reply should arrive')
  return reply
}

async function waitForNode(world, name, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const node = world.som.getNodeByName(name)
    if (node) return node
    await delay(10)
  }
  return null
}

/** The world's own `extras.atrium.objectId` per node name, for identity checks. */
function idsOf(world) {
  const out = {}
  for (const node of world.som.allNodes) out[node.name] = node.extras?.atrium?.objectId
  return out
}

function resourceCounts(world) {
  const root = world.som.document.getRoot()
  return { nodes: root.listNodes().length, meshes: root.listMeshes().length }
}

async function startOwnerWorld() {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const state = { saves: 0 }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence,
    worldOwnerUserId: 'user-a',
    onSaveableMutation: () => { state.saves += 1 },
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, 'user-a')
    })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, state }
}

/** The same world, reachable by a visitor (a different user id). */
async function startVisitorWorld() {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions: new Map(),
    presence: { add() {}, remove() { return null }, list() { return [] }, setPosition() {} },
    worldOwnerUserId: 'user-a',
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, 'user-zzz')
    })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port }
}

async function startDocWorld(json) {
  const world = await createWorldFromDocument(json)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const state = { saves: 0 }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions,
    presence: { add() {}, remove() { return null }, list() { return [] }, setPosition() {} },
    worldOwnerUserId: 'user-a',
    onSaveableMutation: () => { state.saves += 1 },
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, 'user-a')
    })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, state }
}

/** A refusal: `code` is returned, nothing changed, nothing was saved or broadcast. */
async function expectRefusal({ ws, messages, peer, world, state, message, code, peerBroadcast = true }) {
  const before = resourceCounts(world)
  const idsBefore = idsOf(world)
  const savesBefore = state?.saves ?? 0
  const peerBefore = peer?.messages.length ?? 0
  ws.send(JSON.stringify(message))
  const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === message.seq)
  assert.ok(err, `expected an error for seq ${message.seq}`)
  assert.equal(err.code, code, `expected ${code}, got ${err.code} (${err.message})`)
  await delay(80)
  assert.deepEqual(resourceCounts(world), before, 'a refusal changes no resource')
  assert.deepEqual(idsOf(world), idsBefore, 'a refusal changes no id')
  assert.equal(state?.saves ?? 0, savesBefore, 'a refusal saves nothing')
  if (peer && peerBroadcast) {
    const peerNew = peer.messages.slice(peerBefore).filter((m) => ['set', 'add', 'remove'].includes(m.type))
    assert.deepEqual(peerNew, [], 'a refusal broadcasts nothing')
  }
  return err
}

// ===========================================================================
// E3 — `add`
// ===========================================================================

test('E3: an owner add with a valid new id is accepted and broadcast with it', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'add-id-owner')
    await hello(peer.ws, peer.messages, 'add-id-peer')

    ws.send(JSON.stringify({
      type: 'add', seq: 100,
      node: { name: 'id-add', extras: { atrium: { objectId: ID_A } } },
    }))
    const own = await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'id-add')
    assert.ok(own, 'the add is accepted')
    assert.equal(own.node.extras.atrium.objectId, ID_A, 'the id travels with the broadcast')

    const atPeer = await waitFor(peer.messages, (m) => m.type === 'add' && m.node?.name === 'id-add')
    assert.ok(atPeer, 'and reaches the peer')
    assert.equal(atPeer.node.extras.atrium.objectId, ID_A)

    const node = await waitForNode(world, 'id-add')
    assert.ok(node)
    assert.equal(node.extras.atrium.objectId, ID_A, 'and is in the world')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('E3: a malformed id on add is INVALID_VALUE with the form message', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'add-bad-owner')
    await hello(peer.ws, peer.messages, 'add-bad-peer')

    const cases = [
      { atrium: { objectId: 'not-a-uuid' } },
      { atrium: { objectId: '' } },
      { atrium: { objectId: 'F47AC10B-58CC-4372-A567-0E02B2C3D479' } },
      { atrium: { objectId: ID_A + '\n' } },
      { atrium: { objectId: 42 } },
      { atrium: { objectId: null } },
    ]
    for (const [i, extras] of cases.entries()) {
      const err = await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'add', seq: 120 + i, node: { name: `id-bad-${i}`, extras } },
        code: 'INVALID_VALUE',
      })
      assert.match(err.message, /objectId must be/, 'the E1 message is used')
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('E3: an id already in the world is refused with the "already taken" message', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'taken-owner')
    await hello(peer.ws, peer.messages, 'taken-peer')

    ws.send(JSON.stringify({
      type: 'add', seq: 140,
      node: { name: 'taken-first', extras: { atrium: { objectId: ID_A } } },
    }))
    assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'taken-first'))

    const err = await expectRefusal({
      ws, messages, peer, world, state,
      message: { type: 'add', seq: 141, node: { name: 'taken-second', extras: { atrium: { objectId: ID_A } } } },
      code: 'INVALID_VALUE',
    })
    assert.equal(err.message, OBJECT_ID_TAKEN)
    assert.equal(err.message, 'objectId is already taken in this world')
    assert.equal(/already in use/.test(err.message), false,
      'the palette retries /already in use/, so the message must never match it (review S-B)')
    assert.equal(world.som.getNodeByName('taken-second'), null, 'nothing was added')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('E3: an id on a SHADOWED node still counts as taken', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'shadow-owner')
    await hello(peer.ws, peer.messages, 'shadow-peer')

    ws.send(JSON.stringify({
      type: 'add', seq: 160,
      node: { name: 'shadow-name', extras: { atrium: { objectId: ID_A } } },
    }))
    assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'shadow-name'))

    // A second, same-named node is refused by the name rule; put a shadowed
    // node in the world through the SOM itself, then check the id is taken.
    const shadowed = world.som.createNode({ name: 'shadow-name', extras: { atrium: { objectId: ID_B } } })
    assert.ok(world.som.isExternalNode(shadowed) === false)
    assert.equal(world.som.objectIdInUse(ID_B), true, 'the shadowed node is saved, so its id is taken')

    const err = await expectRefusal({
      ws, messages, peer, world, state,
      message: { type: 'add', seq: 161, node: { name: 'shadow-other', extras: { atrium: { objectId: ID_B } } } },
      code: 'INVALID_VALUE',
    })
    assert.equal(err.message, OBJECT_ID_TAKEN)
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('E3: an add with no id is accepted, exactly as before', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'noid-owner')
    ws.send(JSON.stringify({ type: 'add', seq: 180, node: { name: 'no-id-node' } }))
    assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'no-id-node'))
    assert.ok(state.saves > 0)
    const node = await waitForNode(world, 'no-id-node')
    assert.ok(node)
    assert.equal(node.extras?.atrium?.objectId, undefined, 'no id was invented')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// E3 — the set-once `send` leaf
// ===========================================================================

test('E3: the leaf is accepted on a node with no atrium, an empty atrium, and existing data', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'leaf-owner')
    await hello(peer.ws, peer.messages, 'leaf-peer')

    const rows = [
      { name: 'leaf-none', extras: undefined, id: ID_A },
      { name: 'leaf-empty', extras: { atrium: {} }, id: ID_B },
      { name: 'leaf-data', extras: { atrium: { teleporter: { destination: '/' } } }, id: ID_C },
    ]
    for (const [i, row] of rows.entries()) {
      const node = { name: row.name }
      if (row.extras !== undefined) node.extras = row.extras
      ws.send(JSON.stringify({ type: 'add', seq: 200 + i, node }))
      assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === row.name), `${row.name} added`)

      ws.send(JSON.stringify({
        type: 'send', seq: 210 + i, node: row.name, field: 'extras.atrium.objectId', value: row.id,
      }))
      const set = await waitFor(messages, (m) => m.type === 'set' && m.node === row.name &&
        m.field === 'extras.atrium.objectId')
      assert.ok(set, `${row.name}: the leaf is accepted`)
      assert.equal(set.value, row.id)
      assert.equal((await waitForNode(world, row.name)).extras.atrium.objectId, row.id)

      const atPeer = await waitFor(peer.messages, (m) => m.type === 'set' && m.node === row.name &&
        m.field === 'extras.atrium.objectId')
      assert.ok(atPeer, `${row.name}: and it is broadcast`)
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('E3: the leaf is INVALID_FIELD on a node that already has an id, the same value included', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'once-owner')
    await hello(peer.ws, peer.messages, 'once-peer')

    ws.send(JSON.stringify({
      type: 'add', seq: 230,
      node: { name: 'once-node', extras: { atrium: { objectId: ID_A } } },
    }))
    assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'once-node'))

    for (const [i, value] of [ID_A, ID_B].entries()) {
      const err = await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'send', seq: 240 + i, node: 'once-node', field: 'extras.atrium.objectId', value },
        code: 'INVALID_FIELD',
      })
      assert.match(err.message, /objectId is already set/)
    }
    assert.equal((await waitForNode(world, 'once-node')).extras.atrium.objectId, ID_A, 'the id is unchanged')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('E3: the leaf is refused for a duplicate or malformed value, with no broadcast or save', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'dup-owner')
    await hello(peer.ws, peer.messages, 'dup-peer')

    ws.send(JSON.stringify({
      type: 'add', seq: 260,
      node: { name: 'dup-holder', extras: { atrium: { objectId: ID_A } } },
    }))
    assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'dup-holder'))
    ws.send(JSON.stringify({ type: 'add', seq: 261, node: { name: 'dup-target' } }))
    assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'dup-target'))

    const dup = await expectRefusal({
      ws, messages, peer, world, state,
      message: { type: 'send', seq: 270, node: 'dup-target', field: 'extras.atrium.objectId', value: ID_A },
      code: 'INVALID_VALUE',
    })
    assert.equal(dup.message, OBJECT_ID_TAKEN)

    for (const [i, value] of ['nope', '', null, 42, ID_B + '\n'].entries()) {
      const err = await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'send', seq: 280 + i, node: 'dup-target', field: 'extras.atrium.objectId', value },
        code: 'INVALID_VALUE',
      })
      assert.match(err.message, /objectId must be/)
    }
    assert.equal((await waitForNode(world, 'dup-target')).extras?.atrium?.objectId, undefined)
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('E3: the leaf is refused for a visitor and on a live avatar', async () => {
  const { world, port } = await startVisitorWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'av-visitor')
    // The visitor cannot even add a node, so plant one through the SOM.
    world.som.createNode({ name: 'visitor-target' })
    ws.send(JSON.stringify({
      type: 'send', seq: 300, node: 'visitor-target', field: 'extras.atrium.objectId', value: ID_A,
    }))
    const denied = await waitFor(messages, (m) => m.type === 'error' && m.seq === 300)
    assert.ok(denied)
    assert.equal(denied.code, 'PERMISSION_DENIED', 'the mutation gate refuses a visitor')
    assert.equal(world.som.getNodeByName('visitor-target').extras?.atrium?.objectId, undefined)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('E3: the leaf is refused on a live avatar node', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, '12345678')
    ws.send(JSON.stringify({
      type: 'add', id: '12345678', seq: 320,
      node: { name: 'avatar-12345678', translation: [0, 0, 0] },
    }))
    const avatar = await waitForNode(world, 'avatar-12345678')
    assert.ok(avatar, 'the avatar add is accepted')

    const err = await expectRefusal({
      ws, messages, peer: null, world, state,
      message: { type: 'send', seq: 321, node: 'avatar-12345678', field: 'extras.atrium.objectId', value: ID_A },
      code: 'PERMISSION_DENIED',
    })
    assert.match(err.message, /avatar/)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('E3: two connections sending the same id for two nodes — the first wins', async () => {
  const { world, port } = await startOwnerWorld()
  const a = await connect(port)
  const b = await connect(port)
  try {
    await hello(a.ws, a.messages, 'two-a')
    await hello(b.ws, b.messages, 'two-b')

    // Two adds, same id, two nodes.
    a.ws.send(JSON.stringify({ type: 'add', seq: 340, node: { name: 'two-first', extras: { atrium: { objectId: ID_A } } } }))
    assert.ok(await waitFor(a.messages, (m) => m.type === 'add' && m.node?.name === 'two-first'))

    b.ws.send(JSON.stringify({ type: 'add', seq: 341, node: { name: 'two-second', extras: { atrium: { objectId: ID_A } } } }))
    const err = await waitFor(b.messages, (m) => m.type === 'error' && m.seq === 341)
    assert.ok(err)
    assert.equal(err.code, 'INVALID_VALUE')
    assert.equal(err.message, OBJECT_ID_TAKEN)
    assert.equal(world.som.getNodeByName('two-second'), null)

    // And two set-once sends, same id, two nodes.
    a.ws.send(JSON.stringify({ type: 'add', seq: 342, node: { name: 'two-target-a' } }))
    a.ws.send(JSON.stringify({ type: 'add', seq: 343, node: { name: 'two-target-b' } }))
    assert.ok(await waitFor(a.messages, (m) => m.type === 'add' && m.node?.name === 'two-target-a'))
    assert.ok(await waitFor(a.messages, (m) => m.type === 'add' && m.node?.name === 'two-target-b'))

    a.ws.send(JSON.stringify({
      type: 'send', seq: 344, node: 'two-target-a', field: 'extras.atrium.objectId', value: ID_C,
    }))
    assert.ok(await waitFor(a.messages, (m) => m.type === 'set' && m.node === 'two-target-a'))

    b.ws.send(JSON.stringify({
      type: 'send', seq: 345, node: 'two-target-b', field: 'extras.atrium.objectId', value: ID_C,
    }))
    const err2 = await waitFor(b.messages, (m) => m.type === 'error' && m.seq === 345)
    assert.ok(err2)
    assert.equal(err2.message, OBJECT_ID_TAKEN)
    assert.equal(world.som.getNodeByName('two-target-b').extras?.atrium?.objectId, undefined)
  } finally {
    a.ws.close(); await waitForClose(a.ws)
    b.ws.close(); await waitForClose(b.ws)
  }
})

test('E3: after a remove, the id can be used again', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'reuse-owner')
    ws.send(JSON.stringify({
      type: 'add', seq: 360, node: { name: 'reuse-one', extras: { atrium: { objectId: ID_A } } },
    }))
    assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'reuse-one'))

    ws.send(JSON.stringify({ type: 'remove', seq: 361, node: 'reuse-one' }))
    assert.ok(await waitFor(messages, (m) => m.type === 'remove' && m.node === 'reuse-one'))
    assert.equal(world.som.objectIdInUse(ID_A), false, 'nothing indexes a removed node’s id')

    ws.send(JSON.stringify({
      type: 'add', seq: 362, node: { name: 'reuse-two', extras: { atrium: { objectId: ID_A } } },
    }))
    assert.ok(await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'reuse-two'),
      'the id is free again')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// E3 — load healing
// ===========================================================================

test('E3: healDocumentObjectIds drops a duplicated id from ALL nodes, one line with a count', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('one').setExtras({ atrium: { objectId: ID_A }, keep: 1 }))
  scene.addChild(doc.createNode('two').setExtras({ atrium: { objectId: ID_A } }))
  scene.addChild(doc.createNode('three').setExtras({ atrium: { objectId: ID_A } }))

  const lines = []
  const result = healDocumentObjectIds(doc, { log: { log: (l) => lines.push(l) } })

  assert.deepEqual(result, { duplicated: 1, malformed: 0 })
  for (const node of doc.getRoot().listNodes()) {
    assert.equal(Object.hasOwn(node.getExtras().atrium, 'objectId'), false, `${node.getName()}: id dropped`)
  }
  assert.deepEqual(doc.getRoot().listNodes()[0].getExtras(), { atrium: {}, keep: 1 },
    'other extras keys stay, and an emptied atrium stays {}')
  assert.equal(lines.length, 1, 'ONE line per id')
  assert.equal(lines[0], `[world] dropped duplicated objectId ${ID_A} from 3 nodes`)
})

test('E3: healDocumentObjectIds drops a malformed id, one line per node with its index', () => {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  scene.addChild(doc.createNode('ok').setExtras({ atrium: { objectId: ID_A } }))
  scene.addChild(doc.createNode('bad1').setExtras({ atrium: { objectId: 'not-a-uuid' } }))
  scene.addChild(doc.createNode('bad2').setExtras({ atrium: { objectId: '' } }))

  const lines = []
  const result = healDocumentObjectIds(doc, { log: { log: (l) => lines.push(l) } })

  assert.deepEqual(result, { duplicated: 0, malformed: 2 })
  assert.equal(doc.getRoot().listNodes()[0].getExtras().atrium.objectId, ID_A, 'a good id survives')
  assert.deepEqual(lines, [
    '[world] dropped malformed objectId on node 1',
    '[world] dropped malformed objectId on node 2',
  ])
})

test('E3: a healed world loses the id, keeps the node, and saves without it', async () => {
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: 'heal-one', extras: { atrium: { objectId: ID_A } } },
      { name: 'heal-two', extras: { atrium: { objectId: ID_A } } },
      { name: 'heal-bad', extras: { atrium: { objectId: 'nope' } } },
    ],
  }
  const lines = []
  const original = console.log
  console.log = (...args) => lines.push(args.join(' '))
  let world
  try {
    world = await createWorldFromDocument(json)
  } finally {
    console.log = original
  }

  for (const name of ['heal-one', 'heal-two', 'heal-bad']) {
    const node = world.som.getNodeByName(name)
    assert.ok(node, `${name} is still in the world — healing never removes a node`)
    assert.equal(node.extras?.atrium?.objectId, undefined, `${name}: the id was dropped`)
  }
  assert.ok(lines.some((l) => l.includes(`dropped duplicated objectId ${ID_A} from 2 nodes`)),
    `one duplicated line, with the count: ${lines.join(' | ')}`)
  assert.ok(lines.some((l) => l.includes('dropped malformed objectId on node 2')), 'one malformed line')

  const saved = await world.serialize()
  for (const node of saved.nodes) {
    assert.equal(node.extras?.atrium?.objectId, undefined, 'the healed document saves without the dropped ids')
  }
})

test('E3: a malformed id dropped on load can be assigned afresh with a set-once send', async () => {
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'fresh', extras: { atrium: { objectId: 'not-a-uuid' } } }],
  }
  const original = console.log
  console.log = () => {}
  let started
  try {
    started = await startDocWorld(json)
  } finally {
    console.log = original
  }
  const { world, port, state } = started
  const { ws, messages } = await connect(port)
  try {
    assert.equal(world.som.getNodeByName('fresh').extras.atrium.objectId, undefined, 'dropped on load')

    await hello(ws, messages, 'fresh-owner')
    ws.send(JSON.stringify({
      type: 'send', seq: 400, node: 'fresh', field: 'extras.atrium.objectId', value: ID_A,
    }))
    const set = await waitFor(messages, (m) => m.type === 'set' && m.field === 'extras.atrium.objectId')
    assert.ok(set, 'the node had no own id, so the leaf is accepted')
    assert.equal(set.value, ID_A)
    assert.ok(state.saves > 0)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})
