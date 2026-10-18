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

/**
 * Why Delete or Duplicate is unavailable right now, or null.
 *
 * `undoing` is an undo or a redo in flight (Y4); `sending` is an unanswered
 * transform send — Delete and Duplicate must never capture optimistic values
 * (Y2, U14).
 */
export function structuralBlockReason({
  hasSelection, pending, dragging, renaming, sending = false, undoing = false,
}) {
  if (!hasSelection) return 'Select an object first'
  if (undoing) return 'Undoing…'
  if (pending) return 'Waiting for the server…'
  if (sending) return 'Waiting for the server…'
  if (dragging) return 'Finish moving the object first'
  if (renaming) return 'Waiting for the rename…'
  return null
}

/**
 * One shared guard for every Edit-mode change's dispatch path (Y4): an undo or
 * a redo in flight, or any structural request pending — an add, a duplicate or
 * a delete, a click's or an undo's. A handle drag, a panel commit, a rename,
 * the palette, Duplicate and Delete all check this and send nothing.
 */
export function editBlocked({ undoing = false, pending = false } = {}) {
  return !!undoing || !!pending
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

/** `node` and every node below it, as objects (for a delete's held removals). */
export function collectSubtree(node) {
  const out = []
  const walk = (n) => { out.push(n); for (const c of n?.children ?? []) walk(c) }
  if (node) walk(node)
  return out
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
  let pending = null      // { kind, seq, name, node, subtree, held, replaced, ...extra }

  return {
    /**
     * Start a request. Refused (false) while another is pending. A delete
     * passes `subtree`: the node objects it removes (the node and every
     * descendant, collected at the click). Extra fields (a palette add's
     * descriptor, for its one retry) are kept but never override these.
     */
    begin(kind, seq, { name = null, node = null, subtree = null, ...extra } = {}) {
      if (pending) return false
      pending = { ...extra, kind, seq, name, node, subtree: subtree ?? (node ? [node] : []), held: false, replaced: false }
      return true
    },

    get pending() { return pending },

    /**
     * A `som:remove` took `node` away. 'hold' when this tab's pending delete
     * covers that very object — the node or one of its descendants, by
     * identity, not name: the message waits for the delete's own answer.
     * 'show' otherwise: someone else removed it.
     */
    removalSeen(node) {
      if (pending && pending.kind === 'delete' && pending.subtree.includes(node)) {
        pending.held = true
        return 'hold'
      }
      return 'show'
    },

    /**
     * A `som:add` of `name` arrived (outside review S1). While a removal of
     * our pending delete is held, a new node with its name means someone
     * removed ours and made another: our delete-by-name, if the server
     * accepts it, removes that newer object.
     */
    addSeen(name) {
      if (pending && pending.kind === 'delete' && pending.held && name === pending.name) pending.replaced = true
    },

    /**
     * The answer to a request. Another seq is ignored (null). For a held
     * removal: unknown → 'quiet' (the session is ending); rejected → 'show'
     * (another tab's delete won); accepted → 'quiet' (it was ours), or
     * 'replaced' when a newer node with the name had arrived (S1: ours was
     * already gone, and the server removed the newer one).
     */
    settle(seq, status) {
      if (!pending || pending.seq !== seq) return null
      const request = pending
      pending = null
      let removedMessage = null
      if (request.held) {
        if (status === 'rejected') removedMessage = 'show'
        else if (status === 'accepted' && request.replaced) removedMessage = 'replaced'
        else removedMessage = 'quiet'
      }
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
