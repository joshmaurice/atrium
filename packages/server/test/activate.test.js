// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// activate.test.js — scripting-4c step 3, AC3: the server's `activate` case.
//
// REAL SESSIONS OVER REAL SOCKETS on port 0 (the seam rule, spec §8): a fake
// host would test a stand-in, and this case's whole job is what the server does
// to real sockets in a real order. The only thing faked is the CLOCK, which
// `attachSessionHandlers` takes as a parameter so the two rate-limit buckets can
// be driven deterministically.
//
// The order of the ten checks is the contract, so the tests pin it where it is
// observable: a far-away click on an object with NO behaviour answers
// `INVALID_FIELD` (check 5) and not `PERMISSION_DENIED` (check 8), and a flood
// is answered `RATE_LIMITED` (check 3) before the node is even looked up.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { randomUUID } from 'crypto'
import WebSocket, { WebSocketServer } from 'ws'
import { validate } from '@atrium/protocol'
import { createWorld } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import { createPresence } from '../src/presence.js'
import { templateGraph } from '../../behaviors/src/templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const OWNER = 'user-a'
const S = Math.SQRT1_2   // sin/cos of 45°

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
    await delay(5)
  }
  return null
}

async function waitUntil(pred, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await delay(5)
  }
  return false
}

let seqCounter = 10_000
const seq = () => ++seqCounter

// ---------------------------------------------------------------------------
// The harness: one real world host, on port 0, with an injectable clock
// ---------------------------------------------------------------------------

async function startWorld({ clock = null } = {}) {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = createPresence()
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence,
    worldOwnerUserId: OWNER,
    worldId: 'activate-test',
    ...(clock ? { now: () => clock.t } : {}),
  })
  http.on('upgrade', (req, socket, head) => {
    // `?as=<userId>` names a signed-in session; no `as` at all is an ANONYMOUS,
    // cross-origin-shaped visitor (the server never learns who it is).
    const as = new URL(req.url, 'http://x').searchParams.get('as')
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, as ?? null))
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, sessions, presence, clock }
}

/** A world host with NO world attached, for check 2. */
async function startWorldlessHost() {
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const { closeKeepalive } = attachSessionHandlers({
    wss, world: null, sessions, presence: createPresence(), worldOwnerUserId: OWNER,
  })
  http.on('upgrade', (req, socket, head) => {
    const as = new URL(req.url, 'http://x').searchParams.get('as')
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, as ?? null))
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { port, sessions }
}

class Peer {
  constructor(ws, id) {
    this.ws = ws
    this.id = id
    this.messages = collect(ws)
  }
  send(msg) { this.ws.send(JSON.stringify(msg)) }
  /** Forget every message so far: "nothing was forwarded AFTER this point". */
  forget() { this.messages.length = 0 }
  of(type) { return this.messages.filter((m) => m.type === type) }
  errors() { return this.messages.filter((m) => m.type === 'error') }
  async next(pred, timeoutMs = 2000) { return waitFor(this.messages, pred, timeoutMs) }
  async close() { this.ws.close(); await waitForClose(this.ws) }

  /**
   * A REAL message-order barrier on this peer's own socket: the server handles
   * one socket's messages in order, so once the pong to a ping sent after an
   * earlier message arrives, that earlier message has been handled.
   */
  async barrier() {
    const before = this.messages.length
    this.send({ type: 'ping', clientTime: 1 })
    await waitUntil(() => this.messages.slice(before).some((m) => m.type === 'pong'))
  }

  ready(hostGen = this.hello?.hostGen) { this.send({ type: 'script-ready', hostGen }) }

  activate(node, seqNo = seq()) {
    this.send({ type: 'activate', seq: seqNo, node, event: 'select' })
    return seqNo
  }
}

async function open(port, id, {
  as = null,
  capabilities = { tick: { interval: 5000 }, scriptRunner: 2 },
} = {}) {
  const url = as ? `ws://127.0.0.1:${port}/?as=${encodeURIComponent(as)}` : `ws://127.0.0.1:${port}`
  const ws = new WebSocket(url)
  const peer = new Peer(ws, id)
  await waitForOpen(ws)
  peer.send({ type: 'hello', id, capabilities })
  const hello = await peer.next((m) => m.type === 'hello')
  assert.ok(hello, `${id}: the hello reply arrives`)
  peer.hello = hello
  return peer
}

/** The avatar `add` and the `view` that set the session's own position. */
async function placeAvatar(port, sessions, peer, position = [0, 0, 0]) {
  peer.send({ type: 'add', id: peer.id, seq: seq(), node: { name: peer.hello.avatarNodeName, translation: position } })
  const joined = await waitUntil(() => sessions.get(peer.id)?.avatarNode != null)
  assert.ok(joined, `${peer.id}: the avatar add was accepted`)
  peer.send({ type: 'view', seq: seq(), position })
  const moved = await waitUntil(() => {
    const t = sessions.get(peer.id)?.avatarNode?.translation
    return Array.isArray(t) && t[0] === position[0] && t[1] === position[1] && t[2] === position[2]
  })
  assert.ok(moved, `${peer.id}: the view was applied`)
  peer.position = position
}

/** The answer to an activation: its `error`, or null when the server said nothing. */
async function answerTo(peer, seqNo, timeoutMs = 400) {
  return waitFor(peer.messages, (m) => m.type === 'error' && m.seq === seqNo, timeoutMs)
}

// ---------------------------------------------------------------------------
// The world's nodes: created directly on the real world, before any connection
// ---------------------------------------------------------------------------

const TARGET_ID = randomUUID()

/**
 * A node with a stored behaviour leaf. `select: true` is a template whose graph
 * declares `event/onSelect`; `false` is one that does not.
 */
function behaviourNode(name, { translation = [0, 0, 0], select = true, enabled = true } = {}) {
  const objectId = randomUUID()
  const behavior = templateGraph(
    select ? 'select-visibility' : 'proximity-animation',
    select
      ? { target: TARGET_ID, action: 'toggle' }
      : { target: TARGET_ID, clip: 'Walk', loop: true, radius: 3 },
    { ownId: objectId },
  )
  return { name, translation, extras: { atrium: { objectId, behavior: { ...behavior, enabled } } } }
}

/** A plain node with no behaviour at all. */
const plainNode = (name, translation = [0, 0, 0]) => ({ name, translation })

function addNodes(world, nodes, parent = null) {
  for (const descriptor of nodes) {
    const result = world.addNode(descriptor, parent)
    assert.equal(result.ok, true, `test setup: ${descriptor.name} was added (${result.code ?? ''})`)
  }
}

/** The one assertion every refusal makes: the host's socket saw NO activate. */
function assertNothingForwarded(host, msg) {
  assert.deepEqual(host.of('activate'), [], msg)
}

const isActivateFor = (node, from, hostGen) => (m) =>
  m.type === 'activate' && m.node === node && m.from === from && m.hostGen === hostGen

// ===========================================================================
// The happy path
// ===========================================================================

test('AC3: a visitor within 10 m is forwarded to the ready host, with from and the current hostGen', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const owner = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    assert.equal(owner.hello.canEdit, true)
    assert.equal(owner.hello.scriptHost, true, 'the owner is the host')
    assert.equal(owner.hello.hostGen, 1)
    owner.ready()
    await owner.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 3])

    owner.forget()
    const s = visitor.activate('Switch')
    const forwarded = await owner.next(isActivateFor('Switch', 'visitor-1', 1))
    assert.ok(forwarded, 'the host receives the forwarded activate')
    assert.equal(forwarded.event, 'select')
    assert.equal(typeof forwarded.seq, 'number', 'the forward carries the server’s own seq')
    assert.equal(validate('server', forwarded).valid, true, 'and it validates against activate.server.json')

    await delay(60)
    assert.equal(await answerTo(visitor, s), null, 'the visitor gets NOTHING back on success')
    assert.deepEqual(visitor.of('activate'), [], 'and no activate of its own')
  } finally {
    await visitor.close()
    await owner.close()
  }
})

test('AC3: an anonymous cross-origin visitor is forwarded like any other', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const owner = await open(port, 'owner-1', { as: OWNER })
  const anon = await open(port, 'anon-1')                  // no `as`: nobody knows who it is
  try {
    assert.equal(anon.hello.signedIn, false)
    owner.ready(); await owner.barrier()
    await placeAvatar(port, sessions, anon, [1, 0, 1])
    owner.forget()
    anon.activate('Switch')
    const forwarded = await owner.next(isActivateFor('Switch', 'anon-1', 1))
    assert.ok(forwarded, 'an anonymous visitor is forwarded exactly like a signed-in one')
  } finally {
    await anon.close()
    await owner.close()
  }
})

// ===========================================================================
// Each refusal, in AC3's order
// ===========================================================================

test('AC3: the schema and handshake refusals come first', async () => {
  const { world, port } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const raw = new WebSocket(`ws://127.0.0.1:${port}`)
  const rawMessages = collect(raw)
  await waitForOpen(raw)
  try {
    host.ready(); await host.barrier()
    host.forget()

    // Check 1: a message the schema refuses (event must be 'select').
    raw.send(JSON.stringify({ type: 'hello', id: 'h1', capabilities: { tick: { interval: 5000 }, scriptRunner: 2 } }))
    await waitFor(rawMessages, (m) => m.type === 'hello')
    const badSeq = seq()
    raw.send(JSON.stringify({ type: 'activate', seq: badSeq, node: 'Switch', event: 'hover' }))
    const bad = await waitFor(rawMessages, (m) => m.type === 'error' && m.seq === badSeq)
    assert.equal(bad.code, 'UNKNOWN_MESSAGE')
    assert.equal(bad.message, 'must be equal to constant', 'the schema’s own detail')

    // Check 1: no handshake yet.
    const preRaw = new WebSocket(`ws://127.0.0.1:${port}`)
    const preMessages = collect(preRaw)
    await waitForOpen(preRaw)
    const preSeq = seq()
    preRaw.send(JSON.stringify({ type: 'activate', seq: preSeq, node: 'Switch', event: 'select' }))
    const pre = await waitFor(preMessages, (m) => m.type === 'error' && m.seq === preSeq)
    assert.equal(pre.code, 'AUTH_FAILED')
    preRaw.close()

    assertNothingForwarded(host, 'neither refusal forwarded anything')
  } finally {
    raw.close()
    await host.close()
  }
})

test('AC3: no world → UNKNOWN_MESSAGE “World not loaded”, as send', async () => {
  const { port } = await startWorldlessHost()
  const peer = await open(port, 'owner-1', { as: OWNER })
  try {
    const s = peer.activate('Switch')
    const answer = await answerTo(peer, s)
    assert.ok(answer, 'the activate is answered')
    assert.equal(answer.code, 'UNKNOWN_MESSAGE')
    assert.equal(answer.message, 'World not loaded')
  } finally {
    await peer.close()
  }
})

test('AC3: the node and behaviour checks answer NODE_NOT_FOUND and INVALID_FIELD', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [
    behaviourNode('Switch'),
    behaviourNode('Prox', { select: false }),
    behaviourNode('Off', { enabled: false }),
    plainNode('Scenery'),
  ])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    host.ready(); await host.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 1])
    host.forget()

    const missing = await answerTo(visitor, visitor.activate('NoSuchNode'))
    assert.equal(missing.code, 'NODE_NOT_FOUND')
    assert.equal(missing.message, 'NODE_NOT_FOUND: NoSuchNode', 'the same text send uses')

    const scenery = await answerTo(visitor, visitor.activate('Scenery'))
    assert.equal(scenery.code, 'INVALID_FIELD')
    assert.equal(scenery.message, "this object doesn't respond to clicks")

    const prox = await answerTo(visitor, visitor.activate('Prox'))
    assert.equal(prox.code, 'INVALID_FIELD', 'an enabled behaviour that does not listen for select')

    const off = await answerTo(visitor, visitor.activate('Off'))
    assert.equal(off.code, 'INVALID_FIELD', 'a disabled select behaviour does not respond either')

    assertNothingForwarded(host, 'no refusal above was forwarded')
  } finally {
    await visitor.close()
    await host.close()
  }
})

test('AC3: no avatar and too far are both PERMISSION_DENIED, with their own texts', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const noAvatar = await open(port, 'visitor-1')
  const far = await open(port, 'visitor-2')
  try {
    host.ready(); await host.barrier()
    // A session whose avatar `add` was REFUSED owns nothing (the carry of
    // extras.atrium is refused here; the real page never sends one).
    noAvatar.send({
      type: 'add', id: 'visitor-1', seq: seq(),
      node: { name: noAvatar.hello.avatarNodeName, extras: { atrium: {} } },
    })
    const refused = await noAvatar.next((m) => m.type === 'error')
    assert.equal(refused.code, 'PERMISSION_DENIED', 'the avatar add was refused')
    await waitUntil(() => sessions.has('visitor-1'))
    assert.equal(sessions.get('visitor-1').avatarNode, null, 'and it owns no node')

    await placeAvatar(port, sessions, far, [0, 0, 40])
    host.forget()

    const noNode = await answerTo(noAvatar, noAvatar.activate('Switch'))
    assert.equal(noNode.code, 'PERMISSION_DENIED')
    assert.equal(noNode.message, 'you have no avatar in this world')

    const tooFar = await answerTo(far, far.activate('Switch'))
    assert.equal(tooFar.code, 'PERMISSION_DENIED')
    assert.equal(tooFar.message, 'you are too far away to use this')

    assertNothingForwarded(host, 'neither refusal was forwarded')
  } finally {
    await noAvatar.close()
    await far.close()
    await host.close()
  }
})

test('AC3: THE ORDER — a far-away click on an object with no behaviour is INVALID_FIELD, not PERMISSION_DENIED', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [plainNode('Scenery'), behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    host.ready(); await host.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 40])   // far from everything

    const answer = await answerTo(visitor, visitor.activate('Scenery'))
    assert.equal(answer.code, 'INVALID_FIELD',
      'the behaviour check (5) runs before the distance check (8): the code must be the behaviour’s')

    const tooFar = await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(tooFar.code, 'PERMISSION_DENIED', 'and a real behaviour out of reach is the distance’s')
    assertNothingForwarded(host)
  } finally {
    await visitor.close()
    await host.close()
  }
})

// ===========================================================================
// The distance: world positions, never local ones (P7)
// ===========================================================================

test('AC3/P7: a nested object is measured at its WORLD position', async () => {
  const { world, port, sessions } = await startWorld()
  // Group at [10, 0, 0], rotated 90° about Y and scaled 2; Switch at local
  // [3, 1, 0] → world [10, 2, -6] (the 4b-2 probe p1 case).
  addNodes(world, [{ name: 'Group', translation: [10, 0, 0], rotation: [0, S, 0, S], scale: [2, 2, 2] }])
  addNodes(world, [behaviourNode('Switch', { translation: [3, 1, 0] })], 'Group')

  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    host.ready(); await host.barrier()
    // 7 m from the WORLD position [10, 2, -6]: at the LOCAL translation [3, 1, 0]
    // the same visitor is about 14.8 m away and would be refused.
    await placeAvatar(port, sessions, visitor, [10, 2, -13])

    visitor.activate('Switch')
    const forwarded = await host.next(isActivateFor('Switch', 'visitor-1', 1))
    assert.ok(forwarded, 'measured at the world position, the click is in reach')
  } finally {
    await visitor.close()
    await host.close()
  }
})

// ===========================================================================
// The two buckets, on the injected clock
// ===========================================================================

test('AC3/AC-L4: the session bucket is 5 a second, charged BEFORE the node lookup', async () => {
  const clock = { t: 1000 }
  const { world, port, sessions } = await startWorld({ clock })
  addNodes(world, [behaviourNode('Switch'), plainNode('Scenery')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    host.ready(); await host.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 1])
    host.forget()

    // Five in one instant, on a node with NO behaviour: each passes the session
    // check and is then refused by check 5.
    for (let i = 0; i < 5; i++) {
      const s = visitor.activate('Scenery')
      const answer = await answerTo(visitor, s)
      assert.equal(answer?.code, 'INVALID_FIELD', `attempt ${i + 1} passed the session bucket`)
    }
    // The sixth is refused by the BUCKET, before the node is ever looked up.
    const sixth = await answerTo(visitor, visitor.activate('Scenery'))
    assert.equal(sixth.code, 'RATE_LIMITED')
    assert.equal(sixth.message, 'too many activations; try again in a moment')

    // 200 ms later one token has come back.
    clock.t += 200
    const seventh = await answerTo(visitor, visitor.activate('Scenery'))
    assert.equal(seventh.code, 'INVALID_FIELD', 'after 200 ms the bucket has a token again')

    // And a real node is forwarded while tokens remain.
    clock.t += 1000
    host.forget()
    const ok = visitor.activate('Switch')
    const forwarded = await host.next(isActivateFor('Switch', 'visitor-1', 1))
    assert.ok(forwarded, 'a clean activate under the limit is forwarded')
    assert.equal(await answerTo(visitor, ok), null)
  } finally {
    await visitor.close()
    await host.close()
  }
})

test('AC3/AC-L4: the world bucket is 20 a second — 20 of 30 forwards, the rest RATE_LIMITED', async () => {
  const clock = { t: 1000 }
  const { world, port, sessions } = await startWorld({ clock })
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitors = []
  try {
    host.ready(); await host.barrier()
    for (let i = 0; i < 30; i++) {
      const peer = await open(port, `visitor-${i}`)
      await placeAvatar(port, sessions, peer, [0, 0, 1])
      visitors.push(peer)
    }
    host.forget()

    const answers = []
    await Promise.all(visitors.map(async (peer) => {
      const s = peer.activate('Switch')
      answers.push({ peer, answer: await answerTo(peer, s, 1500) })
    }))

    const refused = answers.filter((a) => a.answer?.code === 'RATE_LIMITED')
    const forwarded = host.of('activate')
    assert.equal(forwarded.length, 20, 'exactly 20 forwards in one instant')
    assert.equal(refused.length, 10, 'and 10 refused by the world bucket')
    for (const a of answers) {
      assert.ok(a.answer === null || a.answer.code === 'RATE_LIMITED', 'nobody got another code')
    }
  } finally {
    for (const peer of visitors) await peer.close()
    await host.close()
  }
})

test('AC3/AC-L4: attempts refused for DISTANCE do not charge the world bucket', async () => {
  const clock = { t: 1000 }
  const { world, port, sessions } = await startWorld({ clock })
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const far = []
  let near = null
  try {
    host.ready(); await host.barrier()
    // 25 far-away visitors — more than the world bucket's whole capacity.
    for (let i = 0; i < 25; i++) {
      const peer = await open(port, `far-${i}`)
      await placeAvatar(port, sessions, peer, [0, 0, 60])
      far.push(peer)
    }
    host.forget()
    for (const peer of far) {
      const answer = await answerTo(peer, peer.activate('Switch'), 1500)
      assert.equal(answer?.code, 'PERMISSION_DENIED', 'too far')
    }
    assertNothingForwarded(host, 'a refused-for-distance click never reaches the host')

    // The world bucket is UNTOUCHED: an in-range click still goes through.
    near = await open(port, 'near-1')
    await placeAvatar(port, sessions, near, [0, 0, 2])
    near.activate('Switch')
    const forwarded = await host.next(isActivateFor('Switch', 'near-1', 1))
    assert.ok(forwarded, 'refusals for distance spend none of the world’s budget (AC-L4)')
  } finally {
    if (near) await near.close()
    for (const peer of far) await peer.close()
    await host.close()
  }
})

test('AC3: the rate-limit log line is one per session per 60 s, and names nothing else', async () => {
  const clock = { t: 5000 }
  const { world, port, sessions } = await startWorld({ clock })
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-abcd1234')
  const lines = []
  const original = console.log
  console.log = (...args) => { lines.push(args.join(' ')) }
  try {
    host.ready(); await host.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 1])

    for (let i = 0; i < 6; i++) await answerTo(visitor, visitor.activate('Switch'))
    const rateLines = () => lines.filter((l) => l.startsWith('[activate] rate limited '))
    assert.equal(rateLines().length, 1, 'exactly one line for the first refusal')
    assert.equal(rateLines()[0], '[activate] rate limited visitor- world activate-test',
      'the first 8 characters of the session id, and the world id, and nothing else')

    // Still inside the window: further refusals are silent.
    clock.t += 30_000
    for (let i = 0; i < 6; i++) await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(rateLines().length, 1, 'one line per session per 60 s')

    // Past the window: one more line, not one per attempt.
    clock.t += 31_000
    for (let i = 0; i < 6; i++) await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(rateLines().length, 2, 'the window has passed: exactly one more line')
    for (const line of lines) {
      assert.ok(!line.includes('Switch'), 'no node name is ever logged')
      assert.ok(!line.includes(visitor.id.slice(8)), 'and no more than 8 characters of the session id')
    }
  } finally {
    console.log = original
    await visitor.close()
    await host.close()
  }
})

// ===========================================================================
// Readiness — the delivery contract (Rev 1 M1)
// ===========================================================================

test('AC3/M1: before the host says script-ready, a visitor hears NO_SCRIPT_HOST and nothing is forwarded', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    assert.equal(host.hello.scriptHost, true, 'the owner is the host from its hello…')
    await placeAvatar(port, sessions, visitor, [0, 0, 1])
    host.forget()

    const early = await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(early.code, 'NO_SCRIPT_HOST', '…but the role alone is not enough')
    assert.equal(early.message, "the world's owner isn't ready yet")
    assertNothingForwarded(host, 'an activate in the loading window is never forwarded')

    // The owner's page says its runner is enabled.
    host.ready()
    await host.barrier()
    visitor.activate('Switch')
    const forwarded = await host.next(isActivateFor('Switch', 'visitor-1', 1))
    assert.ok(forwarded, 'after script-ready the next activate is forwarded')
  } finally {
    await visitor.close()
    await host.close()
  }
})

test('AC3/M1: a script-ready from a NON-host, or for an OLD generation, changes nothing', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    await placeAvatar(port, sessions, visitor, [0, 0, 1])
    // The VISITOR claims readiness: ignored, with no answer and no log line.
    visitor.ready(1)
    await visitor.barrier()
    assert.deepEqual(visitor.errors(), [], 'the server never answers script-ready')

    const stillNotReady = await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(stillNotReady.code, 'NO_SCRIPT_HOST', 'a non-host’s script-ready is ignored')

    // The host says it for a generation that is not the current one: ignored too.
    host.ready(99)
    await host.barrier()
    const oldGen = await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(oldGen.code, 'NO_SCRIPT_HOST', 'an old generation is ignored')

    // The right generation, from the right session.
    host.ready(host.hello.hostGen)
    await host.barrier()
    visitor.activate('Switch')
    assert.ok(await host.next(isActivateFor('Switch', 'visitor-1', 1)), 'the current generation is accepted')
  } finally {
    await visitor.close()
    await host.close()
  }
})

// ===========================================================================
// Eligibility — the role needs scriptRunner: 2 (Rev 1 S2, P22)
// ===========================================================================

test('AC3/S2: a scriptRunner: 1 owner is never the host, and the forward skips it', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  // The 4b-2 owner connects FIRST: it is the earliest eligible canEdit session.
  const legacy = await open(port, 'legacy-owner', {
    as: OWNER, capabilities: { tick: { interval: 5000 }, scriptRunner: 1 },
  })
  const capable = await open(port, 'capable-owner', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    assert.equal(legacy.hello.canEdit, true, 'a scriptRunner: 1 page still owns the world')
    assert.equal(legacy.hello.scriptHost, false, 'and is never the host')
    assert.equal('hostGen' in legacy.hello, false)
    assert.equal(capable.hello.scriptHost, true, 'the 4c page takes the role')
    assert.equal(capable.hello.hostGen, 1)
    await placeAvatar(port, sessions, visitor, [0, 0, 1])

    // Both owners are connected here; the point is where the forward GOES.
    capable.forget(); legacy.forget()
    capable.ready(); await capable.barrier()
    visitor.activate('Switch')
    assert.ok(await capable.next(isActivateFor('Switch', 'visitor-1', 1)),
      'the forward goes to the READY HOST session, never to the first canEdit one')
    await delay(60)
    assert.deepEqual(legacy.of('activate'), [],
      'a scriptRunner: 1 tab is not the host, so nothing is sent to it')
  } finally {
    await visitor.close()
    await legacy.close()
    await capable.close()
  }
})

test('AC3/S2: with ONLY a scriptRunner: 1 owner connected, the world has no host', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const legacy = await open(port, 'legacy-owner', {
    as: OWNER, capabilities: { tick: { interval: 5000 }, scriptRunner: 1 },
  })
  const visitor = await open(port, 'visitor-1')
  try {
    assert.equal(legacy.hello.scriptHost, false)
    await placeAvatar(port, sessions, visitor, [0, 0, 1])
    const answer = await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(answer.code, 'NO_SCRIPT_HOST')
    assert.equal(answer.message, "nothing runs here while the world's owner is away")
    assertNothingForwarded(legacy)
  } finally {
    await visitor.close()
    await legacy.close()
  }
})

// ===========================================================================
// The handover (Rev 1 S1) — the real invariants
// ===========================================================================

test('AC3/S1: a handover forwards to exactly one OPEN socket, and only to a READY host', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const a = await open(port, 'owner-a', { as: OWNER })
  const b = await open(port, 'owner-b', { as: OWNER })
  const legacy = await open(port, 'legacy-owner', {
    as: OWNER, capabilities: { tick: { interval: 5000 }, scriptRunner: 1 },
  })
  const visitor = await open(port, 'visitor-1')
  try {
    assert.equal(a.hello.scriptHost, true)
    assert.equal(a.hello.hostGen, 1)
    assert.equal(b.hello.scriptHost, false)
    assert.equal(legacy.hello.scriptHost, false, 'the 4b-2 owner is not in the running')
    a.ready(); await a.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 1])

    // Before the close: forwarded to A.
    a.forget(); b.forget(); legacy.forget()
    visitor.activate('Switch')
    assert.ok(await a.next(isActivateFor('Switch', 'visitor-1', 1)), 'A receives it while it is the host')
    assertNothingForwarded(b, 'and B receives nothing while A holds the role')

    // A closes: the role is handed to B, with hostGen + 1.
    a.ws.close()
    await waitForClose(a.ws)
    const handed = await b.next((m) => m.type === 'script-host' && m.active === true)
    assert.ok(handed, 'B is granted the role')
    assert.equal(handed.hostGen, 2, 'with hostGen + 1')
    assert.deepEqual(legacy.of('script-host'), [], 'the scriptRunner: 1 owner is skipped in the handover')

    // From the grant until B says it is ready: NO_SCRIPT_HOST, nothing forwarded.
    b.forget()
    const window = await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(window.code, 'NO_SCRIPT_HOST', 'the grant clears readiness')
    assert.equal(window.message, "the world's owner isn't ready yet")
    assertNothingForwarded(b, 'nothing is forwarded to a host that has not said it is ready')

    // B says ready: the next activate is forwarded to B, under generation 2.
    b.ready(2)
    await b.barrier()
    visitor.activate('Switch')
    assert.ok(await b.next(isActivateFor('Switch', 'visitor-1', 2)), 'every forward carries the current hostGen')
    assertNothingForwarded(legacy)
  } finally {
    await visitor.close()
    await legacy.close()
    await b.close()
  }
})

test('AC3/S1: with no successor the answer is NO_SCRIPT_HOST, never silence', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const a = await open(port, 'owner-a', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  try {
    a.ready(); await a.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 1])
    a.ws.close()
    await waitForClose(a.ws)

    const answer = await answerTo(visitor, visitor.activate('Switch'))
    assert.equal(answer.code, 'NO_SCRIPT_HOST')
    assert.equal(answer.message, "nothing runs here while the world's owner is away")
  } finally {
    await visitor.close()
  }
})

// ===========================================================================
// scripting-4c revision round 2, W1 — a hello id outside the bound
//
// The outside review's M1/S1: `id` had no maximum and no character set, so a
// visitor's 250,000-character id (with a newline and an ANSI escape in it) was
// admitted, every one of its `activate`s carried a 250 KB `from`, and its first
// 8 characters — control characters included — went into three log lines and
// the avatar node's name. W1 bounds the id; the schema's refusal IS the
// refusal (no server code is needed for it): `UNKNOWN_MESSAGE`, no session, and
// the socket stays open.
// ===========================================================================

/** A hello id of 250,000 characters, sent as an anonymous visitor's `hello`. */
const HUGE_ID = 'A'.repeat(250_000)
/** The control characters S1 smuggled through: a newline and an ANSI colour. */
const CONTROL_ID = 'x\n\u001b[31m'

test('AC3/W1: a 250,000-character hello id is refused, creates no session and joins nobody', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const watcher = await open(port, 'owner-1', { as: OWNER })
  const raw = new WebSocket(`ws://127.0.0.1:${port}`)
  const rawMessages = collect(raw)
  await waitForOpen(raw)
  try {
    const before = sessions.size
    watcher.forget()

    raw.send(JSON.stringify({ type: 'hello', id: HUGE_ID }))
    const err = await waitFor(rawMessages, (m) => m.type === 'error')
    assert.ok(err, 'the hello is answered')
    assert.equal(err.code, 'UNKNOWN_MESSAGE', 'the schema’s own refusal')
    assert.equal(err.message, 'must NOT have more than 64 characters',
      'the validator’s own detail, as every schema refusal carries it')

    await delay(80)
    assert.equal(sessions.size, before, 'no session was created')
    assert.deepEqual(rawMessages.filter((m) => m.type === 'hello'), [],
      'and no hello reply was sent')
    assert.deepEqual(watcher.of('join'), [],
      'and nobody else heard a `join` for it')
    assert.equal(watcher.of('leave').length, 0, 'nor a `leave` afterwards')
    assert.equal(raw.readyState, WebSocket.OPEN, 'the socket stays open')

    // THE SAME SOCKET then says a valid hello and is admitted: the refusal cost
    // the visitor nothing but that message.
    raw.send(JSON.stringify({ type: 'hello', id: 'raw-admitted' }))
    const reply = await waitFor(rawMessages, (m) => m.type === 'hello')
    assert.ok(reply, 'the same socket is admitted with a valid id')
    assert.equal(reply.id, 'raw-admitted')
    assert.equal(sessions.size, before + 1)
  } finally {
    raw.close()
    await watcher.close()
  }
})

test('AC3/W1: a hello id carrying a newline and an ANSI escape is refused the same way', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const watcher = await open(port, 'owner-1', { as: OWNER })
  const raw = new WebSocket(`ws://127.0.0.1:${port}`)
  const rawMessages = collect(raw)
  await waitForOpen(raw)
  try {
    const before = sessions.size
    watcher.forget()

    raw.send(JSON.stringify({ type: 'hello', id: CONTROL_ID }))
    const err = await waitFor(rawMessages, (m) => m.type === 'error')
    assert.ok(err, 'the hello is answered')
    assert.equal(err.code, 'UNKNOWN_MESSAGE')
    assert.equal(err.message, 'must match pattern "^[A-Za-z0-9_-]+$"',
      'the character-set rule refuses it, not a length rule')

    await delay(80)
    assert.equal(sessions.size, before, 'no session was created')
    assert.deepEqual(rawMessages.filter((m) => m.type === 'hello'), [])
    assert.deepEqual(watcher.of('join'), [], 'nobody heard a `join`')
    assert.equal(raw.readyState, WebSocket.OPEN, 'the socket stays open')

    raw.send(JSON.stringify({ type: 'hello', id: 'raw-admitted' }))
    const reply = await waitFor(rawMessages, (m) => m.type === 'hello')
    assert.ok(reply, 'and the same socket is still usable')
    assert.equal(sessions.size, before + 1)
  } finally {
    raw.close()
    await watcher.close()
  }
})

// ===========================================================================
// scripting-4c revision round 2, W2 — the forwarded `from` is bounded
// ===========================================================================

test('AC3/W2: a 64-character id produces a forwarded activate under 400 bytes, and it validates', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const id64 = 'v'.repeat(64)
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, id64)
  const rawFrames = []
  host.ws.on('message', (raw) => rawFrames.push(raw.toString()))
  try {
    host.ready(); await host.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 3])
    host.forget()
    rawFrames.length = 0

    visitor.activate('Switch')
    const forwarded = await host.next(isActivateFor('Switch', id64, 1))
    assert.ok(forwarded, 'the forward reaches the host')
    assert.equal(forwarded.from, id64, '`from` is the sender’s id whole — the log line needs it')

    // M1's measurement, inverted: the frame that used to be 250,108 bytes.
    const frame = rawFrames.find((f) => f.includes('"activate"'))
    assert.ok(frame, 'the raw frame was captured')
    const bytes = Buffer.byteLength(frame)
    assert.ok(bytes < 400, `the forwarded frame is ${bytes} bytes, and 400 is the ceiling`)
    assert.equal(validate('server', forwarded).valid, true,
      'and it validates against activate.server.json (round 1’s AC3 test, now meaningful)')
  } finally {
    await visitor.close()
    await host.close()
  }
})

test('AC3/W2: a session whose id is outside the bound is not forwarded, and its sender gets INVALID_FIELD', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  const session = sessions.get('visitor-1')
  try {
    host.ready(); await host.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 1])
    host.forget()

    // A TEST-ONLY setup, as round 1's tests set state: the session map's entry
    // is given an id the schema could never have admitted. W1 makes this
    // unreachable; the forward's own check is the defence in depth.
    assert.ok(session, 'the session is in the map')
    session.id = 'outside\u001b'.repeat(9)          // 72 characters, with a control character

    const answer = await answerTo(visitor, visitor.activate('Switch'))
    assert.ok(answer, 'the sender is answered')
    assert.equal(answer.code, 'INVALID_FIELD')
    assert.equal(answer.message, 'the sender is not a valid session')
    await delay(60)
    assertNothingForwarded(host, 'nothing is forwarded from a session outside the bound')
  } finally {
    // Put the id back so the session's own cleanup (which is identity-safe by
    // id) still finds it and stops its tick loop.
    session.id = 'visitor-1'
    await visitor.close()
    await host.close()
  }
})

// ===========================================================================
// G2 — a throw inside the case is answered, and the session survives
// ===========================================================================

test('AC3/G2: a throw inside the activate case is answered and the session carries on', async () => {
  const { world, port, sessions } = await startWorld()
  addNodes(world, [behaviourNode('Switch')])
  const host = await open(port, 'owner-1', { as: OWNER })
  const visitor = await open(port, 'visitor-1')
  const original = world.som.getNodeByName.bind(world.som)
  try {
    host.ready(); await host.barrier()
    await placeAvatar(port, sessions, visitor, [0, 0, 1])
    host.forget()

    world.som.getNodeByName = (name) => {
      if (name === 'BOOM') throw new Error('injected failure')
      return original(name)
    }

    const s = visitor.activate('BOOM')
    const answer = await answerTo(visitor, s, 1500)
    assert.ok(answer, 'the failure is answered')
    assert.equal(answer.code, 'UNKNOWN_MESSAGE')
    assert.equal(answer.message, 'the message could not be processed')
    assert.equal(answer.seq, s, 'with the request’s seq')

    // The session, the world and the socket carry on.
    assert.equal(visitor.ws.readyState, WebSocket.OPEN)
    world.som.getNodeByName = original
    visitor.activate('Switch')
    assert.ok(await host.next(isActivateFor('Switch', 'visitor-1', 1)), 'the next activate is forwarded')
  } finally {
    world.som.getNodeByName = original
    await visitor.close()
    await host.close()
  }
})
