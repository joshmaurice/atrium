// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebSocketServer } from 'ws'
import { createPresence } from './presence.js'
import { attachSessionHandlers } from './session.js'

/**
 * Create a per-world host that owns its own WebSocketServer, sessions map,
 * and presence. The host's wss handles the connection semantics, but the
 * upgrade routing is done externally by a WorldRegistry so that a single
 * httpServer can route to many worlds.
 *
 * @param {object} opts
 * @param {string}          opts.id                  - Stable identifier for this world (e.g. 'default')
 * @param {object}          opts.world               - The world instance from createWorld()
 * @param {object|null}     opts.db                 - Database handle
 * @param {string|null}     opts.ownerUserId        - The userId that owns this world; null for the
 *                                                     default world (no-owner, backward compat behavior)
 * @param {function|null}   opts.onSessionRemoved   - Called with the session object when a session is
 *                                                     cleaned up. Used by the registry for refcounting.
 * @param {function|null}   opts.onSaveableMutation - Called when a saveable mutation occurs on this
 *                                                     world. Used by the autosave coordinator.
 * @returns {{ id, world, wss, sessions, presence, ownerUserId, handleUpgrade, close }}
 */
export function createWorldHost(opts = {}) {
  if (!opts.id || !opts.world) {
    throw new Error('createWorldHost requires id and world')
  }

  const {
    id,
    world,
    db = null,
    ownerUserId = null,
    onSessionRemoved = null,
    onSaveableMutation = null,
  } = opts

  const sessions = new Map()
  const presence = createPresence()
  const wss = new WebSocketServer({ noServer: true })

  // Wire up the session handlers for this host's wss
  const closeKeepalive = attachSessionHandlers({
    wss,
    world,
    db,
    sessions,
    presence,
    maxUsers: 100,
    worldOwnerUserId: ownerUserId,
    onSessionRemoved,
    onSaveableMutation,
  })

  /**
   * Route an upgraded incoming request into this host's wss.
   * Called from the registry-upgrade handler after worldId resolution.
   */
  function handleUpgrade(request, socket, head, upgradeUserId) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      // The wss.emit('connection', ...) call inside attachSessionHandlers
      // expects (ws, req, upgradeUserId). We pass the saved upgradeUserId.
      wss.emit('connection', ws, request, upgradeUserId)
    })
  }

  function close() {
    // Terminate all live WebSocket connections first
    for (const [, s] of sessions) {
      s.ws.terminate()
      s.tickStop?.()
    }
    sessions.clear()

    // Stop the keepalive interval
    closeKeepalive()

    // Close the WebSocket server
    wss.close()
  }

  return {
    id,
    world,
    wss,
    sessions,
    presence,
    ownerUserId,
    handleUpgrade,
    close,
  }
}