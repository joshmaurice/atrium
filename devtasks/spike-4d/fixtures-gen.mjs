// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// fixtures-gen — writes tests/fixtures/behavior-conformance-4d/*.json, the 4d
// conformance fixtures (PREBRIEF-scripting-4d.md G-L11, G8), written by Claude
// before the kickoff. Every `expect` below is TYPED BY HAND from the contract
// and the engine's documented semantics. Nothing here runs the engine: the
// separate `fixtures-check.mjs` does that, to catch a mistake in these hands.
//
//   node devtasks/spike-4d/fixtures-gen.mjs

import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'tests/fixtures/behavior-conformance-4d'

// The type table every fixture uses (indices are what `type` means below).
const T = { bool: 0, int: 1, float: 2, float3: 3, float4: 4, ref: 5, float2: 6 }
const TYPES = ['bool', 'int', 'float', 'float3', 'float4', 'ref', 'float2'].map((signature) => ({ signature }))

const ID = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const NODEMAP1 = [ID(1)]
const NODEMAP2 = [ID(1), ID(2)]

const lit = (type, value) => ({ type, value: Array.isArray(value) ? value : [value] })
const to = (node, socket = 'in') => ({ node, socket })
const out = (node, socket = 'value') => ({ node, socket })
const cfg = (value) => ({ value: Array.isArray(value) ? value : [value] })

/**
 * Build a graph from nodes `{ op, ext?, ...rest }`. Declarations are unique by
 * (op, extension), in first-use order; `event/onSelect` always carries its
 * Khronos extension, as G1 requires.
 */
function graph(nodes, { variables, events } = {}) {
  const decls = []
  const keyOf = (op, ext) => `${op}|${ext ?? ''}`
  const index = new Map()
  for (const n of nodes) {
    const ext = n.op === 'event/onSelect' ? 'KHR_node_selectability' : n.ext
    const key = keyOf(n.op, ext)
    if (!index.has(key)) { index.set(key, decls.length); decls.push(ext ? { op: n.op, extension: ext } : { op: n.op }) }
  }
  const g = {
    types: TYPES.map((t) => ({ ...t })),
    declarations: decls,
    nodes: nodes.map(({ op, ext, ...rest }) => ({ declaration: index.get(keyOf(op, op === 'event/onSelect' ? 'KHR_node_selectability' : ext)), ...rest })),
  }
  if (variables) g.variables = variables
  if (events) g.events = events
  return g
}

const SET = (pointer, type, value, extra = {}) => ({
  op: 'pointer/set', configuration: { pointer: cfg(pointer), type: cfg(type) }, values: { value, ...(extra.values ?? {}) },
  ...(extra.flows ? { flows: extra.flows } : {}),
})
const TR = (i) => `/nodes/${i}/translation`
const ROT = (i) => `/nodes/${i}/rotation`
const SCALE = (i) => `/nodes/${i}/scale`
const VIS = (i) => `/nodes/${i}/extensions/KHR_node_visibility/visible`
const W = (tick, index, field, value) => ({ tick, index, field, value })

const fixtures = []
const add = (f) => fixtures.push({ clock: { startMs: 0, stepMs: 100 }, nodeMap: NODEMAP1, world: {}, events: [], requires4d: [], ...f })

// --- 01 -------------------------------------------------------------------
add({
  id: '01-onstart-variable',
  description: 'onStart sets a float variable to 7, then writes it into the own node\'s translation.x. One write, on the first tick.',
  contract: ['G-L2 variables, onStart', 'P14'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'variable/set', configuration: { variables: cfg([0]) }, values: { 0: lit(T.float, 7) }, flows: { out: to(4) } },
    { op: 'variable/get', configuration: { variable: cfg(0) } },
    { op: 'math/combine3', values: { a: out(2), b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(TR(0), T.float3, out(3)),
  ], { variables: [{ type: T.float, value: [5] }] }),
  ticks: 3,
  expect: { writes: [W(1, 0, 'translation', [7, 0, 0])], refused: [], disposed: false },
})

// --- 02 -------------------------------------------------------------------
add({
  id: '02-ontick-counter',
  description: 'onTick adds 1 to a variable and writes it each tick: x = 1, 2, 3, 4.',
  contract: ['G-L2 onTick, variables', 'P14'],
  graph: graph([
    { op: 'event/onTick', flows: { out: to(3) } },
    { op: 'variable/get', configuration: { variable: cfg(0) } },
    { op: 'math/add', values: { a: out(1), b: lit(T.float, 1) } },
    { op: 'variable/set', configuration: { variables: cfg([0]) }, values: { 0: out(2) }, flows: { out: to(6) } },
    { op: 'variable/get', configuration: { variable: cfg(0) } },
    { op: 'math/combine3', values: { a: out(4), b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(TR(0), T.float3, out(5)),
  ], { variables: [{ type: T.float, value: [0] }] }),
  ticks: 4,
  expect: { writes: [1, 2, 3, 4].map((x, k) => W(k + 1, 0, 'translation', [x, 0, 0])), refused: [], disposed: false },
})

// --- 03 -------------------------------------------------------------------
add({
  id: '03-ontick-injected-clock',
  description: 'onTick writes timeSinceStart into x. The clock is the injected one (G3), starting at 1,000 ms with 250 ms steps: x = 0, 0.25, 0.5, 0.75.',
  contract: ['G3 the clock', 'P12'],
  clock: { startMs: 1000, stepMs: 250 },
  graph: graph([
    { op: 'event/onTick', flows: { out: to(2) } },
    { op: 'math/combine3', values: { a: out(0, 'timeSinceStart'), b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(TR(0), T.float3, out(1)),
  ]),
  ticks: 4,
  expect: { writes: [0, 0.25, 0.5, 0.75].map((x, k) => W(k + 1, 0, 'translation', [x, 0, 0])), refused: [], disposed: false },
})

// --- 04 -------------------------------------------------------------------
add({
  id: '04-delay-done',
  description: 'onStart sets a 0.35 s delay; its done hides the own node. Scheduled at 0 ms, due at 350 ms, so it fires before the tick at 400 ms (tick 5) and the write happens in that tick.',
  contract: ['G3 delays (injected timers, done on the next tick)'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 0.35) }, flows: { done: to(2) } },
    SET(VIS(0), T.bool, lit(T.bool, false)),
  ]),
  ticks: 6,
  expect: { writes: [W(5, 0, 'visible', false)], refused: [], disposed: false },
})

// --- 05 -------------------------------------------------------------------
add({
  id: '05-cancel-delay',
  description: 'Two delays: a 1 s one that would hide the node, and a 0.2 s one whose done cancels the first through its lastDelay. Nothing is ever written.',
  contract: ['G3 delays: cancelDelay by lastDelay'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 1) }, flows: { done: to(5) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 0.2) }, flows: { done: to(4) } },
    { op: 'flow/cancelDelay', values: { delay: out(2, 'lastDelay') } },
    SET(VIS(0), T.bool, lit(T.bool, false)),
  ]),
  ticks: 15,
  expect: { writes: [], refused: [], disposed: false },
})

// --- 06 -------------------------------------------------------------------
add({
  id: '06-stale-delay-handle',
  description: 'Rev 0 review M4. Delay A (0.1 s) fires; its done schedules delay B (0.3 s), then cancels using A\'s lastDelay, which is now stale. A stale handle must cancel nothing: B completes at 400 ms (tick 5) and hides the node. An implementation that reuses A\'s id for B cancels B and fails this.',
  contract: ['G3 delays: monotonic ids, a stale id is a no-op'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 0.1) }, flows: { done: to(2) } },
    { op: 'flow/sequence', flows: { a: to(3), b: to(4) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 0.3) }, flows: { done: to(5) } },
    { op: 'flow/cancelDelay', values: { delay: out(1, 'lastDelay') } },
    SET(VIS(0), T.bool, lit(T.bool, false)),
  ]),
  ticks: 6,
  expect: { writes: [W(5, 0, 'visible', false)], refused: [], disposed: false },
})

// --- 07 -------------------------------------------------------------------
add({
  id: '07-pending-delay-cap',
  description: 'A loop schedules 17 delays of 100 s in one tick. The 17th takes err (G7: 16 pending per behaviour), whose flow writes scale [2,2,2] exactly once. None of the delays fires within the run.',
  contract: ['G3 delays: the 17th pending delay takes err', 'G7'],
  requires4d: ['the pending-delay cap: the engine as shipped has none (P11)'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/for', configuration: { initialIndex: cfg(0) }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 17) }, flows: { loopBody: to(2) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 100) }, flows: { err: to(3) } },
    SET(SCALE(0), T.float3, lit(T.float3, [2, 2, 2])),
  ]),
  ticks: 3,
  expect: { writes: [W(1, 0, 'scale', [2, 2, 2])], refused: [], disposed: false },
})

// --- 08 -------------------------------------------------------------------
add({
  id: '08-interpolate-linear',
  description: 'onStart interpolates translation from [0,0,0] to [10,0,0] over 1 s with a linear easing (p1 [0,0], p2 [1,1]), 250 ms steps. The engine writes the eased value each tick and, on the last, the value then the target; done runs on the next tick and writes scale [2,2,2].',
  contract: ['G-L2 pointer/interpolate', 'G3 the clock', 'P13'],
  clock: { startMs: 0, stepMs: 250 },
  tolerance: 1e-6,
  world: { initial: { 0: { translation: [0, 0, 0] } } },
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'pointer/interpolate', configuration: { pointer: cfg(TR(0)), type: cfg(T.float3) },
      values: { value: lit(T.float3, [10, 0, 0]), duration: lit(T.float, 1), p1: lit(T.float2, [0, 0]), p2: lit(T.float2, [1, 1]) }, flows: { done: to(2) } },
    SET(SCALE(0), T.float3, lit(T.float3, [2, 2, 2])),
  ]),
  ticks: 6,
  expect: {
    writes: [
      W(1, 0, 'translation', [0, 0, 0]), W(2, 0, 'translation', [2.5, 0, 0]), W(3, 0, 'translation', [5, 0, 0]),
      W(4, 0, 'translation', [7.5, 0, 0]), W(5, 0, 'translation', [10, 0, 0]), W(5, 0, 'translation', [10, 0, 0]),
      W(6, 0, 'scale', [2, 2, 2]),
    ],
    refused: [], disposed: false,
  },
})

// --- 09 -------------------------------------------------------------------
add({
  id: '09-interpolate-replaced',
  description: 'An interpolation to x = 10 over 1 s is replaced at 500 ms (a delay\'s done) by one to x = 0 over 0.5 s on the same pointer. The second starts from the value last written (2.5, read back through the host\'s own writes, G-L6). The first one\'s done (scale [2,2,2]) must never run; the second\'s (scale [3,3,3]) runs on the tick after it ends.',
  contract: ['P13 one interpolation per pointer', 'G-L6 reads see the host\'s own writes'],
  clock: { startMs: 0, stepMs: 250 },
  tolerance: 1e-6,
  world: { initial: { 0: { translation: [0, 0, 0] } } },
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
    { op: 'pointer/interpolate', configuration: { pointer: cfg(TR(0)), type: cfg(T.float3) },
      values: { value: lit(T.float3, [10, 0, 0]), duration: lit(T.float, 1), p1: lit(T.float2, [0, 0]), p2: lit(T.float2, [1, 1]) }, flows: { done: to(6) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 0.5) }, flows: { done: to(4) } },
    { op: 'pointer/interpolate', configuration: { pointer: cfg(TR(0)), type: cfg(T.float3) },
      values: { value: lit(T.float3, [0, 0, 0]), duration: lit(T.float, 0.5), p1: lit(T.float2, [0, 0]), p2: lit(T.float2, [1, 1]) }, flows: { done: to(5) } },
    SET(SCALE(0), T.float3, lit(T.float3, [3, 3, 3])),
    SET(SCALE(0), T.float3, lit(T.float3, [2, 2, 2])),
  ]),
  ticks: 7,
  expect: {
    writes: [
      W(1, 0, 'translation', [0, 0, 0]), W(2, 0, 'translation', [2.5, 0, 0]), W(3, 0, 'translation', [2.5, 0, 0]),
      W(4, 0, 'translation', [1.25, 0, 0]), W(5, 0, 'translation', [0, 0, 0]), W(5, 0, 'translation', [0, 0, 0]),
      W(6, 0, 'scale', [3, 3, 3]),
    ],
    refused: [], disposed: false,
  },
})

// --- 10 -------------------------------------------------------------------
add({
  id: '10-send-receive-loop',
  description: 'onStart sends a custom event; its receiver adds 1 to a variable, writes it, and sends the event again. An event sent during a tick runs on the next one (P10), so x = 1, 2, 3 on ticks 2, 3, 4.',
  contract: ['G-L2 event/send and receive', 'P10 run-time loops, one lap per tick'],
  graph: graph([
    { op: 'event/receive', configuration: { event: cfg(0) }, flows: { out: to(3) } },
    { op: 'variable/get', configuration: { variable: cfg(0) } },
    { op: 'math/add', values: { a: out(1), b: lit(T.float, 1) } },
    { op: 'variable/set', configuration: { variables: cfg([0]) }, values: { 0: out(2) }, flows: { out: to(6) } },
    { op: 'variable/get', configuration: { variable: cfg(0) } },
    { op: 'math/combine3', values: { a: out(4), b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(TR(0), T.float3, out(5), { flows: { out: to(7) } }),
    { op: 'event/send', configuration: { event: cfg(0) } },
    { op: 'event/onStart', flows: { out: to(9) } },
    { op: 'event/send', configuration: { event: cfg(0) } },
  ], { variables: [{ type: T.float, value: [0] }], events: [{ id: 'loop' }] }),
  ticks: 4,
  expect: { writes: [W(2, 0, 'translation', [1, 0, 0]), W(3, 0, 'translation', [2, 0, 0]), W(4, 0, 'translation', [3, 0, 0])], refused: [], disposed: false },
})

// --- 11 -------------------------------------------------------------------
add({
  id: '11-unsupported-op-inert',
  description: 'event/stopPropagation is a core op Atrium does not run (G-L2). A sequence calls it, then writes translation. The unsupported node is inert: its own out flow (scale [2,2,2]) never runs, and the sequence\'s next branch still does.',
  contract: ['G-L3 (a) stored, inert, reported', 'G3 the identity gate'],
  requires4d: ['the identity gate: the engine as shipped runs event/stopPropagation'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
    { op: 'event/stopPropagation', values: { stopImmediate: lit(T.bool, false), event: lit(T.ref, '/extensions/KHR_interactivity/events/0') }, flows: { out: to(4) } },
    SET(TR(0), T.float3, lit(T.float3, [1, 0, 0])),
    SET(SCALE(0), T.float3, lit(T.float3, [2, 2, 2])),
  ]),
  ticks: 2,
  expect: { writes: [W(1, 0, 'translation', [1, 0, 0])], refused: [], disposed: false, unsupported: [{ op: 'event/stopPropagation', extension: null }] },
})

// --- 12 -------------------------------------------------------------------
add({
  id: '12-extension-collision',
  description: 'Rev 0 review M1. flow/sequence and event/onTick are declared a second time WITH extension EXT_probe. Those declarations are not executable identities: the extension sequence never runs its branch (scale [2,2,2]) and the extension onTick never ticks (scale [3,3,3]). The bare sequence runs as normal (translation [1,0,0]).',
  contract: ['G1 EXECUTABLE identities', 'G3 the identity gate', 'P19'],
  requires4d: ['the identity gate: the engine as shipped builds both by op name (r1)'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/sequence', flows: { a: to(2), b: to(4) } },
    { op: 'flow/sequence', ext: 'EXT_probe', flows: { a: to(3) } },
    SET(SCALE(0), T.float3, lit(T.float3, [2, 2, 2])),
    SET(TR(0), T.float3, lit(T.float3, [1, 0, 0])),
    { op: 'event/onTick', ext: 'EXT_probe', flows: { out: to(6) } },
    SET(SCALE(0), T.float3, lit(T.float3, [3, 3, 3])),
  ]),
  ticks: 3,
  expect: {
    writes: [W(1, 0, 'translation', [1, 0, 0])], refused: [], disposed: false,
    unsupported: [{ op: 'flow/sequence', extension: 'EXT_probe' }, { op: 'event/onTick', extension: 'EXT_probe' }],
  },
})

// --- 13 -------------------------------------------------------------------
add({
  id: '13-nan-not-written',
  description: 'Rev 0 review S1. onTick writes timeSinceLastTick into x. On the first tick it is NaN: the write is refused at the boundary (G4) and never queued. From the second tick it is 0.1.',
  contract: ['G4 write checks', 'P21'],
  graph: graph([
    { op: 'event/onTick', flows: { out: to(2) } },
    { op: 'math/combine3', values: { a: out(0, 'timeSinceLastTick'), b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(TR(0), T.float3, out(1)),
  ]),
  ticks: 3,
  expect: { writes: [W(2, 0, 'translation', [0.1, 0, 0]), W(3, 0, 'translation', [0.1, 0, 0])], refused: [W(1, 0, 'translation', ['NaN', 0, 0])], disposed: false },
})

// --- 14 -------------------------------------------------------------------
add({
  id: '14-invalid-transform-refused',
  description: 'Rev 1 review M2. A rotation that is not a unit quaternion and a scale with a zero component are refused at the boundary by the server\'s own rules (P23); a unit rotation goes.',
  contract: ['G4 write checks by the server\'s value rules', 'P23'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/sequence', flows: { a: to(2), b: to(3), c: to(4) } },
    SET(ROT(0), T.float4, lit(T.float4, [0, 0, 0, 2])),
    SET(SCALE(0), T.float3, lit(T.float3, [0, 1, 1])),
    SET(ROT(0), T.float4, lit(T.float4, [0, 0, 0.6, 0.8])),
  ]),
  ticks: 1,
  expect: { writes: [W(1, 0, 'rotation', [0, 0, 0.6, 0.8])], refused: [W(1, 0, 'rotation', [0, 0, 0, 2]), W(1, 0, 'scale', [0, 1, 1])], disposed: false },
})

// --- 15 -------------------------------------------------------------------
const S9 = 0.15643446504023087, C9 = 0.9876883405951378
add({
  id: '15-quaternion-rotation',
  description: 'Rev 1 review N2. onTick multiplies the own rotation by a fixed 9° turn about Y. The rotation stays a unit quaternion, every write is accepted, and after k ticks it is a 9k° turn.',
  contract: ['G4 write checks', 'G-L6 reads see the host\'s own writes', 'Rev 1.1 N2'],
  tolerance: 1e-9,
  world: { initial: { 0: { rotation: [0, 0, 0, 1] } } },
  graph: graph([
    { op: 'event/onTick', flows: { out: to(3) } },
    { op: 'pointer/get', configuration: { pointer: cfg(ROT(0)), type: cfg(T.float4) } },
    { op: 'math/quatMul', values: { a: out(1), b: lit(T.float4, [0, S9, 0, C9]) } },
    SET(ROT(0), T.float4, out(2)),
  ]),
  ticks: 5,
  expect: {
    writes: [
      [0.15643446504023087, 0.9876883405951378], [0.3090169943749474, 0.9510565162951535], [0.45399049973954675, 0.8910065241883679],
      [0.5877852522924731, 0.8090169943749475], [0.7071067811865476, 0.7071067811865476],
    ].map(([s, c], k) => W(k + 1, 0, 'rotation', [0, s, 0, c])),
    refused: [], disposed: false,
  },
})

// --- 16 -------------------------------------------------------------------
add({
  id: '16-throttle',
  description: 'onTick through a 0.25 s throttle adds 1 to a variable and writes it. With 100 ms ticks from 0 it passes at 0, 300, 600 and 900 ms (ticks 1, 4, 7, 10).',
  contract: ['G-L2 flow/throttle', 'G3 the clock'],
  graph: graph([
    { op: 'event/onTick', flows: { out: to(1) } },
    { op: 'flow/throttle', values: { duration: lit(T.float, 0.25) }, flows: { out: to(4) } },
    { op: 'variable/get', configuration: { variable: cfg(0) } },
    { op: 'math/add', values: { a: out(2), b: lit(T.float, 1) } },
    { op: 'variable/set', configuration: { variables: cfg([0]) }, values: { 0: out(3) }, flows: { out: to(7) } },
    { op: 'variable/get', configuration: { variable: cfg(0) } },
    { op: 'math/combine3', values: { a: out(5), b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(TR(0), T.float3, out(6)),
  ], { variables: [{ type: T.float, value: [0] }] }),
  ticks: 11,
  expect: { writes: [[1, 1], [4, 2], [7, 3], [10, 4]].map(([t, x]) => W(t, 0, 'translation', [x, 0, 0])), refused: [], disposed: false },
})

// --- 17 -------------------------------------------------------------------
add({
  id: '17-do-n',
  description: 'onTick through flow/doN with n = 3 writes its currentCount: x = 1, 2, 3, then nothing.',
  contract: ['G-L2 flow/doN'],
  graph: graph([
    { op: 'event/onTick', flows: { out: to(1) } },
    { op: 'flow/doN', values: { n: lit(T.int, 3) }, flows: { out: to(4) } },
    { op: 'type/intToFloat', values: { a: out(1, 'currentCount') } },
    { op: 'math/combine3', values: { a: out(2), b: lit(T.float, 0), c: lit(T.float, 0) } },
    SET(TR(0), T.float3, out(3)),
  ]),
  ticks: 5,
  expect: { writes: [1, 2, 3].map((x, k) => W(k + 1, 0, 'translation', [x, 0, 0])), refused: [], disposed: false },
})

// --- 18 -------------------------------------------------------------------
add({
  id: '18-ref-pointers',
  description: 'A {ref} pointer with the ref "/nodes/1" writes node 1. One with "/nodes/2", outside a two-entry nodeMap, writes nothing and takes err, whose flow writes the own scale [9,9,9].',
  contract: ['G-L4 {ref} node pointers', 'G1', 'P15', 'P26'],
  requires4d: ['P26: the adapter as shipped sends every node pointer to the last nodeMap index, so the err flow\'s /nodes/0/scale lands on node 1'],
  nodeMap: NODEMAP2,
  world: { initial: { 1: { translation: [7, 7, 7] } } },
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
    SET('/nodes/{r}/translation', T.float3, lit(T.float3, [1, 2, 3]), { values: { r: lit(T.ref, '/nodes/1') } }),
    SET('/nodes/{r}/translation', T.float3, lit(T.float3, [4, 5, 6]), { values: { r: lit(T.ref, '/nodes/2') }, flows: { err: to(4) } }),
    SET(SCALE(0), T.float3, lit(T.float3, [9, 9, 9])),
  ]),
  ticks: 1,
  expect: { writes: [W(1, 1, 'translation', [1, 2, 3]), W(1, 0, 'scale', [9, 9, 9])], refused: [], disposed: false },
})

// --- 19 -------------------------------------------------------------------
add({
  id: '19-select',
  description: 'event/onSelect (the exact Khronos identity) hides the own node. The harness selects index 0 before tick 2, so the write happens in tick 2.',
  contract: ['G1 the onSelect identity', 'G-L2'],
  graph: graph([
    { op: 'event/onSelect', configuration: { nodeIndex: cfg(0), stopPropagation: cfg(false) }, flows: { out: to(1) } },
    SET(VIS(0), T.bool, lit(T.bool, false)),
  ]),
  events: [{ beforeTick: 2, select: 0 }],
  ticks: 3,
  expect: { writes: [W(2, 0, 'visible', false)], refused: [], disposed: false },
})

// --- 20 -------------------------------------------------------------------
add({
  id: '20-runaway-tick',
  description: 'onStart runs a 20,000-step loop with an empty body in one tick. The per-tick budget (10,000 node starts, P4) disposes the engine over-budget on the first tick; nothing is written.',
  contract: ['P4 the per-tick budget', 'G7'],
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/for', configuration: { initialIndex: cfg(0) }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 20000) }, flows: { loopBody: to(2) } },
    { op: 'flow/sequence' },
  ]),
  ticks: 2,
  expect: { writes: [], refused: [], disposed: 'over-budget' },
})

// --- 21 -------------------------------------------------------------------
add({
  id: '21-each-index-its-own-node',
  description: 'Found while writing these fixtures (P26). With a three-entry nodeMap, writes to /nodes/0, /nodes/1 and /nodes/2 must each land on their own index, and a read of /nodes/0 must read node 0. The engine\'s pointer trie keeps one index node per level, so a decorator that registers a callback per index gets only the last one.',
  contract: ['G3 pointers (P26)', 'G-L4'],
  requires4d: ['P26: the adapter as shipped resolves every index to the last registered one'],
  nodeMap: [ID(1), ID(2), ID(3)],
  world: { initial: { 0: { translation: [5, 0, 0] }, 1: { translation: [6, 0, 0] }, 2: { translation: [7, 0, 0] } } },
  graph: graph([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/sequence', flows: { a: to(2), b: to(3), c: to(4), d: to(6) } },
    SET(SCALE(0), T.float3, lit(T.float3, [2, 2, 2])),
    SET(SCALE(1), T.float3, lit(T.float3, [3, 3, 3])),
    SET(SCALE(2), T.float3, lit(T.float3, [4, 4, 4])),
    { op: 'pointer/get', configuration: { pointer: cfg(TR(0)), type: cfg(T.float3) } },
    SET(TR(2), T.float3, out(5)),
  ]),
  ticks: 1,
  expect: {
    writes: [W(1, 0, 'scale', [2, 2, 2]), W(1, 1, 'scale', [3, 3, 3]), W(1, 2, 'scale', [4, 4, 4]), W(1, 2, 'translation', [5, 0, 0])],
    refused: [], disposed: false,
  },
})

// ---------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) if (f.endsWith('.json')) rmSync(join(OUT, f))
for (const f of fixtures) {
  const ordered = { id: f.id, description: f.description, contract: f.contract, requires4d: f.requires4d,
    nodeMap: f.nodeMap, world: f.world, clock: f.clock, ticks: f.ticks, events: f.events,
    ...(f.tolerance ? { tolerance: f.tolerance } : {}), graph: f.graph, expect: f.expect }
  writeFileSync(join(OUT, `${f.id}.json`), JSON.stringify(ordered, null, 2) + '\n')
}
console.log(`wrote ${fixtures.length} fixtures to ${OUT}`)
