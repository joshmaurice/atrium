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
  // Round 2 R2, as amended in round 2.1 (REVISION-add-check-round-2.md):
  // - a save never loses an edit made while it runs: `markDirty` bumps
  //   `entry.gen`, and a save clears `dirty` only if no edit came in after it
  //   began;
  // - one save at a time: a save asked for while one runs (`entry.current`)
  //   sets `entry.again`, and ONE follow-up save runs after it, unless a flush
  //   has begun (`entry.flushing`);
  // - a save whose entry was stopped or replaced while it ran writes nothing
  //   and changes nothing;
  // - the flushes wait for the one save in flight, never a chain of saves, so
  //   their retry budget stays finite.
  function doSave(worldId, host) {
    const entry = worlds.get(worldId)
    if (!entry) return Promise.resolve()
    if (entry.current) {
      entry.again = true
      return entry.current
    }
    const current = runSave(worldId, host, entry)
    entry.current = current
    current.then(() => {
      if (entry.current === current) entry.current = null
      const followUp = entry.again && !entry.flushing && worlds.get(worldId) === entry && entry.dirty
      entry.again = false
      if (followUp) doSave(worldId, host)
    })
    return current
  }

  /** One save. Never rejects. */
  async function runSave(worldId, host, entry) {
    if (!host || host.ownerUserId === null) return
    if (host.mutationPolicy === 'read-only') return
    if (!host.world || !db) return

    entry.saving = true
    const gen = entry.gen
    try {
      // L11/K9 — exclude, by IDENTITY, the node each session's accepted avatar
      // `add` created. These nodes are ephemeral and must not appear in persisted
      // documents. A session whose avatar add was refused owns nothing to exclude.
      const excludeNodes = []
      for (const [, session] of host.sessions) {
        if (session.avatarNode) {
          excludeNodes.push(session.avatarNode)
        }
      }

      const document = JSON.stringify(
        await host.world.serialize({ excludeNodes })
      )
      // add-check A10/RA-L8 — read it back BEFORE it is written. A document that
      // will not read back is never saved: the previous row is kept, the log
      // line appears once per world until a save succeeds, and the next save
      // tries again.
      const problem = await readBack(document)
      // Round 2.1: stopped or replaced while it ran — write nothing.
      if (worlds.get(worldId) !== entry) return
      if (problem) {
        if (!entry.readBackLogged) {
          entry.readBackLogged = true
          console.error(`[autosave] read-back failed ${logId(worldId)}: ${problem}`)
        }
        return
      }
      const result = worldStore.updateWorld(
        db.database,
        worldId,
        host.ownerUserId,
        { document }
      )

      if (result.ok) {
        // An edit made during this save keeps the world dirty.
        if (entry.gen === gen) entry.dirty = false
        // Round 2.1: the read-back log may appear again only after a save succeeds.
        entry.readBackLogged = false
      } else if (result.code === 'NOT_FOUND') {
        // The world row was deleted while it was still live — stop tracking
        stop(worldId)
      }
    } catch (err) {
      console.error(
        `[autosave] Failed to save world "${worldId}":`, err.message
      )
      // Keep dirty flag so the periodic tick retries
    } finally {
      entry.saving = false
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

      entry = { debounceTimer: null, periodicInterval, dirty: false, saving: false, readBackLogged: false, gen: 0, again: false, current: null, flushing: false }
      worlds.set(worldId, entry)
    }

    // Restart the debounce timer
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(() => {
      const e = worlds.get(worldId)
      if (e) e.debounceTimer = null
      if (!e || !e.dirty || e.flushing) return
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
    if (!entry || !entry.dirty || entry.flushing) return
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
    await flush(worldId, host)
  }

  // -------------------------------------------------------------------------
  // flushWorld — flush only (no teardown). Used by the registry when the last
  // session leaves the root world (commons). Same save logic as flushAndTeardown
  // but the host stays resident.
  // -------------------------------------------------------------------------
  async function flushWorld(worldId, host) {
    const entry = await flush(worldId, host)
    // The host stays: an edit that came in during the flush is saved as usual.
    if (entry && worlds.get(worldId) === entry && entry.dirty) doSave(worldId, host)
  }

  /**
   * The shared flush: cancel the debounce, wait for the ONE save in flight,
   * then at most two saves of its own. Periodic and debounced saves stand back
   * while it runs (round 2.1), so it always finishes.
   */
  async function flush(worldId, host) {
    const entry = worlds.get(worldId)
    if (!entry) return null
    entry.flushing = true
    try {
      // Cancel the debounce timer so it doesn't fire after the flush
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer)
        entry.debounceTimer = null
      }
      if (entry.current) await entry.current
      if (worlds.get(worldId) !== entry || !entry.dirty) return entry

      // First attempt
      await doSave(worldId, host)

      // One retry on failure — if still dirty after doSave, try again
      if (worlds.get(worldId) === entry && entry.dirty) {
        console.warn(
          `[autosave] Retrying flush for world "${worldId}" (previous save failed)`
        )
        await doSave(worldId, host)
        // If still dirty after retry, log loudly but proceed with teardown
        if (worlds.get(worldId) === entry && entry.dirty) {
          console.error(
            `[autosave] CRITICAL: Flush failed for world "${worldId}" after retry — changes may be lost`
          )
        }
      }
      return entry
    } finally {
      entry.flushing = false
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