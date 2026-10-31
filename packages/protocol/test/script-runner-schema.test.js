// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// script-runner-schema.test.js — scripting-4b-2 F2/F-L6, scripting-4c S2, and
// scripting-4d R1/G-L9. `hello.capabilities.scriptRunner` is an optional
// integer, and its enum is authoritative: 1 (4b-2 graphs), 2 (4c: also forwards
// `activate`), 3 (4d graphs; election and handover require 3). `capabilities`
// still refuses every unknown key, so nothing else can ride in.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validate } from '../src/index.js'

const hello = (capabilities) => ({ type: 'hello', id: 'h1', ...(capabilities === undefined ? {} : { capabilities }) })

test('F-L6: scriptRunner: 1 and 2 are accepted', () => {
  assert.equal(validate('client', hello({ scriptRunner: 1 })).valid, true)
  // scripting-4c S2 — 2 declares a tab that also handles forwarded `activate`.
  assert.equal(validate('client', hello({ scriptRunner: 2 })).valid, true)
})

test('R1/G-L9: scriptRunner: 3 is accepted (the schema keeps 1 and 2 too)', () => {
  assert.equal(validate('client', hello({ scriptRunner: 3 })).valid, true)
})

test('F-L6: scriptRunner is optional', () => {
  assert.equal(validate('client', hello({})).valid, true)
  assert.equal(validate('client', hello(undefined)).valid, true)
})

test('R1: scriptRunner: 4, 0, "3", true, 2.5, -1 or null is refused', () => {
  for (const bad of [4, 0, '3', true, 2.5, -1, null]) {
    const result = validate('client', hello({ scriptRunner: bad }))
    assert.equal(result.valid, false, `scriptRunner ${JSON.stringify(bad)} must be refused`)
  }
})

test('F-L6: scriptRunner rides beside the existing capabilities', () => {
  assert.equal(validate('client', hello({ tick: { interval: 5000 }, scriptRunner: 1 })).valid, true)
  assert.equal(validate('client', hello({ tick: { interval: 5000 }, scriptRunner: 3 })).valid, true)
})

test('F-L6: an unknown capability key is still refused', () => {
  assert.equal(validate('client', hello({ scriptRunner: 1, graphs: true })).valid, false)
})

test('F-L6: the hello a 4b-1 tab sends (no scriptRunner) still validates', () => {
  assert.equal(validate('client', hello({ tick: { interval: 5000 }, physics: false, chat: false })).valid, true)
})
