// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-listeners.test.js — models-by-url step 7 (A11): the diagnostic pointer
// listeners are added once per SOM node, however often `world:loaded` repeats.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDiagnosticListeners, DIAGNOSTIC_EVENTS } from '../src/model-listeners.js'

/** A SOM node stand-in that counts the listeners added to it. */
function fakeNode(name, { ephemeral = false } = {}) {
  const listeners = []
  return {
    name,
    ephemeral,
    extras: ephemeral ? { atrium: { ephemeral: true } } : {},
    get count() { return listeners.length },
    events() { return listeners.map((l) => l.type) },
    addEventListener(type, fn) { listeners.push({ type, fn }) },
    dispatch(type, detail = {}) { for (const l of listeners) if (l.type === type) l.fn({ detail }) },
  }
}

test('A11: every node gets the five listeners, and a repeat world:loaded adds none', () => {
  const lines = []
  const listeners = createDiagnosticListeners({ log: (...args) => lines.push(args.join(' ')) })
  const chair = fakeNode('Chair')
  const som = { nodes: [chair] }

  assert.equal(listeners.registerAll(som), 1)
  assert.deepEqual(chair.events(), [...DIAGNOSTIC_EVENTS])

  // An external ref's world:loaded repeats the event on the SAME SOM.
  assert.equal(listeners.registerAll(som), 0, 'nothing was added the second time')
  assert.equal(chair.count, DIAGNOSTIC_EVENTS.length, 'still exactly five listeners')

  listeners.registerAll(som)
  listeners.registerAll(som)
  assert.equal(chair.count, DIAGNOSTIC_EVENTS.length)
})

test('A11: avatars are skipped, and a new node is wired on the next pass', () => {
  const listeners = createDiagnosticListeners({ log: () => {} })
  const avatar = fakeNode('Avatar', { ephemeral: true })
  const chair = fakeNode('Chair')
  const som = { nodes: [chair, avatar] }

  listeners.registerAll(som)
  assert.equal(avatar.count, 0, 'an ephemeral node gets nothing')

  const bench = fakeNode('Bench')
  som.nodes.push(bench)
  assert.equal(listeners.registerAll(som), 1, 'the new node is the only one wired')
  assert.equal(bench.count, DIAGNOSTIC_EVENTS.length)
})

test('A11: the diagnostics still log what they always logged', () => {
  const lines = []
  const listeners = createDiagnosticListeners({ log: (...args) => lines.push(args.join(' ')) })
  const chair = fakeNode('Chair')
  listeners.register(chair)

  chair.dispatch('pointerover')
  chair.dispatch('pointerout')
  chair.dispatch('pointerdown', { button: 2 })
  chair.dispatch('pointerup')
  chair.dispatch('click', { point: [1, 2, 3] })

  assert.deepEqual(lines, [
    '[pointer] over Chair',
    '[pointer] out Chair',
    '[pointer] down Chair button 2',
    '[pointer] up Chair',
    '[pointer] click Chair at 1,2,3',
  ])
})

test('A11: a node without addEventListener is left alone', () => {
  const listeners = createDiagnosticListeners({ log: () => {} })
  assert.equal(listeners.register(null), false)
  assert.equal(listeners.register({ name: 'NoDom' }), false)
})
