// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// script-runner-schema.test.js — scripting-4b-2 F2/F-L6: the ONE protocol change
// this round makes. `hello.capabilities.scriptRunner`, an integer const 1,
// optional. `capabilities` still refuses every unknown key, so nothing else can
// ride in.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validate } from '../src/index.js'

const hello = (capabilities) => ({ type: 'hello', id: 'h1', ...(capabilities === undefined ? {} : { capabilities }) })

test('F-L6: scriptRunner: 1 is accepted', () => {
  assert.equal(validate('client', hello({ scriptRunner: 1 })).valid, true)
})

test('F-L6: scriptRunner is optional', () => {
  assert.equal(validate('client', hello({})).valid, true)
  assert.equal(validate('client', hello(undefined)).valid, true)
})

test('F-L6: scriptRunner: 2, 0, true or "1" is refused', () => {
  for (const bad of [2, 0, true, '1', null]) {
    const result = validate('client', hello({ scriptRunner: bad }))
    assert.equal(result.valid, false, `scriptRunner ${JSON.stringify(bad)} must be refused`)
  }
})

test('F-L6: scriptRunner rides beside the existing capabilities', () => {
  assert.equal(validate('client', hello({ tick: { interval: 5000 }, scriptRunner: 1 })).valid, true)
})

test('F-L6: an unknown capability key is still refused', () => {
  assert.equal(validate('client', hello({ scriptRunner: 1, graphs: true })).valid, false)
})

test('F-L6: the hello a 4b-1 tab sends (no scriptRunner) still validates', () => {
  assert.equal(validate('client', hello({ tick: { interval: 5000 }, physics: false, chat: false })).valid, true)
})
