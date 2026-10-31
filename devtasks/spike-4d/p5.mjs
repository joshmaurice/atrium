// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p5 — the engine's own delay table. onTick → setDelay(0.001): how big does
// `scheduledDelays` get, and does it shrink once the delays have fired?
import { createBehaviorEngine, graph, lit, to, T, openWorld } from './g.mjs'
const g = graph([
  { op: 'event/onTick', flows: { out: to(1) } },
  { op: 'flow/setDelay', values: { duration: lit(T.float, 0.001) } },
])
const world = openWorld(1)
const e = createBehaviorEngine({ graph: g, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
if (e.problem) { console.log('REJECTED', e.message); process.exit(1) }
for (let i = 0; i < 10000; i++) e.tick()
const eng = e.engine
const live = () => eng.scheduledDelays.filter((d) => d !== undefined).length
console.log('after 10,000 ticks: table length', eng.scheduledDelays.length, 'pending', live(), 'trie delay paths?', typeof eng.jsonPtrTrie)
await new Promise((r) => setTimeout(r, 200))
console.log('after the timers fired: table length', eng.scheduledDelays.length, 'pending', live())
e.tick()
console.log('one more tick (the done events run): steps', e.steps, 'disposed', e.disposed, e.reason ?? '')
e.dispose()
console.log('after dispose: table length', eng.scheduledDelays.length)
