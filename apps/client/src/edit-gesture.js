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
 *   becomes the value of the highest-seq accepted send;
 * - a rejection sets a flag and reports a message;
 * - the record reconciles only when nothing is pending AND no gesture on that
 *   field is active: if anything was rejected, the field is set back to
 *   `confirmed`. The server answers one session's requests in order, so that is
 *   the server's value. A late rejection from an older gesture therefore can't
 *   overwrite a newer accepted edit, and nothing is written while a newer
 *   gesture is still under way.
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
 * @param {() => number} [opts.now]
 * @param {number} [opts.throttleMs=100]
 */
export function createEditTracker({
  read, writeLocal, writeSend,
  onMessage = () => {}, onReverted = () => {},
  now = () => Date.now(), throttleMs = 100,
}) {
  /** @type {Map<object, Map<string, object>>} node → field → record */
  const records = new Map()
  /** @type {Map<number, {rec: object, value: any}>} */
  const sends = new Map()
  /** @type {Set<object>} active gestures */
  const gestures = new Set()

  function recordFor(node, field, startValue) {
    let byField = records.get(node)
    if (!byField) { byField = new Map(); records.set(node, byField) }
    let rec = byField.get(field)
    if (!rec) {
      rec = {
        node, field,
        confirmed: startValue,
        lastAcceptedSeq: -Infinity,
        pending: new Set(),
        rejected: false,
        active: 0,
        dead: false,
      }
      byField.set(field, rec)
    }
    return rec
  }

  function dropRecord(rec) {
    const byField = records.get(rec.node)
    if (!byField || byField.get(rec.field) !== rec) return
    byField.delete(rec.field)
    if (byField.size === 0) records.delete(rec.node)
  }

  function reconcile(rec) {
    if (rec.pending.size > 0 || rec.active > 0) return
    // Only write when the node actually differs from the server's value.
    if (rec.rejected && !rec.dead && !same(read(rec.node, rec.field), rec.confirmed)) {
      writeLocal(rec.node, rec.field, rec.confirmed)
      onReverted(rec.node, rec.field, rec.confirmed)
    }
    dropRecord(rec)
  }

  function send(rec, value) {
    const seq = writeSend(rec.node, rec.field, value)
    if (seq == null) return null
    sends.set(seq, { rec, value })
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

    const gesture = {
      node,
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
        flush()
        release()
      },
      /** Abandon without a final send (node removed, reconnect). */
      cancel() {
        if (done) return
        done = true
        release()
      },
    }
    gestures.add(gesture)
    return gesture
  }

  /**
   * A committed panel field: one local write and one send.
   * @returns {number|null} the seq, or null if nothing was sent
   */
  function commit(node, field, value) {
    const v = sanitizeTransform(field, value)
    const start = read(node, field)
    if (same(v, start)) return null
    const rec = recordFor(node, field, start)
    writeLocal(node, field, v)
    const seq = send(rec, v)
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
    if (seq > rec.lastAcceptedSeq) {
      rec.lastAcceptedSeq = seq
      rec.confirmed = value
    }
    reconcile(rec)
    return { node: rec.node, field: rec.field, value }
  }

  /** An edit:rejected. Returns {node, field, value} if it was one of ours. */
  function rejected(seq, { code = null, message = null } = {}) {
    const entry = sends.get(seq)
    if (!entry) return null
    sends.delete(seq)
    const { rec, value } = entry
    rec.pending.delete(seq)
    rec.rejected = true
    const text = rec.dead ? REMOVED_MESSAGE : `Couldn't save: ${message || code || 'refused'}`
    onMessage(text, { node: rec.node, field: rec.field, code })
    reconcile(rec)
    return { node: rec.node, field: rec.field, value }
  }

  /** An edit:unknown (the connection ended with this send unanswered). */
  function unknown(seq) {
    const entry = sends.get(seq)
    if (!entry) return null
    sends.delete(seq)
    entry.rec.pending.delete(seq)
    reconcile(entry.rec)
    return { node: entry.rec.node, field: entry.rec.field, value: entry.value }
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
    for (const g of [...gestures]) g.cancel()
    records.clear()
    sends.clear()
  }

  return {
    begin, commit, accepted, rejected, unknown, nodeRemoved, pruneRemoved, reset,
    /** For tests and diagnostics: number of unanswered sends. */
    get pendingCount() { return sends.size },
    /** For tests and diagnostics: is a record open for this node and field? */
    hasRecord(node, field) { return !!records.get(node)?.get(field) },
  }
}
