// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve as resolvePath } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'
import { SOMDocument, pruneCandidateProperties, pruneDocumentInPlace } from '@atrium/som'
import { objectIdProblem, behaviorCheck, BEHAVIOR_NODES_PER_WORLD } from './send-policy.js'

/** Typed errors L3 throws. Both write nothing. */
export const SERIALIZE_INDEX_MISMATCH       = 'SERIALIZE_INDEX_MISMATCH'
export const SERIALIZE_EXCLUDED_REFERENCED  = 'SERIALIZE_EXCLUDED_REFERENCED'

function createIO() {
  return new NodeIO().registerExtensions([KHRLightsPunctual])
}

function typedError(code, message) {
  const err = new Error(`${code}: ${message}`)
  err.code = code
  return err
}

/**
 * Fetch a file by URL. Uses fs.readFile for file:// URLs, globalThis.fetch for
 * http(s)://. Returns the raw text content.
 */
async function fetchText(url) {
  if (url.startsWith('file://')) {
    const path = new URL(url).pathname
    return readFile(path, 'utf8')
  }
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching "${url}"`)
  return resp.text()
}

/** Names of every node in a subtree, the root included (A6/C8). */
function collectSubtreeNames(somNode) {
  const names = [somNode.name]
  for (const child of somNode.children) names.push(...collectSubtreeNames(child))
  return names
}

/** Every SOMNode in a subtree, the root included. */
function collectSubtreeNodes(somNode) {
  const out = [somNode]
  for (const child of somNode.children) out.push(...collectSubtreeNodes(child))
  return out
}

async function fetchBinary(url) {
  if (url.startsWith('file://')) {
    const path = new URL(url).pathname
    const buf = await readFile(path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching "${url}"`)
  return resp.arrayBuffer()
}

// ---------------------------------------------------------------------------
// L3 — the one serialize, shared by both world kinds (H11)
// ---------------------------------------------------------------------------

/**
 * Embed every buffer AND every image in the writer's resources map as a data:
 * URI (H13). glTF-Transform writes images as separate resources, which the old
 * serialize dropped: a save, a som-dump and the commons seed lost every
 * texture image.
 */
function embedResources(json, resources) {
  for (const buf of json.buffers ?? []) {
    if (buf.uri && !buf.uri.startsWith('data:')) {
      const data = resources[buf.uri]
      if (data) {
        buf.uri = 'data:application/octet-stream;base64,' + Buffer.from(data).toString('base64')
      }
    }
  }
  for (const img of json.images ?? []) {
    if (img.uri && !img.uri.startsWith('data:')) {
      const data = resources[img.uri]
      if (data) {
        const mime = img.mimeType ?? 'image/png'
        img.uri = `data:${mime};base64,` + Buffer.from(data).toString('base64')
      }
    }
  }
}

/**
 * Resolve an exclusion entry to a glTF node IDENTITY, never a name (H15,
 * review #8). Accepts a SOMNode or a glTF-Transform Node. A bare name is
 * resolved through the SOM only as a compatibility path for callers that have
 * not been moved to identities yet.
 */
function toGltfNode(som, entry) {
  if (!entry) return null
  if (entry._node) return entry._node                              // SOMNode
  if (entry.propertyType === 'Node') return entry                   // glTF Node
  if (typeof entry === 'string') return som.getNodeByName(entry)?._node ?? null
  return null
}

/** Add a node and all its descendants to `out`. */
function collectNodeSubtree(gltfNode, out) {
  if (!gltfNode || out.has(gltfNode)) return
  out.add(gltfNode)
  for (const child of gltfNode.listChildren()) collectNodeSubtree(child, out)
}

/** The prunable resources a set of glTF nodes uses (read before disposal). */
function candidatesForNodes(gltfNodes) {
  const candidates = []
  for (const node of gltfNodes) {
    const mesh  = node.getMesh()
    const skin  = node.getSkin()
    const cam   = node.getCamera()
    const light = node.getExtension?.('KHR_lights_punctual')
    if (mesh)  candidates.push(mesh)
    if (skin)  candidates.push(skin)
    if (cam)   candidates.push(cam)
    if (light) candidates.push(light)
  }
  return candidates
}

/**
 * L3 — serialize a SOM document, optionally excluding nodes.
 *
 * No exclusions: written from the live document, images and buffers embedded.
 *
 * With exclusions: the excluded nodes are resolved to IDENTITIES, mapped to
 * their indices in `root.listNodes()`, and the document is written and read
 * back with its resources. The index correspondence is checked before anything
 * is disposed (`SERIALIZE_INDEX_MISMATCH`); a kept animation channel or skin
 * that references an excluded node is refused
 * (`SERIALIZE_EXCLUDED_REFERENCED`). The excluded subtrees are then disposed in
 * the copy, L1 prunes the resources they used, and the copy is written. The
 * live document is never touched.
 *
 * @param {SOMDocument} som
 * @param {{excludeNodes?: Iterable<object|string>, _testForceNodeListMismatch?: boolean}} [options]
 * @returns {Promise<object>} glTF JSON
 */
export async function serializeSomDocument(som, { excludeNodes, _testForceNodeListMismatch = false } = {}) {
  const io = createIO()
  const document = som._document
  const root = document.getRoot()

  const excludedRoots = new Set()
  for (const entry of excludeNodes ?? []) {
    const gltfNode = toGltfNode(som, entry)
    if (gltfNode) excludedRoots.add(gltfNode)
  }

  if (excludedRoots.size === 0) {
    const { json, resources } = await io.writeJSON(document)
    embedResources(json, resources)
    return json
  }

  const excludedNodes = new Set()
  for (const node of excludedRoots) collectNodeSubtree(node, excludedNodes)

  // 1. exclusions to indices in the live node list.
  const liveNodes = root.listNodes()
  const excludedIndices = []
  for (const node of excludedNodes) {
    const index = liveNodes.indexOf(node)
    if (index >= 0) excludedIndices.push(index)
  }

  // 2. write the live document and read it back WITH its resources.
  const { json, resources } = await io.writeJSON(document)
  const copy = await io.readJSON({ json, resources })
  const copyRoot = copy.getRoot()
  // §7.1 test hook: the copy is written from the live node list, so this guard
  // is unreachable from the public surface. Tests pass
  // `_testForceNodeListMismatch` to drop a node from the copy's list and prove
  // the guard fires instead of writing a document keyed to the wrong nodes.
  const copyNodes = _testForceNodeListMismatch
    ? copyRoot.listNodes().slice(1)
    : copyRoot.listNodes()

  if (copyNodes.length !== liveNodes.length) {
    throw typedError(SERIALIZE_INDEX_MISMATCH,
      `copy has ${copyNodes.length} node(s), live document has ${liveNodes.length}`)
  }
  for (const index of excludedIndices) {
    if (copyNodes[index].getName() !== liveNodes[index].getName()) {
      throw typedError(SERIALIZE_INDEX_MISMATCH,
        `node ${index} is "${copyNodes[index].getName()}" in the copy, "${liveNodes[index].getName()}" live`)
    }
  }

  // 3. refuse a structural break: a kept channel or skin that uses an excluded node.
  const excludedCopy = new Set(excludedIndices.map(i => copyNodes[i]))
  for (const animation of copyRoot.listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode?.()
      if (target && excludedCopy.has(target)) {
        throw typedError(SERIALIZE_EXCLUDED_REFERENCED,
          `animation "${animation.getName()}" targets an excluded node`)
      }
    }
  }
  for (const skin of copyRoot.listSkins()) {
    for (const joint of skin.listJoints()) {
      if (excludedCopy.has(joint)) {
        throw typedError(SERIALIZE_EXCLUDED_REFERENCED, 'a skin joint is an excluded node')
      }
    }
    const skeleton = skin.getSkeleton()
    if (skeleton && excludedCopy.has(skeleton)) {
      throw typedError(SERIALIZE_EXCLUDED_REFERENCED, 'a skin skeleton is an excluded node')
    }
  }

  // 4. dispose the excluded subtrees in the copy, prune what they used, write.
  const candidates = candidatesForNodes(excludedCopy)
  for (const node of excludedCopy) {
    try { node.dispose() } catch { /* already detached */ }
  }
  pruneCandidateProperties(copyRoot, candidates)

  const { json: outJson, resources: outResources } = await io.writeJSON(copy)
  embedResources(outJson, outResources)
  return outJson
}

// ---------------------------------------------------------------------------
// L4 — heal on load (K2, as narrowed in Rev 2): no node is removed.
// ---------------------------------------------------------------------------

/** Every node reachable from a scene. */
function sceneNodeSet(root) {
  const inScene = new Set()
  const walk = (node) => {
    if (inScene.has(node)) return
    inScene.add(node)
    for (const child of node.listChildren()) walk(child)
  }
  for (const scene of root.listScenes()) {
    for (const child of scene.listChildren()) walk(child)
  }
  return inScene
}

/**
 * L4 — heal a document world on load (K2, as narrowed in Rev 2). Prunes
 * unreferenced resources across the whole document, before the SOM is built.
 * A resource a detached node uses is still referenced, so it stays. Nodes are
 * never removed; the log reports how many detached roots were seen, and the
 * counts it removed — counts only, never names (K2/S1). Not applied to file
 * worlds: those are the operator's files, re-read at every boot.
 *
 * @param {object} document   glTF-Transform Document
 * @param {{log?: object|null}} [opts]
 * @returns {{counts: object, detachedRoots: number}}
 */
export function healDocumentOnLoad(document, { log = console } = {}) {
  const root = document.getRoot()
  const inScene = sceneNodeSet(root)
  const detachedRoots = root.listNodes().filter(n => !inScene.has(n)).length

  const { counts } = pruneDocumentInPlace(document)
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)

  if (total > 0 || detachedRoots > 0) {
    log.log(
      '[world] healed document: ' +
      `${counts.mesh} meshes, ${counts.primitive} primitives, ` +
      `${counts.primitiveTarget} morph targets, ${counts.material} materials, ` +
      `${counts.texture} textures, ${counts.accessor} accessors, ` +
      `${counts.buffer} buffers, ${counts.skin} skins, ${counts.camera} cameras, ` +
      `${counts.light} lights removed; ${detachedRoots} detached root nodes kept`
    )
  }

  return { counts, detachedRoots }
}

// ---------------------------------------------------------------------------
// 4b-1 E3 (B4 (a)) — load healing for extras.atrium.objectId
// ---------------------------------------------------------------------------

function isPlainDataObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** A document node's own `extras.atrium.objectId`, or undefined. Plain checks only. */
function readNodeObjectId(gltfNode) {
  const extras = gltfNode?.getExtras?.()
  if (!isPlainDataObject(extras)) return undefined
  const atrium = extras.atrium
  if (!isPlainDataObject(atrium)) return undefined
  if (!Object.hasOwn(atrium, 'objectId')) return undefined
  return atrium.objectId
}

/** Delete only the `objectId` key: every other `extras` key, and an empty `atrium`, stay. */
function dropNodeObjectId(gltfNode) {
  const atrium = gltfNode?.getExtras?.()?.atrium
  if (isPlainDataObject(atrium)) delete atrium.objectId
}

/**
 * 4b-1 E3 (B4 (a)) — heal `extras.atrium.objectId` on a document being loaded,
 * BEFORE the SOM is built, so both world kinds share one implementation
 * (`createWorld` for file worlds, `createWorldFromDocument` for document
 * worlds; the second already runs `healDocumentOnLoad`).
 *
 * Two rules, on the glTF DOCUMENT — where "saved node" is simply every document
 * node, external nodes never being in view (file worlds ingest them only later,
 * document worlds never do on the server):
 *
 *  1. An id held by TWO OR MORE nodes is removed from ALL of them. No node
 *     keeps a duplicated id, so nothing can silently become "the" object a
 *     saved reference meant.
 *  2. An id that fails E1 is removed too: a malformed id can't be repaired,
 *     only dropped, and a later set-once `send` can assign a fresh one.
 *
 * Logging: ONE line per duplicated id, with a count, and one line per malformed
 * node, with its index. No node names are logged at all.
 *
 * @param {object} document   glTF-Transform Document
 * @param {{log?: object|null}} [opts]
 * @returns {{duplicated: number, malformed: number}}
 */
export function healDocumentObjectIds(document, { log = console } = {}) {
  const nodes = document.getRoot().listNodes()

  const holders = new Map()   // id -> count
  for (const node of nodes) {
    const id = readNodeObjectId(node)
    if (id === undefined) continue
    holders.set(id, (holders.get(id) ?? 0) + 1)
  }

  let duplicated = 0
  for (const [id, count] of holders) {
    if (count < 2) continue
    duplicated += 1
    for (const node of nodes) {
      if (readNodeObjectId(node) === id) dropNodeObjectId(node)
    }
    log?.log?.(`[world] dropped duplicated objectId ${id} from ${count} nodes`)
  }

  let malformed = 0
  nodes.forEach((node, index) => {
    const id = readNodeObjectId(node)
    if (id === undefined) return
    if (objectIdProblem(id) !== null) {
      dropNodeObjectId(node)
      malformed += 1
      log?.log?.(`[world] dropped malformed objectId on node ${index}`)
    }
  })

  return { duplicated, malformed }
}

/** The `extras.atrium.behavior` value stored on a glTF-Transform node, or undefined. */
function readNodeBehavior(gltfNode) {
  const atrium = gltfNode?.getExtras?.()?.atrium
  if (!isPlainDataObject(atrium)) return undefined
  return Object.hasOwn(atrium, 'behavior') ? atrium.behavior : undefined
}

/**
 * Replace only the `behavior` key with `null`: every other `extras` key stays,
 * and the saved document carries the null (F2's healing rule says the value is
 * "replaced by null", so the key survives — unlike `objectId`, which is removed).
 */
function dropNodeBehavior(gltfNode) {
  const atrium = gltfNode?.getExtras?.()?.atrium
  if (isPlainDataObject(atrium)) atrium.behavior = null
}

/**
 * scripting-4b-2 F2 — heal `extras.atrium.behavior` on a document being loaded,
 * AFTER `healDocumentObjectIds` (so a behaviour whose node lost its id to id
 * healing is dropped in the same pass) and BEFORE the SOM is built. Both world
 * kinds call it, so they share one implementation.
 *
 * Three rules, in document order, one log line per dropped behaviour:
 *
 *  1. a node with NO own `objectId` keeps no behaviour — its `nodeMap[0]` could
 *     never resolve, and F1's own-id rule is the first thing `send` applies;
 *  2. a behaviour that fails F1 (with the node's own id as `nodeMap[0]`) is
 *     dropped;
 *  3. past the 64th behaviour node the value is dropped: the world's limit is
 *     the SERVER's, and a hand-made document must not exceed it in silence.
 *
 * @param {object} document   glTF-Transform Document
 * @param {{log?: object|null}} [opts]
 * @returns {{noId: number, malformed: number, overLimit: number}}
 */
export function healDocumentBehaviors(document, { log = console } = {}) {
  const nodes = document.getRoot().listNodes()
  let noId = 0
  let malformed = 0
  let overLimit = 0
  let behaviorsKept = 0

  nodes.forEach((node, index) => {
    const behavior = readNodeBehavior(node)
    if (behavior === undefined) return

    const id = readNodeObjectId(node)
    if (typeof id !== 'string' || id.length === 0) {
      dropNodeBehavior(node)
      noId += 1
      log?.log?.(`[world] dropped behavior on node ${index}: no object id`)
      return
    }

    if (behavior !== null) {
      // V9 — the LOAD path fails closed too: a check that throws drops this one
      // behaviour (to null) instead of taking the load, or the process, down.
      let check
      try {
        check = behaviorCheck(behavior, { ownId: id })
      } catch (error) {
        dropNodeBehavior(node)
        malformed += 1
        log?.log?.(`[world] dropped malformed behavior on node ${index}: ${error?.message ?? 'the check threw'} (could not be checked)`)
        return
      }
      if (check.problem) {
        dropNodeBehavior(node)
        malformed += 1
        log?.log?.(`[world] dropped malformed behavior on node ${index}: ${check.problem}`)
        return
      }
    }

    // The 64 cap counts the behaviours that SURVIVE the two rules above.
    if (behavior !== null) {
      if (behaviorsKept >= BEHAVIOR_NODES_PER_WORLD) {
        dropNodeBehavior(node)
        overLimit += 1
        log?.log?.(`[world] dropped behavior on node ${index}: over the world limit`)
        return
      }
      behaviorsKept += 1
    }
  })

  return { noId, malformed, overLimit }
}

export async function createWorld(gltfPath, { baseUrl } = {}) {
  const io = createIO()
  const document = await io.read(gltfPath)

  // 4b-1 E3 — load healing for object ids, before the SOM is built (B4 (a)).
  healDocumentObjectIds(document)

  // scripting-4b-2 F2 — behaviour healing, AFTER the id healing, so a behaviour
  // whose node just lost its id is dropped in the same pass.
  healDocumentBehaviors(document)

  const som = new SOMDocument(document)

  // Derive base URL for resolving relative extras.atrium.source paths.
  // If an explicit baseUrl is provided (e.g. from .atrium.json world.baseUrl),
  // use it; otherwise fall back to a file:// URL from the resolved filesystem path.
  const absPath    = resolvePath(gltfPath)
  const worldBaseUrl = baseUrl ?? pathToFileURL(absPath).href

  const rootExtras = document.getRoot().getExtras()
  const meta = rootExtras?.atrium ?? {}

  // Nodes created by ingestExternalScene — filtered from som-dump by IDENTITY
  // (L3 step 1), and by name for the A4 checks the session layer makes.
  const externalNodes     = new Set()   // SOMNode identities
  const externalNodeNames = new Set()   // their names, for A4 checks

  // Resolve external references synchronously before the server opens connections.
  // Called by index.js via world.resolveExternalReferences() after createWorld().
  async function resolveExternalReferences() {
    const tasks = som.nodes
      .filter(n => n.extras?.atrium?.source)
      .map(n => _loadExternalRef(n.name, n.extras.atrium.source))
    await Promise.all(tasks)
  }

  async function _loadExternalRef(containerName, source) {
    const resolvedUrl = new URL(source, worldBaseUrl).href
    try {
      let doc
      if (resolvedUrl.endsWith('.glb')) {
        const buffer = await fetchBinary(resolvedUrl)
        doc = await io.readBinary(new Uint8Array(buffer))
      } else {
        const text = await fetchText(resolvedUrl)
        doc = await io.readJSON({ json: JSON.parse(text), resources: {} })
      }
      const newNodes = som.ingestExternalScene(containerName, doc)
      // Recursively register all ingested nodes so serialize() can exclude them
      _registerExternal(newNodes)
      console.log(`[world] External ref loaded: "${containerName}" ← ${resolvedUrl} (${newNodes.length} top-level node(s))`)
    } catch (err) {
      console.warn(`[world] Failed to load external ref "${resolvedUrl}" for container "${containerName}":`, err.message)
    }
  }

  function _registerExternal(somNodes) {
    for (const node of somNodes) {
      externalNodes.add(node)
      externalNodeNames.add(node.name)
      _registerExternal(node.children)
    }
  }

  function getNode(name) {
    return som.getNodeByName(name)
  }

  function setField(nodeName, field, value) {
    const target = som.getObjectByName(nodeName)
    if (!target) return { ok: false, code: 'NODE_NOT_FOUND' }
    // A8 — the explicit rename path. `world.setField` handles `field === 'name'`
    // itself through SOMDocument.renameNode's return value, so a duplicate or
    // invalid name comes back INVALID_VALUE instead of setPath's INVALID_FIELD.
    // R3 — hand renameNode the object resolved above, so the rename can only
    // touch the object that was authorized.
    if (field === 'name') {
      const result = som.renameNode(nodeName, value, target)
      if (!result.ok) return { ok: false, code: result.code, message: result.message }
      return { ok: true }
    }
    try {
      som.setPath(target, field, value)
    } catch {
      return { ok: false, code: 'INVALID_FIELD' }
    }
    return { ok: true }
  }

  function addNode(nodeDescriptor, parentName) {
    // Duplicate-name guard (T9)
    if (som.getNodeByName(nodeDescriptor.name)) {
      return { ok: false, code: 'INVALID_VALUE' }
    }
    // Check parent exists before ingesting (T9)
    if (parentName) {
      const parent = som.getNodeByName(parentName)
      if (!parent) return { ok: false, code: 'NODE_NOT_FOUND' }
    }
    const node = som.ingestNode(nodeDescriptor)
    if (parentName) {
      const parent = som.getNodeByName(parentName)
      parent.addChild(node)
    } else {
      som.scene.addChild(node)
    }
    return { ok: true, node }
  }

  // L3 — external content is always excluded, by IDENTITY.
  async function serialize({ excludeNodes } = {}) {
    const exclusions = [...externalNodes]
    if (excludeNodes) {
      for (const entry of excludeNodes) exclusions.push(entry)
    }
    return serializeSomDocument(som, { excludeNodes: exclusions })
  }

  function removeNode(nodeOrName) {
    // Accepts a name (the `remove` message path) or a SOMNode IDENTITY (L11 —
    // session disconnect cleanup, which must never re-resolve by name).
    const node = typeof nodeOrName === 'string' ? som.getNodeByName(nodeOrName) : nodeOrName
    if (!node) return { ok: false, code: 'NODE_NOT_FOUND' }
    // A6/C8 — the whole subtree goes, and the nodes it contributed to the
    // external sets are dropped with it.
    for (const sub of collectSubtreeNodes(node)) {
      externalNodes.delete(sub)
      externalNodeNames.delete(sub.name)
    }
    node.dispose()
    return { ok: true }
  }

  function getNodeTranslation(name) {
    const node = som.getNodeByName(name)
    if (!node) return null
    return [...node.translation]
  }

  function listNodeNames() {
    return som.nodes.map(n => n.name)
  }

  return { meta, som, externalNodeNames, externalNodes, getNode, setField, addNode, removeNode, getNodeTranslation, listNodeNames, serialize, resolveExternalReferences }
}

/**
 * Create a world from an in-memory glTF document (JSON string or parsed object).
 * Used for loading home worlds and other document-stored worlds from the DB.
 * Supports the same world API as createWorld() (in-memory vs file-based).
 *
 * @param {string|object} documentJson - serialized glTF JSON
 * @returns {Promise<object>} world object with same API as createWorld
 */
export async function createWorldFromDocument(documentJson) {
  const io = createIO()
  const parsed = typeof documentJson === 'string' ? JSON.parse(documentJson) : documentJson
  const document = await io.readJSON({ json: parsed, resources: {} })

  // L4 — heal on load, before the SOM is built. No node is removed.
  healDocumentOnLoad(document)

  // 4b-1 E3 — load healing for object ids, the same call a file world makes.
  healDocumentObjectIds(document)

  // scripting-4b-2 F2 — behaviour healing, the same call a file world makes.
  healDocumentBehaviors(document)

  const som = new SOMDocument(document)

  const rootExtras = document.getRoot().getExtras()
  const meta = rootExtras?.atrium ?? {}

  // Document worlds never fetch external references on the server (S1).
  // extras.atrium.source names a glTF URL; resolving it server-side was a
  // blind request forgery / memory-exhaustion vector (any owner could plant a
  // URL via add/send and have PROD fetch it on the next load). Clients resolve
  // references themselves (AtriumClient.resolveExternalReferences), so nothing
  // a visitor sees depends on this. We warn with a COUNT ONLY — never node
  // names or the owner-supplied URL — to keep attacker strings out of the log.
  async function resolveExternalReferences() {
    const count = som.nodes.filter(n => n.extras?.atrium?.source).length
    if (count > 0) {
      console.warn(
        `[world] Document world has ${count} node(s) with extras.atrium.source — ` +
        'server does not resolve external refs; clients resolve them client-side'
      )
    }
  }

  const externalNodes     = new Set()
  const externalNodeNames = new Set()

  function getNode(name) { return som.getNodeByName(name) }

  function setField(nodeName, field, value) {
    const target = som.getObjectByName(nodeName)
    if (!target) return { ok: false, code: 'NODE_NOT_FOUND' }
    // A8 — explicit rename path (see createWorld's setField). R3 — the resolved
    // target is handed to renameNode so only the authorized object is renamed.
    if (field === 'name') {
      const result = som.renameNode(nodeName, value, target)
      if (!result.ok) return { ok: false, code: result.code, message: result.message }
      return { ok: true }
    }
    try { som.setPath(target, field, value) } catch { return { ok: false, code: 'INVALID_FIELD' } }
    return { ok: true }
  }

  function addNode(nodeDescriptor, parentName) {
    // Duplicate-name guard (T9)
    if (som.getNodeByName(nodeDescriptor.name)) {
      return { ok: false, code: 'INVALID_VALUE' }
    }
    // Check parent exists before ingesting (T9)
    if (parentName) {
      const parent = som.getNodeByName(parentName)
      if (!parent) return { ok: false, code: 'NODE_NOT_FOUND' }
    }
    const node = som.ingestNode(nodeDescriptor)
    if (parentName) {
      const parent = som.getNodeByName(parentName)
      parent.addChild(node)
    } else {
      som.scene.addChild(node)
    }
    return { ok: true, node }
  }

  async function serialize({ excludeNodes } = {}) {
    return serializeSomDocument(som, { excludeNodes })
  }

  function removeNode(nodeOrName) {
    // Name (the `remove` message path) or SOMNode identity (L11 — disconnect).
    const node = typeof nodeOrName === 'string' ? som.getNodeByName(nodeOrName) : nodeOrName
    if (!node) return { ok: false, code: 'NODE_NOT_FOUND' }
    for (const sub of collectSubtreeNodes(node)) {
      externalNodes.delete(sub)
      externalNodeNames.delete(sub.name)
    }
    node.dispose()
    return { ok: true }
  }

  function getNodeTranslation(name) {
    const node = som.getNodeByName(name)
    if (!node) return null
    return [...node.translation]
  }

  function listNodeNames() { return som.nodes.map(n => n.name) }

  return { meta, som, externalNodeNames, externalNodes, getNode, setField, addNode, removeNode, getNodeTranslation, listNodeNames, serialize, resolveExternalReferences }
}
