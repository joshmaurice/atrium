// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * object-name.js — scripting-4d-1 round 4, R18 (F5).
 *
 * The ONE helper that names an object id through the SOM's real return shape.
 * `som.resolveObjectId(id)` returns `{ node }` on success or `{ problem }`
 * (`not-found`, `ambiguous`, `unaddressable`) — never the node itself, so any
 * caller that reads `.name` off it directly shows the raw id (F5). Every
 * `{ problem }` result gives the id, as do an unknown shape and a non-string
 * id. Proof (r18) pins this: removing the `?.node` read makes the real-SOM
 * tests fail.
 */

/**
 * @param {{resolveObjectId?: (id: unknown) => {node?: {name?: unknown}} | {problem: string}} | null | undefined} som
 * @param {unknown} id
 * @returns {string} the node's name, or the id unchanged.
 */
export function objectNameOf(som, id) {
  if (typeof id !== 'string' || id === '') return id
  const name = som?.resolveObjectId?.(id)?.node?.name
  return typeof name === 'string' && name !== '' ? name : id
}
