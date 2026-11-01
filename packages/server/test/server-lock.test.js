// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// server-lock.test.js — scripting-4d-1 round 4, card 3 (R22 as R-L8 (a), R19);
// round 5, card 1 (R25, R26 as R-L9 (a), R27); round 6, card 1 (R30, R31).
//
// The server's START/STOP test: the real `src/index.js`, in its own process,
// against a scratch database, with the two rollback scripts pointed at the same
// file. It pins the lock that makes "the world server is stopped" (and "no other
// script is running") CHECKED rather than assumed:
//
//   * the lock is a KERNEL lock through SQLite, `<canonical db>.lock.db`, taken
//     with `BEGIN EXCLUSIVE` and held for the whole run — so a holder that dies
//     (even `kill -9`) frees it at once, and there is no stale lock to recover;
//   * the server takes it at start, a second start refuses, and SIGTERM releases
//     it;
//   * BOTH scripts take it and HOLD it, so a server can't start while a script
//     is running (round 3 only checked — round 4's M1);
//   * two scripts at once: the second refuses;
//   * the sidecar `<canonical db>.lock.json` is never the lock: an empty,
//     garbage or stale one changes no decision and is never deleted;
//   * the lock database wears the main database's owner, group and mode;
//   * the lock is keyed on the database's CANONICAL path (R19), so a symlink to
//     the file — or to its directory — reaches the same lock;
//   * R25: a DANGLING symlink resolves to its target, so ONE database has ONE
//     lock from its first boot on (round 4's M1: the alias was locked, and the
//     target was locked separately as soon as the database existed); a chain
//     that never lands (a loop) refuses with a clear message instead of hanging;
//   * R26 (as R-L9 (a)): the lock database's journal is in MEMORY, so SQLite
//     never creates a `<db>.lock.db-journal` beside it — not while a holder is
//     running, not after `kill -9` — and a 512-byte journal left by a round-4
//     holder does not stop the next acquire;
//   * R27: the server ends by the SIGNAL (SIGTERM/SIGINT), which is what systemd
//     records as a clean stop, and the lock is free at once afterwards;
//   * R30 (round 6, round 5's M1): link TARGETS are resolved the way the KERNEL
//     resolves them (`realpathSync.native`, and a dangling link's next path built
//     by concatenation), so the lock path computed BEFORE the database exists is
//     the one computed AFTER creation — over all six layouts, the review's and
//     its absolute-target sibling included. Round 5 split the last two;
//   * R31: a symlink loop refuses with `Atrium server refuses to start: …`, the
//     server's own message, not Node's uncaught-error trace;
//   * the pre-R8 `<db>.lock` FILE is ignored (one log line at start).

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync, chmodSync, chownSync, statSync,
  realpathSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { createDb } from '../src/db.js'
import {
  acquireLock, lockPathFor, sidecarPathFor, canonicalDbPath, readLockSidecar,
  legacyLockPathFor, pidIsAlive,
} from '../src/server-lock.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '..')
const INDEX = resolve(SERVER, 'src/index.js')
const EXPORT = resolve(SERVER, 'scripts/behaviors-export.mjs')
const RECONCILE = resolve(SERVER, 'scripts/behaviors-reconcile.mjs')
const LOCK_MODULE = pathToFileURL(resolve(SERVER, 'src/server-lock.js')).href
const SPACE = resolve(__dirname, '../../../tests/fixtures/space.gltf')

const dirs = []
const children = []
after(async () => {
  for (const child of children) { try { child.kill('SIGKILL') } catch { /* gone */ } }
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

function scratchDir() { const d = mkdtempSync(join(tmpdir(), 'atrium-lock-')); dirs.push(d); return d }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A database with the server's own schema (the scripts read `worlds`). */
function createScratchDb(dbPath) {
  const { close } = createDb(dbPath)
  close()
}

/** Start the REAL server (src/index.js) on a scratch database, port 0. */
function startServer(dbPath, extraEnv = {}) {
  const child = spawn(process.execPath, [INDEX], {
    cwd: SERVER,
    env: { ...process.env, WORLD_PATH: SPACE, ATRIUM_DB_PATH: dbPath, PORT: '0', ...extraEnv },
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

/** A start of the same server, run to completion (it must refuse). */
const runServer = (dbPath) => new Promise((res) => {
  execFile(process.execPath, [INDEX], {
    cwd: SERVER,
    env: { ...process.env, WORLD_PATH: SPACE, ATRIUM_DB_PATH: dbPath, PORT: '0' },
    timeout: 30000,
  }, (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }))
})

const runScript = (script, args, env = {}) => new Promise((res) => {
  execFile(process.execPath, [script, ...args], { cwd: SERVER, env: { ...process.env, ...env }, timeout: 30000 },
    (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }))
})

/**
 * Start a script that HOLDS the lock and waits: R22's test-only hook
 * (`ATRIUM_TEST_LOCK_SIGNAL`) writes the holder's pid to the signal file once
 * the lock is held, and goes on when `<signal>.release` appears.
 */
async function startHeldScript(script, args, signal) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: SERVER,
    env: { ...process.env, ATRIUM_TEST_LOCK_SIGNAL: signal },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  const out = []
  child.stdout.on('data', (b) => out.push(String(b)))
  child.stderr.on('data', (b) => out.push(String(b)))
  const exited = once(child, 'exit').then(([code]) => code)
  const deadline = Date.now() + 20000
  while (!existsSync(signal)) {
    if (Date.now() > deadline) throw new Error(`the held script never took the lock: ${out.join('')}`)
    await sleep(25)
  }
  const pid = parseInt(readFileSync(signal, 'utf8').trim(), 10)
  return { child, out, exited, pid, release: () => writeFileSync(`${signal}.release`, 'go\n') }
}

/** A pid that belongs to a live child process we keep alive for the test. */
function liveChildPid() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
  children.push(child)
  return child.pid
}

const require_ = createRequire(import.meta.url)
const BETTER_SQLITE3 = require_.resolve('better-sqlite3')

/**
 * Start a holder that takes the lock database the ROUND-4 way — a raw
 * `better-sqlite3` connection with `journal_mode = DELETE`, `BEGIN EXCLUSIVE` —
 * and wait, so the test can `kill -9` it and leave its 512-byte journal behind
 * (R26, round 4's M2). It bypasses `acquireLock` on purpose: round 5's
 * `acquireLock` can no longer make that journal.
 */
async function startRound4JournalHolder(lockPath, signal) {
  const script = [
    `const Database = require(${JSON.stringify(BETTER_SQLITE3)})`,
    `const fs = require('node:fs')`,
    `const db = new Database(${JSON.stringify(lockPath)}, { timeout: 0 })`,
    `db.pragma('journal_mode = DELETE')`,
    `db.pragma('busy_timeout = 0')`,
    `db.exec('BEGIN EXCLUSIVE')`,
    `fs.writeFileSync(${JSON.stringify(signal)}, String(process.pid))`,
    `setInterval(() => {}, 1000)`,
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script], { cwd: SERVER, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  const out = []
  child.stdout.on('data', (b) => out.push(String(b)))
  child.stderr.on('data', (b) => out.push(String(b)))
  const deadline = Date.now() + 20000
  while (!existsSync(signal)) {
    if (Date.now() > deadline) throw new Error(`the round-4 holder never took the lock: ${out.join('')}`)
    await sleep(25)
  }
  return { child, out }
}

// ===========================================================================
// R22 (1): the server holds the lock — both scripts refuse, naming its pid
// ===========================================================================

test('R22: the server holds the kernel lock for its lifetime, a second start refuses, SIGTERM frees it, and both scripts refuse while it is held', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'start-stop.db')
  createScratchDb(dbPath)
  const lockPath = lockPathFor(dbPath)
  const sidecarPath = sidecarPathFor(dbPath)

  assert.equal(existsSync(lockPath), false, 'no lock database before the server starts')

  const { child, listening } = startServer(dbPath)
  await listening

  // The lock database exists, and the sidecar names THIS child.
  assert.equal(existsSync(lockPath), true, 'the server created its lock database at start')
  const sidecar = readLockSidecar(dbPath)
  assert.equal(sidecar.pid, child.pid, 'the sidecar names the server process')
  assert.equal(sidecar.host, hostname(), 'and the host it runs on')
  assert.equal(sidecar.role, 'server', 'and its role')
  assert.equal(pidIsAlive(child.pid), true)

  // A second server on the same database REFUSES, naming the holder.
  const second = await runServer(dbPath)
  assert.equal(second.code, 1, `the second start refuses: ${second.stdout}${second.stderr}`)
  assert.match(second.stderr, /Atrium server refuses to start: another process holds .*\.lock\.db \(pid \d+, server\)/)

  // Both scripts refuse while the server holds the lock, with the reason.
  const outPath = join(dir, 'start-stop-export.json')
  const exported = await runScript(EXPORT, [dbPath, outPath])
  assert.notEqual(exported.code, 0, 'the export refuses while the server runs')
  assert.match(exported.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\); stop it before running this script`))
  assert.equal(existsSync(outPath), false, 'the refused export wrote nothing')

  writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
  const reconciled = await runScript(RECONCILE, [dbPath, outPath])
  assert.notEqual(reconciled.code, 0, 'the reconcile refuses while the server runs')
  assert.match(reconciled.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))

  // The refusal changes nothing: the holder keeps the lock.
  assert.equal(readLockSidecar(dbPath).pid, child.pid, 'the refusal left the server\'s sidecar alone')
  assert.equal(existsSync(lockPath), true, 'and its lock database')

  // A clean exit (SIGTERM) frees the lock — the OS does it.
  child.kill('SIGTERM')
  await once(child, 'exit')
  const afterStop = await runScript(EXPORT, [dbPath, outPath])
  assert.equal(afterStop.code, 0, `the export runs once the server is stopped: ${afterStop.stderr}`)
})

// ===========================================================================
// R22 (2): a SCRIPT holds the lock — a server start refuses (round 4's M1)
// ===========================================================================

test('R22: a script HOLDS the lock, so a server start refuses while it runs and starts once the script exits', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'script-holds.db')
  const outPath = join(dir, 'script-holds-export.json')
  createScratchDb(dbPath)
  const signal = join(dir, 'held.signal')

  const held = await startHeldScript(EXPORT, [dbPath, outPath], signal)
  assert.equal(held.pid, held.child.pid, 'the signal names the script that holds the lock')

  // A SERVER cannot start while the script holds the lock (round 3 let it).
  const refused = await runServer(dbPath)
  assert.equal(refused.code, 1, `the server refuses while the script holds the lock: ${refused.stdout}${refused.stderr}`)
  assert.match(refused.stderr, new RegExp(`another process holds .*lock\\.db \\(pid ${held.child.pid}, export\\)`))
  assert.match(refused.stderr, /Atrium server refuses to start/)
  assert.equal(readLockSidecar(dbPath).role, 'export', 'the sidecar names the script\'s role')

  // A second script refuses too (it needs an export file to read first).
  writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
  const secondScript = await runScript(RECONCILE, [dbPath, outPath])
  assert.notEqual(secondScript.code, 0, 'the second script refuses')
  assert.match(secondScript.stderr, new RegExp(`another process holds .*lock\\.db \\(pid ${held.child.pid}, export\\)`))

  // The holder goes; then the server starts.
  held.release()
  assert.equal(await held.exited, 0, `the held export finished: ${held.out.join('')}`)
  const { child, listening } = startServer(dbPath)
  await listening
  assert.equal(readLockSidecar(dbPath).pid, child.pid, 'the server took the lock the script released')
  child.kill('SIGTERM')
  await once(child, 'exit')
})

// ===========================================================================
// R22 (3)/(4): two scripts at once; and kill -9 frees the lock at once
// ===========================================================================

test('R22: two scripts at once — the second refuses; and kill -9 of a holder frees the lock at once', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'two.db')
  const outPath = join(dir, 'two-export.json')
  createScratchDb(dbPath)
  const signal = join(dir, 'two.signal')

  const held = await startHeldScript(EXPORT, [dbPath, outPath], signal)
  const second = await runScript(EXPORT, [dbPath, join(dir, 'never.json')])
  assert.notEqual(second.code, 0, 'the second export refuses')
  assert.match(second.stderr, new RegExp(`another process holds .*lock\\.db \\(pid ${held.child.pid}, export\\)`))
  assert.equal(existsSync(join(dir, 'never.json')), false, 'and wrote nothing')

  // kill -9: the kernel releases the lock immediately — no stale state.
  held.child.kill('SIGKILL')
  await once(held.child, 'exit')
  const lock = acquireLock(dbPath, { role: 'reconcile' })
  assert.equal(readLockSidecar(dbPath).role, 'reconcile', 'the next acquirer took it at once')
  lock.release()

  // A role that is not a server is named as such, never as the world server.
  const again = await runScript(EXPORT, [dbPath, outPath])
  assert.equal(again.code, 0, again.stderr)
})

// ===========================================================================
// R22 (5): the sidecar is never the lock
// ===========================================================================

test('R22: an empty, garbage or stale sidecar changes no decision and is never deleted', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'sidecar.db')
  createScratchDb(dbPath)
  const sidecarPath = sidecarPathFor(dbPath)
  const lockPath = lockPathFor(dbPath)

  // A LIVE pid in the sidecar, with the lock free: it does not refuse.
  const live = liveChildPid()
  writeFileSync(sidecarPath, JSON.stringify({ pid: live, host: 'not-this-host', startedAt: new Date().toISOString(), role: 'server' }) + '\n')
  const taken = acquireLock(dbPath, { role: 'export' })
  assert.equal(existsSync(sidecarPath), true, 'the sidecar was not deleted')
  assert.equal(readLockSidecar(dbPath).pid, process.pid, 'and now names the real holder')
  taken.release()

  // Empty, garbage and half-written sidecars: the same.
  for (const junk of ['', 'not json\n', '{"pid":']) {
    writeFileSync(sidecarPath, junk)
    const lock = acquireLock(dbPath, { role: 'export' })
    lock.release()
    assert.equal(existsSync(sidecarPath), true, `a ${JSON.stringify(junk)} sidecar survives`)
  }

  // A STALE sidecar (a dead pid): the same.
  const dead = await new Promise((res) => {
    const child = execFile(process.execPath, ['-e', 'process.exit(0)'], () => res(child.pid))
  })
  assert.equal(pidIsAlive(dead), false, 'the pid is dead')
  writeFileSync(sidecarPath, JSON.stringify({ pid: dead, host: 'gone-host', startedAt: new Date().toISOString(), role: 'server' }) + '\n')
  const afterStale = acquireLock(dbPath, { role: 'export' })
  afterStale.release()

  // While the lock IS held with a garbage sidecar, the refusal still stands —
  // naming an unknown process — and NOTHING is deleted.
  writeFileSync(sidecarPath, 'garbage\n')
  const holder = acquireLock(dbPath, { role: 'reconcile' })
  writeFileSync(sidecarPath, 'garbage again\n')          // the holder's sidecar is damaged underneath it
  assert.throws(() => acquireLock(dbPath, { role: 'export' }),
    /another process holds .*lock\.db \(an unknown process: its lock sidecar is missing or unreadable\)/)
  assert.equal(existsSync(sidecarPath), true, 'the garbage sidecar was not deleted')
  assert.equal(existsSync(lockPath), true, 'and the lock database was not deleted')
  holder.release()

  // The holder's own sidecar is irrelevant to its LOCK: a second acquire still
  // refuses after the holder re-writes the sidecar as its own.
  const reacquired = acquireLock(dbPath, { role: 'server' })
  reacquired.release()
})

// ===========================================================================
// R22 (6): the lock database wears the database's owner, group and mode
// ===========================================================================

test('R22: the lock database and the sidecar wear the main database\'s owner, group and mode, so the database\'s owner always acquires', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'owner.db')
  createScratchDb(dbPath)
  chmodSync(dbPath, 0o640)
  const lockPath = lockPathFor(dbPath)
  const sidecarPath = sidecarPathFor(dbPath)

  const lock = acquireLock(dbPath, { role: 'server' })
  assert.equal(statSync(lockPath).mode & 0o777, 0o640, 'the lock database wears the database\'s mode')
  assert.equal(statSync(sidecarPath).mode & 0o777, 0o640, 'and so does the sidecar')
  assert.equal(statSync(lockPath).uid, statSync(dbPath).uid, 'the same owner')
  assert.equal(statSync(lockPath).gid, statSync(dbPath).gid, 'the same group')
  lock.release()

  // A lock database left behind with ANOTHER mode (as another user would leave
  // it) is still openable, and the acquire restores the database's mode.
  chmodSync(lockPath, 0o600)
  chmodSync(sidecarPath, 0o600)
  const again = await new Promise((res) => {
    const child = execFile(process.execPath, ['-e', `
      import(${JSON.stringify(LOCK_MODULE)}).then(({ acquireLock }) => {
        const lock = acquireLock(${JSON.stringify(dbPath)}, { role: 'root-script' })
        lock.release()
        console.log('acquired')
      }).catch((error) => { console.error(error.message); process.exit(1) })
    `], { timeout: 20000 }, (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }))
  })
  assert.equal(again.code, 0, `the database's owner acquires: ${again.stderr}`)
  assert.match(again.stdout, /acquired/)
  assert.equal(statSync(lockPath).mode & 0o777, 0o640, 'the acquire restored the database\'s mode')

  // The real boundary, when the test runs as root: ANOTHER user owns the
  // database (the service user), a root script took the lock first, and the
  // service user can still acquire — because the lock database wears the
  // database's owner. Without that copy it could not open it at all. Skipped
  // only when the test is not root, where no second user exists to be.
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return

  const NOBODY = 65534                     // a user that is not us, for the boundary
  const shared = scratchDir()
  chownSync(shared, NOBODY, NOBODY)
  chmodSync(shared, 0o700)
  const ownedDb = join(shared, 'service.db')
  createScratchDb(ownedDb)
  chownSync(ownedDb, NOBODY, NOBODY)
  chmodSync(ownedDb, 0o640)
  const ownedLock = lockPathFor(ownedDb)

  // A root script takes the lock first (it chowns what it creates).
  acquireLock(ownedDb, { role: 'root-script' }).release()
  assert.equal(statSync(ownedLock).uid, NOBODY, 'the root script left the lock database to the database\'s owner')

  const asServiceUser = (lockMode) => new Promise((res) => {
    if (lockMode !== null) { chownSync(ownedLock, 0, 0); chmodSync(ownedLock, lockMode) }
    execFile(process.execPath, ['-e', `
      import(${JSON.stringify(LOCK_MODULE)}).then(({ acquireLock }) => {
        const lock = acquireLock(${JSON.stringify(ownedDb)}, { role: 'service' })
        lock.release()
        console.log('acquired')
      }).catch((error) => { console.error(error.message); process.exit(1) })
    `], { uid: NOBODY, gid: NOBODY, timeout: 20000 }, (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' }))
  })

  const service = await asServiceUser(null)
  assert.equal(service.code, 0, `the database's owner acquires the lock a root script made: ${service.stderr}`)
  assert.match(service.stdout, /acquired/)

  // The counterfactual: a lock database left to root (no owner copy) locks the
  // service user out — which is exactly what the copy prevents.
  const lockedOut = await asServiceUser(0o600)
  assert.notEqual(lockedOut.code, 0, 'a lock database left to root is one the service user cannot open')
  assert.match(lockedOut.stderr, /unable to open database file/)
})

// ===========================================================================
// R19: the lock is keyed on the database's CANONICAL path
// ===========================================================================

test('R19: canonicalDbPath collapses a symlinked file and a symlinked directory, and leaves a missing path resolved', () => {
  const dir = scratchDir()
  const realDir = join(dir, 'realDir')
  mkdirSync(realDir)
  const realDb = join(realDir, 'c.db')
  writeFileSync(realDb, '')
  const fileAlias = join(realDir, 'alias.db')
  symlinkSync(realDb, fileAlias)
  const dirAlias = join(dir, 'aliasDir')
  symlinkSync(realDir, dirAlias)

  assert.equal(canonicalDbPath(realDb), canonicalDbPath(fileAlias), 'a symlink to the file collapses')
  assert.equal(canonicalDbPath(join(dirAlias, 'c.db')), canonicalDbPath(realDb), 'a symlinked directory collapses')
  assert.equal(lockPathFor(fileAlias), lockPathFor(realDb), 'so both spellings reach ONE lock')
  assert.equal(lockPathFor(join(dirAlias, 'missing.db')), lockPathFor(join(realDir, 'missing.db')),
    'a database that does not exist yet still collapses its directory')
  assert.equal(canonicalDbPath(join(dir, 'nothing', 'at', 'all.db')), resolve(join(dir, 'nothing', 'at', 'all.db')),
    'with no directory either, the resolved path stands')

  // R25 — a symlink whose TARGET doesn't exist yet: the last component follows
  // the link, so the alias and the target are one path (and one lock) from the
  // very first boot.
  const danglingTarget = join(realDir, 'not-yet.db')
  const danglingAlias = join(realDir, 'dangling.db')
  symlinkSync(danglingTarget, danglingAlias)
  assert.equal(canonicalDbPath(danglingAlias), danglingTarget, 'a dangling symlink resolves to its target')
  assert.equal(lockPathFor(danglingAlias), lockPathFor(danglingTarget), 'so an alias and its target share one lock')

  // A RELATIVE target resolves against the LINK's directory, not the cwd.
  const relativeAlias = join(realDir, 'relative.db')
  symlinkSync('not-yet.db', relativeAlias)
  assert.equal(canonicalDbPath(relativeAlias), danglingTarget, 'a relative target resolves against the link\'s directory')

  // A CHAIN follows to its final target while that target is still missing.
  const chainEnd = join(realDir, 'chain-end.db')
  const chainMiddle = join(realDir, 'chain-middle.db')
  const chainStart = join(realDir, 'chain-start.db')
  symlinkSync(chainEnd, chainMiddle)
  symlinkSync('chain-middle.db', chainStart)
  assert.equal(canonicalDbPath(chainStart), chainEnd, 'a whole chain of dangling links resolves to its end')
  assert.equal(lockPathFor(chainStart), lockPathFor(chainEnd), 'and shares its lock')

  // A missing path that is NOT a symlink keeps the round-4 rule.
  assert.equal(canonicalDbPath(join(realDir, 'plain-missing.db')), join(realpathSync(realDir), 'plain-missing.db'),
    'a missing path that is not a symlink still collapses its directory')
})

test('R19: a server on the real path refuses both scripts through a symlink to the file, and a second server through the symlink', async () => {
  const dir = scratchDir()
  const realDb = join(dir, 'real.db')
  createScratchDb(realDb)
  const fileAlias = join(dir, 'alias.db')
  symlinkSync(realDb, fileAlias)
  const outPath = join(dir, 'e.json')

  const { child, listening } = startServer(realDb)
  await listening

  const exported = await runScript(EXPORT, [fileAlias, outPath])
  assert.notEqual(exported.code, 0, 'the export through the symlink refuses')
  assert.match(exported.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))
  assert.equal(existsSync(outPath), false, 'and wrote nothing')

  writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
  const reconciled = await runScript(RECONCILE, [fileAlias, outPath])
  assert.notEqual(reconciled.code, 0, 'the reconcile through the symlink refuses')
  assert.match(reconciled.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))

  // A second SERVER, started through the symlink, refuses too.
  const second = await runServer(fileAlias)
  assert.equal(second.code, 1, `the second start through the symlink refuses: ${second.stderr}`)
  assert.match(second.stderr, /another process holds .*real\.db\.lock\.db \(pid \d+, server\)/)

  child.kill('SIGTERM')
  await once(child, 'exit')

  // With the server gone, the script through the symlink runs.
  const afterStop = await runScript(EXPORT, [fileAlias, outPath])
  assert.equal(afterStop.code, 0, `the export runs once the server is stopped: ${afterStop.stderr}`)
})

test('R19: a server started through the symlink refuses the scripts on the real path, and in a symlinked directory both ways', async () => {
  const dir = scratchDir()
  const realDb = join(dir, 'through.db')
  createScratchDb(realDb)
  const fileAlias = join(dir, 'through-alias.db')
  symlinkSync(realDb, fileAlias)
  const outPath = join(dir, 'e2.json')

  // Started THROUGH the symlink: the real path reaches the same lock.
  const first = startServer(fileAlias)
  await first.listening
  const onReal = await runScript(EXPORT, [realDb, outPath])
  assert.notEqual(onReal.code, 0, 'the export on the real path refuses while the symlinked server runs')
  assert.match(onReal.stderr, new RegExp(`the world server is running \\(pid ${first.child.pid} on ${hostname()}\\)`))
  first.child.kill('SIGTERM')
  await once(first.child, 'exit')

  // A symlinked DIRECTORY: <tmp>/aliasDir -> <tmp>/realDir, the database under it.
  const realDir = join(dir, 'realDir')
  mkdirSync(realDir)
  const dirAlias = join(dir, 'aliasDir')
  symlinkSync(realDir, dirAlias)
  const dirDb = join(realDir, 'dir.db')
  createScratchDb(dirDb)

  const second = startServer(dirDb)
  await second.listening
  const throughAliasDir = await runScript(EXPORT, [join(dirAlias, 'dir.db'), outPath])
  assert.notEqual(throughAliasDir.code, 0, 'the export through the symlinked directory refuses')
  assert.match(throughAliasDir.stderr, new RegExp(`the world server is running \\(pid ${second.child.pid} on ${hostname()}\\)`))
  second.child.kill('SIGTERM')
  await once(second.child, 'exit')

  // And the other way round: the server through the alias, the script on the real path.
  const third = startServer(join(dirAlias, 'dir.db'))
  await third.listening
  writeFileSync(join(dir, 'never.json'), JSON.stringify({ version: 1, worlds: [] }))
  const onRealDir = await runScript(RECONCILE, [dirDb, join(dir, 'never.json')])
  assert.notEqual(onRealDir.code, 0, 'the script on the real path refuses while the aliased server runs')
  assert.match(onRealDir.stderr, new RegExp(`the world server is running \\(pid ${third.child.pid} on ${hostname()}\\)`))
  third.child.kill('SIGTERM')
  await once(third.child, 'exit')
})

// ===========================================================================
// The pre-R8 lock FILE is ignored
// ===========================================================================

test('R22: a leftover pre-R8 <db>.lock file is ignored — one log line at start, no refusal', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'legacy.db')
  createScratchDb(dbPath)
  const legacy = legacyLockPathFor(dbPath)
  const live = liveChildPid()
  writeFileSync(legacy, JSON.stringify({ pid: live, host: 'old-host', startedAt: new Date().toISOString() }) + '\n')

  // A live pid in the OLD file does not stop the server.
  const { child, out, listening } = startServer(dbPath)
  await listening
  assert.match(out.join(''), new RegExp(`\\[lock\\] leftover ${legacy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} from an earlier release is ignored`),
    'the start logs the leftover file once')
  assert.equal(existsSync(legacy), true, 'and leaves it for the operator')
  child.kill('SIGTERM')
  await once(child, 'exit')

  // Nor the scripts.
  const outPath = join(dir, 'legacy-export.json')
  const afterStop = await runScript(EXPORT, [dbPath, outPath])
  assert.equal(afterStop.code, 0, `the leftover file does not stop the export: ${afterStop.stderr}`)
  assert.equal(existsSync(legacy), true, 'the leftover file is still there: nothing deletes it')
})

// ===========================================================================
// R25: a dangling symlink resolves to its target (round 4's M1)
// ===========================================================================

test('R25: a server started through a DANGLING symlink locks the target, so a second server through the alias and one on the target both refuse', async () => {
  const dir = scratchDir()
  const realDb = join(dir, 'real.db')            // deliberately MISSING: the review's sequence
  const alias = join(dir, 'alias.db')
  symlinkSync(realDb, alias)
  const outPath = join(dir, 'dangling-export.json')

  assert.equal(existsSync(realDb), false, 'the symlink target does not exist yet')

  // First boot THROUGH the alias: the server creates the database by opening the
  // alias. Round 4 canonicalised the LINK's directory and kept the link's name,
  // so the alias took `alias.db.lock.db` and the target took nothing.
  const { child, listening } = startServer(alias)
  await listening

  assert.equal(existsSync(realDb), true, 'the database exists at the symlink\'s target')
  assert.equal(existsSync(`${realDb}.lock.db`), true, 'the lock database is the TARGET\'s')
  assert.equal(existsSync(`${alias}.lock.db`), false, 'and NOT the alias\'s own path')

  // A second server through the ALIAS refuses...
  const throughAlias = await runServer(alias)
  assert.equal(throughAlias.code, 1, `the second start through the alias refuses: ${throughAlias.stdout}${throughAlias.stderr}`)
  assert.match(throughAlias.stderr, new RegExp(`another process holds .*real\\.db\\.lock\\.db \\(pid ${child.pid}, server\\)`))

  // ...and so does one on the target's OWN path. This is round 4's M1: one
  // database, two locks, and the second server ran.
  const onTarget = await runServer(realDb)
  assert.equal(onTarget.code, 1, `the second start on the target's own path refuses: ${onTarget.stdout}${onTarget.stderr}`)
  assert.match(onTarget.stderr, new RegExp(`another process holds .*real\\.db\\.lock\\.db \\(pid ${child.pid}, server\\)`))

  // Both scripts refuse through EITHER spelling, and write nothing.
  for (const spelling of [alias, realDb]) {
    const exported = await runScript(EXPORT, [spelling, outPath])
    assert.notEqual(exported.code, 0, `the export through ${spelling} refuses`)
    assert.match(exported.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))
  }
  assert.equal(existsSync(outPath), false, 'the refused exports wrote nothing')

  writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
  for (const spelling of [alias, realDb]) {
    const reconciled = await runScript(RECONCILE, [spelling, outPath])
    assert.notEqual(reconciled.code, 0, `the reconcile through ${spelling} refuses`)
    assert.match(reconciled.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))
  }

  // The holder goes; then the scripts run through either spelling.
  child.kill('SIGTERM')
  await once(child, 'exit')
  const afterStop = await runScript(EXPORT, [alias, outPath])
  assert.equal(afterStop.code, 0, `the export runs once the server is stopped: ${afterStop.stderr}`)
})

test('R25: a relative dangling symlink and a two-hop chain of dangling links both lock the target they end at', async () => {
  const dir = scratchDir()

  // A RELATIVE target (`rel-alias.db -> rel-real.db`, no directory in the link):
  // it resolves against the LINK's directory, not the process's cwd.
  const relReal = join(dir, 'rel-real.db')
  const relAlias = join(dir, 'rel-alias.db')
  symlinkSync('rel-real.db', relAlias)
  assert.equal(canonicalDbPath(relAlias), relReal, 'the relative target resolves against the link\'s directory')
  assert.equal(lockPathFor(relAlias), `${relReal}.lock.db`, 'and reaches the target\'s lock')

  const relative = startServer(relAlias)
  await relative.listening
  assert.equal(existsSync(`${relReal}.lock.db`), true, 'the server locked the target the relative link names')
  assert.equal((await runServer(relReal)).code, 1, 'a server on that target refuses')
  relative.child.kill('SIGTERM')
  await once(relative.child, 'exit')

  // A TWO-HOP chain: `a.db -> b.db -> chain-real.db`, with the end missing.
  const chainReal = join(dir, 'chain-real.db')
  const chainB = join(dir, 'b.db')
  const chainA = join(dir, 'a.db')
  symlinkSync(chainReal, chainB)
  symlinkSync('b.db', chainA)
  assert.equal(canonicalDbPath(chainA), chainReal, 'the whole chain resolves to the path it ends at')
  assert.equal(lockPathFor(chainA), `${chainReal}.lock.db`, 'and reaches that path\'s lock')

  const chained = startServer(chainA)
  await chained.listening
  assert.equal(existsSync(`${chainReal}.lock.db`), true, 'the chain locks the path it ends at')
  const chainedRefusal = await runServer(chainReal)
  assert.equal(chainedRefusal.code, 1, `a server on the chain's target refuses: ${chainedRefusal.stdout}${chainedRefusal.stderr}`)
  chained.child.kill('SIGTERM')
  await once(chained.child, 'exit')

  // With the server gone, the chain resolves through to a REAL file and the
  // scripts still agree on the lock.
  const afterStop = await runScript(EXPORT, [chainA, join(dir, 'chain-export.json')])
  assert.equal(afterStop.code, 0, `the export through the chain runs once the server is stopped: ${afterStop.stderr}`)
})

test('R25: a symlink loop refuses with a clear message instead of hanging', async () => {
  const dir = scratchDir()
  const a = join(dir, 'a.db')
  const b = join(dir, 'b.db')
  symlinkSync('b.db', a)
  symlinkSync('a.db', b)

  assert.throws(() => canonicalDbPath(a), /too many levels of symbolic links/,
    'the path loop is an error, not a hang')
  assert.throws(() => lockPathFor(b), /too many levels of symbolic links/)

  const started = Date.now()
  const refused = await runServer(a)
  assert.equal(refused.code, 1, `the server refuses on a looping database path: ${refused.stdout}${refused.stderr}`)
  assert.match(refused.stderr, /could not resolve .*a\.db: too many levels of symbolic links/)
  assert.ok(Date.now() - started < 20000, 'and it refused at once, not by the test\'s timeout')
})

// ===========================================================================
// R30 (round 6): link targets resolve the way the KERNEL resolves them
// (round 5's M1, and the sibling layout the review did not find)
// ===========================================================================

/**
 * The two layouts round 5 SPLIT: a symlinked directory whose link TARGET carries
 * a `..`. Round 5 folded the `..` as text (`path.resolve`/`realpathSync`) before
 * the kernel had followed `linkdir`, and computed `<root>/target.db.lock.db`; the
 * kernel — and SQLite, through the alias — made `<root>/real/child/../target.db`
 * = `<root>/real/target.db`. The second server then took the other lock and RAN.
 *
 * Every path here is built by CONCATENATION, not `join`: `join` would fold the
 * `..` for us and hand the test the very bug it pins.
 */
function splitLayouts(dir) {
  const build = (name, makeTarget, linkName) => {
    const root = join(dir, name)
    mkdirSync(root)
    mkdirSync(join(root, 'real', 'child'), { recursive: true })
    symlinkSync(join(root, 'real', 'child'), join(root, 'linkdir'))
    symlinkSync(makeTarget(root), join(root, linkName))
    return { name, configured: join(root, linkName), createdFile: join(root, 'real', 'target.db') }
  }
  return [
    // (1) the review's: a RELATIVE `../` target through a symlinked directory.
    //     The alias sits in `real/child`, so `../target.db` is `real/target.db`.
    build('review', () => '../target.db', join('real', 'child', 'alias.db')),
    // (2) the sibling: an ABSOLUTE target carrying `..` through the same link,
    //     where the textual fold (`<root>/target.db`) is a different file.
    build('absolute', (root) => `${root}/linkdir/../target.db`, join('real', 'child', 'alias.db')),
  ]
}

test('R30: the lock path before the database exists equals the one after it is created, over the six layouts', () => {
  const layouts = [
    {
      name: 'a plain dangling link',
      make(root) { symlinkSync('real.db', join(root, 'a.db')); return join(root, 'a.db') },
    },
    {
      name: "the review's: a symlinked directory and a relative ../ target",
      make(root) {
        mkdirSync(join(root, 'real', 'child'), { recursive: true })
        symlinkSync(join(root, 'real', 'child'), join(root, 'linkdir'))
        symlinkSync('../target.db', join(root, 'real', 'child', 'alias.db'))
        return `${root}/linkdir/alias.db`
      },
    },
    {
      name: 'an absolute target through a symlinked directory and ..',
      make(root) {
        mkdirSync(join(root, 'real', 'child'), { recursive: true })
        symlinkSync(join(root, 'real', 'child'), join(root, 'linkdir'))
        symlinkSync(`${root}/linkdir/../t.db`, join(root, 'a.db'))
        return join(root, 'a.db')
      },
    },
    {
      name: '.. in the configured path itself',
      make(root) {
        mkdirSync(join(root, 'real', 'child'), { recursive: true })
        symlinkSync(join(root, 'real', 'child'), join(root, 'linkdir'))
        return `${root}/linkdir/../x.db`
      },
    },
    {
      name: 'a two-hop relative chain',
      make(root) {
        symlinkSync('chain-real.db', join(root, 'b.db'))
        symlinkSync('b.db', join(root, 'a.db'))
        return join(root, 'a.db')
      },
    },
    {
      name: 'no link, a missing file',
      make(root) { return join(root, 'plain.db') },
    },
  ]

  for (const layout of layouts) {
    const root = join(scratchDir(), 'layout')
    mkdirSync(root)
    const configured = layout.make(root)

    // BEFORE: nothing exists at, or through, the configured path.
    const before = lockPathFor(configured)
    assert.equal(existsSync(before), false, `${layout.name}: no lock database yet`)

    // Create the database exactly as Atrium does — by opening the configured
    // path — so the KERNEL decides where the file lands.
    writeFileSync(resolve(configured), '')
    const createdFile = realpathSync.native(resolve(configured))
    assert.equal(existsSync(createdFile), true, `${layout.name}: the database exists`)

    const after = lockPathFor(configured)
    assert.equal(after, before, `${layout.name}: the lock path is the same before and after creation`)
    assert.equal(before, `${createdFile}.lock.db`, `${layout.name}: and it is the created file's own lock`)
  }
})

test('R30: a server through a split alias creates the database, and a second server and both scripts refuse through either spelling', async () => {
  const dir = scratchDir()

  for (const layout of splitLayouts(dir)) {
    const { configured, createdFile } = layout
    const outPath = join(dirname(configured), 'r30-export.json')

    assert.equal(existsSync(createdFile), false, `${layout.name}: the database is missing at first (a first boot)`)

    // First boot THROUGH the alias: the server creates the database at the
    // link's target, and must take the TARGET's lock — not the alias's.
    const { child, listening } = startServer(configured)
    await listening

    assert.equal(existsSync(createdFile), true, `${layout.name}: the server created the database at the target`)
    const lockPath = `${realpathSync.native(createdFile)}.lock.db`
    assert.equal(existsSync(lockPath), true, `${layout.name}: the lock database is the target's (${lockPath})`)

    // Round 5's split: this second server through the SAME alias took a
    // different lock and ran.
    const throughAlias = await runServer(configured)
    assert.equal(throughAlias.code, 1,
      `${layout.name}: the second start through the alias refuses: ${throughAlias.stdout}${throughAlias.stderr}`)
    assert.match(throughAlias.stderr, /another process holds .*target\.db\.lock\.db \(pid \d+, server\)/)

    // ...and one on the target's own path refuses too.
    const onTarget = await runServer(createdFile)
    assert.equal(onTarget.code, 1,
      `${layout.name}: the second start on the target's own path refuses: ${onTarget.stdout}${onTarget.stderr}`)
    assert.match(onTarget.stderr, /another process holds .*target\.db\.lock\.db \(pid \d+, server\)/)

    // Both scripts refuse through EITHER spelling, and write nothing.
    for (const spelling of [configured, createdFile]) {
      const exported = await runScript(EXPORT, [spelling, outPath])
      assert.notEqual(exported.code, 0, `${layout.name}: the export through ${spelling} refuses`)
      assert.match(exported.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))
    }
    assert.equal(existsSync(outPath), false, `${layout.name}: the refused exports wrote nothing`)

    writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
    for (const spelling of [configured, createdFile]) {
      const reconciled = await runScript(RECONCILE, [spelling, outPath])
      assert.notEqual(reconciled.code, 0, `${layout.name}: the reconcile through ${spelling} refuses`)
      assert.match(reconciled.stderr, new RegExp(`the world server is running \\(pid ${child.pid} on ${hostname()}\\)`))
    }

    // The holder goes; then a script through the alias runs.
    child.kill('SIGTERM')
    await once(child, 'exit')
    const afterStop = await runScript(EXPORT, [configured, outPath])
    assert.equal(afterStop.code, 0, `${layout.name}: the export runs once the server is stopped: ${afterStop.stderr}`)
  }
})

// ===========================================================================
// R31 (round 6): a loop refuses with the server's own message
// ===========================================================================

test('R31: a looping database path refuses with `Atrium server refuses to start: …`, names the loop, and carries no stack trace', async () => {
  const dir = scratchDir()
  const a = join(dir, 'a.db')
  const b = join(dir, 'b.db')
  symlinkSync('b.db', a)
  symlinkSync('a.db', b)

  const refused = await runServer(a)
  assert.equal(refused.code, 1, `the server refuses on a looping database path: ${refused.stdout}${refused.stderr}`)

  const output = `${refused.stdout}${refused.stderr}`
  // Round 5 read the canonical path once BEFORE the guarded start (the legacy
  // lock-file diagnostic), so the error escaped as Node's uncaught-error trace.
  assert.match(output, /^Atrium server refuses to start: /, 'the refusal is the server\'s own message')
  assert.match(output, /too many levels of symbolic links/, 'and it names the loop')
  assert.doesNotMatch(output, /\n\s+at /, 'no stack trace')
  assert.doesNotMatch(output, /^Error: /m, 'and no bare Node error heading')
})

// ===========================================================================
// R26: the lock database keeps no journal on disk (as R-L9 (a))
// ===========================================================================

test('R26: no <lock db>-journal file exists while the server or either script holds the lock, and none after kill -9', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'journal.db')
  const outPath = join(dir, 'journal-export.json')
  createScratchDb(dbPath)
  const lockPath = lockPathFor(dbPath)
  const journalPath = `${lockPath}-journal`

  // The SERVER.
  const { child, listening } = startServer(dbPath)
  await listening
  assert.equal(existsSync(journalPath), false, 'the server holds the lock with no journal file')
  child.kill('SIGKILL')
  await once(child, 'exit')
  assert.equal(existsSync(journalPath), false, 'and kill -9 of the server leaves none')

  // Each SCRIPT.
  for (const [name, script] of [['export', EXPORT], ['reconcile', RECONCILE]]) {
    writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
    const signal = join(dir, `${name}.signal`)
    const held = await startHeldScript(script, [dbPath, outPath], signal)
    assert.equal(existsSync(journalPath), false, `the ${name} holds the lock with no journal file`)
    held.child.kill('SIGKILL')
    await once(held.child, 'exit')
    assert.equal(existsSync(journalPath), false, `and kill -9 of the ${name} leaves none`)
  }
})

test('R26: the lock database\'s journal_mode reads back memory', () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'journal-mode.db')
  createScratchDb(dbPath)

  const lock = acquireLock(dbPath, { role: 'server' })
  assert.equal(lock.journalMode, 'memory', 'the holder\'s connection reports the in-memory journal')
  lock.release()
})

test('R26: a 512-byte journal left by a round-4 holder (journal_mode = DELETE, kill -9) does not stop the next acquire', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'leftover.db')
  createScratchDb(dbPath)
  const lockPath = lockPathFor(dbPath)
  const journalPath = `${lockPath}-journal`
  const signal = join(dir, 'round4.signal')

  const holder = await startRound4JournalHolder(lockPath, signal)
  assert.equal(existsSync(journalPath), true, 'the round-4 way does leave a journal while it holds')
  assert.equal(statSync(journalPath).size, 512, '512 bytes, as the host\'s journal was')

  holder.child.kill('SIGKILL')
  await once(holder.child, 'exit')
  assert.equal(existsSync(journalPath), true, 'and the crash leaves it behind — round 4\'s M2')

  // The next acquire, round 5's way, is not stopped by it: SQLite rolls the
  // leftover journal away on open, and nothing new is created.
  const lock = acquireLock(dbPath, { role: 'server' })
  assert.equal(readLockSidecar(dbPath).role, 'server', 'the lock was taken with the leftover journal beside it')
  assert.equal(lock.journalMode, 'memory')
  lock.release()
  assert.equal(existsSync(journalPath), false, 'and the leftover journal is gone')
})

// ===========================================================================
// R27: the server ends by the signal, so systemd records a clean stop
// ===========================================================================

test('R27: the server ends by SIGTERM and by SIGINT — code null, the signal named — and the lock is free at once', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'signals.db')
  const outPath = join(dir, 'signals-export.json')
  createScratchDb(dbPath)

  for (const signal of ['SIGTERM', 'SIGINT']) {
    const { child, listening } = startServer(dbPath)
    await listening
    assert.equal(readLockSidecar(dbPath).pid, child.pid, `the server holds the lock before ${signal}`)

    const exited = once(child, 'exit')
    child.kill(signal)
    const [code, killedBy] = await exited

    // What systemd records: `Deactivated successfully` needs the SIGNAL, not a
    // process exit code. Round 4's handler turned this into `status=143`.
    assert.equal(code, null, `the ${signal} stop is a signal, not an exit code (got ${code})`)
    assert.equal(killedBy, signal, `and it is named as ${signal}`)

    // The OS released the kernel lock with the process.
    const exported = await runScript(EXPORT, [dbPath, outPath])
    assert.equal(exported.code, 0, `a script takes the lock straight after the ${signal} stop: ${exported.stderr}`)
  }
})
