// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

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
 * Build a home world WebSocket URL from a base WS URL and user id.
 *
 * Pure function — extracts the origin (protocol + host) from the base URL
 * and appends the home world path, regardless of any pathname the base URL
 * may contain. This ensures the home world endpoint always resolves to
 * /home/<uuid>/home on the correct host, even when wsUrlInput includes
 * a pathname (e.g. from computeWsUrl on a deployed path).
 *
 * @param {string|null} baseUrl — e.g. 'wss://example.com/apps/client/' or null
 * @param {string|null} userId — user UUID
 * @returns {string|null} — e.g. 'wss://example.com/home/<uuid>/home' or null
 */
export function buildHomeWorldWsUrl(baseUrl, userId) {
  if (!baseUrl || !userId) return null
  try {
    const parsed = new URL(baseUrl)
    return `${parsed.origin}/home/${userId}/home`
  } catch {
    return null
  }
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
 *
 * @param {string|null} wsOrigin — e.g. 'ws://localhost:3000' or 'wss://example.com'
 * @returns {string|null} — e.g. 'http://localhost:3000' or 'https://example.com'
 */
export function wsOriginToHttpOrigin(wsOrigin) {
  if (!wsOrigin) return null
  try {
    const parsed = new URL(wsOrigin)
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    return parsed.origin
  } catch {
    return null
  }
}
