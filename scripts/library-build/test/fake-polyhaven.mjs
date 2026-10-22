// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * A fake Poly Haven for the tests: an in-process `fetch` that answers the
 * API's and the file hosts' URLs from generated fixtures. Tests change
 * `routes` to make it misbehave.
 */

import { createHash } from 'node:crypto'
import { Document, NodeIO } from '@gltf-transform/core'
import sharp from 'sharp'

export const md5 = (b) => createHash('md5').update(b).digest('hex')

export async function jpeg(width, height, rgb = [120, 80, 40]) {
  return sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .jpeg({ quality: 80 }).toBuffer()
}

/**
 * A box model as a multi-file .gltf: one buffer and two textures sharing
 * `textures/`. Its geometry is deliberately off-centre (x from 2 to 3, y from
 * 0.5 to 1.5, z from -4 to -3) so the re-pivot has something to do.
 *
 * @returns {Promise<{json: object, resources: Record<string, Uint8Array>}>}
 */
export async function boxGltf({ id = 'Box_01', textureSide = 64, extraJson = null, nested = false } = {}) {
  const doc = new Document()
  const buffer = doc.createBuffer().setURI(`${id}.bin`)
  const positions = new Float32Array([
    2, 0.5, -4, 3, 0.5, -4, 3, 1.5, -4, 2, 1.5, -4,
    2, 0.5, -3, 3, 0.5, -3, 3, 1.5, -3, 2, 1.5, -3,
  ])
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1])
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2])
  const pos = doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer)
  const uv = doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer)
  const idx = doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer)
  const diff = doc.createTexture('diff').setMimeType('image/jpeg').setURI(`textures/${id}_diff_1k.jpg`)
    .setImage(new Uint8Array(await jpeg(textureSide, textureSide)))
  const nor = doc.createTexture('nor').setMimeType('image/jpeg').setURI(`textures/${id}_nor_gl_1k.jpg`)
    .setImage(new Uint8Array(await jpeg(textureSide, textureSide, [128, 128, 255])))
  const mat = doc.createMaterial('m').setBaseColorTexture(diff).setNormalTexture(nor)
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(mat)
  const mesh = doc.createMesh('box').addPrimitive(prim)
  const node = doc.createNode('box').setMesh(mesh)
  if (nested) {
    // A rotated, scaled, translated parent: the re-pivot must use world bounds.
    const s = Math.SQRT1_2
    const parent = doc.createNode('parent').setRotation([0, s, 0, s]).setScale([2, 2, 2]).setTranslation([10, -7, 3]).addChild(node)
    doc.createScene('scene').addChild(parent)
  } else {
    doc.createScene('scene').addChild(node)
  }
  const { json, resources } = await new NodeIO().writeJSON(doc)
  if (extraJson) extraJson(json)
  return { json, resources }
}

const FILE_HOST = 'https://dl.polyhaven.org/file/ph-assets'

/**
 * Build the fake. `models` and `skies` are lists of ids; each can be
 * customised through `modelOptions[id]` (passed to boxGltf) before start.
 */
export async function createFakePolyHaven({ models = ['Box_01'], skies = ['Sky_01'], modelOptions = {}, skySize = [4096, 2048] } = {}) {
  const routes = new Map()   // url -> () => Response
  const hits = new Map()
  const api = {}             // id -> { info, files } (mutable by tests)

  const serve = (url, bytes, headers = {}) => {
    routes.set(url, () => new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream', ...headers } }))
  }

  for (const id of models) {
    const { json, resources } = await boxGltf({ id, ...(modelOptions[id] ?? {}) })
    const gltfBytes = Buffer.from(JSON.stringify(json))
    const gltfUrl = `${FILE_HOST}/Models/gltf/1k/${id}/${id}_1k.gltf`
    serve(gltfUrl, gltfBytes)
    const include = {}
    for (const [uri, data] of Object.entries(resources)) {
      // Poly Haven's real 1k .bin lives under 4k/: the key, not the URL, is the path.
      const url = `${FILE_HOST}/Models/gltf/${uri.endsWith('.bin') ? '4k' : '1k'}/${id}/${uri}`
      const b = Buffer.from(data)
      serve(url, b)
      include[uri] = { url, size: b.length, md5: md5(b) }
    }
    const thumbUrl = `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`
    const thumb = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#406080' } }).png().toBuffer()
    serve(thumbUrl, thumb)
    api[id] = {
      info: { name: id, type: 2, authors: { 'Test Author': 'All' }, thumbnail_url: thumbUrl, dimensions: [1000, 1000, 1000] },
      files: { gltf: { '1k': { gltf: { url: gltfUrl, size: gltfBytes.length, md5: md5(gltfBytes), include } } } },
    }
  }

  for (const id of skies) {
    const src = await sharp({
      create: { width: skySize[0], height: skySize[1], channels: 3, background: '#88aadd' },
    }).jpeg({ quality: 90 }).toBuffer()
    const url = `${FILE_HOST}/HDRIs/extra/Tonemapped%20JPG/${id}.jpg`
    serve(url, src)
    api[id] = {
      info: { name: id, type: 0, authors: { 'Sky Author': 'All' }, thumbnail_url: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png` },
      files: { tonemapped: { url, size: src.length, md5: md5(src) } },
    }
  }

  async function fetchFn(url, init = {}) {
    hits.set(url, (hits.get(url) ?? 0) + 1)
    if (init.redirect !== 'manual') throw new Error('the tool must use redirect: manual')
    const m = /^https:\/\/api\.polyhaven\.com\/(info|files)\/(.+)$/.exec(url)
    if (m && !routes.has(url)) {
      const entry = api[m[2]]
      if (!entry) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify(m[1] === 'info' ? entry.info : entry.files), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const route = routes.get(url)
    if (!route) return new Response('not found', { status: 404 })
    return route(init)
  }

  return { fetchFn, routes, hits, api, serve }
}

/** A body that never ends (for cap tests). */
export function endlessBody(chunk = 64 * 1024) {
  return new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(chunk)) } })
}
