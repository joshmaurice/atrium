// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

/**
 * host-status.js — E8 (scripting-4b-1, E-L6). Pure: no DOM, no three.js.
 *
 * The Edit panel's host line, as one function of three facts. It names the
 * ROLE, never behaviours (nothing runs in 4b-1): "Script host: this tab" or
 * "Script host: another tab or device".
 *
 * A non-host owner gets the second text even at the moment there is NO host at
 * all (another owner session has just left and the handover is under way), and
 * even for a DEAD PREDECESSOR (review N6): an owner whose only tab reconnects
 * while the server still holds its old session sees it until the keepalive sweep
 * drops the old session, then it changes to "this tab" through the handover. A
 * more exact text ("your other tab") would need to know another host exists, and
 * 4b-1 does not tell non-hosts who the host is.
 */

export const HOST_THIS_TAB = 'Script host: this tab (behaviours run here)'
export const HOST_OTHER_TAB = 'Script host: another tab or device'

/**
 * The line's text, or '' for nothing at all.
 *
 * @param {object} args
 * @param {boolean} args.connected     `client.connected`
 * @param {boolean} args.canEdit       `client.canEdit` — the panel is the owner's
 * @param {{active?: boolean}|null} args.scriptHost  `client.scriptHost`
 * @returns {string}
 */
export function hostStatusText({ connected, canEdit, scriptHost } = {}) {
  // A visitor never sees the line: the panel is the owner's. Nor does a
  // disconnected tab — there is no role then.
  if (connected !== true || canEdit !== true) return ''
  return scriptHost?.active === true ? HOST_THIS_TAB : HOST_OTHER_TAB
}
