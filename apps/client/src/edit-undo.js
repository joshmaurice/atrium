// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-undo.js — Undo and Redo for the owner's own Edit-mode changes
 * (Phase 3 step 2, Y1/Y4 and decisions W2–W10). Pure: no DOM, no three.js, no
 * client. `app.js` wires it to the panel, the keys and the server.
 *
 * An entry has a `kind`, a `label` and what its inverse needs:
 * - `transform` — a settle batch reported it (Y3); per changed field the value
 *   to send back and the value the world must still hold;
 * - `rename` — the rename was accepted AND applied locally (U15);
 * - `add` — an add or a duplicate was accepted; the `add` descriptor that
 *   brings the node back exactly (`prepareRestore`, Y2);
 * - `delete` — a delete Y2 could capture was accepted; its last capture.
 *
 * Identity (W2): every entry points at a handle, `{ node }`, one per node
 * object, kept in a WeakMap. When a re-add is accepted the handle is pointed at
 * the new SOMNode, so every older entry for that node follows it (U7). An
 * entry's node is usable only while it is alive by identity.
 *
 * The stacks are cleared only when the edit session ends (W7) — not when Edit
 * mode is turned off. Recording does not depend on Edit mode either (Y7): the
 * module keeps its own map of recordable requests, keyed by seq, settled from
 * `edit:accepted`/`edit:rejected`/`edit:unknown` whatever the mode.
 */

import { addMessageBytes } from './edit-duplicate.js'
import { collectSubtree } from './edit-structure.js'

/** W8 — at most this many entries per stack. */
export const MAX_ENTRIES = 100
/** W8 — at most this many UTF-8 bytes of descriptors across both stacks. */
export const MAX_DESCRIPTOR_BYTES = 16 * 1024 * 1024

export const NOTHING_TO_UNDO = 'Nothing to undo'
export const NOTHING_TO_REDO = 'Nothing to redo'
export const WAITING_MESSAGE = 'Waiting for the server…'
export const OUT_OF_STEP_MESSAGE =
  'Undo history was cleared: this window is out of step with the server. Reload to resync.'
export const DELETE_CHANGED_MESSAGE =
  'This delete can’t be undone: the object changed while it was being deleted.'
export const UNDOING_MESSAGE = 'Undoing…'

/** How the panel names a transform field in a message. */
const FIELD_NAME = { translation: 'position', rotation: 'rotation', scale: 'scale' }
/** The verb a single-field transform entry's label uses (Y1). */
const FIELD_VERB = { translation: 'Move', rotation: 'Rotate', scale: 'Scale' }

function same(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Exact equality, every number and every key — the comparison Y1 uses. */
function sameDescriptor(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameDescriptor(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false
    if (!sameDescriptor(a[k], b[k])) return false
  }
  return true
}

/**
 * @param {object} deps
 * @param {(name: string) => object|null} deps.getNodeByName  SOM lookup by name
 * @param {(name: string, node?: object) => {ok: boolean, message?: string}} deps.checkNewName
 * @param {(gltfNode: object) => {ok: true, descriptor: object}|{ok: false, reason: string}} deps.prepareRestore
 *   edit-duplicate's `prepareRestore` (Y2)
 * @param {(node: object, field: string, value: number[]) => (number|null)} deps.sendTransform
 *   editTracker.commit(node, field, value, { record: false })
 * @param {(node: object, from: string, to: string, direction: string) => (number|null)} deps.rename
 *   send a rename; the caller keeps it on the `pendingRename` path
 * @param {(request: object, direction: string) => (number|null)} deps.structural
 *   send a marked `delete` (a remove) or `add` (a re-add) through the structure
 *   tracker; the caller marks the request so its answer comes back here
 * @param {(node: object|null) => void} deps.select   W10
 * @param {(text: string) => void} deps.message       the panel's error line
 * @param {() => boolean} deps.isEditOn
 * @param {() => boolean} deps.isDragging
 * @param {() => boolean} deps.isRenamePending
 * @param {() => boolean} deps.hasPendingSend          editTracker.pendingCount > 0
 * @param {() => boolean} deps.hasPendingStructural    a structural request pending
 */
export function createEditUndo({
  getNodeByName,
  checkNewName,
  prepareRestore,
  sendTransform,
  rename,
  structural,
  select = () => {},
  message = () => {},
  isEditOn = () => true,
  isDragging = () => false,
  isRenamePending = () => false,
  hasPendingSend = () => false,
  hasPendingStructural = () => false,
}) {
  /** @type {WeakMap<object, {node: object}>} */
  const handles = new WeakMap()
  /** @type {object[]} oldest first; the newest is undone first */
  const undoStack = []
  const redoStack = []
  /** @type {Map<number, object>} recordable requests, keyed by seq (Y7) */
  const requests = new Map()
  /** the undo or redo under way, or null */
  let inFlight = null
  /**
   * The open capture window (Y2), or null: a click delete's, or — R4 — an
   * undo's add-removal or a redo's delete-removal. While it is open, every
   * remote `som:set`/`som:rename`/`som:add` re-captures the descriptor.
   */
  let deleteWindow = null
  let ageCounter = 0

  // ── Handles (W2) ───────────────────────────────────────────────────────

  function handleFor(node) {
    let h = handles.get(node)
    if (!h) { h = { node }; handles.set(node, h) }
    return h
  }

  /** The server re-added the node: every older entry now points at the new one. */
  function repoint(handle, node) {
    handle.node = node
    if (node) handles.set(node, handle)
  }

  const alive = (node) => !!node && getNodeByName(node.name) === node

  // ── Stacks and bounds (Y1, W8) ─────────────────────────────────────────

  function descriptorBytes(e) { return e.descriptor ? addMessageBytes(e.descriptor) : 0 }

  function totalDescriptorBytes() {
    let n = 0
    for (const e of undoStack) n += e.bytes
    for (const e of redoStack) n += e.bytes
    return n
  }

  /** W8 — the oldest entries go first, and descriptors count by UTF-8 bytes. */
  function enforceBounds() {
    while (undoStack.length > MAX_ENTRIES) undoStack.shift()
    while (redoStack.length > MAX_ENTRIES) redoStack.shift()
    while (totalDescriptorBytes() > MAX_DESCRIPTOR_BYTES) {
      let oldest = null
      for (const e of undoStack) if (e.bytes > 0 && (!oldest || e.age < oldest.age)) oldest = e
      for (const e of redoStack) if (e.bytes > 0 && (!oldest || e.age < oldest.age)) oldest = e
      if (!oldest) break
      const i = undoStack.indexOf(oldest)
      if (i >= 0) undoStack.splice(i, 1)
      else redoStack.splice(redoStack.indexOf(oldest), 1)
    }
  }

  /** A newly recorded entry goes on the undo stack and clears the redo stack. */
  function pushEntry(entry) {
    entry.age = ++ageCounter
    entry.bytes = descriptorBytes(entry)
    undoStack.push(entry)
    redoStack.length = 0
    enforceBounds()
  }

  function clearRedo() { redoStack.length = 0 }
  function clearBoth() { undoStack.length = 0; redoStack.length = 0 }

  // ── Recording: transforms (Y1, Y3) ─────────────────────────────────────

  function onTransformsSettled(results, info = {}) {
    if (!results || results.length === 0) {
      // A remote-touched batch with an accepted own send: a confirmed change of
      // this tab's went unrecorded, so the redo stack is cleared (Y1, Rev 3 #3).
      if (info.acceptedOwnSend) clearRedo()
      return
    }
    for (const r of results) {
      if (!r.changes || r.changes.length === 0) continue
      const changes = r.changes.map((c) => ({ field: c.field, from: [...c.from], to: [...c.to] }))
      pushEntry({
        kind: 'transform',
        label: changes.length === 1 ? FIELD_VERB[changes[0].field] : 'Transform',
        name: r.node?.name ?? '',
        handle: handleFor(r.node),
        changes,
      })
    }
  }

  // ── Recording: renames (Y1, Y4/U15) ────────────────────────────────────

  function registerRename(seq, { node, from, to }) {
    if (seq == null) return
    requests.set(seq, { kind: 'rename', seq, node, from, to })
  }

  /**
   * A rename's acceptance counts only if it applied locally (U15): the handle's
   * node is alive and its name is now the target. Otherwise this window no
   * longer matches the server, so both stacks go and the panel says so.
   */
  function renameApplied({ node, from, to }) {
    if (!node) return false
    if (getNodeByName(to) !== node) return false
    return node.name === to
  }

  function renameAccepted(req) {
    if (!renameApplied(req)) {
      // R2 — an undo's or a redo's rename accepted without applying locally:
      // this window is out of step, so both stacks go, and the request is
      // settled here. Without clearing `inFlight` the failed undo would stay
      // in flight and `editBlocked()` would block every Edit-mode change until
      // a reload.
      inFlight = null
      deleteWindow = null
      clearBoth()
      message(OUT_OF_STEP_MESSAGE)
      return true
    }
    if (req.direction) {
      // an undo's or a redo's own rename: the engine moves the entry, nothing
      // is recorded as a new edit
      if (inFlight && inFlight.bySeq.has(req.seq)) {
        inFlight.bySeq.delete(req.seq)
        if (inFlight.bySeq.size === 0) completeAccepted()
      }
      return true
    }
    pushEntry({
      kind: 'rename',
      label: 'Rename',
      name: req.from,
      handle: handleFor(req.node),
      from: req.from,
      to: req.to,
    })
    return true
  }

  function renameRejected(req) {
    if (req.direction) {
      if (inFlight && inFlight.bySeq.has(req.seq)) {
        inFlight.bySeq.delete(req.seq)
        if (inFlight.bySeq.size === 0) failEntry(req.message)
      }
      return true
    }
    return true
  }

  // ── Recording: adds, duplicates and deletes (Y1, Y2) ───────────────────

  /** Y2 — capture what would bring this node back, from its current values. */
  function capture(node) {
    const gltfNode = node?._node
    if (!gltfNode) return { ok: false, reason: 'not addressable' }
    const r = prepareRestore(gltfNode)
    if (!r.ok) return { ok: false, reason: r.reason }
    return { ok: true, descriptor: r.descriptor }
  }

  function registerAdd(seq, { name, duplicate = false }) {
    if (seq == null) return
    requests.set(seq, { kind: 'add', seq, name, duplicate })
  }

  /**
   * Y2 — a delete's capture begins at the click and is redone on every remote
   * change until the delete's own `som:remove`. `descriptor` is the click-time
   * capture, or null when the node cannot come back (W5).
   */
  function registerDelete(seq, { node, name, descriptor }) {
    if (seq == null) return
    const req = { kind: 'delete', seq, node, name, descriptor: descriptor ?? null, failed: false }
    requests.set(seq, req)
    deleteWindow = req
    return req
  }

  /**
   * R4 — an undo's add-removal or a redo's delete-removal opens the same
   * capture window as a click delete (Y2): a remote change between the entry's
   * check and the server's remove re-captures the entry's descriptor on every
   * `som:set`/`som:rename`/`som:add` until the removal, so a later redo or undo
   * restores the server's state and never a stale one.
   */
  function openRemovalWindow(entry, direction, node) {
    const cap = capture(node)
    deleteWindow = {
      kind: 'removal',
      name: node.name,
      node,
      direction,
      entry,
      descriptor: cap.ok ? cap.descriptor : null,
      failed: !cap.ok,
    }
  }

  /** A `som:set`, `som:rename` or `som:add` while a delete is pending (Y2). */
  function reCapture() {
    const req = deleteWindow
    if (!req) return
    const node = getNodeByName(req.name)
    if (node !== req.node) return          // it is gone: the window is over
    const cap = capture(node)
    if (!cap.ok) { req.failed = true; return }
    req.descriptor = cap.descriptor
    // R4 — a removal's entry keeps the descriptor its later re-add will use
    if (req.entry) req.entry.descriptor = cap.descriptor
  }

  function acceptAdd(req) {
    const node = getNodeByName(req.name)
    if (!node) { clearRedo(); return }      // nothing to point an entry at
    const cap = capture(node)
    if (!cap.ok) { clearRedo(); return }    // not restorable: not recorded (Y1)
    pushEntry({
      kind: 'add',
      label: req.duplicate ? 'Duplicate' : 'Add',
      name: req.name,
      handle: handleFor(node),
      descriptor: cap.descriptor,
    })
  }

  function acceptDelete(req) {
    if (req.failed) {
      // Y2 — the object changed while it was being deleted: not recorded
      clearRedo()
      message(DELETE_CHANGED_MESSAGE)
      return
    }
    if (!req.descriptor) { clearRedo(); return }   // W5: not restorable, not recorded
    pushEntry({
      kind: 'delete',
      label: 'Delete',
      name: req.name,
      handle: handleFor(req.node),
      descriptor: req.descriptor,
    })
  }

  // ── Answers ────────────────────────────────────────────────────────────

  function onAccepted(seq) {
    const req = requests.get(seq)
    if (req && req.kind === 'rename') {
      requests.delete(seq)
      return renameAccepted(req)
    }
    const tracked = inFlight?.bySeq?.get(seq)
    if (!tracked || tracked.field === null) return false   // a structural answer
    inFlight.bySeq.delete(seq)
    tracked.ref.status = 'accepted'
    inFlight.accepted = (inFlight.accepted ?? 0) + 1
    if (inFlight.bySeq.size === 0) completeAccepted()
    return true
  }

  function onRejected(seq, { code = null, message: text = null } = {}) {
    const req = requests.get(seq)
    if (req && req.kind === 'rename') {
      requests.delete(seq)
      req.message = text || code
      return renameRejected(req)
    }
    const tracked = inFlight?.bySeq?.get(seq)
    if (!tracked || tracked.field === null) return false   // a structural answer
    inFlight.bySeq.delete(seq)
    tracked.ref.status = 'refused'
    tracked.ref.text = text || code || 'refused'
    inFlight.refused = (inFlight.refused ?? 0) + 1
    if (inFlight.refused === 1) inFlight.firstRefusal = { text: text || code || 'refused' }
    if (inFlight.bySeq.size === 0) finishRefused()
    return true
  }

  function onUnknown(seq) {
    const req = requests.get(seq)
    if (req) requests.delete(seq)
    const tracked = inFlight?.bySeq?.get(seq)
    if (!tracked || tracked.field === null) return false
    inFlight.bySeq.delete(seq)
    if (inFlight.bySeq.size === 0) {
      // the session is ending; the stacks go with it (W7)
      inFlight = null
      deleteWindow = null
      requests.clear()
      clearBoth()
    }
    return true
  }

  /**
   * A structural answer, after the structure tracker settled it (Y4). An
   * undo's or a redo's own request is handled first, before the panel's
   * palette retry could ever see it.
   */
  function onStructureAnswer({ request, status, removedMessage }, text = null) {
    if (request.undo) {
      if (!inFlight || !inFlight.bySeq.has(request.seq)) return false
      inFlight.bySeq.delete(request.seq)
      // R4 — a removal's capture window is over as soon as its answer arrives
      const removal = deleteWindow && deleteWindow.kind === 'removal' ? deleteWindow : null
      const removalFailed = !!removal && removal.failed && removal.entry === inFlight.entry
      if (removal) deleteWindow = null
      if (status === 'accepted' && removedMessage !== 'replaced') {
        if (removalFailed) {
          // R4 — the object changed while it was being removed: the removal
          // still happened, but the entry can no longer bring it back
          dropEntry()
          inFlight = null
          message(DELETE_CHANGED_MESSAGE)
        } else {
          completeAccepted()      // held 'quiet' or nothing held: ours won
        }
      } else if (status === 'accepted') {
        // S1: ours was already gone and a newer object with the name went
        // instead — the entry is dropped (W2's known limitation)
        dropEntry()
        inFlight = null
      } else if (status === 'rejected') {
        // S1's own messages are the panel's; the entry is dropped either way (W2)
        if (removedMessage === null) failEntry(text)
        else { dropEntry(); inFlight = null }
      } else {
        inFlight = null
        deleteWindow = null
        requests.clear()
        clearBoth()
      }
      return true
    }
    const req = requests.get(request.seq)
    if (!req) return false
    requests.delete(request.seq)
    if (req === deleteWindow) deleteWindow = null
    if (req.kind === 'delete') {
      if (status === 'accepted') acceptDelete(req)
      return true
    }
    if (req.kind === 'add') {
      if (status === 'accepted') acceptAdd(req)
      return true
    }
    return true
  }

  // ── Availability (Y4) ──────────────────────────────────────────────────

  function reason(kind) {
    const stack = kind === 'undo' ? undoStack : redoStack
    if (stack.length === 0) return kind === 'undo' ? NOTHING_TO_UNDO : NOTHING_TO_REDO
    if (!isEditOn()) return 'Turn Edit mode on first'
    if (hasPendingStructural()) return WAITING_MESSAGE
    if (isDragging()) return 'Finish moving the object first'
    if (isRenamePending()) return 'Waiting for the rename…'
    if (hasPendingSend()) return WAITING_MESSAGE
    if (inFlight) return WAITING_MESSAGE
    return null
  }

  function label(kind) {
    const stack = kind === 'undo' ? undoStack : redoStack
    const entry = stack[stack.length - 1]
    if (!entry) return reason(kind)
    return `${kind === 'undo' ? 'Undo' : 'Redo'} ${entry.label} “${entry.name}”`
  }

  // ── The engine (Y4) ────────────────────────────────────────────────────

  /** W4 — is the world still the way this entry left it? */
  function checkEntry(entry, direction) {
    const node = entry.handle.node
    const name = entry.name
    const verb = direction === 'undo' ? 'Can’t undo' : 'Can’t redo'

    // a re-add is an `add`: the node is gone by definition, so the only check
    // is that the name is free
    const readd = (entry.kind === 'delete' && direction === 'undo') ||
      (entry.kind === 'add' && direction === 'redo')
    if (readd) {
      const check = checkNewName(entry.descriptor.name)
      if (check && !check.ok) return { ok: false, message: `${verb}: “${name}” the name is in use.` }
      return { ok: true }
    }

    if (!alive(node)) return { ok: false, message: `${verb}: “${name}” was removed.` }

    if (entry.kind === 'transform') {
      for (const c of entry.changes) {
        const want = direction === 'undo' ? c.to : c.from
        if (!same(node[c.field], want)) {
          return { ok: false, message: `${verb}: “${name}” was changed elsewhere.` }
        }
      }
      return { ok: true }
    }

    if (entry.kind === 'rename') {
      const current = direction === 'undo' ? entry.to : entry.from
      const target = direction === 'undo' ? entry.from : entry.to
      if (node.name !== current) {
        return { ok: false, message: `${verb}: “${name}” was changed elsewhere.` }
      }
      const check = checkNewName(target, node)
      if (check && !check.ok) {
        return { ok: false, message: `${verb}: “${name}” the name is in use.` }
      }
      return { ok: true }
    }

    // a remove: undo of an add, or redo of a delete
    if (node.children && node.children.length > 0) {
      return { ok: false, message: `${verb}: “${name}” was changed elsewhere.` }
    }
    const cap = capture(node)
    if (!cap.ok || !sameDescriptor(cap.descriptor, entry.descriptor)) {
      return { ok: false, message: `${verb}: “${name}” was changed elsewhere.` }
    }
    return { ok: true }
  }

  function dropEntry() {
    const stack = inFlight?.direction === 'undo' ? undoStack : redoStack
    const entry = inFlight?.entry
    if (!entry) return
    const i = stack.lastIndexOf(entry)
    if (i >= 0) stack.splice(i, 1)
  }

  function moveEntry(entry, direction) {
    const from = direction === 'undo' ? undoStack : redoStack
    const to = direction === 'undo' ? redoStack : undoStack
    const i = from.lastIndexOf(entry)
    if (i >= 0) from.splice(i, 1)
    else if (to.includes(entry)) return
    to.push(entry)
    enforceBounds()
  }

  /** An accepted undo or redo: the entry moves, restated in the node's values. */
  function completeAccepted() {
    const { direction, entry, kind } = inFlight
    inFlight = null
    const node = entry.handle.node
    if (kind === 'transform') {
      // U11 — an undo may send a normalized value, so the mirror check must
      // compare against what the node now holds
      entry.changes = entry.changes.map((c) => (direction === 'undo'
        ? { field: c.field, from: [...(node[c.field] ?? c.from)], to: c.to }
        : { field: c.field, from: c.from, to: [...(node[c.field] ?? c.to)] }))
    }
    const readded = (kind === 'add' && direction === 'redo') || (kind === 'delete' && direction === 'undo')
    if (readded) {
      // a re-add: the handle follows the new node (it is in the SOM before
      // edit:accepted), so older entries for the node follow it too (W2)
      const fresh = getNodeByName(entry.descriptor.name)
      if (fresh) repoint(entry.handle, fresh)
    }
    moveEntry(entry, direction)
    // W10 — select what changed
    select(alive(entry.handle.node) ? entry.handle.node : null)
  }

  /** A refusal: the entry is dropped. Nothing of this tab's was confirmed. */
  function failEntry(text) {
    const { direction } = inFlight
    dropEntry()
    inFlight = null
    message(`Couldn’t ${direction}: ${text || 'refused'}`)
  }

  function finishRefused() {
    const { direction, accepted = 0 } = inFlight
    if (accepted > 0) {
      // partly applied: the node is in neither state, so the entry is dropped,
      // the panel says exactly what happened, and the redo stack is cleared
      // (a confirmed change of this tab's went unrecorded, Y1)
      const fields = inFlight.fields ?? []
      const changed = fields.filter((f) => f.status === 'accepted').map((f) => FIELD_NAME[f.field])
      const refused = fields.filter((f) => f.status === 'refused')
      dropEntry()
      const firstText = refused[0].text
      inFlight = null
      message(`${direction === 'undo' ? 'Undo' : 'Redo'} was only partly applied: ` +
        `${changed.join(', ')} changed, ${refused.map((f) => FIELD_NAME[f.field]).join(', ')} ` +
        `was refused (${firstText}).`)
      clearRedo()
      return
    }
    failEntry(inFlight.firstRefusal?.text)
  }

  /** One request per field: null counts as done, nothing sent moves at once. */
  function startTransform(entry, direction) {
    const node = entry.handle.node
    const bySeq = new Map()
    const fields = []
    for (const c of entry.changes) {
      const value = direction === 'undo' ? c.from : c.to
      const seq = sendTransform(node, c.field, value)
      const ref = { field: c.field, seq, status: seq == null ? 'sent-nothing' : 'pending' }
      fields.push(ref)
      if (seq != null) bySeq.set(seq, { field: c.field, ref })
    }
    inFlight = { direction, entry, kind: 'transform', bySeq, fields, accepted: 0, refused: 0 }
    if (bySeq.size === 0) {
      // U11 — the target normalizes to what the node already holds (Y4, Rev 1 #8)
      completeAccepted()
    }
  }

  function startEntry(entry, direction) {
    if (entry.kind === 'transform') { startTransform(entry, direction); return }

    if (entry.kind === 'rename') {
      const from = direction === 'undo' ? entry.to : entry.from
      const to = direction === 'undo' ? entry.from : entry.to
      const node = entry.handle.node
      const seq = rename(node, from, to, direction)
      if (seq == null) return
      inFlight = { direction, entry, kind: 'rename', bySeq: new Map([[seq, { field: null }]]) }
      // the request is settled through the rename path, which needs the marker
      requests.set(seq, { kind: 'rename', seq, node, from, to, direction })
      return
    }

    if (entry.kind === 'add' && direction === 'undo') {
      const node = entry.handle.node
      const req = { kind: 'delete', name: node.name, node, subtree: collectSubtree(node) }
      const seq = structural(req, direction)
      if (seq == null) return
      inFlight = { direction, entry, kind: 'add', bySeq: new Map([[seq, { field: null }]]) }
      openRemovalWindow(entry, direction, node)        // R4 — the same capture window
      return
    }
    if (entry.kind === 'add') {
      // redo of an add: re-add the descriptor
      const seq = structural({ kind: 'add', name: entry.descriptor.name, descriptor: entry.descriptor }, direction)
      if (seq == null) return
      inFlight = { direction, entry, kind: 'add', bySeq: new Map([[seq, { field: null }]]) }
      return
    }
    if (entry.kind === 'delete' && direction === 'undo') {
      const seq = structural({ kind: 'add', name: entry.descriptor.name, descriptor: entry.descriptor }, direction)
      if (seq == null) return
      inFlight = { direction, entry, kind: 'delete', bySeq: new Map([[seq, { field: null }]]) }
      return
    }
    if (entry.kind === 'delete') {
      // redo of a delete: a remove
      const node = entry.handle.node
      const req = { kind: 'delete', name: node.name, node, subtree: collectSubtree(node) }
      const seq = structural(req, direction)
      if (seq == null) return
      inFlight = { direction, entry, kind: 'delete', bySeq: new Map([[seq, { field: null }]]) }
      openRemovalWindow(entry, direction, node)        // R4 — the same capture window
    }
  }

  /**
   * One undo or redo. Available only when the stack is not empty, Edit mode is
   * on and nothing is in flight; the button and the keys both check again (Y4).
   */
  function run(direction) {
    if (reason(direction) !== null) return false
    const stack = direction === 'undo' ? undoStack : redoStack
    const entry = stack[stack.length - 1]
    if (!entry) return false
    const check = checkEntry(entry, direction)
    if (!check.ok) {
      stack.pop()                     // dropped; the rest of the stack stays (W4)
      message(check.message)
      return false
    }
    startEntry(entry, direction)
    return true
  }

  /** The end of the edit session: world load, connecting, disconnected (W7). */
  function endSession() {
    inFlight = null
    deleteWindow = null
    requests.clear()
    clearBoth()
  }

  return {
    // recording
    onTransformsSettled,
    registerRename,
    registerAdd,
    registerDelete,
    capture,
    reCapture,
    // answers
    onAccepted,
    onRejected,
    onUnknown,
    onStructureAnswer,
    // the engine
    run,
    reason,
    label,
    inFlight: () => !!inFlight,
    endSession,
    // for the panel and for tests
    get undoCount() { return undoStack.length },
    get redoCount() { return redoStack.length },
    get undoBytes() { return undoStack.reduce((n, e) => n + e.bytes, 0) },
    get redoBytes() { return redoStack.reduce((n, e) => n + e.bytes, 0) },
    /** The whole stack, oldest first — for the panel's hints and for tests. */
    get undoLabels() { return undoStack.map((e) => `${e.label} “${e.name}”`) },
    get redoLabels() { return redoStack.map((e) => `${e.label} “${e.name}”`) },
  }
}
