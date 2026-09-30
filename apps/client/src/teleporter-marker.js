// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// Teleporter marker helpers — pure functions, no DOM, no Three.js dependency.
//
// isTeleporter(node)           — true if the node is a valid teleporter pad
// teleporterDestination(node)  — returns destination string or null
// ---------------------------------------------------------------------------

/**
 * Check whether a SOM node is a valid teleporter pad (T1).
 * True iff node?.extras?.atrium?.teleporter?.destination is a non-empty string.
 *
 * @param {object} node — SOM node with extras
 * @returns {boolean}
 */
export function isTeleporter(node) {
  if (!node) return false
  const dest = node.extras?.atrium?.teleporter?.destination
  return typeof dest === 'string' && dest.length > 0
}

/**
 * Get the teleporter destination string from a SOM node (T1).
 * Returns null when the node is not a valid teleporter.
 *
 * @param {object} node — SOM node with extras
 * @returns {string|null}
 */
export function teleporterDestination(node) {
  if (!isTeleporter(node)) return null
  return node.extras.atrium.teleporter.destination
}
