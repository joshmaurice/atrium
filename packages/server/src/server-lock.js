// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// server-lock.js — scripting-4d-1 round 4, card 3 (R22 as R-L8 (a), R19).
//
// THE LIFETIME LOCK. It is what makes "the world server is stopped" CHECKED by
// the rollback scripts rather than assumed (round 2's M2: `BEGIN IMMEDIATE` is
// an atomicity lock, not an offline check).
//
// Round 3 built it as a lock FILE and the review broke it (round 4's M1): the
// file was created empty and the pid written in a second call, so a script that
// read it in that instant called it malformed and DELETED it; two recoverers
// could each delete the other's new file; and the scripts only CHECKED the file
// instead of holding it, so a server could start mid-reconcile. Under R-L8 (a)
// the lock is now a KERNEL lock, taken through SQLite:
//
//   * beside the database sits a small LOCK DATABASE, `<canonical db>.lock.db`
//     (`journal_mode = DELETE`). The holder opens a connection with
//     `timeout: 0` and runs `BEGIN EXCLUSIVE`, and KEEPS THE TRANSACTION OPEN
//     for the whole of its run. Anyone else gets `SQLITE_BUSY` at once.
//   * the OS releases the lock when the holder exits for ANY reason, `kill -9`
//     included. There is no stale lock to recover and no recovery race; nothing
//     ever deletes the lock database.
//   * the SERVER takes it at start, before it opens the database, and holds it
//     until exit. BOTH SCRIPTS take the SAME lock before they open the
//     database and hold it until they have closed it. While either holds it the
//     other refuses.
//   * who holds it (for the MESSAGES only) is in a sidecar `<canonical
//     db>.lock.json`, written after acquiring. THE SIDECAR IS NEVER THE LOCK: a
//     missing, empty or stale sidecar changes no decision.
//   * the lock is keyed on the database's CANONICAL path (R19), so a symlink to
//     the database — or to its directory — reaches the same lock. (A hard link,
//     or the same file through another mount, is a different path after
//     `realpath`; out of scope under R-L6 (a).)
//   * whoever creates the lock database or the sidecar gives them the main
//     database's owner, group and mode, so a lock database root's script made
//     first never stops the service from opening it later.
//   * the pre-R8 `<db>.lock` FILE is no longer read or written. A leftover one
//     is IGNORED; the server's start logs one line naming it.

import { chmodSync, chownSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { hostname } from 'node:os'
import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Paths: the database's canonical path, and the three paths derived from it
// ---------------------------------------------------------------------------

/**
 * R19 — the database's CANONICAL path: the lock must be one lock for one
 * database, whatever spelling reached it.
 *
 *   * the file exists → `realpathSync(dbPath)` (a symlink to the file collapses
 *     to its target, as does a symlinked directory above it);
 *   * it doesn't (the server's first start) → `realpathSync(dirname)` + the
 *     basename, so a symlinked directory still collapses;
 *   * the directory doesn't exist either → the `resolve()`d path, as before.
 */
export function canonicalDbPath(dbPath) {
  const resolved = resolve(dbPath)
  try {
    return realpathSync(resolved)
  } catch {
    // The database file isn't there yet; canonicalise its directory instead.
  }
  try {
    return join(realpathSync(dirname(resolved)), basename(resolved))
  } catch {
    // Neither is there: nothing to resolve against.
  }
  return resolved
}

/** The lock database beside a database file: `<canonical db>.lock.db`. */
export function lockPathFor(dbPath) {
  return `${canonicalDbPath(dbPath)}.lock.db`
}

/** The holder's sidecar: `<canonical db>.lock.json`. Never the lock itself. */
export function sidecarPathFor(dbPath) {
  return `${canonicalDbPath(dbPath)}.lock.json`
}

/** The pre-R8 lock FILE (`<canonical db>.lock`), ignored since round 4. */
export function legacyLockPathFor(dbPath) {
  return `${canonicalDbPath(dbPath)}.lock`
}

/** Does the legacy (pre-R8) lock file exist? Its content means nothing now. */
export function legacyLockExists(dbPath) {
  return existsSync(legacyLockPathFor(dbPath))
}

// ---------------------------------------------------------------------------
// The sidecar (messages only)
// ---------------------------------------------------------------------------

/**
 * The holder's sidecar, or `null` when there is none. A parse failure or a
 * missing pid returns `{ problem }` — which is still never a decision, only a
 * reason to say "an unknown process" in the message.
 */
export function readLockSidecar(dbPath) {
  let raw
  try {
    raw = readFileSync(sidecarPathFor(dbPath), 'utf8')
  } catch {
    return null                                    // no sidecar at all
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { problem: 'the lock sidecar is not valid JSON', raw }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { problem: 'the lock sidecar is not an object', raw }
  }
  return parsed
}

/** Is `pid` a live process? Only used to NAME a holder in a message, never to decide. */
export function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'          // alive, we just may not signal it
  }
}

/** How a message names whoever holds the lock: `pid 1234 (the server)`. */
function describeHolder(sidecar) {
  if (!sidecar || sidecar.problem || !Number.isInteger(sidecar.pid) || sidecar.pid <= 0) {
    return 'an unknown process: its lock sidecar is missing or unreadable'
  }
  const role = typeof sidecar.role === 'string' && sidecar.role.length > 0 ? sidecar.role : 'unknown role'
  return `pid ${sidecar.pid}, ${role}`
}

/** The message a refusal carries, for the requester's own role. */
function busyMessage(lockPath, sidecar, requesterRole) {
  const holder = sidecar && !sidecar.problem ? sidecar : null
  if (requesterRole !== 'server' && holder?.role === 'server') {
    return `the world server is running (pid ${holder.pid} on ${holder.host ?? 'this host'}); ` +
      `stop it before running this script (lock ${lockPath})`
  }
  return `another process holds ${lockPath} (${describeHolder(sidecar)})`
}

// ---------------------------------------------------------------------------
// Ownership: the new files wear the database's owner, group and mode
// ---------------------------------------------------------------------------

/**
 * Give every path the main database's owner, group and mode, so a lock the
 * root user's script created first is still openable by the service user. When
 * there is no database yet (the server's first start) there is nothing to copy.
 * Best-effort: a non-root holder cannot chown, and must not fail over it.
 */
function matchDatabaseOwnership(dbPath, paths) {
  let stat
  try {
    stat = statSync(canonicalDbPath(dbPath))
  } catch {
    return                                   // no database yet: nothing to copy
  }
  for (const path of paths) {
    try { chmodSync(path, stat.mode & 0o7777) } catch { /* best effort */ }
    try { chownSync(path, stat.uid, stat.gid) } catch { /* best effort */ }
  }
}

/**
 * A TEST-ONLY hook (R22's test 2): when `ATRIUM_TEST_LOCK_SIGNAL` names a file,
 * a holder writes its pid there once it HAS the lock and then waits (up to 60 s)
 * for `<signal>.release` before it goes on. Inert unless that variable is set,
 * so a production run never waits.
 */
export function testLockHoldHook() {
  const signal = process.env.ATRIUM_TEST_LOCK_SIGNAL
  if (!signal) return
  writeFileSync(signal, `${process.pid}\n`)
  const releaseFile = `${signal}.release`
  const deadline = Date.now() + 60000
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  while (!existsSync(releaseFile) && Date.now() < deadline) {
    Atomics.wait(sleeper, 0, 0, 25)
  }
}

// ---------------------------------------------------------------------------
// Acquire / release
// ---------------------------------------------------------------------------

/**
 * Take the database's lifetime lock: a `BEGIN EXCLUSIVE` on
 * `<canonical db>.lock.db`, held until `release()` (or until this process
 * exits, however it exits). Refuses with a thrown `Error` when someone else
 * holds it.
 *
 * @param {string} dbPath
 * @param {{role?: string, log?: (line: string) => void}} [opts]  `role` names
 *        the holder in the others' messages ('server', 'export', 'reconcile').
 * @returns {{ lockPath: string, sidecarPath: string, release: () => void }}
 */
export function acquireLock(dbPath, { role = 'server', log = () => {} } = {}) {
  const lockPath = lockPathFor(dbPath)
  const sidecarPath = sidecarPathFor(dbPath)

  let lockDb
  try {
    lockDb = new Database(lockPath, { timeout: 0 })
  } catch (error) {
    throw new Error(`could not open ${lockPath}: ${error.message}`)
  }

  try {
    lockDb.pragma('journal_mode = DELETE')
    lockDb.pragma('busy_timeout = 0')
    lockDb.exec('BEGIN EXCLUSIVE')          // the kernel lock; SQLITE_BUSY at once
  } catch (error) {
    const sidecar = readLockSidecar(dbPath)
    try { lockDb.close() } catch { /* nothing to close cleanly */ }
    if (String(error?.code ?? '').startsWith('SQLITE_BUSY')) {
      throw new Error(busyMessage(lockPath, sidecar, role))
    }
    throw new Error(`could not lock ${lockPath}: ${error.message}`)
  }

  // The sidecar: who holds it, for the others' messages. Never the lock.
  const holder = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), role }
  try {
    writeFileSync(sidecarPath, `${JSON.stringify(holder)}\n`)
  } catch (error) {
    log(`could not write ${sidecarPath}: ${error.message} (the lock is held anyway)`)
  }
  matchDatabaseOwnership(dbPath, [lockPath, sidecarPath])

  let released = false
  const release = () => {
    if (released) return
    released = true
    try { lockDb.exec('ROLLBACK') } catch { /* the transaction is already gone */ }
    try { lockDb.close() } catch { /* already closed */ }
  }

  return { lockPath, sidecarPath, release }
}
