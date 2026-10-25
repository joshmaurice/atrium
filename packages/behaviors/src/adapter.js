// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// adapter — F4 (scripting-4b-2): one engine per behaviour per load.
//
// `createBehaviorEngine({ graph, nodeMap, animations, proximity, interval,
// world, now, setTimeout, clearTimeout, log })` returns
// `{ tick, select, proximity, dispose }` and owns ONE BasicBehaveEngine.
//
// The rules the tests pin, and where they come from:
//  - `loadBehaveGraph(graph, false)` (S3): `true` would run the onStart queue at
//    once AND start the engine's own setTimeout tick loop (§2.3).
//  - `engine.processNodeStarted` is set ON THE ENGINE (S1): the spike's
//    `bridgeEngineHooks()` does not carry that hook over, and the decorator's
//    own property would never be seen.
//  - the step budget throws past 10,000 node starts in one tick; the tick
//    wrapper catches ANY throw (a budget overflow, a stack overflow from a
//    cycle) and DISPOSES the engine (S5) — a parked engine would keep its
//    mid-throw state and whatever it scheduled.
//  - the `world` interface is total: every call is a return value, a failure is
//    never a throw (Rev 2, S4).
//  - authority: a write reaches the behaviour's own node, a descendant of it in
//    the SOM, or an id in `targets`; anything else is refused, logged once per
//    (index, field) and the graph continues on `out` (never throws, S3).
//  - the only timer in the round is the adapter's own interval timer (M2); it
//    is cleared with the INJECTED clearTimeout before `engine.dispose()`.
// ---------------------------------------------------------------------------

import {
  BasicBehaveEngine, ADecorator, GraphRejectedError, validateInteractivityGraph,
} from '@khronosgroup/gltf-interactivity-engine'

import { behaviorCheck } from './behavior-spec.js'

/** F7 — steps per tick per behaviour. */
export const STEP_BUDGET = 10000

/** F4 — the log line's cut. */
export const LOG_MESSAGE_MAX = 200

const CUSTOM_EVENT_PREFIX = 'KHR_INTERACTIVITY:'

// ---------------------------------------------------------------------------
// The engine's `IEventBus`, on `EventTarget` (the engine's own DOMEventBus
// needs `document`). The spike's `NodeEventBus`, carried over verbatim in
// behaviour; the adapter owns it and clears it on dispose().
// ---------------------------------------------------------------------------

export class NodeEventBus {
  constructor() {
    this.target = new EventTarget()
    this.eventList = []
    this.custom = {}
    this.listeners = {}
    this.varI = {}
    this.ptrI = {}
  }

  getEventList = () => this.eventList
  clearEventList = () => { this.eventList = [] }
  addEvent = (e) => { this.eventList.push(e) }

  addCustomEventListener = (name, func) => {
    if (!this.custom[name]) {
      this.custom[name] = []
      const listener = (e) => this.custom[name].forEach((f) => {
        this.eventList.push({ func: () => f(e), inSocketId: name })
      })
      this.target.addEventListener(name, listener)
      this.listeners[name] = listener
    }
    this.custom[name].push(func)
  }

  dispatchCustomEvent = (name, vals) => this.target.dispatchEvent(new CustomEvent(name, { detail: vals }))
  getCustomEventsNames = () => Object.keys(this.custom)

  clearCustomEventListeners = () => {
    for (const [name, listener] of Object.entries(this.listeners)) this.target.removeEventListener(name, listener)
    this.custom = {}
    this.listeners = {}
  }

  setVariableInterpolationCallback = (v, a) => { this.varI[v] = a }
  clearVariableInterpolation = (v) => { delete this.varI[v] }
  getVariableInterpolationCallbacks = () => this.varI
  setPointerInterpolationCallback = (p, a) => { this.ptrI[p] = a }
  clearPointerInterpolation = (p) => { delete this.ptrI[p] }
  getPointerInterpolationCallbacks = () => this.ptrI
}

/** Thrown by the step hook when one tick runs past STEP_BUDGET node starts. */
export class BudgetExceeded extends Error {}

/**
 * F4 — install the budgeted `flow/while` and `flow/for` subclasses (the spike's
 * `t1c`): every condition / endIndex evaluation counts as a step, so a
 * body-less loop is bounded too. Installed on EVERY engine even though F-L4
 * refuses those ops — defence in depth, with its own test.
 */
export function installBudgetedLoops(engine) {
  for (const op of ['flow/while', 'flow/for']) {
    const Base = engine.registry.get(op)
    if (!Base) continue
    const Budgeted = class extends Base {
      evaluateRequiredValues(...a) { this.graphEngine.processNodeStarted(this); return super.evaluateRequiredValues(...a) }
      evaluateAllValues(...a) { this.graphEngine.processNodeStarted(this); return super.evaluateAllValues(...a) }
    }
    Budgeted.init = Base.init
    engine.registry.set(op, Budgeted)
  }
}

// ---------------------------------------------------------------------------
// The decorator: pointers registered ONLY for nodeMap indices.
// ---------------------------------------------------------------------------

class BehaviorDecorator extends ADecorator {
  constructor(engine, { nodeMap, world, logOnce, mayWrite }) {
    super(engine)
    this.nodeMap = nodeMap
    this.world = world
    this.logOnce = logOnce
    this.mayWrite = mayWrite
    this.worldNodes = nodeMap.map(() => ({}))
    this.worldAnimations = []

    this.processNodeStarted = () => {}
    this.processAddingNodeToQueue = () => {}
    this.processExecutingNextNode = () => {}
    this.getWorld = () => ({ nodes: this.worldNodes, animations: this.worldAnimations })
    // The SOM parent of a nodeMap entry, as a nodeMap index — `undefined` when
    // the parent isn't in nodeMap, which is what stops the engine's own
    // select walk-up. (`world.parentIndex` is the one addition to F4's pinned
    // world interface: the interface has no way to reach a parent otherwise.)
    this.getParentNodeIndex = (i) => {
      const parent = world.parentIndex?.(i)
      return (typeof parent === 'number' && parent >= 0 && parent < nodeMap.length) ? parent : undefined
    }
    this.startAnimation = (index, start, end, speed, cb) => this.onAnimation('start', index, speed)
    this.stopAnimation = (index) => this.onAnimation('stop', index, 0)
    this.stopAnimationAt = (index, t, cb) => { this.onAnimation('stop', index, 0); cb?.() }

    this.bridgeEngineHooks()
    this.registerKnownPointers()
  }

  /** F4 — the pointer table: one entry per nodeMap index, plus a light per host. */
  registerKnownPointers() {
    for (let i = 0; i < this.nodeMap.length; i++) {
      this.registerJsonPointer(`/nodes/${i}/translation`,
        () => asArray(this.world.get(i, 'translation')),
        (_p, v) => this.write(i, 'translation', asArray(v)), 'float3', false)
      this.registerJsonPointer(`/nodes/${i}/rotation`,
        () => asArray(this.world.get(i, 'rotation')),
        (_p, v) => this.write(i, 'rotation', asArray(v)), 'float4', false)
      this.registerJsonPointer(`/nodes/${i}/scale`,
        () => asArray(this.world.get(i, 'scale')),
        (_p, v) => this.write(i, 'scale', asArray(v)), 'float3', false)
      this.registerJsonPointer(`/nodes/${i}/extensions/KHR_node_visibility/visible`,
        () => [this.world.get(i, 'visible')],
        (_p, v) => this.write(i, 'visible', Array.isArray(v) ? v[0] : v), 'bool', false)
      if (this.world.hasLight(i)) {
        this.registerJsonPointer(`/extensions/KHR_lights_punctual/lights/${i}/intensity`,
          () => [this.world.lightIntensity(i)],
          (_p, v) => this.writeLight(i, Array.isArray(v) ? v[0] : v), 'float', false)
      }
    }
  }

  /** A node-field write: authority first, then the world; a failure is a log line. */
  write(i, field, value) {
    if (!this.mayWrite(i)) { this.logOnce(i, field, 'refused'); return }
    let ok = false
    try { ok = this.world.set(i, field, value) === true } catch { ok = false }
    if (!ok) this.logOnce(i, field, 'refused')
  }

  writeLight(i, value) {
    if (!this.mayWrite(i)) { this.logOnce(i, 'intensity', 'refused'); return }
    let ok = false
    try { ok = this.world.setLightIntensity(i, value) === true } catch { ok = false }
    if (!ok) this.logOnce(i, 'intensity', 'refused')
  }

  /**
   * `animation/start` and `animation/stop` → the world's 4a leaf, under the SAME
   * authority predicate as a pointer write (Rev 2, M2). The clip is checked
   * against the model's `clipIds` only when the host's instance is `loaded` (S7).
   */
  onAnimation(kind, index, speed) {
    const entry = this.animations?.[index]
    if (!entry) { this.log(2, `animation index ${index} is past the table`); return }
    const object = entry.object
    const mapIndex = this.nodeMap.indexOf(object)
    if (mapIndex === -1 || !this.mayWrite(mapIndex)) {
      this.logOnce(mapIndex === -1 ? index : mapIndex, 'animation', 'refused')
      return
    }
    let status = { status: 'none' }
    try { status = this.world.clipStatus(object) ?? { status: 'none' } } catch { status = { status: 'none' } }
    if (status.status === 'loaded' && Array.isArray(status.clipIds) && !status.clipIds.includes(entry.clip)) {
      this.log(2, `clip "${entry.clip}" is not on this model`)
      return
    }
    try {
      if (kind === 'start') this.world.play(object, entry.clip, entry.loop, speed)
      else this.world.stop(object, entry.clip)
    } catch { /* the world interface is total; a throw is swallowed and logged */ }
  }
}

function asArray(v) { return Array.isArray(v) ? v : [v] }

// ---------------------------------------------------------------------------
// loadBehavior — the pure, reason-returning wrapper the runner and the form share.
// ---------------------------------------------------------------------------

/**
 * F4 — the verdict for a stored value, as `{ problem, message }`. `problem` is
 * null when the value may be loaded, an F1 reason code when the rule refuses it,
 * or `'not-an-object'` for a value that isn't a behaviour at all.
 *
 * @param {*} value
 * @param {{ownId?: string}} [options]
 */
export function loadBehavior(value, { ownId } = {}) {
  if (value === null || typeof value !== 'object') {
    return { problem: 'not-an-object', message: 'the behaviour is not a value' }
  }
  return behaviorCheck(value, { ownId })
}

// ---------------------------------------------------------------------------
// createBehaviorEngine
// ---------------------------------------------------------------------------

/**
 * F4 — one engine per behaviour per load.
 *
 * Rejection is a reason, not a throw: a graph the engine's validator refuses
 * comes back as `problem: 'rejected'` and `message`, and the object's methods
 * are inert. Callers that see a non-null `problem` should never tick it.
 *
 * @param {object} options
 * @param {object} options.graph        the KHR_interactivity graph
 * @param {string[]} options.nodeMap    graph node index → object id
 * @param {Array<{object: string, clip: string, loop: boolean}>} options.animations
 * @param {{radius: number}|undefined} options.proximity
 * @param {{seconds: number}|undefined} options.interval
 * @param {object} options.world        the SOM view (see the module comment)
 * @param {Function} [options.now]
 * @param {Function} [options.setTimeout]   injected, so tests can fake it
 * @param {Function} [options.clearTimeout] injected, so tests can fake it
 * @param {Function} [options.log]      (severity, message) → void
 * @param {boolean} [options.skipRules] TEST ONLY — bypass the validator
 *                                      (F11's probes-as-tests). Never in product code.
 * @returns {{tick: Function, select: Function, proximity: Function, dispose: Function,
 *            problem: string|null, message: string|null, reason: string|null,
 *            disposed: boolean}}
 */
export function createBehaviorEngine({
  graph, nodeMap = [], animations = [], proximity, interval,
  world, now = () => performance.now(),
  setTimeout: setT = globalThis.setTimeout,
  clearTimeout: clearT = globalThis.clearTimeout,
  log = () => {}, skipRules = false,
} = {}) {
  const lines = []
  const report = (severity, message) => {
    const text = String(message ?? '')
    const cut = text.length > LOG_MESSAGE_MAX ? text.slice(0, LOG_MESSAGE_MAX) : text
    lines.push({ severity, message: cut })
    try { log(severity, cut) } catch { /* a log sink that throws must not kill a tick */ }
  }

  const refusal = () => {}
  const inert = {
    problem: 'rejected',
    message: null,
    reason: null,
    disposed: true,
    tick() { throw new Error('behaviour engine was rejected') },
    select() {},
    proximity() {},
    dispose() {},
  }

  if (!skipRules) {
    try { validateInteractivityGraph(graph) } catch (error) {
      inert.message = `the graph is not a valid KHR_interactivity graph: ${error?.message ?? error}`
      return inert
    }
  }

  const eventBus = new NodeEventBus()
  let engine
  try {
    engine = new BasicBehaveEngine(60, eventBus)
  } catch (error) {
    inert.message = `the engine could not be created: ${error?.message ?? error}`
    return inert
  }

  let steps = 0
  let disposed = false
  let reason = null
  let intervalTimer = null

  const refusedOnce = new Set()
  const logOnce = (index, field, what) => {
    const key = `${index}:${field}`
    if (refusedOnce.has(key)) return
    refusedOnce.add(key)
    report(1, `refused ${what} write to ${nodeMap[index] ?? `index ${index}`}.${field}`)
  }
  const mayWrite = (index) => {
    if (index < 0 || index >= nodeMap.length) return false
    // A shadowed, ambiguous or vanished target is refused, not written: the
    // check is by objectId through `resolve`, so a rename is followed (F4).
    try {
      const resolved = world.resolve(index)
      if (resolved && resolved.problem) return false
    } catch { return false }
    if (index === 0) return true
    let own = false
    try { own = world.isOwnOrDescendant(index) === true } catch { own = false }
    if (own) return true
    let granted = false
    try { granted = world.isGranted(index) === true } catch { granted = false }
    return granted
  }

  const decorator = new BehaviorDecorator(engine, { nodeMap, world, logOnce, mayWrite })
  decorator.animations = animations
  decorator.worldAnimations = animations.map((a) => ({ name: a.clip }))

  // S1 — the hook goes on the ENGINE, not on the decorator's own property.
  engine.processNodeStarted = () => {
    if (++steps > STEP_BUDGET) throw new BudgetExceeded(`step budget ${STEP_BUDGET} exceeded`)
  }
  // `debug/log` reaches this hook; the message is cut to 200 characters (F4).
  engine.processDebugLog = (_node, message, severity) => report(severity ?? 0, message)
  installBudgetedLoops(engine)

  let loadError = null
  try {
    engine.loadBehaveGraph(graph, false)     // S3 — runGraph false
  } catch (error) {
    loadError = error instanceof GraphRejectedError
      ? `the engine refused the graph: ${error.message}`
      : `the engine refused the graph: ${error?.message ?? error}`
  }
  if (loadError) {
    try { engine.dispose() } catch { /* nothing to clean */ }
    inert.message = loadError
    return inert
  }

  // F4 — the adapter's own interval timer: first firing after `seconds`, then
  // every `seconds`, each dispatching the custom event so the graph runs on the
  // next tick. The ONLY timer in the round (M2).
  const seconds = interval?.seconds
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    const period = seconds * 1000
    const fire = () => {
      eventBus.dispatchCustomEvent(`${CUSTOM_EVENT_PREFIX}atrium/interval`, {})
      if (!disposed) intervalTimer = setT(fire, period)
    }
    intervalTimer = setT(fire, period)
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (intervalTimer !== null) { try { clearT(intervalTimer) } catch { /* total */ } intervalTimer = null }
    try { engine.dispose() } catch { /* total */ }
    eventBus.clearCustomEventListeners()
    for (const key of Object.keys(eventBus.varI)) delete eventBus.varI[key]
    for (const key of Object.keys(eventBus.ptrI)) delete eventBus.ptrI[key]
  }

  /** F4 — one `executeEventQueueTick()`; any throw is caught and disposes (S5). */
  const tick = () => {
    if (disposed) throw new Error('the behaviour engine is disposed')
    steps = 0
    try {
      engine.executeEventQueueTick()
    } catch (error) {
      disposed = true
      reason = (error instanceof BudgetExceeded || error instanceof RangeError) ? 'over-budget' : 'engine-error'
      if (intervalTimer !== null) { try { clearT(intervalTimer) } catch { /* total */ } intervalTimer = null }
      try { engine.dispose() } catch { /* total */ }
      report(2, reason === 'over-budget' ? 'the graph ran past its step budget' : `the graph threw: ${error?.message ?? error}`)
    }
  }

  /** F4 — `engine.select(index, 0, undefined, undefined)`. */
  const select = (index) => {
    if (disposed) return
    try { engine.select(index, 0, undefined, undefined) } catch { /* total */ }
  }

  /**
   * F-L7 — occupancy, not per-avatar: `enter` fires when the first avatar comes
   * inside while none was, `exit` when the last one leaves.
   */
  let occupied = false
  const proximityFn = (positions) => {
    if (disposed || !proximity || typeof proximity.radius !== 'number') return
    const origin = (() => {
      try { return world.worldPosition(0) } catch { return undefined }
    })()
    if (!Array.isArray(origin)) return
    const inside = (Array.isArray(positions) ? positions : []).some((p) => {
      if (!Array.isArray(p)) return false
      const dx = (p[0] ?? 0) - (origin[0] ?? 0)
      const dz = (p[2] ?? 0) - (origin[2] ?? 0)
      const dy = (p[1] ?? 0) - (origin[1] ?? 0)
      return Math.hypot(dx, dz) <= proximity.radius && Math.abs(dy) <= 2.0
    })
    if (inside === occupied) return
    occupied = inside
    eventBus.dispatchCustomEvent(`${CUSTOM_EVENT_PREFIX}atrium/${inside ? 'enter' : 'exit'}`, {})
  }

  return {
    tick,
    select,
    proximity: proximityFn,
    dispose,
    get problem() { return null },
    get message() { return null },
    get reason() { return reason },
    get disposed() { return disposed },
    get lines() { return lines },
    get steps() { return steps },
    /** @internal — the vendored engine, for the probes-as-tests only. */
    get engine() { return engine },
    get eventBus() { return eventBus },
    get now() { return now },
  }
}
