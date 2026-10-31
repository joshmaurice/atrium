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
} from './graph-import.js'

export const IMPORT_OPEN_LABEL = 'Import a graph…'
export const CHOOSE_TARGET = 'Choose a target…'
export const CHOOSE_GRAPH = 'Choose a graph…'
export const NO_GRAPH_YET = 'Choose a graph file to begin'
export const MAPPED = 'Every reference is mapped.'
export const SAVED = 'Saved. Edit the graph from the Behaviour section.'

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
    pending: null,         // { seq, stage }
  }

  const show = (element, visible) => { if (element) element.style.display = visible ? '' : 'none' }
  const text = (element, value) => { if (element) element.textContent = value ?? '' }
  const clear = (element) => { while (element?.firstChild) element.removeChild(element.firstChild) }

  // -------------------------------------------------------------------------
  // The SOM, as the picker sees it
  // -------------------------------------------------------------------------

  const pickerValue = (node) => (node ? (node.extras?.atrium?.objectId ?? `name:${node.name}`) : null)
  const nodeByValue = (value) => (deps.nodes?.() ?? []).find((node) => pickerValue(node) === value) ?? null

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
    let bytes = file.bytes
    if (!(bytes instanceof Uint8Array)) {
      if (typeof file.arrayBuffer === 'function') bytes = new Uint8Array(await file.arrayBuffer())
      else bytes = file
    }
    return chooseSource(bytes, name)
  }

  function chooseSource(bytes, name = '') {
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
    if (!value) delete state.mapping[`${kind}:${fileIndex}`]
    else state.mapping[`${kind}:${fileIndex}`] = value
    state.conversion = null
    state.problem = null
    state.status = ''
    convert()
    render()
  }

  function setAnimationTarget(fileIndex, value) {
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
   * X3's pattern (behavior-form.js) — before Save has given the node an
   * `objectId`, the conversion still has to be shown, so it is built with a
   * STAND-IN own id: it is in `OBJECT_ID_RE`'s form and it never reaches a
   * send. `sendLeaf` re-converts with the id the node actually got.
   */
  const OWN_STAND_IN = '00000000-0000-4000-8000-000000000001'

  /** The `mapping` `convertGraph` takes, or null while a row is unmapped. */
  function mappingFor() {
    const mapping = { own: state.ownId ?? OWN_STAND_IN, nodes: {}, subtree: [] }
    for (const row of mappingRows()) {
      if (row.kind === 'animation') continue
      const held = state.mapping[`${row.kind}:${row.fileIndex}`]
      if (!held) return null
      mapping.nodes[row.fileIndex] = held
    }
    // The own node is not a "reference"; the mapping still names it, so a graph
    // that points at the object it was imported onto converts.
    mapping.animations = state.animations.map((animation) => ({
      index: animation.index, object: animation.object, clip: animation.clip, loop: animation.loop === true,
    }))
    return mapping
  }

  function convert() {
    const graph = state.parsed?.graphs?.[state.graphIndex]
    if (!graph || !state.node) return null
    const mapping = mappingFor()
    if (!mapping) { state.conversion = null; return null }
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
    const node = state.node

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

    return sendLeaf()
  }

  function sendLeaf() {
    // The leaf is rebuilt here, from the ids the node actually has.
    const result = convert()
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
      state.problem = message.message || message.reason || 'the server refused the imported graph'
      state.saving = false
      deps.showError?.(state.problem)
      render()
      return true
    }
    if (pending.stage === 1) { sendLeaf(); return true }
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

    for (const row of mappingRows()) {
      const line = create('div')
      if (!line) continue
      line.classList.add('ep-row')
      const label = create('span')
      // G6 — the reference's FILE name, and the op that holds it, as text.
      const file = row.kind === 'animation'
        ? (parsed.fileAnimations.find((a) => a.index === row.fileIndex)?.name ?? `animation ${row.fileIndex}`)
        : (parsed.fileNodes.find((n) => n.index === row.fileIndex)?.name ?? `node ${row.fileIndex}`)
      label.textContent = `${file} (${row.kind})`
      line.appendChild(label)

      const picker = create('select')
      picker.setAttribute('aria-label', `${file} (${row.kind}) target`)
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
    text(elements.grants, state.conversion ? `It can change: ${report.grants.join(', ')}` : '')
    text(elements.notes, state.saving ? '' : importNotes(report).join('\n'))
    text(elements.status, state.problem ?? (state.status || (state.parsed
      ? (state.conversion ? MAPPED : CHOOSE_TARGET)
      : NO_GRAPH_YET)))
    if (elements.save) elements.save.disabled = !state.conversion || state.saving
    if (elements.close) elements.close.disabled = state.saving
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
