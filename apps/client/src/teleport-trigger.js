// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// Teleporter trigger module (T4) — pure proximity detection.
//
// No DOM, no Three.js runtime — works with plain [x, y, z] arrays.
//
// Constants
//   TELEPORT_TRIGGER_RADIUS  — horizontal proximity threshold (meters)
//   TELEPORT_TRIGGER_HEIGHT  — vertical tolerance (meters)
//
// Factory: createTeleportTrigger({ onTrigger, resolveDestination })
// Returns { setPads, update, reset, setActive, setReady }
// ---------------------------------------------------------------------------

import { isTeleporter } from './teleporter-marker.js'

export const TELEPORT_TRIGGER_RADIUS = 0.75
export const TELEPORT_TRIGGER_HEIGHT = 2.0

/**
 * Create a pure teleporter trigger state machine.
 *
 * @param {object} opts
 * @param {(trigger: {name: string, destination: string, worldUrl: string|null}) => void} opts.onTrigger
 *   Called when a pad fires. worldUrl is the resolved destination URL or null.
 * @param {(destination: string, currentWorldUrl: string) => string|null} opts.resolveDestination
 *   Maps a teleporter destination string to a full WS URL. Returns null for
 *   unresolvable destinations.
 * @returns {object} { setPads, update, reset, setActive, setReady }
 */
export function createTeleportTrigger({ onTrigger, resolveDestination }) {
  // Map of pad name → { name, position: [x,y,z], destination, armed, wasInside }
  let pads = new Map()
  let active = true
  let ready = false
  let inFlight = false
  // Track warnings per pad name per connection to avoid repeating
  const warned = new Set()

  function setPads(padList) {
    // Build the new pad set, preserving armed/wasInside for unchanged pads
    // (operator correction #2: pads whose name, translation and destination
    // are unchanged keep their armed/wasInside state)
    const newPads = new Map()
    for (const p of padList) {
      const key = `${p.name}:${JSON.stringify(p.position)}:${p.destination}`
      const old = pads.get(p.name)
      if (old) {
        const oldKey = `${old.name}:${JSON.stringify(old.position)}:${old.destination}`
        if (key === oldKey) {
          // Unchanged pad — preserve armed/wasInside
          newPads.set(p.name, { ...p, armed: old.armed, wasInside: old.wasInside, key })
          continue
        }
      }
      // New or changed pad — starts disarmed
      newPads.set(p.name, { ...p, armed: false, wasInside: false, key })
    }
    pads = newPads
  }

  function setActive(val) {
    // Coming back from an editing mode (Edit, place, delete): update() hasn't
    // run meanwhile, so `wasInside` is stale — the avatar may have walked onto
    // a pad. Disarm every pad, as on a fresh load: a pad fires only after the
    // avatar has been outside it again (Phase 3 step 1b-1, review finding 4).
    if (val && !active) {
      for (const pad of pads.values()) {
        pad.armed = false
        pad.wasInside = false
      }
    }
    active = val
  }

  function setReady(val) {
    ready = val
  }

  // Called on every new connection. Drops the pads too, so a reconnect to the
  // same world starts disarmed like a fresh load. Otherwise setPads would carry
  // over "armed, outside" for identical pads, and spawning on a pad at the
  // origin would fire it.
  function reset() {
    inFlight = false
    warned.clear()
    pads = new Map()
  }

  /**
   * Update the trigger with the avatar's current position.
   * Call every tick while the avatar is ready and connected.
   * @param {[number, number, number]} avatarPos — [x, y, z] world position
   */
  function update(avatarPos) {
    if (!active || !ready || inFlight) return
    if (!avatarPos || avatarPos.length < 3) return

    const [ax, ay, az] = avatarPos
    let triggered = null

    for (const pad of pads.values()) {
      const [px, py, pz] = pad.position
      const dist = Math.hypot(ax - px, az - pz)
      const inside = dist <= TELEPORT_TRIGGER_RADIUS && Math.abs(ay - py) <= TELEPORT_TRIGGER_HEIGHT

      if (!pad.armed) {
        // Disarmed: arm when avatar is outside
        if (!inside) {
          pad.armed = true
          pad.wasInside = false
        } else {
          pad.wasInside = true
        }
      } else {
        // Armed: trigger on outside→inside transition
        if (inside && !pad.wasInside) {
          // Found a candidate — check if it's closer than an existing one
          if (!triggered || dist < triggered.dist) {
            triggered = { pad, dist }
          }
        }
        pad.wasInside = inside
      }
    }

    if (triggered) {
      const { pad } = triggered
      const destination = pad.destination
      let worldUrl = null

      if (typeof resolveDestination === 'function') {
        try {
          worldUrl = resolveDestination(destination)
        } catch {
          worldUrl = null
        }
      } else {
        worldUrl = destination
      }

      if (worldUrl == null) {
        // Once per pad name per connection (operator correction #14: rebuilding
        // pad list must not repeat the warning)
        const tag = `${pad.name}:${destination}`
        if (!warned.has(tag)) {
          warned.add(tag)
          console.warn(`[teleport] Unresolvable destination for pad "${pad.name}": ${destination}`)
        }
        return
      }

      inFlight = true
      warned.delete(`${pad.name}:${destination}`)
      onTrigger({ name: pad.name, destination, worldUrl })
    }
  }

  return { setPads, update, reset, setActive, setReady }
}

/**
 * Check whether a position is near the spawn point (origin) (T5).
 * @param {[number, number, number]} position — [x, y, z]
 * @param {number} radius — detection radius (default TELEPORT_TRIGGER_RADIUS + 0.5)
 * @returns {boolean}
 */
export function nearSpawn(position, radius = TELEPORT_TRIGGER_RADIUS + 0.5) {
  if (!position || position.length < 2) return false
  return Math.hypot(position[0], position[2]) <= radius
}

/**
 * Z7 (edit-polish-3, L5a) — is a pad at or under `node` near the spawn point?
 *
 * The node and EVERY descendant are walked, and each node that is a teleporter is
 * judged by its OWN world position through `worldPositionOf` (world-position.js
 * composes the parents' translation, rotation and scale): a selected GROUP whose
 * child pad sits away from the group's origin is judged by the pad, not by the
 * group — "is the group near spawn" is not "is its pad near spawn".
 *
 * `worldPositionOf` is called exactly ONCE per pad (the walk does not stop at the
 * first near pad), so a caller and its tests can count the calls. Pure: no DOM, no
 * three.js — the tests pass a fake that reads plain values.
 *
 * @param {{children?: object[]}} node
 * @param {(node: object) => number[]} worldPositionOf
 * @returns {boolean}
 */
export function padNearSpawn(node, worldPositionOf) {
  if (!node || typeof worldPositionOf !== 'function') return false
  let near = false
  const walk = (current) => {
    if (!current) return
    if (isTeleporter(current) && nearSpawn(worldPositionOf(current))) near = true
    for (const child of current.children ?? []) walk(child)
  }
  walk(node)
  return near
}
