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
  imageHeader, estimateTextureBytes, readGlb, glbImages, preflightProblem, glbDependencyProblem,
  accessorByteTotal, positionVertexTotal, createTextureBudget,
  rewriteGltfJson, createUrlModifier, revokeBlobs, objectUrlApi,
  templateKey, createTemplateCache, countVertices, disposeTemplate, measureBounds,
  parseTemplate, MODEL_PARSE_LIMITS,
} from '../src/model-parse.js'
import { simpleGlb, modelGlb, packGlb, imageGlb } from './glb-fixture.js'
import { createJobDeadline } from '@atrium/client/model-fetch'

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

// W6 (round 5) — decision L20: the world texture budget is 512 MiB, and the
// default budget READS the constant rather than repeating a 256 MiB literal, so
// the next change to the limit moves both together.
//
// The revision's scale line says "about six typical 2048-px PBR models (four 2k
// textures each)". The arithmetic is a hair tighter than that: `estimateTextureBytes`
// takes the CEILING per texture (2048² → 22,369,622 bytes), so a four-texture
// model is 85.33 MiB and six of them are 536,870,928 — 16 bytes over 512 MiB.
// Five fit whole and the sixth is refused. The boundary is pinned below, not
// asserted away.
test('W6/L20: worldTextureBytes is 512 MiB and the default budget reads the constant', () => {
  assert.equal(MODEL_PARSE_LIMITS.worldTextureBytes, 512 * 1024 * 1024, 'L20 raised the world budget to 512 MiB')
  assert.equal(createTextureBudget().limit, MODEL_PARSE_LIMITS.worldTextureBytes, 'the default budget takes the constant')

  const per2k = estimateTextureBytes(2048, 2048)          // one 2k texture with its mips
  const model = 4 * per2k                                 // a typical PBR model: four 2k textures
  assert.equal(model, 89_478_488, 'a four-texture 2k model is 85.33 MiB')
  assert.equal(Math.floor(MODEL_PARSE_LIMITS.worldTextureBytes / model), 5, 'five fit the 512 MiB budget')
  assert.equal(model * 6 - MODEL_PARSE_LIMITS.worldTextureBytes, 16,
    'a sixth is 16 bytes over — the per-texture ceiling, and why the revision’s “six” is five here')
  assert.ok(model * 2 <= 256 * 1024 * 1024, 'at 256 MiB only two fit')
  assert.ok(model * 3 > 256 * 1024 * 1024, 'the third was refused there')
})

// W3 (round 4) — the two bookkeeping rules the round-3 cache got wrong: an entry
// created for a load is created ACQUIRED by it (so the next model's eviction
// cannot take a template that is about to be, or already is, in use), and a
// redirect's second key is an ALIAS of one entry (one byte count, one dispose).
test('W3: an entry created for a load is created acquired, not idle', () => {
  const cache = createTemplateCache()
  const key = templateKey('https://h/held.glb')
  const entry = cache.set(key, templateOf(100), { acquired: true })
  assert.equal(entry.refs, 1, 'the load that is parsing it holds the entry')
  assert.equal(entry.idle, false)

  const budget = createTextureBudget({ bytes: 100 })
  budget.reserve(100)
  const disposed = []
  const evicted = cache.evictIdleFor(100, budget, (t) => disposed.push(t))
  assert.deepEqual(evicted, [], 'an entry a load still holds is not evictable')
  assert.deepEqual(disposed, [], 'and is never disposed')
  assert.equal(budget.taken, 100, 'its bytes are not released')
  assert.equal(cache.size, 1)
})

test('W3: a redirect’s second key is an alias of one entry', () => {
  const cache = createTemplateCache()
  const key = templateKey('https://h/alias.glb')
  const effective = templateKey('https://h/effective.glb')
  const entry = cache.set(key, templateOf(64), { acquired: true })

  assert.equal(cache.alias(effective, key), entry, 'the alias takes the same entry')
  assert.equal(cache.get(effective), entry)
  assert.equal(cache.size, 1, 'one entry, two keys')
  assert.equal(cache.keys().length, 2)
  assert.equal(cache.acquire(effective).refs, 2, 'both keys count the same references')
  cache.release(key)
  assert.equal(cache.get(effective).refs, 1, 'one release, whichever key it names')
  assert.equal(cache.alias(effective, key), entry, 'aliasing twice is the same entry, not a second one')

  assert.equal(cache.delete(effective), entry)
  assert.equal(cache.size, 0, 'the entry goes from every key it answered to')
  assert.equal(cache.get(key), null)
  assert.equal(cache.has(effective), false)
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
  view.setUint32(8, 13)              // M5: the IHDR chunk's own length is checked
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

// ---------------------------------------------------------------------------
// W2 (round 3) — a .gltf's `data:` images and buffer-view images are checked
//
// A5 says an image comes "from the GLB's buffer views or from A3's fetched
// bytes" and omits a `.gltf`'s `data:` image URIs, which `preflightFor` skipped
// entirely: the bytes counted toward the download (they are inside the counted
// file) but their format and dimensions were never read and their texture
// memory never reserved.
// ---------------------------------------------------------------------------

const base64Of = (bytes) => Buffer.from(bytes).toString('base64')

test('W2: a .gltf with an 8192×8192 data: image is refused texture-too-large before parsing', async () => {
  const { loader, calls } = quietLoader()
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [] }],
    images: [{ uri: `data:image/png;base64,${base64Of(pngHeader(8192, 8192))}` }],
  }
  const result = await parseTemplate({
    kind: 'gltf',
    bytes: new TextEncoder().encode(JSON.stringify(json)),
    json,
    dependencies: new Map(),
    urls: fakeUrls().api,
    loader,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'texture-too-large')
  assert.equal(result.message, 'the model has a texture larger than 4096 px (8192×8192)')
  assert.equal(calls.parseAsync, 0, 'the loader never saw the model')
})

test('W2/A5: a .gltf data: image that fits is measured and reserved like any other', async () => {
  const { loader } = quietLoader()
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [] }],
    images: [{ uri: `data:image/png;base64,${base64Of(pngHeader(1024, 1024))}` }],
  }
  const reservations = []
  const result = await parseTemplate({
    kind: 'gltf',
    bytes: new TextEncoder().encode(JSON.stringify(json)),
    json,
    dependencies: new Map(),
    urls: fakeUrls().api,
    reserveTexture: (n) => { reservations.push(n); return true },
    loader,
  })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(reservations, [estimateTextureBytes(1024, 1024)])
})

test('W2: a data: URI that is not `;base64,` is unsupported-image, not silently skipped', async () => {
  const { loader, calls } = quietLoader()
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [] }],
    images: [{ uri: 'data:image/png,notbase64' }],
  }
  const result = await parseTemplate({
    kind: 'gltf',
    bytes: new TextEncoder().encode(JSON.stringify(json)),
    json,
    dependencies: new Map(),
    urls: fakeUrls().api,
    loader,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unsupported-image')
  assert.equal(calls.parseAsync, 0)
})

test('W2: a .gltf image held in a buffer view is read from that buffer’s bytes and refused', async () => {
  const { loader, calls } = quietLoader()
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [] }],
    buffers: [{ uri: 'm.bin', byteLength: 33 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 33 }],
    images: [{ bufferView: 0, mimeType: 'image/png' }],
  }
  const result = await parseTemplate({
    kind: 'gltf',
    bytes: new TextEncoder().encode(JSON.stringify(json)),
    json,
    dependencies: new Map([['m.bin', { url: 'https://h/m.bin', bytes: pngHeader(8192, 8) }]]),
    urls: fakeUrls().api,
    loader,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'texture-too-large')
  assert.equal(calls.parseAsync, 0)
})

// ---------------------------------------------------------------------------
// M1 (round 6) — a .glb can no longer make the browser fetch anything
//
// Round 5 installed the fail-closed `LoadingManager` URL modifier only for a
// `.gltf`. `GLTFLoader` follows a `.glb`'s JSON `uri`s with its own loaders —
// outside `fetchModel`, its 25 MiB budget, the world ledger, the redirect check
// and the image preflight — so a hostile public world made every visitor's
// browser request any URL, with a `Referer` (Claude's headless probe fetched
// `probe.png` for a GLB declaring `images[0].uri = "/models/probe.png"`).
// ---------------------------------------------------------------------------

test('M1: glbDependencyProblem passes the binary chunk and data: URIs only', () => {
  assert.equal(glbDependencyProblem({ buffers: [{ byteLength: 4 }], images: [{ bufferView: 0 }] }), null)
  assert.equal(glbDependencyProblem({
    buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }],
    images: [{ uri: 'data:image/png;base64,AAAA' }],
  }), null)
  assert.equal(glbDependencyProblem({ buffers: [{ uri: 'm.bin' }] }).reason, 'bad-dependency')
  assert.match(glbDependencyProblem({ buffers: [{ uri: 'https://h/m.bin' }] }).message, /https:\/\/h\/m\.bin/)
  assert.equal(glbDependencyProblem({ images: [{ uri: '/models/probe.png' }] }).reason, 'bad-dependency')
  assert.equal(glbDependencyProblem({ images: [{ uri: 'probe.png' }] }).reason, 'bad-dependency')
  assert.equal(glbDependencyProblem({ images: [{}] }).reason, 'bad-dependency', 'an image with neither a bufferView nor a URI')
  assert.equal(glbDependencyProblem({ images: [{ bufferView: 0, uri: 'https://h/x.png' }] }).reason, 'bad-dependency',
    'a bufferView does not license a URI as well')
})

test('M1: the URL modifier passes data: and blob: and refuses an https: URL and a root-relative path', () => {
  const { api } = fakeUrls()
  const { modifier, violations, emptyBlobUrl } = createUrlModifier(new Map(), api)
  assert.equal(modifier('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(modifier('blob:http://localhost/1e2f'), 'blob:http://localhost/1e2f', 'GLTFLoader’s own image blob')
  assert.equal(modifier('https://evil.example/x.png'), emptyBlobUrl)
  assert.equal(modifier('/models/probe.png'), emptyBlobUrl)
  assert.equal(modifier('textures/a.png'), emptyBlobUrl)
  assert.deepEqual(violations, ['https://evil.example/x.png', '/models/probe.png', 'textures/a.png'])
})

test('M1: a .glb whose image names an external URI is refused before any loader call', async () => {
  const { loader, calls } = quietLoader()
  const bytes = packGlb({
    asset: { version: '2.0' }, scenes: [{ nodes: [] }], nodes: [],
    images: [{ uri: '/models/probe.png' }],
  })
  const result = await parseTemplate({ kind: 'glb', bytes, loader })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'bad-dependency')
  assert.match(result.message, /\/models\/probe\.png/)
  assert.equal(calls.parseAsync, 0, 'the loader never saw the model')
})

test('M1: a .glb whose buffer names an external URI is refused before any loader call', async () => {
  const { loader, calls } = quietLoader()
  const bytes = packGlb({
    asset: { version: '2.0' }, scenes: [{ nodes: [] }], nodes: [],
    buffers: [{ uri: 'https://elsewhere.example/m.bin', byteLength: 4 }],
  })
  const result = await parseTemplate({ kind: 'glb', bytes, loader })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'bad-dependency')
  assert.equal(calls.parseAsync, 0)
})

test('M1: a .glb with embedded images still parses, and gets the modifier its own manager', async () => {
  const { loader, calls } = quietLoader()
  const result = await parseTemplate({ kind: 'glb', bytes: imageGlb({ width: 64, height: 64 }), loader })
  assert.equal(result.ok, true, result.message)
  assert.equal(calls.parseAsync, 1)
  assert.ok(loader.manager, 'the loader was given a manager for every format, not only .gltf')
  const { api } = fakeUrls()
  const { modifier } = createUrlModifier(new Map(), api)
  assert.equal(modifier('https://evil.example/x.png').startsWith('blob:'), true, 'the installed modifier is fail-closed')
})

// ---------------------------------------------------------------------------
// M3 (round 6) — the parse gets what is LEFT of the job's deadline
//
// Round 5's fetcher stopped its 30 s timer when `fetchModel` returned and
// `parseTemplate` started a fresh 30 s of its own, so one model could take about
// 60 s. A parse that runs past the deadline cannot be stopped: the job is
// `timeout` at once, and when the parse settles, its template is disposed and
// the reservation it took is given back — against the budget of the generation
// it started in (M4's caller-owned closures).
// ---------------------------------------------------------------------------

test('M3: an expired job is refused timeout before the loader is built', async () => {
  const { loader, calls } = quietLoader()
  const reservations = []
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 30_000, now: () => clock })
  deadline.start()
  clock += 30_000
  const result = await parseTemplate({
    kind: 'glb', bytes: imageGlb({ width: 64, height: 64 }), loader, deadline,
    reserveTexture: (n) => { reservations.push(n); return true },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timeout')
  assert.equal(calls.parseAsync, 0, 'the loader never saw the model')
  assert.deepEqual(reservations, [], 'nothing is reserved for a job past its deadline')
})

test('M3: a parse that outlives the deadline is timeout at once, then disposes and releases once', async () => {
  const { loader } = quietLoader()
  const disposed = []
  const released = []
  const template = { scene: { traverse: (fn) => fn({ geometry: { dispose: () => disposed.push('geometry') } }) } }
  let settle = null
  const parsePromise = new Promise((resolve) => { settle = resolve })
  const slowLoader = { parseAsync: () => parsePromise }

  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 30, now: () => clock })
  deadline.start()
  clock += 26                       // 4 ms of the job's work left

  const result = await parseTemplate({
    kind: 'glb', bytes: imageGlb({ width: 64, height: 64 }), loader: slowLoader, deadline,
    reserveTexture: () => true,
    releaseTexture: (n) => released.push(n),
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timeout')
  assert.deepEqual(released, [], 'the parse is still holding its bytes')
  assert.deepEqual(disposed, [], 'and nothing is disposed while it runs')

  settle(template)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(disposed, ['geometry'], 'the late template is disposed exactly once')
  assert.deepEqual(released, [estimateTextureBytes(64, 64)], 'and its reservation is given back exactly once')
})

test('M3: a parse inside the deadline is not a timeout', async () => {
  const { loader, calls } = quietLoader()
  let clock = 0
  const deadline = createJobDeadline({ timeoutMs: 30_000, now: () => clock })
  deadline.start()
  clock += 1_000
  const result = await parseTemplate({ kind: 'glb', bytes: simpleGlb(), loader, deadline })
  assert.equal(result.ok, true, result.message)
  assert.equal(calls.parseAsync, 1)
})

// ---------------------------------------------------------------------------
// M5 (round 6) — the image preflight no longer accepts truncated headers
//
// Round 5's `imageHeader` asked only for 16 bytes and then read fields beyond
// them: a truncated PNG was accepted as 0 × 0 and charged nothing, a truncated
// WebP `VP8X` as 1 × 1, and an image whose bytes were not there dropped out of
// the preflight list altogether.
// ---------------------------------------------------------------------------

/** A `VP8 ` (lossy) WebP header, 30 bytes. */
function webpSimple(width, height) {
  const bytes = new Uint8Array(30)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)   // 'RIFF'
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)   // 'WEBP'
  bytes.set([0x56, 0x50, 0x38, 0x20], 12)  // 'VP8 '
  const view = new DataView(bytes.buffer)
  view.setUint16(26, width, true)
  view.setUint16(28, height, true)
  return bytes
}

/** A `VP8X` (extended) WebP header, 30 bytes. */
function webpExtended(width, height, alpha = false) {
  const bytes = new Uint8Array(30)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)   // 'RIFF'
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)   // 'WEBP'
  bytes.set([0x56, 0x50, 0x38, 0x58], 12)  // 'VP8X'
  bytes[20] = alpha ? 0x10 : 0
  const w = width - 1
  const h = height - 1
  bytes[24] = w & 0xff; bytes[25] = (w >> 8) & 0xff; bytes[26] = (w >> 16) & 0xff
  bytes[27] = h & 0xff; bytes[28] = (h >> 8) & 0xff; bytes[29] = (h >> 16) & 0xff
  return bytes
}

test('M5: every format is refused at every field boundary', () => {
  const png = pngHeader(512, 256)
  for (let length = 8; length < 26; length++) assert.equal(imageHeader(png.subarray(0, length)), null, `png, ${length} bytes`)
  assert.equal(imageHeader(png.subarray(0, 26)).width, 512, 'the width and height end at byte 24')
  const badChunkLength = pngHeader(512, 256)
  badChunkLength[11] = 12
  assert.equal(imageHeader(badChunkLength), null, 'the IHDR chunk length must be 13')

  const jpeg = jpegHeader(300, 200)
  for (let length = 2; length < 20; length++) assert.equal(imageHeader(jpeg.subarray(0, length)), null, `jpeg, ${length} bytes`)
  assert.deepEqual(imageHeader(jpeg), { format: 'jpeg', width: 300, height: 200, hasAlpha: false })
  const walked = jpegHeader(300, 200)
  new DataView(walked.buffer).setUint16(4, 0x7fff)   // the APP0 segment walks off the end
  assert.equal(imageHeader(walked), null)

  const lossless = webpLossless(64, 32)
  for (let length = 16; length < 25; length++) assert.equal(imageHeader(lossless.subarray(0, length)), null, `webp VP8L, ${length} bytes`)
  assert.equal(imageHeader(lossless).width, 64)

  const simple = webpSimple(80, 40)
  for (let length = 16; length < 30; length++) assert.equal(imageHeader(simple.subarray(0, length)), null, `webp VP8, ${length} bytes`)
  assert.deepEqual(imageHeader(simple), { format: 'webp', width: 80, height: 40, hasAlpha: false })

  const extended = webpExtended(100, 50, true)
  for (let length = 16; length < 30; length++) assert.equal(imageHeader(extended.subarray(0, length)), null, `webp VP8X, ${length} bytes`)
  assert.deepEqual(imageHeader(extended), { format: 'webp', width: 100, height: 50, hasAlpha: true })
})

test('M5: a zero width or height is unsupported-image, whatever the header said', () => {
  assert.equal(preflightProblem({ nodes: [] }, [{ bytes: pngHeader(0, 256) }]).reason, 'unsupported-image')
  assert.equal(preflightProblem({ nodes: [] }, [{ bytes: pngHeader(256, 0) }]).reason, 'unsupported-image')
  assert.equal(preflightProblem({ nodes: [] }, [{ bytes: pngHeader(0, 0) }]).reason, 'unsupported-image')
  // The exact round-5 hole: 24 bytes of a valid PNG were read as 0 × 0 and charged nothing.
  const truncated = pngHeader(512, 256).subarray(0, 24)
  assert.equal(imageHeader(truncated), null)
  assert.equal(preflightProblem({ nodes: [] }, [{ bytes: truncated }]).reason, 'unsupported-image')
})

test('M5: a declared image with no bytes is refused, never silently skipped', async () => {
  const bin = new Uint8Array([1, 2, 3, 4])
  const json = { images: [{ bufferView: 0 }, { bufferView: 9 }], bufferViews: [{ byteOffset: 0, byteLength: 4 }] }
  const images = glbImages(json, bin)
  assert.equal(images.length, 2, 'every declared image is reported, bytes or not')
  assert.equal(images[1].bytes, null)
  assert.equal(preflightProblem(json, images).reason, 'unsupported-image')

  // A .gltf whose image bytes were never fetched is refused, not dropped.
  const { loader, calls } = quietLoader()
  const gltf = {
    asset: { version: '2.0' }, scenes: [{ nodes: [] }],
    images: [{ uri: 'textures/missing.png' }],
  }
  const result = await parseTemplate({
    kind: 'gltf', bytes: new TextEncoder().encode(JSON.stringify(gltf)), json: gltf,
    dependencies: new Map(), urls: fakeUrls().api, loader,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unsupported-image')
  assert.equal(calls.parseAsync, 0)
})

test('M5: a .glb’s data: image is measured like any other', () => {
  const bytes = packGlb({
    asset: { version: '2.0' }, scenes: [{ nodes: [] }], nodes: [],
    images: [{ uri: `data:image/png;base64,${base64Of(pngHeader(1024, 1024))}` }],
  })
  const read = readGlb(bytes)
  const outcome = preflightProblem(read.json, glbImages(read.json, read.bin))
  assert.equal(outcome.reason, null)
  assert.equal(outcome.textureBytes, estimateTextureBytes(1024, 1024))
})
