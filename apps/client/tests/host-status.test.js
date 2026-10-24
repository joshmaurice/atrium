// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// host-status.test.js — scripting-4b-1 E8. The pure text function behind the
// Edit panel's host line. The role is the ROLE, never a behaviour: 4b-1 runs no
// behaviours. The four cases are the four the contract names.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostStatusText, HOST_THIS_TAB, HOST_OTHER_TAB } from '../src/host-status.js'

test('E8: the host sees "Script host: this tab"', () => {
  assert.equal(
    hostStatusText({ connected: true, canEdit: true, scriptHost: { active: true, hostGen: 2 } }),
    HOST_THIS_TAB)
})

test('E8: a non-host owner sees "Script host: another tab or device"', () => {
  assert.equal(
    hostStatusText({ connected: true, canEdit: true, scriptHost: { active: false, hostGen: null } }),
    HOST_OTHER_TAB)
})

test('E8: a non-host owner at the moment there is no host at all still sees the other-tab text', () => {
  // active false with a hostGen is the dead-predecessor case (N6): the server
  // still holds the old session until the keepalive sweep drops it.
  assert.equal(
    hostStatusText({ connected: true, canEdit: true, scriptHost: { active: false, hostGen: 4 } }),
    HOST_OTHER_TAB)
})

test('E8: a visitor sees nothing', () => {
  assert.equal(hostStatusText({ connected: true, canEdit: false, scriptHost: { active: false, hostGen: null } }), '')
  assert.equal(hostStatusText({ connected: true, canEdit: false, scriptHost: { active: true, hostGen: 1 } }), '')
})

test('E8: a disconnected tab sees nothing', () => {
  assert.equal(hostStatusText({ connected: false, canEdit: true, scriptHost: { active: true, hostGen: 1 } }), '')
  assert.equal(hostStatusText({ connected: false, canEdit: false, scriptHost: null }), '')
})

test('E8: a missing or malformed argument set sees nothing', () => {
  assert.equal(hostStatusText(), '')
  assert.equal(hostStatusText({}), '')
  assert.equal(hostStatusText({ connected: true }), '')
  assert.equal(hostStatusText({ connected: true, canEdit: true, scriptHost: null }), HOST_OTHER_TAB,
    'an owner with no role object is not the host')
})
