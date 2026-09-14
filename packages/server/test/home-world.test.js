// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Integration tests for home world auto-create + auto-load on login.
// Covers: ensureHomeWorld, routing, admission, lifecycle, and edge cases.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { request } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { createWorldRegistry } from '../src/world-registry.js'
import { createRequestHandler } from '../src/http-routes.js'
import { createWorld } from '../src/world.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'
import { ensureHomeWorld, DEFAULT_HOME_DOCUMENT } from '../src/home-world.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const PORT = 9051

// Temporary database for tests
const tempDir = mkdtempSync(join(tmpdir(), 'atrium-home-test-'))
const dbPath = join(tempDir, 'test.db')

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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

// Helper: extract auth cookie from a response's set-cookie header
function cookieFromResponse(res) {
  const setCookie = res.headers['set-cookie']
  if (!setCookie) return null
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return raw.split(';')[0]
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForMessage(ws, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    if (timer.unref) timer.unref()
    ws.once('message', (raw) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(raw)) } catch {}
    })
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

function websocketConnectWithHeaders(headers = {}) {
  const ws = new WebSocket(`ws://localhost:${PORT}`, { headers })
  const q = makeMessageQueue(ws)
  return { ws, q }
}

async function doHandshake(ws, clientId) {
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: clientId || `test-${Date.now()}-${Math.random()}`,
    capabilities: { tick: { interval: 5000 } },
  }))
  return waitForMessage(ws, 2000)
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const db = createDb(dbPath)
const httpServer = createServer(createRequestHandler({ db, auth }))
const registry = createWorldRegistry({ httpServer, db })

// Register a default world so the server can boot (needed for the registry
// to have at least a 'default' host that the HTTP routes can reference)
const defaultWorld = await createWorld(FIXTURE_PATH)
await defaultWorld.resolveExternalReferences()
const defaultHost = registry.getDefaultHost()
// Actually we need to register it manually since registry.registerWorld
// is what creates the host
const host = await registry.registerWorld('default', FIXTURE_PATH)

httpServer.listen(PORT)

after(async () => {
  registry.close()
  httpServer.close()
  db.close()
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ── ensureHomeWorld unit tests ──

test('ensureHomeWorld creates a world row with slug home and default document', () => {
  // Create a user first (FK constraint: world.owner_user_id references users.id)
  const userId = '00000000-0000-0000-0000-000000000001'
  db.database.prepare(
    'INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'homeworld-test-user-1', '', 'test', new Date().toISOString())

  const result = ensureHomeWorld(db.database, userId)

  assert.equal(result.slug, 'home')
  assert.equal(result.created, true)

  const row = db.database.prepare(
    'SELECT id, slug, owner_user_id, document, visibility FROM worlds WHERE id = ?'
  ).get(result.id)
  assert.ok(row, 'row exists')
  assert.equal(row.slug, 'home')
  assert.equal(row.owner_user_id, userId)
  assert.equal(row.visibility, 'private')
  assert.equal(row.document, DEFAULT_HOME_DOCUMENT, 'document matches default')
})

test('ensureHomeWorld is idempotent on second call', () => {
  const userId = '00000000-0000-0000-0000-000000000001'
  const first = ensureHomeWorld(db.database, userId)
  const second = ensureHomeWorld(db.database, userId)

  assert.equal(second.created, false)
  assert.equal(second.id, first.id)
})

test('ensureHomeWorld is idempotent across different users', () => {
  const userIdA = '00000000-0000-0000-0000-00000000000a'
  const userIdB = '00000000-0000-0000-0000-00000000000b'
  db.database.prepare(
    'INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userIdA, 'homeworld-test-user-a', '', 'test', new Date().toISOString())
  db.database.prepare(
    'INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userIdB, 'homeworld-test-user-b', '', 'test', new Date().toISOString())

  const resultA = ensureHomeWorld(db.database, userIdA)
  const resultB = ensureHomeWorld(db.database, userIdB)

  assert.equal(resultA.created, true)
  assert.equal(resultB.created, true)
  assert.notEqual(resultA.id, resultB.id, 'each user gets their own home world')
})

// ── HTTP integration: register creates home world ──

test('register creates a home world for the new user', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  assert.equal(res.statusCode, 201)

  // Parse the cookie from the set-cookie header (Node.js returns array for Set-Cookie)
  const setCookie = res.headers['set-cookie']
  assert.ok(setCookie, 'set-cookie present')
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]

  // Verify home world row exists
  const userId = res.body.id
  const row = db.database.prepare(
    "SELECT id, slug, owner_user_id FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)
  assert.ok(row, 'home world row created')
  assert.equal(row.slug, 'home')
  assert.equal(row.owner_user_id, userId)
})

test('login (after register) does not create duplicate home world', async () => {
  const res = await httpPost('/api/auth/login', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  assert.equal(res.statusCode, 200)

  const userId = res.body.id
  const rows = db.database.prepare(
    "SELECT COUNT(*) as cnt FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)
  assert.equal(rows.cnt, 1, 'exactly one home world row')
})

// ── WS routing: owner can connect to /home/<userId>/home ──

test('owner can upgrade on /home/<userId>/home and receives hello + som-dump', async () => {
  // Login to get cookie
  const loginRes = await httpPost('/api/auth/login', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  assert.equal(loginRes.statusCode, 200)
  const cookie = cookieFromResponse(loginRes)
  const userId = loginRes.body.id

  // WS connect to /home/<userId>/home with cookie header
  const ws = new WebSocket(`ws://localhost:${PORT}/home/${userId}/home`, {
    headers: { Cookie: cookie },
  })
  const msgs = []
  ws.on('message', (raw) => { try { msgs.push(JSON.parse(raw)) } catch {} })
  await waitForOpen(ws)

  ws.send(JSON.stringify({
    type: 'hello',
    id: 'alice-home-connect',
    capabilities: { tick: { interval: 5000 } },
  }))

  // Wait for responses (hello + som-dump)
  await new Promise(r => setTimeout(r, 1500))
  const hello = msgs.find(m => m.type === 'hello')
  const dump = msgs.find(m => m.type === 'som-dump')

  assert.ok(hello, 'received hello response')
  assert.equal(hello?.type, 'hello')
  assert.ok(dump, 'received som-dump')
  assert.equal(dump?.type, 'som-dump')

  // Verify the host is keyed by world row UUID, not path string
  const row = db.database.prepare(
    "SELECT id FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)
  assert.ok(row, 'row exists')
  assert.ok(registry.hosts.has(row.id), 'host keyed by row UUID')

  ws.close()
})

test('second connection evicts existing session for same user', async () => {
  const loginRes = await httpPost('/api/auth/login', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  const cookie = cookieFromResponse(loginRes)
  const userId = loginRes.body.id

  const row = db.database.prepare(
    "SELECT id FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)

  // First connection
  const ws1 = new WebSocket(`ws://localhost:${PORT}/home/${userId}/home`, {
    headers: { Cookie: cookie },
  })
  await doHandshake(ws1, 'alice-conn-a')

  // Small delay to ensure first session is fully established
  await new Promise(r => setTimeout(r, 100))

  // Second connection — should evict ws1's session (same upgradeUserId)
  let ws2Error = null
  const ws2 = new WebSocket(`ws://localhost:${PORT}/home/${userId}/home`, {
    headers: { Cookie: cookie },
  })
  ws2.on('error', (e) => { ws2Error = e.message })
  const ws2Hello = await doHandshake(ws2, 'alice-conn-b')
  assert.ok(ws2Hello, 'ws2 received hello')
  assert.equal(ws2Hello?.type, 'hello')
  assert.equal(ws2Error, null, 'ws2 has no error')

  // Wait briefly for eviction to complete
  await new Promise(r => setTimeout(r, 200))

  // The host should still exist, but only ws2's session survives
  // (session dedup evicts old sessions for the same authenticated user)
  const host = registry.hosts.get(row.id)
  assert.ok(host, 'host exists')
  assert.equal(host.sessions.size, 1, 'only one session per auth user')
  // ws2's session id should be 'alice-conn-b'
  assert.ok(host.sessions.has('alice-conn-b'), 'ws2 session registered')
  assert.equal(host.sessions.has('alice-conn-a'), false, 'ws1 session evicted')

  // ws1 should have been closed by eviction
  await new Promise(r => setTimeout(r, 100))
  assert.equal(ws1.readyState, WebSocket.CLOSED, 'ws1 closed by eviction')

  ws2.close()
})

// ── Admission: anonymous and mismatched user ──

test('anonymous connect to /home/<userId>/home returns 404', async () => {
  // Use a valid user id that exists
  const loginRes = await httpPost('/api/auth/login', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  const userId = loginRes.body.id

  // Connect WITHOUT cookie (anonymous) — server rejects with HTTP 404 before WS upgrade
  const path = `/home/${userId}/home`
  let errorCaught = false
  const ws = new WebSocket(`ws://localhost:${PORT}${path}`)
  ws.on('error', () => { errorCaught = true })
  ws.on('unexpected-response', (req, res) => {
    errorCaught = true
    res.resume() // consume the response body
  })

  // Wait for the connection to fail
  let opened = false
  ws.once('open', () => { opened = true })
  await new Promise(r => setTimeout(r, 500))

  assert.equal(opened, false, 'anonymous connection did not open')
  assert.ok(errorCaught, 'anonymous connection got error/404 response')
  try { ws.close() } catch {}
})

test('mismatched user connect to /home/<otherUserId>/home returns 404', async () => {
  // Register second user
  const res2 = await httpPost('/api/auth/register', {
    username: 'homeworld-bob',
    password: 'correct horse battery staple',
  })
  const bobId = res2.body.id
  const bobCookie = cookieFromResponse(res2)

  // Get alice's userId
  const aliceRes = await httpPost('/api/auth/login', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  const aliceId = aliceRes.body.id

  // Bob tries to connect to /home/<aliceId>/home
  let bobError = false
  const ws = new WebSocket(`ws://localhost:${PORT}/home/${aliceId}/home`, {
    headers: { Cookie: bobCookie },
  })
  ws.on('error', () => { bobError = true })
  ws.on('unexpected-response', (req, res) => { bobError = true; res.resume() })
  let opened = false
  ws.once('open', () => { opened = true })
  await new Promise(r => setTimeout(r, 500))
  assert.equal(opened, false, 'mismatched user connection did not open')
  try { ws.close() } catch {}

  // Bob CAN connect to his own home
  const ws2 = new WebSocket(`ws://localhost:${PORT}/home/${bobId}/home`, {
    headers: { Cookie: bobCookie },
  })
  await doHandshake(ws2, 'bob-own-home')
  ws2.close()
})

// ── Malformed paths ──

test('malformed /home/ paths are rejected', async () => {
  const loginRes = await httpPost('/api/auth/login', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  const cookie = cookieFromResponse(loginRes)

  // Helper to check that a WS path is rejected with 404
  async function assertRejected(path) {
    let err = false
    const ws = new WebSocket(`ws://localhost:${PORT}${path}`, { headers: { Cookie: cookie } })
    ws.on('error', () => { err = true })
    ws.on('unexpected-response', (req, res) => { err = true; res.resume() })
    let opened = false
    ws.once('open', () => { opened = true })
    await new Promise(r => setTimeout(r, 500))
    assert.equal(opened, false, `${path} rejected`)
    try { ws.close() } catch {}
  }

  // Missing /home segment (/home/<uid> instead of /home/<uid>/home)
  await assertRejected('/home/someuser')

  // Extra segment (/home/<uid>/home/extra)
  const userId = loginRes.body.id
  await assertRejected(`/home/${userId}/home/extra`)

  // Non-UUID userId
  await assertRejected('/home/not-a-uuid/home')
})

// ── Trailing-slash variant ──

test('trailing slash on /home/<userId>/home/ resolves correctly', async () => {
  const loginRes = await httpPost('/api/auth/login', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  const cookie = cookieFromResponse(loginRes)
  const userId = loginRes.body.id

  // Connect to trailing-slash variant
  const ws = new WebSocket(`ws://localhost:${PORT}/home/${userId}/home/`, {
    headers: { Cookie: cookie },
  })
  const hello = await doHandshake(ws, 'trailing-slash')
  assert.ok(hello, 'trailing slash variant works')
  assert.equal(hello?.type, 'hello')
  ws.close()
})

// ── Deleted home world re-created on next login ──

test('deleted home world is re-created on next login', async () => {
  // Register a user
  const res = await httpPost('/api/auth/register', {
    username: 'homeworld-deleteme',
    password: 'correct horse battery staple',
  })
  const userId = res.body.id
  const cookie = cookieFromResponse(res)

  // Get home world id and delete it
  const row = db.database.prepare(
    "SELECT id FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)
  assert.ok(row, 'home world exists after register')
  db.database.prepare("DELETE FROM worlds WHERE id = ?").run(row.id)

  // Verify deleted
  const deleted = db.database.prepare(
    "SELECT id FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)
  assert.equal(deleted, undefined, 'home world deleted')

  // Login again — should re-create
  const loginRes = await httpPost('/api/auth/login', {
    username: 'homeworld-deleteme',
    password: 'correct horse battery staple',
  })
  assert.equal(loginRes.statusCode, 200)

  const recreated = db.database.prepare(
    "SELECT id, document FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)
  assert.ok(recreated, 'home world re-created after login')
  assert.notEqual(recreated.id, row.id, 'new row id')
  assert.equal(recreated.document, DEFAULT_HOME_DOCUMENT, 'fresh default document')

  // Can connect to it
  const newCookie = cookieFromResponse(loginRes)
  const ws = new WebSocket(`ws://localhost:${PORT}/home/${userId}/home`, {
    headers: { Cookie: newCookie },
  })
  const hello = await doHandshake(ws, 'recreate-connect')
  assert.ok(hello, 're-created home world is joinable')
  ws.close()
})

// ── Slug reservation ──

test('POST /api/worlds with slug "home" returns 400', async () => {
  const loginRes = await httpPost('/api/auth/login', {
    username: 'homeworld-alice',
    password: 'correct horse battery staple',
  })
  const cookie = cookieFromResponse(loginRes)

  const res = await httpPostWithCookie('/api/worlds', { slug: 'home', name: 'My Home' }, cookie)
  assert.equal(res.statusCode, 400)
  assert.ok(res.body.error.includes('reserved'), 'error mentions reserved')
})

// ── Existing regression tests: /apps/client routing ──

test('existing /apps/client still routes to default world', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}/apps/client`)
  const hello = await doHandshake(ws, 'apps-client-test')
  assert.ok(hello, '/apps/client routes to default world')
  assert.equal(hello?.type, 'hello')
  ws.close()
})