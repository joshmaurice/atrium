// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// script-runner-4d.test.js — scripting-4d-1 round 2, step 4 (G5, the rest):
// `AtriumClient` sends `scriptRunner: 3`, the cross-origin hello carries NO
// `scriptRunner` key and is accepted by the THREE frozen server schemas (the
// pre-4b-2 one, 4b-2's `71b6e40b`, and the 4c release `14ab0076` that a 4d page
// may meet on PROD), and `client.canSend()` — the runner's send opportunity —
// is true exactly when the world is loaded and the socket is OPEN.
//
// The hello shapes are produced by the REAL `AtriumClient` on a mock socket
// (every message is the one the client would put on the wire), and the frozen
// schemas are compiled the way the SERVER compiles its own (Ajv, strict:
// false) from the byte-for-byte copies in `tests/fixtures/protocol-compat/`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { Document, NodeIO } from '@gltf-transform/core'
import { validate } from '@atrium/protocol'
import { AtriumClient } from '../src/AtriumClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMPAT = resolve(__dirname, '../../../tests/fixtures/protocol-compat')
const FROZEN = ['hello.client.pre-4b-2.json', 'hello.client.71b6e40b.json', 'hello.client.14ab0076.json']

const requireFromProtocol = createRequire(resolve(__dirname, '../../protocol/package.json'))
const AjvModule = requireFromProtocol('ajv')
const Ajv = AjvModule.default ?? AjvModule

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

class MockWebSocket {
  constructor() { this.readyState = 1; this.sent = []; this._handlers = {} }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
  of(type) { return this.sent.filter((m) => m.type === type) }
}

function makeClient({ scriptRunner = false } = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock', { scriptRunner })
  client._sessionId = 'session-4dtest'
  return { client, mock: mocks[0] }
}

async function handshake(client, mock, { scriptHost = false } = {}) {
  mock.simulateMessage({
    type: 'hello', id: client._sessionId, seq: 1,
    avatarNodeName: 'avatar-4d', displayName: 'User-4d',
    serverTime: Date.now(), canPlaceTeleporters: true, canEdit: true,
    signedIn: false, scriptHost, ...(scriptHost ? { hostGen: 1 } : {}),
    capabilities: { tick: { interval: 1000 } },
  })
  await delay(5)
}

async function loadWorld(client, mock) {
  const doc = new Document()
  doc.createScene('Scene')
  const { json } = await new NodeIO().writeJSON(doc)
  mock.simulateMessage({ type: 'som-dump', seq: 2, gltf: json })
  await delay(20)
}

// ===========================================================================
// The hello
// ===========================================================================

test('G5: with scriptRunner the hello carries 3 and is a valid 4d client hello', () => {
  const { mock } = makeClient({ scriptRunner: true })
  mock._fire('open')
  const hello = mock.of('hello')[0]
  assert.equal(hello.capabilities.scriptRunner, 3, 'the wire says 3: the election requires 3')
  assert.equal(validate('client', hello).valid, true, 'the current schema accepts it')
})

test('G5: a cross-origin hello carries NO scriptRunner key and the THREE frozen server schemas accept it', () => {
  const { mock } = makeClient()
  mock._fire('open')
  const hello = mock.of('hello')[0]
  assert.equal('scriptRunner' in hello.capabilities, false, 'the key is absent, not 0 and not 2')
  assert.equal(validate('client', hello).valid, true, 'and it is still a valid hello')

  const ajv = new Ajv({ strict: false })
  for (const name of FROZEN) {
    const check = ajv.compile(JSON.parse(readFileSync(resolve(COMPAT, name), 'utf8')))
    assert.equal(check(hello), true,
      `${name} must accept the exact cross-origin hello this 4d client sends: ${JSON.stringify(check.errors)}`)
  }

  // Sanity: all three predate `3`, so a hello carrying it is refused by each —
  // which is exactly why the key rides only a same-origin connection.
  for (const name of FROZEN) {
    const check = ajv.compile(JSON.parse(readFileSync(resolve(COMPAT, name), 'utf8')))
    assert.equal(check({ ...hello, capabilities: { ...hello.capabilities, scriptRunner: 3 } }), false,
      `${name} refuses scriptRunner: 3`)
  }
})

// ===========================================================================
// canSend() — the runner's send opportunity
// ===========================================================================

test('G5: canSend() is false before world:loaded, true after, and false once the socket is CLOSING', async () => {
  const { client, mock } = makeClient()
  mock._fire('open')

  assert.equal(client.canSend(), false, 'before session:ready there is no world and no open socket yet')

  await handshake(client, mock)
  assert.equal(client.canSend(), false, 'session:ready alone is not a loaded world')

  await loadWorld(client, mock)
  assert.equal(client.canSend(), true, 'a loaded world on an OPEN socket can send')

  // The socket goes CLOSING: no send may be made.
  mock.readyState = 3
  assert.equal(client.canSend(), false, 'a closed socket cannot send')
})

test('G5: canSend() drops to false when the connection is torn down', async () => {
  const { client, mock } = makeClient()
  mock._fire('open')
  await handshake(client, mock)
  await loadWorld(client, mock)
  assert.equal(client.canSend(), true)

  client.disconnect()
  assert.equal(client.canSend(), false, 'after disconnect there is no world and no open socket')
})
