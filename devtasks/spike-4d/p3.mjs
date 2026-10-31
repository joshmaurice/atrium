// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p3 — the registry gate. If an op is deleted from `engine.registry` before
// `loadBehaveGraph`, is it a NoOpNode (flows stop, outputs default), for a FLOW
// op and for a pure VALUE op (the engine's value compiler, L36/L233)?
import { BasicBehaveEngine, NodeEventBus, graph, lit, to, T, fmt, validateInteractivityGraph } from './g.mjs'

function engineWith(deleted) {
  const eng = new BasicBehaveEngine(60, new NodeEventBus())
  for (const op of deleted) eng.registry.delete(op)
  const writes = []
  eng.registerJsonPointer('/nodes/0/translation', () => [0, 0, 0], (_p, v) => writes.push(v), 'float3', false)
  return { eng, writes }
}
// onStart → sequence → pointer/set translation = combine3(add(1.5, 2), 0, 0)
const g = graph([
  { op: 'event/onStart', flows: { out: to(3) } },
  { op: 'math/add', values: { a: lit(T.float, 1.5), b: lit(T.float, 2) } },
  { op: 'math/combine3', values: { a: { node: 1, socket: 'value' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
  { op: 'flow/sequence', flows: { a: to(4) } },
  { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: 2, socket: 'value' } } },
])
validateInteractivityGraph(g)
for (const deleted of [[], ['math/add'], ['flow/sequence'], ['math/combine3']]) {
  const { eng, writes } = engineWith(deleted)
  let err = null
  try { eng.loadBehaveGraph(g, false); eng.executeEventQueueTick(); eng.executeEventQueueTick() } catch (e) { err = e.message }
  const kinds = [...eng.idToBehaviourNodeMap.values()].map((n) => n.constructor.name)
  console.log(`deleted ${fmt(deleted)}: writes ${fmt(writes)}${err ? ' threw: ' + err : ''} | node classes ${kinds.join(',')}`)
}
// And the allowlist route: keep exactly a set, delete the rest. Registry size before and after.
{
  const eng = new BasicBehaveEngine(60, new NodeEventBus())
  const before = eng.registry.size
  const keep = new Set(['event/onStart', 'flow/sequence', 'math/add', 'math/combine3', 'pointer/set'])
  for (const op of [...eng.registry.keys()]) if (!keep.has(op)) eng.registry.delete(op)
  console.log('registry keys before', before, 'after keep-by-allowlist', eng.registry.size, fmt([...eng.registry.keys()]))
}
