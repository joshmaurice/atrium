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
