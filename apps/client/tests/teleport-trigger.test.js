// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// teleport-trigger.test.js — unit tests for createTeleportTrigger
// Pure functions, no DOM, just node:test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createTeleportTrigger, TELEPORT_TRIGGER_RADIUS, TELEPORT_TRIGGER_HEIGHT, nearSpawn, padNearSpawn } from '../src/teleport-trigger.js'
import { worldPosition } from '../src/world-position.js'

describe('createTeleportTrigger', () => {

  test('disarmed start — pads start disarmed on initial setPads', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)

    // Place pad and avatar directly on it — should NOT trigger (starts disarmed)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])
    trigger.update([0, 0, 0])

    assert.equal(triggered.length, 0, 'should not trigger on first enter (disarmed)')
  })

  test('arm on exit — pad arms when avatar leaves its radius', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])

    // Initially on pad (disarmed, wasInside=true)
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 0)

    // Leave pad — arms it
    trigger.update([10, 0, 10])
    assert.equal(triggered.length, 0, 'leaving should not trigger, only arm')
  })

  test('trigger on re-enter — armed pad fires when avatar re-enters', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])

    // Start on pad (disarmed)
    trigger.update([0, 0, 0])
    // Leave (arms)
    trigger.update([10, 0, 10])
    // Re-enter (trigger)
    trigger.update([0, 0, 0])

    assert.equal(triggered.length, 1, 'should trigger on re-enter')
    assert.equal(triggered[0].name, 'pad-1')
    assert.equal(triggered[0].destination, 'ws://dest.com')
  })

  test('nearest pad wins — among multiple triggered pads, closest one fires', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)

    // Two pads both within TELEPORT_TRIGGER_RADIUS of the entry point [0.4,0,0]:
    //   pad at [0,0,0] (distance 0.4)
    //   pad at [1,0,0] (distance 0.6)
    // Avatar enters at [0.4,0,0] after both are armed.
    trigger.setPads([
      { name: 'near-pad', position: [0, 0, 0], destination: 'ws://near.com' },
      { name: 'far-pad',  position: [1, 0, 0], destination: 'ws://far.com' },
    ])

    // Step 1: enter at pad 0 position (disarmed)
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 0, 'no trigger on initial enter (disarmed)')

    // Step 2: exit both (both arm since outside radius)
    trigger.update([100, 0, 100])
    assert.equal(triggered.length, 0, 'no trigger on exit')

    // Step 3: re-enter at [0.4,0,0] — both pads are within R=0.75
    // near-pad is at distance 0.4, far-pad at 0.6 → near-pad should fire
    trigger.update([0.4, 0, 0])
    assert.equal(triggered.length, 1, 'only nearest in-range pad should trigger')
    assert.equal(triggered[0].name, 'near-pad')
    assert.equal(triggered[0].destination, 'ws://near.com')
  })

  test('state preserved across setPads for unchanged pads', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)

    // Initial set
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])
    // Start inside (disarmed, wasInside=true)
    trigger.update([0, 0, 0])
    // Leave (arms)
    trigger.update([10, 0, 10])

    // Rebuild pads with same data — state should be preserved (armed=true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])

    // Re-enter should trigger (pad was armed before rebuild)
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 1, 'should trigger after setPads with unchanged pad')
  })

  test('exact R boundary — inside at R-epsilon, outside at R+epsilon', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])

    // Step 1: start at origin (entry, disarmed)
    trigger.update([0, 0, 0])
    // Step 2: just outside radius — arms
    const justOutside = TELEPORT_TRIGGER_RADIUS + 0.01
    trigger.update([justOutside, 0, 0])
    assert.equal(triggered.length, 0, 'outside should arm, not trigger')

    // Step 3: just inside radius — triggers
    const justInside = TELEPORT_TRIGGER_RADIUS - 0.01
    trigger.update([justInside, 0, 0])
    assert.equal(triggered.length, 1, 'inside R should trigger')
  })

  test('exact H boundary — inside within H, outside beyond H', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])

    // Step 1: start outside horizontally (to arm the pad)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])
    // Start inside (disarmed)
    trigger.update([0, 0, 0])
    // Exit horizontally (arms)
    trigger.update([10, 0, 0])
    assert.equal(triggered.length, 0, 'exit should arm')

    // Re-enter within H (trigger)
    const insideH = TELEPORT_TRIGGER_HEIGHT - 0.1
    trigger.update([0, insideH, 0])
    assert.equal(triggered.length, 1, 'within H should trigger')
    triggered.length = 0

    // Reset, re-arm, re-enter beyond H (no trigger)
    trigger.reset()
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])
    trigger.update([0, 0, 0]) // enter, disarmed
    trigger.update([10, 0, 0]) // exit, armed
    const outsideH = TELEPORT_TRIGGER_HEIGHT + 0.1
    trigger.update([0, outsideH, 0])
    assert.equal(triggered.length, 0, 'beyond H should not trigger')
  })

  test('warn once per pad name per connection', () => {
    const warns = []
    const origWarn = console.warn
    console.warn = (...args) => warns.push(args.join(' '))

    try {
      const triggered = []
      const trigger = createTeleportTrigger({
        onTrigger: (ev) => triggered.push(ev),
        resolveDestination: () => null, // always unresolvable
      })
      trigger.setReady(true)
      trigger.setActive(true)
      trigger.setPads([{ name: 'bad-pad', position: [0, 0, 0], destination: 'ws://bad.com' }])

      // Attempt to trigger — should warn
      trigger.update([0, 0, 0]) // enter (disarmed)
      // Need to arm it first by leaving
      trigger.update([10, 0, 10]) // leave (armed)
      // Now re-enter should attempt trigger and warn
      trigger.update([0, 0, 0])
      assert.equal(warns.length, 1, 'should warn once on first unresolvable trigger')

      // New connection: reset, then pads rebuilt (the order app.js uses)
      trigger.reset() // reset clears inFlight, warned set and pads
      trigger.setPads([{ name: 'bad-pad', position: [0, 0, 0], destination: 'ws://bad.com' }])
      // Re-arm and re-enter
      trigger.update([0, 0, 0]) // enter (disarmed)
      trigger.update([10, 0, 10]) // leave (armed)
      trigger.update([0, 0, 0]) // re-enter
      // After reset(), warned set is cleared, so it should warn again
      assert.equal(warns.length, 2, 'reset clears warned set, so should warn again')
    } finally {
      console.warn = origWarn
    }
  })

  test('inert when not ready', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(false)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])

    trigger.update([0, 0, 0])
    trigger.update([10, 0, 10])
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 0, 'should not trigger when not ready')
  })

  test('inert when inactive', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(false)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])

    trigger.update([0, 0, 0])
    trigger.update([10, 0, 10])
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 0, 'should not trigger when inactive')
  })

  test('inert when in flight', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])

    // Trigger once (arms, then re-enters)
    trigger.update([0, 0, 0]) // enter disarmed
    trigger.update([10, 0, 10]) // leave, arms
    trigger.update([0, 0, 0]) // re-enter, triggers
    assert.equal(triggered.length, 1, 'first trigger works')

    // Try to trigger again while in flight
    trigger.update([10, 0, 10]) // leave (shouldn't change anything while in flight)
    trigger.update([0, 0, 0]) // re-enter (should not trigger — in-flight)
    assert.equal(triggered.length, 1, 'should not trigger again while in flight')
  })

  test('reconnect to the same world — spawn pad starts disarmed again', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    const spawnPad = [{ name: 'spawn-pad', position: [0, 0, 0], destination: 'ws://dest.com' }]
    trigger.setReady(true)
    trigger.setActive(true)

    // First connection: spawn on the pad, walk away (pad arms)
    trigger.setPads(spawnPad)
    trigger.update([0, 0, 0])
    trigger.update([10, 0, 10])

    // Reconnect to the same world (e.g. Go Back after a failed teleport),
    // in app.js order: reset on 'connecting', not ready, pads rebuilt identical
    trigger.setReady(false)
    trigger.reset()
    trigger.setPads(spawnPad)
    trigger.setReady(true)

    // Spawn at the origin, on the pad — must not fire
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 0, 'spawn pad must not fire after reconnect')

    // Normal behavior still works: walk off, walk back on, it fires
    trigger.update([10, 0, 10])
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 1, 'pad fires on a real re-entry')
  })

  test('reactivated while standing on a pad — it does not fire until left and re-entered', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])
    trigger.update([5, 0, 5])                 // outside: arms
    trigger.setActive(false)                  // Edit mode on
    trigger.update([0, 0, 0])                 // walks onto the pad while editing (ignored)
    trigger.setActive(true)                   // Edit mode off, standing on the pad
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 0, 'no teleport on the first frame after editing')
    trigger.update([5, 0, 5])                 // walks off
    trigger.update([0, 0, 0])                 // and back on
    assert.equal(triggered.length, 1, 'fires normally afterwards')
  })

  test('setActive(true) while already active changes nothing', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])
    trigger.update([5, 0, 5])                 // armed
    trigger.setActive(true)                   // no-op
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 1)
  })

  // edit-polish-2, L3/S1/Z5 — a pad restored by a redo. app.js rebuilds the pad
  // list from the world's add/remove events, so after an undo the pad is gone
  // from the list and its redo is NEW to it: it starts disarmed. Standing on its
  // spot when Edit mode turns off must not teleport you away.
  test('removed then restored under the avatar — it does not fire until it is left and re-entered', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    const pad = [{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }]
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads(pad)
    trigger.update([10, 0, 10])               // outside: arms

    trigger.setPads([])                       // undo: the pad (and its zone) goes
    trigger.setPads(pad)                      // redo: it comes back at the same place

    trigger.update([0, 0, 0])                 // the avatar is standing on its spot
    assert.equal(triggered.length, 0, 'a pad restored under the avatar must not fire')

    trigger.update([10, 0, 10])               // walks off — arms it
    trigger.update([0, 0, 0])                 // and back on — fires
    assert.equal(triggered.length, 1, 'fires on a real re-entry')
    assert.equal(triggered[0].name, 'pad-1')
    assert.equal(triggered[0].destination, 'ws://dest.com')
  })

  test('the same when Edit mode off/on (setActive false/true) brackets the return', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    const pad = [{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }]
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads(pad)
    trigger.update([10, 0, 10])               // outside: arms

    trigger.setActive(false)                  // Edit mode on
    trigger.setPads([])                       // the undo
    trigger.setPads(pad)                      // the redo
    trigger.setActive(true)                   // Edit mode off, standing on it

    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 0, 'no teleport on the first frame after editing')

    trigger.update([10, 0, 10])               // steps off
    trigger.update([0, 0, 0])                 // and back on
    assert.equal(triggered.length, 1, 'fires normally afterwards')
  })

  test('reset drops pads — nothing fires until pads are set again', () => {
    const triggered = []
    const trigger = createTeleportTrigger({
      onTrigger: (ev) => triggered.push(ev),
      resolveDestination: (d) => d,
    })
    trigger.setReady(true)
    trigger.setActive(true)
    trigger.setPads([{ name: 'pad-1', position: [0, 0, 0], destination: 'ws://dest.com' }])
    trigger.update([10, 0, 10]) // outside, arms

    trigger.reset()
    trigger.update([0, 0, 0]) // stale pad position — must not fire
    assert.equal(triggered.length, 0, 'no pads after reset')
  })
})

// ===========================================================================
// Z7 (edit-polish-3, L5a) — padNearSpawn: each pad judged by its own world
// position, over the whole subtree
// ===========================================================================

/** A SOM-shaped node: a pad when it carries a destination. */
function node(name, translation, { destination = null, rotation = [0, 0, 0, 1], scale = [1, 1, 1], children = [] } = {}) {
  const parent = { name, translation, rotation, scale, children, parent: null }
  if (destination) parent.extras = { atrium: { teleporter: { destination } } }
  for (const child of children) child.parent = parent
  return parent
}

const PAD = (translation, children = []) => node('pad', translation, { destination: '/worlds/me/room', children })
const CUBE = (translation, children = []) => node('cube', translation, { children })

describe('padNearSpawn (Z7)', () => {
  test('a pad on the spawn point is near, and one just outside it is not', () => {
    assert.equal(nearSpawn([0, 0, 0]), true)
    assert.equal(padNearSpawn(PAD([0, 0, 0]), worldPosition), true)
    assert.equal(padNearSpawn(PAD([20, 0, 20]), worldPosition), false)
    // TELEPORT_TRIGGER_RADIUS + 0.5 = 1.25 is the boundary.
    assert.equal(padNearSpawn(PAD([1.2, 0, 0]), worldPosition), true)
    assert.equal(padNearSpawn(PAD([1.3, 0, 0]), worldPosition), false)
  })

  test('a node with no pad anywhere under it is not near', () => {
    let called = 0
    const count = (n) => { called += 1; return worldPosition(n) }
    assert.equal(padNearSpawn(CUBE([0, 0, 0], [CUBE([0, 0, 0])]), count), false)
    assert.equal(called, 0, 'worldPositionOf is never asked about a node that is not a pad')
    assert.equal(padNearSpawn(null, worldPosition), false)
    assert.equal(padNearSpawn(PAD([0, 0, 0])), false, 'no function: false, never a throw')
  })

  test('a pad under a group is judged by the PAD, not by the group', () => {
    // The group's origin is 10 m out; the child pad sits back on the origin.
    const offset = node('group', [10, 0, 0], { children: [PAD([-10, 0, 0])] })
    assert.equal(nearSpawn(offset.translation), false, 'the group itself is NOT near spawn')
    assert.equal(padNearSpawn(offset, worldPosition), true, 'but its pad is')

    // ...and the other way round: the group is near, its pad is not.
    const away = node('group', [0, 0, 0], { children: [PAD([10, 0, 0])] })
    assert.equal(nearSpawn(away.translation), true, 'the group IS near spawn')
    assert.equal(padNearSpawn(away, worldPosition), false, 'but its pad is not')
  })

  test('a rotation up the chain is composed too', () => {
    // Half a turn about y, 5 m out, with the pad 5 m further along its own z:
    // the pad lands back on the origin while the group's origin is well away.
    const half = [0, 1, 0, 0]
    const group = node('group', [0, 0, 5], { rotation: half, children: [PAD([0, 0, 5])] })
    assert.equal(nearSpawn(group.translation), false, 'the group is 5 m out')
    assert.equal(padNearSpawn(group, worldPosition), true, 'the rotated pad is on the origin')
  })

  test('worldPositionOf is called exactly once per pad', () => {
    const first = PAD([20, 0, 20])
    const second = PAD([0, 0, 0])                   // near: the walk still visits the third
    const third = PAD([20, 0, 20])
    const group = node('group', [0, 0, 0], { children: [first, second, third], extras: undefined })
    const seen = []
    const result = padNearSpawn(group, (n) => { seen.push(n.name); return worldPosition(n) })
    assert.equal(result, true)
    assert.equal(seen.length, 3, `expected one call per pad, got ${seen.length}`)
  })

  test('the search goes right down the tree', () => {
    const deep = node('group', [20, 0, 20], { children: [CUBE([0, 0, 0], [node('nested', [0, 0, 0], { children: [PAD([-20, 0, -20])] })])] })
    assert.equal(padNearSpawn(deep, worldPosition), true, 'a pad three levels down still counts')
  })
})
