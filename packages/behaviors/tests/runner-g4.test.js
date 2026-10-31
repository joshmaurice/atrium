// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// runner-g4.test.js — scripting-4d-1 round 2, step 3 (G4, and G5's `som:set`).
//
// The runner's own step, item by item (the revision's §3, "Card 2"):
//  1. the WRITE CHECK, through `../src/value-rules.js`, before the queue and the
//     overlay, with the refusal logged once per (behaviour, index, field);
//  2. the TOTAL send opportunity: `canSend()` false, a throw, a non-number;
//  3. the frame limit and its ROTATION, the 9 ms stop, "Throttled" after two
//     seconds of skips, and the per-tick budget unchanged;
//  4. the OVERLAY by revision: written inside `enqueue`, the review's `v1`/`v2`
//     sequence, a remote set, out-of-order answers, a drag drop, two producers,
//     a disposal, and the light and animation keys;
//  5. the status LINES, exactly as the spec writes them.
//
// The events these tests emit are the shapes the REAL `AtriumClient` emits,
// character for character: `packages/client/tests/behavior-origin.test.js` pins
// all six `som:set` sites of the real client to exactly this shape (and
// `packages/client/tests/runner-overlay.test.js` drives the overlay through the
// real client and the real runner). `@atrium/behaviors` depends on neither the
// client nor `@gltf-transform/core`, so the client's own package is where its
// events are exercised — the same split 4c's `activate.test.js` uses. `canSend()`
// itself is the client's own step.
//
// Everything here runs on the REAL adapter and the REAL vendored engine: a fake
// world, a controllable clock, no DOM, no Three.js, no real timers.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createBehaviorRunner, THROTTLED_TEXT, PARTIAL_TEXT,
  FRAME_NODE_STARTS_MAX, THROTTLE_WINDOW_MS,
} from '../src/runner.js'
import { nodeValueProblem, lightValueProblem } from '../src/value-rules.js'
import { graph, lit, to, T, OWN, TGT } from './fake-world.mjs'
import { makeFakeClient, makeNode, nextId } from './fake-client.mjs'

const THIRD = '33333333-3333-4333-8333-333333333333'
const VECTORS = JSON.parse(readFileSync(new URL('../../../tests/fixtures/value-vectors.json', import.meta.url), 'utf8'))

/** A runner with the role granted and a world loaded. */
function setup({ nodes = [], options = {}, clock = { value: 0 } } = {}) {
  if (!nodes.some((n) => n.extras?.atrium?.objectId === TGT)) nodes = [...nodes, makeNode({ name: 'target', id: TGT })]
  const client = makeFakeClient({ nodes })
  const runner = createBehaviorRunner({
    client,
    now: () => clock.value,
    position: (node) => (node ? node.translation : undefined),
    localAvatar: () => ({ name: 'avatar', translation: [0, 0, 0] }),
    ...options,
  })
  client.scriptHost = { active: true, hostGen: 1 }
  client.canEdit = true
  client.emit('world:loaded', { name: 'w' })
  client.emit('script-host:changed', { active: true, hostGen: 1 })
  return { client, runner, clock }
}

/** A complete behaviour leaf from a graph, own-first `nodeMap`. */
const leafFor = (g, nodeMap, targets = []) => ({
  kind: 'graph', origin: 'local', enabled: true, nodeMap, targets, animations: [], graph: g,
})

const nodeKey = (objectId, kind, field) => `${objectId}|${kind}|${field}`
/**
 * The PRODUCTION enqueue path (the test seam's `{ enforce: true }`): the
 * producer check, the WRITE CHECK and the overlay write all run, exactly as a
 * graph's own setter reaches them.
 */
const write = (runner, objectId, kind, field, value, behaviourId, generation) =>
  behaviourId === undefined
    ? runner.enqueue(objectId, kind, field, value, undefined, undefined, { enforce: true })
    : runner.enqueue(objectId, kind, field, value, behaviourId, generation, { enforce: true })
/** A one-node leaf that writes `field`/`value` to the target on `onStart`. */
const writer = (ownId, targetId, field, value) => leafFor(graph([
  { op: 'event/onStart', flows: { out: to(1) } },
  { op: 'pointer/set', configuration: { pointer: { value: [`/nodes/1/${field}`] }, type: { value: [T.bool] } }, values: { value: lit(T.bool, value) } },
]), [ownId, targetId], [targetId])

// ===========================================================================
// 1. The write check (G4, M2/P23)
// ===========================================================================

describe('G4 — the write check, before the queue and the overlay', () => {
  const refusedTranslation = [
    ['[NaN, 0, 0]', [NaN, 0, 0]],
    ['[null, 0, 0]', [null, 0, 0]],
    ['a two-element translation', [1, 2]],
  ]

  for (const [label, value] of refusedTranslation) {
    test(`${label} is refused, and never queued or overlaid`, () => {
      const { runner } = setup()
      assert.equal(write(runner, TGT, 'node', 'translation', value), false)
      assert.equal(runner.queue.size, 0, 'nothing is queued')
      assert.equal(runner.overlay.size, 0, 'nothing is in the overlay')
    })
  }

  test('a graph\'s refused write is logged ONCE per (behaviour, index, field)', () => {
    const value = leafFor(graph([
      { op: 'event/onTick', flows: { out: to(1) } },
      {
        op: 'pointer/set',
        configuration: { pointer: { value: ['/nodes/1/translation'] }, type: { value: [T.float3] } },
        values: { value: lit(T.float3, [NaN, 0, 0]) },
      },
    ]), [OWN, TGT], [TGT])
    const { runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: value })] })
    assert.ok(runner.engines.get('crate')?.engine, 'the graph loaded')

    for (let frame = 0; frame < 5; frame++) runner.tick()
    const refused = runner.log.filter((l) => l.message.includes('refused write'))
    assert.equal(refused.length, 1, 'the adapter logs a refused write once, not once a frame')
    assert.equal(runner.queue.size, 0, 'and nothing was queued')
    assert.equal(runner.overlay.size, 0)
  })

  test('a non-boolean `visible` is refused', () => {
    const { runner } = setup()
    assert.equal(write(runner, TGT, 'node', 'visible', 1), false)
    assert.equal(runner.queue.size, 0)
    assert.equal(runner.overlay.size, 0)
  })

  test('rotation [0, 0, 0, 2] is refused (finite but not a unit quaternion)', () => {
    const { runner } = setup()
    assert.equal(write(runner, TGT, 'node', 'rotation', [0, 0, 0, 2]), false)
    assert.equal(runner.overlay.size, 0)
  })

  test('scale [0, 1, 1] and [1e-7, 1, 1] are refused; [-1, 1, 1] and rotation [0, 0, 0, 1] go', () => {
    const { runner } = setup()
    assert.equal(write(runner, TGT, 'node', 'scale', [0, 1, 1]), false)
    assert.equal(write(runner, TGT, 'node', 'scale', [1e-7, 1, 1]), false)
    assert.equal(write(runner, TGT, 'node', 'scale', [-1, 1, 1]), true)
    assert.equal(write(runner, TGT, 'node', 'rotation', [0, 0, 0, 1]), true)
    assert.equal(runner.queue.size, 2)
  })

  test('a light intensity or colour the server would refuse is refused here too', () => {
    const { runner } = setup()
    assert.equal(write(runner, TGT, 'light', 'intensity', '2'), false)
    assert.equal(write(runner, TGT, 'light', 'color', [null, 0, 0]), false)
    assert.equal(write(runner, TGT, 'light', 'intensity', 2), true)
    assert.equal(write(runner, TGT, 'light', 'color', [0, 1, 0]), true)
  })

  test('a field outside G-L4\'s families has no rule here and passes, as it always has', () => {
    const { runner } = setup()
    assert.equal(write(runner, TGT, 'node', 'some-other-field', 42), true)
  })

  test('the shared vectors give the same verdict here as on the server', () => {
    for (const vector of VECTORS.node) {
      assert.equal(nodeValueProblem(vector.field, vector.value), vector.ok ? null : vector.message, `${vector.label} (node)`)
    }
    for (const vector of VECTORS.light) {
      assert.equal(lightValueProblem(vector.field, vector.value), vector.ok ? null : vector.message, `${vector.label} (light)`)
    }
  })

  // R12 (d3) — the check's POSITION, not just its verdict. A refused write must
  // spend nothing: it is not queued, it does not enter the overlay, and it does
  // NOT take a revision. Proof (d3): move `writeValueProblem` to after
  // `queue.set` / `overlay.set` and this test fails — the queued and overlaid
  // counts are 1, the overlay reports the NaN, and the accepted write's revision
  // is 2, not 1.
  test('R12 (d3): a refused write spends no revision — the check is before the queue and the overlay', () => {
    const { runner } = setup()
    assert.equal(write(runner, TGT, 'node', 'translation', [NaN, 0, 0]), false, 'the NaN translation is refused')
    assert.equal(runner.queue.size, 0, 'nothing is queued')
    assert.equal(runner.overlay.size, 0, 'nothing is in the overlay')

    const key = nodeKey(TGT, 'node', 'visible')
    assert.equal(write(runner, TGT, 'node', 'visible', false), true, 'the next write is accepted')
    assert.equal(runner.queue.get(key).revision, 1, 'the refusal did not consume a revision')
    assert.equal(runner.overlay.get(key).revision, 1, 'and the overlay names that same revision')
    assert.equal(runner.overlay.get(key).value, false, 'the overlay holds the accepted value, not the NaN')
  })
})

// ===========================================================================
// 1b. R-L4 — a material read that feeds a translation writes nothing
// ===========================================================================

describe('G4/G6 — R-L4: a graph that reads /materials/… and writes a translation stores a NoOp write', () => {
  /**
   * R-L4 (a): the importer refuses a `/materials/…` get that a RUNNING node
   * consumes (G6's own consumer rule), so the run-time half has to be pinned
   * here, on a stored leaf the importer would never produce: the material family
   * is not registered, the engine's `PointerGet` returns `getDefaultValueForType`
   * — `[NaN, NaN, NaN]` for `float3` — and G4's write check refuses the
   * translation before the queue and the overlay. Nothing is written.
   */
  test('a stored leaf reading /materials/0/… into /nodes/1/translation queues nothing', () => {
    const leaf = leafFor(graph([
      { op: 'event/onStart', flows: { out: to(2) } },
      {
        op: 'pointer/get',
        configuration: {
          pointer: { value: ['/materials/0/pbrMetallicRoughness/baseColorFactor'] },
          type: { value: [T.float3] },
        },
      },
      {
        op: 'pointer/set',
        configuration: { pointer: { value: ['/nodes/1/translation'] }, type: { value: [T.float3] } },
        values: { value: { node: 1, socket: 'value' } },
      },
    ]), [OWN, TGT], [TGT])
    const { runner, client } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: leaf })] })
    assert.ok(runner.engines.get('crate')?.engine, 'the graph loaded (a supported pointer/set is executable)')

    runner.tick()
    assert.equal(runner.queue.size, 0, 'the material read queued nothing')
    assert.equal(runner.overlay.size, 0, 'and nothing entered the overlay')
    assert.deepEqual(client.som.getNodeByName('target').translation, [0, 0, 0], 'the SOM holds the untouched translation')
    const refused = runner.log.filter((l) => l.message.includes('refused write'))
    assert.equal(refused.length, 1, 'the refusal is logged once, as G4 says')
  })
})

// ===========================================================================
// 2. The total send opportunity (G4, M1/P22)
// ===========================================================================

describe('G4 — the send opportunity is total', () => {
  for (const [label, breakIt] of [
    ['canSend() is false', (client) => { client.canSend = () => false }],
    ['the send throws World not loaded', (client) => { client.sendField = () => { throw new Error('World not loaded') } }],
    ['the send returns a non-number', (client) => { client.sendField = () => undefined }],
  ]) {
    test(`${label}: the entry is dropped, the overlay falls back to the SOM, one line, no throw`, () => {
      const { client, runner } = setup()
      breakIt(client)
      runner.enqueue(TGT, 'node', 'visible', false)
      assert.equal(runner.overlay.size, 1, 'the write reached the overlay')

      assert.doesNotThrow(() => runner.tick(), 'nothing leaves tick()')
      assert.equal(runner.queue.size, 0, 'the entry left the queue')
      assert.equal(runner.overlay.size, 0, 'and its overlay revision went with it, in the same call')
      assert.equal(runner.log.filter((l) => l.message.includes('dropped')).length, 1, 'one line')
      assert.equal(runner.sendSeqCount, 0, 'no seq was recorded')
    })
  }

  test('a light key and an animation key behave the same way', () => {
    const { client, runner, clock } = setup()
    client.canSend = () => false
    runner.enqueue(TGT, 'light', 'intensity', 2)
    runner.enqueue(TGT, 'animation', 'play', { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 })
    assert.equal(runner.overlay.size, 2)

    // ONE opportunity a frame: two keys take two frames.
    runner.tick()
    clock.value += 50
    runner.tick()
    assert.equal(runner.queue.size, 0)
    assert.equal(runner.overlay.size, 0, 'every key\'s entry went')
    assert.equal(runner.sendSeqCount, 0)
  })

  test('the other engines still tick when one send fails', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: writer(OWN, TGT, 'extensions/KHR_node_visibility/visible', false) })
    const { client, runner } = setup({ nodes: [crate] })
    client.canSend = () => false
    assert.notEqual(runner.engines.get('crate')?.engine, null, 'the engine loaded')

    assert.doesNotThrow(() => runner.tick())
    assert.equal(runner.log.filter((l) => l.message.includes('dropped')).length, 1, 'the dropped send is logged')
    assert.equal(runner.queue.size, 0)
    assert.equal(runner.overlay.size, 0)
  })
})

// ===========================================================================
// 3. The frame limit, its rotation, and the throttle
// ===========================================================================

/** A leaf whose `onTick` runs a `flow/for` loop of `iterations`, with no body. */
const spinner = (ownId, iterations) => leafFor(graph([
  { op: 'event/onTick', flows: { out: to(1) } },
  {
    op: 'flow/for',
    configuration: { initialIndex: { value: [0] } },
    values: { startIndex: lit(T.int, 0), endIndex: lit(T.int, iterations) },
  },
]), [ownId])

describe('G4 — the per-frame world limit and its rotation', () => {
  test('three engines each doing ~6,000 node starts tick two per frame, in rotation', () => {
    const ids = ['a0000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000000']
    const nodes = ids.map((id, i) => makeNode({ name: `n${i}`, id, behavior: spinner(id, 6000) }))
    const { runner } = setup({ nodes })
    const starts = (i) => runner.engines.get(`n${i}`).engine?.steps ?? 0

    runner.tick()
    assert.ok(starts(0) > 0 && starts(1) > 0, 'the first two ticked')
    assert.equal(starts(2), 0, 'the third one STARVES')
    assert.deepEqual([...runner.skippedThisFrame], ['n2|1'], 'and it is recorded as skipped')

    runner.tick()
    assert.ok(starts(2) > 0, 'the rotation starts after the last one ticked, so the third runs')
    assert.deepEqual([...runner.skippedThisFrame], ['n1|1'], 'the middle one is skipped this frame')

    runner.tick()
    assert.ok(starts(1) > 0, 'and the first one is skipped next')
    assert.deepEqual([...runner.skippedThisFrame], ['n0|1'], 'all three have progressed over three frames')
  })

  test('a skip is NOT a disable: every engine keeps its reason null and its engine', () => {
    const ids = ['a0000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000000']
    const nodes = ids.map((id, i) => makeNode({ name: `x${i}`, id, behavior: spinner(id, 6000) }))
    const { runner } = setup({ nodes })
    runner.tick()
    assert.equal(runner.skippedThisFrame.size, 1, 'one engine skipped')
    for (const name of ['x0', 'x1', 'x2']) {
      assert.equal(runner.engines.get(name).reason, null, `${name} is still running`)
      assert.notEqual(runner.engines.get(name).engine, null)
    }
  })

  test('with a fake clock, an engine whose tick takes 9 ms stops the frame', () => {
    const ids = ['a0000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000000']
    const nodes = ids.map((id, i) => makeNode({ name: `y${i}`, id, behavior: spinner(id, 1) }))
    const { runner, clock } = setup({ nodes })
    // The first engine's tick costs 9 ms of the runner's clock (the adapter's
    // `tick` is a plain property of the object it returns).
    const first = runner.engines.get('y0').engine
    const inner = first.tick
    first.tick = () => { clock.value += 9; inner() }

    clock.value = 1000
    runner.tick()
    assert.deepEqual([...runner.skippedThisFrame], ['y1|1'], '9 ms have passed since the first tick began')
  })

  test('a behaviour skipped in more than half the frames of the last two seconds is "Throttled"', () => {
    // Five spinning engines, two tick per frame, so each is skipped in most
    // frames. A half-second clock step makes five frames two seconds.
    const ids = [0, 1, 2, 3, 4].map((i) => `${i}0000000-0000-4000-8000-000000000000`)
    const nodes = ids.map((id, i) => makeNode({ name: `t${i}`, id, behavior: spinner(id, 6000) }))
    const { runner, clock } = setup({ nodes })

    for (let frame = 0; frame < 5; frame++) {
      clock.value += 500
      runner.tick()
    }
    const throttled = [...runner.engines.keys()].filter((name) => runner.statusLines(name).includes(THROTTLED_TEXT))
    assert.ok(throttled.length > 0, 'at least one behaviour is throttled')
    assert.ok(runner.log.some((l) => l.message === THROTTLED_TEXT), 'and the log carries the line')

    const firstCount = runner.log.filter((l) => l.message === THROTTLED_TEXT).length
    clock.value += 1000
    runner.tick()
    assert.equal(runner.log.filter((l) => l.message === THROTTLED_TEXT).length, firstCount,
      'one line per behaviour per minute, not per frame')
  })

  test('one doing 10,001 in a tick is disposed over-budget, as before', () => {
    const id = 'a0000000-0000-4000-8000-000000000000'
    const { runner } = setup({ nodes: [makeNode({ name: 'runaway', id, behavior: spinner(id, 1e6) })] })
    runner.tick()
    assert.equal(runner.engines.get('runaway').reason, 'over-budget')
    assert.equal(runner.engines.get('runaway').engine, null)
  })

  test('the limits are the spec\'s numbers', () => {
    assert.equal(FRAME_NODE_STARTS_MAX, 10_000)
    assert.equal(THROTTLE_WINDOW_MS, 2_000)
  })
})

// ===========================================================================
// 4. The overlay (G-L6)
// ===========================================================================

describe('G4 — the overlay by revision', () => {
  const key = nodeKey(TGT, 'node', 'visible')

  test('the entry is written inside enqueue, and only a send\'s answer clears it', () => {
    const { runner } = setup()
    runner.enqueue(TGT, 'node', 'visible', false)
    const entry = runner.overlay.get(key)
    assert.equal(entry.value, false)
    assert.equal(entry.revision, 1)
    assert.equal(entry.sentSeq, null, 'nothing sent yet')
  })

  test('a later write to the same key shares the entry and takes the next revision', () => {
    const { runner } = setup()
    runner.enqueue(TGT, 'node', 'visible', false)
    runner.enqueue(TGT, 'node', 'visible', true)
    assert.equal(runner.overlay.size, 1, 'two behaviours writing one key share the entry')
    assert.equal(runner.overlay.get(key).value, true, 'the latest write wins')
    assert.equal(runner.overlay.get(key).revision, 2)
  })

  test('a throw on the send clears the entry in the same call', () => {
    const { runner, client } = setup()
    client.sendField = () => { throw new Error('World not loaded') }
    runner.enqueue(TGT, 'node', 'visible', false)
    runner.tick()
    assert.equal(runner.overlay.get(key), undefined)
  })

  test('the light and the animation keys have their own entries', () => {
    const { runner } = setup()
    runner.enqueue(TGT, 'light', 'intensity', 2)
    runner.enqueue(TGT, 'animation', 'play', { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 })
    assert.equal(runner.overlay.has(nodeKey(TGT, 'light', 'intensity')), true)
    assert.equal(runner.overlay.has(nodeKey(TGT, 'animation', 'play')), true)
  })

  test('a key two producers wrote is the SECOND one\'s entry, and the first\'s disposal leaves it', () => {
    const first = makeNode({ name: 'crate', id: OWN, behavior: writer(OWN, TGT, 'extensions/KHR_node_visibility/visible', false) })
    const second = makeNode({ name: 'other-one', id: THIRD, behavior: writer(THIRD, TGT, 'extensions/KHR_node_visibility/visible', true) })
    const { runner } = setup({ nodes: [first, second] })
    const a = runner.engines.get('crate')
    const b = runner.engines.get('other-one')
    assert.ok(a?.engine && b?.engine, 'both engines loaded')

    runner.enqueue(TGT, 'node', 'visible', false, a.behaviourId, a.generation)
    runner.enqueue(TGT, 'node', 'visible', true, b.behaviourId, b.generation)
    assert.equal(runner.overlay.size, 1, 'one key, one entry')
    assert.equal(runner.overlay.get(key).producer.behaviourId, b.behaviourId, 'the second producer owns it')

    runner.engines.get('crate').engine.dispose()
    runner.tick()
    assert.equal(runner.overlay.get(key)?.producer.behaviourId, b.behaviourId,
      'the first producer\'s disposal left the second producer\'s entry alone')
  })

  test('a drag drop queues nothing and overlays nothing; the next read is the SOM', () => {
    const { runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN })] })
    // The gesture is on the TARGET (or an ancestor): the drop rule covers the
    // node, its descendants and its ancestors.
    runner.setGesture('target')
    assert.equal(runner.enqueue(TGT, 'node', 'visible', false), false, 'the drop returns false')
    assert.equal(runner.queue.size, 0)
    assert.equal(runner.overlay.size, 0)
    assert.equal(runner.log.filter((l) => l.message.includes('edit in progress')).length, 1)
  })
})

// ===========================================================================
// 4b. The overlay through the client's OWN events (the review's sequence)
// ===========================================================================

describe('G4 — the review\'s sequence, through the client\'s events', () => {
  const key = nodeKey(TGT, 'node', 'visible')

  /** The client's own `som:set` shape, exactly as `AtriumClient` emits it. */
  const ownEcho = (client, seq, path, value) =>
    client.emit('som:set', { nodeName: 'target', path, value, origin: 'own', requestSeq: seq })

  test('send v1, queue v2, own echo and edit:accepted for v1, then read v2', () => {
    const { client, runner } = setup()
    runner.enqueue(TGT, 'node', 'visible', false)
    runner.tick()
    const seq1 = runner.overlay.get(key)?.sentSeq
    assert.equal(typeof seq1, 'number', 'v1 went out and its seq was recorded')
    assert.equal(runner.overlay.get(key).revision, 1)

    runner.enqueue(TGT, 'node', 'visible', true)
    assert.equal(runner.overlay.get(key).revision, 2, 'v2 is the latest write')

    // The client's own echo for v1 (origin 'own' + requestSeq) and then the
    // accepted answer. Both must leave v2 alone.
    ownEcho(client, seq1, 'visible', false)
    client.emit('edit:accepted', { seq: seq1, requestSeq: seq1 })
    assert.equal(runner.overlay.get(key)?.value, true, 'v2 survived the older seq\'s answers')
  })

  test('the own echo for the key\'s LATEST revision clears it', () => {
    const { client, runner } = setup()
    runner.enqueue(TGT, 'node', 'visible', false)
    runner.tick()
    const seq = runner.overlay.get(key).sentSeq
    ownEcho(client, seq, 'visible', false)
    assert.equal(runner.overlay.has(key), false, 'the read falls back to the SOM')
  })

  test('a rejection or an unknown for the older seq keeps v2', () => {
    for (const answer of ['edit:rejected', 'edit:unknown']) {
      const { client, runner } = setup()
      runner.enqueue(TGT, 'node', 'visible', false)
      runner.tick()
      const seq1 = runner.overlay.get(key).sentSeq
      runner.enqueue(TGT, 'node', 'visible', true)

      client.emit(answer, { seq: seq1, requestSeq: seq1, code: 'INVALID_VALUE', message: 'nope' })
      assert.equal(runner.overlay.get(key)?.value, true, `${answer} keeps the newer write`)
      assert.equal(runner.overlay.get(key)?.revision, 2)
    }
  })

  test('a remote som:set wins and drops the queued write; an equal value counts as remote', () => {
    const { client, runner } = setup()
    runner.enqueue(TGT, 'node', 'visible', false)
    assert.equal(runner.queue.size, 1)
    // An EQUAL-valued remote write still clears: the overlay is by key, not by value.
    client.emit('som:set', { nodeName: 'target', path: 'visible', value: false, origin: 'remote' })
    assert.equal(runner.overlay.has(key), false)
    assert.equal(runner.queue.size, 0, 'the not-yet-sent write went with it')
  })

  test('a remote rename touches no overlay key', () => {
    const { client, runner } = setup({ nodes: [makeNode({ name: 'plain', id: THIRD })] })
    runner.enqueue(THIRD, 'node', 'visible', false)
    client.emit('som:set', { nodeName: 'plain', path: 'name', value: 'plain-2', origin: 'remote' })
    assert.equal(runner.overlay.has(nodeKey(THIRD, 'node', 'visible')), true, 'a rename is not a value write')
    assert.equal(runner.queue.size, 1)
  })

  test('a remote som:set for X.light and for extras.atrium.animation clears the matching entry', () => {
    const { client, runner } = setup()
    runner.enqueue(TGT, 'light', 'intensity', 2)
    runner.enqueue(TGT, 'animation', 'play', { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 0 })
    client.emit('som:set', { nodeName: 'target.light', path: 'intensity', value: 5, origin: 'remote' })
    assert.equal(runner.overlay.has(nodeKey(TGT, 'light', 'intensity')), false)
    assert.equal(runner.overlay.has(nodeKey(TGT, 'animation', 'play')), true, 'the other key is untouched')

    client.emit('som:set', { nodeName: 'target', path: 'extras.atrium.animation', value: null, origin: 'remote' })
    assert.equal(runner.overlay.has(nodeKey(TGT, 'animation', 'play')), false)
  })
})

// ===========================================================================
// 4c. A graph reads its own writes (G-L6): get → add → set on onTick
// ===========================================================================

describe('G4 — a graph reads its own writes, with no echo', () => {
  test('`get → add → set` on onTick for 30 frames advances every frame', () => {
    const ownId = OWN
    const value = leafFor(graph([
      { op: 'event/onTick', flows: { out: to(3) } },
      { op: 'pointer/get', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } } },
      { op: 'math/add', values: { a: { node: 1, socket: 'value' }, b: lit(T.float3, [1, 0, 0]) } },
      { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: { node: 2, socket: 'value' } } },
    ]), [ownId])
    const { client, runner, clock } = setup({ nodes: [makeNode({ name: 'crate', id: ownId, behavior: value })] })
    assert.ok(runner.engines.get('crate')?.engine, 'the graph loaded')

    for (let frame = 0; frame < 30; frame++) {
      clock.value += 50
      runner.tick()
    }
    const sent = client.sent.filter((s) => s.call === 'sendField' && s.field === 'translation').map((s) => s.value[0])
    assert.equal(sent.length, 30, 'one opportunity a frame, no echo needed')
    assert.equal(sent[0], 1)
    assert.equal(sent[29], 30, 'the overlay fed every read')
  })
})

// ===========================================================================
// 5. The status lines (G4)
// ===========================================================================

describe('G4 — the status lines', () => {
  test('"Partially supported" carries graphReport\'s list', () => {
    const ownId = OWN
    const value = leafFor(graph([
      { op: 'event/onStart', flows: { out: to(2) } },
      { op: 'event/onHoverIn' },
      { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/translation'] }, type: { value: [T.float3] } }, values: { value: lit(T.float3, [1, 0, 0]) } },
    ]), [ownId])
    value.graph.declarations[1] = { op: 'event/onHoverIn', extension: 'KHR_node_hoverability' }
    const { runner } = setup({ nodes: [makeNode({ name: 'crate', id: ownId, behavior: value })] })
    assert.equal(runner.engines.get('crate').reason, null, 'the graph loaded (G-L3: stored and inert)')
    const lines = runner.statusLines('crate')
    assert.equal(lines.length, 1)
    assert.match(lines[0], new RegExp(`^${PARTIAL_TEXT}: `))
    assert.match(lines[0], /event\/onHoverIn/)
  })

  test('a supported graph says nothing, and an unknown node has no lines', () => {
    const value = leafFor(graph([
      { op: 'event/onStart', flows: { out: to(1) } },
      { op: 'pointer/set', configuration: { pointer: { value: ['/nodes/0/extensions/KHR_node_visibility/visible'] }, type: { value: [T.bool] } }, values: { value: lit(T.bool, true) } },
    ]), [OWN])
    const { runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: value })] })
    assert.deepEqual(runner.statusLines('crate'), [])
    assert.deepEqual(runner.statusLines('not-loaded'), [])
  })
})
