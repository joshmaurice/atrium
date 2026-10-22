// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { center } from '@gltf-transform/functions'
import { CAPS } from './net.mjs'
import { ItemRefused } from './polyhaven.mjs'
import { sha256Hex } from './catalog.mjs'
import { loadAtriumChecks } from './atrium-checks.mjs'

/** No library item may take more than an eighth of a world's 512 MiB texture budget. */
export const LIBRARY_TEXTURE_LIMIT = 64 * 1024 * 1024

/**
 * Every external file a `.gltf` names, each of which must be exactly one of
 * the API's include keys (H1 step 2). Returns `Map<uri, key>`; throws
 * ItemRefused for anything else (another path, `data:`, a URL, a buffer with
 * no uri).
 *
 * Nothing is ever read from or written to disk: the bytes are handed to
 * glTF-Transform as an in-memory resource map, so no name in the JSON or the
 * include map can reach the file system.
 */
export function referencedIncludes(json, include) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new ItemRefused('the .gltf is not a JSON object')
  for (const key of ['buffers', 'images', 'extensionsRequired', 'extensionsUsed']) {
    if (json[key] !== undefined && !Array.isArray(json[key])) throw new ItemRefused(`the .gltf's ${key} is not a list`)
  }
  const out = new Map()
  const take = (uri, what) => {
    if (typeof uri !== 'string') throw new ItemRefused(`${what} has no file name`)
    if (!Object.hasOwn(include, uri)) throw new ItemRefused(`${what} names ${JSON.stringify(uri.slice(0, 200))}, which is not one of its listed files`)
    out.set(uri, uri)
  }
  for (const [i, buffer] of (json.buffers ?? []).entries()) take(buffer?.uri, `buffer ${i}`)
  for (const [i, image] of (json.images ?? []).entries()) {
    if (image?.uri === undefined && image?.bufferView !== undefined) continue
    take(image?.uri, `image ${i}`)
  }
  return out
}

/**
 * Build one library model: download, convert to a self-contained `.glb`,
 * re-pivot to its base centre, and hold it to the browser's rules.
 *
 * @param {object} args
 * @param {string} args.id
 * @param {{gltf: object, include: object}} args.files   from readModelFiles
 * @param {object} args.fetcher
 * @param {object} [args.limits]  test overrides: { parse, modelBytes, textureBytes }
 */
export async function buildModel({ id, files, fetcher, limits = {} }) {
  const checks = await loadAtriumChecks()
  const parseLimits = limits.parse ?? checks.MODEL_PARSE_LIMITS
  const modelBytesLimit = limits.modelBytes ?? checks.MODEL_LIMITS.modelBytes
  const textureLimit = limits.textureBytes ?? LIBRARY_TEXTURE_LIMIT

  // 1–2. the .gltf, then only the files it names, each checked against its claim
  const gltfBytes = await fetcher.get(files.gltf.url, { cap: CAPS.gltf, size: files.gltf.size, md5: files.gltf.md5 })
  let json
  try { json = JSON.parse(gltfBytes.toString('utf8')) } catch { throw new ItemRefused('the .gltf is not JSON') }
  const uris = referencedIncludes(json, files.include)

  // 3. compressed or required extensions (L7)
  if ((json.extensionsRequired ?? []).length > 0) throw new ItemRefused(`requires extensions: ${json.extensionsRequired.join(', ')}`)
  const unsupported = checks.unsupportedExtension(json)
  if (unsupported) throw new ItemRefused(`uses ${unsupported}`)

  // Include keys can't be `__proto__`, `constructor` or `prototype` (keys.mjs).
  const resources = Object.create(null)
  let total = gltfBytes.length
  for (const uri of uris.keys()) {
    const inc = files.include[uri]
    const bytes = await fetcher.get(inc.url, { cap: CAPS.include, size: inc.size, md5: inc.md5 })
    total += bytes.length
    if (total > CAPS.modelTotal) throw new ItemRefused(`downloads more than ${CAPS.modelTotal} bytes`)
    resources[uri] = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  let doc
  try {
    doc = await io.readJSON({ json, resources })
  } catch (err) {
    throw new ItemRefused(`glTF-Transform could not read it: ${err.message}`)
  }

  // 4. re-pivot: origin at the centre of the base
  await doc.transform(center({ pivot: 'below' }))

  // 5. one self-contained .glb
  const glb = await io.writeBinary(doc)

  // 6. the browser's own checks on what visitors will actually download
  const parsed = checks.readGlb(glb)
  if (!parsed) throw new ItemRefused('the converted .glb is unreadable')
  const dep = checks.glbDependencyProblem(parsed.json)
  if (dep) throw new ItemRefused(`3a refuses it: ${dep.message}`)
  const glbUnsupported = checks.unsupportedExtension(parsed.json)
  if (glbUnsupported) throw new ItemRefused(`uses ${glbUnsupported}`)
  const pre = checks.preflightProblem(parsed.json, checks.glbImages(parsed.json, parsed.bin), parseLimits)
  if (pre?.reason) throw new ItemRefused(`3a refuses it: ${pre.message}`)
  if (glb.byteLength > modelBytesLimit) throw new ItemRefused(`the .glb is ${glb.byteLength} bytes, over ${modelBytesLimit}`)
  const textureBytes = pre?.textureBytes ?? 0
  if (textureBytes > textureLimit) throw new ItemRefused(`its textures need ${textureBytes} bytes, over the library's ${textureLimit}`)

  // 7. measurements
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  if (!scene) throw new ItemRefused('no scene')
  const { min, max } = getBounds(scene)
  const size = [0, 1, 2].map((i) => max[i] - min[i])
  if (!size.every((n) => Number.isFinite(n))) throw new ItemRefused('no geometry to measure')
  const tolerance = 1e-4 * Math.max(...size) + 1e-6
  const cx = (min[0] + max[0]) / 2
  const cz = (min[2] + max[2]) / 2
  if (Math.abs(min[1]) > tolerance || Math.abs(cx) > tolerance || Math.abs(cz) > tolerance) {
    throw new ItemRefused('the re-pivot did not put the base centre at the origin')
  }
  const bounds = size.map((n) => Math.min(checks.BOUNDS_MAX, Math.max(checks.BOUNDS_MIN, Math.round(n * 10000) / 10000)))
  if (checks.modelBoundsProblem(bounds)) throw new ItemRefused('bounds out of range')

  return {
    glb: Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength),
    sha256: sha256Hex(glb),
    bounds,
    bytes: glb.byteLength,
    vertices: checks.positionVertexTotal(parsed.json),
    textureBytes,
    downloaded: total,
  }
}
