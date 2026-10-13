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
    now: () => t,
  })
  return {
    tracker, locals, sent, messages, reverts,
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
