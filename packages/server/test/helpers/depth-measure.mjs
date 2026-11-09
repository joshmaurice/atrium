// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// depth-measure — §6.2 (PREBRIEF-message-depth-guard.md): the deepest
// legitimate message, split into four files by selection-parts P0
// (PREBRIEF-selection-parts.md §4). TEST CODE ONLY.
//
// MAX_MESSAGE_DEPTH = 64 is only defensible against a measured number, so the
// measure files run the EXISTING server suites (each file individually, as the
// deploy does) with the depth measurement switched on. The recorder is TEST
// CODE (depth-recorder.mjs), loaded into each run with `node --import`: it
// wraps the server's inbound messages from the outside, so packages/server/src
// carries ONLY G1 (the walk + the guard) and G2 (the try/catch) — no test-mode
// branch, environment flag or hook. Every message those suites send to their
// in-process server is recorded, and the deepest of them must be 32 or less —
// half the guard's limit. (A message sent to a child server a suite spawns, as
// world-total.test.js's, isn't recorded; those are shallow.)
//
// The whole set took about 195 s (selection-parts §2.1), too long for one file
// under the deploy's 180 s per file, so it runs as four:
//   message-depth-measure-1/-2/-3.test.js  the three SHARDS (every suite but
//                                          SOLO, by index mod 3)
//   message-depth-measure-4.test.js        SOLO: world-visibility.test.js, ~61 s
// Each file takes its list from its OWN NAME (`listFor`), so none can run
// another's. message-depth-shards.test.js guards the split.
//
// Excluded, each for a stated reason:
//   message-depth.test.js     sends deliberately over-deep messages (§6.1
//                             (a)–(f)); hostile by design, not legitimate.
//   behavior-walk.test.js     the same, for its V9 deep-send test: one `send`
//                             whose `graph` is nested 6,500 deep, refused by
//                             the guard (round 6, W0).
//   the measure files         they would spawn themselves.
// Until selection-parts, world-visibility, payload-cap and home-world were
// also left out, for time alone; they are measured now.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { MAX_MESSAGE_DEPTH } from '../../src/message-depth.js'

const TEST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_ROOT = resolve(TEST_DIR, '..')
const RECORDER = resolve(TEST_DIR, 'helpers/depth-recorder.mjs')
const PER_FILE_TIMEOUT_MS = 150_000

/** The spec's ceiling for the deepest legitimate message. */
export const LEGITIMATE_DEPTH_CEILING = 32

/** Hostile by design: never measured. */
export const HOSTILE = Object.freeze(['message-depth.test.js', 'behavior-walk.test.js'])

/** Measured in a file of its own (about 61 s). */
export const SOLO = Object.freeze(['world-visibility.test.js'])

/** How many shards the rest is split into. */
export const SHARDS = 3

const isMeasureFile = (f) => /^message-depth-measure-\d+\.test\.js$/.test(f) || f === 'message-depth-shards.test.js'

/** Every legitimate server suite, sorted: `test/*.test.js` less HOSTILE and the measure files. */
export function serverTestFiles() {
  return readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => !HOSTILE.includes(f) && !isMeasureFile(f))
    .sort()
}

/** The files of shard `k` of `n`: SOLO left out, numbered from 0, those whose number is k mod n. */
export function shard(k, n) {
  return serverTestFiles().filter((f) => !SOLO.includes(f)).filter((_, i) => i % n === k)
}

/** The list a measure file runs, from its own file name. */
export function listFor(fileName) {
  const m = /^message-depth-measure-(\d+)\.test\.js$/.exec(fileName)
  const i = m ? Number(m[1]) : NaN
  if (i >= 1 && i <= SHARDS) return shard(i - 1, SHARDS)
  if (i === SHARDS + 1) return [...SOLO]
  throw new Error(`${fileName} is not a measure file`)
}

function readRecord(file) {
  const entries = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    entries.push(JSON.parse(line))
  }
  return entries
}

/**
 * Run each of `files` under the recorder, one at a time, and assert the
 * deepest message they send is within the ceiling. Prints a line per file,
 * the deepest message and the elapsed time.
 *
 * @param {string[]} files  test file names in `test/`
 * @param {{ label: string }} opts
 */
export function measureFiles(files, { label }) {
  const started = Date.now()
  assert.ok(files.length > 0, `${label}: the list is empty`)
  const dir = mkdtempSync(join(tmpdir(), 'atrium-depth-'))
  const record = join(dir, 'record.jsonl')

  const perFile = []
  let deepest = { type: null, depth: 0 }
  let messages = 0

  for (const file of files) {
    writeFileSync(record, '')
    // Strip this runner's own NODE_TEST_CONTEXT: a nested `node --test` that
    // inherits it does not run the file it is given.
    const env = { ...process.env, ATRIUM_DEPTH_RECORD: record }
    delete env.NODE_TEST_CONTEXT
    const t0 = Date.now()
    const result = spawnSync(process.execPath,
      ['--import', RECORDER, '--test', `test/${file}`], {
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
    perFile.push({ file, count: entries.length, depth: max, type, ms: Date.now() - t0 })
    if (max > deepest.depth) deepest = { type, depth: max }
  }

  assert.ok(messages > 0, `${label}: the recording is empty: the recorder did not run`)

  for (const row of perFile) {
    console.log(`  ${row.file.padEnd(42)} messages=${String(row.count).padStart(5)} deepest=${row.depth} (${row.type ?? '-'}) ${(row.ms / 1000).toFixed(1)} s`)
  }
  console.log(`§6.2 ${label}: deepest legitimate message depth ${deepest.depth} (type ${deepest.type}) over ${messages} recorded messages in ${perFile.length} suites, ${((Date.now() - started) / 1000).toFixed(1)} s`)

  assert.ok(deepest.depth <= LEGITIMATE_DEPTH_CEILING,
    `${label}: the deepest legitimate message is depth ${deepest.depth} (type ${deepest.type}); the spec's ceiling is ${LEGITIMATE_DEPTH_CEILING} and the guard's limit is ${MAX_MESSAGE_DEPTH}`)
  return { deepest, messages, perFile }
}
