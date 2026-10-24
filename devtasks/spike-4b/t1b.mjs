// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// The hook-free case: flow/while(true) with NO loop body never calls processNodeStarted.
import { makeEngine } from './host.mjs'
import { graph, lit, to, T } from './g.mjs'
const g = graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/while', values: { condition: lit(T.bool, true) } }])
const { engine, deco } = makeEngine({ world: { nodes: [] }, budget: 10000 })
try { engine.loadBehaveGraph(g, false); console.log('loaded; ticking (expect a hang)') } catch (e) { console.log('rejected', e.message) }
console.log(deco.tick())
