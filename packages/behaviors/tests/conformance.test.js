// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// conformance.test.js — scripting-4b-2 step 3, F11.
//
// The Khronos assets are not on the build host. When `KHRONOS_ASSETS` points at
// a checkout at 926bec45 the checked-in expected list is recomputed and must
// match exactly, and the subset is run through the real adapter. Without the
// env var the whole file SKIPS with a logged reason — the one skip this round
// allows, and it is named in the handoff.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { conformanceSubset, runConformance, KHRONOS_ASSETS_COMMIT } from '../scripts/conformance.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXPECTED = JSON.parse(readFileSync(resolve(__dirname, '../../../tests/fixtures/behavior-conformance.json'), 'utf8'))
const ASSETS = process.env.KHRONOS_ASSETS

describe('F11 — the conformance subset', () => {
  test('the checked-in expected list is a list from the pinned commit', () => {
    assert.ok(Array.isArray(EXPECTED.expected), 'the expected list is an array')
    assert.equal(EXPECTED.source.includes(KHRONOS_ASSETS_COMMIT), true, 'the assets commit is pinned')
  })

  test('the subset recomputes exactly against the checked-in list', (t) => {
    if (!ASSETS) {
      // The ONE allowed skip of the round: the Khronos assets are not on the host.
      t.skip('KHRONOS_ASSETS is not set — the conformance subset cannot be recomputed (skipped, not failed)')
      return
    }
    assert.deepEqual(conformanceSubset(ASSETS), EXPECTED.expected,
      'the checked-in list must match the assets exactly')
  })

  test('every asset in the subset passes through the real adapter', async (t) => {
    if (!ASSETS) {
      t.skip('KHRONOS_ASSETS is not set — the conformance run cannot happen')
      return
    }
    const results = await runConformance(ASSETS)
    assert.deepEqual(results.filter((r) => r.result !== 'pass'), [], 'every subset asset passes')
    assert.equal(results.length, EXPECTED.expected.length, 'the run covers the expected list')
  })
})
