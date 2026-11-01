// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { readFile } from 'node:fs/promises'
import { resolve as resolvePath, dirname } from 'node:path'
import { createServer } from 'node:http'
import { createRequestHandler } from './http-routes.js'
import { createDb, resolveDbPath } from './db.js'
import { acquireLock, legacyLockExists, legacyLockPathFor } from './server-lock.js'
import { createWorldRegistry } from './world-registry.js'
import * as auth from './auth.js'
import { setupCommons } from './commons.js'

// ---------------------------------------------------------------------------
// Port extraction from a WebSocket URL
// ---------------------------------------------------------------------------

function extractPort(wsUrl) {
  try {
    const parsed = new URL(wsUrl)
    return parseInt(parsed.port, 10) || 3000
  } catch {
    return 3000
  }
}

// ---------------------------------------------------------------------------
// Startup: parse WORLD_PATH
// ---------------------------------------------------------------------------

let worldPath  = process.env.WORLD_PATH ?? './space.gltf'
let port       = process.env.PORT ? parseInt(process.env.PORT, 10) : null
let worldBaseUrl = undefined

if (worldPath.endsWith('.json')) {
  const absConfigPath = resolvePath(worldPath)
  const configText    = await readFile(absConfigPath, 'utf8')
  const config        = JSON.parse(configText)

  if (config.world?.gltf) {
    worldPath = resolvePath(dirname(absConfigPath), config.world.gltf)
  }

  if (port === null && config.world?.server) {
    port = extractPort(config.world.server)
  }

  if (config.world?.baseUrl) {
    worldBaseUrl = config.world.baseUrl
  }
}

port ??= 3000

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

// R22 (as R-L8 (a)) — the server's LIFETIME lock, beside the database: a KERNEL
// lock taken through SQLite (`<canonical db>.lock.db`, `BEGIN EXCLUSIVE`) and
// held for the whole run. It is what makes "the world server is stopped"
// CHECKED by the rollback scripts rather than assumed (round 2's M2:
// `BEGIN IMMEDIATE` is an atomicity lock, not an offline check). Taken BEFORE
// the database is opened, so nothing writes to it unlocked; the OS releases it
// when this process exits, `kill -9` included.
const dbPath = resolveDbPath(process.env.ATRIUM_DB_PATH)

const lockLog = (line) => console.error(`[lock] ${line}`)

let serverLock
try {
  // R31 — the pre-R8 lock FILE diagnostic is INSIDE the guarded start. It reads
  // the canonical path too, so on a looping path it throws like the acquire
  // does; unguarded (round 5) that escaped as Node's uncaught-error trace
  // instead of the server's own refusal. Every path error now prints
  // `Atrium server refuses to start: …` and exits 1, before anything is opened.
  // Say the leftover once, so an operator who kept one knows it can go.
  if (legacyLockExists(dbPath)) {
    lockLog(`leftover ${legacyLockPathFor(dbPath)} from an earlier release is ignored; you may delete it`)
  }
  serverLock = acquireLock(dbPath, { role: 'server', log: lockLog })
} catch (error) {
  console.error(`Atrium server refuses to start: ${error.message}`)
  process.exit(1)
}

let lockReleased = false
const releaseServerLock = () => {
  if (lockReleased || !serverLock) return
  lockReleased = true
  serverLock.release()
}
// R27 — the process ends by the SIGNAL, and systemd records a clean stop. The
// SIGINT/SIGTERM handlers that called `process.exit(130)` / `process.exit(143)`
// are GONE: under R22 the OS releases the kernel lock on any exit, so all they
// did was turn a clean stop into `status=143 … Failed with result 'exit-code'`
// in the journal. The `exit` hook stays for the paths Node does run it on.
process.on('exit', releaseServerLock)

const db = createDb(dbPath)
console.log(`Atrium database: ${dbPath}`)

// ---------------------------------------------------------------------------
// HTTP server with route dispatch
// ---------------------------------------------------------------------------

const defaultHostRef = { current: null }

const httpServer = createServer(createRequestHandler({
  db,
  auth,
  defaultHostRef,
  getWorldHost: (id) => registry.getWorldHost(id),
  getRootWorldId: () => registry.getRootWorldId(),
  // signin-sync I5 — logout closes the sockets admitted with that auth session
  closeAuthSessions: (authSessionId) => registry.closeAuthSessions(authSessionId),
}))

// ---------------------------------------------------------------------------
// World registry — manages multi-world WebSocket routing and lifecycle
// ---------------------------------------------------------------------------

const registry = createWorldRegistry({ httpServer, db })

// Register the commons via setupCommons (handles owned and degraded read-only boot)
const resolvedWorldPath = resolvePath(worldPath)
const { host: defaultHost, mode } = await setupCommons({ registry, db, worldPath: resolvedWorldPath })
defaultHostRef.current = defaultHost

const nodeCount = defaultHost.world.listNodeNames().length
const worldName = defaultHost.world.meta?.name ?? 'unnamed'
console.log(`Atrium world loaded: ${worldName} (${nodeCount} nodes, mode=${mode})`)
console.log(`Atrium server listening on http://localhost:${port} (HTTP + WebSocket, multi-world ready)`)

httpServer.listen(port)

// ---------------------------------------------------------------------------
// Periodic sweep of expired auth sessions (every hour)
// ---------------------------------------------------------------------------
const sweepInterval = setInterval(() => {
  db.pruneExpiredAuthSessions()
}, 60 * 60 * 1000)
sweepInterval.unref()

export { httpServer, registry, defaultHost }