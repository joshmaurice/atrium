// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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
import { register, login, logout, me } from '../src/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const PORT = 3117
const BASE_URL = `http://localhost:${PORT}`

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
// Tests: auth.js contract
// ---------------------------------------------------------------------------
//
// Note on session continuity: Node's built-in fetch() does NOT persist
// cookies across separate calls the way a browser does. A Set-Cookie from
// one fetch() response is not automatically resent as a Cookie header on a
// later fetch() call. Therefore, a test sequence like login() → me() that
// proves session continuity through auth.js's public API cannot work in
// Node without adding a cookie jar to the module itself. That continuity is
// verified by the real browser smoke test (see TASK-client-ui.md's Live
// Verification section, steps 1-2). What we DO test here is each function's
// per-call contract: success shape, error shape with server messages,
// .status property on errors, me() returning null vs throwing, the baseUrl
// option, and website field pass-through.
// ---------------------------------------------------------------------------

test('register returns user data on success', async () => {
  const data = await register('authjs-test-user', 'correct horse battery staple', undefined, { baseUrl: BASE_URL })
  assert.ok(data.id, 'response includes user id')
  assert.equal(data.username, 'authjs-test-user')
  assert.equal(data.displayName, 'authjs-test-user')
  assert.ok(data.createdAt, 'response includes createdAt')
})

test('register throws 409 with server message on duplicate username', async () => {
  try {
    await register('authjs-test-user', 'another password', undefined, { baseUrl: BASE_URL })
    assert.fail('expected error')
  } catch (err) {
    assert.equal(err.status, 409)
    assert.ok(err.message.toLowerCase().includes('already exists'),
      `message "${err.message}" includes "already exists"`)
    assert.ok(err instanceof Error)
  }
})

test('register throws 400 with server message on short password', async () => {
  try {
    await register('short-pw-user', 'ab', undefined, { baseUrl: BASE_URL })
    assert.fail('expected error')
  } catch (err) {
    assert.equal(err.status, 400)
    assert.ok(err.message.length > 0, 'error message is not empty')
  }
})

test('register throws 400 on common password', async () => {
  try {
    await register('common-pw-user', 'password', undefined, { baseUrl: BASE_URL })
    assert.fail('expected error')
  } catch (err) {
    assert.equal(err.status, 400)
  }
})

test('register sends website field — honeypot path returns fake success', async () => {
  // The server treats a non-empty website field as a honeypot trigger:
  // returns 200 with fake data and does NOT create an account.
  const data = await register('honeypot-bot', 'a valid password', 'http://spam.bot/', { baseUrl: BASE_URL })
  // Should get the fake 200 success (not 201, not an error)
  assert.ok(data.id, 'response includes a fake id')

  // Verify no account was actually created by attempting to log in with it —
  // sidesteps the no-cookie-persistence limitation entirely, since a fresh
  // login() attempt doesn't depend on any prior session state. Same pattern
  // already used in packages/server/test/world-crud.test.js's honeypot test.
  try {
    await login('honeypot-bot', 'a valid password', { baseUrl: BASE_URL })
    assert.fail('expected login to fail — no account should have been created')
  } catch (err) {
    assert.equal(err.status, 401, 'honeypot worked: no account exists to log into')
  }
})

test('login throws 401 on wrong password', async () => {
  try {
    await login('authjs-test-user', 'wrong password', { baseUrl: BASE_URL })
    assert.fail('expected error')
  } catch (err) {
    assert.equal(err.status, 401)
    assert.ok(err.message.length > 0, 'error message is not empty')
  }
})

test('login throws 401 on non-existent user', async () => {
  try {
    await login('nobody', 'any password', { baseUrl: BASE_URL })
    assert.fail('expected error')
  } catch (err) {
    assert.equal(err.status, 401)
  }
})

test('me returns null on 401 (not logged in) — not a thrown error', async () => {
  // This is the key behavioral contract: me() returns null for "not logged
  // in" rather than throwing, so callers can treat null as the expected
  // anonymous state without try/catch.
  const result = await me({ baseUrl: BASE_URL })
  assert.equal(result, null)
})

test('logout returns true on success', async () => {
  const result = await logout({ baseUrl: BASE_URL })
  assert.equal(result, true)
})

test('logout is idempotent — works without a session', async () => {
  const result = await logout({ baseUrl: BASE_URL })
  assert.equal(result, true)
})

test('baseUrl option is honored', async () => {
  // If we drop the baseUrl, the fetch goes to same-origin '' which is not
  // the test server. Pointing at BASE_URL and seeing success proves the
  // option is wired through.
  const result = await me({ baseUrl: BASE_URL })
  // We're not logged in at this point, so me() should return null
  assert.equal(result, null)
})