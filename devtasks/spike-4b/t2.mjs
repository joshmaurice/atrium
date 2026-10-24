// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// Criterion 2: cleanup. Track every real timer, then dispose / reload.
const live = new Set(); const _st = globalThis.setTimeout, _ct = globalThis.clearTimeout
globalThis.setTimeout = (fn, ms, ...a) => { const h = _st(() => { live.delete(h); fn(...a) }, ms); live.add(h); return h }
globalThis.clearTimeout = (h) => { live.delete(h); _ct(h) }
const { makeEngine } = await import('./host.mjs')
const { graph, lit, to, T } = await import('./g.mjs')
const W = () => ({ nodes: [{ translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1], visible: true }] })
const setT = (v) => ({ op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [3] } }, values: { value: lit(T.float3, v) } })
// (a) a 0.5 s setDelay, then dispose before it fires
const delayG = graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/setDelay', values: { duration: lit(T.float, 0.5) }, flows: { done: to(2) } }, setT([7, 7, 7])])
let { engine, deco } = makeEngine({ world: W() }); engine.loadBehaveGraph(delayG, false); deco.tick()
console.log('(a) timers after the delay starts:', live.size)
engine.dispose(); console.log('    after dispose():', live.size)
await new Promise((r) => _st(r, 800)); deco.tick(); console.log('    writes 0.8 s later (none expected):', JSON.stringify(deco.writes))
// (b) the same, but loadBehaveGraph of another graph instead of dispose (a world change that only reloads)
;({ engine, deco } = makeEngine({ world: W() })); engine.loadBehaveGraph(delayG, false); deco.tick()
engine.loadBehaveGraph(graph([{ op: 'event/onStart' }]), false)
console.log('(b) timers after loading another graph:', live.size)
await new Promise((r) => _st(r, 800)); for (let i = 0; i < 3; i++) deco.tick()
console.log('    writes after the old delay fired (old graph acting after reload?):', JSON.stringify(deco.writes))
// (c) a pointer/interpolate over 2 s, then dispose / reload, then tick
const interpG = graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'pointer/interpolate', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [3] } }, values: { value: lit(T.float3, [10, 0, 0]), duration: lit(T.float, 2), p1: { type: 4, value: [0.25, 0.1] }, p2: { type: 4, value: [0.25, 1] } } }])
interpG.types.push({ signature: 'float2' })
for (const how of ['dispose', 'reload']) {
  ;({ engine, deco } = makeEngine({ world: W() })); engine.loadBehaveGraph(interpG, false); deco.tick()
  await new Promise((r) => _st(r, 100)); deco.tick(); const n0 = deco.writes.length
  if (how === 'dispose') engine.dispose(); else engine.loadBehaveGraph(graph([{ op: 'event/onStart' }]), false)
  await new Promise((r) => _st(r, 100)); deco.tick(); deco.tick()
  console.log(`(c) interpolation, then ${how}: writes before ${n0}, after ${deco.writes.length - n0} more`, deco.writes.length - n0 ? '(LEAK: it keeps writing)' : '(stopped)')
}
// (d) many delays: for 0..5000 { setDelay 60 s }
const many = graph([{ op: 'event/onStart', flows: { out: to(1) } }, { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 5000) }, flows: { loopBody: to(2) } }, { op: 'flow/setDelay', values: { duration: lit(T.float, 60) } }])
;({ engine, deco } = makeEngine({ world: W(), budget: 1e9 })); engine.loadBehaveGraph(many, false); const r = deco.tick()
console.log('(d) one tick scheduling 5000 delays:', JSON.stringify(r), 'live timers', live.size, 'engine.scheduledDelays', engine.scheduledDelays.length)
engine.dispose(); console.log('    after dispose', live.size)
process.exit(0)
