# Passdown 2026-11-15: `small-fixes` shipped to PROD (`e129086f`)

This supersedes `Atrium-Passdown-2026-11-13-touch-nav-shipped.md` as the
starting point. Read this file first. That passdown's rules and lessons
still hold, and so do the host, connector and convention notes it points to
(`Atrium-Passdown-2026-11-06-richer-add-shipped.md` §3, §4). This file adds
to them.

**First instruction for the next session's Claude:**
1. **Get the repo.** Use `add_repo` on `joshmaurice/atrium` with access
   `push`, clone to `/home/claude/atrium`, and read this file.
2. **Nothing is in flight.** PROD, MAIN and DEV are all on `e129086f`, state
   `COMPLETE`. The next step is choosing the next round with the operator
   (§4).
3. **Use the `atrium-ops` connector** (read-only) for board, release, log and
   git state. Check DEV's actual SHA with `release_status` before reading an
   acceptance as done.
4. **These rules are unchanged:**
   - the release rule (push nothing to `main` between the DEV release merge
     and PROD `COMPLETE`);
   - the cost rule;
   - the host-command rule: no leading spaces, real 40-character SHAs, never
     placeholders;
   - the review-SHA rule.
5. **The operator's way of working** (unchanged from touch-nav):
   - **Ask in plain prose, not multiple-choice boxes,** so it can be
     discussed and read aloud by text-to-speech. Short sentences, no tables
     in spoken answers. (This session slipped once.)
   - He tests on an **Android phone in Chrome** and in its **"desktop site"**
     mode, and on a laptop.
   - **Say which version you mean.** He asked, about "how it works right
     now": that was the unreleased branch, not what he could see. Say
     "on the branch" or "live" when describing behaviour.

## 1. Where things stand
- **PROD, MAIN, DEV:** `e129086fe34b1b569a506e9211420f239033037d`, state
  `COMPLETE` (2026-11-15, about 12:15 PT). PROD and DEV serve the same
  `app.js` (`1fc0ecbb2d9c`).
- **The round:** `small-fixes`, three bugs and a slimmer saved-worlds list.
- **The record, on `main`:**
  - `devtasks/PREBRIEF-small-fixes.md` (Rev 1.1, rules R1–R15, decisions
    SF-L0 to SF-L5);
  - `HANDOFF-small-fixes.md` (§1–§9: the build, the fresh-agent check, both
    outside reviews, the DEV acceptance);
  - `RELEASE-small-fixes.md` (commands, acceptance steps, release notes);
  - probes in `devtasks/spike-small-fixes/` (`r1`–`r3`), and checks in
    `devtasks/harness/checks/small-fixes/` (`w1`, `m1`).
- **The reviews' own files** (`REVIEW-small-fixes-code-fable{,-2}.md`) and
  their probe zips are in the Fable sessions, not in the repo.

## 2. What the round changed (code in 12 files under `apps/client`, last code commit `3456ec9`)
- **SF-1, sign-in follows you.** Signing in or registering while connected
  as a guest reconnects to the **same world**, signed in (`ownLoginPlan` in
  `auth-sync.js`; `reconnectSignedIn` in `app.js`, the seventh connect site
  through `trackConnect`). Not connected: the home world, as before.
- **SF-2, no more rewriting.** The Edit panel's refresh runs on every
  `som:set`, and a behaviour sends one a frame. Every control was rewritten
  about 35 times a second with the same values. Now writes go through
  `setIfChanged` (`dom-write.js`, new) in the whole selected-object refresh,
  and the Behaviour form rebuilds its fields, notes and log only when they
  change. **The operator confirmed at DEV that the flicker is gone.** The
  test browser never showed the flicker itself, only the rewrites.
- **SF-3, imports can target id-less objects** (`graph-import-panel.js`).
  The own node maps to `mapping.own`. Other id-less targets, animation rows
  included, get stand-in ids for the preview and one `setObjectId` stage
  each at Save. A removed or replaced target cancels the Save. The pickers
  are held while a Save runs. The "It can change" line names the objects,
  or says the graph changes only its own object.
- **SF-4, the saved worlds in one row** (SF-L5, the operator 2026-11-14):
  - a drop-down, then Public and Delete; **choosing a world opens it**, so
    there is no Load button;
  - the drop-down shows the world the tab is in, or "Open a saved world…";
  - Public and Delete act only on that world, and are off mid-connect or
    when the tab is in none of them;
  - **deleting the world you're in takes you to your home world**
    (disconnects if it was the home world itself). The server keeps a
    deleted world's sessions open, so this matters.
- **"Move to…" shows before the first click** (older than the round).

## 3. Lessons from this round
1. **My checks hid two of my bugs.**
   - `r2_flicker.py` first skipped all of `#ep-fields`, so it missed the
     name field's and the Behaviour section's rewrites (the fresh-agent
     check found them).
   - `w1.py` never read the error line, so "Load failed: outcome is not
     defined" after every open reached DEV.

   **A check must watch the whole surface the change touches, its error
   and status lines included.**
2. **Each "small fix" after a review brought a new bug.**
   - The fix for the fresh-agent check's finding 1 broke the Behaviour
     fields after Edit off and on (the outside review's M-1).
   - Twenty lines after the second review put a scoping error in the open
     handler.

   Before calling a post-review fix done, exercise the user's actual path
   in the browser: close and reopen, open a world and look at the whole
   row.
3. **The review sequence worked well:** a fresh-agent check (no must-fix,
   four should-fix), an outside Fable review that ran the code (one
   must-fix), then a **follow-up in the same Fable session**. The follow-up
   was quick because it reran its own probes against the fixes. Reuse the
   same session for follow-ups.
4. **Read the reviewer's whole report.** It had noted the empty "It can
   change:" line for an own-only graph, and I missed it until DEV.
5. **Harness notes** (also in `HANDOFF-small-fixes.md` §3, §6):
   - `scripting-4d/c1.py` needs the auth server started with
     `ATRIUM_AUTOSAVE_DEBOUNCE_MS=3000`, and it leaves its own restarted
     server running: stop it before starting another;
   - `scripting-4b-2/f1.py` needs `tests/fixtures/*.bin` copied into
     `HARNESS_ROOT` (else HTTP 500 at F12);
   - a desktop-site page (viewport meta stripped) needs Chromium's
     local-network flags or it never connects (as `probe12.py`);
   - `scripting-4b-2` checks print observations, not PASS/FAIL: compare them
     with the released commit, ids and numbers masked;
   - **two checks fail on the released code too:** `scripting-4d/c1.py`
     check 4 (its expected Enable text is out of date) and `grouping/g4.py`
     "the server holds the dragged position" (a rounding edge at 1.3605).
     Fixing their expectations is a small job.

## 4. Next: the candidates, with what is already known
In the order Claude suggests. The operator hasn't chosen yet.

1. **A phone layout** (touch-nav HANDOFF §9; the saved-worlds part is done).
   The aim the operator stated: not polish, since these panels may be
   superseded, but keep normal phone mode fairly usable:
   - the Edit panel covers much of the view in portrait;
   - landscape;
   - the top bar wraps or collapses instead of scrolling.

   Start from screenshots of his phone, and `probe9` / `probe12`. Run normal
   and desktop-site modes.
2. **ORBIT, its own round.** Switching to ORBIT shows no change: it starts
   at the avatar's position, circling the world's origin, and moves the
   avatar's node itself. To decide:
   - what it orbits (the selection, the point looked at, the avatar);
   - where the camera starts;
   - whether the avatar stays put.
3. **The grouping session's candidates**
   (`NOTE-2026-11-10-grouping-unreleased-next-round.md`):
   - **multi-select:** Shift-click, and Group of several objects;
   - **materials in the Edit panel:** a colour control, a notice that a
     material is shared, and "make this one unique";
   - **the texture limit:** unconfirmed, investigate before stating it.
4. **Smaller leftovers** (any could join a round):
   - **another tab's sign-in still sends this tab home** (SF-L2). Making it
     follow the same world is a small change in `applyChange`, but it
     changes signin-sync I4 and its checks;
   - **"centre the group on its parts":** Group puts the origin at the first
     object, so a spin turns about that object (as designed, GR-L1 (a));
   - **an auth re-check already in flight at login** can send the tab home
     instead of the same world (the fresh-agent check's N-8; narrow, older);
   - **two id-less objects with one name** count as one target (the review's
     N-2; the server resolves by name the same way);
   - the two outdated harness checks (§3.5).

## 5. Stated limits (in the release notes)
- Signing in or out in another tab takes this tab to your home world.
- You have to open a world to change its visibility or delete it.
- Deleting your home world while you're in it disconnects you.

## 6. Cleanup (the operator, on the host)
`main` now carries this passdown (a fast-forward of a `devtasks/`-only
commit from `claude/small-fixes`). Then:
```bash
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/small-fixes
```
