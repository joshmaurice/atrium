// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { isOriginAllowed } from './http-routes.js'
import { createWorldHost } from './world-host.js'
import { createWorld } from './world.js'

/**
 * WorldRegistry manages the lifetime cycle of per-world hosts and routes
 * WebSocket upgrades to the correct world by URL path.
 *
 * Path resolution:
 *   - `/` or ``      → 'default' (the common, boot-loaded)
 *   - `/home/...`    → not yet implemented (future Step 2)
 *   - `/public/...`  → not yet implemented (future Step 4)
 *   - `/ws/<id>`     → world with that id (reserved for future multi-world routing)
 *   - anything else  → 404 at upgrade
 */
export function createWorldRegistry(opts = {}) {
  const { httpServer, db = null } = opts

  if (!httpServer) {
    throw new Error('createWorldRegistry requires httpServer option')
  }

  /** @type {Map<string, object>} worldId → WorldHost */
  const hosts = new Map()

  // ---------------------------------------------------------------------------
  // URL path → worldId resolution
  // ---------------------------------------------------------------------------
  function resolveWorldId(pathname) {
    // Strip trailing slash (keep bare `/` which maps to default)
    let cleaned = pathname
    if (cleaned !== '/' && cleaned.endsWith('/')) {
      cleaned = cleaned.slice(0, -1)
    }
    // Root path → default world
    if (cleaned === '/' || cleaned === '') return 'default'

    // Client is served under /apps/client/ — Caddy redirects bare `/`
    // before a WS upgrade can reach it (directive reordering; see
    // devtasks/DEPLOY-and-handoff-notes-2026-08-25.md, "Round 2").
    // Treat this path as root.
    if (cleaned === '/apps/client') return 'default'

    // Future routes — not yet implemented (intentional placeholders for
    // Step 2: home world auto-load, Step 4: public world routing)
    if (cleaned.startsWith('/home/'))   return null
    if (cleaned.startsWith('/public/')) return null

    // `/ws/<worldId>` — reserved for world-by-id routing
    if (cleaned.startsWith('/ws/')) {
      return cleaned.slice(4) // e.g., /ws/myworld → myworld
    }

    // Everything else is unknown
    return null
  }

  // ---------------------------------------------------------------------------
  // Single upgrade handler — routes to the correct WorldHost
  // Note: upgradeUserId is resolved here and passed as the 3rd argument
  // to the 'connection' event (see world-host.js handleUpgrade). This
  // allows attachSessionHandlers to authenticate the user at hello time.
  // ---------------------------------------------------------------------------
  httpServer.on('upgrade', (request, socket, head) => {
    // Only handle WebSocket upgrade requests
    const upgrade = request.headers['upgrade']
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      socket.destroy()
      return
    }

    // Validate Origin header
    if (!isOriginAllowed(request)) {
      socket.destroy()
      return
    }

    // Parse URL path
    let pathname
    try {
      pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname
    } catch {
      socket.destroy()
      return
    }

    const worldId = resolveWorldId(pathname)
    if (!worldId) {
      sendHttpResponse(socket, 404, 'Not Found')
      return
    }

    // Look up the world host
    const host = hosts.get(worldId)
    if (!host) {
      sendHttpResponse(socket, 404, 'World Not Found')
      return
    }

    // Resolve user identity from session cookie
    let upgradeUserId = null
    if (db) {
      try {
        upgradeUserId = resolveWsUserId(request, db)
      } catch {
        upgradeUserId = null
      }
    }

    // Upgrade into the target world's WebSocket server
    host.handleUpgrade(request, socket, head, upgradeUserId)
  })

  // ---------------------------------------------------------------------------
  // Parse cookie userId helper (matches session.js token)
  // Note: This is intentionally duplicated from session.js (same function
  // name) to avoid circular imports — the registry imports world-host,
  // which imports attachSessionHandlers from session.js. If they shared
  // the function, world-registry → world-host → session.js → world-registry
  // would form a cycle. Both copies must be kept in sync.
  // ---------------------------------------------------------------------------
  function resolveWsUserId(req, dbRef) {
    const raw = req.headers['cookie']
    if (!raw) return null

    let authSessionId = null
    const cookies = raw.split(';').map(c => c.trim())
    for (const cookie of cookies) {
      const [name, ...rest] = cookie.split('=')
      if (name.trim() === 'atrium_auth_session' && rest.length > 0) {
        authSessionId = rest.join('=').trim()
        break
      }
    }
    if (!authSessionId) return null

    const row = dbRef.database.prepare(
      'SELECT user_id, expires_at FROM auth_sessions WHERE id = ?'
    ).get(authSessionId)

    if (!row) return null

    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      try {
        dbRef.database.prepare('DELETE FROM auth_sessions WHERE id = ?').run(authSessionId)
      } catch {}
      return null
    }

    return row.user_id
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function sendHttpResponse(socket, status, body) {
      const buf = Buffer.from(body, 'utf-8')
      const reason = status === 404 ? 'Not Found' : 'Bad Request'
      socket.write([
        `HTTP/1.1 ${status} ${reason}`,
        'Content-Type: text/plain',
        `Content-Length: ${buf.length}`,
        'Connection: close',
        '',
        body,
      ].join('\r\n'))
      socket.destroy()
    }

  // ---------------------------------------------------------------------------
  // Session lifecycle — called from WorldHost when a session is removed
  // ---------------------------------------------------------------------------
  function onSessionRemoved(worldId, session) {
    const host = hosts.get(worldId)
    if (!host) return

    if (host.sessions.size === 0) {
      scheduleTeardown(worldId)
    }
  }

  // ---------------------------------------------------------------------------
  // Teardown scheduling (debounced, reverible on reconnect)
  // ---------------------------------------------------------------------------
  const TEARDOWN_DELAY = 3000
  const teardownTimers = new Map()

  function scheduleTeardown(worldId) {
    // The boot 'default' world is never torn down (see ADDENDUM-user-accounts-phase2.md §6).
    if (worldId === 'default') return
    if (teardownTimers.has(worldId)) return
    const timer = setTimeout(() => {
      teardownTimers.delete(worldId)
      performTeardown(worldId)
    }, TEARDOWN_DELAY)
    if (timer.unref) timer.unref()
    teardownTimers.set(worldId, timer)
  }

  function cancelTeardown(worldId) {
    const timer = teardownTimers.get(worldId)
    if (timer) {
      clearTimeout(timer)
      teardownTimers.delete(worldId)
    }
  }

  async function performTeardown(worldId) {
    // The boot 'default' world is never torn down (see ADDENDUM-user-accounts-phase2.md §6).
    if (worldId === 'default') return
    const host = hosts.get(worldId)
    if (!host) return
    if (host.sessions.size > 0) return // reconnected, skip

    console.log(`[world-registry] Tearing down world "${worldId}" (no sessions left)`)

    // Placeholder: flush-and-save hook (Step 3)
    // if (typeof host.world.saveIfDirty === 'func') await host.world.saveIfDirty()

    host.close()
    hosts.delete(worldId)
  }

  // ---------------------------------------------------------------------------
  // Registration — create a new world and its host
  // ---------------------------------------------------------------------------
  async function registerWorld(worldId = 'default', gltfPath, ownerUserId = null) {
    if (hosts.has(worldId)) {
      throw new Error(`World "${worldId}" is already registered`)
    }

    const world = await createWorld(gltfPath)
    await world.resolveExternalReferences()

    const nodeCount = world.listNodeNames().length
    console.log(`Atrium world loaded: "${worldId}" — ${nodeCount} nodes`)

    const host = createWorldHost({
      id: worldId,
      world,
      db,
      ownerUserId,
      onSessionRemoved: (session) => onSessionRemoved(worldId, session),
    })

    hosts.set(worldId, host)
    return host
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------
  function getWorldHost(worldId) {
    return hosts.get(worldId) || null
  }

  function getDefaultHost() {
    return hosts.get('default') || null
  }

  // ---------------------------------------------------------------------------
  // Close all
  // ---------------------------------------------------------------------------
  function close() {
    for (const timer of teardownTimers.values()) {
      clearTimeout(timer)
    }
    teardownTimers.clear()

    for (const [, host] of hosts) {
      host.close()
    }
    hosts.clear()
  }

  return {
    hosts,
    registerWorld,
    getWorldHost,
    getDefaultHost,
    onSessionRemoved,
    scheduleTeardown,
    cancelTeardown,
    performTeardown,
    close,
  }
}