// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * rotation-degrees.js — quaternion ↔ Euler angles in degrees, for the Edit-mode
 * property panel (Phase 3 step 1b-1, B5). Pure math: no DOM, no three.js.
 *
 * Order is XYZ, the same as three.js's default Euler order, so the panel and a
 * rotation made with the handles agree. glTF quaternions are [x, y, z, w].
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/**
 * Normalize a quaternion. A zero-length or non-finite input becomes identity.
 * @param {number[]} q  [x, y, z, w]
 * @returns {number[]}
 */
export function normalizeQuat(q) {
  const [x, y, z, w] = q
  const len = Math.hypot(x, y, z, w)
  if (!Number.isFinite(len) || len === 0) return [0, 0, 0, 1]
  return [x / len, y / len, z / len, w / len]
}

/**
 * Quaternion → Euler XYZ in degrees.
 * @param {number[]} q  [x, y, z, w] (normalized first)
 * @returns {number[]} [x°, y°, z°]
 */
export function quatToEulerDeg(q) {
  const [x, y, z, w] = normalizeQuat(q)
  // Rotation matrix elements needed for the XYZ decomposition.
  const m11 = 1 - 2 * (y * y + z * z)
  const m12 = 2 * (x * y - z * w)
  const m13 = 2 * (x * z + y * w)
  const m22 = 1 - 2 * (x * x + z * z)
  const m23 = 2 * (y * z - x * w)
  const m32 = 2 * (y * z + x * w)
  const m33 = 1 - 2 * (x * x + y * y)

  // atan2 instead of asin(m13): asin loses precision near ±90° pitch.
  const ey = Math.atan2(m13, Math.hypot(m11, m12))
  let ex, ez
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33)
    ez = Math.atan2(-m12, m11)
  } else {
    // Gimbal lock: X and Z rotate about the same axis; put it all in X.
    ex = Math.atan2(m32, m22)
    ez = 0
  }
  return [ex * DEG, ey * DEG, ez * DEG].map(cleanZero)
}

/**
 * Euler XYZ in degrees → normalized quaternion.
 * @param {number[]} deg  [x°, y°, z°]
 * @returns {number[]} [x, y, z, w]
 */
export function eulerDegToQuat(deg) {
  const [ax, ay, az] = deg.map(d => d * RAD)
  const c1 = Math.cos(ax / 2), s1 = Math.sin(ax / 2)
  const c2 = Math.cos(ay / 2), s2 = Math.sin(ay / 2)
  const c3 = Math.cos(az / 2), s3 = Math.sin(az / 2)
  return normalizeQuat([
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ])
}

// Show -0 as 0 in the panel.
function cleanZero(v) {
  return Object.is(v, -0) ? 0 : v
}
