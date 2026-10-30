// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// Harness-only HTTPS + WSS server for the library-sky acceptance checks.
import https from 'node:https'
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { join, normalize, extname } from 'node:path'
const ROOT = process.env.HARNESS_ROOT ?? '/tmp/atrium-harness'
const WT = ROOT + '/wt'
const { WebSocketServer } = await import(WT + '/packages/server/node_modules/ws/wrapper.mjs')
const { attachSessionHandlers } = await import(WT + '/packages/server/src/session.js')
const { createWorld, createWorldFromDocument } = await import(WT + '/packages/server/src/world.js')
const KHRONOS = process.env.KHRONOS_DIR ?? ROOT + '/khronos'
const REPO = process.env.ATRIUM_REPO ?? '/home/claude/atrium'
const sharp = (await import(REPO + '/scripts/library-build/node_modules/sharp/dist/index.cjs')).default

const PORT_A = Number(process.env.PORT_A ?? 8443)
const PORT_B = Number(process.env.PORT_B ?? 8444)
const tls = { key: readFileSync(ROOT + '/harness/key.pem'), cert: readFileSync(ROOT + '/harness/cert.pem') }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.css': 'text/css' }

const counts = new Map()
const state = { catalog: 'small', flaky: false, missing: '', worldsDelay: 0 }

const BIG_PNG = await sharp({ create: { width: 8192, height: 4096, channels: 3, background: '#ff00ff' } }).png().toBuffer()
const OK_PNG = await sharp({ create: { width: 2048, height: 1024, channels: 3, background: '#c0a020' } }).png().toBuffer()

function rewriteImportMap(html) {
  return html
    .replace('"https://esm.sh/three@0.163.0/examples/jsm/"', '"/vendor/three/examples/jsm/"')
    .replace('"https://esm.sh/three@0.163.0/addons/"', '"/vendor/three/examples/jsm/"')
    .replace('"https://esm.sh/three@0.163.0"', '"/vendor/three/build/three.module.js"')
    .replace('"https://esm.sh/@gltf-transform/core@4.3.0"', '"/vendor/gltf-core.js"')
    .replace('"https://esm.sh/@gltf-transform/extensions@4.3.0"', '"/vendor/gltf-extensions.js"')
    .replace(/"https:\/\/esm\.sh\/@gltf-transform\/view@4\.3\.0[^"]*"/, '"/vendor/gltf-view.js",\n    "three/examples/jsm/": "/vendor/three/examples/jsm/"')
}

function send(res, status, body, type = 'text/plain', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...extra })
  res.end(body)
}

function serveFile(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'not found')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' })
  createReadStream(file).pipe(res)
}

function handler(req, res) {
  const u = new URL(req.url, 'https://x')
  const p = decodeURIComponent(u.pathname)
  const key = `${req.headers.host}${p}`
  counts.set(p, (counts.get(p) ?? 0) + 1)
  if (p === '/__counts') return send(res, 200, JSON.stringify(Object.fromEntries(counts)), 'application/json')
  if (p === '/__reset') { counts.clear(); return send(res, 200, 'ok') }
  if (p === '/__ctl') {
    for (const [k, v] of u.searchParams) {
      if (k === 'catalog') state.catalog = v
      if (k === 'flaky') state.flaky = v === '1'
      if (k === 'missing') state.missing = v
      if (k === 'worldsDelay') state.worldsDelay = Number(v)
    }
    return send(res, 200, JSON.stringify(state), 'application/json')
  }
  // scripting-4a §5.1 check 6 — save a world the way autosave does (avatars
  // excluded by identity), then restart it from that document: every socket is
  // closed and the next connect gets a fresh world built from the saved file.
  // /__doc does the same serialization without keeping it (read-only view of the server's world).
  if (p === '/__save' || p === '/__restart' || p === '/__doc') {
    const key = u.searchParams.get('key') ?? 'default'
    return void (async () => {
      const entry = await worldFor(key)
      const excludeNodes = [...entry.sessions.values()].map((s) => s.avatarNode).filter(Boolean)
      const doc = JSON.stringify(await entry.world.serialize({ excludeNodes }))
      if (p === '/__doc') return send(res, 200, doc, 'application/json')
      saved.set(key, doc)
      if (p === '/__restart') {
        for (const ws of entry.wss.clients) ws.terminate()
        worlds.delete(key)
      }
      send(res, 200, doc, 'application/json')
    })().catch((err) => send(res, 500, String(err?.stack ?? err)))
  }
  // scripting-4b-1 §5.1 check 8 — load a given glTF document as world <key>
  // (POST body), as a saved document (createWorldFromDocument) or, with
  // &kind=file, as a file world (createWorld). Closes that world's sockets.
  if (p === '/__put' && req.method === 'POST') {
    const key = u.searchParams.get('key') ?? 'default'
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    return void req.on('end', async () => {
      try {
        const doc = Buffer.concat(chunks).toString('utf8')
        if (worlds.has(key)) { const e = await worlds.get(key); for (const ws of e.wss.clients) ws.terminate(); worlds.delete(key) }
        if (u.searchParams.get('kind') === 'file') {
          const f = join(ROOT, `put-${key}.gltf`); writeFileSync(f, doc); files.set(key, f); saved.delete(key)
        } else { saved.set(key, doc); files.delete(key) }
        const e = await worldFor(key)
        send(res, 200, JSON.stringify(await e.world.serialize({ excludeNodes: [] })), 'application/json')
      } catch (err) { send(res, 500, String(err?.stack ?? err)) }
    })
  }
  if (p.startsWith('/khronos/')) {
    const rel = normalize(p.slice('/khronos/'.length))
    if (rel.startsWith('..')) return send(res, 403, 'no')
    return serveFile(res, join(KHRONOS, rel))
  }
  if (state.missing && p === state.missing) return send(res, 404, 'not found (harness)')
  if (p === '/api/worlds') {
    const body = JSON.stringify([{ slug: 'one', name: 'World One', visibility: 'public' }, { slug: 'two', name: 'World Two', visibility: 'private' }])
    return void setTimeout(() => send(res, 200, body, 'application/json'), state.worldsDelay)
  }
  if (p === '/api/auth/me') return send(res, 401, '{"error":"unauthenticated"}', 'application/json')
  if (p === '/apps/client/local.html' || p === '/tools/som-inspector/local.html') {
    const src = p.replace('local.html', 'index.html')
    return send(res, 200, rewriteImportMap(readFileSync(WT + src, 'utf8')), 'text/html')
  }
  if (p === '/apps/client/src/app.js') {
    let s = readFileSync(WT + p, 'utf8')
    const n0 = s.length
    s = s.replace('const modelBridge = createModelBridge(', 'const modelBridge = window.__mb = createModelBridge(')
    s = s.replace('const sky = createSkyLoader({ scene: threeScene, fetchImage })', 'const sky = window.__sky = createSkyLoader({ scene: threeScene, fetchImage })')
    s += '\nwindow.__lib = () => ({ libraryGrid, skyPicker, libraryCatalog, undo })\n'
    s += '\nwindow.__anim = () => ({ modelAnimations, animationControls, get selected() { return selected } })\n'
    s += '\nwindow.__beh = () => ({ get runner() { return runner }, get behaviorForm() { return typeof behaviorForm === "undefined" ? null : behaviorForm }, pick: (x, y) => { const h = pickBehaviorTarget({ clientX: x, clientY: y }); return h ? { hit: h.name, target: activateClickTarget(h)?.name ?? null } : null }, get avatarPos() { const n = avatar?.localNode; return n ? worldPosition(n) : null } })\n'
    s += '\nwindow.__ep = () => ({ modelForm, teleporterForm, modelGate, get selected() { return selected }, get selectedObj() { return selectedObj }, get gizmo() { return gizmo }, selectForEdit, modes })\n'
    return send(res, 200, s, 'text/javascript')
  }
  if (p === '/apps/client/library/catalog.json' && state.catalog !== 'committed') {
    return serveFile(res, `${ROOT}/lib-${state.catalog}/catalog.json`)
  }
  if (p.startsWith('/assets/library/')) {
    const rel = normalize(p.slice('/assets/library/'.length))
    if (rel.startsWith('..')) return send(res, 403, 'no')
    for (const lib of ['lib-small', 'lib-heavy']) {
      const f = join(ROOT, lib, rel)
      if (existsSync(f)) return serveFile(res, f)
    }
    return send(res, 404, 'not found')
  }
  if (p === '/skies/big.png') return send(res, 200, BIG_PNG, 'image/png')
  if (p === '/skies/ok.png') return send(res, 200, OK_PNG, 'image/png')
  if (p === '/skies/flaky.png') return state.flaky ? send(res, 200, OK_PNG, 'image/png') : send(res, 404, 'not found')
  if (p === '/tests/fixtures/atrium-rel.gltf') {
    const j = JSON.parse(readFileSync(WT + '/tests/fixtures/atrium.gltf', 'utf8'))
    j.extras.atrium.background.texture = 'skyboxtest1.png'
    return send(res, 200, JSON.stringify(j), 'model/gltf+json')
  }
  if (p.startsWith('/vendor/three/')) return serveFile(res, join(ROOT, 'vsrc/node_modules/three', normalize(p.slice('/vendor/three/'.length))))
  if (p.startsWith('/vendor/')) return serveFile(res, join(ROOT, 'vendor', normalize(p.slice('/vendor/'.length))))
  const rel = normalize(p)
  if (rel.includes('..')) return send(res, 403, 'no')
  let f = join(WT, rel)
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  return serveFile(res, f)
}

// Worlds: wss://host/w/<key>; key prefix picks the source document.
const worlds = new Map()
const saved = new Map()   // key -> the last /__save or /__restart document
const files = new Map()   // key -> a file written by /__put?kind=file
async function worldFor(key) {
  if (worlds.has(key)) return worlds.get(key)
  const promise = (async () => {
    if (files.has(key)) {
      const world = await createWorld(files.get(key), { baseUrl: `https://127.0.0.1:${PORT_A}/` })
      const wss = new WebSocketServer({ noServer: true }); const sessions = new Map()
      attachSessionHandlers({ wss, world, sessions, worldOwnerUserId: 'owner' })
      return { wss, world, sessions }
    }
    if (saved.has(key)) {
      const world = await createWorldFromDocument(saved.get(key))
      const wss = new WebSocketServer({ noServer: true }); const sessions = new Map()
      attachSessionHandlers({ wss, world, sessions, worldOwnerUserId: 'owner' })
      return { wss, world, sessions }
    }
    let src = 'tests/fixtures/space.gltf'
    if (key.startsWith('ext')) src = 'tests/fixtures/space-ext.gltf'
    if (key.startsWith('atr')) src = 'tests/fixtures/atrium.gltf'
    if (key.startsWith('grp')) { const world = await createWorld(ROOT + '/harness/group.gltf', { baseUrl: `https://127.0.0.1:${PORT_A}/` }); const wss = new WebSocketServer({ noServer: true }); const sessions = new Map(); attachSessionHandlers({ wss, world, sessions, worldOwnerUserId: 'owner' }); return { wss, world, sessions } }
    const world = await createWorld(key.startsWith('rel') ? ROOT + '/harness/atrium-rel.gltf' : join(WT, src), { baseUrl: `https://127.0.0.1:${PORT_A}/${src.replace(/[^/]*$/, '')}` })
    const wss = new WebSocketServer({ noServer: true })
    const sessions = new Map()
    attachSessionHandlers({ wss, world, sessions, worldOwnerUserId: 'owner' })
    return { wss, world, sessions }
  })()
  worlds.set(key, promise)
  return promise
}

function onUpgrade(req, socket, head) {
  const u = new URL(req.url, 'https://x')
  const m = /^\/w\/([A-Za-z0-9_-]+)$/.exec(u.pathname)
  const key = m ? m[1] : 'default'
  worldFor(key).then(({ wss }) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, u.searchParams.has('visitor') ? 'visitor' : 'owner'))
  }, (err) => { console.error('world error', err); socket.destroy() })
}

for (const port of [PORT_A, PORT_B]) {
  const srv = https.createServer(tls, handler)
  srv.on('upgrade', onUpgrade)
  srv.listen(port, '127.0.0.1', () => console.log('listening', port))
}
