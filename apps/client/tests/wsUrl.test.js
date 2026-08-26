// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// wsUrl.test.js — unit tests for computeWsUrl
//
// Tests the pure function with fake location objects — no DOM, no window,
// just node:test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeWsUrl } from '../src/wsUrl.js'

describe('computeWsUrl', () => {

  test('wss:// for https: protocol with host', () => {
    const loc = { protocol: 'https:', host: 'example.com' }
    assert.equal(computeWsUrl(loc), 'wss://example.com')
  })

  test('wss:// for https: with port', () => {
    const loc = { protocol: 'https:', host: 'example.com:443' }
    assert.equal(computeWsUrl(loc), 'wss://example.com:443')
  })

  test('ws:// for http: protocol with host', () => {
    const loc = { protocol: 'http:', host: 'localhost:3000' }
    assert.equal(computeWsUrl(loc), 'ws://localhost:3000')
  })

  test('ws:// for http: with hostname-only', () => {
    const loc = { protocol: 'http:', host: '192.168.1.1' }
    assert.equal(computeWsUrl(loc), 'ws://192.168.1.1')
  })

  test('fallback for file: protocol', () => {
    const loc = { protocol: 'file:', host: '' }
    assert.equal(computeWsUrl(loc), 'ws://localhost:3000')
  })

  test('fallback for missing host', () => {
    const loc = { protocol: 'http:', host: '' }
    assert.equal(computeWsUrl(loc), 'ws://localhost:3000')
  })

  test('fallback for null location', () => {
    assert.equal(computeWsUrl(null), 'ws://localhost:3000')
  })

  test('fallback for undefined location', () => {
    assert.equal(computeWsUrl(undefined), 'ws://localhost:3000')
  })

  test('fallback for empty object (no host)', () => {
    const loc = { protocol: 'http:' }
    assert.equal(computeWsUrl(loc), 'ws://localhost:3000')
  })

  test('fallback for blob: protocol', () => {
    const loc = { protocol: 'blob:', host: 'some-uuid' }
    assert.equal(computeWsUrl(loc), 'ws://localhost:3000')
  })

  // ── pathname variants ──────────────────────────────────────

  test('wss:// with pathname', () => {
    const loc = { protocol: 'https:', host: 'dev.5-78-232-73.sslip.io', pathname: '/apps/client/' }
    assert.equal(computeWsUrl(loc), 'wss://dev.5-78-232-73.sslip.io/apps/client/')
  })

  test('ws:// with pathname', () => {
    const loc = { protocol: 'http:', host: 'localhost:3000', pathname: '/apps/client/' }
    assert.equal(computeWsUrl(loc), 'ws://localhost:3000/apps/client/')
  })

  test('fallback still works with pathname on non-http protocol', () => {
    const loc = { protocol: 'file:', host: '', pathname: '/index.html' }
    assert.equal(computeWsUrl(loc), 'ws://localhost:3000')
  })
})