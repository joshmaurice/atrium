// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { Document, NodeIO } from '@gltf-transform/core'
import { AtriumClient } from '../src/AtriumClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

function waitForEvent(emitter, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for event "${event}"`)),
      timeoutMs
    )
    emitter.once(event, (data) => { clearTimeout(timer); resolve(data) })
    emitter.once('error', (err)  => { clearTimeout(timer); reject(err) })
  })
}

// ---------------------------------------------------------------------------
// loadWorldFromData — glTF JSON string
// ---------------------------------------------------------------------------

test('loadWorldFromData: glTF JSON string → SOM populated + world:loaded fires', async () => {
  const client = new AtriumClient()
  const loaded = waitForEvent(client, 'world:loaded')

  const gltfText = readFileSync(FIXTURE_PATH, 'utf8')
  await client.loadWorldFromData(gltfText, 'space.gltf')

  const data = await loaded
  assert.ok(client.som, 'client.som is set after load')
  assert.ok(Array.isArray(client.som.nodes), 'som.nodes is an array')
  assert.ok(client.som.nodes.length > 0, 'SOM has at least one node')
  assert.equal(data.name, 'Space', 'world:loaded carries the world name from extras')
})

// ---------------------------------------------------------------------------
// loadWorldFromData — GLB ArrayBuffer
// ---------------------------------------------------------------------------

test('loadWorldFromData: GLB ArrayBuffer → SOM populated + world:loaded fires', async () => {
  // Build a minimal GLB from a fresh Document using NodeIO (works in Node.js)
  const doc = new Document()
  const scene = doc.createScene('MinimalScene')
  const node = doc.createNode('Cube')
  scene.addChild(node)

  const io = new NodeIO()
  const glbBuffer = await io.writeBinary(doc)

  const client = new AtriumClient()
  const loaded = waitForEvent(client, 'world:loaded')

  await client.loadWorldFromData(glbBuffer.buffer, 'minimal.glb')

  await loaded
  assert.ok(client.som, 'client.som is set after GLB load')
  assert.ok(client.som.nodes.length > 0, 'SOM has at least one node from the GLB')
})

// ---------------------------------------------------------------------------
// peerCount getter
// ---------------------------------------------------------------------------

/** Build a SOMDocument with controllable ephemeral nodes and a local name. */
async function makeSomForPeerCount({ localName = null, ephemeralNames = [], staticNames = [] } = {}) {
  const doc = new Document()
  const scene = doc.createScene('Scene')

  for (const name of ephemeralNames) {
    const n = doc.createNode(name)
    n.setExtras({ atrium: { ephemeral: true } })
    scene.addChild(n)
  }
  for (const name of staticNames) {
    scene.addChild(doc.createNode(name))
  }

  const io = new NodeIO()
  const glb = await io.writeBinary(doc)

  const client = new AtriumClient()
  if (localName) client._displayName = localName   // simulate post-handshake state

  const loaded = waitForEvent(client, 'world:loaded')
  await client.loadWorldFromData(glb.buffer, 'test.glb')
  await loaded

  return client
}

test('peerCount: empty SOM → 0', async () => {
  const client = await makeSomForPeerCount()
  assert.strictEqual(client.peerCount, 0)
})

test('peerCount: only local avatar in SOM → 0 (local excluded)', async () => {
  const client = await makeSomForPeerCount({
    localName:      'User-abcd',
    ephemeralNames: ['User-abcd'],
  })
  assert.strictEqual(client.peerCount, 0)
})

test('peerCount: local avatar plus one peer → 1', async () => {
  const client = await makeSomForPeerCount({
    localName:      'User-abcd',
    ephemeralNames: ['User-abcd', 'User-ef01'],
  })
  assert.strictEqual(client.peerCount, 1)
})

test('peerCount: two peers, no local avatar yet (pre-handshake) → 2', async () => {
  // localName is null — _displayName not yet assigned
  const client = await makeSomForPeerCount({
    localName:      null,
    ephemeralNames: ['User-1111', 'User-2222'],
  })
  assert.strictEqual(client.peerCount, 2)
})

test('peerCount: non-ephemeral nodes are not counted', async () => {
  const client = await makeSomForPeerCount({
    localName:      'User-abcd',
    ephemeralNames: ['User-abcd'],
    staticNames:    ['ground', 'crate-01', 'crate-02'],
  })
  assert.strictEqual(client.peerCount, 0)
})

// ---------------------------------------------------------------------------
// wsOriginToHttpOrigin static
// ---------------------------------------------------------------------------

test('wsOriginToHttpOrigin: ws:// → http://', () => {
  assert.equal(AtriumClient.wsOriginToHttpOrigin('ws://localhost:3000'), 'http://localhost:3000')
})

test('wsOriginToHttpOrigin: wss:// → https://', () => {
  assert.equal(AtriumClient.wsOriginToHttpOrigin('wss://example.com'), 'https://example.com')
})

test('wsOriginToHttpOrigin: wss:// with path and port', () => {
  assert.equal(AtriumClient.wsOriginToHttpOrigin('wss://example.com:8443/path/to/world'), 'https://example.com:8443')
})

test('wsOriginToHttpOrigin: http:// passed through (non-ws scheme)', () => {
  assert.equal(AtriumClient.wsOriginToHttpOrigin('http://localhost:3000'), 'http://localhost:3000')
})

test('wsOriginToHttpOrigin: https:// passed through', () => {
  assert.equal(AtriumClient.wsOriginToHttpOrigin('https://example.com'), 'https://example.com')
})

test('wsOriginToHttpOrigin: null input → null', () => {
  assert.equal(AtriumClient.wsOriginToHttpOrigin(null), null)
})

test('wsOriginToHttpOrigin: empty string → null', () => {
  assert.equal(AtriumClient.wsOriginToHttpOrigin(''), null)
})

test('wsOriginToHttpOrigin: unparseable → null', () => {
  assert.equal(AtriumClient.wsOriginToHttpOrigin('not a url'), null)
})

// ---------------------------------------------------------------------------
// Connect timeout (pre-brief #4)
// ---------------------------------------------------------------------------

test('connect timeout: fires error then disconnected with reason timeout', async () => {
  // Synthetic WebSocket that never opens — triggers timeout
  let closeCalled = false
  const SynthNoopWS = function SynthNoopWS(url) {
    this.url = url
    this.readyState = 0
    this.on = () => {}  // EventEmitter-style API
    this.addEventListener = () => {}  // EventTarget fallback
    this.close = () => { closeCalled = true; this.readyState = 3 }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthNoopWS, connectTimeout: 50 })

  const events = []
  client.on('error', (err) => events.push({ type: 'error', message: err.message }))
  client.on('disconnected', (d) => events.push({ type: 'disconnected', reason: d.reason }))

  client.connect('ws://nowhere.example/')

  // Wait for timeout to fire
  await new Promise(r => setTimeout(r, 100))

  assert.equal(events.length, 2, 'error then disconnected')
  assert.equal(events[0].type, 'error', 'first event is error')
  assert.ok(events[0].message.includes('timeout'), 'error mentions timeout')
  assert.equal(events[1].type, 'disconnected', 'second event is disconnected')
  assert.equal(events[1].reason, 'timeout', 'disconnected reason is timeout')
  assert.equal(client.connected, false, 'client not connected after timeout')
})

test('connect timeout: timeout=0 disables timeout', async () => {
  const SynthNoopWS = function SynthNoopWS(url) {
    this.url = url
    this.readyState = 0
    this.on = () => {}
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }
  const client = new AtriumClient({ WebSocket: SynthNoopWS, connectTimeout: 0 })

  const events = []
  client.on('error', (e) => events.push(e))
  client.on('disconnected', (d) => events.push(d))

  client.connect('ws://nowhere.example/')
  await new Promise(r => setTimeout(r, 100))

  assert.equal(events.length, 0, 'no timeout events with connectTimeout=0')
})

test('connect timeout: session:ready clears the timeout', async () => {
  const handlers = {}

  // Synthetic WebSocket that connects and immediately receives hello
  const SynthInstantWS = function SynthInstantWS(url) {
    this.url = url
    this.readyState = 1  // OPEN
    this.send = () => {}
    this.close = () => { this.readyState = 3 }
    this.on = (evt, fn) => {
      handlers[evt] = fn
    }
    this.addEventListener = (evt, fn) => {
      handlers[evt] = fn
    }
  }

  const client = new AtriumClient({ WebSocket: SynthInstantWS, connectTimeout: 100 })

  const events = []
  client.on('error', (e) => events.push(e))
  client.on('disconnected', (d) => events.push(d))

  client.connect('ws://example.com/')

  // Trigger open so onOpen fires (sends hello), then deliver hello response
  if (handlers.open) {
    handlers.open()
  }

  // Deliver the server hello response through the message handler
  if (handlers.message) {
    handlers.message(JSON.stringify({ type: 'hello', id: 'test', seq: 1, serverTime: Date.now() }))
  }

  // Wait longer than the timeout — hello should have cleared it
  await new Promise(r => setTimeout(r, 200))

  assert.equal(events.length, 0, 'no timeout events when hello arrives before timeout')
})
