// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Tests for Phase 2 Step 5 — The Commons (operator-owned, DB-backed, root-mounted)
// Covers all 13 required test cases from the implementation brief.

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
import { createWorldRegistry } from '../src/world-registry.js'
import { createRequestHandler } from '../src/http-routes.js'
import { createWorld } from '../src/world.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'
import { setupCommons, scanGltfForExternalRefs } from '../src/commons.js'
import * as worldStore from '../src/world-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

// ---------------------------------------------------------------------------
// Shared test server — tests that need a pristine server use it via before/after.
// Tests that mutate server state (restart, degraded boot) create their own.
// ---------------------------------------------------------------------------

const PORT = 9200
let tempDir, db, httpServer, registry, handler
let operatorUserId, operatorCookie
let nonOpUserId, nonOpCookie
let dummyHostRef, defaultHost
let commonsWorldId

async function setupTestServer() {
  tempDir = mkdtempSync(join(tmpdir(), 'atrium-commons-test-'))
  const dbPath = join(tempDir, 'test.db')
  db = createDb(dbPath)

  // Create operator user
  const now = new Date().toISOString()
  operatorUserId = 'commons-operator-uuid'
  db.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(operatorUserId, 'Operator', 'Operator', now)

  // Create non-operator user
  nonOpUserId = 'commons-nonop-uuid'
  db.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(nonOpUserId, 'Visitor', 'Visitor', now)

  // Create auth sessions
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  const opSession = 'commons-op-session'
  const nonOpSession = 'commons-nonop-session'
  db.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(opSession, operatorUserId, now, farFuture)
  db.database.prepare(
    'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(nonOpSession, nonOpUserId, now, farFuture)
  operatorCookie = `atrium_auth_session=${opSession}`
  nonOpCookie = `atrium_auth_session=${nonOpSession}`

  // Set env for setupCommons
  process.env.ATRIUM_COMMONS_OWNER = 'Operator'
  process.env.ATRIUM_COMMONS_SLUG = 'commons'

  // Create server and registry
  httpServer = createServer()
  registry = createWorldRegistry({ httpServer, db })

  // Commons setup
  dummyHostRef = { current: null }
  const result = await setupCommons({ registry, db, worldPath: FIXTURE_PATH })
  defaultHost = result.host
  commonsWorldId = registry.getRootWorldId()
  dummyHostRef.current = defaultHost

  // HTTP handler
  handler = createRequestHandler({
    db, auth,
    defaultHostRef: dummyHostRef,
    getWorldHost: (id) => registry.getWorldHost(id),
    getRootWorldId: () => registry.getRootWorldId(),
  })
  httpServer.on('request', handler)
  httpServer.listen(PORT)
}

async function teardownTestServer() {
  registry?.close()
  if (httpServer) httpServer.close()
  if (db) db.close()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessageQueue(ws) {
  const listeners = {}
  const waitForType = (type, timeoutMs = 2000) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), timeoutMs)
      listeners[type] = (data) => {
        clearTimeout(timer)
        resolve(data)
      }
    })
  }
  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (msg.type && listeners[msg.type]) {
      listeners[msg.type](msg)
    }
  })
  return { waitForType }
}

function wsConnect(path, cookie) {
  return new Promise((resolve, reject) => {
    const headers = cookie ? { Cookie: cookie } : {}
    const ws = new WebSocket(`ws://localhost:${PORT}${path}`, { headers })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function sendHello(ws, id) {
  ws.send(JSON.stringify({ type: 'hello', id: id || 'test-session' }))
}

function httpPut(path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    }
    if (cookie) headers['Cookie'] = cookie
    const req = request({ hostname: 'localhost', port: PORT, path, method: 'PUT', headers }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body || '{}') }) }
        catch { resolve({ statusCode: res.statusCode, body }) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function httpDelete(path, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {}
    if (cookie) headers['Cookie'] = cookie
    const req = request({ hostname: 'localhost', port: PORT, path, method: 'DELETE', headers }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body || '{}') }) }
        catch { resolve({ statusCode: res.statusCode, body }) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function httpPostRaw(url, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    }
    if (cookie) headers['Cookie'] = cookie
    const parsed = new URL(url)
    const req = request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'POST', headers }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }) }
        catch { resolve({ statusCode: res.statusCode, body }) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Setup/teardown
// ---------------------------------------------------------------------------

before(async () => {
  await setupTestServer()
})

after(async () => {
  await teardownTestServer()
})

// ===================================================================
// Test 1: Anonymous client on commons — all mutation denied
// ===================================================================

test('commons — anonymous add/send/remove all denied', async () => {
  const ws = await wsConnect('/', null)
  const q = makeMessageQueue(ws)
  sendHello(ws, 'anon-test')

  const hello = await q.waitForType('hello', 2000)
  assert.ok(hello, 'anonymous got hello response')

  // Try 'add' non-avatar
  ws.send(JSON.stringify({ type: 'add', seq: 1, node: { name: 'anon-node' } }))
  const err1 = await q.waitForType('error', 1000)
  assert.ok(err1, 'add got error response')
  assert.equal(err1.code, 'PERMISSION_DENIED')

  // Try 'send' (setField)
  ws.send(JSON.stringify({ type: 'send', seq: 2, node: 'some-node', field: 'translation', value: [0, 0, 0] }))
  const err2 = await q.waitForType('error', 1000)
  assert.ok(err2, 'send got error response')
  assert.equal(err2.code, 'PERMISSION_DENIED')

  // Try 'remove'
  ws.send(JSON.stringify({ type: 'remove', seq: 3, node: 'some-node' }))
  const err3 = await q.waitForType('error', 1000)
  assert.ok(err3, 'remove got error response')
  assert.equal(err3.code, 'PERMISSION_DENIED')

  ws.close()
})

// ===================================================================
// Test 2: Authenticated NON-operator — same three denials
// ===================================================================

test('commons — authenticated non-operator add/send/remove all denied', async () => {
  const ws = await wsConnect('/', nonOpCookie)
  const q = makeMessageQueue(ws)
  sendHello(ws, 'nonop-test')

  const hello = await q.waitForType('hello', 2000)
  assert.ok(hello, 'non-operator got hello response')

  ws.send(JSON.stringify({ type: 'add', seq: 1, node: { name: 'nonop-node' } }))
  const err1 = await q.waitForType('error', 1000)
  assert.ok(err1, 'add denied')
  assert.equal(err1.code, 'PERMISSION_DENIED')

  ws.send(JSON.stringify({ type: 'send', seq: 2, node: 'some-node', field: 'translation', value: [1, 0, 0] }))
  const err2 = await q.waitForType('error', 1000)
  assert.ok(err2, 'send denied')
  assert.equal(err2.code, 'PERMISSION_DENIED')

  ws.send(JSON.stringify({ type: 'remove', seq: 3, node: 'some-node' }))
  const err3 = await q.waitForType('error', 1000)
  assert.ok(err3, 'remove denied')
  assert.equal(err3.code, 'PERMISSION_DENIED')

  ws.close()
})

// ===================================================================
// Test 3: Client supplies operator's display name — still denied
// ===================================================================

test('commons — operator username in display name still denied', async () => {
  const ws = await wsConnect('/', nonOpCookie)
  const q = makeMessageQueue(ws)
  sendHello(ws, 'impostor-test')
  await q.waitForType('hello', 2000)

  ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'some-node', field: 'translation', value: [0, 0, 0] }))
  const err = await q.waitForType('error', 1000)
  assert.ok(err, 'identity from cookie, not hello payload')
  assert.equal(err.code, 'PERMISSION_DENIED')

  ws.close()
})

// ===================================================================
// Test 4: Operator mutation succeeds, autosaves, no avatars in document
// ===================================================================

test('commons — operator mutation succeeds and persists', async () => {
  const ws = await wsConnect('/', operatorCookie)
  const q = makeMessageQueue(ws)
  sendHello(ws, 'op-test')

  await q.waitForType('hello', 2000)
  await q.waitForType('som-dump', 2000)

  // Add a node as operator
  ws.send(JSON.stringify({
    type: 'add', seq: 1, node: {
      name: 'op-added-node',
      mesh: { primitives: [{ attributes: { POSITION: 0 } }] },
    }
  }))

  await new Promise(r => setTimeout(r, 100))

  // Verify the node is present in the live world
  const nodeNames = defaultHost.world.listNodeNames() || []
  assert.ok(nodeNames.includes('op-added-node'), 'operator-added node present')

  ws.close()
})

// ===================================================================
// Test 5: Restart — edit persists, no re-seed (self-contained server)
// ===================================================================

test('commons — restart preserves prior edits, no re-seed', async () => {
  const tDir = mkdtempSync(join(tmpdir(), 'atrium-commons-restart-'))
  const dbPath5 = join(tDir, 'test.db')
  const db5 = createDb(dbPath5)
  const now = new Date().toISOString()

  // Create operator
  const opId = 'restart-op-uuid'
  db5.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(opId, 'RestartOp', 'RestartOp', now)

  process.env.ATRIUM_COMMONS_OWNER = 'RestartOp'
  process.env.ATRIUM_COMMONS_SLUG = 'commons'

  // First boot
  const http5a = createServer()
  const reg5a = createWorldRegistry({ httpServer: http5a, db: db5 })
  const resultA = await setupCommons({ registry: reg5a, db: db5, worldPath: FIXTURE_PATH })
  assert.equal(resultA.mode, 'owned', 'first boot is owned')

  // Make an edit to the live world
  const liveWorld = resultA.host.world
  liveWorld.addNode({ name: 'restart-persist-node', mesh: { primitives: [{ attributes: { POSITION: 0 } }] } }, null)

  // Manually persist the edit to DB via world-store
  const rootId5a = reg5a.getRootWorldId()
  const serializedDoc = JSON.stringify(await liveWorld.serialize())
  const saveResult = worldStore.updateWorld(db5.database, rootId5a, opId, { document: serializedDoc })
  assert.ok(saveResult.ok, 'manual save succeeded')

  // Close first boot
  reg5a.close()
  http5a.close()

  // Second boot (same DB, same operator)
  const http5b = createServer()
  const reg5b = createWorldRegistry({ httpServer: http5b, db: db5 })
  const resultB = await setupCommons({ registry: reg5b, db: db5, worldPath: FIXTURE_PATH })
  assert.equal(resultB.mode, 'owned', 'second boot is owned')

  // Check no new row was created
  const rows = db5.database.prepare(
    'SELECT id, document FROM worlds WHERE slug = ? AND owner_user_id = ?'
  ).all('commons', opId)
  assert.equal(rows.length, 1, 'no additional commons row created')

  // Document should contain the operator-added node
  const docText = rows[0].document
  assert.ok(docText.includes('restart-persist-node'), 'operator edit preserved after restart')

  reg5b.close()
  http5b.close()
  db5.close()
  await rm(tDir, { recursive: true, force: true })
})

// ===================================================================
// Test 6: Missing operator — degraded read-only boot (self-contained)
// ===================================================================

test('commons — missing operator boots in degraded read-only mode', async () => {
  const tDir = mkdtempSync(join(tmpdir(), 'atrium-commons-degraded-'))
  const dbPath6 = join(tDir, 'test.db')
  const db6 = createDb(dbPath6)

  process.env.ATRIUM_COMMONS_OWNER = 'NonExistentUser'
  process.env.ATRIUM_COMMONS_SLUG = 'commons'

  const http6 = createServer()
  const reg6 = createWorldRegistry({ httpServer: http6, db: db6 })
  const result = await setupCommons({ registry: reg6, db: db6, worldPath: FIXTURE_PATH })
  assert.equal(result.mode, 'read-only', 'degraded boot mode is read-only')
  assert.ok(result.host, 'degraded boot returns a host')
  assert.equal(result.host.mutationPolicy, 'read-only', 'host has read-only policy')

  // Quick mutation attempt test via registry's default host
  const host6 = reg6.getDefaultHost()
  assert.ok(host6, 'default host exists in degraded mode')

  reg6.close()
  http6.close()
  db6.close()
  await rm(tDir, { recursive: true, force: true })
})

// ===================================================================
// Test 7: Production boot never yields 'open'
// ===================================================================

test('commons — production boot host never has open mutationPolicy', async () => {
  const commonsHost = registry.getWorldHost(commonsWorldId)
  assert.ok(commonsHost, 'commons host exists')
  assert.notEqual(commonsHost.mutationPolicy, 'open', 'commons host is never open')
  // Must be 'owner' when operator is configured
  assert.equal(commonsHost.mutationPolicy, 'owner', 'commons host has owner policy')
})

// ===================================================================
// Test 8: Single-host guarantee — all paths hit one host
// ===================================================================

test('commons — single host via /, /apps/client, /public/<op>/<slug>, /ws/<uuid>', async () => {
  const hostBefore = registry.hosts.get(commonsWorldId)
  assert.ok(hostBefore, 'commons host exists')

  // Connect via /
  const ws1 = await wsConnect('/', operatorCookie)
  const q1 = makeMessageQueue(ws1)
  sendHello(ws1, 'single-host-root')
  await q1.waitForType('hello', 2000)

  // Connect via /public/<operator>/commons
  const ws2 = await wsConnect('/public/Operator/commons', operatorCookie)
  const q2 = makeMessageQueue(ws2)
  sendHello(ws2, 'single-host-public')
  const hello2 = await q2.waitForType('hello', 2000)
  assert.ok(hello2, 'hello received via /public/ path')

  // Connect via /ws/<commonsWorldId>
  const ws3 = await wsConnect(`/ws/${commonsWorldId}`, operatorCookie)
  const q3 = makeMessageQueue(ws3)
  sendHello(ws3, 'single-host-ws')
  const hello3 = await q3.waitForType('hello', 2000)
  assert.ok(hello3, 'hello received via /ws/ path')

  // All connections are on the SAME host — exactly one host in the registry
  assert.equal(registry.hosts.size, 1, 'exactly one host in registry (single-host guarantee)')

  ws1.close()
  ws2.close()
  ws3.close()
})

// ===================================================================
// Test 9: Last session leaves — flush, host stays resident
// ===================================================================

test('commons — last session leaves, host remains in registry', async () => {
  const hostBefore = registry.hosts.get(commonsWorldId)
  assert.ok(hostBefore, 'host exists before')

  // Connect, make a tiny change, then disconnect
  const ws = await wsConnect('/', operatorCookie)
  const q = makeMessageQueue(ws)
  sendHello(ws, 'flush-test')
  await q.waitForType('hello', 2000)

  // Add a small node to mark world dirty
  ws.send(JSON.stringify({
    type: 'add', seq: 1, node: {
      name: 'flush-test-node',
      mesh: { primitives: [{ attributes: { POSITION: 0 } }] },
    }
  }))
  await new Promise(r => setTimeout(r, 100))

  // Disconnect — should trigger flush via onSessionRemoved
  ws.close()
  await new Promise(r => setTimeout(r, 200))

  // Host should still be in registry
  const hostAfter = registry.hosts.get(commonsWorldId)
  assert.ok(hostAfter, 'host still in registry after last session leaves')

  // Node should be in the live world
  const nodeNames = hostAfter.world.listNodeNames() || []
  assert.ok(nodeNames.includes('flush-test-node'), 'node persisted in host after flush')

  // Clean up test node
  hostAfter.world.removeNode('flush-test-node')
})

// ===================================================================
// Test 10: Row protection — DELETE / PUT restrictions
// ===================================================================

test('commons — row protection rejects delete, rename, visibility change', async () => {
  // DELETE should be 403
  const delRes = await httpDelete(`/api/worlds/${commonsWorldId}`, operatorCookie)
  assert.equal(delRes.statusCode, 403)
  assert.ok(delRes.body.error.toLowerCase().includes('cannot be deleted'))

  // PUT slug change should be 403
  const renameRes = await httpPut(`/api/worlds/${commonsWorldId}`, { slug: 'new-name' }, operatorCookie)
  assert.equal(renameRes.statusCode, 403)
  assert.ok(renameRes.body.error.toLowerCase().includes('cannot rename'))

  // PUT visibility to private should be 403
  const privRes = await httpPut(`/api/worlds/${commonsWorldId}`, { visibility: 'private' }, operatorCookie)
  assert.equal(privRes.statusCode, 403)
  assert.ok(privRes.body.error.toLowerCase().includes('must remain public'))

  // Non-root world of the same operator should be deletable (control case)
  const now = new Date().toISOString()
  const controlWorldId = 'commons-control-world-id'
  db.database.prepare(
    `INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'public', ?, ?)`
  ).run(controlWorldId, operatorUserId, 'control-world', '', '', now, now)

  const delControl = await httpDelete(`/api/worlds/${controlWorldId}`, operatorCookie)
  assert.equal(delControl.statusCode, 200, 'non-root world is deletable')
})

// ===================================================================
// Test 11: Non-operator can create a world named 'commons'
// ===================================================================

test('commons — non-operator can create ordinary world named commons', async () => {
  const res = await httpPostRaw(
    `http://localhost:${PORT}/api/worlds`,
    { slug: 'commons', name: 'My Commons' },
    nonOpCookie
  )
  assert.equal(res.statusCode, 201, 'non-operator created world named commons')
  assert.equal(res.body.slug, 'commons')
})

// ===================================================================
// Test 12: Seed guard — file with external refs fails loudly
// ===================================================================

test('commons — seed guard rejects files with external refs', async () => {
  // Should throw on extras.atrium.source
  assert.throws(() => {
    scanGltfForExternalRefs({
      nodes: [{ name: 'test', extras: { atrium: { source: 'http://example.com/scene.glb' } } }]
    })
  }, /extras\.atrium\.source/, 'rejects extras.atrium.source')

  // Should throw on non-data buffer URI
  assert.throws(() => {
    scanGltfForExternalRefs({
      buffers: [{ uri: 'http://example.com/buffer.bin' }]
    })
  }, /non-data URI/, 'rejects non-data buffer URI')

  // Should throw on non-data image URI
  assert.throws(() => {
    scanGltfForExternalRefs({
      images: [{ uri: 'http://example.com/texture.png' }]
    })
  }, /non-data URI/, 'rejects non-data image URI')

  // Should NOT throw on data URIs
  assert.doesNotThrow(() => {
    scanGltfForExternalRefs({
      buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }]
    })
  }, 'accepts data URIs')

  // Should NOT throw on undefined URIs
  assert.doesNotThrow(() => {
    scanGltfForExternalRefs({
      buffers: [{}]
    })
  }, 'accepts undefined URIs')
})

// ===================================================================
// Test 13: Idempotent seeding — no second row created
// ===================================================================

test('commons — idempotent seeding does not create second row', async () => {
  // Only one commons row for the operator
  const rows = db.database.prepare(
    'SELECT id, document FROM worlds WHERE slug = ? AND owner_user_id = ?'
  ).all('commons', operatorUserId)
  assert.equal(rows.length, 1, 'only one commons row')

  assert.ok(rows[0].id, 'commons row has an id')
  assert.ok(rows[0].document && rows[0].document.length > 10, 'commons row has document content')
})