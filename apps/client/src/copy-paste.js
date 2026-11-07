// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * copy-paste.js — copying an object in one world and pasting it into another
 * (devtasks/PREBRIEF-copy-objects.md, K2 and K5–K8). Pure: no DOM, no three.js,
 * no SOM object held.
 *
 * - `copyObject` (K5) runs Duplicate's rule with the credit skipped, builds the
 *   descriptor from the live node at click time and returns a SNAPSHOT: a deep
 *   copy plus where it came from, taken from the live connection. A later change
 *   to the original, or a teleport (which replaces the SOM), can't reach it.
 * - `preparePaste` (K6) works on a `structuredClone` of the snapshot and never
 *   changes it: the name, the position, a new `objectId`, the extras Atrium
 *   defines, the behaviour rule (K7), the URL rule (K8) and the credit (K2),
 *   then the size, `add-spec.js` and `atriumProblem` (the credit included).
 * - `behaviorSummary` and `creditLines` are what the Inspect panel and the
 *   Behaviour panel show (K4, K7). The credit is CLAIMED, never verified: its
 *   wording says so.
 */

import { AtriumClient } from '@atrium/client'
import { checkAddNode } from '@atrium/client/add-spec'
import { newObjectId } from '@atrium/client/object-id'
import { isRootRelative, resolveModelUrl, modelUrlProblem, modelReasonText } from '@atrium/client/model-spec'
import {
  duplicateRuleProblem, buildDescriptor, addMessageBytes, remapBehaviorTargets, atriumProblem,
  creditProblem, creditIdOk, creditNameOk, creditServerOk, creditAddressOk, MAX_ADD_BYTES, DUPLICATE_REASONS,
} from './edit-duplicate.js'
import { withNewObjectId } from './object-identity.js'
import { copyName } from './edit-palette.js'
import { resolveWorldAddress } from './wsUrl.js'
import { matchesTemplate } from './behavior-form.js'

/** K6 step 4 — the `extras.atrium` keys Atrium defines; any other is dropped at Paste. */
export const ATRIUM_KEYS = Object.freeze(['objectId', 'teleporter', 'model', 'animation', 'behavior', 'origin', 'copiedFrom'])

/** The SOM's hidden marker (`SOMNode.js`): a paste is always visible. */
export const HIDDEN_MARKER = '__atrium_visible'

/** K8 — a pad destination or model URL may not grow past this when made absolute. */
export const URL_MAX = 2048

/** K8 — "Library" credit only for a resolved URL under this path on the destination's own origin. */
export const LIBRARY_PREFIX = '/assets/library/'

export const LIBRARY_CREATOR = 'Library'

export const PASTE_TEXT = Object.freeze({
  noBase: 'This model’s address can’t be worked out from the world it was copied from',
  padNoBase: 'This pad’s destination can’t be worked out from the world it was copied from',
  padLength: `This pad’s destination would be over ${URL_MAX.toLocaleString('en-US')} characters on this server`,
  noSource: 'This world’s address can’t be read, so nothing here can be copied',
  serverTooLong: 'This world’s server address is too long to record in a copy’s credit',
  addressTooLong: 'This world’s address is too long to record in a copy’s credit',
  declined: 'Not pasted',
  empty: 'Nothing has been copied',
  selfless: 'Its behaviour doesn’t name its own object, so it can’t be pasted',
})

export const NOTE_TEXT = Object.freeze({
  refersTemplate: 'Its behaviour referred to other objects in that world: re-aim it in the Behaviour panel',
  refersCustom: 'Its behaviour referred to other objects in that world. It won’t run here, and a custom graph can’t be re-aimed yet.',
  creditReplaced: 'Its credit was malformed and has been replaced',
  disabled: 'Its behaviour arrives turned off',
})

/** K9 — C2's note and the models-by-url host note. */
export const VISITOR_NOTE = 'Visitors can see and copy anything in this world.'
export const VISIBILITY_NOTE = 'When this world is public, visitors can see and copy anything in it'
export const MODEL_HOST_NOTE = 'A model loaded from another host lets that host see your address.'

/** How many unknown keys a paste note names before "and N more". */
export const NOTE_KEYS_MAX = 5
const NOTE_KEY_CHARS = 40

/**
 * Text another user wrote, made safe to SHOW beside our own words: every
 * control, line-separator and text-direction character (K2's `creatorName`
 * set) is percent-encoded, so "Copied from <address>" can't be reordered by a
 * U+202E, and the result is cut to `max` characters. Display only: stored
 * values are never changed by this.
 */
export function shownText(value, max = Infinity) {
  let out = ''
  for (const ch of String(value)) {
    const c = ch.codePointAt(0)
    const unsafe = c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 ||
      (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)
    out += unsafe ? encodeURIComponent(ch) : ch
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out
}

/** "“a”, “b” and 3 more": a bounded list of key names for a note. */
function keyList(keys) {
  const shown = keys.slice(0, NOTE_KEYS_MAX).map((k) => `“${shownText(k, NOTE_KEY_CHARS)}”`).join(', ')
  return keys.length > NOTE_KEYS_MAX ? `${shown} and ${(keys.length - NOTE_KEYS_MAX).toLocaleString('en-US')} more` : shown
}

/** One K3-valid `refs` entry (K2: an entry that fails is treated as absent, the rest kept). */
function refEntryOk(r) {
  return isPlainObject(r) && Object.keys(r).every((k) => k === 'id' || k === 'was' || k === 'name') &&
    creditIdOk(r.id) && creditIdOk(r.was) && (!Object.hasOwn(r, 'name') || creditNameOk(r.name))
}

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** An origin, compared as `new URL(x).origin` with ws(s) read as http(s); null when unreadable. */
export function originOf(url) {
  if (typeof url !== 'string' || url.length === 0) return null
  const http = AtriumClient.wsOriginToHttpOrigin(url)
  if (!http) return null
  try {
    const o = new URL(http).origin
    return o === 'null' ? null : o
  } catch {
    return null
  }
}

/** The UTC day `YYYY-MM-DD` of a Date (or a string already in that form). */
function dayOf(date) {
  if (typeof date === 'string') return date
  const d = date instanceof Date ? date : new Date()
  return d.toISOString().slice(0, 10)
}

/**
 * The ids a behaviour refers to besides its own object: `nodeMap` from entry
 * 1, `targets`, `animations[].object` and `template.params.target`, each once,
 * in that order.
 */
export function foreignIds(behavior, ownId) {
  const out = []
  const add = (id) => { if (typeof id === 'string' && id !== ownId && !out.includes(id)) out.push(id) }
  if (!isPlainObject(behavior)) return out
  if (Array.isArray(behavior.nodeMap)) behavior.nodeMap.slice(1).forEach(add)
  if (Array.isArray(behavior.targets)) behavior.targets.forEach(add)
  if (Array.isArray(behavior.animations)) for (const a of behavior.animations) add(a?.object)
  add(behavior.template?.params?.target)
  return out
}

/** Every id in the same places (entry 0 of `nodeMap` excepted), swapped through `map`. */
function swapIds(behavior, map) {
  const swap = (id) => (map.has(id) ? map.get(id) : id)
  const copy = structuredClone(behavior)
  if (Array.isArray(copy.nodeMap)) copy.nodeMap = copy.nodeMap.map((id, i) => (i === 0 ? id : swap(id)))
  if (Array.isArray(copy.targets)) copy.targets = copy.targets.map(swap)
  if (Array.isArray(copy.animations)) {
    copy.animations = copy.animations.map((a) => (isPlainObject(a) ? { ...a, object: swap(a.object) } : a))
  }
  if (isPlainObject(copy.template) && isPlainObject(copy.template.params) && Object.hasOwn(copy.template.params, 'target')) {
    copy.template = { ...copy.template, params: { ...copy.template.params, target: swap(copy.template.params.target) } }
  }
  return copy
}

/** Is this behaviour one of the templates (so "Choose a target…" can re-aim it)? */
export function isTemplateBehavior(behavior, ownId) {
  try { return matchesTemplate(behavior, ownId) } catch { return false }
}

// ---------------------------------------------------------------------------
// K5 — Copy
// ---------------------------------------------------------------------------

/**
 * Copy a node: Duplicate's rule (the credit skipped), the descriptor built now,
 * and where it came from. Never holds the node.
 *
 * @param {object} node  the live glTF-Transform Node
 * @param {object} source
 * @param {string} source.wsUrl     the live connection's URL (never the File box base)
 * @param {object|null} [source.world]  K1's `client.world`, or null
 * @param {string} [source.address] the world's path; the connection URL's path when absent
 * @param {object} [opts]
 * @param {Date|string} [opts.date]  the Copy's day (K2's `at`)
 * @param {(id: string) => string|null} [opts.nameOf]  an object's name in the source world, or null
 * @returns {{ok: true, snapshot: object} | {ok: false, rule: string, reason: string}}
 */
export function copyObject(node, source, { date = new Date(), nameOf = null } = {}) {
  const problem = duplicateRuleProblem(node, { credit: false })
  if (problem) return problem
  const wsUrl = source?.wsUrl
  const baseUrl = AtriumClient.wsOriginToHttpOrigin(wsUrl ?? null)
  const origin = originOf(baseUrl)
  if (!origin) return { ok: false, rule: 'source', reason: PASTE_TEXT.noSource }
  if (!creditServerOk(origin)) return { ok: false, rule: 'source', reason: PASTE_TEXT.serverTooLong }
  let address = source?.address
  if (typeof address !== 'string') {
    try { address = new URL(wsUrl).pathname || '/' } catch { address = '/' }
  }
  if (!creditAddressOk(address)) return { ok: false, rule: 'source', reason: PASTE_TEXT.addressTooLong }
  const descriptor = buildDescriptor(node, node.getName(), 0)
  const bytes = addMessageBytes(descriptor)
  if (bytes > MAX_ADD_BYTES) {
    return {
      ok: false, rule: 'size',
      reason: `${DUPLICATE_REASONS.size} (${bytes.toLocaleString('en-US')} bytes; the limit is ${MAX_ADD_BYTES.toLocaleString('en-US')})`,
    }
  }
  const atrium = descriptor.extras?.atrium
  const sourceId = typeof atrium?.objectId === 'string' ? atrium.objectId : null
  const names = {}
  for (const id of foreignIds(atrium?.behavior, sourceId)) {
    let name = null
    try { name = nameOf ? nameOf(id) : null } catch { name = null }
    if (typeof name === 'string' && name.length > 0) names[id] = name
  }
  const snapshot = {
    descriptor,
    sourceId,
    date: dayOf(date),
    names,
    source: {
      origin,
      baseUrl,
      wsUrl,
      address,
      world: source?.world ? structuredClone(source.world) : null,
    },
  }
  return { ok: true, snapshot }
}

// ---------------------------------------------------------------------------
// K6–K8 — Paste
// ---------------------------------------------------------------------------

function refuse(reason, extra = {}) {
  return { ok: false, reason, ...extra }
}

/** K2's fill of `origin` for another world. */
function fillOrigin(existing, { snapshot, library }) {
  if (existing !== undefined) return existing
  const server = snapshot.source.origin
  const at = snapshot.date
  if (library) return { server, at, creatorName: LIBRARY_CREATOR }
  const out = { server }
  const world = snapshot.source.world
  if (creditIdOk(world?.id)) out.world = world.id
  if (creditIdOk(world?.owner?.id)) out.creator = world.owner.id
  if (creditNameOk(world?.owner?.name)) out.creatorName = world.owner.name
  out.at = at
  return out
}

/**
 * Prepare the `add` for a paste. Never changes `clipboard`.
 *
 * @param {object} clipboard  a snapshot from `copyObject`
 * @param {object} opts
 * @param {string} [opts.name]          the name to use (the retry's); else from `isFree`
 * @param {(name: string) => boolean} [opts.isFree]  is a name free in the destination?
 * @param {number[]} opts.position      the palette's spot ahead of you, `[x, 0, z]`
 * @param {string} opts.destOrigin      the destination's origin (its connection, read as http(s))
 * @param {string|null} opts.destWorldId  the destination's `client.world.id`, or null
 * @param {(text: string) => boolean} [opts.confirm]  asks the owner; absent declines
 * @param {() => string} [opts.newId]   the id source (tests)
 * @returns {{ok: true, descriptor: object, bytes: number, notes: string[], sameWorld: boolean}
 *          | {ok: false, reason: string, declined?: true}}
 */
export function preparePaste(clipboard, { name, isFree = () => true, position, destOrigin, destWorldId = null, confirm = null, newId = newObjectId } = {}) {
  if (!clipboard || !isPlainObject(clipboard.descriptor) || !isPlainObject(clipboard.source)) return refuse(PASTE_TEXT.empty)
  const snapshot = structuredClone(clipboard)
  const notes = []
  const src = snapshot.source
  const dest = originOf(destOrigin)
  if (dest === null) return refuse(PASTE_TEXT.noSource)
  const sameOrigin = originOf(src.origin) === dest
  const sameWorld = sameOrigin && typeof src.world?.id === 'string' && typeof destWorldId === 'string' &&
    src.world.id === destWorldId

  // 1. the name
  const original = snapshot.descriptor.name
  const chosen = typeof name === 'string' ? name : (isFree(original) ? original : copyName(original, isFree))
  if (chosen == null) return refuse('No free name for the copy')

  // 2. the translation: x and z from the palette, y the original's own
  const t = snapshot.descriptor.translation ?? [0, 0, 0]
  const translation = [position?.[0] ?? t[0], t[1], position?.[2] ?? t[2]]

  // 3. a new objectId
  const copyId = newId()
  let descriptor = withNewObjectId({ ...snapshot.descriptor, name: chosen, translation }, () => copyId)

  // 4. extras: the hidden marker gone; only Atrium's keys; the teleporter exactly { destination }
  const extras = { ...descriptor.extras }
  delete extras[HIDDEN_MARKER]
  const atrium = {}
  const dropped = []
  for (const [key, value] of Object.entries(extras.atrium)) {
    if (ATRIUM_KEYS.includes(key)) atrium[key] = value
    else dropped.push(key)
  }
  // One note, however many keys a source planted, each name shown safely.
  if (dropped.length > 0) notes.push(`Dropped its Atrium data ${keyList(dropped)}, which this version doesn’t use`)
  if (Object.hasOwn(atrium, 'teleporter')) {
    const tp = atrium.teleporter
    const extra = isPlainObject(tp) ? Object.keys(tp).filter((k) => k !== 'destination') : []
    if (extra.length > 0) notes.push(`Dropped its pad data ${keyList(extra)}, which this version doesn’t use`)
    atrium.teleporter = { destination: tp?.destination }
  }

  // 5. the behaviour (K7)
  if (Object.hasOwn(atrium, 'behavior') && atrium.behavior !== null) {
    let behavior = remapBehaviorTargets(atrium.behavior, snapshot.sourceId, copyId)
    if (!sameWorld) {
      const template = isTemplateBehavior(atrium.behavior, snapshot.sourceId)
      behavior = { ...behavior, enabled: false }
      const old = foreignIds(behavior, copyId)
      if (old.length > 0) {
        const map = new Map(old.map((id) => [id, newId()]))
        behavior = swapIds(behavior, map)
        // K2: a refs entry that fails K3 is treated as absent; the others are kept.
        const priorRefs = isPlainObject(atrium.copiedFrom) && Array.isArray(atrium.copiedFrom.refs)
          ? atrium.copiedFrom.refs.filter(refEntryOk) : []
        snapshot.refs = old.map((was) => {
          const prior = priorRefs.find((r) => r.id === was)
          const entry = { id: map.get(was), was: prior ? prior.was : was }
          const n = prior ? prior.name : snapshot.names?.[was]
          if (creditNameOk(n)) entry.name = n
          return entry
        })
        notes.push(template ? NOTE_TEXT.refersTemplate : NOTE_TEXT.refersCustom)
      }
      if (atrium.behavior.enabled === true) notes.push(NOTE_TEXT.disabled)
    }
    atrium.behavior = behavior
  }

  // 6. URLs (K8)
  let library = false
  if (isPlainObject(atrium.model) && typeof atrium.model.url === 'string') {
    let url = atrium.model.url
    if (!sameOrigin && isRootRelative(url)) {
      const r = resolveModelUrl(url, src.baseUrl)
      if (!r.ok) return refuse(PASTE_TEXT.noBase)
      const problem = modelUrlProblem(r.url)
      if (problem) return refuse(modelReasonText(problem))
      url = r.url
      atrium.model = { ...atrium.model, url }
    }
    // "resolved": a root path means the destination's own server.
    let resolved = null
    try { resolved = new URL(url, dest) } catch { resolved = null }
    const resolvedOrigin = resolved ? resolved.origin : null
    if (resolvedOrigin !== dest) {
      const host = resolved ? resolved.host : url
      const question = `This model is loaded from ${host}. Pasting it makes your browser, and your visitors’, fetch from there. Paste?`
      let yes = false
      try { yes = typeof confirm === 'function' && confirm(question) === true } catch { yes = false }
      if (!yes) return refuse(PASTE_TEXT.declined, { declined: true })
    }
    library = resolved !== null && resolvedOrigin === dest && resolved.pathname.startsWith(LIBRARY_PREFIX)
  }
  if (!sameOrigin && isPlainObject(atrium.teleporter)) {
    const d = atrium.teleporter.destination
    if (typeof d === 'string' && d !== '' && !d.startsWith('ws://') && !d.startsWith('wss://')) {
      const resolvedDest = resolveWorldAddress(d, src.wsUrl)
      if (resolvedDest == null) return refuse(PASTE_TEXT.padNoBase)
      if (resolvedDest.length > URL_MAX) return refuse(PASTE_TEXT.padLength)
      atrium.teleporter = { destination: resolvedDest }
    }
  }

  // 7. the credit (K2); a same-world paste is a Duplicate and changes none
  if (!sameWorld) {
    const originOk = Object.hasOwn(atrium, 'origin') && creditProblem(atrium, { key: 'origin' }) === null
    const malformed = (Object.hasOwn(atrium, 'origin') && !originOk) ||
      (Object.hasOwn(atrium, 'copiedFrom') && creditProblem(atrium, { key: 'copiedFrom' }) !== null)
    if (malformed) notes.push(NOTE_TEXT.creditReplaced)
    atrium.origin = fillOrigin(originOk ? atrium.origin : undefined, { snapshot, library })
    const copiedFrom = { server: src.origin }
    if (creditIdOk(src.world?.id)) copiedFrom.world = src.world.id
    copiedFrom.address = src.address
    copiedFrom.at = snapshot.date
    if (Array.isArray(snapshot.refs) && snapshot.refs.length > 0) copiedFrom.refs = snapshot.refs
    atrium.copiedFrom = copiedFrom
    if (!creditServerOk(copiedFrom.server)) return refuse(PASTE_TEXT.noSource)
  }

  extras.atrium = atrium
  descriptor = { ...descriptor, extras }

  // 8. size, then add-spec (A7), then atriumProblem with the credit
  const bytes = addMessageBytes(descriptor)
  if (bytes > MAX_ADD_BYTES) {
    return refuse(`${DUPLICATE_REASONS.size} (${bytes.toLocaleString('en-US')} bytes; the limit is ${MAX_ADD_BYTES.toLocaleString('en-US')})`)
  }
  const spec = checkAddNode(descriptor)
  if (spec) return refuse(`${DUPLICATE_REASONS.add} (${spec.code}: ${spec.message})`)
  // K7 — the behaviour must name the copy as its own object (entry 0). Copy
  // accepts a behaviour on a node with no own id; only another server can send
  // one (a real Atrium server heals it at load), and Paste refuses it.
  const pasted = atrium.behavior
  if (isPlainObject(pasted) && Array.isArray(pasted.nodeMap) && pasted.nodeMap[0] !== copyId) {
    return refuse(PASTE_TEXT.selfless)
  }
  const a = atriumProblem(descriptor.extras)
  if (a) return refuse(`${DUPLICATE_REASONS.atrium} (${a})`)
  return { ok: true, descriptor, bytes, notes, sameWorld }
}

// ---------------------------------------------------------------------------
// K4/K7 — what the panels show
// ---------------------------------------------------------------------------

/**
 * The credit, worded as claimed. Every string is plain text for `textContent`.
 *
 * @param {object|null|undefined} atrium  an object's `extras.atrium`
 * @returns {string[]}  lines; empty when it carries no credit
 */
export function creditLines(atrium) {
  if (!isPlainObject(atrium)) return []
  const lines = []
  const origin = atrium.origin
  const cf = atrium.copiedFrom
  if (Object.hasOwn(atrium, 'origin') && creditProblem(atrium, { key: 'origin' }) === null) {
    const where = `${hostOf(origin.server)}, ${origin.at}`
    if (origin.creatorName === LIBRARY_CREATOR && origin.creator === undefined) {
      lines.push(`From the library, it says (${where})`)
    } else if (origin.creatorName !== undefined) {
      lines.push(`Made by ${origin.creatorName}, it says (${where})`)
    } else {
      lines.push(`First copied from a world on ${where}, it says`)
    }
  } else if (Object.hasOwn(atrium, 'origin')) {
    lines.push('Its credit is malformed')
  }
  if (Object.hasOwn(atrium, 'copiedFrom') && creditProblem(atrium, { key: 'copiedFrom' }) === null) {
    // K2's address form allows text-direction characters; they are shown escaped.
    lines.push(`Copied from ${shownText(cf.address, 200)} on ${hostOf(cf.server)}, ${cf.at}, it says`)
  } else if (Object.hasOwn(atrium, 'copiedFrom') && !lines.includes('Its credit is malformed')) {
    lines.push('Its credit is malformed')
  }
  return lines
}

function hostOf(server) {
  try { return new URL(server).host } catch { return String(server) }
}

/**
 * The behaviour's summary (K4) and, for a pasted one, its record (K7).
 *
 * @param {object|null} atrium  the object's `extras.atrium`
 * @param {object} [opts]
 * @param {(id: string) => string|null} [opts.nameOf]  a name in THIS world, or null
 * @returns {null | {kind: 'template'|'custom', label: string, enabled: boolean, refers: string[], note: string|null, record: string|null}}
 */
export function behaviorSummary(atrium, { nameOf = null, templateLabel = null } = {}) {
  const behavior = atrium?.behavior
  if (!isPlainObject(behavior)) return null
  const ownId = typeof atrium.objectId === 'string' ? atrium.objectId : null
  const template = isTemplateBehavior(behavior, ownId)
  const ids = foreignIds(behavior, ownId)
  const refers = ids.map((id) => {
    let n = null
    try { n = nameOf ? nameOf(id) : null } catch { n = null }
    return typeof n === 'string' && n.length > 0 ? n : 'an object not in this world'
  })
  const label = template
    ? (templateLabel ? templateLabel(behavior.template.id) : behavior.template.id)
    : 'Custom graph'
  return {
    kind: template ? 'template' : 'custom',
    label,
    enabled: behavior.enabled === true,
    refers,
    note: ids.length > 0 ? (template ? NOTE_TEXT.refersTemplate : NOTE_TEXT.refersCustom) : null,
    record: refsRecordText(atrium),
  }
}

/** The summary as the Inspect panel's lines, plain text for `textContent`. */
export function behaviorSummaryLines(summary) {
  if (!summary) return []
  const lines = [`${summary.label}, ${summary.enabled ? 'enabled' : 'disabled'}`]
  if (summary.refers.length > 0) lines.push(`Refers to ${summary.refers.join(', ')}`)
  if (summary.note) lines.push(summary.note)
  if (summary.record) lines.push(summary.record)
  return lines
}

/**
 * K7's record, as the Behaviour panel shows it: "It referred to Front door,
 * Lamp in that world". Null when there is no valid record.
 */
export function refsRecordText(atrium) {
  if (!isPlainObject(atrium) || !Object.hasOwn(atrium, 'copiedFrom')) return null
  if (creditProblem(atrium, { key: 'copiedFrom' }) !== null) return null
  const refs = atrium.copiedFrom.refs
  if (!Array.isArray(refs) || refs.length === 0) return null
  const named = refs.map((r) => r.name ?? 'an unnamed object')
  return `It referred to ${named.join(', ')} in the world it was copied from`
}
