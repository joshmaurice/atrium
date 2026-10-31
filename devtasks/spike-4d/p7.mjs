// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p7 — loops through events, now that event/send is in. (a) a send → earlier
// receive loop: laps per tick. (b) a doubling fan-out: when the per-tick budget
// (10,000) trips.
import { createBehaviorEngine, graph, lit, to, T, openWorld } from './g.mjs'
function run(label, nodes) {
  const g = graph(nodes, { events: [{ id: 'loop' }] })
  const world = openWorld(1)
  const e = createBehaviorEngine({ graph: g, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) { console.log(label, 'REJECTED', e.message); return }
  const perTick = []
  for (let t = 0; t < 30 && !e.disposed; t++) { e.tick(); perTick.push(e.disposed ? `DISPOSED(${e.reason})` : e.steps) }
  console.log(label, 'steps per tick:', perTick.join(' '))
}
const RECV = { op: 'event/receive', configuration: { event: { value: [0] } } }
const SEND = (flows) => ({ op: 'event/send', configuration: { event: { value: [0] } }, ...(flows ? { flows } : {}) })
run('(a) onStart→send; receive→send (one lap per tick)', [
  RECV && { ...RECV, flows: { out: to(2) } },
  { op: 'event/onStart', flows: { out: to(3) } },
  SEND(), SEND(),
])
run('(b) receive→sequence→send,send (doubling)', [
  { ...RECV, flows: { out: to(2) } },
  { op: 'event/onStart', flows: { out: to(5) } },
  { op: 'flow/sequence', flows: { a: to(3), b: to(4) } },
  SEND(), SEND(), SEND(),
])
