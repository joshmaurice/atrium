// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// signin-sync.test.js — the server half of the signin-sync round (brief §6.2).
//
// (a) hello fields on every route kind
// (b) the two-user sequence of §1, one cookie jar
// (c) logout scope — only the auth session that logged out
// (d) renewal at half-life
// (e) I7's log lines, and none of them carries the cookie value
// (f) a held world load — admission re-resolves the sign-in (Rev 1, M1)
// (g) logout when the deletion fails (Rev 1, M4)
//
// The server listens on port 0 (the brief's rule for new tests).

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'

import { createWorldRegistry } from '../src/world-registry.js'
import { createRequestHandler } from '../src/http-routes.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'
import { setupCommons } from '../src/commons.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const DAY_MS = 24 * 60 * 60 * 1000

let tempDir, db, httpServer, registry, port
let opsUserId
let rootWorldId

// ---------------------------------------------------------------------------
// The new-tests rule: port 0
// ---------------------------------------------------------------------------

/** A gate the registry's `beforeWorldLoad` seam awaits, per world id. */
const loadHold = {
  ids: new Set(),
  waiters: [],
  observed: new Set(),
  gate: null,
  release() {
    this.ids.clear()
    const g = this.gate
    this.gate = null
    g?.()
  },
  reset() {
    this.ids.clear()
    this.observed.clear()
    this.waiters = []
    this.gate = null
  },
}

async function beforeWorldLoad(row) {
  if (!loadHold.ids.has(row.id)) return
  loadHold.observed.add(row.id)
  await new Promise((res) => { loadHold.gate = res })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitFor(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await sleep(10)
  }
  return false
}

function httpJson(method, path, { payload = null, cookie = null } = {}) {
  return new Promise((resolve_, reject) => {
    const data = payload === null ? null : JSON.stringify(payload)
    const headers = {}
    if (data !== null) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(data)
    }
    if (cookie) headers['Cookie'] = cookie
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        let parsed = body
        try { parsed = JSON.parse(body || '{}') } catch { /* keep raw */ }
        const setCookie = res.headers['set-cookie']
        resolve_({
          statusCode: res.statusCode,
          headers: res.headers,
          setCookie: Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? null),
          body: parsed,
        })
      })
    })
    req.on('error', reject)
    if (data !== null) req.write(data)
    req.end()
  })
}

/** Register a user over HTTP and return their cookie and auth session id. */
async function registerUser(username, password = 'correct horse battery staple') {
  const res = await httpJson('POST', '/api/auth/register', { payload: { username, password } })
  assert.equal(res.statusCode, 201, `register ${username}: ${res.statusCode} ${JSON.stringify(res.body)}`)
  const m = /atrium_auth_session=([^;]+)/.exec(res.setCookie || '')
  assert.ok(m, 'register sets the auth cookie')
  return { userId: res.body.id, cookie: `atrium_auth_session=${m[1]}`, authSessionId: m[1] }
}

async function loginUser(username, password = 'correct horse battery staple') {
  const res = await httpJson('POST', '/api/auth/login', { payload: { username, password } })
  assert.equal(res.statusCode, 200, `login ${username}: ${res.statusCode} ${JSON.stringify(res.body)}`)
  const m = /atrium_auth_session=([^;]+)/.exec(res.setCookie || '')
  assert.ok(m, 'login sets the auth cookie')
  return { userId: res.body.id, cookie: `atrium_auth_session=${m[1]}`, authSessionId: m[1] }
}

function logoutUser(cookie) {
  return httpJson('POST', '/api/auth/logout', { cookie })
}

function meUser(cookie) {
  return httpJson('GET', '/api/auth/me', { cookie })
}

function homeWorldIdOf(userId) {
  const row = db.database.prepare(
    "SELECT id FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)
  return row?.id ?? null
}

function sessionRow(authSessionId) {
  return db.database.prepare(
    'SELECT id, user_id, created_at, expires_at FROM auth_sessions WHERE id = ?'
  ).get(authSessionId)
}

function setSessionWindow(authSessionId, { createdAgoDays, expiresInDays }) {
  const now = Date.now()
  db.database.prepare(
    'UPDATE auth_sessions SET created_at = ?, expires_at = ? WHERE id = ?'
  ).run(
    new Date(now - createdAgoDays * DAY_MS).toISOString(),
    new Date(now + expiresInDays * DAY_MS).toISOString(),
    authSessionId,
  )
}

function makeMessageQueue(ws) {
  const queue = []
  ws.on('message', (raw) => {
    try { queue.push(JSON.parse(raw)) } catch { /* ignore */ }
  })
  async function waitForType(type, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const idx = queue.findIndex(m => m.type === type)
      if (idx >= 0) return queue.splice(idx, 1)[0]
      if (Date.now() >= deadline) return null
      await sleep(10)
    }
  }
  return { queue, waitForType }
}

let sessionCounter = 0

function rawWs(path, { cookie = null, origin = null } = {}) {
  const headers = {}
  if (cookie) headers['Cookie'] = cookie
  if (origin) headers['Origin'] = origin
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers })
  const q = makeMessageQueue(ws)
  const opened = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
  const closed = new Promise((res) => { ws.once('close', (code, reason) => res({ code, reason: reason.toString() })) })
  return { ws, q, opened, closed }
}

/** Connect, send hello, and wait for the server's hello. */
async function connectHello(path, opts = {}) {
  const conn = rawWs(path, opts)
  await conn.opened
  const id = `ss-${++sessionCounter}`
  conn.ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
  const hello = await conn.q.waitForType('hello', 4000)
  assert.ok(hello, `hello arrived on ${path}`)
  return { ...conn, hello }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'atrium-signin-sync-'))
  db = createDb(join(tempDir, 'test.db'))

  const now = new Date().toISOString()
  opsUserId = 'signin-ops-uuid'
  db.database.prepare(
    'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).run(opsUserId, 'OpS', 'Op S', now)

  process.env.ATRIUM_COMMONS_OWNER = 'OpS'
  process.env.ATRIUM_COMMONS_SLUG = 'commons'

  httpServer = createServer()
  registry = createWorldRegistry({ httpServer, db, beforeWorldLoad })

  const commons = await setupCommons({ registry, db, worldPath: FIXTURE_PATH })
  rootWorldId = registry.getRootWorldId()
  assert.ok(commons?.host, 'commons host registered')

  const handler = createRequestHandler({
    db,
    auth,
    defaultHostRef: { current: commons.host },
    getWorldHost: (id) => registry.getWorldHost(id),
    getRootWorldId: () => registry.getRootWorldId(),
    closeAuthSessions: (authSessionId) => registry.closeAuthSessions(authSessionId),
  })
  httpServer.on('request', handler)
  await new Promise((res) => httpServer.listen(0, '127.0.0.1', res))
  port = httpServer.address().port
})

after(async () => {
  loadHold.reset()
  for (const [, host] of registry.hosts) host.close()
  registry?.close()
  if (httpServer) await new Promise((res) => httpServer.close(res))
  db?.close()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// (a) hello fields, every route kind
// ---------------------------------------------------------------------------

describe('6.2(a) hello fields on every route kind', () => {
  let alice, aliceHomeId, alicePublicSlug

  before(async () => {
    alice = await registerUser('Alice')
    aliceHomeId = homeWorldIdOf(alice.userId)
    assert.ok(aliceHomeId, 'alice has a home world')

    const created = await httpJson('POST', '/api/worlds', {
      payload: { slug: 'garden', name: 'Garden' }, cookie: alice.cookie,
    })
    assert.equal(created.statusCode, 201, JSON.stringify(created.body))
    alicePublicSlug = 'garden'
    const put = await httpJson('PUT', `/api/worlds/${created.body.id}`, {
      payload: { visibility: 'public' }, cookie: alice.cookie,
    })
    assert.equal(put.statusCode, 200, JSON.stringify(put.body))
  })

  test('a same-origin upgrade with a valid cookie gets signedIn true and the user id', async () => {
    const c = await connectHello('/', { cookie: alice.cookie })
    assert.equal(c.hello.signedIn, true)
    assert.equal(c.hello.userId, alice.userId)
    c.ws.close()
  })

  test('no cookie gets signedIn false and no userId', async () => {
    const c = await connectHello('/')
    assert.equal(c.hello.signedIn, false)
    assert.equal('userId' in c.hello, false, 'userId must be absent, not null')
    c.ws.close()
  })

  test('an expired session gets signedIn false and no userId', async () => {
    const u = await registerUser('ExpiredEve')
    setSessionWindow(u.authSessionId, { createdAgoDays: 8, expiresInDays: -1 })
    const c = await connectHello('/', { cookie: u.cookie })
    assert.equal(c.hello.signedIn, false)
    assert.equal('userId' in c.hello, false)
    c.ws.close()
  })

  test('a deleted session gets signedIn false and no userId', async () => {
    const u = await registerUser('DeletedDan')
    await logoutUser(u.cookie)
    const c = await connectHello('/', { cookie: u.cookie })
    assert.equal(c.hello.signedIn, false)
    assert.equal('userId' in c.hello, false)
    c.ws.close()
  })

  test('a cross-origin upgrade with a valid cookie gets signedIn false', async () => {
    const c = await connectHello('/', { cookie: alice.cookie, origin: 'http://elsewhere.test' })
    assert.equal(c.hello.signedIn, false)
    assert.equal('userId' in c.hello, false)
    c.ws.close()
  })

  test('every route kind carries the pair', async () => {
    const routes = [
      ['/', alice.userId],
      [`/ws/${rootWorldId}`, alice.userId],
      [`/home/${alice.userId}/home`, alice.userId],
      [`/worlds/Alice/${alicePublicSlug}`, alice.userId],
    ]
    for (const [path, expectedUserId] of routes) {
      const c = await connectHello(path, { cookie: alice.cookie })
      assert.equal(c.hello.signedIn, true, `${path}: signedIn`)
      assert.equal(c.hello.userId, expectedUserId, `${path}: userId`)
      c.ws.close()
    }
  })
})

// ---------------------------------------------------------------------------
// (b) the two-user sequence, one cookie jar
// ---------------------------------------------------------------------------

describe('6.2(b) the two-user sequence with one cookie jar', () => {
  test('the old socket is closed with SIGNED_OUT/1008 and the new hello says bob', async () => {
    const alice = await registerUser('SeqAlice')
    const a = await connectHello('/', { cookie: alice.cookie })
    assert.equal(a.hello.signedIn, true)
    assert.equal(a.hello.userId, alice.userId)

    const out = await logoutUser(alice.cookie)
    assert.equal(out.statusCode, 200)

    const signedOut = await a.q.waitForType('error', 4000)
    const closeInfo = await a.closed
    assert.ok(signedOut, 'the old socket received an error')
    assert.equal(signedOut.code, 'SIGNED_OUT')
    assert.equal(signedOut.message, 'You signed out')
    assert.equal(closeInfo.code, 1008)

    const bob = await registerUser('SeqBob')
    const b = await connectHello('/', { cookie: bob.cookie })
    assert.equal(b.hello.signedIn, true)
    assert.equal(b.hello.userId, bob.userId)
    b.ws.close()
  })
})

// ---------------------------------------------------------------------------
// (c) logout scope
// ---------------------------------------------------------------------------

describe('6.2(c) logout closes only that auth session’s sockets', () => {
  test('two auth sessions; the logout closes one session’s sockets on every host, pre-hello included', async () => {
    const alice = await registerUser('ScopeAlice')
    const second = await loginUser('ScopeAlice')
    assert.notEqual(second.authSessionId, alice.authSessionId, 'two auth sessions')

    const homeId = homeWorldIdOf(alice.userId)

    // Session 1: a full session on the commons, a full session on alice's home
    // world, and a pre-hello socket on the commons.
    const s1Commons = await connectHello('/', { cookie: alice.cookie })
    const s1Home = await connectHello(`/home/${alice.userId}/home`, { cookie: alice.cookie })

    const preHello = rawWs('/', { cookie: alice.cookie })
    await preHello.opened

    // Session 2: a full session on alice's home world — must be untouched.
    const s2Home = await connectHello(`/home/${alice.userId}/home`, { cookie: second.cookie })

    // Make sure all three session-1 sockets are registered on the host before
    // the logout: the pre-hello socket is already counted by the host.
    assert.ok(await waitFor(() => registry.getWorldHost(homeId)?.sessions?.size >= 2))

    const out = await logoutUser(alice.cookie)
    assert.equal(out.statusCode, 200)

    const e1 = await s1Commons.q.waitForType('error', 4000)
    const e1h = await s1Home.q.waitForType('error', 4000)
    const c1 = await s1Commons.closed
    const c1h = await s1Home.closed
    const cPh = await preHello.closed

    assert.equal(e1?.code, 'SIGNED_OUT')
    assert.equal(e1h?.code, 'SIGNED_OUT')
    assert.equal(c1.code, 1008)
    assert.equal(c1h.code, 1008)
    assert.equal(cPh.code, 1008, 'the pre-hello socket was closed too')

    // Session 2's socket is untouched, still open, still able to edit.
    await sleep(80)
    assert.equal(s2Home.ws.readyState, WebSocket.OPEN, 'the other auth session’s socket stays open')

    const homeHost = registry.getWorldHost(homeId)
    const live = [...homeHost.sessions.values()].find(s => s.userId === alice.userId)
    assert.ok(live, 'the surviving session is still registered')
    assert.equal(live.canEdit, true, 'and it still holds canEdit')

    // Liveness round trip on the surviving socket.
    s2Home.ws.send(JSON.stringify({ type: 'ping', clientTime: 1 }))
    const pong = await s2Home.q.waitForType('pong', 3000)
    assert.ok(pong, 'the surviving socket still answers')
    s2Home.ws.close()
  })
})

// ---------------------------------------------------------------------------
// (d) renewal at half-life
// ---------------------------------------------------------------------------

describe('6.2(d) renewal at half-life', () => {
  test('two days left renews and sets the cookie', async () => {
    const u = await registerUser('RenewRita')
    setSessionWindow(u.authSessionId, { createdAgoDays: 5, expiresInDays: 2 })

    const res = await meUser(u.cookie)
    assert.equal(res.statusCode, 200)
    assert.ok(res.setCookie, 'the response sets the cookie')
    assert.match(res.setCookie, /atrium_auth_session=/)
    assert.match(res.setCookie, /Max-Age=604800/)

    const row = sessionRow(u.authSessionId)
    const remainingDays = (new Date(row.expires_at).getTime() - Date.now()) / DAY_MS
    assert.ok(remainingDays > 6.9 && remainingDays < 7.1, `expires_at ≈ 7 days ahead (got ${remainingDays})`)
  })

  test('five days left is untouched and gets no Set-Cookie', async () => {
    const u = await registerUser('SteadySam')
    setSessionWindow(u.authSessionId, { createdAgoDays: 2, expiresInDays: 5 })
    const before = sessionRow(u.authSessionId).expires_at

    const res = await meUser(u.cookie)
    assert.equal(res.statusCode, 200)
    assert.equal(res.setCookie, null, 'no Set-Cookie')
    assert.equal(sessionRow(u.authSessionId).expires_at, before, 'expires_at unchanged')
  })

  test('an expired session gets 401 and is not renewed', async () => {
    const u = await registerUser('GoneGreta')
    setSessionWindow(u.authSessionId, { createdAgoDays: 9, expiresInDays: -1 })

    const res = await meUser(u.cookie)
    assert.equal(res.statusCode, 401)
    assert.equal(res.setCookie, null, 'no renewal cookie')
    assert.equal(sessionRow(u.authSessionId), undefined, 'the expired row is gone')
  })
})

// ---------------------------------------------------------------------------
// (e) I7's log lines
// ---------------------------------------------------------------------------

describe('6.2(e) I7 log lines', () => {
  test('the lines appear and none of them carries the cookie value', async () => {
    const lines = []
    const realLog = console.log
    const realError = console.error
    console.log = (...args) => { lines.push(args.join(' ')); realLog(...args) }
    console.error = (...args) => { lines.push(args.join(' ')); realError(...args) }

    let u
    try {
      u = await registerUser('LogLena')
      const c = await connectHello('/', { cookie: u.cookie })
      assert.equal(c.hello.signedIn, true)
      c.ws.close()

      // An anonymous admission, so the `<username|anonymous>` half of the hello
      // line is exercised too.
      const anon = await connectHello('/')
      assert.equal(anon.hello.signedIn, false)
      anon.ws.close()

      await loginUser('LogLena')
      setSessionWindow(u.authSessionId, { createdAgoDays: 5.0, expiresInDays: 2 })
      await meUser(u.cookie)
      await logoutUser(u.cookie)
    } finally {
      console.log = realLog
      console.error = realError
    }

    const joined = lines.join('\n')
    assert.ok(lines.some(l => l === '[auth] register LogLena'), 'register line')
    assert.ok(lines.some(l => l === '[auth] login LogLena'), 'login line')
    assert.ok(lines.some(l => /^\[auth\] renewed LogLena$/.test(l)), 'renewed line')
    assert.ok(lines.some(l => /^\[auth\] logout LogLena closed \d+ sockets$/.test(l)), 'logout line')
    assert.ok(lines.some(l => /^\[session\] hello \S+ as LogLena world \S+$/.test(l)),
      'hello line names the user and the world')
    assert.ok(lines.some(l => /^\[session\] hello \S+ as anonymous world \S+$/.test(l)),
      'an anonymous admission is logged as anonymous')

    assert.equal(joined.includes(u.cookie), false, 'no line carries the cookie value')
    assert.equal(joined.includes(u.authSessionId), false, 'no line carries the auth session id')
  })
})

// ---------------------------------------------------------------------------
// (f) a held world load — admission re-resolves the sign-in
// ---------------------------------------------------------------------------

describe('6.2(f) a held world load', () => {
  test('a home world whose load is held admits nobody after the logout', async () => {
    loadHold.reset()
    const frank = await registerUser('HeldFrank')
    const homeId = homeWorldIdOf(frank.userId)
    assert.equal(registry.getWorldHost(homeId), null, 'the home world is not loaded yet')

    loadHold.ids.add(homeId)
    const conn = rawWs(`/home/${frank.userId}/home`, { cookie: frank.cookie })

    assert.ok(await waitFor(() => loadHold.observed.has(homeId)), 'the load was held')
    assert.equal(registry.getWorldHost(homeId)?.sessions?.size ?? 0, 0, 'no socket yet')

    const out = await logoutUser(frank.cookie)
    assert.equal(out.statusCode, 200)

    loadHold.release()

    await conn.opened
    const err = await conn.q.waitForType('error', 4000)
    const closed = await conn.closed
    assert.ok(err, 'the upgrade was refused')
    assert.equal(err.code, 'WORLD_UNAVAILABLE')
    assert.equal(closed.code, 1008)

    const host = registry.getWorldHost(homeId)
    assert.equal(host?.sessions?.size ?? 0, 0, 'no session for the signed-out user')
  })

  test('a public world whose load is held admits the socket as anonymous', async () => {
    loadHold.reset()
    const gina = await registerUser('HeldGina')

    const created = await httpJson('POST', '/api/worlds', {
      payload: { slug: 'plaza', name: 'Plaza' }, cookie: gina.cookie,
    })
    assert.equal(created.statusCode, 201, JSON.stringify(created.body))
    const worldId = created.body.id
    const put = await httpJson('PUT', `/api/worlds/${worldId}`, {
      payload: { visibility: 'public' }, cookie: gina.cookie,
    })
    assert.equal(put.statusCode, 200, JSON.stringify(put.body))
    assert.equal(registry.getWorldHost(worldId), null, 'not loaded yet')

    loadHold.ids.add(worldId)
    const conn = rawWs('/worlds/HeldGina/plaza', { cookie: gina.cookie })

    assert.ok(await waitFor(() => loadHold.observed.has(worldId)), 'the load was held')

    const out = await logoutUser(gina.cookie)
    assert.equal(out.statusCode, 200)

    loadHold.release()
    await conn.opened

    const id = `ss-${++sessionCounter}`
    conn.ws.send(JSON.stringify({ type: 'hello', id, capabilities: { tick: { interval: 5000 } } }))
    const hello = await conn.q.waitForType('hello', 4000)
    assert.ok(hello, 'the socket was admitted')
    assert.equal(hello.signedIn, false, 'admitted anonymously')
    assert.equal('userId' in hello, false)
    assert.notEqual(hello.canEdit, true, 'no edit rights')
    conn.ws.close()
  })

  test('a private world whose load is held refuses the socket after the logout', async () => {
    loadHold.reset()
    const hank = await registerUser('HeldHank')

    const created = await httpJson('POST', '/api/worlds', {
      payload: { slug: 'vault', name: 'Vault' }, cookie: hank.cookie,
    })
    assert.equal(created.statusCode, 201, JSON.stringify(created.body))
    const worldId = created.body.id
    assert.equal(registry.getWorldHost(worldId), null, 'not loaded yet')

    loadHold.ids.add(worldId)
    const conn = rawWs('/worlds/HeldHank/vault', { cookie: hank.cookie })

    assert.ok(await waitFor(() => loadHold.observed.has(worldId)), 'the load was held')

    const out = await logoutUser(hank.cookie)
    assert.equal(out.statusCode, 200)

    loadHold.release()
    await conn.opened
    const err = await conn.q.waitForType('error', 4000)
    const closed = await conn.closed
    assert.ok(err, 'refused')
    assert.equal(err.code, 'WORLD_UNAVAILABLE')
    assert.equal(closed.code, 1008)
  })
})

// ---------------------------------------------------------------------------
// (g) logout when the deletion fails
// ---------------------------------------------------------------------------

describe('6.2(g) logout when the deletion fails', () => {
  test('500 Sign-out failed, cookie kept, socket open, me 200, [auth] logout failed alice', async () => {
    loadHold.reset()
    const alice = await registerUser('FailAlice')

    const conn = await connectHello('/', { cookie: alice.cookie })
    assert.equal(conn.hello.signedIn, true)

    const realPrepare = db.database.prepare.bind(db.database)
    const lines = []
    const realError = console.error
    console.error = (...args) => { lines.push(args.join(' ')); realError(...args) }

    let res
    try {
      db.database.prepare = (sql) => {
        const stmt = realPrepare(sql)
        if (/^\s*DELETE\s+FROM\s+auth_sessions/i.test(sql)) {
          return new Proxy(stmt, {
            get(target, prop) {
              if (prop === 'run') return () => { throw new Error('simulated delete failure') }
              const v = Reflect.get(target, prop)
              return typeof v === 'function' ? v.bind(target) : v
            },
          })
        }
        return stmt
      }
      res = await logoutUser(alice.cookie)
    } finally {
      db.database.prepare = realPrepare
      console.error = realError
    }

    assert.equal(res.statusCode, 500)
    assert.equal(res.body.error, 'Sign-out failed')
    assert.equal(res.setCookie, null, 'the cookie is not cleared')

    // The socket stays open and the session still answers.
    await sleep(60)
    assert.equal(conn.ws.readyState, WebSocket.OPEN, 'alice’s socket stays open')
    const meRes = await meUser(alice.cookie)
    assert.equal(meRes.statusCode, 200, 'me still answers 200')

    assert.ok(lines.includes('[auth] logout failed FailAlice'),
      `expected "[auth] logout failed FailAlice", got ${JSON.stringify(lines)}`)
    assert.equal(lines.join('\n').includes(alice.cookie), false, 'no cookie value in the line')

    conn.ws.close()
  })

  test('zero rows deleted and no cookie at all are both 200', async () => {
    const u = await registerUser('ZeroZoe')
    const gone = await logoutUser(u.cookie)
    assert.equal(gone.statusCode, 200)
    // Second logout: the row is already gone — zero rows deleted is a success.
    const again = await logoutUser(u.cookie)
    assert.equal(again.statusCode, 200)
    // No cookie at all.
    const none = await httpJson('POST', '/api/auth/logout')
    assert.equal(none.statusCode, 200)
  })
})
