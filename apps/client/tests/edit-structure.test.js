// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Phase 3 step 1b-2, N2, N4 and J8 — devtasks/PREBRIEF-edit-mode-ui-1b-2.md §7.1

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createStructureTracker, countDescendants, collectSubtree, structuralBlockReason,
  editBlocked, fieldsDisabled, isActiveCameraStale, isAttachedUnder,
} from '../src/edit-structure.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const nodeA = { name: 'Crate', children: [] }

test('one pending request at a time', () => {
  const t = createStructureTracker()
  assert.equal(t.begin('add', 10, { name: 'Cube' }), true)
  assert.equal(t.begin('delete', 11, { node: nodeA }), false, 'a second is refused')
  assert.equal(t.pending.seq, 10)
})

test('accepted, rejected and unknown each end it; another seq does not', () => {
  for (const status of ['accepted', 'rejected', 'unknown']) {
    const t = createStructureTracker()
    t.begin('add', 5, { name: 'Cube' })
    assert.equal(t.settle(6, status), null, 'other seq ignored')
    assert.ok(t.pending)
    const r = t.settle(5, status)
    assert.equal(r.request.kind, 'add')
    assert.equal(r.status, status)
    assert.equal(r.removedMessage, null, 'nothing was held')
    assert.equal(t.pending, null)
    assert.equal(t.begin('add', 7), true, 'free again')
  }
})

test('removalSeen: hold only for the pending delete’s own node object', () => {
  const t = createStructureTracker()
  const sameName = { name: 'Crate', children: [] }
  t.begin('delete', 3, { node: nodeA })
  assert.equal(t.removalSeen(sameName), 'show', 'another object with the same name')
  assert.equal(t.removalSeen(nodeA), 'hold')
  t.settle(3, 'accepted')
  assert.equal(t.removalSeen(nodeA), 'show', 'after the request ended')
})

test('removalSeen: show when the pending request is not a delete', () => {
  const t = createStructureTracker()
  t.begin('duplicate', 3, { name: 'Crate copy', node: nodeA })
  assert.equal(t.removalSeen(nodeA), 'show')
})

test('(review #3) the race: held, then this tab’s delete rejected → show', () => {
  const t = createStructureTracker()
  t.begin('delete', 8, { node: nodeA })
  assert.equal(t.removalSeen(nodeA), 'hold')     // the other tab's remove broadcast
  assert.equal(t.settle(8, 'rejected').removedMessage, 'show')
})

test('(review #3) held, then this tab’s delete accepted → quiet', () => {
  const t = createStructureTracker()
  t.begin('delete', 8, { node: nodeA })
  t.removalSeen(nodeA)
  assert.equal(t.settle(8, 'accepted').removedMessage, 'quiet')
})

test('(review #3) held, then the connection ends (unknown) → quiet', () => {
  const t = createStructureTracker()
  t.begin('delete', 8, { node: nodeA })
  t.removalSeen(nodeA)
  assert.equal(t.settle(8, 'unknown').removedMessage, 'quiet')
})

test('a delete refused before any removal holds nothing', () => {
  const t = createStructureTracker()
  t.begin('delete', 8, { node: nodeA })
  assert.equal(t.settle(8, 'rejected').removedMessage, null)
})

test('reset clears the pending request', () => {
  const t = createStructureTracker()
  t.begin('delete', 1, { node: nodeA })
  t.reset()
  assert.equal(t.pending, null)
  assert.equal(t.removalSeen(nodeA), 'show')
  assert.equal(t.settle(1, 'accepted'), null)
})

test('(outside review S1) held, a newer node with the name arrives, then accepted → replaced', () => {
  // A's dialog was open: B deleted "Sphere" and made a new "Sphere"; A's
  // delete-by-name then removed B's new one.
  const t = createStructureTracker()
  t.begin('delete', 9, { name: 'Sphere', node: nodeA })
  assert.equal(t.removalSeen(nodeA), 'hold')
  t.addSeen('Sphere')
  assert.equal(t.settle(9, 'accepted').removedMessage, 'replaced')
})

test('(S1) a newer node with another name, or before any removal, changes nothing', () => {
  const t = createStructureTracker()
  t.begin('delete', 9, { name: 'Sphere', node: nodeA })
  t.addSeen('Sphere')                       // not held yet: our node is still there
  t.removalSeen(nodeA)
  t.addSeen('Cube')                         // another name
  assert.equal(t.settle(9, 'accepted').removedMessage, 'quiet')
  const u = createStructureTracker()
  u.begin('add', 3, { name: 'Sphere' })
  u.addSeen('Sphere')
  assert.equal(u.settle(3, 'accepted').removedMessage, null)
})

test('(S1) replaced but rejected is still "show"', () => {
  const t = createStructureTracker()
  t.begin('delete', 9, { name: 'Sphere', node: nodeA })
  t.removalSeen(nodeA)
  t.addSeen('Sphere')
  assert.equal(t.settle(9, 'rejected').removedMessage, 'show')
})

test('(outside review nit) a descendant of the pending delete is held too', () => {
  const child = { name: 'leg', children: [] }
  const parent = { name: 'Table', children: [child] }
  const t = createStructureTracker()
  t.begin('delete', 4, { name: 'Table', node: parent, subtree: collectSubtree(parent) })
  assert.equal(t.removalSeen(child), 'hold', 'the owner had Alt-selected the child')
  assert.equal(t.removalSeen({ name: 'leg', children: [] }), 'show', 'another object named like the child')
  assert.equal(t.settle(4, 'accepted').removedMessage, 'quiet')
})

test('collectSubtree: the node and every descendant, as objects', () => {
  const b = { children: [] }, a = { children: [b] }, c = { children: [] }, root = { children: [a, c] }
  assert.deepStrictEqual(collectSubtree(root), [root, a, b, c])
  assert.deepStrictEqual(collectSubtree(null), [])
})

test('begin keeps extra fields (the palette retry carries its descriptor)', () => {
  const t = createStructureTracker()
  t.begin('add', 1, { name: 'Cube', primitive: 'cube', descriptor: { name: 'Cube' } })
  assert.equal(t.pending.kind, 'add', 'extra fields never override kind')
  assert.equal(t.pending.primitive, 'cube')
  assert.deepStrictEqual(t.pending.descriptor, { name: 'Cube' })
})

test('countDescendants: every node below, not just children', () => {
  assert.equal(countDescendants({ children: [] }), 0)
  const chain = { name: 'G', children: [{ name: 'G-a', children: [{ name: 'G-b', children: [] }] }] }
  assert.equal(countDescendants(chain), 2)
  const tree = { children: [{ children: [{ children: [] }] }, { children: [] }] }
  assert.equal(countDescendants(tree), 3)
  assert.equal(countDescendants(null), 0)
})

test('structuralBlockReason: Delete/Duplicate wait for a selection, a request, a drag, a rename', () => {
  const ok = { hasSelection: true, pending: false, dragging: false, renaming: false }
  assert.equal(structuralBlockReason(ok), null)
  assert.match(structuralBlockReason({ ...ok, hasSelection: false }), /Select/)
  assert.match(structuralBlockReason({ ...ok, pending: true }), /server/)
  assert.match(structuralBlockReason({ ...ok, dragging: true }), /moving/)
  assert.match(structuralBlockReason({ ...ok, renaming: true }), /rename/)
})

test('(Rev 1 #4, U14) structuralBlockReason: an unanswered transform send blocks first', () => {
  const ok = { hasSelection: true, pending: false, dragging: false, renaming: false }
  assert.equal(structuralBlockReason({ ...ok, sending: true }), 'Waiting for the server…')
  assert.equal(structuralBlockReason({ ...ok, sending: false }), null)
  // it comes before a drag: a drag ended a moment ago still has sends to answer
  assert.equal(structuralBlockReason({ ...ok, sending: true, dragging: true }), 'Waiting for the server…')
})

test('(Rev 2) structuralBlockReason: an undo or a redo in flight blocks with its own reason', () => {
  const ok = { hasSelection: true, pending: false, dragging: false, renaming: false }
  assert.equal(structuralBlockReason({ ...ok, undoing: true }), 'Undoing…')
  assert.equal(structuralBlockReason({ ...ok, undoing: false }), null)
  assert.equal(structuralBlockReason({ ...ok, undoing: true, pending: true }), 'Undoing…')
})

test('(Rev 2, Rev 3 #2) editBlocked: an undo in flight or any structural request pending', () => {
  assert.equal(editBlocked({ undoing: false, pending: false }), false)
  assert.equal(editBlocked({ undoing: true, pending: false }), true)
  assert.equal(editBlocked({ undoing: false, pending: true }), true)
  assert.equal(editBlocked({ undoing: true, pending: true }), true)
  assert.equal(editBlocked(), false)
})

test('(R3) fieldsDisabled: a pending rename, or any block, disables the fields', () => {
  assert.equal(fieldsDisabled({ renaming: false, blocked: false }), false)
  assert.equal(fieldsDisabled({ renaming: true, blocked: false }), true, 'a pending rename')
  assert.equal(fieldsDisabled({ renaming: false, blocked: true }), true, 'an undo/redo or a pending request')
  assert.equal(fieldsDisabled({ renaming: true, blocked: true }), true)
  assert.equal(fieldsDisabled(), false)
})

test('(R3) refreshEditActions holds the handles and the fields, not only the buttons', () => {
  // The pure decision is fieldsDisabled (above). This guards the wiring half:
  // every place a block starts or ends calls refreshEditActions, and that is
  // where the handles (syncGizmoEnabled) and the fields (fieldsDisabled) must
  // be held — a gizmo or a field left live during a block moves the object with
  // nothing sent.
  const lines = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8').split('\n')
  const start = lines.findIndex((l) => l.startsWith('function refreshEditActions()'))
  assert.ok(start >= 0, 'refreshEditActions is in app.js')
  const body = []
  for (let i = start + 1; i < lines.length && lines[i] !== '}'; i++) body.push(lines[i])
  const text = body.join('\n')
  assert.match(text, /syncGizmoEnabled\(\)/, 'the handles are re-synced from refreshEditActions')
  assert.match(text, /fieldsDisabled\(/, 'the fields use the shared decision')
})

test('(Rev 2, review 2 #1) a pending delete survives an Edit-off-and-on cycle', () => {
  // The app no longer resets the tracker when Edit mode goes off (Y7), so the
  // tracker's own API is what must hold: no reset, the one-at-a-time rule and
  // the S1 evidence all survive to `settle`.
  const t = createStructureTracker()
  const child = { name: 'leg', children: [] }
  const parent = { name: 'Table', children: [child] }
  t.begin('delete', 12, { name: 'Table', node: parent, subtree: collectSubtree(parent) })
  // Edit mode off … and on again: nothing touches the tracker
  assert.equal(t.begin('add', 13, { name: 'Cube' }), false, 'a second request is still refused')
  assert.equal(t.pending.seq, 12)
  assert.equal(t.removalSeen(parent), 'hold')
  t.addSeen('Table')
  const r = t.settle(12, 'accepted')
  assert.equal(r.request.seq, 12)
  assert.equal(r.removedMessage, 'replaced', 'held and replaced both survived')
})

test('(Y4) a request carries the undo/redo marker through settle()', () => {
  const t = createStructureTracker()
  const nodeA2 = { name: 'Crate', children: [] }
  t.begin('delete', 21, { name: 'Crate', node: nodeA2, undo: 'undo' })
  assert.equal(t.pending.undo, 'undo')
  const r = t.settle(21, 'accepted')
  assert.equal(r.request.undo, 'undo', 'the marker reaches the answer')
  // the S1 hold works for a marked delete exactly as for a click
  const u = createStructureTracker()
  u.begin('delete', 22, { name: 'Sphere', node: nodeA, undo: 'redo' })
  assert.equal(u.removalSeen(nodeA), 'hold')
  u.addSeen('Sphere')
  assert.equal(u.settle(22, 'accepted').removedMessage, 'replaced')
})

// ── J8 ──────────────────────────────────────────────────────────────────────

const scene = { parent: null }
const host = { parent: scene }
const cam = { parent: host }

test('isActiveCameraStale: no active camera → false', () => {
  assert.equal(isActiveCameraStale({ active: false, hostAlive: false, rendered: null, sceneRoot: scene }), false)
})

test('isActiveCameraStale: host alive and camera attached under the scene → false', () => {
  assert.equal(isActiveCameraStale({ active: true, hostAlive: true, rendered: cam, sceneRoot: scene }), false)
})

test('isActiveCameraStale: host gone → true', () => {
  assert.equal(isActiveCameraStale({ active: true, hostAlive: false, rendered: cam, sceneRoot: scene }), true)
})

test('isActiveCameraStale (review #6): shared camera — host alive but the rendered camera hangs under a removed object → true', () => {
  const removedHost = { parent: null }            // detached from the scene
  const orphanCam = { parent: removedHost }
  assert.equal(isActiveCameraStale({ active: true, hostAlive: true, rendered: orphanCam, sceneRoot: scene }), true)
})

test('isActiveCameraStale: a camera under the previous world’s scene is stale', () => {
  const oldScene = { parent: null }
  const oldCam = { parent: { parent: oldScene } }
  assert.equal(isActiveCameraStale({ active: true, hostAlive: true, rendered: oldCam, sceneRoot: scene }), true)
})

test('isAttachedUnder walks the whole parent chain', () => {
  const deep = { parent: { parent: { parent: scene } } }
  assert.equal(isAttachedUnder(deep, scene), true)
  assert.equal(isAttachedUnder(scene, scene), false, 'an object is not under itself')
  assert.equal(isAttachedUnder(null, scene), false)
})
