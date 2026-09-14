// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { isOriginAllowed } from './http-routes.js'
import { createWorldHost } from './world-host.js'
import { createWorld, createWorldFromDocument } from './world.js'

/**
 * UUID regex for hygiene check on /home/<userId>/home path segments.
 * Simple check: hex chars with hyphens in 8-4-4-4-12 pattern.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * WorldRegistry manages the lifetime cycle of per-world hosts and routes
 * WebSocket upgrades to the correct world by URL path.
 *
 * Path resolution:
 *   - `/` or ``      → 'default' (the common, boot-loaded)
 *   - `/home/<uid>/home`  → { kind: 'home', homeUserId, slug }
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

  // In-flight promise map for lazy register-while-first-join races
  /** @type {Map<string, Promise<object>>} */
  const pendingCreations = new Map()

  // ---------------------------------------------------------------------------
  // URL path → resolution descriptor
  // ---------------------------------------------------------------------------
  function resolveWorldId(pathname) {
    // Strip trailing slash (keep bare `/` which maps to default)
    let cleaned = pathname
    if (cleaned !== '/' && cleaned.endsWith('/')) {
      cleaned = cleaned.slice(0, -1)
    }
    // Root path → default world
    if (cleaned === '/' || cleaned === '') return { kind: 'default' }

    // Client is served under /apps/client/ — Caddy redirects bare `/`
    if (cleaned === '/apps/client') return { kind: 'default' }

    // `/ws/<worldId>` — world-by-id routing
    if (cleaned.startsWith('/ws/')) {
      const worldRowId = cleaned.slice(4)
      if (!worldRowId) return null
      return { kind: 'byWorldRowId', worldRowId }
    }

    // `/home/<userId>/home` — home world auto-load (Step 2)
    if (cleaned.startsWith('/home/')) {
      const segments = cleaned.slice(6).split('/')
      // Must be exactly /home/<userId>/home (two segments beyond /home/)
      if (segments.length !== 2) return null
      // Reject if the second segment is not 'home'
      if (segments[1] !== 'home') return null
      const userId = segments[0]
      // Hygiene: userId must be valid UUID
      if (!UUID_RE.test(userId)) return null
      return { kind: 'home', homeUserId: userId, slug: 'home' }
    }

    // `/public/...` — not yet implemented (future Step 4)
    if (cleaned.startsWith('/public/')) return null

    // Everything else is unknown
    return null
  }

  // ---------------------------------------------------------------------------
  // Guard helpers for sendHttpResponse (same as before)
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
  // Single upgrade handler — routes to the correct WorldHost
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

    const descriptor = resolveWorldId(pathname)
    if (!descriptor) {
      sendHttpResponse(socket, 404, 'Not Found')
      return
    }

    // ── Default world (root path, /apps/client) ──
    if (descriptor.kind === 'default') {
      const host = hosts.get('default')
      if (!host) {
        sendHttpResponse(socket, 404, 'World Not Found')
        return
      }
      // Resolve userId from cookie (for backward compat with existing hello auth)
      let upgradeUserId = null
      if (db) {
        try { upgradeUserId = resolveWsUserId(request, db) } catch { upgradeUserId = null }
      }
      host.handleUpgrade(request, socket, head, upgradeUserId)
      return
    }

    // ── By world row id (/ws/<id>) ──
    if (descriptor.kind === 'byWorldRowId') {
      const host = hosts.get(descriptor.worldRowId)
      if (!host) {
        sendHttpResponse(socket, 404, 'World Not Found')
        return
      }
      let upgradeUserId = null
      if (db) {
        try { upgradeUserId = resolveWsUserId(request, db) } catch { upgradeUserId = null }
      }
      // Admission: owned worlds (those with an ownerUserId) require the
      // connecting user to be the owner — anonymous and mismatched users
      // get 404. This prevents the /ws/<homeWorldRowId> path from
      // bypassing the identity check enforced in the /home/<userId>/home path.
      if (host.ownerUserId && upgradeUserId !== host.ownerUserId) {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }
      // Cancel any pending teardown — a new connection arrived
      cancelTeardown(descriptor.worldRowId)
      host.handleUpgrade(request, socket, head, upgradeUserId)
      return
    }

    // ── Home world (/home/<userId>/home) ──
    if (descriptor.kind === 'home') {
      // 1. Resolve user identity from session cookie
      let upgradeUserId = null
      if (db) {
        try { upgradeUserId = resolveWsUserId(request, db) } catch { upgradeUserId = null }
      }

      // 2. Admission: anonymous → 404 (no leak)
      if (!upgradeUserId) {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      // 3. Admission: path userId must match cookie identity
      if (upgradeUserId !== descriptor.homeUserId) {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      // 4. DB lookup for the home world row
      let row
      try {
        row = db.database.prepare(
          "SELECT id, owner_user_id, document FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
        ).get(upgradeUserId)
      } catch {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      // 5. No row → 404 (auto-create happens at login HTTP route, not upgrade)
      if (!row) {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      // 6. Verify owner matches (redundant with WHERE clause but explicit for clarity)
      if (row.owner_user_id !== upgradeUserId) {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      // 7. Host key is row UUID, same /ws/<id> space
      const hostId = row.id

      // 8. Lazy create host on first join (with concurrency guard)
      const doUpgrade = () => {
        const host = hosts.get(hostId)
        if (!host) {
          sendHttpResponse(socket, 404, 'World Not Found')
          return
        }
        host.handleUpgrade(request, socket, head, upgradeUserId)
      }

      if (hosts.has(hostId)) {
        cancelTeardown(hostId)
        doUpgrade()
        return
      }

      // First join — register from document, with in-flight guard for races
      if (pendingCreations.has(hostId)) {
        // Another upgrade is already creating this host — await it
        pendingCreations.get(hostId).then(doUpgrade, doUpgrade)
        return
      }

      const createPromise = (async () => {
        try {
          const host = await registerWorldFromDocument(row)
          return host
        } catch (err) {
          console.error(`[world-registry] Failed to register home world ${hostId}:`, err.message)
          pendingCreations.delete(hostId)
          throw err
        }
      })()

      pendingCreations.set(hostId, createPromise)
      createPromise.then(
        () => { pendingCreations.delete(hostId); cancelTeardown(hostId); doUpgrade() },
        () => { pendingCreations.delete(hostId); sendHttpResponse(socket, 404, 'Not Found') }
      )
      return
    }

    // Fallback: unknown descriptor
    sendHttpResponse(socket, 404, 'Not Found')
  })

  // ---------------------------------------------------------------------------
  // Parse cookie userId helper (matches session.js token)
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
  // Teardown scheduling (debounced, reversible on reconnect)
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
  // Registration — create a new world and its host from a file path
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
  // Registration from DB document — create a new world host from a row's
  // serialized glTF document column. Used for home worlds and other
  // document-stored worlds whose live instance is created on first join.
  // ---------------------------------------------------------------------------
  async function registerWorldFromDocument(worldRow) {
    const worldId = worldRow.id

    if (hosts.has(worldId)) {
      throw new Error(`World "${worldId}" is already registered`)
    }

    const documentJson = worldRow.document || '{"asset":{"version":"2.0","generator":"Atrium"}}'
    const world = await createWorldFromDocument(documentJson)

    // Home worlds typically have no external refs, but resolve if present
    await world.resolveExternalReferences()

    const nodeCount = world.listNodeNames().length
    console.log(`[world-registry] Home world loaded: "${worldId}" — ${nodeCount} nodes`)

    const host = createWorldHost({
      id: worldId,
      world,
      db,
      ownerUserId: worldRow.owner_user_id,
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
    pendingCreations.clear()
  }

  return {
    hosts,
    registerWorld,
    registerWorldFromDocument,
    getWorldHost,
    getDefaultHost,
    onSessionRemoved,
    scheduleTeardown,
    cancelTeardown,
    performTeardown,
    close,
  }
}