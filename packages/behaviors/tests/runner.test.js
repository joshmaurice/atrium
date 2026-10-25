// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// runner.test.js — scripting-4b-2 step 4, F5. A fake client, a controllable
// clock, no DOM, no Three.js, no real timers.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { createBehaviorRunner, SEND_FRAME_MS, SEND_KEYS_MAX, LOG_LINES_MAX } from '../src/runner.js'
import { templateGraph } from '../src/templates.js'
import { OWN, TGT } from './fake-world.mjs'
import { makeFakeClient, makeNode, nextId } from './fake-client.mjs'

const hide = (ownId, target = TGT) => templateGraph('select-visibility', { target, action: 'hide' }, { ownId })

/** A runner over a fresh clock, with the role already granted and a world loaded. */
function setup({ nodes = [], grant = true, loadWorld = true, options = {} } = {}) {
  // Every template's nodeMap carries its target, so the fake SOM gets one.
  if (!nodes.some((n) => n.extras?.atrium?.objectId === TGT)) nodes = [...nodes, makeNode({ name: 'target', id: TGT })]
  const client = makeFakeClient({ nodes })
  const state = { clock: 0 }
  const runner = createBehaviorRunner({ client, now: () => state.clock, ...options })
  if (grant) client.scriptHost = { active: true, hostGen: 1 }
  client.canEdit = true
  if (loadWorld) { client.emit('world:loaded', { name: 'w' }) }
  client.emit('script-host:changed', { active: grant, hostGen: 1 })
  return { client, runner, state }
}

describe('F5 — the runner is enabled only with the role, canEdit and a loaded world', () => {
  test('no role: not enabled, no engine', () => {
    const client = makeFakeClient({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })] })
    const runner = createBehaviorRunner({ client, now: () => 0 })
    client.canEdit = true
    client.emit('world:loaded', { name: 'w' })
    assert.equal(runner.enabled, false)
    assert.equal(runner.engines.size, 0)
  })

  test('role and world, but no canEdit: not enabled', () => {
    const client = makeFakeClient({ nodes: [] })
    const runner = createBehaviorRunner({ client, now: () => 0 })
    client.scriptHost = { active: true, hostGen: 1 }
    client.emit('world:loaded', { name: 'w' })
    assert.equal(runner.enabled, false)
  })

  test('role and canEdit, but no loaded world: not enabled; the world then loads and it is', () => {
    const client = makeFakeClient({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })] })
    const runner = createBehaviorRunner({ client, now: () => 0 })
    client.scriptHost = { active: true, hostGen: 1 }
    client.canEdit = true
    client.emit('script-host:changed', { active: true, hostGen: 1 })
    assert.equal(runner.enabled, false)
    client.emit('world:loaded', { name: 'w' })
    assert.equal(runner.enabled, true)
    assert.equal(runner.engines.size, 1)
  })

  test('active: false disposes every engine SYNCHRONOUSLY and drops every pending send', () => {
    const { client, runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })] })
    assert.equal(runner.engines.size, 1)
    runner.enqueue(TGT, 'node', 'visible', false)
    assert.equal(runner.queue.size, 1)
    client.scriptHost = { active: false, hostGen: 1 }
    client.emit('script-host:changed', { active: false, hostGen: 1 })
    assert.equal(runner.engines.size, 0, 'disposed in the same tick as the event')
    assert.equal(runner.queue.size, 0)
  })

  test('connecting and disconnected both drop the world-loaded state', () => {
    const { client, runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })] })
    client.emit('connecting', {})
    assert.equal(runner.enabled, false)
    assert.equal(runner.engines.size, 0)
  })
})

describe('F5 — loading, reloading and the disabled reasons', () => {
  test('a behaviour with enabled: false is loaded as `disabled`, with no engine', () => {
    const value = { ...hide(OWN), enabled: false }
    const { runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: value })] })
    assert.equal(runner.engines.get('crate').engine, null)
    assert.equal(runner.engines.get('crate').reason, 'disabled')
  })

  test('an invalid value is disabled with `invalid: <code>`', () => {
    const value = { ...hide(OWN), kind: 'js' }
    const { runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: value })] })
    assert.equal(runner.engines.get('crate').reason, 'invalid: behavior-kind')
  })

  test('nodeMap[0] that does not resolve disables it with `not-found`', () => {
    const node = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    delete node.extras.atrium.objectId          // the node lost its id: F1 cannot police nodeMap[0]
    const { runner } = setup({ nodes: [node] })
    assert.equal(runner.engines.get('crate').reason, 'not-found')
  })

  test('a target that does not resolve disables it with `target-not-found: <index>` at load', () => {
    const value = hide(OWN, nextId())
    const { runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: value })] })
    assert.equal(runner.engines.get('crate').reason, 'target-not-found: 1')
  })

  test('a graph the ENGINE would reject is disabled at the F1 stage (see the handoff)', () => {
    // F1 runs `validateInteractivityGraph` before the engine ever loads, so a
    // stored value can never reach the adapter's own `rejected:` path. The
    // runner is therefore disabled with `invalid:`, and the adapter's
    // `rejected:` path is exercised directly in adapter.test.js.
    const value = hide(OWN)
    value.graph.nodes[1].declaration = 99
    const { runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: value })] })
    assert.equal(runner.engines.get('crate').reason, 'invalid: behavior-graph')
  })

  test('a reload on som:set of the leaf is dispose-then-create', () => {
    const node = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [node] })
    const first = runner.engines.get('crate').engine
    assert.ok(first)
    node.extras.atrium.behavior = hide(OWN)      // the same shape, a NEW value object
    client.emit('som:set', { nodeName: 'crate', path: 'extras.atrium.behavior', value: node.extras.atrium.behavior })
    const second = runner.engines.get('crate').engine
    assert.ok(second)
    assert.notEqual(second, first, 'a NEW engine, never loadBehaveGraph in place')
    assert.equal(first.disposed, true, 'the old engine was disposed')
  })

  test('a som:set of the leaf to null disposes the engine and keeps no record', () => {
    const node = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [node] })
    node.extras.atrium.behavior = null
    client.emit('som:set', { nodeName: 'crate', path: 'extras.atrium.behavior', value: null })
    assert.equal(runner.engines.has('crate'), false)
  })

  test('a som:remove disposes the engine', () => {
    const node = makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })
    const { client, runner } = setup({ nodes: [node] })
    client.som.nodes.length = 0
    client.emit('som:remove', { nodeName: 'crate' })
    assert.equal(runner.engines.size, 0)
  })

  test('avatars are never scanned', () => {
    const avatar = makeNode({ name: 'avatar-1', id: nextId(), behavior: hide(nextId()), ephemeral: true })
    const { runner } = setup({ nodes: [avatar] })
    assert.equal(runner.engines.size, 0)
  })

  test('three rapid world switches leave no engine alive', () => {
    const { client, runner } = setup({ nodes: [makeNode({ name: 'crate', id: OWN, behavior: hide(OWN) })] })
    for (let i = 0; i < 3; i++) {
      client.emit('connecting', {})
      client.emit('world:loaded', { name: `w${i}` })
    }
    assert.equal(runner.engines.size, 1, 'the last world owns the one engine')
    client.emit('disconnected', {})
    assert.equal(runner.engines.size, 0)
  })
})

describe('F5 — coalescing and the rate (Rev 2, M1)', () => {
  test('30 writes to one field in one frame send ONCE', () => {
    const { client, runner } = setup({ nodes: [makeNode({ name: 'crate', id: TGT })] })
    for (let i = 0; i < 30; i++) runner.enqueue(TGT, 'node', 'visible', i % 2 === 0)
    assert.equal(runner.queue.size, 1, 'one key')
    runner.tick()
    assert.equal(client.sent.length, 1)
    assert.deepEqual(client.sent[0], { call: 'sendField', name: 'crate', field: 'visible', value: false },
      'the LAST write to the key wins')
  })

  test('25 distinct keys go out one per 50 ms, the last at 1,200 ms', () => {
    const nodes = Array.from({ length: 25 }, (_, i) => makeNode({ name: `n${i}`, id: nextId() }))
    const { client, runner, state } = setup({ nodes })
    for (const node of nodes) runner.enqueue(node.extras.atrium.objectId, 'node', 'visible', false)
    assert.equal(runner.queue.size, 25)
    const times = []
    for (let t = 0; t <= 1200; t += SEND_FRAME_MS) {
      state.clock = t
      const before = client.sent.length
      runner.tick()
      for (let i = before; i < client.sent.length; i++) times.push(t)
    }
    assert.equal(client.sent.length, 25)
    assert.equal(times[24], 1200, 'the last key leaves at 1,200 ms')
    assert.deepEqual([...new Set(times)].length, 25, 'one per opportunity')
  })

  test('under sustained pressure, 2 s of rewrites leaves exactly 40 sends', () => {
    const nodes = Array.from({ length: SEND_KEYS_MAX }, (_, i) => makeNode({ name: `n${i}`, id: nextId() }))
    const { client, runner, state } = setup({ nodes })
    for (let t = 0; t < 2000; t += 25) {
      state.clock = t
      for (const node of nodes) runner.enqueue(node.extras.atrium.objectId, 'node', 'visible', (t % 32) === 0)
      runner.tick()
    }
    assert.equal(client.sent.length, 40, 'one send per 50 ms, a RATE — not twenty keys per flush')
  })

  test('a later write to a queued key replaces its value and keeps its place', () => {
    const a = makeNode({ name: 'a', id: nextId() })
    const b = makeNode({ name: 'b', id: nextId() })
    const { client, runner } = setup({ nodes: [a, b] })
    runner.enqueue(a.extras.atrium.objectId, 'node', 'visible', false)
    runner.enqueue(b.extras.atrium.objectId, 'node', 'visible', false)
    runner.enqueue(a.extras.atrium.objectId, 'node', 'visible', true)
    runner.tick()
    assert.equal(client.sent[0].name, 'a')
    assert.equal(client.sent[0].value, true)
    assert.equal(runner.queue.size, 1)
  })

  test('disposing one engine drops only its entries (S3)', () => {
    const a = makeNode({ name: 'a', id: nextId(), behavior: hide(nextId()) })
    const b = makeNode({ name: 'b', id: nextId(), behavior: hide(nextId()) })
    const { client, runner } = setup({ nodes: [a, b] })
    runner.enqueue(a.extras.atrium.behavior.nodeMap[0], 'node', 'visible', false, a.extras.atrium.objectId)
    runner.enqueue(b.extras.atrium.behavior.nodeMap[0], 'node', 'visible', false, b.extras.atrium.objectId)
    assert.equal(runner.queue.size, 2)
    a.extras.atrium.behavior = null
    client.emit('som:set', { nodeName: 'a', path: 'extras.atrium.behavior', value: null })
    assert.equal(runner.queue.size, 1, 'only b\'s entry survives')
  })

  test('the 101st key is refused', () => {
    const nodes = Array.from({ length: SEND_KEYS_MAX + 1 }, (_, i) => makeNode({ name: `n${i}`, id: nextId() }))
    const { runner } = setup({ nodes })
    let refused = 0
    for (const node of nodes) if (runner.enqueue(node.extras.atrium.objectId, 'node', 'visible', false) === false) refused++
    assert.equal(refused, 1)
    assert.equal(runner.queue.size, SEND_KEYS_MAX)
  })

  test('a rename between enqueue and flush sends to the NEW name (S6)', () => {
    const node = makeNode({ name: 'old-name', id: TGT })
    const { client, runner } = setup({ nodes: [node] })
    runner.enqueue(TGT, 'node', 'visible', false)
    node.name = 'new-name'
    runner.tick()
    assert.equal(client.sent[0].name, 'new-name')
  })

  test('a key whose target no longer resolves is dropped and logged', () => {
    const node = makeNode({ name: 'gone', id: TGT })
    const { client, runner } = setup({ nodes: [node] })
    runner.enqueue(TGT, 'node', 'visible', false)
    client.som.nodes.length = 0                  // the same array the resolver closed over
    runner.tick()
    assert.equal(client.sent.length, 0)
    assert.equal(runner.log.some((l) => l.message.includes('no longer resolves')), true)
  })
})

describe('F5 — the drag rule (F-L5)', () => {
  test('sends to the edited node, its child and its parent are dropped and logged once', () => {
    const parent = makeNode({ name: 'parent', id: nextId() })
    const crate = makeNode({ name: 'crate', id: nextId(), parent })
    const child = makeNode({ name: 'crate/child', id: nextId(), parent: crate })
    const other = makeNode({ name: 'other', id: nextId() })
    const { client, runner } = setup({ nodes: [parent, crate, child, other] })

    runner.setGesture('crate')
    runner.enqueue(crate.extras.atrium.objectId, 'node', 'visible', false)
    runner.enqueue(child.extras.atrium.objectId, 'node', 'visible', false)
    runner.enqueue(parent.extras.atrium.objectId, 'node', 'visible', false)
    runner.enqueue(other.extras.atrium.objectId, 'node', 'visible', false)
    assert.equal(runner.queue.size, 1, 'only the unrelated node is queued')
    assert.equal(runner.log.filter((l) => l.message.includes('dropped')).length, 1, 'logged once per gesture')

    runner.setGesture(null)
    client.sent.length = 0
    runner.tick()
    assert.equal(client.sent.length, 1)
    assert.equal(client.sent[0].name, 'other')
    assert.equal(runner.queue.size, 0, 'nothing is replayed when the gesture ends')
  })
})

describe('F5 — select comes from the viewport click, through the SOM walk', () => {
  test('select on a placed object\'s inner node reaches the behaviour on the placed object', () => {
    const placed = makeNode({ name: 'foz', id: OWN, behavior: hide(OWN) })
    const inner = makeNode({ name: 'foz/inner', id: nextId(), parent: placed })
    const { client, runner } = setup({ nodes: [placed, inner] })
    runner.select(inner)
    runner.tick()
    assert.equal(client.sent.length, 1, 'the onSelect flow ran')
  })

  test('select on an unrelated node does nothing', () => {
    const placed = makeNode({ name: 'foz', id: OWN, behavior: hide(OWN) })
    const other = makeNode({ name: 'other', id: nextId() })
    const { client, runner } = setup({ nodes: [placed, other] })
    runner.select(other)
    runner.tick()
    assert.equal(client.sent.length, 0)
  })
})

describe('F5 — the log ring', () => {
  test('keeps the last 50 lines and emits an `entry` event', () => {
    const nodes = Array.from({ length: LOG_LINES_MAX + 10 }, (_, i) =>
      makeNode({ name: `bad-${i}`, id: nextId(), behavior: { ...hide(nextId()), kind: 'js' } }))
    const client = makeFakeClient({ nodes })
    const runner = createBehaviorRunner({ client, now: () => 0 })
    const seen = []
    runner.addEventListener('entry', (e) => seen.push(e.detail))
    client.scriptHost = { active: true, hostGen: 1 }
    client.canEdit = true
    client.emit('world:loaded', { name: 'w' })
    client.emit('script-host:changed', { active: true, hostGen: 1 })
    assert.equal(runner.log.length, LOG_LINES_MAX, 'the ring is capped')
    assert.equal(seen.length, LOG_LINES_MAX + 10, 'every line is an `entry` event')
    assert.equal(typeof runner.log[0].message, 'string')
    assert.equal(typeof runner.log[0].time, 'number')
  })
})
