// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// send-policy — the `send` field allowlist (Phase 3 step 0c, security hardening)
//
// A `send` names a target (`msg.node`) and a path (`msg.field`), both chosen by
// the client. `SOMDocument.setPath` walks any JavaScript property of the target
// and `parsePath` ignores stray dots, so a path can leave the named target
// (`node='Child', field='parent.extras'`) and plain `in`-style checks keyed on
// `msg.node` can be sidestepped. This module defines what a `send` may write and
// refuses everything else (default deny).
//
// Design rules enforced here (pre-brief §3, operator-approved decisions D1–D5):
//   A1 — resolve the target, classify the *resolved object* by its class (never
//        by its name), then allow only exact operations for that class.
//   A2 — canonical path spelling only; exact match on the whole path, never a
//        prefix or substring check. The checker never calls resolvePath/setPath
//        to discover where a path lands — it validates the spelling and then
//        reads the target's own accessors.
//   A3 — World Info (`__document__`/`extras`): authorize the *changes*, not the
//        container. Only listed leaves may change; unknown keys pass untouched.
//   A4 — value checks are type / length / enum / finite only. No new ranges.
//
// The module is pure and side-effect free: it decides, it never mutates.
// ---------------------------------------------------------------------------

import { SOMDocument, SOMNode, SOMCamera, SOMLight, SOMAnimation } from '@atrium/som'

// ---------------------------------------------------------------------------
// Error codes (A5)
// ---------------------------------------------------------------------------

export const SEND_DENIED       = 'PERMISSION_DENIED'
export const SEND_INVALID      = 'INVALID_VALUE'
export const SEND_INVALID_FIELD = 'INVALID_FIELD'
export const SEND_NODE_MISSING = 'NODE_NOT_FOUND'

// ---------------------------------------------------------------------------
// Allowed operations per target class
// ---------------------------------------------------------------------------

/** Node fields allowed by D1/A2. `extras` is deliberately not here (D2). */
const NODE_FIELDS = new Set(['translation', 'rotation', 'scale', 'visible'])

/** The material chain, exactly as the client listeners spell it (A2). */
const MATERIAL_PATH_RE = /^mesh\.primitives\[(0|[1-9][0-9]*)\]\.material\.([A-Za-z]+)$/

const MATERIAL_PROPS = new Set([
  'baseColorFactor',
  'metallicFactor',
  'roughnessFactor',
  'emissiveFactor',
  'alphaMode',
  'alphaCutoff',
  'doubleSided',
])

/** The one node extras leaf that first-party code writes (teleporter). */
const TELEPORTER_LEAF = 'extras.atrium.teleporter.destination'

const CAMERA_FIELDS = new Set(['type', 'yfov', 'aspectRatio', 'znear', 'zfar', 'xmag', 'ymag'])
const CAMERA_TYPES  = new Set(['perspective', 'orthographic'])

const LIGHT_FIELDS = new Set(['color', 'intensity', 'type', 'range', 'innerConeAngle', 'outerConeAngle'])
const LIGHT_TYPES  = new Set(['directional', 'point', 'spot'])

const ANIMATION_FIELDS = new Set(['playback'])

const DESTINATION_MAX = 2048

// ---------------------------------------------------------------------------
// A4 — value predicates (type / length / enum / finite only)
// ---------------------------------------------------------------------------

const isBool         = (v) => typeof v === 'boolean'
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isVec          = (v, n) => Array.isArray(v) && v.length === n && v.every(isFiniteNumber)
const isVec3         = (v) => isVec(v, 3)
const isVec4         = (v) => isVec(v, 4)
const isBoundedString = (v) => typeof v === 'string' && v.length <= DESTINATION_MAX
const isNullableNumber = (v) => v === null || isFiniteNumber(v)

const PLAYBACK_BOOL_KEYS     = ['playing', 'paused', 'loop', 'autoStart']
const PLAYBACK_NUMBER_KEYS   = ['timeScale', 'startTime']
const PLAYBACK_NULLABLE_KEYS = ['startWallClock', 'pauseTime']

/** The `SOMAnimation` playback schema — the exact key set the getters expose. */
export function isValidPlayback(value) {
  if (!isPlainObject(value)) return false
  const allowed = new Set([...PLAYBACK_BOOL_KEYS, ...PLAYBACK_NUMBER_KEYS, ...PLAYBACK_NULLABLE_KEYS])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return false
    const v = value[key]
    if (PLAYBACK_BOOL_KEYS.includes(key) && !isBool(v)) return false
    if (PLAYBACK_NUMBER_KEYS.includes(key) && !isFiniteNumber(v)) return false
    if (PLAYBACK_NULLABLE_KEYS.includes(key) && !isNullableNumber(v)) return false
  }
  return true
}

function materialValueOk(prop, value) {
  switch (prop) {
    case 'baseColorFactor':  return isVec4(value)
    case 'emissiveFactor':   return isVec3(value)
    case 'metallicFactor':
    case 'roughnessFactor':
    case 'alphaCutoff':      return isFiniteNumber(value)
    case 'alphaMode':        return value === 'OPAQUE' || value === 'MASK' || value === 'BLEND'
    case 'doubleSided':      return isBool(value)
    default:                 return false
  }
}

// ---------------------------------------------------------------------------
// A3 — World Info leaves. Paths are relative to the ROOT extras object, so the
// list is prefixed with `atrium.`. A change to any path not listed here is
// refused, which is what makes the container itself unwritable.
// ---------------------------------------------------------------------------

const WORLD_INFO_LEAVES = {
  'atrium.name':                                        isBoundedString,
  'atrium.description':                                 isBoundedString,
  'atrium.author':                                      isBoundedString,
  'atrium.background.type':                             (v) => v === 'equirectangular' || v === 'cubemap',
  'atrium.background.texture':                          isBoundedString,
  'atrium.navigation.speed.default':                    isFiniteNumber,
  'atrium.navigation.speed.min':                        isFiniteNumber,
  'atrium.navigation.speed.max':                        isFiniteNumber,
  'atrium.navigation.terrainFollowing':                 isBool,
  'atrium.navigation.collision.enabled':                isBool,
  'atrium.navigation.updateRate.positionInterval':      isFiniteNumber,
  'atrium.navigation.updateRate.maxViewRate':           isFiniteNumber,
}

const MAX_EXTRAS_DEPTH = 8
const MAX_EXTRAS_BYTES = 64 * 1024
const FORBIDDEN_KEYS   = new Set(['__proto__', 'prototype', 'constructor'])

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function jsonEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) {
    // undefined vs value → not equal
    return false
  }
  if (typeof a !== 'object' || a === null || b === null) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** Deepest nesting of plain objects/arrays; a scalar is depth 1. */
function maxDepth(value, depth = 1) {
  if (typeof value !== 'object' || value === null) return depth
  let deepest = depth
  for (const v of Object.values(value)) {
    const d = maxDepth(v, depth + 1)
    if (d > deepest) deepest = d
  }
  return deepest
}

/** True if any key at any depth is __proto__ / prototype / constructor. */
function hasForbiddenKey(value) {
  if (typeof value !== 'object' || value === null) return false
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true
    if (hasForbiddenKey(value[key])) return true
  }
  return false
}

/**
 * List every changed leaf between two JSON values.
 *
 * A missing intermediate object is treated as part of the leaf it holds: when
 * the current side has no (or a non-object) value where the proposed side has
 * an object, the walk descends into the proposed subtree so the leaves are
 * reported individually (A3 rule 5).
 *
 * @param {*} current
 * @param {*} proposed
 * @param {string} path    dotted path of the current node, '' at the root
 * @param {Array<{path: string, value: *}>} out
 * @param {number} depth
 */
function collectChanges(current, proposed, path, out, depth) {
  if (depth > MAX_EXTRAS_DEPTH + 2) {
    out.push({ path, value: proposed })
    return
  }
  const currentIsObject  = isPlainObject(current)
  const proposedIsObject = isPlainObject(proposed)

  if (currentIsObject && proposedIsObject) {
    const keys = new Set([...Object.keys(current), ...Object.keys(proposed)])
    for (const key of keys) {
      collectChanges(current[key], proposed[key], path ? `${path}.${key}` : key, out, depth + 1)
    }
    return
  }

  if (proposedIsObject) {
    const keys = Object.keys(proposed)
    if (keys.length === 0) {
      if (!jsonEqual(current, proposed)) out.push({ path, value: proposed })
      return
    }
    // New (or type-changed) subtree — descend so each leaf is reported.
    for (const key of keys) {
      collectChanges(undefined, proposed[key], path ? `${path}.${key}` : key, out, depth + 1)
    }
    return
  }

  if (currentIsObject || !jsonEqual(current, proposed)) {
    out.push({ path, value: proposed })
  }
}

// ---------------------------------------------------------------------------
// Decision helpers
// ---------------------------------------------------------------------------

const allow = () => ({ ok: true, code: null, message: null })
const deny  = (code, message) => ({ ok: false, code, message })

/**
 * Resolve `msg.node` exactly the way `world.setField` does.
 *
 * @param {object} som       SOMDocument
 * @param {string} nodeName
 * @returns {object|null}    the resolved SOM object, or null
 */
export function resolveSendTarget(som, nodeName) {
  if (!som || typeof nodeName !== 'string' || nodeName.length === 0) return null
  return som.getObjectByName(nodeName) ?? null
}

/**
 * Collect the node names of live avatar sessions.
 *
 * The server is authoritative over avatar nodes; the names come from the live
 * sessions map, never from a name prefix the client could imitate.
 *
 * @param {Iterable<{avatarNodeName?: string|null}>} sessions
 * @returns {Set<string>}
 */
export function liveAvatarNames(sessions) {
  const names = new Set()
  for (const session of sessions ?? []) {
    if (session?.avatarNodeName) names.add(session.avatarNodeName)
  }
  return names
}

function isLiveAvatarName(name, avatarNames) {
  if (typeof name !== 'string' || name.length === 0) return false
  return typeof avatarNames.has === 'function' ? avatarNames.has(name) : false
}

/**
 * Decide whether a `send` may be applied.
 *
 * Pure: nothing is read from or written to the world beyond the target's own
 * accessors, and nothing is mutated.
 *
 * @param {object}  args
 * @param {object}  args.target            resolved SOM object (see resolveSendTarget)
 * @param {string}  args.nodeName          the name the client addressed
 * @param {string}  args.field             the path the client addressed
 * @param {*}       args.value             the proposed value
 * @param {Set<string>|Array<string>} [args.avatarNames]  live avatar node names
 * @param {object}  [args.currentExtras]   the document's current root extras (A3)
 * @returns {{ok: boolean, code: string|null, message: string|null}}
 */
export function authorizeSend({ target, nodeName, field, value, avatarNames = null, currentExtras = null } = {}) {
  if (!target) {
    return deny(SEND_NODE_MISSING, `${SEND_NODE_MISSING}: ${nodeName}`)
  }
  if (typeof field !== 'string' || field.length === 0) {
    return deny(SEND_DENIED, 'field must be a non-empty string')
  }

  if (target instanceof SOMDocument) {
    return authorizeDocumentSend(field, value, currentExtras)
  }
  if (target instanceof SOMNode) {
    // Live avatars are server-controlled: refuse every send, for everyone,
    // including the world owner, in every world mode. The check names the
    // RESOLVED node, not the addressed string, so a name that merely looks
    // like an avatar cannot smuggle a write through.
    const isLiveAvatar = avatarNames !== null && isLiveAvatarName(target.name, avatarNames)
    return authorizeNodeSend({ node: target, field, value, isLiveAvatar })
  }
  if (target instanceof SOMCamera) {
    return authorizeCameraSend({ camera: target, nodeName, field, value })
  }
  if (target instanceof SOMLight) {
    return authorizeLightSend({ light: target, nodeName, field, value })
  }
  if (target instanceof SOMAnimation) {
    return authorizeAnimationSend(field, value)
  }

  // Scene, mesh, primitive, material, skin, texture, anything unknown.
  return deny(SEND_DENIED, 'target is not writable through send')
}

// ---------------------------------------------------------------------------
// SOMNode
// ---------------------------------------------------------------------------

function authorizeNodeSend({ node, field, value, isLiveAvatar }) {
  // Live avatars are server-controlled: refuse every send, for everyone,
  // including the world owner, in every world mode.
  if (isLiveAvatar) {
    return deny(SEND_DENIED, 'live avatar nodes are server-controlled')
  }

  if (NODE_FIELDS.has(field)) {
    if (field === 'visible') return isBool(value) ? allow() : deny(SEND_INVALID, 'visible must be a boolean')
    if (field === 'rotation') return isVec4(value) ? allow() : deny(SEND_INVALID, 'rotation must be 4 finite numbers')
    return isVec3(value) ? allow() : deny(SEND_INVALID, `${field} must be 3 finite numbers`)
  }

  // The single node extras leaf (D2): the teleporter destination.
  if (field === TELEPORTER_LEAF) {
    return isBoundedString(value)
      ? allow()
      : deny(SEND_INVALID, `destination exceeds ${DESTINATION_MAX} characters`)
  }

  const materialMatch = MATERIAL_PATH_RE.exec(field)
  if (materialMatch) {
    return authorizeMaterialChain(node, Number(materialMatch[1]), materialMatch[2], value)
  }

  // Whole `extras` / `extras.atrium` replacement, `name`, `parent`, internals,
  // non-canonical spellings, unknown fields — all refused.
  return deny(SEND_DENIED, 'field is not writable on a node')
}

/**
 * The material chain is checked step by step: SOMNode → mesh → primitives[N] →
 * material → <allowed property>. A missing link or an out-of-range index is
 * INVALID_FIELD; the property itself is checked by A4.
 */
function authorizeMaterialChain(node, index, prop, value) {
  if (!MATERIAL_PROPS.has(prop)) {
    return deny(SEND_DENIED, 'field is not a writable material property')
  }
  const mesh = node.mesh
  if (!mesh) return deny(SEND_INVALID_FIELD, 'node has no mesh')
  const primitives = mesh.primitives
  if (!Array.isArray(primitives) || index >= primitives.length) {
    return deny(SEND_INVALID_FIELD, 'primitive index out of range')
  }
  const primitive = primitives[index]
  if (!primitive) return deny(SEND_INVALID_FIELD, 'primitive does not exist')
  const material = primitive.material
  if (!material) return deny(SEND_INVALID_FIELD, 'primitive has no material')

  return materialValueOk(prop, value)
    ? allow()
    : deny(SEND_INVALID, `${prop} has an invalid value`)
}

// ---------------------------------------------------------------------------
// SOMCamera / SOMLight — addressable only by the qualified alias
// ---------------------------------------------------------------------------

function authorizeCameraSend({ camera, nodeName, field, value }) {
  if (nodeName !== camera.qualifiedName) {
    return deny(SEND_DENIED, 'cameras must be addressed by their qualified name')
  }
  if (!CAMERA_FIELDS.has(field)) {
    return deny(SEND_DENIED, 'field is not writable on a camera')
  }
  if (field === 'type') {
    return CAMERA_TYPES.has(value) ? allow() : deny(SEND_INVALID, 'type must be perspective or orthographic')
  }
  return isFiniteNumber(value) ? allow() : deny(SEND_INVALID, `${field} must be a finite number`)
}

function authorizeLightSend({ light, nodeName, field, value }) {
  if (nodeName !== light.qualifiedName) {
    return deny(SEND_DENIED, 'lights must be addressed by their qualified name')
  }
  if (!LIGHT_FIELDS.has(field)) {
    return deny(SEND_DENIED, 'field is not writable on a light')
  }
  if (field === 'type') {
    return LIGHT_TYPES.has(value) ? allow() : deny(SEND_INVALID, 'type must be directional, point or spot')
  }
  if (field === 'range') {
    return isNullableNumber(value) ? allow() : deny(SEND_INVALID, 'range must be a finite number or null')
  }
  if (field === 'color') {
    return isVec3(value) ? allow() : deny(SEND_INVALID, 'color must be 3 finite numbers')
  }
  return isFiniteNumber(value) ? allow() : deny(SEND_INVALID, `${field} must be a finite number`)
}

// ---------------------------------------------------------------------------
// SOMAnimation — playback only
// ---------------------------------------------------------------------------

function authorizeAnimationSend(field, value) {
  if (!ANIMATION_FIELDS.has(field)) {
    return deny(SEND_DENIED, 'field is not writable on an animation')
  }
  return isValidPlayback(value) ? allow() : deny(SEND_INVALID, 'playback has an invalid shape')
}

// ---------------------------------------------------------------------------
// SOMDocument — World Info: authorize the changes, not the container (A3)
// ---------------------------------------------------------------------------

function authorizeDocumentSend(field, value, currentExtras) {
  if (field !== 'extras') {
    return deny(SEND_DENIED, 'only the document extras may be set')
  }
  if (!isPlainObject(value)) {
    return deny(SEND_DENIED, 'document extras must be a plain object')
  }

  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    return deny(SEND_DENIED, 'document extras are not serializable')
  }
  if (serialized === undefined || serialized.length > MAX_EXTRAS_BYTES) {
    return deny(SEND_DENIED, 'document extras exceed the size limit')
  }
  if (maxDepth(value) > MAX_EXTRAS_DEPTH) {
    return deny(SEND_DENIED, 'document extras exceed the depth limit')
  }
  if (hasForbiddenKey(value)) {
    return deny(SEND_DENIED, 'document extras contain a reserved key')
  }

  const changes = []
  collectChanges(isPlainObject(currentExtras) ? currentExtras : {}, value, '', changes, 0)

  for (const change of changes) {
    const validate = WORLD_INFO_LEAVES[change.path]
    // One unauthorized change refuses the whole message.
    if (!validate) return deny(SEND_DENIED, 'only World Info leaves may change')
    if (!validate(change.value)) return deny(SEND_INVALID, 'World Info value has an invalid type')
  }

  return allow()
}
