// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// rotation-degrees.test.js — the property panel shows rotation in degrees
// (Euler XYZ, three.js's default order) and sends quaternions (Phase 3 step
// 1b-1, B5).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { quatToEulerDeg, eulerDegToQuat, normalizeQuat } from '../src/rotation-degrees.js'

const S = Math.SQRT1_2

function close(actual, expected, eps = 1e-7) {
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < eps, `[${actual}] vs [${expected}]`)
  }
}

// q and -q are the same rotation.
function sameRotation(a, b) {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
  assert.ok(Math.abs(dot - 1) < 1e-9, `[${a}] vs [${b}]`)
}

describe('rotation-degrees', () => {
  test('identity ↔ 0, 0, 0', () => {
    assert.deepEqual(quatToEulerDeg([0, 0, 0, 1]), [0, 0, 0])
    close(eulerDegToQuat([0, 0, 0]), [0, 0, 0, 1])
  })

  test('single-axis 90° rotations', () => {
    close(quatToEulerDeg([S, 0, 0, S]), [90, 0, 0])
    close(quatToEulerDeg([0, S, 0, S]), [0, 90, 0])
    close(quatToEulerDeg([0, 0, S, S]), [0, 0, 90])
    close(eulerDegToQuat([0, 90, 0]), [0, S, 0, S])
  })

  test('negative angles', () => {
    close(quatToEulerDeg([0, -S, 0, S]), [0, -90, 0])
    close(quatToEulerDeg(eulerDegToQuat([-30, 0, -45])), [-30, 0, -45])
  })

  test('round trips at mixed angles', () => {
    for (const e of [[10, 20, 30], [-45, 60, 170], [120, -30, -90], [0, 45, 0]]) {
      close(quatToEulerDeg(eulerDegToQuat(e)), e, 1e-6)
      const q = eulerDegToQuat(e)
      sameRotation(eulerDegToQuat(quatToEulerDeg(q)), q)
    }
  })

  test('±90° pitch (gimbal lock) still round-trips the rotation', () => {
    for (const e of [[30, 90, 0], [0, -90, 40], [10, 90, 20]]) {
      const q = eulerDegToQuat(e)
      const back = quatToEulerDeg(q)
      close([back[1]], [e[1]], 1e-4)
      sameRotation(eulerDegToQuat(back), q)
    }
  })

  test('a non-unit quaternion is normalized first', () => {
    close(quatToEulerDeg([0, 2, 0, 2]), [0, 90, 0])
    close(normalizeQuat([0, 0, 3, 4]), [0, 0, 0.6, 0.8])
    assert.deepEqual(normalizeQuat([0, 0, 0, 0]), [0, 0, 0, 1])
  })

  test('-0 shows as 0', () => {
    for (const v of quatToEulerDeg([0, 0, 0, -1])) assert.ok(!Object.is(v, -0))
  })
})
