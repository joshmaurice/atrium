// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { AtriumClient } from '@atrium/client'

// ---------------------------------------------------------------------------
// computeWsUrl — derive a WebSocket URL from page location
//
// Pure function: takes a location-like object with `protocol` and `host`
// properties, returns the appropriate ws:// or wss:// URL. Falls back to
// ws://localhost:3000 for file:// pages or missing host (local file usage).
// ---------------------------------------------------------------------------

const FALLBACK = 'ws://localhost:3000'

/**
 * @param {{ protocol: string, host: string }} location
 * @returns {string}
 */
export function computeWsUrl(location) {
  if (!location || !location.host) {
    return FALLBACK
  }

  const protocol = location.protocol || ''
  const path = location.pathname || ''

  if (protocol === 'https:') {
    return 'wss://' + location.host + path
  }

  if (protocol === 'http:') {
    return 'ws://' + location.host + path
  }

  // file:, blob:, data:, about:, or any other non-http protocol
  return FALLBACK
}

/**
 * Build a world WebSocket URL from a base WS URL, username, and slug.
 *
 * Pure function — extracts the origin from the base URL and appends the
 * canonical world path `/worlds/<username>/<slug>`. Both username and slug
 * are encodeURIComponent-encoded to handle special characters safely.
 * For home worlds, pass slug='home' to get `/worlds/<username>/home`.
 *
 * @param {string|null} baseUrl  — account-server WS base URL, e.g. 'wss://example.com'
 * @param {string|null} username — user's login/display username
 * @param {string|null} slug     — world slug (use 'home' for home world)
 * @returns {string|null} — e.g. 'wss://example.com/worlds/janedoe/my-world' or null
 */
export function buildWorldWsUrl(baseUrl, username, slug) {
  if (!baseUrl || !username || !slug) return null
  try {
    const parsed = new URL(baseUrl)
    const encodedUser = encodeURIComponent(username)
    const encodedSlug = encodeURIComponent(slug)
    return `${parsed.origin}/worlds/${encodedUser}/${encodedSlug}`
  } catch {
    return null
  }
}

/**
 * Convert a WebSocket origin to its HTTP equivalent.
 *
 * Pure function — replaces ws:// with http:// or wss:// with https://
 * on the given origin. Returns null if the input is not parseable.
 * Canonical implementation is AtriumClient.wsOriginToHttpOrigin.
 *
 * @param {string|null} wsOrigin — e.g. 'ws://localhost:3000' or 'wss://example.com'
 * @returns {string|null} — e.g. 'http://localhost:3000' or 'https://example.com'
 */
export function wsOriginToHttpOrigin(wsOrigin) {
  return AtriumClient.wsOriginToHttpOrigin(wsOrigin)
}

/**
 * Resolve a user-entered world address to a full WebSocket URL.
 *
 * Pure function — tries to interpret the string as a world address:
 * - `ws://...` or `wss://...` full URL: passed through as-is
 * - Relative path (e.g. `/worlds/user/slug`, just `slug`, etc.):
 *   resolved against `origin` (the current world server's origin).
 * - `http(s)://...`, empty string, or unparseable: returns null.
 *
 * This lets the user enter a short path in the World box, or a full
 * WebSocket URL for cross-server connections.
 *
 * @param {string|null} str — user-entered world address
 * @param {string|null} origin — origin to resolve relative paths against
 *   (e.g. the current world server's origin, or accountWsBase when disconnected)
 * @returns {string|null} — full WebSocket URL, or null if unresolvable
 */
export function resolveWorldAddress(str, origin) {
  if (!str) return null
  const trimmed = str.trim()
  if (!trimmed) return null

  // Full ws:// or wss:// URL — pass through
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    try {
      new URL(trimmed)
      return trimmed
    } catch {
      return null
    }
  }

  // http(s):// or any other non-ws scheme — not a world address
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') ||
      trimmed.includes('://')) {
    return null
  }

  // Relative path — resolve against origin
  if (!origin) return null
  const originWs = origin.startsWith('ws://') || origin.startsWith('wss://')
    ? origin
    : `ws://${origin.replace(/^https?:\/\//, '')}`
  try {
    const base = originWs.endsWith('/') ? originWs : originWs + '/'
    const resolved = new URL(trimmed.startsWith('/') ? trimmed.slice(1) : trimmed, base)
    const result = `${resolved.protocol}//${resolved.host}${resolved.pathname}`
    return result
  } catch {
    return null
  }
}

/**
 * Determine whether the File box URL's HTTP origin should be used as the
 * worldBaseUrl for a WebSocket connection (pre-brief #1).
 *
 * The File box base only applies when the File box URL's HTTP origin
 * matches the connect URL's HTTP origin. Otherwise the base is derived
 * from the connect URL itself. One narrow exception: when both hostnames
 * are loopback (localhost, 127.x.x.x, [::1]), the ports may differ.
 *
 * @param {string|null} fileUrl  — File box URL (may be empty)
 * @param {string} connectUrl    — WebSocket URL being connected to
 * @returns {boolean} — true if the File box base should be passed
 */
export function shouldUseFileBase(fileUrl, connectUrl) {
  if (!fileUrl) return false
  const fileHttp = AtriumClient.wsOriginToHttpOrigin(fileUrl) || fileUrl
  const connHttp = AtriumClient.wsOriginToHttpOrigin(connectUrl)
  if (!connHttp) return false
  try {
    const fileOrigin = new URL(fileHttp)
    const connOrigin = new URL(connHttp)
    if (fileOrigin.origin === connOrigin.origin) return true
    // Loopback exception: both hostnames are loopback
    const isLoopback = (h) => h === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(h) || h === '::1'
    if (isLoopback(fileOrigin.hostname) && isLoopback(connOrigin.hostname) &&
        fileOrigin.protocol === connOrigin.protocol) {
      return true
    }
    return false
  } catch {
    return false
  }
}
