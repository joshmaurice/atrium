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
export function resolveEditSelection(hit, { isExcluded, resolveRoot, descend = false, current = null, drill = false }) {
  if (!hit) return null

  let external = null
  for (let n = hit; n; n = n.parent) {
    if (isExcluded(n)) return null
    if (n.extras?.atrium?.source != null) external = n   // keeps the outermost
  }

  // selection-parts T13 — external content is handed to the policy AS THE
  // LEAF: the container stays atomic whatever the gesture (Alt and drilling
  // stop at it), and an ordinary group around it is still what a click selects.
  return resolveRoot(external ?? hit, { descend, current, drill })
}

// ── The breadcrumb (selection-parts T14) ────────────────────────────────

/** Over this many levels the breadcrumb shows the top, `…`, and the last ones. */
export const BREADCRUMB_MAX_LEVELS = 7
/** A crumb's shown name is cut to this many characters (its title is whole). */
export const BREADCRUMB_NAME_MAX = 32

/**
 * The selection's path: its ancestors from the top-level one down, then the
 * node itself. Walks `parent` only.
 * @param {{ parent?: object|null }|null} node
 * @returns {object[]}
 */
export function selectionPath(node) {
  const out = []
  for (let n = node; n; n = n.parent ?? null) out.push(n)
  return out.reverse()
}

/**
 * What the breadcrumb row shows for a path (`selectionPath`): nothing for a
 * top-level selection; otherwise each ancestor a `crumb`, the selection the
 * `current` item, and over BREADCRUMB_MAX_LEVELS the top-level crumb, an
 * `ellipsis`, and the last BREADCRUMB_MAX_LEVELS − 1. Names are other users'
 * text: `show` (copy-paste.js's `shownText`) escapes control and direction
 * characters; `text` is cut to BREADCRUMB_NAME_MAX, `title` is whole.
 *
 * @param {object[]} path
 * @param {{ show: (value: string, max?: number) => string }} opts
 * @returns {Array<{ kind: 'crumb'|'current'|'ellipsis', node: object|null, text: string, title: string }>}
 */
export function breadcrumbItems(path, { show }) {
  if (!Array.isArray(path) || path.length < 2) return []
  const item = (node, kind) => ({ kind, node, text: show(node.name, BREADCRUMB_NAME_MAX), title: show(node.name) })
  const last = path.length - 1
  const shown = path.length > BREADCRUMB_MAX_LEVELS
    ? [path[0], null, ...path.slice(path.length - (BREADCRUMB_MAX_LEVELS - 1))]
    : path
  return shown.map((node, i) => {
    if (node === null) return { kind: 'ellipsis', node: null, text: '…', title: '' }
    return item(node, i === shown.length - 1 && path[last] === node ? 'current' : 'crumb')
  })
}

/** Shown when a click lands on a node whose name another node also has. */
export const DUPLICATE_NAME_MESSAGE =
  'Another node has the same name, so this one can’t be edited yet.'

/**
 * Is this three.js object one DocumentView made for a glTF *node*? Nodes are
 * plain Object3D (Bone for joints); meshes are Group and primitives are Mesh,
 * and a mesh is often named like some other node (Blender exports), so a
 * by-name lookup must only ever consider node objects.
 * @param {{ type?: string, isBone?: boolean }} obj
 */
export function isNodeObject(obj) {
  return obj?.type === 'Object3D' || obj?.isBone === true
}

/**
 * The first node object named `name` under `root` (depth-first, root
 * included). With duplicated names refused (pickEditSelection), the name is
 * unique, so this is the selected node's object.
 * @param {{ name?: string, children?: object[] }|null} root
 * @param {string} name
 * @returns {object|null}
 */
export function findNodeObject(root, name) {
  if (!root) return null
  if (root.name === name && isNodeObject(root)) return root
  for (const child of root.children ?? []) {
    const found = findNodeObject(child, name)
    if (found) return found
  }
  return null
}

/**
 * Map a raycast hit (a three.js object) to the SOM node it belongs to: walk up
 * to the nearest node object whose name resolves to a SOM node. Mesh and
 * primitive objects are skipped, whatever they're called.
 *
 * @param {object} obj  the hit object
 * @param {object} opts
 * @param {(name: string) => object|null} opts.getNodeByName
 * @param {(name: string) => boolean} opts.isDuplicatedName
 * @returns {object|{ duplicateName: string }|null}  the SOM node, a duplicate marker, or null
 */
export function nodeForHitObject(obj, { getNodeByName, isDuplicatedName }) {
  for (let o = obj; o; o = o.parent) {
    if (!o.name || !isNodeObject(o)) continue
    const node = getNodeByName(o.name)
    if (!node) continue
    if (isDuplicatedName(o.name)) return { duplicateName: o.name }
    return node
  }
  return null
}

/**
 * Pick from the raycast hits, nearest first. Hits on a "see-through" node (the
 * local avatar: in third person it sits in the middle of the view) are skipped,
 * so the owner can select what is behind it. The first other hit decides,
 * through resolveEditSelection — so a peer avatar in front still selects
 * nothing.
 *
 * A node whose name another node also has can't be edited yet (the client's
 * by-name lookups can't tell them apart; the server cleanup round fixes the
 * name setter). A hit on one, or a selection that resolves to one, is refused
 * with a reason.
 *
 * @param {Array<object>} hits  SOM nodes (or { duplicateName }) under the pointer, nearest first
 * @param {object} opts  as resolveEditSelection, plus:
 * @param {(node: object) => boolean} [opts.isSeeThrough]
 * @param {(name: string) => boolean} [opts.isDuplicatedName]
 * @returns {{ node: object|null, refused: string|null }}
 */
export function pickEditSelection(hits, { isSeeThrough = () => false, isDuplicatedName = () => false, ...opts }) {
  for (const hit of hits) {
    if (hit?.duplicateName != null) return { node: null, refused: DUPLICATE_NAME_MESSAGE }
    let seeThrough = false
    for (let n = hit; n; n = n.parent) if (isSeeThrough(n)) { seeThrough = true; break }
    if (seeThrough) continue
    const node = resolveEditSelection(hit, opts)
    if (node && isDuplicatedName(node.name)) return { node: null, refused: DUPLICATE_NAME_MESSAGE }
    return { node, refused: null }
  }
  return { node: null, refused: null }
}
