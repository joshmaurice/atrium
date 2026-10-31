// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// server-lock.test.js — scripting-4d-1 round 3, card 4 (R8, R-L2 (a)).
//
// The server's START/STOP test: the real `src/index.js`, in its own process,
// against a scratch database, with the two rollback scripts pointed at the
// same file. It pins what makes "the world server is stopped" CHECKED rather
// than assumed (round 2's M2):
//
//   * the server creates `<db>.lock` EXCLUSIVELY at start, with its pid and
//     host, and REMOVES it on a clean exit (SIGTERM here);
//   * a second server on the same database REFUSES to start, naming the pid;
//   * both rollback scripts refuse while that lock names a live pid, and
//     remove a STALE one (a dead pid) with a warning before proceeding.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { lockPathFor, readLockFile, pidIsAlive, assertServerStopped } from '../src/server-lock.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '..')
const INDEX = resolve(SERVER, 'src/index.js')
const EXPORT = resolve(SERVER, 'scripts/behaviors-export.mjs')
const RECONCILE = resolve(SERVER, 'scripts/behaviors-reconcile.mjs')
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const dirs = []
const children = []
after(async () => {
  for (const child of children) { try { child.kill('SIGKILL') } catch { /* gone */ } }
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

function scratchDir() { const d = mkdtempSync(join(tmpdir(), 'atrium-lock-')); dirs.push(d); return d }

/** Start the REAL server (src/index.js) on a scratch database, port 0. */
function startServer(dbPath) {
  const child = spawn(process.execPath, [INDEX], {
    cwd: SERVER,
    env: { ...process.env, WORLD_PATH: SPACE, ATRIUM_DB_PATH: dbPath, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  const out = []
  const listening = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`the server never listened: ${out.join('')}`)), 30000)
    const onData = (buf) => {
      const text = String(buf)
      out.push(text)
      if (/Atrium server listening/.test(text)) { clearTimeout(timer); res() }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      if (!/Atrium server listening/.test(out.join(''))) { clearTimeout(timer); rej(new Error(`the server exited ${code}: ${out.join('')}`)) }
    })
  })
  return { child, out, listening }
}

/** A second start of the same server, run to completion (it must refuse). */
const runServer = (dbPath) => new Promise((res) => {
  execFile(process.execPath, [INDEX], {
    cwd: SERVER,
    env: { ...process.env, WORLD_PATH: SPACE, ATRIUM_DB_PATH: dbPath, PORT: '0' },
    timeout: 30000,
  }, (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }))
})

const runScript = (script, args) => new Promise((res) => {
  execFile(process.execPath, [script, ...args], { cwd: SERVER, timeout: 30000 },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }))
})

/** A pid that belongs to a live child process we keep alive for the test. */
function liveChildPid() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  children.push(child)
  return child.pid
}

test('R8/R-L2 (a): the server holds <db>.lock for its lifetime, a second start refuses, and SIGTERM removes it', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'start-stop.db')
  const lockPath = lockPathFor(dbPath)

  assert.equal(existsSync(lockPath), false, 'no lock before the server starts')

  const { child, listening } = startServer(dbPath)
  await listening

  // The lock exists, exclusively, with THIS child's pid and the host.
  const lock = readLockFile(lockPath)
  assert.ok(lock, 'the server created its lifetime lock at start')
  assert.equal(lock.pid, child.pid, 'the lock names the server process')
  assert.equal(lock.host, hostname(), 'and the host it runs on')
  assert.equal(pidIsAlive(child.pid), true)

  // A second server on the same database REFUSES, naming the pid.
  const second = await runServer(dbPath)
  assert.equal(second.code, 1, `the second start refuses: ${second.stdout}${second.stderr}`)
  assert.match(second.stderr, new RegExp(`refuses to start: another server is running \\(pid ${child.pid} on ${hostname()}\\)`))

  // Both scripts refuse while that lock is live, with the reason.
  const outPath = join(dir, 'start-stop-export.json')
  const exported = await runScript(EXPORT, [dbPath, outPath])
  assert.notEqual(exported.code, 0, 'the export refuses while the server runs')
  assert.match(exported.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))
  assert.equal(existsSync(outPath), false, 'the refused export wrote nothing')

  writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
  const reconciled = await runScript(RECONCILE, [dbPath, outPath])
  assert.notEqual(reconciled.code, 0, 'the reconcile refuses while the server runs')
  assert.match(reconciled.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))

  // A clean exit (SIGTERM) removes the lock.
  child.kill('SIGTERM')
  await once(child, 'exit')
  assert.equal(existsSync(lockPath), false, 'SIGTERM removed the server lifetime lock')

  // With the server gone, the scripts run.
  const afterStop = await runScript(EXPORT, [dbPath, outPath])
  assert.equal(afterStop.code, 0, `the export runs once the server is stopped: ${afterStop.stderr}`)
})

test('R8/R-L2 (a): a STALE lock (dead pid) does not block a start — warned about and removed', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'stale.db')
  const lockPath = lockPathFor(dbPath)

  // A dead pid: a child that has exited.
  const dead = await new Promise((res) => {
    const child = execFile(process.execPath, ['-e', 'process.exit(0)'], () => res(child.pid))
  })
  assert.equal(pidIsAlive(dead), false, 'the pid is dead')
  writeFileSync(lockPath, JSON.stringify({ pid: dead, host: 'gone-host', startedAt: new Date().toISOString() }) + '\n')

  // The server starts anyway, and warns on stderr.
  const { child, out, listening } = startServer(dbPath)
  await listening
  assert.match(out.join(''), new RegExp(`\\[lock\\] stale lock from pid ${dead}, removed`), 'the stale lock is warned about')
  assert.equal(readLockFile(lockPath).pid, child.pid, 'the server replaced it with its own')
  assert.equal(pidIsAlive(readLockFile(lockPath).pid), true, 'and the lock now names the live server')
  child.kill('SIGTERM')
  await once(child, 'exit')
})

test('R8/R-L2 (a): assertServerStopped refuses only while the named pid is ALIVE, and never removes a live lock', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'unit.db')
  const lockPath = lockPathFor(dbPath)

  const live = liveChildPid()
  writeFileSync(lockPath, JSON.stringify({ pid: live, host: 'live-host', startedAt: new Date().toISOString() }) + '\n')
  assert.throws(() => assertServerStopped(dbPath, { log: () => {} }),
    new RegExp(`the world server is running \\(pid ${live} on live-host\\)`))
  assert.equal(existsSync(lockPath), true, 'a live lock is left alone')

  // A lock we cannot parse is stale, not evidence of a running server.
  const warnings = []
  writeFileSync(lockPath, 'not json\n')
  assert.equal(assertServerStopped(dbPath, { log: (l) => warnings.push(l) }).stale, null)
  assert.equal(existsSync(lockPath), false, 'the unreadable lock is removed')
  assert.match(warnings.join(''), /stale lock from pid \?, removed/)
})
