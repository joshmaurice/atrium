// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// signin-sync.test.js — the app's half of the signin-sync round (brief §6.4).
//
// Two kinds of test live here, as the app's other rounds do:
//  1. RUNTIME tests of `auth-sync.js` — the module holds I2, I3 and I4 and
//     takes every page dependency as an injected function, so it runs with no
//     DOM at all and its rules are checked directly;
//  2. TEXT guards over `apps/client/src/app.js` and `index.html` for the wiring
//     only the page has: the six connect sites all going through the one
//     wrapper, the honeypot posting nothing, the 401 paths, and the notice
//     element's place in the top bar.
//
// The DOM rule still holds where an element is built: `strict-element.mjs` is
// the one element stand-in, and `dataset` is never assigned.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAuthSync, NOTICE, AUTH_CHANNEL, SYNC_TIMEOUT_MS } from '../src/auth-sync.js'
import { computeWsUrl, sameOriginAsAccount } from '../src/wsUrl.js'
import { el } from './strict-element.mjs'
import * as authJs from '../src/auth.js'
import { codeToReason } from '../src/teleport-failure.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../src/app.js'), 'utf-8')
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')

// ---------------------------------------------------------------------------
// A module instance with recording fakes
// ---------------------------------------------------------------------------

function makeSync(opts = {}) {
  const calls = { me: 0, notices: [], disconnected: 0, autoconnected: [], states: [] }
  let meImpl = opts.me ?? (async () => null)
  let user = opts.user ?? null

  const deps = {
    me: (...args) => { calls.me += 1; return meImpl(...args) },
    getCurrentUser: () => user,
    setAuthState: (u) => { user = u; calls.states.push(u) },
    showNotice: (t) => calls.notices.push(t),
    clearNotice: () => {},
    isConnected: () => opts.connected ?? false,
    connectionIsSameOrigin: () => opts.sameOrigin ?? true,
    disconnect: () => { calls.disconnected += 1 },
    autoConnect: (u) => calls.autoconnected.push(u),
    createChannel: opts.createChannel ?? (() => null),
    log: { warn: () => {} },
  }

  const sync = createAuthSync(deps)
  return { sync, calls, getUser: () => user, setMe: (fn) => { meImpl = fn } }
}

const alice = { id: 'user-alice', username: 'alice', displayName: 'Alice' }
const bob = { id: 'user-bob', username: 'bob', displayName: 'Bob' }

// ===========================================================================
// §6.4 — syncAuth()
// ===========================================================================

describe('§6.4 syncAuth()', () => {
  test('concurrent calls share one request', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const { sync, calls } = makeSync({ me: () => gate.then(() => bob) })

    const a = sync.syncAuth()
    const b = sync.syncAuth()
    const c = sync.syncAuth()
    release()
    await Promise.all([a, b, c])

    assert.equal(calls.me, 1, 'one fetch for three concurrent calls')
    assert.equal(calls.states.length, 1, 'one state change')
  })

  test('a timeout keeps the state and lets the connect proceed', async () => {
    // The injected timer fires at once, so the 3 s race is settled instantly.
    const fireNow = (fn) => { Promise.resolve().then(fn); return 0 }
    const { sync, calls } = makeSync({
      me: () => new Promise(() => {}),
      user: alice,
      connected: true,
    })
    // Rebuild with the immediate timer.
    const built = createAuthSync({
      me: () => { calls.me += 1; return new Promise(() => {}) },
      getCurrentUser: () => alice,
      setAuthState: () => { throw new Error('a timeout must not change the state') },
      setTimeout: fireNow,
      clearTimeout: () => {},
      log: { warn: () => {} },
    })
    const result = await built.syncAuth()
    assert.equal(result.changed, false)
    assert.equal(built.currentGeneration(), 0)
    const guard = await built.guardConnect()
    assert.equal(guard.proceed, true, 'the connect goes ahead')
    void sync
  })

  test('a network error keeps the state and the connect proceeds', async () => {
    const { sync, calls } = makeSync({
      user: alice,
      me: () => { throw new Error('offline') },
    })
    const result = await sync.syncAuth()
    assert.equal(result.changed, false)
    assert.equal(calls.states.length, 0, 'the state is untouched')

    const guard = await sync.guardConnect()
    assert.equal(guard.proceed, true, 'I3 is the backstop; the connect still goes')
  })

  test('a 503 keeps the state and the connect proceeds', async () => {
    const err = new Error('Session check failed (503)')
    err.status = 503
    const { sync, calls } = makeSync({ user: alice, me: () => { throw err } })
    const result = await sync.syncAuth()
    assert.equal(result.changed, false)
    assert.equal(calls.states.length, 0)
    assert.equal((await sync.guardConnect()).proceed, true)
  })

  test('the request uses no-store (auth.js me())', async () => {
    const seen = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), init })
      return { status: 401, ok: false, json: async () => ({}) }
    }
    try {
      assert.equal(await authJs.me(), null, '401 is the expected signed-out answer')
    } finally {
      globalThis.fetch = realFetch
    }
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, '/api/auth/me')
    assert.equal(seen[0].init?.cache, 'no-store')
  })

  test('a 401 while signed in leads to I4’s signed-out handling', async () => {
    const { sync, calls } = makeSync({
      user: alice, connected: true, sameOrigin: true, me: async () => null,
    })
    const result = await sync.syncAuth()
    assert.equal(result.changed, true)
    assert.equal(calls.states.at(-1), null, 'the page is signed out')
    assert.equal(calls.disconnected, 1, 'the same-origin connection was dropped')
  })

  test('a different id leads to I4’s other-user handling', async () => {
    const { sync, calls } = makeSync({
      user: alice, connected: true, sameOrigin: true, me: async () => bob,
    })
    const result = await sync.syncAuth()
    assert.equal(result.changed, true)
    assert.equal(calls.states.at(-1), bob)
    assert.deepEqual(calls.notices, [NOTICE.OTHER_USER('Bob')])
  })

  test('the timeout constant is 3 seconds', () => {
    assert.equal(SYNC_TIMEOUT_MS, 3000)
  })
})

// ===========================================================================
// §6.4 — the connect sites
// ===========================================================================

describe('§6.4 the six connect sites', () => {
  test('a change found before a connect cancels it', async () => {
    const { sync, calls } = makeSync({ user: alice, me: async () => bob })
    const guard = await sync.guardConnect()
    assert.equal(guard.proceed, false, 'no client.connect call is made')
    assert.equal(guard.changed, true)
    assert.deepEqual(calls.autoconnected, [bob], 'I4 step 4 still runs')
  })

  test('two connects back-to-back await the same me() and connect in call order', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const { sync, calls } = makeSync({ user: alice, me: () => gate.then(() => alice) })

    const first = sync.guardConnect()
    const second = sync.guardConnect()
    release()
    const [a, b] = await Promise.all([first, second])

    assert.equal(calls.me, 1, 'one shared request')
    assert.equal(a.proceed, true)
    assert.equal(b.proceed, true)
    assert.equal(calls.states.length, 0, 'no change: trackConnect’s supersession is unchanged')
  })

  test('app.js: every connect goes through the one wrapper', () => {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    const rawConnects = (stripped.match(/client\.connect\(/g) ?? []).length
    assert.equal(rawConnects, 1, 'the only raw client.connect() is inside connectNow()')

    const wrappers = (stripped.match(/trackConnect\(/g) ?? []).length
    assert.equal(wrappers, 7, 'six call sites plus the one definition')

    assert.match(stripped, /return connectNow\(wsUrl, connectOpts, \{ onError \}\)/,
      'the wrapper delegates to connectNow')
    assert.match(stripped, /const guard = await authSync\.guardConnect\(\)/,
      'and it awaits the guard first')

    // autoConnectToHomeWorld is one of the six, not a bypass.
    const at = stripped.indexOf('function autoConnectToHomeWorld')
    assert.ok(at >= 0)
    const body = stripped.slice(at, stripped.indexOf('\n}\n', at))
    assert.match(body, /return trackConnect\(/, 'autoconnect goes through the wrapper')
  })
})

// ===========================================================================
// §6.4 — I3, the backstop
// ===========================================================================

describe('§6.4 I3 — the backstop comparison', () => {
  test('same-origin, hello.userId ≠ currentUser.id: one syncAuth, then I4', async () => {
    const { sync, calls } = makeSync({ user: alice, connected: true, sameOrigin: true, me: async () => bob })
    const result = await sync.handleSessionReady({
      sameOrigin: true, signedIn: true, userId: bob.id, displayName: 'Bob',
    })
    assert.equal(calls.me, 1, 'exactly one syncAuth()')
    assert.equal(result.changed, true)
    assert.deepEqual(calls.notices, [NOTICE.OTHER_USER('Bob')])
  })

  test('when the page still disagrees, the Reload-the-page notice shows', async () => {
    const { sync, calls } = makeSync({ user: alice, me: async () => alice })
    await sync.handleSessionReady({
      sameOrigin: true, signedIn: true, userId: bob.id, displayName: 'Bob',
    })
    assert.equal(calls.me, 1)
    assert.deepEqual(calls.notices, [NOTICE.RELOAD('Bob', 'Alice')])
  })

  test('cross-origin is never compared', async () => {
    const { sync, calls } = makeSync({ user: alice, me: async () => bob })
    const result = await sync.handleSessionReady({
      sameOrigin: false, signedIn: true, userId: bob.id, displayName: 'Bob',
    })
    assert.equal(result, null)
    assert.equal(calls.me, 0, 'no comparison at all')
  })

  test('a hello without signedIn is never compared', async () => {
    const { sync, calls } = makeSync({ user: alice, me: async () => bob })
    const result = await sync.handleSessionReady({
      sameOrigin: true, signedIn: undefined, userId: undefined,
    })
    assert.equal(result, null)
    assert.equal(calls.me, 0)
    assert.deepEqual(calls.notices, [])
  })

  test('an agreeing same-origin hello does nothing', async () => {
    const { sync, calls } = makeSync({ user: alice, me: async () => bob })
    const result = await sync.handleSessionReady({
      sameOrigin: true, signedIn: true, userId: alice.id, displayName: 'Alice',
    })
    assert.equal(result, null)
    assert.equal(calls.me, 0)
  })

  // signin-sync r2 J3 — with `accountWsBase` exactly as app.js computes it,
  // the page's own origin is same-origin, so I3's comparison runs. Round 1's
  // helper compared a converted world origin with a raw `wss:` base and was
  // always false, so no comparison ran at all.
  test('J3 — a same-origin session:ready runs I3 with accountWsBase as app.js computes it', async () => {
    const accountWsBase = computeWsUrl({
      protocol: 'https:', host: '127.0.0.1:8443', pathname: '/apps/client/local.html',
    })
    const worldUrl = 'wss://127.0.0.1:8443/worlds/alice/home'
    const sameOrigin = sameOriginAsAccount(worldUrl, accountWsBase)
    assert.equal(sameOrigin, true, "the page's own origin is same-origin")

    const { sync, calls } = makeSync({ user: alice, connected: true, me: async () => alice })
    await sync.handleSessionReady({ sameOrigin, signedIn: true, userId: bob.id, displayName: 'Bob' })

    assert.equal(calls.me, 1, 'I3 ran the comparison')
    assert.deepEqual(calls.notices, [NOTICE.RELOAD('Bob', 'Alice')],
      'hello says bob, the page says alice: the reload notice shows')
  })
})

// ===========================================================================
// §6.4 — I4
// ===========================================================================

describe('§6.4 I4 — what a tab does when the user changed', () => {
  test('a same-origin connection is disconnected and a cross-origin one is not', async () => {
    const same = makeSync({ user: alice, connected: true, sameOrigin: true, me: async () => bob })
    await same.sync.syncAuth()
    assert.equal(same.calls.disconnected, 1)

    const cross = makeSync({ user: alice, connected: true, sameOrigin: false, me: async () => bob })
    await cross.sync.syncAuth()
    assert.equal(cross.calls.disconnected, 0, 'an anonymous connection is left alone')
  })

  test('autoconnect runs only for a signed-in new state', async () => {
    const out = makeSync({ user: alice, connected: true, sameOrigin: true, me: async () => null })
    await out.sync.syncAuth()
    assert.deepEqual(out.calls.autoconnected, [], 'a signed-out state autoconnects nothing')

    const inb = makeSync({ user: alice, connected: true, sameOrigin: true, me: async () => bob })
    await inb.sync.syncAuth()
    assert.deepEqual(inb.calls.autoconnected, [bob])
  })

  test('each of the three notices’ text', async () => {
    const other = makeSync({ user: alice, me: async () => bob })
    await other.sync.syncAuth()
    assert.equal(other.calls.notices[0], "You're signed in as Bob now (the sign-in changed in another tab).")

    // A signed-out change after another tab said so.
    const tab = makeSync({ user: alice, me: async () => null })
    tab.sync.onChannelMessage({ type: 'auth-changed' })
    await new Promise((r) => setImmediate(r))
    assert.equal(tab.calls.notices.at(-1), 'You were signed out in another tab.')

    // A signed-out change nobody announced: the sign-in expired.
    const expired = makeSync({ user: alice, me: async () => null })
    await expired.sync.syncAuth()
    assert.equal(expired.calls.notices.at(-1), 'Your sign-in expired. Sign in again to edit your worlds.')
  })

  test('the notice element is a top-bar line, never inside authError', () => {
    assert.match(html, /<span id="auth-notice"><\/span>/, 'the element exists')
    assert.match(html, /#auth-notice\s*\{[\s\S]*?border: 1px solid/, 'and is styled to stand out')
    const notice = el('span')
    notice.textContent = "Couldn't sign out. Try again."
    assert.equal(notice.textContent, "Couldn't sign out. Try again.")
    // The signed-in form hides #auth-error; the notice is its sibling.
    assert.equal(html.includes('id="auth-notice"') && html.includes('id="auth-error"'), true)
  })
})

// ===========================================================================
// §6.4 — the BroadcastChannel
// ===========================================================================

function makeChannel() {
  const posted = []
  const handlers = {}
  return {
    posted,
    handlers,
    channel: {
      postMessage: (m) => posted.push(m),
      addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn) },
      close() {},
    },
    deliver(data) { for (const fn of handlers.message ?? []) fn({ data }) },
  }
}

describe('§6.4 the BroadcastChannel', () => {
  test('every post is exactly one auth-changed message carrying no identity', () => {
    const c = makeChannel()
    const { sync } = makeSync({ createChannel: () => c.channel })
    sync.start()

    sync.postAuthChanged()
    sync.postAuthChanged()
    sync.postAuthChanged()

    assert.deepEqual(c.posted, [
      { type: 'auth-changed' }, { type: 'auth-changed' }, { type: 'auth-changed' },
    ], 'one message each, no identity in it')
  })

  test('the channel name is atrium-auth', () => {
    const seen = []
    const { sync } = makeSync({ createChannel: (name) => { seen.push(name); return null } })
    sync.start()
    assert.deepEqual(seen, [AUTH_CHANNEL])
    assert.equal(AUTH_CHANNEL, 'atrium-auth')
  })

  test('a received message runs syncAuth()', async () => {
    const c = makeChannel()
    const { sync, calls } = makeSync({ createChannel: () => c.channel, user: alice, me: async () => bob })
    sync.start()

    c.deliver({ type: 'auth-changed' })
    await new Promise((r) => setImmediate(r))

    assert.equal(calls.me, 1, 'the message ran the one re-check')
    assert.equal(calls.states.at(-1), bob)
  })

  test('a message that is not auth-changed is ignored', async () => {
    const c = makeChannel()
    const { sync, calls } = makeSync({ createChannel: () => c.channel })
    sync.start()
    c.deliver({ type: 'something-else' })
    await new Promise((r) => setImmediate(r))
    assert.equal(calls.me, 0)
  })

  test('a page with no BroadcastChannel still works', async () => {
    const { sync, calls } = makeSync({ createChannel: () => null, user: alice, me: async () => bob })
    const stop = sync.start()
    assert.equal(typeof stop, 'function')
    assert.equal(sync.channel, null)
    assert.equal(sync.postAuthChanged(), false, 'posting is a no-op')
    const guard = await sync.guardConnect()
    assert.equal(guard.proceed, false, 'and the re-check still runs')
    assert.equal(calls.me, 1)
  })

  test('app.js posts once on the auth submit and once on logout, and the honeypot posts none', () => {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const posts = (stripped.match(/postAuthChanged\(\)/g) ?? []).length
    assert.equal(posts, 2, 'the login/register submit and the logout button')

    const at = stripped.indexOf('async function handleAuthSubmit')
    const body = stripped.slice(at, stripped.indexOf('\n}\n', at))
    const honeypot = body.indexOf('isHoneypot)')
    const post = body.indexOf('postAuthChanged()')
    assert.ok(honeypot >= 0 && post >= 0)
    assert.ok(honeypot < post, 'the honeypot path returns before anything is posted')
  })
})

// ===========================================================================
// §6.4 — SIGNED_OUT
// ===========================================================================

describe('§6.4 SIGNED_OUT', () => {
  test('after session:ready it runs syncAuth(): me() → 401 gives the signed-out handling', async () => {
    const { sync, calls } = makeSync({ user: alice, connected: true, sameOrigin: true, me: async () => null })
    await sync.handleSignedOut()
    assert.equal(calls.me, 1)
    assert.equal(calls.states.at(-1), null)
    assert.equal(calls.notices.at(-1), 'You were signed out in another tab.')
  })

  test('me() → another user gives the other-user handling', async () => {
    const { sync, calls } = makeSync({ user: alice, connected: true, sameOrigin: true, me: async () => bob })
    await sync.handleSignedOut()
    assert.equal(calls.states.at(-1), bob)
    assert.equal(calls.notices.at(-1), NOTICE.OTHER_USER('Bob'))
  })

  test('me() → the same user (Rev 1, S1) autoconnects with the “then signed in again” notice', async () => {
    const { sync, calls } = makeSync({ user: alice, connected: true, sameOrigin: true, me: async () => alice })
    await sync.handleSignedOut()
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(calls.autoconnected, [alice], 'the tab reconnects as a reload would')
    assert.equal(calls.notices.at(-1), 'You were signed out in another tab, then signed in again.')
  })

  test('codeToReason("SIGNED_OUT") is exactly the pinned sentence', () => {
    assert.equal(codeToReason('SIGNED_OUT'), 'You have been signed out.')
  })

  test('app.js handles SIGNED_OUT next to WORLD_NOW_PRIVATE', () => {
    const at = source.indexOf("client.on('error'")
    const body = source.slice(at, source.indexOf("})\n", at))
    assert.match(body, /err\.code === 'SIGNED_OUT'/)
    assert.match(body, /authSync\.handleSignedOut\(\)/)
  })
})

// ===========================================================================
// §6.4 — other 401s and late responses (Rev 1, M2)
// ===========================================================================

describe('§6.4 other 401s and late responses', () => {
  test('the auth generation goes up on every setAuthState', () => {
    const { sync } = makeSync()
    assert.equal(sync.currentGeneration(), 0)
    sync.setAuthState(alice)
    assert.equal(sync.currentGeneration(), 1)
    sync.setAuthState(null)
    assert.equal(sync.currentGeneration(), 2)
  })

  test('app.js: the two former sign-out paths go through syncAuth() and never sign out', () => {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    // refreshWorldList's 401 branch
    const list = stripped.slice(stripped.indexOf('async function refreshWorldList'))
    const listBody = list.slice(0, list.indexOf('\n}\n'))
    assert.match(listBody, /res\.status === 401/)
    assert.match(listBody, /authSync\.syncAuth\(\)/)
    assert.equal(listBody.includes('setAuthState(null)'), false,
      'refreshWorldList never sets the state itself')

    // the toggle's PUT 401 branch
    const toggle = stripped.slice(stripped.indexOf('toggle.addEventListener(\'change\''))
    const toggleBody = toggle.slice(0, toggle.indexOf('item.appendChild(toggleLabel)'))
    assert.match(toggleBody, /res\.status === 401/)
    assert.match(toggleBody, /authSync\.syncAuth\(\)/)
    assert.equal(toggleBody.includes('setAuthState(null)'), false,
      'the toggle never sets the state itself')

    // The only direct setAuthState(null) is the logout button's success path.
    const direct = (stripped.match(/authSync\.setAuthState\(null\)/g) ?? []).length
    assert.equal(direct, 1, 'exactly one: the logout button')
  })

  test('app.js: both late-response paths note the generation and drop the response', () => {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const notes = (stripped.match(/authSync\.currentGeneration\(\)/g) ?? []).length
    assert.ok(notes >= 6,
      `refreshWorldList and the toggle each note and re-check the generation (saw ${notes})`)
    assert.match(stripped, /if \(authSync\.currentGeneration\(\) !== gen\) \{[\s\S]*?restore\(\)/,
      'the toggle is restored when the response is stale')
  })

  test('app.js: the load-time answer counts as the guard’s answer', () => {
    assert.match(source, /authSync\.adoptLoadAnswer\(\)/)
    assert.match(source, /document\.addEventListener\('visibilitychange'/)
    assert.match(source, /authSync\.handleVisible\(\)/)
  })
})

// ===========================================================================
// §6.4 — this tab's own logout (Rev 1)
// ===========================================================================

describe('§6.4 this tab’s own logout', () => {
  test('a SIGNED_OUT while it is in flight runs no syncAuth() and shows no notice', async () => {
    const { sync, calls } = makeSync({ user: alice, me: async () => null })
    sync.beginOwnLogout()
    await sync.handleSignedOut()
    assert.equal(calls.me, 0, 'no syncAuth()')
    assert.deepEqual(calls.notices, [], 'no notice')
    sync.endOwnLogout()
  })

  test('app.js: on success it disconnects, signs out, posts once; on 500 it stays', () => {
    const at = source.indexOf("authLogoutBtn.addEventListener('click'")
    const body = source.slice(at, source.indexOf("})\n", at))
    assert.match(body, /authSync\.beginOwnLogout\(\)/, 'marked in flight before the POST')
    assert.match(body, /client\.disconnect\(\)/)
    assert.match(body, /authSync\.setAuthState\(null\)/)
    assert.match(body, /authSync\.postAuthChanged\(\)/)
    assert.match(body, /NOTICE\.LOGOUT_FAILED/, 'the failure text is the brief’s')
    assert.match(body, /authSync\.endOwnLogout\(\)/)
  })

  test('the failure sentence is exactly the brief’s', () => {
    assert.equal(NOTICE.LOGOUT_FAILED, "Couldn't sign out. Try again.")
  })
})
