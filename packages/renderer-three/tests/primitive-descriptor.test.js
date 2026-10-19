// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Phase 3 step 1b-2, N1 / J2 — the Edit-mode palette primitives.
// devtasks/PREBRIEF-edit-mode-ui-1b-2.md §7.1

import { test } from 'node:test'
import assert   from 'node:assert/strict'
import {
  buildPrimitiveDescriptor, PRIMITIVE_KINDS, PRIMITIVE_REST_Y, PRIMITIVE_MATERIAL,
} from '../src/geometry-utils.js'

const GROUND = [3, 0, -2]

function prim(desc) { return desc.mesh.primitives[0] }

function vertex(arr, i) { return [arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]] }

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(u, v) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] }
function dot(u, v) { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2] }

test('PRIMITIVE_KINDS: the five palette kinds, in palette order', () => {
  assert.deepStrictEqual([...PRIMITIVE_KINDS], ['cube', 'plane', 'sphere', 'cylinder', 'ramp'])
})

for (const kind of ['cube', 'plane', 'sphere', 'cylinder', 'ramp']) {
  test(`${kind}: indexed, POSITION/NORMAL only, indices in range, unit normals`, () => {
    const d = buildPrimitiveDescriptor({ kind, name: 'x', position: GROUND })
    const p = prim(d)
    assert.deepStrictEqual(Object.keys(p.attributes).sort(), ['NORMAL', 'POSITION'])
    const pos = p.attributes.POSITION, nrm = p.attributes.NORMAL
    assert.equal(pos.length % 3, 0)
    assert.equal(pos.length, nrm.length)
    assert.ok(Array.isArray(p.indices) && p.indices.length > 0 && p.indices.length % 3 === 0)
    const count = pos.length / 3
    for (const i of p.indices) assert.ok(Number.isInteger(i) && i >= 0 && i < count, `index ${i} in range`)
    for (let i = 0; i < count; i++) {
      const len = Math.hypot(...vertex(nrm, i))
      assert.ok(Math.abs(len - 1) <= 1e-5, `normal ${i} has length ${len}`)
    }
  })

  test(`${kind}: rests on the ground point (lowest vertex at its Y, plane +1 cm)`, () => {
    const d = buildPrimitiveDescriptor({ kind, name: 'x', position: GROUND })
    const pos = prim(d).attributes.POSITION
    let minY = Infinity
    for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i])
    const expectedMin = { cube: -0.5, sphere: -0.5, cylinder: -0.5, ramp: 0, plane: 0 }[kind]
    assert.ok(Math.abs(minY - expectedMin) < 1e-6, `local min Y ${minY}`)
    assert.ok(Math.abs(d.translation[1] - PRIMITIVE_REST_Y[kind]) < 1e-12)
    const worldLowest = d.translation[1] + minY
    assert.ok(Math.abs(worldLowest - (kind === 'plane' ? 0.01 : 0)) < 1e-6, `world lowest ${worldLowest}`)
    assert.equal(d.translation[0], GROUND[0])
    assert.equal(d.translation[2], GROUND[2])
  })

  test(`${kind}: whole add message under 100 000 bytes`, () => {
    const d = buildPrimitiveDescriptor({ kind, name: 'Cylinder 99', position: GROUND })
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'add', seq: 1, node: d })).length
    assert.ok(bytes < 100_000, `${bytes} bytes`)
  })
}

test('ramp: every face is wound outward (normal points away from the centroid)', () => {
  const p = prim(buildPrimitiveDescriptor({ kind: 'ramp', name: 'r', position: [0, 0, 0] }))
  const pos = p.attributes.POSITION, nrm = p.attributes.NORMAL
  const count = pos.length / 3
  const c = [0, 0, 0]
  for (let i = 0; i < count; i++) { const v = vertex(pos, i); c[0] += v[0]; c[1] += v[1]; c[2] += v[2] }
  c[0] /= count; c[1] /= count; c[2] /= count
  for (let t = 0; t < p.indices.length; t += 3) {
    const [a, b, d] = [p.indices[t], p.indices[t + 1], p.indices[t + 2]].map(i => vertex(pos, i))
    const wound = cross(sub(b, a), sub(d, a))
    const mid = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3]
    assert.ok(dot(wound, sub(mid, c)) > 0, `triangle ${t / 3} winds inward`)
    // the stored normal agrees with the winding
    assert.ok(dot(wound, vertex(nrm, p.indices[t])) > 0, `triangle ${t / 3} normal disagrees with winding`)
  }
})

test('ramp: rises toward −Z, 1 m wide, 1 m deep, 0.5 m high', () => {
  const pos = prim(buildPrimitiveDescriptor({ kind: 'ramp', name: 'r', position: [0, 0, 0] })).attributes.POSITION
  const vs = []
  for (let i = 0; i < pos.length / 3; i++) vs.push(vertex(pos, i))
  const span = (k) => Math.max(...vs.map(v => v[k])) - Math.min(...vs.map(v => v[k]))
  assert.ok(Math.abs(span(0) - 1) < 1e-6 && Math.abs(span(1) - 0.5) < 1e-6 && Math.abs(span(2) - 1) < 1e-6)
  const top = vs.filter(v => v[1] > 0.49)
  assert.ok(top.length > 0 && top.every(v => v[2] < -0.49), 'the high edge is at −Z')
})

test('plane: has a top face and a back face (8 vertices, 4 triangles)', () => {
  const p = prim(buildPrimitiveDescriptor({ kind: 'plane', name: 'p', position: [0, 0, 0] }))
  assert.equal(p.attributes.POSITION.length / 3, 8, '8 vertices')
  assert.equal(p.indices.length / 3, 4, '4 triangles')
})

test('plane: lies flat, facing +Y on the top face and −Y on the back face', () => {
  const p = prim(buildPrimitiveDescriptor({ kind: 'plane', name: 'p', position: [0, 0, 0] }))
  for (let i = 1; i < p.attributes.POSITION.length; i += 3) assert.ok(Math.abs(p.attributes.POSITION[i]) < 1e-9)
  let up = 0, down = 0
  for (let i = 0; i < p.attributes.NORMAL.length / 3; i++) {
    const n = vertex(p.attributes.NORMAL, i)
    assert.ok(Math.abs(n[0]) < 1e-6 && Math.abs(n[2]) < 1e-6, `normal ${n} is not ±Y`)
    assert.ok(Math.abs(Math.abs(n[1]) - 1) < 1e-6, `normal ${n} is not ±Y`)
    if (n[1] > 0) up++; else down++
  }
  assert.equal(up, 4, '4 normals +Y')
  assert.equal(down, 4, '4 normals −Y')
})

test('plane: each triangle winds the way its normal faces, on both faces', () => {
  // The back face is visible only if the appended triangles are reversed:
  // an unreversed copy would be culled from below as well (Z1, pre-brief §8).
  const p = prim(buildPrimitiveDescriptor({ kind: 'plane', name: 'p', position: [0, 0, 0] }))
  const pos = p.attributes.POSITION, nrm = p.attributes.NORMAL
  for (let t = 0; t < p.indices.length; t += 3) {
    const [a, b, c] = [p.indices[t], p.indices[t + 1], p.indices[t + 2]].map(i => vertex(pos, i))
    const wound = cross(sub(b, a), sub(c, a))
    assert.ok(dot(wound, vertex(nrm, p.indices[t])) > 0, `triangle ${t / 3} normal disagrees with its winding`)
  }
})

test('plane: spans 2 m × 2 m and rests on the ground point 1 cm up', () => {
  const d = buildPrimitiveDescriptor({ kind: 'plane', name: 'p', position: GROUND })
  const pos = prim(d).attributes.POSITION
  const vs = []
  for (let i = 0; i < pos.length / 3; i++) vs.push(vertex(pos, i))
  const span = (k) => Math.max(...vs.map(v => v[k])) - Math.min(...vs.map(v => v[k]))
  assert.ok(Math.abs(span(0) - 2) < 1e-6, `x span ${span(0)}`)
  assert.ok(Math.abs(span(2) - 2) < 1e-6, `z span ${span(2)}`)
  assert.equal(d.translation[1], PRIMITIVE_REST_Y.plane, 'the node is lifted by PRIMITIVE_REST_Y.plane')
})

test('descriptor: name, rotation copied, no extras, default material per primitive', () => {
  const q = [0, Math.sin(0.3), 0, Math.cos(0.3)]
  const d = buildPrimitiveDescriptor({ kind: 'cube', name: 'Cube 2', position: [0, 0, 0], rotation: q })
  assert.equal(d.name, 'Cube 2')
  assert.deepStrictEqual(d.rotation, q)
  assert.notStrictEqual(d.rotation, q, 'rotation is copied, not shared')
  assert.equal(d.extras, undefined)
  const m = prim(d).material
  assert.deepStrictEqual(m, {
    pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.8 },
  })
  // each descriptor gets its own material object (the shared constant stays frozen)
  m.pbrMetallicRoughness.baseColorFactor[0] = 0
  assert.equal(PRIMITIVE_MATERIAL.pbrMetallicRoughness.baseColorFactor[0], 0.8)
})

test('descriptor: no rotation key when none is given', () => {
  const d = buildPrimitiveDescriptor({ kind: 'sphere', name: 's', position: [0, 0, 0] })
  assert.equal('rotation' in d, false)
})

test('descriptor: an unknown kind throws', () => {
  assert.throws(() => buildPrimitiveDescriptor({ kind: 'torus', name: 't', position: [0, 0, 0] }), /unknown primitive kind/)
})
