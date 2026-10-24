// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// The conformance assets (test-index + mathtests-index), all at once, ticked at 60 fps in real time.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeEngine, validateInteractivityExtension } from './host.mjs'
const R = process.argv[2]
const glbJson = (f) => { const b = readFileSync(f); const n = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + n).toString('utf8')) }
const entries = [...JSON.parse(readFileSync(join(R, 'test-index.json'), 'utf8')).map((e) => ({ ...e, set: 'core' })), ...JSON.parse(readFileSync(join(R, 'mathtests-index.json'), 'utf8')).map((e) => ({ ...e, set: 'math' }))]
const runs = []
for (const e of entries) {
  const rel = e.variants?.['glTF-Binary']; if (!rel) continue
  const file = join(R, e.name, 'glTF-Binary', rel)
  const run = { e, result: null, duration: 5 }
  try {
    const json = glbJson(file); const ext = json.extensions.KHR_interactivity; validateInteractivityExtension(ext)
    const nodes = (json.nodes ?? []).map((n) => ({ translation: n.translation ?? [0,0,0], rotation: n.rotation ?? [0,0,0,1], scale: n.scale ?? [1,1,1], visible: true }))
    const { engine, deco } = makeEngine({ world: { nodes } }); run.deco = deco; run.engine = engine
    const bus = engine.eventBus ?? engine['eventBus']
    const orig = bus.dispatchCustomEvent
    bus.dispatchCustomEvent = (name, vals) => { const n = String(name).replace(/^KHR_INTERACTIVITY:/, '')
      if (n === 'test/onStart') run.duration = Number(vals?.expectedDuration?.[0] ?? vals?.expectedDuration ?? 5)
      if (n === 'test/onSuccess') run.result ??= 'pass'; if (n === 'test/onFailed') run.result ??= 'fail'; return orig(name, vals) }
    engine.loadBehaveGraph(ext.graphs[ext.graph ?? 0], false)
  } catch (err) { run.result = 'load-error: ' + String(err.message).slice(0, 80) }
  runs.push(run)
}
const t0 = performance.now(); const silence = console.log; console.log = () => {}; console.warn = () => {}
await new Promise((resolve) => { const step = () => { const t = (performance.now() - t0) / 1000
  for (const r of runs) if (r.deco && !r.result && t <= Math.min(r.duration + 1, 15)) { const x = r.deco.tick(); if (!x.ok) r.result = 'tick-error: ' + x.error.slice(0, 80) }
  if (runs.every((r) => r.result || t > Math.min(r.duration + 1, 15))) return resolve(); setTimeout(step, 1000 / 60) }; step() })
console.log = silence
const by = {}; for (const r of runs) { const k = `${r.e.set}:${(r.result ?? 'no result').split(':')[0]}`; by[k] = (by[k] ?? 0) + 1 }
console.log(runs.length, 'assets', by)
const notPass = runs.filter((r) => r.result !== 'pass').map((r) => `${r.e.name} => ${r.result ?? 'no result'}`)
console.log(notPass.slice(0, 40).join('\n'))
for (const r of runs) r.engine?.dispose(); process.exit(0)
