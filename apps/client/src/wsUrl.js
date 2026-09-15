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