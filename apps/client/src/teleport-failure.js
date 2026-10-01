// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// Teleport failure message helpers — pure functions, no DOM.
//
// formatDestination(host, pathname, maxLen) — format a destination for display
// evictionMessage(wsUrl) — build WORLD_NOW_PRIVATE eviction panel message (V8)
// teleportFailureMessage(resolvedUrl, { returning }, code) — build failure msg
// codeToReason(code) — map error code to human-readable reason (V8)
// ---------------------------------------------------------------------------

/**
 * Map an error code to a human-readable reason sentence (V8).
 * Returns empty string for unknown or missing codes, so callers fall back
 * to today's generic text.
 *
 * @param {string|null|undefined} code
 * @returns {string}
 */
export function codeToReason(code) {
  switch (code) {
    case 'WORLD_UNAVAILABLE':
      return "That world doesn't exist, or it isn't public."
    case 'WORLD_NOW_PRIVATE':
      return 'Its owner has just made it private.'
    default:
      return ''
  }
}

/**
 * Format a destination string for display in a teleport failure message.
 *
 * Never truncates the host; middle-truncates only the pathname. If the host
 * alone exhausts the budget, returns host + '/…'. If pathname is '/', returns
 * "the commons on <host>". Never throws; guards non-string inputs.
 *
 * @param {string} host — the host portion (e.g. "atrium.example.com:8443")
 * @param {string} pathname — the pathname portion (e.g. "/worlds/josh/garden")
 * @param {number} [maxLen=64] — maximum total length
 * @returns {string}
 */
export function formatDestination(host, pathname, maxLen = 64) {
  if (typeof host !== 'string') host = ''
  if (typeof pathname !== 'string') pathname = ''

  if (pathname === '/') {
    return `the commons on ${host}`
  }

  // The host must always be shown whole.
  const total = host + pathname

  if (total.length <= maxLen) {
    return total
  }

  // Host alone exceeds or equals the budget.
  if (host.length >= maxLen) {
    return host + '/\u2026'
  }

  // Keep the host intact, middle-truncate the pathname.
  const pathBudget = maxLen - host.length
  if (pathBudget <= 1) {
    return host + '/\u2026'
  }

  if (pathname.length <= pathBudget) {
    return host + pathname
  }

  const ellipsis = '\u2026'
  const prefixLen = Math.ceil((pathBudget - ellipsis.length) / 2)
  const suffixLen = Math.floor((pathBudget - ellipsis.length) / 2)

  // If there's no room for even one char of pathname+ellipsis, just host + /…
  if (prefixLen + suffixLen + ellipsis.length < 1) {
    return host + '/\u2026'
  }

  const prefix = pathname.slice(0, prefixLen)
  const suffix = pathname.slice(pathname.length - suffixLen)
  return host + prefix + ellipsis + suffix
}

/**
 * Build the eviction panel message for a WORLD_NOW_PRIVATE event (V8).
 * Safely parses the WS URL — never throws on garbage input.
 *
 * @param {string|null|undefined} wsUrl — the WebSocket URL that was evicted
 * @returns {string}
 */
export function evictionMessage(wsUrl) {
  let host = ''
  let pathname = '/'
  if (wsUrl && typeof wsUrl === 'string') {
    try {
      const parsed = new URL(wsUrl)
      host = parsed.host
      pathname = parsed.pathname || '/'
    } catch {
      // Garbage input — use fallback
    }
  }
  const dest = formatDestination(host, pathname)
  return `${dest} was made private by its owner, so you've been disconnected.`
}

/**
 * Build a human-readable message for a teleport or Go-back failure.
 * When a known error code is provided (V8), appends the code-specific
 * reason sentence. Without one, keeps today's generic text.
 *
 * @param {string|null|undefined} resolvedUrl — the full WS URL that failed
 * @param {object} [opts]
 * @param {boolean} [opts.returning=false] — true for a Go-back failure
 * @param {string|null|undefined} [code] — error code from the server (V8)
 * @returns {string} — the message, never throws
 */
export function teleportFailureMessage(resolvedUrl, opts = {}, code) {
  const { returning = false } = opts || {}
  let host = ''
  let pathname = '/'
  let dest = 'the destination'

  if (resolvedUrl && typeof resolvedUrl === 'string') {
    try {
      const parsed = new URL(resolvedUrl)
      host = parsed.host
      pathname = parsed.pathname || '/'
      dest = formatDestination(host, pathname)
    } catch {
      // Unparseable — use fallback
      dest = 'the destination'
    }
  }

  // V8: append code-specific reason when available
  const reason = codeToReason(code)
  const reasonSuffix = reason ? ' ' + reason : ''

  if (returning) {
    return `Couldn't return to ${dest}.` + reasonSuffix
  }

  if (reason) {
    return `Couldn't open ${dest}. ${reason}`
  }

  return `Couldn't open ${dest}. The world may not exist, or the server may not be reachable right now.`
}