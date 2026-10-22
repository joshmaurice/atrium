// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import sharp from 'sharp'
import { CAPS } from './net.mjs'
import { ItemRefused } from './polyhaven.mjs'
import { sha256Hex } from './catalog.mjs'

/** L24 — a library sky is exactly this size. */
export const SKY_SIZE = Object.freeze({ width: 4096, height: 2048 })
export const SKY_QUALITY = 85
/** The largest source sharp will decode (16k equirectangular). */
export const SKY_SOURCE_MAX_PIXELS = 16384 * 8192
export const THUMB_MODEL = Object.freeze({ width: 256, height: 256 })
export const THUMB_SKY = Object.freeze({ width: 256, height: 128 })
const THUMB_SOURCE_MAX_PIXELS = 4096 * 4096
const THUMB_QUALITY = 80

// Deterministic output: one thread, no cache between items.
sharp.concurrency(1)
sharp.cache(false)

async function metadataOf(bytes, maxPixels, what) {
  try {
    return await sharp(bytes, { limitInputPixels: maxPixels, failOn: 'error' }).metadata()
  } catch (err) {
    throw new ItemRefused(`${what} is not a readable image: ${err.message}`)
  }
}

/** A model's thumbnail: fetched from the API's thumbnail URL, re-encoded. */
export async function buildModelThumbnail({ url, fetcher }) {
  const bytes = await fetcher.get(url, { cap: CAPS.thumbnail })
  const meta = await metadataOf(bytes, THUMB_SOURCE_MAX_PIXELS, 'the thumbnail')
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new ItemRefused(`the thumbnail is ${meta.format}`)
  if (!(meta.width <= 4096 && meta.height <= 4096)) throw new ItemRefused('the thumbnail is too large')
  const out = await sharp(bytes, { limitInputPixels: THUMB_SOURCE_MAX_PIXELS })
    .resize(THUMB_MODEL.width, THUMB_MODEL.height, { fit: 'cover' })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer()
  return { bytes: out, sha256: sha256Hex(out) }
}

/**
 * A library sky (L24): Poly Haven's tonemapped JPG, checked to be a 2:1
 * equirectangular JPEG, resized to 4096 × 2048, JPEG q85, plus its thumbnail.
 */
export async function buildSky({ source, fetcher }) {
  const bytes = await fetcher.get(source.url, { cap: CAPS.skySource, size: source.size, md5: source.md5 })
  const meta = await metadataOf(bytes, SKY_SOURCE_MAX_PIXELS, 'the sky')
  if (meta.format !== 'jpeg') throw new ItemRefused(`the sky source is ${meta.format}, not JPEG`)
  if (meta.width !== meta.height * 2) throw new ItemRefused(`the sky source is ${meta.width}×${meta.height}, not 2:1`)
  if (meta.width < SKY_SIZE.width) throw new ItemRefused(`the sky source is narrower than ${SKY_SIZE.width}`)
  const sky = await sharp(bytes, { limitInputPixels: SKY_SOURCE_MAX_PIXELS })
    .resize(SKY_SIZE.width, SKY_SIZE.height, { fit: 'fill', kernel: 'lanczos3' })
    .jpeg({ quality: SKY_QUALITY, chromaSubsampling: '4:2:0' })
    .toBuffer()
  const thumb = await sharp(sky)
    .resize(THUMB_SKY.width, THUMB_SKY.height, { fit: 'fill' })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer()
  return {
    sky, sha256: sha256Hex(sky), bytes: sky.length,
    thumb, thumbSha256: sha256Hex(thumb),
    sourceWidth: meta.width, sourceHeight: meta.height,
  }
}
