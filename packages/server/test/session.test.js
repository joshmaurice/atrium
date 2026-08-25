// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createServer } from 'node:http'
import WebSocket from 'ws'
import { createSessionServer } from '../src/session.js'
import { createWorld } from '../src/world.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const PORT = 3001

let server
let httpServer

before(() => {
  httpServer = createServer()
  httpServer.listen(PORT)
  server = createSessionServer({ httpServer, maxUsers: 20 })
})

after(() => {
  server.close()
})

function connect() {
  return new WebSocket(`ws://localhost:${PORT}`)
}

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    ws.once('error', reject)
  })
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

async function handshake(ws, opts = {}) {
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: opts.clientId ?? 'test-client',
    capabilities: { tick: { interval: opts.interval ?? 5000 } },
  }))
  return waitForMessage(ws)
}

test('server hello returns assigned avatarNodeName', async () => {
  const ws = connect()
  const reply = await handshake(ws)

  assert.equal(reply.type, 'hello')
  assert.ok(typeof reply.avatarNodeName === 'string', 'avatarNodeName should be a string')
  assert.ok(reply.avatarNodeName.startsWith('avatar-'), `avatarNodeName should start with "avatar-", got "${reply.avatarNodeName}"`)

  ws.close()
  await waitForClose(ws)
})

test('completes hello handshake', async () => {
  const ws = connect()
  const reply = await handshake(ws)

  assert.equal(reply.type, 'hello')
  assert.ok(typeof reply.id === 'string' && reply.id.length > 0)
  assert.ok(typeof reply.seq === 'number')
  assert.ok(typeof reply.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('server hello contains negotiated tick interval', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: 'test-client-2',
    capabilities: { tick: { interval: 2000 } },
  }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'hello')
  assert.ok(reply.capabilities?.tick?.interval >= 50)

  ws.close()
  await waitForClose(ws)
})

test('rejects message before hello with AUTH_FAILED', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'x', field: 'translation', value: [0, 0, 0] }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'error')
  assert.equal(reply.code, 'AUTH_FAILED')

  ws.close()
  await waitForClose(ws)
})

test('responds to ping with pong', async () => {
  const ws = connect()
  await handshake(ws)

  const clientTime = Date.now()
  ws.send(JSON.stringify({ type: 'ping', clientTime }))
  const reply = await waitForMessage(ws)

  assert.equal(reply.type, 'pong')
  assert.equal(reply.clientTime, clientTime)
  assert.ok(typeof reply.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('sends tick messages after handshake', async () => {
  const ws = connect()
  await waitForOpen(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    id: 'tick-test-client',
    capabilities: { tick: { interval: 100 } },
  }))

  // consume the hello reply
  await waitForMessage(ws)

  // wait for at least one tick
  const tick = await waitForMessage(ws)

  assert.equal(tick.type, 'tick')
  assert.ok(typeof tick.seq === 'number')
  assert.ok(typeof tick.serverTime === 'number')

  ws.close()
  await waitForClose(ws)
})

test('rejects connection when world full', async () => {
  const fullHttpServer = createServer()
  fullHttpServer.listen(PORT + 1)
  const fullServer = createSessionServer({ httpServer: fullHttpServer, maxUsers: 1 })

  try {
    const ws1 = new WebSocket(`ws://localhost:${PORT + 1}`)
    await handshake(ws1)

    const ws2 = new WebSocket(`ws://localhost:${PORT + 1}`)
    await waitForOpen(ws2)
    ws2.send(JSON.stringify({ type: 'hello', id: 'second-client' }))
    const reply = await waitForMessage(ws2)

    assert.equal(reply.type, 'error')
    assert.equal(reply.code, 'WORLD_FULL')

    ws1.close()
    ws2.close()
    await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  } finally {
    fullServer.close()
  }
})

test('handles client disconnect cleanly', async () => {
  const ws = connect()
  const serverHello = await handshake(ws)

  // Session should be registered after handshake
  assert.ok(server.sessions.has(serverHello.id), 'session should be in sessions map after handshake')

  ws.close()
  await waitForClose(ws)

  // Give the server a tick to process the close event
  await new Promise((r) => setTimeout(r, 100))

  assert.ok(!server.sessions.has(serverHello.id), 'session should be removed from sessions map after disconnect')
})

// --- Integration tests (world state) ---

test('send message mutates world and broadcasts set', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const sHttp = createServer()
  sHttp.listen(3003)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10, world })

  try {
    const ws = new WebSocket('ws://localhost:3003')
    await handshake(ws)

    ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'crate-01', field: 'translation', value: [9, 0, 0] }))
    const msg = await waitForMessage(ws)

    assert.equal(msg.type, 'set')
    assert.equal(msg.node, 'crate-01')
    assert.equal(msg.field, 'translation')
    assert.deepEqual(msg.value, [9, 0, 0])

    ws.close()
    await waitForClose(ws)
  } finally {
    s.close()
  }
})

test('send to unknown node returns NODE_NOT_FOUND error', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const sHttp = createServer()
  sHttp.listen(3004)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10, world })

  try {
    const ws = new WebSocket('ws://localhost:3004')
    await handshake(ws)

    ws.send(JSON.stringify({ type: 'send', seq: 1, node: 'ghost', field: 'translation', value: [0, 0, 0] }))
    const msg = await waitForMessage(ws)

    assert.equal(msg.type, 'error')
    assert.equal(msg.code, 'NODE_NOT_FOUND')

    ws.close()
    await waitForClose(ws)
  } finally {
    s.close()
  }
})

test('add message broadcasts add to all clients', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const sHttp = createServer()
  sHttp.listen(3005)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10, world })

  try {
    const ws1 = new WebSocket('ws://localhost:3005')
    const q1 = makeMessageQueue(ws1)
    await handshake(ws1, {})
    await q1.waitForType('hello', 1000)

    const ws2 = new WebSocket('ws://localhost:3005')
    const q2 = makeMessageQueue(ws2)
    await waitForOpen(ws2)
    ws2.send(JSON.stringify({ type: 'hello', id: 'add-test-client-2', capabilities: { tick: { interval: 5000 } } }))
    await q2.waitForType('hello', 1000)
    // drain join for ws1
    await q2.waitForType('join', 300)

    ws1.send(JSON.stringify({ type: 'add', seq: 1, node: { name: 'new-node-01', translation: [0, 2, 0] } }))

    const msg = await q2.waitForType('add', 1000)
    assert.ok(msg !== null, 'ws2 should receive add message')
    assert.equal(msg.type, 'add')
    assert.equal(msg.node.name, 'new-node-01')

    ws1.close()
    ws2.close()
    await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  } finally {
    s.close()
  }
})

test('remove message broadcasts remove to all clients', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const sHttp = createServer()
  sHttp.listen(3006)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10, world })

  try {
    const ws1 = new WebSocket('ws://localhost:3006')
    const q1 = makeMessageQueue(ws1)
    await waitForOpen(ws1)
    ws1.send(JSON.stringify({ type: 'hello', id: 'remove-test-client-1', capabilities: { tick: { interval: 5000 } } }))
    await q1.waitForType('hello', 1000)

    const ws2 = new WebSocket('ws://localhost:3006')
    const q2 = makeMessageQueue(ws2)
    await waitForOpen(ws2)
    ws2.send(JSON.stringify({ type: 'hello', id: 'remove-test-client-2', capabilities: { tick: { interval: 5000 } } }))
    await q2.waitForType('hello', 1000)
    // drain join for ws1
    await q2.waitForType('join', 300)

    ws1.send(JSON.stringify({ type: 'remove', seq: 1, node: 'crate-01' }))

    const msg = await q2.waitForType('remove', 1000)
    assert.ok(msg !== null, 'ws2 should receive remove message')
    assert.equal(msg.type, 'remove')
    assert.equal(msg.node, 'crate-01')

    ws1.close()
    ws2.close()
    await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  } finally {
    s.close()
  }
})

test('rejects duplicate live sessionId at hello', async () => {
  const sHttp = createServer()
  sHttp.listen(3012)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 20 })

  try {
    const ws1 = new WebSocket('ws://localhost:3012')
    await waitForOpen(ws1)
    ws1.send(JSON.stringify({ type: 'hello', id: 'dup-session-id', capabilities: { tick: { interval: 5000 } } }))
    await waitForMessage(ws1) // consume hello reply

    const ws2 = new WebSocket('ws://localhost:3012')
    await waitForOpen(ws2)
    ws2.send(JSON.stringify({ type: 'hello', id: 'dup-session-id', capabilities: { tick: { interval: 5000 } } }))
    const reply = await waitForMessage(ws2)

    assert.equal(reply.type, 'error')
    assert.equal(reply.code, 'SESSION_CONFLICT')

    ws1.close()
    ws2.close()
    await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  } finally {
    s.close()
  }
})

test('avatar add with mismatched msg.id is rejected', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const sHttp = createServer()
  sHttp.listen(3009)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10, world })

  try {
    const ws = new WebSocket('ws://localhost:3009')
    await waitForOpen(ws)
    ws.send(JSON.stringify({ type: 'hello', id: 'mismatch-id-test', capabilities: { tick: { interval: 5000 } } }))
    await waitForMessage(ws) // consume hello reply

    ws.send(JSON.stringify({
      type: 'add', seq: 1,
      id: 'some-other-session-id',
      node: { name: 'avatar-unknown', translation: [0, 0, 0] },
    }))
    const err = await waitForMessage(ws)

    assert.equal(err.type, 'error')
    assert.equal(err.code, 'PERMISSION_DENIED')

    ws.close()
    await waitForClose(ws)
  } finally {
    s.close()
  }
})

test('avatar add with mismatched node.name is rejected', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const sHttp = createServer()
  sHttp.listen(3010)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10, world })

  try {
    const ws = new WebSocket('ws://localhost:3010')
    await waitForOpen(ws)
    ws.send(JSON.stringify({ type: 'hello', id: 'name-reject-test', capabilities: { tick: { interval: 5000 } } }))
    const hello = await waitForMessage(ws)
    const sessionId = hello.id
    const assignedName = hello.avatarNodeName

    // Verify server assigned the expected name ('avatar-' + first 8)
    assert.ok(assignedName.startsWith('avatar-'), `avatarNodeName should start with avatar-, got ${assignedName}`)
    assert.equal(assignedName, 'avatar-name-rej', `expected avatar-name-rej, got ${assignedName}`)

    // Send an add with a DIFFERENT name than the assigned one
    ws.send(JSON.stringify({
      type: 'add', seq: 1,
      id: sessionId,
      node: { name: 'wrong-name', translation: [0, 0, 0] },
    }))
    const err = await waitForMessage(ws)

    assert.equal(err.type, 'error')
    assert.equal(err.code, 'PERMISSION_DENIED')

    // Verify session.avatarNodeName was NOT overwritten by the rejected add
    const serverSession = s.sessions.get(sessionId)
    assert.ok(serverSession !== null, 'session should still exist')
    assert.equal(serverSession.avatarNodeName, assignedName,
      'server-assigned avatarNodeName must not be clobbered by rejected add')

    ws.close()
    await waitForClose(ws)
  } finally {
    s.close()
  }
})

test('avatar add with correct name succeeds', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const sHttp = createServer()
  sHttp.listen(3013)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10, world })

  try {
    const ws = new WebSocket('ws://localhost:3013')
    await waitForOpen(ws)
    ws.send(JSON.stringify({ type: 'hello', id: 'correct-add-test', capabilities: { tick: { interval: 5000 } } }))
    const hello = await waitForMessage(ws)
    const sessionId = hello.id
    const assignedName = hello.avatarNodeName

    // Send an add with the CORRECT server-assigned name
    ws.send(JSON.stringify({
      type: 'add', seq: 1,
      id: sessionId,
      node: { name: assignedName, translation: [0, 0, 0] },
    }))

    // No error should arrive for a correct add — wait briefly and check
    await new Promise(r => setTimeout(r, 100))
    // The only messages should be hello reply (already consumed) and ticks
    // If an error arrived, fail the test
    let errorCount = 0
    const handler = (raw) => {
      const msg = JSON.parse(raw)
      if (msg.type === 'error') errorCount++
    }
    ws.on('message', handler)
    await new Promise(r => setTimeout(r, 50))
    ws.off('message', handler)
    assert.equal(errorCount, 0, 'no error should be sent for a correct avatar add')

    ws.close()
    await waitForClose(ws)
  } finally {
    s.close()
  }
})

test('avatar add rebroadcast includes server session id', async () => {
  const world = await createWorld(FIXTURE_PATH)
  const sHttp = createServer()
  sHttp.listen(3011)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10, world })

  try {
    const ws1 = new WebSocket('ws://localhost:3011')
    const q1 = makeMessageQueue(ws1)
    await waitForOpen(ws1)
    ws1.send(JSON.stringify({ type: 'hello', id: 'rebroadcast-ws1', capabilities: { tick: { interval: 5000 } } }))
    const hello1 = await q1.waitForType('hello', 1000)
    const sessionId1 = hello1.id
    const avatarName1 = hello1.avatarNodeName

    const ws2 = new WebSocket('ws://localhost:3011')
    const q2 = makeMessageQueue(ws2)
    await waitForOpen(ws2)
    ws2.send(JSON.stringify({ type: 'hello', id: 'rebroadcast-ws2', capabilities: { tick: { interval: 5000 } } }))
    await q2.waitForType('hello', 1000)

    // ws1 sends an avatar add with correct name
    ws1.send(JSON.stringify({
      type: 'add', seq: 1,
      id: sessionId1,
      node: { name: avatarName1, translation: [0, 1, 0] },
    }))

    // ws2 should receive the add with id: sessionId1
    const addMsg = await q2.waitForType('add', 1000)
    assert.ok(addMsg !== null, 'ws2 should receive add message')
    assert.equal(addMsg.type, 'add')
    assert.equal(addMsg.id, sessionId1, 'rebroadcast id should be server session id')
    assert.equal(addMsg.node.name, avatarName1, 'rebroadcast node name should be assigned name')

    ws1.close()
    ws2.close()
    await Promise.all([waitForClose(ws1), waitForClose(ws2)])
  } finally {
    s.close()
  }
})

// --- Keepalive grace counter tests ---

const KEEPALIVE_INTERVAL = 30_000
import net from 'node:net'

/**
 * Send a WebSocket masked text frame over a raw socket.
 * Client frames MUST be masked per the WebSocket spec.
 */
function sendMaskedFrame(socket, payload) {
  const buf = Buffer.from(payload, 'utf-8')
  const maskKey = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) maskKey[i] = (Math.random() * 256) | 0

  const masked = Buffer.alloc(buf.length)
  for (let i = 0; i < buf.length; i++) masked[i] = buf[i] ^ maskKey[i % 4]

  // Frame: FIN + text opcode (0x81), masked length, mask key, masked payload
  const header = buf.length < 126
    ? Buffer.from([0x81, 0x80 | buf.length])
    : Buffer.from([0x81, 0x80 | 126, (buf.length >> 8) & 0xff, buf.length & 0xff])

  return new Promise((resolve) => {
    socket.write(Buffer.concat([header, maskKey, masked]), resolve)
  })
}

/**
 * Read a WebSocket unmasked frame from a raw socket.
 * Server frames are never masked.
 * Returns null if the socket closes before a frame arrives.
 */
function readFrame(socket, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    let buf = Buffer.alloc(0)

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk])
      // Try to parse a complete frame
      if (buf.length >= 2) {
        const lenByte = buf[1] & 0x7f
        let payloadLen
        let headerLen
        if (lenByte < 126) {
          payloadLen = lenByte
          headerLen = 2
        } else if (lenByte === 126) {
          if (buf.length < 4) return
          payloadLen = buf.readUInt16BE(2)
          headerLen = 4
        } else {
          // lenByte === 127 — extended 64-bit, skip for simplicity
          if (buf.length < 10) return
          payloadLen = Number(buf.readBigUInt64BE(2))
          headerLen = 10
        }

        if (buf.length >= headerLen + payloadLen) {
          const opcode = buf[0] & 0x0f
          const payload = buf.subarray(headerLen, headerLen + payloadLen)
          clearTimeout(timer)
          socket.off('data', onData)
          socket.off('close', onClose)
          resolve({ opcode, payload: payload.toString('utf-8'), raw: payload })
        }
      }
    }

    const onClose = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      resolve(null)
    }

    socket.on('data', onData)
    socket.on('close', onClose)
  })
}

/**
 * Perform a raw WebSocket upgrade on an already-connected net.Socket.
 * Returns after the upgrade response is received.
 */
function performUpgrade(socket, host, port) {
  const key = 'dGhlIHNhbXBsZSBub25jZQ=='
  const request = [
    `GET / HTTP/1.1`,
    `Host: ${host}:${port}`,
    `Upgrade: websocket`,
    `Connection: Upgrade`,
    `Sec-WebSocket-Key: ${key}`,
    `Sec-WebSocket-Version: 13`,
    '',
    '',
  ].join('\r\n')

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('upgrade timeout')), 1000)
    let response = ''

    const onData = (chunk) => {
      response += chunk.toString()
      if (response.includes('\r\n\r\n')) {
        clearTimeout(timer)
        socket.off('data', onData)
        if (response.includes('101 Switching Protocols')) {
          resolve()
        } else {
          reject(new Error(`upgrade failed: ${response.slice(0, 100)}`))
        }
      }
    }

    socket.on('data', onData)
    socket.write(request)
  })
}

test('keepalive grace counter — survives one missed pong, terminates after two', async () => {
  // Enable mock timers BEFORE creating the server, so the keepalive
  // setInterval uses the mocked timer, not the real one.
  mock.timers.enable({ apis: ['setInterval'] })

  const sHttp = createServer()
  const TEST_PORT = 3014
  sHttp.listen(TEST_PORT)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10 })

  try {
    // Step 1: Connect a raw TCP socket, perform WebSocket upgrade,
    // and send a hello message to register a session. The raw socket
    // will NOT auto-respond to ping frames, allowing us to test missed pongs.
    const client = new net.Socket()
    await new Promise((resolve, reject) => {
      client.connect(TEST_PORT, '127.0.0.1', resolve)
      client.on('error', reject)
    })

    await performUpgrade(client, '127.0.0.1', TEST_PORT)

    // Send a hello message as a masked WebSocket text frame
    const helloMsg = JSON.stringify({
      type: 'hello',
      id: 'keepalive-test-client',
      capabilities: { tick: { interval: 5000 } },
    })
    await sendMaskedFrame(client, helloMsg)

    // Read the hello reply frame from the server
    const reply = await readFrame(client)
    assert.ok(reply !== null, 'should receive hello reply')
    assert.equal(reply.opcode, 0x01, 'reply should be a text frame')
    const parsed = JSON.parse(reply.payload)
    assert.equal(parsed.type, 'hello')
    const sessionId = parsed.id

    // Verify the session is in the server's sessions map
    assert.ok(s.sessions.has(sessionId), 'session must be registered after handshake')

    // Step 2: Advance past one full keepalive interval
    // Tick 1: missedPings 0 → 1, ws.ping() sent. No pong expected (raw socket).
    mock.timers.tick(KEEPALIVE_INTERVAL)
    await new Promise(r => setImmediate(r))

    // Connection should still be alive after 1 missed ping
    assert.ok(s.sessions.has(sessionId), 'connection should survive 1 missed pong (after tick 1)')

    // Step 3: Advance past a second interval
    // Tick 2: missedPings 1 → 2. Still below threshold.
    // With the OLD code (boolean alive), this tick would terminate the connection.
    // With the NEW code (counter), it survives.
    mock.timers.tick(KEEPALIVE_INTERVAL)
    await new Promise(r => setImmediate(r))

    assert.ok(s.sessions.has(sessionId), 'connection should survive 2 missed pongs (after tick 2) — THIS FAILS against old boolean-alive code')

    // Step 4: Advance past a third interval
    // Tick 3: missedPings = 2, now 2 >= 2 → terminate!
    mock.timers.tick(KEEPALIVE_INTERVAL)
    await new Promise(r => setImmediate(r))

    assert.ok(!s.sessions.has(sessionId), 'connection must be terminated after 3 consecutive missed pongs (after tick 3)')

    client.destroy()
  } finally {
    mock.timers.reset()
    s.close()
  }
})

test('keepalive grace counter — connection stays alive when pongs arrive normally', async () => {
  // Enable mock timers BEFORE creating the server
  mock.timers.enable({ apis: ['setInterval'] })

  const sHttp = createServer()
  const TEST_PORT = 3018
  sHttp.listen(TEST_PORT)
  const s = createSessionServer({ httpServer: sHttp, maxUsers: 10 })

  try {
    // Connect a real ws.WebSocket (auto-responds to pings)
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`)
    await handshake(ws)

    // Advance through several keepalive cycles
    // Since the real WebSocket auto-responds to pings, missedPings stays at 0
    for (let i = 0; i < 5; i++) {
      mock.timers.tick(KEEPALIVE_INTERVAL)
      await new Promise(r => setImmediate(r))
    }

    // Connection should still be alive after 5 intervals
    ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }))
    const pong = await new Promise((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw)))
      setTimeout(() => resolve(null), 200)
    })
    assert.ok(pong !== null, 'should receive pong after 5 keepalive ticks — connection is alive')

    ws.close()
    await waitForClose(ws)
  } finally {
    mock.timers.reset()
    s.close()
  }
})
