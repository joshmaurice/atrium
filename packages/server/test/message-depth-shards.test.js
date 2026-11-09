// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// message-depth-shards — selection-parts P0: the guard on the depth
// measurement's split. No spawn; it runs in well under a second.
//
// It lists `test/*.test.js` ITSELF and names every exclusion literally, so a
// filter in the helper that is too broad (and drops a suite from both the
// shards and the list they are checked against) still fails here. And it
// checks that the four measure files exist and that each one's own name maps
// to its own list, so a renamed, deleted or mis-pointed shard file fails too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { HOSTILE, SOLO, SHARDS, shard, listFor, serverTestFiles } from './helpers/depth-measure.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Named literally: never derived from the helper. */
const HOSTILE_FILES = ['message-depth.test.js', 'behavior-walk.test.js']
const MEASURE_FILES = [
  'message-depth-measure-1.test.js',
  'message-depth-measure-2.test.js',
  'message-depth-measure-3.test.js',
  'message-depth-measure-4.test.js',
  'message-depth-shards.test.js',
]

test('P0: the four measure files exist (a renamed or deleted shard file fails)', () => {
  for (const f of MEASURE_FILES) assert.ok(existsSync(join(__dirname, f)), `${f} is missing`)
  assert.equal(existsSync(join(__dirname, 'message-depth-measure.test.js')), false,
    'the unsplit message-depth-measure.test.js is gone')
})

test('P0: the hostile exclusions name files that exist, and are exactly the two', () => {
  assert.deepEqual([...HOSTILE].sort(), [...HOSTILE_FILES].sort())
  for (const f of HOSTILE_FILES) assert.ok(existsSync(join(__dirname, f)), `${f} is missing`)
})

test('P0: the shards and SOLO together hold every legitimate server suite, each once', () => {
  const expected = readdirSync(__dirname)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => !HOSTILE_FILES.includes(f) && !MEASURE_FILES.includes(f))
    .sort()
  const lists = [shard(0, SHARDS), shard(1, SHARDS), shard(2, SHARDS), SOLO]
  const all = lists.flat()
  assert.equal(new Set(all).size, all.length, 'no file is in two lists')
  assert.deepEqual([...all].sort(), expected)
  for (const l of lists) assert.ok(l.length > 0, 'no list is empty')
  // the helper's own listing agrees with this one (a second, independent check)
  assert.deepEqual(serverTestFiles(), expected)
})

test('P0: each measure file\'s own name maps to its own list', () => {
  assert.deepEqual(listFor('message-depth-measure-1.test.js'), shard(0, SHARDS))
  assert.deepEqual(listFor('message-depth-measure-2.test.js'), shard(1, SHARDS))
  assert.deepEqual(listFor('message-depth-measure-3.test.js'), shard(2, SHARDS))
  assert.deepEqual(listFor('message-depth-measure-4.test.js'), [...SOLO])
  assert.throws(() => listFor('message-depth-measure-5.test.js'))
})

test('P0: no measure file is in any list', () => {
  const all = [shard(0, SHARDS), shard(1, SHARDS), shard(2, SHARDS), SOLO].flat()
  for (const f of MEASURE_FILES) assert.equal(all.includes(f), false, `${f} would spawn itself`)
  for (const f of HOSTILE_FILES) assert.equal(all.includes(f), false, `${f} is hostile by design`)
})
