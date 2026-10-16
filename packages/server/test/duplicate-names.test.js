// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// duplicate-names — Phase 3 server-cleanup, §7.1 K5(b): one node per name,
// consistently, at every lookup; take-over when the addressable node is removed
// or renamed; the cross-type collision case (L6's scope note, review #12); and
// the reload shows two unique names. Real server on port 0, real world.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { createSessionServer } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const SPACE_ANIM = resolve(__dirname, '../../../tests/fixtures/space-anim.gltf')

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

async function waitFor(messages, pred, timeoutMs = 3000) {
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
    type: 'hello', id,
    capabilities: { tick: { interval: 5000 } },
  }))
  const reply = await waitFor(messages, m => m.type === 'hello')
  assert.ok(reply, 'a hello reply arrives')
  return reply
}

// ===========================================================================
// K5(b) — one node per name, at every lookup
// ===========================================================================

test('K5(b): send, remove, getNodeByName and getObjectByName all reach the first of two legacy duplicates', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startServer(world)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'dup-owner')

    const first = world.som.ingestNode({ name: 'Dup', translation: [0, 0, 0] })
    const second = world.som.ingestNode({ name: 'Dup', translation: [9, 9, 9] })
    assert.notEqual(first, second)

    // Every lookup agrees on the first.
    assert.equal(world.som.getNodeByName('Dup'), first)
    assert.equal(world.som.getObjectByName('Dup'), first)

    // `send Dup translation` moves the first.
    ws.send(JSON.stringify({ type: 'send', seq: 11, node: 'Dup', field: 'translation', value: [1, 0, 0] }))
    const set = await waitFor(messages, m => m.type === 'set' && m.field === 'translation')
    assert.ok(set, 'the send was accepted')
    assert.deepEqual([...first.translation], [1, 0, 0], 'the first node moved')
    assert.deepEqual([...second.translation], [9, 9, 9], 'the second node is untouched')

    // `remove Dup` deletes the first, and the second takes the name over.
    ws.send(JSON.stringify({ type: 'remove', seq: 12, node: 'Dup' }))
    const removed = await waitFor(messages, m => m.type === 'remove')
    assert.ok(removed, 'the remove was accepted')
    assert.equal(world.som.getNodeByName('Dup'), second,
      'the second node is addressable after the take-over')
    assert.equal(world.som.getObjectByName('Dup'), second)
    assert.equal(world.som.getNodeByName('Dup').translation[1], 9, 'it is the second node')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('K5(b): after the first duplicate is renamed over the wire the second takes Dup and can be renamed too, and a reload shows two unique names', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startServer(world)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'dup-owner-2')

    const first = world.som.ingestNode({ name: 'Dup' })
    const second = world.som.ingestNode({ name: 'Dup' })

    ws.send(JSON.stringify({ type: 'send', seq: 21, node: 'Dup', field: 'name', value: 'Dup-1' }))
    const renamed = await waitFor(messages, m => m.type === 'set' && m.field === 'name')
    assert.ok(renamed, 'the rename was accepted')
    assert.equal(first.name, 'Dup-1', 'the first node was renamed')
    assert.equal(world.som.getNodeByName('Dup'), second, 'the second took Dup over')

    // The node that took over can be renamed too.
    ws.send(JSON.stringify({ type: 'send', seq: 22, node: 'Dup', field: 'name', value: 'Dup-2' }))
    const renamed2 = await waitFor(messages, m => m.type === 'set' && m.field === 'name' && m.value === 'Dup-2')
    assert.ok(renamed2, 'the second rename was accepted')
    assert.equal(second.name, 'Dup-2')
    assert.equal(world.som.getNodeByName('Dup'), null, 'no node holds Dup now')
    assert.equal(world.som.getNodeByName('Dup-1'), first)
    assert.equal(world.som.getNodeByName('Dup-2'), second)

    // A reload shows two unique names.
    const reloaded = await createWorldFromDocument(await world.serialize())
    const names = reloaded.som.nodes.map(n => n.name)
    assert.equal(names.filter(n => n === 'Dup-1').length, 1)
    assert.equal(names.filter(n => n === 'Dup-2').length, 1)
    assert.equal(new Set(names).size, names.length, 'every name is unique after the reload')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// L6 scope note (review #12) — a legacy node colliding with a non-node object
// ===========================================================================

test('K5(b) scope: a legacy node named like a non-node object stays reachable through getNodeByName only', async () => {
  const world = await createWorld(SPACE_ANIM)
  const { port } = await startServer(world)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'cross-owner')

    // Force the cross-type collision: a node registered under a name the
    // global namespace gives to something else.
    const animation = world.som.animations[0]
    assert.ok(animation, 'the fixture has an animation')
    const clashName = animation.name
    assert.equal(world.som.getObjectByName(clashName), animation, 'the animation holds the name')

    const node = world.som.ingestNode({ name: clashName, translation: [0, 0, 0] })
    assert.equal(world.som.getObjectByName(clashName), animation,
      'the non-node object still holds the global slot')
    assert.equal(world.som.getNodeByName(clashName), node,
      'the node is still reachable through getNodeByName')

    // `remove` reaches the node; a `send` of a node field resolves the other
    // object and is refused, as today.
    const err = await (async () => {
      ws.send(JSON.stringify({
        type: 'send', seq: 31, node: clashName, field: 'translation', value: [5, 5, 5],
      }))
      return waitFor(messages, m => m.type === 'error' && m.seq === 31)
    })()
    assert.ok(err, 'the send is refused')
    assert.ok(['INVALID_VALUE', 'PERMISSION_DENIED'].includes(err.code),
      `the send resolves the non-node object and is refused (got ${err.code})`)
    assert.deepEqual([...node.translation], [0, 0, 0], 'the node did not move')

    ws.send(JSON.stringify({ type: 'remove', seq: 32, node: clashName }))
    const removed = await waitFor(messages, m => m.type === 'remove')
    assert.ok(removed, 'the remove is accepted')
    assert.equal(world.som.getNodeByName(clashName), null, 'the node was removed')
    assert.equal(world.som.getObjectByName(clashName), animation,
      'the animation is untouched')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// §7.2 — a diverged client cannot make the server rename the wrong node
// ===========================================================================

test('§7.2: a client whose SOM has diverged sends nothing that makes the server rename the wrong node', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startServer(world)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'diverged-owner')

    const named = world.som.ingestNode({ name: 'Legacy' })
    const other = world.som.ingestNode({ name: 'Legacy' })
    // Inject the divergence a client's own SOM can present.
    world.som._nodesByName.set('Legacy', other)

    ws.send(JSON.stringify({ type: 'send', seq: 41, node: 'Legacy', field: 'name', value: 'Legacy-1' }))
    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 41)
    assert.ok(err, 'the rename is refused')
    assert.equal(err.code, 'INVALID_VALUE')
    assert.match(err.message, /not the named node/)
    assert.equal(named.name, 'Legacy', 'the authorized object is untouched')
    assert.equal(other.name, 'Legacy', 'the node the client thought it named is untouched')
    assert.equal(world.som.getNodeByName('Legacy-1'), null, 'nothing took the new name')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})
