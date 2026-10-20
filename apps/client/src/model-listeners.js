// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * model-listeners.js — the diagnostic pointer listeners, registered once per
 * SOM node (A11).
 *
 * `world:loaded` fires again on the SAME SOM when an external reference loads
 * (`resolveExternalReferences` re-emits it), so adding the five listeners in
 * that handler piles up duplicates on every repeat. A `WeakSet` of the nodes
 * already wired is all it takes: the node objects themselves are the key, so
 * nothing has to be cleaned up when a world goes away.
 */

/** The five diagnostics, in the order the handler has always added them. */
export const DIAGNOSTIC_EVENTS = Object.freeze(['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'click'])

const LABEL = {
  pointerover: 'over', pointerout: 'out', pointerdown: 'down', pointerup: 'up', click: 'click',
}

/**
 * @param {object} [deps]
 * @param {(...args: any[]) => void} [deps.log]  `console.log` in the page
 * @returns {{register: (node: object) => boolean, registerAll: (som: object) => number, seen: (node: object) => boolean}}
 */
export function createDiagnosticListeners({ log = console.log } = {}) {
  const seen = new WeakSet()

  function register(node) {
    if (!node || typeof node.addEventListener !== 'function') return false
    if (seen.has(node)) return false
    seen.add(node)
    node.addEventListener('pointerover', () => log('[pointer] over', node.name))
    node.addEventListener('pointerout', () => log('[pointer] out', node.name))
    node.addEventListener('pointerdown', (e) => log('[pointer] down', node.name, 'button', e.detail.button))
    node.addEventListener('pointerup', () => log('[pointer] up', node.name))
    node.addEventListener('click', (e) => log('[pointer] click', node.name, 'at', e.detail.point))
    return true
  }

  /** Every non-ephemeral node of a SOM; returns how many were newly wired. */
  function registerAll(som) {
    let added = 0
    for (const node of som?.nodes ?? []) {
      if (node.extras?.atrium?.ephemeral) continue   // skip avatars
      if (register(node)) added += 1
    }
    return added
  }

  return { register, registerAll, seen: (node) => seen.has(node) }
}
