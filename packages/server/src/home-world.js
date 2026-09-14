// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as worldStore from './world-store.js'

/**
 * Minimal default home world document.
 * Valid glTF 2.0 JSON with a ground plane, empty skybox, and navigation metadata.
 * Per ADDENDUM §3: "empty skybox, ground plane, avatar" — but avatar nodes are
 * ephemeral (ADDENDUM §2) and never persisted; the client creates its own avatar
 * on join. So the persisted document is: empty skybox + ground plane only.
 */
export const DEFAULT_HOME_DOCUMENT = JSON.stringify({
  asset: { version: '2.0', generator: 'Atrium Home World' },
  scenes: [{ nodes: [0] }],
  nodes: [
    {
      name: 'Ground',
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  ],
  extras: {
    atrium: {
      name: 'Home',
      navigation: {
        mode: ['WALK', 'FLY'],
        speed: { default: 1.4, min: 0.5, max: 5.0 },
        terrainFollowing: true,
        collision: { enabled: false },
      },
    },
  },
})

/**
 * Ensure the given user has a home world row.
 * If it doesn't exist, creates one with slug 'home', visibility 'private',
 * and the DEFAULT_HOME_DOCUMENT. Uses INSERT OR IGNORE so concurrent calls
 * are safe — the race loser reads back the existing row.
 *
 * @param {import('better-sqlite3').Database} database
 * @param {string} userId
 * @returns {{ id: string, slug: string, created: boolean }}
 */
export function ensureHomeWorld(database, userId) {
  // Check if home world already exists
  const existing = database.prepare(
    "SELECT id, slug FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
  ).get(userId)

  if (existing) {
    return { id: existing.id, slug: 'home', created: false }
  }

  // Create the home world row
  // Use worldStore.createWorld for consistency with other world CRUD
  try {
    const result = worldStore.createWorld(database, {
      slug: 'home',
      name: 'Home',
      document: DEFAULT_HOME_DOCUMENT,
    }, userId)

    return { id: result.id, slug: 'home', created: true }
  } catch (err) {
    // UNIQUE constraint race — concurrent login created it first
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      const retry = database.prepare(
        "SELECT id, slug FROM worlds WHERE owner_user_id = ? AND slug = 'home'"
      ).get(userId)

      if (retry) {
        return { id: retry.id, slug: 'home', created: false }
      }
    }
    // Re-throw unexpected errors
    throw err
  }
}