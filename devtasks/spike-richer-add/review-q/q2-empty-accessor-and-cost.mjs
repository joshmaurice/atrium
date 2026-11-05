// SPDX-License-Identifier: MIT
// From the Claude outside review of Rev 0.1 (REVIEW-richer-add-copy-rev0.1-claude.md), unchanged. Run from the repo root.
// q2 — follow-ups to q1.
// (a) Which zero-length / short accessors make a document that serializes but
//     cannot be read back, and at which step (server serialize, the client's
//     WebIO.readJSON of the som-dump, createWorldFromDocument at next load).
// (b) The cost of one 1 MiB anonymous avatar `add`: ingest and serialize time,
//     som-dump size, for many tiny primitives vs A2's 64-primitive cap.
// (c) Raw-wire Infinity (`1e999`, which JSON.parse turns into Infinity) in an
//     avatar's translation and POSITION through the real session handler.
// Run from the repo root.
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
console.log = (...a) => { const s = a.map(String).join(' '); if (!/^\[(world|session)\]/.test(s)) log(...a) }
const clientIO = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]

log('== (a) short / empty accessors: serialize | client reads som-dump | createWorldFromDocument')
const a = {
  'POSITION []':                     { attributes: { POSITION: [] } },
  'POSITION [] + indices [0,1,2]':   { attributes: { POSITION: [] }, indices: [0, 1, 2] },
  'POSITION [0,0] (2 numbers)':      { attributes: { POSITION: [0, 0] } },
  'POSITION tri + NORMAL []':        { attributes: { POSITION: tri, NORMAL: [] } },
  'POSITION tri + indices []':       { attributes: { POSITION: tri }, indices: [] },
}
for (const [label, prim] of Object.entries(a)) {
  const w = await createWorld(path.resolve('tests/fixtures/space.gltf'))
  w.addNode({ name: 'q', mesh: { primitives: [prim] } }, null)
  let json, out = []
  try { json = await w.serialize(); out.push('serialize ok') } catch (e) { out.push(`serialize THROWS ${e.message.slice(0, 50)}`) }
  if (json) {
    try { await clientIO.readJSON({ json: structuredClone(json), resources: {} }); out.push('client reads') } catch (e) { out.push(`client THROWS "${e.message.slice(0, 55)}"`) }
    try { await createWorldFromDocument(JSON.stringify(json)); out.push('reload ok') } catch (e) { out.push(`reload THROWS "${e.message.slice(0, 55)}"`) }
  }
  log(`  ${label}: ${out.join(' | ')}`)
}

log('\n== (b) cost of one ~1 MiB avatar-sized add (world.addNode + serialize, no network)')
function sized(nPrims, perPrim) {
  return { name: 'q', mesh: { primitives: Array.from({ length: nPrims }, () => ({ attributes: { POSITION: perPrim } })) } }
}
const bigTri = Array.from({ length: 3 * 3 * 2900 }, (_, i) => (i % 7) / 7) // fits 64 prims in ~1 MiB
for (const [label, node] of [
  ['20,000 primitives x 1 triangle', sized(20000, tri)],
  ['40,000 primitives x 1 triangle', sized(40000, tri)],
  ['64 primitives (A2 cap), ~1 MiB of numbers', sized(64, bigTri.slice(0, 3 * 3 * 600))],
]) {
  const bytes = JSON.stringify({ type: 'add', seq: 1, id: 'x', node }).length
  const w = await createWorld(path.resolve('tests/fixtures/space.gltf'))
  const t0 = performance.now(); w.addNode(structuredClone(node), null); const t1 = performance.now()
  const json = await w.serialize(); const t2 = performance.now()
  const dump = JSON.stringify({ type: 'som-dump', gltf: json }).length
  log(`  ${label}: message ${(bytes / 1024).toFixed(0)} KiB; ingest ${Math.round(t1 - t0)} ms; serialize ${Math.round(t2 - t1)} ms; som-dump ${(dump / 1024).toFixed(0)} KiB; buffers ${json.buffers.length}`)
}

log('\n== (c) raw-wire 1e999 through the real session handler (anonymous avatar add)')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [label, raw] of [
  ['translation [1e999,0,0]', (n) => `{"name":"${n}","translation":[1e999,0,0]}`],
  ['POSITION has 1e999', (n) => `{"name":"${n}","mesh":{"primitives":[{"attributes":{"POSITION":[1e999,0,0,1,0,0,0,1,0]}}]}}`],
]) {
  const world = await createWorld(path.resolve('tests/fixtures/space.gltf'))
  const http = createServer(); await new Promise((r) => http.listen(0, '127.0.0.1', r))
  const wss = new WebSocketServer({ noServer: true })
  const { closeKeepalive } = attachSessionHandlers({ wss, world, sessions: new Map(), presence: createPresence(), worldOwnerUserId: 'owner' })
  http.on('upgrade', (rq, s, h) => wss.handleUpgrade(rq, s, h, (ws) => wss.emit('connection', ws, rq, null)))
  const join = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${http.address().port}/`); const msgs = []
    ws.on('message', (r) => msgs.push(JSON.parse(r))); await new Promise((r) => ws.once('open', r))
    const id = crypto.randomUUID(); ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
    await delay(250); return { ws, msgs, id, hello: msgs.find((m) => m.type === 'hello') }
  }
  const bad = await join(), watcher = await join()
  bad.ws.send(`{"type":"add","seq":1,"id":"${bad.id}","node":${raw(bad.hello.avatarNodeName)}}`)
  await delay(300)
  const err = bad.msgs.find((m) => m.type === 'error')
  const live = world.som.getNodeByName(bad.hello.avatarNodeName)
  const seen = watcher.msgs.find((m) => m.type === 'add')
  const later = await join(); const dump = later.msgs.find((m) => m.type === 'som-dump')
  const dn = dump?.gltf.nodes.find((n) => n.name === bad.hello.avatarNodeName)
  log(`  ${label}: ${err ? `refused ${err.code}` : 'accepted'}; live translation ${JSON.stringify(live?.translation)} (has Infinity: ${live ? live.translation.some((v) => !Number.isFinite(v)) : '-'}); present client got the broadcast: ${!!seen} (as text: ${seen ? JSON.stringify(seen.node.translation ?? seen.node.mesh.primitives[0].attributes.POSITION.slice(0, 3)) : '-'}); later join som-dump: ${!!dump}, node translation ${JSON.stringify(dn?.translation ?? null)}`)
  for (const c of [bad, watcher, later]) c.ws.close()
  closeKeepalive(); wss.close(); http.close()
}
setTimeout(() => process.exit(0), 200)
