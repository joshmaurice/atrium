// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-leaf.test.js — scripting-4b-2 step 2, F1 and F2.
//
// F1: the server's copy of the rule runs the SAME shared vectors the client's
// test reads (tests/fixtures/behavior-vectors.json), so no copy of the rule
// lives in a test, and every accepted vector goes through the engine's own
// validateInteractivityGraph — the validator, not the loader, is the gate.
// F2: the fourth node extras leaf — the own-id rule, the null value, the
// 64-behaviour cap (which counts OTHER nodes), the `add` checks, load healing,
// and the election rule — over real WebSocket servers on port 0.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { randomUUID } from 'crypto'
import { Document } from '@gltf-transform/core'
import WebSocket, { WebSocketServer } from 'ws'
import { createWorld, healDocumentBehaviors, healDocumentObjectIds } from '../src/world.js'
import { attachSessionHandlers } from '../src/session.js'
import {
  behaviorCheck, behaviorProblem, behaviorReasonText, behaviorCountIn,
  checkBehaviorValue, checkAtriumBehavior, authorizeSend, BEHAVIOR_LEAF,
  BEHAVIOR_NODES_PER_WORLD, SEND_INVALID, SEND_INVALID_FIELD,
} from '../src/send-policy.js'
import { templateGraph } from '../../behaviors/src/templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-vectors.json'), 'utf8'))

// ===========================================================================
// F1 — the shared vectors
// ===========================================================================

test('F1: every accepted vector passes the server rule AND the engine validator', () => {
  assert.ok(VECTORS.accepted.length >= 15, 'the vectors are the templates plus their boundaries')
  for (const vector of VECTORS.accepted) {
    const check = behaviorCheck(vector.value, { ownId: VECTORS.ownId })
    assert.equal(check.problem, null, `${vector.name}: expected accepted, got ${check.problem}`)
  }
})

test('F1: every refused vector returns exactly its named reason code', () => {
  assert.ok(VECTORS.refused.length >= 50, 'the refused set is the adversarial one')
  for (const vector of VECTORS.refused) {
    const problem = behaviorProblem(vector.value, { ownId: VECTORS.ownId })
    assert.equal(problem, vector.code, `${vector.name}: expected ${vector.code}, got ${problem}`)
  }
})

test('F1: each reason code has plain text of its own', () => {
  const codes = new Set(VECTORS.refused.map((v) => v.code))
  for (const code of codes) {
    assert.notEqual(behaviorReasonText(code), 'the behaviour value is invalid',
      `${code} must have its own text`)
  }
})

test('F1: an out-of-range declaration index is refused by the VALIDATOR, not by an F1 rule', () => {
  const vector = VECTORS.refused.find((v) => v.name.includes('declaration index is out of range'))
  assert.ok(vector, 'the vector that pins "the validator is the gate" is present')
  const check = behaviorCheck(vector.value, { ownId: VECTORS.ownId })
  assert.equal(check.problem, 'behavior-graph')
  assert.match(check.message, /graph is not a valid KHR_interactivity graph/,
    'the engine\'s own message is carried through')
})

// ===========================================================================
// F2 — the leaf, unit level
// ===========================================================================

function somaFor(world, name) {
  return world.som.getNodeByName(name)
}

test('F2: the leaf needs the node\'s own objectId', () => {
  const target = { name: 'n', extras: {} }
  const value = templateGraph('select-animation', {
    target: randomUUID(), clip: 'Idle', action: 'play', loop: true,
  }, { ownId: randomUUID() })
  const denied = checkBehaviorValue(target, value, null)
  assert.equal(denied.ok, false)
  assert.equal(denied.code, SEND_INVALID_FIELD)
  assert.equal(denied.message, 'give the object an id before a behaviour')
})

test('F2: null is accepted on a node with an id (the "no behaviour" value)', () => {
  const id = randomUUID()
  const target = { name: 'n', extras: { atrium: { objectId: id } } }
  assert.equal(checkBehaviorValue(target, null, null).ok, true)
})

test('F2: the 64-behaviour cap counts OTHER nodes, so the node being written never blocks itself', () => {
  const id = randomUUID()
  const target = { name: 'n', extras: { atrium: { objectId: id } } }
  const value = templateGraph('select-animation', {
    target: randomUUID(), clip: 'Idle', action: 'play', loop: true,
  }, { ownId: id })

  assert.equal(checkBehaviorValue(target, value, () => 63).ok, true, 'the 64th is allowed')
  const denied = checkBehaviorValue(target, value, () => 64)
  assert.equal(denied.ok, false)
  assert.equal(denied.code, SEND_INVALID)
  assert.equal(denied.message, `this world already has ${BEHAVIOR_NODES_PER_WORLD} behaviours`)
})

test('F2: behaviorCountIn excludes the node it is given and ignores null and external nodes', () => {
  const som = {
    allNodes: [
      { extras: { atrium: { behavior: { a: 1 } } } },
      { extras: { atrium: { behavior: null } } },
      { extras: { atrium: {} } },
      { extras: { atrium: { behavior: { b: 2 } } } },
      { extras: { atrium: { behavior: { c: 3 } } }, external: true },
    ],
    isExternalNode(node) { return node.external === true },
  }
  assert.equal(behaviorCountIn(som), 2)
  assert.equal(behaviorCountIn(som, som.allNodes[0]), 1)
  assert.equal(behaviorCountIn(som, som.allNodes[4]), 2)
})

test('F2/C3: an `add` carrying a valid behaviour but NO objectId is refused "a behaviour needs an object id"', () => {
  const id = randomUUID()
  const value = templateGraph('select-animation', {
    target: id, clip: 'Idle', action: 'play', loop: true,
  }, { ownId: id })
  const denied = checkAtriumBehavior({ atrium: { behavior: value } })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, SEND_INVALID)
  assert.equal(denied.message, 'a behaviour needs an object id')
})

test('F2: a `send` of the leaf on a node with no id is refused before anything is applied', () => {
  const target = { name: 'n', extras: {} }
  const decision = authorizeSend({
    target, nodeName: 'n', field: BEHAVIOR_LEAF, value: null,
    avatarNames: null, currentExtras: null, externalNames: null,
  })
  // `authorizeSend` classifies by class; a plain object is none of the SOM
  // classes, so this asserts the class gate first and the leaf via the SOM below.
  assert.equal(decision.ok, false)
})

// ===========================================================================
// A real owner world, as object-id.test.js builds one
// ===========================================================================

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

async function waitFor(messages, pred, timeoutMs = 3000) {
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
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 }, scriptRunner: 1 } }))
  const reply = await waitFor(messages, (m) => m.type === 'hello')
  assert.ok(reply, 'hello reply should arrive')
  return reply
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
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, 'user-a')
    })
  })
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port, state }
}

let seqCounter = 1000
const nextSeq = () => ++seqCounter

/** Send a `send` and return the message that ANSWERS it (echo, set or error). */
async function send(ws, messages, node, field, value) {
  const seq = nextSeq()
  ws.send(JSON.stringify({ type: 'send', seq, node, field, value }))
  return waitFor(messages, (m) => answers(m, seq))
}

/** The broadcast carries the request's seq as `requestSeq`; an error carries it as `seq`. */
function answers(m, seq) {
  if (m.type === 'error') return m.seq === seq
  if (m.type === 'set' || m.type === 'add') return m.requestSeq === seq || m.seq === seq
  return false
}

async function giveId(ws, messages, world, name) {
  const id = randomUUID()
  const answer = await send(ws, messages, name, 'extras.atrium.objectId', id)
  assert.equal(answer.type, 'set', `${name} took an object id`)
  assert.equal(somaFor(world, name).extras?.atrium?.objectId, id)
  return id
}

function behaviorFor(ownId, targetId, extra = {}) {
  return templateGraph('select-animation', {
    target: targetId, clip: 'Idle', action: 'play', loop: true, ...extra,
  }, { ownId })
}

/**
 * Rebind a vectors-file value to THIS world's node ids: the fixture is authored
 * against `VECTORS.ownId`/`VECTORS.targetId`, and over the wire the node's own id
 * is the one the server checks `nodeMap[0]` against. The remap is the one F10's
 * Duplicate does — nodeMap, targets, animations[].object and template.params.target.
 */
function rebind(value, ownId, targetId) {
  const swap = (id) => (id === VECTORS.ownId ? ownId : id === VECTORS.targetId ? targetId : id)
  const out = JSON.parse(JSON.stringify(value))
  out.nodeMap = out.nodeMap.map(swap)
  out.targets = out.targets.map(swap)
  out.animations = out.animations.map((a) => ({ ...a, object: swap(a.object) }))
  if (out.template) out.template.params = { ...out.template.params, target: swap(out.template.params.target) }
  return out
}

// ===========================================================================
// F2 — the leaf, over a real server
// ===========================================================================

test('F2: an owner send of a valid leaf on a node with an id is accepted, broadcast and saved', async () => {
  const { world, port, state } = await startOwnerWorld()
  const owner = await connect(port)
  const peer = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner')
    await hello(peer.ws, peer.messages, 'peer')

    const ownId = await giveId(owner.ws, owner.messages, world, 'crate-01')
    const targetId = await giveId(owner.ws, owner.messages, world, 'lamp-01')
    const value = behaviorFor(ownId, targetId)

    const savesBefore = state.saves
    const answer = await send(owner.ws, owner.messages, 'crate-01', BEHAVIOR_LEAF, value)
    assert.equal(answer.type, 'set', `expected the echo, saw ${JSON.stringify(answer)}`)
    assert.deepEqual(answer.value, value)
    assert.deepEqual(somaFor(world, 'crate-01').extras.atrium.behavior, value, 'stored')

    const broadcast = await waitFor(peer.messages, (m) => m.type === 'set' && m.field === BEHAVIOR_LEAF)
    assert.ok(broadcast, 'the value is broadcast to everyone')
    assert.deepEqual(broadcast.value, value)
    assert.ok(state.saves > savesBefore, 'an accepted behaviour is a saveable mutation')
  } finally {
    owner.ws.close(); await waitForClose(owner.ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

test('F2: a send of the leaf on a node with NO id is refused INVALID_FIELD and changes nothing', async () => {
  const { world, port, state } = await startOwnerWorld()
  const owner = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner')
    const savesBefore = state.saves
    const answer = await send(owner.ws, owner.messages, 'crate-01', BEHAVIOR_LEAF, null)
    assert.equal(answer.type, 'error')
    assert.equal(answer.code, SEND_INVALID_FIELD)
    assert.equal(answer.message, 'give the object an id before a behaviour')
    assert.equal(somaFor(world, 'crate-01').extras?.atrium?.behavior, undefined, 'nothing stored')
    assert.equal(state.saves, savesBefore, 'and nothing saved')
  } finally {
    owner.ws.close(); await waitForClose(owner.ws)
  }
})

test('F2: a malformed value is refused INVALID_VALUE carrying F1\'s own text (six codes)', async () => {
  const { world, port } = await startOwnerWorld()
  const owner = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner')
    const ownId = await giveId(owner.ws, owner.messages, world, 'crate-01')
    const targetId = await giveId(owner.ws, owner.messages, world, 'lamp-01')
    const good = behaviorFor(ownId, targetId)

    const byName = new Map(VECTORS.refused.map((v) => [v.name, v]))
    const sample = [
      'kind: js',
      'variables: []',
      'nodeMap[0] is not the own id',
      'a {n} pointer (a ref socket)',
      'atrium/enter declared without proximity',
      'a __proto__ key inside template.params',
    ]
    for (const name of sample) {
      const vector = byName.get(name)
      assert.ok(vector, `${name} is in the vectors file`)
      const answer = await send(owner.ws, owner.messages, 'crate-01', BEHAVIOR_LEAF,
        rebind(vector.value, ownId, targetId))
      assert.equal(answer.type, 'error', `${name}: expected a refusal`)
      assert.equal(answer.code, SEND_INVALID, `${name}: code`)
      assert.equal(answer.message, behaviorReasonText(vector.code), `${name}: text`)
    }
    // `good` (untouched) still goes through afterwards: the refusals applied nothing.
    const ok = await send(owner.ws, owner.messages, 'crate-01', BEHAVIOR_LEAF, good)
    assert.equal(ok.type, 'set')
  } finally {
    owner.ws.close(); await waitForClose(owner.ws)
  }
})

test('F2: a null send on a node that carries a behaviour removes the leaf\'s effect', async () => {
  const { world, port } = await startOwnerWorld()
  const owner = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner')
    const ownId = await giveId(owner.ws, owner.messages, world, 'crate-01')
    const targetId = await giveId(owner.ws, owner.messages, world, 'lamp-01')
    await send(owner.ws, owner.messages, 'crate-01', BEHAVIOR_LEAF, behaviorFor(ownId, targetId))

    const answer = await send(owner.ws, owner.messages, 'crate-01', BEHAVIOR_LEAF, null)
    assert.equal(answer.type, 'set')
    assert.equal(answer.value, null)
    assert.equal(somaFor(world, 'crate-01').extras.atrium.behavior, null)
  } finally {
    owner.ws.close(); await waitForClose(owner.ws)
  }
})

test('F2: the 65th behaviour is refused with nothing changed, no broadcast and no autosave', async () => {
  const { world, port, state } = await startOwnerWorld()
  const owner = await connect(port)
  const peer = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner')
    await hello(peer.ws, peer.messages, 'peer')

    // 64 nodes, each with an id and its own behaviour.
    for (let i = 0; i < BEHAVIOR_NODES_PER_WORLD; i++) {
      const id = randomUUID()
      const name = `cap-node-${i}`
      const answer = await addNode(owner.ws, owner.messages, {
        name,
        extras: { atrium: { objectId: id, behavior: behaviorFor(id, id) } },
      })
      assert.equal(answer.type, 'add', `${name} accepted`)
    }
    assert.equal(behaviorCountIn(world.som), BEHAVIOR_NODES_PER_WORLD)

    // The 64th node's behaviour can still be REWRITTEN and TOGGLED (S1).
    const lastId = somaFor(world, 'cap-node-63').extras.atrium.objectId
    const rewritten = { ...behaviorFor(lastId, lastId), enabled: false }
    const rewrite = await send(owner.ws, owner.messages, 'cap-node-63', BEHAVIOR_LEAF, rewritten)
    assert.equal(rewrite.type, 'set', 'the 64th can be rewritten')
    assert.equal(somaFor(world, 'cap-node-63').extras.atrium.behavior.enabled, false)

    // A 65th node: the add path refuses it, before any change.
    const savesBefore = state.saves
    peer.messages.length = 0
    const sixtyFifthId = randomUUID()
    const refused = await addNode(owner.ws, owner.messages, {
      name: 'cap-node-64',
      extras: { atrium: { objectId: sixtyFifthId, behavior: behaviorFor(sixtyFifthId, sixtyFifthId) } },
    })
    assert.equal(refused.type, 'error')
    assert.equal(refused.code, SEND_INVALID)
    assert.equal(refused.message, `this world already has ${BEHAVIOR_NODES_PER_WORLD} behaviours`)
    assert.equal(world.som.getNodeByName('cap-node-64'), null, 'nothing was added')
    assert.equal(state.saves, savesBefore, 'and nothing was saved')

    // A send that would make this node the 65th is refused too.
    const fresh = randomUUID()
    const freshAdd = await addNode(owner.ws, owner.messages, { name: 'cap-node-65', extras: { atrium: { objectId: fresh } } })
    assert.equal(freshAdd.type, 'add')
    const denied = await send(owner.ws, owner.messages, 'cap-node-65', BEHAVIOR_LEAF, behaviorFor(fresh, fresh))
    assert.equal(denied.type, 'error')
    assert.equal(denied.message, `this world already has ${BEHAVIOR_NODES_PER_WORLD} behaviours`)
    await delay(60)
    const noise = await waitFor(peer.messages, (m) => m.type === 'set' && m.field === BEHAVIOR_LEAF, 120)
    assert.equal(noise, null, 'a refused write broadcasts nothing')
  } finally {
    owner.ws.close(); await waitForClose(owner.ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

async function addNode(ws, messages, node) {
  const seq = nextSeq()
  ws.send(JSON.stringify({ type: 'add', seq, node }))
  return waitFor(messages, (m) => answers(m, seq))
}

test('F2: an `add` carrying a valid behaviour and an id is accepted; a malformed one is refused', async () => {
  const { world, port } = await startOwnerWorld()
  const owner = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner')

    const goodId = randomUUID()
    const good = await addNode(owner.ws, owner.messages, {
      name: 'add-good',
      extras: { atrium: { objectId: goodId, behavior: behaviorFor(goodId, goodId) } },
    })
    assert.equal(good.type, 'add')
    assert.deepEqual(somaFor(world, 'add-good').extras.atrium.behavior, behaviorFor(goodId, goodId))

    const badId = randomUUID()
    const bad = await addNode(owner.ws, owner.messages, {
      name: 'add-bad',
      extras: { atrium: { objectId: badId, behavior: { kind: 'js' } } },
    })
    assert.equal(bad.type, 'error')
    assert.equal(bad.code, SEND_INVALID)
    assert.equal(bad.message, behaviorReasonText('behavior-kind'))
    assert.equal(world.som.getNodeByName('add-bad'), null, 'nothing added')
  } finally {
    owner.ws.close(); await waitForClose(owner.ws)
  }
})

test('F2/C3: an `add` carrying a valid behaviour but NO objectId is refused INVALID_VALUE, nothing added', async () => {
  const { world, port, state } = await startOwnerWorld()
  const owner = await connect(port)
  const peer = await connect(port)
  try {
    await hello(owner.ws, owner.messages, 'owner')
    await hello(peer.ws, peer.messages, 'peer')

    const id = randomUUID()
    const paysBefore = state.saves
    peer.messages.length = 0

    const answer = await addNode(owner.ws, owner.messages, {
      name: 'add-orphan',
      extras: { atrium: { behavior: behaviorFor(id, id) } },
    })
    assert.equal(answer.type, 'error')
    assert.equal(answer.code, SEND_INVALID)
    assert.equal(answer.message, 'a behaviour needs an object id')
    assert.equal(world.som.getNodeByName('add-orphan'), null, 'nothing added')
    assert.equal(state.saves, paysBefore, 'no autosave')
    await delay(60)
    const noise = await waitFor(peer.messages, (m) => m.type === 'add', 120)
    assert.equal(noise, null, 'no broadcast')
  } finally {
    owner.ws.close(); await waitForClose(owner.ws)
    peer.ws.close(); await waitForClose(peer.ws)
  }
})

// ===========================================================================
// F2 — load healing
// ===========================================================================

function documentWithNodes(rows) {
  const document = new Document()
  const root = document.getRoot()
  const scene = document.createScene('s')
  root.setDefaultScene(scene)
  for (const row of rows) {
    const node = document.createNode(row.name ?? 'n')
    if (row.objectId !== undefined) node.setExtras({ atrium: { objectId: row.objectId } })
    if (row.behavior !== undefined) {
      const extras = node.getExtras() ?? {}
      extras.atrium = { ...(extras.atrium ?? {}), behavior: row.behavior }
      node.setExtras(extras)
    }
    scene.addChild(node)
  }
  return document
}

test('F2: healing drops a malformed behaviour to null, with one log line naming the code', () => {
  const id = randomUUID()
  const lines = []
  const document = documentWithNodes([
    { name: 'good', objectId: id, behavior: behaviorFor(id, id) },
    { name: 'bad', objectId: randomUUID(), behavior: { kind: 'js' } },
  ])
  const result = healDocumentBehaviors(document, { log: { log: (l) => lines.push(l) } })
  assert.deepEqual(result, { noId: 0, malformed: 1, overLimit: 0 })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /dropped malformed behavior on node 1: behavior-kind/)

  const saved = document.getRoot().listNodes()
  assert.equal(saved[0].getExtras().atrium.behavior.enabled, true, 'the good one is kept')
  assert.equal(saved[1].getExtras().atrium.behavior, null, 'the bad one is nulled')
})

test('F2: healing drops a behaviour on a node with no own id, including one whose id was just healed away', () => {
  const shared = randomUUID()
  const lines = []
  const document = documentWithNodes([
    { name: 'no-id', behavior: behaviorFor(randomUUID(), randomUUID()) },
    { name: 'dup-a', objectId: shared, behavior: behaviorFor(shared, shared) },
    { name: 'dup-b', objectId: shared, behavior: behaviorFor(shared, shared) },
  ])
  healDocumentObjectIds(document)
  const result = healDocumentBehaviors(document, { log: { log: (l) => lines.push(l) } })
  assert.equal(result.noId, 3, 'the orphan and BOTH duplicate-id nodes lose their behaviour')
  const nodes = document.getRoot().listNodes()
  for (const node of nodes) assert.equal(node.getExtras().atrium.behavior, null)
  assert.ok(lines.every((l) => /no object id/.test(l)), 'every line says why')
  assert.ok(lines.every((l) => !l.includes(shared)), 'and no line carries the id')
})

test('F2: healing drops the 65th behaviour in document order', () => {
  const lines = []
  const rows = []
  for (let i = 0; i < BEHAVIOR_NODES_PER_WORLD + 1; i++) {
    const id = randomUUID()
    rows.push({ name: `h-${i}`, objectId: id, behavior: behaviorFor(id, id) })
  }
  const document = documentWithNodes(rows)
  const result = healDocumentBehaviors(document, { log: { log: (l) => lines.push(l) } })
  assert.equal(result.overLimit, 1)
  const nodes = document.getRoot().listNodes()
  assert.equal(nodes[BEHAVIOR_NODES_PER_WORLD - 1].getExtras().atrium.behavior === null, false, 'the 64th stands')
  assert.equal(nodes[BEHAVIOR_NODES_PER_WORLD].getExtras().atrium.behavior, null, 'the 65th is dropped')
  assert.match(lines.at(-1), /dropped behavior on node 64: over the world limit/)
})

test('F2: a healed world saves the nulls (the document, not just the SOM)', () => {
  const id = randomUUID()
  const document = documentWithNodes([
    { name: 'bad', objectId: id, behavior: { kind: 'js' } },
  ])
  healDocumentObjectIds(document)
  healDocumentBehaviors(document, { log: { log() {} } })
  const extras = document.getRoot().listNodes()[0].getExtras()
  assert.equal(extras.atrium.behavior, null, 'the saved document carries the null')
  assert.equal(extras.atrium.objectId, id, 'and the id is untouched')
})
