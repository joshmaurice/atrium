// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// value-rules — scripting-4d-1 G4: a renderer-neutral copy of the SERVER's
// node and light VALUE checks (`packages/server/src/send-policy.js`, P23).
//
// G4 puts a write check at the runner's boundary: a value a graph writes is
// checked BEFORE it is queued or put in the overlay, so the overlay never
// holds a value the server would refuse (S1/M2). The checks here are the
// server's own — translation three finite numbers; rotation four finite
// numbers that make a unit quaternion within 1e-3; scale three finite numbers,
// each at least 1e-6 in magnitude (negative allowed); visible a boolean; a
// light's intensity a finite number and its colour three finite numbers.
//
// ONE rule set, two implementations: this and the server's `send-policy.js`.
// They are pinned to each other by `tests/fixtures/value-vectors.json`, which
// BOTH tests read (the E1 pattern) — so neither copy can drift. The messages
// returned here are the server's exact texts, character for character.
//
// The module is pure and total: it decides, it never mutates, and it never
// throws. A field outside G-L4's writable families returns `null` (no
// opinion): the runner applies these checks to the families it writes, and a
// write the graph could not have made is left to the server, exactly as
// before. NOTHING is normalised here — a graph must produce unit quaternions
// itself (`math/quatMul`, `math/normalize`); the importer's help says so.
//
// It is imported by the runner with a RELATIVE path (`./value-rules.js`), so
// the package keeps no new subpath and no `package.json` / import map changes.
// ---------------------------------------------------------------------------

/** K6/L7 — the tolerance the server uses for a unit quaternion. */
export const UNIT_TOLERANCE = 1e-3
/** K6/L7 — the smallest magnitude the server allows for a scale component. */
export const MIN_SCALE = 1e-6

// ---------------------------------------------------------------------------
// The predicates — copied from `send-policy.js` (A4 + K6/L7)
// ---------------------------------------------------------------------------

const isBool         = (v) => typeof v === 'boolean'
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isVec          = (v, n) => Array.isArray(v) && v.length === n && v.every(isFiniteNumber)
const isVec3         = (v) => isVec(v, 3)
const isVec4         = (v) => isVec(v, 4)

const isUnitQuaternion = (v) =>
  isVec4(v) && Math.abs(Math.hypot(v[0], v[1], v[2], v[3]) - 1) <= UNIT_TOLERANCE
const isNonZeroScale = (v) => isVec3(v) && v.every((s) => Math.abs(s) >= MIN_SCALE)

// ---------------------------------------------------------------------------
// The families the runner writes (G-L4: node transforms and visibility, light
// intensity and colour; the read-only matrices are never written)
// ---------------------------------------------------------------------------

/** A node field this module has an opinion about. */
export const NODE_VALUE_FIELDS = Object.freeze(['translation', 'rotation', 'scale', 'visible'])
/** A light field this module has an opinion about. */
export const LIGHT_VALUE_FIELDS = Object.freeze(['intensity', 'color'])

const NODE_VALUE_FIELD_SET = new Set(NODE_VALUE_FIELDS)
const LIGHT_VALUE_FIELD_SET = new Set(LIGHT_VALUE_FIELDS)

/**
 * G4/P23 — the server's own node VALUE check, as plain text.
 *
 * The order is the server's (`authorizeNodeSend`): a field not in
 * `NODE_VALUE_FIELDS` has no opinion here (`null`), because the runner writes
 * only G-L4's families and every other field's rule belongs to the server.
 *
 * @param {string} field
 * @param {*} value
 * @returns {string|null}  the server's refusal text, or null when the value is fine
 */
export function nodeValueProblem(field, value) {
  if (!NODE_VALUE_FIELD_SET.has(field)) return null
  if (field === 'visible') {
    return isBool(value) ? null : 'visible must be a boolean'
  }
  if (field === 'rotation') {
    if (!isVec4(value)) return 'rotation must be 4 finite numbers'
    return isUnitQuaternion(value) ? null : 'rotation must be a unit quaternion'
  }
  if (field === 'scale') {
    if (!isVec3(value)) return 'scale must be 3 finite numbers'
    return isNonZeroScale(value) ? null : 'scale components must be non-zero'
  }
  // translation
  return isVec3(value) ? null : `${field} must be 3 finite numbers`
}

/**
 * G4/P23 — the server's own light VALUE check, as plain text. Same shape and
 * same reason as `nodeValueProblem`.
 *
 * @param {string} field
 * @param {*} value
 * @returns {string|null}
 */
export function lightValueProblem(field, value) {
  if (!LIGHT_VALUE_FIELD_SET.has(field)) return null
  if (field === 'color') {
    return isVec3(value) ? null : 'color must be 3 finite numbers'
  }
  // intensity
  return isFiniteNumber(value) ? null : 'intensity must be a finite number'
}

/**
 * G4 — the value check for one queued write, by the queue's own `kind`.
 *
 * @param {'node'|'light'|'animation'|string} kind
 * @param {string} field
 * @param {*} value
 * @returns {string|null}
 */
export function writeValueProblem(kind, field, value) {
  if (kind === 'node') return nodeValueProblem(field, value)
  if (kind === 'light') return lightValueProblem(field, value)
  return null
}
