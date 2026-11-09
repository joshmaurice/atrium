// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// part-transform.test.js — selection-parts T11 (PREBRIEF-selection-parts.md
// §4): a part's world placement baked into a TRS for Copy, the shear refusal,
// and the parent-frame offset for Duplicate in place (SP-L4 (b)). The
// matrices are the real world-matrix.js's.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { localMatrix, worldMatrix } from '@atrium/som'
import {
  multiply, linear, inverse3, apply3, decomposeTRS, partWorldTRS, parentFrameOffset, SHEAR_TOLERANCE,
} from '../src/part-transform.js'

const close = (a, b, eps, what) => {
  assert.equal(a.length, b.length)
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps, `${what}[${i}]: ${a[i]} vs ${b[i]}`)
}
const quatY = (deg) => { const h = deg * Math.PI / 360; return [0, Math.sin(h), 0, Math.cos(h)] }
const quatZ = (deg) => { const h = deg * Math.PI / 360; return [0, 0, Math.sin(h), Math.cos(h)] }
const sameRotation = (a, b, eps) => {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
  assert.ok(Math.abs(dot - 1) <= eps, `rotations differ: ${a} vs ${b}`)
}
/** A SOM-like chain: parent → part. */
const chain = (parentTRS, partTRS) => {
  const parent = { ...parentTRS, parent: null }
  const part = { ...partTRS, parent }
  return { parent, part }
}

describe('T11: matrix helpers', () => {
  test('multiply by the identity, linear, inverse3 and apply3', () => {
    const m = localMatrix({ translation: [1, 2, 3], rotation: quatY(30), scale: [2, 3, 4] })
    const I = localMatrix({})
    close(multiply(I, m), m, 1e-15, 'I×m')
    const l = linear(m)
    const back = multiply3(inverse3(l), l)
    close(back, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-12, 'inverse3(l)×l')
    close(apply3([2, 0, 0, 0, 3, 0, 0, 0, 4], [1, 1, 1]), [2, 3, 4], 0, 'apply3')
  })
})

function multiply3(a, b) {
  const out = new Array(9)
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]
  return out
}

describe('T11: decomposeTRS', () => {
  const cases = [
    { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    { translation: [3, -1, 2], rotation: quatY(90), scale: [2, 2, 2] },
    { translation: [1e4, 0, -5], rotation: quatZ(-37), scale: [0.5, 3, 0.25] },
    { translation: [0, 1.6, 0], rotation: [0.2, 0.5, -0.3, Math.sqrt(1 - 0.04 - 0.25 - 0.09)], scale: [1, 1, 1] },
  ]
  for (const trs of cases) {
    test(`returns the TRS it was composed from: ${JSON.stringify(trs.scale)}`, () => {
      const d = decomposeTRS(localMatrix(trs))
      close(d.translation, trs.translation, 1e-9, 'translation')
      close(d.scale, trs.scale, 1e-12, 'scale')
      sameRotation(d.rotation, trs.rotation, 1e-12)
    })
  }
  test('a mirrored matrix (determinant < 0) negates the x scale and recomposes exactly', () => {
    const m = localMatrix({ translation: [1, 2, 3], rotation: quatY(30), scale: [-1, 1, 1] })
    const d = decomposeTRS(m)
    assert.ok(d.scale[0] < 0)
    close(localMatrix(d), m, 1e-12, 'recomposed')
    const m2 = localMatrix({ translation: [0, 0, 0], rotation: quatZ(50), scale: [1, -1, 1] })
    close(localMatrix(decomposeTRS(m2)), m2, 1e-12, 'recomposed (y mirrored)')
  })
})

describe('T11: partWorldTRS, the Copy of a part', () => {
  test('a part of a group moved, rotated 90° about y and scaled 2: the TRS composes to the part’s world matrix', () => {
    const { parent, part } = chain(
      { translation: [3, 0, 0], rotation: quatY(90), scale: [2, 2, 2] },
      { translation: [0, 1.6, 0], rotation: quatZ(10), scale: [1, 1, 1] })
    const r = partWorldTRS(worldMatrix(parent), part)
    assert.equal(r.ok, true, r.reason)
    close(localMatrix(r.trs), worldMatrix(part), 1e-5, 'world')
    close(r.trs.translation, [3, 3.2, 0], 1e-12, 'the part’s world position')
  })
  test('a mirrored group ([-1, 1, 1]) is carried, not refused', () => {
    const { parent, part } = chain(
      { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [-1, 1, 1] },
      { translation: [1, 1, 0], rotation: quatY(20), scale: [1, 1, 1] })
    const r = partWorldTRS(worldMatrix(parent), part)
    assert.equal(r.ok, true, r.reason)
    close(localMatrix(r.trs), worldMatrix(part), 1e-5, 'world')
  })
  test('a rotation BELOW a non-uniform scale is a shear: refused', () => {
    const { parent, part } = chain(
      { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 1, 1] },
      { translation: [0, 0, 0], rotation: quatZ(45), scale: [1, 1, 1] })
    const r = partWorldTRS(worldMatrix(parent), part)
    assert.equal(r.ok, false)
    assert.equal(r.rule, 'shear')
  })
  test('a non-uniform scale with no rotation below it, or exactly 90°, is no shear', () => {
    const a = chain({ scale: [2, 1, 1] }, { translation: [1, 0, 0] })
    assert.equal(partWorldTRS(worldMatrix(a.parent), a.part).ok, true)
    const b = chain({ scale: [2, 1, 1] }, { rotation: quatZ(90) })
    assert.equal(partWorldTRS(worldMatrix(b.parent), b.part).ok, true)
  })
  test(`the tolerance is relative (${SHEAR_TOLERANCE} of the column): a 1% shear at scale 1e-3 is refused`, () => {
    const { parent, part } = chain(
      { scale: [1.01e-3, 1e-3, 1e-3] },
      { rotation: quatZ(45) })
    assert.equal(partWorldTRS(worldMatrix(parent), part).ok, false)
  })
})

describe('T11: parentFrameOffset, Duplicate in place (SP-L4 (b))', () => {
  const parents = [
    { translation: [3, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    { translation: [3, 0, 0], rotation: quatY(90), scale: [2, 2, 2] },
    { translation: [0, 0, 0], rotation: quatZ(30), scale: [-1, 1, 1] },
    { translation: [0, 0, 0], rotation: quatY(45), scale: [1000, 1000, 1000] },
  ]
  for (const p of parents) {
    test(`the copy lands 1.5 m along world x: parent ${JSON.stringify(p.scale)}`, () => {
      const parent = { ...p, parent: null }
      const off = parentFrameOffset(worldMatrix(parent))
      const part = { translation: [0, 1.6, 0], parent }
      const copy = { translation: [0 + off[0], 1.6 + off[1], 0 + off[2]], parent }
      const a = worldMatrix(part); const b = worldMatrix(copy)
      close([b[12] - a[12], b[13] - a[13], b[14] - a[14]], [1.5, 0, 0], 1e-9, 'world delta')
    })
  }
  test('a unit, unrotated parent gives today’s [1.5, 0, 0]', () => {
    close(parentFrameOffset(worldMatrix({ translation: [3, 0, 0], parent: null })), [1.5, 0, 0], 0, 'offset')
  })
})
