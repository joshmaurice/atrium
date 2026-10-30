// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// runner-r6.test.js — scripting-4b-2 round 6: W5, W7 and W8's runner and
// adapter items.
//
// The round-5 findings these pin (§1.2 item 5 and §1.4's N1 and N2):
//   - a dispose during a tick threw `TypeError` out of `tick()` (W5);
//   - a behaviour the send cap disposed kept queueing for the rest of its flow
//     (N1, W5's `enqueue` guard);
//   - the seq record only shrank on a rejection or a dispose (N2, W7);
//   - `refusedOnce` was keyed without the reason, so a key dropped once for a
//     drag was never logged again when it was later dropped for authority
//     (W8);
//   - the adapter logged "refused refused write to …" (W8).
//
// A fake client, a controllable clock, no DOM, no Three.js, no real timers.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { createBehaviorRunner, SEND_FRAME_MS, SEND_KEYS_MAX } from '../src/runner.js'
import { templateGraph } from '../src/templates.js'
import { OWN, TGT } from './fake-world.mjs'
import { makeFakeClient, makeNode, nextId } from './fake-client.mjs'

const hide = (ownId, target = TGT) => templateGraph('select-visibility', { target, action: 'hide' }, { ownId })

/** A runner over a fresh clock, with the role already granted and a world loaded. */
function setup({ nodes = [], grant = true, loadWorld = true } = {}) {
  if (!nodes.some((n) => n.extras?.atrium?.objectId === TGT)) nodes = [...nodes, makeNode({ name: 'target', id: TGT })]
  const client = makeFakeClient({ nodes })
  const state = { clock: 0 }
  // scripting-4c AC-L3 (a) — see runner-r5.test.js: the host's own click obeys
  // the same 10 m rule, and every fake node sits at the origin.
  const runner = createBehaviorRunner({
    client,
    now: () => state.clock,
    position: (node) => (node ? node.translation : undefined),
    localAvatar: () => ({ name: 'avatar', translation: [0, 0, 0] }),
  })
  if (grant) client.scriptHost = { active: true, hostGen: 1 }
  client.canEdit = true
  if (loadWorld) client.emit('world:loaded', { name: 'w' })
  client.emit('script-host:changed', { active: grant, hostGen: 1 })
  return { client, runner, state }
}

// ── W5 — a dispose during a tick ───────────────────────────────────────────

describe('W5 (round 6) — a dispose during a tick does not throw', () => {
  test('the record disposed in its own tick is skipped; the next engine still ticks, and the frame sends', () => {
    const a = makeNode({ name: 'a', id: OWN, behavior: hide(OWN) })
    const b = makeNode({ name: 'b', id: nextId(), behavior: hide(nextId()) })
    b.extras.atrium.behavior = hide(b.extras.atrium.objectId)
    const { client, runner, state } = setup({ nodes: [a, b] })

    const recA = runner.engines.get('a')
    const recB = runner.engines.get('b')
    assert.ok(recA?.engine && recB?.engine, 'both behaviours are live')

    const ticked = []
    // A fake engine whose OWN tick makes the 101st enqueue: the send cap
    // disposes its producer from inside the tick, which is the frame §1.2
    // item 5 threw out of.
    const makeFake = (name, record, writes) => ({
      disposed: false, reason: null,
      mayWrite: () => true,
      proximity() {}, select() {}, dispose() {},
      tick() {
        ticked.push(name)
        for (let i = 0; i < writes; i++) {
          runner.enqueue(TGT, 'node', `field-${name}-${i}`, i, record.behaviourId, record.generation)
        }
      },
    })
    recA.engine = makeFake('a', recA, SEND_KEYS_MAX + 1)
    recB.engine = makeFake('b', recB, 1)

    assert.doesNotThrow(() => runner.tick(), 'the dispose inside the tick does not throw')
    assert.deepEqual(ticked, ['a', 'b'], 'the engine registered after the disposed one still ticked that frame')
    assert.equal(recA.engine, null, 'and a is disposed')
    assert.equal(client.sent.length, 1, 'the frame\'s opportunity still ran, with b\'s one write')
    assert.equal(runner.log.filter((l) => l.message.includes('too many pending sends')).length, 1, 'one disable line')
    assert.equal(runner.log.filter((l) => l.message.includes('no longer running')).length, 0, 'and nothing dropped')
  })
})

// ── N1 — a disposed producer queues nothing ────────────────────────────────
//
// DEVIATION (reported in the handoff): the revision asks for N1's case "from
// inside a real engine's tick ... a Custom graph in F-L4's allowlist that
// writes three fields on one select". That graph cannot be built against the
// vendored engine: a `pointer/set` node's output flow is NOT followed (a
// chained second write never runs), and two outputs from one node are
// schema-invalid — an array gives "graph does not match the Khronos JSON
// schema", and an explicit inbound flow gives "output flow must point to a
// later node". So no graph inside F-L4's allowlist produces more than one
// enqueue per flow, and "the second write is the 101st and the third queues
// nothing" is unreachable. The guard is pinned DIRECTLY below, through the
// seam's `enforce` option (which runs the real producer check rather than the
// seam's fabricating exemption), and W5's fake-engine test above pins the
// disposal-inside-a-tick path.

describe('W5 (round 6, N1) — a disposed producer queues nothing', () => {
  test('the producer check comes first: a behaviour the cap disposed queues nothing', () => {
    const node = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner, state } = setup({ nodes: [node] })
    const rec = runner.engines.get('crate')
    assert.ok(rec?.engine, 'the behaviour is live')

    // Fill the queue to the cap, so the next write from `crate` is the 101st.
    for (let i = 0; i < SEND_KEYS_MAX; i++) runner.enqueue(TGT, 'node', `other-${i}`, i)
    assert.equal(runner.enqueue(TGT, 'node', 'visible', false, rec.behaviourId, rec.generation, { enforce: true }), false,
      'the 101st key is refused')
    assert.equal(rec.engine, null, 'and the cap disposed its producer')
    assert.equal(runner.log.filter((l) => l.message.includes('too many pending sends')).length, 1, 'one disable line')

    // W5's guard, first — before the gesture check and the 100-key check: the
    // disposed producer queues NOTHING and logs nothing more. Drain the queue
    // first, so the guard — not the cap — is what refuses.
    for (let i = 0; i < SEND_KEYS_MAX + 1; i++) {
      state.clock += SEND_FRAME_MS
      runner.tick()
    }
    assert.equal(runner.queue.size, 0, 'the queue drained')
    const sent = client.sent.length
    for (let i = 0; i < 5; i++) {
      assert.equal(runner.enqueue(TGT, 'node', `later-${i}`, i, rec.behaviourId, rec.generation, { enforce: true }), false,
        'a later write from the disposed behaviour is refused')
    }
    assert.equal(runner.queue.size, 0, 'the queue did not grow')
    assert.equal(runner.log.filter((l) => l.message.includes('too many pending sends')).length, 1, 'no second disable line')
    assert.equal(runner.log.filter((l) => l.message.includes('no longer running')).length, 0, 'and no drop lines')

    // A stale generation is refused the same way.
    assert.equal(runner.enqueue(TGT, 'node', 'stale', false, rec.behaviourId, rec.generation + 1, { enforce: true }), false)

    // Nothing threw, and the frame still runs after it.
    state.clock += SEND_FRAME_MS
    assert.doesNotThrow(() => runner.tick())
    assert.equal(client.sent.length, sent, 'and the disposed behaviour sent nothing more')
  })
})

// ── W7 — the seq record is bounded ─────────────────────────────────────────

describe('W7 (round 6, N2) — the seq record is bounded', () => {
  test('1,000 accepted runner sends leave no seq behind', () => {
    const node = makeNode({ name: 'crate', id: OWN })
    const { client, runner, state } = setup({ nodes: [node] })
    for (let i = 0; i < 1000; i++) {
      runner.enqueue(TGT, 'node', `field-${i}`, i)
      state.clock += SEND_FRAME_MS
      runner.tick()
      client.emit('edit:accepted', { seq: client.sent.length })
    }
    assert.equal(client.sent.length, 1000, 'every send went out')
    assert.equal(runner.sendSeqCount, 0, 'and no seq stayed in the record')
  })

  test('an edit:unknown removes its seq too', () => {
    const node = makeNode({ name: 'crate', id: OWN })
    const { client, runner, state } = setup({ nodes: [node] })
    runner.enqueue(TGT, 'node', 'translation', [1, 0, 0])
    state.clock += SEND_FRAME_MS
    runner.tick()
    assert.equal(runner.sendSeqCount, 1, 'the server owes an answer')
    client.emit('edit:unknown', { seq: client.sent.length })
    assert.equal(runner.sendSeqCount, 0, 'and the unknown forgot it')
  })

  test('after a reconnect, a refusal that was logged before is logged again', () => {
    const node = makeNode({ name: 'crate', id: OWN })
    const { client, runner, state } = setup({ nodes: [node] })

    const refuseOnce = () => {
      runner.enqueue(TGT, 'node', 'translation', [1, 0, 0])
      state.clock += SEND_FRAME_MS
      runner.tick()
      client.emit('edit:rejected', { seq: client.sent.length, code: 'INVALID_VALUE', message: 'nope' })
    }
    const lines = () => runner.log.filter((l) => l.message.includes('was refused')).length

    refuseOnce()
    assert.equal(lines(), 1, 'the first refusal is reported')
    refuseOnce()
    assert.equal(lines(), 1, 'the same (behaviour, key, code) is not reported twice')

    // `connecting` → `world:loaded`: disposeAll clears the seqs and the
    // once-sets, exactly as a reload does (V3's "until that behaviour is
    // reloaded").
    client.emit('connecting', {})
    client.emit('world:loaded', { name: 'w' })
    assert.equal(runner.sendSeqCount, 0, 'the seq record went with the connection')
    refuseOnce()
    assert.equal(lines(), 2, 'and the refusal is reported again')
  })
})

// ── W8 — a key dropped for two different reasons ───────────────────────────

describe('W8 (round 6) — refusedOnce is keyed by the reason too', () => {
  test('one key dropped for a drag and then for authority logs two lines', () => {
    const node = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner, state } = setup({ nodes: [node] })
    const rec = runner.engines.get('crate')
    const fake = { disposed: false, reason: null, mayWrite: () => true, dispose() {}, tick() {}, select() {}, proximity() {} }
    rec.engine = fake

    // 1. queued, then the owner starts an edit: the opportunity drops it.
    runner.enqueue(OWN, 'node', 'translation', [1, 0, 0], rec.behaviourId, rec.generation)
    runner.setGesture('crate')
    state.clock += SEND_FRAME_MS
    runner.tick()
    assert.equal(client.sent.length, 0, 'nothing left')
    assert.equal(runner.log.filter((l) => l.message.includes('edit in progress')).length, 1)

    // 2. the drag ends, but the target is no longer authorized: the SAME key is
    // dropped for a different reason, and that is logged too.
    runner.setGesture(null)
    fake.mayWrite = () => false
    runner.enqueue(OWN, 'node', 'translation', [2, 0, 0], rec.behaviourId, rec.generation)
    state.clock += SEND_FRAME_MS
    runner.tick()
    assert.equal(client.sent.length, 0)
    assert.equal(runner.log.filter((l) => l.message.includes('granted target')).length, 1,
      'the second reason has its own line')
  })
})
