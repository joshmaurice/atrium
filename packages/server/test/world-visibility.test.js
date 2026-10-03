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
import { connect } from 'node:net'
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
// Raw socket helpers (for test 4)
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// Connect a raw TCP socket and perform a WebSocket upgrade handshake.
// Returns the socket once the 101 Switching Protocols response is received.
function rawConnect(port, path) {
  return new Promise((resolve, reject) => {
    const request = [
      `GET ${path} HTTP/1.1`,
      'Host: localhost',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlkhsadkghlkadsfghab==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n')

    const sock = connect({ port, host: '127.0.0.1' })
    sock.write(request)

    let response = ''
    sock.on('data', (chunk) => {
      response += chunk.toString()
      if (response.includes('\r\n\r\n') && response.includes('101')) {
        resolve(sock)
      }
    })
    sock.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Server 1: Refusal tests (3a, 3b, 3d)
// ---------------------------------------------------------------------------

let db, httpRefusal, registry, handlerRefusal
let ownerUserId, privateWorldId
let tempDir, otherUserCookie

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'atrium-wv-test-'))
  const dbPath = join(tempDir, 'test.db')
  db = createDb(dbPath)

  const now = new Date().toISOString()

  ownerUserId = 'wv-owner-uuid'
  db.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(ownerUserId, 'WorldOwner', 'World Owner', now)

  // Non-owner user for authenticated refusal tests (Finding 3a additions)
  const otherUserIdRefusal = 'wv-other-uuid'
  db.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(otherUserIdRefusal, 'OtherUser', 'Other User', now)
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  const otherAuthSess = 'wv-other-auth-sess'
  db.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(otherAuthSess, otherUserIdRefusal, now, farFuture)
  otherUserCookie = `atrium_auth_session=${otherAuthSess}`

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

// ===========================================================================
// 3d: V4 creation-failure refusal (HTTP 404 on failed lazy creation)
// ===========================================================================

test('3d: world creation failure returns HTTP 404 before WebSocket upgrade', async () => {
  // Insert a public world row with document='{}' — this is a truthy but invalid
  // glTF document (no asset.version), so createWorldFromDocument will throw.
  const failWorldId = 'wv-fail-create-id'
  const now = new Date().toISOString()
  db.database.prepare(
    `INSERT INTO worlds (id, owner_user_id, slug, name, visibility, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    failWorldId, ownerUserId, 'fail-create', 'Fail Create', 'public',
    '{}', now, now
  )

  // Connect via /worlds/WorldOwner/fail-create — triggers lazy creation
  const ws = new WebSocket(`ws://localhost:${PORT_REFUSAL}/worlds/WorldOwner/fail-create`)

  // Expect 'unexpected-response' with HTTP 404 (the upgrade handler sends
  // sendHttpResponse(socket, 404, 'Not Found') on creation failure)
  let gotOpen = false
  let errMsgs = []
  let unexpectedResponse = null
  ws.on('open', () => { gotOpen = true })
  ws.on('error', (err) => { errMsgs.push(err.message) })
  ws.on('unexpected-response', (req, res) => {
    unexpectedResponse = { statusCode: res.statusCode }
    res.resume() // consume the response body
  })

  await new Promise((resolve) => {
    ws.once('unexpected-response', resolve)
    // Timeout if neither event fires
    setTimeout(resolve, 5000)
  })

  assert.equal(gotOpen, false, 'should NOT get open event on failed creation')
  assert.ok(unexpectedResponse !== null, 'should get unexpected-response event')
  assert.equal(unexpectedResponse.statusCode, 404,
    `unexpected-response status should be 404, got ${unexpectedResponse.statusCode}`)

  // No host should exist for this world
  assert.equal(registry.getWorldHost(failWorldId), null,
    'no host should exist after failed creation')

  // Clean up: no ws.close() needed — the upgrade never completed
  // Remove the test row so subsequent tests don't see it
  if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
    ws.close()
  }
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

after(async () => {
  putRegistry?.close()
  if (putHttp) putHttp.close()
  if (putDb) putDb.close()
  if (putTempDir) await rm(putTempDir, { recursive: true, force: true })
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

  // Connect non-owner IN THE COMMONS via /worlds/PutOwner/commons
  // The commons is public so non-owner can join
  const common = await wsOpen(PORT_PUT, '/worlds/PutOwner/commons', null)
  const commonQ = makeMessageQueue(common)
  sendHello(common, 'put-commons-session')
  const commonHello = await commonQ.waitForType('hello', 5000)
  assert.ok(commonHello !== null, 'non-owner should connect to commons world')

  // Try to set commons to private
  const putRes = await httpPut(PORT_PUT, `/api/worlds/${commonsId}`, { visibility: 'private' }, putOwnerCookie)
  assert.equal(putRes.statusCode, 403, `commons->private should be 403, got ${putRes.statusCode} body=${JSON.stringify(putRes.body)}`)

  // Nobody gets evicted — the commons session should receive NO error
  const errMsg = await commonQ.waitForType('error', 2000)
  assert.equal(errMsg, null, 'nobody evicted after rejected commons->private')

  common.close()
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
  // Assert exactly one row has isCommons === true
  assert.equal(res.body.filter(w => w.isCommons === true).length, 1,
    'exactly one row should have isCommons === true')

  for (const w of res.body) {
    const isRoot = w.id === commonsId
    assert.equal(w.isCommons, isRoot,
      `${w.id} (slug=${w.slug}, isCommons=${w.isCommons}, isRoot=${isRoot}): expected isCommons=${isRoot}`)
  }
})

test('3e: isCommons false for all rows when getRootWorldId not provided', async () => {
  // Create a separate server WITHOUT getRootWorldId in the handler
  const norootHttp = createServer()
  try {
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
  } finally {
    norootHttp.close()
  }
})

// ===========================================================================
// 4: registry.close() terminates refusal and pre-hello sockets
// ===========================================================================

test('4: registry close terminates refusal and pre-hello sockets', async () => {
  // Create an isolated server for this test
  const tempDir4 = mkdtempSync(join(tmpdir(), 'atrium-wv-close-test-'))
  let db4, http4, registry4
  let preWs
  const sockets4 = []
  try {
    const dbPath4 = join(tempDir4, 'test.db')
    db4 = createDb(dbPath4)
    http4 = createServer()
    registry4 = createWorldRegistry({ httpServer: http4, db: db4 })
    const PORT4 = 3055
    http4.listen(PORT4)

    const now = new Date().toISOString()
    const testUserId = 'wv-test4-user'
    const testWorldId = 'wv-test4-world-id'
    db4.database.prepare(
      'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
    ).run(testUserId, 'Test4User', 'Test4 User', now)
    db4.database.prepare(
      `INSERT INTO worlds (id, owner_user_id, slug, name, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(testWorldId, testUserId, 'test4-world', 'Test4', 'public', now, now)

    // Part A — Two raw refusal sockets that complete upgrade by hand
    const raw1 = await rawConnect(PORT4, '/bad/path1')
    sockets4.push(raw1)
    const raw2 = await rawConnect(PORT4, '/bad/path2')
    sockets4.push(raw2)

    // Wait 300ms — raw sockets should still be open (no close frame reply)
    await sleep(300)

    // Register 'close' listeners on raw sockets (before registry4.close())
    const raw1Closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('raw1 close timeout')), 500)
      raw1.once('close', () => { clearTimeout(timer); resolve() })
    })
    const raw2Closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('raw2 close timeout')), 500)
      raw2.once('close', () => { clearTimeout(timer); resolve() })
    })

    // Part B — Pre-hello ws client to a public world path
    preWs = new WebSocket(`ws://localhost:${PORT4}/worlds/Test4User/test4-world`)
    await new Promise((resolve, reject) => {
      preWs.once('open', resolve)
      preWs.once('error', reject)
    })
    assert.equal(
      registry4.getWorldHost(testWorldId).getPreHelloSocketCount(), 1,
      'pre-hello socket count should be 1 before close'
    )
    assert.ok(preWs.readyState === WebSocket.OPEN, 'pre-hello ws should be OPEN before close')

    // Register close handler BEFORE calling registry4.close()
    const preWsClosed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('pre-hello ws close timeout')), 500)
      preWs.once('close', () => { clearTimeout(timer); resolve() })
    })

    // Close the registry — terminates refusal clients + all hosts' clients
    registry4.close()

    // Assert raw sockets close within 500ms
    await raw1Closed
    await raw2Closed

    // Assert ws client reaches CLOSED within 500ms
    await preWsClosed
    assert.ok(
      preWs.readyState === WebSocket.CLOSED || preWs.readyState === WebSocket.CLOSING,
      `pre-hello ws should be CLOSED or CLOSING after registry.close(), got readyState=${preWs.readyState}`
    )

    // Assert host is null after registry close
    assert.equal(registry4.getWorldHost(testWorldId), null,
      'host should be null after registry.close()')
  } finally {
    if (preWs) { try { preWs.terminate() } catch { /* ignore */ } }
    for (const s of sockets4) {
      try { s.destroy() } catch { /* ignore */ }
    }
    if (registry4) registry4?.close()
    if (http4) http4.close()
    if (db4) db4.close()
    await rm(tempDir4, { recursive: true, force: true })
  }
})

// ===========================================================================
// 3a additions (Finding 3): authenticated non-owner refusals — byte-identical
// ===========================================================================

test('3a: byte-identical refusals for authenticated non-owner', async () => {
  const AUTH_REFUSAL_PATHS = [
    { path: '/worlds/WorldOwner/private-world', label: 'private world x authenticated non-owner (/worlds/)' },
    { path: '/public/WorldOwner/private-world', label: 'private world x authenticated non-owner (/public/)' },
    { path: `/ws/${privateWorldId}`, label: '/ws/<id> private world x authenticated non-owner' },
  ]

  // Connect each path with the other user's cookie
  const firstMessages = []
  const closeCodes = []
  const closeReasons = []

  for (const { path } of AUTH_REFUSAL_PATHS) {
    const ws = new WebSocket(`ws://localhost:${PORT_REFUSAL}${path}`, { headers: { Cookie: otherUserCookie } })
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

  // Baseline anonymous refusal to compare against
  const baseWs = new WebSocket(`ws://localhost:${PORT_REFUSAL}/worlds/UnknownNobody/foo`)
  const baseClose = new Promise((resolve) => {
    baseWs.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
  await new Promise((resolve, reject) => {
    baseWs.once('open', resolve)
    baseWs.once('error', reject)
  })
  const baseQ = makeMessageQueue(baseWs)
  const baseMsg = await baseQ.waitForType('error', 2000)
  await baseClose

  for (let i = 0; i < firstMessages.length; i++) {
    assert.deepEqual(firstMessages[i], baseMsg,
      `auth refusal mismatch: ${AUTH_REFUSAL_PATHS[i].label}`)
  }
  for (let i = 0; i < closeCodes.length; i++) {
    assert.equal(closeCodes[i], 1008,
      `auth close code for ${AUTH_REFUSAL_PATHS[i].label}: ${closeCodes[i]}`)
  }
  for (let i = 0; i < closeReasons.length; i++) {
    assert.equal(closeReasons[i], '',
      `auth close reason for ${AUTH_REFUSAL_PATHS[i].label}: "${closeReasons[i]}"`)
  }
})

// ===========================================================================
// 3b additions (Finding 4): refusal creates no host + no teardown cancellation
// ===========================================================================

test('3b: refusal for private/unknown slug creates no host in registry', async () => {
  // Connect to private world anonymously — gets refused
  const ws = new WebSocket(`ws://localhost:${PORT_REFUSAL}/worlds/WorldOwner/private-world`)
  // Register message listener BEFORE awaiting open, to avoid race
  const q = makeMessageQueue(ws)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  const msg = await q.waitForType('error', 4000)
  assert.ok(msg !== null, 'private world anonymous should get error')
  assert.equal(msg.code, 'WORLD_UNAVAILABLE')
  ws.close()

  // No host should exist in registry for the private world
  assert.equal(registry.getWorldHost(privateWorldId), null,
    'no host should exist for private world after refusal')
})

test('3b: refusal does not cancel a pending teardown', async () => {
  const tdDir = mkdtempSync(join(tmpdir(), 'atrium-wv-td-test-'))
  const dbPath = join(tdDir, 'test.db')
  const tdDb = createDb(dbPath)
  const tdHttp = createServer()
  const tdRegistry = createWorldRegistry({ httpServer: tdHttp, db: tdDb })
  const TD_PORT = 3056

  const now = new Date().toISOString()
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  const tdOwnerId = 'td-owner-uuid'
  tdDb.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(tdOwnerId, 'TdOwner', 'TD Owner', now)

  // Create auth session for owner
  const tdOwnerSess = 'td-owner-auth-sess'
  tdDb.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(tdOwnerSess, tdOwnerId, now, farFuture)
  const tdOwnerCookie = `atrium_auth_session=${tdOwnerSess}`

  // Create a non-owner user for the /ws/<id> refusal test
  const tdOtherId = 'td-other-uuid'
  tdDb.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(tdOtherId, 'TdOther', 'TD Other', now)
  const tdOtherSess = 'td-other-auth-sess'
  tdDb.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(tdOtherSess, tdOtherId, now, farFuture)
  const tdOtherCookie = `atrium_auth_session=${tdOtherSess}`

  process.env.ATRIUM_COMMONS_OWNER = 'TdOwner'
  process.env.ATRIUM_COMMONS_SLUG = 'commons'

  const dummyHostRef = { current: null }
  const result = await setupCommons({ registry: tdRegistry, db: tdDb, worldPath: FIXTURE_PATH })
  dummyHostRef.current = result.host

  const tdWorldId = 'td-teardown-world-id'
  tdDb.database.prepare(
    `INSERT INTO worlds (id, owner_user_id, slug, name, visibility, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tdWorldId, tdOwnerId, 'td-world', 'TD World', 'private',
    JSON.stringify({ asset: { version: '2.0', generator: 'Atrium' }, nodes: [{ name: 'root', translation: [0, 0, 0] }] }),
    now, now
  )

  const tdHandler = createRequestHandler({
    db: tdDb, auth,
    defaultHostRef: dummyHostRef,
    getWorldHost: (id) => tdRegistry.getWorldHost(id),
    getRootWorldId: () => tdRegistry.getRootWorldId(),
  })
  tdHttp.on('request', tdHandler)
  tdHttp.listen(TD_PORT)

  // Track client sockets for teardown
  const clients = []

  try {
    // Connect owner (with cookie) to create a host for tdWorldId
    // Private world admits owner via /worlds/ path with auth cookie
    const owner = await wsOpen(TD_PORT, '/worlds/TdOwner/td-world', tdOwnerCookie)
    clients.push(owner)
    const ownerQ = makeMessageQueue(owner)
    sendHello(owner, 'td-owner-session')
    const hello = await ownerQ.waitForType('hello', 5000)
    assert.ok(hello !== null, 'owner should connect to private world')
    assert.ok(tdRegistry.getWorldHost(tdWorldId) !== null, 'host should exist after connect')

    // Disconnect owner — triggers scheduleTeardown
    owner.close()
    await new Promise(r => setTimeout(r, 300))

    // Attempt A: anonymous connection via /worlds/ — private world + no cookie → WORLD_UNAVAILABLE
    const anon = new WebSocket(`ws://localhost:${TD_PORT}/worlds/TdOwner/td-world`)
    clients.push(anon)
    const anonQ = makeMessageQueue(anon)
    await new Promise((resolve, reject) => {
      anon.once('open', resolve)
      anon.once('error', reject)
    })
    const anonMsg = await anonQ.waitForType('error', 4000)
    assert.ok(anonMsg !== null, 'anonymous should get refusal for private world')
    assert.equal(anonMsg.code, 'WORLD_UNAVAILABLE',
      `anonymous refusal code should be WORLD_UNAVAILABLE, got ${anonMsg.code}`)
    anon.close()

    // Attempt B: non-owner via /ws/<tdWorldId> — private world + non-owner → WORLD_UNAVAILABLE
    const nonOwner = new WebSocket(`ws://localhost:${TD_PORT}/ws/${tdWorldId}`, { headers: { Cookie: tdOtherCookie } })
    clients.push(nonOwner)
    const nonOwnerQ = makeMessageQueue(nonOwner)
    await new Promise((resolve, reject) => {
      nonOwner.once('open', resolve)
      nonOwner.once('error', reject)
    })
    const nonOwnerMsg = await nonOwnerQ.waitForType('error', 4000)
    assert.ok(nonOwnerMsg !== null, 'non-owner should get refusal for private world')
    assert.equal(nonOwnerMsg.code, 'WORLD_UNAVAILABLE',
      `non-owner refusal code should be WORLD_UNAVAILABLE, got ${nonOwnerMsg.code}`)
    nonOwner.close()

    // Wait for teardown delay (3s) + buffer
    await new Promise(r => setTimeout(r, 3500))

    // Host should have been torn down despite both refusals
    assert.equal(tdRegistry.getWorldHost(tdWorldId), null,
      'host should be torn down after delay even though refusals were attempted')
  } finally {
    for (const ws of clients) {
      try { ws.terminate() } catch { /* ignore */ }
    }
    tdRegistry.close()
    tdHttp.close()
    tdDb.close()
    await rm(tdDir, { recursive: true, force: true })
  }
})

// ===========================================================================
// Finding 2: WS error-handler tests
// ===========================================================================

test('Finding 2a: raw unmasked frame on refusal path does not crash server', async () => {
  // Connect to refusal path via ws library, register listener before awaiting open
  const ws = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/UnknownNobody/bogus`)
  const q = makeMessageQueue(ws)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  const msg = await q.waitForType('error', 4000)
  assert.ok(msg !== null, 'first connection should get refusal')
  assert.equal(msg.code, 'WORLD_UNAVAILABLE')

  // Send an unmasked text frame on the underlying TCP socket
  const sock = ws._socket
  if (sock) {
    sock.write(Buffer.from([0x81, 0x02, 0x68, 0x69]))
  }

  // Wait for server to process the unmasked frame
  await new Promise(r => setTimeout(r, 600))

  // Server should still accept new connections
  const ws2 = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/UnknownNobody/bogus`)
  const q2 = makeMessageQueue(ws2)
  await new Promise((resolve, reject) => {
    ws2.once('open', resolve)
    ws2.once('error', reject)
  })
  const msg2 = await q2.waitForType('error', 4000)
  assert.ok(msg2 !== null, 'server should still refuse new connections after unmasked frame')
  assert.equal(msg2.code, 'WORLD_UNAVAILABLE')
  ws2.close()
  ws.close()
})

test('Finding 2b: raw unmasked frame on live session does not crash server', async () => {
  // Connect a peer session that will observe remove + leave
  const peer = await wsOpen(PORT_PUT, '/worlds/PutOwner/vis-test-world', putOwnerCookie)
  const peerQ = makeMessageQueue(peer)
  sendHello(peer, 'peer-session-wv')
  const peerHello = await peerQ.waitForType('hello', 5000)
  assert.ok(peerHello !== null, 'peer should connect')

  // Connect a second session via ws library, send hello, then unmasked frame on raw socket
  const target = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/PutOwner/vis-test-world`)
  await new Promise((resolve, reject) => {
    target.once('open', resolve)
    target.once('error', reject)
  })
  // Send hello over the ws library
  sendHello(target, 'raw-session-wv')
  await new Promise(r => setTimeout(r, 400))

  // Write an unmasked text frame on the underlying TCP socket
  const sock = target._socket
  if (sock) {
    sock.write(Buffer.from([0x81, 0x02, 0x68, 0x69]))
  }
  await new Promise(r => setTimeout(r, 800))

  // Peer should see remove + leave for the raw session
  const removeMsg = await peerQ.waitForType('remove', 3000)
  assert.ok(removeMsg !== null, 'peer should see remove after unmasked frame')
  assert.equal(removeMsg.id, 'raw-session-wv')

  const leaveMsg = await peerQ.waitForType('leave', 2000)
  assert.ok(leaveMsg !== null, 'peer should see leave after unmasked frame')
  assert.equal(leaveMsg.id, 'raw-session-wv')

  // Server should still accept new connections
  const check = await wsOpen(PORT_PUT, '/worlds/PutOwner/vis-test-world', putOtherCookie)
  const checkQ = makeMessageQueue(check)
  sendHello(check, 'check-session-wv')
  const checkHello = await checkQ.waitForType('hello', 5000)
  assert.ok(checkHello !== null, 'server should accept new connections after unmasked frame')

  check.close()
  peer.close()
  target.close()
})

// ===========================================================================
// Finding 5: Pre-hello socket teardown fix
// Each test uses its own fresh public world row on the PUT server (PORT_PUT)
// ===========================================================================

test('Finding 5a: fresh-host pre-hello close schedules teardown', async () => {
  const now = new Date().toISOString()
  const rowId = 'f5a-world-id'
  putDb.database.prepare(
    `INSERT OR IGNORE INTO worlds (id, owner_user_id, slug, name, visibility, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rowId, putOwnerUserId, 'f5a-world', 'F5A', 'public',
    JSON.stringify({ asset: { version: '2.0', generator: 'Atrium' }, nodes: [{ name: 'root', translation: [0, 0, 0] }] }),
    now, now
  )

  // Connect to a never-loaded world via /worlds/PutOwner/f5a-world
  const ws = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/PutOwner/f5a-world`)
  await new Promise((resolve) => { ws.once('open', resolve); ws.once('error', resolve) })
  // Host now exists from lazy creation
  assert.ok(putRegistry.getWorldHost(rowId) !== null, 'host should exist after open')

  // Close WITHOUT hello — this is a pre-hello close
  ws.close()

  // Wait teardown delay (3s) + buffer
  await new Promise(r => setTimeout(r, 3500))

  // Host should have been torn down
  assert.equal(putRegistry.getWorldHost(rowId), null,
    'host should be null after pre-hello close + delay')

  // Clean up
  putDb.database.prepare('DELETE FROM worlds WHERE id = ?').run(rowId)
})

test('Finding 5b: pre-hello close cancels then reschedules teardown', async () => {
  const now = new Date().toISOString()
  const rowId = 'f5b-world-id'
  putDb.database.prepare(
    `INSERT OR IGNORE INTO worlds (id, owner_user_id, slug, name, visibility, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rowId, putOwnerUserId, 'f5b-world', 'F5B', 'public',
    JSON.stringify({ asset: { version: '2.0', generator: 'Atrium' }, nodes: [{ name: 'root', translation: [0, 0, 0] }] }),
    now, now
  )

  // Owner connects + hello to f5b-world (creates host with a session)
  const owner = await wsOpen(PORT_PUT, '/worlds/PutOwner/f5b-world', putOwnerCookie)
  const ownerQ = makeMessageQueue(owner)
  sendHello(owner, 'f5b-owner')
  const hello = await ownerQ.waitForType('hello', 5000)
  assert.ok(hello !== null, 'owner should connect')
  assert.ok(putRegistry.getWorldHost(rowId) !== null, 'host should exist after connect')

  // Owner disconnects — teardown scheduled (pending)
  owner.close()
  await new Promise(r => setTimeout(r, 300))

  // Second socket connects (cancels pending teardown) and closes without hello
  const preHello = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/PutOwner/f5b-world`)
  await new Promise((resolve) => { preHello.once('open', resolve); preHello.once('error', resolve) })
  preHello.close() // pre-hello close — should reschedule teardown

  // Wait teardown delay + buffer
  await new Promise(r => setTimeout(r, 3500))

  // Host should have been torn down
  assert.equal(putRegistry.getWorldHost(rowId), null,
    'host should be null after pre-hello close + delay')

  // Clean up
  putDb.database.prepare('DELETE FROM worlds WHERE id = ?').run(rowId)
})

test('Finding 5c: pre-hello close with live session leaves host up', async () => {
  const now = new Date().toISOString()
  const rowId = 'f5c-world-id'
  putDb.database.prepare(
    `INSERT OR IGNORE INTO worlds (id, owner_user_id, slug, name, visibility, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rowId, putOwnerUserId, 'f5c-world', 'F5C', 'public',
    JSON.stringify({ asset: { version: '2.0', generator: 'Atrium' }, nodes: [{ name: 'root', translation: [0, 0, 0] }] }),
    now, now
  )

  // Owner connects + hello (live session)
  const owner = await wsOpen(PORT_PUT, '/worlds/PutOwner/f5c-world', putOwnerCookie)
  const ownerQ = makeMessageQueue(owner)
  sendHello(owner, 'f5c-owner')
  const ownerHello = await ownerQ.waitForType('hello', 5000)
  assert.ok(ownerHello !== null, 'owner should connect')
  assert.ok(putRegistry.getWorldHost(rowId) !== null, 'host should exist')

  // Second socket connects and closes without hello
  const preHello = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/PutOwner/f5c-world`)
  await new Promise((resolve) => { preHello.once('open', resolve); preHello.once('error', resolve) })
  preHello.close()

  // Wait past teardown delay
  await new Promise(r => setTimeout(r, 3500))

  // Host should still be up because the owner session is live
  assert.ok(putRegistry.getWorldHost(rowId) !== null,
    'host should still be up after delay (owner session is live)')

  // Close owner session so teardown can happen and file exits cleanly
  owner.close()
  await new Promise(r => setTimeout(r, 3500))

  putDb.database.prepare('DELETE FROM worlds WHERE id = ?').run(rowId)
})

test('Finding 5d: pre-hello close with second pre-hello socket open leaves host up; second can complete hello', async () => {
  const now = new Date().toISOString()
  const rowId = 'f5d-world-id'
  putDb.database.prepare(
    `INSERT OR IGNORE INTO worlds (id, owner_user_id, slug, name, visibility, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rowId, putOwnerUserId, 'f5d-world', 'F5D', 'public',
    JSON.stringify({ asset: { version: '2.0', generator: 'Atrium' }, nodes: [{ name: 'root', translation: [0, 0, 0] }] }),
    now, now
  )

  // Two pre-hello sockets connect to the fresh world
  const pre1 = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/PutOwner/f5d-world`)
  await new Promise((resolve) => { pre1.once('open', resolve); pre1.once('error', resolve) })
  const pre2 = new WebSocket(`ws://localhost:${PORT_PUT}/worlds/PutOwner/f5d-world`)
  await new Promise((resolve) => { pre2.once('open', resolve); pre2.once('error', resolve) })

  assert.ok(putRegistry.getWorldHost(rowId) !== null, 'host should exist')

  // First pre-hello socket closes
  pre1.close()

  // Wait past teardown delay
  await new Promise(r => setTimeout(r, 3500))

  // Host should still be up (second pre-hello socket is still open)
  assert.ok(putRegistry.getWorldHost(rowId) !== null,
    'host should be up after delay (second pre-hello socket still open)')

  // Second socket completes hello successfully
  const pre2Q = makeMessageQueue(pre2)
  sendHello(pre2, 'f5d-session')
  const helloReply = await pre2Q.waitForType('hello', 5000)
  assert.ok(helloReply !== null, 'second socket should receive hello reply')

  // Host must still be up after hello completes
  assert.ok(putRegistry.getWorldHost(rowId) !== null,
    'host should be up after hello completes')

  // Close the session so teardown can happen and file exits cleanly
  pre2.close()
  await new Promise(r => setTimeout(r, 3500))

  putDb.database.prepare('DELETE FROM worlds WHERE id = ?').run(rowId)
})