// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// visibility — F6 (scripting-4b-2).
//
// There is ONE visibility path: the host node's view object. A placed model's
// wrapper is a child of that object (`model-bridge.js` attach), so three's own
// inheritance hides and shows the instance with the node. Nothing here ever
// touches the wrapper: a second copy would go stale (the operator's C1).
//
// The hit filter is S10's: not "drop every hidden hit" but "take the next hit
// that is visible", so a hidden object in front of a visible one does not make
// the visible one unclickable.
// ---------------------------------------------------------------------------

/**
 * True when `object` or any of its ancestors is `visible === false`.
 *
 * @param {object} object   a THREE.Object3D (or any `{ visible, parent }`)
 * @returns {boolean}
 */
export function hasInvisibleAncestor(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) return true
  }
  return false
}

/**
 * S10 — every hit whose object has no invisible ancestor, in order.
 * `includeHidden: true` (Edit mode, F-L8) returns the list as it is.
 *
 * @param {Array<{object: object}>} hits
 * @param {{includeHidden?: boolean}} [options]
 */
export function visibleHits(hits, { includeHidden = false } = {}) {
  if (includeHidden) return [...(hits ?? [])]
  return (hits ?? []).filter((hit) => !hasInvisibleAncestor(hit?.object))
}

/**
 * S10 — the NEXT hit whose object has no invisible ancestor, or null.
 * `includeHidden: true` (Edit mode, F-L8) returns the first hit as it is.
 *
 * @param {Array<{object: object}>} hits
 * @param {{includeHidden?: boolean}} [options]
 */
export function firstVisibleHit(hits, { includeHidden = false } = {}) {
  return visibleHits(hits, { includeHidden })[0] ?? null
}

/** Every three.js object DocumentView made for a SOM node. */
export function listViewObjects(docView, somNode) {
  try { return docView?.listViews?.(somNode?._node) ?? [] } catch { return [] }
}

/**
 * F6 — the node's view object gets `Object3D.visible`. Returns how many objects
 * were set, so a caller can tell "no view yet" from "set".
 *
 * @returns {number}
 */
export function setNodeVisible(docView, somNode, visible) {
  const objects = listViewObjects(docView, somNode)
  for (const object of objects) object.visible = visible !== false
  return objects.length
}

/**
 * F6 — at view creation, every node's view object takes the SOM's current value.
 *
 * @returns {number} how many nodes had at least one view object
 */
export function applyVisibility(docView, somDocument) {
  let applied = 0
  for (const node of somDocument?.nodes ?? []) {
    if (setNodeVisible(docView, node, node.visible !== false) > 0) applied++
  }
  return applied
}
