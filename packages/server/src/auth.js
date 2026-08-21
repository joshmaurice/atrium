// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import argon2 from 'argon2'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

/** Minimum password length per the design doc's security baseline. */
export const MIN_PASSWORD_LENGTH = 15

// ---------------------------------------------------------------------------
// Password blocklist — common / known-compromised passwords
// ---------------------------------------------------------------------------

/**
 * Load the password blocklist from a bundled file.
 * The list is the SecLists 10k-most-common subset (MIT-licensed),
 * deduplicated and normalized to lowercase. We keep the first N entries
 * for a practical offline check.
 */
const BLOCKLIST_PATH = resolve(__dirname, 'password-blocklist.txt')

/** @type {Set<string> | null} */
let _blocklist = null

function loadBlocklist() {
  if (_blocklist) return _blocklist
  try {
    const text = readFileSync(BLOCKLIST_PATH, 'utf8')
    const passwords = text.split('\n')
      .map(l => l.trim().toLowerCase())
      .filter(l => l.length > 0)
    _blocklist = new Set(passwords)
  } catch {
    // If the file doesn't exist, blocklist is empty — no passwords blocked
    _blocklist = new Set()
  }
  return _blocklist
}

/**
 * Check whether a password appears on the common/compromised password blocklist.
 * @param {string} password
 * @returns {boolean} true if the password is on the blocklist
 */
export function isPasswordBlocked(password) {
  const blocklist = loadBlocklist()
  return blocklist.has(password.toLowerCase())
}

// ---------------------------------------------------------------------------
// Password validation
// ---------------------------------------------------------------------------

/**
 * Validate a password against the configured policy.
 * Returns an array of error messages (empty = valid).
 * @param {string} password
 * @returns {string[]}
 */
export function validatePassword(password) {
  const errors = []

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  if (password && isPasswordBlocked(password)) {
    errors.push('That password is too common — choose a different one')
  }

  return errors
}

// ---------------------------------------------------------------------------
// Username normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a username for storage and comparison.
 * Strips leading/trailing whitespace, collapses internal whitespace to one
 * space, and trims to 64 characters.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeUsername(raw) {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 64)
}

// ---------------------------------------------------------------------------
// Argon2id hashing
// ---------------------------------------------------------------------------

/**
 * Hash a password with Argon2id.
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    // Use OWASP-recommended defaults for Argon2id:
    // memoryCost 19 MiB, timeCost 2, parallelism 1
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })
}

/**
 * Verify a password against an Argon2id hash.
 * Returns false for any failure (wrong password, malformed hash, etc.)
 * to avoid revealing which part was incorrect.
 * @param {string} hash
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}