// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import * as THREE from 'three'
import { AtriumClient }          from '@atrium/client'
import { LabelOverlay }          from './LabelOverlay.js'
import { Stage, PointerInputBridge, initDocumentView, loadBackground, buildAvatarDescriptor, buildTeleporterDescriptor } from '@atrium/renderer-three'
import { register, login, logout, me } from './auth.js'
import { computeWsUrl, buildWorldWsUrl, resolveWorldAddress, isValidDestination, shouldUseFileBase, sameOriginAsAccount } from './wsUrl.js'
import { createTeleportTrigger, TELEPORT_TRIGGER_RADIUS, nearSpawn } from './teleport-trigger.js'
import { isTeleporter, teleporterDestination } from './teleporter-marker.js'
import { teleporterLabel } from './teleporter-label.js'
import { teleportFailureMessage, evictionMessage, codeToReason, formatDestination } from './teleport-failure.js'
import { projectRayToPlane } from '@atrium/renderer-three'

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
          refreshWorldList()
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
window.stage = stage

// ---------------------------------------------------------------------------
// Navigation / camera mode state
// ---------------------------------------------------------------------------

let usePointerLock = false   // default: drag-to-look; M key toggles
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
        position: node.translation ?? [0, 0, 0],
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

function rebuildPads() {
  const newPads = derivePads()
  trigger.setPads(newPads)
  // Update pad labels (T13)
  // Remove all existing pad labels
  labels.removeLabelsByPrefix('teleporter-')
  // Add labels for current pads
  for (const pad of newPads) {
    const label = teleporterLabel(pad.destination, currentWorldUrl)
    labels.addLabel(pad.name, '\u21B3 ' + label, { name: pad.name, translation: pad.position }, {
      heightOffset: 1.2,
      className: 'pad-label',
    })
  }
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

  const hasAvatar   = !!avatar.localNode
  const mouseMode   = usePointerLock ? 'Click to look' : 'Drag to look'
  const mouseToggle = usePointerLock ? '[M] drag mode'  : '[M] mouse lock'

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
  firstPerson = false   // reset to third-person for next session
  updateHud()
  updateHintText()
}

client.on('connecting', () => {
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
client.on('som:set', ({ nodeName }) => {
  if (!client.som) return
  if (nodeName === '__document__') {
    loadBackground(threeScene, client.som.extras?.atrium?.background, client.worldBaseUrl)
    return
  }
  // Rebuild pads if a teleporter node was modified (T4)
  if (nodeName && client.som.getNodeByName(nodeName)) {
    const node = client.som.getNodeByName(nodeName)
    if (isTeleporter(node)) {
      rebuildPads()
    }
  }
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
  const isActive = placementMode || deleteMode || tpForm.style.display !== 'none' ||
    pendingSeq != null || pendingDeleteSeq != null

  if (isActive) {
    // Abandon pending save/delete
    pendingSeq = null
    pendingName = null
    pendingDeleteSeq = null
    deleteTargetName = null
    pendingPosition = null
    // Close form and mode
    placementMode = false
    deleteMode = false
    tpForm.style.display = 'none'
    tpCancelBtn.style.display = 'none'
    tpPlaceBtn.style.display = ''
    tpDeleteBtn.style.display = ''
    viewportEl.style.cursor = ''
    trigger.setActive(true)
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

let placementMode = false
let deleteMode = false
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
  const canEdit = client.canPlaceTeleporters && avatarReady && client.connected
  tpPlaceBtn.disabled = !canEdit || placementMode
  tpDeleteBtn.disabled = !canEdit || deleteMode
  if (!canEdit && (placementMode || deleteMode)) {
    exitTeleporterMode()
  }
}

// Wire teleporter control updates into avatar:local-ready (already has a handler)
// We extend the existing handler below — updateTeleporterControls is called there

function exitTeleporterMode() {
  placementMode = false
  deleteMode = false
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
  trigger.setActive(true)
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
    if (placementMode || deleteMode || tpForm.style.display !== 'none') {
      exitTeleporterMode()
    }
  }
})

// ── Placement mode ──────────────────────────────────────────────────────

tpPlaceBtn.addEventListener('click', () => {
  if (!client.canPlaceTeleporters || !avatarReady) return
  placementMode = true
  deleteMode = false
  trigger.setActive(false)
  tpCancelBtn.style.display = ''
  tpPlaceBtn.disabled = true
  tpDeleteBtn.style.display = 'none'
  viewportEl.style.cursor = 'crosshair'
  showTeleporterOverlay('Click in the viewport to place a teleporter pad')
})

// Handle viewport click in placement mode
viewportEl.addEventListener('click', (e) => {
  if (!placementMode) return
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
  }
  if (pendingDeleteSeq != null && err.seq === pendingDeleteSeq) {
    // Delete error
    showTeleporterOverlay(`Couldn't delete teleporter: ${err.message || 'refused'}`)
    pendingDeleteSeq = null
    deleteTargetName = null
  }
})

// ── Delete mode ─────────────────────────────────────────────────────────

tpDeleteBtn.addEventListener('click', () => {
  if (!client.canPlaceTeleporters || !avatarReady) return
  deleteMode = true
  placementMode = false
  trigger.setActive(false)
  tpCancelBtn.style.display = ''
  tpDeleteBtn.disabled = true
  tpPlaceBtn.style.display = 'none'
  viewportEl.style.cursor = 'pointer'
  showTeleporterOverlay('Click on a teleporter pad to delete it')
})

// Handle viewport click in delete mode — raycast to find teleporter
viewportEl.addEventListener('click', (e) => {
  if (!deleteMode) return
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
  if (usePointerLock) viewportEl.requestPointerLock()
})

viewportEl.addEventListener('mousedown', () => {
  if (!usePointerLock) dragging = true
})

document.addEventListener('mouseup', () => { dragging = false })

document.addEventListener('mousemove', (e) => {
  if (usePointerLock && pointerLocked) {
    nav.onMouseMove(e.movementX, e.movementY)
  } else if (!usePointerLock && dragging) {
    nav.onMouseMove(e.movementX, e.movementY)
  }
})

document.addEventListener('keydown', (e) => {
  if (e.target !== canvas) return

  // M / V — mode-specific hot keys, ignored in ORBIT
  if (e.code === 'KeyM' && nav.mode !== 'ORBIT') {
    usePointerLock = !usePointerLock
    if (!usePointerLock && document.pointerLockElement) {
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