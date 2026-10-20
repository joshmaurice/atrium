// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { modelExtrasProblem, modelReasonText } from '@atrium/client/model-spec'

/**
 * edit-duplicate.js — whether a node can be duplicated, and the `add`
 * descriptor of its copy (Phase 3 step 1b-2, N3). Pure: no DOM, no three.js.
 *
 * The contract is lossless (D5): a node is eligible only if everything it has
 * survives an `add` (`SOMDocument.ingestNode` keeps the node's TRS and extras,
 * the mesh name, POSITION / NORMAL / indices and three material factors).
 * Anything else is refused, whether or not it changes what's rendered today.
 *
 * It reads the glTF-Transform node itself (`getMesh()`, `listPrimitives()`…):
 * the SOM wrappers don't expose geometry (J4). Call it at click time; nothing
 * is cached, because the owner's own edits emit no `som:set` (I14).
 */

/** Rule 9: the whole `add` message, in UTF-8 bytes. The server's cap is 1 MiB. */
export const MAX_ADD_BYTES = 1_000_000

/** Where the copy goes: this far along world X from the original (J3: root only). */
export const DUPLICATE_OFFSET_X = 1.5

/** The server's K6 limits on `add` (session.js / send-policy.js). */
export const UNIT_TOLERANCE = 1e-3
export const MIN_SCALE = 1e-6

const FLOAT = 5126                 // glTF componentType FLOAT
const TRIANGLES = 4
const MAX_INDEX = 65535            // ingestNode stores indices as Uint16Array
const SCENE_GRAPH_PARENTS = new Set(['Root', 'Scene', 'Node'])

export const DUPLICATE_REASONS = Object.freeze({
  children:   'Objects with children can’t be duplicated yet',
  parent:     'Only top-level objects can be duplicated yet',
  attached:   'Objects with a camera, light or skin can’t be duplicated',
  referenced: 'This object is animated or part of a skin; a copy would lose that',
  external:   'Externally loaded content can’t be duplicated',
  atrium:     'This object’s Atrium data would be refused by the server',
  mesh:       'This object’s mesh has data a copy would lose',
  extensions: 'This object has extensions a copy would lose',
  transform:  'Fix this object’s rotation or scale before duplicating it',
  size:       'This object is too large to duplicate',
})

function deny(rule, detail) {
  const base = DUPLICATE_REASONS[rule]
  return { ok: false, rule, reason: detail ? `${base} (${detail})` : base }
}

function isEmptyObject(v) {
  return v == null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
}

function hasExtensions(prop) {
  return (prop.listExtensions?.() ?? []).length > 0
}

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

const DESTINATION_MAX = 2048    // send-policy.js checkTeleporterDestination

// The server's L5 checks on a non-avatar `add` (send-policy.js
// checkAtriumExtras), so a legacy value is refused here, not by the server.
// models-by-url (Z1) adds its model rule from the shared client module, so
// Duplicate and Undo report an invalid legacy model value instead of sending an
// `add` the server refuses. Both sides read the same vectors file.
function atriumProblem(extras) {
  if (extras == null || typeof extras !== 'object') return null
  if (!Object.hasOwn(extras, 'atrium')) return null
  const atrium = extras.atrium
  if (!isPlainObject(atrium)) return 'extras.atrium is not an object'
  if (Object.hasOwn(atrium, 'teleporter')) {
    const tp = atrium.teleporter
    if (!isPlainObject(tp)) return 'its teleporter data is not an object'
    if (typeof tp.destination !== 'string') return 'its teleporter destination is not text'
    if (tp.destination.length > DESTINATION_MAX) return `its teleporter destination is over ${DESTINATION_MAX} characters`
  }
  const modelProblem = modelExtrasProblem(extras)
  if (modelProblem) return `its model data would be refused (${modelReasonText(modelProblem)})`
  return null
}

// An accessor carries only what ingestNode rebuilds: values, nothing else.
function accessorProblem(acc, label, { vec3 }) {
  if (acc.getName() !== '') return `${label} accessor has a name`
  if (!isEmptyObject(acc.getExtras())) return `${label} accessor has extras`
  if (hasExtensions(acc)) return `${label} accessor has extensions`
  const buf = acc.getBuffer?.()
  if (buf && (buf.getName() !== '' || !isEmptyObject(buf.getExtras()) || hasExtensions(buf))) {
    return `${label} buffer has a name, extras or extensions`
  }
  if (acc.getSparse?.()) return `${label} accessor is sparse`
  if (vec3) {
    if (acc.getType() !== 'VEC3') return `${label} is not VEC3`
    if (acc.getComponentType() !== FLOAT) return `${label} is not float`
    if (acc.getNormalized()) return `${label} is normalized`
  }
  return null
}

function materialProblem(mat) {
  if (!mat) return null
  if (mat.getName() !== '') return 'material has a name'
  if (!isEmptyObject(mat.getExtras())) return 'material has extras'
  if (hasExtensions(mat)) return 'material has extensions'
  if (mat.getBaseColorTexture() || mat.getMetallicRoughnessTexture() || mat.getNormalTexture() ||
      mat.getOcclusionTexture() || mat.getEmissiveTexture()) return 'material has textures'
  const e = mat.getEmissiveFactor()
  if (e[0] !== 0 || e[1] !== 0 || e[2] !== 0) return 'material is emissive'
  if (mat.getAlphaMode() !== 'OPAQUE') return 'material is not opaque'
  if (mat.getDoubleSided()) return 'material is double-sided'
  return null
}

function meshProblem(mesh) {
  if ((mesh.getWeights() ?? []).length > 0) return 'morph weights'
  if (hasExtensions(mesh)) return 'mesh extensions'
  if (!isEmptyObject(mesh.getExtras())) return 'mesh extras'
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== TRIANGLES) return 'not triangles'
    if (hasExtensions(prim)) return 'primitive extensions'
    if (!isEmptyObject(prim.getExtras())) return 'primitive extras'
    if (prim.listTargets().length > 0) return 'morph targets'
    const semantics = prim.listSemantics().slice().sort()
    const ok = semantics.length === 1 ? semantics[0] === 'POSITION'
      : semantics.length === 2 && semantics[0] === 'NORMAL' && semantics[1] === 'POSITION'
    if (!ok) return `attributes ${semantics.join(', ')}`
    for (const sem of semantics) {
      const p = accessorProblem(prim.getAttribute(sem), sem, { vec3: true })
      if (p) return p
    }
    const idx = prim.getIndices()
    if (idx) {
      const p = accessorProblem(idx, 'index', { vec3: false })
      if (p) return p
      for (const i of idx.getArray()) if (i > MAX_INDEX) return 'an index above 65535'
    }
    const m = materialProblem(prim.getMaterial())
    if (m) return m
  }
  return null
}

function transformProblem(rotation, scale) {
  const len = Math.hypot(...rotation)
  if (!(Math.abs(len - 1) <= UNIT_TOLERANCE)) return 'its rotation is not a unit quaternion'
  if (!scale.every((s) => Math.abs(s) >= MIN_SCALE)) return 'its scale has a zero component'
  return null
}

function sendableArray(acc) {
  return Array.from(acc.getArray())
}

/**
 * The descriptor, from current values. Assumes the rules passed.
 * `offsetX` is 0 for a restore (Y2): the node's own translation, bit for bit
 * — never `x + 1.5 − 1.5`, which is not always `x` in floating point (U5).
 */
function buildDescriptor(node, name, offsetX) {
  const t = node.getTranslation()
  const descriptor = {
    name,
    translation: offsetX ? [t[0] + offsetX, t[1], t[2]] : [t[0], t[1], t[2]],
    rotation: [...node.getRotation()],
    scale: [...node.getScale()],
  }
  const extras = node.getExtras()
  if (!isEmptyObject(extras)) descriptor.extras = structuredClone(extras)
  const mesh = node.getMesh()
  if (mesh) {
    const primitives = mesh.listPrimitives().map((prim) => {
      const out = { attributes: { POSITION: sendableArray(prim.getAttribute('POSITION')) } }
      const normal = prim.getAttribute('NORMAL')
      if (normal) out.attributes.NORMAL = sendableArray(normal)
      const idx = prim.getIndices()
      if (idx) out.indices = sendableArray(idx)
      const mat = prim.getMaterial()
      if (mat) {
        out.material = {
          pbrMetallicRoughness: {
            baseColorFactor: [...mat.getBaseColorFactor()],
            metallicFactor:  mat.getMetallicFactor(),
            roughnessFactor: mat.getRoughnessFactor(),
          },
        }
      }
      return out
    })
    descriptor.mesh = mesh.getName() !== '' ? { name: mesh.getName(), primitives } : { primitives }
  }
  return descriptor
}

/** UTF-8 size of the whole `add` message that would carry `descriptor`. */
export function addMessageBytes(descriptor) {
  const msg = { type: 'add', seq: Number.MAX_SAFE_INTEGER, node: descriptor }
  return new TextEncoder().encode(JSON.stringify(msg)).length
}

/**
 * A lower bound on the copy's geometry in JSON: every number is at least one
 * digit plus a comma. Cheap, so a mesh far over the cap is refused without
 * building megabytes of JSON (outside review S2).
 */
function minGeometryBytes(mesh) {
  let elements = 0
  for (const prim of mesh.listPrimitives()) {
    for (const sem of prim.listSemantics()) elements += prim.getAttribute(sem).getArray().length
    const idx = prim.getIndices()
    if (idx) elements += idx.getArray().length
  }
  return elements * 2
}

/**
 * Rules 1–8 of N3, and rule 9's lower bound, without building the copy.
 * Cheap enough for the button's hint, which runs on many events (S2); the
 * click runs prepareDuplicate, which measures the real size.
 *
 * @param {object} node  the glTF-Transform Node
 * @returns {null | {ok: false, rule: string, reason: string}}  null when no rule refuses it
 */
export function duplicateRuleProblem(node) {
  if (node.listChildren().length > 0) return deny('children')
  const parents = node.listParents().map((p) => p.propertyType)
  if (parents.includes('Node')) return deny('parent')
  if (node.getCamera() || node.getSkin() || node.getExtension?.('KHR_lights_punctual')) return deny('attached')
  if (parents.some((t) => !SCENE_GRAPH_PARENTS.has(t))) return deny('referenced')
  const extras = node.getExtras()
  // The server refuses any own `source` key, `null` included (S2 in session.js).
  const atrium = extras?.atrium
  if (atrium !== null && typeof atrium === 'object' && Object.hasOwn(atrium, 'source')) return deny('external')
  const a = atriumProblem(extras)
  if (a) return deny('atrium', a)
  if ((node.getWeights?.() ?? []).length > 0) return deny('mesh', 'node morph weights')
  const mesh = node.getMesh()
  if (mesh) {
    const p = meshProblem(mesh)
    if (p) return deny('mesh', p)
  }
  if (hasExtensions(node)) return deny('extensions')
  const t = transformProblem(node.getRotation(), node.getScale())
  if (t) return deny('transform', t)
  if (mesh) {
    const min = minGeometryBytes(mesh)
    if (min > MAX_ADD_BYTES) {
      return deny('size', `at least ${min.toLocaleString('en-US')} bytes; the limit is ${MAX_ADD_BYTES.toLocaleString('en-US')}`)
    }
  }
  return null
}

/**
 * Can this node be duplicated, and if so, what does the copy look like?
 * Rules 1–9 of N3, in order; the first that fails is reported.
 *
 * @param {object} node  the glTF-Transform Node (read now, at click time)
 * @param {object} opts
 * @param {string} opts.name  the copy's name (J5); it counts toward rule 9
 * @returns {{ok: true, descriptor: object, bytes: number} | {ok: false, rule: string, reason: string}}
 */
export function prepareDuplicate(node, { name }) {
  const problem = duplicateRuleProblem(node)
  if (problem) return problem
  const descriptor = buildDescriptor(node, name, DUPLICATE_OFFSET_X)
  const bytes = addMessageBytes(descriptor)
  if (bytes > MAX_ADD_BYTES) return deny('size', `${bytes.toLocaleString('en-US')} bytes; the limit is ${MAX_ADD_BYTES.toLocaleString('en-US')}`)
  return { ok: true, descriptor, bytes }
}

/**
 * Y2 — the `add` that brings this node back exactly as it is now. Rules 1–9
 * are N3's, unchanged; the descriptor is built by the same code as a copy but
 * with the node's own name and its own translation, no offset applied or
 * subtracted (U5). Its output is the canonical form the undo engine compares:
 * the same node gives the same descriptor, key order included.
 *
 * @param {object} node  the glTF-Transform Node (read now, from current values)
 * @param {object} [opts]
 * @param {string} [opts.name]  defaults to the node's own name
 * @returns {{ok: true, descriptor: object, bytes: number} | {ok: false, rule: string, reason: string}}
 */
export function prepareRestore(node, { name = node.getName?.() } = {}) {
  const problem = duplicateRuleProblem(node)
  if (problem) return problem
  const descriptor = buildDescriptor(node, name, 0)
  const bytes = addMessageBytes(descriptor)
  if (bytes > MAX_ADD_BYTES) return deny('size', `${bytes.toLocaleString('en-US')} bytes; the limit is ${MAX_ADD_BYTES.toLocaleString('en-US')}`)
  return { ok: true, descriptor, bytes }
}
