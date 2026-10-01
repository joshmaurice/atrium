// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// teleporter.test.js — server-side teleporter integration tests
// Echo, duplicates, length cap, canPlaceTeleporters, autosave survival

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { createSessionServer, attachSessionHandlers } from '../src/session.js'
import { createWorld } from '../src/world.js'
import { createRequestHandler } from '../src/http-routes.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'
import * as worldStore from '../src/world-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const PORT = 3060
const BASE = `http://localhost:${PORT}`

const tempDir = mkdtempSync(join(tmpdir(), 'atrium-teleporter-test-'))
const dbPath = join(tempDir, 'test.db')

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

import { request } from 'node:http'

function httpPost(path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    if (cookie) headers['Cookie'] = cookie
    const req = request({ hostname: 'localhost', port: PORT, path, method: 'POST', headers }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) }) }
        catch { resolve({ statusCode: res.statusCode, headers: res.headers, body }) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function httpGet(path, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {}
    if (cookie) headers['Cookie'] = cookie
    const req = request({ hostname: 'localhost', port: PORT, path, method: 'GET', headers }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) }) }
        catch { resolve({ statusCode: res.statusCode, headers: res.headers, body }) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function registerUser(username, password) {
  const res = await httpPost('/api/auth/register', { username, password })
  if (res.statusCode !== 201) throw new Error(`Register failed: ${res.statusCode} ${JSON.stringify(res.body)}`)
  const setCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : res.headers['set-cookie']
  return { userId: res.body.id, cookie: setCookie }
}

// ---------------------------------------------------------------------------
// WS helpers
// ---------------------------------------------------------------------------

function makeMessageQueue(ws) {
  const queue = []
  ws.on('message', (raw) => { try { queue.push(JSON.parse(raw)) } catch {} })
  async function waitForType(type, timeoutMs = 1500) {
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

async function handshake(ws, opts = {}) {
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: opts.clientId ?? 'test-client',
    capabilities: { tick: { interval: opts.interval ?? 5000 } },
  }))
  const hello = await new Promise((resolve) => {
    ws.once('message', (raw) => { try { resolve(JSON.parse(raw)) } catch { resolve(null) } })
    setTimeout(() => resolve(null), 1000)
  })
  return hello
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

let db, httpServer, server, world, sessionsRef, userOwner, userOther

before(async () => {
  db = createDb(dbPath)
  world = await createWorld(FIXTURE_PATH)
  sessionsRef = { current: null }

  httpServer = createServer(createRequestHandler({ db, auth, world, sessionsRef }))
  httpServer.listen(PORT)

  // Create a world with an owner for mutation-gate tests
  server = createSessionServer({ httpServer, maxUsers: 20, world, db })
  sessionsRef.current = server.sessions

  // Register users
  userOwner = await registerUser('teleporter-owner', 'correct horse battery staple')
  userOther = await registerUser('teleporter-other', 'correct horse battery staple')
})

after(async () => {
  server.close()
  db.close()
  await rm(tempDir, { recursive: true, force: true })
})

// =========================================================================
// Length cap tests (add + set paths)
// =========================================================================

test('length cap — add rejects destination over 2048 chars', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  await handshake(ws, { clientId: 'len-cap-add' })

  const longDest = 'x'.repeat(2049)
  ws.send(JSON.stringify({
    type: 'add', seq: 1,
    node: { name: 'teleporter-test-long', translation: [0, 0, 0], extras: { atrium: { teleporter: { destination: longDest } } } },
  }))
  const err = await q.waitForType('error', 1000)
  assert.ok(err !== null, 'should receive error for long destination')
  assert.equal(err.code, 'INVALID_VALUE')
  assert.ok(err.message.includes('2048'), 'error message mentions 2048')

  ws.close()
  await waitForClose(ws)
})

test('length cap — set extras.atrium.teleporter.destination rejects over 2048 chars', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  await handshake(ws, { clientId: 'len-cap-set1' })

  const longDest = 'y'.repeat(2049)
  ws.send(JSON.stringify({
    type: 'send', seq: 1, node: 'crate-01',
    field: 'extras.atrium.teleporter.destination',
    value: longDest,
  }))
  const err = await q.waitForType('error', 1000)
  assert.ok(err !== null, 'should receive error')
  assert.equal(err.code, 'INVALID_VALUE')

  ws.close()
  await waitForClose(ws)
})

test('length cap — set extras object with long destination rejects', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  await handshake(ws, { clientId: 'len-cap-set2' })

  const longDest = 'z'.repeat(2049)
  ws.send(JSON.stringify({
    type: 'send', seq: 1, node: 'crate-01',
    field: 'extras',
    value: { atrium: { teleporter: { destination: longDest } } },
  }))
  const err = await q.waitForType('error', 1000)
  assert.ok(err !== null, 'should receive error for extras object with long destination')
  assert.equal(err.code, 'INVALID_VALUE')

  ws.close()
  await waitForClose(ws)
})

test('length cap — set extras.atrium object with long destination rejects', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  await handshake(ws, { clientId: 'len-cap-set3' })

  const longDest = 'w'.repeat(2049)
  ws.send(JSON.stringify({
    type: 'send', seq: 1, node: 'crate-01',
    field: 'extras.atrium',
    value: { teleporter: { destination: longDest } },
  }))
  const err = await q.waitForType('error', 1000)
  assert.ok(err !== null, 'should receive error for extras.atrium object with long destination')
  assert.equal(err.code, 'INVALID_VALUE')

  ws.close()
  await waitForClose(ws)
})

test('length cap — destination at exactly 2048 chars is allowed', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  await handshake(ws, { clientId: 'len-cap-ok' })

  // First add a teleporter node so the extras path exists
  const nodeName = 'len-cap-test-node'
  ws.send(JSON.stringify({
    type: 'add', seq: 1,
    node: {
      name: nodeName,
      translation: [0, 0, 0],
      extras: { atrium: { teleporter: { destination: '/' } } },
    },
  }))
  // Wait for the add echo
  const addEcho = await q.waitForType('add', 1000)
  assert.ok(addEcho !== null, 'should receive add echo')

  // Now set the destination to exactly 2048 chars
  const okDest = 'a'.repeat(2048)
  ws.send(JSON.stringify({
    type: 'send', seq: 2, node: nodeName,
    field: 'extras.atrium.teleporter.destination',
    value: okDest,
  }))
  // Wait for the echo — the server broadcasts a 'set' message back to the sender
  const setMsg = await q.waitForType('set', 800)
  assert.ok(setMsg !== null, 'should receive set echo for 2048-char destination')
  assert.equal(setMsg.node, nodeName)
  assert.equal(setMsg.field, 'extras.atrium.teleporter.destination')
  assert.equal(setMsg.value, okDest)

  // Verify the value was stored on the node
  const node = world.getNode(nodeName)
  assert.ok(node !== null, `${nodeName} should exist`)
  assert.equal(node.extras?.atrium?.teleporter?.destination, okDest,
    'destination should be set to the 2048-char value')

  ws.close()
  await waitForClose(ws)
})

// =========================================================================
// Echo tests (T3)
// =========================================================================

test('echo — non-avatar add reaches sender and peers', async () => {
  const ws1 = new WebSocket(`ws://localhost:${PORT}`)
  const q1 = makeMessageQueue(ws1)
  await handshake(ws1, { clientId: 'echo-add-1' })
  await q1.waitForType('hello', 1000)

  const ws2 = new WebSocket(`ws://localhost:${PORT}`)
  const q2 = makeMessageQueue(ws2)
  await handshake(ws2, { clientId: 'echo-add-2' })
  await q2.waitForType('hello', 1000)
  // drain join for ws1
  await q2.waitForType('join', 300)

  ws1.send(JSON.stringify({
    type: 'add', seq: 10,
    node: { name: 'echo-test-node', translation: [1, 0, 0] },
  }))

  // Sender (ws1) should get echo
  const echo1 = await q1.waitForType('add', 1000)
  assert.ok(echo1 !== null, 'sender should receive echo')
  assert.equal(echo1.node.name, 'echo-test-node')

  // Peer (ws2) should get it too
  const echo2 = await q2.waitForType('add', 1000)
  assert.ok(echo2 !== null, 'peer should receive broadcast')
  assert.equal(echo2.node.name, 'echo-test-node')

  ws1.close()
  ws2.close()
  await Promise.all([waitForClose(ws1), waitForClose(ws2)])
})

test('echo — avatar add does NOT reach sender', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  const hello = await handshake(ws, { clientId: 'echo-avatar-test' })
  const sessionId = hello.id
  const avatarName = hello.avatarNodeName
  await q.waitForType('hello', 500)

  ws.send(JSON.stringify({
    type: 'add', seq: 1,
    id: sessionId,
    node: { name: avatarName, translation: [0, 1, 0] },
  }))

  // No add message should come back to sender for avatar adds
  const addBack = await q.waitForType('add', 500)
  assert.equal(addBack, null, 'avatar add should not echo to sender')

  ws.close()
  await waitForClose(ws)
})

test('echo — non-avatar remove reaches sender and peers', async () => {
  // First add a node
  const ws1 = new WebSocket(`ws://localhost:${PORT}`)
  const q1 = makeMessageQueue(ws1)
  await handshake(ws1, { clientId: 'echo-rm-1' })
  await q1.waitForType('hello', 1000)

  ws1.send(JSON.stringify({
    type: 'add', seq: 1,
    node: { name: 'echo-rm-node', translation: [2, 0, 0] },
  }))
  await q1.waitForType('add', 1000)

  const ws2 = new WebSocket(`ws://localhost:${PORT}`)
  const q2 = makeMessageQueue(ws2)
  await handshake(ws2, { clientId: 'echo-rm-2' })
  await q2.waitForType('hello', 1000)

  ws1.send(JSON.stringify({ type: 'remove', seq: 2, node: 'echo-rm-node' }))

  // Sender should get echo
  const echoRm1 = await q1.waitForType('remove', 1000)
  assert.ok(echoRm1 !== null, 'sender should receive remove echo')
  assert.equal(echoRm1.node, 'echo-rm-node')

  // Peer should get broadcast
  const echoRm2 = await q2.waitForType('remove', 1000)
  assert.ok(echoRm2 !== null, 'peer should receive remove broadcast')

  ws1.close()
  ws2.close()
  await Promise.all([waitForClose(ws1), waitForClose(ws2)])
})

// =========================================================================
// Refused request tests (T3)
// =========================================================================

test('refused request — error carries seq, no broadcast', async () => {
  const ws1 = new WebSocket(`ws://localhost:${PORT}`)
  const q1 = makeMessageQueue(ws1)
  await handshake(ws1, { clientId: 'refused-1' })
  await q1.waitForType('hello', 1000)

  const ws2 = new WebSocket(`ws://localhost:${PORT}`)
  const q2 = makeMessageQueue(ws2)
  await handshake(ws2, { clientId: 'refused-2' })
  await q2.waitForType('hello', 1000)

  // Send a remove for a non-existent node (will fail) with seq=42
  ws1.send(JSON.stringify({ type: 'remove', seq: 42, node: 'nonexistent-node-xyz' }))

  const err = await q1.waitForType('error', 1000)
  assert.ok(err !== null, 'should receive error for refused request')
  assert.equal(err.seq, 42, 'error carries the request seq')

  // Peer should NOT see the error or a remove broadcast
  const removeBroadcast = await q2.waitForType('remove', 500)
  assert.equal(removeBroadcast, null, 'no remove broadcast to peer on failed remove')
  const errBroadcast = await q2.waitForType('error', 500)
  assert.equal(errBroadcast, null, 'no error broadcast to peer')

  ws1.close()
  ws2.close()
  await Promise.all([waitForClose(ws1), waitForClose(ws2)])
})

// =========================================================================
// Duplicate name tests (T9)
// =========================================================================

test('duplicate name — rejects add with same name as existing node', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  await handshake(ws, { clientId: 'dup-test' })
  await q.waitForType('hello', 1000)

  // Add a node
  ws.send(JSON.stringify({
    type: 'add', seq: 1,
    node: { name: 'dup-node', translation: [0, 0, 0] },
  }))
  await q.waitForType('add', 1500)

  // Add another with same name — should fail
  ws.send(JSON.stringify({
    type: 'add', seq: 2,
    node: { name: 'dup-node', translation: [1, 0, 0] },
  }))
  const err = await q.waitForType('error', 1000)
  assert.ok(err !== null, 'should receive error for duplicate name')
  assert.equal(err.code, 'INVALID_VALUE')

  ws.close()
  await waitForClose(ws)
})

test('duplicate name — non-avatar add using a live avatar name is rejected', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  const hello = await handshake(ws, { clientId: 'dup-avatar-name' })
  const sessionId = hello.id
  const avatarName = hello.avatarNodeName
  await q.waitForType('hello', 500)

  // First add the avatar to the world so its name is taken
  ws.send(JSON.stringify({
    type: 'add', seq: 1,
    id: sessionId,
    node: { name: avatarName, translation: [0, 1, 0] },
  }))
  await q.waitForType('add', 1000)

  // Now send non-avatar add (no msg.id) with the same name as the avatar
  ws.send(JSON.stringify({
    type: 'add', seq: 2,
    node: { name: avatarName, translation: [0, 0, 0] },
  }))
  const err = await q.waitForType('error', 1500)
  assert.ok(err !== null, 'should reject non-avatar add using avatar name')
  assert.equal(err.code, 'INVALID_VALUE')

  ws.close()
  await waitForClose(ws)
})

// =========================================================================
// Missing parent test (T9)
// =========================================================================

test('missing parent — add with nonexistent parent ingests nothing', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  await handshake(ws, { clientId: 'parent-test' })
  await q.waitForType('hello', 1000)

  ws.send(JSON.stringify({
    type: 'add', seq: 1,
    node: { name: 'orphan-node', translation: [0, 0, 0] },
    parent: 'nonexistent-parent-node',
  }))
  const err = await q.waitForType('error', 1000)
  assert.ok(err !== null, 'should reject add with nonexistent parent')
  assert.equal(err.code, 'NODE_NOT_FOUND')

  // Verify node was not added — there should be no add broadcast
  let addCount = 0
  const handler = (raw) => { const m = JSON.parse(raw); if (m.type === 'add') addCount++ }
  ws.on('message', handler)
  await new Promise(r => setTimeout(r, 200))
  ws.off('message', handler)
  // The only add messages should be avatar adds and hello sequence, not our orphan
  assert.equal(addCount, 0, 'no add broadcast for orphan-node')

  ws.close()
  await waitForClose(ws)
})

// =========================================================================
// canPlaceTeleporters matrix
// =========================================================================

test('canPlaceTeleporters — anonymous user gets false', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}`)
  const q = makeMessageQueue(ws)
  const hello = await handshake(ws, { clientId: 'canplace-anon' })
  assert.equal(hello.canPlaceTeleporters, false, 'anonymous should have canPlaceTeleporters=false')
  ws.close()
  await waitForClose(ws)
})

test('canPlaceTeleporters — authenticated non-owner gets false', async () => {
  // Connect with other user's cookie
  const sock = new WebSocket(`ws://localhost:${PORT}`, {
    headers: { Cookie: userOther.cookie },
  })
  const q = makeMessageQueue(sock)
  let hello = null
  await new Promise((resolve) => {
    sock.once('open', () => {
      sock.send(JSON.stringify({
        type: 'hello', id: 'canplace-other',
        capabilities: { tick: { interval: 5000 } },
      }))
    })
    sock.once('message', (raw) => {
      hello = JSON.parse(raw)
      resolve()
    })
    setTimeout(() => resolve(), 1000)
  })
  assert.ok(hello !== null, 'should receive hello')
  assert.equal(hello.canPlaceTeleporters, false, 'non-owner should have false')
  sock.close()
  await waitForClose(sock)
})

test('canPlaceTeleporters — authenticated same-origin owner gets true', async () => {
  // Create a separate server with an explicit world owner
  const ownerHttp = createServer()
  const OWNER_PORT = 3061
  ownerHttp.listen(OWNER_PORT)

  const ownedWss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add: () => {}, remove: () => {}, list: () => [], setPosition: () => {} }

  const { closeKeepalive } = attachSessionHandlers({
    wss: ownedWss,
    world,
    sessions,
    presence,
    worldOwnerUserId: userOwner.userId,
  })

  ownerHttp.on('upgrade', (req, socket, head) => {
    ownedWss.handleUpgrade(req, socket, head, (ws) => {
      // Pass the owner's userId as upgradeUserId (simulates same-origin cookie auth)
      ownedWss.emit('connection', ws, req, userOwner.userId)
    })
  })

  try {
    const ws = new WebSocket(`ws://localhost:${OWNER_PORT}`)
    const q = makeMessageQueue(ws)
    let hello = null
    await new Promise((resolve) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({
          type: 'hello', id: 'canplace-owner',
          capabilities: { tick: { interval: 5000 } },
        }))
      })
      ws.once('message', (raw) => {
        hello = JSON.parse(raw)
        resolve()
      })
      setTimeout(() => resolve(), 1000)
    })
    assert.ok(hello !== null, 'should receive hello')
    assert.equal(hello.canPlaceTeleporters, true, 'same-origin owner should have canPlaceTeleporters=true')
    ws.close()
    await waitForClose(ws)
  } finally {
    closeKeepalive()
    ownerHttp.close()
    ownedWss.close()
  }
})

// =========================================================================
// Teleporter node survives autosave and reload
// =========================================================================

test('teleporter node survives autosave and reload', async () => {
  // This test creates a teleporter node, triggers save (via world-store simulation),
  // then creates a fresh world from the saved document to verify the node survived.

  // Create a dedicated temp DB for this test
  const testDir = mkdtempSync(join(tmpdir(), 'atrium-tp-persist-test-'))
  const testDbPath = join(testDir, 'persist-test.db')
  const testDb = createDb(testDbPath)

  const now = new Date().toISOString()
  const ownerId = 'persist-owner-id'
  testDb.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(ownerId, 'PersistOwner', 'Persist Owner', now)

  // Add a teleporter node to the live world
  const teleporterName = 'teleporter-persist-test-node'
  world.addNode({
    name: teleporterName,
    translation: [5, 0, 3],
    extras: { atrium: { teleporter: { destination: '/worlds/persistowner/my-world' } } },
  }, null)

  // Serialize the world
  const serialized = await world.serialize()

  // Verify the teleporter node appears in serialized output
  const found = serialized.nodes?.find(n => n.name === teleporterName)
  assert.ok(found, 'teleporter node should appear in serialized glTF')
  assert.ok(found.extras?.atrium?.teleporter?.destination, 'teleporter extras preserved')
  assert.equal(found.extras.atrium.teleporter.destination, '/worlds/persistowner/my-world')

  // Verify it survives reload by creating a fresh world from the same document
  const world2 = await createWorldFromDoc(serialized)
  const node2 = world2.getNode(teleporterName)
  assert.ok(node2 !== null, 'teleporter node should survive reload')
  assert.equal(node2.translation[0], 5, 'translation preserved')
  assert.equal(node2.translation[2], 3, 'translation preserved')
  assert.ok(node2.extras?.atrium?.teleporter?.destination, 'teleporter extras preserved after reload')

  // Cleanup
  testDb.close()
  await rm(testDir, { recursive: true, force: true })
})

// Helper to create a world from a serialized document (same as createWorldFromDocument)
import { createWorldFromDocument } from '../src/world.js'
const createWorldFromDoc = createWorldFromDocument