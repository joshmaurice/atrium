// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * world-matrix.js — a SOM node's LOCAL and WORLD matrices (scripting-4d-1 G-L4,
 * G3).
 *
 * Pure math over SOM nodes: no DOM, no three.js, no `@atrium/behaviors`
 * dependency. It lives in `@atrium/som` beside `worldPosition` for the same
 * reason: the PAGE's decorator reads `matrix` / `globalMatrix` and the SERVER
 * may read them too, and there is one implementation for both.
 *
 * Like `worldPosition`, it composes from the node's own `translation`,
 * `rotation` and `scale` up the parent chain — the SOM's canonical fields —
 * rather than reading a renderer's matrix, so it is identical in Node and in
 * the browser. For a root-level node the world matrix is exactly its local one.
 *
 * The result is a 16-element, COLUMN-major array, which is what glTF's `matrix`
 * property and KHR_interactivity's `/nodes/<i>/matrix` and
 * `/nodes/<i>/globalMatrix` pointers use.
 *
 * NEVER `world.getNodeTranslation`: that is the LOCAL translation (4b-2 P7).
 */

/** Identity, column-major. */
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/**
 * A node's LOCAL matrix: translation × rotation × scale, column-major.
 *
 * @param {{translation?: number[], rotation?: number[], scale?: number[]}} node
 * @returns {number[]} 16 numbers, column-major
 */
export function localMatrix(node) {
  const [x, y, z, w] = node?.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node?.scale ?? [1, 1, 1]
  const [px, py, pz] = node?.translation ?? [0, 0, 0]

  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    px, py, pz, 1,
  ]
}

/**
 * A node's WORLD (global) matrix: every ancestor's local matrix, composed down
 * to the node, column-major.
 *
 * @param {{translation?: number[], rotation?: number[], scale?: number[],
 *          parent?: object|null}} node
 * @returns {number[]} 16 numbers, column-major
 */
export function worldMatrix(node) {
  if (!node) return [...IDENTITY]
  // The chain, root first, without recursion.
  const chain = []
  for (let n = node; n; n = n.parent ?? null) chain.push(n)
  let out = [...IDENTITY]
  for (let i = chain.length - 1; i >= 0; i--) out = multiply44(out, localMatrix(chain[i]))
  return out
}

/** `a × b`, both column-major 4×4. */
function multiply44(a, b) {
  const out = new Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3]
    }
  }
  return out
}

export { IDENTITY as IDENTITY_MATRIX4 }
