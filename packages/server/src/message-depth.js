// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// message-depth — the depth bound on every inbound WebSocket message (G1).
//
// Why: nothing used to bound a message's nesting depth. A message nested a few
// thousand deep is accepted, stored in the world, and only then breaks
// `JSON.stringify` in broadcast/broadcastExcept with
// `RangeError: Maximum call stack size exceeded` — which, thrown from an async
// listener, is an unhandled rejection that exits the process and drops every
// world on it. The guard refuses such a message before anything else reads it.
//
// The walk is ITERATIVE (an explicit stack, no recursion): a recursive walk
// dies on exactly the input this guard exists to refuse.
// ---------------------------------------------------------------------------

/**
 * The deepest inbound message the server accepts. The top-level parsed message
 * object counts as depth 1, objects and arrays each add one level. A wide
 * margin over the deepest legitimate client message (measured in
 * message-depth-measure.test.js, which asserts it is 32 or less) and far below
 * the depth at which `JSON.stringify` or a recursive walk breaks.
 */
export const MAX_MESSAGE_DEPTH = 64

/**
 * The measured nesting depth of a parsed JSON value: the value itself is depth
 * 1, and each nested object or array adds one. Scalars (numbers, strings,
 * booleans, null) and strings are not walked, and a non-object value has depth
 * 0.
 *
 * The walk stops as soon as it finds a node deeper than `limit` and returns
 * `limit + 1`: a 1,000,000-deep array is refused without being traversed, in
 * bounded time and memory. So a caller may only compare the result against
 * `limit` — the exact depth above the limit is deliberately not computed.
 *
 * @param {*} value a JSON.parse result (or any value)
 * @param {number} [limit] the depth bound
 * @returns {number} the depth, or `limit + 1` when it exceeds the limit
 */
export function messageDepth(value, limit = MAX_MESSAGE_DEPTH) {
  if (typeof value !== 'object' || value === null) return 0

  const stack = [[value, 1]]
  let max = 1

  while (stack.length > 0) {
    const [node, depth] = stack.pop()
    if (depth > max) max = depth
    const childDepth = depth + 1

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const child = node[i]
        if (typeof child !== 'object' || child === null) continue
        if (childDepth > limit) return childDepth
        stack.push([child, childDepth])
      }
    } else {
      for (const key of Object.keys(node)) {
        const child = node[key]
        if (typeof child !== 'object' || child === null) continue
        if (childDepth > limit) return childDepth
        stack.push([child, childDepth])
      }
    }
  }

  return max
}
