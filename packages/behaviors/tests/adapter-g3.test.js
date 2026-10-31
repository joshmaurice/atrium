// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// adapter-g3.test.js — scripting-4d-1 round 2, step 2 (G3, the adapter).
//
// Everything here runs on the REAL adapter and the REAL vendored engine and
// loader (the seam rule, signin-sync §4.1): a fake `world`, injected timers and
// an injected clock, no DOM, no Three.js, no real time.
//
// The items, as the revision's §3 names them:
//  1. the identity gate: the renamed load copy, through the real loader;
//  2. the registry kept by allowlist, its key set equal to the allowlist;
//  3. pointer registration once per family, the index read from the path (P26);
//  4. the clock: the injected `now`, and no allowlisted op on the global timer;
//  5. the delay subclasses: monotonic ids, the cap, a stale id, dispose;
//  6. the interpolation wrapper on the bus: a rejection and a sync throw;
//  7. `graphReport`, each flag;
//  8. `globalMatrix` (the read-only family from `@atrium/som`'s `worldMatrix`).
//
// `worldMatrix`'s own composition is tested in `@atrium/som`
// (packages/som/test/world-matrix.test.js): `@atrium/behaviors` gains no
// dependency, so the runner takes the matrix reads as INJECTED functions and
// this file checks the plumbing — the graph reads exactly what `world` returns.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createBehaviorEngine, graphReport, inertLoadCopy, keepRegistryByAllowlist,
  DELAY_PENDING_MAX,
} from '../src/adapter.js'
import { EXECUTABLE, isExecutableDeclaration } from '../src/behavior-spec.js'
import { makeWorld, fakeTimers, graph, lit, to, T, OWN, TGT } from './fake-world.mjs'

const THIRD = '33333333-3333-4333-8333-333333333333'

/** One engine over a bare graph, with the fake world and the log captured. */
function engineFor(g, world, options = {}) {
  const seen = []
  const engine = createBehaviorEngine({
    graph: g, nodeMap: world.state.ids, world,
    log: (severity, message) => seen.push([severity, message]),
    ...options,
  })
  engine.seen = seen
  return engine
}

/** A `pointer/set` node writing `value` to `pointer`. */
const setter = (pointer, type, value, extra = {}) => ({
  op: 'pointer/set',
  configuration: { pointer: { value: [pointer] }, type: { value: [type] } },
  values: { value: lit(type, value) },
  ...extra,
})

// ---------------------------------------------------------------------------
// 1. The identity gate
// ---------------------------------------------------------------------------

describe('G3 — the identity gate: the renamed load copy, through the real loader', () => {
  /** The Rev 0 review's `r1`: an allowlisted op name carrying an extension. */
  const r1Graph = (extension) => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2) } },
      setter('/nodes/0/translation', T.float3, [7, 8, 9]),
    ])
    if (extension) g.declarations.find((d) => d.op === 'flow/sequence').extension = extension
    return g
  }

  const onTickGraph = (extension) => {
    const g = graph([
      { op: 'event/onTick', flows: { out: to(1) } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    if (extension) g.declarations[0].extension = extension
    return g
  }

  test('r1: the BARE core op runs; the same op with an extension neither advances a flow nor ticks', () => {
    const bare = makeWorld({ ids: [OWN] })
    const bareEngine = engineFor(r1Graph(null), bare)
    bareEngine.tick()
    assert.deepEqual(bare.state.setCalls, [[0, 'translation', [7, 8, 9]]], 'the bare sequence runs')

    // The control: `flow/sequence` with EXT_probe is NOT an executable identity.
    const withExt = makeWorld({ ids: [OWN] })
    const extEngine = engineFor(r1Graph('EXT_probe'), withExt)
    assert.equal(extEngine.problem, null, 'the graph still loads')
    extEngine.tick()
    extEngine.tick()
    assert.deepEqual(withExt.state.setCalls, [], 'the extension-qualified sequence is inert')

    // ...and the same for an extension-qualified `event/onTick`: the engine's
    // tick list is built from the op NAME, so the copy must not carry the name.
    const tickBare = makeWorld({ ids: [OWN] })
    const tickBareEngine = engineFor(onTickGraph(null), tickBare)
    tickBareEngine.tick()
    tickBareEngine.tick()
    assert.equal(tickBare.state.setCalls.length, 2, 'the bare onTick ticks')

    const tickExt = makeWorld({ ids: [OWN] })
    const tickExtEngine = engineFor(onTickGraph('EXT_probe'), tickExt)
    tickExtEngine.tick()
    tickExtEngine.tick()
    assert.deepEqual(tickExt.state.setCalls, [], 'the extension-qualified onTick never ticks')
  })

  test('the exact event/onSelect declaration still works; a differently-extended one does not', () => {
    // NOTE: `extension` belongs on the DECLARATION, not on the node — the
    // builder spreads its extra keys onto the node, so it is set afterwards.
    const selectGraph = (extension) => {
      const g = graph([
        {
          op: 'event/onSelect',
          configuration: { nodeIndex: lit(T.int, 0), stopPropagation: lit(T.bool, false) },
          flows: { out: to(1) },
        },
        setter('/nodes/0/translation', T.float3, [4, 5, 6]),
      ])
      if (extension) g.declarations[0].extension = extension
      return g
    }

    const exact = makeWorld({ ids: [OWN] })
    const exactEngine = engineFor(selectGraph('KHR_node_selectability'), exact)
    assert.equal(exactEngine.problem, null, 'the exact identity loads')
    exactEngine.select(0)
    exactEngine.tick()
    assert.deepEqual(exact.state.setCalls, [[0, 'translation', [4, 5, 6]]], 'the exact identity runs')

    const other = makeWorld({ ids: [OWN] })
    const otherEngine = engineFor(selectGraph('EXT_probe'), other)
    assert.equal(otherEngine.problem, null, 'the graph still loads')
    otherEngine.select(0)
    otherEngine.tick()
    assert.deepEqual(other.state.setCalls, [], 'EXT_probe is not the identity that runs')
  })

  test('the stored value is never edited: only the loaded copy is renamed', () => {
    const g = r1Graph('EXT_probe')
    const before = JSON.stringify(g)
    const engine = engineFor(g, makeWorld({ ids: [OWN] }))
    engine.tick()
    assert.equal(JSON.stringify(g), before, 'the caller\'s graph is untouched')
    assert.equal(g.declarations[1].op, 'flow/sequence', 'the declaration keeps its op')
    assert.equal(g.declarations[1].extension, 'EXT_probe')
  })

  test('an unsupported flow op\u2019s downstream never runs (event/stopPropagation)', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
      {
        op: 'event/stopPropagation',
        values: { stopImmediate: lit(T.bool, false), event: lit(T.ref, '/extensions/KHR_interactivity/events/0') },
        flows: { out: to(4) },
      },
      setter('/nodes/0/translation', T.float3, [1, 0, 0]),
      setter('/nodes/0/scale', T.float3, [2, 2, 2]),
    ])
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[0, 'translation', [1, 0, 0]]],
      'the sequence\u2019s `b` branch reaches an inert node, whose own out never runs')
  })

  test('p3b: with skipRules, a running node reading an unsupported core value op disposes engine-error', () => {
    // `math/add` with an extension is not an executable identity, so it is
    // renamed and becomes a core NoOpNode — and a core declaration defines no
    // sockets, so the node that READS its output throws at its first evaluation.
    // (The extension is set on the DECLARATION, not on the node.)
    const g = graph([
      { op: 'event/onStart', flows: { out: to(3) } },
      { op: 'math/add', values: { a: lit(T.float, 1), b: lit(T.float, 2) } },
      { op: 'math/combine3', values: { a: { node: 1, socket: 'value' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
      { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: 2, socket: 'value' } } },
    ])
    g.declarations[1].extension = 'EXT_probe'
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { skipRules: true })
    assert.equal(engine.problem, null, 'it loads')
    engine.tick()
    assert.equal(engine.disposed, true, 'and disposes at its first tick')
    assert.equal(engine.reason, 'engine-error')
    assert.deepEqual(world.state.setCalls, [])
  })
})

// ---------------------------------------------------------------------------
// 2. The registry kept by allowlist
// ---------------------------------------------------------------------------

describe('G3 — the registry kept by allowlist', () => {
  test('the registry\u2019s key set equals the allowlist, exactly', () => {
    const engine = engineFor(graph([{ op: 'event/onStart' }]), makeWorld({ ids: [OWN] }))
    assert.deepEqual([...engine.engine.registry.keys()].sort(), [...EXECUTABLE].sort())
  })

  test('the four ops the round does not run are gone, and no rig\u2011body op survives', () => {
    const engine = engineFor(graph([{ op: 'event/onStart' }]), makeWorld({ ids: [OWN] }))
    for (const op of ['event/onHoverIn', 'event/onHoverOut', 'event/stopPropagation', 'animation/stopAt']) {
      assert.equal(engine.engine.registry.has(op), false, `${op} is not in the registry`)
    }
    for (const op of engine.engine.registry.keys()) {
      assert.ok(EXECUTABLE.includes(op), `${op} is on the allowlist`)
    }
  })

  test('keepRegistryByAllowlist is the whole rule: it rebuilds from the allowlist', () => {
    const engine = engineFor(graph([{ op: 'event/onStart' }]), makeWorld({ ids: [OWN] }))
    const before = [...engine.engine.registry.keys()].length
    keepRegistryByAllowlist(engine.engine)     // idempotent
    assert.equal([...engine.engine.registry.keys()].length, before)
    assert.equal(before, EXECUTABLE.length)
  })

  test('inertLoadCopy renames exactly the declarations that are not executable identities', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2) } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    g.declarations[1].extension = 'EXT_probe'
    g.declarations[0].extension = 'EXT_probe'
    const copy = inertLoadCopy(g)
    assert.deepEqual(copy.declarations.map((d) => isExecutableDeclaration(d.op, d.extension)), [false, false, true])
    assert.equal(copy.declarations[0].op, 'atrium/inert/0', 'the index is the declaration\u2019s')
    assert.equal(copy.declarations[1].op, 'atrium/inert/1')
    assert.equal(copy.declarations[1].extension, 'EXT_probe', 'the extension is kept')
    // ...and the copy is a copy.
    assert.notEqual(copy, g)
    assert.notEqual(copy.declarations, g.declarations)
  })
})

// ---------------------------------------------------------------------------
// 3. Pointers: one registration per family, the index read from the path (P26)
// ---------------------------------------------------------------------------

describe('G3/P26 — each index its own node', () => {
  test('a three-entry nodeMap: a write to each of /nodes/0, /1, /2 lands on that index', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2), b: to(3), c: to(4) } },
      setter('/nodes/0/scale', T.float3, [2, 2, 2]),
      setter('/nodes/1/scale', T.float3, [3, 3, 3]),
      setter('/nodes/2/scale', T.float3, [4, 4, 4]),
    ])
    const world = makeWorld({ ids: [OWN, TGT, THIRD], descendants: [1, 2] })
    const engine = engineFor(g, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [
      [0, 'scale', [2, 2, 2]], [1, 'scale', [3, 3, 3]], [2, 'scale', [4, 4, 4]],
    ])
  })

  test('a read of /nodes/0 reads node 0 (not the last index)', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(3) } },
      {
        op: 'pointer/get',
        configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } },
      },
      setter('/nodes/2/translation', T.float3, [0, 0, 0], { values: { value: { node: 2, socket: 'value' } } }),
    ])
    // Node 0's translation is the read value; index 2 is the write target.
    const world = makeWorld({ ids: [OWN, TGT, THIRD], descendants: [1, 2] })
    world.state.fields.set('0:translation', [5, 0, 0])
    const engine = engineFor(g, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[2, 'translation', [5, 0, 0]]], 'the read followed the path')
  })

  test('the same through an [x] int socket and a {x} ref socket', () => {
    const wired = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
      {
        op: 'pointer/set',
        configuration: { pointer: { value: ['/nodes/[n]/scale'] }, type: { value: [T.float3] } },
        values: { n: lit(T.int, 1), value: lit(T.float3, [7, 7, 7]) },
      },
      {
        op: 'pointer/set',
        configuration: { pointer: { value: ['/nodes/{r}/scale'] }, type: { value: [T.float3] } },
        values: { r: lit(T.ref, '/nodes/2'), value: lit(T.float3, [8, 8, 8]) },
      },
    ])
    const world = makeWorld({ ids: [OWN, TGT, THIRD], descendants: [1, 2] })
    const engine = engineFor(wired, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[1, 'scale', [7, 7, 7]], [2, 'scale', [8, 8, 8]]])
  })

  test('a light at index 0 and one at index 2: each reaches its own light, and index 1 takes err', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2), b: to(3), c: to(4) } },
      setter('/extensions/KHR_lights_punctual/lights/0/intensity', T.float, 0.5),
      setter('/extensions/KHR_lights_punctual/lights/2/intensity', T.float, 0.75),
      setter('/extensions/KHR_lights_punctual/lights/1/intensity', T.float, 1, { flows: { err: to(5) } }),
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    const world = makeWorld({ ids: [OWN, TGT, THIRD], descendants: [1, 2], lights: [0, 2] })
    const engine = engineFor(g, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [
      [0, 'intensity', 0.5],
      [2, 'intensity', 0.75],
      [0, 'translation', [1, 1, 1]],       // index 1 is not a light host: the err flow ran
    ])
    assert.equal(world.state.lightValues.get(1), undefined, 'nothing was written to index 1')
  })

  test('an index past nodeMap resolves nowhere: the write is skipped and err runs', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      setter('/nodes/2/scale', T.float3, [9, 9, 9], { flows: { err: to(2) } }),
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    const world = makeWorld({ ids: [OWN] })      // nodeMap length 1: index 2 is out
    const engine = engineFor(g, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[0, 'translation', [1, 1, 1]]])
  })
})

// ---------------------------------------------------------------------------
// 4. The clock
// ---------------------------------------------------------------------------

/** Replace the real clock with one that jumps on every read, for one block. */
function withJumpingRealClock(body) {
  const real = performance.now
  let calls = 0
  performance.now = () => (calls++, real.call(performance) + calls * 777)
  try { return body() } finally { performance.now = real }
}

describe('G3 — the clock: the ops observe the injected `now`, never the real one', () => {
  const timeSinceStart = () => graph([
    { op: 'event/onTick', flows: { out: to(2) } },
    { op: 'math/combine3', values: { a: { node: 0, socket: 'timeSinceStart' }, b: lit(T.float, 0), c: lit(T.float, 0) } },
    { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: 1, socket: 'value' } } },
  ])

  test('onTick\u2019s timeSinceStart follows the injected clock while the real one jumps', () => {
    const world = makeWorld({ ids: [OWN] })
    let clock = 1_000_000
    const engine = engineFor(timeSinceStart(), world, { now: () => clock })
    const written = []
    withJumpingRealClock(() => {
      for (const at of [1_000_000, 1_000_500, 1_002_500, 1_004_000]) {
        clock = at
        engine.tick()
      }
    })
    for (const call of world.state.setCalls) written.push(call[2][0])
    assert.deepEqual(written, [0, 0.5, 2.5, 4], 'seconds since the first tick, from `now` only')
  })

  test('flow/throttle passes exactly the ticks the injected clock allows', () => {
    const g = graph([
      { op: 'event/onTick', flows: { out: to(1) } },
      { op: 'flow/throttle', values: { duration: lit(T.float, 1) }, flows: { out: to(2) } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    const world = makeWorld({ ids: [OWN] })
    let clock = 0
    const engine = engineFor(g, world, { now: () => clock })
    withJumpingRealClock(() => {
      for (const at of [0, 500, 1000, 1500, 2050]) { clock = at; engine.tick() }
    })
    assert.equal(world.state.setCalls.length, 3, 'the ticks at 0, 1000 and 2050 passed')
  })

  test('a rejected interpolation test hook: the sync action\u2019s clock is `now`', () => {
    // The variable interpolation\u2019s action is a plain function on the engine\u2019s
    // bus; registering one directly proves the bus is ticked by `now`.
    const world = makeWorld({ ids: [OWN] })
    let clock = 10_000
    const engine = engineFor(graph([{ op: 'event/onTick' }]), world, { now: () => clock })
    const seen = []
    engine.engine.setVariableInterpolationCallback('probe', { action: () => seen.push(engine.engine.lastTickTime) })
    clock = 10_250
    engine.tick()
    clock = 10_500
    engine.tick()
    assert.deepEqual(seen, [10_250, 10_500])
  })

  test('no allowlisted op calls the global setTimeout: a throwing stub for a whole run', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 0.001) }, flows: { done: to(2) } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    const realSet = globalThis.setTimeout
    const realClear = globalThis.clearTimeout
    let threw = false
    globalThis.setTimeout = () => { threw = true; throw new Error('the global setTimeout was called') }
    globalThis.clearTimeout = () => { threw = true; throw new Error('the global clearTimeout was called') }
    try {
      engine.tick()
      timers.fire(1)
      engine.tick()
      engine.dispose()
    } finally {
      globalThis.setTimeout = realSet
      globalThis.clearTimeout = realClear
    }
    assert.equal(threw, false, 'no op touched the global timers')
    assert.deepEqual(world.state.setCalls, [[0, 'translation', [1, 1, 1]]], 'and the run really happened')
  })
})

// ---------------------------------------------------------------------------
// 5. The delays
// ---------------------------------------------------------------------------

describe('G3 — the delays: the adapter owns the timers, the ids and the cap', () => {
  // R6 (F1) — the fakes for INJECTED host functions are `this`-sensitive, as the
  // browser's own are: `window.setTimeout` throws `TypeError: Illegal
  // invocation` for any receiver but `window`, so `table.setT(…)` (receiver =
  // the delay table) killed the first delay of every behaviour on DEV — `the
  // graph threw: Illegal invocation` → `behaviour disabled — engine-error`.
  // Node ignores `this`, so every suite, fixture and conformance run stayed
  // green; this guard makes the method call fail HERE. Every delay test below —
  // done, cancel, the stale handle, the 17th, the 10,000 sequential, dispose —
  // runs on these fakes.
  test('R6 (F1): the injected timer fakes are `this`-sensitive; the delay path calls them unbound', () => {
    const timers = fakeTimers()
    assert.throws(() => timers.setTimeout(() => {}, 1),
      { name: 'TypeError', message: 'Illegal invocation' }, 'a method call throws, as in Chromium')
    assert.throws(() => timers.clearTimeout(1),
      { name: 'TypeError', message: 'Illegal invocation' }, 'and so does clearTimeout')

    const { setTimeout: setT, clearTimeout: clearT } = timers
    assert.equal(typeof setT(() => {}, 1), 'number', 'an unbound call is accepted')
    clearT(1)

    // ...and the adapter's own delay path takes the unbound call: the graph the
    // `done` test uses reaches the fake and schedules a real delay.
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 0.1) }, flows: { done: to(2) } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    engine.tick()
    assert.deepEqual(timers.sizes(), [100], 'the delay reached the fake, called unbound')
    assert.equal(engine.problem, null, 'and nothing was refused or thrown')
  })

  test('done runs after the injected time, on the tick after the timer fires', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 0.1) }, flows: { done: to(2) } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    engine.tick()
    assert.equal(world.state.setCalls.length, 0, 'nothing yet')
    assert.deepEqual(timers.sizes(), [100], 'one delay, 0.1 s')
    timers.fire(100)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[0, 'translation', [1, 1, 1]]], 'done ran on the next tick')
    assert.equal(engine.delays.size, 0, 'the fired delay left the table')
  })

  test('cancelDelay by lastDelay cancels it: the done flow never runs', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 0.1) }, flows: { done: to(3) } },
      { op: 'flow/cancelDelay', values: { delay: { node: 1, socket: 'lastDelay' } } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    // The sequence calls the cancel right after scheduling.
    g.nodes[1].flows.out = to(2)
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    engine.tick()
    assert.equal(engine.delays.size, 0, 'cancelled')
    assert.equal(timers.fire(100), false, 'the injected timer is gone')
    engine.tick()
    assert.deepEqual(world.state.setCalls, [], 'done never ran')
  })

  test('a STALE lastDelay cancels nothing: A fires, B completes (fixture 06)', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 0.1) }, flows: { done: to(2) } },
      { op: 'flow/sequence', flows: { a: to(3), b: to(4) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 0.3) }, flows: { done: to(5) } },
      { op: 'flow/cancelDelay', values: { delay: { node: 1, socket: 'lastDelay' } } },
      setter('/nodes/0/extensions/KHR_node_visibility/visible', T.bool, false),
    ])
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    engine.tick()
    // A (0.1 s) fires; its done schedules B (0.3 s) and cancels with A's handle.
    timers.fire(100)
    engine.tick()
    assert.equal(world.state.setCalls.length, 0, 'B is still pending')
    assert.equal(engine.delays.size, 1, 'exactly B is live')
    timers.fire(300)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[0, 'visible', false]], 'B completed')
  })

  test('the 17th pending delay takes err (fixture 07)', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 17) }, flows: { loopBody: to(2) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 100) }, flows: { err: to(3) } },
      setter('/nodes/0/scale', T.float3, [2, 2, 2]),
    ])
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    engine.tick()
    assert.equal(engine.delays.size, DELAY_PENDING_MAX, 'exactly the cap is pending')
    assert.deepEqual(world.state.setCalls, [[0, 'scale', [2, 2, 2]]], 'the 17th took err, once')
  })

  test('a duration outside 0 … 3600 s takes err', () => {
    for (const seconds of [-0.1, 3600.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const g = graph([
        { op: 'event/onStart', flows: { out: to(1) } },
        { op: 'flow/setDelay', values: { duration: lit(T.float, seconds) }, flows: { err: to(2) } },
        setter('/nodes/0/translation', T.float3, [1, 1, 1]),
      ])
      const timers = fakeTimers()
      const world = makeWorld({ ids: [OWN] })
      const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
      engine.tick()
      assert.equal(engine.delays.size, 0, `${seconds}: nothing pending`)
      assert.equal(world.state.setCalls.length, 1, `${seconds}: err ran`)
    }
  })

  test('10,000 sequential delays leave ONE live entry, with ids that never repeat', () => {
    const g = graph([
      { op: 'event/onTick', flows: { out: to(1) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 0.001) } },
    ])
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    for (let i = 0; i < 10_000; i++) {
      engine.tick()
      if (i < 9_999) timers.fire(1)          // every earlier delay fires; the last stays live
    }
    assert.equal(engine.delays.size, 1, 'memory follows the pending count, not the history')
    assert.deepEqual([...engine.delays.keys()], [10_000], 'the id is the 10,000th: ids never repeat')
  })

  test('dispose clears every live delay with the INJECTED clearTimeout', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 5) } },
      { op: 'flow/setDelay', values: { duration: lit(T.float, 6) } },
    ])
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    engine.tick()
    const live = [...timers.live.keys()]
    assert.equal(live.length, 2)
    engine.dispose()
    assert.deepEqual(timers.cleared.slice().sort(), live.slice().sort(), 'cleared with the injected clearTimeout')
    assert.deepEqual(timers.sizes(), [])
    assert.equal(engine.delays.size, 0)
  })
})

// ---------------------------------------------------------------------------
// 6. The interpolation wrapper on the bus
// ---------------------------------------------------------------------------

describe('G3/P25 — the interpolation wrapper: a rejection and a synchronous throw', () => {
  test('a rejected action is logged once, never reaches unhandledRejection, and disposes at the next tick', async () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      {
        op: 'pointer/interpolate',
        configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } },
        values: {
          value: lit(T.float3, [10, 0, 0]),
          duration: lit(T.float, 1),
          p1: { type: 6, value: [0, 0] },
          p2: { type: 6, value: [1, 1] },
        },
      },
    ])
    g.types = [...g.types, { signature: 'float2' }]
    const world = makeWorld({ ids: [OWN] })
    let clock = 0
    const engine = engineFor(g, world, { now: () => clock, skipRules: true })
    assert.equal(engine.problem, null, 'it loads')

    // The test-only break: `setPathValue` throwing inside the async action (r3).
    const realSetPathValue = engine.engine.setPathValue
    engine.engine.setPathValue = () => { throw new Error('probe: setPathValue') }

    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      engine.tick()                                  // the action runs and rejects
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(engine.disposed, false, 'not disposed during that tick')
      assert.equal(engine.seen.filter(([, m]) => m.includes('the interpolation rejected')).length, 1,
        'one log line')
      engine.tick()                                  // the next tick disposes it
      assert.equal(engine.disposed, true)
      assert.equal(engine.reason, 'engine-error')
      await new Promise((resolve) => setImmediate(resolve))
      assert.throws(() => engine.tick(), 'nothing runs after disposal')
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
      engine.engine.setPathValue = realSetPathValue
    }
    assert.deepEqual(unhandled, [], 'no unhandled rejection reached the process')
  })

  test('a synchronous throw in a variable interpolation is logged and disposes in the SAME tick', () => {
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(graph([{ op: 'event/onTick' }]), world)
    engine.engine.setVariableInterpolationCallback('probe', {
      action: () => { throw new Error('probe: a sync interpolation') },
    })
    engine.tick()
    assert.equal(engine.disposed, true, 'the tick wrapper saw the rethrow')
    assert.equal(engine.reason, 'engine-error')
    assert.equal(engine.seen.filter(([, m]) => m.includes('the interpolation threw')).length, 1)
  })

  test('a sync throw is RETHROWN, not swallowed (the tick wrapper is what disposes)', () => {
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(graph([{ op: 'event/onTick' }]), world)
    let rethrown = null
    engine.engine.setVariableInterpolationCallback('probe', {
      action: () => { throw new Error('probe: rethrown') },
    })
    // Calling the registered action directly: the wrapper must rethrow.
    const { action } = engine.eventBus.getVariableInterpolationCallbacks().probe
    try { action() } catch (error) { rethrown = error }
    assert.match(String(rethrown?.message), /probe: rethrown/)
  })
})

// ---------------------------------------------------------------------------
// 7. graphReport
// ---------------------------------------------------------------------------

describe('G3/S7 — graphReport, every flag', () => {
  const leaf = (g, extra = {}) => ({
    kind: 'graph', graph: g, nodeMap: [OWN], targets: [], animations: [], enabled: true, origin: 'local', ...extra,
  })

  test('a template-like graph reports nothing', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    assert.deepEqual(graphReport(leaf(g)), {
      unsupported: [], unsupportedPointers: [], missingSelectOutputs: [],
      perFrame: false, interpolates: false, startsOnLoad: true, keepsState: false,
    })
  })

  test('unsupported declarations are listed by IDENTITY, with their node counts', () => {
    const g = graph([
      { op: 'event/onTick', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
      setter('/nodes/0/scale', T.float3, [2, 2, 2]),
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    g.declarations[1].extension = 'EXT_probe'          // flow/sequence|EXT_probe
    const report = graphReport(leaf(g))
    assert.deepEqual(report.unsupported, [{ op: 'flow/sequence', extension: 'EXT_probe', count: 1 }])
    assert.equal(report.perFrame, true, 'the onTick node')
  })

  test('a pointer outside G-L4\u2019s families is reported, with its count', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
      {
        op: 'pointer/set',
        configuration: { pointer: { value: ['/materials/0/pbrMetallicRoughness/baseColorFactor'] }, type: { value: [T.float3] } },
        values: { value: lit(T.float3, [1, 1, 1]) },
      },
      {
        op: 'pointer/get',
        configuration: { pointer: { value: ['/materials/0/pbrMetallicRoughness/baseColorFactor'] }, type: { value: [T.float3] } },
      },
    ])
    const report = graphReport(leaf(g))
    assert.deepEqual(report.unsupportedPointers,
      [{ pointer: '/materials/0/pbrMetallicRoughness/baseColorFactor', count: 2 }])
    assert.deepEqual(report.unsupported, [], 'the pointer\u2019s op is executable')
  })

  test('the flags: startsOnLoad, perFrame, interpolates, keepsState, missingSelectOutputs', () => {
    const g = {
      types: [
        { signature: 'bool' }, { signature: 'int' }, { signature: 'float' },
        { signature: 'float3' }, { signature: 'float4' }, { signature: 'ref' }, { signature: 'float2' },
      ],
      variables: [{ type: 2 }],
      declarations: [
        { op: 'event/onStart' },
        { op: 'flow/sequence' },
        { op: 'pointer/interpolate' },
        { op: 'event/onTick' },
        { op: 'debug/log' },
        { op: 'event/onSelect', extension: 'KHR_node_selectability' },
      ],
      nodes: [
        { declaration: 0, flows: { out: { node: 1, socket: 'in' } } },
        { declaration: 1, flows: { a: { node: 2, socket: 'in' } } },
        {
          declaration: 2,
          configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [3] } },
          values: {
            value: { type: 3, value: [1, 0, 0] },
            duration: { type: 2, value: [1] },
            p1: { type: 6, value: [0, 0] },
            p2: { type: 6, value: [1, 1] },
          },
        },
        { declaration: 3, flows: { out: { node: 4, socket: 'in' } } },
        {
          declaration: 4,
          configuration: { message: { value: ['p'] }, severity: { value: [0] } },
          values: { message: { node: 5, socket: 'selectionPoint' } },
        },
        {
          declaration: 5,
          configuration: { nodeIndex: { value: [0] }, stopPropagation: { value: [false] } },
        },
      ],
    }
    const report = graphReport(leaf(g))
    assert.equal(report.startsOnLoad, true, 'an event/onStart node')
    assert.equal(report.perFrame, true, 'an event/onTick node')
    assert.equal(report.interpolates, true, 'a pointer/interpolate node')
    assert.equal(report.keepsState, true, 'a declared variable')
    assert.deepEqual(report.missingSelectOutputs, ['selectionPoint'], 'read from the onSelect node')
    assert.deepEqual(report.unsupported, [])
  })

  test('a malformed value reports nothing and never throws', () => {
    const empty = {
      unsupported: [], unsupportedPointers: [], missingSelectOutputs: [],
      perFrame: false, interpolates: false, startsOnLoad: false, keepsState: false,
    }
    for (const value of [null, undefined, 'graph', 7, [], {}, { graph: 3 }]) {
      assert.deepEqual(graphReport(value), empty, `${JSON.stringify(value)} reports nothing`)
    }
  })

  test('a bare graph is accepted too (the importer has one before it has a leaf)', () => {
    const g = graph([
      { op: 'event/onTick', flows: { out: to(1) } },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    assert.equal(graphReport(g).perFrame, true)
    assert.equal(graphReport(g).startsOnLoad, false)
  })
})

// ---------------------------------------------------------------------------
// p7 — event/send loops and the per-tick budget (the spec's §6 G3 row)
// ---------------------------------------------------------------------------

describe('G3 — event loops through event/send (p7)', () => {
  const RECV = { op: 'event/receive', configuration: { event: { value: [0] } } }
  const SEND = (flows) => ({ op: 'event/send', configuration: { event: { value: [0] } }, ...(flows ? { flows } : {}) })

  test('a send → earlier receive loop runs exactly ONE lap per tick', () => {
    const g = graph([
      { ...RECV, flows: { out: to(2) } },
      { op: 'event/onStart', flows: { out: to(3) } },
      SEND(),
      SEND(),
    ], { events: [{ id: 'toolkit/loop' }] })
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world)
    assert.equal(engine.problem, null, 'it loads')
    engine.tick()
    for (let i = 0; i < 29; i++) {
      engine.tick()
      assert.equal(engine.disposed, false, `tick ${i + 2} is not disposed`)
      assert.equal(engine.steps, 2, `tick ${i + 2}: one lap is two node starts`)
    }
  })

  test('a doubling fan-out is disposed over-budget', () => {
    const g = graph([
      { ...RECV, flows: { out: to(2) } },
      { op: 'event/onStart', flows: { out: to(3) } },
      { op: 'flow/sequence', flows: { a: to(3), b: to(4) } },
      SEND(),
      SEND(),
    ], { events: [{ id: 'toolkit/loop' }] })
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world)
    assert.equal(engine.problem, null, 'it loads')
    const perTick = []
    for (let i = 0; i < 30 && !engine.disposed; i++) {
      engine.tick()
      perTick.push(engine.steps)
    }
    assert.equal(engine.disposed, true, `disposed within 30 ticks (steps: ${perTick.join(',')})`)
    assert.equal(engine.reason, 'over-budget')
    // It really doubled before the budget caught it.
    assert.ok(perTick.length >= 2 && perTick[perTick.length - 1] > perTick[0], 'the fan-out grew')
  })
})

// ---------------------------------------------------------------------------
// 8. matrix / globalMatrix — the read-only families, from @atrium/som
// ---------------------------------------------------------------------------

describe('G3/G-L4 — matrix and globalMatrix are read-only, and read the injected world', () => {
  const MATRIX_0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]
  const WORLD_1 = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 10, 2, -6, 1]

  test('each index reads its OWN matrix: the index comes from the path the engine passes (P26)', () => {
    const world = makeWorld({
      ids: [OWN, TGT],
      descendants: [1],
      matrix: (i) => (i === 0 ? MATRIX_0 : null),
      worldMatrix: (i) => (i === 1 ? WORLD_1 : null),
    })
    const engine = engineFor(graph([{ op: 'event/onStart' }]), world)
    assert.deepEqual(engine.engine.getPathValue('/nodes/0/matrix'), MATRIX_0,
      'the local matrix, from world.matrix(0)')
    assert.deepEqual(engine.engine.getPathValue('/nodes/1/globalMatrix'), WORLD_1,
      'the world matrix, from world.worldMatrix(1)')
    assert.equal(engine.engine.getPathValue('/nodes/0/globalMatrix'), null, 'and index 0 asks for index 0')
  })

  test('matrix and globalMatrix are READ-ONLY: a pointer/set of one takes err', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      {
        op: 'pointer/set',
        configuration: { pointer: { value: ['/nodes/0/matrix'] }, type: { value: [7] } },
        values: { value: lit(7, MATRIX_0) },
        flows: { err: to(2) },
      },
      setter('/nodes/0/translation', T.float3, [1, 1, 1]),
    ])
    g.types = [...g.types, { signature: 'float3x3' }, { signature: 'float4x4' }]
    const world = makeWorld({ ids: [OWN] })
    const engine = engineFor(g, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[0, 'translation', [1, 1, 1]]], 'the err flow ran, nothing was written')
  })

  test('a light\u2019s colour is a float3 write through the same authority predicate', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      setter('/extensions/KHR_lights_punctual/lights/0/color', T.float3, [1, 0, 0]),
    ])
    const world = makeWorld({ ids: [OWN], lights: [0] })
    const engine = engineFor(g, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[0, 'color', [1, 0, 0]]])
  })

  test('the light colour can be READ back through the same family', () => {
    const world = makeWorld({ ids: [OWN], lights: [0] })
    world.state.lightColors.set(0, [0.25, 0.5, 0.75])
    const engine = engineFor(graph([{ op: 'event/onStart' }]), world)
    assert.deepEqual(engine.engine.getPathValue('/extensions/KHR_lights_punctual/lights/0/color'),
      [0.25, 0.5, 0.75])
  })

  /**
   * R7 — the shape the importer emits: a light's reference is the nodeMap index
   * of its HOST, and the host need not be the last mapped object. The family is
   * registered at the highest light host (G3's P26 rule), so a light reference
   * above it is a missing pointer.
   */
  test('R7: a light reference is its HOST\u2019s nodeMap index, not the nodeMap top', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2), b: to(3) } },
      setter('/extensions/KHR_lights_punctual/lights/1/intensity', T.float, 0.25),
      setter('/extensions/KHR_lights_punctual/lights/2/intensity', T.float, 0.5, { flows: { err: to(4) } }),
      setter('/nodes/2/translation', T.float3, [4, 5, 6]),
    ])
    // nodeMap [own, lightHost, plainNode]: the light lives on index 1, and
    // index 2 is not a light host.
    const world = makeWorld({ ids: [OWN, TGT, THIRD], lights: [1], descendants: [1, 2] })
    const engine = engineFor(g, world)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [
      [1, 'intensity', 0.25],
      [2, 'translation', [4, 5, 6]],       // the err flow ran: index 2 is not a light host
    ])
    assert.equal(world.state.lightValues.get(2), undefined, 'nothing was written to index 2')
  })
})
