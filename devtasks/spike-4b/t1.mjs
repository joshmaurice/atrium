// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// Criterion 1: bounded execution.
import { makeEngine } from './host.mjs'
import { graph, lit, to, T } from './g.mjs'
const world = () => ({ nodes: [{ translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true }] })
const vars = [{ type: T.int, name: 'x', value: [0] }]
const setX = (next) => ({ op: 'variable/set', configuration: { variables: { value: [0] } }, values: { '0': lit(T.int, 1) }, ...(next !== undefined ? { flows: { out: to(next) } } : {}) })
const cases = {
  'while(true) with a body': graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/while', values: { condition: lit(T.bool, true) }, flows: { loopBody: to(2) } }, setX()], { variables: vars }),
  'for 0..1e9 with a body': graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 1e9) }, flows: { loopBody: to(2) } }, setX()], { variables: vars }),
  'a flow cycle (sequence -> set -> sequence)': graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/sequence', flows: { a: to(2) } }, setX(1)], { variables: vars }),
  'onTick with a 1e6 for loop each frame': graph([{ op: 'event/onTick', flows: { out: to(1) } }, { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 1e6) }, flows: { loopBody: to(2) } }, setX()], { variables: vars }),
}
const only = process.argv[2]
for (const [name, g] of Object.entries(cases)) {
  if (only && !name.startsWith(only)) continue
  const { engine, deco } = makeEngine({ world: world(), budget: 10000 })
  let loaded = 'ok'
  try { engine.loadBehaveGraph(g, false) } catch (e) { loaded = `${e.constructor.name}: ${e.message.slice(0, 120)}` }
  const t0 = performance.now(); const r1 = deco.tick(); const r2 = deco.tick(); const ms = (performance.now() - t0).toFixed(1)
  console.log(name.padEnd(46), '| load', loaded, '| tick1', JSON.stringify(r1), '| tick2', JSON.stringify(r2), '|', ms, 'ms')
}
