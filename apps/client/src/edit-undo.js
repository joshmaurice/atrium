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
 * - grouping GR7 — `move` (Move to: where the node was and where it went,
 *   each `{ parent: handle|null, translation, rotation, scale }`, exact), `group`
 *   (the group's descriptor and the object's move) and `ungroup` (each part's
 *   move and the group's capture; "Ungroup (partly)" when some part stayed).
 *   They run as phases (`startComposite`): the group's `add`, then the moves;
 *   the moves, then the group's `remove` through the capture window.
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

import { addMessageBytes, hasSharedMaterial } from './edit-duplicate.js'
import { collectSubtree } from './edit-structure.js'
import { moveCounts, treeBoundsProblem, descriptorCounts } from '@atrium/client/add-spec'
import { behaviorAncestorsChange, regroupCounts, BOUNDS_REASON } from './edit-group.js'

/** W8 — at most this many entries per stack. */
export const MAX_ENTRIES = 100
/**
 * richer-add R8 (RA-L3 (a)) — what the Undo button's title adds for a delete
 * whose restore won't share what the object shared.
 */
export const SHARED_MATERIAL_NOTE = '(it comes back with its own material)'

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
/**
 * subtree-add T5 (the fresh-agent check's S6) — why a group can't be captured:
 * a part holds its name without being addressable by it (a shadowed duplicate,
 * or a name an animation or a `.camera`/`.light` alias took first), so its
 * restore would be refused. The capture failing makes Delete ask first.
 */
export const PART_NOT_ADDRESSABLE = 'One of its parts can’t be restored under its own name'
/**
 * selection-parts T11 (§9.5 S6) — why a part can't be captured: its parent
 * isn't the node of its name (as the server and `_onAdd` resolve `parent`),
 * so its re-add would land elsewhere. The capture failing makes Delete ask.
 */
export const GROUP_NOT_ADDRESSABLE = 'Its group can’t be found by its name'

/** The re-add of a part whose group is gone, or isn't the same node any more (T11). */
const groupRemoved = (verb, name) => `${verb}: “${name}” its group was removed.`
const groupReplaced = (verb, name) => `${verb}: “${name}” its group was replaced elsewhere.`
const groupRenamedOrRemoved = (verb, name) => `${verb}: “${name}” its group was renamed or removed.`
const landedElsewhere = (name, parent) => `“${name}” went into a newer “${parent}”: its group was replaced elsewhere.`

/** grouping GR7 (GR-L7 (a)) — an undo or a redo of several messages the server stopped. */
const stoppedMessage = (direction, names, text) =>
  `${direction === 'undo' ? 'Undo' : 'Redo'} stopped: ${names.map((n) => `“${n}”`).join(', ')} changed elsewhere${text ? ` (${text})` : ''}.`

/** How the panel names a transform field in a message. */
const FIELD_NAME = { translation: 'position', rotation: 'rotation', scale: 'scale', visible: 'visibility' }
/** The verb a single-field transform entry's label uses (Y1). */
const FIELD_VERB = { translation: 'Move', rotation: 'Rotate', scale: 'Scale', visible: 'Show or hide' }

/** JSON with sorted keys, for comparing two `extras` objects. */
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}

function same(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * V4 (round 5) — the undo stack holds transform VECTORS and, now, the Visible
 * field's BOOLEAN. `[...value]` is what threw "value is not iterable" on a
 * boolean, so every copy of a change's value goes through here: a vector is
 * copied, anything else passes through unchanged.
 */
function copyValue(value) {
  return Array.isArray(value) ? [...value] : value
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
 * selection-parts T11 (SP-L5 (a)) — are two captures of a tree the same
 * group? As `sameDescriptor`, except that each `{ ref }` is replaced by the
 * material it names, `children` are matched by member name (unique within a
 * tree, T1) rather than by position, and which primitives share a material
 * (the partition) must be the same. A part re-added under its group comes back
 * last among its siblings (`addChild` appends), which renumbers the refs:
 * this comparison doesn't see that, and does see sharing really lost.
 *
 * @param {object} a  a descriptor (`buildDescriptor`'s canonical form)
 * @param {object} b
 * @returns {boolean}
 */
export function sameCanonical(a, b) {
  const ca = canonicalTree(a)
  const cb = canonicalTree(b)
  if (!ca || !cb) return sameDescriptor(a, b)
  if (!sameByName(ca.tree, cb.tree)) return false
  return samePartition(ca.partition, cb.partition)
}

/** The tree with refs resolved, and its partition: material number → the primitives using it. */
function canonicalTree(root) {
  if (root === null || typeof root !== 'object') return null
  const tree = structuredClone(root)
  const materials = []
  const groups = new Map()
  const stack = [tree]
  while (stack.length > 0) {
    const d = stack.pop()
    const prims = Array.isArray(d?.mesh?.primitives) ? d.mesh.primitives : []
    prims.forEach((prim, i) => {
      const m = prim?.material
      if (m === undefined || m === null) return
      let n
      if (typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length === 1 && Number.isInteger(m.ref)) {
        n = m.ref
        if (!(n >= 0 && n < materials.length)) return
        prim.material = structuredClone(materials[n])
      } else {
        n = materials.length
        materials.push(m)
      }
      const key = `${d.name}#${i}`
      if (!groups.has(n)) groups.set(n, [])
      groups.get(n).push(key)
    })
    const children = Array.isArray(d?.children) ? d.children : []
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  const partition = new Set([...groups.values()].map((keys) => keys.sort().join('\u0000')))
  return { tree, partition }
}

function samePartition(a, b) {
  if (a.size !== b.size) return false
  for (const g of a) if (!b.has(g)) return false
  return true
}

/** `sameDescriptor`, with every `children` array matched by member name. */
function sameByName(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameByName(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false
    if (k === 'children') {
      if (!sameChildren(a.children, b.children)) return false
    } else if (!sameByName(a[k], b[k])) {
      return false
    }
  }
  return true
}

function sameChildren(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  const byName = new Map()
  for (const c of b) {
    if (!c || typeof c.name !== 'string' || byName.has(c.name)) return false
    byName.set(c.name, c)
  }
  const seen = new Set()
  for (const c of a) {
    if (!c || typeof c.name !== 'string' || seen.has(c.name) || !byName.has(c.name)) return false
    seen.add(c.name)
    if (!sameByName(c, byName.get(c.name))) return false
  }
  return true
}

/**
 * @param {object} deps
 * @param {(name: string) => object|null} deps.getNodeByName  SOM lookup by name
 * @param {(name: string, node?: object) => {ok: boolean, message?: string}} deps.checkNewName
 * @param {(gltfNode: object, opts?: {trees: boolean}) => {ok: true, descriptor: object}|{ok: false, reason: string}} deps.prepareRestore
 *   edit-duplicate's `prepareRestore` (Y2)
 * @param {(name: string) => object|null} [deps.getObjectByName]  subtree-add T5: the SOM's
 *   name-space lookup (nodes, animations, camera and light aliases); defaults to getNodeByName
 * @param {() => boolean} [deps.trees]  subtree-add T7: the server keeps add level 3
 *   (`client.serverAddFields >= 3`), so a group is captured and restored as a tree
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
  getObjectByName = null,
  trees = () => false,
  // grouping GR7 — send a parent change (`client.moveNode`), returning its seq
  // or null; and the next free name for Group's one retry ("already in use").
  move = () => null,
  freeName = () => null,
  // grouping GR8 (second review S4) — the behaviour hold while a composite is
  // in flight: the node whose subtree it moves (the app's createBehaviorHold
  // takes one node, and covers its descendants and ancestors). The app
  // releases it when the composite is no longer in flight (its answer).
  holdNode = () => {},
}) {
  const objectByName = getObjectByName ?? getNodeByName
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
      // R7 — and only then. A drag put back to its start reports no result with
      // `acceptedOwnSend` true and nothing remote: the world did not change, so
      // the redo stack stays.
      if (info.remote && info.acceptedOwnSend) clearRedo()
      return
    }
    for (const r of results) {
      if (!r.changes || r.changes.length === 0) continue
      const changes = r.changes.map((c) => ({ field: c.field, from: copyValue(c.from), to: copyValue(c.to) }))
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

  /**
   * Y2 — capture what would bring this node back, from its current values.
   * subtree-add T5: with `trees()`, a node with children is captured whole,
   * every part addressable by its own name (else the capture fails, so Delete
   * asks), and the result names each part's handle (`members`), so a re-add can
   * point older entries for the parts at the parts that come back (S3).
   */
  function capture(node) {
    const gltfNode = node?._node
    if (!gltfNode) return { ok: false, reason: 'not addressable' }
    // selection-parts T11 — a part comes back under its parent BY NAME, so the
    // parent must be the node of its name (§9.5 S6), and the name not empty
    // (the client and the server treat `parent: ''` as no parent): else Delete asks.
    if (node.parent && (!node.parent.name || getNodeByName(node.parent.name) !== node.parent)) return { ok: false, reason: GROUP_NOT_ADDRESSABLE }
    const t = trees() === true
    const parts = t ? collectSubtree(node).slice(1) : []
    for (const part of parts) {
      if (objectByName(part.name) !== part) return { ok: false, reason: PART_NOT_ADDRESSABLE }
    }
    const r = prepareRestore(gltfNode, { trees: t })
    if (!r.ok) return { ok: false, reason: r.reason }
    return {
      ok: true,
      descriptor: r.descriptor,
      sharedMaterial: r.sharedMaterial === true,
      members: parts.map((part) => ({ name: part.name, handle: handleFor(part) })),
    }
  }

  /** subtree-add T5 — a removed node's parts, as `{ name, handle }` (for a click delete). */
  function partHandles(node) {
    if (!node || trees() !== true) return []
    return collectSubtree(node).slice(1).map((part) => ({ name: part.name, handle: handleFor(part) }))
  }

  /**
   * @param {number} seq
   * @param {{ name: string, duplicate?: boolean, expectParent?: object|null }} opts
   *   `expectParent` (selection-parts T11, N-4): the parent a Duplicate in place
   *   was sent under (null: the scene); when the copy lands elsewhere, the
   *   panel says so. Left out, nothing is checked.
   */
  function registerAdd(seq, { name, duplicate = false, expectParent = undefined }) {
    if (seq == null) return
    requests.set(seq, { kind: 'add', seq, name, duplicate, expectParent })
  }

  /** selection-parts T11 — the handle of a node's parent, or null at the top level. */
  const parentHandle = (node) => (node?.parent ? handleFor(node.parent) : null)

  /**
   * Y2 — a delete's capture begins at the click and is redone on every remote
   * change until the delete's own `som:remove`. `descriptor` is the click-time
   * capture, or null when the node cannot come back (W5).
   */
  function registerDelete(seq, { node, name, descriptor }) {
    if (seq == null) return
    // richer-add R8 — read here from the node (cheap), since the caller passes
    // only the click-time descriptor
    const sharedMaterial = !!descriptor && hasSharedMaterial(node?._node, { trees: trees() === true })
    // selection-parts T11 (must-fix 2) — the parent is read NOW, while the node
    // is alive: `_onRemove` disposes it before this engine hears the answer.
    const req = { kind: 'delete', seq, node, name, descriptor: descriptor ?? null, sharedMaterial, members: partHandles(node), parent: parentHandle(node), failed: false }
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
    // grouping GR7 (the fresh check's must-fix 1, f2) — the re-add will go
    // where the node is NOW: another tab may have moved it since the entry
    // was recorded. reCapture keeps it current until the removal.
    entry.parent = parentHandle(node)
    deleteWindow = {
      kind: 'removal',
      name: node.name,
      node,
      direction,
      entry,
      descriptor: cap.ok ? cap.descriptor : null,
      sharedMaterial: cap.ok && cap.sharedMaterial,
      failed: !cap.ok,
    }
    // richer-add R8 — the entry's note follows the object as it is NOW: after a
    // Delete and an Undo the restored object shares nothing, so its next
    // Undo-of-delete has no note (the entry's descriptor follows R4's re-capture)
    if (cap.ok) {
      entry.sharedMaterial = cap.sharedMaterial
      entry.members = cap.members
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
    req.sharedMaterial = cap.sharedMaterial
    req.members = cap.members
    // grouping GR7 (f2) — and its parent: a node another tab moved while its
    // delete was pending comes back where it was, not where it had been
    req.parent = parentHandle(node)
    // R4 — a removal's entry keeps the descriptor its later re-add will use
    if (req.entry) {
      req.entry.descriptor = cap.descriptor
      req.entry.sharedMaterial = cap.sharedMaterial
      req.entry.members = cap.members
      req.entry.parent = parentHandle(node)
    }
  }

  function acceptAdd(req) {
    const node = getNodeByName(req.name)
    if (!node) { clearRedo(); return }      // nothing to point an entry at
    // selection-parts T11 (N-4) — a Duplicate in place sent under a group that
    // another tab replaced meanwhile lands in the newer node of that name
    if (req.expectParent !== undefined && (node.parent ?? null) !== req.expectParent) {
      message(landedElsewhere(node.name, node.parent?.name ?? ''))
    }
    const cap = capture(node)
    if (!cap.ok) { clearRedo(); return }    // not restorable: not recorded (Y1)
    pushEntry({
      kind: 'add',
      label: req.duplicate ? 'Duplicate' : 'Add',
      name: req.name,
      handle: handleFor(node),
      descriptor: cap.descriptor,
      members: cap.members,
      parent: parentHandle(node),            // selection-parts T11 (§9.5 M1)
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
      sharedMaterial: req.sharedMaterial === true,
      members: req.members ?? [],
      parent: req.parent ?? null,            // selection-parts T11: read at the click
    })
  }

  // ── Answers ────────────────────────────────────────────────────────────

  function onAccepted(seq, info = {}) {
    const req = requests.get(seq)
    if (req && req.kind === 'rename') {
      requests.delete(seq)
      return renameAccepted(req)
    }
    // grouping GR7 — a composite's move
    if (inFlight?.kind === 'composite' && inFlight.bySeq.get(seq)?.type === 'move') {
      stepAnswered(seq, 'accepted', { applied: info.applied !== false, landed: info.landed ?? null })
      return true
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
    if (inFlight?.kind === 'composite' && inFlight.bySeq.get(seq)?.type === 'move') {
      stepAnswered(seq, 'rejected', { text: text || code || 'refused' })
      return true
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
    if (inFlight?.kind === 'composite' && inFlight.bySeq.has(seq)) {
      // the session is ending; the stacks go with it (W7)
      inFlight = null
      deleteWindow = null
      requests.clear()
      clearBoth()
      return true
    }
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
    if (request.undo && inFlight?.kind === 'composite' && inFlight.bySeq.has(request.seq)) {
      const removal = deleteWindow && deleteWindow.kind === 'removal' && deleteWindow.entry === inFlight.entry ? deleteWindow : null
      const removalFailed = !!removal && removal.failed
      if (removal) deleteWindow = null
      if (status === 'unknown') {
        inFlight = null
        deleteWindow = null
        requests.clear()
        clearBoth()
        return true
      }
      const outcome = status === 'accepted'
        ? (removedMessage === 'replaced' ? 'replaced' : removalFailed ? 'changed' : 'accepted')
        : 'rejected'
      stepAnswered(request.seq, outcome, { text })
      return true
    }
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
    const base = `${kind === 'undo' ? 'Undo' : 'Redo'} ${entry.label} “${entry.name}”`
    // richer-add R8 — only an undo of a delete restores; Redo needs no text
    return kind === 'undo' && entry.kind === 'delete' && entry.sharedMaterial ? `${base} ${SHARED_MATERIAL_NOTE}` : base
  }


  // ── grouping GR7 — Move to, Group and Ungroup ──────────────────────────

  /** Where a node is now, as a move entry keeps it (exact copies of the vectors). */
  function placeOf(node) {
    return {
      parent: parentHandle(node),
      translation: copyValue(node.translation),
      rotation: copyValue(node.rotation),
      scale: copyValue(node.scale),
    }
  }
  /** The wire value for a place: the parent by its CURRENT name (the handle follows renames and re-adds). */
  function valueFor(place) {
    return {
      parent: place.parent ? place.parent.node?.name ?? null : null,
      translation: copyValue(place.translation),
      rotation: copyValue(place.rotation),
      scale: copyValue(place.scale),
    }
  }
  /** Addressable: the node of its own non-empty name in the objects namespace. */
  const addressable = (node) => !!node && !!node.name && objectByName(node.name) === node && getNodeByName(node.name) === node
  /** A place's parent is still there to go back to (null: the top level always is). */
  const placeParentOk = (place) => !place.parent || addressable(place.parent.node)
  /** The node is where `place` says, exactly (GR7: parent by identity, the three vectors bitwise). */
  function isAt(node, place) {
    if ((node.parent ?? null) !== (place.parent ? place.parent.node : null)) return false
    return same(node.translation, place.translation) && same(node.rotation, place.rotation) && same(node.scale, place.scale)
  }
  /** GR4 and GR-L10, the server's rules the client can predict for one move. */
  function moveRuleProblem(node, parent) {
    if (parent && treeBoundsProblem(moveCounts(node, parent))) return BOUNDS_REASON
    if (behaviorAncestorsChange(node, parent)) return 'this would change which behaviours can move it'
    return null
  }
  /** A group's own fields still match what was added (GR7: "its own capture without children"). */
  function groupOwnMatches(group, descriptor) {
    if (!descriptor || group.name !== descriptor.name) return false
    if (group._node?.getMesh?.()) return false
    if (!same(group.translation, descriptor.translation ?? [0, 0, 0])) return false
    if (!same(group.rotation, descriptor.rotation ?? [0, 0, 0, 1])) return false
    if (!same(group.scale, descriptor.scale ?? [1, 1, 1])) return false
    return stableJson(group.extras ?? {}) === stableJson(descriptor.extras ?? {})
  }

  /** W4 for the three new kinds: is the world still the way this entry left it? */
  function checkComposite(entry, direction) {
    const verb = direction === 'undo' ? 'Can’t undo' : 'Can’t redo'
    const changed = (name) => ({ ok: false, message: `${verb}: “${name}” was changed elsewhere.` })
    const removed = (name) => ({ ok: false, message: `${verb}: “${name}” was removed.` })
    const bounds = (name, text) => ({ ok: false, message: `${verb}: “${name}” ${text}.` })

    if (entry.kind === 'move') {
      const node = entry.handle.node
      const here = direction === 'undo' ? entry.to : entry.from
      const there = direction === 'undo' ? entry.from : entry.to
      if (!alive(node)) return removed(entry.name)
      if (!addressable(node) || !isAt(node, here)) return changed(entry.name)
      if (!placeParentOk(there)) return changed(entry.name)
      const rule = moveRuleProblem(node, there.parent ? there.parent.node : null)
      if (rule) return bounds(entry.name, rule)
      return { ok: true }
    }

    if (entry.kind === 'group') {
      const object = entry.object.handle.node
      if (!alive(object)) return removed(entry.object.name)
      if (direction === 'undo') {
        const group = entry.handle.node
        if (!alive(group)) return removed(entry.name)
        if (!addressable(group) || !addressable(object)) return changed(entry.name)
        const kids = group.children
        if (kids.length !== 1 || kids[0] !== object) return changed(entry.name)
        if (!groupOwnMatches(group, entry.descriptor)) return changed(entry.name)
        if (!isAt(object, entry.object.to)) return changed(entry.object.name)
        if (!placeParentOk(entry.object.from)) return changed(entry.object.name)
        const rule = moveRuleProblem(object, entry.object.from.parent ? entry.object.from.parent.node : null)
        if (rule) return bounds(entry.object.name, rule)
        return { ok: true }
      }
      if (!addressable(object) || !isAt(object, entry.object.from)) return changed(entry.object.name)
      if (entry.parent && !addressable(entry.parent.node)) return changed(entry.name)
      const check = checkNewName(entry.descriptor.name)
      if (check && !check.ok) return { ok: false, message: `${verb}: “${entry.name}” the name is in use.` }
      if (treeBoundsProblem(regroupCounts(entry.parent ? entry.parent.node : null, [object]))) return bounds(entry.name, BOUNDS_REASON)
      return { ok: true }
    }

    // ungroup
    const parts = entry.parts.map((p) => p.handle.node)
    for (let i = 0; i < parts.length; i++) {
      if (!alive(parts[i])) return removed(entry.parts[i].name)
      if (!addressable(parts[i])) return changed(entry.parts[i].name)
    }
    const group = entry.handle.node
    if (direction === 'undo') {
      for (let i = 0; i < parts.length; i++) if (!isAt(parts[i], entry.parts[i].to)) return changed(entry.parts[i].name)
      if (entry.partial) {
        if (!alive(group) || !addressable(group)) return changed(entry.name)
        for (const part of parts) {
          const rule = moveRuleProblem(part, group)
          if (rule) return bounds(entry.name, rule)
        }
        return { ok: true }
      }
      if (entry.parent && !addressable(entry.parent.node)) return changed(entry.name)
      const check = checkNewName(entry.descriptor.name)
      if (check && !check.ok) return { ok: false, message: `${verb}: “${entry.name}” the name is in use.` }
      if (treeBoundsProblem(regroupCounts(entry.parent ? entry.parent.node : null, parts))) return bounds(entry.name, BOUNDS_REASON)
      return { ok: true }
    }
    if (!alive(group)) return removed(entry.name)
    if (!addressable(group)) return changed(entry.name)
    for (let i = 0; i < parts.length; i++) if (!isAt(parts[i], entry.parts[i].from)) return changed(entry.parts[i].name)
    if (!entry.partial) {
      const kids = group.children
      if (kids.length !== parts.length || kids.some((k) => !parts.includes(k))) return changed(entry.name)
      if (!groupOwnMatches(group, entry.descriptor)) return changed(entry.name)
    }
    return { ok: true }
  }

  // The composite runner. One phase at a time; a phase's requests go together
  // and it is done when every seq is answered (GR7's accounting).

  function sendMoveStep(node, value) {
    const seq = move(node, value, inFlight.direction)
    if (seq == null) return false
    inFlight.bySeq.set(seq, { type: 'move', field: 'parent', node, value })
    return true
  }
  function sendAddStep(descriptor, parentName) {
    const seq = structural({ kind: 'add', name: descriptor.name, descriptor, parent: parentName ?? null }, inFlight.direction)
    if (seq == null) return false
    inFlight.bySeq.set(seq, { type: 'add', field: null, name: descriptor.name })
    return true
  }
  /** A group's removal: through the capture window (GR7, second review N5), unless `window` is false (Group's own cleanup). */
  function sendRemoveStep(node, { window = true } = {}) {
    const req = { kind: 'delete', name: node.name, node, subtree: collectSubtree(node) }
    const seq = structural(req, inFlight.direction)
    if (seq == null) return false
    inFlight.bySeq.set(seq, { type: 'remove', field: null, node })
    if (window) {
      openRemovalWindow(inFlight.entry, inFlight.direction, node)
      if (deleteWindow?.descriptor) inFlight.entry.descriptor = deleteWindow.descriptor
    }
    return true
  }

  function startComposite(direction, entry, phases, onPhase, { record = true, hold = null } = {}) {
    inFlight = { kind: 'composite', direction, entry, phases, onPhase, phase: 0, bySeq: new Map(), outcomes: [], record }
    holdNode(hold)
    runPhase()
  }

  /** A later step that couldn't be sent: its stand-in refusal text. */
  const UNSENT_TEXT = 'another request was still waiting for the server'

  function runPhase() {
    const c = inFlight
    c.outcomes = []
    const sent = c.phases[c.phase]()
    if (inFlight !== c) return
    if (!sent && c.bySeq.size === 0) {
      if (c.phase > 0) {
        // a later step couldn't be sent (another structural request held the
        // page's one slot: the code check's must-fix 1). The composite stops as
        // if the server had refused that step, so what was done is recorded or
        // stopped by the same rules (GR-L7 (a)), and nothing waits forever.
        c.outcomes = [{ type: 'unsent', node: null, status: 'rejected', text: UNSENT_TEXT }]
        phaseDone()
        return
      }
      // nothing could be sent (the app reported why): the step stops here
      inFlight = null
      return
    }
    if (c.bySeq.size === 0) phaseDone()
  }

  function stepAnswered(seq, status, info = {}) {
    const c = inFlight
    const step = c.bySeq.get(seq)
    c.bySeq.delete(seq)
    if (step.type === 'move' && status === 'accepted' && info.applied === false) {
      // U15 for a move: accepted, but this tab's SOM couldn't apply it, so this
      // window no longer matches the server
      inFlight = null
      deleteWindow = null
      clearBoth()
      message(OUT_OF_STEP_MESSAGE)
      return
    }
    c.outcomes.push({ ...step, status, ...info })
    if (c.bySeq.size === 0) phaseDone()
  }

  function phaseDone() {
    const c = inFlight
    const verdict = c.onPhase(c.phase, c.outcomes)
    if (inFlight !== c) return
    if (verdict === 'next') { c.phase += 1; runPhase() } else if (verdict === 'retry') runPhase()
  }

  /** The original action is done: record it, or (asked first: GR-L5 (a)) not, clearing Redo (W5). */
  function finishDo(entry, selectNode) {
    const record = inFlight.record
    inFlight = null
    if (record) pushEntry(entry); else clearRedo()
    select({ node: alive(selectNode) ? selectNode : null, removed: null })
  }
  /** An undo or a redo is done: the entry moves (Y4). */
  function finishRun(selectNode) {
    const { direction, entry } = inFlight
    inFlight = null
    moveEntry(entry, direction)
    select({ node: alive(selectNode) ? selectNode : null, removed: null })
  }
  /** GR-L7 (a) — an undo or a redo the server stopped: say which, drop the entry. */
  function stopRun(names, text) {
    const { direction } = inFlight
    dropEntry()
    inFlight = null
    message(stoppedMessage(direction, names, text))
  }
  const refused = (outs) => outs.filter((o) => o.status !== 'accepted')
  const firstText = (outs) => refused(outs)[0]?.text ?? null

  /** Did the move land where it was sent? If not (a race), say so and record where it landed (N-4). */
  function noteLanding(node, place) {
    const wanted = place.parent ? place.parent.node : null
    if ((node.parent ?? null) !== wanted) {
      message(landedElsewhere(node.name, node.parent?.name ?? ''))
      place.parent = parentHandle(node)
    }
  }

  // ── The original actions (the panel's buttons) ──

  /**
   * Move to: `node` under `parent` (a SOM node, or null) with `value`'s vectors.
   * `record: false` when the panel asked first (GR-L5 (a)): not recorded.
   * @returns {boolean} started
   */
  function moveTo(node, parent, value, { record = true } = {}) {
    if (busyReason() !== null) return false
    const entry = {
      kind: 'move', label: 'Move to', name: node.name, handle: handleFor(node),
      from: placeOf(node),
      to: { parent: parent ? handleFor(parent) : null, translation: copyValue(value.translation), rotation: copyValue(value.rotation), scale: copyValue(value.scale) },
    }
    startComposite('do', entry, [() => sendMoveStep(node, valueFor(entry.to))], (phase, outs) => {
      if (outs[0].status !== 'accepted') {
        inFlight = null
        message(`Couldn’t move “${entry.name}”: ${outs[0].text ?? 'refused'}`)
        return 'stop'
      }
      noteLanding(node, entry.to)
      finishDo(entry, node)
      return 'done'
    }, { record, hold: node })
    return true
  }

  /**
   * Group: `plan` is edit-group.js's `groupPlan(node)`. The group's `add`, then,
   * once it is accepted, the object's move (an `add` refused because the name
   * is taken retries once with the next free name). A refused move removes the
   * empty group again, and nothing is recorded.
   */
  function group(node, plan, { record = true } = {}) {
    if (busyReason() !== null) return false
    const parent = plan.parent ?? null
    let addDescriptor = { ...plan.descriptor }
    let retried = false
    let failure = null
    const entry = {
      kind: 'group', label: 'Group', name: addDescriptor.name, handle: null, descriptor: null,
      parent: parent ? handleFor(parent) : null,
      object: {
        name: node.name, handle: handleFor(node), from: placeOf(node),
        to: { parent: null, translation: copyValue(plan.objectValue.translation), rotation: copyValue(plan.objectValue.rotation), scale: copyValue(plan.objectValue.scale) },
      },
    }
    const phases = [
      () => sendAddStep(addDescriptor, parent ? parent.name : null),
      () => sendMoveStep(node, valueFor(entry.object.to)),
      () => sendRemoveStep(entry.handle.node, { window: false }),
    ]
    startComposite('do', entry, phases, (phase, outs) => {
      const o = outs[0]
      if (phase === 0) {
        if (o.status !== 'accepted') {
          if (!retried && /already in use/.test(o.text ?? '')) {
            const name = freeName(addDescriptor.name)
            if (name) { retried = true; addDescriptor = { ...addDescriptor, name }; return 'retry' }
          }
          inFlight = null
          message(`Couldn’t group: ${o.text ?? 'refused'}`)
          return 'stop'
        }
        const fresh = getNodeByName(addDescriptor.name)
        if (!fresh) { inFlight = null; clearRedo(); message(OUT_OF_STEP_MESSAGE); return 'stop' }
        entry.handle = handleFor(fresh)
        entry.name = fresh.name
        const cap = capture(fresh)
        entry.descriptor = cap.ok ? cap.descriptor : { ...addDescriptor }
        entry.object.to.parent = entry.handle
        return 'next'
      }
      if (phase === 1) {
        if (o.status !== 'accepted') {
          failure = o.text ?? 'refused'
          if (alive(entry.handle.node)) return 'next'        // remove the empty group again
          inFlight = null
          message(`Couldn’t group: ${failure}`)
          return 'stop'
        }
        noteLanding(node, entry.object.to)
        finishDo(entry, entry.handle.node)
        return 'done'
      }
      inFlight = null                                        // the cleanup's answer
      message(`Couldn’t group: ${failure}`)
      return 'stop'
    }, { record, hold: node })
    return true
  }

  /**
   * Ungroup: `plan` is edit-group.js's `ungroupPlan(group)`. Every part's move
   * together; once every one is accepted, the group's `remove` through the
   * capture window. A part the server refuses stays, and so does the group:
   * the accepted moves are recorded as "Ungroup (partly)" (GR-L7 (a)).
   */
  function ungroup(groupNode, plan, { record = true } = {}) {
    if (busyReason() !== null) return false
    const toParent = groupNode.parent ? handleFor(groupNode.parent) : null
    const entry = {
      kind: 'ungroup', label: 'Ungroup', name: groupNode.name, handle: handleFor(groupNode), descriptor: null,
      parent: toParent, partial: false,
      parts: plan.parts.map(({ node, value }) => ({
        name: node.name, handle: handleFor(node), from: placeOf(node),
        to: { parent: toParent, translation: copyValue(value.translation), rotation: copyValue(value.rotation), scale: copyValue(value.scale) },
      })),
    }
    const first = entry.parts[0]?.handle.node ?? null
    const phases = [
      () => entry.parts.every((p) => sendMoveStep(p.handle.node, valueFor(p.to))) || inFlight.bySeq.size > 0,
      () => sendRemoveStep(groupNode),
    ]
    startComposite('do', entry, phases, (phase, outs) => {
      if (phase === 0) {
        const bad = refused(outs)
        if (bad.length === 0) {
          for (const p of entry.parts) noteLanding(p.handle.node, p.to)
          return 'next'
        }
        const stayed = new Set(bad.map((o) => o.node))
        const moved = entry.parts.filter((p) => !stayed.has(p.handle.node))
        const names = entry.parts.filter((p) => stayed.has(p.handle.node)).map((p) => `“${p.name}”`).join(', ')
        if (moved.length === 0) {
          inFlight = null
          message(`Couldn’t ungroup: ${firstText(outs) ?? 'refused'}`)
          return 'stop'
        }
        entry.parts = moved
        entry.partial = true
        entry.label = 'Ungroup (partly)'
        message(`Ungroup stopped: ${names} stayed in the group (${firstText(outs) ?? 'refused'}).`)
        finishDo(entry, moved[0].handle.node)
        return 'done'
      }
      const o = outs[0]
      if (o.status === 'accepted' && entry.descriptor) { finishDo(entry, first); return 'done' }
      if (o.status === 'rejected') {
        // the group stays (another tab's delete won, or a refusal): the moves are what happened
        entry.partial = true
        entry.label = 'Ungroup (partly)'
        message(`Couldn’t remove “${entry.name}”: ${o.text ?? 'refused'}`)
        finishDo(entry, first)
        return 'done'
      }
      // removed, but changed while it was being removed (or not capturable): not recorded
      inFlight = null
      clearRedo()
      if (o.status === 'changed') message(DELETE_CHANGED_MESSAGE)
      select({ node: alive(first) ? first : null, removed: null })
      return 'done'
    }, { record, hold: groupNode })
    return true
  }

  // ── Undo and Redo of the three kinds ──

  function startCompositeEntry(entry, direction) {
    if (entry.kind === 'move') {
      const node = entry.handle.node
      const place = direction === 'undo' ? entry.from : entry.to
      startComposite(direction, entry, [() => sendMoveStep(node, valueFor(place))], (phase, outs) => {
        if (outs[0].status !== 'accepted') { stopRun([entry.name], outs[0].text); return 'stop' }
        noteLanding(node, place)
        finishRun(node)
        return 'done'
      }, { hold: node })
      return
    }

    if (entry.kind === 'group') {
      const object = entry.object.handle.node
      if (direction === 'undo') {
        startComposite(direction, entry, [
          () => sendMoveStep(object, valueFor(entry.object.from)),
          () => sendRemoveStep(entry.handle.node),
        ], (phase, outs) => {
          const o = outs[0]
          if (phase === 0) {
            if (o.status !== 'accepted') { stopRun([entry.object.name], o.text); return 'stop' }
            noteLanding(object, entry.object.from)
            return 'next'
          }
          if (o.status === 'accepted') { finishRun(object); return 'done' }
          dropEntry()
          inFlight = null
          message(o.status === 'changed' ? DELETE_CHANGED_MESSAGE : `Couldn’t undo: ${o.text ?? 'refused'}`)
          return 'stop'
        }, { hold: object })
        return
      }
      startComposite(direction, entry, [
        () => sendAddStep(entry.descriptor, entry.parent ? entry.parent.node.name : null),
        () => sendMoveStep(object, valueFor(entry.object.to)),
      ], (phase, outs) => {
        const o = outs[0]
        if (phase === 0) {
          if (o.status !== 'accepted') { failEntry(o.text); return 'stop' }
          // M2 (r5) — the re-added group is a new node: every older entry that
          // points at the group follows it
          const fresh = getNodeByName(entry.descriptor.name)
          if (!fresh) { dropEntry(); inFlight = null; message(OUT_OF_STEP_MESSAGE); return 'stop' }
          repoint(entry.handle, fresh)
          return 'next'
        }
        if (o.status !== 'accepted') { stopRun([entry.object.name], o.text); return 'stop' }
        noteLanding(object, entry.object.to)
        finishRun(entry.handle.node)
        return 'done'
      }, { hold: object })
      return
    }

    // ungroup
    const parts = entry.parts
    const moveAll = (key) => () => parts.every((p) => sendMoveStep(p.handle.node, valueFor(p[key]))) || inFlight.bySeq.size > 0
    const movesDone = (key, outs) => {
      const bad = refused(outs)
      if (bad.length > 0) {
        const stayed = new Set(bad.map((o) => o.node))
        stopRun(parts.filter((p) => stayed.has(p.handle.node)).map((p) => p.name), firstText(outs))
        return false
      }
      for (const p of parts) noteLanding(p.handle.node, p[key])
      return true
    }
    if (direction === 'undo') {
      if (entry.partial) {
        startComposite(direction, entry, [moveAll('from')], (phase, outs) => {
          if (!movesDone('from', outs)) return 'stop'
          finishRun(entry.handle.node)
          return 'done'
        }, { hold: entry.parent ? entry.parent.node : null })
        return
      }
      startComposite(direction, entry, [
        () => sendAddStep(entry.descriptor, entry.parent ? entry.parent.node.name : null),
        moveAll('from'),
      ], (phase, outs) => {
        if (phase === 0) {
          if (outs[0].status !== 'accepted') { failEntry(outs[0].text); return 'stop' }
          const fresh = getNodeByName(entry.descriptor.name)
          if (!fresh) { dropEntry(); inFlight = null; message(OUT_OF_STEP_MESSAGE); return 'stop' }
          repoint(entry.handle, fresh)                       // M2 (r5)
          return 'next'
        }
        if (!movesDone('from', outs)) return 'stop'
        finishRun(entry.handle.node)
        return 'done'
      }, { hold: entry.parent ? entry.parent.node : null })   // at the top level nothing is held (stated)
      return
    }
    const firstPart = parts[0]?.handle.node ?? null
    const phases = [moveAll('to')]
    if (!entry.partial) phases.push(() => sendRemoveStep(entry.handle.node))
    startComposite(direction, entry, phases, (phase, outs) => {
      if (phase === 0) {
        if (!movesDone('to', outs)) return 'stop'
        if (entry.partial) { finishRun(firstPart); return 'done' }
        return 'next'
      }
      const o = outs[0]
      if (o.status === 'accepted') { finishRun(firstPart); return 'done' }
      dropEntry()
      inFlight = null
      message(o.status === 'changed' ? DELETE_CHANGED_MESSAGE : `Couldn’t redo: ${o.text ?? 'refused'}`)
      return 'stop'
    }, { hold: entry.handle.node })
  }

  /** Why Move to, Group or Ungroup can't start now (the engine's own half of the block), or null. */
  function busyReason() {
    if (hasPendingStructural()) return WAITING_MESSAGE
    if (isDragging()) return 'Finish moving the object first'
    if (isRenamePending()) return 'Waiting for the rename…'
    if (hasPendingSend()) return WAITING_MESSAGE
    if (inFlight) return WAITING_MESSAGE
    return null
  }

  // ── The engine (Y4) ────────────────────────────────────────────────────

  /** W4 — is the world still the way this entry left it? */
  function checkEntry(entry, direction) {
    if (entry.kind === 'move' || entry.kind === 'group' || entry.kind === 'ungroup') return checkComposite(entry, direction)
    const node = entry.handle.node
    const name = entry.name
    const verb = direction === 'undo' ? 'Can’t undo' : 'Can’t redo'

    // a re-add is an `add`: the node is gone by definition, so the only check
    // is that the name is free
    const readd = (entry.kind === 'delete' && direction === 'undo') ||
      (entry.kind === 'add' && direction === 'redo')
    if (readd) {
      // selection-parts T11 — a part goes back into its group, which must still
      // be the same node (the handle follows a rename and our own re-add)
      const p = entry.parent?.node ?? null
      if (entry.parent) {
        const holder = p?.name ? getNodeByName(p.name) : null
        if (!p || !p.name || holder !== p) {
          return { ok: false, message: holder ? groupReplaced(verb, name) : groupRemoved(verb, name) }
        }
      }
      const check = checkNewName(entry.descriptor.name)
      if (check && !check.ok) return { ok: false, message: `${verb}: “${name}” the name is in use.` }
      // grouping GR7 (review M1; the code check's finding 4) — the checks
      // before sending include GR4: a re-add into a tree the bounds rule
      // would refuse is not started
      if (p && treeBoundsProblem(moveCounts(null, p, descriptorCounts(entry.descriptor)))) {
        return { ok: false, message: `${verb}: “${name}” ${BOUNDS_REASON}.` }
      }
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

    // a remove: undo of an add, or redo of a delete. subtree-add T5: the whole
    // tree's capture is compared (a part added, removed or changed elsewhere
    // makes it differ); without trees, a node that has grown children can't be
    // captured, so it is "changed elsewhere" as before.
    // selection-parts T11 (SP-L5 (a)) — compared canonically: a part re-added
    // last among its siblings doesn't make its group "changed elsewhere"
    const cap = capture(node)
    if (!cap.ok || !sameCanonical(cap.descriptor, entry.descriptor)) {
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
        ? { field: c.field, from: copyValue(node[c.field] ?? c.from), to: c.to }
        : { field: c.field, from: c.from, to: copyValue(node[c.field] ?? c.to) }))
    }
    const readded = (kind === 'add' && direction === 'redo') || (kind === 'delete' && direction === 'undo')
    const removed = (kind === 'add' && direction === 'undo') || (kind === 'delete' && direction === 'redo')
    if (readded) {
      // a re-add: the handle follows the new node (it is in the SOM before
      // edit:accepted), so older entries for the node follow it too (W2)
      const fresh = getNodeByName(entry.descriptor.name)
      if (fresh) repoint(entry.handle, fresh)
      // selection-parts T11 (N-4) — a group replaced while the re-add was in
      // flight: it landed in the newer node of that name. Say so, and record
      // the entry against where it landed (the old handle stays the group's).
      if (fresh && entry.parent && (fresh.parent ?? null) !== entry.parent.node) {
        message(landedElsewhere(fresh.name, fresh.parent?.name ?? ''))
        entry.parent = parentHandle(fresh)
      }
      // subtree-add T5 (S3) — and every part's handle follows the part that
      // came back, by name (unique within a tree, T1), so an older entry for a
      // part (an Alt-clicked move) still undoes.
      if (fresh) {
        const inTree = new Set(collectSubtree(fresh))
        for (const { name: partName, handle } of entry.members ?? []) {
          const part = getNodeByName(partName)
          if (part && inTree.has(part)) repoint(handle, part)
        }
      }
    }
    const removedNode = removed ? entry.handle.node : null
    moveEntry(entry, direction)
    // W10 (R5) — tell the panel what changed. A re-add hands over the new node
    // (the panel selects it with J6's next-frame retry); a removal hands over
    // the removed node, so the panel clears the selection only when that very
    // node was the selected one — a delete must not deselect another object.
    select(removed
      ? { node: null, removed: removedNode }
      : { node: alive(entry.handle.node) ? entry.handle.node : null, removed: null })
  }

  /** A refusal: the entry is dropped. Nothing of this tab's was confirmed. */
  function failEntry(text) {
    const { direction, entry } = inFlight
    dropEntry()
    inFlight = null
    // selection-parts T11 — the server refuses a re-add whose parent is gone
    // (renamed or removed by another tab after the send) as NODE_NOT_FOUND
    if (entry?.parent && /^NODE_NOT_FOUND\b/.test(text ?? '')) {
      message(groupRenamedOrRemoved(direction === 'undo' ? 'Can’t undo' : 'Can’t redo', entry.name))
      return
    }
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
    if (entry.kind === 'move' || entry.kind === 'group' || entry.kind === 'ungroup') { startCompositeEntry(entry, direction); return }

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
      const seq = structural({ kind: 'add', name: entry.descriptor.name, descriptor: entry.descriptor, parent: entry.parent?.node?.name ?? null }, direction)
      if (seq == null) return
      inFlight = { direction, entry, kind: 'add', bySeq: new Map([[seq, { field: null }]]) }
      return
    }
    if (entry.kind === 'delete' && direction === 'undo') {
      const seq = structural({ kind: 'add', name: entry.descriptor.name, descriptor: entry.descriptor, parent: entry.parent?.node?.name ?? null }, direction)
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
    // grouping GR7 — the panel's three structural actions
    moveTo,
    group,
    ungroup,
    busyReason,
    // the engine
    run,
    reason,
    label,
    inFlight: () => !!inFlight,
    /** grouping GR8 — an original Move to, Group or Ungroup is in flight (not an undo or a redo). */
    doing: () => inFlight?.kind === 'composite' && inFlight.direction === 'do',
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
