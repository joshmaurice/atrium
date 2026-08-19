// SPDX-License-Identifier: MIT
// navigation-controller.test.js — unit tests for NavigationController

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('NavigationController — yaw state', () => {
  const { nav } = makeWiredAvatar()
  nav.onMouseMove(100, 0)
  assert.ok(Math.abs(nav.yaw - (-0.2)) < 0.0001, `yaw should be ~-0.2, got ${nav.yaw}`)
})

test('NavigationController — pitch state clamped', () => {
  const { nav } = makeWiredAvatar()
  nav.onMouseMove(0, 10000)
  assert.ok(nav.pitch >= -Math.PI / 2.5, `pitch ${nav.pitch} should be >= -PI/2.5`)
  assert.ok(nav.pitch <= 0, `pitch ${nav.pitch} should be <= 0`)
})

test('NavigationController — tick with no keys: no position change', () => {
  const { nav, avatar } = makeWiredAvatar()
  const before = [...(avatar.localNode.translation ?? [0, 0.7, 0])]
  nav.tick(0.016)
  const after = avatar.localNode.translation ?? [0, 0.7, 0]
  // Y is clamped to at least 0.7; X and Z should be unchanged
  assert.ok(Math.abs(after[0] - before[0]) < 0.0001, 'X should not change')
  assert.ok(Math.abs(after[2] - before[2]) < 0.0001, 'Z should not change')
})

test('NavigationController — tick KeyW moves forward', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.onKeyDown('KeyW')
  nav.tick(1.0)
  const pos = avatar.localNode.translation
  assert.ok(pos[2] < 0, `Z should be negative (forward), got ${pos[2]}`)
})

test('NavigationController — tick KeyS moves backward', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.onKeyDown('KeyS')
  nav.tick(1.0)
  const pos = avatar.localNode.translation
  assert.ok(pos[2] > 0, `Z should be positive (backward), got ${pos[2]}`)
})

test('NavigationController — tick KeyA strafes left', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.onKeyDown('KeyA')
  nav.tick(1.0)
  const pos = avatar.localNode.translation
  assert.ok(pos[0] < 0, `X should be negative (strafe left), got ${pos[0]}`)
})

test('NavigationController — tick KeyD strafes right', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.onKeyDown('KeyD')
  nav.tick(1.0)
  const pos = avatar.localNode.translation
  assert.ok(pos[0] > 0, `X should be positive (strafe right), got ${pos[0]}`)
})

test('NavigationController — yaw rotation applied to localNode', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.onMouseMove(100, 0)
  nav.tick(0.016)
  const rot = avatar.localNode.rotation
  assert.ok(rot[1] !== 0, `Y component of quaternion should be non-zero, got ${rot[1]}`)
})

test('NavigationController — pitch applied to cameraNode not localNode', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.onMouseMove(0, 100)
  nav.tick(0.016)
  const camRot = avatar.cameraNode.rotation
  const locRot = avatar.localNode.rotation
  assert.ok(camRot[0] !== 0, `Camera X quaternion component should be non-zero, got ${camRot[0]}`)
  assert.ok(Math.abs(locRot[0]) < 0.0001, `Local node should have no pitch (X=0), got ${locRot[0]}`)
})

test('NavigationController — setView called with position and look after tick', () => {
  const { nav, client } = makeWiredAvatar()
  nav.onKeyDown('KeyW')
  nav.tick(0.1)
  assert.ok(client.viewCalls.length > 0, 'setView should have been called')
  const last = client.viewCalls[client.viewCalls.length - 1]
  assert.ok(Array.isArray(last.position), 'position should be an array')
  assert.ok(Array.isArray(last.look),     'look should be an array')
})

test('NavigationController — look vector is yaw-only (no pitch component from y-rotation)', () => {
  const { nav, client } = makeWiredAvatar()
  nav.onMouseMove(100, 50)  // yaw and pitch
  nav.onKeyDown('KeyW')
  nav.tick(0.1)
  const last = client.viewCalls[client.viewCalls.length - 1]
  assert.ok(Math.abs(last.look[1]) < 0.0001, `look[1] should be 0, got ${last.look[1]}`)
})

test('NavigationController — setMode validates against allowed modes', () => {
  const { nav } = makeWiredAvatar()
  nav.setMode('FLY')
  assert.strictEqual(nav.mode, 'FLY')
  nav.setMode('INVALID')
  assert.strictEqual(nav.mode, 'FLY')
})

// ---------------------------------------------------------------------------
// ORBIT mode tests
// ---------------------------------------------------------------------------

test('NavigationController — ORBIT: onMouseMove updates azimuth and elevation', () => {
  const { nav } = makeWiredAvatar()
  nav.setMode('ORBIT')
  nav._orbitAzimuth   = 0
  nav._orbitElevation = 0
  nav.onMouseMove(100, 50)
  assert.ok(Math.abs(nav._orbitAzimuth - (-0.2)) < 0.0001,
    `azimuth should be ~-0.2, got ${nav._orbitAzimuth}`)
  assert.ok(Math.abs(nav._orbitElevation - 0.1) < 0.0001,
    `elevation should be ~0.1, got ${nav._orbitElevation}`)
})

test('NavigationController — ORBIT: elevation clamped to prevent flipping', () => {
  const { nav } = makeWiredAvatar()
  nav.setMode('ORBIT')
  nav.onMouseMove(0, 10000)
  assert.ok(nav._orbitElevation <= Math.PI / 2.2,
    `elevation ${nav._orbitElevation} should be <= PI/2.2`)
  nav.onMouseMove(0, -10000)
  assert.ok(nav._orbitElevation >= -Math.PI / 2.2,
    `elevation ${nav._orbitElevation} should be >= -PI/2.2`)
})

test('NavigationController — ORBIT: onWheel adjusts radius', () => {
  const { nav } = makeWiredAvatar()
  nav.setMode('ORBIT')
  const initial = nav.orbitRadius
  nav.onWheel(1)   // deltaY > 0 → zoom out
  assert.ok(nav.orbitRadius > initial,
    `radius should increase on scroll down, got ${nav.orbitRadius}`)
  const afterOut = nav.orbitRadius
  nav.onWheel(-1)  // deltaY < 0 → zoom in
  assert.ok(nav.orbitRadius < afterOut,
    `radius should decrease on scroll up, got ${nav.orbitRadius}`)
})

test('NavigationController — ORBIT: onWheel radius clamped (min 0.5, max 100)', () => {
  const { nav } = makeWiredAvatar()
  nav.setMode('ORBIT')
  for (let i = 0; i < 200; i++) nav.onWheel(-1)
  assert.ok(nav.orbitRadius >= 0.5,
    `radius should not go below 0.5, got ${nav.orbitRadius}`)
  for (let i = 0; i < 200; i++) nav.onWheel(1)
  assert.ok(nav.orbitRadius <= 100,
    `radius should not exceed 100, got ${nav.orbitRadius}`)
})

test('NavigationController — ORBIT: tick positions node at correct spherical coordinates', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.setMode('ORBIT')
  nav._orbitAzimuth   = 0
  nav._orbitElevation = 0
  nav._orbitRadius    = 10
  nav._orbitTarget    = [0, 0, 0]
  nav.tick(0.016)
  const pos = avatar.localNode.translation
  // az=0, el=0, r=10 → x=0, y=0, z=10
  assert.ok(Math.abs(pos[0]) < 0.0001, `x should be ~0, got ${pos[0]}`)
  assert.ok(Math.abs(pos[1]) < 0.0001, `y should be ~0, got ${pos[1]}`)
  assert.ok(Math.abs(pos[2] - 10) < 0.0001, `z should be ~10, got ${pos[2]}`)
})

test('NavigationController — ORBIT: WASD keys produce no movement', () => {
  const { nav, avatar } = makeWiredAvatar()
  nav.setMode('ORBIT')
  nav._orbitAzimuth   = 0
  nav._orbitElevation = 0
  nav._orbitRadius    = 10
  nav._orbitTarget    = [0, 0, 0]
  nav.tick(0.016)
  const before = [...avatar.localNode.translation]
  nav.onKeyDown('KeyW')
  nav.onKeyDown('KeyA')
  nav.tick(0.016)
  const after = avatar.localNode.translation
  assert.ok(Math.abs(after[0] - before[0]) < 0.0001,
    `X should not change from WASD in ORBIT, got ${after[0]} vs ${before[0]}`)
  assert.ok(Math.abs(after[2] - before[2]) < 0.0001,
    `Z should not change from WASD in ORBIT, got ${after[2]} vs ${before[2]}`)
})

test('NavigationController — ORBIT: setView called with zero move and velocity', () => {
  const { nav, client } = makeWiredAvatar()
  nav.setMode('ORBIT')
  nav.tick(0.016)
  assert.ok(client.viewCalls.length > 0, 'setView should have been called')
  const last = client.viewCalls[client.viewCalls.length - 1]
  assert.deepStrictEqual(last.move, [0, 0, 0], 'move should be [0,0,0] in ORBIT mode')
  assert.strictEqual(last.velocity, 0, 'velocity should be 0 in ORBIT mode')
})

test('NavigationController — ORBIT: mode switch WALK→ORBIT initializes orbit state from current position', () => {
  const { nav, avatar } = makeWiredAvatar()
  avatar.localNode.translation = [0, 0, 5]
  nav.setMode('ORBIT')
  // target=[0,0,0], pos=[0,0,5] → radius=5, azimuth=atan2(0,5)=0, elevation=asin(0)=0
  assert.ok(Math.abs(nav.orbitRadius - 5) < 0.0001,
    `radius should be 5, got ${nav.orbitRadius}`)
  assert.ok(Math.abs(nav._orbitAzimuth) < 0.0001,
    `azimuth should be ~0, got ${nav._orbitAzimuth}`)
  assert.ok(Math.abs(nav._orbitElevation) < 0.0001,
    `elevation should be ~0, got ${nav._orbitElevation}`)
})

test('NavigationController — ORBIT: mode switch does not teleport camera (radius derived from position)', () => {
  const { nav, avatar } = makeWiredAvatar()
  avatar.localNode.translation = [10, 5, 0]
  nav.setMode('ORBIT')
  // target=[0,0,0], pos=[10,5,0] → radius = sqrt(100+25) = ~11.18
  const expected = Math.sqrt(10 * 10 + 5 * 5)
  assert.ok(Math.abs(nav.orbitRadius - expected) < 0.01,
    `radius should be ~${expected.toFixed(2)}, got ${nav.orbitRadius}`)
})

test('NavigationController — onWheel ignored in WALK mode', () => {
  const { nav } = makeWiredAvatar()
  // mode is WALK (default)
  const before = nav._orbitRadius
  nav.onWheel(1)
  assert.strictEqual(nav._orbitRadius, before,
    'orbitRadius should not change when onWheel called in WALK mode')
})

test('NavigationController — tick with no keys calls setView with zero velocity', () => {
  const { nav, client } = makeWiredAvatar()
  // First tick with movement
  nav.onKeyDown('KeyW')
  nav.tick(0.1)
  const countAfterMove = client.viewCalls.length
  assert.ok(countAfterMove > 0, 'should have sent view when moving')
  const movingCall = client.viewCalls[countAfterMove - 1]
  assert.ok(movingCall.velocity > 0, `velocity should be > 0 when moving, got ${movingCall.velocity}`)

  // Second tick with no keys
  nav.onKeyUp('KeyW')
  nav.tick(0.1)
  const stillCall = client.viewCalls[client.viewCalls.length - 1]
  assert.strictEqual(stillCall.velocity, 0, `velocity should be 0 when not moving, got ${stillCall.velocity}`)
})
