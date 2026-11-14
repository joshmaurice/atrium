// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * graph-import-panel.js — scripting-4d-1 G6, the importer's panel.
 *
 * It lives in the Behaviour section, opened from "Import a graph…" beside the
 * template list, and it is the ONE writer of everything inside
 * `#ep-import-panel`: the source's name, the graph picker, the mapping table,
 * the report, the grants, the notes and Save.
 *
 * Pure enough to test without a browser: it takes its elements and its
 * `createElement` as deps, and the byte-reading and the conversion are the
 * pure module's (`graph-import.js`). `app.js` is wiring only.
 *
 * Two rules worth reading twice:
 *
 *  - **Every string from a graph or a file reaches the DOM as TEXT** (G6):
 *    file names, file node names, op names, pointers, problem texts — through
 *    `textContent` and created nodes. There is no `innerHTML` in this module,
 *    and `behavior-wiring.test.js` guards that.
 *  - **Save is one `sendField` of the leaf, and the node gets its `objectId`
 *    first** (G6, as F9 does): stage 1 gives a node that has no id one, and
 *    the leaf is rebuilt from the id the node actually got before stage 2
 *    sends it.
 */

import {
  parseGraphSource, referencesOf, convertGraph, importNotes,
  IMPORT_BYTES_MAX, importBytesProblem,
} from './graph-import.js'

export const IMPORT_OPEN_LABEL = 'Import a graph…'
export const CHOOSE_TARGET = 'Choose a target…'
export const CHOOSE_GRAPH = 'Choose a graph…'
export const NO_GRAPH_YET = 'Choose a graph file to begin'
export const MAPPED = 'Every reference is mapped.'
export const SAVED = 'Saved. Edit the graph from the Behaviour section.'
/** small-fixes R10 — a target the Save named was removed before its stage. */
export const TARGET_GONE = 'A target is gone: choose it again.'
/** small-fixes R8 — the leaf would name a target that still has no id (never sent). */
export const TARGET_WITHOUT_ID = 'A target has no id yet: save again.'

/** G6 — what a pointer family's target picker offers. */
export function importTargetKind(reference) {
  if (reference?.kind === 'light') return 'light'
  if (reference?.kind === 'animation') return 'model'
  return 'node'
}

const isAvatar = (node) => node?.extras?.atrium?.ephemeral === true

/**
 * @param {object} args
 * @param {object} args.elements
 * @param {object} args.deps
 * @param {() => object|null} args.deps.selected
 * @param {() => Array<object>} args.deps.nodes
 * @param {object} args.deps.write              `{ setObjectId, sendField }`
 * @param {() => string} [args.deps.newObjectId]
 * @param {(element: object) => void} [args.deps.focus]
 * @param {(text: string) => void} [args.deps.showError]
 * @param {() => void} [args.deps.clearError]
 * @param {() => void} [args.deps.onSaved]
 */
export function createGraphImportPanel({ elements = {}, deps = {} } = {}) {
  const doc = deps.document ?? (typeof document === 'undefined' ? null : document)
  const create = deps.createElement ?? ((tag) => doc?.createElement?.(tag) ?? null)
  // R16 — the SAME `nameOf` the Q3 Enable confirmation names its grants with
  // (`behavior-form.js` passes `deps.nodeName`): the grants line and the prompt
  // cannot disagree about what an object is called.
  const nameOf = typeof deps.nodeName === 'function' ? deps.nodeName : null

  const state = {
    open: false,
    node: null,
    ownId: null,           // the behaviour node's `objectId`, once it has one
    fileName: '',
    parsed: null,          // parseGraphSource's result, without a problem
    graphIndex: 0,
    references: null,      // referencesOf(graphs[graphIndex])
    mapping: {},           // kind:fileIndex → the held target
    animations: [],        // { index, object, clip, loop }
    conversion: null,      // { value, report } | null
    problem: null,
    status: '',
    saving: false,
    pending: null,         // { seq, stage, node? }
    // small-fixes R9/R10 — the other id-less targets Save gives an id to, held
    // as SOM node OBJECTS from the click, and the ids this panel gave them.
    targetsAtSave: [],
    given: new Map(),
  }

  const show = (element, visible) => { if (element) element.style.display = visible ? '' : 'none' }
  const text = (element, value) => { if (element) element.textContent = value ?? '' }
  const clear = (element) => { while (element?.firstChild) element.removeChild(element.firstChild) }

  /** R16 — an object's name through `nameOf`, or its id when it has none. */
  function grantName(id) {
    // the review's S-1 — a preview's stand-in is named as the object it stands for
    const standing = state.standInNames?.get(id)
    if (standing) return standing
    if (!nameOf) return id
    try {
      const name = nameOf(id)
      return (typeof name === 'string' && name !== '') ? name : id
    } catch { return id }
  }

  // -------------------------------------------------------------------------
  // The SOM, as the picker sees it
  // -------------------------------------------------------------------------

  const pickerValue = (node) => (node ? (node.extras?.atrium?.objectId ?? `name:${node.name}`) : null)
  const idOf = (node) => node?.extras?.atrium?.objectId ?? null

  /**
   * small-fixes — the node a held picker value names: an id, or `name:<name>`
   * for a node that had no id when it was chosen (found by name, so a node
   * that has been given an id since is still found).
   */
  function heldNode(held) {
    if (typeof held !== 'string' || held === '') return null
    const nodes = deps.nodes?.() ?? []
    if (held.startsWith('name:')) {
      const name = held.slice(5)
      return nodes.find((node) => node?.name === name) ?? null
    }
    return nodes.find((node) => idOf(node) === held) ?? null
  }

  /**
   * R11 (and X6's rule in the form) — a held `name:<name>` whose node has an
   * id now holds that id, so its picker keeps the choice.
   */
  function normaliseHeld() {
    for (const [key, held] of Object.entries(state.mapping)) {
      if (typeof held !== 'string' || !held.startsWith('name:')) continue
      // Only an id the node HAS: one this panel asked for may still be
      // refused, and a row must never hold an id the server didn't give.
      const id = idOf(heldNode(held))
      if (id) state.mapping[key] = id
    }
    for (const animation of state.animations) {
      if (typeof animation.object !== 'string' || !animation.object.startsWith('name:')) continue
      const id = idOf(heldNode(animation.object))
      if (id) animation.object = id
    }
  }

  /** G6 — the candidates a reference's target picker offers, filtered by kind. */
  function candidatesFor(kind) {
    return (deps.nodes?.() ?? []).filter((node) => {
      if (!node || isAvatar(node)) return false
      if (kind === 'light') return Boolean(node.light)
      if (kind === 'model') return Boolean(node.extras?.atrium?.model)
      return true
    })
  }

  // -------------------------------------------------------------------------
  // The source and the graph picker
  // -------------------------------------------------------------------------

  /** G6 — read a source's bytes. `bytes` is a `Uint8Array` (or a File's). */
  async function chooseFile(file) {
    if (!file) return
    const name = typeof file.name === 'string' ? file.name : ''
    // G7 / R10 (S2) — the size is checked BEFORE the file is read, so a 4 MiB +
    // 1 source is refused without `arrayBuffer()` ever being called and without
    // one byte of it in memory. The text is the parser's own.
    if (typeof file.size === 'number' && file.size > IMPORT_BYTES_MAX) {
      return refuseOversized(name, file.size)
    }
    let bytes = file.bytes
    if (!(bytes instanceof Uint8Array)) {
      if (typeof file.arrayBuffer === 'function') bytes = new Uint8Array(await file.arrayBuffer())
      else bytes = file
    }
    return chooseSource(bytes, name)
  }

  /** G7 / R10 — the oversized refusal, before a single byte is read. */
  function refuseOversized(name, size) {
    state.problem = importBytesProblem(size)
    state.fileName = String(name ?? '')
    state.parsed = null
    state.references = null
    state.conversion = null
    state.mapping = {}
    state.animations = []
    state.status = ''
    render()
    return null
  }

  function chooseSource(bytes, name = '') {
    // the review's N-1 — nothing the Save is built from changes while it runs
    if (state.saving) return null
    const parsed = parseGraphSource(bytes, { name })
    state.problem = parsed.problem ?? null
    state.fileName = String(name ?? '')
    state.conversion = null
    state.mapping = {}
    state.animations = []
    state.status = ''
    if (parsed.problem) {
      state.parsed = null
      state.references = null
      render()
      return null
    }
    state.parsed = parsed
    state.graphIndex = parsed.graphIndex
    state.references = referencesOf(parsed.graphs[parsed.graphIndex])
    state.animations = parsed.fileAnimations.map((animation) => ({
      index: animation.index, object: '', clip: animation.name, loop: false,
    }))
    render()
    return parsed
  }

  function chooseGraph(index) {
    if (state.saving) return   // N-1
    const graphs = state.parsed?.graphs ?? []
    const next = Number(index)
    if (!Number.isInteger(next) || next < 0 || next >= graphs.length) return
    state.graphIndex = next
    state.references = referencesOf(graphs[next])
    state.conversion = null
    state.problem = null
    render()
  }

  function setTarget(kind, fileIndex, value) {
    if (state.saving) return   // N-1
    if (!value) delete state.mapping[`${kind}:${fileIndex}`]
    else state.mapping[`${kind}:${fileIndex}`] = value
    state.conversion = null
    state.problem = null
    state.status = ''
    convert()
    render()
  }

  function setAnimationTarget(fileIndex, value) {
    if (state.saving) return   // N-1
    const entry = state.animations.find((animation) => animation.index === Number(fileIndex))
    if (!entry) return
    entry.object = value ?? ''
    state.conversion = null
    convert()
    render()
  }

  // -------------------------------------------------------------------------
  // The conversion
  // -------------------------------------------------------------------------

  /** The distinct references a mapping row is drawn for: `{kind, fileIndex, ref, where}`. */
  function mappingRows() {
    const refs = state.references
    if (!refs) return []
    const rows = []
    const seen = new Set()
    const addRow = (kind, fileIndex, ref, where) => {
      const key = `${kind}:${fileIndex}`
      if (seen.has(key)) return
      seen.add(key)
      rows.push({ kind, fileIndex, ref, where })
    }
    for (const entry of refs.nodes) addRow('node', entry.index, entry.ref, entry.where)
    for (const entry of refs.lights) addRow('light', entry.index, entry.ref, entry.where)
    for (const entry of refs.animations) addRow('animation', entry.index, entry.ref, entry.where)
    return rows
  }

  /**
   * R7 — a light row is named by its HOST node and the light table's index:
   * `<host node name> → light <lightIndex>`. The host is the object the light
   * is mapped onto, so the label says which object the row will change.
   */
  function lightRowLabel(parsed, lightIndex) {
    const host = parsed.fileLights.find((entry) => entry.index === lightIndex)?.hosts?.[0]
    const name = parsed.fileNodes.find((node) => node.index === host)?.name ?? `node ${host}`
    return `${name} → light ${lightIndex}`
  }

  /**
   * X3's pattern (behavior-form.js) — before Save has given the node an
   * `objectId`, the conversion still has to be shown, so it is built with a
   * STAND-IN own id: it is in `OBJECT_ID_RE`'s form and it never reaches a
   * send. `sendLeaf` re-converts with the id the node actually got.
   */
  const OWN_STAND_IN = '00000000-0000-4000-8000-000000000001'

  /**
   * small-fixes R8 — the stand-in for the k-th other id-less target: distinct
   * from each other and from OWN_STAND_IN, in OBJECT_ID_RE's form, and never
   * sent (`sendLeaf` refuses a mapping that still needs one).
   */
  const targetStandIn = (k) => `00000000-0000-4000-8000-${(0x100 + k).toString(16).padStart(12, '0')}`

  /**
   * small-fixes R7/R8 — the id a held value maps to, or null when it needs a
   * stand-in. The own node (by id or `name:`) is `mapping.own`; another node
   * is its own id, or the one this panel's Save gave it.
   */
  function idForHeld(held) {
    const node = heldNode(held)
    if (node && node === state.node) return state.ownId ?? idOf(node) ?? OWN_STAND_IN
    if (!held.startsWith('name:')) return held
    if (!node) return held   // gone: the conversion refuses it, as before
    return idOf(node) ?? state.given.get(node) ?? null
  }

  /** R9 — the other id-less targets, in row order, each once (SOM node objects). */
  function heldValues() {
    const held = []
    for (const row of mappingRows()) {
      if (row.kind === 'animation') continue
      held.push(state.mapping[`${row.kind}:${row.fileIndex}`])
    }
    // the animation rows' models too (the code check's finding 3)
    for (const animation of state.animations) if (animation.object) held.push(animation.object)
    return held
  }

  function idlessTargets() {
    const out = []
    for (const held of heldValues()) {
      if (typeof held !== 'string' || !held.startsWith('name:')) continue
      const node = heldNode(held)
      if (!node || node === state.node || idOf(node) || state.given.has(node)) continue
      if (!out.includes(node)) out.push(node)
    }
    return out
  }

  /**
   * The `mapping` `convertGraph` takes, or null while a row is unmapped.
   * `forSend` — Save's leaf: a target still without an id is a problem, never
   * a stand-in on the wire.
   */
  function mappingFor({ forSend = false } = {}) {
    normaliseHeld()
    // R7 — the two namespaces are separate: a node row keys `mapping.nodes` by
    // its FILE index, a light row keys `mapping.lights` by its LIGHT index, so
    // `/nodes/0` and `/lights/0` can never land in one slot.
    // the review's S-2 — an own node given its id elsewhere maps to that id
    const mapping = { own: state.ownId ?? idOf(state.node) ?? OWN_STAND_IN, nodes: {}, lights: {}, subtree: [] }
    const standIns = new Map()
    state.standInNames = new Map()   // S-1 — so the preview names them
    /** A held value's id; a stand-in for the preview; or `{gone}` / `{missingId}`. */
    const resolve = (held) => {
      // the code check's N-6 — a node that is no longer there (a stale
      // preview) says so, rather than "nodeMap or targets is malformed"
      if (held.startsWith('name:') && !heldNode(held)) return { gone: true }
      const id = idForHeld(held)
      if (id != null) return id
      if (forSend) return { missingId: true }
      const node = heldNode(held)
      if (!standIns.has(node)) {
        standIns.set(node, targetStandIn(standIns.size))
        state.standInNames.set(standIns.get(node), node.name)
      }
      return standIns.get(node)
    }
    for (const row of mappingRows()) {
      if (row.kind === 'animation') continue
      const held = state.mapping[`${row.kind}:${row.fileIndex}`]
      if (!held) return null
      const id = resolve(held)
      if (typeof id !== 'string') return id
      if (row.kind === 'light') mapping.lights[row.fileIndex] = id
      else mapping.nodes[row.fileIndex] = id
    }
    // The own node is not a "reference"; the mapping still names it, so a graph
    // that points at the object it was imported onto converts.
    mapping.animations = []
    for (const animation of state.animations) {
      // small-fixes (the code check's finding 3) — a model with no id yet is
      // held as `name:<name>`, as a node row's target is: the same rules.
      let object = animation.object
      if (typeof object === 'string' && object !== '') {
        object = resolve(object)
        if (typeof object !== 'string') return object
      }
      mapping.animations.push({ index: animation.index, object, clip: animation.clip, loop: animation.loop === true })
    }
    return mapping
  }

  function convert({ forSend = false } = {}) {
    const graph = state.parsed?.graphs?.[state.graphIndex]
    if (!graph || !state.node) return null
    const mapping = mappingFor({ forSend })
    if (!mapping) { state.conversion = null; return null }
    if (mapping.missingId || mapping.gone) {
      state.conversion = null
      state.problem = mapping.gone ? TARGET_GONE : TARGET_WITHOUT_ID
      return null
    }
    const result = convertGraph(graph, mapping)
    if (result.problem) { state.conversion = null; state.problem = result.problem; return null }
    state.conversion = result
    state.problem = null
    return result
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  function save() {
    if (state.saving || !state.node) return null
    if (!state.conversion) { render(); return null }
    state.status = ''
    // R9/R10 — the other id-less targets, as node objects, from this click.
    state.targetsAtSave = idlessTargets()
    return nextStage()
  }

  /** R10 — cancel the Save: a target the click named is gone. */
  function cancelSave(problem) {
    state.saving = false
    state.pending = null
    state.problem = problem
    deps.showError?.(problem)
    render()
    return null
  }

  function nextStage() {
    const node = state.node
    // R10 — every target the click named is still in the world, the same
    // object. One that got an id elsewhere meanwhile is used with that id.
    const nodes = deps.nodes?.() ?? []
    if (state.targetsAtSave.some((target) => !nodes.includes(target))) return cancelSave(TARGET_GONE)
    // The code check's finding 2 — the own node, and every target held by its
    // id, are still there too.
    if (!nodes.includes(node)) return cancelSave(TARGET_GONE)
    if (heldValues().some((held) => typeof held === 'string' && held !== '' && !heldNode(held))) return cancelSave(TARGET_GONE)

    // S-2 (R10 for the own node) — an id it got elsewhere is used, not asked again
    if (!state.ownId) state.ownId = idOf(node)
    // Stage 1 — F9's rule: the node gets an `objectId` before anything names it.
    if (!state.ownId) {
      const id = deps.newObjectId?.()
      let seq
      try { seq = deps.write?.setObjectId?.(node.name, id) } catch (error) {
        state.problem = error?.message ?? String(error)
        render()
        return null
      }
      state.ownId = id ?? null
      state.pending = { seq, stage: 1 }
      state.saving = true
      render()
      return seq
    }

    // R9 — then each other id-less target, in row order, gets its own id.
    const target = state.targetsAtSave.find((t) => !idOf(t) && !state.given.has(t))
    if (target) {
      const id = deps.newObjectId?.()
      let seq
      try { seq = deps.write?.setObjectId?.(target.name, id) } catch (error) {
        return cancelSave(error?.message ?? String(error))
      }
      state.given.set(target, id ?? null)
      state.pending = { seq, stage: 'target', node: target }
      state.saving = true
      render()
      return seq
    }

    return sendLeaf()
  }

  function sendLeaf() {
    // The leaf is rebuilt here, from the ids the nodes actually have; a target
    // that still has none is refused, never sent with a stand-in (R8).
    const result = convert({ forSend: true })
    if (!result) { state.saving = false; render(); return null }
    let seq
    try { seq = deps.write?.sendField?.(state.node.name, 'extras.atrium.behavior', result.value) } catch (error) {
      state.problem = error?.message ?? String(error)
      state.saving = false
      render()
      return null
    }
    state.pending = { seq, stage: 2, value: result.value }
    state.saving = true
    render()
    return seq
  }

  /** F9's answers, the same three kinds the form resolves. */
  function onAnswer(kind, message = {}) {
    const pending = state.pending
    if (!pending || pending.seq !== message.seq) return false
    state.pending = null
    if (kind !== 'edit:accepted') {
      // small-fixes — a refused id is not the node's: forget it, so a second
      // Save asks again instead of naming an id the server never gave.
      if (pending.stage === 'target') state.given.delete(pending.node)
      if (pending.stage === 1) state.ownId = idOf(state.node)
      state.problem = message.message || message.reason || 'the server refused the imported graph'
      state.saving = false
      deps.showError?.(state.problem)
      render()
      return true
    }
    // R11 — once a node has its id, its rows hold the id (normaliseHeld), so
    // the pickers keep their choice; then the next stage.
    if (pending.stage === 1 || pending.stage === 'target') { normaliseHeld(); nextStage(); return true }
    state.saving = false
    state.status = SAVED
    deps.clearError?.()
    deps.onSaved?.()
    render()
    return true
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function renderMapping() {
    const container = elements.mapping
    if (!container) return
    clear(container)
    const parsed = state.parsed
    if (!parsed) { show(container, false); return }
    show(container, true)
    normaliseHeld()

    for (const row of mappingRows()) {
      const line = create('div')
      if (!line) continue
      line.classList.add('ep-row')
      const label = create('span')
      // G6 — the reference's FILE name, and the op that holds it, as text.
      // R7 — a light row names its HOST node and the light table's index.
      const file = row.kind === 'animation'
        ? (parsed.fileAnimations.find((a) => a.index === row.fileIndex)?.name ?? `animation ${row.fileIndex}`)
        : row.kind === 'light'
          ? lightRowLabel(parsed, row.fileIndex)
          : (parsed.fileNodes.find((n) => n.index === row.fileIndex)?.name ?? `node ${row.fileIndex}`)
      label.textContent = `${file} (${row.kind})`
      line.appendChild(label)

      const picker = create('select')
      picker.setAttribute('aria-label', `${file} (${row.kind}) target`)
      picker.disabled = Boolean(state.saving)   // N-1 — held while a Save runs
      const options = candidatesFor(importTargetKind(row))
      const held = row.kind === 'animation'
        ? state.animations.find((animation) => animation.index === row.fileIndex)?.object ?? ''
        : state.mapping[`${row.kind}:${row.fileIndex}`] ?? ''
      if (!options.some((node) => pickerValue(node) === held)) {
        const placeholder = create('option')
        placeholder.value = ''
        placeholder.textContent = CHOOSE_TARGET
        placeholder.selected = true
        picker.appendChild(placeholder)
      }
      for (const node of options) {
        const option = create('option')
        option.value = pickerValue(node)
        option.textContent = node.name
        if (option.value === held) option.selected = true
        picker.appendChild(option)
      }
      picker._importRef = row
      line.appendChild(picker)
      container.appendChild(line)
    }
  }

  function renderGraphs() {
    const picker = elements.graphs
    if (!picker) return
    clear(picker)
    const graphs = state.parsed?.graphs ?? []
    show(picker, graphs.length > 0)
    graphs.forEach((_graph, index) => {
      const option = create('option')
      option.value = String(index)
      option.textContent = `graph ${index}`
      if (index === state.graphIndex) option.selected = true
      picker.appendChild(option)
    })
  }

  function render() {
    const open = state.open
    show(elements.panel, open)
    show(elements.open, !open)
    if (!open) return
    show(elements.source, true)
    renderGraphs()
    renderMapping()

    // G6 — the report, the grants and the notes, each a list of strings from
    // the conversion; every one of them is written with `textContent`.
    const report = state.conversion?.report ?? null
    const lines = []
    if (state.conversion) {
      const unsupported = report.unsupported.map((entry) => `${entry.op}${entry.extension ? ` (${entry.extension})` : ''} ×${entry.count}`)
      if (unsupported.length > 0) lines.push(`Unsupported: ${unsupported.join('; ')}`)
      const pointers = report.unsupportedPointers.map((entry) => `${entry.pointer} ×${entry.count}`)
      if (pointers.length > 0) lines.push(`Unsupported pointers: ${pointers.join('; ')}`)
      const kept = (state.references?.other ?? []).filter((entry) => entry.consumers.length === 0)
      if (kept.length > 0) lines.push(`Kept: ${kept.map((entry) => entry.ref).join('; ')}`)
      lines.push(report.namesDropped > 0 ? `names dropped: ${report.namesDropped}` : 'names dropped: 0')
    }
    text(elements.report, lines.join('\n'))
    // R16 (F4) — the grant line names the objects, through the same `nameOf`
    // the Q3 confirmation uses; an object with no name shows its id.
    text(elements.grants, state.conversion
      ? `It can change: ${report.grants.map((id) => grantName(id)).join(', ')}`
      : '')
    text(elements.notes, state.saving ? '' : importNotes(report).join('\n'))
    text(elements.status, state.problem ?? (state.status || (state.parsed
      ? (state.conversion ? MAPPED : CHOOSE_TARGET)
      : NO_GRAPH_YET)))
    if (elements.save) elements.save.disabled = !state.conversion || state.saving
    if (elements.close) elements.close.disabled = state.saving
    // N-1 — the file and graph pickers are held while a Save runs, as the
    // Behaviour form holds its fields (W8)
    if (elements.file) elements.file.disabled = Boolean(state.saving)
    if (elements.graphs) elements.graphs.disabled = Boolean(state.saving)
    text(elements.fileName, state.fileName)
  }

  // -------------------------------------------------------------------------
  // Open / close / wire
  // -------------------------------------------------------------------------

  function open() {
    state.open = true
    state.node = deps.selected?.() ?? null
    state.ownId = state.node?.extras?.atrium?.objectId ?? null
    state.mapping = {}
    state.conversion = null
    state.problem = null
    state.status = ''
    state.saving = false
    state.pending = null
    state.targetsAtSave = []
    state.given = new Map()
    if (state.parsed) convert()
    render()
  }

  function close() {
    state.open = false
    state.node = null
    state.pending = null
    state.saving = false
    render()
  }

  function wire() {
    if (elements.open) elements.open.addEventListener('click', () => open())
    if (elements.close) elements.close.addEventListener('click', () => close())
    if (elements.file) {
      elements.file.addEventListener('change', () => {
        const file = elements.file.files?.[0]
        if (file) chooseFile(file)
      })
    }
    if (elements.graphs) {
      elements.graphs.addEventListener('change', () => chooseGraph(elements.graphs.value))
    }
    if (elements.mapping) {
      elements.mapping.addEventListener('change', (event) => {
        const picker = event?.target
        const ref = picker?._importRef
        if (!ref) return
        if (ref.kind === 'animation') setAnimationTarget(ref.fileIndex, picker.value)
        else setTarget(ref.kind, ref.fileIndex, picker.value)
      })
    }
    if (elements.save) elements.save.addEventListener('click', () => save())
  }

  return {
    wire, open, close, render, save, onAnswer, chooseFile, chooseSource, chooseGraph,
    setTarget, setAnimationTarget, convert,
    get state() { return state },
    get openState() { return state.open },
  }
}
