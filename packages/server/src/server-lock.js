// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// server-lock.js — scripting-4d-1 round 3, card 4 (R8, R-L2 (a)).
//
// THE OFFLINE CHECK. `BEGIN IMMEDIATE` is a WRITE lock: it keeps a transaction
// atomic, but an idle server between transactions holds none, so it is NOT
// evidence that "the world server is stopped" (round 2's M2). What the scripts
// need is a lock the server holds for its whole lifetime.
//
// The server creates `<db>.lock` EXCLUSIVELY (`O_CREAT | O_EXCL`) at start,
// with its pid and host, and removes it on a clean exit. It refuses to start
// while a lock file exists whose pid is still alive (two servers on one
// database is the same hazard as a script running against a live one). The
// rollback scripts refuse while such a lock exists; if the pid is dead the
// file is stale (a crash), they warn and remove it (`stale lock from pid N,
// removed`) and proceed.
//
// Portable: `node:fs` + `process.kill(pid, 0)`, no dependency.

import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs'
import { hostname } from 'node:os'

/** The lock file beside a database file: `<db>.lock`. */
export function lockPathFor(dbPath) {
  return `${dbPath}.lock`
}

/**
 * The lock file's contents, or `null` when there is none is not what is
 * wanted here: `null` means "no lock file"; a parse failure returns
 * `{ problem }`.
 */
export function readLockFile(lockPath) {
  let raw
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch {
    return null                       // no lock file at all
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { problem: 'the lock file is not valid JSON', raw }
  }
  if (!parsed || typeof parsed !== 'object' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
    return { problem: 'the lock file carries no pid', raw }
  }
  return parsed
}

/**
 * Is `pid` a live process? `process.kill(pid, 0)` sends no signal; it reports
 * ESRCH when there is no such process and EPERM when there is one we may not
 * signal — which is still alive, so EPERM counts.
 */
export function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function removeLockFile(lockPath) {
  try {
    unlinkSync(lockPath)
    return true
  } catch {
    return false
  }
}

/**
 * Create the server's lifetime lock, exclusively. Refuses (throws) when the
 * file exists and its pid is alive; a stale file (dead pid) is removed with a
 * warning and the acquire retried once.
 *
 * @returns {{ lockPath: string, release: () => void }}
 */
export function acquireServerLock(dbPath, { log = () => {} } = {}) {
  const lockPath = lockPathFor(dbPath)
  const payload = JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }) + '\n'

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx')     // O_CREAT | O_EXCL — exclusive
      try {
        writeSync(fd, payload)
      } finally {
        closeSync(fd)
      }
      return { lockPath, release: () => { removeLockFile(lockPath) } }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const existing = readLockFile(lockPath)
      if (existing && !existing.problem && pidIsAlive(existing.pid) && existing.pid !== process.pid) {
        throw new Error(`another server is running (pid ${existing.pid} on ${existing.host ?? 'this host'}) and holds ${lockPath}`)
      }
      // A stale file, or our own pid from a lock we already hold: clear it.
      log(`stale lock from pid ${existing?.pid ?? '?'}, removed`)
      removeLockFile(lockPath)
    }
  }

  throw new Error(`could not create ${lockPath}: it keeps reappearing`)
}

/**
 * The rollback scripts' offline check: throw when the server's lifetime lock
 * exists and its pid is alive; warn and remove a stale one, then proceed.
 *
 * @returns {{ stale: number|null }}  `stale` is the dead pid that was removed
 */
export function assertServerStopped(dbPath, { log = () => {} } = {}) {
  const lockPath = lockPathFor(dbPath)
  const existing = readLockFile(lockPath)
  if (existing === null) return { stale: null }

  if (existing.problem) {
    // A file we cannot read is not evidence of a running server; warn, clear it
    // and go on (the operator keeps the database, not the lock file).
    log(`stale lock from pid ?, removed (${existing.problem})`)
    removeLockFile(lockPath)
    return { stale: null }
  }

  if (pidIsAlive(existing.pid) && existing.pid !== process.pid) {
    throw new Error(
      `the world server is running (pid ${existing.pid} on ${existing.host ?? 'this host'}); stop it before running this script (lock file ${lockPath})`
    )
  }

  log(`stale lock from pid ${existing.pid}, removed`)
  removeLockFile(lockPath)
  return { stale: existing.pid }
}
