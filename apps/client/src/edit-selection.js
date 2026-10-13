// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-selection.js — what an Edit-mode click selects (Phase 3 step 1b-1, B2).
 * Pure: works on SOM nodes (or stand-ins with `parent`, `mesh`, `extras`), no
 * DOM, no three.js.
 */

/** Pointer travel, in CSS pixels, above which a press-and-release is a look-drag. */
export const CLICK_SLOP_PX = 4

/**
 * Was this press-and-release a click (select) rather than a look-drag?
 *
 * @param {{x: number, y: number}|null} down  pointer position at mousedown
 * @param {{x: number, y: number}} up         pointer position at click
 * @param {object} [opts]
 * @param {boolean} [opts.gestureEnded=false] the press started or ended a handle drag
 * @returns {boolean}
 */
export function isSelectClick(down, up, { gestureEnded = false } = {}) {
  if (gestureEnded) return false
  if (!down) return false
  return Math.hypot(up.x - down.x, up.y - down.y) < CLICK_SLOP_PX
}

/**
 * Resolve the node an Edit-mode click selects.
 *
 * - If the hit node or any ancestor is excluded (the local avatar, a peer
 *   avatar), nothing is selected.
 * - If the hit node or any ancestor is externally loaded content (carries
 *   `extras.atrium.source`), the outermost such ancestor is selected: the
 *   container is the saved world object.
 * - Otherwise the selection policy decides (nearest mesh-less ancestor by
 *   default; Alt descends to the hit node).
 *
 * @param {object|null} hit  the SOM node under the pointer
 * @param {object} opts
 * @param {(node: object) => boolean} opts.isExcluded
 * @param {(leaf: object, opts: {descend: boolean}) => object} opts.resolveRoot
 *   `resolveSelectionRoot` from @atrium/interaction
 * @param {boolean} [opts.descend=false]  Alt held
 * @returns {object|null}
 */
export function resolveEditSelection(hit, { isExcluded, resolveRoot, descend = false }) {
  if (!hit) return null

  let external = null
  for (let n = hit; n; n = n.parent) {
    if (isExcluded(n)) return null
    if (n.extras?.atrium?.source != null) external = n   // keeps the outermost
  }
  if (external) return external

  return resolveRoot(hit, { descend })
}

/**
 * Pick from the raycast hits, nearest first. Hits on a "see-through" node (the
 * local avatar: in third person it sits in the middle of the view) are skipped,
 * so the owner can select what is behind it. The first other hit decides,
 * through resolveEditSelection — so a peer avatar in front still selects
 * nothing.
 *
 * @param {Array<object>} hits  SOM nodes under the pointer, nearest first
 * @param {object} opts  as resolveEditSelection, plus:
 * @param {(node: object) => boolean} [opts.isSeeThrough]
 * @returns {object|null}
 */
export function pickEditSelection(hits, { isSeeThrough = () => false, ...opts }) {
  for (const hit of hits) {
    let seeThrough = false
    for (let n = hit; n; n = n.parent) if (isSeeThrough(n)) { seeThrough = true; break }
    if (seeThrough) continue
    return resolveEditSelection(hit, opts)
  }
  return null
}
