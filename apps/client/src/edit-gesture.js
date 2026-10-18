// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-gesture.js — Edit-mode transform edits: local updates, throttled sends,
 * and putting a node back where the server has it when an edit is refused
 * (Phase 3 step 1b-1, B4). Pure: no DOM, no three.js, no client. The caller
 * injects how to read, write locally (no send) and write-and-send.
 *
 * Gestures
 * - A gesture is one handle drag (begin → update… → end) or one committed
 *   panel field (commit).
 * - Every update writes locally. At most one send per `throttleMs` per gesture,
 *   plus one final send on end for each field whose value differs from the last
 *   one sent.
 *
 * Confirmation and revert — one record per node (by object, not name) and
 * field, shared by every gesture on that field:
 * - `confirmed` starts as the field's value when the record is created and
 *   becomes the value of the last thing to arrive for that field: this tab's
 *   accepted send, or another session's `som:set` through `remoteSet` (U16);
 * - a rejection sets a flag and reports a message;
 * - the record reconciles only when nothing is pending AND no gesture on that
 *   field is active: when it was rejected, or another session changed the
 *   field while this tab's sends were in flight, the field is set back to
 *   `confirmed`. The server answers one session's requests in order, so that is
 *   the server's value. A late rejection from an older gesture therefore can't
 *   overwrite a newer accepted edit, and nothing is written while a newer
 *   gesture is still under way.
 *
 * Outcomes (Y3) — one settle batch at a time, never one gesture at a time:
 * - a gesture is settled only when every record it touched has reconciled;
 *   gestures that share a record, directly or through another gesture, settle
 *   together as one batch, reported after reconcile has written any revert;
 * - `onTransformsSettled(results, info)` reports a batch. Every send accepted:
 *   one result per gesture in begin order, `{node, changes: [{field, from, to}]}`
 *   with `from` the gesture's start and `to` its last sent value, changed fields
 *   only. Any send refused: one result per node, `from` the record's starting
 *   value and `to` its final `confirmed`, fields where they are equal left out.
 *   Any send unknown, or a batch whose records are all dead: nothing;
 * - a batch with a record another session touched (`remote`) reports no result,
 *   only `info.acceptedOwnSend` — whether one of this tab's sends in it was
 *   accepted (the redo rule);
 * - `commit(node, field, value, { record: false })` is an undo's or a redo's
 *   send: never part of a reported batch, its answer goes to the caller by seq,
 *   and it still reverts locally when refused.
 *
 * A removed node: its gestures are cancelled (no more writes, no final send)
 * and its records become dead. In-flight sends still resolve, but a dead record
 * never writes to the node; a rejection on it reports that the object was
 * removed.
 */

export const TRANSFORM_FIELDS = ['translation', 'rotation', 'scale']
export const MIN_SCALE = 0.01
export const REMOVED_MESSAGE = 'This object was removed.'

/**
 * Make a transform value safe to send: scale stays positive, quaternions are
 * unit length. Translation passes through.
 * @param {string} field
 * @param {number[]} value
 * @returns {number[]}
 */
export function sanitizeTransform(field, value) {
  if (field === 'scale') return value.map(v => Math.max(MIN_SCALE, v))
  if (field === 'rotation') {
    const len = Math.hypot(...value)
    if (!Number.isFinite(len) || len === 0) return [0, 0, 0, 1]
    // Leave a stored quaternion that is unit to within rounding untouched, so
    // a plain Move drag doesn't look like a rotation change and send one.
    if (Math.abs(len - 1) <= 1e-9) return [...value]
    return value.map(v => v / len)
  }
  return [...value]
}

function same(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * @param {object} opts
 * @param {(node: object, field: string) => any} opts.read
 * @param {(node: object, field: string, value: any) => void} opts.writeLocal
 *   write without sending (client.applyLocally)
 * @param {(node: object, field: string, value: any) => (number|null)} opts.writeSend
 *   write and send; returns the request seq, or null if nothing was sent
 * @param {(text: string, info: {node: object, field: string, code: string|null}) => void} [opts.onMessage]
 * @param {(node: object, field: string, value: any) => void} [opts.onReverted]
 * @param {(results: object[], info: {acceptedOwnSend: boolean, remote: boolean, rejected: boolean}) => void} [opts.onTransformsSettled]
 *   a settle batch (Y3): the entries to record, and whether one of this tab's
 *   sends in it was accepted
 * @param {() => number} [opts.now]
 * @param {number} [opts.throttleMs=100]
 */
export function createEditTracker({
  read, writeLocal, writeSend,
  onMessage = () => {}, onReverted = () => {}, onTransformsSettled = () => {},
  now = () => Date.now(), throttleMs = 100,
}) {
  /** @type {Map<object, Map<string, object>>} node → field → record */
  const records = new Map()
  /** @type {Map<number, {rec: object, value: any, silent: boolean}>} */
  const sends = new Map()
  /** @type {Set<object>} active gestures */
  const gestures = new Set()
  /** @type {Set<object>} finished gestures whose records have not all reconciled */
  const awaiting = new Set()
  let orderCounter = 0

  function recordFor(node, field, startValue) {
    let byField = records.get(node)
    if (!byField) { byField = new Map(); records.set(node, byField) }
    let rec = byField.get(field)
    if (!rec) {
      rec = {
        node, field,
        start: startValue,
        confirmed: startValue,
        pending: new Set(),
        rejected: false,
        remote: false,
        anyUnknown: false,
        acceptedOwn: false,
        active: 0,
        dead: false,
        closed: false,
      }
      byField.set(field, rec)
    }
    return rec
  }

  function dropRecord(rec) {
    if (rec.closed) return
    rec.closed = true
    const byField = records.get(rec.node)
    if (byField && byField.get(rec.field) === rec) {
      byField.delete(rec.field)
      if (byField.size === 0) records.delete(rec.node)
    }
  }

  function reconcile(rec) {
    if (rec.pending.size > 0 || rec.active > 0) return
    // Only write when the node actually differs from the server's value, and
    // only when there is a reason to: a refusal, or another session's set that
    // arrived while this tab's sends were in flight (U16). The ordinary path
    // leaves the node at the last accepted send, so it writes nothing.
    if (!rec.dead && !rec.anyUnknown && (rec.rejected || rec.remote) &&
        !same(read(rec.node, rec.field), rec.confirmed)) {
      writeLocal(rec.node, rec.field, rec.confirmed)
      onReverted(rec.node, rec.field, rec.confirmed)
    }
    dropRecord(rec)
    settleBatches()
  }

  // ── Settle batches (Y3) ────────────────────────────────────────────────
  //
  // A batch is a set of finished gestures connected through the records they
  // share (a record belongs to one node and field, so a batch is always one
  // node's). It is reported once every one of those records has reconciled.

  function reportBatch(group) {
    const recs = new Set()
    for (const g of group) for (const rec of g.touched.values()) recs.add(rec)
    const all = [...recs]
    if (all.length === 0) return
    if (all.every((r) => r.dead)) return          // a removed node: nothing
    if (all.some((r) => r.anyUnknown)) return     // the session is ending (W7)
    const acceptedOwnSend = all.some((r) => r.acceptedOwn)
    if (all.some((r) => r.remote)) {
      // Another session changed these fields in flight: neither per-gesture nor
      // per-record from/to describes this tab's change, so no entry.
      onTransformsSettled([], { acceptedOwnSend, remote: true, rejected: all.some((r) => r.rejected) })
      return
    }
    const node = group[0].node
    if (all.some((r) => r.rejected)) {
      // A refusal makes the per-gesture values unreliable; every accepted change
      // is still recorded, merged into one result per node (U13). "Changed" is
      // judged on the confirmed result, never on the last attempted value.
      const changes = []
      for (const rec of all) {
        if (same(rec.start, rec.confirmed)) continue
        changes.push({ field: rec.field, from: rec.start, to: rec.confirmed })
      }
      onTransformsSettled(changes.length ? [{ node, changes }] : [],
        { acceptedOwnSend, remote: false, rejected: true })
      return
    }
    const results = []
    for (const g of group) {
      if (g.silent) continue
      const changes = []
      for (const [field] of g.touched) {
        const from = g.start.get(field)
        const to = g.lastSent.get(field)
        if (same(from, to)) continue
        changes.push({ field, from, to })
      }
      if (changes.length) results.push({ node: g.node, changes })
    }
    onTransformsSettled(results, { acceptedOwnSend, remote: false, rejected: false })
  }

  function settleBatches() {
    if (awaiting.size === 0) return
    const list = [...awaiting].sort((a, b) => a.order - b.order)
    const claimed = new Set()
    for (const root of list) {
      if (claimed.has(root)) continue
      const group = [root]
      claimed.add(root)
      for (let i = 0; i < group.length; i++) {
        for (const rec of group[i].touched.values()) {
          for (const other of list) {
            if (claimed.has(other)) continue
            for (const r2 of other.touched.values()) {
              if (r2 === rec) { claimed.add(other); group.push(other); break }
            }
          }
        }
      }
      let ready = true
      for (const g of group) {
        for (const rec of g.touched.values()) if (!rec.closed) { ready = false; break }
        if (!ready) break
      }
      if (!ready) continue
      for (const g of group) awaiting.delete(g)
      reportBatch(group)
    }
  }

  function send(rec, value, silent = false) {
    const seq = writeSend(rec.node, rec.field, value)
    if (seq == null) return null
    sends.set(seq, { rec, value, silent })
    rec.pending.add(seq)
    return seq
  }

  /**
   * Start a handle drag on `node`.
   * @returns {{ update(values: object): void, end(): void, readonly node: object }}
   */
  function begin(node) {
    const start = new Map()
    for (const f of TRANSFORM_FIELDS) start.set(f, read(node, f))
    const lastLocal = new Map(start)
    const lastSent = new Map(start)
    const touched = new Map()          // field → record
    let lastSendTime = now()
    let done = false

    function flush() {
      for (const [field, rec] of touched) {
        const v = lastLocal.get(field)
        if (same(v, lastSent.get(field))) continue
        send(rec, v)
        lastSent.set(field, v)
      }
      lastSendTime = now()
    }

    function release() {
      for (const rec of touched.values()) {
        rec.active--
        reconcile(rec)
      }
      gestures.delete(gesture)
    }

    // Once the gesture is over, it waits for every record it touched to
    // reconcile; then its settle batch is reported (Y3).
    function finish() {
      if (touched.size > 0) awaiting.add(gesture)
    }

    const gesture = {
      node,
      start, lastSent, touched,
      order: ++orderCounter,
      done: false,
      silent: false,
      /** Copy the dragged object's values in. Unknown fields are ignored. */
      update(values) {
        if (done) return
        for (const field of TRANSFORM_FIELDS) {
          if (!(field in values)) continue
          const v = sanitizeTransform(field, values[field])
          if (same(v, lastLocal.get(field))) continue
          writeLocal(node, field, v)
          lastLocal.set(field, v)
          if (!touched.has(field)) {
            const rec = recordFor(node, field, start.get(field))
            rec.active++
            touched.set(field, rec)
          }
        }
        if (now() - lastSendTime >= throttleMs) flush()
      },
      /** Release: one final send per changed field, then let records reconcile. */
      end() {
        if (done) return
        done = true
        gesture.done = true
        flush()
        finish()
        release()
      },
      /** Abandon without a final send (node removed, reconnect). */
      cancel() {
        if (done) return
        done = true
        gesture.done = true
        finish()
        release()
      },
    }
    gestures.add(gesture)
    return gesture
  }

  /**
   * A committed panel field: one local write and one send.
   * @param {object} [opts]
   * @param {boolean} [opts.record=true]  false for an undo's or a redo's send:
   *   it is never part of a reported batch, and its answer goes to the caller
   * @returns {number|null} the seq, or null if nothing was sent
   */
  function commit(node, field, value, { record = true } = {}) {
    const v = sanitizeTransform(field, value)
    const start = read(node, field)
    if (same(v, start)) return null
    const rec = recordFor(node, field, start)
    writeLocal(node, field, v)
    const seq = send(rec, v, !record)
    if (record) {
      awaiting.add({
        node,
        start: new Map([[field, start]]),
        lastSent: new Map([[field, v]]),
        touched: new Map([[field, rec]]),
        order: ++orderCounter,
        done: true,
        silent: false,
      })
    }
    reconcile(rec)
    return seq
  }

  /**
   * An edit:accepted. Returns {node, field, value} if it was one of ours.
   */
  function accepted(seq) {
    const entry = sends.get(seq)
    if (!entry) return null
    sends.delete(seq)
    const { rec, value } = entry
    rec.pending.delete(seq)
    rec.acceptedOwn = true
    // The socket delivers answers and broadcasts in the order the server
    // applied them, so whatever arrived last is the server's current value.
    rec.confirmed = value
    reconcile(rec)
    return { node: rec.node, field: rec.field, value }
  }

  /** An edit:rejected. Returns {node, field, value} if it was one of ours. */
  function rejected(seq, { code = null, message = null } = {}) {
    const entry = sends.get(seq)
    if (!entry) return null
    sends.delete(seq)
    const { rec, value, silent } = entry
    rec.pending.delete(seq)
    rec.rejected = true
    if (!silent) {
      const text = rec.dead ? REMOVED_MESSAGE : `Couldn't save: ${message || code || 'refused'}`
      onMessage(text, { node: rec.node, field: rec.field, code })
    }
    reconcile(rec)
    return { node: rec.node, field: rec.field, value }
  }

  /** An edit:unknown (the connection ended with this send unanswered). */
  function unknown(seq) {
    const entry = sends.get(seq)
    if (!entry) return null
    sends.delete(seq)
    entry.rec.pending.delete(seq)
    entry.rec.anyUnknown = true
    reconcile(entry.rec)
    return { node: entry.rec.node, field: entry.rec.field, value: entry.value }
  }

  /**
   * Another session's `som:set` for a transform field (U16). While a record is
   * open for that node and field, the server's current value is this one, so a
   * revert puts it back rather than an older value. The batch is then reported
   * without an entry (Y3).
   */
  function remoteSet(node, field, value) {
    const rec = records.get(node)?.get(field)
    if (!rec) return
    rec.remote = true
    rec.confirmed = value
  }

  /** The node (or an ancestor) was removed: cancel and never write to it again. */
  function nodeRemoved(node) {
    // Dead first: cancelling a gesture reconciles its records, and a record
    // with a rejection would otherwise write to the removed node right there.
    const recs = [...(records.get(node)?.values() ?? [])]
    for (const rec of recs) rec.dead = true
    for (const g of [...gestures]) if (g.node === node) g.cancel()
    for (const rec of recs) reconcile(rec)
  }

  /**
   * After a remove: every node with an open record or gesture that is no
   * longer alive (it, or an ancestor, was removed) is treated as nodeRemoved.
   * @param {(node: object) => boolean} isAlive
   */
  function pruneRemoved(isAlive) {
    const nodes = new Set(records.keys())
    for (const g of gestures) nodes.add(g.node)
    for (const node of nodes) if (!isAlive(node)) nodeRemoved(node)
  }

  /** Reconnect or world change: drop everything; the som-dump is the truth. */
  function reset() {
    // Dead first, as in nodeRemoved: nothing from the old connection writes.
    for (const byField of records.values()) for (const rec of byField.values()) rec.dead = true
    awaiting.clear()
    for (const g of [...gestures]) g.cancel()
    records.clear()
    sends.clear()
  }

  return {
    begin, commit, accepted, rejected, unknown, remoteSet, nodeRemoved, pruneRemoved, reset,
    /** For tests and diagnostics: number of unanswered sends. */
    get pendingCount() { return sends.size },
    /** For tests and diagnostics: is a record open for this node and field? */
    hasRecord(node, field) { return !!records.get(node)?.get(field) },
    /** For tests and diagnostics: how many finished gestures await settlement. */
    get awaitingCount() { return awaiting.size },
  }
}
