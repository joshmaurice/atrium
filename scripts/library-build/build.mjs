#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * Atrium's starter-library builder (step 3b, H1). Run by the operator on the
 * host as an unprivileged user; it only ever writes into a new staging
 * directory. Installing the files is `install-library.sh`'s job, run by root
 * from a pinned copy (H2).
 *
 *   node build.mjs --check items.json
 *   node build.mjs --out <new dir> items.json
 *   node build.mjs --verify <dir> <catalog.json>
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFetcher, FetchRefused } from './lib/net.mjs'
import { itemIdProblem } from './lib/keys.mjs'
import { ItemRefused, lookUp, sizeFlag } from './lib/polyhaven.mjs'
import { buildModel } from './lib/model.mjs'
import { buildModelThumbnail, buildSky, SKY_SIZE } from './lib/images.mjs'
import { CATALOG_VERSION, CREDIT, CREDIT_URL, URL_PREFIX, catalogFiles, contentName, verifyStaging } from './lib/catalog.mjs'

// The same rules install-library.sh applies to the catalog.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ()'.,&-]{0,47}$/
const CATEGORY_RE = /^[A-Z][A-Za-z ]{0,23}$/

/** Read and check items.json: `{ models: [{id, name, category}], skies: [{id, name}] }`. */
export function readItems(json) {
  if (json === null || typeof json !== 'object') throw new Error('items.json is not an object')
  const models = json.models ?? []
  const skies = json.skies ?? []
  if (!Array.isArray(models) || !Array.isArray(skies)) throw new Error('models and skies must be arrays')
  const seen = new Set()
  const check = (item, kind, i) => {
    const where = `${kind}s[${i}]`
    const p = itemIdProblem(item?.id)
    if (p) throw new Error(`${where}: ${p}`)
    if (seen.has(item.id)) throw new Error(`${where}: duplicate id ${item.id}`)
    seen.add(item.id)
    if (typeof item.name !== 'string' || !NAME_RE.test(item.name)) throw new Error(`${where}: bad name`)
    if (kind === 'model' && (typeof item.category !== 'string' || !CATEGORY_RE.test(item.category))) {
      throw new Error(`${where}: bad category`)
    }
  }
  models.forEach((m, i) => check(m, 'model', i))
  skies.forEach((s, i) => check(s, 'sky', i))
  return {
    models: models.map(({ id, name, category }) => ({ id, name, category })),
    skies: skies.map(({ id, name }) => ({ id, name })),
  }
}

const mb = (n) => (n / (1024 * 1024)).toFixed(2)

function table(rows, log) {
  if (rows.length === 0) return
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)))
  for (const r of rows) log(r.map((v, c) => String(v).padEnd(widths[c])).join('  ').trimEnd())
}

async function check(items, fetcher, log) {
  const rows = [['kind', 'id', 'claimed MB', 'flag', 'status']]
  let refused = 0
  for (const kind of ['model', 'sky']) {
    for (const item of kind === 'model' ? items.models : items.skies) {
      try {
        const { info, files } = await lookUp(fetcher, kind, item.id)
        const flag = kind === 'model' && info.dimensionsMm ? sizeFlag(Math.max(...info.dimensionsMm) / 1000) : null
        rows.push([kind, item.id, mb(files.claimedBytes), flag ?? '', 'ok'])
      } catch (err) {
        if (!(err instanceof ItemRefused) && !(err instanceof FetchRefused)) throw err
        refused++
        rows.push([kind, item.id, '', '', `REFUSED: ${err.message}`])
      }
    }
  }
  table(rows, log)
  log(refused ? `${refused} item(s) refused` : 'all items ok')
  return refused ? 1 : 0
}

async function build(items, outDir, fetcher, log, limits) {
  // A new directory only: never write into anything that already exists.
  await mkdir(outDir, { mode: 0o755 })
  for (const sub of ['models', 'skies', 'thumbs']) await mkdir(join(outDir, sub), { mode: 0o755 })
  const write = (rel, bytes) => writeFile(join(outDir, rel), bytes, { flag: 'wx', mode: 0o644 })

  const catalog = { version: CATALOG_VERSION, credit: CREDIT, creditUrl: CREDIT_URL, generator: 'atrium-library-build/1', models: [], skies: [] }
  const rows = [['kind', 'id', 'MB', 'vertices', 'texture MB', 'size (m)', 'flag', 'status']]
  let refused = 0
  let textureTotal = 0

  for (const item of items.models) {
    try {
      const { info, files } = await lookUp(fetcher, 'model', item.id)
      const model = await buildModel({ id: item.id, files, fetcher, limits, expectedMm: info.dimensionsMm })
      const thumb = await buildModelThumbnail({ url: info.thumbnailUrl, fetcher })
      const glbRel = contentName('models', item.id, model.sha256, 'glb')
      const thumbRel = contentName('thumbs', item.id, thumb.sha256, 'webp')
      await write(glbRel, model.glb)
      await write(thumbRel, thumb.bytes)
      catalog.models.push({
        id: item.id, name: item.name, category: item.category,
        url: URL_PREFIX + glbRel, sha256: model.sha256, bounds: model.bounds,
        bytes: model.bytes, vertices: model.vertices, textureBytes: model.textureBytes,
        thumbnail: URL_PREFIX + thumbRel, thumbnailSha256: thumb.sha256,
        license: 'CC0-1.0', authors: info.authors, source: `https://polyhaven.com/a/${item.id}`,
      })
      textureTotal += model.textureBytes
      const flag = [model.sizeNote, sizeFlag(Math.max(...model.bounds))].filter(Boolean).join('; ')
      rows.push(['model', item.id, mb(model.bytes), model.vertices, mb(model.textureBytes), model.bounds.map((n) => n.toFixed(2)).join(' × '), flag ?? '', 'ok'])
    } catch (err) {
      if (!(err instanceof ItemRefused) && !(err instanceof FetchRefused)) throw err
      refused++
      rows.push(['model', item.id, '', '', '', '', '', `REFUSED: ${err.message}`])
    }
  }

  for (const item of items.skies) {
    try {
      const { info, files } = await lookUp(fetcher, 'sky', item.id)
      const sky = await buildSky({ source: files.source, fetcher })
      const skyRel = contentName('skies', item.id, sky.sha256, 'jpg')
      const thumbRel = contentName('thumbs', item.id, sky.thumbSha256, 'webp')
      await write(skyRel, sky.sky)
      await write(thumbRel, sky.thumb)
      catalog.skies.push({
        id: item.id, name: item.name,
        url: URL_PREFIX + skyRel, sha256: sky.sha256,
        width: SKY_SIZE.width, height: SKY_SIZE.height, bytes: sky.bytes,
        thumbnail: URL_PREFIX + thumbRel, thumbnailSha256: sky.thumbSha256,
        license: 'CC0-1.0', authors: info.authors, source: `https://polyhaven.com/a/${item.id}`,
      })
      rows.push(['sky', item.id, mb(sky.bytes), '', '', `${sky.sourceWidth}×${sky.sourceHeight} → ${SKY_SIZE.width}×${SKY_SIZE.height}`, '', 'ok'])
    } catch (err) {
      if (!(err instanceof ItemRefused) && !(err instanceof FetchRefused)) throw err
      refused++
      rows.push(['sky', item.id, '', '', '', '', '', `REFUSED: ${err.message}`])
    }
  }

  table(rows, log)
  log(`texture estimate, all models together: ${mb(textureTotal)} MB (a world holds 512)`)
  log(`requests made: ${fetcher.requests}`)
  if (refused) {
    log(`${refused} item(s) refused: NO catalog.json written. Strike them from items.json and build into a new directory.`)
    return 1
  }
  catalogFiles(catalog)   // the same rules the installer and the client apply
  await write('catalog.json', JSON.stringify(catalog, null, 2) + '\n')
  log(`wrote ${catalog.models.length} models and ${catalog.skies.length} skies to ${outDir}`)
  log('next: node build.mjs --verify <dir> <dir>/catalog.json, then root runs the pinned install-library.sh (H2)')
  return 0
}

async function verify(dir, catalogPath, log) {
  let catalog
  try { catalog = JSON.parse(await readFile(catalogPath, 'utf8')) } catch (err) { log(`cannot read the catalog: ${err.message}`); return 1 }
  const { ok, problems, extra } = await verifyStaging(dir, catalog)
  for (const p of problems) log(`PROBLEM: ${p}`)
  for (const e of extra) log(`EXTRA: ${e} is not in the catalog (the installer refuses a staging directory with extra files)`)
  log(problems.length || extra.length ? `verify FAILED (${ok} ok)` : `verify OK: ${ok} files`)
  return problems.length || extra.length ? 1 : 0
}

/**
 * @param {string[]} argv
 * @param {object} [deps]  test seams: { fetchFn, log, limits }
 * @returns {Promise<number>} exit code
 */
export async function run(argv, { fetchFn, log = console.log, limits } = {}) {
  const usage = 'usage: build.mjs --check <items.json> | --out <new dir> <items.json> | --verify <dir> <catalog.json>'
  const [mode, a, b] = argv
  if (mode === '--verify' && a && b && argv.length === 3) return verify(resolve(a), resolve(b), log)
  let items
  const itemsPath = mode === '--check' ? a : mode === '--out' ? b : null
  if (!itemsPath || argv.length !== (mode === '--check' ? 2 : 3)) { log(usage); return 64 }
  try { items = readItems(JSON.parse(await readFile(itemsPath, 'utf8'))) } catch (err) { log(`items: ${err.message}`); return 65 }
  const fetcher = createFetcher(fetchFn ? { fetchFn } : {})
  if (mode === '--check') return check(items, fetcher, log)
  return build(items, resolve(a), fetcher, log, limits)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code }, (err) => {
    console.error(err?.stack ?? err)
    process.exitCode = 70
  })
}
