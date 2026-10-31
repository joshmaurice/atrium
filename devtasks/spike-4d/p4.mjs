// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p4 — refs and wired indices against the registered pointers.
// The decorator registers pointers for nodeMap indices only (here 0 and 1).
import { createBehaviorEngine, graph, lit, to, T, fmt, openWorld } from './g.mjs'

function run(label, nodes, { types = [] } = {}) {
  const g = graph(nodes); for (const t of types) g.types.push(t)
  const world = openWorld(2)
  world.state.fields.set('1:translation', [7, 7, 7])
  const e = createBehaviorEngine({ graph: g, nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) { console.log(label, '→ REJECTED:', e.message); return }
  let now = 0
  Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
  for (const t of [0, 0, 500, 1000, 1100]) { now = t; e.tick() }
  console.log(label, '→ sets', fmt(world.state.setCalls))
}
const SET = (pointer, extra = {}) => ({ op: 'pointer/set', configuration: { pointer: { value: [pointer] }, type: { value: [T.float3] } }, ...extra })
// err → a marker write to node 0's scale, so a taken err is visible
const MARK = { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/scale'] }, type: { value: [T.float3] } }, values: { value: lit(T.float3, [9, 9, 9]) } }

run('(a) set /nodes/{r}/translation r="/nodes/1"', [
  { op: 'event/onStart', flows: { out: to(1) } },
  SET('/nodes/{r}/translation', { values: { r: lit(T.ref, '/nodes/1'), value: lit(T.float3, [1, 2, 3]) }, flows: { err: to(2) } }), MARK])
run('(b) set /nodes/{r}/translation r="/nodes/9" (not in nodeMap)', [
  { op: 'event/onStart', flows: { out: to(1) } },
  SET('/nodes/{r}/translation', { values: { r: lit(T.ref, '/nodes/9'), value: lit(T.float3, [1, 2, 3]) }, flows: { err: to(2) } }), MARK])
run('(c) set /nodes/[i]/translation i wired = add(4,5) = 9', [
  { op: 'event/onStart', flows: { out: to(2) } },
  { op: 'math/add', values: { a: lit(T.int, 4), b: lit(T.int, 5) } },
  SET('/nodes/[i]/translation', { values: { i: { node: 1, socket: 'value' }, value: lit(T.float3, [1, 2, 3]) }, flows: { err: to(3) } }), MARK])
run('(d) set /nodes/[i]/translation i wired = add(0,1) = 1', [
  { op: 'event/onStart', flows: { out: to(2) } },
  { op: 'math/add', values: { a: lit(T.int, 0), b: lit(T.int, 1) } },
  SET('/nodes/[i]/translation', { values: { i: { node: 1, socket: 'value' }, value: lit(T.float3, [1, 2, 3]) }, flows: { err: to(3) } }), MARK])
run('(e) get /nodes/{r}/translation r="/nodes/1" → set node 0', [
  { op: 'event/onStart', flows: { out: to(2) } },
  { op: 'pointer/get', configuration: { pointer: { value: ['/nodes/{r}/translation'] }, type: { value: [T.float3] } }, values: { r: lit(T.ref, '/nodes/1') } },
  SET('/nodes/0/translation', { values: { value: { node: 1, socket: 'value' } } })])
run('(f) get /nodes/{r}/translation r="/nodes/9": isValid → branch', [
  { op: 'event/onStart', flows: { out: to(2) } },
  { op: 'pointer/get', configuration: { pointer: { value: ['/nodes/{r}/translation'] }, type: { value: [T.float3] } }, values: { r: lit(T.ref, '/nodes/9') } },
  { op: 'flow/branch', values: { condition: { node: 1, socket: 'isValid' } }, flows: { true: to(3), false: to(4) } },
  SET('/nodes/0/translation', { values: { value: lit(T.float3, [1, 1, 1]) } }), MARK])
const F2 = { signature: 'float2' }
run('(g) interpolate /nodes/{r}/translation r="/nodes/1" over 1 s', [
  { op: 'event/onStart', flows: { out: to(1) } },
  { op: 'pointer/interpolate', configuration: { pointer: { value: ['/nodes/{r}/translation'] }, type: { value: [T.float3] } },
    values: { r: lit(T.ref, '/nodes/1'), value: lit(T.float3, [17, 7, 7]), duration: lit(T.float, 1), p1: { type: 6, value: [0, 0] }, p2: { type: 6, value: [1, 1] } }, flows: { err: to(2) } }, MARK], { types: [F2] })
run('(h) interpolate /nodes/{r}/translation r="/nodes/9"', [
  { op: 'event/onStart', flows: { out: to(1) } },
  { op: 'pointer/interpolate', configuration: { pointer: { value: ['/nodes/{r}/translation'] }, type: { value: [T.float3] } },
    values: { r: lit(T.ref, '/nodes/9'), value: lit(T.float3, [17, 7, 7]), duration: lit(T.float, 1), p1: { type: 6, value: [0, 0] }, p2: { type: 6, value: [1, 1] } }, flows: { err: to(2) } }, MARK], { types: [F2] })
