// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * graph-import.js — scripting-4d-1 G6, the importer's pure half.
 *
 * NO DOM, no three.js, no fetch: the bytes in, the verdict out. The panel
 * (`graph-import-panel.js`) is the only caller that touches a page.
 *
 * Three functions, in the order the panel calls them:
 *
 *  - `parseGraphSource(bytes, { name })` — the source, refused before anything
 *    else at 4 MiB of BYTES (checked before decoding), a `.glb`'s header and
 *    chunks checked structurally (only its one JSON chunk is read, no buffers),
 *    the JSON parsed in a `try`, its DEPTH checked iteratively before any
 *    recursive walk, and the graph counts checked before any conversion. Every
 *    failure is a `problem` the panel shows; the panel is never left waiting.
 *  - `referencesOf(graph)` — every literal reference in a graph, wherever it
 *    sits: a pointer's index, a `{ref}` literal in a node's values, a
 *    variable's initial value, an event's value default, `onSelect`'s
 *    `nodeIndex`, and `/animations/<i>`. Refs to families Atrium doesn't map
 *    (`/materials/…`, `/meshes/…`) land in `other`, each with its CONSUMERS,
 *    and a pointer index that is a WIRED socket lands in `wired`.
 *  - `convertGraph(graph, mapping)` — rewrites every reference through the
 *    mapping, or refuses naming the reference; drops `name` from every event
 *    and variable entry (R-L1 (a)) and lists how many; refuses an event entry
 *    with no `id`, naming its index; and returns a complete behaviour leaf that
 *    passes `behaviorCheck`.
 *
 * The importer NEVER produces a conversion that would retarget anything
 * silently: an unmapped node reference, a wired index, a ref whose meaning
 * can't survive the import, and a graph whose leaf the rule refuses are all
 * `problem`s, never a value.
 */

import { graphReport } from '@atrium/behaviors/adapter'
import {
  behaviorCheck, behaviorReasonText, isExecutableDeclaration, isSupportedPointerPath,
} from '@atrium/behaviors/behavior-spec'
import {
  STARTS_ON_LOAD_NOTE, SAMPLED_MOTION_NOTE, MISSING_SELECT_NOTE,
} from '@atrium/behaviors/runner'

// ---------------------------------------------------------------------------
// G7's import row, and the numbers this module owns
// ---------------------------------------------------------------------------

/** G7 — the source is at most 4 MiB of BYTES, checked before decoding. */
export const IMPORT_BYTES_MAX = 4 * 1024 * 1024
/** G7 — the JSON's nesting depth. */
export const IMPORT_DEPTH_MAX = 64
/** G7 — at most 16 graphs in one source. */
export const IMPORT_GRAPHS_MAX = 16
/** G7 — `nodeMap` holds at most 16 objects (one behaviour, one object tree). */
export const IMPORT_OBJECTS_MAX = 16

const GLB_MAGIC = 0x46546c67            // 'glTF', little-endian
const GLB_JSON_CHUNK = 0x4e4f534a       // 'JSON', little-endian
const GLB_VERSION = 2

const NODE_RE = /^\/nodes\/(\d+)((?:\/[^]*)?)$/
const LIGHT_RE = /^\/extensions\/KHR_lights_punctual\/lights\/(\d+)((?:\/[^]*)?)$/
const ANIMATION_RE = /^\/animations\/(\d+)$/
/** A pointer's index token: a literal, the engine's INT socket, or a REF socket. */
const POINTER_TOKEN_RE = /^(\/nodes|\/extensions\/KHR_lights_punctual\/lights)\/(\d+|\[[^\]]+\]|\{[^}]+\})((?:\/[^]*)?)$/

const ON_SELECT = 'event/onSelect'
/** R-L1 (a) / Rev 1.2 N4 — the ONLY carriers a ref is followed through. */
const CARRIERS = new Set(['variable/set', 'variable/get', 'event/send', 'event/receive'])

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isSocket = (v) => isObject(v) && v.node !== undefined && v.socket !== undefined

/** A graph literal — `{ type, value: [ one ] }` — or null. */
function literalAt(input) {
  if (!isObject(input) || !Array.isArray(input.value) || input.value.length !== 1) return null
  return input.value[0]
}

/** The first path segment of a pointer, which is its family. */
function familyOf(ref) {
  const parts = String(ref).split('/')
  return parts[1] || ''
}

/** A plain-language description of where a reference was found. */
export function describeWhere(where) {
  if (!isObject(where)) return 'the graph'
  switch (where.site) {
    case 'pointer': return `node ${where.node}'s pointer`
    case 'value': return `node ${where.node}'s \`${where.socket}\` value`
    case 'variable': return `variable ${where.variable}'s initial value`
    case 'event': return `event ${where.event}'s \`${where.socket}\` default`
    case 'nodeIndex': return `node ${where.node}'s \`nodeIndex\``
    default: return 'the graph'
  }
}

// ---------------------------------------------------------------------------
// parseGraphSource
// ---------------------------------------------------------------------------

/** The bytes as a `Uint8Array`, or null when the input is not bytes. */
function toBytes(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  return null
}

const DECODER = typeof TextDecoder === 'function' ? new TextDecoder('utf-8', { fatal: false }) : null

function decodeUtf8(bytes) {
  if (DECODER) return DECODER.decode(bytes)
  return Buffer.from(bytes).toString('utf8')
}

function readU32(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

/** The furthest nesting level of a JSON value, counted ITERATIVELY. */
export function jsonDepth(value) {
  let max = 0
  const stack = [[value, 1]]
  while (stack.length > 0) {
    const [node, depth] = stack.pop()
    if (depth > max) max = depth
    if (typeof node !== 'object' || node === null) continue
    for (const key of Object.keys(node)) stack.push([node[key], depth + 1])
  }
  return max
}

/** G8's `.glb` reader — the magic, version 2, the length, and the ONE JSON chunk. */
function readGlb(data) {
  if (data.length < 12) return { problem: 'the .glb is shorter than its 12-byte header' }
  if (readU32(data, 0) !== GLB_MAGIC) return { problem: 'the .glb magic is not "glTF"' }
  const version = readU32(data, 4)
  if (version !== GLB_VERSION) return { problem: `the .glb version is ${version}; only version 2 is read` }
  const declared = readU32(data, 8)
  if (declared !== data.length) return { problem: `the .glb header declares ${declared} bytes; the file is ${data.length}` }

  const chunks = []
  let offset = 12
  while (offset < data.length) {
    if (offset + 8 > data.length) return { problem: 'a .glb chunk header runs past the end of the file' }
    const length = readU32(data, offset)
    const type = readU32(data, offset + 4)
    if (length % 4 !== 0) return { problem: 'a .glb chunk length is not 4-byte aligned' }
    if (offset + 8 + length > data.length) return { problem: 'a .glb chunk runs past the end of the file' }
    chunks.push({ type, start: offset + 8, length })
    offset += 8 + length
  }

  if (chunks.length === 0 || chunks[0].type !== GLB_JSON_CHUNK) return { problem: 'the first .glb chunk is not JSON' }
  const jsonChunks = chunks.filter((chunk) => chunk.type === GLB_JSON_CHUNK)
  if (jsonChunks.length !== 1) return { problem: `the .glb has ${jsonChunks.length} JSON chunks; exactly one is read` }
  const chunk = jsonChunks[0]
  return { text: decodeUtf8(data.subarray(chunk.start, chunk.start + chunk.length)) }
}

/** G7's per-graph counts, checked BEFORE any conversion. */
function graphWithinLimits(graph) {
  if (!isObject(graph)) return 'the graph is not an object'
  if (!Array.isArray(graph.declarations)) return 'the graph has no declarations'
  if (!Array.isArray(graph.nodes)) return 'the graph has no nodes'
  if (graph.nodes.length > 256) return `the graph has ${graph.nodes.length} nodes; the limit is 256`
  if (graph.declarations.length > 64) return `the graph has ${graph.declarations.length} declarations; the limit is 64`
  if (Array.isArray(graph.types) && graph.types.length > 16) return `the graph has ${graph.types.length} types; the limit is 16`
  if (Object.hasOwn(graph, 'variables') && (!Array.isArray(graph.variables) || graph.variables.length > 32)) {
    return 'the graph has more than 32 variables'
  }
  if (Object.hasOwn(graph, 'events') && (!Array.isArray(graph.events) || graph.events.length > 16)) {
    return 'the graph has more than 16 events'
  }
  return null
}

const nodeName = (node, index) => (isObject(node) && typeof node.name === 'string' && node.name !== ''
  ? node.name
  : `node ${index}`)

/**
 * G6 — read a source's bytes.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{name?: string}} [options]  the file name, which decides the GLB path
 * @returns {{graphs: Array<object>, graphIndex: number, fileNodes: Array<{index: number, name: string}>,
 *            fileLights: Array<{index: number, name: string}>,
 *            fileAnimations: Array<{index: number, name: string}>} | {problem: string}}
 */
export function parseGraphSource(bytes, { name = '' } = {}) {
  const data = toBytes(bytes)
  if (data === null) return { problem: 'the source is not bytes' }
  // G7 / Rev 1 S4 — the size is checked BEFORE decoding, so a hostile source is
  // never decoded to find out how big it is.
  if (data.length > IMPORT_BYTES_MAX) {
    return { problem: `the source is ${data.length} bytes; the limit is ${IMPORT_BYTES_MAX} (4 MiB)` }
  }

  const isGlb = /\.glb$/i.test(String(name)) || (data.length >= 4 && readU32(data, 0) === GLB_MAGIC)
  let text
  if (isGlb) {
    const read = readGlb(data)
    if (read.problem) return read
    text = read.text
  } else {
    text = decodeUtf8(data)
  }

  let doc
  try {
    doc = JSON.parse(text)
  } catch (error) {
    return { problem: `the source is not JSON: ${error?.message ?? error}` }
  }
  if (!isObject(doc)) return { problem: 'the source is not a glTF document' }

  // The depth walk is ITERATIVE and runs before anything recursive (G6).
  const depth = jsonDepth(doc)
  if (depth > IMPORT_DEPTH_MAX) return { problem: `the JSON is ${depth} levels deep; the limit is ${IMPORT_DEPTH_MAX}` }

  const extension = isObject(doc.extensions) && isObject(doc.extensions.KHR_interactivity)
    ? doc.extensions.KHR_interactivity
    : null
  const graphs = Array.isArray(extension?.graphs) ? extension.graphs : []
  if (graphs.length === 0) return { problem: 'the source has no KHR_interactivity graphs' }
  if (graphs.length > IMPORT_GRAPHS_MAX) return { problem: `the source has ${graphs.length} graphs; the limit is ${IMPORT_GRAPHS_MAX}` }
  for (const [index, graph] of graphs.entries()) {
    const within = graphWithinLimits(graph)
    if (within) return { problem: `graph ${index}: ${within}` }
  }

  const active = Number.isInteger(extension.graph) && extension.graph >= 0 && extension.graph < graphs.length
    ? extension.graph
    : 0
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : []
  const animations = Array.isArray(doc.animations) ? doc.animations : []

  return {
    graphs,
    graphIndex: active,
    fileNodes: nodes.map((node, index) => ({ index, name: nodeName(node, index) })),
    fileLights: nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => isObject(node?.extensions?.KHR_lights_punctual))
      .map(({ node, index }) => ({ index, name: nodeName(node, index) })),
    fileAnimations: animations.map((animation, index) => ({
      index,
      name: isObject(animation) && typeof animation.name === 'string' && animation.name !== ''
        ? animation.name
        : `animation ${index}`,
    })),
  }
}

// ---------------------------------------------------------------------------
// referencesOf
// ---------------------------------------------------------------------------

/** Every graph value socket that is a socket connection: `node → [{ node, socket }]`. */
function outputReaders(graph) {
  const readers = new Map()
  for (const [index, node] of (graph.nodes ?? []).entries()) {
    if (!isObject(node) || !isObject(node.values)) continue
    for (const [socket, input] of Object.entries(node.values)) {
      if (!isSocket(input)) continue
      const list = readers.get(input.node) ?? []
      list.push({ node: index, socket })
      readers.set(input.node, list)
    }
  }
  return readers
}

/** The op of a node's declaration. */
function opOfNode(graph, index) {
  const node = graph.nodes?.[index]
  if (!isObject(node)) return null
  const decl = graph.declarations?.[node.declaration]
  return isObject(decl) ? (typeof decl.op === 'string' ? decl.op : null) : null
}

/** Every node whose `configuration[field]` literal is `value`. */
function nodesWithConfiguration(graph, op, field, value) {
  const out = []
  for (const [index, node] of (graph.nodes ?? []).entries()) {
    if (!isObject(node)) continue
    if (opOfNode(graph, index) !== op) continue
    if (literalAt(node.configuration?.[field]) === value) out.push(index)
  }
  return out
}

/**
 * G6 / Rev 1.2 N4 — the CONSUMERS of a reference: every node that reads its
 * value, followed through the four carriers only (`variable/set`,
 * `variable/get`, `event/send`, `event/receive`). A node Atrium doesn't run is
 * not a consumer; a pointer outside G-L4's families is not a consumer; any
 * other node that reads it is.
 *
 * @returns {Array<{node: number, op: string|null}>}
 */
export function consumersOf(graph, start) {
  const consumers = []
  const seen = new Set()
  const queue = [start]
  const readers = outputReaders(graph)

  const carriersAt = (item) => {
    const out = []
    const node = graph.nodes?.[item.node]
    if (item.site === 'value' || item.site === 'pointer' || item.site === 'nodeIndex') out.push(item.node)
    if (item.site === 'variable') {
      out.push(...nodesWithConfiguration(graph, 'variable/get', 'variable', item.variable))
    }
    if (item.site === 'event') {
      out.push(...nodesWithConfiguration(graph, 'event/receive', 'event', item.event))
    }
    return out
  }

  while (queue.length > 0) {
    const item = queue.shift()
    for (const index of carriersAt(item)) {
      if (seen.has(index)) continue
      seen.add(index)
      const op = opOfNode(graph, index)
      const decl = graph.declarations?.[graph.nodes?.[index]?.declaration]
      const runs = isExecutableDeclaration(decl?.op, decl?.extension)
      if (runs && !CARRIERS.has(op)) {
        if (op === 'pointer/get' || op === 'pointer/set' || op === 'pointer/interpolate') {
          const pointer = literalAt(graph.nodes?.[index]?.configuration?.pointer)
          if (isSupportedPointerPath(pointer)) consumers.push({ node: index, op })
        } else {
          consumers.push({ node: index, op })
        }
      }
      // A carrier (and a node we couldn't classify as a consumer) still passes
      // the value on to whatever reads its output.
      const node = graph.nodes?.[index]
      if (CARRIERS.has(op) && op === 'variable/set' && node) {
        queue.push({ site: 'variable', variable: literalAt(node.configuration?.variables) })
      }
      if (CARRIERS.has(op) && op === 'event/send' && node) {
        queue.push({ site: 'event', event: literalAt(node.configuration?.event) })
      }
      for (const reader of readers.get(index) ?? []) {
        queue.push({ site: 'value', node: reader.node, socket: reader.socket })
      }
    }
  }
  return consumers
}

/**
 * G6 — every literal reference in a graph.
 *
 * @param {object} graph
 * @returns {{nodes: Array, lights: Array, animations: Array, other: Array, wired: Array}}
 */
export function referencesOf(graph) {
  const refs = { nodes: [], lights: [], animations: [], other: [], wired: [] }
  if (!isObject(graph) || !Array.isArray(graph.nodes)) return refs

  const nodes = graph.nodes
  const declarations = Array.isArray(graph.declarations) ? graph.declarations : []
  const refTypes = new Set()
  ;(Array.isArray(graph.types) ? graph.types : []).forEach((type, index) => {
    if (isObject(type) && type.signature === 'ref') refTypes.add(index)
  })

  const add = (ref, where, indexOverride) => {
    if (typeof ref !== 'string' || !ref.startsWith('/')) return
    const nodeMatch = NODE_RE.exec(ref)
    const lightMatch = LIGHT_RE.exec(ref)
    if (ANIMATION_RE.test(ref)) {
      refs.animations.push({ ref, index: Number(ANIMATION_RE.exec(ref)[1]), where })
    } else if (lightMatch) {
      refs.lights.push({ ref, index: Number(lightMatch[1]), where })
    } else if (nodeMatch) {
      refs.nodes.push({ ref, index: Number(nodeMatch[1]), where })
    } else if (indexOverride !== undefined) {
      refs.nodes.push({ ref, index: indexOverride, where })
    } else {
      refs.other.push({ ref, family: familyOf(ref), where, consumers: [] })
    }
  }

  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) continue
    const values = isObject(node.values) ? node.values : {}
    const configuration = isObject(node.configuration) ? node.configuration : {}

    // 1. A pointer's index: a literal, the INT socket `[x]`, or the REF socket
    //    `{x}` — and a WIRED index is recorded rather than resolved.
    const pointer = literalAt(configuration.pointer)
    if (typeof pointer === 'string' && pointer.startsWith('/')) {
      const match = POINTER_TOKEN_RE.exec(pointer)
      if (!match) {
        add(pointer, { site: 'pointer', node: index })
      } else {
        const [, base, token, rest] = match
        if (/^\d+$/.test(token)) {
          add(`${base}/${token}${rest}`, { site: 'pointer', node: index })
        } else {
          const socket = token.slice(1, -1)
          const input = values[socket]
          if (isSocket(input)) {
            refs.wired.push({ node: index, socket })
          } else if (token.startsWith('[')) {
            const literal = literalAt(input)
            if (Number.isInteger(literal)) add(`${base}/${literal}${rest}`, { site: 'pointer', node: index }, literal)
          } else {
            const literal = literalAt(input)
            if (typeof literal === 'string') add(literal, { site: 'pointer', node: index })
          }
        }
      }
    }

    // 2. `onSelect`'s `nodeIndex`.
    if (opOfNode(graph, index) === ON_SELECT) {
      const idx = literalAt(configuration.nodeIndex)
      if (Number.isInteger(idx)) add(`/nodes/${idx}`, { site: 'nodeIndex', node: index }, idx)
    }

    // 3. Typed `{ref}` literals in a node's own values (the animation table's
    //    `/animations/<i>` is one of these).
    for (const [socket, input] of Object.entries(values)) {
      if (isSocket(input)) continue
      if (!refTypes.has(input?.type)) continue
      const literal = literalAt(input)
      if (typeof literal === 'string') add(literal, { site: 'value', node: index, socket })
    }
  }

  // 4. A variable's initial reference.
  for (const [index, variable] of (Array.isArray(graph.variables) ? graph.variables : []).entries()) {
    if (!isObject(variable) || !refTypes.has(variable.type)) continue
    const literal = Array.isArray(variable.value) ? variable.value[0] : undefined
    if (typeof literal === 'string') add(literal, { site: 'variable', variable: index })
  }

  // 5. An event's value default.
  for (const [index, event] of (Array.isArray(graph.events) ? graph.events : []).entries()) {
    if (!isObject(event) || !isObject(event.values)) continue
    for (const [socket, input] of Object.entries(event.values)) {
      if (!refTypes.has(input?.type)) continue
      const literal = literalAt(input)
      if (typeof literal === 'string') add(literal, { site: 'event', event: index, socket })
    }
  }

  // 6. Every `other` ref gets its consumers, so `convertGraph` can tell a ref
  //    nothing runs from one a running node reads (Rev 1.1, S3).
  for (const entry of refs.other) entry.consumers = consumersOf(graph, entry.where)

  return refs
}

// ---------------------------------------------------------------------------
// convertGraph
// ---------------------------------------------------------------------------

/** G6 — true when the graph WRITES: a `pointer/set`, a `variable/set` or an `animation/start`. */
export function graphWrites(value) {
  const graph = isObject(value?.graph) ? value.graph : (isObject(value) && Array.isArray(value.declarations) ? value : null)
  if (!isObject(graph) || !Array.isArray(graph.nodes)) return false
  return graph.nodes.some((_node, index) => {
    const op = opOfNode(graph, index)
    return op === 'pointer/set' || op === 'variable/set' || op === 'animation/start'
  })
}

/**
 * G6 — the objects outside the behaviour's own subtree, which are the ones a
 * graph needs a grant for. A converted leaf carries them as `targets`.
 */
export function grantsOf(value) {
  return Array.isArray(value?.targets) ? [...value.targets] : []
}

/**
 * G6 / Q3 — does turning Enabled ON ask the owner first? A CUSTOM graph (no
 * `template`) that writes, and either starts on load or runs every frame.
 */
export function shouldPromptEnable(value) {
  if (!isObject(value)) return false
  if (Object.hasOwn(value, 'template') && value.template) return false
  if (!graphWrites(value)) return false
  const report = graphReport(value)
  return report.startsOnLoad === true || report.perFrame === true
}

/**
 * G6 / Q3 — the confirmation's text, character for character as G6 writes it.
 * `<the grants outside its own subtree>` is the `targets` list, named through
 * `nameOf` when the caller can resolve an object id to a name.
 */
export function enablePromptText(value, { nameOf = null } = {}) {
  const grants = grantsOf(value).map((id) => (nameOf ? nameOf(id) : id))
  return 'This graph runs again whenever you reconnect or your host tab changes, '
    + 'and it may overwrite what visitors changed. '
    + `It can also change: ${grants.join(', ')}. Enable it?`
}

/** G6 — the three notes the owner sees, exactly as G6 writes them. */
export function importNotes(report) {
  const notes = []
  if (report?.startsOnLoad) notes.push(STARTS_ON_LOAD_NOTE)
  if (report?.perFrame || report?.interpolates) notes.push(SAMPLED_MOTION_NOTE)
  if ((report?.missingSelectOutputs?.length ?? 0) > 0) notes.push(MISSING_SELECT_NOTE)
  return notes
}

/**
 * G6 — rewrite a graph into a behaviour leaf.
 *
 * @param {object} graph    a KHR_interactivity graph from a file
 * @param {{own: string, nodes?: Record<string, string>, subtree?: string[],
 *          animations?: Array<{index: number, object: string, clip: string, loop: boolean}>}} mapping
 * @returns {{value: object, report: object} | {problem: string}}
 */
export function convertGraph(graph, mapping = {}) {
  if (!isObject(graph)) return { problem: 'the graph is not an object' }
  if (!isObject(mapping) || typeof mapping.own !== 'string' || mapping.own === '') {
    return { problem: 'the mapping names no object for the behaviour' }
  }

  const refs = referencesOf(graph)

  // 1. A wired index can't be rewritten: its target is only known at run time.
  if (refs.wired.length > 0) {
    const first = refs.wired[0]
    return { problem: `the pointer index is wired (node ${first.node}'s \`${first.socket}\` socket); a wired index or reference can't be converted` }
  }

  // 2. A ref to a family Atrium doesn't map survives only when NOTHING that
  //    runs reads it (Rev 1.1, S3).
  for (const entry of refs.other) {
    const consumer = entry.consumers?.[0]
    if (consumer) {
      return {
        problem: `the reference ${entry.ref} (${describeWhere(entry.where)}) is read by ${consumer.op ?? 'a node'} `
          + `at node ${consumer.node}; its meaning can't survive the import`,
      }
    }
  }

  // 3. `event/onSelect` on two different nodes can't be one graph on one object.
  const onSelectTargets = [...new Set(refs.nodes
    .filter((entry) => entry.where.site === 'nodeIndex')
    .map((entry) => entry.index))]
  if (onSelectTargets.length > 1) {
    return { problem: `event/onSelect appears on ${onSelectTargets.length} different nodes (${onSelectTargets.join(', ')}); one graph goes onto one object` }
  }

  // 4. R-L1 (a) — `name` is dropped from every event and variable entry, and an
  //    event entry with no `id` is refused, naming its index.
  const converted = JSON.parse(JSON.stringify(graph))
  let namesDropped = 0
  for (const entry of Array.isArray(converted.variables) ? converted.variables : []) {
    if (!isObject(entry)) continue
    if (Object.hasOwn(entry, 'name')) { namesDropped += 1; delete entry.name }
  }
  for (const [index, entry] of (Array.isArray(converted.events) ? converted.events : []).entries()) {
    if (!isObject(entry)) continue
    if (typeof entry.id !== 'string' || entry.id === '') {
      return { problem: `the event at index ${index} has no id` }
    }
    if (Object.hasOwn(entry, 'name')) { namesDropped += 1; delete entry.name }
  }

  // 5. The nodeMap: own-first and unique, in file-index order.
  const mapped = Object.entries(mapping.nodes ?? {})
    .filter(([, id]) => typeof id === 'string' && id !== '')
    .map(([fileIndex, id]) => ({ fileIndex: Number(fileIndex), id }))
    .sort((a, b) => a.fileIndex - b.fileIndex)
  const nodeMap = [mapping.own]
  for (const { id } of mapped) if (!nodeMap.includes(id)) nodeMap.push(id)
  if (nodeMap.length > IMPORT_OBJECTS_MAX) {
    return { problem: `the mapping names ${nodeMap.length} objects; a behaviour holds at most ${IMPORT_OBJECTS_MAX}` }
  }
  const indexOfId = (id) => nodeMap.indexOf(id)

  const animations = []
  const animationIndex = new Map()
  for (const entry of Array.isArray(mapping.animations) ? mapping.animations : []) {
    if (!isObject(entry)) continue
    animationIndex.set(Number(entry.index), animations.length)
    animations.push({ object: entry.object, clip: entry.clip, loop: entry.loop === true })
  }

  /** Rewrite one reference, or refuse naming it and where it was found. */
  const rewrite = (ref, where) => {
    if (typeof ref !== 'string' || !ref.startsWith('/')) return { ref }
    let match = ANIMATION_RE.exec(ref)
    if (match) {
      const to = animationIndex.get(Number(match[1]))
      if (to === undefined) return { problem: `the animation reference ${ref} (${describeWhere(where)}) is not mapped` }
      return { ref: `/animations/${to}` }
    }
    match = LIGHT_RE.exec(ref)
    if (match) {
      const id = mapping.nodes?.[match[1]]
      if (typeof id !== 'string' || id === '') {
        return { problem: `the light reference ${ref} (${describeWhere(where)}) is not mapped` }
      }
      return { ref: `/extensions/KHR_lights_punctual/lights/${indexOfId(id)}${match[2] ?? ''}` }
    }
    match = NODE_RE.exec(ref)
    if (match) {
      const id = mapping.nodes?.[match[1]]
      if (typeof id !== 'string' || id === '') {
        return { problem: `the node reference ${ref} (${describeWhere(where)}) is not mapped` }
      }
      return { ref: `/nodes/${indexOfId(id)}${match[2] ?? ''}` }
    }
    return { ref }                                  // an `other` ref: left as it is
  }

  const refTypes = new Set()
  ;(Array.isArray(converted.types) ? converted.types : []).forEach((type, index) => {
    if (isObject(type) && type.signature === 'ref') refTypes.add(index)
  })
  const rewriteLiteral = (holder, key, where) => {
    const literal = literalAt(holder[key])
    if (typeof literal !== 'string') return null
    const result = rewrite(literal, where)
    if (result.problem) return result
    holder[key] = { ...holder[key], value: [result.ref] }
    return null
  }

  for (const [index, node] of (converted.nodes ?? []).entries()) {
    if (!isObject(node)) continue
    const values = isObject(node.values) ? node.values : null
    const configuration = isObject(node.configuration) ? node.configuration : null
    const op = opOfNode(converted, index)

    if (configuration && isObject(configuration.pointer)) {
      const pointer = literalAt(configuration.pointer)
      if (typeof pointer === 'string' && pointer.startsWith('/')) {
        const match = POINTER_TOKEN_RE.exec(pointer)
        let ref = pointer
        if (match) {
          const [, base, token, rest] = match
          if (/^\d+$/.test(token)) ref = `${base}/${token}${rest}`
          else {
            const socket = token.slice(1, -1)
            if (token.startsWith('[')) {
              const literal = literalAt(values?.[socket])
              if (Number.isInteger(literal)) ref = `${base}/${literal}${rest}`
            } else {
              const literal = literalAt(values?.[socket])
              if (typeof literal === 'string') ref = literal
            }
          }
        }
        const result = rewrite(ref, { site: 'pointer', node: index })
        if (result.problem) return result
        configuration.pointer = { ...configuration.pointer, value: [result.ref] }
      }
    }

    if (op === ON_SELECT && configuration && isObject(configuration.nodeIndex)) {
      const idx = literalAt(configuration.nodeIndex)
      if (Number.isInteger(idx)) {
        const result = rewrite(`/nodes/${idx}`, { site: 'nodeIndex', node: index })
        if (result.problem) return result
        configuration.nodeIndex = { ...configuration.nodeIndex, value: [Number(result.ref.slice('/nodes/'.length))] }
      }
    }

    if (values) {
      for (const [socket, input] of Object.entries(values)) {
        if (isSocket(input) || !refTypes.has(input?.type)) continue
        const failure = rewriteLiteral(values, socket, { site: 'value', node: index, socket })
        if (failure) return failure
      }
    }
  }

  if (Array.isArray(converted.variables)) {
    for (const [index, variable] of converted.variables.entries()) {
      if (!isObject(variable) || !refTypes.has(variable.type)) continue
      if (!Array.isArray(variable.value)) continue
      const literal = variable.value[0]
      if (typeof literal !== 'string') continue
      const result = rewrite(literal, { site: 'variable', variable: index })
      if (result.problem) return result
      variable.value = [result.ref, ...variable.value.slice(1)]
    }
  }

  if (Array.isArray(converted.events)) {
    for (const [index, event] of converted.events.entries()) {
      if (!isObject(event) || !isObject(event.values)) continue
      for (const [socket, input] of Object.entries(event.values)) {
        if (!isObject(input) || !refTypes.has(input.type)) continue
        const literal = literalAt(input)
        if (typeof literal !== 'string') continue
        const result = rewrite(literal, { site: 'event', event: index, socket })
        if (result.problem) return result
        event.values[socket] = { ...input, value: [result.ref] }
      }
    }
  }

  // 6. G6 — `targets` is every mapped object OUTSIDE the own subtree, and the
  //    leaf must pass the rule before the panel offers Save.
  const subtree = new Set(Array.isArray(mapping.subtree) ? mapping.subtree : [])
  const targets = nodeMap.slice(1).filter((id) => !subtree.has(id))
  const value = { kind: 'graph', origin: 'local', enabled: false, graph: converted, nodeMap, targets, animations }

  const verdict = behaviorCheck(value, { ownId: mapping.own })
  if (verdict.problem) {
    return { problem: `the conversion produces a value the rule refuses: ${behaviorReasonText(verdict.problem)}` }
  }

  const report = { ...graphReport(value), namesDropped, grants: [...targets], writes: graphWrites(value) }
  return { value, report }
}
