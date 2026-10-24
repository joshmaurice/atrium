// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// Spike host: a Node event bus and a minimal Atrium-like decorator over the pinned engine.
import { BasicBehaveEngine, ADecorator, validateInteractivityExtension, validateInteractivityGraph, GraphRejectedError } from '@khronosgroup/gltf-interactivity-engine'

export class NodeEventBus {
  constructor() { this.target = new EventTarget(); this.eventList = []; this.custom = {}; this.listeners = {}; this.varI = {}; this.ptrI = {} }
  getEventList = () => this.eventList
  clearEventList = () => { this.eventList = [] }
  addEvent = (e) => { this.eventList.push(e) }
  addCustomEventListener = (name, func) => {
    if (!this.custom[name]) {
      this.custom[name] = []
      const l = (e) => this.custom[name].forEach((f) => this.eventList.push({ func: () => f(e), inSocketId: name }))
      this.target.addEventListener(name, l); this.listeners[name] = l
    }
    this.custom[name].push(func)
  }
  dispatchCustomEvent = (name, vals) => this.target.dispatchEvent(new CustomEvent(name, { detail: vals }))
  getCustomEventsNames = () => Object.keys(this.custom)
  clearCustomEventListeners = () => { for (const [n, l] of Object.entries(this.listeners)) this.target.removeEventListener(n, l); this.custom = {}; this.listeners = {} }
  setVariableInterpolationCallback = (v, a) => { this.varI[v] = a }
  clearVariableInterpolation = (v) => { delete this.varI[v] }
  getVariableInterpolationCallbacks = () => this.varI
  setPointerInterpolationCallback = (p, a) => { this.ptrI[p] = a }
  clearPointerInterpolation = (p) => { delete this.ptrI[p] }
  getPointerInterpolationCallbacks = () => this.ptrI
}

/**
 * A decorator over a tiny "world": nodes[i] = { translation, rotation, scale, visible, parent }.
 * `allowed(i)` is the authority check (own subtree + targets); a refused write is recorded, not applied.
 * `budget` counts node starts per tick; past it the hook throws BudgetExceeded.
 */
export class BudgetExceeded extends Error {}
export class SpikeDecorator extends ADecorator {
  constructor(engine, { world, allowed = () => true, budget = Infinity } = {}) {
    super(engine)
    this.world = world; this.allowed = allowed; this.budget = budget; this.steps = 0; this.refused = []; this.writes = []; this.anim = []
    this.processNodeStarted = () => { if (++this.steps > this.budget) throw new BudgetExceeded(`step budget ${this.budget} exceeded`) }
    this.processAddingNodeToQueue = () => {}
    this.processExecutingNextNode = () => {}
    this.getWorld = () => this.world
    this.getParentNodeIndex = (i) => this.world.nodes[i]?.parent
    this.startAnimation = (index, start, end, speed, cb) => { this.anim.push(['start', index, start, end, speed]); this.animCb = cb }
    this.stopAnimation = (index) => { this.anim.push(['stop', index]) }
    this.stopAnimationAt = (index, t, cb) => { this.anim.push(['stopAt', index, t]); cb?.() }
    this.registerKnownPointers = () => {
      const last = this.world.nodes.length - 1
      if (last < 0) return
      for (const [field, type] of [['translation', 'float3'], ['scale', 'float3'], ['rotation', 'float4']]) {
        this.registerJsonPointer(`/nodes/${last}/${field}`,
          (path) => [...this.world.nodes[idx(path)][field]],
          (path, v) => this.write(idx(path), field, v), type, false)
      }
      this.registerJsonPointer(`/nodes/${last}/extensions/KHR_node_visibility/visible`,
        (path) => [this.world.nodes[idx(path)].visible],
        (path, v) => this.write(idx(path), 'visible', v[0] ?? v), 'bool', false)
    }
    this.bridgeEngineHooks()
    // The engine calls its OWN processNodeStarted; bridgeEngineHooks doesn't carry it over.
    engine.processNodeStarted = this.processNodeStarted
    this.registerKnownPointers()
  }
  write(i, field, v) {
    if (!this.allowed(i)) { this.refused.push([i, field]); return }
    this.writes.push([i, field, JSON.stringify(v)])
    this.world.nodes[i][field] = Array.isArray(v) ? [...v] : v
  }
  /** One frame: reset the budget, run the queue once; any throw is caught and reported. */
  tick() {
    this.steps = 0
    try { this.behaveEngine.executeEventQueueTick(); return { ok: true, steps: this.steps } }
    catch (e) { return { ok: false, steps: this.steps, error: `${e.constructor.name}: ${e.message}`.slice(0, 160) } }
  }
}
const idx = (path) => Number(path.split('/')[2])

export function makeEngine(opts) {
  const engine = new BasicBehaveEngine(60, new NodeEventBus())
  const deco = new SpikeDecorator(engine, opts)
  return { engine, deco }
}
export { validateInteractivityExtension, validateInteractivityGraph, GraphRejectedError }
