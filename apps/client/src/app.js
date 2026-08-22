// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { AtriumClient }          from '@atrium/client'
import { LabelOverlay }          from './LabelOverlay.js'
import { Stage, PointerInputBridge, initDocumentView, loadBackground, buildAvatarDescriptor } from '@atrium/renderer-three'
import { register, login, logout, me } from './auth.js'

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const worldUrlInput = document.getElementById('worldUrl')
const wsUrlInput    = document.getElementById('wsUrl')
const loadBtn       = document.getElementById('loadBtn')
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
    // Show world browser and refresh list
    worldBrowser.style.display = ''
    refreshWorldList()
  } else {
    authLoggedOut.style.display = ''
    authLoggedIn.style.display  = 'none'
    authSubmitBtn.textContent   = 'Login'
    authToggleBtn.textContent   = 'Register'
    authUsername.value          = ''
    authPassword.value          = ''
    authError.textContent       = ''
    // Hide world browser and clear list
    worldBrowser.style.display = 'none'
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
  try {
    let result
    if (isRegister) {
      result = await register(username, password, authWebsite.value.trim())
    } else {
      result = await login(username, password)
    }
    setAuthState(result)
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
      worldBrowser.style.display = 'none'
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

    const loadBtn = document.createElement('button')
    loadBtn.textContent = 'Load'
    loadBtn.disabled = client.connected
    loadBtn.title = client.connected ? 'Disconnect before loading a saved world' : 'Load this world'
    loadBtn.addEventListener('click', async () => {
      loadBtn.disabled = true
      try {
        const res = await fetch(`/api/worlds/${w.id}`)
        if (!res.ok) {
          if (res.status === 404) {
            wbError.textContent = 'World not found (may have been deleted)'
          } else {
            wbError.textContent = 'Failed to load world'
          }
          refreshWorldList()
          return
        }
        const text = await res.text()
        await client.loadWorldFromData(text, w.name || w.slug)
        overlayEl.textContent = `Loaded: ${w.name || w.slug}`
      } catch (err) {
        wbError.textContent = 'Load failed: ' + err.message
      } finally {
        loadBtn.disabled = false
      }
    })
    item.appendChild(loadBtn)

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
    // Disable all world-browser Load buttons while connected
    document.querySelectorAll('.wb-item button:first-of-type').forEach(b => {
      b.disabled = true
      b.title = 'Disconnect before loading a saved world'
    })
  } else {
    // disconnected or error
    connectBtn.textContent = 'Connect'
    connectBtn.disabled    = false
    // Re-enable world-browser Load buttons since we're no longer connected
    enableWbLoadButtons()
  }

  updateHud()
}

function enableWbLoadButtons() {
  // Re-enable any disabled Load buttons when disconnected
  for (const btn of wbList.querySelectorAll('button')) {
    if (btn.textContent === 'Load') {
      btn.disabled = false
      btn.title = 'Load this world'
    }
  }
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

  // Derive base URL for resolving relative texture paths
  const rawUrl = worldUrlInput.value.trim()
  const absUrl  = new URL(rawUrl, window.location.href).href
  worldBaseUrl  = absUrl.substring(0, absUrl.lastIndexOf('/') + 1)

  // Clear previous background/environment before loading new world
  threeScene.background = null
  threeScene.environment = null

  ;({ docView, sceneGroup } = initDocumentView(renderer, threeScene, client.som, { prevDocView: docView, prevSceneGroup: sceneGroup }))
  stage.setSceneGroup(sceneGroup)

  loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)

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
})

client.on('session:ready', () => {
  setConnectionState('connected')
  updateHintText()
})

client.on('disconnected', () => {
  labels.clear()
  setConnectionState('disconnected')
  firstPerson = false   // reset to third-person for next session
  updateHintText()

  // Reload the world in static mode — clears avatar/peer nodes from the scene
  // and restores NavigationController's localNode for input to work again.
  const url = worldUrlInput.value.trim()
  if (url) client.loadWorld(url)
})

client.on('error', (err) => {
  console.error('[app] client error:', err)
  setConnectionState('error')
})

// ---------------------------------------------------------------------------
// Avatar controller event listeners
// ---------------------------------------------------------------------------

avatar.on('avatar:local-ready', () => {
  updateHud()
  updateHintText()
})

avatar.on('avatar:peer-added', ({ displayName, node }) => {
  console.log(`[app] Peer joined: ${displayName} (${avatar.peerCount} peer${avatar.peerCount === 1 ? '' : 's'})`)
  labels.addLabel(displayName, node)
  updateHud()
})

avatar.on('avatar:peer-removed', ({ displayName }) => {
  console.log(`[app] Peer left: ${displayName} (${avatar.peerCount} peer${avatar.peerCount === 1 ? '' : 's'})`)
  labels.removeLabel(displayName)
  updateHud()
})

// Live property updates on the selected node, and world-info panel for document extras
let worldBaseUrl = ''
client.on('som:set', ({ nodeName }) => {
  if (!client.som) return
  if (nodeName === '__document__') {
    loadBackground(threeScene, client.som.extras?.atrium?.background, worldBaseUrl)
    return
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
// UI actions
// ---------------------------------------------------------------------------

loadBtn.addEventListener('click', async () => {
  const url = worldUrlInput.value.trim()
  if (!url) return
  loadBtn.disabled = true
  overlayEl.textContent = 'Loading…'
  try {
    if (url.endsWith('.json')) {
      const configUrl = new URL(url, window.location.href).href
      const resp = await fetch(configUrl)
      const config = await resp.json()
      const msg = await loadAtriumConfig(config, configUrl)
      overlayEl.textContent = msg ?? ''
    } else {
      const absoluteUrl = new URL(url, window.location.href).href
      await client.loadWorld(absoluteUrl)
      overlayEl.textContent = ''
    }
  } catch (err) {
    overlayEl.textContent = 'Load failed: ' + err.message
    console.error(err)
  } finally {
    loadBtn.disabled = false
  }
})

connectBtn.addEventListener('click', () => {
  if (client.connected) {
    client.disconnect()
    return
  }
  const wsUrl = wsUrlInput.value.trim()
  if (!wsUrl) return
  setConnectionState('connecting')
  const worldUrl = worldUrlInput.value.trim()
  if (worldUrl) {
    client.worldBaseUrl = new URL(worldUrl, window.location.href).href
  }
  const avatarDesc = buildAvatarDescriptor()
  client.connect(wsUrl, { avatar: avatarDesc })
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
    setAuthState(null)
  } catch (err) {
    // Even if the server request fails, clear local state — the session
    // may still be invalidated on the next request.
    setAuthState(null)
  } finally {
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
}

requestAnimationFrame(tick)

// Initial hint text
updateHintText()

// ---------------------------------------------------------------------------
// Page load: determine auth state from the server, not from local cache
// ---------------------------------------------------------------------------

me().then(user => {
  if (user) setAuthState(user)
})