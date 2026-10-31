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

import {
  behaviorCheck, EXECUTABLE, isExecutableDeclaration, isSupportedPointerPath,
} from './behavior-spec.js'

/** F7 — steps per tick per behaviour. */
export const STEP_BUDGET = 10000

/** F4 — the log line's cut. */
export const LOG_MESSAGE_MAX = 200

/** G7 — pending delays per behaviour; the 17th takes `err`. */
export const DELAY_PENDING_MAX = 16

/** G7 — delay duration, in seconds; outside 0 … 3600 takes `err`. */
export const DELAY_SECONDS_MAX = 3600

/** G3 — the op prefix the identity gate renames an unsupported declaration to. */
export const INERT_OP_PREFIX = 'atrium/inert/'

/** G3 — the allowlist as a Set: the registry is kept by these op names. */
const EXECUTABLE_OPS = new Set(EXECUTABLE)

/** G3 — the path shapes the pointer callbacks read the index out of. */
const NODE_PATH_RE = /^\/nodes\/(\d+)\//
const LIGHT_PATH_RE = /^\/extensions\/KHR_lights_punctual\/lights\/(\d+)\//

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
// G3 — the identity gate: the loaded copy, and the registry kept by allowlist
// ---------------------------------------------------------------------------

/** A structural copy of a validated graph (never the stored value itself). */
function copyGraph(graph) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(graph) } catch { /* fall through to JSON */ }
  }
  return JSON.parse(JSON.stringify(graph))
}

/**
 * G3 — the IDENTITY GATE. Returns a copy of `graph` in which every declaration
 * whose `(op, extension)` is not an executable identity has its `op` replaced
 * by `atrium/inert/<declaration index>` (its `extension` and declared sockets
 * are kept).
 *
 * Nothing registers those names, so the engine builds a `NoOpNode` for them
 * (P9), and no op-name list (`onTick`, `onStart`, P19) ever sees the original
 * name. `event/onSelect` is the one exception: it is executable ONLY with
 * exactly `KHR_node_selectability`, so a bare or differently-extended one is
 * renamed too. **The stored value is never edited — this is a copy.**
 *
 * @param {object} graph the KHR_interactivity graph, already validated
 * @returns {object} the copy the engine is allowed to build
 */
export function inertLoadCopy(graph) {
  const copy = copyGraph(graph)
  if (!Array.isArray(copy?.declarations)) return copy
  copy.declarations = copy.declarations.map((decl, index) =>
    (decl && isExecutableDeclaration(decl.op, decl.extension)
      ? decl
      : { ...decl, op: `${INERT_OP_PREFIX}${index}` }))
  return copy
}

/**
 * G3 — the registry kept by ALLOWLIST: every key that isn't one of
 * `EXECUTABLE`'s op names is deleted before `loadBehaveGraph`, as the second
 * layer behind the renamed copy. There is no name denylist: the whole registry
 * is rebuilt from the allowlist, so a later engine upgrade that adds an op
 * cannot run it without an allowlist change.
 *
 * @param {object} engine a BasicBehaveEngine
 * @returns {Map} the pruned registry
 */
export function keepRegistryByAllowlist(engine) {
  for (const op of [...engine.registry.keys()]) {
    if (!EXECUTABLE_OPS.has(op)) engine.registry.delete(op)
  }
  return engine.registry
}

// ---------------------------------------------------------------------------
// G3 — the delays: the adapter owns the timers, with monotonic ids and a cap
// ---------------------------------------------------------------------------

/**
 * G3 — the delay table. ONE per behaviour (the cap is per behaviour, G7),
 * shared by every `setDelay` node of that engine.
 *
 * Only LIVE delays are kept (a `Map`), so memory follows the pending count and
 * not the history (P11/p5); ids come from a counter that never repeats, so a
 * stale `lastDelay` handle can never name a newer delay (M4).
 *
 * @param {{setTimeout: Function, clearTimeout: Function, limit?: number,
 *          secondsMax?: number}} options
 */
export function createDelayTable({
  setTimeout: setT, clearTimeout: clearT,
  limit = DELAY_PENDING_MAX, secondsMax = DELAY_SECONDS_MAX,
} = {}) {
  const live = new Map()
  let nextId = 0
  return {
    live,
    limit,
    secondsMax,
    setT,
    clearT,
    /** A new, never-repeating id. */
    next() { return ++nextId },
    /** True when the table is at its cap (the next delay takes `err`). */
    full() { return live.size >= limit },
    add(id, timer) { live.set(id, timer) },
    /** Cancel a LIVE id. A stale (already fired or cancelled) id cancels nothing. */
    cancel(id) {
      const timer = live.get(id)
      if (timer === undefined) return false
      live.delete(id)
      try { clearT(timer) } catch { /* total */ }
      return true
    },
    /** Clear every live delay with the INJECTED clearTimeout. */
    clear() {
      for (const timer of live.values()) { try { clearT(timer) } catch { /* total */ } }
      live.clear()
    },
  }
}

/**
 * G3 — install the adapter's own `flow/setDelay` and `flow/cancelDelay`.
 *
 * The engine's own `SetDelay` schedules with the GLOBAL `setTimeout` and keys
 * its delays by an array slot that is never reused; this subclass schedules
 * with the injected timers, keeps only live delays in the table's `Map`, gives
 * every delay a new id, and takes `err` for a duration outside 0 … 3600 s or
 * for a 17th pending delay. `done` is still enqueued through the engine's work
 * queue, so it runs on the next tick, as before.
 *
 * @param {object} engine a BasicBehaveEngine
 * @param {object} table  from `createDelayTable`
 */
export function installDelaySubclasses(engine, table) {
  const BaseSet = engine.registry.get('flow/setDelay')
  const BaseCancel = engine.registry.get('flow/cancelDelay')

  // R6 (F1) — the injected timers are called UNBOUND. An injected host function
  // may be `this`-sensitive: in Chromium `window.setTimeout` throws
  // `TypeError: Illegal invocation` for ANY receiver but `window`, so calling
  // `table.setT(…)` (the receiver being the table object) killed the first delay
  // of every behaviour in a real browser — `the graph threw: Illegal
  // invocation` → `behaviour disabled — engine-error`. Node ignores `this`,
  // which is why every suite, fixture and conformance run stayed green. Keep the
  // timers as plain locals and call them unbound; the fakes in
  // `tests/fake-world.mjs` are `this`-sensitive so a regression fails here.
  const setT = table.setT

  if (BaseSet) {
    const SetDelay = class extends BaseSet {
      processNode(flowSocket) {
        this.graphEngine.processNodeStarted(this)
        if (flowSocket === 'cancel') {
          // The node's own `cancel` input: cancel every delay it scheduled,
          // through the table (a live-only Map).
          for (const id of this._runningDelayIndices ?? []) table.cancel(id)
          this._runningDelayIndices = []
          this.outValues.lastDelay = { value: [null], type: this.getTypeIndex('ref') }
          return
        }
        this.graphEngine.clearValueEvaluationCache()
        const { duration } = this.evaluateRequiredValues()
        const badDuration = typeof duration !== 'number' || !Number.isFinite(duration) ||
          duration < 0 || duration > table.secondsMax
        if (badDuration || table.full()) {
          if (this.flows.err) this.processFlow(this.flows.err)
          return
        }
        const id = table.next()
        const timer = setT(() => {
          table.live.delete(id)
          const ids = this._runningDelayIndices ?? []
          const at = ids.indexOf(id)
          if (at !== -1) ids.splice(at, 1)
          this.addEventToWorkQueue(this.flows.done)
        }, duration * 1000)
        table.add(id, timer)
        this._runningDelayIndices = this._runningDelayIndices ?? []
        this._runningDelayIndices.push(id)
        // G3 — the handle names the delay's own id, so a stale one is a no-op.
        this.outValues.lastDelay = {
          value: [`/extensions/KHR_interactivity/delays/${id}`],
          type: this.getTypeIndex('ref'),
        }
        this.processFlow(this.flows.out)
      }
    }
    SetDelay.init = BaseSet.init
    engine.registry.set('flow/setDelay', SetDelay)
  }

  if (BaseCancel) {
    const CancelDelay = class extends BaseCancel {
      processNode(flowSocket) {
        this.graphEngine.clearValueEvaluationCache()
        const { delay } = this.evaluateRequiredValues()
        this.graphEngine.processNodeStarted(this)
        table.cancel(this.resolveRef(delay))
        this.processFlow(this.flows.out)
      }
    }
    CancelDelay.init = BaseCancel.init
    engine.registry.set('flow/cancelDelay', CancelDelay)
  }
}

// ---------------------------------------------------------------------------
// G3 / S7 — graphReport: one pure read of a stored leaf, judged by identity
// ---------------------------------------------------------------------------

/** The two `onSelect` outputs Atrium's click cannot supply. */
export const MISSING_SELECT_OUTPUTS = Object.freeze(['selectionPoint', 'selectionRayOrigin'])

/**
 * G3 / S7 — the report the form, the importer and the runner's status share, so
 * they cannot disagree. PURE and TOTAL: never throws, and a malformed value
 * reports nothing.
 *
 * @param {*} value  the stored behaviour leaf (or a bare KHR_interactivity graph)
 * @returns {{unsupported: Array<{op: string, extension: string|null, count: number}>,
 *            unsupportedPointers: Array<{pointer: string, count: number}>,
 *            missingSelectOutputs: string[], perFrame: boolean,
 *            interpolates: boolean, startsOnLoad: boolean, keepsState: boolean}}
 */
export function graphReport(value) {
  const empty = {
    unsupported: [], unsupportedPointers: [], missingSelectOutputs: [],
    perFrame: false, interpolates: false, startsOnLoad: false, keepsState: false,
  }
  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isObject(value)) return empty
  const graph = isObject(value.graph) ? value.graph
    : (Array.isArray(value.declarations) ? value : null)
  if (!isObject(graph) || !Array.isArray(graph.declarations)) return empty

  const declarations = graph.declarations
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const declarationOf = (index) => (isObject(declarations[index]) ? declarations[index] : null)
  const opOf = (index) => declarationOf(index)?.op ?? null

  // The unsupported declarations, by IDENTITY, in declaration order, with the
  // number of graph nodes that use each one.
  const unsupported = []
  const byIdentity = new Map()
  declarations.forEach((decl, index) => {
    if (!isObject(decl) || typeof decl.op !== 'string') return
    if (isExecutableDeclaration(decl.op, decl.extension)) return
    const key = `${decl.op}|${typeof decl.extension === 'string' ? decl.extension : ''}`
    let entry = byIdentity.get(key)
    if (!entry) {
      entry = { op: decl.op, extension: decl.extension ?? null, count: 0 }
      byIdentity.set(key, entry)
      unsupported.push(entry)
    }
    for (const node of nodes) {
      if (isObject(node) && node.declaration === index) entry.count++
    }
  })

  // The pointer configurations outside G-L4's families: stored, inert and
  // reported (G-L3 (a)).
  const unsupportedPointers = []
  const byPointer = new Map()
  for (const node of nodes) {
    if (!isObject(node)) continue
    const op = opOf(node.declaration)
    if (op !== 'pointer/get' && op !== 'pointer/set' && op !== 'pointer/interpolate') continue
    const literal = node.configuration?.pointer?.value
    const pointer = Array.isArray(literal) && literal.length === 1 ? literal[0] : null
    if (typeof pointer !== 'string' || isSupportedPointerPath(pointer)) continue
    const entry = byPointer.get(pointer) ?? { pointer, count: 0 }
    entry.count++
    if (!byPointer.has(pointer)) { byPointer.set(pointer, entry); unsupportedPointers.push(entry) }
  }

  // The `onSelect` outputs a node reads: Atrium's clicks carry no selection
  // point or ray, so those outputs read as not-a-number (S7).
  const missingSelectOutputs = []
  for (const node of nodes) {
    if (!isObject(node) || !isObject(node.values)) continue
    for (const input of Object.values(node.values)) {
      if (!isObject(input) || input.node === undefined || input.socket === undefined) continue
      if (opOf(input.node) !== 'event/onSelect') continue
      if (MISSING_SELECT_OUTPUTS.includes(input.socket) && !missingSelectOutputs.includes(input.socket)) {
        missingSelectOutputs.push(input.socket)
      }
    }
  }

  const hasOp = (op) => nodes.some((node) => isObject(node) && opOf(node.declaration) === op)

  return {
    unsupported,
    unsupportedPointers,
    missingSelectOutputs,
    perFrame: hasOp('event/onTick'),
    interpolates: hasOp('pointer/interpolate') || hasOp('variable/interpolate'),
    startsOnLoad: hasOp('event/onStart'),
    keepsState: Array.isArray(graph.variables) && graph.variables.length > 0,
  }
}

class BehaviorDecorator extends ADecorator {
  constructor(engine, { nodeMap, world, logOnce, mayWrite, log }) {
    super(engine)
    this.nodeMap = nodeMap
    this.world = world
    this.logOnce = logOnce
    this.mayWrite = mayWrite
    // V5 (round 5) — `onAnimation` reports through `this.log` (an index past the
    // table, a clip that is not on the model). It was never wired, so the S7
    // path threw `this.log is not a function` inside the tick and disabled the
    // whole behaviour the moment the clip check became live.
    this.log = log
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

  /**
   * G3 / G-L4 / P26 — the pointer table: **each family registered ONCE**, at the
   * highest index it covers, and its getter and setter read the index from the
   * path the engine passes.
   *
   * The engine's trie keeps one index node per level, so a closure per index
   * reaches only the LAST registration. Registering once at the top index also
   * bounds the family: the trie matches `0 <= index < top`, so a wired index or
   * ref outside `nodeMap` resolves nowhere (`err` on a set, `isValid: false` on
   * a get) without any extra check.
   *
   * The families: node `translation`, `rotation`, `scale` and
   * `KHR_node_visibility/visible`; the read-only `matrix` and `globalMatrix`
   * (`world.matrix`, `world.worldMatrix`); and a light's `intensity` and
   * `color`, registered at the highest light host's index, whose callbacks
   * refuse an index that isn't a light host (see `resolveJsonPtr` in
   * `createBehaviorEngine`). Every setter still passes `mayWrite`.
   */
  registerKnownPointers() {
    const top = this.nodeMap.length - 1
    if (top < 0) return
    const indexOf = (path, re) => Number(re.exec(path)?.[1])

    this.registerJsonPointer(`/nodes/${top}/translation`,
      (path) => asArray(this.world.get(indexOf(path, NODE_PATH_RE), 'translation')),
      (path, v) => this.write(indexOf(path, NODE_PATH_RE), 'translation', asArray(v)), 'float3', false)
    this.registerJsonPointer(`/nodes/${top}/rotation`,
      (path) => asArray(this.world.get(indexOf(path, NODE_PATH_RE), 'rotation')),
      (path, v) => this.write(indexOf(path, NODE_PATH_RE), 'rotation', asArray(v)), 'float4', false)
    this.registerJsonPointer(`/nodes/${top}/scale`,
      (path) => asArray(this.world.get(indexOf(path, NODE_PATH_RE), 'scale')),
      (path, v) => this.write(indexOf(path, NODE_PATH_RE), 'scale', asArray(v)), 'float3', false)
    this.registerJsonPointer(`/nodes/${top}/extensions/KHR_node_visibility/visible`,
      (path) => [this.world.get(indexOf(path, NODE_PATH_RE), 'visible')],
      (path, v) => this.write(indexOf(path, NODE_PATH_RE), 'visible', Array.isArray(v) ? v[0] : v), 'bool', false)

    // G-L4 — the read-only matrices, from the SOM: one implementation for every
    // caller, `@atrium/som`'s `worldMatrix` beside `worldPosition`.
    this.registerJsonPointer(`/nodes/${top}/matrix`,
      (path) => this.world.matrix(indexOf(path, NODE_PATH_RE)), undefined, 'float4x4', true)
    this.registerJsonPointer(`/nodes/${top}/globalMatrix`,
      (path) => this.world.worldMatrix(indexOf(path, NODE_PATH_RE)), undefined, 'float4x4', true)

    // G-L4 — a light, at the highest light host's index. `world.hasLight` is
    // checked in `resolveJsonPtr`, so a non-host index is a missing pointer.
    const hosts = this.nodeMap.map((_id, i) => i).filter((i) => this.world.hasLight(i))
    if (hosts.length > 0) {
      const lightAt = hosts[hosts.length - 1]
      this.registerJsonPointer(`/extensions/KHR_lights_punctual/lights/${lightAt}/intensity`,
        (path) => [this.world.lightIntensity(indexOf(path, LIGHT_PATH_RE))],
        (path, v) => this.writeLight(indexOf(path, LIGHT_PATH_RE), Array.isArray(v) ? v[0] : v), 'float', false)
      this.registerJsonPointer(`/extensions/KHR_lights_punctual/lights/${lightAt}/color`,
        (path) => asArray(this.world.lightColor(indexOf(path, LIGHT_PATH_RE))),
        (path, v) => this.writeLightColor(indexOf(path, LIGHT_PATH_RE), asArray(v)), 'float3', false)
    }
  }

  /** A node-field write: authority first, then the world; a failure is a log line. */
  write(i, field, value) {
    if (!this.mayWrite(i)) { this.logOnce(i, field); return }
    let ok = false
    try { ok = this.world.set(i, field, value) === true } catch { ok = false }
    if (!ok) this.logOnce(i, field)
  }

  writeLight(i, value) {
    if (!this.mayWrite(i)) { this.logOnce(i, 'intensity'); return }
    let ok = false
    try { ok = this.world.setLightIntensity(i, value) === true } catch { ok = false }
    if (!ok) this.logOnce(i, 'intensity')
  }

  writeLightColor(i, value) {
    if (!this.mayWrite(i)) { this.logOnce(i, 'color'); return }
    let ok = false
    try { ok = this.world.setLightColor(i, value) === true } catch { ok = false }
    if (!ok) this.logOnce(i, 'color')
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
      this.logOnce(mapIndex === -1 ? index : mapIndex, 'animation')
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
    mayWrite() { return false },
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
  /** G3 — a rejected interpolation action: disposed at the start of the next tick. */
  let pendingError = false

  const refusedOnce = new Set()
  // W8 (round 6) — the line is "refused write to …", not "refused refused
  // write to …": every caller passed `'refused'` as the middle word and the
  // message already started with it.
  const logOnce = (index, field) => {
    const key = `${index}:${field}`
    if (refusedOnce.has(key)) return
    refusedOnce.add(key)
    report(1, `refused write to ${nodeMap[index] ?? `index ${index}`}.${field}`)
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

  const decorator = new BehaviorDecorator(engine, {
    nodeMap, world, logOnce, mayWrite,
    log: (severity, message) => report(severity, message),
  })
  decorator.animations = animations
  decorator.worldAnimations = animations.map((a) => ({ name: a.clip }))

  // S1 — the hook goes on the ENGINE, not on the decorator's own property.
  engine.processNodeStarted = () => {
    if (++steps > STEP_BUDGET) throw new BudgetExceeded(`step budget ${STEP_BUDGET} exceeded`)
  }
  // `debug/log` reaches this hook; the message is cut to 200 characters (F4).
  engine.processDebugLog = (_node, message, severity) => report(severity ?? 0, message)
  installBudgetedLoops(engine)

  // ---------------------------------------------------------------------------
  // G3 — the identity gate, the clock, the delays and the interpolation wrapper
  // ---------------------------------------------------------------------------

  // The SECOND layer: the registry is kept by allowlist before anything loads.
  keepRegistryByAllowlist(engine)

  // The adapter's own delays: injected timers, ids that never repeat, the cap.
  const delayTable = createDelayTable({ setTimeout: setT, clearTimeout: clearT })
  installDelaySubclasses(engine, delayTable)

  // The clock: what every op OBSERVES is the injected `now`. The engine's own
  // `performance.now()` call in `executeEventQueue` stays (M3) — only the value
  // the ops read is shadowed, on the instance (p1).
  Object.defineProperty(engine, 'lastTickTime', { get: () => now(), configurable: true })

  // G3 — a light index that isn't a light host is a MISSING pointer: `err` for a
  // set, `isValid: false` for a get. The trie resolves any index below the top
  // one it was registered at, so the check goes on the engine's own resolver.
  const resolveJsonPtr = engine.resolveJsonPtr
  engine.resolveJsonPtr = (path) => {
    const match = typeof path === 'string' ? LIGHT_PATH_RE.exec(path) : null
    if (match && !world.hasLight(Number(match[1]))) return undefined
    return resolveJsonPtr(path)
  }

  // G3 / P25 — every interpolation action is wrapped WHERE IT IS REGISTERED. A
  // synchronous throw (variable/interpolate's plain function) is logged and
  // RETHROWN, so the tick wrapper disposes the engine in the same tick; a
  // rejection (pointer/interpolate's async action) is logged once and marks the
  // engine `engine-error`, for disposal at the start of the next tick.
  const wrapInterpolation = (action) => {
    if (typeof action !== 'function') return action
    return function wrappedAction(...args) {
      let result
      try {
        result = action.apply(this, args)
      } catch (error) {
        report(2, `the interpolation threw: ${error?.message ?? error}`)
        throw error
      }
      if (result && typeof result.then === 'function') {
        result.then(undefined, (error) => {
          if (disposed || pendingError) return          // idempotent, and nothing after disposal
          pendingError = true
          report(2, `the interpolation rejected: ${error?.message ?? error}`)
        })
      }
      return result
    }
  }
  const rawPointerCallback = engine.setPointerInterpolationCallback.bind(engine)
  const rawVariableCallback = engine.setVariableInterpolationCallback.bind(engine)
  const wrapEntry = (entry) => (entry && typeof entry === 'object'
    ? { ...entry, action: wrapInterpolation(entry.action) }
    : entry)
  engine.setPointerInterpolationCallback = (path, entry) => rawPointerCallback(path, wrapEntry(entry))
  engine.setVariableInterpolationCallback = (variable, entry) => rawVariableCallback(variable, wrapEntry(entry))

  let loadError = null
  try {
    // G3 — the IDENTITY GATE: the engine loads a COPY in which every
    // declaration that isn't an executable identity is renamed. The stored
    // value is never edited.
    engine.loadBehaveGraph(inertLoadCopy(graph), false)     // S3 — runGraph false
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

  /** G3 — clear the timers the adapter owns, with the INJECTED clearTimeout. */
  const teardown = () => {
    if (intervalTimer !== null) { try { clearT(intervalTimer) } catch { /* total */ } intervalTimer = null }
    // Every live delay is cleared BEFORE `engine.dispose()`; the engine's own
    // table is empty, because the delay subclasses never fill it.
    delayTable.clear()
    try { engine.dispose() } catch { /* total */ }
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    teardown()
    eventBus.clearCustomEventListeners()
    for (const key of Object.keys(eventBus.varI)) delete eventBus.varI[key]
    for (const key of Object.keys(eventBus.ptrI)) delete eventBus.ptrI[key]
  }

  /** F4 — one `executeEventQueueTick()`; any throw is caught and disposes (S5). */
  const tick = () => {
    if (disposed) throw new Error('the behaviour engine is disposed')
    // G3 — a rejected interpolation action marks the engine `engine-error` and
    // the engine is disposed ONCE, here, before the queue runs. (A rejection
    // that arrives after disposal does nothing: the wrapper checks `disposed`.)
    if (pendingError) {
      disposed = true
      reason = 'engine-error'
      teardown()
      return
    }
    steps = 0
    try {
      engine.executeEventQueueTick()
    } catch (error) {
      disposed = true
      reason = (error instanceof BudgetExceeded || error instanceof RangeError) ? 'over-budget' : 'engine-error'
      teardown()
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
    /**
     * V7 (round 5) — the adapter's own authority predicate, addressed by OBJECT
     * ID, so the runner re-checks a queued write with the SAME function the
     * setters use. There is no second copy of F4's rule. An id that isn't in
     * `nodeMap` may not be written (F4 registers pointers for `nodeMap` indices
     * only).
     */
    mayWrite: (objectId) => {
      const index = nodeMap.indexOf(objectId)
      return index !== -1 && mayWrite(index)
    },
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
    /** @internal — the live delays (G3's `Map`), for the tests only. */
    get delays() { return delayTable.live },
  }
}
