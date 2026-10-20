// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// Phase 3 step 1b-2, N1 and J5 — devtasks/PREBRIEF-edit-mode-ui-1b-2.md §7.1

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  palettePlacement, paletteName, copyName, teleporterName, firstFreeName, PALETTE_DISTANCE, PALETTE_LABELS, MAX_NAME_LENGTH,
} from '../src/edit-palette.js'

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

function rotate(q, v) {   // rotate v by unit quaternion q = [x, y, z, w]
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx)
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)]
}

// A stand-in for SOMDocument.checkNewName with the real D3 rules.
function freeIn(taken) {
  const set = new Set(taken)
  return (name) => typeof name === 'string' && name.length > 0 && name.length <= 256 &&
    name !== '__document__' && !name.endsWith('.camera') && !name.endsWith('.light') &&
    !name.includes('/') && !set.has(name)
}

// ── Placement ───────────────────────────────────────────────────────────────

for (const deg of [0, 90, 180, 37]) {
  test(`placement: view at yaw ${deg}° → ${PALETTE_DISTANCE} m along the horizontal view, on the ground`, () => {
    const yaw = (deg * Math.PI) / 180
    const forward = [-Math.sin(yaw), 0, -Math.cos(yaw)]       // −Z turned by yaw
    const origin = [4, 0.7, -1]
    const { position, rotation } = palettePlacement(origin, forward)
    assert.ok(close(position[0], origin[0] + forward[0] * PALETTE_DISTANCE))
    assert.ok(close(position[2], origin[2] + forward[2] * PALETTE_DISTANCE))
    assert.equal(position[1], 0)
    // the rotation turns local −Z onto the view direction
    const turned = rotate(rotation, [0, 0, -1])
    assert.ok(close(turned[0], forward[0], 1e-9) && close(turned[1], 0) && close(turned[2], forward[2], 1e-9))
  })
}

test('placement: a pitched view still gives a horizontal offset of the full distance', () => {
  const forward = [0, -0.8, -0.6]                 // looking down and ahead (−Z)
  const { position } = palettePlacement([0, 1.6, 0], forward)
  assert.ok(close(position[0], 0) && close(position[2], -PALETTE_DISTANCE))
  assert.equal(position[1], 0)
})

test('placement: forward of any length is normalized', () => {
  const a = palettePlacement([0, 0, 0], [0, 0, -1]).position
  const b = palettePlacement([0, 0, 0], [0, 0, -40]).position
  assert.deepStrictEqual(a, b)
})

test('placement: straight down (no horizontal part) → −Z', () => {
  const { position, rotation } = palettePlacement([1, 2, 3], [0, -1, 0])
  assert.ok(close(position[0], 1) && close(position[2], 3 - PALETTE_DISTANCE))
  assert.ok(close(rotation[1], 0) && close(Math.abs(rotation[3]), 1))
})

test('placement (ORBIT, review #7): the view direction decides, not the avatar rotation', () => {
  // ORBIT leaves the avatar node at the orbit camera's position with its
  // rotation untouched (yaw 0 → facing −Z). The view looks along +X.
  const orbitCameraPosition = [-10, 3, 0]
  const viewDirection = [0.95, -0.3, 0]            // toward the orbit target, +X
  const { position } = palettePlacement(orbitCameraPosition, viewDirection)
  assert.ok(close(position[0], -10 + PALETTE_DISTANCE) && close(position[2], 0), `got ${position}`)
})

test('placement: the rotation is a unit quaternion about Y', () => {
  for (const f of [[1, 0, 0], [0.3, 0.2, -0.9], [-1, 0, 1]]) {
    const q = palettePlacement([0, 0, 0], f).rotation
    assert.equal(q[0], 0)
    assert.equal(q[2], 0)
    assert.ok(close(Math.hypot(...q), 1, 1e-12))
  }
})

// ── Names (J5) ──────────────────────────────────────────────────────────────

test('palette names: the bare label when free', () => {
  assert.equal(paletteName('cube', freeIn([])), 'Cube')
  assert.equal(paletteName('ramp', freeIn([])), 'Ramp')
  assert.deepStrictEqual(Object.keys(PALETTE_LABELS), ['cube', 'plane', 'sphere', 'cylinder', 'ramp'])
})

test('palette names: "Cube 2" when "Cube" is taken', () => {
  assert.equal(paletteName('cube', freeIn(['Cube'])), 'Cube 2')
})

test('palette names: skips taken numbers', () => {
  assert.equal(paletteName('sphere', freeIn(['Sphere', 'Sphere 2', 'Sphere 3', 'Sphere 5'])), 'Sphere 4')
})

test('palette names: an unknown kind throws', () => {
  assert.throws(() => paletteName('torus', freeIn([])), /unknown primitive kind/)
})

test('copy names: "<name> copy", then "<name> copy 2"…', () => {
  assert.equal(copyName('Crate', freeIn([])), 'Crate copy')
  assert.equal(copyName('Crate', freeIn(['Crate copy'])), 'Crate copy 2')
  assert.equal(copyName('Crate', freeIn(['Crate copy', 'Crate copy 2'])), 'Crate copy 3')
})

test('names never come back refused by the D3 rules', () => {
  // a name ending in ".light" would be refused; its copy isn't
  assert.equal(copyName('lamp.light', freeIn([])), 'lamp.light copy')
  const isFree = freeIn(['Cube', 'Cube 2'])
  const name = paletteName('cube', isFree)
  assert.ok(isFree(name))
})

test('long names (review #8): a 256-character original yields distinct valid copies', () => {
  const original = 'x'.repeat(MAX_NAME_LENGTH)
  const first = copyName(original, freeIn([original]))
  assert.ok(first.length <= MAX_NAME_LENGTH && first.endsWith(' copy'), first.slice(-12))
  const second = copyName(original, freeIn([original, first]))
  assert.ok(second.length <= MAX_NAME_LENGTH && second.endsWith(' copy 2'), second.slice(-12))
  assert.notEqual(first, second)
  const third = copyName(original, freeIn([original, first, second]))
  assert.ok(third.endsWith(' copy 3') && third.length <= MAX_NAME_LENGTH)
})

test('long names: a base ending in a surrogate pair is not split', () => {
  // 250 ASCII + an emoji (2 UTF-16 units) = 252; " copy" needs 5 → cut to 251,
  // which would fall inside the pair. The emoji is dropped whole instead.
  const original = 'y'.repeat(250) + '😀'
  const name = copyName(original, freeIn([]))
  assert.ok(name.length <= MAX_NAME_LENGTH)
  assert.equal(name, 'y'.repeat(250) + ' copy')
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(name), 'no lone high surrogate')
})

test('firstFreeName: null when nothing in the limit is free', () => {
  assert.equal(firstFreeName('A', (n) => ` ${n}`, () => false, 5), null)
})

// ── Teleporter names (edit-polish-2, L4) ────────────────────────────────────

test('teleporter names: "Teleporter" when it is free', () => {
  assert.equal(teleporterName(freeIn([])), 'Teleporter')
})

test('teleporter names: "Teleporter 2", "Teleporter 3"… as names are taken', () => {
  assert.equal(teleporterName(freeIn(['Teleporter'])), 'Teleporter 2')
  assert.equal(teleporterName(freeIn(['Teleporter', 'Teleporter 2'])), 'Teleporter 3')
})

test('teleporter names: skips taken numbers, like the palette does', () => {
  assert.equal(teleporterName(freeIn(['Teleporter', 'Teleporter 2', 'Teleporter 4'])), 'Teleporter 3')
})

test('teleporter names: respect the 256-character limit and the D3 rules, as firstFreeName does', () => {
  // The first 99 candidates are taken: the 100th is the one it returns, still
  // inside the limit and still accepted by the same rules the server applies.
  const taken = Array.from({ length: 99 }, (_, i) => (i === 0 ? 'Teleporter' : `Teleporter ${i + 1}`))
  const isFree = freeIn(taken)
  const name = teleporterName(isFree)
  assert.equal(name, 'Teleporter 100')
  assert.ok(name.length <= MAX_NAME_LENGTH)
  assert.ok(isFree(name), 'the name it hands out passes the D3 rules')
})

test('teleporter names: null when no candidate in the limit is free', () => {
  assert.equal(teleporterName(() => false), null)
})

test('teleporter is not a palette kind — the palette handler would throw on it (P2)', () => {
  assert.deepStrictEqual(Object.keys(PALETTE_LABELS), ['cube', 'plane', 'sphere', 'cylinder', 'ramp'])
  assert.equal('teleporter' in PALETTE_LABELS, false, 'PALETTE_LABELS is unchanged')
  assert.throws(() => paletteName('teleporter', freeIn([])), /unknown primitive kind/)
})
