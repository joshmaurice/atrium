// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// visitor-leak — Phase 3 server-cleanup, §7.1: the visitor test (20 avatar
// joins and leaves, then a save) over BOTH world kinds, the dump after they
// have left, and the end-to-end 10-join case with two real AtriumClients.
//
// Heavy file, kept on its own (operator requirement 1). Real servers on port 0,
// real worlds, real glTF-Transform; every socket closed in finally.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
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
  const server = createSessionServer({ httpServer: http, maxUsers: 40, world })
  closers.push(() => server.close())
  return { world, port }
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

async function waitFor(messages, pred, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = messages.find(pred)
    if (found) return found
    await delay(10)
  }
  return null
}

async function waitUntil(pred, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await delay(10)
  }
  return false
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  return { ws, messages }
}

async function hello(ws, messages, id) {
  ws.send(JSON.stringify({
    type: 'hello', id,
    capabilities: { tick: { interval: 5000 } },
  }))
  const reply = await waitFor(messages, m => m.type === 'hello')
  assert.ok(reply, 'a hello reply arrives')
  return reply
}

/** Live resource counts of the world's own document. */
function liveCounts(world) {
  const root = world.som._document.getRoot()
  return {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    accessors: root.listAccessors().length,
    buffers: root.listBuffers().length,
  }
}

const writtenCounts = (json) => ({
  nodes: (json.nodes ?? []).length,
  meshes: (json.meshes ?? []).length,
  materials: (json.materials ?? []).length,
  accessors: (json.accessors ?? []).length,
  buffers: (json.buffers ?? []).length,
})

/** Resources a written document keeps but no written node uses. */
function unreferenced(json) {
  const nodes = json.nodes ?? []
  const usedMeshes = new Set(nodes.map(n => n.mesh).filter(i => typeof i === 'number'))
  const usedMaterials = new Set()
  const usedAccessors = new Set()
  for (const index of usedMeshes) {
    for (const prim of (json.meshes ?? [])[index]?.primitives ?? []) {
      if (typeof prim.material === 'number') usedMaterials.add(prim.material)
      if (typeof prim.indices === 'number') usedAccessors.add(prim.indices)
      for (const acc of Object.values(prim.attributes ?? {})) {
        if (typeof acc === 'number') usedAccessors.add(acc)
      }
      for (const target of prim.targets ?? []) {
        for (const acc of Object.values(target ?? {})) {
          if (typeof acc === 'number') usedAccessors.add(acc)
        }
      }
    }
  }
  return {
    meshes: (json.meshes ?? []).length - usedMeshes.size,
    materials: (json.materials ?? []).length - usedMaterials.size,
    accessors: (json.accessors ?? []).length - usedAccessors.size,
  }
}

/** Join, add an avatar, leave — the full first-party visitor cycle. */
async function visit(port, id) {
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, id)
    const name = reply.avatarNodeName
    assert.ok(name, 'hello carries the allocated avatar name')
    ws.send(JSON.stringify({
      type: 'add', id, seq: 2, format: 'gltf',
      node: {
        name, translation: [0, 0, 0],
        extras: { displayName: id, atrium: { ephemeral: true } },
        mesh: {
          name: `${name}-mesh`,
          primitives: [{
            attributes: { POSITION: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
            indices: [0, 1, 2],
            material: { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
          }],
        },
      },
    }))
    return { ws, name }
  } catch (err) {
    ws.close()
    await waitForClose(ws)
    throw err
  }
}

// ===========================================================================
// The visitor test — 20 joins and leaves, then a save
// ===========================================================================

async function visitorCycle(world, port, label) {
  const before = liveCounts(world)
  const names = []
  for (let i = 0; i < 20; i += 1) {
    const id = `visitor-${String(i).padStart(4, '0')}`
    const { ws, name } = await visit(port, id)
    names.push(name)
    assert.ok(await waitUntil(() => world.som.getNodeByName(name)),
      `${label}: the avatar arrives in the world`)
    ws.close()
    await waitForClose(ws)
    assert.ok(await waitUntil(() => world.som.getNodeByName(name) === null, 6000),
      `${label}: the avatar leaves the world with its session`)
  }

  assert.deepEqual(liveCounts(world), before,
    `${label}: 20 visits leave the live world exactly as it was`)
  assert.deepEqual(names.length, 20)
  for (const name of names) {
    assert.equal(world.som.getNodeByName(name), null, `${label}: "${name}" is gone`)
  }

  const saved = await world.serialize()
  assert.deepEqual(writtenCounts(saved), before,
    `${label}: a save after 20 visits writes the same resource counts as before the first`)
  assert.deepEqual(unreferenced(saved), { meshes: 0, materials: 0, accessors: 0 },
    `${label}: the save carries no orphan resource`)
}

test('L2/L3: 20 avatar joins and leaves, then a save — file world', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startServer(world)
  await visitorCycle(world, port, 'file world')
})

test('L2/L3: 20 avatar joins and leaves, then a save — document world', async () => {
  const fileWorld = await createWorld(SPACE)
  const json = await fileWorld.serialize()
  const world = await createWorldFromDocument(json)
  const { port } = await startServer(world)
  await visitorCycle(world, port, 'document world')
})

test('L3: a dump to a third client, after the visitors left, has no resource no node uses', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startServer(world)

  for (let i = 0; i < 5; i += 1) {
    const { ws, name } = await visit(port, `dumper-${String(i).padStart(4, '0')}`)
    ws.close()
    await waitForClose(ws)
    await waitUntil(() => world.som.getNodeByName(name) === null, 6000)
  }

  const third = await connect(port)
  try {
    await hello(third.ws, third.messages, 'third-client')
    const dump = await waitFor(third.messages, m => m.type === 'som-dump', 6000)
    assert.ok(dump, 'the third client gets its som-dump')
    assert.deepEqual(unreferenced(dump.gltf), { meshes: 0, materials: 0, accessors: 0 },
      'no resource in the dump is unused by its own nodes')
  } finally {
    third.ws.close()
    await waitForClose(third.ws)
  }
})

// ===========================================================================
// End to end — two real AtriumClients, B joins and leaves 10 times
// ===========================================================================

test('e2e: B joins and leaves 10 times and A\'s SOM is back to its pre-join counts', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startServer(world)

  const a = new AtriumClient({ WebSocket: WS, connectTimeout: 5000 })
  const loaded = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('A never loaded')), 6000)
    a.once('world:loaded', () => { clearTimeout(t); res() })
  })
  a.connect(`ws://127.0.0.1:${port}`, { avatar: { name: 'avatar-host', translation: [0, 0, 0] } })
  await loaded

  try {
    const before = {
      meshes: a.som.meshes.length,
      materials: a.som.materials.length,
      accessors: a.som.document.getRoot().listAccessors().length,
    }
    // A's own avatar is part of the live world; wait for it before snapshotting.
    assert.ok(await waitUntil(() => world.som.getNodeByName(a._avatarNodeName) != null),
      "A's avatar is in the world")
    const worldBefore = liveCounts(world)

    for (let i = 0; i < 10; i += 1) {
      const b = new AtriumClient({ WebSocket: WS, connectTimeout: 5000 })
      const bLoaded = new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('B never loaded')), 6000)
        b.once('world:loaded', () => { clearTimeout(t); res() })
      })
      b.connect(`ws://127.0.0.1:${port}`, { avatar: { name: `avatar-b-${i}`, translation: [0, 0, 0] } })
      await bLoaded

      const bName = b._avatarNodeName
      assert.ok(await waitUntil(() => a.som.getNodeByName(bName) != null),
        `A sees B's avatar (round ${i})`)

      b.disconnect()
      assert.ok(await waitUntil(() => a.som.getNodeByName(bName) == null),
        `A drops B's avatar and its mesh (round ${i})`)
    }

    const after = {
      meshes: a.som.meshes.length,
      materials: a.som.materials.length,
      accessors: a.som.document.getRoot().listAccessors().length,
    }
    assert.deepEqual(after, before,
      "A's SOM holds exactly what it held before B's first join")
    assert.deepEqual(liveCounts(world), worldBefore,
      'and so does the server-side world')
  } finally {
    a.disconnect()
    await delay(50)
  }
})
