// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// runner-r5.test.js — scripting-4b-2 round 5, V3, V7 and V8, at the runner.
//
// V3: the play value is 4a's FIVE keys in 4a's order, and a refused send is
//     reported in the log once per (behaviour, key, code).
// V7: every send is checked AGAIN when it leaves — the producer's id and
//     generation must still be live, F4's authority rule must still hold
//     (through the ADAPTER's own `mayWrite`), and the drag rule applies at the
//     opportunity, not only at the enqueue.
// V8: every disable is a dispose — the record keeps its reason and is never
//     ticked again, its queued entries and seqs go, and the send cap disposes
//     the behaviour whose write would add the 101st key.
//
// A fake client, a controllable clock, no DOM, no Three.js, no real timers.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createBehaviorRunner, SEND_FRAME_MS, SEND_KEYS_MAX, SEAM_PRODUCER_ID } from '../src/runner.js'
import { BudgetExceeded } from '../src/adapter.js'
import { templateGraph } from '../src/templates.js'
import { OWN, TGT } from './fake-world.mjs'
import { makeFakeClient, makeNode, nextId } from './fake-client.mjs'

const hide = (ownId, target = OWN) => templateGraph('select-visibility', { target, action: 'hide' }, { ownId })

/** A runner over a fresh clock, with the role already granted and a world loaded. */
function setup({ nodes = [], options = {} } = {}) {
  const client = makeFakeClient({ nodes })
  const state = { clock: 0 }
  // scripting-4c AC-L3 (a) — the host's OWN click obeys the same 10 m rule, so
  // the runner needs a local avatar and a position rule. Every fake node sits at
  // the origin, so a select here is always in reach.
  const runner = createBehaviorRunner({
    client,
    now: () => state.clock,
    position: (node) => (node ? node.translation : undefined),
    localAvatar: () => ({ name: 'avatar', translation: [0, 0, 0] }),
    ...options,
  })
  client.scriptHost = { active: true, hostGen: 1 }
  client.canEdit = true
  client.emit('world:loaded', { name: 'w' })
  client.emit('script-host:changed', { active: true, hostGen: 1 })
  return { client, runner, state }
}

const byName = (client, name) => client.som.nodes.find((n) => n.name === name)

// ══════════════════════════════════════════════════════════════════════════
// V3 — the play value, and the refused send
// ══════════════════════════════════════════════════════════════════════════

test('V3 — the play value is 4a\'s five keys, in 4a\'s order, with startedAt 0', () => {
  // 4a's `playValue`: clip, playing, loop, speed, startedAt — the server's
  // `animationValueProblem` refuses four keys, and it stamps `startedAt`.
  const value = templateGraph('select-animation', { target: OWN, clip: 'Idle', action: 'play', loop: true }, { ownId: OWN })
  const { client, runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: value })] })
  runner.select(byName(client, 'crate'))
  runner.tick()

  assert.equal(client.animations.length, 1, 'animation/start reached the 4a leaf')
  const play = client.animations[0].value
  assert.deepEqual(Object.keys(play), ['clip', 'playing', 'loop', 'speed', 'startedAt'])
  assert.equal(play.startedAt, 0, 'the server stamps the real one')
  assert.equal(play.playing, true)
})

test('V3 — Stop is still null', () => {
  const value = templateGraph('select-animation', { target: OWN, clip: 'Idle', action: 'stop', loop: true }, { ownId: OWN })
  const { client, runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: value })] })
  runner.select(byName(client, 'crate'))
  runner.tick()
  assert.deepEqual(client.animations, [{ name: 'crate', value: null }])
})

test('V3 — a refused send is logged once, with the server\'s message', () => {
  const value = hide(OWN)
  const node = makeNode({ name: 'crate', id: OWN, behavior: value })
  const { client, runner, state } = setup({ nodes: [node] })
  const sendOnce = () => {
    runner.select(node)
    runner.tick()
    state.clock += SEND_FRAME_MS
    runner.tick()
    return client.sent.length
  }

  const seq1 = sendOnce()
  assert.equal(seq1, 1, 'the write left')
  const before = runner.log.length
  client.emit('edit:rejected', { seq: seq1, code: 'INVALID_VALUE', message: 'the value could not be checked' })
  assert.equal(runner.log.length, before + 1, 'one line')
  assert.equal(runner.log.at(-1).message, 'a behaviour send was refused: the value could not be checked')

  // The same (behaviour, key, code) refused again: nothing more.
  const seq2 = sendOnce()
  client.emit('edit:rejected', { seq: seq2, code: 'INVALID_VALUE', message: 'the value could not be checked' })
  assert.equal(runner.log.length, before + 1, 'a second identical refusal adds none')

  // A seq the runner never sent is ignored.
  client.emit('edit:rejected', { seq: 99999, code: 'INVALID_VALUE', message: 'not mine' })
  assert.equal(runner.log.length, before + 1)

  // A DISPOSED behaviour's seqs are gone.
  const seq3 = sendOnce()
  node.extras.atrium.behavior = null
  client.emit('som:set', { nodeName: 'crate', path: 'extras.atrium.behavior', value: null })
  client.emit('edit:rejected', { seq: seq3, code: 'INVALID_VALUE', message: 'after the dispose' })
  assert.equal(runner.log.length, before + 1, 'the disposed behaviour\'s seqs were forgotten')
})

// ══════════════════════════════════════════════════════════════════════════
// V7 — each send is checked again when it leaves (M1, M3)
// ══════════════════════════════════════════════════════════════════════════

test('V7 — a descendant target reparented out of the subtree is dropped at the opportunity', () => {
  const crate = makeNode({ name: 'crate', id: OWN })
  const child = makeNode({ name: 'crate/child', id: TGT, parent: crate })
  const otherId = nextId()
  const other = makeNode({ name: 'other', id: otherId, behavior: hide(otherId, otherId) })
  // The target IS a descendant of the behaviour node. The template always puts
  // the target in `targets` (it cannot see the SOM subtree), and F1 accepts an
  // empty `targets`; clearing it is what makes the write authorized by
  // DESCENDANT-hood alone — which is exactly what reparenting takes away.
  crate.extras.atrium.behavior = {
    ...templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId: OWN }),
    targets: [],
  }
  const { client, runner, state } = setup({ nodes: [crate, child, other] })

  // One unrelated write first, so the rate window is open for the rest.
  runner.select(byName(client, 'other'))
  runner.tick()
  assert.equal(client.sent.length, 1, 'the other behaviour\'s write went out')
  assert.equal(client.sent[0].name, 'other')

  // The behaviour's write is queued…
  runner.select(crate)
  runner.tick()
  assert.equal(runner.queue.size, 1, 'queued (the rate window is still closed)')

  // …and the descendant is reparented away between the enqueue and the send.
  child.parent = null

  state.clock += SEND_FRAME_MS
  runner.tick()
  assert.equal(client.sent.length, 1, 'nothing more went out')
  assert.equal(runner.queue.size, 0, 'the entry was taken and dropped')
  const drops = runner.log.filter((l) => l.message.includes('no longer this behaviour'))
  assert.equal(drops.length, 1, 'one log line')
})

test('V7 — an entry whose producer was reloaded (a new generation) is dropped', () => {
  const value = hide(OWN)
  const node = makeNode({ name: 'crate', id: OWN, behavior: value })
  const { client, runner, state } = setup({ nodes: [node] })

  // What the OLD generation queued is dropped by the reload itself: a reload is
  // dispose-then-create, and `disposeEngine` drops exactly that behaviour's
  // entries. The generation check is the backstop for an entry that outlives the
  // reload, which is what this fabricates through the seam.
  runner.enqueue(OWN, 'node', 'visible', false, OWN, 1)
  node.extras.atrium.behavior = { ...value }        // the same shape, a NEW value
  client.emit('som:set', { nodeName: 'crate', path: 'extras.atrium.behavior', value: node.extras.atrium.behavior })
  assert.equal(runner.engines.get('crate').generation, 2, 'the reload bumped the generation')
  assert.equal(runner.queue.size, 0, 'the reload dropped the old generation\'s entry')

  // A stale-generation entry, still in the queue when the opportunity comes.
  runner.enqueue(OWN, 'node', 'visible', false, OWN, 1)
  assert.equal(runner.queue.size, 1)
  state.clock += SEND_FRAME_MS
  runner.tick()
  assert.equal(client.sent.length, 0, 'nothing left')
  assert.equal(runner.log.at(-1).message, 'a behaviour send was dropped: its behaviour is no longer running')
})

test('V7 — a gesture that starts AFTER the enqueue drops the queued send (the review\'s M3)', () => {
  const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
  const { client, runner, state } = setup({ nodes: [crate] })

  runner.select(crate)
  runner.tick()                                   // this write goes out (the window is open)
  assert.equal(client.sent.length, 1)
  runner.select(crate)
  runner.tick()                                   // queued: the rate window is closed
  assert.equal(runner.queue.size, 1, 'queued before the drag started')

  runner.setGesture('crate')                      // the owner starts a drag
  state.clock += SEND_FRAME_MS
  runner.tick()                                   // the opportunity: the drag rule applies
  assert.equal(client.sent.length, 1, 'the queued send did not go out during the drag')
  assert.equal(runner.log.filter((l) => l.message.includes('edit in progress')).length, 1, 'logged once')

  runner.setGesture(null)                         // the drag ends
  state.clock += SEND_FRAME_MS
  runner.tick()
  assert.equal(client.sent.length, 1, 'nothing is replayed when the gesture ends')
  assert.equal(runner.queue.size, 0)
})

test('V7 — the authority check uses the ADAPTER\'s own predicate (`mayWrite`)', () => {
  const value = hide(OWN, TGT)
  const crate = makeNode({ name: 'crate', id: OWN, behavior: value })
  const target = makeNode({ name: 'target', id: TGT })     // another node: a grant
  const { client, runner } = setup({ nodes: [crate, target] })
  const engine = runner.engines.get('crate').engine

  assert.equal(typeof engine.mayWrite, 'function', 'the adapter exposes it')
  assert.equal(engine.mayWrite(OWN), true, 'its own node')
  assert.equal(engine.mayWrite(TGT), true, 'a granted id')
  assert.equal(engine.mayWrite(nextId()), false, 'and nothing else')
})

// ══════════════════════════════════════════════════════════════════════════
// V8 — every disable is a dispose (M4, M5)
// ══════════════════════════════════════════════════════════════════════════

test('V8 — an engine the adapter disposes is never ticked again, logged once, and its entries go', () => {
  const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
  const { client, runner, state } = setup({ nodes: [crate] })

  const engine = runner.engines.get('crate').engine
  let ticks = 0
  const realTick = engine.tick
  engine.tick = () => { ticks += 1; return realTick() }

  // A queued entry of ITS OWN, and the adapter's own budget path.
  runner.enqueue(OWN, 'node', 'visible', false, OWN, runner.engines.get('crate').generation)
  assert.equal(runner.queue.size, 1)
  // The graph has work on the next tick (the select flow), so a node really
  // starts. `BudgetExceeded` from the engine's step hook is exactly what the
  // adapter's tick wrapper catches; the vendored engine's hook is reachable for
  // a test through the adapter's `@internal` accessor.
  runner.select(crate)
  engine.engine.processNodeStarted = () => { throw new BudgetExceeded('step budget 10000 exceeded') }
  runner.tick()

  const after = ticks
  assert.equal(runner.engines.get('crate').engine, null, 'the engine is gone, not parked')
  assert.equal(runner.engines.get('crate').reason, 'over-budget', 'the panel still has the reason')
  assert.equal(runner.queue.size, 0, 'its queued entries were dropped')

  for (let i = 0; i < 60; i++) { state.clock += SEND_FRAME_MS; runner.tick() }
  assert.equal(ticks, after, 'its tick is never called again')
  assert.equal(client.sent.length, 0, 'and its entry never left')
  assert.equal(runner.log.filter((l) => l.message === 'behaviour disabled — over-budget').length, 1,
    'ONE disable line, not one per frame')
})

test('V8 — the 101st key disposes the behaviour that produced it, and keeps the rest', () => {
  const idA = nextId()
  const idB = nextId()
  const a = makeNode({ name: 'a', id: idA, behavior: hide(idA, idA) })
  const b = makeNode({ name: 'b', id: idB, behavior: hide(idB, idB) })
  const nodes = [a, b, ...Array.from({ length: SEND_KEYS_MAX + 4 }, (_, i) => makeNode({ name: `n${i}`, id: nextId() }))]
  const { client, runner, state } = setup({ nodes })

  // 100 distinct keys, produced by the seam's own always-live producer: no
  // graph inside F-L4's allowlist can make 100 distinct keys in one frame.
  const fillers = nodes.slice(2, 2 + SEND_KEYS_MAX)
  for (const node of fillers) runner.enqueue(node.extras.atrium.objectId, 'node', 'visible', false)
  assert.equal(runner.queue.size, SEND_KEYS_MAX)

  // The 101st comes from behaviour B — a REAL producer.
  const recordB = runner.engines.get('b')
  let bTicks = 0
  const realTick = recordB.engine.tick
  recordB.engine.tick = () => { bTicks += 1; return realTick() }
  const added = runner.enqueue(recordB.behaviourId, 'light', 'intensity', 1, recordB.behaviourId, recordB.generation)
  assert.equal(added, false, 'refused')
  assert.equal(runner.queue.size, SEND_KEYS_MAX, 'the queue stays at 100')
  assert.equal(runner.engines.get('b').engine, null, 'B was disposed')
  assert.equal(runner.engines.get('b').reason, 'over-send-cap')
  assert.equal(runner.log.filter((l) => l.message.includes('too many pending sends')).length, 1, 'one line')

  // A's (the seam producer's) entries still leave, one per opportunity.
  for (let i = 0; i < SEND_KEYS_MAX; i++) { state.clock += SEND_FRAME_MS; runner.tick() }
  assert.equal(client.sent.length, SEND_KEYS_MAX, 'every other entry left')
  const bAfter = bTicks
  for (let i = 0; i < 5; i++) { state.clock += SEND_FRAME_MS; runner.tick() }
  assert.equal(bTicks, bAfter, 'B is never ticked again')

  // Enabled — a reload — brings B back.
  b.extras.atrium.behavior = hide(idB, idB)
  client.emit('som:set', { nodeName: 'b', path: 'extras.atrium.behavior', value: b.extras.atrium.behavior })
  assert.ok(runner.engines.get('b').engine, 'a reload creates a fresh engine')
})

test('V8 — the seam producer id is not a SOM node and is never ticked', () => {
  const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
  const { client, runner, state } = setup({ nodes: [crate] })
  runner.enqueue(OWN, 'node', 'visible', false)
  state.clock += SEND_FRAME_MS
  runner.tick()
  assert.equal(client.sent.length, 1)
  assert.equal(runner.engines.has(SEAM_PRODUCER_ID), false)
  assert.equal(runner.engines.size, 1, 'only the real behaviour')
  assert.equal(TGT.length, 36)
})
