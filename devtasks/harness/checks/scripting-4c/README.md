# scripting-4c — Claude's browser checks (pre-brief §6.1)

Run against the DEV SHA (`a02c2429`, the release merge of `6378b49b`; its code equals the tip's)
before DEV acceptance. Every script prints `PASS`/`FAIL` per expectation and exits 1 on any FAIL.

## Servers

| Script | Server | Code |
|---|---|---|
| `c1.py`, `c2.py`, `c3.py` | `checks/signin-sync/authserver.mjs` with `HOOKS=1` (and `STALE_ROOT` for `c3.py`) on :8443/:8444 — the REAL server, its DB and real sign-in | 4c |
| `c3.py` check 13 | a second `authserver.mjs` on :8447/:8448 (`PORT_A`/`PORT_B`, its own `AUTH_DB`) | the base, `71b6e40b` (= `ab02239b`'s code) |
| `reg4c.sh` | starts `harness/server.mjs` itself | base, then 4c |
| signin-sync `c.py`, `c4b.py` | `authserver.mjs` with no `HOOKS` (`c4b.py` hard-codes `/tmp/ah`: symlink it to the root) | 4c |

```bash
# two harness roots
HARNESS_ROOT=/tmp/atrium-harness devtasks/harness/setup.sh a02c2429ea0c7db23c5554abdfd92ef9b444ce04
HARNESS_ROOT=/tmp/ah-base        devtasks/harness/setup.sh 71b6e40b7d897048f3397ce108421c98e1901ce9
# the 4c real server, with the page hooks and the stale-page tree (Bash run_in_background, a long timeout)
STALE_ROOT=/tmp/ah-base HOOKS=1 HARNESS_ROOT=/tmp/atrium-harness node devtasks/harness/checks/signin-sync/authserver.mjs
# the base real server on another origin, for check 13
PORT_A=8447 PORT_B=8448 AUTH_DB=/tmp/ah-base/auth.db HARNESS_ROOT=/tmp/ah-base node devtasks/harness/checks/signin-sync/authserver.mjs
cd devtasks/harness/checks/scripting-4c
HARNESS_ROOT=/tmp/atrium-harness python3 c1.py   # checks 1, 2, 3, 6, 7, 8
HARNESS_ROOT=/tmp/atrium-harness python3 c2.py   # checks 4, 5, 12, 11
HARNESS_ROOT=/tmp/atrium-harness python3 c3.py   # checks 13, 10
```

## How the checks are driven

- **Real sign-in.** alice registers through `/api/auth/register`; her tabs share one browser context
  (one cookie), so a new tab is signed in and auto-connects to her home world, as in a real browser.
  The visitor is a separate context with no cookie: anonymous.
- **A fresh public world per run** (`new_world`: `POST /api/worlds`, then the `PUT` the world
  browser's visibility toggle sends). A new world is private, and an anonymous visitor gets
  `WORLD_UNAVAILABLE` there.
- **Behaviours** are written with the product's own `templateGraph` through `client.sendField`, as
  4b-2's `rt.py` did; **clicks are real mouse clicks** on the canvas (`click_node`; models at the
  centre of their bounds, `click_box`, since a model's origin is at its feet).
- **Distances** are from the avatar, which spawns at `[0, 0.7, 0]`; the camera trails 4 m behind it.
- **Walking** holds `W`/`S` in the visitor's viewport after a click on empty sky.
- **The socket log** (`Tab.ws`) records every message both ways through a pass-through
  `route_web_socket`.
- **Check 12 (the host's load).** The new owner tab's relay HOLDS the server's messages from the
  test world's `som-dump` on (`hold`), so the world load is as slow as the script wants; `release`
  delivers them in order.
- **Check 10 (a stale tab).** The tab sends `x-harness-tree: stale`, and `authserver.mjs` serves it
  `STALE_ROOT`'s page files on the SAME origin (`/api` and the world socket stay the 4c server's).
  Fulfilling the page's files from the browser instead (Playwright `route.fulfill`) breaks every
  WebSocket the page opens; don't.
- **Check 11 (pointer lock).** Focus the canvas with a click on empty sky (`sky_point`: owner tabs
  have the world list over the top band), press `M`, click to take the lock, then put the target on
  THAT tab's crosshair: taking the lock can turn the view. With the lock held the canvas covers the
  Edit button, so the owner's tab moves the cube without Edit mode.

## Page hooks (`HOOKS=1`; `harness/server.mjs` always)

`window.__beh()` gives `runner`, `behaviorForm`, `pick(x, y)` (the app's own `pickBehaviorTarget` and
`activateClickTarget`) and `avatarPos` (`worldPosition` of the local avatar); `__ep`, `__lib`,
`__anim`, `__mb`, `__sky` as before. `SPY` wraps the host runner's `select` to record outcomes.

## Regression (check 9)

`reg4c.sh` is signin-sync's `reg_run.sh` set plus 4b-2's `r7.py` and `f3.py`; diff the two runs with
`python3 ../signin-sync/regdiff.py /tmp/reg/base /tmp/reg/r4c` (it now takes the two directories).
