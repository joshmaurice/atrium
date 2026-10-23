// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * animation-spec.js — the model-animation rule set (Phase 3 step 4a, Z1 and Z4).
 * Pure and renderer-neutral: no DOM, no three.js, no fetch.
 *
 * `extras.atrium.animation` is a plain object with exactly the keys `clip`,
 * `playing`, `loop`, `speed` and `startedAt`. Z1 is written once in each
 * package — this is the client's copy, and the server's lives in
 * `packages/server/src/send-policy.js`; the two are pinned to each other by
 * `tests/fixtures/animation-spec-vectors.json`, which both read, so neither can
 * drift.
 *
 * `clipTime` is the pure clip clock: renderer-three only sets an action's time
 * from it, so a background tab, a slow frame and a late joiner all show the same
 * frame, and no drift accumulates (Z4, Z5).
 *
 * `clipIds` builds the L8 ids: one per animation in the FILE, in file order,
 * each keeping its file index so 4b can map a graph's animation index onto it.
 */

/** The exact key set of the animation value (Z1). */
export const ANIMATION_KEYS = Object.freeze(['clip', 'playing', 'loop', 'speed', 'startedAt'])

/** `clip` is 1–300 characters (Z1). The id builder cuts a stem to 250 first. */
export const ANIMATION_CLIP_MAX   = 300
/** The suffix builder cuts a stem to this before adding ` (n)` (L8/Z4). */
export const ANIMATION_STEM_MAX   = 250
export const ANIMATION_SPEED_MIN  = 0.1
export const ANIMATION_SPEED_MAX  = 10
export const ANIMATION_STARTED_MAX = Number.MAX_SAFE_INTEGER

/**
 * The reason codes and their plain text. The codes are the contract the shared
 * vectors pin; the server names the same codes (send-policy.js).
 */
export const ANIMATION_REASONS = Object.freeze({
  'animation-type': 'extras.atrium.animation must be an object',
  'keys':           'extras.atrium.animation must have exactly the keys clip, playing, loop, speed and startedAt',
  'clip':           `clip must be a string of 1 to ${ANIMATION_CLIP_MAX} characters`,
  'playing':        'playing must be a boolean',
  'loop':           'loop must be a boolean',
  'speed':          `speed must be a number from ${ANIMATION_SPEED_MIN} to ${ANIMATION_SPEED_MAX}`,
  'startedAt':      `startedAt must be an integer from 0 to ${ANIMATION_STARTED_MAX}`,
  'model-node':     'extras.atrium.animation is only allowed on a model node',
})

/** The plain text for a reason code. */
export function animationReasonText(reason) {
  return ANIMATION_REASONS[reason] ?? 'the animation value is invalid'
}

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Z1 — the value rule for `extras.atrium.animation`. Returns a reason code, or
 * null when the value is legal.
 *
 * `null` is NOT a case: it is the separate "stopped" value the server accepts on
 * a model node (Z2), and it never reaches this function.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function animationValueProblem(value) {
  if (!isPlainObject(value)) return 'animation-type'
  const keys = Object.keys(value)
  if (keys.length !== ANIMATION_KEYS.length) return 'keys'
  for (const key of keys) if (!ANIMATION_KEYS.includes(key)) return 'keys'

  if (typeof value.clip !== 'string' || value.clip.length < 1 || value.clip.length > ANIMATION_CLIP_MAX) return 'clip'
  if (typeof value.playing !== 'boolean') return 'playing'
  if (typeof value.loop !== 'boolean') return 'loop'
  if (typeof value.speed !== 'number' || !Number.isFinite(value.speed) ||
      value.speed < ANIMATION_SPEED_MIN || value.speed > ANIMATION_SPEED_MAX) return 'speed'
  const startedAt = value.startedAt
  if (typeof startedAt !== 'number' || !Number.isInteger(startedAt) ||
      startedAt < 0 || startedAt > ANIMATION_STARTED_MAX) return 'startedAt'
  return null
}

/** True when the value says "this clip is playing" (Z2/Z4). */
export function isPlaying(value) {
  return value != null && value.playing === true
}

/**
 * Z4 — the clip's time, in seconds, and whether a once-through clip has ended.
 *
 * @param {object} args
 * @param {object|null|undefined} args.value       an `extras.atrium.animation` value
 * @param {number} args.duration                   the clip's duration, in seconds
 * @param {number} args.nowServer                  the server's clock (`client.serverNow()`)
 * @returns {{time: number, ended: boolean}}
 */
export function clipTime({ value, duration, nowServer }) {
  // Not playing, or no value at all: the rest pose.
  if (!isPlaying(value)) return { time: 0, ended: false }

  const total = (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) ? duration : 0
  if (total === 0) return { time: 0, ended: true }

  const speed = (typeof value.speed === 'number' && Number.isFinite(value.speed)) ? value.speed : 1
  const startedAt = (typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)) ? value.startedAt : 0
  // A `startedAt` in the future (this client's estimate is behind the writer's)
  // counts as 0 elapsed: a clip never shows negative time.
  const elapsed = Math.max(0, (nowServer - startedAt) / 1000) * speed

  if (value.loop) return { time: elapsed % total, ended: false }
  return { time: Math.min(elapsed, total), ended: elapsed >= total }
}

/**
 * L8/Z4 — the ids for a file's animations, in file order.
 *
 * The names are GLTFLoader's (`gltf.animations[i].name`), which already names an
 * unnamed animation `animation_<i>`; `''` is handled the same way only as a
 * defensive fallback.
 *
 * The candidate is the name with its stem cut to `ANIMATION_STEM_MAX`. The FIRST
 * OCCURRENCE WINS: the candidate is kept unless it is already an assigned id,
 * and otherwise it gets ` (n)` with the smallest n >= 2 such that
 * `candidate (n)` is neither an assigned id nor any animation's name in the
 * file. So `['Walk', 'Walk', 'Walk (2)']` gives `Walk`, `Walk (3)`, `Walk (2)`.
 *
 * Every id keeps its file `index`, so a graph's animation index can be mapped
 * onto it later, and a dropped animation still has an id (it is `clip-missing`,
 * not a different id).
 *
 * @param {Array<string>} names  the file's animation names, in file order
 * @returns {Array<{id: string, index: number}>}
 */
export function clipIds(names) {
  const list = Array.isArray(names) ? names : []
  const fileNames = new Set(list.map((name) => (typeof name === 'string' ? name : '')))
  const assigned = new Set()
  const out = []
  for (let index = 0; index < list.length; index++) {
    const raw = typeof list[index] === 'string' ? list[index] : ''
    const candidate = (raw === '' ? `animation_${index}` : raw).slice(0, ANIMATION_STEM_MAX)
    let id = candidate
    if (assigned.has(id)) {
      let n = 2
      while (assigned.has(`${candidate} (${n})`) || fileNames.has(`${candidate} (${n})`)) n += 1
      id = `${candidate} (${n})`
    }
    assigned.add(id)
    out.push({ id, index })
  }
  return out
}
