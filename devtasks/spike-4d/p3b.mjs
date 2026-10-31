// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p3b — where does the NoOp dependency throw: at load, or at the first tick that
// evaluates it? And is an op declared WITH an extension (sockets declared) safe?
import { BasicBehaveEngine, NodeEventBus, graph, lit, to, T, fmt, validateInteractivityGraph } from './g.mjs'
const g = graph([
  { op: 'event/onStart', flows: { out: to(3) } },
  { op: 'math/add', values: { a: lit(T.float, 1.5), b: lit(T.float, 2) } },
  { op: 'math/combine3', values: { a: { node: 1, socket: 'value' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
  { op: 'flow/sequence', flows: { a: to(4) } },
  { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: 2, socket: 'value' } } },
])
const eng = new BasicBehaveEngine(60, new NodeEventBus()); eng.registry.delete('math/add')
const writes = []; eng.registerJsonPointer('/nodes/0/translation', () => [0, 0, 0], (_p, v) => writes.push(v), 'float3', false)
try { eng.loadBehaveGraph(g, false); console.log('load: ok') } catch (e) { console.log('load threw:', e.constructor.name, e.message.slice(0, 80)) }
try { eng.executeEventQueueTick(); console.log('tick 1: ok, writes', fmt(writes)) } catch (e) { console.log('tick 1 threw:', e.constructor.name, e.message.slice(0, 80)) }

// An unknown EXTENSION op with a declared float output feeding combine3.
const g2 = graph([
  { op: 'event/onStart', flows: { out: to(3) } },
  { op: 'atrium/unknown', values: {} },
  { op: 'math/combine3', values: { a: { node: 1, socket: 'v' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
  { op: 'flow/sequence', flows: { a: to(4) } },
  { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: 2, socket: 'value' } } },
])
g2.declarations[1] = { op: 'atrium/unknown', extension: 'EXT_probe', outputValueSockets: { v: { type: T.float } } }
try { validateInteractivityGraph(g2); console.log('g2 validator: ok') } catch (e) { console.log('g2 validator refused:', e.message) }
const e2 = new BasicBehaveEngine(60, new NodeEventBus()); const w2 = []
e2.registerJsonPointer('/nodes/0/translation', () => [0, 0, 0], (_p, v) => w2.push(v), 'float3', false)
try { e2.loadBehaveGraph(g2, false); e2.executeEventQueueTick(); console.log('g2 tick: writes', fmt(w2)) } catch (e) { console.log('g2 threw:', e.message.slice(0, 100)) }
