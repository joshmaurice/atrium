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

  if (protocol === 'https:') {
    return 'wss://' + location.host
  }

  if (protocol === 'http:') {
    return 'ws://' + location.host
  }

  // file:, blob:, data:, about:, or any other non-http protocol
  return FALLBACK
}