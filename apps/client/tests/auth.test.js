// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionServer } from '../../../packages/server/src/session.js'
import { createWorld } from '../../../packages/server/src/world.js'
import { createRequestHandler } from '../../../packages/server/src/http-routes.js'
import { createDb } from '../../../packages/server/src/db.js'
import * as serverAuth from '../../../packages/server/src/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const PORT = 3117

// Temporary database
const tempDir = mkdtempSync(join(tmpdir(), 'atrium-authclient-test-'))
const dbPath = join(tempDir, 'test.db')

const db = createDb(dbPath)
const httpServer = createServer(createRequestHandler({ db, auth: serverAuth }))

const world = await createWorld(FIXTURE_PATH)
const sessionServer = createSessionServer({ httpServer, maxUsers: 20, world, db })

httpServer.listen(PORT)

after(async () => {
  sessionServer.close()
  db.close()
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// HTTP helpers (same pattern as server tests)
// ---------------------------------------------------------------------------

function httpPost(path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    }
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port: PORT, path, method: 'POST', headers },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) }) }
          catch { resolve({ statusCode: res.statusCode, headers: res.headers, body }) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function httpGet(path, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {}
    if (cookie) headers['Cookie'] = cookie
    const req = request(
      { hostname: 'localhost', port: PORT, path, method: 'GET', headers },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try { resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) }) }
          catch { resolve({ statusCode: res.statusCode, headers: res.headers, body }) }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

function extractCookie(res) {
  const setCookie = Array.isArray(res.headers['set-cookie'])
    ? res.headers['set-cookie'].join('; ')
    : res.headers['set-cookie']
  return setCookie || null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('register creates a user', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'authjs-test-user',
    password: 'correct horse battery staple',
  })
  assert.equal(res.statusCode, 201)
  assert.ok(res.body.id)
  assert.equal(res.body.username, 'authjs-test-user')
  assert.equal(res.body.displayName, 'authjs-test-user')
})

test('register rejects duplicate username with 409', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'authjs-test-user',
    password: 'another password',
  })
  assert.equal(res.statusCode, 409)
  assert.ok(res.body.error.toLowerCase().includes('already exists'))
})

test('register rejects short password with 400', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'too-short',
    password: 'ab',
  })
  assert.equal(res.statusCode, 400)
})

test('register rejects common password with 400', async () => {
  const res = await httpPost('/api/auth/register', {
    username: 'common-pw',
    password: 'password',
  })
  assert.equal(res.statusCode, 400)
})

test('login succeeds with valid credentials', async () => {
  const res = await httpPost('/api/auth/login', {
    username: 'authjs-test-user',
    password: 'correct horse battery staple',
  })
  assert.equal(res.statusCode, 200)
  assert.ok(res.body.id)
  assert.equal(res.body.username, 'authjs-test-user')
  assert.equal(res.body.displayName, 'authjs-test-user')
})

test('login rejects wrong password with 401', async () => {
  const res = await httpPost('/api/auth/login', {
    username: 'authjs-test-user',
    password: 'wrong password',
  })
  assert.equal(res.statusCode, 401)
})

test('login rejects non-existent user with 401', async () => {
  const res = await httpPost('/api/auth/login', {
    username: 'nobody',
    password: 'any password',
  })
  assert.equal(res.statusCode, 401)
})

test('me returns null/401 when not logged in', async () => {
  const res = await httpGet('/api/auth/me')
  assert.equal(res.statusCode, 401)
})

test('me returns user info after login', async () => {
  const loginRes = await httpPost('/api/auth/login', {
    username: 'authjs-test-user',
    password: 'correct horse battery staple',
  })
  const cookie = extractCookie(loginRes)
  assert.ok(cookie, 'login returned a session cookie')

  const res = await httpGet('/api/auth/me', cookie)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.username, 'authjs-test-user')
  assert.equal(res.body.displayName, 'authjs-test-user')
})

test('logout clears the session', async () => {
  const loginRes = await httpPost('/api/auth/login', {
    username: 'authjs-test-user',
    password: 'correct horse battery staple',
  })
  const cookie = extractCookie(loginRes)
  assert.ok(cookie)

  // Logout
  const logoutRes = await httpPost('/api/auth/logout', {}, cookie)
  assert.equal(logoutRes.statusCode, 200)

  // Session should be gone
  const meRes = await httpGet('/api/auth/me', cookie)
  assert.equal(meRes.statusCode, 401)
})

test('logout is idempotent (works without cookie)', async () => {
  const res = await httpPost('/api/auth/logout', {})
  assert.equal(res.statusCode, 200)
})

test('register + login + me + logout cycle', async () => {
  // Register
  const regRes = await httpPost('/api/auth/register', {
    username: 'cycle-test-user',
    password: 'cycle test password 123',
  })
  const regCookie = extractCookie(regRes)
  assert.ok(regCookie, 'register returned a session cookie')

  // me after register
  const meAfterReg = await httpGet('/api/auth/me', regCookie)
  assert.equal(meAfterReg.statusCode, 200)
  assert.equal(meAfterReg.body.username, 'cycle-test-user')

  // logout
  const logoutRes = await httpPost('/api/auth/logout', {}, regCookie)
  assert.equal(logoutRes.statusCode, 200)

  // me after logout
  const meAfterLogout = await httpGet('/api/auth/me', regCookie)
  assert.equal(meAfterLogout.statusCode, 401)
})