// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// p7 — two findings from the outside reviews of PREBRIEF-richer-add-copy Rev 0.1,
// run through the real attachSessionHandlers (anonymous avatar add) and the
// real world module (owner world add → serialize → createWorldFromDocument).
//   (1) A POSITION value that is a finite double but overflows Float32 (1e39,
//       -1e39, 3.5e38). A2 as written ("finite numbers") accepts it; ingestNode
//       stores it in a Float32Array, where it becomes ±Infinity.
//   (2) A non-empty node.extensions: accepted, dropped by ingestNode, still
//       broadcast to present clients.
// For each: server verdict, what a present client received, whether a later
// joiner's som-dump arrives AND the client's own WebIO.readJSON reads it, and
// the owner world add's save → reload → save.
// Run from the repo root: node devtasks/spike-richer-add/p7-float32-extensions.mjs
import path from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
const req = createRequire(path.resolve('packages/server/package.json'))
const wsMod = await import(req.resolve('ws'))
const WebSocket = wsMod.default
const WebSocketServer = wsMod.WebSocketServer ?? wsMod.default.Server
const creq = createRequire(path.resolve('packages/client/package.json'))
const { WebIO } = await import(creq.resolve('@gltf-transform/core'))
const { KHRONOS_EXTENSIONS } = await import(creq.resolve('@gltf-transform/extensions'))
const { createWorld, createWorldFromDocument } = await import(path.resolve('packages/server/src/world.js'))
const { attachSessionHandlers } = await import(path.resolve('packages/server/src/session.js'))
const { createPresence } = await import(path.resolve('packages/server/src/presence.js'))
const log = console.log
const serverErrors = []
console.log = (...a) => { const s = a.map(String).join(' '); if (/serialize failed/.test(s)) serverErrors.push(s); if (!/^\[(world|session)\]/.test(s)) log(...a) }
const origErr = console.error
console.error = (...a) => { serverErrors.push(a.map(String).join(' ')) }
const clientIO = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const pos = (v) => `{"attributes":{"POSITION":[0,0,0,${v},0,0,0,1,0]}}`
const cases = {
  'POSITION has 1e39':   (n) => `{"name":"${n}","mesh":{"primitives":[${pos('1e39')}]}}`,
  'POSITION has -1e39':  (n) => `{"name":"${n}","mesh":{"primitives":[${pos('-1e39')}]}}`,
  'POSITION has 3.5e38': (n) => `{"name":"${n}","mesh":{"primitives":[${pos('3.5e38')}]}}`,
  'NORMAL has 1e39':     (n) => `{"name":"${n}","mesh":{"primitives":[{"attributes":{"POSITION":[0,0,0,1,0,0,0,1,0],"NORMAL":[0,0,1,0,0,1,0,0,1e39]}}]}}`,
  'node.extensions {EXT_probe}': (n) => `{"name":"${n}","extensions":{"EXT_probe":{"pad":"${'x'.repeat(1000)}"}}}`,
}

async function clientReads(gltf) {
  try { await clientIO.readJSON({ json: structuredClone(gltf), resources: {} }); return 'client reads it' }
  catch (e) { return `client readJSON THROWS: ${e.message.slice(0, 60)}` }
}

for (const [label, raw] of Object.entries(cases)) {
  serverErrors.length = 0
  const world = await createWorld(path.resolve('tests/fixtures/space.gltf'))
  const http = createServer(); await new Promise((r) => http.listen(0, '127.0.0.1', r))
  const wss = new WebSocketServer({ noServer: true })
  const { closeKeepalive } = attachSessionHandlers({ wss, world, sessions: new Map(), presence: createPresence(), worldOwnerUserId: 'owner' })
  http.on('upgrade', (rq, s, h) => wss.handleUpgrade(rq, s, h, (ws) => wss.emit('connection', ws, rq, null)))
  const join = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${http.address().port}/`); const msgs = []
    ws.on('message', (r) => msgs.push({ len: r.length, m: JSON.parse(r) })); await new Promise((r) => ws.once('open', r))
    const id = crypto.randomUUID(); ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
    await delay(250); return { ws, msgs, id, hello: msgs.find((x) => x.m.type === 'hello')?.m }
  }
  const bad = await join(), watcher = await join()
  bad.ws.send(`{"type":"add","seq":1,"id":"${bad.id}","node":${raw(bad.hello.avatarNodeName)}}`)
  await delay(300)
  const err = bad.msgs.find((x) => x.m.type === 'error')?.m
  const live = world.som.getNodeByName(bad.hello.avatarNodeName)
  const seen = watcher.msgs.find((x) => x.m.type === 'add')
  let stored = '-'
  if (live?.mesh) {
    const arr = live.mesh.primitives[0]._primitive?.getAttribute?.('POSITION')?.getArray?.()
      ?? world.som._document.getRoot().listNodes().find((n) => n.getName() === bad.hello.avatarNodeName)?.getMesh()?.listPrimitives()[0].getAttribute('POSITION').getArray()
    stored = arr ? `[${Array.from(arr).join(',')}]` : '?'
  } else if (live) {
    const gn = world.som._document.getRoot().listNodes().find((n) => n.getName() === bad.hello.avatarNodeName)
    const p = gn?.getMesh()?.listPrimitives()[0]
    stored = p ? `[${Array.from(p.getAttribute('POSITION').getArray()).slice(0, 6).join(',')}…]` : `extensions kept: ${gn ? gn.listExtensions().length : '?'}`
  }
  const later = await join()
  const dump = later.msgs.find((x) => x.m.type === 'som-dump')
  const joinRes = dump ? `som-dump arrives, ${await clientReads(dump.m.gltf)}` : `NO som-dump (${serverErrors.find((e) => /serialize/.test(e))?.slice(0, 80) ?? 'nothing logged'})`
  for (const c of [bad, watcher, later]) c.ws.close()
  closeKeepalive(); wss.close(); http.close()

  // owner world add → save → reload → save
  const w = await createWorld(path.resolve('tests/fixtures/space.gltf'))
  let worldRes
  try {
    const node = JSON.parse(raw('q'))
    const r = w.addNode(node, null)
    if (!r.ok) worldRes = `addNode refused ${r.code}`
    else {
      const j1 = await w.serialize()
      const n1 = j1.nodes.find((n) => n.name === 'q')
      const w2 = await createWorldFromDocument(JSON.parse(JSON.stringify(j1)))
      await w2.serialize()
      worldRes = `save ok (node extensions in save: ${n1.extensions ? 'yes' : 'no'}); reload ok; re-save ok`
    }
  } catch (e) { worldRes = `THROWS: ${e.message.slice(0, 70)}` }

  log(`- ${label}`)
  log(`    avatar add: ${err ? `refused ${err.code}` : 'accepted'}; stored ${stored}`)
  log(`    present client got the broadcast: ${seen ? `yes, ${seen.len} bytes` : 'no'}`)
  log(`    later join: ${joinRes}`)
  log(`    owner world add: ${worldRes}`)
}
console.error = origErr
setTimeout(() => process.exit(0), 200)
