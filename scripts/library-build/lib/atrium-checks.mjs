// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * H1 step 6 — the browser loader's own checks, imported from the repo so a
 * library item is held to exactly the rules every visitor applies (3a, A3, A5,
 * L7). `model-parse.js` imports three, so the clone's renderer-three must be
 * installed first (H2: `pnpm install --frozen-lockfile --filter
 * @atrium/renderer-three`).
 */

const REPO = new URL('../../../', import.meta.url)

let loaded = null

export async function loadAtriumChecks() {
  if (loaded) return loaded
  let parse, fetchMod, spec
  try {
    parse = await import(new URL('packages/renderer-three/src/model-parse.js', REPO).href)
    fetchMod = await import(new URL('packages/client/src/model-fetch.js', REPO).href)
    spec = await import(new URL('packages/client/src/model-spec.js', REPO).href)
  } catch (err) {
    throw new Error(
      `cannot load Atrium's model checks from this clone (${err.message}). ` +
      'Run `pnpm install --frozen-lockfile --filter @atrium/renderer-three` at the repo root first.')
  }
  loaded = {
    readGlb: parse.readGlb,
    glbDependencyProblem: parse.glbDependencyProblem,
    glbImages: parse.glbImages,
    preflightProblem: parse.preflightProblem,
    positionVertexTotal: parse.positionVertexTotal,
    MODEL_PARSE_LIMITS: parse.MODEL_PARSE_LIMITS,
    unsupportedExtension: fetchMod.unsupportedExtension,
    MODEL_LIMITS: fetchMod.MODEL_LIMITS,
    modelBoundsProblem: spec.modelBoundsProblem,
    BOUNDS_MIN: spec.BOUNDS_MIN,
    BOUNDS_MAX: spec.BOUNDS_MAX,
  }
  return loaded
}
