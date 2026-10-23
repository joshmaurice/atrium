// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// animation-spec.test.js — scripting-4a step 3 (Z1's client copy, Z4).
//
// The client's `animationValueProblem` runs the SAME shared vectors the server's
// test reads, so no copy of the rules lives in a test. Then `clipTime` — the pure
// clip clock — and `clipIds`, the L8 id builder.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  animationValueProblem, animationReasonText, isPlaying, clipTime, clipIds,
  ANIMATION_CLIP_MAX, ANIMATION_STEM_MAX,
} from '../src/animation-spec.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/animation-spec-vectors.json'), 'utf8'))

const PLAYING = { clip: 'Walk', playing: true, loop: true, speed: 1, startedAt: 1_000_000 }

// ===========================================================================
// Z1 — the shared vectors
// ===========================================================================

describe('animationValueProblem — the shared vectors (Z1)', () => {
  assert.ok(VECTORS.values.length >= 40, 'the shared vectors are the adversarial set')
  for (const vector of VECTORS.values) {
    test(vector.label, () => {
      const reason = animationValueProblem(vector.value)
      assert.equal(reason, vector.ok ? null : vector.reason,
        reason ? animationReasonText(reason) : 'accepted')
    })
  }

  test('every refused vector names a code with plain text of its own', () => {
    for (const vector of VECTORS.values.filter((v) => !v.ok)) {
      assert.equal(typeof animationReasonText(vector.reason), 'string')
      assert.ok(animationReasonText(vector.reason).length > 0, vector.reason)
    }
  })
})

// ===========================================================================
// Z4 — the clip time
// ===========================================================================

describe('clipTime (Z4)', () => {
  test('a stopped value, and no value at all, are the rest pose', () => {
    assert.deepEqual(clipTime({ value: { ...PLAYING, playing: false }, duration: 2, nowServer: 1_002_000 }),
      { time: 0, ended: false })
    assert.deepEqual(clipTime({ value: null, duration: 2, nowServer: 1_002_000 }), { time: 0, ended: false })
    assert.deepEqual(clipTime({ value: undefined, duration: 2, nowServer: 1_002_000 }), { time: 0, ended: false })
  })

  test('a once clip runs from 0 to its duration and clamps at the end', () => {
    const value = { ...PLAYING, loop: false }
    assert.deepEqual(clipTime({ value, duration: 2, nowServer: 1_000_000 }), { time: 0, ended: false })
    assert.deepEqual(clipTime({ value, duration: 2, nowServer: 1_001_000 }), { time: 1, ended: false })
    assert.deepEqual(clipTime({ value, duration: 2, nowServer: 1_002_000 }), { time: 2, ended: true })
    assert.deepEqual(clipTime({ value, duration: 2, nowServer: 1_010_000 }),
      { time: 2, ended: true }, 'a late joiner is set straight to the duration')
  })

  test('a looping clip wraps at its duration', () => {
    assert.deepEqual(clipTime({ value: PLAYING, duration: 2, nowServer: 1_000_500 }), { time: 0.5, ended: false })
    assert.deepEqual(clipTime({ value: PLAYING, duration: 2, nowServer: 1_003_000 }), { time: 1, ended: false })
    assert.deepEqual(clipTime({ value: PLAYING, duration: 2, nowServer: 1_005_000 }), { time: 1, ended: false })
    assert.deepEqual(clipTime({ value: PLAYING, duration: 2, nowServer: 1_002_000 }), { time: 0, ended: false })
  })

  test('speed scales the elapsed time', () => {
    const fast = { ...PLAYING, loop: false, speed: 2 }
    assert.deepEqual(clipTime({ value: fast, duration: 10, nowServer: 1_001_000 }), { time: 2, ended: false })
    const slow = { ...PLAYING, loop: false, speed: 0.5 }
    assert.deepEqual(clipTime({ value: slow, duration: 10, nowServer: 1_004_000 }), { time: 2, ended: false })
    assert.deepEqual(clipTime({ value: { ...fast, loop: true }, duration: 3, nowServer: 1_004_000 }),
      { time: 2, ended: false }, 'a fast looping clip wraps too')
  })

  test('a startedAt in the future counts as 0 elapsed — never negative time', () => {
    const value = { ...PLAYING, loop: false, startedAt: 1_000_000 + 30_000 }
    assert.deepEqual(clipTime({ value, duration: 2, nowServer: 1_000_000 }), { time: 0, ended: false })
    assert.deepEqual(clipTime({ value, duration: 2, nowServer: 1_000_000 + 31_000 }), { time: 1, ended: false })
  })

  test('a duration of 0 ends at once', () => {
    assert.deepEqual(clipTime({ value: PLAYING, duration: 0, nowServer: 1_000_000 }), { time: 0, ended: true })
    assert.deepEqual(clipTime({ value: { ...PLAYING, loop: false }, duration: 0, nowServer: 1_000_000 }),
      { time: 0, ended: true })
    assert.deepEqual(clipTime({ value: PLAYING, duration: -1, nowServer: 1_000_000 }),
      { time: 0, ended: true }, 'a nonsense duration is the zero case')
  })

  test('isPlaying reads the value the server stores', () => {
    assert.equal(isPlaying(PLAYING), true)
    assert.equal(isPlaying({ ...PLAYING, playing: false }), false)
    assert.equal(isPlaying(null), false)
    assert.equal(isPlaying(undefined), false)
  })
})

// ===========================================================================
// Z4/L8 — the clip ids
// ===========================================================================

describe('clipIds (Z4, L8)', () => {
  test('the repeated-name example: first occurrence wins, smallest free suffix', () => {
    assert.deepEqual(clipIds(['Walk', 'Walk', 'Walk (2)']), [
      { id: 'Walk', index: 0 },
      { id: 'Walk (3)', index: 1 },
      { id: 'Walk (2)', index: 2 },
    ])
  })

  test('an id never repeats, and never steals a name already in the file', () => {
    const ids = clipIds(['Walk', 'Walk', 'Walk (2)', 'Walk', 'Walk (2)'])
    assert.deepEqual(ids.map((c) => c.id), ['Walk', 'Walk (3)', 'Walk (2)', 'Walk (4)', 'Walk (2) (2)'])
    assert.equal(new Set(ids.map((c) => c.id)).size, ids.length, 'every id is unique')
  })

  test("GLTFLoader's names for two animations both called animation_0", () => {
    assert.deepEqual(clipIds(['animation_0', 'animation_0']), [
      { id: 'animation_0', index: 0 },
      { id: 'animation_0 (2)', index: 1 },
    ])
  })

  test("an unnamed animation's '' is the defensive fallback", () => {
    assert.deepEqual(clipIds(['', 'Run', '']), [
      { id: 'animation_0', index: 0 },
      { id: 'Run', index: 1 },
      { id: 'animation_2', index: 2 },
    ])
    assert.deepEqual(clipIds([]), [], 'no animations, no ids')
    assert.deepEqual(clipIds(null), [], 'a missing list is not a crash')
  })

  test(`a ${ANIMATION_CLIP_MAX}-character name repeated gives ids of at most ${ANIMATION_CLIP_MAX} characters`, () => {
    const long = 'a'.repeat(ANIMATION_CLIP_MAX)
    const ids = clipIds([long, long, long])
    assert.deepEqual(ids.map((c) => c.id.length), [ANIMATION_STEM_MAX, ANIMATION_STEM_MAX + 4, ANIMATION_STEM_MAX + 4])
    for (const { id } of ids) {
      assert.ok(id.length <= ANIMATION_CLIP_MAX, `${id.length} > ${ANIMATION_CLIP_MAX}`)
      assert.equal(animationValueProblem({ clip: id, playing: true, loop: true, speed: 1, startedAt: 0 }), null,
        'every id it builds passes Z1 as a clip')
    }
  })

  test('every id keeps its file index, including after a drop', () => {
    const ids = clipIds(['Survey', 'Walk', 'Run'])
    assert.deepEqual(ids.map((c) => c.index), [0, 1, 2])
    // A dropped animation keeps its id; the ones after it keep THEIR indices.
    assert.deepEqual(ids[1], { id: 'Walk', index: 1 })
  })
})
