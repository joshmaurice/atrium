// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behaviors-export.mjs — scripting-4d G10 (Rev 1.1 M3; §8).
//
// READ-ONLY. Run it on the HOST, with the world server STOPPED, against the
// database FILE, before any rollback, and keep the export with the database
// copy (use SQLite's own `.backup`/`VACUUM INTO`, never a file copy). For every
// world it lists every node whose `extras.atrium.behavior` is non-null: the
// world id, the owner id, the node's `objectId` and name, the leaf, its sha256
// and the world's `updated_at`. `behaviors-reconcile.mjs` reads the file back.
//
// Usage: node behaviors-export.mjs <db> <out>
//
// "The world server is stopped" is CHECKED, not assumed (N3): the server holds
// a LIFETIME lock file beside the database, and this script refuses while that
// file's pid is alive (R-L2 (a), round 3). A stale lock (a dead pid) is warned
// about and removed. `BEGIN IMMEDIATE` is taken as well, but for ATOMICITY
// against a concurrent writer — it is not the offline check: an idle server
// between transactions holds no write lock (round 2's M2).

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { assertServerStopped } from '../src/server-lock.js'

const sha256Json = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export { sha256Json }

/**
 * R11 — every name a script prints goes through `JSON.stringify`: a node or
 * world name carrying LF, CR or a `[reconcile] …` prefix must not be able to
 * forge a record line in the operator's report.
 */
export const quoteName = (name) => JSON.stringify(typeof name === 'string' ? name : '')

/** Every node of a serialized glTF document that carries a non-null behaviour. */
export function behaviorNodesInDocument(documentJson) {
  let doc
  try {
    doc = typeof documentJson === 'string' ? JSON.parse(documentJson) : documentJson
  } catch {
    return { problem: 'the document is not valid JSON' }
  }
  const nodes = Array.isArray(doc?.nodes) ? doc.nodes : []
  const found = []
  nodes.forEach((node, index) => {
    const atrium = node?.extras?.atrium
    if (!atrium || typeof atrium !== 'object') return
    const behavior = atrium.behavior
    if (behavior === undefined || behavior === null) return
    const objectId = typeof atrium.objectId === 'string' && atrium.objectId.length > 0 ? atrium.objectId : null
    found.push({
      index,
      objectId,
      name: typeof node?.name === 'string' ? node.name : null,
      behavior,
      behaviorSha256: sha256Json(behavior),
    })
  })
  return { nodes: found }
}

/** The whole export value for an open database. Exported so a test can read it. */
export function buildExport(database) {
  const worlds = database.prepare(
    'SELECT id, owner_user_id, name, document, updated_at FROM worlds ORDER BY id'
  ).all()

  const out = { version: 1, generatedAt: new Date().toISOString(), worlds: [] }
  for (const row of worlds) {
    const result = behaviorNodesInDocument(row.document)
    if (result.problem) {
      out.worlds.push({ worldId: row.id, ownerId: row.owner_user_id, name: row.name ?? '', updatedAt: row.updated_at, problem: result.problem, nodes: [] })
      continue
    }
    if (result.nodes.length === 0) continue
    out.worlds.push({
      worldId: row.id,
      ownerId: row.owner_user_id,
      name: row.name ?? '',
      updatedAt: row.updated_at,
      nodes: result.nodes,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const [dbArg, outPath] = process.argv.slice(2)
  if (!dbArg || !outPath) {
    console.error('usage: node behaviors-export.mjs <db> <out>')
    process.exit(2)
  }
  const dbPath = resolve(dbArg)
  const warn = (line) => console.error(`[export] ${line}`)

  // The offline check (R-L2 (a)): a live server's lifetime lock refuses.
  try {
    assertServerStopped(dbPath, { log: warn })
  } catch (error) {
    console.error(`[export] ${error.message}`)
    process.exit(1)
  }

  let db
  try {
    db = new Database(dbPath)
  } catch (error) {
    console.error(`[export] cannot open ${dbPath}: ${error.message}`)
    process.exit(1)
  }

  // Atomicity, NOT the offline check: it keeps the read consistent against a
  // concurrent writer for the moment it runs.
  try {
    db.exec('BEGIN IMMEDIATE')
  } catch (error) {
    console.error(`[export] the database is in use (is the world server stopped?): ${error.message}`)
    db.close()
    process.exit(1)
  }

  try {
    const exported = buildExport(db)
    writeFileSync(outPath, JSON.stringify(exported, null, 2) + '\n')

    const nodeCount = exported.worlds.reduce((sum, w) => sum + w.nodes.length, 0)
    for (const world of exported.worlds) {
      console.log(`[export] world ${world.worldId} ${quoteName(world.name)} (owner ${world.ownerId}, updated ${world.updatedAt}): ${world.nodes.length} behaviour leaf(s)`)
      for (const node of world.nodes) {
        console.log(`  node ${node.objectId ?? '(no id)'} ${quoteName(node.name)} sha256 ${node.behaviorSha256}`)
      }
    }
    console.log(`[export] wrote ${outPath}: ${exported.worlds.length} world(s), ${nodeCount} behaviour leaf(s)`)
    db.exec('ROLLBACK')   // read-only: nothing was written
    db.close()
    process.exit(0)
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* already rolled back */ }
    db.close()
    console.error(`[export] failed: ${error.message}`)
    process.exit(1)
  }
}

// Run only when invoked as a script (the test imports the pure helpers above).
if (process.argv[1] && process.argv[1].endsWith('behaviors-export.mjs')) main()
