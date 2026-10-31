// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { validate } from '@atrium/protocol'
import { createTickLoop } from './tick.js'
import { MAX_MESSAGE_DEPTH, messageDepth } from './message-depth.js'
import { createPresence } from './presence.js'
import { resolveUpgradeAuth } from './http-routes.js'
import { parsePath, worldPosition } from '@atrium/som'
// scripting-4c Rev 2 W3 — ONE way to put a session id into a log line.
import { logId } from './log-id.js'
import {
  authorizeSend, resolveSendTarget, liveAvatarNames,
  checkAtriumExtras, checkTransformValues, checkModelHost,
  ANIMATION_LEAF, OBJECT_ID_TAKEN, BEHAVIOR_LEAF, BEHAVIOR_NODES_PER_WORLD, behaviorCountIn,
  // scripting-4d G2 — the world behaviour total (Rev 1 S5).
  BEHAVIOR_WORLD_BYTES_MAX, behaviorBytesIn, behaviorLeafBytes,
  // scripting-4c AC3 — the server's copies of the shared click rule.
  listensForSelect, withinActivateDistance,
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

// ---------------------------------------------------------------------------
// scripting-4c AC-L4 — a token bucket on the injected clock
//
// `capacity` tokens to start, refilled at `refillPerSecond`, never above the
// capacity. `take()` spends one and answers whether there was one. Both of 4c's
// limits are the same mechanism with different numbers: 5 a second per session,
// 20 a second per world.
// ---------------------------------------------------------------------------

/**
 * @param {number} capacity
 * @param {number} refillPerSecond
 * @param {() => number} now
 */
export function createTokenBucket(capacity, refillPerSecond, now) {
  let tokens = capacity
  let last = now()
  return {
    /** @returns {boolean} true when a token was available and has been spent */
    take() {
      const t = now()
      const elapsed = Math.max(0, t - last)
      last = t
      tokens = Math.min(capacity, tokens + (elapsed / 1000) * refillPerSecond)
      if (tokens < 1) return false
      tokens -= 1
      return true
    },
  }
}

/** AC-L4 — the per-session limit: 5 activations a second, burst 5. */
export const ACTIVATE_SESSION_TOKENS = 5
export const ACTIVATE_SESSION_REFILL = 5
/** AC-L4 — the per-world limit: 20 activations a second, burst 20. */
export const ACTIVATE_WORLD_TOKENS = 20
export const ACTIVATE_WORLD_REFILL = 20
/** AC3 — the rate-limit log line: one per session per this window. */
export const ACTIVATE_LOG_WINDOW_MS = 60_000

/** AC-L5 — every refusal's exact text. */
const ACTIVATE_RATE_MESSAGE = 'too many activations; try again in a moment'
const ACTIVATE_NO_BEHAVIOUR_MESSAGE = "this object doesn't respond to clicks"
const ACTIVATE_OWNER_AWAY_MESSAGE = "nothing runs here while the world's owner is away"
const ACTIVATE_OWNER_NOT_READY_MESSAGE = "the world's owner isn't ready yet"
const ACTIVATE_NO_AVATAR_MESSAGE = 'you have no avatar in this world'
const ACTIVATE_TOO_FAR_MESSAGE = 'you are too far away to use this'
/** W2 (Rev 2) — the forward's own text when a session id is outside the bound. */
const ACTIVATE_BAD_SENDER_MESSAGE = 'the sender is not a valid session'

/**
 * scripting-4c Rev 2 W2 — the bound `hello.client.json`'s `id` declares, kept
 * here as the forward's own check (defence in depth). W1 is what makes it
 * unreachable: a `hello` whose id is outside the bound is refused with
 * `UNKNOWN_MESSAGE` and creates no session.
 */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * V9 — one log line when a send or add check throws. The message is refused
 * with `INVALID_VALUE` ("the value could not be checked") and everything else
 * carries on: this line is what tells the operator which field failed.
 */
function logCheckFailure(session, field, error) {
  // scripting-4d G-L12 (a) / the 4c re-review's N1 — the id goes through
  // `logId`, the ONE way a session id reaches a log line: no control character,
  // no escape, no whole free-text id. One line, as before.
  console.error(`[session ${logId(session?.id)}] the check for "${field}" threw: ${error?.message ?? error}`)
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
    // resolveUpgradeAuth returns the cookie's sign-in only when the upgrade
    // is same-origin. Cross-origin upgrades always arrive anonymous.
    // CSRF protection for HTTP routes remains in http-routes.js.
    // See decision #2 in the cross-server connect brief.

    // Resolve the sign-in (userId AND auth session id) before the handshake.
    let upgradeAuth = null
    if (db) {
      try {
        upgradeAuth = resolveUpgradeAuth(request, db)
      } catch {
        // If resolution fails for any reason, treat as anonymous
        upgradeAuth = null
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, upgradeAuth?.userId ?? null, upgradeAuth?.authSessionId ?? null)
    })
  })

  // Wire up connection handlers
  const { closeKeepalive, evictNonOwners, closeAuthSessionSockets } = attachSessionHandlers({
    wss,
    world,
    db,
    sessions,
    presence,
    maxUsers,
    worldOwnerUserId: null,
    keepaliveInterval,
    worldId: 'default',
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
  worldId = 'default',
  // scripting-4c AC3 — the clock both rate-limit buckets read. A parameter, so
  // the tests drive it and no test waits a real second.
  now = () => Date.now(),
} = {}) {

  // Track pre-hello connections by WebSocket instance so eviction (V5) and the
  // logout sweep (signin-sync I5) can disconnect sockets that haven't sent
  // hello yet. Each entry is `{ userId, authSessionId }`.
  /** @type {Map<import('ws').WebSocket, { userId: string|null, authSessionId: string|null }>} */
  const preHelloSockets = new Map()

  // ---------------------------------------------------------------------------
  // 4b-1 E4 — the script-host role, one per world host (P7: each world host
  // calls attachSessionHandlers with its own state, so two worlds on one server
  // have independent hosts and independent generations).
  //
  // `hostGen` starts at 1 and is NOT saved: a server restart starts again at 1,
  // because every session reconnects. It ONLY EVER INCREASES — a role is never
  // reactivated under an old generation (review S2).
  //
  // scripting-4c (Rev 1 M1) — `ready` is the DELIVERY CONTRACT. The role alone
  // is not enough: the new host's world may still be loading, and an `activate`
  // forwarded in that window would be dropped in silence (4b-2 P19). Every GRANT
  // clears `ready`, and only the host session's own `script-ready` for the
  // current generation sets it again. Never weaken this to "the host's socket is
  // open" — that is exactly the gap this closes.
  // ---------------------------------------------------------------------------
  const scriptHost = { sessionId: null, hostGen: 0, ready: false }

  // AC-L4 — the per-WORLD bucket, one per world host, beside `scriptHost`. The
  // per-session bucket lives on the session object (it dies with the session).
  const activateWorldBucket = createTokenBucket(ACTIVATE_WORLD_TOKENS, ACTIVATE_WORLD_REFILL, now)

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
    for (const [ws, entry] of preHelloSockets) {
      if (ws.readyState === 1 /* OPEN */ && entry.userId !== ownerUserId) {
        ws.send(evictMsg)
        ws.close(1008)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // signin-sync I5 — closeAuthSessionSockets
  //
  // Close every socket this host admitted with `authSessionId`. Sends `error`
  // code `SIGNED_OUT` ("You signed out") and then closes 1008, exactly as
  // evictNonOwners does, and covers pre-hello sockets as well as full
  // sessions. Only the sockets whose recorded auth session id matches are
  // touched: the same user signed in elsewhere keeps their sockets.
  // ---------------------------------------------------------------------------
  const doCloseAuthSessionSockets = function closeAuthSessionSockets(authSessionId) {
    if (!authSessionId) return 0

    const signedOutMsg = JSON.stringify({
      type: 'error',
      code: 'SIGNED_OUT',
      message: 'You signed out',
    })

    let closed = 0

    // Full sessions admitted with this auth session
    for (const [, s] of sessions) {
      if (s.authSessionId !== authSessionId) continue
      if (s.ws.readyState === 1 /* OPEN */) {
        s.ws.send(signedOutMsg)
        s.ws.close(1008)
      }
      closed += 1
    }

    // Pre-hello sockets: upgraded with this auth session but no hello yet
    for (const [ws, entry] of preHelloSockets) {
      if (entry.authSessionId !== authSessionId) continue
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(signedOutMsg)
        ws.close(1008)
      }
      closed += 1
    }

    return closed
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
   *
   * scripting-4c (Rev 1 M1) — a GRANT always clears readiness: the new host has
   * not said its engines exist yet, whatever the previous holder said.
   */
  function grantScriptHost(session) {
    scriptHost.hostGen += 1
    scriptHost.sessionId = session.id
    scriptHost.ready = false
    session.ws.send(JSON.stringify({ type: 'script-host', active: true, hostGen: scriptHost.hostGen }))
  }

  /**
   * scripting-4b-2 F-L6 / scripting-4c S2 / scripting-4d G-L9 — a session may
   * hold the role only when it passed `canEdit` at its hello AND declared
   * `capabilities.scriptRunner === 3`.
   *
   * 3 means "runs 4d graphs". A 4c page sends 2 and a 4b-2 page sends 1: both
   * still connect, still own the world, keep every edit right and their Edit
   * panel — and are NEVER the host. Their clients would drop a forwarded
   * `activate` or a 4d graph without a word (4b-2 P4, G-L9).
   *
   * P22: this is ONE of the two places the role is decided. The other is the
   * inline election in the `hello` case, and both must say `=== 3`.
   */
  function canRunBehaviors(session) {
    return session?.canEdit === true && session?.capabilities?.scriptRunner === 3
  }

  /**
   * 4b-1 E4 — the handover, run AFTER the departed session has been removed, so
   * the departing session can never be chosen, and exactly once per departure.
   *
   * The role goes to the FIRST session in `sessions` order that passed `canEdit`
   * at its `hello` AND declared the script-runner capability (F-L6), has an OPEN
   * socket, and whose `missedPings` is BELOW the sweep's limit — a session the
   * same keepalive sweep is about to terminate is never chosen (review N7). With
   * none eligible, `sessionId` stays null and the next eligible `hello` takes
   * `hostGen + 1`.
   */
  function handOverScriptHost() {
    scriptHost.sessionId = null
    // scripting-4c (Rev 1 M1) — with no successor the world has NO ready host:
    // a stale `ready` from the departed session must not survive.
    scriptHost.ready = false
    for (const s of sessions.values()) {
      if (!canRunBehaviors(s)) continue
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

  wss.on('connection', (ws, req, upgradeUserId = null, upgradeAuthSessionId = null) => {
    let session = null

    // Log WS errors without rethrowing (pre-brief security: prevent
    // uncaught WS_ERR_EXPECTED_MASK from killing the server)
    ws.on('error', (err) => {
      console.error(`[session] connection error: ${err.message}`)
    })

    // Track pre-hello connection for eviction (V5) and the logout sweep (I5)
    preHelloSockets.set(ws, { userId: upgradeUserId, authSessionId: upgradeAuthSessionId })

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
        if (depth > MAX_MESSAGE_DEPTH) {
          console.error(
            `[session] depth guard: session=${session ? logId(session.id) : '-'} ` +
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
            let helloUsername = null

            // The server never adopts a client-sent displayName (pre-brief #9).
            // The session name is always the DB display_name for an authenticated
            // session, or User-xxxx for anonymous/cross-origin visitors.
            // A client-displayed name is a request, never a claim.

            // When the user is authenticated, use their real display_name
            // (from the users table).
            if (upgradeUserId && db) {
              try {
                const userRow = db.database.prepare(
                  'SELECT display_name, username FROM users WHERE id = ?'
                ).get(upgradeUserId)
                if (userRow && userRow.display_name) {
                  userDisplayName = userRow.display_name
                }
                if (userRow && userRow.username) {
                  helloUsername = userRow.username
                }
              } catch {
                // If the lookup fails, stick with the client-supplied or anonymous fallback
              }
            }

            session = {
              ws,
              id: sessionId,
              userId: null,
              // signin-sync I5 — the auth session this socket was admitted
              // with, recorded next to userId so a logout can find it.
              authSessionId: upgradeAuthSessionId,
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
            //
            // scripting-4c S2 / scripting-4d G-L9 — the capability is `=== 3`
            // HERE TOO (P22). This is the second of the two places the role is
            // decided; `canRunBehaviors` is the first. A `scriptRunner: 2` page
            // (4c) and a `scriptRunner: 1` page (4b-2) are never the host.
            let isScriptHost = false
            let hostGen
            if (canEdit && session.capabilities?.scriptRunner === 3 && scriptHost.sessionId === null) {
              scriptHost.hostGen += 1
              scriptHost.sessionId = session.id
              // Rev 1 M1 — the grant clears readiness: the page must say
              // `script-ready` before anything is forwarded to it.
              scriptHost.ready = false
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
              // signin-sync I1 — every hello this server sends states who it
              // admitted. `userId` is present exactly when `signedIn` is true.
              signedIn: session.userId !== null,
              ...(session.userId !== null ? { userId: session.userId } : {}),
              // 4b-1 E5 — required in EVERY server hello; `hostGen` present exactly
              // when `scriptHost` is true.
              scriptHost: isScriptHost,
              ...(isScriptHost ? { hostGen } : {}),
              capabilities: {
                tick: { interval: negotiated, minInterval: MIN_TICK_INTERVAL },
              },
            }))

            // signin-sync I7 — one line per admission. No cookie value, no auth
            // session id: the first 8 characters of the *world* session id only.
            // scripting-4c Rev 2 W3 — through `logId`, so the line cannot carry
            // a control character whatever the id holds.
            console.log(
              `[session] hello ${logId(session.id)} as ` +
              `${helloUsername ?? 'anonymous'} world ${worldId}`
            )

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
                // scripting-4d G2 (Rev 1.2 N4) — the serialize timing line for
                // Q7: `[world] serialized <logId> in <ms> ms (<bytes> bytes)`.
                // No ids beyond the world's `logId`.
                const serializeStart = performance.now()
                const gltf = await world.serialize()
                const serializeMs = Math.round(performance.now() - serializeStart)
                console.log(
                  `[world] serialized ${logId(worldId)} in ${serializeMs} ms ` +
                  `(${Buffer.byteLength(JSON.stringify(gltf), 'utf8')} bytes)`)
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

          case 'script-ready': {
            // ---------------------------------------------------------------------
            // scripting-4c AC3 (Rev 1 M1) — the OWNER's page says its runner is
            // enabled, so the world has a host that can actually RUN something.
            //
            // COOPERATIVE, like revocation: the server cannot verify the page's
            // state, only that the RIGHT session said so for the RIGHT
            // generation. Accepted only from `scriptHost.sessionId` with
            // `hostGen === scriptHost.hostGen`; anything else (a non-host, an
            // old generation) is ignored, with no answer and no log line. The
            // server never answers this message.
            // ---------------------------------------------------------------------
            if (scriptHost.sessionId !== null &&
                session.id === scriptHost.sessionId &&
                msg.hostGen === scriptHost.hostGen) {
              scriptHost.ready = true
            }
            break
          }

          case 'activate': {
            // ---------------------------------------------------------------------
            // scripting-4c AC3 — a click in any tab, forwarded to the host.
            //
            // THE TEN CHECKS RUN IN THIS ORDER. Each refusal answers `error`
            // with the request's `seq`, and nothing else happens: no broadcast,
            // no change, no save. The order is the contract (spec §9): the cheap
            // checks run before the walks, so a refusal's code is deterministic.
            //
            // The distance check below is NOT a security boundary: it measures
            // the position the sender's own `view` last claimed (4b-2 P8). It
            // stops ordinary far-away clicks and makes activation local; any
            // client can send a `view` next to an object first.
            // ---------------------------------------------------------------------

            // 2. No world: as `send`.
            if (!world) {
              sendError(ws, msg.seq, 'UNKNOWN_MESSAGE', 'World not loaded')
              break
            }

            // 3. THE SESSION'S BUCKET (AC-L4) — charged for EVERY schema-valid
            //    `activate` from a handshaken session, BEFORE the node lookup, so
            //    a flood costs no lookups. 5 a second, burst 5.
            const sessionBucket = session.activateBucket ??
              (session.activateBucket = createTokenBucket(ACTIVATE_SESSION_TOKENS, ACTIVATE_SESSION_REFILL, now))
            if (!sessionBucket.take()) {
              // AC3's log line: one per session per 60 s, and only when its
              // bucket refuses. Never a line per accepted activate, and no node
              // name, user name or cookie: the first 8 characters of the SESSION
              // id and the world id, nothing else.
              const t = now()
              if (session.activateLogAt == null || t - session.activateLogAt >= ACTIVATE_LOG_WINDOW_MS) {
                session.activateLogAt = t
                console.log(`[activate] rate limited ${logId(session.id)} world ${worldId}`)
              }
              sendError(ws, msg.seq, 'RATE_LIMITED', ACTIVATE_RATE_MESSAGE)
              break
            }

            // 4. THE NODE — exactly the named one. The server NEVER walks
            //    ancestors (AC-L7): the page resolved the click to the behaviour
            //    node before sending, and a placed model's inner nodes are the
            //    page's own, so a server-side walk could not work for them.
            const activateNode = world.som.getNodeByName(msg.node)
            if (!activateNode) {
              sendError(ws, msg.seq, 'NODE_NOT_FOUND', `NODE_NOT_FOUND: ${msg.node}`)
              break
            }

            // 5. THE BEHAVIOUR — a pure read of the STORED leaf (4b-2 P10).
            if (!listensForSelect(activateNode.extras?.atrium?.behavior)) {
              sendError(ws, msg.seq, 'INVALID_FIELD', ACTIVATE_NO_BEHAVIOUR_MESSAGE)
              break
            }

            // 6. A READY HOST (Rev 1 M1) — forward only to the session that sent
            //    `script-ready` for the CURRENT generation. A host that exists
            //    but is still loading is a different answer from no host at all.
            const activateHost = scriptHost.sessionId === null ? null : sessions.get(scriptHost.sessionId)
            const hostOpen = Boolean(activateHost) && activateHost.ws?.readyState === 1 /* OPEN */
            if (!hostOpen || !scriptHost.ready) {
              sendError(ws, msg.seq, 'NO_SCRIPT_HOST',
                hostOpen ? ACTIVATE_OWNER_NOT_READY_MESSAGE : ACTIVATE_OWNER_AWAY_MESSAGE)
              break
            }

            // 7. AN AVATAR — a session whose avatar `add` was refused has none.
            if (!session.avatarNode) {
              sendError(ws, msg.seq, 'PERMISSION_DENIED', ACTIVATE_NO_AVATAR_MESSAGE)
              break
            }

            // 8. THE DISTANCE — the sender's OWN avatar node (always at the
            //    root, so its translation IS its world position) to the behaviour
            //    node's WORLD position. NEVER `getNodeTranslation`: that is the
            //    local translation and is wrong inside a group (4b-2 P7).
            if (!withinActivateDistance(session.avatarNode.translation, worldPosition(activateNode))) {
              sendError(ws, msg.seq, 'PERMISSION_DENIED', ACTIVATE_TOO_FAR_MESSAGE)
              break
            }

            // 9. THE WORLD'S BUCKET (AC-L4) — charged ONLY here, at the moment of
            //    forwarding, for an activate that passed every other check. 20 a
            //    second, burst 20. This is the budget that bounds the host's own
            //    per-frame work, so refusals never spend it.
            if (!activateWorldBucket.take()) {
              sendError(ws, msg.seq, 'RATE_LIMITED', ACTIVATE_RATE_MESSAGE)
              break
            }

            // 10. FORWARD to the host session ONLY, with the generation the
            //     forward belongs to. `from` is for the host's log line: it is
            //     never used as identity or authority. No answer to the sender on
            //     success — and a successful forward is NOT a successful run
            //     (N3): the host can still drop it.
            //
            //     scripting-4c Rev 2 W2 — the forward's own check on `from`
            //     (defence in depth; W1 makes this unreachable, because a
            //     `hello` whose id is outside the bound never creates a
            //     session). A session outside the bound is NOT forwarded: the
            //     sender is answered INVALID_FIELD, the host sees nothing, and
            //     the id itself is never written to a log line.
            if (!SESSION_ID_RE.test(session.id)) {
              sendError(ws, msg.seq, 'INVALID_FIELD', ACTIVATE_BAD_SENDER_MESSAGE)
              break
            }
            activateHost.ws.send(JSON.stringify({
              type: 'activate',
              seq: nextSeq(),
              node: msg.node,
              event: 'select',
              from: session.id,
              hostGen: scriptHost.hostGen,
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
            // V9 — the check itself is fallible, and it FAILS CLOSED: any
            // exception it throws (including from `behaviorCheck`) refuses THIS
            // message with `INVALID_VALUE`, the session, the world and the process
            // carry on, and the server logs one line naming the session and the
            // field. Nothing is checked here that a failing check could leave
            // half-applied: the refusal happens before `world.setField`.
            let decision
            try {
              decision = authorizeSend({
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
                // scripting-4b-2 F2/S1 — the 64-behaviour cap needs the world too,
                // and it counts OTHER nodes, so the node being written is excluded.
                behaviorCount: (node) => behaviorCountIn(world.som, node),
                // scripting-4d G2 (Rev 1 S5) — the world behaviour total, the
                // same way: the sum over the OTHER saved nodes' leaves, so a
                // rewrite is judged by its NEW size.
                behaviorBytes: (node) => behaviorBytesIn(world.som, node),
              })
            } catch (error) {
              logCheckFailure(session, msg.field, error)
              sendError(ws, msg.seq, 'INVALID_VALUE', 'the value could not be checked')
              break
            }
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
              // V9 — the `add` checks fail closed too: an exception from any of
              // them refuses the whole `add` with `INVALID_VALUE`, before the
              // first world change.
              let checks
              try {
                checks = {
                  extras: checkAtriumExtras(msg.node.extras),
                  model: checkModelHost(msg.node),
                }
              } catch (error) {
                logCheckFailure(session, 'add', error)
                sendError(ws, msg.seq, 'INVALID_VALUE', 'the value could not be checked')
                break
              }
              const extrasCheck = checks.extras
              if (!extrasCheck.ok) {
                sendError(ws, msg.seq, extrasCheck.code, extrasCheck.message)
                break
              }
              // models-by-url (Z1/A6): the node-level half of the model rules —
              // a node carrying extras.atrium.model may not carry a mesh. Runs
              // with the value check, before the first world change.
              const modelCheck = checks.model
              if (!modelCheck.ok) {
                sendError(ws, msg.seq, modelCheck.code, modelCheck.message)
                break
              }
              // scripting-4b-2 F2 — the 64-behaviour cap on the `add` path, where
              // E3 placed the object-id uniqueness check: after the name rules,
              // before `world.addNode`, so a refusal changes nothing.
              const addedBehavior = msg.node.extras?.atrium?.behavior
              if (addedBehavior !== undefined && addedBehavior !== null &&
                  behaviorCountIn(world.som, null) >= BEHAVIOR_NODES_PER_WORLD) {
                sendError(ws, msg.seq, 'INVALID_VALUE',
                  `this world already has ${BEHAVIOR_NODES_PER_WORLD} behaviours`)
                break
              }
              // scripting-4d G2 (Rev 1 S5) — the world behaviour total on the
              // `add` path (which Duplicate, Undo and Redo all reach): the new
              // node is not in the SOM yet, so the whole world's existing leaves
              // plus the added leaf's own size must stay within 1 MiB. A
              // refusal changes nothing, as the 64-cap refusal above.
              if (addedBehavior !== undefined && addedBehavior !== null &&
                  behaviorBytesIn(world.som, null) + behaviorLeafBytes(addedBehavior) > BEHAVIOR_WORLD_BYTES_MAX) {
                sendError(ws, msg.seq, 'INVALID_VALUE',
                  "this world's behaviours would exceed 1 MiB")
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
        console.error(
          `[session] message handler error: ` +
          `type=${typeof msg?.type === 'string' ? msg.type : '-'} ` +
          `${err?.name ?? 'Error'}: ${err?.message ?? ''}`
        )
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
  }, evictNonOwners: doEvictNonOwners,
     closeAuthSessionSockets: doCloseAuthSessionSockets,
     getPreHelloSocketCount: () => preHelloSockets.size }
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