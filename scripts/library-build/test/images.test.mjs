// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { sniffImage, buildSky, buildModelThumbnail } from '../lib/images.mjs'
import { createFetcher } from '../lib/net.mjs'
import { md5 } from './fake-polyhaven.mjs'

const URL_A = 'https://dl.polyhaven.org/file/sky.jpg'
const URL_T = 'https://cdn.polyhaven.com/thumb.png'
const serving = (bytes) => async () => new Response(bytes)

test('only JPEG, PNG and WebP signatures are recognised', async () => {
  assert.equal(sniffImage(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).jpeg().toBuffer()), 'jpeg')
  assert.equal(sniffImage(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toBuffer()), 'png')
  assert.equal(sniffImage(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).webp().toBuffer()), 'webp')
  for (const other of ['<svg xmlns="http://www.w3.org/2000/svg"/>', 'II*\u0000tiff', 'GIF89a', '']) assert.equal(sniffImage(Buffer.from(other, 'latin1')), null)
})

test('a sky or thumbnail that is not one of the three formats never reaches a decoder', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="2048"/>')
  const fetcher = createFetcher({ fetchFn: serving(svg) })
  await assert.rejects(buildSky({ source: { url: URL_A, size: svg.length, md5: md5(svg) }, fetcher }), /not jpeg by its signature/)
  await assert.rejects(buildModelThumbnail({ url: URL_T, fetcher }), /not jpeg, png, webp by its signature/)
  const png = await sharp({ create: { width: 4096, height: 2048, channels: 3, background: '#000' } }).png().toBuffer()
  await assert.rejects(buildSky({ source: { url: URL_A, size: png.length, md5: md5(png) }, fetcher: createFetcher({ fetchFn: serving(png) }) }), /not jpeg by its signature/)
})
