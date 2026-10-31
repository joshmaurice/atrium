// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p1 — the clock. Does shadowing `lastTickTime` on the engine instance make
// event/onTick's outputs, flow/throttle and pointer/interpolate follow an
// injected clock?
import { graph, lit, to, createBehaviorEngine, openWorld, T, fmt } from './g.mjs'

function run(label, g, { override, times }) {
  const world = openWorld(1)
  const e = createBehaviorEngine({ graph: g, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) { console.log(label, 'REJECTED', e.message); return }
  let now = 0
  if (override) Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
  const out = []
  for (const t of times) { now = t; e.tick(); out.push(world.state.fields.get('0:translation')) }
  console.log(label, override ? 'override' : 'real clock', fmt(out.map((v) => v && v.map((x) => Math.round(x * 1000) / 1000))))
}

// (a) onTick → pointer/set translation = (timeSinceStart, 0, 0)
const tick = graph([
  { op: 'event/onTick', flows: { out: to(2) } },
  { op: 'math/combine3', values: { a: { node: 0, socket: 'timeSinceStart' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
  { op: 'pointer/set', configuration: { pointer: lit(T.ref, '/nodes/0/translation'), type: lit(T.int, T.float3) },
    values: { value: { node: 1, socket: 'value' } } },
])
// The configuration's `type` is a type INDEX literal.
tick.nodes[2].configuration.type = { value: [T.float3] }
tick.nodes[2].configuration.pointer = { value: ['/nodes/0/translation'] }
const times = [1000, 1500, 2500, 4000]
run('(a) onTick timeSinceStart', tick, { override: true, times })
run('(a) onTick timeSinceStart', tick, { override: false, times })

// (b) onStart → pointer/interpolate translation to (10,0,0) over 1 s, linear-ish bezier
const interp = graph([
  { op: 'event/onStart', flows: { out: to(1) } },
  { op: 'pointer/interpolate', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } },
    values: { value: lit(T.float3, [10, 0, 0]), duration: lit(T.float, 1), p1: { type: 6, value: [0, 0] }, p2: { type: 6, value: [1, 1] } } },
])
interp.types.push({ signature: 'float2' })
const run2 = (label, override) => {
  const world = openWorld(1); world.state.fields.set('0:translation', [0, 0, 0])
  const e = createBehaviorEngine({ graph: interp, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) { console.log(label, 'REJECTED', e.message); return }
  let now = 0
  if (override) Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
  const out = []
  for (const t of [0, 0, 250, 500, 1000, 1200]) { now = t; e.tick(); out.push(world.state.fields.get('0:translation')?.[0]) }
  console.log(label, override ? 'override' : 'real clock', fmt(out.map((x) => x === undefined ? null : Math.round(x * 100) / 100)))
}
run2('(b) interpolate x over fake 0,0,250,500,1000,1200 ms', true)
run2('(b) interpolate x over fake 0,0,250,500,1000,1200 ms', false)

// (c) onTick → throttle(1 s) → pointer/set translation (counter via timeSinceStart)
const thr = graph([
  { op: 'event/onTick', flows: { out: to(2) } },
  { op: 'math/combine3', values: { a: { node: 0, socket: 'timeSinceStart' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
  { op: 'flow/throttle', values: { duration: lit(T.float, 1) }, flows: { out: to(3) } },
  { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: 1, socket: 'value' } } },
])
{
  const world = openWorld(1)
  const e = createBehaviorEngine({ graph: thr, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) console.log('(c) REJECTED', e.message)
  else {
    let now = 0
    Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
    for (const t of [0, 100, 900, 1000, 1100, 2050, 2100]) { now = t; e.tick() }
    console.log('(c) throttle 1 s, fake ticks 0,100,900,1000,1100,2050,2100 → writes', world.state.setCalls.length, fmt(world.state.setCalls.map((c) => Math.round(c[2][0] * 1000) / 1000)))
  }
}
