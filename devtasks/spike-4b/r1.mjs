// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the 4b-2 pre-brief review (Rev 0.1); not product code.
// r1 — the VALIDATOR probe. F1 runs `validateInteractivityGraph` on the server; the spike only ever
// ran `loadBehaveGraph`, which is far more lenient. Each case goes through both, with the verdicts side by side.
import { makeEngine, validateInteractivityGraph } from './host.mjs'

const types = [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float' }, { signature: 'ref' }]
const T = { bool: 0, int: 1, float: 2, ref: 3 }
const lit = (type, v) => ({ type, value: Array.isArray(v) ? v : [v] })
const to = (node, socket = 'in') => ({ node, socket })
const VIS = (n) => `/nodes/${n}/extensions/KHR_node_visibility/visible`
const LIGHT = (n) => `/extensions/KHR_lights_punctual/lights/${n}/intensity`
const ONSELECT = { op: 'event/onSelect', extension: 'KHR_node_selectability' }

// `decls` overrides a declaration ({ op } by default); empty `events` is omitted unless `keepEmpty`.
function build(nodes, { events, decls = {}, keepEmpty = false } = {}) {
  const ops = [...new Set(nodes.map((n) => n.op))]
  const g = { types, declarations: ops.map((op) => decls[op] ?? { op }),
    nodes: nodes.map(({ op, ...rest }) => ({ declaration: ops.indexOf(op), ...rest })) }
  if (events?.length || keepEmpty) g.events = events ?? []
  if (keepEmpty) g.variables = []
  return g
}
const onSelect = (next) => ({ op: 'event/onSelect', configuration: { nodeIndex: { value: [0] }, stopPropagation: { value: [false] } }, flows: { out: to(next) } })
const anim = (op, flows) => ({ op, values: { animation: lit(T.ref, '/animations/0'), ...(op === 'animation/start' ? { startTime: lit(T.float, 0), endTime: lit(T.float, 3600), speed: lit(T.float, 1) } : {}) }, ...(flows ? { flows } : {}) })
const pset = (pointer, type, n, value, flows) => ({ op: 'pointer/set', configuration: { pointer: { value: [pointer] }, type: { value: [type] } }, values: { n, value }, ...(flows ? { flows } : {}) })
const pget = (pointer, type, n) => ({ op: 'pointer/get', configuration: { pointer: { value: [pointer] }, type: { value: [type] } }, values: { n } })

// The five F8 templates, parameterised by the pointer-template spelling and the `n` literal.
const templates = (spell, n) => ({
  'select-visibility (hide)': build([onSelect(1), pset(VIS(spell), T.bool, n, lit(T.bool, false))], { decls: { 'event/onSelect': ONSELECT } }),
  'select-visibility (toggle)': build([onSelect(3), pget(VIS(spell), T.bool, n), { op: 'math/not', values: { a: { node: 1, socket: 'value' } } },
    pset(VIS(spell), T.bool, n, { node: 2, socket: 'value' })], { decls: { 'event/onSelect': ONSELECT } }),
  'select-animation (play)': build([onSelect(1), anim('animation/start')], { decls: { 'event/onSelect': ONSELECT } }),
  'proximity-animation': build([
    { op: 'event/receive', configuration: { event: { value: [0] } }, flows: { out: to(2) } },
    { op: 'event/receive', configuration: { event: { value: [1] } }, flows: { out: to(3) } },
    anim('animation/start'), anim('animation/stop')], { events: [{ id: 'atrium/enter' }, { id: 'atrium/exit' }] }),
  'select-light': build([onSelect(3), pget(LIGHT(spell), T.float, n),
    { op: 'math/gt', values: { a: { node: 1, socket: 'value' }, b: lit(T.float, 0) } },
    { op: 'flow/branch', values: { condition: { node: 2, socket: 'value' } }, flows: { true: to(4), false: to(5) } },
    pset(LIGHT(spell), T.float, n, lit(T.float, 0)), pset(LIGHT(spell), T.float, n, lit(T.float, 2.5))], { decls: { 'event/onSelect': ONSELECT } }),
})

const cases = {}
for (const [label, spell, n] of [['{n} + int (F1/F8 as written)', '{n}', lit(T.int, 1)], ['[n] + int', '[n]', lit(T.int, 1)], ['{n} + ref /nodes/1', '{n}', lit(T.ref, '/nodes/1')]]) {
  for (const [name, g] of Object.entries(templates(spell, n))) cases[`${name.padEnd(28)} ${label}`] = g
}
Object.assign(cases, {
  'interval-animation, F8 row 5 (delayed self-loop, t6 item 4)': build([
    { op: 'event/onStart', flows: { out: to(1) } },
    { op: 'flow/setDelay', values: { duration: lit(T.float, 0.05) }, flows: { done: to(2) } },
    anim('animation/start', { out: to(1) })]),
  'interval-animation, alternative (a): event/receive atrium/interval': build([
    { op: 'event/receive', configuration: { event: { value: [0] } }, flows: { out: to(1) } }, anim('animation/start')], { events: [{ id: 'atrium/interval' }] }),
  'interval-animation, alternative (b): onTick -> throttle': build([
    { op: 'event/onTick', flows: { out: to(1) } },
    { op: 'flow/throttle', values: { duration: lit(T.float, 3) }, flows: { out: to(2) } }, anim('animation/start')]),
  'sync cycle sequence -> sequence (t6 item 5)': build([
    { op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/sequence', flows: { a: to(2) } }, { op: 'flow/sequence', flows: { a: to(1) } }]),
  'F-L2 shape: select-animation + empty variables/events arrays': build([onSelect(1), anim('animation/start')], { decls: { 'event/onSelect': ONSELECT }, keepEmpty: true }),
  'event/onSelect declared bare, without its extension': build([onSelect(1), anim('animation/start')]),
})

const W = () => ({ nodes: [{ translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true }, { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true, parent: 0 }], animations: [{}] })
for (const [name, g] of Object.entries(cases)) {
  let v = 'accepted'
  try { validateInteractivityGraph(g) } catch (e) { v = `REJECTED: ${e.message.replace('Invalid KHR_interactivity: ', '').slice(0, 60)}` }
  let loaded = 'ok'
  const { engine } = makeEngine({ world: W(), budget: 10000 })
  try { engine.loadBehaveGraph(g, false) } catch (e) { loaded = `${e.constructor.name}: ${e.message.slice(0, 60)}` }
  console.log(name.padEnd(66), '| validate:', v.padEnd(52), '| load:', loaded)
}
