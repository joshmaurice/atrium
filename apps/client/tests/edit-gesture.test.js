// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-gesture.test.js — Edit-mode transform gestures (Phase 3 step 1b-1, B4):
// throttled sends, confirmation, and revert to the server's value.
//
// The tracker is driven against a stand-in "world": plain node objects, a
// fake clock, a local-write log and a send log that hands out seqs the way
// AtriumClient does (one counter). Accepted/rejected answers are fed in by the
// test, in whatever order the case needs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  createEditTracker, sanitizeTransform, MIN_SCALE, REMOVED_MESSAGE,
} from '../src/edit-gesture.js'

function makeWorld() {
  let t = 0
  let seq = 0
  const locals = []
  const sent = []
  const messages = []
  const reverts = []
  const settled = []
  const tracker = createEditTracker({
    read: (node, field) => node[field],
    writeLocal: (node, field, value) => { node[field] = value; locals.push({ node, field, value }) },
    writeSend: (node, field, value) => {
      node[field] = value
      const s = ++seq
      sent.push({ seq: s, node, field, value })
      return s
    },
    onMessage: (text, info) => messages.push({ text, ...info }),
    onReverted: (node, field, value) => reverts.push({ node, field, value }),
    onTransformsSettled: (results, info) => settled.push({ results, info }),
    now: () => t,
  })
  return {
    tracker, locals, sent, messages, reverts, settled,
    /** The batches reported since the last call, and forget them. */
    takeSettled() { const out = settled.slice(); settled.length = 0; return out },
    advance(ms) { t += ms },
  }
}

function node(name = 'crate') {
  return { name, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
}

describe('edit-gesture: throttle', () => {
  test('a 1 s drag at 60 changes/s writes locally every change and sends ~10 times plus a final send', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    for (let i = 1; i <= 60; i++) {
      w.advance(1000 / 60)
      g.update({ translation: [i * 0.1, 0, 0] })
    }
    assert.equal(w.locals.length, 60, 'every change is written locally')
    const duringDrag = w.sent.length
    assert.ok(duringDrag >= 8 && duringDrag <= 10, `~10 sends during the drag, got ${duringDrag}`)
    w.advance(5)
    g.end()
    // The last throttled send may already carry the final value; then end() sends nothing.
    const last = w.sent.at(-1)
    assert.deepEqual(last.value, [60 * 0.1, 0, 0])
    assert.ok(w.sent.length <= 11)
    for (const s of w.sent) assert.equal(s.field, 'translation')
  })

  test('end() sends nothing when the value equals the last one sent', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(150)
    g.update({ translation: [1, 0, 0] })     // throttle window passed: sent now
    assert.equal(w.sent.length, 1)
    g.end()
    assert.equal(w.sent.length, 1, 'no duplicate final send')
  })

  test('end() sends the final value when the throttle held it back', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(10)
    g.update({ translation: [2, 0, 0] })
    assert.equal(w.sent.length, 0)
    g.end()
    assert.equal(w.sent.length, 1)
    assert.deepEqual(w.sent[0].value, [2, 0, 0])
  })

  test('a drag that changes nothing sends nothing', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    g.update({ translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
    g.end()
    assert.equal(w.sent.length, 0)
    assert.equal(w.tracker.hasRecord(n, 'translation'), false)
  })
})

describe('edit-gesture: confirmation and revert', () => {
  test('all accepted → no revert', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })
    w.advance(200); g.update({ translation: [2, 0, 0] })
    g.end()
    for (const s of w.sent) w.tracker.accepted(s.seq)
    assert.equal(w.reverts.length, 0)
    assert.deepEqual(n.translation, [2, 0, 0])
    assert.equal(w.tracker.hasRecord(n, 'translation'), false)
  })

  test('the last send rejected after earlier ones were accepted → reverts to the latest accepted value, not the start', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })   // seq 1
    w.advance(200); g.update({ translation: [2, 0, 0] })   // seq 2
    w.advance(10);  g.update({ translation: [3, 0, 0] })
    g.end()                                               // seq 3 (final)
    assert.equal(w.sent.length, 3)
    w.tracker.accepted(1)
    w.tracker.accepted(2)
    w.tracker.rejected(3, { code: 'INVALID_VALUE', message: 'nope' })
    assert.deepEqual(n.translation, [2, 0, 0])
    assert.deepEqual(w.reverts, [{ node: n, field: 'translation', value: [2, 0, 0] }])
    assert.equal(w.messages[0].text, "Couldn't save: nope")
  })

  test('all rejected → reverts to the start value', () => {
    const w = makeWorld()
    const n = node()
    n.translation = [5, 5, 5]
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [6, 5, 5] })
    g.end()
    w.advance(10)
    for (const s of w.sent) w.tracker.rejected(s.seq, { code: 'PERMISSION_DENIED', message: 'no' })
    assert.deepEqual(n.translation, [5, 5, 5])
  })

  test('nothing reverts while sends are still pending', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })
    w.advance(200); g.update({ translation: [2, 0, 0] })
    g.end()
    w.tracker.rejected(1, { message: 'no' })
    assert.deepEqual(n.translation, [2, 0, 0], 'seq 2 still pending: no write yet')
    w.tracker.rejected(2, { message: 'no' })
    assert.deepEqual(n.translation, [0, 0, 0])
  })

  test('edit:unknown → no revert', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })
    g.end()
    w.tracker.unknown(1)
    assert.equal(w.reverts.length, 0)
    assert.deepEqual(n.translation, [1, 0, 0])
  })

  test('two fields in one gesture resolve independently', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200)
    g.update({ translation: [1, 0, 0], scale: [2, 2, 2] })
    g.end()
    const tSeq = w.sent.find(s => s.field === 'translation').seq
    const sSeq = w.sent.find(s => s.field === 'scale').seq
    w.tracker.accepted(tSeq)
    w.tracker.rejected(sSeq, { message: 'no' })
    assert.deepEqual(n.translation, [1, 0, 0])
    assert.deepEqual(n.scale, [1, 1, 1])
  })

  test('a node renamed mid-gesture is still matched (identity, not name)', () => {
    const w = makeWorld()
    const n = node('Crate')
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })   // seq 1 accepted
    n.name = 'Box'                                        // som:rename applied
    w.advance(200); g.update({ translation: [2, 0, 0] })   // seq 2 rejected
    g.end()
    w.tracker.accepted(1)
    w.tracker.rejected(2, { message: 'no' })
    assert.deepEqual(n.translation, [1, 0, 0])
    assert.equal(w.reverts[0].node, n)
  })

  test('a different node that takes a renamed node\'s old name gets its own record', () => {
    const w = makeWorld()
    const first = node('Crate')
    w.tracker.commit(first, 'translation', [1, 0, 0])      // seq 1, still pending
    first.name = 'Box'                                      // renamed
    const second = node('Crate')                            // a new node under the old name
    w.tracker.commit(second, 'translation', [5, 0, 0])     // seq 2
    w.tracker.accepted(2)
    w.tracker.rejected(1, { message: 'no' })
    assert.deepEqual(first.translation, [0, 0, 0], 'the renamed node reverts')
    assert.deepEqual(second.translation, [5, 0, 0], 'the new node keeps its accepted value')
  })

  test('a panel commit is a one-send gesture with the same rules', () => {
    const w = makeWorld()
    const n = node()
    const seq = w.tracker.commit(n, 'translation', [4, 0, 0])
    assert.equal(w.sent.length, 1)
    assert.deepEqual(n.translation, [4, 0, 0])
    w.tracker.rejected(seq, { message: 'no' })
    assert.deepEqual(n.translation, [0, 0, 0])
  })

  test('a commit of the current value sends nothing', () => {
    const w = makeWorld()
    const n = node()
    assert.equal(w.tracker.commit(n, 'translation', [0, 0, 0]), null)
    assert.equal(w.sent.length, 0)
  })

  test('overlapping gestures: a late rejection from the drag does not overwrite the newer accepted commit', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(10); g.update({ translation: [5, 0, 0] })
    g.end()                                                       // seq 1 pending (X=5)
    const seq2 = w.tracker.commit(n, 'translation', [10, 0, 0])   // seq 2 (X=10)
    const writesBefore = w.locals.length
    w.tracker.accepted(seq2)
    w.tracker.rejected(1, { message: 'late' })
    assert.deepEqual(n.translation, [10, 0, 0])
    assert.equal(w.locals.length, writesBefore, 'nothing written in between')
    assert.equal(w.reverts.length, 0)
  })

  test('no revert while a newer gesture on the same field is under way', () => {
    const w = makeWorld()
    const n = node()
    const g1 = w.tracker.begin(n)
    w.advance(10); g1.update({ translation: [1, 0, 0] })
    g1.end()                                      // seq 1
    const g2 = w.tracker.begin(n)
    w.advance(10); g2.update({ translation: [2, 0, 0] })
    const writesBefore = w.locals.length
    w.tracker.rejected(1, { message: 'no' })
    assert.equal(w.locals.length, writesBefore, 'no write during the newer drag')
    assert.deepEqual(n.translation, [2, 0, 0])
    g2.end()                                      // seq 2
    w.tracker.accepted(2)
    assert.deepEqual(n.translation, [2, 0, 0], 'the newer accepted value stands')
    assert.equal(w.reverts.length, 0)
  })

  test('no revert during a newer gesture; once it ends and is rejected too, back to the start', () => {
    const w = makeWorld()
    const n = node()
    const g1 = w.tracker.begin(n)
    w.advance(10); g1.update({ translation: [1, 0, 0] })
    g1.end()                                      // seq 1
    const g2 = w.tracker.begin(n)
    w.advance(10); g2.update({ translation: [2, 0, 0] })
    w.tracker.rejected(1, { message: 'no' })
    g2.end()                                      // seq 2
    w.tracker.rejected(2, { message: 'no' })
    assert.deepEqual(n.translation, [0, 0, 0])
  })
})

describe('edit-gesture: node removed', () => {
  test('mid-drag: no further writes or sends, no final send, and a late rejection writes nothing', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })   // seq 1 in flight
    w.tracker.nodeRemoved(n)
    const locals = w.locals.length
    const sends = w.sent.length
    w.advance(200); g.update({ translation: [2, 0, 0] })
    g.end()
    assert.equal(w.locals.length, locals, 'no local writes after removal')
    assert.equal(w.sent.length, sends, 'no sends after removal, no final send')
    w.tracker.rejected(1, { code: 'NODE_NOT_FOUND', message: 'gone' })
    assert.equal(w.locals.length, locals, 'a dead record never writes')
    assert.equal(w.messages.at(-1).text, REMOVED_MESSAGE)
    assert.equal(w.tracker.pendingCount, 0)
    assert.equal(w.tracker.hasRecord(n, 'translation'), false)
  })

  test('rejected mid-drag, then removed: the cancel writes nothing to the removed node', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })   // seq 1
    w.tracker.rejected(1, { code: 'PERMISSION_DENIED', message: 'no' })
    const locals = w.locals.length
    w.tracker.nodeRemoved(n)                              // cancels the drag, which reconciles
    assert.equal(w.locals.length, locals, 'no write to the removed node')
    assert.equal(w.reverts.length, 0)
    g.end()
    assert.equal(w.locals.length, locals)
  })

  test('reset after a rejection mid-drag writes nothing', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })   // seq 1
    w.tracker.rejected(1, { message: 'no' })
    const locals = w.locals.length
    w.tracker.reset()
    assert.equal(w.locals.length, locals)
    assert.equal(w.reverts.length, 0)
  })

  test('pruneRemoved: a removed node that is not being dragged still never gets written', () => {
    const w = makeWorld()
    const kept = node('kept')
    const gone = node('gone')
    w.tracker.commit(kept, 'translation', [1, 0, 0])            // seq 1
    w.tracker.commit(gone, 'translation', [2, 0, 0])            // seq 2
    w.tracker.pruneRemoved((n) => n !== gone)
    const locals = w.locals.length
    w.tracker.rejected(2, { code: 'NODE_NOT_FOUND', message: 'gone' })
    assert.equal(w.locals.length, locals, 'no write to the removed node')
    assert.equal(w.messages.at(-1).text, REMOVED_MESSAGE)
    w.tracker.rejected(1, { message: 'no' })
    assert.deepEqual(kept.translation, [0, 0, 0], 'the live node still reverts')
  })

  test('reset drops every record and gesture', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })
    w.tracker.reset()
    assert.equal(w.tracker.pendingCount, 0)
    assert.equal(w.tracker.accepted(1), null)
    g.end()
    assert.equal(w.sent.length, 1, 'a reset gesture sends nothing more')
  })
})

describe('edit-gesture: values', () => {
  test('scale is clamped to MIN_SCALE on every axis', () => {
    assert.deepEqual(sanitizeTransform('scale', [0, -2, 3]), [MIN_SCALE, MIN_SCALE, 3])
    const w = makeWorld()
    const n = node()
    w.tracker.commit(n, 'scale', [0, 1, 1])
    assert.deepEqual(w.sent[0].value, [MIN_SCALE, 1, 1])
  })

  test('rotation is normalized; a zero quaternion becomes identity', () => {
    const q = sanitizeTransform('rotation', [0, 0, 2, 0])
    assert.deepEqual(q, [0, 0, 1, 0])
    assert.deepEqual(sanitizeTransform('rotation', [0, 0, 0, 0]), [0, 0, 0, 1])
  })

  test('a Move drag on a node whose stored quaternion is unit only to rounding sends no rotation', () => {
    const w = makeWorld()
    const n = node()
    n.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2]       // length 1.0000000000000002
    const g = w.tracker.begin(n)
    w.advance(200)
    g.update({ translation: [1, 0, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [1, 1, 1] })
    g.end()
    assert.deepEqual(w.sent.map(s => s.field), ['translation'])
  })

  test('accepted() reports the node and field, so the app can rebuild pads', () => {
    const w = makeWorld()
    const n = node()
    const seq = w.tracker.commit(n, 'rotation', [0, 0.7071068, 0, 0.7071068])
    const r = w.tracker.accepted(seq)
    assert.equal(r.node, n)
    assert.equal(r.field, 'rotation')
    assert.equal(w.tracker.accepted(999), null, 'not ours')
  })
})

// ── Y3: settle batches, outcomes and remote sets ────────────────────────────
// Phase 3 step 2 — the engine must record what the server accepted, not what
// this tab meant to do. Everything below drives the tracker directly.

describe('edit-gesture: settle batches (Y3)', () => {
  test('every send accepted: one result per gesture, after the last answer, changed fields only', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })    // seq 1
    w.advance(200); g.update({ translation: [2, 0, 0] })    // seq 2
    assert.equal(w.sent.length, 2)
    g.end()                                                // nothing more to send
    w.tracker.accepted(1)
    assert.deepEqual(w.takeSettled(), [], 'nothing is reported while a send is outstanding')
    w.tracker.accepted(2)
    assert.equal(w.settled.length, 1, 'reported once, after the last answer')
    assert.deepEqual(w.settled[0].results,
      [{ node: n, changes: [{ field: 'translation', from: [0, 0, 0], to: [2, 0, 0] }] }])
    assert.deepEqual(w.settled[0].info,
      { acceptedOwnSend: true, remote: false, rejected: false })
    assert.equal(w.tracker.awaitingCount, 0)
  })

  test('every send accepted writes nothing: the node already holds the last value', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })
    w.advance(200); g.update({ translation: [2, 0, 0] })
    g.end()
    const writes = w.locals.length
    w.tracker.accepted(1)
    w.tracker.accepted(2)
    assert.equal(w.locals.length, writes, 'reconcile writes nothing in the ordinary path')
    assert.equal(w.reverts.length, 0)
  })

  test('(U13) partly accepted, one field: the accepted change is still recorded, from the start', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })    // seq 1: accepted
    w.advance(200); g.update({ translation: [2, 0, 0] })    // seq 2: refused
    g.end()
    w.tracker.accepted(1)
    w.tracker.rejected(2, { message: 'nope' })
    assert.deepEqual(n.translation, [1, 0, 0], 'reconcile left the accepted value')
    assert.equal(w.settled.length, 1)
    assert.deepEqual(w.settled[0].results,
      [{ node: n, changes: [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }] }])
    assert.deepEqual(w.settled[0].info,
      { acceptedOwnSend: true, remote: false, rejected: true })
  })

  test('(U13) partly accepted, two fields: one merged result, the refused field left out', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] })
    assert.deepEqual(w.sent.map(s => s.field).sort(), ['rotation', 'translation'])
    const t1 = w.sent.find(s => s.field === 'translation').seq
    const r1 = w.sent.find(s => s.field === 'rotation').seq
    w.advance(200); g.update({ translation: [2, 0, 0] })   // no rotation change: no second send
    const t2 = w.sent.filter(s => s.field === 'translation').at(-1).seq
    g.end()
    w.tracker.accepted(t1)
    w.tracker.accepted(t2)
    w.tracker.rejected(r1, { message: 'not a unit quaternion' })
    assert.deepEqual(n.translation, [2, 0, 0])
    assert.deepEqual(n.rotation, [0, 0, 0, 1], 'reconcile put the rotation back to its start')
    assert.equal(w.settled.length, 1)
    assert.deepEqual(w.settled[0].results, [{
      node: n,
      changes: [{ field: 'translation', from: [0, 0, 0], to: [2, 0, 0] }],
    }], 'the rotation is left out: reconcile made it its start again')
  })

  test('overlap with a refusal: one merged result, reported only after the older gesture’s answer', () => {
    const w = makeWorld()
    const n = node()
    const g1 = w.tracker.begin(n)
    w.advance(200); g1.update({ translation: [1, 0, 0] })   // seq 1, still unanswered
    g1.end()
    const g2 = w.tracker.begin(n)
    w.advance(200); g2.update({ translation: [2, 0, 0] })   // seq 2, shares the record
    g2.end()
    w.tracker.accepted(2)
    assert.deepEqual(w.takeSettled(), [], 'gesture 2’s own answer does not settle the batch')
    w.tracker.rejected(1, { message: 'late' })
    assert.equal(w.settled.length, 1)
    assert.deepEqual(w.settled[0].results,
      [{ node: n, changes: [{ field: 'translation', from: [0, 0, 0], to: [2, 0, 0] }] }])
    assert.deepEqual(n.translation, [2, 0, 0], 'the accepted value stands')
    assert.equal(w.reverts.length, 0)
  })

  test('overlap, both accepted: two results in begin order, so Undo reverses the newest first', () => {
    const w = makeWorld()
    const n = node()
    const g1 = w.tracker.begin(n)
    w.advance(200); g1.update({ translation: [1, 0, 0] })   // seq 1
    const g2 = w.tracker.begin(n)
    w.advance(200); g2.update({ translation: [2, 0, 0] })   // seq 2
    g1.end()
    g2.end()
    w.tracker.accepted(1)
    w.tracker.accepted(2)
    assert.equal(w.settled.length, 1)
    assert.deepEqual(w.settled[0].results, [
      { node: n, changes: [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }] },
      { node: n, changes: [{ field: 'translation', from: [1, 0, 0], to: [2, 0, 0] }] },
    ])
  })

  test('two gestures on different fields settle on their own records, not together', () => {
    const w = makeWorld()
    const n = node()
    const g1 = w.tracker.begin(n)
    w.advance(200); g1.update({ translation: [1, 0, 0] })
    g1.end()
    const g2 = w.tracker.begin(n)
    w.advance(200); g2.update({ rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] })
    g2.end()
    w.tracker.accepted(2)                                    // the rotation only
    assert.equal(w.settled.length, 1, 'gesture 2 does not wait for gesture 1')
    assert.deepEqual(w.settled[0].results[0].changes[0].field, 'rotation')
    w.tracker.accepted(1)
    assert.equal(w.settled.length, 2)
    assert.deepEqual(w.settled[1].results[0].changes[0].field, 'translation')
  })

  test('a drag put back to its start reports nothing', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })
    w.advance(200); g.update({ translation: [0, 0, 0] })
    g.end()
    for (const s of w.sent) w.tracker.accepted(s.seq)
    assert.equal(w.settled.length, 1)
    assert.deepEqual(w.settled[0].results, [], 'from equals to: no change to record')
  })

  test('(review 2 #4) a partial drag dragged back over the refused value records the confirmed result', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })    // seq 1 accepted
    w.advance(200); g.update({ translation: [0, 0, 0] })    // seq 2 refused
    g.end()
    w.tracker.accepted(1)
    w.tracker.rejected(2, { message: 'nope' })
    assert.equal(w.settled.length, 1)
    assert.deepEqual(w.settled[0].results,
      [{ node: n, changes: [{ field: 'translation', from: [0, 0, 0], to: [1, 0, 0] }] }],
      'judged on the confirmed result, never on the last attempted value')
  })

  test('a drag cancelled by a remove reports nothing', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })
    w.tracker.nodeRemoved(n)
    assert.deepEqual(w.takeSettled(), [], 'a dead batch reports nothing')
    g.end()
    assert.deepEqual(w.takeSettled(), [])
  })

  test('an unknown send reports nothing: the session is ending (W7)', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })
    g.end()
    w.tracker.unknown(1)
    assert.deepEqual(w.takeSettled(), [])
  })
})

describe('edit-gesture: other sessions’ changes reach the tracker (Y3, U16)', () => {
  test('(U16 case 1) a refusal writes nothing when a remote set is already the server’s value', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [1, 0, 0] })    // seq 1
    w.advance(200); g.update({ translation: [2, 0, 0] })    // seq 2
    g.end()
    w.tracker.accepted(1)                                    // confirmed = 1
    n.translation = [4, 0, 0]                                // another session’s som:set applied
    w.tracker.remoteSet(n, 'translation', [4, 0, 0])         // it arrived after our accepted send
    w.tracker.rejected(2, { message: 'nope' })
    assert.deepEqual(n.translation, [4, 0, 0], 'the server’s newer value is never overwritten')
    assert.equal(w.reverts.length, 0, 'nothing was written')
    assert.equal(w.settled.length, 1)
    assert.deepEqual(w.settled[0].results, [], 'a batch another session touched records nothing')
    assert.equal(w.settled[0].info.acceptedOwnSend, true, 'one of this tab’s sends was accepted')
  })

  test('(U16 case 2, the probe) an accepted send after a remote set leaves the node at this tab’s value', () => {
    const w = makeWorld()
    const n = node()
    const seq = w.tracker.commit(n, 'translation', [5, 0, 0])
    n.translation = [4, 0, 0]                                // the remote set, applied locally
    w.tracker.remoteSet(n, 'translation', [4, 0, 0])
    w.tracker.accepted(seq)
    assert.deepEqual(n.translation, [5, 0, 0], 'the last thing to arrive is the server’s value')
    assert.deepEqual(w.reverts, [{ node: n, field: 'translation', value: [5, 0, 0] }])
    assert.equal(w.settled.length, 1)
    assert.deepEqual(w.settled[0].results, [], 'nothing is recorded for a remote-touched batch')
  })

  test('(U16 case 2) the same with an undo’s send: { record: false } still reconciles to confirmed', () => {
    const w = makeWorld()
    const n = node()
    const seq = w.tracker.commit(n, 'translation', [5, 0, 0], { record: false })
    n.translation = [4, 0, 0]
    w.tracker.remoteSet(n, 'translation', [4, 0, 0])
    w.tracker.accepted(seq)
    assert.deepEqual(n.translation, [5, 0, 0])
    assert.deepEqual(w.takeSettled(), [], 'an undo’s send is never part of a reported batch')
  })

  test('a remote set then this tab’s accepted value then a refusal reverts to the last to arrive', () => {
    const w = makeWorld()
    const n = node()
    const g = w.tracker.begin(n)
    w.advance(200); g.update({ translation: [5, 0, 0] })     // seq 1
    n.translation = [4, 0, 0]
    w.tracker.remoteSet(n, 'translation', [4, 0, 0])
    w.advance(200); g.update({ translation: [6, 0, 0] })     // seq 2
    g.end()
    w.tracker.accepted(1)
    w.tracker.rejected(2, { message: 'nope' })
    assert.deepEqual(n.translation, [5, 0, 0], 'the last to arrive was this tab’s accepted 5')
  })

  test('a remote set for a node and field with no open record changes nothing', () => {
    const w = makeWorld()
    const n = node()
    w.tracker.remoteSet(n, 'translation', [9, 0, 0])
    assert.equal(w.tracker.hasRecord(n, 'translation'), false)
    assert.equal(w.tracker.awaitingCount, 0)
    assert.deepEqual(w.takeSettled(), [])
    // and the next commit still starts from what the node holds, as before
    const seq = w.tracker.commit(n, 'translation', [9, 0, 0])
    assert.equal(seq, 1, 'the remote value never reached the tracker')
    assert.deepEqual(w.sent[0].value, [9, 0, 0])
  })

  test('(review 3 #3) a remote batch clears redo only when one of this tab’s sends was accepted', () => {
    // every own send refused: this tab changed nothing
    const a = makeWorld()
    const na = node()
    const ga = a.tracker.begin(na)
    a.advance(200); ga.update({ translation: [1, 0, 0] })    // seq 1
    na.translation = [4, 0, 0]
    a.tracker.remoteSet(na, 'translation', [4, 0, 0])
    a.advance(200); ga.update({ translation: [2, 0, 0] })    // seq 2
    ga.end()
    a.tracker.rejected(1, { message: 'no' })
    a.tracker.rejected(2, { message: 'no' })
    assert.equal(a.settled.length, 1)
    assert.deepEqual(a.settled[0].results, [])
    assert.equal(a.settled[0].info.acceptedOwnSend, false, 'both stacks stay')

    // one own send accepted: a confirmed change went unrecorded
    const b = makeWorld()
    const nb = node()
    const gb = b.tracker.begin(nb)
    b.advance(200); gb.update({ translation: [1, 0, 0] })    // seq 1
    nb.translation = [4, 0, 0]
    b.tracker.remoteSet(nb, 'translation', [4, 0, 0])
    b.advance(200); gb.update({ translation: [2, 0, 0] })    // seq 2
    gb.end()
    b.tracker.accepted(1)
    b.tracker.rejected(2, { message: 'no' })
    assert.equal(b.settled.length, 1)
    assert.deepEqual(b.settled[0].results, [])
    assert.equal(b.settled[0].info.acceptedOwnSend, true, 'the redo stack is cleared')
  })
})

describe('edit-gesture: an undo’s or a redo’s own send (Y3)', () => {
  test('commit(..., { record: false }) is never reported as a gesture', () => {
    const w = makeWorld()
    const n = node()
    const seq = w.tracker.commit(n, 'translation', [3, 0, 0], { record: false })
    assert.equal(w.sent.length, 1)
    w.tracker.accepted(seq)
    assert.deepEqual(w.takeSettled(), [])
    assert.equal(w.tracker.pendingCount, 0)
  })

  test('commit(..., { record: false }) is still reverted when refused, and says nothing', () => {
    const w = makeWorld()
    const n = node()
    const seq = w.tracker.commit(n, 'translation', [3, 0, 0], { record: false })
    w.tracker.rejected(seq, { message: 'nope' })
    assert.deepEqual(n.translation, [0, 0, 0], 'the refused undo is reverted locally')
    assert.deepEqual(w.messages, [], 'the undo engine shows its own message')
    assert.deepEqual(w.takeSettled(), [])
  })

  test('an ordinary commit is still a one-send gesture with a reported batch', () => {
    const w = makeWorld()
    const n = node()
    const seq = w.tracker.commit(n, 'translation', [4, 0, 0])
    assert.deepEqual(w.takeSettled(), [], 'not settled while the send is outstanding')
    w.tracker.accepted(seq)
    assert.deepEqual(w.settled[0].results,
      [{ node: n, changes: [{ field: 'translation', from: [0, 0, 0], to: [4, 0, 0] }] }])
  })
})

// ── V4 (round 5) — Visible goes through the tracker ────────────────────────

describe('edit-gesture: V4 (round 5) — the Visible field', () => {
  test('sanitizeTransform returns a NON-vector value unchanged', () => {
    // Round 4's last line was `return [...value]`, so a boolean threw
    // "value is not iterable" and the Visible checkbox un-hid nothing.
    assert.equal(sanitizeTransform('visible', false), false)
    assert.equal(sanitizeTransform('visible', true), true)
    // …and the three transform fields behave exactly as before.
    assert.deepEqual(sanitizeTransform('scale', [1, -2, 3]), [1, MIN_SCALE, 3])
    assert.deepEqual(sanitizeTransform('translation', [1, 2, 3]), [1, 2, 3])
    assert.deepEqual(sanitizeTransform('rotation', [0, 0, 0, 2]), [0, 0, 0, 1])
  })

  test('a Visible commit is ONE send each way, and the echo settles it', () => {
    const w = makeWorld()
    const n = node()
    n.visible = true

    const seq = w.tracker.commit(n, 'visible', false)
    assert.equal(typeof seq, 'number', 'commit sent')
    assert.equal(w.sent.length, 1, 'one send')
    assert.equal(w.sent[0].field, 'visible')
    assert.equal(w.sent[0].value, false)
    assert.equal(n.visible, false, 'and it is applied locally first, as a transform is')
    w.tracker.accepted(seq)
    assert.equal(w.tracker.pendingCount, 0, 'the answer settles it')

    // The same value twice sends NOTHING (the tracker's own rule).
    assert.equal(w.tracker.commit(n, 'visible', false), null)
    assert.equal(w.sent.length, 1)

    const back = w.tracker.commit(n, 'visible', true)
    assert.equal(w.sent.length, 2)
    assert.equal(w.sent[1].value, true)
    w.tracker.accepted(back)
    assert.equal(n.visible, true, 'and it un-hides')
    assert.equal(w.reverts.length, 0, 'nothing was reverted')
  })
})
