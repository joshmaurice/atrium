// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import WebSocket from 'ws'
import { createSessionServer } from '../src/session.js'

const PORT = 3007

let server
let httpServer

before(() => {
  httpServer = createServer()
  httpServer.listen(PORT)
  server = createSessionServer({ httpServer, maxUsers: 20 })
})

after(() => {
  server.close()
})

function connect() {
  return new WebSocket(`ws://localhost:${PORT}`)
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

// Attach a persistent message queue to a WebSocket. Must be called before
// handshake so that messages arriving in the same TCP read as the hello reply
// are not dropped.
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

async function handshake(ws, q) {
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: `test-${Date.now()}-${Math.random()}`,
    capabilities: { tick: { interval: 5000 } },
  }))
  return q.waitForType('hello', 2000)
}

// Give the server time to process close events before the next assertion.
function drainServer() {
  return new Promise(r => setTimeout(r, 100))
}

test('newcomer receives join for each existing client', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  const helloA = await handshake(wsA, qA)
  const idA = helloA.id

  const wsB = connect()
  const qB = makeMessageQueue(wsB)
  await handshake(wsB, qB)

  // B should receive a join message with A's server-assigned ID
  const joinMsg = await qB.waitForType('join', 500)

  assert.ok(joinMsg !== null, 'newcomer should receive a join message')
  assert.equal(joinMsg.type, 'join')
  assert.equal(joinMsg.id, idA)

  wsA.close()
  wsB.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB)])
  await drainServer()
})

test('existing clients receive join for newcomer', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  await handshake(wsA, qA)

  const wsB = connect()
  const qB = makeMessageQueue(wsB)
  const helloB = await handshake(wsB, qB)
  const idB = helloB.id

  // A should receive a join message with B's server-assigned ID
  const joinMsg = await qA.waitForType('join', 500)

  assert.ok(joinMsg !== null, 'existing client should receive a join message')
  assert.equal(joinMsg.type, 'join')
  assert.equal(joinMsg.id, idB)

  wsA.close()
  wsB.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB)])
  await drainServer()
})

test('client receives no join for itself', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  const helloA = await handshake(wsA, qA)
  const idA = helloA.id

  // Collect any join messages for a short window
  const joinMsg = await qA.waitForType('join', 300)

  // A should not receive a join with its own ID (it was the only client)
  if (joinMsg !== null) {
    assert.notEqual(joinMsg.id, idA, 'client should not receive a join with its own ID')
  }

  wsA.close()
  await waitForClose(wsA)
  await drainServer()
})

test('remaining clients receive leave on disconnect', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  const helloA = await handshake(wsA, qA)
  const idA = helloA.id

  const wsB = connect()
  const qB = makeMessageQueue(wsB)
  await handshake(wsB, qB)
  // consume the join-for-A that B receives during bootstrap
  await qB.waitForType('join', 300)

  wsA.close()
  await waitForClose(wsA)

  // B should receive a leave message with A's ID
  const leaveMsg = await qB.waitForType('leave', 500)

  assert.ok(leaveMsg !== null, 'remaining client should receive a leave message')
  assert.equal(leaveMsg.type, 'leave')
  assert.equal(leaveMsg.id, idA)

  wsB.close()
  await waitForClose(wsB)
  await drainServer()
})

test('leave is not broadcast for pre-handshake disconnect', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  await handshake(wsA, qA)

  // Connect a client but do NOT send hello, then immediately disconnect
  const wsC = connect()
  await waitForOpen(wsC)
  wsC.close()
  await waitForClose(wsC)

  // A should NOT receive a leave message
  const leaveMsg = await qA.waitForType('leave', 300)
  assert.equal(leaveMsg, null, 'should not broadcast leave for pre-handshake disconnect')

  wsA.close()
  await waitForClose(wsA)
  await drainServer()
})

test('presence list is accurate', async () => {
  const wsA = connect()
  const qA = makeMessageQueue(wsA)
  await handshake(wsA, qA)

  const wsB = connect()
  const qB = makeMessageQueue(wsB)
  await handshake(wsB, qB)

  await drainServer()

  assert.equal(server.presence.list().length, 2, 'presence should have 2 entries')

  wsA.close()
  await waitForClose(wsA)
  await drainServer()

  assert.equal(server.presence.list().length, 1, 'presence should have 1 entry after disconnect')

  wsB.close()
  await waitForClose(wsB)
  await drainServer()
})
