// GR-L5 (a) / GR7: "a Delete in a tree just over a bound asks first", and
// "the checks before sending include GR4". A seed group of 257 nodes: Delete
// of one part is accepted, and its re-add (the Undo) is refused by the
// server. On the client, nothing asks first (app.js's Delete handler has no
// GR4 check) and the engine's re-add check doesn't run GR4: the Undo is
// started and the entry is lost.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
const req = createRequire('/home/claude/atrium/packages/server/package.json')
const WS = req('ws'); const WebSocket = WS; const { WebSocketServer } = WS
const R = '/home/claude/atrium/'
const { createWorld } = await import(R + 'packages/server/src/world.js')
const { attachSessionHandlers } = await import(R + 'packages/server/src/session.js')
const { createEditUndo } = await import(R + 'apps/client/src/edit-undo.js')
const { prepareRestore } = await import(R + 'apps/client/src/edit-duplicate.js')

const closers = []
after(async () => { for (const c of closers.reverse()) { try { await c() } catch {} } })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

test('server: Delete of a part of a 257-node group accepted, its re-add refused', async () => {
  const world = await createWorld(R + 'tests/fixtures/space.gltf')
  const big = world.som.ingestNode({ name: 'big', children: Array.from({ length: 256 }, (_, i) => ({ name: `big-${i}` })) })
  world.som.scene.addChild(big)
  const http = createServer(); await new Promise((r) => http.listen(0, '127.0.0.1', r))
  const wss = new WebSocketServer({ noServer: true })
  const presence = { add() {}, remove() { return null }, list() { return [] }, setPosition() {} }
  const { closeKeepalive } = attachSessionHandlers({ wss, world, sessions: new Map(), presence, worldOwnerUserId: 'u', onSaveableMutation() {} })
  http.on('upgrade', (req, s, h) => wss.handleUpgrade(req, s, h, (ws) => wss.emit('connection', ws, req, 'u')))
  closers.push(async () => { closeKeepalive(); wss.close(); http.close() })
  const ws = new WebSocket(`ws://127.0.0.1:${http.address().port}`)
  closers.push(async () => ws.terminate())
  const msgs = []; ws.on('message', (m) => msgs.push(JSON.parse(m)))
  await new Promise((r) => ws.once('open', r))
  ws.send(JSON.stringify({ type: 'hello', id: 'x1', capabilities: { tick: { interval: 5000 }, scriptRunner: 3, addFields: 4 } }))
  await delay(300)
  ws.send(JSON.stringify({ type: 'remove', seq: 1, node: 'big-0' }))
  await delay(200)
  ws.send(JSON.stringify({ type: 'add', seq: 2, parent: 'big', node: { name: 'big-0' } }))
  await delay(300)
  const err = msgs.find((m) => m.type === 'error' && m.seq === 2)
  const removed = !world.som.getNodeByName('big-0')
  console.log('after remove, big-0 gone:', removed, '; re-add answer:', err ? `${err.code}: ${err.message}` : 'accepted')
  assert.equal(removed, true)
  assert.ok(err && /too large/.test(err.message), 'the Undo (re-add) is refused by GR4')
})

test('client: the Delete entry is recorded and its Undo is started anyway (no GR4 check before sending)', async () => {
  const { NodeIO } = await import(R + 'packages/som/node_modules/@gltf-transform/core/dist/index.modern.js')
  const { SOMDocument } = await import(R + 'packages/som/src/index.js')
  const som = new SOMDocument(await new NodeIO().read(R + 'tests/fixtures/space.gltf'))
  som.scene.addChild(som.ingestNode({ name: 'big', children: Array.from({ length: 256 }, (_, i) => ({ name: `big-${i}` })) }))
  const sent = []
  const undo = createEditUndo({
    getNodeByName: (n) => som.getNodeByName(n), getObjectByName: (n) => som.getObjectByName(n),
    checkNewName: (n, x) => som.checkNewName(n, x), prepareRestore, trees: () => true,
    sendTransform: () => null, rename: () => null,
    structural: (req) => { sent.push(req); return 100 + sent.length },
  })
  const part = som.getNodeByName('big-0')
  const cap = undo.capture(part)                     // what the Delete click does (app.js)
  console.log('Delete capture ok (so the panel does not ask):', cap.ok)
  undo.registerDelete(1, { node: part, name: 'big-0', descriptor: cap.ok ? cap.descriptor : null })
  part.dispose()
  undo.onStructureAnswer({ request: { seq: 1, name: 'big-0' }, status: 'accepted', removedMessage: null })
  console.log('recorded:', undo.undoLabels)
  const started = undo.run('undo')
  console.log('Undo started (the re-add sent):', started, sent.map((r) => `${r.kind} ${r.name} under ${r.parent}`))
  assert.equal(cap.ok && started, false, 'GR-L5 (a): asked first and not recorded, or GR7: not started')
})
