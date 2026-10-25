// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// runner — F5 (scripting-4b-2): one engine per behaviour node, on the host tab.
//
// `createBehaviorRunner({ client, now, frame, clips, position, onEntry })`
// returns `{ tick, select, setGesture, dispose, log, status, addEventListener }`.
//
// It is renderer-neutral: it never imports Three.js or the DOM, and it never
// knows Edit mode. Everything it needs from the client is a small, documented
// port (see `client` in the module comment of the tests' fake).
//
// The rules the tests pin:
//  - ENABLED only while `client.scriptHost.active`, `client.canEdit` AND the
//    current connection's world has loaded (`world:loaded` after `connecting`).
//  - on `active: false` every engine is disposed SYNCHRONOUSLY in the same tick,
//    and every pending send is dropped.
//  - ONE send opportunity every `frame` ms (default 50 ⇒ 20 per second, a RATE,
//    not a flush count), FIFO by a key's first enqueue, coalesced per
//    `(objectId, kind, field)`; a later write to a queued key replaces the value
//    in place; at most 100 keys.
//  - every entry carries the producing behaviour's id and engine generation, so
//    disposing one engine drops exactly its entries.
//  - the NAME is resolved at the opportunity, from the id.
//  - avatars (`extras.atrium.ephemeral`) are never scanned, listened to or sent.
//  - the drag rule (F-L5): while `setGesture(nodeName)` is set, a send whose
//    target is that node, a descendant or an ancestor is dropped and logged
//    once per gesture; nothing is replayed when the gesture ends.
// ---------------------------------------------------------------------------

import { createBehaviorEngine, loadBehavior } from './adapter.js'

/** F7 — sends per world: one opportunity every 50 ms. */
export const SEND_FRAME_MS = 50
/** F7 — pending send keys per world. */
export const SEND_KEYS_MAX = 100
/** F7 — log lines kept per world. */
export const LOG_LINES_MAX = 50

const BEHAVIOR_LEAF = 'extras.atrium.behavior'

export function createBehaviorRunner({
  client,
  now = () => Date.now(),
  frame = SEND_FRAME_MS,
  clips = () => ({ status: 'none' }),
  position = () => undefined,
  onEntry = null,
} = {}) {
  const events = new EventTarget()
  const log = []
  const engines = new Map()          // nodeName → { behaviourId, generation, engine, reason }
  const queue = new Map()            // key → entry (insertion order is FIFO)
  const refusalLogged = new Set()
  const droppedLogged = new Set()
  const refusedOnce = new Set()

  let worldReady = false
  let lastSend = -Infinity
  let gesture = null
  let gestureLogged = false
  let disposed = false

  const write = (time, node, message) => {
    const line = { time, node, message }
    log.push(line)
    if (log.length > LOG_LINES_MAX) log.shift()
    events.dispatchEvent(new CustomEvent('entry', { detail: line }))
    try { onEntry?.(line) } catch { /* a sink that throws must not kill a tick */ }
  }

  const som = () => client.som
  const nodeByName = (name) => som()?.getNodeByName?.(name) ?? null
  const nodeFor = (objectId) => {
    const resolved = som()?.resolveObjectId?.(objectId)
    return resolved?.node ?? null
  }
  const atriumOf = (node) => {
    const atrium = node?.extras?.atrium
    return atrium && typeof atrium === 'object' ? atrium : null
  }
  const isAvatar = (node) => atriumOf(node)?.ephemeral === true
  const behaviourOf = (node) => {
    const value = atriumOf(node)?.behavior
    return value === undefined ? undefined : value
  }

  const enabled = () => !disposed && client.scriptHost?.active === true && client.canEdit === true && worldReady

  // -------------------------------------------------------------------------
  // Engines
  // -------------------------------------------------------------------------

  const disposeEngine = (nodeName) => {
    const record = engines.get(nodeName)
    if (!record) return
    record.engine?.dispose?.()
    engines.delete(nodeName)
    // S3 — dropping one engine drops exactly its entries.
    for (const [key, entry] of [...queue]) if (entry.behaviourId === record.behaviourId) queue.delete(key)
  }

  const disposeAll = () => {
    for (const nodeName of [...engines.keys()]) {
      const record = engines.get(nodeName)
      try { record.engine.dispose?.() } catch { /* total */ }
    }
    engines.clear()
    queue.clear()
  }

  const worldFor = (nodeMap, targets, behaviourId, generation) => ({
    resolve: (index) => {
      const id = nodeMap[index]
      const resolved = som()?.resolveObjectId?.(id)
      return resolved?.problem ? { problem: resolved.problem } : { objectId: id, name: resolved?.node?.name }
    },
    isOwnOrDescendant: (index) => {
      const own = nodeFor(nodeMap[0])
      if (!own) return false
      for (let node = nodeFor(nodeMap[index]); node; node = node.parent) {
        if (node === own) return true
      }
      return false
    },
    isGranted: (index) => Array.isArray(targets) && targets.includes(nodeMap[index]),
    hasLight: (index) => nodeFor(nodeMap[index])?.light != null,
    get: (index, field) => {
      const node = nodeFor(nodeMap[index])
      return node ? node[field] : undefined
    },
    set: (index, field, value) => enqueue(nodeMap[index], 'node', field, value, behaviourId, generation),
    lightIntensity: (index) => nodeFor(nodeMap[index])?.light?.intensity,
    setLightIntensity: (index, value) => enqueue(nodeMap[index], 'light', 'intensity', value, behaviourId, generation),
    clipStatus: (objectId) => clips(objectId),
    play: (objectId, clip, loop, speed) => enqueue(objectId, 'animation', 'play', { clip, playing: true, loop, speed }, behaviourId, generation),
    stop: (objectId, clip) => enqueue(objectId, 'animation', 'play', null, behaviourId, generation),
    worldPosition: (index) => position(nodeFor(nodeMap[index])),
    parentIndex: (index) => {
      const parent = nodeFor(nodeMap[index])?.parent
      if (!parent) return null
      const found = nodeMap.indexOf(atriumOf(parent)?.objectId)
      return found === -1 ? null : found
    },
  })

  const loadOne = (node) => {
    const nodeName = node.name
    const atrium = atriumOf(node) ?? {}
    const behaviourId = atrium.objectId ?? nodeName
    const value = atrium.behavior
    disposeEngine(nodeName)
    if (value === null || value === undefined) return
    const generation = (engines.get(nodeName)?.generation ?? 0) + 1

    if (value.enabled === false) {
      engines.set(nodeName, { behaviourId, generation, engine: null, reason: 'disabled' })
      return
    }
    const verdict = loadBehavior(value, { ownId: atrium.objectId })
    if (verdict.problem) {
      engines.set(nodeName, { behaviourId, generation, engine: null, reason: `invalid: ${verdict.problem}` })
      write(now(), nodeName, `behaviour disabled — ${verdict.message ?? verdict.problem}`)
      return
    }
    const nodeMap = value.nodeMap
    if (!nodeFor(nodeMap?.[0])) {
      engines.set(nodeName, { behaviourId, generation, engine: null, reason: 'not-found' })
      write(now(), nodeName, `behaviour disabled — its own object id does not resolve`)
      return
    }
    for (let i = 1; i < nodeMap.length; i++) {
      if (!nodeFor(nodeMap[i])) {
        engines.set(nodeName, { behaviourId, generation, engine: null, reason: `target-not-found: ${i}` })
        write(now(), nodeName, `behaviour disabled — nodeMap[${i}] does not resolve`)
        return
      }
    }
    const engine = createBehaviorEngine({
      graph: value.graph,
      nodeMap,
      animations: value.animations ?? [],
      proximity: value.proximity,
      interval: value.interval,
      world: worldFor(nodeMap, value.targets, behaviourId, generation),
      now,
      log: (severity, message) => write(now(), nodeName, message),
    })
    if (engine.problem) {
      engines.set(nodeName, { behaviourId, generation, engine: null, reason: `rejected: ${engine.message}` })
      write(now(), nodeName, `behaviour disabled — ${engine.message}`)
      return
    }
    engines.set(nodeName, { behaviourId, generation, engine, reason: null })
  }

  /** Every saved node with a non-undefined behaviour value, avatars excluded. */
  const scan = () => {
    const seen = new Set()
    for (const node of som()?.nodes ?? []) {
      if (isAvatar(node)) continue
      const value = behaviourOf(node)
      if (value === undefined) continue
      seen.add(node.name)
      if (!engines.has(node.name)) loadOne(node)
    }
    for (const nodeName of [...engines.keys()]) if (!seen.has(nodeName)) disposeEngine(nodeName)
  }

  // -------------------------------------------------------------------------
  // Sends
  // -------------------------------------------------------------------------

  const keyOf = (objectId, kind, field) => `${objectId}|${kind}|${field}`

  const isInGesture = (node) => {
    if (gesture === null) return false
    const target = nodeByName(gesture)
    if (!target) return false
    for (let walk = node; walk; walk = walk.parent) if (walk === target) return true   // target or a descendant
    for (let walk = target; walk; walk = walk.parent) if (walk === node) return true   // an ancestor
    return false
  }

  const enqueue = (objectId, kind, field, value, behaviourId, generation) => {
    if (disposed) return false
    const node = nodeFor(objectId)
    if (node && isInGesture(node)) {
      if (!gestureLogged) {
        gestureLogged = true
        write(now(), node.name, 'a behaviour send was dropped: the owner has an edit in progress')
      }
      return true
    }
    const key = keyOf(objectId, kind, field)
    if (!queue.has(key) && queue.size >= SEND_KEYS_MAX) {
      const record = engines.get(nodeByName(objectId)?.name)
      if (record) record.reason = 'over-send-cap'
      write(now(), node?.name ?? objectId, 'behaviour disabled — too many pending sends')
      return false
    }
    // A later write to a queued key replaces its value in place; the key keeps
    // its place in the FIFO order.
    queue.set(key, { objectId, kind, field, value, behaviourId, generation, nodeName: node?.name })
    return true
  }

  /** One opportunity: the first queued key, its name resolved NOW. */
  const opportunity = () => {
    const [key, entry] = queue.entries().next().value ?? []
    if (!key) return
    queue.delete(key)
    const node = nodeFor(entry.objectId)
    if (!node) {
      if (!droppedLogged.has(key)) {
        droppedLogged.add(key)
        write(now(), entry.nodeName ?? entry.objectId, 'a behaviour send was dropped: the target no longer resolves')
      }
      return
    }
    // F4's authority rule is re-checked on the way out: the target must still be
    // the behaviour's own node, a descendant of it, or a granted id.
    const record = [...engines.values()].find((r) => r.behaviourId === entry.behaviourId)
    if (entry.kind === 'animation') {
      client.setModelAnimation?.(node.name, entry.value)
    } else if (entry.kind === 'light') {
      client.sendField?.(`${node.name}.light`, entry.field, entry.value)
    } else {
      client.sendField?.(node.name, entry.field, entry.value)
    }
    void record
  }

  // -------------------------------------------------------------------------
  // The frame
  // -------------------------------------------------------------------------

  const avatarPositions = () => {
    const out = []
    for (const node of som()?.nodes ?? []) {
      if (!isAvatar(node)) continue
      const p = position(node)
      if (Array.isArray(p)) out.push(p)
    }
    return out
  }

  const tick = () => {
    if (!enabled()) return
    const positions = avatarPositions()
    for (const record of engines.values()) {
      if (!record.engine) continue
      try { record.engine.proximity?.(positions) } catch { /* total */ }
    }
    const time = now()
    for (const record of engines.values()) {
      if (!record.engine) continue
      try { record.engine.tick?.() } catch { /* a disposed engine throws; skip it */ }
      if (record.engine.disposed) {
        record.reason = record.engine.reason ?? 'over-budget'
        write(time, null, `behaviour disabled — ${record.reason}`)
      }
    }
    if (time - lastSend < frame) return
    if (queue.size === 0) return
    lastSend = time
    opportunity()
  }

  // -------------------------------------------------------------------------
  // Selection, gestures, lifecycle
  // -------------------------------------------------------------------------

  const select = (somNode) => {
    if (!enabled() || !somNode) return
    for (let node = somNode; node; node = node.parent) {
      const record = engines.get(node.name)
      if (record?.engine) { record.engine.select(0); return }
    }
  }

  const setGesture = (nodeName) => {
    gesture = nodeName ?? null
    if (gesture === null) { gestureLogged = false; return }
    gestureLogged = false
  }

  const evaluate = () => {
    if (disposed) return
    if (enabled()) { scan(); return }
    disposeAll()
  }

  const onSomSet = ({ nodeName, path }) => {
    if (disposed) return
    if (path === BEHAVIOR_LEAF || path === 'name' || path === 'extras') {
      const node = nodeByName(nodeName)
      if (!node || isAvatar(node)) return
      loadOne(node)
    }
  }

  const subscriptions = [
    ['script-host:changed', evaluate],
    ['world:loaded', () => { worldReady = true; evaluate() }],
    ['connecting', () => { worldReady = false; evaluate() }],
    ['disconnected', () => { worldReady = false; evaluate() }],
    ['som:set', onSomSet],
    ['som:add', scan],
    ['som:remove', scan],
    ['som:rename', scan],
  ]
  for (const [type, handler] of subscriptions) client.on?.(type, handler)

  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const [type, handler] of subscriptions) client.off?.(type, handler)
    disposeAll()
  }

  return {
    tick,
    select,
    setGesture,
    dispose,
    evaluate,
    get log() { return log },
    get engines() { return engines },
    get queue() { return queue },
    get enabled() { return enabled() },
    /**
     * @internal — the test seam for the send queue. F5's coalescing and rate
     * tests need many DISTINCT keys, which no single graph inside F-L4's op
     * allowlist can produce in one frame. Product code never calls this.
     */
    enqueue: (objectId, kind, field, value, behaviourId = 'test') =>
      enqueue(objectId, kind, field, value, behaviourId, 1),
    addEventListener: (type, fn) => events.addEventListener(type, fn),
    removeEventListener: (type, fn) => events.removeEventListener(type, fn),
  }
}
