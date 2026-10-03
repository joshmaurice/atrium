// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'http'
import WebSocket, { WebSocketServer } from 'ws'
import { AtriumClient } from '../src/AtriumClient.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForEvent(emitter, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for "${event}"`)),
      timeoutMs
    )
    emitter.once(event, (data) => { clearTimeout(timer); resolve(data) })
    emitter.once('error', (err)  => { clearTimeout(timer); reject(err) })
  })
}

function waitForWsOpen(clientWs) {
  return new Promise((resolve, reject) => {
    if (clientWs.readyState === WebSocket.OPEN) return resolve()
    clientWs.once('open', resolve)
    clientWs.once('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Shared WS package server — created once in before(), closed in after()
// ---------------------------------------------------------------------------

let sharedHttp
let sharedWss
let sharedPort
/** @type {(ws: WebSocket) => void|null} */
let connectionHandler = null

before(async () => {
  sharedHttp = createServer()
  sharedWss = new WebSocketServer({ noServer: true })
  sharedHttp.on('upgrade', (req, socket, head) => {
    sharedWss.handleUpgrade(req, socket, head, (ws) => {
      if (connectionHandler) connectionHandler(ws)
    })
  })
  await new Promise(resolve => sharedHttp.listen(0, resolve))
  sharedPort = sharedHttp.address().port
})

after(() => {
  connectionHandler = null
  if (sharedWss) {
    for (const client of sharedWss.clients) {
      try { client.terminate() } catch {}
    }
    sharedWss.close()
  }
  if (sharedHttp) sharedHttp.close()
})

// ---------------------------------------------------------------------------
// Test 1: ws package — close with 1008 and reason
// ---------------------------------------------------------------------------

test('close-code: ws package 1008 with reason', async () => {

  connectionHandler = (serverWs) => {
    // After the client connects, close with 1008 + reason
    serverWs.close(1008, 'policy')
  }

  const client = new AtriumClient({ WebSocket, connectTimeout: 0 })
  const disconnected = waitForEvent(client, 'disconnected')
  client.connect(`ws://localhost:${sharedPort}`)

  const data = await disconnected
  assert.equal(data.code, 1008, 'code should be 1008')
  assert.equal(data.closeReason, 'policy', 'closeReason should be "policy"')
})

// ---------------------------------------------------------------------------
// Test 2: ws package — close with 1008, no reason
// ---------------------------------------------------------------------------

test('close-code: ws package 1008 no reason', async () => {

  connectionHandler = (serverWs) => {
    serverWs.close(1008)
  }

  const client = new AtriumClient({ WebSocket, connectTimeout: 0 })
  const disconnected = waitForEvent(client, 'disconnected')
  client.connect(`ws://localhost:${sharedPort}`)

  const data = await disconnected
  assert.equal(data.code, 1008, 'code should be 1008')
  assert.strictEqual(data.closeReason, undefined, 'closeReason should be undefined')
})

// ---------------------------------------------------------------------------
// Test 3: globalThis.WebSocket — 1008 with reason (skip if undefined)
// ---------------------------------------------------------------------------

test('close-code: globalThis.WebSocket 1008 with reason', { skip: typeof globalThis.WebSocket === 'undefined' ? 'globalThis.WebSocket is undefined' : false }, async () => {
  assert.ok(typeof globalThis.WebSocket !== 'undefined', 'globalThis.WebSocket is defined')
  assert.ok(typeof globalThis.WebSocket.on !== 'function', 'globalThis.WebSocket has no .on method (EventTarget shape)')

  connectionHandler = (serverWs) => {
    serverWs.close(1008, 'policy')
  }

  const client = new AtriumClient({ connectTimeout: 0 })
  const disconnected = waitForEvent(client, 'disconnected')
  client.connect(`ws://localhost:${sharedPort}`)

  const data = await disconnected
  assert.equal(data.code, 1008, 'code should be 1008')
  assert.equal(data.closeReason, 'policy', 'closeReason should be "policy"')
})

// ---------------------------------------------------------------------------
// Test 4: globalThis.WebSocket — 1008 no reason (skip if undefined)
// ---------------------------------------------------------------------------

test('close-code: globalThis.WebSocket 1008 no reason', { skip: typeof globalThis.WebSocket === 'undefined' ? 'globalThis.WebSocket is undefined' : false }, async () => {
  assert.ok(typeof globalThis.WebSocket !== 'undefined', 'globalThis.WebSocket is defined')
  assert.ok(typeof globalThis.WebSocket.on !== 'function', 'globalThis.WebSocket has no .on method (EventTarget shape)')

  connectionHandler = (serverWs) => {
    serverWs.close(1008)
  }

  const client = new AtriumClient({ connectTimeout: 0 })
  const disconnected = waitForEvent(client, 'disconnected')
  client.connect(`ws://localhost:${sharedPort}`)

  const data = await disconnected
  assert.equal(data.code, 1008, 'code should be 1008')
  assert.strictEqual(data.closeReason, undefined, 'closeReason should be undefined')
})

// ---------------------------------------------------------------------------
// Test 5: EventTarget-based fake (no .on method)
// ---------------------------------------------------------------------------

test('close-code: EventTarget fake dispatch close event with code and reason', async () => {
  // Fake WebSocket that extends EventTarget, has addEventListener but no .on method
  class FakeWebSocket extends EventTarget {
    constructor() {
      super()
      this.readyState = 1  // OPEN
    }
    addEventListener(event, fn) {
      super.addEventListener(event, fn)
    }
    close() {}
    send() {}
    // No .on method — intentionally missing
  }

  const client = new AtriumClient({ WebSocket: FakeWebSocket, connectTimeout: 0 })
  const disconnected = waitForEvent(client, 'disconnected')

  client.connect('ws://fake')

  // Dispatch a close event carrying code and reason
  const evt = new Event('close')
  evt.code = 1008
  evt.reason = 'boom'
  client._connectionRecord.ws.dispatchEvent(evt)

  const data = await disconnected
  assert.equal(data.code, 1008, 'code should be 1008 from event')
  assert.equal(data.closeReason, 'boom', 'closeReason should be "boom" from event')
})