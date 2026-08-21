// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { randomUUID } from 'node:crypto'

/**
 * Create the HTTP request handler for the Atrium server.
 *
 * Returns a function suitable for passing to http.createServer().
 * The factory accepts an options object so auth routes can receive
 * dependencies (db, auth) without changing the call signature.
 */
export function createRequestHandler(opts = {}) {
  const { db, auth } = opts

  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const method = req.method

    // -----------------------------------------------------------------------
    // GET /api/health
    // -----------------------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    // -----------------------------------------------------------------------
    // POST /api/auth/register
    // -----------------------------------------------------------------------
    if (method === 'POST' && url.pathname === '/api/auth/register') {
      if (!db || !auth) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Auth subsystem not available' }))
        return
      }

      let body
      try {
        body = await parseJSONBody(req)
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid request body' }))
        return
      }

      const { username, password } = body || {}

      // -- Validate username presence --
      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Username is required' }))
        return
      }

      // -- Validate password --
      const passwordErrors = auth.validatePassword(password || '')
      if (passwordErrors.length > 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: passwordErrors[0] }))
        return
      }

      // -- Normalize username --
      const normalized = auth.normalizeUsername(username)

      // -- Hash password --
      let passwordHash
      try {
        passwordHash = await auth.hashPassword(password)
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
        return
      }

      // -- Create user --
      const userId = randomUUID()
      const now = new Date().toISOString()
      const displayName = normalized

      try {
        db.database.prepare(
          'INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(userId, normalized, passwordHash, displayName, now)
      } catch (err) {
        // UNIQUE constraint on username (case-insensitive index)
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'An account with that username already exists' }))
          return
        }
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
        return
      }

      // -- Create auth session --
      const authSessionId = randomUUID()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

      try {
        db.database.prepare(
          'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
        ).run(authSessionId, userId, now, expiresAt)
      } catch {
        // Session creation failed — clean up the user we just created
        db.database.prepare('DELETE FROM users WHERE id = ?').run(userId)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
        return
      }

      // -- Set cookie --
      setAuthCookie(res, authSessionId)

      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: userId,
        username: normalized,
        displayName,
        createdAt: now,
      }))
      return
    }

    // Catch-all: unknown paths
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the body of an incoming HTTP request as JSON.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<object|null>}
 */
function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (chunks.length === 0) return resolve(null)
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Set the atrium_auth_session cookie on the response.
 * @param {import('node:http').ServerResponse} res
 * @param {string} authSessionId
 */
function setAuthCookie(res, authSessionId) {
  const cookie = [
    `atrium_auth_session=${authSessionId}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    // Max-Age: 7 days (matching expires_at)
    'Max-Age=604800',
  ].join('; ')
  res.setHeader('Set-Cookie', cookie)
}

/**
 * Clear the auth cookie (for logout).
 * @param {import('node:http').ServerResponse} res
 */
export function clearAuthCookie(res) {
  const cookie = [
    'atrium_auth_session=',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ].join('; ')
  res.setHeader('Set-Cookie', cookie)
}

/**
 * Parse the auth session cookie from a request.
 * @param {import('node:http').IncomingMessage} req
 * @returns {string|null}
 */
export function parseAuthSessionCookie(req) {
  const raw = req.headers['cookie']
  if (!raw) return null
  const cookies = raw.split(';').map(c => c.trim())
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=')
    if (name.trim() === 'atrium_auth_session' && rest.length > 0) {
      return rest.join('=').trim()
    }
  }
  return null
}