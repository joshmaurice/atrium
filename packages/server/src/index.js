// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { readFile } from 'node:fs/promises'
import { resolve as resolvePath, dirname } from 'node:path'
import { createServer } from 'node:http'
import { createRequestHandler } from './http-routes.js'
import { createDb } from './db.js'
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

const db = createDb(process.env.ATRIUM_DB_PATH)
console.log(`Atrium database: ${process.env.ATRIUM_DB_PATH || '(default)'}`)

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