// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * object-id.js — the object-id rule set (Phase 3 step 4b-1, E1). Pure and
 * renderer-neutral: no DOM, no window, no three.js, no fetch.
 *
 * `extras.atrium.objectId` is a permanent, unique object identity: one lowercase
 * RFC 4122 version-4 UUID (`crypto.randomUUID()` output). E1 is written once in
 * each consumer package — this is the client's copy, and the server's lives in
 * `packages/server/src/send-policy.js`; the two are pinned to each other by
 * `tests/fixtures/object-id-vectors.json`, which both tests read, so neither
 * can drift.
 *
 * The form is checked by an anchored regex rather than by hand-written string
 * surgery, so a value with a trailing newline, an uppercase hex digit, a v1
 * UUID or a wrong-length body is refused by the same rule everywhere.
 */

/** E-L1's form: a lowercase RFC 4122 version-4 UUID, exactly. */
export const OBJECT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * The reason codes and their plain text. The codes are the contract the shared
 * vectors pin; the server names the same codes (send-policy.js).
 */
export const OBJECT_ID_REASONS = Object.freeze({
  'object-id-type': 'objectId must be a string',
  'object-id-form': 'objectId must be a lowercase RFC 4122 version-4 UUID',
})

/** The plain text for a reason code. */
export function objectIdReasonText(reason) {
  return OBJECT_ID_REASONS[reason] ?? 'the objectId is invalid'
}

/**
 * E1 — the value rule for `extras.atrium.objectId`. Returns a reason code, or
 * null when the value is legal.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function objectIdProblem(value) {
  if (typeof value !== 'string') return 'object-id-type'
  if (!OBJECT_ID_RE.test(value)) return 'object-id-form'
  return null
}

/** The default source: the platform's secure random UUID. */
function defaultRandomUUID() {
  return globalThis.crypto.randomUUID()
}

/** E-L3 — the set-once node extras leaf the id is written through. */
export const OBJECT_ID_FIELD = 'extras.atrium.objectId'

/**
 * E1 — a new id. `crypto.randomUUID()`'s output always passes
 * `objectIdProblem`. The source is a parameter so a test can pin it.
 *
 * @param {() => string} [randomUUID]
 * @returns {string}
 */
export function newObjectId(randomUUID = defaultRandomUUID) {
  return randomUUID()
}
