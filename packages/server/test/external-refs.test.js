// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// external-refs — Phase 3 server-cleanup, L8 (item 3).
//
// Moved here from packages/server/tests/ so the package script and the DEV
// deploy pick it up, and brought up to the current contract: every server binds
// port 0 with its own httpServer and is closed in after(); a `send` to an
// externally loaded node is REFUSED (A4), and a dump written with exclusions
// carries no resource those excluded nodes alone used (L3).
//
// No mocks: real file worlds, real SOM, real glTF-Transform.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
import { createWorld } from '../src/world.js'
import { createSessionServer } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_EXT  = resolve(__dirname, '../../../tests/fixtures/space-ext.gltf')
const FIXTURE_BASE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

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

/** A file world with its external references resolved, on port 0. */
async function startExternalWorld() {
  const world = await createWorld(FIXTURE_EXT)
  await world.resolveExternalReferences()
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

/**
 * Resources a written document keeps but no written node uses.
 *
 * Nodes → meshes → primitives → materials and accessors. Anything left over is
 * exactly what L3's exclusion step must have pruned.
 */
function unreferencedResources(json) {
  const meshes = json.meshes ?? []
  const nodes = json.nodes ?? []

  const usedMeshes = new Set()
  for (const node of nodes) {
    if (typeof node.mesh === 'number') usedMeshes.add(node.mesh)
  }

  const usedMaterials = new Set()
  const usedAccessors = new Set()
  for (const index of usedMeshes) {
    for (const prim of meshes[index]?.primitives ?? []) {
      if (typeof prim.material === 'number') usedMaterials.add(prim.material)
      if (typeof prim.indices === 'number') usedAccessors.add(prim.indices)
      for (const accessor of Object.values(prim.attributes ?? {})) {
        if (typeof accessor === 'number') usedAccessors.add(accessor)
      }
      for (const target of prim.targets ?? []) {
        for (const accessor of Object.values(target ?? {})) {
          if (typeof accessor === 'number') usedAccessors.add(accessor)
        }
      }
    }
  }

  return {
    meshes: meshes.length - usedMeshes.size,
    materials: (json.materials ?? []).length - usedMaterials.size,
    accessors: (json.accessors ?? []).length - usedAccessors.size,
  }
}

// ---------------------------------------------------------------------------
// Test 1 — the server resolves external references at startup
// ---------------------------------------------------------------------------

test('server SOM contains prefixed nodes after resolveExternalReferences', async () => {
  const world = await createWorld(FIXTURE_EXT)
  await world.resolveExternalReferences()

  const names = world.listNodeNames()

  assert.ok(names.includes('Crate'), 'Crate container node present')
  assert.ok(names.includes('Light'), 'Light container node present')

  assert.ok(names.includes('Crate/Crate'), 'Crate/Crate ingested')
  assert.ok(names.includes('Light/Lamp'),  'Light/Lamp ingested')

  assert.ok(world.som.getNodeByName('Crate/Crate'), 'getNodeByName finds Crate/Crate')
  assert.ok(world.som.getNodeByName('Light/Lamp'),  'getNodeByName finds Light/Lamp')
})

// ---------------------------------------------------------------------------
// Test 2 — som-dump excludes external nodes AND their resources (L3)
// ---------------------------------------------------------------------------

test('som-dump excludes externally-ingested nodes and their resources', async () => {
  const world = await createWorld(FIXTURE_EXT)
  await world.resolveExternalReferences()

  const json = await world.serialize()

  const nodeNames = (json.nodes ?? []).map((n) => n.name)

  assert.ok(nodeNames.includes('Crate'), 'Crate container in dump')
  assert.ok(nodeNames.includes('Light'), 'Light container in dump')

  assert.ok(!nodeNames.includes('Crate/Crate'), 'Crate/Crate excluded from dump')
  assert.ok(!nodeNames.includes('Light/Lamp'),  'Light/Lamp excluded from dump')
  assert.ok(!nodeNames.includes('Light/lamp-stand'), 'lamp-stand excluded from dump')
  assert.ok(!nodeNames.includes('Light/lamp-shade'), 'lamp-shade excluded from dump')

  // L8/L3 — the dump must not carry a mesh, material or accessor that only the
  // excluded external nodes used.
  const orphans = unreferencedResources(json)
  assert.deepEqual(orphans, { meshes: 0, materials: 0, accessors: 0 },
    'a dump written with exclusions keeps no resource only the excluded nodes used')
})

// ---------------------------------------------------------------------------
// Test 3 — A4: a send to an extern node is refused
// ---------------------------------------------------------------------------

test('A4: a send to an external node is PERMISSION_DENIED, and nothing changes', async () => {
  const { world, port } = await startExternalWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'ext-send')

    const node = world.som.getNodeByName('Crate/Crate')
    const before = [...node.translation]

    const countBefore = messages.length
    ws.send(JSON.stringify({
      type: 'send', seq: 1, node: 'Crate/Crate', field: 'translation', value: [1, 0, 0],
    }))
    const err = await waitFor(messages, (m) => m.type === 'error' && m.seq === 1)
    assert.ok(err, 'an error must arrive')
    assert.equal(err.code, 'PERMISSION_DENIED')
    await delay(80)

    const broadcasts = messages.slice(countBefore).filter((m) => ['set', 'add', 'remove'].includes(m.type))
    assert.deepEqual(broadcasts, [], 'a refusal broadcasts nothing')
    assert.deepEqual([...node.translation], before, 'the node translation is unchanged')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ---------------------------------------------------------------------------
// Test 4 — A4 cross-client: the other client receives nothing
// ---------------------------------------------------------------------------

test('A4: a send to an external node reaches no other client', async () => {
  const { world, port } = await startExternalWorld()
  const a = await connect(port)
  const b = await connect(port)
  try {
    await hello(a.ws, a.messages, 'ext-a')
    await hello(b.ws, b.messages, 'ext-b')

    const node = world.som.getNodeByName('Crate/Crate')
    const before = [...node.translation]
    const bBefore = b.messages.length

    a.ws.send(JSON.stringify({
      type: 'send', seq: 1, node: 'Crate/Crate', field: 'translation', value: [2, 0, 0],
    }))
    const err = await waitFor(a.messages, (m) => m.type === 'error' && m.seq === 1)
    assert.ok(err, 'the sender gets the refusal')
    assert.equal(err.code, 'PERMISSION_DENIED')
    await delay(80)

    const received = b.messages.slice(bBefore).filter((m) => ['set', 'add', 'remove'].includes(m.type))
    assert.deepEqual(received, [], 'the second client receives nothing')
    assert.deepEqual([...node.translation], before, 'the node translation is unchanged')
  } finally {
    a.ws.close(); await waitForClose(a.ws)
    b.ws.close(); await waitForClose(b.ws)
  }
})

// ---------------------------------------------------------------------------
// Test 5 — a failed external reference is non-fatal
// ---------------------------------------------------------------------------

test('failed external reference: the container node exists without children', async () => {
  const world = await createWorld(FIXTURE_BASE)

  const testNode = world.som.getNodeByName('ground-plane')
  assert.ok(testNode, 'ground-plane node exists')
  testNode.extras = { ...testNode.extras, atrium: { source: './does-not-exist.gltf' } }

  await world.resolveExternalReferences()

  const node = world.som.getNodeByName('ground-plane')
  assert.ok(node, 'container node still present after failed ref')
  assert.equal(node.children.length, 0, 'no children added for failed ref')
})

// ---------------------------------------------------------------------------
// Test 6 — container node mutations still work
// ---------------------------------------------------------------------------

test('a send to a container node (not external) validates and broadcasts', async () => {
  const { port } = await startExternalWorld()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'ext-container')

    ws.send(JSON.stringify({
      type: 'send', seq: 1, node: 'Crate', field: 'translation', value: [5, 0, 0],
    }))
    const set = await waitFor(messages, (m) => m.type === 'set')
    assert.ok(set, 'received set broadcast for container node')
    assert.equal(set.node, 'Crate', 'container node name in broadcast')
    assert.deepEqual(set.value, [5, 0, 0], 'value correct')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})
