// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// edit-duplicate-credit.test.js — copy-objects K2/K3, the client side.
//
// Duplicate's `atriumProblem` gives the server's verdict on the credit, so a
// Duplicate or Undo of a malformed legacy credit is refused with its own
// reason, and Copy can skip it (`{ credit: false }`, K5). The vectors are the
// SHARED file the server's credit-check.test.js reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  atriumProblem, creditProblem, duplicateRuleProblem, prepareDuplicate, prepareRestore, DUPLICATE_REASONS,
  creditIdOk, creditNameOk, creditServerOk, creditDateOk, creditAddressOk,
} from '../src/edit-duplicate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VECTORS = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/credit-vectors.json'), 'utf8'))

const FORMS = { id: creditIdOk, name: creditNameOk, server: creditServerOk, date: creditDateOk, address: creditAddressOk }

function node(extras = {}) {
  return {
    getName: () => 'Crate',
    getTranslation: () => [1, 0.5, 2], getRotation: () => [0, 0, 0, 1], getScale: () => [1, 1, 1],
    getExtras: () => extras, getMesh: () => null, listChildren: () => [],
    listParents: () => [{ propertyType: 'Root' }, { propertyType: 'Scene' }],
    getCamera: () => null, getSkin: () => null, getWeights: () => [],
    getExtension: () => null, listExtensions: () => [],
  }
}

test('the shared credit vectors: creditProblem names the server\'s field', () => {
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

test('the shared credit vectors through atriumProblem, and Duplicate\'s rule', () => {
  for (const v of VECTORS.credit) {
    const extras = { atrium: v.atrium }
    const p = atriumProblem(extras)
    const rule = duplicateRuleProblem(node(extras))
    if (v.ok) {
      assert.equal(p, null, `${v.label}: accepted (${p})`)
      assert.equal(rule, null, `${v.label}: duplicable`)
    } else {
      assert.ok(p?.startsWith('its credit is malformed ('), `${v.label}: ${p}`)
      assert.ok(p.includes(`extras.atrium.${v.field}`), `${v.label}: ${p}`)
      assert.equal(rule?.rule, 'atrium', `${v.label}: the atrium rule`)
      assert.ok(rule.reason.startsWith(DUPLICATE_REASONS.atrium), rule.reason)
    }
  }
})

test('{ credit: false } skips the credit and nothing else (Copy, K5)', () => {
  for (const v of VECTORS.credit.filter((x) => !x.ok)) {
    const extras = { atrium: v.atrium }
    assert.equal(atriumProblem(extras, { credit: false }), null, `${v.label}: skipped`)
    assert.equal(duplicateRuleProblem(node(extras), { credit: false }), null, `${v.label}: skipped by the rule`)
  }
  // The rest of the atrium rule still runs.
  const bad = { atrium: { origin: 'x', teleporter: { destination: 7 } } }
  assert.match(atriumProblem(bad, { credit: false }), /teleporter/)
})

test('creditProblem({ key }) checks one key only', () => {
  const atrium = { origin: 'x', copiedFrom: { server: 'https://h.example', address: '/', at: '2026-11-06' } }
  assert.equal(creditProblem(atrium, { key: 'copiedFrom' }), null)
  assert.equal(creditProblem(atrium, { key: 'origin' })?.field, 'origin')
})

test('the shared field forms', () => {
  for (const f of VECTORS.forms) {
    assert.equal(FORMS[f.form](f.value), f.ok, `${f.form} ${f.label}`)
  }
})

test('a Duplicate and a restore keep a valid credit exactly (K2: a Duplicate keeps both keys)', () => {
  const both = VECTORS.credit.find((v) => v.label === 'both keys').atrium
  const extras = { atrium: { objectId: '3f2a9c1e-7b4d-4e8a-9c21-5d6e7f809a1b', ...structuredClone(both) } }
  const dup = prepareDuplicate(node(extras), { name: 'Crate copy' })
  assert.equal(dup.ok, true, dup.reason)
  assert.deepEqual(dup.descriptor.extras.atrium.origin, both.origin)
  assert.deepEqual(dup.descriptor.extras.atrium.copiedFrom, both.copiedFrom)
  const restored = prepareRestore(node(extras))
  assert.equal(restored.ok, true, restored.reason)
  assert.deepEqual(restored.descriptor.extras, extras)
})

test('a Duplicate and a restore of a malformed credit are refused with its reason', () => {
  const n = node({ atrium: { objectId: '3f2a9c1e-7b4d-4e8a-9c21-5d6e7f809a1b', origin: { server: 'https://h.example' } } })
  const dup = prepareDuplicate(n, { name: 'Crate copy' })
  assert.equal(dup.ok, false)
  assert.equal(dup.rule, 'atrium')
  assert.match(dup.reason, /its credit is malformed \(extras\.atrium\.origin\.at is required\)/)
  assert.equal(prepareRestore(n).ok, false)
})
