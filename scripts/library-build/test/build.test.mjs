// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, symlink, readdir, appendFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { run } from '../build.mjs'
import { catalogFiles, PATH_PATTERNS, sha256Hex } from '../lib/catalog.mjs'
import { createFakePolyHaven } from './fake-polyhaven.mjs'

const ITEMS = {
  models: [{ id: 'Box_01', name: 'Box', category: 'Misc' }, { id: 'Box_02', name: 'Box Two', category: 'Seating' }],
  skies: [{ id: 'Sky_01', name: 'Sky' }],
}

async function setup(items = ITEMS, fakeOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'libbuild-'))
  const itemsPath = join(dir, 'items.json')
  await writeFile(itemsPath, JSON.stringify(items))
  const fake = await createFakePolyHaven({
    models: items.models.map((m) => m.id), skies: items.skies.map((s) => s.id), ...fakeOptions,
  })
  const lines = []
  const log = (l) => lines.push(l)
  return { dir, itemsPath, fake, lines, log }
}

test('--check: every item ok, exit 0, no files fetched', async () => {
  const s = await setup()
  assert.equal(await run(['--check', s.itemsPath], { fetchFn: s.fake.fetchFn, log: s.log }), 0)
  assert.ok([...s.fake.hits.keys()].every((u) => u.startsWith('https://api.polyhaven.com/')))
  assert.match(s.lines.join('\n'), /all items ok/)
})

test('--check: flags an odd size from the API\'s dimensions, and refuses a bad item with exit 1', async () => {
  const s = await setup()
  s.fake.api.Box_01.info.dimensions = [20000, 500, 500]
  s.fake.api.Box_02.files.gltf['1k'].gltf.include['../x.bin'] = { url: 'https://dl.polyhaven.org/x', size: 1, md5: '0'.repeat(32) }
  assert.equal(await run(['--check', s.itemsPath], { fetchFn: s.fake.fetchFn, log: s.log }), 1)
  const out = s.lines.join('\n')
  assert.match(out, /Box_01.*large \(20\.0 m\).*ok/)
  assert.match(out, /Box_02.*REFUSED: .*dot segment/)
})

test('--out: builds models, skies, thumbnails and a catalog that --verify accepts', async () => {
  const s = await setup()
  const out = join(s.dir, 'stage')
  assert.equal(await run(['--out', out, s.itemsPath], { fetchFn: s.fake.fetchFn, log: s.log }), 0)
  const catalog = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8'))
  assert.equal(catalog.version, 1)
  assert.equal(catalog.models.length, 2)
  assert.equal(catalog.skies.length, 1)
  assert.equal(catalog.models[1].category, 'Seating')
  assert.deepEqual(catalog.models[0].authors, ['Test Author'])
  assert.equal(catalog.models[0].license, 'CC0-1.0')
  assert.equal(catalogFiles(catalog).length, 6)
  for (const m of catalog.models) assert.match(m.url, PATH_PATTERNS.model)
  const sky = catalog.skies[0]
  const skyMeta = await sharp(await readFile(join(out, sky.url.slice('/assets/library/'.length)))).metadata()
  assert.deepEqual([skyMeta.format, skyMeta.width, skyMeta.height], ['jpeg', 4096, 2048])
  const t1 = await sharp(await readFile(join(out, catalog.models[0].thumbnail.slice(16)))).metadata()
  assert.deepEqual([t1.format, t1.width, t1.height], ['webp', 256, 256])
  const t2 = await sharp(await readFile(join(out, sky.thumbnail.slice(16)))).metadata()
  assert.deepEqual([t2.format, t2.width, t2.height], ['webp', 256, 128])
  for (const f of catalogFiles(catalog)) {
    const st = await stat(join(out, f.url.slice(16)))
    assert.equal(st.mode & 0o777, 0o644)
  }
  s.lines.length = 0
  assert.equal(await run(['--verify', out, join(out, 'catalog.json')], { log: s.log }), 0)
  assert.match(s.lines.join('\n'), /verify OK: 6 files/)
})

test('two builds of the same items produce identical bytes', async () => {
  const s = await setup()
  const a = join(s.dir, 'a')
  const b = join(s.dir, 'b')
  assert.equal(await run(['--out', a, s.itemsPath], { fetchFn: s.fake.fetchFn, log: () => {} }), 0)
  assert.equal(await run(['--out', b, s.itemsPath], { fetchFn: s.fake.fetchFn, log: () => {} }), 0)
  assert.equal(sha256Hex(await readFile(join(a, 'catalog.json'))), sha256Hex(await readFile(join(b, 'catalog.json'))))
  for (const sub of ['models', 'skies', 'thumbs']) assert.deepEqual(await readdir(join(a, sub)), await readdir(join(b, sub)))
})

test('--out never writes into something that already exists (a directory or a symlink)', async () => {
  const s = await setup()
  const existing = join(s.dir, 'exists')
  await mkdir(existing)
  await assert.rejects(run(['--out', existing, s.itemsPath], { fetchFn: s.fake.fetchFn, log: () => {} }), /EEXIST/)
  const link = join(s.dir, 'link')
  await symlink('/tmp', link)
  await assert.rejects(run(['--out', link, s.itemsPath], { fetchFn: s.fake.fetchFn, log: () => {} }), /EEXIST/)
})

test('a refused item means exit 1 and no catalog.json', async () => {
  const s = await setup()
  s.fake.api.Box_02.files.gltf['1k'].gltf.md5 = 'f'.repeat(32)
  const out = join(s.dir, 'stage')
  assert.equal(await run(['--out', out, s.itemsPath], { fetchFn: s.fake.fetchFn, log: s.log }), 1)
  await assert.rejects(stat(join(out, 'catalog.json')), /ENOENT/)
  assert.match(s.lines.join('\n'), /Box_02.*REFUSED: md5/)
  assert.match(s.lines.join('\n'), /NO catalog\.json written/)
})

test('skies: a 16k-style source is downsized; a non-2:1, too-narrow or non-JPEG source is refused', async () => {
  const big = await setup({ models: [], skies: [{ id: 'Sky_01', name: 'Sky' }] }, { skySize: [8192, 4096] })
  assert.equal(await run(['--out', join(big.dir, 's'), big.itemsPath], { fetchFn: big.fake.fetchFn, log: big.log }), 0)
  assert.match(big.lines.join('\n'), /8192×4096 → 4096×2048/)

  const odd = await setup({ models: [], skies: [{ id: 'Sky_01', name: 'Sky' }] }, { skySize: [4096, 4096] })
  assert.equal(await run(['--out', join(odd.dir, 's'), odd.itemsPath], { fetchFn: odd.fake.fetchFn, log: odd.log }), 1)
  assert.match(odd.lines.join('\n'), /not 2:1/)

  const narrow = await setup({ models: [], skies: [{ id: 'Sky_01', name: 'Sky' }] }, { skySize: [2048, 1024] })
  assert.equal(await run(['--out', join(narrow.dir, 's'), narrow.itemsPath], { fetchFn: narrow.fake.fetchFn, log: narrow.log }), 1)
  assert.match(narrow.lines.join('\n'), /narrower than 4096/)

  const png = await setup({ models: [], skies: [{ id: 'Sky_01', name: 'Sky' }] })
  const pngBytes = await sharp({ create: { width: 4096, height: 2048, channels: 3, background: '#000' } }).png().toBuffer()
  const url = png.fake.api.Sky_01.files.tonemapped.url
  png.fake.serve(url, pngBytes)
  png.fake.api.Sky_01.files.tonemapped.size = pngBytes.length
  png.fake.api.Sky_01.files.tonemapped.md5 = (await import('./fake-polyhaven.mjs')).md5(pngBytes)
  assert.equal(await run(['--out', join(png.dir, 's'), png.itemsPath], { fetchFn: png.fake.fetchFn, log: png.log }), 1)
  assert.match(png.lines.join('\n'), /not jpeg by its signature/)
})

test('--verify catches a changed file, an extra file and a catalog path that escapes', async () => {
  const s = await setup()
  const out = join(s.dir, 'stage')
  assert.equal(await run(['--out', out, s.itemsPath], { fetchFn: s.fake.fetchFn, log: () => {} }), 0)
  const catalog = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8'))

  const lines = []
  await writeFile(join(out, 'thumbs', 'stray.webp'), 'x')
  assert.equal(await run(['--verify', out, join(out, 'catalog.json')], { log: (l) => lines.push(l) }), 1)
  assert.match(lines.join('\n'), /EXTRA: thumbs\/stray\.webp/)

  await appendFile(join(out, catalog.models[0].url.slice(16)), 'tamper')
  lines.length = 0
  assert.equal(await run(['--verify', out, join(out, 'catalog.json')], { log: (l) => lines.push(l) }), 1)
  assert.match(lines.join('\n'), /sha256 differs/)

  for (const bad of ['/assets/library/models/../x-0123456789ab.glb', '/assets/library/%2e%2e/x.glb', '/assets/library/models/Box_01-0123456789ab.glb?x']) {
    const c = structuredClone(catalog)
    c.models[0].url = bad
    const p = join(s.dir, 'bad.json')
    await writeFile(p, JSON.stringify(c))
    lines.length = 0
    assert.equal(await run(['--verify', out, p], { log: (l) => lines.push(l) }), 1, bad)
    assert.match(lines.join('\n'), /bad model path/)
  }
})

test('bad arguments and bad items.json', async () => {
  const s = await setup()
  assert.equal(await run(['--check'], { log: () => {} }), 64)
  assert.equal(await run(['--bogus', 'x'], { log: () => {} }), 64)
  const p = join(s.dir, 'bad-items.json')
  for (const items of [{ models: [{ id: '../x', name: 'x', category: 'Misc' }] }, { models: [{ id: 'A', name: 'x', category: 'Misc' }, { id: 'A', name: 'y', category: 'Misc' }] }, { models: [{ id: 'A', name: 'x', category: 'bad/cat' }] }]) {
    await writeFile(p, JSON.stringify(items))
    assert.equal(await run(['--check', p], { log: () => {} }), 65, JSON.stringify(items))
  }
})

test('--verify refuses what the installer would: a top-level extra, a nested directory', async () => {
  const s = await setup()
  const out = join(s.dir, 'stage')
  assert.equal(await run(['--out', out, s.itemsPath], { fetchFn: s.fake.fetchFn, log: () => {} }), 0)
  await writeFile(join(out, 'stray.txt'), 'x')
  await mkdir(join(out, 'models', 'nested'))
  const lines = []
  assert.equal(await run(['--verify', out, join(out, 'catalog.json')], { log: (l) => lines.push(l) }), 1)
  assert.match(lines.join('\n'), /EXTRA: stray\.txt/)
  assert.match(lines.join('\n'), /EXTRA: models\/nested/)
})

test('the build summary shows a rescale from the API\'s dimensions', async () => {
  const s = await setup()
  s.fake.api.Box_01.info.dimensions = [10000, 10000, 10000]
  const out = join(s.dir, 'stage')
  assert.equal(await run(['--out', out, s.itemsPath], { fetchFn: s.fake.fetchFn, log: s.log }), 0)
  assert.match(s.lines.join('\n'), /Box_01.*10\.00 × 10\.00 × 10\.00.*rescaled ×10\.0/)
  const catalog = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8'))
  assert.deepEqual(catalog.models[0].bounds, [10, 10, 10])
})
