// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// world-total.test.js — scripting-4d-1 round 2, step 4 (G2). The SERVER half:
// the world behaviour TOTAL (`behaviorBytesIn`) on every path, over real
// sockets on port 0 (the signin-sync §4.1 seam); the two Q7 timing lines; the
// election on `3` in BOTH places (P22, 4c's pattern); and N1's `logId` line.
//
// The total is 1 MiB of UTF-8 bytes over every saved node's non-null
// `extras.atrium.behavior` leaf. It is enforced by `send`, by `add` (which
// Duplicate and an Undo re-add both reach — the undo engine drops the entry on
// a refusal through `failEntry`, `apps/client/src/edit-undo.js`) and by load
// healing. A rewrite is judged by its NEW size, so a `send` never counts the
// node it replaces against itself.
//
// The boundary is placed exactly by sizing the OTHER nodes' leaves: the filler
// leaves are ORDINARY VALID graphs (a real template plus a CJK pad on an extra
// graph key the Khronos JSON schema allows), written through the world's own
// `setField`. The certificate string is multi-byte, so the boundary is in BYTES
// and not in UTF-16 code units. With the others at `1 MiB - leaf` the send is
// allowed (the rule refuses strictly ABOVE 1 MiB, the number G7 sets); with one
// byte more it is refused, and the same answer is read from the socket.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Document } from '@gltf-transform/core'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld, createWorldFromDocument, healDocumentBehaviors } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import {
  BEHAVIOR_LEAF, BEHAVIOR_WORLD_BYTES_MAX, BEHAVIOR_BYTES_MAX,
  behaviorBytesIn, behaviorLeafBytes, checkBehaviorValue,
} from '../src/send-policy.js'
import { templateGraph } from '../../behaviors/src/templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const HELPER = resolve(__dirname, 'helpers/deep-server.mjs')
const OWNER = 'user-a'
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const closers = []
const children = []
after(async () => {
  for (const child of children) { try { child.kill('SIGKILL') } catch { /* gone */ } }
  for (const close of closers.reverse()) { try { await close() } catch { /* best effort */ } }
})

function listen(http) { return new Promise((res) => http.listen(0, '127.0.0.1', () => res(http.address().port))) }
function waitForOpen(ws) {
  return new Promise((res, rej) => { if (ws.readyState === WebSocket.OPEN) return res(); ws.once('open', res); ws.once('error', rej) })
}
function collect(ws) { const m = []; ws.on('message', (raw) => { try { m.push(JSON.parse(raw)) } catch { /* ignore */ } }); return m }
async function waitFor(messages, pred, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { const f = messages.find(pred); if (f) return f; await delay(10) }
  return null
}
async function connect(port) { const ws = new WebSocket(`ws://127.0.0.1:${port}`); const messages = collect(ws); await waitForOpen(ws); return { ws, messages } }
function waitForClose(ws) {
  return new Promise((res) => { if (ws.readyState === WebSocket.CLOSED) return res(); ws.once('close', res) })
}

async function hello(ws, messages, id, capabilities = { tick: { interval: 5000 }, scriptRunner: 3 }) {
  ws.send(JSON.stringify({ type: 'hello', id, capabilities }))
  const reply = await waitFor(messages, (m) => m.type === 'hello')
  assert.ok(reply, 'the hello reply arrives')
  return reply
}

/** A world host whose upgrade handler takes the owner id from `?as`, like 4c's. */
async function startHostWorld({ world = null } = {}) {
  const theWorld = world ?? await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world: theWorld, sessions, presence, worldOwnerUserId: OWNER, worldId: 'total-test',
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const url = new URL(req.url, 'http://localhost')
      wss.emit('connection', ws, req, url.searchParams.get('as') ?? OWNER)
    })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world: theWorld, port }
}

let seqCounter = 20000
const nextSeq = () => ++seqCounter
const answers = (m, seq) => (m.type === 'error' ? m.seq === seq : m.requestSeq === seq)

async function send(ws, messages, node, field, value) {
  const seq = nextSeq()
  ws.send(JSON.stringify({ type: 'send', seq, node, field, value }))
  return waitFor(messages, (m) => answers(m, seq))
}
async function add(ws, messages, node, parent = null) {
  const seq = nextSeq()
  ws.send(JSON.stringify({ type: 'add', seq, ...(parent != null ? { parent } : {}), node }))
  return waitFor(messages, (m) => answers(m, seq))
}

// ---------------------------------------------------------------------------
// Filler leaves: ORDINARY VALID graphs of an exact UTF-8 byte size
// ---------------------------------------------------------------------------

const target = randomUUID()

/**
 * A VALID behaviour leaf (`behaviorCheck` returns no problem) whose
 * `behaviorLeafBytes` is exactly `bytes` when it can be, using CJK characters
 * so its UTF-8 size is far larger than its UTF-16 length. The pad rides an
 * extra `graph` key — the Khronos JSON schema for the graph allows additional
 * properties, and the rule stores what the validator accepts (G-L3).
 */
function validLeafOfBytes(bytes, ownId) {
  const leaf = JSON.parse(JSON.stringify(
    templateGraph('select-animation', { target, clip: 'Idle', action: 'play', loop: true }, { ownId })))
  leaf.graph.pad = ''
  const wanted = bytes - behaviorLeafBytes(leaf)
  assert.ok(wanted >= 0, `no valid leaf of ${bytes} bytes: the header alone is ${behaviorLeafBytes(leaf)}`)
  const multiByte = Math.floor(wanted / 3)
  const ascii = wanted - multiByte * 3
  leaf.graph.pad = '漢'.repeat(multiByte) + 'x'.repeat(ascii)
  assert.equal(behaviorLeafBytes(leaf), bytes, 'the filler leaf hits its exact byte size')
  return leaf
}

const FILLER_CHUNK = 190_000   // bytes per filler node, below the single-leaf cap

/** Give `world` filler nodes whose leaves total exactly `totalBytes` (excluding `Total-A`). */
function fillOthers(world, totalBytes) {
  for (const node of [...world.som.allNodes]) {
    if (node.name.startsWith('Total-Fill-')) world.setField(node.name, BEHAVIOR_LEAF, null)
  }
  if (totalBytes > 0) {
    const chunks = Math.max(1, Math.ceil(totalBytes / FILLER_CHUNK))
    const per = Math.floor(totalBytes / chunks)
    for (let i = 0; i < chunks; i++) {
      const size = i === chunks - 1 ? totalBytes - per * (chunks - 1) : per
      const name = `Total-Fill-${i}`
      const id = randomUUID()
      if (!world.som.getNodeByName(name)) world.addNode({ name, extras: { atrium: { objectId: id } } }, null)
      world.setField(name, BEHAVIOR_LEAF, validLeafOfBytes(size, id))
    }
  }
  let filled = 0
  for (const node of world.som.allNodes) {
    if (node.name.startsWith('Total-Fill-')) filled += behaviorLeafBytes(node.extras?.atrium?.behavior)
  }
  assert.equal(filled, totalBytes, 'the fillers total exactly the requested bytes')
}

/** A world with an empty node `Total-A` and fillers totalling `othersBytes`. */
async function worldWithOthers(othersBytes) {
  const world = await createWorld(SPACE)
  const a = randomUUID()
  world.addNode({ name: 'Total-A', extras: { atrium: { objectId: a } } }, null)
  fillOthers(world, othersBytes)
  return { world, a }
}

// ===========================================================================
// `behaviorBytesIn` — the helper itself
// ===========================================================================

test('G2: behaviorBytesIn sums the non-null leaves, skips the excluded node, and is UTF-8', async () => {
  const world = await createWorld(SPACE)
  assert.equal(behaviorBytesIn(world.som, null), 0, 'a world with no behaviours has a zero total')

  const a = randomUUID()
  world.addNode({ name: 'Tot-A', extras: { atrium: { objectId: a } } }, null)
  const leaf = validLeafOfBytes(5000, a)
  assert.ok(Buffer.byteLength(JSON.stringify(leaf), 'utf8') > JSON.stringify(leaf).length,
    'the leaf is multi-byte: its UTF-8 size is larger than its UTF-16 length')

  world.setField('Tot-A', BEHAVIOR_LEAF, leaf)
  assert.equal(behaviorBytesIn(world.som, null), 5000, 'the whole world is measured')
  assert.equal(behaviorBytesIn(world.som, world.som.getNodeByName('Tot-A')), 0,
    'the excluded node does not count against itself')
  world.setField('Tot-A', BEHAVIOR_LEAF, null)
  assert.equal(behaviorBytesIn(world.som, null), 0, 'null adds nothing')
})

// ===========================================================================
// The `send` path, at the exact 1 MiB boundary, over a real socket
// ===========================================================================

test('G2: a `send` that replaces a leaf is judged by its NEW size — exactly at the cap it passes, one byte over it is refused with nothing changed', async () => {
  const probe = randomUUID()
  const { world, a } = await worldWithOthers(0)
  const leaf = templateGraph('select-animation', { target: probe, clip: 'Idle', action: 'play', loop: true }, { ownId: a })
  const L = behaviorLeafBytes(leaf)

  fillOthers(world, BEHAVIOR_WORLD_BYTES_MAX - L)
  assert.equal(behaviorBytesIn(world.som, world.som.getNodeByName('Total-A')), BEHAVIOR_WORLD_BYTES_MAX - L)

  const { port } = await startHostWorld({ world })
  const owner = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner-total')

    // Exactly at the cap: allowed — the rule refuses strictly ABOVE 1 MiB.
    const accepted = await send(owner.ws, owner.messages, 'Total-A', BEHAVIOR_LEAF, leaf)
    assert.equal(accepted?.type, 'set', 'the total exactly at 1 MiB is accepted')
    assert.equal(behaviorBytesIn(world.som, null), BEHAVIOR_WORLD_BYTES_MAX, 'and the world now holds 1 MiB')

    // One byte more: refused, with the exact text, and NOTHING changes.
    fillOthers(world, BEHAVIOR_WORLD_BYTES_MAX - L + 1)
    const before = world.som.getNodeByName('Total-A').extras.atrium.behavior
    const seen = owner.messages.length
    const refused = await send(owner.ws, owner.messages, 'Total-A', BEHAVIOR_LEAF, leaf)
    assert.equal(refused?.type, 'error')
    assert.equal(refused.code, 'INVALID_VALUE')
    assert.equal(refused.message, "this world's behaviours would exceed 1 MiB")
    await delay(40)
    assert.equal(owner.messages.slice(seen).some((m) => m.type === 'set'), false, 'nothing was broadcast')
    assert.equal(world.som.getNodeByName('Total-A').extras.atrium.behavior, before, 'and no partial change')
  } finally {
    owner.ws.close()
  }
})

test('G2: a removed leaf stops counting — the same leaf fits once the others shrink', async () => {
  const { world, a } = await worldWithOthers(0)
  const leaf = templateGraph('select-animation', { target: randomUUID(), clip: 'Idle', action: 'play', loop: true }, { ownId: a })
  const L = behaviorLeafBytes(leaf)
  fillOthers(world, BEHAVIOR_WORLD_BYTES_MAX - L + 1)
  const node = world.som.getNodeByName('Total-A')

  assert.equal(checkBehaviorValue(node, leaf, null, (n) => behaviorBytesIn(world.som, n)).ok, false,
    'one byte over is refused')
  world.setField('Total-Fill-0', BEHAVIOR_LEAF, null)   // a removed node stops counting
  assert.equal(checkBehaviorValue(node, leaf, null, (n) => behaviorBytesIn(world.som, n)).ok, true,
    'and the same leaf fits once the others shrink')
})

// ===========================================================================
// The `add` path (Duplicate and an Undo re-add reach it), over a real socket
// ===========================================================================

test('G2: an `add` at the cap is accepted, one byte over is refused with the exact text, and nothing is added', async () => {
  const id = randomUUID()
  const leaf = templateGraph('select-animation', { target: randomUUID(), clip: 'Idle', action: 'play', loop: true }, { ownId: id })
  const L = behaviorLeafBytes(leaf)

  const { world } = await worldWithOthers(BEHAVIOR_WORLD_BYTES_MAX - L)   // exactly at the cap once added
  const { port } = await startHostWorld({ world })
  const owner = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner-add')

    const accepted = await add(owner.ws, owner.messages, { name: 'Add-Ok', extras: { atrium: { objectId: id, behavior: leaf } } })
    assert.equal(accepted?.type, 'add', 'the add exactly at the cap is accepted')
    assert.ok(world.som.getNodeByName('Add-Ok'), 'and the node is in the world')

    // One byte over: refused, nothing broadcast, no node created.
    fillOthers(world, BEHAVIOR_WORLD_BYTES_MAX - L + 1)
    const seen = owner.messages.length
    const id2 = randomUUID()
    const leaf2 = templateGraph('select-animation', { target: randomUUID(), clip: 'Idle', action: 'play', loop: true }, { ownId: id2 })
    const refused = await add(owner.ws, owner.messages, { name: 'Add-Over', extras: { atrium: { objectId: id2, behavior: leaf2 } } })
    assert.equal(refused?.type, 'error')
    assert.equal(refused.code, 'INVALID_VALUE')
    assert.equal(refused.message, "this world's behaviours would exceed 1 MiB")
    await delay(40)
    assert.equal(owner.messages.slice(seen).some((m) => m.type === 'add'), false, 'nothing was broadcast')
    assert.equal(world.som.getNodeByName('Add-Over'), null, 'and the node was never created')
  } finally {
    owner.ws.close()
  }
})

// ===========================================================================
// The single-leaf cap still comes first, over a real socket
// ===========================================================================

test('G2: a leaf past the single-leaf cap (65,536 units) is refused with nothing broadcast', async () => {
  const id = randomUUID()
  const world = await createWorld(SPACE)
  world.addNode({ name: 'Big-A', extras: { atrium: { objectId: id } } }, null)
  const { port } = await startHostWorld({ world })
  const owner = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner-big')
    const base = templateGraph('select-animation', { target: randomUUID(), clip: 'Idle', action: 'play', loop: true }, { ownId: id })
    // The pad rides an extra GRAPH key (the Khronos JSON schema allows it), so
    // the value is otherwise well-formed and the SINGLE-LEAF cap is what refuses
    // it — not the key set.
    const tooBig = { ...base, graph: { ...base.graph, pad: '' } }
    tooBig.graph.pad = 'x'.repeat(BEHAVIOR_BYTES_MAX + 1 - JSON.stringify(tooBig).length)
    assert.equal(JSON.stringify(tooBig).length, BEHAVIOR_BYTES_MAX + 1, 'the value is 65,537 units')

    const seen = owner.messages.length
    const refused = await send(owner.ws, owner.messages, 'Big-A', BEHAVIOR_LEAF, tooBig)
    assert.equal(refused?.type, 'error')
    assert.equal(refused.code, 'INVALID_VALUE')
    assert.equal(refused.message, `the behaviour exceeds ${BEHAVIOR_BYTES_MAX} characters`, 'the single-leaf cap is what refused it')
    await delay(40)
    assert.equal(owner.messages.slice(seen).some((m) => m.type === 'set'), false, 'nothing was broadcast')
  } finally {
    owner.ws.close()
  }
})

// ===========================================================================
// A 4d graph accepted, broadcast, saved and re-read through healing
// ===========================================================================

test('G2: a 4d graph is accepted, broadcast, saved and re-read through healing', async () => {
  const id = randomUUID()
  const leaf = templateGraph('select-animation', { target: randomUUID(), clip: 'Idle', action: 'play', loop: true }, { ownId: id })
  const world = await createWorld(SPACE)
  world.addNode({ name: 'Persist-A', extras: { atrium: { objectId: id } } }, null)
  const { port } = await startHostWorld({ world })
  const owner = await connect(port)
  const peer = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner-persist')
    await hello(peer.ws, peer.messages, 'peer-persist')

    const seq = nextSeq()
    owner.ws.send(JSON.stringify({ type: 'send', seq, node: 'Persist-A', field: BEHAVIOR_LEAF, value: leaf }))
    assert.equal((await waitFor(peer.messages, (m) => answers(m, seq)))?.type, 'set', 'the peer sees the broadcast')

    const saved = JSON.stringify(await world.serialize())
    const reloaded = await createWorldFromDocument(saved, { logId: 'persist' })
    assert.deepEqual(reloaded.som.getNodeByName('Persist-A')?.extras?.atrium?.behavior, leaf,
      'the leaf survives a save + reload through the server healing')
  } finally {
    owner.ws.close(); peer.ws.close()
  }
})

// ===========================================================================
// Healing counts only the leaves it keeps
// ===========================================================================

test('G2: healing keeps leaves in document order up to the total, drops the rest, and logs it', () => {
  const document = new Document()
  const scene = document.createScene('s')
  document.getRoot().setDefaultScene(scene)
  const sizes = [190_000, 190_000, 190_000, 190_000, 190_000, 190_000]   // 5 fit, the 6th does not
  const ids = sizes.map(() => randomUUID())
  ids.forEach((id, i) => {
    const node = document.createNode(`h${i}`)
    node.setExtras({ atrium: { objectId: id, behavior: validLeafOfBytes(sizes[i], id) } })
    scene.addChild(node)
  })

  const lines = []
  const result = healDocumentBehaviors(document, { log: { log: (l) => lines.push(l) } })
  assert.equal(result.overBytes, 1, 'exactly one leaf is over the world total')
  assert.equal(result.noId, 0)
  assert.equal(result.malformed, 0)
  const kept = document.getRoot().listNodes().map((n) => n.getExtras().atrium.behavior)
  assert.ok(kept[0] !== null && kept[4] !== null, 'the first five leaves are kept')
  assert.equal(kept[5], null, 'the sixth is dropped')
  assert.equal(kept.slice(0, 5).reduce((sum, b) => sum + behaviorLeafBytes(b), 0),
    behaviorLeafBytes(kept[0]) * 5, 'and only the KEPT leaves count')
  assert.ok(lines.some((l) => /dropped behavior on node 5: over the world total/.test(l)), 'with its log line')
})

// ===========================================================================
// The two Q7 timing lines
// ===========================================================================

test('G2: the load emits `[world] healed <logId> in <ms> ms`, and a som-dump emits `[world] serialized <logId> in <ms> ms (<bytes> bytes)`', async () => {
  const worldId = 'total-world-42'
  const captured = []
  const original = console.log
  console.log = (...args) => { captured.push(args.join(' ')) }
  let world
  try {
    world = await createWorld(SPACE, { logId: worldId })
  } finally {
    console.log = original
  }
  const healed = captured.find((l) => l.startsWith('[world] healed'))
  assert.ok(healed, `the heal line is logged: ${captured.join(' | ')}`)
  assert.match(healed, /^\[world\] healed total-wo in \d+ ms$/, 'the world id goes through logId, and nothing else')

  const { port } = await startHostWorld({ world })
  const owner = await connect(port)
  const serialized = []
  console.log = (...args) => { serialized.push(args.join(' ')) }
  try {
    await hello(owner.ws, owner.messages, 'owner-serialize')
    await waitFor(owner.messages, (m) => m.type === 'som-dump')
  } finally {
    console.log = original
    owner.ws.close()
  }
  const line = serialized.find((l) => l.startsWith('[world] serialized'))
  assert.ok(line, `the serialize line is logged: ${serialized.join(' | ')}`)
  assert.match(line, /^\[world\] serialized total-te in \d+ ms \(\d+ bytes\)$/,
    'the som-dump’s logId and its byte count, and no other id')
})

// ===========================================================================
// Election on `3` in BOTH places, each alone (P22)
// ===========================================================================

test('G2: the `hello` election — a `scriptRunner: 2` owner is never the host, a `3` is', async () => {
  const { port } = await startHostWorld()
  const two = await connect(port)
  const three = await connect(port)
  try {
    const h2 = await hello(two.ws, two.messages, 'owner-2', { tick: { interval: 5000 }, scriptRunner: 2 })
    assert.equal(h2.canEdit, true, 'a 2 still owns the world')
    assert.equal(h2.scriptHost, false, 'but the hello election requires 3')
    assert.equal('hostGen' in h2, false)

    const h3 = await hello(three.ws, three.messages, 'owner-3', { tick: { interval: 5000 }, scriptRunner: 3 })
    assert.equal(h3.scriptHost, true, 'the 3 takes the role')
    assert.equal(h3.hostGen, 1)
  } finally {
    two.ws.close(); three.ws.close()
  }
})

test('G2: the HANDOVER election (`canRunBehaviors`) — the role goes to a `3` and skips a `2`', async () => {
  const { port } = await startHostWorld()
  const two = await connect(port)
  const three = await connect(port)
  try {
    // A `2` connects first: it can never hold the role, so the `3` takes it.
    await hello(two.ws, two.messages, 'owner-2', { tick: { interval: 5000 }, scriptRunner: 2 })
    const h3 = await hello(three.ws, three.messages, 'owner-3', { tick: { interval: 5000 }, scriptRunner: 3 })
    assert.equal(h3.scriptHost, true)
    assert.equal(h3.hostGen, 1)

    // The `3` host leaves: the handover runs `canRunBehaviors` and must refuse
    // the `2` — the world is left with NO host.
    const four = await connect(port)
    three.ws.close()
    await waitForClose(three.ws)
    await delay(120)
    const h2b = await hello(four.ws, four.messages, 'owner-2b', { tick: { interval: 5000 }, scriptRunner: 2 })
    assert.equal(h2b.scriptHost, false, 'the handover refused to hand the role to a 2')
    assert.equal(two.messages.filter((m) => m.type === 'script-host' && m.active === true).length, 0,
      'and the earlier 2 was never offered it')
    four.ws.close()
    await waitForClose(four.ws)
  } finally {
    two.ws.close()
    await waitForClose(two.ws)
  }
})

// ===========================================================================
// N1 — the check-failure line carries a `logId`, and nothing else
// ===========================================================================

test('G2/N1: the `[session …] the check … threw` line carries the session’s logId, never the whole id', async () => {
  const child = spawn(process.execPath, [HELPER, SPACE, '--throw-check'], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  const out = []
  const port = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`the child never listened: ${out.join('')}`)), 20000)
    const onData = (buf) => {
      const text = String(buf)
      out.push(text)
      const match = text.match(/PORT (\d+)/)
      if (match) { clearTimeout(timer); res(Number(match[1])) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => { if (!out.join('').includes('PORT ')) { clearTimeout(timer); rej(new Error(`child exited ${code}: ${out.join('')}`)) } })
  })
  const socketPort = await port

  // The id is long, so a line that wrote the WHOLE id would carry it; `logId`
  // keeps its first 8 characters.
  const sessionId = 'session-long-id-12345'
  const id = randomUUID()
  const { ws, messages } = await connect(socketPort)
  try {
    await hello(ws, messages, sessionId)
    await send(ws, messages, 'crate-01', 'extras.atrium.objectId', id)   // the child’s check throws ONCE
    await delay(60)
    const logs = out.join('')
    assert.match(logs, /\[session session-\] the check for "extras\.atrium\.objectId" threw: the check blew up/,
      `the logId line is logged: ${logs}`)
    assert.equal(logs.includes(sessionId), false, 'and the whole id never reaches a log line')
  } finally {
    ws.close()
  }
})
