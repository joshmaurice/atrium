// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * behavior-form.js — the Edit panel's Behaviour section (scripting-4b-2, F9).
 * Pure: no DOM of its own beyond the elements it is handed and the
 * `createElement` dep, no three.js, no fetch. `app.js` is wiring only.
 *
 * The one rule worth reading twice (Rev 2, M4): **Save is a SEQUENCE bound to a
 * snapshot and a generation.** The form records the behaviour node, the target
 * and their ids at Save, plus a generation; each stage goes out only while the
 * generation is current and both nodes are still alive and selected as they
 * were. A selection change, Edit off (the gate), `connecting`, `disconnected`
 * or the target's removal bumps the generation, and no further stage is sent.
 * An answer to a stage already sent is resolved as usual — the id a node got is
 * harmless on its own — and nothing continues.
 */

import {
  templateGraph, TEMPLATE_IDS, TEMPLATE_LABELS, TEMPLATE_FIELDS, TEMPLATE_ACTIONS, TEMPLATE_DEFAULTS,
} from '@atrium/behaviors/templates'
import {
  behaviorReasonText, behaviorCheck,
  BEHAVIOR_PROX_MIN, BEHAVIOR_PROX_MAX, BEHAVIOR_INTERVAL_MIN, BEHAVIOR_INTERVAL_MAX,
} from '@atrium/behaviors/behavior-spec'

export const NONE_LABEL = 'None'
export const CUSTOM_LABEL = 'Custom graph'

/**
 * X1 (round 7) — each parameter's label. The section shows WORDS, never the raw
 * key: in the 250 px panel `target `, `clip ` and the rest read as one run of
 * text, and the operator took the target `<select>` for the clip list (§1.2
 * item 1).
 */
export const FIELD_LABELS = Object.freeze({
  target: 'Target',
  clip: 'Clip',
  action: 'Action',
  loop: 'Loop',
  radius: 'Radius (m)',
  seconds: 'Every (s)',
})

/** X2 (round 7) — a loaded model with no clips has nothing to offer. */
export const NO_ANIMATIONS = 'This model has no animations'

/** X2 — the clip text box's placeholder, for clips the host doesn't know yet. */
export const CLIP_PLACEHOLDER = 'clip name'

/** X4 (round 7) — the placeholder option a select gets when nothing is held. */
export const CHOOSE_TARGET = 'Choose a target…'
export const CHOOSE_CLIP = 'Choose a clip…'

/** A form error the pre-stage check raises: F1's own plain text, prefixed. */
export const CANT_SAVE = "Can't save: "

/** D4 — the one line under the status, shown once. */
export const UNDO_NOTE = 'Behaviour changes are saved with the world and aren’t undone by Undo.'

/** R1 — the generic hint, shown under the picker for every template. */
export const HINT_TEXT = 'Behaviour changes are saved with the world.'

/** R1 (C2) — the sentence appended to the hint for `select-light` ONLY. */
export const HINT_LIGHT_ON = 'If the light was off when you saved, \'on\' uses intensity 1.'

/**
 * T1 (F8, N7) — the toggling templates' help line. A toggle reads the SOM,
 * which the echo updates, so two clicks inside one round trip collapse to one
 * change; the line is what stops the owner double-clicking.
 */
export const HINT_ONE_CLICK = 'One click per change.'

/**
 * T1 (F4) — the three animation templates' help line: a clip's end triggers
 * nothing (`done` never fires in 4b-2).
 */
export const HINT_CLIP_END = 'A clip\'s end doesn\'t trigger anything.'

/**
 * T1 (F8) — the light template's picker sentence, when the world has no
 * lights to offer. It renders in the hint element with that template's other
 * lines (`elements.noLights` was a second, unwired path and stays a no-op).
 */
export const NO_LIGHTS = 'This world has no lights'

/**
 * X3 (round 7) — the field check's texts, in the order the check gives them.
 * The two bounds are the imported limits, never retyped (§1.2 item 3: the
 * owner read F1's code-level ``animations is malformed`` instead of a plain
 * sentence about the field).
 */
export const FIELD_TEXTS = Object.freeze({
  noLights: NO_LIGHTS,
  noTarget: 'Choose a target',
  noAnimations: NO_ANIMATIONS,
  noClip: 'Choose a clip',
  emptyClip: 'Type a clip name',
  radius: `Radius must be from ${BEHAVIOR_PROX_MIN} to ${BEHAVIOR_PROX_MAX} m`,
  seconds: `The interval must be from ${BEHAVIOR_INTERVAL_MIN} to ${BEHAVIOR_INTERVAL_MAX} seconds`,
})


/** F9 — the status texts. */
export const BEHAVIOR_STATUS = Object.freeze({
  running: 'Running',
  idle: 'Not running: this tab isn’t the script host',
  otherTab: 'Behaviours run in another tab; clicks here don’t trigger them',
  saving: 'Saving…',
  cancelled: 'Save cancelled',
  // W3 (round 6) — the stored value changed under an unsaved edit.
  changed: 'Changed in another tab',
})

/**
 * W4 (round 6) — the panel's text for each of the runner's disable reasons.
 * The runner's codes don't change; only what the panel shows does.
 */
export function disabledReasonText(reason) {
  if (!reason) return ''
  const text = String(reason)
  if (text === 'disabled') return 'turned off'
  if (text.startsWith('invalid:')) return behaviorReasonText(text.slice('invalid:'.length).trim())
  if (text === 'not-found') return 'its object can\'t be found'
  if (text.startsWith('target-not-found:')) {
    return `target ${text.slice('target-not-found:'.length).trim()} can't be found`
  }
  if (text.startsWith('rejected:')) {
    return `the graph was refused: ${text.slice('rejected:'.length).trim()}`
  }
  if (text === 'over-budget') return 'it did too much work in one frame'
  if (text === 'over-send-cap') return 'too many changes were waiting to be sent'
  return text
}

/** Which targets a template's picker offers (F8). */
export function targetKindFor(templateId) {
  if (templateId === 'select-animation' || templateId === 'proximity-animation' || templateId === 'interval-animation') return 'model'
  if (templateId === 'select-light') return 'light'
  return 'any'
}

/**
 * W2 (round 6) — what the Behaviour row does when the Edit panel refreshes.
 * Exported so the DECISION is testable without app.js: `open` (which re-reads
 * the leaf) whenever the selection changed or the form is closed — the bug was
 * relying on the selection alone, so Edit off → Edit on with the same object
 * still selected left the section closed; `reread` when a `som:set` says the
 * stored leaf may have moved under the same selection; `render` otherwise.
 */
export function behaviorRowAction({ open, lastNode = null, selected, reread = false } = {}) {
  if (!open) return 'open'
  if (selected !== lastNode) return 'open'
  return reread ? 'reread' : 'render'
}

/** F9 — a saved value is the template's own output, or it is "Custom graph". */
export function matchesTemplate(value, ownId) {
  if (!value?.template?.id) return false
  const rebuilt = templateGraph(value.template.id, value.template.params, { ownId })
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  return same(rebuilt.graph, value.graph)
    && same(rebuilt.nodeMap, value.nodeMap)
    && same(rebuilt.targets, value.targets)
    && same(rebuilt.animations, value.animations)
    && same(rebuilt.proximity, value.proximity)
    && same(rebuilt.interval, value.interval)
}

const isAvatar = (node) => node?.extras?.atrium?.ephemeral === true

/**
 * @param {object} args
 * @param {object} args.elements   the section's elements (see render())
 * @param {object} args.deps
 * @param {() => object|null} args.deps.selected       the selected SOM node
 * @param {() => Array<object>} args.deps.nodes        every saved node
 * @param {({from, to}) => boolean} [args.deps.moveNode]  n/a — ids never change
 * @param {() => {state: string, reason?: string}} [args.deps.status]  the runner's view
 * @param {(objectId: string) => Array<string>|undefined} [args.deps.clipIds]  the host's clips
 * @param {object} args.deps.write                    `{ setObjectId, sendField }`
 * @param {() => string} [args.deps.newObjectId]
 * @param {(element: object) => void} [args.deps.focus]
 * @param {(text: string) => void} [args.deps.showError]
 * @param {() => void} [args.deps.clearError]
 * @param {object} [args.gate]
 * @param {string} [args.name]
 */
export function createBehaviorForm({ elements = {}, deps = {}, gate = null, name = 'behavior' } = {}) {
  const doc = deps.document ?? (typeof document === 'undefined' ? null : document)
  const create = deps.createElement ?? ((tag) => doc?.createElement?.(tag) ?? null)

  const state = {
    open: false,
    node: null,
    template: NONE_LABEL,
    targetId: null,
    params: {},
    saved: null,          // the node's stored `extras.atrium.behavior`, or null
    custom: false,
    enabled: true,
    status: '',
    error: null,
    saving: false,
    // X2/X4 (round 7) — the target's clips as this render sees them:
    // `{ known, clipIds }`. `known` is false until the host says.
    clip: { known: false, clipIds: [] },
    generation: 0,
    sequence: null,       // the snapshot Save is bound to
    pending: null,        // { seq, stage, generation }
    // W3 — the picker/params the form last READ, so an unsaved edit is visible.
    baseline: { template: NONE_LABEL, custom: false, params: {} },
  }

  const show = (element, visible) => { if (element) element.style.display = visible ? '' : 'none' }
  const text = (element, value) => { if (element) element.textContent = value ?? '' }

  /**
   * V1 — a form field's `data-field`, written as a PROPERTY of the live
   * `dataset` map (`field.dataset.field = …`), never by assigning `dataset`
   * itself: `DOMStringMap` has only a getter, and
   * `field.dataset = { … }` throws `TypeError` in a real page (round 5 §1.2
   * item 1). Every `dataset` write in this file obeys that rule, and
   * `behavior-wiring.test.js` guards it for the whole of `apps/client/src`.
   */
  const setDataField = (element, field) => { if (element) element.dataset.field = field }

  // -------------------------------------------------------------------------
  // Reading the SOM
  // -------------------------------------------------------------------------

  const ownId = () => state.node?.extras?.atrium?.objectId ?? null
  const nodeById = (id) => {
    if (!id) return null
    const nodes = deps.nodes?.() ?? []
    // The picker lists a node without an id by name (`name:<name>`), because
    // Save gives it an id first (F9).
    if (String(id).startsWith('name:')) {
      const name = String(id).slice(5)
      return nodes.find((n) => n.name === name) ?? null
    }
    return nodes.find((n) => n.extras?.atrium?.objectId === id) ?? null
  }
  const targetNode = () => nodeById(state.targetId)

  /** Every saved, addressable node the picker may offer, minus avatars. */
  function pickable() {
    const kind = targetKindFor(state.template)
    return (deps.nodes?.() ?? []).filter((node) => {
      if (!node || isAvatar(node)) return false
      if (kind === 'light' && !node.light) return false
      if (kind === 'model' && !node.extras?.atrium?.model) return false
      return true
    })
  }

  /**
   * X2 (round 7) — the target's clips, as `{ known, clipIds }`. `known` is
   * FALSE while the host hasn't answered (the load is still running, or there
   * is no record yet): that is the text box's case. `known` with an EMPTY list
   * is a loaded model with no animations at all (a library model), which is
   * §1.2 item 2 — it used to fall back to the text box and Save sent `''`.
   */
  function clipInfoFor(node) {
    const id = node?.extras?.atrium?.objectId ?? null
    const ids = id ? deps.clipIds?.(id) : undefined
    return Array.isArray(ids) ? { known: true, clipIds: ids } : { known: false, clipIds: [] }
  }

  /**
   * V11 — a node's value in the target picker: its own id, or `name:<name>` for
   * a node that has none yet (Save gives it one first). The picker's option
   * values and `state.targetId` are always the same string, so the select and
   * the form can never disagree.
   */
  const pickerValue = (node) => (node ? (node.extras?.atrium?.objectId ?? `name:${node.name}`) : null)

  // -------------------------------------------------------------------------
  // Open / close
  // -------------------------------------------------------------------------

  function defaultsFor(id, target) {
    const params = { target: pickerValue(target) }
    for (const key of TEMPLATE_FIELDS[id]) {
      if (key === 'target') continue
      if (key === 'action') params.action = TEMPLATE_ACTIONS[id][0]
      else if (key === 'loop') params.loop = TEMPLATE_DEFAULTS.loop
      else if (key === 'radius') params.radius = TEMPLATE_DEFAULTS.radius
      else if (key === 'seconds') params.seconds = TEMPLATE_DEFAULTS.seconds
      else if (key === 'clip') params.clip = clipInfoFor(target).clipIds[0] ?? ''
      else if (key === 'intensity') params.intensity = lightIntensity(target)
    }
    return params
  }

  function lightIntensity(node) {
    const value = node?.light?.intensity
    // C2 — a light saved at 0 (off), or one whose intensity is missing or
    // non-finite, gets `I = 1`, not 0.01: "on" must actually turn it on. Every
    // other saved intensity is kept as it was, floored at 0.01 (F8's "a
    // literal, at least 0.01") — so 0.005 becomes 0.01, not 1.
    if (typeof value !== 'number' || !Number.isFinite(value)) return 1
    if (value === 0) return 1
    return value >= 0.01 ? value : 0.01
  }

  function open(node = deps.selected?.()) {
    state.node = node ?? null
    state.open = Boolean(node)
    state.error = null
    state.status = null
    // M4 — a selection change ends any Save sequence in flight. `bump` keeps
    // the pending answer so a late one can still be recognised as stale.
    bump()
    if (!node) { render(); return }
    readStored(node)
    // V13 — the Behaviour section is NOT one of the gate's mutually exclusive
    // forms: it is part of the Edit panel and is shown with every selection, so
    // opening it must never close the library grid, the Model form or the
    // destination form. `gate.claim(name)` used to run on every refresh (which
    // closed the grid after a library placement — library-sky's c23/c4), and
    // `close()` no longer releases, because nothing was ever claimed.
    // `setEditMode(false)` closes the section explicitly instead.
    render()
  }

  /**
   * Read the node's stored leaf into the form's state. `open` calls it, and so
   * does W3's re-read: template or Custom graph, params, target, Enabled.
   */
  function readStored(node) {
    const saved = node?.extras?.atrium?.behavior ?? null
    state.saved = saved
    state.enabled = saved ? saved.enabled !== false : true
    if (!saved) {
      state.template = NONE_LABEL
      state.custom = false
      state.params = {}
      state.targetId = null
    } else if (matchesTemplate(saved, ownId())) {
      state.template = saved.template.id
      state.custom = false
      state.params = { ...saved.template.params }
      state.targetId = saved.template.params.target ?? null
    } else {
      // F9 — a `template`-less value (4d's imports), or one whose params no
      // longer regenerate it, shows "Custom graph" with Enabled and Remove only.
      state.template = CUSTOM_LABEL
      state.custom = true
      state.params = {}
      state.targetId = null
    }
    // W3 — what the form last READ. An unsaved edit is the current selection
    // and params differing from this.
    state.baseline = { template: state.template, custom: state.custom, params: { ...state.params } }
  }

  /** W3 — has the owner changed the picker or a parameter without saving? */
  const unsavedEdit = () => state.template !== state.baseline.template
    || state.custom !== state.baseline.custom
    || JSON.stringify(state.params) !== JSON.stringify(state.baseline.params)

  /**
   * W3 (round 6) — a `som:set` of the selected node's leaf (or `extras`, or
   * `name`): re-read the STORED value, exactly as `open` does, so the form is
   * never left showing a value the world no longer has. Calling `render()`
   * alone redrew the form's own stale copy — the picker still showed a Removed
   * template, a behaviour written under an already-selected object opened as
   * "None", and another tab's change was invisible (§1.2 item 3).
   *
   * EXCEPT while this form's OWN write is in flight — a Save's stages,
   * Enabled, Remove: those writes' echoes arrive here first, and they must not
   * bump the generation or cancel the sequence (M4's rules). The sequence's own
   * answer re-reads once when it ends (see `onAnswer`).
   */
  function reread() {
    if (!state.open || !state.node) return
    if (state.saving || state.pending) { render(); return }
    const node = state.node
    const incoming = node.extras?.atrium?.behavior ?? null
    const mine = unsavedEdit()
    const changed = JSON.stringify(incoming) !== JSON.stringify(state.saved)
    // `open` re-reads the leaf AND bumps the generation, so a sequence in flight
    // for the OLD stored value is cancelled (M4's rules) — which is why the
    // in-flight exception above exists.
    open(node)
    // W3 — a change from elsewhere while the owner has an unsaved edit: the
    // stored value is shown (an unsaved edit is never silently kept over it),
    // and the status line says so once.
    if (changed && mine) { state.status = BEHAVIOR_STATUS.changed; render() }
  }

  function close() {
    state.open = false
    state.node = null
    // M4 — closing ends any Save sequence in flight.
    bump()
    render()
  }

  function bump() {
    state.generation += 1
    state.saving = false
    state.sequence = null
  }

  /** `connecting`, `disconnected`, a world change: the form resets (F9). */
  function reset() {
    state.saved = null
    state.params = {}
    state.targetId = null
    state.template = NONE_LABEL
    state.custom = false
    state.error = null
    bump()
    render()
  }

  // -------------------------------------------------------------------------
  // The template picker and the parameter fields
  // -------------------------------------------------------------------------

  function onTemplateChange(id) {
    state.error = null
    state.template = id
    state.custom = id === CUSTOM_LABEL
    if (id === NONE_LABEL || id === CUSTOM_LABEL) {
      state.params = {}
      state.targetId = null
    } else {
      // V11 — the default target is one this template can actually use: the
      // selected node when the template's picker offers it, otherwise the
      // list's first entry. An empty list leaves `targetId` null, and Save is
      // disabled, so the wrong kind of target is never sent.
      const list = pickable()
      const selectedNode = deps.selected?.() ?? null
      const chosen = (selectedNode && list.includes(selectedNode)) ? selectedNode : (list[0] ?? null)
      state.params = defaultsFor(id, chosen)
      state.targetId = state.params.target ?? null
    }
    render()
  }

  function onParamChange(key, value) {
    state.params = { ...state.params, [key]: value }
    if (key === 'target') state.targetId = value
    render()
  }

  /** The value Save will write, or null when there is nothing to write. */
  function valueForSave(snapshot = null) {
    if (state.custom || snapshot?.custom) return snapshot?.savedValue ?? state.saved
    const template = snapshot?.template ?? state.template
    if (template === NONE_LABEL || !template) return null
    const params = { ...(snapshot?.params ?? state.params) }
    const ownIdValue = snapshot ? snapshot.nodeId : ownId()
    // The target's id, as it will be AFTER this sequence's own id stages.
    if (params.target) params.target = snapshot ? (snapshot.targetOwnId ?? snapshot.targetId) : state.targetId
    // C2 — `intensity` is read from the light at SAVE time, never shown.
    // W8 (round 6) — from the SNAPSHOT's own target object (`snapshot.target`),
    // never looked up again: stage 3 must use the light the sequence was bound
    // to, not whatever the id resolves to now.
    if (template === 'select-light') params.intensity = lightIntensity(snapshot ? snapshot.target : targetNode())
    return templateGraph(template, params, { ownId: ownIdValue })
  }

  // -------------------------------------------------------------------------
  // The Save sequence (M4)
  // -------------------------------------------------------------------------

  /**
   * V10 — the snapshot's TARGET object, checked before every stage: still in
   * the SOM (`deps.nodes()` contains it), and carrying the id the snapshot
   * expects — none before the stage that gives it one, that id after. The
   * target is never looked up again, by name or by id, so a target that is
   * removed and replaced by a node of the same name, or one whose id changes
   * underneath, cancels the sequence instead of following the impostor (the
   * outside review's M7).
   */
  function targetAsRecorded(snapshot) {
    if (!snapshot.target) return true
    const nodes = deps.nodes?.() ?? []
    if (!nodes.includes(snapshot.target)) return false
    const liveId = snapshot.target.extras?.atrium?.objectId ?? null
    return liveId === (snapshot.targetOwnId ?? null)
  }

  function aliveAsRecorded(snapshot) {
    const node = deps.selected?.()
    return state.open
      && state.generation === snapshot.generation
      && node === snapshot.node
      && targetAsRecorded(snapshot)
  }

  function dispatchStage(snapshot) {
    if (state.generation !== snapshot.generation) return
    if (!aliveAsRecorded(snapshot)) { cancelSequence(); return }

    // Stage 1 — the behaviour node's own id, if it has none yet.
    if (!snapshot.nodeId) {
      const id = deps.newObjectId?.()
      let seq
      try { seq = deps.write?.setObjectId?.(snapshot.nodeName, id) } catch (error) {
        state.error = error?.message ?? String(error)
        bump()
        render()
        return
      }
      snapshot.nodeId = id
      // V11 — the target may BE the behaviour node: its id is this one, and
      // stage 2 must not give the same node a second id.
      if (snapshot.target === snapshot.node) snapshot.targetOwnId = id
      state.pending = { seq, stage: 1, generation: snapshot.generation }
      render()
      return
    }

    // Stage 2 — the target's own id, if it has none yet and is another node.
    if (snapshot.targetName && !snapshot.targetOwnId && snapshot.target !== snapshot.node) {
      const id = deps.newObjectId?.()
      let seq
      try { seq = deps.write?.setObjectId?.(snapshot.targetName, id) } catch (error) {
        state.error = error?.message ?? String(error)
        bump()
        render()
        return
      }
      snapshot.targetOwnId = id
      state.pending = { seq, stage: 2, generation: snapshot.generation }
      render()
      return
    }

    // Stage 3 — the leaf itself. The value is built HERE, from the ids the
    // earlier stages established, so a node that got its id a moment ago is
    // named by the id it actually has.
    const value = valueForSave(snapshot)
    snapshot.value = value
    let seq
    try { seq = deps.write?.sendField?.(snapshot.nodeName, 'extras.atrium.behavior', value) } catch (error) {
      state.error = error?.message ?? String(error)
      bump()
      render()
      return
    }
    state.pending = { seq, stage: 3, generation: snapshot.generation, value }
    render()
  }

  function cancelSequence() {
    bump()
    state.status = BEHAVIOR_STATUS.cancelled
    render()
  }

  /**
   * X3 (round 7) — the stand-in ids the pre-stage check builds its value with,
   * for every id the sequence has not given yet. They are in `OBJECT_ID_RE`'s
   * form, they are distinct (the rule requires a unique `nodeMap`), and they
   * NEVER reach a send: the check builds a COPY of the snapshot.
   */
  const STAND_IN = Object.freeze({
    own: '00000000-0000-4000-8000-000000000001',
    target: '00000000-0000-4000-8000-000000000002',
  })

  /** X3 — the value the pre-stage check runs, and the `ownId` it runs with. */
  function valueForCheck(snapshot) {
    const own = snapshot.nodeId ?? STAND_IN.own
    let target = null
    if (snapshot.target === snapshot.node) target = own
    else if (snapshot.target) target = snapshot.targetOwnId ?? STAND_IN.target
    const probe = { ...snapshot, nodeId: own, targetOwnId: target }
    return { value: valueForSave(probe), ownId: own }
  }

  function save() {
    if (!state.open || !state.node || state.saving) return null
    if (!state.custom && state.template === NONE_LABEL) return null
    // X3 — the FIELD check runs again before anything is built or sent.
    state.clip = clipInfoFor(targetNode())
    state.error = null
    if (fieldProblem()) { render(); return null }
    const target = targetNode()
    // V11 — a template is never saved without a usable target: an empty picker
    // (the light template in a world with no lights) leaves Save disabled.
    if (!state.custom && !state.targetId) return null
    const snapshot = {
      generation: state.generation,
      node: state.node,
      nodeName: state.node.name,
      nodeId: ownId(),
      targetId: state.targetId,
      targetName: target?.name ?? null,
      // V10 — the target's SOM node object, kept for the whole sequence, and
      // its id as it is expected to be: the one it has, or none yet.
      target,
      targetOwnId: target
        ? (target === state.node ? (ownId() ?? null) : (target.extras?.atrium?.objectId ?? null))
        : null,
      template: state.template,
      params: { ...state.params },
      custom: state.custom,
      savedValue: state.saved,
      value: null,
    }
    // X3 — the whole-value check, exactly as stage 3 will build it, before a
    // single byte goes out: on a refusal there is NO `setObjectId` and NO leaf.
    const { value, ownId: checkedOwnId } = valueForCheck(snapshot)
    const verdict = behaviorCheck(value, { ownId: checkedOwnId })
    if (verdict.problem) {
      state.error = `${CANT_SAVE}${behaviorReasonText(verdict.problem)}`
      render()
      return null
    }
    state.sequence = snapshot
    state.saving = true
    state.error = null
    state.status = null
    deps.clearError?.()
    // The first stage goes out on the next tick of this call.
    dispatchStage(snapshot)
    render()
    return snapshot.generation
  }

  function remove() {
    if (!state.open || !state.node || state.saving) return null
    let seq
    try { seq = deps.write?.sendField?.(state.node.name, 'extras.atrium.behavior', null) } catch (error) {
      state.error = error?.message ?? String(error)
      render()
      return null
    }
    state.pending = { seq, stage: 'remove', generation: state.generation }
    render()
    return seq
  }

  /**
   * V2 (M6, S1) — Enabled is a real `<button>`, so its listener is `click`
   * (see `wire`), it never carries `.checked`, and the label is the state.
   *
   * It is available for a template's value AND for a Custom graph, as F9 says
   * ("Enabled and Remove only"): the stored value is REWRITTEN with `enabled`
   * changed and nothing else — a Custom graph is never regenerated. It is
   * disabled only while a write is in flight; "None" has no Enabled at all.
   */
  function setEnabled(enabled) {
    if (!state.saved) return null
    if (!state.custom && state.template === NONE_LABEL) return null
    state.enabled = enabled !== false
    const value = { ...state.saved, enabled: state.enabled }
    let seq
    try { seq = deps.write?.sendField?.(state.node.name, 'extras.atrium.behavior', value) } catch (error) {
      state.error = error?.message ?? String(error)
      render()
      return null
    }
    state.pending = { seq, stage: 'enabled', generation: state.generation }
    render()
    return seq
  }

  /**
   * F9 — an `edit:accepted` / `edit:rejected` / `edit:unknown` answer.
   * Only the stage this form is waiting on is resolved; anything else is
   * another form's (or a stale sequence's) answer.
   */
  function onAnswer(kind, message = {}) {
    const pending = state.pending
    if (!pending || pending.seq !== message.seq) return false
    state.pending = null
    // M4 — a sequence the form has already moved on from: the answer is
    // resolved as usual (an id a node got is harmless on its own), nothing
    // continues, and the status says so once.
    if (pending.generation !== state.generation) { cancelSequence(); return true }
    if (kind !== 'edit:accepted') {
      state.error = message.message || message.reason || 'the server refused the behaviour'
      deps.showError?.(state.error)
      bump()
      render()
      return true
    }
    // W3 (round 6) — when the sequence ENDS, the form re-reads the stored value
    // once, so nothing it holds can be stale next to the world.
    if (pending.stage === 3) { state.saved = pending.value; state.saving = false; readStored(state.node); render(); return true }
    if (pending.stage === 'remove') { state.saved = null; state.saving = false; readStored(state.node); render(); return true }
    if (pending.stage === 'enabled') { state.saving = false; readStored(state.node); render(); return true }
    // Stages 1 and 2 continue the sequence.
    const snapshot = state.sequence
    if (snapshot && snapshot.generation === pending.generation) dispatchStage(snapshot)
    else cancelSequence()
    return true
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function statusText() {
    const reported = deps.status?.() ?? {}
    if (reported.state === 'saving' || state.saving) return BEHAVIOR_STATUS.saving
    if (reported.state === 'running') return BEHAVIOR_STATUS.running
    if (reported.state === 'other-tab') return BEHAVIOR_STATUS.otherTab
    // W4 (round 6) — each runner reason gets its OWN text. Passing the reason
    // to `behaviorReasonText`, which knows only F1's codes, made every
    // "Disabled" line read "the behaviour value is invalid" (§1.2 item 4).
    if (reported.state === 'disabled') {
      return `Disabled: ${disabledReasonText(reported.reason ?? reported.reasonText ?? '')}`.trim()
    }
    if (reported.state === 'idle') return BEHAVIOR_STATUS.idle
    return ''
  }

  // -------------------------------------------------------------------------
  // X3/X4 (round 7) — the field check, and what the fields show
  // -------------------------------------------------------------------------

  /** The clips a clip `select` may offer: a LOADED list, and nothing else. */
  const clipOptions = (info) => (info?.known ? info.clipIds : [])

  /**
   * X4 — every field must show exactly what the form will send. Runs before
   * every render, and moves only the HELD values: a target that is no longer
   * offered, a stored clip the loaded model doesn't have, an empty picker
   * (§1.2 item 4: the picker showed ToyCar and Survey while the form held
   * `name:Fox` and `''`).
   */
  function normalise() {
    if (!state.open || state.custom || state.template === NONE_LABEL) return
    const wasEdited = unsavedEdit()
    // X6 — a held `name:<name>` whose node has an `objectId` now becomes that
    // id, so the picker's option and the held value stay the same string.
    const target = targetNode()
    if (target && state.targetId === `name:${target.name}`) {
      const id = target.extras?.atrium?.objectId ?? null
      if (id) state.targetId = id
    }
    // X4 — the target's held value must be one of the picker's options.
    if (!pickable().some((node) => pickerValue(node) === state.targetId)) state.targetId = ''
    state.params = { ...state.params, target: state.targetId }
    // X4 — and the clip's, when the clip is a select.
    if (TEMPLATE_FIELDS[state.template].includes('clip')) {
      const clips = clipOptions(state.clip)
      if (clips.length > 0 && !clips.includes(state.params.clip)) {
        state.params = { ...state.params, clip: '' }
      }
    }
    // X4 — a normalisation isn't an edit: with no unsaved edit before it, W3's
    // baseline follows the value it moved, so nothing says "Changed in another
    // tab" about the form's own correction.
    if (!wasEdited) {
      state.baseline = { template: state.template, custom: state.custom, params: { ...state.params } }
    }
  }

  /**
   * X3 — the FIRST field problem, in the contract's order, or null. Save is
   * disabled while there is one and the status line shows its text (§1.2 item
   * 3: F1's code-level ``animations is malformed`` was what the owner read).
   */
  function fieldProblem() {
    if (state.custom || state.template === NONE_LABEL) return null
    const fields = TEMPLATE_FIELDS[state.template]
    if (state.template === 'select-light' && pickable().length === 0) return FIELD_TEXTS.noLights
    if (!state.targetId) return FIELD_TEXTS.noTarget
    if (fields.includes('clip')) {
      const clips = clipOptions(state.clip)
      if (state.clip.known && clips.length === 0) return FIELD_TEXTS.noAnimations
      if (clips.length > 0) {
        if (!clips.includes(state.params.clip)) return FIELD_TEXTS.noClip
      } else if (!String(state.params.clip ?? '').length) return FIELD_TEXTS.emptyClip
    }
    if (fields.includes('radius')) {
      const radius = state.params.radius
      const ok = typeof radius === 'number' && Number.isFinite(radius)
        && radius >= BEHAVIOR_PROX_MIN && radius <= BEHAVIOR_PROX_MAX
      if (!ok) return FIELD_TEXTS.radius
    }
    if (fields.includes('seconds')) {
      const seconds = state.params.seconds
      const ok = Number.isInteger(seconds)
        && seconds >= BEHAVIOR_INTERVAL_MIN && seconds <= BEHAVIOR_INTERVAL_MAX
      if (!ok) return FIELD_TEXTS.seconds
    }
    return null
  }

  /**
   * X3 — the status line's ONE writer. A Save's own error comes first, then
   * "Saving…", then the field check's text, then the form's own note and the
   * runner's status.
   */
  function statusLine() {
    const reported = deps.status?.() ?? {}
    if (state.error) return state.error
    if (state.saving || reported.state === 'saving') return BEHAVIOR_STATUS.saving
    const problem = fieldProblem()
    if (problem) return problem
    return state.status || statusText()
  }

  /**
   * X1 (round 7) — one field per row, each with its OWN `span` label: the
   * `div.ep-row` the panel's other fields use (a 58 px label `span`, then the
   * control), the label a word from `FIELD_LABELS`, and the control's
   * `aria-label` the same. No `<label>` wraps a control.
   */
  function renderParams() {
    const container = elements.params
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)
    if (!state.open || state.custom || state.template === NONE_LABEL) {
      show(container, false)
      renderHint('')
      return
    }
    show(container, true)

    for (const key of TEMPLATE_FIELDS[state.template]) {
      if (key === 'intensity') continue               // C2 — read at save time
      const row = create('div')
      if (!row) continue
      row.classList.add('ep-row')
      const label = create('span')
      label.textContent = FIELD_LABELS[key] ?? key
      row.appendChild(label)
      let field = null
      if (key === 'target') {
        field = create('select')
        const nodes = pickable()
        // X4 — a held value that isn't among the options gets a placeholder
        // first option, and the form holds `''`.
        if (!nodes.some((node) => pickerValue(node) === state.targetId)) {
          const placeholder = create('option')
          placeholder.value = ''
          placeholder.textContent = CHOOSE_TARGET
          placeholder.selected = true
          field.appendChild(placeholder)
        }
        for (const node of nodes) {
          const option = create('option')
          // A node without an id is listed too: Save gives it one first (F9).
          option.value = pickerValue(node)
          option.textContent = node.name
          if (option.value === state.targetId) option.selected = true
          field.appendChild(option)
        }
        setDataField(field, 'target')
      } else if (key === 'action') {
        field = create('select')
        for (const action of TEMPLATE_ACTIONS[state.template]) {
          const option = create('option')
          option.value = action
          option.textContent = action
          if (action === state.params.action) option.selected = true
          field.appendChild(option)
        }
        setDataField(field, 'action')
      } else if (key === 'clip') {
        const clips = clipOptions(state.clip)
        if (state.clip.known && clips.length === 0) {
          // X2 — a loaded model with no animations says so, in place of a
          // control. The empty text box this replaces let Save send `''`, which
          // the server refused with F1's "animations is malformed" (§1.2 item 2).
          const none = create('span')
          none.textContent = NO_ANIMATIONS
          row.appendChild(none)
          container.appendChild(row)
          continue
        }
        if (clips.length > 0) {
          field = create('select')
          if (!clips.includes(state.params.clip)) {
            const placeholder = create('option')
            placeholder.value = ''
            placeholder.textContent = CHOOSE_CLIP
            placeholder.selected = true
            field.appendChild(placeholder)
          }
          for (const clip of clips) {
            const option = create('option')
            option.value = clip
            option.textContent = clip
            if (clip === state.params.clip) option.selected = true
            field.appendChild(option)
          }
        } else {
          // X2 — the clips aren't known yet (loading, or no record): the text
          // box keeps its place, now with a placeholder.
          field = create('input')
          field.value = state.params.clip ?? ''
          field.placeholder = CLIP_PLACEHOLDER
        }
        setDataField(field, 'clip')
      } else if (key === 'loop') {
        field = create('input')
        field.type = 'checkbox'
        field.checked = state.params.loop === true
        setDataField(field, 'loop')
      } else if (key === 'radius' || key === 'seconds') {
        // X4 — the held number, or EMPTY when the held value isn't a number.
        const held = state.params[key]
        field = create('input')
        field.type = 'number'
        field.value = typeof held === 'number' && Number.isFinite(held) ? String(held) : ''
        setDataField(field, key)
      }
      if (field) {
        field.setAttribute('aria-label', FIELD_LABELS[key] ?? key)
        // W8 (round 6) — the parameter fields are disabled while a Save is in
        // flight, exactly as the template picker is: nothing may change under
        // the value the sequence is building.
        if (state.saving) field.disabled = true
        row.appendChild(field)
        container.appendChild(row)
      }
    }
    // T1 — `elements.hintText` is the hint's source (R1), and `renderHint` is
    // its ONE writer: the text and its visibility move together, so an empty
    // hint is hidden and never keeps an old template's line.
    renderHint(elements.hintText)
    if (elements.noLights) show(elements.noLights, state.template === 'select-light' && pickable().length === 0)
  }

  /** T1 — the hint element's one writer. Empty means hidden, never stale. */
  function renderHint(value) {
    const hint = elements.hint
    if (!hint) return
    const line = value ?? ''
    text(hint, line)
    show(hint, line !== '')
  }

  /**
   * R1 + T1 — the hint is the generic sentence (R1), then C2's sentence for
   * `select-light` (R1: right after the generic sentence), then the chosen
   * template's own help lines: "One click per change." for the two toggling
   * templates, a clip's end triggering nothing for the three animation ones,
   * and the picker's "This world has no lights" when `select-light` has no
   * light to offer. Nothing for "None" or "Custom graph".
   */
  function hintText() {
    if (state.custom || state.template === NONE_LABEL) return ''
    const lines = [HINT_TEXT]
    if (state.template === 'select-light') lines.push(HINT_LIGHT_ON)
    if (state.template === 'select-visibility' || state.template === 'select-light') lines.push(HINT_ONE_CLICK)
    if (state.template === 'select-animation'
      || state.template === 'proximity-animation'
      || state.template === 'interval-animation') lines.push(HINT_CLIP_END)
    if (state.template === 'select-light' && pickable().length === 0) lines.push(NO_LIGHTS)
    return lines.join(' ')
  }

  function render() {
    const open = state.open
    show(elements.row, open)
    show(elements.log, open)
    if (!open) {
      show(elements.params, false)
      show(elements.actions, false)
      text(elements.status, '')
      elements.hintText = ''
      renderHint('')
      return
    }
    show(elements.actions, true)

    // X2/X4 — the clip status this render draws from, then the held values'
    // normalisation (which may move the target), then the status again.
    state.clip = clipInfoFor(targetNode())
    normalise()
    state.clip = clipInfoFor(targetNode())

    if (elements.select) {
      elements.select.value = state.custom ? CUSTOM_LABEL : state.template
      elements.select.disabled = Boolean(state.saving)
    }
    // R1 — `elements.hintText` is the hint's source, as before; only its value
    // now follows the template. `renderParams` renders it, unchanged.
    elements.hintText = hintText()
    renderParams()

    const isNone = state.template === NONE_LABEL
    if (elements.enabled) {
      // V2 — "None" has no Enabled; a Custom graph does (S1). Disabled only
      // while ITS OWN write is in flight (the enabled sequence), and the label
      // IS the state.
      const enabledWrite = state.pending?.stage === 'enabled'
      elements.enabled.disabled = isNone || Boolean(state.saving) || enabledWrite
      elements.enabled.textContent = state.enabled ? 'Enabled' : 'Disabled'
    }
    if (elements.save) {
      // V11 — a template with no usable target can't be saved either. X3 —
      // and neither can one with a field the check refuses.
      elements.save.disabled = state.custom || isNone || !state.targetId
        || Boolean(fieldProblem()) || Boolean(state.saving)
      elements.save.textContent = state.saving ? 'Saving…' : 'Save'
    }
    // "Custom graph" shows Enabled and Remove only.
    if (elements.remove) elements.remove.disabled = isNone || Boolean(state.saving)

    // X3 — the status line's precedence lives in `statusLine`.
    text(elements.status, statusLine())
    text(elements.note, UNDO_NOTE)
    if (elements.logLines) {
      const lines = deps.logLines?.(state.node?.name) ?? []
      while (elements.logLines.firstChild) elements.logLines.removeChild(elements.logLines.firstChild)
      for (const line of lines) {
        const row = create('div'); if (!row) break
        row.textContent = line
        elements.logLines.appendChild(row)
      }
    }
  }

  /** `renderParams` reads this to word the picker (F8: "This world has no lights"). */
  elements.hint = elements.hint ?? null
  elements.hintText = HINT_TEXT
  // T1 — the form is the hint element's one writer, so it starts it the way it
  // keeps it: empty, and hidden while empty.
  renderHint('')

  function wire() {
    if (elements.select) elements.select.addEventListener('change', () => onTemplateChange(elements.select.value))
    if (elements.save) elements.save.addEventListener('click', () => save())
    if (elements.remove) elements.remove.addEventListener('click', () => remove())
    if (elements.enabled) elements.enabled.addEventListener('click', () => setEnabled(!state.enabled))
    if (elements.params) {
      elements.params.addEventListener('change', (event) => {
        const field = event?.target?.dataset?.field
        if (!field) return
        const target = event.target
        const value = field === 'loop' ? Boolean(target.checked)
          : (field === 'radius' || field === 'seconds') ? Number(target.value)
            : target.value
        onParamChange(field, value)
      })
    }
    if (gate) gate.register(name, close)
  }

  return {
    wire, open, close, render, reset, save, remove, setEnabled, onAnswer, reread,
    onTemplateChange, onParamChange,
    get state() { return state },
    get openState() { return state.open },
    values: { NONE_LABEL, CUSTOM_LABEL, UNDO_NOTE },
  }
}
