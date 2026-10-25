// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// probes.test.js — scripting-4b-2 step 3, F11's probes as tests.
//
// `t1`, `t1b`, `t1c`, `t2` (a), (c), (d) live in adapter.test.js, on the real
// adapter, with the op allowlist and the validator bypassed (`skipRules: true`,
// the test-only option). `t2` (b) is the reload test there. `r1` is F8's
// validator test (behavior-spec.test.js + the templates). This file is `r2`:
// which pointer spelling the RUNTIME resolves.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { createBehaviorEngine } from '../src/adapter.js'
import { makeWorld, graph, lit, to, T, OWN, TGT } from './fake-world.mjs'

const visibility = (pointer, n) => graph([
  { op: 'event/onStart', flows: { out: to(1) } },
  {
    op: 'pointer/set',
    configuration: { pointer: { value: [pointer] }, type: { value: [T.bool] } },
    values: { n, value: lit(T.bool, false) },
  },
])

function run(value, world) {
  const engine = createBehaviorEngine({
    graph: value, nodeMap: [OWN, TGT], animations: [], world, skipRules: true, log: () => {},
  })
  engine.tick()
  return world
}

describe('F11 — r2, the runtime spelling probe', () => {
  test('`[n]` with an int literal resolves: the write lands on that nodeMap index', () => {
    const world = makeWorld({ ids: [OWN, TGT], descendants: [1] })
    run(visibility('/nodes/[n]/extensions/KHR_node_visibility/visible', lit(T.int, 1)), world)
    assert.deepEqual(world.state.setCalls, [[1, 'visible', false]])
  })

  test('a literal `/nodes/1` index resolves too (the runtime is lenient)', () => {
    const world = makeWorld({ ids: [OWN, TGT], descendants: [1] })
    run(visibility('/nodes/1/extensions/KHR_node_visibility/visible', lit(T.int, 1)), world)
    assert.deepEqual(world.state.setCalls, [[1, 'visible', false]])
  })

  test('`{n}` is a ref socket: it resolves for a ref literal, which F1 refuses outright', () => {
    // The runtime resolves it — that is exactly why the spike never saw M1 —
    // but F1 refuses every `{…}` spelling before the graph ever reaches a world.
    const world = makeWorld({ ids: [OWN, TGT], descendants: [1] })
    run(visibility('/nodes/{n}/extensions/KHR_node_visibility/visible', lit(T.ref, '/nodes/1')), world)
    assert.deepEqual(world.state.setCalls, [[1, 'visible', false]])
  })
})
