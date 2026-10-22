// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { fileEntryProblem, includeMapProblem, itemIdProblem, remoteUrlProblem } from './keys.mjs'
import { CAPS } from './net.mjs'

export const API = 'https://api.polyhaven.com'

/** The API's `type` field: 0 = HDRI, 2 = model. */
const TYPE = { sky: 0, model: 2 }

/** Size flags (mm, from `/info`'s `dimensions`): the largest side outside 0.1–10 m. */
export const SIZE_FLAG_MM = Object.freeze({ min: 100, max: 10_000 })

export class ItemRefused extends Error {}

/** An author name, as the installer accepts it: 1–100 characters, no control characters, no `<` or `>`. */
export const AUTHOR_RE = /^[^\u0000-\u001f\u007f<>]{1,100}$/

/**
 * Validate `/info/<id>` for the expected kind and pull out what the catalog
 * keeps. Throws ItemRefused.
 */
export function readInfo(info, kind) {
  if (info === null || typeof info !== 'object') throw new ItemRefused('info is not an object')
  if (info.type !== TYPE[kind]) throw new ItemRefused(`info type ${info.type} is not a ${kind}`)
  const a = info.authors
  if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new ItemRefused('authors is not an object')
  const authors = Object.keys(a)
  if (authors.length === 0 || authors.length > 10) throw new ItemRefused('bad authors')
  for (const name of authors) {
    if (!AUTHOR_RE.test(name)) throw new ItemRefused('bad author name')
  }
  let thumbnailUrl = null
  if (kind === 'model') {
    const p = remoteUrlProblem(info.thumbnail_url)
    if (p) throw new ItemRefused(`thumbnail: ${p}`)
    thumbnailUrl = info.thumbnail_url
  }
  let dimensionsMm = null
  if (Array.isArray(info.dimensions) && info.dimensions.length === 3 && info.dimensions.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
    dimensionsMm = info.dimensions
  }
  return { authors, thumbnailUrl, dimensionsMm }
}

/** The 1k glTF entry of a model's `/files/<id>`, checked. Throws ItemRefused. */
export function readModelFiles(files) {
  const entry = files?.gltf?.['1k']?.gltf
  if (!entry) throw new ItemRefused('no gltf at 1k')
  const p = fileEntryProblem(entry)
  if (p) throw new ItemRefused(`gltf: ${p}`)
  if (entry.size > CAPS.gltf) throw new ItemRefused(`gltf claims ${entry.size} bytes, over ${CAPS.gltf}`)
  const ip = includeMapProblem(entry.include ?? {})
  if (ip) throw new ItemRefused(ip)
  let total = entry.size
  for (const inc of Object.values(entry.include ?? {})) {
    if (inc.size > CAPS.include) throw new ItemRefused(`an include claims ${inc.size} bytes, over ${CAPS.include}`)
    total += inc.size
  }
  if (total > CAPS.modelTotal) throw new ItemRefused(`claims ${total} bytes in all, over ${CAPS.modelTotal}`)
  return { gltf: entry, include: entry.include ?? {}, claimedBytes: total }
}

/** A sky's tonemapped JPG entry, checked. Throws ItemRefused. */
export function readSkyFiles(files) {
  const entry = files?.tonemapped
  if (!entry) throw new ItemRefused('no tonemapped JPG')
  const p = fileEntryProblem(entry)
  if (p) throw new ItemRefused(`tonemapped: ${p}`)
  if (entry.size > CAPS.skySource) throw new ItemRefused(`tonemapped claims ${entry.size} bytes, over ${CAPS.skySource}`)
  return { source: entry, claimedBytes: entry.size }
}

/** Fetch and check one item's info and files. */
export async function lookUp(fetcher, kind, id) {
  const idp = itemIdProblem(id)
  if (idp) throw new ItemRefused(idp)
  const info = readInfo(await fetcher.getJson(`${API}/info/${id}`), kind)
  const raw = await fetcher.getJson(`${API}/files/${id}`)
  const files = kind === 'model' ? readModelFiles(raw) : readSkyFiles(raw)
  return { info, files }
}

/** The size flag for `--check` and the build summary, or null. */
export function sizeFlag(largestMetres) {
  if (largestMetres < SIZE_FLAG_MM.min / 1000) return `small (${largestMetres.toFixed(3)} m)`
  if (largestMetres > SIZE_FLAG_MM.max / 1000) return `large (${largestMetres.toFixed(1)} m)`
  return null
}
