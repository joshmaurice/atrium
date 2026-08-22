// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// World Store — CRUD for the worlds table, HTTP handler helpers
// ---------------------------------------------------------------------------

/**
 * List all worlds owned by a user.
 * Returns an array of { id, slug, name, visibility, updated_at } (no document).
 *
 * @param {import('better-sqlite3').Database} database
 * @param {string} userId
 * @returns {Array<{ id: string, slug: string, name: string, visibility: string, updated_at: string }>}
 */
export function listWorlds(database, userId) {
  return database.prepare(
    `SELECT id, slug, name, visibility, updated_at
     FROM worlds
     WHERE owner_user_id = ?
     ORDER BY updated_at DESC`
  ).all(userId)
}

/**
 * Get a single world by id, verifying ownership.
 * Returns the full row including the document column, or null if not found
 * or not owned by the given user.
 *
 * @param {import('better-sqlite3').Database} database
 * @param {string} worldId
 * @param {string} userId
 * @returns {object|null}
 */
export function getWorld(database, worldId, userId) {
  return database.prepare(
    `SELECT id, owner_user_id, slug, name, document, visibility, created_at, updated_at
     FROM worlds
     WHERE id = ? AND owner_user_id = ?`
  ).get(worldId, userId)
}

/**
 * Create a new world row.
 *
 * @param {import('better-sqlite3').Database} database
 * @param {{ slug: string, name?: string, document?: string }} params
 * @param {string} userId - The owning user's id
 * @returns {{ id: string, slug: string, name: string, visibility: string, created_at: string, updated_at: string }}
 */
export function createWorld(database, params, userId) {
  const id = randomUUID()
  const now = new Date().toISOString()
  const slug = params.slug
  const name = params.name || ''
  const document = params.document || ''
  const visibility = 'private'

  database.prepare(
    `INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, slug, name, document, visibility, now, now)

  return { id, slug, name, visibility, created_at: now, updated_at: now }
}

/**
 * Update a world's metadata and/or document.
 * Only the owner may update their world.
 *
 * @param {import('better-sqlite3').Database} database
 * @param {string} worldId
 * @param {string} userId
 * @param {{ slug?: string, name?: string, document?: string }} params
 * @returns {{ ok: boolean, world?: object, code?: string }}
 */
export function updateWorld(database, worldId, userId, params) {
  // Verify ownership first
  const existing = database.prepare(
    'SELECT id, owner_user_id FROM worlds WHERE id = ? AND owner_user_id = ?'
  ).get(worldId, userId)

  if (!existing) {
    return { ok: false, code: 'NOT_FOUND' }
  }

  const now = new Date().toISOString()

  // Build SET clause dynamically for provided fields
  // slug, name, and document are the only mutable fields;
  // owner_user_id, visibility, and id are ALWAYS server-authoritative.
  const sets = []
  const values = []

  if (params.slug !== undefined) {
    sets.push('slug = ?')
    values.push(params.slug)
  }
  if (params.name !== undefined) {
    sets.push('name = ?')
    values.push(params.name)
  }
  if (params.document !== undefined) {
    sets.push('document = ?')
    values.push(params.document)
  }

  // Always bump updated_at
  sets.push('updated_at = ?')
  values.push(now)

  values.push(worldId, userId)

  try {
    database.prepare(
      `UPDATE worlds SET ${sets.join(', ')} WHERE id = ? AND owner_user_id = ?`
    ).run(...values)
  } catch (err) {
    // UNIQUE constraint on (owner_user_id, slug)
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return { ok: false, code: 'SLUG_CONFLICT' }
    }
    throw err
  }

  const updated = database.prepare(
    'SELECT id, slug, name, visibility, updated_at FROM worlds WHERE id = ?'
  ).get(worldId)

  return { ok: true, world: updated }
}

/**
 * Delete a world row.
 * Only the owner may delete their world.
 *
 * @param {import('better-sqlite3').Database} database
 * @param {string} worldId
 * @param {string} userId
 * @returns {{ ok: boolean, code?: string }}
 */
export function deleteWorld(database, worldId, userId) {
  const result = database.prepare(
    'DELETE FROM worlds WHERE id = ? AND owner_user_id = ?'
  ).run(worldId, userId)

  if (result.changes === 0) {
    return { ok: false, code: 'NOT_FOUND' }
  }

  return { ok: true }
}