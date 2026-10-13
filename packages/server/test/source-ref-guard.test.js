// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// source-ref-guard — security tests for extras.atrium.source.
//
//   S1: document worlds never fetch external references on the server; the
//       server logs a count-only warning and externalNodeNames stays empty.
//   S2: no client may set extras.atrium.source — not the owner, not an avatar,
//       in any world (including an open one) — via add or send.
//   S3: the guards are exported pure functions, unit-tested here.
//
// Every server is created with port 0 (no collisions with other suites) and
// closed in after(); every socket is closed in finally.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld, createWorldFromDocument } from '../src/world.js'
import {
  createSessionServer,
  attachSessionHandlers,
  addSetsAtriumSource,
  sendSetsAtriumSource,
} from '../src/session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_FIXTURE = resolve(__dirname, '../../../tests/fixtures/space-ext.gltf')

const SOURCE_URL = 'https://evil.example.com/x.glb'
const DENIED_MESSAGE = 'extras.atrium.source cannot be set by clients'

// ---------------------------------------------------------------------------
// Lifecycle: every server/canary created here is closed in after().
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

// Collect every parsed message the socket receives.
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

const isType = (type) => (m) => m.type === type

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
  const reply = await waitFor(messages, isType('hello'))
  assert.ok(reply, 'hello reply should arrive')
  return reply
}

// ---------------------------------------------------------------------------
// Servers / worlds
// ---------------------------------------------------------------------------

// A document world: Parent (with one child) + Child + Plain.
// extras.atrium exists on Parent/Child but never carries `source`.
function documentJson({ withSource = false } = {}) {
  const nodes = [
    { name: 'Parent', children: [1], extras: { atrium: { teleporter: { destination: '#' } } } },
    { name: 'Child', extras: { atrium: { teleporter: { destination: '#' } } } },
    { name: 'Plain' },
  ]
  if (withSource) {
    nodes.push({ name: 'Container', extras: { atrium: { source: SOURCE_URL } } })
  }
  return JSON.stringify({
    asset: { version: '2.0', generator: 'source-ref-guard-test' },
    scenes: [{ nodes: withSource ? [0, 2, 3] : [0, 2] }],
    nodes,
  })
}

// Open (no-owner) world via createSessionServer — only the source guard can
// refuse here, since policy 'open' permits every mutation.
async function startOpenServer() {
  const world = await createWorldFromDocument(documentJson())
  const http = createServer()
  const port = await listen(http)
  const server = createSessionServer({ httpServer: http, maxUsers: 10, world })
  closers.push(() => server.close())
  return { world, port, server }
}

// Owner-gated world via attachSessionHandlers — every connection arrives as
// the authenticated owner (the reported attack path).
async function startOwnerServer(ownerUserId = 'owner-001') {
  const world = await createWorldFromDocument(documentJson())
  const http = createServer()
  const port = await listen(http)

  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }

  const { closeKeepalive } = attachSessionHandlers({
    wss,
    world,
    sessions,
    presence,
    worldOwnerUserId: ownerUserId,
  })

  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, ownerUserId)
    })
  })

  closers.push(async () => {
    closeKeepalive()
    wss.close()
    http.close()
  })

  return { world, port, wss, sessions }
}

// ---------------------------------------------------------------------------
// Pure guards (S3)
// ---------------------------------------------------------------------------

test('pure addSetsAtriumSource: extras.atrium.source (any value) is detected', () => {
  assert.equal(addSetsAtriumSource({ extras: { atrium: { source: SOURCE_URL } } }), true)
  assert.equal(addSetsAtriumSource({ extras: { atrium: { source: null } } }), true)
  assert.equal(addSetsAtriumSource({ extras: { atrium: { source: '' } } }), true)
})

test('pure addSetsAtriumSource: ordinary extras are allowed', () => {
  assert.equal(addSetsAtriumSource({ extras: { atrium: { teleporter: { destination: '#' } } } }), false)
  assert.equal(addSetsAtriumSource({ extras: { source: SOURCE_URL } }), false)
  assert.equal(addSetsAtriumSource({ extras: { displayName: 'x' } }), false)
  assert.equal(addSetsAtriumSource({ extras: {} }), false)
  assert.equal(addSetsAtriumSource({ name: 'no-extras' }), false)
  assert.equal(addSetsAtriumSource({}), false)
})

test('pure addSetsAtriumSource: missing/node-less input is allowed', () => {
  assert.equal(addSetsAtriumSource(undefined), false)
  assert.equal(addSetsAtriumSource(null), false)
  assert.equal(addSetsAtriumSource({ extras: { atrium: null } }), false)
})

test('pure sendSetsAtriumSource: direct path and any path beneath it are detected', () => {
  const paths = [
    'extras.atrium.source',
    'extras.atrium.source.url',
    '.extras.atrium.source',
    'extras..atrium...source',
    'children[0].extras.atrium.source',
    'children[0].extras..atrium.source',
  ]
  for (const field of paths) {
    assert.equal(sendSetsAtriumSource(field, SOURCE_URL), true, `expected refusal for "${field}"`)
  }
})

test('pure sendSetsAtriumSource: whole-object extras.atrium replacement is detected', () => {
  const cases = [
    ['extras.atrium', { source: SOURCE_URL }],
    ['extras.atrium', { source: null }],
    ['extras..atrium', { source: SOURCE_URL }],
    ['parent.extras.atrium', { source: SOURCE_URL }],
    ['.extras.atrium', { source: SOURCE_URL }],
  ]
  for (const [field, value] of cases) {
    assert.equal(sendSetsAtriumSource(field, value), true, `expected refusal for "${field}"`)
  }
})

test('pure sendSetsAtriumSource: whole-object extras replacement (any depth) is detected', () => {
  const cases = [
    ['extras', { atrium: { source: SOURCE_URL } }],
    ['extras', { atrium: { source: null } }],
    ['.extras', { atrium: { source: SOURCE_URL } }],
    ['extras..', { atrium: { source: SOURCE_URL } }],
    ['parent.extras', { atrium: { source: SOURCE_URL } }],
    ['children[0].extras', { atrium: { source: null } }],
    ['scene.children[0].extras', { atrium: { source: SOURCE_URL } }],
    ['parent.children[0].extras', { atrium: { source: SOURCE_URL } }],
  ]
  for (const [field, value] of cases) {
    assert.equal(sendSetsAtriumSource(field, value), true, `expected refusal for "${field}"`)
  }
})

test('pure sendSetsAtriumSource: ordinary writes are allowed', () => {
  assert.equal(sendSetsAtriumSource('extras.atrium.sourceCount', 3), false)
  assert.equal(sendSetsAtriumSource('extras.atrium.teleporter.destination', SOURCE_URL), false)
  assert.equal(sendSetsAtriumSource('extras.displayName', 'x'), false)
  assert.equal(sendSetsAtriumSource('translation', [0, 0, 0]), false)
  assert.equal(sendSetsAtriumSource('extras.atrium.teleporter', { destination: '#' }), false)
  assert.equal(sendSetsAtriumSource('extras', { atrium: { teleporter: { destination: '#' } } }), false)
  assert.equal(sendSetsAtriumSource('extras.atrium', { teleporter: { destination: '#' } }), false)
  assert.equal(sendSetsAtriumSource('extras.atrium.sourceCount', null), false)
})

test('pure sendSetsAtriumSource: unparseable / empty paths are allowed (setPath rejects them)', () => {
  assert.equal(sendSetsAtriumSource('', SOURCE_URL), false)
  assert.equal(sendSetsAtriumSource('.', SOURCE_URL), false)
  assert.equal(sendSetsAtriumSource('[]', SOURCE_URL), false)
})

test('pure sendSetsAtriumSource: non-object values never match the replacement shapes', () => {
  assert.equal(sendSetsAtriumSource('extras', SOURCE_URL), false)
  assert.equal(sendSetsAtriumSource('extras', null), false)
  assert.equal(sendSetsAtriumSource('extras.atrium', SOURCE_URL), false)
  assert.equal(sendSetsAtriumSource('extras.atrium', null), false)
})

// ---------------------------------------------------------------------------
// Open (no-owner) world — only the guard can refuse
// ---------------------------------------------------------------------------

test('open world: add with source is refused and the node does not exist', async () => {
  const { world, port } = await startOpenServer()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'open-add-source')

    ws.send(JSON.stringify({
      type: 'add', seq: 41,
      node: { name: 'evil-source', extras: { atrium: { source: SOURCE_URL } } },
    }))

    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 41)
    assert.ok(err, 'an error with the request seq should arrive')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(err.message, DENIED_MESSAGE)

    await delay(80)
    assert.equal(world.getNode('evil-source'), null, 'refused node must not be added')
    assert.equal(messages.filter(m => m.type === 'add').length, 0, 'refused add must not be broadcast')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: avatar add with source is refused', async () => {
  const { world, port } = await startOpenServer()
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, 'open-avatar-source')

    ws.send(JSON.stringify({
      type: 'add', seq: 42, id: reply.id,
      node: { name: reply.avatarNodeName, translation: [0, 0, 0], extras: { atrium: { source: SOURCE_URL } } },
    }))

    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 42)
    assert.ok(err, 'an error with the request seq should arrive')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(err.message, DENIED_MESSAGE)

    await delay(80)
    assert.equal(world.getNode(reply.avatarNodeName), null, 'refused avatar node must not be added')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: send to extras / extras.atrium / extras.atrium.source is refused', async () => {
  const { world, port } = await startOpenServer()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'open-send-source')

    const attempts = [
      [51, 'extras', { atrium: { source: SOURCE_URL } }],
      [52, 'extras.atrium', { source: SOURCE_URL }],
      [53, 'extras.atrium.source', SOURCE_URL],
    ]
    for (const [seq, field, value] of attempts) {
      ws.send(JSON.stringify({ type: 'send', seq, node: 'Parent', field, value }))
      const err = await waitFor(messages, m => m.type === 'error' && m.seq === seq)
      assert.ok(err, `error for send seq ${seq} (field "${field}") should arrive`)
      assert.equal(err.code, 'PERMISSION_DENIED')
      assert.equal(err.message, DENIED_MESSAGE)
    }

    await delay(80)
    const parent = world.getNode('Parent')
    assert.equal(parent.extras.atrium.source, undefined, 'nothing may be set')
    assert.equal(messages.filter(m => m.type === 'set').length, 0, 'refused sends must not broadcast')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('open world: controls — plain add and send are still accepted', async () => {
  const { world, port } = await startOpenServer()
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'open-controls')

    ws.send(JSON.stringify({ type: 'add', seq: 61, node: { name: 'plain-node' } }))
    const added = await waitFor(messages, m => m.type === 'add' && m.node?.name === 'plain-node')
    assert.ok(added, 'plain add should be broadcast')
    assert.ok(world.getNode('plain-node') !== null, 'plain add should create the node')

    ws.send(JSON.stringify({ type: 'send', seq: 62, node: 'Plain', field: 'translation', value: [1, 2, 3] }))
    const set = await waitFor(messages, m => m.type === 'set' && m.node === 'Plain')
    assert.ok(set, 'plain send should be broadcast')
    assert.deepEqual(set.value, [1, 2, 3])
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

// ---------------------------------------------------------------------------
// Owner-gated document world — the reported attack path
// ---------------------------------------------------------------------------

test('owner-gated world: owner session is really the owner', async () => {
  const { world, port } = await startOwnerServer('owner-001')
  const { ws, messages } = await connect(port)
  try {
    const reply = await hello(ws, messages, 'owner-check')
    assert.equal(reply.canPlaceTeleporters, true, 'authenticated owner must be able to place teleporters')

    ws.send(JSON.stringify({ type: 'add', seq: 1, node: { name: 'owner-plain-node' } }))
    const added = await waitFor(messages, m => m.type === 'add' && m.node?.name === 'owner-plain-node')
    assert.ok(added, 'a plain add by the owner must be accepted')
    assert.ok(world.getNode('owner-plain-node') !== null)
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('owner-gated world: owner add with source is refused', async () => {
  const { world, port } = await startOwnerServer('owner-001')
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'owner-add-source')

    ws.send(JSON.stringify({
      type: 'add', seq: 71,
      node: { name: 'owner-evil', extras: { atrium: { source: SOURCE_URL } } },
    }))

    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 71)
    assert.ok(err, 'error with the request seq should arrive')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(err.message, DENIED_MESSAGE)

    await delay(80)
    assert.equal(world.getNode('owner-evil'), null, 'no node may be created')
    assert.equal(messages.filter(m => m.type === 'add').length, 0, 'nothing may be broadcast')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('owner-gated world: owner send of extras.atrium.source is refused and nothing is set', async () => {
  const { world, port } = await startOwnerServer('owner-001')
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'owner-send-source')

    ws.send(JSON.stringify({
      type: 'send', seq: 72, node: 'Parent',
      field: 'extras.atrium.source', value: SOURCE_URL,
    }))

    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 72)
    assert.ok(err, 'error with the request seq should arrive')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(err.message, DENIED_MESSAGE)

    await delay(80)
    assert.equal(world.getNode('Parent').extras.atrium.source, undefined, 'nothing may be set')
    assert.equal(messages.filter(m => m.type === 'set').length, 0, 'nothing may be broadcast')

    const serialized = JSON.stringify(await world.serialize())
    assert.equal(serialized.includes('"source"'), false, 'serialized world must contain no source field')
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

// Operator-added integration coverage: setPath really does walk through other
// objects (parent, children[n]) and whole-object extras replacement really is
// accepted, so these traversals must be refused by the guard.

test('owner-gated world: send to the child via parent.extras is refused', async () => {
  const { world, port } = await startOwnerServer('owner-001')
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'owner-child-traversal')

    ws.send(JSON.stringify({
      type: 'send', seq: 73, node: 'Child',
      field: 'parent.extras', value: { atrium: { source: SOURCE_URL } },
    }))

    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 73)
    assert.ok(err, 'error with the request seq should arrive')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(err.message, DENIED_MESSAGE)

    await delay(80)
    const parent = world.getNode('Parent')
    assert.equal(parent.extras.atrium.source, undefined, "parent's extras must be unchanged")
    assert.equal(messages.filter(m => m.type === 'set').length, 0, 'nothing may be broadcast')
    assert.equal(JSON.stringify(await world.serialize()).includes('"source"'), false)
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('owner-gated world: send to the child via children[0].extras is refused', async () => {
  const { world, port } = await startOwnerServer('owner-001')
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'owner-parent-traversal')

    ws.send(JSON.stringify({
      type: 'send', seq: 74, node: 'Parent',
      field: 'children[0].extras', value: { atrium: { source: SOURCE_URL } },
    }))

    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 74)
    assert.ok(err, 'error with the request seq should arrive')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(err.message, DENIED_MESSAGE)

    await delay(80)
    const child = world.getNode('Child')
    assert.equal(child.extras.atrium.source, undefined, "child's extras must be unchanged")
    assert.equal(messages.filter(m => m.type === 'set').length, 0, 'nothing may be broadcast')
    assert.equal(JSON.stringify(await world.serialize()).includes('"source"'), false)
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

test('owner-gated world: dotted-path extras replacement is refused', async () => {
  const { world, port } = await startOwnerServer('owner-001')
  const { ws, messages } = await connect(port)
  try {
    await hello(ws, messages, 'owner-dotted-path')

    ws.send(JSON.stringify({
      type: 'send', seq: 75, node: 'Parent',
      field: '..extras..', value: { atrium: { source: SOURCE_URL } },
    }))

    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 75)
    assert.ok(err, 'error with the request seq should arrive')
    assert.equal(err.code, 'PERMISSION_DENIED')
    assert.equal(err.message, DENIED_MESSAGE)

    await delay(80)
    assert.equal(world.getNode('Parent').extras.atrium.source, undefined, 'nothing may be set')
    assert.equal(messages.filter(m => m.type === 'set').length, 0, 'nothing may be broadcast')
    assert.equal(JSON.stringify(await world.serialize()).includes('"source"'), false)
  } finally {
    ws.close()
    await waitForClose(ws)
  }
})

// ---------------------------------------------------------------------------
// S1 — document worlds never fetch
// ---------------------------------------------------------------------------

test('S1: a document world makes no network request for extras.atrium.source', async () => {
  // Canary HTTP server that records every request it receives.
  const requests = []
  const canary = createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  const canaryPort = await listen(canary)
  closers.push(() => { canary.close() })

  const json = JSON.stringify({
    asset: { version: '2.0', generator: 'source-ref-guard-test' },
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'Container',
        extras: { atrium: { source: `http://127.0.0.1:${canaryPort}/internal-target.glb` } },
      },
    ],
  })
  const world = await createWorldFromDocument(json)

  await world.resolveExternalReferences()
  await delay(300) // settle window for any stray fetch to land

  assert.equal(requests.length, 0, `canary received requests: ${JSON.stringify(requests)}`)
  assert.equal(world.externalNodeNames.size, 0, 'no ingested nodes in a document world')
  assert.ok(world.getNode('Container') !== null, 'the container node still loads')
})

test('S1 control: file worlds still resolve their external references', async () => {
  const world = await createWorld(EXT_FIXTURE)
  await world.resolveExternalReferences()
  assert.ok(world.externalNodeNames.size > 0, 'file-world references must still resolve')
})
