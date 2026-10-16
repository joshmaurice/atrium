// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// avatar-ownership — Phase 3 server-cleanup, K9/H15 (contract L11).
//
// Real WebSocket servers over a real file world; every server binds port 0 and
// is closed in after(); every socket is closed in finally. No mocks.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld } from '../src/world.js'
import { createSessionServer, attachSessionHandlers } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

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
  ws.send(JSON.stringify({
    type: 'hello',
    id,
    capabilities: { tick: { interval: 5000 } },
  }))
  const reply = await waitFor(messages, m => m.type === 'hello')
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

// Send an avatar add under an explicit (server-allocated) name.
async function addAvatarAs(ws, world, id, name) {
  ws.send(JSON.stringify({
    type: 'add', id, seq: 1000, format: 'gltf',
    node: { name, translation: [0, 0, 0] },
  }))
  await delay(60)
  return world.som.getNodeByName(name)
}

// A full session server (real presence) over a real world — for tests that
// observe the disconnect `remove`/`leave` broadcasts.
async function startOpenWorld(world) {
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

async function startHandlerWorld({ world, ownerUserId = null, connectAs = null }) {
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const socketUserId = connectAs ?? ownerUserId

  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence,
    worldOwnerUserId: ownerUserId,
  })

  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, socketUserId)
    })
  })

  closers.push(async () => {
    closeKeepalive()
    wss.close()
    http.close()
  })

  return { world, port, sessions }
}

// ===========================================================================
// K9 — unique avatar names at hello, ownership by identity
// ===========================================================================

test('K9: a second visitor with the same 8-char prefix is renamed -2 and owns its own node', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startOpenWorld(world)
  const a = await connect(port)
  const b = await connect(port)
  try {
    const helloA = await hello(a.ws, a.messages, 'aaaaaaaa-1111-1111-1111-111111111111')
    const helloB = await hello(b.ws, b.messages, 'aaaaaaaa-2222-2222-2222-222222222222')

    assert.equal(helloA.avatarNodeName, 'avatar-aaaaaaaa')
    assert.equal(helloB.avatarNodeName, 'avatar-aaaaaaaa-2', 'B gets -2, never SESSION_CONFLICT')

    // Both avatar adds under the allocated names are accepted.
    const nodeA = await addAvatarAs(a.ws, world, 'aaaaaaaa-1111-1111-1111-111111111111', helloA.avatarNodeName)
    const nodeB = await addAvatarAs(b.ws, world, 'aaaaaaaa-2222-2222-2222-222222222222', helloB.avatarNodeName)
    assert.ok(nodeA, 'A avatar created')
    assert.ok(nodeB, 'B avatar created')

    // B's view moves only B's node.
    b.ws.send(JSON.stringify({ type: 'view', seq: 5, position: [9, 0, 0] }))
    await delay(80)
    assert.deepEqual(nodeB.translation, [9, 0, 0], 'B moved B')
    assert.deepEqual(nodeA.translation, [0, 0, 0], 'A was not moved by B')

    // B's disconnect removes only B, and broadcasts a remove for B only.
    b.ws.close()
    await waitForClose(b.ws)
    await delay(80)
    assert.equal(world.som.getNodeByName(helloB.avatarNodeName), null, 'B avatar removed')
    assert.ok(world.som.getNodeByName(helloA.avatarNodeName), 'A avatar survives')
    assert.ok(await waitFor(a.messages, m => m.type === 'remove' && m.id === 'aaaaaaaa-2222-2222-2222-222222222222'),
      'a remove for B was broadcast')
    assert.equal(await waitFor(a.messages, m => m.type === 'remove' && m.id === 'aaaaaaaa-1111-1111-1111-111111111111', 120), null,
      'no remove for A')
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

test('K9: a permanent node holds the prefix, so the visitor gets -2; the node survives an autosave', async () => {
  const world = await createWorld(SPACE)
  const { port, sessions } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  // A permanent world node that claims the base name.
  const perm = world.som.ingestNode({ name: 'avatar-aaaaaaaa', translation: [0, 0, 0] })
  world.som.scene.addChild(perm)

  const a = await connect(port)
  try {
    const helloA = await hello(a.ws, a.messages, 'aaaaaaaa-3333-3333-3333-333333333333')
    assert.equal(helloA.avatarNodeName, 'avatar-aaaaaaaa-2', 'the visitor gets -2 around the permanent node')

    const nodeA = await addAvatarAs(a.ws, world, 'aaaaaaaa-3333-3333-3333-333333333333', helloA.avatarNodeName)
    assert.ok(nodeA)

    // Simulate the autosave exclusion path: serialize excluding the live avatar
    // nodes; the permanent node must still be written.
    const excludeNodes = []
    for (const [, s] of sessions) if (s.avatarNode) excludeNodes.push(s.avatarNode)
    const dump = await world.serialize({ excludeNodes })
    const names = (dump.nodes ?? []).map(n => n.name)
    assert.ok(names.includes('avatar-aaaaaaaa'), 'the permanent node is written')
    assert.ok(!names.includes('avatar-aaaaaaaa-2'), 'the visitor avatar is excluded')

    // After the visitor disconnects the permanent node still exists.
    a.ws.close()
    await waitForClose(a.ws)
    await delay(80)
    assert.ok(world.som.getNodeByName('avatar-aaaaaaaa'), 'the permanent node survives the disconnect')
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

test('K9: a session whose avatar add was refused owns nothing — view moves nothing, disconnect removes nothing', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startOpenWorld(world)
  const a = await connect(port)
  const b = await connect(port)
  try {
    const helloA = await hello(a.ws, a.messages, 'cccccccc-1111-1111-1111-111111111111')
    const nodeA = await addAvatarAs(a.ws, world, 'cccccccc-1111-1111-1111-111111111111', helloA.avatarNodeName)
    assert.ok(nodeA)

    const helloB = await hello(b.ws, b.messages, 'dddddddd-2222-2222-2222-222222222222')

    // Forged name: B tries to add an avatar under A's name -> refused.
    b.ws.send(JSON.stringify({
      type: 'add', id: 'dddddddd-2222-2222-2222-222222222222', seq: 40, format: 'gltf',
      node: { name: helloA.avatarNodeName, translation: [0, 0, 0] },
    }))
    const err = await waitFor(b.messages, m => m.type === 'error' && m.seq === 40)
    assert.ok(err, 'B is refused')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(helloB.avatarNodeName, 'avatar-dddddddd')

    // B's view moves nothing.
    b.ws.send(JSON.stringify({ type: 'view', seq: 41, position: [7, 7, 7] }))
    await delay(80)
    assert.deepEqual(nodeA.translation, [0, 0, 0], 'B moved nothing of A')

    // B's disconnect removes nothing and broadcasts no remove.
    b.ws.close()
    await waitForClose(b.ws)
    await delay(80)
    assert.ok(world.som.getNodeByName(helloA.avatarNodeName), 'A avatar survives B disconnect')
    assert.equal(await waitFor(a.messages, m => m.type === 'remove' && m.id === 'dddddddd-2222-2222-2222-222222222222', 150), null,
      'no remove broadcast for a session without an avatar')
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

test('K9: join carries the allocated name and a peer routes B views to B avatar', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startOpenWorld(world)
  const a = await connect(port)
  const b = await connect(port)
  try {
    const helloA = await hello(a.ws, a.messages, 'eeeeeeee-1111-1111-1111-111111111111')
    const helloB = await hello(b.ws, b.messages, 'eeeeeeee-2222-2222-2222-222222222222')
    assert.equal(helloB.avatarNodeName, 'avatar-eeeeeeee-2')

    // A receives a join for B carrying B's allocated name.
    const joinB = await waitFor(a.messages, m => m.type === 'join' && m.id === helloB.id)
    assert.ok(joinB, 'A sees B join')
    assert.equal(joinB.avatar.nodeName, 'avatar-eeeeeeee-2', 'join carries the allocated name')

    const nodeA = await addAvatarAs(a.ws, world, 'eeeeeeee-1111-1111-1111-111111111111', helloA.avatarNodeName)
    const nodeB = await addAvatarAs(b.ws, world, 'eeeeeeee-2222-2222-2222-222222222222', helloB.avatarNodeName)

    // B's view moves B, not A.
    b.ws.send(JSON.stringify({ type: 'view', seq: 50, position: [1, 2, 3] }))
    await delay(80)
    assert.deepEqual(nodeB.translation, [1, 2, 3])
    assert.deepEqual(nodeA.translation, [0, 0, 0])
  } finally {
    a.ws.close(); b.ws.close()
    await Promise.all([waitForClose(a.ws), waitForClose(b.ws)])
  }
})
