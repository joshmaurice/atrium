// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-instances.js — one instance of a template, with the world protected
 * from the model's names (Phase 3 step 3a: Z4 as amended by A7, and Z6's
 * placeholder).
 *
 * Why this exists (P4): every scene lookup in Atrium is by NAME. A part called
 * `Door` inside a chair would hijack `walkUpToSOMNode`, `nodeForHitObject`,
 * `getObjectByName`/`findNodeObject` and any world clip on `sceneGroup` that
 * targets that name. The fix is A7: retarget the clips by IDENTITY (a
 * template-object → instance-object map built before any name is cleared),
 * then clear every name, keeping the original in `userData.atriumModelName`.
 *
 * The wrapper is a plain `Object3D`, never a `Group`: `DocumentView`'s
 * `detachMesh()` removes the first child with `isGroup`, and a `Group` here
 * would be removed instead of the view's own mesh group (P3).
 */

import { Object3D, PropertyBinding, AnimationClip, BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'

/** The wrapper's marker, and where an original part name is kept (Z4). */
export const MODEL_WRAPPER_FLAG = 'atriumModel'
export const MODEL_NAME_KEY = 'atriumModelName'

/** Walk two identical trees in parallel, filling template object → instance object (A7 step 1). */
function mapTrees(templateObject, instanceObject, map) {
  map.set(templateObject, instanceObject)
  const templateChildren = templateObject.children ?? []
  const instanceChildren = instanceObject.children ?? []
  const count = Math.min(templateChildren.length, instanceChildren.length)
  for (let i = 0; i < count; i++) mapTrees(templateChildren[i], instanceChildren[i], map)
}

/** Rebuild a track's name with the node part replaced by `uuid` (A7 step 2). */
function retargetTrackName(parsed, uuid) {
  const index = (n) => (n === null || n === undefined ? '' : `[${n}]`)
  const parts = [uuid]
  if (parsed.objectName) parts.push(`${parsed.objectName}${index(parsed.objectIndex)}`)
  parts.push(`${parsed.propertyName}${index(parsed.propertyIndex)}`)
  return parts.join('.')
}

/**
 * A7 — retarget one clip from the template to an instance.
 *
 * Each track's node part is resolved against the TEMPLATE with
 * `PropertyBinding.findNode` (name or uuid, bones included), mapped through the
 * identity map, and rewritten to that instance object's uuid. The rest of the
 * path is kept. A track that cannot be resolved to exactly one template object
 * is DROPPED and counted — never bound to a guess.
 *
 * @returns {{clip: AnimationClip|null, dropped: number}}
 */
export function retargetClip(clip, templateScene, map) {
  const tracks = []
  let dropped = 0
  for (const track of clip.tracks) {
    let parsed = null
    try { parsed = PropertyBinding.parseTrackName(track.name) } catch { parsed = null }
    if (!parsed || !parsed.nodeName) { dropped += 1; continue }
    let templateObject = null
    try { templateObject = PropertyBinding.findNode(templateScene, parsed.nodeName) } catch { templateObject = null }
    if (!templateObject || Array.isArray(templateObject)) { dropped += 1; continue }
    const instanceObject = map.get(templateObject)
    if (!instanceObject) { dropped += 1; continue }
    const name = retargetTrackName(parsed, instanceObject.uuid)
    const rewired = track.clone()
    rewired.name = name
    tracks.push(rewired)
  }
  if (tracks.length === 0) return { clip: null, dropped }
  return { clip: new AnimationClip(clip.name, clip.duration, tracks), dropped }
}

/** A7 step 5 — remove the model's own lights and cameras (L10's spirit). */
function stripLightsAndCameras(root) {
  const doomed = []
  root.traverse((object) => {
    if (object.isLight || object.isCamera) doomed.push(object)
  })
  for (const object of doomed) object.parent?.remove(object)
  return doomed.length
}

/** A7 step 4 — clear every name, keeping the original in `userData`. */
function clearNames(root) {
  root.traverse((object) => {
    if (!object.name) return
    object.userData[MODEL_NAME_KEY] = object.name
    object.name = ''
  })
}

/**
 * Z4/A7 — build one instance of a template.
 *
 * @param {object} template   `{ scene, animations }`, as GLTFLoader gives it
 * @param {object} [opts]
 * @param {(scene: object) => object} [opts.cloneFn]  the clone (SkeletonUtils by default)
 * @returns {{wrapper: Object3D, scene: object, clips: object[], droppedTracks: number,
 *            removedAttachments: number}}
 */
export function buildInstance(template, { cloneFn = skeletonClone } = {}) {
  const instanceScene = cloneFn(template.scene)

  // Step 1: the identity map, before any name is cleared.
  const map = new Map()
  mapTrees(template.scene, instanceScene, map)

  // Step 2: the clips, retargeted by identity.
  const clips = []
  let droppedTracks = 0
  for (const clip of template.animations ?? []) {
    const { clip: retargeted, dropped } = retargetClip(clip, template.scene, map)
    droppedTracks += dropped
    if (retargeted) clips.push(retargeted)
  }

  // Step 3: lights and cameras out, then step 4: the names.
  const removedAttachments = stripLightsAndCameras(instanceScene)
  clearNames(instanceScene)

  // Step 5: the wrapper — a plain Object3D (P3), never a Group.
  const wrapper = new Object3D()
  wrapper.userData[MODEL_WRAPPER_FLAG] = true
  wrapper.add(instanceScene)
  return { wrapper, scene: instanceScene, clips, droppedTracks, removedAttachments }
}

/** Z6 — the placeholder: an unnamed wireframe box whose base sits on origin. */
export function buildPlaceholder(bounds = null) {
  const size = Array.isArray(bounds) && bounds.length === 3 ? bounds : [1, 1, 1]
  const geometry = new BoxGeometry(size[0], size[1], size[2])
  const box = new Mesh(geometry, new MeshBasicMaterial({ wireframe: true }))
  // The model rests on its origin: the box's base is at y = 0.
  box.position.set(0, size[1] / 2, 0)
  box.name = ''
  const wrapper = new Object3D()
  wrapper.userData[MODEL_WRAPPER_FLAG] = true
  wrapper.add(box)
  return { wrapper, box, size, colorize: (material, hex) => material?.color?.setHex?.(hex) }
}

/** Z6's two colours: muted grey while loading, amber after a failure. */
export const PLACEHOLDER_COLOURS = Object.freeze({ loading: 0x6b7280, failed: 0xd97706 })

/** Z4 — dispose an instance: its wrapper, its skeletons and its retargeted clips (A9). */
export function disposeInstance(instance, { removeFromHost = true } = {}) {
  if (!instance?.wrapper) return
  if (removeFromHost) instance.wrapper.parent?.remove(instance.wrapper)
  else instance.wrapper.removeFromParent?.()
  // Z4 — every `SkeletonUtils.clone` carries its OWN `Skeleton`, whose bone
  // texture only `skeleton.dispose()` frees. The template's geometries,
  // materials and textures are NEVER touched here: `clone` shares them (A9).
  const skeletons = new Set()
  instance.scene?.traverse?.((object) => {
    if (object.skeleton && !skeletons.has(object.skeleton)) skeletons.add(object.skeleton)
  })
  for (const skeleton of skeletons) skeleton.dispose?.()
  for (const clip of instance.clips ?? []) clip.dispose?.()
}
