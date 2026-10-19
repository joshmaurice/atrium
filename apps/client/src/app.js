// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { AtriumClient }          from '@atrium/client'
import { LabelOverlay }          from './LabelOverlay.js'
import { Stage, PointerInputBridge, initDocumentView, loadBackground, buildAvatarDescriptor, buildTeleporterDescriptor, buildPrimitiveDescriptor } from '@atrium/renderer-three'
import { register, login, logout, me } from './auth.js'
import { computeWsUrl, buildWorldWsUrl, resolveWorldAddress, isValidDestination, shouldUseFileBase, sameOriginAsAccount } from './wsUrl.js'
import { createTeleportTrigger, TELEPORT_TRIGGER_RADIUS, nearSpawn } from './teleport-trigger.js'
import { isTeleporter, teleporterDestination } from './teleporter-marker.js'
import { teleporterLabel } from './teleporter-label.js'
import { syncPadLabels } from './pad-labels.js'
import { teleportFailureMessage, evictionMessage, codeToReason, formatDestination } from './teleport-failure.js'
import { projectRayToPlane } from '@atrium/renderer-three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { resolveSelectionRoot } from '@atrium/interaction'
import { createEditModes } from './edit-modes.js'
import { createEditTracker, TRANSFORM_FIELDS, REMOVED_MESSAGE } from './edit-gesture.js'
import { pickEditSelection, isSelectClick, nodeForHitObject, findNodeObject } from './edit-selection.js'
import { worldPosition, subtreeSome } from './world-position.js'
import { quatToEulerDeg, eulerDegToQuat } from './rotation-degrees.js'
import { palettePlacement, paletteName, copyName } from './edit-palette.js'
import { prepareDuplicate, duplicateRuleProblem, prepareRestore } from './edit-duplicate.js'
import { createStructureTracker, countDescendants, collectSubtree, structuralBlockReason, editBlocked, fieldsDisabled, isActiveCameraStale } from './edit-structure.js'
import { createEditUndo } from './edit-undo.js'    // Phase 3 step 2 (Y1, Y4)

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const worldUrlInput = document.getElementById('worldUrl')
const wsUrlInput    = document.getElementById('wsUrl')
wsUrlInput.value    = computeWsUrl(window.location)
const loadBtn       = document.getElementById('loadBtn')
// Capture account-server WS base at startup
const accountWsBase = computeWsUrl(window.location)
const connectBtn    = document.getElementById('connectBtn')
const statusDot     = document.getElementById('statusDot')
const viewportEl    = document.getElementById('viewport')
const overlayEl     = document.getElementById('overlay')
const hudWorldEl    = document.getElementById('hud-world')
const hudYouEl      = document.getElementById('hud-you')
const hudPeersEl    = document.getElementById('hud-peers')
const hudHintEl     = document.getElementById('hud-hint')
const modeSwitcher  = document.getElementById('mode-switcher')

// Auth DOM refs
const authLoggedOut = document.getElementById('auth-logged-out')
const authLoggedIn  = document.getElementById('auth-logged-in')
const authUsername  = document.getElementById('auth-username')
const authPassword  = document.getElementById('auth-password')
const authSubmitBtn = document.getElementById('auth-submit-btn')
const authToggleBtn = document.getElementById('auth-toggle-btn')
const authLogoutBtn = document.getElementById('auth-logout-btn')
const authUserLabel = document.getElementById('auth-user-label')
const authError     = document.getElementById('auth-error')
const authWebsite   = document.getElementById('auth-website')

// World browser DOM refs
const worldBrowser  = document.getElementById('world-browser')
const subbarWorlds  = document.getElementById('subbar-worlds')
const wbSlug        = document.getElementById('wb-slug')
const wbName        = document.getElementById('wb-name')
const wbCreateBtn   = document.getElementById('wb-create-btn')
const wbError       = document.getElementById('wb-error')
const wbList        = document.getElementById('wb-list')

// ---------------------------------------------------------------------------
// Auth state
// ---------------------------------------------------------------------------

let currentUser = null   // { id, username, displayName } or null

function setAuthState(user) {
  currentUser = user
  if (user) {
    authLoggedOut.style.display = 'none'
    authLoggedIn.style.display  = ''
    authUserLabel.textContent   = user.displayName || user.username
    authError.textContent       = ''
    // Show world browser and subbar worlds, refresh list
    worldBrowser.style.display = ''
    subbarWorlds.style.display = ''
    refreshWorldList()
  } else {
    authLoggedOut.style.display = ''
    authLoggedIn.style.display  = 'none'
    authSubmitBtn.textContent   = 'Login'
    authToggleBtn.textContent   = 'Register'
    authUsername.value          = ''
    authPassword.value          = ''
    authError.textContent       = ''
    // Hide world browser and subbar worlds, clear list
    worldBrowser.style.display = 'none'
    subbarWorlds.style.display = 'none'
    wbList.innerHTML = ''
  }
}

async function handleAuthSubmit() {
  const username = authUsername.value.trim()
  const password = authPassword.value
  if (!username || !password) {
    authError.textContent = 'Username and password required'
    return
  }
  const isRegister = authSubmitBtn.textContent === 'Register'
  authSubmitBtn.disabled = true
  authError.textContent = ''

  // ── Pre-auth honeypot guard ──────────────────────────────────────
  // If Register mode and the hidden website field is non-empty, the
  // request IS a honeypot trigger. Call register() so bots that read
  // HTTP responses see a fake 200 (server returns fake success), but
  // do NOT set auth state, persist the session, or auto-connect — the
  // client stays logged out silently.
  const isHoneypot = isRegister && authWebsite.value.trim().length > 0

  try {
    let result
    if (isRegister) {
      result = await register(username, password, authWebsite.value.trim())
    } else {
      result = await login(username, password)
    }

    if (isHoneypot) {
      // Silent swallow — don't setAuthState, don't persist session,
      // don't show logged-in UI. Reset form to login mode.
      authSubmitBtn.textContent = 'Login'
      authToggleBtn.textContent = 'Register'
      authUsername.value = ''
      authPassword.value = ''
      authError.textContent = ''
      return
    }

    setAuthState(result)

    // Auto-connect to home world after successful auth.
    if (result && result.id) {
      autoConnectToHomeWorld(result)
    }

    // Surface home_world_creation_failed warning if present
    if (result && result.warning === 'home_world_creation_failed') {
      authError.textContent = 'Home world creation encountered an issue — continuing with limited functionality'
    }
  } catch (err) {
    authError.textContent = err.message || 'Authentication failed'
  } finally {
    authSubmitBtn.disabled = false
  }
}

function toggleAuthMode() {
  const isRegister = authSubmitBtn.textContent === 'Register'
  authSubmitBtn.textContent = isRegister ? 'Login' : 'Register'
  authToggleBtn.textContent = isRegister ? 'Register' : 'Login'
  authError.textContent = ''
}

// ---------------------------------------------------------------------------
// World browser
// ---------------------------------------------------------------------------

async function refreshWorldList() {
  try {
    const res = await fetch('/api/worlds')
    if (res.status === 401) {
      // Session expired — hide browser and update auth state
      setAuthState(null)
      return
    }
    if (!res.ok) return
    const worlds = await res.json()
    renderWorldList(worlds)
  } catch {
    // Network error — leave current list visible
  }
}

function renderWorldList(worlds) {
  if (worlds.length === 0) {
    wbList.innerHTML = ''
    return
  }
  wbList.innerHTML = ''
  for (const w of worlds) {
    const item = document.createElement('div')
    item.className = 'wb-item'

    const info = document.createElement('div')
    info.className = 'wb-info'
    info.innerHTML = `<div class="wb-name">${escHtml(w.name || w.slug)}</div>` +
      `<div class="wb-meta">${escHtml(w.slug)} · ${formatTime(w.updated_at)}</div>`
    item.appendChild(info)

    // V6: visibility toggle switch
    const isPublic = w.visibility === 'public'
    const isCommons = w.isCommons === true
    const toggleLabel = document.createElement('label')
    toggleLabel.className = 'wb-vis-toggle'
    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.setAttribute('role', 'switch')
    toggle.checked = isPublic
    const toggleText = document.createTextNode(' ' + (isPublic ? 'Public' : 'Private'))
    toggleLabel.appendChild(toggle)
    toggleLabel.appendChild(toggleText)
    if (isCommons) {
      toggle.disabled = true
      toggleLabel.title = 'The commons is always public'
    }
    toggle.addEventListener('change', async () => {
      toggle.disabled = true
      const newVis = toggle.checked ? 'public' : 'private'
      try {
        const res = await fetch(`/api/worlds/${w.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility: newVis }),
        })
        if (res.ok) {
          const data = await res.json()
          // Update in-place instead of refreshWorldList()
          toggle.checked = data.visibility === 'public'
          toggleText.textContent = ' ' + (data.visibility === 'public' ? 'Public' : 'Private')
          const metaEl = info.querySelector('.wb-meta')
          if (metaEl) {
            metaEl.textContent = `${data.slug || w.slug} · ${formatTime(data.updated_at || w.updated_at)}`
          }
          wbError.textContent = ''
          return
        }
        // Failure: restore and show error
        toggle.checked = !toggle.checked
        const data = await res.json().catch(() => ({}))
        wbError.textContent = data.error || "Couldn't change visibility"
        if (res.status === 401) {
          setAuthState(null)
        }
      } catch {
        toggle.checked = !toggle.checked
        wbError.textContent = "Couldn't change visibility"
      } finally {
        toggle.disabled = isCommons
      }
    })
    item.appendChild(toggleLabel)

    const itemLoadBtn = document.createElement('button')
    itemLoadBtn.textContent = 'Load'
    // Load works whether or not connected (pre-brief decision)
    itemLoadBtn.disabled = false
    itemLoadBtn.title = 'Load this world'
    itemLoadBtn.addEventListener('click', async () => {
      itemLoadBtn.disabled = true
      try {
        // Hide failure panel at start of user-initiated Load
        hideTeleportFailurePanel()
        // Perform a real WS connect via buildWorldWsUrl (pre-brief #1/#3, F1 fix)
        if (!currentUser) {
          wbError.textContent = 'Not logged in'
          refreshWorldList()
          return
        }
        const wsUrl = buildWorldWsUrl(
          accountWsBase || computeWsUrl(window.location),
          currentUser.username,
          w.slug
        )
        if (!wsUrl) {
          wbError.textContent = 'Invalid world identifier or missing username'
          refreshWorldList()
          return
        }
        showOverlay('Connecting to world…')
        try {
          const outcome = await trackConnect(wsUrl, {
            avatar: buildAvatarDescriptor(),
            displayName: currentUser.displayName || currentUser.username,
          }, {
            onError: (msg, err) => {
              // V8: use code-specific wording when available
              const loadCode = err?.code || null
              const reason = codeToReason(loadCode)
              wbError.textContent = 'Load failed: ' + (reason || msg)
            },
          })
          if (outcome.status === 'superseded') {
            // Superseded — a newer connect took over; do nothing
            return
          }
        } catch {
          refreshWorldList()
          showOverlay('')
          itemLoadBtn.disabled = false
          return
        }
        showOverlay('')
      } catch (err) {
        wbError.textContent = 'Load failed: ' + err.message
      } finally {
        itemLoadBtn.disabled = false
      }
    })
    item.appendChild(itemLoadBtn)

    const delBtn = document.createElement('button')
    delBtn.textContent = 'Delete'
    delBtn.className = 'danger'
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${w.name || w.slug}"?`)) return
      delBtn.disabled = true
      try {
        const res = await fetch(`/api/worlds/${w.id}`, { method: 'DELETE' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          wbError.textContent = data.error || 'Delete failed'
        }
        refreshWorldList()
      } catch (err) {
        wbError.textContent = 'Delete failed: ' + err.message
      } finally {
        delBtn.disabled = false
      }
    })
    item.appendChild(delBtn)

    wbList.appendChild(item)
  }
}

function escHtml(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString()
}

// ---------------------------------------------------------------------------
// Third-person camera constants (passed to Stage and used for V-key toggle)
// ---------------------------------------------------------------------------

const CAMERA_OFFSET_Y = 2.0
const CAMERA_OFFSET_Z = 4.0

// ---------------------------------------------------------------------------
// Client + Stage
// ---------------------------------------------------------------------------

const client = new AtriumClient({ debug: false })
window.atriumClient = client   // expose for manual console testing

const stage = new Stage(viewportEl, {
  client,
  cameraOffsetY:   CAMERA_OFFSET_Y,
  cameraOffsetZ:   CAMERA_OFFSET_Z,
  backgroundColor: 0x1a1a2e,
  cameraPosition:  [0, 1.6, 4],
})
const { renderer, nav, animCtrl, scene: threeScene } = stage
const avatar = stage.avatar
const canvas  = renderer.domElement
// Firefox can start a native drag of a <canvas> as an image (seen once Edit
// mode's TransformControls had pointer capture): the viewport's drop outline
// appears and look-drags stop. The canvas is never something to drag.
canvas.draggable = false
canvas.addEventListener('dragstart', (e) => e.preventDefault())
window.stage = stage

// ---------------------------------------------------------------------------
// Navigation / camera mode state
// ---------------------------------------------------------------------------

// Pointer lock (M key) lives in `modes` (edit-modes.js): off while editing.
let firstPerson    = false   // default: third-person when connected; V key toggles

// ---------------------------------------------------------------------------
// Peer label overlay
// ---------------------------------------------------------------------------

const labels = new LabelOverlay(viewportEl, () => stage.camera)

// Teleporter trigger (T4)
let currentWorldUrl = null
let avatarReady = false
let readySessionId = null // V8: tracks the session id that reached session:ready for eviction listener

function derivePads() {
  if (!client.som) return []
  const result = []
  for (const node of client.som.nodes) {
    if (isTeleporter(node)) {
      result.push({
        name: node.name,
        // B7/G13 — world position, so a pad inside a moved group follows it.
        position: worldPosition(node),
        destination: teleporterDestination(node),
      })
    }
  }
  return result
}

const trigger = createTeleportTrigger({
  onTrigger: ({ name, destination, worldUrl }) => {
    // Capture current world URL before connecting
    const prevWorldUrl = currentWorldUrl
    const connectOpts = { avatar: buildAvatarDescriptor() }
    // T7: only send displayName when same origin as account
    if (sameOriginAsAccount(worldUrl, accountWsBase)) {
      connectOpts.displayName = client.displayName
    }
    // Show connecting overlay
    showOverlay('Connecting to world…')
    trackConnect(worldUrl, connectOpts, {
      onError: (msg, err) => {
              // V8: pass code to teleportFailureMessage for specific reason
              const code = err?.code || null
              showTeleportFailurePanel(teleportFailureMessage(worldUrl, {}, code), { showGoBack: !!prevWorldUrl })
              // Wire Go back — only if a previous world exists
              if (!prevWorldUrl) return
              const panelGoBack = document.getElementById('tp-fail-goback')
              if (panelGoBack) {
                panelGoBack.addEventListener('click', function goBackHandler() {
                  panelGoBack.removeEventListener('click', goBackHandler)
                  hideTeleportFailurePanel()
                  showOverlay('Connecting to previous world\u2026')
                  const goBackOpts = { avatar: buildAvatarDescriptor() }
                  if (sameOriginAsAccount(prevWorldUrl, accountWsBase)) {
                    goBackOpts.displayName = client.displayName
                  }
                  trackConnect(prevWorldUrl, goBackOpts, {
                    onError: (msg2, err2) => {
                      // No second Go back — Dismiss only
                      const code2 = err2?.code || null
                      showTeleportFailurePanel(teleportFailureMessage(prevWorldUrl, { returning: true }, code2), { showGoBack: false })
                    },
                  }).then((outcome2) => {
                    if (outcome2.status === 'superseded') return
                    hideTeleportFailurePanel()
                    showOverlay('')
                  }).catch(() => {})
                })
              }
            },
    }).then((outcome) => {
      if (outcome.status === 'superseded') return
      hideTeleportFailurePanel()
      showOverlay('')
    }).catch(() => {
      // Error already displayed via onError
    })
  },
  resolveDestination: (destination) => {
    return resolveWorldAddress(destination, currentWorldUrl)
  },
})

// B1/E6 — one place decides whether teleport triggers are active: only when no
// editing mode (Edit, teleporter place, teleporter delete) is on. Handlers
// change modes through `modes`; none of them call trigger.setActive directly.
const modes = createEditModes({ setTriggerActive: (active) => trigger.setActive(active) })

// The pad label keys currently on screen. rebuildPads() removes exactly these,
// rather than matching a 'teleporter-' prefix, so a renamed pad's label goes too
// (see pad-labels.js). teardownWorld() resets it along with the labels.
let padLabelNames = new Set()

function rebuildPads() {
  const newPads = derivePads()
  trigger.setPads(newPads)
  // Update pad labels (T13)
  padLabelNames = syncPadLabels(labels, padLabelNames, newPads, (pad) => ({
    text: '\u21B3 ' + teleporterLabel(pad.destination, currentWorldUrl),
    target: { name: pad.name, translation: pad.position },
    options: { heightOffset: 1.2, className: 'pad-label' },
  }))
}

function onResize() {
  stage.resize(viewportEl.clientWidth, viewportEl.clientHeight)
}
window.addEventListener('resize', onResize)
onResize()

// ---------------------------------------------------------------------------
// DocumentView / animation state
// ---------------------------------------------------------------------------

let docView    = null
let sceneGroup = null

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function updateHud() {
  hudPeersEl.textContent = client.connected
    ? `Peers: ${avatar.peerCount}`
    : ''
  hudYouEl.textContent = client.connected && client.displayName
    ? `You: ${client.displayName}`
    : ''
}

function updateHintText() {
  const activeCam = nav.activeCamera
  const camSuffix = activeCam ? ` · 🎥 ${activeCam.name}` : ''

  if (nav.mode === 'ORBIT') {
    hudHintEl.textContent = `Drag to orbit · Scroll to zoom${camSuffix}`
    return
  }

  if (modes.edit) {
    hudHintEl.textContent = `Edit mode · Click to select · Alt-click selects a part · Esc to deselect · Drag to look · WASD to move${camSuffix}`
    return
  }

  const hasAvatar   = !!avatar.localNode
  const mouseMode   = modes.usePointerLock ? 'Click to look' : 'Drag to look'
  const mouseToggle = modes.usePointerLock ? '[M] drag mode'  : '[M] mouse lock'

  if (hasAvatar) {
    const cameraToggle = firstPerson ? '[V] third person' : '[V] first person'
    hudHintEl.textContent = `${mouseMode} · WASD to move · ${mouseToggle} · ${cameraToggle}${camSuffix}`
  } else {
    hudHintEl.textContent = `${mouseMode} · WASD to move · ${mouseToggle}${camSuffix}`
  }
}

// ---------------------------------------------------------------------------
// Connection state UI
// ---------------------------------------------------------------------------

function setConnectionState(state) {
  statusDot.className = 'status-dot ' + state

  if (state === 'connecting') {
    connectBtn.textContent = 'Connecting...'
    connectBtn.disabled    = true
  } else if (state === 'connected') {
    connectBtn.textContent = 'Disconnect'
    connectBtn.disabled    = false
  } else {
    // disconnected or error
    connectBtn.textContent = 'Connect'
    connectBtn.disabled    = false
    // Re-enable Load button — it was disabled while connected
    loadBtn.disabled = false
    loadBtn.title = 'Load a static file'
  }

  // Update Load button state based on connection status
  loadBtn.disabled = (state === 'connected')
  loadBtn.title = (state === 'connected')
    ? 'Disconnect to open a local file'
    : 'Load a static file'

  updateHud()
}

// ---------------------------------------------------------------------------
// Home world auto-connect helpers
// ---------------------------------------------------------------------------

function homeWorldWsUrl(username) {
  return buildWorldWsUrl(accountWsBase, username, 'home')
}

function autoConnectToHomeWorld(user) {
  // Builds the canonical /worlds/<username>/home URL from accountWsBase
  // (pre-brief #2/#5), regardless of any pathname in the connection box.
  // Auto-connect always targets the home world via buildWorldWsUrl; manual
  // Connect uses whatever URL the user entered in the box.
  // The server's /home/<uuid>/home route stays for compatibility.
  if (!user || !user.id) return
  if (client.connected) return

  if (!user.username) return
  const homeWsUrl = homeWorldWsUrl(user.username)
  if (!homeWsUrl) return

  setConnectionState('connecting')
  const avatarDesc = buildAvatarDescriptor()
  const connectOpts = { avatar: avatarDesc }
  connectOpts.displayName = user.displayName || user.username
  client.connect(homeWsUrl, connectOpts)
}

// ---------------------------------------------------------------------------
// Pointer input — PointerInputBridge
// ---------------------------------------------------------------------------

// Bridge constructed once; sceneRoot is a getter so it follows world reloads.
const pointerBridge = new PointerInputBridge({
  client,
  canvas,
  camera:            () => stage.camera,
  sceneRoot:         () => sceneGroup,
  suppressOnCapture: true,   // stop camera drag when a node has pointer capture
})

// ---------------------------------------------------------------------------
// Client event listeners
// ---------------------------------------------------------------------------

client.on('world:loaded', ({ name, description, author }) => {
  if (!client.som) return

  // Derive base URL for resolving relative texture paths from client.worldBaseUrl
  // (pre-brief #7) — always use the client's base, not the module-level worldUrlInput.
  const bgBaseUrl = client.worldBaseUrl || ''

  // Clear previous background/environment before loading new world
  threeScene.background = null
  threeScene.environment = null

  // B1 — the old sceneGroup (and anything attached to it) is about to go.
  endEditSession()

  ;({ docView, sceneGroup } = initDocumentView(renderer, threeScene, client.som, { prevDocView: docView, prevSceneGroup: sceneGroup }))
  stage.setSceneGroup(sceneGroup)

  loadBackground(threeScene, client.som.extras?.atrium?.background, bgBaseUrl)

  // HUD world line
  hudWorldEl.textContent = name ? `World: ${name}` : ''

  // Console metadata
  console.log(`[app] World: ${name ?? '(unnamed)'}${author ? ` by ${author}` : ''}`)
  if (description) console.log(`[app]   ${description}`)

  // ── Diagnostic pointer-event handlers (all non-ephemeral nodes) ──────────
  for (const node of client.som.nodes) {
    if (node.extras?.atrium?.ephemeral) continue   // skip avatars
    node.addEventListener('pointerover', () => console.log('[pointer] over',  node.name))
    node.addEventListener('pointerout',  () => console.log('[pointer] out',   node.name))
    node.addEventListener('pointerdown', (e) => console.log('[pointer] down', node.name, 'button', e.detail.button))
    node.addEventListener('pointerup',   () => console.log('[pointer] up',    node.name))
    node.addEventListener('click',       (e) => console.log('[pointer] click', node.name, 'at', e.detail.point))
  }

  // R2.2: rebuild pads after world finishes loading so pads saved in a world
  // trigger and show labels for joiners and after reload (session:ready fires
  // before som-dump, so the rebuild there sees no SOM).
  // In static (disconnected) mode, use accountWsBase as the current world URL.
  if (client.connected) {
    // Connected: use the WS URL from the input (session:ready hasn't fired yet
    // but the SOM is available now, so rebuild pads here)
    if (!currentWorldUrl) {
      currentWorldUrl = wsUrlInput.value.trim()
    }
    rebuildPads()
  } else {
    // Static mode: use accountWsBase so pad labels resolve correctly
    const savedUrl = currentWorldUrl
    currentWorldUrl = accountWsBase
    rebuildPads()
    currentWorldUrl = savedUrl
  }
})

client.on('session:ready', ({ sessionId, displayName, url: connectUrl } = {}) => {
  setConnectionState('connected')
  updateHintText()
  // Hide failure panel on successful session
  hideTeleportFailurePanel()
  // V8: track ready session id for eviction listener
  readySessionId = sessionId
  // Sync the connection box with the actual connection URL (pre-brief decision:
  // AtriumClient is source of truth for the connection URL)
  if (connectUrl) {
    wsUrlInput.value = connectUrl
  }
  // Capture current world URL for teleporter resolution (T4)
  currentWorldUrl = connectUrl || wsUrlInput.value
  // Rebuild pads on session ready (world loaded before session:ready)
  rebuildPads()
})

// ---------------------------------------------------------------------------
// Shared world-teardown (pre-brief #9, DEV FINDING 1)
// ---------------------------------------------------------------------------

function teardownWorld() {
  labels.clear()
  padLabelNames = new Set()
  firstPerson = false   // reset to third-person for next session
  updateHud()
  updateHintText()
}

client.on('connecting', () => {
  endEditSession()
  teardownWorld()
  setConnectionState('connecting')
  // Clear teleporter state (T4)
  avatarReady = false
  readySessionId = null // V8: clear ready session on new connect
  currentWorldUrl = null
  trigger.setReady(false)
  trigger.reset()
  // Reset teleporter UI (closes form, abandons pendings, guarded overlay)
  resetTeleporterUi()
  // Hide failure panel (connecting covers teleport/Go back retry)
  hideTeleportFailurePanel()
})

client.on('disconnected', () => {
  endEditSession()
  teardownWorld()
  setConnectionState('disconnected')
  // Reset teleporter UI (abandons pendings, closes form, guarded overlay)
  resetTeleporterUi()

  // Reload the world in static mode — clears avatar/peer nodes from the scene
  // and restores NavigationController's localNode for input to work again.
  const url = worldUrlInput.value.trim()
  if (url) client.loadWorld(url)
})

client.on('error', (err) => {
  console.error(`[app] client error: connected=${client.connected} message="${err.message}"`, err)
  // V8: eviction listener — WORLD_NOW_PRIVATE after session:ready shows panel
  if (err.code === 'WORLD_NOW_PRIVATE' && err.sessionId === readySessionId) {
    showTeleportFailurePanel(
      evictionMessage(err.url),
      { showGoBack: false }
    )
  }
})

// ---------------------------------------------------------------------------
// Avatar controller event listeners
// ---------------------------------------------------------------------------

avatar.on('avatar:local-ready', () => {
  updateHud()
  updateHintText()
  // Teleporter trigger: set ready when local avatar is ready (T4)
  avatarReady = true
  trigger.setReady(true)
  updateTeleporterControls()
})

avatar.on('avatar:peer-added', ({ displayName, nodeName, node }) => {
  console.log(`[app] Peer joined: ${displayName} (${avatar.peerCount} peer${avatar.peerCount === 1 ? '' : 's'})`)
  labels.addLabel(nodeName, displayName, node)
  updateHud()
})

avatar.on('avatar:peer-removed', ({ displayName, nodeName }) => {
  console.log(`[app] Peer left: ${displayName} (${avatar.peerCount} peer${avatar.peerCount === 1 ? '' : 's'})`)
  labels.removeLabel(nodeName)
  updateHud()
})

// Live property updates on the selected node, and world-info panel for document extras
client.on('som:set', ({ nodeName, path }) => {
  if (!client.som) return
  if (nodeName === '__document__') {
    loadBackground(threeScene, client.som.extras?.atrium?.background, client.worldBaseUrl)
    return
  }
  // Rebuild pads if a teleporter node was modified (T4), or a transform of a
  // node holding one (B7: a moved group moves its pads' zones)
  const node = nodeName ? client.som.getNodeByName(nodeName) : null
  if (node) {
    // U16 — another session's change reaches the gesture tracker, so a revert
    // puts back the server's value, never an older one. Edit mode on or off.
    if (TRANSFORM_FIELDS.includes(path)) editTracker.remoteSet(node, path, [...node[path]])
    if (isTeleporter(node) || (TRANSFORM_FIELDS.includes(path) && subtreeSome(node, isTeleporter))) {
      rebuildPads()
    }
    if (node === selected) refreshEditPanel()
  }
  // Y2 — a delete's capture is redone on every remote change until its removal
  undo.reCapture()
})

// Teleporter pad tracking (T4): rebuild pads on add/remove/set of teleporter nodes
client.on('som:add', ({ nodeName }) => {
  if (!client.som) return
  if (nodeName) {
    const node = client.som.getNodeByName(nodeName)
    if (node && isTeleporter(node)) {
      rebuildPads()
    }
  }
  undo.reCapture()                     // Y2 — a remote add re-captures a pending delete
})

client.on('som:remove', ({ nodeName }) => {
  if (!client.som) return
  // Rebuild pads on any remove — we check isTeleporter below by looking
  // at the current SOM (the node is already removed, but we just rebuild
  // from what's left)
  if (nodeName) {
    // Always rebuild — removes are infrequent and it's simpler than tracking
    // which removed node was a teleporter
    rebuildPads()
  }
})

// A10 — a rename re-keys everything that is keyed by node name. rebuildPads()
// is the one that matters here: the som:set handler above re-resolves by the
// OLD name and misses the pad.
client.on('som:rename', () => {
  if (!client.som) return
  rebuildPads()
  undo.reCapture()                     // Y2 — a remote rename re-captures a pending delete
})

// A7/C7 — the client missed state: an `add` named a parent this client does
// not have. Reconnect to the same world through trackConnect (as Go Back
// does), which brings a fresh som-dump.
client.on('som:desync', ({ reason, node, parent }) => {
  console.warn(`[app] som:desync (${reason}) — "${node}" under missing parent "${parent}"; resyncing`)
  const url = currentWorldUrl
  if (!url) return
  const connectOpts = { avatar: buildAvatarDescriptor() }
  if (sameOriginAsAccount(url, accountWsBase)) {
    connectOpts.displayName = client.displayName
  }
  trackConnect(url, connectOpts, {
    onError: (msg) => {
      console.warn(`[app] som:desync resync failed: ${msg}`)
    },
  }).then((outcome) => {
    if (outcome.status !== 'superseded') rebuildPads()
  }).catch(() => {})
})

// ---------------------------------------------------------------------------
// .atrium.json config loading
// ---------------------------------------------------------------------------

async function loadAtriumConfig(config, baseUrl) {
  if (!config?.world) {
    console.warn('.atrium.json: missing "world" key')
    return null
  }

  const gltfUrl = config.world.gltf
    ? (baseUrl ? new URL(config.world.gltf, baseUrl).href : null)
    : null

  let userMessage = null

  if (gltfUrl) {
    await client.loadWorld(gltfUrl)
    worldUrlInput.value = gltfUrl
  } else if (config.world.gltf) {
    console.warn('.atrium.json dropped locally — cannot resolve relative glTF path')
    userMessage = 'Loaded server URL from config. Drop the .gltf file directly to load the world.'
  }

  if (config.world.server) {
    wsUrlInput.value = config.world.server
  }

  return userMessage
}

// ---------------------------------------------------------------------------
// Drag-and-drop file loading
// ---------------------------------------------------------------------------

async function loadDroppedFile(file) {
  const name = file.name.toLowerCase()

  if (name.endsWith('.atrium.json') || name.endsWith('.json')) {
    const text = await file.text()
    let config
    try { config = JSON.parse(text) } catch {
      console.warn(`Invalid JSON in dropped file: ${file.name}`)
      return
    }
    return await loadAtriumConfig(config, null)
  }

  if (name.endsWith('.glb')) {
    const buffer = await file.arrayBuffer()
    await client.loadWorldFromData(buffer, file.name)
    return
  }

  if (name.endsWith('.gltf')) {
    const text = await file.text()
    await client.loadWorldFromData(text, file.name)
    return
  }

  console.warn(`Unsupported file type: ${file.name}`)
}

viewportEl.addEventListener('dragover', (e) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  viewportEl.classList.add('drag-over')
})

viewportEl.addEventListener('dragleave', () => {
  viewportEl.classList.remove('drag-over')
})

viewportEl.addEventListener('drop', async (e) => {
  e.preventDefault()
  viewportEl.classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (!file) return
  // Reject drops while connected (pre-brief #15)
  if (client.connected) {
    showOverlay('Disconnect to open a local file')
    return
  }
  overlayEl.textContent = 'Loading…'
  try {
    const msg = await loadDroppedFile(file)
    overlayEl.textContent = msg ?? ''
  } catch (err) {
    overlayEl.textContent = 'Load failed: ' + err.message
    console.error(err)
  }
})

// ---------------------------------------------------------------------------
// WebSocket connect helper — trackConnect (pre-brief #5)
// ---------------------------------------------------------------------------

/**
 * Connect to a world and track the outcome with lifecycle events.
 * The caller provides a render callback for error display, so Load
 * can show errors via wbError and Connect can use the overlay.
 *
 * @param {string} wsUrl — WebSocket URL to connect to
 * @param {object} connectOpts — options passed to client.connect()
 * @param {object} ui — UI callbacks
 * @param {(msg: string, err?: object) => void} ui.onError — render error (V8: second arg is the error object)
 * @returns {Promise<{status: string, data?: object}>} resolves on
 *   session:ready ({status:'ready', data}) or superseded
 *   ({status:'superseded'}), rejects on error/disconnect
 */
function trackConnect(wsUrl, connectOpts, { onError } = {}) {
  return new Promise((resolve, reject) => {
    const sid = client.connect(wsUrl, connectOpts)
    if (!sid) {
      reject(new Error('Connect failed to return a session ID'))
      return
    }

    let settled = false

    const onReady = (data) => {
      if (data.sessionId !== sid) return
      cleanup()
      settle(true, { status: 'ready', data })
    }
    const onErr = (err) => {
      if (err.sessionId !== sid) return
      cleanup()
      settle(false, err)
    }
    const onDisco = (d) => {
      if (d.sessionId !== sid) return
      cleanup()
      settle(false, new Error(d.reason || 'Disconnected'))
    }
    // A connecting event with previousSessionId === sid means superseded
    const onConnecting = (d) => {
      if (d.previousSessionId === sid) {
        cleanup()
        // Superseded — no error shown, the new connect handles it
        settle(true, { status: 'superseded' })
      }
    }

    function cleanup() {
      settled = true
      client.off('session:ready', onReady)
      client.off('error', onErr)
      client.off('disconnected', onDisco)
      client.off('connecting', onConnecting)
    }

    function settle(ok, value) {
      if (!ok) {
        // V8: pass the error object as second argument so callers can read err.code
        if (typeof onError === 'function') onError(value.message || 'Connection failed', value)
        reject(value)
      } else {
        resolve(value)
      }
    }

    client.on('session:ready', onReady)
    client.on('error', onErr)
    client.on('disconnected', onDisco)
    client.on('connecting', onConnecting)
  })
}

// ---------------------------------------------------------------------------
// Overlay feedback
// ---------------------------------------------------------------------------

function showOverlay(msg) {
  teleporterOverlayActive = false
  overlayEl.textContent = msg || ''
}

// ---------------------------------------------------------------------------
// UI actions
// ---------------------------------------------------------------------------

loadBtn.addEventListener('click', async () => {
  const url = worldUrlInput.value.trim()
  if (!url) return
  loadBtn.disabled = true

  // Load works whether or not connected (pre-brief decision).
  try {
    // Hide failure panel at start of user-initiated Load
    hideTeleportFailurePanel()
    // While connected, Load opens no new content — use Connect or Disconnect.
    if (client.connected) {
      // #7: no WS world URL while connected branch; Load works only
      // when disconnected. While connected, use Connect or Disconnect.
      showOverlay('Disconnect to open a file or connect to a new world')
    } else {
      showOverlay('Loading…')
      if (url.endsWith('.json')) {
        const configUrl = new URL(url, window.location.href).href
        const resp = await fetch(configUrl)
        const config = await resp.json()
        const msg = await loadAtriumConfig(config, configUrl)
        showOverlay(msg ?? '')
      } else {
        const absoluteUrl = new URL(url, window.location.href).href
        await client.loadWorld(absoluteUrl)
        showOverlay('')
      }
    }
  } catch (err) {
    showOverlay('Load failed: ' + err.message)
    console.error(err)
  } finally {
    loadBtn.disabled = false
  }
})

// ---------------------------------------------------------------------------
// WebSocket connect/Disconnect — uses trackConnect for outcome visibility (#5)
// ---------------------------------------------------------------------------

function handleConnect() {
  if (client.connected) {
    client.disconnect()
    return
  }
  // Hide failure panel at start of user-initiated Connect
  hideTeleportFailurePanel()
  const wsUrl = wsUrlInput.value.trim()
  if (!wsUrl) return
  setConnectionState('connecting')
  const worldUrl = worldUrlInput.value.trim()
  const connectOpts = { avatar: buildAvatarDescriptor() }

  // Apply File box base only when HTTP origins match (#1)
  if (worldUrl && shouldUseFileBase(worldUrl, wsUrl)) {
    connectOpts.worldBaseUrl = new URL(worldUrl, window.location.href).href
  }
  // T7: only send displayName when the destination is the same origin as the account server
  if (currentUser && sameOriginAsAccount(wsUrl, accountWsBase)) {
    connectOpts.displayName = currentUser.displayName || currentUser.username
  }

  showOverlay('Connecting to world…')
  trackConnect(wsUrl, connectOpts, {
    onError: (msg, err) => {
      // V8: use code-specific wording when available
      const connectCode = err?.code || null
      const reason = codeToReason(connectCode)
      if (reason) {
        const dest = formatDestination(
          new URL(wsUrl).host,
          new URL(wsUrl).pathname || '/'
        )
        showOverlay(`Connect failed: Couldn't open ${dest}. ${reason}`)
      } else {
        showOverlay('Connect failed: ' + msg)
      }
    },
  }).then((outcome) => {
    if (outcome.status === 'superseded') {
      // Superseded — a newer connect took over; do nothing
      return
    }
    showOverlay('')
  }).catch(() => {
    // Error already displayed via onError
  })
}

// Dev right-click Connect bypasses Load
connectBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  handleConnect()
})

connectBtn.addEventListener('click', handleConnect)

// ---------------------------------------------------------------------------
// Teleporter UI reset — called from both 'connecting' and 'disconnected'
// ---------------------------------------------------------------------------

function resetTeleporterUi() {
  const isActive = modes.placement || modes.delete || tpForm.style.display !== 'none' ||
    pendingSeq != null || pendingDeleteSeq != null

  if (isActive) {
    // Abandon pending save/delete
    pendingSeq = null
    pendingName = null
    pendingDeleteSeq = null
    deleteTargetName = null
    pendingPosition = null
    // Close form and mode (triggers follow from the modes, B1)
    modes.setTeleporterMode(null)
    tpForm.style.display = 'none'
    tpCancelBtn.style.display = 'none'
    tpPlaceBtn.style.display = ''
    tpDeleteBtn.style.display = ''
    viewportEl.style.cursor = ''
    // Restore Save button and re-enable cancels
    tpSaveBtn.textContent = 'Save'
    tpSaveBtn.disabled = true
    tpFormCancel.disabled = false
    tpCancelBtn.disabled = false
    // Only clear overlay if teleporter owns it
    if (teleporterOverlayActive) {
      showTeleporterOverlay('')
    }
  }
  updateTeleporterControls()
}

// ---------------------------------------------------------------------------
// Teleporter placement and delete UI (T5)
// ---------------------------------------------------------------------------

const tpPlaceBtn = document.getElementById('tp-place-btn')
const tpDeleteBtn = document.getElementById('tp-delete-btn')
const tpCancelBtn = document.getElementById('tp-cancel-btn')
const tpForm = document.getElementById('tp-form')
const tpWorldSelect = document.getElementById('tp-world-select')
const tpDestInput = document.getElementById('tp-dest-input')
const tpSpawnWarn = document.getElementById('tp-spawn-warn')
const tpFormError = document.getElementById('tp-form-error')
const tpSaveBtn = document.getElementById('tp-save-btn')
const tpFormCancel = document.getElementById('tp-form-cancel')

// placementMode / deleteMode live in `modes` (edit-modes.js), B1.
let pendingPosition = null
let pendingName = null
let pendingSeq = null
let deleteTargetName = null
let pendingDeleteSeq = null

// Overlay ownership flag (operator correction #3):
// Teleporter-originated messages go through showTeleporterOverlay, which sets
// this flag. Any other showOverlay call clears it. resetTeleporterUi() only
// clears the overlay when this flag is true.
let teleporterOverlayActive = false

function showTeleporterOverlay(msg) {
  teleporterOverlayActive = true
  overlayEl.textContent = msg || ''
}

// Teleporter failure panel — stub for U1, fleshed out in U2.
// Called from connecting, session:ready, Escape handler before the panel DOM exists.
function hideTeleportFailurePanel() {
  const panel = document.getElementById('tp-fail-panel')
  if (panel) panel.style.display = 'none'
}

function showTeleportFailurePanel(msg, { showGoBack = true } = {}) {
  const panel = document.getElementById('tp-fail-panel')
  if (!panel) return
  const msgEl = document.getElementById('tp-fail-msg')
  if (msgEl) msgEl.textContent = msg
  const goBackBtn = document.getElementById('tp-fail-goback')
  if (goBackBtn) {
    // Clone-and-replace to kill stale listeners (same pattern as Dismiss)
    const newGoBack = goBackBtn.cloneNode(true)
    goBackBtn.parentNode.replaceChild(newGoBack, goBackBtn)
    newGoBack.style.display = showGoBack ? '' : 'none'
  }
  const dismissBtn = document.getElementById('tp-fail-dismiss')
  if (dismissBtn) {
    // Replace with clone to kill stale listeners, then attach fresh one
    const newDismiss = dismissBtn.cloneNode(true)
    dismissBtn.parentNode.replaceChild(newDismiss, dismissBtn)
    newDismiss.addEventListener('click', hideTeleportFailurePanel)
  }
  panel.style.display = ''
  // Clear overlay when panel shows
  showOverlay('')
}

function updateTeleporterControls() {
  const allowed = canEditNow()
  // While Edit mode is on, the teleporter modes are unavailable (E6)
  tpPlaceBtn.disabled = !allowed || modes.placement || modes.edit
  tpDeleteBtn.disabled = !allowed || modes.delete || modes.edit
  if (!allowed && (modes.placement || modes.delete)) {
    exitTeleporterMode()
  }
  updateEditControls()
}

// One capability gate for teleporters and Edit mode (A1: canEdit replaces
// canPlaceTeleporters, which stays on the wire for one release).
function canEditNow() {
  return client.canEdit && avatarReady && client.connected
}

// Wire teleporter control updates into avatar:local-ready (already has a handler)
// We extend the existing handler below — updateTeleporterControls is called there

function exitTeleporterMode() {
  modes.setTeleporterMode(null)
  pendingPosition = null
  pendingName = null
  pendingSeq = null
  deleteTargetName = null
  pendingDeleteSeq = null
  tpForm.style.display = 'none'
  tpCancelBtn.style.display = 'none'
  tpPlaceBtn.style.display = ''
  tpDeleteBtn.style.display = ''
  viewportEl.style.cursor = ''
  // Restore Save button and re-enable both Cancels
  tpSaveBtn.textContent = 'Save'
  tpSaveBtn.disabled = true
  tpFormCancel.disabled = false
  tpCancelBtn.disabled = false
  // Only clear overlay if teleporter owns it
  if (teleporterOverlayActive) {
    showTeleporterOverlay('')
  }
  updateTeleporterControls()
}

tpCancelBtn.addEventListener('click', exitTeleporterMode)

// Escape key exits teleporter modes, hides failure panel
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // If teleporter failure panel is visible, hide it
    const failPanel = document.getElementById('tp-fail-panel')
    if (failPanel && failPanel.style.display !== 'none') {
      hideTeleportFailurePanel()
      return
    }
    // Ignore Escape while a save is pending
    if (pendingSeq != null) return
    if (modes.placement || modes.delete || tpForm.style.display !== 'none') {
      exitTeleporterMode()
      return
    }
    // Edit mode (B2): first Escape deselects, a second leaves Edit mode.
    // An Escape inside a panel field never gets here (B5).
    // Escape typed in another text field (sign-in, world browser) is theirs.
    if (modes.edit && !e.target.closest?.('input, textarea, select')) {
      if (selected) selectForEdit(null)
      else setEditMode(false)
    }
  }
})

// ── Placement mode ──────────────────────────────────────────────────────

tpPlaceBtn.addEventListener('click', () => {
  if (!canEditNow()) return
  if (!modes.setTeleporterMode('placement')) return
  tpCancelBtn.style.display = ''
  tpPlaceBtn.disabled = true
  tpDeleteBtn.style.display = 'none'
  viewportEl.style.cursor = 'crosshair'
  showTeleporterOverlay('Click in the viewport to place a teleporter pad')
})

// Handle viewport click in placement mode
viewportEl.addEventListener('click', (e) => {
  if (!modes.placement) return
  // Act only on canvas clicks — overlay/form/panel clicks pass through
  if (e.target !== canvas) return
  if (tpForm.style.display !== 'none') return

  const rect = viewportEl.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1
  const my = -((e.clientY - rect.top) / rect.height) * 2 + 1
  const camera = stage.camera
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(mx, my), camera)
  const ray = { origin: raycaster.ray.origin.toArray(), direction: raycaster.ray.direction.toArray() }
  const hit = projectRayToPlane(ray, 0)
  if (!hit) {
    showTeleporterOverlay('Could not find a valid placement spot')
    return
  }

  pendingPosition = [hit.x, 0, hit.z]
  showOverlay('')
  openPlacementForm()
})

function openPlacementForm() {
  // Populate world list — only when same origin as account server
  const accountHttp = AtriumClient.wsOriginToHttpOrigin(accountWsBase)
  const worldHttp = currentWorldUrl ? AtriumClient.wsOriginToHttpOrigin(currentWorldUrl) : null
  const sameOrigin = worldHttp && accountHttp && (() => {
    try { return new URL(worldHttp).origin === new URL(accountHttp).origin } catch { return false }
  })()

  if (sameOrigin) {
    tpWorldSelect.disabled = false
    tpWorldSelect.innerHTML = '<option value="">-- Select your world --</option>'
    // Add "The commons" option
    const opt = document.createElement('option')
    opt.value = '/'
    opt.textContent = 'The commons'
    tpWorldSelect.appendChild(opt)

    fetch('/api/worlds').then(res => {
      if (!res.ok) return null
      return res.json()
    }).then(worlds => {
      if (!worlds) return
      for (const w of worlds) {
        const opt = document.createElement('option')
        const username = currentUser?.username || ''
        opt.value = `/worlds/${encodeURIComponent(username)}/${encodeURIComponent(w.slug)}`
        opt.textContent = `${w.name || w.slug}${w.visibility === 'private' ? ' (private)' : ''}`
        tpWorldSelect.appendChild(opt)
      }
    }).catch(() => {})
  } else {
    tpWorldSelect.disabled = true
    tpWorldSelect.innerHTML = '<option value="">-- Manual entry only (different server) --</option>'
  }

  // Spawn warning
  if (pendingPosition && nearSpawn(pendingPosition)) {
    tpSpawnWarn.style.display = ''
  } else {
    tpSpawnWarn.style.display = 'none'
  }

  tpFormError.style.display = 'none'
  tpDestInput.value = ''
  tpSaveBtn.textContent = 'Save'
  tpSaveBtn.disabled = true
  tpFormCancel.disabled = false
  tpCancelBtn.disabled = false
  tpForm.style.display = ''
}

tpWorldSelect.addEventListener('change', () => {
  if (tpWorldSelect.value) {
    tpSaveBtn.disabled = false
    tpFormError.style.display = 'none'
  }
})

tpDestInput.addEventListener('input', () => {
  tpSaveBtn.disabled = !tpDestInput.value.trim()
  tpFormError.style.display = 'none'
})

tpSaveBtn.addEventListener('click', () => {
  const dest = tpWorldSelect.value || tpDestInput.value.trim()
  if (!dest) {
    tpFormError.textContent = 'Select a world or enter a destination'
    tpFormError.style.display = ''
    return
  }

  // R4: validate destination format before resolving
  if (!isValidDestination(dest)) {
    tpFormError.textContent = 'Invalid destination — enter a path (e.g. /worlds/user/slug) or ws(s) URL'
    tpFormError.style.display = ''
    return
  }

  const resolved = resolveWorldAddress(dest, currentWorldUrl)
  if (!resolved) {
    tpFormError.textContent = 'Invalid destination — enter a path (e.g. /worlds/user/slug) or ws(s) URL'
    tpFormError.style.display = ''
    return
  }

  tpSaveBtn.disabled = true
  tpFormCancel.disabled = true
  tpCancelBtn.disabled = true

  const name = 'teleporter-' + crypto.randomUUID()
  try {
    const descriptor = buildTeleporterDescriptor({
      name,
      position: pendingPosition,
      destination: dest.trim(),
    })
    pendingName = name
    pendingSeq = client.addNode(descriptor)
    updateEditControls()
    tpSaveBtn.textContent = 'Saving...'
  } catch (err) {
    tpFormError.textContent = 'Failed to place teleporter: ' + err.message
    tpFormError.style.display = ''
    tpSaveBtn.disabled = false
    tpSaveBtn.textContent = 'Save'
    tpFormCancel.disabled = false
    tpCancelBtn.disabled = false
  }
})

tpFormCancel.addEventListener('click', () => {
  exitTeleporterMode()
})

// Listen for som:add echo of our placement to close the form
client.on('som:add', ({ nodeName }) => {
  if (pendingName && nodeName === pendingName) {
    tpForm.style.display = 'none'
    pendingPosition = null
    pendingName = null
    pendingSeq = null
    tpSaveBtn.textContent = 'Save'
    exitTeleporterMode()
  }
})

// Listen for error carrying our seq (placement or delete)
client.on('error', (err) => {
  if (pendingSeq != null && err.seq === pendingSeq) {
    // Placement save error — clear pending, restore Save, re-enable cancels
    tpFormError.textContent = err.message || 'Failed to place teleporter'
    tpFormError.style.display = ''
    tpSaveBtn.disabled = false
    tpSaveBtn.textContent = 'Save'
    tpFormCancel.disabled = false
    tpCancelBtn.disabled = false
    pendingSeq = null
    pendingName = null
    updateEditControls()
  }
  if (pendingDeleteSeq != null && err.seq === pendingDeleteSeq) {
    // Delete error
    showTeleporterOverlay(`Couldn't delete teleporter: ${err.message || 'refused'}`)
    pendingDeleteSeq = null
    deleteTargetName = null
    updateEditControls()
  }
})

// ── Delete mode ─────────────────────────────────────────────────────────

tpDeleteBtn.addEventListener('click', () => {
  if (!canEditNow()) return
  if (!modes.setTeleporterMode('delete')) return
  tpCancelBtn.style.display = ''
  tpDeleteBtn.disabled = true
  tpPlaceBtn.style.display = 'none'
  viewportEl.style.cursor = 'pointer'
  showTeleporterOverlay('Click on a teleporter pad to delete it')
})

// Handle viewport click in delete mode — raycast to find teleporter
viewportEl.addEventListener('click', (e) => {
  if (!modes.delete) return
  // Act only on canvas clicks — overlay/form/panel clicks pass through
  if (e.target !== canvas) return

  const rect = viewportEl.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1
  const my = -((e.clientY - rect.top) / rect.height) * 2 + 1
  const camera = stage.camera
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(mx, my), camera)

  if (!sceneGroup) return
  const intersects = raycaster.intersectObjects(sceneGroup.children, true)
  if (intersects.length === 0) return

  // Walk up to find SOM node
  let somNode = null
  for (const hit of intersects) {
    let obj = hit.object
    while (obj) {
      if (obj.name && client.som) {
        const node = client.som.getNodeByName(obj.name)
        if (node) { somNode = node; break }
      }
      obj = obj.parent
    }
    if (somNode) break
  }

  if (!somNode || !isTeleporter(somNode)) return

  deleteTargetName = somNode.name
  const dest = teleporterDestination(somNode)
  const label = dest ? teleporterLabel(dest, currentWorldUrl) : 'unknown'
  if (!confirm(`Delete teleporter "${label}"?`)) {
    deleteTargetName = null
    return
  }

  try {
    pendingDeleteSeq = client.removeNode(somNode.name)
    updateEditControls()
    showTeleporterOverlay('Deleting teleporter...')
  } catch (err) {
    showTeleporterOverlay('Delete failed: ' + err.message)
    deleteTargetName = null
    pendingDeleteSeq = null
  }
})

// Listen for som:remove echo of our deletion
client.on('som:remove', ({ nodeName }) => {
  if (deleteTargetName && nodeName === deleteTargetName) {
    showOverlay('')
    deleteTargetName = null
    exitTeleporterMode()
  }
})

// ---------------------------------------------------------------------------
// Edit mode (Phase 3 step 1b-1) — devtasks/PREBRIEF-edit-mode-ui-1.md
//
// Owner-only: select a world node, move/rotate/scale it with handles, edit its
// transform and name in a panel. The logic that needs tests lives in pure
// modules (edit-modes, edit-gesture, edit-selection, rotation-degrees,
// world-position); this section wires them to the DOM, three.js and the client.
// ---------------------------------------------------------------------------

const editToggleBtn  = document.getElementById('edit-toggle-btn')
const editPanel      = document.getElementById('edit-panel')
const epModes        = document.getElementById('ep-modes')
const epSpaceBtn     = document.getElementById('ep-space')
const epSnapGrid     = document.getElementById('ep-snap-grid')
const epSnapAngle    = document.getElementById('ep-snap-angle')
const epSnapScale    = document.getElementById('ep-snap-scale')
const epEmpty        = document.getElementById('ep-empty')
const epFields       = document.getElementById('ep-fields')
const epName         = document.getElementById('ep-name')
const epNameStatus   = document.getElementById('ep-name-status')
const epError        = document.getElementById('ep-error')
const epVectorInputs = [...epFields.querySelectorAll('input[data-field]')]
const epPalette      = document.getElementById('ep-palette')        // 1b-2 N1
const epPaletteBtns  = [...epPalette.querySelectorAll('button[data-kind]')]
const epDuplicate    = document.getElementById('ep-duplicate')      // 1b-2 N3
const epDelete       = document.getElementById('ep-delete')         // 1b-2 N2
const epUndo         = document.getElementById('ep-undo')           // step 2, Y5
const epRedo         = document.getElementById('ep-redo')           // step 2, Y5
// R1 — Undo and Redo live in their own row (#ep-history) outside #ep-fields,
// so they stay visible with no selection; the ids and this wiring are unchanged.

let selected      = null   // the selected SOMNode, held by object (B2)
let selectedObj   = null   // its three.js object, owned by DocumentView
let gizmo         = null   // TransformControls (r163: an Object3D in the scene)
let outline       = null   // BoxHelper on selectedObj
let activeGesture = null   // the handle drag under way (B4)
let pressDown     = null   // { x, y, onHandle } at the last viewport mousedown
let pendingRename = null   // { seq, node } while a rename is unanswered

const editTracker = createEditTracker({
  read: (node, field) => node[field],
  // Local only: DocumentView renders it, nothing is sent (G2).
  writeLocal: (node, field, value) => client.applyLocally(() => { node[field] = value }),
  // Assigning outside applyLocally sends; lastSendSeq moves only if it did.
  writeSend: (node, field, value) => {
    const before = client.lastSendSeq
    node[field] = value
    return client.lastSendSeq !== before ? client.lastSendSeq : null
  },
  onMessage: (text) => showEditError(text),
  onReverted: (node) => {
    if (node === selected) refreshEditVectors()
    if (subtreeSome(node, isTeleporter)) rebuildPads()
  },
  // Y3 — one settle batch at a time: what the server accepted becomes an entry
  onTransformsSettled: (results, info) => {
    undo.onTransformsSettled(results, info)
    refreshEditActions()
  },
})

// 1b-2 N4 — the pending add, duplicate or delete (one at a time).
const structure = createStructureTracker()

// ---------------------------------------------------------------------------
// Undo and redo (Phase 3 step 2, Y1/Y4) — devtasks/PREBRIEF-undo-redo.md
//
// Every entry goes through a handle (W2) and every send is preceded by an
// identity-and-value check (W4, Y4). Recording does not depend on Edit mode
// (Y7); the stacks are cleared only when the edit session ends (W7).
// ---------------------------------------------------------------------------

/** One shared guard for every Edit-mode change's dispatch path (Y4). */
function editDispatchBlocked() {
  return editBlocked({ undoing: undo.inFlight(), pending: !!structure.pending })
}

const undo = createEditUndo({
  getNodeByName: (name) => client.som?.getNodeByName(name) ?? null,
  checkNewName: (name, node) => client.som?.checkNewName(name, node) ?? { ok: true },
  prepareRestore,                      // Y2's capture, straight from edit-duplicate
  // Y3 — an undo's or a redo's send is never recorded as a new edit
  sendTransform: (node, field, value) => editTracker.commit(node, field, value, { record: false }),
  // Y4 — a rename goes through the same pendingRename path as the name field.
  // R10 — a throw from the client is reported like `structural`'s and sends
  // nothing.
  rename: (node, from, to, direction) => {
    let seq
    try {
      seq = client.renameNode(from, to)
    } catch (err) {
      showEditError(`Couldn’t ${direction}: ${err.message}`)
      return null
    }
    pendingRename = { seq, node, direction }
    return seq
  },
  // Y4 — a remove or a re-add through the structure tracker, marked as ours
  structural: (request, direction) => {
    let seq
    try {
      seq = request.kind === 'delete'
        ? client.removeNode(request.name)
        : client.addNode(request.descriptor)
    } catch (err) {
      showEditError(`Couldn’t ${direction}: ${err.message}`)
      return null
    }
    structure.begin(request.kind, seq, {
      name: request.name,
      node: request.node ?? null,
      subtree: request.subtree ?? null,
      undo: direction,
    })
    return seq
  },
  // W10 (R5) — select what changed. A re-add selects the new node with the
  // same next-frame retry `selectAdded` uses (J6); a removal clears the
  // selection only when the removed node was the selected one; with Edit off
  // nothing is selected (Y7).
  select: ({ node, removed }) => {
    if (!modes.edit) return
    if (removed) {
      if (removed === selected) selectForEdit(null)
      return
    }
    if (node) selectAddedNode(node)
  },
  message: (text) => showEditError(text),
  isEditOn: () => modes.edit,
  isDragging: () => !!activeGesture || !!gizmo?.dragging,
  isRenamePending: () => !!pendingRename,
  hasPendingSend: () => editTracker.pendingCount > 0,
  hasPendingStructural: () => !!structure.pending || teleporterRequestPending(),
})

// E4 — the local avatar and peers' avatars are never selectable. The server
// refuses edits to live avatars anyway; this is for the UI.
function isEditExcluded(node) {
  return node === avatar.localNode || !!avatar.getPeerNode(node.name)
}

function updateEditControls() {
  const allowed = canEditNow()
  editToggleBtn.style.display = allowed ? '' : 'none'
  // Entering Edit mode closes the teleporter modes; don't let it abandon a
  // save or delete whose answer (or refusal message) is still to come.
  editToggleBtn.disabled = teleporterRequestPending()
  if (!allowed && modes.edit) setEditMode(false)
}

function teleporterRequestPending() {
  return pendingSeq != null || pendingDeleteSeq != null
}

function setEditMode(on) {
  if (on) {
    if (!canEditNow() || modes.edit || teleporterRequestPending()) return
    // E6 — Edit mode closes the teleporter modes; triggers follow from `modes`.
    if (modes.placement || modes.delete || tpForm.style.display !== 'none') exitTeleporterMode()
    modes.setEdit(true)
    if (document.pointerLockElement) document.exitPointerLock()
    ensureGizmo()
    syncGizmoEnabled()
    editPanel.style.display = ''
    editToggleBtn.classList.add('active')
  } else {
    if (!modes.edit) return
    selectForEdit(null)          // ends a drag with its final send
    // Y7 (Rev 2) — the structure tracker is NOT reset here: it holds 1b-2's
    // one-at-a-time rule and the S1 evidence, and a request answered while
    // Edit mode is off is handled as usual. Only the session end resets it.
    modes.setEdit(false)
    syncGizmoEnabled()
    editPanel.style.display = 'none'
    editToggleBtn.classList.remove('active')
  }
  clearEditError()
  refreshEditPanel()
  updateTeleporterControls()
  updateHintText()
}

// Connection lifecycle and world reloads (B1): Edit mode off, and every
// unanswered edit forgotten — the next som-dump is the truth. W7: this, and
// only this, clears the undo and redo stacks.
function endEditSession() {
  setEditMode(false)
  editTracker.reset()
  structure.reset()
  undo.endSession()
  pendingRename = null
}

editToggleBtn.addEventListener('click', () => setEditMode(!modes.edit))

// ── Handles (B3) ────────────────────────────────────────────────────────

// TransformControls captures the pointer on every press while enabled, even
// with nothing attached. Enable it only in Edit mode, with an object selected,
// and not while that object's rename is unanswered — nor while an undo or a
// redo is in flight or a structural request is pending (Y4, Rev 2 #3).
function syncGizmoEnabled() {
  if (!gizmo) return
  const renaming = !!pendingRename && pendingRename.node === selected
  gizmo.enabled = modes.edit && !!selectedObj && !renaming && !editDispatchBlocked()
}

function ensureGizmo() {
  if (gizmo) return
  gizmo = new TransformControls(stage.camera, canvas)
  gizmo.addEventListener('dragging-changed', (e) => onHandleDragging(e.value))
  gizmo.addEventListener('objectChange', onHandleChange)
  threeScene.add(gizmo)          // the scene, not sceneGroup (replaced on reload)
  applySnaps()
}

function onHandleDragging(isDragging) {
  if (isDragging) {
    // Y4 — no gesture begins while an undo or a redo is in flight or a
    // structural request is pending: the dispatch path, not just the button
    if (selected && !editDispatchBlocked()) activeGesture = editTracker.begin(selected)
  } else if (activeGesture) {
    activeGesture.end()
    activeGesture = null
  }
  refreshEditActions()
}

function onHandleChange() {
  if (!activeGesture || !selectedObj) return
  activeGesture.update({
    translation: selectedObj.position.toArray(),
    rotation:    selectedObj.quaternion.toArray(),
    scale:       selectedObj.scale.toArray(),
  })
  refreshEditVectors()
}

function applySnaps() {
  if (!gizmo) return
  gizmo.setTranslationSnap(epSnapGrid.checked ? 0.25 : null)
  gizmo.setRotationSnap(epSnapAngle.checked ? THREE.MathUtils.degToRad(15) : null)
  gizmo.setScaleSnap(epSnapScale.checked ? 0.1 : null)
}
for (const cb of [epSnapGrid, epSnapAngle, epSnapScale]) cb.addEventListener('change', applySnaps)

epModes.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]')
  if (!btn || !gizmo) return
  gizmo.setMode(btn.dataset.mode)
  for (const b of epModes.querySelectorAll('button[data-mode]')) b.classList.toggle('active', b === btn)
})

epSpaceBtn.addEventListener('click', () => {
  if (!gizmo) return
  const next = gizmo.space === 'world' ? 'local' : 'world'
  gizmo.setSpace(next)
  epSpaceBtn.textContent = next === 'world' ? 'World' : 'Local'
})

// Every frame: the handles follow the active camera (Space cycles cameras),
// and the outline follows the object.
function tickEditMode() {
  if (!modes.edit) return
  if (gizmo && gizmo.camera !== stage.camera) gizmo.camera = stage.camera
  if (outline) outline.update()
}

// ── Selection (B2) ──────────────────────────────────────────────────────

function selectForEdit(node) {
  if (node === selected) return
  if (activeGesture) { activeGesture.end(); activeGesture = null }
  selected = node
  attachSelected()
  clearEditError()
  refreshEditPanel()
}

// Look the selected node's three.js object up by name (G4), and put the
// handles and outline on it. Called again after a rename and a reload.
function attachSelected() {
  selectedObj = selected && sceneGroup ? findNodeObject(sceneGroup, selected.name) : null
  if (selected && !selectedObj) selected = null
  if (gizmo) {
    if (selectedObj) gizmo.attach(selectedObj)
    else gizmo.detach()
  }
  syncGizmoEnabled()
  if (outline) {
    threeScene.remove(outline)
    outline.geometry.dispose()
    outline.material.dispose()
    outline = null
  }
  if (selectedObj) {
    outline = new THREE.BoxHelper(selectedObj, 0xa78bfa)
    threeScene.add(outline)
  }
}

// The SOM node an Edit-mode click lands on, resolved per B2.
function pickEditTarget(e) {
  if (!sceneGroup || !client.som) return null
  const rect = viewportEl.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, stage.camera)
  // Each hit → the SOM node of the nearest node object above it. Mesh and
  // primitive objects are skipped: a mesh is often named like another node.
  const lookup = { getNodeByName: (n) => client.som.getNodeByName(n), isDuplicatedName }
  const hits = []
  for (const hit of raycaster.intersectObjects(sceneGroup.children, true)) {
    const node = nodeForHitObject(hit.object, lookup)
    if (node) hits.push(node)
  }
  return pickEditSelection(hits, {
    isSeeThrough: (node) => node === avatar.localNode,   // third person: it sits mid-view
    isExcluded: isEditExcluded,
    isDuplicatedName,
    resolveRoot: resolveSelectionRoot,
    descend: e.altKey,
  })
}

// E7 — a name shared by more than one glTF node. som.nodes can't show this:
// it is built from a name-keyed map, so duplicates collapse into one entry.
function isDuplicatedName(name) {
  const doc = client.som?.document
  if (!doc) return false
  let count = 0
  for (const n of doc.getRoot().listNodes()) {
    if (n.getName() === name && ++count > 1) return true
  }
  return false
}

// Capture phase, so the press is recorded before anything else handles it.
viewportEl.addEventListener('mousedown', (e) => {
  pressDown = { x: e.clientX, y: e.clientY, onHandle: !!gizmo?.dragging }
}, true)

viewportEl.addEventListener('click', (e) => {
  if (!modes.edit) return
  if (e.target !== canvas) return
  const down = pressDown
  pressDown = null
  // A look-drag, or a press on a handle, is not a selection.
  if (!isSelectClick(down, { x: e.clientX, y: e.clientY }, { gestureEnded: !!down?.onHandle })) return
  const { node, refused } = pickEditTarget(e) ?? { node: null, refused: null }
  selectForEdit(node)
  if (refused) showEditError(refused)
})

// ── Property panel (B5) ─────────────────────────────────────────────────

function fmt(v) {
  return String(Number(v.toFixed(3)))
}

function refreshEditPanel() {
  if (!selected) {
    epEmpty.style.display = ''
    epFields.style.display = 'none'
    refreshEditActions()
    return
  }
  epEmpty.style.display = 'none'
  epFields.style.display = ''
  refreshEditVectors()
  refreshNameField()
}

// Position, rotation (degrees) and scale. A field being typed in is left alone.
function refreshEditVectors() {
  if (!selected) return
  const values = {
    translation: selected.translation ?? [0, 0, 0],
    rotation:    quatToEulerDeg(selected.rotation ?? [0, 0, 0, 1]),
    scale:       selected.scale ?? [1, 1, 1],
  }
  for (const input of epVectorInputs) {
    if (document.activeElement === input) continue
    input.value = fmt(values[input.dataset.field][Number(input.dataset.i)])
    input.dataset.shown = input.value
  }
}

// Why the selected node's name can't be edited, or '' — the same rules the
// name field shows and the answers still decide.
function nameFieldProblem(node) {
  if (!node) return ''
  if (node.camera || node.light) {
    return 'Renaming a node with a camera or light is not supported yet'
  }
  if (isDuplicatedName(node.name)) {
    // E7 — until the server cleanup round fixes the name setter
    return 'Another node has the same name, so this one can’t be renamed yet'
  }
  return ''
}

function refreshNameField() {
  if (!selected) return
  const renaming = !!pendingRename && pendingRename.node === selected
  const reason = nameFieldProblem(selected)
  // R3 — the fields are held by a rename AND by any block: an undo or a redo
  // in flight, or a structural request pending. A move sent while either is
  // true would name the node by a stale name or write a hidden offset.
  const locked = fieldsDisabled({ renaming, blocked: editDispatchBlocked() })
  syncGizmoEnabled()
  for (const input of epVectorInputs) input.disabled = locked
  epName.disabled = locked || !!reason
  epName.title = reason
  if (document.activeElement !== epName) {
    epName.value = selected.name
    epName.dataset.shown = selected.name
  }
  epNameStatus.textContent = renaming ? 'Renaming…' : ''
  refreshEditActions()
}

// Enter commits (via blur → change). Escape restores the field and keeps the
// selection: it never reaches the document-level Escape handler (B5).
function onEditFieldKey(e) {
  if (e.key === 'Enter') {
    e.target.blur()
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    e.target.value = e.target.dataset.shown ?? ''
    e.target.blur()
  }
}

function commitVectorField(field) {
  if (!selected) return
  const inputs = epVectorInputs.filter(i => i.dataset.field === field)
  // Y4 — the dispatch path, not only the button state: an undo or a redo in
  // flight (or a pending structural request) leaves the field as it was
  if (editDispatchBlocked()) {
    for (const i of inputs) i.value = i.dataset.shown ?? ''
    return
  }
  const nums = inputs.map(i => Number(i.value.trim()))
  if (inputs.some(i => i.value.trim() === '') || nums.some(n => !Number.isFinite(n))) {
    for (const i of inputs) i.value = i.dataset.shown ?? ''
    return
  }
  // Start from the node's full-precision value and replace only the axes whose
  // text changed, so the other axes aren't re-sent rounded to the display.
  const current = field === 'rotation'
    ? quatToEulerDeg(selected.rotation ?? [0, 0, 0, 1])
    : [...(selected[field] ?? (field === 'scale' ? [1, 1, 1] : [0, 0, 0]))]
  inputs.forEach((input, i) => {
    if (input.value.trim() !== input.dataset.shown) current[i] = nums[i]
  })
  const value = field === 'rotation' ? eulerDegToQuat(current) : current
  editTracker.commit(selected, field, value)
  refreshEditVectors()
}

for (const input of epVectorInputs) {
  input.addEventListener('keydown', onEditFieldKey)
  input.addEventListener('change', () => commitVectorField(input.dataset.field))
}

epName.addEventListener('keydown', onEditFieldKey)
epName.addEventListener('change', () => {
  if (!selected) return
  const node = selected
  const value = epName.value
  if (value === node.name) return
  // Y4 — the dispatch path: while an undo or a redo is in flight or a
  // structural request is pending, the field goes back to the node's name
  if (editDispatchBlocked()) {
    epName.value = node.name
    return
  }
  // Instant check against the D3 rules; the server still decides.
  const check = client.som?.checkNewName(value, node)
  if (check && !check.ok) {
    showEditError(check.message)
    epName.value = node.name
    return
  }
  try {
    const seq = client.renameNode(node.name, value)
    pendingRename = { seq, node }
    // Y1 — recorded only when the answer arrives AND the rename applied (U15)
    undo.registerRename(seq, { node, from: node.name, to: value })
    clearEditError()
  } catch (err) {
    showEditError(err.message)
    epName.value = node.name
  }
  refreshNameField()
})

function showEditError(text) {
  epError.textContent = text || ''
}

function clearEditError() {
  epError.textContent = ''
}

// ── Answers from the server (B4, B6, B7) ────────────────────────────────

client.on('edit:accepted', ({ seq }) => {
  const mine = editTracker.accepted(seq)
  if (mine) {
    clearEditError()
    // F14 / B7 — the editor's own move of a pad, or of a group holding one
    if (subtreeSome(mine.node, isTeleporter)) rebuildPads()
  }
  // Y4 — the undo engine's own answers (a transform send, or a rename it sent)
  if (undo.onAccepted(seq)) {
    refreshEditVectors()          // the node holds the undone value now
    refreshEditActions()
  }
  if (pendingRename && seq === pendingRename.seq) {
    pendingRename = null
    refreshNameField()
  }
})

client.on('edit:rejected', ({ seq, code, message }) => {
  editTracker.rejected(seq, { code, message })
  if (undo.onRejected(seq, { code, message })) refreshEditActions()
  if (pendingRename && seq === pendingRename.seq) {
    const typed = !pendingRename.direction     // an undo's rename brings its own message
    pendingRename = null
    if (typed) showEditError(`Couldn’t rename: ${message || code}`)
    refreshNameField()
  }
})

client.on('edit:unknown', ({ seq }) => {
  editTracker.unknown(seq)
  if (undo.onUnknown(seq)) refreshEditActions()
  if (pendingRename && seq === pendingRename.seq) {
    pendingRename = null
    refreshNameField()
  }
})

// The three.js object is renamed before som:rename fires (G4); attach again.
client.on('som:rename', () => {
  if (!selected) return
  attachSelected()
  refreshEditPanel()
})

// A removed node (or one under a removed ancestor): cancel its gestures, never
// write to it again, and drop it from the selection (B2, B4).
client.on('som:remove', () => {
  if (!client.som) return
  const alive = (n) => client.som.getNodeByName(n.name) === n
  editTracker.pruneRemoved(alive)
  if (pendingRename && !alive(pendingRename.node)) pendingRename = null
  // N2 (1b-2) — this tab's own pending delete: the removal may be ours or
  // another tab's that reached the server first. Hold the message until our
  // own answer says which (it always arrives after this broadcast).
  const pendingDelete = structure.pending?.kind === 'delete' ? structure.pending.node : null
  if (pendingDelete && !alive(pendingDelete)) structure.removalSeen(pendingDelete)
  if (selected && !alive(selected)) {
    const gone = selected
    activeGesture = null           // already cancelled by pruneRemoved
    selectForEdit(null)
    if (structure.removalSeen(gone) === 'show') showEditError(REMOVED_MESSAGE)
  } else if (selected) {
    refreshNameField()             // a duplicate name may have gone
  }
  resetStaleWorldCamera()
})

client.on('som:add', () => {
  if (selected) refreshNameField()
})

// ── Add palette, Duplicate, Delete (Phase 3 step 1b-2) ──────────────────
// devtasks/PREBRIEF-edit-mode-ui-1b-2.md N1–N4. One structural request at a
// time (edit-structure.js); the server's answer decides what the panel shows.

function isNameFree(name) {
  return !!client.som?.checkNewName(name).ok
}

// N3 — read at click time, from current values (I14: an own edit emits no
// som:set, so nothing computed earlier is trusted). J4: the SOM wrappers don't
// expose geometry, so this reads the glTF-Transform node behind SOMNode.
function checkDuplicate(node) {
  const gltfNode = node?._node
  if (!gltfNode) return { ok: false, reason: 'Select an object first' }
  const name = copyName(node.name, isNameFree)
  if (!name) return { ok: false, reason: 'No free name for a copy' }
  return prepareDuplicate(gltfNode, { name })
}

function structuralBlock() {
  return structuralBlockReason({
    hasSelection: !!selected,
    pending:      !!structure.pending,
    dragging:     !!activeGesture || !!gizmo?.dragging,
    renaming:     !!pendingRename && pendingRename.node === selected,
    sending:      editTracker.pendingCount > 0,     // Y2, U14
    undoing:      undo.inFlight(),                  // Y4, Rev 2 #3
  })
}

// The hint runs on many events (remote sets, avatars joining), so it checks
// rules 1–8 each time but measures the copy's real size (rule 9) once per
// selected node (outside review S2). The click measures again.
let dupSize = { node: null, result: null }

function duplicateHint(node) {
  const gltfNode = node?._node
  if (!gltfNode) return 'Select an object first'
  const problem = duplicateRuleProblem(gltfNode)
  if (problem) return problem.reason
  if (dupSize.node !== node) dupSize = { node, result: checkDuplicate(node) }
  return dupSize.result.ok ? null : dupSize.result.reason
}

// Enabled state and tooltips. A hint only: every click checks again.
function refreshEditActions() {
  const blocked = editDispatchBlocked()
  // R3 — the block reaches the handles and the fields, not only the buttons:
  // a handle left live during an undo or a pending request would move the
  // object with nothing sent, and the next real drag would commit the hidden
  // offset. Every place a block starts or ends calls this.
  syncGizmoEnabled()
  const locked = fieldsDisabled({
    renaming: !!pendingRename && pendingRename.node === selected,
    blocked,
  })
  for (const input of epVectorInputs) input.disabled = locked
  const nameProblem = nameFieldProblem(selected)
  epName.disabled = locked || !!nameProblem
  epName.title = nameProblem
  for (const b of epPaletteBtns) b.disabled = blocked || !modes.edit
  const block = structuralBlock()
  epDelete.disabled = !!block
  epDelete.title = block ?? 'Delete the selected object'
  let dupReason = block
  if (!dupReason) dupReason = duplicateHint(selected)
  epDuplicate.disabled = !!dupReason
  epDuplicate.title = dupReason ?? 'Duplicate the selected object'
  // Y5 — Undo and Redo, beside Duplicate and Delete. The tooltip is the Y1
  // label, or the Y4 reason (`Nothing to undo`, `Waiting for the server…`).
  const undoReason = undo.reason('undo')
  epUndo.disabled = !!undoReason
  epUndo.title = undoReason ?? undo.label('undo')
  const redoReason = undo.reason('redo')
  epRedo.disabled = !!redoReason
  epRedo.title = redoReason ?? undo.label('redo')
}

// Y5 — the two buttons. A click checks again (Y4): the reason is the tooltip,
// and the same guard blocks the keys.
epUndo.addEventListener('click', () => { undo.run('undo'); refreshEditActions() })
epRedo.addEventListener('click', () => { undo.run('redo'); refreshEditActions() })

// Y5/W9 — the keys, in their own document listener: Ctrl+Z (Cmd+Z) undo;
// Ctrl+Shift+Z (Cmd+Shift+Z) and Ctrl+Y redo. Nothing happens unless Edit mode
// is on and focus is not in a text-entry field — that Ctrl+Z is the browser's
// own (U9). R9: a checkbox, a radio or a button (a snap toggle, W9) does not
// swallow the keys. Handled keys preventDefault.
document.addEventListener('keydown', (e) => {
  if (!modes.edit) return
  if (!e.ctrlKey && !e.metaKey) return
  if (e.altKey) return
  if (e.target?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select')) return
  const key = (e.key || '').toLowerCase()
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault()
    undo.run('undo')
    refreshEditActions()
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault()
    undo.run('redo')
    refreshEditActions()
  }
})

// N1 — a palette primitive, along the view, resting on y = 0.
epPalette.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-kind]')
  if (!btn || !modes.edit || editDispatchBlocked()) return
  const kind = btn.dataset.kind
  const name = paletteName(kind, isNameFree)
  if (!name) { showEditError('No free name for a new object'); return }
  const origin = avatar.localNode?.translation ?? [0, 0, 0]
  const forward = new THREE.Vector3()
  stage.camera.getWorldDirection(forward)
  const { position, rotation } = palettePlacement(origin, forward.toArray())
  const descriptor = buildPrimitiveDescriptor({ kind, name, position, rotation })
  let seq
  try {
    seq = client.addNode(descriptor)
  } catch (err) {
    showEditError(`Couldn’t add: ${err.message}`)
    return
  }
  // The answer can't be handled before this handler returns (one thread).
  structure.begin('add', seq, { name, primitive: kind, descriptor })
  // Y7 — recorded from its answer, whatever the Edit mode then
  undo.registerAdd(seq, { name, duplicate: false })
  clearEditError()
  refreshEditActions()
})

// N3 — the copy is built from the node as it is now.
epDuplicate.addEventListener('click', () => {
  if (!modes.edit || !selected || structuralBlock()) return
  const node = selected
  const check = checkDuplicate(node)
  if (!check.ok) {
    showEditError(check.reason)
    refreshEditActions()
    return
  }
  let seq
  try {
    seq = client.addNode(check.descriptor)
  } catch (err) {
    showEditError(`Couldn’t duplicate: ${err.message}`)
    return
  }
  structure.begin('duplicate', seq, { name: check.descriptor.name, node })
  undo.registerAdd(seq, { name: check.descriptor.name, duplicate: true })
  clearEditError()
  refreshEditActions()
})

// N2 — a delete of a node that can come back asks nothing; one that can't
// asks, and says so (W6 supersedes design §4.1 for restorable nodes).
// The pause after the dialog lets messages that arrived meanwhile be handled.
const AFTER_DIALOG_MS = 50
epDelete.addEventListener('click', async () => {
  if (!modes.edit || !selected || structuralBlock()) return
  const node = selected
  // Y2 — captured at click time, before the delete is sent, from current
  // values only (a pending transform send blocks the click, U14)
  const capture = undo.capture(node)
  if (!capture.ok) {
    const n = countDescendants(node)
    const question = n > 0
      ? `Delete "${node.name}" and ${n} object${n === 1 ? '' : 's'} inside it? This can’t be undone.`
      : `Delete "${node.name}"? This can’t be undone.`
    if (!window.confirm(question)) return
    // Outside review S1: the dialog paused this page, so messages that arrived
    // meanwhile are still queued. Let them land before sending: if another tab
    // removed this object (and perhaps made a new one with its name), the
    // delete-by-name would hit the wrong object. Re-check by identity.
    await new Promise((r) => setTimeout(r, AFTER_DIALOG_MS))
  }
  if (!modes.edit || selected !== node || structuralBlock()) return
  if (client.som?.getNodeByName(node.name) !== node) return
  const subtree = collectSubtree(node)
  let seq
  try {
    seq = client.removeNode(node.name)
  } catch (err) {
    showEditError(`Couldn’t delete: ${err.message}`)
    return
  }
  structure.begin('delete', seq, { name: node.name, node, subtree })
  // W5 — a delete that can't come back isn't recorded; its answer clears redo
  undo.registerDelete(seq, { node, name: node.name, descriptor: capture.ok ? capture.descriptor : null })
  clearEditError()
  refreshEditActions()
})

const STRUCTURE_VERB = { add: 'add', duplicate: 'duplicate', delete: 'delete' }

function onStructureAnswer(seq, status, message) {
  const result = structure.settle(seq, status)
  if (!result) return
  const { request, removedMessage } = result
  // Y4 — the undo engine sees every structural answer, and handles its own
  // before anything else. In particular the palette retry must never run for
  // an undo's or a redo's request.
  undo.onStructureAnswer(result, message)
  if (request.undo) {
    if (removedMessage === 'show') {
      showEditError(REMOVED_MESSAGE)             // another tab's delete won
    } else if (removedMessage === 'replaced') {
      // S1: ours was already gone; the server removed a newer object of that name.
      showEditError(`This object was removed elsewhere, and a newer “${request.name}” was deleted instead.`)
    }
    refreshEditActions()
    return
  }
  if (removedMessage === 'show') {
    showEditError(REMOVED_MESSAGE)             // another tab's delete won
  } else if (removedMessage === 'replaced') {
    // S1: ours was already gone; the server removed a newer object of that name.
    showEditError(`This object was removed elsewhere, and a newer “${request.name}” was deleted instead.`)
  } else if (request.kind === 'add' && status === 'rejected' && !request.retried && modes.edit &&
             /already in use/.test(message ?? '')) {
    // Another tab took the name first: try once more with the next free one.
    const name = request.primitive ? paletteName(request.primitive, isNameFree) : null
    if (name && retryAdd(request, name)) { refreshEditActions(); return }
    showEditError(`Couldn’t add: ${message}`)
  } else if (removedMessage === null && status === 'rejected' && modes.edit) {
    showEditError(`Couldn’t ${STRUCTURE_VERB[request.kind]}: ${message}`)
  } else if (status === 'accepted' && request.kind !== 'delete' && modes.edit) {
    selectAdded(request.name)                  // J6
  }
  refreshEditActions()
}

// One retry of a palette add whose name another tab took first (outside
// review nit). Same shape and place, the next free name; never retried twice.
// Y1 — the final name is what gets recorded.
function retryAdd(request, name) {
  const descriptor = { ...request.descriptor, name }
  let seq
  try {
    seq = client.addNode(descriptor)
  } catch {
    return false
  }
  const begun = structure.begin('add', seq, { name, primitive: request.primitive, descriptor, retried: true })
  if (begun) undo.registerAdd(seq, { name, duplicate: false })
  return begun
}

// J6 — select the new node once the server has it. The node is in the SOM
// before edit:accepted (I1); its DocumentView object should be too.
function selectAdded(name) {
  const node = client.som?.getNodeByName(name)
  if (!node) return
  selectAddedNode(node)
}

// Select a node, retrying once on the next frame when DocumentView has not
// built its object yet (J6). An undo's or a redo's re-add uses this too (R5).
function selectAddedNode(node) {
  selectForEdit(node)
  if (selected === node) return
  requestAnimationFrame(() => {
    if (modes.edit && !selected && client.som?.getNodeByName(node.name) === node) selectForEdit(node)
  })
}

// S1 — a new node named like our held delete: our delete-by-name may hit it.
client.on('som:add', ({ nodeName }) => structure.addSeen(nodeName))

client.on('edit:accepted', ({ seq }) => onStructureAnswer(seq, 'accepted'))
client.on('edit:rejected', ({ seq, code, message }) => onStructureAnswer(seq, 'rejected', message || code))
client.on('edit:unknown',  ({ seq }) => onStructureAnswer(seq, 'unknown'))

// A remote change to the selection, or to a material it shares, can change
// whether it may be duplicated.
client.on('som:set', () => { if (modes.edit) refreshEditActions() })
client.on('som:rename', () => { if (modes.edit) refreshEditActions() })

// J8 — the world camera being rendered from is stale once its host is gone,
// or once its three.js camera no longer hangs under the scene (a shared
// camera whose wrapper moved to a surviving host).
function resetStaleWorldCamera() {
  const cam = nav.activeCamera
  if (!cam) return
  const host = cam.node
  const hostAlive = !!host && client.som?.getNodeByName(host.name) === host
  if (isActiveCameraStale({ active: true, hostAlive, rendered: stage.camera, sceneRoot: sceneGroup })) {
    stage.setActiveCamera(null)
    updateHintText()
  }
}

// ---------------------------------------------------------------------------
// Auth UI actions
// ---------------------------------------------------------------------------

authSubmitBtn.addEventListener('click', handleAuthSubmit)

authPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAuthSubmit()
})

authToggleBtn.addEventListener('click', toggleAuthMode)

authLogoutBtn.addEventListener('click', async () => {
  authLogoutBtn.disabled = true
  try {
    await logout()
    client.disconnect()
  } catch (err) {
    client.disconnect()
    // Even if the server request fails, clear local state — the session
    // may still be invalidated on the next request.
  } finally {
    setAuthState(null)
    authLogoutBtn.disabled = false
  }
})

// ---------------------------------------------------------------------------
// World browser actions
// ---------------------------------------------------------------------------

wbCreateBtn.addEventListener('click', async () => {
  const slug = wbSlug.value.trim()
  const name = wbName.value.trim()
  if (!slug) {
    wbError.textContent = 'Slug is required'
    return
  }
  wbCreateBtn.disabled = true
  wbError.textContent = ''
  try {
    const res = await fetch('/api/worlds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      wbError.textContent = data.error || `Create failed (${res.status})`
      return
    }
    wbSlug.value = ''
    wbName.value = ''
    refreshWorldList()
  } catch (err) {
    wbError.textContent = 'Create failed: ' + err.message
  } finally {
    wbCreateBtn.disabled = false
  }
})

wbSlug.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') wbCreateBtn.click()
})
wbName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') wbCreateBtn.click()
})

// ---------------------------------------------------------------------------
// Navigation — delegate input to NavigationController
// Both paths are wired at startup; the active path is gated by usePointerLock.
// ---------------------------------------------------------------------------

let pointerLocked = false
let dragging      = false

document.addEventListener('pointerlockchange', () => {
  pointerLocked = !!document.pointerLockElement
})

viewportEl.addEventListener('click', () => {
  if (modes.usePointerLock) viewportEl.requestPointerLock()
})

viewportEl.addEventListener('mousedown', (e) => {
  // Presses on panels and forms over the viewport (the Edit panel's fields,
  // the teleporter form) aren't look-drags.
  if (e.target !== canvas) return
  // B3 — a press that grabbed a handle drags the handle, not the camera.
  // TransformControls sets `dragging` on pointerdown, before mousedown fires.
  if (gizmo?.dragging) return
  if (!modes.usePointerLock) dragging = true
})

document.addEventListener('mouseup', () => { dragging = false })

document.addEventListener('mousemove', (e) => {
  if (gizmo?.dragging) return
  if (modes.usePointerLock && pointerLocked) {
    nav.onMouseMove(e.movementX, e.movementY)
  } else if (!modes.usePointerLock && dragging) {
    nav.onMouseMove(e.movementX, e.movementY)
  }
})

document.addEventListener('keydown', (e) => {
  if (e.target !== canvas) return

  // M / V — mode-specific hot keys, ignored in ORBIT
  if (e.code === 'KeyM' && nav.mode !== 'ORBIT') {
    // E6 — ignored while editing (the lock would put every click at the centre)
    if (!modes.togglePointerLock()) return
    if (!modes.usePointerLock && document.pointerLockElement) {
      document.exitPointerLock()
    }
    updateHintText()
    return
  }

  // V — toggle camera perspective (third-person ↔ first-person); ignored in ORBIT
  if (e.code === 'KeyV' && avatar.localNode && nav.mode !== 'ORBIT') {
    firstPerson = !firstPerson
    if (firstPerson) {
      avatar.cameraNode.translation = [0, 1.6, 0]
      avatar.localNode.visible = false
    } else {
      avatar.cameraNode.translation = [0, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z]
      avatar.localNode.visible = true
    }
    updateHintText()
    return
  }

  // Space — cycle through world cameras (null = default nav camera)
  if (e.code === 'Space') {
    const cameras = client.som?.cameras ?? []
    if (cameras.length === 0) return
    const current = nav.activeCamera
    const idx = cameras.indexOf(current)
    const next = cameras[(idx + 1) % (cameras.length + 1)]
    stage.setActiveCamera(next ?? null)
    updateHintText()
    return
  }

  nav.onKeyDown(e.code)
})

document.addEventListener('keyup', (e) => { if (e.target === canvas) nav.onKeyUp(e.code) })

modeSwitcher.addEventListener('change', (e) => {
  nav.setMode(e.target.value)
  updateHintText()
})

viewportEl.addEventListener('wheel', (e) => {
  if (e.target !== canvas) return     // scrolling over a panel doesn't zoom
  e.preventDefault()
  nav.onWheel(e.deltaY)
}, { passive: false })

// ---------------------------------------------------------------------------
// Tick loop
// ---------------------------------------------------------------------------

let lastTick = performance.now()

function tick(now) {
  requestAnimationFrame(tick)

  const dt = (now - lastTick) / 1000
  lastTick = now

  stage.tick(dt)
  labels.update()
  tickEditMode()
  // Teleporter trigger update (T4): feed avatar position every frame
  if (avatarReady && avatar.localNode) {
    trigger.update(avatar.localNode.translation ?? [0, 0, 0])
  }
}

requestAnimationFrame(tick)

// Initial hint text
updateHintText()

// ---------------------------------------------------------------------------
// Page load: determine auth state from the server, not from local cache
// ---------------------------------------------------------------------------

me().then(user => {
  if (user) {
    setAuthState(user)
    // Auto-connect to home world on page load if a valid session exists
    // and we're not already connected.
    if (!client.connected) {
      autoConnectToHomeWorld(user)
    }
  }
})