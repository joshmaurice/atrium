// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// wsUrl.test.js — unit tests for computeWsUrl
//
// Tests the pure function with fake location objects — no DOM, no window,
// just node:test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeWsUrl, buildHomeWorldWsUrl, buildWorldWsUrl } from '../src/wsUrl.js'

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

// ---------------------------------------------------------------------------
// buildHomeWorldWsUrl — home world WS URL construction
// ---------------------------------------------------------------------------

describe('buildHomeWorldWsUrl', () => {

  test('constructs correct URL from bare origin', () => {
    const result = buildHomeWorldWsUrl('wss://atrium.example.com', '550e8400-e29b-41d4-a716-446655440000')
    assert.equal(result, 'wss://atrium.example.com/home/550e8400-e29b-41d4-a716-446655440000/home')
  })

  test('strips pathname from base URL with deployment subpath', () => {
    // This is the critical case from Finding 2: computeWsUrl includes pathname
    const result = buildHomeWorldWsUrl('wss://atrium.example.com/apps/client/', '550e8400-e29b-41d4-a716-446655440000')
    assert.equal(result, 'wss://atrium.example.com/home/550e8400-e29b-41d4-a716-446655440000/home')
  })

  test('ws:// protocol works', () => {
    const result = buildHomeWorldWsUrl('ws://localhost:3000', '550e8400-e29b-41d4-a716-446655440000')
    assert.equal(result, 'ws://localhost:3000/home/550e8400-e29b-41d4-a716-446655440000/home')
  })

  test('ws:// with port and pathname', () => {
    const result = buildHomeWorldWsUrl('ws://localhost:3000/apps/client/', '550e8400-e29b-41d4-a716-446655440000')
    assert.equal(result, 'ws://localhost:3000/home/550e8400-e29b-41d4-a716-446655440000/home')
  })

  test('wss:// with non-default port', () => {
    const result = buildHomeWorldWsUrl('wss://atrium.example.com:8443', '550e8400-e29b-41d4-a716-446655440000')
    assert.equal(result, 'wss://atrium.example.com:8443/home/550e8400-e29b-41d4-a716-446655440000/home')
  })

  test('returns null for empty base', () => {
    assert.equal(buildHomeWorldWsUrl('', '550e8400-e29b-41d4-a716-446655440000'), null)
  })

  test('returns null for null base', () => {
    assert.equal(buildHomeWorldWsUrl(null, '550e8400-e29b-41d4-a716-446655440000'), null)
  })

  test('returns null for undefined user id', () => {
    assert.equal(buildHomeWorldWsUrl('wss://atrium.example.com', undefined), null)
  })

  test('returns null for null user id', () => {
    assert.equal(buildHomeWorldWsUrl('wss://atrium.example.com', null), null)
  })

  test('returns null for invalid URL', () => {
    assert.equal(buildHomeWorldWsUrl('not-a-url', '550e8400-e29b-41d4-a716-446655440000'), null)
  })
})

// ---------------------------------------------------------------------------
// buildWorldWsUrl — world WS URL construction (browser-scheme regression guard)
// ---------------------------------------------------------------------------

describe('buildWorldWsUrl', () => {

  test('wss:// scheme preserved', () => {
    const result = buildWorldWsUrl('wss://atrium.example.com', 'jane', 'my-world')
    assert.ok(result.startsWith('wss://'), 'result starts with wss://')
    assert.equal(result, 'wss://atrium.example.com/worlds/jane/my-world')
  })

  test('ws:// scheme preserved (no http:// regression)', () => {
    const result = buildWorldWsUrl('ws://localhost:3000', 'alice', 'test-world')
    assert.ok(result.startsWith('ws://'), 'result starts with ws://')
    assert.equal(result, 'ws://localhost:3000/worlds/alice/test-world')
  })

  test('wss:// with deployment subpath strips pathname', () => {
    const result = buildWorldWsUrl('wss://dev.example.com/apps/client/', 'bob', 'home')
    assert.equal(result, 'wss://dev.example.com/worlds/bob/home')
  })

  test('encodeURIComponent applied to username and slug', () => {
    const result = buildWorldWsUrl('ws://localhost:3000', 'user name', 'my world')
    assert.equal(result, 'ws://localhost:3000/worlds/user%20name/my%20world')
  })

  test('returns null for empty base', () => {
    assert.equal(buildWorldWsUrl('', 'jane', 'slug'), null)
  })

  test('returns null for null username', () => {
    assert.equal(buildWorldWsUrl('ws://localhost:3000', null, 'slug'), null)
  })

  test('returns null for null slug', () => {
    assert.equal(buildWorldWsUrl('ws://localhost:3000', 'jane', null), null)
  })

  test('returns null for invalid base URL', () => {
    assert.equal(buildWorldWsUrl('not-a-url', 'jane', 'slug'), null)
  })
})