// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createDb } from '../src/db.js'

// ---------------------------------------------------------------------------
// Helper: create a temp directory for database files
// ---------------------------------------------------------------------------

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'atrium-db-test-'))
}

// ---------------------------------------------------------------------------
// Migration tests
// ---------------------------------------------------------------------------

describe('migrations', () => {
  let dir

  before(async () => {
    dir = tempDir()
  })

  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('apply cleanly to a fresh database', () => {
    const path = join(dir, 'fresh.db')
    const { database, close } = createDb(path)

    // Expect all four tables plus the tracking table
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name)

    assert.ok(tables.includes('users'))
    assert.ok(tables.includes('auth_sessions'))
    assert.ok(tables.includes('worlds'))
    assert.ok(tables.includes('preferences'))
    assert.ok(tables.includes('schema_migrations'))
    assert.equal(tables.length, 5)

    close()
  })

  test('are idempotent — running twice is a no-op', () => {
    const path = join(dir, 'idempotent.db')
    const db1 = createDb(path)
    db1.close()

    // Re-open the same file (second migration run)
    const db2 = createDb(path)

    // Verify only one migration version recorded
    const versions = db2.database.prepare(
      'SELECT version, description FROM schema_migrations ORDER BY version'
    ).all()

    assert.equal(versions.length, 1)
    assert.equal(versions[0].version, 1)
    assert.equal(versions[0].description, 'Create users, auth_sessions, worlds, preferences tables')

    // No error = idempotent
    db2.close()
  })
})

// ---------------------------------------------------------------------------
// Schema constraint tests
// ---------------------------------------------------------------------------

describe('schema constraints', () => {
  let dir

  before(async () => {
    dir = tempDir()
  })

  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // Each test gets its own database so state is fully isolated
  function freshDb(name) {
    return createDb(join(dir, name))
  }

  function insertUser(db, overrides = {}) {
    const id = overrides.id || 'u-00000000-0000-0000-0000-000000000001'
    const username = overrides.username || 'alice'
    const displayName = overrides.displayName || 'Alice'
    const now = overrides.createdAt || new Date().toISOString()
    db.database.prepare(
      'INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, username, displayName, now)
    return id
  }

  test('case-insensitive username uniqueness is enforced', () => {
    const db = freshDb('username-ci.db')

    insertUser(db, { id: 'u-000001', username: 'Josh' })

    assert.throws(() => {
      insertUser(db, { id: 'u-000002', username: 'josh' })
    }, /UNIQUE constraint failed/)
  })

  test('foreign keys are enforced — orphan auth_session rejected', () => {
    const db = freshDb('fk-enforced.db')

    // user_id that does not exist in users table
    assert.throws(() => {
      db.database.prepare(
        'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
      ).run('s-000001', 'u-nonexistent', new Date().toISOString(), new Date().toISOString())
    }, /FOREIGN KEY constraint failed/)
  })

  test('foreign keys pragma is active — disabling it allows the bad insert', () => {
    // Demonstrate that PRAGMA foreign_keys=ON is what enforces the constraint.
    // Open a SECOND connection to the same database with the pragma OFF:
    // the same insert successfully creates an orphan row.
    const path = join(dir, 'fk-pragma-demo.db')

    // First, set up schema via createDb (which enables foreign_keys=ON)
    const db1 = createDb(path)
    db1.close()

    // Now open a raw connection with foreign_keys OFF
    const rawDb = new Database(path)
    rawDb.pragma('foreign_keys = OFF')

    // This insert would have failed with pragma ON — but succeeds with OFF
    rawDb.prepare(
      'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run('s-demo-001', 'u-ghost', new Date().toISOString(), new Date().toISOString())

    const row = rawDb.prepare('SELECT user_id FROM auth_sessions WHERE id = ?').get('s-demo-001')
    assert.equal(row.user_id, 'u-ghost')

    rawDb.close()
  })

  test('cascade deletes auth_sessions when user is removed', () => {
    const db = freshDb('cascade.db')

    const userId = insertUser(db)
    db.database.prepare(
      'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run('s-cascade-001', userId, new Date().toISOString(), new Date().toISOString())

    // Confirm session exists
    const before = db.database.prepare('SELECT id FROM auth_sessions WHERE user_id = ?').get(userId)
    assert.ok(before !== undefined)

    // Delete the user
    db.database.prepare('DELETE FROM users WHERE id = ?').run(userId)

    // Confirm sessions are cascaded away
    const after = db.database.prepare('SELECT id FROM auth_sessions WHERE user_id = ?').get(userId)
    assert.equal(after, undefined)
  })

  test('composite uniqueness on worlds — same owner + same slug fails', () => {
    const db = freshDb('worlds-unique.db')

    const userId = insertUser(db)
    const now = new Date().toISOString()

    // First insert succeeds
    db.database.prepare(
      'INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('w-000001', userId, 'my-world', 'My World', '', 'private', now, now)

    // Same owner + same slug must fail
    assert.throws(() => {
      db.database.prepare(
        'INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('w-000002', userId, 'my-world', 'Duplicate', '', 'private', now, now)
    }, /UNIQUE constraint failed/)
  })

  test('same slug under a different owner succeeds', () => {
    const db = freshDb('worlds-diff-owner.db')

    const userA = insertUser(db, { id: 'u-owner-a', username: 'alice' })
    const userB = insertUser(db, { id: 'u-owner-b', username: 'bob' })
    const now = new Date().toISOString()

    db.database.prepare(
      'INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('w-a-001', userA, 'my-space', 'Alice Space', '', 'private', now, now)

    // Different owner, same slug — must succeed
    db.database.prepare(
      'INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('w-b-001', userB, 'my-space', 'Bob Space', '', 'private', now, now)

    // Verify both exist
    const worlds = db.database.prepare(
      'SELECT owner_user_id, slug FROM worlds ORDER BY owner_user_id'
    ).all()

    assert.equal(worlds.length, 2)
    assert.equal(worlds[0].slug, 'my-space')
    assert.equal(worlds[1].slug, 'my-space')
  })

  test('auth_sessions.expires_at is NOT NULL', () => {
    const db = freshDb('not-null.db')

    insertUser(db)

    // Insert WITHOUT expires_at — must fail because column is NOT NULL
    // (SQLite will use its strict NOT NULL behavior here since the column
    // definition omits a DEFAULT clause)
    assert.throws(() => {
      db.database.prepare(
        'INSERT INTO auth_sessions (id, user_id, created_at) VALUES (?, ?, ?)'
      ).run('s-null-001', 'u-00000000-0000-0000-0000-000000000001', new Date().toISOString())
    }, /NOT NULL constraint failed/)
  })

  test('preferences table exists and has correct primary key', () => {
    const db = freshDb('preferences-exists.db')

    const userId = insertUser(db)

    // Insert a preference
    db.database.prepare(
      'INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?)'
    ).run(userId, 'theme', 'dark')

    // Duplicate key-value pair for same user must fail (PK enforcement)
    assert.throws(() => {
      db.database.prepare(
        'INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?)'
      ).run(userId, 'theme', 'dark')
    }, /UNIQUE constraint failed/)

    // Different user can have same key (PK is user_id + key)
    const userB = insertUser(db, { id: 'u-pref-b', username: 'pref-bob' })
    db.database.prepare(
      'INSERT INTO preferences (user_id, key, value) VALUES (?, ?, ?)'
    ).run(userB, 'theme', 'light')
  })
})
