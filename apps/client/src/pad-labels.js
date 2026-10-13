// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * pad-labels.js — keep the teleporter pad labels in step with the pads.
 *
 * rebuildPads() used to remove the old pad labels by name prefix
 * ('teleporter-'), then add a label per pad. Since Phase 3 step 1a a pad can be
 * renamed to anything, so a renamed pad's label no longer matched the prefix:
 * it was never removed, and the next rebuild added a second label under the
 * same key. LabelOverlay.addLabel overwrote the map entry, so the first label's
 * element was orphaned — untracked, frozen at its last screen position, and
 * surviving even LabelOverlay.clear() until a page reload.
 *
 * This helper removes exactly the labels it added last time, whatever the pads
 * are called, and never adds a key without removing it first.
 *
 * @param {{ addLabel: Function, removeLabel: Function }} labels  a LabelOverlay
 * @param {Iterable<string>} previousNames  the pad label keys returned by the
 *   previous call (an empty Set after a world teardown)
 * @param {Array<{ name: string }>} pads  the current pads
 * @param {(pad: object) => { text: string, target: object, options?: object }} describe
 *   builds one pad's label
 * @returns {Set<string>} the pad label keys now on screen; pass it back next time
 */
export function syncPadLabels(labels, previousNames, pads, describe) {
  for (const name of previousNames) labels.removeLabel(name)

  const current = new Set()
  for (const pad of pads) {
    const { text, target, options } = describe(pad)
    labels.removeLabel(pad.name)
    labels.addLabel(pad.name, text, target, options)
    current.add(pad.name)
  }
  return current
}
