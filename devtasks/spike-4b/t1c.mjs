// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// Bounding body-less loops: subclass the engine's own flow/while and flow/for so every
// condition / endIndex evaluation counts as a step (no loop logic copied).
import { makeEngine } from './host.mjs'
import { graph, lit, to, T } from './g.mjs'
function budgetLoops(engine) {
  for (const op of ['flow/while', 'flow/for']) {
    const Base = engine.registry.get(op)
    const Budgeted = class extends Base {
      evaluateRequiredValues(...a) { this.graphEngine.processNodeStarted(this); return super.evaluateRequiredValues(...a) }
      evaluateAllValues(...a) { this.graphEngine.processNodeStarted(this); return super.evaluateAllValues(...a) }
    }
    Budgeted.init = Base.init   // the registry calls Class.init(props)
    engine.registry.set(op, Budgeted)
  }
}
const cases = {
  'while(true), no body': graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/while', values: { condition: lit(T.bool, true) } }]),
  'for 0..1e9, no body': graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 1e9) } }]),
  'for 0..5 (normal), then completed': graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 5) }, flows: { completed: to(2) } }, { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [3] } }, values: { value: lit(T.float3, [9, 9, 9]) } }]),
}
for (const [name, g] of Object.entries(cases)) {
  const { engine, deco } = makeEngine({ world: { nodes: [{ translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true }] }, budget: 10000 })
  console.log('init is', typeof engine.registry.get('flow/while').init)
  budgetLoops(engine)
  engine.loadBehaveGraph(g, false)
  const t0 = performance.now(); const r = deco.tick(); console.log(name.padEnd(34), JSON.stringify(r), (performance.now() - t0).toFixed(1), 'ms', 'writes', JSON.stringify(deco.writes))
}
