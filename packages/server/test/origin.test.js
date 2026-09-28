// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// Unit tests for isSameOriginUpgrade (pre-brief #2) — pure function,
// no database needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSameOriginUpgrade } from '../src/http-routes.js'

test('same-origin: match via X-Forwarded-Proto', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: 'h',
      'x-forwarded-proto': 'https',
    },
  }
  assert.equal(isSameOriginUpgrade(req), true)
})

test('scheme mismatch: Origin http vs X-Forwarded-Proto https', () => {
  const req = {
    headers: {
      origin: 'http://h',
      host: 'h',
      'x-forwarded-proto': 'https',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('no X-Forwarded-Proto: Origin https vs Node http', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: 'h',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('port mismatch via Host header', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: 'h:3000',
      'x-forwarded-proto': 'https',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('same-origin: localhost same port', () => {
  const req = {
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    },
  }
  assert.equal(isSameOriginUpgrade(req), true)
})

test('default port normalization', () => {
  const req = {
    headers: {
      origin: 'https://h:443',
      host: 'h',
      'x-forwarded-proto': 'https',
    },
  }
  assert.equal(isSameOriginUpgrade(req), true)
})

test('hostname case difference', () => {
  const req = {
    headers: {
      origin: 'https://EXAMPLE.com',
      host: 'example.com',
      'x-forwarded-proto': 'https',
    },
  }
  assert.equal(isSameOriginUpgrade(req), true)
})

test('X-Forwarded-Proto first value used', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: 'h',
      'x-forwarded-proto': 'https, http',
    },
  }
  assert.equal(isSameOriginUpgrade(req), true)
})

test('X-Forwarded-Proto trimmed and lowercased', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: 'h',
      'x-forwarded-proto': ' HTTPS ',
    },
  }
  assert.equal(isSameOriginUpgrade(req), true)
})

test('X-Forwarded-Proto wss fails closed', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: 'h',
      'x-forwarded-proto': 'wss',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('X-Forwarded-Proto ftp fails closed', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: 'h',
      'x-forwarded-proto': 'ftp',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('X-Forwarded-Proto empty fails closed', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: 'h',
      'x-forwarded-proto': '',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('no X-Forwarded-Proto with matching http origin', () => {
  const req = {
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    },
  }
  assert.equal(isSameOriginUpgrade(req), true)
})

test('Origin null → not same-origin', () => {
  const req = {
    headers: {
      origin: 'null',
      host: 'h',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('garbage Origin → not same-origin', () => {
  const req = {
    headers: {
      origin: 'not a url',
      host: 'h',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('garbage Host → not same-origin', () => {
  const req = {
    headers: {
      origin: 'https://h',
      host: '',
    },
  }
  assert.equal(isSameOriginUpgrade(req), false)
})

test('no Origin header → same-origin (non-browser client)', () => {
  const req = {
    headers: {
      host: 'h',
    },
  }
  assert.equal(isSameOriginUpgrade(req), true)
})