// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { randomUUID } from 'node:crypto'

/**
 * Validate the Origin header for CSRF / cross-origin protection.
 *
 * Policy (explicit CSRF decision — see note below):
 * - No Origin header: allowed (non-browser clients, curl, test scripts).
 *   On a same-origin deployment, any real browser request to a
 *   state-changing endpoint will include an Origin header.
 * - Origin matches the request's Host (same scheme, host, and port): allowed.
 * - Anything else: rejected.
 *
 * This is applied to WebSocket upgrades AND state-changing HTTP routes
 * (POST register/login/logout). GET /api/health and GET /api/auth/me
 * are exempt — they read no session state and change nothing.
 *
 * CSRF custom-header decision (per TASK-auth.md optionality note):
 *   SameSite=Lax + Origin validation on state-changing routes is judged
 *   sufficient for Phase 1 (same-origin deployment model, no federated
 *   auth). An Atrium-specific custom header is NOT required; if a future
 *   cross-origin deployment is needed, the custom header approach should
 *   be adopted then.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isOriginAllowed(req) {
  const origin = req.headers['origin']
  if (!origin) return true // No origin = non-browser client, allow

  const host = req.headers['host']
  if (!host) return false // Host header required for origin comparison

  try {
    const parsedOrigin = new URL(origin)
    // Compare scheme + host + port against the Host header
    // Accept http://host:port or https://host:port
    const hostParts = host.split(':')
    const hostname = hostParts[0]
    const port = hostParts[1] || (parsedOrigin.protocol === 'https:' ? '443' : '80')

    if (parsedOrigin.hostname !== hostname) return false
    if (parsedOrigin.port !== '' && parsedOrigin.port !== port) return false
    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') return false

    return true
  } catch {
    return false
  }
}

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
    // GET /api/auth/me
    // -----------------------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/auth/me') {
      if (!db) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Auth subsystem not available' }))
        return
      }

      const userId = resolveUserIdFromCookie(req, db)

      if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not authenticated' }))
        return
      }

      const user = db.database.prepare(
        'SELECT id, username, display_name, created_at FROM users WHERE id = ?'
      ).get(userId)

      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not authenticated' }))
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        createdAt: user.created_at,
      }))
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

      if (!isOriginAllowed(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Cross-origin request denied' }))
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

    // -----------------------------------------------------------------------
    // POST /api/auth/login
    // -----------------------------------------------------------------------
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      if (!db || !auth) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Auth subsystem not available' }))
        return
      }

      if (!isOriginAllowed(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Cross-origin request denied' }))
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

      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Username is required' }))
        return
      }

      if (!password || typeof password !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Password is required' }))
        return
      }

      // Generic timing: look up user first, verify password second.
      // Always respond with the same message to avoid leaking which field was wrong.
      const normalized = auth.normalizeUsername(username)
      const user = db.database.prepare(
        'SELECT id, password_hash, display_name, created_at FROM users WHERE username = ? COLLATE NOCASE'
      ).get(normalized)

      if (!user) {
        // Artificial delay to match password verification timing
        await auth.verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$dummy', 'dummy')
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid credentials' }))
        return
      }

      const valid = await auth.verifyPassword(user.password_hash, password)
      if (!valid) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid credentials' }))
        return
      }

      // Create auth session
      const authSessionId = randomUUID()
      const now = new Date().toISOString()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      try {
        db.database.prepare(
          'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
        ).run(authSessionId, user.id, now, expiresAt)
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
        return
      }

      setAuthCookie(res, authSessionId)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: user.id,
        username: normalized,
        displayName: user.display_name,
        createdAt: user.created_at,
      }))
      return
    }

    // -----------------------------------------------------------------------
    // POST /api/auth/logout
    // -----------------------------------------------------------------------
    if (method === 'POST' && url.pathname === '/api/auth/logout') {
      if (!db) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Auth subsystem not available' }))
        return
      }

      if (!isOriginAllowed(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Cross-origin request denied' }))
        return
      }

      const authSessionId = parseAuthSessionCookie(req)

      if (authSessionId) {
        // Best-effort deletion: even if the session doesn't exist or DB fails,
        // we still clear the cookie so the client can logout
        try {
          db.database.prepare('DELETE FROM auth_sessions WHERE id = ?').run(authSessionId)
        } catch {
          // Swallow — cookie clearing is the important part
        }
      }

      clearAuthCookie(res)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Logged out' }))
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

/**
 * Resolve a userId from the request's auth session cookie.
 * Returns null if the cookie is missing, expired, or the session row
 * doesn't exist (anonymous / unauthenticated).
 * @param {import('node:http').IncomingMessage} req
 * @param {{ database: import('better-sqlite3').Database }} db
 * @returns {string|null}
 */
export function resolveUserIdFromCookie(req, db) {
  const authSessionId = parseAuthSessionCookie(req)
  if (!authSessionId) return null

  const row = db.database.prepare(
    'SELECT user_id, expires_at FROM auth_sessions WHERE id = ?'
  ).get(authSessionId)

  if (!row) return null

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) <= new Date()) {
    // Session expired — clean up the row
    try {
      db.database.prepare('DELETE FROM auth_sessions WHERE id = ?').run(authSessionId)
    } catch {
      // Swallow cleanup errors
    }
    return null
  }

  return row.user_id
}