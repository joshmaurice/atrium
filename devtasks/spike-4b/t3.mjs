// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// Criterion 3: pointer authorization through the adapter.
import { makeEngine } from './host.mjs'
import { graph, lit, to, T } from './g.mjs'
const W = () => ({ nodes: [0, 1, 2].map((i) => ({ translation: [i, 0, 0], rotation: [0,0,0,1], scale: [1,1,1], visible: true, parent: i === 1 ? 0 : undefined })) })
// The behaviour lives on node 0; node 1 is its child; node 2 is someone else's object (not granted).
const allowed = (i) => i === 0 || i === 1
const setTo = (ptr, v, next, err) => ({ op: 'pointer/set', configuration: { pointer: { value: [ptr] }, type: { value: [3] } }, values: { value: lit(T.float3, v), ...(ptr.includes('{n}') ? { n: lit(T.int, 2) } : {}) }, flows: { ...(next !== undefined ? { out: to(next) } : {}), ...(err !== undefined ? { err: to(err) } : {}) } })
const marker = (v) => ({ op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/scale'] }, type: { value: [3] } }, values: { value: lit(T.float3, v) } })
const run = (label, nodes, extra = {}) => {
  const { engine, deco } = makeEngine({ world: W(), allowed, ...extra }); let load = 'ok'
  try { engine.loadBehaveGraph(graph(nodes), false) } catch (e) { load = e.message.slice(0, 100) }
  const r = deco.tick()
  console.log(label.padEnd(52), '| load', load, '| tick', r.ok, '| applied', JSON.stringify(deco.writes), '| refused', JSON.stringify(deco.refused))
}
run('own node 0 (literal path)', [{ op: 'event/onStart', flows: { out: to(1) } }, setTo('/nodes/0/translation', [9,9,9])])
run('child node 1', [{ op: 'event/onStart', flows: { out: to(1) } }, setTo('/nodes/1/translation', [9,9,9])])
run('node 2, literal path, then out -> marker', [{ op: 'event/onStart', flows: { out: to(1) } }, setTo('/nodes/2/translation', [9,9,9], 2, 3), marker([5,5,5]), marker([6,6,6])])
run('node 2 via template {n}=2, out/err markers', [{ op: 'event/onStart', flows: { out: to(1) } }, setTo('/nodes/{n}/translation', [9,9,9], 2, 3), marker([5,5,5]), marker([6,6,6])])
run('node 99 (no such node): out or err?', [{ op: 'event/onStart', flows: { out: to(1) } }, setTo('/nodes/99/translation', [9,9,9], 2, 3), marker([5,5,5]), marker([6,6,6])])
run('an unregistered pointer (/nodes/0/mesh)', [{ op: 'event/onStart', flows: { out: to(1) } }, setTo('/nodes/0/weights', [9,9,9], 2, 3), marker([5,5,5]), marker([6,6,6])])
// interpolation onto a refused node: is every frame refused?
const interp = { op: 'pointer/interpolate', configuration: { pointer: { value: ['/nodes/2/translation'] }, type: { value: [3] } }, values: { value: lit(T.float3, [10,0,0]), duration: lit(T.float, 0.05), p1: { type: 4, value: [0.25, 0.1] }, p2: { type: 4, value: [0.25, 1] } } }
{ const { engine, deco } = makeEngine({ world: W(), allowed }); const g = graph([{ op: 'event/onStart', flows: { out: to(1) } }, interp]); g.types.push({ signature: 'float2' }); engine.loadBehaveGraph(g, false)
  for (let i = 0; i < 4; i++) { deco.tick(); await new Promise((r) => setTimeout(r, 20)) }
  console.log('interpolate onto node 2'.padEnd(52), '| applied', deco.writes.length, '| refused', deco.refused.length) }
// a setter that THROWS instead of ignoring: does the error escape the tick (and stop the graph)?
{ const { engine, deco } = makeEngine({ world: W(), allowed }); deco.write = function (i, f, v) { if (!allowed(i)) throw new Error('refused by the adapter'); this.writes.push([i, f]) }
  engine.loadBehaveGraph(graph([{ op: 'event/onStart', flows: { out: to(1) } }, setTo('/nodes/2/translation', [9,9,9], 2, 3), marker([5,5,5]), marker([6,6,6])]), false)
  console.log('throwing setter on node 2'.padEnd(52), '| tick', JSON.stringify(deco.tick()), '| applied', JSON.stringify(deco.writes)) }
