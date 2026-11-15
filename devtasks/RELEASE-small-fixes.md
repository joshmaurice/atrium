# Release package: `small-fixes`

- **What:** the round on `claude/small-fixes`, based on `b639d81` (`main`:
  PROD's `33df9ef6` plus `devtasks/` notes). Code in 12 files, all under
  `apps/client` (`git diff --stat b639d81 <tip> -- . ':!devtasks'`):
  `app.js`, `auth-sync.js`, `behavior-form.js`, `graph-import-panel.js`,
  `dom-write.js` (new), `index.html`, and their tests. The last code commit is
  `3456ec9` (the DEV acceptance's three fixes, handoff §9); everything
  after it is `devtasks/`.
- **Status:**
  - **the first DEV acceptance at `fb333b8`** (2026-11-15): all passed but
    three things, fixed in `3456ec9` (handoff §9), with no outside review:
    the "Load failed: outcome is not defined" line after every open, the
    empty "It can change:" line, and the blank "Move to" (older);
  - a fresh-agent code check (§5 of the handoff), then two outside code
    reviews by Claude Fable 5.2 that ran the code (§6 at `163c127`, §8 at
    `aa73f48`); every finding fixed or decided by the operator (SF-L5,
    S-3);
  - the fixes after the second review (`3255ba6`, about 20 lines) had no
    outside review; their checks pass: the app suite 1,909, `w1` 12/12
    (with the go-home check), `signin-sync/c.py` 22/22, `r1`, `r2`, `r3`,
    `m1`.
- **State checked 2026-11-14, 13:16 PT** (`release_status`): `COMPLETE`; DEV
  and PROD on `33df9ef6`, both healthy; deploy lock free; `main`
  (`b639d81`) is the branch's base.
- **No protocol change, no stored-data change, no server change:** a tab
  opened before the deploy keeps working (it has the old page until it
  reloads).

## 1. The DEV deploy
Ask Claude for the DEV command. Claude checks the branch tip, and that
nothing outside `devtasks/` changed since `3456ec9`, then gives:
```bash
atrium-deploy-gate "dev <the 40-character tip SHA>"
```
After the deploy, Claude checks DEV's actual SHA with `release_status`
before the acceptance counts.

## 2. DEV acceptance
The DEV site, hard-reloaded. Phone (Android Chrome) and laptop both, where a
step says so.

**Second pass (after `3456ec9`):** steps 4 and 5.2, and "Move to…" shows
in the drop-down before you click it. The rest passed at `fb333b8`.

1. **Sign-in follows you (SF-1).**
   1. Signed out, open a public world of yours (make one public first, from
      the saved-worlds row). You're in it as a guest: no Edit.
   2. Sign in, in that tab. The page reconnects to **the same world**, and
      Edit is there at once.
   3. Signed out, in someone else's public world: sign in. You stay in that
      world, signed in (no Edit there, as a visitor).
2. **No flicker (SF-2), on the phone and on the laptop.** Put
   `2-rotation.gltf` on an object (or a group), enable it, select the object
   in Edit. Watch "Move to", Group, Ungroup and the Behaviour section while
   it spins: **nothing flickers**. Open the "Move to" drop-down while it
   spins: it stays open. *If anything still flickers, a screen recording is
   the next step* (the cause was never seen in the test browser).
3. **Edit off and on (the review's M-1).** An object with a template
   behaviour (e.g. "On select: show or hide"), selected: turn Edit off, then
   on, select it again. Target and Action show.
4. **Import onto a new group (SF-3).** Group a cube. With the group
   selected, import `2-rotation.gltf` and choose the group itself as the
   target. The "It can change" line reads "only <the group> (the object it
   is imported onto)". Save: it saves, enable it, and the group spins.
   (Targeting another new group instead names that group.)
5. **The saved-worlds row (SF-4, SF-L5), on the phone, in desktop-site mode,
   and on the laptop.**
   1. One slim row: a drop-down showing the world you're in, then Public and
      Delete. No Load button.
   2. Choose another world in the drop-down: it opens at once, the row
      shows it, and no "Load failed" line appears above it.
   3. Public acts on the world you're in.
   4. Create a world: the drop-down stays on the world you're in.
   5. Delete a spare world while you're in it (confirm): you land in your
      home world, and the row shows Home.
   6. Disconnect: the row reads "Open a saved world…", and Public and Delete
      are off.

Then MAIN and PROD (§3), then step 6.

6. **PROD.** Steps 1.2 and 5.1–5.2.

**Known and written down:** signing in or out in *another* tab still sends
this tab to the home world (SF-L2). Deleting your home world while in it
disconnects you.

## 3. MAIN and PROD (after the acceptance)
Claude gives these with the deployed SHA filled in, after checking
`git diff 3456ec9 <DEV SHA> -- . ':!devtasks'` is empty:
```bash
atrium-main-approve <SHA> && atrium-deploy-gate "main <SHA>"
```
Once MAIN has finished:
```bash
atrium-prod-approve <SHA> && atrium-deploy-gate "prod <SHA>"
```
**Never push to `main` between the DEV release merge and PROD `COMPLETE`.**

## 4. Release notes
- **Signing in follows you.** Sign in while you're in a world as a guest, and
  the page reconnects you to the same world, signed in. In your own world,
  Edit is there at once.
- **No more redrawing.** The Edit panel no longer rewrites its buttons and
  fields many times a second while a behaviour moves something.
- **Imported graphs can target new groups.** A graph imported from a file
  can now target an object that hasn't been given an id yet, including the
  group it's imported onto. The preview names it.
- **Saved worlds in one row.** One compact drop-down: choose a world to open
  it. Public and Delete beside it act on the world you're in. Deleting the
  world you're in takes you home.
- **Still the same:** signing in or out in another tab takes this tab to
  your home world.

**Rollback:** to `33df9ef6`. No stored data or protocol changed.
