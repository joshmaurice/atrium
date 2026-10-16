// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validate } from '@atrium/protocol'
import { createTickLoop } from './tick.js'
import { createPresence } from './presence.js'
import { resolveUpgradeUserId } from './http-routes.js'
import { parsePath } from '@atrium/som'
import { authorizeSend, resolveSendTarget, liveAvatarNames } from './send-policy.js'

const MIN_TICK_INTERVAL = 50
const DEFAULT_TICK_INTERVAL = 1000
const KEEPALIVE_INTERVAL = 30_000

// L9/K7 — the WebSocket payload cap. `ws` closes a connection that exceeds it
// with 1009, before the message is parsed or ingested. The largest legitimate
// client message today is an avatar or teleporter `add` of a few KB.
const MAX_PAYLOAD_BYTES = 1048576

let serverSeq = 0

function nextSeq() {
  return ++serverSeq
}

function sendError(ws, seq, code, message) {
  ws.send(JSON.stringify({ type: 'error', code, message, ...(seq != null ? { seq } : {}) }))
}

/**
 * True when any node in `somNode`'s subtree is a live avatar node (A4).
 * Defence in depth once the `add`-under-avatar rule exists.
 */
function subtreeHasLiveAvatar(somNode, avatarNames) {
  if (!somNode) return false
  if (avatarNames.has(somNode.name)) return true
  for (const child of somNode.children) {
    if (subtreeHasLiveAvatar(child, avatarNames)) return true
  }
  return false
}

/**
 * True when `parentName` is, or has an ancestor that is, a live avatar node or
 * an externally loaded node (A4, non-avatar adds). The ancestor walk is cheap
 * and defence in depth: after the avatar-`add` rule nothing can be under an
 * avatar.
 */
function isBlockedParent(parentName, world, avatarNames) {
  let node = world.som.getNodeByName(parentName)
  while (node) {
    if (avatarNames.has(node.name)) return true
    if (world.externalNodeNames.has(node.name)) return true
    node = node.parent
  }
  return false
}

// ---------------------------------------------------------------------------
// S2 source guards — no client may set extras.atrium.source, in any world
// (owner included, avatars included). These are pure predicates so they can be
// unit-tested; the add/send cases below call exactly these functions.
//
// extras.atrium.source names a glTF file to load into a node. The server used
// to fetch these URLs for document worlds (request forgery / memory DoS); S1
// removed that fetch and S2+these guards stop new ones being planted. The
// field is reserved for operator-controlled file worlds.
// ---------------------------------------------------------------------------

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
const isNonNullObject = (v) => typeof v === 'object' && v !== null

/**
 * True if an `add` descriptor carries extras.atrium.source as an own property
 * (any value, including null — a null value is still a set attempt).
 *
 * @param {{extras?: {atrium?: object}}} node
 * @returns {boolean}
 */
export function addSetsAtriumSource(node) {
  const atrium = node?.extras?.atrium
  if (!isNonNullObject(atrium)) return false
  return hasOwn(atrium, 'source')
}

/**
 * True if a `send` of (field, value) would write extras.atrium.source.
 *
 * Works on parsed path segments (the same parsePath that setPath uses, which
 * ignores leading/extra dots and allows walking through parent/children[n]/
 * scene), and looks for the protected shape at ANY depth, not just at the
 * start. Segment comparison, so extras.atrium.sourceCount is allowed.
 *
 *   1. direct write: <...>.extras.atrium.source (or anything beneath it);
 *   2. whole-object write of <...>.extras.atrium whose value has own source;
 *   3. whole-object write of <...>.extras whose value.atrium has own source.
 *
 * @param {string} field
 * @param {*} value
 * @returns {boolean}
 */
export function sendSetsAtriumSource(field, value) {
  let segments
  try {
    segments = parsePath(field)
  } catch {
    // Unparseable path — setPath will reject it, nothing can be written.
    return false
  }

  for (let i = 0; i < segments.length; i++) {
    if (segments[i] !== 'extras') continue

    // 1. Direct write to source, or anything beneath it.
    if (segments[i + 1] === 'atrium' && segments[i + 2] === 'source') return true

    // 2. Replacing the extras.atrium object itself (extras is second-to-last).
    if (i === segments.length - 2 && segments[i + 1] === 'atrium' &&
        isNonNullObject(value) && hasOwn(value, 'source')) {
      return true
    }

    // 3. Replacing the extras object itself (extras is the last segment).
    if (i === segments.length - 1 && isNonNullObject(value) &&
        isNonNullObject(value.atrium) && hasOwn(value.atrium, 'source')) {
      return true
    }
  }

  return false
}

// Compute a quaternion that rotates the glTF default forward [0,0,-1] to `look`.
function lookToQuaternion(look) {
  const [lx, ly, lz] = look
  const dot = -lz  // dot([0,0,-1], look) = -lz
  if (dot < -0.9999) return [0, 1, 0, 0]   // 180 around Y
  // cross([0,0,-1], look)
  const cx =  ly
  const cy = -lx
  const cz =  0
  const qw = 1 + dot
  const len = Math.sqrt(cx*cx + cy*cy + cz*cz + qw*qw)
  return [cx/len, cy/len, cz/len, qw/len]
}

// ---------------------------------------------------------------------------
// createSessionServer — full lifecycle for a single world (existing API,
// backward compatible). Creates wss, registers upgrade handler on httpServer,
// sets up connection handlers, keepalive timer.
// ---------------------------------------------------------------------------

export function createSessionServer({ httpServer, maxUsers = 100, world = null, db = null, keepaliveInterval = KEEPALIVE_INTERVAL } = {}) {
  if (!httpServer) {
    throw new Error('createSessionServer requires httpServer option')
  }

  const sessions = new Map()
  const presence = createPresence()

  // Attach the WebSocket server to the provided HTTP server using noServer: true
  // and an explicit upgrade handler. This establishes the seam for later cookie
  // and Origin validation at upgrade time.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES })

  httpServer.on('upgrade', (request, socket, head) => {
    // Only handle WebSocket upgrade requests
    const upgrade = request.headers['upgrade']
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      socket.destroy()
      return
    }

    // Cross-origin WebSocket connections are admitted anonymously (pre-brief #2).
    // resolveUpgradeUserId returns the cookie's user only when the upgrade
    // is same-origin. Cross-origin upgrades always arrive anonymous.
    // CSRF protection for HTTP routes remains in http-routes.js.
    // See decision #2 in the cross-server connect brief.

    // Resolve userId from auth session cookie before the WebSocket handshake.
    let upgradeUserId = null
    if (db) {
      try {
        upgradeUserId = resolveUpgradeUserId(request, db)
      } catch {
        // If resolution fails for any reason, treat as anonymous
        upgradeUserId = null
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, upgradeUserId)
    })
  })

  // Wire up connection handlers
  const { closeKeepalive, evictNonOwners } = attachSessionHandlers({
    wss,
    world,
    db,
    sessions,
    presence,
    maxUsers,
    worldOwnerUserId: null,
    keepaliveInterval,
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
    closeKeepalive()

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
// attachSessionHandlers — wire up wss.on('connection'), keepalive timer, and
// returns a closeKeepalive function. This is what WorldHost calls instead of
// createSessionServer (which also registers an httpServer upgrade handler).
//
// worldOwnerUserId: the userId that owns the world for mutation gate purposes.
//   null means "no owner for the default world" — backward compat mode where
//   ALL mutations (not just avatar adds) are permitted.
// ---------------------------------------------------------------------------

export function attachSessionHandlers({
  wss,
  world = null,
  db = null,
  sessions = new Map(),
  presence = createPresence(),
  maxUsers = 100,
  worldOwnerUserId = null,
  mutationPolicy,
  onSessionRemoved = null,
  onSaveableMutation = null,
  keepaliveInterval = KEEPALIVE_INTERVAL,
  onPreHelloClosed = null,
} = {}) {

  // Track pre-hello connections by WebSocket instance so eviction (V5)
  // can disconnect sockets that haven't sent hello yet.
  const preHelloSockets = new Map()  // ws -> upgradeUserId | null

  // ---------------------------------------------------------------------------
  // evictNonOwners — disconnect every connection (session or pre-hello) whose
  // userId does not match the given ownerUserId. Sends WORLD_NOW_PRIVATE error
  // and closes with 1008. Used when a world is switched to private (V5).
  // ---------------------------------------------------------------------------
  const doEvictNonOwners = function evictNonOwners(ownerUserId) {
    const evictMsg = JSON.stringify({
      type: 'error',
      code: 'WORLD_NOW_PRIVATE',
      message: 'This world is now private',
    })

    // Evict full sessions
    for (const [, s] of sessions) {
      if (s.ws.readyState === 1 /* OPEN */ && s.userId !== ownerUserId) {
        s.ws.send(evictMsg)
        s.ws.close(1008)
      }
    }

    // Evict pre-hello sockets
    for (const [ws, uid] of preHelloSockets) {
      if (ws.readyState === 1 /* OPEN */ && uid !== ownerUserId) {
        ws.send(evictMsg)
        ws.close(1008)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // broadcast
  // ---------------------------------------------------------------------------

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
  // L11/K9 — allocate a unique avatar node name at `hello` (H15).
  //
  // Keep `avatar-<first 8 of the session id>` when that name is free;
  // otherwise append `-2`, `-3`, … until it is. Free means: no live session
  // holds the name, and no object in the world's namespace (`_objectsByName`
  // or `_nodesByName`) has it. Clients already read the name from
  // `hello.avatarNodeName`, so a visitor whose random id collides with
  // another visitor or a permanent node is not refused.
  // ---------------------------------------------------------------------------
  function allocateAvatarName(sessionId) {
    const base = `avatar-${sessionId.slice(0, 8)}`
    const isFree = (name) => {
      for (const [, s] of sessions) {
        if (s.avatarNodeName === name) return false
      }
      if (world) {
        if (world.som.getObjectByName(name)) return false
        if (world.som.getNodeByName(name)) return false
      }
      return true
    }
    if (isFree(base)) return base
    let n = 2
    while (!isFree(`${base}-${n}`)) n += 1
    return `${base}-${n}`
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
    const avatarNode = s.avatarNode
    s.tickStop?.()
    sessions.delete(departedId)
    const removed = presence.remove(departedId)

    if (removed) {
      // L11/K9 — remove only the node this session's accepted avatar `add`
      // created, by IDENTITY, never a lookup by name. A session whose avatar
      // add was refused owns nothing: its disconnect removes nothing and
      // broadcasts no `remove` (only the `leave` below).
      if (world && avatarNode) {
        world.removeNode(avatarNode)
        broadcast({ type: 'remove', seq: nextSeq(), id: departedId })
      }

      const leaveMsg = { type: 'leave', seq: nextSeq(), id: departedId }
      const { valid } = validate('server', leaveMsg)
      if (valid) {
        broadcast(leaveMsg)
      } else {
        console.error('leave validation failed')
      }

      // Notify the world registry for teardown refcounting
      if (typeof onSessionRemoved === 'function') {
        onSessionRemoved(departedId)
      }
    }
  }

  // Resolve mutation policy default if not explicitly provided.
  // 'open' = legacy behavior (null owner = everyone can mutate).
  // 'owner' = only the worldOwnerUserId may mutate.
  // 'read-only' = nobody may mutate (used for degraded commons boot).
  const resolvedPolicy = mutationPolicy ?? (worldOwnerUserId !== null ? 'owner' : 'open')

  // ---------------------------------------------------------------------------
  // Mutation gate — returns true if the session may mutate the world.
  // Avatar adds are always allowed (session-owned, ephemeral, session-coupled).
  // Read-only policy is checked BEFORE the null-owner shortcut (§4B-3).
  // When resolvedPolicy is 'open' (null owner / legacy backward compat), all
  // mutations are permitted — no gate.
  // When resolvedPolicy is 'owner', the session.userId must match the world's owner.
  // ---------------------------------------------------------------------------
  function isMutator(session, isAvatar) {
    if (isAvatar) return true
    if (resolvedPolicy === 'read-only') return false
    if (resolvedPolicy === 'open') return true
    return session.userId === worldOwnerUserId
  }

  wss.on('connection', (ws, req, upgradeUserId = null) => {
    let session = null

    // Log WS errors without rethrowing (pre-brief security: prevent
    // uncaught WS_ERR_EXPECTED_MASK from killing the server)
    ws.on('error', (err) => {
      console.error(`[session] connection error: ${err.message}`)
    })

    // Track pre-hello connection for eviction (V5)
    preHelloSockets.set(ws, upgradeUserId)

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

          // The server never adopts a client-sent displayName (pre-brief #9).
          // The session name is always the DB display_name for an authenticated
          // session, or User-xxxx for anonymous/cross-origin visitors.
          // A client-displayed name is a request, never a claim.

          // When the user is authenticated, use their real display_name
          // (from the users table).
          if (upgradeUserId && db) {
            try {
              const userRow = db.database.prepare(
                'SELECT display_name FROM users WHERE id = ?'
              ).get(upgradeUserId)
              if (userRow && userRow.display_name) {
                userDisplayName = userRow.display_name
              }
            } catch {
              // If the lookup fails, stick with the client-supplied or anonymous fallback
            }
          }

          session = {
            ws,
            id: sessionId,
            userId: null,
            capabilities: msg.capabilities ?? {},
            seq: nextSeq(),
            missedPings: 0,
            tickStop: null,
            // L11/K9 — the hello-allocated name; the avatar node itself is
            // recorded in `avatarNode` only when the avatar `add` is accepted.
            avatarNodeName: allocateAvatarName(sessionId),
            avatarNode: null,
            displayName: userDisplayName,
          }
          // If the upgrade handler resolved a userId from the auth cookie,
          // attach it now (before the connection is fully established,
          // so auth state is available throughout the session lifecycle)
          if (upgradeUserId) {
            session.userId = upgradeUserId
          }
          sessions.set(session.id, session)

          // Pre-hello tracking: hello is complete, clean up
          preHelloSockets.delete(ws)

          // Compute canPlaceTeleporters at hello time (T2). A1: `canEdit` is
          // the same computation; the old name stays as an alias with the same
          // value for one release.
          const canEdit = session.userId !== null &&
            session.userId === worldOwnerUserId &&
            isMutator(session, false)
          const canPlaceTeleporters = canEdit

          ws.send(JSON.stringify({
            type: 'hello',
            id: session.id,
            seq: session.seq,
            serverTime: Date.now(),
            avatarNodeName: session.avatarNodeName,
            displayName: session.displayName,
            canPlaceTeleporters,
            canEdit,
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
                // Emit world-done after som-dump to signal load completion
                // (pre-brief decision: loader tasks critical with world-done:som-dump)
                session.ws.send(JSON.stringify({ type: 'world-done', seq: nextSeq() }))
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

          // --- AVATAR DISPLAYNAME GUARD (pre-brief #9) ---
          // The server is authoritative over session display names.
          // Reject set when the target node is a live avatar node and
          // the field is extras.displayName or extras (replacing whole).
          // This runs before the mutation gate and applies to everyone,
          // including the world owner.
          // L11 note: this guard protects the server-assigned NAME reserved by
          // a live session (whether or not its avatar `add` has been accepted
          // yet). Node-level protection of a live avatar uses the avatarNode
          // identity, via liveAvatarNames() below.
          const isAvatarNode = msg.node && Array.from(sessions.values()).some(
            s => s.avatarNodeName === msg.node
          )
          if (isAvatarNode && msg.field) {
            let segments
            try {
              segments = parsePath(msg.field)
            } catch {
              // Unparseable path — let the mutation gate decide
            }
            if (segments && segments.length > 0 &&
                (segments[0] === 'extras') &&
                (segments.length === 1 || (segments.length >= 2 && segments[1] === 'displayName'))) {
              sendError(ws, msg.seq, 'PERMISSION_DENIED', 'Avatar display name is server-assigned and cannot be changed')
              break
            }
          }

          // --- SOURCE GUARD (S2): no client may set extras.atrium.source ---
          // Runs after the avatar display-name guard and before the mutation
          // gate, so it applies to the world owner too. Nothing is applied,
          // broadcast or saved when it refuses.
          if (sendSetsAtriumSource(msg.field, msg.value)) {
            sendError(ws, msg.seq, 'PERMISSION_DENIED', 'extras.atrium.source cannot be set by clients')
            break
          }

          // --- MUTATION GATE: only world owner may set fields ---
          if (!isMutator(session, false)) {
            sendError(ws, msg.seq, 'PERMISSION_DENIED', 'Only the owner may mutate this message')
            break
          }

          // --- SEND FIELD ALLOWLIST (Phase 3 step 0c) ---
          // Default deny. Resolve the target the same way world.setField does,
          // then classify the RESOLVED object by its class — never by its name
          // — and allow only the exact operations that class permits
          // (pre-brief §3 A1–A5).
          //
          // Order: this runs AFTER the mutation gate, so a forbidden edit is
          // refused the same way for everyone; a non-mutator keeps the gate's
          // PERMISSION_DENIED exactly as before, and an unknown target reached
          // by a permitted session still gets NODE_NOT_FOUND. It runs BEFORE
          // world.setField, so a refusal applies nothing, broadcasts nothing
          // and triggers no save callback.
          //
          // The raw-string destination cap is gone: the 2048-character limit is
          // the A4 value check on the teleporter destination leaf, and its code
          // stays INVALID_VALUE.
          const sendTarget = resolveSendTarget(world.som, msg.node)
          const decision = authorizeSend({
            target: sendTarget,
            nodeName: msg.node,
            field: msg.field,
            value: msg.value,
            avatarNames: liveAvatarNames(sessions.values()),
            currentExtras: world.som.extras,
            externalNames: world.externalNodeNames,
          })
          if (!decision.ok) {
            sendError(ws, msg.seq, decision.code, decision.message)
            break
          }

          const result = world.setField(msg.node, msg.field, msg.value)
          if (!result.ok) {
            sendError(ws, msg.seq, result.code, result.message ?? `${result.code}: ${msg.node}`)
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
            requestSeq: msg.seq,
          })

          // Notify autosave coordinator of a saveable mutation
          if (typeof onSaveableMutation === 'function' && worldOwnerUserId !== null) {
            onSaveableMutation()
          }
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

          // --- A4: an avatar add may not carry a parent ---
          // Avatar adds skip the mutation gate, so without this check any
          // visitor could attach their avatar under a world node. Runs before
          // the gate, with the other avatar-add checks. The first-party client
          // never sends one (its avatar add has no parent).
          if (msg.id && msg.parent != null) {
            sendError(ws, msg.seq, 'PERMISSION_DENIED', 'avatar nodes cannot have a parent')
            break
          }

          // --- SOURCE GUARD (S2): no client may set extras.atrium.source ---
          // Runs before the mutation gate so it covers avatar adds (which
          // bypass the gate) and the world owner alike.
          if (addSetsAtriumSource(msg.node)) {
            sendError(ws, msg.seq, 'PERMISSION_DENIED', 'extras.atrium.source cannot be set by clients')
            break
          }

          // --- MUTATION GATE: avatar adds (has msg.id) are always allowed;
          // non-avatar adds require owner permission ---
          const isAvatar = !!msg.id
          if (!isMutator(session, isAvatar)) {
            sendError(ws, msg.seq, 'PERMISSION_DENIED', 'Only the owner may add nodes to this world')
            break
          }

          // --- A4/A5 (non-avatar adds only) ---
          // The parent must not be, or descend from, a live avatar or an
          // externally loaded node, and the new name must pass the D3 rules.
          // Runs after the gate, as 0c ended up (its §3.1).
          if (!isAvatar) {
            const liveAvatars = liveAvatarNames(sessions.values())
            if (msg.parent != null && isBlockedParent(msg.parent, world, liveAvatars)) {
              sendError(ws, msg.seq, 'PERMISSION_DENIED',
                'a node may not be added under a live avatar or an externally loaded node')
              break
            }
            const nameCheck = world.som.checkNewName(msg.node.name)
            if (!nameCheck.ok) {
              sendError(ws, msg.seq, nameCheck.code, nameCheck.message)
              break
            }
          }

          // Overwrite avatar extras.displayName with the server-assigned
          // displayName (pre-brief #9).
          if (isAvatar && session.displayName) {
            if (!msg.node.extras) msg.node.extras = {}
            msg.node.extras.displayName = session.displayName
          }

          // --- DESTINATION LENGTH CAP (T10) ---
          // Enforce 2048-char limit on extras.atrium.teleporter.destination.
          // C4 — this add-path check is unchanged in 1a: the D8 message split
          // for a non-string value applies to `send` only.
          if (!isAvatar && msg.node.extras?.atrium?.teleporter?.destination != null) {
            const dest = msg.node.extras.atrium.teleporter.destination
            if (typeof dest === 'string' && dest.length > 2048) {
              sendError(ws, msg.seq, 'INVALID_VALUE', 'destination exceeds 2048 characters')
              break
            }
          }

          const result = world.addNode(msg.node, msg.parent)
          if (!result.ok) {
            const detail = result.code === 'INVALID_VALUE'
              ? `${result.code}: node name already exists`
              : `${result.code}: ${msg.parent}`
            sendError(ws, msg.seq, result.code, detail)
            break
          }
          // L11/K9 — ownership is recorded only by an accepted avatar `add`.
          if (isAvatar) session.avatarNode = result.node
          // T3: non-avatar adds echo to sender too; avatar adds keep broadcastExcept
          if (isAvatar) {
            broadcastExcept(session, {
              type: 'add',
              seq: nextSeq(),
              format: msg.format ?? 'gltf',
              ...(msg.id ? { id: session.id } : {}),
              ...(msg.parent != null ? { parent: msg.parent } : {}),
              node: msg.node,
            })
          } else {
            broadcast({
              type: 'add',
              seq: nextSeq(),
              format: msg.format ?? 'gltf',
              ...(msg.parent != null ? { parent: msg.parent } : {}),
              node: msg.node,
              requestSeq: msg.seq,
              session: session.id,
            })
          }

          // Notify autosave coordinator for non-avatar adds (saveable mutations)
          if (typeof onSaveableMutation === 'function' && !isAvatar && worldOwnerUserId !== null) {
            onSaveableMutation()
          }
          break
        }

        case 'view': {
          presence.setPosition(session.id, msg.position)

          // L11/K9 — move only the node this session owns, by IDENTITY. A
          // session whose avatar `add` was refused owns nothing: its `view`
          // moves nothing (and never another visitor's avatar).
          if (world && session.avatarNode) {
            session.avatarNode.translation = msg.position
            if (msg.look) session.avatarNode.rotation = lookToQuaternion(msg.look)
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
          // --- MUTATION GATE: only owner may remove nodes ---
          if (!isMutator(session, false)) {
            sendError(ws, msg.seq, 'PERMISSION_DENIED', 'Only the owner may mutate nodes in this world')
            break
          }

          // --- A4: avatar and external-node protection (after the gate) ---
          // A live avatar, an externally loaded node, or a subtree holding a
          // live avatar is never removable — for everyone, the owner included.
          // An unknown node falls through to world.removeNode's NODE_NOT_FOUND.
          {
            const liveAvatars = liveAvatarNames(sessions.values())
            const targetNode = world.som.getNodeByName(msg.node)
            if (targetNode) {
              const resolvedName = targetNode.name
              if (liveAvatars.has(resolvedName)) {
                sendError(ws, msg.seq, 'PERMISSION_DENIED', 'live avatar nodes cannot be removed')
                break
              }
              if (world.externalNodeNames.has(resolvedName)) {
                sendError(ws, msg.seq, 'PERMISSION_DENIED', 'externally loaded nodes cannot be removed')
                break
              }
              if (subtreeHasLiveAvatar(targetNode, liveAvatars)) {
                sendError(ws, msg.seq, 'PERMISSION_DENIED',
                  'a subtree containing a live avatar cannot be removed')
                break
              }
            }
          }

          const result = world.removeNode(msg.node)
          if (!result.ok) {
            sendError(ws, msg.seq, result.code, `${result.code}: ${msg.node}`)
            break
          }
          broadcast({
            type: 'remove',
            seq: nextSeq(),
            node: msg.node,
            requestSeq: msg.seq,
            session: session.id,
          })

          // Notify autosave coordinator of a saveable mutation
          if (typeof onSaveableMutation === 'function' && worldOwnerUserId !== null) {
            onSaveableMutation()
          }
          break
        }

        default:
          sendError(ws, msg.seq ?? null, 'UNKNOWN_MESSAGE', `Unhandled message type: ${msg.type}`)
      }
    })

    ws.on('close', () => {
      // Clean up pre-hello tracking (V5)
      preHelloSockets.delete(ws)
      if (session) {
        cleanupSession(session)
        session = null
      } else {
        // Pre-hello socket closed without sending hello — notify registry
        onPreHelloClosed?.()
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
        cleanupSession(s)
      } else {
        s.missedPings = (s.missedPings ?? 0) + 1
        s.ws.ping()
      }
    }
  }, keepaliveInterval)

  return { closeKeepalive() {
    clearInterval(keepaliveTimer)
  }, evictNonOwners: doEvictNonOwners, getPreHelloSocketCount: () => preHelloSockets.size }
}

// ---------------------------------------------------------------------------
// WebSocket upgrade cookie resolution
// ---------------------------------------------------------------------------

/**
 * Parse the atrium_auth_session cookie from a raw request and resolve it
 * to a userId. Returns null if the cookie is missing, expired, or unknown.
 * Delegated to http-routes.js resolveWsUserId to avoid code duplication.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ database: import('better-sqlite3').Database }} db
 * @returns {string|null}
 */
// function removed — resolveWsUserId is now imported from http-routes.js