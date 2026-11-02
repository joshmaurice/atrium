// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p4 — through the REAL session handler (attachSessionHandlers): a visitor who
// is not the owner sends an avatar `add` whose POSITION has 4 numbers (not a
// multiple of 3). Does the server accept it, and can a later visitor still join
// (the join's som-dump serializes the whole world, avatars included)?
// Also: the same for an owner's world `add` and autosave's serialize.
// Run from the repo root: node devtasks/spike-richer-add/p4-avatar-dump.mjs
import path from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
const req = createRequire(path.resolve('packages/server/package.json'))
const wsMod = await import(req.resolve('ws'))
const WebSocket = wsMod.default
const WebSocketServer = wsMod.WebSocketServer ?? wsMod.default.Server
const { createWorld } = await import(path.resolve('packages/server/src/world.js'))
const { attachSessionHandlers } = await import(path.resolve('packages/server/src/session.js'))

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const world = await createWorld(path.resolve('tests/fixtures/space.gltf'))
const http = createServer()
await new Promise((r) => http.listen(0, '127.0.0.1', r))
const port = http.address().port
const wss = new WebSocketServer({ noServer: true })
const sessions = new Map()
const { createPresence } = await import(path.resolve('packages/server/src/presence.js'))
const presence = createPresence()
const { closeKeepalive } = attachSessionHandlers({ wss, world, sessions, presence, worldOwnerUserId: 'owner' })
http.on('upgrade', (rq, socket, head) => {
  const as = new URL(rq.url, 'http://x').searchParams.get('as')
  wss.handleUpgrade(rq, socket, head, (ws) => wss.emit('connection', ws, rq, as === 'anon' ? null : as))
})

async function join(as) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?as=${as}`)
  const msgs = []
  ws.on('message', (raw) => msgs.push(JSON.parse(raw)))
  await new Promise((r) => ws.once('open', r))
  const id = crypto.randomUUID()
  ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
  await delay(300)
  const hello = msgs.find((m) => m.type === 'hello')
  return { ws, msgs, id, hello, gotDump: msgs.some((m) => m.type === 'som-dump') }
}

const origError = console.error
const errors = []
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 120)) }

const before = await join('anon')
console.log(`control: anonymous visitor joins; som-dump received: ${before.gotDump}`)

const bad = await join('anon')
bad.ws.send(JSON.stringify({ type: 'add', seq: 1, id: bad.id, node: {
  name: bad.hello.avatarNodeName, mesh: { primitives: [{ attributes: { POSITION: [0, 0, 0, 1] } }] } } }))
await delay(300)
const err = bad.msgs.find((m) => m.type === 'error')
console.log(`anonymous visitor's avatar add with POSITION length 4: ${err ? `refused (${err.code})` : 'accepted'}; node in world: ${!!world.som.getNodeByName(bad.hello.avatarNodeName)}`)

const after = await join('anon')
console.log(`a later visitor joins: som-dump received: ${after.gotDump}; server errors: ${JSON.stringify(errors)}`)

bad.ws.close(); await delay(1000)
errors.length = 0
console.log(`the bad visitor left: avatar node still in world: ${!!world.som.getNodeByName(bad.hello.avatarNodeName)}; accessors in the document: ${world.som._document.getRoot().listAccessors().length}`)
const afterLeave = await join('anon')
console.log(`after the bad visitor leaves: a new visitor's som-dump received: ${afterLeave.gotDump}`)
try { await world.serialize({ excludeNodes: [] }); console.log('a save (autosave serialize) after the leave: ok') }
catch (e) { console.log(`a save (autosave serialize) after the leave: THROWS ${e.message}`) }

console.error = origError
for (const c of [before, after, afterLeave]) c.ws.close()
closeKeepalive(); wss.close(); http.close()
setTimeout(() => process.exit(0), 200)
