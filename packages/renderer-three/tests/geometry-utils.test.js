// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// THREE geometry classes (BufferGeometry, PlaneGeometry, CapsuleGeometry)
// work fine in Node.js and are used directly — no renderer required.

import { test } from 'node:test'
import assert   from 'node:assert/strict'
import * as THREE from 'three'
import {
  threeGeometryToGltfPrimitive, buildAvatarDescriptor, buildTeleporterDescriptor,
  buildPrimitiveDescriptor, addBackFace,
} from '../src/geometry-utils.js'

function vertex(arr, i, size = 3) { return [arr[i * size], arr[i * size + 1], arr[i * size + 2]] }

// ---------------------------------------------------------------------------
// 1. threeGeometryToGltfPrimitive — extracts position/normal/index arrays
// ---------------------------------------------------------------------------

test('threeGeometryToGltfPrimitive: extracts POSITION, NORMAL, indices from PlaneGeometry', () => {
  // PlaneGeometry(1,1): 4 vertices, 2 triangles → 12 positions, 12 normals, 6 indices
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }
  const prim = threeGeometryToGltfPrimitive(geo, mat)

  assert.ok(Array.isArray(prim.attributes.POSITION), 'POSITION is Array')
  assert.ok(Array.isArray(prim.attributes.NORMAL),   'NORMAL is Array')
  assert.ok(Array.isArray(prim.indices),             'indices is Array')

  assert.strictEqual(prim.attributes.POSITION.length, 12, '4 verts × 3 = 12 positions')
  assert.strictEqual(prim.attributes.NORMAL.length,   12, '4 verts × 3 = 12 normals')
  assert.strictEqual(prim.indices.length,              6, '2 tris × 3 = 6 indices')
})

// ---------------------------------------------------------------------------
// 2. threeGeometryToGltfPrimitive — disposes the input geometry
// ---------------------------------------------------------------------------

test('threeGeometryToGltfPrimitive: calls geometry.dispose() exactly once', () => {
  const geo = new THREE.PlaneGeometry(1, 1)
  let disposeCalls = 0
  const origDispose = geo.dispose.bind(geo)
  geo.dispose = () => { disposeCalls++; origDispose() }

  threeGeometryToGltfPrimitive(geo, {})

  assert.strictEqual(disposeCalls, 1, 'dispose called exactly once')
})

// ---------------------------------------------------------------------------
// 3. threeGeometryToGltfPrimitive — passes material through unchanged
// ---------------------------------------------------------------------------

test('threeGeometryToGltfPrimitive: material reference is passed through unchanged', () => {
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = { pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } }
  const prim = threeGeometryToGltfPrimitive(geo, mat)

  assert.strictEqual(prim.material, mat, 'material === same reference')
})

// ---------------------------------------------------------------------------
// 4. buildAvatarDescriptor — returns expected shape
// ---------------------------------------------------------------------------

test('buildAvatarDescriptor: returns correct top-level shape', () => {
  const desc = buildAvatarDescriptor('Alice')

  assert.deepEqual(desc.translation, [0, 0.7, 0], 'translation = [0, 0.7, 0]')
  assert.strictEqual(desc.extras.displayName, 'Alice', 'extras.displayName = "Alice"')

  const prim = desc.mesh?.primitives?.[0]
  assert.ok(prim, 'mesh.primitives[0] exists')

  assert.ok(Array.isArray(prim.attributes.POSITION), 'POSITION is Array')
  assert.ok(Array.isArray(prim.attributes.NORMAL),   'NORMAL is Array')
  assert.ok(Array.isArray(prim.indices),             'indices is Array')

  const pbr = prim.material?.pbrMetallicRoughness
  assert.ok(pbr, 'pbrMetallicRoughness present')
  assert.ok(Array.isArray(pbr.baseColorFactor), 'baseColorFactor is Array')
  assert.strictEqual(typeof pbr.metallicFactor,  'number', 'metallicFactor is number')
  assert.strictEqual(typeof pbr.roughnessFactor, 'number', 'roughnessFactor is number')
})

// ---------------------------------------------------------------------------
// 5. buildAvatarDescriptor — produces a different color each call
// ---------------------------------------------------------------------------

test('buildAvatarDescriptor: baseColorFactor differs between two calls', () => {
  const a = buildAvatarDescriptor('A')
  const b = buildAvatarDescriptor('B')
  const colorA = a.mesh.primitives[0].material.pbrMetallicRoughness.baseColorFactor
  const colorB = b.mesh.primitives[0].material.pbrMetallicRoughness.baseColorFactor

  // Probability of exact match across 3 independent channels: negligible
  const same = colorA[0] === colorB[0] && colorA[1] === colorB[1] && colorA[2] === colorB[2]
  assert.ok(!same, 'baseColorFactor differs between two descriptor calls')
})

// ---------------------------------------------------------------------------
// 6. buildAvatarDescriptor — color channels in [0.5, 1.0]; alpha = 1
// ---------------------------------------------------------------------------

test('buildAvatarDescriptor: color channels in [0.5, 1.0] and alpha = 1', () => {
  const desc = buildAvatarDescriptor('Bob')
  const color = desc.mesh.primitives[0].material.pbrMetallicRoughness.baseColorFactor

  for (let i = 0; i < 3; i++) {
    assert.ok(color[i] >= 0.5 && color[i] <= 1.0, `channel ${i} in [0.5, 1.0]`)
  }
  assert.strictEqual(color[3], 1, 'alpha = 1')
})

// ---------------------------------------------------------------------------
// 7. buildAvatarDescriptor — top-level `name` field is absent
// ---------------------------------------------------------------------------

test('buildAvatarDescriptor: top-level name field is undefined (intentional omission)', () => {
  const desc = buildAvatarDescriptor('Carol')
  assert.strictEqual(desc.name, undefined, 'name field absent from descriptor')
})

// ---------------------------------------------------------------------------
// 8. buildTeleporterDescriptor — ring vertices clear the grey floor box
// ---------------------------------------------------------------------------

test('buildTeleporterDescriptor: every ring vertex has y > 0.025 (clears grey floor box)', () => {
  const desc = buildTeleporterDescriptor({
    name: 'teleporter-test',
    position: [1, 0, 2],
    destination: 'ws://example/worlds/u/home',
  })
  const prim = desc.mesh?.primitives?.[0]
  assert.ok(prim, 'mesh.primitives[0] exists')
  const positions = prim.attributes.POSITION
  assert.ok(Array.isArray(positions), 'POSITION is Array')
  // Every 3 values is one vertex [x, y, z]
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]
    assert.ok(y > 0.025, `vertex y=${y} at index ${i} is NOT > 0.025`)
  }
})

// ---------------------------------------------------------------------------
// 9. addBackFace — Z1. Two-triangle fixture carrying position, normal and uv.
// ---------------------------------------------------------------------------

/** A 4-vertex, 2-triangle square in the xy plane, facing +Z, with UVs. */
function fixture() {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
  ], 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ], 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,  1, 0,  1, 1,  0, 1,
  ], 2))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  return geo
}

test('addBackFace: doubles EVERY attribute, and every attribute keeps the same count', () => {
  const geo = addBackFace(fixture())
  for (const name of Object.keys(geo.attributes)) {
    assert.equal(geo.attributes[name].count, 8, `${name} has 8 vertices`)
  }
  assert.equal(geo.attributes.position.count, geo.attributes.normal.count)
  assert.equal(geo.attributes.normal.count, geo.attributes.uv.count)
})

test('addBackFace: every index stays inside the new vertex count', () => {
  const geo = addBackFace(fixture())
  const count = geo.attributes.position.count
  assert.equal(count, 8)
  for (const i of geo.index.array) {
    assert.ok(Number.isInteger(i) && i >= 0 && i < count, `index ${i} in range`)
  }
})

test('addBackFace: the copies repeat positions and UVs, negate normals only', () => {
  const geo = addBackFace(fixture())
  const pos = geo.attributes.position.array
  const nrm = geo.attributes.normal.array
  const uv  = geo.attributes.uv.array
  for (let i = 0; i < 4; i++) {
    assert.deepStrictEqual(vertex(pos, 4 + i), vertex(pos, i), `position ${i} copied`)
    assert.deepStrictEqual(vertex(nrm, 4 + i), vertex(nrm, i).map(v => -v), `normal ${i} negated`)
    // uv has 2 components per vertex; compare the pair
    assert.deepStrictEqual([uv[8 + 2 * i], uv[8 + 2 * i + 1]], [uv[2 * i], uv[2 * i + 1]], `uv ${i} copied`)
  }
})

test('addBackFace: every appended triangle reverses its original and winds with its normal', () => {
  const geo = addBackFace(fixture())
  const pos = geo.attributes.position.array
  const nrm = geo.attributes.normal.array
  const idx = Array.from(geo.index.array)
  // 2 originals + their 2 mirrored copies
  assert.deepStrictEqual(idx, [0, 1, 2, 0, 2, 3, 6, 5, 4, 7, 6, 4])
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map(i => vertex(pos, i))
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const wound = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const n = vertex(nrm, idx[t])
    const dot = wound[0] * n[0] + wound[1] * n[1] + wound[2] * n[2]
    assert.ok(dot > 0, `triangle ${t / 3} winds against its normal`)
  }
})

test('addBackFace: returns the same geometry, and leaves the real plane and ring consistent', () => {
  const f = fixture()
  assert.strictEqual(addBackFace(f), f, 'returns the input geometry')

  const plane = new THREE.PlaneGeometry(2, 2)
  plane.rotateX(-Math.PI / 2)
  const names = Object.keys(plane.attributes)
  addBackFace(plane)
  assert.deepStrictEqual(Object.keys(plane.attributes), names, 'no attribute is added or lost')
  for (const name of names) {
    assert.equal(plane.attributes[name].count, 8, `plane ${name} doubled (uv included)`)
  }

  const ring = new THREE.RingGeometry(0.45, 0.75, 48, 1)
  ring.rotateX(-Math.PI / 2)
  ring.translate(0, 0.05, 0)
  const ringNames = Object.keys(ring.attributes)
  addBackFace(ring)
  assert.deepStrictEqual(Object.keys(ring.attributes), ringNames)
  for (const name of ringNames) {
    assert.equal(ring.attributes[name].count, 196, `ring ${name} doubled (uv included)`)
  }
})

// ---------------------------------------------------------------------------
// 9b. addBackFace — Z2. It refuses what it cannot do, and changes nothing.
// ---------------------------------------------------------------------------

/** The same square as `fixture()`, with no index, plus a copy of every attribute. */
function nonIndexedFixture() {
  const geo = fixture()
  const snapshot = {}
  for (const name of Object.keys(geo.attributes)) snapshot[name] = Array.from(geo.attributes[name].array)
  geo.setIndex(null)
  return { geo, snapshot }
}

test('addBackFace: a non-indexed geometry throws, and is left untouched', () => {
  const { geo, snapshot } = nonIndexedFixture()
  const names = Object.keys(geo.attributes)
  const counts = names.map((n) => geo.attributes[n].count)

  assert.throws(() => addBackFace(geo), /no index/, 'a geometry with no index is refused')

  assert.deepStrictEqual(Object.keys(geo.attributes), names, 'no attribute is added or lost')
  assert.deepStrictEqual(names.map((n) => geo.attributes[n].count), counts, 'no attribute is doubled')
  for (const name of names) {
    assert.deepStrictEqual(Array.from(geo.attributes[name].array), snapshot[name], `${name} is unchanged`)
  }
  assert.equal(geo.index, null, 'it is still non-indexed')
})

test('addBackFace: a bare geometry (no attributes, no index) is refused too', () => {
  assert.throws(() => addBackFace(new THREE.BufferGeometry()), /no index/)
})

test('addBackFace: an interleaved attribute throws, and is left untouched', () => {
  const geo = fixture()
  const uv = geo.attributes.uv
  const buffer = new THREE.InterleavedBuffer(new Float32Array(uv.array), 2)
  geo.setAttribute('uv', new THREE.InterleavedBufferAttribute(buffer, 2, 0, false))
  const position = Array.from(geo.attributes.position.array)
  const normal   = Array.from(geo.attributes.normal.array)
  const indices  = Array.from(geo.index.array)

  assert.throws(() => addBackFace(geo), /interleaved/, 'an interleaved attribute is refused')

  assert.equal(geo.attributes.position.count, 4, 'positions are not doubled')
  assert.deepStrictEqual(Array.from(geo.attributes.position.array), position)
  assert.deepStrictEqual(Array.from(geo.attributes.normal.array), normal)
  assert.deepStrictEqual(Array.from(geo.index.array), indices)
  assert.ok(geo.attributes.uv.isInterleavedBufferAttribute, 'the interleaved attribute is still the one set')
})

test('addBackFace: the real plane and ring are indexed and non-interleaved, so both are accepted', () => {
  const plane = new THREE.PlaneGeometry(2, 2)
  plane.rotateX(-Math.PI / 2)
  assert.ok(plane.index, 'the plane is indexed')
  assert.doesNotThrow(() => addBackFace(plane))

  const ring = new THREE.RingGeometry(0.45, 0.75, 48, 1)
  ring.rotateX(-Math.PI / 2)
  ring.translate(0, 0.05, 0)
  assert.ok(ring.index, 'the ring is indexed')
  assert.doesNotThrow(() => addBackFace(ring))
})

// ---------------------------------------------------------------------------
// 10. The teleporter pad's back face — Z3
// ---------------------------------------------------------------------------

const PAD = { name: 'teleporter-test', position: [1, 0, 2], destination: 'ws://example/worlds/u/home' }

test('buildTeleporterDescriptor: the pad has a top face and a back face (196 vertices, 192 triangles)', () => {
  const p = buildTeleporterDescriptor(PAD).mesh.primitives[0]
  assert.equal(p.attributes.POSITION.length / 3, 196, '196 vertices')
  assert.equal(p.indices.length / 3, 192, '192 triangles')
})

test('buildTeleporterDescriptor: half the normals +Y, half −Y, and each triangle winds with its normal', () => {
  const p = buildTeleporterDescriptor(PAD).mesh.primitives[0]
  const pos = p.attributes.POSITION, nrm = p.attributes.NORMAL
  let up = 0, down = 0
  for (let i = 0; i < nrm.length / 3; i++) {
    const n = vertex(nrm, i)
    assert.ok(Math.abs(Math.abs(n[1]) - 1) < 1e-6, `normal ${n} is not ±Y`)
    if (n[1] > 0) up++; else down++
  }
  assert.equal(up, 98, '98 normals +Y')
  assert.equal(down, 98, '98 normals −Y')
  for (let t = 0; t < p.indices.length; t += 3) {
    const [a, b, c] = [p.indices[t], p.indices[t + 1], p.indices[t + 2]].map(i => vertex(pos, i))
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const wound = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const n = vertex(nrm, p.indices[t])
    assert.ok(wound[0] * n[0] + wound[1] * n[1] + wound[2] * n[2] > 0, `triangle ${t / 3} winds against its normal`)
  }
})

test('buildTeleporterDescriptor: translation, extras and the material are unchanged', () => {
  const desc = buildTeleporterDescriptor(PAD)
  assert.deepStrictEqual(desc.translation, [1, 0, 2], 'y is still forced to 0')
  assert.deepStrictEqual(desc.extras, { atrium: { teleporter: { destination: PAD.destination } } })
  assert.deepStrictEqual(desc.mesh.primitives[0].material, {
    pbrMetallicRoughness: { baseColorFactor: [0.2, 0.9, 0.8, 1.0], metallicFactor: 0.0, roughnessFactor: 0.5 },
  })
})

test('size and restore limits: the new plane and pad stay inside the Duplicate and add rules', () => {
  const descriptors = [
    ['plane', buildPrimitiveDescriptor({ kind: 'plane', name: 'p', position: [0, 0, 0] })],
    ['pad',   buildTeleporterDescriptor(PAD)],
  ]
  for (const [label, desc] of descriptors) {
    const p = desc.mesh.primitives[0]
    assert.deepStrictEqual(Object.keys(p.attributes).sort(), ['NORMAL', 'POSITION'], `${label}: POSITION/NORMAL only`)
    for (const i of p.indices) assert.ok(i <= 65535, `${label}: index ${i} ≤ 65535`)
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'add', seq: 1, node: desc })).length
    assert.ok(bytes < 1_000_000, `${label}: add message is ${bytes} bytes`)
  }
})
