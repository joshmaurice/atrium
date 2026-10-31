// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// r1-extension-collision — the Rev 0 review's M1 probe (REVIEW-scripting-4d-rev0.md),
// as the reviewer wrote it, plus two controls. Does a declaration that names an
// allowlisted op WITH an extension run the real core class?
import { BasicBehaveEngine, NodeEventBus, graph, lit, to, T, validateInteractivityGraph } from './g.mjs'

function run(label, ext) {
  const g = graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/sequence', flows: { a: to(2) } },
    { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } },
      values: { value: lit(T.float3, [7, 8, 9]) } },
  ])
  if (ext) g.declarations.find((d) => d.op === 'flow/sequence').extension = ext
  let valid = 'valid'
  try { validateInteractivityGraph(g) } catch (e) { valid = `REFUSED (${e.message.slice(0, 80)})` }
  const eng = new BasicBehaveEngine(60, new NodeEventBus())
  const allow = new Set(['event/onStart', 'flow/sequence', 'pointer/set'])
  for (const op of [...eng.registry.keys()]) if (!allow.has(op)) eng.registry.delete(op)
  const writes = []
  eng.registerJsonPointer('/nodes/0/translation', () => [0, 0, 0], (_p, v) => writes.push(v), 'float3', false)
  eng.loadBehaveGraph(g, false)
  const cls = eng.idToBehaviourNodeMap.get(1).constructor.name
  eng.executeEventQueueTick()
  console.log(`${label}: validator ${valid}; node 1 class ${cls}; writes ${JSON.stringify(writes)}`)
  eng.dispose()
}
run('bare core flow/sequence', null)
run('flow/sequence with extension EXT_probe', 'EXT_probe')

// And an extension-qualified event/onTick: does the engine tick it?
{
  const g = graph([
    { op: 'event/onTick', flows: { out: to(1) } },
    { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: lit(T.float3, [1, 1, 1]) } },
  ])
  g.declarations[0].extension = 'EXT_probe'
  let valid = 'valid'
  try { validateInteractivityGraph(g) } catch (e) { valid = `REFUSED (${e.message.slice(0, 80)})` }
  const eng = new BasicBehaveEngine(60, new NodeEventBus()); const writes = []
  eng.registerJsonPointer('/nodes/0/translation', () => [0, 0, 0], (_p, v) => writes.push(v), 'float3', false)
  eng.loadBehaveGraph(g, false); eng.executeEventQueueTick(); eng.executeEventQueueTick()
  console.log(`event/onTick with extension EXT_probe: validator ${valid}; class ${eng.idToBehaviourNodeMap.get(0).constructor.name}; onTick indices ${JSON.stringify(eng.onTickNodeIndices)}; writes ${writes.length}`)
}
