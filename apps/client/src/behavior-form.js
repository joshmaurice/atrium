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
import { behaviorReasonText } from '@atrium/behaviors/behavior-spec'

export const NONE_LABEL = 'None'
export const CUSTOM_LABEL = 'Custom graph'

/** D4 — the one line under the status, shown once. */
export const UNDO_NOTE = 'Behaviour changes are saved with the world and aren’t undone by Undo.'

/** R1 — the generic hint, shown under the picker for every template. */
export const HINT_TEXT = 'Behaviour changes are saved with the world.'

/** R1 (C2) — the sentence appended to the hint for `select-light` ONLY. */
export const HINT_LIGHT_ON = 'If the light was off when you saved, \'on\' uses intensity 1.'

/** F9 — the status texts. */
export const BEHAVIOR_STATUS = Object.freeze({
  running: 'Running',
  idle: 'Not running: this tab isn’t the script host',
  otherTab: 'Behaviours run in another tab; clicks here don’t trigger them',
  saving: 'Saving…',
  cancelled: 'Save cancelled',
})

/** Which targets a template's picker offers (F8). */
export function targetKindFor(templateId) {
  if (templateId === 'select-animation' || templateId === 'proximity-animation' || templateId === 'interval-animation') return 'model'
  if (templateId === 'select-light') return 'light'
  return 'any'
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
    generation: 0,
    sequence: null,       // the snapshot Save is bound to
    pending: null,        // { seq, stage, generation }
  }

  const show = (element, visible) => { if (element) element.style.display = visible ? '' : 'none' }
  const text = (element, value) => { if (element) element.textContent = value ?? '' }

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

  /** The target's clip ids, when the host knows them (`deps.clipIds`). */
  function clipIdsFor(node) {
    const id = node?.extras?.atrium?.objectId
    return (id ? deps.clipIds?.(id) : null) ?? []
  }

  // -------------------------------------------------------------------------
  // Open / close
  // -------------------------------------------------------------------------

  function defaultsFor(id, target) {
    const params = { target: target?.extras?.atrium?.objectId ?? null }
    for (const key of TEMPLATE_FIELDS[id]) {
      if (key === 'target') continue
      if (key === 'action') params.action = TEMPLATE_ACTIONS[id][0]
      else if (key === 'loop') params.loop = TEMPLATE_DEFAULTS.loop
      else if (key === 'radius') params.radius = TEMPLATE_DEFAULTS.radius
      else if (key === 'seconds') params.seconds = TEMPLATE_DEFAULTS.seconds
      else if (key === 'clip') params.clip = clipIdsFor(target)[0] ?? ''
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
    const saved = node.extras?.atrium?.behavior ?? null
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
    gate?.claim(name)
    render()
  }

  function close() {
    state.open = false
    state.node = null
    // M4 — closing ends any Save sequence in flight.
    bump()
    gate?.release(name)
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
      state.params = defaultsFor(id, deps.selected?.())
      state.targetId = state.params.target
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
    if (template === 'select-light') params.intensity = lightIntensity(targetNode())
    return templateGraph(template, params, { ownId: ownIdValue })
  }

  // -------------------------------------------------------------------------
  // The Save sequence (M4)
  // -------------------------------------------------------------------------

  function aliveAsRecorded(snapshot) {
    const node = deps.selected?.()
    return state.open
      && state.generation === snapshot.generation
      && node === snapshot.node
      && (snapshot.targetId === null || nodeById(snapshot.targetId) !== null || snapshot.snapshotTargetExists === false)
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
      state.pending = { seq, stage: 1, generation: snapshot.generation }
      render()
      return
    }

    // Stage 2 — the target's own id, if it has none yet.
    if (snapshot.targetName && !snapshot.targetOwnId) {
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

  function save() {
    if (!state.open || !state.node || state.saving) return null
    if (!state.custom && state.template === NONE_LABEL) return null
    const target = targetNode()
    const snapshot = {
      generation: state.generation,
      node: state.node,
      nodeName: state.node.name,
      nodeId: ownId(),
      targetId: state.targetId,
      targetName: target?.name ?? null,
      targetOwnId: target?.extras?.atrium?.objectId ?? null,
      // A target the picker offered but the SOM has since lost: stage 1 still
      // runs (the id the node got is harmless), nothing further does.
      snapshotTargetExists: target !== null,
      template: state.template,
      params: { ...state.params },
      custom: state.custom,
      savedValue: state.saved,
      value: null,
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

  function setEnabled(enabled) {
    if (state.custom) return null
    if (state.template === NONE_LABEL) return null
    const current = state.saved
    if (!current) return null
    state.enabled = enabled !== false
    const value = { ...current, enabled: state.enabled }
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
    if (pending.stage === 3) { state.saved = pending.value; state.saving = false; render(); return true }
    if (pending.stage === 'remove') { state.saved = null; state.saving = false; render(); return true }
    if (pending.stage === 'enabled') { state.saving = false; render(); return true }
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
    if (reported.state === 'disabled') return `Disabled: ${reported.reason ? behaviorReasonText(reported.reason) : reported.reasonText ?? ''}`.trim()
    if (reported.state === 'idle') return BEHAVIOR_STATUS.idle
    return ''
  }

  /** One field per template parameter, created through `deps.createElement`. */
  function renderParams() {
    const container = elements.params
    if (!container) return
    while (container.firstChild) container.removeChild(container.firstChild)
    if (!state.open || state.custom || state.template === NONE_LABEL) { show(container, false); return }
    show(container, true)

    for (const key of TEMPLATE_FIELDS[state.template]) {
      if (key === 'intensity') continue               // C2 — read at save time
      const row = create('label'); if (!row) continue
      row.textContent = `${key} `
      let field = null
      if (key === 'target') {
        field = create('select')
        for (const node of pickable()) {
          const option = create('option')
          const id = node.extras?.atrium?.objectId ?? null
          // A node without an id is listed too: Save gives it one first (F9).
          option.value = id ?? `name:${node.name}`
          option.textContent = node.name
          if (id && id === state.targetId) option.selected = true
          field.appendChild(option)
        }
        field.dataset = { ...(field.dataset ?? {}), field: 'target' }
      } else if (key === 'action') {
        field = create('select')
        for (const action of TEMPLATE_ACTIONS[state.template]) {
          const option = create('option')
          option.value = action
          option.textContent = action
          if (action === state.params.action) option.selected = true
          field.appendChild(option)
        }
        field.dataset = { ...(field.dataset ?? {}), field: 'action' }
      } else if (key === 'clip') {
        const clips = clipIdsFor(targetNode())
        if (clips.length > 0) {
          field = create('select')
          for (const clip of clips) {
            const option = create('option')
            option.value = clip
            option.textContent = clip
            if (clip === state.params.clip) option.selected = true
            field.appendChild(option)
          }
        } else {
          field = create('input')
          field.value = state.params.clip ?? ''
        }
        field.dataset = { ...(field.dataset ?? {}), field: 'clip' }
      } else if (key === 'loop') {
        field = create('input')
        field.type = 'checkbox'
        field.checked = state.params.loop !== false
        field.dataset = { ...(field.dataset ?? {}), field: 'loop' }
      } else if (key === 'radius' || key === 'seconds') {
        field = create('input')
        field.type = 'number'
        field.value = String(state.params[key] ?? '')
        field.dataset = { ...(field.dataset ?? {}), field: key }
      }
      if (field) {
        row.appendChild(field)
        container.appendChild(row)
      }
    }
    text(elements.hint, elements.hintText ?? '')
    if (elements.noLights) show(elements.noLights, state.template === 'select-light' && pickable().length === 0)
  }

  /** R1 — the hint is the generic sentence, plus C2's for `select-light` only. */
  function hintText() {
    return state.template === 'select-light' ? `${HINT_TEXT} ${HINT_LIGHT_ON}` : HINT_TEXT
  }

  function render() {
    const open = state.open
    show(elements.row, open)
    show(elements.log, open)
    if (!open) { show(elements.params, false); show(elements.actions, false); text(elements.status, ''); return }
    show(elements.actions, true)

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
      elements.enabled.disabled = state.custom || isNone || Boolean(state.saving)
      elements.enabled.textContent = state.enabled ? 'Enabled' : 'Disabled'
      elements.enabled.checked = state.enabled
    }
    if (elements.save) {
      elements.save.disabled = state.custom || isNone || Boolean(state.saving)
      elements.save.textContent = state.saving ? 'Saving…' : 'Save'
    }
    // "Custom graph" shows Enabled and Remove only.
    if (elements.remove) elements.remove.disabled = isNone || Boolean(state.saving)

    text(elements.status, state.error ?? (state.status || statusText()))
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

  function wire() {
    if (elements.select) elements.select.addEventListener('change', () => onTemplateChange(elements.select.value))
    if (elements.save) elements.save.addEventListener('click', () => save())
    if (elements.remove) elements.remove.addEventListener('click', () => remove())
    if (elements.enabled) elements.enabled.addEventListener('change', () => setEnabled(Boolean(elements.enabled.checked)))
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
    wire, open, close, render, reset, save, remove, setEnabled, onAnswer,
    onTemplateChange, onParamChange,
    get state() { return state },
    get openState() { return state.open },
    values: { NONE_LABEL, CUSTOM_LABEL, UNDO_NOTE },
  }
}
