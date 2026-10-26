// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// adapter.test.js — scripting-4b-2 step 3, F4 (and F11's probes as tests).
//
// Everything here runs against `createBehaviorEngine` with a fake `world` and
// injected timers: no DOM, no Three.js, no real clock. The graphs that F-L4's
// allowlist or the validator would refuse are loaded with the TEST-ONLY
// `skipRules` option, so the budget, the loop subclasses and the cleanup are
// proven on their own (F11).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { createBehaviorEngine, loadBehavior, STEP_BUDGET, NodeEventBus } from '../src/adapter.js'
import { templateGraph } from '../src/templates.js'
import { makeWorld, fakeTimers, graph, lit, to, T, OWN, TGT } from './fake-world.mjs'

const hide = (params = {}) => templateGraph('select-visibility', { target: TGT, action: 'hide', ...params }, { ownId: OWN })

function engineFor(value, world, options = {}) {
  let seen = []
  const engine = createBehaviorEngine({
    graph: value.graph,
    nodeMap: value.nodeMap,
    animations: value.animations ?? [],
    proximity: value.proximity,
    interval: value.interval,
    world,
    log: (severity, message) => seen.push([severity, message]),
    ...options,
  })
  engine.seen = seen
  return engine
}

// ---------------------------------------------------------------------------
// F4 — authority
// ---------------------------------------------------------------------------

describe('F4 — authority: own node, descendant, grant; everything else refused', () => {
  test('a write to a GRANTED target applies', () => {
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine = engineFor(hide(), world)
    assert.equal(engine.problem, null)
    engine.select(0)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[1, 'visible', false]])
  })

  test('a write to a DESCENDANT applies with no grant (the same predicate, M2)', () => {
    const world = makeWorld({ ids: [OWN, TGT], descendants: [1] })
    const engine = engineFor(hide(), world)
    engine.select(0)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[1, 'visible', false]])
    assert.deepEqual(world.state.plays, [])
  })

  test('a write to an UNGRANTED node is refused, logged ONCE, and the graph continues', () => {
    const world = makeWorld({ ids: [OWN, TGT] })   // no grant, not a descendant
    const engine = engineFor(hide(), world)
    engine.select(0)
    engine.tick()
    engine.tick()
    assert.deepEqual(world.state.setCalls, [], 'nothing was written')
    const refused = engine.seen.filter(([, m]) => m.includes('refused'))
    assert.equal(refused.length, 1, 'logged exactly once for (index, field)')
    // W8 (round 6) — the line reads "refused write to …", not "refused refused
    // write to …": every `logOnce` caller passed `'refused'` as the middle word
    // and the message already started with it.
    assert.match(refused[0][1], /^refused write to /)
    assert.equal(refused[0][1].includes('refused refused'), false)
  })

  test('a renamed-away / ambiguous target (a resolve problem) is refused and logged', () => {
    const world = makeWorld({ ids: [OWN, TGT], descendants: [1], resolveProblems: { 1: 'ambiguous' } })
    const engine = engineFor(hide(), world)
    engine.select(0)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [])
    assert.equal(engine.seen.filter(([, m]) => m.includes('refused')).length, 1)
  })

  test('a pointer index past nodeMap resolves nowhere: nothing is written and `err` is taken', () => {
    const value = hide()
    value.graph.nodes[1].values.n = lit(T.int, 5)     // past nodeMap (length 2)
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine = engineFor(value, world, { skipRules: true })
    engine.select(0)
    engine.tick()
    assert.deepEqual(world.state.setCalls, [])
  })

  test('a world setter that THROWS is wrapped: the tick survives and the failure is logged', () => {
    const world = makeWorld({ ids: [OWN, TGT], granted: [1], throwSet: (i) => i === 1 })
    const engine = engineFor(hide(), world)
    engine.select(0)
    assert.doesNotThrow(() => engine.tick())
    assert.equal(engine.disposed, false)
    assert.equal(engine.seen.filter(([, m]) => m.includes('refused')).length, 1)
  })

  test('the light pointer is registered only for a node that hosts a light', () => {
    const lightValue = templateGraph('select-light', { target: TGT, intensity: 2.5 }, { ownId: OWN })
    const withLight = makeWorld({ ids: [OWN, TGT], granted: [1], lights: [1] })
    withLight.state.lightValues.set(1, 3)          // the light is ON, so the true branch writes 0
    const engine = engineFor(lightValue, withLight)
    engine.select(0)
    engine.tick()
    assert.deepEqual(withLight.state.setCalls, [[1, 'intensity', 0]], 'the on-branch writes 0')

    const noLight = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine2 = engineFor(lightValue, noLight)
    engine2.select(0)
    engine2.tick()
    assert.deepEqual(noLight.state.setCalls, [], 'no pointer, no write')
  })
})

// ---------------------------------------------------------------------------
// F4 — animations
// ---------------------------------------------------------------------------

describe('F4 — animations: the same authority predicate, the clip gated on `loaded`', () => {
  const play = () => templateGraph('select-animation', { target: TGT, clip: 'Idle', action: 'play', loop: true }, { ownId: OWN })
  const stop = () => templateGraph('select-animation', { target: TGT, clip: 'Idle', action: 'stop', loop: false }, { ownId: OWN })

  test('animation/start calls play with the table entry and the graph\'s literal speed', () => {
    const world = makeWorld({ ids: [OWN, TGT], descendants: [1], clips: { [TGT]: { status: 'loaded', clipIds: ['Idle'] } } })
    const engine = engineFor(play(), world)
    engine.select(0)
    engine.tick()
    assert.deepEqual(world.state.plays, [[TGT, 'Idle', true, 1]])
  })

  test('animation/stop calls stop', () => {
    const world = makeWorld({ ids: [OWN, TGT], descendants: [1] })
    const engine = engineFor(stop(), world)
    engine.select(0)
    engine.tick()
    assert.deepEqual(world.state.stops, [[TGT, 'Idle']])
  })

  test('a CHILD model needs no grant (Rev 2, M2): descendant only', () => {
    const world = makeWorld({ ids: [OWN, TGT], descendants: [1] })
    const engine = engineFor(play(), world)
    engine.select(0)
    engine.tick()
    assert.equal(world.state.plays.length, 1)
  })

  test('an ungranted, non-descendant model is refused and logged', () => {
    const world = makeWorld({ ids: [OWN, TGT] })
    const engine = engineFor(play(), world)
    engine.select(0)
    engine.tick()
    assert.deepEqual(world.state.plays, [])
    assert.equal(engine.seen.filter(([, m]) => m.includes('refused')).length, 1)
  })

  test('a clip not in clipIds is refused only when the host is `loaded` (S7)', () => {
    const loaded = makeWorld({ ids: [OWN, TGT], granted: [1], clips: { [TGT]: { status: 'loaded', clipIds: ['Walk'] } } })
    const e1 = engineFor(play(), loaded)
    e1.select(0)
    e1.tick()
    assert.deepEqual(loaded.state.plays, [], 'loaded without the clip: refused')

    const loading = makeWorld({ ids: [OWN, TGT], granted: [1], clips: { [TGT]: { status: 'loading' } } })
    const e2 = engineFor(play(), loading)
    e2.select(0)
    e2.tick()
    assert.equal(loading.state.plays.length, 1, 'still loading: the write goes out')
  })

  test('an animation index past the table takes the `err` flow and calls nothing', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'animation/start', values: { animation: lit(T.ref, '/animations/7'), startTime: lit(T.float, 0), endTime: lit(T.float, 3600), speed: lit(T.float, 1) }, flows: { out: to(2), err: to(3) } },
      { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/extensions/KHR_node_visibility/visible'] }, type: { value: [T.bool] } }, values: { n: lit(T.int, 0), value: lit(T.bool, false) } },
      { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/extensions/KHR_node_visibility/visible'] }, type: { value: [T.bool] } }, values: { n: lit(T.int, 0), value: lit(T.bool, true) } },
    ])
    const world = makeWorld({ ids: [OWN], descendants: [0] })
    const engine = createBehaviorEngine({
      graph: g, nodeMap: [OWN], animations: [{ object: OWN, clip: 'Idle', loop: true }],
      world, skipRules: true, log: () => {},
    })
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[0, 'visible', true]], 'the err branch ran')
  })
})

// ---------------------------------------------------------------------------
// F4 — the step budget (the probes as tests)
// ---------------------------------------------------------------------------

describe('F4 — the step budget (t1, t1b, t1c as tests)', () => {
  const setX = (next) => ({
    op: 'variable/set', configuration: { variables: { value: [0] } }, values: { '0': lit(T.int, 1) },
    ...(next !== undefined ? { flows: { out: to(next) } } : {}),
  })
  const vars = [{ type: T.int, name: 'x', value: [0] }]

  const bounded = {
    'while(true) with a body': graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/while', values: { condition: lit(T.bool, true) }, flows: { loopBody: to(2) } },
      setX(),
    ], { variables: vars }),
    'for 0..1e9 with a body': graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 1e9) }, flows: { loopBody: to(2) } },
      setX(),
    ], { variables: vars }),
    'onTick with a 1e6 for loop each frame': graph([
      { op: 'event/onTick', flows: { out: to(1) } },
      { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 1e6) }, flows: { loopBody: to(2) } },
      setX(),
    ], { variables: vars }),
  }

  for (const [name, g] of Object.entries(bounded)) {
    test(`${name}: the tick stops at the budget, disposes, and a tick afterwards throws`, () => {
      const world = makeWorld({ ids: [OWN] })
      const engine = createBehaviorEngine({ graph: g, nodeMap: [OWN], world, skipRules: true, log: () => {} })
      engine.tick()
      assert.equal(engine.disposed, true, 'disposed, never parked (S5)')
      assert.equal(engine.reason, 'over-budget')
      assert.ok(engine.steps > STEP_BUDGET, `steps ${engine.steps} past ${STEP_BUDGET}`)
      assert.throws(() => engine.tick())
    })
  }

  test('t1b: flow/while(true) with NO body is bounded by the subclass', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/while', values: { condition: lit(T.bool, true) } },
    ])
    const world = makeWorld({ ids: [OWN] })
    const engine = createBehaviorEngine({ graph: g, nodeMap: [OWN], world, skipRules: true, log: () => {} })
    engine.tick()
    assert.equal(engine.disposed, true)
    assert.equal(engine.reason, 'over-budget')
  })

  test('t1c: flow/for 0..5 completes through the subclass, and the completed flow runs', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/for', configuration: { initialIndex: { value: [0] } }, values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, 5) }, flows: { completed: to(2) } },
      { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { n: lit(T.int, 0), value: lit(T.float3, [9, 9, 9]) } },
    ])
    const world = makeWorld({ ids: [OWN] })
    const engine = createBehaviorEngine({ graph: g, nodeMap: [OWN], world, skipRules: true, log: () => {} })
    engine.tick()
    assert.equal(engine.disposed, false)
    assert.deepEqual(world.state.setCalls, [[0, 'translation', [9, 9, 9]]])
  })

  test('a synchronous cycle overflows, is caught and disposes (no parked engine)', () => {
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'flow/sequence', flows: { a: to(2) } },
      { op: 'flow/sequence', flows: { a: to(1) } },
    ])
    const world = makeWorld({ ids: [OWN] })
    const engine = createBehaviorEngine({ graph: g, nodeMap: [OWN], world, skipRules: true, log: () => {} })
    engine.tick()
    assert.equal(engine.disposed, true)
    assert.equal(engine.reason, 'over-budget')
  })
})

// ---------------------------------------------------------------------------
// F4 — the interval timer, dispose, and the loader flag
// ---------------------------------------------------------------------------

describe('F4 — the adapter\'s own interval timer, dispose and `loadBehaveGraph(graph, false)`', () => {
  const intervalValue = (seconds = 2) =>
    templateGraph('interval-animation', { target: TGT, clip: 'Idle', loop: true, seconds }, { ownId: OWN })

  test('the timer fires first after `seconds`, then every `seconds`, and the graph runs on the next tick', () => {
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine = engineFor(intervalValue(2), world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    assert.deepEqual(timers.sizes(), [2000], 'one timer, after `seconds`')
    assert.deepEqual(world.state.plays, [], 'nothing yet')

    timers.fire(2000)
    assert.deepEqual(timers.sizes(), [2000], 're-armed every `seconds`')
    engine.tick()
    assert.deepEqual(world.state.plays, [[TGT, 'Idle', true, 1]])

    timers.fire(2000)
    engine.tick()
    assert.equal(world.state.plays.length, 2)
  })

  test('dispose() clears the timer with the INJECTED clearTimeout, before engine.dispose()', () => {
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine = engineFor(intervalValue(2), world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    const id = [...timers.live.keys()][0]
    engine.dispose()
    assert.deepEqual(timers.cleared, [id])
    assert.deepEqual(timers.sizes(), [])
  })

  test('dispose() clears the event bus\' interpolation maps and custom-event listeners', () => {
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine = engineFor(intervalValue(2), world, { setTimeout: () => 0, clearTimeout: () => {} })
    const bus = engine.eventBus
    assert.ok(bus instanceof NodeEventBus)
    bus.setVariableInterpolationCallback('v', () => {})
    bus.setPointerInterpolationCallback('p', () => {})
    engine.dispose()
    assert.deepEqual(Object.keys(bus.getVariableInterpolationCallbacks()), [])
    assert.deepEqual(Object.keys(bus.getPointerInterpolationCallbacks()), [])
    assert.deepEqual(bus.getCustomEventsNames(), [])
  })

  test('a tick after dispose() throws', () => {
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine = engineFor(hide(), world)
    engine.dispose()
    assert.throws(() => engine.tick())
  })

  test('a reload is dispose-then-create: nothing the old engine scheduled stays live (t2 (b))', () => {
    const timers = fakeTimers()
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const a = engineFor(intervalValue(2), world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    assert.equal(timers.sizes().length, 1)
    a.dispose()
    const b = engineFor(intervalValue(2), world, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
    assert.deepEqual(timers.sizes(), [2000], 'exactly the new engine\'s timer')
    b.dispose()
    assert.deepEqual(timers.sizes(), [])
  })

  test('the engine is loaded with runGraph FALSE (S3): its own tick loop never starts', () => {
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine = engineFor(hide(), world)
    assert.equal(engine.engine._timerID, null)
  })

  test('the engine\'s validator is the gate: a graph it refuses comes back as `rejected`, never as a throw', () => {
    const value = hide()
    value.graph.nodes[1].declaration = 99        // F1 tolerates it; the validator does not
    const world = makeWorld({ ids: [OWN, TGT], granted: [1] })
    const engine = engineFor(value, world)
    assert.equal(engine.problem, 'rejected')
    assert.match(engine.message, /the graph is not a valid KHR_interactivity graph/)
  })
})

// ---------------------------------------------------------------------------
// F4 — events: select, proximity, debug/log
// ---------------------------------------------------------------------------

describe('F4 — the event sources the templates need', () => {
  test('select(1) on a child reaches the onSelect listener on index 0', () => {
    const world = makeWorld({ ids: [OWN, TGT], granted: [1], parents: { 1: 0 } })
    const engine = engineFor(hide(), world)
    engine.select(1)                              // the child of the behaviour node
    engine.tick()
    assert.deepEqual(world.state.setCalls, [[1, 'visible', false]])
  })

  test('proximity fires `enter` once for two avatars inside, and `exit` once when both leave (F-L7)', () => {
    const value = templateGraph('proximity-animation', { target: TGT, clip: 'Walk', loop: true, radius: 3 }, { ownId: OWN })
    const world = makeWorld({ ids: [OWN, TGT], granted: [1], position: [0, 0, 0] })
    const engine = engineFor(value, world)

    engine.proximity([[1, 0, 0]])                 // one avatar inside
    engine.tick()
    assert.equal(world.state.plays.length, 1, 'enter played the animation once')

    engine.proximity([[1, 0, 0], [-1, 0, 1]])     // a second inside: no second enter
    engine.tick()
    assert.equal(world.state.plays.length, 1, 'still playing; no second enter')

    engine.proximity([[-1, 0, 1]])                // one still inside: no exit
    engine.tick()
    assert.equal(world.state.stops.length, 0)

    engine.proximity([])                          // both gone
    engine.tick()
    assert.deepEqual(world.state.stops, [[TGT, 'Walk']])
  })

  test('debug/log reaches `log` with the message cut to 200 characters', () => {
    const long = 'x'.repeat(400)
    const g = graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'debug/log', configuration: { message: { value: [long] }, severity: { value: [1] } } },
    ])
    const lines = []
    const engine = createBehaviorEngine({ graph: g, nodeMap: [OWN], world: makeWorld({ ids: [OWN] }), skipRules: true, log: (s, m) => lines.push([s, m]) })
    engine.tick()
    assert.equal(lines.length, 1)
    assert.equal(lines[0][1].length, 200)
  })
})

// ---------------------------------------------------------------------------
// loadBehavior — the pure, reason-returning wrapper
// ---------------------------------------------------------------------------

describe('loadBehavior — rejection is a reason, not a throw', () => {
  test('a legal value has no problem', () => {
    assert.deepEqual(loadBehavior(hide(), { ownId: OWN }), { problem: null, message: null })
  })

  test('an F1 refusal comes back as its code and its text', () => {
    const value = { ...hide(), kind: 'js' }
    const result = loadBehavior(value, { ownId: OWN })
    assert.equal(result.problem, 'behavior-kind')
    assert.equal(typeof result.message, 'string')
  })

  test('a null or non-object value is a reason too', () => {
    assert.equal(loadBehavior(null, { ownId: OWN }).problem, 'not-an-object')
    assert.equal(loadBehavior(undefined, { ownId: OWN }).problem, 'not-an-object')
  })
})
