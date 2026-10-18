// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Phase 3 step 1b-2, N3 — devtasks/PREBRIEF-edit-mode-ui-1b-2.md §7.1
//
// apps/client tests can't import glTF-Transform, so these stand-ins implement
// the glTF-Transform 4.3 methods prepareDuplicate reads (getMesh,
// listPrimitives, getAttribute, …). The end-to-end check (§7.4) runs the same
// function on real glTF-Transform objects.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  prepareDuplicate, prepareRestore, duplicateRuleProblem, addMessageBytes, DUPLICATE_REASONS, DUPLICATE_OFFSET_X, MAX_ADD_BYTES,
} from '../src/edit-duplicate.js'

// ── glTF-Transform stand-ins ────────────────────────────────────────────────

const ext = (n) => Array.from({ length: n }, () => ({}))

function accessor(array, { type = 'VEC3', componentType = 5126, normalized = false, sparse = false,
  name = '', extras = {}, extensions = 0, buffer = null } = {}) {
  return {
    getBuffer: () => buffer,
    getArray: () => array, getType: () => type, getComponentType: () => componentType,
    getNormalized: () => normalized, getSparse: () => sparse,
    getName: () => name, getExtras: () => extras, listExtensions: () => ext(extensions),
  }
}

function material(o = {}) {
  const m = {
    name: '', extras: {}, extensions: 0, textures: {}, emissive: [0, 0, 0], alphaMode: 'OPAQUE',
    doubleSided: false, baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.8, ...o,
  }
  return {
    getName: () => m.name, getExtras: () => m.extras, listExtensions: () => ext(m.extensions),
    getBaseColorTexture: () => m.textures.baseColor ?? null,
    getMetallicRoughnessTexture: () => m.textures.mr ?? null,
    getNormalTexture: () => m.textures.normal ?? null,
    getOcclusionTexture: () => m.textures.occlusion ?? null,
    getEmissiveTexture: () => m.textures.emissive ?? null,
    getEmissiveFactor: () => m.emissive, getAlphaMode: () => m.alphaMode, getDoubleSided: () => m.doubleSided,
    getBaseColorFactor: () => m.baseColor, getMetallicFactor: () => m.metallic, getRoughnessFactor: () => m.roughness,
    _m: m,
  }
}

function primitive({ positions, normals, indices, mat = material(), mode = 4, extras = {}, extensions = 0,
  targets = 0, attrs } = {}) {
  const attributes = attrs ?? {
    POSITION: accessor(new Float32Array(positions)),
    ...(normals ? { NORMAL: accessor(new Float32Array(normals)) } : {}),
  }
  const index = indices ? accessor(indices instanceof Uint16Array || indices instanceof Uint32Array ? indices : new Uint16Array(indices), { type: 'SCALAR', componentType: 5123 }) : null
  return {
    getMode: () => mode, getExtras: () => extras, listExtensions: () => ext(extensions),
    listTargets: () => ext(targets), listSemantics: () => Object.keys(attributes),
    getAttribute: (s) => attributes[s] ?? null, getIndices: () => index, getMaterial: () => mat,
  }
}

function mesh(prims, { name = '', extras = {}, extensions = 0, weights = [] } = {}) {
  return {
    getName: () => name, getExtras: () => extras, listExtensions: () => ext(extensions),
    getWeights: () => weights, listPrimitives: () => prims,
  }
}

// A node whose fields can be changed after a first check, the way an own
// accepted edit changes the SOM without any event reaching this module.
function node(o = {}) {
  const n = {
    name: 'Cube', translation: [1, 0.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1], extras: {},
    mesh: null, children: [], parents: ['Root', 'Scene'], camera: null, skin: null, light: null,
    extensions: 0, ...o,
  }
  return {
    getName: () => n.name,
    getTranslation: () => n.translation, getRotation: () => n.rotation, getScale: () => n.scale,
    getExtras: () => n.extras, getMesh: () => n.mesh, listChildren: () => n.children,
    listParents: () => n.parents.map((t) => ({ propertyType: t })),
    getCamera: () => n.camera, getSkin: () => n.skin, getWeights: () => n.weights ?? [],
    getExtension: (e) => (e === 'KHR_lights_punctual' ? n.light : null),
    listExtensions: () => ext(n.extensions),
    _n: n,
  }
}

// A 1 m cube's worth of plain geometry (24 vertices, 36 indices).
function cubeMesh(opts = {}) {
  const positions = [], normals = [], indices = []
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) { positions.push((v & 1) - 0.5, (v >> 1) - 0.5, f / 10); normals.push(0, 0, 1) }
    indices.push(4 * f, 4 * f + 1, 4 * f + 2, 4 * f, 4 * f + 2, 4 * f + 3)
  }
  return mesh([primitive({ positions, normals, indices, ...opts })], opts.meshOpts)
}

const NAME = 'Cube copy'
function expectRule(n, rule) {
  const r = prepareDuplicate(n, { name: NAME })
  assert.equal(r.ok, false, `expected refusal by ${rule}`)
  assert.equal(r.rule, rule)
  assert.ok(r.reason.startsWith(DUPLICATE_REASONS[rule]), r.reason)
  return r
}

// ── One test per rule (§N3 1–9) ─────────────────────────────────────────────

test('rule 1: a node with children is refused', () => {
  expectRule(node({ mesh: cubeMesh(), children: [{}] }), 'children')
})

test('rule 2: a nested node is refused (J3)', () => {
  expectRule(node({ mesh: cubeMesh(), parents: ['Root', 'Node'] }), 'parent')
})

test('rule 3: camera, light or skin hosts are refused', () => {
  expectRule(node({ camera: {} }), 'attached')
  expectRule(node({ light: {}, extensions: 1 }), 'attached')
  expectRule(node({ skin: {} }), 'attached')
})

test('rule 4 (review #2): a node targeted by an animation channel is refused', () => {
  expectRule(node({ mesh: cubeMesh(), parents: ['Root', 'Scene', 'AnimationChannel'] }), 'referenced')
})

test('rule 4 (review #2): a skin joint is refused', () => {
  expectRule(node({ mesh: cubeMesh(), parents: ['Root', 'Scene', 'Skin'] }), 'referenced')
})

test('rule 5: externally loaded content is refused', () => {
  expectRule(node({ extras: { atrium: { source: 'https://example.com/a.gltf' } } }), 'external')
})

test('rule 5 (outside review nit): any own `source` key, null included, as the server refuses', () => {
  expectRule(node({ extras: { atrium: { source: null } } }), 'external')
  expectRule(node({ extras: { atrium: { source: '' } } }), 'external')
})

test('rule 5 (outside review nit): extras.atrium the server’s L5 check would refuse', () => {
  const r1 = expectRule(node({ extras: { atrium: [] } }), 'atrium')
  assert.match(r1.reason, /not an object/)
  expectRule(node({ extras: { atrium: null } }), 'atrium')
  expectRule(node({ extras: { atrium: { teleporter: 'x' } } }), 'atrium')
  expectRule(node({ extras: { atrium: { teleporter: {} } } }), 'atrium')
  expectRule(node({ extras: { atrium: { teleporter: { destination: 42 } } } }), 'atrium')
  const long = expectRule(node({ extras: { atrium: { teleporter: { destination: 'x'.repeat(3000) } } } }), 'atrium')
  assert.match(long.reason, /2048/)
  // what the server accepts is accepted here
  assert.equal(prepareDuplicate(node({ extras: { atrium: { teleporter: { destination: 'x'.repeat(2048) } } } }), { name: NAME }).ok, true)
  assert.equal(prepareDuplicate(node({ extras: { atrium: { teleporter: { destination: '' } } } }), { name: NAME }).ok, true)
  assert.equal(prepareDuplicate(node({ extras: { atrium: { other: 1 } } }), { name: NAME }).ok, true)
})

test('rule 6 (outside review nit): node morph weights are refused', () => {
  assert.match(expectRule(node({ mesh: cubeMesh(), weights: [0.5] }), 'mesh').reason, /node morph weights/)
})

test('rule 6 (outside review nit): a buffer with a name, extras or extensions', () => {
  for (const buffer of [
    { getName: () => 'geo.bin', getExtras: () => ({}), listExtensions: () => [] },
    { getName: () => '', getExtras: () => ({ a: 1 }), listExtensions: () => [] },
    { getName: () => '', getExtras: () => ({}), listExtensions: () => [{}] },
  ]) {
    const p = primitive({ attrs: { POSITION: accessor(new Float32Array(9), { buffer }) } })
    assert.match(expectRule(node({ mesh: mesh([p]) }), 'mesh').reason, /buffer has a name, extras or extensions/)
  }
  const plain = { getName: () => '', getExtras: () => ({}), listExtensions: () => [] }
  const p = primitive({ attrs: { POSITION: accessor(new Float32Array(9), { buffer: plain }) } })
  assert.equal(prepareDuplicate(node({ mesh: mesh([p]) }), { name: NAME }).ok, true)
})

test('rule 9 (outside review S2): far over the cap is refused by a lower bound, without building the copy', () => {
  // 600 000 numbers can't fit: each is at least a digit and a comma.
  const zeros = new Float32Array(600_000)
  let built = 0
  const pos = accessor(zeros)
  const counting = { ...pos, getArray: () => { built++; return zeros } }
  const n = node({ mesh: mesh([primitive({ attrs: { POSITION: counting } })]) })
  const r = expectRule(n, 'size')
  assert.match(r.reason, /at least 1,200,000 bytes/)
  assert.equal(duplicateRuleProblem(n).rule, 'size', 'the cheap check refuses it too')
  assert.ok(built <= 2, `the arrays were only measured, not copied (${built} reads)`)
})

test('duplicateRuleProblem: null for an eligible node; never builds the copy', () => {
  assert.equal(duplicateRuleProblem(node({ mesh: cubeMesh() })), null)
  assert.equal(duplicateRuleProblem(node({ children: [{}] })).rule, 'children')
})

test('rule 6: primitive mode other than triangles', () => {
  assert.match(expectRule(node({ mesh: cubeMesh({ mode: 1 }) }), 'mesh').reason, /not triangles/)
})

test('rule 6: attributes other than POSITION (and NORMAL)', () => {
  const p = primitive({ attrs: {
    POSITION: accessor(new Float32Array(9)), NORMAL: accessor(new Float32Array(9)),
    TEXCOORD_0: accessor(new Float32Array(6), { type: 'VEC2' }),
  } })
  assert.match(expectRule(node({ mesh: mesh([p]) }), 'mesh').reason, /TEXCOORD_0/)
})

test('rule 6: non-float, normalized or sparse vertex data', () => {
  const bad = (o) => primitive({ attrs: { POSITION: accessor(new Int16Array(9), o) } })
  assert.match(expectRule(node({ mesh: mesh([bad({ componentType: 5122 })]) }), 'mesh').reason, /not float/)
  assert.match(expectRule(node({ mesh: mesh([bad({ normalized: true })]) }), 'mesh').reason, /normalized/)
  assert.match(expectRule(node({ mesh: mesh([bad({ sparse: true })]) }), 'mesh').reason, /sparse/)
})

test('rule 6: morph targets and morph weights', () => {
  expectRule(node({ mesh: cubeMesh({ targets: 1 }) }), 'mesh')
  expectRule(node({ mesh: cubeMesh({ meshOpts: { weights: [0.5] } }) }), 'mesh')
})

test('rule 6: an index of 65 536 is refused', () => {
  const p = primitive({ positions: new Array(9).fill(0), indices: new Uint32Array([0, 1, 65536]) })
  assert.match(expectRule(node({ mesh: mesh([p]) }), 'mesh').reason, /65535/)
})

test('rule 6: textures, emissive, blending, double-sided materials', () => {
  for (const [o, re] of [
    [{ textures: { baseColor: {} } }, /textures/],
    [{ textures: { normal: {} } }, /textures/],
    [{ emissive: [0.1, 0, 0] }, /emissive/],
    [{ alphaMode: 'BLEND' }, /opaque/],
    [{ doubleSided: true }, /double-sided/],
  ]) {
    assert.match(expectRule(node({ mesh: cubeMesh({ mat: material(o) }) }), 'mesh').reason, re)
  }
})

// Review #2 — a visually ordinary cube, one unsupported property at a time.
test('rule 6 (review #2): a visually ordinary cube with metadata add can’t carry', () => {
  const cases = [
    ['primitive extras', node({ mesh: cubeMesh({ extras: { tag: 1 } }) })],
    ['primitive extensions', node({ mesh: cubeMesh({ extensions: 1 }) })],
    ['material has extras', node({ mesh: cubeMesh({ mat: material({ extras: { note: 'x' } }) }) })],
    ['material has a name', node({ mesh: cubeMesh({ mat: material({ name: 'Brick' }) }) })],
    ['material has extensions', node({ mesh: cubeMesh({ mat: material({ extensions: 1 }) }) })],
    ['mesh extras', node({ mesh: cubeMesh({ meshOpts: { extras: { lod: 0 } } }) })],
    ['mesh extensions', node({ mesh: cubeMesh({ meshOpts: { extensions: 1 } }) })],
  ]
  for (const [detail, n] of cases) {
    const r = expectRule(n, 'mesh')
    assert.ok(r.reason.includes(detail), `${detail}: ${r.reason}`)
  }
})

test('rule 6 (review #2): an accessor with a name, extras or extensions', () => {
  const withAcc = (o) => primitive({ attrs: { POSITION: accessor(new Float32Array(9), o) } })
  assert.match(expectRule(node({ mesh: mesh([withAcc({ name: 'pos' })]) }), 'mesh').reason, /accessor has a name/)
  assert.match(expectRule(node({ mesh: mesh([withAcc({ extras: { a: 1 } })]) }), 'mesh').reason, /accessor has extras/)
  assert.match(expectRule(node({ mesh: mesh([withAcc({ extensions: 1 })]) }), 'mesh').reason, /accessor has extensions/)
  // the index accessor too
  const p = primitive({ positions: new Array(9).fill(0), indices: [0, 1, 2] })
  const idx = p.getIndices()
  const named = { ...idx, getName: () => 'idx' }
  assert.match(expectRule(node({ mesh: mesh([{ ...p, getIndices: () => named }]) }), 'mesh').reason, /index accessor has a name/)
})

test('rule 7: extensions on the node', () => {
  expectRule(node({ mesh: cubeMesh(), extensions: 1 }), 'extensions')
})

test('rule 8 (review #9): legacy transforms are refused and left unchanged', () => {
  for (const [field, value] of [
    ['rotation', [0, 0, 0, 0.99]],     // |q| = 0.99
    ['rotation', [0, 0, 0, 0]],        // zero
    ['scale', [1, 0, 1]],              // a zero component
  ]) {
    const n = node({ mesh: cubeMesh(), [field]: value })
    const before = JSON.stringify(value)
    expectRule(n, 'transform')
    assert.equal(JSON.stringify(n._n[field]), before, 'source value unchanged')
  }
  // negative scale and a rotation off unit by less than 1e-3 are fine (K6)
  assert.equal(prepareDuplicate(node({ scale: [-1, 1, 1] }), { name: NAME }).ok, true)
  assert.equal(prepareDuplicate(node({ rotation: [0, 0, 0, 1.0005] }), { name: NAME }).ok, true)
})

test('rule 9: a 9 000-vertex primitive with normals is refused by size; 1 000 is fine', () => {
  const big = (count) => {
    const positions = Array.from({ length: count * 3 }, (_, i) => Math.fround(Math.sin(i) * 0.123456789))
    return node({ mesh: mesh([primitive({ positions, normals: positions })]) })
  }
  const r = expectRule(big(9000), 'size')
  assert.match(r.reason, /bytes; the limit is 1,000,000/)
  const ok = prepareDuplicate(big(1000), { name: NAME })
  assert.equal(ok.ok, true)
  assert.ok(ok.bytes < MAX_ADD_BYTES)
})

test('rule 9: the size is counted in UTF-8 bytes, the name included', () => {
  const n = node({ mesh: cubeMesh() })
  const ascii = prepareDuplicate(n, { name: 'a'.repeat(10) })
  const emoji = prepareDuplicate(n, { name: '😀'.repeat(5) })      // 10 UTF-16 units, 20 bytes
  assert.equal(emoji.bytes - ascii.bytes, 10)
  assert.equal(addMessageBytes(ascii.descriptor), ascii.bytes)
})

// ── Eligible copies ─────────────────────────────────────────────────────────

test('a palette-style primitive is eligible; its copy equals it but for name and translation', () => {
  const m = cubeMesh()
  const n = node({ mesh: m, rotation: [0, Math.sin(0.4), 0, Math.cos(0.4)], scale: [2, 1, 1] })
  const r = prepareDuplicate(n, { name: NAME })
  assert.equal(r.ok, true)
  const d = r.descriptor
  assert.equal(d.name, NAME)
  assert.deepStrictEqual(d.translation, [1 + DUPLICATE_OFFSET_X, 0.5, -2])
  assert.deepStrictEqual(d.rotation, n._n.rotation)
  assert.deepStrictEqual(d.scale, [2, 1, 1])
  const p = m.listPrimitives()[0]
  assert.deepStrictEqual(d.mesh.primitives[0].attributes.POSITION, Array.from(p.getAttribute('POSITION').getArray()))
  assert.deepStrictEqual(d.mesh.primitives[0].attributes.NORMAL, Array.from(p.getAttribute('NORMAL').getArray()))
  assert.deepStrictEqual(d.mesh.primitives[0].indices, Array.from(p.getIndices().getArray()))
  assert.deepStrictEqual(d.mesh.primitives[0].material,
    { pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.8 } })
  assert.equal('extras' in d, false, 'empty extras are not sent')
  assert.ok(Array.isArray(d.mesh.primitives[0].attributes.POSITION), 'plain arrays, not typed arrays')
})

test('(review #2) an eligible copy keeps everything the contract promises', () => {
  const n = node({
    mesh: cubeMesh({ meshOpts: { name: 'CrateMesh' } }),
    extras: { __atrium_visible: false, note: { deep: [1, 2] } },
  })
  const d = prepareDuplicate(n, { name: NAME }).descriptor
  assert.equal(d.mesh.name, 'CrateMesh')
  assert.deepStrictEqual(d.extras, { __atrium_visible: false, note: { deep: [1, 2] } })
})

test('a teleporter pad is eligible; its copy keeps the destination as a deep copy', () => {
  const extras = { atrium: { teleporter: { destination: '/worlds/a/b' } } }
  const n = node({ mesh: cubeMesh(), extras })
  const d = prepareDuplicate(n, { name: 'teleporter-x copy' }).descriptor
  assert.deepStrictEqual(d.extras, extras)
  d.extras.atrium.teleporter.destination = '/elsewhere'
  assert.equal(extras.atrium.teleporter.destination, '/worlds/a/b', 'the original is untouched')
})

test('a mesh-less, childless node is eligible and its copy has no mesh', () => {
  const r = prepareDuplicate(node(), { name: NAME })
  assert.equal(r.ok, true)
  assert.equal('mesh' in r.descriptor, false)
})

test('a primitive without NORMAL, indices or material copies just POSITION', () => {
  const r = prepareDuplicate(node({ mesh: mesh([primitive({ positions: new Array(9).fill(1), mat: null })]) }), { name: NAME })
  assert.equal(r.ok, true)
  assert.deepStrictEqual(Object.keys(r.descriptor.mesh.primitives[0]), ['attributes'])
  assert.deepStrictEqual(Object.keys(r.descriptor.mesh.primitives[0].attributes), ['POSITION'])
})

// ── Review #1: values are read at click time ───────────────────────────────

test('(review #1) stale values: the click-time copy has the latest transform and material', () => {
  const mat = material()
  const n = node({ mesh: cubeMesh({ mat }) })
  const first = prepareDuplicate(n, { name: NAME })
  assert.equal(first.ok, true)
  // An own accepted edit changes the SOM; no event reaches this module (I14).
  n._n.translation = [5, 0.5, 5]
  n._n.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2]
  n._n.scale = [3, 3, 3]
  // …and a shared material changed through another node.
  mat._m.baseColor = [1, 0, 0, 1]
  const now = prepareDuplicate(n, { name: NAME })
  assert.deepStrictEqual(now.descriptor.translation, [5 + DUPLICATE_OFFSET_X, 0.5, 5])
  assert.deepStrictEqual(now.descriptor.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2])
  assert.deepStrictEqual(now.descriptor.scale, [3, 3, 3])
  assert.deepStrictEqual(now.descriptor.mesh.primitives[0].material.pbrMetallicRoughness.baseColorFactor, [1, 0, 0, 1])
})

test('(review #1) a node that became ineligible after the first check is refused at click time', () => {
  const n = node({ mesh: cubeMesh() })
  assert.equal(prepareDuplicate(n, { name: NAME }).ok, true)
  n._n.children = [{}]                       // a child was added since
  expectRule(n, 'children')
})

// ── Y2: prepareRestore ──────────────────────────────────────────────────────

function expectRestoreRule(n, rule) {
  const r = prepareRestore(n)
  assert.equal(r.ok, false, `expected refusal by ${rule}`)
  assert.equal(r.rule, rule)
  assert.ok(r.reason.startsWith(DUPLICATE_REASONS[rule]), r.reason)
  return r
}

test('Y2: restore equals the copy but for the name and the translation, bit for bit', () => {
  const n = node({ mesh: cubeMesh(), extras: { __atrium_visible: false } })
  const copy = prepareDuplicate(n, { name: 'Cube copy' })
  const restore = prepareRestore(n)
  assert.equal(restore.ok, true)
  assert.equal(restore.descriptor.name, 'Cube', 'the node’s own name')
  assert.deepStrictEqual(restore.descriptor.translation, n._n.translation, 'its own translation')
  // everything else is exactly the copy’s
  assert.deepStrictEqual(
    { ...restore.descriptor, name: null, translation: null },
    { ...copy.descriptor, name: null, translation: null })
  assert.equal(restore.descriptor.mesh.primitives[0].material.roughnessFactor,
    copy.descriptor.mesh.primitives[0].material.roughnessFactor)
})

test('Y2 (U5): an X the offset round-trip cannot reproduce is kept bit for bit', () => {
  // 0.1 + 1.5 − 1.5 !== 0.1: a restore must never apply and subtract the offset.
  assert.notEqual(0.1 + DUPLICATE_OFFSET_X - DUPLICATE_OFFSET_X, 0.1)
  const n = node({ translation: [0.1, 0.5, -2] })
  const restore = prepareRestore(n)
  assert.deepStrictEqual(restore.descriptor.translation, [0.1, 0.5, -2])
  assert.notDeepStrictEqual(restore.descriptor.translation,
    [0.1 + DUPLICATE_OFFSET_X - DUPLICATE_OFFSET_X, 0.5, -2])
  // the copy still applies the offset
  assert.deepStrictEqual(prepareDuplicate(n, { name: NAME }).descriptor.translation,
    [0.1 + DUPLICATE_OFFSET_X, 0.5, -2])
})

test('Y2: every one of N3’s rules 1–9 refuses a restore too', () => {
  const m = cubeMesh()
  expectRestoreRule(node({ mesh: m, children: [{}] }), 'children')
  expectRestoreRule(node({ mesh: m, parents: ['Root', 'Node'] }), 'parent')
  expectRestoreRule(node({ camera: {} }), 'attached')
  expectRestoreRule(node({ mesh: m, parents: ['Root', 'Scene', 'AnimationChannel'] }), 'referenced')
  expectRestoreRule(node({ extras: { atrium: { source: null } } }), 'external')
  expectRestoreRule(node({ extras: { atrium: { teleporter: 'x' } } }), 'atrium')
  expectRestoreRule(node({ mesh: cubeMesh({ meshOpts: { extras: { lod: 0 } } }) }), 'mesh')
  expectRestoreRule(node({ mesh: m, extensions: 1 }), 'extensions')
  expectRestoreRule(node({ mesh: m, rotation: [0, 0, 0, 0.99] }), 'transform')
  expectRestoreRule(node({ mesh: m, scale: [1, 0, 1] }), 'transform')
  const zeros = new Float32Array(600_000)
  expectRestoreRule(node({ mesh: mesh([primitive({ attrs: { POSITION: accessor(zeros) } })]) }), 'size')
})

test('Y2: two restores of an unchanged node are equal; one changed number makes them differ', () => {
  const n = node({ mesh: cubeMesh({ meshOpts: { name: 'CrateMesh' } }), extras: { __atrium_visible: false } })
  const a = prepareRestore(n).descriptor
  const b = prepareRestore(n).descriptor
  assert.deepStrictEqual(a, b, 'the canonical form is deterministic, key order included')
  assert.deepStrictEqual(Object.keys(a), Object.keys(b))
  // every one of these is a number (or name) the comparison must see
  n._n.translation = [99, 0.5, -2]
  assert.notDeepStrictEqual(prepareRestore(n).descriptor, a)
  const c = prepareRestore(n).descriptor
  n._n.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2]
  assert.notDeepStrictEqual(prepareRestore(n).descriptor, c)
  const d = prepareRestore(n).descriptor
  n._n.scale = [1, 1, 1.0000001]
  assert.notDeepStrictEqual(prepareRestore(n).descriptor, d)
  const e = prepareRestore(n).descriptor
  n._n.extras = { __atrium_visible: true }
  assert.notDeepStrictEqual(prepareRestore(n).descriptor, e)
  const f = prepareRestore(n).descriptor
  n._n.name = 'Crate'
  assert.notDeepStrictEqual(prepareRestore(n).descriptor, f)
})

test('Y2: the restore descriptor is a fresh object: changing it never reaches the node', () => {
  const n = node({ mesh: cubeMesh() })
  const d = prepareRestore(n).descriptor
  d.translation[0] = 42
  d.rotation[3] = 0
  d.mesh.primitives[0].attributes.POSITION[0] = 99
  assert.deepStrictEqual(n._n.translation, [1, 0.5, -2])
  assert.deepStrictEqual(n._n.rotation, [0, 0, 0, 1])
})

test('the copy is a fresh object: changing it never reaches the source', () => {
  const n = node({ mesh: cubeMesh() })
  const d = prepareDuplicate(n, { name: NAME }).descriptor
  d.rotation[3] = 0
  d.scale[0] = 9
  assert.deepStrictEqual(n._n.rotation, [0, 0, 0, 1])
  assert.deepStrictEqual(n._n.scale, [1, 1, 1])
})
