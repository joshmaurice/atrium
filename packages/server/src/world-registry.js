// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { isOriginAllowed, resolveWsUserId } from './http-routes.js'
import { createWorldHost } from './world-host.js'
import { createWorld, createWorldFromDocument } from './world.js'
import { createAutoSaveCoordinator } from './autosave.js'

/**
 * UUID regex for hygiene check on /home/<userId>/home path segments.
 * Simple check: hex chars with hyphens in 8-4-4-4-12 pattern.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Safe slug: must not be exactly '.' or '..' (path traversal).
 * Any other valid decoded string is accepted — usernames/slugs with
 * spaces or special characters are valid after decodeURIComponent
 * (pre-brief #10).
 */
function isSafeSegment(name) {
  return name !== '.' && name !== '..'
}

/**
 * WorldRegistry manages the lifetime cycle of per-world hosts and routes
 * WebSocket upgrades to the correct world by URL path.
 *
 * Path resolution:
 *   - `/` or ``      → 'default' (the common, boot-loaded)
 *   - `/home/<uid>/home`  → { kind: 'home', homeUserId, slug }
 *   - `/worlds/<user>/<slug>` → { kind: 'public', username, slug } (canonical, pre-brief #1+#13)
 *   - `/public/<user>/<slug>` → { kind: 'public', username, slug } (legacy alias)
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

  // Auto-save coordinator — manages debounced, periodic, and disconnect-flush saves
  const coordinator = createAutoSaveCoordinator({ db })

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

    // `/worlds/<username>/<slug>` — canonical public world routing (pre-brief #1+#13)
    if (cleaned.startsWith('/worlds/')) {
      // Decode URI-encoded segments (the client encodes with encodeURIComponent)
      const rawSegments = cleaned.slice(8).split('/')
      if (rawSegments.length !== 2) return null
      const decodedSegments = rawSegments.map(s => {
        try { return decodeURIComponent(s) } catch { return null }
      })
      if (decodedSegments[0] === null || decodedSegments[1] === null) return null
      let [username, slug] = decodedSegments
      if (!username || !slug) return null
      // Reject path traversal: only exact '.' and '..' are forbidden (pre-brief #10)
      if (!isSafeSegment(username) || !isSafeSegment(slug)) return null
      // 'home' slug IS allowed — home worlds can be addressed via /worlds/ as well
      return { kind: 'public', username, slug }
    }

    // `/public/<username>/<slug>` — legacy public world routing (backward compat)
    if (cleaned.startsWith('/public/')) {
      // Decode URI-encoded segments (the client encodes with encodeURIComponent)
      const rawSegments = cleaned.slice(8).split('/')
      if (rawSegments.length !== 2) return null
      const decodedSegments = rawSegments.map(s => {
        try { return decodeURIComponent(s) } catch { return null }
      })
      if (decodedSegments[0] === null || decodedSegments[1] === null) return null
      let [username, slug] = decodedSegments
      if (!username || !slug) return null
      // Reject path traversal: only exact '.' and '..' are forbidden (pre-brief #10)
      if (!isSafeSegment(username) || !isSafeSegment(slug)) return null
      // 'home' slug IS allowed — home worlds can be public too
      return { kind: 'public', username, slug }
    }

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
      // Admission: check DB visibility to allow public worlds for non-owners.
      // Public worlds reachable via /ws/<id> by anyone; private worlds require
      // ownership (prevents /ws/<homeWorldRowId> bypassing /home/<userId>/home auth).
      if (db) {
        const worldRow = db.database.prepare(
          'SELECT visibility FROM worlds WHERE id = ?'
        ).get(descriptor.worldRowId)
        if (worldRow && worldRow.visibility === 'public') {
          // Public world: admit anyone (including anonymous)
        } else if (host.ownerUserId && upgradeUserId !== host.ownerUserId) {
          sendHttpResponse(socket, 404, 'Not Found')
          return
        }
      } else {
        // No DB — fall back to owner-only check (legacy behavior)
        if (host.ownerUserId && upgradeUserId !== host.ownerUserId) {
          sendHttpResponse(socket, 404, 'Not Found')
          return
        }
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

    // ── Public world (/public/<username>/<slug> or /worlds/<username>/<slug>) ──
    if (descriptor.kind === 'public') {
      // 1. Resolve username → userId (case-insensitive, COLLATE NOCASE)
      let userRow
      try {
        userRow = db.database.prepare(
          'SELECT id FROM users WHERE username = ? COLLATE NOCASE'
        ).get(descriptor.username)
      } catch {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      if (!userRow) {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      // 2. Look up world by (owner_user_id, slug)
      let row
      try {
        row = db.database.prepare(
          'SELECT id, owner_user_id, document, visibility FROM worlds WHERE owner_user_id = ? AND slug = ?'
        ).get(userRow.id, descriptor.slug)
      } catch {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      if (!row) {
        sendHttpResponse(socket, 404, 'Not Found')
        return
      }

      // 3. Admission: visibility + ownership check
      let upgradeUserId = null
      try { upgradeUserId = resolveWsUserId(request, db) } catch { upgradeUserId = null }

      if (row.visibility === 'private') {
        // Private world: only the owner may connect via /public/ or /worlds/ path
        if (!upgradeUserId || upgradeUserId !== row.owner_user_id) {
          sendHttpResponse(socket, 404, 'Not Found')
          return
        }
      }
      // Public world: admit anyone (including anonymous/unauthenticated)

      // 4. Host key is row UUID, same /ws/<id> space
      const hostId = row.id

      // 5. Lazy create host on first join (with concurrency guard)
      const doUpgrade = () => {
        const host = hosts.get(hostId)
        if (!host) {
          sendHttpResponse(socket, 404, 'World Not Found')
          return
        }
        // TOCTOU re-check: re-fetch row to verify visibility hasn't changed
        // between the initial admission check and now (owner could flip
        // public↔private while we were creating the host).
        if (db) {
          const currentRow = db.database.prepare(
            'SELECT visibility FROM worlds WHERE id = ?'
          ).get(hostId)
          if (currentRow && currentRow.visibility === 'private') {
            if (!upgradeUserId || upgradeUserId !== row.owner_user_id) {
              sendHttpResponse(socket, 404, 'Not Found')
              return
            }
          }
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
        pendingCreations.get(hostId).then(doUpgrade, doUpgrade)
        return
      }

      const createPromise = (async () => {
        try {
          const host = await registerWorldFromDocument(row)
          return host
        } catch (err) {
          console.error(`[world-registry] Failed to register public world ${hostId}:`, err.message)
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
  // resolveWsUserId — imported from http-routes.js (shared to avoid duplication
  // with session.js)
  // ---------------------------------------------------------------------------

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

    // Flush-and-save before teardown (immediate, no debounce reliance)
    // Must complete before host.close() to avoid persistence/teardown race
    await coordinator.flushAndTeardown(worldId, host)

    host.close()
    coordinator.stop(worldId)
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
      onSaveableMutation: () => coordinator.markDirty(worldId, host),
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
    console.log(`[world-registry] World loaded from document: "${worldId}" — ${nodeCount} nodes`)

    const host = createWorldHost({
      id: worldId,
      world,
      db,
      ownerUserId: worldRow.owner_user_id,
      onSessionRemoved: (session) => onSessionRemoved(worldId, session),
      onSaveableMutation: () => coordinator.markDirty(worldId, host),
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
    coordinator.close()

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
