// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// model-parse.test.js — models-by-url step 4 (Z3, A3 steps 4–6, A5, A8).
//
// Everything pure runs on measured numbers and hand-written headers (P5: no
// DOM, no image decoding, no textures in the fixtures). `parseTemplate` runs a
// real GLTFLoader over a real in-test GLB.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Vector3, Object3D, Mesh, BufferGeometry, BufferAttribute } from 'three'
import {
  imageHeader, estimateTextureBytes, readGlb, glbImages, preflightProblem,
  accessorByteTotal, positionVertexTotal, createTextureBudget,
  rewriteGltfJson, createUrlModifier, revokeBlobs, objectUrlApi,
  templateKey, createTemplateCache, countVertices, disposeTemplate, measureBounds,
  parseTemplate, MODEL_PARSE_LIMITS,
} from '../src/model-parse.js'
import { simpleGlb, modelGlb, packGlb, imageGlb } from './glb-fixture.js'

// ---------------------------------------------------------------------------
// Image headers (A5) — hand-built, no decoding
// ---------------------------------------------------------------------------

function pngHeader(width, height, colorType = 2) {
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

function jpegHeader(width, height) {
  const bytes = new Uint8Array(20)
  // SOI, then an APP0 segment whose declared length ends right before the SOF0.
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49], 0)
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 11)
  const view = new DataView(bytes.buffer)
  view.setUint16(16, height)
  view.setUint16(18, width)
  return bytes
}

function webpLossless(width, height) {
  const bytes = new Uint8Array(25)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)   // 'RIFF'
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)   // 'WEBP'
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12)  // 'VP8L'
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  new DataView(bytes.buffer).setUint32(21, bits, true)
  return bytes
}

test('A5: PNG, JPEG and WebP sizes come from their headers', () => {
  assert.deepEqual(imageHeader(pngHeader(512, 256)), { format: 'png', width: 512, height: 256, hasAlpha: false })
  assert.equal(imageHeader(pngHeader(4, 4, 6)).hasAlpha, true)
  assert.deepEqual(imageHeader(jpegHeader(300, 200)), { format: 'jpeg', width: 300, height: 200, hasAlpha: false })
  assert.deepEqual(imageHeader(webpLossless(64, 32)), { format: 'webp', width: 64, height: 32, hasAlpha: true })
})

test('A5: an unreadable or unknown header is null, which becomes unsupported-image', () => {
  assert.equal(imageHeader(new Uint8Array(32)), null)
  assert.equal(imageHeader(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(20).fill(0)])), null)
  const problem = preflightProblem({ nodes: [] }, [{ bytes: new Uint8Array(32) }])
  assert.equal(problem.reason, 'unsupported-image')
})

test('A5/L8: texture memory is w × h × 4 × 4/3', () => {
  assert.equal(estimateTextureBytes(1024, 1024), Math.ceil((1024 * 1024 * 4 * 4) / 3))
  assert.equal(estimateTextureBytes(0, 0), 0)
})

// ---------------------------------------------------------------------------
// A5 — the preflight
// ---------------------------------------------------------------------------

const meshJson = (count, extra = {}) => ({
  nodes: [{ name: 'n', mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count, type: 'VEC3' }],
  bufferViews: [{ byteOffset: 0, byteLength: count * 12 }],
  ...extra,
})

test('A5: the node cap, the vertex cap and the accessor-data cap', () => {
  const nodes = Array.from({ length: MODEL_PARSE_LIMITS.maxNodes + 1 }, () => ({ name: 'n' }))
  assert.equal(preflightProblem({ nodes }).reason, 'too-many-nodes')
  assert.equal(preflightProblem(meshJson(MODEL_PARSE_LIMITS.maxVertices + 1)).reason, 'too-many-vertices')
  // A big accessor that is NOT the POSITION one: the data cap, not the vertex cap.
  assert.equal(preflightProblem(meshJson(3, {
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 0, componentType: 5126, count: 6_000_000, type: 'MAT4' },
    ],
  })).reason, 'too-much-data')
})

test('A5: a vertex count at the cap passes and the preflight is pure', () => {
  const json = meshJson(MODEL_PARSE_LIMITS.maxVertices)
  const result = preflightProblem(json)
  assert.equal(result.reason, null)
  assert.equal(json.accessors[0].count, MODEL_PARSE_LIMITS.maxVertices, 'no mutation')
})

test('A5: a texture over 4096 px on either side is refused', () => {
  assert.equal(preflightProblem({ nodes: [] }, [{ bytes: pngHeader(4096, 4096) }]).reason, null)
  assert.equal(preflightProblem({ nodes: [] }, [{ bytes: pngHeader(4097, 10) }]).reason, 'texture-too-large')
  assert.equal(preflightProblem({ nodes: [] }, [{ bytes: pngHeader(10, 8192) }]).reason, 'texture-too-large')
})

test('A5: the preflight reports the summed texture bytes for the reservation', () => {
  const result = preflightProblem({ nodes: [] }, [{ bytes: pngHeader(1024, 1024) }])
  assert.equal(result.textureBytes, estimateTextureBytes(1024, 1024))
})

test('A5: accessor and POSITION totals count every accessor and primitive', () => {
  const json = {
    nodes: [],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 1 } }] },
      { primitives: [{ attributes: { POSITION: 0, NORMAL: 2 } }] },
    ],
    accessors: [
      { componentType: 5126, count: 10, type: 'VEC3', bufferView: 0 },
      { componentType: 5126, count: 5, type: 'VEC3', bufferView: 0 },
      { componentType: 5126, count: 20, type: 'VEC3', bufferView: 0 },
      { componentType: 5123, count: 30, type: 'SCALAR', sparse: { count: 30, indices: {}, values: {} } },
      { componentType: 5126, count: 99, type: 'VEC3' },   // no bufferView, no sparse: not stored
    ],
  }
  assert.equal(positionVertexTotal(json), 25)
  assert.equal(accessorByteTotal(json), 10 * 12 + 5 * 12 + 20 * 12 + 30 * 2)
})

// ---------------------------------------------------------------------------
// The GLB container
// ---------------------------------------------------------------------------

test('readGlb splits the JSON and binary chunks; a non-GLB is null', () => {
  const glb = simpleGlb({ name: 'Part', vertices: 4 })
  const read = readGlb(glb)
  assert.ok(read, 'the in-test GLB reads back')
  assert.equal(read.json.nodes[0].name, 'Part')
  assert.ok(read.bin.length >= 4 * 12)
  assert.equal(readGlb(new Uint8Array(32)), null)
  assert.equal(readGlb(new TextEncoder().encode('{"asset":{}}')), null)
})

test('glbImages finds an image held in a buffer view', () => {
  const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const json = { images: [{ bufferView: 0, mimeType: 'image/png' }], bufferViews: [{ byteOffset: 2, byteLength: 4 }] }
  const images = glbImages(json, bin)
  assert.equal(images.length, 1)
  assert.deepEqual([...images[0].bytes], [3, 4, 5, 6])
})

// ---------------------------------------------------------------------------
// A3 steps 4–6 — the rewrite, the URL modifier, the revocations
// ---------------------------------------------------------------------------

const fakeUrls = () => {
  let n = 0
  const revoked = []
  return {
    api: {
      createObjectURL: () => `blob:test/${++n}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
    revoked,
  }
}

test('A3 step 4: buffer and image URIs become blob: URLs; data: URIs are left alone', () => {
  const { api } = fakeUrls()
  const json = {
    buffers: [{ uri: 'm.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }],
    images: [{ uri: 'textures/a.png' }],
  }
  const dependencies = new Map([
    ['m.bin', { url: 'https://h/m.bin', bytes: new Uint8Array([1]) }],
    ['textures/a.png', { url: 'https://h/textures/a.png', bytes: new Uint8Array([2]) }],
  ])
  const { json: rewritten, blobUrls } = rewriteGltfJson(json, dependencies, api)
  assert.equal(json.buffers[0].uri, 'm.bin', 'the caller’s JSON is not mutated')
  assert.match(rewritten.buffers[0].uri, /^blob:test\//)
  assert.equal(rewritten.buffers[1].uri, 'data:application/octet-stream;base64,AAAA')
  assert.match(rewritten.images[0].uri, /^blob:test\//)
  assert.equal(blobUrls.size, 2)
})

test('A3 step 5: the URL modifier passes this load’s blob URLs and data:, and refuses anything else', () => {
  const { api } = fakeUrls()
  const blobUrls = new Map([['m.bin', 'blob:test/1']])
  const { modifier, violations, emptyBlobUrl } = createUrlModifier(blobUrls, api)
  assert.equal(modifier('blob:test/1'), 'blob:test/1')
  assert.equal(modifier('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(modifier('https://evil.example/x.bin'), emptyBlobUrl, 'an unmapped URL answers with an empty blob')
  assert.deepEqual(violations, ['https://evil.example/x.bin'])
})

test('A3 step 6: every blob URL this load created is revoked', () => {
  const { api, revoked } = fakeUrls()
  revokeBlobs(new Map([['a', 'blob:test/1'], ['b', 'blob:test/2']]), api)
  assert.deepEqual(revoked.sort(), ['blob:test/1', 'blob:test/2'])
})

test('objectUrlApi hands back an object-URL pair, native or stand-in', () => {
  const api = objectUrlApi()
  const url = api.createObjectURL(new Blob([new Uint8Array([1])]))
  assert.equal(typeof url, 'string')
  api.revokeObjectURL(url)
  // An injected pair is used verbatim, which is what the tests below rely on.
  const injected = objectUrlApi({ createObjectURL: () => 'blob:test/1', revokeObjectURL: () => {} })
  assert.equal(injected.createObjectURL(new Blob([])), 'blob:test/1')
})

// ---------------------------------------------------------------------------
// Z3/A8 — the template cache
// ---------------------------------------------------------------------------

const templateOf = (bytes) => ({ scene: {}, textureBytes: bytes })

test('A8: a template whose last instance goes idle is kept, not disposed', () => {
  const cache = createTemplateCache()
  const key = templateKey('https://h/m.glb')
  cache.set(key, templateOf(100))
  assert.equal(cache.get(key).idle, true, 'a fresh template has no instances')
  cache.acquire(key)
  assert.equal(cache.get(key).idle, false)
  cache.release(key)
  assert.equal(cache.get(key).idle, true)
  assert.equal(cache.size, 1, 'still cached')
})

test('A8: idle templates are evicted least-recently-used first, before refusing', () => {
  const cache = createTemplateCache()
  const a = templateKey('https://h/a.glb')
  const b = templateKey('https://h/b.glb')
  cache.set(a, templateOf(80))
  cache.set(b, templateOf(80))
  const budget = createTextureBudget({ bytes: 100 })
  budget.reserve(80)
  assert.equal(budget.fits(80), false, 'the second 80 bytes do not fit')
  const disposed = []
  const evicted = cache.evictIdleFor(80, budget, (t) => disposed.push(t))
  assert.deepEqual(evicted, [a], 'the least recently used goes first')
  assert.equal(budget.fits(80), true)
  assert.equal(cache.size, 1)
  assert.equal(disposed.length, 1)
})

test('A8: a template with a live instance is not evicted', () => {
  const cache = createTemplateCache()
  const a = templateKey('a')
  const b = templateKey('b')
  cache.set(a, templateOf(50))
  cache.set(b, templateOf(50))
  cache.acquire(a)
  const budget = createTextureBudget({ bytes: 60 })
  budget.reserve(50)
  const evicted = cache.evictIdleFor(50, budget, () => {})
  assert.deepEqual(evicted, [b], 'only the idle one may go')
  assert.equal(cache.size, 1)
  assert.ok(cache.get(a))
})

test('a world change clears and disposes everything (A9)', () => {
  const cache = createTemplateCache()
  cache.set('a', templateOf(1))
  cache.set('b', templateOf(1))
  const disposed = []
  cache.clear((t) => disposed.push(t))
  assert.equal(cache.size, 0)
  assert.equal(disposed.length, 2)
})

test('the texture budget refuses a reservation it cannot hold and releases it', () => {
  const budget = createTextureBudget({ bytes: 10 })
  assert.equal(budget.reserve(8), true)
  assert.equal(budget.reserve(8), false)
  budget.release(8)
  assert.equal(budget.reserve(8), true)
  budget.reset()
  assert.equal(budget.taken, 0)
})

// ---------------------------------------------------------------------------
// Z3 — parse and measure, with a real GLTFLoader
// ---------------------------------------------------------------------------

test('Z3: parseTemplate parses a real GLB and countVertices measures it', async () => {
  const glb = simpleGlb({ name: 'Part', vertices: 6 })
  const result = await parseTemplate({ kind: 'glb', bytes: glb })
  assert.equal(result.ok, true, result.message)
  assert.equal(countVertices(result.template.scene), 6)
})

test('Z3: parseTemplate refuses on the preflight, before the loader runs', async () => {
  const glb = simpleGlb({ vertices: 3 })
  const json = JSON.parse(new TextDecoder().decode(readGlb(glb).json ? new TextEncoder().encode('{}') : new Uint8Array()))
  assert.deepEqual(json, {})
  const nodes = Array.from({ length: MODEL_PARSE_LIMITS.maxNodes + 1 }, (_, i) => ({ name: `n${i}`, mesh: 0 }))
  const tooMany = packGlb({
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ componentType: 5126, count: 3, type: 'VEC3' }],
  })
  const result = await parseTemplate({ kind: 'glb', bytes: tooMany })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'too-many-nodes')
})

test('Z3: a .gltf whose JSON asks for an undeclared URL fails with unexpected-request', async () => {
  const { api } = fakeUrls()
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'p', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    bufferViews: [{ byteOffset: 0, byteLength: 36 }],
    buffers: [{ uri: 'https://elsewhere.example/m.bin', byteLength: 36 }],
  }
  const result = await parseTemplate({
    kind: 'gltf', bytes: new TextEncoder().encode(JSON.stringify(json)), json,
    dependencies: new Map(), urls: api,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unexpected-request')
})

test('Z3: measureBounds gives a size in metres, never below a millimetre', () => {
  const empty = new Object3D()
  assert.deepEqual(measureBounds(empty, Box3, Vector3), [0.001, 0.001, 0.001], 'an empty scene is still 1 mm')

  const mesh = new Mesh(new BufferGeometry())
  mesh.geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 2, 3, 0]), 3))
  assert.deepEqual(measureBounds(mesh, Box3, Vector3), [2, 3, 0.001], 'a flat model is 1 mm thick')
})

test('disposeTemplate disposes geometries, materials and textures once each', () => {
  const disposed = []
  const texture = { isTexture: true, dispose: () => disposed.push('texture') }
  const material = { map: texture, dispose: () => disposed.push('material') }
  const geometry = { dispose: () => disposed.push('geometry') }
  const template = { scene: { traverse: (fn) => { fn({ geometry, material }); fn({ geometry, material }) } } }
  disposeTemplate(template)
  assert.deepEqual(disposed.sort(), ['geometry', 'material', 'texture'])
})

test('modelGlb writes a parts-and-clip fixture the loader accepts', async () => {
  const result = await parseTemplate({ kind: 'glb', bytes: modelGlb({ parts: ['Door', 'Cube'], withLight: true, withCamera: true }) })
  assert.equal(result.ok, true, result.message)
  const names = []
  result.template.scene.traverse((o) => o.name && names.push(o.name))
  assert.ok(names.includes('Door') && names.includes('Cube'), names.join(','))
  assert.equal(result.template.animations.length, 1)
})

// ---------------------------------------------------------------------------
// W1 (round 3) — the world texture budget is actually charged
//
// Round 2 shipped `preflightFor` wrapping the whole preflight outcome as
// `{ problem }`, so `parseTemplate` read `preflight.textureBytes` — always
// `undefined` — and reserved nothing: five textured models in one world left
// `textureBudget.taken` at 0. Measured numbers and a loader stand-in only
// (P5: no image decoding).
// ---------------------------------------------------------------------------

/** A loader stand-in: these tests are about the reservation, not the parse. */
function quietLoader() {
  const calls = { parseAsync: 0 }
  return {
    calls,
    loader: { parseAsync: async () => { calls.parseAsync += 1; return { scene: {}, animations: [] } } },
  }
}

test('W1: a GLB holding a 2048×2048 PNG reserves estimateTextureBytes(2048, 2048), once', async () => {
  const { loader, calls } = quietLoader()
  const reservations = []
  const result = await parseTemplate({
    kind: 'glb',
    bytes: imageGlb({ width: 2048, height: 2048 }),
    reserveTexture: (n) => { reservations.push(n); return true },
    releaseTexture: () => {},
    loader,
  })
  assert.equal(result.ok, true, result.message)
  assert.equal(calls.parseAsync, 1, 'the GLB was parsed through the injected loader')
  assert.deepEqual(reservations, [estimateTextureBytes(2048, 2048)], 'one reservation, of the header’s estimate')
  assert.equal(result.textureBytes, estimateTextureBytes(2048, 2048))
})

test('W1/A5: with a one-byte budget the same GLB is refused world-texture-budget, before parsing', async () => {
  const { loader, calls } = quietLoader()
  const budget = createTextureBudget({ bytes: 1 })
  const result = await parseTemplate({
    kind: 'glb',
    bytes: imageGlb({ width: 2048, height: 2048 }),
    reserveTexture: (n) => budget.reserve(n),
    releaseTexture: (n) => budget.release(n),
    loader,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'world-texture-budget')
  assert.equal(calls.parseAsync, 0, 'the reservation is taken before the loader sees anything')
  assert.equal(budget.taken, 0, 'a refused reservation leaves the budget where it was')
})

test('W1/A5: a .gltf whose fetched texture does not fit is refused the same way', async () => {
  const { loader, calls } = quietLoader()
  const dependencyBytes = new Uint8Array(33)
  dependencyBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  dependencyBytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(dependencyBytes.buffer)
  view.setUint32(16, 1024)
  view.setUint32(20, 1024)
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [] }],
    images: [{ uri: 'textures/a.png' }],
  }
  const budget = createTextureBudget({ bytes: 1 })
  const result = await parseTemplate({
    kind: 'gltf',
    bytes: new TextEncoder().encode(JSON.stringify(json)),
    json,
    dependencies: new Map([['textures/a.png', { url: 'https://h/textures/a.png', bytes: dependencyBytes }]]),
    urls: fakeUrls().api,
    reserveTexture: (n) => budget.reserve(n),
    releaseTexture: (n) => budget.release(n),
    loader,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'world-texture-budget')
  assert.equal(calls.parseAsync, 0)
})
