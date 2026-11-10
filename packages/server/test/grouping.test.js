// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// grouping — the server test file (devtasks/PREBRIEF-grouping.md FINAL Rev 2,
// §5): GR2 (the value's shape), GR3 (the world checks, in order), GR4 (the
// bounds on moves and parented adds), GR5 / GR-L12 (a) (the stale hello, and
// the second layer behind it: no `send`, never the host), the broadcast and
// the save. Real WebSocket servers on port 0 through the real
// `attachSessionHandlers`; real worlds from tests/fixtures/space.gltf.
//
// Every socket and server is closed in finally / after().

import { test, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld, createWorldFromDocument } from '../src/world.js'
// Namespace imports, so that on code without this round each test fails on
// its own assertion rather than the file failing to load (the fail-first proof
// is per test: PREBRIEF-grouping §5).
import * as sessionModule from '../src/session.js'
import * as sendPolicy from '../src/send-policy.js'
const { attachSessionHandlers, STALE_CLIENT_MESSAGE, ADD_FIELDS_LEVEL } = sessionModule
const STALE_HELLO_MESSAGE = sessionModule.STALE_HELLO_MESSAGE ?? '(no STALE_HELLO_MESSAGE)'
const TREE_BOUNDS_MESSAGE = sendPolicy.TREE_BOUNDS_MESSAGE ?? '(no TREE_BOUNDS_MESSAGE)'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

// ---------------------------------------------------------------------------
// Lifecycle and helpers (as subtree-add.test.js)
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
  const closed = new Promise((res) => ws.once('close', res))
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
  closers.push(async () => ws.terminate())   // a red test never leaves a socket holding the server open
  return { ws, messages, closed }
}

const CURRENT = { tick: { interval: 5000 }, scriptRunner: 3, addFields: ADD_FIELDS_LEVEL }
const NEITHER = { tick: { interval: 5000 } }
const STALE = { tick: { interval: 5000 }, scriptRunner: 3, addFields: 3 }   // a 331e4aed tab

async function hello(c, id, capabilities = NEITHER) {
  c.ws.send(JSON.stringify({ type: 'hello', id, capabilities }))
  const reply = await waitFor(c.messages, (m) => m.type === 'hello')
  assert.ok(reply, 'a hello reply arrives')
  return reply
}

async function startWorld({ kind = 'file', refuseStaleHello = true } = {}) {
  const world = kind === 'file'
    ? await createWorld(SPACE)
    : await createWorldFromDocument(JSON.stringify(await (await createWorld(SPACE)).serialize()))
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1048576 })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const state = { saves: 0 }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence,
    worldOwnerUserId: 'user-a',
    onSaveableMutation: () => { state.saves += 1 },
    refuseStaleHello,
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req, 'user-a') })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, state }
}

async function session(port, capabilities = NEITHER, id = `g-${randomUUID().slice(0, 8)}`) {
  const c = await connect(port)
  c.reply = await hello(c, id, capabilities)
  closers.push(async () => c.ws.close())
  return c
}

let seq = 100
/** Send a `send` and wait for this sender's answer: the broadcast `set`, or an error. */
async function sendField(c, node, field, value) {
  const s = ++seq
  c.ws.send(JSON.stringify({ type: 'send', seq: s, node, field, value }))
  return waitFor(c.messages, (m) => (m.type === 'set' && m.requestSeq === s) || (m.type === 'error' && m.seq === s))
}
const move = (c, node, parent, place = {}) => sendField(c, node, 'parent', {
  parent, translation: place.t ?? [0, 0, 0], rotation: place.r ?? [0, 0, 0, 1], scale: place.s ?? [1, 1, 1],
})
async function sendAdd(c, node, extra = {}) {
  const s = ++seq
  c.ws.send(JSON.stringify({ type: 'add', seq: s, node, ...extra }))
  return waitFor(c.messages, (m) => (m.type === 'add' && m.requestSeq === s) || (m.type === 'error' && m.seq === s))
}

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const prims = (k) => Array.from({ length: k }, () => ({ attributes: { POSITION: [...TRI] } }))
const parentOf = (world, name) => world.som.getNodeByName(name)?.parent?.name ?? null

/** Build a tree directly in the server's SOM (seed content the app can't make). */
function seed(world, name, parentName = null, { prims: k = 0 } = {}) {
  const n = world.som.ingestNode(k > 0 ? { name, mesh: { primitives: prims(k) } } : { name })
  const parent = parentName ? world.som.getNodeByName(parentName) : null
  if (parent) parent.addChild(n); else world.som.scene.addChild(n)
  return n
}
/** A group `name` with `kids` children (`name`-0 …), each with `prims` primitives. */
function seedGroup(world, name, kids, { prims: k = 0 } = {}) {
  seed(world, name)
  for (let i = 0; i < kids; i++) seed(world, `${name}-${i}`, name, { prims: k })
}
/** A chain `name`-0 (top) … `name`-<depth> (generation `depth`). */
function seedChain(world, name, depth) {
  seed(world, `${name}-0`)
  for (let g = 1; g <= depth; g++) seed(world, `${name}-${g}`, `${name}-${g - 1}`)
}
const setAtrium = (world, name, atrium) => {
  const n = world.som.getNodeByName(name)._node
  n.setExtras({ ...(n.getExtras() ?? {}), atrium: { ...(n.getExtras()?.atrium ?? {}), ...atrium } })
}

// ---------------------------------------------------------------------------
// GR2 — the value's shape
// ---------------------------------------------------------------------------

describe('GR2: the value', () => {
  test('each malformed value is INVALID_VALUE, and nothing changes', async () => {
    const { world, port, state } = await startWorld()
    const o = await session(port)
    const ok = { parent: 'lamp-01', translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
    const cases = [
      ['not an object', 'lamp-01'],
      ['null', null],
      ['an array', [ok]],
      ['a missing key', { parent: 'lamp-01', translation: [0, 0, 0], rotation: [0, 0, 0, 1] }],
      ['an extra key', { ...ok, visible: true }],
      ['an empty parent name', { ...ok, parent: '' }],
      ['a parent name of 257 characters', { ...ok, parent: 'x'.repeat(257) }],
      ['a number as the parent', { ...ok, parent: 7 }],
      ['a short translation', { ...ok, translation: [0, 0] }],
      ['a non-finite translation', { ...ok, translation: [0, 'a', 0] }],
      ['a rotation that is not unit', { ...ok, rotation: [0, 0, 0, 2] }],
      ['a zero scale', { ...ok, scale: [1, 0, 1] }],
    ]
    for (const [label, value] of cases) {
      const a = await sendField(o, 'crate-01', 'parent', value)
      assert.equal(a?.type, 'error', `${label}: refused`)
      assert.equal(a.code, 'INVALID_VALUE', `${label}: ${a.message}`)
    }
    assert.equal(parentOf(world, 'crate-01'), null, 'crate-01 still at the top level')
    assert.equal(state.saves, 0, 'nothing saved')
  })

  test('a parent name of exactly 256 characters passes the shape (and is then not found)', async () => {
    const { port } = await startWorld()
    const o = await session(port)
    const a = await move(o, 'crate-01', 'x'.repeat(256))
    assert.equal(a?.code, 'NODE_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// GR3 — the world checks, in order
// ---------------------------------------------------------------------------

describe('GR3: the world checks', () => {
  test('a move is accepted, applied with the vectors as sent, broadcast to two others as sent, and saved', async () => {
    const { world, port, state } = await startWorld({ kind: 'document' })
    const o = await session(port)
    const w1 = await session(port), w2 = await session(port)
    const value = { parent: 'lamp-01', translation: [0.1 + 0.2, 0.25, -1e-9], rotation: [0, 0.6, 0, 0.8], scale: [-1, 0.5, 2] }
    const a = await sendField(o, 'crate-01', 'parent', value)
    assert.equal(a?.type, 'set', JSON.stringify(a))
    assert.deepEqual(a.value, value, 'the own echo carries the value as sent')
    for (const w of [w1, w2]) {
      const b = await waitFor(w.messages, (m) => m.type === 'set' && m.field === 'parent' && m.node === 'crate-01')
      assert.ok(b, 'the other session hears it')
      assert.deepEqual(b.value, value, 'as sent')
    }
    const crate = world.som.getNodeByName('crate-01')
    assert.equal(parentOf(world, 'crate-01'), 'lamp-01')
    assert.deepEqual([...crate.translation], value.translation)
    assert.deepEqual([...crate.rotation], value.rotation)
    assert.deepEqual([...crate.scale], value.scale)
    assert.equal(state.saves, 1, 'autosave notified once')
    const back = await createWorldFromDocument(JSON.stringify(await world.serialize()))
    assert.equal(back.som.getNodeByName('crate-01').parent?.name, 'lamp-01', 'the saved world reads back with the new tree')
    // and back to the top level
    const b = await move(o, 'crate-01', null, { t: [1, 0.25, 0] })
    assert.equal(b?.type, 'set')
    assert.equal(parentOf(world, 'crate-01'), null)
    assert.deepEqual([...crate.translation], [1, 0.25, 0])
  })

  test('step 1: a parent that does not exist is NODE_NOT_FOUND', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    const a = await move(o, 'crate-01', 'no-such-node')
    assert.equal(a?.code, 'NODE_NOT_FOUND')
    assert.equal(parentOf(world, 'crate-01'), null)
  })

  test('step 2: a live avatar, a node under one, external content and a node under it are PERMISSION_DENIED', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    const v = await session(port, NEITHER)
    const av = ++seq
    v.ws.send(JSON.stringify({ type: 'add', id: v.reply.id, seq: av, node: { name: v.reply.avatarNodeName, mesh: { primitives: prims(1) }, extras: { atrium: { ephemeral: true } } } }))
    assert.ok(await waitFor(o.messages, (m) => m.type === 'add' && m.node?.name === v.reply.avatarNodeName), 'the avatar is in (broadcast to the others)')
    seed(world, 'under-avatar', v.reply.avatarNodeName)
    world.externalNodeNames.add('lamp-01')
    for (const parent of [v.reply.avatarNodeName, 'under-avatar', 'lamp-01', 'lamp-shade']) {
      const a = await move(o, 'crate-01', parent)
      assert.equal(a?.code, 'PERMISSION_DENIED', `${parent}: ${a?.message}`)
      assert.equal(a.message, 'a node may not be moved under a live avatar or an externally loaded node')
    }
    assert.equal(parentOf(world, 'crate-01'), null)
  })

  test('step 2 (review S7): a `source` container and a node under one are PERMISSION_DENIED', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    setAtrium(world, 'lamp-01', { source: 'https://example.com/a.gltf' })
    for (const parent of ['lamp-01', 'lamp-shade']) {
      const a = await move(o, 'crate-01', parent)
      assert.equal(a?.code, 'PERMISSION_DENIED', `${parent}: ${a?.message}`)
      assert.equal(a.message, 'a node may not be moved under a live avatar or an externally loaded node')
    }
    assert.equal(parentOf(world, 'crate-01'), null)
  })

  test('step 3: a node that carries a model is INVALID_VALUE', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    setAtrium(world, 'lamp-01', { model: { url: 'https://example.com/m.glb' } })
    const a = await move(o, 'crate-01', 'lamp-01')
    assert.equal(a?.code, 'INVALID_VALUE')
    assert.equal(a.message, 'a node may not be moved into a model')
  })

  test('step 4: the cycle (self, child) and "already there"', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    for (const [node, parent, message] of [
      ['lamp-01', 'lamp-01', 'a node can’t go inside itself'],
      ['lamp-01', 'lamp-shade', 'a node can’t go inside itself'],
      ['lamp-shade', 'lamp-01', 'already there'],
      ['crate-01', null, 'already there'],
    ]) {
      const a = await move(o, node, parent)
      assert.equal(a?.code, 'INVALID_VALUE', `${node} → ${parent}`)
      assert.equal(a.message, message)
    }
    assert.equal(parentOf(world, 'lamp-01'), null, 'no cycle was made')
    assert.equal(parentOf(world, 'lamp-shade'), 'lamp-01')
  })

  test('the order: a blocked parent that carries a model reports step 2; a model that is a descendant reports step 3', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    setAtrium(world, 'lamp-shade', { model: { url: 'https://example.com/m.glb' } })
    const a = await move(o, 'lamp-01', 'lamp-shade')     // a model AND a cycle
    assert.equal(a?.message, 'a node may not be moved into a model', 'step 3 before step 4')
    world.externalNodeNames.add('lamp-shade')
    const b = await move(o, 'crate-01', 'lamp-shade')    // blocked AND a model
    assert.equal(b?.code, 'PERMISSION_DENIED', 'step 2 before step 3')
  })

  test('step 6 (GR-L10 (a)): a behaviour-carrying ancestor gained, or lost, is refused; the node\u2019s own behaviour moves with it', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    setAtrium(world, 'lamp-01', { behavior: { enabled: false, graph: {} } })
    const gained = await move(o, 'crate-01', 'lamp-01')
    assert.equal(gained?.message, 'this would change which behaviours can move it', 'gained')
    const lost = await move(o, 'lamp-shade', null)
    assert.equal(lost?.message, 'this would change which behaviours can move it', 'lost')
    // a node with its own behaviour moves into a plain group
    seed(world, 'plain-group')
    setAtrium(world, 'crate-01', { behavior: { enabled: true, graph: {} } })
    const own = await move(o, 'crate-01', 'plain-group')
    assert.equal(own?.type, 'set', JSON.stringify(own))
    assert.equal(parentOf(world, 'crate-01'), 'plain-group')
  })

  test('a non-owner is refused by the mutation gate, as for every send', async () => {
    const { world, port } = await startWorld()
    // a second world whose owner is someone else
    const http = createServer(); const p2 = await listen(http)
    const wss = new WebSocketServer({ noServer: true })
    const { closeKeepalive } = attachSessionHandlers({ wss, world, sessions: new Map(), presence: { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }, worldOwnerUserId: 'user-a' })
    http.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, 'user-b')))
    closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
    const v = await session(p2)
    const a = await move(v, 'crate-01', 'lamp-01')
    assert.equal(a?.code, 'PERMISSION_DENIED')
    assert.equal(parentOf(world, 'crate-01'), null)
    void port
  })
})

// ---------------------------------------------------------------------------
// GR4 — the bounds
// ---------------------------------------------------------------------------

describe('GR4: the bounds', () => {
  test('nodes: 256 accepted, 257 refused', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seedGroup(world, 'G', 254)                    // 255 nodes
    seed(world, 'one'); seed(world, 'two')
    assert.equal((await move(o, 'one', 'G'))?.type, 'set', 'at 256')
    const a = await move(o, 'two', 'G')
    assert.equal(a?.code, 'INVALID_VALUE')
    assert.equal(a.message, `${TREE_BOUNDS_MESSAGE} (nodes)`)
    assert.equal(parentOf(world, 'two'), null)
  })

  test('depth: generation 8 accepted, 9 refused (the root is 0)', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seedChain(world, 'c', 7)                      // c-0 … c-7
    seed(world, 'one'); seed(world, 'two')
    assert.equal((await move(o, 'one', 'c-7'))?.type, 'set', 'at generation 8')
    const a = await move(o, 'two', 'one')
    assert.equal(a?.message, `${TREE_BOUNDS_MESSAGE} (depth)`)
  })

  test('primitives: 1,024 accepted, 1,025 refused', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seed(world, 'P')
    for (let i = 0; i < 15; i++) seed(world, `P-${i}`, 'P', { prims: 64 })
    seed(world, 'P-last', 'P', { prims: 63 })     // 1,023
    seed(world, 'one', null, { prims: 1 }); seed(world, 'two', null, { prims: 1 })
    assert.equal((await move(o, 'one', 'P'))?.type, 'set', 'at 1,024')
    const a = await move(o, 'two', 'P')
    assert.equal(a?.message, `${TREE_BOUNDS_MESSAGE} (primitives)`)
  })

  test('a tree already over a count may grow (r1, rule "s1"): a 300-node seed group’s move out and back, and a Delete’s re-add', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seedGroup(world, 'G', 299)                    // 300
    assert.equal((await move(o, 'G-0', null))?.type, 'set', 'out')
    assert.equal((await move(o, 'G-0', 'G'))?.type, 'set', 'back in (299 is already over)')
    const r = ++seq
    o.ws.send(JSON.stringify({ type: 'remove', seq: r, node: 'G-1' }))
    assert.ok(await waitFor(o.messages, (m) => m.type === 'remove' && m.requestSeq === r), 'the Delete')
    const back = await sendAdd(o, { name: 'G-1' }, { parent: 'G' })
    assert.equal(back?.type, 'add', `the re-add: ${JSON.stringify(back)}`)
    assert.equal(parentOf(world, 'G-1'), 'G')
  })

  test('a move within an oversized tree is counted once (no double count)', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seedGroup(world, 'G', 254)                    // 255
    seed(world, 'sub', 'G')                       // 256
    assert.equal((await move(o, 'sub', 'G-0'))?.type, 'set', 'still 256 after the move')
  })

  test('a move out of a 257-node group is accepted, and moving it back is refused (r1 a2)', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seedGroup(world, 'G', 256)                    // 257
    assert.equal((await move(o, 'G-0', null))?.type, 'set')
    assert.equal((await move(o, 'G-0', 'G'))?.message, `${TREE_BOUNDS_MESSAGE} (nodes)`)
  })

  test('the deepest part of a 9-generation tree to the top level is accepted, and back is refused (r1 d)', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seedChain(world, 'd', 9)
    assert.equal((await move(o, 'd-9', null))?.type, 'set')
    assert.equal((await move(o, 'd-9', 'd-8'))?.message, `${TREE_BOUNDS_MESSAGE} (depth)`)
  })

  test('a move to the top level is never refused by size (an oversized part)', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seed(world, 'Big')
    seedGroup(world, 'Part', 299)
    world.som.getNodeByName('Big').addChild(world.som.getNodeByName('Part'))
    assert.equal((await move(o, 'Part', null))?.type, 'set')
  })

  test('a Duplicate-in-place `add` past the bound is refused', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seedGroup(world, 'G', 255)                    // 256
    const a = await sendAdd(o, { name: 'dup' }, { parent: 'G' })
    assert.equal(a?.code, 'INVALID_VALUE')
    assert.equal(a.message, `${TREE_BOUNDS_MESSAGE} (nodes)`)
    assert.equal(world.som.getNodeByName('dup'), null)
    seedGroup(world, 'H', 253)                    // 254
    assert.equal((await sendAdd(o, { name: 'dup2' }, { parent: 'H' }))?.type, 'add', 'within the bound')
  })

  test('nodes under a `source` container are not counted (review S7)', async () => {
    const { world, port } = await startWorld()
    const o = await session(port)
    seed(world, 'G')
    seedGroup(world, 'C', 299)
    setAtrium(world, 'C', { source: 'https://example.com/a.gltf' })
    world.som.getNodeByName('G').addChild(world.som.getNodeByName('C'))
    assert.equal((await move(o, 'crate-01', 'G'))?.type, 'set', 'G counts as 2 nodes, the container one of them')
  })
})

// ---------------------------------------------------------------------------
// GR5 / GR-L12 (a) — the stale hello, and the second layer behind it
// ---------------------------------------------------------------------------

describe('GR5: unreloaded tabs', () => {
  test('GR-L12 (a): a stale hello is refused with PERMISSION_DENIED and the stale text, and never joins', async () => {
    const { port } = await startWorld()
    const witness = await session(port)
    const c = await connect(port)
    c.ws.send(JSON.stringify({ type: 'hello', id: 'stale-hello', capabilities: STALE }))
    const err = await waitFor(c.messages, (m) => m.type === 'error')
    assert.ok(err, 'an error arrives')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(err.message, STALE_HELLO_MESSAGE)
    assert.equal(STALE_HELLO_MESSAGE, 'this page is older than the server: reload it')
    assert.ok(await Promise.race([c.closed.then(() => true), delay(2000).then(() => false)]), 'the server closes it')
    assert.equal(c.messages.some((m) => m.type === 'hello' || m.type === 'som-dump'), false, 'no hello reply and no som-dump')
    await delay(50)
    assert.equal(witness.messages.some((m) => m.type === 'join' && m.id === 'stale-hello'), false, 'no presence')
  })

  test('GR-L12 (a): a stale hello after a regroup in the world is refused too (second review M2)', async () => {
    const { port } = await startWorld()
    const o = await session(port)
    assert.equal((await move(o, 'crate-01', 'lamp-01'))?.type, 'set')
    const c = await connect(port)
    c.ws.send(JSON.stringify({ type: 'hello', id: 'stale-later', capabilities: { tick: { interval: 5000 }, scriptRunner: 2 } }))
    const err = await waitFor(c.messages, (m) => m.type === 'error')
    assert.equal(err?.message, STALE_HELLO_MESSAGE)
    assert.ok(await Promise.race([c.closed.then(() => true), delay(2000).then(() => false)]), 'the server closes it')
  })

  test('a level-4 hello, a later page and a hello with neither capability join', async () => {
    const { port } = await startWorld()
    for (const caps of [CURRENT, { ...CURRENT, addFields: ADD_FIELDS_LEVEL + 1 }, NEITHER]) {
      const s = await session(port, caps)
      assert.ok(await waitFor(s.messages, (m) => m.type === 'som-dump'), `${JSON.stringify(caps)} gets the som-dump`)
      assert.equal(s.reply.capabilities.addFields, 4, 'the server says 4')
    }
  })

  test('second layer: a stale session’s send is refused with the reload text, before authorizeSend', async () => {
    const { world, port } = await startWorld({ refuseStaleHello: false })
    const s = await session(port, STALE)
    const a = await sendField(s, 'crate-01', 'translation', [5, 0, 0])
    assert.equal(a?.code, 'INVALID_VALUE')
    assert.equal(a.message, STALE_CLIENT_MESSAGE)
    const b = await move(s, 'crate-01', 'lamp-01')
    assert.equal(b?.message, STALE_CLIENT_MESSAGE)
    assert.deepEqual([...world.som.getNodeByName('crate-01').translation].map((v) => Math.round(v * 1e6) / 1e6), [1, 0.25, 0], 'unchanged')
    // a session with neither capability still sends
    const n = await session(port, NEITHER)
    assert.equal((await sendField(n, 'crate-01', 'translation', [2, 0.25, 0]))?.type, 'set')
  })

  test('second layer: a stale owner is never the host, at its hello or when the host leaves', async () => {
    const { port } = await startWorld({ refuseStaleHello: false })
    const stale = await session(port, STALE)
    assert.equal(stale.reply.scriptHost, false, 'the only owner, and not the host at its hello')
    const host = await session(port, CURRENT)
    assert.equal(host.reply.scriptHost, true, 'a current owner takes it')
    host.ws.close()
    await delay(300)
    assert.equal(stale.messages.some((m) => m.type === 'script-host'), false, 'the stale owner is not handed the role')
    const next = await session(port, CURRENT)
    assert.equal(next.reply.scriptHost, true, 'the next current owner is')
  })
})
