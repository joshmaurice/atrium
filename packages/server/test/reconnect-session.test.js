// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

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
import { createSessionServer } from '../src/session.js'
import { createWorld } from '../src/world.js'
import { createRequestHandler } from '../src/http-routes.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const PORT = 3183

// Temporary database
const tempDir = mkdtempSync(join(tmpdir(), 'atrium-reconnect-test-'))
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
  async function waitForType(type, timeoutMs = 1000) {
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

function handshake(ws, opts = {}) {
  return new Promise((resolve) => {
    ws.send(JSON.stringify({
      type: 'hello',
      id: opts.clientId ?? 'test-client-' + Date.now(),
      capabilities: { tick: { interval: opts.interval ?? 5000 } },
    }))
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'hello') {
          ws.off('message', handler)
          resolve(msg)
        }
      } catch {}
    }
    ws.on('message', handler)
    // Timeout so the test doesn't hang if the server rejects
    setTimeout(() => { ws.off('message', handler); resolve(null) }, 2000)
  })
}

function extractCookie(res) {
  const cookieStr = Array.isArray(res.headers['set-cookie'])
    ? res.headers['set-cookie'].join('; ')
    : res.headers['set-cookie']
  return cookieStr
}

// ---------------------------------------------------------------------------
// Register helper
// ---------------------------------------------------------------------------
let _testCounter = 0
function freshUserTag() {
  return `r${process.pid}-${++_testCounter}`
}
async function registerUser(tag, password = 'correct horse battery staple') {
  const username = `${tag}-${freshUserTag()}`
  const res = await httpPost('/api/auth/register', { username, password })
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${JSON.stringify(res.body)}`)
  return {
    userId: res.body.id,
    username: res.body.username,
    cookieStr: extractCookie(res),
  }
}

// ---------------------------------------------------------------------------
// Server setup
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

// ===========================================================================
// Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// User registration helper smoke test
// ---------------------------------------------------------------------------

test('can register alice and bob for test setup', async () => {
  const alice = await registerUser('alice')
  const bob = await registerUser('bob')
  assert.ok(alice.cookieStr.includes('atrium_auth_session='), 'alice got cookie')
  assert.ok(bob.cookieStr.includes('atrium_auth_session='), 'bob got cookie')
})

// ---------------------------------------------------------------------------
// Item 1 eviction: same-user dedupe at hello
// ---------------------------------------------------------------------------

test('authenticated reconnect evicts stale session for same user', async () => {
  // Register a dedicated user for this test
  const { cookieStr } = await registerUser('evict')

  // Connect first session — authenticated
  const { ws: ws1, q: q1 } = websocketConnectWithHeaders({ Cookie: cookieStr })
  await waitForOpen(ws1)
  const hello1 = await handshake(ws1, { clientId: 'evict-test-1' })
  assert.equal(hello1.type, 'hello')
  const sessionId1 = hello1.id
  const avatarName1 = hello1.avatarNodeName

  // Connect alice #2 — same cookie, should evict ws1
  const { ws: ws2, q: q2 } = websocketConnectWithHeaders({ Cookie: cookieStr })
  await waitForOpen(ws2)
  const hello2 = await handshake(ws2, { clientId: 'evict-test-2' })
  const sessionId2 = hello2.id

  // ws1 should have been closed by the eviction
  await waitForClose(ws1)

  // ws1's session should be gone from server state
  assert.ok(!server.sessions.has(sessionId1), 'evicted session should be removed from sessions map')
  assert.ok(!server.presence.has(sessionId1), 'evicted session should be removed from presence')

  // The avatar node should have been removed from world
  const avatarNode = world.getNode(avatarName1)
  assert.equal(avatarNode, null, 'avatar node should be removed from world')

  // ws2 should be fully functional — its session should exist
  assert.ok(server.sessions.has(sessionId2), 'new session should be in sessions map')
  assert.equal(ws2.readyState, WebSocket.OPEN, 'new session should still be open')

  ws2.close()
  await waitForClose(ws2)
})

test('cross-user connection does not evict different user session', async () => {
  const userA = await registerUser('cross-a')
  const userB = await registerUser('cross-b')

  const { ws: wsA, q: qA } = websocketConnectWithHeaders({ Cookie: userA.cookieStr })
  await waitForOpen(wsA)
  const helloA = await handshake(wsA, { clientId: 'cross-a-1' })
  assert.equal(helloA.type, 'hello')
  const sessionIdA = helloA.id

  const { ws: wsB, q: qB } = websocketConnectWithHeaders({ Cookie: userB.cookieStr })
  await waitForOpen(wsB)
  await handshake(wsB, { clientId: 'cross-b-1' })

  await new Promise(r => setTimeout(r, 100))
  assert.ok(server.sessions.has(sessionIdA), 'user A session should still exist after user B connects')
  assert.equal(wsA.readyState, WebSocket.OPEN, 'user A WS should still be open')

  wsA.close()
  wsB.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB)])
})

test('anonymous session must not be evicted by another anonymous connection', async () => {
  const { ws: ws1, q: q1 } = websocketConnectWithHeaders({})
  await waitForOpen(ws1)
  const hello1 = await handshake(ws1, { clientId: 'anon-1' })
  const sessionId1 = hello1.id

  const { ws: ws2, q: q2 } = websocketConnectWithHeaders({})
  await waitForOpen(ws2)
  await handshake(ws2, { clientId: 'anon-2' })

  await new Promise(r => setTimeout(r, 100))
  assert.ok(server.sessions.has(sessionId1), 'anonymous session should not be evicted')
  assert.equal(ws1.readyState, WebSocket.OPEN, 'anonymous WS should still be open')

  ws1.close()
  ws2.close()
  await Promise.all([waitForClose(ws1), waitForClose(ws2)])
})

test('client cannot trigger eviction of unrelated session via crafted hello', async () => {
  // The eviction loop keys on upgradeUserId, which is resolved server-side
  // from the auth cookie. No client-controlled field feeds it. This test
  // confirms: attacker connects with their own cookie (legitimate auth),
  // their hello does NOT reach the eviction loop's trigger condition because
  // upgradeUserId is attacker's, not the target's.
  const target = await registerUser('target')
  const attacker = await registerUser('attacker')

  const { ws: wsTarget } = websocketConnectWithHeaders({ Cookie: target.cookieStr })
  await waitForOpen(wsTarget)
  const hello = await handshake(wsTarget, { clientId: 'target-main' })
  const sessionIdTarget = hello.id

  // Attacker connects with their own cookie — different upgradeUserId.
  // Use a unique clientId so hello passes the duplicate-sessionId check
  // and reaches the eviction loop.
  const { ws: wsAttacker } = websocketConnectWithHeaders({ Cookie: attacker.cookieStr })
  await waitForOpen(wsAttacker)
  await handshake(wsAttacker, { clientId: 'attacker-own-id-1' })

  await new Promise(r => setTimeout(r, 100))
  // Target's session must survive — attacker has a different userId
  assert.ok(server.sessions.has(sessionIdTarget), 'target session must survive attacker connect')
  assert.equal(wsTarget.readyState, WebSocket.OPEN, 'target WS must remain open')

  wsTarget.close()
  wsAttacker.close()
  await Promise.all([waitForClose(wsTarget), waitForClose(wsAttacker)])
})

test('bystander observes exactly one remove+leave after eviction (no double broadcast)', async () => {
  const userX = await registerUser('userx')
  const bystander = await registerUser('bypass')

  const { ws: wsB, q: qB } = websocketConnectWithHeaders({ Cookie: bystander.cookieStr })
  await waitForOpen(wsB)
  await handshake(wsB, { clientId: 'bystander-1' })

  const { ws: wsX1 } = websocketConnectWithHeaders({ Cookie: userX.cookieStr })
  await waitForOpen(wsX1)
  const helloX1 = await handshake(wsX1, { clientId: 'userx-1' })
  const sessionIdX1 = helloX1.id
  const avatarNameX1 = helloX1.avatarNodeName

  wsX1.send(JSON.stringify({
    type: 'add', seq: 1,
    id: sessionIdX1,
    node: { name: avatarNameX1, translation: [0, 0, 0] },
  }))

  await new Promise(r => setTimeout(r, 200))

  const { ws: wsX2 } = websocketConnectWithHeaders({ Cookie: userX.cookieStr })
  await waitForOpen(wsX2)
  await handshake(wsX2, { clientId: 'userx-2' })

  const removeMsg = await qB.waitForType('remove', 2000)
  assert.ok(removeMsg !== null, 'bystander should receive remove')
  assert.equal(removeMsg.id, sessionIdX1, 'remove should reference evicted session id')

  const leaveMsg = await qB.waitForType('leave', 1000)
  assert.ok(leaveMsg !== null, 'bystander should receive leave')
  assert.equal(leaveMsg.id, sessionIdX1, 'leave should reference evicted session id')

  const secondRemove = await qB.waitForType('remove', 300)
  assert.equal(secondRemove, null, 'remove should not be broadcast a second time')
  const secondLeave = await qB.waitForType('leave', 300)
  assert.equal(secondLeave, null, 'leave should not be broadcast a second time')

  wsB.close()
  wsX2.close()
  await Promise.all([waitForClose(wsB), waitForClose(wsX2)])
})

// ---------------------------------------------------------------------------
// Item 2 regression: hello handler race
// ---------------------------------------------------------------------------

function createSlowWorld(baseWorld, delayMs) {
  // Proxy that delays only serialize() — all other methods pass through.
  // Used to force the hello handler's async serialize() call to be slow,
  // so concurrent hellos reliably interleave.
  return new Proxy(baseWorld, {
    get(target, prop) {
      if (prop === 'serialize') {
        return async () => {
          await new Promise(r => setTimeout(r, delayMs))
          return target.serialize()
        }
      }
      return target[prop]
    },
  })
}

function registerOnPort(port, tag, password = 'correct horse battery staple') {
  const username = `${tag}-${freshUserTag()}`
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username, password })
    const req = request(
      { hostname: 'localhost', port, path: '/api/auth/register', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          if (res.statusCode !== 201) return reject(new Error(`register failed: ${res.statusCode}`))
          const cookieStr = Array.isArray(res.headers['set-cookie'])
            ? res.headers['set-cookie'].join('; ') : res.headers['set-cookie']
          resolve({ userId: JSON.parse(body).id, cookieStr })
        })
      })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

test('concurrent hellos with delayed serialize — all peers complete bootstrap', async () => {
  const RACE_PORT = 3184
  // Connect 3 clients with staggered but overlapping hello timing while
  // world.serialize() is delayed by 300ms. The delay forces the async
  // serialize() to be in-flight when subsequent hellos arrive, testing
  // that the reordered handler (presence + joins before som-dump) prevents
  // any session from being observed as half-registered.
  const originalWorld = await createWorld(FIXTURE_PATH)
  const slowWorld = createSlowWorld(originalWorld, 300)
  const raceDb = createDb(join(tempDir, 'race.db'))
  const raceHttp = createServer(createRequestHandler({ db: raceDb, auth }))
  const slowServer = createSessionServer({ httpServer: raceHttp, maxUsers: 20, world: slowWorld, db: raceDb })
  raceHttp.listen(RACE_PORT)

  const userA = await registerOnPort(RACE_PORT, 'race-a')
  const userB = await registerOnPort(RACE_PORT, 'race-b')
  const userC = await registerOnPort(RACE_PORT, 'race-c')

  function wsConnect(port, headers) {
    const w = new WebSocket(`ws://localhost:${port}`, { headers })
    const q = makeMessageQueue(w)
    return { ws: w, q }
  }

  const { ws: wsA, q: qA } = wsConnect(RACE_PORT, { Cookie: userA.cookieStr })
  await waitForOpen(wsA)
  const helloA = await handshake(wsA, { clientId: 'race-a-1' })
  const idA = helloA.id

  // Send B's hello while A's serialize is still in-flight
  await new Promise(r => setTimeout(r, 50))
  const { ws: wsB, q: qB } = wsConnect(RACE_PORT, { Cookie: userB.cookieStr })
  await waitForOpen(wsB)
  const helloB = await handshake(wsB, { clientId: 'race-b-1' })

  // Send C's hello while both A and B are still awaiting serialize
  await new Promise(r => setTimeout(r, 50))
  const { ws: wsC, q: qC } = wsConnect(RACE_PORT, { Cookie: userC.cookieStr })
  await waitForOpen(wsC)
  const helloC = await handshake(wsC, { clientId: 'race-c-1' })

  // Wait for all serialize delays to resolve and broadcast data to land
  await new Promise(r => setTimeout(r, 800))

  // A should have received bootstrap joins for B and C
  const joinBfromA = qA.waitForType('join', 500)
  const joinCfromA = qA.waitForType('join', 500)

  // B should have received A's join and C's join
  const joinAfromB = qB.waitForType('join', 500)
  const joinCfromB = qB.waitForType('join', 500)

  // C should have received bootstrap joins for A and B
  const joinAfromC = qC.waitForType('join', 500)
  const joinBfromC = qC.waitForType('join', 500)

  const results = await Promise.all([
    joinBfromA, joinCfromA,
    joinAfromB, joinCfromB,
    joinAfromC, joinBfromC,
  ])
  for (let i = 0; i < results.length; i++) {
    assert.ok(results[i] !== null, `all peers should receive joins — result ${i} was null`)
  }

  // All sessions must be in presence
  assert.ok(slowServer.presence.has(idA), 'A should be present')
  assert.ok(slowServer.presence.has(helloB.id), 'B should be present')
  assert.ok(slowServer.presence.has(helloC.id), 'C should be present')

  wsA.close()
  wsB.close()
  wsC.close()
  await Promise.all([waitForClose(wsA), waitForClose(wsB), waitForClose(wsC)])
})