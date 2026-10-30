// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * log-id.js — scripting-4c revision round 2, W3: ONE way to put a session id
 * into a log line.
 *
 * The outside review's S1: a `hello` id was free text, and its first 8
 * characters were written into `[session] hello`, `[activate] rate limited`,
 * the depth guard's `session=` and the runner's `select from`. A `\n` or an
 * ANSI escape in an id therefore forged log lines and repainted a terminal.
 *
 * `logId(id)` drops every character outside `[A-Za-z0-9_-]` and then keeps the
 * first 8 of what is left; `'-'` when nothing is left or `id` is not a string.
 * It is TOTAL: it never throws, and its output can never contain a control
 * character, a space, a quote or an escape.
 *
 * W1 (`hello.client.json`) already bounds a session id to 1–64 characters of
 * `[A-Za-z0-9_-]`, so for a real id this is the same 8 characters the old code
 * produced. `logId` is what makes the log lines safe ON THEIR OWN — defence in
 * depth, and the reason no log line can be forged even if a bound is ever
 * loosened.
 *
 * This copy is the runner's (`@atrium/behaviors`). The server has its own copy
 * in `packages/server/src/log-id.js`; the two are deliberately independent —
 * neither package depends on the other — and both are pinned by tests that run
 * the same cases.
 *
 * @param {*} id
 * @returns {string} 1–8 characters of [A-Za-z0-9_-], or '-'
 */
export function logId(id) {
  if (typeof id !== 'string') return '-'
  const kept = id.replace(/[^A-Za-z0-9_-]/g, '')
  return kept.slice(0, 8) || '-'
}
