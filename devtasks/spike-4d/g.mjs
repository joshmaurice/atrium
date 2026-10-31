// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// g.mjs — shared helpers for the 4d pre-brief probes. Test tooling, not product
// code: it reuses the behaviours suite's own fake world and graph builder and
// the real adapter and engine from the workspace.

export { graph, lit, to, fakeTimers, makeWorld, T } from '../../packages/behaviors/tests/fake-world.mjs'
export { createBehaviorEngine, NodeEventBus } from '../../packages/behaviors/src/adapter.js'
export { BasicBehaveEngine, validateInteractivityGraph } from '../../packages/gltf-interactivity-engine/build/index.js'

/** A world that records every set, for nodeMap indices 0..n-1, all writable. */
import { makeWorld as mw } from '../../packages/behaviors/tests/fake-world.mjs'
export function openWorld(n = 2) {
  const ids = Array.from({ length: n }, (_, i) => `0000000${i}-0000-4000-8000-000000000000`)
  return mw({ ids, descendants: ids.map((_, i) => i) })
}
export const fmt = (v) => JSON.stringify(v)
