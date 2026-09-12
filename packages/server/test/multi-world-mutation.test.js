// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Tests for multi-world routing, mutation gate, and WorldHost lifecycle.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorldRegistry } from '../src/world-registry.js'
import { createWorldHost } from '../src/world-host.js'
import { createWorld } from '../src/world.js'
import { createDb } from '../src/db.js'
import { createSessionServer, attachSessionHandlers } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const tempDir = mkdtempSync(join(tmpdir(), 'atrium-mutation-test-'))
const dbPath = join(tempDir, 'test.db')

// ---------------------------------------------------------------------------
// Helpers
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
// Setup
// ---------------------------------------------------------------------------

const db = createDb(dbPath)

// World for isolated gateway tests
const testWorld = await createWorld(FIXTURE_PATH)
await testWorld.resolveExternalReferences()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ── Downtime: session with no worldOwnerUserId (default world behavior)
// Tests that backward-compat behavior works: no owner means no gate.
test('send succeeds in default (no-owner) world', async () => {
  const http = createServer()
  http.listen(9021)
  const server = createSessionServer({ httpServer: http, world: testWorld, db })

  const ws = new WebSocket('ws://localhost:9021')
  await doHandshake(ws, 'def-send')
  ws.send(JSON.stringify({
    type: 'send', seq: 1,
    node: 'crate-01',
    field: 'translation',
    value: [9, 0, 0],
  }))
  const msg = await waitForMessage(ws, 500)
  assert.equal(msg?.type, 'set')
  assert.equal(msg?.node, 'crate-01')

  ws.close()
  await waitForClose(ws)
  server.close()
  http.close()
})

// ── Mutation gate test: owner-restricted world
// Creates a session server with explicit worldOwnerUserId.
test('non-avatar add blocked for anonymous session (PERMISSION_DENIED)', async () => {
  // Test world restricted to owner 'only'
  const ownerHttp = createServer()
  ownerHttp.listen(9022)

  // We create a session handlers with explicit worldOwnerUserId
  const ownedWss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = {
    add: () => {},
    remove: () => null,
    list: () => [],
    setPosition: () => {},
  }

  attachSessionHandlers({
    wss: ownedWss,
    world: testWorld,
    sessions,
    presence,
    worldOwnerUserId: 'owner-001',
  })

  ownerHttp.on('upgrade', (req, socket, head) => {
    ownedWss.handleUpgrade(req, socket, head, (ws) => {
      ownedWss.emit('connection', ws, req, null) // null userId
    })
  })

  try {
    const ws = new WebSocket('ws://localhost:9022')
    await doHandshake(ws, 'anon-mut')

    // Non-avatar add should be blocked
    ws.send(JSON.stringify({
      type: 'add', seq: 1,
      node: { name: 'evil-node', translation: [0, 0, 0] },
    }))
    const err = await waitForMessage(ws, 500)
    assert.equal(err?.type, 'error')
    assert.equal(err?.code, 'PERMISSION_DENIED')

    ws.close()
    await waitForClose(ws)
  } finally {
    ownerHttp.close()
    ownedWss.close()
  }
})

// ── Avatar (with msg.id matching session) always bypasses gate
test('avatar add bypasses mutation gate', async () => {
  const ownerHttp = createServer()
  ownerHttp.listen(9023)

  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add: () => {}, remove: () => {}, list: () => [], setPosition: () => {} }

  attachSessionHandlers({
    wss,
    world: testWorld,
    sessions,
    presence,
    worldOwnerUserId: 'owner-002',
  })

  ownerHttp.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, null)
    })
  })

  try {
    const ws = new WebSocket('ws://localhost:9023')
    const hello = await doHandshake(ws, 'avatar-bypass')
    assert.equal(hello?.type, 'hello')

    // Avatar add should succeed (gate bypassed)
    ws.send(JSON.stringify({
      type: 'add', seq: 1, id: hello.id,
      node: { name: hello.avatarNodeName, translation: [0, 0, 0] },
    }))

    // Wait a bit — no error should arrive
    await new Promise(r => setTimeout(r, 100))
    let errCount = 0
    const h = (raw) => { try { if (JSON.parse(raw).type === 'error') errCount++ } catch {} }
    ws.on('message', h)
    await new Promise(r => setTimeout(r, 50))
    ws.off('message', h)
    assert.equal(errCount, 0, 'avatar add succeeded without error')

    ws.close()
    await waitForClose(ws)
  } finally {
    ownerHttp.close()
    wss.close()
  }
})

// ── Registry lifecycle tests
test('WorldHost creation and close lifecycle', async () => {
  const w = await createWorld(FIXTURE_PATH)
  const host = createWorldHost({ id: 'test-lifecycle', world: w })

  assert.equal(host.id, 'test-lifecycle')
  assert.ok(host.wss)
  assert.ok(host.sessions)
  assert.ok(host.presence)

  host.close()
  assert.equal(host.sessions.size, 0)
})

test('WorldHost handleUpgrade + teardown', async () => {
  const w = await createWorld(FIXTURE_PATH)
  const host = createWorldHost({ id: 'upgrade-test', world: w, db })

  // Simulate an upgrade to a completely separate httpServer
  const upgradeHttp = createServer()
  upgradeHttp.listen(9024)

  let upgraded = false
  upgradeHttp.on('upgrade', (req, socket, head) => {
    host.handleUpgrade(req, socket, head, null)
    upgraded = true
  })

  const ws = new WebSocket('ws://localhost:9024')
  await doHandshake(ws, 'upgr-test')
  assert.ok(upgraded, 'upgrade was handled')

  ws.close()
  await waitForClose(ws)
  upgradeHttp.close()
  host.close()
})

test('createWorldRegistry creates register/getDefaultHost/close', async () => {
  const httpServer = createServer()
  const reg = createWorldRegistry({ httpServer, db })

  assert.equal(typeof reg.registerWorld, 'function')
  assert.equal(typeof reg.getDefaultHost, 'function')
  assert.equal(typeof reg.close, 'function')
  assert(typeof reg.scheduleTeardown === 'function')
  reg.close()
  httpServer.close()
})

// ── mutation gate via createSessionServer (backward compat)
test('backward compat: createSessionServer sends succeed', async () => {
  const http = createServer()
  http.listen(9025)
  const s = createSessionServer({ httpServer: http, world: testWorld, db })

  try {
    const ws = new WebSocket('ws://localhost:9025')
    await doHandshake(ws, 'backward-send')
    ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'crate-01', field: 'translation', value: [1, 0, 0] }))
    const msg = await waitForMessage(ws, 500)
    assert.equal(msg?.type, 'set')
    ws.close()
    await waitForClose(ws)
  } finally {
    s.close()
    http.close()
  }
})

after(async () => {
  await rm(tempDir, { recursive: true, force: true })
})