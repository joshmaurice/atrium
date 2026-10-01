// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// Teleport failure message helpers — pure functions, no DOM.
//
// formatDestination(host, pathname, maxLen) — format a destination for display
// teleportFailureMessage(resolvedUrl, { returning }) — build failure message
// ---------------------------------------------------------------------------

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
 * Build a human-readable message for a teleport or Go-back failure.
 *
 * @param {string|null|undefined} resolvedUrl — the full WS URL that failed
 * @param {object} [opts]
 * @param {boolean} [opts.returning=false] — true for a Go-back failure
 * @returns {string} — the message, never throws
 */
export function teleportFailureMessage(resolvedUrl, opts = {}) {
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

  if (returning) {
    return `Couldn't return to ${dest}.`
  }

  return `Couldn't open ${dest}. The world may not exist, or the server may not be reachable right now.`
}