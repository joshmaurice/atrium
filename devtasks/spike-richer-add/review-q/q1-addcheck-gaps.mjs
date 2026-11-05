// SPDX-License-Identifier: MIT
// From the Claude outside review of Rev 0.1 (REVIEW-richer-add-copy-rev0.1-claude.md), unchanged. Run from the repo root.
// q1 — outside review probe for PREBRIEF-richer-add-copy Rev 0.1.
// (1) A literal draft of §4 A2/A3 (`checkAddMeshDraft`), run over the REAL
//     first-party builders (avatar, every palette kind, teleporter pad) and over
//     the cases below.
// (2) Each case through the REAL attachSessionHandlers (as p4): an anonymous
//     visitor's avatar `add`, then a later visitor's join (does som-dump arrive,
//     and does the client's own reader, WebIO.readJSON, accept it?). For the
//     owner's world `add`: serialize (autosave/PUT), createWorldFromDocument
//     (next boot), serialize again.
// Run from the repo root: node /path/to/q1-addcheck-gaps.mjs
import path from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
const req = createRequire(path.resolve('packages/server/package.json'))
const wsMod = await import(req.resolve('ws'))
const WebSocket = wsMod.default
const WebSocketServer = wsMod.WebSocketServer ?? wsMod.default.Server
const { WebIO } = await import(createRequire(path.resolve('packages/client/package.json')).resolve('@gltf-transform/core'))
const { KHRONOS_EXTENSIONS } = await import(createRequire(path.resolve('packages/client/package.json')).resolve('@gltf-transform/extensions'))
const { validate } = await import(path.resolve('packages/protocol/src/index.js'))
const { createWorld, createWorldFromDocument } = await import(path.resolve('packages/server/src/world.js'))
const { attachSessionHandlers } = await import(path.resolve('packages/server/src/session.js'))
const { createPresence } = await import(path.resolve('packages/server/src/presence.js'))
const geo = await import(path.resolve('packages/renderer-three/src/geometry-utils.js'))

// ---- (1) §4 A2/A3 read literally -----------------------------------------
const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const only = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((k) => keys.includes(k))
function checkAddMeshDraft(node) {
  if (node.mesh === undefined) return null
  const m = node.mesh
  if (!only(m, ['name', 'primitives'])) return 'mesh keys'
  if (m.name !== undefined && !(typeof m.name === 'string' && m.name.length <= 256)) return 'mesh name'
  if (!Array.isArray(m.primitives) || m.primitives.length < 1 || m.primitives.length > 64) return 'primitives 1–64'
  for (const p of m.primitives) {
    if (!only(p, ['attributes', 'indices', 'material'])) return 'primitive keys'
    if (!only(p.attributes, ['POSITION', 'NORMAL'])) return 'attribute keys'
    const P = p.attributes.POSITION
    if (!Array.isArray(P) || !P.every(fin) || P.length % 3 || P.length < 9 || P.length > 3 * 65536) return 'POSITION'
    const N = p.attributes.NORMAL
    if (N !== undefined && (!Array.isArray(N) || N.length !== P.length || !N.every(fin))) return 'NORMAL'
    const vc = P.length / 3
    if (p.indices !== undefined) {
      const I = p.indices
      if (!Array.isArray(I) || I.length % 3 || !I.every((i) => Number.isInteger(i) && i >= 0 && i < vc)) return 'indices'
    } else if (vc % 3) return 'vertex count'
    if (p.material !== undefined) {
      const mt = p.material
      if (!only(mt, ['pbrMetallicRoughness'])) return 'material keys'
      const pbr = mt.pbrMetallicRoughness
      if (pbr !== undefined) {
        if (!only(pbr, ['baseColorFactor', 'metallicFactor', 'roughnessFactor'])) return 'pbr keys'
        const u = (v) => fin(v) && v >= 0 && v <= 1
        if (pbr.baseColorFactor !== undefined && !(Array.isArray(pbr.baseColorFactor) && pbr.baseColorFactor.length === 4 && pbr.baseColorFactor.every(u))) return 'baseColorFactor'
        for (const k of ['metallicFactor', 'roughnessFactor']) if (pbr[k] !== undefined && !u(pbr[k])) return k
      }
    }
  }
  return null
}

console.log('== (1) the real first-party builders against A2/A3 read literally')
const firstParty = {
  avatar: geo.buildAvatarDescriptor('x'),
  pad: geo.buildTeleporterDescriptor({ name: 'p', position: [0, 0, 0], destination: '/worlds/a/b' }),
}
for (const k of geo.PRIMITIVE_KINDS) firstParty[k] = geo.buildPrimitiveDescriptor({ kind: k, name: k, position: [0, 0, 0], rotation: [0, 0, 0, 1] })
for (const [k, d] of Object.entries(firstParty)) console.log(`  ${k}: ${checkAddMeshDraft(d) ?? 'accepted'}`)

// ---- (2) cases ------------------------------------------------------------
const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const J = (s) => JSON.parse(s) // JSON is the wire: 1e999 parses to Infinity
const cases = {
  'translation [1e999,0,0], no mesh':     { translation: J('[1e999,0,0]') },
  'mesh {} (no primitives)':              { mesh: {} },
  'primitives [{}] (no attributes)':      { mesh: { primitives: [{}] } },
  'POSITION [] ':                         { mesh: { primitives: [{ attributes: { POSITION: [] } }] } },
  'indices [] (A2: 0 is a multiple of 3)': { mesh: { primitives: [{ attributes: { POSITION: tri }, indices: [] }] } },
  'POSITION has 1e999':                   { mesh: { primitives: [{ attributes: { POSITION: J('[1e999,0,0,1,0,0,0,1,0]') } }] } },
  'NORMAL length 4':                      { mesh: { primitives: [{ attributes: { POSITION: tri, NORMAL: [0, 0, 1, 0] } }] } },
  'baseColorFactor {}':                   { mesh: { primitives: [{ attributes: { POSITION: tri }, material: { pbrMetallicRoughness: { baseColorFactor: {} } } }] } },
  'baseColorFactor "abcd"':               { mesh: { primitives: [{ attributes: { POSITION: tri }, material: { pbrMetallicRoughness: { baseColorFactor: 'abcd' } } }] } },
  'metallicFactor 1e999':                 { mesh: { primitives: [{ attributes: { POSITION: tri }, material: { pbrMetallicRoughness: { metallicFactor: J('1e999') } } }] } },
  'node.extensions 600 KB (not mesh)':    { extensions: { X: 'e'.repeat(600_000) } },
  'node.extras 900 KB (avatar)':          { extras: { pad: 'x'.repeat(900_000) } },
  '20,000 primitives [{POSITION tri}]':   { mesh: { primitives: Array.from({ length: 20000 }, () => ({ attributes: { POSITION: tri } })) } },
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const quiet = { log: console.log, error: console.error }
const errors = []
console.log = (...a) => { const s = a.map(String).join(' '); if (!/^\[(world|session)\]/.test(s)) quiet.log(...a) }
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 100)) }

async function harness() {
  const world = await createWorld(path.resolve('tests/fixtures/space.gltf'))
  const http = createServer()
  await new Promise((r) => http.listen(0, '127.0.0.1', r))
  const port = http.address().port
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  const sessions = new Map()
  const { closeKeepalive } = attachSessionHandlers({ wss, world, sessions, presence: createPresence(), worldOwnerUserId: 'owner' })
  http.on('upgrade', (rq, socket, head) => {
    const as = new URL(rq.url, 'http://x').searchParams.get('as')
    wss.handleUpgrade(rq, socket, head, (ws) => wss.emit('connection', ws, rq, as === 'anon' ? null : as))
  })
  async function join(as) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?as=${as}`)
    const msgs = []
    ws.on('message', (raw) => msgs.push({ raw: raw.length, m: JSON.parse(raw) }))
    await new Promise((r) => ws.once('open', r))
    const id = crypto.randomUUID()
    ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
    await delay(250)
    const hello = msgs.find((x) => x.m.type === 'hello')?.m
    return { ws, msgs, id, hello, dump: msgs.find((x) => x.m.type === 'som-dump') }
  }
  const stop = () => { closeKeepalive(); wss.close(); http.close() }
  return { world, join, stop }
}

const clientIO = new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
async function clientReads(dump) {
  try { await clientIO.readJSON({ json: dump.m.gltf, resources: {} }); return 'client reads it' }
  catch (e) { return `client readJSON THROWS: ${e.message.slice(0, 70)}` }
}

console.log('\n== (2) each case: A2/A3 draft verdict | schema | anonymous avatar add | later join | owner world add → save → reload')
for (const [label, extra] of Object.entries(cases)) {
  const schema = (n) => validate('client', { type: 'add', seq: 1, node: n }).valid ? 'schema pass' : 'schema FAIL'
  const draft = checkAddMeshDraft({ name: 'q', ...extra }) ?? 'accepted'
  // avatar
  errors.length = 0
  const h = await harness()
  const bad = await h.join('anon')
  const node = { name: bad.hello.avatarNodeName, ...extra }
  const t0 = performance.now()
  bad.ws.send(JSON.stringify({ type: 'add', seq: 1, id: bad.id, node }))
  await delay(label.startsWith('20,000') ? 3000 : 300)
  const refused = bad.msgs.find((x) => x.m.type === 'error')
  const accepted = !!h.world.som.getNodeByName(bad.hello.avatarNodeName)
  const ingestMs = Math.round(performance.now() - t0)
  const later = await h.join('anon')
  await delay(label.startsWith('20,000') ? 3000 : 0)
  const dump = later.msgs.find((x) => x.m.type === 'som-dump')
  const joinRes = dump ? `som-dump ${(dump.raw / 1024).toFixed(0)} KiB, ${await clientReads(dump)}` : `NO som-dump (${errors.find((e) => /serialize/.test(e)) ?? 'no error logged'})`
  for (const c of [bad, later]) c.ws.close()
  h.stop()
  // owner world add
  const w = await createWorld(path.resolve('tests/fixtures/space.gltf'))
  let worldRes
  try {
    const r = w.addNode(structuredClone({ name: 'q', ...extra }), null)
    if (!r.ok) worldRes = `addNode refused ${r.code}`
    else {
      const j1 = await w.serialize()
      const n1 = j1.nodes.find((n) => n.name === 'q')
      const w2 = await createWorldFromDocument(JSON.parse(JSON.stringify(j1)))
      const j2 = await w2.serialize()
      const n2 = j2.nodes.find((n) => n.name === 'q')
      worldRes = `saved translation ${JSON.stringify(n1.translation ?? null)}; reload ok; re-save ok, translation ${JSON.stringify(n2.translation ?? null)}`
    }
  } catch (e) { worldRes = `THROWS: ${e.message.slice(0, 80)}` }
  quiet.log(`- ${label}\n    draft: ${draft} | ${schema({ name: 'q', ...extra })} | avatar: ${refused ? `refused ${refused.m.code}` : accepted ? `accepted (${ingestMs} ms)` : 'not in world'}\n    later join: ${joinRes}\n    world add: ${worldRes}`)
}
console.log = quiet.log; console.error = quiet.error
setTimeout(() => process.exit(0), 200)
