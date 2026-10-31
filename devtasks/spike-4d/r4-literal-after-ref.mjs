// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// r4 — found by fixture 18: a literal pointer `/nodes/0/scale` written from the
// err flow of a {ref} pointer/set lands on node 1. Which conditions cause it?
import { createBehaviorEngine, graph, lit, to, T, openWorld } from './g.mjs'
const SET = (pointer, value, extra = {}) => ({ op: 'pointer/set', configuration: { pointer: { value: [pointer] }, type: { value: [T.float3] } }, values: { value: lit(T.float3, value), ...(extra.values ?? {}) }, ...(extra.flows ? { flows: extra.flows } : {}) })
function run(label, nodes) {
  const world = openWorld(2)
  const e = createBehaviorEngine({ graph: graph(nodes), nodeMap: world.state.ids, world, setTimeout: () => 0, clearTimeout: () => {} })
  if (e.problem) { console.log(label, 'REJECTED', e.message); return }
  e.tick(); e.tick()
  console.log(label.padEnd(58), JSON.stringify(world.state.setCalls.map(([i, f, v]) => `${i}.${f}=${v}`)))
}
run('(a) literal /nodes/0/scale alone', [{ op: 'event/onStart', flows: { out: to(1) } }, SET('/nodes/0/scale', [9, 9, 9])])
run('(b) literal /nodes/1/scale alone', [{ op: 'event/onStart', flows: { out: to(1) } }, SET('/nodes/1/scale', [9, 9, 9])])
run('(c) {r}="/nodes/1" ok, then literal /nodes/0/scale', [
  { op: 'event/onStart', flows: { out: to(1) } },
  SET('/nodes/{r}/translation', [1, 2, 3], { values: { r: lit(T.ref, '/nodes/1') }, flows: { out: to(2) } }),
  SET('/nodes/0/scale', [9, 9, 9])])
run('(d) {r}="/nodes/9" err, then literal /nodes/0/scale', [
  { op: 'event/onStart', flows: { out: to(1) } },
  SET('/nodes/{r}/translation', [1, 2, 3], { values: { r: lit(T.ref, '/nodes/9') }, flows: { err: to(2) } }),
  SET('/nodes/0/scale', [9, 9, 9])])
run('(e) [i]=1 ok, then literal /nodes/0/scale', [
  { op: 'event/onStart', flows: { out: to(1) } },
  SET('/nodes/[i]/translation', [1, 2, 3], { values: { i: lit(T.int, 1) }, flows: { out: to(2) } }),
  SET('/nodes/0/scale', [9, 9, 9])])
run('(f) literal /nodes/0/scale, then /nodes/1/scale', [
  { op: 'event/onStart', flows: { out: to(1) } },
  SET('/nodes/0/scale', [1, 1, 1], { flows: { out: to(2) } }),
  SET('/nodes/1/scale', [9, 9, 9])])
run('(g) literal /nodes/0/translation, then /nodes/0/scale', [
  { op: 'event/onStart', flows: { out: to(1) } },
  SET('/nodes/0/translation', [1, 1, 1], { flows: { out: to(2) } }),
  SET('/nodes/0/scale', [9, 9, 9])])

// Does the engine hand the callbacks the concrete path? Register ONE family at
// the highest index and log the path the setter and getter receive.
import { BasicBehaveEngine, NodeEventBus } from './g.mjs'
{
  const eng = new BasicBehaveEngine(60, new NodeEventBus())
  const seen = []
  eng.registerJsonPointer('/nodes/1/translation', (p) => { seen.push(`get ${p}`); return [0, 0, 0] }, (p, v) => seen.push(`set ${p} ${v}`), 'float3', false)
  eng.loadBehaveGraph(graph([
    { op: 'event/onStart', flows: { out: to(2) } },
    { op: 'pointer/get', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } } },
    { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: 1, socket: 'value' } }, flows: { out: to(3) } },
    SET('/nodes/1/translation', [2, 2, 2], { flows: { out: to(4) } }),
    SET('/nodes/2/translation', [3, 3, 3]),
  ]), false)
  eng.executeEventQueueTick()
  console.log('(h) one family registered at index 1; the callbacks saw:', JSON.stringify(seen))
}
