// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * behavior-clips.js — V5 (scripting-4b-2 round 5): F4's `clipStatus`, for the
 * form's clip picker AND for the adapter's own clip check.
 *
 * One function, one source. Round 4's `clipsFor` in `app.js` answered
 * `{ status: 'loaded' }` with no `clipIds` and said "the host's clip ids are
 * not exposed to the page yet" — they are: 4a's `modelAnimations.status(name)`
 * drives the Animation row's clip list, and its `clips` is the list the
 * adapter's S7 check needs. So the picker was always a text box and the clip
 * check was inert.
 *
 * `status(name)` (4a, `@atrium/renderer-three`) answers
 * `{ clips, state }` where `state` is one of `loading`, `stopped`, `playing`,
 * `ended`, `clip-missing`, `no-clips` — and it answers `loading` with an empty
 * list for a name it has never seen, so the caller must check the node itself
 * for a model first.
 *
 * X6 (round 7) — the lookup is by NODE (`clipsForNode`), and `clipsFor` by id
 * resolves the id to its node and calls it. One source still, so V5's "the
 * picker and the check can never disagree" holds; but a model saved before ids
 * existed (§1.2 item 6: a world's models with no `objectId`) has a clip list
 * now, where the id-only lookup found nothing.
 */

/** V5 — the states the form and the adapter see, which are 4a's. */
export const CLIP_STATUS = Object.freeze({ none: 'none', loading: 'loading', loaded: 'loaded' })

/**
 * X6 — the clips of a node, from the host's own record.
 *
 * @param {object|null} node
 * @param {object} deps
 * @param {{status: (name: string) => ({clips: string[], state: string}|undefined)}} [deps.modelAnimations]
 * @returns {{status: string, clipIds?: string[]}}
 */
export function clipsForNode(node, { modelAnimations } = {}) {
  if (!node) return { status: CLIP_STATUS.none }        // no node
  if (!node.extras?.atrium?.model) return { status: CLIP_STATUS.none }   // no model on it
  const record = modelAnimations?.status?.(node.name)
  if (!record) return { status: CLIP_STATUS.none }
  if (record.state === 'loading') return { status: CLIP_STATUS.loading }
  return { status: CLIP_STATUS.loaded, clipIds: record.clips ?? [] }
}

/**
 * V5 — the clips of an object id, by resolving it to its node first. The
 * adapter's S7 clip check calls THIS one; the form reads `clipsForNode`.
 *
 * @param {string} objectId
 * @param {object} deps
 * @param {(id: string) => ({node: object}|object|undefined)} deps.resolveObjectId
 * @param {{status: (name: string) => ({clips: string[], state: string}|undefined)}} [deps.modelAnimations]
 * @returns {{status: string, clipIds?: string[]}}
 */
export function clipsFor(objectId, { resolveObjectId, modelAnimations } = {}) {
  const resolved = resolveObjectId?.(objectId)
  const node = resolved?.node ?? resolved ?? null
  return clipsForNode(node, { modelAnimations })
}
