// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// x1 — reviewer's probe (Rev 1.1 review): an interpolation's `done` flow runs
// INSIDE the engine's async action (index.js L8611 `callback()`), so a throw in
// that flow (the step budget, P4) is a rejected promise, not a tick throw.
// Does the adapter dispose the engine `over-budget`, or does it escape?
import { createBehaviorEngine, graph, lit, to, T, openWorld } from './g.mjs'

const unhandled = []
process.on('unhandledRejection', (e) => unhandled.push(String(e?.message ?? e)))
const F2 = { signature: 'float2' }
function build() {
  // onStart → interpolate (1 s) ; done → for i in 0..20000: sequence (a body that counts)
  const g = graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'pointer/interpolate', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } },
      values: { value: lit(T.float3, [10, 0, 0]), duration: lit(T.float, 1), p1: { type: 6, value: [0, 0] }, p2: { type: 6, value: [1, 1] } },
      flows: { done: to(2) } },
    { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 20000) }, flows: { loopBody: to(3) } },
    { op: 'flow/sequence' },
  ]); g.types.push(F2)
  const world = openWorld(1); world.state.fields.set('0:translation', [0, 0, 0])
  const e = createBehaviorEngine({ graph: g, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) { console.log('REJECTED', e.message); process.exit(1) }
  let now = 0
  Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
  return { e, setNow: (v) => { now = v }, world }
}
const { e, setNow, world } = build()
setNow(0); e.tick()
setNow(500); e.tick()
setNow(1000); e.tick()            // elapsed >= duration → setPathValue(target) → clearPointerInterpolation → callback() → the for loop
await new Promise((r) => setTimeout(r, 50))
console.log(`after the done tick: disposed=${e.disposed} reason=${e.reason ?? null} steps=${e.steps} unhandled=${JSON.stringify(unhandled)}`)
console.log(`last translation write: ${JSON.stringify([...world.state.fields.get('0:translation')])}`)
setNow(1016); e.tick()
console.log(`next tick: disposed=${e.disposed} reason=${e.reason ?? null} steps=${e.steps}`)
