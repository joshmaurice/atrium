// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// p6 — the Khronos conformance assets through the REAL adapter, restricted to
// G-L2 (a)'s allowlist and G7's sizes (256 nodes, 65,536 characters). Every
// asset runs at once, in real time (the engine's own delays use real timers),
// ticked every 16 ms, until it reports test/onSuccess or test/onFailed or its
// expectedDuration (+1 s, capped at 15 s) runs out.
//   KHRONOS_ASSETS=<assets>/Tests/Interactivity node devtasks/spike-4d/p6.mjs
import { readConformance } from '../../packages/behaviors/scripts/conformance.mjs'
import { createBehaviorEngine } from '../../packages/behaviors/src/adapter.js'
import { BasicBehaveEngine, NodeEventBus } from './g.mjs'

const ROOT = process.env.KHRONOS_ASSETS
const NOT_RUN = new Set(['event/onHoverIn', 'event/onHoverOut', 'event/stopPropagation', 'animation/stopAt'])
const registry = [...new BasicBehaveEngine(60, new NodeEventBus()).registry.keys()]
const ALLOW = new Set(registry.filter((op) => !NOT_RUN.has(op) && !op.startsWith('rigid_body/') && !op.startsWith('event/rigid_body')))
const fits = (a) => a.graph.declarations.every((d) => ALLOW.has(d?.op) && (!d.extension || d.extension === 'KHR_node_selectability')) &&
  (a.graph.nodes?.length ?? 0) <= 256 && JSON.stringify(a.graph).length <= 65536

function world(nodes) {
  const f = new Map()
  nodes.forEach((n, i) => {
    f.set(`${i}:translation`, n.translation ?? [0, 0, 0]); f.set(`${i}:rotation`, n.rotation ?? [0, 0, 0, 1])
    f.set(`${i}:scale`, n.scale ?? [1, 1, 1]); f.set(`${i}:visible`, n.extensions?.KHR_node_visibility?.visible ?? true)
  })
  const parent = new Map(); nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
  return {
    resolve: (i) => (Number(i) < nodes.length ? { objectId: String(i), name: String(i) } : { problem: 'not-found' }),
    isOwnOrDescendant: () => true, isGranted: () => true, hasLight: () => false,
    get: (i, k) => f.get(`${i}:${k}`), set: (i, k, v) => { f.set(`${i}:${k}`, v); return true },
    lightIntensity: () => undefined, setLightIntensity: () => true, clipStatus: () => ({ status: 'none' }),
    play: () => true, stop: () => true, worldPosition: () => [0, 0, 0], parentIndex: (i) => parent.get(Number(i)) ?? null,
  }
}
const all = readConformance(ROOT)
const subset = all.filter(fits)
console.log(`indexed assets ${all.length}; in G-L2 (a) + G7: ${subset.length}`)
const runOne = async (asset) => {
  let outcome = null, duration = 5000, reason = ''
  const fakeWorld = world(asset.nodes)
  const e = createBehaviorEngine({ graph: asset.graph, nodeMap: asset.nodes.map((_, i) => String(i)), animations: [], world: fakeWorld, setTimeout: () => 0, clearTimeout: () => {}, log: () => {} })
  e.__world = fakeWorld
  if (e.problem) return { name: `${asset.set}:${asset.name}`, result: 'rejected', reason: e.message?.slice(0, 120) }
  // FIXED_POINTERS=1 — the P26 fix emulated: one registration per family at
  // the highest index, the index read from the path (see fixtures-check.mjs).
  if (process.env.FIXED_POINTERS === '1' && asset.nodes.length > 0) {
    const w = e.__world
    const idx = (p) => Number(/^\/nodes\/(\d+)\//.exec(p)?.[1])
    const fam = { translation: 'float3', rotation: 'float4', scale: 'float3', 'extensions/KHR_node_visibility/visible': 'bool' }
    for (const [suffix, type] of Object.entries(fam)) {
      const field = suffix.endsWith('visible') ? 'visible' : suffix
      e.engine.registerJsonPointer(`/nodes/${asset.nodes.length - 1}/${suffix}`,
        (p) => { const v = w.get(String(idx(p)), field); return field === 'visible' ? [v] : v },
        (p, v) => { w.set(String(idx(p)), field, field === 'visible' ? (Array.isArray(v) ? v[0] : v) : v) }, type, false)
    }
  }
  const original = e.eventBus.dispatchCustomEvent
  e.eventBus.dispatchCustomEvent = (name, vals) => {
    const ch = String(name).replace(/^KHR_INTERACTIVITY:/, '')
    if (ch === 'test/onStart') duration = Number(vals?.expectedDuration?.[0] ?? vals?.expectedDuration ?? 5) * 1000
    if (ch === 'test/onSuccess') outcome ??= 'pass'
    if (ch === 'test/onFailed') outcome ??= 'fail'
    return original(name, vals)
  }
  const t0 = Date.now()
  while (outcome === null && !e.disposed && Date.now() - t0 < Math.min(duration + 1000, 15000)) {
    e.tick(); await new Promise((r) => setTimeout(r, 16))
  }
  if (e.disposed && outcome === null) { outcome = 'disposed'; reason = e.reason }
  e.dispose()
  return { name: `${asset.set}:${asset.name}`, result: outcome ?? 'no result', reason }
}
const results = await Promise.all(subset.map(runOne))
const by = {}
for (const r of results) (by[r.result] ??= []).push(r)
for (const [k, v] of Object.entries(by)) console.log(`${k}: ${v.length}`)
for (const r of results.filter((r) => r.result !== 'pass')) console.log(`  ${r.result.padEnd(9)} ${r.name} ${r.reason ?? ''}`)
if (process.env.P6_JSON) { (await import('node:fs')).writeFileSync(process.env.P6_JSON, JSON.stringify(results, null, 1)) }
