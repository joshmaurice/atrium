# scripting-4d-1 — Claude's browser checks (pre-brief §6.1)

Run against the round's DEV SHA before DEV acceptance. Every script prints `PASS`/`FAIL` per
expectation and exits 1 on any FAIL. They build on `../scripting-4c/common.py` (real sign-in, real
mouse clicks) and author KHR_interactivity graphs in the fixtures' form (`common4d.py`), wrapped
into a glTF document and imported **through the panel** (`#ep-import-*`), as an owner would.

## Server
`checks/signin-sync/authserver.mjs` with `HOOKS=1` (it now exposes `__beh().importPanel` too), a
short autosave debounce, and `STALE_ROOT` for check 6. Check 8 restarts it itself with `KEEP_DB=1`.

```bash
HARNESS_ROOT=/tmp/atrium-harness devtasks/harness/setup.sh <DEV release-merge SHA>
HARNESS_ROOT=/tmp/ah-base        devtasks/harness/setup.sh 14ab0076     # PROD's code: the stale page (6), the regression baseline (9)
# (a second root can symlink the first one's vendor, vsrc, khronos, lib-*, gsa)
ATRIUM_AUTOSAVE_DEBOUNCE_MS=3000 STALE_ROOT=/tmp/ah-base HOOKS=1 HARNESS_ROOT=/tmp/atrium-harness \
  node devtasks/harness/checks/signin-sync/authserver.mjs        # Bash run_in_background
cd devtasks/harness/checks/scripting-4d
HARNESS_ROOT=/tmp/atrium-harness STALE_ROOT=/tmp/ah-base python3 c1.py   # checks 1, 4, 7, 8 (8 restarts the server)
HARNESS_ROOT=/tmp/atrium-harness ROT_SECONDS=120 python3 c2.py          # checks 2, 3 (ROT_SECONDS defaults to 30)
HARNESS_ROOT=/tmp/atrium-harness LOOP=600 python3 c5.py                 # checks 5, 6 (64 cubes: ~80 s to place)
HARNESS_ROOT=/tmp/atrium-harness RUNS=5 python3 c10.py                  # check 10 (≈ 6 min; the server above, no STALE_ROOT needed)
HARNESS_ROOT=/tmp/atrium-harness python3 probe_r16.py                   # R16: what the page names a grant with
# checks 9 and 11 start and stop their own servers: stop the one above first (kill its pid; `pkill -f` matches your own shell)
ATRIUM_REPO=<the clone setup.sh ran with> HARNESS_ROOT=/tmp/atrium-harness BASE_ROOT=/tmp/ah-base ./c9.sh   # ≈ 45 min, run_in_background
HARNESS_ROOT=/tmp/atrium-harness BASE_ROOT=/tmp/ah-base python3 c11.py  # ≈ 2 min
```

| Script | Checks | Notes |
|---|---|---|
| `c1.py` | 1 (import, map, grant, saved disabled, enable, visitor click), 4 ("Partially supported"), 7 (XSS), 8 (restart from the saved document) | check 4 is R-L4 (a)'s two graphs: hover (`KHR_node_hoverability`) + a `/materials/…` set nothing reads → listed, the rest runs, the write inert; the same pointer read by `math/extract4` → refused at import, naming both. Check 1's grant line expects object names (R16) |
| `c2.py` | 2 (`onTick` rotation: host per frame, visitor ≤ 20/s, no refused value), 3 (`pointer/interpolate`, then the host closed at 1.9 s with a second owner tab) | the yaw of a Y-axis quaternion is `2·atan2(y, w)`; `obj_rot` is the three.js object, `rot` the SOM |
| `c5.py` | 5 (64 behaviours, 8 heavy; p95 frame time, skips, "Throttled", nothing disabled, a light graph still turns), 6 (a stale 4c owner tab, `scriptRunner: 2`, never the host) | leaves are written with `sendField` (the panel is check 1's subject); a heavy tick is ~3,000 node starts at `LOOP=600` |
| `c9.sh` | 9 | `reg4c.sh` (a copy pointed at this clone) on the base root and the round's, `regdiff.py`; 4c's `c1.py`–`c3.py` (the base `authserver.mjs` on :8447 for 4c check 13); signin-sync `c.py`, `c4b.py` (`/tmp/ah` → the round's root). `PARTS=123` picks parts. Results in `/tmp/reg/4d/_summary.txt`. `ATRIUM_REPO` must be a clone with `scripts/library-build` installed (`server.mjs` needs sharp) |
| `c10.py` | 10 (Q7) | world A: 8 leaves of `debug/log` messages (3-byte CJK, 2-byte Latin, emoji), 1,047,001 B by the server's measure, stored disabled; world B: the same cubes, no leaves; 5 runs each, interleaved, each from an UNLOADED world (past the 3 s teardown) so it logs a heal; three fresh anonymous visitors join at once with NO socket route; heap and som-dump bytes through CDP; then a send past the total |
| `c11.py` | 11 (local) | phase 1 on the round, phase 2 on the base (PROD's 4c) over the SAME database (`AUTH_DB=/tmp/rh/prod.db`, `KEEP_DB=1`), phase 3 the round again; backups with SQLite's backup API; the scripts from the round's root. The host half is the operator's block below |
| `probe_r16.py` | R16 | prints what `resolveObjectId` returns and what the importer's grant line and the Q3 prompt show |

## Results on DEV `5eebe09f` (round 3: `769825ce` + main), 2026-10-31
**All eleven run. Ten pass (check 11 locally and on the host); check 1 passes except its R16 line (F5).** Two new findings (F5, F6), one note (N2).

| Check | Result | Measured / seen |
|---|---|---|
| 1 | **PASS except R16** | F1 fixed in a real browser: the visitor's click hides the target at 0.84 s and shows it at 2.86 s. Mapping, Save gating, saved disabled, Enable without a prompt all as before. **The grant line still shows the raw id** (F5) |
| 2 | **PASS** (120 s) | host: 67 frames in 2 s → 194.8° (predicted 191.9°); visitor 15.2 steps/s; no `INVALID_VALUE`, nothing refused, unit quaternion throughout |
| 3 | **PASS** | steady: visitor's last value = target (30 steps); host closed at 1.99 s: visitor, saved document and the new host (`hostGen` 2) all `[1.3026, 0.5, -2.17435]`, nothing sent after |
| 4 | **PASS** (R-L4 (a)) | report lists `event/onHoverIn (KHR_node_hoverability) ×1` and the material pointer, `Kept:` it; status "Partially supported: event/onHoverIn with the extension KHR_node_hoverability (1 nodes); /materials/0/pbrMetallicRoughness/baseColorFactor (1 nodes)"; scale 1.5 on host and visitor; nothing refused, no material set on the wire. The read variant: *the reference … (node 2's pointer) is read by math/extract4 at node 3; its meaning can't survive the import*, Save disabled, nothing stored |
| 5 | **PASS** | 64 leaves; heavy tick 3,004 node starts; **host p95 frame time 130.8 ms** (p50 102.0, max 158.3; SwiftShader; round 2: 116); skips mean 54.7/frame; nothing disabled; a light graph turned 25.8° in 4 s; "Throttled" on all 64 |
| 6 | **PASS** | the 4c tab (`scriptRunner: 2`) is never elected, before or after A closes; a 4d tab takes over (`hostGen` 2) |
| 7 | **PASS** | HTML in the file name, node name, op name and event id reach the DOM as text; no `<img>`, `__xss` unset |
| 8 | **PASS** | session survives the restart; both leaves back byte for byte; no dropped/malformed lines; check 1's graph hides and shows again; check 4's runs again, "Partially supported", nothing refused |
| 9 | **PASS** | regression set 30/30 exit 0 on both roots, 28 SAME + 2 DIFF that are noise (a WebGL driver-warning id; timing digits in 4a `c1`); 4c `c1` 18/18, `c2` 12/12; 4c `c3` 8 PASS + 3 FAIL **on the `scriptRunner` literal only** (it expects 4c's 2 for the current page and 1 for the stale one; 4d sends 3 and the stale 4c page 2, per G-L9) — every behavioural half holds (A hosts, the cross-origin tab isn't host, the stale tab is never elected); signin-sync `c.py` 22/22, `c4b.py` PASS |
| 10 | **PASS** (Q7) | world A 1,047,001 B of leaves (1,575 under the cap); medians of 5: **join (slowest of three) A 0.815 s vs B 0.272 s, +0.543 s** (gate 1.5 s; mean of three +0.390 s); **heal + serialize 28 ms** (27 + 1; gate 250 ms); **visitor heap +2.5 MB** (B +1.6; gate 50 MB); som-dump on the wire 1,060,865 B vs 13,768 B. A send past the total: `INVALID_VALUE` "this world's behaviours would exceed 1 MiB", no leaf; a 935 B leaf that fits is accepted. Localhost: a visitor on a slow link adds transfer time for the extra ~1 MiB |
| 11 | **PASS** (local, 20/20; host half PASS, below) | with the 4d server up both scripts refuse (`the world server is running (pid N on vm)…`); clean stop removes `<db>.lock`; backup opens, `integrity_check ok`; export: 4 leaves. 4c over the same DB: no lock (F6), heals N1–N3 to null in memory, the transform edit saves the nulls, N2 ← 4c template, N3 deleted + a new cube; bob's offline world keeps its leaf in storage. Dry run: N1 restore, N2 conflict *the leaf changed during the rollback*, N3 conflict *the node is gone*, B1 unchanged, W1 `edited`, W2 `untouched`, 0 writes. `--apply`: 1 write, N1 byte for byte, every newer change kept. Second `--apply`: 0 writes, the same conflicts. A stale lock: warned, removed, proceeds. 4d again: no healing, N1's graph live and a visitor's click hides N4 |

### Findings
- **F5 (LOW; R16 not delivered in the browser).** `app.js` L3268 (the importer's grant line) **and L3222 (the Q3
  Enable prompt)** pass `nodeName: (id) => client.som?.resolveObjectId?.(id)?.name ?? id`, but `resolveObjectId`
  returns `{ node }` or `{ problem }` (`SOMDocument.js` L1116), so `.name` is always undefined and both show the
  raw id. `probe_r16.py`: `resolveObjectId(id)` → keys `['node']`; grant line `It can change: 163c3b30-…`; prompt
  `It can also change: 163c3b30-…`. L3222 was the same in round 2, so the Q3 prompt never named objects (the
  revision's F4 premise). The unit tests inject their own `nodeName`. Fix: `?.node?.name`, and one test through
  the app's real dependency (or the SOM's real return shape).
- **F6 (LOW; the lock's reach).** (a) The 4c server a rollback runs creates no `<db>.lock` (it predates R8), so
  during the rollback window the scripts can't see a live server: c11 ran a reconcile dry run with 4c up, exit 0.
  The §8 procedure already stops the server before step 4, so this is a runbook line, not code. (b) The lock is
  keyed on the path *string* (`resolve`, no `realpath`): with a server on `/tmp/lk/link.db`, export refused
  through that spelling and **proceeded through a symlink to the same file**. Fix: `realpathSync` the database
  path on both sides before deriving `<db>.lock` (the file must exist; the server can create it first).
- **N2 (the release pipeline, not the round).** `atrium-deploy-gate dev <reviewed>` runs `atrium-release-merge`,
  which prints `RELEASE_SHA=` **first**, then `exec`s `atrium-deploy dev <RELEASE_SHA>` (no `RELEASE_SHA`, no
  deploy: exit 70). So a successful deploy's `TARGET_SHA` *is* the release SHA by construction; the line is only
  missing from the board's handoff because the deployer's tool keeps the output's tail. A finalizer whose
  criterion is "`TARGET_SHA == RELEASE_SHA` from the handoff" therefore blocks every round (round 3's
  `t_7e0acd73`). Either the deployer's handoff carries the gate's first lines (`RELEASE_SHA=`) in its metadata,
  or the card's criterion names the evidence that exists: `release/<12 hex>` = `TARGET_SHA` and
  `atrium-release-status` (DEV actual = recorded = `TARGET_SHA`, healthy).

### Check 11 on the host (the operator; a COPY of PROD's database)
Reads PROD's and DEV's live databases, writes only under `/root/rh4d`, stops nothing. ≈ 1 minute. Expected:
`integrity ok`; every exported leaf `unchanged`, `writes 0`, `conflict 0` three times (no rollback happened, so
this proves the tools on the host's real data); the last command **refuses** with `the world server is running
(pid N …)`, exit 1, no file written. Paste the whole output back.
```bash
set -euo pipefail
R=/srv/atrium-dev; S=$R/packages/server/scripts; W=/root/rh4d
[ "$(git -C $R rev-parse HEAD)" = 5eebe09fd5b000e70d50a36a9c926e6263d86e80 ] || { echo "DEV's checkout is not 5eebe09f: stop"; exit 1; }
dbof() { local pid p; pid=$(systemctl show -p MainPID --value "$1"); p=$(tr '\0' '\n' < /proc/$pid/environ | sed -n 's/^ATRIUM_DB_PATH=//p')
  case "$p" in /*) ;; '') p="$(readlink /proc/$pid/cwd)/atrium.db" ;; *) p="$(readlink /proc/$pid/cwd)/$p" ;; esac; echo "$p"; }
PROD_DB=$(dbof atrium.service); DEV_DB=$(dbof atrium-dev.service); echo "PROD_DB=$PROD_DB"; echo "DEV_DB=$DEV_DB"
[ -f "$PROD_DB" ] && [ -f "$DEV_DB" ] || { echo "a database path is wrong: stop"; exit 1; }
mkdir -p -m 700 $W && cd $W
# 1. SQLite's online backup of PROD (never a file copy), then verify the copy
node -e 'const D=require(process.argv[1]); const s=new D(process.argv[2],{readonly:true,fileMustExist:true}); s.backup(process.argv[3]).then(()=>{const c=new D(process.argv[3],{readonly:true}); console.log("integrity", c.pragma("integrity_check",{simple:true}), "| worlds", c.prepare("select count(*) n from worlds").get().n)})' \
  "$R/packages/server/node_modules/better-sqlite3" "$PROD_DB" $W/prod-copy.db
sha256sum $W/prod-copy.db
# 2. export; 3. reconcile: dry run, --apply, --apply (all on the COPY)
node $S/behaviors-export.mjs $W/prod-copy.db $W/export.json | tail -1
for a in "" --apply --apply; do node $S/behaviors-reconcile.mjs $W/prod-copy.db $W/export.json $a | grep -v '^REPORT_JSON' | tail -2; done
# 4. the lifetime lock, against DEV's LIVE database (DEV runs 4d): must refuse before opening it
set +e; node $S/behaviors-export.mjs "$DEV_DB" $W/should-not-exist.json; echo "exit $? (expect 1)"; ls $W/should-not-exist.json 2>/dev/null && echo "UNEXPECTED: an export was written"
```

**Host result (operator, 2026-10-31 10:30 PT): PASS.** `PROD_DB=/var/lib/atrium/atrium.db`,
`DEV_DB=/var/lib/atrium-dev/atrium.db`. The copy: `integrity ok`, 23 worlds, sha256 `6294449d87859133…`. Export:
0 worlds, 0 leaves; dry run, `--apply`, `--apply`: all zeros, `writes 0`. Against DEV's live database: `the world
server is running (pid 2991794 on ubuntu-4gb-hil-1); stop it before running this script (lock file
/var/lib/atrium-dev/atrium.db.lock)`, exit 1, no file written. **What it proves:** the tools open PROD's real
schema and data and change nothing, and the lifetime lock stops them against a live 4d server on the host.
**What it can't:** PROD has no behaviours at all today (confirmed by a direct scan of the copy and the live
database: 0), so the operator ran the same tools on **a copy of DEV's database (10:48 PT)**, which holds 9 real 4c
template leaves in 4 worlds (`select-visibility` ×6, `proximity-animation` ×2, `interval-animation` ×1):
`integrity ok`; export `4 world(s), 9 behaviour leaf(s)`; dry run, `--apply`, `--apply`: `unchanged 9, restore 0,
conflict 0, writes 0` each time. So on real host data the tools see every leaf, classify an untouched one as
`unchanged` and write nothing; the restore and conflict paths rest on the local rehearsal (20/20). A rollback to 4c
loses only 4d-only leaves, and none exist on PROD until 4d ships.

## Results on DEV `7a60dbb8` (round 2), 2026-10-31
2, 3, 5, 6, 7 PASS; 1 and 8 FAIL on **F1** (`flow/setDelay` → `Illegal invocation`: `adapter.js` L273 calls the
injected `setTimeout` as a method of the delay table); 4 can't run as written (**F2**, the importer's S3 rule);
9–11 not run. Details: `devtasks/REVISION-scripting-4d-1-round-3.md` §1.

## Lessons
- **The suites run in Node, where `setTimeout` ignores `this`.** A browser's doesn't. Any injected host
  function is called unbound, and its fake in tests is `this`-sensitive (R6).
- **Server messages are `{ type: 'set', node, field, value, … }`** on the wire (not `som:set`, which is the
  client's event name).
- **Sample motion over ≥ 4 s under load.** With 64 engines in rotation a light engine ticks every ~6 frames
  at the harness's ~11 fps; a 2 s window can see nothing.
- **A `nohup` server and a child started by a check die with the reply/script.** Start the harness server with
  the Bash tool's `run_in_background`; after check 8's restart, start it again that way.
