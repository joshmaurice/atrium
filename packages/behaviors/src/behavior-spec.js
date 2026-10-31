// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// behavior-spec — F1's CLIENT copy (scripting-4b-2).
//
// One rule set, two implementations: this and the server's copy in
// packages/server/src/send-policy.js, pinned to each other by
// tests/fixtures/behavior-vectors.json, which both read. The renderer-neutral
// home is deliberate: the form, the runner and the filler all need the same
// verdict the server will give, and none of them may import the server.
//
// The rule decides whether `extras.atrium.behavior` may be stored. It is the
// SERVER's gate: the values here are what the server accepts, and every test
// that claims a template is accepted must run it through the engine's own
// `validateInteractivityGraph`, not merely through `loadBehaveGraph` (the
// pre-brief §2.3: the validator is not the loader).
//
// Rule order is fixed and total: the forbidden-key and depth walk runs first of
// all, the engine's validator runs LAST, so a vector's reason code is always the
// rule's and never the validator's.
// ---------------------------------------------------------------------------

import { validateInteractivityGraph } from '@khronosgroup/gltf-interactivity-engine'

// ---------------------------------------------------------------------------
// Limits (F7)
// ---------------------------------------------------------------------------

export const BEHAVIOR_BYTES_MAX   = 65536
export const BEHAVIOR_NODES_MAX   = 256
export const BEHAVIOR_DECLS_MAX   = 64
export const BEHAVIOR_TYPES_MAX   = 16
export const BEHAVIOR_EVENTS_MAX  = 16
export const BEHAVIOR_VARIABLES_MAX = 32
/** 4d G1 — every stored string field is bounded, with a character set. */
export const BEHAVIOR_STRING_MAX  = 64
export const BEHAVIOR_OP_RE       = /^[A-Za-z0-9_/]+$/
export const BEHAVIOR_EXTENSION_RE = /^[A-Za-z0-9_]+$/
export const BEHAVIOR_EVENT_ID_RE = /^[A-Za-z0-9_./:-]+$/
export const BEHAVIOR_NODEMAP_MIN = 1
export const BEHAVIOR_NODEMAP_MAX = 16
export const BEHAVIOR_TARGETS_MAX = 16
export const BEHAVIOR_ANIMS_MAX   = 8
export const BEHAVIOR_CLIP_MAX    = 300
export const BEHAVIOR_PROX_MIN    = 0.5
export const BEHAVIOR_PROX_MAX    = 50
export const BEHAVIOR_INTERVAL_MIN = 1
export const BEHAVIOR_INTERVAL_MAX = 3600
export const BEHAVIOR_SPEED_MIN   = 0.1
export const BEHAVIOR_SPEED_MAX   = 10
export const BEHAVIOR_LIGHT_MIN   = 0.01
export const BEHAVIOR_DEPTH_MAX   = 8

/** E1 — the object id form, duplicated here as the client's model-spec duplicates A1. */
export const OBJECT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The exact key set of the stored value (F-L2). */
export const BEHAVIOR_KEYS = Object.freeze([
  'kind', 'graph', 'nodeMap', 'targets', 'animations', 'proximity', 'interval', 'template', 'enabled', 'origin',
])

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * F-L4 — the op allowlist, EXACTLY what the five templates use plus debug/log.
 * No flow/while, no flow/for, no flow/setDelay, no pointer/interpolate,
 * no variable/*, no event/onTick, no event/onStart.
 */
/**
 * G-L2 (a) / G1 — **EXECUTABLE**: the identities the page may build.
 *
 * Every bare core op of G-L2 (a) — the engine's own registered ops LESS the
 * four this round does not run (`event/onHoverIn`, `event/onHoverOut`,
 * `event/stopPropagation`, `animation/stopAt`) — plus exactly the pair
 * `(event/onSelect, KHR_node_selectability)`.
 *
 * A declaration is SUPPORTED exactly when its `(op, extension)` is an
 * executable identity: an allowlisted op name with ANY other extension is not
 * (P19 — the engine looks the op name up alone), and `event/onSelect` is the one
 * op that must carry its extension to be executable.
 *
 * One rule set, two implementations: this list and the server's copy in
 * `packages/server/src/send-policy.js` are the same text, and
 * `packages/server/test/behavior-leaf.test.js` pins them to each other (the
 * server package does not depend on `@atrium/behaviors`).
 */
export const EXECUTABLE = Object.freeze([
  'event/onStart', 'event/onTick', 'flow/branch', 'flow/setDelay', 'flow/cancelDelay', 'flow/doN',
  'flow/for', 'flow/multiGate', 'flow/sequence', 'flow/switch', 'flow/throttle', 'flow/waitAll',
  'flow/while', 'pointer/get', 'pointer/set', 'pointer/interpolate', 'math/abs', 'event/receive',
  'event/send', 'variable/get', 'variable/set', 'variable/interpolate', 'math/E', 'math/Inf',
  'math/NaN', 'math/Pi', 'math/Tau', 'math/sign', 'math/trunc', 'math/floor', 'math/fract',
  'math/ceil', 'math/round', 'math/neg', 'math/add', 'math/sub', 'math/mul', 'math/div', 'math/rem',
  'math/min', 'math/max', 'math/mix', 'math/saturate', 'math/clamp', 'math/smoothStep', 'math/rad',
  'math/deg', 'math/sin', 'math/cos', 'math/tan', 'math/asin', 'math/acos', 'math/atan', 'math/atan2',
  'math/sinh', 'math/cosh', 'math/tanh', 'math/asinh', 'math/acosh', 'math/atanh', 'math/exp',
  'math/log', 'math/log2', 'math/log10', 'math/pow', 'math/sqrt', 'math/cbrt', 'math/random',
  'math/lt', 'math/le', 'math/eq', 'math/ge', 'math/gt', 'math/dot', 'math/cross', 'math/normalize',
  'math/rotate2D', 'math/rotate3D', 'math/length', 'math/slerp', 'math/isInf', 'math/isNaN',
  'math/select', 'math/switch', 'math/extract2', 'math/extract3', 'math/extract4', 'math/extract2x2',
  'math/extract3x3', 'math/extract4x4', 'math/combine2', 'math/combine3', 'math/combine4',
  'math/combine2x2', 'math/combine3x3', 'math/combine4x4', 'type/boolToInt', 'type/boolToFloat',
  'type/floatToBool', 'type/floatToInt', 'type/intToBool', 'type/intToFloat', 'math/not', 'math/xor',
  'math/or', 'math/and', 'math/lsl', 'math/asr', 'math/clz', 'math/ctz', 'math/popcnt', 'math/quatMul',
  'math/quatConjugate', 'math/quatFromAxisAngle', 'math/quatAngleBetween', 'math/quatSlerp',
  'math/quatToAxisAngle', 'math/quatFromDirections', 'math/quatFromUpForward', 'math/quatFromAngles',
  'math/matDecompose', 'math/matCompose', 'math/determinant', 'math/transform', 'math/transpose',
  'math/matMul', 'math/inverse', 'debug/log', 'ref/eq', 'math/rgbToOkLCh', 'math/rgbFromOkLCh',
  'animation/start', 'animation/stop', 'event/onSelect',
])

/** The op names the round does NOT run (G-L3 (a): stored, inert, reported). */
export const NOT_EXECUTABLE_OPS = Object.freeze([
  'event/onHoverIn', 'event/onHoverOut', 'event/stopPropagation', 'animation/stopAt',
])

/** S9 — event/onSelect is declared WITH its extension, and exactly so. */
export const ONSELECT_EXTENSION = 'KHR_node_selectability'

/**
 * G1 — the executable IDENTITIES, as `op|extension` strings (`op|` for a bare
 * core declaration). `event/onSelect` is executable ONLY with its extension.
 */
export const EXECUTABLE_IDENTITIES = Object.freeze([
  ...EXECUTABLE.filter((op) => op !== 'event/onSelect').map((op) => `${op}|`),
  `event/onSelect|${ONSELECT_EXTENSION}`,
])

/** G1 — a declaration's identity: `op|extension`. */
export function declarationIdentity(op, extension) {
  return `${op}|${typeof extension === 'string' ? extension : ''}`
}

/** G1 — true exactly when `(op, extension)` is an executable identity. */
export function isExecutableDeclaration(op, extension) {
  return typeof op === 'string' && EXECUTABLE_IDENTITIES.includes(declarationIdentity(op, extension))
}

/** Back-compat alias: the op names EXECUTABLE holds (the conformance filter). */
export const BEHAVIOR_OPS = EXECUTABLE

/** F-L7 — the three declared event ids. */
export const BEHAVIOR_EVENTS = Object.freeze(['atrium/enter', 'atrium/exit', 'atrium/interval'])

/** F8 — the five template ids. */
export const BEHAVIOR_TEMPLATES = Object.freeze([
  'select-visibility', 'select-animation', 'proximity-animation', 'select-light', 'interval-animation',
])

/** S9 — event/onSelect is declared WITH its extension, and exactly so. */
const ONSELECT_DECLARATION = { op: 'event/onSelect', extension: 'KHR_node_selectability' }

/**
 * M1 — the pointer paths. `[n]` is the engine's INT index socket; `{n}` is a REF
 * socket the decorator never registers, so any `{…}` spelling is refused (the
 * path simply does not match these patterns). A socket-connected index is
 * refused below.
 */
/**
 * G-L4 — the pointer families 4d registers (`/nodes/<i>/…`, read-only
 * `matrix` and `globalMatrix`, and a light's `intensity` and `color`).
 *
 * `[x]` is the engine's INT index socket and `{x}` a REF socket (P15), and
 * either may be a LITERAL or WIRED. A pointer that matches NONE of these
 * families is not checked at all (G-L3 (a): stored, inert, reported): only the
 * validator and the size limit apply to it.
 */
const NODE_INDEX = '(\\[[A-Za-z0-9_]+\\]|\\{[A-Za-z0-9_]+\\}|\\d+)'
const POINTER_FAMILIES = [
  { re: new RegExp(`^/nodes/${NODE_INDEX}/(translation|rotation|scale)$`), family: 'node' },
  { re: new RegExp(`^/nodes/${NODE_INDEX}/(matrix|globalMatrix)$`), family: 'node' },
  { re: new RegExp(`^/nodes/${NODE_INDEX}/extensions/KHR_node_visibility/visible$`), family: 'node' },
  { re: new RegExp(`^/extensions/KHR_lights_punctual/lights/${NODE_INDEX}/(intensity|color)$`), family: 'light' },
]

/**
 * G-L4 / G3 — true when `pointer` is one of the pointer families 4d registers.
 *
 * A pointer outside these families is stored, inert and REPORTED (G-L3 (a)):
 * `graphReport` lists it in `unsupportedPointers`. One definition of the
 * families, so the rule, the decorator and the report cannot disagree.
 */
export function isSupportedPointerPath(pointer) {
  return typeof pointer === 'string' && POINTER_FAMILIES.some((entry) => entry.re.test(pointer))
}

/** The plain text of every reason code. */
export const BEHAVIOR_MESSAGES = Object.freeze({
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
})

/** The plain text for a behaviour reason code. */
export function behaviorReasonText(code) {
  return BEHAVIOR_MESSAGES[code] ?? 'the behaviour value is invalid'
}

// ---------------------------------------------------------------------------
// Small predicates (module-private)
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * V9 — ONE iterative walk over the value: the reserved keys AND the depth
 * limit, with an explicit stack and NO recursion (the same change as the
 * server's copy in `send-policy.js`, so the shared vectors still pass on both
 * sides). Round 4's recursive pair overflowed the stack on a value nested a few
 * thousand deep — on the server that took the process down (M2).
 *
 * It stops at the FIRST thing it finds and never descends past `limit`.
 *
 * @param {*} value
 * @param {number} limit  `BEHAVIOR_DEPTH_MAX`
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

const isE1 = (v) => typeof v === 'string' && OBJECT_ID_RE.test(v)
const isBool = (v) => typeof v === 'boolean'
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/** A graph literal: `{ type, value: [ … ] }` with exactly one entry. */
function literalOf(input) {
  if (!isPlainObject(input)) return null
  if (!Array.isArray(input.value) || input.value.length !== 1) return null
  return input.value[0]
}

/** True when `input` is a socket connection (`{ node, socket }`) rather than a literal. */
function isSocket(input) {
  return isPlainObject(input) && input.node !== undefined && input.socket !== undefined
}

/** The declared event ids of a graph, as a Set. */
function declaredEvents(graph) {
  const ids = new Set()
  const events = Array.isArray(graph?.events) ? graph.events : []
  for (const entry of events) {
    if (isPlainObject(entry) && typeof entry.id === 'string') ids.add(entry.id)
  }
  return ids
}

/** The op of a declaration, resolved from a node's `declaration` index. */
function declarationOf(graph, index) {
  const declarations = Array.isArray(graph?.declarations) ? graph.declarations : []
  const decl = declarations[index]
  return isPlainObject(decl) ? decl : null
}

/**
 * The declaration identity `(op, extension)` a node indexes, or null. 4d judges
 * support by IDENTITY, not by name (G1, P19).
 */
function declarationIdentityOf(graph, index) {
  const decl = declarationOf(graph, index)
  if (!decl || typeof decl.op !== 'string') return null
  return declarationIdentity(decl.op, decl.extension)
}

/** Every graph node with its declaration resolved: `{ node, op, identity }`, in order. */
function* graphNodes(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  for (const node of nodes) {
    if (!isPlainObject(node)) { yield { node, op: null, identity: null }; continue }
    const decl = declarationOf(graph, node.declaration)
    yield {
      node,
      op: decl ? decl.op : null,
      identity: decl && typeof decl.op === 'string' ? declarationIdentity(decl.op, decl.extension) : null,
    }
  }
}

// ---------------------------------------------------------------------------
// template.params (Rev 2 S5) — one rule per template, no other keys
// ---------------------------------------------------------------------------

const TEMPLATE_ACTIONS = {
  'select-visibility': ['show', 'hide', 'toggle'],
  'select-animation':  ['play', 'stop'],
}

function paramKeysProblem(params, keys) {
  for (const key of Object.keys(params)) if (!keys.includes(key)) return true
  for (const key of keys) if (!Object.hasOwn(params, key)) return true
  return false
}

const isClip = (v) => typeof v === 'string' && v.length >= 1 && v.length <= BEHAVIOR_CLIP_MAX
const isRadius = (v) => isFiniteNumber(v) && v >= BEHAVIOR_PROX_MIN && v <= BEHAVIOR_PROX_MAX
const isSeconds = (v) => Number.isInteger(v) && v >= BEHAVIOR_INTERVAL_MIN && v <= BEHAVIOR_INTERVAL_MAX

/** True when `params` is a legal parameter object for `id`. */
export function templateParamsOk(id, params) {
  if (!isPlainObject(params)) return false
  switch (id) {
    case 'select-visibility':
      if (paramKeysProblem(params, ['target', 'action'])) return false
      return isE1(params.target) && TEMPLATE_ACTIONS[id].includes(params.action)
    case 'select-animation':
      if (paramKeysProblem(params, ['target', 'clip', 'action', 'loop'])) return false
      return isE1(params.target) && isClip(params.clip) &&
        TEMPLATE_ACTIONS[id].includes(params.action) && isBool(params.loop)
    case 'proximity-animation':
      if (paramKeysProblem(params, ['target', 'clip', 'loop', 'radius'])) return false
      return isE1(params.target) && isClip(params.clip) && isBool(params.loop) && isRadius(params.radius)
    case 'select-light':
      if (paramKeysProblem(params, ['target', 'intensity'])) return false
      return isE1(params.target) && isFiniteNumber(params.intensity) &&
        params.intensity >= BEHAVIOR_LIGHT_MIN
    case 'interval-animation':
      if (paramKeysProblem(params, ['target', 'clip', 'loop', 'seconds'])) return false
      return isE1(params.target) && isClip(params.clip) && isBool(params.loop) && isSeconds(params.seconds)
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// scripting-4c AC2 — the shared click rule
//
// ONE rule for every tab (4b-2 P13): which node a click on a hit selects. The
// page applies it before it sends (the server never walks ancestors), the
// runner's own `select` resolves through it, and the server's copy of
// `listensForSelect` decides whether the named node responds at all.
// ---------------------------------------------------------------------------

/** AC-L2 — one fixed reach, in metres. Measured from the object's ORIGIN. */
export const ACTIVATE_MAX_DISTANCE = 10

/**
 * scripting-4c AC2 — true exactly when the STORED behaviour leaf says this node
 * listens for a click (4b-2 P10): it is a plain object, `enabled === true`, and
 * one of the graph's nodes indexes a declaration whose op is `event/onSelect`.
 *
 * TOTAL: it never throws and answers `false` for anything malformed (null, a
 * string, a graph with no nodes, a declaration no node uses). The server's copy
 * in `send-policy.js` reads the same vectors.
 *
 * @param {*} value  the stored `extras.atrium.behavior`, or anything
 * @returns {boolean}
 */
export function listensForSelect(value) {
  if (!isPlainObject(value)) return false
  if (value.enabled !== true) return false
  const graph = value.graph
  if (!isPlainObject(graph)) return false
  // G1 — judged by IDENTITY: only the exact `(event/onSelect,
  // KHR_node_selectability)` declaration runs, so only it claims a select.
  for (const { identity } of graphNodes(graph)) {
    if (identity === declarationIdentity('event/onSelect', ONSELECT_DECLARATION.extension)) return true
  }
  return false
}

/**
 * scripting-4c AC2 — the node a click on `somNode` selects, or null.
 *
 * Walk `somNode` and its ancestors to the FIRST node whose stored leaf has
 * `enabled === true` (avatars are skipped). That node is the answer when it
 * listens for select; when it does NOT, the answer is null — the walk does not
 * continue past it. That is the one change to 4b-2: a node the runner disabled
 * (or one whose behaviour does not listen for select) no longer passes the
 * click to an ancestor.
 *
 * @param {{ extras?: object, parent?: object|null }} somNode
 * @returns {object|null} the SOM node to select, or null
 */
export function selectTargetFor(somNode) {
  for (let node = somNode; node; node = node.parent ?? null) {
    if (node?.extras?.atrium?.ephemeral === true) continue      // an avatar is skipped
    const leaf = node?.extras?.atrium?.behavior
    if (!isPlainObject(leaf) || leaf.enabled !== true) continue
    return listensForSelect(leaf) ? node : null
  }
  return null
}

/** True for a vector of exactly three finite numbers. */
function isPoint3(p) {
  return Array.isArray(p) && p.length === 3 && p.every(isFiniteNumber)
}

/**
 * scripting-4c AC2/AC-L2 — true when `a` and `b` are within `max` metres of each
 * other, INCLUSIVE (exactly 10 m passes). False when either point is missing or
 * is not three finite numbers.
 *
 * This is NOT a security boundary: the position it measures is the client's own
 * claim (4b-2 P8), and any client can send a `view` next to an object first. It
 * stops ordinary far-away clicks and makes activation local, nothing more.
 *
 * @param {number[]|null|undefined} a
 * @param {number[]|null|undefined} b
 * @param {number} [max]
 * @returns {boolean}
 */
export function withinActivateDistance(a, b, max = ACTIVATE_MAX_DISTANCE) {
  if (!isPoint3(a) || !isPoint3(b)) return false
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= max
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/**
 * F1 — the verdict, as `{ problem, message }`. `problem` is a reason code or
 * null; `message` is null when the value is legal. `message` carries the
 * engine's own text for `behavior-graph`.
 *
 * @param {*} value
 * @param {{ownId?: string}} [options]
 * @returns {{problem: string|null, message: string|null}}
 */
export function behaviorCheck(value, { ownId } = {}) {
  const fail = (problem, message) => ({ problem, message: message ?? behaviorReasonText(problem) })

  // S8 / V9 — the forbidden-key and depth walk runs FIRST of all, before
  // anything looks at the value's shape, and it is ITERATIVE: a value nested a
  // few thousand deep is refused, never a stack overflow. This copy is the one
  // the browser uses, and the shared vectors pin both copies to the same rules.
  if (!isPlainObject(value)) return fail('behavior-type')
  if (walkGuards(value, BEHAVIOR_DEPTH_MAX) !== null) return fail('behavior-type')

  for (const key of Object.keys(value)) {
    if (!BEHAVIOR_KEYS.includes(key)) return fail('behavior-type')
  }

  if (value.kind !== 'graph') return fail('behavior-kind')
  if (value.origin !== 'local') return fail('behavior-origin')
  if (!isBool(value.enabled)) return fail('behavior-enabled')

  let serialized
  try { serialized = JSON.stringify(value) } catch { return fail('behavior-type') }
  if (serialized === undefined) return fail('behavior-type')
  if (serialized.length > BEHAVIOR_BYTES_MAX) return fail('behavior-bytes')

  const graph = value.graph
  if (!isPlainObject(graph)) return fail('behavior-graph')

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : null
  const declarations = Array.isArray(graph.declarations) ? graph.declarations : null
  const types = Array.isArray(graph.types) ? graph.types : null

  // G7's table. `variables` is absent when there are none (the schema refuses
  // an empty array); when present it is 1–32. `events` may not be empty, and is
  // at most 16.
  if (!nodes || nodes.length > BEHAVIOR_NODES_MAX) return fail('behavior-size')
  if (!declarations || declarations.length > BEHAVIOR_DECLS_MAX) return fail('behavior-size')
  if (!types || types.length > BEHAVIOR_TYPES_MAX) return fail('behavior-size')
  if (Object.hasOwn(graph, 'variables')) {
    if (!Array.isArray(graph.variables)) return fail('behavior-size')
    if (graph.variables.length === 0 || graph.variables.length > BEHAVIOR_VARIABLES_MAX) return fail('behavior-size')
    // R-L1 (a) — a variable entry's keys are `type` (required) and `value`
    // (optional), and nothing else. The Khronos graphs name their variables
    // (names run to 361 characters of test prose), but a label never runs, so
    // the rule stays key-exact and the importer drops `name`. The reason code
    // is this list's existing one (`behavior-size`).
    for (const entry of graph.variables) {
      if (!isPlainObject(entry)) return fail('behavior-size')
      if (!Object.hasOwn(entry, 'type')) return fail('behavior-size')
      if (Object.keys(entry).some((k) => k !== 'type' && k !== 'value')) return fail('behavior-size')
    }
  }
  if (Object.hasOwn(graph, 'events')) {
    if (!Array.isArray(graph.events)) return fail('behavior-event')
    if (graph.events.length === 0) return fail('behavior-size')
    if (graph.events.length > BEHAVIOR_EVENTS_MAX) return fail('behavior-size')
  }

  // G1 — declarations. **Any declaration the validator accepts is STORED**
  // (G-L3 (a)): the rule no longer filters by op name. What it still decides is
  // each string's bound and character set (4c passdown §4.1) and uniqueness by
  // `(op, extension)`.
  const seenDeclarations = new Set()
  for (const decl of declarations) {
    if (!isPlainObject(decl) || typeof decl.op !== 'string') return fail('behavior-op')
    const op = decl.op
    if (op.length < 1 || op.length > BEHAVIOR_STRING_MAX || !BEHAVIOR_OP_RE.test(op)) return fail('behavior-op')
    if (Object.hasOwn(decl, 'extension')) {
      const extension = decl.extension
      if (typeof extension !== 'string' || extension.length < 1 ||
        extension.length > BEHAVIOR_STRING_MAX || !BEHAVIOR_EXTENSION_RE.test(extension)) {
        return fail('behavior-op')
      }
    }
    // The ONE exception to "stored and inert" (Rev 1.1, S1): event/onSelect is
    // exactly `{ op, extension: KHR_node_selectability }` or it is refused.
    if (op === 'event/onSelect') {
      const keys = Object.keys(decl)
      if (keys.length !== 2 || keys.some((k) => k !== 'op' && k !== 'extension')) return fail('behavior-op')
      if (decl.extension !== ONSELECT_DECLARATION.extension) return fail('behavior-op')
    }
    const identity = declarationIdentity(op, decl.extension)
    if (seenDeclarations.has(identity)) return fail('behavior-op')
    seenDeclarations.add(identity)
  }

  // G1/P9 — a node whose declaration IS executable may not take a VALUE input
  // from a node whose declaration is not (`p3`: a running node reading a no-op'd
  // core value op throws at its first tick and disposes the behaviour). Judged by
  // identity, not by name. An unsupported node may only end flows.
  const supportedNodes = new Set()
  for (const { node, identity } of graphNodes(graph)) {
    if (identity !== null && isExecutableDeclaration(declarationOf(graph, node.declaration)?.op, declarationOf(graph, node.declaration)?.extension)) {
      supportedNodes.add(node)
    }
  }
  for (const { node, op } of graphNodes(graph)) {
    if (!supportedNodes.has(node)) continue
    for (const [socket, input] of Object.entries(isPlainObject(node.values) ? node.values : {})) {
      if (!isSocket(input)) continue
      const source = graph?.nodes?.[input.node]
      if (!isPlainObject(source)) return fail('behavior-op')
      const sourceDecl = declarationOf(graph, source.declaration)
      const sourceOp = sourceDecl?.op
      if (typeof sourceOp !== 'string' || !isExecutableDeclaration(sourceOp, sourceDecl.extension)) {
        return fail('behavior-op', `a node reads a value from an operation Atrium doesn't run (${socket})`)
      }
    }
    void op
  }

  // S9 — an event/onSelect node is configured nodeIndex 0, stopPropagation false.
  for (const { node, op } of graphNodes(graph)) {
    if (op !== 'event/onSelect') continue
    if (!isPlainObject(node)) return fail('behavior-op')
    const configuration = node.configuration
    if (!isPlainObject(configuration)) return fail('behavior-op')
    if (literalOf(configuration.nodeIndex) !== 0) return fail('behavior-op')
    if (literalOf(configuration.stopPropagation) !== false) return fail('behavior-op')
  }

  // G1 — the declared events. An id is 1–64 characters of
  // `[A-Za-z0-9_./:-]` and unique. The prefix `atrium/` is reserved for the
  // three Atrium ids, which keep F-L7's rules (exactly `{ id }`); **R2/R-L1
  // (a):** every other entry's keys are `id` (required) and `values` (optional),
  // and nothing else — the Khronos graphs' `name` labels are dropped by the
  // importer, never stored.
  const events = Array.isArray(graph.events) ? graph.events : []
  const seenEvents = new Set()
  for (const entry of events) {
    if (!isPlainObject(entry)) return fail('behavior-event')
    const id = entry.id
    if (typeof id !== 'string' || id.length < 1 || id.length > BEHAVIOR_STRING_MAX) return fail('behavior-event')
    if (!BEHAVIOR_EVENT_ID_RE.test(id)) return fail('behavior-event')
    if (seenEvents.has(id)) return fail('behavior-event')
    seenEvents.add(id)
    const keys = Object.keys(entry)
    if (id.startsWith('atrium/')) {
      if (!BEHAVIOR_EVENTS.includes(id)) return fail('behavior-event')
      if (keys.length !== 1 || keys[0] !== 'id') return fail('behavior-event')
    } else if (keys.some((k) => k !== 'id' && k !== 'values')) {
      return fail('behavior-event')
    }
  }
  const declared = declaredEvents(graph)

  // G1 — an `event/send` may not target an `atrium/*` event (`behavior-event`):
  // those are the adapter's to dispatch. The target is the declaration's
  // `configuration.event` literal index into `graph.events`. **R3:** both copies
  // run this check ONLY when that literal is an integer in range, and leave
  // anything else to the validator.
  for (const { node, op } of graphNodes(graph)) {
    if (op !== 'event/send') continue
    const configuration = isPlainObject(node) ? node.configuration : null
    const index = isPlainObject(configuration) ? literalOf(configuration.event) : null
    if (!Number.isInteger(index) || index < 0 || index >= events.length) continue
    const target = events[index]
    if (isPlainObject(target) && typeof target.id === 'string' && target.id.startsWith('atrium/')) {
      return fail('behavior-event', 'an event/send may not target an Atrium event')
    }
  }

  // nodeMap / targets (behavior-map).
  const nodeMap = value.nodeMap
  if (!Array.isArray(nodeMap) || nodeMap.length < BEHAVIOR_NODEMAP_MIN || nodeMap.length > BEHAVIOR_NODEMAP_MAX) {
    return fail('behavior-map')
  }
  if (!nodeMap.every(isE1)) return fail('behavior-map')
  if (new Set(nodeMap).size !== nodeMap.length) return fail('behavior-map')
  if (ownId !== undefined && nodeMap[0] !== ownId) return fail('behavior-map')

  const targets = value.targets
  if (!Array.isArray(targets) || targets.length > BEHAVIOR_TARGETS_MAX) return fail('behavior-map')
  if (!targets.every(isE1)) return fail('behavior-map')
  if (new Set(targets).size !== targets.length) return fail('behavior-map')

  // The animations table (behavior-animations). Checked before the graph's
  // animation references, which index it.
  const animations = value.animations
  if (!Array.isArray(animations) || animations.length > BEHAVIOR_ANIMS_MAX) return fail('behavior-animations')
  for (const entry of animations) {
    if (!isPlainObject(entry)) return fail('behavior-animations')
    const keys = Object.keys(entry)
    if (keys.length !== 3 || keys.some((k) => k !== 'object' && k !== 'clip' && k !== 'loop')) {
      return fail('behavior-animations')
    }
    if (!isE1(entry.object)) return fail('behavior-animations')
    if (!isClip(entry.clip)) return fail('behavior-animations')
    if (!isBool(entry.loop)) return fail('behavior-animations')
  }

  // "an animation/* op present with an empty table" — the table's reason, not
  // the index's, so it is decided before the per-node walk.
  const hasAnimationOp = [...graphNodes(graph)].some(({ op }) => op === 'animation/start' || op === 'animation/stop')
  if (hasAnimationOp && animations.length === 0) return fail('behavior-animations')

  // F1 — pointers, literals and the animation table, node by node.
  for (const { node, op } of graphNodes(graph)) {
    if (op === 'pointer/get' || op === 'pointer/set' || op === 'pointer/interpolate') {
      const configuration = isPlainObject(node) ? node.configuration : null
      const pointer = isPlainObject(configuration) ? literalOf(configuration.pointer) : null
      if (typeof pointer !== 'string') return fail('behavior-pointer')
      // G-L4 — a pointer in one of the families 4d registers has its literal
      // index or literal ref bounded against `nodeMap`; a pointer OUTSIDE the
      // families is not checked beyond the validator and the size limit
      // (G-L3 (a): it is stored and inert).
      const binding = pointerBinding(node, pointer, nodeMap.length)
      if (binding === false) return fail('behavior-pointer')
      continue
    }
    if (op === 'animation/start' || op === 'animation/stop') {
      const values = isPlainObject(node) ? node.values : null
      const animation = isPlainObject(values) ? literalOf(values.animation) : null
      if (typeof animation !== 'string') return fail('behavior-literal')
      const match = /^\/animations\/(\d+)$/.exec(animation)
      if (!match) return fail('behavior-literal')
      const i = Number(match[1])
      if (!Number.isInteger(i) || i < 0 || i >= animations.length) return fail('behavior-literal')
      if (op === 'animation/start') {
        const speed = isPlainObject(node) ? literalOf(node.values?.speed) : null
        if (!isFiniteNumber(speed) || speed < BEHAVIOR_SPEED_MIN || speed > BEHAVIOR_SPEED_MAX) {
          return fail('behavior-literal')
        }
      }
      continue
    }
  }

  // F-L7 — proximity and interval are present exactly when the graph declares
  // the events that need them.
  const needsProximity = declared.has('atrium/enter') || declared.has('atrium/exit')
  const hasProximity = Object.hasOwn(value, 'proximity')
  if (hasProximity) {
    const proximity = value.proximity
    if (!isPlainObject(proximity)) return fail('behavior-proximity')
    const keys = Object.keys(proximity)
    if (keys.length !== 1 || keys[0] !== 'radius') return fail('behavior-proximity')
    if (!isRadius(proximity.radius)) return fail('behavior-proximity')
    if (!needsProximity) return fail('behavior-proximity')
  } else if (needsProximity) {
    return fail('behavior-proximity')
  }

  const needsInterval = declared.has('atrium/interval')
  const hasInterval = Object.hasOwn(value, 'interval')
  if (hasInterval) {
    const interval = value.interval
    if (!isPlainObject(interval)) return fail('behavior-interval')
    const keys = Object.keys(interval)
    if (keys.length !== 1 || keys[0] !== 'seconds') return fail('behavior-interval')
    if (!isSeconds(interval.seconds)) return fail('behavior-interval')
    if (!needsInterval) return fail('behavior-interval')
  } else if (needsInterval) {
    return fail('behavior-interval')
  }

  // Rev 2 S5 — template.params, per template, and nothing else.
  if (Object.hasOwn(value, 'template')) {
    const template = value.template
    if (!isPlainObject(template)) return fail('behavior-template')
    const keys = Object.keys(template)
    if (keys.length !== 2 || keys.some((k) => k !== 'id' && k !== 'params')) return fail('behavior-template')
    if (!BEHAVIOR_TEMPLATES.includes(template.id)) return fail('behavior-template')
    if (!templateParamsOk(template.id, template.params)) return fail('behavior-template')
  }

  // §8 — the validator runs LAST. It is the gate, not the loader: an accepted
  // template must pass THIS, not merely `loadBehaveGraph`.
  try {
    validateInteractivityGraph(graph)
  } catch (error) {
    return fail('behavior-graph', `the graph is not a valid KHR_interactivity graph: ${error?.message ?? error}`)
  }

  return { problem: null, message: null }
}

/**
 * F1 — the reason code for a behaviour value, or null when it may be stored.
 * A thin wrapper over `behaviorCheck`, kept because the vectors and the server's
 * copy speak in codes.
 *
 * @param {*} value
 * @param {{ownId?: string}} [options]
 * @returns {string|null}
 */
export function behaviorProblem(value, options = {}) {
  return behaviorCheck(value, options).problem
}

/**
 * G1 / G-L4 — how a pointer's index binds to `nodeMap`.
 *
 * `false` means the pointer IS in one of G-L4's families and its LITERAL index
 * or LITERAL ref is out of bounds (or malformed): the rule refuses it. `true`
 * means the pointer is outside the families (not checked here) or its index is
 * a WIRED socket (the registry bounds it at run time, `p4`). Otherwise the
 * bound index and the family are returned.
 */
function pointerBinding(node, pointer, nodeMapLength) {
  const family = POINTER_FAMILIES.find((entry) => entry.re.test(pointer))
  if (!family) return true
  const match = family.re.exec(pointer)
  const token = match[1]
  const values = isPlainObject(node) ? node.values : null

  if (/^\d+$/.test(token)) {
    const index = Number(token)
    if (!Number.isInteger(index) || index < 0 || index >= nodeMapLength) return false
    return { index, family: family.family }
  }

  const socket = token.slice(1, -1)
  const input = isPlainObject(values) ? values[socket] : null
  if (isSocket(input)) return true                      // wired: allowed (P15)
  const literal = literalOf(input)

  if (token.startsWith('[')) {                          // [x] — an INT index literal
    if (!Number.isInteger(literal) || literal < 0 || literal >= nodeMapLength) return false
    return { index: literal, family: family.family }
  }

  // {x} — a REF literal: `/nodes/<i>` or, for a light, the light's own pointer.
  const prefix = family.family === 'light' ? '/extensions/KHR_lights_punctual/lights/' : '/nodes/'
  if (typeof literal !== 'string' || !literal.startsWith(prefix)) return false
  const rest = literal.slice(prefix.length)
  if (!/^\d+$/.test(rest)) return false
  const index = Number(rest)
  if (!Number.isInteger(index) || index < 0 || index >= nodeMapLength) return false
  return { index, family: family.family }
}
