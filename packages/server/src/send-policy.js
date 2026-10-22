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
// Phase 3 server-cleanup adds K6 (L7): rotation and scale DO get ranges now —
// a rotation must be a unit quaternion (|‖q‖ − 1| ≤ 1e-3) and every scale
// component must be non-zero in magnitude (|s| ≥ 1e-6). Negative scale stays
// allowed (valid glTF; mirroring is legitimate). The checkers below are shared
// with `case 'add'` so `send` and `add` cannot drift.
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

/** A new name may not be longer than this (A5/D3). */
const NAME_MAX = 256

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

// K6/L7 — the transform-value ranges, named in one place (L7's last bullet).
export const UNIT_TOLERANCE = 1e-3
export const MIN_SCALE      = 1e-6

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

// K6/L7 — transform-value predicates. Plain IEEE doubles, no extra allowance
// (L7's numerical policy): a value computed to land exactly on a boundary may
// fall either side, so tests use values clearly inside or outside.
const isUnitQuaternion = (v) =>
  isVec4(v) && Math.abs(Math.hypot(v[0], v[1], v[2], v[3]) - 1) <= UNIT_TOLERANCE
const isNonZeroScale = (v) => isVec3(v) && v.every((s) => Math.abs(s) >= MIN_SCALE)

/**
 * K6/L7 — the shared transform-value check for an `add` descriptor.
 *
 * `send` checks the same two values inline through the same predicates; `add`
 * calls this so the two paths cannot drift. Only values that are present are
 * checked (an omitted rotation/scale keeps today's default).
 *
 * @param {{rotation?: *, scale?: *}} node
 * @returns {{ok: boolean, code: string|null, message: string|null}}
 */
export function checkTransformValues(node = {}) {
  if (node == null) return allow()
  if (node.rotation !== undefined && !isUnitQuaternion(node.rotation)) {
    return deny(SEND_INVALID, 'rotation must be a unit quaternion')
  }
  if (node.scale !== undefined && !isNonZeroScale(node.scale)) {
    return deny(SEND_INVALID, 'scale components must be non-zero')
  }
  return allow()
}

/**
 * L5/K4 — the shared destination checker. One exported checker for the
 * teleporter destination, used by both `session.js` (`add`) and this module
 * (`send`), so the two can't drift.
 *
 * @param {*} value
 * @returns {{ok: boolean, code: string|null, message: string|null}}
 */
export function checkTeleporterDestination(value) {
  if (typeof value !== 'string') {
    return deny(SEND_INVALID, 'destination must be a string')
  }
  return value.length <= DESTINATION_MAX
    ? allow()
    : deny(SEND_INVALID, `destination exceeds ${DESTINATION_MAX} characters`)
}

/**
 * L5/K4 — the `add`-path `extras.atrium` checker, row by row of the L5 table.
 *
 * A node that carries no `extras`, no own `atrium`, or no `teleporter` key is
 * accepted (it is not a teleporter). `extras.atrium` — and `teleporter` and
 * `model` — must be plain objects, and the destination, if the teleporter is
 * present, must be a string of at most 2048 characters. `""` is accepted, as
 * on `send`.
 *
 * models-by-url (Z1): the same call also runs the model value rules, so `add`
 * gets the model check with the teleporter check and before the first world
 * change. The "no mesh" half of Z1 needs the whole descriptor and lives in
 * `checkModelHost`, which the `add` handler calls with the node.
 *
 * @param {object|undefined|null} extras  the descriptor's own `node.extras`
 * @returns {{ok: boolean, code: string|null, message: string|null}}
 */
export function checkAtriumExtras(extras) {
  if (extras == null || typeof extras !== 'object') return allow()
  const atrium = extras.atrium
  if (atrium === undefined) return allow()
  if (!isPlainObject(atrium)) {
    return deny(SEND_INVALID, 'extras.atrium must be an object')
  }
  const teleporter = atrium.teleporter
  if (teleporter !== undefined) {
    if (!isPlainObject(teleporter)) {
      return deny(SEND_INVALID, 'teleporter must be an object')
    }
    const teleporterCheck = checkTeleporterDestination(teleporter.destination)
    if (!teleporterCheck.ok) return teleporterCheck
  }
  return checkModelValue(atrium.model)
}

// ---------------------------------------------------------------------------
// models-by-url (Z1, A1, A6, A12) — the model value rules
//
// One rule set, two implementations: this and the client's
// `packages/client/src/model-spec.js`, pinned to each other by
// `tests/fixtures/model-spec-vectors.json`, which both read. `checkModelValue`
// is the value half (called from `checkAtriumExtras`, so `add` gets it);
// `checkModelHost` adds the node half — a model node has no mesh — and is
// called by the `add` handler with the whole descriptor.
// ---------------------------------------------------------------------------

/** The URL cap (A1 rule 1). */
export const MODEL_URL_MAX = 2048
export const MODEL_BOUNDS_MIN = 0.001
export const MODEL_BOUNDS_MAX = 1000

/** The exact key set of `extras.atrium.model` (L4, strict). */
const MODEL_KEYS = ['url', 'sha256', 'bounds']

/** The base a root-relative URL is measured against; never fetched (A1). */
const RELATIVE_BASE = 'https://atrium.invalid'

const MODEL_MESSAGES = {
  'not-object':      'extras.atrium must be an object',
  'model-type':      'extras.atrium.model must be an object',
  'keys':            'extras.atrium.model must have exactly the keys url, sha256 and bounds, with url required',
  'url-type':        'url must be a string',
  'url-length':      `url must be 1 to ${MODEL_URL_MAX} characters`,
  'url-chars':       'url may not contain spaces, control characters or backslashes',
  'url-scheme':      'url must start with https:// or with a single /',
  'url-parse':       'url is not a valid https URL',
  'url-host':        'url must name a host',
  'url-credentials': 'url may not carry a username or password',
  'url-relative':    'url must stay on the same host',
  'sha256':          'sha256 must be 64 lowercase hex characters',
  'bounds':          `bounds must be three numbers from ${MODEL_BOUNDS_MIN} to ${MODEL_BOUNDS_MAX}`,
  'mesh':            'a node with extras.atrium.model cannot have a mesh',
}

const MODEL_SHA256_RE = /^[0-9a-f]{64}$/

/**
 * A1 — is `url` a valid stored model URL? Returns a reason code, or null.
 * The exact rule: see `packages/client/src/model-spec.js`, which mirrors it.
 *
 * @param {*} url
 * @returns {string|null}  reason code, or null when the URL is valid
 */
export function modelUrlProblem(url) {
  if (typeof url !== 'string') return 'url-type'
  if (url.length < 1 || url.length > MODEL_URL_MAX) return 'url-length'
  for (const ch of url) {
    const code = ch.codePointAt(0)
    if (code < 0x21 || code === 0x7f) return 'url-chars'
  }
  if (url.includes('\\')) return 'url-chars'

  if (url.startsWith('https://')) {
    let parsed
    try { parsed = new URL(url) } catch { return 'url-parse' }
    if (parsed.protocol !== 'https:') return 'url-scheme'
    if (!parsed.hostname) return 'url-host'
    if (parsed.username || parsed.password) return 'url-credentials'
    return null
  }

  if (url[0] === '/' && url[1] !== '/') {
    let parsed
    try { parsed = new URL(url, RELATIVE_BASE) } catch { return 'url-relative' }
    return parsed.origin === RELATIVE_BASE ? null : 'url-relative'
  }

  return 'url-scheme'
}

/**
 * L25a — the sky URL rule (library-sky Z5), mirroring the client's
 * `skyUrlProblem` (`packages/client/src/model-spec.js`).
 *
 * `extras.atrium.background.texture` may be a valid A1 URL, or `''` to clear
 * the sky. There are no legacy forms: a document-relative value is refused like
 * any other non-A1 value. The same reason codes as A1's, and the same vectors:
 * `tests/fixtures/sky-url-vectors.json` is read by this package's test and by
 * the client's, so the two implementations cannot drift.
 *
 * @param {*} texture
 * @returns {string|null}  a reason code, or null when the value is legal
 */
export function skyUrlProblem(texture) {
  if (typeof texture !== 'string') return 'url-type'
  if (texture === '') return null
  return modelUrlProblem(texture)
}

/** The reason code for an `extras.atrium.model` value, or null. */
export function modelValueProblem(model) {
  if (model === undefined) return null
  if (!isPlainObject(model)) return 'model-type'
  const keys = Object.keys(model)
  if (keys.some((k) => !MODEL_KEYS.includes(k))) return 'keys'
  if (!Object.hasOwn(model, 'url')) return 'keys'
  const urlProblem = modelUrlProblem(model.url)
  if (urlProblem) return urlProblem
  if (model.sha256 !== undefined &&
      !(typeof model.sha256 === 'string' && MODEL_SHA256_RE.test(model.sha256))) return 'sha256'
  if (model.bounds !== undefined) {
    const b = model.bounds
    if (!Array.isArray(b) || b.length !== 3) return 'bounds'
    for (const n of b) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return 'bounds'
      if (n < MODEL_BOUNDS_MIN || n > MODEL_BOUNDS_MAX) return 'bounds'
    }
  }
  return null
}

/** The reason code for an `extras` value, or null when it is not a model / is fine. */
export function modelExtrasProblem(extras) {
  if (extras == null || typeof extras !== 'object' || Array.isArray(extras)) return null
  const atrium = extras.atrium
  if (atrium === undefined) return null
  if (!isPlainObject(atrium)) return 'not-object'
  return modelValueProblem(atrium.model)
}

function modelDeny(reason) {
  return deny(SEND_INVALID, MODEL_MESSAGES[reason] ?? 'the model value is invalid')
}

/** The value half of Z1 (called from `checkAtriumExtras`). */
function checkModelValue(model) {
  const problem = modelValueProblem(model)
  return problem ? modelDeny(problem) : allow()
}

/**
 * Z1/A6 — the node-level check: the value rules plus "a node carrying
 * `extras.atrium.model` has no mesh". Called by the `add` handler so a mesh
 * and a model on one node are refused before the first world change.
 *
 * @param {object|undefined|null} node  the `add` descriptor
 * @returns {{ok: boolean, code: string|null, message: string|null}}
 */
export function checkModelHost(node) {
  if (node == null || typeof node !== 'object') return allow()
  const problem = modelExtrasProblem(node.extras)
  if (problem) return modelDeny(problem)
  if (node.extras?.atrium?.model !== undefined && node.mesh != null) return modelDeny('mesh')
  return allow()
}

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
  // library-sky Z5/L25a — a new sky value must be A1 or '' (which clears it).
  // The value already stored in a world is never re-checked: only changed
  // leaves are collected (authorizeDocumentSend).
  'atrium.background.texture':                          (v) => v === '' || skyUrlProblem(v) === null,
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
 * L11/K9 — a session owns an avatar node only after an accepted avatar `add`
 * (recorded in `session.avatarNode`). A session whose avatar add was refused
 * owns nothing, so its name is not a live avatar.
 *
 * @param {Iterable<{avatarNode?: {name: string}|null, avatarNodeName?: string|null}>} sessions
 * @returns {Set<string>}
 */
export function liveAvatarNames(sessions) {
  const names = new Set()
  for (const session of sessions ?? []) {
    if (session?.avatarNode) names.add(session.avatarNode.name)
  }
  return names
}

function isLiveAvatarName(name, avatarNames) {
  if (typeof name !== 'string' || name.length === 0) return false
  return typeof avatarNames.has === 'function' ? avatarNames.has(name) : false
}

/**
 * True when the resolved target is an externally loaded node (A4).
 *
 * The set holds the names `<container>/<child>` the server registered when it
 * ingested an external scene. The check reads the RESOLVED object's own name.
 *
 * @param {object|null} target
 * @param {Set<string>|null} externalNames
 * @returns {boolean}
 */
function isExternallyLoaded(target, externalNames) {
  if (!externalNames || typeof externalNames.has !== 'function') return false
  const name = typeof target?.name === 'string' ? target.name : null
  return name !== null && externalNames.has(name)
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
export function authorizeSend({ target, nodeName, field, value, avatarNames = null, currentExtras = null, externalNames = null } = {}) {
  if (!target) {
    return deny(SEND_NODE_MISSING, `${SEND_NODE_MISSING}: ${nodeName}`)
  }
  if (typeof field !== 'string' || field.length === 0) {
    return deny(SEND_DENIED, 'field must be a non-empty string')
  }

  // A4/A9 — an externally loaded node is never writable through `send`,
  // whatever the field. Closes the item carried from step 0c §6.1. The check
  // names the RESOLVED node, never the addressed string.
  if (isExternallyLoaded(target, externalNames)) {
    return deny(SEND_DENIED, 'externally loaded nodes cannot be edited')
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
    // K6/L7 — rotation and scale now carry ranges. The shape messages are kept
    // (a wrong-length vector still says so); the value messages are new.
    if (field === 'rotation') {
      if (!isVec4(value)) return deny(SEND_INVALID, 'rotation must be 4 finite numbers')
      return isUnitQuaternion(value) ? allow() : deny(SEND_INVALID, 'rotation must be a unit quaternion')
    }
    if (field === 'scale') {
      if (!isVec3(value)) return deny(SEND_INVALID, `${field} must be 3 finite numbers`)
      return isNonZeroScale(value) ? allow() : deny(SEND_INVALID, 'scale components must be non-zero')
    }
    return isVec3(value) ? allow() : deny(SEND_INVALID, `${field} must be 3 finite numbers`)
  }

  // A8/A9 — the one new node field: a rename. The value must be a string; the
  // D3 rules (length, reserved forms, uniqueness) are enforced by the server's
  // rename branch in world.setField, which returns INVALID_VALUE.
  if (field === 'name') {
    return typeof value === 'string'
      ? allow()
      : deny(SEND_INVALID, `name must be a non-empty string of at most ${NAME_MAX} characters`)
  }

  // The single node extras leaf (D2): the teleporter destination. L5/K4 — the
  // same exported checker the `add` path uses.
  if (field === TELEPORTER_LEAF) {
    return checkTeleporterDestination(value)
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
