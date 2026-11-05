// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// add-check — the new server test file (§T). Real WebSocket servers on port 0
// through the real `attachSessionHandlers`, with descriptors from the real
// builders and `prepareDuplicate`. Every acceptance check ends with a READ-BACK:
// a later joiner reads its `som-dump` with the client's own WebIO and
// KHRONOS_EXTENSIONS, and a world `add` goes serialize →
// createWorldFromDocument → serialize. "The som-dump arrives" is not a pass
// (`POSITION []` sends one).
//
// Every socket and server is closed in finally / after().

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import {
  buildAvatarDescriptor, buildPrimitiveDescriptor, buildTeleporterDescriptor,
} from '../../renderer-three/src/geometry-utils.js'
import { prepareDuplicate } from '../../../apps/client/src/edit-duplicate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

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

function collect(ws) {
  const messages = []
  ws.on('message', (raw) => {
    try { messages.push(JSON.parse(raw)) } catch { /* ignore */ }
  })
  return messages
}

async function waitFor(messages, pred, timeoutMs = 4000) {
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
  assert.ok(reply, 'a hello reply arrives')
  return reply
}

/** A later joiner connects and returns its som-dump, or null when none arrives. */
async function joinAndReadDump(port, id) {
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, id)
    const dump = await waitFor(messages, (m) => m.type === 'som-dump', 4000)
    return dump
  } finally {
    ws.close()
  }
}

/** Read a dump exactly as the client's `_onSomDump` does. Throws on a bad dump. */
async function readDump(dump) {
  const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
  return io.readJSON({ json: dump.gltf, resources: {} })
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
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req, 'user-a') })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, state }
}

/** An owner connection: its `add`s are world adds. */
async function owner(port) {
  const { ws, messages } = await connect(port)
  await hello(ws, messages, 'owner-a')
  return { ws, messages }
}

/** A visitor connection, with the server-assigned avatar name from hello. */
async function visitor(port, id) {
  const { ws, messages } = await connect(port)
  const reply = await hello(ws, messages, id)
  return { ws, messages, avatarName: reply.avatarNodeName }
}

/** An avatar add exactly as `AtriumClient.connect` sends it: ephemeral marker. */
function avatarAddMessage(id, avatarName, node) {
  return {
    type: 'add', id, seq: 7, format: 'gltf',
    node: {
      name: avatarName,
      ...node,
      extras: { displayName: id, atrium: { ephemeral: true }, ...(node.extras ?? {}) },
    },
  }
}

const pos3 = [0, 0, 0, 1, 0, 0, 0, 1, 0]

/** A refused shape may be caught by the schema first, as UNKNOWN_MESSAGE (A8). */
function assertRefused(err, what) {
  assert.ok(err, `${what} is refused`)
  assert.ok(err.code === 'INVALID_VALUE' || err.code === 'UNKNOWN_MESSAGE',
    `${what}: refused with INVALID_VALUE or UNKNOWN_MESSAGE (${err.code})`)
}

/** A glTF-Transform-shaped node the real `prepareDuplicate` can read. */
function duplicateStandInNode() {
  const positions = [], normals = [], indices = []
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      positions.push((v & 1) - 0.5, (v >> 1) - 0.5, f / 10)
      normals.push(0, 0, 1)
    }
    indices.push(4 * f, 4 * f + 1, 4 * f + 2, 4 * f, 4 * f + 2, 4 * f + 3)
  }
  const accessor = (array, type, componentType) => ({
    getBuffer: () => null, getArray: () => array, getType: () => type,
    getComponentType: () => componentType, getNormalized: () => false, getSparse: () => false,
    getName: () => '', getExtras: () => ({}), listExtensions: () => [],
  })
  const material = {
    getName: () => '', getExtras: () => ({}), listExtensions: () => [],
    getBaseColorTexture: () => null, getMetallicRoughnessTexture: () => null,
    getNormalTexture: () => null, getOcclusionTexture: () => null, getEmissiveTexture: () => null,
    getEmissiveFactor: () => [0, 0, 0], getAlphaMode: () => 'OPAQUE', getDoubleSided: () => false,
    getBaseColorFactor: () => [0.8, 0.8, 0.8, 1], getMetallicFactor: () => 0, getRoughnessFactor: () => 0.8,
  }
  const primitive = {
    getMode: () => 4, getExtras: () => ({}), listExtensions: () => [], listTargets: () => [],
    listSemantics: () => ['POSITION', 'NORMAL'],
    getAttribute: (s) => (s === 'POSITION'
      ? accessor(new Float32Array(positions), 'VEC3', 5126)
      : accessor(new Float32Array(normals), 'VEC3', 5126)),
    getIndices: () => accessor(new Uint16Array(indices), 'SCALAR', 5123),
    getMaterial: () => material,
  }
  const mesh = {
    getName: () => '', getExtras: () => ({}), listExtensions: () => [],
    getWeights: () => [], listPrimitives: () => [primitive],
  }
  return {
    getName: () => 'Cube', getTranslation: () => [1, 0.5, -2], getRotation: () => [0, 0, 0, 1],
    getScale: () => [1, 1, 1], getExtras: () => ({}), getMesh: () => mesh,
    listChildren: () => [], listParents: () => [{ propertyType: 'Root' }, { propertyType: 'Scene' }],
    getCamera: () => null, getSkin: () => null, getWeights: () => [],
    getExtension: () => null, listExtensions: () => [],
  }
}

// ---------------------------------------------------------------------------
// The join tests — the refusals that today stop joins. These fail on the base.
// ---------------------------------------------------------------------------

test('p4: a 4-number POSITION avatar is refused, and a later join reads its dump', async () => {
  const { world, port } = await startOwnerWorld()
  const v = await visitor(port, 'visitor-p4')
  try {
    v.ws.send(JSON.stringify(avatarAddMessage('visitor-p4', v.avatarName, {
      translation: [0, 0.7, 0],
      mesh: { primitives: [{ attributes: { POSITION: [0, 0, 0, 1] }, indices: [0, 1, 2] }] },
    })))
    const err = await waitFor(v.messages, (m) => m.type === 'error')
    assertRefused(err, 'the avatar add')
    assert.equal(world.som.getNodeByName(v.avatarName), null, 'nothing changed')

    const dump = await joinAndReadDump(port, 'joiner-p4')
    assert.ok(dump, 'a later joiner receives its som-dump')
    const doc = await readDump(dump)
    assert.ok(doc, 'the dump reads back with the client\u2019s own WebIO')
  } finally {
    v.ws.close()
  }
})

test('CR-M1: a world add with POSITION [] is refused, and a later join reads its dump', async () => {
  const { world, port } = await startOwnerWorld()
  const o = await owner(port)
  try {
    o.ws.send(JSON.stringify({
      type: 'add', seq: 3, format: 'gltf',
      node: { name: 'bad-empty', mesh: { primitives: [{ attributes: { POSITION: [] } }] } },
    }))
    const err = await waitFor(o.messages, (m) => m.type === 'error')
    assertRefused(err, 'the add')
    assert.equal(world.som.getNodeByName('bad-empty'), null, 'nothing changed')

    const dump = await joinAndReadDump(port, 'joiner-empty')
    assert.ok(dump, 'a later joiner receives its som-dump')
    await readDump(dump)
  } finally {
    o.ws.close()
  }
})

test('CR-M2: a 20,000-primitive avatar is refused, with the reply under 500 ms', async () => {
  const { world, port } = await startOwnerWorld()
  const v = await visitor(port, 'visitor-many')
  try {
    const one = { attributes: { POSITION: pos3 } }
    const primitives = new Array(20000).fill(one)
    const start = performance.now()
    v.ws.send(JSON.stringify(avatarAddMessage('visitor-many', v.avatarName, {
      mesh: { primitives },
    })))
    const err = await waitFor(v.messages, (m) => m.type === 'error', 5000)
    const elapsed = performance.now() - start
    assertRefused(err, 'the avatar add')
    assert.ok(elapsed < 500, `refused from the length alone (${Math.round(elapsed)} ms)`)
    assert.equal(world.som.getNodeByName(v.avatarName), null, 'nothing changed')
  } finally {
    v.ws.close()
  }
})

test('every refusal broadcasts nothing, changes nothing and saves nothing', async () => {
  const { world, port, state } = await startOwnerWorld()
  const o = await owner(port)
  const witness = await connect(port)
  await hello(witness.ws, witness.messages, 'witness')
  try {
    const cases = [
      { name: 'x-big-extras', node: { name: 'x-big-extras', extras: { blob: 'a'.repeat(900 * 1024) }, mesh: { primitives: [{ attributes: { POSITION: pos3 } }] } } },
      { name: 'x-1e39', node: { name: 'x-1e39', mesh: { primitives: [{ attributes: { POSITION: [0, 0, 0, 1, 0, 0, 0, 1, 1e39] } }] } } },
      { name: 'x-ext', node: { name: 'x-ext', extensions: { blob: 'a'.repeat(600 * 1024) }, mesh: { primitives: [{ attributes: { POSITION: pos3 } }] } } },
      { name: 'x-prims', node: { name: 'x-prims', mesh: { primitives: new Array(65).fill({ attributes: { POSITION: pos3 } }) } } },
    ]
    const before = state.saves
    for (const c of cases) {
      o.ws.send(JSON.stringify({ type: 'add', seq: 11, format: 'gltf', node: c.node }))
      const err = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 11, 3000)
      assert.ok(err, `${c.name} is refused`)
      assert.equal(world.som.getNodeByName(c.name), null, `${c.name}: nothing changed`)
      o.messages.length = 0
    }
    await delay(300)
    const broadcast = witness.messages.find((m) => m.type === 'add')
    assert.equal(broadcast, undefined, 'a present client receives no broadcast')
    assert.equal(state.saves, before, 'no autosave is triggered')
  } finally {
    o.ws.close()
    witness.ws.close()
  }
})

// ---------------------------------------------------------------------------
// The other refusals
// ---------------------------------------------------------------------------

test('a wire 1e999 in POSITION, a 600 KB format and a bad translation are refused', async () => {
  const { world, port } = await startOwnerWorld()
  const o = await owner(port)
  try {
    // Raw text: 1e999 overflows to Infinity in the live node (CR-M3/p7).
    o.ws.send('{"type":"add","seq":21,"format":"gltf","node":{"name":"r-inf","mesh":{"primitives":[{"attributes":{"POSITION":[0,0,0,1,0,0,0,1,1e999]}}]}}}')
    const errInf = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 21)
    assert.ok(errInf, 'the wire 1e999 add is refused')
    assert.ok(/position-value/.test(errInf.message), `the mesh's reason (${errInf.message})`)

    o.ws.send('{"type":"add","seq":22,"format":"gltf","node":{"name":"r-badtr","translation":[1e999,0,0],"mesh":{"primitives":[{"attributes":{"POSITION":[0,0,0,1,0,0,0,1,0]}}]}}}')
    const errTr = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 22)
    assert.ok(errTr, 'the bad translation add is refused')
    assert.equal(errTr.message, 'translation must be 3 finite numbers')

    o.ws.send(JSON.stringify({ type: 'add', seq: 23, format: 'x'.repeat(600 * 1024), node: { name: 'r-fmt' } }))
    const errFmt = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 23)
    assert.ok(errFmt, 'the oversized and invalid format is refused')

    for (const name of ['r-inf', 'r-badtr', 'r-fmt']) {
      assert.equal(world.som.getNodeByName(name), null, `${name}: nothing changed`)
    }
  } finally {
    o.ws.close()
  }
})

// ---------------------------------------------------------------------------
// Acceptance: real builders, real handler, read back
// ---------------------------------------------------------------------------

test('the real avatar, the pad and the palette are accepted, broadcast and read back', async () => {
  const { world, port } = await startOwnerWorld()
  const witness = await connect(port)
  await hello(witness.ws, witness.messages, 'witness-acc')
  const v = await visitor(port, 'visitor-acc')
  try {
    // The real avatar descriptor as the client builds it, with the ephemeral marker.
    const avatar = buildAvatarDescriptor('visitor-acc')
    v.ws.send(JSON.stringify(avatarAddMessage('visitor-acc', v.avatarName, {
      translation: avatar.translation, mesh: avatar.mesh,
    })))
    const seen = await waitFor(witness.messages, (m) => m.type === 'add' && m.node?.name === v.avatarName, 3000)
    assert.ok(seen, 'the avatar add is broadcast to the witness')
    assert.equal(world.som.getNodeByName(v.avatarName)?.name, v.avatarName, 'the avatar node exists')

    // The pad and a palette primitive, built by the real builders.
    const o = await owner(port)
    const pad = buildTeleporterDescriptor({ name: 'teleporter-acc', position: [3, 0, 3], destination: 'https://example.test/w' })
    const cube = buildPrimitiveDescriptor({ kind: 'cube', name: 'cube-acc', position: [1, 0, 1] })
    for (const [seq, node] of [[31, pad], [32, cube]]) {
      o.ws.send(JSON.stringify({ type: 'add', seq, format: 'gltf', node }))
      const seenNode = await waitFor(witness.messages, (m) => m.type === 'add' && m.node?.name === node.name, 3000)
      assert.ok(seenNode, `${node.name} is accepted and broadcast`)
      assert.equal(world.som.getNodeByName(node.name)?.name, node.name, `${node.name} exists`)
    }
    o.ws.close()

    // Every accepted node is read back from a later joiner's dump.
    const dump = await joinAndReadDump(port, 'joiner-acc')
    assert.ok(dump, 'a later joiner receives its som-dump')
    const doc = await readDump(dump)
    const names = doc.getRoot().listNodes().map((n) => n.getName())
    for (const name of ['teleporter-acc', 'cube-acc']) {
      assert.ok(names.includes(name), `${name} is in the joiner's dump`)
    }
  } finally {
    v.ws.close()
    witness.ws.close()
  }
})

test('a real Duplicate descriptor is accepted and read back', async () => {
  const { world, port } = await startOwnerWorld()
  // A node the Duplicate engine can read. `prepareDuplicate` is the real
  // function the client runs at click time; this is a glTF-Transform-shaped node
  // (the app's own test uses the same stand-in shape).
  const original = duplicateStandInNode()
  const prepared = prepareDuplicate(original, { name: 'crate-copy' })
  assert.equal(prepared.ok, true, prepared.reason ?? 'the copy is prepared')

  const o = await owner(port)
  try {
    o.ws.send(JSON.stringify({ type: 'add', seq: 41, format: 'gltf', node: prepared.descriptor }))
    const err = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 41, 1500)
    assert.equal(err, null, `the copy is accepted (${err?.message})`)

    const dump = await joinAndReadDump(port, 'joiner-dup')
    assert.ok(dump, 'a later joiner receives its som-dump')
    const read = await readDump(dump)
    assert.ok(read.getRoot().listNodes().some((n) => n.getName() === 'crate-copy'), 'the copy is in the dump')
  } finally {
    o.ws.close()
  }
})

test('a world add goes serialize → createWorldFromDocument → serialize', async () => {
  const { world, port } = await startOwnerWorld()
  const o = await owner(port)
  try {
    const cube = buildPrimitiveDescriptor({ kind: 'sphere', name: 'sphere-roundtrip', position: [2, 0, 2] })
    o.ws.send(JSON.stringify({ type: 'add', seq: 51, format: 'gltf', node: cube }))
    const err = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 51, 1500)
    assert.equal(err, null, `the add is accepted (${err?.message})`)

    const first = await world.serialize()
    const rebuilt = await createWorldFromDocument(JSON.stringify(first))
    const second = await rebuilt.serialize()
    const names = (json) => (json.nodes ?? []).map((n) => n.name)
    assert.ok(names(first).includes('sphere-roundtrip'), 'the node is in the first serialize')
    assert.ok(names(second).includes('sphere-roundtrip'), 'the node survives the read back')
  } finally {
    o.ws.close()
  }
})

// ---------------------------------------------------------------------------
// send and add share the material ranges (A9)
// ---------------------------------------------------------------------------

test('send refuses metallicFactor 7; a material at each range edge is accepted by send and add', async () => {
  const { world, port } = await startOwnerWorld()
  const o = await owner(port)
  try {
    // crate-01 carries a material and is send-addressable.
    o.ws.send(JSON.stringify({
      type: 'send', seq: 61, node: 'crate-01',
      field: 'mesh.primitives[0].material.metallicFactor', value: 7,
    }))
    const err = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 61, 1500)
    assert.ok(err, 'send refuses metallicFactor 7')
    assert.equal(err.code, 'INVALID_VALUE')

    // The edges (0 and 1) are accepted by send.
    for (const [seq, value] of [[62, 0], [63, 1]]) {
      o.ws.send(JSON.stringify({
        type: 'send', seq, node: 'crate-01',
        field: 'mesh.primitives[0].material.metallicFactor', value,
      }))
      const reply = await waitFor(o.messages, (m) => m.type === 'set' && m.requestSeq === seq, 1500)
      assert.ok(reply, `send accepts metallicFactor ${value}`)
    }

    // An `add` whose material sits at the edge is accepted.
    const node = {
      name: 'edge-mat',
      mesh: { primitives: [{ attributes: { POSITION: pos3 }, material: { pbrMetallicRoughness: { baseColorFactor: [0, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } } }] },
    }
    o.ws.send(JSON.stringify({ type: 'add', seq: 64, format: 'gltf', node }))
    const addErr = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 64, 1500)
    assert.equal(addErr, null, `the edge material add is accepted (${addErr?.message})`)
    assert.ok(world.som.getNodeByName('edge-mat'), 'the node exists')

    // The server test also bounds a 20,000-primitive WORLD add's reply.
    const many = new Array(20000).fill({ attributes: { POSITION: pos3 } })
    const start = performance.now()
    o.ws.send(JSON.stringify({ type: 'add', seq: 65, format: 'gltf', node: { name: 'x-many', mesh: { primitives: many } } }))
    const manyErr = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 65, 5000)
    const elapsed = performance.now() - start
    assert.ok(manyErr, 'the 20,000-primitive world add is refused')
    assert.ok(elapsed < 500, `refused from the length alone (${Math.round(elapsed)} ms)`)
  } finally {
    o.ws.close()
  }
})
