// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// teleporter-marker.test.js — unit tests for isTeleporter / teleporterDestination
// Pure functions, no DOM, just node:test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isTeleporter, teleporterDestination } from '../src/teleporter-marker.js'

describe('isTeleporter', () => {

  test('valid teleporter with non-empty destination → true', () => {
    const node = { extras: { atrium: { teleporter: { destination: '/worlds/jane/home' } } } }
    assert.equal(isTeleporter(node), true)
  })

  test('valid teleporter with ws:// destination → true', () => {
    const node = { extras: { atrium: { teleporter: { destination: 'ws://other-server.com/worlds/bob/slug' } } } }
    assert.equal(isTeleporter(node), true)
  })

  test('empty destination string → false', () => {
    const node = { extras: { atrium: { teleporter: { destination: '' } } } }
    assert.equal(isTeleporter(node), false)
  })

  test('missing teleporter key → false', () => {
    const node = { extras: { atrium: {} } }
    assert.equal(isTeleporter(node), false)
  })

  test('missing extras entirely → false', () => {
    const node = { name: 'test' }
    assert.equal(isTeleporter(node), false)
  })

  test('null node → false', () => {
    assert.equal(isTeleporter(null), false)
  })

  test('undefined node → false', () => {
    assert.equal(isTeleporter(undefined), false)
  })

  test('destination is non-string (number) → false', () => {
    const node = { extras: { atrium: { teleporter: { destination: 42 } } } }
    assert.equal(isTeleporter(node), false)
  })
})

describe('teleporterDestination', () => {

  test('returns destination string for valid teleporter', () => {
    const node = { extras: { atrium: { teleporter: { destination: '/worlds/jane/home' } } } }
    assert.equal(teleporterDestination(node), '/worlds/jane/home')
  })

  test('returns null for non-teleporter node', () => {
    const node = { extras: { atrium: {} } }
    assert.equal(teleporterDestination(node), null)
  })

  test('returns null for null node', () => {
    assert.equal(teleporterDestination(null), null)
  })
})
