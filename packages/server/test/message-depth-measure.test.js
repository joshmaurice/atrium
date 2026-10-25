// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// message-depth-measure — §6.2: the deepest legitimate message.
//
// MAX_MESSAGE_DEPTH = 64 is only defensible against a measured number, so this
// file runs the EXISTING server suites (each file individually, as the deploy
// does) with the depth measurement switched on
// (message-depth.js's ATRIUM_DEPTH_RECORD hook, a no-op unless the variable is
// set). Every message those suites send to their server is recorded, and the
// deepest of them must be 32 or less — half the guard's limit.
//
// Excluded, each for a stated reason:
//   message-depth.test.js          sends deliberately over-deep messages
//                                  (§6.1 (a)–(f)); hostile by design, not
//                                  legitimate traffic.
//   message-depth-measure.test.js  this file.
//   world-visibility.test.js       the three slowest suites in the set (61 s,
//   payload-cap.test.js            5.5 s, 5.4 s). None sends a nested message,
//   home-world.test.js             and running them here would put this file
//                                  over the deploy's 180 s per-file budget.
//                                  The handoff reports the measurement over the
//                                  FULL set, these three included.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { MAX_MESSAGE_DEPTH } from '../src/message-depth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = resolve(__dirname, '..')
const PER_FILE_TIMEOUT_MS = 150_000

const EXCLUDED = new Set([
  'message-depth.test.js',
  'message-depth-measure.test.js',
  'world-visibility.test.js',
  'payload-cap.test.js',
  'home-world.test.js',
])

/** The spec's ceiling for the deepest legitimate message. */
const LEGITIMATE_DEPTH_CEILING = 32

function readRecord(file) {
  const text = readFileSync(file, 'utf8')
  const entries = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    entries.push(JSON.parse(line))
  }
  return entries
}

test('§6.2: the deepest legitimate message the existing suites send is 32 or less', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-depth-'))
  const record = join(dir, 'record.jsonl')
  writeFileSync(record, '')

  const files = readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js') && !EXCLUDED.has(f))
    .sort()
  assert.ok(files.length > 20, `expected the server suites, found ${files.length}`)

  const perFile = []
  let deepest = { type: null, depth: 0 }
  let messages = 0

  for (const file of files) {
    writeFileSync(record, '')
    // Strip this runner's own NODE_TEST_CONTEXT: a nested `node --test` that
    // inherits it does not run the file it is given.
    const env = { ...process.env, ATRIUM_DEPTH_RECORD: record }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', `test/${file}`], {
      cwd: SERVER_ROOT,
      env,
      encoding: 'utf8',
      timeout: PER_FILE_TIMEOUT_MS,
    })
    assert.equal(result.signal, null,
      `${file} did not exit on its own (signal ${result.signal}) under the recording`)
    assert.equal(result.status, 0,
      `${file} must stay green under the recording:\n${(result.stdout ?? '').slice(-4000)}\n${(result.stderr ?? '').slice(-2000)}`)

    const entries = readRecord(record)
    messages += entries.length
    let max = 0
    let type = null
    for (const e of entries) {
      if (e.depth > max) { max = e.depth; type = e.type }
    }
    perFile.push({ file, count: entries.length, depth: max, type })
    if (max > deepest.depth) deepest = { type, depth: max }
  }

  assert.ok(messages > 0, 'the recording is empty: the measurement hook did not run')

  for (const row of perFile) {
    console.log(`  ${row.file.padEnd(42)} messages=${String(row.count).padStart(5)} deepest=${row.depth} (${row.type ?? '-'})`)
  }
  console.log(`§6.2 deepest legitimate message: depth ${deepest.depth} (type ${deepest.type}) over ${messages} recorded messages in ${perFile.length} suites`)

  assert.ok(deepest.depth <= LEGITIMATE_DEPTH_CEILING,
    `the deepest legitimate message is depth ${deepest.depth} (type ${deepest.type}); the spec's ceiling is ${LEGITIMATE_DEPTH_CEILING} and the guard's limit is ${MAX_MESSAGE_DEPTH}`)
})
