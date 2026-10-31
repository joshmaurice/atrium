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
```

| Script | Checks | Notes |
|---|---|---|
| `c1.py` | 1 (import, map, grant, saved disabled, enable, visitor click), 4 ("Partially supported"), 7 (XSS), 8 (restart from the saved document) | check 4's graph awaits R-L4 (round 3); on `7a60dbb8` the importer refuses the material get feeding a write |
| `c2.py` | 2 (`onTick` rotation: host per frame, visitor ≤ 20/s, no refused value), 3 (`pointer/interpolate`, then the host closed at 1.9 s with a second owner tab) | the yaw of a Y-axis quaternion is `2·atan2(y, w)`; `obj_rot` is the three.js object, `rot` the SOM |
| `c5.py` | 5 (64 behaviours, 8 heavy; p95 frame time, skips, "Throttled", nothing disabled, a light graph still turns), 6 (a stale 4c owner tab, `scriptRunner: 2`, never the host) | leaves are written with `sendField` (the panel is check 1's subject); a heavy tick is ~3,000 node starts at `LOOP=600` |
| 9, 10, 11 | not yet scripted | 9: `../scripting-4c/reg4c.sh` + the 4c checks; 10: Q7's A/B, five runs, three visitors, heap via CDP; 11: the rollback rehearsal (local first, then the operator on a PROD copy) |

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
