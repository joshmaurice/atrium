// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { createFetcher } from '../lib/net.mjs'
import { ItemRefused, lookUp } from '../lib/polyhaven.mjs'
import { buildModel } from '../lib/model.mjs'
import { loadAtriumChecks } from '../lib/atrium-checks.mjs'
import { createFakePolyHaven } from './fake-polyhaven.mjs'

async function buildOne(modelOptions = {}, limits) {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: [], modelOptions: { Box_01: modelOptions } })
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  const { files } = await lookUp(fetcher, 'model', 'Box_01')
  return { fake, result: buildModel({ id: 'Box_01', files, fetcher, limits }) }
}

test('a multi-file .gltf becomes one self-contained .glb that passes 3a', async () => {
  const { result } = await buildOne()
  const m = await result
  const checks = await loadAtriumChecks()
  const parsed = checks.readGlb(new Uint8Array(m.glb))
  assert.ok(parsed)
  assert.equal(checks.glbDependencyProblem(parsed.json), null)
  assert.equal(parsed.json.images.length, 2, 'both textures (sharing textures/) embedded')
  for (const img of parsed.json.images) assert.equal(img.uri, undefined)
  for (const buf of parsed.json.buffers) assert.equal(buf.uri, undefined)
  assert.deepEqual(m.bounds, [1, 1, 1])
  assert.equal(m.vertices, 8)
  assert.match(m.sha256, /^[0-9a-f]{64}$/)
})

test('the re-pivot puts an off-centre model\'s base centre at the origin', async () => {
  const { result } = await buildOne()
  const m = await result
  const doc = await new NodeIO().readBinary(new Uint8Array(m.glb))
  const { min, max } = getBounds(doc.getRoot().listScenes()[0])
  assert.ok(Math.abs(min[1]) < 1e-6, `base at y=0 (was 0.5), got ${min[1]}`)
  assert.ok(Math.abs((min[0] + max[0]) / 2) < 1e-6, 'centred in x (was 2.5)')
  assert.ok(Math.abs((min[2] + max[2]) / 2) < 1e-6, 'centred in z (was -3.5)')
})

test('a .gltf naming a file outside its include list is refused, and nothing outside is requested', async () => {
  for (const uri of ['../../../etc/passwd', '/etc/passwd', 'https://evil.example/x.png', 'textures/not_listed.jpg']) {
    const { fake, result } = await buildOne({ extraJson: (j) => { j.images[0].uri = uri } })
    await assert.rejects(result, (err) => err instanceof ItemRefused && /not one of its listed files/.test(err.message), uri)
    for (const url of fake.hits.keys()) assert.ok(!url.includes('passwd') && !url.includes('evil'), url)
  }
})

test('a data: image or a buffer with no uri is refused', async () => {
  const a = await buildOne({ extraJson: (j) => { j.images[0].uri = 'data:image/png;base64,AAAA' } })
  await assert.rejects(a.result, /not one of its listed files/)
  const b = await buildOne({ extraJson: (j) => { delete j.buffers[0].uri } })
  await assert.rejects(b.result, /has no file name/)
})

test('required extensions and compressed glTF are refused', async () => {
  const a = await buildOne({ extraJson: (j) => { j.extensionsRequired = ['KHR_texture_transform']; j.extensionsUsed = ['KHR_texture_transform'] } })
  await assert.rejects(a.result, /requires extensions/)
  const b = await buildOne({ extraJson: (j) => { j.extensionsUsed = ['KHR_draco_mesh_compression'] } })
  await assert.rejects(b.result, /Draco/)
})

test('3a\'s own preflight refuses: a texture over 4096 px', async () => {
  const { result } = await buildOne({ textureSide: 4100 })
  await assert.rejects(result, (err) => err instanceof ItemRefused && /3a refuses it/.test(err.message) && /4096/.test(err.message))
})

test('3a\'s own preflight refuses: too many vertices (limit lowered for the test)', async () => {
  const checks = await loadAtriumChecks()
  const { result } = await buildOne({}, { parse: { ...checks.MODEL_PARSE_LIMITS, maxVertices: 4 } })
  await assert.rejects(result, /3a refuses it: the model has too many vertices/)
})

test('the library\'s own texture limit (an eighth of a world) applies', async () => {
  const { result } = await buildOne({}, { textureBytes: 1000 })
  await assert.rejects(result, /over the library/)
})

test('only files the .gltf names are downloaded', async () => {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: [] })
  const entry = fake.api.Box_01.files.gltf['1k'].gltf
  entry.include['extra/unused.bin'] = { url: 'https://dl.polyhaven.org/file/unused.bin', size: 3, md5: '0'.repeat(32) }
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  const { files } = await lookUp(fetcher, 'model', 'Box_01')
  await buildModel({ id: 'Box_01', files, fetcher })
  assert.equal(fake.hits.get('https://dl.polyhaven.org/file/unused.bin'), undefined)
})

test('an include key that would escape is refused at lookup, before any file is fetched', async () => {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: [] })
  const entry = fake.api.Box_01.files.gltf['1k'].gltf
  entry.include['../escape.bin'] = { url: 'https://dl.polyhaven.org/file/x.bin', size: 3, md5: '0'.repeat(32) }
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  await assert.rejects(lookUp(fetcher, 'model', 'Box_01'), /dot segment/)
  assert.ok([...fake.hits.keys()].every((u) => u.startsWith('https://api.polyhaven.com/')))
})

test('a model whose files claim more than the caps is refused at lookup', async () => {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: [] })
  const entry = fake.api.Box_01.files.gltf['1k'].gltf
  for (const inc of Object.values(entry.include)) inc.size = 30 * 1024 * 1024
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  await assert.rejects(lookUp(fetcher, 'model', 'Box_01'), /in all, over/)
})

test('an API entry of the wrong kind is refused', async () => {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: ['Sky_01'] })
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  await assert.rejects(lookUp(fetcher, 'sky', 'Box_01'), /not a sky/)
  await assert.rejects(lookUp(fetcher, 'model', 'Sky_01'), /not a model/)
})

test('a malformed .gltf refuses that item instead of crashing the build (review finding 6)', async () => {
  for (const [fn, want] of [
    [(j) => { j.buffers = {} }, /buffers is not a list/],
    [(j) => { j.images = 'x' }, /images is not a list/],
    [(j) => { j.extensionsRequired = 'KHR_x' }, /extensionsRequired is not a list/],
    [(j) => { j.extensionsUsed = { a: 1 } }, /extensionsUsed is not a list/],
  ]) {
    const { result } = await buildOne({ extraJson: fn })
    await assert.rejects(result, (err) => err instanceof ItemRefused && want.test(err.message), String(want))
  }
})

test('authors given as a list, or with markup, are refused at lookup', async () => {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: [] })
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  fake.api.Box_01.info.authors = ['A', 'B']
  await assert.rejects(lookUp(fetcher, 'model', 'Box_01'), /authors is not an object/)
  fake.api.Box_01.info.authors = { '<script>': 'All' }
  await assert.rejects(lookUp(fetcher, 'model', 'Box_01'), /bad author name/)
})

test('the re-pivot uses world bounds: a box under a rotated, scaled, translated parent lands on its base centre', async () => {
  const { result } = await buildOne({ nested: true })
  const m = await result
  const doc = await new NodeIO().readBinary(new Uint8Array(m.glb))
  const { min, max } = getBounds(doc.getRoot().listScenes()[0])
  assert.ok(Math.abs(min[1]) < 1e-5, `base at y=0, got ${min[1]}`)
  assert.ok(Math.abs((min[0] + max[0]) / 2) < 1e-5 && Math.abs((min[2] + max[2]) / 2) < 1e-5)
  assert.deepEqual(m.bounds, [2, 2, 2])
})

test('author names with a lone surrogate or a bidi control are refused at lookup', async () => {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: [] })
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  for (const bad of ['Test \ud800 Author', 'a‮b', 'a\u0085b']) {
    fake.api.Box_01.info.authors = { [bad]: 'All' }
    await assert.rejects(lookUp(fetcher, 'model', 'Box_01'), /bad author name/, JSON.stringify(bad))
  }
  fake.api.Box_01.info.authors = { 'Jérôme Ünicode': 'All' }
  await lookUp(fetcher, 'model', 'Box_01')
})

test('size against Poly Haven\'s dimensions: ok, rescale a uniform slip, or flag', async () => {
  const { compareToApi } = await import('../lib/model.mjs')
  assert.equal(compareToApi([0.85, 1.07, 0.77], [848, 765, 1065]).action, 'ok')
  assert.equal(compareToApi([1, 1, 1], null).action, 'ok')
  const slip = compareToApi([10.97, 21.41, 5.02], [1097.4, 502.1, 2140.5])
  assert.equal(slip.action, 'rescale')
  assert.ok(Math.abs(slip.factor - 0.1) < 0.001, String(slip.factor))
  assert.equal(compareToApi([1, 2, 3], [1000, 2000, 6000]).action, 'flag')
})

test('a model built ten times too large is rescaled to Poly Haven\'s size before the re-pivot', async () => {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: [] })
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  const { files } = await lookUp(fetcher, 'model', 'Box_01')
  const m = await buildModel({ id: 'Box_01', files, fetcher, expectedMm: [100, 100, 100] })
  assert.deepEqual(m.bounds, [0.1, 0.1, 0.1])
  assert.match(m.sizeNote, /rescaled ×0\.100/)
  const doc = await new NodeIO().readBinary(new Uint8Array(m.glb))
  const { min, max } = getBounds(doc.getRoot().listScenes()[0])
  assert.ok(Math.abs(min[1]) < 1e-6 && Math.abs((min[0] + max[0]) / 2) < 1e-6, 'still on its base centre')
})

test('a model whose shape disagrees with Poly Haven\'s is built as is and flagged', async () => {
  const fake = await createFakePolyHaven({ models: ['Box_01'], skies: [] })
  const fetcher = createFetcher({ fetchFn: fake.fetchFn })
  const { files } = await lookUp(fetcher, 'model', 'Box_01')
  const m = await buildModel({ id: 'Box_01', files, fetcher, expectedMm: [1000, 1000, 3000] })
  assert.deepEqual(m.bounds, [1, 1, 1])
  assert.equal(m.rescaled, null)
  assert.match(m.sizeNote, /Poly Haven says/)
})
