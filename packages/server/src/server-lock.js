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
//     (`journal_mode = MEMORY` — R26, so SQLite never writes a
//     `<db>.lock.db-journal` beside it). The holder opens a connection with
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
//     the database — or to its directory — reaches the same lock. A dangling
//     symlink follows to its missing target (R25), so first boot through an
//     alias and the database's own path are still ONE lock. (A hard link,
//     or the same file through another mount, is a different path after
//     `realpath`; out of scope under R-L6 (a).)
//   * R30 (round 6, round 5's M1) — link TARGETS are resolved the way the KERNEL
//     resolves them: `realpathSync.native` (libc `realpath`), never the
//     JavaScript `realpathSync`, whose first step is `path.resolve` and so folds
//     `..` as TEXT. And a dangling link's next path is built by string
//     concatenation, never `resolve`/`join`, for the same reason. Round 5 did
//     both and split one database into two locks through a symlinked directory
//     whose link target carried a `..`. The test of it is the invariant: the
//     lock path computed BEFORE the database exists equals the one computed
//     AFTER Atrium has created the database through the same configured path.
//   * whoever creates the lock database or the sidecar gives them the main
//     database's owner, group and mode, so a lock database root's script made
//     first never stops the service from opening it later.
//   * the pre-R8 `<db>.lock` FILE is no longer read or written. A leftover one
//     is IGNORED; the server's start logs one line naming it.

import {
  chmodSync, chownSync, existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { hostname } from 'node:os'
import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Paths: the database's canonical path, and the three paths derived from it
// ---------------------------------------------------------------------------

/**
 * R19 — the database's CANONICAL path: the lock must be one lock for one
 * database, whatever spelling reached it.
 *
 *   * the file exists → `realpathSync.native(dbPath)` (a symlink to the file
 *     collapses to its target, as does a symlinked directory above it);
 *   * it doesn't (the server's first start) → `realpathSync.native(dirname)` +
 *     the basename, so a symlinked directory still collapses;
 *   * the directory doesn't exist either → the `resolve()`d path, as before.
 *
 * R25 — a DANGLING symlink in the LAST component resolves to its target. Round
 * 4 fell straight to the directory rule, so `alias.db → real.db` with `real.db`
 * missing gave the alias one lock at first boot and the target a different lock
 * once the database existed: ONE DATABASE, TWO LOCKS. So while the path is a
 * symlink whose target isn't there yet, `readlink` it — a relative target
 * resolves against the LINK's directory — and carry on, at most
 * MAX_SYMLINK_HOPS hops; a chain that never lands (a loop) is an error, not a
 * hang.
 *
 * R30 (round 6) — every resolution here is the KERNEL's, not Node's textual
 * one. `resolve(dbPath)` starts the path, exactly as `db.js` opens it, and after
 * that `..` is never folded as text:
 *
 *   * existence is tested with `realpathSync.native` (libc `realpath`). Node's
 *     JavaScript `realpathSync` begins with `path.resolve`, so it folds a `..`
 *     in a link target as text — before the kernel has followed a symlinked
 *     directory on the way — and computes the lock for a different file than
 *     the one SQLite then creates;
 *   * a dangling link's next path is built by STRING CONCATENATION: an absolute
 *     target as it is, a relative one as `dirname(path) + '/' + target`. Never
 *     `resolve` or `join` on a path that may still hold `..` after a symlink;
 *   * the last step, `join(realpathSync.native(dirname(path)), basename(path))`,
 *     hands the `..` to the kernel, which resolves it after the links.
 *
 * The invariant this buys: the lock path computed BEFORE the database exists
 * equals the one computed AFTER Atrium has created it through the same
 * configured path. That is the test (server-lock.test.js).
 */
const MAX_SYMLINK_HOPS = 40

export function canonicalDbPath(dbPath) {
  const resolved = resolve(dbPath)
  try {
    return realpathSync.native(resolved)
  } catch {
    // The database file isn't there yet; canonicalise its directory instead.
  }

  let path = resolved
  for (let hops = 0; ; hops++) {
    let stats
    try {
      stats = lstatSync(path)
    } catch {
      break                                       // nothing there: not a symlink
    }
    if (!stats.isSymbolicLink()) break            // a real file: nothing to follow
    if (hops >= MAX_SYMLINK_HOPS) {
      throw new Error(`could not resolve ${resolved}: too many levels of symbolic links`)
    }
    let target
    try {
      target = readlinkSync(path)
    } catch {
      break                                       // raced away under us
    }
    // R30: concatenation, not `resolve`. `resolve` would fold a `..` in the
    // target as text, before the kernel has followed a symlinked directory on
    // the way to it, and land on a different file than SQLite opens.
    path = isAbsolute(target) ? target : `${dirname(path)}/${target}`
    try {
      return realpathSync.native(path)            // the target exists: collapse it
    } catch {
      // Still dangling; keep following the chain.
    }
  }

  try {
    return join(realpathSync.native(dirname(path)), basename(path))
  } catch {
    // Neither is there: nothing to resolve against.
  }
  return path
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
 * @returns {{ lockPath: string, sidecarPath: string, journalMode: string,
 *            release: () => void }}  `journalMode` is the mode the kernel lock
 *        was taken with, as the holder's own connection read it back (R26:
 *        always `'memory'`, or the acquire refused).
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

  let journalMode
  try {
    // R26 (as R-L9 (a)) — the lock database holds no data and nothing is ever
    // written in it, so its journal lives in MEMORY: SQLite creates no
    // `<db>.lock.db-journal` file at all, and so none can be left behind —
    // owned by root, in a sticky directory — to stop the service user's next
    // acquire with a disk I/O error. Refuse if the mode we get back isn't the
    // one we asked for, rather than trust it.
    journalMode = String(lockDb.pragma('journal_mode = MEMORY', { simple: true }) ?? '').toLowerCase()
    if (journalMode !== 'memory') {
      throw new Error(`journal_mode is ${journalMode || 'unknown'}, not memory`)
    }
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

  return { lockPath, sidecarPath, journalMode, release }
}
