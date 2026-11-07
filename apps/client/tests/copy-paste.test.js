// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// copy-paste.test.js — copy-objects K2 and K5–K8, the pure module
// (devtasks/PREBRIEF-copy-objects.md §5, "apps/client (copy-paste.js, pure)").
//
// Real behaviour values (templateGraph and hand-built custom graphs), checked
// with the real `behaviorCheck` and the Behaviour form's own `matchesTemplate`.
// apps/client tests can't import glTF-Transform, so nodes are the stand-ins
// edit-duplicate.test.js uses.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  copyObject, preparePaste, foreignIds, behaviorSummary, creditLines, refsRecordText,
  NOTE_TEXT, PASTE_TEXT, ATRIUM_KEYS, LIBRARY_CREATOR,
} from '../src/copy-paste.js'
import { MAX_ADD_BYTES, creditProblem, DUPLICATE_REASONS } from '../src/edit-duplicate.js'
import { matchesTemplate, createBehaviorForm, CHOOSE_TARGET } from '../src/behavior-form.js'
import { enablePromptText, NOT_IN_WORLD } from '../src/graph-import.js'
import { templateGraph } from '@atrium/behaviors/templates'
import { behaviorCheck } from '@atrium/behaviors/behavior-spec'
import { modelReasonText } from '@atrium/client/model-spec'
import { el, elementsFor } from './strict-element.mjs'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWN = '11111111-1111-4111-8111-111111111111'
const DOOR = '22222222-2222-4222-8222-222222222222'
const LAMP = '33333333-3333-4333-8333-333333333333'
const MINE = '44444444-4444-4444-8444-444444444444'   // an object of the destination's
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const ext = (n) => Array.from({ length: n }, () => ({}))

function accessor(array, { type = 'VEC3', componentType = 5126 } = {}) {
  return {
    getBuffer: () => null,
    getArray: () => array, getType: () => type, getComponentType: () => componentType,
    getNormalized: () => false, getSparse: () => false,
    getName: () => '', getExtras: () => ({}), listExtensions: () => ext(0),
  }
}

function primitive(positions) {
  const attributes = { POSITION: accessor(new Float32Array(positions)) }
  return {
    getMode: () => 4, getExtras: () => ({}), listExtensions: () => ext(0),
    listTargets: () => ext(0), listSemantics: () => Object.keys(attributes),
    getAttribute: (s) => attributes[s] ?? null, getIndices: () => null, getMaterial: () => null,
  }
}

function meshOf(positions) {
  return {
    getName: () => '', getExtras: () => ({}), listExtensions: () => ext(0),
    getWeights: () => [], listPrimitives: () => [primitive(positions)],
  }
}

/** A stand-in node whose fields can be changed after Copy. */
function node(o = {}) {
  const n = {
    name: 'Crate', translation: [1, 0.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1], extras: {},
    mesh: null, ...o,
  }
  return {
    getName: () => n.name,
    getTranslation: () => n.translation, getRotation: () => n.rotation, getScale: () => n.scale,
    getExtras: () => n.extras, getMesh: () => n.mesh, listChildren: () => [],
    listParents: () => [{ propertyType: 'Root' }, { propertyType: 'Scene' }],
    getCamera: () => null, getSkin: () => null, getWeights: () => [],
    getExtension: () => null, listExtensions: () => [],
    _n: n,
  }
}

const SRC_WS = 'wss://a.example/worlds/alice/garden'
const SRC = { origin: 'https://a.example' }
const DEST_ORIGIN = 'https://b.example'
const WORLD_A = { id: 'world-a', owner: { id: 'user-alice', name: 'alice' } }
const DAY = '2026-11-06'
const NAMES = { [DOOR]: 'Front door', [LAMP]: 'Lamp' }
const nameOf = (id) => NAMES[id] ?? null

function copy(n, { wsUrl = SRC_WS, world = WORLD_A, date = DAY, names = nameOf, address } = {}) {
  const r = copyObject(n, { wsUrl, world, ...(address ? { address } : {}) }, { date, nameOf: names })
  assert.equal(r.ok, true, r.reason)
  return r.snapshot
}

/** A paste into world B on another server, unless told otherwise. */
function paste(snapshot, o = {}) {
  return preparePaste(snapshot, {
    isFree: () => true, position: [5, 0, 7], destOrigin: DEST_ORIGIN, destWorldId: 'world-b',
    confirm: () => true, ...o,
  })
}

function samePaste(snapshot, o = {}) {
  return paste(snapshot, { destOrigin: SRC.origin, destWorldId: WORLD_A.id, ...o })
}

const atriumOf = (r) => r.descriptor.extras.atrium

// A custom graph: on start, hide nodeMap[1] by a literal [n] index, set
// nodeMap[2] by a {r} ref literal, and write a wired index (the registry bounds
// it at run time). `nodeMap` length 1, 2 or 3.
const TYPES = [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float' }, { signature: 'ref' }]
function customGraph(nodeMap, { targets = nodeMap.slice(1), wired = false, enabled = true, animations = [] } = {}) {
  const nodes = [{ declaration: 0, flows: { out: { node: 1, socket: 'in' } } }]
  const declarations = [{ op: 'event/onStart' }, { op: 'pointer/set' }]
  if (nodeMap.length >= 2) {
    nodes.push({
      declaration: 1,
      configuration: { pointer: { value: ['/nodes/[n]/extensions/KHR_node_visibility/visible'] }, type: { value: [0] } },
      values: { n: { type: 1, value: [1] }, value: { type: 0, value: [false] } },
      ...(nodeMap.length >= 3 ? { flows: { out: { node: 2, socket: 'in' } } } : {}),
    })
  } else {
    nodes.push({
      declaration: 1,
      configuration: { pointer: { value: ['/nodes/[n]/extensions/KHR_node_visibility/visible'] }, type: { value: [0] } },
      values: { n: { type: 1, value: [0] }, value: { type: 0, value: [false] } },
    })
  }
  if (nodeMap.length >= 3) {
    nodes.push({
      declaration: 1,
      configuration: { pointer: { value: ['/nodes/{r}/extensions/KHR_node_visibility/visible'] }, type: { value: [0] } },
      values: { value: { type: 0, value: [true] }, r: { type: 3, value: ['/nodes/2'] } },
    })
  }
  if (wired) {
    declarations.push({ op: 'math/add' })
    const add = nodes.length
    nodes.push({ declaration: 2, values: { a: { type: 1, value: [0] }, b: { type: 1, value: [nodeMap.length - 1] } } })
    nodes[nodes.length - 2].flows = { out: { node: add + 1, socket: 'in' } }
    nodes.push({
      declaration: 1,
      configuration: { pointer: { value: ['/nodes/[n]/extensions/KHR_node_visibility/visible'] }, type: { value: [0] } },
      values: { n: { node: add, socket: 'value' }, value: { type: 0, value: [true] } },
    })
  }
  return {
    kind: 'graph', origin: 'local', enabled,
    graph: { types: TYPES, declarations, nodes },
    nodeMap, targets, animations,
  }
}

const withBehavior = (behavior, o = {}) => node({ extras: { atrium: { objectId: OWN, behavior } }, ...o })

/** The real rule, with the copy's own id. */
function assertValid(behavior, ownId) {
  const check = behaviorCheck(behavior, { ownId })
  assert.equal(check.problem, null, `behaviorCheck: ${check.message}`)
}

/** Every index binds to the entry it did: same graph, entry 0 the copy, the rest through the record. */
function assertSameBindings(before, after, copyId, refs) {
  assert.deepEqual(after.graph, before.graph, 'the graph is unchanged, so every index binds as before')
  assert.equal(after.nodeMap.length, before.nodeMap.length, 'no entry removed')
  assert.equal(after.nodeMap[0], copyId, 'entry 0 is the copy')
  for (let i = 1; i < before.nodeMap.length; i++) {
    const was = before.nodeMap[i]
    if (was === before.nodeMap[0]) { assert.equal(after.nodeMap[i], copyId); continue }
    const entry = refs.find((r) => r.id === after.nodeMap[i])
    assert.ok(entry, `nodeMap[${i}] is a recorded fresh id`)
    assert.equal(entry.was, was, `nodeMap[${i}] stood for ${was}`)
  }
}

// ---------------------------------------------------------------------------
// K5 — the snapshot
// ---------------------------------------------------------------------------

test('K5: the snapshot holds the descriptor and where it came from, from the live connection', () => {
  const n = node({ extras: { atrium: { objectId: OWN } } })
  const s = copy(n)
  assert.equal(s.sourceId, OWN)
  assert.equal(s.date, DAY)
  assert.deepEqual(s.source, {
    origin: 'https://a.example', baseUrl: 'https://a.example', wsUrl: SRC_WS,
    address: '/worlds/alice/garden', world: WORLD_A,
  })
  assert.equal(s.descriptor.name, 'Crate')
  assert.deepEqual(s.descriptor.translation, [1, 0.5, -2])
})

test('K5: a change to the original, and a replaced SOM, after Copy leave the clipboard unchanged', () => {
  const extras = { atrium: { objectId: OWN, teleporter: { destination: '/worlds/alice/garden' } }, note: 'a' }
  const n = node({ extras, translation: [1, 2, 3] })
  const s = copy(n)
  const frozen = structuredClone(s)
  // the owner of A edits the original in place
  n._n.translation[0] = 99
  extras.atrium.teleporter.destination = '/somewhere-else'
  extras.note = 'changed'
  n._n.name = 'Renamed'
  // a teleport replaces the SOM: the node object is dropped entirely
  n._n.extras = null
  assert.deepEqual(s, frozen, 'the snapshot holds no live object')
})

test('K5: a failed paste, and a successful one, leave the clipboard unchanged', () => {
  const s = copy(node({ extras: { atrium: { objectId: OWN, model: { url: '/assets/m.glb' } } } }))
  const frozen = structuredClone(s)
  const failed = paste(s, { confirm: () => false })
  assert.equal(failed.ok, false)
  assert.deepEqual(s, frozen, 'a declined paste')
  const refused = paste({ ...s, source: { ...s.source, baseUrl: null } })
  assert.equal(refused.ok, false)
  assert.deepEqual(s, frozen, 'a refused paste')
  const ok = paste(s)
  assert.equal(ok.ok, true, ok.reason)
  ok.descriptor.extras.atrium.model.url = 'mutated'
  assert.deepEqual(s, frozen, 'a paste, and a later change to its result')
})

test('K5: the source base is the connection\'s, never the File box\'s (worldBaseUrl)', () => {
  const s = copy(node({ extras: { atrium: { objectId: OWN, model: { url: '/m.glb' } } } }),
    { wsUrl: 'ws://127.0.0.1:3000/worlds/a/b' })
  assert.equal(s.source.baseUrl, 'http://127.0.0.1:3000')
  assert.equal(s.source.origin, 'http://127.0.0.1:3000')
  // copyObject takes no worldBaseUrl at all: there is nothing the File box can reach.
  const r = copyObject(node(), { wsUrl: SRC_WS, worldBaseUrl: 'https://filebox.example/' }, { date: DAY })
  assert.equal(r.snapshot.source.baseUrl, 'https://a.example')
})

test('K5: the commons\' address is /', () => {
  const s = copy(node(), { wsUrl: 'wss://a.example/' })
  assert.equal(s.source.address, '/')
})

test('K5: Copy refuses what Duplicate refuses, with Duplicate\'s reason', () => {
  const kids = node()
  kids.listChildren = () => [{}]
  const r = copyObject(kids, { wsUrl: SRC_WS }, { date: DAY })
  assert.equal(r.ok, false)
  assert.equal(r.reason, DUPLICATE_REASONS.children)
  const external = copyObject(node({ extras: { atrium: { source: 'x.gltf' } } }), { wsUrl: SRC_WS }, { date: DAY })
  assert.equal(external.reason, DUPLICATE_REASONS.external)
})

test('K5: Copy without a readable connection says so', () => {
  const r = copyObject(node(), { wsUrl: null }, { date: DAY })
  assert.equal(r.ok, false)
  assert.equal(r.reason, PASTE_TEXT.noSource)
})

test('K5: Copy records the names of the objects a behaviour refers to, when the source has them', () => {
  const behavior = customGraph([OWN, DOOR, LAMP])
  const s = copy(withBehavior(behavior), { names: (id) => (id === DOOR ? 'Front door' : null) })
  assert.deepEqual(s.names, { [DOOR]: 'Front door' })
})

// ---------------------------------------------------------------------------
// K6 — the paste's name, position, id and extras
// ---------------------------------------------------------------------------

test('K6: the name is the original\'s when free, else copyName; no free name refuses', () => {
  const s = copy(node())
  assert.equal(paste(s).descriptor.name, 'Crate')
  assert.equal(paste(s, { isFree: (n) => n !== 'Crate' }).descriptor.name, 'Crate copy')
  assert.equal(paste(s, { isFree: (n) => n !== 'Crate' && n !== 'Crate copy' }).descriptor.name, 'Crate copy 2')
  assert.equal(paste(s, { name: 'Crate copy 5' }).descriptor.name, 'Crate copy 5', 'the retry\'s name')
  const none = paste(s, { isFree: () => false })
  assert.equal(none.ok, false)
})

test('K6: x and z from the palette, y the original\'s own; rotation and scale kept', () => {
  const s = copy(node({ translation: [1, 0.5, -2], rotation: [0, 0.7071068, 0, 0.7071068], scale: [2, 2, 2] }))
  const r = paste(s, { position: [5, 0, 7] })
  assert.deepEqual(r.descriptor.translation, [5, 0.5, 7])
  assert.deepEqual(r.descriptor.rotation, [0, 0.7071068, 0, 0.7071068].map(Math.fround).map((v, i) => s.descriptor.rotation[i]))
  assert.deepEqual(r.descriptor.scale, [2, 2, 2])
})

test('K6: a new objectId, always; a copy of a node with none gets one', () => {
  const r = paste(copy(node({ extras: { atrium: { objectId: OWN } } })))
  assert.match(atriumOf(r).objectId, V4)
  assert.notEqual(atriumOf(r).objectId, OWN)
  const bare = paste(copy(node()))
  assert.match(atriumOf(bare).objectId, V4)
})

test('K6: __atrium_visible, an unknown extras.atrium key and an unknown teleporter key are gone; other extras kept', () => {
  const extras = {
    __atrium_visible: false, note: 'hello', tags: ['a'],
    atrium: { objectId: OWN, later: { plant: 'me' }, teleporter: { destination: 'wss://c.example/', spin: true } },
  }
  const r = paste(copy(node({ extras })))
  assert.equal(r.ok, true, r.reason)
  const out = r.descriptor.extras
  assert.equal(Object.hasOwn(out, '__atrium_visible'), false, 'a paste is always visible')
  assert.equal(out.note, 'hello'); assert.deepEqual(out.tags, ['a'])
  assert.equal(Object.hasOwn(out.atrium, 'later'), false)
  assert.deepEqual(out.atrium.teleporter, { destination: 'wss://c.example/' })
  for (const k of Object.keys(out.atrium)) assert.ok(ATRIUM_KEYS.includes(k), k)
  assert.ok(r.notes.some((t) => t.includes('“later”')), r.notes.join(' | '))
  assert.ok(r.notes.some((t) => t.includes('“spin”')), r.notes.join(' | '))
})

// ---------------------------------------------------------------------------
// K2 — the credit
// ---------------------------------------------------------------------------

test('K2: a palette cube from another world is credited to that world\'s owner, at the Copy\'s day', () => {
  const s = copy(node({ name: 'Cube' }), { date: '2026-11-05' })
  const r = paste(s)
  assert.deepEqual(atriumOf(r).origin, {
    server: 'https://a.example', world: 'world-a', creator: 'user-alice', creatorName: 'alice', at: '2026-11-05',
  })
  assert.deepEqual(atriumOf(r).copiedFrom, {
    server: 'https://a.example', world: 'world-a', address: '/worlds/alice/garden', at: '2026-11-05',
  })
  assert.equal(creditProblem(atriumOf(r)), null)
})

test('K2: a copy of a copy keeps origin unchanged and replaces copiedFrom', () => {
  const origin = { server: 'https://first.example', creatorName: 'zoe', at: '2026-01-01' }
  const first = { server: 'https://first.example', address: '/worlds/zoe/x', at: '2026-01-01' }
  const r = paste(copy(node({ extras: { atrium: { objectId: OWN, origin, copiedFrom: first } } })))
  assert.deepEqual(atriumOf(r).origin, origin, 'origin is fixed at the first copy, missing creator and all')
  assert.equal(atriumOf(r).copiedFrom.server, 'https://a.example', 'copiedFrom is this copy')
})

test('K2: a source with no K1 (an older server) gives { server, at } only', () => {
  const r = paste(copy(node(), { world: null }))
  assert.deepEqual(atriumOf(r).origin, { server: 'https://a.example', at: DAY })
  assert.deepEqual(atriumOf(r).copiedFrom, { server: 'https://a.example', address: '/worlds/alice/garden', at: DAY })
})

test('K2: a K1 value not in K2\'s form is dropped, never a reason to refuse', () => {
  const r = paste(copy(node(), { world: { id: 'world-a', owner: { id: 'user-alice', name: 'a‮b' } } }))
  assert.equal(r.ok, true, r.reason)
  assert.deepEqual(atriumOf(r).origin, { server: 'https://a.example', world: 'world-a', creator: 'user-alice', at: DAY })
})

test('K2: a library model is credited "Library"; an /assets/library/ URL on another host is not', () => {
  const lib = paste(copy(node({ extras: { atrium: { objectId: OWN, model: { url: '/assets/library/chair.glb' } } } })),
    { destOrigin: SRC.origin, destWorldId: 'world-b' })
  assert.equal(lib.ok, true, lib.reason)
  assert.deepEqual(atriumOf(lib).origin, { server: 'https://a.example', at: DAY, creatorName: LIBRARY_CREATOR })

  const evil = paste(copy(node({ extras: { atrium: { objectId: OWN, model: { url: 'https://evil.example/assets/library/x.glb' } } } })),
    { destOrigin: SRC.origin, destWorldId: 'world-b' })
  assert.equal(evil.ok, true, evil.reason)
  assert.notEqual(atriumOf(evil).origin.creatorName, LIBRARY_CREATOR)
  assert.equal(atriumOf(evil).origin.creatorName, 'alice')
})

test('K2/K8: a library item copied ACROSS servers is credited to the source world\'s owner', () => {
  const r = paste(copy(node({ extras: { atrium: { objectId: OWN, model: { url: '/assets/library/chair.glb' } } } })))
  assert.equal(r.ok, true, r.reason)
  assert.equal(atriumOf(r).model.url, 'https://a.example/assets/library/chair.glb')
  assert.equal(atriumOf(r).origin.creatorName, 'alice', 'not "Library": the URL is on another origin')
})

test('K2: a malformed existing credit doesn\'t stop Copy; Paste replaces it and says so', () => {
  const extras = { atrium: { objectId: OWN, origin: { server: 'nope' }, copiedFrom: 'x' } }
  const s = copy(node({ extras }))
  const r = paste(s)
  assert.equal(r.ok, true, r.reason)
  assert.equal(creditProblem(atriumOf(r)), null)
  assert.equal(atriumOf(r).origin.creatorName, 'alice')
  assert.ok(r.notes.includes(NOTE_TEXT.creditReplaced))
  // an origin that passes beside a bad copiedFrom is carried; copiedFrom replaced
  const good = { server: 'https://z.example', at: '2026-01-02' }
  const r2 = paste(copy(node({ extras: { atrium: { objectId: OWN, origin: good, copiedFrom: { server: 'x' } } } })))
  assert.deepEqual(atriumOf(r2).origin, good)
  assert.ok(r2.notes.includes(NOTE_TEXT.creditReplaced))
})

test('K2: a same-world paste changes no credit (it is a Duplicate)', () => {
  const plain = samePaste(copy(node()))
  assert.equal(plain.ok, true, plain.reason)
  assert.equal(Object.hasOwn(atriumOf(plain), 'origin'), false)
  assert.equal(Object.hasOwn(atriumOf(plain), 'copiedFrom'), false)
  const credit = { origin: { server: 'https://z.example', at: '2026-01-02' }, copiedFrom: { server: 'https://z.example', address: '/', at: '2026-01-02' } }
  const kept = samePaste(copy(node({ extras: { atrium: { objectId: OWN, ...structuredClone(credit) } } })))
  assert.deepEqual(atriumOf(kept).origin, credit.origin)
  assert.deepEqual(atriumOf(kept).copiedFrom, credit.copiedFrom)
})

test('K2: the size — an object over the cap can\'t be copied; one at the cap without its credit is refused once it has one', () => {
  const big = (vertices) => node({ mesh: meshOf(Array.from({ length: vertices * 3 }, (_, i) => (i % 97) * 0.012345)) })
  const over = copyObject(big(65535), { wsUrl: SRC_WS, world: WORLD_A }, { date: DAY })
  assert.equal(over.ok, false)
  assert.ok(over.reason.startsWith(DUPLICATE_REASONS.size), over.reason)
  // the largest vertex count whose Copy passes
  let lo = 3, hi = 65535
  while (hi - lo > 3) {
    const mid = Math.floor((lo + hi) / 2 / 3) * 3
    if (copyObject(big(mid), { wsUrl: SRC_WS, world: WORLD_A }, { date: DAY }).ok) lo = mid; else hi = mid
  }
  const s = copy(big(lo))
  const r = paste(s)
  assert.equal(r.ok, false, 'the credit takes it over the cap')
  assert.ok(r.reason.startsWith(DUPLICATE_REASONS.size), r.reason)
  assert.ok(MAX_ADD_BYTES > 0)
})

// ---------------------------------------------------------------------------
// K7 — behaviours (GR2-M4's matrix)
// ---------------------------------------------------------------------------

const CASES = [
  ['custom, nodeMap of 1', () => customGraph([OWN], { targets: [] })],
  ['custom, nodeMap of 2, a literal pointer', () => customGraph([OWN, DOOR])],
  ['custom, nodeMap of 3, literal and {r} pointers', () => customGraph([OWN, DOOR, LAMP])],
  ['custom, nodeMap of 3, a wired pointer', () => customGraph([OWN, DOOR, LAMP], { wired: true })],
  ['custom, targets empty with another object mapped', () => customGraph([OWN, DOOR], { targets: [] })],
  ['custom, an animation for the object and for another', () => customGraph([OWN, DOOR], {
    animations: [{ object: OWN, clip: 'Idle', loop: true }, { object: DOOR, clip: 'Open', loop: false }],
  })],
  ['template targeting the object', () => templateGraph('select-visibility', { target: OWN, action: 'hide' }, { ownId: OWN })],
  ['template targeting another', () => templateGraph('select-visibility', { target: DOOR, action: 'toggle' }, { ownId: OWN })],
  ['template animation for the object', () => templateGraph('select-animation', { target: OWN, clip: 'Idle', action: 'play', loop: true }, { ownId: OWN })],
  ['template animation for another', () => templateGraph('select-animation', { target: DOOR, clip: 'Open', action: 'play', loop: false }, { ownId: OWN })],
]

for (const [label, make] of CASES) {
  test(`K7 same world — ${label}: grants and enabled state kept, as Duplicate`, () => {
    const behavior = make()
    assertValid(behavior, OWN)
    const r = samePaste(copy(withBehavior(behavior)))
    assert.equal(r.ok, true, r.reason)
    const copyId = atriumOf(r).objectId
    const out = atriumOf(r).behavior
    const expected = JSON.parse(JSON.stringify(behavior).split(OWN).join(copyId))
    assert.deepEqual(out, expected, 'only self-references move')
    assert.equal(out.enabled, behavior.enabled)
    assertValid(out, copyId)
    if (behavior.template) assert.ok(matchesTemplate(out, copyId), 'still its template')
    assert.equal(r.notes.length, 0, r.notes.join(' | '))
  })

  test(`K7 another world — ${label}: every other id replaced and recorded, disabled, still valid`, () => {
    const behavior = make()
    const s = copy(withBehavior(behavior))
    const r = paste(s)
    assert.equal(r.ok, true, r.reason)
    const a = atriumOf(r)
    const copyId = a.objectId
    const out = a.behavior
    assert.equal(out.enabled, false, 'arrives disabled')
    assertValid(out, copyId)
    if (behavior.template) assert.ok(matchesTemplate(out, copyId), 'still its template')
    const foreign = foreignIds(behavior, OWN)
    const refs = a.copiedFrom.refs ?? []
    assert.equal(refs.length, foreign.length, 'one record per foreign id')
    for (const id of [DOOR, LAMP]) assert.ok(!JSON.stringify(out).includes(id), `${id} is gone from the behaviour`)
    for (const ref of refs) {
      assert.match(ref.id, V4)
      assert.ok(foreign.includes(ref.was))
      if (NAMES[ref.was]) assert.equal(ref.name, NAMES[ref.was])
      // one id gets one replacement everywhere
      const where = JSON.stringify(out).split(ref.id).length - 1
      const before = JSON.stringify(behavior).split(ref.was).length - 1
      assert.equal(where, before, `${ref.was} → ${ref.id} everywhere it appeared`)
    }
    assertSameBindings(behavior, out, copyId, refs)
    if (foreign.length > 0) {
      assert.ok(r.notes.includes(behavior.template ? NOTE_TEXT.refersTemplate : NOTE_TEXT.refersCustom), r.notes.join(' | '))
    } else {
      assert.ok(!r.notes.includes(NOTE_TEXT.refersTemplate) && !r.notes.includes(NOTE_TEXT.refersCustom))
      assert.equal(Object.hasOwn(a.copiedFrom, 'refs'), false, 'no record when nothing was replaced')
    }
  })
}

test('K7: an unknown source world id, or a client.world without an id, is another world', () => {
  const behavior = customGraph([OWN, DOOR])
  const noWorld = paste(copy(withBehavior(behavior), { world: null }), { destOrigin: SRC.origin, destWorldId: WORLD_A.id })
  assert.equal(atriumOf(noWorld).behavior.enabled, false)
  assert.ok(!atriumOf(noWorld).behavior.nodeMap.includes(DOOR))
  const noDest = paste(copy(withBehavior(behavior)), { destOrigin: SRC.origin, destWorldId: null })
  assert.equal(atriumOf(noDest).behavior.enabled, false)
  const otherServer = paste(copy(withBehavior(behavior)), { destOrigin: DEST_ORIGIN, destWorldId: WORLD_A.id })
  assert.equal(atriumOf(otherServer).behavior.enabled, false, 'the same id on another server is another world')
})

test('K7: a hostile source whose own id equals a destination object\'s becomes a self-reference, not a grant', () => {
  // A's object claims MINE as its own id and aims at MINE too.
  const behavior = templateGraph('select-visibility', { target: MINE, action: 'hide' }, { ownId: MINE })
  const n = node({ extras: { atrium: { objectId: MINE, behavior } } })
  const r = paste(copy(n))
  const out = atriumOf(r).behavior
  assert.ok(!JSON.stringify(out).includes(MINE), 'MINE appears nowhere')
  assert.equal(out.nodeMap[0], atriumOf(r).objectId)
  assert.equal(out.template.params.target, atriumOf(r).objectId)
})

test('K7: a hostile behaviour aimed at a destination object\'s id gets a fresh id instead', () => {
  const behavior = templateGraph('select-visibility', { target: MINE, action: 'hide' }, { ownId: OWN })
  const r = paste(copy(withBehavior(behavior)))
  const out = atriumOf(r).behavior
  assert.ok(!JSON.stringify(out).includes(MINE))
  assert.deepEqual(atriumOf(r).copiedFrom.refs.map((x) => x.was), [MINE])
})

test('K7: a copy of a copy records the first world\'s references', () => {
  const behavior = customGraph([OWN, DOOR, LAMP])
  const first = paste(copy(withBehavior(behavior)))
  const a1 = atriumOf(first)
  // the pasted object, now in B, copied again and pasted into C
  const inB = node({ extras: structuredClone(first.descriptor.extras) })
  const second = paste(copy(inB, { wsUrl: 'wss://b.example/worlds/bob/yard', world: { id: 'world-b' }, names: () => null }),
    { destOrigin: 'https://c.example', destWorldId: 'world-c' })
  assert.equal(second.ok, true, second.reason)
  const refs = atriumOf(second).copiedFrom.refs
  assert.deepEqual(refs.map((x) => x.was).sort(), [DOOR, LAMP].sort(), 'the first world\'s ids')
  assert.deepEqual(refs.map((x) => x.name).sort(), ['Front door', 'Lamp'])
  for (const ref of refs) assert.ok(!a1.copiedFrom.refs.some((x) => x.id === ref.id), 'fresh again')
})

test('K7: a source without the object\'s name records no name', () => {
  const r = paste(copy(withBehavior(customGraph([OWN, DOOR])), { names: () => null }))
  assert.deepEqual(Object.keys(atriumOf(r).copiedFrom.refs[0]).sort(), ['id', 'was'])
})

test('K7: a behaviour holding the most distinct ids the rules allow (40) records all 40', () => {
  const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
  const nodeMap = [OWN, ...Array.from({ length: 15 }, (_, i) => id(100 + i))]
  const targets = Array.from({ length: 16 }, (_, i) => id(200 + i))
  const animations = Array.from({ length: 8 }, (_, i) => ({ object: id(300 + i), clip: 'c', loop: false }))
  const behavior = {
    kind: 'graph', origin: 'local', enabled: true,
    graph: customGraph([OWN]).graph,
    nodeMap, targets, animations,
    template: { id: 'select-visibility', params: { target: id(400), action: 'hide' } },
  }
  assertValid(behavior, OWN)
  assert.equal(foreignIds(behavior, OWN).length, 40)
  const r = paste(copy(withBehavior(behavior), { names: (x) => `n${x.slice(0, 8)}` }))
  assert.equal(r.ok, true, r.reason)
  assert.equal(atriumOf(r).copiedFrom.refs.length, 40)
  assert.equal(creditProblem(atriumOf(r)), null)
})

test('K7: Copy accepts a behaviour on a node with no own id; Paste refuses it', () => {
  const behavior = customGraph([OWN, DOOR])
  const n = node({ extras: { atrium: { behavior } } })
  const c = copyObject(n, { wsUrl: SRC_WS, world: WORLD_A }, { date: DAY })
  assert.equal(c.ok, true, c.reason)
  assert.equal(c.snapshot.sourceId, null)
  for (const r of [paste(c.snapshot), samePaste(c.snapshot)]) {
    assert.equal(r.ok, false)
    assert.equal(r.reason, PASTE_TEXT.selfless)
  }
})

test('K7: a template aimed at an object the destination lacks opens with "Choose a target…", and re-aimed it is a template again', () => {
  const behavior = templateGraph('select-visibility', { target: DOOR, action: 'hide' }, { ownId: OWN })
  const r = paste(copy(withBehavior(behavior)))
  const pasted = { name: r.descriptor.name, extras: r.descriptor.extras }
  const mine = { name: 'My lamp', extras: { atrium: { objectId: MINE } } }
  const calls = []
  const elements = elementsFor()
  const form = createBehaviorForm({
    elements,
    deps: {
      selected: () => pasted, nodes: () => [pasted, mine], status: () => ({}),
      write: { setObjectId: () => 1, sendField: (...a) => { calls.push(a); return 2 } },
      createElement: (tag) => el(tag), logLines: () => [],
    },
  })
  form.open(pasted)
  assert.equal(form.state.template, 'select-visibility')
  const select = elements.params.children.flatMap((row) => row.children ?? []).find((c) => c.tagName === 'select')
  assert.ok(select, 'a target picker')
  assert.equal(select.children[0].textContent, CHOOSE_TARGET, 'the fresh id reaches nothing: "Choose a target…"')
  form.onParamChange('target', MINE)
  form.save()
  const value = calls.at(-1)?.[2]
  assert.ok(value, 'Save wrote the leaf')
  assert.ok(matchesTemplate(value, pasted.extras.atrium.objectId), 'a value matchesTemplate accepts')
  assert.deepEqual(value.targets, [MINE])
})

test('K7: the enable question with no grants, and with a grant not in the world', () => {
  const none = customGraph([OWN], { targets: [] })
  assert.equal(enablePromptText(none),
    'This graph runs again whenever you reconnect or your host tab changes, and it may overwrite what visitors changed. Enable it?')
  const r = paste(copy(withBehavior(customGraph([OWN, DOOR]))))
  const out = atriumOf(r).behavior
  const text = enablePromptText(out, { nameOf: (id) => id, inWorld: () => false })
  assert.ok(text.includes(`It can also change: ${NOT_IN_WORLD}. Enable it?`), text)
  assert.ok(!text.includes(out.targets[0]), 'the fresh id isn\'t shown')
})

// ---------------------------------------------------------------------------
// K8 — URLs
// ---------------------------------------------------------------------------

const modelNode = (url) => node({ extras: { atrium: { objectId: OWN, model: { url, sha256: 'a'.repeat(64), bounds: [1, 2, 3] } } } })
const padNode = (destination) => node({ extras: { atrium: { objectId: OWN, teleporter: { destination } } } })

test('K8: the same origin changes neither a model nor a pad', () => {
  const m = paste(copy(modelNode('/assets/m.glb')), { destOrigin: SRC.origin, destWorldId: 'world-b' })
  assert.equal(atriumOf(m).model.url, '/assets/m.glb')
  const p = paste(copy(padNode('/worlds/alice/garden')), { destOrigin: SRC.origin, destWorldId: 'world-b' })
  assert.equal(atriumOf(p).teleporter.destination, '/worlds/alice/garden')
})

test('K8: origins differing only by a default port are one origin', () => {
  const s = copy(modelNode('/assets/m.glb'), { wsUrl: 'wss://a.example:443/worlds/a/b' })
  const r = paste(s, { destOrigin: 'https://a.example' })
  assert.equal(atriumOf(r).model.url, '/assets/m.glb')
  const r2 = paste(copy(modelNode('/assets/m.glb')), { destOrigin: 'wss://a.example:443' })
  assert.equal(atriumOf(r2).model.url, '/assets/m.glb')
})

test('K8: another origin, https: a root-path model becomes absolute and is revalidated; sha256 and bounds travel', () => {
  const r = paste(copy(modelNode('/assets/m.glb')))
  assert.equal(r.ok, true, r.reason)
  assert.equal(atriumOf(r).model.url, 'https://a.example/assets/m.glb')
  assert.equal(atriumOf(r).model.sha256, 'a'.repeat(64))
  assert.deepEqual(atriumOf(r).model.bounds, [1, 2, 3])
})

test('K8: another origin, http (DEV): refused with url-scheme\'s text, nothing to send', () => {
  const s = copy(modelNode('/assets/m.glb'), { wsUrl: 'ws://dev.example:3000/worlds/a/b' })
  const r = paste(s)
  assert.equal(r.ok, false)
  assert.equal(r.reason, modelReasonText('url-scheme'))
  assert.equal(r.descriptor, undefined)
})

test('K8: no-base is refused with its sentence', () => {
  const s = copy(modelNode('/assets/m.glb'))
  const r = paste({ ...s, source: { ...s.source, baseUrl: null } })
  assert.equal(r.ok, false)
  assert.equal(r.reason, PASTE_TEXT.noBase)
})

test('K8: a model URL resolved past 2,048 is refused with url-length\'s text', () => {
  const long = '/' + 'a'.repeat(2040)
  const r = paste(copy(modelNode(long)))
  assert.equal(r.ok, false)
  assert.equal(r.reason, modelReasonText('url-length'))
})

test('K8: a pad /worlds/… and worlds/… both become the source server\'s ws(s) address; ws(s) and "" are kept', () => {
  const a = paste(copy(padNode('/worlds/alice/garden')))
  assert.equal(atriumOf(a).teleporter.destination, 'wss://a.example/worlds/alice/garden')
  const b = paste(copy(padNode('worlds/alice/garden')))
  assert.equal(atriumOf(b).teleporter.destination, 'wss://a.example/worlds/alice/garden')
  const c = paste(copy(padNode('/')))
  assert.equal(atriumOf(c).teleporter.destination, 'wss://a.example/')
  const dev = paste(copy(padNode('/worlds/x/y'), { wsUrl: 'ws://dev.example:3000/' }))
  assert.equal(atriumOf(dev).teleporter.destination, 'ws://dev.example:3000/worlds/x/y', 'ws:// is allowed for pads')
  const ws = paste(copy(padNode('wss://elsewhere.example/worlds/q/r')))
  assert.equal(atriumOf(ws).teleporter.destination, 'wss://elsewhere.example/worlds/q/r')
  const none = paste(copy(padNode('')))
  assert.equal(atriumOf(none).teleporter.destination, '', 'a pad to nowhere')
})

test('K8: a pad destination that can\'t be resolved, or resolves past 2,048, is refused', () => {
  const bad = paste(copy(padNode('https://not-a-world.example/')))
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, PASTE_TEXT.padNoBase)
  const long = paste(copy(padNode('/' + 'a'.repeat(2040))))
  assert.equal(long.ok, false)
  assert.equal(long.reason, PASTE_TEXT.padLength)
})

test('K8: a third-party model asks first, even within one server; declined sends nothing, accepted pastes', () => {
  const asked = []
  const s = copy(modelNode('https://models.example/chair.glb'))
  const declined = samePaste(s, { confirm: (q) => { asked.push(q); return false } })
  assert.equal(declined.ok, false)
  assert.equal(declined.declined, true)
  assert.equal(declined.descriptor, undefined)
  assert.equal(asked[0], 'This model is loaded from models.example. Pasting it makes your browser, and your visitors’, fetch from there. Paste?')
  const accepted = samePaste(s, { confirm: () => true })
  assert.equal(accepted.ok, true, accepted.reason)
  assert.equal(paste(s, { confirm: undefined }).ok, false, 'no asker declines')
  // a root-path model copied across servers is on the SOURCE host now: it asks too
  const asked2 = []
  paste(copy(modelNode('/assets/m.glb')), { confirm: (q) => { asked2.push(q); return true } })
  assert.match(asked2[0], /loaded from a\.example/)
  // a model on the destination's own origin doesn't ask
  const asked3 = []
  samePaste(copy(modelNode('/assets/m.glb')), { confirm: (q) => { asked3.push(q); return true } })
  assert.deepEqual(asked3, [])
})

// ---------------------------------------------------------------------------
// The panels' text
// ---------------------------------------------------------------------------

test('creditLines: worded as claimed; nothing for a credit-less object', () => {
  assert.deepEqual(creditLines({ objectId: OWN }), [])
  const r = paste(copy(node()))
  const lines = creditLines(atriumOf(r))
  assert.deepEqual(lines, [
    'Made by alice, it says (a.example, 2026-11-06)',
    'Copied from /worlds/alice/garden on a.example, 2026-11-06, it says',
  ])
  assert.deepEqual(creditLines({ origin: { server: 'https://a.example', at: DAY, creatorName: LIBRARY_CREATOR } }),
    ['From the library, it says (a.example, 2026-11-06)'])
  assert.deepEqual(creditLines({ origin: { server: 'https://a.example', at: DAY } }),
    ['First copied from a world on a.example, 2026-11-06, it says'])
  assert.deepEqual(creditLines({ origin: 'x' }), ['Its credit is malformed'])
})

test('behaviorSummary and the record: names where the world has them, the K7 note when it refers to any', () => {
  const behavior = customGraph([OWN, DOOR, LAMP])
  const before = behaviorSummary({ objectId: OWN, behavior }, { nameOf })
  assert.equal(before.kind, 'custom')
  assert.deepEqual(before.refers, ['Front door', 'Lamp'])
  assert.equal(before.note, NOTE_TEXT.refersCustom)
  const r = paste(copy(withBehavior(behavior)))
  const after = behaviorSummary(atriumOf(r), { nameOf: () => null })
  assert.deepEqual(after.refers, [NOT_IN_WORLD, NOT_IN_WORLD])
  assert.equal(after.enabled, false)
  assert.equal(after.record, 'It referred to Front door, Lamp in the world it was copied from')
  assert.equal(refsRecordText(atriumOf(r)), after.record)
  const tpl = behaviorSummary({ objectId: OWN, behavior: templateGraph('select-visibility', { target: OWN, action: 'hide' }, { ownId: OWN }) })
  assert.equal(tpl.kind, 'template')
  assert.equal(tpl.note, null)
  assert.equal(behaviorSummary({ objectId: OWN }), null)
})
