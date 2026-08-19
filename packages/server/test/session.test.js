// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
import { createSessionServer } from '../src/session.js'
import { createWorld } from '../src/world.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const PORT = 3001

let server

before(() => {
  server = createSessionServer({ port: PORT, maxUsers: 20 })
})

after(() => {
  return new Promise((resolve) => server.wss.close(resolve))
})

function connect() {
  return new WebSocket(`ws://localhost:${PORT}`)
}

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    ws.once('error', reject)
  })
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve()
    ws.once('close', resolve)
  })
}

function makeMessageQueue(ws) {
  const queue = []
  ws.on('message', (raw) => {
    try { queue.push(JSON.parse(raw)) } catch {}
  })
  async function waitForType(type, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const idx = queue.findIndex(m => m.type === type)
      if (idx >= 0) return queue.splice(idx, 1)[0]
      if (Date.now() >= deadline) return null
      await new Promise(r => setTimeout(r, 10))
    }
  }
  return { waitForType }
}

async function handshake(ws, opts = {}) {
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: opts.clientId ?? 'test-client',
    capabilities: { tick: { interval: opts.interval ?? 5000 } },
  }))
  return waitForMessage(ws)
}

test('server hello returns assigned avatarNodeName', async () => {
  const ws = connect()
  const reply = await handshake(ws)

  assert.equal(reply.type, 'hello')
  assert.ok(typeof reply.avatarNodeName === 'string', 'avatarNodeName should be a string')
  assert.ok(reply.avatarNodeName.startsWith('avatar-'), `avatarNodeName should start with "avatar-", got "${reply.avatarNodeName}"`)

  ws.close()
  await waitForClose(ws)
})

test('completes hello handshake', async () => {
  const ws = connect()
  const reply = await handshake(ws)

  assert.equal(reply.type, 'hello')
  assert.ok(typeof reply.id === 'string' && reply.id.length > 0)
  assert.ok(typeof reply.seq === 'number')
  assert.ok(typeof reply.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('server hello contains negotiated tick interval', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: 'test-client-2',
    capabilities: { tick: { interval: 2000 } },
  }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'hello')
  assert.ok(reply.capabilities?.tick?.interval >= 50)

  ws.close()
  await waitForClose(ws)
})

test('rejects message before hello with AUTH_FAILED', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'x', field: 'translation', value: [0, 0, 0] }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'error')
  assert.equal(reply.code, 'AUTH_FAILED')

  ws.close()
  await waitForClose(ws)
})

test('responds to ping with pong', async () => {
  const ws = connect()
  await handshake(ws)

  const clientTime = Date.now()
  ws.send(JSON.stringify({ type: 'ping', clientTime }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'pong')
  assert.equal(reply.clientTime, clientTime)
  assert.ok(typeof reply.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('sends tick messages after handshake', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: 'tick-test-client',
    capabilities: { tick: { interval: 100 } },
  }))

  // consume the hello reply
  await waitForMessage(ws)

  // wait for at least one tick
  const tick = await waitForMessage(ws)

  assert.equal(tick.type, 'tick')
  assert.ok(typeof tick.seq === 'number')
  assert.ok(typeof tick.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('rejects connection when world full', async () => {
  const fullServer = createSessionServer({ port: PORT + 1, maxUsers: 1 })

  const ws1 = new WebSocket(`ws://localhost:${PORT + 1}`)
  await handshake(ws1)

  const ws2 = new WebSocket(`ws://localhost:${PORT + 1}`)
  await waitForOpen(ws2)
  ws2.send(JSON.stringify({ type: 'hello', id: 'second-client' }))
  const reply = await waitForMessage(ws2)

  assert.equal(reply.type, 'error')
  assert.equal(reply.code, 'WORLD_FULL')

  ws1.close()
  ws2.close()
  await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  await new Promise((resolve) => fullServer.wss.close(resolve))
})

test('handles client disconnect cleanly', async () => {
  const ws = connect()
  const serverHello = await handshake(ws)

  // Session should be registered after handshake
  assert.ok(server.sessions.has(serverHello.id), 'session should be in sessions map after handshake')

  ws.close()
  await waitForClose(ws)

  // Give the server a tick to process the close event
  await new Promise((r) => setTimeout(r, 100))

  assert.ok(!server.sessions.has(serverHello.id), 'session should be removed from sessions map after disconnect')
})

// --- Integration tests (world state) ---

test('send message mutates world and broadcasts set', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const s = createSessionServer({ port: 3003, maxUsers: 10, world })

  try {
    const ws = new WebSocket('ws://localhost:3003')
    await handshake(ws)

    ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'crate-01', field: 'translation', value: [9, 0, 0] }))
    const msg = await waitForMessage(ws)

    assert.equal(msg.type, 'set')
    assert.equal(msg.node, 'crate-01')
    assert.equal(msg.field, 'translation')
    assert.deepEqual(msg.value, [9, 0, 0])

    ws.close()
    await waitForClose(ws)
  } finally {
    await new Promise((done) => s.wss.close(done))
  }
})

test('send to unknown node returns NODE_NOT_FOUND error', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const s = createSessionServer({ port: 3004, maxUsers: 10, world })

  try {
    const ws = new WebSocket('ws://localhost:3004')
    await handshake(ws)

    ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'ghost', field: 'translation', value: [0, 0, 0] }))
    const msg = await waitForMessage(ws)

    assert.equal(msg.type, 'error')
    assert.equal(msg.code, 'NODE_NOT_FOUND')

    ws.close()
    await waitForClose(ws)
  } finally {
    await new Promise((done) => s.wss.close(done))
  }
})

test('add message broadcasts add to all clients', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const s = createSessionServer({ port: 3005, maxUsers: 10, world })

  try {
    const ws1 = new WebSocket('ws://localhost:3005')
    const q1 = makeMessageQueue(ws1)
    await handshake(ws1, {})
    await q1.waitForType('hello', 1000)

    const ws2 = new WebSocket('ws://localhost:3005')
    const q2 = makeMessageQueue(ws2)
    await waitForOpen(ws2)
    ws2.send(JSON.stringify({ type: 'hello', id: 'add-test-client-2', capabilities: { tick: { interval: 5000 } } }))
    await q2.waitForType('hello', 1000)
    // drain join for ws1
    await q2.waitForType('join', 300)

    ws1.send(JSON.stringify({ type: 'add', seq: 1, node: { name: 'new-node-01', translation: [0, 2, 0] } }))

    const msg = await q2.waitForType('add', 1000)
    assert.ok(msg !== null, 'ws2 should receive add message')
    assert.equal(msg.type, 'add')
    assert.equal(msg.node.name, 'new-node-01')

    ws1.close()
    ws2.close()
    await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  } finally {
    await new Promise((done) => s.wss.close(done))
  }
})

test('remove message broadcasts remove to all clients', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const s = createSessionServer({ port: 3006, maxUsers: 10, world })

  try {
    const ws1 = new WebSocket('ws://localhost:3006')
    const q1 = makeMessageQueue(ws1)
    await waitForOpen(ws1)
    ws1.send(JSON.stringify({ type: 'hello', id: 'remove-test-client-1', capabilities: { tick: { interval: 5000 } } }))
    await q1.waitForType('hello', 1000)

    const ws2 = new WebSocket('ws://localhost:3006')
    const q2 = makeMessageQueue(ws2)
    await waitForOpen(ws2)
    ws2.send(JSON.stringify({ type: 'hello', id: 'remove-test-client-2', capabilities: { tick: { interval: 5000 } } }))
    await q2.waitForType('hello', 1000)
    // drain join for ws1
    await q2.waitForType('join', 300)

    ws1.send(JSON.stringify({ type: 'remove', seq: 1, node: 'crate-01' }))

    const msg = await q2.waitForType('remove', 1000)
    assert.ok(msg !== null, 'ws2 should receive remove message')
    assert.equal(msg.type, 'remove')
    assert.equal(msg.node, 'crate-01')

    ws1.close()
    ws2.close()
    await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  } finally {
    await new Promise((done) => s.wss.close(done))
  }
})
