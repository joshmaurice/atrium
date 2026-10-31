// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behaviors-reconcile.mjs — scripting-4d G10 (Rev 1.1 M3, Rev 1.2 S1; §8).
//
// Run it on the HOST, with the world server STOPPED, against the database FILE
// and an export written by `behaviors-export.mjs` before a rollback. It is a
// DRY RUN by default and writes nothing; pass `--apply` to write.
//
// For every exported leaf it reports exactly ONE of three outcomes:
//
//   unchanged | the world exists, one node has that `objectId`, and its leaf's
//             | sha256 is the exported one (the common case: healing's `null`
//             | was never saved). No write, not a conflict.
//   restore   | the world exists, one node has that `objectId`, and its leaf
//             | is `null` or absent. The leaf is written back IF it still
//             | passes the current rule (G1) and the caps (G2); the caps are
//             | re-checked cumulatively, per world, in document order.
//   conflict  | anything else: a different leaf on the node (an owner changed
//             | it during the rollback), the node gone or duplicated, the
//             | world gone, a leaf the rule now refuses, a cap the restore
//             | would break.
//
// What the restore writes is what the next load KEEPS: the restored document is
// imported through the server's OWN loader and healing (`createWorldFromDocument`)
// before it is written, and the world's `document` and `updated_at` are written
// in one transaction. A second `--apply` therefore reports zero writes and no
// new conflicts.
//
// The report splits restores by `updated_at` into "world untouched since the
// export" and "world edited during the rollback", so the operator knows which
// owners to ask (N3).
//
// Usage: node behaviors-reconcile.mjs <db> <export> [--apply]
//
// "The world server is stopped" is CHECKED, not assumed (N3): the server holds
// a LIFETIME lock file beside the database, and this refuses while its pid is
// alive (R-L2 (a), round 3); a stale lock is warned about and removed.
// `BEGIN IMMEDIATE` is taken for ATOMICITY of the write, not as the offline
// check (round 2's M2).
//
// File-backed worlds are out of scope: they are never autosaved, so they never
// hold a healed leaf in storage.

import Database from 'better-sqlite3'
import { resolve } from 'node:path'
import { createWorldFromDocument } from '../src/world.js'
import { behaviorCheck } from '../src/send-policy.js'
import { assertServerStopped } from '../src/server-lock.js'
import { sha256Json, quoteName } from './behaviors-export.mjs'

/** objectId → the indices of the nodes carrying it. */
export function objectIdIndex(documentJson) {
  let doc
  try {
    doc = typeof documentJson === 'string' ? JSON.parse(documentJson) : documentJson
  } catch {
    return { problem: 'the document is not valid JSON' }
  }
  const nodes = Array.isArray(doc?.nodes) ? doc.nodes : []
  const index = new Map()
  nodes.forEach((node, i) => {
    const id = node?.extras?.atrium?.objectId
    if (typeof id !== 'string' || id.length === 0) return
    if (!index.has(id)) index.set(id, [])
    index.get(id).push(i)
  })
  return { index }
}

/**
 * Classify one exported leaf against the world's current document. Pure and
 * synchronous: the "restore" candidates are confirmed later by the loader.
 */
export function classifyLeaf(documentJson, exported, sha256) {
  const parsed = objectIdIndex(documentJson)
  if (parsed.problem) return { outcome: 'conflict', reason: parsed.problem }
  const indices = parsed.index.get(exported.objectId)
  if (!indices || indices.length === 0) return { outcome: 'conflict', reason: 'the node is gone' }
  if (indices.length > 1) return { outcome: 'conflict', reason: 'the objectId is duplicated' }
  const doc = typeof documentJson === 'string' ? JSON.parse(documentJson) : documentJson
  const atrium = doc.nodes[indices[0]]?.extras?.atrium ?? {}
  const current = atrium.behavior
  if (current !== undefined && current !== null) {
    return sha256(current) === exported.behaviorSha256
      ? { outcome: 'unchanged' }
      : { outcome: 'conflict', reason: 'the leaf changed during the rollback' }
  }
  return { outcome: 'restore' }
}

/** A deep copy of the document with `objectId`'s leaf set to `behavior`. */
function withRestoredLeaves(documentJson, restores) {
  const doc = JSON.parse(documentJson)
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : []
  for (const { objectId, behavior } of restores) {
    const node = nodes.find((n) => n?.extras?.atrium?.objectId === objectId)
    if (!node) continue
    if (!node.extras) node.extras = {}
    if (!node.extras.atrium) node.extras.atrium = {}
    node.extras.atrium.behavior = behavior
  }
  return doc
}

/**
 * Reconcile every exported world against an open database. Returns the report;
 * when `apply` is true it writes the worlds it changed.
 *
 * @param {Database} database
 * @param {object} exported              an export written by behaviors-export.mjs
 * @param {{apply?: boolean, log?: (line: string) => void}} [opts]
 */
export async function reconcile(database, exported, { apply = false, log = () => {} } = {}) {
  const report = { apply, worlds: [], totals: { unchanged: 0, restore: 0, conflict: 0, writes: 0 } }
  const nowIso = new Date().toISOString()

  for (const world of exported.worlds ?? []) {
    const row = database.prepare(
      'SELECT id, owner_user_id, document, updated_at FROM worlds WHERE id = ?'
    ).get(world.worldId)

    const entry = {
      worldId: world.worldId,
      ownerId: world.ownerId,
      name: world.name ?? '',
      sinceExport: row ? (row.updated_at === world.updatedAt ? 'untouched' : 'edited') : 'gone',
      unchanged: 0, restores: [], conflicts: [], leaves: [], wrote: false,
    }

    if (!row) {
      for (const leaf of world.nodes ?? []) {
        entry.leaves.push({ objectId: leaf.objectId, name: leaf.name, outcome: 'conflict', reason: 'the world is gone' })
        entry.conflicts.push({ objectId: leaf.objectId, name: leaf.name, reason: 'the world is gone' })
        report.totals.conflict += 1
      }
      report.worlds.push(entry)
      continue
    }

    const documentJson = row.document && row.document.length > 0 ? row.document : '{"asset":{"version":"2.0"},"nodes":[]}'
    const sha256 = sha256Json
    const candidates = []
    for (const leaf of world.nodes ?? []) {
      const verdict = classifyLeaf(documentJson, leaf, sha256)
      if (verdict.outcome === 'unchanged') {
        entry.leaves.push({ objectId: leaf.objectId, name: leaf.name, outcome: 'unchanged' })
        entry.unchanged += 1
        report.totals.unchanged += 1
      } else if (verdict.outcome === 'conflict') {
        entry.leaves.push({ objectId: leaf.objectId, name: leaf.name, outcome: 'conflict', reason: verdict.reason })
        entry.conflicts.push({ objectId: leaf.objectId, name: leaf.name, reason: verdict.reason })
        report.totals.conflict += 1
      } else {
        candidates.push(leaf)
      }
    }

    // The restore candidates go through the server's own loader + healing, in
    // document order, so the caps are re-checked cumulatively and what is
    // written is what the next load keeps.
    let restoredJson = null
    if (candidates.length > 0) {
      const candidateDoc = withRestoredLeaves(documentJson, candidates)
      const loaded = await createWorldFromDocument(candidateDoc, { logId: world.worldId })
      restoredJson = JSON.stringify(await loaded.serialize())
      const healed = objectIdIndex(restoredJson)
      const healedDoc = JSON.parse(restoredJson)
      for (const leaf of candidates) {
        const indices = healed.problem ? undefined : healed.index.get(leaf.objectId)
        const atrium = indices?.length === 1 ? healedDoc.nodes[indices[0]]?.extras?.atrium : null
        const kept = atrium?.behavior
        if (kept !== undefined && kept !== null && sha256Json(kept) === leaf.behaviorSha256) {
          entry.leaves.push({ objectId: leaf.objectId, name: leaf.name, outcome: 'restore' })
          entry.restores.push({ objectId: leaf.objectId, name: leaf.name, reason: 'the leaf was lost during the rollback' })
          report.totals.restore += 1
        } else {
          const check = behaviorCheck(leaf.behavior, { ownId: leaf.objectId })
          const reason = (indices?.length === 1 && !check.problem)
            ? 'a cap the restore would break'
            : (check.problem ? 'a leaf the rule now refuses' : 'the node no longer carries that objectId')
          entry.leaves.push({ objectId: leaf.objectId, name: leaf.name, outcome: 'conflict', reason })
          entry.conflicts.push({ objectId: leaf.objectId, name: leaf.name, reason })
          report.totals.conflict += 1
        }
      }
    }

    if (apply && entry.restores.length > 0 && restoredJson !== null) {
      database.prepare('UPDATE worlds SET document = ?, updated_at = ? WHERE id = ?')
        .run(restoredJson, nowIso, world.worldId)
      entry.wrote = true
      report.totals.writes += 1
      log(`[reconcile] world ${world.worldId}: restored ${entry.restores.length} leaf(s) (${entry.sinceExport})`)
    } else if (entry.restores.length > 0) {
      log(`[reconcile] world ${world.worldId}: would restore ${entry.restores.length} leaf(s) (${entry.sinceExport})`)
    }

    report.worlds.push(entry)
  }

  return report
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const [dbPath, exportPath] = args.filter((a) => a !== '--apply')
  if (!dbPath || !exportPath) {
    console.error('usage: node behaviors-reconcile.mjs <db> <export> [--apply]')
    process.exit(2)
  }

  const run = async () => {
    const { readFileSync } = await import('node:fs')
    let exported
    try {
      exported = JSON.parse(readFileSync(exportPath, 'utf8'))
    } catch (error) {
      console.error(`[reconcile] cannot read ${exportPath}: ${error.message}`)
      process.exit(1)
    }

    const resolvedDbPath = resolve(dbPath)

    // The offline check (R-L2 (a)): a live server's lifetime lock refuses.
    try {
      assertServerStopped(resolvedDbPath, { log: (line) => console.error(`[reconcile] ${line}`) })
    } catch (error) {
      console.error(`[reconcile] ${error.message}`)
      process.exit(1)
    }

    let db
    try {
      db = new Database(resolvedDbPath)
    } catch (error) {
      console.error(`[reconcile] cannot open ${resolvedDbPath}: ${error.message}`)
      process.exit(1)
    }

    // Atomicity, NOT the offline check (round 2's M2).
    try {
      db.exec('BEGIN IMMEDIATE')
    } catch (error) {
      console.error(`[reconcile] the database is in use (is the world server stopped?): ${error.message}`)
      db.close()
      process.exit(1)
    }

    try {
      const report = await reconcile(db, exported, { apply, log: (line) => console.log(line) })

      const byReason = {}
      for (const world of report.worlds) {
        console.log(`[reconcile] world ${world.worldId} ${quoteName(world.name)} (owner ${world.ownerId}, ${world.sinceExport} since the export): ` +
          `unchanged ${world.unchanged}, restore ${world.restores.length}, conflict ${world.conflicts.length}`)
        for (const leaf of world.leaves) {
          console.log(`  node ${leaf.objectId ?? '(no id)'} ${quoteName(leaf.name)}: ${leaf.outcome}` +
            (leaf.reason ? ` — ${leaf.reason}` : ''))
        }
        for (const conflict of world.conflicts) byReason[conflict.reason] = (byReason[conflict.reason] ?? 0) + 1
      }

      const untouched = report.worlds.filter((w) => w.sinceExport === 'untouched' && w.restores.length > 0).length
      const edited = report.worlds.filter((w) => w.sinceExport === 'edited' && w.restores.length > 0).length
      console.log(`[reconcile] ${apply ? 'APPLIED' : 'DRY RUN'}: unchanged ${report.totals.unchanged}, ` +
        `restore ${report.totals.restore}, conflict ${report.totals.conflict}, writes ${report.totals.writes}`)
      console.log(`[reconcile] worlds to ask: ${untouched} untouched since the export, ${edited} edited during the rollback`)
      console.log(`REPORT_JSON ${JSON.stringify({ ...report, totals: { ...report.totals, conflictsByReason: byReason, worldsUntouched: untouched, worldsEdited: edited } })}`)

      if (apply) db.exec('COMMIT')
      else db.exec('ROLLBACK')
      db.close()
      process.exit(0)
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* already rolled back */ }
      db.close()
      console.error(`[reconcile] failed: ${error.message}`)
      process.exit(1)
    }
  }

  run()
}

if (process.argv[1] && process.argv[1].endsWith('behaviors-reconcile.mjs')) main()
