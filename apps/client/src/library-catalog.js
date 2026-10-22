// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * library-catalog.js — the starter library's catalog (Phase 3 step 3b, Z1).
 *
 * Pure logic, no DOM and no three.js: `app.js` wires it, and the tests drive it
 * with plain values and a stub `fetch`. The catalog is DATA, committed at
 * `apps/client/library/catalog.json` and never edited by hand.
 *
 * Every entry is validated and an invalid one is DROPPED with a console warning,
 * so one bad entry cannot take the whole library with it. Paths are checked as
 * EXACT STRINGS, never by prefix and never after URL parsing: the patterns admit
 * no `.`-segment, no `%`, no query and no fragment, so no URL normalization can
 * move a path out of its directory (review R5).
 */

import { modelBoundsProblem } from '@atrium/client/model-spec'

/** The catalog's own cap, enforced WHILE READING (Z1). */
export const CATALOG_MAX_BYTES = 256 * 1024

/** The catalog's version; any other value is not this catalog. */
export const CATALOG_VERSION = 1

/** Where the catalog sits, two directories up from this module (see below). */
export function defaultCatalogUrl(moduleUrl) {
  return new URL('../library/catalog.json', moduleUrl)
}

/**
 * The catalog URL. The page is served at the SITE ROOT, so a page-relative
 * `library/catalog.json` would ask the site root for `/library/catalog.json`
 * and 404: this is resolved against the MODULE's own URL, which is
 * `/apps/client/src/`, giving `/apps/client/library/catalog.json`.
 */
export const CATALOG_URL = defaultCatalogUrl(import.meta.url)

/** The one pattern per kind: content-addressed, served from /assets/library/. */
export const MODEL_URL_RE = /^\/assets\/library\/models\/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.glb$/
export const SKY_URL_RE = /^\/assets\/library\/skies\/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.jpg$/
export const THUMBNAIL_URL_RE = /^\/assets\/library\/thumbs\/[A-Za-z0-9_]{1,64}-[0-9a-f]{12}\.webp$/

const SHA256_RE = /^[0-9a-f]{64}$/

/** The exact key sets (Z1). An entry with any other key is dropped. */
export const MODEL_ENTRY_KEYS = Object.freeze([
  'id', 'name', 'category', 'url', 'sha256', 'bounds', 'bytes', 'vertices', 'textureBytes',
  'thumbnail', 'thumbnailSha256', 'license', 'authors', 'source',
])
export const SKY_ENTRY_KEYS = Object.freeze([
  'id', 'name', 'url', 'sha256', 'width', 'height', 'bytes',
  'thumbnail', 'thumbnailSha256', 'license', 'authors', 'source',
])

/** L26 — a sky's sides and area. */
export const SKY_MAX_SIDE = 4096
export const SKY_MAX_AREA = 4096 * 2048

/** The empty catalog: what the UI falls back to when the file can't be read. */
export const EMPTY_CATALOG = Object.freeze({
  version: CATALOG_VERSION,
  credit: null,
  creditUrl: null,
  models: Object.freeze([]),
  skies: Object.freeze([]),
})

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v) => typeof v === 'string' && v.length > 0
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isSha256 = (v) => typeof v === 'string' && SHA256_RE.test(v)
const isAuthors = (v) => Array.isArray(v) && v.length > 0 && v.every(isString)

/** The 12 hex a content-addressed name carries, or null. */
export function nameHash(path) {
  if (typeof path !== 'string') return null
  const leaf = path.split('/').pop()
  const match = leaf?.match(/-([0-9a-f]{12})\.(?:glb|jpg|webp)$/)
  return match ? match[1] : null
}

/**
 * Z1 — the value rule for one model entry. Returns a reason, or null.
 * @param {*} entry
 */
export function modelEntryProblem(entry) {
  if (!isPlainObject(entry)) return 'entry-type'
  if (Object.keys(entry).length !== MODEL_ENTRY_KEYS.length) return 'entry-keys'
  if (Object.keys(entry).some((key) => !MODEL_ENTRY_KEYS.includes(key))) return 'entry-keys'
  if (!isString(entry.id)) return 'id'
  if (!isString(entry.name)) return 'name'
  if (!isString(entry.category)) return 'category'
  if (typeof entry.url !== 'string' || !MODEL_URL_RE.test(entry.url)) return 'url'
  if (typeof entry.thumbnail !== 'string' || !THUMBNAIL_URL_RE.test(entry.thumbnail)) return 'thumbnail'
  if (!isSha256(entry.sha256)) return 'sha256'
  if (!isSha256(entry.thumbnailSha256)) return 'thumbnail-sha256'
  if (nameHash(entry.url) !== entry.sha256.slice(0, 12)) return 'hash-tie'
  if (nameHash(entry.thumbnail) !== entry.thumbnailSha256.slice(0, 12)) return 'thumbnail-hash-tie'
  if (modelBoundsProblem(entry.bounds) !== null) return 'bounds'
  if (!isCount(entry.bytes) || !isCount(entry.vertices) || !isCount(entry.textureBytes)) return 'bytes'
  if (!isString(entry.license) || !isString(entry.source)) return 'license'
  if (!isAuthors(entry.authors)) return 'authors'
  return null
}

/**
 * Z1 — the value rule for one sky entry. Returns a reason, or null.
 * @param {*} entry
 */
export function skyEntryProblem(entry) {
  if (!isPlainObject(entry)) return 'entry-type'
  if (Object.keys(entry).length !== SKY_ENTRY_KEYS.length) return 'entry-keys'
  if (Object.keys(entry).some((key) => !SKY_ENTRY_KEYS.includes(key))) return 'entry-keys'
  if (!isString(entry.id)) return 'id'
  if (!isString(entry.name)) return 'name'
  if (typeof entry.url !== 'string' || !SKY_URL_RE.test(entry.url)) return 'url'
  if (typeof entry.thumbnail !== 'string' || !THUMBNAIL_URL_RE.test(entry.thumbnail)) return 'thumbnail'
  if (!isSha256(entry.sha256)) return 'sha256'
  if (!isSha256(entry.thumbnailSha256)) return 'thumbnail-sha256'
  if (nameHash(entry.url) !== entry.sha256.slice(0, 12)) return 'hash-tie'
  if (nameHash(entry.thumbnail) !== entry.thumbnailSha256.slice(0, 12)) return 'thumbnail-hash-tie'
  if (!Number.isInteger(entry.width) || !Number.isInteger(entry.height)) return 'size'
  if (entry.width < 1 || entry.height < 1) return 'size'
  if (entry.width > SKY_MAX_SIDE || entry.height > SKY_MAX_SIDE) return 'size'
  if (entry.width * entry.height > SKY_MAX_AREA) return 'size'
  if (!isCount(entry.bytes)) return 'bytes'
  if (!isString(entry.license) || !isString(entry.source)) return 'license'
  if (!isAuthors(entry.authors)) return 'authors'
  return null
}

/**
 * Z1 — validate a parsed catalog. Every invalid entry is dropped (and reported
 * through `warn`); a bad `version`, or a `models`/`skies` that is not an array,
 * fails the whole catalog.
 *
 * @param {*} json
 * @param {{warn?: Function}} [opts]
 * @returns {{ok: true, catalog: object, dropped: {models: number, skies: number}}
 *          | {ok: false, reason: string}}
 */
export function parseCatalog(json, { warn = console.warn } = {}) {
  if (!isPlainObject(json)) return { ok: false, reason: 'shape' }
  if (json.version !== CATALOG_VERSION) return { ok: false, reason: 'version' }
  if (!Array.isArray(json.models) || !Array.isArray(json.skies)) return { ok: false, reason: 'shape' }

  const models = []
  const skies = []
  const seenModels = new Set()
  const seenSkies = new Set()
  let droppedModels = 0
  let droppedSkies = 0

  for (const entry of json.models) {
    const problem = modelEntryProblem(entry)
    if (problem) { droppedModels += 1; warn?.(`library catalog: dropping model entry ${describe(entry)}: ${problem}`); continue }
    if (seenModels.has(entry.id)) { droppedModels += 1; warn?.(`library catalog: dropping model entry ${entry.id}: duplicate-id`); continue }
    seenModels.add(entry.id)
    models.push(freezeModel(entry))
  }
  for (const entry of json.skies) {
    const problem = skyEntryProblem(entry)
    if (problem) { droppedSkies += 1; warn?.(`library catalog: dropping sky entry ${describe(entry)}: ${problem}`); continue }
    if (seenSkies.has(entry.id)) { droppedSkies += 1; warn?.(`library catalog: dropping sky entry ${entry.id}: duplicate-id`); continue }
    seenSkies.add(entry.id)
    skies.push(freezeSky(entry))
  }

  return {
    ok: true,
    catalog: {
      version: CATALOG_VERSION,
      credit: isString(json.credit) ? json.credit : null,
      creditUrl: isString(json.creditUrl) ? json.creditUrl : null,
      models,
      skies,
    },
    dropped: { models: droppedModels, skies: droppedSkies },
  }
}

/** A short label for a dropped entry, for the warning. */
function describe(entry) {
  if (!isPlainObject(entry)) return '(not an object)'
  return typeof entry.id === 'string' ? `"${entry.id}"` : '(no id)'
}

/** The checked fields, copied out of the parsed document. */
function freezeModel(entry) {
  return Object.freeze({
    id: entry.id, name: entry.name, category: entry.category,
    url: entry.url, sha256: entry.sha256, bounds: Object.freeze([...entry.bounds]),
    bytes: entry.bytes, vertices: entry.vertices, textureBytes: entry.textureBytes,
    thumbnail: entry.thumbnail, thumbnailSha256: entry.thumbnailSha256,
    license: entry.license, authors: Object.freeze([...entry.authors]), source: entry.source,
  })
}

function freezeSky(entry) {
  return Object.freeze({
    id: entry.id, name: entry.name,
    url: entry.url, sha256: entry.sha256, width: entry.width, height: entry.height,
    bytes: entry.bytes,
    thumbnail: entry.thumbnail, thumbnailSha256: entry.thumbnailSha256,
    license: entry.license, authors: Object.freeze([...entry.authors]), source: entry.source,
  })
}

/**
 * Z1 — read the body of a response under `CATALOG_MAX_BYTES`, aborting the
 * stream the moment it is crossed. This is 3a's streaming reader
 * (`packages/client/src/model-fetch.js`, `readBody`) in the small: a declared
 * Content-Length is refused early, and every chunk is counted as it arrives, so
 * a body that never ends is aborted rather than buffered.
 */
async function readCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel?.() } catch { /* ignore */ }
    return { ok: false, reason: 'too-large' }
  }

  const reader = response.body?.getReader?.()
  if (!reader) {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxBytes) return { ok: false, reason: 'too-large' }
    return { ok: true, bytes: new Uint8Array(buffer) }
  }

  const chunks = []
  let total = 0
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    const chunk = step.value
    total += chunk.byteLength ?? chunk.length ?? 0
    if (total > maxBytes) {
      try { await reader.cancel() } catch { /* ignore */ }
      return { ok: false, reason: 'too-large' }
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    bytes.set(view, at)
    at += view.byteLength
  }
  return { ok: true, bytes }
}

/**
 * Z1 — load the catalog. A missing, unreadable, oversized or wrong-version
 * catalog fails; the caller shows no Library button and a Sky list of None.
 *
 * @param {typeof fetch} [fetchFn]
 * @param {{url?: string|URL, warn?: Function}} [opts]
 * @returns {Promise<{ok: true, catalog: object, dropped: object}
 *                  | {ok: false, reason: string, message: string}>}
 */
export async function loadCatalog(fetchFn = globalThis.fetch, { url = CATALOG_URL, warn = console.warn } = {}) {
  let response
  try {
    response = await fetchFn(String(url), { credentials: 'omit' })
  } catch (error) {
    return { ok: false, reason: 'network', message: error?.message ?? 'the catalog could not be reached' }
  }
  if (!response?.ok) {
    try { await response?.body?.cancel?.() } catch { /* ignore */ }
    return { ok: false, reason: 'http', message: `the catalog could not be read (${response?.status ?? 'no response'})` }
  }

  const body = await readCapped(response, CATALOG_MAX_BYTES)
  if (!body.ok) {
    return { ok: false, reason: body.reason, message: body.reason === 'too-large'
      ? 'the catalog is larger than the limit'
      : 'the catalog could not be read' }
  }

  let json
  try {
    json = JSON.parse(new TextDecoder().decode(body.bytes))
  } catch {
    return { ok: false, reason: 'parse', message: 'the catalog is not JSON' }
  }

  const parsed = parseCatalog(json, { warn })
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, message: parsed.reason === 'version'
      ? 'the catalog is not this version'
      : 'the catalog has an unexpected shape' }
  }
  return { ok: true, catalog: parsed.catalog, dropped: parsed.dropped }
}

/**
 * L22a — the URL a library item or sky STORES.
 *
 * The path as it is when the world's origin is the page's origin; otherwise the
 * absolute URL on the page's origin, so a library item placed in a world served
 * from another host still loads.
 *
 * @param {string} path              a catalog path (`/assets/library/...`)
 * @param {string|null} worldBaseUrl the world's base URL
 * @param {string} pageOrigin        the page's own origin
 */
export function storedUrl(path, worldBaseUrl, pageOrigin) {
  let worldOrigin = null
  try { worldOrigin = new URL(worldBaseUrl).origin } catch { worldOrigin = null }
  if (worldOrigin !== null && worldOrigin === pageOrigin) return path
  return new URL(path, pageOrigin).href
}
