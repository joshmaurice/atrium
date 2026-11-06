// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as worldStore from './world-store.js'
import { readBackProblem } from './world.js'
import { logId } from './log-id.js'

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
  // A10 test seam: the read-back the coordinator runs on the document it just
  // serialized. The default is the real one (`world.js`'s `readBackProblem`).
  const readBack = opts.readBackProblem ?? readBackProblem

  /**
   * Per-world state.
   * @type {Map<string, { debounceTimer: number|null, periodicInterval: number|null, dirty: boolean, saving: boolean }>}
   */
  const worlds = new Map()

  // -------------------------------------------------------------------------
  // Internal: perform the save operation
  // -------------------------------------------------------------------------
  // Round 2 R2 (REVISION-add-check-round-2.md): a save never loses an edit made
  // while it runs. `markDirty` bumps `entry.gen`; a save clears `dirty` only if
  // no edit came in after it began; a save asked for while one is in flight
  // runs as soon as that one finishes (it was dropped before); and the flushes
  // wait for a save in flight (`entry.inFlight`) before saving.
  function doSave(worldId, host) {
    const entry = worlds.get(worldId)
    if (!entry) return Promise.resolve()
    if (entry.saving) {
      entry.again = true
      return entry.inFlight
    }
    entry.inFlight = runSave(worldId, host, entry).finally(() => {
      if (worlds.get(worldId) !== entry) return
      entry.inFlight = null
      if (entry.again) {
        entry.again = false
        if (entry.dirty) return doSave(worldId, host)
      }
    })
    return entry.inFlight
  }

  async function runSave(worldId, host, entry) {
    if (!host || host.ownerUserId === null) return
    if (host.mutationPolicy === 'read-only') return
    if (!host.world || !db) return

    entry.saving = true
    const gen = entry.gen

    // L11/K9 — exclude, by IDENTITY, the node each session's accepted avatar
    // `add` created. These nodes are ephemeral and must not appear in persisted
    // documents. A session whose avatar add was refused owns nothing to exclude.
    const excludeNodes = []
    for (const [, session] of host.sessions) {
      if (session.avatarNode) {
        excludeNodes.push(session.avatarNode)
      }
    }

    try {
      const document = JSON.stringify(
        await host.world.serialize({ excludeNodes })
      )
      // add-check A10/RA-L8 — read it back BEFORE it is written. A document that
      // will not read back is never saved: the previous row is kept, the log
      // line appears once per world until a save succeeds, and the next save
      // tries again.
      const problem = await readBack(document)
      if (problem) {
        if (!entry.readBackLogged) {
          entry.readBackLogged = true
          console.error(`[autosave] read-back failed ${logId(worldId)}: ${problem}`)
        }
        entry.saving = false
        return
      }
      entry.readBackLogged = false
      const result = worldStore.updateWorld(
        db.database,
        worldId,
        host.ownerUserId,
        { document }
      )

      if (result.ok) {
        const e = worlds.get(worldId)
        if (e) {
          // Round 2 R2: an edit made during this save keeps the world dirty.
          if (e.gen === gen) e.dirty = false
          e.saving = false
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
    // Read-only worlds never mutate, never save
    if (host.mutationPolicy === 'read-only') return

    let entry = worlds.get(worldId)
    if (!entry) {
      // First dirty marker for this world — start the periodic interval
      const periodicInterval = setInterval(() => {
        periodicSave(worldId, host)
      }, periodicMs)
      if (periodicInterval.unref) periodicInterval.unref()

      entry = { debounceTimer: null, periodicInterval, dirty: false, saving: false, readBackLogged: false, gen: 0, again: false, inFlight: null }
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
    entry.gen++
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
    if (!entry) return
    // Round 2 R2: let a save in flight finish first; it may leave the world dirty.
    while (entry.inFlight) await entry.inFlight
    if (!entry.dirty) return

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
  // flushWorld — flush only (no teardown). Used by the registry when the last
  // session leaves the root world (commons). Same save logic as flushAndTeardown
  // but the host stays resident.
  // -------------------------------------------------------------------------
  async function flushWorld(worldId, host) {
    const entry = worlds.get(worldId)
    if (!entry) return
    // Round 2 R2: let a save in flight finish first; it may leave the world dirty.
    while (entry.inFlight) await entry.inFlight
    if (!entry.dirty) return

    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = null
    }

    await doSave(worldId, host)

    if (entry.dirty) {
      console.warn(`[autosave] Retrying flush for world "${worldId}" (previous save failed)`)
      await doSave(worldId, host)
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

  return { markDirty, flushAndTeardown, flushWorld, stop, close }
}