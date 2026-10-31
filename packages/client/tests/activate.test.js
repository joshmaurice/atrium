// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// activate.test.js — scripting-4c step 4, AC4: the client's half of `activate`,
// and the reviewer's HELD LOAD (spec §6, AC5) through the real client, the real
// runner and a REAL port-0 server.
//
// Two layers, on purpose:
//   - a MOCK socket for the states that must be driven exactly (before
//     session:ready, between session:ready and world:loaded, a refusal, the
//     reconnect that must not name the old connection's node);
//   - REAL sockets on port 0 for the hello the server actually sees, for the two
//     FROZEN server schemas the client's cross-origin hello must satisfy, and for
//     the held load.
//
// The held load lives HERE, not in packages/behaviors: `@atrium/behaviors`
// deliberately depends on neither the client nor the server, and this is the one
// test that needs both plus the runner. The runner is imported by path, exactly
// as packages/server's tests import the templates.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Document, NodeIO } from '@gltf-transform/core'
import { SOMDocument } from '@atrium/som'
import { validate } from '@atrium/protocol'
import { createRequire } from 'node:module'
import WebSocket, { WebSocketServer } from 'ws'

// The two frozen schemas are compiled the way the SERVER compiles its own: with
// Ajv, `strict: false`. `ajv` is `@atrium/protocol`'s dependency (it is the one
// that compiles the schemas), so it is resolved from there rather than assumed
// to be hoisted into this package.
const requireFromProtocol = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../protocol/package.json'))
const AjvModule = requireFromProtocol('ajv')
const Ajv = AjvModule.default ?? AjvModule

import { AtriumClient, ACTIVATIONS_MAX } from '../src/AtriumClient.js'
import { createWorld } from '../../server/src/world.js'
import { attachSessionHandlers } from '../../server/src/session.js'
import { createPresence } from '../../server/src/presence.js'
import { createBehaviorRunner } from '../../behaviors/src/runner.js'
import { templateGraph } from '../../behaviors/src/templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const COMPAT = resolve(__dirname, '../../../tests/fixtures/protocol-compat')

const OWNER = 'user-a'
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const closers = []
after(async () => {
  for (const close of closers.reverse()) {
    try { await close() } catch { /* best effort */ }
  }
})

async function waitFor(pred, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = pred()
    if (found) return found
    await delay(5)
  }
  return null
}

// ===========================================================================
// Layer 1 — a mock socket, for the states that must be driven exactly
// ===========================================================================

class MockWebSocket {
  constructor() {
    this.readyState = 1
    this.sent = []
    this._handlers = {}
    this.closed = false
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.closed = true; this.readyState = 3 }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
  of(type) { return this.sent.filter((m) => m.type === type) }
}

function makeClient({ scriptRunner = false, avatar = null } = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock', { scriptRunner, ...(avatar ? { avatar } : {}) })
  client._sessionId = 'session-aabbccdd'
  return { client, mock: mocks[0], mocks }
}

/** The server's `hello`, over the mock socket, through the real dispatch path. */
async function handshake(client, mock, { scriptHost = true, hostGen = 1 } = {}) {
  mock.simulateMessage({
    type: 'hello', id: client._sessionId, seq: 1,
    avatarNodeName: 'avatar-aabbccdd', displayName: 'User-sess',
    serverTime: Date.now(), canPlaceTeleporters: true, canEdit: true,
    signedIn: false, scriptHost, ...(scriptHost ? { hostGen } : {}),
    capabilities: { tick: { interval: 1000 } },
  })
  await delay(10)
}

/** A real `som-dump`, through the real inbound path. */
async function loadWorld(client, mock) {
  const doc = new Document()
  doc.createScene('Scene')
  const { json } = await new NodeIO().writeJSON(doc)
  mock.simulateMessage({ type: 'som-dump', seq: 2, gltf: json })
  await delay(30)
  return json
}

test('AC4/G5: the hello carries scriptRunner: 3 only when asked, and NO key otherwise', () => {
  const on = makeClient({ scriptRunner: true })
  on.mock._fire('open')
  const helloOn = on.mock.of('hello')[0]
  assert.equal(helloOn.capabilities.scriptRunner, 3, 'a 4d page that runs graphs says so')
  assert.equal(validate('client', helloOn).valid, true)

  const off = makeClient()
  off.mock._fire('open')
  const helloOff = off.mock.of('hello')[0]
  assert.equal('scriptRunner' in helloOff.capabilities, false,
    'the key’s ABSENCE is the one shape every released server accepts (P23)')
  assert.equal(validate('client', helloOff).valid, true, 'and it is still a valid hello')
  assert.equal(helloOff.capabilities.tick.interval, 5000, 'the rest of the capabilities are unchanged')
})

test('AC4/S1: activate sends nothing before session:ready', async () => {
  const { client, mock } = makeClient()
  assert.equal(client.activate('Switch'), null, 'not connected: null, nothing sent')
  assert.equal(mock.of('activate').length, 0)
  assert.equal(client.activate(''), null, 'an empty name is refused')
  assert.equal(client.activate(42), null, 'a non-string is refused')
})

test('AC4/S1: between session:ready and world:loaded it still sends nothing', async () => {
  const { client, mock } = makeClient()
  await handshake(client, mock)
  assert.equal(client.connected, true)
  assert.equal(client.activate('Switch'), null, 'no world yet: null')
  assert.equal(mock.of('activate').length, 0, 'and NOTHING on the wire — an error here would fail a pending connect (P15)')
  assert.equal(client._connectionRecord.pendingActivations.size, 0)

  await loadWorld(client, mock)
  const seq = client.activate('Switch')
  assert.equal(typeof seq, 'number', 'after BOTH, it sends')
  assert.deepEqual(mock.of('activate').at(-1), { type: 'activate', seq, node: 'Switch', event: 'select' })
  assert.equal(validate('client', mock.of('activate').at(-1)).valid, true)
})

test('AC4: a refusal emits activate:refused with the node and code, and resolves no edit', async () => {
  const { client, mock } = makeClient()
  await handshake(client, mock)
  await loadWorld(client, mock)

  const refused = []
  const rejected = []
  const errors = []
  client.on('activate:refused', (e) => refused.push(e))
  client.on('edit:rejected', (e) => rejected.push(e))
  client.on('error', (e) => errors.push(e))

  const seq = client.activate('Switch')
  mock.simulateMessage({ type: 'error', code: 'NO_SCRIPT_HOST', message: 'nothing runs here', seq })
  await delay(5)

  assert.deepEqual(refused, [{ node: 'Switch', code: 'NO_SCRIPT_HOST', message: 'nothing runs here', seq }])
  assert.equal(errors.length, 1, 'the usual error event still fires')
  assert.deepEqual(rejected, [], 'an activation refusal NEVER reaches the edit paths (P15)')
  assert.equal(client._connectionRecord.pendingActivations.has(seq), false, 'and the entry is consumed')

  // An error the client never asked for resolves nothing.
  mock.simulateMessage({ type: 'error', code: 'RATE_LIMITED', message: 'x', seq: 9999 })
  await delay(5)
  assert.equal(refused.length, 1, 'a seq that is not in the map is left alone')
})

test('AC4: the map holds 16, and the 17th outstanding activation evicts the first', async () => {
  const { client, mock } = makeClient()
  await handshake(client, mock)
  await loadWorld(client, mock)

  const first = client.activate('Node-1')
  for (let i = 2; i <= ACTIVATIONS_MAX; i++) client.activate(`Node-${i}`)
  const map = client._connectionRecord.pendingActivations
  assert.equal(map.size, ACTIVATIONS_MAX)
  assert.equal(map.has(first), true)

  const seventeenth = client.activate('Node-17')
  assert.equal(map.size, ACTIVATIONS_MAX, 'still bounded')
  assert.equal(map.has(first), false, 'the oldest entry is dropped')
  assert.equal(map.get(seventeenth), 'Node-17')

  // The evicted one can no longer name anything.
  const refused = []
  client.on('activate:refused', (e) => refused.push(e))
  mock.simulateMessage({ type: 'error', code: 'RATE_LIMITED', message: 'x', seq: first })
  await delay(5)
  assert.equal(refused.length, 0, 'its answer names nothing: the entry is gone')
})

test('AC4/S3: after a reconnect, a refusal names the NEW node, never the old one', async () => {
  const { client, mock, mocks } = makeClient()
  await handshake(client, mock)
  await loadWorld(client, mock)
  const staleSeq = client.activate('Node-X')       // never answered
  const staleSeq2 = client.activate('Node-X2')     // and a second one, so a
                                                   // connection-agnostic map keeps
                                                   // an entry the new one never uses
  assert.equal(staleSeq, 1)
  assert.equal(staleSeq2, 2)

  // A new connection: a new record, and `_sendSeq` starts again at 0 (P21).
  client.connect('ws://mock-2')
  const mock2 = mocks[1]
  client._sessionId = 'session-2'
  await handshake(client, mock2)
  await loadWorld(client, mock2)

  const refused = []
  client.on('activate:refused', (e) => refused.push(e))
  const newSeq = client.activate('Node-Y')
  assert.equal(newSeq, staleSeq, 'the counter restarted, so the seq repeats across connections')

  mock2.simulateMessage({ type: 'error', code: 'RATE_LIMITED', message: 'too many', seq: newSeq })
  await delay(5)
  assert.equal(refused.length, 1)
  assert.equal(refused[0].node, 'Node-Y', 'the map is per record, so the answer names Y')
  assert.notEqual(refused[0].node, 'Node-X', 'NEVER the previous connection’s node')

  // THE STAGE A CONNECTION-AGNOSTIC MAP CANNOT COVER (P21): a seq that belongs to
  // no activation on THIS connection — the previous connection's — was consumed
  // with it, so it names NOTHING. A map that outlived the connection still holds
  // Node-X2 there, and would name it.
  mock2.simulateMessage({ type: 'error', code: 'RATE_LIMITED', message: 'stale', seq: staleSeq2 })
  await delay(5)
  assert.equal(refused.length, 1,
    'an error for a seq this connection never asked about names nothing, never the old connection’s node')
  assert.equal(client._connectionRecord.pendingActivations.size, 0, 'and the new record’s map is empty')

  // A late error from the OLD socket is dropped by dispatch’s record guard.
  mock.simulateMessage({ type: 'error', code: 'RATE_LIMITED', message: 'late', seq: staleSeq })
  await delay(5)
  assert.equal(refused.length, 1, 'a superseded socket’s message is dropped')
})

test('AC4/M1: scriptReady sends once per hostGen per connection, never while inactive', async () => {
  const { client, mock } = makeClient()
  await handshake(client, mock, { scriptHost: false })

  assert.equal(client.scriptReady(), false, 'a tab that is not the host says nothing')
  assert.equal(mock.of('script-ready').length, 0)

  // The role arrives on this same connection.
  mock.simulateMessage({ type: 'script-host', active: true, hostGen: 4 })
  await delay(5)
  assert.equal(client.scriptReady(), true)
  assert.deepEqual(mock.of('script-ready'), [{ type: 'script-ready', hostGen: 4 }])
  assert.equal(client.scriptReady(), false, 'once per hostGen per connection')
  assert.equal(mock.of('script-ready').length, 1)

  // A NEW generation on the same connection: it may say so again.
  mock.simulateMessage({ type: 'script-host', active: true, hostGen: 5 })
  await delay(5)
  assert.equal(client.scriptReady(), true)
  assert.deepEqual(mock.of('script-ready').at(-1), { type: 'script-ready', hostGen: 5 })

  // Losing the role stops it.
  mock.simulateMessage({ type: 'script-host', active: false, hostGen: 5 })
  await delay(5)
  assert.equal(client.scriptReady(), false, 'never while inactive')
  assert.equal(mock.of('script-ready').length, 2)
})

test('AC4: after a reconnect’s new grant, scriptReady sends again', async () => {
  const { client, mock, mocks } = makeClient()
  await handshake(client, mock, { scriptHost: true, hostGen: 2 })
  assert.equal(client.scriptReady(), true)
  assert.deepEqual(mock.of('script-ready'), [{ type: 'script-ready', hostGen: 2 }])

  client.connect('ws://mock-2')
  const mock2 = mocks[1]
  client._sessionId = 'session-3'
  await handshake(client, mock2, { scriptHost: true, hostGen: 3 })
  await loadWorld(client, mock2)
  assert.equal(client.scriptReady(), true, 'the new connection’s own record has sent nothing')
  assert.deepEqual(mock2.of('script-ready'), [{ type: 'script-ready', hostGen: 3 }])
  assert.equal(mock.of('script-ready').length, 1, 'and the old socket was not touched again')
})

test('AC4: an inbound activate is emitted only for the current generation, while this client holds the role', async () => {
  const { client, mock } = makeClient()
  await handshake(client, mock, { scriptHost: true, hostGen: 7 })
  const seen = []
  client.on('activate', (e) => seen.push(e))

  mock.simulateMessage({ type: 'activate', seq: 1, node: 'Switch', event: 'select', from: 'visitor-1', hostGen: 7 })
  await delay(5)
  assert.deepEqual(seen, [{ node: 'Switch', from: 'visitor-1' }])

  mock.simulateMessage({ type: 'activate', seq: 2, node: 'Switch', event: 'select', from: 'visitor-1', hostGen: 6 })
  await delay(5)
  assert.equal(seen.length, 1, 'an older generation is dropped without a word')

  mock.simulateMessage({ type: 'activate', seq: 3, node: 'Switch', event: 'hover', from: 'visitor-1', hostGen: 7 })
  await delay(5)
  assert.equal(seen.length, 1, 'a non-select event is dropped too')

  // The role goes: nothing more is emitted.
  mock.simulateMessage({ type: 'script-host', active: false, hostGen: 7 })
  await delay(5)
  mock.simulateMessage({ type: 'activate', seq: 4, node: 'Switch', event: 'select', from: 'visitor-1', hostGen: 7 })
  await delay(5)
  assert.equal(seen.length, 1, 'a tab that is not the host never emits one')

  // A NON-host that has never held the role: same.
  const visitor = makeClient()
  await handshake(visitor.client, visitor.mock, { scriptHost: false })
  const visitorSeen = []
  visitor.client.on('activate', (e) => visitorSeen.push(e))
  visitor.mock.simulateMessage({ type: 'activate', seq: 5, node: 'Switch', event: 'select', from: 'x', hostGen: 1 })
  await delay(5)
  assert.equal(visitorSeen.length, 0)
})

// ===========================================================================
// Layer 2 — REAL sockets on port 0
// ===========================================================================

function listen(http) {
  return new Promise((res, rej) => {
    http.once('error', rej)
    http.listen(0, '127.0.0.1', () => res(http.address().port))
  })
}

async function startHostWorld({ world = null } = {}) {
  const theWorld = world ?? await createWorld(SPACE)
  const http = createServer()
  const port = await listen(http)
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Map()
  const captured = []                       // every raw client message, as text
  const { closeKeepalive } = attachSessionHandlers({
    wss, world: theWorld, sessions, presence: createPresence(),
    worldOwnerUserId: OWNER, worldId: 'client-activate',
  })
  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (raw) => captured.push(String(raw)))
      wss.emit('connection', ws, req, OWNER)
    })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world: theWorld, port, sessions, captured }
}

/** A real client, connected and waiting for `session:ready`. */
async function connectReal(port, { scriptRunner = false, avatar = null, waitForWorld = false } = {}) {
  const client = new AtriumClient({ connectTimeout: 0 })
  // Registered BEFORE the connect, so the fairly-early som-dump can never beat
  // the listener and leave the test waiting for an event that already fired.
  const state = { loaded: false }
  client.on('world:loaded', () => { state.loaded = true })
  const ready = new Promise((res, rej) => {
    client.on('session:ready', res)
    client.on('error', rej)
    client.on('disconnected', (d) => rej(new Error(`disconnected: ${d.reason}`)))
  })
  client.connect(`ws://127.0.0.1:${port}`, { scriptRunner, ...(avatar ? { avatar } : {}) })
  await ready
  if (waitForWorld) await waitFor(() => state.loaded, 4000)
  client.worldLoaded = () => state.loaded
  return client
}

/** The first message of a type the host captured, parsed. */
function capturedOf(captured, type) {
  for (const raw of captured) {
    let msg
    try { msg = JSON.parse(raw) } catch { continue }
    if (msg.type === type) return msg
  }
  return null
}

test('AC4/M1: with scriptRunner: true the real server elects this client the host', async () => {
  const { port, captured } = await startHostWorld()
  const client = await connectReal(port, { scriptRunner: true })
  try {
    const hello = capturedOf(captured, 'hello')
    assert.equal(hello.capabilities.scriptRunner, 3, 'the wire says 3')
    assert.equal(client.scriptHost.active, true, 'and the server made it the host')
    assert.equal(client.scriptHost.hostGen, 1)
    assert.equal(client.canEdit, true)

    // The runner's readiness call is what marks it ready, and it is on the wire.
    assert.equal(client.scriptReady(), true)
    const ready = await waitFor(() => capturedOf(captured, 'script-ready'))
    assert.ok(ready, 'script-ready reached the server')
    assert.equal(ready.hostGen, 1)
  } finally {
    client.disconnect()
  }
})

test('AC4/M1: without it the hello has NO scriptRunner key, and the three frozen server schemas accept it', async () => {
  const { port, captured } = await startHostWorld()
  const client = await connectReal(port)
  try {
    const hello = capturedOf(captured, 'hello')
    assert.equal('scriptRunner' in hello.capabilities, false, 'the key is absent, not 0 and not 1')
    assert.equal(client.scriptHost.active, false, 'a connection with no capability is never the host')

    // Compiled the way the SERVER compiles them (Ajv, strict: false), with the
    // schemas copied byte for byte from git — see the README beside them.
    const ajv = new Ajv({ strict: false })
    for (const name of ['hello.client.pre-4b-2.json', 'hello.client.71b6e40b.json', 'hello.client.14ab0076.json']) {
      const schema = JSON.parse(readFileSync(resolve(COMPAT, name), 'utf8'))
      const check = ajv.compile(schema)
      assert.equal(check(hello), true,
        `${name} must accept the exact hello this client sends: ${JSON.stringify(check.errors)}`)
    }

    // Sanity: the fixtures really are different schemas — a hello carrying 3 is
    // refused by ALL THREE (which is why the key is omitted off-origin).
    for (const name of ['hello.client.pre-4b-2.json', 'hello.client.71b6e40b.json', 'hello.client.14ab0076.json']) {
      const check = ajv.compile(JSON.parse(readFileSync(resolve(COMPAT, name), 'utf8')))
      assert.equal(check({ ...hello, capabilities: { ...hello.capabilities, scriptRunner: 3 } }), false,
        `${name} refuses scriptRunner: 3, so a cross-origin hello must not carry it`)
    }
  } finally {
    client.disconnect()
  }
})

// ---------------------------------------------------------------------------
// The reviewer's held load (spec §6, AC5, Rev 1.2 S2)
//
// The owner's world load is held AT THE SERVER by wrapping the real world's
// `serialize` (NO test seam in `src`). `serialize` is shared by every connection,
// so the ORDER is: the visitor first (with a view in reach), THEN the hold, THEN
// the owner.
// ---------------------------------------------------------------------------

test('AC5/M1 — the held load: a click during the owner’s load is refused, and works once the runner is ready', async () => {
  // The world the held load runs in: a Switch with an on-select behaviour that
  // HIDES a target cube, so the effect is visible in the visitor's `set`.
  const world = await createWorld(SPACE)
  const targetId = randomUUID()
  const switchId = randomUUID()
  assert.equal(world.addNode({ name: 'Target', translation: [2, 0, 0], extras: { atrium: { objectId: targetId } } }, null).ok, true)
  const behavior = templateGraph('select-visibility', { target: targetId, action: 'hide' }, { ownId: switchId })
  assert.equal(world.addNode({ name: 'Switch', translation: [0, 0, 0], extras: { atrium: { objectId: switchId, behavior } } }, null).ok, true)

  const { port, sessions } = await startHostWorld({ world })

  // --- 1. the VISITOR first: world:loaded, its avatar add, and a view in reach
  const visitor = await connectReal(port, { avatar: { name: 'visitor', translation: [0, 0, 3] }, waitForWorld: true })
  visitor.setView({ position: [0, 0, 3] })
  assert.ok(await waitFor(() => sessions.get(visitor._sessionId)?.avatarNode != null),
    'the visitor’s avatar add was accepted')
  assert.ok(await waitFor(() => {
    const t = sessions.get(visitor._sessionId)?.avatarNode?.translation
    return Array.isArray(t) && t[2] === 3
  }), 'and its view was applied within 10 m of the Switch')

  // --- 2. install the hold on the real world's serialize
  let release = null
  const held = new Promise((res) => { release = res })
  const realSerialize = world.serialize.bind(world)
  world.serialize = async (...args) => { await held; return realSerialize(...args) }

  // --- 3. the OWNER: its runner exists BEFORE the grant (as the app's does), the
  //        role arrives, and its som-dump does NOT
  const refusals = []
  visitor.on('activate:refused', (e) => refusals.push(e))

  const owner = new AtriumClient({ connectTimeout: 0 })
  const ownerState = { loaded: false }
  owner.on('world:loaded', () => { ownerState.loaded = true })
  // THE REAL RUNNER, created where the app creates it: before the connect, so it
  // sees the grant and the grant alone. This is what makes proof (g3) observable
  // — a runner that said "ready" on the GRANT (instead of when its engines
  // exist) would release the visitor's click into a tab that cannot run it yet.
  const runner = createBehaviorRunner({
    client: owner,
    position: (node) => (node ? [...node.translation] : undefined),
    localAvatar: () => owner.som?.getNodeByName(owner._avatarNodeName) ?? null,
  })
  const ownerReady = new Promise((res, rej) => {
    owner.on('session:ready', res)
    owner.on('error', rej)
  })
  owner.connect(`ws://127.0.0.1:${port}`, { scriptRunner: true, avatar: { name: 'owner', translation: [0, 0, 4] } })
  await ownerReady
  owner.worldLoaded = () => ownerState.loaded
  assert.equal(owner.scriptHost.active, true, 'the owner holds the role from its hello')

  try {
    await delay(120)
    assert.equal(owner.worldLoaded(), false, 'its world load is held, so no som-dump has arrived')
    assert.equal(owner.connected, true)
    assert.equal(runner.enabled, false, 'and the runner is NOT enabled: no world, no engines')

    // --- 4. the visitor’s click: NO_SCRIPT_HOST, and the owner sees nothing
    const ownerActivates = []
    owner.on('activate', (e) => ownerActivates.push(e))
    const visitorSets = []
    visitor.on('som:set', (e) => { if (e.nodeName === 'Target') visitorSets.push(e) })

    visitor.activate('Switch')
    const refused = await waitFor(() => refusals[0], 1500)
    assert.ok(refused, 'a click during the load is answered, never silence')
    assert.equal(refused.code, 'NO_SCRIPT_HOST')
    assert.equal(refused.message, "the world's owner isn't ready yet")
    assert.deepEqual(ownerActivates, [], 'and nothing was forwarded into the void')

    // --- 5. release: the owner loads, the runner says it is ready, the click runs
    release()
    await waitFor(() => owner.worldLoaded(), 4000)
    assert.equal(owner.worldLoaded(), true, 'the world reached the owner once the hold was released')
    assert.ok(await waitFor(() => runner.enabled, 2000), 'and the runner became enabled: its engines exist')

    // The runner said it is ready; a probe may still land in the window, so the
    // click is retried — the point is that it NEVER stays refused. `runner.tick()`
    // is the app's frame loop: it is what drains the engine's queued send.
    let effect = null
    const until = Date.now() + 8000
    let lastActivate = 0
    while (Date.now() < until && !effect) {
      if (Date.now() - lastActivate > 200) { visitor.activate('Switch'); lastActivate = Date.now() }
      runner.tick()
      effect = await waitFor(() => visitorSets.find((e) => e.value === false), 25)
    }
    assert.ok(effect, 'the owner’s engine ran, and its set reached the visitor')
    assert.equal(effect.nodeName, 'Target')
    assert.equal(effect.value, false, 'the switch hid the target everywhere')

    const line = runner.log.find((l) => l.message.startsWith('select from '))
    assert.ok(line, 'and the host’s log names where the click came from')
    assert.equal(line.message, `select from ${visitor._sessionId.slice(0, 8)}`)
  } finally {
    runner.dispose()
    world.serialize = realSerialize
    owner.disconnect()
    visitor.disconnect()
  }
})
