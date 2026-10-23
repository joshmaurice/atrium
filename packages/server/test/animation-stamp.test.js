// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// animation-stamp — scripting-4a step 1, Z2's other half: L5(b), the server
// stamps a Play.
//
// When the server accepts a `send` of `extras.atrium.animation` whose value has
// `playing: true`, it replaces `startedAt` with its own `Date.now()` BEFORE it
// applies and broadcasts, and the SAME stamped object is stored and broadcast.
// A `playing: false` send and `null` are not stamped, and `add` is never stamped
// (a Duplicate or an Undo-restored node keeps its value and stays in step, P6).
//
// Real WebSocket server on port 0; every socket is closed in finally.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import { ANIMATION_LEAF } from '../src/send-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const MODEL_URL = 'https://cdn.example.com/walker.glb'
const PLAY = { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 }

const closers = []
after(async () => {
  for (const close of closers.reverse()) {
    try { await close() } catch { /* best effort */ }
  }
})

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function startOwnerWorld() {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await new Promise((res, rej) => {
    http.once('error', rej)
    http.listen(0, '127.0.0.1', () => res(http.address().port))
  })
  const wss = new WebSocketServer({ noServer: true })
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions: new Map(),
    presence: { add() {}, remove() { return null }, list() { return [] }, setPosition() {} },
    worldOwnerUserId: 'user-a',
    onSaveableMutation: () => {},
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, 'user-a'))
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port }
}

async function connect(port, id) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
  await waitFor(messages, (m) => m.type === 'hello')
  return { ws, messages }
}

async function addModel(ws, messages, name, seq) {
  ws.send(JSON.stringify({ type: 'add', seq, node: { name, extras: { atrium: { model: { url: MODEL_URL } } } } }))
  return waitFor(messages, (m) => m.type === 'add' && m.node?.name === name)
}

test('Z2/L5(b): a playing send with startedAt 0 is stored and broadcast with the server’s time', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port, 'stamp-owner')
  const peer = await connect(port, 'stamp-peer')
  try {
    assert.ok(await addModel(ws, messages, 'Model-stamp', 101), 'the model node is added')

    const before = Date.now()
    ws.send(JSON.stringify({ type: 'send', seq: 102, node: 'Model-stamp', field: ANIMATION_LEAF, value: PLAY }))
    const echoed = await waitFor(messages, (m) => m.type === 'set' && m.requestSeq === 102)
    const after = Date.now()

    assert.ok(echoed, 'the owner gets its echo')
    assert.notEqual(echoed.value.startedAt, 0, 'the client’s 0 was replaced')
    assert.ok(echoed.value.startedAt >= before && echoed.value.startedAt <= after,
      `the stamp is the server’s time (${echoed.value.startedAt} not in [${before}, ${after}])`)
    assert.deepEqual(
      { clip: echoed.value.clip, playing: echoed.value.playing, loop: echoed.value.loop, speed: echoed.value.speed },
      { clip: 'Walk', playing: true, loop: true, speed: 1 }, 'every other key is the client’s')

    const stored = world.som.getNodeByName('Model-stamp').extras.atrium.animation
    assert.equal(stored.startedAt, echoed.value.startedAt, 'the STORED value is the stamped one')

    const onPeer = await waitFor(peer.messages, (m) => m.type === 'set' && m.field === ANIMATION_LEAF)
    assert.ok(onPeer, 'the peer is broadcast the leaf')
    assert.equal(onPeer.value.startedAt, echoed.value.startedAt, 'the BROADCAST value is the stamped one')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('Z2/L5(b): a playing:false send is not stamped', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port, 'stamp-owner-2')
  try {
    assert.ok(await addModel(ws, messages, 'Model-nostamp', 201), 'the model node is added')
    const value = { clip: 'Walk', playing: false, loop: false, speed: 2, startedAt: 12345 }
    ws.send(JSON.stringify({ type: 'send', seq: 202, node: 'Model-nostamp', field: ANIMATION_LEAF, value }))
    const echoed = await waitFor(messages, (m) => m.type === 'set' && m.requestSeq === 202)
    assert.ok(echoed, 'accepted')
    assert.equal(echoed.value.startedAt, 12345, 'the client’s value is kept exactly')
    assert.deepEqual(world.som.getNodeByName('Model-nostamp').extras.atrium.animation, value, 'stored as sent')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('Z2/L5(b): null (Stop) is not stamped', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port, 'stamp-owner-3')
  try {
    assert.ok(await addModel(ws, messages, 'Model-null', 301), 'the model node is added')
    ws.send(JSON.stringify({ type: 'send', seq: 302, node: 'Model-null', field: ANIMATION_LEAF, value: null }))
    const echoed = await waitFor(messages, (m) => m.type === 'set' && m.requestSeq === 302)
    assert.ok(echoed, 'accepted')
    assert.equal(echoed.value, null, 'null stays null')
    assert.equal(world.som.getNodeByName('Model-null').extras.atrium.animation, null, 'stored as null')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('Z2/L5(b): an add keeps its startedAt — a Duplicate or an Undo-restored node stays in step', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port, 'stamp-owner-4')
  try {
    const value = { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 987654321 }
    ws.send(JSON.stringify({
      type: 'add', seq: 401,
      node: { name: 'Model-add', extras: { atrium: { model: { url: MODEL_URL }, animation: value } } },
    }))
    const added = await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'Model-add')
    assert.ok(added, 'accepted')
    assert.equal(added.node.extras.atrium.animation.startedAt, 987654321, 'an add is NEVER stamped')
    assert.deepEqual(world.som.getNodeByName('Model-add').extras.atrium.animation, value, 'and it is stored as sent')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('Z2/L5(b): the stamp runs after the value check — a refused value is never stamped', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port, 'stamp-owner-5')
  try {
    assert.ok(await addModel(ws, messages, 'Model-refused', 501), 'the model node is added')
    ws.send(JSON.stringify({
      type: 'send', seq: 502, node: 'Model-refused', field: ANIMATION_LEAF,
      value: { ...PLAY, startedAt: -5 },
    }))
    const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 502)
    assert.ok(err, 'refused')
    assert.equal(err.code, 'INVALID_VALUE')
    await delay(40)
    assert.equal(world.som.getNodeByName('Model-refused').extras.atrium.animation, undefined,
      'nothing was applied, so nothing was stamped')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})
