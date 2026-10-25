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

export const BEHAVIOR_BYTES_MAX   = 16384
export const BEHAVIOR_NODES_MAX   = 64
export const BEHAVIOR_DECLS_MAX   = 32
export const BEHAVIOR_TYPES_MAX   = 16
export const BEHAVIOR_EVENTS_MAX  = 8
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
export const BEHAVIOR_OPS = Object.freeze([
  'event/onSelect', 'event/receive', 'flow/branch', 'pointer/get', 'pointer/set',
  'math/not', 'math/gt', 'animation/start', 'animation/stop', 'debug/log',
])

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
const POINTER_PATTERNS = [
  /^\/nodes\/(\[n\]|\d+)\/(translation|rotation|scale)$/,
  /^\/nodes\/(\[n\]|\d+)\/extensions\/KHR_node_visibility\/visible$/,
  /^\/extensions\/KHR_lights_punctual\/lights\/(\[n\]|\d+)\/intensity$/,
]

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

/** Every graph node with its declaration resolved: `{ node, op }`, in order. */
function* graphNodes(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  for (const node of nodes) {
    if (!isPlainObject(node)) { yield { node, op: null }; continue }
    const decl = declarationOf(graph, node.declaration)
    yield { node, op: decl ? decl.op : null }
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

  // F7's table. `variables` may not appear at all (M4: the schema refuses an
  // empty array, so the key is simply absent); `events` may not be empty.
  if (!nodes || nodes.length > BEHAVIOR_NODES_MAX) return fail('behavior-size')
  if (!declarations || declarations.length > BEHAVIOR_DECLS_MAX) return fail('behavior-size')
  if (!types || types.length > BEHAVIOR_TYPES_MAX) return fail('behavior-size')
  if (Object.hasOwn(graph, 'variables')) return fail('behavior-size')
  if (Object.hasOwn(graph, 'events')) {
    if (!Array.isArray(graph.events)) return fail('behavior-event')
    if (graph.events.length === 0) return fail('behavior-size')
    if (graph.events.length > BEHAVIOR_EVENTS_MAX) return fail('behavior-size')
  }

  // F-L4 — the op allowlist, the declaration shapes and their uniqueness.
  const seenDeclarations = new Set()
  for (const decl of declarations) {
    if (!isPlainObject(decl) || typeof decl.op !== 'string') return fail('behavior-op')
    const op = decl.op
    if (!BEHAVIOR_OPS.includes(op)) return fail('behavior-op')
    if (op === 'event/onSelect') {
      const keys = Object.keys(decl)
      if (keys.length !== 2 || keys.some((k) => k !== 'op' && k !== 'extension')) return fail('behavior-op')
      if (decl.extension !== ONSELECT_DECLARATION.extension) return fail('behavior-op')
    } else if (Object.keys(decl).length !== 1) {
      return fail('behavior-op')
    }
    const identity = `${op}|${decl.extension ?? ''}`
    if (seenDeclarations.has(identity)) return fail('behavior-op')
    seenDeclarations.add(identity)
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

  // F-L7 — the declared events, and only the three this round dispatches.
  const events = Array.isArray(graph.events) ? graph.events : []
  for (const entry of events) {
    if (!isPlainObject(entry)) return fail('behavior-event')
    const keys = Object.keys(entry)
    if (keys.length !== 1 || keys[0] !== 'id') return fail('behavior-event')
    if (!BEHAVIOR_EVENTS.includes(entry.id)) return fail('behavior-event')
  }
  const declared = declaredEvents(graph)

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
    if (op === 'pointer/get' || op === 'pointer/set') {
      const configuration = isPlainObject(node) ? node.configuration : null
      const pointer = isPlainObject(configuration) ? literalOf(configuration.pointer) : null
      if (typeof pointer !== 'string') return fail('behavior-pointer')
      if (!POINTER_PATTERNS.some((re) => re.test(pointer))) return fail('behavior-pointer')
      const index = pointerIndex(node, pointer, nodeMap.length)
      if (index === null) return fail('behavior-pointer')
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

/** The `[n]` / `<int>` index a pointer names, or null when it is not addressable. */
function pointerIndex(node, pointer, nodeMapLength) {
  const match = /\/(\[n\]|\d+)\//.exec(pointer)
  if (!match) return null
  let index
  if (match[1] === '[n]') {
    const values = isPlainObject(node) ? node.values : null
    if (!isPlainObject(values)) return null
    if (isSocket(values.n)) return null          // a socket-connected index is refused
    index = literalOf(values.n)
  } else {
    index = Number(match[1])
  }
  if (!Number.isInteger(index) || index < 0 || index >= nodeMapLength) return null
  return index
}
