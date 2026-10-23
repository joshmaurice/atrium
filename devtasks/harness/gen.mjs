// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
import { writeFile } from 'node:fs/promises'
const LB = (process.env.ATRIUM_REPO ?? '/home/claude/atrium') + '/scripts/library-build'
const { createFakePolyHaven, md5 } = await import(LB + '/test/fake-polyhaven.mjs')
const { run } = await import(LB + '/build.mjs')
const sharp = (await import(LB + '/node_modules/sharp/dist/index.cjs')).default

const [,, kind, outDir] = process.argv
let items, modelOptions = {}, skyColors = {}
if (kind === 'small') {
  const scales = {
    Tiny_Cube: [0.2, 0.2, 0.2], Long_Bench: [3, 0.5, 0.8], Tall_Tower: [0.5, 2.5, 0.5],
    Flat_Rug: [2, 0.05, 1.5], Big_Block: [2.5, 1.5, 2], Side_Table: [0.6, 0.7, 0.6],
    Plain_Box: [1, 1, 1], Nested_Box: null,
  }
  const cats = { Tiny_Cube: 'Misc', Long_Bench: 'Seating', Tall_Tower: 'Lighting', Flat_Rug: 'Misc',
    Big_Block: 'Storage', Side_Table: 'Tables', Plain_Box: 'Storage', Nested_Box: 'Misc' }
  globalThis.__scales = scales
  for (const [id, s] of Object.entries(scales)) {
    modelOptions[id] = s ? { extraJson: (j) => { j.nodes[0].scale = s } } : { nested: true }
  }
  items = {
    models: Object.keys(scales).map((id) => ({ id, name: id.replace('_', ' '), category: cats[id] })),
    skies: [{ id: 'Blue_Sky', name: 'Blue Sky' }, { id: 'Sunset_Glow', name: 'Sunset Glow' }, { id: 'Night_Green', name: 'Night Green' }],
  }
  skyColors = { Blue_Sky: '#4f8fe0', Sunset_Glow: '#e07a3f', Night_Green: '#1f5e3a' }
} else {
  const models = []
  for (let i = 1; i <= 30; i++) {
    const id = `Heavy_${String(i).padStart(2, '0')}`
    models.push({ id, name: `Heavy ${i}`, category: 'Heavy' })
    modelOptions[id] = { textureSide: 2048 }
  }
  items = { models, skies: [{ id: 'Grey_Sky', name: 'Grey Sky' }] }
}
const fake = await createFakePolyHaven({ models: items.models.map((m) => m.id), skies: items.skies.map((s) => s.id), modelOptions })
for (const m of items.models) {
  const o = modelOptions[m.id]
  if (kind === 'small') fake.api[m.id].info.dimensions = (globalThis.__scales[m.id] ?? [2, 2, 2]).map((v) => v * 1000)
}
for (const [id, color] of Object.entries(skyColors)) {
  const entry = fake.api[id]
  const url = entry.files.tonemapped.url
  const buf = await sharp({ create: { width: 4096, height: 2048, channels: 3, background: color } }).jpeg({ quality: 90 }).toBuffer()
  fake.serve(url, buf)
  entry.files.tonemapped.size = buf.length
  entry.files.tonemapped.md5 = md5(buf)
}
const itemsPath = outDir + '.items.json'
await writeFile(itemsPath, JSON.stringify(items, null, 2))
const code = await run(['--out', outDir, itemsPath], { fetchFn: fake.fetchFn, log: (...a) => console.log(...a) })
console.log('exit', code)
