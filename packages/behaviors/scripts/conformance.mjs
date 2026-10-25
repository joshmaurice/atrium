// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// conformance.mjs — scripting-4b-2 step 3, F11.
//
// The 4b-2 conformance run: every Khronos conformance asset whose declarations
// are ALL in F-L4's op allowlist, through the REAL adapter with a fake world.
// The expected list is checked in (`tests/fixtures/behavior-conformance.json`)
// and must match exactly.
//
// The assets are not on the build host, so this runs only when KHRONOS_ASSETS
// points at a checkout at 926bec45. Without it, the test SKIPS with a logged
// reason — the one skip the round allows.
//
// NOTE, recorded in the handoff as a finding: the filtered subset is EMPTY.
// Every conformance asset declares `event/onStart`, `variable/*`, `flow/sequence`
// and friends, none of which F-L4 runs, so nothing survives the filter.
//
//   KHRONOS_ASSETS=…/Tests/Interactivity node scripts/conformance.mjs

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BEHAVIOR_OPS } from '../src/behavior-spec.js'
import { createBehaviorEngine } from '../src/adapter.js'

/** The pinned assets commit, and the one the expected list is built from. */
export const KHRONOS_ASSETS_COMMIT = '926bec45dfbe052bad4013ab5852ed2f4042bff5'

/** The JSON of a glTF-Binary (.glb): chunk 0 is the JSON chunk. */
export function glbJson(buffer) {
  const chunkLength = buffer.readUInt32LE(12)
  return JSON.parse(buffer.subarray(20, 20 + chunkLength).toString('utf8'))
}

/** Every indexed conformance asset, with its `set` and its graph. */
export function readConformance(assetsRoot) {
  const read = (file, set) => JSON.parse(readFileSync(join(assetsRoot, file), 'utf8')).map((e) => ({ ...e, set }))
  const entries = [...read('test-index.json', 'core'), ...read('mathtests-index.json', 'math')]
  const out = []
  for (const entry of entries) {
    const rel = entry.variants?.['glTF-Binary']
    if (!rel) continue
    let json
    try { json = glbJson(readFileSync(join(assetsRoot, entry.name, 'glTF-Binary', rel))) } catch { continue }
    const extension = json.extensions?.KHR_interactivity
    const graph = extension?.graphs?.[extension.graph ?? 0]
    if (!graph || !Array.isArray(graph.declarations)) continue
    out.push({ name: entry.name, set: entry.set, graph, nodes: json.nodes ?? [] })
  }
  return out
}

/** F11's filter: the assets whose declarations are all in F-L4's list. */
export function conformanceSubset(assetsRoot) {
  return readConformance(assetsRoot)
    .filter((asset) => asset.graph.declarations.every((d) => BEHAVIOR_OPS.includes(d?.op)))
    .map((asset) => `${asset.set}:${asset.name}`)
}

/**
 * Run the subset through the real adapter, waiting out each asset's declared
 * duration with the injected clock. Returns `[{ name, result }]`.
 */
export async function runConformance(assetsRoot, { now = () => Date.now(), tickMs = 16, capMs = 15000, setTimeout: setT = setTimeout } = {}) {
  const assets = readConformance(assetsRoot)
    .filter((asset) => asset.graph.declarations.every((d) => BEHAVIOR_OPS.includes(d?.op)))
  const results = []
  for (const asset of assets) {
    const world = fakeConformanceWorld(asset.nodes)
    let outcome = null
    let duration = 5000
    const engine = createBehaviorEngine({
      graph: asset.graph,
      nodeMap: asset.nodes.map((_, i) => String(i)),
      animations: [],
      world,
      now,
      setTimeout: () => 0,
      clearTimeout: () => {},
      log: () => {},
    })
    const bus = engine.eventBus
    const original = bus.dispatchCustomEvent
    bus.dispatchCustomEvent = (name, vals) => {
      const channel = String(name).replace(/^KHR_INTERACTIVITY:/, '')
      if (channel === 'test/onStart') duration = Number(vals?.expectedDuration?.[0] ?? vals?.expectedDuration ?? 5) * 1000
      if (channel === 'test/onSuccess') outcome ??= 'pass'
      if (channel === 'test/onFailed') outcome ??= 'fail'
      return original(name, vals)
    }
    const started = now()
    while (outcome === null && now() - started < Math.min(duration + 1000, capMs)) {
      engine.tick()
      await new Promise((resolve) => setT(resolve, tickMs))
    }
    engine.dispose()
    results.push({ name: `${asset.set}:${asset.name}`, result: outcome ?? 'no result' })
  }
  return results
}

function fakeConformanceWorld(nodes) {
  const fields = new Map()
  return {
    resolve: (i) => (Number(i) < nodes.length ? { objectId: String(i), name: String(i) } : { problem: 'not-found' }),
    isOwnOrDescendant: () => true,
    isGranted: () => true,
    hasLight: () => false,
    get: (i, field) => fields.get(`${i}:${field}`),
    set: (i, field, value) => { fields.set(`${i}:${field}`, value); return true },
    lightIntensity: () => undefined,
    setLightIntensity: () => true,
    clipStatus: () => ({ status: 'none' }),
    play: () => true,
    stop: () => true,
    worldPosition: () => [0, 0, 0],
    parentIndex: (i) => (Number(i) > 0 ? 0 : null),
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const root = process.env.KHRONOS_ASSETS
  if (!root) { console.log('KHRONOS_ASSETS is not set — the conformance run is skipped'); process.exit(0) }
  const subset = conformanceSubset(root)
  console.log(`subset: ${subset.length} asset(s)`)
  console.log(subset.join('\n'))
  const results = await runConformance(root)
  const failed = results.filter((r) => r.result !== 'pass')
  console.log(`${results.length - failed.length}/${results.length} passed`)
  console.log(failed.map((r) => `${r.name} => ${r.result}`).join('\n'))
}
