// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * add-spec.js — the `add` node rule, client half (add-check A1–A5, A9).
 * Pure and renderer-neutral: no DOM, no three.js, no fetch.
 *
 * `checkAddNode(node, { avatar })` is the same rule the server's
 * `checkAddNode` (`packages/server/src/send-policy.js`) applies, pinned to it by
 * `tests/fixtures/add-node-vectors.json`, which both read, so neither can
 * drift. It returns `null` when the node is accepted, or `{ code, message }`.
 *
 * `edit-duplicate.js` runs it on the descriptor it built, at click time, so a
 * node the server would refuse is never sent. A9's range predicates are
 * exported too, so the client's material ranges are the server's.
 */

/** A5 — an avatar mesh carries exactly one primitive (its own budget). */
export const AVATAR_PRIMITIVES = 1
/** A5 — an avatar primitive keeps at most 1,024 vertices. */
export const AVATAR_VERTEX_MAX = 1024
/** A5 — an avatar mesh keeps at most 6,144 indices. */
export const AVATAR_INDEX_MAX = 6144
/** A3 — a mesh keeps at most 64 primitives. */
export const PRIMITIVE_MAX = 64
/** A3 — a primitive keeps at most 65,535 vertices (so no index is 65,535). */
export const VERTEX_MAX = 65535
/** A3 — a mesh name is at most 256 characters. */
export const MESH_NAME_MAX = 256
/** A2 — non-Atrium `extras` carries at most 16 KiB of UTF-8. */
export const NODE_EXTRAS_BYTES_MAX = 16 * 1024

/** The server's D3 node-name cap (send-policy.js NAME_MAX). */
const NAME_MAX = 256

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** A4/A9 — a finite number in [0, 1]. */
export function isUnitRange(v) {
  return isFiniteNumber(v) && v >= 0 && v <= 1
}
/** A4/A9 — four finite numbers in [0, 1]. */
export function isUnitRangeVec4(v) {
  return Array.isArray(v) && v.length === 4 && v.every(isUnitRange)
}
/** A4/A9 — a finite number that is zero or more. */
export function isNonNegativeFinite(v) {
  return isFiniteNumber(v) && v >= 0
}
/** A3 — a number finite as a Float32 (`1e39` is a finite double, refused). */
export function isFloat32(v) {
  return typeof v === 'number' && Number.isFinite(Math.fround(v))
}

/** A1 — the shared reason codes and their plain text. */
export const ADD_REASONS = Object.freeze({
  'extensions':        'extensions must be empty or absent',
  'extras-size':       `extras other than atrium must be at most ${NODE_EXTRAS_BYTES_MAX} bytes`,
  'avatar-extras':     'an avatar extras must have at most displayName and atrium',
  'mesh-keys':         'mesh must have only a name and primitives',
  'mesh-name':         `mesh name must be a string of at most ${MESH_NAME_MAX} characters`,
  'primitives-count':  `mesh must have 1 to ${PRIMITIVE_MAX} primitives`,
  'primitive-keys':    'each primitive must have only attributes, indices and material',
  'attribute-keys':    'attributes must have POSITION and, optionally, NORMAL',
  'position-length':   `POSITION must be an array of at least 9 numbers, a multiple of 3, and at most ${3 * VERTEX_MAX}`,
  'position-value':    'every POSITION value must be a number finite as a Float32',
  'normal-length':     'NORMAL must be an array of the same length as POSITION',
  'normal-value':      'every NORMAL value must be a number finite as a Float32',
  'indices-length':    'indices must be an array of at least 3 integers, its length a multiple of 3',
  'indices-value':     'every index must be an integer within the vertex count',
  'material-keys':     'material must have only pbrMetallicRoughness',
  'material-value':    'material values must be finite, and colours and factors within 0 to 1',
  'avatar-primitives': `an avatar mesh must have exactly ${AVATAR_PRIMITIVES} primitive`,
  'avatar-vertices':   `an avatar primitive must have at most ${AVATAR_VERTEX_MAX} vertices`,
  'avatar-indices':    `an avatar mesh must have at most ${AVATAR_INDEX_MAX} indices`,
})

/** The plain text for an `add`-rule reason code. */
export function addReasonText(reason) {
  return ADD_REASONS[reason] ?? 'the node is invalid'
}

function addDeny(reason) {
  return { code: reason, message: addReasonText(reason) }
}

/** `{...}` with no keys (a non-object is not "extensions"). */
function isEmptyExtensions(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.keys(v).length === 0
}

const ENCODER = new TextEncoder()

/** UTF-8 byte length of a JSON-serialized value; `Infinity` when unserializable. */
function jsonBytes(value) {
  let json
  try { json = JSON.stringify(value) } catch { return Infinity }
  if (json === undefined) return Infinity
  return ENCODER.encode(json).length
}

/** A2/A5 — the avatar extras rule. Returns a reason code, or null. */
function avatarExtrasProblem(extras) {
  if (extras === undefined || extras === null) return null
  if (!isPlainObject(extras)) return 'avatar-extras'
  for (const key of Object.keys(extras)) {
    if (key !== 'displayName' && key !== 'atrium') return 'avatar-extras'
  }
  if (extras.displayName !== undefined) {
    if (typeof extras.displayName !== 'string' || extras.displayName.length > NAME_MAX) return 'avatar-extras'
  }
  return null
}

/** A2 — the world-add extras-byte rule. Returns a reason code, or null. */
function worldExtrasProblem(extras) {
  if (extras === undefined || extras === null || typeof extras !== 'object' || Array.isArray(extras)) return null
  const rest = {}
  for (const key of Object.keys(extras)) {
    if (key === 'atrium') continue
    rest[key] = extras[key]
  }
  if (Object.keys(rest).length === 0) return null
  return jsonBytes(rest) > NODE_EXTRAS_BYTES_MAX ? 'extras-size' : null
}

/** A4 — the material rule. Returns a reason code, or null. */
function materialAddProblem(material) {
  if (material === undefined || material === null) return null
  if (!isPlainObject(material)) return 'material-keys'
  for (const key of Object.keys(material)) {
    if (key !== 'pbrMetallicRoughness') return 'material-keys'
  }
  const pbr = material.pbrMetallicRoughness
  if (pbr === undefined) return null
  if (!isPlainObject(pbr)) return 'material-keys'
  for (const key of Object.keys(pbr)) {
    if (key !== 'baseColorFactor' && key !== 'metallicFactor' && key !== 'roughnessFactor') return 'material-keys'
  }
  if (pbr.baseColorFactor !== undefined && !isUnitRangeVec4(pbr.baseColorFactor)) return 'material-value'
  if (pbr.metallicFactor !== undefined && !isUnitRange(pbr.metallicFactor)) return 'material-value'
  if (pbr.roughnessFactor !== undefined && !isUnitRange(pbr.roughnessFactor)) return 'material-value'
  return null
}

/** A3 — one primitive's rule. Returns a reason code, or null. */
function primitiveAddProblem(prim, { avatar }) {
  if (!isPlainObject(prim)) return 'primitive-keys'
  for (const key of Object.keys(prim)) {
    if (key !== 'attributes' && key !== 'indices' && key !== 'material') return 'primitive-keys'
  }
  const attributes = prim.attributes
  if (!isPlainObject(attributes) || !Object.hasOwn(attributes, 'POSITION')) return 'attribute-keys'
  for (const key of Object.keys(attributes)) {
    if (key !== 'POSITION' && key !== 'NORMAL') return 'attribute-keys'
  }
  const position = attributes.POSITION
  if (!Array.isArray(position) || position.length < 9 ||
      position.length % 3 !== 0 || position.length > 3 * VERTEX_MAX) return 'position-length'
  const normal = attributes.NORMAL
  if (normal !== undefined && (!Array.isArray(normal) || normal.length !== position.length)) {
    return 'normal-length'
  }
  const vertexCount = position.length / 3
  if (avatar && vertexCount > AVATAR_VERTEX_MAX) return 'avatar-vertices'
  for (const v of position) if (!isFloat32(v)) return 'position-value'
  if (normal !== undefined) {
    for (const v of normal) if (!isFloat32(v)) return 'normal-value'
  }
  const indices = prim.indices
  if (indices !== undefined && indices !== null) {
    if (!Array.isArray(indices) || indices.length < 3 || indices.length % 3 !== 0) return 'indices-length'
    if (avatar && indices.length > AVATAR_INDEX_MAX) return 'avatar-indices'
    for (const i of indices) {
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= vertexCount) return 'indices-value'
    }
  } else {
    if (vertexCount % 3 !== 0) return 'indices-length'
  }
  return materialAddProblem(prim.material)
}

/** A3/A5 — the mesh rule. Returns a reason code, or null. */
function meshAddProblem(mesh, { avatar }) {
  if (!isPlainObject(mesh)) return 'mesh-keys'
  for (const key of Object.keys(mesh)) {
    if (key !== 'name' && key !== 'primitives') return 'mesh-keys'
  }
  if (mesh.name !== undefined) {
    if (typeof mesh.name !== 'string' || mesh.name.length > MESH_NAME_MAX) return 'mesh-name'
  }
  const primitives = mesh.primitives
  if (!Array.isArray(primitives)) return 'primitives-count'
  if (avatar) {
    if (primitives.length !== AVATAR_PRIMITIVES) return 'avatar-primitives'
  } else {
    if (primitives.length < 1 || primitives.length > PRIMITIVE_MAX) return 'primitives-count'
  }
  for (const prim of primitives) {
    const problem = primitiveAddProblem(prim, { avatar })
    if (problem) return problem
  }
  return null
}

/**
 * A1–A5 — the `add` node rule. Returns `null` when the node is accepted, or
 * `{ code, message }`. `avatar` selects the avatar budget (A5) and the avatar
 * `extras` rule.
 *
 * @param {*} node
 * @param {{avatar?: boolean}} [opts]
 * @returns {null | { code: string, message: string }}
 */
export function checkAddNode(node, { avatar = false } = {}) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return null

  if (node.extensions !== undefined && !isEmptyExtensions(node.extensions)) {
    return addDeny('extensions')
  }

  const extrasProblem = avatar ? avatarExtrasProblem(node.extras) : worldExtrasProblem(node.extras)
  if (extrasProblem) return addDeny(extrasProblem)

  if (node.mesh !== undefined && node.mesh !== null) {
    const problem = meshAddProblem(node.mesh, { avatar })
    if (problem) return addDeny(problem)
  }

  return null
}
