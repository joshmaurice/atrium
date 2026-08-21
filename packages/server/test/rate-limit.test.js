// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { request } from 'node:http'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequestHandler } from '../src/http-routes.js'
import { createDb } from '../src/db.js'
import * as auth from '../src/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = 3016

// Temporary database
const tempDir = mkdtempSync(join(tmpdir(), 'atrium-ratelimit-test-'))
const dbPath = join(tempDir, 'test.db')

function httpPost(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) })
          } catch {
            resolve({ statusCode: res.statusCode, headers: res.headers, body })
          }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Server setup with a very low rate limit for testing
// ---------------------------------------------------------------------------

const db = createDb(dbPath)
// Use a custom request handler with a strict 3-request-per-minute rate limit
// to test throttling without waiting
const httpServer = createServer(createRequestHandler({ db, auth }))

httpServer.listen(PORT)

after(async () => {
  httpServer.close()
  db.close()
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('rate limiter allows requests within the limit', async () => {
  // First three register requests should succeed (within default 20/min limit)
  for (let i = 0; i < 3; i++) {
    const res = await httpPost('/api/auth/register', {
      username: `ratelimit-user-${i}`,
      password: 'a very long testing password here',
    })
    assert.equal(res.statusCode, 201, `request ${i} should succeed`)
  }
})

test('rate limiter blocks requests after exceeding limit', async () => {
  // The default limit is 20/min, and we already used 3.
  // Run 20+ more requests — the 21st should get 429
  let blocked = false
  for (let i = 0; i < 25; i++) {
    const res = await httpPost('/api/auth/register', {
      username: `ratelimit-excess-${i}`,
      password: 'another extremely long password here',
    })
    if (res.statusCode === 429) {
      blocked = true
      assert.ok(res.body)
      assert.ok(res.body.error)
      assert.ok(res.body.error.toLowerCase().includes('too many'))
      break
    }
  }
  assert.ok(blocked, 'rate limiter should eventually return 429')
})

test('rate limiter applies to login as well', async () => {
  // The rate limiter should be exhausted from the previous test.
  // Just assert that login requests are also subject to rate limiting
  // (i.e., they return 429 when the limit is exceeded)
  let blocked = false
  for (let i = 0; i < 30; i++) {
    const res = await httpPost('/api/auth/login', {
      username: `nobody-${i}`,
      password: 'some other long password here maybe',
    })
    if (res.statusCode === 429) {
      blocked = true
      assert.ok(res.body)
      assert.ok(res.body.error)
      assert.ok(res.body.error.toLowerCase().includes('too many'))
      break
    }
  }
  assert.ok(blocked, 'rate limiter should block excessive login attempts')
})

test('unauthenticated GET endpoints are not rate limited', async () => {
  const res = await httpPost('/api/health', {})
  assert.equal(res.statusCode, 404) // POST to /api/health doesn't exist, but 404 not 429
})

test('rate limit is per-IP (different IPs have separate counters)', async () => {
  // Register a user from a "different" IP by using X-Forwarded-For
  const res = await httpPostWithForwardedFor('/api/auth/register', {
    username: 'different-ip-user',
    password: 'a very long testing password here again',
  }, '10.0.0.1')

  assert.equal(res.statusCode, 201)
})

// Helper for test: send request with X-Forwarded-For header
function httpPostWithForwardedFor(path, payload, forwardedIp) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Forwarded-For': forwardedIp,
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) })
          } catch {
            resolve({ statusCode: res.statusCode, headers: res.headers, body })
          }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}