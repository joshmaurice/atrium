// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// credit-check — copy-objects K2/K3: the server's check on the credit
// (`extras.atrium.origin`, `extras.atrium.copiedFrom`), form and bounds only.
// The vectors are the SHARED file (tests/fixtures/credit-vectors.json), read
// by Duplicate's tests too; this file does not restate the rules.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import {
  checkAtriumExtras, creditProblem,
  creditIdOk, creditNameOk, creditServerOk, creditDateOk, creditAddressOk,
} from '../src/send-policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/credit-vectors.json'), 'utf8'))

const FORMS = { id: creditIdOk, name: creditNameOk, server: creditServerOk, date: creditDateOk, address: creditAddressOk }

test('the shared credit vectors: creditProblem names the same field', () => {
  assert.ok(VECTORS.credit.length >= 80, 'the shared vectors')
  for (const v of VECTORS.credit) {
    const problem = creditProblem(v.atrium)
    if (v.ok) assert.equal(problem, null, `${v.label}: accepted (${problem?.message})`)
    else {
      assert.ok(problem, `${v.label}: refused`)
      assert.equal(problem.field, v.field, `${v.label}: names ${v.field} (${problem.message})`)
    }
  }
})

test('the shared credit vectors through checkAtriumExtras: INVALID_VALUE, the message naming the field', () => {
  for (const v of VECTORS.credit) {
    const result = checkAtriumExtras({ atrium: v.atrium })
    if (v.ok) assert.equal(result.ok, true, `${v.label}: accepted (${result.message})`)
    else {
      assert.equal(result.ok, false, `${v.label}: refused`)
      assert.equal(result.code, 'INVALID_VALUE', v.label)
      assert.ok(result.message.includes(`extras.atrium.${v.field}`), `${v.label}: ${result.message}`)
    }
  }
})

test('the shared field forms', () => {
  for (const f of VECTORS.forms) {
    assert.equal(FORMS[f.form](f.value), f.ok, `${f.form} ${f.label}`)
  }
})

test('the credit is checked after the rest of extras.atrium, and only when a key is present', () => {
  // A credit-less node is unchanged by K3.
  assert.equal(checkAtriumExtras({ atrium: { objectId: '3f2a9c1e-7b4d-4e8a-9c21-5d6e7f809a1b' } }).ok, true)
  // An unknown Atrium key is still not looked at (K3: as today).
  assert.equal(checkAtriumExtras({ atrium: { later: null } }).ok, true)
  // A bad teleporter is still named before the credit.
  const r = checkAtriumExtras({ atrium: { teleporter: 'x', origin: 'x' } })
  assert.equal(r.ok, false)
  assert.match(r.message, /teleporter/)
})
