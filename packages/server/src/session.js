// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validate } from '@atrium/protocol'
import { createTickLoop } from './tick.js'
import { MAX_MESSAGE_DEPTH, messageDepth, recordMessageDepth } from './message-depth.js'
import { createPresence } from './presence.js'
import { resolveUpgradeUserId } from './http-routes.js'
import { parsePath } from '@atrium/som'
import {
  authorizeSend, resolveSendTarget, liveAvatarNames,
  checkAtriumExtras, checkTransformValues, checkModelHost,
  ANIMATION_LEAF, OBJECT_ID_TAKEN,
} from './send-policy.js'

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
 * K4/L5 — true if an avatar `add` descriptor carries an `extras.atrium` that
 * must be refused.
 *
 * The pre-brief says a first-party avatar descriptor "carries only
 * `extras.displayName` (`buildAvatarDescriptor`, `AtriumClient.connect`)".
 * That is true of `buildAvatarDescriptor` (renderer-three) but NOT of what the
 * client actually sends: `AtriumClient.connect` (~L359) injects
 * `extras.atrium.ephemeral = true` into every avatar descriptor before the
 * `add` goes out (apps/client's pointer handlers read that marker to skip
 * avatars). Refusing *any* own `extras.atrium` would therefore refuse every
 * real avatar add and break the pipeline.
 *
 * So the refusal is: any own `extras.atrium` is refused EXCEPT the exact
 * first-party marker `{ ephemeral: true }` and nothing else. That still refuses
 * `{}`, `{ behavior }`, `{ teleporter }` and every other key, exactly as the
 * K4 table and §7.1's K4 rows require.
 *
 * @param {{extras?: object}} node
 * @returns {boolean}
 */
export function addCarriesAtriumExtras(node) {
  const extras = node?.extras
  if (!isNonNullObject(extras)) return false
  if (!hasOwn(extras, 'atrium')) return false
  const atrium = extras.atrium
  if (isNonNullObject(atrium)) {
    const keys = Object.keys(atrium)
    // The one allowed shape: exactly { ephemeral: true }.
    if (keys.length === 1 && keys[0] === 'ephemeral' && atrium.ephemeral === true) return false
  }
  return true
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
  // 4b-1 E4 — the script-host role, one per world host (P7: each world host
  // calls attachSessionHandlers with its own state, so two worlds on one server
  // have independent hosts and independent generations).
  //
  // `hostGen` starts at 1 and is NOT saved: a server restart starts again at 1,
  // because every session reconnects. It ONLY EVER INCREASES — a role is never
  // reactivated under an old generation (review S2).
  // ---------------------------------------------------------------------------
  const scriptHost = { sessionId: null, hostGen: 0 }

  /** The keepalive sweep terminates a session at this many missed pings. */
  const MISSED_PING_LIMIT = 2

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

  /**
   * 4b-1 E4 — send the role to a session: set it, bump the generation, and
   * tell the session with `{ type: 'script-host', active: true, hostGen }`.
   */
  function grantScriptHost(session) {
    scriptHost.hostGen += 1
    scriptHost.sessionId = session.id
    session.ws.send(JSON.stringify({ type: 'script-host', active: true, hostGen: scriptHost.hostGen }))
  }

  /**
   * 4b-1 E4 — the handover, run AFTER the departed session has been removed, so
   * the departing session can never be chosen, and exactly once per departure.
   *
   * The role goes to the FIRST session in `sessions` order that passed `canEdit`
   * at its `hello`, has an OPEN socket, and whose `missedPings` is BELOW the
   * sweep's limit — a session the same keepalive sweep is about to terminate is
   * never chosen (review N7). With none eligible, `sessionId` stays null and the
   * next eligible `hello` takes `hostGen + 1`.
   */
  function handOverScriptHost() {
    scriptHost.sessionId = null
    for (const s of sessions.values()) {
      if (!s.canEdit) continue
      if (s.ws?.readyState !== 1 /* OPEN */) continue
      if ((s.missedPings ?? 0) >= MISSED_PING_LIMIT) continue
      grantScriptHost(s)
      return
    }
  }

  // ---------------------------------------------------------------------------
  // cleanupSession — stop tick loop, drop from sessions/presence, remove
  // avatar node from SOM, broadcast remove + leave. Idempotent: a second
  // call on an already-cleaned session is a no-op. Called from the close
  // handler (natural disconnect) and from the keepalive sweep.
  // ---------------------------------------------------------------------------
  function cleanupSession(s) {
    // 4b-1 E4 (review M2) — IDENTITY-SAFE, first thing. Only the session object
    // an id still maps to is ever removed under that id. The keepalive sweep
    // terminates a socket and cleans up at once; the socket's close handler then
    // calls this again for the same object. If a new connection took the same
    // id in between, the OLD code deleted the NEW session's entries (removed its
    // presence, broadcast `remove` and `leave` under its id, called
    // `onSessionRemoved` for it). With this check the new session survives with
    // its presence, avatar and role.
    if (sessions.get(s.id) !== s) return

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

    // 4b-1 E4 (review S-E) — the HANDOVER is keyed on the identity check above
    // (this exact session has just been removed), NEVER on whether
    // `presence.remove` returned anything: tying the role to a second map that
    // happens to be in step today would couple them. It runs outside the
    // `removed` block on purpose.
    if (scriptHost.sessionId === departedId) {
      handOverScriptHost()
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
      // Declared OUTSIDE the try below, so the catch can echo the message's
      // `seq` when a handler failure is answered.
      let msg
      try {
        try {
          msg = JSON.parse(raw)
        } catch {
          sendError(ws, null, 'UNKNOWN_MESSAGE', 'Invalid JSON')
          return
        }

        // ---------------------------------------------------------------------
        // G1 — the depth guard. One gate on EVERY inbound message, of every type,
        // for every field, including messages sent before `hello`: it runs right
        // after JSON.parse and before the schema check, so the validator, the
        // switch and every handler see only messages within the limit.
        //
        // A deeper message is refused and nothing else happens: no world change,
        // no broadcast, no save, and the socket stays open. `seq` is echoed only
        // when the top-level `seq` is a number.
        // ---------------------------------------------------------------------
        const depth = messageDepth(msg)
        recordMessageDepth(msg?.type, depth)
        if (depth > MAX_MESSAGE_DEPTH) {
          console.error(
            `[session] depth guard: session=${session ? session.id : '-'} ` +
            `type=${typeof msg?.type === 'string' ? msg.type : '-'} ` +
            `depth=${Math.min(depth, MAX_MESSAGE_DEPTH)}`
          )
          sendError(ws, typeof msg?.seq === 'number' ? msg.seq : null,
            'UNKNOWN_MESSAGE', 'message nested too deeply')
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
              // 4b-1 E4 — eligibility, recorded at `hello`, so the handover never
              // recomputes it.
              canEdit: false,
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
            // 4b-1 E4 — eligibility is recorded on the session.
            session.canEdit = canEdit

            // 4b-1 E4 (E-L4 (a)) — the earliest-connected session that passed
            // `canEdit` at its hello takes the role. A reconnecting former host is
            // a new session with a new hello; it does NOT take the role while
            // another session holds it.
            let isScriptHost = false
            let hostGen
            if (canEdit && scriptHost.sessionId === null) {
              scriptHost.hostGen += 1
              scriptHost.sessionId = session.id
              isScriptHost = true
              hostGen = scriptHost.hostGen
            }

            ws.send(JSON.stringify({
              type: 'hello',
              id: session.id,
              seq: session.seq,
              serverTime: Date.now(),
              avatarNodeName: session.avatarNodeName,
              displayName: session.displayName,
              canPlaceTeleporters,
              canEdit,
              // 4b-1 E5 — required in EVERY server hello; `hostGen` present exactly
              // when `scriptHost` is true.
              scriptHost: isScriptHost,
              ...(isScriptHost ? { hostGen } : {}),
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
              // 4b-1 E3 — the set-once objectId leaf's uniqueness needs the world,
              // so the handler hands `authorizeSend` a callback (review N2).
              objectIdInUse: (id) => world.som.objectIdInUse(id),
            })
            if (!decision.ok) {
              sendError(ws, msg.seq, decision.code, decision.message)
              break
            }

            // scripting-4a Z2 / L5(b) — the server stamps a Play. The stamp runs
            // AFTER `authorizeSend` accepted (so a refused value is never stamped)
            // and before the apply and the broadcast, and the SAME stamped object is
            // both stored and broadcast. `add` is never stamped: a Duplicate or an
            // Undo-restored node keeps its value and stays in step (P6).
            let appliedValue = msg.value
            if (msg.field === ANIMATION_LEAF && msg.value !== null &&
                typeof msg.value === 'object' && msg.value.playing === true) {
              appliedValue = { ...msg.value, startedAt: Date.now() }
            }

            const result = world.setField(msg.node, msg.field, appliedValue)
            if (!result.ok) {
              sendError(ws, msg.seq, result.code, result.message ?? `${result.code}: ${msg.node}`)
              break
            }
            broadcast({
              type: 'set',
              seq: nextSeq(),
              node: msg.node,
              field: msg.field,
              value: appliedValue,
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

            // --- K4/L5: an avatar add may not carry its own extras.atrium ---
            // Runs after S2 (which keeps its own message for `source`) and
            // before the gate, with the other avatar-add checks. Refuses any
            // own extras.atrium, including `{}`.
            if (msg.id && addCarriesAtriumExtras(msg.node)) {
              sendError(ws, msg.seq, 'PERMISSION_DENIED', 'avatar nodes cannot carry extras.atrium')
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
              // 4b-1 E3 — the objectId UNIQUENESS check, which needs the world and
              // therefore lives here, AFTER the name rules and BEFORE any change
              // to the world. The value's FORM is `checkAtriumExtras`'s (below).
              // The refusal message is never "already in use": the palette retries
              // any message matching /already in use/ (review S-B).
              const idValue = msg.node.extras?.atrium?.objectId
              if (idValue !== undefined && world.som.objectIdInUse(idValue)) {
                sendError(ws, msg.seq, 'INVALID_VALUE', OBJECT_ID_TAKEN)
                break
              }
            }

            // --- K6/L7: transform values on `add` (avatar adds included) ---
            // A non-unit (or zero) rotation and a zero scale component are
            // refused, never corrected. Runs after the gate, before the first
            // world change.
            const transformCheck = checkTransformValues(msg.node)
            if (!transformCheck.ok) {
              sendError(ws, msg.seq, transformCheck.code, transformCheck.message)
              break
            }

            // --- L5/K4: the non-avatar extras.atrium checks ---
            // After the gate and the A4/A5 checks, where the length cap was.
            // One shared checker with `send`, so add and send can't drift.
            // Every refusal here comes before the first world change (the
            // displayName overwrite below and addNode).
            if (!isAvatar) {
              const extrasCheck = checkAtriumExtras(msg.node.extras)
              if (!extrasCheck.ok) {
                sendError(ws, msg.seq, extrasCheck.code, extrasCheck.message)
                break
              }
              // models-by-url (Z1/A6): the node-level half of the model rules —
              // a node carrying extras.atrium.model may not carry a mesh. Runs
              // with the value check, before the first world change.
              const modelCheck = checkModelHost(msg.node)
              if (!modelCheck.ok) {
                sendError(ws, msg.seq, modelCheck.code, modelCheck.message)
                break
              }
            }

            // Overwrite avatar extras.displayName with the server-assigned
            // displayName (pre-brief #9).
            if (isAvatar && session.displayName) {
              if (!msg.node.extras) msg.node.extras = {}
              msg.node.extras.displayName = session.displayName
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
      } catch (err) {
        // -----------------------------------------------------------------
        // G2 — the fail-closed boundary. Any exception from anywhere in the
        // body above (JSON.parse to the end of the switch) is logged as one
        // line and answered, and the session, the world and the process
        // carry on. It does NOT roll back a change a handler already applied:
        // a throw after a world change leaves world and clients disagreeing
        // until they reload (accepted — G1 removes the known case, this is the
        // last line, not a substitute). No process-level handler: outside this
        // listener an unknown failure still exits and systemd restarts.
        // -----------------------------------------------------------------
        console.error(`[session] message handler error: ${err?.name ?? 'Error'} ${err?.message ?? ''}`)
        sendError(ws, typeof msg?.seq === 'number' ? msg.seq : null,
          'UNKNOWN_MESSAGE', 'the message could not be processed')
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
      if (s.missedPings >= MISSED_PING_LIMIT) {
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