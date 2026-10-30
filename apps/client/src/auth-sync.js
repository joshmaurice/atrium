// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// auth-sync.js — signin-sync I2, I3 and I4 in one testable module.
//
// The page used to decide who you are once, at load. This module is the page's
// re-check: `syncAuth()` is the only call to `me()` after load, `guardConnect()`
// is the one wrapper every connect site goes through, `checkHelloAdmission()`
// is I3's backstop, and `applyChange()` is I4's "what a reload would do".
//
// It stays outside app.js so it can be unit-tested with no DOM at all: every
// dependency it has on the page — the current user, the auth-state renderer,
// the notice line, the connection, the channel — arrives as an injected
// function. `packages/client` stays renderer-neutral; this module is the app's.

/** The cross-tab channel's name (I2). The message carries no identity. */
export const AUTH_CHANNEL = 'atrium-auth'

/** I2's request timeout. */
export const SYNC_TIMEOUT_MS = 3000

/** Every user-facing sentence this module shows, verbatim. */
export const NOTICE = {
  OTHER_USER: (name) =>
    `You're signed in as ${name} now (the sign-in changed in another tab).`,
  SIGNED_OUT_OTHER_TAB: 'You were signed out in another tab.',
  SIGNED_OUT_OTHERWISE: 'Your sign-in expired. Sign in again to edit your worlds.',
  SIGNED_OUT_THEN_IN: 'You were signed out in another tab, then signed in again.',
  RELOAD: (admitted, page) =>
    `This world admitted you as ${admitted}, but the page says ${page}. Reload the page.`,
  LOGOUT_FAILED: "Couldn't sign out. Try again.",
}

/** I3's two sides: the user's name, or 'anonymous'. */
function nameOf(user) {
  if (!user) return 'anonymous'
  return user.displayName || user.username || 'anonymous'
}

/** True when two auth states are the same user (both null counts as the same). */
function sameUser(a, b) {
  return (a?.id ?? null) === (b?.id ?? null)
}

/**
 * @param {object} deps
 * @param {() => Promise<object|null>} deps.me        — auth.js's me(); null on 401
 * @param {() => object|null} deps.getCurrentUser     — the page's current user
 * @param {(user: object|null) => void} deps.setAuthState — renders the auth state
 * @param {(text: string) => void} [deps.showNotice]
 * @param {() => void} [deps.clearNotice]
 * @param {() => boolean} [deps.isConnected]
 * @param {() => boolean} [deps.connectionIsSameOrigin]
 * @param {() => void} [deps.disconnect]
 * @param {(user: object) => void} [deps.autoConnect]
 * @param {(name: string) => object|null} [deps.createChannel]
 * @param {Function} [deps.setTimeout] / [deps.clearTimeout]
 * @param {object} [deps.log]
 */
export function createAuthSync({
  me,
  getCurrentUser,
  setAuthState: renderAuthState,
  showNotice = () => {},
  clearNotice = () => {},
  isConnected = () => false,
  connectionIsSameOrigin = () => false,
  disconnect = () => {},
  autoConnect = () => {},
  createChannel = defaultCreateChannel,
  setTimeout: setTimeoutFn = setTimeout,
  clearTimeout: clearTimeoutFn = clearTimeout,
  log = console,
} = {}) {
  // I2 — the auth generation counter. It goes up on EVERY setAuthState, so a
  // response that started under an earlier sign-in can be recognised and
  // dropped, a 401 included.
  let generation = 0

  // The one request in flight, shared by concurrent callers.
  let inFlight = null

  // I2 — the last answer the load-time check produced, which counts as the
  // guard's answer for the autoconnect that follows it.
  let loadAnswerPending = false

  // I3/I4 — which change is being applied.
  let sawAuthChanged = false

  // This tab's own logout, in flight. Its own SIGNED_OUT is expected.
  let ownLogoutInFlight = false

  let channel = null
  let channelHandler = null

  function currentGeneration() { return generation }

  /**
   * The ONE writer of the page's auth state after load. Bumps the auth
   * generation first, so every response already in flight is stale from here.
   */
  function setAuthState(user) {
    generation += 1
    renderAuthState(user)
  }

  function adoptLoadAnswer() { loadAnswerPending = true }

  function beginOwnLogout() { ownLogoutInFlight = true }
  function endOwnLogout() { ownLogoutInFlight = false }
  function isOwnLogoutInFlight() { return ownLogoutInFlight }

  // -------------------------------------------------------------------------
  // I4 — what a tab does when syncAuth() finds the user changed
  // -------------------------------------------------------------------------

  /**
   * I4's steps 1-5. `source` is 'other-tab' when another tab said so, 'socket'
   * when a SIGNED_OUT arrived, 'sync' otherwise; `signedOutEvenIfSameUser` is
   * Rev 1's S1: a SIGNED_OUT always counts as a change for the connection, even
   * when the same account signs back in.
   */
  function applyChange(user, { source = 'sync', signedOutEvenIfSameUser = false } = {}) {
    const before = getCurrentUser()
    const same = sameUser(before, user)

    // 1. the top bar and the world list follow
    setAuthState(user)

    // 3. a SAME-ORIGIN connection is for the old user: disconnect it. A
    //    cross-origin connection is anonymous anyway and is left alone.
    if (isConnected() && connectionIsSameOrigin()) disconnect()

    // 4. a signed-in new state autoconnects, as a page load does. J1: the
    //    answer that found this change IS this one connect's guard answer, so
    //    it is passed EXPLICITLY, for this one connect only. Without it the
    //    autoconnect calls syncAuth() while runSync()'s own request is still
    //    in flight, joins `{ changed: true }`, and cancels itself.
    if (user) autoConnect(user, { confirmedUser: user })

    // 5. the notice, in plain words, visible without opening anything
    if (user && same && (source === 'socket' || signedOutEvenIfSameUser)) {
      showNotice(NOTICE.SIGNED_OUT_THEN_IN)
    } else if (user && !same) {
      showNotice(NOTICE.OTHER_USER(nameOf(user)))
    } else if (!user && source === 'other-tab') {
      showNotice(NOTICE.SIGNED_OUT_OTHER_TAB)
    } else if (!user) {
      showNotice(NOTICE.SIGNED_OUT_OTHERWISE)
    }

    return { changed: true, user }
  }

  // -------------------------------------------------------------------------
  // I2 — syncAuth()
  // -------------------------------------------------------------------------

  async function fetchMe() {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeoutFn(() => reject(new Error('syncAuth timed out')), SYNC_TIMEOUT_MS)
    })
    try {
      const user = await Promise.race([me(), timeout])
      return { ok: true, user: user ?? null }
    } catch (error) {
      // A network error, a timeout or a 5xx (me() throws on anything but 401):
      // keep the current state. I3 is the backstop, and the connect goes ahead.
      return { ok: false, error }
    } finally {
      clearTimeoutFn(timer)
    }
  }

  async function runSync() {
    const before = getCurrentUser()
    const answer = await fetchMe()

    if (!answer.ok) {
      return { changed: false, user: before, error: answer.error }
    }

    const user = answer.user
    if (sameUser(before, user)) {
      sawAuthChanged = false
      return { changed: false, user }
    }

    const source = sawAuthChanged ? 'other-tab' : 'sync'
    sawAuthChanged = false
    return applyChange(user, { source })
  }

  /** I2's one entry point. Concurrent calls share a single request. */
  function syncAuth() {
    if (inFlight) return inFlight
    const p = runSync()
    inFlight = p
    p.then(
      () => { if (inFlight === p) inFlight = null; loadAnswerPending = false },
      () => { if (inFlight === p) inFlight = null; loadAnswerPending = false },
    )
    return p
  }

  /**
   * The one wrapper every connect site goes through. Awaiting it means the
   * page has just confirmed who it is; a change found here CANCELS the connect
   * (no transport call), and the connect path sets the connection state to
   * what it actually is.
   *
   * J1 — `loadAnswerPending` (the page-load case) and `confirmedUser` (the
   * change handling's own autoconnect) are the two ways the guard's answer is
   * already known. Both are EXPLICIT and one-shot: no module-level flag a
   * later connect could consume. Every other connect, including a user's
   * Connect right after a change, still runs syncAuth().
   */
  async function guardConnect({ confirmedUser } = {}) {
    // J1 — the answer that found the change counts as the guard's answer for
    // the autoconnect that the change itself starts, exactly as the load-time
    // me() counts for the page-load autoconnect. Only when it is the current
    // user, so a stale value can never skip the check.
    if (confirmedUser && sameUser(confirmedUser, getCurrentUser())) {
      return { proceed: true, changed: false, user: getCurrentUser(), confirmed: true }
    }
    if (loadAnswerPending) {
      loadAnswerPending = false
      return { proceed: true, changed: false, user: getCurrentUser() }
    }
    const result = await syncAuth()
    return { proceed: !result.changed, ...result }
  }

  // -------------------------------------------------------------------------
  // I3 — the backstop: compare hello with the page
  // -------------------------------------------------------------------------

  /**
   * Decide whether a `session:ready` is a mismatch. Cross-origin connections
   * and a hello without `signedIn` are never compared.
   *
   * @param {{sameOrigin: boolean, signedIn: boolean|undefined, userId: string|undefined, displayName?: string}} detail
   * @returns {null|{admittedId: string|null, pageId: string|null, admittedName: string, pageName: string}}
   */
  function checkHelloAdmission({ sameOrigin, signedIn, userId, displayName } = {}) {
    if (!sameOrigin) return null
    if (typeof signedIn !== 'boolean') return null   // unknown is never compared

    const admittedId = signedIn ? (userId ?? null) : null
    const pageId = getCurrentUser()?.id ?? null
    if (admittedId === pageId) return null

    return {
      admittedId,
      pageId,
      admittedName: signedIn ? (displayName || 'the server') : 'anonymous',
      pageName: nameOf(getCurrentUser()),
    }
  }

  /** I3's handler for `session:ready`. */
  async function handleSessionReady(detail) {
    const mismatch = checkHelloAdmission(detail)
    if (!mismatch) return null

    const result = await syncAuth()
    if (result.changed) return result

    // Still disagreeing — a race, or a cause nobody has thought of.
    log.warn(
      `[auth] hello says ${mismatch.admittedId ?? 'nobody'} but the page says ` +
      `${mismatch.pageId ?? 'nobody'} — showing the reload notice`
    )
    showNotice(NOTICE.RELOAD(mismatch.admittedName, mismatch.pageName))
    return { changed: false, mismatch }
  }

  // -------------------------------------------------------------------------
  // I5's client side — SIGNED_OUT
  // -------------------------------------------------------------------------

  /**
   * A `SIGNED_OUT` error from the server. The client does NOT assume signed
   * out: it asks `me()`. While this tab's own logout is in flight, the
   * message is expected — no syncAuth() and no notice.
   */
  function handleSignedOut() {
    if (ownLogoutInFlight) return null
    sawAuthChanged = true
    const p = syncAuth()
    // Rev 1, S1 — even when me() finds the SAME user, the socket is already
    // gone, so the change handling runs (autoconnect + the "then signed in
    // again" notice). syncAuth() reports no change for the same user, so the
    // socket path applies it here.
    p.then((result) => {
      const user = result.user
      if (user && sameUser(getCurrentUser(), user) && !result.changed) {
        applyChange(user, { source: 'socket', signedOutEvenIfSameUser: true })
      }
    })
    return p
  }

  // -------------------------------------------------------------------------
  // The BroadcastChannel
  // -------------------------------------------------------------------------

  /** Every tab posts this after its own login, register or logout. */
  function postAuthChanged() {
    if (!channel) return false
    try {
      channel.postMessage({ type: 'auth-changed' })
      return true
    } catch {
      return false
    }
  }

  /** I2 — a received message runs syncAuth(). The message carries no identity. */
  function onChannelMessage(data) {
    if (!data || data.type !== 'auth-changed') return
    sawAuthChanged = true
    syncAuth()
  }

  /** Install the channel listener. A page with no BroadcastChannel still works. */
  function start() {
    channel = createChannel(AUTH_CHANNEL)
    if (!channel) return () => {}

    if (typeof channel.addEventListener === 'function') {
      channelHandler = (evt) => onChannelMessage(evt?.data)
      channel.addEventListener('message', channelHandler)
    } else {
      channelHandler = (evt) => onChannelMessage(evt?.data)
      channel.onmessage = channelHandler
    }
    return stop
  }

  function stop() {
    if (!channel) return
    if (typeof channel.removeEventListener === 'function' && channelHandler) {
      channel.removeEventListener('message', channelHandler)
    } else if ('onmessage' in channel) {
      channel.onmessage = null
    }
    try { channel.close?.() } catch { /* ignore */ }
    channel = null
    channelHandler = null
  }

  /** I2 — the tab became visible. */
  function handleVisible() {
    return syncAuth()
  }

  return {
    // state
    currentGeneration,
    setAuthState,
    adoptLoadAnswer,
    beginOwnLogout,
    endOwnLogout,
    isOwnLogoutInFlight,
    // notices
    showNotice,
    clearNotice,
    // I2
    syncAuth,
    guardConnect,
    handleVisible,
    // I3
    checkHelloAdmission,
    handleSessionReady,
    // I4 / I5 client side
    applyChange,
    handleSignedOut,
    // channel
    postAuthChanged,
    onChannelMessage,
    start,
    stop,
    get channel() { return channel },
  }
}

/** The default channel factory: absent in a page without BroadcastChannel. */
function defaultCreateChannel(name) {
  if (typeof globalThis.BroadcastChannel !== 'function') return null
  try {
    return new globalThis.BroadcastChannel(name)
  } catch {
    return null
  }
}

/**
 * signin-sync r2 J1/J2 — the ONE connect path.
 *
 * Every connect site in `app.js` goes through the function this returns, so a
 * seventh site cannot miss the guard and a cancelled connect's state reset
 * cannot be missed either. It lives here rather than in `app.js` so it can be
 * driven in a test against a REAL `createAuthSync`: the guard is the module's
 * own, and only the transport (`connect`) and the page's state setter are
 * faked. Round 1 tested `applyChange` with a spy for `autoConnect`, and that
 * is how the always-cancelled autoconnect got through.
 *
 * @param {object} deps
 * @param {(opts?: object) => Promise<{proceed: boolean}>} deps.guardConnect
 *   the real guard (`createAuthSync().guardConnect`); forwarded `confirmedUser`
 * @param {(wsUrl: string, connectOpts: object, ui: object) => Promise<object>} deps.connect
 *   the transport (`app.js`'s `connectNow`)
 * @param {() => boolean} deps.isConnected — is a socket open right now?
 * @param {(state: string) => void} deps.setConnectionState — the page's UI state
 * @param {() => void} [deps.clearOverlays] — hide the overlay and failure panel
 * @returns {(wsUrl: string, connectOpts: object, ui?: object) => Promise<{status: string}>}
 */
export function createConnectPath({
  guardConnect,
  connect,
  isConnected,
  setConnectionState,
  clearOverlays = () => {},
}) {
  /**
   * @param {string} wsUrl
   * @param {object} connectOpts
   * @param {{onError?: Function, onCancelled?: Function, confirmedUser?: object}} [ui]
   *   `confirmedUser` (J1) is passed by the change handling's own autoconnect
   *   only; it makes the guard skip exactly that one connect.
   * @returns {Promise<{status: string, data?: object}>}
   */
  return async function trackConnect(wsUrl, connectOpts, { onError, onCancelled, confirmedUser } = {}) {
    const guard = await guardConnect({ confirmedUser })
    if (!guard.proceed) {
      // A change found before the connect cancels it: no transport call, and
      // any overlay the caller raised goes.
      clearOverlays()
      // J2 — the state is set to what it ACTUALLY is, in addition to the
      // overlay clear. A cross-origin connection I4 left alone is still
      // connected; anything else is disconnected. Without this the Connect
      // button keeps reading "Connecting..." until a reload.
      setConnectionState(isConnected() ? 'connected' : 'disconnected')
      if (typeof onCancelled === 'function') onCancelled(guard)
      return { status: 'auth-changed', data: guard }
    }
    return connect(wsUrl, connectOpts, { onError })
  }
}
