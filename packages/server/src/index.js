// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { readFile } from 'node:fs/promises'
import { resolve as resolvePath, dirname } from 'node:path'
import { createServer } from 'node:http'
import { createWorld } from './world.js'
import { createSessionServer } from './session.js'
import { createRequestHandler } from './http-routes.js'
import { createDb } from './db.js'
import * as auth from './auth.js'

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
// Startup: parse WORLD_PATH (may be a .atrium.json config or a direct glTF)
// ---------------------------------------------------------------------------

let worldPath  = process.env.WORLD_PATH ?? './space.gltf'
let port       = process.env.PORT ? parseInt(process.env.PORT, 10) : null
let worldBaseUrl = undefined  // only set when .atrium.json provides world.baseUrl

if (worldPath.endsWith('.json')) {
  const absConfigPath = resolvePath(worldPath)
  const configText    = await readFile(absConfigPath, 'utf8')
  const config        = JSON.parse(configText)

  if (config.world?.gltf) {
    worldPath = resolvePath(dirname(absConfigPath), config.world.gltf)
  }

  // PORT env var wins; only fall back to world.server when PORT is not set
  if (port === null && config.world?.server) {
    port = extractPort(config.world.server)
  }

  if (config.world?.baseUrl) {
    worldBaseUrl = config.world.baseUrl
  }
}

// Final port fallback to default
port ??= 3000

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

const world = await createWorld(worldPath, { baseUrl: worldBaseUrl })

await world.resolveExternalReferences()

const nodeCount = world.listNodeNames().length
console.log(`Atrium world loaded: ${world.meta.name ?? 'unnamed'} (${nodeCount} nodes)`)

// ---------------------------------------------------------------------------
// Database (migrations run before the server accepts connections)
// ---------------------------------------------------------------------------

const dbPath = process.env.ATRIUM_DB_PATH
const db = createDb(dbPath)
console.log(`Atrium database: ${dbPath || '(default)'}`)

// ---------------------------------------------------------------------------
// HTTP server with route dispatch (plain Node http — no Express)
// ---------------------------------------------------------------------------

// Mutable reference for live session state. The sessions Map is populated
// after the HTTP server is created (see below), so we thread a container
// through and populate it after createSessionServer runs.
const sessionsRef = { current: null }

const httpServer = createServer(createRequestHandler({ db, auth, world, sessionsRef }))

// ---------------------------------------------------------------------------
// Session server (WebSocket upgrade on the same port)
// ---------------------------------------------------------------------------

const { sessions } = createSessionServer({ httpServer, world, db })
// Wire up the live session Map after it exists so save handlers
// can read avatar node names at request time
sessionsRef.current = sessions
httpServer.listen(port)
console.log(`Atrium server listening on http://localhost:${port} (HTTP + WebSocket)`)
