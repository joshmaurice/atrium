// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the 4b-2 pre-brief review (Rev 0.1); not product code.
// r2 — the RUNTIME probe: which pointer-template spellings the engine resolves once a graph is loaded.
// (All of them. That is why the spike never saw M1: the runtime is lenient, the validator is not.)
import { makeEngine } from './host.mjs'

const types = [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float' }, { signature: 'ref' }]
const T = { bool: 0, int: 1, float: 2, ref: 3 }
const lit = (type, v) => ({ type, value: Array.isArray(v) ? v : [v] })
const hide = (pointer, n) => ({ types, declarations: [{ op: 'event/onStart' }, { op: 'pointer/set' }], nodes: [
  { declaration: 0, flows: { out: { node: 1, socket: 'in' } } },
  { declaration: 1, configuration: { pointer: { value: [pointer] }, type: { value: [T.bool] } }, values: { n, value: lit(T.bool, false) } },
] })
const W = () => ({ nodes: [{ translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true }, { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true, parent: 0 }], animations: [] })

for (const [name, pointer, n] of [
  ['[n] with int literal 1', '/nodes/[n]/extensions/KHR_node_visibility/visible', lit(T.int, 1)],
  ['{n} with int literal 1', '/nodes/{n}/extensions/KHR_node_visibility/visible', lit(T.int, 1)],
  ['{n} with ref literal /nodes/1', '/nodes/{n}/extensions/KHR_node_visibility/visible', lit(T.ref, '/nodes/1')],
  ['literal /nodes/1', '/nodes/1/extensions/KHR_node_visibility/visible', lit(T.int, 1)],
]) {
  const { engine, deco } = makeEngine({ world: W(), budget: 10000 })
  let loaded = 'ok'
  try { engine.loadBehaveGraph(hide(pointer, n), false) } catch (e) { loaded = `${e.constructor.name}: ${e.message.slice(0, 80)}` }
  const r = deco.tick()
  console.log(name.padEnd(32), '| load', loaded, '| tick', JSON.stringify(r), '| writes', JSON.stringify(deco.writes), '| node 1 visible =', deco.world.nodes[1].visible)
}
