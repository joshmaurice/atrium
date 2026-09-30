// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// wsUrl.test.js — unit tests for computeWsUrl
//
// Tests the pure function with fake location objects — no DOM, no window,
// just node:test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeWsUrl, buildWorldWsUrl, resolveWorldAddress, isValidDestination, shouldUseFileBase, reduceWsUrlToOrigin, httpOriginToWsOrigin, sameOriginAsAccount } from '../src/wsUrl.js'

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

describe('resolveWorldAddress', () => {

  test('full ws:// URL passes through', () => {
    assert.equal(
      resolveWorldAddress('ws://other-server.com/worlds/jane/home', 'ws://current-server.com'),
      'ws://other-server.com/worlds/jane/home'
    )
  })

  test('full wss:// URL passes through', () => {
    assert.equal(
      resolveWorldAddress('wss://other-server.com:8443/worlds/bob/slug', 'ws://current-server.com'),
      'wss://other-server.com:8443/worlds/bob/slug'
    )
  })

  test('relative path resolved against origin', () => {
    assert.equal(
      resolveWorldAddress('/worlds/jane/my-world', 'ws://current-server.com'),
      'ws://current-server.com/worlds/jane/my-world'
    )
  })

  test('relative path without leading slash', () => {
    assert.equal(
      resolveWorldAddress('worlds/jane/my-world', 'ws://current-server.com'),
      'ws://current-server.com/worlds/jane/my-world'
    )
  })

  test('relative path with http origin', () => {
    assert.equal(
      resolveWorldAddress('/worlds/jane/home', 'http://current-server.com'),
      'ws://current-server.com/worlds/jane/home'
    )
  })

  test('http:// URL returns null (not a WS address)', () => {
    assert.equal(
      resolveWorldAddress('http://example.com/page', 'ws://current-server.com'),
      null
    )
  })

  test('https:// URL returns null', () => {
    assert.equal(
      resolveWorldAddress('https://example.com/page', 'ws://current-server.com'),
      null
    )
  })

  test('empty string returns null', () => {
    assert.equal(resolveWorldAddress('', 'ws://current-server.com'), null)
  })

  test('whitespace-only returns null', () => {
    assert.equal(resolveWorldAddress('   ', 'ws://current-server.com'), null)
  })

  test('null input returns null', () => {
    assert.equal(resolveWorldAddress(null, 'ws://current-server.com'), null)
  })

  test('relative path with null origin returns null', () => {
    assert.equal(resolveWorldAddress('/worlds/jane/home', null), null)
  })

  test('unparseable ws:// URL returns null', () => {
    assert.equal(
      resolveWorldAddress('ws://[invalid', 'ws://current-server.com'),
      null
    )
  })
})

// ---------------------------------------------------------------------------
// shouldUseFileBase (pre-brief #1)
// ---------------------------------------------------------------------------

describe('shouldUseFileBase', () => {

  test('same HTTP origin → use file base', () => {
    assert.equal(shouldUseFileBase('https://example.com/file.gltf', 'wss://example.com/world'), true)
  })

  test('different hostname → derive, not file base', () => {
    assert.equal(shouldUseFileBase('https://a.example/file.gltf', 'wss://b.example/world'), false)
  })

  test('scheme mismatch → derive', () => {
    assert.equal(shouldUseFileBase('https://example.com/file.gltf', 'ws://example.com/world'), false)
  })

  test('port mismatch on same host → derive', () => {
    assert.equal(shouldUseFileBase('https://example.com:3000/file.gltf', 'wss://example.com:3100/world'), false)
  })

  test('loopback same scheme different port → use file base', () => {
    assert.equal(shouldUseFileBase('http://localhost:8080/file.gltf', 'ws://localhost:3000/world'), true)
  })

  test('loopback scheme mismatch → derive', () => {
    assert.equal(shouldUseFileBase('https://localhost:8443/file.gltf', 'ws://localhost:3000/world'), false)
  })

  test('127.0.0.1 loopback → use file base (different ports)', () => {
    assert.equal(shouldUseFileBase('http://127.0.0.1:8080/file.gltf', 'ws://127.0.0.1:3000/world'), true)
  })

  test('one side loopback, other not → derive', () => {
    assert.equal(shouldUseFileBase('http://localhost:8080/file.gltf', 'wss://example.com/world'), false)
  })

  test('empty file URL → derive', () => {
    assert.equal(shouldUseFileBase('', 'wss://example.com/world'), false)
  })

  test('null file URL → derive', () => {
    assert.equal(shouldUseFileBase(null, 'wss://example.com/world'), false)
  })
})

// ---------------------------------------------------------------------------
// reduceWsUrlToOrigin
// ---------------------------------------------------------------------------

describe('reduceWsUrlToOrigin', () => {

  test('ws:// with host and port', () => {
    assert.equal(reduceWsUrlToOrigin('ws://localhost:3000/path/to/world'), 'ws://localhost:3000')
  })

  test('wss:// with host only', () => {
    assert.equal(reduceWsUrlToOrigin('wss://example.com/worlds/jane/home'), 'wss://example.com')
  })

  test('wss:// with host and port', () => {
    assert.equal(reduceWsUrlToOrigin('wss://example.com:8443/path'), 'wss://example.com:8443')
  })

  test('IPv6 kept bracketed', () => {
    assert.equal(reduceWsUrlToOrigin('ws://[::1]:3000/world'), 'ws://[::1]:3000')
  })

  test('null for unparseable', () => {
    assert.equal(reduceWsUrlToOrigin('not a url'), null)
  })

  test('null for empty string', () => {
    assert.equal(reduceWsUrlToOrigin(''), null)
  })
})

// ---------------------------------------------------------------------------
// httpOriginToWsOrigin
// ---------------------------------------------------------------------------

describe('httpOriginToWsOrigin', () => {

  test('http:// → ws://', () => {
    assert.equal(httpOriginToWsOrigin('http://localhost:3000'), 'ws://localhost:3000')
  })

  test('https:// → wss://', () => {
    assert.equal(httpOriginToWsOrigin('https://example.com'), 'wss://example.com')
  })

  test('https:// with port', () => {
    assert.equal(httpOriginToWsOrigin('https://example.com:8443'), 'wss://example.com:8443')
  })

  test('ws:// pass-through', () => {
    assert.equal(httpOriginToWsOrigin('ws://localhost:3000/world'), 'ws://localhost:3000')
  })

  test('null for unparseable', () => {
    assert.equal(httpOriginToWsOrigin('not a url'), null)
  })
})

// ---------------------------------------------------------------------------
// sameOriginAsAccount (T7)
// ---------------------------------------------------------------------------

describe('sameOriginAsAccount', () => {

  test('same ws/https origin → true', () => {
    assert.equal(sameOriginAsAccount('wss://example.com/worlds/jane/home', 'https://example.com'), true)
  })

  test('same ws/http origin → true', () => {
    assert.equal(sameOriginAsAccount('ws://localhost:3000/world', 'http://localhost:3000'), true)
  })

  test('different host → false', () => {
    assert.equal(sameOriginAsAccount('wss://other.com/world', 'https://example.com'), false)
  })

  test('port mismatch → false', () => {
    assert.equal(sameOriginAsAccount('wss://example.com:8443/world', 'https://example.com'), false)
  })

  test('scheme mismatch → false', () => {
    assert.equal(sameOriginAsAccount('ws://example.com/world', 'https://example.com'), false)
  })

  test('null worldUrl → false', () => {
    assert.equal(sameOriginAsAccount(null, 'https://example.com'), false)
  })
})

// ---------------------------------------------------------------------------
// isValidDestination (R4) — teleporter destination validation
// ---------------------------------------------------------------------------

describe('isValidDestination', () => {

  test('/ → true (Commons)', () => {
    assert.equal(isValidDestination('/'), true)
  })

  test('/worlds/user/slug → true', () => {
    assert.equal(isValidDestination('/worlds/jane/my-world'), true)
  })

  test('worlds/user/slug (no leading slash) → true', () => {
    assert.equal(isValidDestination('worlds/jane/my-world'), true)
  })

  test('full ws:// URL → true', () => {
    assert.equal(isValidDestination('ws://other-server.com/worlds/jane/home'), true)
  })

  test('full wss:// URL → true', () => {
    assert.equal(isValidDestination('wss://example.com:8443/path/to/world'), true)
  })

  test('http:// URL → false', () => {
    assert.equal(isValidDestination('http://example.com/world'), false)
  })

  test('https:// URL → false', () => {
    assert.equal(isValidDestination('https://example.com'), false)
  })

  test('"hi" → false', () => {
    assert.equal(isValidDestination('hi'), false)
  })

  test('"<3" → false', () => {
    assert.equal(isValidDestination('<3'), false)
  })

  test('empty string → false', () => {
    assert.equal(isValidDestination(''), false)
  })

  test('whitespace-only → false', () => {
    assert.equal(isValidDestination('   '), false)
  })

  test('null → false', () => {
    assert.equal(isValidDestination(null), false)
  })

  test('random path without worlds prefix → false', () => {
    assert.equal(isValidDestination('/some/random/path'), false)
  })

  test('worlds/ with no slug → false', () => {
    assert.equal(isValidDestination('/worlds/jane'), false)
  })

  test('worlds/ with empty username → false', () => {
    assert.equal(isValidDestination('/worlds//slug'), false)
  })

  test('unparseable ws:// URL → false', () => {
    assert.equal(isValidDestination('ws://[invalid'), false)
  })

  test('single-slash ws:// → true (parseable URL)', () => {
    assert.equal(isValidDestination('ws://example.com/'), true)
  })
})