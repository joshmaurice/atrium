// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// animation-extras — scripting-4a step 1 (Z1's server copy, Z2's node and value
// rules, Z2's `add` half).
//
// The shared vectors (tests/fixtures/animation-spec-vectors.json, also read by
// the client's test — neither keeps its own copy) run through
// `animationValueProblem`. Then the node rule (`authorizeSend`) and the `add`
// rule (`checkAtriumExtras`), pure, and then over a real WebSocket server on
// port 0: an owner `send` of the leaf on a model node is accepted, applied and
// broadcast; a non-model node is refused INVALID_FIELD; a bad value is refused
// INVALID_VALUE; `null` is accepted; a visitor is refused; the leaf survives a
// save and a reload.
//
// The STAMP is scripting-4a's other half of Z2 and lives in animation-stamp.test.js.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import {
  animationValueProblem, checkAtriumExtras, checkAnimationValue, authorizeSend,
  ANIMATION_LEAF,
} from '../src/send-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/animation-spec-vectors.json'), 'utf8'))

const MODEL_URL = 'https://cdn.example.com/walker.glb'
const VALUE = { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 }

/**
 * The refused Z1 vectors that are also refused by Z2 — every one except `null`,
 * which Z1 calls `animation-type` but Z2 accepts as its own "stopped" value. The
 * `null` acceptance is pinned separately, in the add and send tests below.
 */
const BAD_VALUES = VECTORS.values.filter((v) => !v.ok && v.value !== null)

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

async function waitFor(messages, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = messages.find(predicate)
    if (found) return found
    await delay(5)
  }
  return null
}

/** A world whose owner is 'user-a'; a socket opened at /visitor is 'user-b'. */
async function startWorld() {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const state = { saves: 0 }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions: new Map(),
    presence: { add() {}, remove() { return null }, list() { return [] }, setPosition() {} },
    worldOwnerUserId: 'user-a',
    onSaveableMutation: () => { state.saves += 1 },
  })
  http.on('upgrade', (req, socket, head) => {
    const userId = String(req.url ?? '').includes('visitor') ? 'user-b' : 'user-a'
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, userId))
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, state }
}

async function connect(port, path = '/', id = 'animation-extras') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
  await waitFor(messages, (m) => m.type === 'hello')
  return { ws, messages }
}

/** Add a model node over the owner socket and wait for the broadcast. */
async function addModel(ws, messages, name, seq) {
  const node = { name, extras: { atrium: { model: { url: MODEL_URL } } } }
  ws.send(JSON.stringify({ type: 'add', seq, node }))
  return waitFor(messages, (m) => m.type === 'add' && m.node?.name === name)
}

// ---------------------------------------------------------------------------
// Z1 — the shared vectors
// ---------------------------------------------------------------------------

test('Z1: every shared vector gets its verdict from animationValueProblem', () => {
  assert.ok(VECTORS.values.length >= 40, 'the vectors file carries the adversarial cases')
  assert.ok(VECTORS.values.some((v) => v.ok), 'with accepted cases')
  assert.ok(VECTORS.values.some((v) => !v.ok), 'and refused ones')
  for (const vector of VECTORS.values) {
    const reason = animationValueProblem(vector.value)
    assert.equal(reason, vector.ok ? null : vector.reason, `${vector.label}: the shared reason code`)
  }
})

test('Z1: the reason codes are exactly the vector file’s', () => {
  const codes = new Set(VECTORS.values.filter((v) => !v.ok).map((v) => v.reason))
  assert.deepEqual([...codes].sort(),
    ['animation-type', 'clip', 'keys', 'loop', 'playing', 'speed', 'startedAt'])
})

// ---------------------------------------------------------------------------
// Z2 — the `add` half, pure
// ---------------------------------------------------------------------------

test('Z2/add: a model node with the leaf (and with null) is accepted', () => {
  assert.equal(checkAtriumExtras({ atrium: { model: { url: MODEL_URL }, animation: VALUE } }).ok, true)
  assert.equal(checkAtriumExtras({ atrium: { model: { url: MODEL_URL }, animation: null } }).ok, true)
  assert.equal(checkAtriumExtras({ atrium: { model: { url: MODEL_URL } } }).ok, true, 'absent is still fine')
  assert.equal(checkAtriumExtras({ atrium: { model: { url: MODEL_URL } } }).code, null)
})

test('Z2/add: a node that is not a model may not carry the leaf, null included', () => {
  for (const animation of [VALUE, null]) {
    const decided = checkAtriumExtras({ atrium: { animation } })
    assert.equal(decided.ok, false, `animation: ${JSON.stringify(animation)}`)
    assert.equal(decided.code, 'INVALID_VALUE')
    assert.match(decided.message, /only allowed on a model node/)
  }
  // …and a teleporter node is not a model node either.
  assert.equal(checkAtriumExtras({ atrium: { teleporter: { destination: '/' }, animation: VALUE } }).ok, false)
})

test('Z2/add: a bad value on a model node is refused with its reason', () => {
  for (const vector of BAD_VALUES) {
    const decided = checkAtriumExtras({ atrium: { model: { url: MODEL_URL }, animation: vector.value } })
    assert.equal(decided.ok, false, vector.label)
    assert.equal(decided.code, 'INVALID_VALUE', vector.label)
    assert.ok(decided.message && decided.message.length > 0, `${vector.label}: a message names the rule`)
  }
})

// ---------------------------------------------------------------------------
// Z2 — the `send` half, pure
// ---------------------------------------------------------------------------

async function somWithTwoNodes() {
  const world = await createWorld(SPACE)
  const model = world.som.ingestNode({ name: 'Model', extras: { atrium: { model: { url: MODEL_URL } } } })
  const plain = world.som.ingestNode({ name: 'Plain' })
  return { world, model, plain }
}

test('Z2/send: the leaf is allowed on a model node and refused on any other', async () => {
  const { model, plain } = await somWithTwoNodes()

  const ok = authorizeSend({ target: model, nodeName: 'Model', field: ANIMATION_LEAF, value: VALUE })
  assert.equal(ok.ok, true, `${ok.code} ${ok.message}`)

  const refused = authorizeSend({ target: plain, nodeName: 'Plain', field: ANIMATION_LEAF, value: VALUE })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'INVALID_FIELD')
  assert.equal(refused.message, 'extras.atrium.animation is only allowed on a model node')
})

test('Z2/send: null is accepted on a model node and refused on any other', async () => {
  const { model, plain } = await somWithTwoNodes()
  assert.equal(authorizeSend({ target: model, nodeName: 'Model', field: ANIMATION_LEAF, value: null }).ok, true)
  const refused = authorizeSend({ target: plain, nodeName: 'Plain', field: ANIMATION_LEAF, value: null })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'INVALID_FIELD')
})

test('Z2/send: a bad value is refused INVALID_VALUE with the reason’s message', async () => {
  const { model } = await somWithTwoNodes()
  for (const vector of BAD_VALUES) {
    const decided = authorizeSend({ target: model, nodeName: 'Model', field: ANIMATION_LEAF, value: vector.value })
    assert.equal(decided.ok, false, vector.label)
    assert.equal(decided.code, 'INVALID_VALUE', vector.label)
    assert.ok(decided.message && decided.message.length > 0, vector.label)
  }
})

test('Z2/send: a node that loses its model can no longer receive the leaf', async () => {
  const { model } = await somWithTwoNodes()
  assert.equal(authorizeSend({ target: model, nodeName: 'Model', field: ANIMATION_LEAF, value: VALUE }).ok, true)
  delete model.extras.atrium.model
  const refused = authorizeSend({ target: model, nodeName: 'Model', field: ANIMATION_LEAF, value: VALUE })
  assert.equal(refused.ok, false, 'the resolved node is read, not the document’s extras')
  assert.equal(refused.code, 'INVALID_FIELD')
})

// ---------------------------------------------------------------------------
// Z2 — over a real session
// ---------------------------------------------------------------------------

test('Z2: an owner send of a valid value is accepted, applied and broadcast to the peer', async () => {
  const { world, port } = await startWorld()
  const { ws, messages } = await connect(port)
  const peer = await connect(port, '/', 'animation-peer')
  try {
    assert.ok(await addModel(ws, messages, 'Model-ok', 101), 'the model node is added')
    assert.ok(await waitFor(peer.messages, (m) => m.type === 'add' && m.node?.name === 'Model-ok'), 'peer saw it')

    ws.send(JSON.stringify({ type: 'send', seq: 102, node: 'Model-ok', field: ANIMATION_LEAF, value: VALUE }))
    const echoed = await waitFor(messages, (m) => m.type === 'set' && m.requestSeq === 102)
    assert.ok(echoed, 'the owner gets its echo')
    assert.equal(echoed.field, ANIMATION_LEAF)
    assert.equal(echoed.value.clip, 'Walk')
    const onPeer = await waitFor(peer.messages, (m) => m.type === 'set' && m.field === ANIMATION_LEAF)
    assert.ok(onPeer, 'the peer is broadcast the leaf')
    assert.deepEqual(
      { clip: onPeer.value.clip, playing: onPeer.value.playing, loop: onPeer.value.loop, speed: onPeer.value.speed },
      { clip: 'Walk', playing: true, loop: true, speed: 1 })
    assert.deepEqual(world.som.getNodeByName('Model-ok').extras.atrium.animation, echoed.value,
      'the node carries what was broadcast')
  } finally {
    ws.close(); await waitForClose(ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('Z2: a non-model node, a bad value and a visitor are each refused with nothing applied', async () => {
  const { world, port, state } = await startWorld()
  const { ws, messages } = await connect(port)
  const visitor = await connect(port, '/visitor', 'animation-visitor')
  try {
    world.som.ingestNode({ name: 'Plain' })

    // A non-model node: INVALID_FIELD.
    ws.send(JSON.stringify({ type: 'send', seq: 201, node: 'Plain', field: ANIMATION_LEAF, value: VALUE }))
    const notModel = await waitFor(messages, (m) => m.type === 'error' && m.seq === 201)
    assert.ok(notModel, 'refused')
    assert.equal(notModel.code, 'INVALID_FIELD')
    assert.equal(notModel.message, 'extras.atrium.animation is only allowed on a model node')

    // A visitor: the mutation gate.
    const peer = await connect(port, '/', 'animation-owner-2')
    try {
      assert.ok(await addModel(peer.ws, peer.messages, 'Model-v', 202), 'the model node is added')
      visitor.ws.send(JSON.stringify({ type: 'send', seq: 203, node: 'Model-v', field: ANIMATION_LEAF, value: VALUE }))
      const denied = await waitFor(visitor.messages, (m) => m.type === 'error' && m.seq === 203)
      assert.ok(denied, 'the visitor is refused')
      assert.equal(denied.code, 'PERMISSION_DENIED')
    } finally {
      peer.ws.close(); await waitForClose(peer.ws)
    }

    // A bad value on a real model node.
    const savesBefore = state.saves
    ws.send(JSON.stringify({ type: 'send', seq: 204, node: 'Model-v', field: ANIMATION_LEAF, value: { ...VALUE, speed: 0 } }))
    const badValue = await waitFor(messages, (m) => m.type === 'error' && m.seq === 204)
    assert.ok(badValue, 'refused')
    assert.equal(badValue.code, 'INVALID_VALUE')
    assert.match(badValue.message, /speed/)

    await delay(50)
    assert.equal(world.som.getNodeByName('Plain').extras.atrium?.animation, undefined, 'nothing on the plain node')
    assert.equal(world.som.getNodeByName('Model-v').extras.atrium.animation, undefined, 'nothing for the bad value')
    assert.equal(state.saves, savesBefore, 'a refused value saves nothing')
  } finally {
    ws.close(); await waitForClose(ws)
    visitor.ws.close(); await waitForClose(visitor.ws)
  }
})

test('Z2: null (Stop) is accepted and applied on a model node', async () => {
  const { world, port } = await startWorld()
  const { ws, messages } = await connect(port)
  try {
    assert.ok(await addModel(ws, messages, 'Model-stop', 301), 'the model node is added')
    ws.send(JSON.stringify({ type: 'send', seq: 302, node: 'Model-stop', field: ANIMATION_LEAF, value: VALUE }))
    assert.ok(await waitFor(messages, (m) => m.type === 'set' && m.requestSeq === 302), 'it plays')
    ws.send(JSON.stringify({ type: 'send', seq: 303, node: 'Model-stop', field: ANIMATION_LEAF, value: null }))
    const stopped = await waitFor(messages, (m) => m.type === 'set' && m.requestSeq === 303)
    assert.ok(stopped, 'the stop is accepted')
    assert.equal(stopped.value, null)
    assert.equal(world.som.getNodeByName('Model-stop').extras.atrium.animation, null, 'stored as null')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('Z2/add: a node carrying the leaf is accepted over a session; a bad one is refused with nothing applied', async () => {
  const { world, port, state } = await startWorld()
  const { ws, messages } = await connect(port)
  try {
    const good = {
      name: 'Model-add-ok',
      extras: { atrium: { model: { url: MODEL_URL }, animation: { ...VALUE, startedAt: 4242 } } },
    }
    ws.send(JSON.stringify({ type: 'add', seq: 401, node: good }))
    const added = await waitFor(messages, (m) => m.type === 'add' && m.node?.name === 'Model-add-ok')
    assert.ok(added, 'accepted')
    assert.equal(added.node.extras.atrium.animation.startedAt, 4242, 'an add is NEVER stamped (P6)')
    assert.equal(added.node.extras.atrium.animation.clip, 'Walk')

    const savesBefore = state.saves
    const bad = [
      { name: 'Model-add-nomodel', extras: { atrium: { animation: VALUE } } },
      { name: 'Model-add-badvalue', extras: { atrium: { model: { url: MODEL_URL }, animation: { ...VALUE, clip: '' } } } },
    ]
    let seq = 402
    for (const node of bad) {
      ws.send(JSON.stringify({ type: 'add', seq, node }))
      const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === seq)
      assert.ok(err, `${node.name}: refused`)
      assert.equal(err.code, 'INVALID_VALUE', `${node.name}: INVALID_VALUE`)
      assert.equal(world.som.getNodeByName(node.name), null, `${node.name}: not in the world`)
      seq += 1
    }
    await delay(50)
    assert.equal(state.saves, savesBefore, 'nothing was saved')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('Z2: the leaf survives a save and a reload', async () => {
  const { world, port } = await startWorld()
  const { ws, messages } = await connect(port)
  try {
    assert.ok(await addModel(ws, messages, 'Model-saved', 501), 'the model node is added')
    ws.send(JSON.stringify({ type: 'send', seq: 502, node: 'Model-saved', field: ANIMATION_LEAF, value: VALUE }))
    const echoed = await waitFor(messages, (m) => m.type === 'set' && m.requestSeq === 502)
    assert.ok(echoed, 'it plays')

    const reloaded = await createWorldFromDocument(await world.serialize())
    const node = reloaded.som.getNodeByName('Model-saved')
    assert.ok(node, 'the node is in the reloaded world')
    assert.deepEqual(node.extras.atrium.animation, echoed.value, 'with its animation value as it was saved')
    assert.equal(node.extras.atrium.model.url, MODEL_URL, 'and its model')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('Z2: checkAnimationValue reads the node, not the document', async () => {
  const { model } = await somWithTwoNodes()
  assert.equal(checkAnimationValue(model, VALUE).ok, true)
  assert.equal(checkAnimationValue(null, VALUE).ok, false)
  assert.equal(checkAnimationValue(null, VALUE).code, 'INVALID_FIELD')
})
