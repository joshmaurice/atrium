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

test('connect timeout: fires error then disconnected with reason timeout (pinned #4 order)', async () => {
  // Synthetic WebSocket that never opens — triggers timeout.
  // Once close() is called while CONNECTING, the socket later fires
  // its own error and close events (as a browser's WebSocket does).
  // Those must NOT produce additional events.
  let closeCalled = false
  let closeCallback = null
  let errorCallback = null
  const SynthBrowserWS = function SynthBrowserWS(url) {
    this.url = url
    this.readyState = 0  // CONNECTING
    this.on = (evt, fn) => {
      if (evt === 'close') closeCallback = fn
      if (evt === 'error') errorCallback = fn
    }
    this.addEventListener = () => {}
    this.close = () => {
      closeCalled = true
      this.readyState = 3  // CLOSED
      // Browser-style: fire error then close after close() on CONNECTING
      if (errorCallback) setTimeout(errorCallback, 5)
      if (closeCallback) setTimeout(closeCallback, 10)
    }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthBrowserWS, connectTimeout: 50 })

  const events = []
  client.on('error', (err) => events.push({ type: 'error', message: err.message, sessionId: err.sessionId }))
  client.on('disconnected', (d) => events.push({ type: 'disconnected', reason: d.reason, sessionId: d.sessionId }))

  const sid = client.connect('ws://nowhere.example/')

  // Wait for timeout to fire and any browser-style late events
  await new Promise(r => setTimeout(r, 200))

  assert.equal(events.length, 2, 'exactly 2 events: error then disconnected')
  assert.equal(events[0].type, 'error', 'first event is error')
  assert.ok(events[0].message.includes('nowhere.example'), 'error mentions target host')
  assert.equal(events[0].sessionId, sid, 'error has sessionId')
  assert.equal(events[1].type, 'disconnected', 'second event is disconnected')
  assert.equal(events[1].reason, 'timeout', 'disconnected reason is timeout')
  assert.equal(events[1].sessionId, sid, 'disconnected has sessionId')
  assert.equal(client.connected, false, 'client not connected after timeout')
  assert.ok(closeCalled, 'ws.close() was called')
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

// ---------------------------------------------------------------------------
// Event contract (pre-brief #4) — socket errors, close reason, code
// ---------------------------------------------------------------------------

test('socket error event carries sessionId and url', async () => {
  const SynthErrWS = function SynthErrWS(url) {
    this.url = url
    this.readyState = 0
    this.on = (evt, fn) => { if (evt === 'error') setTimeout(fn, 10) }
    this.addEventListener = (evt, fn) => { if (evt === 'error') setTimeout(fn, 10) }
    this.close = () => {}
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthErrWS, connectTimeout: 0 })
  const errorPromise = new Promise(resolve => client.once('error', resolve))

  const sid = client.connect('wss://error-test.example/')
  const err = await errorPromise

  assert.equal(err.sessionId, sid, 'error has sessionId')
  assert.equal(err.url, 'wss://error-test.example/', 'error has url')
  assert.ok(err.message.includes('error-test.example'), 'error mentions host')
})

test('server error message carries sessionId, url and code', async () => {
  const handlers = {}
  const SynthWS = function SynthWS(url) {
    this.url = url
    this.readyState = 1
    this.on = (evt, fn) => { handlers[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthWS, connectTimeout: 0 })
  const errorPromise = new Promise(resolve => client.once('error', resolve))

  const sid = client.connect('wss://server-err.example/')

  if (handlers.message) {
    handlers.message(JSON.stringify({ type: 'error', code: 'PERMISSION_DENIED', message: 'Not allowed' }))
  }

  const err = await errorPromise
  assert.equal(err.sessionId, sid, 'server error has sessionId')
  assert.equal(err.url, 'wss://server-err.example/', 'server error has url')
  assert.equal(err.code, 'PERMISSION_DENIED', 'server error has code property')
  assert.ok(err.message.includes('PERMISSION_DENIED'), 'server error message includes code')
})

test('disconnected from server close carries reason closed and code', async () => {
  const handlers = {}
  const closeCode = 1000
  const SynthWS = function SynthWS(url) {
    this.url = url
    this.readyState = 1
    this.on = (evt, fn) => { handlers[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthWS, connectTimeout: 0 })
  const discPromise = new Promise(resolve => client.once('disconnected', resolve))

  const sid = client.connect('wss://close-test.example/')

  if (handlers.close) {
    handlers.close(closeCode, 'Server shutting down')
  }

  const disc = await discPromise
  assert.equal(disc.sessionId, sid, 'disconnected has sessionId')
  assert.equal(disc.url, 'wss://close-test.example/', 'disconnected has url')
  assert.equal(disc.reason, 'closed', 'reason is closed by default')
  assert.equal(disc.code, 1000, 'close code is carried')
  assert.equal(disc.closeReason, 'Server shutting down', 'close reason string is carried')
})

test('disconnected with no close args still gives reason closed', async () => {
  const handlers = {}
  const SynthWS = function SynthWS(url) {
    this.url = url
    this.readyState = 1
    this.on = (evt, fn) => { handlers[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthWS, connectTimeout: 0 })
  const discPromise = new Promise(resolve => client.once('disconnected', resolve))

  client.connect('wss://close-test2.example/')

  if (handlers.close) {
    handlers.close()
  }

  const disc = await discPromise
  assert.equal(disc.reason, 'closed', 'reason is closed even with no args')
})

// ---------------------------------------------------------------------------
// F3: sessionId filtering (used by trackConnect, pre-brief #5)
// ---------------------------------------------------------------------------

test('session:ready carries sessionId matching the connect call', async () => {
  const handlers = {}
  const SynthWS = function SynthWS(url) {
    this.url = url
    this.readyState = 1
    this.on = (evt, fn) => { handlers[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthWS, connectTimeout: 0 })
  const readyPromise = new Promise(resolve => client.once('session:ready', resolve))

  const sid = client.connect('wss://ready-id-test.example/')

  // Trigger open -> hello response
  if (handlers.open) handlers.open()
  if (handlers.message) {
    handlers.message(JSON.stringify({
      type: 'hello',
      id: sid,
      seq: 1,
      serverTime: Date.now(),
    }))
  }

  const ready = await readyPromise
  assert.equal(ready.sessionId, sid, 'session:ready carries the sessionId')
})

test('connecting with previousSessionId event (used for superseded detection)', async () => {
  const handlersA = {}
  const SynthWSA = function SynthWSA(url) {
    this.url = url
    this.readyState = 0
    this.on = (evt, fn) => { handlersA[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthWSA, connectTimeout: 0 })
  const connectingEvents = []
  client.on('connecting', (d) => connectingEvents.push(d))

  const sid1 = client.connect('wss://connect-a.example/')
  assert.equal(typeof sid1, 'string', 'first connect returns session id')

  // Connect again — this should emit connecting with previousSessionId = sid1
  const handlersB = {}
  const SynthWSB = function SynthWSB(url) {
    this.url = url
    this.readyState = 0
    this.on = (evt, fn) => { handlersB[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }
  client._WSImpl = SynthWSB

  const sid2 = client.connect('wss://connect-b.example/')
  assert.equal(typeof sid2, 'string', 'second connect returns session id')

  // Should have gotten connecting events, second one with previousSessionId
  const lastConnecting = connectingEvents[connectingEvents.length - 1]
  assert.ok(lastConnecting, 'connecting event fired')
  assert.equal(lastConnecting.previousSessionId, sid1, 'connecting has previousSessionId matching first connect')
})

// ---------------------------------------------------------------------------
// F5: _onServerHello sets _avatarDescriptor.extras.displayName (pre-brief #9)
// ---------------------------------------------------------------------------

test('F5: _onServerHello with displayName sets avatar descriptor extras', async () => {
  const handlers = {}
  const SynthWS = function SynthWS(url) {
    this.url = url
    this.readyState = 1
    this.on = (evt, fn) => { handlers[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthWS, connectTimeout: 0 })
  const readyPromise = new Promise(resolve => client.once('session:ready', resolve))

  client.connect('wss://f5-displayname-test.example/', {
    avatar: { name: 'test-avatar', extras: {} },
  })

  // Trigger open -> hello response with server-assigned displayName
  if (handlers.open) handlers.open()
  if (handlers.message) {
    handlers.message(JSON.stringify({
      type: 'hello',
      id: 'f5-test',
      seq: 1,
      serverTime: Date.now(),
      displayName: 'ServerName',
    }))
  }

  await readyPromise

  // After session:ready, _avatarDescriptor should carry the server name
  const desc = client._avatarDescriptor
  assert.ok(desc, 'avatar descriptor exists')
  assert.ok(desc.extras, 'avatar extras exist')
  assert.equal(desc.extras.displayName, 'ServerName',
    'avatar extras.displayName is set from server hello displayName')
})

// ---------------------------------------------------------------------------
// F3: Later connect's session:ready does not resolve earlier trackConnect
// ---------------------------------------------------------------------------

test('session:ready from later connect does not resolve earlier trackConnect', async () => {
  // Synthetic WebSocket that creates separate instances per connect call.
  // Each instance stores its own event handlers and message buffer.
  let instanceCount = 0
  const instances = []
  function SynthWSSeq(url) {
    this.url = url
    this.readyState = 0
    const idx = instanceCount++
    instances[idx] = {
      events: {},
      readyState: 0,
      close() { this.readyState = 3 },
      send() {},
    }
    this.on = (evt, fn) => { instances[idx].events[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }

  const client = new AtriumClient({ WebSocket: SynthWSSeq, connectTimeout: 0 })

  // Track promises like trackConnect would
  let resolve1 = null
  let resolve2 = null
  const track1 = new Promise(r => { resolve1 = r })
  const track2 = new Promise(r => { resolve2 = r })

  let superseded1 = false

  // First connect
  const sid1 = client.connect('wss://server-a.example/')

  // Set up trackConnect-like handlers for the first connect
  const onReady1 = (data) => {
    if (data.sessionId !== sid1) return
    resolve1({ source: 'session:ready', data })
  }
  const onConnecting1 = (d) => {
    if (d.previousSessionId === sid1) {
      superseded1 = true
      resolve1({ source: 'connecting (superseded)' })
    }
  }
  client.on('session:ready', onReady1)
  client.on('connecting', onConnecting1)

  // Open first WS -> start hello
  if (instances[0] && instances[0].events.open) {
    instances[0].events.open()
  }
  // Simulate server hello for sid1
  if (instances[0] && instances[0].events.message) {
    instances[0].events.message(JSON.stringify({
      type: 'hello',
      id: sid1,
      seq: 1,
      serverTime: Date.now(),
      displayName: 'User-sid1',
    }))
  }

  // Drain — sid1's session:ready should have fired
  await new Promise(r => setImmediate(r))
  // Clear the handler so we can test cleanly
  client.off('session:ready', onReady1)
  client.off('connecting', onConnecting1)

  // Set up a fresh handler set for a second connect
  let resolve1b = null
  const track1b = new Promise(r => { resolve1b = r })
  const onReady1b = (data) => {
    if (data.sessionId !== sid1) return // should NOT match sid2
    resolve1b({ source: 'session:ready — WRONG: sid2 resolved sid1' })
  }
  client.on('session:ready', onReady1b)

  // Second connect — should NOT resolve the first track
  const sid2 = client.connect('wss://server-b.example/')

  // The connecting event from sid2 should NOT resolve sid1's track
  // (sid1 already got session:ready, so its listeners are consumed)

  // Open second WS -> start hello
  if (instances[1] && instances[1].events.open) {
    instances[1].events.open()
  }
  // Simulate server hello for sid2
  if (instances[1] && instances[1].events.message) {
    instances[1].events.message(JSON.stringify({
      type: 'hello',
      id: sid2,
      seq: 1,
      serverTime: Date.now(),
      displayName: 'User-sid2',
    }))
  }

  // Wait for sid2's session:ready to fire
  await new Promise(r => setTimeout(r, 50))
  client.off('session:ready', onReady1b)

  // The onReady1b handler should NOT have fired (sid1's event is done)
  // since session:ready for sid2 has sessionId=sid2
  // We cannot directly assert the handler didn't fire via a promise,
  // so we verify that a race against track1b times out (meaning it was never resolved)
  let sid1GotWrongReady = false
  const check1b = await Promise.race([
    track1b.then(() => { sid1GotWrongReady = true }),
    new Promise(r => setTimeout(() => r('timeout'), 50)),
  ])
  assert.equal(sid1GotWrongReady, false,
    'sid2 session:ready should NOT trigger sid1 handler (sessionId filter works)')
  assert.equal(sid1 !== sid2, true, 'sid1 and sid2 are different session ids')
})
