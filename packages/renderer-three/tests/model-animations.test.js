// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-animations.test.js — scripting-4a step 4 (Z5).
//
// Real three.js `AnimationClip`s on real `Object3D`s, driven through the real
// `buildInstance` retarget, a fake bridge and an injected clock. Every assertion
// is on THE OBJECT'S OWN VALUES — a computed time can be right while the scene
// shows the wrong frame (that is exactly why P12's probe and (e)/(e2)/(e4) exist).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Object3D, AnimationClip, VectorKeyframeTrack, LoopOnce } from 'three'
import { buildInstance } from '../src/model-instances.js'
import { createModelAnimations, ANIMATION_STATE } from '../src/model-animations.js'

// ---------------------------------------------------------------------------
// Fixtures: a template with one part called `Part`, and clips that move it
// ---------------------------------------------------------------------------

/** A clip that moves `Part.position.x` from `from` to `to` over `duration`. */
function makeClip(name, duration, from, to, target = 'Part') {
  return new AnimationClip(name, duration, [
    new VectorKeyframeTrack(`${target}.position`, [0, duration], [from, 0, 0, to, 0, 0]),
  ])
}

/**
 * A real instance whose clips are the ones given: `from0` is the loaded value of
 * the part, so a Stop that restores can be told from one that shows frame 0.
 */
function makeInstance(clips) {
  const scene = new Object3D()
  const part = new Object3D()
  part.name = 'Part'
  scene.add(part)
  return buildInstance({ scene, animations: clips })
}

const partOf = (instance) => {
  let found = null
  instance.scene.traverse((object) => { if (!found && object.userData.atriumModelName === 'Part') found = object })
  return found
}

/** The layer, a clock the test drives, and one instance registered under `Fox`. */
function makeLayer(clips, { name = 'Fox', loaded = 0 } = {}) {
  const instance = makeInstance(clips)
  const part = partOf(instance)
  part.position.set(loaded, 0, 0)
  let clock = 0
  const animations = createModelAnimations({ now: () => clock })
  animations.onInstanceCreated({ name, node: { name }, instance })
  return {
    animations,
    instance,
    part,
    node: { name },
    setClock: (value) => { clock = value },
    /** One frame, with the app's `update()` before `stage.tick`. */
    frame: () => animations.update(),
  }
}

const PLAYING = (clip, over = {}) => ({ clip, playing: true, loop: false, speed: 1, startedAt: 0, ...over })

// ===========================================================================
// The action contract (P12)
// ===========================================================================

test('Z5: every action is LoopOnce with clamping — the mixer never decides', () => {
  // P12: the defaults are LoopRepeat with clampWhenFinished false, and a real
  // delta (or a later three.js) can wrap or disable a clip at its end. The rule
  // is therefore pinned on the action itself, not only on the poses it happens to
  // hold under `update(0)`.
  const h = makeLayer([makeClip('Survey', 2, 0, 10)])
  h.animations.set('Fox', PLAYING('Survey', { startedAt: 1_000_000 }))
  const action = h.animations.actionFor('Fox')
  assert.ok(action, 'an action was made')
  assert.equal(action.loop, LoopOnce, 'LoopOnce, never the default LoopRepeat')
  assert.equal(action.repetitions, 1)
  assert.equal(action.clampWhenFinished, true, 'and it clamps at the end')
})

test('Z5: a once clip past its duration holds the last pose, on the object itself', () => {
  const h = makeLayer([makeClip('Survey', 2, 0, 10)])
  h.animations.set('Fox', PLAYING('Survey', { startedAt: 1_000_000 }))

  h.setClock(1_000_000); h.frame()
  assert.equal(h.part.position.x, 0, 'it starts at the clip’s first frame')
  h.setClock(1_001_000); h.frame()
  assert.equal(h.part.position.x, 5, 'half way through')
  h.setClock(1_002_000); h.frame()
  assert.equal(h.part.position.x, 10, 'clamped at the duration')
  h.setClock(1_060_000); h.frame()
  assert.equal(h.part.position.x, 10, 'and it stays there — a minute later too')
  assert.equal(h.animations.status('Fox').state, ANIMATION_STATE.ended)
})

test('Z5: a late-created instance of an already-ended clip shows the last pose at once', () => {
  const clips = [makeClip('Survey', 2, 0, 10)]
  const instance = makeInstance(clips)
  const part = partOf(instance)
  const animations = createModelAnimations({ now: () => 1_060_000 })
  animations.set('Fox', PLAYING('Survey', { startedAt: 1_000_000 }))   // set BEFORE the load

  assert.equal(part.position.x, 0, 'nothing plays before there is an instance')
  animations.onInstanceCreated({ name: 'Fox', node: { name: 'Fox' }, instance })

  assert.equal(part.position.x, 10, 'the first frame a late joiner renders is the right one')
  assert.equal(animations.status('Fox').state, ANIMATION_STATE.ended)
})

test('Z5: a looping clip past its duration shows the wrapped pose', () => {
  const h = makeLayer([makeClip('Run', 2, 0, 10)])
  h.animations.set('Fox', PLAYING('Run', { loop: true, startedAt: 1_000_000 }))

  h.setClock(1_000_500); h.frame()
  assert.equal(h.part.position.x, 2.5, 'half a second in')
  h.setClock(1_003_000); h.frame()
  assert.equal(h.part.position.x, 5, 'three seconds in is one second into the second loop')
  h.setClock(1_004_000); h.frame()
  assert.equal(h.part.position.x, 0, 'and four seconds in is the loop’s start')
  assert.equal(h.animations.status('Fox').state, ANIMATION_STATE.playing)
})

test('Z5: speed scales the time the object is shown at', () => {
  const h = makeLayer([makeClip('Run', 10, 0, 10)])
  h.animations.set('Fox', PLAYING('Run', { speed: 2, startedAt: 1_000_000 }))
  h.setClock(1_001_000); h.frame()
  assert.equal(h.part.position.x, 2, 'one second at 2x is two seconds of clip')
})

// ===========================================================================
// Stop is `action.stop()` alone (P12, e4)
// ===========================================================================

test('Z5: Stop restores the loaded rest pose, not the clip’s first frame', () => {
  // The distinguishing case from the brief: the object is loaded at x = 0 and the
  // clip runs 5 → 10. `action.stop()` gives x = 0; reset() + update(0) gives 5.
  const h = makeLayer([makeClip('Leap', 2, 5, 10)], { loaded: 0 })
  h.animations.set('Fox', PLAYING('Leap', { startedAt: 1_000_000 }))
  h.setClock(1_001_000); h.frame()
  assert.equal(h.part.position.x, 7.5, 'it is playing')

  h.animations.set('Fox', null)                 // Stop
  h.frame()
  assert.equal(h.part.position.x, 0, 'the loaded pose, never the clip’s first frame (5)')
  assert.equal(h.animations.status('Fox').state, ANIMATION_STATE.stopped)
  assert.equal(h.animations.actionFor('Fox').isRunning(), false, 'and the action is stopped')
})

test('Z5: Stop from the ended state restores the rest pose too', () => {
  const h = makeLayer([makeClip('Leap', 2, 5, 10)], { loaded: 0 })
  h.animations.set('Fox', PLAYING('Leap', { startedAt: 1_000_000 }))
  h.setClock(1_060_000); h.frame()
  assert.equal(h.part.position.x, 10, 'ended on the last frame')

  h.animations.set('Fox', null)
  h.frame()
  assert.equal(h.part.position.x, 0, 'back to rest')
})

// ===========================================================================
// `set` is idempotent (review 7)
// ===========================================================================

test('Z5: set with a deep-equal value creates no action and restarts nothing', () => {
  const h = makeLayer([makeClip('Walk', 10, 0, 10)])
  h.animations.set('Fox', PLAYING('Walk', { loop: true, startedAt: 1_000_000 }))
  h.setClock(1_003_000); h.frame()
  assert.equal(h.part.position.x, 3)

  const mixer = h.animations.mixerFor('Fox')
  const action = h.animations.actionFor('Fox')
  let clipActionCalls = 0
  const realClipAction = mixer.clipAction.bind(mixer)
  mixer.clipAction = (clip) => { clipActionCalls += 1; return realClipAction(clip) }

  h.animations.set('Fox', PLAYING('Walk', { loop: true, startedAt: 1_000_000 }))   // a fresh, equal object
  assert.equal(clipActionCalls, 0, 'no action was created')
  assert.equal(h.animations.actionFor('Fox'), action, 'and the action is the same one')
  assert.equal(action.time, 3, 'its time was NOT reset — nothing restarted')

  h.setClock(1_004_000); h.frame()
  assert.equal(h.part.position.x, 4, 'and the clock still drives it')
})

test('Z5: a changed value re-targets the action, and the clip restarts', () => {
  const h = makeLayer([makeClip('Walk', 10, 0, 10)])
  h.animations.set('Fox', PLAYING('Walk', { loop: true, startedAt: 1_000_000 }))
  h.setClock(1_003_000); h.frame()
  assert.equal(h.part.position.x, 3)
  assert.equal(h.animations.actionFor('Fox').time, 3)

  h.animations.set('Fox', PLAYING('Walk', { loop: true, startedAt: 1_005_000 }))
  assert.equal(h.animations.actionFor('Fox').time, 0, 'a new startedAt is a restart')

  h.setClock(1_006_000); h.frame()
  assert.equal(h.part.position.x, 1, 'and it runs from the new start')
})

// ===========================================================================
// The three lifecycle events
// ===========================================================================

test('Z5: onInstanceRehosted keeps the same mixer and action', () => {
  const h = makeLayer([makeClip('Walk', 10, 0, 10)])
  h.animations.set('Fox', PLAYING('Walk', { loop: true, startedAt: 1_000_000 }))
  h.setClock(1_003_000); h.frame()

  const mixer = h.animations.mixerFor('Fox')
  const action = h.animations.actionFor('Fox')
  const x = h.part.position.x

  h.animations.onInstanceRehosted({ name: 'Fox', node: h.node, instance: h.instance })
  assert.equal(h.animations.mixerFor('Fox'), mixer, 'the same mixer')
  assert.equal(h.animations.actionFor('Fox'), action, 'the same action, not restarted')
  assert.equal(h.part.position.x, x, 'and nothing moved')

  h.setClock(1_004_000); h.frame()
  assert.equal(h.part.position.x, 4, 'the next update sets the time as usual')
})

test('Z5: onInstanceDisposing stops the action and uncaches the mixer before disposal', () => {
  const h = makeLayer([makeClip('Leap', 2, 5, 10)], { loaded: 0 })
  const clip = h.instance.clips[0]
  h.animations.set('Fox', PLAYING('Leap', { startedAt: 1_000_000 }))
  h.setClock(1_001_000); h.frame()
  assert.equal(h.part.position.x, 7.5)

  const mixer = h.animations.mixerFor('Fox')
  const action = h.animations.actionFor('Fox')
  h.animations.onInstanceDisposing({ name: 'Fox', node: h.node, instance: h.instance })

  assert.equal(action.isRunning(), false, 'the action was stopped first')
  assert.equal(h.part.position.x, 0, 'and the rest pose is restored')
  assert.notEqual(mixer.clipAction(clip), action, 'the bindings were uncached: clipAction builds a new one')
  assert.equal(h.animations.actionFor('Fox'), null, 'and the entry is gone')
  assert.equal(h.animations.status('Fox').state, ANIMATION_STATE.loading)
  assert.equal(h.animations.size, 0)
})

test('Z5: an event for a replaced instance under the same name is ignored', () => {
  const first = makeInstance([makeClip('Walk', 10, 0, 10)])
  const second = makeInstance([makeClip('Walk', 10, 0, 10)])
  const animations = createModelAnimations({ now: () => 1_000_000 + 3_000 })

  animations.onInstanceCreated({ name: 'Fox', node: { name: 'Fox' }, instance: first })
  animations.set('Fox', PLAYING('Walk', { loop: true, startedAt: 1_000_000 }))
  animations.update()
  const firstPart = partOf(first)
  assert.equal(firstPart.position.x, 3, 'the first instance is playing')

  // The node is removed and another node takes the name: the bridge disposes the
  // old instance and builds a new one.
  animations.onInstanceDisposing({ name: 'Fox', node: { name: 'Fox' }, instance: first })
  const firstAfterDispose = firstPart.position.x
  animations.onInstanceCreated({ name: 'Fox', node: { name: 'Fox' }, instance: second })
  const secondPart = partOf(second)
  assert.equal(secondPart.position.x, 3, 'the replacement picks the state up at once')
  const secondAction = animations.actionFor('Fox')

  // A LATE event for the old instance — the one that must not touch the new one.
  animations.onInstanceDisposing({ name: 'Fox', node: { name: 'Fox' }, instance: first })
  animations.onInstanceRehosted({ name: 'Fox', node: { name: 'Fox' }, instance: first })

  assert.equal(animations.actionFor('Fox'), secondAction, 'the replacement’s action is untouched')
  assert.equal(secondPart.position.x, 3, 'and so is the replacement’s pose')
  assert.equal(firstPart.position.x, firstAfterDispose, 'while the old instance is simply left alone')
  assert.equal(animations.size, 1, 'and only one entry is live')
})

test('Z5: a dropped earlier animation is clip-missing, and a later one still plays', () => {
  const clips = [
    // No track can be bound to a part called `Ghost`, so this animation is dropped.
    makeClip('Broken', 2, 0, 10, 'Ghost'),
    makeClip('Good', 2, 0, 10, 'Part'),
  ]
  const instance = makeInstance(clips)
  assert.deepEqual(instance.animationNames, ['Broken', 'Good'])
  assert.deepEqual(instance.clipIndices, [1], 'only the second animation kept a clip')

  const part = partOf(instance)
  const animations = createModelAnimations({ now: () => 1_001_000 })
  animations.onInstanceCreated({ name: 'Fox', node: { name: 'Fox' }, instance })

  assert.deepEqual(animations.status('Fox').clips, ['Broken', 'Good'], 'both ids are offered')

  animations.set('Fox', PLAYING('Broken', { startedAt: 1_000_000 }))
  animations.update()
  assert.equal(animations.status('Fox').state, ANIMATION_STATE.clipMissing)
  assert.equal(part.position.x, 0, 'nothing plays for a dropped animation')
  assert.equal(animations.actionFor('Fox'), null, 'and no action was made')

  animations.set('Fox', PLAYING('Good', { startedAt: 1_000_000 }))
  animations.update()
  assert.equal(part.position.x, 5, 'a second into a two-second 0 → 10 clip')
  assert.equal(animations.status('Fox').state, ANIMATION_STATE.playing)
})

// ===========================================================================
// update() costs nothing when nothing plays
// ===========================================================================

test('Z5: with nothing playing, update touches no mixer', () => {
  const h = makeLayer([makeClip('Walk', 10, 0, 10)])
  let updates = 0
  const mixer = h.animations.mixerFor('Fox')
  const realUpdate = mixer.update.bind(mixer)
  mixer.update = (dt) => { updates += 1; return realUpdate(dt) }

  h.frame()
  assert.equal(updates, 0, 'nothing was wanted, so no mixer ran')
  assert.equal(h.animations.actionFor('Fox'), null, 'and no action exists')

  h.animations.set('Fox', PLAYING('Walk', { startedAt: 1_000_000 }))
  assert.equal(updates, 1, 'the set applies the value at once, for a late joiner')

  h.setClock(1_001_000); h.frame()
  assert.equal(updates, 2, 'and a playing entry costs exactly one update per frame')

  h.animations.set('Fox', null)
  assert.equal(updates, 2, 'the Stop itself ran none: stop() needs no update')
  h.frame()
  assert.equal(updates, 2, 'and a stopped entry costs nothing per frame')
})

test('Z5: no clips at all is no-clips', () => {
  const h = makeLayer([])
  h.animations.set('Fox', PLAYING('anything'))
  h.frame()
  assert.equal(h.animations.status('Fox').state, ANIMATION_STATE.noClips)
  assert.deepEqual(h.animations.status('Fox').clips, [])
  assert.equal(h.part.position.x, 0)
})

test('Z5: status of a model with no instance is loading', () => {
  const animations = createModelAnimations({ now: () => 0 })
  assert.deepEqual(animations.status('Nobody'), { clips: [], state: ANIMATION_STATE.loading })
})
