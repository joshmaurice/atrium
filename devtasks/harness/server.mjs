// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// Harness-only HTTPS + WSS server for the library-sky acceptance checks.
import https from 'node:https'
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { join, normalize, extname } from 'node:path'
const ROOT = process.env.HARNESS_ROOT ?? '/tmp/atrium-harness'
const WT = ROOT + '/wt'
const { WebSocketServer } = await import(WT + '/packages/server/node_modules/ws/wrapper.mjs')
const { attachSessionHandlers } = await import(WT + '/packages/server/src/session.js')
const { createWorld } = await import(WT + '/packages/server/src/world.js')
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
async function worldFor(key) {
  if (worlds.has(key)) return worlds.get(key)
  const promise = (async () => {
    let src = 'tests/fixtures/space.gltf'
    if (key.startsWith('ext')) src = 'tests/fixtures/space-ext.gltf'
    if (key.startsWith('atr')) src = 'tests/fixtures/atrium.gltf'
    if (key.startsWith('grp')) { const world = await createWorld(ROOT + '/harness/group.gltf', { baseUrl: `https://127.0.0.1:${PORT_A}/` }); const wss = new WebSocketServer({ noServer: true }); attachSessionHandlers({ wss, world, worldOwnerUserId: 'owner' }); return { wss, world } }
    const world = await createWorld(key.startsWith('rel') ? ROOT + '/harness/atrium-rel.gltf' : join(WT, src), { baseUrl: `https://127.0.0.1:${PORT_A}/${src.replace(/[^/]*$/, '')}` })
    const wss = new WebSocketServer({ noServer: true })
    attachSessionHandlers({ wss, world, worldOwnerUserId: 'owner' })
    return { wss, world }
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
