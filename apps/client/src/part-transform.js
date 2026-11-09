// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * part-transform.js — a part's placement in the world (selection-parts T11,
 * PREBRIEF-selection-parts.md §4). Pure, column-major 4×4 and 3×3 arrays, as
 * `@atrium/som`'s world-matrix.js.
 *
 * - Copy of a part: its world matrix (`worldMatrix(parent) × local`) baked
 *   into one TRS for the snapshot's root (`partWorldTRS`). A mirrored
 *   ancestor (determinant < 0, legal under K6) is carried by negating the x
 *   scale. A shear (a non-uniform scale on an ancestor with a rotation below
 *   it) has no TRS and is refused (`shear`).
 * - Duplicate in place: the parent-frame offset that puts the copy 1.5 m
 *   along WORLD x from the original, whatever the group's rotation and scale
 *   (`parentFrameOffset`, SP-L4 (b)).
 */

import { localMatrix } from '@atrium/som'

/** How far a recomposed column may miss the matrix, relative to its length. */
export const SHEAR_TOLERANCE = 1e-5
/** K6: no scale component smaller than this (edit-duplicate.js MIN_SCALE). */
const MIN_SCALE = 1e-6

/** `a × b`, both column-major 4×4. */
export function multiply(a, b) {
  const out = new Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3]
    }
  }
  return out
}

/** The upper-left 3×3 of a column-major 4×4, column-major. */
export function linear(m) {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
}

/** The inverse of a column-major 3×3 (null when singular). */
export function inverse3(l) {
  const [a, b, c, d, e, f, g, h, i] = l   // columns: (a b c), (d e f), (g h i)
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)
  if (!(Math.abs(det) > 0)) return null
  const inv = [
    (e * i - f * h), -(b * i - c * h), (b * f - c * e),
    -(d * i - f * g), (a * i - c * g), -(a * f - c * d),
    (d * h - e * g), -(a * h - b * g), (a * e - b * d),
  ]
  return inv.map((x) => x / det)
}

/** `l × v`, a column-major 3×3 and a 3-vector. */
export function apply3(l, v) {
  return [
    l[0] * v[0] + l[3] * v[1] + l[6] * v[2],
    l[1] * v[0] + l[4] * v[1] + l[7] * v[2],
    l[2] * v[0] + l[5] * v[1] + l[8] * v[2],
  ]
}

const len3 = (x, y, z) => Math.hypot(x, y, z)

/**
 * A TRS whose `localMatrix` is `m` when `m` has no shear: the translation is
 * the last column, the scale the three columns' lengths (x negated when the
 * determinant is negative), the rotation the unit quaternion of the columns
 * divided by their scales.
 *
 * @param {number[]} m  column-major 4×4
 * @returns {{ translation: number[], rotation: number[], scale: number[] }}
 */
export function decomposeTRS(m) {
  const c0 = [m[0], m[1], m[2]], c1 = [m[4], m[5], m[6]], c2 = [m[8], m[9], m[10]]
  let sx = len3(...c0)
  const sy = len3(...c1), sz = len3(...c2)
  const det = c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) - c1[0] * (c0[1] * c2[2] - c0[2] * c2[1]) + c2[0] * (c0[1] * c1[2] - c0[2] * c1[1])
  if (det < 0) sx = -sx
  // R(row, col) = column col / its scale
  const R = (row, col) => (col === 0 ? c0[row] / sx : col === 1 ? c1[row] / sy : c2[row] / sz)
  const r00 = R(0, 0), r11 = R(1, 1), r22 = R(2, 2)
  const trace = r00 + r11 + r22
  let x, y, z, w
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    w = 0.25 / s; x = (R(2, 1) - R(1, 2)) * s; y = (R(0, 2) - R(2, 0)) * s; z = (R(1, 0) - R(0, 1)) * s
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22)
    w = (R(2, 1) - R(1, 2)) / s; x = 0.25 * s; y = (R(0, 1) + R(1, 0)) / s; z = (R(0, 2) + R(2, 0)) / s
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22)
    w = (R(0, 2) - R(2, 0)) / s; x = (R(0, 1) + R(1, 0)) / s; y = 0.25 * s; z = (R(1, 2) + R(2, 1)) / s
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11)
    w = (R(1, 0) - R(0, 1)) / s; x = (R(0, 2) + R(2, 0)) / s; y = (R(1, 2) + R(2, 1)) / s; z = 0.25 * s
  }
  const n = Math.hypot(x, y, z, w)
  return { translation: [m[12], m[13], m[14]], rotation: [x / n, y / n, z / n, w / n], scale: [sx, sy, sz] }
}

/**
 * A part's world placement as one TRS, for the root of its Copy.
 *
 * @param {number[]} parentWorld  `worldMatrix` of the part's parent (a SOM node's)
 * @param {{ translation?: number[], rotation?: number[], scale?: number[] }} trs  the part's own local TRS
 *   (the built descriptor's root, or the SOM node: never a glTF-Transform node, whose
 *   fields `localMatrix` can't read)
 * @returns {{ ok: true, trs: object } | { ok: false, rule: 'shear'|'transform' }}
 */
export function partWorldTRS(parentWorld, trs) {
  const m = multiply(parentWorld, localMatrix(trs))
  const d = decomposeTRS(m)
  if (!d.scale.every((s) => Number.isFinite(s) && Math.abs(s) >= MIN_SCALE) || !d.rotation.every(Number.isFinite)) {
    return { ok: false, rule: 'transform' }
  }
  const back = localMatrix(d)
  for (let col = 0; col < 3; col++) {
    const length = len3(m[col * 4], m[col * 4 + 1], m[col * 4 + 2])
    const tolerance = SHEAR_TOLERANCE * Math.max(1e-9, length)
    for (let row = 0; row < 3; row++) {
      if (!(Math.abs(back[col * 4 + row] - m[col * 4 + row]) <= tolerance)) return { ok: false, rule: 'shear' }
    }
  }
  return { ok: true, trs: d }
}

/**
 * The offset, in the parent's frame, that moves a child `worldOffset` in the
 * world (SP-L4 (b): a Duplicate in place lands 1.5 m along world x).
 *
 * @param {number[]} parentWorld  `worldMatrix` of the parent
 * @param {number[]} [worldOffset=[1.5, 0, 0]]
 * @returns {number[]}
 */
export function parentFrameOffset(parentWorld, worldOffset = [1.5, 0, 0]) {
  const inv = inverse3(linear(parentWorld))
  return inv ? apply3(inv, worldOffset) : [...worldOffset]
}
