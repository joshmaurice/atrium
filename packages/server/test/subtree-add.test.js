// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// subtree-add — the server test file (devtasks/PREBRIEF-subtree-add.md FINAL
// Rev 2, §5). Real WebSocket servers on port 0 through the real
// `attachSessionHandlers`, on BOTH world kinds: a file world through
// `createWorld` (the commons is one) and a document world through
// `createWorldFromDocument` (home and user worlds). Every acceptance ends
// with a read-back: a present client's own `SOMDocument.ingestNode` on the
// broadcast, a later joiner's `som-dump` read with the client's WebIO, and
// serialize → createWorldFromDocument → serialize.
//
// Every socket and server is closed in finally / after().

import { test, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { Document, WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import { ADD_REASONS } from '../src/send-policy.js'
import { SOMDocument } from '../../som/src/SOMDocument.js'
import { templateGraph } from '../../behaviors/src/templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

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

/** The two world kinds T2 must hold for (fresh-agent check, S1). */
const KINDS = {
  file: () => createWorld(SPACE),
  document: async () => {
    const seed = await createWorld(SPACE)
    return createWorldFromDocument(JSON.stringify(await seed.serialize()))
  },
}

/** An owned world; `owner` is a session whose world adds are the owner's. */
async function startWorld(kind = 'file', { userIdFor = () => 'user-a', refuseStaleHello = true } = {}) {
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
    refuseStaleHello,
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
const prim = (material) => (material === undefined ? { attributes: { POSITION: [...TRI] } } : { attributes: { POSITION: [...TRI] }, material })
const MAT = (name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 0.1, 1], metallicFactor: 0, roughnessFactor: 1 } })
const bufferCount = (world) => world.som._document.getRoot().listBuffers().length
const nodeCount = (world) => world.som._document.getRoot().listNodes().length

let seq = 100
/** Send an `add` and wait for this sender's answer: the broadcast echo, or an error. */
async function sendAdd(o, node, extra = {}) {
  const s = ++seq
  o.ws.send(JSON.stringify({ type: 'add', seq: s, node, ...extra }))
  return waitFor(o.messages, (m) => (m.type === 'add' && m.requestSeq === s) || (m.type === 'error' && m.seq === s))
}

/**
 * The three-generation tree of §5: a meshless root; a mesh member; a pad
 * member; a model member; a behaviour member whose template targets the mesh
 * member; the shade's and the stand's material shared by a ref (T12).
 */
function lampTree(prefix = 't') {
  const shadeId = randomUUID()
  const buttonId = randomUUID()
  return {
    name: `${prefix}-lamp`,
    translation: [2, 0, -3],
    children: [
      {
        name: `${prefix}-body`,
        children: [
          { name: `${prefix}-shade`, translation: [0, 1.6, 0], extras: { atrium: { objectId: shadeId } }, mesh: { primitives: [prim(MAT('Brass'))] } },
          { name: `${prefix}-stand`, mesh: { primitives: [prim({ ref: 0 })] } },
        ],
      },
      { name: `${prefix}-pad`, extras: { atrium: { teleporter: { destination: '/' } } }, mesh: { primitives: [prim()] } },
      { name: `${prefix}-model`, extras: { atrium: { model: { url: '/assets/library/lamp.glb' } } } },
      {
        name: `${prefix}-button`,
        extras: { atrium: { objectId: buttonId, behavior: templateGraph('select-visibility', { target: shadeId, action: 'toggle' }, { ownId: buttonId }) } },
        mesh: { primitives: [prim()] },
      },
    ],
  }
}

/** The tree's shape as names, parents first, from a glTF-Transform node. */
function shapeOf(gltfNode) {
  return { name: gltfNode.getName(), children: gltfNode.listChildren().map(shapeOf) }
}
const nodeIn = (doc, name) => doc.getRoot().listNodes().find((n) => n.getName() === name)

// ---------------------------------------------------------------------------
// The tree, accepted and read back, on both world kinds
// ---------------------------------------------------------------------------

for (const kind of Object.keys(KINDS)) {
  test(`${kind} world: a three-generation tree is accepted, broadcast as ONE message, and kept by a present client, a joiner and a reload`, async () => {
    const { world, port, state } = await startWorld(kind)
    const o = await owner(port)
    const witness = await owner(port)
    try {
      const tree = lampTree(kind)
      const buffersBefore = bufferCount(world)
      const answer = await sendAdd(o, tree)
      assert.equal(answer?.type, 'add', `accepted: ${JSON.stringify(answer)}`)
      assert.equal(answer.node.children.length, 4, 'the broadcast is the tree as sent')
      const adds = witness.messages.filter((m) => m.type === 'add' && m.requestSeq === answer.requestSeq)
      assert.equal(adds.length, 1, 'ONE broadcast for the whole tree')

      const expected = {
        name: `${kind}-lamp`,
        children: [
          { name: `${kind}-body`, children: [{ name: `${kind}-shade`, children: [] }, { name: `${kind}-stand`, children: [] }] },
          { name: `${kind}-pad`, children: [] },
          { name: `${kind}-model`, children: [] },
          { name: `${kind}-button`, children: [] },
        ],
      }
      assert.deepEqual(shapeOf(nodeIn(world.som._document, `${kind}-lamp`)), expected, 'the server holds the tree')
      assert.equal(bufferCount(world) - buffersBefore, 1, 'ONE buffer for the whole message (T3)')
      assert.ok(state.saves >= 1, 'a saveable mutation')

      // a present client's own ingestNode
      const doc = new Document()
      doc.createScene()
      const som = new SOMDocument(doc)
      const root = som.ingestNode(adds[0].node)
      assert.deepEqual(shapeOf(root._node), expected, 'a present client builds the same tree')
      const shade = nodeIn(doc, `${kind}-shade`).getMesh().listPrimitives()[0].getMaterial()
      const stand = nodeIn(doc, `${kind}-stand`).getMesh().listPrimitives()[0].getMaterial()
      // identity by `ok` (here and below): a failing `equal` on two glTF-Transform objects inspects the whole document graph
      assert.ok(shade === stand, `T12: the shade and the stand share one material (${shade?.getName()}, ${stand?.getName()})`)

      // a later joiner
      const dumpDoc = await readDump(await joinAndReadDump(port, `joiner-${kind}`))
      assert.deepEqual(shapeOf(nodeIn(dumpDoc, `${kind}-lamp`)), expected, 'a joiner’s som-dump holds the tree')
      assert.ok(nodeIn(dumpDoc, `${kind}-shade`).getMesh().listPrimitives()[0].getMaterial() ===
        nodeIn(dumpDoc, `${kind}-stand`).getMesh().listPrimitives()[0].getMaterial(), 'and the shared material')

      // a save and a reload
      const first = await world.serialize()
      const rebuilt = await createWorldFromDocument(JSON.stringify(first))
      assert.deepEqual(shapeOf(nodeIn(rebuilt.som._document, `${kind}-lamp`)), expected, 'a reload keeps the tree')
      const second = await rebuilt.serialize()
      assert.deepEqual(second.nodes, first.nodes, 'the re-save writes the same nodes')
      assert.deepEqual(second.materials, first.materials, 'and the same materials')

      // removing the root removes every member, here and on a present client
      const r = ++seq
      o.ws.send(JSON.stringify({ type: 'remove', seq: r, node: `${kind}-lamp` }))
      assert.ok(await waitFor(o.messages, (m) => m.type === 'remove' && m.requestSeq === r), 'the remove is accepted')
      for (const name of ['lamp', 'body', 'shade', 'stand', 'pad', 'model', 'button']) {
        assert.equal(world.som.getNodeByName(`${kind}-${name}`), null, `${name} is gone on the server`)
      }
      assert.equal(bufferCount(world), buffersBefore, 'the buffer went with the tree')
      const witnessRemove = await waitFor(witness.messages, (m) => m.type === 'remove' && m.requestSeq === r)
      assert.ok(witnessRemove, 'a present client is told')
      root.dispose()
      assert.equal(doc.getRoot().listNodes().length, 0, 'and its dispose removes the whole subtree')
    } finally {
      o.ws.close(); witness.ws.close()
    }
  })

  test(`${kind} world: a part removed alone leaves the rest and the shared buffer`, async () => {
    const { world, port } = await startWorld(kind)
    const o = await owner(port)
    try {
      const answer = await sendAdd(o, lampTree(`${kind}p`))
      assert.equal(answer?.type, 'add')
      const buffers = bufferCount(world)
      const r = ++seq
      o.ws.send(JSON.stringify({ type: 'remove', seq: r, node: `${kind}p-shade` }))
      assert.ok(await waitFor(o.messages, (m) => m.type === 'remove' && m.requestSeq === r))
      assert.equal(world.som.getNodeByName(`${kind}p-shade`), null)
      assert.ok(world.som.getNodeByName(`${kind}p-stand`), 'the stand stays')
      assert.equal(bufferCount(world), buffers, 'the message’s one buffer stays for the rest')
      const stand = world.som.getNodeByName(`${kind}p-stand`)._node
      assert.ok(stand.getMesh().listPrimitives()[0].getAttribute('POSITION').getArray().length === 9, 'and the stand’s accessor is live')
      assert.ok(stand.getMesh().listPrimitives()[0].getMaterial(), 'the shared material stays for the stand')
    } finally {
      o.ws.close()
    }
  })
}

// ---------------------------------------------------------------------------
// T2 — every per-node check, for every member; a refusal changes nothing
// ---------------------------------------------------------------------------

describe('T2: each refusal changes nothing and is broadcast to no one', () => {
  const cases = [
    ['a member whose name the world holds', () => ({ name: 'r1', children: [{ name: 'crate-01' }] }), (a) => /already in use/.test(a.message)],
    ['a member three generations down carrying source: null (S2, split)', () => ({ name: 'r2', children: [{ name: 'r2a', children: [{ name: 'r2b', children: [{ name: 'r2c', extras: { atrium: { source: null } } }] }] }] }),
      (a) => a.code === 'PERMISSION_DENIED' && /source cannot be set/.test(a.message)],
    ['a member with a non-unit rotation (K6)', () => ({ name: 'r3', children: [{ name: 'r3a', rotation: [0, 0, 0, 2] }] }), (a) => /unit quaternion/.test(a.message)],
    ['a member model with a mesh', () => ({ name: 'r4', children: [{ name: 'r4a', extras: { atrium: { model: { url: '/m.glb' } } }, mesh: { primitives: [prim()] } }] }), (a) => a.code === 'INVALID_VALUE'],
    ['a forward material ref (passes the schema; material-ref)', () => ({ name: 'r5', children: [{ name: 'r5a', mesh: { primitives: [prim({ ref: 0 })] } }, { name: 'r5b', mesh: { primitives: [prim(MAT('M'))] } }] }),
      (a) => a.message.startsWith('material-ref:')],
    ['two members with one name (children-names)', () => ({ name: 'r6', children: [{ name: 'leg' }, { name: 'leg' }] }), (a) => a.message.startsWith('children-names:')],
    ['an avatar-shaped tree: a member carrying ephemeral marker only is still a world node; K4 is avatar-only',
      () => ({ name: 'r7', children: [{ name: 'r7a', extras: { atrium: { teleporter: { destination: '/' } } } }] }), null],
  ]
  for (const [label, build, matches] of cases) {
    test(label, async () => {
      const { world, port } = await startWorld()
      const o = await owner(port)
      const witness = await owner(port)
      try {
        const before = nodeCount(world)
        const node = build()
        const answer = await sendAdd(o, node)
        if (matches === null) {
          // the contrast case: K4 doesn't apply to world members, so a pad member is accepted
          assert.equal(answer?.type, 'add', `a pad member is accepted: ${JSON.stringify(answer)}`)
          return
        }
        assert.equal(answer?.type, 'error', `refused: ${JSON.stringify(answer)}`)
        assert.ok(matches(answer), `the member's reason: ${answer.code} ${answer.message}`)
        await delay(30)
        assert.equal(nodeCount(world), before, 'nothing changed')
        assert.equal(witness.messages.filter((m) => m.type === 'add').length, 0, 'broadcast to no one')
      } finally {
        o.ws.close(); witness.ws.close()
      }
    })
  }

  test('a member whose id the world holds', async () => {
    const { world, port } = await startWorld()
    const o = await owner(port)
    try {
      const id = randomUUID()
      assert.equal((await sendAdd(o, { name: 'holder', extras: { atrium: { objectId: id } } }))?.type, 'add')
      const before = nodeCount(world)
      const answer = await sendAdd(o, { name: 'r8', children: [{ name: 'r8a', extras: { atrium: { objectId: id } } }] })
      assert.equal(answer?.type, 'error')
      assert.equal(answer.code, 'INVALID_VALUE')
      assert.doesNotMatch(answer.message, /already in use/, 'never the palette’s retry text')
      assert.equal(nodeCount(world), before)
    } finally {
      o.ws.close()
    }
  })

  test('the behaviour cap counts every member’s leaf', async () => {
    const { world, port } = await startWorld()
    const o = await owner(port)
    try {
      const selfLeaf = () => {
        const id = randomUUID()
        return { extras: { atrium: { objectId: id, behavior: templateGraph('select-visibility', { target: id, action: 'toggle' }, { ownId: id }) } } }
      }
      const before = nodeCount(world)
      const tooMany = { name: 'b-root', children: Array.from({ length: 65 }, (_, i) => ({ name: `b${i}`, ...selfLeaf() })) }
      const answer = await sendAdd(o, tooMany)
      assert.equal(answer?.type, 'error')
      assert.match(answer.message, /already has 64 behaviours/)
      assert.equal(nodeCount(world), before)
      const justEnough = { name: 'b-root', children: Array.from({ length: 64 }, (_, i) => ({ name: `b${i}`, ...selfLeaf() })) }
      assert.equal((await sendAdd(o, justEnough))?.type, 'add', '64 is the cap, not past it')
    } finally {
      o.ws.close()
    }
  })
})

// ---------------------------------------------------------------------------
// T2's order: the shape pass before anything that scans the world (fresh-agent
// M1; the ChatGPT review's S3: spied, not timed)
// ---------------------------------------------------------------------------

/** Wrap a SOM's world-scanning calls; returns the call counts. */
function spyOn(world) {
  const calls = { checkNewName: 0, savedObjectIds: 0, objectIdInUse: 0, ingestNode: 0 }
  for (const name of Object.keys(calls)) {
    const original = world.som[name].bind(world.som)
    world.som[name] = (...args) => { calls[name] += 1; return original(...args) }
  }
  return calls
}

test('T2 order: a tree the shape pass refuses (children-names) reaches no per-member world check and no ingest', async () => {
  const { world, port } = await startWorld()
  // 500 more nodes, so a scan would be measurable
  for (let i = 0; i < 500; i++) world.som.scene.addChild(world.som.ingestNode({ name: `pad-${i}`, extras: { atrium: { objectId: randomUUID() } } }))
  const o = await owner(port)
  try {
    const calls = spyOn(world)
    const children = Array.from({ length: 255 }, (_, i) => ({ name: `s${i}`, extras: { atrium: { objectId: randomUUID() } } }))
    children[254].name = 's0'
    const answer = await sendAdd(o, { name: 'shape-root', children })
    assert.equal(answer?.type, 'error')
    assert.ok(answer.message.startsWith('children-names:'), answer.message)
    assert.deepEqual(calls, { checkNewName: 0, savedObjectIds: 0, objectIdInUse: 0, ingestNode: 0 }, 'nothing per member ran')
  } finally {
    o.ws.close()
  }
})

test('T2: a valid 256-member tree with ids, in a world of 500 more nodes, builds ONE id set and is accepted quickly', async () => {
  const { world, port } = await startWorld()
  for (let i = 0; i < 500; i++) world.som.scene.addChild(world.som.ingestNode({ name: `pad-${i}`, extras: { atrium: { objectId: randomUUID() } } }))
  const o = await owner(port)
  try {
    const calls = spyOn(world)
    const children = Array.from({ length: 255 }, (_, i) => ({ name: `v${i}`, extras: { atrium: { objectId: randomUUID() } } }))
    const started = Date.now()
    const answer = await sendAdd(o, { name: 'valid-root', children })
    const ms = Date.now() - started
    assert.equal(answer?.type, 'add', JSON.stringify(answer))
    assert.equal(calls.savedObjectIds, 1, 'one set for the message')
    assert.equal(calls.objectIdInUse, 0, 'not a scan per member')
    assert.equal(calls.checkNewName, 256, 'every member’s name')
    assert.ok(ms < 500, `answered in ${ms} ms`)
  } finally {
    o.ws.close()
  }
})

// ---------------------------------------------------------------------------
// Step 0, before Ajv (the ChatGPT review's M1)
// ---------------------------------------------------------------------------

describe('T2 step 0: the count before Ajv', () => {
  test('a 60,000-member tree whose LAST member is schema-invalid gets children-count, not Ajv’s text, and reaches no handler', async () => {
    const { world, port } = await startWorld()
    const o = await owner(port)
    try {
      const calls = spyOn(world)
      const children = Array.from({ length: 60000 }, () => ({ name: 'x' }))
      children[59999] = { name: 'x', bogus: 1 }
      const answer = await sendAdd(o, { name: 'wide', children })
      assert.equal(answer?.type, 'error')
      assert.equal(answer.code, 'INVALID_VALUE')
      assert.equal(answer.message, `children-count: ${ADD_REASONS['children-count']}`, 'step 0 ran before Ajv')
      assert.deepEqual(calls, { checkNewName: 0, savedObjectIds: 0, objectIdInUse: 0, ingestNode: 0 })
    } finally {
      o.ws.close()
    }
  })

  test('the same from a visitor of a world it doesn’t own (step 0 runs before the gate)', async () => {
    const { port } = await startWorld('file', { userIdFor: (i) => (i === 0 ? 'someone-else' : 'user-a') })
    const { ws, messages } = await connect(port)
    try {
      await hello(ws, messages, 'visitor-x')
      const children = Array.from({ length: 300 }, (_, i) => ({ name: `v${i}`, bogus: 1 }))
      const s = ++seq
      ws.send(JSON.stringify({ type: 'add', seq: s, node: { name: 'wide', children } }))
      const answer = await waitFor(messages, (m) => m.type === 'error' && m.seq === s)
      assert.equal(answer?.message, `children-count: ${ADD_REASONS['children-count']}`)
    } finally {
      ws.close()
    }
  })

  test('a non-array children is left to Ajv', async () => {
    const { port } = await startWorld()
    const o = await owner(port)
    try {
      const answer = await sendAdd(o, { name: 'odd', children: { name: 'x' } })
      assert.equal(answer?.type, 'error')
      assert.equal(answer.code, 'UNKNOWN_MESSAGE', 'Ajv’s refusal')
    } finally {
      o.ws.close()
    }
  })

  test('a chain 9 generations deep gets children-depth before Ajv', async () => {
    const { port } = await startWorld()
    const o = await owner(port)
    try {
      let n = { name: 'g9', bogus: 1 }
      for (let g = 8; g >= 0; g--) n = { name: `g${g}`, children: [n] }
      const answer = await sendAdd(o, n)
      assert.equal(answer?.message, `children-depth: ${ADD_REASONS['children-depth']}`)
    } finally {
      o.ws.close()
    }
  })

  test('an 8-generation tree with a template leaf on its deepest member (message depth 27) is accepted', async () => {
    const { port } = await startWorld()
    const o = await owner(port)
    try {
      const id = randomUUID()
      let n = { name: 'g8', extras: { atrium: { objectId: id, behavior: templateGraph('select-visibility', { target: id, action: 'toggle' }, { ownId: id }) } } }
      for (let g = 7; g >= 0; g--) n = { name: `g${g}`, children: [n] }
      const answer = await sendAdd(o, n)
      assert.equal(answer?.type, 'add', JSON.stringify(answer))
    } finally {
      o.ws.close()
    }
  })
})

// ---------------------------------------------------------------------------
// The primitive budget (the ChatGPT review's M2) and the byte bounds (S2)
// ---------------------------------------------------------------------------

function denseTree(members, per, extra = 0, prefix = 'm') {
  const children = Array.from({ length: members }, (_, i) => ({ name: `${prefix}${i}`, mesh: { primitives: Array.from({ length: per }, () => prim()) } }))
  if (extra > 0) children.push({ name: `${prefix}-extra`, mesh: { primitives: Array.from({ length: extra }, () => prim()) } })
  return { name: `${prefix}-root`, children }
}

for (const kind of Object.keys(KINDS)) {
  test(`${kind} world: the review's dense tree (16,320 primitives) is refused children-primitives before any ingest`, async () => {
    const { world, port } = await startWorld(kind)
    const o = await owner(port)
    try {
      const calls = spyOn(world)
      const answer = await sendAdd(o, denseTree(255, 64))
      assert.equal(answer?.message, `children-primitives: ${ADD_REASONS['children-primitives']}`)
      assert.equal(calls.ingestNode, 0, 'not ingested')
    } finally {
      o.ws.close()
    }
  })
}

test('1,024 primitives are accepted quickly; 1,025 are refused', async () => {
  const { port } = await startWorld()
  const o = await owner(port)
  try {
    const started = Date.now()
    const ok = await sendAdd(o, denseTree(16, 64, 0, 'ok'))
    const ms = Date.now() - started
    assert.equal(ok?.type, 'add', JSON.stringify(ok))
    assert.ok(ms < 250, `answered in ${ms} ms`)
    const over = await sendAdd(o, denseTree(16, 64, 1, 'over'))
    assert.equal(over?.message, `children-primitives: ${ADD_REASONS['children-primitives']}`)
  } finally {
    o.ws.close()
  }
})

test('S2: the server’s bound is the socket’s: a 1,000,240-byte tree is accepted; one over 1,048,576 closes with 1009', async () => {
  const { world, port } = await startWorld()
  const o = await owner(port)
  try {
    // two members whose POSITION arrays make the message just over the client's 1,000,000
    // (unindexed, so each vertex count is a multiple of 3: steps of 900 numbers)
    const big = (name, n) => ({ name, mesh: { primitives: [{ attributes: { POSITION: Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 0.5 : 0)) } }] } })
    let n = 3 * 30000
    let node = { name: 'big-root', children: [big('big-a', n), big('big-b', n)] }
    const size = () => Buffer.byteLength(JSON.stringify({ type: 'add', seq: seq + 1, node }))
    while (size() < 1000240) { n += 900; node = { name: 'big-root', children: [big('big-a', n), big('big-b', n)] } }
    assert.ok(size() > 1000000 && size() < 1048576, `the message is ${size()} bytes`)
    const answer = await sendAdd(o, node)
    assert.equal(answer?.type, 'add', `accepted (the server enforces the socket's bound, not the client's margin): ${JSON.stringify(answer)?.slice(0, 200)}`)

    const before = nodeCount(world)
    const closed = new Promise((res) => o.ws.once('close', (code) => res(code)))
    const huge = { name: 'huge-root', children: [big('huge-a', 3 * 90000), big('huge-b', 3 * 90000)] }
    o.ws.send(JSON.stringify({ type: 'add', seq: ++seq, node: huge }))
    assert.equal(await closed, 1009, 'closed with 1009')
    assert.equal(nodeCount(world), before, 'nothing stored')
  } finally {
    o.ws.close()
  }
})

// ---------------------------------------------------------------------------
// T12 — a shared material, through send
// ---------------------------------------------------------------------------

test('T12: a send to one sharer’s material recolours every sharer, on the server and a present client', async () => {
  const { world, port } = await startWorld()
  const o = await owner(port)
  const witness = await owner(port)
  try {
    const tree = { name: 'cols', children: Array.from({ length: 3 }, (_, i) => ({ name: `col-${i}`, mesh: { primitives: [prim(i === 0 ? MAT('Marble') : { ref: 0 })] } })) }
    const answer = await sendAdd(o, tree)
    assert.equal(answer?.type, 'add')
    const doc = new Document()
    doc.createScene()
    const som = new SOMDocument(doc)
    som.ingestNode((await waitFor(witness.messages, (m) => m.type === 'add' && m.requestSeq === answer.requestSeq)).node)
    const s = ++seq
    o.ws.send(JSON.stringify({ type: 'send', seq: s, node: 'col-2', field: 'mesh.primitives[0].material.baseColorFactor', value: [1, 0, 0, 1] }))
    const set = await waitFor(witness.messages, (m) => m.type === 'set' && m.requestSeq === s, 2000) ??
      await waitFor(witness.messages, (m) => m.type === 'set' && m.node === 'col-2', 2000)
    assert.ok(set, 'the send is accepted and broadcast')
    for (const name of ['col-0', 'col-1', 'col-2']) {
      const mat = world.som.getNodeByName(name)._node.getMesh().listPrimitives()[0].getMaterial()
      assert.deepEqual([...mat.getBaseColorFactor()], [1, 0, 0, 1], `${name} recoloured on the server`)
    }
    assert.equal(world.som._document.getRoot().listMaterials().filter((m) => m.getName() === 'Marble').length, 1, 'one material')
  } finally {
    o.ws.close(); witness.ws.close()
  }
})

// ---------------------------------------------------------------------------
// T7 — version skew, both ways
// ---------------------------------------------------------------------------

describe('T7: the level', () => {
  const STALE_MESSAGE = 'this page is older than the server: reload it to keep editing'
  async function session(port, capabilities) {
    const { ws, messages } = await connect(port)
    const reply = await hello(ws, messages, `t7-${randomUUID().slice(0, 6)}`, capabilities)
    return { ws, messages, reply }
  }

  // grouping GR5 — the level is 4 now (a client that applies parent changes).
  test('the server’s hello carries capabilities.addFields 4, valid against hello.server.json', async () => {
    const { validate } = await import('@atrium/protocol')
    const { port } = await startWorld()
    const s = await session(port, CAPS)
    try {
      assert.equal(s.reply.capabilities.addFields, 4)
      assert.equal(validate('server', s.reply).valid, true)
    } finally {
      s.ws.close()
    }
  })

  // grouping GR5 (GR-L12 (a)) — a stale tab's hello is refused now
  // (grouping.test.js); this reaches the second layer behind it.
  test('a 42aa56ff tab (scriptRunner 3, addFields 2), second layer: its world add and remove are refused with R6’s text; its avatar add is accepted', async () => {
    const { world, port } = await startWorld('file', { refuseStaleHello: false })
    const s = await session(port, { tick: { interval: 5000 }, scriptRunner: 3, addFields: 2 })
    try {
      const a = await sendAdd(s, { name: 'from-stale' })
      assert.equal(a?.type, 'error')
      assert.equal(a.message, STALE_MESSAGE)
      const r = ++seq
      s.ws.send(JSON.stringify({ type: 'remove', seq: r, node: 'crate-01' }))
      const rm = await waitFor(s.messages, (m) => m.type === 'error' && m.seq === r)
      assert.equal(rm?.message, STALE_MESSAGE)
      assert.ok(world.som.getNodeByName('crate-01'), 'the object stays')
      const av = ++seq
      s.ws.send(JSON.stringify({
        type: 'add', id: s.reply.id, seq: av,
        node: { name: s.reply.avatarNodeName, mesh: { primitives: [prim()] }, extras: { atrium: { ephemeral: true } } },
      }))
      await delay(50)
      assert.equal(s.messages.find((m) => m.type === 'error' && m.seq === av), undefined, 'the avatar add is not refused')
      assert.ok(world.som.getNodeByName(s.reply.avatarNodeName), 'and the avatar is in the world')
    } finally {
      s.ws.close()
    }
  })

  for (const [label, capabilities] of [
    ['addFields 4', { tick: { interval: 5000 }, scriptRunner: 3, addFields: 4 }],
    ['addFields 5', { tick: { interval: 5000 }, scriptRunner: 3, addFields: 5 }],
    ['neither capability', { tick: { interval: 5000 } }],
  ]) {
    test(`a session with ${label} adds a tree and removes it`, async () => {
      const { port } = await startWorld()
      const s = await session(port, capabilities)
      try {
        const a = await sendAdd(s, { name: `ok-${label.replace(/\W/g, '')}`, children: [{ name: `okc-${label.replace(/\W/g, '')}` }] })
        assert.equal(a?.type, 'add', JSON.stringify(a))
        const r = ++seq
        s.ws.send(JSON.stringify({ type: 'remove', seq: r, node: a.node.name }))
        assert.ok(await waitFor(s.messages, (m) => m.type === 'remove' && m.requestSeq === r))
      } finally {
        s.ws.close()
      }
    })
  }
})
