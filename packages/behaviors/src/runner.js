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

/**
 * The send seam's OWN producer id (`@internal`). V7 re-checks every entry's
 * producer when it leaves, and a fabricated queue entry has no engine record of
 * its own, so the seam's entries name this always-live producer. It is not a
 * SOM node: it is never scanned, never ticked and never sent to. Product code
 * never uses it.
 */
export const SEAM_PRODUCER_ID = '\u0000seam-producer'

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
  const engines = new Map()          // nodeName → { behaviourId, nodeName, generation, engine, reason }
  const queue = new Map()            // key → entry (insertion order is FIFO)
  const refusalLogged = new Set()    // V3 — `${behaviourId}|${key}|${code}`
  const droppedLogged = new Set()    // the target no longer resolves, keyed by the send key
  const refusedOnce = new Set()      // V7 — `${behaviourId}|${key}`, the checks at the opportunity
  const sendSeqs = new Map()         // V3 — the seq the server owes an answer for → its entry

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
    forgetBehaviour(record.behaviourId)
    // S3 — dropping one engine drops exactly its entries.
    for (const [key, entry] of [...queue]) if (entry.behaviourId === record.behaviourId) queue.delete(key)
  }

  /**
   * V3/V7 — the per-behaviour bookkeeping is forgotten when the behaviour is
   * disposed or RELOADED: a refusals or a drop logs again after a reload, and a
   * reloaded behaviour's old seqs are gone.
   */
  const forgetBehaviour = (behaviourId) => {
    for (const seq of [...sendSeqs.keys()]) if (sendSeqs.get(seq).behaviourId === behaviourId) sendSeqs.delete(seq)
    for (const set of [refusalLogged, refusedOnce, droppedLogged]) {
      for (const entry of [...set]) if (entry.startsWith(`${behaviourId}|`) || entry === behaviourId) set.delete(entry)
    }
  }

  /**
   * V8 (M4, M5) — every disable is a DISPOSE: the engine goes, its queued
   * entries and its seqs go, and the record stays with `engine: null` and the
   * reason so the panel can still show why. Nothing restarts it on its own.
   */
  const disableEngine = (nodeName, reason) => {
    const record = engines.get(nodeName)
    if (!record) return
    if (record.engine) { try { record.engine.dispose?.() } catch { /* total */ } }
    record.engine = null
    record.reason = reason
    for (const [key, entry] of [...queue]) if (entry.behaviourId === record.behaviourId) queue.delete(key)
    forgetBehaviour(record.behaviourId)
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
    /**
     * V3 (round 5) — 4a's FIVE keys, in 4a's order, with `startedAt: 0`: the
     * server stamps the real one (`playValue` relies on it), and the server's
     * `animationValueProblem` refuses a value with four keys. Stop stays null.
     */
    play: (objectId, clip, loop, speed) => enqueue(objectId, 'animation', 'play', { clip, playing: true, loop, speed, startedAt: 0 }, behaviourId, generation),
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
    // V7 — the generation is read BEFORE the old record is disposed, so a
    // reload really is a new generation (an entry the old generation queued is
    // stale even if something kept it).
    const previous = engines.get(nodeName)?.generation ?? 0
    disposeEngine(nodeName)
    if (value === null || value === undefined) return
    const generation = previous + 1

    if (value.enabled === false) {
      engines.set(nodeName, { behaviourId, nodeName, generation, engine: null, reason: 'disabled' })
      return
    }
    const verdict = loadBehavior(value, { ownId: atrium.objectId })
    if (verdict.problem) {
      engines.set(nodeName, { behaviourId, nodeName, generation, engine: null, reason: `invalid: ${verdict.problem}` })
      write(now(), nodeName, `behaviour disabled — ${verdict.message ?? verdict.problem}`)
      return
    }
    const nodeMap = value.nodeMap
    if (!nodeFor(nodeMap?.[0])) {
      engines.set(nodeName, { behaviourId, nodeName, generation, engine: null, reason: 'not-found' })
      write(now(), nodeName, `behaviour disabled — its own object id does not resolve`)
      return
    }
    for (let i = 1; i < nodeMap.length; i++) {
      if (!nodeFor(nodeMap[i])) {
        engines.set(nodeName, { behaviourId, nodeName, generation, engine: null, reason: `target-not-found: ${i}` })
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
      engines.set(nodeName, { behaviourId, nodeName, generation, engine: null, reason: `rejected: ${engine.message}` })
      write(now(), nodeName, `behaviour disabled — ${engine.message}`)
      return
    }
    engines.set(nodeName, { behaviourId, nodeName, generation, engine, reason: null })
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

  /** The engine record that produced an entry: behaviour id AND generation. */
  const findRecord = (behaviourId, generation) => {
    if (behaviourId === SEAM_PRODUCER_ID && generation === 1) return seamProducer
    return [...engines.values()].find((r) => r.behaviourId === behaviourId && r.generation === generation) ?? null
  }

  /** The send seam's producer: live, may write anywhere, never ticked. */
  const seamProducer = {
    behaviourId: SEAM_PRODUCER_ID,
    nodeName: null,
    generation: 1,
    engine: { mayWrite: () => true, disposed: false, dispose() {} },
    reason: null,
  }

  /** V7 — one drop log line per (behaviour, key). */
  const dropOnce = (entry, key, nodeName, message) => {
    const seen = `${entry.behaviourId}|${key}`
    if (refusedOnce.has(seen)) return
    refusedOnce.add(seen)
    write(now(), nodeName, message)
  }

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
      // V8 (M5) — the producer is found by the behaviour id AND the generation
      // `enqueue` already receives (looking it up by `nodeByName(objectId)` was
      // the bug: objectId is a UUID, not a name). Disabling it drops exactly
      // its own entries; every other behaviour's entries are kept.
      const record = findRecord(behaviourId, generation)
      if (record?.engine) {
        disableEngine(record.nodeName, 'over-send-cap')
        write(now(), record.nodeName, 'behaviour disabled — too many pending sends')
      }
      return false
    }
    // A later write to a queued key replaces its value in place; the key keeps
    // its place in the FIFO order.
    queue.set(key, { objectId, kind, field, value, behaviourId, generation, nodeName: node?.name })
    return true
  }

  /**
   * V7 (M1, M3) — ONE send opportunity: the first queued key, its producer
   * re-checked, its name resolved NOW, F4's authority rule re-applied and the
   * drag rule re-applied, all before the value goes out. Anything that fails
   * drops the entry and logs once per (behaviour, key).
   */
  const opportunity = () => {
    const [key, entry] = queue.entries().next().value ?? []
    if (!key) return
    queue.delete(key)

    // V7 (M1) — the producer must still be live: the entry's behaviour id AND
    // generation, and an engine that isn't disposed.
    const record = findRecord(entry.behaviourId, entry.generation)
    if (!record || !record.engine || record.engine.disposed) {
      dropOnce(entry, key, entry.nodeName ?? entry.objectId,
        'a behaviour send was dropped: its behaviour is no longer running')
      return
    }

    const node = nodeFor(entry.objectId)
    if (!node) {
      if (!droppedLogged.has(key)) {
        droppedLogged.add(key)
        write(now(), entry.nodeName ?? entry.objectId, 'a behaviour send was dropped: the target no longer resolves')
      }
      return
    }

    // V7 (M1) — F4's authority rule still holds, through the ADAPTER's own
    // predicate: one function, the same one the setters use, no second copy.
    let allowed = false
    try { allowed = record.engine.mayWrite?.(entry.objectId) === true } catch { allowed = false }
    if (!allowed) {
      dropOnce(entry, key, node.name,
        'a behaviour send was dropped: the target is no longer this behaviour\'s own node, a descendant of it, or a granted target')
      return
    }

    // V7 (M3) — the drag rule, with the SAME line the enqueue used: a write
    // queued before the gesture started must not go out during it, and nothing
    // is replayed when the gesture ends.
    if (isInGesture(node)) {
      dropOnce(entry, key, node.name, 'a behaviour send was dropped: the owner has an edit in progress')
      return
    }

    const seq = entry.kind === 'animation'
      ? client.setModelAnimation?.(node.name, entry.value)
      : entry.kind === 'light'
        ? client.sendField?.(`${node.name}.light`, entry.field, entry.value)
        : client.sendField?.(node.name, entry.field, entry.value)
    // V3 — the seq the server owes an answer for is recorded against its
    // behaviour, so an `edit:rejected` for it can be reported (and nothing else).
    if (typeof seq === 'number') {
      sendSeqs.set(seq, { behaviourId: entry.behaviourId, generation: entry.generation, key })
    }
  }

  /**
   * V3 — a refused behaviour send is REPORTED, once per (behaviour, key, code)
   * until that behaviour is reloaded. Nothing else happens: no retry, no
   * disable. A seq this runner never sent is ignored, and a disposed
   * behaviour's seqs are forgotten.
   */
  const onEditRejected = ({ seq, code, message } = {}) => {
    if (disposed) return
    const sent = sendSeqs.get(seq)
    if (!sent) return
    sendSeqs.delete(seq)
    const seen = `${sent.behaviourId}|${sent.key}|${code ?? ''}`
    if (refusalLogged.has(seen)) return
    refusalLogged.add(seen)
    const record = [...engines.values()].find((r) => r.behaviourId === sent.behaviourId)
    write(now(), record?.nodeName ?? null, `a behaviour send was refused: ${message || code || 'the server refused it'}`)
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
    for (const record of [...engines.values()]) {
      if (!record.engine) continue
      try { record.engine.tick?.() } catch { /* a disposed engine throws; skip it */ }
      // V8 (M4) — an engine the ADAPTER disposed (the step budget, an error) is
      // really gone: the record keeps its reason for the panel, its queued
      // entries and its seqs are dropped, the log says so ONCE, and that engine
      // is never called again.
      if (record.engine.disposed) {
        const reason = record.engine.reason ?? 'over-budget'
        disableEngine(record.nodeName, reason)
        write(time, record.nodeName, `behaviour disabled — ${reason}`)
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
    // V3 — a refused behaviour send is reported in the log.
    ['edit:rejected', onEditRejected],
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
     *
     * V7 re-checks each entry's producer when it leaves, so the seam's entries
     * are produced by the seam's OWN always-live producer (`SEAM_PRODUCER_ID`):
     * a fabricated entry has no engine record of its own. Pass an explicit
     * behaviour id and generation to fabricate a stale one.
     */
    enqueue: (objectId, kind, field, value, behaviourId = SEAM_PRODUCER_ID, generation = 1) =>
      enqueue(objectId, kind, field, value, behaviourId, generation),
    addEventListener: (type, fn) => events.addEventListener(type, fn),
    removeEventListener: (type, fn) => events.removeEventListener(type, fn),
  }
}
