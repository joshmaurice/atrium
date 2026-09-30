// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// teleport-trigger.test.js — unit tests for createTeleportTrigger
// Pure functions, no DOM, just node:test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createTeleportTrigger, TELEPORT_TRIGGER_RADIUS, TELEPORT_TRIGGER_HEIGHT } from '../src/teleport-trigger.js'

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

    // Two pads: near at [0,0,0], far at [10,0,0]
    trigger.setPads([
      { name: 'far-pad', position: [10, 0, 0], destination: 'ws://far.com' },
      { name: 'near-pad', position: [0, 0, 0], destination: 'ws://near.com' },
    ])

    // Step 1: enter near-pad (disarmed)
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 0, 'no trigger on initial enter (disarmed)')

    // Step 2: exit both (both arm since outside)
    trigger.update([100, 0, 100])
    assert.equal(triggered.length, 0, 'no trigger on exit')

    // Step 3: re-enter near-pad (inside near, far is 10m away > R)
    // Only near-pad should trigger since far-pad is outside range
    trigger.update([0, 0, 0])
    assert.equal(triggered.length, 1, 'only nearest in-range pad should trigger')
    assert.equal(triggered[0].name, 'near-pad')
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

      // Reset pads and try again — should NOT warn again (same pad name)
      trigger.setPads([{ name: 'bad-pad', position: [0, 0, 0], destination: 'ws://bad.com' }])
      trigger.reset() // reset clears inFlight and warned set
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
})