// scripting-4d-1 round 6, R30: for six database-path layouts (the database missing at first), the lock path a harness
// root's canonicalDbPath computes BEFORE the database exists vs the file Atrium then creates through
// resolve(configured path). "SPLIT" = one database, two lock paths. Also prints a reference resolver ("candidate")
// that follows link targets the kernel's way (realpathSync.native, no textual .. folding).  node probe_r30.mjs <wt>
import { realpathSync, lstatSync, readlinkSync, writeFileSync, mkdirSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { dirname, basename, join, isAbsolute, resolve } from 'node:path'
const W = process.argv[2]
const { canonicalDbPath: round5 } = await import(W + '/packages/server/src/server-lock.js')
// candidate: never normalise lexically; build raw strings, let the kernel resolve them
function candidate(dbPath) {
  let path = resolve(dbPath)       // what Atrium opens (db.js resolveDbPath); link TARGETS are then followed as the kernel does
  for (let hops = 0; ; hops++) {
    try { return realpathSync.native(path) } catch {}
    let st; try { st = lstatSync(path) } catch { break }
    if (!st.isSymbolicLink()) break
    if (hops >= 40) throw new Error('too many levels of symbolic links')
    const t = readlinkSync(path)
    path = isAbsolute(t) ? t : dirname(path) + '/' + t        // dirname of a raw string strips one component, no '..' folding
  }
  try { return join(realpathSync.native(dirname(path)), basename(path)) } catch { return path }
}
const R = '/tmp/canon'; rmSync(R, { recursive: true, force: true })
const cases = {
  'plain dangling link':                  (d) => { symlinkSync(d + '/real.db', d + '/a.db'); return d + '/a.db' },
  'review r5: symlinked dir + ../ target': (d) => { mkdirSync(d + '/real/child', { recursive: true }); symlinkSync('real/child', d + '/linkdir'); symlinkSync('../target.db', d + '/real/child/a.db'); return d + '/linkdir/a.db' },
  '.. in the configured path itself':     (d) => { mkdirSync(d + '/real/child', { recursive: true }); symlinkSync('real/child', d + '/linkdir'); return d + '/linkdir/../x.db' },
  'absolute target through a symlinked dir and ..': (d) => { mkdirSync(d + '/real/child', { recursive: true }); symlinkSync('real/child', d + '/linkdir'); symlinkSync(d + '/linkdir/../t.db', d + '/a.db'); return d + '/a.db' },
  'two hops, relative':                   (d) => { mkdirSync(d + '/s'); symlinkSync('s/b.db', d + '/a.db'); symlinkSync('../real.db', d + '/s/b.db'); return d + '/a.db' },
  'no link, missing file':                (d) => d + '/plain.db',
}
let i = 0
for (const [label, make] of Object.entries(cases)) {
  const d = `${R}/${i++}`; mkdirSync(d, { recursive: true }); const p = make(d)
  const b5 = round5(p), bc = candidate(p)
  writeFileSync(resolve(p), '')                                       // create it as Atrium does: SQLite opens resolve(path), the kernel follows links
  const truth = realpathSync.native(resolve(p)), a5 = round5(p), ac = candidate(p)
  console.log(`${label}\n   truth ${truth.replace(R, '')}\n   round 5: before ${b5.replace(R, '')}  ${b5 === truth ? 'OK' : 'SPLIT'}\n   candidate: before ${bc.replace(R, '')}  ${bc === truth && ac === truth ? 'OK' : 'SPLIT'}`)
}
