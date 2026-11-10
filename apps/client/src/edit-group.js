// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-group.js — Group, Ungroup and Move to, the pure half
 * (devtasks/PREBRIEF-grouping.md FINAL Rev 2, GR8). No DOM, no three.js, no
 * client: SOM nodes in, plans and lists out. `app.js` wires it to the panel
 * and `edit-undo.js` runs the plans.
 *
 * - `moveValue(node, newParent)`: the local placement that keeps `node` where
 *   it is in the world under `newParent` (null: the top level). Exact (bitwise)
 *   when the group being left or entered has rotation exactly (0, 0, 0, 1) and
 *   scale exactly (1, 1, 1): then only the translation changes, by an addition
 *   or a subtraction (r8: through the inverse, a turned parent gives
 *   1.3700000000000003). Otherwise `inverse(world(newParent)) × world(node)`
 *   decomposed, refused for a shear, and for a computed scale component that
 *   is negative or under 0.01 (the panel's clamp would destroy it, review S4;
 *   a scale kept bitwise is never refused, second review N2).
 * - `groupPlan`, `ungroupPlan`: what Group and Ungroup send (GR-L6 (a)).
 * - `isBareNode`, `bareNodes`: the Empty groups list (GR-L8/GR-L11 (c)).
 * - `moveTargets`: the Move to list, with what it left out and why.
 */

import { worldMatrix } from '@atrium/som'
import { moveCounts, treeBoundsProblem, treeCounts, topLevelOf, generationBelow, SUBTREE_NODES_MAX, SUBTREE_DEPTH_MAX, SUBTREE_PRIMITIVES_MAX } from '@atrium/client/add-spec'
import { multiply, decomposeTRS, SHEAR_TOLERANCE } from './part-transform.js'
import { localMatrix } from '@atrium/som'

/** The panel's smallest scale component (edit-gesture.js MIN_SCALE, review S4). */
export const PANEL_MIN_SCALE = 0.01
/** GR-L6 (a) — the base of a new group's name: `group-01`, `group-02`, … */
export const GROUP_BASE = 'group'

const IDENTITY_ROTATION = [0, 0, 0, 1]
const UNIT_SCALE = [1, 1, 1]
const bitwise = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
const isPlainFrame = (n) => !!n && bitwise([...n.rotation], IDENTITY_ROTATION) && bitwise([...n.scale], UNIT_SCALE)

/**
 * The inverse of a column-major affine 4×4 (the last row 0 0 0 1), or null
 * when its linear part is singular.
 */
export function inverseAffine(m) {
  const [a, b, c, , d, e, f, , g, h, i] = m
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)
  if (!(Math.abs(det) > 0)) return null
  const l = [
    (e * i - f * h) / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    -(d * i - f * g) / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    (d * h - e * g) / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ]
  const t = [m[12], m[13], m[14]]
  const it = [
    -(l[0] * t[0] + l[3] * t[1] + l[6] * t[2]),
    -(l[1] * t[0] + l[4] * t[1] + l[7] * t[2]),
    -(l[2] * t[0] + l[5] * t[1] + l[8] * t[2]),
  ]
  return [l[0], l[1], l[2], 0, l[3], l[4], l[5], 0, l[6], l[7], l[8], 0, it[0], it[1], it[2], 1]
}

/**
 * GR8 — the local placement that keeps `node` where it is in the world under
 * `newParent` (a SOM node, or null for the top level).
 * @returns {{ ok: true, value: {translation: number[], rotation: number[], scale: number[]}, exact: boolean }
 *   | { ok: false, rule: 'shear'|'scale'|'singular' }}
 */
export function moveValue(node, newParent) {
  const parent = node.parent ?? null
  const t = [...node.translation], r = [...node.rotation], s = [...node.scale]
  // The exact paths: one level up out of a plain group, or one level down into one.
  if (parent && (parent.parent ?? null) === (newParent ?? null) && isPlainFrame(parent)) {
    const pt = [...parent.translation]
    return { ok: true, exact: true, value: { translation: [pt[0] + t[0], pt[1] + t[1], pt[2] + t[2]], rotation: r, scale: s } }
  }
  if (newParent && (newParent.parent ?? null) === parent && isPlainFrame(newParent)) {
    const gt = [...newParent.translation]
    return { ok: true, exact: true, value: { translation: [t[0] - gt[0], t[1] - gt[1], t[2] - gt[2]], rotation: r, scale: s } }
  }
  const world = worldMatrix(node)
  const inv = newParent ? inverseAffine(worldMatrix(newParent)) : null
  if (newParent && !inv) return { ok: false, rule: 'singular' }
  const local = newParent ? multiply(inv, world) : world
  const d = decomposeTRS(local)
  if (!d.rotation.every(Number.isFinite) || !d.scale.every(Number.isFinite)) return { ok: false, rule: 'singular' }
  // a shear has no TRS: the recomposed matrix misses (part-transform.js's test)
  const back = localMatrix(d)
  for (let col = 0; col < 3; col++) {
    const length = Math.hypot(local[col * 4], local[col * 4 + 1], local[col * 4 + 2])
    const tol = SHEAR_TOLERANCE * Math.max(1e-9, length)
    for (let row = 0; row < 3; row++) {
      if (!(Math.abs(back[col * 4 + row] - local[col * 4 + row]) <= tol)) return { ok: false, rule: 'shear' }
    }
  }
  // the scale this move COMPUTED: negative or under the panel's 0.01 is refused
  if (d.scale.some((c) => c < PANEL_MIN_SCALE)) return { ok: false, rule: 'scale' }
  return { ok: true, exact: false, value: { translation: d.translation, rotation: d.rotation, scale: d.scale } }
}

/** Why a move value was refused, for a tooltip or the count line. */
export const MOVE_REASONS = Object.freeze({
  shear: 'it would be distorted there (a stretched group with a turned object)',
  scale: 'its scale there would be too small or mirrored for the panel',
  singular: 'that group has a zero scale',
})

/** The next free `group-NN` (two digits, then more). */
export function groupName(isFree, base = GROUP_BASE) {
  for (let i = 1; i < 10000; i++) {
    const name = `${base}-${String(i).padStart(2, '0')}`
    if (isFree(name)) return name
  }
  return null
}

/**
 * GR-L6 (a) — Group: a new group in the object's parent, at the object's local
 * translation, no rotation, scale 1; the object moves in at translation 0,
 * keeping its rotation and scale. No maths: exact, never a shear.
 */
export function groupPlan(node, { isFree, name = null } = {}) {
  const groupNameValue = name ?? groupName(isFree)
  if (!groupNameValue) return { ok: false, reason: 'no free group name' }
  return {
    ok: true,
    descriptor: { name: groupNameValue, translation: [...node.translation] },
    parent: node.parent ?? null,
    objectValue: { translation: [0, 0, 0], rotation: [...node.rotation], scale: [...node.scale] },
  }
}

/**
 * GR-L6 (a) — Ungroup: each part to the group's parent, keeping its world
 * placement (exact out of a plain group). Refused when any part's value is.
 */
export function ungroupPlan(group) {
  const parts = []
  for (const part of group.children) {
    const m = moveValue(part, group.parent ?? null)
    if (!m.ok) return { ok: false, rule: m.rule, node: part }
    parts.push({ node: part, value: m.value })
  }
  return { ok: true, parts, parent: group.parent ?? null }
}

/** GR8 — a node nothing is drawn for a click to land on: no parts, no mesh, no model. */
export function isBareNode(node) {
  if (!node) return false
  if (node.children.length > 0) return false
  if (node._node?.getMesh?.()) return false
  if (node.extras?.atrium?.model != null) return false
  return true
}

const ownSource = (n) => n?.extras?.atrium?.source != null
const underOrIs = (node, test) => { for (let n = node; n; n = n.parent) if (test(n)) return true; return false }

/** The breadcrumb text of a node: its ancestors' names and its own, joined by ' › '. */
export function breadcrumbText(node) {
  const names = []
  for (let n = node; n; n = n.parent) names.unshift(n.name)
  return names.join(' › ')
}

/**
 * GR8 — the Empty groups list: the bare nodes the viewport can't reach, sorted
 * by breadcrumb text. Left out: a live avatar or anything under one (this tab's
 * own client-only avatar camera, r9), a `source` container or anything under
 * one, and a node not addressable by a non-empty name. A behaviour, a light, a
 * camera or a teleporter on a bare node doesn't take it off the list.
 * @param {object} som
 * @param {{ isExcluded: (node) => boolean }} rules  the app's live-avatar test
 */
export function bareNodes(som, { isExcluded = () => false } = {}) {
  const out = []
  for (const node of som.nodes) {
    if (!isBareNode(node)) continue
    if (!node.name || som.getObjectByName(node.name) !== node) continue
    if (underOrIs(node, isExcluded)) continue
    if (underOrIs(node, ownSource)) continue
    out.push({ node, label: breadcrumbText(node) })
  }
  return out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}

/** The bare nodes' names, joined: the Empty groups row's key (second review N4). */
export function bareNodesKey(list) {
  return list.map((e) => e.label).join('\n')
}

const carriesBehavior = (n) => n?.extras?.atrium?.behavior != null

/**
 * GR-L10 (a), the client's copy of the server's rule: would moving `node` under
 * `parent` change which behaviours may write it? The behaviour-carrying
 * ancestors (not the node, not its subtree) must be the same set.
 */
export function behaviorAncestorsChange(node, parent) {
  const before = new Set()
  for (let n = node.parent; n; n = n.parent) if (carriesBehavior(n)) before.add(n)
  const after = new Set()
  for (let n = parent; n; n = n.parent) if (carriesBehavior(n)) after.add(n)
  if (before.size !== after.size) return true
  for (const n of before) if (!after.has(n)) return true
  return false
}

const hiddenAbove = (node) => { for (let n = node; n; n = n.parent) if (n.visible === false) return true; return false }

/**
 * GR-L9 (a) — would moving `node` under `parent` change whether it is drawn?
 * three.js doesn't draw a hidden node's children.
 */
export function visibilityChange(node, parent) {
  return hiddenAbove(node.parent) !== hiddenAbove(parent)
}

/**
 * GR4 for Undo (and Group's ask-first): the counts of `parent`'s top-level tree
 * after a group is re-added under `parent` (null: the top level) and `parts`
 * go back into it. `{ before, after }` in `treeBoundsProblem`'s terms.
 */
export function regroupCounts(parent, parts) {
  const counts = parts.map((p) => countsOf(p))
  const nodes = 1 + counts.reduce((n, c) => n + c.nodes, 0)
  const depth = counts.reduce((d, c) => Math.max(d, 1 + c.depth), 0)
  const primitives = counts.reduce((n, c) => n + c.primitives, 0)
  if (!parent) {
    return { before: { nodes: 1, depth: 0, primitives: 0 }, after: { nodes, depth, primitives } }
  }
  // the parts are under `parent` already, so its tree gains the group node and
  // one generation below the parent
  const top = topOf(parent)
  const base = countsOf(top)
  const g = genBelow(top, parent)
  return {
    before: base,
    after: { nodes: base.nodes + 1, depth: Math.max(base.depth, g + 1 + depth), primitives: base.primitives },
  }
}

// small local walkers, with add-spec's counting rule (a `source` container is one node)
function countsOf(root) {
  let nodes = 0, depth = 0, primitives = 0
  const stack = [[root, 0]]
  while (stack.length > 0) {
    const [n, g] = stack.pop()
    nodes += 1
    if (g > depth) depth = g
    const prims = n.mesh?.primitives
    if (Array.isArray(prims)) primitives += prims.length
    if (ownSource(n)) continue
    for (const c of n.children) stack.push([c, g + 1])
  }
  return { nodes, depth, primitives }
}
function topOf(n) { let t = n; while (t.parent) t = t.parent; return t }
function genBelow(top, n) { let g = 0; for (let x = n; x && x !== top; x = x.parent) g += 1; return g }

/** GR4's text, as the panel and Undo say it. */
export const BOUNDS_REASON = 'the group would be too large to copy'

/**
 * GR8 — why `node` can't move under `parent` (null: the top level), or null.
 * The server's GR3 rules the client can see, plus GR-L9 and GR-L10, plus the
 * move value. `rules.isExcluded`: the app's live-avatar test.
 * @returns {null | { rule: string, reason: string }}
 */
export function moveProblem(node, parent, som, { isExcluded = () => false } = {}) {
  if ((node.parent ?? null) === (parent ?? null)) return { rule: 'there', reason: 'already there' }
  if (parent) {
    for (let p = parent; p; p = p.parent) if (p === node) return { rule: 'cycle', reason: 'a node can’t go inside itself' }
    if (!parent.name || som.getObjectByName(parent.name) !== parent) return { rule: 'name', reason: 'that group can’t be found by its name' }
    if (underOrIs(parent, isExcluded)) return { rule: 'avatar', reason: 'an avatar can’t hold objects' }
    if (underOrIs(parent, ownSource)) return { rule: 'external', reason: 'external content can’t hold objects' }
    if (parent.extras?.atrium?.model != null) return { rule: 'model', reason: 'a model can’t hold objects' }
    const b = treeBoundsProblem(moveCounts(node, parent))
    if (b) return { rule: 'bounds', reason: BOUNDS_REASON }
  }
  if (visibilityChange(node, parent)) return { rule: 'hidden', reason: 'show the group first' }
  if (behaviorAncestorsChange(node, parent)) return { rule: 'behavior', reason: 'this would change which behaviours can move it' }
  return null
}

/**
 * GR8 — the Move to list: the groups (nodes that have parts, and bare nodes)
 * `node` may go into, sorted by breadcrumb text, each with its move value;
 * then "Top level" for a part. A target `moveProblem` refuses is left out, and
 * one whose move value is refused for a shear or a scale is left out and
 * counted (`skipped`), so the panel can say the list isn't silently short.
 * @returns {{ targets: {node: object, label: string, value: object}[],
 *   topLevel: null | {value: object}, skipped: number }}
 */
export function moveTargets(node, som, rules = {}) {
  const targets = []
  let skipped = 0
  for (const candidate of som.nodes) {
    if (candidate === node) continue
    if (!(candidate.children.length > 0 || isBareNode(candidate))) continue
    if (moveProblem(node, candidate, som, rules)) continue
    const m = moveValue(node, candidate)
    if (!m.ok) { skipped += 1; continue }
    targets.push({ node: candidate, label: breadcrumbText(candidate), value: m.value })
  }
  targets.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  let topLevel = null
  if (node.parent && !moveProblem(node, null, som, rules)) {
    const m = moveValue(node, null)
    if (m.ok) topLevel = { value: m.value }
    else skipped += 1
  }
  return { targets, topLevel, skipped }
}

/**
 * GR-L5 (a) — would the Undo of this Ungroup be refused by GR4? The Undo
 * re-adds the group and moves every part back in: the tree it rebuilds is
 * the group's tree as it is now. At the top level the group starts alone (one
 * node); under a parent, the parent's tree starts as it will be after the
 * Ungroup (the parts lifted one generation, the group gone).
 * @returns {null|string} the count it would pass
 */
export function ungroupUndoProblem(group) {
  if (!group.parent) {
    return treeBoundsProblem({ before: { nodes: 1, depth: 0, primitives: 0 }, after: treeCounts(group) })
  }
  const top = topLevelOf(group)
  const now = treeCounts(top)
  const base = treeCounts(top, group)
  const g = generationBelow(top, group)
  let nodes = base.nodes, depth = base.depth, primitives = base.primitives
  for (const part of group.children) {
    const c = treeCounts(part)
    nodes += c.nodes; primitives += c.primitives
    depth = Math.max(depth, g + c.depth)
  }
  return treeBoundsProblem({ before: { nodes, depth, primitives }, after: now })
}

/**
 * GR-L5 (a) — would the Undo of moving `node` under `target` be refused by
 * GR4? The Undo moves it back into the tree it is leaving. Never at the top
 * level. Within one tree the nodes and primitives don't change, but the depth
 * can: a move up in a tree already past the depth bound lowers it, and the
 * Undo would raise it again (the outside review's S-1). The tree after the
 * move is compared with the tree now, which the Undo restores.
 */
export function moveUndoProblem(node, target) {
  if (!node.parent) return null
  const oldTop = topLevelOf(node.parent)
  if (target && topLevelOf(target) === oldTop) {
    if (node.parent === target) return null
    return treeBoundsProblem({ before: moveCounts(node, target).after, after: treeCounts(oldTop) })
  }
  return treeBoundsProblem({ before: treeCounts(oldTop, node), after: treeCounts(oldTop) })
}

/**
 * GR-L5 (a) — would the Undo of deleting `node` (its re-add under its
 * parent) be refused by GR4? The tree it leaves is counted without it and
 * with it; a top-level node never is. "A Delete in a tree just over a bound"
 * asks first (the code check's finding 4).
 */
export function deleteUndoProblem(node) {
  return moveUndoProblem(node, null)
}

/** GR4's bounds, re-exported for the panel's ask-first. */
export const BOUNDS = Object.freeze({ nodes: SUBTREE_NODES_MAX, depth: SUBTREE_DEPTH_MAX, primitives: SUBTREE_PRIMITIVES_MAX })
