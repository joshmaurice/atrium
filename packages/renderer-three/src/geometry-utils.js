// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'

/**
 * Convert a THREE.BufferGeometry into a glTF primitive descriptor
 * (plain JS object, wire-format shape — POSITION/NORMAL attributes +
 * indices + material). Disposes the input geometry after extracting
 * its attribute data, since only the extracted arrays are retained.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {object} material - glTF material descriptor
 * @returns {object} glTF primitive descriptor:
 *   { attributes: { POSITION, NORMAL }, indices, material }
 */
export function threeGeometryToGltfPrimitive(geometry, material) {
  const positions = Array.from(geometry.attributes.position.array)
  const normals   = Array.from(geometry.attributes.normal.array)
  const indices   = Array.from(geometry.index.array)
  geometry.dispose()

  return {
    attributes: { POSITION: positions, NORMAL: normals },
    indices,
    material,
  }
}

/**
 * Build a glTF node descriptor for a procedurally-generated capsule
 * avatar, suitable for passing to AtriumClient.connect(). Random pastel
 * color per call.
 *
 * @param {string} name - display name for the avatar
 * @returns {object} glTF node descriptor
 */
export function buildAvatarDescriptor(name) {
  const geo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8)

  const color = [
    Math.random() * 0.5 + 0.5,
    Math.random() * 0.5 + 0.5,
    Math.random() * 0.5 + 0.5,
    1,
  ]

  const primitive = threeGeometryToGltfPrimitive(geo, {
    pbrMetallicRoughness: {
      baseColorFactor: color,
      metallicFactor:  0.0,
      roughnessFactor: 0.7,
    },
  })

  return {
    // name intentionally omitted — left disabled in the original app.js;
    // carried over as-is (see SESSION-43b backlog note)
    translation: [0, 0.7, 0],
    extras: { displayName: name },
    mesh: { primitives: [primitive] },
  }
}

// ---------------------------------------------------------------------------
// Edit-mode primitives (Phase 3 step 1b-2, N1, J2)
// ---------------------------------------------------------------------------

/** The palette's default material: light grey, matte. */
export const PRIMITIVE_MATERIAL = Object.freeze({
  pbrMetallicRoughness: Object.freeze({
    baseColorFactor: Object.freeze([0.8, 0.8, 0.8, 1]),
    metallicFactor:  0,
    roughnessFactor: 0.8,
  }),
})

/**
 * How high above the ground point each kind's origin sits, so the shape rests
 * on the ground. The plane is lifted 1 cm to avoid z-fighting with a ground
 * at the same height.
 */
export const PRIMITIVE_REST_Y = Object.freeze({
  cube: 0.5, plane: 0.01, sphere: 0.5, cylinder: 0.5, ramp: 0,
})

export const PRIMITIVE_KINDS = Object.freeze(Object.keys(PRIMITIVE_REST_Y))

/**
 * A wedge 1 m wide (X), 1 m deep (Z) and 0.5 m high, its base on y = 0,
 * rising toward −Z. Indexed, with flat per-face normals: every face has its
 * own vertices, wound counter-clockwise seen from outside.
 */
function rampGeometry() {
  const FL = [-0.5, 0,    0.5], FR = [0.5, 0,    0.5]
  const BL = [-0.5, 0,   -0.5], BR = [0.5, 0,   -0.5]
  const TL = [-0.5, 0.5, -0.5], TR = [0.5, 0.5, -0.5]
  const faces = [
    [FL, BL, BR, FR],   // bottom (−Y)
    [BL, TL, TR, BR],   // back (−Z)
    [FL, FR, TR, TL],   // slope (up and +Z)
    [FL, TL, BL],       // left (−X)
    [FR, BR, TR],       // right (+X)
  ]
  const positions = []
  const normals   = []
  const indices   = []
  for (const face of faces) {
    const [a, b, c] = face
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const len = Math.hypot(n[0], n[1], n[2])
    const base = positions.length / 3
    for (const p of face) {
      positions.push(...p)
      normals.push(n[0] / len, n[1] / len, n[2] / len)
    }
    for (let i = 1; i < face.length - 1; i++) indices.push(base, base + i, base + i + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3))
  geo.setIndex(indices)
  return geo
}

function primitiveGeometry(kind) {
  switch (kind) {
    case 'cube':     return new THREE.BoxGeometry(1, 1, 1)
    case 'plane': {
      const geo = new THREE.PlaneGeometry(2, 2)
      geo.rotateX(-Math.PI / 2)         // lying flat, facing +Y
      return geo
    }
    case 'sphere':   return new THREE.SphereGeometry(0.5, 32, 16)
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    case 'ramp':     return rampGeometry()
    default:         throw new Error(`unknown primitive kind "${kind}"`)
  }
}

/**
 * Build a glTF node descriptor for an Edit-mode palette primitive (1b-2 N1).
 * The shape rests on `position` (a point on the ground): the node's origin is
 * lifted by PRIMITIVE_REST_Y[kind]. No extras.
 *
 * @param {object} params
 * @param {'cube'|'plane'|'sphere'|'cylinder'|'ramp'} params.kind
 * @param {string} params.name
 * @param {[number, number, number]} params.position — the ground point
 * @param {[number, number, number, number]} [params.rotation] — unit quaternion
 * @returns {object} glTF node descriptor
 */
export function buildPrimitiveDescriptor({ kind, name, position, rotation }) {
  const geo = primitiveGeometry(kind)
  const material = structuredClone(PRIMITIVE_MATERIAL)
  const primitive = threeGeometryToGltfPrimitive(geo, material)
  const descriptor = {
    name,
    translation: [position[0], position[1] + PRIMITIVE_REST_Y[kind], position[2]],
    mesh: { primitives: [primitive] },
  }
  if (rotation) descriptor.rotation = [...rotation]
  return descriptor
}

/**
 * Build a glTF node descriptor for a teleporter pad (T1).
 * A flat teal ring on the xz plane, 5 cm above y=0 to avoid z-fighting.
 * Node translation stays at [x, 0, z] — the vertical offset is baked into
 * the geometry.
 *
 * @param {object} params
 * @param {string} params.name — node name (e.g. 'teleporter-<uuid>')
 * @param {[number, number, number]} params.position — [x, y, z] world position; y is forced to 0
 * @param {string} params.destination — teleporter destination string
 * @returns {object} glTF node descriptor
 */
export function buildTeleporterDescriptor({ name, position, destination }) {
  // Ring geometry: inner 0.45, outer 0.75 (outer = TELEPORT_TRIGGER_RADIUS)
  //   so what you see is what triggers
  const geo = new THREE.RingGeometry(0.45, 0.75, 48, 1)
  // Rotate flat onto xz plane, then lift 5 cm above y=0 to avoid z-fighting
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, 0.05, 0)

  const primitive = threeGeometryToGltfPrimitive(geo, {
    pbrMetallicRoughness: {
      baseColorFactor: [0.2, 0.9, 0.8, 1.0],   // teal
      metallicFactor:  0.0,
      roughnessFactor: 0.5,
    },
  })

  return {
    name,
    translation: [position[0], 0, position[2]],   // y forced to 0
    extras: {
      atrium: {
        teleporter: { destination },
      },
    },
    mesh: { primitives: [primitive] },
  }
}
