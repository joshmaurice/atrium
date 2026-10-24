// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// object-identity.test.js — scripting-4b-1 E7. The pure helper that gives a NEW
// object its permanent extras.atrium.objectId. It must return a copy, keep every
// other key exactly as it is, create extras and atrium when they are missing,
// and replace an id when one is already there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withNewObjectId } from '../src/object-identity.js'

const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

test('E7: adds an id without touching any other key', () => {
  const source = { name: 'Cube', translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
  const out = withNewObjectId(source, () => ID)
  assert.deepEqual(out, { ...source, extras: { atrium: { objectId: ID } } })
})

test('E7: keeps existing extras and atrium keys', () => {
  const source = {
    name: 'Cube',
    extras: { displayName: 'Cube one', atrium: { ephemeral: true, animation: { clip: 'Idle' } } },
  }
  const out = withNewObjectId(source, () => ID)
  assert.deepEqual(out.extras, {
    displayName: 'Cube one',
    atrium: { ephemeral: true, animation: { clip: 'Idle' }, objectId: ID },
  })
})

test('E7: replaces an existing id', () => {
  const source = { name: 'Cube', extras: { atrium: { objectId: OTHER } } }
  const out = withNewObjectId(source, () => ID)
  assert.equal(out.extras.atrium.objectId, ID)
})

test('E7: does not mutate its input', () => {
  const source = { name: 'Cube', extras: { atrium: { objectId: OTHER } } }
  const before = structuredClone(source)
  withNewObjectId(source, () => ID)
  assert.deepEqual(source, before, 'the original descriptor is unchanged')
})

test('E7: creates extras and atrium when neither exists', () => {
  const out = withNewObjectId({ name: 'Cube' }, () => ID)
  assert.deepEqual(out.extras, { atrium: { objectId: ID } })
})

test('E7: creates atrium when extras exists but atrium does not', () => {
  const out = withNewObjectId({ name: 'Cube', extras: { displayName: 'Cube one' } }, () => ID)
  assert.deepEqual(out.extras, { displayName: 'Cube one', atrium: { objectId: ID } })
})

test('E7: a non-plain extras or atrium is replaced, not trusted', () => {
  for (const extras of [null, [], 'text', 42]) {
    const out = withNewObjectId({ name: 'Cube', extras }, () => ID)
    assert.deepEqual(out.extras, { atrium: { objectId: ID } }, `${JSON.stringify(extras)} was replaced`)
  }
  for (const atrium of [null, [], 'text', 42]) {
    const out = withNewObjectId({ name: 'Cube', extras: { atrium } }, () => ID)
    assert.deepEqual(out.extras.atrium, { objectId: ID }, `${JSON.stringify(atrium)} was replaced`)
  }
})

test('E7: a non-object descriptor still gives a usable object', () => {
  for (const descriptor of [null, undefined, [], 'text', 42]) {
    const out = withNewObjectId(descriptor, () => ID)
    assert.deepEqual(out, { extras: { atrium: { objectId: ID } } })
  }
})

test('E7: the default source is newObjectId, so each call gives a fresh id', () => {
  const a = withNewObjectId({ name: 'Cube' })
  const b = withNewObjectId({ name: 'Cube' })
  assert.match(a.extras.atrium.objectId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(a.extras.atrium.objectId, b.extras.atrium.objectId)
})
