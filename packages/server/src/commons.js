// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { readFile } from 'node:fs/promises'
import { createWorld, createWorldFromDocument } from './world.js'
import { normalizeUsername } from './auth.js'
import * as worldStore from './world-store.js'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Seed-file guard: scan a parsed glTF JSON document for external references
// that would prevent round-tripping. See pre-brief §4B-4.
// ---------------------------------------------------------------------------

export function scanGltfForExternalRefs(gltf) {
  if (gltf.nodes) {
    for (let i = 0; i < gltf.nodes.length; i++) {
      const node = gltf.nodes[i]
      if (node.extras?.atrium?.source) {
        throw new Error(
          `Seed file node[${i}] has extras.atrium.source — external refs will not round-trip. Aborting seed.`
        )
      }
    }
  }

  if (gltf.buffers) {
    for (let i = 0; i < gltf.buffers.length; i++) {
      const buf = gltf.buffers[i]
      if (buf.uri && !buf.uri.startsWith('data:')) {
        throw new Error(
          `Seed file buffer[${i}] has non-data URI — will not round-trip. Aborting seed.`
        )
      }
    }
  }

  if (gltf.images) {
    for (let i = 0; i < gltf.images.length; i++) {
      const img = gltf.images[i]
      if (img.uri && !img.uri.startsWith('data:')) {
        throw new Error(
          `Seed file image[${i}] has non-data URI — will not round-trip. Aborting seed.`
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// setupCommons — boot-time commons initialization
//
// Returns { host, mode } where mode is 'owned' or 'read-only'.
// Called from index.js during startup.
// ---------------------------------------------------------------------------

export async function setupCommons({ registry, db, worldPath }) {
  const operatorUsername = (process.env.ATRIUM_COMMONS_OWNER || '').trim()
  const slug = (process.env.ATRIUM_COMMONS_SLUG || 'commons').trim()

  // ── Resolve operator account ──
  if (!operatorUsername) {
    return degradedBoot(registry, db, worldPath, 'ATRIUM_COMMONS_OWNER is not set', null)
  }

  let operatorRow
  try {
    const normalized = normalizeUsername(operatorUsername)
    operatorRow = db.database.prepare(
      'SELECT id, username FROM users WHERE username = ? COLLATE NOCASE'
    ).get(normalized)
  } catch {
    // DB error — degrade
  }

  if (!operatorRow) {
    return degradedBoot(
      registry, db, worldPath,
      `Operator account "${operatorUsername}" not found in users table`,
      null
    )
  }

  const operatorUserId = operatorRow.id

  // ── Check for existing (operator, slug) row ──
  let existingRow
  try {
    existingRow = db.database.prepare(
      'SELECT id, owner_user_id, document, visibility FROM worlds WHERE owner_user_id = ? AND slug = ?'
    ).get(operatorUserId, slug)
  } catch {
    return degradedBoot(registry, db, worldPath, 'DB error looking up existing commons row', operatorUserId)
  }

  // ── Nemotron Finding 3: pre-existing private commons row ──
  if (existingRow && existingRow.visibility !== 'public') {
    console.error(
      `[commons] ERROR: Existing commons row "${existingRow.id}" has visibility "${existingRow.visibility}" — ` +
      'cannot adopt as public commons. Booting in degraded read-only mode.'
    )
    return degradedBoot(registry, db, worldPath, 'Existing commons row is not public', operatorUserId, existingRow.id)
  }

  // ── Idempotent seeding ──
  let worldRowId
  let documentSource
  let isNewSeed = false

  if (existingRow) {
    worldRowId = existingRow.id
    documentSource = existingRow.document
    console.log(`[commons] Commons row exists at id "${worldRowId}" — adopting without re-seed`)
  } else {
    isNewSeed = true

    // Run seed-file guard before any DB write
    await validateSeedFile(worldPath)

    const fileWorld = await createWorld(worldPath)
    await fileWorld.resolveExternalReferences()
    documentSource = JSON.stringify(await fileWorld.serialize())

    // Single transaction: create the world row
    const now = new Date().toISOString()
    worldRowId = randomUUID()

    try {
      db.database.prepare(
        `INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'public', ?, ?)`
      ).run(worldRowId, operatorUserId, slug, 'The Commons', documentSource, now, now)

      console.warn(
        `[commons] Seeded new commons world: id="${worldRowId}", operator="${operatorUsername}", slug="${slug}"`
      )
    } catch (err) {
      console.error('[commons] Failed to seed commons row:', err.message)
      return degradedBoot(registry, db, worldPath, 'Failed to insert commons row', operatorUserId)
    }
  }

  // ── Nemotron Finding 1: remove any stale 'default' host before registering
  // under the row UUID ──
  if (registry.hosts.has('default')) {
    const oldHost = registry.hosts.get('default')
    oldHost.close()
    registry.hosts.delete('default')
    console.log('[commons] Removed stale "default" host before registering under row UUID')
  }

  // ── Register host from DB document ──
  const rowForRegistration = {
    id: worldRowId,
    owner_user_id: operatorUserId,
    document: documentSource,
  }
  const host = await registry.registerWorldFromDocument(rowForRegistration, 'owner')
  registry.setRootWorldId(worldRowId)

  const nodeCount = host.world.listNodeNames().length
  console.log(`[commons] Commons ready: mode="owned", id="${worldRowId}", nodes=${nodeCount}`)

  return { host, mode: 'owned' }
}

// ---------------------------------------------------------------------------
// degradedBoot — start the commons in read-only mode
// ---------------------------------------------------------------------------

async function degradedBoot(registry, db, worldPath, reason, operatorUserId = null, hostUuid = null) {
  console.error(
    `[commons] DEGRADED READ-ONLY BOOT — ${reason}. The commons is readable via / by everyone but ALL mutation is denied.`
  )

  const key = hostUuid ?? 'default'

  // Clean stale host at target key (UUID or 'default')
  if (registry.hosts.has(key)) {
    const oldHost = registry.hosts.get(key)
    oldHost.close()
    registry.hosts.delete(key)
    console.log(`[commons] Removed stale "${key}" host during degraded boot`)
  }
  // Also clean 'default' if different from key
  if (key !== 'default' && registry.hosts.has('default')) {
    const oldHost = registry.hosts.get('default')
    oldHost.close()
    registry.hosts.delete('default')
    console.log('[commons] Removed stale "default" host during degraded boot (UUID key)')
  }

  // Register the file world with read-only policy
  const host = await registry.registerWorld(key, worldPath, null, 'read-only')
  // Store operator identity on the host for later convergence checks
  host._degradedOperatorUserId = operatorUserId
  registry.setRootWorldId(key)

  const nodeCount = host.world.listNodeNames().length
  console.log(`[commons] Commons ready: mode="read-only", key="${key}", nodes=${nodeCount}`)

  return { host, mode: 'read-only' }
}

// ---------------------------------------------------------------------------
// validateSeedFile — read and scan the world file
// ---------------------------------------------------------------------------

async function validateSeedFile(filePath) {
  const ext = filePath.toLowerCase()
  if (ext.endsWith('.glb')) {
    // ── Nemotron Finding 2: .glb cannot be scanned — fail loudly ──
    throw new Error(
      `Seed file "${filePath}" is binary .glb format — cannot validate external refs. ` +
      'Only .gltf seed files are supported. Aborting boot.'
    )
  }

  if (!ext.endsWith('.gltf')) {
    throw new Error(
      `Seed file "${filePath}" has unknown extension — must be .gltf. Aborting boot.`
    )
  }

  const text = await readFile(filePath, 'utf8')
  let gltf
  try {
    gltf = JSON.parse(text)
  } catch {
    throw new Error(`Seed file "${filePath}" is not valid JSON`)
  }

  scanGltfForExternalRefs(gltf)
  console.log(`[commons] Seed file "${filePath}" passed external-ref scan`)
}