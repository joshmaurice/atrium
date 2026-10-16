// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Phase 3 step 1b-2, N2, N4 and J8 — devtasks/PREBRIEF-edit-mode-ui-1b-2.md §7.1

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createStructureTracker, countDescendants, structuralBlockReason, isActiveCameraStale, isAttachedUnder,
} from '../src/edit-structure.js'

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
