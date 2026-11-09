// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// selection-parts §2.1 — times each server test file under the depth recorder,
// spawned as message-depth-measure.test.js spawns them. Usage:
//   node devtasks/spike-selection-parts/depth-times.mjs packages/server
import { spawnSync } from 'node:child_process'
import { readdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const SERVER_ROOT = resolve(process.argv[2])
const TEST_DIR = join(SERVER_ROOT, 'test')
const RECORDER = join(TEST_DIR, 'helpers/depth-recorder.mjs')
const EXCLUDED = new Set(['message-depth.test.js','behavior-walk.test.js','message-depth-measure.test.js','world-visibility.test.js','payload-cap.test.js','home-world.test.js'])
const dir = mkdtempSync(join(tmpdir(), 'depth-times-'))
const record = join(dir, 'record.jsonl')
const files = readdirSync(TEST_DIR).filter(f => f.endsWith('.test.js') && !EXCLUDED.has(f)).sort()
const rows = []
for (const file of files) {
  writeFileSync(record, '')
  const env = { ...process.env, ATRIUM_DEPTH_RECORD: record }
  delete env.NODE_TEST_CONTEXT
  const t0 = performance.now()
  const r = spawnSync(process.execPath, ['--import', RECORDER, '--test', `test/${file}`], { cwd: SERVER_ROOT, env, encoding: 'utf8', timeout: 170000 })
  const ms = performance.now() - t0
  let max = 0, n = 0
  for (const line of readFileSync(record, 'utf8').split('\n')) { if (!line.trim()) continue; n++; const e = JSON.parse(line); if (e.depth > max) max = e.depth }
  rows.push({ file, s: +(ms / 1000).toFixed(1), status: r.status, signal: r.signal, messages: n, depth: max })
  console.log(JSON.stringify(rows.at(-1)))
}
console.log('TOTAL', rows.reduce((a, r) => a + r.s, 0).toFixed(1), 'files', rows.length)
