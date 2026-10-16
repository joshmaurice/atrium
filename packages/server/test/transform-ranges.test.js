// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// transform-ranges — Phase 3 server-cleanup, K6/L7 (rotation and scale ranges)
// and its authority cases (§7.2).
//
// Real WebSocket servers over a real file world; every server binds port 0 and
// is closed in after(); every socket is closed in finally. No mocks.
//
// L7's numerical policy: the comparisons are plain IEEE doubles with no extra
// allowance, so every value here sits clearly inside or outside the range.

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

function resourceCounts(world) {
  const root = world.som.document.getRoot()
  return {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    accessors: root.listAccessors().length,
  }
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

async function expectRefusal({ ws, messages, peer, world, state, message, code, re }) {
  const before = resourceCounts(world)
  const savesBefore = state.saves
  const peerBefore = peer.messages.length
  ws.send(JSON.stringify(message))
  const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === message.seq)
  assert.ok(err, `expected an error for seq ${message.seq}`)
  assert.equal(err.code, code, `expected ${code}, got ${err.code} (${err.message})`)
  if (re) assert.match(err.message, re)
  await delay(80)
  assert.deepEqual(resourceCounts(world), before, 'a refusal changes no resource')
  assert.equal(state.saves, savesBefore, 'a refusal saves nothing')
  const peerNew = peer.messages.slice(peerBefore)
    .filter((m) => ['set', 'add', 'remove'].includes(m.type))
  assert.deepEqual(peerNew, [], 'a refusal broadcasts nothing')
  return err
}

// The value sets, kept in one place so send/add/avatar-add test the same ones.
const BAD_ROTATIONS = [
  [0, 0, 0, 1.002],   // norm 1 + 2e-3
  [0, 0, 0, 0.998],   // norm 1 - 2e-3
  [0, 0, 0, 0],       // zero quaternion
]
const GOOD_ROTATIONS = [
  [0, 0, 0, 1],       // exact unit
  [0, 0, 0, 1.0005],  // norm 1 + 5e-4
  [0, 0, 0, 0.9995],  // norm 1 - 5e-4
]
const BAD_SCALES = [
  [0, 1, 1],
  [1, 9e-7, 1],
  [1, 1, -9e-7],
]
const GOOD_SCALES = [
  [1, 1, 1],
  [1e-6, 1, 1],
  [-1e-6, 1, 1],
  [-1, 1, 1],         // negative scale stays allowed
]

// ---------------------------------------------------------------------------
// `send`
// ---------------------------------------------------------------------------

test('K6: a non-unit or zero rotation is refused on send, and the node is unchanged', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k6-send')
    await hello(peer.ws, peer.messages, 'k6-peer')
    const node = world.som.getNodeByName('crate-01')
    const rotationBefore = [...node.rotation]

    for (const [i, rotation] of BAD_ROTATIONS.entries()) {
      await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'send', seq: 500 + i, node: 'crate-01', field: 'rotation', value: rotation },
        code: 'INVALID_VALUE',
        re: /unit quaternion/,
      })
      assert.deepEqual([...node.rotation], rotationBefore, 'the rotation is unchanged')
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K6: a zero scale component is refused on send, and the node is unchanged', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k6-send')
    await hello(peer.ws, peer.messages, 'k6-peer')
    const node = world.som.getNodeByName('crate-01')
    const scaleBefore = [...node.scale]

    for (const [i, scale] of BAD_SCALES.entries()) {
      await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'send', seq: 520 + i, node: 'crate-01', field: 'scale', value: scale },
        code: 'INVALID_VALUE',
        re: /non-zero/,
      })
      assert.deepEqual([...node.scale], scaleBefore, 'the scale is unchanged')
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K6: a unit quaternion within tolerance and a non-zero scale are accepted on send', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'k6-send-ok')
    const node = world.som.getNodeByName('crate-01')

    let seq = 540
    for (const rotation of GOOD_ROTATIONS) {
      ws.send(JSON.stringify({ type: 'send', seq: seq++, node: 'crate-01', field: 'rotation', value: rotation }))
      const set = await waitFor(messages, (m) => m.type === 'set' && m.field === 'rotation')
      assert.ok(set, `rotation ${rotation} is accepted`)
      // glTF-Transform normalises on set, so compare the norm, not the input.
      const got = node.rotation
      assert.ok(Math.abs(Math.hypot(got[0], got[1], got[2], got[3]) - 1) <= 1e-3)
    }
    for (const scale of GOOD_SCALES) {
      ws.send(JSON.stringify({ type: 'send', seq: seq++, node: 'crate-01', field: 'scale', value: scale }))
      const set = await waitFor(messages, (m) => m.type === 'set' && m.field === 'scale')
      assert.ok(set, `scale ${scale} is accepted`)
      // glTF-Transform clamps sub-epsilon scale components on set, so only
      // require that every stored component is non-zero.
      assert.ok(node.scale.every((s) => s !== 0))
    }
    assert.ok(state.saves > 0, 'accepted sends are saveable mutations')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ---------------------------------------------------------------------------
// non-avatar `add`
// ---------------------------------------------------------------------------

test('K6: a non-unit or zero rotation is refused on a non-avatar add', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k6-add')
    await hello(peer.ws, peer.messages, 'k6-peer')

    for (const [i, rotation] of BAD_ROTATIONS.entries()) {
      await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'add', seq: 560 + i, node: { name: `k6-bad-rot-${i}`, rotation } },
        code: 'INVALID_VALUE',
        re: /unit quaternion/,
      })
      assert.equal(world.som.getNodeByName(`k6-bad-rot-${i}`), null, 'the node was not added')
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K6: a zero scale component is refused on a non-avatar add', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k6-add')
    await hello(peer.ws, peer.messages, 'k6-peer')

    for (const [i, scale] of BAD_SCALES.entries()) {
      await expectRefusal({
        ws, messages, peer, world, state,
        message: { type: 'add', seq: 580 + i, node: { name: `k6-bad-scale-${i}`, scale } },
        code: 'INVALID_VALUE',
        re: /non-zero/,
      })
      assert.equal(world.som.getNodeByName(`k6-bad-scale-${i}`), null, 'the node was not added')
    }
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K6: a unit quaternion and a non-zero scale are accepted on a non-avatar add', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'k6-add-ok')

    let seq = 600
    for (const [i, rotation] of GOOD_ROTATIONS.entries()) {
      const name = `k6-ok-rot-${i}`
      ws.send(JSON.stringify({ type: 'add', seq: seq++, node: { name, rotation } }))
      const added = await waitFor(messages, (m) => m.type === 'add' && m.node?.name === name)
      assert.ok(added, `rotation ${rotation} is accepted`)
      const got = world.som.getNodeByName(name).rotation
      assert.ok(Math.abs(Math.hypot(got[0], got[1], got[2], got[3]) - 1) <= 1e-3)
    }
    for (const [i, scale] of GOOD_SCALES.entries()) {
      const name = `k6-ok-scale-${i}`
      ws.send(JSON.stringify({ type: 'add', seq: seq++, node: { name, scale } }))
      const added = await waitFor(messages, (m) => m.type === 'add' && m.node?.name === name)
      assert.ok(added, `scale ${scale} is accepted`)
      assert.ok(world.som.getNodeByName(name).scale.every((s) => s !== 0))
    }
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ---------------------------------------------------------------------------
// avatar `add` (the gate is skipped; the value check still runs)
// ---------------------------------------------------------------------------

test('K6: a non-unit or zero rotation is refused on an avatar add', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'ffffffff')
    await hello(peer.ws, peer.messages, 'k6-peer')

    const before = resourceCounts(world)
    for (const [i, rotation] of BAD_ROTATIONS.entries()) {
      ws.send(JSON.stringify({
        type: 'add', id: 'ffffffff', seq: 620 + i,
        node: { name: 'avatar-ffffffff', rotation },
      }))
      const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 620 + i)
      assert.ok(err, 'expected an avatar-add refusal')
      assert.equal(err.code, 'INVALID_VALUE')
      assert.match(err.message, /unit quaternion/)
    }
    await delay(80)
    assert.equal(world.som.getNodeByName('avatar-ffffffff'), null, 'the avatar was not created')
    assert.deepEqual(resourceCounts(world), before, 'the refusals changed nothing')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K6: a zero scale component is refused on an avatar add', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, '11111111')
    await hello(peer.ws, peer.messages, 'k6-peer')

    const before = resourceCounts(world)
    for (const [i, scale] of BAD_SCALES.entries()) {
      ws.send(JSON.stringify({
        type: 'add', id: '11111111', seq: 640 + i,
        node: { name: 'avatar-11111111', scale },
      }))
      const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 640 + i)
      assert.ok(err, 'expected an avatar-add refusal')
      assert.equal(err.code, 'INVALID_VALUE')
      assert.match(err.message, /non-zero/)
    }
    await delay(80)
    assert.equal(world.som.getNodeByName('avatar-11111111'), null, 'the avatar was not created')
    assert.deepEqual(resourceCounts(world), before, 'the refusals changed nothing')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('K6: a unit quaternion and a non-zero scale are accepted on an avatar add', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, '22222222')
    ws.send(JSON.stringify({
      type: 'add', id: '22222222', seq: 660,
      node: { name: 'avatar-22222222', rotation: [0, 0, 0, 1.0005], scale: [-1, 1, 1] },
    }))
    const node = await waitForNode(world, 'avatar-22222222')
    assert.ok(node, 'a first-party-shaped avatar add with legal values is accepted')
    assert.equal(await waitFor(messages, (m) => m.type === 'error' && m.seq === 660), null)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ---------------------------------------------------------------------------
// §7.2 — authority: non-unit rotation and zero scale from the owner
// ---------------------------------------------------------------------------

test('§7.2: a non-unit rotation from the owner is refused on send and on add', async () => {
  const { world, port, state } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, 'k6-authority')
    await hello(peer.ws, peer.messages, 'k6-peer')

    await expectRefusal({
      ws, messages, peer, world, state,
      message: { type: 'send', seq: 680, node: 'crate-01', field: 'rotation', value: [0, 0, 0, 1.01] },
      code: 'INVALID_VALUE', re: /unit quaternion/,
    })
    await expectRefusal({
      ws, messages, peer, world, state,
      message: { type: 'add', seq: 681, node: { name: 'k6-authority-bad', rotation: [0, 0, 0, 0] } },
      code: 'INVALID_VALUE', re: /unit quaternion/,
    })
    assert.equal(world.som.getNodeByName('k6-authority-bad'), null)
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('§7.2: a zero scale in an avatar add is refused and the avatar is not created', async () => {
  const { world, port } = await startOwnerWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port)
  try {
    await hello(ws, messages, '33333333')
    await hello(peer.ws, peer.messages, 'k6-peer')
    const peerBefore = peer.messages.length
    ws.send(JSON.stringify({
      type: 'add', id: '33333333', seq: 690,
      node: { name: 'avatar-33333333', scale: [1, 0, 1] },
    }))
    const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 690)
    assert.ok(err)
    assert.equal(err.code, 'INVALID_VALUE')
    await delay(80)
    assert.equal(world.som.getNodeByName('avatar-33333333'), null)
    assert.deepEqual(
      peer.messages.slice(peerBefore).filter((m) => ['add', 'set', 'remove'].includes(m.type)), [])
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})
