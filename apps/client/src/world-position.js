// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * world-position.js — where a SOM node's origin is in world space (Phase 3
 * step 1b-1, B7). Pure math over SOM nodes: no DOM, no three.js.
 *
 * Teleporter trigger zones and pad labels used the node's own `translation`,
 * which is relative to its parent. A pad inside a group stayed where the group
 * used to be when the group moved. This composes translation, rotation and
 * scale up the parent chain instead. For a root-level node it returns exactly
 * its translation, so today's pads are unchanged.
 */

/**
 * @param {{ translation?: number[], rotation?: number[], scale?: number[], parent: object|null }} node
 * @returns {number[]} [x, y, z]
 */
export function worldPosition(node) {
  let p = [...(node.translation ?? [0, 0, 0])]
  for (let a = node.parent; a; a = a.parent) {
    const s = a.scale ?? [1, 1, 1]
    const scaled = [p[0] * s[0], p[1] * s[1], p[2] * s[2]]
    const r = rotateByQuat(a.rotation ?? [0, 0, 0, 1], scaled)
    const t = a.translation ?? [0, 0, 0]
    p = [r[0] + t[0], r[1] + t[1], r[2] + t[2]]
  }
  return p
}

/**
 * True when `node` or any node below it satisfies `predicate` (used with
 * isTeleporter: a move of such a node moves a trigger zone).
 * @param {{ children?: object[] }} node
 * @param {(node: object) => boolean} predicate
 * @returns {boolean}
 */
export function subtreeSome(node, predicate) {
  if (!node) return false
  if (predicate(node)) return true
  for (const child of node.children ?? []) {
    if (subtreeSome(child, predicate)) return true
  }
  return false
}

// Rotate vector v by unit quaternion q = [x, y, z, w].
function rotateByQuat(q, v) {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  // v' = v + w * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ]
}
