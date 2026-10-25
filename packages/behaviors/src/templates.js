// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// templates — F8's five templates (scripting-4b-2).
//
// `templateGraph(id, params, { ownId })` is a pure function and the form's ONLY
// way to write a behaviour. It returns the complete stored value:
//
//   { graph, nodeMap, targets, animations, proximity?, interval?, template }
//
// The graph is standard KHR_interactivity: `types` is the engine's table for the
// signatures used and is never empty, `variables` is absent (4b-2 has none), and
// `events` appears only in the two templates that declare one. `event/onSelect`
// is declared WITH its extension and configured `nodeIndex: 0,
// stopPropagation: false` (§2.3: bare, the validator calls it an unknown core
// op). Pointer templates are `[n]` with an int literal (M1: `{n}` makes the
// index a ref socket the decorator never registers).
//
// OF NOTE — the third argument. F8 writes the signature as
// `templateGraph(id, params)`, but `nodeMap[0]` is the behaviour node's own id
// and the template cannot invent it; nor may it ride in `params`, whose key set
// Rev 2 S5 pins per template. It is therefore passed in a context object, and
// the form passes the same `ownId` when it re-generates a saved value to decide
// between the template and "Custom graph" (F9).
// ---------------------------------------------------------------------------

/** The engine's type table, in the indices the templates use. */
const T = { bool: 0, int: 1, float: 2, ref: 3 }
const TYPES = Object.freeze([
  { signature: 'bool' }, { signature: 'int' }, { signature: 'float' }, { signature: 'ref' },
])

const VIS = (n) => `/nodes/${n}/extensions/KHR_node_visibility/visible`
const LIGHT = (n) => `/extensions/KHR_lights_punctual/lights/${n}/intensity`

const lit = (type, value) => ({ type, value: [value] })
const to = (node, socket = 'in') => ({ node, socket })

/** Every template's params must carry a target. */
const TARGET_KEY = 'target'

/**
 * Assemble a graph from a list of nodes whose ops are given in FLOW ORDER: the
 * declarations come out in the order the ops first appear, which is what F8
 * means by "declarations in flow order".
 */
function buildGraph(nodes, { events } = {}) {
  const ops = []
  for (const node of nodes) if (!ops.includes(node.op)) ops.push(node.op)
  const graph = {
    types: TYPES.map((t) => ({ ...t })),
    declarations: ops.map((op) => (op === 'event/onSelect'
      ? { op, extension: 'KHR_node_selectability' }
      : { op })),
    nodes: nodes.map(({ op, ...rest }) => ({ declaration: ops.indexOf(op), ...rest })),
  }
  if (Array.isArray(events) && events.length > 0) graph.events = events.map((id) => ({ id }))
  return graph
}

/** The nodeMap / targets pair every template derives from its target and ownId. */
function mapsFor(target, ownId, { includeOwn = false } = {}) {
  const selfTarget = target === ownId
  const nodeMap = selfTarget ? [ownId] : (includeOwn ? [ownId, target] : [ownId, target])
  const targets = selfTarget ? [] : [target]
  return { nodeMap, targets }
}

/** The animation triple every animation template writes. */
const animationFor = (target, clip, loop) => [{ object: target, clip, loop }]

/**
 * F8 — build the stored value for one of the five templates.
 *
 * @param {'select-visibility'|'select-animation'|'proximity-animation'|'select-light'|'interval-animation'} id
 * @param {object} params
 * @param {{ownId: string}} context    the behaviour node's own object id
 * @returns {object}                   the complete `extras.atrium.behavior` value
 */
export function templateGraph(id, params, { ownId } = {}) {
  const target = params?.[TARGET_KEY]
  switch (id) {
    case 'select-visibility': {
      const show = params.action !== 'hide'
      const { nodeMap, targets } = mapsFor(target, ownId)
      const nodes = params.action === 'toggle'
        ? [
            // onSelect flows to the WRITE node, not to pointer/get: `pointer/get`
            // has no input flow (it is a value source, pulled by its consumer),
            // so a flow to it is dropped and the toggle would never run.
            { op: 'event/onSelect', configuration: onSelectConfiguration(), flows: { out: to(3) } },
            pointerGet(VIS('[n]'), T.bool),
            { op: 'math/not', values: { a: { node: 1, socket: 'value' } } },
            pointerSet(VIS('[n]'), T.bool, { node: 2, socket: 'value' }),
          ]
        : [
            { op: 'event/onSelect', configuration: onSelectConfiguration(), flows: { out: to(1) } },
            pointerSet(VIS('[n]'), T.bool, lit(T.bool, show)),
          ]
      return finish('select-visibility', params, {
        graph: buildGraph(nodes),
        nodeMap,
        targets,
        animations: [],
      })
    }

    case 'select-animation': {
      const { nodeMap, targets } = mapsFor(target, ownId)
      const nodes = [
        { op: 'event/onSelect', configuration: onSelectConfiguration(), flows: { out: to(1) } },
        params.action === 'stop' ? animationStop() : animationStart(),
      ]
      return finish('select-animation', params, {
        graph: buildGraph(nodes),
        nodeMap,
        targets,
        animations: animationFor(target, params.clip, params.loop),
      })
    }

    case 'proximity-animation': {
      const { nodeMap, targets } = mapsFor(target, ownId)
      const nodes = [
        { op: 'event/receive', configuration: eventConfiguration(0), flows: { out: to(2) } },
        { op: 'event/receive', configuration: eventConfiguration(1), flows: { out: to(3) } },
        animationStart(),
        animationStop(),
      ]
      return finish('proximity-animation', params, {
        graph: buildGraph(nodes, { events: ['atrium/enter', 'atrium/exit'] }),
        nodeMap,
        targets,
        animations: animationFor(target, params.clip, params.loop),
        proximity: { radius: params.radius },
      })
    }

    case 'select-light': {
      const { nodeMap, targets } = mapsFor(target, ownId)
      const nodes = [
        // onSelect flows to the branch (a flow node), not to pointer/get: a
        // value source has no input flow and the flow to it would be dropped.
        { op: 'event/onSelect', configuration: onSelectConfiguration(), flows: { out: to(3) } },
        pointerGet(LIGHT('[n]'), T.float),
        { op: 'math/gt', values: { a: { node: 1, socket: 'value' }, b: lit(T.float, 0) } },
        {
          op: 'flow/branch',
          values: { condition: { node: 2, socket: 'value' } },
          flows: { true: to(4), false: to(5) },
        },
        pointerSet(LIGHT('[n]'), T.float, lit(T.float, 0)),
        pointerSet(LIGHT('[n]'), T.float, lit(T.float, params.intensity)),
      ]
      return finish('select-light', params, {
        graph: buildGraph(nodes),
        nodeMap,
        targets,
        animations: [],
      })
    }

    case 'interval-animation': {
      const { nodeMap, targets } = mapsFor(target, ownId)
      const nodes = [
        { op: 'event/receive', configuration: eventConfiguration(0), flows: { out: to(1) } },
        animationStart(),
      ]
      return finish('interval-animation', params, {
        graph: buildGraph(nodes, { events: ['atrium/interval'] }),
        nodeMap,
        targets,
        animations: animationFor(target, params.clip, params.loop),
        interval: { seconds: params.seconds },
      })
    }

    default:
      throw new Error(`unknown template id: ${id}`)
  }
}

/** S9 — the event/onSelect configuration every template writes. */
function onSelectConfiguration() {
  return { nodeIndex: lit(T.int, 0), stopPropagation: lit(T.bool, false) }
}

/** event/receive's `event` configuration is the INDEX of the declared event. */
function eventConfiguration(index) {
  return { event: { value: [index] } }
}

function pointerGet(pointer, type) {
  return {
    op: 'pointer/get',
    configuration: { pointer: { value: [pointer] }, type: { value: [type] } },
    values: { n: lit(T.int, 1) },
  }
}

function pointerSet(pointer, type, value) {
  return {
    op: 'pointer/set',
    configuration: { pointer: { value: [pointer] }, type: { value: [type] } },
    values: { n: lit(T.int, 1), value },
  }
}

function animationStart() {
  return {
    op: 'animation/start',
    values: {
      animation: lit(T.ref, '/animations/0'),
      startTime: lit(T.float, 0),
      endTime: lit(T.float, 3600),
      speed: lit(T.float, 1),
    },
  }
}

function animationStop() {
  return { op: 'animation/stop', values: { animation: lit(T.ref, '/animations/0') } }
}

/** Attach `template` and hand the value back with its keys in F-L2's order. */
function finish(id, params, value) {
  return {
    kind: 'graph',
    graph: value.graph,
    nodeMap: value.nodeMap,
    targets: value.targets,
    animations: value.animations,
    ...(value.proximity ? { proximity: value.proximity } : {}),
    ...(value.interval ? { interval: value.interval } : {}),
    template: { id, params: { ...params } },
    enabled: params.enabled === undefined ? true : params.enabled,
    origin: 'local',
  }
}

/** The five template ids, in the panel's display order (F9). */
export const TEMPLATE_IDS = Object.freeze([
  'select-visibility', 'select-animation', 'proximity-animation', 'select-light', 'interval-animation',
])

/** F9 — the display names, exactly as the panel shows them. */
export const TEMPLATE_LABELS = Object.freeze({
  'select-visibility':  'On select: show or hide',
  'select-animation':   'On select: play or stop an animation',
  'proximity-animation': 'On enter: play; on exit: stop',
  'select-light':       'On select: toggle a light',
  'interval-animation': 'Every N seconds: play',
})

/** F8 — the parameters each template reads, for the form's fields. */
export const TEMPLATE_FIELDS = Object.freeze({
  'select-visibility':  ['target', 'action'],
  'select-animation':   ['target', 'clip', 'action', 'loop'],
  'proximity-animation': ['target', 'clip', 'loop', 'radius'],
  'select-light':       ['target', 'intensity'],
  'interval-animation': ['target', 'clip', 'loop', 'seconds'],
})

/** F8 — the actions each template offers. */
export const TEMPLATE_ACTIONS = Object.freeze({
  'select-visibility': ['show', 'hide', 'toggle'],
  'select-animation':  ['play', 'stop'],
})

/** F8's default parameters, so the form can open a template with sane values. */
export const TEMPLATE_DEFAULTS = Object.freeze({
  radius: 3,
  seconds: 30,
  loop: true,
})
