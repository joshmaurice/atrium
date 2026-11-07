// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { modelExtrasProblem, modelReasonText } from '@atrium/client/model-spec'
import { checkAddNode } from '@atrium/client/add-spec'
import { objectIdProblem } from '@atrium/client/object-id'
import { withNewObjectId } from './object-identity.js'
import { newObjectId } from '@atrium/client/object-id'
import { behaviorCheck } from '@atrium/behaviors/behavior-spec'

/**
 * edit-duplicate.js — whether a node can be duplicated, and the `add`
 * descriptor of its copy (Phase 3 step 1b-2, N3). Pure: no DOM, no three.js.
 *
 * The contract is lossless (D5): a node is eligible only if everything a save
 * keeps of it survives an `add`. `SOMDocument.ingestNode` keeps the node's TRS
 * and extras; the mesh's name and extras; per primitive its extras, POSITION,
 * NORMAL, TEXCOORD_0/1, COLOR_0 (all FLOAT) and indices; and the material's
 * name, extras, three factors, emissive, alpha mode, cutoff and double-sided
 * (richer-add R4/R7). Anything else is refused, whether or not it changes
 * what's rendered today.
 *
 * Stated exceptions (PREBRIEF-richer-add.md R8), what an `add` doesn't keep:
 * - accessor and buffer NAMES (RA-L2 (c), modified): a restored object loses
 *   them for good. Their `extras` are refused, not dropped;
 * - material and mesh SHARING (RA-L3 (a)): a copy or a restore gets its own
 *   mesh and material; `prepareRestore` says so (`sharedMaterial`), and the
 *   Undo button's title tells the owner;
 * - an index's storage type: the same values come back as unsigned short.
 * - accessor SHARING between primitives: each primitive's copy gets its own
 *   accessors (the same values; nothing in Atrium sees or edits the sharing).
 * Not exceptions (a save keeps none of them either): a cutoff outside MASK, and
 * a vector factor within 1e-5 of its default (the writer's own tolerance).
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
/** richer-add R7 — the semantics a copy carries, and each one's accessor types. */
const VERTEX_SEMANTICS = Object.freeze({
  POSITION: ['VEC3'], NORMAL: ['VEC3'], TEXCOORD_0: ['VEC2'], TEXCOORD_1: ['VEC2'], COLOR_0: ['VEC3', 'VEC4'],
})
/** glTF-Transform's writer tolerance for a vector factor (`MathUtils.eq`). */
const WRITER_TOLERANCE = 10e-6
const TRIANGLES = 4
const MAX_INDEX = 65534            // add-check A3: no index may be 65,535
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
  add:        'The server would refuse this object',
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
//
// copy-objects K3: the credit (`origin`, `copiedFrom`) too, with the server's
// verdict (`creditProblem` below), so a Duplicate or Undo of a malformed legacy
// credit is refused with its own reason. `{ credit: false }` skips it, for Copy
// (K5): a malformed credit doesn't stop a Copy; Paste replaces it (K2).
export function atriumProblem(extras, { credit = true } = {}) {
  if (extras == null || typeof extras !== 'object') return null
  if (!Object.hasOwn(extras, 'atrium')) return null
  const atrium = extras.atrium
  if (!isPlainObject(atrium)) return 'extras.atrium is not an object'
  // scripting-4b-1 E7 — a legacy id the server would refuse is refused here,
  // with its own message, rather than sent and refused.
  if (Object.hasOwn(atrium, 'objectId') && objectIdProblem(atrium.objectId) !== null) {
    return 'its object id is malformed'
  }
  if (Object.hasOwn(atrium, 'teleporter')) {
    const tp = atrium.teleporter
    if (!isPlainObject(tp)) return 'its teleporter data is not an object'
    if (typeof tp.destination !== 'string') return 'its teleporter destination is not text'
    if (tp.destination.length > DESTINATION_MAX) return `its teleporter destination is over ${DESTINATION_MAX} characters`
  }
  const modelProblem = modelExtrasProblem(extras)
  if (modelProblem) return `its model data would be refused (${modelReasonText(modelProblem)})`
  // scripting-4b-2 F10 — the behaviour leaf is checked here too, with F1, so a
  // copy (or a restore) of a malformed behaviour is refused with its own text
  // rather than sent and refused by the server.
  if (Object.hasOwn(atrium, 'behavior') && atrium.behavior !== null) {
    const check = behaviorCheck(atrium.behavior, { ownId: atrium.objectId })
    if (check.problem) return `its behaviour is malformed (${check.message})`
  }
  if (credit) {
    const c = creditProblem(atrium)
    if (c) return `its credit is malformed (${c.message})`
  }
  return null
}

// ---------------------------------------------------------------------------
// copy-objects K2/K3 — the credit's form, the client's copy of the server's
// rule (`send-policy.js` creditProblem). Both read
// `tests/fixtures/credit-vectors.json`. Fields are checked in one fixed order
// (object, unknown keys, then server, world, creator, creatorName, address,
// at, refs), so both sides name the same field.
// ---------------------------------------------------------------------------

export const CREDIT_SERVER_MAX = 256
export const CREDIT_ID_MAX = 128
export const CREDIT_NAME_MAX = 64
export const CREDIT_ADDRESS_MAX = 2048
export const CREDIT_REFS_MAX = 40

const CREDIT_KEYS = Object.freeze({
  origin:     { allowed: ['server', 'world', 'creator', 'creatorName', 'at'], required: ['server', 'at'] },
  copiedFrom: { allowed: ['server', 'world', 'address', 'at', 'refs'],       required: ['server', 'address', 'at'] },
})
const CREDIT_FIELD_ORDER = ['server', 'world', 'creator', 'creatorName', 'address', 'at', 'refs']
const REF_KEYS = ['id', 'was', 'name']

function hasCharBelow(s, limit) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < limit) return true
  return false
}

/** `world`, `creator`, a ref's `id` and `was`: 1–128 characters, none below U+0021. */
export function creditIdOk(v) {
  return typeof v === 'string' && v.length >= 1 && v.length <= CREDIT_ID_MAX && !hasCharBelow(v, 0x21)
}

/**
 * `creatorName`, a ref's `name`: 1–64 characters (a username's own limit),
 * none below U+0020, nor U+007F, U+2028–U+2029, U+202A–U+202E, U+2066–U+2069
 * (`textContent` stops markup, not a direction override in "Made by …").
 */
export function creditNameOk(v) {
  if (typeof v !== 'string' || v.length < 1 || v.length > CREDIT_NAME_MAX) return false
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 ||
        (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false
  }
  return true
}

/** `server`: an `https:` or `http:` origin, exactly as `new URL(v).origin` spells it. */
export function creditServerOk(v) {
  if (typeof v !== 'string' || v.length < 1 || v.length > CREDIT_SERVER_MAX) return false
  let url
  try { url = new URL(v) } catch { return false }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === v
}

/** `at`: `YYYY-MM-DD`, a real date (UTC). */
export function creditDateOk(v) {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0–99 to 1900–1999.
  const t = new Date(0)
  t.setUTCFullYear(y, m - 1, d)
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** `address`: a path starting with `/`, at most 2,048 characters, none below U+0021. */
export function creditAddressOk(v) {
  return typeof v === 'string' && v.startsWith('/') && v.length <= CREDIT_ADDRESS_MAX && !hasCharBelow(v, 0x21)
}

const CREDIT_FIELD_RULES = Object.freeze({
  server:      [creditServerOk, `must be an http(s) origin of at most ${CREDIT_SERVER_MAX} characters`],
  world:       [creditIdOk, `must be 1–${CREDIT_ID_MAX} characters with no spaces or control characters`],
  creator:     [creditIdOk, `must be 1–${CREDIT_ID_MAX} characters with no spaces or control characters`],
  creatorName: [creditNameOk, `must be 1–${CREDIT_NAME_MAX} characters with no control or text-direction characters`],
  address:     [creditAddressOk, `must be a path starting with "/", at most ${CREDIT_ADDRESS_MAX} characters, with no spaces or control characters`],
  at:          [creditDateOk, 'must be a real date, YYYY-MM-DD'],
})

function refsProblem(refs, path) {
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > CREDIT_REFS_MAX) {
    return { field: path, message: `${path} must be a list of 1–${CREDIT_REFS_MAX} entries` }
  }
  for (let i = 0; i < refs.length; i++) {
    const entry = refs[i]
    const at = `${path}[${i}]`
    if (!isPlainObject(entry)) return { field: at, message: `${at} must be an object` }
    const extra = Object.keys(entry).find((k) => !REF_KEYS.includes(k))
    if (extra !== undefined) return { field: at, message: `${at} has an unknown key "${extra}"` }
    for (const k of ['id', 'was']) {
      if (!creditIdOk(entry[k])) return { field: `${at}.${k}`, message: `${at}.${k} ${CREDIT_FIELD_RULES.world[1]}` }
    }
    if (Object.hasOwn(entry, 'name') && !creditNameOk(entry.name)) {
      return { field: `${at}.name`, message: `${at}.name ${CREDIT_FIELD_RULES.creatorName[1]}` }
    }
  }
  return null
}

/**
 * The credit's verdict on an `extras.atrium` object: null when neither key is
 * present or both pass, else `{ field, message }` naming the first field that
 * fails. With `{ key }`, only that key is checked (K2's fill treats a failing
 * key as absent). Pure.
 *
 * @param {object} atrium  a plain `extras.atrium` object
 * @param {object} [opts]
 * @param {'origin'|'copiedFrom'} [opts.key]
 * @returns {null | {field: string, message: string}}
 */
export function creditProblem(atrium, { key: only } = {}) {
  for (const key of ['origin', 'copiedFrom']) {
    if (only && key !== only) continue
    if (!Object.hasOwn(atrium, key)) continue
    const value = atrium[key]
    if (!isPlainObject(value)) return { field: key, message: `extras.atrium.${key} must be an object` }
    const { allowed, required } = CREDIT_KEYS[key]
    const extra = Object.keys(value).find((k) => !allowed.includes(k))
    if (extra !== undefined) return { field: key, message: `extras.atrium.${key} has an unknown key "${extra}"` }
    for (const field of CREDIT_FIELD_ORDER) {
      if (!allowed.includes(field)) continue
      const present = Object.hasOwn(value, field)
      const path = `${key}.${field}`
      if (!present) {
        if (required.includes(field)) return { field: path, message: `extras.atrium.${path} is required` }
        continue
      }
      if (field === 'refs') {
        const p = refsProblem(value.refs, path)
        if (p) return { field: p.field, message: `extras.atrium.${p.message}` }
        continue
      }
      const [ok, text] = CREDIT_FIELD_RULES[field]
      if (!ok(value[field])) return { field: path, message: `extras.atrium.${path} ${text}` }
    }
  }
  return null
}

// An accessor carries only what ingestNode rebuilds: values, nothing else.
// richer-add R7/R8 — its NAME (and its buffer's) is dropped, a stated
// exception (RA-L2 (c), modified); its `extras` and extensions still refuse it.
function accessorProblem(acc, label, { types = null } = {}) {
  if (!isEmptyObject(acc.getExtras())) return `${label} accessor has extras`
  if (hasExtensions(acc)) return `${label} accessor has extensions`
  const buf = acc.getBuffer?.()
  if (buf && (!isEmptyObject(buf.getExtras()) || hasExtensions(buf))) {
    return `${label} buffer has extras or extensions`
  }
  if (acc.getSparse?.()) return `${label} accessor is sparse`
  if (types) {
    if (!types.includes(acc.getType())) return `${label} is not ${types.join(' or ')}`
    if (acc.getComponentType() !== FLOAT) return `${label} is not float`
    if (acc.getNormalized()) return `${label} is normalized`
  }
  return null
}

// richer-add R7 — a material's name, extras, emissive, alpha and double-sided
// are carried now; extensions and textures still refuse it.
function materialProblem(mat) {
  if (!mat) return null
  if (hasExtensions(mat)) return 'material has extensions'
  if (mat.getBaseColorTexture() || mat.getMetallicRoughnessTexture() || mat.getNormalTexture() ||
      mat.getOcclusionTexture() || mat.getEmissiveTexture()) return 'material has textures'
  return null
}

// richer-add R7 — mesh and primitive extras and the R1 attributes are carried
// now (the extras' size and content are add-spec's, at click time).
function meshProblem(mesh) {
  if ((mesh.getWeights() ?? []).length > 0) return 'morph weights'
  if (hasExtensions(mesh)) return 'mesh extensions'
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== TRIANGLES) return 'not triangles'
    if (hasExtensions(prim)) return 'primitive extensions'
    if (prim.listTargets().length > 0) return 'morph targets'
    const semantics = prim.listSemantics().slice().sort()
    const ok = semantics.includes('POSITION') &&
      semantics.every((sem) => Object.hasOwn(VERTEX_SEMANTICS, sem)) &&
      (!semantics.includes('TEXCOORD_1') || semantics.includes('TEXCOORD_0'))
    if (!ok) return `attributes ${semantics.join(', ')}`
    for (const sem of semantics) {
      const p = accessorProblem(prim.getAttribute(sem), sem, { types: VERTEX_SEMANTICS[sem] })
      if (p) return p
    }
    const idx = prim.getIndices()
    if (idx) {
      const p = accessorProblem(idx, 'index')
      if (p) return p
      for (const i of idx.getArray()) if (i > MAX_INDEX) return 'an index above 65534'
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

/** The writer writes a vector factor only when it isn't within 1e-5 of the default. */
function differsFromDefault(values, defaults) {
  return values.some((v, i) => Math.abs(v - defaults[i]) > WRITER_TOLERANCE)
}

/**
 * richer-add R7 — a material in canonical form: today's three factors always;
 * every new field only when a save would write it (PREBRIEF-richer-add.md
 * §2.4), so `prepareRestore(ingest(d))` is `d` again.
 */
function materialDescriptor(mat) {
  const out = {}
  if (mat.getName() !== '') out.name = mat.getName()
  const extras = mat.getExtras()
  if (!isEmptyObject(extras)) out.extras = structuredClone(extras)
  out.pbrMetallicRoughness = {
    baseColorFactor: [...mat.getBaseColorFactor()],
    metallicFactor:  mat.getMetallicFactor(),
    roughnessFactor: mat.getRoughnessFactor(),
  }
  const emissive = [...mat.getEmissiveFactor()]
  if (differsFromDefault(emissive, [0, 0, 0])) out.emissiveFactor = emissive
  const mode = mat.getAlphaMode()
  if (mode !== 'OPAQUE') out.alphaMode = mode
  if (mode === 'MASK' && mat.getAlphaCutoff() !== 0.5) out.alphaCutoff = mat.getAlphaCutoff()
  if (mat.getDoubleSided()) out.doubleSided = true
  return out
}

/**
 * richer-add R8 — does a restore of this node lose sharing? True when its mesh
 * is used by more than one node, or any of its materials by more than one
 * primitive, counting only primitives of meshes some node still uses (a file
 * world isn't healed, so an orphan mesh's primitive mustn't count).
 *
 * @param {object} node  the glTF-Transform Node
 * @returns {boolean}
 */
export function hasSharedMaterial(node) {
  const mesh = node?.getMesh?.()
  if (!mesh) return false
  const nodeUsers = (m) => (m.listParents?.() ?? []).filter((p) => p.propertyType === 'Node').length
  if (nodeUsers(mesh) > 1) return true
  const liveUsers = (mat) => (mat.listParents?.() ?? []).filter((prim) =>
    prim.propertyType === 'Primitive' &&
    (prim.listParents?.() ?? []).some((m) => m.propertyType === 'Mesh' && nodeUsers(m) > 0)).length
  return mesh.listPrimitives().some((prim) => {
    const mat = prim.getMaterial()
    return !!mat && liveUsers(mat) > 1
  })
}

/**
 * The descriptor, from current values. Assumes the rules passed.
 * `offsetX` is 0 for a restore (Y2): the node's own translation, bit for bit
 * — never `x + 1.5 − 1.5`, which is not always `x` in floating point (U5).
 */
export function buildDescriptor(node, name, offsetX) {
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
      // richer-add R7 — the other carried semantics the primitive HAS (its own
      // list, never a probe by name), in a fixed order; FLOAT by the rules
      const semantics = new Set(prim.listSemantics())
      for (const sem of ['NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0']) {
        if (semantics.has(sem)) out.attributes[sem] = sendableArray(prim.getAttribute(sem))
      }
      const idx = prim.getIndices()
      if (idx) out.indices = sendableArray(idx)
      const primExtras = prim.getExtras()
      if (!isEmptyObject(primExtras)) out.extras = structuredClone(primExtras)
      const mat = prim.getMaterial()
      if (mat) out.material = materialDescriptor(mat)
      return out
    })
    descriptor.mesh = mesh.getName() !== '' ? { name: mesh.getName(), primitives } : { primitives }
    const meshExtras = mesh.getExtras()
    if (!isEmptyObject(meshExtras)) descriptor.mesh.extras = structuredClone(meshExtras)
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
 * @param {object} [opts]
 * @param {boolean} [opts.credit=true]  false skips the credit check (copy-objects K5: Copy)
 * @returns {null | {ok: false, rule: string, reason: string}}  null when no rule refuses it
 */
export function duplicateRuleProblem(node, { credit = true } = {}) {
  if (node.listChildren().length > 0) return deny('children')
  const parents = node.listParents().map((p) => p.propertyType)
  if (parents.includes('Node')) return deny('parent')
  if (node.getCamera() || node.getSkin() || node.getExtension?.('KHR_lights_punctual')) return deny('attached')
  if (parents.some((t) => !SCENE_GRAPH_PARENTS.has(t))) return deny('referenced')
  const extras = node.getExtras()
  // The server refuses any own `source` key, `null` included (S2 in session.js).
  const atrium = extras?.atrium
  if (atrium !== null && typeof atrium === 'object' && Object.hasOwn(atrium, 'source')) return deny('external')
  const a = atriumProblem(extras, { credit })
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
 * F10 (scripting-4b-2) — the copy's SELF-references. Every `nodeMap`, `targets`
 * and `animations[].object` entry equal to the original's id becomes the copy's
 * new id, and `template.params.target` with it (Rev 2, M3), so reopening the
 * copy's form and saving unchanged keeps the copy as its own target. Every other
 * entry is a GRANT the owner made, and is kept as it is (F-L10). Pure.
 *
 * @param {object} behavior   the `extras.atrium.behavior` value
 * @param {string} fromId     the original's object id
 * @param {string} toId       the copy's new object id
 * @returns {object}          a copy of `behavior` (the input is never mutated)
 */
export function remapBehaviorTargets(behavior, fromId, toId) {
  if (behavior == null || typeof behavior !== 'object' || !fromId || !toId) return behavior
  const swap = (id) => (id === fromId ? toId : id)
  const copy = structuredClone(behavior)
  if (Array.isArray(copy.nodeMap)) copy.nodeMap = copy.nodeMap.map(swap)
  if (Array.isArray(copy.targets)) copy.targets = copy.targets.map(swap)
  if (Array.isArray(copy.animations)) copy.animations = copy.animations.map((entry) => (entry && typeof entry === 'object' ? { ...entry, object: swap(entry.object) } : entry))
  if (copy.template && typeof copy.template === 'object' && copy.template.params && typeof copy.template.params === 'object') {
    copy.template = { ...copy.template, params: { ...copy.template.params, target: swap(copy.template.params.target) } }
  }
  return copy
}

/**
 * A7 — the rule the server would apply to this `add`, run on the descriptor we
 * built, at click time (add-spec.js, A1–A5). A node the server would refuse is
 * never sent. Its reason is reported as the server reports it.
 */
function addSpecProblem(descriptor) {
  const problem = checkAddNode(descriptor)
  return problem ? deny('add', `${problem.code}: ${problem.message}`) : null
}

/** The descriptor, with the copy's behaviour remapped, if it carries one. */
function withRemappedBehavior(descriptor, fromId, toId) {
  const atrium = descriptor.extras?.atrium
  if (!atrium || typeof atrium !== 'object' || !Object.hasOwn(atrium, 'behavior')) return descriptor
  const behavior = remapBehaviorTargets(atrium.behavior, fromId, toId)
  if (behavior === atrium.behavior) return descriptor
  return { ...descriptor, extras: { ...descriptor.extras, atrium: { ...atrium, behavior } } }
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
  // E7 — the copy never carries the original's id. prepareRestore does not do
  // this: a restore brings back the same object.
  const originalId = node.getExtras()?.atrium?.objectId
  const copyId = newObjectId()
  const built = buildDescriptor(node, name, DUPLICATE_OFFSET_X)
  const descriptor = withRemappedBehavior(withNewObjectId(built, () => copyId), originalId, copyId)
  const bytes = addMessageBytes(descriptor)
  if (bytes > MAX_ADD_BYTES) return deny('size', `${bytes.toLocaleString('en-US')} bytes; the limit is ${MAX_ADD_BYTES.toLocaleString('en-US')}`)
  const refused = addSpecProblem(descriptor)
  if (refused) return refused
  return { ok: true, descriptor, bytes }
}

/**
 * Y2 — the `add` that brings this node back exactly as it is now. Rules 1–9
 * are N3's, unchanged; the descriptor is built by the same code as a copy but
 * with the node's own name and its own translation, no offset applied or
 * subtracted (U5). Its output is the canonical form the undo engine compares:
 * the same node gives the same descriptor (`sameDescriptor` compares keys and
 * values, not key order). richer-add R8: `sharedMaterial: true` when the
 * restore won't share what the node shares (`hasSharedMaterial`).
 *
 * @param {object} node  the glTF-Transform Node (read now, from current values)
 * @param {object} [opts]
 * @param {string} [opts.name]  defaults to the node's own name
 * @returns {{ok: true, descriptor: object, bytes: number, sharedMaterial?: true} | {ok: false, rule: string, reason: string}}
 */
export function prepareRestore(node, { name = node.getName?.() } = {}) {
  const problem = duplicateRuleProblem(node)
  if (problem) return problem
  const descriptor = buildDescriptor(node, name, 0)
  const bytes = addMessageBytes(descriptor)
  if (bytes > MAX_ADD_BYTES) return deny('size', `${bytes.toLocaleString('en-US')} bytes; the limit is ${MAX_ADD_BYTES.toLocaleString('en-US')}`)
  const refused = addSpecProblem(descriptor)
  if (refused) return refused
  return hasSharedMaterial(node) ? { ok: true, descriptor, bytes, sharedMaterial: true } : { ok: true, descriptor, bytes }
}
