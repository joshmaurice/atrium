// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'

/**
 * Load an equirectangular background texture into a Three.js scene.
 *
 * Each call records a per-scene request token so a slow texture from a previous
 * world cannot overwrite a newer world's background (pre-brief #12).
 *
 * @param {THREE.Scene} threeScene
 * @param {{ type?: string, texture?: string } | null | undefined} bg
 * @param {string|null} [baseUrl]  Base URL for resolving relative texture paths.
 *   Optional: absolute textures work without a base; missing base for relative
 *   textures logs a warning and returns without throwing (pre-brief #12).
 */
export function loadBackground(threeScene, bg, baseUrl) {
  if (!bg?.texture) {
    threeScene.background  = null
    threeScene.environment = null
    // Bump token so any in-flight texture from before the clear is ignored
    threeScene.userData.__bgToken = (threeScene.userData.__bgToken || 0) + 1
    return
  }
  if (bg.type && bg.type !== 'equirectangular') {
    console.warn('Unsupported background type:', bg.type)
    return
  }

  // Base URL is optional: an absolute texture works without it
  // (pre-brief #12). A relative texture with no base logs a warning.
  if (!baseUrl) {
    // Try the page location as fallback (pre-brief hardening)
    baseUrl = globalThis.location?.href || ''
  }

  let textureUrl
  try {
    textureUrl = new URL(bg.texture, baseUrl).href
  } catch {
    console.warn('Failed to resolve background texture URL:', bg.texture, 'with base:', baseUrl)
    return
  }

  // Record per-scene token — only the latest request applies its texture
  const token = (threeScene.userData.__bgToken || 0) + 1
  threeScene.userData.__bgToken = token

  const loader = new THREE.TextureLoader()
  loader.load(
    textureUrl,
    (texture) => {
      // Check token: if a newer request (or clear) has bumped it, skip
      if (threeScene.userData.__bgToken !== token) return
      texture.mapping    = THREE.EquirectangularReflectionMapping
      texture.colorSpace = THREE.SRGBColorSpace
      threeScene.background  = texture
      threeScene.environment = texture
    },
    undefined,
    (err) => console.warn('Failed to load background texture:', textureUrl, err),
  )
}