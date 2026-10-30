// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * activate-click.js — scripting-4c AC6: the pure parts of a click outside Edit
 * mode, and the transient notice.
 *
 * `app.js` is a page script no test can import, so everything that can be a pure
 * function is one, here, and `app.js` is wiring only (its own wiring guard, in
 * `apps/client/tests/`, reads it as text — the convention app-wiring.test.js and
 * library-grid.test.js already use).
 *
 *   - `behaviorAim` — the NDC a click aims at. While `#viewport` holds the
 *     pointer lock, a click's `target` is the viewport and `clientX/Y` are stuck
 *     where the lock began (4b-2 p3, P17), so a locked click aims from the SCREEN
 *     CENTRE, where `#crosshair` is.
 *   - `activateNoticeText` — the notice for a refusal, by WHO decided it (AC-L6,
 *     Rev 1 N1): the page can tell "no avatar" from "too far"; the server's
 *     PERMISSION_DENIED covers both and gets a neutral text.
 *   - `activateClickNotice` — the page's own pre-check (AC-L6): what it can see
 *     for itself, so a doomed click never reaches the wire.
 *   - `createActivateNotice` — the 3 s transient notice, one at a time.
 */

import { selectTargetFor, withinActivateDistance } from '@atrium/behaviors/behavior-spec'

// ---------------------------------------------------------------------------
// Aiming
// ---------------------------------------------------------------------------

/**
 * The NDC a click aims at: the cursor's, or the screen centre while the viewport
 * holds the pointer lock.
 *
 * @param {{locked?: boolean, clientX?: number, clientY?: number, rect: {left: number, top: number, width: number, height: number}}} input
 * @returns {{x: number, y: number}}
 */
export function behaviorAim({ locked = false, clientX = 0, clientY = 0, rect } = {}) {
  // P17 — with the lock held, `clientX/Y` are the point the lock STARTED at and
  // the event's target is `#viewport`. The crosshair is the true aim.
  if (locked) return { x: 0, y: 0 }
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  }
}

// ---------------------------------------------------------------------------
// The notices (AC-L6, character for character)
// ---------------------------------------------------------------------------

/** The page's own texts: it can tell these two apart. */
export const ACTIVATE_PAGE_NOTICE = Object.freeze({
  'no-avatar': "You can't use this until your avatar has joined.",
  'too-far': 'Move closer to use this.',
})

/** The server's: one code for "no avatar or too far", one for "nobody home". */
export const ACTIVATE_SERVER_NOTICE = Object.freeze({
  PERMISSION_DENIED: "You can't reach this from where you are.",
  NO_SCRIPT_HOST: "Nothing happens: this world's owner isn't here right now.",
})

/**
 * The notice a refusal shows, or '' when it shows none.
 *
 * `RATE_LIMITED`, `NODE_NOT_FOUND` and `INVALID_FIELD` go to the console only
 * (AC-L6): the clicker cannot act on any of them.
 *
 * @param {{by?: 'page'|'server', code?: string, reason?: string}} input
 * @returns {string} the notice text, or '' for none
 */
export function activateNoticeText({ by, code, reason } = {}) {
  if (by === 'page') return ACTIVATE_PAGE_NOTICE[reason] ?? ''
  if (by === 'server') return ACTIVATE_SERVER_NOTICE[code] ?? ''
  return ''
}

// ---------------------------------------------------------------------------
// The click's decision (outside Edit mode)
// ---------------------------------------------------------------------------

/**
 * The page's own pre-check, before anything is sent: no local avatar, or too far
 * (AC-L6).
 *
 * The distance it measures is NOT a security boundary — the position is this
 * client's own claim (4b-2 P8), and the server measures its own. The two can
 * disagree at the 10 m boundary, because the server measures the last `view` it
 * received; the page then shows the server's notice. That is expected.
 *
 * @param {{avatarNode?: object|null, avatarPosition?: number[], targetPosition?: number[]}} input
 * @returns {string} the notice text, or '' when the click may be sent
 */
export function activateClickNotice({ avatarNode = null, avatarPosition, targetPosition } = {}) {
  if (!avatarNode) return activateNoticeText({ by: 'page', reason: 'no-avatar' })
  if (!withinActivateDistance(avatarPosition, targetPosition)) {
    return activateNoticeText({ by: 'page', reason: 'too-far' })
  }
  return ''
}

/**
 * The node a click on `hitNode` acts on, or null.
 *
 * ONE rule for every tab (AC2): the host's local click, a non-host owner's and a
 * visitor's all resolve the same way. A hit that resolves to nothing is an
 * ordinary click on scenery: nothing happens, and nothing is shown.
 *
 * @param {object|null} hitNode
 * @returns {object|null}
 */
export function activateClickTarget(hitNode) {
  return selectTargetFor(hitNode)
}

/**
 * scripting-4c AC6 — RUN the click, outside Edit mode, for whichever kind of tab
 * this is. `app.js` is wiring: it does the event checks, asks `behaviorAim` where
 * the click aimed, resolves the hit, and hands the answer here.
 *
 *   - this tab IS the host → run the behaviour HERE (`runner.select`), and show
 *     the page's own notice on `'too-far'` / `'no-avatar'` (AC-L3 (a));
 *   - every other tab → the page's own pre-check first (nothing is sent when it
 *     refuses), then `client.activate(target.name)`.
 *
 * @param {object} input
 * @param {object|null} input.hit             the SOM node under the cursor
 * @param {object|null} input.target          `activateClickTarget(hit)`
 * @param {boolean} input.isHost              this tab holds the role
 * @param {object|null} [input.runner]        the behaviour runner
 * @param {object|null} [input.client]        the AtriumClient
 * @param {object|null} [input.avatarNode]    the local avatar's SOM node
 * @param {number[]} [input.avatarPosition]
 * @param {number[]} [input.targetPosition]
 * @param {{show: Function}} [input.notice]
 * @returns {{action: 'none'|'select'|'notice'|'activate', outcome?: string, notice?: string, node?: string}}
 */
export function performActivateClick({
  hit = null,
  target = null,
  isHost = false,
  runner = null,
  client = null,
  avatarNode = null,
  avatarPosition,
  targetPosition,
  notice = null,
} = {}) {
  const resolved = target ?? activateClickTarget(hit)
  if (!resolved) return { action: 'none' }

  if (isHost) {
    const outcome = runner?.select(hit)
    if (outcome === 'too-far' || outcome === 'no-avatar') {
      notice?.show(activateNoticeText({ by: 'page', reason: outcome }))
    }
    return { action: 'select', outcome }
  }

  const text = activateClickNotice({ avatarNode, avatarPosition, targetPosition })
  if (text) {
    notice?.show(text)
    return { action: 'notice', notice: text }
  }
  client?.activate(resolved.name)
  return { action: 'activate', node: resolved.name }
}

// ---------------------------------------------------------------------------
// The notice element
// ---------------------------------------------------------------------------

/** AC-L6 — a notice lives 3 seconds. */
export const ACTIVATE_NOTICE_MS = 3000

/**
 * The page's transient notice, ONE at a time: a new one replaces the current,
 * and the element clears after `lifeMs`.
 *
 * @param {{element?: object|null, lifeMs?: number, setTimer?: Function, clearTimer?: Function}} input
 */
export function createActivateNotice({
  element = null,
  lifeMs = ACTIVATE_NOTICE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let timer = null

  const hide = () => {
    if (!element) return
    element.textContent = ''
    element.style.display = 'none'
  }

  return {
    /**
     * Show `text`. An empty text clears the element and shows nothing.
     * @param {string} text
     */
    show(text) {
      if (!element) return
      if (!text) { hide(); return }
      if (timer !== null) { clearTimer(timer); timer = null }
      element.textContent = text
      element.style.display = ''
      timer = setTimer(() => { timer = null; hide() }, lifeMs)
    },
    /** Clear it now (a world change, a disconnect). */
    clear() {
      if (timer !== null) { clearTimer(timer); timer = null }
      hide()
    },
  }
}
