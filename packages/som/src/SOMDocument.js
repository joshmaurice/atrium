// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// ---------------------------------------------------------------------------
// Path resolver helpers (module-private)
// ---------------------------------------------------------------------------

export function parsePath(path) {
  const segments = []
  const re = /([^.[]+)|\[(\d+)\]/g
  let match
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push(match[1])
    } else {
      segments.push(parseInt(match[2], 10))
    }
  }
  if (segments.length === 0) throw new Error(`Empty path: "${path}"`)
  return segments
}

function resolvePath(somNode, segments) {
  let current = somNode
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    const next = current[seg]
    if (next == null) throw new Error(`Path segment "${seg}" resolved to null/undefined`)
    current = next
  }
  const key = segments[segments.length - 1]
  return { target: current, key }
}

import { SOMObject }    from './SOMObject.js'
import { SOMEvent }     from './SOMEvent.js'
import { SOMScene }     from './SOMScene.js'
import { SOMNode }      from './SOMNode.js'
import { SOMMesh }      from './SOMMesh.js'
import { SOMPrimitive } from './SOMPrimitive.js'
import { SOMMaterial }  from './SOMMaterial.js'
import { SOMCamera }    from './SOMCamera.js'
import { SOMAnimation } from './SOMAnimation.js'
import { SOMLight }     from './SOMLight.js'
import { SOMTexture }   from './SOMTexture.js'
import { SOMSkin }      from './SOMSkin.js'

export class SOMDocument extends SOMObject {
  constructor(document) {
    super()
    this._document = document
    this._root     = document.getRoot()

    // Maps keyed by glTF-Transform object — for wiring during construction and ingest
    this._materialMap  = new Map()
    this._meshMap      = new Map()
    this._cameraMap    = new Map()
    this._nodeMap      = new Map()
    this._primitiveMap = new Map()
    this._animationMap = new Map()
    this._lightMap     = new Map()   // gltf-Transform Light → SOMLight
    this._textureMap   = new Map()
    this._skinMap      = new Map()
    this._sceneMap     = new Map()

    // Ordered arrays for node-attached cameras and lights — deduplicates dual-key registration
    this._cameras = []
    this._lights  = []

    // Map keyed by name — for fast O(1) node lookup
    this._nodesByName      = new Map()
    // Map keyed by name — for fast O(1) animation lookup
    this._animationsByName = new Map()
    // Global flat namespace: all named SOM objects (nodes, animations, document)
    this._objectsByName    = new Map()

    // Register self as '__document__' in global namespace
    this._objectsByName.set('__document__', this)

    this._buildObjectGraph()
  }

  // ---------------------------------------------------------------------------
  // Build full object graph bottom-up
  // ---------------------------------------------------------------------------

  _buildObjectGraph() {
    // Textures (no dependencies)
    for (const t of this._root.listTextures()) {
      this._textureMap.set(t, new SOMTexture(t))
    }

    // Materials
    for (const m of this._root.listMaterials()) {
      this._materialMap.set(m, new SOMMaterial(m))
    }

    // Meshes + primitives
    for (const mesh of this._root.listMeshes()) {
      const somMesh = new SOMMesh(mesh, this)
      this._meshMap.set(mesh, somMesh)
      somMesh._prims = []
      for (const prim of mesh.listPrimitives()) {
        const somPrim = new SOMPrimitive(prim, this)
        this._primitiveMap.set(prim, somPrim)
        somMesh._prims.push(somPrim)
        const mat = prim.getMaterial()
        if (mat) somPrim._material = this._materialMap.get(mat) ?? null
      }
    }

    // Cameras
    for (const c of this._root.listCameras()) {
      this._cameraMap.set(c, new SOMCamera(c))
    }

    // Skins
    for (const s of this._root.listSkins()) {
      this._skinMap.set(s, new SOMSkin(s, this))
    }

    // Nodes — wire mesh, camera, skin; register in _nodesByName + _objectsByName
    for (const n of this._root.listNodes()) {
      const somNode = new SOMNode(n, this)
      this._nodeMap.set(n, somNode)
      const name = n.getName()
      this._nodesByName.set(name, somNode)
      this._registerObject(name, somNode)
      this._registerNodeDispose(n, somNode)
      const m = n.getMesh()
      if (m) somNode._mesh = this._meshMap.get(m) ?? null
      const c = n.getCamera()
      if (c) somNode._camera = this._cameraMap.get(c) ?? null
      const sk = n.getSkin()
      if (sk) somNode._skin = this._skinMap.get(sk) ?? null
    }

    // Cameras — node-walk; must run after nodes so node names and _cameraMap are ready
    for (const n of this._root.listNodes()) {
      const gltfCamera = n.getCamera()
      if (!gltfCamera) continue
      const somNode = this._nodeMap.get(n)
      if (!somNode) continue
      const somCamera = this._cameraMap.get(gltfCamera)
      if (!somCamera) continue

      this._cameras.push(somCamera)

      // Compute alias first — needed for collision warning
      const alias = somNode.name + '.camera'

      // Register under bare name if non-empty (may collide with host node — node wins)
      const bareName = gltfCamera.getName?.() ?? null
      if (bareName) {
        if (this._objectsByName.has(bareName)) {
          console.warn(
            `SOM: duplicate name "${bareName}" — SOMNode wins bare-name slot; use "${alias}" to address this camera`
          )
        } else {
          this._objectsByName.set(bareName, somCamera)
        }
      }

      // Always register under qualified alias — stable regardless of collision
      this._objectsByName.set(alias, somCamera)
      somCamera._qualifiedName = alias
      somCamera._hostNode      = somNode
    }

    // Lights (KHR_lights_punctual) — node-walk; must run after nodes so node names are available
    for (const n of this._root.listNodes()) {
      const gltfLight = n.getExtension('KHR_lights_punctual')
      if (!gltfLight) continue
      const somNode = this._nodeMap.get(n)
      if (!somNode) continue

      const somLight = new SOMLight(gltfLight)
      this._lightMap.set(gltfLight, somLight)
      this._lights.push(somLight)
      somNode._light = somLight

      // Compute alias first — needed for the collision warning
      const alias = somNode.name + '.light'

      // Register under bare name if non-empty (may collide with host node — node wins)
      const bareName = gltfLight.getName?.() ?? null
      if (bareName) {
        if (this._objectsByName.has(bareName)) {
          console.warn(
            `SOM: duplicate name "${bareName}" — SOMNode wins bare-name slot; use "${alias}" to address this light`
          )
        } else {
          this._objectsByName.set(bareName, somLight)
        }
      }

      // Always register under qualified alias — stable regardless of collision
      this._objectsByName.set(alias, somLight)
      somLight._qualifiedName = alias
    }

    // Animations — register in _animationsByName + _objectsByName (with collision check)
    for (const a of this._root.listAnimations()) {
      const somAnim = new SOMAnimation(a)
      this._animationMap.set(a, somAnim)
      const name = a.getName()
      this._animationsByName.set(name, somAnim)
      this._registerObject(name, somAnim)
    }

    // Scenes
    for (const sc of this._root.listScenes()) {
      this._sceneMap.set(sc, new SOMScene(sc, this))
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Register a named SOM object in the global namespace.
   * Logs a warning and returns false if the name is already taken.
   */
  _registerObject(name, somObject) {
    if (this._objectsByName.has(name)) {
      const existing = this._objectsByName.get(name)
      console.warn(
        `SOM: duplicate name "${name}" — ` +
        `${existing.constructor.name} already registered, ` +
        `${somObject.constructor.name} will not be addressable by name`
      )
      return false
    }
    this._objectsByName.set(name, somObject)
    return true
  }

  /** Register a dispose callback so the node removes itself from caches when disposed. */
  _registerNodeDispose(gltfNode, somNode) {
    somNode._onDispose = () => this._disposeNode(gltfNode, somNode)
  }

  // ---------------------------------------------------------------------------
  // A5 — name rules for new names (decision D3)
  // ---------------------------------------------------------------------------

  /**
   * Check a proposed new name against the D3 rules. Shared by `add`
   * (non-avatar) and by rename. Uniqueness is checked against the global
   * namespace (`_objectsByName`), not just nodes (F7).
   *
   * @param {*} name              the proposed name
   * @param {object|null} [self]  the object being renamed — a name that already
   *                              points at `self` is not a duplicate
   * @returns {{ok: boolean, code: string|null, message: string|null}}
   */
  checkNewName(name, self = null) {
    if (typeof name !== 'string' || name.length === 0) {
      return { ok: false, code: 'INVALID_VALUE', message: 'name must be a non-empty string' }
    }
    if (name.length > 256) {
      return { ok: false, code: 'INVALID_VALUE', message: 'name must be at most 256 characters' }
    }
    if (name === '__document__') {
      return { ok: false, code: 'INVALID_VALUE', message: 'name "__document__" is reserved' }
    }
    if (name.endsWith('.camera') || name.endsWith('.light')) {
      return { ok: false, code: 'INVALID_VALUE', message: 'name may not end in ".camera" or ".light"' }
    }
    if (name.includes('/')) {
      return { ok: false, code: 'INVALID_VALUE', message: 'name may not contain "/"' }
    }
    const existing = this._objectsByName.get(name)
    if (existing !== undefined && existing !== self) {
      return { ok: false, code: 'INVALID_VALUE', message: `name "${name}" is already in use` }
    }
    return { ok: true, code: null, message: null }
  }

  // ---------------------------------------------------------------------------
  // A8 — atomic rename (design §4.8)
  // ---------------------------------------------------------------------------

  /**
   * Rename a node. Atomic: on failure nothing changes.
   *
   * The wire request names the node by its OLD name; the caller resolves it
   * here, checks the D3 rules, refuses camera/light hosts (D4), renames the
   * glTF node and moves the name-map entries.
   *
   * @param {string} oldName
   * @param {string} newName
   * @param {SOMObject} [target] — the object the caller resolved and authorized
   *   (world.setField resolves via `getObjectByName`). R3: the global namespace
   *   and the node map can disagree when two nodes share a name, so when a
   *   target is given the rename is refused INVALID_VALUE unless it names the
   *   very node this method would rename.
   * @returns {{ok: boolean, code: string|null}}
   */
  renameNode(oldName, newName, target = null) {
    const somNode = this._nodesByName.get(oldName)
    if (!somNode) {
      // Not a node: the document, a camera, a light or an animation.
      return {
        ok: false,
        code: this._objectsByName.has(oldName) ? 'INVALID_FIELD' : 'NODE_NOT_FOUND',
        message: null,
      }
    }

    // R3 — rename only the object that was authorized.
    if (target && target !== somNode) {
      return { ok: false, code: 'INVALID_VALUE', message: 'rename target is not the named node' }
    }

    // D4 — a node hosting a camera or a light cannot be renamed in step 1.
    if (somNode._node.getCamera() || somNode._node.getExtension('KHR_lights_punctual')) {
      return { ok: false, code: 'INVALID_VALUE', message: 'rename not supported for camera or light hosts' }
    }

    const check = this.checkNewName(newName, somNode)
    if (!check.ok) return { ok: false, code: check.code, message: check.message }

    if (newName === oldName) return { ok: true, code: null, message: null }

    somNode._node.setName(newName)

    if (this._nodesByName.get(oldName) === somNode)   this._nodesByName.delete(oldName)
    if (this._objectsByName.get(oldName) === somNode) this._objectsByName.delete(oldName)
    this._nodesByName.set(newName, somNode)
    this._objectsByName.set(newName, somNode)

    return { ok: true, code: null, message: null }
  }

  // ---------------------------------------------------------------------------
  // A6 — subtree dispose (decision D2)
  // ---------------------------------------------------------------------------

  /**
   * Remove a node and its whole subtree, children first. Every map deletion is
   * guarded by object identity, so a reused name or a rename cannot unregister
   * a different object (F7). A hosted camera or light is cleaned up completely;
   * a camera shared with a surviving node keeps its bare name and its place in
   * `cameras` — only the deleted host's own alias goes.
   *
   * @param {SOMNode} somNode
   */
  removeSubtree(somNode) {
    if (!somNode) return
    for (const child of somNode.children.slice()) {
      this.removeSubtree(child)
    }
    this._disposeNode(somNode._node, somNode)
  }

  /**
   * Dispose one glTF node and drop every cache entry that still points at it.
   * @param {object} gltfNode
   * @param {SOMNode} somNode
   */
  _disposeNode(gltfNode, somNode) {
    if (!gltfNode) return

    // Capture attachments before the node's edges are torn down: after
    // dispose(), gltfNode.getCamera() returns null.
    const gltfCamera = gltfNode.getCamera()
    const gltfLight  = gltfNode.getExtension?.('KHR_lights_punctual')
    const name       = gltfNode.getName()

    gltfNode.dispose()

    if (this._nodeMap.get(gltfNode) === somNode)   this._nodeMap.delete(gltfNode)
    if (this._nodesByName.get(name) === somNode)   this._nodesByName.delete(name)
    if (this._objectsByName.get(name) === somNode) this._objectsByName.delete(name)

    if (gltfCamera) this._disposeHostedCamera(name, gltfCamera)
    if (gltfLight)  this._disposeHostedLight(name, gltfLight)
  }

  /**
   * Clean up a camera hosted by a disposed node. The host's own alias always
   * goes; the camera object, its bare name and its `cameras` slot go only when
   * no surviving node still references the glTF camera.
   */
  _disposeHostedCamera(hostName, gltfCamera) {
    const somCamera = this._cameraMap.get(gltfCamera)
    if (!somCamera) return

    const alias = hostName + '.camera'
    if (this._objectsByName.get(alias) === somCamera) this._objectsByName.delete(alias)

    const stillReferenced = this._root.listNodes().some(n => n.getCamera() === gltfCamera)
    if (stillReferenced) return

    const bareName = gltfCamera.getName?.() ?? null
    if (bareName && this._objectsByName.get(bareName) === somCamera) {
      this._objectsByName.delete(bareName)
    }
    if (this._cameraMap.get(gltfCamera) === somCamera) this._cameraMap.delete(gltfCamera)
    const idx = this._cameras.indexOf(somCamera)
    if (idx >= 0) this._cameras.splice(idx, 1)
    somCamera._qualifiedName = null
    somCamera._hostNode      = null
  }

  /**
   * Clean up a light hosted by a disposed node — same rules as a camera.
   */
  _disposeHostedLight(hostName, gltfLight) {
    const somLight = this._lightMap.get(gltfLight)
    if (!somLight) return

    const alias = hostName + '.light'
    if (this._objectsByName.get(alias) === somLight) this._objectsByName.delete(alias)

    const stillReferenced = this._root.listNodes().some(
      n => n.getExtension?.('KHR_lights_punctual') === gltfLight
    )
    if (stillReferenced) return

    const bareName = gltfLight.getName?.() ?? null
    if (bareName && this._objectsByName.get(bareName) === somLight) {
      this._objectsByName.delete(bareName)
    }
    if (this._lightMap.get(gltfLight) === somLight) this._lightMap.delete(gltfLight)
    const idx = this._lights.indexOf(somLight)
    if (idx >= 0) this._lights.splice(idx, 1)
    somLight._qualifiedName = null
  }

  // ---------------------------------------------------------------------------
  // Document accessor
  // ---------------------------------------------------------------------------

  get document() { return this._document }

  // ---------------------------------------------------------------------------
  // Document root extras
  // ---------------------------------------------------------------------------

  get extras() {
    return this._root.getExtras()
  }

  set extras(value) {
    this._root.setExtras(value)
    if (this._hasListeners('mutation')) {
      this._dispatchEvent(new SOMEvent('mutation', { target: this, property: 'extras', value }))
    }
  }

  /**
   * Mutate a single field inside extras.atrium by dot-delimited path.
   * e.g. setExtrasAtrium('background.texture', 'sky.png')
   * Fires a mutation event via the extras setter.
   */
  setExtrasAtrium(path, value) {
    const extras = structuredClone(this.extras || {})
    const atrium = extras.atrium || (extras.atrium = {})

    const segments = path.split('.')
    let target = atrium
    for (let i = 0; i < segments.length - 1; i++) {
      if (target[segments[i]] === undefined || target[segments[i]] === null) {
        target[segments[i]] = {}
      }
      target = target[segments[i]]
    }
    target[segments[segments.length - 1]] = value

    this.extras = { ...extras, atrium }
  }

  // ---------------------------------------------------------------------------
  // Scene graph entry point
  // ---------------------------------------------------------------------------

  get scene() {
    const sc = this._root.listScenes()[0]
    return sc ? (this._sceneMap.get(sc) ?? new SOMScene(sc, this)) : null
  }

  // ---------------------------------------------------------------------------
  // Node lookup (O(1) via name map)
  // ---------------------------------------------------------------------------

  getNodeByName(name) {
    return this._nodesByName.get(name) ?? null
  }

  // ---------------------------------------------------------------------------
  // Animation lookup (O(1) via name map)
  // ---------------------------------------------------------------------------

  getAnimationByName(name) {
    return this._animationsByName.get(name) ?? null
  }

  // ---------------------------------------------------------------------------
  // Global namespace lookup — returns any SOM object by name
  // ---------------------------------------------------------------------------

  getObjectByName(name) {
    return this._objectsByName.get(name) ?? null
  }

  // ---------------------------------------------------------------------------
  // Collections — return cached wrapper instances
  // ---------------------------------------------------------------------------

  get nodes()      { return Array.from(this._nodesByName.values()) }
  get meshes()     { return Array.from(this._meshMap.values()) }
  get materials()  { return Array.from(this._materialMap.values()) }
  get cameras()    { return [...this._cameras] }
  get animations() { return Array.from(this._animationMap.values()) }
  get lights()     { return [...this._lights] }
  get textures()   { return Array.from(this._textureMap.values()) }
  get skins()      { return Array.from(this._skinMap.values()) }

  // ---------------------------------------------------------------------------
  // Private cache resolution helpers — resolve glTF-Transform objects to the
  // single cached SOM wrapper instance registered at build/ingest time.
  // Used by child accessors in SOMScene, SOMNode, SOMSkin, SOMMesh, SOMPrimitive
  // to guarantee wrapper identity and preserve mutation listener wiring.
  // ---------------------------------------------------------------------------

  _resolveNode(n)     { return this._nodeMap.get(n)      ?? null }
  _resolveMesh(m)     { return this._meshMap.get(m)      ?? null }
  _resolveCamera(c)   { return this._cameraMap.get(c)    ?? null }
  _resolvePrimitive(p){ return this._primitiveMap.get(p) ?? null }
  _resolveMaterial(m) { return this._materialMap.get(m)  ?? null }
  _resolveSkin(s)     { return this._skinMap.get(s)      ?? null }

  // ---------------------------------------------------------------------------
  // Factories — create + register in maps
  // ---------------------------------------------------------------------------

  createNode(descriptor = {}) {
    const node = this._document.createNode(descriptor.name ?? '')
    if (descriptor.translation) node.setTranslation(descriptor.translation)
    if (descriptor.rotation)    node.setRotation(descriptor.rotation)
    if (descriptor.scale)       node.setScale(descriptor.scale)
    if (descriptor.extras)      node.setExtras(descriptor.extras)
    const somNode = new SOMNode(node, this)
    this._nodeMap.set(node, somNode)
    const name = node.getName()
    this._nodesByName.set(name, somNode)
    this._registerObject(name, somNode)
    this._registerNodeDispose(node, somNode)
    return somNode
  }

  createMesh(descriptor = {}) {
    const mesh    = this._document.createMesh(descriptor.name ?? '')
    const somMesh = new SOMMesh(mesh, this)
    somMesh._prims = []
    this._meshMap.set(mesh, somMesh)
    return somMesh
  }

  createMaterial(descriptor = {}) {
    const mat = this._document.createMaterial(descriptor.name ?? '')
    if (descriptor.baseColorFactor !== undefined)  mat.setBaseColorFactor(descriptor.baseColorFactor)
    if (descriptor.metallicFactor  !== undefined)  mat.setMetallicFactor(descriptor.metallicFactor)
    if (descriptor.roughnessFactor !== undefined)  mat.setRoughnessFactor(descriptor.roughnessFactor)
    const somMat = new SOMMaterial(mat)
    this._materialMap.set(mat, somMat)
    return somMat
  }

  createCamera(descriptor = {}) {
    const cam    = this._document.createCamera(descriptor.name ?? '')
    if (descriptor.type) cam.setType(descriptor.type)
    const somCam = new SOMCamera(cam)
    this._cameraMap.set(cam, somCam)
    return somCam
  }

  createPrimitive(descriptor = {}) {
    const prim    = this._document.createPrimitive()
    const somPrim = new SOMPrimitive(prim, this)
    this._primitiveMap.set(prim, somPrim)
    return somPrim
  }

  createAnimation(descriptor = {}) {
    const anim    = this._document.createAnimation(descriptor.name ?? '')
    const somAnim = new SOMAnimation(anim)
    this._animationMap.set(anim, somAnim)
    const name = anim.getName()
    this._animationsByName.set(name, somAnim)
    this._registerObject(name, somAnim)
    return somAnim
  }

  // ---------------------------------------------------------------------------
  // ingestNode — create node + full mesh geometry, register everything in maps
  // ---------------------------------------------------------------------------

  ingestNode(descriptor = {}) {
    const node = this._document.createNode(descriptor.name ?? '')
    if (descriptor.translation) node.setTranslation(descriptor.translation)
    if (descriptor.rotation)    node.setRotation(descriptor.rotation)
    if (descriptor.scale)       node.setScale(descriptor.scale)
    if (descriptor.extras)      node.setExtras(descriptor.extras)

    const somNode = new SOMNode(node, this)
    this._nodeMap.set(node, somNode)
    const name = node.getName()
    this._nodesByName.set(name, somNode)
    this._registerObject(name, somNode)
    this._registerNodeDispose(node, somNode)

    if (descriptor.mesh) {
      const mesh    = this._document.createMesh(descriptor.mesh.name ?? '')
      const somMesh = new SOMMesh(mesh, this)
      somMesh._prims = []
      this._meshMap.set(mesh, somMesh)
      somNode._mesh = somMesh

      for (const primDesc of descriptor.mesh.primitives ?? []) {
        const prim = this._document.createPrimitive()
        const buf  = this._document.createBuffer()

        if (Array.isArray(primDesc.attributes?.POSITION)) {
          const acc = this._document.createAccessor()
            .setType('VEC3')
            .setArray(new Float32Array(primDesc.attributes.POSITION))
            .setBuffer(buf)
          prim.setAttribute('POSITION', acc)
        }

        if (Array.isArray(primDesc.attributes?.NORMAL)) {
          const acc = this._document.createAccessor()
            .setType('VEC3')
            .setArray(new Float32Array(primDesc.attributes.NORMAL))
            .setBuffer(buf)
          prim.setAttribute('NORMAL', acc)
        }

        if (Array.isArray(primDesc.indices)) {
          const acc = this._document.createAccessor()
            .setType('SCALAR')
            .setArray(new Uint16Array(primDesc.indices))
            .setBuffer(buf)
          prim.setIndices(acc)
        }

        const somPrim = new SOMPrimitive(prim, this)
        this._primitiveMap.set(prim, somPrim)
        somMesh._prims.push(somPrim)

        if (primDesc.material) {
          const mat = this._document.createMaterial()
          const pbr = primDesc.material.pbrMetallicRoughness
          if (pbr?.baseColorFactor)              mat.setBaseColorFactor(pbr.baseColorFactor)
          if (pbr?.metallicFactor  !== undefined) mat.setMetallicFactor(pbr.metallicFactor)
          if (pbr?.roughnessFactor !== undefined) mat.setRoughnessFactor(pbr.roughnessFactor)
          const somMat = new SOMMaterial(mat)
          this._materialMap.set(mat, somMat)
          somPrim._material = somMat
          prim.setMaterial(mat)
        }

        mesh.addPrimitive(prim)
      }
      node.setMesh(mesh)
    }

    return somNode
  }

  // ---------------------------------------------------------------------------
  // ingestExternalScene — copy a parsed external Document under a container node
  // ---------------------------------------------------------------------------

  /**
   * Walk the default scene of `externalDocument`, copy all its nodes (with
   * prefixed names), meshes, materials, and geometry into this document, and
   * attach them as children of the container node named `containerName`.
   *
   * Naming: every ingested node's SOM name becomes `containerName/originalName`.
   * Nested children follow naturally: `containerName/Parent/Child`.
   *
   * The external document's root `extras` (including `extras.atrium`) are NOT
   * copied — only the scene graph and geometry are consumed.
   *
   * @param {string}   containerName    - Name of the existing SOM container node
   * @param {Document} externalDocument - Parsed glTF-Transform Document
   * @returns {SOMNode[]} Newly created top-level SOMNode instances
   */
  ingestExternalScene(containerName, externalDocument) {
    const containerSomNode = this.getNodeByName(containerName)
    if (!containerSomNode) throw new Error(`Container node "${containerName}" not found in SOM`)

    const extRoot  = externalDocument.getRoot()
    const extScene = extRoot.listScenes()[0]
    if (!extScene) return []

    // Shared buffer for all copied geometry
    const buf = this._document.createBuffer()

    // Copy-through caches: ext glTF-Transform object → world glTF-Transform object
    const matCopyMap  = new Map()
    const meshCopyMap = new Map()

    const copyAccessor = (extAcc) => {
      const arr = extAcc.getArray()
      return this._document.createAccessor()
        .setType(extAcc.getType())
        .setArray(arr.slice())
        .setBuffer(buf)
    }

    const copyMaterial = (extMat) => {
      if (matCopyMap.has(extMat)) return matCopyMap.get(extMat)
      const mat = this._document.createMaterial(extMat.getName())
        .setBaseColorFactor(extMat.getBaseColorFactor())
        .setMetallicFactor(extMat.getMetallicFactor())
        .setRoughnessFactor(extMat.getRoughnessFactor())
        .setEmissiveFactor(extMat.getEmissiveFactor())
        .setAlphaMode(extMat.getAlphaMode())
      const somMat = new SOMMaterial(mat)
      this._materialMap.set(mat, somMat)
      matCopyMap.set(extMat, mat)
      return mat
    }

    const copyMesh = (extMesh) => {
      if (meshCopyMap.has(extMesh)) return meshCopyMap.get(extMesh)
      const mesh    = this._document.createMesh(extMesh.getName())
      const somMesh = new SOMMesh(mesh, this)
      somMesh._prims = []
      this._meshMap.set(mesh, somMesh)
      meshCopyMap.set(extMesh, mesh)

      for (const extPrim of extMesh.listPrimitives()) {
        const prim = this._document.createPrimitive()

        for (const semantic of extPrim.listSemantics()) {
          prim.setAttribute(semantic, copyAccessor(extPrim.getAttribute(semantic)))
        }

        const extIdx = extPrim.getIndices()
        if (extIdx) prim.setIndices(copyAccessor(extIdx))

        const extMat = extPrim.getMaterial()
        if (extMat) prim.setMaterial(copyMaterial(extMat))

        const somPrim = new SOMPrimitive(prim, this)
        const copiedMat = prim.getMaterial()
        if (copiedMat) somPrim._material = this._materialMap.get(copiedMat) ?? null
        this._primitiveMap.set(prim, somPrim)
        somMesh._prims.push(somPrim)
        mesh.addPrimitive(prim)
      }

      return mesh
    }

    // Recursively copy a node from the external document.
    // namePrefix is e.g. "Crate/" for root nodes, "Crate/Parent/" for children.
    const copyNode = (extNode, namePrefix) => {
      const prefixedName = namePrefix + extNode.getName()
      const node = this._document.createNode(prefixedName)
      node.setTranslation(extNode.getTranslation())
      node.setRotation(extNode.getRotation())
      node.setScale(extNode.getScale())
      const extras = extNode.getExtras()
      if (extras && Object.keys(extras).length > 0) node.setExtras(extras)

      const somNode = new SOMNode(node, this)
      this._nodeMap.set(node, somNode)
      this._nodesByName.set(prefixedName, somNode)
      this._registerObject(prefixedName, somNode)
      this._registerNodeDispose(node, somNode)

      const extMesh = extNode.getMesh()
      if (extMesh) {
        const mesh = copyMesh(extMesh)
        node.setMesh(mesh)
        somNode._mesh = this._meshMap.get(mesh) ?? null
      }

      for (const extChild of extNode.listChildren()) {
        const childSomNode = copyNode(extChild, prefixedName + '/')
        node.addChild(childSomNode._node)
      }

      return somNode
    }

    const newTopLevelNodes = []
    for (const extNode of extScene.listChildren()) {
      const somNode = copyNode(extNode, containerName + '/')
      containerSomNode._node.addChild(somNode._node)
      newTopLevelNodes.push(somNode)
    }

    // Fire childList mutation event on the container node
    if (containerSomNode._hasListeners('mutation')) {
      containerSomNode._dispatchEvent(new SOMEvent('mutation', {
        target:    containerSomNode,
        childList: { addedNodes: newTopLevelNodes.map(n => n.name) },
      }))
    }

    return newTopLevelNodes
  }

  // ---------------------------------------------------------------------------
  // Path resolution
  // ---------------------------------------------------------------------------

  getPath(somNode, path) {
    const segments = parsePath(path)
    const { target, key } = resolvePath(somNode, segments)
    return target[key]
  }

  setPath(somNode, path, value) {
    const segments = parsePath(path)
    const { target, key } = resolvePath(somNode, segments)
    if (typeof key === 'string' && !(key in target)) {
      throw new Error(`Unknown property "${key}" on ${target?.constructor?.name ?? 'object'}`)
    }
    target[key] = value
  }
}
