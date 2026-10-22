// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Z1's exact path patterns, one per kind. The client's `loadCatalog`, this
 * tool's `--verify` and `install-library.sh` all use these same three.
 */
export const PATH_PATTERNS = Object.freeze({
  model: /^\/assets\/library\/models\/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.glb$/,
  sky: /^\/assets\/library\/skies\/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.jpg$/,
  thumb: /^\/assets\/library\/thumbs\/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.webp$/,
})

export const URL_PREFIX = '/assets/library/'
export const CATALOG_VERSION = 1
export const CREDIT = 'Models and skies from Poly Haven (CC0)'
export const CREDIT_URL = 'https://polyhaven.com'

const SHA256_RE = /^[0-9a-f]{64}$/

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** `models/ArmChair_01-0123456789ab.glb` for an id, a hash and an extension. */
export function contentName(dir, id, sha256, ext) {
  return `${dir}/${id}-${sha256.slice(0, 12)}.${ext}`
}

/**
 * Every file a catalog names, as `{ kind, url, sha256 }`. Throws on any entry
 * whose path doesn't match its pattern, whose name hash doesn't match its
 * sha256, or whose sha256 is malformed.
 */
export function catalogFiles(catalog) {
  if (catalog === null || typeof catalog !== 'object') throw new Error('catalog is not an object')
  if (catalog.version !== CATALOG_VERSION) throw new Error(`catalog version must be ${CATALOG_VERSION}`)
  const out = []
  const add = (kind, url, sha256, where) => {
    if (typeof url !== 'string' || !PATH_PATTERNS[kind].test(url)) throw new Error(`${where}: bad ${kind} path ${JSON.stringify(url)}`)
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) throw new Error(`${where}: bad sha256`)
    if (!url.endsWith(`-${sha256.slice(0, 12)}${url.slice(url.lastIndexOf('.'))}`)) throw new Error(`${where}: name hash differs from sha256`)
    out.push({ kind, url, sha256 })
  }
  for (const [i, m] of (catalog.models ?? []).entries()) {
    add('model', m?.url, m?.sha256, `models[${i}]`)
    add('thumb', m?.thumbnail, m?.thumbnailSha256, `models[${i}].thumbnail`)
  }
  for (const [i, s] of (catalog.skies ?? []).entries()) {
    add('sky', s?.url, s?.sha256, `skies[${i}]`)
    add('thumb', s?.thumbnail, s?.thumbnailSha256, `skies[${i}].thumbnail`)
  }
  const seen = new Set()
  for (const f of out) {
    if (seen.has(f.url)) throw new Error(`duplicate path ${f.url}`)
    seen.add(f.url)
  }
  return out
}

/**
 * `--verify`: every file the catalog names exists in `dir` as a regular file
 * (not a symlink) with the catalog's sha256.
 *
 * @returns {Promise<{ok: number, problems: string[], extra: string[]}>}
 */
export async function verifyStaging(dir, catalog) {
  const problems = []
  let files
  try { files = catalogFiles(catalog) } catch (err) { return { ok: 0, problems: [err.message], extra: [] } }
  const named = new Set()
  let ok = 0
  for (const f of files) {
    const rel = f.url.slice(URL_PREFIX.length)
    named.add(rel)
    const path = join(dir, rel)
    let st
    try { st = await lstat(path) } catch { problems.push(`missing: ${rel}`); continue }
    if (!st.isFile()) { problems.push(`not a regular file: ${rel}`); continue }
    if (sha256Hex(await readFile(path)) !== f.sha256) { problems.push(`sha256 differs: ${rel}`); continue }
    ok++
  }
  // Exactly what the installer accepts: catalog.json, the three directories,
  // and in them only files the catalog names.
  const extra = []
  const top = await readdir(dir, { withFileTypes: true })
  for (const e of top) {
    if (e.name === 'catalog.json' && e.isFile()) continue
    if (['models', 'skies', 'thumbs'].includes(e.name) && e.isDirectory()) {
      for (const f of await readdir(join(dir, e.name), { withFileTypes: true })) {
        if (!(f.isFile() && named.has(`${e.name}/${f.name}`))) extra.push(`${e.name}/${f.name}`)
      }
      continue
    }
    extra.push(e.name)
  }
  return { ok, problems, extra }
}
