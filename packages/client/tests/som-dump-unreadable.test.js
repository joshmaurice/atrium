// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// add-check A10 — the client says when it can't read a dump: `_onSomDump`
// catches the `readJSON` failure, logs it, builds NO SOM, and emits `error`
// with `code: 'WORLD_UNREADABLE'`, its `sessionId` and `url`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AtriumClient } from '../src/AtriumClient.js'

function waitForEvent(emitter, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs)
    emitter.once(event, (data) => { clearTimeout(timer); resolve(data) })
  })
}

function synthClient(handlers) {
  const SynthWS = function SynthWS(url) {
    this.url = url
    this.readyState = 1
    this.on = (evt, fn) => { handlers[evt] = fn }
    this.addEventListener = () => {}
    this.close = () => { this.readyState = 3 }
    this.send = () => {}
  }
  return new AtriumClient({ WebSocket: SynthWS, connectTimeout: 0 })
}

async function connectClient(handlers, client) {
  const readyPromise = waitForEvent(client, 'session:ready')
  const sid = client.connect('wss://unreadable-dump.example/w/worlds/josh/room')
  handlers.open()
  handlers.message(JSON.stringify({ type: 'hello', id: sid, seq: 1, serverTime: Date.now() }))
  await readyPromise
  return sid
}

test('A10: an unreadable som-dump emits error WORLD_UNREADABLE and builds no SOM', async () => {
  const handlers = {}
  const client = synthClient(handlers)
  const errorPromise = waitForEvent(client, 'error')

  const sid = await connectClient(handlers, client)

  // A document that will not read back.
  handlers.message(JSON.stringify({
    type: 'som-dump', seq: 2,
    gltf: { asset: { version: '9.9' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ name: 'bad' }] },
  }))

  const err = await errorPromise
  assert.equal(err.code, 'WORLD_UNREADABLE')
  assert.equal(err.sessionId, sid)
  assert.equal(err.url, 'wss://unreadable-dump.example/w/worlds/josh/room')
  assert.equal(client.som, undefined, 'no SOM is built')

  client.disconnect()
})

test('A10: a readable som-dump behaves as today (no WORLD_UNREADABLE)', async () => {
  const handlers = {}
  const client = synthClient(handlers)
  const errors = []
  client.on('error', (e) => errors.push(e))

  await connectClient(handlers, client)

  handlers.message(JSON.stringify({
    type: 'som-dump', seq: 2,
    gltf: {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }], scene: 0,
      nodes: [{ name: 'good' }],
    },
  }))

  await new Promise((r) => setTimeout(r, 50))
  assert.equal(errors.length, 0, errors.map((e) => e.code).join(','))
  assert.ok(client.som, 'the SOM is built')

  client.disconnect()
})
