// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// r3 — the Rev 1 review's S4. A pointer interpolation's action is `async` and
// called without `await`: does a throw inside it escape the adapter's tick
// wrapper as an unhandled rejection? And does wrapping the action where the
// adapter's own NodeEventBus registers it (P25) contain it?
import { createBehaviorEngine, graph, lit, to, T, openWorld } from './g.mjs'

const unhandled = []
process.on('unhandledRejection', (e) => unhandled.push(String(e?.message ?? e)))
const F2 = { signature: 'float2' }
function run(label, wrap) {
  const g = graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'pointer/interpolate', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } },
      values: { value: lit(T.float3, [10, 0, 0]), duration: lit(T.float, 1), p1: { type: 6, value: [0, 0] }, p2: { type: 6, value: [1, 1] } } },
  ]); g.types.push(F2)
  const world = openWorld(1); world.state.fields.set('0:translation', [0, 0, 0])
  const e = createBehaviorEngine({ graph: g, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  let now = 0
  Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
  e.engine.setPathValue = () => { throw new Error('setPathValue threw (forced)') }   // test-only
  const caught = []
  if (wrap) {
    const bus = e.eventBus, original = bus.setPointerInterpolationCallback
    bus.setPointerInterpolationCallback = (p, a) => original(p, { action: () => {
      try { const r = a.action(); if (r && typeof r.then === 'function') r.then(undefined, (err) => caught.push(err.message)) } catch (err) { caught.push(err.message) }
    } })
  }
  return new Promise((resolve) => {
    now = 0; e.tick(); now = 250; e.tick()
    setTimeout(() => { console.log(`${label}: disposed ${e.disposed}; caught by the wrapper ${JSON.stringify(caught)}; unhandled so far ${JSON.stringify(unhandled)}`); resolve() }, 50)
  })
}
await run('(a) no wrapper', false)
unhandled.length = 0
await run('(b) wrapper on the bus', true)
