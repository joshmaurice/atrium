// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// behaviors-rollback.test.js — scripting-4d-1 round 2, step 4 (G10); round 3,
// card 4 adds the offline check (R8, R-L2 (a)) and R11's escaping. The two
// rollback scripts on a scratch database built by the SERVER's own code
// (`createDb`), driven as real processes so the CLI, the two locks
// (`BEGIN IMMEDIATE` for atomicity; the server's lifetime lock file for the
// offline check) and `--apply` are all exercised.
//
// The three outcomes of `behaviors-reconcile.mjs`:
//   unchanged | the world exists, one node has that objectId, its leaf's sha256
//             | is the exported one. No write.
//   restore   | one node has that objectId and its leaf is null/absent. Written
//             | back if it still passes the rule and the caps.
//   conflict  | a different leaf, the node gone or duplicated, the world gone,
//             | a leaf the rule refuses, a cap the restore would break.
//
// These tests are also the tests proof (h) and (h2) ride on: (h) makes the
// reconcile restore whenever the node exists — the changed leaf is then
// overwritten and the "changed during the rollback" case fails; (h2) makes it
// treat an equal leaf as a conflict, and the untouched world is reported.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import Database from 'better-sqlite3'
import { createDb } from '../src/db.js'
import { createWorldFromDocument } from '../src/world.js'
import { behaviorCheck, behaviorLeafBytes } from '../src/send-policy.js'
import { templateGraph } from '../../behaviors/src/templates.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(__dirname, '..')
const EXPORT = resolve(SERVER, 'scripts/behaviors-export.mjs')
const RECONCILE = resolve(SERVER, 'scripts/behaviors-reconcile.mjs')

const dirs = []
after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }) })

function scratchDir() { const d = mkdtempSync(join(tmpdir(), 'atrium-rollback-')); dirs.push(d); return d }

const leafFor = (ownId) => templateGraph('select-animation', {
  target: randomUUID(), clip: 'Idle', action: 'play', loop: true,
}, { ownId })

/** A glTF document carrying one node per entry with `extras.atrium`. */
function documentWithNodes(entries) {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: entries.map((_, i) => i) }],
    nodes: entries.map((e) => ({ name: e.name, extras: { atrium: e.atrium } })),
  }
}

const run = (script, args, opts = {}) => new Promise((res) => {
  execFile(process.execPath, [script, ...args], { cwd: SERVER, ...opts }, (err, stdout, stderr) => {
    res({ code: err ? (err.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' })
  })
})

const reportOf = (stdout) => {
  const line = stdout.split('\n').find((l) => l.startsWith('REPORT_JSON '))
  assert.ok(line, `the report line is printed: ${stdout}`)
  return JSON.parse(line.slice('REPORT_JSON '.length))
}

/** Build a database with a user and the given worlds (id → { document, updatedAt }). */
function buildDb(dbPath, worlds) {
  const { database, close } = createDb(dbPath)
  const now = new Date().toISOString()
  database.prepare('INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)')
    .run('u-owner', 'owner', 'Owner', now)
  for (const [id, world] of Object.entries(worlds)) {
    database.prepare(
      'INSERT INTO worlds (id, owner_user_id, slug, name, document, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, 'u-owner', id, world.name ?? id, JSON.stringify(world.document), 'private', now, world.updatedAt ?? now)
  }
  close()
}

const readWorld = (dbPath, id) => {
  const db = new Database(dbPath)
  const row = db.prepare('SELECT document, updated_at FROM worlds WHERE id = ?').get(id)
  db.close()
  return row
}
const writeWorld = (dbPath, id, document, updatedAt) => {
  const db = new Database(dbPath)
  db.prepare('UPDATE worlds SET document = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(document), updatedAt, id)
  db.close()
}

// ===========================================================================
// Export
// ===========================================================================

test('G10: the export lists every non-null leaf with its sha256, per world', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'a.db')
  const outPath = join(dir, 'export.json')
  const idA = randomUUID(); const idB = randomUUID()
  const leafA = leafFor(idA)
  buildDb(dbPath, {
    w1: { document: documentWithNodes([
      { name: 'kept', atrium: { objectId: idA, behavior: leafA } },
      { name: 'empty', atrium: { objectId: randomUUID(), behavior: null } },
      { name: 'plain', atrium: { objectId: randomUUID() } },
    ]) },
    w2: { document: documentWithNodes([{ name: 'b', atrium: { objectId: idB, behavior: leafFor(idB) } }]) },
  })

  const result = await run(EXPORT, [dbPath, outPath])
  assert.equal(result.code, 0, result.stderr)
  const exported = JSON.parse(readFileSync(outPath, 'utf8'))
  assert.equal(exported.worlds.length, 2, 'both worlds are exported')
  const w1 = exported.worlds.find((w) => w.worldId === 'w1')
  assert.equal(w1.nodes.length, 1, 'ONLY the non-null leaf is listed')
  assert.equal(w1.nodes[0].objectId, idA)
  assert.equal(w1.nodes[0].name, 'kept')
  assert.match(w1.nodes[0].behaviorSha256, /^[0-9a-f]{64}$/, 'a sha256')
  const { createHash } = await import('node:crypto')
  assert.equal(w1.nodes[0].behaviorSha256,
    createHash('sha256').update(JSON.stringify(leafA)).digest('hex'), 'the sha256 of the leaf it lists')
  assert.deepEqual(w1.nodes[0].behavior, leafA)
})

// ===========================================================================
// Reconcile — the three outcomes
// ===========================================================================

/**
 * The standard fixture: a world untouched (W1), a lost leaf (W2), a changed
 * leaf (W3), a recreated node id (W4), a duplicated id (W5) and a deleted
 * world (W6). The export is taken BEFORE the "rollback" edits.
 */
async function rollbackFixture() {
  const dir = scratchDir()
  const dbPath = join(dir, 'r.db')
  const outPath = join(dir, 'export.json')

  const ids = {
    w1: randomUUID(), w2: randomUUID(), w3: randomUUID(), w4: randomUUID(), w5: randomUUID(), w6: randomUUID(),
  }
  const leaves = {
    w1: leafFor(ids.w1), w2: leafFor(ids.w2), w3: leafFor(ids.w3), w4: leafFor(ids.w4), w5: leafFor(ids.w5), w6: leafFor(ids.w6),
  }
  const before = new Date(Date.now() - 60_000).toISOString()
  buildDb(dbPath, {
    W1: { document: documentWithNodes([{ name: 'n1', atrium: { objectId: ids.w1, behavior: leaves.w1 } }]), updatedAt: before },
    W2: { document: documentWithNodes([{ name: 'n2', atrium: { objectId: ids.w2, behavior: leaves.w2 } }]), updatedAt: before },
    W3: { document: documentWithNodes([{ name: 'n3', atrium: { objectId: ids.w3, behavior: leaves.w3 } }]), updatedAt: before },
    W4: { document: documentWithNodes([{ name: 'n4', atrium: { objectId: ids.w4, behavior: leaves.w4 } }]), updatedAt: before },
    W5: { document: documentWithNodes([
      { name: 'n5a', atrium: { objectId: ids.w5, behavior: leaves.w5 } },
      { name: 'n5b', atrium: { objectId: ids.w5, behavior: leaves.w5 } },
    ]), updatedAt: before },
    W6: { document: documentWithNodes([{ name: 'n6', atrium: { objectId: ids.w6, behavior: leaves.w6 } }]), updatedAt: before },
  })

  // The export, from the world before the rollback.
  assert.equal((await run(EXPORT, [dbPath, outPath])).code, 0)

  // --- the "rollback": 4c heals every 4d leaf to null, and owners edit ---
  const later = new Date().toISOString()
  writeWorld(dbPath, 'W2', documentWithNodes([{ name: 'n2', atrium: { objectId: ids.w2, behavior: null } }]), later)
  writeWorld(dbPath, 'W3', documentWithNodes([{ name: 'n3', atrium: { objectId: ids.w3, behavior: leafFor(ids.w3) } }]), later)  // a DIFFERENT 4c-era leaf
  writeWorld(dbPath, 'W4', documentWithNodes([{ name: 'n4', atrium: { objectId: randomUUID(), behavior: null } }]), later)     // recreated with a NEW id
  // W5 keeps its duplicate; W1 is untouched.
  { const db = new Database(dbPath); db.prepare('DELETE FROM worlds WHERE id = ?').run('W6'); db.close() }   // a deleted world

  return { dir, dbPath, outPath, ids, leaves }
}

test('G10: the dry run writes nothing and reports unchanged / restore / conflict per world', async () => {
  const { dbPath, outPath } = await rollbackFixture()
  const snapshot = ['W1', 'W2', 'W3', 'W4', 'W5'].map((id) => [id, readWorld(dbPath, id).document])

  const result = await run(RECONCILE, [dbPath, outPath])
  assert.equal(result.code, 0, result.stderr)
  const report = reportOf(result.stdout)
  assert.equal(report.apply, false, 'a dry run by default')

  const byWorld = Object.fromEntries(report.worlds.map((w) => [w.worldId, w]))
  assert.equal(byWorld.W1.leaves[0].outcome, 'unchanged', 'the untouched world is unchanged, not a conflict')
  assert.equal(byWorld.W1.sinceExport, 'untouched')
  assert.equal(byWorld.W2.leaves[0].outcome, 'restore')
  assert.equal(byWorld.W2.sinceExport, 'edited', 'W2 was edited during the rollback')
  assert.equal(byWorld.W3.leaves[0].outcome, 'conflict')
  assert.equal(byWorld.W3.leaves[0].reason, 'the leaf changed during the rollback')
  assert.equal(byWorld.W4.leaves[0].outcome, 'conflict')
  assert.equal(byWorld.W4.leaves[0].reason, 'the node is gone')
  assert.equal(byWorld.W5.leaves[0].outcome, 'conflict')
  assert.equal(byWorld.W5.leaves[0].reason, 'the objectId is duplicated')
  assert.equal(byWorld.W6.leaves[0].outcome, 'conflict')
  assert.equal(byWorld.W6.leaves[0].reason, 'the world is gone')
  assert.equal(report.totals.writes, 0, 'the dry run wrote nothing')

  for (const [id, document] of snapshot) {
    assert.equal(readWorld(dbPath, id).document, document, `${id} must not have been written by the dry run`)
  }
})

test('G10: --apply restores exactly the lost leaf and nothing else, and a second --apply writes nothing', async () => {
  const { dbPath, outPath, ids, leaves } = await rollbackFixture()
  const w1Before = readWorld(dbPath, 'W1')

  const applied = await run(RECONCILE, [dbPath, outPath, '--apply'])
  assert.equal(applied.code, 0, applied.stderr)
  const report = reportOf(applied.stdout)
  assert.equal(report.totals.restore, 1, 'one leaf restored')
  assert.equal(report.totals.writes, 1, 'one world written')

  // W2's leaf is back, byte for byte.
  const w2 = JSON.parse(readWorld(dbPath, 'W2').document)
  assert.deepEqual(w2.nodes[0].extras.atrium.behavior, leaves.w2, 'exactly the untouched lost leaf')
  // W1 was not rewritten.
  assert.equal(readWorld(dbPath, 'W1').document, w1Before.document, 'the untouched world was not written')
  assert.equal(readWorld(dbPath, 'W1').updated_at, w1Before.updated_at)

  // The restored world LOADS in the server and its leaf passes G1.
  const loaded = await createWorldFromDocument(readWorld(dbPath, 'W2').document, { logId: 'W2' })
  const kept = loaded.som.getNodeByName('n2')?.extras?.atrium?.behavior
  assert.deepEqual(kept, leaves.w2)
  assert.equal(behaviorCheck(kept, { ownId: ids.w2 }).problem, null, 'the restored leaf passes the current rule')

  // Second apply: zero writes, and no NEW conflict.
  const second = await run(RECONCILE, [dbPath, outPath, '--apply'])
  const secondReport = reportOf(second.stdout)
  assert.equal(secondReport.totals.writes, 0, 'the second run writes nothing')
  assert.equal(secondReport.totals.restore, 0, 'and restores nothing')
  assert.equal(secondReport.totals.conflict, report.totals.conflict, 'and adds no conflict')
  const byWorld = Object.fromEntries(secondReport.worlds.map((w) => [w.worldId, w]))
  assert.equal(byWorld.W2.leaves[0].outcome, 'unchanged')
})

test('G10: the caps are re-checked cumulatively — a restore that would break the world total is a conflict', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'cap.db')
  const outPath = join(dir, 'cap-export.json')
  const lostId = randomUUID()
  const lost = leafFor(lostId)

  // The world after the rollback: the exported leaf was healed to null, and the
  // owners added VALID leaves that now fill the world to within 500 bytes of
  // 1 MiB, with the exported node LAST in document order. Restoring its ~1 kB
  // leaf would put the running total over the cap, so healing drops it and the
  // reconcile reports a conflict.
  const filler = (id, bytes) => {
    const leaf = leafFor(id)
    leaf.graph.pad = ''
    const wanted = bytes - behaviorLeafBytes(leaf)
    const multiByte = Math.floor(wanted / 3)
    leaf.graph.pad = '漢'.repeat(multiByte) + 'x'.repeat(wanted - multiByte * 3)
    assert.equal(behaviorLeafBytes(leaf), bytes)
    return leaf
  }
  const entries = []
  let total = 0
  for (let i = 0; i < 5; i++) { const id = randomUUID(); entries.push({ name: `f${i}`, atrium: { objectId: id, behavior: filler(id, 193_000) } }); total += 193_000 }
  { const id = randomUUID(); const size = 1024 * 1024 - 500 - total; entries.push({ name: 'f5', atrium: { objectId: id, behavior: filler(id, size) } }); total += size }
  entries.push({ name: 'lost', atrium: { objectId: lostId, behavior: null } })

  buildDb(dbPath, {
    WC: { document: documentWithNodes([{ name: 'lost', atrium: { objectId: lostId, behavior: lost } }]) },
  })
  assert.equal((await run(EXPORT, [dbPath, outPath])).code, 0)
  writeWorld(dbPath, 'WC', documentWithNodes(entries), new Date().toISOString())

  const result = await run(RECONCILE, [dbPath, outPath, '--apply'])
  const report = reportOf(result.stdout)
  const wc = report.worlds.find((w) => w.worldId === 'WC')
  assert.equal(wc.leaves[0].outcome, 'conflict')
  assert.equal(wc.leaves[0].reason, 'a cap the restore would break')
  assert.equal(report.totals.writes, 0, 'nothing was written')
})

// ===========================================================================
// The atomicity lock (`BEGIN IMMEDIATE`) — NOT the offline check (round 2 M2)
// ===========================================================================

test('G10: both scripts refuse while another connection holds the database', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'locked.db')
  const outPath = join(dir, 'locked-export.json')
  const id = randomUUID()
  buildDb(dbPath, { WL: { document: documentWithNodes([{ name: 'n', atrium: { objectId: id, behavior: leafFor(id) } }]) } })

  const holder = new Database(dbPath)
  holder.exec('BEGIN IMMEDIATE')   // the ATOMICITY lock (R8) — not the offline check
  try {
    const exported = await run(EXPORT, [dbPath, outPath])
    assert.notEqual(exported.code, 0, 'the export refuses')
    assert.match(exported.stderr, /the database is in use/)

    // The reconcile needs an export to read; write a minimal one directly.
    const { writeFileSync } = await import('node:fs')
    writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
    const reconciled = await run(RECONCILE, [dbPath, outPath])
    assert.notEqual(reconciled.code, 0, 'the reconcile refuses')
    assert.match(reconciled.stderr, /the database is in use/)
  } finally {
    holder.exec('ROLLBACK')
    holder.close()
  }
})

// ===========================================================================
// R8 / R-L2 (a) — the offline check: the server's LIFETIME lock file
// ===========================================================================

/** A pid that is certainly dead: a child that has exited and been reaped. */
const deadPid = () => new Promise((res) => {
  const child = execFile(process.execPath, ['-e', 'process.exit(0)'], () => res(child.pid))
})

const writeLock = (dbPath, pid) => writeFileSync(
  `${dbPath}.lock`, JSON.stringify({ pid, host: 'test-host', startedAt: new Date().toISOString() }) + '\n'
)

test('G10/R8: both scripts refuse while the server lifetime lock names a LIVE pid', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'live.db')
  const outPath = join(dir, 'live-export.json')
  const id = randomUUID()
  buildDb(dbPath, { WL: { document: documentWithNodes([{ name: 'n', atrium: { objectId: id, behavior: leafFor(id) } }]) } })

  // The lock file exactly as `acquireServerLock` writes it, naming a live pid
  // (this test's own process — alive, and never the child script's pid).
  writeLock(dbPath, process.pid)

  const exported = await run(EXPORT, [dbPath, outPath])
  assert.notEqual(exported.code, 0, 'the export refuses')
  assert.match(exported.stderr, /the world server is running \(pid \d+ on test-host\)/)
  assert.equal(existsSync(outPath), false, 'nothing was written')

  writeFileSync(outPath, JSON.stringify({ version: 1, worlds: [] }))
  const reconciled = await run(RECONCILE, [dbPath, outPath])
  assert.notEqual(reconciled.code, 0, 'the reconcile refuses')
  assert.match(reconciled.stderr, /the world server is running \(pid \d+ on test-host\)/)

  // A refusal does NOT remove the server's lock: it is still held.
  assert.equal(existsSync(`${dbPath}.lock`), true, 'the live lock file survives the refusal')
})

test('G10/R8: a STALE server lifetime lock is warned about and removed, and both scripts proceed', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'stale.db')
  const outPath = join(dir, 'stale-export.json')
  const id = randomUUID()
  buildDb(dbPath, { WS: { document: documentWithNodes([{ name: 'n', atrium: { objectId: id, behavior: leafFor(id) } }]) } })

  const dead = await deadPid()
  writeLock(dbPath, dead)

  const exported = await run(EXPORT, [dbPath, outPath])
  assert.equal(exported.code, 0, exported.stderr)
  assert.match(exported.stderr, new RegExp(`stale lock from pid ${dead}, removed`))
  assert.equal(existsSync(`${dbPath}.lock`), false, 'the stale lock file was removed')
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).worlds.length, 1, 'the export proceeded')

  // Stale again, for the reconcile.
  writeLock(dbPath, dead)
  const reconciled = await run(RECONCILE, [dbPath, outPath])
  assert.equal(reconciled.code, 0, reconciled.stderr)
  assert.match(reconciled.stderr, new RegExp(`stale lock from pid ${dead}, removed`))
  assert.equal(existsSync(`${dbPath}.lock`), false, 'the stale lock file was removed again')
  assert.equal(reportOf(reconciled.stdout).totals.writes, 0, 'a dry run still writes nothing')
})

// ===========================================================================
// R11 — names are printed through JSON.stringify
// ===========================================================================

test('G10/R11: a name with a newline cannot forge a record line — one line per node, one per world', async () => {
  const dir = scratchDir()
  const dbPath = join(dir, 'names.db')
  const outPath = join(dir, 'names-export.json')
  const idA = randomUUID(); const idB = randomUUID()
  const leafA = leafFor(idA); const leafB = leafFor(idB)
  const forgedNode = 'crate\n[reconcile] APPLIED: unchanged 0, restore 0, conflict 0'
  const forgedWorld = 'My World\n[export] wrote /etc/passwd: 9 world(s)'
  buildDb(dbPath, {
    WN: {
      name: forgedWorld,
      document: documentWithNodes([
        { name: forgedNode, atrium: { objectId: idA, behavior: leafA } },
        { name: 'plain', atrium: { objectId: idB, behavior: leafB } },
      ]),
    },
  })

  const result = await run(EXPORT, [dbPath, outPath])
  assert.equal(result.code, 0, result.stderr)
  const lines = result.stdout.split('\n')

  assert.equal(lines.filter((l) => l.startsWith('  node ')).length, 2,
    `one record line per node, not per newline: ${result.stdout}`)
  assert.equal(lines.filter((l) => l.startsWith('[export] world ')).length, 1,
    'one world line, not per newline in the world name')
  assert.equal(lines.filter((l) => l.startsWith('[export] wrote ')).length, 1,
    'the forged `[export] wrote` line never starts a line')
  assert.equal(lines.some((l) => l.startsWith('[reconcile] APPLIED')), false,
    'the forged `[reconcile] APPLIED` line never starts a line')

  const crypto = await import('node:crypto')
  const expectedNode = `  node ${idA} ${JSON.stringify(forgedNode)} sha256 ` +
    crypto.createHash('sha256').update(JSON.stringify(leafA)).digest('hex')
  assert.ok(result.stdout.includes(expectedNode), `the node name is JSON-quoted: ${result.stdout}`)
  assert.ok(result.stdout.includes(JSON.stringify(forgedWorld)), 'the world name is JSON-quoted')

  // The reconcile prints the same names, escaped, from the same export.
  const reconciled = await run(RECONCILE, [dbPath, outPath])
  assert.equal(reconciled.code, 0, reconciled.stderr)
  const rLines = reconciled.stdout.split('\n')
  assert.equal(rLines.filter((l) => l.startsWith('  node ')).length, 2,
    `one leaf line per node: ${reconciled.stdout}`)
  assert.equal(rLines.filter((l) => l.startsWith('[reconcile] world ')).length, 1)
  assert.equal(rLines.some((l) => l.startsWith('[reconcile] APPLIED:')), false,
    'the forged `[reconcile] APPLIED` line never starts a line')
  assert.ok(reconciled.stdout.includes(JSON.stringify(forgedNode)), 'the node name is JSON-quoted here too')
  assert.ok(reconciled.stdout.includes(JSON.stringify(forgedWorld)), 'the world name is JSON-quoted here too')
})
