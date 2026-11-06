// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// richer-add — the new server test file (devtasks/PREBRIEF-richer-add.md §5).
// Real WebSocket servers on port 0 through the real `attachSessionHandlers`,
// as add-check.test.js. Every acceptance ends with a read-back: a present
// client's own `SOMDocument.ingestNode` on the broadcast, a later joiner's
// `som-dump` read with the client's WebIO and KHRONOS_EXTENSIONS, and
// serialize → createWorldFromDocument → serialize.
//
// Every socket and server is closed in finally / after().

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { Document, WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import { SOMDocument } from '../../som/src/SOMDocument.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

// ---------------------------------------------------------------------------
// Lifecycle and helpers (as add-check.test.js)
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

async function hello(ws, messages, id, capabilities = { tick: { interval: 5000 } }) {
  ws.send(JSON.stringify({ type: 'hello', id, capabilities }))
  const reply = await waitFor(messages, (m) => m.type === 'hello')
  assert.ok(reply, 'a hello reply arrives')
  return reply
}

/** A later joiner connects and returns its som-dump, or null when none arrives. */
async function joinAndReadDump(port, id) {
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, id)
    const dump = await waitFor(messages, (m) => m.type === 'som-dump', 4000)
    return dump
  } finally {
    ws.close()
  }
}

/** Read a dump exactly as the client's `_onSomDump` does. Throws on a bad dump. */
async function readDump(dump) {
  const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
  return io.readJSON({ json: dump.gltf, resources: {} })
}

async function startOwnerWorld() {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const state = { saves: 0 }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence,
    worldOwnerUserId: 'user-a',
    onSaveableMutation: () => { state.saves += 1 },
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req, 'user-a') })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, state }
}

/** An owner connection: its `add`s are world adds. */
async function owner(port, id = 'owner-a', capabilities) {
  const { ws, messages } = await connect(port)
  await hello(ws, messages, id, capabilities)
  return { ws, messages }
}

/** A visitor connection, with the server-assigned avatar name from hello. */
async function visitor(port, id) {
  const { ws, messages } = await connect(port)
  const reply = await hello(ws, messages, id)
  return { ws, messages, avatarName: reply.avatarNodeName }
}

/** An avatar add exactly as `AtriumClient.connect` sends it: ephemeral marker. */
function avatarAddMessage(id, avatarName, node) {
  return {
    type: 'add', id, seq: 7, format: 'gltf',
    node: {
      name: avatarName,
      ...node,
      extras: { displayName: id, atrium: { ephemeral: true }, ...(node.extras ?? {}) },
    },
  }
}

const pos3 = [0, 0, 0, 1, 0, 0, 0, 1, 0]

const UV = [0, 0, 1, 0, 0, 1]
const C4 = [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.5]

/** A world node carrying every R1 field. */
function richNode(name = 'rich') {
  return {
    name,
    translation: [1, 0.5, -2],
    mesh: {
      name: 'rich-mesh', extras: { lod: 0 },
      primitives: [
        {
          attributes: { POSITION: pos3, NORMAL: [0, 0, 1, 0, 0, 1, 0, 0, 1], TEXCOORD_0: UV, TEXCOORD_1: UV, COLOR_0: C4 },
          indices: [0, 1, 2],
          extras: { tag: 'p0' },
          material: {
            name: 'Marble', extras: { note: 'x' },
            pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1], metallicFactor: 0, roughnessFactor: 0.8 },
            emissiveFactor: [1, 0.5, 0], alphaMode: 'MASK', alphaCutoff: 0.25, doubleSided: true,
          },
        },
        {
          attributes: { POSITION: pos3, COLOR_0: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
          material: { emissiveFactor: [0, 0, 1], alphaMode: 'BLEND' },
        },
      ],
    },
  }
}

/** Every R1 field of a glTF-Transform node, as plain data. */
function fieldsOf(gltfNode) {
  const mesh = gltfNode.getMesh()
  return {
    meshName: mesh.getName(),
    meshExtras: mesh.getExtras(),
    primitives: mesh.listPrimitives().map((p) => {
      const m = p.getMaterial()
      return {
        extras: p.getExtras(),
        attributes: Object.fromEntries(p.listSemantics().slice().sort().map((s) => {
          const a = p.getAttribute(s)
          return [s, { type: a.getType(), componentType: a.getComponentType(), values: [...a.getArray()].map((v) => Math.fround(v)) }]
        })),
        material: m && {
          name: m.getName(), extras: m.getExtras(), emissive: [...m.getEmissiveFactor()],
          alphaMode: m.getAlphaMode(), alphaCutoff: m.getAlphaCutoff(), doubleSided: m.getDoubleSided(),
          baseColor: [...m.getBaseColorFactor()].map((v) => Math.fround(v)),
        },
      }
    }),
  }
}

const expected = () => {
  const f = (a) => a.map((v) => Math.fround(v))
  return {
    meshName: 'rich-mesh',
    meshExtras: { lod: 0 },
    primitives: [
      {
        extras: { tag: 'p0' },
        attributes: {
          COLOR_0: { type: 'VEC4', componentType: 5126, values: f(C4) },
          NORMAL: { type: 'VEC3', componentType: 5126, values: f([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
          POSITION: { type: 'VEC3', componentType: 5126, values: f(pos3) },
          TEXCOORD_0: { type: 'VEC2', componentType: 5126, values: f(UV) },
          TEXCOORD_1: { type: 'VEC2', componentType: 5126, values: f(UV) },
        },
        material: { name: 'Marble', extras: { note: 'x' }, emissive: [1, 0.5, 0], alphaMode: 'MASK', alphaCutoff: 0.25, doubleSided: true, baseColor: f([0.5, 0.5, 0.5, 1]) },
      },
      {
        extras: {},
        attributes: {
          COLOR_0: { type: 'VEC3', componentType: 5126, values: f([1, 0, 0, 0, 1, 0, 0, 0, 1]) },
          POSITION: { type: 'VEC3', componentType: 5126, values: f(pos3) },
        },
        material: { name: '', extras: {}, emissive: [0, 0, 1], alphaMode: 'BLEND', alphaCutoff: 0.5, doubleSided: false, baseColor: [1, 1, 1, 1] },
      },
    ],
  }
}

const nodeIn = (doc, name) => doc.getRoot().listNodes().find((n) => n.getName() === name)
const bufferCount = (world) => world.som._document.getRoot().listBuffers().length

// ---------------------------------------------------------------------------
// R1/R4 — a world add with every field: kept everywhere it goes
// ---------------------------------------------------------------------------

test('R1/R4: a world add with every richer field is kept by the server, a present client, a joiner and a save', async () => {
  const { world, port } = await startOwnerWorld()
  const o = await owner(port)
  const witness = await visitor(port, 'witness-rich')
  try {
    const before = bufferCount(world)
    o.ws.send(JSON.stringify({ type: 'add', seq: 3, format: 'gltf', node: richNode() }))
    const echo = await waitFor(o.messages, (m) => m.type === 'add' && m.requestSeq === 3)
    assert.ok(echo, `accepted: ${JSON.stringify(o.messages.find((m) => m.type === 'error'))}`)

    // the server
    assert.deepEqual(fieldsOf(nodeIn(world.som._document, 'rich')), expected(), 'the server keeps every field')
    assert.equal(bufferCount(world) - before, 1, 'one buffer for the whole add (R4)')

    // a present client, through its own ingestNode
    const broadcast = await waitFor(witness.messages, (m) => m.type === 'add' && m.node?.name === 'rich')
    assert.ok(broadcast, 'a present client receives the broadcast')
    const mirror = new SOMDocument(new Document())
    mirror.ingestNode(broadcast.node)
    assert.deepEqual(fieldsOf(nodeIn(mirror._document, 'rich')), expected(), 'a present client keeps every field')

    // a later joiner
    const dump = await joinAndReadDump(port, 'joiner-rich')
    const doc = await readDump(dump)
    assert.deepEqual(fieldsOf(nodeIn(doc, 'rich')), expected(), 'a joiner\u2019s som-dump keeps every field')

    // a save and a reload
    const first = await world.serialize()
    const rebuilt = await createWorldFromDocument(JSON.stringify(first))
    assert.deepEqual(fieldsOf(nodeIn(rebuilt.som._document, 'rich')), expected(), 'a reload keeps every field')
    const second = await rebuilt.serialize()
    assert.deepEqual(second.materials, first.materials, 'the re-save writes the same materials')
    assert.deepEqual(second.meshes, first.meshes, 'and the same meshes')

    // R4 — deleting the node prunes its buffer
    o.ws.send(JSON.stringify({ type: 'remove', seq: 4, node: 'rich' }))
    assert.ok(await waitFor(o.messages, (m) => m.type === 'remove' && m.requestSeq === 4), 'the remove is accepted')
    assert.equal(bufferCount(world), before, 'the buffer went with the node')
  } finally {
    o.ws.close(); witness.ws.close()
  }
})

test('R1: explicit defaults are accepted and kept as the defaults', async () => {
  const { world, port } = await startOwnerWorld()
  const o = await owner(port)
  try {
    o.ws.send(JSON.stringify({ type: 'add', seq: 3, node: {
      name: 'defaults',
      mesh: { primitives: [{ attributes: { POSITION: pos3 }, material: { alphaMode: 'OPAQUE', doubleSided: false, emissiveFactor: [0, 0, 0], name: '' } }] },
    } }))
    assert.ok(await waitFor(o.messages, (m) => m.type === 'add' && m.requestSeq === 3), 'accepted')
    const m = nodeIn(world.som._document, 'defaults').getMesh().listPrimitives()[0].getMaterial()
    assert.equal(m.getAlphaMode(), 'OPAQUE'); assert.equal(m.getDoubleSided(), false)
  } finally {
    o.ws.close()
  }
})

// ---------------------------------------------------------------------------
// R1 — refusals the schema lets through to the rule
// ---------------------------------------------------------------------------

test('R1: a cutoff without MASK, COLOR_0 out of range and atrium in a part extras are refused, broadcasting nothing', async () => {
  const { world, port } = await startOwnerWorld()
  const o = await owner(port)
  const witness = await visitor(port, 'witness-refuse')
  try {
    const cases = [
      ['material-value', { attributes: { POSITION: pos3 }, material: { alphaMode: 'BLEND', alphaCutoff: 0.5 } }],
      ['color-value', { attributes: { POSITION: pos3, COLOR_0: [1.5, 0, 0, 0, 1, 0, 0, 0, 1] } }],
      ['color-length', { attributes: { POSITION: pos3, COLOR_0: [1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1] } }],
      ['texcoord-length', { attributes: { POSITION: pos3, TEXCOORD_0: [0, 0, 1, 0] } }],
      ['part-extras', { attributes: { POSITION: pos3 }, extras: { atrium: {} } }],
      ['attribute-keys', { attributes: { POSITION: pos3, TEXCOORD_1: UV } }],
    ]
    let seq = 10
    for (const [code, prim] of cases) {
      seq += 1
      const name = `refused-${seq}`
      o.ws.send(JSON.stringify({ type: 'add', seq, node: { name, mesh: { primitives: [prim] } } }))
      const err = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === seq)
      assert.ok(err, `${code}: refused`)
      assert.equal(err.code, 'INVALID_VALUE', code)
      assert.ok(err.message.startsWith(`${code}:`), `${code}: ${err.message}`)
      assert.equal(world.som.getNodeByName(name), null, `${code}: nothing changed`)
    }
    await delay(100)
    assert.equal(witness.messages.filter((m) => m.type === 'add' && String(m.node?.name).startsWith('refused-')).length, 0, 'nothing broadcast')
  } finally {
    o.ws.close(); witness.ws.close()
  }
})

test('R1: a wire 1e999 inside a material extras is refused (Infinity after JSON.parse)', async () => {
  const { world, port } = await startOwnerWorld()
  const o = await owner(port)
  try {
    o.ws.send(`{"type":"add","seq":5,"node":{"name":"inf","mesh":{"primitives":[{"attributes":{"POSITION":[0,0,0,1,0,0,0,1,0]},"material":{"extras":{"a":[1e999]}}}]}}}`)
    const err = await waitFor(o.messages, (m) => m.type === 'error' && m.seq === 5)
    assert.ok(err, 'refused'); assert.ok(err.message.startsWith('part-extras:'), err.message)
    assert.equal(world.som.getNodeByName('inf'), null)
  } finally {
    o.ws.close()
  }
})

// ---------------------------------------------------------------------------
// R2 — avatars carry nothing new
// ---------------------------------------------------------------------------

test('R2: an avatar add with any richer field is refused with avatar-fields, broadcasting nothing', async () => {
  const { world, port } = await startOwnerWorld()
  const witness = await visitor(port, 'witness-r2')
  try {
    const fields = [
      { attributes: { POSITION: pos3, TEXCOORD_0: UV } },
      { attributes: { POSITION: pos3, COLOR_0: [1, 0, 0, 0, 1, 0, 0, 0, 1] } },
      { attributes: { POSITION: pos3 }, extras: { x: 1 } },
      { attributes: { POSITION: pos3 }, material: { name: 'Skin' } },
      { attributes: { POSITION: pos3 }, material: { emissiveFactor: [1, 0, 0] } },
      { attributes: { POSITION: pos3 }, material: { alphaMode: 'BLEND' } },
      { attributes: { POSITION: pos3 }, material: { doubleSided: true } },
      { attributes: { POSITION: pos3 }, material: { extras: { x: 1 } } },
    ]
    let i = 0
    for (const prim of [...fields, null]) {
      i += 1
      const id = `visitor-r2-${i}`
      const v = await visitor(port, id)
      try {
        const mesh = prim ? { primitives: [prim] } : { extras: { x: 1 }, primitives: [{ attributes: { POSITION: pos3 } }] }
        v.ws.send(JSON.stringify(avatarAddMessage(id, v.avatarName, { mesh })))
        const err = await waitFor(v.messages, (m) => m.type === 'error')
        assert.ok(err, `case ${i}: refused`)
        assert.equal(err.code, 'INVALID_VALUE')
        assert.ok(err.message.startsWith('avatar-fields:'), `case ${i}: ${err.message}`)
        assert.equal(world.som.getNodeByName(v.avatarName), null, `case ${i}: nothing changed`)
      } finally {
        v.ws.close()
      }
    }
    await delay(100)
    assert.equal(witness.messages.filter((m) => m.type === 'add').length, 0, 'nothing broadcast')
  } finally {
    witness.ws.close()
  }
})
