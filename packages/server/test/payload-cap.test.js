// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// payload-cap — Phase 3 server-cleanup, L9/K7 (§7.1): the WebSocket server
// closes with 1009 when an established, authorized connection sends a message
// over the 1 MiB cap, the node is not added and no other client sees anything.
// Real server on port 0, real world; no mocks.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
import { createWorld } from '../src/world.js'
import { createSessionServer } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

// L9/K7 — the cap, as the named constant in session.js.
const MAX_PAYLOAD_BYTES = 1048576

const closers = []
after(async () => {
  for (const close of closers.reverse()) {
    try { await close() } catch { /* best effort */ }
  }
})

const delay = (ms) => new Promise(r => setTimeout(r, ms))

function listen(http) {
  return new Promise((res, rej) => {
    http.once('error', rej)
    http.listen(0, '127.0.0.1', () => res(http.address().port))
  })
}

async function startServer(world) {
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

function waitForOpen(ws) {
  return new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) return res()
    ws.once('open', res)
    ws.once('error', rej)
  })
}

function waitForClose(ws) {
  return new Promise((res) => {
    if (ws.readyState === WebSocket.CLOSED) return res()
    ws.once('close', res)
  })
}

function collect(ws) {
  const messages = []
  ws.on('message', (raw) => {
    try { messages.push(JSON.parse(raw)) } catch { /* ignore */ }
  })
  return messages
}

async function waitFor(messages, pred, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = messages.find(pred)
    if (found) return found
    await delay(10)
  }
  return null
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  return { ws, messages }
}

async function hello(ws, messages, id) {
  ws.send(JSON.stringify({
    type: 'hello', id,
    capabilities: { tick: { interval: 5000 } },
  }))
  const reply = await waitFor(messages, m => m.type === 'hello')
  assert.ok(reply, 'a hello reply arrives')
  return reply
}

/**
 * A JSON message of exactly `bytes` UTF-8 bytes: an `add` whose only oversized
 * part is a filler string, so the semantic payload stays tiny.
 */
function messageOfSize(bytes) {
  const base = { type: 'add', id: 'cap-session', seq: 5, format: 'gltf', node: { name: 'cap-node', filler: '' } }
  const empty = JSON.stringify(base)
  const filler = 'x'.repeat(Math.max(0, bytes - Buffer.byteLength(empty)))
  const msg = JSON.stringify({ ...base, node: { ...base.node, filler } })
  const actual = Buffer.byteLength(msg)
  assert.equal(actual, bytes, `the message is exactly ${bytes} bytes`)
  return msg
}

test('L9/K7: an authorized connection sending 1 MiB + 1 byte is closed with 1009, and nothing is added or broadcast', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startServer(world)

  const owner = await connect(port)
  const peer = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'cap-owner')
    await hello(peer.ws, peer.messages, 'cap-peer')

    const nodesBefore = world.som.nodes.length
    const peerBefore = peer.messages.length
    let closeCode = null
    owner.ws.once('close', (code) => { closeCode = code })

    owner.ws.send(messageOfSize(MAX_PAYLOAD_BYTES + 1))
    await waitForClose(owner.ws)
    await delay(120)

    assert.equal(closeCode, 1009, 'the transport closed with 1009 (message too big)')
    assert.equal(world.som.getNodeByName('cap-node'), null, 'the node was not added')
    assert.equal(world.som.nodes.length, nodesBefore, 'the world is unchanged')
    assert.deepEqual(
      peer.messages.slice(peerBefore).filter(m => ['add', 'set', 'remove'].includes(m.type)), [],
      'no other client received anything')
  } finally {
    peer.ws.close()
    await waitForClose(peer.ws)
    if (owner.ws.readyState !== WebSocket.CLOSED) { owner.ws.close(); await waitForClose(owner.ws) }
  }
})

test('L9/K7: a message of exactly 1 MiB is accepted — the connection stays open', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startServer(world)

  const owner = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'cap-owner-2')

    let closed = null
    owner.ws.once('close', (code) => { closed = code })

    owner.ws.send(messageOfSize(MAX_PAYLOAD_BYTES))
    await delay(300)

    assert.equal(closed, null, 'the connection is still open at exactly the cap')
    assert.equal(owner.ws.readyState, WebSocket.OPEN)
  } finally {
    owner.ws.close()
    await waitForClose(owner.ws)
  }
})
