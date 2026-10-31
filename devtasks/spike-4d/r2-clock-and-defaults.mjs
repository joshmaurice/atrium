// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// r2-clock-and-defaults — the Rev 0 review's M3 and S1, on the real adapter.
// M3: with lastTickTime shadowed (p1), does a tick still need performance.now()?
// S1: what does a running graph write when it reads an unregistered pointer, or
//     onTick's first timeSinceLastTick?
import { createBehaviorEngine, graph, lit, to, T, openWorld } from './g.mjs'

const SET = (valueNode) => ({ op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: valueNode, socket: 'value' } } })
function make(nodes) {
  const world = openWorld(1)
  const e = createBehaviorEngine({ graph: graph(nodes), nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) throw new Error(e.message)
  let now = 0
  Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
  return { e, world, at: (t) => { now = t } }
}

// M3 — performance.now replaced by a throwing stub for one tick.
{
  const { e, world, at } = make([
    { op: 'event/onTick', flows: { out: to(2) } },
    { op: 'math/combine3', values: { a: { node: 0, socket: 'timeSinceStart' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(1),
  ])
  at(1000); e.tick()
  const real = performance.now
  performance.now = () => { throw new Error('performance.now called') }
  try { at(2000); e.tick() } finally { performance.now = real }
  console.log('M3: tick with a throwing performance.now → disposed', e.disposed, e.reason, '| writes', JSON.stringify(world.state.setCalls.map((c) => c[2])))
  // the narrowed contract: performance.now changes, the op output follows `now` only
  const b = make([
    { op: 'event/onTick', flows: { out: to(2) } },
    { op: 'math/combine3', values: { a: { node: 0, socket: 'timeSinceStart' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(1),
  ])
  let fake = 5e6; performance.now = () => (fake += 777)
  try { b.at(1000); b.e.tick(); b.at(1250); b.e.tick() } finally { performance.now = real }
  console.log('M3 narrowed: real clock jumping, injected 1000 → 1250 → timeSinceStart', JSON.stringify(b.world.state.setCalls.map((c) => c[2][0])))
}

// S1 — reads that yield defaults, fed to a running pointer/set.
{
  const { e, world, at } = make([
    { op: 'event/onStart', flows: { out: to(2) } },
    { op: 'pointer/get', configuration: { pointer: { value: ['/materials/0/pbrMetallicRoughness/baseColorFactor'] }, type: { value: [T.float3] } } },
    SET(1),
  ])
  at(0); e.tick(); e.tick()
  console.log('S1a: get of an unregistered float3 path → set writes', JSON.stringify(world.state.setCalls.map((c) => c[2])), 'disposed', e.disposed)
}
{
  const { e, world, at } = make([
    { op: 'event/onTick', flows: { out: to(2) } },
    { op: 'math/combine3', values: { a: { node: 0, socket: 'timeSinceLastTick' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(1),
  ])
  at(1000); e.tick(); at(1016); e.tick()
  console.log('S1b: onTick timeSinceLastTick on ticks 1 and 2 → writes', JSON.stringify(world.state.setCalls.map((c) => c[2])))
  console.log('    as JSON on the wire:', JSON.stringify(world.state.setCalls[0]?.[2]))
}
