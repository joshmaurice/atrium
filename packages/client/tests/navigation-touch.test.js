// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// navigation-touch.test.js — touch-nav T1: the stick, the touch look and the pinch

import { test }   from 'node:test'
import assert      from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { NavigationController } from '../src/NavigationController.js'
import { AvatarController }     from '../src/AvatarController.js'
import { SOMDocument }           from '../../som/src/SOMDocument.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class EventEmitter {
  constructor() { this._l = Object.create(null) }
  on(event, fn) { (this._l[event] ??= []).push(fn); return this }
  emit(event, ...args) { for (const fn of this._l[event] ?? []) fn(...args) }
}

function makeMockClient({ connected = false, displayName = 'User-test', avatarNodeName = 'User-test', som = null } = {}) {
  const ee = new EventEmitter()
  const client = {
    get connected()         { return connected },
    get displayName()       { return displayName },
    get _avatarNodeName()   { return avatarNodeName },
    get som()               { return som },
    viewCalls: [],
    setView(v)              { this.viewCalls.push(v) },
    on(event, fn)           { ee.on(event, fn); return client },
    emit(event, ...args)    { ee.emit(event, ...args) },
  }
  return client
}

function makeAvatarSOM(name) {
  const doc  = new Document()
  const mat  = doc.createMaterial('mat').setBaseColorFactor([0.5, 0.5, 0.5, 1])
  const prim = doc.createPrimitive().setMaterial(mat)
  const mesh = doc.createMesh(`${name}-mesh`).addPrimitive(prim)
  const node = doc.createNode(name).setMesh(mesh).setExtras({ displayName: name })
  doc.createScene('Scene').addChild(node)
  return new SOMDocument(doc)
}

function makeWiredAvatar() {
  const som    = makeAvatarSOM('User-test')
  const client = makeMockClient({ connected: true, displayName: 'User-test', som })
  const avatar = new AvatarController(client, { cameraOffsetY: 2, cameraOffsetZ: 4 })
  client.emit('world:loaded')
  const nav = new NavigationController(avatar, { mode: 'WALK', mouseSensitivity: 0.002 })
  return { nav, avatar, client }
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const lastView = (client) => client.viewCalls[client.viewCalls.length - 1]

test('touch-nav T1 — the stick pushed fully forward walks forward at the world speed', () => {
  const { nav, avatar, client } = makeWiredAvatar()
  nav.setMoveInput(0, -1)
  nav.tick(1.0)
  const pos = avatar.localNode.translation
  assert.ok(close(pos[2], -1.4), `Z should be -1.4 after 1 s at 1.4 m/s, got ${pos[2]}`)
  assert.ok(close(pos[0], 0), `X should not change, got ${pos[0]}`)
  const v = lastView(client)
  assert.ok(close(v.velocity, 1.4), `velocity ${v.velocity}`)
  assert.deepEqual(v.move.map(n => +n.toFixed(6)), [0, 0, -1])
})

test('touch-nav T1, TN-L4 (a) — half a push walks at half the speed, in the push direction', () => {
  const { nav, avatar, client } = makeWiredAvatar()
  nav.setMoveInput(0.3, -0.4)            // length 0.5
  nav.tick(1.0)
  const pos = avatar.localNode.translation
  const travelled = Math.hypot(pos[0], pos[2])
  assert.ok(close(travelled, 0.7), `0.5 × 1.4 = 0.7 m, got ${travelled}`)
  assert.ok(pos[0] > 0 && pos[2] < 0, `right and forward, got ${pos}`)
  const v = lastView(client)
  assert.ok(close(v.velocity, 0.7), `velocity ${v.velocity}`)
  assert.ok(close(Math.hypot(...v.move), 1), 'move is a unit direction')
})

test('touch-nav T1 — the stick follows the yaw: facing right, forward walks along +X', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.yaw = -Math.PI / 2
  nav.setMoveInput(0, -1)
  nav.tick(1.0)
  const pos = avatar.localNode.translation
  assert.ok(Math.abs(pos[2]) < 1e-6 && Math.abs(Math.abs(pos[0]) - 1.4) < 1e-6, `one axis, 1.4 m: ${pos}`)
})

test('touch-nav T1 — a vector longer than 1 is clamped to 1', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.setMoveInput(0, -5)
  assert.deepEqual(nav.moveInput, [0, -1])
  nav.tick(1.0)
  assert.ok(close(avatar.localNode.translation[2], -1.4))
})

test('touch-nav T1 — setMoveInput(0, 0) stops; non-numbers count as 0', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.setMoveInput(0, -1); nav.tick(0.5)
  const z = avatar.localNode.translation[2]
  nav.setMoveInput(0, 0); nav.tick(0.5)
  assert.ok(close(avatar.localNode.translation[2], z), 'no movement after release')
  nav.setMoveInput(NaN, undefined)
  assert.deepEqual(nav.moveInput, [0, 0])
})

test('touch-nav T1 — a held key wins over the stick, even keys that cancel out', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.setMoveInput(1, 0)                 // the stick says right
  nav.onKeyDown('KeyW')                  // the key says forward
  nav.tick(1.0)
  let pos = avatar.localNode.translation
  assert.ok(close(pos[0], 0) && close(pos[2], -1.4), `keys only: ${pos}`)
  nav.onKeyDown('KeyS')                  // W + S cancel: still keys, so no move
  nav.tick(1.0)
  const pos2 = avatar.localNode.translation
  assert.ok(close(pos2[0], pos[0]) && close(pos2[2], pos[2]), `W+S held: no stick move, ${pos2}`)
})

test('touch-nav T1 — ORBIT ignores the stick', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.setMode('ORBIT')
  nav.tick(0.016)
  const before = [...avatar.localNode.translation]
  nav.setMoveInput(0, -1)
  nav.tick(1.0)
  assert.deepEqual(avatar.localNode.translation.map(n => +n.toFixed(6)), before.map(n => +n.toFixed(6)))
})

test('touch-nav T1 — onTouchLook turns at 0.005 rad per pixel; mouse stays at 0.002', () => {
  const { nav } = makeWiredAvatar()
  nav.onTouchLook(100, 0)
  assert.ok(close(nav.yaw, -0.5), `yaw ${nav.yaw}`)
  nav.onMouseMove(100, 0)
  assert.ok(close(nav.yaw, -0.7), `yaw ${nav.yaw}`)
  nav.onTouchLook(0, 100000)
  assert.ok(close(nav.pitch, -Math.PI / 2.5), 'pitch clamped as the mouse is')
})

test('touch-nav T1 — onTouchLook in ORBIT orbits', () => {
  const { nav } = makeWiredAvatar()
  nav.setMode('ORBIT')
  const y0 = nav.yaw
  nav.onTouchLook(100, 0)
  assert.ok(close(nav.yaw, y0), 'yaw untouched in ORBIT')
  const az0 = nav._orbitAzimuth
  nav.onTouchLook(10, 0)
  assert.ok(close(nav._orbitAzimuth, az0 - 0.05), `azimuth ${nav._orbitAzimuth}`)
})

test('touch-nav T1 — onPinch zooms ORBIT: spread (ratio > 1) comes closer; clamped; WALK ignores it', () => {
  const { nav } = makeWiredAvatar()
  nav.orbitRadius = 10
  nav.onPinch(2)
  assert.equal(nav.orbitRadius, 10, 'WALK ignores a pinch')
  nav.setMode('ORBIT')
  nav.orbitRadius = 10
  nav.onPinch(2)
  assert.ok(close(nav.orbitRadius, 5), `radius ${nav.orbitRadius}`)
  nav.onPinch(0.001)
  assert.equal(nav.orbitRadius, 100, 'clamped at 100')
  nav.onPinch(1000)
  assert.equal(nav.orbitRadius, 0.5, 'clamped at 0.5')
  nav.orbitRadius = 10                     // away from the clamps, so each bad ratio could show (N-2)
  for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
    nav.onPinch(bad)
    assert.equal(nav.orbitRadius, 10, `ratio ${bad} does nothing`)
  }
})
