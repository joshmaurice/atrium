// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// copy-objects — the server test file (devtasks/PREBRIEF-copy-objects.md §5).
// Real WebSocket servers on port 0 through the real `attachSessionHandlers`,
// as richer-add.test.js. Every acceptance ends with a read-back: a present
// client's broadcast, a later joiner's `som-dump`, and serialize →
// createWorldFromDocument.
//
// Every socket and server is closed in finally / after().

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import { createDb } from '../src/db.js'
import { validate } from '../../protocol/src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/credit-vectors.json'), 'utf8'))

// ---------------------------------------------------------------------------
// Lifecycle and helpers (as richer-add.test.js)
// ---------------------------------------------------------------------------

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

const CAPS = { tick: { interval: 5000 }, scriptRunner: 3, addFields: 3 }

async function hello(ws, messages, id, capabilities = CAPS) {
  ws.send(JSON.stringify({ type: 'hello', id, capabilities }))
  const reply = await waitFor(messages, (m) => m.type === 'hello')
  assert.ok(reply, 'a hello reply arrives')
  return reply
}

async function joinAndReadDump(port, id) {
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, id)
    return await waitFor(messages, (m) => m.type === 'som-dump', 4000)
  } finally {
    ws.close()
  }
}

async function readDump(dump) {
  const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
  return io.readJSON({ json: dump.gltf, resources: {} })
}

/**
 * A world behind the real handler. `ownerUserId` null is a file world with no
 * owner; `connectAs` is the user every socket is (null: anonymous).
 */
async function startWorld({ ownerUserId = 'user-a', connectAs = ownerUserId, db = null, worldId, mutationPolicy } = {}) {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence, db,
    worldOwnerUserId: ownerUserId,
    mutationPolicy,
    ...(worldId !== undefined ? { worldId } : {}),
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req, connectAs) })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port }
}

async function owner(port, id = 'owner-a') {
  const { ws, messages } = await connect(port)
  const reply = await hello(ws, messages, id)
  return { ws, messages, reply }
}

const pos3 = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const OID = '9b1e4a52-3c7d-4f60-8a1b-2c3d4e5f6a7b'
const nodeIn = (doc, name) => doc.getRoot().listNodes().find((n) => n.getName() === name)

const CREDIT = {
  origin: { server: 'https://a.example', world: 'world-a', creator: 'user-x', creatorName: 'alice', at: '2026-11-06' },
  copiedFrom: {
    server: 'https://a.example', world: 'world-a', address: '/worlds/alice/garden', at: '2026-11-06',
    refs: [{ id: 'fresh-1', was: 'door-1', name: 'Front door' }],
  },
}

// ---------------------------------------------------------------------------
// K3 — the server's check on the credit, through the real handler
// ---------------------------------------------------------------------------

test('K3: a world add with a valid credit is accepted, broadcast, saved and survives a reload', async () => {
  const { world, port } = await startWorld()
  const o = await owner(port)
  const witness = await owner(port, 'witness')
  try {
    const node = {
      name: 'credited', translation: [0, 0.5, 0],
      extras: { atrium: { objectId: OID, ...structuredClone(CREDIT) } },
      mesh: { primitives: [{ attributes: { POSITION: pos3 } }] },
    }
    o.ws.send(JSON.stringify({ type: 'add', seq: 3, format: 'gltf', node }))
    const echo = await waitFor(o.messages, (m) => m.type === 'add' && m.requestSeq === 3)
    assert.ok(echo, `accepted: ${JSON.stringify(o.messages.find((m) => m.type === 'error'))}`)

    const stored = world.som.getNodeByName('credited')
    assert.ok(stored, 'stored')
    assert.deepEqual(stored.extras.atrium.origin, CREDIT.origin, 'the server keeps origin')
    assert.deepEqual(stored.extras.atrium.copiedFrom, CREDIT.copiedFrom, 'and copiedFrom')

    const broadcast = await waitFor(witness.messages, (m) => m.type === 'add' && m.node?.name === 'credited')
    assert.deepEqual(broadcast?.node?.extras?.atrium?.copiedFrom, CREDIT.copiedFrom, 'a present client receives it')

    const doc = await readDump(await joinAndReadDump(port, 'joiner'))
    assert.deepEqual(nodeIn(doc, 'credited').getExtras().atrium.origin, CREDIT.origin, 'a joiner sees it')

    const rebuilt = await createWorldFromDocument(JSON.stringify(await world.serialize()))
    const back = nodeIn(rebuilt.som._document, 'credited').getExtras().atrium
    assert.deepEqual(back.origin, CREDIT.origin, 'a save and reload keep origin')
    assert.deepEqual(back.copiedFrom, CREDIT.copiedFrom, 'and copiedFrom')
  } finally {
    o.ws.close(); witness.ws.close()
  }
})

test('K3: a send can\'t change the credit (no leaf names it)', async () => {
  const { world, port } = await startWorld()
  const o = await owner(port)
  try {
    const node = {
      name: 'credited-2', extras: { atrium: { objectId: OID, ...structuredClone(CREDIT) } },
      mesh: { primitives: [{ attributes: { POSITION: pos3 } }] },
    }
    o.ws.send(JSON.stringify({ type: 'add', seq: 3, format: 'gltf', node }))
    assert.ok(await waitFor(o.messages, (m) => m.type === 'add' && m.requestSeq === 3), 'accepted')
    const attempts = [
      ['extras.atrium.origin', { server: 'https://evil.example', at: '2026-01-01' }],
      ['extras.atrium.origin.creatorName', 'mallory'],
      ['extras.atrium.copiedFrom', null],
      ['extras.atrium', { objectId: OID }],
      ['extras', {}],
    ]
    let seq = 10
    for (const [field, value] of attempts) {
      seq += 1
      o.ws.send(JSON.stringify({ type: 'send', seq, node: 'credited-2', field, value }))
      const err = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === seq, 1500)
      assert.ok(err, `send ${field} is refused`)
    }
    const atrium = world.som.getNodeByName('credited-2').extras.atrium
    assert.deepEqual(atrium.origin, CREDIT.origin, 'origin unchanged')
    assert.deepEqual(atrium.copiedFrom, CREDIT.copiedFrom, 'copiedFrom unchanged')
  } finally {
    o.ws.close()
  }
})

test('K3: every malformed shared credit vector is refused with INVALID_VALUE naming its field, and nothing is broadcast', async () => {
  const { world, port } = await startWorld()
  const o = await owner(port)
  const witness = await owner(port, 'witness-bad')
  try {
    const bad = VECTORS.credit.filter((v) => !v.ok)
    assert.ok(bad.length >= 60)
    const before = world.som.nodes.length
    let seq = 100
    for (const v of bad) {
      seq += 1
      const name = `bad-${seq}`
      o.ws.send(JSON.stringify({ type: 'add', seq, format: 'gltf', node: {
        name, extras: { atrium: v.atrium }, mesh: { primitives: [{ attributes: { POSITION: pos3 } }] },
      } }))
      const err = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === seq)
      assert.ok(err, `${v.label}: refused`)
      assert.equal(err.code, 'INVALID_VALUE', v.label)
      assert.ok(err.message.includes(`extras.atrium.${v.field}`), `${v.label}: ${err.message}`)
      assert.equal(world.som.getNodeByName(name), null, `${v.label}: not stored`)
    }
    await delay(100)
    assert.equal(world.som.nodes.length, before, 'the world is unchanged')
    assert.deepEqual(witness.messages.filter((m) => m.type === 'add' && String(m.node?.name).startsWith('bad-')), [],
      'nothing was broadcast')
  } finally {
    o.ws.close(); witness.ws.close()
  }
})

// ---------------------------------------------------------------------------
// K1 — `hello` carries the world's id and owner
// ---------------------------------------------------------------------------

function dbWithUser(id, username) {
  const db = createDb(join(mkdtempSync(join(tmpdir(), 'atrium-copy-k1-')), 'test.db'))
  db.database.prepare('INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)')
    .run(id, username, username, new Date().toISOString())
  closers.push(async () => db.database.close())
  return db
}

test('K1: an owned world\'s hello carries world.id and owner with the current username, and the schema accepts it', async () => {
  const ownerId = '6c1d2e3f-4a5b-4c6d-8e7f-001122334455'
  const db = dbWithUser(ownerId, 'commonskeeper')
  const { port } = await startWorld({ ownerUserId: ownerId, connectAs: null, db, worldId: 'world-commons' })
  const v = await owner(port, 'k1-visitor')
  try {
    assert.deepEqual(v.reply.world, { id: 'world-commons', owner: { id: ownerId, name: 'commonskeeper' } })
    assert.equal(validate('server', v.reply).valid, true, JSON.stringify(validate('server', v.reply).errors))
    // the username is read at each hello: a later rename (no route does it today) shows
    db.database.prepare('UPDATE users SET username = ? WHERE id = ?').run('keeper2', ownerId)
    const v2 = await owner(port, 'k1-visitor-2')
    assert.equal(v2.reply.world.owner.name, 'keeper2', 'the current username')
    v2.ws.close()
  } finally {
    v.ws.close()
  }
})

test('K1: with db: null an owned world\'s owner has an id and no name, and the schema accepts it', async () => {
  const { port } = await startWorld({ ownerUserId: 'user-a', worldId: 'w-null' })
  const o = await owner(port, 'k1-owner')
  try {
    assert.deepEqual(o.reply.world, { id: 'w-null', owner: { id: 'user-a' } })
    assert.equal(o.reply.canEdit, true, 'the owner still edits')
    assert.equal(validate('server', o.reply).valid, true)
  } finally {
    o.ws.close()
  }
})

test('K1: an owner the database doesn\'t know has an id and no name; the hello is never refused for it', async () => {
  const db = dbWithUser('someone-else', 'bob')
  const { port } = await startWorld({ ownerUserId: 'user-unknown', connectAs: null, db, worldId: 'w-x' })
  const v = await owner(port, 'k1-unknown')
  try {
    assert.deepEqual(v.reply.world, { id: 'w-x', owner: { id: 'user-unknown' } })
    assert.equal(validate('server', v.reply).valid, true)
  } finally {
    v.ws.close()
  }
})

test('K1: a failed lookup leaves the name out and still answers', async () => {
  const db = dbWithUser('user-a', 'alice')
  db.database.close()   // every query now throws
  const { port } = await startWorld({ ownerUserId: 'user-a', connectAs: null, db, worldId: 'w-closed' })
  const v = await owner(port, 'k1-failed')
  try {
    assert.deepEqual(v.reply.world, { id: 'w-closed', owner: { id: 'user-a' } })
  } finally {
    v.ws.close()
  }
})

test('K1: a file world\'s hello carries world.id and no owner, and the schema accepts it', async () => {
  const { port } = await startWorld({ ownerUserId: null, connectAs: null, mutationPolicy: 'open' })
  const v = await owner(port, 'k1-file')
  try {
    assert.deepEqual(v.reply.world, { id: 'default' }, 'attachSessionHandlers\' default world id')
    assert.equal(validate('server', v.reply).valid, true)
  } finally {
    v.ws.close()
  }
})
