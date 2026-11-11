// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * edit-press.js — a press on a move handle (selection-parts T17,
 * PREBRIEF-selection-parts.md §4; SP-L8 (a), SP-L11 (a)). Pure: no DOM, no
 * three.js. `app.js` feeds it the events and acts on its answers.
 *
 * The move handles cover a group's parts on screen (§2.2), so a press on a
 * handle is a CLICK until the pointer has travelled CLICK_SLOP_PX from where it
 * went down: until then every change the handles make is put back, nothing is
 * sent and nothing is recorded, and the release is handled as a click. A press
 * that is the second of a double-click (its mousedown `detail` 2 or more)
 * never becomes a drag, whatever it travels.
 *
 * The order the events arrive in (Chromium): a capture-phase `pointerdown` on
 * the viewport (`down`, before the handles see it), the handles' own
 * `pointerdown` (`grab`, through `dragging-changed`), `mousedown` (`count`:
 * `pointerdown` carries no click count), then pointer moves (`move`, from a
 * capture-phase `pointermove`, before the handles move the object), each
 * followed by the handles' change (`change`), and the release.
 */

import { CLICK_SLOP_PX } from './edit-selection.js'

/**
 * @param {{ slop?: number }} [opts]
 */
export function createHandlePress({ slop = CLICK_SLOP_PX } = {}) {
  /** @type {null | { x: number, y: number, slop: number, detail: number, grabbed: boolean, begun: boolean }} */
  let press = null
  /** the pointer's last position during the press */
  let at = null

  return {
    /**
     * A press on the viewport (capture-phase `pointerdown`): a new press.
     * `slop` overrides the default for this press (touch-nav, the third
     * review's S-9: a touch press gets the touch look slop, 10 px on screen,
     * as a thumb rolls more than the mouse's 4 px).
     */
    down({ x, y, slop: pressSlop }) {
      press = { x, y, slop: Number.isFinite(pressSlop) ? pressSlop : slop, detail: 1, grabbed: false, begun: false }
      at = { x, y }
    },
    /** The press grabbed a handle (`dragging-changed(true)`). */
    grab() {
      if (press) press.grabbed = true
    },
    /** The click count, from `mousedown`'s `detail`. */
    count(detail) {
      if (press && Number.isFinite(detail)) press.detail = detail
    },
    /** The pointer moved (capture-phase `pointermove`). */
    move({ x, y }) {
      if (press) at = { x, y }
    },
    /** Did the current press grab a handle? */
    grabbed() {
      return !!press?.grabbed
    },
    /**
     * The handles changed the object. `'put-back'`: set the object back to the
     * SOM node's values and do nothing else; `'begin'`: begin the gesture now
     * (then call `begin()`; if the app can't, it puts back and asks again on
     * the next change); `'drag'`: the gesture is under way.
     * With no press seen (no `down`), it begins at once, as before T17.
     * @returns {'put-back'|'begin'|'drag'}
     */
    change() {
      if (!press) return 'begin'
      if (press.begun) return 'drag'
      if (press.detail >= 2) return 'put-back'
      const travel = Math.hypot(at.x - press.x, at.y - press.y)
      return travel < press.slop ? 'put-back' : 'begin'
    },
    /** The app began the gesture. */
    begin() {
      if (press) press.begun = true
    },
    /**
     * The handles let go (`dragging-changed(false)`). `click` is true when no
     * gesture began: the `click` that follows selects (`forced` when it is a
     * double-click's second press, which counts as a click whatever it
     * travelled). The press is spent either way.
     * @returns {{ click: boolean, handle: boolean, forced?: true }}
     */
    release() {
      const p = press
      press = null
      at = null
      if (!p || !p.grabbed) return { click: false, handle: false }
      if (p.begun) return { click: false, handle: true }
      return p.detail >= 2 ? { click: true, handle: true, forced: true } : { click: true, handle: true }
    },
    /**
     * The press is abandoned (T18: the selection changes mid-press, a
     * removal, the session end): its release is no click.
     */
    reset() {
      press = null
      at = null
    },
  }
}
