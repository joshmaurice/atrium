// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import Database from 'better-sqlite3'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Timestamp representation: ISO 8601 strings in UTC
// (e.g. "2026-08-21T03:30:00.000Z").
//
// Chosen for portability (a future Postgres adapter speaks ISO 8601 natively),
// human readability when inspecting the database, and zero timezone ambiguity.
// All timestamps are generated with `new Date().toISOString()`.
// ---------------------------------------------------------------------------

const DEFAULT_DB_PATH = resolve('./atrium.db')

// ---------------------------------------------------------------------------
// Schema migrations — versioned, ordered, idempotent.
//
// Add new migration entries at the END of this array (higher version number)
// so existing versions never shift. The runner sorts by version on apply.
// ---------------------------------------------------------------------------

const MIGRATIONS = [
  {
    version: 1,
    description: 'Create users, auth_sessions, worlds, preferences tables',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,               -- server-generated UUID
        username      TEXT NOT NULL,
        password_hash TEXT,                           -- NULL until auth task (2c)
        display_name  TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL                    -- ISO 8601 UTC
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci
        ON users (username COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id         TEXT PRIMARY KEY,                  -- server-generated UUID
        user_id    TEXT NOT NULL,
        created_at TEXT NOT NULL,                      -- ISO 8601 UTC
        expires_at TEXT NOT NULL,                      -- ISO 8601 UTC; NOT NULL because
                                                       -- a session without expiry never ends
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS worlds (
        id            TEXT PRIMARY KEY,               -- server-generated UUID
        owner_user_id TEXT NOT NULL,
        slug          TEXT NOT NULL,
        name          TEXT NOT NULL DEFAULT '',
        document      TEXT NOT NULL DEFAULT '',        -- serialized glTF JSON
        visibility    TEXT NOT NULL DEFAULT 'private',
        created_at    TEXT NOT NULL,                    -- ISO 8601 UTC
        updated_at    TEXT NOT NULL,                    -- ISO 8601 UTC
        FOREIGN KEY (owner_user_id) REFERENCES users(id),
        UNIQUE (owner_user_id, slug)
      );

      CREATE TABLE IF NOT EXISTS preferences (
        user_id TEXT NOT NULL,
        key     TEXT NOT NULL,
        value   TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (user_id, key),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `
  }
]

// ---------------------------------------------------------------------------
// Database factory
// ---------------------------------------------------------------------------

export function createDb(dbPath) {
  const resolvedPath = resolve(dbPath || process.env.ATRIUM_DB_PATH || DEFAULT_DB_PATH)

  const database = new Database(resolvedPath)

  // -- Required pragmas ------------------------------------------------

  // PRAGMA foreign_keys = ON: SQLite defaults this OFF, silently ignoring
  // foreign key constraints. Without it, ON DELETE CASCADE and referential
  // integrity are dead code.
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')

  // -- Migration runner ------------------------------------------------

  function runMigrations() {
    // Tracking table — always exists after first run
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at  TEXT NOT NULL
      );
    `)

    // Versions already applied
    const applied = new Set(
      database.prepare('SELECT version FROM schema_migrations').all()
        .map(row => row.version)
    )

    const apply = database.transaction((migration) => {
      database.exec(migration.sql)
      database.prepare(
        'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)'
      ).run(migration.version, migration.description, new Date().toISOString())
    })

    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.version)) {
        apply(migration)
      }
    }
  }

  runMigrations()

  return {
    /** The underlying better-sqlite3 Database instance. */
    database,

    /** Close the database connection (for test teardown / graceful shutdown). */
    close() {
      database.close()
    }
  }
}
