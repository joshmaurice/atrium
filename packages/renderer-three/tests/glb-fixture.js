// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// glb-fixture.js — a tiny glTF/GLB writer for the renderer's tests (P5: the
// fixtures are written in-test, with no textures, and nothing is fetched).
//
// Not a *.test.js file, so `node --test tests/*.test.js` ignores it.

/** Pad to a 4-byte boundary the way a GLB chunk needs. */
function pad4(bytes, filler) {
  const remainder = bytes.length % 4
  if (remainder === 0) return bytes
  const out = new Uint8Array(bytes.length + (4 - remainder))
  out.set(bytes, 0)
  out.fill(filler, bytes.length)
  return out
}

/** Assemble a `.glb` from a glTF JSON object and a binary chunk. */
export function packGlb(json, bin = new Uint8Array(0)) {
  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20)
  const binBytes = pad4(bin, 0x00)
  const hasBin = binBytes.length > 0
  const total = 12 + 8 + jsonBytes.length + (hasBin ? 8 + binBytes.length : 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)   // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.length, true)
  view.setUint32(16, 0x4e4f534a, true)  // 'JSON'
  out.set(jsonBytes, 20)
  if (hasBin) {
    view.setUint32(20 + jsonBytes.length, binBytes.length, true)
    view.setUint32(24 + jsonBytes.length, 0x004e4942, true)  // 'BIN'
    out.set(binBytes, 28 + jsonBytes.length)
  }
  return out
}

/** A binary chunk builder: appends typed arrays and returns buffer views. */
export function binBuilder() {
  const chunks = []
  const bufferViews = []
  let length = 0
  return {
    get length() { return length },
    get bufferViews() { return bufferViews },
    /** Append floats; returns the bufferView index. */
    view(array) {
      const source = array instanceof Float32Array || array instanceof Uint16Array
        ? new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
        : array
      const aligned = pad4(source, 0)
      bufferViews.push({ buffer: 0, byteOffset: length, byteLength: source.length })
      chunks.push(aligned)
      length += aligned.length
      return bufferViews.length - 1
    },
    bin() {
      const out = new Uint8Array(length)
      let at = 0
      for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
      return out
    },
  }
}

/**
 * A one-triangle POSITION accessor (plus indices when asked), added to `bin`.
 * Returns the accessor indices.
 */
export function addTriangle(bin, accessors, { indexed = true, colors = false } = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const positionView = bin.view(positions)
  accessors.push({ bufferView: positionView, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] })
  const out = { POSITION: accessors.length - 1 }
  if (colors) {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
    accessors.push({ bufferView: bin.view(normals), componentType: 5126, count: 3, type: 'VEC3' })
    out.NORMAL = accessors.length - 1
  }
  if (indexed) {
    const indices = new Uint16Array([0, 1, 2])
    accessors.push({ bufferView: bin.view(indices), componentType: 5123, count: 3, type: 'SCALAR' })
    out.indices = accessors.length - 1
  }
  return out
}

/**
 * A model with the parts a model-isolation test needs: mesh nodes with names
 * that collide with world nodes, one animation clip that moves a part by NAME,
 * an imported light and an imported camera.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.parts]     the mesh-bearing node names, in order
 * @param {string} [opts.clipTarget]  the part the clip animates, by name
 * @param {boolean} [opts.withLight]
 * @param {boolean} [opts.withCamera]
 * @param {boolean} [opts.modelNamed] whether the model's own root node is named
 * @returns {Uint8Array}
 */
export function modelGlb({
  parts = ['Door', 'Cube'],
  clipTarget = 'Door',
  withLight = false,
  withCamera = false,
  modelNamed = true,
} = {}) {
  const bin = binBuilder()
  const accessors = []
  const meshes = []
  const nodes = []
  const children = []

  for (const name of parts) {
    const attributes = addTriangle(bin, accessors)
    meshes.push({ primitives: [{ attributes: { POSITION: attributes.POSITION }, indices: attributes.indices }] })
    nodes.push({ name, mesh: meshes.length - 1, translation: [0, 0, 0] })
    children.push(nodes.length - 1)
  }

  if (withLight) {
    nodes.push({ name: 'ModelLight', extensions: { KHR_lights_punctual: { light: 0 } } })
    children.push(nodes.length - 1)
  }
  if (withCamera) {
    nodes.push({ name: 'ModelCamera', camera: 0 })
    children.push(nodes.length - 1)
  }

  const rootIndex = nodes.length
  nodes.push({
    ...(modelNamed ? { name: 'Model' } : {}),
    children,
  })

  // One clip: `clipTarget.position`, as an exporter writes it — by node NAME.
  const target = nodes.findIndex((n) => n.name === clipTarget)
  const times = new Float32Array([0, 1])
  const timeView = bin.view(times)
  accessors.push({ bufferView: timeView, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] })
  const input = accessors.length - 1
  const values = new Float32Array([0, 0, 0, 1, 0, 0])
  const valueView = bin.view(values)
  accessors.push({ bufferView: valueView, componentType: 5126, count: 2, type: 'VEC3' })
  const output = accessors.length - 1

  const json = {
    asset: { version: '2.0', generator: 'atrium-test-fixture' },
    scene: 0,
    scenes: [{ nodes: [rootIndex] }],
    nodes,
    meshes,
    accessors,
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: bin.length }],
    animations: [{
      name: 'Move',
      channels: [{ sampler: 0, target: { node: target === -1 ? 0 : target, path: 'translation' } }],
      samplers: [{ input, output, interpolation: 'LINEAR' }],
    }],
  }
  if (withLight) {
    json.extensionsUsed = ['KHR_lights_punctual']
    json.extensions = { KHR_lights_punctual: { lights: [{ type: 'point', intensity: 10, color: [1, 1, 1] }] } }
  }
  if (withCamera) {
    json.cameras = [{ type: 'perspective', perspective: { yfov: 0.8, znear: 0.1, zfar: 100 } }]
  }
  return packGlb(json, bin.bin())
}

/** One mesh node, for the parse/limit tests. */
export function simpleGlb({ name = 'Part', vertices = 3 } = {}) {
  const positions = new Float32Array(vertices * 3)
  for (let i = 0; i < vertices; i++) positions.set([i, 0, 0], i * 3)
  const bin = binBuilder()
  const view = bin.view(positions)
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: view, componentType: 5126, count: vertices, type: 'VEC3', min: [0, 0, 0], max: [vertices, 0, 0] }],
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: bin.length }],
  }
  return packGlb(json, bin.bin())
}

// ---------------------------------------------------------------------------
// W1 (round 3) — a model whose texture the world budget has to be charged for
// ---------------------------------------------------------------------------

/**
 * A PNG signature and `IHDR`, header only — enough for the A5 header checks,
 * with no pixel data and nothing to decode (P5).
 */
export function pngHeaderBytes(width, height, colorType = 2) {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)   // 'IHDR'
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes[24] = 8
  bytes[25] = colorType
  return bytes
}

/**
 * A `.glb` whose one image is a header-only PNG held in a buffer view: the
 * shape `parseTemplate` must charge the world texture budget for. Parsing it
 * needs no image decoding (the bytes are only ever measured) — callers inject
 * a loader stand-in.
 *
 * @returns {Uint8Array}
 */
export function imageGlb({ width = 2048, height = 2048, mimeType = 'image/png' } = {}) {
  const bin = binBuilder()
  const view = bin.view(pngHeaderBytes(width, height))
  const json = {
    asset: { version: '2.0', generator: 'atrium-test-fixture' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    images: [{ bufferView: view, mimeType }],
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: bin.length }],
  }
  return packGlb(json, bin.bin())
}

/**
 * W6 — a GLB carrying `count` PNG images of the given size. The preflight sums
 * every image's estimate, so this is the model a world's texture budget is
 * measured against: a typical 2048-px PBR model with four 2k textures is
 * `multiImageGlb({ count: 4 })` ≈ 85.3 MiB.
 */
export function multiImageGlb({ count = 4, width = 2048, height = 2048, mimeType = 'image/png' } = {}) {
  const bin = binBuilder()
  const images = []
  for (let i = 0; i < count; i++) images.push({ bufferView: bin.view(pngHeaderBytes(width, height)), mimeType })
  const json = {
    asset: { version: '2.0', generator: 'atrium-test-fixture' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    images,
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: bin.length }],
  }
  return packGlb(json, bin.bin())
}
