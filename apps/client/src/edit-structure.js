// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-structure.js — the Edit panel's add, duplicate and delete requests
 * (Phase 3 step 1b-2, N2 and N4). Pure: no DOM, no three.js.
 *
 * One structural request at a time. A delete's `som:remove` arrives before
 * its own answer, and may be another tab's delete that reached the server
 * first; the "removed" message is held until this tab's own answer says which
 * (answers arrive in request order on one socket).
 */

/** Why Delete or Duplicate is unavailable right now, or null. */
export function structuralBlockReason({ hasSelection, pending, dragging, renaming }) {
  if (!hasSelection) return 'Select an object first'
  if (pending) return 'Waiting for the server…'
  if (dragging) return 'Finish moving the object first'
  if (renaming) return 'Waiting for the rename…'
  return null
}

/**
 * Every node below `node` in the SOM (children, recursively). N2's "N
 * objects inside it": a delete removes them all (D2).
 * @param {{ children?: object[] }} node
 * @returns {number}
 */
export function countDescendants(node) {
  let n = 0
  for (const child of node?.children ?? []) n += 1 + countDescendants(child)
  return n
}

/**
 * @returns {{
 *   begin(kind: 'add'|'duplicate'|'delete', seq: number, opts?: {name?: string, node?: object}): boolean,
 *   readonly pending: object|null,
 *   removalSeen(node: object): 'hold'|'show',
 *   settle(seq: number, status: 'accepted'|'rejected'|'unknown'):
 *     null | { request: object, status: string, removedMessage: 'show'|'quiet'|null },
 *   reset(): void,
 * }}
 */
export function createStructureTracker() {
  let pending = null      // { kind, seq, name, node, held }

  return {
    /** Start a request. Refused (false) while another is pending. */
    begin(kind, seq, { name = null, node = null } = {}) {
      if (pending) return false
      pending = { kind, seq, name, node, held: false }
      return true
    },

    get pending() { return pending },

    /**
     * A `som:remove` took `node` away. 'hold' when this tab's pending delete
     * is of that very object (identity, not name): the message waits for the
     * delete's own answer. 'show' otherwise: someone else removed it.
     */
    removalSeen(node) {
      if (pending && pending.kind === 'delete' && pending.node === node) {
        pending.held = true
        return 'hold'
      }
      return 'show'
    },

    /**
     * The answer to a request. Another seq is ignored (null). For a held
     * removal: accepted or unknown → 'quiet' (it was this tab's delete, or
     * the session is ending); rejected → 'show' (another tab's delete won).
     */
    settle(seq, status) {
      if (!pending || pending.seq !== seq) return null
      const request = pending
      pending = null
      const removedMessage = request.held ? (status === 'rejected' ? 'show' : 'quiet') : null
      return { request, status, removedMessage }
    },

    reset() { pending = null },
  }
}

/**
 * Is the world camera being rendered from stale after a removal (J8)? Either
 * its SOM host is gone, or the three.js camera it renders through no longer
 * hangs under the scene — the shared-camera case, where the SOM wrapper moved
 * to a surviving host but the rendered camera was built under the removed one.
 *
 * @param {object} opts
 * @param {boolean} opts.active          a world camera is active (nav.activeCamera)
 * @param {boolean} opts.hostAlive       its SOM host is the node its name resolves to
 * @param {object|null} opts.rendered    the three.js camera being rendered from
 * @param {object|null} opts.sceneRoot   the current sceneGroup
 * @returns {boolean}
 */
export function isActiveCameraStale({ active, hostAlive, rendered, sceneRoot }) {
  if (!active) return false
  if (!hostAlive) return true
  return !isAttachedUnder(rendered, sceneRoot)
}

/** Does `obj`'s parent chain reach `root`? */
export function isAttachedUnder(obj, root) {
  if (!obj || !root) return false
  for (let o = obj.parent; o; o = o.parent) if (o === root) return true
  return false
}
