// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  isPasswordBlocked,
  normalizeUsername,
  MIN_PASSWORD_LENGTH,
} from '../src/auth.js'

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

describe('hashPassword / verifyPassword', () => {
  test('round-trips successfully', async () => {
    const password = 'correct horse battery staple'
    const hash = await hashPassword(password)
    assert.ok(hash.startsWith('$argon2id$'), 'hash uses argon2id')
    const valid = await verifyPassword(hash, password)
    assert.ok(valid, 'correct password verifies')
  })

  test('returns false for wrong password', async () => {
    const hash = await hashPassword('correct password')
    const valid = await verifyPassword(hash, 'wrong password')
    assert.equal(valid, false)
  })

  test('returns false for malformed hash (no crash)', async () => {
    const valid = await verifyPassword('not-a-valid-hash', 'anything')
    assert.equal(valid, false)
  })

  test('different hashes for same password (unique salt)', async () => {
    const password = 'same password each time'
    const h1 = await hashPassword(password)
    const h2 = await hashPassword(password)
    assert.notEqual(h1, h2, 'each hash should have a unique salt')
  })
})

// ---------------------------------------------------------------------------
// Password validation (min length + blocklist)
// ---------------------------------------------------------------------------

describe('validatePassword', () => {
  test('rejects empty password', () => {
    const errors = validatePassword('')
    assert.ok(errors.length >= 1)
    assert.ok(errors[0].toLowerCase().includes('at least'))
  })

  test('rejects short password', () => {
    const errors = validatePassword('short1')
    assert.ok(errors.length >= 1)
    assert.ok(errors[0].includes(String(MIN_PASSWORD_LENGTH)))
  })

  test('rejects password exactly at boundary - 1', () => {
    const pw = 'x'.repeat(MIN_PASSWORD_LENGTH - 1)
    const errors = validatePassword(pw)
    assert.ok(errors.length >= 1)
    assert.ok(errors[0].includes(String(MIN_PASSWORD_LENGTH)))
  })

  test('accepts password at minimum length', () => {
    const pw = 'x'.repeat(MIN_PASSWORD_LENGTH)
    const errors = validatePassword(pw)
    // Should not have min-length error (may still have blocklist)
    assert.equal(errors.filter(e => e.includes('at least')).length, 0)
  })

  test('accepts password above minimum length', () => {
    const pw = 'x'.repeat(MIN_PASSWORD_LENGTH + 5)
    const errors = validatePassword(pw)
    assert.equal(errors.filter(e => e.includes('at least')).length, 0)
  })

  test('rejects password on blocklist', () => {
    const errors = validatePassword('password')
    assert.ok(errors.some(e => e.toLowerCase().includes('too common')))
  })
})

// ---------------------------------------------------------------------------
// Password blocklist
// ---------------------------------------------------------------------------

describe('isPasswordBlocked', () => {
  test('common passwords are blocked', () => {
    assert.ok(isPasswordBlocked('password'))
    assert.ok(isPasswordBlocked('123456'))
    assert.ok(isPasswordBlocked('qwerty'))
    assert.ok(isPasswordBlocked('letmein'))
    assert.ok(isPasswordBlocked('football'))
  })

  test('case-insensitive check', () => {
    assert.ok(isPasswordBlocked('PASSWORD'))
    assert.ok(isPasswordBlocked('LetMeIn'))
    assert.ok(isPasswordBlocked('QwErTy'))
  })

  test('uncommon password is not blocked', () => {
    assert.equal(isPasswordBlocked('correct horse battery staple'), false)
    assert.equal(isPasswordBlocked('x'.repeat(20)), false)
  })
})

// ---------------------------------------------------------------------------
// Username normalization
// ---------------------------------------------------------------------------

describe('normalizeUsername', () => {
  test('trims whitespace', () => {
    assert.equal(normalizeUsername('  alice  '), 'alice')
  })

  test('collapses internal whitespace', () => {
    assert.equal(normalizeUsername('alice   bob'), 'alice bob')
  })

  test('truncates to 64 characters', () => {
    const long = 'a'.repeat(100)
    assert.equal(normalizeUsername(long).length, 64)
  })

  test('returns empty string for blank input', () => {
    assert.equal(normalizeUsername('   '), '')
  })
})