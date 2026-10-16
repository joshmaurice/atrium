// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// add-extras — Phase 3 server-cleanup, K4/L5 (the `add`-path extras.atrium
// checks) and its authority cases (§7.2).
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
import { attachSessionHandlers } from '../src/session.js'

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
  ws.send(JSON.stringify({
    type: 'hello',
    id,
    capabilities: { tick: { interval: 5000 } },
  }))
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

/** Resource counts straight from the glTF root, for the side-effect checks. */
function resourceCounts(world) {
  const root = world.som.document.getRoot()
  return {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    accessors: root.listAccessors().length,
  }
}

// ---------------------------------------------------------------------------
// Servers — a real world with an authenticated owner and a save counter, so
// every refusal can be checked for "changes nothing, broadcasts nothing,
// saves nothing".
// ---------------------------------------------------------------------------

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
  closers.push(async () => {
    closeKeepalive(); wss.close(); http.close()
  })
  return { world, port, state }
}

/**
 * Send `message` as the owner, expect `code`, and assert the refusal's side
 * effects: identical resource counts, no save, and nothing at the peer.
 */
async function expectRefusal({ ws, messages, peer, world, state, message, code }) {
  const before = resourceCounts(world)
  const savesBefore = state.saves
  const peerBefore = peer.messages.length
  ws.send(JSON.stringify(message))
  const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === message.seq)
  assert.ok(err, `expected an error for seq ${message.seq}`)
  assert.equal(err.code, code, `expected ${code}, got ${err.code} (${err.message})`)
  await delay(80)
  assert.deepEqual(resourceCounts(world), before, 'a refusal changes no resource')
  assert.equal(state.saves, savesBefore, 'a refusal saves nothing')
  const peerNew = peer.messages.slice(peerBefore)
    .filter((m) => ['set', 'add', 'remove'].includes(m.type))
  assert.deepEqual(peerNew, [], 'a refusal broadcasts nothing')
  return err
}

// ---------------------------------------------------------------------------
// K4/L5 — the non-avatar rows of the table
// ---------------------------------------------------------------------------

test('K4: a non-avatar add with no extras, no atrium, or no teleporter is accepted', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k4-owner')
    await hello(peer.ws, peer.messages, 'k4-peer')

    const rows = [
      { name: 'k4-none',      node: { name: 'k4-none' } },
      { name: 'k4-noatrium',  node: { name: 'k4-noatrium', extras: { displayName: 'x' } } },
      { name: 'k4-notele',    node: { name: 'k4-notele', extras: { atrium: { behavior: { spin: true } } } } },
      { name: 'k4-emptydest', node: { name: 'k4-emptydest', extras: { atrium: { teleporter: { destination: '' } } } } },
      { name: 'k4-max',       node: { name: 'k4-max', extras: { atrium: { teleporter: { destination: 'a'.repeat(2048) } } } } },
    ]
    let seq = 200
    for (const row of rows) {
      ws.send(JSON.stringify({ type: 'add', seq: seq++, node: row.node }))
      const added = await waitFor(messages, (m) => m.type === 'add' && m.node?.name === row.name)
      assert.ok(added, `${row.name} must be accepted`)
      assert.ok(world.som.getNodeByName(row.name), `${row.name} is in the world`)
    }
    assert.ok(state.saves > 0, 'accepted non-avatar adds are saveable mutations')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K4: an add whose extras.atrium is not a plain object is INVALID_VALUE', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k4-owner')
    await hello(peer.ws, peer.messages, 'k4-peer')

    for (const [i, atrium] of [5, 'x', [], null, true].entries()) {
      const err = await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'add', seq: 300 + i, node: { name: `k4-bad-atrium-${i}`, extras: { atrium } } },
        code: 'INVALID_VALUE',
      })
      assert.match(err.message, /extras\.atrium must be an object/)
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K4: an add whose teleporter is not a plain object is INVALID_VALUE', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k4-owner')
    await hello(peer.ws, peer.messages, 'k4-peer')

    for (const [i, teleporter] of [null, [], 'x', 42, true].entries()) {
      const err = await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'add', seq: 320 + i, node: { name: `k4-bad-tele-${i}`, extras: { atrium: { teleporter } } } },
        code: 'INVALID_VALUE',
      })
      assert.match(err.message, /teleporter must be an object/)
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K4: a teleporter with no destination is INVALID_VALUE "destination must be a string"', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k4-owner')
    await hello(peer.ws, peer.messages, 'k4-peer')

    const err = await expectRefusal({
      ws, messages, peer, world, state,
      message: { type: 'add', seq: 340, node: { name: 'k4-nodest', extras: { atrium: { teleporter: {} } } } },
      code: 'INVALID_VALUE',
    })
    assert.match(err.message, /destination must be a string/)
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K4: a non-string destination on add is INVALID_VALUE "destination must be a string"', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k4-owner')
    await hello(peer.ws, peer.messages, 'k4-peer')

    for (const [i, destination] of [42, {}, [], true, null].entries()) {
      const err = await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'add', seq: 360 + i, node: { name: `k4-bad-dest-${i}`, extras: { atrium: { teleporter: { destination } } } } },
        code: 'INVALID_VALUE',
      })
      assert.match(err.message, /destination must be a string/)
    }

    const long = await expectRefusal({
      ws, messages, peer, world, state,
      message: { type: 'add', seq: 370, node: { name: 'k4-long-dest', extras: { atrium: { teleporter: { destination: 'x'.repeat(2049) } } } } },
      code: 'INVALID_VALUE',
    })
    assert.match(long.message, /2048/)
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

// ---------------------------------------------------------------------------
// K4/L5 — the avatar rows
// ---------------------------------------------------------------------------

test('K4: an avatar add carrying any own extras.atrium is PERMISSION_DENIED, and no avatar is created', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'aaaaaaaa')
    await hello(peer.ws, peer.messages, 'bbbbbbbb')

    const cases = [
      { teleporter: { destination: '#' } },
      { behavior: { spin: true } },
      {},
    ]
    for (const [i, atrium] of cases.entries()) {
      const before = resourceCounts(world)
      const peerBefore = peer.messages.length
      const countBefore = messages.length
      ws.send(JSON.stringify({
        type: 'add', id: 'aaaaaaaa', seq: 400 + i,
        node: { name: 'avatar-aaaaaaaa', translation: [0, 0, 0], extras: { atrium } },
      }))
      const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 400 + i)
      assert.ok(err, 'expected an avatar-add refusal')
      assert.equal(err.code, 'PERMISSION_DENIED')
      assert.match(err.message, /extras\.atrium/)
      await delay(80)
      assert.equal(world.som.getNodeByName('avatar-aaaaaaaa'), null, 'the refused avatar was not created')
      assert.deepEqual(resourceCounts(world), before, 'a refusal changes no resource')
      assert.deepEqual(
        messages.slice(countBefore).filter((m) => ['add', 'set', 'remove'].includes(m.type)), [],
        'a refusal echoes nothing')
      assert.deepEqual(
        peer.messages.slice(peerBefore).filter((m) => ['add', 'set', 'remove'].includes(m.type)), [],
        'a refusal broadcasts nothing')
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K4: a first-party-shaped avatar add (extras: { displayName }) is accepted', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'cccccccc')
    ws.send(JSON.stringify({
      type: 'add', id: 'cccccccc', seq: 420,
      node: { name: 'avatar-cccccccc', translation: [0, 0, 0], extras: { displayName: 'ccc' } },
    }))
    // An avatar add broadcasts to everyone EXCEPT its sender (T3), so poll the
    // world rather than the sender's own message stream.
    const node = await waitForNode(world, 'avatar-cccccccc')
    assert.ok(node, 'a displayName-only avatar add is accepted')
    const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 420)
    assert.equal(err, null, 'no error was sent')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ---------------------------------------------------------------------------
// §7.2 — authority: a visitor cannot make their avatar a teleporter
// ---------------------------------------------------------------------------

test('§7.2: a visitor cannot make their avatar a teleporter', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'dddddddd')
    await hello(peer.ws, peer.messages, 'eeeeeeee')

    const peerBefore = peer.messages.length
    ws.send(JSON.stringify({
      type: 'add', id: 'dddddddd', seq: 440,
      node: {
        name: 'avatar-dddddddd', translation: [0, 0, 0],
        extras: { atrium: { teleporter: { destination: '/' } } },
      },
    }))
    const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 440)
    assert.ok(err)
    assert.equal(err.code, 'PERMISSION_DENIED')
    await delay(80)
    assert.equal(world.som.getNodeByName('avatar-dddddddd'), null)
    assert.deepEqual(
      peer.messages.slice(peerBefore).filter((m) => ['add', 'set', 'remove'].includes(m.type)), [])
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})
