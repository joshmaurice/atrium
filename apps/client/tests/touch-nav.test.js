// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// touch-nav.test.js — touch-nav T2: the gesture state machine, event sequence by sequence

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTouchNav, TOUCH_LOOK_SLOP_PX, TAP_MAX_MS, STICK_RADIUS_PX, STICK_DEAD_ZONE } from '../src/touch-nav.js'

const C = { x: 70, y: 700 }                       // the stick's centre
const byType = (fx, t) => fx.filter(e => e.type === t)
const one = (fx, t) => { const l = byType(fx, t); assert.equal(l.length, 1, `one ${t} in ${JSON.stringify(fx)}`); return l[0] }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

test('T2 — the defaults: look slop 10 px (S-1), a made-up tap at most 500 ms (S-8), radius 48, dead zone 0.12', () => {
  assert.equal(TOUCH_LOOK_SLOP_PX, 10)
  assert.equal(TAP_MAX_MS, 500)
  assert.equal(STICK_RADIUS_PX, 48)
  assert.equal(STICK_DEAD_ZONE, 0.12)
})

test('T2 stick — pushed to the rim straight up: move (0, -1), knob at the rim', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  const fx = t.move({ id: 1, x: C.x, y: C.y - 48 })
  const m = one(fx, 'move')
  assert.ok(close(m.x, 0) && close(m.z, -1), JSON.stringify(m))
  assert.deepEqual(one(fx, 'knob'), { type: 'knob', dx: 0, dy: -48 })
})

test('T2 stick — past the rim is clamped: the vector stays length 1, the knob at the rim', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  const fx = t.move({ id: 1, x: C.x + 300, y: C.y })
  const m = one(fx, 'move')
  assert.ok(close(m.x, 1) && close(m.z, 0), JSON.stringify(m))
  const k = one(fx, 'knob')
  assert.ok(close(k.dx, 48) && close(k.dy, 0))
})

test('T2 stick, TN-L4 (a) — inside the dead zone is (0, 0); just past it is near 0; halfway is rescaled', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  let m = one(t.move({ id: 1, x: C.x, y: C.y - 5 }), 'move')          // 5/48 = 0.104 < 0.12
  assert.deepEqual([m.x, m.z], [0, 0])
  m = one(t.move({ id: 1, x: C.x, y: C.y - 6 }), 'move')              // 0.125: just past
  assert.ok(m.z < 0 && m.z > -0.01, `just past the dead zone: ${m.z}`)
  m = one(t.move({ id: 1, x: C.x, y: C.y - 24 }), 'move')             // 0.5 → (0.5-0.12)/0.88
  assert.ok(close(m.z, -(0.5 - 0.12) / 0.88), `halfway: ${m.z}`)
})

test('T2 stick — the press itself sends its vector (a thumb landing off-centre walks at once)', () => {
  const t = createTouchNav()
  const fx = t.down({ id: 1, x: C.x + 48, y: C.y, on: 'stick', stickCentre: C })
  assert.ok(close(one(fx, 'move').x, 1))
})

test('T2 stick — release stops: move (0, 0), knob home (the page routes pointercancel through up(); the harness t10a checks a real cancel)', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  t.move({ id: 1, x: C.x, y: C.y - 40 })
  const fx = t.up({ id: 1 })
  assert.deepEqual(one(fx, 'move'), { type: 'move', x: 0, z: 0 })
  assert.deepEqual(one(fx, 'knob'), { type: 'knob', dx: 0, dy: 0 })
  assert.equal(t.active, false)
})

test('T2 stick — a second press on the stick while it is held is ignored', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  assert.deepEqual(t.down({ id: 2, x: C.x, y: C.y - 48, on: 'stick', stickCentre: C }), [])
  assert.deepEqual(t.move({ id: 2, x: C.x, y: C.y - 48 }), [])
  assert.deepEqual(t.up({ id: 2 }), [])
  const m = one(t.move({ id: 1, x: C.x, y: C.y - 48 }), 'move')
  assert.ok(close(m.z, -1), 'the first pointer still owns it')
})

test('T2 look, S-1 — a tap that rolls up to 9 px sends nothing at all', () => {
  const t = createTouchNav()
  assert.deepEqual(t.down({ id: 1, x: 200, y: 400, on: 'view' }), [])
  assert.deepEqual(t.move({ id: 1, x: 205, y: 400 }), [])
  assert.deepEqual(t.move({ id: 1, x: 200, y: 409 }), [])
  assert.deepEqual(t.move({ id: 1, x: 206, y: 407 }), [], '√(36+49) ≈ 9.2 < 10')
  assert.deepEqual(t.up({ id: 1 }), [])
  assert.equal(t.active, false)
})

test('T2 look — past the slop it sends the whole travel since the press, then each delta', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: 200, y: 400, on: 'view' })
  assert.deepEqual(t.move({ id: 1, x: 206, y: 400 }), [])
  assert.deepEqual(t.move({ id: 1, x: 210, y: 401 }), [{ type: 'look', dx: 10, dy: 1 }])
  assert.deepEqual(t.move({ id: 1, x: 220, y: 399 }), [{ type: 'look', dx: 10, dy: -2 }])
  // a finger that looked swallows the click the browser may still send
  assert.deepEqual(t.up({ id: 1 }), [{ type: 'swallow-click' }])
})

test('T2 look and stick at once (two thumbs): each pointer keeps its own role', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  t.down({ id: 2, x: 300, y: 400, on: 'view' })
  const a = t.move({ id: 1, x: C.x, y: C.y - 48 })
  assert.ok(close(one(a, 'move').z, -1))
  assert.equal(byType(a, 'look').length, 0)
  const b = t.move({ id: 2, x: 320, y: 400 })
  assert.deepEqual(b, [{ type: 'look', dx: 20, dy: 0 }])
  assert.deepEqual(t.up({ id: 2 }), [{ type: 'swallow-click' }], 'lifting the look finger leaves the stick alone')
  assert.ok(close(one(t.move({ id: 1, x: C.x + 48, y: C.y }), 'move').x, 1))
})

test('T2 pinch — a second view finger: look stops, moves send the distance ratio', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: 100, y: 400, on: 'view' })
  t.move({ id: 1, x: 110, y: 400 })                   // live look
  t.down({ id: 2, x: 210, y: 400, on: 'view' })       // distance 100
  const fx = t.move({ id: 2, x: 310, y: 400 })        // distance 200
  assert.deepEqual(fx, [{ type: 'pinch', ratio: 2 }])
  assert.deepEqual(t.move({ id: 1, x: 210, y: 400 }), [{ type: 'pinch', ratio: 0.5 }])  // 100 again
})

test('T2 pinch — when one finger lifts, the other looks on from where it is, without a jump', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: 100, y: 400, on: 'view' })
  t.down({ id: 2, x: 200, y: 400, on: 'view' })
  t.move({ id: 1, x: 50, y: 400 })
  assert.deepEqual(t.up({ id: 2 }), [{ type: 'swallow-click' }], 'a pinch finger swallows its click')
  // the first move after the lift is a small delta, not the travel since its press
  assert.deepEqual(t.move({ id: 1, x: 52, y: 400 }), [{ type: 'look', dx: 2, dy: 0 }])
})

test('T2 pinch — a third view finger is ignored', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: 100, y: 400, on: 'view' })
  t.down({ id: 2, x: 200, y: 400, on: 'view' })
  assert.deepEqual(t.down({ id: 3, x: 300, y: 400, on: 'view' }), [])
  assert.deepEqual(t.move({ id: 3, x: 350, y: 450 }), [])
})

test('T2 — handle and other presses are never tracked (B3: a handle drag never looks)', () => {
  const t = createTouchNav()
  for (const on of ['handle', 'other']) {
    assert.deepEqual(t.down({ id: 7, x: 100, y: 100, on }), [])
    assert.deepEqual(t.move({ id: 7, x: 300, y: 300 }), [])
    assert.deepEqual(t.up({ id: 7 }), [])
  }
  // and a view finger pressed meanwhile is the first look, not a pinch
  t.down({ id: 7, x: 100, y: 100, on: 'handle' })
  t.down({ id: 8, x: 200, y: 200, on: 'view' })
  assert.deepEqual(t.move({ id: 8, x: 220, y: 200 }), [{ type: 'look', dx: 20, dy: 0 }])
})

test('T2 — moves and ups of unknown pointers do nothing', () => {
  const t = createTouchNav()
  assert.deepEqual(t.move({ id: 9, x: 1, y: 1 }), [])
  assert.deepEqual(t.up({ id: 9 }), [])
})

test('T2 reset — drops every gesture and stops the stick; nothing held after', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  t.move({ id: 1, x: C.x, y: C.y - 48 })
  t.down({ id: 2, x: 300, y: 400, on: 'view' })
  const fx = t.reset()
  assert.deepEqual(one(fx, 'move'), { type: 'move', x: 0, z: 0 })
  assert.equal(t.active, false)
  assert.deepEqual(t.move({ id: 1, x: C.x, y: C.y - 48 }), [], 'the old stick pointer is forgotten')
  assert.deepEqual(t.move({ id: 2, x: 400, y: 400 }), [], 'the old look pointer is forgotten')
  assert.deepEqual(t.reset(), [], 'a second reset sends nothing')
})

test('T2 — a stick press without a centre is ignored (the stick is not on screen)', () => {
  const t = createTouchNav()
  assert.deepEqual(t.down({ id: 1, x: 10, y: 10, on: 'stick' }), [])
  assert.equal(t.active, false)
})

test('T2 releaseStick — lets the stick go and leaves a look or pinch in progress alone', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  t.down({ id: 2, x: 300, y: 400, on: 'view' })
  t.move({ id: 2, x: 312, y: 400 })
  const fx = t.releaseStick()
  assert.deepEqual(one(fx, 'move'), { type: 'move', x: 0, z: 0 })
  assert.deepEqual(t.move({ id: 2, x: 317, y: 400 }), [{ type: 'look', dx: 5, dy: 0 }], 'the look goes on')
  assert.deepEqual(t.releaseStick(), [], 'nothing to release twice')
})

test('T2 primary — a primary press drops a finger whose release was lost, and stops a stuck stick', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C, primary: true })
  t.move({ id: 1, x: C.x, y: C.y - 48 })
  t.down({ id: 2, x: 100, y: 400, on: 'view' })            // not primary: a second finger
  // ...both releases are lost; the next touch is primary again
  const fx = t.down({ id: 3, x: 200, y: 400, on: 'view', primary: true })
  assert.deepEqual(one(fx, 'move'), { type: 'move', x: 0, z: 0 }, 'the stuck stick stops')
  assert.deepEqual(t.move({ id: 3, x: 220, y: 400 }), [{ type: 'look', dx: 20, dy: 0 }], 'the new finger looks, not pinches')
  assert.deepEqual(t.move({ id: 2, x: 0, y: 0 }), [], 'the stale finger is forgotten')
})

test('T2 primary — a primary press with nothing tracked changes nothing', () => {
  const t = createTouchNav()
  assert.deepEqual(t.down({ id: 1, x: 200, y: 400, on: 'view', primary: true }), [])
  assert.deepEqual(t.move({ id: 1, x: 210, y: 400 }), [{ type: 'look', dx: 10, dy: 0 }])
})

test('T2 tap, S-2 — a view finger that never looked, lifted while the stick is held, is a tap at its place', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  t.down({ id: 2, x: 200, y: 400, on: 'view' })
  t.move({ id: 2, x: 203, y: 401 })
  assert.deepEqual(t.up({ id: 2 }), [{ type: 'tap', x: 203, y: 401 }])
})

test('T2 tap, S-2 — the stick pressed while the finger is down counts too; a finger that looked is no tap', () => {
  const t = createTouchNav()
  t.down({ id: 2, x: 200, y: 400, on: 'view' })
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  assert.deepEqual(t.up({ id: 2 }), [{ type: 'tap', x: 200, y: 400 }])
  t.down({ id: 3, x: 200, y: 400, on: 'view' })
  t.move({ id: 3, x: 230, y: 400 })
  assert.deepEqual(t.up({ id: 3 }), [{ type: 'swallow-click' }])
})

test('T2 tap — without the stick a lifted finger that never looked returns nothing (Chrome sends the click)', () => {
  const t = createTouchNav()
  t.down({ id: 2, x: 200, y: 400, on: 'view' })
  assert.deepEqual(t.up({ id: 2 }), [])
})

test('T2 tap, S-8 — a cancelled finger is never a tap, with the stick held or not', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C, t: 0 })
  t.down({ id: 2, x: 200, y: 400, on: 'view', t: 100 })
  assert.deepEqual(t.up({ id: 2, cancelled: true, t: 200 }), [])
})

test('T2 tap, S-8 — a finger held longer than TAP_MAX_MS is no tap; at the limit it is', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C, t: 0 })
  t.down({ id: 2, x: 200, y: 400, on: 'view', t: 1000 })
  assert.deepEqual(t.up({ id: 2, t: 1000 + TAP_MAX_MS + 1 }), [], 'a long press')
  t.down({ id: 3, x: 200, y: 400, on: 'view', t: 3000 })
  assert.deepEqual(t.up({ id: 3, t: 3000 + TAP_MAX_MS }), [{ type: 'tap', x: 200, y: 400 }], 'at the limit')
})

test('T2 tap — the stick let go before the finger lifts: still a tap (Chrome dropped the tap once a second finger was down)', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  t.down({ id: 2, x: 200, y: 400, on: 'view' })
  t.up({ id: 1 })
  assert.deepEqual(t.up({ id: 2 }), [{ type: 'tap', x: 200, y: 400 }])
})

test('T2 slop — may be a function (the page scales it by the page zoom, N-8)', () => {
  let scale = 1
  const t = createTouchNav({ slop: () => 10 / scale })
  t.down({ id: 1, x: 200, y: 400, on: 'view' })
  assert.deepEqual(t.move({ id: 1, x: 212, y: 400 }), [{ type: 'look', dx: 12, dy: 0 }], 'zoom 1: 12 px looks')
  t.up({ id: 1 })
  scale = 0.5                                   // zoomed out: 20 CSS px = 10 screen px
  t.down({ id: 2, x: 200, y: 400, on: 'view' })
  assert.deepEqual(t.move({ id: 2, x: 212, y: 400 }), [], 'zoom 0.5: 12 px is still a tap')
  assert.deepEqual(t.move({ id: 2, x: 221, y: 400 }), [{ type: 'look', dx: 21, dy: 0 }])
})

test('T2 pinch — an unchanged distance sends nothing; both pinch fingers swallow their click even if one never moved', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: 100, y: 400, on: 'view' })
  t.down({ id: 2, x: 200, y: 400, on: 'view' })
  assert.deepEqual(t.move({ id: 2, x: 200, y: 400 }), [], 'ratio 1')
  assert.deepEqual(t.up({ id: 1 }), [{ type: 'swallow-click' }])
  assert.deepEqual(t.up({ id: 2 }), [{ type: 'swallow-click' }])
})

test('T2 pinch, N-15 — a vertical pinch counts its y distance', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: 200, y: 300, on: 'view' })
  t.down({ id: 2, x: 200, y: 400, on: 'view' })     // 100 apart, vertically
  assert.deepEqual(t.move({ id: 2, x: 200, y: 500 }), [{ type: 'pinch', ratio: 2 }])
})

test('T2 stick, N-15 — a diagonal push past the rim is clamped on both axes; a part push sideways scales x', () => {
  const t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  const fx = t.move({ id: 1, x: C.x + 300, y: C.y - 400 })      // 3-4-5, far past the rim
  const m = one(fx, 'move'), k = one(fx, 'knob')
  assert.ok(close(m.x, 0.6) && close(m.z, -0.8), JSON.stringify(m))
  assert.ok(close(k.dx, 48 * 0.6) && close(k.dy, -48 * 0.8), JSON.stringify(k))
  const half = one(t.move({ id: 1, x: C.x + 24, y: C.y }), 'move')   // 0.5 to the right
  assert.ok(close(half.x, (0.5 - 0.12) / 0.88) && close(half.z, 0), JSON.stringify(half))
})

test('T2 primary, N-15 — a primary press drops a stale stick alone, and a stale view finger alone', () => {
  let t = createTouchNav()
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C, primary: true })
  t.move({ id: 1, x: C.x, y: C.y - 48 })
  const fx = t.down({ id: 2, x: 200, y: 400, on: 'view', primary: true })
  assert.deepEqual(one(fx, 'move'), { type: 'move', x: 0, z: 0 }, 'the stale stick stops')
  assert.deepEqual(t.move({ id: 1, x: C.x + 48, y: C.y }), [], 'and is forgotten')
  t = createTouchNav()
  t.down({ id: 3, x: 100, y: 400, on: 'view', primary: true })
  assert.deepEqual(t.down({ id: 4, x: 200, y: 400, on: 'view', primary: true }), [], 'nothing to stop')
  assert.deepEqual(t.move({ id: 4, x: 220, y: 400 }), [{ type: 'look', dx: 20, dy: 0 }], 'the new finger looks; the stale one would have made it a pinch')
})

test('T2 stick — the radius may be a function (the page scales it by the page zoom: desktop site)', () => {
  let scale = 1
  const t = createTouchNav({ stickRadius: () => 48 / scale })
  scale = 0.4                                   // 120 CSS px = 48 screen px
  t.down({ id: 1, x: C.x, y: C.y, on: 'stick', stickCentre: C })
  const fx = t.move({ id: 1, x: C.x - 120, y: C.y })
  assert.ok(close(one(fx, 'move').x, -1), 'a full push at 120 CSS px')
  assert.ok(close(one(fx, 'knob').dx, -120))
  const half = one(t.move({ id: 1, x: C.x - 60, y: C.y }), 'move')
  assert.ok(close(half.x, -(0.5 - 0.12) / 0.88), JSON.stringify(half))
})
