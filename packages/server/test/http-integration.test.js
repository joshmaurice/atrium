// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { request } from 'node:http'
import { connect } from 'node:net'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
import { createSessionServer } from '../src/session.js'
import { createWorld } from '../src/world.js'
import { createRequestHandler } from '../src/http-routes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const PORT = 3007

// Helper: HTTP GET and return parsed JSON body
function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: 'localhost', port: PORT, path, method: 'GET' },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) })
          } catch {
            resolve({ statusCode: res.statusCode, headers: res.headers, body })
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
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

// --------------------------------------------------------------------------- 
// Server setup with real HTTP routing and WS upgrade on shared port
// ---------------------------------------------------------------------------

const httpServer = createServer(createRequestHandler())

const world = await createWorld(FIXTURE_PATH)
const server = createSessionServer({ httpServer, maxUsers: 20, world })

httpServer.listen(PORT)

after(() => {
  server.close()
})

// --------------------------------------------------------------------------- 
// Tests
// ---------------------------------------------------------------------------

test('GET /api/health returns 200 with status ok', async () => {
  const res = await httpGet('/api/health')
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json')
  assert.deepEqual(res.body, { status: 'ok' })
})

test('GET unknown path returns 404', async () => {
  const res = await httpGet('/api/unknown')
  assert.equal(res.statusCode, 404)
})

test('WebSocket client completes hello and receives som-dump', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'integration-test-client-1',
    capabilities: { tick: { interval: 5000 } },
  }))

  // Should receive hello reply
  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  assert.equal(hello.type, 'hello')
  assert.ok(typeof hello.avatarNodeName === 'string')
  assert.ok(hello.avatarNodeName.startsWith('avatar-'))

  // Should receive som-dump with the loaded world
  // (tick may arrive before or after, so waitForType handles ordering)
  const somDump = await q.waitForType('som-dump', 2000)
  assert.ok(somDump !== null, 'should receive som-dump within timeout')
  assert.equal(somDump.type, 'som-dump')
  assert.ok(somDump.gltf !== undefined, 'som-dump should contain gltf data')

  ws.close()
  await waitForClose(ws)
})

test('two clients: view sent by one is received by the other', async () => {
  const wsA = new WebSocket(`ws://localhost:${PORT}`)
  const qA = makeMessageQueue(wsA)
  await waitForOpen(wsA)
  wsA.send(JSON.stringify({
    type: 'hello',
    id: 'integration-view-client-a',
    capabilities: { tick: { interval: 5000 } },
  }))

  // Drain A's hello response
  const helloA = await qA.waitForType('hello', 1000)
  assert.ok(helloA !== null, 'A should receive hello')
  const idA = helloA.id

  // Drain som-dump (not needed for this test)
  await qA.waitForType('som-dump', 1000)

  // Client B connects
  const wsB = new WebSocket(`ws://localhost:${PORT}`)
  const qB = makeMessageQueue(wsB)
  await waitForOpen(wsB)
  wsB.send(JSON.stringify({
    type: 'hello',
    id: 'integration-view-client-b',
    capabilities: { tick: { interval: 5000 } },
  }))

  // Drain B's hello
  const helloB = await qB.waitForType('hello', 1000)
  assert.ok(helloB !== null, 'B should receive hello')

  // Drain B's som-dump and join from A
  await qB.waitForType('som-dump', 1000)
  await qB.waitForType('join', 300)

  // A sends a view
  wsA.send(JSON.stringify({
    type: 'view',
    seq: 1,
    position: [4, 0, 2],
    look: [0, 0, -1],
  }))

  // B should receive A's view
  const viewMsg = await qB.waitForType('view', 1000)
  assert.ok(viewMsg !== null, 'B should receive view from A')
  assert.equal(viewMsg.type, 'view')
  assert.equal(viewMsg.id, idA, 'view should carry A\'s session id')
  assert.deepEqual(viewMsg.position, [4, 0, 2])
  assert.deepEqual(viewMsg.look, [0, 0, -1])

  // A should NOT receive its own view echoed back
  const ownView = await qA.waitForType('view', 300)
  assert.equal(ownView, null, 'A should not receive its own view')

  wsA.close()
  wsB.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB)])
})

test('non-WebSocket upgrade request is rejected (socket destroyed)', async () => {
  // Open a raw TCP connection and send HTTP headers with Connection: Upgrade
  // and Upgrade: h2c (not 'websocket'). The server's upgrade handler should
  // call socket.destroy(), closing the connection without a 101 response.
  const socket = connect(PORT, 'localhost')
  
  // Track whether we saw any data before close
  let receivedData = false
  let closed = false

  socket.on('data', () => { receivedData = true })
  socket.on('close', () => { closed = true })

  // Wait for socket to be writable
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve)
    socket.on('error', reject)
  })

  // Send HTTP request with non-websocket Upgrade
  socket.write(
    'GET / HTTP/1.1\r\n' +
    'Host: localhost\r\n' +
    'Connection: Upgrade\r\n' +
    'Upgrade: h2c\r\n' +
    '\r\n'
  )

  // Give server time to process and close
  await new Promise(r => setTimeout(r, 300))

  assert.ok(closed, 'connection should be destroyed (closed) by server')
  assert.ok(!receivedData, 'server should not send any data before destroying the socket')

  socket.destroy()
})