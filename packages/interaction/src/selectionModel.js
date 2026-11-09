// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * nearestNonMeshAncestor — walk up from leaf to the nearest ancestor that
 * carries no mesh. Returns that ancestor, or leaf if none is found before
 * the scene boundary (parent === null).
 *
 * A node that has its own mesh is not treated as a selection group even if it
 * has mesh children. The modeler's convention (Blender-style "Empty parent")
 * is that group roots are transform-only nodes with no geometry of their own.
 */
export function nearestNonMeshAncestor(leaf) {
  let current = leaf
  while (current.parent !== null) {
    if (current.parent.mesh === null) return current.parent
    current = current.parent
  }
  return leaf
}

/**
 * leafOnly — return the hit leaf unchanged. Use as `policy` when you want
 * direct, unmodified selection (e.g. tree-view clicks).
 */
export function leafOnly(leaf) {
  return leaf
}

/**
 * resolveSelectionRoot — apply a selection policy with an optional
 * modifier-key descent escape.
 *
 * @param {SOMNode} leaf - The directly hit node.
 * @param {object}  [opts]
 * @param {Function} [opts.policy=nearestNonMeshAncestor] - Policy function.
 * @param {boolean}  [opts.descend=false] - If true, return leaf directly
 *   (Alt-click escape to select individual parts of a compound object).
 * @returns {SOMNode}
 */
export function resolveSelectionRoot(leaf, {
  policy = nearestNonMeshAncestor,
  descend = false,
} = {}) {
  if (descend) return leaf
  return policy(leaf)
}

// ---------------------------------------------------------------------------
// selection-parts T13 (PREBRIEF-selection-parts.md §4; SA-L6 (d), SP-L1 (a),
// SP-L2 (b)) — the scoped policy the Atrium client's Edit and Inspect modes
// use. The default policy above is unchanged: the SOM Inspector and the
// playground keep it. Pure; walks `parent` only, no recursion over children.
// ---------------------------------------------------------------------------

/**
 * topLevelAncestor — the ancestor (or the node itself) whose parent is the
 * scene (`parent === null`).
 */
export function topLevelAncestor(leaf) {
  let n = leaf
  while (n.parent !== null && n.parent !== undefined) n = n.parent
  return n
}

/**
 * childToward — the child of `ancestor` on the path down to `leaf`, or null
 * when `leaf` is `ancestor` or isn't below it.
 */
export function childToward(ancestor, leaf) {
  if (!ancestor || !leaf || leaf === ancestor) return null
  for (let n = leaf; n.parent !== null && n.parent !== undefined; n = n.parent) {
    if (n.parent === ancestor) return n
  }
  return null
}

/**
 * resolveScopedSelection — what a click on `leaf` selects, given what is
 * selected now:
 *   1. `descend` (Alt) → the leaf;
 *   2. the leaf is `current` or below it → with `drill` (a double-click), one
 *      level deeper toward the leaf; without, `current` (nothing changes);
 *   3. the leaf is below an ancestor of `current` (nearest first) → that
 *      ancestor's child toward the leaf (the level you are working at);
 *   4. otherwise the leaf's top-level object.
 *
 * @param {object} leaf  the hit node (stand-ins need `parent` only)
 * @param {object} [opts]
 * @param {object|null} [opts.current=null]  the current selection
 * @param {boolean} [opts.drill=false]  a click count of 2 or more
 * @param {boolean} [opts.descend=false]  Alt held
 * @returns {object}
 */
export function resolveScopedSelection(leaf, { current = null, drill = false, descend = false } = {}) {
  if (descend) return leaf
  if (current) {
    if (leaf === current) return current
    const below = childToward(current, leaf)
    if (below) return drill ? below : current
    for (let a = current.parent ?? null; a; a = a.parent ?? null) {
      const c = childToward(a, leaf)
      if (c) return c
    }
  }
  return topLevelAncestor(leaf)
}
