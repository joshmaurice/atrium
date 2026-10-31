// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p2 — the cost of a node start, in Node: a flow-heavy loop and a math-heavy
// loop, each kept under the 10,000-step per-tick budget, timed over many ticks.
import { createBehaviorEngine, graph, lit, to, T, openWorld } from './g.mjs'
function bench(label, nodes, ticks = 300) {
  const g = graph(nodes)
  const world = openWorld(1)
  const e = createBehaviorEngine({ graph: g, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) { console.log(label, 'REJECTED', e.message); return }
  e.tick(); const probe = e.steps; if (e.disposed) { console.log(label, "one tick is over budget:", probe); return }
  for (let i = 0; i < 20; i++) e.tick()   // warm up
  let steps = 0; const t0 = performance.now()
  for (let i = 0; i < ticks && !e.disposed; i++) { e.tick(); steps += e.steps }
  const ms = performance.now() - t0
  console.log(`${label}: ${steps} steps in ${ms.toFixed(1)} ms → ${(ms * 1000 / steps).toFixed(3)} µs/step, ${(steps / ticks) | 0} steps/tick, ${(ms / ticks).toFixed(2)} ms/tick${e.disposed ? ' DISPOSED ' + e.reason : ''}`)
}
const PSET = (valueNode) => ({ op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: valueNode, socket: 'value' } } })
// (a) onTick → for 0..N → body: sequence → pointer/set(combine3(index→float,…))
bench('(a) flow-heavy: for(0..1500) → sequence → set', [
  { op: 'event/onTick', flows: { out: to(1) } },
  { op: 'flow/for', values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 1500) }, flows: { loopBody: to(4) } },
  { op: 'type/intToFloat', values: { a: { node: 1, socket: 'index' } } },
  { op: 'math/combine3', values: { a: { node: 2, socket: 'value' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
  { op: 'flow/sequence', flows: { a: to(5) } },
  PSET(3),
])
// (b) onTick → for 0..N → set(value of a 12-deep math chain on the index)
const chain = [
  { op: 'event/onTick', flows: { out: to(1) } },
  { op: 'flow/for', values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 350) }, flows: { loopBody: to(16) } },
  { op: 'type/intToFloat', values: { a: { node: 1, socket: 'index' } } },
]
for (let k = 0; k < 12; k++) chain.push({ op: k % 2 ? 'math/mul' : 'math/add', values: { a: { node: chain.length - 1, socket: 'value' }, b: lit(T.float, 1.0001) } })
chain.push({ op: 'math/combine3', values: { a: { node: chain.length - 1, socket: 'value' }, b: lit(T.float, 0), c: lit(T.float, 0) } })
chain.push(PSET(chain.length - 1))
// fix the for's loopBody to point at the pointer/set (the last node)
chain[1].flows.loopBody = to(chain.length - 1)
bench('(b) math-heavy: for(0..350) → set(12-op chain)', chain)
