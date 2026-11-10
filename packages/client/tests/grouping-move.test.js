// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// grouping GR6 (devtasks/PREBRIEF-grouping.md FINAL Rev 2, §5 "Client") — the
// real AtriumClient against the real `attachSessionHandlers` on port 0:
// `moveNode` changes nothing until the echo; the own echo and another
// session's `set` apply and emit `som:reparent`, `som:set` for `parent`, then
// the three transform `som:set`s; a missing parent or node, or a move this
// client's SOM refuses, desyncs; `edit:accepted` says whether the move applied
// and where the node landed.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { AtriumClient } from '../src/AtriumClient.js'
import { createWorld } from '../../server/src/world.js'
import { attachSessionHandlers } from '../../server/src/session.js'
import { createPresence } from '../../server/src/presence.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')
const OWNER = 'user-grouping'

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
    wss, world, sessions: new Map(), presence: createPresence(), worldOwnerUserId: OWNER, worldId: 'grouping',
  })
  http.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, OWNER)))
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  return { world, port }
}

/** An owner tab, as app.js connects it (scriptRunner on), recording what it emits. */
async function tab(port) {
  const client = new AtriumClient({ connectTimeout: 0 })
  const events = []
  for (const name of ['som:reparent', 'som:set', 'som:desync', 'edit:accepted', 'edit:rejected']) {
    client.on(name, (e) => events.push({ name, ...e }))
  }
  const loaded = { v: false }
  client.on('world:loaded', () => { loaded.v = true })
  client.connect(`ws://127.0.0.1:${port}`, { scriptRunner: true })
  assert.ok(await waitFor(() => loaded.v), 'the world loads')
  closers.push(async () => client.disconnect?.())
  return { client, events }
}

const VALUE = { parent: 'lamp-01', translation: [0.1 + 0.2, 0.25, -1e-9], rotation: [0, 0.6, 0, 0.8], scale: [-1, 0.5, 2] }
const sequence = (events) => events.filter((e) => e.name === 'som:reparent' || (e.name === 'som:set' && e.nodeName === 'crate-01'))
  .map((e) => e.name === 'som:reparent' ? `reparent ${e.from}→${e.to} ${e.origin}` : `set ${e.path} ${e.origin}${e.reparent ? ' reparent' : ''}`)

test('GR6: moveNode changes nothing until the echo; the echo applies the exact values and emits in order', async () => {
  const { world, port } = await startWorld()
  const a = await tab(port)
  const crate = a.client.som.getNodeByName('crate-01')
  const seq = a.client.moveNode('crate-01', VALUE)
  assert.equal(crate.parent, null, 'nothing changed locally at the send')
  assert.deepEqual([...crate.translation].map((v) => Math.round(v * 1e6) / 1e6), [1, 0.25, 0], 'the vectors either')
  assert.ok(await waitFor(() => a.events.some((e) => e.name === 'edit:accepted' && e.seq === seq)), 'accepted')
  assert.equal(crate.parent?.name, 'lamp-01', 'the echo applied it')
  assert.deepEqual([...crate.translation], VALUE.translation)
  assert.deepEqual([...crate.rotation], VALUE.rotation)
  assert.deepEqual([...crate.scale], VALUE.scale)
  assert.deepEqual(sequence(a.events), [
    'reparent null→lamp-01 own',
    'set parent own',
    'set translation remote reparent',
    'set rotation remote reparent',
    'set scale remote reparent',
  ])
  const reparent = a.events.find((e) => e.name === 'som:reparent')
  assert.equal(reparent.requestSeq, seq, 'the own reparent carries the seq it answers')
  const accepted = a.events.find((e) => e.name === 'edit:accepted' && e.seq === seq)
  assert.equal(accepted.applied, true)
  assert.equal(accepted.landed, 'lamp-01')
  assert.equal(world.som.getNodeByName('crate-01').parent?.name, 'lamp-01', 'and the server agrees')
})

test('GR6: another session’s move applies in this tab, with the same events (origin remote)', async () => {
  const { port } = await startWorld()
  const a = await tab(port)
  const b = await tab(port)
  const seq = a.client.moveNode('crate-01', VALUE)
  assert.ok(await waitFor(() => a.events.some((e) => e.name === 'edit:accepted' && e.seq === seq)))
  assert.ok(await waitFor(() => b.client.som.getNodeByName('crate-01').parent?.name === 'lamp-01'), 'B applied it')
  const crate = b.client.som.getNodeByName('crate-01')
  assert.deepEqual([...crate.translation], VALUE.translation)
  assert.deepEqual([...crate.scale], VALUE.scale)
  assert.deepEqual(sequence(b.events), [
    'reparent null→lamp-01 remote',
    'set parent remote',
    'set translation remote reparent',
    'set rotation remote reparent',
    'set scale remote reparent',
  ])
  // and back to the top level
  a.client.moveNode('crate-01', { ...VALUE, parent: null, scale: [1, 1, 1] })
  assert.ok(await waitFor(() => b.client.som.getNodeByName('crate-01').parent === null), 'back at the top level in B')
  assert.ok(b.client.som.scene.children.some((n) => n.name === 'crate-01'))
})

test('GR6: a refused move changes nothing locally', async () => {
  const { port } = await startWorld()
  const a = await tab(port)
  const seq = a.client.moveNode('lamp-01', { ...VALUE, parent: 'lamp-shade' })
  assert.ok(await waitFor(() => a.events.some((e) => e.name === 'edit:rejected' && e.seq === seq)), 'rejected')
  assert.equal(a.client.som.getNodeByName('lamp-01').parent, null)
  assert.equal(a.events.some((e) => e.name === 'som:reparent'), false)
})

test('GR6: a missing parent, a missing node and a move this SOM refuses each desync and change nothing', async () => {
  const { port } = await startWorld()
  const a = await tab(port)
  const record = a.client._connectionRecord
  const remote = (node, value) => a.client._onSet({ type: 'set', seq: 1, node, field: 'parent', value, serverTime: 1, session: 'someone-else' }, record)
  remote('crate-01', { ...VALUE, parent: 'no-such-group' })
  remote('no-such-node', VALUE)
  remote('lamp-shade', VALUE)                       // already under lamp-01 here
  const desyncs = a.events.filter((e) => e.name === 'som:desync').map((e) => `${e.reason} ${e.node} ${e.parent}`)
  assert.deepEqual(desyncs, [
    'parent-not-found crate-01 no-such-group',
    'node-not-found no-such-node lamp-01',
    'reparent-refused lamp-shade lamp-01',
  ])
  assert.equal(a.client.som.getNodeByName('crate-01').parent, null)
  assert.equal(a.events.some((e) => e.name === 'som:reparent'), false, 'no reparent emitted')
})

test('GR6: an own echo that cannot apply here is accepted with applied: false (Undo records nothing)', async () => {
  const { port } = await startWorld()
  const a = await tab(port)
  const record = a.client._connectionRecord
  a.client._trackEdit(9001, { type: 'send', node: 'crate-01', field: 'parent', value: { ...VALUE, parent: 'gone-group' } })
  a.client._resolveOwnSetEcho({ type: 'set', requestSeq: 9001, node: 'crate-01', field: 'parent', value: { ...VALUE, parent: 'gone-group' }, session: a.client._sessionId }, record)
  const accepted = a.events.find((e) => e.name === 'edit:accepted' && e.seq === 9001)
  assert.ok(accepted, 'still accepted (the server did it)')
  assert.equal(accepted.applied, false)
  assert.equal(accepted.landed, null)
  assert.ok(a.events.some((e) => e.name === 'som:desync' && e.reason === 'parent-not-found'), 'and the tab resyncs')
})

test('GR6 (N4): a move that lands in another node of the parent’s name reports where it landed', async () => {
  const { port } = await startWorld()
  const a = await tab(port)
  const b = await tab(port)
  const oldLamp = a.client.som.getNodeByName('lamp-01')
  // B replaces lamp-01 with a new node of the same name; A's move, sent at
  // once, reaches the server after B's add, so the crate lands in the new one.
  const r = b.client.removeNode('lamp-01')
  assert.ok(await waitFor(() => b.events.some((e) => e.name === 'edit:accepted' && e.seq === r)))
  const ad = b.client.addNode({ name: 'lamp-01', translation: [3, 0, 0] })
  assert.ok(await waitFor(() => b.events.some((e) => e.name === 'edit:accepted' && e.seq === ad)))
  const seq = a.client.moveNode('crate-01', VALUE)
  assert.ok(await waitFor(() => a.events.some((e) => e.name === 'edit:accepted' && e.seq === seq)))
  const accepted = a.events.find((e) => e.name === 'edit:accepted' && e.seq === seq)
  const crate = a.client.som.getNodeByName('crate-01')
  assert.equal(accepted.landed, 'lamp-01')
  assert.ok(crate.parent === a.client.som.getNodeByName('lamp-01'), 'under the lamp-01 this SOM holds now')
  assert.ok(crate.parent !== oldLamp, 'not the one A knew when it sent')
})
