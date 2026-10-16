// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// audit-document — Phase 3 server-cleanup, §7.1 L10: the read-only audit script
// on a healed and an unhealed document gives the expected counts, exits nonzero
// on zero or several documents, and writes nothing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(__dirname, '../scripts/audit-document.js')
const FIXTURES = resolve(__dirname, '../../../tests/fixtures')

function runAudit(input) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input,
    encoding: 'utf8',
    timeout: 60000,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const readFixture = (name) => readFileSync(resolve(FIXTURES, name), 'utf8')

/** An ungated document: an orphan mesh, a detached root, a channel with no
 *  target node, and an index past the end of its array. */
function unhealedJson({ animations = false, brokenMeshIndex = false, brokenBufferView = false } = {}) {
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Kept', mesh: 0 },
      { name: 'Detached' },
      { name: 'Orphan' },
    ],
    meshes: [
      {
        name: 'KeptMesh',
        primitives: [{
          attributes: { POSITION: 0 },
          material: 0,
          targets: [{ POSITION: 2 }],
        }],
      },
      {
        name: 'OrphanMesh',
        primitives: [{ attributes: { POSITION: 2 } }],
      },
    ],
    materials: [{ name: 'M' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: [{ buffer: 0, byteLength: 36, byteOffset: 0 }],
    buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${Buffer.alloc(36).toString('base64')}` }],
  }
  if (brokenMeshIndex) json.nodes[2].mesh = 9
  if (brokenBufferView) json.accessors[2].bufferView = 7
  if (animations) {
    json.animations = [{
      name: 'Broken',
      samplers: [{ input: 0, output: 1 }],
      channels: [{ sampler: 0, target: { path: 'translation' } }],   // no target node
    }]
  }
  return JSON.stringify(json)
}

// ===========================================================================

test('L10: the audit on a clean document reports nothing to prune, no detached roots and no dangling references', () => {
  const { status, stdout, stderr } = runAudit(readFixture('space.gltf'))
  assert.equal(status, 0, `the audit exits 0 (stderr: ${stderr})`)
  assert.match(stdout, /atrium document audit \(read-only\)/)
  assert.match(stdout, /resources:/)
  assert.match(stdout, /meshes 4/)
  assert.match(stdout, /prune dry run[\s\S]*\n {2}\(nothing\)/)
  assert.match(stdout, /detached root nodes: 0/)
  assert.match(stdout, /dangling references: 0/)
})

test('L10: the audit on an unhealed document reports the orphan resources and the detached roots', () => {
  const { status, stdout, stderr } = runAudit(unhealedJson())
  assert.equal(status, 0, `the audit exits 0 (stderr: ${stderr})`)

  // The dry run reports the orphan mesh, its primitive and its accessors.
  const pruneSection = stdout.slice(stdout.indexOf('prune dry run'), stdout.indexOf('detached root nodes'))
  assert.match(pruneSection, /mesh 1/, 'the orphan mesh is reported')
  assert.match(pruneSection, /primitive 1/, 'with its primitive')
  assert.match(pruneSection, /accessor \d+/, 'and its accessors')

  assert.match(stdout, /detached root nodes: 2/, 'Detached and Orphan are counted, not removed')
  assert.match(stdout, /"Detached"/)
  assert.match(stdout, /dangling references: 0/, 'this document has no dangling reference')
})

test('L10: the audit reports a channel with no target node and an out-of-range index', () => {
  const { status, stdout, stderr } = runAudit(unhealedJson({ animations: true, brokenMeshIndex: true }))
  assert.equal(status, 0, `the audit exits 0 (stderr: ${stderr})`)
  assert.match(stdout, /dangling references: 2/, 'both dangling references are reported')
  assert.match(stdout, /channel has no target node/)
  assert.match(stdout, /nodes\[2\]\.mesh: index 9 out of range/)
})

test('L10: an unreadable document falls back to raw JSON counts and still reports a dangling index', () => {
  const { status, stdout, stderr } = runAudit(unhealedJson({ brokenBufferView: true }))
  assert.equal(status, 0, `the audit exits 0 (stderr: ${stderr})`)
  assert.match(stdout, /raw JSON counts: glTF-Transform could not read this document/,
    'the fallback is reported, not a failure')
  assert.match(stdout, /accessors\[2\]\.bufferView: index 7 out of range/)
})

test('L10: the audit exits nonzero on zero documents, on several documents and on a bare array', () => {
  for (const [label, input] of [
    ['empty input', ''],
    ['whitespace only', '   \n  '],
    ['two documents', '{"asset":{"version":"2.0"}}{"asset":{"version":"2.0"}}'],
    ['a bare array', '[{"asset":{"version":"2.0"}}]'],
    ['a bare number', '42'],
  ]) {
    const { status, stderr } = runAudit(input)
    assert.notEqual(status, 0, `${label}: exits nonzero`)
    assert.match(stderr, /audit-document:/, `${label}: says why on stderr`)
  }
})

test('L10: the audit writes nothing — stdout only, no file and no database', () => {
  const dir = resolve(__dirname, '../scripts')
  const before = readdirSync(dir).sort()
  const { status, stdout } = runAudit(readFixture('space.gltf'))
  assert.equal(status, 0)
  assert.ok(stdout.length > 0)
  assert.deepEqual(readdirSync(dir).sort(), before, 'the scripts directory is unchanged')
})
