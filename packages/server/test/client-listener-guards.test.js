// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// client-listener-guards — Phase 3 server-cleanup, L6's client half (H14,
// review #10, review 2 #2/#3), §7.1: two real AtriumClients against a real
// server on a legacy duplicate-name world, and a shared camera whose qualified
// name has to be read when the listener sends.
//
// Real server on port 0, real worlds, real AtriumClient instances; no mocks.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { Document, NodeIO } from '@gltf-transform/core'
import WS from 'ws'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { createSessionServer } from '../src/session.js'
import { AtriumClient } from '../../client/src/AtriumClient.js'

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

async function startServer(world) {
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

async function waitUntil(pred, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await delay(20)
  }
  return false
}

/** Connect a real AtriumClient and wait for world:loaded. */
async function connectClient(port, avatarName) {
  const client = new AtriumClient({ WebSocket: WS, connectTimeout: 5000 })
  const loaded = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`"${avatarName}" never loaded`)), 6000)
    client.once('world:loaded', () => { clearTimeout(t); res() })
  })
  client.connect(`ws://127.0.0.1:${port}`, { avatar: { name: avatarName, translation: [0, 0, 0] } })
  await loaded
  return client
}

/** Every frame the client puts on its socket (the real wire, not a mock). */
function spySends(client) {
  const sent = []
  const ws = client._ws
  const realSend = ws.send.bind(ws)
  ws.send = (data) => {
    try { sent.push(JSON.parse(data)) } catch { /* ignore */ }
    realSend(data)
  }
  return sent
}

const meshDescriptor = (name, color) => ({
  name: `${name}-mesh`,
  primitives: [{
    attributes: { POSITION: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
    indices: [0, 1, 2],
    material: { pbrMetallicRoughness: { baseColorFactor: color } },
  }],
})

/** A world holding two nodes named `Dup`, each with a mesh and a material. */
async function startDupWorld() {
  const world = await createWorld(SPACE)
  const first = world.som.ingestNode({
    name: 'Dup', translation: [0, 0, 0], mesh: meshDescriptor('Dup', [1, 0, 0, 1]),
  })
  const second = world.som.ingestNode({
    name: 'Dup', translation: [1, 1, 1], mesh: meshDescriptor('Dup2', [0, 0, 1, 1]),
  })
  world.som.scene.addChild(first)
  world.som.scene.addChild(second)
  return startServer(world)
}

const dupNodes = (som) => som.allNodes.filter(n => n.name === 'Dup')

// ===========================================================================
// (r) client listeners follow every node — the take-over case
// ===========================================================================

test('L6/r: two real AtriumClients on a Dup world — A renames the first Dup, then A moves the node that took Dup over; B and the server see it', async () => {
  const { world, port } = await startDupWorld()
  const a = await connectClient(port, 'avatar-a')
  const b = await connectClient(port, 'avatar-b')
  try {
    // Both clients hold both nodes (listeners are attached to every document
    // node, not only `som.nodes`), and `Dup` resolves to the first in both.
    assert.equal(dupNodes(a.som).length, 2, 'A holds both Dup nodes')
    assert.equal(dupNodes(b.som).length, 2, 'B holds both Dup nodes')
    const aFirst = dupNodes(a.som)[0]
    const aSecond = dupNodes(a.som)[1]
    assert.equal(a.som.getNodeByName('Dup'), aFirst, 'Dup resolves to the first')

    // A renames the first Dup.
    a.renameNode('Dup', 'Dup-1')
    assert.ok(await waitUntil(() => b.som.getNodeByName('Dup-1') != null), 'B sees the rename')
    assert.equal(aFirst.name, 'Dup-1', 'A renamed the first node')
    assert.equal(a.som.getNodeByName('Dup'), aSecond, 'the second node took Dup over in A')
    assert.ok(await waitUntil(() => b.som.getNodeByName('Dup')?.name === 'Dup'
      && b.som.getNodeByName('Dup') !== b.som.getNodeByName('Dup-1')),
      'the second node took Dup over in B too')
    assert.equal(world.som.getNodeByName('Dup').name, 'Dup', 'the server resolves Dup to the second node')
    assert.deepEqual([...world.som.getNodeByName('Dup').translation], [1, 1, 1],
      'and it is the second node (the one that was shadowed)')

    // A moves the node that took the name over. Its listener must send, under
    // the name it now holds.
    const bHolder = b.som.getNodeByName('Dup')
    a.som.getNodeByName('Dup').translation = [3, 0, 0]
    assert.ok(await waitUntil(() => {
      const n = b.som.getNodeByName('Dup')
      return n && n.translation[0] === 3
    }), 'B sees the move on the node that took Dup over')
    assert.equal(bHolder.name, 'Dup')
    assert.deepEqual([...world.som.getNodeByName('Dup').translation], [3, 0, 0],
      'the server moved the same node')
  } finally {
    a.disconnect(); b.disconnect()
    await delay(50)
  }
})

// ===========================================================================
// (v) one addressability guard for the node's own listener and its callbacks
// ===========================================================================

test('L6/v: a material change on the shadowed Dup sends nothing; after the take-over the same change is sent and applied to its material', async () => {
  const { world, port } = await startDupWorld()
  const a = await connectClient(port, 'avatar-a')
  const b = await connectClient(port, 'avatar-b')
  try {
    const aSent = spySends(a)
    const shadowed = dupNodes(a.som)[1]
    assert.notEqual(a.som.getObjectByName('Dup'), shadowed, 'the second Dup is the shadowed one')

    // Before the take-over: a material change on the shadowed node is not sent.
    shadowed.mesh.primitives[0].material.baseColorFactor = [0, 1, 0, 1]
    await delay(250)
    const beforeSends = aSent.filter(m => m.type === 'send')
    assert.deepEqual(beforeSends, [],
      `a shadowed node must send nothing, but sent ${JSON.stringify(beforeSends)}`)

    // A renames the first Dup, so the second takes the name over.
    a.renameNode('Dup', 'Dup-1')
    assert.ok(await waitUntil(() => a.som.getObjectByName('Dup') === shadowed),
      'the shadowed node now holds the name')
    await waitUntil(() => b.som.getNodeByName('Dup') != null && b.som.getNodeByName('Dup-1') != null)

    // After it: the same change on the node that took over is sent...
    shadowed.mesh.primitives[0].material.baseColorFactor = [0, 1, 0, 1]
    assert.ok(await waitUntil(() => aSent.some(m => m.type === 'send'
      && m.node === 'Dup'
      && m.field === 'mesh.primitives[0].material.baseColorFactor')),
      `the node that took over must send (sent: ${JSON.stringify(aSent.filter(m => m.type === 'send'))})`)

    // ...and applied to ITS material — the server and B both have it.
    assert.ok(await waitUntil(() => {
      const n = world.som.getNodeByName('Dup')
      const m = n?.mesh?.primitives?.[0]?.material
      return m && m.baseColorFactor[1] === 1
    }), 'the server applied the change to the second node\'s material')
    assert.ok(await waitUntil(() => {
      const n = b.som.getNodeByName('Dup')
      const m = n?.mesh?.primitives?.[0]?.material
      return m && m.baseColorFactor[1] === 1
    }), "and B applied it to the second node's material")
    // The first node (renamed) keeps its own red material.
    assert.equal(world.som.getNodeByName('Dup-1').mesh.primitives[0].material.baseColorFactor[0], 1,
      'the renamed node keeps its own material')
  } finally {
    a.disconnect(); b.disconnect()
    await delay(50)
  }
})

// ===========================================================================
// (u) the camera listener reads the qualified name when it sends
// ===========================================================================

/** glTF JSON with one camera shared by the host nodes A and B. */
async function sharedCameraJson() {
  const doc = new Document()
  const scene = doc.createScene('Scene')
  const cam = doc.createCamera('SharedCam').setType('perspective')
    .setYFov(0.8).setZNear(0.1).setZFar(100)
  scene.addChild(doc.createNode('A').setCamera(cam))
  scene.addChild(doc.createNode('B').setCamera(cam))
  const io = new NodeIO()
  const { json, resources } = await io.writeJSON(doc)
  for (const buf of json.buffers ?? []) {
    if (buf.uri && !buf.uri.startsWith('data:') && resources[buf.uri]) {
      buf.uri = 'data:application/octet-stream;base64,' +
        Buffer.from(resources[buf.uri]).toString('base64')
    }
  }
  return json
}

test('L6/u: a shared camera sends under the surviving host\'s alias after the named host is removed', async () => {
  const world = await createWorldFromDocument(await sharedCameraJson())
  const { port } = await startServer(world)
  const a = await connectClient(port, 'avatar-a')
  try {
    // One wrapper for both hosts; its qualified name names B (the last host).
    assert.equal(a.som.getObjectByName('A.camera'), a.som.getObjectByName('B.camera'))
    assert.equal(a.som.cameras[0].qualifiedName, 'B.camera')
    const camera = a.som.cameras[0]

    const aSent = spySends(a)

    // Remove the host the qualified name does NOT name, so the surviving host
    // is A and the wrapper's name has to move.
    a.removeNode('B')
    assert.ok(await waitUntil(() => world.som.getNodeByName('B') === null),
      'the server dropped B')
    assert.ok(await waitUntil(() => camera.qualifiedName === 'A.camera'),
      `the client's wrapper followed the surviving host (is ${camera.qualifiedName})`)
    assert.equal(a.som.getObjectByName('A.camera'), camera, 'A.camera resolves to the wrapper')

    aSent.length = 0
    camera.yfov = 1.2

    assert.ok(await waitUntil(() => aSent.some(m => m.type === 'send'
      && m.node === 'A.camera' && m.field === 'yfov')),
      `the camera change must go out under the surviving alias (sent: ${JSON.stringify(aSent.filter(m => m.type === 'send'))})`)
    assert.ok(await waitUntil(() => {
      const c = world.som.getObjectByName('A.camera')
      return c && c.yfov === 1.2
    }), 'the server applied the change through the surviving host')
    assert.equal(a.som.getObjectByName('B.camera'), null, "B's alias is gone")
  } finally {
    a.disconnect()
    await delay(50)
  }
})
