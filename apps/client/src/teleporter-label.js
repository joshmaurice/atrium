// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// Teleporter label helpers (T13) — pure functions, no DOM.
//
// teleporterLabel(destination, currentWorldUrl) — derive display text
// truncateMiddle(str, maxLen) — middle-truncate, preserving host portion
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable label for a teleporter pad (T13).
 *
 * Rules:
 *  '/' → 'Commons'
 *  Same-server '/worlds/u/s' → 'u / s'
 *  Other server's full ws(s) URL → 'host · u / s'
 *  Other server's '/' or root URL → 'host · Commons'
 *  Same-origin root URL → 'Commons'
 *  Unresolvable → 'invalid destination'
 *
 * @param {string} destination — the teleporter's destination string
 * @param {string|null} currentWorldUrl — WS URL of the world the player is in
 * @returns {string}
 */
export function teleporterLabel(destination, currentWorldUrl) {
  if (!destination) return 'invalid destination'

  const trimmed = destination.trim()
  if (!trimmed) return 'invalid destination'

  // Resolve the destination to determine the actual target server
  let resolvedUrl = null
  try {
    // Try parsing as a direct WS URL first
    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
      resolvedUrl = new URL(trimmed)
    } else if (currentWorldUrl) {
      // Relative path — resolve against current world URL
      const baseOrigin = new URL(currentWorldUrl).origin
      const wsOrigin = baseOrigin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
      resolvedUrl = new URL(trimmed.startsWith('/') ? trimmed.slice(1) : trimmed, wsOrigin + '/')
    }
  } catch {
    // Unresolvable
  }

  if (!resolvedUrl) return 'invalid destination'

  // Check if the destination is the Commons — '/' literal, or a full URL
  // whose path is empty or '/' (e.g. 'wss://other.com/' or 'wss://other.com')
  const isCommons = trimmed === '/' || resolvedUrl.pathname === '/' || resolvedUrl.pathname === ''

  if (isCommons) {
    if (currentWorldUrl) {
      try {
        const currentOrigin = new URL(currentWorldUrl).origin
        if (resolvedUrl.origin === currentOrigin) return 'Commons'
        return `${resolvedUrl.host} · Commons`
      } catch {
        return 'Commons'
      }
    }
    return 'Commons'
  }

  // Parse the path to extract user/slug
  const pathParts = resolvedUrl.pathname.split('/').filter(Boolean)
  // Expected: worlds/<user>/<slug>
  const isWorldsPath = pathParts[0] === 'worlds' && pathParts.length >= 3
  const user = isWorldsPath ? pathParts[1] : null
  const slug = isWorldsPath ? pathParts.slice(2).join('/') : pathParts[pathParts.length - 1] || trimmed

  // Determine if this is another server
  let label
  if (currentWorldUrl) {
    try {
      const currentOrigin = new URL(currentWorldUrl).origin
      if (resolvedUrl.origin !== currentOrigin) {
        // Other server
        if (isWorldsPath) {
          label = `${resolvedUrl.host} · ${user} / ${slug}`
        } else {
          label = `${resolvedUrl.host} · ${pathParts[pathParts.length - 1] || slug}`
        }
      } else {
        // Same server
        label = isWorldsPath ? `${user} / ${slug}` : slug
      }
    } catch {
      label = isWorldsPath ? `${user} / ${slug}` : slug
    }
  } else {
    label = isWorldsPath ? `${user} / ${slug}` : slug
  }

  return label
}

/**
 * Middle-truncate a string, keeping the host portion (before first ' · ') intact.
 * @param {string} str — the string to truncate
 * @param {number} maxLen — maximum length (default 48)
 * @returns {string}
 */
export function truncateMiddle(str, maxLen = 48) {
  if (!str || str.length <= maxLen) return str

  // Find the host portion (part before first ' · ')
  const hostSep = ' · '
  const hostIdx = str.indexOf(hostSep)
  let hostLen = 0
  if (hostIdx >= 0) {
    hostLen = hostIdx + hostSep.length
  }

  // If the host alone is longer than maxLen, truncate everything
  if (hostLen >= maxLen) {
    return str.slice(0, maxLen - 1) + '…'
  }

  // Keep host intact, middle-truncate the rest
  const remaining = maxLen - hostLen
  const suffixLen = Math.floor(remaining / 2)
  const prefixLen = remaining - suffixLen - 1 // 1 for '…'

  const hostPart = str.slice(0, hostLen)
  const restPart = str.slice(hostLen)
  const prefix = restPart.slice(0, prefixLen)
  const suffix = restPart.slice(restPart.length - suffixLen)

  return hostPart + prefix + '…' + suffix
}
