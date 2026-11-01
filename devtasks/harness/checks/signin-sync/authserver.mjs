// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// signin-sync's real-auth harness (PREBRIEF-signin-sync.md I8, §6.7).
//
// The browser-check harness (../../server.mjs) fakes auth. This one runs the
// REAL server (packages/server/src/index.js, with its own SQLite DB, cookies,
// world registry and logout sweep) as a child process, and puts an HTTPS front
// on two origins, https://127.0.0.1:8443 and :8444, which:
//   - serves the checkout's static files, with the import map rewritten to the
//     local /vendor copies (as ../../server.mjs does);
//   - forwards /api/* and every WebSocket upgrade to the real server, with
//     X-Forwarded-Proto: https and the browser's own Host, Origin and Cookie,
//     so the server's same-origin and cookie rules apply exactly as on DEV.
// Cookies are per host, not per port, so both origins share one sign-in, and
// a page on one origin connecting to the other is a cross-origin upgrade.
//
// Controls: GET /__log returns the real server's output (for I7's lines).
//
// Usage (after devtasks/harness/setup.sh <sha>):
//   HARNESS_ROOT=/tmp/ah node devtasks/harness/checks/signin-sync/authserver.mjs
// Env: AUTH_DB (default $HARNESS_ROOT/auth.db, deleted at start unless KEEP_DB=1), PORT_A, PORT_B.
import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, statSync, createReadStream, rmSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'

const ROOT = process.env.HARNESS_ROOT ?? '/tmp/atrium-harness'
const ROOT_ = ROOT
const WT = ROOT + '/wt'
const DB = process.env.AUTH_DB ?? ROOT + '/auth.db'
const PORT_A = Number(process.env.PORT_A ?? 8443)
const PORT_B = Number(process.env.PORT_B ?? 8444)
const tls = { key: readFileSync(ROOT + '/harness/key.pem'), cert: readFileSync(ROOT + '/harness/cert.pem') }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.css': 'text/css' }

// The real server, on a free port.
const REAL = await new Promise((res, rej) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  s.on('error', rej)
})
// scripting-4d check 8: KEEP_DB=1 keeps the database across a restart (a server restart from the saved document).
if (process.env.KEEP_DB !== '1') for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true })
let log = ''
const child = spawn(process.execPath, [join(WT, 'packages/server/src/index.js')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(REAL), ATRIUM_DB_PATH: DB, WORLD_PATH: join(WT, 'tests/fixtures/space.gltf') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (d) => { log += d; process.stdout.write('[real] ' + d) })
child.stderr.on('data', (d) => { log += d; process.stdout.write('[real!] ' + d) })
child.on('exit', (code) => { console.log('real server exited', code); process.exit(1) })
process.on('SIGTERM', () => { child.kill(); process.exit(0) })
for (let i = 0; i < 100 && !log.includes('listening'); i++) await new Promise((r) => setTimeout(r, 100))
if (!log.includes('listening')) { console.log('the real server did not start'); child.kill(); process.exit(1) }

function rewriteImportMap(html) {
  return html
    .replace('"https://esm.sh/three@0.163.0/examples/jsm/"', '"/vendor/three/examples/jsm/"')
    .replace('"https://esm.sh/three@0.163.0/addons/"', '"/vendor/three/examples/jsm/"')
    .replace('"https://esm.sh/three@0.163.0"', '"/vendor/three/build/three.module.js"')
    .replace('"https://esm.sh/@gltf-transform/core@4.3.0"', '"/vendor/gltf-core.js"')
    .replace('"https://esm.sh/@gltf-transform/extensions@4.3.0"', '"/vendor/gltf-extensions.js"')
    .replace(/"https:\/\/esm\.sh\/@gltf-transform\/view@4\.3\.0[^"]*"/, '"/vendor/gltf-view.js",\n    "three/examples/jsm/": "/vendor/three/examples/jsm/"')
}

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function serveFile(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'not found')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  createReadStream(file).pipe(res)
}

const forwardHeaders = (req) => ({ ...req.headers, 'x-forwarded-proto': 'https' })

function proxyHttp(req, res) {
  const preq = http.request({ host: '127.0.0.1', port: REAL, path: req.url, method: req.method, headers: forwardHeaders(req) }, (pres) => {
    res.writeHead(pres.statusCode, pres.headers)
    pres.pipe(res)
  })
  preq.on('error', (err) => send(res, 502, 'proxy: ' + err.message))
  req.pipe(preq)
}

function handler(req, res) {
  const u = new URL(req.url, 'https://x')
  const p = decodeURIComponent(u.pathname)
  // scripting-4c check 10: a tab that sends `x-harness-tree: stale` gets its page files from STALE_ROOT
  // (an older checkout's harness root): a tab loaded before a deploy, on the SAME origin. /api and the
  // world socket are the current server's, as on a real host. HOOKS=1 only; the stale page gets no hooks.
  const stale = process.env.HOOKS === '1' && process.env.STALE_ROOT && req.headers['x-harness-tree'] === 'stale'
  const ROOT = stale ? process.env.STALE_ROOT : ROOT_
  const WT = ROOT + '/wt'
  if (p === '/__log') return send(res, 200, log)
  if (p.startsWith('/api/')) return proxyHttp(req, res)
  if (p === '/apps/client/local.html') {
    return send(res, 200, rewriteImportMap(readFileSync(WT + '/apps/client/index.html', 'utf8')), 'text/html')
  }
  // scripting-4c: with HOOKS=1, the same page hooks as harness/server.mjs (window.__beh, __ep, ...)
  // and the Khronos sample models at /khronos/. Off by default, so signin-sync's own checks see the plain page.
  if (process.env.HOOKS === '1' && !stale) {
    if (p.startsWith('/khronos/')) return serveFile(res, join(ROOT, 'khronos', normalize(p.slice('/khronos/'.length))))
    if (p === '/apps/client/src/app.js') {
      let s = readFileSync(WT + p, 'utf8')
      const n0 = s.length
      s = s.replace('const modelBridge = createModelBridge(', 'const modelBridge = window.__mb = createModelBridge(')
      s = s.replace('const sky = createSkyLoader({ scene: threeScene, fetchImage })', 'const sky = window.__sky = createSkyLoader({ scene: threeScene, fetchImage })')
      s += '\nwindow.__lib = () => ({ libraryGrid, skyPicker, libraryCatalog, undo })\n'
      s += '\nwindow.__anim = () => ({ modelAnimations, animationControls, get selected() { return selected } })\n'
      s += '\nwindow.__beh = () => ({ get runner() { return runner }, get behaviorForm() { return typeof behaviorForm === "undefined" ? null : behaviorForm }, pick: (x, y) => { const h = pickBehaviorTarget({ clientX: x, clientY: y }); return h ? { hit: h.name, target: activateClickTarget(h)?.name ?? null } : null }, get avatarPos() { const n = avatar?.localNode; return n ? worldPosition(n) : null }, get importPanel() { return typeof importPanel === "undefined" ? null : importPanel } })\n'
      s += '\nwindow.__ep = () => ({ modelForm, teleporterForm, modelGate, get selected() { return selected }, get selectedObj() { return selectedObj }, get gizmo() { return gizmo }, selectForEdit, modes })\n'
      return send(res, 200, s, 'text/javascript')
    }
  }
  if (p.startsWith('/vendor/three/')) return serveFile(res, join(ROOT, 'vsrc/node_modules/three', normalize(p.slice('/vendor/three/'.length))))
  if (p.startsWith('/vendor/')) return serveFile(res, join(ROOT, 'vendor', normalize(p.slice('/vendor/'.length))))
  const rel = normalize(p)
  if (rel.includes('..')) return send(res, 403, 'no')
  let f = join(WT, rel)
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  return serveFile(res, f)
}

// A WebSocket upgrade: replay it to the real server and splice the sockets.
// A refusal the server answers with plain HTTP is relayed as it is.
function onUpgrade(req, socket, head) {
  const preq = http.request({ host: '127.0.0.1', port: REAL, path: req.url, method: 'GET', headers: forwardHeaders(req) })
  preq.on('upgrade', (pres, psock, phead) => {
    let out = `HTTP/1.1 ${pres.statusCode} ${pres.statusMessage}\r\n`
    for (let i = 0; i < pres.rawHeaders.length; i += 2) out += `${pres.rawHeaders[i]}: ${pres.rawHeaders[i + 1]}\r\n`
    socket.write(out + '\r\n')
    if (phead?.length) socket.write(phead)
    if (head?.length) psock.write(head)
    psock.pipe(socket); socket.pipe(psock)
    const end = () => { psock.destroy(); socket.destroy() }
    psock.on('error', end); socket.on('error', end); psock.on('close', end); socket.on('close', end)
  })
  preq.on('response', (pres) => {
    let out = `HTTP/1.1 ${pres.statusCode} ${pres.statusMessage}\r\n`
    for (let i = 0; i < pres.rawHeaders.length; i += 2) out += `${pres.rawHeaders[i]}: ${pres.rawHeaders[i + 1]}\r\n`
    socket.write(out + '\r\n'); pres.pipe(socket)
  })
  preq.on('error', () => socket.destroy())
  preq.end()
}

for (const port of [PORT_A, PORT_B]) {
  const srv = https.createServer(tls, handler)
  srv.on('upgrade', onUpgrade)
  srv.listen(port, '127.0.0.1', () => console.log('listening', port, '-> real server', REAL))
}
