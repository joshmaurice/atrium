// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-palette.js — where a palette primitive goes and what it's called
 * (Phase 3 step 1b-2, N1 and J5). Pure: no DOM, no three.js.
 */

/** Metres from the avatar to a new primitive, along the view. */
export const PALETTE_DISTANCE = 2.5

/** The palette's kinds and their default names, in palette order. */
export const PALETTE_LABELS = Object.freeze({
  cube: 'Cube', plane: 'Plane', sphere: 'Sphere', cylinder: 'Cylinder', ramp: 'Ramp',
})

/** The D3 name limit (`SOMDocument.checkNewName`). */
export const MAX_NAME_LENGTH = 256

/**
 * Where a new primitive goes (N1): PALETTE_DISTANCE from `origin` along the
 * horizontal part of `forward`, on the ground (y = 0), turned to face that
 * direction.
 *
 * `forward` is the world direction the rendered camera looks along. In ORBIT
 * the avatar's own rotation is stale, so the view decides in every mode.
 * Looking straight up or down leaves no horizontal part: −Z is used.
 *
 * @param {number[]} origin   [x, y, z] the local avatar node's translation
 * @param {number[]} forward  [x, y, z] the view direction (any length)
 * @returns {{ position: number[], rotation: number[] }}
 *   `position` is the ground point; `rotation` a unit quaternion about Y that
 *   turns local −Z onto the horizontal direction.
 */
export function palettePlacement(origin, forward) {
  let dx = forward?.[0] ?? 0
  let dz = forward?.[2] ?? 0
  const len = Math.hypot(dx, dz)
  if (!(len > 1e-6)) { dx = 0; dz = -1 } else { dx /= len; dz /= len }
  const position = [origin[0] + dx * PALETTE_DISTANCE, 0, origin[2] + dz * PALETTE_DISTANCE]
  // A rotation by θ about Y takes (0, 0, −1) to (−sin θ, 0, −cos θ).
  const theta = Math.atan2(-dx, -dz)
  return { position, rotation: [0, Math.sin(theta / 2), 0, Math.cos(theta / 2)] }
}

/** Cut a string to at most `max` UTF-16 units without splitting a surrogate pair. */
function cutToLength(s, max) {
  if (s.length <= max) return s
  let out = ''
  for (const ch of s) {               // iterates by code point
    if (out.length + ch.length > max) break
    out += ch
  }
  return out
}

/**
 * The first free name in a series (J5): `stem + suffix(1)`, `stem + suffix(2)`…
 * Each suffix is reserved first and only the stem is cut to fit
 * MAX_NAME_LENGTH, so successive candidates of a long stem still differ.
 *
 * @param {string} stem
 * @param {(n: number) => string} suffix   suffix for the n-th candidate
 * @param {(name: string) => boolean} isFree   e.g. `n => som.checkNewName(n).ok`
 * @param {number} [limit=10000]
 * @returns {string|null}  null if none of the first `limit` candidates is free
 */
export function firstFreeName(stem, suffix, isFree, limit = 10000) {
  for (let n = 1; n <= limit; n++) {
    const tail = suffix(n)
    const name = cutToLength(stem, MAX_NAME_LENGTH - tail.length) + tail
    if (isFree(name)) return name
  }
  return null
}

/** `Cube`, `Cube 2`, `Cube 3`… */
export function paletteName(kind, isFree) {
  const label = PALETTE_LABELS[kind]
  if (!label) throw new Error(`unknown primitive kind "${kind}"`)
  return firstFreeName(label, (n) => (n === 1 ? '' : ` ${n}`), isFree)
}

/**
 * `Teleporter`, `Teleporter 2`, `Teleporter 3`… (edit-polish-2, L4)
 *
 * A pad's default name, read in the Name field and in Undo's tooltip, exactly
 * as the palette's kinds read `Cube`, `Cube 2`. Built on `firstFreeName`, so it
 * shares the 256-character limit and the "reserve the suffix first" rule.
 * Labels and triggers key on the node name, not on a prefix, and `isTeleporter`
 * reads the node's extras, so nothing depends on the old `teleporter-<uuid>`
 * shape. Teleporters are not a palette kind (PALETTE_LABELS is unchanged), so
 * this is its own function rather than a PALETTE_LABELS entry.
 *
 * @param {(name: string) => boolean} isFree   e.g. `n => som.checkNewName(n).ok`
 * @returns {string|null}  null if none of the first `limit` candidates is free
 */
export function teleporterName(isFree) {
  return firstFreeName('Teleporter', (n) => (n === 1 ? '' : ` ${n}`), isFree)
}

/** `<name> copy`, `<name> copy 2`… */
export function copyName(name, isFree) {
  return firstFreeName(name, (n) => (n === 1 ? ' copy' : ` copy ${n}`), isFree)
}
