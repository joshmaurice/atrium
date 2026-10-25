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
import { validateInteractivityGraph } from '@khronosgroup/gltf-interactivity-engine'

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
  const modelCheck = checkModelValue(atrium.model)
  if (!modelCheck.ok) return modelCheck
  // Z2 — `atrium.animation` is checked when the key is PRESENT (null included):
  // absent or null is accepted on a model node, any other value must pass Z1,
  // and a node that carries the key must carry `atrium.model`.
  if (Object.hasOwn(atrium, 'animation')) {
    const animation = atrium.animation
    if (animation !== null) {
      const problem = animationValueProblem(animation)
      if (problem) return animationDeny(problem)
    }
    if (!carriesModel({ extras })) return animationDeny('model-node')
  }
  // 4b-1 E3 — `atrium.objectId` is checked when the key is PRESENT: the value
  // must pass E1. UNIQUENESS is the `add` handler's, because it needs the world.
  if (Object.hasOwn(atrium, 'objectId')) {
    const problem = objectIdProblem(atrium.objectId)
    if (problem) return deny(SEND_INVALID, objectIdReasonText(problem))
  }
  // scripting-4b-2 F2/C3 — `atrium.behavior` is checked when the key is PRESENT,
  // with the descriptor's own `objectId` as the node's id. A behaviour with no
  // object id is refused here, before the first world change.
  const behaviorCheckResult = checkAtriumBehavior(extras)
  if (!behaviorCheckResult.ok) return behaviorCheckResult
  return allow()
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

// ---------------------------------------------------------------------------
// scripting-4a (Z1, Z2) — `extras.atrium.animation`, the second writable node
// extras leaf
//
// One rule set, two implementations: this and the client's
// `packages/client/src/animation-spec.js`, pinned to each other by
// `tests/fixtures/animation-spec-vectors.json`, which both read.
// ---------------------------------------------------------------------------

/** The one node extras leaf 4a adds (L1/Z2). */
export const ANIMATION_LEAF = 'extras.atrium.animation'

/** The exact key set of the animation value (Z1). */
const ANIMATION_KEYS = ['clip', 'playing', 'loop', 'speed', 'startedAt']

/** Z1's bounds. `clip` goes to 300 for a cut-to-250 stem plus a ` (n)` suffix. */
export const ANIMATION_CLIP_MAX      = 300
export const ANIMATION_SPEED_MIN     = 0.1
export const ANIMATION_SPEED_MAX     = 10
export const ANIMATION_STARTED_MAX   = Number.MAX_SAFE_INTEGER

/** The reason codes and their plain text (Z1). */
export const ANIMATION_MESSAGES = {
  'animation-type': 'extras.atrium.animation must be an object',
  'keys':           'extras.atrium.animation must have exactly the keys clip, playing, loop, speed and startedAt',
  'clip':           `clip must be a string of 1 to ${ANIMATION_CLIP_MAX} characters`,
  'playing':        'playing must be a boolean',
  'loop':           'loop must be a boolean',
  'speed':          `speed must be a number from ${ANIMATION_SPEED_MIN} to ${ANIMATION_SPEED_MAX}`,
  'startedAt':      `startedAt must be an integer from 0 to ${ANIMATION_STARTED_MAX}`,
  'model-node':     'extras.atrium.animation is only allowed on a model node',
}

/** The plain text for an animation reason code. */
export function animationReasonText(reason) {
  return ANIMATION_MESSAGES[reason] ?? 'the animation value is invalid'
}

/**
 * Z1 — the value rule for `extras.atrium.animation`. Returns a reason code or
 * null. `null` is NOT a case here: it is the separate "stopped" value the server
 * accepts on a model node (Z2).
 *
 * @param {*} value
 * @returns {string|null}
 */
export function animationValueProblem(value) {
  if (!isPlainObject(value)) return 'animation-type'
  const keys = Object.keys(value)
  if (keys.length !== ANIMATION_KEYS.length) return 'keys'
  for (const key of keys) if (!ANIMATION_KEYS.includes(key)) return 'keys'
  if (typeof value.clip !== 'string' || value.clip.length < 1 || value.clip.length > ANIMATION_CLIP_MAX) return 'clip'
  if (!isBool(value.playing)) return 'playing'
  if (!isBool(value.loop)) return 'loop'
  if (!isFiniteNumber(value.speed) || value.speed < ANIMATION_SPEED_MIN || value.speed > ANIMATION_SPEED_MAX) return 'speed'
  const startedAt = value.startedAt
  if (typeof startedAt !== 'number' || !Number.isInteger(startedAt) ||
      startedAt < 0 || startedAt > ANIMATION_STARTED_MAX) return 'startedAt'
  return null
}

/** Z2 — a node carries a model (the leaf is only allowed there). */
function carriesModel(node) {
  const model = node?.extras?.atrium?.model
  return model !== undefined && model !== null
}

function animationDeny(reason) {
  return deny(SEND_INVALID, animationReasonText(reason))
}

/** Z2 — the `send` half: the node rule, then the value rule, then null. */
export function checkAnimationValue(node, value) {
  if (!carriesModel(node)) return deny(SEND_INVALID_FIELD, ANIMATION_MESSAGES['model-node'])
  if (value === null) return allow()
  const problem = animationValueProblem(value)
  return problem ? animationDeny(problem) : allow()
}

/** The value half of Z1 (called from `checkAtriumExtras`). */
function checkModelValue(model) {
  const problem = modelValueProblem(model)
  return problem ? modelDeny(problem) : allow()
}

// ---------------------------------------------------------------------------
// scripting-4b-1 (E1, E3) — `extras.atrium.objectId`, the set-once identity leaf
//
// One rule set, two implementations: this and the client's
// `packages/client/src/object-id.js`, pinned to each other by
// `tests/fixtures/object-id-vectors.json`, which both tests read.
// ---------------------------------------------------------------------------

/** E1 — a lowercase RFC 4122 version-4 UUID (E-L1). */
export const OBJECT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The exact plain text of the uniqueness refusal (E3; reviewed S-B). */
export const OBJECT_ID_TAKEN = 'objectId is already taken in this world'

/** The set-once node extras leaf (E-L3). */
export const OBJECT_ID_LEAF = 'extras.atrium.objectId'

/** The reason codes and their plain text (E1). */
export const OBJECT_ID_MESSAGES = {
  'object-id-type': 'objectId must be a string',
  'object-id-form': 'objectId must be a lowercase RFC 4122 version-4 UUID',
}

/** The plain text for an object-id reason code. */
export function objectIdReasonText(reason) {
  return OBJECT_ID_MESSAGES[reason] ?? 'the objectId is invalid'
}

/**
 * E1 — the value rule for `extras.atrium.objectId`. Returns a reason code, or
 * null when the value is legal. Mirrors the client's `objectIdProblem`.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function objectIdProblem(value) {
  if (typeof value !== 'string') return 'object-id-type'
  if (!OBJECT_ID_RE.test(value)) return 'object-id-form'
  return null
}

/**
 * E3/E-L3 — the `send` half of the set-once leaf: the node rule, then the value
 * rule, then uniqueness.
 *
 * The node must not already have an own `objectId` (the same value included).
 * `null` is refused by the value rule (it is not a string), and there is no
 * stamping. Uniqueness needs the world, so it comes in through the
 * `objectIdInUse` callback the handler passes, exactly as `externalNames` and
 * `avatarNames` do — `authorizeSend` stays pure (review N2).
 *
 * @param {object} node              the resolved SOMNode
 * @param {*} value
 * @param {((id: *) => boolean)|null} [objectIdInUse]
 * @returns {{ok: boolean, code: string|null, message: string|null}}
 */
export function checkObjectIdValue(node, value, objectIdInUse = null) {
  const extras = node?.extras
  if (isPlainObject(extras)) {
    const atrium = extras.atrium
    if (isPlainObject(atrium) && Object.hasOwn(atrium, 'objectId')) {
      return deny(SEND_INVALID_FIELD, 'objectId is already set')
    }
  }
  const problem = objectIdProblem(value)
  if (problem) return deny(SEND_INVALID, objectIdReasonText(problem))
  if (typeof objectIdInUse === 'function' && objectIdInUse(value)) {
    return deny(SEND_INVALID, OBJECT_ID_TAKEN)
  }
  return allow()
}

// ---------------------------------------------------------------------------
// scripting-4b-2 (F1) — `extras.atrium.behavior`, the fourth writable node
// extras leaf
//
// One rule set, two implementations: this and the client's
// `packages/behaviors/src/behavior-spec.js`, pinned to each other by
// `tests/fixtures/behavior-vectors.json`, which both read.
//
// The server is the gate. `behaviorProblem` runs the engine's own
// `validateInteractivityGraph` LAST, after every rule above it, so a vector's
// reason code is always the rule's and never the validator's — and every
// accepted value is one the engine's validator accepts, not merely one
// `loadBehaveGraph` would load (§2.3: the validator is not the loader). The
// import is at the TOP of this file on purpose: a broken vendoring must fail
// every server test at load, not at the first behaviour.
// ---------------------------------------------------------------------------

/** The fourth node extras leaf (F-L2). */
export const BEHAVIOR_LEAF = 'extras.atrium.behavior'

/** F7's limits. */
export const BEHAVIOR_BYTES_MAX    = 16384
export const BEHAVIOR_NODES_MAX    = 64
export const BEHAVIOR_DECLS_MAX    = 32
export const BEHAVIOR_TYPES_MAX    = 16
export const BEHAVIOR_EVENTS_MAX   = 8
export const BEHAVIOR_NODEMAP_MIN  = 1
export const BEHAVIOR_NODEMAP_MAX  = 16
export const BEHAVIOR_TARGETS_MAX  = 16
export const BEHAVIOR_ANIMS_MAX    = 8
export const BEHAVIOR_CLIP_MAX     = 300
export const BEHAVIOR_PROX_MIN     = 0.5
export const BEHAVIOR_PROX_MAX     = 50
export const BEHAVIOR_INTERVAL_MIN = 1
export const BEHAVIOR_INTERVAL_MAX = 3600
export const BEHAVIOR_SPEED_MIN    = 0.1
export const BEHAVIOR_SPEED_MAX    = 10
export const BEHAVIOR_LIGHT_MIN    = 0.01
export const BEHAVIOR_DEPTH_MAX    = 8

/** The whole-world behaviour limit (F2/S1): the count is of OTHER saved nodes. */
export const BEHAVIOR_NODES_PER_WORLD = 64

/** The exact key set of the stored value (F-L2). */
const BEHAVIOR_KEYS = [
  'kind', 'graph', 'nodeMap', 'targets', 'animations', 'proximity', 'interval', 'template', 'enabled', 'origin',
]

/** F-L4 — the op allowlist, exactly the templates' ops plus debug/log. */
const BEHAVIOR_OPS = [
  'event/onSelect', 'event/receive', 'flow/branch', 'pointer/get', 'pointer/set',
  'math/not', 'math/gt', 'animation/start', 'animation/stop', 'debug/log',
]

/** F-L7 — the three event ids this round dispatches. */
const BEHAVIOR_EVENT_IDS = ['atrium/enter', 'atrium/exit', 'atrium/interval']

/** F8 — the five template ids. */
const BEHAVIOR_TEMPLATE_IDS = [
  'select-visibility', 'select-animation', 'proximity-animation', 'select-light', 'interval-animation',
]

/** S9 — event/onSelect is declared WITH its extension, and exactly so. */
const ONSELECT_EXTENSION = 'KHR_node_selectability'

/** M1 — the pointer paths. `[n]` is the INT index socket; `{n}` never matches. */
const BEHAVIOR_POINTER_PATTERNS = [
  /^\/nodes\/(\[n\]|\d+)\/(translation|rotation|scale)$/,
  /^\/nodes\/(\[n\]|\d+)\/extensions\/KHR_node_visibility\/visible$/,
  /^\/extensions\/KHR_lights_punctual\/lights\/(\[n\]|\d+)\/intensity$/,
]

/** The reason codes and their plain text. */
export const BEHAVIOR_MESSAGES = {
  'behavior-type':       'the behaviour must be a plain object with only the behaviour keys',
  'behavior-kind':       'kind must be "graph"',
  'behavior-origin':     'origin must be "local"',
  'behavior-enabled':    'enabled must be a boolean',
  'behavior-bytes':      `the behaviour exceeds ${BEHAVIOR_BYTES_MAX} characters`,
  'behavior-graph':      'the graph is not a valid KHR_interactivity graph',
  'behavior-size':       'the graph exceeds a behaviour limit',
  'behavior-op':         'the graph uses an operation or declaration this round does not run',
  'behavior-event':      'the graph declares an event this round does not dispatch',
  'behavior-pointer':    'a pointer path or index is not one this round allows',
  'behavior-literal':    'an animation reference or speed is not a literal this round allows',
  'behavior-map':        'nodeMap or targets is malformed',
  'behavior-animations': 'animations is malformed',
  'behavior-proximity':  'proximity does not match the graph\'s events',
  'behavior-interval':   'interval does not match the graph\'s events',
  'behavior-template':   'template is malformed or is not one of the five templates',
}

/** The plain text for a behaviour reason code (its detail appended when present). */
export function behaviorReasonText(reason, detail = null) {
  const text = BEHAVIOR_MESSAGES[reason] ?? 'the behaviour value is invalid'
  return detail ? `${text}: ${detail}` : text
}

const isBehaviorBool = isBool
const isBehaviorFinite = isFiniteNumber

/** E1 — does the value carry an own object id? Read, never mutated. */
function ownObjectId(node) {
  const atrium = node?.extras?.atrium
  if (!isPlainObject(atrium)) return undefined
  return Object.hasOwn(atrium, 'objectId') ? atrium.objectId : undefined
}

/** A graph literal: `{ type, value: [ … ] }` with exactly one entry. */
function behaviorLiteral(input) {
  if (!isPlainObject(input)) return null
  if (!Array.isArray(input.value) || input.value.length !== 1) return null
  return input.value[0]
}

/** True when `input` is a socket connection rather than a literal. */
function behaviorSocket(input) {
  return isPlainObject(input) && input.node !== undefined && input.socket !== undefined
}

/** The op of a node's declaration, or null. */
function behaviorDeclarationOp(graph, index) {
  const declarations = Array.isArray(graph?.declarations) ? graph.declarations : []
  const decl = declarations[index]
  return isPlainObject(decl) ? decl.op : null
}

/** Every graph node with its declaration's op resolved, in order. */
function behaviorNodes(graph) {
  const out = []
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  for (const node of nodes) {
    out.push({ node, op: isPlainObject(node) ? behaviorDeclarationOp(graph, node.declaration) : null })
  }
  return out
}

/** The set of declared event ids. */
function behaviorDeclaredEvents(graph) {
  const ids = new Set()
  const events = Array.isArray(graph?.events) ? graph.events : []
  for (const entry of events) if (isPlainObject(entry) && typeof entry.id === 'string') ids.add(entry.id)
  return ids
}

const behaviorClipOk = (v) => typeof v === 'string' && v.length >= 1 && v.length <= BEHAVIOR_CLIP_MAX
const behaviorRadiusOk = (v) => isBehaviorFinite(v) && v >= BEHAVIOR_PROX_MIN && v <= BEHAVIOR_PROX_MAX
const behaviorSecondsOk = (v) => Number.isInteger(v) && v >= BEHAVIOR_INTERVAL_MIN && v <= BEHAVIOR_INTERVAL_MAX
const behaviorIdOk = (v) => typeof v === 'string' && OBJECT_ID_RE.test(v)

function behaviorParamKeysProblem(params, keys) {
  for (const key of Object.keys(params)) if (!keys.includes(key)) return true
  for (const key of keys) if (!Object.hasOwn(params, key)) return true
  return false
}

/** Rev 2 S5 — `template.params`, one rule per template, no other keys. */
export function behaviorParamsOk(id, params) {
  if (!isPlainObject(params)) return false
  switch (id) {
    case 'select-visibility':
      if (behaviorParamKeysProblem(params, ['target', 'action'])) return false
      return behaviorIdOk(params.target) && (params.action === 'show' || params.action === 'hide' || params.action === 'toggle')
    case 'select-animation':
      if (behaviorParamKeysProblem(params, ['target', 'clip', 'action', 'loop'])) return false
      return behaviorIdOk(params.target) && behaviorClipOk(params.clip) &&
        (params.action === 'play' || params.action === 'stop') && isBehaviorBool(params.loop)
    case 'proximity-animation':
      if (behaviorParamKeysProblem(params, ['target', 'clip', 'loop', 'radius'])) return false
      return behaviorIdOk(params.target) && behaviorClipOk(params.clip) &&
        isBehaviorBool(params.loop) && behaviorRadiusOk(params.radius)
    case 'select-light':
      if (behaviorParamKeysProblem(params, ['target', 'intensity'])) return false
      return behaviorIdOk(params.target) && isBehaviorFinite(params.intensity) &&
        params.intensity >= BEHAVIOR_LIGHT_MIN
    case 'interval-animation':
      if (behaviorParamKeysProblem(params, ['target', 'clip', 'loop', 'seconds'])) return false
      return behaviorIdOk(params.target) && behaviorClipOk(params.clip) &&
        isBehaviorBool(params.loop) && behaviorSecondsOk(params.seconds)
    default:
      return false
  }
}

/** The `[n]` / `<int>` index a pointer names, or null. */
function behaviorPointerIndex(node, pointer, nodeMapLength) {
  const match = /\/(\[n\]|\d+)\//.exec(pointer)
  if (!match) return null
  let index
  if (match[1] === '[n]') {
    const values = isPlainObject(node) ? node.values : null
    if (!isPlainObject(values)) return null
    if (behaviorSocket(values.n)) return null
    index = behaviorLiteral(values.n)
  } else {
    index = Number(match[1])
  }
  if (!Number.isInteger(index) || index < 0 || index >= nodeMapLength) return null
  return index
}

/**
 * F1 — the verdict for `extras.atrium.behavior`, as
 * `{ problem, message }`. `problem` is a reason code or null; `message` is null
 * when the value may be stored and carries the engine's own text when the
 * validator refuses the graph.
 *
 * @param {*} value                    the proposed `extras.atrium.behavior`
 * @param {{ownId?: string}} [options] the node's own object id, when it has one
 * @returns {{problem: string|null, message: string|null}}
 */
export function behaviorCheck(value, { ownId } = {}) {
  const fail = (problem, detail = null) => ({ problem, message: behaviorReasonText(problem, detail) })

  // S8 / V9 — the forbidden-key and depth walk runs FIRST of all, and it is
  // iterative: a value nested a few thousand deep is REFUSED, never a stack
  // overflow (M2).
  if (!isPlainObject(value)) return fail('behavior-type')
  if (walkGuards(value, BEHAVIOR_DEPTH_MAX) !== null) return fail('behavior-type')

  for (const key of Object.keys(value)) {
    if (!BEHAVIOR_KEYS.includes(key)) return fail('behavior-type')
  }

  if (value.kind !== 'graph') return fail('behavior-kind')
  if (value.origin !== 'local') return fail('behavior-origin')
  if (!isBehaviorBool(value.enabled)) return fail('behavior-enabled')

  let serialized
  try { serialized = JSON.stringify(value) } catch { return fail('behavior-type') }
  if (serialized === undefined) return fail('behavior-type')
  if (serialized.length > BEHAVIOR_BYTES_MAX) return fail('behavior-bytes')

  const graph = value.graph
  if (!isPlainObject(graph)) return fail('behavior-graph')

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : null
  const declarations = Array.isArray(graph.declarations) ? graph.declarations : null
  const types = Array.isArray(graph.types) ? graph.types : null

  if (!nodes || nodes.length > BEHAVIOR_NODES_MAX) return fail('behavior-size')
  if (!declarations || declarations.length > BEHAVIOR_DECLS_MAX) return fail('behavior-size')
  if (!types || types.length > BEHAVIOR_TYPES_MAX) return fail('behavior-size')
  if (Object.hasOwn(graph, 'variables')) return fail('behavior-size')
  if (Object.hasOwn(graph, 'events')) {
    if (!Array.isArray(graph.events)) return fail('behavior-event')
    if (graph.events.length === 0) return fail('behavior-size')
    if (graph.events.length > BEHAVIOR_EVENTS_MAX) return fail('behavior-size')
  }

  const seen = new Set()
  for (const decl of declarations) {
    if (!isPlainObject(decl) || typeof decl.op !== 'string') return fail('behavior-op')
    if (!BEHAVIOR_OPS.includes(decl.op)) return fail('behavior-op')
    if (decl.op === 'event/onSelect') {
      const keys = Object.keys(decl)
      if (keys.length !== 2 || keys.some((k) => k !== 'op' && k !== 'extension')) return fail('behavior-op')
      if (decl.extension !== ONSELECT_EXTENSION) return fail('behavior-op')
    } else if (Object.keys(decl).length !== 1) {
      return fail('behavior-op')
    }
    const identity = `${decl.op}|${decl.extension ?? ''}`
    if (seen.has(identity)) return fail('behavior-op')
    seen.add(identity)
  }

  for (const { node, op } of behaviorNodes(graph)) {
    if (op !== 'event/onSelect') continue
    if (!isPlainObject(node)) return fail('behavior-op')
    const configuration = node.configuration
    if (!isPlainObject(configuration)) return fail('behavior-op')
    if (behaviorLiteral(configuration.nodeIndex) !== 0) return fail('behavior-op')
    if (behaviorLiteral(configuration.stopPropagation) !== false) return fail('behavior-op')
  }

  const events = Array.isArray(graph.events) ? graph.events : []
  for (const entry of events) {
    if (!isPlainObject(entry)) return fail('behavior-event')
    const keys = Object.keys(entry)
    if (keys.length !== 1 || keys[0] !== 'id') return fail('behavior-event')
    if (!BEHAVIOR_EVENT_IDS.includes(entry.id)) return fail('behavior-event')
  }
  const declared = behaviorDeclaredEvents(graph)

  const nodeMap = value.nodeMap
  if (!Array.isArray(nodeMap) || nodeMap.length < BEHAVIOR_NODEMAP_MIN || nodeMap.length > BEHAVIOR_NODEMAP_MAX) {
    return fail('behavior-map')
  }
  if (!nodeMap.every(behaviorIdOk)) return fail('behavior-map')
  if (new Set(nodeMap).size !== nodeMap.length) return fail('behavior-map')
  if (ownId !== undefined && nodeMap[0] !== ownId) return fail('behavior-map')

  const targets = value.targets
  if (!Array.isArray(targets) || targets.length > BEHAVIOR_TARGETS_MAX) return fail('behavior-map')
  if (!targets.every(behaviorIdOk)) return fail('behavior-map')
  if (new Set(targets).size !== targets.length) return fail('behavior-map')

  const animations = value.animations
  if (!Array.isArray(animations) || animations.length > BEHAVIOR_ANIMS_MAX) return fail('behavior-animations')
  for (const entry of animations) {
    if (!isPlainObject(entry)) return fail('behavior-animations')
    const keys = Object.keys(entry)
    if (keys.length !== 3 || keys.some((k) => k !== 'object' && k !== 'clip' && k !== 'loop')) {
      return fail('behavior-animations')
    }
    if (!behaviorIdOk(entry.object)) return fail('behavior-animations')
    if (!behaviorClipOk(entry.clip)) return fail('behavior-animations')
    if (!isBehaviorBool(entry.loop)) return fail('behavior-animations')
  }

  const animationNodes = behaviorNodes(graph)
  const hasAnimationOp = animationNodes.some(({ op }) => op === 'animation/start' || op === 'animation/stop')
  if (hasAnimationOp && animations.length === 0) return fail('behavior-animations')

  for (const { node, op } of animationNodes) {
    if (op === 'pointer/get' || op === 'pointer/set') {
      const configuration = isPlainObject(node) ? node.configuration : null
      const pointer = isPlainObject(configuration) ? behaviorLiteral(configuration.pointer) : null
      if (typeof pointer !== 'string') return fail('behavior-pointer')
      if (!BEHAVIOR_POINTER_PATTERNS.some((re) => re.test(pointer))) return fail('behavior-pointer')
      if (behaviorPointerIndex(node, pointer, nodeMap.length) === null) return fail('behavior-pointer')
      continue
    }
    if (op === 'animation/start' || op === 'animation/stop') {
      const values = isPlainObject(node) ? node.values : null
      const animation = isPlainObject(values) ? behaviorLiteral(values.animation) : null
      if (typeof animation !== 'string') return fail('behavior-literal')
      const match = /^\/animations\/(\d+)$/.exec(animation)
      if (!match) return fail('behavior-literal')
      const i = Number(match[1])
      if (!Number.isInteger(i) || i < 0 || i >= animations.length) return fail('behavior-literal')
      if (op === 'animation/start') {
        const speed = isPlainObject(node) ? behaviorLiteral(node.values?.speed) : null
        if (!isBehaviorFinite(speed) || speed < BEHAVIOR_SPEED_MIN || speed > BEHAVIOR_SPEED_MAX) {
          return fail('behavior-literal')
        }
      }
      continue
    }
  }

  const needsProximity = declared.has('atrium/enter') || declared.has('atrium/exit')
  if (Object.hasOwn(value, 'proximity')) {
    const proximity = value.proximity
    if (!isPlainObject(proximity)) return fail('behavior-proximity')
    const keys = Object.keys(proximity)
    if (keys.length !== 1 || keys[0] !== 'radius') return fail('behavior-proximity')
    if (!behaviorRadiusOk(proximity.radius)) return fail('behavior-proximity')
    if (!needsProximity) return fail('behavior-proximity')
  } else if (needsProximity) {
    return fail('behavior-proximity')
  }

  const needsInterval = declared.has('atrium/interval')
  if (Object.hasOwn(value, 'interval')) {
    const interval = value.interval
    if (!isPlainObject(interval)) return fail('behavior-interval')
    const keys = Object.keys(interval)
    if (keys.length !== 1 || keys[0] !== 'seconds') return fail('behavior-interval')
    if (!behaviorSecondsOk(interval.seconds)) return fail('behavior-interval')
    if (!needsInterval) return fail('behavior-interval')
  } else if (needsInterval) {
    return fail('behavior-interval')
  }

  if (Object.hasOwn(value, 'template')) {
    const template = value.template
    if (!isPlainObject(template)) return fail('behavior-template')
    const keys = Object.keys(template)
    if (keys.length !== 2 || keys.some((k) => k !== 'id' && k !== 'params')) return fail('behavior-template')
    if (!BEHAVIOR_TEMPLATE_IDS.includes(template.id)) return fail('behavior-template')
    if (!behaviorParamsOk(template.id, template.params)) return fail('behavior-template')
  }

  // §8 — the validator runs LAST. It is the gate, not the loader.
  try {
    validateInteractivityGraph(graph)
  } catch (error) {
    return fail('behavior-graph', error?.message ?? String(error))
  }

  return { problem: null, message: null }
}

/** F1 — the reason code for a behaviour value, or null when it may be stored. */
export function behaviorProblem(value, options = {}) {
  return behaviorCheck(value, options).problem
}

/**
 * F2 — how many SAVED nodes other than `excludeNode` carry a non-null
 * `extras.atrium.behavior`. The 64-behaviour cap's count (S1): it is of OTHER
 * nodes, so the node being written is never counted against itself and its 64th
 * behaviour can always be rewritten or toggled. External nodes are not saved
 * nodes and do not count.
 *
 * @param {object} som                  the world's SOMDocument
 * @param {object|null} [excludeNode]
 * @returns {number}
 */
export function behaviorCountIn(som, excludeNode = null) {
  let count = 0
  for (const node of som?.allNodes ?? []) {
    if (node === excludeNode) continue
    if (typeof som.isExternalNode === 'function' && som.isExternalNode(node)) continue
    const behavior = node?.extras?.atrium?.behavior
    if (behavior !== undefined && behavior !== null) count += 1
  }
  return count
}

/**
 * F2 — the `send` half of the fourth leaf. The node's OWN id is the first rule
 * (N3: the form gives the node its `objectId` first, so the leaf never meets a
 * missing `extras.atrium`); `null` is the "no behaviour" value and is accepted;
 * then F1; then the world's 64-behaviour cap, which counts OTHER nodes (S1), so
 * a node that already carries one can always rewrite it.
 *
 * @param {object} node
 * @param {*} value
 * @param {((excludeNode: object) => number)|null} [behaviorCount]
 * @returns {{ok: boolean, code: string|null, message: string|null}}
 */
export function checkBehaviorValue(node, value, behaviorCount = null) {
  const id = ownObjectId(node)
  if (typeof id !== 'string' || id.length === 0) {
    return deny(SEND_INVALID_FIELD, 'give the object an id before a behaviour')
  }
  if (value === null) return allow()
  const check = behaviorCheck(value, { ownId: id })
  if (check.problem) return deny(SEND_INVALID, check.message)
  if (typeof behaviorCount === 'function' && behaviorCount(node) >= BEHAVIOR_NODES_PER_WORLD) {
    return deny(SEND_INVALID, `this world already has ${BEHAVIOR_NODES_PER_WORLD} behaviours`)
  }
  return allow()
}

/**
 * F2 — the `add` half: a behaviour carried by an `add` descriptor is checked
 * when the key is present, with the descriptor's OWN `objectId` as the node's id
 * (C3: a behaviour with no object id is refused with "a behaviour needs an
 * object id", and nothing is added).
 *
 * @param {*} extras
 * @returns {{ok: boolean, code: string|null, message: string|null}}
 */
export function checkAtriumBehavior(extras) {
  if (!isPlainObject(extras)) return allow()
  const atrium = extras.atrium
  if (!isPlainObject(atrium)) return allow()
  if (!Object.hasOwn(atrium, 'behavior')) return allow()
  const value = atrium.behavior
  const id = Object.hasOwn(atrium, 'objectId') ? atrium.objectId : undefined
  if (typeof id !== 'string' || id.length === 0) {
    return deny(SEND_INVALID, 'a behaviour needs an object id')
  }
  if (value === null) return allow()
  const check = behaviorCheck(value, { ownId: id })
  if (check.problem) return deny(SEND_INVALID, check.message)
  return allow()
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
/**
 * V9 — ONE iterative walk over the value: the reserved keys AND the depth
 * limit, with an explicit stack and NO recursion.
 *
 * Round 4 had two recursive helpers here (`maxDepth`, `hasForbiddenKey`). A
 * `send` of a behaviour whose `graph` is an array nested 6,500 deep made
 * `hasForbiddenKey` throw `RangeError: Maximum call stack size exceeded`, and
 * nothing caught it: the process exited and took every world on it down (the
 * outside review's M2).
 *
 * It stops at the FIRST thing it finds and never descends past `limit`, so a
 * 100,000-deep array is refused without ever being visited.
 *
 * @param {*} value
 * @param {number} limit  the caller's own depth limit: `BEHAVIOR_DEPTH_MAX` for
 *                        a behaviour, `MAX_EXTRAS_DEPTH` for document extras
 * @returns {'forbidden'|'too-deep'|null}
 */
function walkGuards(value, limit) {
  if (typeof value !== 'object' || value === null) return null
  const stack = [[value, 1]]
  while (stack.length > 0) {
    const [node, depth] = stack.pop()
    if (depth > limit) return 'too-deep'
    if (typeof node !== 'object' || node === null) continue
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_KEYS.has(key)) return 'forbidden'
      stack.push([node[key], depth + 1])
    }
  }
  return null
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
export function authorizeSend({ target, nodeName, field, value, avatarNames = null, currentExtras = null, externalNames = null, objectIdInUse = null, behaviorCount = null } = {}) {
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
    return authorizeNodeSend({ node: target, field, value, isLiveAvatar, objectIdInUse, behaviorCount })
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

function authorizeNodeSend({ node, field, value, isLiveAvatar, objectIdInUse = null, behaviorCount = null }) {
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

  // scripting-4a Z2 — the second node extras leaf: the model's animation state,
  // allowed only on a node that carries its model. The node read is the RESOLVED
  // node passed in here, never `authorizeSend`'s `currentExtras` (the document's),
  // so a node that has lost its model cannot keep receiving the leaf.
  if (field === ANIMATION_LEAF) {
    return checkAnimationValue(node, value)
  }

  // scripting-4b-1 E-L3/E3 — the third node extras leaf: the set-once object
  // identity. Allowed only on a node that has none, and only for a value that
  // passes E1 and is unique in the world.
  if (field === OBJECT_ID_LEAF) {
    return checkObjectIdValue(node, value, objectIdInUse)
  }

  // scripting-4b-2 F2 — the fourth node extras leaf: the behaviour graph. The
  // node must carry its own objectId, null is the "no behaviour" value, then F1,
  // then the world's 64-behaviour cap (which counts OTHER nodes).
  if (field === BEHAVIOR_LEAF) {
    return checkBehaviorValue(node, value, behaviorCount)
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
  // V9 — the same one iterative walk, with the document extras' own limit and
  // their existing messages.
  const guard = walkGuards(value, MAX_EXTRAS_DEPTH)
  if (guard === 'forbidden') {
    return deny(SEND_DENIED, 'document extras contain a reserved key')
  }
  if (guard === 'too-deep') {
    return deny(SEND_DENIED, 'document extras exceed the depth limit')
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
