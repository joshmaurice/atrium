// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// graph-import.test.js — scripting-4d-1 G6, the importer's pure half. No DOM:
// `graph-import.js` is pure, and this file is its whole contract.
//
// The conversion that has to RUN (item 5, R-L1's test) goes through the REAL
// adapter and the REAL vendored engine, on a fake world and a fake clock, as
// the round's seam rule asks (signin-sync §4.1).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseGraphSource, referencesOf, convertGraph, jsonDepth,
  graphWrites, grantsOf, shouldPromptEnable, enablePromptText, importNotes,
  IMPORT_BYTES_MAX, IMPORT_DEPTH_MAX, IMPORT_GRAPHS_MAX, IMPORT_OBJECTS_MAX,
} from '../src/graph-import.js'
import { createBehaviorEngine } from '@atrium/behaviors/adapter'
import { behaviorCheck } from '@atrium/behaviors/behavior-spec'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KHRONOS = resolve(__dirname, '../../../tests/fixtures/behavior-conformance-khronos')

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const THIRD = '33333333-3333-4333-8333-333333333333'

const T = { bool: 0, int: 1, float: 2, float3: 3, float4: 4, ref: 5 }
const TYPES = [
  { signature: 'bool' }, { signature: 'int' }, { signature: 'float' },
  { signature: 'float3' }, { signature: 'float4' }, { signature: 'ref' },
]
const lit = (type, value) => ({ type, value: Array.isArray(value) ? value : [value] })
const encoder = new TextEncoder()

/** A glTF document carrying one emitted graph, in the shape `conformance.mjs` reads. */
function documentOf(graph, { nodes = [], lights = [], animations } = {}) {
  return {
    asset: { version: '2.0' },
    extensions: {
      KHR_interactivity: { graphs: [graph] },
      // R7 — a light is a row of the LIGHT TABLE; each one gets exactly one
      // host node, which names it through `KHR_lights_punctual.light`.
      ...(lights.length > 0 ? { KHR_lights_punctual: { lights } } : {}),
    },
    nodes: [
      ...nodes,
      ...lights.map((_light, index) => ({ extensions: { KHR_lights_punctual: { light: index } } })),
    ],
    ...(animations ? { animations } : {}),
  }
}

const bytesOf = (value) => encoder.encode(JSON.stringify(value))

/** One `graph` with explicitly indexed declarations. */
const graphOf = ({ declarations, nodes, variables, events }) => ({
  types: TYPES.map((t) => ({ ...t })),
  declarations,
  nodes,
  ...(variables ? { variables } : {}),
  ...(events ? { events } : {}),
})

/** A pointer/set node, in the shape the vendored validator accepts. */
const setter = (pointer, type, value, extra = {}) => ({
  declaration: 0,
  configuration: { pointer: lit(T.ref, pointer), type: lit(T.int, type) },
  values: { value: lit(type, value) },
  ...extra,
})

// ---------------------------------------------------------------------------
// The GLB container
// ---------------------------------------------------------------------------

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

/**
 * A `.glb` built from chunks. `length` may LIE about a chunk's real size, and
 * `totalDelta` about the file's own length, so every refusal has a source.
 */
function glbFromChunks(chunks, { version = 2, totalDelta = 0, magic = 0x46546c67 } = {}) {
  let total = 12
  for (const chunk of chunks) total += 8 + chunk.data.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, magic, true)
  view.setUint32(4, version, true)
  view.setUint32(8, total + totalDelta, true)
  let offset = 12
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.length ?? chunk.data.length, true)
    view.setUint32(offset + 4, chunk.type, true)
    out.set(chunk.data, offset + 8)
    offset += 8 + chunk.data.length
  }
  return out
}

const paddedJson = (value) => {
  const json = bytesOf(value)
  const pad = (4 - (json.length % 4)) % 4
  const out = new Uint8Array(json.length + pad)
  out.set(json, 0)
  if (pad > 0) out.fill(0x20, json.length)
  return out
}

const minimal = { types: [{ signature: 'bool' }], declarations: [{ op: 'debug/log' }], nodes: [] }

describe('G6 — parseGraphSource: the source shapes', () => {
  test('a .gltf JSON source: its graphs, file nodes, light hosts and animations', () => {
    const graph = graphOf({ declarations: [{ op: 'debug/log' }], nodes: [] })
    const doc = {
      ...documentOf(graph, {
        nodes: [{ name: 'Quad' }, { name: 'Pass' }],
        lights: [{ name: 'Key light' }],
        animations: [{ name: 'spin' }, {}],
      }),
    }
    const parsed = parseGraphSource(bytesOf(doc), { name: 'asset.gltf' })
    assert.equal(parsed.problem, undefined)
    assert.equal(parsed.graphs.length, 1)
    assert.equal(parsed.graphIndex, 0)
    assert.deepEqual(parsed.fileNodes, [{ index: 0, name: 'Quad' }, { index: 1, name: 'Pass' }, { index: 2, name: 'node 2' }])
    // R7 — `fileLights` is the LIGHT TABLE, with the host resolved through the
    // node that names the light; it is not a second view of the host nodes.
    assert.deepEqual(parsed.fileLights, [{ index: 0, name: 'Key light', hosts: [2] }])
    assert.deepEqual(parsed.fileAnimations, [{ index: 0, name: 'spin' }, { index: 1, name: 'animation 1' }])
  })

  test('a .glb: only the JSON chunk is read', () => {
    const graph = graphOf({ declarations: [{ op: 'debug/log' }], nodes: [] })
    const bytes = glbFromChunks([
      { type: JSON_CHUNK, data: paddedJson(documentOf(graph, { nodes: [{ name: 'Quad' }] })) },
      { type: BIN_CHUNK, data: new Uint8Array([1, 2, 3, 4]) },
    ])
    const parsed = parseGraphSource(bytes)
    assert.equal(parsed.problem, undefined)
    assert.equal(parsed.graphs.length, 1)
    // The BIN chunk is NOT decoded into the document: only fileNodes survive.
    assert.deepEqual(parsed.fileNodes, [{ index: 0, name: 'Quad' }])
  })

  test('a .glb with a bad magic is refused, named as such', () => {
    const bytes = glbFromChunks([{ type: JSON_CHUNK, data: paddedJson(minimal) }], { magic: 0x464c4578 })
    assert.match(parseGraphSource(bytes, { name: 'asset.glb' }).problem, /magic/)
  })

  test('a .glb whose declared length is not the file is refused', () => {
    const bytes = glbFromChunks([{ type: JSON_CHUNK, data: paddedJson(minimal) }], { totalDelta: 4 })
    assert.match(parseGraphSource(bytes, { name: 'asset.glb' }).problem, /declares \d+ bytes; the file is \d+/)
  })

  test('a .glb version other than 2 is refused', () => {
    const bytes = glbFromChunks([{ type: JSON_CHUNK, data: paddedJson(minimal) }], { version: 1 })
    assert.match(parseGraphSource(bytes, { name: 'asset.glb' }).problem, /version is 1/)
  })

  test('a .glb whose JSON chunk length runs past the end is refused', () => {
    const bytes = glbFromChunks([{ type: JSON_CHUNK, length: paddedJson(minimal).length + 1024, data: paddedJson(minimal) }])
    assert.match(parseGraphSource(bytes, { name: 'asset.glb' }).problem, /past the end/)
  })

  test('a .glb with an unaligned chunk is refused', () => {
    const six = new Uint8Array([0x7b, 0x7d, 0x20, 0x20, 0x20, 0x20])       // 6 bytes, not 4-aligned
    const bytes = glbFromChunks([{ type: JSON_CHUNK, data: six }])
    assert.match(parseGraphSource(bytes, { name: 'asset.glb' }).problem, /4-byte aligned/)
  })

  test('a .glb with two JSON chunks is refused', () => {
    const bytes = glbFromChunks([
      { type: JSON_CHUNK, data: paddedJson(minimal) },
      { type: JSON_CHUNK, data: paddedJson(minimal) },
    ])
    assert.match(parseGraphSource(bytes, { name: 'asset.glb' }).problem, /2 JSON chunks/)
  })

  test('a .glb whose first chunk is not JSON is refused', () => {
    const bytes = glbFromChunks([
      { type: BIN_CHUNK, data: new Uint8Array([1, 2, 3, 4]) },
      { type: JSON_CHUNK, data: paddedJson(minimal) },
    ])
    assert.match(parseGraphSource(bytes, { name: 'asset.glb' }).problem, /first .glb chunk is not JSON/)
  })

  test('a source of 4 MiB + 1 byte is refused BEFORE decoding, multi-byte text included', () => {
    const head = bytesOf(documentOf(minimal))
    const filler = encoder.encode('あ'.repeat(64))               // 3 bytes each
    const big = new Uint8Array(IMPORT_BYTES_MAX + 1)
    big.set(head.subarray(0, Math.min(head.length, big.length)), 0)
    let offset = head.length
    while (offset + filler.length <= big.length) { big.set(filler, offset); offset += filler.length }
    while (offset < big.length) { big[offset] = 0xff; offset += 1 }
    const problem = parseGraphSource(big, { name: 'asset.gltf' }).problem
    assert.match(problem, /the source is \d+ bytes; the limit is \d+ \(4 MiB\)/)
    // The 0xff tail is not valid UTF-8: had the source been decoded first, the
    // verdict would have been a JSON error, not the size.
    assert.doesNotMatch(problem, /not JSON/)
  })

  test('depth 65 is refused and depth 64 is read', () => {
    // The document's own depth, then a nested `deep` value on top of it. Both
    // numbers are asserted, so the parse and the measurement cannot drift.
    const chain = (levels) => {
      let out = 1
      for (let i = 0; i < levels; i += 1) out = { down: out }
      return out
    }
    const withChain = (levels) => ({ ...documentOf(minimal), deep: chain(levels) })
    const base = documentOf(minimal)

    const atLimit = withChain(IMPORT_DEPTH_MAX - 2)
    assert.equal(jsonDepth(atLimit), IMPORT_DEPTH_MAX, `base ${jsonDepth(base)} + deep`)
    assert.equal(parseGraphSource(bytesOf(atLimit)).problem, undefined)

    const past = withChain(IMPORT_DEPTH_MAX - 1)
    assert.equal(jsonDepth(past), IMPORT_DEPTH_MAX + 1)
    assert.match(parseGraphSource(bytesOf(past)).problem, /65 levels deep; the limit is 64/)
  })

  test('jsonDepth counts nesting levels, iteratively', () => {
    assert.equal(jsonDepth({}), 1)
    assert.equal(jsonDepth([]), 1)
    assert.equal(jsonDepth({ a: 1 }), 2)
    assert.equal(jsonDepth({ a: { b: { c: 1 } } }), 4)
  })

  test('17 graphs are refused; 16 are read', () => {
    const sixteen = {
      extensions: { KHR_interactivity: { graphs: Array.from({ length: IMPORT_GRAPHS_MAX }, () => JSON.parse(JSON.stringify(minimal))) } },
      nodes: [],
    }
    assert.equal(parseGraphSource(bytesOf(sixteen)).graphs.length, IMPORT_GRAPHS_MAX)
    const seventeen = {
      extensions: { KHR_interactivity: { graphs: Array.from({ length: IMPORT_GRAPHS_MAX + 1 }, () => JSON.parse(JSON.stringify(minimal))) } },
      nodes: [],
    }
    assert.match(parseGraphSource(bytesOf(seventeen)).problem, /17 graphs; the limit is 16/)
  })

  test('a graph past G7\'s counts is refused before any conversion', () => {
    const big = { types: [{ signature: 'bool' }], declarations: [{ op: 'debug/log' }], nodes: Array.from({ length: 257 }, () => ({ declaration: 0 })) }
    const doc = { extensions: { KHR_interactivity: { graphs: [big] } }, nodes: [] }
    assert.match(parseGraphSource(bytesOf(doc)).problem, /257 nodes; the limit is 256/)
  })

  test('a source with no graphs, a source that is not JSON, and one that is not a document are refused', () => {
    assert.match(parseGraphSource(bytesOf({ nodes: [] })).problem, /no KHR_interactivity graphs/)
    assert.match(parseGraphSource(encoder.encode('{ nope')).problem, /not JSON/)
    assert.match(parseGraphSource(encoder.encode('[1, 2]')).problem, /not a glTF document/)
  })
})

// ---------------------------------------------------------------------------
// referencesOf
// ---------------------------------------------------------------------------

describe('G6 — referencesOf finds every literal reference', () => {
  test('a pointer index, a typed {ref} literal, a variable\'s initial ref, an event value default, nodeIndex and /animations/<i>', () => {
    const graph = graphOf({
      declarations: [
        { op: 'pointer/set' },
        { op: 'ref/eq' },
        { op: 'event/onSelect', extension: 'KHR_node_selectability' },
        { op: 'animation/start' },
      ],
      nodes: [
        setter('/nodes/3/translation', T.float3, [0, 0, 0]),
        { declaration: 1, values: { a: lit(T.ref, '/meshes/13'), b: lit(T.ref, '/nodes/1') } },
        { declaration: 2, configuration: { nodeIndex: lit(T.int, 4), stopPropagation: lit(T.bool, false) } },
        { declaration: 3, configuration: { type: lit(T.int, T.ref) }, values: { animation: lit(T.ref, '/animations/2'), speed: lit(T.float, 1) } },
      ],
      variables: [{ type: T.ref, value: ['/nodes/7'] }],
      events: [{ id: 'test/onStart', values: { target: lit(T.ref, '/nodes/9') } }],
    })
    const refs = referencesOf(graph)
    const nodeIndexes = refs.nodes.map((entry) => entry.index).sort((a, b) => a - b)
    assert.deepEqual(nodeIndexes, [1, 3, 4, 7, 9])
    assert.deepEqual(refs.nodes.find((entry) => entry.where.site === 'pointer').where, { site: 'pointer', node: 0 })
    assert.deepEqual(refs.nodes.find((entry) => entry.where.site === 'variable').where, { site: 'variable', variable: 0 })
    assert.deepEqual(refs.nodes.find((entry) => entry.where.site === 'event').where, { site: 'event', event: 0, socket: 'target' })
    assert.deepEqual(refs.nodes.find((entry) => entry.where.site === 'nodeIndex').where, { site: 'nodeIndex', node: 2 })
    assert.equal(refs.animations.length, 1)
    assert.equal(refs.animations[0].index, 2)
    assert.equal(refs.animations[0].where.site, 'value')
    assert.equal(refs.other.length, 1)
    assert.equal(refs.other[0].ref, '/meshes/13')
    assert.equal(refs.other[0].family, 'meshes')
  })

  test('a wired index lands in `wired`, not in a node reference', () => {
    const graph = graphOf({
      declarations: [{ op: 'variable/get' }, { op: 'pointer/set' }],
      nodes: [
        { declaration: 0, configuration: { variable: lit(T.int, 0) } },
        {
          declaration: 1,
          configuration: { pointer: lit(T.ref, '/nodes/[nodeIndex]/translation'), type: lit(T.int, T.float3) },
          values: { nodeIndex: { node: 0, socket: 'value' }, value: lit(T.float3, [0, 0, 1]) },
        },
      ],
      variables: [{ type: T.int, value: [0] }],
    })
    const refs = referencesOf(graph)
    assert.deepEqual(refs.wired, [{ node: 1, socket: 'nodeIndex' }])
    assert.deepEqual(refs.nodes, [])
  })

  test('duplicate file names are kept: two nodes with the same name are two entries', () => {
    const doc = documentOf(minimal, { nodes: [{ name: 'Quad' }, { name: 'Quad' }] })
    const parsed = parseGraphSource(bytesOf(doc))
    assert.deepEqual(parsed.fileNodes, [{ index: 0, name: 'Quad' }, { index: 1, name: 'Quad' }])
  })
})

// ---------------------------------------------------------------------------
// convertGraph
// ---------------------------------------------------------------------------

describe('G6 — convertGraph rewrites or refuses, never silently', () => {
  test('an unmapped node reference is refused, naming where it is', () => {
    const graph = graphOf({ declarations: [{ op: 'pointer/set' }], nodes: [setter('/nodes/7/translation', T.float3, [0, 0, 0])] })
    const out = convertGraph(graph, { own: OWN, nodes: {} })
    assert.match(out.problem, /the node reference \/nodes\/7\/translation \(node 0's pointer\) is not mapped/)
  })

  test('a wired index is refused', () => {
    const graph = graphOf({
      declarations: [{ op: 'variable/get' }, { op: 'pointer/set' }],
      nodes: [
        { declaration: 0, configuration: { variable: lit(T.int, 0) } },
        {
          declaration: 1,
          configuration: { pointer: lit(T.ref, '/nodes/[nodeIndex]/translation'), type: lit(T.int, T.float3) },
          values: { nodeIndex: { node: 0, socket: 'value' }, value: lit(T.float3, [0, 0, 1]) },
        },
      ],
      variables: [{ type: T.int, value: [0] }],
    })
    assert.match(convertGraph(graph, { own: OWN }).problem, /wired index or reference can't be converted/)
  })

  test('event/onSelect on two different nodes is refused', () => {
    const graph = graphOf({
      declarations: [{ op: 'event/onSelect', extension: 'KHR_node_selectability' }],
      nodes: [
        { declaration: 0, configuration: { nodeIndex: lit(T.int, 0), stopPropagation: lit(T.bool, false) } },
        { declaration: 0, configuration: { nodeIndex: lit(T.int, 1), stopPropagation: lit(T.bool, false) } },
      ],
    })
    assert.match(convertGraph(graph, { own: OWN, nodes: { 0: OWN, 1: TGT } }).problem,
      /event\/onSelect appears on 2 different nodes \(0, 1\)/)
  })

  test('an `other` ref feeding only an unsupported pointer is kept and listed', () => {
    const graph = graphOf({
      declarations: [{ op: 'pointer/set' }],
      nodes: [setter('/materials/3/pbrMetallicRoughness/metallicFactor', T.float3, [0, 0, 0])],
    })
    const out = convertGraph(graph, { own: OWN })
    assert.equal(out.problem, undefined)
    assert.equal(out.value.enabled, false)
    assert.deepEqual(out.value.nodeMap, [OWN])
    const kept = referencesOf(graph).other
    assert.deepEqual(kept.map((entry) => entry.ref), ['/materials/3/pbrMetallicRoughness/metallicFactor'])
    assert.deepEqual(kept[0].consumers, [])
    // The ref is left exactly as it was.
    assert.equal(out.value.graph.nodes[0].configuration.pointer.value[0], '/materials/3/pbrMetallicRoughness/metallicFactor')
  })

  for (const [op, values] of [
    ['ref/eq', { a: lit(T.ref, '/materials/3'), b: lit(T.ref, '/nodes/0') }],
    ['math/select', { condition: lit(T.ref, '/materials/3'), ifTrue: lit(T.float3, [1, 0, 0]), ifFalse: lit(T.float3, [0, 0, 0]) }],
    ['math/switch', { selection: lit(T.int, 0), case0: lit(T.ref, '/materials/3'), default: lit(T.float3, [0, 0, 0]) }],
  ]) {
    test(`a /materials/3 literal read by ${op} is refused, naming the ref and its consumer`, () => {
      const graph = graphOf({
        declarations: [{ op }, { op: 'pointer/set' }],
        nodes: [
          { declaration: 0, values },
          {
            declaration: 1,
            configuration: { pointer: lit(T.ref, '/nodes/0/translation'), type: lit(T.int, T.float3) },
            values: { value: { node: 0, socket: 'result' } },
          },
        ],
      })
      const out = convertGraph(graph, { own: OWN })
      assert.match(out.problem, /the reference \/materials\/3 .* is read by .* at node 0; its meaning can't survive the import/)
      assert.match(out.problem, new RegExp(op.replace('/', '\\/')))
    })
  }

  test('a ref carried through variable/set → variable/get into an unsupported pointer is kept', () => {
    const graph = graphOf({
      declarations: [{ op: 'variable/set' }, { op: 'variable/get' }, { op: 'pointer/set' }],
      nodes: [
        { declaration: 0, configuration: { variables: lit(T.int, 0) }, values: { '0': lit(T.ref, '/materials/3') } },
        { declaration: 1, configuration: { variable: lit(T.int, 0) } },
        {
          declaration: 2,
          configuration: { pointer: lit(T.ref, '/materials/3/x'), type: lit(T.int, T.ref) },
          values: { value: { node: 1, socket: 'value' } },
        },
      ],
      variables: [{ type: T.ref, value: ['/materials/3'] }],
    })
    const refs = referencesOf(graph)
    assert.equal(refs.other.length, 3)
    for (const entry of refs.other) assert.deepEqual(entry.consumers, [], `${entry.ref} has no consumer`)
    const out = convertGraph(graph, { own: OWN })
    assert.equal(out.problem, undefined, out.problem)
  })

  test('R-L1 (a): `name` is dropped from every event and variable entry, and counted', () => {
    const graph = graphOf({
      declarations: [{ op: 'pointer/set' }],
      nodes: [setter('/nodes/0/translation', T.float3, [0, 0, 0])],
      variables: [{ type: T.int, name: 'TestResult_x', value: [1] }, { type: T.bool, value: [false] }],
      events: [{ id: 'test/onStart', name: 'test/onStart' }, { id: 'test/onSuccess' }],
    })
    const out = convertGraph(graph, { own: OWN, nodes: { 0: OWN } })
    assert.equal(out.problem, undefined)
    assert.equal(out.report.namesDropped, 2)
    assert.deepEqual(out.value.graph.variables.map((entry) => Object.keys(entry)), [['type', 'value'], ['type', 'value']])
    assert.deepEqual(out.value.graph.events.map((entry) => Object.keys(entry)), [['id'], ['id']])
    assert.deepEqual(out.value.graph.events.map((entry) => entry.id), ['test/onStart', 'test/onSuccess'])
  })

  test('R-L1 (a): an event entry with no id is refused, naming its index', () => {
    const graph = graphOf({
      declarations: [{ op: 'debug/log' }],
      nodes: [],
      events: [{ id: 'test/onStart' }, { name: 'test/onSuccess' }],
    })
    assert.match(convertGraph(graph, { own: OWN }).problem, /the event at index 1 has no id/)
  })

  test('the leaf: own-first and unique nodeMap, targets outside the subtree, animations from the mapping, enabled false', () => {
    const graph = graphOf({
      declarations: [{ op: 'pointer/set' }],
      nodes: [setter('/nodes/1/translation', T.float3, [0, 0, 1])],
    })
    const out = convertGraph(graph, {
      own: OWN, nodes: { 0: OWN, 1: TGT, 2: THIRD }, subtree: [OWN, TGT], animations: [],
    })
    assert.equal(out.problem, undefined)
    assert.deepEqual(out.value.nodeMap, [OWN, TGT, THIRD])
    assert.deepEqual(out.value.targets, [THIRD])
    assert.equal(out.value.kind, 'graph')
    assert.equal(out.value.origin, 'local')
    assert.equal(out.value.enabled, false)
    assert.deepEqual(out.report.grants, [THIRD])
    assert.equal(out.report.writes, true)
    // And the rewritten pointer names the mapped index, not the file's.
    assert.equal(out.value.graph.nodes[0].configuration.pointer.value[0], '/nodes/1/translation')
    assert.equal(behaviorCheck(out.value, { ownId: OWN }).problem, null)
  })

  test('more objects than a behaviour holds is refused', () => {
    const graph = graphOf({
      declarations: [{ op: 'pointer/set' }],
      nodes: [setter('/nodes/0/translation', T.float3, [0, 0, 0])],
    })
    const nodes = {}
    for (let i = 0; i <= IMPORT_OBJECTS_MAX; i += 1) {
      const hex = i.toString(16).padStart(2, '0')
      nodes[i] = `${hex}000000-0000-4000-8000-0000000000${hex}`
    }
    const out = convertGraph(graph, { own: OWN, nodes })
    assert.match(out.problem, /a behaviour holds at most 16/)
  })
})

// ---------------------------------------------------------------------------
// Item 5 / R-L1's test — a survey asset converts and RUNS, under two mappings
// ---------------------------------------------------------------------------

/**
 * Run a converted leaf through the REAL adapter on a fake world.
 *
 * Module scope: every conversion in this file runs through it (the seam rule —
 * the real adapter, a fake world, an injected clock). `lights` are the nodeMap
 * indices that are light hosts (R7); `fields` seeds the world's reads.
 */
function runValue(leaf, { ticks = 40, lights = [], fields: initial = {} } = {}) {
  const writes = []
  const fields = new Map(Object.entries(initial))
  const lightValues = new Map()
  let clock = 0
  const world = {
    resolve: (i) => (i >= 0 && i < leaf.nodeMap.length ? { objectId: leaf.nodeMap[i], name: `node-${i}` } : { problem: 'not-found' }),
    isOwnOrDescendant: () => true,
    isGranted: () => true,
    // R7 — a light host is a nodeMap index, and the adapter registers the light
    // family at the highest one.
    hasLight: (i) => lights.includes(i),
    get: (i, field) => fields.get(`${i}:${field}`),
    set: (i, field, next) => { fields.set(`${i}:${field}`, next); writes.push([i, field, next]); return true },
    lightIntensity: (i) => lightValues.get(i),
    setLightIntensity: (i, next) => { lightValues.set(i, next); writes.push([i, 'intensity', next]); return true },
    lightColor: (i) => lightValues.get(i),
    setLightColor: (i, next) => { lightValues.set(i, next); writes.push([i, 'color', next]); return true },
    matrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    worldMatrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    clipStatus: () => ({ status: 'none' }),
    play: () => true,
    stop: () => true,
    worldPosition: () => [0, 0, 0],
    parentIndex: () => null,
  }
  const engine = createBehaviorEngine({
    graph: leaf.graph,
    nodeMap: leaf.nodeMap,
    animations: leaf.animations,
    world,
    now: () => clock,
    setTimeout: () => 0,
    clearTimeout: () => {},
    log: () => {},
  })
  assert.equal(engine.problem, null, engine.message ?? '')
  for (let k = 0; k < ticks; k += 1) { clock += 100; engine.tick() }
  engine.dispose()
  return writes
}

describe('G6 — a survey asset that fits converts, passes behaviorCheck and runs', () => {
  const fixture = JSON.parse(readFileSync(resolve(KHRONOS, 'graphs/math--math_select.json'), 'utf8'))

  const doc = {
    extensions: { KHR_interactivity: { graphs: [fixture.graph] } },
    nodes: fixture.nodes,
  }

  test('it parses, converts, passes behaviorCheck, and wrote a log that is the same under a permuted mapping', () => {
    const parsed = parseGraphSource(bytesOf(doc), { name: 'math-select.gltf' })
    assert.equal(parsed.problem, undefined)
    // R-L1 — the Khronos graph names its events AND its variables.
    assert.equal(parsed.graphs[0].events.some((entry) => Object.hasOwn(entry, 'name')), true)
    assert.equal(parsed.graphs[0].variables.every((entry) => Object.hasOwn(entry, 'name')), true)

    const first = convertGraph(parsed.graphs[0], { own: OWN, nodes: { 5: TGT, 11: THIRD } })
    assert.equal(first.problem, undefined, first.problem)
    assert.equal(first.report.namesDropped, parsed.graphs[0].events.length + parsed.graphs[0].variables.length)
    assert.equal(behaviorCheck(first.value, { ownId: OWN }).problem, null)
    assert.equal(first.value.enabled, false)

    // The SAME graph, the same file indices, a PERMUTED mapping: the file's node
    // 5 is THIRD and node 11 is TGT, so the nodeMap order is unchanged and each
    // index still names the same object.
    const second = convertGraph(parsed.graphs[0], { own: OWN, nodes: { 5: THIRD, 11: TGT } })
    assert.equal(second.problem, undefined, second.problem)

    const logA = runValue(first.value)
    const logB = runValue(second.value)
    assert.ok(logA.length > 0, 'the graph wrote something')
    // The write log is in `nodeMap` indices, so a PERMUTED mapping — the same
    // file indices, different objects — leaves it byte for byte the same.
    assert.deepEqual(logA, logB, 'the write log is the same under the permuted mapping')
    assert.deepEqual([...new Set(logA.map(([index]) => index))].sort(), [1, 2])
    // Where the file named node 5 and node 11, under each mapping.
    assert.deepEqual([first.value.nodeMap[1], first.value.nodeMap[2]], [TGT, THIRD])
    assert.deepEqual([second.value.nodeMap[1], second.value.nodeMap[2]], [THIRD, TGT])
  })
})

// ---------------------------------------------------------------------------
// R7 — the light namespace: the light table, its hosts, and two objects
// ---------------------------------------------------------------------------

describe('G6 / R7 — a light is a row of the LIGHT TABLE, and its host is a node', () => {
  test('lights[0] on nodes[1]: a node reference and a light reference are two different objects, through the real adapter', () => {
    const graph = graphOf({
      declarations: [
        { op: 'event/onStart' }, { op: 'flow/sequence' }, { op: 'pointer/get' }, { op: 'pointer/set' },
      ],
      nodes: [
        { declaration: 0, flows: { out: { node: 1, socket: 'in' } } },
        { declaration: 1, flows: { a: { node: 2, socket: 'in' }, b: { node: 3, socket: 'in' }, c: { node: 4, socket: 'in' } } },
        // Reads the file's node 0 ...
        { declaration: 2, configuration: { pointer: lit(T.ref, '/nodes/0/translation'), type: lit(T.int, T.float3) } },
        // ... and writes the file's light 0, which lives on the file's node 1.
        {
          declaration: 3,
          configuration: { pointer: lit(T.ref, '/extensions/KHR_lights_punctual/lights/0/color'), type: lit(T.int, T.float3) },
          values: { value: { node: 2, socket: 'value' } },
        },
        setter('/nodes/0/scale', T.float3, [7, 7, 7], { declaration: 3 }),
      ],
    })
    const doc = documentOf(graph, { nodes: [{ name: 'Quad' }], lights: [{ name: 'Sun' }] })
    const parsed = parseGraphSource(bytesOf(doc), { name: 'lights.gltf' })
    assert.equal(parsed.problem, undefined)
    assert.deepEqual(parsed.fileNodes, [{ index: 0, name: 'Quad' }, { index: 1, name: 'node 1' }])
    assert.deepEqual(parsed.fileLights, [{ index: 0, name: 'Sun', hosts: [1] }])

    // The two namespaces map to two DIFFERENT objects, and the nodeMap holds
    // three: own, the file's node 0, and the light's host.
    const out = convertGraph(parsed.graphs[0], {
      own: OWN, nodes: { 0: TGT, 1: THIRD }, lights: { 0: THIRD },
    })
    assert.equal(out.problem, undefined, out.problem)
    assert.deepEqual(out.value.nodeMap, [OWN, TGT, THIRD])
    assert.deepEqual(out.value.targets, [TGT, THIRD])
    assert.equal(out.value.graph.nodes[2].configuration.pointer.value[0], '/nodes/1/translation')
    assert.equal(out.value.graph.nodes[3].configuration.pointer.value[0], '/extensions/KHR_lights_punctual/lights/2/color')
    assert.equal(out.value.graph.nodes[4].configuration.pointer.value[0], '/nodes/1/scale')
    assert.equal(behaviorCheck(out.value, { ownId: OWN }).problem, null)

    // The light write lands on the LIGHT object and the node write on the NODE
    // object, and the value the light gets was read from the node's object.
    const writes = runValue(out.value, { lights: [2], fields: { '1:translation': [0.25, 0.5, 0.75] } })
    assert.deepEqual(writes, [
      [2, 'color', [0.25, 0.5, 0.75]],
      [1, 'scale', [7, 7, 7]],
    ])
  })

  test('two distinct lights on two nodes: each light is its own row and its own object', () => {
    const graph = graphOf({
      declarations: [{ op: 'event/onStart' }, { op: 'flow/sequence' }, { op: 'pointer/set' }],
      nodes: [
        { declaration: 0, flows: { out: { node: 1, socket: 'in' } } },
        { declaration: 1, flows: { a: { node: 2, socket: 'in' }, b: { node: 3, socket: 'in' } } },
        setter('/extensions/KHR_lights_punctual/lights/0/intensity', T.float, 0.5, { declaration: 2 }),
        setter('/extensions/KHR_lights_punctual/lights/1/intensity', T.float, 0.75, { declaration: 2 }),
      ],
    })
    const doc = documentOf(graph, { nodes: [{ name: 'Quad' }], lights: [{ name: 'Sun' }, { name: 'Lamp' }] })
    const parsed = parseGraphSource(bytesOf(doc), { name: 'two-lights.gltf' })
    assert.equal(parsed.problem, undefined)
    assert.deepEqual(parsed.fileLights, [
      { index: 0, name: 'Sun', hosts: [1] },
      { index: 1, name: 'Lamp', hosts: [2] },
    ])

    const out = convertGraph(parsed.graphs[0], {
      own: OWN, nodes: { 1: TGT, 2: THIRD }, lights: { 0: TGT, 1: THIRD },
    })
    assert.equal(out.problem, undefined, out.problem)
    assert.deepEqual(out.value.nodeMap, [OWN, TGT, THIRD])
    assert.equal(out.value.graph.nodes[2].configuration.pointer.value[0], '/extensions/KHR_lights_punctual/lights/1/intensity')
    assert.equal(out.value.graph.nodes[3].configuration.pointer.value[0], '/extensions/KHR_lights_punctual/lights/2/intensity')
    assert.equal(behaviorCheck(out.value, { ownId: OWN }).problem, null)

    // Each light reaches its own host's light.
    assert.deepEqual(runValue(out.value, { lights: [1, 2] }), [[1, 'intensity', 0.5], [2, 'intensity', 0.75]])
  })

  test('a light with no host, and a light with two hosts, are refused at parse time, naming the light', () => {
    const graph = graphOf({ declarations: [{ op: 'debug/log' }], nodes: [] })
    const table = { KHR_lights_punctual: { lights: [{ name: 'Sun' }] } }

    const orphan = {
      asset: { version: '2.0' },
      extensions: { KHR_interactivity: { graphs: [graph] }, ...table },
      nodes: [{ name: 'Quad' }],
    }
    assert.match(parseGraphSource(bytesOf(orphan), { name: 'orphan.gltf' }).problem,
      /the light 0 \(Sun\) has no host node; the import needs exactly one node naming it/)

    const twoHosts = {
      asset: { version: '2.0' },
      extensions: { KHR_interactivity: { graphs: [graph] }, ...table },
      nodes: [
        { name: 'Quad', extensions: { KHR_lights_punctual: { light: 0 } } },
        { name: 'Pass', extensions: { KHR_lights_punctual: { light: 0 } } },
      ],
    }
    assert.match(parseGraphSource(bytesOf(twoHosts), { name: 'two-hosts.gltf' }).problem,
      /the light 0 \(Sun\) has 2 host nodes \(0, 1\); the import needs exactly one node naming it/)
  })

  test('the old fixture — one node that is also the light\u2019s host — still converts with nodeMap: [own]', () => {
    const graph = graphOf({
      declarations: [{ op: 'pointer/set' }],
      nodes: [setter('/extensions/KHR_lights_punctual/lights/0/intensity', T.float, 0.5)],
    })
    const doc = documentOf(graph, { nodes: [{ name: 'Quad' }, { name: 'Pass' }], lights: [{ name: 'Key light' }] })
    const parsed = parseGraphSource(bytesOf(doc), { name: 'old.gltf' })
    assert.equal(parsed.problem, undefined)
    assert.deepEqual(parsed.fileNodes, [{ index: 0, name: 'Quad' }, { index: 1, name: 'Pass' }, { index: 2, name: 'node 2' }])
    assert.deepEqual(parsed.fileLights, [{ index: 0, name: 'Key light', hosts: [2] }])

    // The host IS the object the graph is imported onto: own-first, so the
    // light's rewritten index is 0 and there is nothing to grant.
    const out = convertGraph(parsed.graphs[0], { own: OWN, nodes: { 2: OWN }, lights: { 0: OWN } })
    assert.equal(out.problem, undefined, out.problem)
    assert.deepEqual(out.value.nodeMap, [OWN])
    assert.deepEqual(out.value.targets, [])
    assert.equal(out.value.graph.nodes[0].configuration.pointer.value[0], '/extensions/KHR_lights_punctual/lights/0/intensity')
    assert.equal(behaviorCheck(out.value, { ownId: OWN }).problem, null)
  })
})

// ---------------------------------------------------------------------------
// R12 (f) — a variable's initial reference is rewritten, and the run follows it
// ---------------------------------------------------------------------------

describe('G6 / R12 (f) — a variable whose initial value is a reference', () => {
  /** The file's node 0 is TGT (nodeMap index 1) and its node 1 is OWN (index 0). */
  const convert = () => {
    const graph = graphOf({
      declarations: [
        { op: 'event/onStart' }, { op: 'variable/get' },
        { op: 'ref/eq' }, { op: 'flow/branch' }, { op: 'pointer/set' },
      ],
      nodes: [
        // onStart drives the branch; the variable and the comparison are READ
        // as values (a value node has no input flow socket).
        { declaration: 0, flows: { out: { node: 3, socket: 'in' } } },
        { declaration: 1, configuration: { variable: lit(T.int, 0) } },
        // The variable's value, compared with a literal reference to the SAME
        // file node: both must be rewritten, or the branch decides differently.
        { declaration: 2, values: { a: { node: 1, socket: 'value' }, b: lit(T.ref, '/nodes/1') } },
        { declaration: 3, values: { condition: { node: 2, socket: 'value' } }, flows: { true: { node: 4, socket: 'in' } } },
        setter('/nodes/0/translation', T.float3, [1, 1, 1], { declaration: 4 }),
      ],
      variables: [{ type: T.ref, value: ['/nodes/1'] }],
    })
    return convertGraph(graph, { own: OWN, nodes: { 0: TGT, 1: OWN } })
  }

  test('the variable\u2019s initial literal is rewritten, like the node\u2019s own literal', () => {
    const out = convert()
    assert.equal(out.problem, undefined, out.problem)
    assert.deepEqual(out.value.nodeMap, [OWN, TGT])
    // The variable's initial literal, the node's own literal, and the pointer.
    assert.equal(out.value.graph.variables[0].value[0], '/nodes/0')
    assert.equal(out.value.graph.nodes[2].values.b.value[0], '/nodes/0')
    assert.equal(out.value.graph.nodes[4].configuration.pointer.value[0], '/nodes/1/translation')
    assert.equal(behaviorCheck(out.value, { ownId: OWN }).problem, null)
  })

  test('the branch the rewritten literal decides is the write log', () => {
    const out = convert()
    assert.equal(out.problem, undefined, out.problem)
    // Both sides are rewritten, so the comparison holds and the branch is taken
    // — the write happens, at the object the rewritten literal names. Leaving
    // the variable's literal unmapped makes the comparison false and the log
    // empty.
    assert.deepEqual(runValue(out.value), [[1, 'translation', [1, 1, 1]]])
  })
})

// ---------------------------------------------------------------------------
// R-L4's import test — check 4's graph, and the material read it refuses
// ---------------------------------------------------------------------------

describe('G6 / R-L4 — a hover declaration with its extension, and a material reference', () => {
  test('a /materials/… pointer/set nothing reads: the report lists it, the rest runs, the write is inert', () => {
    const graph = graphOf({
      declarations: [
        { op: 'event/onHoverIn', extension: 'KHR_node_hoverability' },
        { op: 'event/onStart' },
        { op: 'flow/sequence' },
        { op: 'pointer/set' },
      ],
      nodes: [
        { declaration: 0 },
        { declaration: 1, flows: { out: { node: 2, socket: 'in' } } },
        { declaration: 2, flows: { a: { node: 3, socket: 'in' }, b: { node: 4, socket: 'in' } } },
        setter('/materials/0/pbrMetallicRoughness/baseColorFactor', T.float4, [1, 0, 0, 1], { declaration: 3 }),
        setter('/nodes/1/translation', T.float3, [1, 2, 3], { declaration: 3 }),
      ],
    })
    const doc = documentOf(graph, { nodes: [{ name: 'Quad' }, { name: 'Pass' }] })
    const parsed = parseGraphSource(bytesOf(doc), { name: 'hover.gltf' })
    assert.equal(parsed.problem, undefined)
    const out = convertGraph(parsed.graphs[0], { own: OWN, nodes: { 1: TGT } })
    assert.equal(out.problem, undefined, out.problem)

    // The list the runner's "Partially supported" line is built from: the op
    // WITH its extension, then the pointer, each with its node count.
    assert.deepEqual(out.report.unsupported,
      [{ op: 'event/onHoverIn', extension: 'KHR_node_hoverability', count: 1 }])
    assert.deepEqual(out.report.unsupportedPointers,
      [{ pointer: '/materials/0/pbrMetallicRoughness/baseColorFactor', count: 1 }])

    // The material reference is KEPT (nothing that runs reads it), named.
    const kept = referencesOf(parsed.graphs[0]).other
    assert.deepEqual(kept.map((entry) => entry.ref), ['/materials/0/pbrMetallicRoughness/baseColorFactor'])
    assert.deepEqual(kept[0].consumers, [])
    assert.equal(out.value.graph.nodes[3].configuration.pointer.value[0],
      '/materials/0/pbrMetallicRoughness/baseColorFactor')

    // The rest runs; the material write is inert (nothing reaches the world).
    assert.deepEqual(runValue(out.value), [[1, 'translation', [1, 2, 3]]])
  })

  test('the same material pointer read by a running node is refused at import, naming the reference and its consumer', () => {
    const graph = graphOf({
      declarations: [{ op: 'pointer/get' }, { op: 'pointer/set' }],
      nodes: [
        {
          declaration: 0,
          configuration: { pointer: lit(T.ref, '/materials/0/pbrMetallicRoughness/baseColorFactor'), type: lit(T.int, T.float4) },
        },
        {
          declaration: 1,
          configuration: { pointer: lit(T.ref, '/nodes/0/scale'), type: lit(T.int, T.float3) },
          values: { value: { node: 0, socket: 'value' } },
        },
      ],
    })
    const out = convertGraph(graph, { own: OWN, nodes: { 0: OWN } })
    assert.match(out.problem,
      /the reference \/materials\/0\/pbrMetallicRoughness\/baseColorFactor \(node 0's pointer\) is read by pointer\/set at node 1; its meaning can't survive the import/)
  })
})

// ---------------------------------------------------------------------------
// The Enable confirmation, the grants and the notes
// ---------------------------------------------------------------------------

const leafOf = (graph, extra = {}) => ({
  kind: 'graph', origin: 'local', enabled: true, graph, nodeMap: [OWN], targets: [TGT], animations: [], ...extra,
})

const writeGraph = ({ onStart = false, onTick = false } = {}) => graphOf({
  declarations: [
    ...(onStart ? [{ op: 'event/onStart' }] : []),
    ...(onTick ? [{ op: 'event/onTick' }] : []),
    { op: 'pointer/set' },
  ],
  nodes: [
    ...(onStart ? [{ declaration: 0, flows: { out: { node: onTick ? 2 : 1, socket: 'in' } } }] : []),
    ...(onTick ? [{ declaration: onStart ? 1 : 0, flows: { out: { node: onStart ? 2 : 1, socket: 'in' } } }] : []),
    {
      declaration: (onStart ? 1 : 0) + (onTick ? 1 : 0),
      configuration: { pointer: lit(T.ref, '/nodes/0/translation'), type: lit(T.int, T.float3) },
      values: { value: lit(T.float3, [0, 0, 0]) },
    },
  ],
})

describe('G6 / Q3 — the Enable confirmation, the grants and the notes', () => {
  test('a custom graph that writes asks on every Enable when it starts on load or runs every frame', () => {
    assert.equal(shouldPromptEnable(leafOf(writeGraph({ onStart: true }))), true)
    assert.equal(shouldPromptEnable(leafOf(writeGraph({ onTick: true }))), true)
    assert.equal(shouldPromptEnable(leafOf(writeGraph({ onStart: true, onTick: true }))), true)
  })

  test('a write that neither starts on load nor runs every frame does NOT ask', () => {
    assert.equal(graphWrites(leafOf(writeGraph())), true)
    assert.equal(shouldPromptEnable(leafOf(writeGraph())), false)
  })

  test('a TEMPLATE never asks, and neither does a graph that does not write', () => {
    const template = leafOf(writeGraph({ onStart: true }), { template: { id: 'select-visibility', params: {} } })
    assert.equal(shouldPromptEnable(template), false)
    const readOnly = leafOf(graphOf({ declarations: [{ op: 'pointer/get' }], nodes: [{ declaration: 0, configuration: { pointer: lit(T.ref, '/nodes/0/translation') } }] }))
    assert.equal(shouldPromptEnable(readOnly), false)
  })

  test('the confirmation names the grants outside the own subtree, character for character', () => {
    const value = leafOf(writeGraph({ onStart: true }), { targets: [TGT] })
    assert.deepEqual(grantsOf(value), [TGT])
    assert.equal(
      enablePromptText(value),
      'This graph runs again whenever you reconnect or your host tab changes, '
      + `and it may overwrite what visitors changed. It can also change: ${TGT}. Enable it?`,
    )
    assert.equal(
      enablePromptText(value, { nameOf: () => 'Fox' }),
      'This graph runs again whenever you reconnect or your host tab changes, '
      + 'and it may overwrite what visitors changed. It can also change: Fox. Enable it?',
    )
  })

  test('the three notes, exactly as G6 writes them', () => {
    const base = { unsupported: [], unsupportedPointers: [], missingSelectOutputs: [] }
    assert.deepEqual(importNotes({ ...base, startsOnLoad: true }), [
      'This graph runs again whenever the owner reconnects, the host tab changes or it is re-enabled. It may overwrite what visitors changed, and its variables and timers start over.',
    ])
    assert.deepEqual(importNotes({ ...base, perFrame: true }), [
      'Visitors see this motion in steps, not smoothly. If the host tab closes mid-way, they keep the last step they saw.',
    ])
    assert.deepEqual(importNotes({ ...base, interpolates: true }), [
      'Visitors see this motion in steps, not smoothly. If the host tab closes mid-way, they keep the last step they saw.',
    ])
    assert.deepEqual(importNotes({ ...base, missingSelectOutputs: ['selectionPoint'] }), [
      "Atrium's clicks have no selection point or ray. Those outputs read as not-a-number.",
    ])
    assert.deepEqual(importNotes({ ...base, startsOnLoad: true, perFrame: true, missingSelectOutputs: ['selectionPoint'] }).length, 3)
    assert.deepEqual(importNotes(base), [])
  })
})
