// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validate } from '@atrium/protocol'
import { createTickLoop } from './tick.js'
import { createPresence } from './presence.js'
import { isOriginAllowed } from './http-routes.js'

const MIN_TICK_INTERVAL = 50
const DEFAULT_TICK_INTERVAL = 1000
const KEEPALIVE_INTERVAL = 30_000

let serverSeq = 0

function nextSeq() {
  return ++serverSeq
}

function sendError(ws, seq, code, message) {
  ws.send(JSON.stringify({ type: 'error', code, message, ...(seq != null ? { seq } : {}) }))
}

// Compute a quaternion that rotates the glTF default forward [0,0,-1] to `look`.
function lookToQuaternion(look) {
  const [lx, ly, lz] = look
  const dot = -lz  // dot([0,0,-1], look) = -lz
  if (dot < -0.9999) return [0, 1, 0, 0]   // 180° around Y
  // cross([0,0,-1], look)
  const cx =  ly
  const cy = -lx
  const cz =  0
  const qw = 1 + dot
  const len = Math.sqrt(cx*cx + cy*cy + cz*cz + qw*qw)
  return [cx/len, cy/len, cz/len, qw/len]
}

export function createSessionServer({ httpServer, maxUsers = 100, world = null, db = null } = {}) {
  if (!httpServer) {
    throw new Error('createSessionServer requires httpServer option')
  }

  const sessions = new Map()
  const presence = createPresence()

  // Attach the WebSocket server to the provided HTTP server using noServer: true
  // and an explicit upgrade handler. This establishes the seam for later cookie
  // and Origin validation at upgrade time.
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request, socket, head) => {
    // Only handle WebSocket upgrade requests
    const upgrade = request.headers['upgrade']
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      socket.destroy()
      return
    }

    // Validate Origin header to prevent cross-origin WebSocket hijacking
    if (!isOriginAllowed(request)) {
      socket.destroy()
      return
    }

    // Resolve userId from auth session cookie before the WebSocket handshake.
    let upgradeUserId = null
    if (db) {
      try {
        upgradeUserId = resolveWsUserId(request, db)
      } catch {
        // If resolution fails for any reason, treat as anonymous
        upgradeUserId = null
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, upgradeUserId)
    })
  })

  function broadcast(message) {
    const raw = JSON.stringify(message)
    for (const s of sessions.values()) {
      if (s.ws.readyState === 1 /* OPEN */) {
        s.ws.send(raw)
      }
    }
  }

  function broadcastExcept(excludeSession, message) {
    const raw = JSON.stringify(message)
    for (const [, s] of sessions) {
      if (s !== excludeSession && s.ws.readyState === 1 /* OPEN */) {
        s.ws.send(raw)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // cleanupSession — stop tick loop, drop from sessions/presence, remove
  // avatar node from SOM, broadcast remove + leave. Idempotent: a second
  // call on an already-cleaned session is a no-op (presence.remove returns
  // null when the session is already gone). Called from both the close
  // handler (natural disconnect) and the hello-path eviction code.
  // ---------------------------------------------------------------------------
  function cleanupSession(s) {
    const departedId = s.id
    const avatarNodeName = s.avatarNodeName
    s.tickStop?.()
    sessions.delete(departedId)
    const removed = presence.remove(departedId)

    if (removed) {
      // Remove avatar node from SOM and notify all clients first,
      // THEN broadcast leave so clients can look up peer metadata before cleanup
      if (world && avatarNodeName) {
        world.removeNode(avatarNodeName)
        broadcast({ type: 'remove', seq: nextSeq(), id: departedId })
      }

      const leaveMsg = { type: 'leave', seq: nextSeq(), id: departedId }
      const { valid } = validate('server', leaveMsg)
      if (valid) {
        broadcast(leaveMsg)
      } else {
        console.error('leave validation failed')
      }
    }
  }

  wss.on('connection', (ws, req, upgradeUserId = null) => {
    let session = null

    ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        sendError(ws, null, 'UNKNOWN_MESSAGE', 'Invalid JSON')
        return
      }

      const { valid, errors } = validate('client', msg)
      if (!valid) {
        const detail = errors[0]?.message ?? 'Validation failed'
        sendError(ws, msg.seq ?? null, 'UNKNOWN_MESSAGE', detail)
        return
      }

      if (!session && msg.type !== 'hello') {
        sendError(ws, msg.seq ?? null, 'AUTH_FAILED', 'Handshake required')
        return
      }

      switch (msg.type) {
        case 'hello': {
          if (sessions.size >= maxUsers) {
            sendError(ws, null, 'WORLD_FULL', 'Server is full')
            ws.close()
            return
          }

          const clientInterval = msg.capabilities?.tick?.interval ?? DEFAULT_TICK_INTERVAL
          const negotiated = Math.max(clientInterval, MIN_TICK_INTERVAL)
          const sessionId = msg.id ?? randomUUID()

          // Reject duplicate live sessionId — two connections must not share one
          if (sessions.has(sessionId)) {
            sendError(ws, null, 'SESSION_CONFLICT', `Session ${sessionId} is already connected`)
            ws.close()
            return
          }

          let userDisplayName = `User-${sessionId.slice(0, 4)}`

          // When the user is authenticated, use their real display_name
          // (from the users table) instead of the anonymous fallback.
          // This makes the real name visible to peers and the HUD.
          if (upgradeUserId && db) {
            try {
              const userRow = db.database.prepare(
                'SELECT display_name FROM users WHERE id = ?'
              ).get(upgradeUserId)
              if (userRow && userRow.display_name) {
                userDisplayName = userRow.display_name
              }
            } catch {
              // If the lookup fails, stick with the anonymous fallback
            }
          }

          // Evict any stale session for the same authenticated user.
          // Only fires when upgradeUserId is non-null — anonymous sessions
          // have no persistent identity to dedupe against.
          if (upgradeUserId) {
            for (const [oldId, oldSession] of sessions) {
              if (oldSession.userId === upgradeUserId) {
                cleanupSession(oldSession)
                oldSession.ws.close()
                break
              }
            }
          }

          session = {
            ws,
            id: sessionId,
            userId: null, // populated at upgrade time via cookie resolution
            capabilities: msg.capabilities ?? {},
            seq: nextSeq(),
            missedPings: 0,
            tickStop: null,
            avatarNodeName: `avatar-${sessionId.slice(0, 8)}`,
            displayName: userDisplayName,
          }
          // If the upgrade handler resolved a userId from the auth cookie,
          // attach it now (before the connection is fully established,
          // so auth state is available throughout the session lifecycle)
          if (upgradeUserId) {
            session.userId = upgradeUserId
          }
          sessions.set(session.id, session)

          ws.send(JSON.stringify({
            type: 'hello',
            id: session.id,
            seq: session.seq,
            serverTime: Date.now(),
            avatarNodeName: session.avatarNodeName,
            capabilities: {
              tick: { interval: negotiated, minInterval: MIN_TICK_INTERVAL },
            },
          }))

          session.tickStop = createTickLoop(session, negotiated).stop

          // Step 1: notify existing clients of the newcomer (default position)
          const joinNewcomer = {
            type: 'join',
            seq: nextSeq(),
            id: session.id,
            position: [0, 0, 0],
            avatar: {
              nodeName: session.avatarNodeName,
              displayName: session.displayName,
            },
          }
          const { valid: jv1 } = validate('server', joinNewcomer)
          if (jv1) {
            const rawJoin = JSON.stringify(joinNewcomer)
            for (const [sid, s] of sessions) {
              if (sid !== session.id && s.ws.readyState === 1 /* OPEN */) {
                s.ws.send(rawJoin)
              }
            }
          } else {
            console.error('join validation failed for newcomer broadcast')
          }

          // Step 2: bootstrap the newcomer with each existing client's current position
          for (const entry of presence.list()) {
            const existingSession = sessions.get(entry.id)
            const joinExisting = {
              type: 'join',
              seq: nextSeq(),
              id: entry.id,
              position: entry.position,
              ...(existingSession ? {
                avatar: {
                  nodeName: existingSession.avatarNodeName,
                  displayName: existingSession.displayName,
                },
              } : {}),
            }
            const { valid: jv2 } = validate('server', joinExisting)
            if (jv2) {
              session.ws.send(JSON.stringify(joinExisting))
            } else {
              console.error('join validation failed for bootstrap')
            }
          }

          // Step 3: add newcomer to presence
          presence.add(session.id)

          // Send full SOM dump to the joining client
          // Placed at end so all synchronous bookkeeping (join broadcasts,
          // presence registration) completes before the await — prevents a
          // concurrent hello from observing this session as "half-registered"
          // while serialize() is in flight.
          if (world) {
            try {
              const gltf = await world.serialize()
              if (session && session.ws.readyState === 1 /* OPEN */) {
                session.ws.send(JSON.stringify({ type: 'som-dump', seq: nextSeq(), gltf }))
              }
            } catch (err) {
              console.error('som-dump serialize failed:', err)
            }
          }
          break
        }

        case 'ping': {
          ws.send(JSON.stringify({
            type: 'pong',
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          }))
          break
        }

        case 'send': {
          if (!world) {
            sendError(ws, msg.seq, 'UNKNOWN_MESSAGE', 'World not loaded')
            break
          }
          const result = world.setField(msg.node, msg.field, msg.value)
          if (!result.ok) {
            sendError(ws, msg.seq, result.code, `${result.code}: ${msg.node}`)
            break
          }
          broadcast({
            type: 'set',
            seq: nextSeq(),
            node: msg.node,
            field: msg.field,
            value: msg.value,
            serverTime: Date.now(),
            session: session.id,
          })
          break
        }

        case 'add': {
          if (!world) {
            sendError(ws, msg.seq, 'UNKNOWN_MESSAGE', 'World not loaded')
            break
          }

          // If msg.id is provided, validate it matches the sender's session
          // (prevents impersonation — another client cannot add an avatar
          // claiming to be a different session)
          if (msg.id && msg.id !== session.id) {
            sendError(ws, msg.seq, 'PERMISSION_DENIED', `msg.id "${msg.id}" does not match session "${session.id}"`)
            break
          }

          // If this is an avatar add (has msg.id), validate the node name
          // matches the server-assigned avatarNodeName
          if (msg.id && msg.node.name !== session.avatarNodeName) {
            sendError(ws, msg.seq, 'PERMISSION_DENIED', `node.name "${msg.node.name}" does not match assigned avatarNodeName "${session.avatarNodeName}"`)
            break
          }

          const result = world.addNode(msg.node, msg.parent)
          if (!result.ok) {
            sendError(ws, msg.seq, result.code, `${result.code}: ${msg.parent}`)
            break
          }
          // avatar node name is already assigned at hello — never clobber from client input
          // For avatar adds, stamp server session id onto rebroadcast
          broadcastExcept(session, {
            type: 'add',
            seq: nextSeq(),
            format: msg.format ?? 'gltf',
            ...(msg.id ? { id: session.id } : {}),
            ...(msg.parent != null ? { parent: msg.parent } : {}),
            node: msg.node,
          })
          break
        }

        case 'view': {
          presence.setPosition(session.id, msg.position)

          // Update avatar SOM node with latest position and orientation
          if (world && session.avatarNodeName) {
            const avatarNode = world.getNode(session.avatarNodeName)
            if (avatarNode) {
              avatarNode.translation = msg.position
              if (msg.look) avatarNode.rotation = lookToQuaternion(msg.look)
            }
          }

          const outbound = {
            type: 'view',
            id: session.id,
            position: msg.position,
            ...(msg.look               && { look: msg.look }),
            ...(msg.move               && { move: msg.move }),
            ...(msg.velocity !== undefined && { velocity: msg.velocity }),
            ...(msg.up                 && { up: msg.up }),
          }
          const { valid: vv } = validate('server', outbound)
          if (vv) {
            broadcastExcept(session, outbound)
          } else {
            console.error('view validation failed')
          }
          break
        }

        case 'remove': {
          if (!world) {
            sendError(ws, msg.seq, 'UNKNOWN_MESSAGE', 'World not loaded')
            break
          }
          const result = world.removeNode(msg.node)
          if (!result.ok) {
            sendError(ws, msg.seq, result.code, `${result.code}: ${msg.node}`)
            break
          }
          broadcastExcept(session, {
            type: 'remove',
            seq: nextSeq(),
            node: msg.node,
          })
          break
        }

        default:
          sendError(ws, msg.seq ?? null, 'UNKNOWN_MESSAGE', `Unhandled message type: ${msg.type}`)
      }
    })

    ws.on('close', () => {
      if (session) {
        cleanupSession(session)
        session = null
      }
    })

    ws.on('pong', () => {
      if (session) session.missedPings = 0
    })
  })

  const keepaliveTimer = setInterval(() => {
    for (const [id, s] of sessions) {
      if (s.missedPings >= 2) {
        s.ws.terminate()
        sessions.delete(id)
      } else {
        s.missedPings = (s.missedPings ?? 0) + 1
        s.ws.ping()
      }
    }
  }, KEEPALIVE_INTERVAL)

  wss.on('close', () => {
    clearInterval(keepaliveTimer)
  })

  function close() {
    // Terminate all live WebSocket connections first, so the HTTP server
    // does not hang waiting for them.
    for (const [, s] of sessions) {
      s.ws.terminate()
      s.tickStop?.()
    }
    sessions.clear()

    // Stop the keepalive interval (it references sessions, now cleared)
    clearInterval(keepaliveTimer)

    // Close the WebSocket server (stops accepting upgrades)
    wss.close()

    // Close the HTTP server if we own one (or one was provided)
    if (httpServer) {
      httpServer.close()
    }
  }

  return { wss, sessions, presence, httpServer, close }
}

// ---------------------------------------------------------------------------
// WebSocket upgrade cookie resolution
// ---------------------------------------------------------------------------

/**
 * Parse the atrium_auth_session cookie from a raw request and resolve it
 * to a userId. Returns null if the cookie is missing, expired, or unknown.
 * This is a standalone copy of the logic in http-routes.js to avoid
 * circular dependencies.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ database: import('better-sqlite3').Database }} db
 * @returns {string|null}
 */
function resolveWsUserId(req, db) {
  const raw = req.headers['cookie']
  if (!raw) return null

  // Parse cookie
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

  // Look up session in DB
  const row = db.database.prepare(
    'SELECT user_id, expires_at FROM auth_sessions WHERE id = ?'
  ).get(authSessionId)

  if (!row) return null

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) <= new Date()) {
    try {
      db.database.prepare('DELETE FROM auth_sessions WHERE id = ?').run(authSessionId)
    } catch {
      // Swallow cleanup errors
    }
    return null
  }

  return row.user_id
}
