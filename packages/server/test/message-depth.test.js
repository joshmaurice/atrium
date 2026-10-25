// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// message-depth — G1, the depth bound on every inbound WebSocket message
// (devtasks/PREBRIEF-message-depth-guard.md §3 G1, §6.1 (a)–(f)) plus the
// walk's own tests.
//
// Every server case runs the Atrium server in a CHILD process
// (helpers/depth-server.mjs) on port 0, so a crash shows as the child's exit
// instead of killing this runner; every case then checks the child is STILL
// SERVING — a valid message answered on the same socket, and a second session.
// No mocks: the real server, the real schema validator, the real SOM.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import WebSocket from 'ws'
import { MAX_MESSAGE_DEPTH, messageDepth } from '../src/message-depth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHILD = resolve(__dirname, 'helpers/depth-server.mjs')
const CHILD_START_TIMEOUT = 20000

const delay = (ms) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Hostile payloads. Every deep value is built as a JSON STRING: JSON.stringify
// throws RangeError on the very input these tests send, so the test must never
// wish it through a stringify of its own.
// ---------------------------------------------------------------------------

/** `[[[…]]]`, `depth` levels of array. */
const nestedArrayJson = (depth) => '['.repeat(depth) + ']'.repeat(depth)

/** A real chain of `depth` nested arrays (for the walk's own tests). */
function nestedArray(depth) {
  const root = []
  let current = root
  for (let i = 1; i < depth; i++) {
    const next = []
    current.push(next)
    current = next
  }
  return root
}

/** An owner `add` whose `extras.foo` is `valueJson`. */
const ownerAddJson = (seq, name, valueJson) =>
  `{"type":"add","seq":${seq},"format":"gltf","node":{"name":${JSON.stringify(name)},"extras":{"foo":${valueJson}}}}`

/** An avatar `add` (has `id`) whose `extras.foo` is `valueJson`. */
const avatarAddJson = (seq, id, valueJson) =>
  `{"type":"add","seq":${seq},"format":"gltf","id":${JSON.stringify(id)},` +
  `"node":{"name":${JSON.stringify(`avatar-${id.slice(0, 8)}`)},"extras":{"foo":${valueJson}}}}`

/** A `send` whose value is `valueJson`. */
const sendJson = (seq, valueJson) =>
  `{"type":"send","seq":${seq},"node":"crate-01","field":"extras","value":${valueJson}}`

/**
 * A message whose overall depth is `depth`: the top-level object is 1,
 * `node` 2, `node.extras` 3, `node.extras.foo` 4, then one level per nested
 * array — so the deepest array sits at `levels + 3`.
 */
const depthAddJson = (seq, name, levels) => ownerAddJson(seq, name, nestedArrayJson(levels))

// ---------------------------------------------------------------------------
// The child server
// ---------------------------------------------------------------------------

async function startChild(env = {}) {
  const child = spawn(process.execPath, [CHILD], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const state = { child, port: null, stdout: '', stderr: '', exit: null }
  const readPort = () => {
    if (state.port !== null) return
    const m = /DEPTH_SERVER_PORT (\d+)/.exec(state.stdout)
    if (m) state.port = Number(m[1])
  }
  child.stdout.on('data', (b) => { state.stdout += b.toString(); readPort() })
  child.stderr.on('data', (b) => { state.stderr += b.toString() })
  child.on('exit', (code, signal) => { state.exit = { code, signal } })

  const deadline = Date.now() + CHILD_START_TIMEOUT
  while (state.port === null && state.exit === null && Date.now() < deadline) {
    readPort()
    if (state.port === null) await delay(20)
  }
  if (state.port === null) {
    child.kill('SIGKILL')
    throw new Error(`child server did not start (exit=${JSON.stringify(state.exit)})\n${state.stdout}\n${state.stderr}`)
  }
  return state
}

async function stopChild(state) {
  if (state.exit !== null) return
  const ended = new Promise(r => state.child.once('exit', r))
  state.child.kill('SIGKILL')
  await ended
}

/** The world's node names, read from the child's /__nodes route. */
async function childNodes(state) {
  const res = await fetch(`http://127.0.0.1:${state.port}/__nodes`)
  return res.json()
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

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = []
  ws.on('message', (raw) => {
    try { messages.push(JSON.parse(raw)) } catch { /* ignore */ }
  })
  await waitForOpen(ws)
  return { ws, messages }
}

async function waitFor(messages, pred, from = 0, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (let i = from; i < messages.length; i++) {
      if (pred(messages[i])) return messages[i]
    }
    await delay(10)
  }
  return null
}

async function hello(ws, messages, id) {
  const from = messages.length
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
  const reply = await waitFor(messages, m => m.type === 'hello', from)
  assert.ok(reply, 'the hello reply should arrive')
  return reply
}

/** Send a raw (already-serialized) message and require the G1 refusal. */
async function expectDepthRefusal(ws, messages, raw, seq) {
  const from = messages.length
  ws.send(raw)
  const err = await waitFor(messages, m => m.type === 'error' && m.seq === seq, from)
  assert.ok(err, `the depth guard should refuse the message (seq ${seq})`)
  assert.equal(err.code, 'UNKNOWN_MESSAGE')
  assert.equal(err.message, 'message nested too deeply')
  await delay(80)
  return messages.slice(from)
}

/**
 * The child survived: it is still running, the SAME socket is still answered,
 * and a SECOND session can still join.
 */
async function assertStillServing(state, ws, messages) {
  assert.equal(state.exit, null, `the server child exited: ${JSON.stringify(state.exit)}\n${state.stderr}`)

  const from = messages.length
  ws.send(JSON.stringify({ type: 'ping', clientTime: 12345 }))
  const pong = await waitFor(messages, m => m.type === 'pong' && m.clientTime === 12345, from)
  assert.ok(pong, 'the same socket is still answered')

  const second = await connect(state.port)
  try {
    const reply = await hello(second.ws, second.messages, `second-${Math.random().toString(36).slice(2, 10)}`)
    assert.ok(reply, 'a second session still joins')
  } finally {
    second.ws.close()
    await waitForClose(second.ws)
  }

  assert.equal(state.exit, null, 'the server child is still running')
}

// ===========================================================================
// The walk itself (no server)
// ===========================================================================

test('walk: depth is exact for objects, arrays and mixed nesting', () => {
  assert.equal(messageDepth({}), 1)
  assert.equal(messageDepth({ a: {} }), 2)
  assert.equal(messageDepth({ a: { b: { c: {} } } }), 4)
  assert.equal(messageDepth({ a: 1, b: 'x' }), 1, 'a flat message is depth 1')

  assert.equal(messageDepth([]), 1)
  assert.equal(messageDepth([[]]), 2)
  assert.equal(messageDepth([[[]]]), 3)

  assert.equal(messageDepth({ a: [{ b: [] }] }), 4)
  assert.equal(messageDepth({ a: [{ b: [{}] }] }), 5)
})

test('walk: the counting the guard uses, on a real message', () => {
  assert.equal(messageDepth(JSON.parse(depthAddJson(1, 'x', 61))), 64)
  assert.equal(messageDepth(JSON.parse(depthAddJson(1, 'x', 62))), 65)
  assert.equal(messageDepth(JSON.parse(depthAddJson(1, 'x', 6500))), MAX_MESSAGE_DEPTH + 1)
})

test('walk: scalars and strings are not walked', () => {
  assert.equal(messageDepth({ a: 1, b: 'x', c: true, d: null }), 1)
  assert.equal(messageDepth('abc'), 0)
  assert.equal(messageDepth(5), 0)
  assert.equal(messageDepth(true), 0)
  assert.equal(messageDepth(null), 0)
  assert.equal(messageDepth(undefined), 0)
})

test('walk: stops as soon as it passes the limit, without walking the rest', () => {
  const deep = nestedArray(1_000_000)

  // A getter 1,000 levels down: the walk must never touch it.
  let touched = false
  let node = deep
  for (let i = 1; i < 1000; i++) node = node[0]
  Object.defineProperty(node, 0, { get() { touched = true; return [] }, configurable: true })

  const started = Date.now()
  assert.equal(messageDepth(deep), MAX_MESSAGE_DEPTH + 1)
  const elapsed = Date.now() - started

  assert.equal(touched, false, 'the walk never reaches depth 1,000 of a 1,000,000-deep array')
  assert.ok(elapsed < 1000, `the walk returns at once (took ${elapsed}ms)`)
})

// ===========================================================================
// §6.1 (a)–(f) — the guard in the handler, in a child server
// ===========================================================================

test('(a) an owner add with extras.foo nested 6,500 deep is refused; no add, no node, and the next add is accepted', async () => {
  const state = await startChild({ DEPTH_SERVER_OWNER: 'user-a', DEPTH_SERVER_SOCKET_USER: 'user-a' })
  const { ws, messages } = await connect(state.port)
  try {
    await hello(ws, messages, 'aaaa1111')
    const nodesBefore = await childNodes(state)

    const after = await expectDepthRefusal(ws, messages, ownerAddJson(9001, 'box-deep-01', nestedArrayJson(6500)), 9001)

    assert.deepEqual(after.filter(m => ['add', 'set', 'remove'].includes(m.type)), [],
      'a refusal broadcasts nothing')
    const nodesAfter = await childNodes(state)
    assert.deepEqual(nodesAfter, nodesBefore, 'the world did not change')
    assert.equal(nodesAfter.includes('box-deep-01'), false, 'the world has no new node')

    const from = messages.length
    ws.send(JSON.stringify({ type: 'add', seq: 9002, node: { name: 'box-ok-01' } }))
    const add = await waitFor(messages, m => m.type === 'add' && m.node?.name === 'box-ok-01', from)
    assert.ok(add, 'the next valid add is accepted')
    assert.equal(add.requestSeq, 9002)
    assert.equal((await childNodes(state)).includes('box-ok-01'), true)

    await assertStillServing(state, ws, messages)
  } finally {
    ws.close()
    await waitForClose(ws)
    await stopChild(state)
  }
})

test('(b) a visitor avatar add carrying the same extras is refused; the visitor\'s normal avatar add is accepted', async () => {
  // An owner world, and this socket arrives anonymous: no edit rights, but an
  // avatar add skips the owner gate by design — which is exactly why the guard
  // must sit at the listener.
  const state = await startChild({ DEPTH_SERVER_OWNER: 'user-a' })
  const { ws, messages } = await connect(state.port)
  const id = 'bbbb2222'
  const avatarName = `avatar-${id.slice(0, 8)}`
  try {
    const reply = await hello(ws, messages, id)
    assert.equal(reply.canEdit, false, 'the visitor has no edit rights')

    const after = await expectDepthRefusal(ws, messages, avatarAddJson(9101, id, nestedArrayJson(6500)), 9101)

    assert.deepEqual(after.filter(m => ['add', 'set', 'remove'].includes(m.type)), [],
      'a refusal broadcasts nothing')
    assert.equal((await childNodes(state)).includes(avatarName), false, 'no avatar node was added')

    const from = messages.length
    ws.send(JSON.stringify({
      type: 'add', seq: 9102, format: 'gltf', id,
      node: { name: avatarName, translation: [0, 0, 0] },
    }))
    let joined = false
    for (let i = 0; i < 100 && !joined; i++) {
      joined = (await childNodes(state)).includes(avatarName)
      if (!joined) await delay(20)
    }
    assert.equal(joined, true, 'the visitor\'s normal avatar add is accepted')

    await assertStillServing(state, ws, messages)
  } finally {
    ws.close()
    await waitForClose(ws)
    await stopChild(state)
  }
})

test('(c) a deep message before hello is refused, and the socket can still say hello', async () => {
  const state = await startChild({ DEPTH_SERVER_OWNER: 'user-a', DEPTH_SERVER_SOCKET_USER: 'user-a' })
  const { ws, messages } = await connect(state.port)
  try {
    // No hello yet: the guard runs for this message all the same.
    const raw = `{"type":"hello","seq":9003,"id":"cccc3333","extras":{"foo":${nestedArrayJson(6500)}}}`
    const after = await expectDepthRefusal(ws, messages, raw, 9003)
    assert.deepEqual(after.filter(m => m.type === 'hello'), [], 'the deep hello was not answered')

    const reply = await hello(ws, messages, 'cccc3333')
    assert.ok(reply, 'the same socket can still say hello')

    await assertStillServing(state, ws, messages)
  } finally {
    ws.close()
    await waitForClose(ws)
    await stopChild(state)
  }
})

test('(d) a send with a deep value is refused by the guard', async () => {
  const state = await startChild({ DEPTH_SERVER_OWNER: 'user-a', DEPTH_SERVER_SOCKET_USER: 'user-a' })
  const { ws, messages } = await connect(state.port)
  try {
    await hello(ws, messages, 'dddd4444')

    const after = await expectDepthRefusal(ws, messages, sendJson(9004, nestedArrayJson(6500)), 9004)
    assert.deepEqual(after.filter(m => m.type === 'set'), [], 'a refusal broadcasts no set')

    await assertStillServing(state, ws, messages)
  } finally {
    ws.close()
    await waitForClose(ws)
    await stopChild(state)
  }
})

test('(e) depth 64 passes the guard; depth 65 is refused', async () => {
  const state = await startChild({ DEPTH_SERVER_OWNER: 'user-a', DEPTH_SERVER_SOCKET_USER: 'user-a' })
  const { ws, messages } = await connect(state.port)
  try {
    await hello(ws, messages, 'eeee5555')

    // Exactly the limit: the guard passes it and the later rules accept it.
    const from = messages.length
    ws.send(depthAddJson(9005, 'box-d64-01', 61))
    const add = await waitFor(messages, m => m.type === 'add' && m.node?.name === 'box-d64-01', from)
    assert.ok(add, 'a depth-64 message reaches the handler')
    const depthRefusals = messages.slice(from)
      .filter(m => m.type === 'error' && m.message === 'message nested too deeply')
    assert.deepEqual(depthRefusals, [], 'the guard does not refuse depth 64')

    // One level deeper: refused.
    const after = await expectDepthRefusal(ws, messages, depthAddJson(9006, 'box-d65-01', 62), 9006)
    assert.deepEqual(after.filter(m => m.type === 'add'), [], 'a refusal broadcasts no add')
    assert.equal((await childNodes(state)).includes('box-d65-01'), false)

    await assertStillServing(state, ws, messages)
  } finally {
    ws.close()
    await waitForClose(ws)
    await stopChild(state)
  }
})

test('(f) an array nested 100,000 deep is refused with no RangeError anywhere', async () => {
  const state = await startChild({ DEPTH_SERVER_OWNER: 'user-a', DEPTH_SERVER_SOCKET_USER: 'user-a' })
  const { ws, messages } = await connect(state.port)
  try {
    await hello(ws, messages, 'ffff6666')

    const after = await expectDepthRefusal(ws, messages, sendJson(9007, nestedArrayJson(100000)), 9007)
    assert.deepEqual(after.filter(m => m.type === 'set'), [], 'a refusal broadcasts no set')
    assert.equal(/RangeError/.test(state.stderr), false, 'no RangeError reached the child')

    await assertStillServing(state, ws, messages)
  } finally {
    ws.close()
    await waitForClose(ws)
    await stopChild(state)
  }
})

// ===========================================================================
// §6.1 (g) — G2, the fail-closed handler
// ===========================================================================

test('(g) a handler path that throws is answered, logged once, and the server keeps serving', async () => {
  // world.addNode throws in the child (DEPTH_SERVER_THROW): the throw is inside
  // the listener body, which is exactly the G2 boundary.
  const state = await startChild({
    DEPTH_SERVER_OWNER: 'user-a',
    DEPTH_SERVER_SOCKET_USER: 'user-a',
    DEPTH_SERVER_THROW: 'addNode',
  })
  const { ws, messages } = await connect(state.port)
  try {
    await hello(ws, messages, 'gggg7777')

    const from = messages.length
    ws.send(JSON.stringify({ type: 'add', seq: 9201, node: { name: 'box-throws-01' } }))
    const err = await waitFor(messages, m => m.type === 'error' && m.seq === 9201, from)
    assert.ok(err, 'the handler failure is answered')
    assert.equal(err.code, 'UNKNOWN_MESSAGE')
    assert.equal(err.message, 'the message could not be processed')

    await delay(80)
    assert.equal(messages.slice(from).some(m => m.type === 'add'), false, 'nothing was broadcast')
    assert.equal((await childNodes(state)).includes('box-throws-01'), false, 'the world did not change')

    const logged = state.stderr.split('\n').filter(l => l.includes('[session] message handler error:'))
    assert.equal(logged.length, 1, `exactly one log line, got ${JSON.stringify(logged)}`)
    assert.equal(logged[0], '[session] message handler error: Error stub addNode failure')

    await assertStillServing(state, ws, messages)
  } finally {
    ws.close()
    await waitForClose(ws)
    await stopChild(state)
  }
})
