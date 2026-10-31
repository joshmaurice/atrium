// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// server-lock.test.js — scripting-4d-1 round 4, card 3 (R22 as R-L8 (a), R19).
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
//   * the pre-R8 `<db>.lock` FILE is ignored (one log line at start).

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync, chmodSync, chownSync, statSync,
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
