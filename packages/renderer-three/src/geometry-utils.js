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
