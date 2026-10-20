// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-extras — models-by-url step 1 (Z1 server side, Z8, A6).
//
// The shared vectors (tests/fixtures/model-spec-vectors.json, read by the
// server's, the client's and Duplicate's tests — none keeps its own copy) run
// through both halves of the server check: `checkAtriumExtras` (the value
// rules, reached by `add`) and `checkModelHost` (the same rules plus "a model
// node has no mesh"). Then `add` over a real session: a valid model node is
// accepted, broadcast and saved; each invalid kind is refused with nothing
// applied, broadcast or saved; an avatar add carrying a model is still refused.
// Then the `send` default deny on every spelling of the model namespace.
//
// Real WebSocket servers over a real file world on port 3070 (models-by-url);
// every socket is closed in finally.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import {
  checkAtriumExtras, checkModelHost, modelExtrasProblem, authorizeSend, resolveSendTarget,
} from '../src/send-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/model-spec-vectors.json'), 'utf8'))

const PORT = 3070

// ---------------------------------------------------------------------------
// Lifecycle and helpers
// ---------------------------------------------------------------------------

const closers = []
after(async () => {
  for (const close of closers.reverse()) {
    try { await close() } catch { /* best effort */ }
  }
})

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function listen(http, port = 0) {
  return new Promise((res, rej) => {
    http.once('error', rej)
    http.listen(port, '127.0.0.1', () => res(http.address().port))
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

async function waitFor(messages, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = messages.find(predicate)
    if (found) return found
    await delay(5)
  }
  return null
}

async function connect(port, id = 'model-extras') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
  await waitFor(messages, (m) => m.type === 'hello')
  return { ws, messages }
}

function resourceCounts(world) {
  const root = world.som.document.getRoot()
  return {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    accessors: root.listAccessors().length,
  }
}

async function startOwnerWorld(port) {
  const world = await createWorld(SPACE)
  const http = createServer()
  const boundPort = await listen(http, port)
  const wss = new WebSocketServer({ noServer: true })
  const state = { saves: 0 }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions: new Map(),
    presence: { add() {}, remove() { return null }, list() { return [] }, setPosition() {} },
    worldOwnerUserId: 'user-a',
    onSaveableMutation: () => { state.saves += 1 },
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, 'user-a'))
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port: boundPort, state }
}

// ---------------------------------------------------------------------------
// Z1 — the shared vectors, both halves
// ---------------------------------------------------------------------------

test('Z1: every shared spec vector gets its verdict from checkAtriumExtras and modelExtrasProblem', () => {
  assert.ok(VECTORS.specs.length >= 60, 'the vectors file carries the adversarial cases')
  for (const vector of VECTORS.specs) {
    const decided = checkAtriumExtras(vector.extras)
    assert.equal(decided.ok, vector.ok, `${vector.label}: checkAtriumExtras said ${decided.code} ${decided.message}`)
    if (!vector.ok) {
      assert.equal(decided.code, 'INVALID_VALUE', `${vector.label}: the code is INVALID_VALUE`)
      assert.ok(decided.message && decided.message.length > 0, `${vector.label}: a message names the rule`)
    }
    const reason = modelExtrasProblem(vector.extras)
    assert.equal(reason, vector.ok ? null : vector.reason,
      `${vector.label}: the shared reason code`)
  }
})

test('Z1/A6: every shared node vector gets its verdict from checkModelHost', () => {
  assert.ok(VECTORS.nodes.some((v) => v.reason === 'mesh'), 'the vectors carry the mesh case')
  for (const vector of VECTORS.nodes) {
    const decided = checkModelHost(vector.node)
    assert.equal(decided.ok, vector.ok, `${vector.label}: checkModelHost said ${decided.code} ${decided.message}`)
    if (!vector.ok) assert.equal(decided.code, 'INVALID_VALUE', `${vector.label}: the code is INVALID_VALUE`)
  }
})

test('Z1: a model value the new check refuses is refused by checkAtriumExtras too', () => {
  // The gap P2 describes: today any owner can plant any value there.
  for (const bad of [
    { atrium: { model: { url: 'javascript:alert(1)' } } },
    { atrium: { model: { url: 'http://h/m.glb' } } },
    { atrium: { model: { url: '/m.glb', extra: 1 } } },
    { atrium: { model: 'https://h/m.glb' } },
  ]) {
    assert.equal(checkAtriumExtras(bad).ok, false, JSON.stringify(bad))
  }
  // …and a teleporter is still checked first and still accepted.
  assert.equal(checkAtriumExtras({ atrium: { teleporter: { destination: '/x' } } }).ok, true)
  assert.equal(checkAtriumExtras({ atrium: { teleporter: { destination: 42 } } }).ok, false)
})

// ---------------------------------------------------------------------------
// Z8 — `add` over a real session
// ---------------------------------------------------------------------------

test('Z8: a valid model node is accepted, broadcast and saved', async () => {
  const { world, port, state } = await startOwnerWorld(PORT)
  const { ws, messages } = await connect(port)
  const peer = await connect(port, 'model-extras-peer')
  try {
    const node = {
      name: 'model-ok',
      extras: { atrium: { model: { url: 'https://cdn.example.com/chair.glb', bounds: [1, 1, 1] } } },
    }
    ws.send(JSON.stringify({ type: 'add', seq: 101, node }))
    const added = await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'model-ok')
    assert.ok(added, 'the add is accepted')
    assert.match(added.node.extras.atrium.model.url, /^https:\/\//, 'the value survives whole')
    assert.ok(world.som.getNodeByName('model-ok'), 'the node is in the world')
    assert.ok(state.saves > 0, 'an accepted add is a saveable mutation')
    const peerAdd = await waitFor(peer.messages, (m) => m.type === 'add' && m.node?.name === 'model-ok')
    assert.ok(peerAdd, 'the add is broadcast to the peer')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('Z8: each invalid kind is refused with nothing applied, broadcast or saved', async () => {
  const { world, port, state } = await startOwnerWorld(PORT + 1)
  const { ws, messages } = await connect(port)
  const peer = await connect(port, 'model-extras-peer')
  try {
    const cases = [
      { name: 'model-js', node: { name: 'model-js', extras: { atrium: { model: { url: 'javascript:1' } } } } },
      { name: 'model-http', node: { name: 'model-http', extras: { atrium: { model: { url: 'http://h/m.glb' } } } } },
      { name: 'model-extra-key', node: { name: 'model-extra-key', extras: { atrium: { model: { url: '/m.glb', playback: {} } } } } },
      { name: 'model-mesh', node: { name: 'model-mesh', mesh: { primitives: [] }, extras: { atrium: { model: { url: 'https://h/m.glb' } } } } },
    ]
    let seq = 200
    for (const c of cases) {
      const before = resourceCounts(world)
      const savesBefore = state.saves
      const peerBefore = peer.messages.length
      ws.send(JSON.stringify({ type: 'add', seq, node: c.node }))
      const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === seq)
      assert.ok(err, `${c.name}: refused`)
      assert.equal(err.code, 'INVALID_VALUE', `${c.name}: INVALID_VALUE`)
      await delay(60)
      assert.equal(world.som.getNodeByName(c.name), null, `${c.name}: not in the world`)
      assert.deepEqual(resourceCounts(world), before, `${c.name}: nothing applied`)
      assert.equal(state.saves, savesBefore, `${c.name}: nothing saved`)
      assert.deepEqual(peer.messages.slice(peerBefore).filter((m) => ['add', 'set', 'remove'].includes(m.type)), [],
        `${c.name}: nothing broadcast`)
      seq += 1
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('Z8/K4: an avatar add carrying a model is still refused', async () => {
  const { world, port } = await startOwnerWorld(PORT + 2)
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  const avatarId = 'avatar-model-test'
  try {
    ws.send(JSON.stringify({
      type: 'hello', id: avatarId,
      capabilities: { tick: { interval: 5000 } },
    }))
    const hello = await waitFor(messages, (m) => m.type === 'hello')
    assert.ok(hello, 'hello reply')
    const name = `User-${avatarId.slice(0, 4)}`
    ws.send(JSON.stringify({
      type: 'add', seq: 300, id: avatarId,
      node: { name, extras: { atrium: { model: { url: 'https://h/m.glb' } } } },
    }))
    const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 300)
    assert.ok(err, 'the avatar add is refused')
    assert.equal(err.code, 'PERMISSION_DENIED', 'K4 refuses any own extras.atrium on an avatar')
    assert.equal(world.som.getNodeByName(name), null, 'no avatar node was added')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ---------------------------------------------------------------------------
// Z1/L3 — `send` is unchanged: the model namespace stays default-deny
// ---------------------------------------------------------------------------

test('Z1/L3: send to extras.atrium.model.url, extras.atrium.model, extras.atrium and extras is refused', async () => {
  const world = await createWorld(SPACE)
  const node = world.som.document.getRoot().listNodes()
    .map((n) => world.som.getNodeByName(n.getName()))
    .find((n) => n && n.name && !n.extras?.atrium?.ephemeral)
  assert.ok(node, 'a node to address')

  const fields = [
    'extras.atrium.model.url',
    'extras.atrium.model',
    'extras.atrium',
    'extras',
  ]
  for (const field of fields) {
    for (const value of [
      { url: 'https://h/m.glb' },
      { atrium: { model: { url: 'https://h/m.glb' } } },
      '/m.glb',
    ]) {
      const decision = authorizeSend({ target: node, nodeName: node.name, field, value })
      assert.equal(decision.ok, false, `${field} must be refused`)
      assert.equal(decision.code, 'PERMISSION_DENIED', `${field} is default-deny`)
    }
  }
})
