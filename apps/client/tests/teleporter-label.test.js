// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// teleporter-label.test.js — unit tests for teleporterLabel / truncateMiddle
// Pure functions, no DOM, just node:test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { teleporterLabel, truncateMiddle } from '../src/teleporter-label.js'

describe('teleporterLabel', () => {

  test('/ → Commons (same server)', () => {
    assert.equal(teleporterLabel('/', 'ws://example.com'), 'Commons')
  })

  test('/ → host · Commons (other server)', () => {
    assert.equal(teleporterLabel('/', 'wss://other.com'), 'example.com · Commons')
    // Note: / resolves against current world wsUrl, so with no resolveWorldAddress,
    // just check it returns something meaningful
  })

  test('same-server /worlds/u/s → u / s', () => {
    const label = teleporterLabel('/worlds/jane/my-world', 'ws://example.com')
    assert.ok(label.includes('jane') && label.includes('my-world'))
  })

  test('full ws:// URL to other server → host · u / s', () => {
    const label = teleporterLabel('ws://other.com/worlds/bob/slug', 'ws://example.com')
    assert.ok(label.includes('other.com'))
    assert.ok(label.includes('bob'))
    assert.ok(label.includes('slug'))
  })

  test('null destination → invalid destination', () => {
    assert.equal(teleporterLabel(null, 'ws://example.com'), 'invalid destination')
  })

  test('empty string → invalid destination', () => {
    assert.equal(teleporterLabel('', 'ws://example.com'), 'invalid destination')
  })

  test('unparseable destination → invalid destination', () => {
    assert.equal(teleporterLabel('not a valid path', null), 'invalid destination')
  })
})

describe('truncateMiddle', () => {

  test('short string unchanged', () => {
    assert.equal(truncateMiddle('hello', 48), 'hello')
  })

  test('long string without host separator truncated', () => {
    const long = 'a'.repeat(100)
    const result = truncateMiddle(long, 20)
    assert.equal(result.length, 20)
    assert.ok(result.includes('…'))
  })

  test('host portion (before ·) preserved', () => {
    const str = 'host.example.com · user / very-long-slug-name-that-exceeds-max'
    const result = truncateMiddle(str, 48)
    assert.ok(result.startsWith('host.example.com · '))
    assert.equal(result.length, 48)
    assert.ok(result.includes('…'))
  })

  test('null/undefined returns input', () => {
    assert.equal(truncateMiddle(null), null)
    assert.equal(truncateMiddle(undefined), undefined)
  })
})
