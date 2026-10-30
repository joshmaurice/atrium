// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-walk.test.js — scripting-4b-2 round 5, V9.
//
// M2: one owner `send` of a behaviour whose `graph` is an array nested 6,500
// deep threw `RangeError: Maximum call stack size exceeded` in the recursive
// `hasForbiddenKey`, nothing caught it, and the SERVER PROCESS EXITED — every
// world on it dropped. V9 makes the walk iterative in both copies and makes the
// send, add and load paths fail closed.
//
// The server tests here run the server in a CHILD PROCESS, so the failure a
// regression produces is the child's exit, never the test runner's.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Document } from '@gltf-transform/core'
import WebSocket from 'ws'

import { behaviorCheck, authorizeSend, BEHAVIOR_LEAF } from '../src/send-policy.js'
import { behaviorCheck as clientBehaviorCheck } from '../../behaviors/src/behavior-spec.js'
import { healDocumentBehaviors, createWorld } from '../src/world.js'
import { templateGraph } from '../../behaviors/src/templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const HELPER = resolve(__dirname, 'helpers/deep-server.mjs')

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'

/** A value `Object.keys` reaches but reading a key throws. */
function throwingBehaviour() {
  const value = {
    kind: 'graph', origin: 'local', enabled: true,
    graph: { nodes: [], declarations: [], types: [] },
    nodeMap: [OWN],
  }
  Object.defineProperty(value, 'kind', {
    get() { throw new Error('the value blew up') },
    enumerable: true,
    configurable: true,
  })
  return value
}

/** An array nested `n` deep; built iteratively, so 100,000 costs nothing. */
function deepArray(n) {
  let value = []
  for (let i = 0; i < n; i++) value = [value]
  return value
}

/** `levels` plain objects wrapped around a string. */
function nest(levels) {
  let value = 'x'
  for (let i = 0; i < levels; i++) value = { a: value }
  return value
}

const valid = () => templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN })

// ══════════════════════════════════════════════════════════════════════════
// The walk, on BOTH copies
// ══════════════════════════════════════════════════════════════════════════

// The value's root is depth 1, `targets` is depth 2 and `targets[0]` is depth
// 3, so `nest(5)` reaches a scalar at exactly the limit (8) and `nest(6)` is
// one past it.
const atLimit = () => ({ ...valid(), targets: [nest(5)] })
const pastLimit = () => ({ ...valid(), targets: [nest(6)] })

test('V9 — the server copy: the depth limit is exact (the limit passes, the limit + 1 is refused)', () => {
  assert.notEqual(behaviorCheck(atLimit(), { ownId: OWN }).problem, 'behavior-type',
    'depth 8 passes the walk and is refused later, by the map rule')
  assert.equal(behaviorCheck(atLimit(), { ownId: OWN }).problem, 'behavior-map')
  assert.equal(behaviorCheck(pastLimit(), { ownId: OWN }).problem, 'behavior-type',
    'depth 9 is refused by the walk')
})

test('V9 — the server copy: a forbidden key at depth 3 is found', () => {
  const proto = JSON.parse('{"a":{"b":{"__proto__":{"x":1}}}}')     // an OWN __proto__ key
  const value = { ...valid(), targets: [proto] }
  assert.equal(behaviorCheck(value, { ownId: OWN }).problem, 'behavior-type')
})

test('V9 — the server copy: a 100,000-deep array is refused, with no RangeError', () => {
  const value = { ...valid(), targets: [deepArray(100000)] }
  let verdict
  assert.doesNotThrow(() => { verdict = behaviorCheck(value, { ownId: OWN }) },
    'the walk never recurses, so the stack is untouched')
  assert.equal(verdict.problem, 'behavior-type')
})

test('V9 — the CLIENT copy (behavior-spec.js): the same three cases', () => {
  assert.equal(clientBehaviorCheck(atLimit(), { ownId: OWN }).problem, 'behavior-map')
  assert.equal(clientBehaviorCheck(pastLimit(), { ownId: OWN }).problem, 'behavior-type')
  const proto = JSON.parse('{"a":{"b":{"__proto__":{"x":1}}}}')
  assert.equal(clientBehaviorCheck({ ...valid(), targets: [proto] }, { ownId: OWN }).problem, 'behavior-type')
  let verdict
  assert.doesNotThrow(() => { verdict = clientBehaviorCheck({ ...valid(), targets: [deepArray(100000)] }, { ownId: OWN }) })
  assert.equal(verdict.problem, 'behavior-type')
})

// ══════════════════════════════════════════════════════════════════════════
// The server: the M2 send, in a child process
// ══════════════════════════════════════════════════════════════════════════

const children = []
after(() => { for (const child of children) { try { child.kill('SIGKILL') } catch { /* gone */ } } })

/** Start the child server and resolve its port. */
function startChild(extraArgs = []) {
  const child = spawn(process.execPath, [HELPER, SPACE, ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
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
    child.stderr.on('data', (buf) => out.push(String(buf)))
    child.on('exit', (code) => {
      if (!out.join('').includes('PORT ')) { clearTimeout(timer); rej(new Error(`the child exited ${code}: ${out.join('')}`)) }
    })
  })
  return { child, port, out }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function waitForOpen(ws) {
  return new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) return res()
    ws.once('open', res)
    ws.once('error', rej)
  })
}

function collect(ws) {
  const messages = []
  ws.on('message', (raw) => { try { messages.push(JSON.parse(raw)) } catch { /* ignore */ } })
  return messages
}

async function waitFor(messages, pred, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = messages.find(pred)
    if (found) return found
    await delay(10)
  }
  return null
}

let seqCounter = 5000
const answers = (m, seq) => (m.type === 'error' ? m.seq === seq : m.requestSeq === seq)

async function send(ws, messages, node, field, value) {
  const seq = ++seqCounter
  ws.send(JSON.stringify({ type: 'send', seq, node, field, value }))
  return waitFor(messages, (m) => answers(m, seq))
}

async function hello(ws, messages, id) {
  // scripting-4c S2 — the role needs `scriptRunner: 2`. This test only sends
  // edits, so the value is incidental; it is 2 to match a 4c page.
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 }, scriptRunner: 2 } }))
  const reply = await waitFor(messages, (m) => m.type === 'hello')
  assert.ok(reply, 'the hello reply arrives')
  return reply
}

test('V9 — a 6,500-deep behaviour send is refused, and the server keeps serving', async () => {
  const { child, port, out } = startChild()
  const socketPort = await port
  const ws = new WebSocket(`ws://127.0.0.1:${socketPort}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  try {
    await hello(ws, messages, 'owner-1')
    const id = randomUUID()
    const took = await send(ws, messages, 'crate-01', 'extras.atrium.objectId', id)
    assert.equal(took.type, 'set', 'the node took an object id')

    // The behaviour the outside review used: `graph` is an array nested 6,500
    // deep (about 13 kB of JSON). The MESSAGE is built as TEXT: `JSON.stringify`
    // is itself recursive and overflows on this value, which is why the review
    // hand-built it too.
    const depth = 6500
    const seq = ++seqCounter
    ws.send('{"type":"send","seq":' + seq + ',"node":"crate-01","field":"' + BEHAVIOR_LEAF + '",'
      + '"value":{"kind":"graph","origin":"local","enabled":true,"nodeMap":["' + id + '"],'
      + '"graph":' + '['.repeat(depth) + ']'.repeat(depth) + '}}')
    // Round 6, W0: the message-depth-guard hotfix (G1) runs right after
    // JSON.parse and before the schema check, so a message nested this deep is
    // refused by the guard (UNKNOWN_MESSAGE, "message nested too deeply") and
    // never reaches `authorizeSend`. The walk below still returns
    // `behavior-type` for the SAME value reached by any other path (a value
    // built in-process, a loaded document), so V9's rule is unchanged — only
    // which layer refuses a deep OVER-THE-WIRE send has.
    const refused = await waitFor(messages, (m) => answers(m, seq))
    assert.ok(refused, 'the server answered, and is still up')
    assert.equal(refused.type, 'error')
    assert.equal(refused.code, 'UNKNOWN_MESSAGE')
    assert.equal(refused.message, 'message nested too deeply')

    // The same value, as an object, is refused by the walk with that code.
    let deep = []
    for (let i = 0; i < depth; i++) deep = [deep]
    assert.equal(behaviorCheck({ kind: 'graph', origin: 'local', enabled: true, graph: deep, nodeMap: [id] }, { ownId: id }).problem,
      'behavior-type')

    // The connection is still open, the process still serves, and the next
    // valid send is accepted.
    assert.equal(ws.readyState, WebSocket.OPEN, 'the connection stayed open')
    assert.equal(child.exitCode, null, `the child is alive: ${out.join('')}`)
    const accepted = await send(ws, messages, 'crate-01', BEHAVIOR_LEAF, null)
    assert.equal(accepted.type, 'set', 'and a valid send on the same connection is accepted')

    // A second session in the same world is unaffected.
    const peer = new WebSocket(`ws://127.0.0.1:${socketPort}`)
    const peerMessages = collect(peer)
    await waitForOpen(peer)
    await hello(peer, peerMessages, 'owner-2')
    assert.ok(peerMessages.some((m) => m.type === 'hello'), 'the second session is serving too')
    peer.close()
  } finally {
    ws.close()
  }
})

test('V9 — the send path fails closed when a check throws', async () => {
  const { child, port, out } = startChild(['--throw-check'])
  const socketPort = await port
  const ws = new WebSocket(`ws://127.0.0.1:${socketPort}`)
  const messages = collect(ws)
  await waitForOpen(ws)
  try {
    await hello(ws, messages, 'owner-3')
    // The set-once objectId leaf's check calls `som.objectIdInUse`, which this
    // child has made throw ONCE. The exception leaves `authorizeSend`, is caught
    // by the handler's `try`, and the message is refused — the process serves on.
    const refused = await send(ws, messages, 'crate-01', 'extras.atrium.objectId', randomUUID())
    assert.ok(refused, 'the server answered instead of dying')
    assert.equal(refused.type, 'error')
    assert.equal(refused.code, 'INVALID_VALUE')
    assert.equal(refused.message, 'the value could not be checked')

    assert.equal(child.exitCode, null, `the child is alive: ${out.join('')}`)
    // The same send again: the check works now, the node takes its id, and a
    // behaviour is then accepted on it.
    const accepted = await send(ws, messages, 'crate-01', 'extras.atrium.objectId', randomUUID())
    assert.equal(accepted.type, 'set', 'the next send is checked and accepted')
    const behaviour = await send(ws, messages, 'crate-01', BEHAVIOR_LEAF, null)
    assert.equal(behaviour.type, 'set')
  } finally {
    ws.close()
  }
})

// ══════════════════════════════════════════════════════════════════════════
// The document extras, and the load path
// ══════════════════════════════════════════════════════════════════════════

test('V9 — 6,500 deep in document extras is refused with its existing message', async () => {
  const world = await createWorld(SPACE)
  // `authorizeSend` routes the SOMDocument target to `authorizeDocumentSend`,
  // whose own messages are unchanged: `JSON.stringify` is what overflows first.
  const decision = authorizeSend({
    target: world.som,
    nodeName: '',
    field: 'extras',
    value: { atrium: { name: deepArray(6500) } },
    currentExtras: world.som.extras,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.message, 'document extras are not serializable')
})

function documentWithBehaviour(behavior) {
  const document = new Document()
  const root = document.getRoot()
  const scene = document.createScene('s')
  root.setDefaultScene(scene)
  const node = document.createNode('crate')
  node.setExtras({ atrium: { objectId: OWN, behavior } })
  scene.addChild(node)
  return document
}

test('V9 — a 6,500-deep behaviour in a SAVED document loads, nulled, with the log line', () => {
  const deep = { kind: 'graph', origin: 'local', enabled: true, graph: deepArray(6500), nodeMap: [OWN] }
  const document = documentWithBehaviour(deep)
  const lines = []
  const result = healDocumentBehaviors(document, { log: { log: (l) => lines.push(l) } })
  assert.deepEqual(result, { noId: 0, malformed: 1, overLimit: 0 })
  assert.equal(document.getRoot().listNodes()[0].getExtras().atrium.behavior, null, 'the behaviour is nulled')
  assert.equal(lines.length, 1)
  assert.match(lines[0], /dropped malformed behavior on node 0: behavior-type/)
})

test('V9 — a load check that THROWS fails closed: the behaviour is nulled, with the log line', () => {
  const document = documentWithBehaviour(throwingBehaviour())
  const lines = []
  const result = healDocumentBehaviors(document, { log: { log: (l) => lines.push(l) } })
  assert.deepEqual(result, { noId: 0, malformed: 1, overLimit: 0 })
  assert.equal(document.getRoot().listNodes()[0].getExtras().atrium.behavior, null)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /dropped malformed behavior on node 0: the value blew up \(could not be checked\)/)
})
