// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * world-position.js — the page's view of a SOM node's world position.
 *
 * scripting-4c AC2 (Rev 1 M2): the MATH moved to `@atrium/som` so the server and
 * the page use ONE implementation. This module re-exports it, and keeps
 * `subtreeSome`, which is the page's own walk and is not shared with the server.
 *
 * `apps/client` gained the `@atrium/som` dependency for this (AC2, P20); the
 * browser also resolves it through the page's import map.
 */

export { worldPosition } from '@atrium/som'

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
