// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// teleport-failure.test.js — unit tests for formatDestination / teleportFailureMessage
// Pure functions, no DOM, just node:test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatDestination, teleportFailureMessage, codeToReason } from '../src/teleport-failure.js'

describe('formatDestination', () => {

  test('short host+path returned whole', () => {
    const result = formatDestination('atrium.example', '/worlds/josh/garden')
    assert.equal(result, 'atrium.example/worlds/josh/garden')
  })

  test('long path middle-truncated with host intact', () => {
    const host = 'example.com'
    const path = '/' + 'a'.repeat(60) + '/' + 'b'.repeat(60)
    const result = formatDestination(host, path, 48)
    // Host (11) + path (budget 37)
    assert.ok(result.startsWith(host + '/'), 'starts with host')
    assert.equal(result.length, 48)
    assert.ok(result.includes('\u2026'), 'contains ellipsis')
  })

  test('long host + long path keeps whole host', () => {
    const host = 'a-very-long-hostname-that-exceeds.example.com'
    const path = '/' + 'x'.repeat(80)
    const result = formatDestination(host, path, 64)
    assert.ok(result.startsWith(host), 'host at start')
    assert.ok(result.includes('\u2026'), 'contains ellipsis when truncated')
    // If total fits, it's returned whole
    if ((host + path).length <= 64) {
      assert.equal(result, host + path)
    }
  })

  test('host longer than budget gives host + /…', () => {
    const host = 'a'.repeat(70)
    const result = formatDestination(host, '/worlds/jane/home', 64)
    assert.equal(result, host + '/\u2026')
  })

  test('/ gives "the commons on <host>"', () => {
    const result = formatDestination('atrium.example', '/')
    assert.equal(result, 'the commons on atrium.example')
  })

  test('/ on another host', () => {
    const result = formatDestination('other.com:8443', '/')
    assert.equal(result, 'the commons on other.com:8443')
  })

  test('host with port keeps port', () => {
    const result = formatDestination('atrium.example:8080', '/worlds/josh/garden')
    assert.equal(result, 'atrium.example:8080/worlds/josh/garden')
  })

  test('percent-encoded path stays encoded (no decoding)', () => {
    const result = formatDestination('example.com', '/worlds/josh/my%20world')
    assert.equal(result, 'example.com/worlds/josh/my%20world')
  })

  test('never throws on garbage string host+path', () => {
    const result = formatDestination(undefined, undefined)
    // Should not throw
    assert.equal(typeof result, 'string')
  })

  test('never throws on null host', () => {
    const result = formatDestination(null, '/worlds/jane/home')
    assert.equal(result, '/worlds/jane/home')
  })

  test('never throws on number host', () => {
    const result = formatDestination(42, '/path')
    assert.equal(result, '/path')
  })

  test('never throws on undefined pathname', () => {
    const result = formatDestination('example.com', undefined)
    assert.equal(result, 'example.com')
  })

  test('short path /x fits within budget', () => {
    const result = formatDestination('srv.io', '/x')
    assert.equal(result, 'srv.io/x')
  })

  test('path budget exactly 1 — shows host + /…', () => {
    // maxLen=12, host.length=11, pathBudget=1 — not enough for even ellipsis
    const result = formatDestination('srv.io:8443', '/verylongpathname', 12)
    assert.equal(result, 'srv.io:8443/\u2026')
  })

  test('exact fit returns whole string', () => {
    const host = 'exact.io'
    const path = '/abc'
    // total = 12, maxLen = 12 → exact fit
    const result = formatDestination(host, path, 12)
    assert.equal(result, host + path)
  })

  test('one over budget truncates', () => {
    const host = 'exact.io'
    const path = '/abcd'
    const result = formatDestination(host, path, 11)
    // host=8 + / + truncated path
    assert.equal(result.length, 11)
    assert.ok(result.startsWith(host))
    assert.ok(result.includes('\u2026'))
  })
})

test('codeToReason maps WORLD_UNAVAILABLE to correct sentence', () => {
  assert.equal(codeToReason('WORLD_UNAVAILABLE'), "That world doesn't exist, or it isn't public.")
})

test('codeToReason maps WORLD_NOW_PRIVATE to correct sentence', () => {
  assert.equal(codeToReason('WORLD_NOW_PRIVATE'), 'Its owner has just made it private.')
})

test('codeToReason returns empty string for unknown code', () => {
  assert.equal(codeToReason('MADE_UP_CODE'), '')
})

test('codeToReason returns empty string for null/undefined', () => {
  assert.equal(codeToReason(null), '')
  assert.equal(codeToReason(undefined), '')
})

describe('teleportFailureMessage with code', () => {

  test('WORLD_UNAVAILABLE code adds reason sentence', () => {
    const msg = teleportFailureMessage('ws://atrium.example/worlds/private-world', {}, 'WORLD_UNAVAILABLE')
    assert.ok(msg.includes("That world doesn't exist, or it isn't public."))
  })

  test('WORLD_NOW_PRIVATE code uses connect surface wording', () => {
    const msg = teleportFailureMessage('ws://atrium.example/worlds/just-switched', {}, 'WORLD_NOW_PRIVATE')
    assert.ok(msg.includes('Its owner has just made it private.'))
  })

  test('unknown code keeps today text unchanged', () => {
    const msg = teleportFailureMessage('ws://atrium.example/worlds/test', {}, 'MADE_UP')
    assert.ok(msg.includes("The world may not exist"))
    assert.ok(!msg.includes('doesn\'t exist'))
  })

  test('null code keeps today text unchanged', () => {
    const msg = teleportFailureMessage('ws://atrium.example/worlds/test', {}, null)
    assert.ok(msg.includes("The world may not exist"))
  })

  test('returning + code still uses returning prefix', () => {
    const msg = teleportFailureMessage('ws://atrium.example/worlds/test', { returning: true }, 'WORLD_UNAVAILABLE')
    assert.ok(msg.startsWith("Couldn't return to "))
    assert.ok(msg.includes("That world doesn't exist"))
  })
})

describe('teleportFailureMessage', () => {

  test('same-server path gives "Couldn\'t open <host><path>. …"', () => {
    const msg = teleportFailureMessage('ws://atrium.example/worlds/josh/garden')
    assert.ok(msg.startsWith("Couldn't open "))
    assert.ok(msg.includes('atrium.example/worlds/josh/garden'))
    assert.ok(msg.includes("The world may not exist"))
  })

  test('another server URL shows its host', () => {
    const msg = teleportFailureMessage('wss://other-server.com:8443/worlds/bob/slug')
    assert.ok(msg.includes('other-server.com:8443'))
    assert.ok(msg.includes('/worlds/bob/slug'))
  })

  test('returning variant gives "Couldn\'t return to <dest>."', () => {
    const msg = teleportFailureMessage('ws://atrium.example/worlds/josh/garden', { returning: true })
    assert.ok(msg.startsWith("Couldn't return to "))
    assert.ok(msg.includes('atrium.example/worlds/josh/garden'))
    assert.ok(!msg.includes('The world may not exist'))
    assert.ok(msg.endsWith('.'))
  })

  test('garbage input gives sensible fallback — no throw', () => {
    const msg = teleportFailureMessage('not a valid url at all!!!')
    // Should produce something sensible — "Couldn't open the destination..."
    assert.ok(msg.startsWith("Couldn't open "))
    assert.ok(msg.includes('the destination'))
  })

  test('null input gives fallback — no throw', () => {
    const msg = teleportFailureMessage(null)
    assert.ok(msg.startsWith("Couldn't open "))
    assert.ok(msg.includes('the destination'))
  })

  test('undefined input gives fallback — no throw', () => {
    const msg = teleportFailureMessage(undefined)
    assert.ok(msg.startsWith("Couldn't open "))
  })

  test('HTML-like characters come back unchanged (escaping is DOM job)', () => {
    // URL with percent-encoded HTML chars — these pass through URL parsing
    const msg = teleportFailureMessage('ws://evil.com/%3Cscript%3Ealert(1)%3C/script%3E')
    // The host is evil.com, the path stays percent-encoded (no decoding)
    assert.ok(msg.includes('evil.com'), 'host is intact')
    assert.ok(!msg.includes('&lt;'), 'no HTML escaping in the helper')
    // The path passed through as-is (percent-encoded)
    assert.ok(msg.includes('%3C'), 'percent-encoded chars preserved')
  })

  test('returning with null prevWorldUrl gives fallback', () => {
    const msg = teleportFailureMessage(null, { returning: true })
    assert.ok(msg.startsWith("Couldn't return to "))
  })

  test('/ destination in URL shows commons', () => {
    const msg = teleportFailureMessage('ws://atrium.example/')
    assert.ok(msg.includes('the commons on atrium.example'))
  })

  test('long destination truncated in message', () => {
    const longHost = 'a-very-long-host.example-company.com'
    const longPath = '/worlds/' + 'x'.repeat(60) + '/' + 'y'.repeat(60)
    const url = `ws://${longHost}${longPath}`
    const msg = teleportFailureMessage(url)
    // The dest should be truncated — host intact, path middle-truncated
    assert.ok(msg.startsWith("Couldn't open "))
    assert.ok(msg.includes(longHost))
    assert.ok(msg.includes('\u2026'))
  })

  test('returning path shows correct message', () => {
    const msg = teleportFailureMessage('ws://srv.local/worlds/a/b', { returning: true })
    assert.equal(msg, "Couldn't return to srv.local/worlds/a/b.")
  })
})