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
| `probe_r16.py` | R16 / R18 | what `resolveObjectId` returns, the importer's grant line, and **the real Q3 Enable prompt** (a start-on-load graph, dismissed) |
| `probe_r24.py` | R24 | a ~3 MiB many-light `.gltf` through the panel: time to the mapping rows, the longest main-thread stall |
| `probe_c3.py` | (diagnosis) | check 3's click and interpolation outside c2's sequence, with and without the spinner |

## Results on DEV `7ad49f57` (round 6: `fe4dcbb3` + main `b0dd79bf`, devtasks/ only), 2026-10-31
**R30 and R31 hold; round 5's probe, check 11 and check 1 still pass.**

| Check | Result | Seen |
|---|---|---|
| R30, `probe_r30.mjs` | **PASS** 6/6 | the lock path before the database exists equals the file Atrium then creates, in all six layouts (round 5: two split, the review's and the absolute-target one) |
| R30, two real holders | **PASS** | the review's layout: the first holder takes `real/target.db.lock.db`, creates the database through the alias; a second through the same alias and a third on `real/target.db` both **refuse** (`another process holds …/real/target.db.lock.db (pid N, first)`); one lock file. The absolute-target layout: the same, one lock file |
| R31 | **PASS** | `a.db → b.db → a.db` as `ATRIUM_DB_PATH`: exit 1, `Atrium server refuses to start: could not resolve …/a.db: too many levels of symbolic links`, no stack trace |
| R25–R27, `probe_r5.sh` | **PASS** 10/10 | (its R25 block, R26 journal and cross-user crash, R27 exit by signal) |
| 11 (`c11.py`) | **PASS** 27/27 | |
| 1, 4, 7, 8 (`c1.py`) | **PASS** 34/34 | |

**Harness lesson:** `c1.py`'s check 8 restarts the server with `pkill -f signin-sync/authserver.mjs`; if the Bash
command that runs `c1.py` also contains that string (a stop command appended), the pkill kills the shell and the
check with it (exit 144). Run `c1.py` alone, and stop servers by pid in a separate command.

### Check 11 on the host, round 6 (the operator)
Round 5's block on the new SHA, without the restart. Expected: as round 5's (PROD all zeros; DEV's 10 leaves
`unchanged`, no writes; DEV's two lock files and no `-journal`; the export against DEV's live database refuses,
exit 1).
```bash
set -euo pipefail
R=/srv/atrium-dev; S=$R/packages/server/scripts; W=/root/rh4d-r6; B=$R/packages/server/node_modules/better-sqlite3
[ "$(git -C $R rev-parse HEAD)" = 7ad49f57811fc0068be5e90055e5f057ea381711 ] || { echo "DEV's checkout is not 7ad49f57: stop"; exit 1; }
mkdir -p -m 700 $W && cd $W
for pair in prod:/var/lib/atrium/atrium.db dev:/var/lib/atrium-dev/atrium.db; do n=${pair%%:*}; db=${pair#*:}; echo "== $n ($db)"
  node -e 'const D=require(process.argv[1]); const s=new D(process.argv[2],{readonly:true,fileMustExist:true}); s.backup(process.argv[3]).then(()=>{const c=new D(process.argv[3],{readonly:true}); console.log("integrity", c.pragma("integrity_check",{simple:true}))})' "$B" "$db" $W/$n-copy.db
  node $S/behaviors-export.mjs $W/$n-copy.db $W/$n-export.json | tail -1
  for a in "" --apply --apply; do node $S/behaviors-reconcile.mjs $W/$n-copy.db $W/$n-export.json $a | grep -v '^REPORT_JSON' | tail -2 | head -1; done
done
echo "== DEV's lock files"; ls -la /var/lib/atrium-dev/ | grep 'atrium.db.lock' || echo 'NO LOCK FILES (unexpected)'
set +e; node $S/behaviors-export.mjs /var/lib/atrium-dev/atrium.db $W/should-not-exist.json; echo "exit $? (expect 1)"; ls $W/should-not-exist.json 2>/dev/null && echo "UNEXPECTED: an export was written"
```

## Results on DEV `ddef0a31` (round 5: `e5369130` + main `627cc497`, devtasks/ only), 2026-10-31
**R25, R26 and R27 hold; checks 1, 4–8 and 11 pass.** `probe_r5.sh`, which reproduces all three bugs on round 4's
`1d4ccf17` (a second server through a dangling alias; a root-owned journal that stops the service user with `disk
I/O error`; exit code 143), passes 11/11 here.

| Check | Result | Seen |
|---|---|---|
| R25, `probe_r5.sh` | **PASS** | `alias.db → real.db` (missing): server A through the alias creates the database; a second server through the alias and one on `real.db` both **refuse**; export through either spelling refuses; one lock file, `real.db.lock.db` (round 4: two, `alias.db.lock.db` and `real.db.lock.db`, both held) |
| R26, `probe_r5.sh` | **PASS** | no `a.db.lock.db-journal` while a server holds the lock, nor after its `kill -9`; **the review's crash:** a root export holding the lock (paused) in a `1777` directory, `kill -9`'d, leaves only `nobody:a.db.lock.db` and `nobody:a.db.lock.json`, and the service user's server **starts** (round 4: a root journal and `disk I/O error`) |
| R27, `probe_r5.sh` | **PASS** | a SIGTERM'd server exits `{"code":null,"signal":"SIGTERM"}` (round 4: `{"code":143,"signal":null}`); the lock is free at once after |
| 11 (`c11.py`) | **PASS** 27/27 | unchanged from round 4, on the new code |
| 1, 4, 7, 8 (`c1.py`) | **PASS** 34/34 | |
| 5, 6 (`c5.py`) | **PASS** | host p95 frame time 96.5 ms (p50 77.0), skips 51.9/frame, nothing disabled, Throttled on all 64; the 4c tab never elected |
| DEV's journal | as predicted | the deploy that installed round 5 stopped round 4's server at 23:39 UTC: `status=143 … Failed with result 'exit-code'` — the last such stop. Round 5's server is pid 3148398 |

Checks 2, 3, 9 and 10 were not rerun: round 5 changed only `server-lock.js`, `index.js`, `db.js` and the lock tests.
**Noted, not fixed (N4, from card 1's handoff):** a symlink loop as the database path makes the server exit 1 with
Node's uncaught-error trace (through `index.js`'s legacy-lock check) instead of `Atrium server refuses to start: …`;
no hang. A later round.

### Check 11 on the host, round 5 (the operator)
As round 4's, plus R26 and R27 on the host. Reads PROD's and DEV's live databases, writes only under
`/root/rh4d-r5`, and **restarts DEV once** (seconds; DEV sessions reconnect). Expected: both copies `integrity
ok`; PROD 0 worlds / 0 leaves, all zeros; DEV 4 worlds / 9 leaves, `unchanged 9 … writes 0` three times; DEV's
lock files are `atrium.db.lock.db` and `atrium.db.lock.json` with **no `-journal`**; the export against DEV's live
database refuses (`the world server is running (pid N …)`), exit 1; after the restart, DEV's journal shows
**`Deactivated successfully`** and DEV is `active` again.
```bash
set -euo pipefail
R=/srv/atrium-dev; S=$R/packages/server/scripts; W=/root/rh4d-r5; B=$R/packages/server/node_modules/better-sqlite3
[ "$(git -C $R rev-parse HEAD)" = ddef0a31f3a484453d0ed5dd28353ffff35a4842 ] || { echo "DEV's checkout is not ddef0a31: stop"; exit 1; }
mkdir -p -m 700 $W && cd $W
for pair in prod:/var/lib/atrium/atrium.db dev:/var/lib/atrium-dev/atrium.db; do n=${pair%%:*}; db=${pair#*:}; echo "== $n ($db)"
  node -e 'const D=require(process.argv[1]); const s=new D(process.argv[2],{readonly:true,fileMustExist:true}); s.backup(process.argv[3]).then(()=>{const c=new D(process.argv[3],{readonly:true}); console.log("integrity", c.pragma("integrity_check",{simple:true}))})' "$B" "$db" $W/$n-copy.db
  node $S/behaviors-export.mjs $W/$n-copy.db $W/$n-export.json | tail -1
  for a in "" --apply --apply; do node $S/behaviors-reconcile.mjs $W/$n-copy.db $W/$n-export.json $a | grep -v '^REPORT_JSON' | tail -2 | head -1; done
done
echo "== DEV's lock files"; ls -la /var/lib/atrium-dev/ | grep 'atrium.db.lock' || echo 'NO LOCK FILES (unexpected)'
set +e; node $S/behaviors-export.mjs /var/lib/atrium-dev/atrium.db $W/should-not-exist.json; echo "exit $? (expect 1)"; ls $W/should-not-exist.json 2>/dev/null && echo "UNEXPECTED: an export was written"
echo "== one restart of DEV: the stop should be clean now"; systemctl restart atrium-dev; sleep 3
journalctl -u atrium-dev --since '-1 min' --no-pager | grep -E 'Deactivated|status=|Failed|listening' ; systemctl is-active atrium-dev
```

**Host result, round 5 (operator, 2026-10-31 16:49 PT): PASS.** PROD's copy: `integrity ok`, 0 worlds / 0 leaves,
all zeros. DEV's copy: `integrity ok`, 4 worlds / **10** leaves (one more than at round 4's check; added on DEV
since), `unchanged 10 … writes 0` three times. DEV's lock files: `atrium.db.lock.db` (0 B) and
`atrium.db.lock.json` (97 B), both `atrium-dev`, `-rw-------`; **no `-journal`** (round 4 had a 512 B one).
Against DEV's live database: `the world server is running (pid 3148398 on ubuntu-4gb-hil-1)…`, exit 1, nothing
written. **`systemctl restart atrium-dev`: `atrium-dev.service: Deactivated successfully.`** (23:49:35 UTC), then
pid 3150504 listening and `active`: the first clean stop of a 4d server (round 3's and round 4's ended `status=143
… Failed`).

## Results on DEV `1d4ccf17` (round 4: `85669db0` + main `c4b87111`, devtasks/ only), 2026-10-31
**Every round-4 item holds in the browser and on a real database; one new finding (F7).** Checks 9 and 10 were not
rerun: no round-4 card touched their areas (R23 adds declaration-map checks that check 10's leaves don't use).

| Check | Result | Seen |
|---|---|---|
| R18 (F5), `probe_r16.py` | **PASS** | grant line `It can change: Cube 2`; **the real Q3 prompt** (a start-on-load graph, dismissed) `It can also change: Cube 2. Enable it?` |
| R24 (review S2), `probe_r24.py` | **PASS** | a 3.15 MiB `.gltf`, 46,000 nodes + 46,000 lights, through the panel: ready in 1.05 s (upload included), longest main-thread stall 446 ms, the graph's two rows shown. Round 3: 33 s in Node. Node probe: 20,000 lights 66 ms (round 3: 4.9 s) |
| R23 (review S1), Node probe | **PASS** | a 65-char, 1,000-char and `a\n<b>` `outputValueSockets` key: refused by both copies (round 3: accepted) |
| 1, 4, 7, 8 (`c1.py`) | **PASS** 34/34 | check 1's R16 line now passes; delay hide/show at 0.86 s / 2.77 s |
| 2, 3 (`c2.py`, 120 s) | **PASS** | host 71 frames → 203.4° (predicted 203.4°); visitor 17.1/s; host closed at 1.9 s: visitor, saved document and new host agree. **The 30 s form missed check 3's click twice** (no select reached the host; `probe_c3.py` shows the click and interpolation work): a harness race, fixed by waiting for the visitor's pick to resolve the cube; two 30 s runs then 15/15 |
| 5, 6 (`c5.py`) | **PASS** | host p95 frame time 92.2 ms (round 3: 130.8), skips 51.7/frame, nothing disabled, Throttled on all 64; the 4c tab never elected |
| 11 (`c11.py`, local) | **PASS** 27/27 | as round 3, plus R22/R19: refusal through a symlink to the file and through a symlinked directory; `kill -9` of the server frees the lock at once and the export proceeds despite the stale sidecar; **a server start refuses while a paused export holds the lock** (`… (pid N, export)`), and the export then finishes; a leftover round-3 `<db>.lock` is ignored and logged |
| Review M1, rerun | **closed** | the sidecar emptied under a live server: export refuses (`another process holds … (an unknown process: …)`), a second server **refuses to start**, nothing deleted (round 3: export ran, the lock file was deleted, a second server started) |

### Findings
- **F7 (LOW; operations).** `packages/server/src/index.js` (round 3's R8, kept in round 4) handles SIGTERM with
  `process.exit(143)` and SIGINT with `process.exit(130)`. systemd treats an exit status of 143 as a failure (a
  process killed *by* SIGTERM is a clean stop): DEV's journal shows round 2's server `Deactivated successfully`
  on both stops (10:59, 14:35 UTC) and round 3's `Main process exited, code=exited, status=143 … Failed with
  result 'exit-code'` (20:25). So **every clean stop of a 4d server leaves the unit `failed`**, and Rev 1.6's new
  §8 line ("check `systemctl is-active atrium` reports `inactive`") would read `failed` mid-rollback. Under R22 the
  OS releases the kernel lock on any exit, so the handlers are no longer needed. Fix: drop both handlers (the
  `exit` hook can stay), test that a SIGTERM'd server exits *by the signal*, and say "anything but `active`" in
  §8. A host-side stopgap: `SuccessExitStatus=130 143` in the units' drop-ins.
- **Carried (Hermes, noted on the acceptance card):** `packages/server/src/db.js` L19–21 still says the scripts
  and the lock "agree on `<db>.lock`"; the lock is `<canonical db>.lock.db` now.

### Check 11 on the host, round 4 (the operator)
The same as round 3's block, for the new lock: reads PROD's and DEV's live databases, writes only under
`/root/rh4d-r4`, stops nothing. Expected: both copies `integrity ok`; PROD `0 world(s), 0 behaviour leaf(s)` and
all zeros; DEV `4 world(s), 9 behaviour leaf(s)` and `unchanged 9 … writes 0` three times; DEV's lock files listed
(`atrium.db.lock.db`, `atrium.db.lock.json`, owned by the service user); the last export **refuses** with `the
world server is running (pid N on ubuntu-4gb-hil-1)… (lock /var/lib/atrium-dev/atrium.db.lock.db)`, exit 1.
```bash
set -euo pipefail
R=/srv/atrium-dev; S=$R/packages/server/scripts; W=/root/rh4d-r4; B=$R/packages/server/node_modules/better-sqlite3
[ "$(git -C $R rev-parse HEAD)" = 1d4ccf17e62e9a94bb577d9c8ee694439a57c44b ] || { echo "DEV's checkout is not 1d4ccf17: stop"; exit 1; }
mkdir -p -m 700 $W && cd $W
for pair in prod:/var/lib/atrium/atrium.db dev:/var/lib/atrium-dev/atrium.db; do n=${pair%%:*}; db=${pair#*:}; echo "== $n ($db)"
  node -e 'const D=require(process.argv[1]); const s=new D(process.argv[2],{readonly:true,fileMustExist:true}); s.backup(process.argv[3]).then(()=>{const c=new D(process.argv[3],{readonly:true}); console.log("integrity", c.pragma("integrity_check",{simple:true}))})' "$B" "$db" $W/$n-copy.db
  node $S/behaviors-export.mjs $W/$n-copy.db $W/$n-export.json | tail -1
  for a in "" --apply --apply; do node $S/behaviors-reconcile.mjs $W/$n-copy.db $W/$n-export.json $a | grep -v '^REPORT_JSON' | tail -2 | head -1; done
done
ls -la /var/lib/atrium-dev/ | grep 'atrium.db.lock' || echo 'NO LOCK FILES (unexpected: DEV holds one)'
set +e; node $S/behaviors-export.mjs /var/lib/atrium-dev/atrium.db $W/should-not-exist.json; echo "exit $? (expect 1)"; ls $W/should-not-exist.json 2>/dev/null && echo "UNEXPECTED: an export was written"
```

**Host result, round 4 (operator, 2026-10-31 14:55 PT): PASS.** PROD's copy: `integrity ok`, 0 worlds / 0 leaves,
all zeros. DEV's copy: `integrity ok`, 4 worlds / 9 leaves, `unchanged 9 … writes 0` three times. DEV's lock files,
all `atrium-dev:atrium-dev`: `atrium.db.lock.db` (0 B, `-rw-------`), `atrium.db.lock.db-journal` (512 B,
`-rw-r--r--`, SQLite's, present while the lock is held), `atrium.db.lock.json` (97 B, `-rw-------`). Against DEV's
live database: `the world server is running (pid 3088813 on ubuntu-4gb-hil-1); stop it before running this script
(lock /var/lib/atrium-dev/atrium.db.lock.db)`, exit 1, nothing written; pid 3088813 is the server the journal shows
starting at 20:25 UTC. *Note:* `matchDatabaseOwnership` covers the lock database and the sidecar, not SQLite's
`-journal`; a journal a root script leaves after a crash is root's, readable by the service, in a directory the
service can write — the outside review was asked to judge it.

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
