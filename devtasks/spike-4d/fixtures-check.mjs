// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// fixtures-check — runs tests/fixtures/behavior-conformance-4d/*.json through
// TODAY's real adapter (`createBehaviorEngine`) under the harness rules of that
// folder's README, to catch a mistake in the hand-written expectations before
// the kickoff. Test tooling, not product code: the round writes its own runner
// against the 4d adapter (G8).
//
// What it emulates of 4d, because today's adapter doesn't have it:
//  - the identity gate (G3): the ORIGINAL graph is validated, then a COPY is
//    loaded in which every declaration that isn't an executable identity has
//    its op renamed to `atrium/inert/<i>` (so `skipRules` for the copy);
//  - the clock (G3): `lastTickTime` shadowed on the engine instance (p1);
//  - injected timers: the engine's global `setTimeout` replaced for the run.
// A fixture listed in `requires4d` may still fail here for the reason given.
//
//   node devtasks/spike-4d/fixtures-check.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createBehaviorEngine, BasicBehaveEngine, NodeEventBus, validateInteractivityGraph } from './g.mjs'

const DIR = 'tests/fixtures/behavior-conformance-4d'
const NOT_RUN = new Set(['event/onHoverIn', 'event/onHoverOut', 'event/stopPropagation', 'animation/stopAt'])
const REGISTRY = [...new BasicBehaveEngine(60, new NodeEventBus()).registry.keys()]
const EXECUTABLE_OPS = new Set(REGISTRY.filter((op) => !NOT_RUN.has(op) && !op.startsWith('rigid_body/') && !op.startsWith('event/rigid_body')))
const executable = (d) => d && EXECUTABLE_OPS.has(d.op) &&
  (d.op === 'event/onSelect' ? d.extension === 'KHR_node_selectability' && Object.keys(d).length === 2 : d.extension === undefined)

// The server's value rules (send-policy.js L1316–1330, P23), for the boundary.
const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const vec = (v, n) => Array.isArray(v) && v.length === n && v.every(fin)
function valueOk(field, v) {
  switch (field) {
    case 'translation': return vec(v, 3)
    case 'rotation': return vec(v, 4) && Math.abs(Math.hypot(...v) - 1) <= 1e-3
    case 'scale': return vec(v, 3) && v.every((s) => Math.abs(s) >= 1e-6)
    case 'visible': return typeof v === 'boolean'
    case 'intensity': return fin(v)
    case 'color': return vec(v, 3)
    default: return false
  }
}
const enc = (v) => Array.isArray(v) ? v.map(enc) : (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)

function runFixture(f) {
  const state = new Map()
  for (const [i, fields] of Object.entries(f.world?.initial ?? {})) for (const [k, v] of Object.entries(fields)) state.set(`${i}:${k}`, v)
  const writes = [], refused = []
  let tick = 0
  const n = f.nodeMap.length
  const world = {
    resolve: (i) => (i < n ? { objectId: f.nodeMap[i], name: `n${i}` } : { problem: 'not-found' }),
    isOwnOrDescendant: (i) => i < n, isGranted: () => false, hasLight: (i) => (f.world?.lights ?? []).includes(i),
    get: (i, k) => state.get(`${i}:${k}`),
    set: (i, k, v) => {
      if (!valueOk(k, v)) { refused.push({ tick, index: i, field: k, value: enc(v) }); return false }
      writes.push({ tick, index: i, field: k, value: enc(v) }); state.set(`${i}:${k}`, v); return true
    },
    lightIntensity: (i) => state.get(`${i}:intensity`), setLightIntensity: (i, v) => world.set(i, 'intensity', v),
    clipStatus: () => ({ status: 'none' }), play: () => true, stop: () => true,
    worldPosition: () => [0, 0, 0], parentIndex: () => null,
  }

  // The gate: validate the stored graph, load a renamed copy.
  validateInteractivityGraph(f.graph)
  const copy = structuredClone(f.graph)
  copy.declarations = copy.declarations.map((d, i) => (executable(d) ? d : { ...d, op: `atrium/inert/${i}` }))

  // Injected timers in place of the engine's globals.
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout
  let now = f.clock.startMs, seqNo = 0
  const timers = new Map()
  globalThis.setTimeout = (fn, ms) => { const id = ++seqNo; timers.set(id, { fn, due: now + ms, seq: id }); return id }
  globalThis.clearTimeout = (id) => { timers.delete(id) }
  let e
  try {
    e = createBehaviorEngine({ graph: copy, nodeMap: f.nodeMap, world, skipRules: true, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
    if (e.problem) return { error: `rejected: ${e.message}` }
    Object.defineProperty(e.engine, 'lastTickTime', { get: () => now, configurable: true })
    // FIXED_POINTERS=1: the P26 fix as G3 specifies it, emulated: each node
    // family registered ONCE, at the highest nodeMap index, with the index read
    // from the path the engine passes. (Re-registering a path replaces its
    // callbacks in the trie.)
    if (process.env.FIXED_POINTERS === '1') {
      const idx = (p) => Number(/^\/nodes\/(\d+)\//.exec(p)?.[1])
      const fam = { translation: 'float3', rotation: 'float4', scale: 'float3', 'extensions/KHR_node_visibility/visible': 'bool' }
      for (const [suffix, type] of Object.entries(fam)) {
        const field = suffix.endsWith('visible') ? 'visible' : suffix
        e.engine.registerJsonPointer(`/nodes/${n - 1}/${suffix}`,
          (p) => { const v = world.get(idx(p), field); return field === 'visible' ? [v] : v },
          (p, v) => { world.set(idx(p), field, field === 'visible' ? (Array.isArray(v) ? v[0] : v) : v) }, type, false)
      }
    }
    for (let k = 1; k <= f.ticks; k++) {
      tick = k
      now = f.clock.startMs + (k - 1) * f.clock.stepMs
      for (const t of [...timers.values()].filter((t) => t.due <= now).sort((a, b) => a.due - b.due || a.seq - b.seq)) {
        timers.delete(t.seq); t.fn()
      }
      for (const ev of f.events ?? []) if (ev.beforeTick === k && ev.select !== undefined) e.select(ev.select)
      if (e.disposed) break
      e.tick()
    }
  } finally {
    globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear
  }
  const unsupported = f.graph.declarations.filter((d) => !executable(d)).map((d) => ({ op: d.op, extension: d.extension ?? null }))
  return { writes, refused, disposed: e.disposed ? (e.reason ?? true) : false, unsupported }
}

function same(a, b, tol) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i], tol))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => same(a[k], b[k], tol))
  }
  return a === b
}

let pass = 0, fail = 0
for (const file of readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const f = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  let got
  try { got = runFixture(f) } catch (err) { got = { error: String(err?.message ?? err) } }
  const tol = f.tolerance ?? 1e-9
  const want = { writes: f.expect.writes, refused: f.expect.refused, disposed: f.expect.disposed }
  const have = got.error ? got : { writes: got.writes, refused: got.refused, disposed: got.disposed }
  let ok = !got.error && same(have, want, tol)
  if (ok && f.expect.unsupported) ok = same(got.unsupported, f.expect.unsupported, 0)
  const tag = ok ? 'PASS' : (f.requires4d?.length ? 'DIFF (needs 4d)' : 'FAIL')
  if (ok) pass++; else if (!f.requires4d?.length) fail++
  console.log(`${tag.padEnd(16)} ${f.id}`)
  if (!ok) {
    console.log(`   want ${JSON.stringify(want)}`)
    console.log(`   have ${JSON.stringify(got.error ? got : have)}${got.unsupported ? `  unsupported ${JSON.stringify(got.unsupported)}` : ''}`)
  }
}
console.log(`\n${pass} pass, ${fail} unexpected fail`)
process.exitCode = fail ? 1 : 0
