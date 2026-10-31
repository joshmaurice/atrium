// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// fake-world.mjs — F4's `world` interface, in memory, for the adapter tests.
// Not a test file (no .test.js), so `node --test tests/*.test.js` ignores it.

export const OWN = '11111111-1111-4111-8111-111111111111'
export const TGT = '22222222-2222-4222-8222-222222222222'

/** A graph builder in the spike's `g.mjs` shape, for the probes-as-tests. */
export const T = { bool: 0, int: 1, float: 2, float3: 3, float4: 4, ref: 5 }
const PROBE_TYPES = [
  { signature: 'bool' }, { signature: 'int' }, { signature: 'float' },
  { signature: 'float3' }, { signature: 'float4' }, { signature: 'ref' },
]
export function graph(nodes, { variables, events } = {}) {
  const ops = [...new Set(nodes.map((n) => n.op))]
  const g = {
    types: PROBE_TYPES.map((t) => ({ ...t })),
    declarations: ops.map((op) => ({ op })),
    nodes: nodes.map(({ op, ...rest }) => ({ declaration: ops.indexOf(op), ...rest })),
  }
  if (variables) g.variables = variables
  if (events) g.events = events
  return g
}
export const lit = (type, value) => ({ type, value: Array.isArray(value) ? value : [value] })
export const to = (node, socket = 'in') => ({ node, socket })

/** Injected timers, so nothing in a test touches a real clock. */
export function fakeTimers() {
  let nextId = 0
  const live = new Map()
  const cleared = []
  return {
    live,
    cleared,
    setTimeout(fn, ms) { const id = ++nextId; live.set(id, { fn, ms }); return id },
    clearTimeout(id) { cleared.push(id); live.delete(id) },
    /** Fire the one live timer whose period is `ms`, as the clock would. */
    fire(ms) {
      for (const [id, timer] of [...live]) {
        if (ms === undefined || timer.ms === ms) { live.delete(id); timer.fn(); return true }
      }
      return false
    },
    sizes() { return [...live.values()].map((t) => t.ms) },
  }
}

/**
 * F4's world interface, total: every call returns a value, none throws. State is
 * reachable through `.state` so a test can assert what a graph actually wrote.
 */
export function makeWorld(options = {}) {
  const ids = options.ids ?? [OWN]
  const state = {
    ids,
    fields: new Map(),
    setCalls: [],
    lightHosts: new Set(options.lights ?? []),
    lightValues: new Map(),
    lightColors: new Map(),
    descendants: new Set(options.descendants ?? []),
    granted: new Set(options.granted ?? []),
    parents: options.parents ?? {},
    clips: options.clips ?? {},
    plays: [],
    stops: [],
    position: options.position ?? [0, 0, 0],
    refuseSet: options.refuseSet ?? (() => false),
    throwSet: options.throwSet ?? (() => false),
    resolveProblems: options.resolveProblems ?? {},
  }
  return {
    state,
    resolve(i) {
      if (state.resolveProblems[i]) return { problem: state.resolveProblems[i] }
      if (state.ids[i] === undefined) return { problem: 'not-found' }
      return { objectId: state.ids[i], name: `node-${i}` }
    },
    isOwnOrDescendant(i) { return state.descendants.has(i) },
    isGranted(i) { return state.granted.has(i) },
    hasLight(i) { return state.lightHosts.has(i) },
    get(i, field) { return state.fields.get(`${i}:${field}`) },
    set(i, field, value) {
      if (state.throwSet(i, field)) throw new Error('the world setter threw')
      if (state.refuseSet(i, field)) return false
      state.setCalls.push([i, field, value])
      state.fields.set(`${i}:${field}`, value)
      return true
    },
    lightIntensity(i) { return state.lightValues.get(i) },
    setLightIntensity(i, value) {
      if (state.throwSet(i, 'intensity')) throw new Error('the world setter threw')
      if (state.refuseSet(i, 'intensity')) return false
      state.lightValues.set(i, value)
      state.setCalls.push([i, 'intensity', value])
      return true
    },
    // scripting-4d-1 G-L4 — the light's colour, and the two read-only matrices.
    // The matrix reads are injected functions: in production they are
    // `@atrium/som`'s `localMatrix` / `worldMatrix` over the SOM node.
    lightColor(i) { return state.lightColors.get(i) },
    setLightColor(i, value) {
      if (state.throwSet(i, 'color')) throw new Error('the world setter threw')
      if (state.refuseSet(i, 'color')) return false
      state.lightColors.set(i, value)
      state.setCalls.push([i, 'color', value])
      return true
    },
    matrix(i) { return options.matrix ? options.matrix(i) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    worldMatrix(i) { return options.worldMatrix ? options.worldMatrix(i) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    clipStatus(objectId) { return state.clips[objectId] ?? { status: 'none' } },
    play(objectId, clip, loop, speed) { state.plays.push([objectId, clip, loop, speed]); return true },
    stop(objectId, clip) { state.stops.push([objectId, clip]); return true },
    worldPosition(i) { return i === 0 ? state.position : undefined },
    parentIndex(i) { return state.parents[i] ?? null },
  }
}
