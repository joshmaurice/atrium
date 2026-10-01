// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// world-visibility.test.js — adversarial tests for world visibility and
// admission refusal paths (Phase 2 Step 9 revision round 1).

import { test, before, after } from 'node:test'
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
import { setupCommons } from '../src/commons.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------
const PORT_REFUSAL = 3050
const PORT_PUT = 3051
const PORT_NO_ROOT = 3052

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessageQueue(ws) {
  const queue = []
  ws.on('message', (raw) => {
    try { queue.push(JSON.parse(raw)) } catch {}
  })
  async function waitForType(type, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const idx = queue.findIndex(m => m.type === type)
      if (idx >= 0) return queue.splice(idx, 1)[0]
      if (Date.now() >= deadline) return null
      await new Promise(r => setTimeout(r, 10))
    }
  }
  return { queue, waitForType }
}

async function wsOpen(port, path, cookie) {
  const headers = cookie ? { Cookie: cookie } : {}
  const ws = new WebSocket(`ws://localhost:${port}${path}`, { headers })
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  return ws
}

function sendHello(ws, id) {
  ws.send(JSON.stringify({
    type: 'hello',
    id: id || 'test-session',
    capabilities: { tick: { interval: 5000 } },
  }))
}

function httpGet(port, path, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {}
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port, path, method: 'GET', headers },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(body || '{}') }) }
          catch { resolve({ statusCode: res.statusCode, body }) }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

function httpPost(port, path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port, path, method: 'POST', headers },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body || '{}') }) }
          catch { resolve({ statusCode: res.statusCode, headers: res.headers, body }) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function httpPut(port, path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port, path, method: 'PUT', headers },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(body || '{}') }) }
          catch { resolve({ statusCode: res.statusCode, body }) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function registerUser(port, username, password) {
  const res = await httpPost(port, '/api/auth/register', { username, password })
  if (res.statusCode !== 201) throw new Error(`Register failed: ${res.statusCode} ${JSON.stringify(res.body)}`)
  const setCookie = Array.isArray(res.headers['set-cookie'])
    ? res.headers['set-cookie'].join('; ')
    : res.headers['set-cookie']
  return { userId: res.body.id, cookie: setCookie }
}

// ---------------------------------------------------------------------------
// Server 1: Refusal tests (3a, 3b, 3d)
// ---------------------------------------------------------------------------

let db, httpRefusal, registry, handlerRefusal
let ownerUserId, privateWorldId
let tempDir

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'atrium-wv-test-'))
  const dbPath = join(tempDir, 'test.db')
  db = createDb(dbPath)

  const now = new Date().toISOString()

  ownerUserId = 'wv-owner-uuid'
  db.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(ownerUserId, 'WorldOwner', 'World Owner', now)

  process.env.ATRIUM_COMMONS_OWNER = 'WorldOwner'
  process.env.ATRIUM_COMMONS_SLUG = 'commons'

  httpRefusal = createServer()
  registry = createWorldRegistry({ httpServer: httpRefusal, db })

  const dummyHostRef = { current: null }
  const result = await setupCommons({ registry, db, worldPath: FIXTURE_PATH })
  dummyHostRef.current = result.host

  privateWorldId = 'wv-private-id'
  db.database.prepare(
    `INSERT INTO worlds (id, owner_user_id, slug, name, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(privateWorldId, ownerUserId, 'private-world', 'Private', 'private', now, now)

  handlerRefusal = createRequestHandler({
    db, auth,
    defaultHostRef: dummyHostRef,
    getWorldHost: (id) => registry.getWorldHost(id),
    getRootWorldId: () => registry.getRootWorldId(),
  })
  httpRefusal.on('request', handlerRefusal)
  httpRefusal.listen(PORT_REFUSAL)
})

after(async () => {
  registry?.close()
  if (httpRefusal) httpRefusal.close()
  if (db) db.close()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

// ===========================================================================
// 3a: Byte-identical refusals
// ===========================================================================

const REFUSAL_PATHS = [
  { path: '/worlds/UnknownNobody/foo', label: 'unknown user' },
  { path: '/worlds/WorldOwner/unknown-slug', label: 'unknown slug' },
  { path: '/worlds/WorldOwner/private-world', label: 'private world × anonymous' },
  { path: '/ws/nonexistent-world-id-12345', label: '/ws/<id> unknown' },
  { path: '/this/is/garbage', label: 'unresolvable path' },
]

test('3a: byte-identical refusals', async () => {
  const firstMessages = []
  const closeCodes = []
  const closeReasons = []

  for (const { path } of REFUSAL_PATHS) {
    const ws = new WebSocket(`ws://localhost:${PORT_REFUSAL}${path}`)
    const closePromise = new Promise((resolve) => {
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    })
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const q = makeMessageQueue(ws)
    const firstMsg = await q.waitForType('error', 2000)
    firstMessages.push(firstMsg)
    const closeInfo = await closePromise
    closeCodes.push(closeInfo?.code)
    closeReasons.push(closeInfo?.reason)
  }

  for (let i = 1; i < firstMessages.length; i++) {
    assert.deepEqual(firstMessages[i], firstMessages[0],
      `refusal mismatch: ${REFUSAL_PATHS[0].label} vs ${REFUSAL_PATHS[i].label}`)
  }
  for (let i = 0; i < closeCodes.length; i++) {
    assert.equal(closeCodes[i], 1008, `close code for ${REFUSAL_PATHS[i].label}: ${closeCodes[i]}`)
  }
  for (let i = 0; i < closeReasons.length; i++) {
    assert.equal(closeReasons[i], '', `close reason for ${REFUSAL_PATHS[i].label}: "${closeReasons[i]}"`)
  }
})

test('3a: /ws/<id> private world refuses non-owner', async () => {
  // No host exists for privateWorldId, so /ws/<id> → sendRefusal
  // Attach message listener before the open event resolves
  const ws = new WebSocket(`ws://localhost:${PORT_REFUSAL}/ws/${privateWorldId}`)
  const q = makeMessageQueue(ws)
  await new Promise((resolve) => { ws.once('open', resolve); ws.once('error', resolve) })
  const msg = await q.waitForType('error', 4000)
  assert.ok(msg !== null, '/ws/<id> private world should get error, got null')
  assert.equal(msg.code, 'WORLD_UNAVAILABLE')
  ws.close()
})

// ===========================================================================
// 3b: Refusal socket is not a session
// ===========================================================================

test('3b: refusal socket receives no hello reply', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT_REFUSAL}/worlds/WorldOwner/private-world`)
  await new Promise((resolve) => { ws.once('open', resolve); ws.once('error', resolve) })
  const q = makeMessageQueue(ws)
  sendHello(ws, 'refusal-hello-test')
  const reply = await q.waitForType('hello', 2000)
  assert.equal(reply, null, 'refusal socket should not receive hello reply')
  ws.close()
})

// ===========================================================================
// 3d: Server failure paths get HTTP status
// ===========================================================================

test('3d: unresolvable path gets HTTP 404 before WebSocket upgrade', async () => {
  const res = await new Promise((resolve, reject) => {
    const req = request(
      { hostname: 'localhost', port: PORT_REFUSAL, path: '/this-is-garbage', method: 'GET' },
      (incoming) => {
        let body = ''
        incoming.on('data', (c) => { body += c })
        incoming.on('end', () => resolve({ statusCode: incoming.statusCode, body }))
      }
    )
    req.on('error', reject)
    req.end()
  })
  assert.equal(res.statusCode, 404)
})

// ===========================================================================
// 3c, 3e: PUT + eviction + isCommons
// ===========================================================================

let putDb, putHttp, putRegistry, putHandler
let putOwnerUserId, putOwnerCookie
let putOtherUserId, putOtherCookie
let putWorldId
let putTempDir

before(async () => {
  putTempDir = mkdtempSync(join(tmpdir(), 'atrium-wv-put-test-'))
  const dbPath = join(putTempDir, 'test.db')
  putDb = createDb(dbPath)

  const now = new Date().toISOString()
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

  putOwnerUserId = 'put-owner-uuid'
  putOtherUserId = 'put-other-uuid'
  putDb.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(putOwnerUserId, 'PutOwner', 'Put Owner', now)
  putDb.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(putOtherUserId, 'PutOther', 'Put Other', now)

  const ownerSess = 'put-owner-session'
  const otherSess = 'put-other-session'
  putDb.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(ownerSess, putOwnerUserId, now, farFuture)
  putDb.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(otherSess, putOtherUserId, now, farFuture)
  putOwnerCookie = `atrium_auth_session=${ownerSess}`
  putOtherCookie = `atrium_auth_session=${otherSess}`

  process.env.ATRIUM_COMMONS_OWNER = 'PutOwner'
  process.env.ATRIUM_COMMONS_SLUG = 'commons'

  putHttp = createServer()
  putRegistry = createWorldRegistry({ httpServer: putHttp, db: putDb })

  const dummyHostRef = { current: null }
  const commonsResult = await setupCommons({ registry: putRegistry, db: putDb, worldPath: FIXTURE_PATH })
  dummyHostRef.current = commonsResult.host

  putWorldId = 'put-visibility-world-id'
  putDb.database.prepare(
    `INSERT INTO worlds (id, owner_user_id, slug, name, visibility, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    putWorldId, putOwnerUserId, 'vis-test-world', 'Vis Test', 'public',
    JSON.stringify({ asset: { version: '2.0', generator: 'Atrium' }, nodes: [{ name: 'root', translation: [0, 0, 0] }] }),
    now, now
  )

  // Also create a world that is always private (for 3b-style checks)
  putDb.database.prepare(
    `INSERT INTO worlds (id, owner_user_id, slug, name, visibility, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'other-world-id', putOwnerUserId, 'other-world', 'Other', 'public',
    JSON.stringify({ asset: { version: '2.0', generator: 'Atrium' }, nodes: [] }),
    now, now
  )

  putHandler = createRequestHandler({
    db: putDb, auth,
    defaultHostRef: dummyHostRef,
    getWorldHost: (id) => putRegistry.getWorldHost(id),
    getRootWorldId: () => putRegistry.getRootWorldId(),
  })
  putHttp.on('request', putHandler)
  putHttp.listen(PORT_PUT)
})

// Helper: connect to the vis-test world via /worlds/ path (triggers lazy host creation)
async function connectVisTest(cookie, sessionId) {
  const ws = await wsOpen(PORT_PUT, '/worlds/PutOwner/vis-test-world', cookie)
  const q = makeMessageQueue(ws)
  sendHello(ws, sessionId)
  const hello = await q.waitForType('hello', 5000)
  return { ws, q, hello }
}

test('3c: non-owner session gets WORLD_NOW_PRIVATE then 1008 on PUT private', async () => {
  const owner = await connectVisTest(putOwnerCookie, 'put-owner-1')
  assert.ok(owner.hello !== null, 'owner connects')

  const other = await connectVisTest(putOtherCookie, 'put-other-1')
  assert.ok(other.hello !== null, 'non-owner connects initially')

  // Owner toggles world to private
  const putRes = await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'private' }, putOwnerCookie)
  assert.equal(putRes.statusCode, 200)

  // Non-owner gets WORLD_NOW_PRIVATE then 1008
  const errMsg = await other.q.waitForType('error', 4000)
  assert.ok(errMsg !== null, 'non-owner should receive error')
  assert.equal(errMsg.code, 'WORLD_NOW_PRIVATE')

  const closeInfo = await new Promise((resolve) => {
    other.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
  assert.equal(closeInfo.code, 1008)

  // Owner sees remove + leave
  const removeMsg = await owner.q.waitForType('remove', 3000)
  assert.ok(removeMsg !== null, 'owner sees remove')
  const leaveMsg = await owner.q.waitForType('leave', 2000)
  assert.ok(leaveMsg !== null, 'owner sees leave')

  owner.ws.close()

  // Toggle back to public for subsequent tests
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'public' }, putOwnerCookie)
})

test('3c: pre-hello socket evicted and never becomes a session', async () => {
  // Connect as owner to establish host
  const owner = await connectVisTest(putOwnerCookie, 'put-owner-ph')
  assert.ok(owner.hello !== null)

  // Connect non-owner WITHOUT sending hello
  const preWs = await wsOpen(PORT_PUT, '/worlds/PutOwner/vis-test-world', putOtherCookie)
  const preQ = makeMessageQueue(preWs)

  // Owner toggles to private
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'private' }, putOwnerCookie)

  // Pre-hello socket should get WORLD_NOW_PRIVATE
  const errMsg = await preQ.waitForType('error', 4000)
  assert.ok(errMsg !== null, 'pre-hello socket should receive error')
  assert.equal(errMsg.code, 'WORLD_NOW_PRIVATE')

  // Pre-hello socket should close
  const closeInfo = await new Promise((resolve) => {
    preWs.once('close', (code) => resolve(code))
  })
  assert.ok(closeInfo !== null, 'pre-hello socket should close')

  owner.ws.close()

  // Toggle back to public
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'public' }, putOwnerCookie)
})

test('3c: anonymous session evicted on private toggle', async () => {
  const owner = await connectVisTest(putOwnerCookie, 'put-owner-anon')
  assert.ok(owner.hello !== null)

  // Connect anonymously (no cookie)
  const anon = await connectVisTest(null, 'anon-session')
  assert.ok(anon.hello !== null, 'anonymous connects')

  // Toggle to private
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'private' }, putOwnerCookie)

  // Anonymous gets evicted
  const errMsg = await anon.q.waitForType('error', 4000)
  assert.ok(errMsg !== null, 'anonymous should get error')
  assert.equal(errMsg.code, 'WORLD_NOW_PRIVATE')

  owner.ws.close()

  // Toggle back to public
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'public' }, putOwnerCookie)
})

test('3c: two owner sessions both survive private toggle', async () => {
  const owner1 = await connectVisTest(putOwnerCookie, 'put-owner-two-a')
  assert.ok(owner1.hello !== null)
  const owner2 = await connectVisTest(putOwnerCookie, 'put-owner-two-b')
  assert.ok(owner2.hello !== null)

  const other = await connectVisTest(putOtherCookie, 'put-other-two')
  assert.ok(other.hello !== null, 'non-owner connects')

  // Toggle to private
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'private' }, putOwnerCookie)

  // Owner sessions should NOT get error
  const err1 = await owner1.q.waitForType('error', 1500)
  assert.equal(err1, null, 'owner 1 should not be evicted')
  const err2 = await owner2.q.waitForType('error', 1500)
  assert.equal(err2, null, 'owner 2 should not be evicted')

  // Non-owner gets evicted
  const errOther = await other.q.waitForType('error', 4000)
  assert.ok(errOther !== null, 'non-owner should be evicted')
  assert.equal(errOther.code, 'WORLD_NOW_PRIVATE')

  owner1.ws.close()
  owner2.ws.close()

  // Toggle back to public
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'public' }, putOwnerCookie)
})

test('3c: switch to public evicts nobody', async () => {
  const other = await connectVisTest(putOtherCookie, 'put-other-public')
  assert.ok(other.hello !== null)

  // World is already public — PUT to confirm
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'public' }, putOwnerCookie)

  // Non-owner should NOT get error
  const errMsg = await other.q.waitForType('error', 2000)
  assert.equal(errMsg, null, 'non-owner should not be evicted')

  other.ws.close()
})

test('3c: non-owner PUT returns 404 and evicts nobody', async () => {
  const other = await connectVisTest(putOtherCookie, 'put-nonowner-put')
  assert.ok(other.hello !== null)

  // Non-owner tries to PUT (different path — their own)
  const putRes = await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'private' }, putOtherCookie)
  assert.equal(putRes.statusCode, 404)

  // Non-owner should NOT be evicted (PUT failed)
  const errMsg = await other.q.waitForType('error', 2000)
  assert.equal(errMsg, null, 'non-owner not evicted after failed PUT')

  other.ws.close()
})

test('3c: commons -> private returns 403 and evicts nobody', async () => {
  // The commons world — find it from the registry directly
  const commonsId = putRegistry.getRootWorldId()

  // Verify it exists in DB
  const dbRow = putDb.database.prepare(
    'SELECT id, owner_user_id, slug FROM worlds WHERE id = ?'
  ).get(commonsId)
  assert.ok(dbRow, `commons world ${commonsId} should exist in DB`)

  // Verify the owner matches what our cookie resolves to
  assert.equal(dbRow.owner_user_id, putOwnerUserId,
    `commons owner ${dbRow.owner_user_id} should match test owner ${putOwnerUserId}`)

  // Connect as non-owner to have a live session
  // Wait briefly in case the previous test left a teardown pending
  await new Promise(r => setTimeout(r, 100))
  const other = await connectVisTest(putOtherCookie, 'put-commons-test')
  assert.ok(other.hello !== null, 'non-owner should connect to public world')

  // Try to set commons to private
  const putRes = await httpPut(PORT_PUT, `/api/worlds/${commonsId}`, { visibility: 'private' }, putOwnerCookie)
  assert.equal(putRes.statusCode, 403, `commons->private should be 403, got ${putRes.statusCode} body=${JSON.stringify(putRes.body)}`)

  // Nobody gets evicted
  const errMsg = await other.q.waitForType('error', 2000)
  assert.equal(errMsg, null, 'nobody evicted after rejected commons->private')

  other.ws.close()
})

test('3c: reconnect after eviction gets WORLD_UNAVAILABLE', async () => {
  // Connect non-owner via /worlds/ path (lazy-creates host)
  const other = await connectVisTest(putOtherCookie, 'put-recon-other')
  assert.ok(other.hello !== null)

  // Toggle to private — evicts non-owner
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'private' }, putOwnerCookie)
  await other.q.waitForType('error', 4000)

  // Wait for teardown to ensure host is gone
  await new Promise(r => setTimeout(r, 3500))

  // Reconnect via /worlds/ path — no host exists, DB says private, should be refused
  const recon = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/PutOwner/vis-test-world`, { headers: { Cookie: putOtherCookie } })
  const rq = makeMessageQueue(recon)
  await new Promise((resolve) => { recon.once('open', resolve); recon.once('error', resolve) })
  const errMsg = await rq.waitForType('error', 4000)
  assert.ok(errMsg !== null, 'reconnect should be refused, got null')
  assert.equal(errMsg.code, 'WORLD_UNAVAILABLE')

  recon.close()

  // Toggle back to public
  await httpPut(PORT_PUT, `/api/worlds/${putWorldId}`, { visibility: 'public' }, putOwnerCookie)
})

// ===========================================================================
// 3e: V7 isCommons field
// ===========================================================================

test('3e: isCommons true for commons row, false for every other row', async () => {
  const commonsId = putRegistry.getRootWorldId()
  const res = await httpGet(PORT_PUT, '/api/worlds', putOwnerCookie)
  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.body))

  // Debug
  for (const w of res.body) {
    const isRoot = w.id === commonsId
    assert.equal(w.isCommons, isRoot,
      `${w.id} (slug=${w.slug}, isCommons=${w.isCommons}, isRoot=${isRoot}): expected isCommons=${isRoot}`)
  }
})

test('3e: isCommons false for all rows when getRootWorldId not provided', async () => {
  // Create a separate server WITHOUT getRootWorldId in the handler
  const norootHttp = createServer()
  const norootHandler = createRequestHandler({
    db: putDb, auth,
  })
  norootHttp.on('request', norootHandler)
  norootHttp.listen(PORT_NO_ROOT)

  const res = await httpGet(PORT_NO_ROOT, '/api/worlds', putOwnerCookie)
  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.body))

  for (const w of res.body) {
    assert.equal(w.isCommons, false, `without getRootWorldId, isCommons should be false for all, got true for ${w.id}`)
  }

  norootHttp.close()
})

// ===========================================================================
// 4: registry.close() terminates all refusal connections
// ===========================================================================

test('4: registry close terminates refusal sockets', async () => {
  // Create an isolated server for this test, use a path that triggers sendRefusal
  const tempDir4 = mkdtempSync(join(tmpdir(), 'atrium-wv-close-test-'))
  const dbPath4 = join(tempDir4, 'test.db')
  const db4 = createDb(dbPath4)
  const http4 = createServer()
  const registry4 = createWorldRegistry({ httpServer: http4, db: db4 })
  const PORT4 = 3055
  http4.listen(PORT4)

  // Connect via unresolved paths to trigger sendRefusal
  const ws1 = new WebSocket(`ws://localhost:${PORT4}/bad/path`)
  await new Promise((resolve) => { ws1.once('open', resolve); setTimeout(() => resolve(), 2000) })
  const ws2 = new WebSocket(`ws://localhost:${PORT4}/another/bad`)
  await new Promise((resolve) => { ws2.once('open', resolve); setTimeout(() => resolve(), 2000) })

  // Give them time to register in refusalWss.clients
  await new Promise(r => setTimeout(r, 300))

  // Close the registry — should terminate refusal clients
  registry4.close()

  // Verify both sockets were terminated (readyState becomes CLOSED)
  assert.ok(ws1.readyState === WebSocket.CLOSED || ws1.readyState === WebSocket.CLOSING,
    `ws1 should be CLOSED or CLOSING after registry.close(), got readyState=${ws1.readyState}`)
  assert.ok(ws2.readyState === WebSocket.CLOSED || ws2.readyState === WebSocket.CLOSING,
    `ws2 should be CLOSED or CLOSING after registry.close(), got readyState=${ws2.readyState}`)

  http4.close()
  db4.close()
  await rm(tempDir4, { recursive: true, force: true })
})