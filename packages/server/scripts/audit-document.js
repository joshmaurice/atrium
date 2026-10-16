#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// L10 — a READ-ONLY document audit.
//
// Reads exactly ONE glTF JSON document from stdin and prints:
//   * the resource counts per type (L1's countDocumentResources);
//   * what L1's whole-document dry run would remove, per type — the real prune
//     on an independent writeJSON → readJSON copy, so the chain under an orphan
//     mesh is reported and the input document is never touched;
//   * the detached root nodes (unreachable from every scene, and not a child of
//     another node) — K2 as narrowed never deletes nodes, so the audit counts
//     them;
//   * dangling references: a channel with no target node, a primitive with no
//     POSITION, and any index that points past the end of its array.
//
// It writes nothing: stdout only, no files, no database.
//
// DEV acceptance feeds it from the database, as an unprivileged user, picking
// the world by id (slugs are unique only per owner — UNIQUE(owner_user_id, slug)):
//
//   sqlite3 -readonly /var/lib/atrium-dev/atrium.db \
//     "SELECT document FROM worlds WHERE id='<world id>'" \
//     | sudo -u atrium-dev /usr/local/bin/node \
//         /srv/atrium-dev/packages/server/scripts/audit-document.js

import { NodeIO } from '@gltf-transform/core'
import { KHRLightsPunctual } from '@gltf-transform/extensions'
import {
  countDocumentResources,
  pruneDocumentDryRun,
  PRUNE_COUNT_KEYS,
} from '@atrium/som'

const EXIT_USAGE = 2

function fail(message) {
  process.stderr.write(`audit-document: ${message}\n`)
  process.exit(EXIT_USAGE)
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

/**
 * The index just past the first complete JSON value in `text`, or -1.
 * String- and escape-aware, and depth-counting across both object and array
 * nesting, so `{...}{...}` is detected as two documents.
 */
function firstValueEnd(text) {
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue
    start = i
    break
  }
  if (start === -1) return -1

  const open = text[start]
  if (open !== '{' && open !== '[') {
    // A bare scalar (number/string/true/false/null): scan to the end of the token.
    let i = start
    while (i < text.length && !',]} \t\n\r'.includes(text[i])) {
      if (text[i] === '"') {
        i++
        while (i < text.length) {
          if (text[i] === '\\') { i += 2; continue }
          if (text[i] === '"') break
          i++
        }
      }
      i++
    }
    return i
  }

  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** Exactly one JSON object on stdin, or a usage error. */
function parseExactlyOneDocument(text) {
  if (!text.trim()) fail('expected exactly one glTF JSON document on stdin, got none')
  const end = firstValueEnd(text)
  if (end === -1) fail('stdin is not valid JSON: unterminated JSON value')
  const head = text.slice(0, end)
  if (text.slice(end).trim() !== '') {
    fail('expected exactly one glTF JSON document on stdin, got several')
  }
  let json
  try {
    json = JSON.parse(head)
  } catch (err) {
    fail(`stdin is not valid JSON: ${err.message}`)
  }
  if (Array.isArray(json)) {
    fail(`expected exactly one glTF JSON document on stdin, got an array of ${json.length}`)
  }
  if (typeof json !== 'object' || json === null) {
    fail('expected exactly one glTF JSON document on stdin, got a JSON scalar')
  }
  return json
}

// ---------------------------------------------------------------------------
// Raw-JSON checks (the parsed graph cannot show an out-of-range index: glTF-
// Transform drops or throws on it, while the audit must report it)
// ---------------------------------------------------------------------------

const listLen = (json, key) => (Array.isArray(json[key]) ? json[key].length : 0)

function checkDanglingReferences(json, out) {
  const nodes = Array.isArray(json.nodes) ? json.nodes : []

  const bad = (what, index, limit) => {
    if (typeof index !== 'number') return
    if (!Number.isInteger(index) || index < 0 || index >= limit) {
      out.push(`${what}: index ${index} out of range (0..${limit - 1})`)
    }
  }

  for (const [i, node] of nodes.entries()) {
    bad(`nodes[${i}].mesh`, node.mesh, listLen(json, 'meshes'))
    bad(`nodes[${i}].skin`, node.skin, listLen(json, 'skins'))
    bad(`nodes[${i}].camera`, node.camera, listLen(json, 'cameras'))
    for (const child of node.children ?? []) bad(`nodes[${i}].children`, child, nodes.length)
  }

  for (const [i, mesh] of (json.meshes ?? []).entries()) {
    for (const [j, prim] of (mesh.primitives ?? []).entries()) {
      if (!prim?.attributes || !Object.prototype.hasOwnProperty.call(prim.attributes, 'POSITION')) {
        out.push(`meshes[${i}].primitives[${j}]: no POSITION attribute`)
      }
      bad(`meshes[${i}].primitives[${j}].material`, prim?.material, listLen(json, 'materials'))
      bad(`meshes[${i}].primitives[${j}].indices`, prim?.indices, listLen(json, 'accessors'))
      for (const [semantic, accessor] of Object.entries(prim?.attributes ?? {})) {
        bad(`meshes[${i}].primitives[${j}].attributes.${semantic}`, accessor, listLen(json, 'accessors'))
      }
      for (const [k, target] of (prim?.targets ?? []).entries()) {
        for (const [semantic, accessor] of Object.entries(target ?? {})) {
          bad(`meshes[${i}].primitives[${j}].targets[${k}].${semantic}`, accessor, listLen(json, 'accessors'))
        }
      }
    }
  }

  for (const [i, scene] of (json.scenes ?? []).entries()) {
    for (const node of scene?.nodes ?? []) bad(`scenes[${i}].nodes`, node, nodes.length)
  }

  for (const [i, animation] of (json.animations ?? []).entries()) {
    for (const [j, channel] of (animation?.channels ?? []).entries()) {
      const target = channel?.target?.node
      if (target === undefined) {
        out.push(`animations[${i}].channels[${j}]: channel has no target node`)
      } else {
        bad(`animations[${i}].channels[${j}].target.node`, target, nodes.length)
      }
    }
    for (const sampler of animation?.samplers ?? []) {
      bad(`animations[${i}].samplers.input`, sampler?.input, listLen(json, 'accessors'))
      bad(`animations[${i}].samplers.output`, sampler?.output, listLen(json, 'accessors'))
    }
  }

  for (const [i, view] of (json.bufferViews ?? []).entries()) {
    bad(`bufferViews[${i}].buffer`, view?.buffer, listLen(json, 'buffers'))
  }
  for (const [i, accessor] of (json.accessors ?? []).entries()) {
    bad(`accessors[${i}].bufferView`, accessor?.bufferView, listLen(json, 'bufferViews'))
  }
  for (const [i, image] of (json.images ?? []).entries()) {
    bad(`images[${i}].bufferView`, image?.bufferView, listLen(json, 'bufferViews'))
  }
  for (const [i, texture] of (json.textures ?? []).entries()) {
    bad(`textures[${i}].source`, texture?.source, listLen(json, 'images'))
  }
  for (const [i, skin] of (json.skins ?? []).entries()) {
    bad(`skins[${i}].inverseBindMatrices`, skin?.inverseBindMatrices, listLen(json, 'accessors'))
    for (const joint of skin?.joints ?? []) bad(`skins[${i}].joints`, joint, nodes.length)
  }
  for (const [i, material] of (json.materials ?? []).entries()) {
    const pbr = material?.pbrMetallicRoughness ?? {}
    bad(`materials[${i}].pbrMetallicRoughness.baseColorTexture.index`,
      pbr.baseColorTexture?.index, listLen(json, 'textures'))
    bad(`materials[${i}].normalTexture.index`, material?.normalTexture?.index, listLen(json, 'textures'))
    bad(`materials[${i}].emissiveTexture.index`, material?.emissiveTexture?.index, listLen(json, 'textures'))
    bad(`materials[${i}].occlusionTexture.index`, material?.occlusionTexture?.index, listLen(json, 'textures'))
    bad(`materials[${i}].pbrMetallicRoughness.metallicRoughnessTexture.index`,
      pbr.metallicRoughnessTexture?.index, listLen(json, 'textures'))
  }
}

/** Resource counts from the raw JSON, for a document glTF-Transform cannot read. */
function rawCounts(json) {
  const lights = (json.extensions?.KHR_lights_punctual?.lights ?? []).length
  let primitives = 0
  for (const mesh of json.meshes ?? []) primitives += (mesh.primitives ?? []).length
  return {
    nodes: (json.nodes ?? []).length,
    scenes: (json.scenes ?? []).length,
    meshes: (json.meshes ?? []).length,
    primitives,
    materials: (json.materials ?? []).length,
    textures: (json.textures ?? []).length,
    accessors: (json.accessors ?? []).length,
    buffers: (json.buffers ?? []).length,
    skins: (json.skins ?? []).length,
    cameras: (json.cameras ?? []).length,
    lights,
  }
}

/**
 * Detached ROOT nodes: unreachable from every scene, and not a child of any
 * node (a whole detached subtree reports its root once). K2 as narrowed keeps
 * them; the audit counts them so a later round can decide.
 */
function detachedRootNodes(json) {
  const nodes = Array.isArray(json.nodes) ? json.nodes : []
  const hasParent = new Set()
  for (const node of nodes) {
    for (const child of node?.children ?? []) hasParent.add(child)
  }
  const reachable = new Set()
  const visit = (index) => {
    if (typeof index !== 'number' || reachable.has(index) || !nodes[index]) return
    reachable.add(index)
    for (const child of nodes[index].children ?? []) visit(child)
  }
  for (const scene of json.scenes ?? []) {
    for (const node of scene?.nodes ?? []) visit(node)
  }

  const out = []
  for (const [i, node] of nodes.entries()) {
    if (reachable.has(i)) continue
    if (hasParent.has(i)) continue
    out.push({ index: i, name: node?.name ?? null })
  }
  return out
}

// ---------------------------------------------------------------------------

function printCounts(title, counts) {
  const lines = []
  for (const [key, value] of Object.entries(counts)) {
    if (value === 0) continue
    lines.push(`  ${key} ${value}`)
  }
  process.stdout.write(`${title}\n`)
  process.stdout.write(lines.length ? `${lines.join('\n')}\n` : '  (none)\n')
}

async function main() {
  const text = await readStdin()
  const json = parseExactlyOneDocument(text)

  // The dry run needs a real glTF-Transform Document. A document whose buffers
  // are not self-contained (an external .bin URI, or a malformed graph) cannot
  // be read here, so fall back to the raw-JSON counts and say so rather than
  // failing — the audit is a diagnostic, not a gate.
  const io = new NodeIO().registerExtensions([KHRLightsPunctual])
  let document = null
  let readError = null
  try {
    document = await io.readJSON({ json, resources: {} })
  } catch (err) {
    readError = err.message
  }

  const counts = document ? countDocumentResources(document.getRoot()) : rawCounts(json)
  const dryRun = document ? await pruneDocumentDryRun(document) : null

  const dangling = []
  checkDanglingReferences(json, dangling)
  const detached = detachedRootNodes(json)

  process.stdout.write('atrium document audit (read-only)\n\n')
  printCounts('resources:', counts)
  if (readError) {
    process.stdout.write(`  (raw JSON counts: glTF-Transform could not read this document — ${readError})\n`)
  }

  process.stdout.write('\nprune dry run (L1 whole-document, on a copy) would remove:\n')
  if (!dryRun) {
    process.stdout.write('  (unavailable: the document could not be read as glTF)\n')
  } else {
    const pruneLines = PRUNE_COUNT_KEYS
      .filter((key) => dryRun[key] > 0)
      .map((key) => `  ${key} ${dryRun[key]}`)
    process.stdout.write(pruneLines.length ? `${pruneLines.join('\n')}\n` : '  (nothing)\n')
  }

  process.stdout.write(`\ndetached root nodes: ${detached.length}\n`)
  for (const node of detached) {
    process.stdout.write(`  nodes[${node.index}]${node.name ? ` "${node.name}"` : ''}\n`)
  }

  process.stdout.write(`\ndangling references: ${dangling.length}\n`)
  for (const item of dangling) process.stdout.write(`  ${item}\n`)

  process.stdout.write('\n')
  process.exit(0)
}

main().catch((err) => fail(err?.stack ?? String(err)))
