// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
import { makeEngine } from './host.mjs'
const world = { nodes: [{ translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true }, { translation: [5,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true, parent: 0 }] }
const { engine, deco } = makeEngine({ world })
// onStart -> pointer/set /nodes/{n}/translation (n = 1) -> pointer/set visible false on node 0
const g = { types: [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float3' }], declarations: [{ op: 'event/onStart' }, { op: 'pointer/set' }, { op: 'pointer/set' }],
  nodes: [
    { declaration: 0, flows: { out: { node: 1, socket: 'in' } } },
    { declaration: 1, configuration: { pointer: { value: ['/nodes/{n}/translation'] }, type: { value: [2] } }, values: { n: { type: 1, value: [1] }, value: { type: 2, value: [1, 2, 3] } }, flows: { out: { node: 2, socket: 'in' } } },
    { declaration: 2, configuration: { pointer: { value: ['/nodes/0/extensions/KHR_node_visibility/visible'] }, type: { value: [0] } }, values: { value: { type: 0, value: [false] } } },
  ] }
engine.loadBehaveGraph(g, false)
console.log('tick', deco.tick(), 'writes', deco.writes, 'world', JSON.stringify(world.nodes.map(n => [n.translation, n.visible])))
