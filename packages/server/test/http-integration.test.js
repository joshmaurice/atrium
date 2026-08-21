// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { request } from 'node:http'
import { connect } from 'node:net'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { createSessionServer } from '../src/session.js'
import { createWorld } from '../src/world.js'
import { createRequestHandler, parseAuthSessionCookie } from '../src/http-routes.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const PORT = 3015

// Temporary database for HTTP integration tests
const tempDir = mkdtempSync(join(tmpdir(), 'atrium-http-test-'))
const dbPath = join(tempDir, 'test.db')

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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

function httpPost(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
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
    req.write(data)
    req.end()
  })
}

function httpPostWithCookie(path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Cookie': cookie,
        },
      },
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
    req.write(data)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// WS helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Server setup with real HTTP routing and WS upgrade on shared port
// ---------------------------------------------------------------------------

const db = createDb(dbPath)
const httpServer = createServer(createRequestHandler({ db, auth }))

const world = await createWorld(FIXTURE_PATH)
const server = createSessionServer({ httpServer, maxUsers: 20, world })

httpServer.listen(PORT)

after(async () => {
  server.close()
  db.close()
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// HTTP tests
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

// ---------------------------------------------------------------------------
// POST /api/auth/register tests
// ---------------------------------------------------------------------------

test('POST /api/auth/register creates a user and returns 201 with cookie', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'alice',
    password: 'correct horse battery staple', // 31 chars, meets min length
  })

  assert.equal(res.statusCode, 201)
  assert.equal(res.headers['content-type'], 'application/json')
  assert.ok(res.body.id, 'response includes user id')
  assert.equal(res.body.username, 'alice')
  assert.equal(res.body.displayName, 'alice')
  assert.ok(res.body.createdAt, 'response includes created_at')

  // Cookie should be set
  const setCookie = res.headers['set-cookie']
  assert.ok(setCookie, 'Set-Cookie header present')
  const cookieStr = Array.isArray(setCookie) ? setCookie.join(', ') : setCookie
  assert.ok(cookieStr.includes('atrium_auth_session='))
  assert.ok(cookieStr.includes('HttpOnly'))
  assert.ok(cookieStr.includes('Secure'))
  assert.ok(cookieStr.includes('SameSite=Lax'))
  assert.ok(cookieStr.includes('Path=/'))
})

test('POST /api/auth/register rejects duplicate username with 409', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'alice', // same username as the test above
    password: 'another correct long phrase',
  })

  assert.equal(res.statusCode, 409)
  assert.ok(res.body.error)
  assert.ok(res.body.error.toLowerCase().includes('already exists'))
})

test('POST /api/auth/register rejects short password with 400', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'bob',
    password: 'short1',
  })

  assert.equal(res.statusCode, 400)
  assert.ok(res.body.error)
  assert.ok(res.body.error.toLowerCase().includes('at least'))
})

test('POST /api/auth/register rejects common password with 400', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'charlie',
    password: 'password', // on the blocklist but also too short — first error wins
  })

  assert.equal(res.statusCode, 400)
  assert.ok(res.body.error)
  // Could be either error (min-length or common), just assert it's an error
})

test('POST /api/auth/register rejects missing username with 400', async () => {
  const res = await httpPost('/api/auth/register', {
    password: 'this is a sufficiently long password',
  })

  assert.equal(res.statusCode, 400)
  assert.ok(res.body.error)
  assert.ok(res.body.error.toLowerCase().includes('username'))
})

test('POST /api/auth/register rejects missing password with 400', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'dave',
  })

  assert.equal(res.statusCode, 400)
  assert.ok(res.body.error)
  assert.ok(res.body.error.toLowerCase().includes('at least'))
})

test('POST /api/auth/register enforces username uniqueness case-insensitively', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'ALICE', // same as 'alice' due to case-insensitive constraint
    password: 'some other sufficiently long phrase',
  })

  assert.equal(res.statusCode, 409)
  assert.ok(res.body.error)
  assert.ok(res.body.error.toLowerCase().includes('already exists'))
})

test('POST /api/auth/register normalizes username', async () => {
  const res = await httpPost('/api/auth/register', {
    username: '  Eve  ',
    password: 'a truly magnificent long password',
  })

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.username, 'Eve')
})

// ---------------------------------------------------------------------------
// POST /api/auth/login tests
// ---------------------------------------------------------------------------

test('POST /api/auth/login succeeds with valid credentials', async () => {
  const res = await httpPost('/api/auth/login', {
    username: 'alice',
    password: 'correct horse battery staple',
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.username, 'alice')
  assert.ok(res.body.id, 'response includes user id')
  assert.ok(res.body.createdAt, 'response includes created_at')

  // Cookie should be set
  const setCookie = res.headers['set-cookie']
  assert.ok(setCookie, 'Set-Cookie header present')
  const cookieStr = Array.isArray(setCookie) ? setCookie.join(', ') : setCookie
  assert.ok(cookieStr.includes('atrium_auth_session='))
})

test('POST /api/auth/login returns 401 for wrong password', async () => {
  const res = await httpPost('/api/auth/login', {
    username: 'alice',
    password: 'wrong password that is long enough',
  })

  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'Invalid credentials')
})

test('POST /api/auth/login returns 401 for non-existent user', async () => {
  const res = await httpPost('/api/auth/login', {
    username: 'nonexistent_user',
    password: 'some sufficiently long password',
  })

  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'Invalid credentials')
})

test('POST /api/auth/login returns 401 for case-insensitive matched user with wrong password', async () => {
  const res = await httpPost('/api/auth/login', {
    username: 'ALICE', // matches 'alice' via COLLATE NOCASE
    password: 'wrong password that is long enough',
  })

  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'Invalid credentials')
})

test('POST /api/auth/login returns 400 for missing fields', async () => {
  const noUser = await httpPost('/api/auth/login', { password: 'some sufficiently long password' })
  assert.equal(noUser.statusCode, 400)
  assert.ok(noUser.body.error)

  const noPass = await httpPost('/api/auth/login', { username: 'alice' })
  assert.equal(noPass.statusCode, 400)
  assert.ok(noPass.body.error)
})

// ---------------------------------------------------------------------------
// POST /api/auth/logout tests
// ---------------------------------------------------------------------------

test('POST /api/auth/logout clears cookie and returns 200', async () => {
  // First, login to get a valid session cookie
  const loginRes = await httpPost('/api/auth/login', {
    username: 'alice',
    password: 'correct horse battery staple',
  })
  assert.equal(loginRes.statusCode, 200)

  const cookieStr = Array.isArray(loginRes.headers['set-cookie'])
    ? loginRes.headers['set-cookie'].join('; ')
    : loginRes.headers['set-cookie']

  // Now logout with the cookie
  const res = await httpPostWithCookie('/api/auth/logout', {}, cookieStr)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.message, 'Logged out')

  // Cookie should be cleared (Max-Age=0)
  const logoutCookie = Array.isArray(res.headers['set-cookie'])
    ? res.headers['set-cookie'].join('; ')
    : res.headers['set-cookie']
  assert.ok(logoutCookie, 'Set-Cookie header present on logout')
  assert.ok(logoutCookie.includes('Max-Age=0'))
})

test('POST /api/auth/logout works without a cookie (idempotent)', async () => {
  const res = await httpPost('/api/auth/logout', {})

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.message, 'Logged out')
})

// ---------------------------------------------------------------------------
// WebSocket integration tests
// ---------------------------------------------------------------------------

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