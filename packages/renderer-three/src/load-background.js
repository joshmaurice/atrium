// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'

/**
 * Load an equirectangular background texture into a Three.js scene.
 *
 * @param {THREE.Scene} threeScene
 * @param {{ type?: string, texture?: string } | null | undefined} bg
 * @param {string} baseUrl  Base URL for resolving relative texture paths.
 */
export function loadBackground(threeScene, bg, baseUrl) {
  if (!bg?.texture) {
    threeScene.background  = null
    threeScene.environment = null
    return
  }
  if (bg.type && bg.type !== 'equirectangular') {
    console.warn('Unsupported background type:', bg.type)
    return
  }
  // Token/optional base URL hardening: if baseUrl is null or empty, resolve
  // the texture relative to the page location instead of crashing (pre-brief).
  // This handles the case where a world is loaded from drag-and-drop (no url).
  if (!baseUrl) {
    baseUrl = globalThis.location?.href || ''
  }
  let textureUrl
  try {
    textureUrl = new URL(bg.texture, baseUrl).href
  } catch {
    console.warn('Failed to resolve background texture URL:', bg.texture, 'with base:', baseUrl)
    return
  }
  const loader = new THREE.TextureLoader()
  loader.load(
    textureUrl,
    (texture) => {
      texture.mapping    = THREE.EquirectangularReflectionMapping
      texture.colorSpace = THREE.SRGBColorSpace
      threeScene.background  = texture
      threeScene.environment = texture
    },
    undefined,
    (err) => console.warn('Failed to load background texture:', textureUrl, err),
  )
}
