// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// selection-parts T11 (devtasks/PREBRIEF-selection-parts.md FINAL Rev 2, §5):
// a Duplicate in place and a part's re-add are ordinary `add`s with `parent`,
// which every released server honours. A test, not a server change: through
// the real attachSessionHandlers, on both world kinds, port 0.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const closers = []
after(async () => {
  for (const close of closers.reverse()) {
    try { await close() } catch { /* best effort */ }
  }
})

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

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
    await delay(5)
  }
  return null
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  return { ws, messages }
}

const CAPS = { tick: { interval: 5000 } }

async function hello(ws, messages, id, capabilities = CAPS) {
  ws.send(JSON.stringify({ type: 'hello', id, capabilities }))
  const reply = await waitFor(messages, (m) => m.type === 'hello')
  assert.ok(reply, 'a hello reply arrives')
  return reply
}

/** The two world kinds T2 must hold for (fresh-agent check, S1). */
const KINDS = {
  file: () => createWorld(SPACE),
  document: async () => {
    const seed = await createWorld(SPACE)
    return createWorldFromDocument(JSON.stringify(await seed.serialize()))
  },
}

/** An owned world; `owner` is a session whose world adds are the owner's. */
async function startWorld(kind = 'file', { userIdFor = () => 'user-a' } = {}) {
  const world = await KINDS[kind]()
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1048576 })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const state = { saves: 0 }
  let n = 0
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence,
    worldOwnerUserId: 'user-a',
    onSaveableMutation: () => { state.saves += 1 },
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req, userIdFor(n++)) })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, state }
}

async function owner(port, id = `owner-${randomUUID().slice(0, 6)}`) {
  const { ws, messages } = await connect(port)
  await hello(ws, messages, id)
  return { ws, messages }
}


const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
let seq = 100
/** Send an `add` and wait for this sender's answer: the broadcast echo, or an error. */
async function sendAdd(o, node, extra = {}) {
  const s = ++seq
  o.ws.send(JSON.stringify({ type: 'add', seq: s, node, ...extra }))
  return waitFor(o.messages, (m) => (m.type === 'add' && m.requestSeq === s) || (m.type === 'error' && m.seq === s))
}
async function sendRemove(o, name) {
  const s = ++seq
  o.ws.send(JSON.stringify({ type: 'remove', seq: s, node: name }))
  return waitFor(o.messages, (m) => (m.type === 'remove' && m.requestSeq === s) || (m.type === 'error' && m.seq === s))
}
const parentOf = (world, name) => world.som.getNodeByName(name)?.parent?.name ?? null

for (const kind of Object.keys(KINDS)) {
  test(`${kind} world: a Duplicate in place (an add with parent) is accepted, broadcast with parent, and stored under the parent`, async () => {
    const { world, port } = await startWorld(kind)
    const o = await owner(port)
    const witness = await owner(port)
    try {
      const copy = { name: 'lamp-shade copy', translation: [1.5, 1.6, 0], extras: { atrium: { objectId: randomUUID() } }, mesh: { primitives: [{ attributes: { POSITION: [...TRI] } }] } }
      const answer = await sendAdd(o, copy, { parent: 'lamp-01' })
      assert.equal(answer?.type, 'add', `accepted: ${JSON.stringify(answer)}`)
      assert.equal(answer.parent, 'lamp-01', 'the echo carries parent')
      const seen = await waitFor(witness.messages, (m) => m.type === 'add' && m.requestSeq === answer.requestSeq)
      assert.equal(seen?.parent, 'lamp-01', 'and so does the broadcast every other client ingests under it (_onAdd, A7)')
      assert.equal(parentOf(world, 'lamp-shade copy'), 'lamp-01')
      const saved = JSON.stringify(await world.serialize())
      const reloaded = await createWorldFromDocument(saved)
      assert.equal(parentOf(reloaded, 'lamp-shade copy'), 'lamp-01', 'kept through a save and a reload')
    } finally {
      o.ws.close(); witness.ws.close()
    }
  })

  test(`${kind} world: a part deleted and re-added with parent goes back under its group; a parent that is gone is refused NODE_NOT_FOUND`, async () => {
    const { world, port } = await startWorld(kind)
    const o = await owner(port)
    try {
      const descriptor = { name: 'lamp-shade', translation: [0, 1.6, 0], mesh: { primitives: [{ attributes: { POSITION: [...TRI] } }] } }
      assert.equal((await sendRemove(o, 'lamp-shade'))?.type, 'remove')
      assert.equal(world.som.getNodeByName('lamp-shade'), null)
      const back = await sendAdd(o, descriptor, { parent: 'lamp-01' })
      assert.equal(back?.type, 'add', JSON.stringify(back))
      assert.equal(parentOf(world, 'lamp-shade'), 'lamp-01')
      const gone = await sendAdd(o, { ...descriptor, name: 'lamp-shade 2' }, { parent: 'lamp-gone' })
      assert.equal(gone?.type, 'error')
      assert.equal(gone.code, 'NODE_NOT_FOUND')
      assert.match(gone.message, /^NODE_NOT_FOUND: lamp-gone$/, 'the text the Undo engine maps to “its group was renamed or removed”')
      assert.equal(world.som.getNodeByName('lamp-shade 2'), null)
    } finally {
      o.ws.close()
    }
  })
}
