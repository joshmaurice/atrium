// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * Create the HTTP request handler for the Atrium server.
 *
 * Returns a function suitable for passing to http.createServer().
 * The factory accepts an options object so future auth routes (register,
 * login, logout, me) can receive dependencies (db, auth, etc.) without
 * changing the call signature later.
 */
export function createRequestHandler(_opts = {}) {
  return (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const method = req.method

    if (method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    // Catch-all: unknown paths
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
}