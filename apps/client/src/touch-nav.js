// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * touch-nav.js — the touch gestures that walk and look (touch-nav T2).
 *
 * Pure: no DOM. The page feeds it the pointer events of `pointerType` `touch`
 * and applies the effects it returns:
 *   { type: 'move',  x, z }     the stick's vector for NavigationController.setMoveInput
 *   { type: 'knob',  dx, dy }   the stick knob's offset in CSS px, for the display
 *   { type: 'look',  dx, dy }   a look-drag delta for NavigationController.onTouchLook
 *   { type: 'pinch', ratio }    the fingers' distance over their last, for onPinch
 *   { type: 'swallow-click' }   a view finger that looked or pinched lifted: the
 *                               browser may still send a click for a short drag
 *                               (Chrome's tap slop is wider than ours), and that
 *                               click must not select or activate
 *
 * A press is classified by the page (`on`):
 *   'stick'  — on the on-screen stick (one pointer owns it)
 *   'view'   — on the canvas (the first looks, a second makes a pinch)
 *   'handle' — on the canvas, but TransformControls took it (B3): never tracked
 *   'other'  — panels, buttons: never tracked
 * `primary` is the event's `isPrimary`: a primary touch means no other finger
 * is down, so whatever is still tracked lost its release and is dropped.
 *
 * A 'view' press sends nothing until it has travelled `slop` px, so a tap stays
 * a tap and the browser's click (select, Inspect, activate) follows as today.
 */

import { CLICK_SLOP_PX } from './edit-selection.js'

export const STICK_RADIUS_PX = 48
export const STICK_DEAD_ZONE = 0.12

export function createTouchNav({ slop = CLICK_SLOP_PX, stickRadius = STICK_RADIUS_PX, deadZone = STICK_DEAD_ZONE } = {}) {
  /** @type {{ id: number, cx: number, cy: number } | null} */
  let stick = null
  /** The 'view' pointers, in press order (at most two). */
  /** @type {{ id: number, x0: number, y0: number, x: number, y: number, live: boolean }[]} */
  let views = []
  /** The fingers' last distance while two are down. */
  let pinchDist = 0

  const dist = () => Math.hypot(views[0].x - views[1].x, views[0].y - views[1].y)

  function stickEffects(x, y) {
    let dx = x - stick.cx
    let dy = y - stick.cy
    const len = Math.hypot(dx, dy)
    if (len > stickRadius) { dx *= stickRadius / len; dy *= stickRadius / len }
    const m = Math.min(len, stickRadius) / stickRadius
    let vx = 0, vz = 0
    if (m > deadZone) {
      const scale = (m - deadZone) / (1 - deadZone) / m
      vx = (dx / stickRadius) * scale
      vz = (dy / stickRadius) * scale
    }
    return [{ type: 'move', x: vx, z: vz }, { type: 'knob', dx, dy }]
  }

  function releaseStick() {
    stick = null
    return [{ type: 'move', x: 0, z: 0 }, { type: 'knob', dx: 0, dy: 0 }]
  }

  return {
    down({ id, x, y, on, stickCentre, primary = false }) {
      // A primary touch means no other finger is down: anything still tracked
      // lost its release (the fresh check's note). Drop it, stopping the stick.
      const stale = primary && (stick || views.length) ? this.reset() : []
      return stale.concat(this._down({ id, x, y, on, stickCentre }))
    },

    _down({ id, x, y, on, stickCentre }) {
      if (on === 'stick') {
        if (stick || !stickCentre) return []
        stick = { id, cx: stickCentre.x, cy: stickCentre.y }
        return stickEffects(x, y)
      }
      if (on !== 'view') return []
      if (views.length >= 2) return []
      views.push({ id, x0: x, y0: y, x, y, live: false, used: false })
      if (views.length === 2) { pinchDist = dist(); for (const p of views) p.used = true }
      return []
    },

    move({ id, x, y }) {
      if (stick && stick.id === id) return stickEffects(x, y)
      const v = views.find(p => p.id === id)
      if (!v) return []
      const px = v.x, py = v.y
      v.x = x; v.y = y
      if (views.length === 2) {
        const d = dist()
        const ratio = pinchDist > 0 && d > 0 ? d / pinchDist : 1
        pinchDist = d
        return ratio === 1 ? [] : [{ type: 'pinch', ratio }]
      }
      if (!v.live) {
        if (Math.hypot(x - v.x0, y - v.y0) < slop) return []
        v.live = true
        v.used = true
        return [{ type: 'look', dx: x - v.x0, dy: y - v.y0 }]
      }
      return [{ type: 'look', dx: x - px, dy: y - py }]
    },

    /** A release or a `pointercancel`. */
    up({ id }) {
      if (stick && stick.id === id) return releaseStick()
      const i = views.findIndex(p => p.id === id)
      if (i < 0) return []
      const [gone] = views.splice(i, 1)
      // The finger left after a pinch goes on looking from where it is: no jump.
      if (views.length === 1) {
        const v = views[0]
        v.live = true
        v.x0 = v.x; v.y0 = v.y
      }
      pinchDist = 0
      return gone.used ? [{ type: 'swallow-click' }] : []
    },

    /** The stick is hidden: let it go, leave the view's fingers alone. */
    releaseStick() { return stick ? releaseStick() : [] },

    /** Mode change, disconnect, blur, page hidden: drop every gesture. */
    reset() {
      views = []
      pinchDist = 0
      return stick ? releaseStick() : []
    },

    /** For tests and the page: is anything held? */
    get active() { return !!stick || views.length > 0 },
  }
}
