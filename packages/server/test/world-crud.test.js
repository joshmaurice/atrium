// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, describe, before, after } from 'node:test'
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
import { createSessionServer } from '../src/session.js'
import { createWorld } from '../src/world.js'
import { createRequestHandler, parseAuthSessionCookie } from '../src/http-routes.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'
import * as worldStore from '../src/world-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const PORT = 3017
const BASE = `http://localhost:${PORT}`

// Temporary database
const tempDir = mkdtempSync(join(tmpdir(), 'atrium-worldcrud-test-'))
const dbPath = join(tempDir, 'test.db')

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(path, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {}
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port: PORT, path, method: 'GET', headers },
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

function httpPost(path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    }
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port: PORT, path, method: 'POST', headers },
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

function httpPut(path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    }
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port: PORT, path, method: 'PUT', headers },
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

function httpDelete(path, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {}
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port: PORT, path, method: 'DELETE', headers },
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

// Register a user and return { userId, cookie }
async function registerUser(username, password) {
  const res = await httpPost('/api/auth/register', { username, password })
  assert.equal(res.statusCode, 201)
  const setCookie = Array.isArray(res.headers['set-cookie'])
    ? res.headers['set-cookie'].join('; ')
    : res.headers['set-cookie']
  return { userId: res.body.id, cookie: setCookie }
}

// ---------------------------------------------------------------------------
// WS helpers
// ---------------------------------------------------------------------------

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
// Server setup
// ---------------------------------------------------------------------------

const db = createDb(dbPath)
const sessionsRef = { current: null }

// Create world first — it exists synchronously before the handler, same as index.js
const world = await createWorld(FIXTURE_PATH)

// Pass world directly (not worldRef); only sessions needs ref indirection
// since the sessions Map doesn't exist until createSessionServer runs.
const httpServer = createServer(createRequestHandler({ db, auth, world, sessionsRef }))

const server = createSessionServer({ httpServer, maxUsers: 20, world, db })
sessionsRef.current = server.sessions

httpServer.listen(PORT)

// ---- Test data ----
let userA = { userId: null, cookie: null }
let userB = { userId: null, cookie: null }
const PASSWORD = 'correct horse battery staple'

before(async () => {
  const a = await registerUser('worldcrud-user-a', PASSWORD)
  userA.userId = a.userId
  userA.cookie = a.cookie

  const b = await registerUser('worldcrud-user-b', PASSWORD)
  userB.userId = b.userId
  userB.cookie = b.cookie
})

after(async () => {
  // Restore world reference so session server close doesn't cause issues
  server.close()
  db.close()
  await rm(tempDir, { recursive: true, force: true })
})

// =========================================================================
// Tests: World CRUD happy paths
// =========================================================================

test('POST /api/worlds creates a world with the live world as initial document', async () => {
  const res = await httpPost('/api/worlds', { slug: 'my-world', name: 'My World' }, userA.cookie)

  assert.equal(res.statusCode, 201)
  assert.ok(res.body.id, 'response includes world id')
  assert.equal(res.body.slug, 'my-world')
  assert.equal(res.body.name, 'My World')
  assert.equal(res.body.visibility, 'private')
  assert.ok(res.body.created_at)
  assert.ok(res.body.updated_at)
})

test('GET /api/worlds lists own worlds', async () => {
  const res = await httpGet('/api/worlds', userA.cookie)

  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.body))
  assert.ok(res.body.length >= 1)
  const found = res.body.find(w => w.slug === 'my-world')
  assert.ok(found, 'created world appears in list')
  assert.ok(found.id)
  assert.equal(found.visibility, 'private')
  assert.ok(found.updated_at)
  // List should not include document
  assert.equal(found.document, undefined)
})

test('GET /api/worlds/:id fetches the full glTF document', async () => {
  // Find the world id from list
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  const res = await httpGet(`/api/worlds/${worldId}`, userA.cookie)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json')
  // Body should be a JSON object (serialized glTF), not a string
  assert.ok(typeof res.body === 'object', 'document is valid JSON')
  assert.ok(res.body.nodes || res.body.asset, 'document has glTF structure')
})

test('PUT /api/worlds/:id saves the world and returns metadata', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  const res = await httpPut(`/api/worlds/${worldId}`, { name: 'Updated World' }, userA.cookie)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.slug, 'my-world')
  assert.equal(res.body.name, 'Updated World')
  assert.equal(res.body.visibility, 'private')
  assert.ok(new Date(res.body.updated_at) > new Date(listRes.body[0].updated_at), 'updated_at changed')
})

test('PUT /api/worlds/:id persists server-serialized document', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  // PUT with no body — should still serialize and persist the world
  const putRes = await httpPut(`/api/worlds/${worldId}`, {}, userA.cookie)
  assert.equal(putRes.statusCode, 200)

  // GET the world and check document is a valid glTF with no avatar nodes
  const getRes = await httpGet(`/api/worlds/${worldId}`, userA.cookie)
  assert.equal(getRes.statusCode, 200)
  assert.ok(getRes.body.asset, 'document has glTF asset field')

  // There should be no node named after an avatar pattern
  // (the fixture has no avatar nodes, so this is just sanity checking)
  if (getRes.body.nodes) {
    const hasAvatarNode = getRes.body.nodes.some(n =>
      n.name && (n.name.startsWith('User-') || n.name.startsWith('avatar-'))
    )
    assert.equal(hasAvatarNode, false, 'no avatar nodes in saved document')
  }
})

test('DELETE /api/worlds/:id deletes the world', async () => {
  // Create a world to delete
  const createRes = await httpPost('/api/worlds', { slug: 'to-delete' }, userA.cookie)
  assert.equal(createRes.statusCode, 201)
  const worldId = createRes.body.id

  const delRes = await httpDelete(`/api/worlds/${worldId}`, userA.cookie)
  assert.equal(delRes.statusCode, 200)
  assert.equal(delRes.body.message, 'World deleted')

  // Confirm it's gone
  const getRes = await httpGet(`/api/worlds/${worldId}`, userA.cookie)
  assert.equal(getRes.statusCode, 404)
})

test('POST /api/worlds handles duplicate slug with 409', async () => {
  const res = await httpPost('/api/worlds', { slug: 'my-world' }, userA.cookie)
  assert.equal(res.statusCode, 409)
  assert.ok(res.body.error.toLowerCase().includes('already exists'))
})

// =========================================================================
// Tests: Cross-user access (user B tries to access user A's world)
// =========================================================================

test('Cross-user: user B cannot GET user A world (404)', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  const res = await httpGet(`/api/worlds/${worldId}`, userB.cookie)
  assert.equal(res.statusCode, 404)
})

test('Cross-user: user B cannot PUT user A world (404)', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  const res = await httpPut(`/api/worlds/${worldId}`, { name: 'Hacked' }, userB.cookie)
  assert.equal(res.statusCode, 404)
})

test('Cross-user: user B cannot DELETE user A world (404)', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  const res = await httpDelete(`/api/worlds/${worldId}`, userB.cookie)
  assert.equal(res.statusCode, 404)

  // Confirm user A's world still exists
  const getRes = await httpGet(`/api/worlds/${worldId}`, userA.cookie)
  assert.equal(getRes.statusCode, 200)
})

test('Anonymous: no cookie gets 401 on world routes', async () => {
  // GET /api/worlds
  const listRes = await httpGet('/api/worlds')
  assert.equal(listRes.statusCode, 401)

  // POST /api/worlds
  const createRes = await httpPost('/api/worlds', { slug: 'anon-world' })
  assert.equal(createRes.statusCode, 401)

  // GET /api/worlds/:id
  const getRes = await httpGet('/api/worlds/some-id')
  assert.equal(getRes.statusCode, 401)

  // PUT /api/worlds/:id
  const putRes = await httpPut('/api/worlds/some-id', {})
  assert.equal(putRes.statusCode, 401)

  // DELETE /api/worlds/:id
  const delRes = await httpDelete('/api/worlds/some-id')
  assert.equal(delRes.statusCode, 401)
})

test('Cross-user: after delete attempt, user A world is byte-for-byte unchanged', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  // Get the world before
  const beforeRes = await httpGet(`/api/worlds/${worldId}`, userA.cookie)
  const beforeDoc = JSON.stringify(beforeRes.body)

  // User B tries PUT with a fake name
  const putRes = await httpPut(`/api/worlds/${worldId}`, { name: 'HACKED BY B' }, userB.cookie)
  assert.equal(putRes.statusCode, 404)

  // Verify unchanged
  const afterRes = await httpGet(`/api/worlds/${worldId}`, userA.cookie)
  const afterDoc = JSON.stringify(afterRes.body)
  assert.equal(afterDoc, beforeDoc, 'world document unchanged after unauthorized PUT attempt')
})

// =========================================================================
// Tests: Server-authoritative values (client spoofing)
// =========================================================================

// =========================================================================
// Tests: visibility toggle (Phase 2 Step 4)
// =========================================================================

test('PUT with visibility:public toggles world to public', async () => {
  // Create a private world
  const createRes = await httpPost('/api/worlds', { slug: 'toggle-to-public' }, userA.cookie)
  assert.equal(createRes.statusCode, 201)
  assert.equal(createRes.body.visibility, 'private')
  const worldId = createRes.body.id

  // Toggle to public
  const putRes = await httpPut(`/api/worlds/${worldId}`, { visibility: 'public' }, userA.cookie)
  assert.equal(putRes.statusCode, 200)
  assert.equal(putRes.body.visibility, 'public')

  // Verify via list
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const found = listRes.body.find(w => w.id === worldId)
  assert.equal(found.visibility, 'public')
})

test('PUT with visibility:private reverts a public world to private', async () => {
  // Create world, toggle public, then revert
  const createRes = await httpPost('/api/worlds', { slug: 'revert-to-private' }, userA.cookie)
  assert.equal(createRes.statusCode, 201)
  const worldId = createRes.body.id

  // Set to public
  const pubRes = await httpPut(`/api/worlds/${worldId}`, { visibility: 'public' }, userA.cookie)
  assert.equal(pubRes.statusCode, 200)
  assert.equal(pubRes.body.visibility, 'public')

  // Revert to private
  const privRes = await httpPut(`/api/worlds/${worldId}`, { visibility: 'private' }, userA.cookie)
  assert.equal(privRes.statusCode, 200)
  assert.equal(privRes.body.visibility, 'private')
})

test('PUT with invalid visibility value returns 400', async () => {
  const createRes = await httpPost('/api/worlds', { slug: 'invalid-vis-test' }, userA.cookie)
  assert.equal(createRes.statusCode, 201)
  const worldId = createRes.body.id

  // Invalid value
  const res = await httpPut(`/api/worlds/${worldId}`, { visibility: 'invalid' }, userA.cookie)
  assert.equal(res.statusCode, 400)
  assert.ok(res.body.error.toLowerCase().includes('invalid visibility'))
})

test('visibility spoofing: client sends visibility:public but stored as private on create', async () => {
  const res = await httpPost('/api/worlds', {
    slug: 'visibility-spoof-test',
    visibility: 'public',
  }, userA.cookie)

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.visibility, 'private')

  // Also verify via GET that it's stored as private
  const getRes = await httpGet(`/api/worlds/${res.body.id}`, userA.cookie)
  assert.equal(getRes.statusCode, 200)
  // visibility is in list metadata but not in the full document; check via list
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const found = listRes.body.find(w => w.id === res.body.id)
  assert.equal(found.visibility, 'private')
})

test('visibility CHECK constraint now allows public values', async () => {
  // Migration 4 relaxed the CHECK, so inserting 'public' should succeed
  const id = 'visibility-check-public-test-id'
  const now = new Date().toISOString()
  const result = db.database.prepare(
    `INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userA.userId, 'public-vis-test', '', '', 'public', now, now)

  assert.equal(result.changes, 1, 'INSERT with visibility=public succeeded (migration 4 relaxed CHECK)')

  // Clean up
  db.database.prepare('DELETE FROM worlds WHERE id = ?').run(id)
})

test('id spoofing: client sends id in create body but server assigns its own', async () => {
  const res = await httpPost('/api/worlds', {
    slug: 'id-spoof-test',
    id: 'fake-id-12345',
  }, userA.cookie)

  assert.equal(res.statusCode, 201)
  // The world-store directly generates its own UUID and ignores body.id
  assert.ok(res.body.id, 'server assigned an id')
  assert.notEqual(res.body.id, 'fake-id-12345', 'server ignored client-supplied id')

  // Verify via list that the world was stored with server-assigned id
  const listRes = await httpGet('/api/worlds', userA.cookie)
  assert.equal(listRes.statusCode, 200)
  const found = listRes.body.find(w => w.id === res.body.id)
  assert.ok(found, 'world appears in list under server-assigned id')
  assert.notEqual(found.id, 'fake-id-12345', 'server-assigned id persisted, not spoofed')
})

test('document spoofing: PUT with document in body uses server-serialized document', async () => {
  const createRes = await httpPost('/api/worlds', { slug: 'doc-spoof-test' }, userA.cookie)
  assert.equal(createRes.statusCode, 201)
  const worldId = createRes.body.id

  // PUT with a client-supplied document — should be ignored
  const fakeDoc = { asset: { version: '2.0', generator: 'hacker' }, nodes: [{ name: 'evil-node' }] }
  const putRes = await httpPut(`/api/worlds/${worldId}`, { document: JSON.stringify(fakeDoc) }, userA.cookie)
  assert.equal(putRes.statusCode, 200)

  // Verify the stored document is the server-serialized one (has real glTF asset)
  const getRes = await httpGet(`/api/worlds/${worldId}`, userA.cookie)
  assert.notEqual(JSON.stringify(getRes.body), JSON.stringify(fakeDoc), 'client document was NOT stored')
  assert.ok(getRes.body.asset, 'stored document has real glTF asset')
  // The fake node should not appear
  if (getRes.body.nodes) {
    const hasEvil = getRes.body.nodes.some(n => n.name === 'evil-node')
    assert.equal(hasEvil, false, 'client-supplied node was not saved')
  }
})

test('owner_user_id spoofing: body cannot set ownership', async () => {
  const res = await httpPost('/api/worlds', {
    slug: 'owner-spoof-test',
    owner_user_id: userB.userId,
  }, userA.cookie)

  assert.equal(res.statusCode, 201)

  // The world should be owned by userA (from cookie), not userB
  // Verify by trying to access as userB — should get 404
  const getRes = await httpGet(`/api/worlds/${res.body.id}`, userB.cookie)
  assert.equal(getRes.statusCode, 404)

  // Verify userA can access it
  const getResA = await httpGet(`/api/worlds/${res.body.id}`, userA.cookie)
  assert.equal(getResA.statusCode, 200)
})

// =========================================================================
// Tests: CSRF origin validation on world routes
// =========================================================================

test('POST /api/worlds with cross-origin header is rejected (403)', async () => {
  const data = JSON.stringify({ slug: 'cross-origin-world' })
  const res = await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/worlds',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Cookie': userA.cookie,
          'Origin': 'https://evil.com',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }) }
          catch { resolve({ statusCode: res.statusCode, body }) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })

  assert.equal(res.statusCode, 403)
})

test('PUT /api/worlds/:id with cross-origin header is rejected (403)', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  const data = JSON.stringify({ name: 'Cross-origin update' })
  const res = await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/worlds/${worldId}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Cookie': userA.cookie,
          'Origin': 'https://evil.com',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }) }
          catch { resolve({ statusCode: res.statusCode, body }) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })

  assert.equal(res.statusCode, 403)
})

test('DELETE /api/worlds/:id with cross-origin header is rejected (403)', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  const res = await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/worlds/${worldId}`,
        method: 'DELETE',
        headers: {
          'Cookie': userA.cookie,
          'Origin': 'https://evil.com',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }) }
          catch { resolve({ statusCode: res.statusCode, body }) }
        })
      }
    )
    req.on('error', reject)
    req.write('')
    req.end()
  })

  assert.equal(res.statusCode, 403)
})

test('GET /api/worlds is exempt from origin validation', async () => {
  const res = await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/worlds',
        method: 'GET',
        headers: {
          'Cookie': userA.cookie,
          'Origin': 'https://evil.com',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }) }
          catch { resolve({ statusCode: res.statusCode, body }) }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })

  // GET is read-only, should NOT be blocked by origin check
  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.body))
})

test('GET /api/worlds/:id is exempt from origin validation', async () => {
  const listRes = await httpGet('/api/worlds', userA.cookie)
  const worldId = listRes.body.find(w => w.slug === 'my-world').id

  const res = await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/worlds/${worldId}`,
        method: 'GET',
        headers: {
          'Cookie': userA.cookie,
          'Origin': 'https://evil.com',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }) }
          catch { resolve({ statusCode: res.statusCode, body }) }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })

  assert.equal(res.statusCode, 200)
})

// =========================================================================
// Tests: Avatar exclusion via live WebSocket session (live verification)
// =========================================================================

test('PUT save excludes avatar nodes from live WS sessions', async () => {
  // Create a world to save into
  const createRes = await httpPost('/api/worlds', { slug: 'avatar-exclusion-test' }, userA.cookie)
  assert.equal(createRes.statusCode, 201)
  const worldId = createRes.body.id

  // Connect a real WebSocket client with auth cookie and complete hello
  const ws = new WebSocket(`ws://localhost:${PORT}`, { headers: { Cookie: userA.cookie } })
  const q = makeMessageQueue(ws)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  // Send hello
  ws.send(JSON.stringify({ type: 'hello', id: 'exclusion-test-session' }))

  // Wait for hello response to get the assigned avatarNodeName
  const helloMsg = await q.waitForType('hello', 1000)
  assert.ok(helloMsg, 'received hello response')
  assert.ok(helloMsg.avatarNodeName, 'hello response includes avatarNodeName')

  const avatarNodeName = helloMsg.avatarNodeName

  // Wait for som-dump (world data) — indicates server is ready
  const somDump = await q.waitForType('som-dump', 1000)
  assert.ok(somDump, 'received som-dump')

  // Send add with the assigned avatar node name (no geometry needed for exclusion test)
  ws.send(JSON.stringify({
    type: 'add',
    id: 'exclusion-test-session',
    node: { name: avatarNodeName },
  }))

  // Wait for the server to process the add
  await new Promise(r => setTimeout(r, 200))

  // Now save the world via PUT — should exclude the avatar.
  // The save handler reads live session avatarNodeName values via
  // sessionsRef.current and passes them as excludeNodes to serialize().
  const putRes = await httpPut(`/api/worlds/${worldId}`, {}, userA.cookie)
  assert.equal(putRes.statusCode, 200)

  // GET the saved document and confirm no avatar node
  const getRes = await httpGet(`/api/worlds/${worldId}`, userA.cookie)
  assert.equal(getRes.statusCode, 200)

  if (getRes.body.nodes) {
    const hasSavedAvatar = getRes.body.nodes.some(n => n.name === avatarNodeName)
    assert.equal(hasSavedAvatar, false,
      `avatar node "${avatarNodeName}" was excluded from saved document`)
  }

  // Clean up
  ws.close()
  await new Promise(r => setTimeout(r, 50))
})

test('PUT save excludes all connected avatar nodes', async () => {
  // Create world
  const createRes = await httpPost('/api/worlds', { slug: 'multi-avatar-exclusion' }, userA.cookie)
  assert.equal(createRes.statusCode, 201)
  const worldId = createRes.body.id

  // Connect client A
  const wsA = new WebSocket(`ws://localhost:${PORT}`, { headers: { Cookie: userA.cookie } })
  const qA = makeMessageQueue(wsA)
  await new Promise((resolve, reject) => { wsA.once('open', resolve); wsA.once('error', reject) })
  wsA.send(JSON.stringify({ type: 'hello', id: 'multi-avatar-a' }))
  const helloA = await qA.waitForType('hello', 1000)
  assert.ok(helloA)
  await qA.waitForType('som-dump', 1000)
  wsA.send(JSON.stringify({ type: 'add', id: 'multi-avatar-a', node: { name: helloA.avatarNodeName } }))

  // Connect client B (user B)
  const wsB = new WebSocket(`ws://localhost:${PORT}`, { headers: { Cookie: userB.cookie } })
  const qB = makeMessageQueue(wsB)
  await new Promise((resolve, reject) => { wsB.once('open', resolve); wsB.once('error', reject) })
  wsB.send(JSON.stringify({ type: 'hello', id: 'multi-avatar-b' }))
  const helloB = await qB.waitForType('hello', 1000)
  assert.ok(helloB)
  await qB.waitForType('som-dump', 1000)
  wsB.send(JSON.stringify({ type: 'add', id: 'multi-avatar-b', node: { name: helloB.avatarNodeName } }))

  // Wait for processing
  await new Promise(r => setTimeout(r, 200))

  // Save and check neither avatar appears
  const putRes = await httpPut(`/api/worlds/${worldId}`, {}, userA.cookie)
  assert.equal(putRes.statusCode, 200)

  const getRes = await httpGet(`/api/worlds/${worldId}`, userA.cookie)
  if (getRes.body.nodes) {
    const hasA = getRes.body.nodes.some(n => n.name === helloA.avatarNodeName)
    const hasB = getRes.body.nodes.some(n => n.name === helloB.avatarNodeName)
    assert.equal(hasA, false, `avatar A "${helloA.avatarNodeName}" excluded`)
    assert.equal(hasB, false, `avatar B "${helloB.avatarNodeName}" excluded`)
  }

  wsA.close()
  wsB.close()
  await new Promise(r => setTimeout(r, 50))
})

// =========================================================================
// Tests: Extras-based avatar claims are ignored (exclusion is session-tracked)
// =========================================================================

test('node with avatar-like extras is saved normally (not treated as avatar)', async () => {
  const createRes = await httpPost('/api/worlds', { slug: 'extras-avatar-test' }, userA.cookie)
  assert.equal(createRes.statusCode, 201)
  const worldId = createRes.body.id

  // Add a node with avatar-like extras but NO live WS session claiming it.
  // With the D4 fix, PUT to a world that has NO live host skips document
  // serialization entirely. To test avatar exclusion, we need to PUT to a
  // world that IS live. The default world is always live, but doesn't have
  // a DB row — so instead we operate on the live default world's content
  // and verify the avatar-like node survives serialization when no session
  // claims it.
  const avatarNameResult = world.addNode({
    name: 'User-fake',
    extras: { isAvatar: true, displayName: 'Fake Avatar' },
  })
  assert.ok(avatarNameResult.ok, 'avatar-like-named node added to live world')

  const extrasResult = world.addNode({
    name: 'ExtrasAvatar',
    extras: { isAvatar: true, role: 'avatar' },
  })
  assert.ok(extrasResult.ok, 'extras-marked node added to live world')

  // Serialize the live default world directly — verify exclusion is session-driven.
  // No sessions exist for the default world in this test, so both nodes survive.
  const json = JSON.stringify(await world.serialize())
  const parsed = JSON.parse(json)

  if (parsed.nodes) {
    const hasFakeAvatar = parsed.nodes.some(n => n.name === 'User-fake')
    assert.equal(hasFakeAvatar, true,
      'node named like avatar but with no live session IS saved (exclusion is session-driven)')

    const hasExtrasAvatar = parsed.nodes.some(n => n.name === 'ExtrasAvatar')
    assert.equal(hasExtrasAvatar, true,
      'node with avatar extras but no live session IS saved (exclusion is session-driven)')
  }
})

// =========================================================================
// Tests: Honeypot
// =========================================================================

test('honeypot: website field populated returns 200 but no user created', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'honeypot-bot',
    password: 'a valid password yes indeed',
    website: 'http://spam.bot/',
  })

  assert.equal(res.statusCode, 200)
  assert.ok(res.body.id)
  // id should be a well-formed UUID (randomized per call for anti-fingerprinting)
  assert.match(res.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'honeypot id is a valid UUID, not a constant sentinel')
  assert.notEqual(res.body.id, '00000000-0000-0000-0000-000000000000',
    'honeypot id is not the old sentinel')

  // Verify no user was actually created by trying to login
  const loginRes = await httpPost('/api/auth/login', {
    username: 'honeypot-bot',
    password: 'a valid password yes indeed',
  })
  assert.equal(loginRes.statusCode, 401)
})

test('honeypot: empty website field does not trigger honeypot', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'honeypot-innocent',
    password: 'a valid password yes indeed',
    website: '',
  })

  // Should succeed normally
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.username, 'honeypot-innocent')

  // Verify login works
  const loginRes = await httpPost('/api/auth/login', {
    username: 'honeypot-innocent',
    password: 'a valid password yes indeed',
  })
  assert.equal(loginRes.statusCode, 200)
})

test('honeypot: website field absent does not trigger honeypot', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'honeypot-no-field',
    password: 'a valid password yes indeed',
  })

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.username, 'honeypot-no-field')
})

// =========================================================================
// Tests: Session sweep (pruneExpiredAuthSessions)
// =========================================================================

test('pruneExpiredAuthSessions removes expired rows', async () => {
  // Insert a session that's already expired
  const expiredId = 'expired-session-test-id'
  const userId = userA.userId
  db.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(expiredId, userId, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')

  // Verify it exists
  const before = db.database.prepare('SELECT id FROM auth_sessions WHERE id = ?').get(expiredId)
  assert.ok(before, 'expired session exists')

  // Prune
  db.pruneExpiredAuthSessions()

  // Verify it's gone
  const after = db.database.prepare('SELECT id FROM auth_sessions WHERE id = ?').get(expiredId)
  assert.equal(after, undefined, 'expired session was pruned')
})

test('pruneExpiredAuthSessions does not remove valid sessions', async () => {
  // Insert a session that expires far in the future
  const validId = 'valid-session-test-id'
  const userId = userA.userId
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  db.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(validId, userId, new Date().toISOString(), farFuture)

  // Prune
  db.pruneExpiredAuthSessions()

  // Verify it still exists
  const after = db.database.prepare('SELECT id FROM auth_sessions WHERE id = ?').get(validId)
  assert.ok(after, 'valid session was not pruned')
  })

// =========================================================================
// Registry-based WS admission tests — public path and /ws admission matrix
// =========================================================================
// These tests spin up a separate HTTP server with the full WorldRegistry
// to test WebSocket upgrade routing for /public/<username>/<slug> and
// /ws/<worldRowId> paths with visibility-aware admission.

import { createWorldRegistry } from '../src/world-registry.js'
import { createWorldHost } from '../src/world-host.js'

const WS_ADM_PORT = 3020
const WS_ADM_BASE = `http://localhost:${WS_ADM_PORT}`

describe('WS admission via world registry', () => {
  let regDb
  let regHttpServer
  let registry
  let regUserA
  let regUserB

  before(async () => {
    // Create a fresh database so we control the exact world rows
    const regDir = mkdtempSync(join(tmpdir(), 'atrium-ws-adm-test-'))
    const regDbPath = join(regDir, 'test.db')
    regDb = createDb(regDbPath)

    // Create the HTTP server and registry
    regHttpServer = createServer()
    registry = createWorldRegistry({ httpServer: regHttpServer, db: regDb })

    // Register a default world so the server is alive
    const defaultWorld = await createWorld(FIXTURE_PATH)
    const host = createWorldHost({
      id: 'default',
      world: defaultWorld,
      db: regDb,
      onSessionRemoved: () => {},
    })
    registry.hosts.set('default', host)

    // Create a minimal request handler for auth routes
    const handler = createRequestHandler({ db: regDb, auth, world: defaultWorld })
    regHttpServer.on('request', handler)

    regHttpServer.listen(WS_ADM_PORT)

    // Register test users via direct DB insert (avoids HTTP dependency loop)
    const now = new Date().toISOString()
    regUserA = { id: 'ws-adm-user-a-uuid', username: 'AliceWs', cookie: null }
    regUserB = { id: 'ws-adm-user-b-uuid', username: 'BobWs', cookie: null }

    regDb.database.prepare(
      'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
    ).run(regUserA.id, regUserA.username, regUserA.username, now)

    regDb.database.prepare(
      'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
    ).run(regUserB.id, regUserB.username, regUserB.username, now)

    // Create auth sessions for both users
    const sessionA = 'ws-adm-session-a'
    const sessionB = 'ws-adm-session-b'
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    regDb.database.prepare(
      'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(sessionA, regUserA.id, now, farFuture)
    regDb.database.prepare(
      'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(sessionB, regUserB.id, now, farFuture)

    regUserA.cookie = `atrium_auth_session=${sessionA}`
    regUserB.cookie = `atrium_auth_session=${sessionB}`

    // Create worlds for Alice
    // 1. Public world
    regDb.database.prepare(
      `INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('ws-adm-public-world', regUserA.id, 'my-public-space', 'Public Space', '', 'public', now, now)

    // 2. Private world
    regDb.database.prepare(
      `INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('ws-adm-private-world', regUserA.id, 'my-private-space', 'Private Space', '', 'private', now, now)
  })

  after(async () => {
    registry.close()
    regHttpServer.close()
    regDb.close()
  })

  // ---------------------------------------------------------------------------
  // Helper: perform WebSocket upgrade and return status code
  // ---------------------------------------------------------------------------
  function checkUpgrade(pathname, cookie) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        'Host': `localhost:${WS_ADM_PORT}`,
      }
      if (cookie) headers['Cookie'] = cookie
      const req = request({
        hostname: 'localhost',
        port: WS_ADM_PORT,
        path: pathname,
        method: 'GET',
        headers,
      })
      req.on('upgrade', (res) => {
        resolve({ statusCode: 101 })
        res.destroy()
      })
      req.on('response', (res) => {
        let body = ''
        res.on('data', c => { body += c })
        res.on('end', () => resolve({ statusCode: res.statusCode, body }))
      })
      req.on('error', reject)
      req.end()
    })
  }

  // ===================================================================
  // Public world: /public/<username>/<slug>
  // ===================================================================

  test('/public/AliceWs/my-public-space — anonymous can connect (public world)', async () => {
    const result = await checkUpgrade('/public/AliceWs/my-public-space')
    assert.equal(result.statusCode, 101, 'anonymous can upgrade to public world')
  })

  test('/public/AliceWs/my-public-space — non-owner (Bob) can connect (public world)', async () => {
    const result = await checkUpgrade('/public/AliceWs/my-public-space', regUserB.cookie)
    assert.equal(result.statusCode, 101, 'non-owner can upgrade to public world')
  })

  test('/public/AliceWs/my-public-space — owner (Alice) can connect (public world)', async () => {
    const result = await checkUpgrade('/public/AliceWs/my-public-space', regUserA.cookie)
    assert.equal(result.statusCode, 101, 'owner can upgrade to public world')
  })

  // ===================================================================
  // Private world: /public/<username>/<slug>
  // ===================================================================

  test('/public/AliceWs/my-private-space — anonymous gets 404 (private world)', async () => {
    const result = await checkUpgrade('/public/AliceWs/my-private-space')
    assert.equal(result.statusCode, 404, 'anonymous rejected from private world')
  })

  test('/public/AliceWs/my-private-space — non-owner (Bob) gets 404 (private world)', async () => {
    const result = await checkUpgrade('/public/AliceWs/my-private-space', regUserB.cookie)
    assert.equal(result.statusCode, 404, 'non-owner rejected from private world')
  })

  test('/public/AliceWs/my-private-space — owner (Alice) can connect (private world)', async () => {
    const result = await checkUpgrade('/public/AliceWs/my-private-space', regUserA.cookie)
    assert.equal(result.statusCode, 101, 'owner can upgrade to own private world')
  })

  // ===================================================================
  // Unknown user / slug
  // ===================================================================

  test('/public/UnknownUser/my-space returns 404', async () => {
    const result = await checkUpgrade('/public/UnknownUser/my-space')
    assert.equal(result.statusCode, 404, 'unknown username returns 404')
  })

  test('/public/AliceWs/non-existent-slug returns 404', async () => {
    const result = await checkUpgrade('/public/AliceWs/non-existent-slug')
    assert.equal(result.statusCode, 404, 'unknown slug returns 404')
  })

  // ===================================================================
  // Case-insensitive username
  // ===================================================================

  test('/public/alicews/my-public-space — case-insensitive username resolves', async () => {
    const result = await checkUpgrade('/public/alicews/my-public-space')
    assert.equal(result.statusCode, 101, 'lowercase username resolves via COLLATE NOCASE')
  })

  test('/public/ALICEWS/my-public-space — uppercase username resolves', async () => {
    const result = await checkUpgrade('/public/ALICEWS/my-public-space')
    assert.equal(result.statusCode, 101, 'uppercase username resolves via COLLATE NOCASE')
  })

  // ===================================================================
  // /ws/<worldRowId> backdoor
  // ===================================================================

  test('/ws/ws-adm-public-world — non-owner can connect (public world via /ws backdoor)', async () => {
    const result = await checkUpgrade('/ws/ws-adm-public-world', regUserB.cookie)
    assert.equal(result.statusCode, 101, 'non-owner can reach public world via /ws')
  })

  test('/ws/ws-adm-public-world — anonymous can connect (public world via /ws backdoor)', async () => {
    const result = await checkUpgrade('/ws/ws-adm-public-world')
    assert.equal(result.statusCode, 101, 'anonymous can reach public world via /ws')
  })

  test('/ws/ws-adm-public-world — owner can connect (public world via /ws backdoor)', async () => {
    const result = await checkUpgrade('/ws/ws-adm-public-world', regUserA.cookie)
    assert.equal(result.statusCode, 101, 'owner can reach own public world via /ws')
  })

  test('/ws/ws-adm-private-world — non-owner gets 404 (private world /ws backdoor fail-closed)', async () => {
    const result = await checkUpgrade('/ws/ws-adm-private-world', regUserB.cookie)
    assert.equal(result.statusCode, 404, 'non-owner rejected from private world via /ws')
  })

  test('/ws/ws-adm-private-world — anonymous gets 404 (private world /ws backdoor fail-closed)', async () => {
    const result = await checkUpgrade('/ws/ws-adm-private-world')
    assert.equal(result.statusCode, 404, 'anonymous rejected from private world via /ws')
  })

  test('/ws/ws-adm-private-world — owner can connect (private world via /ws backdoor)', async () => {
    const result = await checkUpgrade('/ws/ws-adm-private-world', regUserA.cookie)
    assert.equal(result.statusCode, 101, 'owner can reach own private world via /ws')
  })

  test('/ws/non-existent-world-id returns 404', async () => {
    const result = await checkUpgrade('/ws/non-existent-world-id')
    assert.equal(result.statusCode, 404, 'non-existent /ws/<id> returns 404')
  })

  // ===================================================================
  // End-to-end WS upgrade flow for /public/<username>/<slug>
  // ===================================================================

  test('E2E: full WS connect via /public/AliceWs/my-public-space with hello/som-dump', async () => {
    const ws = new WebSocket(`ws://localhost:${WS_ADM_PORT}/public/AliceWs/my-public-space`)
    const q = makeMessageQueue(ws)
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })

    // Send hello
    ws.send(JSON.stringify({ type: 'hello', id: 'ws-adm-e2e-session' }))

    // Should receive hello response and som-dump
    const helloMsg = await q.waitForType('hello', 1000)
    assert.ok(helloMsg, 'received hello response on public path')

    const somDump = await q.waitForType('som-dump', 1000)
    assert.ok(somDump, 'received som-dump on public path')

    ws.close()
  })
})