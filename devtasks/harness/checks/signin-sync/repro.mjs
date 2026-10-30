// Usage: node devtasks/harness/checks/signin-sync/repro.mjs <repo root>  (after pnpm install)
// Reproduce the sign-in mismatch at the server: one shared cookie jar (as a
// browser's tabs share one), two users, expiry and logout.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const REPO = process.argv[2]
const { default: WebSocket } = await import(join(REPO, 'packages/server/node_modules/ws/index.js'))
const { default: Database } = await import(join(REPO, 'packages/server/node_modules/better-sqlite3/lib/index.js'))
const PORT = 3999, B = `http://localhost:${PORT}`
const dir = mkdtempSync(join(tmpdir(), 'signin-'))
const dbPath = join(dir, 'a.db')
const srv = spawn('node', [join(REPO, 'packages/server/src/index.js')], { cwd: dir,
  env: { ...process.env, PORT: String(PORT), ATRIUM_DB_PATH: dbPath, WORLD_PATH: join(REPO, 'tests/fixtures/atrium.gltf') },
  stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d)
for (let i = 0; i < 50 && !log.includes('listening'); i++) await new Promise(r => setTimeout(r, 200))

if (!log.includes('listening')) { console.log('SERVER LOG:', log); process.exit(1) }
setTimeout(() => { console.log('TIMEOUT; server log tail:', log.slice(-1500)); srv.kill(); process.exit(2) }, 25000)
let jar = ''   // the browser's one cookie for this origin
const take = res => { const c = res.headers.get('set-cookie'); if (c) { const v = c.split(';')[0]; jar = v.endsWith('=') ? '' : v } }
const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie: jar }, body: JSON.stringify(body ?? {}) }); take(r); return [r.status, await r.json().catch(() => null)] }
const me = async () => { const r = await fetch(B + '/api/auth/me', { headers: { cookie: jar } }); return r.status === 200 ? (await r.json()).username : `(${r.status})` }
const hello = (path) => new Promise(res => {
  const ws = new WebSocket(`ws://localhost:${PORT}${path}`, { headers: jar ? { cookie: jar } : {} })
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', id: randomUUID() })))
  ws.on('message', m => { const x = JSON.parse(m); if (x.type === 'hello') res({ ws, name: x.displayName, canEdit: x.canEdit, keys: Object.keys(x).join(',') }) })
  ws.on('unexpected-response', (_q, r) => res({ refused: r.statusCode }))
  ws.on('error', e => res({ error: e.message }))
  ws.on('close', (code, why) => res({ refused: 'closed ' + code + ' ' + why }))
})
const pw = 'correct-horse-battery-9'
await post('/api/auth/register', { username: 'alice', password: pw }); jar = ''
await post('/api/auth/register', { username: 'bob', password: pw }); jar = ''

console.log('--- Form 2: another tab signs in as someone else')
await post('/api/auth/login', { username: 'alice', password: pw })
console.log('tab A loads: me =', await me(), '-> top bar says alice')
const a1 = await hello('/worlds/alice/home'); console.log('tab A connects to its home:', a1.name, 'canEdit', a1.canEdit)
await post('/api/auth/logout'); await post('/api/auth/login', { username: 'bob', password: pw })
console.log('tab B signs out and in: me =', await me())
console.log('tab A (top bar still alice), still-open socket:', a1.ws.readyState === 1 ? 'open, still alice on the server' : 'closed')
const a2 = await hello('/'); console.log('tab A teleports to the commons: admitted as', a2.name)
const a3 = await hello('/worlds/alice/home'); console.log('tab A Loads "its" home (private) from the world list:', a3.refused ? `refused ${a3.refused}` : a3.name)
console.log('server hello keys:', a2.keys, '-> nothing says who was admitted or whether signed in')

console.log('--- Form 1: the session expires (or another tab signs out)')
const db = new Database(dbPath); db.prepare("UPDATE auth_sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run()
const b1 = await hello('/'); console.log('connect after expiry: admitted as', b1.name)
console.log('me after expiry:', await me())
await post('/api/auth/login', { username: 'alice', password: pw }); const c1 = await hello('/'); console.log('signed in alice, socket open:', c1.name)
await post('/api/auth/logout'); console.log('logout from another tab; the open socket is', c1.ws.readyState === 1 ? 'still open as ' + c1.name : 'closed')
const c2 = await hello('/'); console.log('next connect:', c2.name)
for (const x of [a1, a2, b1, c1, c2]) x.ws?.close()
srv.kill(); process.exit(0)
