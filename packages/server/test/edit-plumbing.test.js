// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-plumbing — Phase 3 step 1a (contract A1–A10).
//
// Real WebSocket servers over BOTH world types (createWorld file worlds and
// createWorldFromDocument document worlds). Every server binds port 0 and is
// closed in after(); every socket is closed in finally. No mocks.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { validate } from '@atrium/protocol'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import { createSessionServer, attachSessionHandlers } from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = (name) => resolve(__dirname, '../../../tests/fixtures/', name)
const SPACE     = FIXTURE('space.gltf')
const SPACE_CAM = FIXTURE('space-cameras.gltf')
const SPACE_LIT = FIXTURE('space-lights.gltf')
const SPACE_EXT = FIXTURE('space-ext.gltf')

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

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

async function waitFor(messages, pred, timeoutMs = 2000) {
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
    type: 'hello',
    id,
    capabilities: { tick: { interval: 5000 } },
  }))
  const reply = await waitFor(messages, m => m.type === 'hello')
  assert.ok(reply, 'hello reply should arrive')
  return reply
}

async function waitForNode(world, name, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const node = world.som.getNodeByName(name)
    if (node) return node
    await delay(10)
  }
  return null
}

// Send an avatar add for `id` and wait until the server has the node.
async function addAvatar(ws, world, id, extra = {}) {
  const nodeName = `avatar-${id.slice(0, 8)}`
  ws.send(JSON.stringify({
    type: 'add', id, seq: 1000, format: 'gltf',
    node: { name: nodeName, translation: [0, 0, 0] },
    ...extra,
  }))
  const node = await waitForNode(world, nodeName)
  return { nodeName, node }
}

// Expect an error for `message` and assert nothing was broadcast.
async function expectError(ws, messages, message, expectedCode) {
  const countBefore = messages.length
  ws.send(JSON.stringify(message))
  const err = await waitFor(messages, m => m.type === 'error' && m.seq === message.seq)
  assert.ok(err, `expected an error for seq ${message.seq}`)
  assert.equal(err.code, expectedCode, `expected ${expectedCode}, got ${err.code}`)
  await delay(60)
  const broadcasts = messages.slice(countBefore)
    .filter(m => ['set', 'add', 'remove'].includes(m.type))
  assert.deepEqual(broadcasts, [], 'a refusal broadcasts nothing')
  return err
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

async function startOpenWorld(gltfPath) {
  const world = await createWorld(gltfPath)
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

async function startHandlerWorld({
  world, ownerUserId = null, connectAs = null, anonymous = false, mutationPolicy,
  onSaveableMutation = null,
}) {
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const socketUserId = anonymous ? null : (connectAs ?? ownerUserId)

  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence,
    worldOwnerUserId: ownerUserId,
    mutationPolicy,
    onSaveableMutation,
  })

  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, socketUserId)
    })
  })

  closers.push(async () => {
    closeKeepalive()
    wss.close()
    http.close()
  })

  return { world, port, sessions }
}

// A file world whose external references are resolved (externalNodeNames filled).
async function externalWorld() {
  const world = await createWorld(SPACE_EXT)
  await world.resolveExternalReferences()
  return world
}

// Document worlds: inline any external buffer so createWorldFromDocument can
// resolve the geometry.
async function loadDocumentJson(gltfPath) {
  const json = JSON.parse(await readFile(gltfPath, 'utf8'))
  for (const buffer of json.buffers ?? []) {
    if (buffer.uri && !buffer.uri.startsWith('data:')) {
      const bin = await readFile(resolve(dirname(gltfPath), buffer.uri))
      buffer.uri = 'data:application/octet-stream;base64,' + bin.toString('base64')
    }
  }
  return json
}

async function startOpenDocumentWorld(json) {
  const world = await createWorldFromDocument(json)
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port }
}

// ===========================================================================
// A1 — the canEdit matrix
// ===========================================================================

test('A1: an anonymous visitor in an owner world gets canEdit false', async () => {
  const { port } = await startHandlerWorld({
    world: await createWorld(SPACE), ownerUserId: 'user-a', anonymous: true,
  })
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, 'anon')
    assert.equal(reply.canEdit, false)
    assert.equal(reply.canPlaceTeleporters, false)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A1: a non-owner gets canEdit false; the owner gets canEdit true', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a', connectAs: 'user-b' })
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, 'non-owner')
    assert.equal(reply.canEdit, false)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A1: the world owner gets canEdit true, equal to canPlaceTeleporters', async () => {
  const { port } = await startHandlerWorld({ world: await createWorld(SPACE), ownerUserId: 'user-a' })
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, 'owner')
    assert.equal(reply.canEdit, true)
    assert.equal(reply.canPlaceTeleporters, reply.canEdit)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A1: an ownerless (open) world gives canEdit false', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, 'open-world')
    assert.equal(reply.canEdit, false)
    assert.equal(reply.canPlaceTeleporters, false)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A1: a read-only commons gives canEdit false even to the owner', async () => {
  const { port } = await startHandlerWorld({
    world: await createWorld(SPACE), ownerUserId: 'user-a', mutationPolicy: 'read-only',
  })
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, 'read-only')
    assert.equal(reply.canEdit, false)
    assert.equal(reply.canPlaceTeleporters, false)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// A2 — requestSeq and session on request-caused broadcasts
// ===========================================================================

test('A2: a set broadcast carries requestSeq and session', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'set-echo')
    ws.send(JSON.stringify({ type: 'send', seq: 7, node: 'crate-01', field: 'translation', value: [1, 2, 3] }))
    const set = await waitFor(messages, m => m.type === 'set' && m.node === 'crate-01')
    assert.ok(set)
    assert.equal(set.requestSeq, 7)
    assert.equal(set.session, 'set-echo')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A2: an add broadcast carries requestSeq and session', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'add-echo')
    ws.send(JSON.stringify({ type: 'add', seq: 11, node: { name: 'box-01' } }))
    const add = await waitFor(messages, m => m.type === 'add' && m.node?.name === 'box-01')
    assert.ok(add)
    assert.equal(add.requestSeq, 11)
    assert.equal(add.session, 'add-echo')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A2: a remove broadcast carries requestSeq and session', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'remove-echo')
    ws.send(JSON.stringify({ type: 'remove', seq: 13, node: 'crate-01' }))
    const remove = await waitFor(messages, m => m.type === 'remove' && m.node === 'crate-01')
    assert.ok(remove)
    assert.equal(remove.requestSeq, 13)
    assert.equal(remove.session, 'remove-echo')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A2: an avatar add carries neither requestSeq nor session; the disconnect remove validates', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const a = await connect(port)
  const b = await connect(port)
  try {
    await hello(a.ws, a.messages, 'aaaa1111')
    await hello(b.ws, b.messages, 'bbbb2222')
    await addAvatar(a.ws, world, 'aaaa1111')

    const avatarAdd = await waitFor(b.messages, m => m.type === 'add' && m.id === 'aaaa1111')
    assert.ok(avatarAdd, 'the peer sees the avatar add')
    assert.equal(avatarAdd.requestSeq, undefined)
    assert.equal(avatarAdd.session, undefined)
    assert.equal(validate('server', avatarAdd).valid, true)

    // The disconnect broadcast.
    a.ws.close()
    await waitForClose(a.ws)
    const disco = await waitFor(b.messages, m => m.type === 'remove' && m.id === 'aaaa1111')
    assert.ok(disco, 'the peer sees the disconnect remove')
    assert.equal(disco.node, undefined)
    assert.equal(validate('server', disco).valid, true, 'the disconnect remove validates as a server message')
  } finally {
    b.ws.close(); await waitForClose(b.ws)
  }
})

test('A2: every server-emitted broadcast validates against its schema', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const a = await connect(port)
  const b = await connect(port)
  const seen = []
  try {
    for (const side of [a, b]) {
      side.ws.on('message', (raw) => {
        try { seen.push(JSON.parse(raw)) } catch { /* ignore */ }
      })
    }

    await hello(a.ws, a.messages, 'aaaa3333')
    await hello(b.ws, b.messages, 'bbbb4444')
    await addAvatar(a.ws, world, 'aaaa3333')

    a.ws.send(JSON.stringify({ type: 'send', seq: 21, node: 'crate-01', field: 'translation', value: [0, 1, 0] }))
    await waitFor(a.messages, m => m.type === 'set' && m.requestSeq === 21)
    a.ws.send(JSON.stringify({ type: 'add', seq: 22, node: { name: 'box-77' } }))
    await waitFor(a.messages, m => m.type === 'add' && m.node?.name === 'box-77')
    a.ws.send(JSON.stringify({ type: 'remove', seq: 23, node: 'box-77' }))
    await waitFor(a.messages, m => m.type === 'remove' && m.requestSeq === 23)
    a.ws.send(JSON.stringify({ type: 'send', seq: 24, node: 'crate-01', field: 'name', value: 'Box' }))
    await waitFor(a.messages, m => m.type === 'set' && m.requestSeq === 24)

    b.ws.close()
    await waitForClose(b.ws)
    await delay(80)

    const schemaTypes = new Set(['hello', 'join', 'leave', 'view', 'set', 'add', 'remove', 'som-dump', 'pong'])
    for (const msg of seen) {
      if (!schemaTypes.has(msg.type)) continue
      const { valid, errors } = validate('server', msg)
      assert.equal(valid, true,
        `server broadcast ${msg.type} must validate: ${JSON.stringify(msg)} — ${JSON.stringify(errors)}`)
    }
    assert.ok(seen.some(m => m.type === 'remove' && m.id === 'bbbb4444'),
      'the disconnect remove was part of the sample')
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

// ===========================================================================
// A4 — avatar and external-node protection
// ===========================================================================

test('A4: removing a peer avatar is refused for the owner', async () => {
  const world = await createWorld(SPACE)
  let saves = 0
  const { port } = await startHandlerWorld({
    world, ownerUserId: 'user-a', onSaveableMutation: () => { saves++ },
  })
  const a = await connect(port)
  const b = await connect(port)
  try {
    await hello(a.ws, a.messages, 'aaaa5555')
    await hello(b.ws, b.messages, 'bbbb6666')
    await addAvatar(a.ws, world, 'aaaa5555')
    const { nodeName } = await addAvatar(b.ws, world, 'bbbb6666')
    const savesBefore = saves

    await expectError(a.ws, a.messages, { type: 'remove', seq: 31, node: nodeName }, 'PERMISSION_DENIED')
    assert.ok(world.som.getNodeByName(nodeName), 'the peer avatar survives')
    assert.equal(saves, savesBefore, 'a refusal saves nothing')
  } finally {
    a.ws.close(); b.ws.close()
    await Promise.all([waitForClose(a.ws), waitForClose(b.ws)])
  }
})

test('A4: removing the owner\'s own avatar is refused', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const a = await connect(port)
  try {
    await hello(a.ws, a.messages, 'aaaa7777')
    const { nodeName } = await addAvatar(a.ws, world, 'aaaa7777')
    await expectError(a.ws, a.messages, { type: 'remove', seq: 32, node: nodeName }, 'PERMISSION_DENIED')
    assert.ok(world.som.getNodeByName(nodeName))
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

test('A4: removing an externally loaded node is refused', async () => {
  const world = await externalWorld()
  assert.ok(world.externalNodeNames.size > 0, 'the fixture has external nodes')
  const target = [...world.externalNodeNames][0]
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'ext-remove')
    await expectError(ws, messages, { type: 'remove', seq: 33, node: target }, 'PERMISSION_DENIED')
    assert.ok(world.som.getNodeByName(target), 'the external node survives')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A4: removing a node whose subtree holds a live avatar is refused', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const a = await connect(port)
  try {
    await hello(a.ws, a.messages, 'aaaa8888')
    const { node, nodeName } = await addAvatar(a.ws, world, 'aaaa8888')
    assert.ok(node)

    // Build the wrapper through the SOM directly: the wire now refuses an
    // `add` under an avatar.
    const wrapper = world.som.createNode({ name: 'wrapper' })
    world.som.scene.addChild(wrapper)
    wrapper.addChild(node)

    await expectError(a.ws, a.messages, { type: 'remove', seq: 34, node: 'wrapper' }, 'PERMISSION_DENIED')
    assert.ok(world.som.getNodeByName('wrapper'), 'nothing was removed')
    assert.ok(world.som.getNodeByName(nodeName), 'the avatar survives')
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

test('A4: an avatar add carrying a parent is refused for the owner', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'aaaa9999')
    const nodeName = `avatar-${'aaaa9999'.slice(0, 8)}`
    await expectError(ws, messages, {
      type: 'add', id: 'aaaa9999', seq: 35, parent: 'crate-01',
      node: { name: nodeName },
    }, 'PERMISSION_DENIED')
    assert.equal(world.som.getNodeByName(nodeName), null, 'no avatar node was created')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A4: an avatar add carrying a parent is refused for a non-owner visitor', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a', connectAs: 'user-b' })
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'bbbb1111')
    const nodeName = `avatar-${'bbbb1111'.slice(0, 8)}`
    await expectError(ws, messages, {
      type: 'add', id: 'bbbb1111', seq: 36, parent: 'crate-01',
      node: { name: nodeName },
    }, 'PERMISSION_DENIED')
    assert.equal(world.som.getNodeByName(nodeName), null)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A4: adding under a live avatar is refused', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const a = await connect(port)
  try {
    await hello(a.ws, a.messages, 'aaaa1212')
    const { nodeName } = await addAvatar(a.ws, world, 'aaaa1212')
    await expectError(a.ws, a.messages, {
      type: 'add', seq: 37, parent: nodeName, node: { name: 'hat' },
    }, 'PERMISSION_DENIED')
    assert.equal(world.som.getNodeByName('hat'), null)
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

test('A4: adding under a descendant of an avatar is refused (defence in depth)', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const a = await connect(port)
  try {
    await hello(a.ws, a.messages, 'aaaa1313')
    const { node } = await addAvatar(a.ws, world, 'aaaa1313')
    // Build the descendant through the SOM directly.
    const hat = world.som.createNode({ name: 'hat' })
    node.addChild(hat)

    await expectError(a.ws, a.messages, {
      type: 'add', seq: 38, parent: 'hat', node: { name: 'toy' },
    }, 'PERMISSION_DENIED')
    assert.equal(world.som.getNodeByName('toy'), null)
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

test('A4: adding under an externally loaded node is refused', async () => {
  const world = await externalWorld()
  const target = [...world.externalNodeNames][0]
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'ext-parent')
    await expectError(ws, messages, {
      type: 'add', seq: 39, parent: target, node: { name: 'graft' },
    }, 'PERMISSION_DENIED')
    assert.equal(world.som.getNodeByName('graft'), null)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A4/A9: a send to an externally loaded node is refused', async () => {
  const world = await externalWorld()
  const target = [...world.externalNodeNames][0]
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'ext-send')
    await expectError(ws, messages, {
      type: 'send', seq: 40, node: target, field: 'translation', value: [1, 1, 1],
    }, 'PERMISSION_DENIED')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// A5 — name rules on add
// ===========================================================================

test('A5: every D3 forbidden new name is refused on add with INVALID_VALUE', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'names')
    let seq = 50
    const bad = [
      '__document__',
      'Foo.camera',
      'Foo.light',
      'a/b',
      'a'.repeat(257),
      'crate-01',      // duplicate
      'lamp-01',       // duplicate
    ]
    for (const name of bad) {
      await expectError(ws, messages, { type: 'add', seq: seq++, node: { name } }, 'INVALID_VALUE')
    }
    for (const name of ['__document__', 'Foo.camera', 'Foo.light', 'a/b', 'a'.repeat(257)]) {
      assert.equal(world.som.getNodeByName(name), null, `"${name}" must not have been added`)
    }
    assert.ok(world.som.getNodeByName('crate-01'), 'the pre-existing nodes are untouched')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// A8 — rename over the wire
// ===========================================================================

test('A8: a rename is accepted, broadcast with requestSeq, and persisted', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-ok')
    ws.send(JSON.stringify({ type: 'send', seq: 60, node: 'crate-01', field: 'name', value: 'Box' }))
    const set = await waitFor(messages, m => m.type === 'set' && m.field === 'name')
    assert.ok(set, 'the rename is broadcast')
    assert.equal(set.node, 'crate-01', 'the broadcast names the OLD name')
    assert.equal(set.value, 'Box')
    assert.equal(set.requestSeq, 60)
    assert.equal(set.session, 'rename-ok')
    assert.equal(world.getNode('Box').name, 'Box')
    assert.equal(world.getNode('crate-01'), null)

    // Persisted: serialize and reload.
    const json = await world.serialize()
    const reloaded = await createWorldFromDocument(json)
    assert.equal(reloaded.getNode('Box').name, 'Box')
    assert.equal(reloaded.getNode('crate-01'), null)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A8: renaming onto an existing name is INVALID_VALUE, not INVALID_FIELD', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-dup')
    const err = await expectError(ws, messages,
      { type: 'send', seq: 61, node: 'crate-01', field: 'name', value: 'lamp-01' }, 'INVALID_VALUE')
    assert.match(err.message, /already in use/)
    assert.equal(world.getNode('crate-01').name, 'crate-01')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A8: renaming onto a reserved name is INVALID_VALUE', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-reserved')
    await expectError(ws, messages,
      { type: 'send', seq: 62, node: 'crate-01', field: 'name', value: '__document__' }, 'INVALID_VALUE')
    await expectError(ws, messages,
      { type: 'send', seq: 63, node: 'crate-01', field: 'name', value: 'x/y' }, 'INVALID_VALUE')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A8: renaming a node onto an animation\'s name is refused', async () => {
  const { port } = await startOpenWorld(FIXTURE('space-anim.gltf'))
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-anim')
    await expectError(ws, messages,
      { type: 'send', seq: 64, node: 'crate-01', field: 'name', value: 'CrateRotate' }, 'INVALID_VALUE')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A8: a rename of a live avatar is refused', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const a = await connect(port)
  try {
    await hello(a.ws, a.messages, 'aaaa1414')
    const { nodeName } = await addAvatar(a.ws, world, 'aaaa1414')
    await expectError(a.ws, a.messages,
      { type: 'send', seq: 65, node: nodeName, field: 'name', value: 'NotAnAvatar' }, 'PERMISSION_DENIED')
    assert.equal(world.som.getNodeByName(nodeName).name, nodeName)
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})

test('A8: a rename of an externally loaded node is refused', async () => {
  const world = await externalWorld()
  const target = [...world.externalNodeNames][0]
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-ext')
    await expectError(ws, messages,
      { type: 'send', seq: 66, node: target, field: 'name', value: 'Renamed' }, 'PERMISSION_DENIED')
    assert.equal(world.som.getNodeByName(target).name, target)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A8: a rename of a camera host is INVALID_VALUE (D4)', async () => {
  const { world, port } = await startOpenWorld(SPACE_CAM)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-camhost')
    const hostName = world.som.nodes.find(n => n.camera)?.name
    assert.ok(hostName, 'the fixture has a camera host')
    await expectError(ws, messages,
      { type: 'send', seq: 67, node: hostName, field: 'name', value: 'Renamed' }, 'INVALID_VALUE')
    assert.equal(world.som.getNodeByName(hostName).name, hostName)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A8: a rename of a light host is INVALID_VALUE (D4)', async () => {
  const { world, port } = await startOpenWorld(SPACE_LIT)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-lighthost')
    const hostName = world.som.nodes.find(n => n.light)?.name
    assert.ok(hostName, 'the fixture has a light host')
    await expectError(ws, messages,
      { type: 'send', seq: 68, node: hostName, field: 'name', value: 'Renamed' }, 'INVALID_VALUE')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// R3 revision — a rename acts only on the object that was authorized
// ===========================================================================

test('K5(b): a legacy duplicate name resolves to one node — rename reaches the first', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-k5b')

    // Two nodes sharing a name, built through the SOM (not the wire). K5(b) —
    // both maps keep the FIRST, so send, remove and rename reach one node.
    const first  = world.som.ingestNode({ name: 'r3-dup' })
    const second = world.som.ingestNode({ name: 'r3-dup' })
    assert.notEqual(first, second)
    assert.equal(world.som.getObjectByName('r3-dup'), first, 'the namespace keeps the first')
    assert.equal(world.som.getNodeByName('r3-dup'), first, 'the node map keeps the first too')

    ws.send(JSON.stringify({ type: 'send', seq: 69, node: 'r3-dup', field: 'name', value: 'r3-renamed' }))
    const set = await waitFor(messages, m => m.type === 'set' && m.field === 'name')
    assert.equal(set.value, 'r3-renamed')

    assert.equal(first.name, 'r3-renamed', 'the first node was renamed')
    assert.equal(second.name, 'r3-dup', 'the second node is untouched')
    // K5(b) take-over — the freed name passes to the next node that holds it.
    assert.equal(world.som.getNodeByName('r3-dup'), second, 'the second node took the name over')
    assert.equal(world.som.getNodeByName('r3-renamed'), first)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('R3: a rename whose resolved target is not the named node is INVALID_VALUE', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-r3')

    const first  = world.som.ingestNode({ name: 'r3-dup' })
    const second = world.som.ingestNode({ name: 'r3-dup' })

    // Inject the divergence directly. Under K5(b) the two ingestNode calls
    // agree, so the disagreement a diverged client's SOM can present is built
    // here: the global namespace names one node, the node map another.
    world.som._nodesByName.set('r3-dup', second)
    assert.equal(world.som.getObjectByName('r3-dup'), first)
    assert.equal(world.som.getNodeByName('r3-dup'), second)

    const err = await expectError(ws, messages,
      { type: 'send', seq: 69, node: 'r3-dup', field: 'name', value: 'r3-renamed' }, 'INVALID_VALUE')
    assert.match(err.message, /not the named node/)

    assert.equal(second.name, 'r3-dup', 'the node renameNode would have renamed is untouched')
    assert.equal(first.name, 'r3-dup', 'the authorized object is untouched too')
    assert.equal(world.som.getNodeByName('r3-renamed'), null, 'no node took the new name')
    assert.equal(world.som.getObjectByName('r3-renamed'), null)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A8: a non-string rename value is INVALID_VALUE', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'rename-badvalue')
    await expectError(ws, messages,
      { type: 'send', seq: 69, node: 'crate-01', field: 'name', value: 42 }, 'INVALID_VALUE')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// A6 — subtree remove over the wire
// ===========================================================================

test('A6: removing a parent removes the child, frees its name and persists', async () => {
  const { world, port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'subtree')
    ws.send(JSON.stringify({ type: 'add', seq: 70, node: { name: 'P' } }))
    await waitFor(messages, m => m.type === 'add' && m.node?.name === 'P')
    ws.send(JSON.stringify({ type: 'add', seq: 71, parent: 'P', node: { name: 'C' } }))
    await waitFor(messages, m => m.type === 'add' && m.node?.name === 'C')
    assert.ok(world.som.getNodeByName('C'))

    ws.send(JSON.stringify({ type: 'remove', seq: 72, node: 'P' }))
    const remove = await waitFor(messages, m => m.type === 'remove' && m.node === 'P')
    assert.ok(remove)
    assert.equal(remove.requestSeq, 72)

    assert.equal(world.som.getNodeByName('P'), null)
    assert.equal(world.som.getNodeByName('C'), null, 'the child went with the parent')

    const json = await world.serialize()
    const names = (json.nodes ?? []).map(n => n.name)
    assert.equal(names.includes('C'), false, 'the child is not in the saved document')
    assert.equal(names.includes('P'), false)

    // The name is free again.
    ws.send(JSON.stringify({ type: 'add', seq: 73, node: { name: 'C' } }))
    const readd = await waitFor(messages, m => m.type === 'add' && m.node?.name === 'C')
    assert.ok(readd, 'the freed name can be reused')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A6/C8: removing an external container drops its subtree names from externalNodeNames', async () => {
  const world = await externalWorld()
  // The container node itself is not in externalNodeNames; its ingested
  // children are. Remove a child and its names leave the set.
  const target = [...world.externalNodeNames][0]
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a' })
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'ext-cleanup')
    // The A4 rule refuses an external node, so remove it through the world API
    // (the server's own cleanup path) and check the bookkeeping.
    assert.equal(world.removeNode(target).ok, true)
    assert.equal(world.externalNodeNames.has(target), false, 'the name left the external set')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// A4 — unknown node and the gate keep their codes
// ===========================================================================

test('A4: an unknown node reached by a permitted session is NODE_NOT_FOUND with its seq', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'unknown')
    const err = await expectError(ws, messages,
      { type: 'remove', seq: 80, node: 'nonexistent-node-xyz' }, 'NODE_NOT_FOUND')
    assert.equal(err.seq, 80)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('A4: a non-owner remove keeps the mutation gate\'s PERMISSION_DENIED', async () => {
  const world = await createWorld(SPACE)
  const { port } = await startHandlerWorld({ world, ownerUserId: 'user-a', connectAs: 'user-b' })
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'gate-first')
    await expectError(ws, messages, { type: 'remove', seq: 81, node: 'crate-01' }, 'PERMISSION_DENIED')
    assert.ok(world.som.getNodeByName('crate-01'))
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// D8 — the teleporter destination messages
// ===========================================================================

test('D8: a non-string destination gets its own message on send', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'd8-send')
    const err = await expectError(ws, messages, {
      type: 'send', seq: 90, node: 'crate-01',
      field: 'extras.atrium.teleporter.destination', value: 1234,
    }, 'INVALID_VALUE')
    assert.match(err.message, /must be a string/)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('D8: a 2049-character destination gets the length message on send', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'd8-len')
    const err = await expectError(ws, messages, {
      type: 'send', seq: 91, node: 'crate-01',
      field: 'extras.atrium.teleporter.destination', value: 'x'.repeat(2049),
    }, 'INVALID_VALUE')
    assert.match(err.message, /2048/)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('C4: a non-string destination on add is accepted (D8 covers send only)', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'd8-add')
    // C4 — the add path's destination check is unchanged in 1a. A non-string
    // destination on `add` is not refused here (the D8 message split applies to
    // `send` only); it is carried through as today.
    ws.send(JSON.stringify({
      type: 'add', seq: 92,
      node: { name: 'pad-a', extras: { atrium: { teleporter: { destination: 42 } } } },
    }))
    const added = await waitFor(messages, m => m.type === 'add' && m.node?.name === 'pad-a')
    assert.ok(added, 'a non-string destination on add is accepted (unchanged in 1a)')

    // The length cap on the add path is unchanged: a 2049-char destination is
    // still refused with the same message as before.
    const long = await expectError(ws, messages, {
      type: 'add', seq: 93,
      node: { name: 'pad-b', extras: { atrium: { teleporter: { destination: 'x'.repeat(2049) } } } },
    }, 'INVALID_VALUE')
    assert.match(long.message, /2048/)
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// §8.2 — authority: the client cannot claim requestSeq
// ===========================================================================

test('§8.2: a client that sends requestSeq itself is refused by the client schema', async () => {
  const { port } = await startOpenWorld(SPACE)
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'claim-seq')
    await expectError(ws, messages, {
      type: 'send', seq: 95, node: 'crate-01', field: 'translation', value: [0, 0, 0], requestSeq: 4,
    }, 'UNKNOWN_MESSAGE')
    await expectError(ws, messages, {
      type: 'add', seq: 96, requestSeq: 4, node: { name: 'sneaky' },
    }, 'UNKNOWN_MESSAGE')
    await expectError(ws, messages, {
      type: 'remove', seq: 97, node: 'crate-01', session: 'someone-else',
    }, 'UNKNOWN_MESSAGE')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

// ===========================================================================
// Document worlds — the same contract over the other world type
// ===========================================================================

test('document world: canEdit, rename and requestSeq all work', async () => {
  const { world, port } = await startOpenDocumentWorld(await loadDocumentJson(SPACE))
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, 'doc-world')
    assert.equal(typeof reply.canEdit, 'boolean')

    ws.send(JSON.stringify({ type: 'send', seq: 100, node: 'crate-01', field: 'name', value: 'Box' }))
    const set = await waitFor(messages, m => m.type === 'set' && m.field === 'name')
    assert.ok(set)
    assert.equal(set.requestSeq, 100)
    assert.equal(world.getNode('Box').name, 'Box')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})

test('document world: a duplicate rename is INVALID_VALUE', async () => {
  const { port } = await startOpenDocumentWorld(await loadDocumentJson(SPACE))
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'doc-dup')
    await expectError(ws, messages,
      { type: 'send', seq: 101, node: 'crate-01', field: 'name', value: 'lamp-01' }, 'INVALID_VALUE')
  } finally {
    ws.close(); await waitForClose(ws)
  }
})
