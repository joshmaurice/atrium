# Pre-brief: UI polish — teleporter form, failure panel, top bar

Status: **FINAL, Revision 3. All decisions are confirmed by the human**
(U1–U8, including the U2, U3 and U5 choices and the U8 test script, on
2026-10-01, after external review). Ready for the brief/critic pipeline once
this file is uploaded to `devtasks/`.

Revision 3 (2026-10-01) corrects U8's stated effect. The deploy scripts
don't run `pnpm -r test`; they run a fixed list of packages, which didn't
include `apps/client`. The operator added an explicit `apps/client` test
line to `atrium-deploy` and `atrium-deploy-prod` on 2026-10-01 (§2.6). U8's
script is still added, for `pnpm -r test` and for reviewers.

Revision 2 (2026-10-01) folds in external review. Each point was verified
against `e36a3b8` before being adopted:
- **U1:** a spontaneous socket drop emits `disconnected`, not
  `connecting`, and the `disconnected` handler never resets teleporter UI.
  So both events now terminate any pending placement or delete and reset
  the UI, through one guarded function. Pending state is an explicit flag.
- **U2:** static Load doesn't emit `connecting`, so the failure panel is
  closed explicitly by every user-initiated Load or connect, through one
  `hideTeleportFailurePanel()`.
- **U3:** the shipped `truncateMiddle` protects a host only when it's
  followed by `" · "`, so it would truncate `host/path` hostnames. Replaced
  by a purpose-built helper that truncates only the pathname. "Shown as
  stored" is corrected to "the resolved pathname, percent-encoded, never
  decoded".
- **U5:** `#world-browser` is hidden whole when logged out, so the login
  form can't live inside it. A new always-visible second-row container is
  specified.
- **U8 (new):** the `apps/client` test script, previously Q-client-tests.
- **Correction:** on Node 22, `node --test <directory>` runs nothing; the
  command is `node --test tests/*.test.js`.

This is input for the brief-writing step (brief author, then critic). It is
not the brief itself.

Inputs:
- `devtasks/Atrium-Passdown-2026-09-30-step7-teleporters.md` §6.1 and §6.2;
- `devtasks/PREBRIEF-teleporters.md` (decisions referred to as T#1–T#13);
- `devtasks/PREBRIEF-cross-server-connect.md` (X#1–X#12).

Code facts were verified on `main` at `e36a3b8` (Step 7 tip `88032eea` plus
the Step 7 passdown). Line numbers are approximate. The implementation base
is a freshly fetched `origin/main` at kickoff, never a SHA quoted here
(Step 6 passdown §8).

## 1. Goal

Finish the small UI items left over from Step 7:
- fix the teleporter form's Cancel button, plus related small bugs in the
  same code (§6.1);
- replace the split, overlapping teleport-failure UI with one centred panel,
  with clearer and neutral wording (§6.1);
- slim the top bar to the file box, the world box and the connection
  controls, moving auth and teleporter controls down one row (§6.2);
- make the root test run include the app-client tests (U8).

**Client only.** No server, protocol, database or `@atrium/client` changes.
Files expected to change: `apps/client/index.html`, `apps/client/src/app.js`,
`apps/client/package.json` (U8 only), one new or extended pure helper module
in `apps/client/src/`, and its tests in `apps/client/tests/`.

## 2. Verified facts

### 2.1 The Cancel bug (`app.js` ~L1181)

- `#tp-form` is a child of `#viewport` (`index.html` ~L390).
- The form's Cancel handler hides the form and clears `pendingPosition`,
  `pendingName` and `pendingSeq`, but **doesn't call
  `exitTeleporterMode()`**, so `placementMode` stays `true`.
- The click then bubbles to the viewport's placement handler (~L1058). That
  handler returns early only while the form is visible, and the form is
  hidden by then, so it projects the click (the Cancel button's screen
  position) onto `y = 0` and **reopens the form** there.
- Escape works because its handler calls `exitTeleporterMode()` (~L1036).
- The toolbar's Cancel (`#tp-cancel-btn`) also calls `exitTeleporterMode()`
  and isn't inside the viewport, so it's unaffected.
- **The delete-mode viewport handler (~L1228) has the same exposure:** it
  runs for any click inside `#viewport`, including on overlay UI.

### 2.2 Related small bugs found in the same code

- **The Save label can stick at "Saving...".** Save sets
  `tpSaveBtn.textContent = 'Saving...'`. Only the `som:add` echo and the
  error path restore "Save". Neither `openPlacementForm()` nor
  `exitTeleporterMode()` resets it.
- **Cancelling during a pending save doesn't cancel anything.** The `add`
  has already been sent. The echo still places the pad, but because
  `pendingName` was cleared, the form state no longer tracks it.
- **The spawn warning contradicts T4.** `#tp-spawn-warn` says "pads here may
  trigger immediately on arrival", but T4's arming rule means arriving on a
  pad never fires it.
- **Delete failures are silent.** Delete mode calls
  `client.removeNode(name)` but discards the returned `seq`, and there's no
  `error` listener for it. A refused delete leaves "Deleting teleporter..."
  on the overlay, `deleteTargetName` set, and delete mode open.

### 2.3 Connection events and teleporter UI (`app.js` ~L597–652)

- **`connecting`** (~L624) closes any open teleporter mode or form
  (`exitTeleporterMode()`, R2.5), or else calls
  `updateTeleporterControls()`. It also clears `avatarReady` and
  `currentWorldUrl`, and resets the trigger.
- **`disconnected`** (~L644) only tears down the world, sets the connection
  state and reloads the static file. **It never touches teleporter state.**
  A spontaneous drop (`AtriumClient` emits `disconnected` with reason
  `closed` or `timeout`, and no `connecting`) therefore leaves an open
  form, a pending save or a pending delete in place, with no echo or
  matched error ever arriving.
- **`exitTeleporterMode()` calls `showOverlay('')` unconditionally.**
  Manual Connect reports failure through the same overlay
  (`showOverlay('Connect failed: …')`, ~L962, from `trackConnect`'s
  `disconnected`/`error` listener). A teleporter reset on `disconnected`
  that clears the overlay unconditionally could therefore race with, and
  wipe, that message. It currently works only because of listener
  registration order.

### 2.4 Teleport failure UI today (`app.js` ~L338–395, `index.html` ~L244–262)

- The teleport's `onError` calls
  `showOverlay(\`Could not connect to ${host}\`)`. `#overlay` is small
  (11px), grey, monospace text at `bottom: 30px; left: 12px`, just above the
  WASD hint (`#hud-hint`, `bottom: 10px`).
- **"Go back" is created dynamically** (`document.createElement`, inserted
  after `#overlay`) and fixed at `bottom: 30px; left: 200px`, so it overlaps
  the message text whenever the host name is long.
- The message names only the host, not the path. `onError` ignores the
  `msg` argument it receives.
- **"Go back"'s own failure** shows the same "Could not connect to <host>"
  with no second "Go back" (T8). That's correct and stays.
- "Go back" is hidden on `connecting` (~L628) and `session:ready` (~L600),
  and when a teleport succeeds.
- **Static Load doesn't emit `connecting`.** The toolbar Load button
  (~L900) calls `client.loadWorld()` or `loadAtriumConfig()` directly.
  Load is disabled while connected, but after a failed teleport the client
  is disconnected, so Load is available while a failure message is showing.
- `showOverlay(msg)` sets `textContent` (~L894), so it's safe for
  owner-controlled strings. Any new message element must stay that way: the
  destination is owner-controlled (T13).
- **`truncateMiddle` (`teleporter-label.js` ~L106) protects a host only
  when it's followed by `" · "`,** the separator teleporter labels use.
  Given `host/path` with no separator, it treats the whole string as one
  and can cut the hostname.

### 2.5 Top bar and My Worlds today (`index.html` ~L325–380)

- **`.toolbar` (one flex row), left to right:**
  1. `ATRIUM`;
  2. File: `#worldUrl` + Load;
  3. World: `#wsUrl` + status dot + Connect (one button, which becomes
     "Connecting..." and then "Disconnect") + the Walk/Orbit select;
  4. a separator, then auth: either the login form (username, password,
     honeypot, Login, Register, `#auth-error`) or the user label + Logout;
  5. a separator, then teleporter controls: Place Teleporter, Delete, and a
     hidden Cancel.
- **`#world-browser`** is a separate block below the toolbar. It contains
  the "My Worlds" header, a create row (`.wb-create`: slug, world name,
  Create), `#wb-error`, and the world list (`max-height: 200px`).
- **`setAuthState(user)` (~L61) hides the whole `#world-browser` when
  logged out,** and `refreshWorldList()`'s 401 path hides it too before
  calling `setAuthState(null)`. Anything moved inside `#world-browser`
  disappears when logged out.
- The create row has a lot of empty space to its right, which is §6.2's
  point.
- **The honeypot input** (`#auth-website`) is positioned off-screen
  absolutely. It must move with the login form and stay invisible and
  untabbable.

### 2.6 Testing facts

- `apps/client` tests are pure `node:test` files (no DOM harness) in
  `apps/client/tests/`: `auth`, `teleport-trigger`, `teleporter-label`,
  `teleporter-marker`, `wsUrl`.
- **`apps/client/package.json` has no `test` script.** `apps/*` is in the
  pnpm workspace, but `pnpm -r test` skips packages without one, so the
  root test run never includes these tests.
- **The deploy runs a fixed list, not `pnpm -r test`.**
  `/usr/local/sbin/atrium-deploy` runs `protocol`, `som`, each server test
  file under its own timeout, `packages/client` (with `--test-force-exit`,
  for the known hang), `renderer-three` and `interaction`. **Since
  2026-10-01 it also runs `apps/client` directly** (an operator host change,
  made in both `atrium-deploy` and `atrium-deploy-prod`, with backups):
  `cd apps/client && node --test tests/*.test.js` under a 300 s timeout, with
  no force-exit. That line doesn't depend on U8's script, so this task's own
  DEV deploy is the first to gate on the app-client tests.
- **Verified 2026-10-01 at `e36a3b8`** (Node 22, after `pnpm install`):
  `node --test tests/*.test.js` in `apps/client` passes **124 tests in 5
  files, 0 failures**, and each file exits on its own in about 1 s. That's
  well inside the deploy's 180 s per-file rule. `auth.test.js` starts a
  real HTTP server and database and still exits cleanly.
- **`node --test tests/` (a bare directory) runs nothing on Node 22.**
  It fails with `MODULE_NOT_FOUND`. Use the glob, as every other workspace
  package's `test` script does.
- The separate `packages/client/tests/client.test.js` hang (Step 7 §6.5) is
  unrelated and out of scope.

## 3. Decisions (all confirmed by the human, 2026-10-01)

**U1. Fix the placement form's Cancel, the pending-operation lifecycle,
and the related bugs.**
- **Cancel calls `exitTeleporterMode()`,** the same as Escape and the
  toolbar Cancel.
- **The viewport click handlers act only on clicks on the 3D canvas.** Both
  the placement handler and the delete handler return immediately unless
  `e.target` is the renderer's `<canvas>`. That covers the form, the new
  failure panel (U2) and any future overlay UI in one rule. HUD, overlay,
  crosshair and labels all have `pointer-events: none`, so clicks pass
  through them to the canvas as today.
- **Explicit pending state.** Track a pending placement as a `savePending`
  flag (or the existing `pendingSeq`, used consistently), and a pending
  delete as its `seq`. Never infer state from button text.
- **While a save is pending** (from Save until its echo, its matched error,
  or a reset below), both Cancels are disabled and Escape is ignored.
- **On a matched placement error,** clear `savePending`, restore Save
  ("Save", enabled per the current input), and **re-enable both Cancels and
  Escape**. The form stays open with the error shown.
- **One reset path for connection changes:** a single function, e.g.
  `resetTeleporterUi()`, called from **both `connecting` and
  `disconnected`**. If a teleporter mode, the form, a pending save or a
  pending delete is active, it:
  - abandons any pending save or delete (clears the flags and `seq`s; a
    late echo or error for them is then ignored, as today);
  - closes the form and any mode, restores Save and both Cancels;
  - clears the overlay **only if teleporter UI owns the current overlay
    text** (a placement or delete prompt, or "Deleting teleporter...").
    It must never clear text set by Connect, Load or the failure panel
    (§2.3);
  - updates the controls.

  If nothing teleporter-related is active, it only calls
  `updateTeleporterControls()`. After a spontaneous drop, that disables
  Place and Delete, because `client.connected` is false.
- **Reset the Save button** (label "Save", correct disabled state) in both
  `openPlacementForm()` and `exitTeleporterMode()`.
- **Spawn warning text:** "Visitors arrive here and will land on this pad."
- **Delete failures:** keep the `seq` returned by `removeNode`. On an
  `error` carrying that `seq`, show "Couldn't delete teleporter: <message>"
  via `showOverlay`, clear the pending delete and `deleteTargetName`, and
  stay in delete mode.

**U2. One centred failure panel for teleport failures.**
- **Static markup** in `index.html`, e.g. `#tp-fail-panel`, inside
  `#viewport`, centred horizontally and vertically, styled like the
  placement form (dark, bordered, rounded). It replaces the dynamically
  created `#tp-goback-btn` and its CSS.
- **Contents:** the message (set with `textContent` only), then a button
  row: **Go back** (only for a teleport failure, not for a failed Go back)
  and **Dismiss**.
- **Shown** by the teleport's `onError` and by Go back's `onError`. When it's
  shown, `#overlay` is cleared so the message isn't duplicated.
- **One hide function,** `hideTeleportFailurePanel()`, is the only code
  that hides the panel. Nothing else sets its `style.display`. It's called:
  - on `connecting` and on `session:ready`;
  - **at the start of every user-initiated Load or connect:** the toolbar
    Load (static file or `.json` config), manual Connect, and a My Worlds
    Load. (Teleports and Go back produce `connecting`, which covers them.)
  - by Dismiss, and by Escape while the panel is visible.

  It must **not** be called by the `disconnected` that the failure itself
  produces.
- **Scope (endorsed):** teleport and Go back failures only. Load and manual
  Connect failures keep their current surfaces (`#wb-error`, `#overlay`).

**U3. Failure wording: name the destination, don't assign blame.**
- **A pure, tested formatter for the destination,** e.g.
  `formatDestination(host, pathname, maxLen)`, that receives the parsed
  `host` and `pathname` separately and:
  - **never truncates the host;**
  - middle-truncates **only the pathname** to fit the remaining budget,
    with `…`;
  - if the host alone uses the whole budget, shows the host and `/…`;
  - returns "the commons on <host>" when the pathname is `/`.

  It replaces `truncateMiddle` for this purpose. `truncateMiddle` and the
  pad labels are unchanged.
- **A pure, tested message builder,** e.g.
  `teleportFailureMessage(resolvedUrl, { returning })`, that parses the URL
  and calls the formatter. It never throws, and gives a sensible fallback
  for unparsable input.
- **Text (endorsed):**
  - teleport: **"Couldn't open <dest>. The world may not exist, or the
    server may not be reachable right now."**
  - Go back: **"Couldn't return to <dest>."**
  - where `<dest>` is the host plus the pathname, for example
    `atrium.example/worlds/josh/garden`.
- **The pathname is the resolved URL's `pathname`** as the URL parser
  produces it: percent-encoded and possibly normalized, **never decoded**,
  so encoded characters can't be used to make it look like something else.
- **The host is always shown,** as X#5/X#6 require.
- **Not in this task:** specific reasons (not found / private) from the
  server. Those are Step 7 §6.4 and pair with the public/private toggle.

**U4. Top bar: the first row keeps only world-loading and connection
controls.**
- **First row:** `ATRIUM`, File (`#worldUrl` + Load), World (`#wsUrl` +
  status dot + Connect/Disconnect + Walk/Orbit). Nothing else.
- Element IDs stay the same, so `app.js` lookups keep working.

**U5. A new, always-visible second row holds My Worlds creation, auth and
teleporter controls (endorsed).**
- **A new container,** e.g. `#subbar`, directly below the toolbar, **always
  visible.** It isn't inside `#world-browser`, and auth visibility is never
  tied to `#world-browser`. It contains:
  - **a left group,** e.g. `#subbar-worlds`: the "My Worlds" header and
    the existing create row (slug, world name, Create), **shown only when
    logged in**;
  - **a right group,** pushed right with `margin-left: auto`, **always
    present**: the auth area (the login form when logged out, or the user
    label + Logout when logged in), then a separator and the teleporter
    controls (Place Teleporter, Delete, Cancel).
- **Below it, `#world-browser` keeps only `#wb-error` and `#wb-list`,**
  shown only when logged in, as today.
- **`setAuthState`** toggles both the left group and `#world-browser`.
  The 401 path in `refreshWorldList()` goes through `setAuthState(null)`,
  so it gets the same behavior.
- **Logged out,** the second row shows only the right-hand group.
- **The honeypot** moves with the login form and stays off-screen with
  `tabindex="-1"`.

**U6. Teleporter controls' visibility is unchanged.** They stay visible but
disabled when the session can't place pads, exactly as today. Hiding them
is a separate decision, not part of this task.

**U7. Commit order (suggested).**
1. U8, the test script, alone.
2. U3's helpers, with tests.
3. U1, the Cancel fix, the pending lifecycle and the related bugs.
4. U2, the failure panel, wired to U3.
5. U4 and U5, the layout.

**U8. Give `apps/client` a test script (endorsed).**
- Add `"test": "node --test tests/*.test.js"` to
  `apps/client/package.json`, matching every other workspace package.
- **Its own commit,** first in the series.
- **Effect:** `pnpm -r test` and `pnpm --filter @atrium/app-client test`
  now include these tests, so implementers and reviewers run them the
  normal way. **The deploy gate doesn't depend on this script:** the deploy
  runs the files directly (§2.6). Every file must still pass and exit on
  its own, because the deploy now enforces that.

## 4. Out of scope

- The public/private world toggle (§6.3) and server-sent failure reasons
  (§6.4). They're the next task.
- Connecting to the new world before leaving the old one, and strict
  destination resolution (§6.4).
- Failure surfaces for Load and manual Connect (U2).
- Narrow-window and mobile layout beyond not breaking at common desktop
  widths.
- Hiding the teleporter controls for non-owners (U6).
- The hard-reload 404 and the `client.test.js` hang (§6.5).
- Any server, protocol, database or `@atrium/client` change.

## 5. Open questions for the brief author / critic

- **Q-panel-style:** exact panel styling and width, within "looks like the
  placement form".
- **Q-helper-home:** whether U3's helpers go in `teleporter-label.js` or a
  new module.
- **Q-dest-budget:** the maximum displayed length for `<dest>`.

## 6. Test expectations

**Adversarial-testing standard:** this task changes no authority boundary.
The server still decides every `add` and `remove`, so there's no new
disagreement case to test. Reviewers shouldn't invent one. They should
confirm no server or `@atrium/client` code changed.

Automated. Run with `pnpm --filter @atrium/app-client test` once U8 lands,
or `node --test tests/*.test.js` in `apps/client` (not `node --test tests/`;
see §2.6), and report the output:

- **U8:** the root `pnpm -r test` now includes the `apps/client` files.
  Run them exactly as the deploy does, too:
  `cd apps/client && node --test tests/*.test.js` with no force-exit. Every
  file must pass and exit on its own.
- **U3 `formatDestination`:**
  - a short host + path is returned whole;
  - a long path is middle-truncated and **the host is intact**;
  - a long host with a long path keeps the whole host;
  - a host longer than the budget gives the host and `/…`;
  - `/` gives "the commons on <host>";
  - a host with a port keeps the port;
  - a percent-encoded path stays encoded;
  - it never throws.
- **U3 `teleportFailureMessage`:**
  - a same-server path gives "Couldn't open <host><path>. …";
  - another server's URL gives its host;
  - the Go back variant gives "Couldn't return to <dest>.";
  - garbage or `null` input gives a sensible fallback and never throws;
  - HTML-like characters come back unchanged (escaping is the DOM's job via
    `textContent`; the helper must not insert markup).
- **Existing app-client tests** still pass (124 at `e36a3b8`).

Manual or browser acceptance on DEV (two browsers or profiles where
needed):

- **Cancel:**
  - in placement mode, click the ground, then click the form's Cancel. The
    form closes and stays closed, the crosshair cursor is gone, and Place
    Teleporter is enabled again;
  - the same with Escape, and with the toolbar Cancel;
  - clicking inside the open form (the select, the input, the buttons)
    never moves or reopens it;
  - click Save and quickly try Cancel or Escape. Both are ignored until the
    pad appears, and the next form opened shows "Save", not "Saving...";
  - after a refused save, the error shows, and Cancel and Escape work
    again. To force a refusal, enter a valid `wss://` URL longer than 2,048
    characters: the client doesn't check length, and the server refuses it
    with `INVALID_VALUE` (`session.js` ~L470).
- **Spontaneous drop:** with the placement form open, and again with a save
  pending, drop the connection without starting a new one (for example,
  restart the DEV service, or stop the network in a way that closes the
  socket). The form closes, Place and Delete are disabled, nothing is stuck
  at "Saving...", and any "Connect failed" or disconnect message isn't
  wiped by the reset.
- **Spawn warning** shows the new text near the origin.
- **Delete failure:** force a refusal (e.g. remove the pad from a second
  browser between selecting and confirming, or forge one from devtools). A
  "Couldn't delete teleporter" message appears, and delete mode stays usable.
- **Failure panel:**
  - a pad pointing at a missing world shows the centred panel, naming host
    and path, with Go back and Dismiss. Nothing overlaps;
  - a pad with a very long destination shows the full host, with the
    middle of the path truncated;
  - Go back returns you to the previous world, and the panel disappears;
  - if Go back also fails, the panel shows "Couldn't return to …" with
    Dismiss only;
  - Dismiss and Escape close it;
  - starting a toolbar Load (static file), a manual Connect or a My Worlds
    Load while it's open closes it;
  - clicking its buttons never places a pad or deletes one;
  - a pad pointing at `/` on an unreachable server says "the commons on
    <host>";
  - a destination containing HTML-like text shows it literally.
- **Top bar:**
  - row 1 shows only `ATRIUM`, File + Load, World + status + Connect + mode;
  - logged out, row 2 shows only the login form, on the right; logging in
    works, Register works, the honeypot is invisible and isn't reached by
    Tab;
  - logged in, row 2 shows My Worlds and the create row on the left, and the
    user label, Logout and teleporter controls on the right; the world list
    is below;
  - logging out (and a session expiring, which hits the 401 path) returns
    row 2 to the logged-out layout;
  - Connect / Disconnect, Walk / Orbit, Load, Create, world Load and Delete,
    Place Teleporter, Delete and Cancel all still work;
  - nothing overlaps or wraps badly at common desktop widths.
- **Regression:** the Step 7 DEV acceptance checks (arming, post-reload
  triggering, anonymous view, Go back hidden after a manual Connect, pad
  deletion propagating) as a smoke test.
