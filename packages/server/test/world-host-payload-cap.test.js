// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// world-host-payload-cap — copy-objects K0 (PC (b)): the 1 MiB message cap on
// PROD's path. Every world the registry hosts goes through `createWorldHost`,
// and refused upgrades go through the registry's refusal socket; before K0
// neither set `maxPayload`, so `ws`'s 100 MiB default applied
// (`payload-cap.test.js` covers `createSessionServer` only).
//
// Real HTTP server on port 0, real world, the host's own `handleUpgrade`, an
// owned world and its owner; no mocks.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket from 'ws'
import { createWorld } from '../src/world.js'
import { createWorldHost } from '../src/world-host.js'
import { createWorldRegistry } from '../src/world-registry.js'
import { MAX_PAYLOAD_BYTES } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

// The client's own cap on a world `add` (`edit-duplicate.js` MAX_ADD_BYTES).
const MAX_ADD_BYTES = 1_000_000

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

async function closedWithin(ws, timeoutMs) {
  if (ws.readyState === WebSocket.CLOSED) return true
  return Promise.race([
    waitForClose(ws).then(() => true),
    delay(timeoutMs).then(() => ws.readyState === WebSocket.CLOSED),
  ])
}

function collect(ws) {
  const messages = []
  ws.on('message', (raw) => {
    try { messages.push(JSON.parse(raw)) } catch { /* ignore */ }
  })
  return messages
}

async function waitFor(messages, pred, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = messages.find(pred)
    if (found) return found
    await delay(10)
  }
  return null
}

/** An owned world (owner `user-a`) behind `createWorldHost`; every socket is the owner. */
async function startHostWorld() {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const host = createWorldHost({ id: 'k0-world', world, db: null, ownerUserId: 'user-a' })
  http.on('upgrade', (req, socket, head) => host.handleUpgrade(req, socket, head, 'user-a', null))
  closers.push(async () => { host.close(); http.close() })
  return { world, port }
}

async function ownerConnect(port, id) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
  const messages = collect(ws)
  await waitForOpen(ws)
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
  const reply = await waitFor(messages, m => m.type === 'hello')
  assert.ok(reply, 'a hello reply arrives')
  assert.equal(reply.canEdit, true, 'the owner can edit')
  return { ws, messages }
}

/**
 * A legitimate world `add` (passes add.client.json and add-check's rules): one
 * triangle-list primitive of `vertices` vertices with short decimal positions.
 */
function legitAdd(name, vertices, seq) {
  const pos = new Array(vertices * 3)
  for (let i = 0; i < pos.length; i++) pos[i] = Math.round((i % 97) * 0.0103 * 1e4) / 1e4
  const idx = []
  for (let i = 0; i + 2 < vertices; i += 3) idx.push(i, i + 1, i + 2)
  return JSON.stringify({
    type: 'add', seq, format: 'gltf',
    node: {
      name, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
      mesh: { primitives: [{ attributes: { POSITION: pos }, indices: idx }] },
    },
  })
}

/** The largest legitimate add whose size is at most `limit` bytes (vertices a multiple of 3). */
function legitAddUnder(name, limit, seq) {
  let lo = 3, hi = 65535 - (65535 % 3)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2 / 3) * 3
    if (mid >= hi) { hi -= 3; continue }
    if (Buffer.byteLength(legitAdd(name, mid, seq)) <= limit) lo = mid
    else hi = mid - 3
  }
  return legitAdd(name, lo, seq)
}

test('K0: the cap is exported from session.js as 1 MiB', () => {
  assert.equal(MAX_PAYLOAD_BYTES, 1048576)
})

test('K0: through createWorldHost, a legitimate world add over 1 MiB closes the owner with 1009 and stores nothing', async () => {
  const { world, port } = await startHostWorld()
  const o = await ownerConnect(port, 'k0-owner')
  const peer = await ownerConnect(port, 'k0-peer')
  try {
    const msg = legitAdd('k0-big', 45_000, 7)
    const bytes = Buffer.byteLength(msg)
    assert.ok(bytes > MAX_PAYLOAD_BYTES, `the add is over 1 MiB (${bytes})`)

    const nodesBefore = world.som.nodes.length
    const peerBefore = peer.messages.length
    let closeCode = null
    o.ws.once('close', (code) => { closeCode = code })

    o.ws.send(msg)
    const closed = await closedWithin(o.ws, 5000)
    assert.ok(closed, 'the host closes the connection: it is still open after 5 s')
    await delay(150)

    assert.equal(closeCode, 1009, 'closed with 1009 (message too big)')
    assert.equal(world.som.getNodeByName('k0-big'), null, 'the node was not added')
    assert.equal(world.som.nodes.length, nodesBefore, 'the world is unchanged')
    assert.deepEqual(
      peer.messages.slice(peerBefore).filter(m => ['add', 'set', 'remove'].includes(m.type)), [],
      'no other client received anything')
  } finally {
    for (const c of [o, peer]) {
      if (c.ws.readyState !== WebSocket.CLOSED) { c.ws.close(); await waitForClose(c.ws) }
    }
  }
})

test('K0: through createWorldHost, a legitimate world add at the client\'s cap is handled and stored', async () => {
  const { world, port } = await startHostWorld()
  const o = await ownerConnect(port, 'k0-owner-2')
  try {
    const msg = legitAddUnder('k0-at-cap', MAX_ADD_BYTES, 9)
    const bytes = Buffer.byteLength(msg)
    assert.ok(bytes <= MAX_ADD_BYTES && bytes > MAX_ADD_BYTES - 64 * 1024,
      `the add is just under the client's cap (${bytes})`)

    let closed = null
    o.ws.once('close', (code) => { closed = code })
    o.ws.send(msg)
    const answer = await waitFor(o.messages,
      m => (m.type === 'add' && m.node?.name === 'k0-at-cap') || (m.type === 'error' && m.seq === 9), 8000)

    assert.equal(closed, null, 'the connection is still open')
    assert.ok(answer, 'the server answered the add')
    assert.equal(answer.type, 'add', `the add was accepted (${answer.code ?? ''} ${answer.message ?? ''})`)
    assert.ok(world.som.getNodeByName('k0-at-cap'), 'the node is stored')
  } finally {
    o.ws.close()
    await waitForClose(o.ws)
  }
})

test('K0: the registry\'s refusal socket stops reading at 1 MiB too', async () => {
  const http = createServer()
  const port = await listen(http)
  const reg = createWorldRegistry({ httpServer: http, db: null })
  await reg.registerWorld('default', SPACE, null)
  closers.push(async () => { reg.close(); http.close() })

  const logged = []
  const realError = console.error
  console.error = (...args) => { logged.push(args.join(' ')); }
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/some/garbage/path`)
    ws.on('error', () => {})
    // Sent inside 'open' itself: the refusal's close frame arrives with the
    // upgrade response and is read on the next tick, after which the client
    // can't send. `sendError` records a send that didn't go.
    const sendError = await new Promise((res) => {
      ws.once('open', () => ws.send('x'.repeat(MAX_PAYLOAD_BYTES + 1), (err) => res(err ?? null)))
    })
    assert.equal(sendError, null, 'the oversized frame was sent')
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && !logged.some(l => /max payload/i.test(l))) await delay(20)
    await closedWithin(ws, 6000)
  } finally {
    console.error = realError
  }
  const capped = logged.filter(l => l.includes('refusal socket error') && /max payload/i.test(l))
  assert.equal(capped.length, 1,
    `the refusal socket refused the oversized frame (${JSON.stringify(logged)})`)
})
