// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { SOMDocument, SOMEvent } from '@atrium/som'
import { OBJECT_ID_FIELD } from './object-id.js'

/** Z2a (scripting-4a) — the node extras leaf the model-animation controls write. */
export const MODEL_ANIMATION_FIELD = 'extras.atrium.animation'

/** E6 (scripting-4b-1) — the set-once object-identity leaf, re-exported. */
export { OBJECT_ID_FIELD }

// ---------------------------------------------------------------------------
// Minimal EventEmitter — works in Node.js and browsers without a build step
// ---------------------------------------------------------------------------

class EventEmitter {
  constructor() { this._listeners = Object.create(null) }

  on(event, fn) {
    ;(this._listeners[event] ??= []).push(fn)
    return this
  }

  off(event, fn) {
    const arr = this._listeners[event]
    if (arr) {
      const idx = arr.indexOf(fn)
      if (idx >= 0) arr.splice(idx, 1)
    }
    return this
  }

  once(event, fn) {
    const wrapper = (...args) => { this.off(event, wrapper); fn(...args) }
    return this.on(event, wrapper)
  }

  emit(event, ...args) {
    const arr = this._listeners[event]
    if (arr) for (const fn of [...arr]) fn(...args)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Compute quaternion rotating glTF forward [0,0,-1] to `look` unit vector.
function lookToQuaternion(look) {
  const [lx, ly, lz] = look
  const dot = -lz                        // dot([0,0,-1], look)
  if (dot < -0.9999) return [0, 1, 0, 0] // 180° around Y
  const cx = ly, cy = -lx, cz = 0
  const qw = 1 + dot
  const len = Math.sqrt(cx * cx + cy * cy + cz * cz + qw * qw)
  return [cx / len, cy / len, cz / len, qw / len]
}

function makeWebIO() {
  return new WebIO().registerExtensions(KHRONOS_EXTENSIONS)
}

// ---------------------------------------------------------------------------
// scripting-4a Z3 — the server's clock, measured on a monotonic local clock
// ---------------------------------------------------------------------------

/**
 * Z3 — the local clock every measurement comes from. `performance.now()` is
 * monotonic: a wall-clock change on the device (a user fix, a DST step, a
 * laptop waking with a wrong RTC) cannot move `serverNow()`. `Date.now()` is
 * never used for a measurement.
 */
const defaultMonoNow = () => globalThis.performance.now()

/** Z3 — the timers, injectable so a test can drive them. */
const defaultTimers = {
  setTimeout:    (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout:  (t) => globalThis.clearTimeout(t),
  setInterval:   (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (t) => globalThis.clearInterval(t),
}

/** Z3 — five pings at 200 ms intervals after `hello` and after a discontinuity. */
export const PING_BURST_COUNT        = 5
export const PING_BURST_INTERVAL_MS  = 200
/** Z3 — then one ping every 30 s while connected. */
export const PING_STEADY_INTERVAL_MS = 30_000
/** Z3 — the rolling window: the last 10 samples, none older than 5 minutes. */
export const CLOCK_WINDOW_SIZE       = 10
export const CLOCK_SAMPLE_MAX_AGE_MS = 5 * 60_000
/** scripting-4c AC4 — pending activations kept per connection (oldest dropped). */
export const ACTIVATIONS_MAX         = 16
/** Z3 — a ping answered more than 60 s (by `monoNow()`) after it was sent is ignored. */
export const CLOCK_PING_MAX_AGE_MS   = 60_000
/** Z3 — below this the difference is a normal measurement, not a jump. */
export const CLOCK_JUMP_MIN_MS       = 250

/** One connection's clock state. Every timer in `timers` belongs to its record. */
function createClock() {
  return {
    pingCounter: 0,      // Z3 — the per-connection `clientTime` counter
    sent: new Map(),     // clientTime -> the monoNow() at send
    samples: [],         // { rtt, offset, at } — the rolling window
    offset: null,        // serverNow() = monoNow() + offset
    ready: false,        // true after the first valid pong
    // V3 — a discontinuity invalidates the estimate but never DROPS it: the
    // window is rebuilt from a fresh burst, and until the first answer of that
    // burst lands `offset` keeps serving `serverNow()` while `ready` is false.
    recovering: false,
    timers: new Set(),   // every timer this connection owns
  }
}

// ---------------------------------------------------------------------------
// scripting-4b-1 E6 — the script-host role, as the client sees it
// ---------------------------------------------------------------------------

/** E5/E6 — a host generation: a safe integer >= 1, or nothing. */
function isHostGeneration(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
}

const INACTIVE_ROLE = Object.freeze({ active: false, hostGen: null })

/**
 * E6/E5 — the role a server `hello` carries, or null when its fields do not
 * have the schema's shape. `scriptHost` must be a boolean; `hostGen` must be a
 * safe integer >= 1 exactly when it is true, and ABSENT when it is false.
 */
function roleFromHello(msg) {
  const active = msg?.scriptHost
  if (typeof active !== 'boolean') return null
  if (active) return isHostGeneration(msg.hostGen) ? { active: true, hostGen: msg.hostGen } : null
  return Object.hasOwn(msg, 'hostGen') ? null : { active: false, hostGen: null }
}

/**
 * E6/E5 — the role a `script-host` message carries, or null when malformed.
 * All three fields are required, so a non-active message still carries a
 * `hostGen` (the generation it refers to).
 */
function roleFromScriptHost(msg) {
  const active = msg?.active
  if (typeof active !== 'boolean') return null
  return isHostGeneration(msg.hostGen) ? { active, hostGen: msg.hostGen } : null
}

// ---------------------------------------------------------------------------
// AtriumClient
// ---------------------------------------------------------------------------

export class AtriumClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {boolean}  [opts.debug=false]  - Gate verbose console logging
   * @param {Function} [opts.WebSocket]    - WebSocket constructor (injectable for testing)
   * @param {Function} [opts.monoNow]      - Z3: the monotonic local clock (injectable)
   * @param {object}   [opts.timers]       - Z3: setTimeout/clearTimeout/setInterval/clearInterval
   */
  constructor({
    debug = false, WebSocket: WSImpl = globalThis.WebSocket, fetch: fetchImpl = globalThis.fetch,
    connectTimeout = 15000, monoNow = defaultMonoNow, timers = null,
  } = {}) {
    super()
    this._debug   = debug
    this._WSImpl  = WSImpl
    this._fetch   = fetchImpl
    this._connectTimeout = connectTimeout
    // Z3 — the measured clock and the timers are injectable, so a test drives
    // both with fakes and no real 30 s interval ever runs.
    this._monoNow = typeof monoNow === 'function' ? monoNow : defaultMonoNow
    this._timers  = { ...defaultTimers, ...(timers ?? {}) }

    // Connection state — null when disconnected
    /** @type {{ sessionId, url, worldBaseUrl, ws, closing, stale, peerSessions, gen, connectTimeout } | null} */
    this._connectionRecord = null

    // World generation counter — bumped on every connect/disconnect/loadWorld/loadWorldFromData
    // so async work can check if the world context changed while it was in flight.
    this._worldGen = 0

    // Legacy convenience fields kept for backward compat
    this._connected = false
    this._wsUrl     = null

    // Session identity — derived from connection record for backward compat getters
    this._sessionId      = null
    this._displayName    = null
    this._avatarNodeName = null
    this._avatarDescriptor = null   // opaque; set by apps/client via connect()
    this._worldBaseUrl   = null

    // Peer session tracking: sessionId → displayName
    // (mirror of active record's peerSessions, for backward compat getters)
    this._peerSessions = new Map()

    // setView rate-limiting state
    this._pendingView    = null
    this._lastSentAt     = 0
    this._viewFlushTimer = null

    // Outbound message counter — one counter for every outgoing message
    // (A3/D7): send, add, remove and view.
    this._sendSeq = 0

    // The seq of the most recent `send` (A3). Callers that need it (the
    // teleporter form) read it here; sends originate inside SOM mutation
    // listeners, so there is no return value to catch.
    this.lastSendSeq = null

    // Loopback prevention flag — true while applying a remote set
    this._applyingRemote = false

    // Pointer event state — cleared on world:loaded and disconnect
    this._capturedNode      = null
    this._currentHoverNode  = null
    this._pointerDownTarget = null

    // Teleporter support (Step 7)
    this._worldReady = false
    this.canPlaceTeleporters = false
    this.canEdit = false
    // signin-sync I1 — who the server admitted, from `hello`: `this.signedIn`
    // is true/false, `undefined` when the server did not say (an older or
    // another server) — unknown, NEVER anonymous. `this.userId` is the
    // admitted user's id, present exactly when the server said signedIn true.
    // The app compares `userId`, never the display name.
    this.signedIn = undefined
    this.userId = undefined
    this._transmitName = null

    // 4b-1 E6 — the script-host role this client believes it holds. Set ONLY
    // from the server's `hello` and `script-host` messages; the client never
    // decides the role itself.
    this.scriptHost = { active: false, hostGen: null }
    // E6 — a malformed `hello` role is "logged once", not once per message.
    this._scriptHostRoleWarned = false
  }

  /**
   * Convert a WebSocket origin to an HTTP origin for asset resolution.
   * Pure: replaces ws:// with http:// or wss:// with https:// on the
   * given URL's origin. Strips path/query/fragment. Returns null for
   * unparseable input.
   * @param {string|null} wsOrigin
   * @returns {string|null}
   */
  static wsOriginToHttpOrigin(wsOrigin) {
    if (!wsOrigin) return null
    try {
      const parsed = new URL(wsOrigin)
      if (parsed.protocol === 'wss:') {
        parsed.protocol = 'https:'
      } else if (parsed.protocol === 'ws:') {
        parsed.protocol = 'http:'
      }
      // http:/https: and other schemes pass through unchanged
      return parsed.origin
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** The live SOMDocument instance. Read-only for apps/client. */
  get som() { return this._som }

  /** Connection status. Read-only for apps/client. */
  get connected() { return this._connected }

  /** The WebSocket URL used in the current connection. Null when disconnected. */
  get wsUrl() { return this._wsUrl }

  /** The display name assigned in connect(). Null before connect(). */
  get displayName() { return this._displayName }

  /**
   * Count of peer avatars present in the SOM (ephemeral nodes other than the
   * local avatar). Zero when no world is loaded or no peers are connected.
   * At world:loaded time this reflects peers already in the som-dump.
   */
  get peerCount() {
    if (!this._som) return 0
    const localName = this._displayName ?? null
    return this._som.nodes.filter(n =>
      n.extras?.atrium?.ephemeral === true &&
      n.name !== localName
    ).length
  }

  /** True while a SOM node holds pointer capture. */
  get hasPointerCapture() { return this._capturedNode !== null }

  dispatchPointerEvent(somNode, type, detail) {
    const fullDetail = { ...detail, stopPropagation() {} }

    if (this._capturedNode) {
      const target = this._capturedNode
      this._dispatchOnNode(target, type, fullDetail)
      if (type === 'pointerup') {
        if (somNode === target) this._dispatchOnNode(target, 'click', fullDetail)
        this._capturedNode = null
      }
      return
    }

    if (type === 'pointermove') {
      if (somNode !== this._currentHoverNode) {
        if (this._currentHoverNode) this._dispatchOnNode(this._currentHoverNode, 'pointerout', fullDetail)
        if (somNode)                this._dispatchOnNode(somNode, 'pointerover', fullDetail)
        this._currentHoverNode = somNode
      }
      if (somNode) this._dispatchOnNode(somNode, 'pointermove', fullDetail)
    } else if (type === 'pointerdown') {
      if (somNode) {
        this._dispatchOnNode(somNode, 'pointerdown', fullDetail)
        this._pointerDownTarget = somNode
      }
    } else if (type === 'pointerup') {
      if (somNode) {
        this._dispatchOnNode(somNode, 'pointerup', fullDetail)
        if (somNode === this._pointerDownTarget) this._dispatchOnNode(somNode, 'click', fullDetail)
      }
      this._pointerDownTarget = null
    }
  }

  setPointerCapture(somNode) {
    this._capturedNode = somNode
  }

  releasePointerCapture() {
    this._capturedNode = null
  }

  /**
   * Run `fn` with outbound sends suppressed. SOM changes made inside it still
   * dispatch mutation events (so renderers update), but stay on this client
   * and are never sent to the server. For presentation-only changes, such as
   * the per-viewer tint AvatarController gives peer avatars. Restores the
   * previous state on exit, so calls may nest. Returns fn's result.
   */
  applyLocally(fn) {
    const prev = this._applyingRemote
    this._applyingRemote = true
    try {
      return fn()
    } finally {
      this._applyingRemote = prev
    }
  }

  /**
   * HTTP base URL used to resolve relative `extras.atrium.source` paths.
   * Set automatically by loadWorld(). Can be set manually by the app layer
   * for connect-only flows where loadWorld() is not called.
   */
  get worldBaseUrl() { return this._worldBaseUrl }
  set worldBaseUrl(url) { this._worldBaseUrl = url }

  // ---------------------------------------------------------------------------
  // Connection record helpers
  // ---------------------------------------------------------------------------

  /** True when any connection record is current (connecting, connected, or closing). */
  get _hasActiveRecord() {
    return this._connectionRecord !== null
  }

  /**
   * Bump world generation and reset per-connection state.
   * Called at the start of connect(), disconnect(), loadWorld(), loadWorldFromData().
   */
  _bumpWorldGen() {
    this._worldGen++
  }

  /**
   * Cancel view flush timer. Called when superseding a connection or disconnecting.
   */
  _cancelViewFlush() {
    if (this._viewFlushTimer) {
      clearTimeout(this._viewFlushTimer)
      this._viewFlushTimer = null
    }
    this._pendingView = null
  }

  /**
   * Clear the connect timeout timer on a record, if one is set.
   * Called when the connection succeeds (_onServerHello), the user
   * disconnects (disconnect), or the record is superseded (stale
   * check in the timer itself).
   * @param {{ connectTimeout?: ReturnType<typeof setTimeout> }} record
   */
  _clearConnectTimeout(record) {
    if (record && record.connectTimeout) {
      clearTimeout(record.connectTimeout)
      record.connectTimeout = undefined
    }
  }

  // ---------------------------------------------------------------------------
  // Z3 — the server's clock
  // ---------------------------------------------------------------------------

  /**
   * Z3 — the server's clock as this client estimates it:
   * `monoNow() + offset`. Before any estimate exists the offset is 0, so the
   * value is at least the local monotonic clock; after `hello` it starts from
   * `hello.serverTime` and is refined by every accepted `pong`.
   *
   * V3 — once `hello` has given one, the estimate is NEVER missing: a
   * discontinuity reports `ready` false and keeps the last estimate serving
   * this function, so a playing clip cannot drop to frame 0 while the clock
   * recovers. The `?? 0` is only for a connection with no `hello` yet — there
   * is no world then, and nothing plays.
   *
   * @returns {number}  milliseconds on the server's clock
   */
  serverNow() {
    const clock = this._connectionRecord?.clock
    return this._monoNow() + (clock?.offset ?? 0)
  }

  /** Z3 — true once this connection has answered a ping. */
  get serverClockReady() {
    return this._connectionRecord?.clock?.ready === true
  }

  /**
   * Z3 — a connection's clock is cancelled in one place. NO TIMER OUTLIVES ITS
   * CONNECTION: `disconnect`, a socket close, a connect timeout, a superseded
   * connection and a new `hello` all come through here.
   */
  _cancelClock(record) {
    const clock = record?.clock
    if (!clock) return
    // A timer's KIND is kept with its id: `clearTimeout` does not stop an
    // interval, so the steady ping's own kind decides which canceller runs.
    for (const timer of clock.timers) {
      const cancel = timer.kind === 'interval' ? this._timers.clearInterval : this._timers.clearTimeout
      cancel(timer.id)
    }
    clock.timers.clear()
    clock.sent.clear()
  }

  /**
   * Z3 — `hello` (re)starts the estimate: the offset comes from
   * `hello.serverTime`, and five pings go at 200 ms intervals, then one every
   * 30 s while connected.
   */
  _startClock(record, serverTime) {
    if (!record) return
    this._cancelClock(record)
    const clock = record.clock ?? (record.clock = createClock())
    clock.pingCounter = 0
    clock.sent.clear()
    clock.samples = []
    clock.ready = false
    // V3 — `hello` (re)states the estimate itself, so nothing is recovering on
    // a connection whose offset just came from the server.
    clock.recovering = false
    clock.offset = typeof serverTime === 'number' ? serverTime - this._monoNow() : null
    this._burstPings(record, { steady: true })
  }

  /**
   * Z3 — a burst of `PING_BURST_COUNT` pings at 200 ms intervals. Every timer
   * goes into the record's own set, so `_cancelClock` can reach it.
   *
   * @param {object} record
   * @param {{steady?: boolean}} [opts]  also (re)start the 30 s interval
   */
  _burstPings(record, { steady = false } = {}) {
    const clock = record?.clock
    if (!clock) return
    for (let i = 0; i < PING_BURST_COUNT; i++) {
      const entry = { id: 0, kind: 'timeout' }
      entry.id = this._timers.setTimeout(() => {
        clock.timers.delete(entry)
        if (record !== this._connectionRecord) return
        this._sendPing(record)
      }, i * PING_BURST_INTERVAL_MS)
      // Node: a clock timer must never be the reason a process stays alive.
      entry.id?.unref?.()
      clock.timers.add(entry)
    }
    if (!steady) return
    const interval = this._timers.setInterval(() => {
      if (record !== this._connectionRecord) return
      this._sendPing(record)
    }, PING_STEADY_INTERVAL_MS)
    interval?.unref?.()
    clock.timers.add({ id: interval, kind: 'interval' })
  }

  /**
   * Z3 — one ping. `clientTime` is a per-connection COUNTER (1, 2, 3 …), not a
   * time, so the five pings of a burst never share a key; the send's `monoNow()`
   * is kept under that counter so the RTT can be measured from it.
   */
  _sendPing(record) {
    const clock = record?.clock
    if (!clock || !record.ws) return
    clock.pingCounter += 1
    const clientTime = clock.pingCounter
    clock.sent.set(clientTime, this._monoNow())
    try {
      record.ws.send(JSON.stringify({ type: 'ping', clientTime }))
    } catch { /* the socket is closing; its close handler cancels the clock */ }
  }

  /**
   * Z3 — a `pong`. A pong this connection never asked for (another connection's,
   * or a superseded one's) and one whose ping is more than 60 s old by
   * `monoNow()` are IGNORED. A new sample whose offset differs from the current
   * estimate by more than `max(250 ms, its RTT)` is a discontinuity: V4 clears
   * `sent` first, so the answers to the pings sent before it cannot be taken for
   * the new burst's; the window goes WITHOUT that sample (it may itself be the
   * wrong one), the burst follows, and V3 keeps the last estimate serving
   * `serverNow()` — with `ready` false — until the burst's first answer lands,
   * which is the new estimate.
   */
  _onPong(msg, record) {
    const clock = record?.clock
    if (!clock) return
    const clientTime = msg?.clientTime
    const sentMono = clock.sent.get(clientTime)
    if (sentMono === undefined) return
    clock.sent.delete(clientTime)
    const now = this._monoNow()
    if (now - sentMono > CLOCK_PING_MAX_AGE_MS) return

    const rtt = Math.max(0, now - sentMono)
    const offset = msg.serverTime - (sentMono + rtt / 2)

    if (!clock.recovering &&
        clock.offset !== null &&
        Math.abs(offset - clock.offset) > Math.max(CLOCK_JUMP_MIN_MS, rtt)) {
      // V3/V4 — the window goes, and this sample with it: it may itself be the
      // wrong one (a pre-sleep ping answered after a wake). V4: the outstanding
      // keys go too, BEFORE the new burst is sent, so only that burst can
      // rebuild the estimate. V3: `offset` is left alone and `ready` goes false.
      clock.samples = []
      clock.recovering = true
      clock.ready = false
      clock.sent.clear()
      this._burstPings(record)
      return
    }

    // The first answer of a recovery burst skips the comparison above — it is
    // the estimate the old one has just been declared wrong against.
    clock.recovering = false
    clock.ready = true
    clock.samples.push({ rtt, offset, at: now })
    this._pruneClockSamples(clock, now)
    let best = clock.samples[0]
    for (const sample of clock.samples) if (sample.rtt < best.rtt) best = sample
    clock.offset = best.offset
  }

  /** Z3 — the rolling window: the last 10 samples, none older than 5 minutes. */
  _pruneClockSamples(clock, now) {
    clock.samples = clock.samples.filter((sample) => now - sample.at <= CLOCK_SAMPLE_MAX_AGE_MS)
    if (clock.samples.length > CLOCK_WINDOW_SIZE) {
      clock.samples = clock.samples.slice(clock.samples.length - CLOCK_WINDOW_SIZE)
    }
  }

  // ---------------------------------------------------------------------------
  // Connect / disconnect
  // ---------------------------------------------------------------------------

  /**
   * Connect to a running Atrium server.
   * @param {string} wsUrl  - WebSocket URL, e.g. ws://localhost:3000
   * @param {object} opts
   * @param {object} [opts.avatar] - Opaque glTF node descriptor for the local avatar
   * @param {string} [opts.displayName] - Display name for the local user
   * @param {string} [opts.worldBaseUrl] - Explicit base URL for resolving relative asset refs.
   *   When omitted, derived from the wsUrl's origin (ws:→http:, wss:→https:).
   *   When provided, used as-is (does not clobber an explicitly-set base).
   *   Pass null to leave _worldBaseUrl unchanged (dev flow compatibility).
   * @returns {string} sessionId
   */
  connect(wsUrl, { avatar, displayName, worldBaseUrl: optWorldBaseUrl, scriptRunner = false } = {}) {
    // 4b-1 E6 (M4) — the role is released SYNCHRONOUSLY, first thing, before
    // this path does anything else — in particular before `connecting` is
    // emitted below. The invariant: once a connection is abandoned, nothing
    // listening for the role still believes it holds it.
    this._releaseScriptHost()

    // ---- Bump world gen ----
    const gen = this._worldGen + 1
    this._worldGen = gen
    this._cancelViewFlush()

    // ---- Capture previous sessionId, if any ----
    const previousSessionId = this._connectionRecord ? this._connectionRecord.sessionId : null

    // ---- Close previous socket ----
    const prevRecord = this._connectionRecord
    if (prevRecord) {
      // A3 — every pending edit on the outgoing connection becomes
      // `edit:unknown` at once. connect() replaces the record and closes its
      // socket without emitting 'disconnected', so this cannot hang off that
      // event; it happens here, before the new socket opens.
      this._resolveAllPendingAsUnknown(prevRecord)
      // Z3 — the outgoing connection's clock stops with it.
      this._cancelClock(prevRecord)
      // Mark previous record stale
      prevRecord.stale = true
      // Close the old socket so avatar leaves old world
      if (prevRecord.ws) {
        try { prevRecord.ws.close() } catch { /* ignore */ }
      }
    }

    // ---- Reset per-connection state before new record ----
    this._peerSessions = new Map()
    this._connected = false
    this._wsUrl = null
    this._clearViewState()
    this._clearPointerState()
    this._worldReady = false
    this.canPlaceTeleporters = false
    this.canEdit = false
    // signin-sync I1 — who the server admitted on this connection. Reset on
    // EVERY new connection, so a second connection can never inherit the first
    // one's identity. `undefined` means unknown, never anonymous.
    this.signedIn = undefined
    this.userId = undefined

    // ---- Create new session identity ----
    const sessionId      = globalThis.crypto.randomUUID()
    const shortId        = sessionId.slice(0, 4)
    this._sessionId      = sessionId
    this._transmitName   = displayName ?? null
    this._displayName    = displayName || `User-${shortId}`
    this._avatarNodeName = this._displayName
    this._avatarDescriptor = avatar ?? null
    if (this._avatarDescriptor) {
      this._avatarDescriptor.name = this._displayName
      // T7: only include extras.displayName when a name was provided
      if (displayName) {
        this._avatarDescriptor.extras = { ...this._avatarDescriptor.extras, displayName }
      }
      this._avatarDescriptor.extras = {
        ...this._avatarDescriptor.extras,
        atrium: { ...(this._avatarDescriptor.extras?.atrium ?? {}), ephemeral: true },
      }
    }

    // ---- Derive or preserve worldBaseUrl ----
    if (optWorldBaseUrl !== undefined) {
      this._worldBaseUrl = optWorldBaseUrl
    } else {
      // Derive HTTP base from connect URL's origin (ws:→http:, wss:→https:)
      this._worldBaseUrl = AtriumClient.wsOriginToHttpOrigin(wsUrl)
    }

    this._wsUrl = wsUrl

    // ---- Emit connecting BEFORE creating socket ----
    this.emit('connecting', { sessionId, url: wsUrl, previousSessionId })

    // ---- Create connection record ----
    const record = {
      sessionId,
      url: wsUrl,
      worldBaseUrl: this._worldBaseUrl,
      ws: null,       // set below
      stale: false,
      closing: false,
      peerSessions: new Map(),
      // A3 — pending edits live on the connection record, so they belong to
      // one server session and a late answer from a superseded connection is
      // dropped by the existing `dispatch` guard.
      pendingEdits: new Map(),
      // scripting-4c AC4 (Rev 1 S3, P21) — the activation refusals live here
      // TOO, and in their OWN map: `_sendSeq` restarts at 0 on every connect,
      // so a map that outlived a connection would name the wrong node (P21).
      // Activation seqs never enter `pendingEdits`, so an `activate` refusal can
      // never resolve an edit that happens to share its seq.
      pendingActivations: new Map(),
      // scripting-4c AC4 (Rev 1 M1) — the `hostGen` this connection has already
      // sent `script-ready` for, or null. Once per hostGen per connection.
      readySent: null,
      // E6 (review N4) — the per-connection high-water mark for `hostGen`,
      // beside `pendingEdits`, so a NEW connection starts from zero.
      hostGenSeen: 0,
      gen,
    }
    this._connectionRecord = record

    // scripting-4b-2 F-L12 (GLM's NIT on 4b-1) — the malformed-`hello` warning
    // is once per CONNECTION, not once per page: a new connection record resets
    // it beside the other per-connection state.
    this._scriptHostRoleWarned = false

    this._log(`Connecting to ${wsUrl}`)

    // ---- Create socket (catch synchronous throw - pre-brief #9) ----
    let ws
    try {
      ws = new this._WSImpl(wsUrl)
    } catch (err) {
      // Synchronous constructor failure — schedule async error + disconnected
      // so callers that register listeners on the returned sessionId still receive them.
      // R4: clear connect timeout before marking closing
      this._clearConnectTimeout(record)
      record.closing = true
      const errCopy = new Error(err.message || 'WebSocket constructor failed')
      errCopy.sessionId = sessionId
      errCopy.url = wsUrl
      setTimeout(() => {
        if (record !== this._connectionRecord) return
        this.emit('error', errCopy)
      }, 0)
      setTimeout(() => {
        if (record !== this._connectionRecord) return
        this._connectionRecord = null
        this._connected = false
        this._wsUrl = null
        this.emit('disconnected', { sessionId, url: wsUrl, reason: 'closed' })
      }, 0)
      this._ws = null
      return sessionId
    }

    record.ws = ws
    this._ws = ws

    const onOpen = () => {
      if (record !== this._connectionRecord) return
      if (record.stale) return
      this._log('Connection open')
      if (record.closing) return
      // T7: omit displayName key entirely when no name was provided
      //
      // scripting-4c AC4 (Rev 1.2 M1, P23) — `scriptRunner` is present ONLY on a
      // same-origin connection, and then it is 2. Its ABSENCE is the one shape
      // every released server accepts: a pre-4b-2 server refuses any
      // `scriptRunner` it does not know, and PROD runs one. Nothing is lost —
      // a cross-origin connection is always anonymous (signin-sync I1), so it
      // could never be the host anyway.
      const capabilities = { tick: { interval: 5000 } }
      if (scriptRunner) capabilities.scriptRunner = 2
      const helloMsg = {
        type: 'hello',
        id:   sessionId,
        capabilities,
      }
      if (this._transmitName != null) {
        helloMsg.displayName = this._transmitName
      }
      ws.send(JSON.stringify(helloMsg))
    }

    // Raw data → string → parsed message dispatch
    const dispatch = async (raw) => {
      if (record !== this._connectionRecord) return
      if (record.stale || record.closing) return
      let msg
      try { msg = JSON.parse(raw) } catch { return }

      if (this._debug) this._log(`← ${msg.type}`)

      switch (msg.type) {
        case 'hello':      await this._onServerHello(msg, record); break
        case 'som-dump':   await this._onSomDump(msg, record);    break
        case 'world-done':  this._onWorldDone(msg, record);        break
        case 'add':        this._onAdd(msg, record);               break
        case 'remove':     this._onRemove(msg, record);            break
        case 'set':        this._onSet(msg, record);               break
        case 'view':       this._onView(msg, record);              break
        case 'join':       this._onJoin(msg, record);              break
        case 'leave':      this._onLeave(msg, record);             break
        case 'script-host': this._onScriptHost(msg, record);        break
        case 'activate':   this._onActivate(msg, record);           break
        case 'tick':       /* ignored */                            break
        case 'pong':       this._onPong(msg, record);               break
        case 'error': {
          const err = new Error(`${msg.code}: ${msg.message ?? ''}`)
          err.sessionId = sessionId
          err.url = wsUrl
          err.code = msg.code
          err.seq = msg.seq
          // A3 — an error whose seq matches a pending edit resolves it.
          this._resolveRejected(msg, record)
          // scripting-4c AC4 — and an error whose seq matches a pending
          // ACTIVATION is reported as `activate:refused`. The two maps are
          // separate, so neither can resolve the other's seq (P15).
          this._resolveActivateRefused(msg, record)
          this.emit('error', err)
          break
        }
      }
    }

    const onClose = (codeOrEvent, reason) => {
      if (record !== this._connectionRecord) return
      this._clearConnectTimeout(record)
      // Z3 — the clock stops with the socket, before anything else.
      this._cancelClock(record)
      record.closing = true
      if (record.stale) return
      this._log('Connection closed')

      // 4b-1 E6 (M4) — the socket's close is one of the paths that abandons a
      // connection, so the role goes first, synchronously.
      this._releaseScriptHost()

      // Handle both call shapes:
      //   ws package:  onClose(code: number, reason: string)
      //   browser:     onClose(CloseEvent) via EventTarget
      let code = codeOrEvent
      let closeReason = reason
      if (codeOrEvent && typeof codeOrEvent === 'object') {
        code = codeOrEvent.code
        closeReason = codeOrEvent.reason
      }

      this._connectionRecord = null
      this._connected = false
      this._wsUrl = null
      this._ws = null
      this._worldReady = false
      this.canPlaceTeleporters = false
      this.canEdit = false
      // signin-sync I1 — no connection, no admission: back to unknown.
      this.signedIn = undefined
      this.userId = undefined
      // A3 — a socket close ends the connection with any pending edit.
      this._resolveAllPendingAsUnknown(record)
      this.emit('disconnected', {
        sessionId,
        url: wsUrl,
        reason: 'closed',
        code: typeof code === 'number' ? code : undefined,
        closeReason: (typeof closeReason === 'string' && closeReason.length > 0) ? closeReason : undefined,
      })
    }

    const onError = (evt) => {
      if (record !== this._connectionRecord) return
      if (record.stale || record.closing) return
      const err = evt instanceof Error ? evt : new Error(`WebSocket error connecting to ${wsUrl}`)
      err.sessionId = sessionId
      err.url = wsUrl
      this.emit('error', err)
    }

    // Prefer EventEmitter API (ws package in Node.js); fall back to EventTarget (browser)
    if (typeof ws.on === 'function') {
      ws.on('open',    onOpen)
      ws.on('message', (data) => dispatch(data))   // ws passes data directly
      ws.on('close',   (c, r) => onClose(c, r ? r.toString() : undefined))
      ws.on('error',   onError)
    } else {
      ws.addEventListener('open',    onOpen)
      ws.addEventListener('message', (evt) => dispatch(evt.data))   // MessageEvent.data
      ws.addEventListener('close',   onClose)
      ws.addEventListener('error',   onError)
    }

    // ---- Connect timeout (pre-brief #4) ----
    if (this._connectTimeout > 0) {
      record.connectTimeout = setTimeout(() => {
        if (record !== this._connectionRecord) return
        if (record.stale || record.closing) return
        // Follow #4's pinned order exactly:
        // 1) Clear the timer
        clearTimeout(record.connectTimeout)
        record.connectTimeout = undefined
        // Z3 — a connection that never opened keeps no clock.
        this._cancelClock(record)
        // 2) Mark stale + closing so no late events from this record
        record.stale = true
        record.closing = true
        // 4b-1 E6 (M4) — a connect timeout abandons the connection: the role
        // goes first, synchronously, before the socket is closed below.
        this._releaseScriptHost()
        // 3) Clear current-connection state
        this._connectionRecord = null
        this._connected = false
        this._wsUrl = null
        this.canEdit = false
        // signin-sync I1 — back to unknown.
        this.signedIn = undefined
        this.userId = undefined
        // A3 — a connect timeout ends the connection with any pending edit.
        this._resolveAllPendingAsUnknown(record)
        // 4) Close the socket (which may fire error/close later)
        try { ws.close() } catch { /* ignore */ }
        // 5) Emit error first, naming the target host
        const err = new Error(`Connection timed out connecting to ${wsUrl}`)
        err.sessionId = sessionId
        err.url = wsUrl
        this.emit('error', err)
        // 6) Then emit disconnected with reason 'timeout'
        this.emit('disconnected', { sessionId, url: wsUrl, reason: 'timeout' })
      }, this._connectTimeout)
    }

    return sessionId
  }

  /**
   * Disconnect from the current connection.
   * @param {string} [reason] - Optional reason for disconnect
   */
  disconnect(reason) {
    // 4b-1 E6 (M4) — before anything else on this path, and in particular
    // before the socket is closed below. `disconnect()`'s `disconnected` is
    // deferred to a setTimeout (and skipped entirely when a newer connection
    // exists by then), so a listener cannot rely on it to learn the role ended.
    this._releaseScriptHost()

    const record = this._connectionRecord
    if (!record) {
      // Even without a connection record, clear local pointer state
      this._clearPointerState()
      return
    }

    // Clear connect timeout if still pending (pre-brief #4)
    this._clearConnectTimeout(record)
    // Z3 — the connection's clock stops here: no timer outlives its connection.
    this._cancelClock(record)

    // Mark record as stale so late close can't clobber a new connection
    record.stale = true
    // Mark record as closing so messages/errors are ignored
    record.closing = true

    this._bumpWorldGen()
    this._cancelViewFlush()

    const prevSessionId = record.sessionId
    const prevUrl = record.url

    if (record.ws) {
      record.ws.close()
    }

    this._connectionRecord = null
    this._ws = null
    this._connected = false
    this._wsUrl = null
    this._worldReady = false
    this.canPlaceTeleporters = false
    this.canEdit = false
    // signin-sync I1 — no connection, no admission: back to unknown.
    this.signedIn = undefined
    this.userId = undefined
    this._clearPointerState()

    // A3 — every pending edit on this connection becomes edit:unknown at once.
    this._resolveAllPendingAsUnknown(record)

    // Emit disconnected asynchronously so tests using waitForEvent still work
    // (existing code registers the listener after calling disconnect).
    // Guard: if a newer connection exists by fire time, skip emitting stale
    // disconnected (pre-brief #6 Disconnect-then-Connect race — DEV FINDING 1).
    setTimeout(() => {
      if (this._connectionRecord) return   // superseded by a newer connection
      this.emit('disconnected', { sessionId: prevSessionId, url: prevUrl, reason: reason || 'client' })
    }, 0)
  }

  /**
   * Load a world from a static URL (no server required).
   * Rejects if a connection record is current (connecting, connected, or closing).
   * @param {string} url - HTTP URL to a .gltf or .glb file
   */
  async loadWorld(url) {
    if (this._hasActiveRecord) {
      throw new Error('Disconnect before loading a static world')
    }
    this._bumpWorldGen()
    const gen = this._worldGen
    const lastSlash = url.lastIndexOf('/')
    this._worldBaseUrl = lastSlash >= 0 ? url.substring(0, lastSlash + 1) : ''
    const io  = makeWebIO()
    let doc
    try {
      doc = await io.read(url)
    } catch (err) {
      if (this._worldGen !== gen) return // superseded — resolve without effect
      throw err
    }
    if (this._worldGen !== gen) return // superseded — resolve without effect
    this._finalizeWorldLoad(doc)
  }

  /**
   * Load a world from already-read file data (e.g. from drag-and-drop).
   * Rejects if a connection record is current (connecting, connected, or closing).
   * @param {string|ArrayBuffer} data - glTF JSON string or GLB ArrayBuffer
   * @param {string} [name] - Filename, used for logging only
   */
  async loadWorldFromData(data, name) {
    if (this._hasActiveRecord) {
      throw new Error('Disconnect before loading a static world')
    }
    this._bumpWorldGen()
    const gen = this._worldGen
    this._worldBaseUrl = null   // no URL to resolve relative refs against
    const io = makeWebIO()
    let doc
    try {
      if (typeof data === 'string') {
        doc = await io.readJSON({ json: JSON.parse(data), resources: {} })
      } else {
        doc = await io.readBinary(new Uint8Array(data))
      }
    } catch (err) {
      if (this._worldGen !== gen) return // superseded — resolve without effect
      throw err
    }
    if (this._worldGen !== gen) return // superseded — resolve without effect
    this._finalizeWorldLoad(doc)
  }

  /**
   * Report the local navigation state. Dropped silently if not connected.
   */
  setView({ position, look, move, velocity, up } = {}) {
    if (!this._connected) {
      if (this._debug) this._log('setView dropped — not connected')
      return
    }
    this._pendingView = { position, look, move, velocity, up }
    this._flushView()
  }

  // ---------------------------------------------------------------------------
  // Incoming message handlers
  // ---------------------------------------------------------------------------

  /**
   * 4b-1 E6 (M4) — the ONE place the role is given up. Called at the top of
   * every path that ABANDONS the current connection: `connect()` superseding
   * one, `disconnect()`, a connect timeout, and the socket's close.
   *
   * `canEdit` is reset together with the role, BEFORE the event (review N5):
   * otherwise a listener reading both in the same tick sees an owner without the
   * role and computes the other-tab text.
   *
   * When the role was NOT active the reset is quiet, with no event.
   *
   * @returns {boolean}  true when a signal was emitted
   */
  _releaseScriptHost() {
    const wasActive = this.scriptHost?.active === true
    this.scriptHost = { ...INACTIVE_ROLE }
    this.canEdit = false
    if (wasActive) this.emit('script-host:changed', { ...INACTIVE_ROLE })
    return wasActive
  }

  /**
   * 4b-1 E6 — a `script-host` message. The `dispatch` guard above already drops
   * one for a stale or closing record; a malformed message is ignored here.
   *
   * PER CONNECTION, GENERATIONS ONLY INCREASE. The high-water mark lives on the
   * connection record (review N4), so a new connection starts from zero:
   *   - `active: true` is accepted only with a `hostGen` GREATER than any seen
   *     on this connection;
   *   - `active: false` only with a `hostGen` AT LEAST the current one;
   *   - anything else is a late message from an earlier assignment, and is
   *     ignored.
   */
  _onScriptHost(msg, record) {
    const role = roleFromScriptHost(msg)
    if (role === null) return
    const seen = record.hostGenSeen ?? 0
    if (role.active ? !(role.hostGen > seen) : !(role.hostGen >= seen)) return
    record.hostGenSeen = role.hostGen
    this.scriptHost = { active: role.active, hostGen: role.hostGen }
    this.emit('script-host:changed', { ...this.scriptHost })
  }

  /**
   * scripting-4c AC4 — an inbound `activate`, which the server forwards ONLY to
   * the session that sent `script-ready` for the current generation.
   *
   * It is emitted as `activate` `{ node, from }` only while THIS client holds
   * the role, for the CURRENT hostGen, and for `event: 'select'`; anything else
   * is dropped without a word. `from` is the sender's session id, for the log
   * line: it is never identity or authority (spec §9), and the connection-record
   * guard at the top of `dispatch` has already dropped a stale socket's
   * messages.
   */
  _onActivate(msg, record) {
    if (this.scriptHost?.active !== true) return
    if (msg.hostGen !== this.scriptHost.hostGen) return
    if (msg.event !== 'select') return
    if (typeof msg.node !== 'string' || msg.node.length === 0) return
    this.emit('activate', { node: msg.node, from: msg.from })
  }

  async _onServerHello(msg, record) {
    if (record.stale || record.closing) return
    // Clear connect timeout — connection established (pre-brief #4)
    this._clearConnectTimeout(record)
    // Adopt server-assigned avatar node name
    if (msg.avatarNodeName) {
      this._avatarNodeName = msg.avatarNodeName
      if (this._avatarDescriptor) {
        this._avatarDescriptor.name = msg.avatarNodeName
      }
    }
    // Adopt server-assigned displayName (pre-brief #9)
    // The server has the final say — this overrides what the client sent.
    // Cross-origin visitors will have a server-assigned name,
    // authenticated users get their DB display_name.
    if (msg.displayName) {
      this._displayName = msg.displayName
      // Also update the avatar descriptor so outgoing avatar extras
      // carry the server-assigned name (pre-brief #9)
      if (this._avatarDescriptor) {
        if (!this._avatarDescriptor.extras) {
          this._avatarDescriptor.extras = {}
        }
        this._avatarDescriptor.extras.displayName = msg.displayName
      }
    }
    // Z3 (scripting-4a) — the clock starts here: the offset comes from
    // `hello.serverTime` and the first burst of pings goes at once. A new
    // `hello` cancels every timer the connection had.
    this._startClock(record, msg.serverTime)
    // Set canPlaceTeleporters from server hello (T2). A1: `canEdit` carries the
    // same value; the old name stays as an alias for one release.
    this.canPlaceTeleporters = msg.canPlaceTeleporters === true
    this.canEdit = msg.canEdit === true

    // signin-sync I1 — who the server admitted. `signedIn` absent means
    // UNKNOWN (`undefined`), never `false`; `userId` is kept exactly when the
    // server said signedIn true, and is never inherited from an earlier
    // connection (connect() resets both).
    this.signedIn = typeof msg.signedIn === 'boolean' ? msg.signedIn : undefined
    this.userId = (this.signedIn === true && typeof msg.userId === 'string')
      ? msg.userId
      : undefined

    // 4b-1 E6 — the role from `hello`, read with E5's rules and AFTER canEdit
    // is set, so ONE listener covers both `hello` and `script-host`. A hello
    // that fails is treated as inactive and logged once.
    const role = roleFromHello(msg)
    if (role === null && !this._scriptHostRoleWarned) {
      this._scriptHostRoleWarned = true
      console.warn('[AtriumClient] hello carries a malformed script-host role — treated as inactive')
    }
    this.scriptHost = role ?? { ...INACTIVE_ROLE }
    if (role?.active) record.hostGenSeen = Math.max(record.hostGenSeen ?? 0, role.hostGen)
    this.emit('script-host:changed', { ...this.scriptHost })

    this._connected = true
    console.log(`[AtriumClient] Session ${this._sessionId} (${this._displayName})`)
    this.emit('session:ready', {
      sessionId:   this._sessionId,
      displayName: this._displayName,
      url:         this._wsUrl,
      canPlaceTeleporters: this.canPlaceTeleporters,
      canEdit:     this.canEdit,
      // signin-sync I1 — who the server admitted for THIS connection.
      // `undefined` means the server didn't say: unknown, never anonymous.
      signedIn:    this.signedIn,
      userId:      this.userId,
    })
  }

  _onWorldDone(msg, record) {
    // world-done signals that som-dump and avatar setup are complete.
    // Currently consumed by the app layer; the client just logs it.
    if (this._debug) this._log('World load complete')
    this.emit('world-done', { sessionId: this._sessionId })
  }

  async _onSomDump(msg, record) {
    if (record.stale || record.closing) return
    const gen = this._worldGen
    const io  = makeWebIO()
    const doc = await io.readJSON({ json: msg.gltf, resources: {} })
    if (this._worldGen !== gen) return // stale — drop silently

    this._initSom(doc)
    this._attachMutationListeners()

    // Add own avatar to local SOM
    if (this._avatarDescriptor && this._som) {
      const node = this._som.ingestNode(this._avatarDescriptor)
      this._som.scene.addChild(node)
      if (this._debug) this._log(`Local avatar "${this._avatarNodeName}" added to SOM`)
    }

    // Announce avatar to server. A3 — the avatar announcement is NOT tracked:
    // the server sends avatar adds to everyone EXCEPT their sender, so it would
    // never resolve.
    if (this._avatarDescriptor && this._ws) {
      this._wsSend({
        type: 'add',
        id:   this._sessionId,
        seq:  ++this._sendSeq,
        node: this._avatarDescriptor,
      })
    }

    const meta = doc.getRoot().getExtras()?.atrium ?? {}
    this._worldReady = true
    this._emitWorldLoaded(meta)
    // Re-resolve external references
    this.resolveExternalReferences()
  }

  /**
   * Send a non-avatar add. Requires the current world fully loaded (T3).
   * @param {object} descriptor — glTF node descriptor
   * @returns {number} the seq of the request
   * @throws {Error} 'World not loaded' when _worldReady is false
   */
  addNode(descriptor) {
    if (!this._worldReady) throw new Error('World not loaded')
    const seq = ++this._sendSeq
    this._trackEdit(seq, { type: 'add', node: descriptor?.name ?? null })
    this._wsSend({
      type: 'add',
      seq,
      node: descriptor,
    })
    return seq
  }

  /**
   * Remove a non-avatar node by name (T3).
   * @param {string} name — node name to remove
   * @returns {number} the seq of the request
   * @throws {Error} 'World not loaded' when _worldReady is false
   */
  removeNode(name) {
    if (!this._worldReady) throw new Error('World not loaded')
    const seq = ++this._sendSeq
    this._trackEdit(seq, { type: 'remove', node: name })
    this._wsSend({
      type: 'remove',
      seq,
      node: name,
    })
    return seq
  }

  /**
   * Ask the server to rename a node (A8). Sends `{type:'send', node: oldName,
   * field: 'name', value: newName}` and returns the request seq.
   *
   * Nothing changes locally until the server accepts: on `edit:accepted` for
   * that seq the client applies the rename through `SOMDocument.renameNode` and
   * emits `som:rename`. On `edit:rejected` or `edit:unknown` there is nothing
   * to undo — local names and maps never changed.
   *
   * @param {string} oldName
   * @param {string} newName
   * @returns {number} the seq of the request
   * @throws {Error} 'World not loaded' when _worldReady is false
   */
  renameNode(oldName, newName) {
    if (!this._worldReady) throw new Error('World not loaded')
    const seq = ++this._sendSeq
    this.lastSendSeq = seq
    this._trackEdit(seq, { type: 'send', node: oldName, field: 'name', value: newName })
    this._wsSend({
      type: 'send',
      seq,
      node: oldName,
      field: 'name',
      value: newName,
    })
    return seq
  }

  /**
   * Z2a (scripting-4a) — set a model node's animation state. Sends
   * `{type:'send', node: name, field: 'extras.atrium.animation', value}` and
   * returns the request seq, exactly as `renameNode` does.
   *
   * Nothing changes locally until the answer. On the own echo the client applies
   * THE BROADCAST'S VALUE — the server stamps a Play's `startedAt` (L5 (b)), so
   * the sent value is not the stored one. The echo is matched by `requestSeq`,
   * never by value.
   *
   * @param {string} name
   * @param {object|null} value   the whole value, or null for Stop
   * @returns {number} the seq of the request
   * @throws {Error} 'World not loaded' when _worldReady is false
   */
  setModelAnimation(name, value) {
    if (!this._worldReady) throw new Error('World not loaded')
    const seq = ++this._sendSeq
    this.lastSendSeq = seq
    this._trackEdit(seq, { type: 'send', node: name, field: MODEL_ANIMATION_FIELD, value })
    this._wsSend({
      type: 'send',
      seq,
      node: name,
      field: MODEL_ANIMATION_FIELD,
      value,
    })
    return seq
  }

  /**
   * E6 (scripting-4b-1) — set a node's object id (the set-once leaf). Sends
   * `{type:'send', node: name, field: 'extras.atrium.objectId', value: id}` and
   * returns the request seq, exactly as `setModelAnimation` does.
   *
   * Nothing changes locally until the answer: on the own echo the client applies
   * THE BROADCAST'S value, as 4a's Z2a does. A rejection or an unknown answer
   * changes nothing.
   *
   * 4b-1 has NO UI caller; 4b-2's behaviour form is its first one.
   *
   * @param {string} name
   * @param {string} id
   * @returns {number} the seq of the request
   * @throws {Error} 'World not loaded' when _worldReady is false
   */
  setObjectId(name, id) {
    if (!this._worldReady) throw new Error('World not loaded')
    const seq = ++this._sendSeq
    this.lastSendSeq = seq
    this._trackEdit(seq, { type: 'send', node: name, field: OBJECT_ID_FIELD, value: id })
    this._wsSend({
      type: 'send',
      seq,
      node: name,
      field: OBJECT_ID_FIELD,
      value: id,
    })
    return seq
  }

  /**
   * scripting-4b-2 F5 — a generic tracked field send that applies NOTHING
   * locally. It exists for the behaviour runner, whose writes must reach the
   * host's own SOM only when the server answers, so the host's view and every
   * visitor's agree, and so the undo engine never sees a local SOM mutation it
   * did not make.
   *
   * The own echo applies THE BROADCAST'S VALUE through `applyLocally` +
   * `setPath`, then emits `som:set`, then `edit:accepted` — the Z2a pattern,
   * generalised to any field that asks for it (`applyEcho: true` on the tracked
   * edit). A rejection changes nothing. The Edit panel's own apply-first path is
   * untouched: its listeners do not set this flag.
   *
   * @param {string} name
   * @param {string} field
   * @param {*} value
   * @returns {number} the seq of the request
   * @throws {Error} 'World not loaded' when _worldReady is false
   */
  sendField(name, field, value) {
    if (!this._worldReady) throw new Error('World not loaded')
    const seq = ++this._sendSeq
    this.lastSendSeq = seq
    this._trackEdit(seq, { type: 'send', node: name, field, value, applyEcho: true })
    this._wsSend({
      type: 'send',
      seq,
      node: name,
      field,
      value,
    })
    return seq
  }

  // ---------------------------------------------------------------------------
  // scripting-4c AC4 — a click in a tab that is NOT the host
  // ---------------------------------------------------------------------------

  /**
   * scripting-4c AC4 — ask the server to run `nodeName`'s select behaviour in
   * the host's tab.
   *
   * NOTHING is sent before the current connection has reached BOTH
   * `session:ready` AND `world:loaded` (three states, Rev 1.2 S1): before
   * `session:ready` an `error` would fail a pending connect (P15), and before
   * `world:loaded` this client has no SOM to look the node up in.
   *
   * The seq → node name is recorded on the CONNECTION RECORD
   * (`record.pendingActivations`), beside `pendingEdits` and in its OWN map:
   * `_sendSeq` restarts at 0 on every connect (P21), so a map that outlived a
   * connection could name the wrong node. At most 16 entries, oldest dropped —
   * a successful activation has no answer, so entries cannot wait for one.
   * Within one connection every seq comes from the one `_sendSeq` counter, so
   * they cannot collide; across connections the counter restarts, which is why
   * the map is per record.
   *
   * @param {string} nodeName
   * @returns {number|null} the request seq, or null when nothing was sent
   */
  activate(nodeName) {
    const record = this._connectionRecord
    if (!record || record.stale || record.closing) return null
    if (!this._connected || !this._worldReady) return null
    if (typeof nodeName !== 'string' || nodeName.length === 0) return null

    const seq = ++this._sendSeq
    if (record.pendingActivations.size >= ACTIVATIONS_MAX) {
      record.pendingActivations.delete(record.pendingActivations.keys().next().value)
    }
    record.pendingActivations.set(seq, nodeName)
    this._wsSend({ type: 'activate', seq, node: nodeName, event: 'select' })
    return seq
  }

  /**
   * scripting-4c AC4 (Rev 1 M1) — this tab's runner is enabled: tell the server
   * so it may forward activations here.
   *
   * At most ONCE per `hostGen` per connection (`record.readySent`), and only
   * while this client holds the role. Called by the runner's `evaluate()`; the
   * once-per-generation rule is what makes the runner's repeats harmless.
   *
   * @returns {boolean} true when it sent
   */
  scriptReady() {
    const record = this._connectionRecord
    if (!record || record.stale || record.closing) return false
    if (this.scriptHost?.active !== true) return false
    const hostGen = this.scriptHost.hostGen
    if (record.readySent === hostGen) return false
    record.readySent = hostGen
    this._wsSend({ type: 'script-ready', hostGen })
    return true
  }

  // ---------------------------------------------------------------------------
  // Edit tracking (A3) — one pending map per connection record
  // ---------------------------------------------------------------------------

  /** Record a pending edit on the current connection record. */
  _trackEdit(seq, edit) {
    const record = this._connectionRecord
    if (!record || !record.pendingEdits) return
    record.pendingEdits.set(seq, edit)
  }

  /** Resolve a pending edit as accepted (a broadcast answering our request). */
  _resolveAccepted(msg, record) {
    const pending = record?.pendingEdits
    const requestSeq = msg?.requestSeq
    if (!pending || requestSeq == null) return
    if (msg.session !== this._sessionId) return
    if (!pending.has(requestSeq)) return
    const edit = pending.get(requestSeq)
    pending.delete(requestSeq)
    this.emit('edit:accepted', { seq: requestSeq, requestSeq, ...edit })
  }

  /** Resolve a pending edit as rejected (an error echoing our seq). */
  _resolveRejected(msg, record) {
    const pending = record?.pendingEdits
    if (!pending || msg?.seq == null) return
    if (!pending.has(msg.seq)) return
    const edit = pending.get(msg.seq)
    pending.delete(msg.seq)
    this.emit('edit:rejected', {
      seq: msg.seq, requestSeq: msg.seq, code: msg.code, message: msg.message, ...edit,
    })
  }

  /**
   * scripting-4c AC4 — an error whose seq is in THIS connection's
   * `pendingActivations` names the node that was refused, removes the entry and
   * emits `activate:refused`. A seq that is not in the map (an old socket's, an
   * edit's, an unknown one) is left alone — which is what keeps an activation
   * refusal out of `_resolveRejected`'s edit paths (P15) and stops a reconnect
   * from naming the previous connection's node (P21, Rev 1 S3).
   */
  _resolveActivateRefused(msg, record) {
    const pending = record?.pendingActivations
    if (!pending || msg?.seq == null) return
    if (!pending.has(msg.seq)) return
    const node = pending.get(msg.seq)
    pending.delete(msg.seq)
    this.emit('activate:refused', { node, code: msg.code, message: msg.message, seq: msg.seq })
  }

  /**
   * Resolve every pending edit on a record as `edit:unknown`. Called wherever a
   * connection ends: disconnect(), a socket close, a timeout, and connect()
   * replacing the connection.
   */
  _resolveAllPendingAsUnknown(record) {
    const pending = record?.pendingEdits
    if (!pending || pending.size === 0) return
    const entries = [...pending.entries()]
    pending.clear()
    for (const [seq, edit] of entries) {
      this.emit('edit:unknown', { seq, requestSeq: seq, ...edit })
    }
  }

  _onAdd(msg, record) {
    if (record.stale || record.closing) return
    if (!this._som) return

    // A7 — honour add.parent. A parent that is missing locally means this
    // client has missed state: do not insert the node anywhere, ask the app
    // layer to resync (it reconnects through trackConnect and gets a fresh
    // som-dump). The server adds the parent before any child and messages
    // arrive in order on one socket, so this is a recovery path.
    const parentName = msg.parent
    let parentNode = null
    if (parentName != null) {
      parentNode = this._som.getNodeByName(parentName)
      if (!parentNode) {
        if (this._debug) this._log(`som:desync — parent "${parentName}" not found for "${msg.node.name}"`)
        this.emit('som:desync', { reason: 'parent-not-found', node: msg.node.name, parent: parentName })
        return
      }
    }

    // R1 — the whole remote apply runs inside applyLocally: addChild dispatches
    // a childList mutation on the parent, and that must stay local (it is not
    // an edit anybody made and has no field to send).
    const node = this.applyLocally(() => {
      const somNode = this._som.ingestNode(msg.node)
      if (parentNode) parentNode.addChild(somNode)
      else this._som.scene.addChild(somNode)
      return somNode
    })
    this._attachNodeListeners(node)

    const nodeName = msg.node.name
    if (this._debug) this._log(`som:add "${nodeName}"`)

    // Check if this add corresponds to a pending peer join
    let peerSessionId = null
    let peerDisplayName = null
    for (const [sid, meta] of record.peerSessions) {
      if (meta.nodeName === nodeName) { peerSessionId = sid; peerDisplayName = meta.displayName; break }
    }

    this.emit('som:add', { nodeName })

    // A3/C5 — our own add broadcast resolves the pending add.
    this._resolveAccepted(msg, record)

    if (peerSessionId !== null) {
      this.emit('peer:join', { sessionId: peerSessionId, displayName: peerDisplayName, nodeName })
    }
  }

  _onRemove(msg, record) {
    if (record.stale || record.closing) return
    const isPeerRemove = msg.id != null && msg.node == null
    const peerMeta = isPeerRemove ? record.peerSessions.get(msg.id) : null

    if (isPeerRemove && !peerMeta) {
      if (this._debug) this._log(`peer:remove — no peer metadata for session ${msg.id}; skipping`)
      this.emit('peer:leave', { sessionId: msg.id, displayName: `User-${msg.id.slice(0, 4)}`, nodeName: null })
      return
    }

    const nodeName = isPeerRemove ? peerMeta.nodeName : msg.node

    if (nodeName && this._som) {
      // A6 — the SOM dispose path removes the whole subtree, so clients drop
      // the same nodes the server did. `som:remove` fires for the root only.
      const node = this._som.getNodeByName(nodeName)
      if (node) node.dispose()
    }

    if (this._debug) this._log(`som:remove "${nodeName}"`)
    this.emit('som:remove', { nodeName })

    // A3/C5 — our own remove broadcast resolves the pending remove.
    this._resolveAccepted(msg, record)

    if (isPeerRemove) {
      const displayName = peerMeta ? peerMeta.displayName : nodeName
      this.emit('peer:leave', { sessionId: msg.id, displayName, nodeName: peerMeta ? peerMeta.nodeName : null })
    }
  }

  _onSet(msg, record) {
    if (record.stale || record.closing) return
    if (!this._som) return

    // Case 1: own echo — the server reflected our send back. It is still not
    // re-applied (the local SOM already has it), but it now resolves the
    // pending edit (A3) and applies an accepted rename (A8).
    if (msg.session === this._sessionId) {
      this._resolveOwnSetEcho(msg, record)
      return
    }

    // Case 2 — A8/C6: another client's rename is applied through the name
    // setter, which goes through SOMDocument.renameNode. A thrown rename error
    // is logged and changes nothing.
    if (msg.field === 'name') {
      let renamed = false
      this._applyingRemote = true
      try {
        const target = this._som.getObjectByName(msg.node)
        if (target) {
          this._som.setPath(target, 'name', msg.value)
          renamed = true
        }
      } catch (err) {
        console.warn(`[AtriumClient] remote rename of "${msg.node}" failed: ${err.message}`)
      } finally {
        this._applyingRemote = false
      }

      if (renamed) this.emit('som:rename', { from: msg.node, to: msg.value })
      if (this._debug) this._log(`som:set ${msg.node}.name`)
      // G5 — where the set CAME FROM: another session's write.
      this.emit('som:set', { nodeName: msg.node, path: 'name', value: msg.value, origin: 'remote' })
      return
    }

    this._applyingRemote = true
    try {
      const target = this._som.getObjectByName(msg.node)
      if (target) this._som.setPath(target, msg.field, msg.value)
    } finally {
      this._applyingRemote = false
    }

    if (this._debug) this._log(`som:set ${msg.node}.${msg.field}`)
    // G5 — another session's field write.
    this.emit('som:set', { nodeName: msg.node, path: msg.field, value: msg.value, origin: 'remote' })
  }

  /**
   * An echo of our own `set`. The value is already in the local SOM, but the
   * echo resolves the pending edit (A3) and, for a rename, applies it locally
   * and emits `som:rename` (A8).
   *
   * Z2a (scripting-4a): the animation leaf is the ONE other field that IS
   * re-applied on its own echo — with THE BROADCAST'S value, never the value
   * that was sent, because the server stamps a Play's `startedAt` (L5 (b)). It
   * is matched by `requestSeq` like every other pending edit. Every other
   * field's own echo stays a no-op, exactly as before.
   */
  _resolveOwnSetEcho(msg, record) {
    const pending = record?.pendingEdits
    if (!pending || msg.requestSeq == null || !pending.has(msg.requestSeq)) return
    const edit = pending.get(msg.requestSeq)
    pending.delete(msg.requestSeq)

    if (edit.type === 'send' && edit.field === 'name') {
      let applied = false
      this.applyLocally(() => {
        // L6(a)/R3 — pass the object THIS client's namespace resolves for the
        // name as the rename target. If the client's SOM has diverged (the name
        // resolves to a different node), renameNode refuses with INVALID_VALUE
        // and changes nothing, rather than renaming whatever the server named.
        const target = this._som?.getObjectByName?.(edit.node) ?? null
        const result = this._som?.renameNode?.(edit.node, edit.value, target)
        applied = result?.ok === true
      })
      if (applied) this.emit('som:rename', { from: edit.node, to: edit.value })
      // A8 — som:set is still emitted for the `name` field, with nodeName set
      // to the old name, for compatibility. G5 — this tab's OWN echo, carrying
      // the `requestSeq` it answers.
      this.emit('som:set', { nodeName: edit.node, path: 'name', value: edit.value, origin: 'own', requestSeq: msg.requestSeq })
    }

    if (edit.type === 'send' && edit.field === MODEL_ANIMATION_FIELD) {
      this.applyLocally(() => {
        const target = this._som?.getObjectByName?.(edit.node) ?? null
        if (target) this._som.setPath(target, MODEL_ANIMATION_FIELD, msg.value)
      })
      // G5 — an OWN echo, with the seq it answers (a remote set has none).
      this.emit('som:set', { nodeName: edit.node, path: MODEL_ANIMATION_FIELD, value: msg.value, origin: 'own', requestSeq: msg.requestSeq })
    }

    // 4b-1 E6 (S-A) — the THIRD case, exactly 4a's Z2a pattern: the set-once
    // object id. Without it a `send` of the leaf would reach the server and
    // every OTHER client, but never the sender's own SOM.
    if (edit.type === 'send' && edit.field === OBJECT_ID_FIELD) {
      this.applyLocally(() => {
        const target = this._som?.getObjectByName?.(edit.node) ?? null
        if (target) this._som.setPath(target, OBJECT_ID_FIELD, msg.value)
      })
      this.emit('som:set', { nodeName: edit.node, path: OBJECT_ID_FIELD, value: msg.value, origin: 'own', requestSeq: msg.requestSeq })
    }

    // scripting-4b-2 F5 — the FOURTH case and the generic one: a tracked send
    // that asked for its echo to be applied (`sendField`). The runner's writes
    // apply the BROADCAST'S value, so the host's SOM matches every visitor's.
    if (edit.type === 'send' && edit.applyEcho === true) {
      this.applyLocally(() => {
        const target = this._som?.getObjectByName?.(edit.node) ?? null
        if (target) this._som.setPath(target, edit.field, msg.value)
      })
      // G5 — the runner's own echo is the site the overlay matches by seq.
      this.emit('som:set', { nodeName: edit.node, path: edit.field, value: msg.value, origin: 'own', requestSeq: msg.requestSeq })
    }

    this.emit('edit:accepted', { seq: msg.requestSeq, requestSeq: msg.requestSeq, ...edit })
  }

  _onView(msg, record) {
    if (record.stale || record.closing) return
    if (!this._som) return

    const peerMeta = record.peerSessions.get(msg.id)
    if (!peerMeta) {
      if (this._debug) this._log(`view from unknown session ${msg.id} — dropped`)
      return
    }

    const peerNode = this._som.getNodeByName(peerMeta.nodeName)
    if (peerNode) {
      this._applyingRemote = true
      try {
        if (msg.position) peerNode.translation = msg.position
        if (msg.look)     peerNode.rotation    = lookToQuaternion(msg.look)
      } finally {
        this._applyingRemote = false
      }
    }

    if (this._debug) this._log(`peer:view from ${peerMeta.displayName}`)
    this.emit('peer:view', {
      displayName: peerMeta.displayName,
      nodeName:    peerMeta.nodeName,
      position:    msg.position,
      look:        msg.look,
      move:        msg.move,
      velocity:    msg.velocity,
      up:          msg.up,
    })
  }

  _onJoin(msg, record) {
    if (record.stale || record.closing) return
    const avatar = msg.avatar
    if (!avatar || !avatar.nodeName) {
      if (this._debug) this._log(`join: missing avatar.nodeName for session ${msg.id} — dropping`)
      return
    }
    record.peerSessions.set(msg.id, { nodeName: avatar.nodeName, displayName: avatar.displayName ?? avatar.nodeName })
    // Sync to instance-level map for backward compat getters
    this._peerSessions = record.peerSessions
    if (this._debug) this._log(`join: ${avatar.displayName ?? avatar.nodeName} (${msg.id}, node: ${avatar.nodeName})`)
  }

  _onLeave(msg, record) {
    if (record.stale || record.closing) return
    record.peerSessions.delete(msg.id)
    this._peerSessions = record.peerSessions
    if (this._debug) this._log(`leave: ${msg.id}`)
  }

  // ---------------------------------------------------------------------------
  // Mutation listener attachment
  // ---------------------------------------------------------------------------

  _attachMutationListeners() {
    if (!this._som) return

    this._som.addEventListener('mutation', (event) => {
      if (event.detail.property === 'extras') {
        this._onLocalMutation('__document__', 'extras', event.detail.value)
      }
    })

    // H14/L6 — listeners on EVERY node in the document, not only `som.nodes`:
    // a legacy world's shadowed duplicate is not in `som.nodes` (first-wins),
    // and an edit to it must still be seen — and correctly NOT sent — until it
    // takes the name over.
    for (const node of this._som.allNodes) {
      this._attachNodeListeners(node)
    }

    for (const anim of this._som.animations) {
      this._attachAnimationListeners(anim)
    }

    // H14 — one listener per camera / light WRAPPER, not per `som.cameras` /
    // `som.lights` entry: a shared camera or light appears once per host.
    const camerasSeen = new Set()
    for (const somCamera of this._som.cameras) {
      if (camerasSeen.has(somCamera)) continue
      camerasSeen.add(somCamera)
      this._attachCameraListeners(somCamera)
    }

    const lightsSeen = new Set()
    for (const somLight of this._som.lights) {
      if (lightsSeen.has(somLight)) continue
      lightsSeen.add(somLight)
      this._attachLightListeners(somLight)
    }
  }

  _attachNodeListeners(node) {
    const nodeName = node.name

    if (nodeName === this._avatarNodeName) return

    // L6 (b)/review 2 #3 — ONE addressability guard for every callback a node
    // owns (its own listener and its mesh, primitive and material listeners):
    // send only when the SOM resolves the node's CURRENT name to this very
    // node. An edit to a shadowed node — or to a node whose name a non-node
    // object (an animation, a `.camera` alias) holds — is never sent under a
    // name that reaches something else; a node that takes the name over starts
    // sending.
    const send = (path, value) => {
      if (this._som?.getObjectByName(node.name) !== node) return
      this._onLocalMutation(node.name, path, value)
    }

    // A8 — listeners read the node's CURRENT name when they send, never a name
    // captured at attach time, so the first edit after a rename goes out under
    // the new name. The generic node listener never sends `name`; renames go
    // only through client.renameNode.
    node.addEventListener('mutation', (event) => {
      if (event.detail.property === 'name') return
      // R1 — a property-less mutation (a childList change) has no field to
      // send; forwarding it would put a malformed `send` on the wire.
      if (!event.detail.property) return
      send(event.detail.property, event.detail.value)
    })

    const mesh = node.mesh
    if (mesh) {
      mesh.addEventListener('mutation', (event) => {
        if (!event.detail.property) return
        send(`mesh.${event.detail.property}`, event.detail.value)
      })

      mesh.primitives.forEach((prim, i) => {
        prim.addEventListener('mutation', (event) => {
          if (!event.detail.property) return
          send(`mesh.primitives[${i}].${event.detail.property}`, event.detail.value)
        })

        const material = prim.material
        if (material) {
          material.addEventListener('mutation', (event) => {
            if (!event.detail.property) return
            send(`mesh.primitives[${i}].material.${event.detail.property}`, event.detail.value)
          })
        }
      })
    }
  }

  _attachLightListeners(somLight) {
    // review 2 #2 — the qualified name is read when the listener SENDS, not
    // captured here: a shared camera's or light's host can change when the host
    // it names goes away.
    somLight.addEventListener('mutation', (event) => {
      if (this._applyingRemote) return
      if (!event.detail.property) return
      const alias = somLight.qualifiedName
      if (!alias) return
      this._onLocalMutation(alias, event.detail.property, event.detail.value)
    })
  }

  _attachCameraListeners(somCamera) {
    // review 2 #2 — the qualified name is read when the listener SENDS, not
    // captured at attach time, so a camera whose host was removed is sent under
    // the surviving host's alias.
    somCamera.addEventListener('mutation', (event) => {
      if (this._applyingRemote) return
      if (!event.detail.property) return
      const alias = somCamera.qualifiedName
      if (!alias) return
      this._onLocalMutation(alias, event.detail.property, event.detail.value)
    })
  }

  _attachAnimationListeners(anim) {
    const animName = anim.name
    anim.addEventListener('mutation', (event) => {
      if (event.detail.property === 'playback') {
        this._onLocalMutation(animName, 'playback', event.detail.value)
      }
    })
  }

  _onLocalMutation(nodeName, path, value) {
    if (this._applyingRemote) return
    if (!this._connected) return
    const seq = ++this._sendSeq
    // A3 — record the seq where the caller can read it. Sends originate inside
    // SOM mutation listeners, so there is no return value to catch.
    this.lastSendSeq = seq
    this._trackEdit(seq, { type: 'send', node: nodeName, field: path, value })
    this._wsSend({ type: 'send', seq, node: nodeName, field: path, value })
  }

  // ---------------------------------------------------------------------------
  // setView send policy
  // ---------------------------------------------------------------------------

  _flushView() {
    if (!this._connected || !this._ws) return
    if (!this._pendingView) return

    const maxViewRate  = this._navInfo?.updateRate?.maxViewRate ?? 20
    const minInterval  = 1000 / maxViewRate
    const now          = Date.now()

    if (now - this._lastSentAt < minInterval) {
      if (!this._viewFlushTimer) {
        const delay = minInterval - (now - this._lastSentAt)
        this._viewFlushTimer = setTimeout(() => {
          this._viewFlushTimer = null
          this._flushView()
        }, delay)
        if (this._debug) this._log('view deferred (rate limit)')
      }
      return
    }

    const v = this._pendingView
    this._pendingView = null
    this._lastSentAt  = now

    const msg = {
      type:     'view',
      // D7 — one counter for every outgoing message, `view` included.
      seq:      ++this._sendSeq,
      position: v.position ?? [0, 0, 0],
      ...(v.look               && { look:     v.look }),
      ...(v.move               && { move:     v.move }),
      ...(v.velocity !== undefined && { velocity: v.velocity }),
      ...(v.up                 && { up:       v.up }),
    }

    if (this._debug) this._log('→ view', msg)
    this._wsSend(msg)
  }

  // ---------------------------------------------------------------------------
  // Internal utilities
  // ---------------------------------------------------------------------------

  _finalizeWorldLoad(doc) {
    this._initSom(doc)
    this._attachMutationListeners()
    const meta = doc.getRoot().getExtras()?.atrium ?? {}
    this._emitWorldLoaded(meta)
    this.resolveExternalReferences()
  }

  resolveExternalReferences() {
    if (!this._som || !this._worldBaseUrl) return

    const io    = makeWebIO()
    const tasks = []

    for (const node of this._som.nodes) {
      const source = node.extras?.atrium?.source
      if (!source) continue
      const containerName = node.name
      const resolvedUrl   = new URL(source, this._worldBaseUrl).href
      tasks.push(this._loadExternalRef(containerName, resolvedUrl, io))
    }

    return Promise.all(tasks)
  }

  async _loadExternalRef(containerName, url, io) {
    const gen = this._worldGen
    try {
      const resp = await this._fetch.call(globalThis, url);

      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching "${url}"`)

      let doc
      if (url.endsWith('.glb')) {
        const buffer = await resp.arrayBuffer()
        doc = await io.readBinary(new Uint8Array(buffer))
      } else {
        const text = await resp.text()
        doc = await io.readJSON({ json: JSON.parse(text), resources: {} })
      }

      if (this._worldGen !== gen) return // stale — drop silently

      var newNodes = null;
      this._applyingRemote = true;
      try {
          newNodes = this.som.ingestExternalScene(containerName, doc);
      } finally {
          this._applyingRemote = false;
      }

      for (const somNode of newNodes) {
        this._attachNodeListenersRecursive(somNode)
      }

      const meta = this._som.document.getRoot().getExtras()?.atrium ?? {}
      this._emitWorldLoaded({ ...meta, source: url, containerName })
    } catch (err) {
      if (this._worldGen !== gen) return // stale failure — no warning, no event
      console.warn(`[AtriumClient] Failed to resolve external reference "${url}" for container "${containerName}":`, err.message)
    }
  }

  _attachNodeListenersRecursive(somNode) {
    this._attachNodeListeners(somNode)
    for (const child of somNode.children) {
      this._attachNodeListenersRecursive(child)
    }
  }

  _initSom(doc) {
    this._som     = new SOMDocument(doc)
    this._navInfo = doc.getRoot().getExtras()?.atrium?.navigation ?? null
  }

  _clearViewState() {
    this._pendingView    = null
    this._lastSentAt     = 0
    this._viewFlushTimer = null
    this._sendSeq        = 0
    this.lastSendSeq     = null
  }

  _clearPointerState() {
    this._capturedNode      = null
    this._currentHoverNode  = null
    this._pointerDownTarget = null
  }

  _emitWorldLoaded(meta) {
    this._clearPointerState()
    const name          = meta.name          ?? undefined
    const desc          = meta.description   ?? undefined
    const author        = meta.author        ?? undefined
    const source        = meta.source        ?? undefined
    const containerName = meta.containerName ?? undefined
    if (!source) {
      console.log(`[AtriumClient] World loaded: ${name ?? '(unnamed)'}${author ? ` by ${author}` : ''}`)
      if (desc) console.log(`  ${desc}`)
    } else {
      this._log(`External ref loaded: "${containerName}" ← ${source}`)
    }
    this.emit('world:loaded', { name, description: desc, author, source, containerName })
  }

  _dispatchOnNode(node, type, detail) {
    if (!node._hasListeners(type)) return
    const evt = new SOMEvent(type, { target: node, ...detail })
    delete evt.detail.target
    node._dispatchEvent(evt)
  }

  _wsSend(msg) {
    if (this._ws && (this._ws.readyState === 1 || this._ws.readyState === WebSocket?.OPEN)) {
      this._ws.send(JSON.stringify(msg))
    }
  }

  _log(msg, data) {
    if (data !== undefined) {
      console.log(`[AtriumClient] ${msg}`, data)
    } else {
      console.log(`[AtriumClient] ${msg}`)
    }
  }
}