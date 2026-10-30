// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// signin-sync: the sign-in mismatch at the real server, with one shared cookie
// jar (as a browser's tabs share one), two users, expiry and logout.
//
// Usage (after `pnpm install` in <repo root>):
//   node devtasks/harness/checks/signin-sync/repro.mjs <repo root>                 # report
//   node devtasks/harness/checks/signin-sync/repro.mjs <repo root> --expect-fixed  # assert
//
// Without a flag it prints what it observes (the bug on 1837436 and earlier).
// With --expect-fixed it checks PREBRIEF-signin-sync.md's I1 and I5 on a fixed
// tree, prints PASS/FAIL per check, and exits 1 on any FAIL.
// It waits for close events rather than reading readyState right after a reply.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const REPO = resolve(process.argv[2] ?? '.')
const EXPECT_FIXED = process.argv.includes('--expect-fixed')
const { default: WebSocket } = await import(join(REPO, 'packages/server/node_modules/ws/index.js'))
const { default: Database } = await import(join(REPO, 'packages/server/node_modules/better-sqlite3/lib/index.js'))

// A free port: the server reads PORT and logs the port it was given, so ask the
// OS for one and pass it.
const PORT = await new Promise((res, rej) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  s.on('error', rej)
})
const B = `http://127.0.0.1:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'signin-'))
const dbPath = join(dir, 'a.db')
const srv = spawn(process.execPath, [join(REPO, 'packages/server/src/index.js')], {
  cwd: dir,
  env: { ...process.env, PORT: String(PORT), ATRIUM_DB_PATH: dbPath, WORLD_PATH: join(REPO, 'tests/fixtures/atrium.gltf') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
srv.stdout.on('data', d => { log += d })
srv.stderr.on('data', d => { log += d })
for (let i = 0; i < 100 && !log.includes('listening'); i++) await new Promise(r => setTimeout(r, 100))
if (!log.includes('listening')) { console.log('SERVER DID NOT START:\n' + log); srv.kill(); process.exit(2) }
const guard = setTimeout(() => { console.log('TIMEOUT; server log tail:\n' + log.slice(-2000)); srv.kill(); process.exit(2) }, 30000)

let failures = 0
const check = (label, ok, seen) => {
  if (!EXPECT_FIXED) return
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (saw: ${seen})`}`)
  if (!ok) failures++
}

let jar = ''   // the browser's one cookie for this origin
const take = res => {
  const c = res.headers.get('set-cookie')
  if (c) { const v = c.split(';')[0]; jar = v.endsWith('=') ? '' : v }
}
const post = async (p, body) => {
  const r = await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie: jar }, body: JSON.stringify(body ?? {}) })
  take(r)
  return r.status
}
const me = async () => {
  const r = await fetch(B + '/api/auth/me', { headers: { cookie: jar } })
  take(r)
  return r.status === 200 ? (await r.json()).username : `(${r.status})`
}

// Connect and say hello. Resolves with the server's hello (or the refusal), and
// keeps a promise for the socket's close so later steps can wait on it.
const hello = (path) => new Promise(res => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`, { headers: jar ? { cookie: jar } : {} })
  const errors = []
  const closed = new Promise(r => ws.on('close', (code) => r({ code, errors })))
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', id: randomUUID() })))
  ws.on('message', m => {
    const x = JSON.parse(m)
    if (x.type === 'error') errors.push(x.code)
    if (x.type === 'hello') res({ ws, closed, name: x.displayName, canEdit: x.canEdit, signedIn: x.signedIn, userId: x.userId, keys: Object.keys(x) })
  })
  ws.on('unexpected-response', (_q, r) => res({ refused: `HTTP ${r.statusCode}` }))
  ws.on('error', e => res({ refused: e.message }))
  closed.then(c => res({ refused: `closed ${c.code} ${c.errors.join(',')}`.trim() }))
})
// Wait for a socket's close, or report that it stayed open.
const closeOf = (conn, ms = 2000) => Promise.race([
  conn.closed,
  new Promise(r => setTimeout(() => r(null), ms)),
])
const ident = h => h.refused ? `refused (${h.refused})` : `${h.name}; signedIn=${h.signedIn ?? '(absent)'} userId=${h.userId ? 'present' : '(absent)'}`

const pw = 'correct-horse-battery-9'
await post('/api/auth/register', { username: 'alice', password: pw }); jar = ''
await post('/api/auth/register', { username: 'bob', password: pw }); jar = ''
const db = new Database(dbPath)
const idOf = u => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id

console.log('--- Form 2: another tab signs in as someone else')
await post('/api/auth/login', { username: 'alice', password: pw })
console.log('tab A loads: me =', await me(), '-> the top bar says alice')
const a1 = await hello('/worlds/alice/home')
console.log('tab A connects to its home:', ident(a1), 'canEdit', a1.canEdit)
check('hello says signedIn: true with alice\'s id', a1.signedIn === true && a1.userId === idOf('alice'), ident(a1))
await post('/api/auth/logout')
const a1Close = await closeOf(a1)
console.log('tab B signs out; tab A\'s open socket:', a1Close ? `closed ${a1Close.code} ${a1Close.errors.join(',')}` : 'STILL OPEN (still alice on the server)')
check('logout closes tab A\'s socket with SIGNED_OUT and 1008', !!a1Close && a1Close.code === 1008 && a1Close.errors.includes('SIGNED_OUT'), a1Close ? `${a1Close.code} ${a1Close.errors}` : 'still open')
await post('/api/auth/login', { username: 'bob', password: pw })
console.log('tab B signs in: me =', await me())
const a2 = await hello('/')
console.log('tab A (top bar still alice) teleports to the commons:', ident(a2))
console.log('  hello keys:', a2.keys?.join(','))
check('hello to the commons says bob', a2.signedIn === true && a2.userId === idOf('bob'), ident(a2))
const a3 = await hello('/worlds/alice/home')
console.log('tab A Loads "its" home (alice\'s, private) from its stale list:', ident(a3))

console.log('--- Form 1: the session expires, or another tab signs out')
db.prepare("UPDATE auth_sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run()
const b1 = await hello('/')
console.log('a connect after expiry:', ident(b1))
check('after expiry, hello says signedIn: false with no userId', b1.signedIn === false && b1.userId === undefined, ident(b1))
console.log('me after expiry:', await me())
await post('/api/auth/login', { username: 'alice', password: pw })
const c1 = await hello('/')
console.log('alice signs in; a socket opens:', ident(c1))
await post('/api/auth/logout')
const c1Close = await closeOf(c1)
console.log('logout from another tab; the open socket:', c1Close ? `closed ${c1Close.code} ${c1Close.errors.join(',')}` : 'STILL OPEN as alice')
check('logout closes that socket', !!c1Close && c1Close.errors.includes('SIGNED_OUT'), c1Close ? `${c1Close.code} ${c1Close.errors}` : 'still open')
const c2 = await hello('/')
console.log('the next connect:', ident(c2))
check('the next connect says signedIn: false', c2.signedIn === false, ident(c2))

for (const x of [a1, a2, a3, b1, c1, c2]) x.ws?.close()
clearTimeout(guard)
srv.kill()
if (EXPECT_FIXED) console.log(failures ? `${failures} FAIL` : 'all PASS')
process.exit(EXPECT_FIXED && failures ? 1 : 0)
