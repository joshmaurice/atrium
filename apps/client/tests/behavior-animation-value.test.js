// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behavior-animation-value.test.js — scripting-4b-2 round 5, V3.
//
// Every animation value the RUNNER enqueues, for all three animation templates,
// play and stop, must be one the server accepts: `@atrium/client/animation-spec`
//'s `animationValueProblem`. Round 4's runner sent four keys and the server
// refused "extras.atrium.animation must have exactly the keys clip, playing,
// loop, speed and startedAt", which broke interval, select and proximity
// animation — and nothing said so anywhere.
//
// This test needs BOTH packages, so it lives in `apps/client`.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createBehaviorRunner } from '@atrium/behaviors/runner'
import { templateGraph } from '@atrium/behaviors/templates'
import { animationValueProblem, ANIMATION_KEYS } from '@atrium/client/animation-spec'
import { clipsFor } from '../src/behavior-clips.js'

const OWN = '11111111-1111-4111-8111-111111111111'
const AVATAR = '44444444-4444-4444-8444-444444444444'

/** The client port the runner needs: events, the role flags and the two leaves. */
function makeClient(nodes) {
  const listeners = new Map()
  const sent = []
  const animations = []
  return {
    som: {
      nodes,
      getNodeByName: (name) => nodes.find((n) => n.name === name) ?? null,
      resolveObjectId: (id) => {
        const hits = nodes.filter((n) => n.extras?.atrium?.objectId === id)
        if (hits.length === 0) return { problem: 'not-found' }
        if (hits.length > 1) return { problem: 'ambiguous' }
        return { node: hits[0], objectId: id, name: hits[0].name }
      },
    },
    scriptHost: { active: true, hostGen: 1 },
    canEdit: true,
    sent,
    animations,
    on(type, fn) { (listeners.get(type) ?? listeners.set(type, []).get(type)).push(fn) },
    off() {},
    emit(type, payload) { for (const fn of [...(listeners.get(type) ?? [])]) fn(payload) },
    sendField(name, field, value) { sent.push({ name, field, value }); return sent.length },
    setModelAnimation(name, value) { animations.push({ name, value }); return animations.length },
  }
}

function makeNode({ name, id = null, behavior, model = null, ephemeral = false } = {}) {
  return {
    name,
    parent: null,
    translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], visible: true,
    light: null,
    extras: { atrium: { ...(id ? { objectId: id } : {}), ...(model ? { model } : {}), ...(behavior === undefined ? {} : { behavior }), ...(ephemeral ? { ephemeral: true } : {}) } },
  }
}

/** A runner over a fake client, with the role already granted and a world loaded. */
function setup(nodes) {
  const client = makeClient(nodes)
  const state = { clock: 0 }
  const runner = createBehaviorRunner({
    client, now: () => state.clock, position: (node) => node?.translation,
  })
  client.emit('world:loaded', { name: 'w' })
  client.emit('script-host:changed', { active: true, hostGen: 1 })
  return { client, runner, state }
}

const runOnce = ({ runner, state }) => {
  runner.tick()                       // the graph runs
  state.clock += 100                  // the next opportunity
  runner.tick()
}

test('V3 — select-animation: play is 4a\'s five keys, stop is null', () => {
  for (const action of ['play', 'stop']) {
    const value = templateGraph('select-animation', { target: OWN, clip: 'Idle', action, loop: true }, { ownId: OWN })
    const node = makeNode({ name: 'foz', id: OWN, behavior: value })
    const { client, runner, state } = setup([node])
    runner.select(node)
    runOnce({ runner, state })

    assert.equal(client.animations.length, 1, `${action}: one animation send`)
    const sent = client.animations[0].value
    if (action === 'play') {
      assert.deepEqual(Object.keys(sent), [...ANIMATION_KEYS], 'the keys are 4a\'s, in 4a\'s order')
      assert.equal(animationValueProblem(sent), null, 'the server would accept it')
    } else {
      assert.equal(sent, null, 'Stop is the null value')
    }
  }
})

test('V3 — proximity-animation: enter plays, exit stops', () => {
  const value = templateGraph('proximity-animation', { target: OWN, clip: 'Idle', loop: true, radius: 3 }, { ownId: OWN })
  const node = makeNode({ name: 'foz', id: OWN, behavior: value })
  const avatar = makeNode({ name: 'avatar-1', id: AVATAR, ephemeral: true })
  const { client, runner, state } = setup([node, avatar])

  runOnce({ runner, state })                         // the avatar is inside → enter
  assert.equal(client.animations.length, 1, 'enter played')
  assert.equal(animationValueProblem(client.animations[0].value), null, 'the server would accept it')

  avatar.translation = [50, 0, 0]                    // the avatar walks away → exit
  runOnce({ runner, state })
  assert.equal(client.animations.length, 2)
  assert.equal(client.animations[1].value, null, 'exit stopped it')
})

test('V3 — interval-animation: the adapter\'s own timer plays, and the value is 4a\'s', async () => {
  const value = templateGraph('interval-animation', { target: OWN, clip: 'Idle', loop: true, seconds: 1 }, { ownId: OWN })
  const node = makeNode({ name: 'foz', id: OWN, behavior: value })
  const { client, runner, state } = setup([node])

  // The interval timer is the adapter's own, with the real clock: F1's floor is
  // one second, so this is the shortest wait the contract allows.
  const deadline = Date.now() + 3000
  while (client.animations.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    state.clock += 100
    runner.tick()
  }
  assert.equal(client.animations.length, 1, 'the interval fired')
  const sent = client.animations[0].value
  assert.deepEqual(Object.keys(sent), [...ANIMATION_KEYS])
  assert.equal(animationValueProblem(sent), null, 'the server would accept it')
  runner.dispose()
})

// ── V5 — the adapter's clip check, end to end through `clipsFor` ───────────

test('V5 — a clip that is not on a LOADED model is refused, and nothing is sent', () => {
  // The picker's list and the adapter's check are the same source (V5), so this
  // runs 4a's `status` shape through `clipsFor` and the real runner.
  const value = templateGraph('select-animation', { target: OWN, clip: 'Walk', action: 'play', loop: true }, { ownId: OWN })
  const node = makeNode({ name: 'foz', id: OWN, behavior: value, model: { url: 'a.glb' } })
  const client = makeClient([node])
  const state = { clock: 0 }
  const runner = createBehaviorRunner({
    client,
    now: () => state.clock,
    position: (n) => n?.translation,
    clips: (objectId) => clipsFor(objectId, {
      resolveObjectId: (id) => client.som.resolveObjectId(id),
      modelAnimations: { status: () => ({ clips: ['Idle'], state: 'stopped' }) },
    }),
  })
  client.emit('world:loaded', { name: 'w' })
  client.emit('script-host:changed', { active: true, hostGen: 1 })

  runner.select(node)
  runOnce({ runner, state })
  assert.equal(client.animations.length, 0, 'the clip is not on the model: nothing was sent')
  assert.ok(runner.log.some((l) => l.message.includes('Walk')), `the log says why: ${JSON.stringify(runner.log)}`)

  // The same graph with a clip the model HAS goes out.
  node.extras.atrium.behavior = templateGraph('select-animation', { target: OWN, clip: 'Idle', action: 'play', loop: true }, { ownId: OWN })
  client.emit('som:set', { nodeName: 'foz', path: 'extras.atrium.behavior', value: node.extras.atrium.behavior })
  runner.select(node)
  runOnce({ runner, state })
  assert.equal(client.animations.length, 1, 'a real clip is sent')
  runner.dispose()
})
