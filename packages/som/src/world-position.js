// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * world-position.js — where a SOM node's origin is in world space (Phase 3 step
 * 1b-1, B7; moved here from `apps/client/src/world-position.js` by scripting-4c
 * AC2 / Rev 1 M2).
 *
 * Pure math over SOM nodes: no DOM, no three.js. It lives in `@atrium/som` so
 * the PAGE and the SERVER measure with the same code: the server's `activate`
 * distance check reads a behaviour node's world position, and the page's own
 * pre-check reads the same thing. One implementation, both sides.
 *
 * Teleporter trigger zones and pad labels used the node's own `translation`,
 * which is relative to its parent. A pad inside a group stayed where the group
 * used to be when the group moved. This composes translation, rotation and
 * scale up the parent chain instead. For a root-level node it returns exactly
 * its translation, so today's pads are unchanged.
 *
 * NEVER `world.getNodeTranslation`: that is the LOCAL translation (4b-2 P7) and
 * is wrong for any object inside a group.
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
