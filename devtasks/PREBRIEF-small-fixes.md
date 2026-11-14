# Pre-brief: three bugs and a slimmer saved-worlds list (`small-fixes`)

Status: **Revision 1.0 (2026-11-13), decisions taken; to be built on this
branch.** The operator, 20:11 PT: "ok the small bug round with the sign-in
taking you to the same world you were in plz". That answers the last
session's two questions: this round (passdown 2026-11-13 §4 item 1) and
SF-L1 (a), the same world. The slimmer saved-worlds drop-down (§4 item 2's
first point) is in the round as Claude proposed in the same exchange; it is
the separable last item (SF-4), and can be dropped without touching the
rest.

**Process (SF-L0):** as touch-nav: built on the branch first, then the
harness checks, a fresh-agent code check and an outside code review that
runs the code, all before any release. Nothing goes to `main` until the
release, apart from `devtasks/` notes (release rule).

**Branch:** `claude/small-fixes`, from `main` at `b639d81`. PROD and DEV are
on `33df9ef6` (touch-nav), state `COMPLETE`; `b639d81` adds only
`devtasks/` notes on top of it.

## 1. What this delivers
1. **SF-1, a sign-in in this tab is followed at once.** Signing in or
   registering while connected to a world as a guest reconnects to the
   **same world**, as the signed-in user. Edit is then offered at once where
   the user owns the world.
2. **SF-2, the Edit panel no longer rewrites itself on every behaviour
   tick.** "Move to", Group, Ungroup and the panel's other controls are
   written only when their state changes.
3. **SF-3, an imported graph can target an object that has no id yet,**
   including the object it is imported onto (a group made by Group).
4. **SF-4, the saved-worlds list is one slim row:** a drop-down of the
   worlds, with the Public switch, Load and Delete for the chosen one. On
   every screen size.

**Not in this round:** the group's pivot (§2.5); another tab's sign-in
change (SF-L2); the rest of the phone layout; ORBIT.

## 2. Verified facts (at `b639d81`, the harness on the real server)
The probes are in `devtasks/spike-small-fixes/`, run on
`checks/signin-sync/authserver.mjs` (`HOOKS=1` for `r2`, `r3`).

### 2.1 SF-1: the sign-in (probe `r1_signin.py`)
- A signed-out tab connected to a public world, then signed in as alice in
  that tab. **The top bar says alice, and the socket stays the guest's:** no
  new socket, `client.signedIn` false, no Edit button. Seen on alice's own
  home world and on bob's.
- A signed-out tab that is not connected and signs in goes to alice's home,
  admitted as alice, with Edit. That case works and stays as it is.
- **Cause (code):** `handleAuthSubmit` (`app.js`) calls
  `autoConnectToHomeWorld(result)`, which returns at once when
  `client.connected`. Nothing else reconnects: `applyChange` (auth-sync I4)
  runs only for another tab's change or a `SIGNED_OUT`, and I3's backstop
  only at `session:ready`.
- The client knows who the socket was admitted as: `client.signedIn` and
  `client.userId` (signin-sync I1; `signedIn` undefined means unknown).

### 2.2 SF-2: the flicker (probes `r2_flicker.py`, and the panel watch in §5)
- **Not reproduced as a visible change.** With the operator's spin graph
  running on the selected cube (or on a selected group), in the host tab and
  in a second owner tab, focused or not: Move to, Group and Ungroup's
  `disabled` and `title` never change value, and no panel text or attribute
  alternates between two values over 5 s.
- **What is measured:** every control in the panel is **rewritten about 35
  times a second** with the same value: Move to's, Group's and Ungroup's
  `title`, Ungroup's `disabled`, Delete, Duplicate, Copy, Paste, Undo, Redo,
  the name field's `title`, and the Behaviour section's status, buttons and
  notes (the notes list is removed and rebuilt each time).
- **Cause (code):** `client.on('som:set', () => { if (modes.edit)
  refreshEditActions(); … })` runs on every `som:set` of any node, and the
  behaviour's 0.05 rad tick is one `som:set` per frame. Each refresh writes
  every property, changed or not.
- **The last session's guess was wrong:** behaviour sends go through
  `client.sendField`, not the edit tracker, so `pendingCount` doesn't move.
- Whether these rewrites are what the operator saw (an open drop-down on
  the phone, a tooltip on desktop) is **not confirmed**: the harness can't
  open a native drop-down or show a tooltip. The operator checks at DEV.

### 2.3 SF-3: the import's target (probe `r3_target.py`)
- Import of the spin graph through the panel onto a group made by Group (no
  `objectId`), its node mapped to the group itself, then to another id-less
  group: **both are refused before Save** with "the conversion produces a
  value the rule refuses: nodeMap or targets is malformed".
- **Cause (code):** the panel's target picker lists an id-less node as
  `name:<name>` (`pickerValue`), and `mappingFor` passes that string into
  `convertGraph`'s `mapping.nodes`. The panel's Save gives an id to its own
  node only (stage 1); the Behaviour form (`behavior-form.js` stages 1–2)
  gives one to its target too and builds its check with stand-in ids (X3).

### 2.4 SF-4: the list today
- `#world-browser` shows a note line, then one row per world (name, slug and
  time, the Public switch, Load, Delete), capped at 40 % of the height
  (touch-nav) and the list at 200 px.
- `renderWorldList` (`app.js`) builds it. Only the harness check
  `signin-sync/c.py` reads its markup (`#wb-list .wb-item`, `.wb-meta`).

### 2.5 The group's pivot (not a bug)
Group puts the new group's origin at the grouped object's position (GR-L1
(a)), so a spin turns everything about that object. A later round could
offer "centre the group's origin on its parts".

## 3. The rules
### SF-1
- **R1.** After this tab's own login or register succeeds (not the
  honeypot), the page decides with one pure function in `auth-sync.js`,
  `ownLoginPlan({ user, connected, sameOrigin, admittedUserId, worldUrl })`:
  - no user id → nothing;
  - not connected → the home world, as today;
  - connected cross-origin → nothing (that connection is anonymous anyway,
    as I4 leaves it);
  - connected same-origin, admitted as this user → nothing;
  - connected same-origin, admitted as anyone else or unknown → **reconnect
    to `worldUrl`, the world the tab is in**; with no URL, the home world.
- **R2.** The reconnect goes through `trackConnect` (the one connect path,
  with its guard), with the avatar and the user's display name, as the
  world list's Load does. A failure is shown as Load's is ("Load failed:
  …" in the world list's error line).
- **R3.** `applyChange` (another tab's change, `SIGNED_OUT`) is unchanged:
  it still goes to the home world (SF-L2).

### SF-2
- **R4.** One helper, `setIfChanged(element, property, value)`
  (`apps/client/src/dom-write.js`, new), writes a DOM property only when it
  differs. `refreshEditActions` and `refreshGroupActions` use it for every
  `disabled`, `title` and `style.display` they write.
- **R5.** The Behaviour form's text writes (its `text` helper and its
  buttons' `textContent`) write only on a change, and its notes list is
  rebuilt only when its lines change.
- **R6.** Nothing else changes: the same refreshes run on the same events,
  and every click still checks again.

### SF-3
- **R7.** A mapping row whose held value is the panel's own node (by id or
  by `name:`) maps to `mapping.own`.
- **R8.** Any other id-less target maps, for the preview, to a stand-in id:
  distinct per node, in `OBJECT_ID_RE`'s form, never sent.
- **R9.** Save's stages: 1, the own node's id (as today); then one
  `setObjectId` for each other id-less target, in row order; then the leaf,
  rebuilt from the ids the nodes actually have.
- **R10.** Before each stage, every target is checked: still in the SOM (the
  same node object). A removed target cancels the Save with "A target is
  gone: choose it again." A target that got an id elsewhere meanwhile is
  used with that id and gets no second one.
- **R11.** Once a node has its id, the rows that held `name:<name>` hold the
  id, so the pickers keep their choice.

### SF-4
- **R12.** `#wb-list` holds one row: a `<select>` (`#wb-select`), one
  option per world, labelled "name (slug · time)"; then the Public switch,
  Load and Delete, acting on the chosen world. The note line stays,
  above it.
- **R13.** The chosen world: the one this tab is connected to when it is in
  the list; else the one chosen before, if it is still there; else the
  first. A refresh keeps the choice by id.
- **R14.** Load, the switch and Delete keep today's code (moved, not
  rewritten): the same requests, the same generation checks, the same
  messages. An empty list still reads "No worlds saved yet."
- **R15.** On every screen size (the operator, 2026-11-13).

## 4. Files
- `apps/client/src/auth-sync.js`: `ownLoginPlan` (R1).
- `apps/client/src/app.js`: the login's plan and reconnect (R2); the
  change-only writes (R4); the world row (R12–R14).
- `apps/client/src/dom-write.js` (new): `setIfChanged` (R4).
- `apps/client/src/behavior-form.js`: R5.
- `apps/client/src/graph-import-panel.js`: R7–R11.
- `apps/client/index.html`: the world row's CSS.
- Tests: `apps/client/tests/small-fixes.test.js` (new) for R1, R4, R7–R11;
  `devtasks/harness/checks/small-fixes/` for the browser checks.
- `devtasks/harness/checks/signin-sync/c.py`: the new list markup.

## 5. Checks
- **Unit:** `ownLoginPlan`'s six cases; `setIfChanged`; the panel: an
  id-less own node targeting itself (no second `setObjectId`, the leaf names
  the own id), two other id-less targets (two stages, then the leaf with
  both real ids), a removed target cancels, a target given an id elsewhere
  gets none; the pickers keep their choice.
- **Browser (harness):** `r1`–`r3` with `--expect-fixed`; a world-list check
  (the row, the choice kept across a refresh, Load, the switch, Delete);
  screenshots at 390 × 844, in desktop-site mode and at 1280 × 900; the
  grouping, touch-nav and signin-sync checks as regressions.
- Then a fresh-agent code check and an outside code review that runs the
  code.

## 6. Decisions
- **SF-L0 (a):** build now, review after (the operator's way since
  touch-nav).
- **SF-L1 (a): the same world** (the operator, 20:11 PT).
- **SF-L2 (a): another tab's sign-in change is unchanged** (it still goes to
  the home world). Making it follow the same world too is a one-line change
  in `applyChange`, but it changes signin-sync's I4, whose checks expect the
  home world. Claude's recommendation: leave it for now; the operator can
  ask for it.
- **SF-L3 (a): change-only writes, without a confirmed visual cause.** The
  operator says at DEV whether the flicker is gone. If it isn't, the next
  step is a screen recording of it.
- **SF-L4 (a): one row, with the note kept above it.** The least work; the
  note was copy-objects K9's rule.

## 7. Release notes (draft)
- Signing in while you're in a world as a guest now reconnects you to the
  same world, signed in. Edit is offered at once in your own worlds.
- The Edit panel no longer redraws its buttons many times a second while a
  behaviour moves an object.
- A graph imported from a file can now target an object that hasn't been
  given an id yet, including the group it's imported onto.
- Your saved worlds are now one compact drop-down row, with Public, Load and
  Delete beside it.
- Still the same: signing in or out in another tab still takes this tab to
  your home world.
