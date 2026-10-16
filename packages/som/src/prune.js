// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// L1 — one prune rule over a glTF-Transform Document.
//
// A property is "used" when any of its parents is something other than Root
// (a node, primitive, morph target, animation sampler, skin, material or
// extension property). Anything whose only parent is Root — or which has no
// parent at all, as an unattached KHR_lights_punctual Light does — is
// unreachable and is disposed.
//
// Dependencies are collected BEFORE disposal: disposal severs edges, so the
// chain under an orphan mesh would be invisible afterwards. Each dependency
// becomes a candidate in the next pass and is disposed only if, by then, it too
// has no non-Root parent.
//
// Never pruned: Node, Scene, Animation (and its channels and samplers), Root,
// the document's extras.
// ---------------------------------------------------------------------------

import { Document, NodeIO, PropertyType } from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'

/** KHR_lights_punctual's Light reports this as its propertyType. */
const LIGHT_TYPE = 'Light'

/** The property types L1 may dispose, and the count key each reports under. */
const PRUNE_TYPE_KEY = new Map([
  [PropertyType.MESH,           'mesh'],
  [PropertyType.PRIMITIVE,      'primitive'],
  [PropertyType.PRIMITIVE_TARGET, 'primitiveTarget'],
  [PropertyType.MATERIAL,       'material'],
  [PropertyType.TEXTURE,        'texture'],
  [PropertyType.ACCESSOR,       'accessor'],
  [PropertyType.BUFFER,         'buffer'],
  [PropertyType.SKIN,           'skin'],
  [PropertyType.CAMERA,         'camera'],
  [LIGHT_TYPE,                  'light'],
])

export const PRUNE_COUNT_KEYS = [
  'mesh', 'primitive', 'primitiveTarget', 'material', 'texture',
  'accessor', 'buffer', 'skin', 'camera', 'light',
]

/** Empty per-type count object. */
export function emptyCounts() {
  const counts = {}
  for (const key of PRUNE_COUNT_KEYS) counts[key] = 0
  return counts
}

/** True when L1 may dispose a property of this type. */
export function isPrunableType(property) {
  return !!property && PRUNE_TYPE_KEY.has(property.propertyType)
}

/** Count per prune type from a list of disposed properties. */
export function countByType(properties) {
  const counts = emptyCounts()
  for (const p of properties) {
    const key = PRUNE_TYPE_KEY.get(p.propertyType)
    if (key) counts[key] += 1
  }
  return counts
}

/**
 * True when the property has a parent that is not the Document Root. A parent
 * that is itself detached (no parents at all) does not keep a property alive:
 * glTF-Transform's `Mesh.dispose()` removes a mesh's primitives from the graph
 * but leaves their `Primitive → Accessor/Material` edges behind, so an accessor
 * would otherwise look "used" by a primitive that no longer exists.
 *
 * A property with no parents at all — an unattached KHR_lights_punctual Light —
 * has no non-Root parent either, and is prunable.
 */
function hasNonRootParent(property, root) {
  for (const parent of property.listParents()) {
    if (parent === root) continue
    if (parent.listParents().length > 0) return true
  }
  return false
}

/**
 * The properties a candidate depends on. Read before the candidate is disposed.
 * Only prunable types are returned — node, scene, animation and root references
 * are what make a property *survive*, never what gets collected.
 */
function dependenciesOf(property) {
  const deps = []
  switch (property.propertyType) {
    case PropertyType.MESH:
      for (const prim of property.listPrimitives()) deps.push(prim)
      break
    case PropertyType.PRIMITIVE:
      for (const semantic of property.listSemantics()) {
        const attribute = property.getAttribute(semantic)
        if (attribute) deps.push(attribute)
      }
      {
        const indices = property.getIndices()
        if (indices) deps.push(indices)
      }
      {
        const material = property.getMaterial()
        if (material) deps.push(material)
      }
      if (typeof property.listTargets === 'function') {
        for (const target of property.listTargets()) deps.push(target)
      }
      break
    case PropertyType.PRIMITIVE_TARGET:
      for (const semantic of property.listSemantics()) {
        const attribute = property.getAttribute(semantic)
        if (attribute) deps.push(attribute)
      }
      break
    case PropertyType.MATERIAL:
      for (const getter of ['getBaseColorTexture', 'getEmissiveTexture',
        'getNormalTexture', 'getOcclusionTexture', 'getMetallicRoughnessTexture']) {
        if (typeof property[getter] !== 'function') continue
        const texture = property[getter]()
        if (texture) deps.push(texture)
      }
      break
    case PropertyType.ACCESSOR:
      {
        const buffer = property.getBuffer()
        if (buffer) deps.push(buffer)
      }
      break
    case PropertyType.SKIN:
      if (typeof property.getInverseBindMatrices === 'function') {
        const ibm = property.getInverseBindMatrices()
        if (ibm) deps.push(ibm)
      }
      break
    default:
      break
  }
  return deps.filter(isPrunableType)
}

/**
 * Every node in a mesh's subtree of prunable properties: the mesh itself, its
 * primitives and its morph targets. glTF-Transform's `Mesh.dispose()` removes
 * the primitives (and their targets) with it, so they are counted as disposed
 * alongside the mesh rather than pruned in a later pass.
 */
function meshCascade(mesh) {
  const cascade = [mesh]
  if (typeof mesh.listPrimitives !== 'function') return cascade
  for (const prim of mesh.listPrimitives()) {
    cascade.push(prim)
    if (typeof prim.listTargets === 'function') {
      for (const target of prim.listTargets()) cascade.push(target)
    }
  }
  return cascade
}

/**
 * Dispose every candidate that has no parent other than Root, repeating until
 * nothing more can go. The candidate list is not modified.
 *
 * @param {object} root        glTF-Transform Root
 * @param {Iterable<object>} candidates
 * @returns {{disposed: object[], counts: Record<string, number>}}
 */
export function pruneCandidateProperties(root, candidates) {
  const disposed = []
  const done = new Set()
  let worklist = []
  for (const candidate of candidates ?? []) {
    if (isPrunableType(candidate)) worklist.push(candidate)
  }

  while (worklist.length > 0) {
    const next = []
    for (const property of worklist) {
      if (done.has(property)) continue
      if (!isPrunableType(property)) continue
      if (hasNonRootParent(property, root)) continue

      const cascade = property.propertyType === PropertyType.MESH
        ? meshCascade(property)
        : [property]
      // Dependencies of the whole cascade: glTF-Transform's Mesh.dispose()
      // removes the primitives (and their targets) with the mesh, so their
      // accessors and material must be collected now or never.
      const deps = []
      for (const item of cascade) deps.push(...dependenciesOf(item))

      for (const item of cascade) done.add(item)
      try {
        property.dispose()
      } catch {
        continue
      }
      for (const item of cascade) disposed.push(item)
      for (const dep of deps) next.push(dep)
    }
    worklist = next
  }

  return { disposed, counts: countByType(disposed) }
}

/** Lights the KHR_lights_punctual extension still lists, attached or not. */
export function collectExtensionLights(root) {
  const lights = []
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName !== 'KHR_lights_punctual') continue
    if (typeof extension.listProperties !== 'function') continue
    for (const property of extension.listProperties()) {
      if (property.propertyType === LIGHT_TYPE) lights.push(property)
    }
  }
  return lights
}

/**
 * Whole-document candidate enumeration (L1 "whole-document mode"): every mesh,
 * the primitives and morph targets of every mesh, every material, texture,
 * accessor, buffer, skin and camera from the root lists, and every light from
 * the KHR_lights_punctual extension (a light has no Root parent, so the root
 * lists never show it).
 */
export function collectWholeDocumentCandidates(root) {
  const out = []
  for (const mesh of root.listMeshes()) {
    out.push(mesh)
    for (const prim of mesh.listPrimitives()) {
      out.push(prim)
      if (typeof prim.listTargets === 'function') {
        for (const target of prim.listTargets()) out.push(target)
      }
    }
  }
  out.push(...root.listMaterials())
  out.push(...root.listTextures())
  out.push(...root.listAccessors())
  out.push(...root.listBuffers())
  out.push(...root.listSkins())
  out.push(...root.listCameras())
  out.push(...collectExtensionLights(root))
  return out
}

/**
 * Prune a whole document in place (L4's heal).
 *
 * @param {object} document   glTF-Transform Document
 * @returns {{disposed: object[], counts: Record<string, number>}}
 */
export function pruneDocumentInPlace(document) {
  const root = document.getRoot()
  return pruneCandidateProperties(root, collectWholeDocumentCandidates(root))
}

/** Count every resource in a document, for audits and tests. */
export function countDocumentResources(root) {
  const counts = {
    nodes: root.listNodes().length,
    scenes: root.listScenes().length,
    meshes: root.listMeshes().length,
    primitives: 0,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    accessors: root.listAccessors().length,
    buffers: root.listBuffers().length,
    skins: root.listSkins().length,
    cameras: root.listCameras().length,
    lights: collectExtensionLights(root).length,
  }
  for (const mesh of root.listMeshes()) counts.primitives += mesh.listPrimitives().length
  return counts
}

/**
 * A byte-faithful copy of a document through writeJSON → readJSON, keeping its
 * resources map. Used by the dry run and by L3's serialize.
 *
 * @param {object} document
 * @returns {Promise<object>} a new Document
 */
export async function copyDocument(document) {
  const io = new NodeIO().registerExtensions([KHRLightsPunctual])
  const { json, resources } = await io.writeJSON(document)
  return io.readJSON({ json, resources })
}

/**
 * L1's dry run (L10): run the real prune on an independent copy and report the
 * counts per type. Reading current parents instead would miss the chain under
 * an orphan mesh, so the copy is pruned for real; the original is untouched.
 *
 * @param {object} document
 * @returns {Promise<Record<string, number>>}
 */
export async function pruneDocumentDryRun(document) {
  const copy = await copyDocument(document)
  return pruneDocumentInPlace(copy).counts
}

export { LIGHT_TYPE }
