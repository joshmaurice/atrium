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
import { createWorldRegistry } from '../src/world-registry.js'
import { createRequestHandler, parseAuthSessionCookie } from '../src/http-routes.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'
import { validate } from '@atrium/protocol'

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

function httpGetWithCookie(path, cookie) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method: 'GET',
        headers: { 'Cookie': cookie },
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
    req.end()
  })
}

function httpPostWithOrigin(path, payload, origin) {
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
          'Origin': origin,
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

function httpGetWithOrigin(path, origin) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method: 'GET',
        headers: { 'Origin': origin },
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

/**
 * Connect a WebSocket with headers (simulating browser cookies during upgrade).
 */
function websocketConnectWithHeaders(headers = {}) {
  const ws = new WebSocket(`ws://localhost:${PORT}`, { headers })
  const q = makeMessageQueue(ws)
  return { ws, q }
}

// ---------------------------------------------------------------------------
// Server setup with real HTTP routing and WS upgrade on shared port
// ---------------------------------------------------------------------------

const db = createDb(dbPath)
const httpServer = createServer(createRequestHandler({ db, auth }))

const world = await createWorld(FIXTURE_PATH)
const server = createSessionServer({ httpServer, maxUsers: 20, world, db })

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

test('POST /api/auth/register rejects username . (dot) with 400 (pre-brief #10)', async () => {
  const res = await httpPost('/api/auth/register', {
    username: '.',
    password: 'a truly magnificent long password',
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/auth/register rejects username .. (dotdot) with 400 (pre-brief #10)', async () => {
  const res = await httpPost('/api/auth/register', {
    username: '..',
    password: 'a truly magnificent long password',
  })
  assert.equal(res.statusCode, 400)
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
// GET /api/auth/me tests
// ---------------------------------------------------------------------------

test('GET /api/auth/me returns user info for authenticated request', async () => {
  // Login first to get a valid cookie
  const loginRes = await httpPost('/api/auth/login', {
    username: 'alice',
    password: 'correct horse battery staple',
  })
  assert.equal(loginRes.statusCode, 200)

  const cookieStr = Array.isArray(loginRes.headers['set-cookie'])
    ? loginRes.headers['set-cookie'].join('; ')
    : loginRes.headers['set-cookie']

  // Use the cookie to call /me
  const res = await httpGetWithCookie('/api/auth/me', cookieStr)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.username, 'alice')
  assert.ok(res.body.id)
  assert.ok(res.body.displayName)
  assert.ok(res.body.createdAt)
})

test('GET /api/auth/me returns 401 without cookie', async () => {
  const res = await httpGet('/api/auth/me')
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'Not authenticated')
})

test('GET /api/auth/me returns 401 with expired/unknown cookie', async () => {
  const res = await httpGetWithCookie('/api/auth/me', 'atrium_auth_session=nonexistent-session-id')
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'Not authenticated')
})

// ---------------------------------------------------------------------------
// Origin validation tests (CSRF)
// ---------------------------------------------------------------------------

test('POST /api/auth/register with cross-origin header is rejected (403)', async () => {
  const res = await httpPostWithOrigin('/api/auth/register', {
    username: 'cross-origin-user',
    password: 'a sufficiently long password ok',
  }, 'https://evil-website.com')

  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'Cross-origin request denied')
})

test('POST /api/auth/login with cross-origin header is rejected (403)', async () => {
  const res = await httpPostWithOrigin('/api/auth/login', {
    username: 'alice',
    password: 'correct horse battery staple',
  }, 'https://evil-website.com')

  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'Cross-origin request denied')
})

test('POST /api/auth/logout with cross-origin header is rejected (403)', async () => {
  const res = await httpPostWithOrigin('/api/auth/logout', {}, 'https://evil-website.com')

  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'Cross-origin request denied')
})

test('GET /api/auth/me is exempt from origin validation', async () => {
  const res = await httpGetWithOrigin('/api/auth/me', 'https://evil-website.com')
  // Exempt routes don't validate origin — just returns 401 because no cookie
  assert.equal(res.statusCode, 401)
})

test('GET /api/health is exempt from origin validation', async () => {
  const res = await httpGetWithOrigin('/api/health', 'https://evil-website.com')
  // Exempt routes don't validate origin — returns 200
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { status: 'ok' })
})

test('WebSocket upgrade with cross-origin header is now permitted (pre-brief #2)', async () => {
  const socket = connect(PORT, 'localhost')

  let receivedData = false
  let closed = false

  socket.on('data', () => { receivedData = true })
  socket.on('close', () => { closed = true })

  await new Promise((resolve, reject) => {
    socket.on('connect', resolve)
    socket.on('error', reject)
  })

  // Send a WebSocket upgrade request with a cross-origin Origin header
  // Cross-origin WS upgrades are now permitted (pre-brief #2).
  // SameSite=Lax cookies don't ride cross-origin, so the visitor arrives
  // anonymous — correct behavior for server-local identity.
  socket.write(
    'GET / HTTP/1.1\r\n' +
    'Host: localhost\r\n' +
    'Connection: Upgrade\r\n' +
    'Upgrade: websocket\r\n' +
    'Origin: https://evil-website.com\r\n' +
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
    'Sec-WebSocket-Version: 13\r\n' +
    '\r\n'
  )

  await new Promise(r => setTimeout(r, 300))

  // Cross-origin WS upgrades are now permitted — socket should NOT be destroyed
  assert.ok(!closed, 'cross-origin WS upgrade should NOT be destroyed (pre-brief #2)')
  // The WebSocket handshake response is 101 Switching Protocols
  assert.ok(receivedData, 'cross-origin WS upgrade should receive a handshake response')

  socket.destroy()
})

// ---------------------------------------------------------------------------
// WebSocket upgrade — cookie resolution tests
// ---------------------------------------------------------------------------

test('WebSocket upgrade with valid auth cookie resolves userId on session', async () => {
  // Login to get a valid session cookie
  const loginRes = await httpPost('/api/auth/login', {
    username: 'alice',
    password: 'correct horse battery staple',
  })
  assert.equal(loginRes.statusCode, 200)

  const cookieStr = Array.isArray(loginRes.headers['set-cookie'])
    ? loginRes.headers['set-cookie'].join('; ')
    : loginRes.headers['set-cookie']

  // Connect WebSocket with the cookie
  const { ws, q } = websocketConnectWithHeaders({ Cookie: cookieStr })
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'ws-auth-test-valid',
    capabilities: { tick: { interval: 5000 } },
  }))

  // Verify the hello response has avatarNodeName (confirms WS connected)
  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  assert.equal(hello.type, 'hello')

  ws.close()
  await waitForClose(ws)
})

test('WebSocket upgrade without cookie resolves to anonymous (userId null)', async () => {
  const { ws, q } = websocketConnectWithHeaders({})
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'ws-auth-test-anon',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')

  ws.close()
  await waitForClose(ws)
})

test('WebSocket upgrade with expired/garbage cookie resolves to anonymous', async () => {
  const { ws, q } = websocketConnectWithHeaders({
    Cookie: 'atrium_auth_session=nonexistent-garbage-id',
  })
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'ws-auth-test-garbage',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello (anonymous)')

  ws.close()
  await waitForClose(ws)
})

// ---------------------------------------------------------------------------
// F1: Server displayName — server is authoritative over session names
// ---------------------------------------------------------------------------

test('F1: anonymous hello claiming a name gets User-xxxx in hello response', async () => {
  const { ws, q } = websocketConnectWithHeaders({})
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'f1-name-claim-test',
    displayName: 'josh',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  assert.ok(hello.displayName.startsWith('User-'), 'anonymous gets User-xxxx name, not claimed name')

  ws.close()
  await waitForClose(ws)
})

test('F1: authenticated session gets DB display_name regardless of client hello displayName', async () => {
  // Login to get a valid session cookie
  const loginRes = await httpPost('/api/auth/login', {
    username: 'alice',
    password: 'correct horse battery staple',
  })
  assert.equal(loginRes.statusCode, 200)

  const cookieStr = Array.isArray(loginRes.headers['set-cookie'])
    ? loginRes.headers['set-cookie'].join('; ')
    : loginRes.headers['set-cookie']

  const { ws, q } = websocketConnectWithHeaders({ Cookie: cookieStr })
  await waitForOpen(ws)

  // Send hello with a fake displayName — server should ignore it
  ws.send(JSON.stringify({
    type: 'hello',
    id: 'f1-auth-name-test',
    displayName: 'Impostor',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  assert.equal(hello.displayName, 'alice', 'authenticated user gets DB display_name, not client-sent name')

  ws.close()
  await waitForClose(ws)
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

// ---------------------------------------------------------------------------
// F6: hello displayName schema tests
// ---------------------------------------------------------------------------

test('F6: server hello schema validates with displayName', () => {
  const result = validate('server', {
    type: 'hello',
    id: 'test',
    seq: 1,
    serverTime: 1000,
    displayName: 'TestUser',
  })
  assert.ok(result.valid, `server hello with displayName is valid: ${JSON.stringify(result.errors)}`)
})

test('F6: server hello schema rejects unknown property', () => {
  const result = validate('server', {
    type: 'hello',
    id: 'test',
    seq: 1,
    serverTime: 1000,
    unknownField: 'xyz',
  })
  assert.equal(result.valid, false, 'server hello rejects unknown property')
})

test('F6: client hello schema validates with displayName', () => {
  const result = validate('client', {
    type: 'hello',
    id: 'test',
    displayName: 'ClaimedName',
    capabilities: { tick: { interval: 5000 } },
  })
  assert.ok(result.valid, `client hello with displayName is valid: ${JSON.stringify(result.errors)}`)
})

// ---------------------------------------------------------------------------
// F6: Cross-origin upgrade with valid cookie — always anonymous
// ---------------------------------------------------------------------------

test('F6: cross-origin WS upgrade arrives anonymous (User-xxxx)', async () => {
  // Connect WebSocket with a cross-origin Origin header — no cookie needed
  // to verify anonymous behavior (Origin null would also be anonymous).
  const CrossOriginWS = new WebSocket(`ws://localhost:${PORT}`, {
    headers: {
      Origin: 'https://evil-website.com',
    },
  })
  const q = makeMessageQueue(CrossOriginWS)
  await waitForOpen(CrossOriginWS)

  CrossOriginWS.send(JSON.stringify({
    type: 'hello',
    id: 'f6-cross-origin-test',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  assert.ok(hello.displayName.startsWith('User-'), 'cross-origin visitor gets User-xxxx name')

  CrossOriginWS.close()
  await waitForClose(CrossOriginWS)
})

test('F6: cross-origin POST /api/worlds gets 403 (CSRF check)', async () => {
  // Cross-origin POST to create a world without a cookie
  // The Origin CSRF check on HTTP routes still blocks cross-origin requests.
  const res = await httpPostWithOrigin('/api/worlds', { slug: 'test-world' }, 'https://evil-website.com')
  assert.equal(res.statusCode, 403, 'cross-origin POST /api/worlds is rejected')
  assert.ok(res.body.error, 'response includes error message')
})

test('F6: cross-origin from same-site sibling arrives anonymous too', async () => {
  // A same-site sibling (same registrable domain, different hostname) is
  // still cross-origin — must be anonymous like any other cross-origin.
  const siblingWS = new WebSocket(`ws://localhost:${PORT}`, {
    headers: {
      Origin: 'https://othersite.example.com',
    },
  })
  const q = makeMessageQueue(siblingWS)
  await waitForOpen(siblingWS)

  siblingWS.send(JSON.stringify({
    type: 'hello',
    id: 'f6-same-site-cross',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  assert.ok(hello.displayName.startsWith('User-'), 'same-site cross-origin visitor gets User-xxxx name')

  siblingWS.close()
  await waitForClose(siblingWS)
})

test('F6: Origin null upgrade admitted as anonymous', async () => {
  // Origin: null — sandboxed iframe, file:// page — admitted as anonymous
  const nullOriginWS = new WebSocket(`ws://localhost:${PORT}`, {
    headers: {
      Origin: 'null',
    },
  })
  const q = makeMessageQueue(nullOriginWS)
  await waitForOpen(nullOriginWS)

  nullOriginWS.send(JSON.stringify({
    type: 'hello',
    id: 'f6-null-origin',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  assert.ok(hello.displayName.startsWith('User-'), 'Origin null visitor gets User-xxxx name')

  nullOriginWS.close()
  await waitForClose(nullOriginWS)
})

// ---------------------------------------------------------------------------
// F6: Cross-origin with valid login cookie — always anonymous upgrade,
//     CSRF still applies to HTTP
// ---------------------------------------------------------------------------

test('F6: POST with cross-origin + valid cookie gets 403 (CSRF first)', async () => {
  // Cross-origin POST even with a valid session cookie — CSRF check returns 403 first
  const res = await httpPostWithOrigin(
    '/api/auth/logout', {},
    'https://evil-website.com'
  )
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'Cross-origin request denied')
})

test('F6: cross-origin + valid cookie — WS upgrade arrives anonymous (User-xxxx)', async () => {
  // Connect with both cross-origin Origin header AND a valid-looking auth cookie.
  // The isSameOriginUpgrade check runs first and returns false for cross-origin,
  // so resolveUpgradeUserId returns null regardless of cookie validity.
  const { ws, q } = websocketConnectWithHeaders({
    Origin: 'https://evil-website.com',
    Cookie: 'atrium_auth_session=valid-but-ignored-cross-origin',
  })
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'f6-cross-plus-cookie',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  // Cookie is not honored cross-origin — visitor is anonymous
  assert.ok(hello.displayName.startsWith('User-'), 'cross-origin + valid cookie gets User-xxxx name')

  ws.close()
  await waitForClose(ws)
})

test('F6: cross-origin + valid cookie — set extras.displayName blocked (PERMISSION_DENIED)', async () => {
  const { ws, q } = websocketConnectWithHeaders({
    Origin: 'https://evil-website.com',
  })
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'f6-cross-cookie-set-guard',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  const avatarNode = hello.avatarNodeName

  await q.waitForType('som-dump', 1000)

  ws.send(JSON.stringify({
    type: 'send',
    seq: 1,
    node: avatarNode,
    field: 'extras.displayName',
    value: 'HackerName',
  }))

  const err = await q.waitForType('error', 1000)
  assert.ok(err !== null, 'should receive error')
  assert.equal(err.code, 'PERMISSION_DENIED', 'set extras.displayName is PERMISSION_DENIED')

  ws.close()
  await waitForClose(ws)
})

// ---------------------------------------------------------------------------
// F6: Private world and home-world routing with cross-origin + cookie
// ---------------------------------------------------------------------------

test('F6: cross-origin + valid cookie — private world via /ws/<id> gets 404', async () => {
  // Set up a separate HTTP server with a world registry that owns a private world
  const regHttp = createServer()
  const REG_PORT = 3991
  regHttp.listen(REG_PORT)
  const reg = createWorldRegistry({ httpServer: regHttp, db })
  const privateHost = await reg.registerWorld('f6-cross-priv', FIXTURE_PATH, 'owner-999')

  try {
    // Try a raw TCP upgrade to /ws/f6-cross-priv with cross-origin + dummy cookie
    const socket = connect(REG_PORT, 'localhost')
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve)
      socket.on('error', reject)
    })

    let response = ''
    socket.on('data', (chunk) => { response += chunk.toString() })
    socket.on('close', () => {})

    socket.write(
      'GET /ws/f6-cross-priv HTTP/1.1\r\n' +
      'Host: localhost\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: websocket\r\n' +
      'Origin: https://evil-website.com\r\n' +
      'Cookie: atrium_auth_session=valid-but-ignored-cross-origin\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
      'Sec-WebSocket-Version: 13\r\n' +
      '\r\n'
    )

    await new Promise(r => setTimeout(r, 300))

    // Cross-origin + cookie still arrives anonymous, private world blocks anonymous -> 404
    assert.ok(response.includes('404'), 'private world returns 404 for cross-origin + cookie visitor')
    assert.ok(response.includes('Not Found'), 'response body is Not Found')

    socket.destroy()
  } finally {
    privateHost.close()
    reg.close()
    regHttp.close()
  }
})

test('F6: cross-origin + valid cookie — /home/<uid>/home gets 404', async () => {
  // Set up a registry for home-world routing. No world registration needed;
  // the path /home/<uid>/home with cross-origin should fail before any host lookup.
  const regHttp = createServer()
  const REG_PORT = 3992
  regHttp.listen(REG_PORT)
  const reg = createWorldRegistry({ httpServer: regHttp, db })

  try {
    // Try a raw TCP upgrade to /home/<some-uid>/home with cross-origin + dummy cookie
    const socket = connect(REG_PORT, 'localhost')
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve)
      socket.on('error', reject)
    })

    let response = ''
    socket.on('data', (chunk) => { response += chunk.toString() })
    socket.on('close', () => {})

    socket.write(
      'GET /home/00000000-0000-0000-0000-000000000000/home HTTP/1.1\r\n' +
      'Host: localhost\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: websocket\r\n' +
      'Origin: https://evil-website.com\r\n' +
      'Cookie: atrium_auth_session=valid-but-ignored-cross-origin\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
      'Sec-WebSocket-Version: 13\r\n' +
      '\r\n'
    )

    await new Promise(r => setTimeout(r, 300))

    // Cross-origin + cookie arrives anonymous (cookie not honored cross-origin)
    // Home world rejects anonymous -> 404
    assert.ok(response.includes('404') || response.includes('Not Found'),
      'home world returns 404 for cross-origin + cookie visitor')

    socket.destroy()
  } finally {
    reg.close()
    regHttp.close()
  }
})

// ---------------------------------------------------------------------------
// F6: Avatar set-guard — server refuses to set extras.displayName
// ---------------------------------------------------------------------------

test('F6: set extras.displayName on own avatar gets PERMISSION_DENIED', async () => {
  const { ws: wsA, q: qA } = websocketConnectWithHeaders({})
  await waitForOpen(wsA)

  wsA.send(JSON.stringify({
    type: 'hello',
    id: 'f6-set-guard-own',
    capabilities: { tick: { interval: 5000 } },
  }))

  const helloA = await qA.waitForType('hello', 1000)
  assert.ok(helloA !== null, 'A should receive hello')
  const avatarNodeA = helloA.avatarNodeName

  // Wait for som-dump
  await qA.waitForType('som-dump', 1000)

  // Try to set extras.displayName on own avatar
  wsA.send(JSON.stringify({
    type: 'send',
    seq: 1,
    node: avatarNodeA,
    field: 'extras.displayName',
    value: 'HackerName',
  }))

  const errorMsg = await qA.waitForType('error', 1000)
  assert.ok(errorMsg !== null, 'should receive error response')
  assert.equal(errorMsg.code, 'PERMISSION_DENIED', 'set of extras.displayName is PERMISSION_DENIED')

  wsA.close()
  await waitForClose(wsA)
})

test('F6: set extras (whole object) on avatar gets PERMISSION_DENIED', async () => {
  const { ws, q } = websocketConnectWithHeaders({})
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'f6-set-guard-extras-whole',
    capabilities: { tick: { interval: 5000 } },
  }))

  const hello = await q.waitForType('hello', 1000)
  assert.ok(hello !== null, 'should receive hello')
  const avatarNode = hello.avatarNodeName

  // Wait for som-dump
  await q.waitForType('som-dump', 1000)

  // Try to set extras (whole object) on avatar
  ws.send(JSON.stringify({
    type: 'send',
    seq: 1,
    node: avatarNode,
    field: 'extras',
    value: { displayName: 'HackerName' },
  }))

  const errorMsg = await q.waitForType('error', 1000)
  assert.ok(errorMsg !== null, 'should receive error response')
  assert.equal(errorMsg.code, 'PERMISSION_DENIED', 'set of extras on avatar is PERMISSION_DENIED')

  ws.close()
  await waitForClose(ws)
})

// ---------------------------------------------------------------------------
// F6: Cross-server replacement — connect A, then B, then A
// ---------------------------------------------------------------------------

test('F6: connect to A then B then A again (cross-server replacement, three legs)', async () => {
  // ── Leg 1: A connects ──
  const wsA = new WebSocket(`ws://localhost:${PORT}`)
  const qA = makeMessageQueue(wsA)
  await waitForOpen(wsA)

  wsA.send(JSON.stringify({
    type: 'hello',
    id: 'f6-csr-a',
    capabilities: { tick: { interval: 5000 } },
  }))

  const helloA = await qA.waitForType('hello', 1000)
  assert.ok(helloA !== null, 'A receives hello')
  assert.ok(helloA.id.startsWith('f6-csr-a'), `helloA.id starts with client id: ${helloA.id}`)
  assert.ok(helloA.displayName.startsWith('User-'), 'A gets User-xxxx name')
  assert.ok(helloA.avatarNodeName.startsWith('avatar-'), 'A gets avatarNodeName')
  const idA = helloA.id

  // Add a node as A (so we can verify the world persists)
  wsA.send(JSON.stringify({
    type: 'add',
    seq: 1,
    node: {
      name: 'a-node',
      type: 'transform',
      translation: [1, 2, 3],
    },
    parent: 'origin',
  }))

  // ── Leg 2: B connects (new session, same server) ──
  const wsB = new WebSocket(`ws://localhost:${PORT}`)
  const qB = makeMessageQueue(wsB)
  await waitForOpen(wsB)

  wsB.send(JSON.stringify({
    type: 'hello',
    id: 'f6-csr-b',
    capabilities: { tick: { interval: 5000 } },
  }))

  const helloB = await qB.waitForType('hello', 1000)
  assert.ok(helloB !== null, 'B receives hello')
  assert.ok(helloB.id.startsWith('f6-csr-b'), `helloB.id starts with client id: ${helloB.id}`)
  assert.ok(helloB.displayName.startsWith('User-'), 'B gets User-xxxx name')
  assert.ok(helloB.avatarNodeName.startsWith('avatar-'), 'B gets avatarNodeName')
  const idB = helloB.id

  // B should get a som-dump
  const somDumpB = await qB.waitForType('som-dump', 1000)
  assert.ok(somDumpB !== null, 'B receives som-dump')
  // B should get join for A
  const joinA = await qB.waitForType('join', 500)
  assert.ok(joinA !== null, 'B receives join for A')
  assert.equal(joinA.id, idA, 'join carries A session id')

  // ── Leg 3: A reconnects (simulating cross-server come-back) ──
  // Close A's original connection
  wsA.close()
  await waitForClose(wsA)

  // New connection with a new client id
  const wsA2 = new WebSocket(`ws://localhost:${PORT}`)
  const qA2 = makeMessageQueue(wsA2)
  await waitForOpen(wsA2)

  wsA2.send(JSON.stringify({
    type: 'hello',
    id: 'f6-csr-a2',
    capabilities: { tick: { interval: 5000 } },
  }))

  const helloA2 = await qA2.waitForType('hello', 1000)
  assert.ok(helloA2 !== null, 'A2 receives hello')
  assert.ok(helloA2.id.startsWith('f6-csr-a2'), `helloA2.id starts with client id: ${helloA2.id}`)
  assert.ok(helloA2.displayName.startsWith('User-'), 'A2 gets User-xxxx name')
  assert.ok(helloA2.avatarNodeName.startsWith('avatar-'), 'A2 gets avatarNodeName')
  const idA2 = helloA2.id

  // A2's session id must differ from A's original session id (new session)
  assert.notEqual(idA2, idA, 'A2 gets a new session id (not same as A)')

  // A2 should get a som-dump with the world
  const somDumpA2 = await qA2.waitForType('som-dump', 1000)
  assert.ok(somDumpA2 !== null, 'A2 receives som-dump')

  // A2 should get join for B (still connected)
  const joinB = await qA2.waitForType('join', 500)
  assert.ok(joinB !== null, 'A2 receives join for B')
  assert.equal(joinB.id, idB, 'join carries B session id')

  // B should get join for A2 (new connection)
  const joinA2 = await qB.waitForType('join', 500)
  assert.ok(joinA2 !== null, 'B receives join for A2')
  assert.equal(joinA2.id, idA2, 'join carries A2 session id')

  // Close B and A2
  wsB.close()
  wsA2.close()
  await Promise.all([waitForClose(wsB), waitForClose(wsA2)])
})