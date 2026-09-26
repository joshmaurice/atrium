// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { WebIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { SOMDocument, SOMEvent } from '@atrium/som'

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
// AtriumClient
// ---------------------------------------------------------------------------

export class AtriumClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {boolean}  [opts.debug=false]  - Gate verbose console logging
   * @param {Function} [opts.WebSocket]    - WebSocket constructor (injectable for testing)
   */
  constructor({ debug = false, WebSocket: WSImpl = globalThis.WebSocket, fetch: fetchImpl = globalThis.fetch } = {}) {
    super()
    this._debug   = debug
    this._WSImpl  = WSImpl
    this._fetch   = fetchImpl

    // Connection state — null when disconnected
    /** @type {{ sessionId, url, worldBaseUrl, ws, closing, peerSessions } | null} */
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
    this._viewSeq        = 0
    this._viewFlushTimer = null

    // Outbound send sequence counter
    this._sendSeq = 0

    // Loopback prevention flag — true while applying a remote set
    this._applyingRemote = false

    // Pointer event state — cleared on world:loaded and disconnect
    this._capturedNode      = null
    this._currentHoverNode  = null
    this._pointerDownTarget = null
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
  connect(wsUrl, { avatar, displayName, worldBaseUrl: optWorldBaseUrl } = {}) {
    // ---- Bump world gen ----
    const gen = this._worldGen + 1
    this._worldGen = gen
    this._cancelViewFlush()

    // ---- Capture previous sessionId, if any ----
    const previousSessionId = this._connectionRecord ? this._connectionRecord.sessionId : null

    // ---- Close previous socket ----
    const prevRecord = this._connectionRecord
    if (prevRecord) {
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

    // ---- Create new session identity ----
    const sessionId      = globalThis.crypto.randomUUID()
    const shortId        = sessionId.slice(0, 4)
    this._sessionId      = sessionId
    this._displayName    = displayName || `User-${shortId}`
    this._avatarNodeName = this._displayName
    this._avatarDescriptor = avatar ?? null
    if (this._avatarDescriptor) {
      this._avatarDescriptor.name = this._displayName
      this._avatarDescriptor.extras = { ...this._avatarDescriptor.extras, displayName: this._displayName }
      this._avatarDescriptor.extras.atrium = { ...(this._avatarDescriptor.extras.atrium ?? {}), ephemeral: true }
    }

    // ---- Derive or preserve worldBaseUrl ----
    if (optWorldBaseUrl !== undefined) {
      this._worldBaseUrl = optWorldBaseUrl
    } else {
      // Derive from connect URL's origin (ws:→http:)
      try {
        const parsed = new URL(wsUrl)
        this._worldBaseUrl = `${parsed.protocol}//${parsed.host}`
      } catch {
        this._worldBaseUrl = null
      }
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
      gen,
    }
    this._connectionRecord = record

    this._log(`Connecting to ${wsUrl}`)

    // ---- Create socket (catch synchronous throw - pre-brief #9) ----
    let ws
    try {
      ws = new this._WSImpl(wsUrl)
    } catch (err) {
      // Synchronous constructor failure — schedule async error + disconnected
      // so callers that register listeners on the returned sessionId still receive them.
      record.closing = true
      const errCopy = new Error(err.message || 'WebSocket constructor failed')
      errCopy.sessionId = sessionId
      errCopy.url = wsUrl
      setTimeout(() => {
        if (record.stale) return
        this.emit('error', errCopy)
      }, 0)
      setTimeout(() => {
        if (record.stale) return
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
      if (record.stale) return
      this._log('Connection open')
      if (record.closing) return
      ws.send(JSON.stringify({
        type: 'hello',
        id:   sessionId,
        capabilities: { tick: { interval: 5000 } },
      }))
    }

    // Raw data → string → parsed message dispatch
    const dispatch = async (raw) => {
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
        case 'tick':       /* ignored */                            break
        case 'pong':       /* ignored */                            break
        case 'error':
          this.emit('error', new Error(`${msg.code}: ${msg.message ?? ''}`))
          break
      }
    }

    const onClose = (code, reason) => {
      if (record.stale || record.closing) return
      this._log('Connection closed')
      this._connectionRecord = null
      this._connected = false
      this._wsUrl = null
      this._ws = null
      this.emit('disconnected', { sessionId, url: wsUrl, reason: reason ? String(reason) : undefined })
    }

    const onError = (evt) => {
      if (record.stale || record.closing) return
      this.emit('error', evt instanceof Error ? evt : new Error(String(evt)))
    }

    // Prefer EventEmitter API (ws package in Node.js); fall back to EventTarget (browser)
    if (typeof ws.on === 'function') {
      ws.on('open',    onOpen)
      ws.on('message', (data) => dispatch(data))   // ws passes data directly
      ws.on('close',   onClose)
      ws.on('error',   onError)
    } else {
      ws.addEventListener('open',    onOpen)
      ws.addEventListener('message', (evt) => dispatch(evt.data))   // MessageEvent.data
      ws.addEventListener('close',   onClose)
      ws.addEventListener('error',   onError)
    }

    return sessionId
  }

  /**
   * Disconnect from the current connection.
   * @param {string} [reason] - Optional reason for disconnect
   */
  disconnect(reason) {
    const record = this._connectionRecord
    if (!record) {
      // Even without a connection record, clear local pointer state
      this._clearPointerState()
      return
    }

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
    this._clearPointerState()

    // Emit disconnected asynchronously so tests using waitForEvent still work
    // (existing code registers the listener after calling disconnect).
    setTimeout(() => {
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

  async _onServerHello(msg, record) {
    if (record.stale || record.closing) return
    // Adopt server-assigned avatar node name
    if (msg.avatarNodeName) {
      this._avatarNodeName = msg.avatarNodeName
      if (this._avatarDescriptor) {
        this._avatarDescriptor.name = msg.avatarNodeName
      }
    }
    this._connected = true
    console.log(`[AtriumClient] Session ${this._sessionId} (${this._displayName})`)
    this.emit('session:ready', {
      sessionId:   this._sessionId,
      displayName: this._displayName,
      url:         this._wsUrl,
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

    // Announce avatar to server
    if (this._avatarDescriptor && this._ws) {
      this._wsSend({
        type: 'add',
        id:   this._sessionId,
        seq:  ++this._viewSeq,
        node: this._avatarDescriptor,
      })
    }

    const meta = doc.getRoot().getExtras()?.atrium ?? {}
    this._emitWorldLoaded(meta)
    // Re-resolve external references
    this.resolveExternalReferences()
  }

  _onAdd(msg, record) {
    if (record.stale || record.closing) return
    if (!this._som) return

    const node = this._som.ingestNode(msg.node)
    this._som.scene.addChild(node)
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
      const node = this._som.getNodeByName(nodeName)
      if (node) node.dispose()
    }

    if (this._debug) this._log(`som:remove "${nodeName}"`)
    this.emit('som:remove', { nodeName })

    if (isPeerRemove) {
      const displayName = peerMeta ? peerMeta.displayName : nodeName
      this.emit('peer:leave', { sessionId: msg.id, displayName, nodeName: peerMeta ? peerMeta.nodeName : null })
    }
  }

  _onSet(msg, record) {
    if (record.stale || record.closing) return
    if (!this._som) return
    // Case 1: own echo — server reflected our send back; skip
    if (msg.session === this._sessionId) return

    this._applyingRemote = true
    try {
      const target = this._som.getObjectByName(msg.node)
      if (target) this._som.setPath(target, msg.field, msg.value)
    } finally {
      this._applyingRemote = false
    }

    if (this._debug) this._log(`som:set ${msg.node}.${msg.field}`)
    this.emit('som:set', { nodeName: msg.node, path: msg.field, value: msg.value })
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

    for (const node of this._som.nodes) {
      this._attachNodeListeners(node)
    }

    for (const anim of this._som.animations) {
      this._attachAnimationListeners(anim)
    }

    for (const somCamera of this._som.cameras) {
      this._attachCameraListeners(somCamera)
    }

    for (const somLight of this._som.lights) {
      this._attachLightListeners(somLight)
    }
  }

  _attachNodeListeners(node) {
    const nodeName = node.name

    if (nodeName === this._avatarNodeName) return

    node.addEventListener('mutation', (event) => {
      this._onLocalMutation(nodeName, event.detail.property, event.detail.value)
    })

    const mesh = node.mesh
    if (mesh) {
      mesh.addEventListener('mutation', (event) => {
        if (!event.detail.property) return
        this._onLocalMutation(nodeName, `mesh.${event.detail.property}`, event.detail.value)
      })

      mesh.primitives.forEach((prim, i) => {
        prim.addEventListener('mutation', (event) => {
          if (!event.detail.property) return
          this._onLocalMutation(
            nodeName,
            `mesh.primitives[${i}].${event.detail.property}`,
            event.detail.value
          )
        })

        const material = prim.material
        if (material) {
          material.addEventListener('mutation', (event) => {
            if (!event.detail.property) return
            this._onLocalMutation(
              nodeName,
              `mesh.primitives[${i}].material.${event.detail.property}`,
              event.detail.value
            )
          })
        }
      })
    }
  }

  _attachLightListeners(somLight) {
    const alias = somLight.qualifiedName
    if (!alias) return
    somLight.addEventListener('mutation', (event) => {
      if (this._applyingRemote) return
      if (!event.detail.property) return
      this._onLocalMutation(alias, event.detail.property, event.detail.value)
    })
  }

  _attachCameraListeners(somCamera) {
    const alias = somCamera.qualifiedName
    if (!alias) return
    somCamera.addEventListener('mutation', (event) => {
      if (this._applyingRemote) return
      if (!event.detail.property) return
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
    this._wsSend({ type: 'send', seq: ++this._sendSeq, node: nodeName, field: path, value })
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
      seq:      ++this._viewSeq,
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
    this._viewSeq        = 0
    this._viewFlushTimer = null
    this._sendSeq        = 0
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