// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * Thin HTTP client for Atrium's /api/auth/* endpoints.
 *
 * Cookie handling is automatic — same-origin fetch (the Phase-1 deployment
 * assumption) means the browser sends cookies by default.
 *
 * @param {string} [baseUrl=''] — Optional base URL for the server (e.g.
 *   'http://localhost:3015'). Omit for same-origin browser usage.
 */

const BASE = ''

export async function register(username, password, website, { baseUrl = BASE } = {}) {
  const body = { username, password }
  if (website !== undefined) body.website = website
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Registration failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data   // { id, username, displayName, createdAt }
}

export async function login(username, password, { baseUrl = BASE } = {}) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Login failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data   // { id, username, displayName }
}

export async function logout({ baseUrl = BASE } = {}) {
  const res = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.error || data.message || `Logout failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return true
}

/**
 * Get current session info. Returns null on 401 (not logged in) rather than
 * throwing — callers should treat null as the expected "not logged in" state.
 */
export async function me({ baseUrl = BASE } = {}) {
  const res = await fetch(`${baseUrl}/api/auth/me`)
  if (res.status === 401) return null
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.error || data.message || `Session check failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return await res.json()   // { id, username, displayName }
}