// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// runner-activate.test.js — scripting-4c AC5: the runner's readiness, its
// `select` rule and the forwarded select.
//
// The fake client is only the PORT (events, role flags, the send calls): the
// RULE ITSELF is the real `selectTargetFor` and the real
// `withinActivateDistance`, imported by the runner (signin-sync §4.1 — a test of
// a seam uses the real collaborator, not a stand-in).
//
// The one test that needs a REAL client and a REAL server is
// `packages/client/tests/activate.test.js` ("the reviewer's held load"): it
// cannot live here, because `packages/behaviors` deliberately depends on neither
// the client nor the server.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { createBehaviorRunner } from '../src/runner.js'
import { templateGraph } from '../src/templates.js'
import { ACTIVATE_MAX_DISTANCE } from '../src/behavior-spec.js'
import { OWN, TGT } from './fake-world.mjs'
import { makeFakeClient, makeNode, nextId } from './fake-client.mjs'

const hide = (ownId, target = TGT) => templateGraph('select-visibility', { target, action: 'hide' }, { ownId })
const prox = (ownId, target = TGT) => templateGraph('proximity-animation', { target, clip: 'Walk', loop: true, radius: 3 }, { ownId })

const ORIGIN = [0, 0, 0]

/**
 * A runner over a fresh clock. The role, `canEdit` and the world are applied in
 * the order the app applies them, and every port the runner needs is the real
 * value production passes (`position` is `worldPosition` over the fake node's
 * `translation`, `localAvatar` is the tab's own node).
 */
function setup({ nodes = [], grant = true, loadWorld = true, avatar = ORIGIN } = {}) {
  if (!nodes.some((n) => n.extras?.atrium?.objectId === TGT)) nodes = [...nodes, makeNode({ name: 'target', id: TGT })]
  const client = makeFakeClient({ nodes })
  const state = { clock: 0 }
  const runner = createBehaviorRunner({
    client,
    now: () => state.clock,
    position: (node) => (node ? node.translation : undefined),
    localAvatar: () => (avatar ? { name: 'avatar', translation: avatar } : null),
  })
  if (grant) client.scriptHost = { active: true, hostGen: 1 }
  client.canEdit = true
  if (loadWorld) client.emit('world:loaded', { name: 'w' })
  client.emit('script-host:changed', { active: grant, hostGen: 1 })
  return { client, runner, state }
}

/** The engine for a node is live, and its flow has run: exactly one write left. */
const waitForWrite = (client) => { client.sent.length = 0; client.animations.length = 0 }

// ===========================================================================
// M1 — readiness
// ===========================================================================

describe('AC5/M1 — the runner says script-ready exactly when it is enabled', () => {
  test('NOT on the grant while the world is still loading, and ONCE world:loaded arrives', () => {
    const nodes = [makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })]
    const client = makeFakeClient({ nodes })
    const runner = createBehaviorRunner({ client, now: () => 0 })
    try {
      client.canEdit = true
      client.scriptHost = { active: true, hostGen: 1 }                    // the grant
      client.emit('script-host:changed', { active: true, hostGen: 1 })
      assert.equal(client.readyCalls, 0, 'the grant alone is not readiness: the world is still loading')
      assert.equal(runner.enabled, false)

      client.emit('world:loaded', { name: 'w' })                          // the engines exist now
      assert.equal(client.readyCalls, 1, 'the runner says it is ready once its world has loaded')
      assert.equal(runner.engines.size, 1, 'and not before its engines exist')

      // A re-evaluation is harmless: the client's own once-per-generation rule
      // absorbs the repeats.
      client.emit('script-host:changed', { active: true, hostGen: 1 })
      assert.equal(client.readyCalls, 2, 'every enabled evaluate() calls it; the CLIENT decides once per generation')
    } finally {
      runner.dispose()
    }
  })

  test('never after the role is lost', () => {
    const { client, runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })] })
    const before = client.readyCalls
    client.scriptHost = { active: false, hostGen: null }
    client.emit('script-host:changed', { active: false, hostGen: 1 })
    assert.equal(client.readyCalls, before, 'a tab that is not the host has nothing to run')
    assert.equal(runner.enabled, false)
    runner.dispose()
  })

  test('a disposed runner never calls it again', () => {
    const { client, runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })] })
    runner.dispose()
    const before = client.readyCalls
    client.emit('som:add', { nodeName: 'crate' })
    client.emit('script-host:changed', { active: true, hostGen: 1 })
    assert.equal(client.readyCalls, before)
  })
})

// ===========================================================================
// The forwarded select
// ===========================================================================

describe('AC5 — the forwarded select', () => {
  test('runs the engine, and logs `select from <first 8 of from>`', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner, state } = setup({ nodes: [crate] })
    try {
      waitForWrite(client)
      client.emit('activate', { node: 'crate', from: 'visitor-abcd1234' })
      runner.tick()
      assert.equal(client.sent.length, 1, 'the engine ran')
      const line = runner.log.find((l) => l.message.startsWith('select from'))
      assert.ok(line, 'the host’s log records where the click came from')
      assert.equal(line.message, 'select from visitor-', 'the first 8 characters of `from`, and nothing more')
      assert.equal(line.node, 'crate', 'logged on that node')
      assert.equal(state.clock, line.time)
    } finally {
      runner.dispose()
    }
  })

  test('the logged `from` goes through logId: no control character reaches the line (W3)', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [crate] })
    try {
      waitForWrite(client)
      client.emit('activate', { node: 'crate', from: '\u001b[31mFAKE' })
      runner.tick()
      const line = runner.log.find((l) => l.message.startsWith('select from'))
      assert.ok(line, 'the host’s log records where the click came from')
      // NOT `String(from).slice(0, 8)`, which keeps the ESC and the '['.
      assert.equal(line.message, 'select from 31mFAKE')
      assert.equal(/[\u0000-\u001f\u007f]/.test(line.message), false, 'no control character')
    } finally {
      runner.dispose()
    }
  })

  test('it never re-checks distance: the server is the gate', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    crate.translation = [500, 0, 0]                       // far from the local avatar
    const { client, runner } = setup({ nodes: [crate] })
    try {
      waitForWrite(client)
      client.emit('activate', { node: 'crate', from: 'visitor-1' })
      runner.tick()
      assert.equal(client.sent.length, 1, 'a forwarded select runs wherever the sender was measured')
    } finally {
      runner.dispose()
    }
  })

  test('it runs in EDIT MODE too: the runner never consults it', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [crate] })
    try {
      // The runner has no Edit-mode port at all: nothing in the path can see it.
      assert.equal('editMode' in runner, false)
      waitForWrite(client)
      client.emit('activate', { node: 'crate', from: 'owner-2' })
      runner.tick()
      assert.equal(client.sent.length, 1, 'Edit mode changes what the HOST’s own clicks do, not this')
    } finally {
      runner.dispose()
    }
  })

  test('dropped when the runner is not enabled — logged once', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [crate], loadWorld: false })
    try {
      client.emit('activate', { node: 'crate', from: 'visitor-1' })
      client.emit('activate', { node: 'crate', from: 'visitor-2' })
      const dropped = runner.log.filter((l) => l.message.startsWith('select dropped — '))
      assert.equal(dropped.length, 1, 'once, not once per forward')
      assert.equal(dropped[0].node, 'crate')
      assert.equal(client.sent.length, 0, 'and nothing ran')
    } finally {
      runner.dispose()
    }
  })

  test('dropped when the node has no live engine', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: { ...hide(OWN), kind: 'js' } })  // refused at load
    const { client, runner } = setup({ nodes: [crate] })
    try {
      client.emit('activate', { node: 'crate', from: 'visitor-1' })
      const dropped = runner.log.filter((l) => l.message === 'select dropped — the behaviour is no longer running')
      assert.equal(dropped.length, 1)
      assert.equal(client.sent.length, 0)
    } finally {
      runner.dispose()
    }
  })

  test('dropped when the leaf no longer listens for select', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: prox(OWN) })     // enabled, but no onSelect
    const { client, runner } = setup({ nodes: [crate] })
    try {
      client.emit('activate', { node: 'crate', from: 'visitor-1' })
      const dropped = runner.log.filter((l) => l.message === 'select dropped — the behaviour no longer listens for clicks')
      assert.equal(dropped.length, 1)
      assert.equal(client.sent.length, 0)
    } finally {
      runner.dispose()
    }
  })

  test('the dropped line is once per node per GENERATION, and comes back after a reload', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [crate] })
    try {
      crate.extras.atrium.behavior = { ...crate.extras.atrium.behavior, enabled: false }
      client.emit('som:set', { nodeName: 'crate', path: 'extras.atrium.behavior' })   // the engine is disposed
      client.emit('activate', { node: 'crate', from: 'visitor-1' })
      client.emit('activate', { node: 'crate', from: 'visitor-1' })
      const first = runner.log.filter((l) => l.message.startsWith('select dropped — ')).length
      assert.equal(first, 1, 'once for this generation')

      // Reload it: a NEW generation, so a drop may be logged again.
      crate.extras.atrium.behavior = { ...crate.extras.atrium.behavior, enabled: true }
      client.emit('som:set', { nodeName: 'crate', path: 'extras.atrium.behavior' })
      crate.extras.atrium.behavior = { ...crate.extras.atrium.behavior, enabled: false }
      client.emit('som:set', { nodeName: 'crate', path: 'extras.atrium.behavior' })
      client.emit('activate', { node: 'crate', from: 'visitor-1' })
      const lines = runner.log.filter((l) => l.message.startsWith('select dropped — '))
      assert.equal(lines.length, 2, 'a reloaded behaviour logs again')
    } finally {
      runner.dispose()
    }
  })
})

// ===========================================================================
// The host's own select (AC-L3 (a))
// ===========================================================================

describe('AC5/AC-L3 — the host’s own click obeys the same 10 m rule', () => {
  const far = (d) => [0, 0, d]

  test('at 11 m it returns too-far and the engine does not run', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [crate], avatar: far(11) })
    try {
      assert.equal(runner.select(crate), 'too-far')
      runner.tick()
      assert.equal(client.sent.length, 0, 'nothing ran')
    } finally {
      runner.dispose()
    }
  })

  test('at 9 m it returns ran', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [crate], avatar: far(9) })
    try {
      assert.equal(runner.select(crate), 'ran')
      runner.tick()
      assert.equal(client.sent.length, 1)
    } finally {
      runner.dispose()
    }
  })

  test('exactly 10 m passes, and 10.000001 does not (AC-L2 is inclusive)', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const ten = setup({ nodes: [crate], avatar: far(ACTIVATE_MAX_DISTANCE) })
    try {
      assert.equal(ten.runner.select(crate), 'ran')
    } finally { ten.runner.dispose() }

    // A separate runner, so the first one's engine record cannot answer.
    const crate2 = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const over = setup({ nodes: [crate2], avatar: far(ACTIVATE_MAX_DISTANCE + 0.000001) })
    try {
      assert.equal(over.runner.select(crate2), 'too-far')
    } finally { over.runner.dispose() }
  })

  test('with no local avatar it returns no-avatar and nothing runs', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [crate], avatar: null })
    try {
      assert.equal(runner.select(crate), 'no-avatar')
      runner.tick()
      assert.equal(client.sent.length, 0, 'as on the server: a session with no avatar gets PERMISSION_DENIED')
    } finally {
      runner.dispose()
    }
  })

  test('a click that resolves to no behaviour node returns no-behaviour', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const scenery = makeNode({ name: 'scenery', id: nextId() })
    const { runner } = setup({ nodes: [crate, scenery] })
    try {
      assert.equal(runner.select(scenery), 'no-behaviour')
    } finally {
      runner.dispose()
    }
  })

  test('a tab that is not the host returns not-running', () => {
    const crate = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { runner } = setup({ nodes: [crate], grant: false })
    try {
      assert.equal(runner.select(crate), 'not-running')
    } finally {
      runner.dispose()
    }
  })

  test('a node the RUNNER disabled no longer passes the click to its parent (the AC2 change)', () => {
    // The parent carries an enabled select behaviour; the hit node's own stored
    // leaf is enabled: true too, but its graph is one the runner REFUSES to load,
    // so it has a record with `engine: null`. 4b-2's walk ("the first node with a
    // LIVE engine") carried on to the parent; AC2 stops at the first ENABLED
    // leaf, so the parent does not run.
    const parent = makeNode({ name: 'parent', id: OWN, behavior: hide(OWN) })
    const child = makeNode({ name: 'child', id: nextId(), behavior: { ...hide(nextId()), kind: 'js' }, parent })
    const { client, runner } = setup({ nodes: [parent, child] })
    try {
      assert.equal(runner.engines.get('child').engine, null, 'the child’s engine was refused at load')
      assert.equal(runner.select(child), 'not-running')
      runner.tick()
      assert.equal(client.sent.length, 0, 'and the parent’s behaviour did NOT run')
    } finally {
      runner.dispose()
    }
  })
})
