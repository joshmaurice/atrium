// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// richer-add R6 (devtasks/PREBRIEF-richer-add.md §5; the outside review's M1) —
// the real Undo lifecycle end to end: the real AtriumClient against the real
// `attachSessionHandlers` on port 0, with the real `edit-undo.js` engine and
// `prepareRestore` wired as app.js wires them (structural requests through
// `addNode`/`removeNode`, answers from `edit:accepted`/`edit:rejected`).
//
// A stale tab is played by stripping `addFields` from the hello on the wire,
// exactly what a cdfe88a8 page sends: `{ tick, scriptRunner: 3 }`.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { AtriumClient } from '../src/AtriumClient.js'
import { createWorld } from '../../server/src/world.js'
import { attachSessionHandlers, STALE_CLIENT_MESSAGE } from '../../server/src/session.js'
import { createPresence } from '../../server/src/presence.js'
import { createEditUndo } from '../../../apps/client/src/edit-undo.js'
import { prepareRestore } from '../../../apps/client/src/edit-duplicate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const OWNER = 'user-lifecycle'

const closers = []
after(async () => { for (const c of closers.reverse()) { try { await c() } catch { /* best effort */ } } })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred, ms = 4000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (pred()) return true; await delay(10) }
  return false
}

async function startWorld() {
  const world = await createWorld(SPACE)
  const http = createServer()
  const port = await new Promise((res) => http.listen(0, '127.0.0.1', () => res(http.address().port)))
  const wss = new WebSocketServer({ noServer: true })
  const { closeKeepalive } = attachSessionHandlers({
    wss, world, sessions: new Map(), presence: createPresence(), worldOwnerUserId: OWNER, worldId: 'lifecycle',
  })
  http.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, OWNER)))
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port }
}

/** A signed-in owner tab: scriptRunner on, as app.js's same-origin connection. `stale` strips addFields. */
async function ownerTab(port, { stale }) {
  const client = new AtriumClient({ connectTimeout: 0 })
  const loaded = { v: false }
  client.on('world:loaded', () => { loaded.v = true })
  const ready = new Promise((res, rej) => { client.on('session:ready', res); client.on('disconnected', (d) => rej(new Error(d.reason))) })
  client.connect(`ws://127.0.0.1:${port}`, { scriptRunner: true })
  const ws = client._ws
  const send = ws.send.bind(ws)
  const hellos = []
  ws.send = (data) => {
    const msg = JSON.parse(data)
    if (msg.type === 'hello') {
      if (stale) delete msg.capabilities.addFields
      hellos.push(msg)
      return send(JSON.stringify(msg))
    }
    return send(data)
  }
  await ready
  assert.ok(await waitFor(() => loaded.v), 'the world loads')
  closers.push(async () => client.disconnect?.())
  return { client, hellos }
}

/** The real undo engine, wired to the client as app.js wires it. */
function wireUndo(client) {
  const structuralBySeq = new Map()
  const messages = []
  const undo = createEditUndo({
    getNodeByName: (name) => client.som.getNodeByName(name),
    checkNewName: (name, node) => client.som.checkNewName(name, node),
    prepareRestore: (gltfNode) => prepareRestore(gltfNode),
    sendTransform: () => null,
    rename: () => null,
    structural: (req, direction) => {
      const seq = req.kind === 'delete' ? client.removeNode(req.name) : client.addNode(req.descriptor)
      structuralBySeq.set(seq, { undo: direction, name: req.name })
      return seq
    },
    message: (t) => messages.push(t),
  })
  const answer = (status) => ({ seq, message }) => {
    if (status === 'accepted') undo.onAccepted(seq)
    else undo.onRejected(seq, { message })
    const info = structuralBySeq.get(seq)
    if (info) undo.onStructureAnswer({ request: { seq, undo: info.undo, name: info.name }, status, removedMessage: null }, message)
  }
  client.on('edit:accepted', answer('accepted'))
  client.on('edit:rejected', answer('rejected'))
  /** The Delete click (app.js): capture, then remove, then register. */
  function clickDelete(name) {
    const node = client.som.getNodeByName(name)
    const cap = undo.capture(node)
    const seq = client.removeNode(name)
    structuralBySeq.set(seq, { undo: undefined, name })
    undo.registerDelete(seq, { node, name, descriptor: cap.ok ? cap.descriptor : null })
    return { seq, restorable: cap.ok }
  }
  return { undo, clickDelete, messages }
}

test('R6 (review M1): a stale tab’s Delete is refused by the real server; nothing is recorded, and the object stays everywhere', async () => {
  const { world, port } = await startWorld()
  const { client, hellos } = await ownerTab(port, { stale: true })
  assert.deepEqual(Object.keys(hellos[0].capabilities).sort(), ['scriptRunner', 'tick'], 'the hello a cdfe88a8 page sends')
  const { undo, clickDelete } = wireUndo(client)
  const refused = new Promise((res) => client.on('edit:rejected', res))
  const del = clickDelete('crate-01')
  assert.equal(del.restorable, true, 'a restorable object: the click asks nothing')
  const e = await Promise.race([refused, delay(3000).then(() => null)])
  assert.ok(e, 'the delete is refused (not accepted, not silent)')
  assert.equal(e.message, STALE_CLIENT_MESSAGE, 'the server’s reload text reaches the tab')
  await delay(50)
  assert.equal(undo.undoCount, 0, 'nothing recorded')
  assert.ok(world.som.getNodeByName('crate-01'), 'still in the server’s world')
  assert.ok(client.som.getNodeByName('crate-01'), 'and in the tab’s')
})

test('R6: a current tab’s Delete and Undo work through the real server', async () => {
  const { world, port } = await startWorld()
  const { client, hellos } = await ownerTab(port, { stale: false })
  assert.equal(hellos[0].capabilities.addFields, 3)
  const { undo, clickDelete } = wireUndo(client)
  const before = prepareRestore(world.som.getNodeByName('crate-01')._node).descriptor
  clickDelete('crate-01')
  assert.ok(await waitFor(() => undo.undoCount === 1), 'the delete is recorded')
  assert.equal(world.som.getNodeByName('crate-01'), null, 'removed on the server')
  undo.run('undo')
  assert.ok(await waitFor(() => undo.redoCount === 1), 'the undo completes')
  const back = world.som.getNodeByName('crate-01')
  assert.ok(back, 'restored on the server')
  assert.deepStrictEqual(prepareRestore(back._node).descriptor, before, 'exactly as it was, its material name included')
})
