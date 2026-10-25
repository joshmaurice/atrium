// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// script-host.test.js — scripting-4b-1 step 2, E4: the script-host role.
//
// Two layers:
//   - real WebSocket servers on port 0, for the election, the handover, the
//     read-only policy and two worlds;
//   - a FAKE `wss` and FAKE sockets (review S-C), for the identity-safe cleanup
//     (review M2): a real handshake cannot land inside the race window, so the
//     test drives `attachSessionHandlers` directly and emits `connection` and
//     `close` itself.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { validate } from '@atrium/protocol'
import { createWorld } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import { createPresence } from '../src/presence.js'

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

async function connect(port, as = null) {
  const url = as ? `ws://127.0.0.1:${port}/?as=${encodeURIComponent(as)}` : `ws://127.0.0.1:${port}`
  const ws = new WebSocket(url)
  const messages = collect(ws)
  await waitForOpen(ws)
  return { ws, messages }
}

async function hello(ws, messages, id, capabilities = { tick: { interval: 5000 }, scriptRunner: 1 }) {
  ws.send(JSON.stringify({ type: 'hello', id, capabilities }))
  const reply = await waitFor(messages, (m) => m.type === 'hello')
  assert.ok(reply, 'hello reply should arrive')
  return reply
}

/** A world host whose upgrade handler takes the userId from `?as=`. */
async function startHostWorld({ owner = 'user-a', policy = null } = {}) {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const presence = createPresence()
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions, presence,
    worldOwnerUserId: owner,
    ...(policy ? { mutationPolicy: policy } : {}),
  })
  http.on('upgrade', (req, socket, head) => {
    const as = new URL(req.url, 'http://x').searchParams.get('as')
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, as ?? owner))
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, sessions, presence }
}

// ===========================================================================
// E4 — the election, over real sockets
// ===========================================================================

test('E4: the first eligible owner hello is the host; every other hello is not', async () => {
  const { port } = await startHostWorld()
  const a = await connect(port, 'user-a')
  const b = await connect(port, 'user-a')
  const v = await connect(port, 'user-z')
  try {
    const ha = await hello(a.ws, a.messages, 'owner-a')
    assert.equal(ha.canEdit, true)
    assert.equal(ha.scriptHost, true, 'the first owner is the host')
    assert.equal(ha.hostGen, 1, 'generation 1')
    assert.equal(validate('server', ha).valid, true, 'and the hello validates against E5’s schema')

    const hb = await hello(b.ws, b.messages, 'owner-b')
    assert.equal(hb.canEdit, true)
    assert.equal(hb.scriptHost, false, 'the second owner is not the host')
    assert.equal('hostGen' in hb, false, 'and carries no hostGen')
    assert.equal(validate('server', hb).valid, true)

    const hv = await hello(v.ws, v.messages, 'visitor')
    assert.equal(hv.canEdit, false)
    assert.equal(hv.scriptHost, false)
    assert.equal('hostGen' in hv, false)
    assert.equal(validate('server', hv).valid, true)
  } finally {
    a.ws.close(); await waitForClose(a.ws)
    b.ws.close(); await waitForClose(b.ws)
    v.ws.close(); await waitForClose(v.ws)
  }
})

test('E4: closing the host hands the role to the next owner, and tells nobody else', async () => {
  const { port, sessions } = await startHostWorld()
  const a = await connect(port, 'user-a')
  const b = await connect(port, 'user-a')
  const v = await connect(port, 'user-z')
  try {
    await hello(a.ws, a.messages, 'owner-a')
    await hello(b.ws, b.messages, 'owner-b')
    await hello(v.ws, v.messages, 'visitor')

    const vBefore = v.messages.length
    a.ws.close()
    await waitForClose(a.ws)

    const handover = await waitFor(b.messages, (m) => m.type === 'script-host')
    assert.ok(handover, 'the second owner is told')
    assert.deepEqual(handover, { type: 'script-host', active: true, hostGen: 2 })
    assert.equal(validate('server', handover).valid, true, 'and the message validates against E5’s schema')

    await delay(80)
    assert.deepEqual(
      v.messages.slice(vBefore).filter((m) => m.type === 'script-host'), [],
      'the visitor is never told')
    assert.equal(sessions.get('owner-b').canEdit, true)
  } finally {
    b.ws.close(); await waitForClose(b.ws)
    v.ws.close(); await waitForClose(v.ws)
  }
})

test('E4: a reconnecting former host does not take the role while another holds it', async () => {
  const { port } = await startHostWorld()
  const a = await connect(port, 'user-a')
  let a2
  const b = await connect(port, 'user-a')
  try {
    await hello(a.ws, a.messages, 'owner-a')
    await hello(b.ws, b.messages, 'owner-b')
    a.ws.close()
    await waitForClose(a.ws)
    assert.ok(await waitFor(b.messages, (m) => m.type === 'script-host' && m.hostGen === 2))

    a2 = await connect(port, 'user-a')
    const ha2 = await hello(a2.ws, a2.messages, 'owner-a')
    assert.equal(ha2.canEdit, true)
    assert.equal(ha2.scriptHost, false, 'the second session still holds the role')
    assert.equal('hostGen' in ha2, false)
  } finally {
    b.ws.close(); await waitForClose(b.ws)
    if (a2) { a2.ws.close(); await waitForClose(a2.ws) }
  }
})

test('E4: with no eligible session there is no host, and the next owner starts a new generation', async () => {
  const { port } = await startHostWorld()
  let c
  const a = await connect(port, 'user-a')
  const b = await connect(port, 'user-a')
  try {
    const ha = await hello(a.ws, a.messages, 'owner-a')
    assert.equal(ha.hostGen, 1)
    await hello(b.ws, b.messages, 'owner-b')

    a.ws.close(); await waitForClose(a.ws)
    assert.ok(await waitFor(b.messages, (m) => m.type === 'script-host' && m.hostGen === 2))
    b.ws.close(); await waitForClose(b.ws)

    c = await connect(port, 'user-a')
    const hc = await hello(c.ws, c.messages, 'owner-c')
    assert.equal(hc.scriptHost, true, 'a fresh election, not a revival')
    assert.equal(hc.hostGen, 3, 'the generation only ever increases (review S2)')
  } finally {
    if (c) { c.ws.close(); await waitForClose(c.ws) }
    a.ws.close(); await waitForClose(a.ws)
    b.ws.close(); await waitForClose(b.ws)
  }
})

test('E4: under a read-only policy no session is ever the host', async () => {
  const { port } = await startHostWorld({ policy: 'read-only' })
  const a = await connect(port, 'user-a')
  const b = await connect(port, 'user-a')
  try {
    const ha = await hello(a.ws, a.messages, 'ro-a')
    assert.equal(ha.canEdit, false)
    assert.equal(ha.scriptHost, false)
    assert.equal('hostGen' in ha, false)

    const hb = await hello(b.ws, b.messages, 'ro-b')
    assert.equal(hb.scriptHost, false)
    await delay(80)
    assert.equal(a.messages.some((m) => m.type === 'script-host'), false, 'nobody was ever told')
  } finally {
    a.ws.close(); await waitForClose(a.ws)
    b.ws.close(); await waitForClose(b.ws)
  }
})

test('E4: two worlds have independent hosts and independent generations', async () => {
  const one = await startHostWorld()
  const two = await startHostWorld()
  const a1 = await connect(one.port, 'user-a')
  const a2 = await connect(two.port, 'user-a')
  try {
    const h1 = await hello(a1.ws, a1.messages, 'world-one-owner')
    const h2 = await hello(a2.ws, a2.messages, 'world-two-owner')
    assert.equal(h1.scriptHost, true)
    assert.equal(h1.hostGen, 1)
    assert.equal(h2.scriptHost, true, 'each world elects its own host')
    assert.equal(h2.hostGen, 1, 'and starts its own generation')

    a1.ws.close(); await waitForClose(a1.ws)
    const b1 = await connect(one.port, 'user-a')
    try {
      const hb1 = await hello(b1.ws, b1.messages, 'world-one-second')
      assert.equal(hb1.hostGen, 2, 'world one moved on')
      assert.equal(one.sessions.size, 1)
      assert.equal(two.sessions.size, 1, 'world two is untouched')
    } finally {
      b1.ws.close(); await waitForClose(b1.ws)
    }
  } finally {
    a2.ws.close(); await waitForClose(a2.ws)
  }
})

// ===========================================================================
// E4 (M2) — the identity-safe cleanup, with a FAKE wss and FAKE sockets
// ===========================================================================

class FakeSocket {
  constructor() {
    this.readyState = 1
    this.OPEN = 1
    this.sent = []
    this._handlers = {}
    this.pings = 0
    this.terminated = false
    this.closed = false
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data) { this.sent.push(JSON.parse(data)) }
  ping() { this.pings += 1 }
  terminate() { this.terminated = true; this.readyState = 3 }
  close(code) { this.closed = true; this.readyState = 3; this._fire('close', code) }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  ofType(type) { return this.sent.filter((m) => m.type === type) }
  sendHello(id, capabilities = { tick: { interval: 5000 }, scriptRunner: 1 }) { this._fire('message', JSON.stringify({ type: 'hello', id, capabilities })) }
}

class FakeWss {
  constructor() { this._handlers = {} }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  emit(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  close() {}
}

/** One sweep tick: a long interval, and a wait that can only contain one. */
const SWEEP_MS = 250

async function startFakeHost() {
  const wss = new FakeWss()
  const sessions = new Map()
  const presence = createPresence()
  // Every session object ever registered, so a test whose assertions FAIL can
  // still stop each one's tick loop (a broken cleanupSession may drop a session
  // from `sessions` before the test gets to it).
  const seenSessions = new Set()
  const trackingPresence = {
    ...presence,
    add(id) { const entry = presence.add(id); const s = sessions.get(id); if (s) seenSessions.add(s); return entry },
  }
  const { closeKeepalive } = attachSessionHandlers({
    wss, world: null, sessions, presence: trackingPresence,
    worldOwnerUserId: 'user-a',
    keepaliveInterval: SWEEP_MS,
  })
  const stop = () => {
    closeKeepalive()
    for (const s of [...seenSessions, ...sessions.values()]) s.tickStop?.()
  }
  return { wss, sessions, presence, stop }
}

test('E4: the handover skips a visitor that connected before the eligible owner', async () => {
  // The role is `canEdit`'s, not the map's first OPEN socket: a visitor that
  // joined between the host and the next owner is never chosen.
  const { port } = await startHostWorld()
  const a = await connect(port, 'user-a')
  const v = await connect(port, 'user-z')
  const b = await connect(port, 'user-a')
  try {
    await hello(a.ws, a.messages, 'owner-a')
    await hello(v.ws, v.messages, 'visitor')
    await hello(b.ws, b.messages, 'owner-b')

    const vBefore = v.messages.length
    a.ws.close()
    await waitForClose(a.ws)

    const handover = await waitFor(b.messages, (m) => m.type === 'script-host')
    assert.ok(handover, 'the eligible owner gets the role')
    assert.equal(handover.hostGen, 2)
    await delay(80)
    assert.deepEqual(
      v.messages.slice(vBefore).filter((m) => m.type === 'script-host'), [],
      'the visitor, earlier in the map, is never chosen')
  } finally {
    b.ws.close(); await waitForClose(b.ws)
    v.ws.close(); await waitForClose(v.ws)
  }
})

test('E4/M2: a late close for an id a NEW session took does not clean the new session up', async () => {
  const { wss, sessions, presence, stop } = await startFakeHost()
  try {
    const A = new FakeSocket()
    wss.emit('connection', A, {}, 'user-a')
    A.sendHello('AAAAaaaa')
    await delay(20)
    assert.equal(A.ofType('hello')[0].scriptHost, true, 'A is the host')
    assert.equal(A.ofType('hello')[0].hostGen, 1)

    const B = new FakeSocket()
    wss.emit('connection', B, {}, 'user-a')
    B.sendHello('BBBBbbbb')
    await delay(20)
    assert.equal(B.ofType('hello')[0].scriptHost, false)
    assert.ok(presence.has('AAAAaaaa') && presence.has('BBBBbbbb'))

    // The sweep is about to terminate A on its own.
    sessions.get('AAAAaaaa').missedPings = 2
    await delay(SWEEP_MS + 70)

    assert.equal(A.terminated, true, 'the sweep terminated A')
    assert.equal(sessions.has('AAAAaaaa'), false, 'and cleaned up its entries')
    assert.equal(presence.has('AAAAaaaa'), false)
    const handovers = B.ofType('script-host')
    assert.equal(handovers.length, 1, 'exactly one handover happened')
    assert.deepEqual(handovers[0], { type: 'script-host', active: true, hostGen: 2 })

    // The race: a NEW connection takes A's session id.
    const C = new FakeSocket()
    wss.emit('connection', C, {}, 'user-a')
    C.sendHello('AAAAaaaa')
    await delay(20)
    const newSession = sessions.get('AAAAaaaa')
    assert.ok(newSession, 'the new session took the id')
    assert.notEqual(newSession.ws, A)
    assert.equal(presence.has('AAAAaaaa'), true, 'and registered its presence')
    assert.equal(C.ofType('hello')[0].scriptHost, false, 'B still holds the role')

    const bBefore = B.sent.length
    // A's socket finally closes — the late second cleanup.
    A._fire('close')
    await delay(40)

    assert.equal(sessions.get('AAAAaaaa'), newSession, 'the NEW session survives')
    assert.equal(presence.has('AAAAaaaa'), true, 'its presence survives')
    assert.equal(newSession.canEdit, true, 'and its eligibility is intact')
    assert.equal(B.ofType('script-host').length, 1, 'no second handover was sent')
    assert.equal(C.ofType('script-host').length, 0, 'and the new session was not made host')
    const late = B.sent.slice(bBefore).filter((m) => m.type === 'leave' || m.type === 'remove')
    assert.deepEqual(late, [], 'the late close broadcast nothing under that id')
    assert.equal(C.sent.filter((m) => m.type === 'leave' || m.type === 'remove').length, 0)
  } finally {
    stop()
  }
})

test('E4/N7: the handover skips a candidate the same sweep is about to terminate', async () => {
  const { wss, sessions, presence, stop } = await startFakeHost()
  try {
    const A = new FakeSocket()
    wss.emit('connection', A, {}, 'user-a')
    A.sendHello('AAAAaaaa')
    await delay(20)

    const B = new FakeSocket()
    wss.emit('connection', B, {}, 'user-a')
    B.sendHello('BBBBbbbb')

    const C = new FakeSocket()
    wss.emit('connection', C, {}, 'user-a')
    C.sendHello('CCCCcccc')
    await delay(20)

    // A (the host) and B are both at the sweep's limit; C is healthy.
    sessions.get('AAAAaaaa').missedPings = 2
    sessions.get('BBBBbbbb').missedPings = 2
    await delay(SWEEP_MS + 70)

    assert.equal(A.terminated, true)
    assert.equal(B.terminated, true, 'the sweep reached B too')
    assert.deepEqual(C.ofType('script-host'), [{ type: 'script-host', active: true, hostGen: 2 }],
      'the role went to the healthy session, never to one about to be dropped')
    assert.deepEqual(B.ofType('script-host'), [], 'B was passed over')
    assert.ok(presence.has('CCCCcccc'))
    assert.equal(sessions.get('CCCCcccc').ws, C)
  } finally {
    stop()
  }
})

// ===========================================================================
// scripting-4b-2 F-L6 — the election needs canEdit AND scriptRunner: 1
// ===========================================================================

test('F-L6: an owner hello without scriptRunner never holds the role, and is never handed one', async () => {
  const { port } = await startHostWorld()
  const plain = await connect(port, 'user-a')
  const capable = await connect(port, 'user-a')
  const capable2 = await connect(port, 'user-a')
  try {
    // The first owner hello carries no runner capability: canEdit, no role.
    const hPlain = await hello(plain.ws, plain.messages, 'plain-owner', { tick: { interval: 5000 } })
    assert.equal(hPlain.canEdit, true, 'it still owns the world')
    assert.equal(hPlain.scriptHost, false, 'but it is not the script host')
    assert.equal('hostGen' in hPlain, false)

    // The next capable owner takes the role.
    const hCapable = await hello(capable.ws, capable.messages, 'capable-owner')
    assert.equal(hCapable.scriptHost, true)
    assert.equal(hCapable.hostGen, 1)

    const hCapable2 = await hello(capable2.ws, capable2.messages, 'capable-owner-2')
    assert.equal(hCapable2.scriptHost, false, 'the role is held')

    // The capable host leaves: the role must NOT go to the capability-less
    // owner ahead of it in session order, and must go to the next capable one.
    capable.ws.close(); await waitForClose(capable.ws)
    const handed = await waitFor(capable2.messages, (m) => m.type === 'script-host' && m.active === true)
    assert.ok(handed, 'the next capable owner is handed the role')
    assert.equal(handed.hostGen, 2)

    const leftover = plain.messages.filter((m) => m.type === 'script-host')
    assert.deepEqual(leftover, [], 'the capability-less owner is passed over in silence')
  } finally {
    plain.ws.close(); await waitForClose(plain.ws)
    capable2.ws.close(); await waitForClose(capable2.ws)
  }
})

test('F-L6: a hello whose scriptRunner is not 1 is refused by the schema', async () => {
  const { port } = await startHostWorld()
  const a = await connect(port, 'user-a')
  try {
    a.ws.send(JSON.stringify({ type: 'hello', id: 'bad-cap', capabilities: { scriptRunner: 2 } }))
    const err = await waitFor(a.messages, (m) => m.type === 'error')
    assert.ok(err, 'the message is refused')
    assert.equal(err.code, 'UNKNOWN_MESSAGE')
  } finally {
    a.ws.close(); await waitForClose(a.ws)
  }
})
