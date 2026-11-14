# Handoff: `small-fixes`, implemented on `claude/small-fixes`

The contract is `devtasks/PREBRIEF-small-fixes.md` (Rev 1.0, decisions
taken). Base: `main` at `b639d81` (PROD's `33df9ef6` plus `devtasks/` notes).
Code commit `659dfff`; checks commit `229993e`.

## 1. What changed
- **SF-1, the sign-in** (`auth-sync.js`, `app.js`):
  - `ownLoginPlan` (R1), a pure function: none, home or reconnect;
  - `handleAuthSubmit` asks it after a real login or register (the
    honeypot still returns first);
  - `reconnectSignedIn` (R2) goes through `trackConnect`, the seventh
    connect site (`signin-sync.test.js` counts seven now and has a test for
    it).
- **SF-2, the panel's writes** (`dom-write.js` new, `app.js`,
  `behavior-form.js`):
  - `setIfChanged` (R4) writes a property only when it differs, comparing
    as the DOM stores it (`title = null` stores "null");
  - every `disabled`, `title` and `style.display` in `refreshEditActions`
    and `refreshGroupActions` goes through it;
  - the Behaviour form's `show` and `text` helpers, its buttons, and its
    lists (rebuilt only when their lines change) (R5).
- **SF-3, the import's targets** (`graph-import-panel.js`):
  - `heldNode` finds a held value's node, by id or by name;
  - `idForHeld` maps the own node to `mapping.own` (R7) and another id-less
    node to a stand-in for the preview (R8, distinct per node);
  - Save's stages (R9): the own id, then one `setObjectId` per other id-less
    target, then the leaf (`convert({ forSend: true })`, which refuses
    rather than send a stand-in);
  - R10: a target removed (or replaced by a same-named node) before its
    stage cancels with "A target is gone: choose it again.";
  - R11: `normaliseHeld` rewrites a held `name:` to the id the node has.
- **SF-4, the saved worlds** (`app.js`, `index.html`):
  - `renderWorldList` draws one row: `#wb-select` with "name (slug ·
    time)", the Public switch, Load and Delete;
  - the three controls' code is the old per-world code, moved, with `w`
    read at click time;
  - the choice: the connected world, else the earlier choice, else the
    first, also followed at `session:ready` (`wbSyncChoice`).
- **Tests:** `apps/client/tests/small-fixes.test.js` (new, 21 tests). Four
  source-reading tests were updated for the new form of the same rule
  (`copy-objects-wiring`, `library-grid`: the regex now matches
  `setIfChanged(…)`; `grouping-wiring`: its sandbox gets `setIfChanged`;
  `signin-sync`: seven connect sites).
- **Harness:** `checks/small-fixes/w1.py` (new); `signin-sync/c.py` reads
  the new list markup; `signin-sync/c4b.py` reads the harness root's
  database instead of `/tmp/ah`.

## 2. Found while building
1. **SF-2 isn't a value that alternates.** Over 5 s with the spinner on,
   no panel attribute or text took two values. What the harness shows is
   the rewriting: about 35 writes a second per control (PREBRIEF §2.2). The
   last session's guess (the tracker's `pendingCount`) was wrong. Whether
   the rewriting is what the operator saw is for DEV to show.
2. **A bug of my own, caught by a unit test:** the panel first rewrote a
   row to the id it had just *asked* for. A refused id then stayed in the
   row. `normaliseHeld` now uses only an id the node has.
3. **Two existing harness checks fail on the released code too** (run at
   `b639d81` in a second harness root, `/tmp/ah-base`):
   - `scripting-4d/c1.py` check 4 expects the Enable prompt to end
     "It can also change: . Enable it?". Both codes give "… Enable it?".
     The expectation is out of date.
   - `grouping/g4.py` "the server holds the dragged position": the drag
     lands on 1.3605 and the check rounds it to compare. A rounding edge in
     the check.

## 3. Checks (at `659dfff`, the harness on the real server)
- **Unit:** the app suite 1,896 pass (was 1,866 + this round's); packages:
  client 772, som 306, protocol 155, renderer-three 321, interaction 23,
  behaviors 263. All pass.
- **The probes with `--expect-fixed`** (`devtasks/spike-small-fixes/`):
  - `r1_signin.py`: a guest on alice's own home world signs in, one new
    socket to the same world, admitted as alice, Edit offered; a guest on
    bob's world stays in bob's world, admitted as alice, no Edit; a tab not
    connected goes home. All PASS. On the released code the first two keep
    the guest socket (§2.1 of the pre-brief).
  - `r2_flicker.py`: with the spinner on, **0 panel writes** outside the
    transform fields in 2 s. The same watch counted about 70 per control in
    2 s on the released code.
  - `r3_target.py`: an id-less group targeting itself, one targeting
    another id-less group, and one targeting a cube with an id: all save
    and spin. On the released code the first two are refused before Save.
- **`checks/small-fixes/w1.py`:** 10 PASS: one row with every world, the
  choice follows the connected world and Load, the switch acts on the
  chosen world (the server agrees), a refresh keeps the choice, Delete
  removes the chosen world, one row on a phone (71 px tall at 390 × 844,
  13 worlds) and in desktop-site mode. Screenshots:
  `$HARNESS_ROOT/shots/sf4-{phone-390,desktop-site,desktop-1280}.png`.
- **Regressions:** signin-sync `c.py` all PASS, `c4b.py` PASS; undo-hold
  `h5.py`, `h6.py` PASS; scripting-4d `c1.py` 33/34 (check 4, §2 item 3),
  `c2.py`, `c5.py` PASS; grouping `smoke`, `c1`–`c6` PASS (248), `g4` 9/10
  (§2 item 3); selection-parts `c1`–`c6` PASS (135); touch-nav `tn.py`
  58/58.
- **Harness notes:** scripting-4d `c1.py` needs the auth server started
  with `ATRIUM_AUTOSAVE_DEBOUNCE_MS=3000` (its README says so), and it
  leaves its own restarted server running: stop it before starting another.
  A desktop-site page needs Chromium's local-network flags (as
  `probe12.py`), or it never connects.

## 4. Next
1. The fresh-agent code check (§5, when it lands).
2. The outside code review that runs the code
   (`OUTSIDE-CODE-REVIEW-PROMPT-small-fixes.md`).
3. The release package and the operator's DEV acceptance. What to look at:
   - **SF-1:** signed out, open a public world, sign in in that tab: Edit
     at once in your own world, without a reconnect; in someone else's
     public world, you stay there, signed in.
   - **SF-2:** the operator's `2-rotation.gltf` on an object, selected in
     Edit, on the phone and on desktop: does "Move to" (or anything in the
     panel) still flicker? If so, a screen recording is the next step.
   - **SF-3:** Group a cube, then import `2-rotation.gltf` onto the group,
     targeting the group itself: Save works and it spins.
   - **SF-4:** the saved worlds as one row, on the phone, in desktop-site
     mode and on desktop.
