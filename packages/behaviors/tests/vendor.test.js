// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// vendor.test.js — scripting-4b-2 F3 (F-L11): the vendored engine and gl-matrix
// resolve in Node by their bare names, and every file VENDORED.md lists is the
// file on disk (byte count and sha256).
//
// Two properties, both load-bearing for the round:
//   * the engine is imported by its BARE name here exactly as
//     packages/server/src/send-policy.js imports it, so a broken vendoring or a
//     missing workspace link fails at load, not at the first behaviour;
//   * VENDORED.md is the record of what was vendored; a hand-edited build
//     artefact (proof (c)) shows up as a hash mismatch.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateInteractivityExtension,
  validateInteractivityGraph,
  BasicBehaveEngine,
  ADecorator,
  GraphRejectedError,
} from '@khronosgroup/gltf-interactivity-engine'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')
const VENDOR_DIR = resolve(REPO_ROOT, 'packages/vendor')

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** Every `| <file> | <bytes> | <sha256> |` row of VENDORED.md. */
function vendoredRows() {
  const text = readFileSync(resolve(VENDOR_DIR, 'VENDORED.md'), 'utf-8')
  const rows = []
  for (const line of text.split('\n')) {
    const match = /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([0-9a-f]{64})\s*\|\s*$/.exec(line)
    if (match) rows.push({ file: match[1], bytes: Number(match[2]), sha256: match[3] })
  }
  return rows
}

describe('F3 — the vendored engine resolves in Node', () => {
  test('the five engine entry points resolve by the bare name', () => {
    assert.equal(typeof validateInteractivityExtension, 'function')
    assert.equal(typeof validateInteractivityGraph, 'function')
    assert.equal(typeof BasicBehaveEngine, 'function')
    assert.equal(typeof ADecorator, 'function')
    assert.equal(typeof GraphRejectedError, 'function')
  })

  test('gl-matrix resolves through the engine\'s workspace link', async () => {
    // The engine's own bare `import * as glMatrix from 'gl-matrix'` has already
    // run by the time this file loaded; import it directly too, so a broken
    // gl-matrix package fails here rather than inside a graph run.
    const glMatrix = await import('gl-matrix')
    assert.equal(typeof glMatrix.mat4.create, 'function')
    assert.equal(typeof glMatrix.vec3.create, 'function')
  })

  test('the validator is callable and refuses a non-graph', () => {
    // The schema has minItems: 1 on types, declarations and nodes, so an empty
    // graph is refused; so is a value that is not an object at all.
    assert.throws(() => validateInteractivityGraph({ types: [], declarations: [], nodes: [] }))
    assert.throws(() => validateInteractivityGraph(undefined))
    assert.throws(() => validateInteractivityGraph(42))
  })
})

describe('F3 — VENDORED.md lists every vendored file with its hash', () => {
  const rows = vendoredRows()

  test('the record is not empty and names both packages', () => {
    assert.ok(rows.length >= 12, `expected the vendored files, saw ${rows.length} rows`)
    const files = rows.map((r) => r.file)
    assert.ok(files.some((f) => f.startsWith('gltf-interactivity-engine/')), 'engine files listed')
    assert.ok(files.some((f) => f.startsWith('gl-matrix/esm/')), 'gl-matrix esm files listed')
  })

  for (const row of vendoredRows()) {
    test(`${row.file} matches its recorded bytes and sha256`, () => {
      let bytes
      try {
        bytes = readFileSync(resolve(VENDOR_DIR, row.file))
      } catch {
        assert.fail(`VENDORED.md lists ${row.file}, which is not on disk`)
      }
      assert.equal(bytes.length, row.bytes, `${row.file}: byte count`)
      assert.equal(sha256(bytes), row.sha256, `${row.file}: sha256`)
    })
  }
})
