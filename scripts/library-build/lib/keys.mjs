// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * H1 — every name the API hands us passes through here before it is used as a
 * key, a file name or a URL. Nothing from a response is trusted as-is.
 */

export const ITEM_ID_RE = /^[A-Za-z0-9_]{1,64}$/
const SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/
const MAX_KEY_LENGTH = 512
/** Names that mean something to a JavaScript object, refused as segments. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

export const ALLOWED_HOSTS = Object.freeze(['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.com'])

/** An items.json id. */
export function itemIdProblem(id) {
  return typeof id === 'string' && ITEM_ID_RE.test(id) ? null : `bad item id ${JSON.stringify(id)}`
}

/**
 * An include key (a relative path inside one model). Returns null when the key
 * is usable, or the reason it is refused.
 *
 * Rules (H1): relative, `/`-separated; each segment matches SEGMENT_RE and is
 * not `.` or `..`; no empty segment, backslash, `%`, or leading `/`.
 */
export function includeKeyProblem(key) {
  if (typeof key !== 'string') return 'not a string'
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return 'bad length'
  if (key.startsWith('/')) return 'absolute'
  if (key.includes('\\')) return 'backslash'
  if (key.includes('%')) return 'percent'
  for (const segment of key.split('/')) {
    if (segment === '') return 'empty segment'
    if (segment === '.' || segment === '..') return 'dot segment'
    if (RESERVED.has(segment)) return 'reserved name'
    if (!SEGMENT_RE.test(segment)) return 'bad characters'
  }
  return null
}

/**
 * Check a whole include map: every key valid, and no two keys equal once
 * lower-cased (a case-insensitive file system would merge them).
 *
 * @param {object} include  `{ key: { url, size, md5 } }`
 * @returns {string|null}
 */
export function includeMapProblem(include) {
  if (include === undefined) return null
  if (include === null || typeof include !== 'object' || Array.isArray(include)) return 'include is not an object'
  const seen = new Set()
  for (const key of Object.keys(include)) {
    const problem = includeKeyProblem(key)
    if (problem) return `include key ${JSON.stringify(key)}: ${problem}`
    const folded = key.toLowerCase()
    if (seen.has(folded)) return `include key ${JSON.stringify(key)}: duplicate`
    seen.add(folded)
    const entryProblem = fileEntryProblem(include[key])
    if (entryProblem) return `include ${JSON.stringify(key)}: ${entryProblem}`
  }
  return null
}

/** A `{ url, size, md5 }` entry from the files API. */
export function fileEntryProblem(entry) {
  if (entry === null || typeof entry !== 'object') return 'not an object'
  const urlProblem = remoteUrlProblem(entry.url)
  if (urlProblem) return urlProblem
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) return 'bad size'
  if (typeof entry.md5 !== 'string' || !/^[0-9a-f]{32}$/.test(entry.md5)) return 'bad md5'
  return null
}

/** A URL we may request: https, an allowed host, default port, no credentials. */
export function remoteUrlProblem(url) {
  if (typeof url !== 'string') return 'url is not a string'
  let parsed
  try { parsed = new URL(url) } catch { return `unparseable url ${JSON.stringify(url)}` }
  if (parsed.protocol !== 'https:') return `not https: ${url}`
  if (parsed.username || parsed.password) return `credentials in url: ${url}`
  if (parsed.port !== '') return `non-default port: ${url}`
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) return `host not allowed: ${parsed.hostname}`
  return null
}
