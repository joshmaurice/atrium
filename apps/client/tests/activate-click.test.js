// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// activate-click.test.js — scripting-4c AC6: the app's click.
//
// Two parts:
//   1. the PURE functions of `src/activate-click.js` (the aim, the notice texts,
//      the page's pre-check, and the 3 s notice element) — driven with the
//      strict DOM fake (`strict-element.mjs`, V12: `dataset`, `style` and
//      `classList` are getter-only, so assigning one throws in strict mode);
//   2. the CLICK BRANCH for the three kinds of tab, through the REAL
//      `createBehaviorRunner` and the REAL `client.activate`, with ONLY the
//      socket faked (signin-sync §4.1).
//
// `app.js` is a page script no test can import, so its branch is pinned by
// `app-wiring.test.js` (text), which asserts the calls and their ORDER. The
// sequence below is the same sequence, made of the same production functions:
// `activateClickTarget`, `activateClickNotice`, `runner.select`,
// `client.activate`, `activateNoticeText`.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { AtriumClient } from '@atrium/client'
import { createBehaviorRunner } from '@atrium/behaviors/runner'
import { templateGraph } from '@atrium/behaviors/templates'
import { withinActivateDistance } from '@atrium/behaviors/behavior-spec'

import {
  behaviorAim, activateNoticeText, activateClickNotice, activateClickTarget,
  performActivateClick, createActivateNotice, ACTIVATE_NOTICE_MS,
  ACTIVATE_PAGE_NOTICE, ACTIVATE_SERVER_NOTICE,
} from '../src/activate-click.js'
import { worldPosition } from '../src/world-position.js'
import { el } from './strict-element.mjs'

const OWN = '11111111-1111-4111-8111-111111111111'
const TGT = '22222222-2222-4222-8222-222222222222'
const hide = (ownId) => templateGraph('select-visibility', { target: TGT, action: 'hide' }, { ownId })

// ===========================================================================
// 1. the pure functions
// ===========================================================================

describe('AC6 — behaviorAim', () => {
  const rect = { left: 0, top: 0, width: 800, height: 600 }

  test('unlocked: the NDC under the cursor', () => {
    assert.deepEqual(behaviorAim({ locked: false, clientX: 400, clientY: 300, rect }), { x: 0, y: 0 })
    assert.deepEqual(behaviorAim({ locked: false, clientX: 0, clientY: 0, rect }), { x: -1, y: 1 })
    assert.deepEqual(behaviorAim({ locked: false, clientX: 800, clientY: 600, rect }), { x: 1, y: -1 })
    assert.deepEqual(behaviorAim({ locked: false, clientX: 600, clientY: 150, rect }), { x: 0.5, y: 0.5 })
  })

  test('locked: the SCREEN CENTRE, whatever clientX/Y say (P17, proof (i))', () => {
    // A locked click reports the point the lock STARTED at — (100, 80) in 4b-2's
    // probe — while the crosshair is at the centre.
    assert.deepEqual(behaviorAim({ locked: true, clientX: 100, clientY: 80, rect }), { x: 0, y: 0 })
    assert.deepEqual(behaviorAim({ locked: true, clientX: 700, clientY: 500, rect }), { x: 0, y: 0 })
    assert.deepEqual(behaviorAim({ locked: true, clientX: -999, clientY: NaN, rect }), { x: 0, y: 0 })
  })

  test('the rect is honoured (a viewport that is not at the origin)', () => {
    const offset = { left: 100, top: 50, width: 400, height: 300 }
    assert.deepEqual(behaviorAim({ locked: false, clientX: 300, clientY: 200, rect: offset }), { x: 0, y: 0 })
  })
})

describe('AC6 — activateNoticeText (AC-L6, character for character)', () => {
  test('the page can tell “no avatar” from “too far”', () => {
    assert.equal(activateNoticeText({ by: 'page', reason: 'no-avatar' }), "You can't use this until your avatar has joined.")
    assert.equal(activateNoticeText({ by: 'page', reason: 'too-far' }), 'Move closer to use this.')
    assert.notEqual(ACTIVATE_PAGE_NOTICE['no-avatar'], ACTIVATE_PAGE_NOTICE['too-far'], 'the two differ (Rev 1 N1)')
  })

  test('the server’s PERMISSION_DENIED has the NEUTRAL text', () => {
    assert.equal(activateNoticeText({ by: 'server', code: 'PERMISSION_DENIED' }), "You can't reach this from where you are.")
    assert.notEqual(ACTIVATE_SERVER_NOTICE.PERMISSION_DENIED, ACTIVATE_PAGE_NOTICE['too-far'])
  })

  test('NO_SCRIPT_HOST, and the codes that go to the console only', () => {
    assert.equal(activateNoticeText({ by: 'server', code: 'NO_SCRIPT_HOST' }),
      "Nothing happens: this world's owner isn't here right now.")
    for (const code of ['RATE_LIMITED', 'NODE_NOT_FOUND', 'INVALID_FIELD']) {
      assert.equal(activateNoticeText({ by: 'server', code }), '', `${code} is console-only`)
    }
    assert.equal(activateNoticeText({ by: 'page', reason: 'whatever' }), '')
    assert.equal(activateNoticeText({}), '')
    assert.equal(activateNoticeText(), '')
  })
})

describe('AC6 — the page’s own pre-check', () => {
  test('no local avatar: the page’s own text, and nothing is sent', () => {
    assert.equal(activateClickNotice({ avatarNode: null, avatarPosition: undefined, targetPosition: [0, 0, 0] }),
      ACTIVATE_PAGE_NOTICE['no-avatar'])
  })

  test('too far: the page’s own text; in reach: no notice at all', () => {
    const avatar = { translation: [0, 0, 0] }
    assert.equal(activateClickNotice({ avatarNode: avatar, avatarPosition: [0, 0, 0], targetPosition: [0, 0, 12] }),
      ACTIVATE_PAGE_NOTICE['too-far'])
    assert.equal(activateClickNotice({ avatarNode: avatar, avatarPosition: [0, 0, 0], targetPosition: [0, 0, 9] }), '')
    assert.equal(activateClickNotice({ avatarNode: avatar, avatarPosition: [0, 0, 0], targetPosition: [0, 0, 10] }), '',
      'exactly 10 m passes (AC-L2 is inclusive)')
  })
})

describe('AC6 — the 3 s notice element', () => {
  /** A manual clock: `show()` schedules, and the test fires it. */
  function timers() {
    const pending = new Map()
    let id = 0
    return {
      setTimer: (fn, ms) => { pending.set(++id, { fn, ms }); return id },
      clearTimer: (t) => pending.delete(t),
      pending,
      fire: () => { for (const [k, t] of [...pending]) { pending.delete(k); t.fn() } },
    }
  }

  test('it shows the text, and clears after exactly 3 s', () => {
    const element = el()
    const clock = timers()
    const notice = createActivateNotice({ element, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
    notice.show('Move closer to use this.')
    assert.equal(element.textContent, 'Move closer to use this.')
    assert.equal(element.style.display, '', 'shown')
    assert.deepEqual([...clock.pending.values()].map((t) => t.ms), [ACTIVATE_NOTICE_MS])
    assert.equal(ACTIVATE_NOTICE_MS, 3000)

    clock.fire()
    assert.equal(element.textContent, '', 'cleared')
    assert.equal(element.style.display, 'none', 'and hidden')
  })

  test('a second notice REPLACES the first, and restarts the 3 s', () => {
    const element = el()
    const clock = timers()
    const notice = createActivateNotice({ element, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
    notice.show('one')
    const first = [...clock.pending.keys()][0]
    notice.show('two')
    assert.equal(element.textContent, 'two', 'one at a time')
    assert.equal(clock.pending.has(first), false, 'the first timer was cancelled')
    assert.equal(clock.pending.size, 1, 'and only one is pending')

    clock.fire()
    assert.equal(element.textContent, '')
  })

  test('an empty text shows nothing, and clear() goes at once', () => {
    const element = el()
    const clock = timers()
    const notice = createActivateNotice({ element, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
    notice.show('')
    assert.equal(element.textContent, '')
    assert.equal(element.style.display, 'none')

    notice.show('x')
    notice.clear()
    assert.equal(element.textContent, '')
    assert.equal(element.style.display, 'none')
    assert.equal(clock.pending.size, 0, 'and its timer is gone')
  })

  test('with no element it is a no-op, and never throws', () => {
    const notice = createActivateNotice({ element: null })
    assert.doesNotThrow(() => { notice.show('x'); notice.clear() })
  })
})

describe('AC6 — the target rule', () => {
  const som = (name, behavior, overrides = {}) => ({ name, parent: null, extras: { atrium: { ...(behavior === undefined ? {} : { behavior }), ...overrides } } })

  test('the hit’s own node, a model’s inner node, and scenery', () => {
    const host = som('crate', hide(OWN))
    assert.equal(activateClickTarget(host), host, 'its own node')

    const inner = { name: 'crate/inner', parent: host, extras: {} }
    assert.equal(activateClickTarget(inner), host, 'a model’s inner node reaches its host')
    assert.equal(activateClickTarget(som('scenery', undefined)), null, 'scenery resolves to nothing')
    assert.equal(activateClickTarget(null), null)
  })
})

// ===========================================================================
// 2. the click branch, through the REAL runner and the REAL client
// ===========================================================================

class MockWebSocket {
  constructor() {
    this.readyState = 1
    this.sent = []
    this._handlers = {}
  }
  on(event, fn) { (this._handlers[event] ??= []).push(fn); return this }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  _fire(event, ...args) { for (const fn of this._handlers[event] ?? []) fn(...args) }
  simulateMessage(msg) { this._fire('message', JSON.stringify(msg)) }
  of(type) { return this.sent.filter((m) => m.type === type) }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * A page-shaped harness: a real client on a mock socket, a real runner, and a
 * real SOM built from a real som-dump. Only the socket is faked.
 *
 * W4 (Rev 2): `position`, `avatarPosition` and `targetPosition` are the REAL
 * `worldPosition` — the one `app.js` imports (`app.js` L2153–2154, L3203) — not
 * `node.translation`, which is the LOCAL translation and agrees with the world
 * position only for root-level nodes. `nested` puts the behaviour node under a
 * translated group, which is where the two disagree.
 *
 * @param {{scriptHost?: boolean, canEdit?: boolean, avatar?: object|null,
 *          avatarAt?: number[], nested?: {group: number[], crate: number[]}|null}} options
 */
async function makePage({ scriptHost = false, canEdit = false, avatar = null, avatarAt = [0, 0, 0], nested = null } = {}) {
  const mocks = []
  const client = new AtriumClient({
    WebSocket: class { constructor() { const m = new MockWebSocket(); mocks.push(m); return m } },
    connectTimeout: 0,
  })
  client.connect('ws://mock', { scriptRunner: !!scriptHost, ...(avatar ? { avatar } : {}) })
  const socket = mocks[0]
  client._sessionId = 'session-aabbccdd'

  socket.simulateMessage({
    type: 'hello', id: client._sessionId, seq: 1,
    avatarNodeName: 'avatar-aabbccdd', displayName: 'User-sess', serverTime: Date.now(),
    canEdit, canPlaceTeleporters: canEdit, signedIn: false,
    scriptHost, ...(scriptHost ? { hostGen: 1 } : {}),
    capabilities: { tick: { interval: 1000 } },
  })
  await delay(10)

  // The runner is created BEFORE the world arrives, exactly as the app does it.
  const runner = createBehaviorRunner({
    client,
    now: () => Date.now(),
    position: (node) => (node ? worldPosition(node) : undefined),
    localAvatar: () => client.som?.getNodeByName(client._avatarNodeName) ?? null,
  })

  // A real som-dump, built by hand: `apps/client` does not depend on
  // @gltf-transform/core, and the dump is plain glTF JSON.
  const nodes = [
    { name: 'crate', extras: { atrium: { objectId: OWN, behavior: hide(OWN) } }, ...(nested ? { translation: nested.crate } : {}) },
    { name: 'target', extras: { atrium: { objectId: TGT } } },
    { name: 'scenery' },
  ]
  if (avatar) {
    // The local avatar the client adds to its own SOM: the same shape the page
    // sends (ephemeral, at `avatarAt`).
    nodes.push({ name: 'avatar-aabbccdd', translation: avatarAt, extras: { atrium: { ephemeral: true } } })
  }
  let roots = nodes.map((_, i) => i)
  if (nested) {
    // `crate` (index 0) becomes the child of a translated group. The group is a
    // scene root; the crate is no longer one.
    const groupIndex = nodes.length
    nodes.push({ name: 'group', translation: nested.group, children: [0] })
    roots = roots.filter((i) => i !== 0).concat(groupIndex)
  }
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
  }
  socket.simulateMessage({ type: 'som-dump', seq: 2, gltf })
  await delay(30)

  const noticeEl = el()
  const notice = createActivateNotice({ element: noticeEl })

  /**
   * THE CLICK BRANCH, as app.js sequences it: the same production call
   * (`performActivateClick`, which decides and executes) with the same inputs,
   * and the real runner and the real client.
   */
  const click = (hitInput) => {
    const target = activateClickTarget(hitInput)
    if (!target) return { action: 'none' }
    const avatarNode = client.som?.getNodeByName(client._avatarNodeName) ?? null
    return performActivateClick({
      hit: hitInput,
      target,
      isHost: client.scriptHost?.active === true,
      runner,
      client,
      avatarNode,
      avatarPosition: avatarNode ? worldPosition(avatarNode) : undefined,
      targetPosition: worldPosition(target),
      notice,
    })
  }

  return { client, socket, runner, noticeEl, notice, click }
}

describe('AC6 — the click branch, through the real runner and the real client.activate', () => {
  test('the HOST tab runs the behaviour locally and sends NO activate', async () => {
    const page = await makePage({ scriptHost: true, canEdit: true, avatar: { name: 'me' }, avatarAt: [0, 0, 0] })
    try {
      assert.equal(page.client.scriptHost.active, true)
      assert.equal(page.runner.enabled, true, 'the runner is enabled: role, canEdit and a loaded world')
      const crate = page.client.som.getNodeByName('crate')
      assert.ok(crate, 'the behaviour node is in the SOM')

      const result = page.click(crate)
      assert.equal(result.action, 'select')
      assert.equal(result.outcome, 'ran')

      page.socket.sent.length = 0
      await delay(60)
      page.runner.tick()          // the app's frame loop drains the engine's send
      assert.equal(page.socket.of('activate').length, 0, 'the host NEVER activate()s (proof (f))')
      const sent = page.socket.of('send')
      assert.equal(sent.length, 1, 'it ran the behaviour here instead')
      assert.equal(sent[0].node, 'target')
      assert.equal(sent[0].value, false, 'the select-visibility hide reached the wire')
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })

  test('the HOST tab shows the page’s notice when its own avatar is out of reach', async () => {
    const page = await makePage({ scriptHost: true, canEdit: true, avatar: { name: 'me' }, avatarAt: [0, 0, 15] })
    try {
      const crate = page.client.som.getNodeByName('crate')
      const result = page.click(crate)
      assert.equal(result.outcome, 'too-far')
      assert.equal(page.noticeEl.textContent, ACTIVATE_PAGE_NOTICE['too-far'])
      page.socket.sent.length = 0
      await delay(60)
      page.runner.tick()
      assert.equal(page.socket.of('send').length, 0, 'and nothing ran')
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })

  test('a NON-HOST owner tab sends activate() instead', async () => {
    const page = await makePage({ scriptHost: false, canEdit: true, avatar: { name: 'me' }, avatarAt: [0, 0, 2] })
    try {
      page.socket.sent.length = 0
      const crate = page.client.som.getNodeByName('crate')
      const result = page.click(crate)
      assert.equal(result.action, 'activate')
      const sent = page.socket.of('activate')
      assert.equal(sent.length, 1)
      assert.equal(sent[0].node, 'crate')
      assert.equal(sent[0].event, 'select')
      assert.equal(page.noticeEl.textContent, '', 'and no notice: it was sent')
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })

  test('a VISITOR tab sends activate(), and its pre-check sends NOTHING', async () => {
    const near = await makePage({ avatar: { name: 'me' }, avatarAt: [0, 0, 2] })
    try {
      near.socket.sent.length = 0
      const result = near.click(near.client.som.getNodeByName('crate'))
      assert.equal(result.action, 'activate')
      assert.equal(near.socket.of('activate').length, 1)
      assert.equal(near.noticeEl.textContent, '')
    } finally {
      near.runner.dispose()
      near.client.disconnect()
    }

    // Too far: the page's own text, and NOTHING on the wire.
    const far = await makePage({ avatar: { name: 'me' }, avatarAt: [0, 0, 30] })
    try {
      far.socket.sent.length = 0
      const result = far.click(far.client.som.getNodeByName('crate'))
      assert.equal(result.action, 'notice')
      assert.equal(far.noticeEl.textContent, ACTIVATE_PAGE_NOTICE['too-far'])
      assert.equal(far.socket.of('activate').length, 0, 'a doomed click never reaches the wire')
    } finally {
      far.runner.dispose()
      far.client.disconnect()
    }

    // No local avatar at all: the page's other text.
    const none = await makePage({})
    try {
      none.socket.sent.length = 0
      const result = none.click(none.client.som.getNodeByName('crate'))
      assert.equal(result.action, 'notice')
      assert.equal(none.noticeEl.textContent, ACTIVATE_PAGE_NOTICE['no-avatar'])
      assert.equal(none.socket.of('activate').length, 0)
    } finally {
      none.runner.dispose()
      none.client.disconnect()
    }
  })

  test('a click on scenery does nothing at all, in any tab', async () => {
    const page = await makePage({ avatar: { name: 'me' }, avatarAt: [0, 0, 2] })
    try {
      page.socket.sent.length = 0
      const result = page.click(page.client.som.getNodeByName('scenery'))
      assert.equal(result.action, 'none')
      assert.equal(page.noticeEl.textContent, '')
      assert.equal(page.socket.sent.length, 0)
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })

  test('the server’s refusal reaches the notice element, and console-only codes do not', async () => {
    const page = await makePage({ avatar: { name: 'me' }, avatarAt: [0, 0, 2] })
    try {
      page.socket.sent.length = 0
      page.click(page.client.som.getNodeByName('crate'))
      const seq = page.socket.of('activate')[0].seq

      // This is the listener app.js registers, driven by the real client event.
      const onRefused = ({ node, code }) => {
        const text = activateNoticeText({ by: 'server', code })
        if (text) page.notice.show(text)
        else page.notice.show('')
      }
      page.client.on('activate:refused', onRefused)

      page.socket.simulateMessage({ type: 'error', code: 'NO_SCRIPT_HOST', message: 'x', seq })
      await delay(5)
      assert.equal(page.noticeEl.textContent, ACTIVATE_SERVER_NOTICE.NO_SCRIPT_HOST)

      const seq2 = (() => { page.click(page.client.som.getNodeByName('crate')); return page.socket.of('activate').at(-1).seq })()
      page.socket.simulateMessage({ type: 'error', code: 'RATE_LIMITED', message: 'x', seq: seq2 })
      await delay(5)
      assert.equal(page.noticeEl.textContent, '', 'RATE_LIMITED is console-only (AC-L6)')
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })
})

// ===========================================================================
// W4 (Rev 2) — the click measures WORLD positions, not local translations
//
// The outside review's S2: this test passed `node.translation` where production
// passes `worldPosition` (`app.js` L2153–2154, L3203). The two agree only for a
// root-level node, so the test could not see a nested switch. Each case below
// uses a switch that IS nested, and a geometry where the local translation and
// the world position disagree by 16 m — one of them says "in reach" and the
// other says "too far", so the answer says which one the code used.
// ===========================================================================

describe('AC6/W4 — a nested target is measured at its WORLD position, both ways', () => {
  // The switch is the child of a group translated by [0, 0, -20]; its own
  // translation is [0, 0, 2]. LOCAL says 2 m; WORLD says 18 m.
  const LOCAL_NEAR_WORLD_FAR = { group: [0, 0, -20], crate: [0, 0, 2] }
  // The other direction: a far LOCAL translation, a near WORLD position.
  const LOCAL_FAR_WORLD_NEAR = { group: [0, 0, 20], crate: [0, 0, -18] }

  const parts = (page) => {
    const crate = page.client.som.getNodeByName('crate')
    const avatar = page.client.som.getNodeByName(page.client._avatarNodeName)
    return { crate, local: crate.translation, world: worldPosition(crate), avatarWorld: worldPosition(avatar) }
  }

  test('the fixture really tells the two apart: LOCAL 2 m, WORLD 18 m', async () => {
    const page = await makePage({ avatar: { name: 'me' }, avatarAt: [0, 0, 0], nested: LOCAL_NEAR_WORLD_FAR })
    try {
      const { crate, local, world, avatarWorld } = parts(page)
      assert.equal(crate.parent?.name, 'group', 'the switch really is nested (not a root node)')
      assert.deepEqual(local, [0, 0, 2], 'its own translation')
      assert.deepEqual(world, [0, 0, -18], 'and its position in the world')
      assert.equal(withinActivateDistance(avatarWorld, local), true, 'the LOCAL translation says 2 m — in reach')
      assert.equal(withinActivateDistance(avatarWorld, world), false, 'the WORLD position says 18 m — too far')
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })

  test('a VISITOR: refused on the world position, and nothing reaches the wire', async () => {
    const page = await makePage({ avatar: { name: 'me' }, avatarAt: [0, 0, 0], nested: LOCAL_NEAR_WORLD_FAR })
    try {
      page.socket.sent.length = 0
      const result = page.click(page.client.som.getNodeByName('crate'))
      assert.equal(result.action, 'notice')
      assert.equal(page.noticeEl.textContent, ACTIVATE_PAGE_NOTICE['too-far'])
      assert.equal(page.socket.of('activate').length, 0,
        'a click the LOCAL translation would have allowed never reaches the wire')
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })

  test('the HOST: the same geometry returns too-far, and the behaviour does not run', async () => {
    const page = await makePage({
      scriptHost: true, canEdit: true, avatar: { name: 'me' }, avatarAt: [0, 0, 0], nested: LOCAL_NEAR_WORLD_FAR,
    })
    try {
      page.socket.sent.length = 0
      const result = page.click(page.client.som.getNodeByName('crate'))
      assert.equal(result.action, 'select')
      assert.equal(result.outcome, 'too-far', 'the runner measures the world position too')
      assert.equal(page.noticeEl.textContent, ACTIVATE_PAGE_NOTICE['too-far'])
      await delay(60)
      page.runner.tick()
      assert.equal(page.socket.of('send').length, 0, 'and nothing ran')
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })

  test('the other way (LOCAL 18 m, WORLD 2 m): the VISITOR is allowed to send', async () => {
    const page = await makePage({ avatar: { name: 'me' }, avatarAt: [0, 0, 0], nested: LOCAL_FAR_WORLD_NEAR })
    try {
      const { local, world, avatarWorld } = parts(page)
      assert.equal(withinActivateDistance(avatarWorld, local), false, 'the LOCAL translation says 18 m')
      assert.deepEqual(world, [0, 0, 2], 'the WORLD position says 2 m')

      page.socket.sent.length = 0
      const result = page.click(page.client.som.getNodeByName('crate'))
      assert.equal(result.action, 'activate', 'so the click is sent')
      assert.equal(page.socket.of('activate').length, 1)
      assert.equal(page.noticeEl.textContent, '')
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })

  test('the other way (LOCAL 18 m, WORLD 2 m): the HOST runs it', async () => {
    const page = await makePage({
      scriptHost: true, canEdit: true, avatar: { name: 'me' }, avatarAt: [0, 0, 0], nested: LOCAL_FAR_WORLD_NEAR,
    })
    try {
      page.socket.sent.length = 0
      const result = page.click(page.client.som.getNodeByName('crate'))
      assert.equal(result.action, 'select')
      assert.equal(result.outcome, 'ran')
      await delay(60)
      page.runner.tick()
      const sent = page.socket.of('send')
      assert.equal(sent.length, 1, 'the select-visibility hide reached the wire')
      assert.equal(sent[0].node, 'target')
      assert.equal(sent[0].value, false)
    } finally {
      page.runner.dispose()
      page.client.disconnect()
    }
  })
})
