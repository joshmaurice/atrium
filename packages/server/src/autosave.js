// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as worldStore from './world-store.js'

// ---------------------------------------------------------------------------
// Tunable constants — env-visible for injection/override
// ---------------------------------------------------------------------------

/**
 * Debounce window: how long after the LAST saveable mutation before an
 * autosave fires. Resets on every new mutation within the window.
 * @type {number}
 */
export const AUTO_SAVE_DEBOUNCE_MS =
  parseInt(process.env.ATRIUM_AUTOSAVE_DEBOUNCE_MS, 10) || 30_000

/**
 * Periodic crash-safety interval: how often to check-and-save regardless of
 * debounce state. Dirty-gated — no write if nothing changed.
 * Justification: 60s means worst-case data loss is bounded to ~1 minute
 * even in an unclean process death (no disconnect flush). This is a
 * reasonable safety margin for a personal-world use case where the most
 * expensive operation is serializing a moderately-sized glTF scene.
 * @type {number}
 */
export const AUTO_SAVE_PERIODIC_MS =
  parseInt(process.env.ATRIUM_AUTOSAVE_PERIODIC_MS, 10) || 60_000

// ---------------------------------------------------------------------------
// AutoSaveCoordinator
// ---------------------------------------------------------------------------

/**
 * Create an auto-save coordinator that manages per-world debounce timers,
 * periodic crash-safety intervals, and immediate disconnect flushes.
 *
 * Only owned worlds (host.ownerUserId !== null) participate in autosave.
 * The default world (ownerUserId === null) is never auto-saved.
 *
 * @param {object} opts
 * @param {object} opts.db         - Database handle (must expose db.database)
 * @param {number} [opts.debounceMs=AUTO_SAVE_DEBOUNCE_MS]
 * @param {number} [opts.periodicMs=AUTO_SAVE_PERIODIC_MS]
 * @returns {{ markDirty, flushAndTeardown, stop, close }}
 */
export function createAutoSaveCoordinator(opts = {}) {
  const db = opts.db
  const debounceMs = opts.debounceMs ?? AUTO_SAVE_DEBOUNCE_MS
  const periodicMs = opts.periodicMs ?? AUTO_SAVE_PERIODIC_MS

  /**
   * Per-world state.
   * @type {Map<string, { debounceTimer: number|null, periodicInterval: number|null, dirty: boolean, saving: boolean }>}
   */
  const worlds = new Map()

  // -------------------------------------------------------------------------
  // Internal: perform the save operation
  // -------------------------------------------------------------------------
  async function doSave(worldId, host) {
    const entry = worlds.get(worldId)
    if (!entry || entry.saving) return
    if (!host || host.ownerUserId === null) return
    if (!host.world || !db) return

    entry.saving = true

    // Build the list of avatar node names to exclude from serialization.
    // All sessions' avatarNodeName values are ephemeral and must not
    // appear in persisted documents.
    const avatarNames = []
    for (const [, session] of host.sessions) {
      if (session.avatarNodeName) {
        avatarNames.push(session.avatarNodeName)
      }
    }

    try {
      const document = JSON.stringify(
        await host.world.serialize({ excludeNodes: avatarNames })
      )
      const result = worldStore.updateWorld(
        db.database,
        worldId,
        host.ownerUserId,
        { document }
      )

      if (result.ok) {
        const entry = worlds.get(worldId)
        if (entry) {
          entry.dirty = false
          entry.saving = false
        }
      } else if (result.code === 'NOT_FOUND') {
        // The world row was deleted while it was still live — stop tracking
        stop(worldId)
      } else {
        const e = worlds.get(worldId)
        if (e) e.saving = false
      }
    } catch (err) {
      console.error(
        `[autosave] Failed to save world "${worldId}":`, err.message
      )
      // Keep dirty flag so the periodic tick retries
      const e = worlds.get(worldId)
      if (e) e.saving = false
    }
  }

  // -------------------------------------------------------------------------
  // markDirty — called when a saveable mutation occurs
  // -------------------------------------------------------------------------
  function markDirty(worldId, host) {
    // Only owned worlds participate in autosave
    if (!host || host.ownerUserId === null) return
    if (worldId === 'default') return

    let entry = worlds.get(worldId)
    if (!entry) {
      // First dirty marker for this world — start the periodic interval
      const periodicInterval = setInterval(() => {
        periodicSave(worldId, host)
      }, periodicMs)
      if (periodicInterval.unref) periodicInterval.unref()

      entry = { debounceTimer: null, periodicInterval, dirty: false, saving: false }
      worlds.set(worldId, entry)
    }

    // Restart the debounce timer
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(() => {
      const e = worlds.get(worldId)
      if (e) e.debounceTimer = null
      if (!e || !e.dirty) return
      doSave(worldId, host)
    }, debounceMs)
    if (entry.debounceTimer.unref) entry.debounceTimer.unref()

    entry.dirty = true
  }

  // -------------------------------------------------------------------------
  // periodicSave — called by the periodic interval, dirty-gated
  // -------------------------------------------------------------------------
  function periodicSave(worldId, host) {
    const entry = worlds.get(worldId)
    if (!entry || !entry.dirty) return
    doSave(worldId, host)
  }

  // -------------------------------------------------------------------------
  // flushAndTeardown — immediate save before world teardown (D2)
  //
  // Called when the last session disconnects. Must complete BEFORE the
  // host is closed. Clears any pending debounce timer to ensure the save
  // is immediate — no waiting for the debounce window.
  // -------------------------------------------------------------------------
  async function flushAndTeardown(worldId, host) {
    const entry = worlds.get(worldId)
    if (!entry || !entry.dirty) return

    // Cancel the debounce timer so it doesn't fire after the flush
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = null
    }

    // First attempt
    await doSave(worldId, host)

    // One retry on failure — if still dirty after doSave, try again
    if (entry.dirty) {
      console.warn(
        `[autosave] Retrying flush for world "${worldId}" (previous save failed)`
      )
      await doSave(worldId, host)
      // If still dirty after retry, log loudly but proceed with teardown
      if (entry.dirty) {
        console.error(
          `[autosave] CRITICAL: Flush failed for world "${worldId}" after retry — changes may be lost`
        )
      }
    }
  }

  // -------------------------------------------------------------------------
  // stop — clean up all timers for a world
  // -------------------------------------------------------------------------
  function stop(worldId) {
    const entry = worlds.get(worldId)
    if (!entry) return
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    if (entry.periodicInterval) clearInterval(entry.periodicInterval)
    worlds.delete(worldId)
  }

  // -------------------------------------------------------------------------
  // close — clean up all worlds (registry shutdown)
  // -------------------------------------------------------------------------
  function close() {
    for (const [worldId] of worlds) {
      stop(worldId)
    }
  }

  return { markDirty, flushAndTeardown, stop, close }
}